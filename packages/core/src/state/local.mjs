// The developer's private state for one issue, under the clone's common git
// dir so every worktree shares it and nothing is ever committed:
//   $(git rev-parse --git-common-dir)/factory-foreman/<issue>/
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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

export function appendLog(dir, entry) {
  appendFileSync(join(dir, 'log.jsonl'), `${JSON.stringify(entry)}\n`)
}

export function readLog(dir) {
  const file = join(dir, 'log.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [ JSON.parse(line) ]
    } catch {
      return []
    }
  })
}

// Which harness the command runs under, as best the environment tells.
export function detectHarness(env = process.env) {
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code'
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'codex'
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode'
  return 'terminal'
}

// Commands a person must run themselves refuse when an agent could be the one
// typing: no terminal on both ends, or a harness's agent shell.
export function agentShell({ env = process.env, isTTY }) {
  if (!isTTY) return 'there is no interactive terminal'
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) return 'this is Claude Code\'s shell'
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'this is Codex\'s shell'
  return null
}
