import { Refusal } from '../errors.mjs'
import { hash, recordComment } from '../issue/records.mjs'
import { addDecisionRows, inert, setSection, updateBody } from '../issue/sections.mjs'
import { statusLine } from '../issue/status.mjs'
import { parseDraft } from '../steps/structure.mjs'
import { agentShell } from '../state/local.mjs'
import { loadIssue, requireStep, title, today } from './common.mjs'

const WRITE = new Set([ 'admin', 'maintain', 'write' ])

// factory-foreman approve <shape|design> v<N>
// Only from an interactive terminal, with a typed confirmation, and posted
// under the approver's own login.
export async function approve(ctx, { positionals }) {
  const step = requireStep(positionals[0])
  const version = positionals[1]
  if (!/^v\d+(\.\d+)?$/.test(version ?? '')) throw new Refusal(`Name the version: factory-foreman approve ${step} v<N>.`)
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
  if (info.approved && info.approved.checkpoint === info.latest.comment.id) throw new Refusal(`${title(step)} ${version} is already approved.`)
  const current = info.current
  if (!current || current.version !== info.latest.artifact.version || hash(current.body) !== info.latest.hash) {
    throw new Refusal(`${title(step)} was changed on GitHub after ${version} was posted, so ${version} can't be approved as is. Checkpoint the change first.`)
  }

  const approver = await github.viewer()
  if (!WRITE.has(await github.permission(approver))) throw new Refusal(`@${approver} needs write access to ${github.repo} to approve.`)
  if (config.approvals.requireSecondApprover && approver === info.latest.author) throw new Refusal(`This repo requires a second approver: @${approver} posted ${version}, so someone else approves it.`)

  const phrase = `approve ${step} ${version}`
  const typed = (await ctx.prompt(`Approving ${title(step)} ${version} on #${n} as @${approver}. Type "${phrase}" to confirm: `)).trim()
  if (typed !== phrase) throw new Refusal('Not approved: the confirmation didn\'t match.')
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
  await updateBody(github, n, (b) => setSection(addDecisionRows(setSection(b, step, section), [ row ]), 'status', statusLine(states)))
  return { out: `Approved ${title(step)} ${version} on #${n}.`, json: record }
}
