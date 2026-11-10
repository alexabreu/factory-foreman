// git through ctx.exec, so tests can run it for real or stub it.
import { rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Refusal } from '../errors.mjs'

export async function git(ctx, args, what, opts = {}) {
  const result = await ctx.exec([ 'git', ...args ], { timeout: 120_000, ...opts })
  if (result.code !== 0) {
    const why = String(result.stderr).split('\n').filter((l) => l.trim() && !l.startsWith('hint:')).at(-1) ?? ''
    throw new Refusal(`${what} failed: ${why.trim()}`, { stderr: String(result.stderr) })
  }
  return result.stdout.replace(/\n$/, '')
}

// True when the command succeeds (exit 0), false when it exits 1 (git's "no").
export async function gitTest(ctx, args, opts = {}) {
  const result = await ctx.exec([ 'git', ...args ], { timeout: 120_000, ...opts })
  return result.code === 0
}

export const head = (ctx) => git(ctx, [ 'rev-parse', 'HEAD' ], 'Reading HEAD')
export const currentBranch = (ctx) => git(ctx, [ 'branch', '--show-current' ], 'Reading the branch')
export const topLevel = (ctx) => git(ctx, [ 'rev-parse', '--show-toplevel' ], 'Finding the repo root')

export async function changedFiles(ctx, base, tip, filter = '') {
  const out = await git(ctx, [ 'diff', '--name-only', '--no-renames', ...(filter ? [ `--diff-filter=${filter}` ] : []), `${base}..${tip}` ], 'Listing the changed files')
  return out.split('\n').filter(Boolean)
}

// Lines added plus deleted per file; binary files count as 0.
export async function lineCounts(ctx, base, tip) {
  const out = await git(ctx, [ 'diff', '--numstat', '--no-renames', `${base}..${tip}` ], 'Counting changed lines')
  return out.split('\n').filter(Boolean).map((l) => {
    const [ added, deleted, path ] = l.split('\t')
    return { path, lines: (Number(added) || 0) + (Number(deleted) || 0) }
  })
}

export async function fileAt(ctx, sha, path) {
  const result = await ctx.exec([ 'git', 'show', `${sha}:${path}` ], { timeout: 60_000 })
  return result.code === 0 ? result.stdout : null
}

// Committing writes to .git, which Codex's sandbox makes read-only unless the
// person adds it as a writable root.
export async function requireWritableGit(ctx, what) {
  const dir = resolve(ctx.cwd, await git(ctx, [ 'rev-parse', '--git-common-dir' ], 'Finding .git'))
  // A sandbox can refuse a write the file's permissions allow, so try one.
  const probe = join(dir, `.factory-foreman-probe-${process.pid}`)
  try {
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
  } catch {
    throw new Refusal(`${what} commits and pushes, which needs ${dir} writable. Inside Codex's sandbox it's read-only: the person adds it as a writable root (or runs this from their own terminal).`)
  }
}
