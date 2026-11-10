import { artifactEntry, bodyLine, unifiedDiff } from '../changelog.mjs'
import { Refusal } from '../errors.mjs'
import { byBot, hash, isApproved, nextMinor, nextVersion, parseLabel, recordComment } from '../issue/records.mjs'
import { addChangelogLine, addDecisionRows, setSection, updateBody } from '../issue/sections.mjs'
import { statusLine } from '../issue/status.mjs'
import { postedBody, readDraftFile, requireReview, reviewersFor } from '../review/briefs.mjs'
import { checkStructure, parseDraft, structuralBlocks } from '../steps/structure.mjs'
import { readLog } from '../state/local.mjs'
import { entriesSince } from './draft.mjs'
import { approvedBody, loadIssue, requireStep, sameText, title, today } from './common.mjs'

// The entries of a Changelog body: each "## " heading with what follows it.
const logEntries = (body) => String(body ?? '').replace(/\r\n/g, '\n').split(/\n(?=## )/).slice(1).map((e) => e.trim())

// factory-foreman checkpoint <shape|design> [--draft <file>]
export function checkpoint(ctx, { positionals, flags }) {
  return post(ctx, { step: requireStep(positionals[0]), file: flags.draft, amend: null })
}

// factory-foreman amend <shape|design> --reason <text> [--draft <file>]
// Only after the step's latest version is approved. When the acceptance
// criteria, contracts, visual behaviors and slices are unchanged, the
// amendment is minor (vN.M) and keeps vN's approval; otherwise it is material
// (vN+1) and needs approval.
export function amend(ctx, { positionals, flags }) {
  const step = requireStep(positionals[0])
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : ''
  if (!reason) throw new Refusal(`Say why: factory-foreman amend ${step} --reason "<why>".`)
  return post(ctx, { step, file: flags.draft, amend: { reason } })
}

async function post(ctx, { step, file: given, amend: amending }) {
  const n = ctx.issue()
  const file = given ?? ctx.draftPath(step)
  const draft = readDraftFile(file, step)
  if (draft.meta.step && draft.meta.step !== step) throw new Refusal(`${file} is a ${draft.meta.step} draft, not ${step}.`)
  if (draft.meta.issue !== undefined && draft.meta.issue !== ctx.issue()) throw new Refusal(`${file} is a draft for #${draft.meta.issue}, not #${ctx.issue()}.`)
  if (!Number.isInteger(draft.meta.base)) throw new Refusal(`${file} has no "base" in its front matter, so it can't be checked for staleness. Run factory-foreman draft ${step}.`)

  const github = ctx.github()
  const config = ctx.config()
  await github.appReady()
  const state = await loadIssue(github, n, config.approvals)
  const info = state.steps[step]
  const current = info.current
  const latest = current?.version ?? 0
  if (draft.meta.base !== latest) {
    const by = current?.actor?.login ?? current?.actor ?? 'someone'
    throw new Refusal(`Stale: ${title(step)} is at version ${latest} (last written by ${by}), and your draft started from version ${draft.meta.base}. Run factory-foreman draft ${step} --reset, fold in your changes, and checkpoint again.`, { latest, base: draft.meta.base })
  }
  if (current && draft.meta.baseHash && draft.meta.baseHash !== hash(current.body)) throw new Refusal(`Stale: ${title(step)} version ${latest} doesn't match the one your draft started from.`)

  let shape = null
  if (step === 'design') {
    const body = approvedBody(state.steps.shape)
    if (!body) throw new Refusal('Design needs an approved Shape first. Approve one with factory-foreman approve shape v<N>.')
    shape = parseDraft(body)
  }
  const problems = checkStructure(step, draft, { budgets: config.budgets, shape })
  if (problems.length) throw new Refusal(`The ${step} draft isn't ready:\n  - ${problems.join('\n  - ')}`, { problems })

  const body = postedBody(draft)
  const recordedBody = info.latest ? info.artifact?.versions.find((v) => v.version === info.latest.artifact.version)?.body ?? null : null

  // An amendment changes an approved version. It is minor when every block
  // other work depends on is unchanged, and then keeps the approval.
  if (amending) {
    if (!info.latest) throw new Refusal(`${title(step)} has no posted version on #${n} to amend. Checkpoint it instead.`)
    if (!isApproved(info)) throw new Refusal(`${title(step)} ${info.latest.version} isn't approved, so there is nothing to amend: change the draft and run factory-foreman checkpoint ${step}.`)
    if (recordedBody === null) throw new Refusal(`Can't find ${title(step)} ${info.latest.version} in its artifact's history to compare the amendment with.`)
    if (sameText(recordedBody, body)) throw new Refusal(`The draft is the same as ${title(step)} ${info.latest.version}; nothing to amend.`)
    amending.minor = structuralBlocks(parseDraft(recordedBody)) === structuralBlocks(draft)
    amending.carries = info.approved.version
    amending.slices = []
  }

  // Extracted notes are only guesses until someone keeps or drops them.
  const unconfirmed = entriesSince(readLog(ctx.stateDir()), info.latest?.at, step).filter((e) => e.confirmed === false)
  if (unconfirmed.length) {
    throw new Refusal(`${unconfirmed.length} extracted note(s) since ${info.latest?.version ?? 'the start'} aren't confirmed. Keep, edit or drop each one (factory-foreman note --keep <id>, --edit <id> "<text>", --drop <id>):\n${unconfirmed.map((e) => `  - ${e.id}: [${e.kind}] ${e.text}`).join('\n')}`, { unconfirmed: unconfirmed.map((e) => e.id) })
  }

  // The reviewers must have reviewed this exact text, and every finding be settled.
  const review = requireReview(ctx.stateDir(), { step, draft, reviewers: reviewersFor(step, config, { draft, shape }) })
  // The latest version may already hold this text without a record: a
  // checkpoint that failed after posting, or someone pasting it in. Then the
  // record is all that's missing, and the artifact isn't written again.
  const recordedVersion = info.latest?.artifact?.version ?? 0
  const recorded = Boolean(current && recordedVersion === current.version && info.latest.hash === hash(current.body))
  if (current && sameText(current.body, body) && recorded) throw new Refusal(`The draft is the same as ${title(step)} ${info.latest.version}; nothing to post.`)
  // Adopt only the one version right after the last recorded one, and only if
  // the App wrote it; anything else hides someone's write, so say so instead.
  const adopt = Boolean(current && sameText(current.body, body) && !recorded)
  if (adopt && (current.version !== recordedVersion + 1 || !byBot(current, github.botLogin))) {
    throw new Refusal(`${title(step)} has unrecorded versions ${recordedVersion + 1} to ${current.version} since ${info.latest?.version ?? 'the start'}, not all written by the factory. Read them (gh issue artifact view ${n} ${info.artifact.number} --json versions), fold in what should stay, change the draft, and checkpoint again.`)
  }

  const author = await github.viewer()
  const version = amending?.minor ? nextMinor(info, parseLabel(info.approved.version).major) : nextVersion(info)
  const previous = info.latest?.version ?? null
  const now = ctx.now()
  const date = today(now)
  // Diff against the last recorded version, so an unrecorded edit in between shows up too.
  const before = info.latest ? recordedBody ?? '' : null
  const diff = before === null ? '' : unifiedDiff(before, body, { from: previous, to: version })
  const notes = entriesSince(readLog(ctx.stateDir()), info.latest?.at, step).filter((e) => e.confirmed && e.kind !== 'question')

  // 1. The artifact: a new version of it, unless it already holds the text.
  let number = info.artifact?.number
  let posted = current
  if (!adopt) {
    if (number) await github.editArtifact(n, number, body, 'app')
    else {
      number = await github.createArtifact(n, title(step), body, 'app')
      const firstNumber = Math.min(...(await github.artifacts(n)).filter((a) => a.name === title(step)).map((a) => a.number))
      if (firstNumber !== number) throw new Refusal(`Someone created ${title(step)} at the same moment (artifact ${firstNumber}), so artifact ${number} isn't recorded. Run factory-foreman draft ${step} --reset and checkpoint again.`)
    }
    const history = await github.history(n, number)
    posted = history.versions.at(-1)
    if (!posted || posted.version !== latest + 1 || !sameText(posted.body, body) || !byBot(posted, github.botLogin)) {
      throw new Refusal(`Someone wrote ${title(step)} at the same moment, so artifact version ${posted?.version ?? '?'} isn't recorded. Run factory-foreman draft ${step} --reset, check it, and checkpoint again.`)
    }
  }

  // 2. The changelog artifact, one full entry per version.
  const entry = artifactEntry({ step, version, previous, date, author, harness: ctx.harness, diff, notes: notes.map((e) => `${e.kind === 'rejected' ? 'Rejected: ' : ''}${e.text}`), amend: amending })
  // Another checkpoint may append at the same moment, from the same version,
  // and either write could drop the other's entry. So each write holds every
  // entry any App-written version has held, plus ours, and is checked again.
  let changelog = state.changelog?.number
  if (!changelog) changelog = await github.createArtifact(n, 'Changelog', `# Changelog\n\n${entry}`, 'app')
  for (let i = 0; ; i++) {
    const versions = (await github.history(n, changelog)).versions
    const all = []
    for (const v of versions.filter((v) => byBot(v, github.botLogin))) for (const e of logEntries(v.body)) if (!all.includes(e)) all.push(e)
    if (!all.includes(entry.trim())) all.push(entry.trim())
    const latestEntries = logEntries(versions.at(-1)?.body)
    if (all.every((e) => latestEntries.includes(e))) break
    if (i === 3) throw new Refusal(`The Changelog on #${n} kept changing, so ${title(step)} ${version}'s entry isn't in it. Checkpoint again.`)
    await github.editArtifact(n, changelog, `# Changelog\n\n${all.join('\n\n')}\n`, 'app')
  }

  // 3. The record that makes the version count.
  const record = {
    type: 'checkpoint', repo: github.repo, issue: n, step, version, previous, artifact: { number, version: posted.version }, hash: hash(posted.body), author, harness: ctx.harness, at: now.toISOString(),
    ...(review ? { review: review.hash } : {}),
    ...(amending ? { amend: true, reason: amending.reason, minor: amending.minor, ...(amending.minor ? { carries: amending.carries } : {}) } : {}),
  }
  const ask = amending?.minor ? `It's a minor amendment, so it keeps ${amending.carries}'s approval.` : `To approve it, run \`factory-foreman approve ${step} ${version}\` in a terminal.`
  const why = amending ? ` Amended because: ${amending.reason.replace(/\s+/g, ' ')}` : ''
  await github.comment(n, recordComment(`**${title(step)} ${version}** posted by @${author} from ${ctx.harness}${diff ? '' : ' (first version)'}.${why} ${ask}`, record), 'app')

  // 4. The issue body: changelog line, decisions, and a status read afresh,
  // so a checkpoint or approval that landed meanwhile shows too.
  const states = (await loadIssue(github, n, config.approvals)).steps
  const rows = notes.filter((e) => e.kind !== 'question').map((e) => ({ date, text: `${e.kind === 'rejected' ? 'Rejected: ' : ''}${e.text}`, by: `@${author}`, step: `${title(step)} ${version}` }))
  await updateBody(github, n, (b) => setSection(addDecisionRows(addChangelogLine(b, bodyLine({ step, version, date, author, diff, amend: amending })), rows), 'status', statusLine(states)))

  const next = amending?.minor ? `It keeps ${amending.carries}'s approval.` : `Approve it from a terminal: factory-foreman approve ${step} ${version}`
  return { out: `Posted ${title(step)} ${version} on #${n} (artifact version ${posted.version}${amending ? `, ${amending.minor ? 'minor' : 'material'} amendment` : ''}). ${next}`, json: record }
}
