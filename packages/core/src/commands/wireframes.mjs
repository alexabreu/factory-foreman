// factory-foreman wireframes design [--issue n] [--draft <file>]
//
// The drafting agent writes one small, self-contained, low-fidelity HTML file
// per visual acceptance criterion (and one per edge state it has) in the
// issue's state folder: .factory-foreman/<n>/wireframes/AC-1.html,
// AC-1-empty.html. This command renders each to PNG with agent-browser, puts
// the pages and images in one commit on an assets-only branch,
// factory-foreman-assets/<n>, built with git plumbing so the working tree, the
// index and the current branch are never touched, pushes it with the
// developer's own git credentials, and writes the draft's "## Wireframes"
// section: one image per page, linked to its blob at that commit, so a
// version's images never change after it is posted. The issue branch never
// carries them, so they can't be merged into the product.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Refusal } from '../errors.mjs'
import { readDraftFile } from '../review/briefs.mjs'
import { FENCE, closes, parseDraft, splitFrontMatter, wireframePath, withFrontMatter } from '../steps/structure.mjs'
import { approvedBody, loadIssue } from './common.mjs'

// Where the pages and images sit in the assets commit.
export const ASSETS = 'design'
export const assetsBranch = (n) => `factory-foreman-assets/${n}`
const NAME = /^(AC-\d+)(?:-([a-z][a-z0-9-]*))?\.html$/
// A wireframe draws itself: no scripts, frames or embeds, and every reference
// (attribute or CSS url) stays inside the page (#…) or is inline (data:). That
// keeps the render offline and keeps local files out of a pushed image.
const BANNED = /<\s*(script|iframe|frame|object|embed|link|base|portal|animate\w*|set)\b|<\s*meta\b(?!\s+(?:charset\s*=|name\s*=\s*["']?viewport))|\son[a-z]+\s*=|image-set\s*\(|(?:<style\b[^>]*>[^<]*|\bstyle\s*=\s*(?:"[^"]*|'[^']*))\\/i
const REFERENCE = /\b(?:src|srcset|href|xlink:href|action|formaction|data|poster|background|ping|cite|longdesc|manifest|codebase|archive)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)|@import/gi
const inside = (value) => /^\s*(#|data:)/i.test(value ?? '')
export function notSelfContained(html) {
  const banned = html.match(BANNED)
  if (banned) return banned[1] ? `it has a <${banned[1].toLowerCase()}>` : `it has ${banned[0].trim().slice(0, 40)} (no scripts, event handlers, meta refreshes, image-set() or escapes in CSS)`
  for (const m of html.matchAll(REFERENCE)) if (!inside(m[1] ?? m[2] ?? m[3])) return `it refers to ${(m[1] ?? m[2] ?? m[3]).slice(0, 60)}`
  for (const m of html.matchAll(CSS_URL)) if (m[0].startsWith('@') || !inside(m[1] ?? m[2] ?? m[3])) return `its CSS loads ${m[0].slice(0, 60)}`
  return null
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const wireframesDir = (stateDir) => join(stateDir, 'wireframes')
export const INSTALL = 'Install agent-browser to render wireframes: npm install -g agent-browser, then agent-browser install (it downloads the browser it drives).'

// The wireframe pages in the wireframes folder, in AC order, normal state first.
export function wireframeFiles(dir) {
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')) : []
  const problems = []
  const files = []
  for (const name of names) {
    const m = name.match(NAME)
    if (!m) { problems.push(`${name}: name it AC-<n>.html, or AC-<n>-<state>.html for an edge state (lowercase, like AC-1-empty.html).`); continue }
    const state = m[2] ?? 'normal'
    if (m[2] === 'normal') { problems.push(`${name}: the normal state is ${m[1]}.html.`); continue }
    files.push({ name, id: m[1], state, html: join(dir, name), png: join(dir, name.replace(/\.html$/, '.png')) })
  }
  const n = (id) => Number(id.slice(3))
  files.sort((a, b) => n(a.id) - n(b.id) || (a.state === 'normal' ? -1 : b.state === 'normal' ? 1 : a.state.localeCompare(b.state)))
  return { files, problems }
}

// Renders one HTML file to a PNG with agent-browser, in a session of its own.
// Its daemon socket goes in a fresh temp folder rather than ~/.agent-browser,
// which Codex's sandbox makes read-only; the temp folder is writable there and
// short enough for a socket path. The browser itself is only read from
// ~/.agent-browser/browsers.
export function agentBrowser(ctx, session = `factory-foreman-wireframes-${process.pid}`) {
  const sockets = mkdtempSync(join(tmpdir(), 'ffw-'))
  const env = { ...ctx.env, AGENT_BROWSER_SOCKET_DIR: sockets }
  const run = async (args) => {
    const result = await ctx.exec([ 'agent-browser', '--session', session, ...args ], { env, timeout: 120_000 })
    if (result.code === 127) throw new Refusal(INSTALL)
    if (result.code !== 0) throw new Refusal(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim().split('\n').at(-1)}`)
    return result
  }
  return {
    async render(html, png) {
      await run([ 'set', 'viewport', '960', '640' ])
      await run([ 'open', pathToFileURL(html).href ])
      await run([ 'screenshot', png, '--full' ])
    },
    async close() {
      try {
        await ctx.exec([ 'agent-browser', '--session', session, 'close' ], { env, timeout: 30_000 })
      } finally {
        rmSync(sockets, { recursive: true, force: true })
      }
    },
  }
}

async function git(ctx, args, what, opts = {}) {
  const result = await ctx.exec([ 'git', ...args ], { timeout: 120_000, ...opts })
  if (result.code !== 0) {
    const why = String(result.stderr).split('\n').filter((l) => l.trim() && !l.startsWith('hint:')).at(-1) ?? ''
    throw new Refusal(`${what} failed: ${why.trim()}`, { stderr: String(result.stderr) })
  }
  return result.stdout.trim()
}

export function wireframesSection({ repo, commit, files }) {
  const lines = [ '## Wireframes', `Low-fidelity wireframes, rendered at ${commit.slice(0, 7)}.` ]
  let current = null
  for (const f of files) {
    if (f.id !== current) { lines.push('', `### ${f.id}`); current = f.id }
    lines.push(`![${f.id} ${f.state}, sha256:${f.hash}](https://github.com/${repo}/blob/${commit}/${wireframePath(f.id, f.state)}?raw=true)`)
  }
  return `${lines.join('\n')}\n`
}

// Puts the section in place of the draft's Wireframes section, or at its end.
// Headings inside code blocks aren't sections, as in parseDraft.
export function withWireframes(text, section) {
  const { meta, body } = splitFrontMatter(text)
  const lines = body.replace(/\n+$/, '').split('\n')
  const headings = []
  let fence = null
  lines.forEach((line, i) => {
    if (fence) { if (closes(fence, line)) fence = null; return }
    const open = line.match(FENCE)
    if (open) { fence = open[1]; return }
    if (/^##\s/.test(line)) headings.push(i)
  })
  const start = headings.find((i) => /^##\s+Wireframes\s*$/.test(lines[i]))
  if (start === undefined) return withFrontMatter(meta, `${lines.join('\n')}\n\n${section}`)
  const next = headings.find((i) => i > start)
  const rest = next === undefined ? [] : lines.slice(next)
  return withFrontMatter(meta, `${[ ...lines.slice(0, start), ...section.trimEnd().split('\n'), ...(rest.length ? [ '', ...rest ] : []) ].join('\n')}\n`)
}

// A pinned wireframe as a file the reviewer can open: the rendered one if it is
// exactly that image, else the pinned blob from the assets repo, else null.
export async function pinnedImage(ctx, w) {
  const dir = wireframesDir(ctx.stateDir())
  const local = join(dir, w.path.split('/').pop())
  if (existsSync(local) && sha256(readFileSync(local)) === w.hash) return local
  const assets = join(dirname(ctx.stateDir()), 'assets.git')
  if (!existsSync(join(assets, 'HEAD'))) return null
  const out = join(dir, 'pinned', w.commit.slice(0, 12), w.path.split('/').pop())
  if (existsSync(out) && sha256(readFileSync(out)) === w.hash) return out
  const result = spawnSync('git', [ '--git-dir', assets, 'cat-file', 'blob', `${w.commit}:${w.path}` ], { maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0 || sha256(result.stdout) !== w.hash) return null
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, result.stdout)
  return out
}

// The assets commit: the previous one's tree with its design folder replaced by
// these files, on top of it. `a` runs git in the assets repo.
async function assetsCommit(a, ctx, { n, files, parent, author }) {
  const blob = async (file) => a([ 'hash-object', '-w', '--', file ], 'Storing a wireframe')
  const entries = []
  for (const f of files) {
    entries.push(`100644 blob ${await blob(f.html)}\t${f.name}`, `100644 blob ${await blob(f.png)}\t${f.name.replace(/\.html$/, '.png')}`)
  }
  const mktree = async (lines) => {
    const result = await ctx.exec([ 'git', '--git-dir', a.dir, 'mktree' ], { cwd: a.top, input: lines.length ? `${lines.join('\n')}\n` : '' })
    if (result.code !== 0) throw new Refusal(`Building the wireframes commit failed: ${String(result.stderr).trim()}`)
    return result.stdout.trim()
  }
  const design = await mktree(entries)
  const kept = parent ? (await a([ 'ls-tree', parent ], 'Reading the last assets commit')).split('\n').filter((l) => l && !l.endsWith(`\t${ASSETS}`)) : []
  const tree = await mktree([ ...kept, `040000 tree ${design}\t${ASSETS}` ])
  if (parent && tree === await a([ 'rev-parse', `${parent}^{tree}` ], 'Reading the last assets commit')) return parent
  // By the developer, as the target repo's git config names them.
  const env = { ...ctx.env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email }
  // Signed when the developer signs their commits, for repos whose rules require it.
  const sign = (await ctx.exec([ 'git', 'config', '--bool', 'commit.gpgsign' ])).stdout.trim() === 'true'
  return a([ 'commit-tree', ...(sign ? [ '-S' ] : []), tree, ...(parent ? [ '-p', parent ] : []), '-m', `Wireframes for the Design of #${n}` ], 'Committing the wireframes', { env })
}

// Config entries the target has and the assets repo wouldn't (its own file, its
// includes, includeIf blocks that match only the target), as GIT_CONFIG_*
// environment variables for git in the assets repo.
const KEYS = '^(core\\.sshcommand|credential\\..*|http\\..*|url\\..*|user\\.signingkey|gpg\\..*|commit\\.gpgsign)$'
export async function carriedConfig(ctx, assetsDir) {
  const entries = async (args) => (await ctx.exec([ 'git', ...args, 'config', '--includes', '--null', '--get-regexp', KEYS ])).stdout.split('\0').filter(Boolean)
  const theirs = await entries([ '--git-dir', assetsDir ])
  const carried = []
  for (const entry of await entries([])) {
    const i = theirs.indexOf(entry)
    if (i === -1) carried.push(entry); else theirs.splice(i, 1)
  }
  const env = { GIT_CONFIG_COUNT: String(carried.length) }
  carried.forEach((entry, i) => { const nl = entry.indexOf('\n'); env[`GIT_CONFIG_KEY_${i}`] = entry.slice(0, nl); env[`GIT_CONFIG_VALUE_${i}`] = entry.slice(nl + 1) })
  return env
}

export async function wireframes(ctx, { positionals, flags }) {
  if (positionals[0] !== 'design') throw new Refusal('Wireframes belong to a Design: factory-foreman wireframes design.')
  const n = ctx.issue()
  const file = flags.draft ?? ctx.draftPath('design')
  readDraftFile(file, 'design')
  const state = await loadIssue(ctx.github(), n, ctx.config().approvals)
  const body = approvedBody(state.steps.shape)
  if (!body) throw new Refusal('Wireframes draw the approved Shape\'s visual criteria: approve a Shape first.')
  const shape = parseDraft(body)
  const dir = wireframesDir(ctx.stateDir())

  const { files, problems } = wireframeFiles(dir)
  const ids = new Set(shape.criteria.map((c) => c.id))
  for (const f of files) {
    if (!ids.has(f.id)) problems.push(`${f.name}: the approved Shape has no ${f.id}.`)
    const why = notSelfContained(readFileSync(f.html, 'utf8'))
    if (why) problems.push(`${f.name} isn't self-contained: ${why}. A wireframe uses inline styles and nothing else: no scripts, frames, links, fonts or images, except data: URLs and #anchors.`)
  }
  for (const c of shape.criteria.filter((c) => c.visual && !files.some((f) => f.id === c.id))) problems.push(`${c.id} is visual and has no wireframe: write ${join(dir, `${c.id}.html`)}.`)
  if (!files.length && !problems.length) problems.push(`There are no wireframes to render: write them in ${dir}.`)
  if (problems.length) throw new Refusal(`The wireframes can't be rendered yet:\n  - ${problems.join('\n  - ')}`, { problems })

  const browser = ctx.browser ? ctx.browser() : agentBrowser(ctx)
  try {
    // A PNG left from an earlier run must never pass for this one.
    for (const f of files) { rmSync(f.png, { force: true }); await browser.render(f.html, f.png) }
  } finally {
    await browser.close?.()
  }
  for (const f of files) {
    if (!existsSync(f.png)) throw new Refusal(`Rendering ${f.name} wrote no ${f.png}.`)
    f.hash = sha256(readFileSync(f.png))
  }

  // The commit is built and pushed from a bare repo of its own in the ignored
  // state folder, so nothing writes to the target's .git (read-only in Codex's
  // sandbox). The target is only read: where origin pushes, and who the developer is.
  const url = await git(ctx, [ 'remote', 'get-url', '--push', 'origin' ], 'Reading the origin remote')
  const repo = ctx.github().repo
  // The repo origin names, before any insteadOf rewrite of where it goes.
  const named = (await ctx.exec([ 'git', 'config', 'remote.origin.pushurl' ])).stdout.trim() || (await ctx.exec([ 'git', 'config', 'remote.origin.url' ])).stdout.trim()
  // owner/repo at the end of either URL, whatever the host: SSH aliases and ssh.github.com included.
  const tail = (u) => u.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase()
  if (![ tail(named), tail(url) ].includes(repo.toLowerCase())) throw new Refusal(`origin pushes to ${named || url}, but this issue is on ${repo}: the wireframes must live in ${repo}, where the Design links them.`)
  const config = async (key) => (await ctx.exec([ 'git', 'config', key ])).stdout.trim()
  const author = { name: await config('user.name'), email: await config('user.email') }
  if (!author.name || !author.email) throw new Refusal('Set your git user.name and user.email: the wireframes commit is yours.')
  const assetsDir = join(dirname(ctx.stateDir()), 'assets.git')
  if (!existsSync(join(assetsDir, 'HEAD'))) await git(ctx, [ 'init', '--quiet', '--bare', assetsDir ], 'Creating the assets repo')
  // The assets repo doesn't see config the target gets from its own file, its
  // includes, or includeIf blocks that match only the target. Carry over what
  // reaching GitHub as the developer depends on (ssh command, credential
  // helpers, http settings, URL rewrites, signing) that the assets repo lacks,
  // in the environment so no secret shows in a process list.
  const configEnv = await carriedConfig(ctx, assetsDir)
  const top = await git(ctx, [ 'rev-parse', '--show-toplevel' ], 'Finding the repo root')
  const a = Object.assign((args, what, opts = {}) => git(ctx, [ '--git-dir', assetsDir, ...args ], what, { cwd: top, ...opts, env: { ...ctx.env, ...configEnv, ...opts.env } }), { dir: assetsDir, top })

  // Build on the branch's last commit, if it has one, and push the new one there.
  const branch = assetsBranch(n)
  const ref = `refs/heads/${branch}`
  const remote = (await a([ 'ls-remote', url, ref ], `Reading ${branch} on origin`)).split(/\s/)[0] || null
  // Fetched by name, which every server allows, into a ref of the assets repo so
  // the next run fetches only what's new; a ref that moved since is refused at push.
  if (remote) await a([ 'fetch', '--quiet', '--no-write-fetch-head', url, `+${ref}:refs/remotes/origin/${branch}` ], `Fetching ${branch}`)
  const commit = await assetsCommit(a, ctx, { n, files, parent: remote, author })
  // Checkpoint tags the commits a posted version pins; a rerender isn't tagged.
  if (commit !== remote) {
    try {
      await a([ 'push', '--quiet', url, `${commit}:${ref}` ], 'push')
    } catch (error) {
      if (new RegExp(`\\[rejected\\][^\\n]*-> ${branch}\\b`).test(error.stderr ?? '')) throw new Refusal(`Someone pushed wireframes for #${n} meanwhile. Run factory-foreman wireframes design again to build on theirs.`)
      throw new Refusal(`Pushing ${branch} failed (this needs network access and the right to push branches to ${repo}): ${error.message.replace(/^push failed: /, '')}`)
    }
  }
  writeFileSync(file, withWireframes(readFileSync(file, 'utf8'), wireframesSection({ repo, commit, files })))
  return {
    out: [ `Rendered ${files.length} wireframe(s) for #${n} and pushed them to ${branch} at ${commit.slice(0, 7)}:`, ...files.map((f) => `- ${f.id} ${f.state}: ${f.png}`), 'The draft\'s Wireframes section links to them at that commit. Review the Design again before you checkpoint it.' ].join('\n'),
    json: { issue: n, commit, branch, files: files.map(({ id, state, png, hash }) => ({ id, state, png, hash })) },
  }
}
