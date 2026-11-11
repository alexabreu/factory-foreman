// Approving from a Claude Code chat: instead of refusing `factory-foreman
// approve …` or `slice merge …` in the agent's shell, the guard has Claude
// Code ask the person, in the chat, with what the command would do.
//
// The CLI does the real work (see src/approval/ask.mjs there): run with
// --ask-ticket, it checks everything, writes a one-shot ticket for exactly
// this command, and describes it. This file only shows that description in
// Claude Code's permission prompt and has the command carry the ticket.
//
// Claude Code only. Codex runs a command whose hook says "ask" instead of
// asking, so a Codex payload (or anything not plainly Claude Code's) is
// refused as before. So are modes where Claude Code wouldn't ask.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ASKS = ['default', 'acceptEdits', 'plan', 'auto']
// Where the CLI keeps tickets; the CLI owns this path (src/approval/ask.mjs).
const asksDir = () => process.env.FACTORY_FOREMAN_ASKS_DIR || join(homedir(), '.factory-foreman', 'asks')

// A Claude Code PreToolUse payload, and not Codex's (which carries turn_id and model).
export const fromClaudeCode = (p) => typeof p?.tool_use_id === 'string' && typeof p?.transcript_path === 'string' && typeof p?.permission_mode === 'string' &&
  p.turn_id === undefined && p.model === undefined && ![ 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX' ].some((k) => process.env[k] !== undefined)

// A command carrying a ticket (the hook's rewrite, if Claude Code checks it
// again, or anyone repeating it) is asked about again: a ticket alone never
// approves without a person answering a prompt.
export const carriesTicket = (command) => {
  const m = /^FACTORY_FOREMAN_ASK=([a-f0-9]{32}) (?!.*FACTORY_FOREMAN_ASK)/.exec(command ?? '')
  return Boolean(m && existsSync(join(asksDir(), `${m[1]}.json`)))
}
export const askAgain = (payload) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `Confirm this factory-foreman approval or merge as you (posted under your GitHub login)?\n${payload.tool_input.command}` } })

// { refuse } with why, or { ask } with the hook's JSON reply.
export function chatAsk(payload, { lex }) {
  const command = payload.tool_input.command
  if (!ASKS.includes(payload.permission_mode)) return { refuse: `In ${payload.permission_mode} mode Claude Code wouldn't ask you, so approvals and merges are refused here. Switch to default or auto mode, or run it in your own terminal.` }
  const nested = []
  const cmds = lex(command, nested)
  if (cmds.length !== 1 || nested.length || /[#\n]/.test(command) || cmds[0].some((w) => /^\d*[<>]/.test(w))) return { refuse: 'To be asked about it in the chat, run the approval or merge as one plain command: no chains, pipes, redirects, substitutions or comments.' }
  if (!/^[\w-]{1,128}$/.test(payload.tool_use_id)) return { refuse: 'The tool call id looks wrong, so the approval can\'t be tied to it.' }
  // The CLI describes what would happen and writes the ticket. It reads GitHub, so allow time.
  const run = spawnSync('/bin/sh', [ '-c', `${command} --ask-ticket ${payload.tool_use_id}` ], { cwd: payload.cwd, env: { ...process.env, FACTORY_FOREMAN_ASK_SESSION: String(payload.session_id ?? '') }, encoding: 'utf8', timeout: 60_000 })
  if (run.status !== 0) return { refuse: String(run.stderr || run.stdout || `it exited with code ${run.status}`).trim().replace(/^Refused: /, '').split('\n').slice(0, 12).join('\n') }
  let said
  try { said = JSON.parse(run.stdout) } catch { return { refuse: 'factory-foreman didn\'t say what it would do, so you can\'t be asked about it.' } }
  if (!/^[a-f0-9]{32}$/.test(said?.nonce ?? '') || typeof said.summary !== 'string') return { refuse: 'factory-foreman\'s description was malformed.' }
  const reason = `${said.summary}\n\nAllow confirms it as you: it's posted under your GitHub login. Deny leaves it undone.`
  return { ask: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason, updatedInput: { ...payload.tool_input, command: `FACTORY_FOREMAN_ASK=${said.nonce} ${command}` } } } }
}

// The chat's answer for a command, or null to leave it to the guard's own rules.
export function chatDecision(payload, command, reason, { lex }) {
  if (!fromClaudeCode(payload)) return null
  if (carriesTicket(command)) return ASKS.includes(payload.permission_mode) ? { ask: askAgain(payload) } : { refuse: `In ${payload.permission_mode} mode Claude Code wouldn't ask you, so approvals and merges are refused here.` }
  if (!/^factory-foreman (approve|slice merge) is for a person/.test(reason ?? '')) return null
  return chatAsk(payload, { lex })
}
