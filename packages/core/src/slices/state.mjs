// Where each slice stands. The shared truth is the latest record the App
// posted on the slice's pull request:
//   <!-- factory-foreman:record {"type":"slice","issue":7,"n":1,…} -->
// slices.json in the issue's state folder caches it for this checkout, with
// what only this checkout needs (the frozen AC tests' paths and hashes come
// from the record too, so another checkout can check them).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Refusal } from '../errors.mjs'
import { isBotLogin, parseRecords, recordComment, sameRepo } from '../issue/records.mjs'

const file = (dir) => join(dir, 'slices.json')

export function readSlices(dir) {
  if (!existsSync(file(dir))) return {}
  try {
    return JSON.parse(readFileSync(file(dir), 'utf8')).slices ?? {}
  } catch (error) {
    throw new Refusal(`${file(dir)} is damaged (${error.message}); delete it and factory-foreman reads each slice back from its pull request.`)
  }
}

export function writeSlice(dir, slice) {
  const all = readSlices(dir)
  all[slice.n] = slice
  const tmp = `${file(dir)}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ slices: all }, null, 2)}\n`)
  renameSync(tmp, file(dir))
  return slice
}

// The latest slice record the App posted on a pull request, or null.
export function latestSliceRecord(comments, { botLogin, repo, issue, n }) {
  const records = parseRecords(comments).filter((r) => r.type === 'slice' && r.n === n && r.issue === issue && sameRepo(r.repo, repo) && isBotLogin(r.comment.login, r.comment.type, botLogin))
  return records.at(-1) ?? null
}

// What the record carries: everything another checkout needs to go on.
export const RECORD_KEYS = [ 'n', 'branch', 'base', 'start', 'pr', 'pinned', 'tests', 'iterations', 'owner', 'state', 'merged' ]
export function sliceRecord(repo, issue, slice) {
  return { type: 'slice', repo, issue, ...Object.fromEntries(RECORD_KEYS.map((k) => [ k, slice[k] ?? null ])) }
}

export async function postSliceRecord(github, { issue, slice, text }) {
  await github.comment(slice.pr, recordComment(text, sliceRecord(github.repo, issue, slice)), 'app')
}

// A slice as the App's latest record on its pull request has it. The PR is
// found by the slice's branch, never from the local cache, and the record must
// name that PR and branch; the cache is only rewritten from it. No PR or no
// record means no slice.
export async function loadSlice(ctx, github, issue, n) {
  const branch = `factory-foreman/${issue}-slice-${n}`
  const pr = await github.prForBranch(branch)
  // A closed, unmerged PR is an abandoned slice: it can be opened again.
  if (!pr || pr.state === 'CLOSED') return null
  const record = latestSliceRecord(await github.comments(pr.number), { botLogin: github.botLogin, repo: github.repo, issue, n })
  if (!record || record.pr !== pr.number || record.branch !== branch) return null
  const slice = Object.fromEntries(RECORD_KEYS.map((k) => [ k, record[k] ]))
  return writeSlice(ctx.stateDir(), slice)
}
