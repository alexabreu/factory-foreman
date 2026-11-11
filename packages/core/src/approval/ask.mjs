// How a person confirms an approval or a merge: at their own terminal (y/N),
// or in a Claude Code chat through the harness's own permission prompt.
//
// The chat path: the approve guard (a PreToolUse hook) runs the command with
// --ask-ticket <tool_use_id>. That run does every check, then writes a
// one-shot ticket for exactly this command and what it would act on, and
// prints a description. The hook shows that description in Claude Code's
// prompt and rewrites the command to carry the ticket's nonce in
// FACTORY_FOREMAN_ASK. If the person allows it, the command runs, uses the
// ticket up, and checks that nothing changed since they were asked.
//
// Threat model: this stops an agent approving or merging without the person
// seeing a prompt (allow rules don't silence a hook's "ask", headless runs
// can't answer it, and the hook refuses modes that never prompt), replay
// (one use, ten minutes, this exact command), and approving something other
// than what was shown. It doesn't stop a determined agent: it runs as the
// person and could write a ticket itself and run the command where the hook
// doesn't look. The guard refuses the obvious forms; the real fix would be a
// separate agent identity.
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Refusal } from '../errors.mjs'
import { agentShell, noPersonInLoop } from '../state/local.mjs'

const TTL = 10 * 60_000
const asksDir = (env) => env.FACTORY_FOREMAN_ASKS_DIR || join(homedir(), '.factory-foreman', 'asks')
const NONCE = /^[a-f0-9]{32}$/
const TICKET = /^[a-f0-9]{32}\.json(\.used-[\w-]+)?$/
// A headless or SDK run has no person to answer the prompt, whatever answers it.
const NOBODY = 'This session has no person in it to ask, so it can\'t approve or merge; the person does it in their own chat or terminal.'

// Which path this run is on: 'describe' (the hook asking what it would do),
// 'chat' (allowed in the chat), or 'terminal'. A terminal run is refused where
// an agent could be typing, before anything is read.
export function confirmPath(ctx, flags) {
  if (flags['ask-ticket'] !== undefined) return 'describe'
  if (ctx.env.FACTORY_FOREMAN_ASK !== undefined) return 'chat'
  return 'terminal'
}

export function requireTerminal(ctx, flags, what) {
  if (confirmPath(ctx, flags) !== 'terminal') return
  const blocked = agentShell({ env: ctx.env, isTTY: ctx.isTTY })
  if (blocked) throw new Refusal(`${what} must be confirmed by a person: in their own terminal, or in a Claude Code chat where the harness asks them. Here ${blocked}.`)
}

// The command's own words, without the hook's --ask-ticket.
const ownArgs = (argv) => { const out = []; for (let i = 0; i < argv.length; i++) { if (argv[i] === '--ask-ticket') { i++; continue } if (argv[i].startsWith('--ask-ticket=')) continue; out.push(argv[i]) } return out }

// The describe run: write the ticket, return what the prompt shows.
function mint(ctx, { argv, bind, summary, flags }) {
  if (noPersonInLoop(ctx.env)) throw new Refusal(NOBODY)
  const toolUse = String(flags['ask-ticket'])
  if (!/^[\w-]{1,128}$/.test(toolUse)) throw new Refusal('The approve hook passed a malformed tool call id.')
  const dir = asksDir(ctx.env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Only a real folder of the person's own holds tickets.
  const own = lstatSync(dir)
  if (own.isSymbolicLink() || !own.isDirectory() || (process.getuid && own.uid !== process.getuid())) throw new Refusal(`${dir} isn't a folder of yours, so approval tickets can't be kept there.`)
  chmodSync(dir, 0o700)
  const now = ctx.now().getTime()
  // Tickets nobody used expire; tidy them as we go, and nothing else.
  for (const name of readdirSync(dir).filter((f) => TICKET.test(f))) { try { if (now - statSync(join(dir, name)).mtimeMs > TTL) rmSync(join(dir, name), { force: true }) } catch { /* gone already */ } }
  const nonce = randomBytes(16).toString('hex')
  writeFileSync(join(dir, `${nonce}.json`), JSON.stringify({ argv: ownArgs(argv), bind, summary, toolUse, session: ctx.env.FACTORY_FOREMAN_ASK_SESSION || null, expires: now + TTL }), { flag: 'wx', mode: 0o600 })
  return { out: JSON.stringify({ summary, nonce }), json: { summary, nonce } }
}

// Uses up the ticket this run carries and checks it fits; returns how the person confirmed.
function redeem(ctx, { argv, bind }) {
  if (noPersonInLoop(ctx.env)) throw new Refusal(NOBODY)
  const nonce = ctx.env.FACTORY_FOREMAN_ASK
  if (!NONCE.test(nonce)) throw new Refusal('This approval carries a malformed ticket.')
  const file = join(asksDir(ctx.env), `${nonce}.json`)
  const taken = `${file}.used-${process.pid}-${randomBytes(4).toString('hex')}`
  // Renaming is atomic: of two runs with one ticket, only one gets it.
  try { renameSync(file, taken) } catch { throw new Refusal('This approval\'s ticket is gone: it was used already, or it expired. Ask again.') }
  let ticket
  try { ticket = JSON.parse(readFileSync(taken, 'utf8')) } catch { throw new Refusal('This approval\'s ticket can\'t be read. Ask again.') } finally { rmSync(taken, { force: true }) }
  if (!(ctx.now().getTime() < ticket.expires)) throw new Refusal('This approval\'s ticket expired. Ask again.')
  if (JSON.stringify(ticket.argv) !== JSON.stringify(ownArgs(argv))) throw new Refusal('This approval\'s ticket is for a different command. Ask again.')
  if (ticket.bind !== bind) throw new Refusal('What you were asked to approve changed before it ran. Read it again and ask again.')
  // The chat session, as a short digest: enough to find it in the person's own history, not to read it.
  return { via: 'claude-code-ask', session: ticket.session ? createHash('sha256').update(String(ticket.session)).digest('hex').slice(0, 12) : null }
}

// The one place a person confirms. On the describe run it stops here with the
// description; in the chat it redeems the ticket; at a terminal it asks y/N.
export async function confirm(ctx, { flags, argv, bind, summary, question, no = 'Not confirmed.' }) {
  const path = confirmPath(ctx, flags)
  if (path === 'describe') return { describe: mint(ctx, { argv, bind, summary: `${summary}\n${question}`, flags }) }
  if (path === 'chat') return redeem(ctx, { argv, bind })
  const answer = (await ctx.prompt(`${summary}\n${question} [y/N] `)).trim()
  if (!/^(y|yes)$/i.test(answer)) throw new Refusal(no)
  return { via: 'terminal' }
}
