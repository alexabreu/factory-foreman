import { extract } from '../capture/extract.mjs'
import { Refusal } from '../errors.mjs'
import { KINDS, appendLog, newId, noPersonInLoop, readLog } from '../state/local.mjs'

// factory-foreman note "<text>" [--kind decision|rejected|question] [--blocking] [--step s] [--slice n]
// factory-foreman note --keep <id> | --drop <id> | --edit <id> "<text>"
// factory-foreman note --extract --transcript <path> [--session <id>] [--event <name>]
export async function note(ctx, { positionals, flags }) {
  if (flags.extract) {
    // Runs from session hooks: report problems on stderr, never fail.
    try {
      const result = await extract(ctx, { transcript: typeof flags.transcript === 'string' ? flags.transcript : null, session: typeof flags.session === 'string' ? flags.session : null, event: typeof flags.event === 'string' ? flags.event : null })
      return { out: result.out, err: result.err, json: result }
    } catch (error) {
      return { out: '', err: `capture: ${error.message}`, json: { error: error.message } }
    }
  }
  for (const op of [ 'keep', 'drop', 'edit' ]) if (flags[op] !== undefined) return confirm(ctx, op, flags[op], positionals)

  const text = positionals.join(' ').trim()
  if (!text) throw new Refusal('Say what to note: factory-foreman note "<text>".')
  const kind = flags.kind ?? 'decision'
  if (!KINDS.includes(kind)) throw new Refusal(`--kind is one of ${KINDS.join(', ')}.`)
  if (flags.step !== undefined && ![ 'shape', 'design' ].includes(flags.step)) throw new Refusal('--step is shape or design.')
  if (flags.slice !== undefined && !/^[1-9]\d*$/.test(String(flags.slice))) throw new Refusal('--slice is a slice number, like 2.')
  if (flags.blocking && kind !== 'question') throw new Refusal('--blocking only goes with --kind question.')
  const entry = {
    id: newId(),
    at: ctx.now().toISOString(),
    kind,
    text,
    step: flags.step ?? null,
    slice: flags.slice ? Number(flags.slice) : null,
    author: ctx.author(),
    harness: ctx.harness,
    session: ctx.env.FACTORY_FOREMAN_SESSION ?? null,
    source: 'note',
    confirmed: true,
    ...(flags.blocking ? { blocking: true } : {}),
  }
  appendLog(ctx.stateDir(), entry)
  return { out: `Noted ${kind}${entry.step ? ` for ${entry.step}` : ''} (${entry.id}): ${text}`, json: entry }
}

// Keeping, editing or dropping an extracted entry appends an op to the log.
function confirm(ctx, op, id, positionals) {
  if (typeof id !== 'string' || !id.trim()) throw new Refusal(`Name the entry: factory-foreman note --${op} <id>${op === 'edit' ? ' "<text>"' : ''}.`)
  // Confirming what was decided is the person's: a session with no person in it leaves notes as they are.
  if (noPersonInLoop(ctx.env)) throw new Refusal(`Extracted notes are the person's to keep, edit or drop, and this session has no person in it (${ctx.env.CODEX_CI !== undefined ? 'codex exec' : /^sdk/.test(ctx.env.CLAUDE_CODE_ENTRYPOINT ?? '') ? 'a headless agent' : 'CI'}). Leave them: checkpoint posts without them and names them, and the person settles them with factory-foreman note --keep, --edit or --drop.`)
  const dir = ctx.stateDir()
  const entry = readLog(dir).find((e) => e.id === id)
  if (!entry) throw new Refusal(`No note ${id} in #${ctx.issue()}'s log (dropped ones can't be changed). factory-foreman draft lists the unconfirmed ones.`)
  const text = positionals.join(' ').trim()
  if (op === 'edit' && !text) throw new Refusal(`Give the new text: factory-foreman note --edit ${id} "<text>".`)
  appendLog(dir, { op, id, at: ctx.now().toISOString(), by: ctx.author(), ...(op === 'edit' ? { text } : {}) })
  const done = op === 'keep' ? 'Kept' : op === 'drop' ? 'Dropped' : 'Edited and kept'
  return { out: `${done} ${id}: ${op === 'edit' ? text : entry.text}`, json: { op, id, ...(op === 'edit' ? { text } : {}) } }
}
