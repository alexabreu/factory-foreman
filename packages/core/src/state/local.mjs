// The developer's private state for one issue: drafts, the decision log,
// saved reviews and capture markers, in the working tree at
//   <worktree>/.factory-foreman/<issue>/
// Harnesses keep agents out of .git (Claude Code refuses edits there; Codex's
// sandbox makes it read-only), so nothing is ever written under .git. The
// folder ignores itself with its own .gitignore, so it never shows as a change
// and is never committed. State is per checkout, and git clean -dx removes it.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Refusal } from '../errors.mjs'

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }).trim()

export function gitCommonDir(cwd) {
  try {
    return resolve(cwd, git(cwd, [ 'rev-parse', '--git-common-dir' ]))
  } catch {
    throw new Refusal(`${cwd} is not inside a git repository.`)
  }
}

export function stateRoot(cwd) {
  let root
  try {
    root = git(cwd, [ 'rev-parse', '--show-toplevel' ])
  } catch {
    throw new Refusal(`${cwd} is not inside a git work tree; factory-foreman keeps its state in one.`)
  }
  const top = join(root, '.factory-foreman')
  try {
    mkdirSync(top, { recursive: true })
  } catch (error) {
    throw new Refusal(`Can't keep factory-foreman's state at ${top}: ${error.message}`)
  }
  const ignore = join(top, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '# factory-foreman state: drafts, notes, reviews. Never committed.\n*\n')
  return top
}

export function stateDir(cwd, issue) {
  const dir = join(stateRoot(cwd), String(issue))
  mkdirSync(dir, { recursive: true })
  migrate(cwd, issue, dir)
  return dir
}

// State from before it moved out of .git is copied into each checkout once.
// Copying only reads .git, so it works where .git is read-only too. It copies
// file by file, never overwrites, skips anything odd, and always records that
// it ran, so a damaged old layout can't block the issue.
function migrate(cwd, issue, dir) {
  const done = join(dir, '.migrated')
  if (existsSync(done)) return
  let old = null
  try {
    old = join(gitCommonDir(cwd), 'factory-foreman', String(issue))
    const file = (from, to) => {
      try {
        if (statSync(from).isFile()) copyFileSync(from, to, constants.COPYFILE_EXCL)
      } catch { /* missing, unreadable, or already there: skip it */ }
    }
    const folder = (name, keep) => {
      let names
      try { names = readdirSync(join(old, name)) } catch { return }
      mkdirSync(join(dir, name), { recursive: true })
      for (const entry of names.filter(keep)) file(join(old, name, entry), join(dir, name, entry))
    }
    if (existsSync(old)) {
      file(join(old, 'log.jsonl'), join(dir, 'log.jsonl'))
      folder('reviews', (n) => n.endsWith('.json'))
      folder('capture', (n) => n.endsWith('.json'))
      for (const step of [ 'shape', 'design' ]) file(join(old, 'drafts', `${step}.md`), join(dir, `${step}.md`))
    }
  } catch { /* no old state to read */ } finally {
    try { writeFileSync(done, `${old ?? ''}\n`) } catch { /* try again next time */ }
  }
}

export const worktreeDraftPath = (cwd, issue, step) => join(stateDir(cwd, issue), `${step}.md`)

export const KINDS = [ 'decision', 'rejected', 'question' ]

// The log is append-only, so a hook and a command writing at once can't lose
// each other's lines. Entries get a short id; keeping, editing or dropping one
// appends an op ({ "op": "keep", "id": … }) that readLog applies in order.
export const newId = () => randomBytes(4).toString('hex')

export function appendLog(dir, entry) {
  appendFileSync(join(dir, 'log.jsonl'), `${JSON.stringify(entry)}\n`)
}

export function readLog(dir, { includeDropped = false } = {}) {
  const file = join(dir, 'log.jsonl')
  if (!existsSync(file)) return []
  const entries = []
  const byId = new Map()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (!item || typeof item !== 'object') continue
    if (item.op) {
      const target = byId.get(item.id)
      if (!target) continue
      if (item.op === 'keep') target.confirmed = true
      else if (item.op === 'drop') target.dropped = true
      else if (item.op === 'edit' && typeof item.text === 'string' && item.text.trim()) { target.text = item.text.trim(); target.confirmed = true }
      continue
    }
    const entry = { ...item }
    entries.push(entry)
    if (typeof entry.id === 'string') byId.set(entry.id, entry)
  }
  return includeDropped ? entries : entries.filter((e) => !e.dropped)
}

// Where capture last stopped reading a session's transcript: one file per
// session, so sessions sharing a clone never overwrite each other's place.
const captureFile = (dir, key, ext) => {
  mkdirSync(join(dir, 'capture'), { recursive: true })
  return join(dir, 'capture', `${key.replace(/[^\w.-]/g, '_').slice(0, 120)}.${ext}`)
}

export function readMarker(dir, key) {
  try {
    return JSON.parse(readFileSync(captureFile(dir, key, 'json'), 'utf8'))
  } catch {
    return null
  }
}

export function writeMarker(dir, key, marker) {
  const file = captureFile(dir, key, 'json')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`)
  renameSync(tmp, file)
}

// Claims a session's transcript for one capture at a time. Returns a release
// function, or null when another capture holds it (a claim older than ten
// minutes is a crashed run's, and is taken over).
export function claimCapture(dir, key, now = Date.now()) {
  const file = captureFile(dir, key, 'lock')
  const token = newId()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      writeFileSync(fd, token)
      closeSync(fd)
      // Release only our own claim: a run that took over a stale one owns it now.
      return () => { try { if (readFileSync(file, 'utf8') === token) unlinkSync(file) } catch { /* already gone */ } }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let age = Infinity
      try { age = now - statSync(file).mtimeMs } catch { /* released meanwhile */ }
      if (age < 10 * 60_000) return null
      try { unlinkSync(file) } catch { /* someone else took it over */ }
    }
  }
  return null
}

// Which harness the command runs under, as best the environment tells. A
// harness started from another inherits its variables. Codex sets
// CODEX_TOOL_CALL_ID on each shell call it makes, so Codex started from Claude
// Code is detected as Codex; Claude Code started from Codex is reported as
// Codex too. Only Codex's runtime variables count: a person's own shell may
// export configuration such as CODEX_HOME.
const inCodex = (env) => env.CODEX_TOOL_CALL_ID !== undefined
const inClaude = (env) => env.CLAUDECODE === '1' || Boolean(env.CLAUDE_CODE_ENTRYPOINT)
const codexRuntime = (env) => [ 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_CI' ].some((k) => env[k] !== undefined)
// Inside Codex's sandbox: a Codex shell call, or anything started from one
// (Claude Code included), as Codex marks both.
export const inCodexSandbox = (env = process.env) => env.CODEX_SANDBOX !== undefined || env.CODEX_TOOL_CALL_ID !== undefined

// A session with no person in it: a headless agent (claude -p and the SDK set
// an "sdk-…" entrypoint; codex exec sets CODEX_CI) or CI. Notes extracted
// there are left for a person to confirm.
export const noPersonInLoop = (env = process.env) => /^sdk/.test(env.CLAUDE_CODE_ENTRYPOINT ?? '') || env.CODEX_CI !== undefined || /^(1|true)$/i.test(env.CI ?? '')

export function detectHarness(env = process.env) {
  if (inCodex(env)) return 'codex'
  if (inClaude(env)) return 'claude-code'
  if (codexRuntime(env)) return 'codex'
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode'
  return 'terminal'
}

// Commands a person must run themselves refuse when an agent could be the one
// typing: no terminal on both ends, or a harness's agent shell.
export function agentShell({ env = process.env, isTTY }) {
  if (!isTTY) return 'there is no interactive terminal'
  if (inCodex(env)) return 'this is Codex\'s shell'
  if (inClaude(env)) return 'this is Claude Code\'s shell'
  if (codexRuntime(env)) return 'this is Codex\'s shell'
  return null
}
