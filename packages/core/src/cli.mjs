#!/usr/bin/env node
// factory-foreman command line. Each command prints a short summary, or JSON
// with --json. A refusal exits with code 2 and names what is missing; any
// other error exits with code 1.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { issueNumber, parseArgs } from './args.mjs'
import { approve } from './commands/approve.mjs'
import { amend, checkpoint } from './commands/checkpoint.mjs'
import { draft } from './commands/draft.mjs'
import { note } from './commands/note.mjs'
import { review } from './commands/review.mjs'
import { status } from './commands/status.mjs'
import { loadConfig } from './config/load.mjs'
import { Refusal } from './errors.mjs'
import { appTokens, readApp } from './github/app.mjs'
import { createGitHub, ghRunner } from './github/gh.mjs'
import { detectHarness, draftPath, gitCommonDir, stateDir } from './state/local.mjs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

export const COMMANDS = { note, draft, review, checkpoint, amend, approve, status }

const HELP = `factory-foreman ${version}

  note "<text>" [--kind decision|rejected|question] [--blocking] [--step s] [--slice n]
  note --keep <id> | --drop <id> | --edit <id> "<text>"
  note --extract --transcript <path> [--session <id>] [--event <name>]   (from session hooks)
  draft <shape|design> [--reset]
  review <shape|design> [--draft <file>] [--headless]
  review save <shape|design> --findings <file> [--draft <file>]
  checkpoint <shape|design> [--draft <file>]
  amend <shape|design> --reason "<why>" [--draft <file>]
  approve <shape|design> v<N>          (a person, in their own terminal)
  status

Every issue command takes --issue <n>, or reads it from a factory-foreman/<n> branch.
Add --json for machine-readable output.`

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }).trim()
  } catch {
    return ''
  }
}

// owner/repo from git@github.com:owner/repo.git or https://github.com/owner/repo(.git)
export function repoFromRemote(url) {
  return url.match(/(?:^|@|\/\/)github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? null
}

// The real context: the target repo in cwd, gh for GitHub, the App for factory writes.
export function context({ cwd = process.cwd(), env = process.env, flags = {} } = {}) {
  const once = (fn) => { let value; let done = false; return () => (done ? value : ((done = true), (value = fn()))) }
  const root = once(() => { gitCommonDir(cwd); return git(cwd, [ 'rev-parse', '--show-toplevel' ]) || cwd })
  const issue = once(() => {
    const n = issueNumber(flags, git(cwd, [ 'branch', '--show-current' ]))
    if (!n) throw new Refusal('Which issue? Pass --issue <n>, or work on a factory-foreman/<n> branch.')
    return n
  })
  const github = once(() => {
    const run = ghRunner({ env, cwd })
    const repo = env.FACTORY_FOREMAN_REPO || repoFromRemote(git(cwd, [ 'remote', 'get-url', 'origin' ]))
    if (!repo) throw new Refusal('Can\'t tell the GitHub repo: origin isn\'t a github.com remote. Set FACTORY_FOREMAN_REPO=<owner>/<repo>.')
    const app = readApp(env)
    return createGitHub({ repo, run, appToken: app ? appTokens({ app }) : null, botLogin: app?.botLogin ?? null })
  })
  return {
    cwd,
    env,
    harness: detectHarness(env),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    now: () => new Date(),
    config: once(() => loadConfig(root())),
    issue,
    stateDir: once(() => stateDir(cwd, issue())),
    draftPath: (step) => draftPath(stateDir(cwd, issue()), step),
    author: () => git(cwd, [ 'config', 'user.name' ]) || env.USER || 'unknown',
    github,
    // Runs a command with no shell, collecting its output.
    exec: (argv, { cwd: dir = cwd, env: childEnv = env, input } = {}) => new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), { cwd: dir, env: childEnv, stdio: [ input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe' ] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d })
      child.stderr.on('data', (d) => { stderr += d })
      child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }))
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
      if (input !== undefined) child.stdin.end(input)
    }),
    async prompt(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await rl.question(question)
      } finally {
        rl.close()
      }
    },
  }
}

export async function main(argv, makeContext = context) {
  const [ command, ...rest ] = argv
  if (command === '--version' || command === 'version') return { code: 0, out: version }
  if (!command || command === '--help' || command === 'help') return { code: 0, out: HELP }
  const run = COMMANDS[command]
  if (!run) return { code: 1, err: `Unknown command "${command}". Run factory-foreman --help.` }
  const args = parseArgs(rest, { booleans: [ 'json', 'blocking', 'reset', 'extract', 'headless' ] })
  try {
    const ctx = makeContext({ flags: args.flags })
    const result = await run(ctx, args)
    return { code: 0, out: args.flags.json ? JSON.stringify(result.json, null, 2) : result.out, ...(result.err ? { err: result.err } : {}) }
  } catch (error) {
    if (error instanceof Refusal) {
      return { code: 2, err: args.flags.json ? JSON.stringify({ refused: error.message, ...error.details }, null, 2) : `Refused: ${error.message}` }
    }
    return { code: 1, err: `Error: ${error.message}` }
  }
}

if (import.meta.main) {
  const { code, out, err } = await main(process.argv.slice(2))
  if (out) process.stdout.write(`${out}\n`)
  if (err) process.stderr.write(`${err}\n`)
  process.exitCode = code
}
