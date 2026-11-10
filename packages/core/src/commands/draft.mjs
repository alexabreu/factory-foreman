import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hash } from '../issue/records.mjs'
import { parseDraft, splitFrontMatter, withFrontMatter } from '../steps/structure.mjs'
import { readLog } from '../state/local.mjs'
import { after, approvedBody, loadIssue, requireStep, title } from './common.mjs'

const SKELETON = {
  shape: 'One paragraph: the problem and the outcome, in under 100 words.\n\n## Problem\n\n## Who it\'s for\n\n## Out of scope\n\n## Acceptance criteria\n| ID | Criterion | Visual |\n| --- | --- | --- |\n| AC-1 |  |  |\n',
  design: 'One paragraph: the approach, in under 100 words.\n\n## Approach\n\n## Contracts\n```contract\n{ "name": "", "testIds": [], "files": [] }\n```\n\n## Visual behaviors\n\n## Slices\n1. Title (AC-1)\n',
}

// Log entries since a version was posted, with extracted ones marked.
export function entriesSince(log, at, step) {
  return log.filter((e) => after(e.at, at) && (!e.step || e.step === step))
}

// factory-foreman draft <shape|design> [--reset]
export async function draft(ctx, { positionals, flags }) {
  const step = requireStep(positionals[0])
  const n = ctx.issue()
  const state = await loadIssue(ctx.github(), n, ctx.config().approvals)
  const info = state.steps[step]
  const current = info.current
  const base = current?.version ?? 0
  const file = flags.draft ?? ctx.draftPath(step)
  const entries = entriesSince(readLog(ctx.stateDir()), current?.createdAt, step)

  let stale = null
  let backup = null
  if (existsSync(file) && !flags.reset) {
    const { meta } = splitFrontMatter(readFileSync(file, 'utf8'))
    if (meta.base !== base) stale = `Your draft started from version ${meta.base}; the latest is ${base}. Redraft from the latest, or run draft ${step} --reset to start over from it.`
  } else {
    // --reset keeps the old draft next to the new one, so no work is lost.
    if (flags.reset && existsSync(file)) {
      renameSync(file, `${file}.bak`)
      backup = `${file}.bak`
    }
    const body = current?.body ?? SKELETON[step]
    writeFileSync(file, withFrontMatter({ step, issue: n, base, baseHash: current ? hash(current.body) : '' }, body))
  }

  const shape = step === 'design' ? approvedBody(state.steps.shape) : null
  const budget = ctx.config().budgets.words
  const lines = [
    `Drafting ${title(step)} for #${n}. Draft file: ${file}`,
    `Budget: lead ${budget.lead} words, ${step} ${budget[step]} words. Reference: the factory-foreman skill's references/${step}.md.`,
    current ? `Latest: version ${base}${info.latest ? ` (${info.latest.version} by @${info.latest.author})` : ''}${info.approved ? `; ${info.approved.version} is approved` : ''}.` : `No ${title(step)} yet: this will be v1.`,
  ]
  if (stale) lines.push(`STALE: ${stale}`)
  if (backup) lines.push(`Your previous draft is at ${backup}; fold back in what should stay.`)
  if (step === 'design' && !shape) lines.push('Shape has no approved version yet; Design can be drafted but not checkpointed until it does.')
  lines.push('', entries.length ? `Notes since the latest version (${entries.length}):` : 'No notes since the latest version.')
  for (const e of entries) lines.push(`- [${e.kind}${e.confirmed ? '' : ', unconfirmed: keep, edit or drop'}] ${e.text}`)
  if (shape) lines.push('', `Approved Shape (${state.steps.shape.approved.version}), acceptance criteria:`, ...parseDraft(shape).criteria.map((c) => `- ${c.id}: ${c.criterion}${c.visual ? ' (visual)' : ''}`))
  return { out: lines.join('\n'), json: { step, issue: n, file, base, stale, entries, approvedShape: shape } }
}
