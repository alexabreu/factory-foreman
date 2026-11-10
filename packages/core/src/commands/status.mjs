import { isApproved } from '../issue/records.mjs'
import { readLog } from '../state/local.mjs'
import { STEPS, after, loadIssue, title } from './common.mjs'

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
    steps[step] = { latest, approved, latestApproved: isApproved(info) }
    const line = !latest ? 'not started'
      : isApproved(info) ? `${latest} approved${info.approved.version !== latest ? ` (carries ${info.approved.version})` : ''}`
        : `${latest} awaiting approval${approved ? ` (${approved} approved)` : ''}`
    lines.push(`${title(step)}: ${line}`)
  }
  const questions = openQuestions(readLog(ctx.stateDir()), state.steps)
  lines.push(questions.length ? `Open blocking questions (${questions.length}):` : 'Open blocking questions: none')
  for (const q of questions) lines.push(`- ${q.text}${q.step ? ` (${q.step})` : ''}`)
  lines.push('Slices: none yet')
  return { out: lines.join('\n'), json: { issue: n, steps, questions, slices: [] } }
}
