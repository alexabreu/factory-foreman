// Review rounds: a draft gets at most review.maxRounds rounds (default 2) per
// version it builds on. Round 1 briefs every reviewer. Round 2 re-reviews only
// what changed while settling round 1, by the reviewers whose findings caused
// those changes. After the last round, anything left is the person's to settle
// (accepted, or overruled with their reason) or an open question; there is no
// third round. Rounds are kept in the issue's state folder:
//   reviews/<step>-rounds.json  { base, rounds: [{ hash, body, reviewers, at }] }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = (dir, step) => join(dir, 'reviews', `${step}-rounds.json`)

// The rounds held for this draft's base version; a new base starts over.
export function readRounds(dir, step, base) {
  if (!existsSync(file(dir, step))) return []
  try {
    const saved = JSON.parse(readFileSync(file(dir, step), 'utf8'))
    return saved.base === base ? saved.rounds ?? [] : []
  } catch {
    return []
  }
}

export function recordRound(dir, step, base, round) {
  const rounds = [ ...readRounds(dir, step, base), round ]
  mkdirSync(join(dir, 'reviews'), { recursive: true })
  writeFileSync(file(dir, step), `${JSON.stringify({ base, rounds }, null, 2)}\n`)
  return rounds
}

// Reviewers whose settled findings changed the draft.
export const changedBy = (saved) => Object.entries(saved?.reviewers ?? {}).filter(([ , list ]) => (list ?? []).some((f) => f.settlement === 'changed')).map(([ name ]) => name)
