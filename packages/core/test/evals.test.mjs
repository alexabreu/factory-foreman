// The eval runner's pure parts: checks, grading, the prompt and the harness command.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { absent, countAtLeast, matches } from '../evals/lib/checks.mjs'
import { grade, summarize } from '../evals/lib/grade.mjs'
import { command, parseArgs, prompt } from '../evals/run.mjs'

test('checks explain themselves', () => {
  assert.equal(matches('splice on list.items', /splice/u).passed, true)
  assert.equal(absent('use an arrow function', /arrow function/u).passed, false)
  assert.equal(countAtLeast('a.ts:1 a.ts:1 b.ts:2', /\w+\.ts:\d+/u, 2).passed, true)
})

test('grade weights criteria and summarize gives mean and spread', () => {
  const g = grade('found splice', [ { text: 'a', weight: 3, check: (o) => matches(o, /splice/u) }, { text: 'b', weight: 1, check: (o) => matches(o, /nope/u) } ])
  assert.equal(g.score, 0.75)
  const s = summarize([ 0.5, 1 ])
  assert.equal(s.mean, 0.75)
  assert.ok(s.sd > 0.35 && s.sd < 0.36)
})

test('the prompt drops front matter and includes every input; harnesses get stdin commands', () => {
  const p = prompt('---\nname: x\n---\nBe precise.', { task: 'Review.', inputs: [ 'a.md' ] }, () => 'A')
  assert.match(p, /^Be precise\.\n\n# Task\n\nReview\.\n\n<file path="a\.md">\nA\n<\/file>\n\nReply with only a JSON array of findings/u)
  assert.deepEqual(command('claude', 'opus'), [ 'claude', '-p', '--output-format', 'text', '--model', 'opus' ])
  assert.deepEqual(command('codex'), [ 'codex', 'exec', '-' ])
  assert.throws(() => command('other'), /Unknown harness/u)
  assert.equal(parseArgs([ '--persona', 'code-reviewer', '--runs', '2' ]).runs, 2)
})

test('every bundled case is well formed', async () => {
  const root = new URL('../evals/cases/', import.meta.url).pathname
  for (const persona of readdirSync(root)) {
    for (const id of readdirSync(join(root, persona))) {
      const dir = join(root, persona, id)
      const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'))
      assert.equal(scenario.id, id)
      for (const f of scenario.inputs) assert.ok(readFileSync(join(dir, f), 'utf8').length > 0, f)
      const criteria = (await import(pathToFileURL(join(dir, 'criteria.mjs')).href)).default
      assert.ok(criteria.length >= 3 && criteria.every((c) => typeof c.check === 'function' && c.text))
    }
  }
})

test('a case in the predecessor format is read in place, skipping criteria that need a repository', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { loadCase } = await import('../evals/run.mjs')
  const root = mkdtempSync(join(tmpdir(), 'ff-evals-'))
  const dir = join(root, 'code-reviewer', 'made-up')
  mkdirSync(join(dir, 'graders'), { recursive: true })
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'lib', 'case-file.mjs'), "export const parseCaseFile = () => ({ name: 'made-up', persona: 'code-reviewer', inputs: [ 'files/pr.diff' ] })\n")
  writeFileSync(join(dir, 'case.yaml'), 'name: made-up\n')
  writeFileSync(join(dir, 'prompt.md'), 'Review it.\n')
  writeFileSync(join(dir, 'graders', 'assertions.mjs'), "export default [ { text: 'Finds the bug', check: ({ output }) => ({ passed: /bug/.test(output), evidence: '' }) }, { text: 'Starts from deterministic tool output', check: () => ({ passed: true }) }, { text: 'Does not change repository files', check: () => ({ passed: true }) } ]\n")
  const c = await loadCase(dir, root)
  assert.equal(c.scenario.id, 'made-up')
  assert.match(c.scenario.task, /^Review it\.\n\nThere is no repository checkout here/u)
  assert.deepEqual(c.skipped, [ 'Starts from deterministic tool output', 'Does not change repository files' ])
  assert.equal(c.criteria.length, 1)
  assert.equal(c.criteria[0].check('a bug').passed, true)
})

test('JSON findings are rendered in the legacy review style for legacy checks', async () => {
  const { asLegacyReview } = await import('../evals/run.mjs')
  const out = asLegacyReview('```json\n[{"file":"src/a.ts","line":3,"severity":"high","summary":"Breaks undo","why":"stale index","fix":"store id"}]\n```')
  assert.match(out, /^- \*\*blocker\*\* src\/a\.ts:3: Breaks undo\n {2}Why: stale index\n {2}Fix: store id/u)
  assert.equal(asLegacyReview('plain text review'), 'plain text review')
})

test('findings are found despite narration, brackets in prose and fences', async () => {
  const { findingsFrom } = await import('../evals/lib/findings.mjs')
  assert.deepEqual(findingsFrom('Here [see notes] is my review:\n```json\n[{"id":"C1","severity":"major","text":"x"}]\n```\nDone.'), [ { id: 'C1', severity: 'major', text: 'x' } ])
  assert.deepEqual(findingsFrom('I checked [a, b]. Result: [{"id":"C1","text":"y"}]'), [ { id: 'C1', text: 'y' } ])
  assert.deepEqual(findingsFrom('Nothing to fix.\n```json\n[]\n```'), [])
  assert.equal(findingsFrom('no json here'), null)
})

test('precision check counts findings above the ceiling, and runs report pass rate and flakiness', async () => {
  const { noFindingsAbove } = await import('../evals/lib/checks.mjs')
  assert.equal(noFindingsAbove('[{"severity":"minor","text":"nit"}]').passed, true)
  assert.equal(noFindingsAbove('[{"severity":"major","text":"bad"}]').passed, false)
  assert.equal(noFindingsAbove('no array').passed, false)
  const s = summarize([ 1, 0.5, 0.9 ])
  assert.ok(Math.abs(s.passRate - 2 / 3) < 1e-9)
  assert.equal(s.flaky, true)
  assert.equal(summarize([ 1, 1 ]).flaky, false)
})

test('the stale-index check needs the undo position, not just any mutation finding', async () => {
  const criteria = (await import('../evals/cases/code-reviewer/seeded-remove-undo/criteria.mjs')).default
  const stale = criteria.find((c) => /stale index/u.test(c.text))
  assert.equal(stale.check('undo() reinserts at removed.index, which is stale if a book was added in between').passed, true)
  assert.equal(stale.check('remove() mutates list.items with splice, so the caller sees the change').passed, false)
})
