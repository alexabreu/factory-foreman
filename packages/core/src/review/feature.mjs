// The whole feature as it will ship: every file it touches against the base
// branch. Slice reviews read it so a slice is judged in the code around it,
// not as a diff alone; the feature review reads it before the feature goes to
// the base branch.
import { Refusal } from '../errors.mjs'
import { changedFiles, gitTest } from '../util/git.mjs'

const short = (sha) => String(sha).slice(0, 7)
const exists = (ctx, ref) => gitTest(ctx, [ 'rev-parse', '--verify', '--quiet', `${ref}^{commit}` ])

// The base branch to read the feature against, fetched when it's on origin.
// origin/HEAD (the default) is only set by a clone or git remote set-head, so
// without it the usual names stand in. Null when none is here; otherwise the
// ref and whether it was refreshed from origin.
export async function resolveBase(ctx, configured) {
  let ref = configured
  if (ref === 'origin/HEAD') {
    const named = (await ctx.exec([ 'git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD' ], { timeout: 60_000 })).stdout?.trim()
    if (named) ref = named
    else {
      ref = null
      for (const name of [ 'origin/main', 'origin/master', 'main', 'master' ]) if (await exists(ctx, name)) { ref = name; break }
      if (!ref) return null
    }
  }
  // A stale remote-tracking base would put others' merged work in the feature.
  // Never prompt for credentials; a fetch that can't run (offline, a read-only
  // .git) leaves the copy here, and says so.
  const remote = ref.match(/^origin\/(.+)$/)?.[1]
  const refreshed = remote ? await gitTest(ctx, [ 'fetch', '--quiet', 'origin', `+refs/heads/${remote}:refs/remotes/origin/${remote}` ], { timeout: 30_000, env: { ...ctx.env, GIT_TERMINAL_PROMPT: '0' } }) : false
  return (await exists(ctx, ref)) ? { ref, refreshed } : null
}

// Where the feature forks from the base, and the files it touches up to tip.
// refreshed says whether the base was fetched from origin just now.
export async function featureScope(ctx, { baseBranch, tip }) {
  const resolved = await resolveBase(ctx, baseBranch)
  if (!resolved) throw new Refusal(`Can't find the base branch ${baseBranch}${baseBranch === 'origin/HEAD' ? ' (or origin/main, origin/master, main, master)' : ''} here, so the whole feature can't be read against it. Fetch it, or set baseBranch in factory-foreman.config.json to the branch features merge into.`)
  const { ref: base, refreshed } = resolved
  const fork = await ctx.exec([ 'git', 'merge-base', base, tip ], { timeout: 120_000 })
  if (fork.code !== 0) throw new Refusal(`${short(tip)} has no history in common with ${base}; set baseBranch in factory-foreman.config.json to the branch features merge into.`)
  const sha = fork.stdout.trim()
  return { baseBranch: base, refreshed, fork: sha, tip, files: await changedFiles(ctx, sha, tip, 'd'), deleted: await changedFiles(ctx, sha, tip, 'D') }
}

// What a reviewer reads to see the whole feature.
export const readWhole = ({ baseBranch, fork, tip, files, deleted = [] }) => [
  `Read every file the feature touches in full, as it is at ${short(tip)}, and the code on ${baseBranch} it should reuse rather than copy. git diff ${short(fork)}..${short(tip)} is the whole feature's change against ${baseBranch}.`,
  '',
  `Files the feature touches (against ${baseBranch} at ${short(fork)}):`,
  ...(files.length ? files.map((f) => `- ${f}`) : [ '- (none yet)' ]),
  ...(deleted.length ? [ '', 'Files it deletes:', ...deleted.map((f) => `- ${f}`) ] : []),
]
