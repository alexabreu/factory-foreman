// Capture: reads the part of a session transcript not read before, asks a
// small model for the decisions, rejected options and questions in it, and
// appends them to the issue's log as unconfirmed entries. A person keeps,
// edits or drops each one before it can reach GitHub.
//
// Capture runs from session hooks, so it must never block or fail a session:
// every problem is reported on stderr and the command still exits 0.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { appendLog, newId, readLog, readMarkers, writeMarkers } from '../state/local.mjs'

export const KINDS = [ 'decision', 'rejected', 'question' ]
const MAX_TEXT = 60_000
// Events that end or compact a session read whatever is new; Stop fires every
// turn, so it waits until enough has been said.
const FINAL_EVENTS = new Set([ 'SessionEnd', 'sessionEnd', 'PreCompact', 'preCompact' ])

// Text the people and agents said, from a JSONL transcript (Claude Code and
// Codex both write one object per line). Tool calls and their output are
// skipped: decisions are in what was said, not in command output.
export function transcriptText(chunk) {
  const out = []
  const gather = (value, depth = 0) => {
    if (depth > 6 || value == null) return
    if (typeof value === 'string') { out.push(value); return }
    if (Array.isArray(value)) { value.forEach((v) => gather(v, depth + 1)); return }
    if (typeof value !== 'object') return
    if (/tool|function_call|reasoning/i.test(String(value.type ?? ''))) return
    if (typeof value.text === 'string') out.push(value.text)
    else if (value.content !== undefined) gather(value.content, depth + 1)
    else if (value.message !== undefined) gather(value.message, depth + 1)
    else if (value.payload !== undefined) gather(value.payload, depth + 1)
  }
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line)
      const role = item?.message?.role ?? item?.role ?? item?.payload?.role ?? item?.type
      if (/^(system|tool)/i.test(String(role))) continue
      const before = out.length
      gather(item.message ?? item.payload ?? item)
      if (out.length > before && /^(user|assistant)$/i.test(String(role))) out.splice(before, 0, `${role}:`)
    } catch {
      // A partial last line, or not JSON: skip it.
    }
  }
  const text = out.join('\n').trim()
  return text.length > MAX_TEXT ? text.slice(-MAX_TEXT) : text
}

export function extractionPrompt(text) {
  return `Below is part of a conversation between a developer and a coding agent working on a feature.
List the decisions made, the options considered and rejected, and the open questions, as JSON only:
[{ "kind": "decision|rejected|question", "text": "<one sentence, self-contained>", "step": "shape|design|null", "blocking": true|false }]
Only include what was actually decided, rejected or asked by the people in it; skip routine steps and tool output.
"step" is shape for what the feature must do, design for how it is built, null when unclear.
"blocking" is true only for a question that must be answered before the work can go on.
Reply [] when there is nothing.

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
  if (!transcript || !existsSync(transcript)) return { out: '', err: `capture: no transcript at ${transcript ?? '(none given)'}`, skipped: 'no transcript' }
  let dir
  try {
    ctx.issue()
    dir = ctx.stateDir()
  } catch {
    return { out: '', skipped: 'no issue' }
  }
  const key = session || basename(transcript)
  const markers = readMarkers(dir)
  const from = markers[key]?.offset ?? 0
  const { text: chunk, end } = readFrom(transcript, from)
  const text = transcriptText(chunk)
  const config = ctx.config()
  if (!text) {
    markers[key] = { offset: end, transcript, at: ctx.now().toISOString() }
    writeMarkers(dir, markers)
    return { out: '', skipped: 'nothing new' }
  }
  if (!FINAL_EVENTS.has(event) && text.length < config.capture.minChars) return { out: '', skipped: 'not enough new text yet' }

  const command = ctx.harness === 'codex' ? config.capture.codex : config.capture.claude
  const result = await ctx.exec([ ...command, extractionPrompt(text) ], { cwd: ctx.cwd, env: { ...ctx.env, FACTORY_FOREMAN_CAPTURE: '1' } })
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
  markers[key] = { offset: end, transcript, at: ctx.now().toISOString() }
  writeMarkers(dir, markers)
  return { out: added.length ? `Captured ${added.length} note(s) to confirm: ${added.map((e) => e.id).join(', ')}` : '', added }
}
