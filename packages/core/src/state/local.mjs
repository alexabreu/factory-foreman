// The developer's private state for one issue, under the clone's common git
// dir so every worktree shares it and nothing is ever committed:
//   $(git rev-parse --git-common-dir)/factory-foreman/<issue>/
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Refusal } from '../errors.mjs'

export function gitCommonDir(cwd) {
  try {
    return resolve(cwd, execFileSync('git', [ 'rev-parse', '--git-common-dir' ], { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }).trim())
  } catch {
    throw new Refusal(`${cwd} is not inside a git repository.`)
  }
}

export function stateDir(cwd, issue) {
  const dir = join(gitCommonDir(cwd), 'factory-foreman', String(issue))
  mkdirSync(join(dir, 'drafts'), { recursive: true })
  return dir
}

export const draftPath = (dir, step) => join(dir, 'drafts', `${step}.md`)

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
// harness started from another inherits its variables, so the innermost one
// wins: Codex sets CODEX_TOOL_CALL_ID on each shell call it makes, which a
// Claude Code shell started from Codex wouldn't carry fresh, and vice versa.
const inCodex = (env) => Boolean(env.CODEX_TOOL_CALL_ID)
const inClaude = (env) => env.CLAUDECODE === '1' || Boolean(env.CLAUDE_CODE_ENTRYPOINT)
export function detectHarness(env = process.env) {
  if (inCodex(env)) return 'codex'
  if (inClaude(env)) return 'claude-code'
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'codex'
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode'
  return 'terminal'
}

// Commands a person must run themselves refuse when an agent could be the one
// typing: no terminal on both ends, or a harness's agent shell.
export function agentShell({ env = process.env, isTTY }) {
  if (!isTTY) return 'there is no interactive terminal'
  if (inCodex(env)) return 'this is Codex\'s shell'
  if (inClaude(env)) return 'this is Claude Code\'s shell'
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'this is Codex\'s shell'
  return null
}
