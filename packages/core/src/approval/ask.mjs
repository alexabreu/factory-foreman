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

// Relayed approvals: the person confirmed somewhere factory-foreman can't see
// (a tap on a card in the Claude app), and the agent that saw it runs the
// command with --relayed <channel>:<ref>, --expect <action>:<what the card
// showed> and --as <who the card said approves>. Only channels the person
// listed in their own config file are accepted; the person (never an agent)
// writes it. Nothing checks the tap itself: the agent attests to it, and the
// record says so, with the channel and ref to trace it.
// The person's own settings, outside any repo; FACTORY_FOREMAN_USER_DIR moves it (tests).
export const userConfigFile = (env) => join(env.FACTORY_FOREMAN_USER_DIR || join(homedir(), '.factory-foreman'), 'config.json')
// The settings, or why they're ignored.
function userConfig(env) {
  const file = userConfigFile(env)
  let st
  try { st = lstatSync(file) } catch { return { config: {} } }
  // A file the person owns and nobody else can write; a link or a shared file doesn't count.
  if (!st.isFile()) return { config: {}, why: `${file} is a link or not a plain file, so it's ignored` }
  if ((st.mode & 0o022) || (process.getuid && st.uid !== process.getuid())) return { config: {}, why: `${file} can be written by someone other than you, so it's ignored` }
  try { return { config: JSON.parse(readFileSync(file, 'utf8')) } } catch { return { config: {}, why: `${file} isn't valid JSON, so it's ignored` } }
}
// Channel names that would read as another way of confirming are reserved.
const RESERVED = new Set([ 'terminal', 'chat', 'claude-code-ask', 'relayed' ])
export const relayChannels = (env) => { const list = userConfig(env).config?.approvals?.relay; return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && /^[\w-]{1,40}$/.test(c) && !RESERVED.has(c)) : [] }
const NOT_ON = (channel, env) => `Approvals relayed from ${channel} aren't turned on${userConfig(env).why ? ` (${userConfig(env).why})` : ''}. Only the person turns them on, in their own settings; ask them. Don't create or change that file yourself.`

// A relayed run, checked: the channel is on, and the action, what was shown and who approves all still match.
function relayed(ctx, { flags, action, expect, actor }) {
  const m = /^([\w-]{1,40}):([\w.:-]{1,200})$/.exec(typeof flags.relayed === 'string' ? flags.relayed : '')
  if (!m) throw new Refusal('Name the relay as --relayed <channel>:<ref>, for example --relayed claude-app:<the card\'s id>.')
  if (!relayChannels(ctx.env).includes(m[1])) throw new Refusal(NOT_ON(m[1], ctx.env))
  const shown = /^(approve|merge):([0-9a-f]{7,64})$/i.exec(typeof flags.expect === 'string' ? flags.expect : '')
  if (!shown) throw new Refusal('Pass --expect <approve|merge>:<what the person was shown> (the version\'s hash or the head commit, at least 7 characters).')
  if (shown[1].toLowerCase() !== action) throw new Refusal(`The person was asked to ${shown[1]}, not to ${action}. Ask them about this.`)
  if (!String(expect).toLowerCase().startsWith(shown[2].toLowerCase())) throw new Refusal(`What the person was shown (${shown[2]}) isn't what this would ${action} now (${String(expect).slice(0, 12)}). Show them the current one and ask again.`)
  if (typeof flags.as !== 'string' || flags.as.replace(/^@/, '').toLowerCase() !== String(actor).toLowerCase()) throw new Refusal(`Pass --as with who the person was told would ${action}; it's @${actor} here.`)
  return { via: 'relayed', channel: m[1], ref: m[2] }
}

// Which path this run is on: 'describe' (the hook asking what it would do),
// 'chat' (allowed in the chat), 'relayed' (confirmed elsewhere and relayed),
// or 'terminal'. A terminal run is refused where an agent could be typing,
// before anything is read. A relayed run is accepted from an agent's shell
// (the person is elsewhere, so an SDK or remote session counts), but not in
// CI or a run marked as having no person behind it.
export function confirmPath(ctx, flags) {
  if (flags.relayed !== undefined) {
    const channel = String(flags.relayed).split(':')[0]
    if (!relayChannels(ctx.env).includes(channel)) throw new Refusal(NOT_ON(channel, ctx.env))
    if (flags['ask-ticket'] !== undefined || ctx.env.FACTORY_FOREMAN_ASK !== undefined) throw new Refusal('A relayed approval doesn\'t also carry a chat ticket.')
    if (noPersonInLoop(ctx.env) && !/^sdk/.test(ctx.env.CLAUDE_CODE_ENTRYPOINT ?? '')) throw new Refusal('A relayed approval needs a person behind it, and this run is marked as having none.')
    return 'relayed'
  }
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
  // A newer ask for the same thing replaces an older one (one left after a Deny, say).
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json') && NONCE.test(f.slice(0, -5)))) {
    try { if (JSON.parse(readFileSync(join(dir, name), 'utf8')).bind === bind) rmSync(join(dir, name), { force: true }) } catch { /* not ours to read */ }
  }
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
export async function confirm(ctx, { flags, argv, bind, summary, question, action, expect, actor, no = 'Not confirmed.' }) {
  const path = confirmPath(ctx, flags)
  if (path === 'relayed') return relayed(ctx, { flags, action, expect, actor })
  if (path === 'describe') return { describe: mint(ctx, { argv, bind, summary: `${summary}\n${question}`, flags }) }
  if (path === 'chat') return redeem(ctx, { argv, bind })
  const answer = (await ctx.prompt(`${summary}\n${question} [y/N] `)).trim()
  if (!/^(y|yes)$/i.test(answer)) throw new Refusal(no)
  return { via: 'terminal' }
}
