// Reviewer briefs for a Shape or Design draft, and the saved settlements that
// let it be posted.
//
// config.reviewers[step] names the reviewer agents. A name ending in ?visual
// is briefed only when the step has a visual acceptance criterion: in the
// draft for Shape, in the approved Shape for Design. When the step is in
// config.secondOpinion.steps, a second-opinion brief runs through that command.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Refusal } from '../errors.mjs'
import { hash } from '../issue/records.mjs'
import { parseDraft } from '../steps/structure.mjs'

export const SECOND_OPINION = 'second-opinion'
export const SETTLEMENTS = [ 'accepted', 'changed', 'overruled' ]
export const SEVERITIES = [ 'blocking', 'major', 'minor' ]

// The text that would be posted, so a review covers exactly that.
export const postedBody = (draft) => `${draft.body.trim()}\n`
export const draftHash = (draft) => hash(postedBody(draft))

// Which reviewers a step needs, given the draft and (for Design) the approved Shape.
export function reviewersFor(step, config, { draft, shape }) {
  const visual = (step === 'design' ? shape : draft)?.criteria?.some((c) => c.visual) ?? false
  const names = (config.reviewers?.[step] ?? []).flatMap((entry) => {
    const [ name, condition ] = entry.split('?')
    if (condition === 'visual' && !visual) return []
    return [ name ]
  })
  if (config.secondOpinion?.steps?.includes(step)) names.push(SECOND_OPINION)
  return [ ...new Set(names) ]
}

const OUTPUT = `Reply with only a JSON array of findings, and nothing else:
[{ "id": "<short-id>", "severity": "${SEVERITIES.join('|')}", "text": "<what is wrong and why it matters>", "where": "<section, criterion or line>" }]
Reply [] when there is nothing to fix. A finding is something the author must settle: accept it, change the draft, or overrule it with a reason.`

export function brief({ reviewer, step, issue, draft, shape, shapeVersion }) {
  const who = reviewer === SECOND_OPINION
    ? 'You are giving an independent second opinion on this draft. Read it as a skeptical senior engineer who wasn\'t in the room.'
    : `You are the ${reviewer} reviewer. Follow your agent instructions (the ${reviewer} agent), and load the repo's standards skill for your role if it has one.`
  const parts = [
    who,
    '',
    `Review the ${step === 'shape' ? 'Shape' : 'Design'} draft for issue #${issue} (draft hash ${draftHash(draft)}).`,
    '',
    '<draft>',
    postedBody(draft).trimEnd(),
    '</draft>',
  ]
  if (step === 'design' && shape) parts.push('', `The approved Shape (${shapeVersion}) it builds on:`, '', '<shape>', shape.body.trim(), '</shape>')
  parts.push('', OUTPUT)
  return parts.join('\n')
}

// A reviewer's reply is a JSON array; tolerate a fenced block or text around it.
export function parseFindings(text) {
  const fenced = String(text).match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  const source = fenced ? fenced[1] : String(text)
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start === -1 || end < start) throw new Error('no JSON array in the reply')
  const value = JSON.parse(source.slice(start, end + 1))
  if (!Array.isArray(value)) throw new Error('the reply is not a JSON array')
  return value.map((f, i) => ({
    id: typeof f?.id === 'string' && f.id.trim() ? f.id.trim() : `F${i + 1}`,
    severity: SEVERITIES.includes(f?.severity) ? f.severity : 'major',
    text: String(f?.text ?? '').trim(),
    where: String(f?.where ?? '').trim(),
  })).filter((f) => f.text)
}

export const reviewFile = (stateDir, step, digest) => join(stateDir, 'reviews', `${step}-${digest}.json`)

// Checks a settled findings file against the reviewers the step needs.
// Returns a list of problems; empty means it can be saved.
export function checkSettlements(findings, reviewers) {
  const problems = []
  const given = findings?.reviewers
  if (!given || typeof given !== 'object' || Array.isArray(given)) return [ 'The findings file needs { "reviewers": { "<name>": [ … ] } }.' ]
  for (const name of reviewers) {
    if (!(name in given)) problems.push(`${name} is missing; add "${name}": [] if it found nothing.`)
  }
  for (const [ name, list ] of Object.entries(given)) {
    if (!reviewers.includes(name)) { problems.push(`${name} wasn't briefed for this step.`); continue }
    if (!Array.isArray(list)) { problems.push(`${name} must be a list of findings.`); continue }
    list.forEach((f, i) => {
      const label = `${name} finding ${typeof f?.id === 'string' && f.id ? f.id : i + 1}`
      if (typeof f?.text !== 'string' || !f.text.trim()) problems.push(`${label} has no text.`)
      if (!SETTLEMENTS.includes(f?.settlement)) problems.push(`${label} isn't settled: set "settlement" to ${SETTLEMENTS.join(', ')}.`)
      else if (f.settlement === 'overruled' && (typeof f.reason !== 'string' || !f.reason.trim())) problems.push(`${label} is overruled without a reason.`)
    })
  }
  return problems
}

export function saveReview(stateDir, { step, draft, reviewers, findings, at }) {
  const digest = draftHash(draft)
  const file = reviewFile(stateDir, step, digest)
  mkdirSync(join(stateDir, 'reviews'), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ step, hash: digest, savedAt: at, reviewers: Object.fromEntries(reviewers.map((r) => [ r, findings.reviewers[r] ])) }, null, 2)}\n`)
  return { file, digest }
}

// The saved review for the draft as it is now, or a refusal saying what to do.
export function requireReview(stateDir, { step, draft, reviewers }) {
  if (!reviewers.length) return null
  const digest = draftHash(draft)
  const file = reviewFile(stateDir, step, digest)
  if (!existsSync(file)) {
    throw new Refusal(`The ${step} draft hasn't been reviewed as it is now (hash ${digest.slice(0, 12)}). Run factory-foreman review ${step}, have ${reviewers.join(', ')} review it, settle every finding, and run factory-foreman review save ${step} --findings <file>. Any edit after saving needs a new save.`, { reviewers, hash: digest })
  }
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  const missing = reviewers.filter((r) => !(r in (saved.reviewers ?? {})))
  if (missing.length) throw new Refusal(`The saved review of this ${step} draft has no findings from ${missing.join(', ')}. Review again and save.`)
  return saved
}

export const readDraftFile = (file, step) => {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Refusal(`Can't read the draft ${file}. Run factory-foreman draft ${step} first.`)
  }
  return parseDraft(text)
}
