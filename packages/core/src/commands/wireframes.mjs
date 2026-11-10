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
import { assetsBranch, carriedConfig, publishAssets } from '../assets/publish.mjs'
import { Refusal } from '../errors.mjs'
import { readDraftFile } from '../review/briefs.mjs'
import { inCodexSandbox } from '../state/local.mjs'
import { FENCE, closes, parseDraft, splitFrontMatter, wireframePath, withFrontMatter } from '../steps/structure.mjs'
import { approvedBody, loadIssue } from './common.mjs'

// Where the pages and images sit in the assets commit.
export const ASSETS = 'design'
export { assetsBranch, carriedConfig }
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

export async function wireframes(ctx, { positionals, flags }) {
  if (positionals[0] !== 'design') throw new Refusal('Wireframes belong to a Design: factory-foreman wireframes design.')
  const n = ctx.issue()
  const file = flags.draft ?? ctx.draftPath('design')
  readDraftFile(file, 'design')
  // Chrome can't start inside Codex's sandbox (see the README's known
  // limitations). Pages are checked first, so what the person runs works.
  const sandboxed = inCodexSandbox(ctx.env)
  if (sandboxed) {
    const dir = wireframesDir(ctx.stateDir())
    const { files, problems } = wireframeFiles(dir)
    for (const f of files) {
      const why = notSelfContained(readFileSync(f.html, 'utf8'))
      if (why) problems.push(`${f.name} isn't self-contained: ${why}.`)
    }
    if (!files.length && !problems.length) problems.push(`There are no wireframes to render: write them in ${dir}.`)
    if (problems.length) throw new Refusal(`The wireframes can't be rendered yet:\n  - ${problems.join('\n  - ')}`, { problems })
    const command = `cd ${JSON.stringify(ctx.cwd)} && factory-foreman wireframes design --issue ${n}${flags.draft ? ` --draft ${JSON.stringify(flags.draft)}` : ''}`
    throw new Refusal(`Wireframes can't be rendered inside Codex's sandbox: Chrome can't start there. Ask the person to run this in their own terminal, then re-read the draft, which it updates, and carry on: ${command}`, { command })
  }
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

  // Pages and images go to the assets-only branch under design/, built and
  // pushed without touching the checkout or its .git (see assets/publish.mjs).
  const published = await publishAssets(ctx, { n, folder: ASSETS, files: files.flatMap((f) => [ { name: f.name, path: f.html }, { name: f.name.replace(/\.html$/, '.png'), path: f.png } ]), message: `Wireframes for the Design of #${n}`, what: 'the wireframes' })
  const { commit, branch, repo } = published
  writeFileSync(file, withWireframes(readFileSync(file, 'utf8'), wireframesSection({ repo, commit, files })))
  return {
    out: [ `Rendered ${files.length} wireframe(s) for #${n} and pushed them to ${branch} at ${commit.slice(0, 7)}:`, ...files.map((f) => `- ${f.id} ${f.state}: ${f.png}`), 'The draft\'s Wireframes section links to them at that commit. Review the Design again before you checkpoint it.' ].join('\n'),
    json: { issue: n, commit, branch, files: files.map(({ id, state, png, hash }) => ({ id, state, png, hash })) },
  }
}
