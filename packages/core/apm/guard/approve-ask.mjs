// Approving from a Claude Code chat: instead of refusing `factory-foreman
// approve …` or `slice merge …` in the agent's shell, the guard has Claude
// Code ask the person, in the chat, with what the command would do.
//
// The CLI does the real work (src/approval/ask.mjs there): run with
// --ask-ticket, it checks everything, writes a one-shot ticket for exactly
// this command, and describes it. This file only shows that description in
// Claude Code's permission prompt and has the command carry the ticket.
//
// The agent's text never reaches a shell here: the hook runs the CLI it finds
// itself, with the command's arguments as plain words, before anyone is asked.
//
// Claude Code only. Codex runs a command whose hook says "ask" instead of
// asking, so anything not plainly Claude Code is refused as before. So are
// modes where Claude Code wouldn't ask.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// Modes where Claude Code is known to ask the person. Auto mode is left out until a live
// check shows its classifier never settles the hook's "ask" on the person's behalf.
const ASKS = [ 'default', 'acceptEdits', 'plan' ]
// Where the CLI keeps tickets; the CLI owns this path (src/approval/ask.mjs).
const asksDir = () => process.env.FACTORY_FOREMAN_ASKS_DIR || join(homedir(), '.factory-foreman', 'asks')
const NONCE = /^[a-f0-9]{32}$/
// The command that runs after Allow is the CLI the hook described with, by path, so both are the same program.
const quote = (w) => (/^[\w./=:@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`)

// Claude Code sets CLAUDE_PROJECT_DIR for its command hooks; Codex's payload carries turn_id and model.
export const fromClaudeCode = (p) => process.env.CLAUDE_PROJECT_DIR !== undefined && typeof p?.tool_use_id === 'string' && typeof p?.transcript_path === 'string' &&
  typeof p?.permission_mode === 'string' && p.turn_id === undefined && p.model === undefined && ![ 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX' ].some((k) => process.env[k] !== undefined)

// The CLI's arguments when the words are one plain factory-foreman command, else null.
// Accepted: factory-foreman …, npx factory-foreman …, pnpm exec factory-foreman …, <…>/node_modules/.bin/factory-foreman ….
function cliArgs(words) {
  const at = words[0] === 'factory-foreman' || /(^|\/)node_modules\/\.bin\/factory-foreman$/.test(words[0] ?? '') ? 1
    : words[0] === 'npx' && words[1] === 'factory-foreman' ? 2 : words[0] === 'pnpm' && words[1] === 'exec' && words[2] === 'factory-foreman' ? 3 : -1
  const rest = at === -1 ? null : words.slice(at)
  return rest && !rest.some((w) => /[$`]|^--ask-ticket/.test(w)) ? rest : null
}
const plain = (command, lex) => {
  // Outside quotes, nothing a shell would treat as a separator, group, redirect or substitution.
  if (/[;&|()<>#\n$`\\]/.test(command.replace(/'[^']*'|"[^"\\$`]*"/g, ''))) return null
  const nested = []
  const cmds = lex(command, nested)
  return cmds.length === 1 && !nested.length ? cliArgs(cmds[0]) : null
}
const PLAIN = 'To be asked about it in the chat, run the approval or merge as one plain command: `factory-foreman approve …` (or slice merge), with nothing before it and no chains, pipes, redirects, variables or comments.'
const modeRefusal = (mode) => `In ${mode} mode Claude Code wouldn't ask you, so approvals and merges are refused here. Switch to default mode, or run it in your own terminal.`

// The CLI the hook runs: the person's choice (FACTORY_FOREMAN_CLI) or the one on
// Claude Code's own PATH. Never one in the repo, which the agent could have
// replaced, since the hook runs outside the agent's sandbox.
function findCli() {
  const runnable = (f) => { try { accessSync(f, constants.X_OK); return true } catch { return false } }
  const candidates = [ process.env.FACTORY_FOREMAN_CLI, ...(process.env.PATH ?? '').split(delimiter).filter((d) => d.startsWith('/')).map((d) => join(d, 'factory-foreman')) ]
  return candidates.find((f) => f && runnable(f)) ?? null
}
// Claude Code's environment, without what makes Node load other code.
const cleanEnv = (extra) => Object.fromEntries([ ...Object.entries(process.env).filter(([ k ]) => !/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*)$/.test(k)), ...Object.entries(extra) ])

// A command carrying a ticket (the hook's rewrite, if Claude Code checks it
// again, or anyone repeating it) is asked about again, with the ticket's own
// description: a ticket alone never approves without a person answering.
function askAgain(payload, nonce) {
  let summary = 'a factory-foreman approval or merge'
  try { summary = JSON.parse(readFileSync(join(asksDir(), `${nonce}.json`), 'utf8')).summary ?? summary } catch { /* described by the command alone */ }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `${summary}\n\nAllow confirms it as you: it's posted under your GitHub login. Deny leaves it undone.` } }
}

function chatAsk(payload, args) {
  if (!/^[\w-]{1,128}$/.test(payload.tool_use_id)) return { refuse: 'The tool call id looks wrong, so the approval can\'t be tied to it.' }
  const cli = findCli()
  if (!cli) return { refuse: 'The approve hook can\'t find factory-foreman on Claude Code\'s PATH (or FACTORY_FOREMAN_CLI), so it can\'t ask you about this.' }
  // The CLI describes what would happen and writes the ticket. It reads GitHub, so allow time.
  const run = spawnSync(cli, [ ...args, '--ask-ticket', payload.tool_use_id ], { cwd: payload.cwd, env: cleanEnv({ FACTORY_FOREMAN_ASK_SESSION: String(payload.session_id ?? '') }), encoding: 'utf8', timeout: 60_000, shell: false })
  if (run.status !== 0) return { refuse: String(run.stderr || run.stdout || run.error?.message || `it exited with code ${run.status}`).trim().replace(/^Refused: /, '').split('\n').slice(0, 12).join('\n') }
  let said
  try { said = JSON.parse(run.stdout) } catch { return { refuse: 'factory-foreman didn\'t say what it would do, so you can\'t be asked about it.' } }
  if (!NONCE.test(said?.nonce ?? '') || typeof said.summary !== 'string') return { refuse: 'factory-foreman\'s description was malformed.' }
  return { ask: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `${said.summary}\n\nAllow confirms it as you: it's posted under your GitHub login. Deny leaves it undone.`, updatedInput: { ...payload.tool_input, command: `FACTORY_FOREMAN_ASK=${said.nonce} ${[ cli, ...args ].map(quote).join(' ')}` } } } }
}

// The chat's answer for a command, or null to leave it to the guard's own rules.
export function chatDecision(payload, command, reason, { lex }) {
  if (!fromClaudeCode(payload)) return null
  const ticket = /^FACTORY_FOREMAN_ASK=([a-f0-9]{32}) (.*)$/s.exec(command ?? '')
  if (ticket && !/FACTORY_FOREMAN_ASK/.test(ticket[2]) && existsSync(join(asksDir(), `${ticket[1]}.json`))) {
    if (!ASKS.includes(payload.permission_mode)) return { refuse: modeRefusal(payload.permission_mode) }
    return plain(ticket[2], lex) ? { ask: askAgain(payload, ticket[1]) } : { refuse: PLAIN }
  }
  if (!/^factory-foreman (approve|slice merge) is for a person/.test(reason ?? '')) return null
  if (!ASKS.includes(payload.permission_mode)) return { refuse: modeRefusal(payload.permission_mode) }
  const args = plain(command, lex)
  return args ? chatAsk(payload, args) : { refuse: PLAIN }
}
