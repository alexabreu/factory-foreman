import { readFileSync } from 'node:fs'
import { Refusal } from '../errors.mjs'
import { SECOND_OPINION, brief, secondOpinionCommand, visualReviewers, checkSettlements, draftHash, parseFindings, readDraftFile, reviewersFor, saveReview } from '../review/briefs.mjs'
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

// factory-foreman review <shape|design> [--draft <file>] [--headless]
// factory-foreman review save <shape|design> --findings <file> [--draft <file>]
export async function review(ctx, args) {
  if (args.positionals[0] === 'save') return save(ctx, { ...args, positionals: args.positionals.slice(1) })
  const { positionals, flags } = args
  const step = requireStep(positionals[0])
  const n = ctx.issue()
  const file = flags.draft ?? ctx.draftPath(step)
  const { draft, shape, shapeVersion, reviewers } = await reviewSetup(ctx, step, file)
  const digest = draftHash(draft)
  // Each pinned wireframe as a file that is exactly the pinned image.
  const images = []
  for (const w of draft.wireframes.filter((w) => w.id && w.commit && w.path && w.hash)) images.push({ id: w.id, state: w.state, path: await pinnedImage(ctx, w), url: w.url })
  const looking = visualReviewers(step, ctx.config())
  const briefs = reviewers.map((reviewer) => ({
    reviewer,
    command: reviewer === SECOND_OPINION ? secondOpinionCommand(ctx.config(), ctx.harness) : null,
    brief: brief({ reviewer, step, issue: n, draft, shape, shapeVersion, images: looking.has(reviewer) ? images : [] }),
  }))

  if (!flags.headless) {
    const lines = [ `Review of the ${title(step)} draft for #${n} (draft hash ${digest}).` ]
    if (!briefs.length) lines.push(`No reviewers are configured for ${step}; checkpoint needs no review.`)
    for (const b of briefs) {
      lines.push('', `=== ${b.reviewer}${b.command ? ` (pipe this brief into: ${b.command.join(' ')})` : ` (run as a subagent: the ${b.reviewer} agent)`} ===`, b.brief)
    }
    if (briefs.length) lines.push('', `Settle every finding (accepted, changed or overruled with a reason), then: factory-foreman review save ${step} --findings <file>`)
    return { out: lines.join('\n'), json: { step, issue: n, hash: digest, briefs } }
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
  const lines = [ `Headless review of the ${title(step)} draft for #${n} (draft hash ${digest}).` ]
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
  const problems = checkSettlements(findings, reviewers)
  if (problems.length) throw new Refusal(`The review can't be saved yet:\n  - ${problems.join('\n  - ')}`, { problems })
  const { file: saved, digest } = saveReview(ctx.stateDir(), { step, draft, reviewers, findings, at: ctx.now().toISOString() })
  const count = reviewers.reduce((sum, r) => sum + findings.reviewers[r].length, 0)
  return { out: `Saved the review of the ${title(step)} draft (hash ${digest.slice(0, 12)}, ${count} finding(s) settled by ${reviewers.join(', ')}). Edit the draft again and you'll need to save again.`, json: { step, hash: digest, file: saved, reviewers } }
}
