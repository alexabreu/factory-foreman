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

// True only for the App's own login: its exact REST form (`slug[bot]`), or the
// bare slug GraphQL reports, and that only when the account is marked as a
// Bot. A person can't register a login ending in [bot], but could take the
// bare slug, so the bare form never counts without the Bot type.
export const isBotLogin = (login, type, botLogin) => {
  if (typeof login !== 'string' || typeof botLogin !== 'string' || !botLogin) return false
  return login === botLogin || (type === 'Bot' && `${login}[bot]` === botLogin)
}

// True only when an artifact version names the App as its actor.
export const byBot = (version, botLogin) => {
  const actor = version?.actor
  return isBotLogin(actor?.login ?? actor, actor?.type, botLogin)
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
    if (r.type === 'checkpoint' && isBotLogin(r.comment.login, r.comment.type, botLogin)) trusted.push(r)
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
    // Only a material version (vN) is approved; a minor one carries vN's approval.
    if (parseLabel(r.version)?.minor !== 0) return false
    const cp = byComment.get(r.checkpoint)
    if (!cp || cp.version !== r.version || cp.hash !== r.hash) return false
    if (Date.parse(r.comment.createdAt) < Date.parse(cp.comment.createdAt)) return false
    return !(requireSecondApprover && r.approver === cp.author)
  })
  const approved = approvals.at(-1) ?? null
  // A minor amendment (vN.M) keeps vN's approval: the approved checkpoint
  // carries forward through the minors posted right after it, and stops at
  // the first material version.
  let approvedCheckpoint = approved ? byComment.get(approved.checkpoint) : null
  if (approvedCheckpoint) {
    for (const cp of checkpoints.slice(checkpoints.indexOf(approvedCheckpoint) + 1)) {
      const parts = parseLabel(cp.version)
      if (!cp.minor || cp.carries !== approved.version || !parts?.minor || `v${parts.major}` !== approved.version) break
      approvedCheckpoint = cp
    }
  }
  // Every label this step has used in a comment the App posted, edited or
  // not, so numbering only ever goes up. Others' comments don't count, so
  // nobody can push the numbering to its end.
  const highest = parseRecords(allComments, { includeEdited: true }).filter((r) => r.step === step && isBotLogin(r.comment.login, r.comment.type, botLogin)).map((r) => r.version)
  return { checkpoints, latest: checkpoints.at(-1) ?? null, approved, approvedCheckpoint, highest: [ ...highest, ...checkpoints.map((c) => c.version) ] }
}

// A label is vN (a material version, approved on its own) or vN.M (a minor
// amendment of vN, which keeps vN's approval). Anything else isn't ours.
// Labels never go past 999999 (nextVersion refuses), so a longer one isn't either.
const MAX_LABEL = 999999
export function parseLabel(label) {
  const m = String(label).match(/^v(\d{1,6})(?:\.(\d{1,6}))?$/)
  if (!m) return null
  const major = Number(m[1])
  const minor = m[2] === undefined ? 0 : Number(m[2])
  if (major < 1 || (m[2] !== undefined && minor < 1)) return null
  return { major, minor }
}

// The highest major ever used, counting a vN.M as using vN.
export const labelNumber = (label) => parseLabel(label)?.major ?? 0

// The next material label is one past the highest major ever posted, so a
// deleted or edited checkpoint comment can't make a label repeat. loadIssue
// adds the labels the Changelog artifact names, since its history outlives a
// deleted comment.
export function nextVersion(state) {
  const next = Math.max(0, ...state.highest.map(labelNumber)) + 1
  if (next > MAX_LABEL) throw new Refusal(`Version labels have reached v${MAX_LABEL}, so a new one could repeat. Someone may have posted a record with a huge label; look through this issue's comments and Changelog.`)
  return `v${next}`
}

// The next minor label of vN: one past the highest vN.M ever posted.
export function nextMinor(state, major) {
  const minors = state.highest.map(parseLabel).filter((p) => p && p.major === major).map((p) => p.minor)
  const next = Math.max(0, ...minors) + 1
  if (next > MAX_LABEL) throw new Refusal(`Minor labels of v${major} have reached v${major}.${MAX_LABEL}; checkpoint a new version instead.`)
  return `v${major}.${next}`
}

// The latest version is approved: by its own approval, or as a minor
// amendment that carries an approval forward.
export const isApproved = (state) => Boolean(state.latest && state.approvedCheckpoint && state.approvedCheckpoint.comment.id === state.latest.comment.id)

export const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// Approvals of a slice's head recorded on its PR by `factory-foreman approve
// slice`: a person can't approve their own PR on GitHub, so a solo maintainer
// records it this way. Trusted like a step approval: unedited, posted by the
// person it names, who has write access, for this repo, issue, slice, PR and
// head commit. Returns the approvers' logins.
export async function sliceApprovers(comments, { permission, repo, issue, slice, pr, head }) {
  const logins = new Set()
  for (const r of parseRecords(comments)) {
    if (r.type !== 'slice-approval' || !sameRepo(r.repo, repo) || r.issue !== issue || r.slice !== slice || r.pr !== pr || r.head !== head) continue
    if (r.comment.type !== 'User' || r.comment.login !== r.approver) continue
    if (WRITE.has(await permission(r.approver))) logins.add(r.approver)
  }
  return [ ...logins ]
}
