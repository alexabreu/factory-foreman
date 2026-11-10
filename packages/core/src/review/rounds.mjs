// Review rounds: a draft gets at most review.maxRounds rounds (default 2) per
// version it builds on. Round 1 briefs every reviewer. Round 2 re-reviews only
// what changed while settling round 1, by the reviewers whose findings caused
// those changes (and any reviewer new since round 1). After the last round,
// anything left is the person's to settle (accepted, or overruled with their
// reason) or an open question; there is no third round. Rounds are kept per
// base version in the issue's state folder:
//   reviews/<step>-rounds.json  { "<base>": [{ hash, body, reviewers, at, saved }] }
// `hash` is the draft a round's briefs were for; `saved` the draft its settled
// findings were last saved against (the person may edit before saving).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = (dir, step) => join(dir, 'reviews', `${step}-rounds.json`)
const readAll = (dir, step) => {
  if (!existsSync(file(dir, step))) return {}
  try {
    const all = JSON.parse(readFileSync(file(dir, step), 'utf8'))
    return all && typeof all === 'object' && !Array.isArray(all.rounds) ? all : {}
  } catch {
    return {}
  }
}
const writeAll = (dir, step, all) => {
  mkdirSync(join(dir, 'reviews'), { recursive: true })
  writeFileSync(file(dir, step), `${JSON.stringify(all, null, 2)}\n`)
}

export const readRounds = (dir, step, base) => readAll(dir, step)[String(base)] ?? []

export function recordRound(dir, step, base, round) {
  const all = readAll(dir, step)
  all[String(base)] = [ ...(all[String(base)] ?? []), round ]
  writeAll(dir, step, all)
  return all[String(base)]
}

// Notes which draft the latest round's findings were saved against.
export function markSaved(dir, step, base, hash) {
  const all = readAll(dir, step)
  const rounds = all[String(base)] ?? []
  if (!rounds.length) return
  rounds.at(-1).saved = hash
  writeAll(dir, step, all)
}

// Reviewers whose settled findings changed the draft.
export const changedBy = (saved) => Object.entries(saved?.reviewers ?? {}).filter(([ , list ]) => (list ?? []).some((f) => f.settlement === 'changed')).map(([ name ]) => name)

// The lines one text has and the other doesn't, whole lines only.
export function lineDiff(before, after, cap = 80) {
  const a = before.split('\n')
  const b = after.split('\n')
  const inB = new Set(b)
  const inA = new Set(a)
  const removed = a.filter((l) => l.trim() && !inB.has(l))
  const added = b.filter((l) => l.trim() && !inA.has(l))
  const show = (list, sign) => [ ...list.slice(0, cap).map((l) => `${sign} ${l}`), ...(list.length > cap ? [ `… ${list.length - cap} more` ] : []) ]
  return { removed: show(removed, '-'), added: show(added, '+') }
}
