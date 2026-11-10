// What every issue command reads first: the issue, its trusted records, and
// each step's artifact with its full history.
import { Refusal } from '../errors.mjs'
import { byBot, hash, stepState, trustedRecords } from '../issue/records.mjs'

export const STEPS = [ 'shape', 'design' ]
export const title = (step) => step[0].toUpperCase() + step.slice(1)
export const today = (now) => now.toISOString().slice(0, 10)

export function requireStep(step) {
  if (!STEPS.includes(step)) throw new Refusal(`Name a step: ${STEPS.join(' or ')}.`)
  return step
}

export async function loadIssue(github, n, policy = {}) {
  const [ issue, comments, artifacts ] = await Promise.all([ github.issue(n), github.comments(n), github.artifacts(n) ])
  if (!issue) throw new Refusal(`Issue #${n} doesn't exist in ${github.repo}.`)
  const records = await trustedRecords(comments, { botLogin: github.botLogin, permission: (login) => github.permission(login), repo: github.repo, issue: n })
  // Two runs racing to create an artifact leave two with one name; the first wins.
  const first = (name) => artifacts.filter((a) => a.name === name).sort((a, b) => a.number - b.number)[0] ?? null
  const changelog = first('Changelog')
  // Every label the Changelog has ever named, in a version the App wrote,
  // counts towards the next one.
  const logged = changelog ? (await github.history(n, changelog.number)).versions.filter((v) => byBot(v, github.botLogin)).flatMap((v) => [ ...String(v.body ?? '').matchAll(/^## (Shape|Design) (v\d+(?:\.\d+)?),/gm) ]) : []
  const steps = {}
  for (const step of STEPS) {
    const state = stepState(records, step, { ...policy, comments, botLogin: github.botLogin })
    state.highest.push(...logged.filter((m) => m[1] === title(step)).map((m) => m[2]))
    const number = state.latest?.artifact?.number ?? first(title(step))?.number
    const history = number ? await github.history(n, number) : { number: null, versions: [] }
    steps[step] = { ...state, artifact: history.number ? history : null, current: history.versions.at(-1) ?? null }
  }
  return { issue, records, steps, changelog }
}

// The body of the approved version, located by its checkpoint (which the App
// wrote) and checked against the hash that was approved.
export function approvedBody(stepInfo) {
  const { approvedCheckpoint: cp, artifact } = stepInfo
  if (!cp || !artifact) return null
  const body = artifact.versions.find((v) => v.version === cp.artifact.version)?.body
  return body !== undefined && hash(body) === cp.hash ? body : null
}

export const sameText = (a, b) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '')

export const after = (at, since) => !since || Date.parse(at) > Date.parse(since)
