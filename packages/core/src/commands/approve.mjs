import { Refusal } from '../errors.mjs'
import { hash, isApproved, parseLabel, recordComment } from '../issue/records.mjs'
import { writeDecisions } from '../issue/decisions.mjs'
import { inert, setSection, updateBody, withDecisionsLine } from '../issue/sections.mjs'
import { statusLine } from '../issue/status.mjs'
import { parseDraft } from '../steps/structure.mjs'
import { agentShell } from '../state/local.mjs'
import { loadIssue, requireStep, title, today } from './common.mjs'

const WRITE = new Set([ 'admin', 'maintain', 'write' ])

// factory-foreman approve <shape|design> v<N>
// Only from an interactive terminal (never an agent's shell), after a y/N
// question showing what is being approved, and posted
// under the approver's own login.
export async function approve(ctx, { positionals }) {
  const step = requireStep(positionals[0])
  const version = positionals[1]
  const label = parseLabel(version ?? '')
  if (!label) throw new Refusal(`Name the version: factory-foreman approve ${step} v<N>.`)
  if (label.minor) throw new Refusal(`${version} is a minor amendment: it carries v${label.major}'s approval, so there is nothing to approve. A material change gets its own version (v<N>) to approve.`)
  const blocked = agentShell({ env: ctx.env, isTTY: ctx.isTTY })
  if (blocked) throw new Refusal(`approve must be run by a person in their own terminal, and ${blocked}.`)

  const n = ctx.issue()
  const github = ctx.github()
  const config = ctx.config()
  await github.appReady()
  const state = await loadIssue(github, n, config.approvals)
  const info = state.steps[step]
  if (!info.latest) throw new Refusal(`${title(step)} has no posted version on #${n}.`)
  if (info.latest.version !== version) throw new Refusal(`${version} isn't the latest ${title(step)}; ${info.latest.version} is. Read it and approve that one.`)
  if (isApproved(info)) throw new Refusal(`${title(step)} ${version} is already approved.`)
  const current = info.current
  if (!current || current.version !== info.latest.artifact.version || hash(current.body) !== info.latest.hash) {
    throw new Refusal(`${title(step)} was changed on GitHub after ${version} was posted, so ${version} can't be approved as is. Checkpoint the change first.`)
  }

  const approver = await github.viewer()
  if (!WRITE.has(await github.permission(approver))) throw new Refusal(`@${approver} needs write access to ${github.repo} to approve.`)
  if (config.approvals.requireSecondApprover && approver === info.latest.author) throw new Refusal(`This repo requires a second approver: @${approver} posted ${version}, so someone else approves it.`)

  // Show what is being approved, then ask once. The terminal checks above are
  // the protection; the question guards against approving the wrong thing.
  // Control characters are stripped, so the text shown is the text approved.
  const plain = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  const shown = parseDraft(current.body)
  const items = step === 'shape' ? shown.criteria.map((c) => `  ${plain(c.id)}: ${plain(c.criterion)}${c.visual ? ' (visual)' : ''}`) : shown.slices.map((s) => `  ${s.n}. ${plain(s.title)}${s.acs.length ? ` (${plain(s.acs.join(', '))})` : ''}`)
  const summary = [ `${title(step)} ${version} on #${n}${state.issue.url ? ` (${plain(state.issue.url)})` : ''}, posted by @${plain(info.latest.author)}:`, ...(items.length ? items : [ `  ${plain(shown.lead)}` ]) ].join('\n')
  const answer = (await ctx.prompt(`${summary}\nApprove ${title(step)} ${version} on #${n} as @${approver}? [y/N] `)).trim()
  if (!/^(y|yes)$/i.test(answer)) throw new Refusal('Not approved.')
  // Someone may have checkpointed while the person was reading and typing.
  const fresh = (await loadIssue(github, n, config.approvals)).steps[step]
  if (fresh.latest?.comment.id !== info.latest.comment.id) throw new Refusal(`${title(step)} ${fresh.latest?.version ?? '?'} was posted while you were confirming, so ${version} isn't the latest any more. Read it and approve that one.`)

  const now = ctx.now()
  const record = { type: 'approval', repo: github.repo, issue: n, step, version, checkpoint: info.latest.comment.id, artifact: info.latest.artifact, hash: info.latest.hash, approver, at: now.toISOString() }
  await github.comment(n, recordComment(`Approved **${title(step)} ${version}**.`, record), 'user')

  const draft = parseDraft(current.body)
  const states = (await loadIssue(github, n, config.approvals)).steps
  const section = `## ${title(step)} ${version} (approved)\n\n${inert(draft.lead)}\n\n<details><summary>Full ${title(step)} ${version}</summary>\n\n${inert(current.body.trim())}\n\n</details>`
  const row = { date: today(now), text: `Approved ${title(step)} ${version}`, by: `@${approver}`, step: `${title(step)} ${version}` }
  const count = await writeDecisions(github, n, [ row ], { body: state.issue.body })
  await updateBody(github, n, (b) => setSection(withDecisionsLine(setSection(b, step, section), count), 'status', statusLine(states)))
  return { out: `Approved ${title(step)} ${version} on #${n}.`, json: record }
}
