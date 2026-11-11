import { Refusal } from '../errors.mjs'
import { hash, isApproved, parseLabel, recordComment } from '../issue/records.mjs'
import { writeDecisions } from '../issue/decisions.mjs'
import { inert, setSection, updateBody, withDecisionsLine } from '../issue/sections.mjs'
import { statusLine } from '../issue/status.mjs'
import { parseDraft } from '../steps/structure.mjs'
import { loadSlice } from '../slices/state.mjs'
import { agentShell } from '../state/local.mjs'
import { loadIssue, requireStep, title, today } from './common.mjs'

const WRITE = new Set([ 'admin', 'maintain', 'write' ])

// factory-foreman approve <shape|design> v<N>
// Only from an interactive terminal (never an agent's shell), after a y/N
// question showing what is being approved, and posted
// under the approver's own login.
export async function approve(ctx, { positionals }) {
  if (positionals[0] === 'slice') return approveSlice(ctx, positionals[1])
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
  // The approval is recorded either way; a failed Decisions write is reported, not fatal.
  let count = 0
  let warning = null
  try {
    count = await writeDecisions(github, n, [ row ], { body: state.issue.body })
  } catch (error) {
    warning = `The approval is recorded, but the Decisions artifact wasn't updated (${error.message}).`
  }
  await updateBody(github, n, (b) => setSection(withDecisionsLine(setSection(b, step, section), count), 'status', statusLine(states)))
  return { out: `Approved ${title(step)} ${version} on #${n}.`, json: record, ...(warning ? { err: warning } : {}) }
}

// factory-foreman approve slice <k>
// Approves the slice PR's current head for slice merge, for a person who
// can't approve on GitHub because they opened the PR. Same terminal rules as
// a step approval, posted under the approver's login on the slice PR, bound
// to the head commit: a new commit needs a new approval.
async function approveSlice(ctx, which) {
  const k = Number(which)
  if (!/^\d+$/.test(String(which ?? '')) || k < 1) throw new Refusal('Name the slice: factory-foreman approve slice <n>.')
  const blocked = agentShell({ env: ctx.env, isTTY: ctx.isTTY })
  if (blocked) throw new Refusal(`approve must be run by a person in their own terminal, and ${blocked}.`)
  const n = ctx.issue()
  const github = ctx.github()
  const config = ctx.config()
  if (config.approvals.requireSecondApprover) throw new Refusal(`This repo requires a second approver, so slice ${k} is approved in a GitHub review of its PR by someone other than its author.`)
  await github.appReady()
  const slice = await loadSlice(ctx, github, n, k)
  if (!slice || slice.state !== 'open') throw new Refusal(`Slice ${k} isn't open.`)
  const pr = await github.pr(slice.pr)
  if (pr.state !== 'OPEN') throw new Refusal(`#${slice.pr} is ${String(pr.state).toLowerCase()}.`)
  const sha = pr.headRefOid
  const short = (x) => String(x).slice(0, 7)
  const iteration = slice.iterations?.find((it) => it.head === sha)
  if (!iteration) throw new Refusal(`#${slice.pr}'s head ${short(sha)} isn't an iteration: run factory-foreman slice iterate ${k} on it first.`)
  const approver = await github.viewer()
  if (!WRITE.has(await github.permission(approver))) throw new Refusal(`@${approver} needs write access to ${github.repo} to approve.`)
  const answer = (await ctx.prompt(`Slice ${k} of #${n}: #${slice.pr} at ${short(sha)} (iteration ${iteration.k ?? slice.iterations.indexOf(iteration) + 1}). Read its diff and evidence first.\nApprove slice ${k} at ${short(sha)} as @${approver}? [y/N] `)).trim()
  if (!/^(y|yes)$/i.test(answer)) throw new Refusal('Not approved.')
  // A push while the person was reading moves the head: approve what they saw only.
  if ((await github.pr(slice.pr)).headRefOid !== sha) throw new Refusal(`#${slice.pr} moved while you were confirming, so ${short(sha)} isn't its head any more. Read the new head and approve that.`)
  const record = { type: 'slice-approval', repo: github.repo, issue: n, slice: k, pr: slice.pr, head: sha, approver, at: ctx.now().toISOString() }
  await github.comment(slice.pr, recordComment(`Approved **slice ${k}** at ${short(sha)}.`, record), 'user')
  return { out: `Approved slice ${k} (#${slice.pr}) at ${short(sha)}. Once CI is green: factory-foreman slice merge ${k}.`, json: record }
}
