import { isApproved } from '../issue/records.mjs'
import { readLog } from '../state/local.mjs'
import { STEPS, after, approvedBody, loadIssue, title } from './common.mjs'
import { slicesFor } from './slice.mjs'

// A blocking question stays open until the step it's about (or, with no step,
// any step) posts a version after it.
export function openQuestions(log, steps) {
  const latestAt = (step) => steps[step]?.latest?.at ?? null
  return log.filter((e) => e.kind === 'question' && e.blocking && e.confirmed !== false && !e.dropped).filter((e) => {
    const since = e.step ? [ latestAt(e.step) ] : STEPS.map(latestAt)
    return since.every((at) => !at || after(e.at, at))
  })
}

// factory-foreman status [--json]
export async function status(ctx) {
  const n = ctx.issue()
  const state = await loadIssue(ctx.github(), n, ctx.config().approvals)
  const steps = {}
  const lines = [ `#${n}: ${state.issue.title}` ]
  for (const step of STEPS) {
    const info = state.steps[step]
    const latest = info.latest?.version ?? null
    const approved = info.approvedCheckpoint?.version ?? null
    steps[step] = { latest, approved, approval: info.approved?.version ?? null, latestApproved: isApproved(info) }
    const line = !latest ? 'not started'
      : isApproved(info) ? `${latest} approved${info.approved.version !== latest ? ` (carries ${info.approved.version})` : ''}`
        : `${latest} awaiting approval${approved ? ` (${approved} approved)` : ''}`
    lines.push(`${title(step)}: ${line}`)
  }
  const questions = openQuestions(readLog(ctx.stateDir()), state.steps)
  lines.push(questions.length ? `Open blocking questions (${questions.length}):` : 'Open blocking questions: none')
  for (const q of questions) lines.push(`- ${q.text}${q.step ? ` (${q.step})` : ''}`)
  // Slices from this checkout's record of them; one pinned below the approved
  // Shape or Design is stale until it's rebuilt against them.
  // From each slice's PR record; a minor amendment keeps its version's approval.
  const slices = Object.values(await slicesFor(ctx, ctx.github(), n, approvedBody(state.steps.design))).sort((a, b) => a.n - b.n).map((s) => ({
    ...s,
    stale: s.state === 'open' && (s.pinned?.shape?.version !== steps.shape.approval || s.pinned?.design?.version !== steps.design.approval),
  }))
  if (!slices.length) lines.push('Slices: none yet')
  else lines.push('Slices:', ...slices.map((s) => `- ${s.n}. ${s.state}${s.pr ? `, #${s.pr}` : ''}, @${s.owner}, ${s.iterations?.length ?? 0} iteration(s), pinned to Shape ${s.pinned?.shape?.version} / Design ${s.pinned?.design?.version}${s.stale ? ' (STALE: newer approved versions)' : ''}`))
  return { out: lines.join('\n'), json: { issue: n, steps, questions, slices } }
}
