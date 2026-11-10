// Records are hidden JSON in issue comments:
//   <!-- factory-foreman:record {"type":"checkpoint",…} -->
// A checkpoint record counts only when the factory's App posted it, and an
// approval only when it was posted by the person it names, who must have
// write access. So nobody can approve under another person's name, and an
// agent can't forge factory state from a comment.
import { createHash } from 'node:crypto'
import { Refusal } from '../errors.mjs'

const PATTERN = /<!-- factory-foreman:record (\{[\s\S]*?\}) -->/g
const WRITE = new Set([ 'admin', 'maintain', 'write' ])

export const hash = (text) => createHash('sha256').update(text).digest('hex')

export function recordComment(visible, record) {
  return `${visible.trim()}\n\n<!-- factory-foreman:record ${JSON.stringify(record).replace(/--/g, '-\\u002d')} -->`
}

// True only when the version names the App as its actor: its exact login, or
// the slug GraphQL uses for it when the actor is marked as a Bot. A person
// can't register a login ending in [bot], but could take the bare slug.
export const byBot = (version, botLogin) => {
  const actor = version?.actor
  const login = actor?.login ?? actor
  if (typeof login !== 'string' || !botLogin) return false
  return login === botLogin || (actor?.type === 'Bot' && `${login}[bot]` === botLogin)
}

// An edited comment is never trusted: anyone with write access can edit
// someone else's comment on GitHub, and the login would still read as theirs.
export const edited = (c) => Boolean(c.updatedAt && c.createdAt && Date.parse(c.updatedAt) > Date.parse(c.createdAt))

export function parseRecords(comments, { includeEdited = false } = {}) {
  const out = []
  for (const c of comments) {
    if (edited(c) && !includeEdited) continue
    for (const match of c.body.matchAll(PATTERN)) {
      try {
        out.push({ ...JSON.parse(match[1]), comment: { id: c.id, login: c.login, type: c.type, createdAt: c.createdAt, url: c.url } })
      } catch {
        // Not ours, or damaged: ignore it.
      }
    }
  }
  return out
}

export async function trustedRecords(comments, { botLogin, permission, repo, issue }) {
  const records = parseRecords(comments).filter((r) => (r.repo === undefined || sameRepo(r.repo, repo)) && (r.issue === undefined || r.issue === issue))
  const access = new Map()
  const canWrite = async (login) => {
    if (!access.has(login)) access.set(login, WRITE.has(await permission(login)))
    return access.get(login)
  }
  const trusted = []
  for (const r of records) {
    if (r.type === 'checkpoint' && r.comment.login === botLogin) trusted.push(r)
    else if (r.type === 'approval' && r.comment.type === 'User' && r.comment.login === r.approver && (await canWrite(r.approver))) trusted.push(r)
  }
  return trusted
}

// Where a step stands: its checkpoints in order, the latest one, and the
// latest approval that matches a posted version's hash.
// An approval counts when it names a posted checkpoint by its comment, came
// after it, matches its version and hash, and (when the repo asks for a second
// approver) wasn't given by the checkpoint's author.
export function stepState(records, step, { requireSecondApprover = false, comments: allComments = [], botLogin = null } = {}) {
  const checkpoints = records.filter((r) => r.type === 'checkpoint' && r.step === step)
  const byComment = new Map(checkpoints.map((c) => [ c.comment.id, c ]))
  const approvals = records.filter((r) => {
    if (r.type !== 'approval' || r.step !== step) return false
    const cp = byComment.get(r.checkpoint)
    if (!cp || cp.version !== r.version || cp.hash !== r.hash) return false
    if (Date.parse(r.comment.createdAt) < Date.parse(cp.comment.createdAt)) return false
    return !(requireSecondApprover && r.approver === cp.author)
  })
  const approved = approvals.at(-1) ?? null
  // Every label this step has used in a comment the App posted, edited or
  // not, so numbering only ever goes up. Others' comments don't count, so
  // nobody can push the numbering to its end.
  const highest = parseRecords(allComments, { includeEdited: true }).filter((r) => r.step === step && botLogin && r.comment.login === botLogin).map((r) => labelNumber(r.version))
  return { checkpoints, latest: checkpoints.at(-1) ?? null, approved, approvedCheckpoint: approved ? byComment.get(approved.checkpoint) : null, highest: [ ...highest, ...checkpoints.map((c) => labelNumber(c.version)) ] }
}

// A label's number, or 0 when it isn't a plain v1 to v999999. Labels never
// go past v999999 (nextVersion refuses), so a longer one is never ours.
const MAX_LABEL = 999999
export const labelNumber = (label) => Number(String(label).match(/^v(\d{1,6})$/)?.[1] ?? 0)

// The next label is one past the highest ever posted, so a deleted or edited
// checkpoint comment can't make a label repeat. loadIssue adds the labels the
// Changelog artifact names, since its history outlives a deleted comment.
export function nextVersion(state) {
  const next = Math.max(0, ...state.highest) + 1
  if (next > MAX_LABEL) throw new Refusal(`Version labels have reached v${MAX_LABEL}, so a new one could repeat. Someone may have posted a record with a huge label; look through this issue's comments and Changelog.`)
  return `v${next}`
}

export const isApproved = (state) => Boolean(state.latest && state.approved && state.approved.checkpoint === state.latest.comment.id)

export const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
