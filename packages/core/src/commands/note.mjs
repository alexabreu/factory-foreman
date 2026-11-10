import { Refusal } from '../errors.mjs'
import { KINDS, appendLog } from '../state/local.mjs'

// factory-foreman note "<text>" [--kind decision|rejected|question] [--blocking] [--step s] [--slice n]
export function note(ctx, { positionals, flags }) {
  const text = positionals.join(' ').trim()
  if (!text) throw new Refusal('Say what to note: factory-foreman note "<text>".')
  const kind = flags.kind ?? 'decision'
  if (!KINDS.includes(kind)) throw new Refusal(`--kind is one of ${KINDS.join(', ')}.`)
  if (flags.step !== undefined && ![ 'shape', 'design' ].includes(flags.step)) throw new Refusal('--step is shape or design.')
  if (flags.slice !== undefined && !/^[1-9]\d*$/.test(String(flags.slice))) throw new Refusal('--slice is a slice number, like 2.')
  if (flags.blocking && kind !== 'question') throw new Refusal('--blocking only goes with --kind question.')
  const entry = {
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
  return { out: `Noted ${kind}${entry.step ? ` for ${entry.step}` : ''}: ${text}`, json: entry }
}
