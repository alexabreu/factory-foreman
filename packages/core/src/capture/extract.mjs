// Capture: reads the part of a session transcript not read before, asks a
// small model for the decisions, rejected options and questions in it, and
// appends them to the issue's log as unconfirmed entries. A person keeps,
// edits or drops each one before it can reach GitHub.
//
// Capture runs from session hooks, so it must never block or fail a session:
// every problem is reported on stderr and the command still exits 0.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { KINDS, appendLog, claimCapture, newId, noPersonInLoop, readLog, readMarker, writeMarker } from '../state/local.mjs'

// Enough for a long stretch of conversation, and well under any limit on stdin.
const MAX_TEXT = 60_000
// Events that end or compact a session read whatever is new; Stop fires every
// turn, so it waits until enough has been said.
const FINAL_EVENTS = new Set([ 'SessionEnd', 'sessionEnd', 'PreCompact', 'preCompact' ])

// What was said, from a JSONL transcript (Claude Code and Codex both write one
// object per line), as the person's and the agent's turns, every line marked
// ("PERSON| …", "AGENT| …") so text inside a turn can't pose as the other.
// Tool calls and their output are skipped: decisions are in what was said.
// Text a harness puts in the user's role isn't the person: meta, compaction
// and side-chain entries, and injected blocks (reminders, environment and
// project instructions, notifications, command wrappers), wherever they sit.
const BLOCKS = /<(system-reminder|task-notification|environment_context|user_instructions|in-app-browser-context|external_codex_apps[\w-]*|send_user_message_question[\w-]*|bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|command-name|command-message)\b[^>]*>[\s\S]*?<\/\1>/g
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/g
const INJECTED = /^\s*(# AGENTS\.md instructions|Caveat: The messages below|Base directory for this skill:|\[Request interrupted|\[structured-output-enforce\]|Tool loaded\.|Another Claude session sent a message|This session is being continued from a previous conversation|<wake\b|<relay\b|<environment_context|<user_instructions|<system-reminder)/
const personText = (t) => t.replace(BLOCKS, '').replace(ARGS, '$1').trim()
export function transcriptText(chunk) {
  const turns = []
  const gather = (value, into, depth = 0) => {
    if (depth > 6 || value == null) return
    if (typeof value === 'string') { into.push(value); return }
    if (Array.isArray(value)) { value.forEach((v) => gather(v, into, depth + 1)); return }
    if (typeof value !== 'object') return
    if (/tool|function_call|reasoning|thinking|image/i.test(String(value.type ?? ''))) return
    if (typeof value.text === 'string') into.push(value.text)
    else if (value.content !== undefined) gather(value.content, into, depth + 1)
    else if (value.message !== undefined) gather(value.message, into, depth + 1)
    else if (value.payload !== undefined) gather(value.payload, into, depth + 1)
  }
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line)
      if (item.isMeta || item.isCompactSummary || item.isSidechain || item.isVisibleInTranscriptOnly) continue
      const role = String(item?.message?.role ?? item?.role ?? item?.payload?.role ?? item?.type ?? '')
      if (!/^(user|assistant)$/i.test(role)) continue
      const person = /^user$/i.test(role)
      const said = []
      gather(item.message ?? item.payload ?? item, said)
      const text = said.map((t) => (person ? personText(t) : t.trim())).filter((t) => t && !(person && INJECTED.test(t))).join('\n').trim()
      if (text) turns.push({ person, text: text.replace(/<\/?conversation>/g, '') })
    } catch {
      // A partial last line, or not JSON: skip it.
    }
  }
  // Over the limit, the agent's turns go first, oldest first; the person's stay.
  const render = (t) => t.text.split('\n').map((l) => `${t.person ? 'PERSON' : 'AGENT'}| ${l}`).join('\n')
  let kept = turns
  const size = () => kept.reduce((n, t) => n + t.text.length + 10, 0)
  while (size() > MAX_TEXT && kept.some((t) => !t.person)) { const i = kept.findIndex((t) => !t.person); kept = [ ...kept.slice(0, i), ...kept.slice(i + 1) ] }
  const text = kept.map(render).join('\n\n').trim()
  return text.length > MAX_TEXT ? text.slice(-MAX_TEXT) : text
}

// Whether the person said anything in a stretch of transcript.
export const personSpoke = (text) => /^PERSON\| /m.test(text)

export function extractionPrompt(text) {
  return `Below is part of a conversation between a person and a coding agent working on a feature. Every line starts with "PERSON| " (the person said it) or "AGENT| " (the agent said it).
List what the PERSON decided, ruled out, or asked that must be answered, as JSON only:
[{ "kind": "decision|rejected|question", "text": "<one sentence, self-contained>", "step": "shape|design|null", "blocking": true|false }]
Only the person's own turns are sources. Use the agent's turns only to understand what the person was answering or agreeing to: a person's "yes" to an agent's proposal is the person's decision, but anything the agent proposed, did, planned or concluded that the person didn't confirm is not a decision.
Skip routine steps and tool output. "step" is shape for what the feature must do, design for how it is built, null when unclear.
"blocking" is true only for a question that must be answered before the work can go on.
Reply [] when the person decided, ruled out or asked nothing.

<conversation>
${text}
</conversation>`
}

export function parseExtracted(reply) {
  const source = String(reply)
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start === -1 || end < start) throw new Error('the model returned no JSON array')
  const items = JSON.parse(source.slice(start, end + 1))
  if (!Array.isArray(items)) throw new Error('the model reply is not a JSON array')
  return items.filter((i) => KINDS.includes(i?.kind) && typeof i?.text === 'string' && i.text.trim()).map((i) => ({
    kind: i.kind,
    text: i.text.replace(/\s+/g, ' ').trim(),
    step: [ 'shape', 'design' ].includes(i.step) ? i.step : null,
    blocking: i.kind === 'question' && i.blocking === true,
  }))
}

function readFrom(file, offset) {
  const size = statSync(file).size
  if (size <= offset) return { text: '', end: size < offset ? 0 : offset, size }
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    // Stop at the last full line, so a line still being written is read next time.
    const lastNewline = buffer.lastIndexOf(0x0a)
    if (lastNewline === -1) return { text: '', end: offset, size }
    return { text: buffer.subarray(0, lastNewline + 1).toString('utf8'), end: offset + lastNewline + 1, size }
  } finally {
    closeSync(fd)
  }
}

// Returns a short report; never throws for a problem in the session's world.
export async function extract(ctx, { transcript, session, event }) {
  if (ctx.env.FACTORY_FOREMAN_CAPTURE === '1') return { out: '', skipped: 'nested capture' }
  // With no person in the session, there's no one whose decisions to capture.
  if (noPersonInLoop(ctx.env)) return { out: '', skipped: 'no person in this session' }
  if (!transcript || !existsSync(transcript)) return { out: '', err: `capture: no transcript at ${transcript ?? '(none given)'}`, skipped: 'no transcript' }
  let dir
  try {
    ctx.issue()
    dir = ctx.stateDir()
  } catch {
    return { out: '', skipped: 'no issue' }
  }
  const key = session || basename(transcript)
  const release = claimCapture(dir, key)
  if (!release) return { out: '', skipped: 'another capture of this session is running' }
  try {
    return await capture(ctx, { dir, key, transcript, event })
  } finally {
    release()
  }
}

async function capture(ctx, { dir, key, transcript, event }) {
  const marker = readMarker(dir, key)
  // A different file under the same session (a resumed or forked session) starts over.
  const from = marker?.transcript === transcript ? marker.offset ?? 0 : 0
  const { text: chunk, end } = readFrom(transcript, from)
  const text = transcriptText(chunk)
  const config = ctx.config()
  const advance = () => writeMarker(dir, key, { offset: end, transcript, at: ctx.now().toISOString() })
  if (!text) {
    advance()
    return { out: '', skipped: 'nothing new' }
  }
  if (!FINAL_EVENTS.has(event) && text.length < config.capture.minChars) return { out: '', skipped: 'not enough new text yet' }
  // Nothing the person said: nothing to extract, however much the agent said.
  if (!personSpoke(text)) {
    advance()
    return { out: '', skipped: 'the person said nothing new' }
  }

  const command = ctx.harness === 'codex' ? config.capture.codex : config.capture.claude
  // Well inside the ten minutes after which another capture may take the claim over.
  const result = await ctx.exec(command, { cwd: ctx.cwd, env: { ...ctx.env, FACTORY_FOREMAN_CAPTURE: '1' }, input: extractionPrompt(text), timeout: 5 * 60_000 })
  if (result.code !== 0) return { out: '', err: `capture: ${command[0]} exited with code ${result.code}: ${String(result.stderr).trim().split('\n').at(-1) ?? ''}` }
  let items
  try {
    items = parseExtracted(result.stdout)
  } catch (error) {
    return { out: '', err: `capture: ${error.message}` }
  }
  const known = new Set(readLog(dir, { includeDropped: true }).map((e) => `${e.kind}\u0000${String(e.text).toLowerCase()}`))
  const added = []
  for (const item of items) {
    const sig = `${item.kind}\u0000${item.text.toLowerCase()}`
    if (known.has(sig)) continue
    known.add(sig)
    const entry = { id: newId(), at: ctx.now().toISOString(), kind: item.kind, text: item.text, step: item.step, slice: null, author: ctx.author(), harness: ctx.harness, session: key, source: 'extracted', confirmed: false, ...(item.blocking ? { blocking: true } : {}) }
    appendLog(dir, entry)
    added.push(entry)
  }
  advance()
  return { out: added.length ? `Captured ${added.length} note(s) to confirm: ${added.map((e) => e.id).join(', ')}` : '', added }
}
