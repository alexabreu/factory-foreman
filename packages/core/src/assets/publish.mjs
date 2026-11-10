// Publishes files to the issue's assets-only branch, factory-foreman-assets/<n>:
// wireframes under design/, slice evidence under slices/<n>/iter-<k>/. Each
// publish is one commit, by the developer, on top of the branch's last one, with
// one folder replaced and the rest kept. It's built and pushed from a bare repo
// of its own in the ignored state folder, so nothing is written to the target's
// .git (read-only in Codex's sandbox) and the issue branch never carries assets.
// Links pin the commit, so what a version or iteration shows never changes.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Refusal } from '../errors.mjs'

export const assetsBranch = (n) => `factory-foreman-assets/${n}`
export const pinnedUrl = (repo, commit, path) => `https://github.com/${repo}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}?raw=true`

async function git(ctx, args, what, opts = {}) {
  const result = await ctx.exec([ 'git', ...args ], { timeout: 120_000, ...opts })
  if (result.code !== 0) {
    const why = String(result.stderr).split('\n').filter((l) => l.trim() && !l.startsWith('hint:')).at(-1) ?? ''
    throw new Refusal(`${what} failed: ${why.trim()}`, { stderr: String(result.stderr) })
  }
  return result.stdout.trim()
}

// Config entries the target has and the assets repo wouldn't (its own file, its
// includes, includeIf blocks that match only the target), as GIT_CONFIG_*
// environment variables for git in the assets repo, so no secret shows in a
// process list.
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

// Writes a folder's tree inside a tree: nested folders are replaced level by level.
async function withFolder(a, ctx, mktree, parentTree, parts, leaf) {
  const [ head, ...rest ] = parts
  const entries = parentTree ? (await a([ 'ls-tree', parentTree ], 'Reading the last assets commit')).split('\n').filter(Boolean) : []
  const kept = entries.filter((l) => !l.endsWith(`\t${head}`))
  const existing = entries.find((l) => l.endsWith(`\t${head}`) && l.includes(' tree '))?.split(/\s/)[2] ?? null
  const child = rest.length ? await withFolder(a, ctx, mktree, existing, rest, leaf) : leaf
  return mktree([ ...kept, `040000 tree ${child}\t${head}` ])
}

// files: [{ name, path }] (name is the file's name inside `folder`).
export async function publishAssets(ctx, { n, folder, files, message, what }) {
  const url = await git(ctx, [ 'remote', 'get-url', '--push', 'origin' ], 'Reading the origin remote')
  const repo = ctx.github().repo
  // The repo origin names, before any insteadOf rewrite of where it goes.
  const named = (await ctx.exec([ 'git', 'config', 'remote.origin.pushurl' ])).stdout.trim() || (await ctx.exec([ 'git', 'config', 'remote.origin.url' ])).stdout.trim()
  // owner/repo at the end of either URL, whatever the host: SSH aliases and ssh.github.com included.
  const tail = (u) => u.match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase()
  if (![ tail(named), tail(url) ].includes(repo.toLowerCase())) throw new Refusal(`origin pushes to ${named || url}, but this issue is on ${repo}: ${what} must live in ${repo}, where they're linked.`)
  const config = async (key) => (await ctx.exec([ 'git', 'config', key ])).stdout.trim()
  const author = { name: await config('user.name'), email: await config('user.email') }
  if (!author.name || !author.email) throw new Refusal(`Set your git user.name and user.email: the commit of ${what} is yours.`)
  const assetsDir = join(dirname(ctx.stateDir()), 'assets.git')
  if (!existsSync(join(assetsDir, 'HEAD'))) await git(ctx, [ 'init', '--quiet', '--bare', assetsDir ], 'Creating the assets repo')
  const configEnv = await carriedConfig(ctx, assetsDir)
  const top = await git(ctx, [ 'rev-parse', '--show-toplevel' ], 'Finding the repo root')
  const a = (args, w, opts = {}) => git(ctx, [ '--git-dir', assetsDir, ...args ], w, { cwd: top, ...opts, env: { ...ctx.env, ...configEnv, ...opts.env } })

  // Build on the branch's last commit, if it has one.
  const branch = assetsBranch(n)
  const ref = `refs/heads/${branch}`
  const remote = (await a([ 'ls-remote', url, ref ], `Reading ${branch} on origin`)).split(/\s/)[0] || null
  // Fetched by name, which every server allows, into a ref of the assets repo so
  // the next run fetches only what's new; a ref that moved since is refused at push.
  if (remote) await a([ 'fetch', '--quiet', '--no-write-fetch-head', url, `+${ref}:refs/remotes/origin/${branch}` ], `Fetching ${branch}`)

  const mktree = async (lines) => {
    const result = await ctx.exec([ 'git', '--git-dir', assetsDir, 'mktree' ], { cwd: top, input: lines.length ? `${lines.join('\n')}\n` : '' })
    if (result.code !== 0) throw new Refusal(`Building the commit of ${what} failed: ${String(result.stderr).trim()}`)
    return result.stdout.trim()
  }
  const entries = []
  const names = new Set()
  for (const f of files) {
    if (!/^[\w.-]+$/.test(f.name) || /^\.+$/.test(f.name)) throw new Refusal(`${f.name} isn't a plain file name.`)
    if (names.has(f.name)) throw new Refusal(`Two files are both called ${f.name}; each needs its own name.`)
    names.add(f.name)
    entries.push(`100644 blob ${await a([ 'hash-object', '-w', '--', f.path ], `Storing ${f.name}`)}\t${f.name}`)
  }
  const leaf = await mktree(entries)
  const parentTree = remote ? await a([ 'rev-parse', `${remote}^{tree}` ], 'Reading the last assets commit') : null
  const tree = await withFolder(a, ctx, mktree, parentTree, folder.split('/'), leaf)
  let commit = remote
  if (!remote || tree !== parentTree) {
    const env = { ...ctx.env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email }
    // Signed when the developer signs their commits, for repos whose rules require it.
    const sign = (await ctx.exec([ 'git', 'config', '--bool', 'commit.gpgsign' ])).stdout.trim() === 'true'
    // [skip ci]: the assets branch has no code for a workflow to build.
    commit = await a([ 'commit-tree', ...(sign ? [ '-S' ] : []), tree, ...(remote ? [ '-p', remote ] : []), '-m', `${message} [skip ci]` ], `Committing ${what}`, { env })
    try {
      await a([ 'push', '--quiet', url, `${commit}:${ref}` ], 'push')
    } catch (error) {
      if (new RegExp(`\\[rejected\\][^\\n]*-> ${branch}\\b`).test(error.stderr ?? '')) throw new Refusal(`Someone pushed to ${branch} meanwhile. Run it again to build on theirs.`)
      throw new Refusal(`Pushing ${branch} failed (this needs network access and the right to push branches to ${repo}): ${error.message.replace(/^push failed: /, '')}`)
    }
  }
  return { commit, branch, repo, url: (name) => pinnedUrl(repo, commit, `${folder}/${name}`) }
}
