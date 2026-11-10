import { readFileSync } from 'node:fs'
import { Refusal } from '../errors.mjs'
import { SECOND_OPINION, reviewFile, brief, secondOpinionCommand, visualReviewers, checkSettlements, draftHash, parseFindings, readDraftFile, reviewersFor, saveReview } from '../review/briefs.mjs'
import { changedBy, lineDiff, markSaved, readRounds, recordRound } from '../review/rounds.mjs'
import { inCodexSandbox } from '../state/local.mjs'
import { parseDraft } from '../steps/structure.mjs'
import { approvedBody, loadIssue, requireStep, title } from './common.mjs'
import { pinnedImage } from './wireframes.mjs'

// The draft, the approved Shape it builds on (for Design), and who reviews it.
export async function reviewSetup(ctx, step, file) {
  const draft = readDraftFile(file, step)
  if (draft.meta.step && draft.meta.step !== step) throw new Refusal(`${file} is a ${draft.meta.step} draft, not ${step}.`)
  let shape = null
  let shapeVersion = null
  if (step === 'design') {
    const state = await loadIssue(ctx.github(), ctx.issue(), ctx.config().approvals)
    const body = approvedBody(state.steps.shape)
    if (!body) throw new Refusal('Design needs an approved Shape first. Approve one with factory-foreman approve shape v<N>.')
    shape = parseDraft(body)
    shapeVersion = state.steps.shape.approvedCheckpoint.version
  }
  return { draft, shape, shapeVersion, reviewers: reviewersFor(step, ctx.config(), { draft, shape }) }
}

const readSaved = (dir, step, hash) => {
  if (!hash) return null
  try { return JSON.parse(readFileSync(reviewFile(dir, step, hash), 'utf8')) } catch { return null }
}

// Which round this review is, and who it briefs. The same draft again is the
// same round; a changed draft is the next one, up to review.maxRounds.
async function nextRound(ctx, { step, draft, digest, reviewers }) {
  const max = ctx.config().review?.maxRounds ?? 2
  const dir = ctx.stateDir()
  const base = draft.meta.base
  const rounds = readRounds(dir, step, base)
  const last = rounds.at(-1)
  const record = (k) => (r) => recordRound(dir, step, base, { k, hash: digest, body: draft.body, reviewers: r, at: ctx.now().toISOString() })
  const plain = { max, preface: () => '', record: () => {} }
  if (!last) return { ...plain, k: 1, reviewers, record: record(1) }
  // The same draft again: the same round, with the same briefs.
  if (last.hash === digest) {
    if (rounds.length > 1 && !last.reviewers.length) return { ...plain, k: rounds.length, none: nothingToReview(step, rounds.length - 1) }
    const prior = rounds.length > 1 ? readSaved(dir, step, rounds.at(-2).saved) : null
    // Reviewers new since the round before were briefed in full; they still are.
    const fresh = last.reviewers.filter((r) => !(r in (prior?.reviewers ?? {})))
    const brief = rounds.length > 1 ? preface(rounds.at(-2).body, draft, rounds.length, prior) : () => ''
    return { ...plain, k: rounds.length, reviewers: last.reviewers, preface: (r) => (fresh.includes(r) ? '' : brief(r)) }
  }
  if (rounds.length >= max) {
    throw new Refusal(`The ${title(step)} draft has had its ${max} review rounds since version ${base}. What's left is the person's to settle: accept a finding, overrule it with their reason, or note it as an open question (factory-foreman note "…" --kind question --step ${step}). Then save the settled findings for this draft: factory-foreman review save ${step} --findings <file>. There's no third round.`, { rounds: rounds.length, maxRounds: max })
  }
  const saved = readSaved(dir, step, last.saved)
  if (!saved) throw new Refusal(`Save round ${rounds.length}'s settled findings before the next round: factory-foreman review save ${step} --findings <file>.`)
  // Who reviews again: those whose findings changed the draft, and anyone new since.
  const fresh = reviewers.filter((r) => !(r in (saved.reviewers ?? {})))
  const again = [ ...new Set([ ...changedBy(saved), ...fresh ]) ].filter((r) => reviewers.includes(r))
  const k = rounds.length + 1
  if (!again.length) {
    // Recorded with no reviewers, so the save that follows carries every finding over.
    record(k)([])
    return { ...plain, k, none: nothingToReview(step, rounds.length) }
  }
  const brief = preface(last.body, draft, k, saved)
  return { ...plain, k, reviewers: again, preface: (r) => (fresh.includes(r) ? '' : brief(r)), record: record(k) }
}

const nothingToReview = (step, k) => `No reviewer's finding changed the ${title(step)} draft in round ${k}, so there's nothing to re-review. Save the review of this draft: factory-foreman review save ${step} --findings <file> with no findings needed (round ${k}'s settled findings carry over).`

// A later round's brief: what changed since the round before, and how the
// reviewer's own findings were settled.
function preface(before, draft, k, saved = null) {
  const { removed, added } = lineDiff(before, draft.body)
  return (reviewer) => [
    `Round ${k} of the review. Re-review only what changed since round ${k - 1}, to check your findings were settled well; don't start a new review of the whole draft.`,
    '', 'Lines removed:', ...(removed.length ? removed : [ '(none)' ]), '', 'Lines added:', ...(added.length ? added : [ '(none)' ]),
    ...(saved?.reviewers?.[reviewer] ? [ '', `Your round ${k - 1} findings and how they were settled: ${JSON.stringify(saved.reviewers[reviewer])}` ] : []),
    '', '',
  ].join('\n')
}

// factory-foreman review <shape|design> [--draft <file>] [--headless]
// factory-foreman review save <shape|design> --findings <file> [--draft <file>]
export async function review(ctx, args) {
  if (args.positionals[0] === 'save') return save(ctx, { ...args, positionals: args.positionals.slice(1) })
  const { positionals, flags } = args
  const step = requireStep(positionals[0])
  const n = ctx.issue()
  const file = flags.draft ?? ctx.draftPath(step)
  const { draft, shape, shapeVersion, reviewers: all } = await reviewSetup(ctx, step, file)
  const digest = draftHash(draft)
  const round = await nextRound(ctx, { step, draft, digest, reviewers: all })
  if (round.none) return { out: round.none, json: { step, issue: n, hash: digest, round: round.k, briefs: [] } }
  const reviewers = round.reviewers
  // Each pinned wireframe as a file that is exactly the pinned image.
  const images = []
  for (const w of draft.wireframes.filter((w) => w.id && w.commit && w.path && w.hash)) images.push({ id: w.id, state: w.state, path: await pinnedImage(ctx, w), url: w.url })
  const looking = visualReviewers(step, ctx.config())
  const briefs = reviewers.map((reviewer) => ({
    reviewer,
    command: reviewer === SECOND_OPINION ? secondOpinionCommand(ctx.config(), ctx.harness) : null,
    brief: `${round.preface(reviewer)}${brief({ reviewer, step, issue: n, draft, shape, shapeVersion, images: looking.has(reviewer) ? images : [] })}`,
  }))
  round.record(reviewers)

  if (!flags.headless) {
    const lines = [ `Review of the ${title(step)} draft for #${n} (draft hash ${digest}), round ${round.k} of ${round.max}${round.k > 1 ? `: only ${reviewers.join(', ')}, on what changed since round ${round.k - 1}` : ''}.` ]
    if (!briefs.length) lines.push(`No reviewers are configured for ${step}; checkpoint needs no review.`)
    for (const b of briefs) {
      lines.push('', `=== ${b.reviewer}${b.command ? ` (pipe this brief into: ${b.command.join(' ')})` : ` (run as a subagent: the ${b.reviewer} agent)`} ===`, b.brief)
    }
    if (briefs.length) lines.push('', `Settle every finding (accepted, changed or overruled with a reason), then: factory-foreman review save ${step} --findings <file>${round.k > 1 ? ` (with findings for ${reviewers.join(', ')}; the others' round-${round.k - 1} findings carry over)` : ''}.${round.k >= round.max ? ` This is the last round: what's left after it is the person's to settle, not another review.` : ''}`)
    return { out: lines.join('\n'), json: { step, issue: n, hash: digest, round: round.k, maxRounds: round.max, briefs } }
  }

  // --headless: every brief through a command, for harnesses without subagents
  // and CI. Inside Codex's sandbox a nested Codex can't start, and Codex has
  // subagents, so say so instead of failing on each brief.
  const agents = briefs.filter((b) => !b.command).map((b) => b.reviewer)
  if (agents.length && inCodexSandbox(ctx.env)) {
    throw new Refusal(`review --headless doesn't run inside Codex: a nested Codex can't start there, and Codex has subagents. Get the briefs with factory-foreman review ${step} --issue ${n}, run each as a subagent by its agent name (${agents.join(', ')}), pipe any brief that names a command into that command, then factory-foreman review save ${step} --findings <file>.`)
  }
  const findings = {}
  const failures = {}
  for (const b of briefs) {
    const command = b.command ?? ctx.config().review.headless.command
    // The reviewer's own session must not be captured as this feature's notes.
    const result = await ctx.exec(command, { cwd: ctx.cwd, env: { ...ctx.env, FACTORY_FOREMAN_CAPTURE: '1' }, input: b.brief })
    try {
      if (result.code !== 0) throw new Error(`exited with code ${result.code}: ${String(result.stderr).trim().split('\n').at(-1) ?? ''}`)
      findings[b.reviewer] = parseFindings(result.stdout)
    } catch (error) {
      failures[b.reviewer] = error.message
    }
  }
  const lines = [ `Headless review of the ${title(step)} draft for #${n} (draft hash ${digest}), round ${round.k} of ${round.max}${round.k > 1 ? `: only ${reviewers.join(', ')}` : ''}.` ]
  for (const [ reviewer, list ] of Object.entries(findings)) {
    lines.push('', `${reviewer}: ${list.length ? `${list.length} finding(s)` : 'no findings'}`)
    for (const f of list) lines.push(`- [${f.severity}] ${f.id}: ${f.text}${f.where ? ` (${f.where})` : ''}`)
  }
  for (const [ reviewer, message ] of Object.entries(failures)) lines.push('', `${reviewer}: FAILED (${message}). Run it again or review it another way.`)
  if (briefs.length) lines.push('', `Settle every finding, then: factory-foreman review save ${step} --findings <file>`)
  if (Object.keys(failures).length) throw new Refusal(lines.join('\n'), { hash: digest, findings, failures })
  return { out: lines.join('\n'), json: { step, issue: n, hash: digest, findings } }
}

async function save(ctx, { positionals, flags }) {
  const step = requireStep(positionals[0])
  if (typeof flags.findings !== 'string') throw new Refusal(`Name the settled findings: factory-foreman review save ${step} --findings <file>.`)
  const file = flags.draft ?? ctx.draftPath(step)
  const { draft, reviewers } = await reviewSetup(ctx, step, file)
  let findings
  try {
    findings = JSON.parse(readFileSync(flags.findings, 'utf8'))
  } catch (error) {
    throw new Refusal(`Can't read ${flags.findings} as JSON: ${error.message}`)
  }
  // A later round re-reviews some reviewers, who must answer; the others'
  // settled findings carry over from the round before.
  const rounds = readRounds(ctx.stateDir(), step, draft.meta.base)
  const roundNo = Math.max(1, rounds.length)
  if (roundNo > 1 && findings?.reviewers && typeof findings.reviewers === 'object' && !Array.isArray(findings.reviewers)) {
    const earlier = readSaved(ctx.stateDir(), step, rounds.at(-2).saved)
    const thisRound = readSaved(ctx.stateDir(), step, rounds.at(-1).saved)
    const asked = new Set(rounds.at(-1).reviewers ?? [])
    // The others carry over from the round before; those asked again from their
    // own earlier save in this round, once they've answered it.
    for (const r of reviewers) {
      if (r in findings.reviewers) continue
      if (!asked.has(r) && earlier?.reviewers?.[r]) findings.reviewers[r] = earlier.reviewers[r]
      else if (asked.has(r) && thisRound?.reviewers?.[r]) findings.reviewers[r] = thisRound.reviewers[r]
    }
  }
  const problems = checkSettlements(findings, reviewers)
  if (problems.length) throw new Refusal(`The review can't be saved yet:\n  - ${problems.join('\n  - ')}`, { problems })
  const { file: saved, digest } = saveReview(ctx.stateDir(), { step, draft, reviewers, findings, at: ctx.now().toISOString(), round: roundNo })
  markSaved(ctx.stateDir(), step, draft.meta.base, digest)
  const count = reviewers.reduce((sum, r) => sum + findings.reviewers[r].length, 0)
  return { out: `Saved the review of the ${title(step)} draft (hash ${digest.slice(0, 12)}, ${count} finding(s) settled by ${reviewers.join(', ')}). Edit the draft again and you'll need to save again.`, json: { step, hash: digest, file: saved, reviewers } }
}
