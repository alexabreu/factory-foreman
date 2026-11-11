// Phase 3a: slices open stacked on each other, freeze their AC tests, iterate
// through light checks, a settled review and the AC gate, and a person merges
// them once the PR is approved and CI is green. Real git with a bare origin, a
// fake GitHub, and a tiny test runner that writes JUnit, so the gate's base
// and head runs are real.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { main } from '../src/cli.mjs'
import { DEFAULTS } from '../src/config/load.mjs'
import { classify, parseJUnit } from '../src/slices/gate.mjs'
import { loadProviders } from '../src/evidence/providers.mjs'
import { acsIn, affectedSlices } from '../src/slices/plan.mjs'
import { stateDir, worktreeDraftPath } from '../src/state/local.mjs'
import { parseDraft } from '../src/steps/structure.mjs'
import { globToRegExp, matchesAny } from '../src/util/glob.mjs'
import { fakeGitHub } from './fixtures/github.mjs'

const SHAPE = `---
step: shape
base: 0
---
Readers want a counter they can add to and reset.

## Problem
There's no counter.

## Who it's for
Anyone counting things.

## Out of scope
Saving the count.

## Acceptance criteria
| ID | Criterion | Visual |
| --- | --- | --- |
| AC-1 | Adding one increases the count by one | no |
| AC-2 | Reset sets the count to zero | no |
`

const DESIGN = `---
step: design
base: 0
---
A counter module and a reset module, each tested through its exports.

## Approach
Pure functions in src/.

## Contracts
\`\`\`contract
{ "name": "counter", "testIds": ["count"], "files": ["src/counter.mjs"], "slice": 1 }
\`\`\`

\`\`\`contract
{ "name": "reset", "testIds": ["reset-button"], "files": ["src/reset.mjs"] }
\`\`\`

## Slices
1. Counter (AC-1)
   files: src/counter.mjs, src/app.mjs
2. Reset (AC-2)
   files: src/reset.mjs
`

// A test runner like any repo's: runs the files it's given, writes JUnit.
const RUNNER = `import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const cases = []
for (const file of process.argv.slice(2)) {
  let tests
  try { tests = (await import(pathToFileURL(resolve(file)).href)).default } catch (e) { cases.push({ name: file, error: e.message }); continue }
  for (const t of tests) { try { await t.run(); cases.push({ name: t.name, file }) } catch (e) { cases.push({ name: t.name, file, error: e.name + ': ' + e.message }) } }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
mkdirSync('test-results', { recursive: true })
writeFileSync('test-results/ac.xml', '<testsuite>' + cases.map((c) => '<testcase name="' + esc(c.name) + '"' + (c.file ? ' file="' + esc(c.file) + '"' : '') + '>' + (c.error ? '<failure message="' + esc(c.error) + '"/>' : '') + '</testcase>').join('') + '</testsuite>')
process.exitCode = cases.some((c) => c.error) ? 1 : 0
`

const CONFIG = {
  reviewers: { shape: [], design: [], slice: [ 'code-reviewer' ], verify: [] },
  secondOpinion: null,
  tests: { ac: { files: [ 'e2e/**/*.ac.mjs' ], run: [ 'node', 'run-ac.mjs' ], cwd: '.', timeout: 60_000 }, show: { files: [ 'show/**/*.json' ] } },
  checks: { tiers: { slice: [ { name: 'syntax', run: [ 'node', '--check', 'src/app.mjs' ], when: 'changed:src/**' } ], verify: 'ci' }, plugins: [] },
}

function developer(world, login, { isTTY = false, answer = '', config = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ff-slice-'))
  execFileSync('git', [ 'init', '-q', '-b', 'main' ], { cwd })
  let minute = 0
  const dev = { cwd, exec: null }
  const ctx = () => ({
    cwd,
    env: {},
    harness: 'terminal',
    isTTY,
    now: () => new Date(Date.parse('2026-11-10T12:00:00Z') + (minute++) * 60_000),
    config: () => ({ ...structuredClone(DEFAULTS), ...structuredClone(CONFIG), ...config }),
    issue: () => 7,
    stateDir: () => stateDir(cwd, 7),
    draftPath: (step) => worktreeDraftPath(cwd, 7, step),
    author: () => login,
    github: () => world.as(login),
    prompt: async () => answer,
    exec: async (argv, opts = {}) => {
      if (dev.exec) { const stubbed = dev.exec(argv, opts); if (stubbed) return stubbed }
      const r = spawnSync(argv[0], argv.slice(1), { cwd: opts.cwd ?? cwd, encoding: 'utf8', input: opts.input, env: { ...process.env, ...(opts.env ?? {}) }, timeout: opts.timeout })
      return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error?.message ?? '') }
    },
  })
  const g = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
  return Object.assign(dev, { g, ctx, run: (...argv) => main(argv, ctx), dir: () => stateDir(cwd, 7) })
}

const writeDraft = (file, body) => {
  const head = readFileSync(file, 'utf8').match(/^---\n[\s\S]*?\n---\n/)[0]
  writeFileSync(file, head + body.replace(/^---\n[\s\S]*?\n---\n/, ''))
}
const put = (dev, path, text) => { mkdirSync(join(dev.cwd, path, '..'), { recursive: true }); writeFileSync(join(dev.cwd, path), text) }
const commit = (dev, message, ...paths) => { dev.g('add', '--', ...paths); dev.g('commit', '-q', '-m', message) }
const ok = (r) => { assert.equal(r.code, 0, r.err); return r }

// An issue with an approved Shape and Design, and a repo on its issue branch.
async function feature({ config = {} } = {}) {
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write', eve: 'read' } })
  world.addIssue(7, 'Readers want a counter.')
  const remote = mkdtempSync(join(tmpdir(), 'ff-origin-'))
  execFileSync('git', [ 'init', '-q', '--bare', remote ])
  world.gitDir = remote
  const ana = developer(world, 'ana', { config })
  const ben = developer(world, 'ben', { isTTY: true, answer: 'y', config })
  ana.g('config', 'user.name', 'Ana'); ana.g('config', 'user.email', 'ana@example.com')
  put(ana, 'src/app.mjs', 'export const name = "app"\n')
  put(ana, 'run-ac.mjs', RUNNER)
  commit(ana, 'start', 'src/app.mjs', 'run-ac.mjs')
  // origin names the GitHub repo; insteadOf sends it to the bare repo standing in for GitHub.
  ana.g('remote', 'add', 'origin', 'https://github.com/owner/sandbox.git')
  ana.g('config', `url.${remote}.insteadOf`, 'https://github.com/owner/sandbox.git')
  ana.g('checkout', '-q', '-b', 'factory-foreman/7')
  ana.g('push', '-q', 'origin', 'factory-foreman/7')
  await ana.run('draft', 'shape'); writeDraft(join(ana.dir(), 'shape.md'), SHAPE); ok(await ana.run('checkpoint', 'shape'))
  ok(await ben.run('approve', 'shape', 'v1'))
  await ana.run('draft', 'design'); writeDraft(join(ana.dir(), 'design.md'), DESIGN); ok(await ana.run('checkpoint', 'design'))
  ok(await ben.run('approve', 'design', 'v1'))
  return { world, remote, ana, ben, origin: (...a) => execFileSync('git', [ '--git-dir', remote, ...a ], { encoding: 'utf8' }).trim() }
}

const TEST_1 = `import assert from 'node:assert/strict'
import { add } from '../src/counter.mjs'
export default [ { name: 'AC-1: adding one increases the count by one', run: () => assert.equal(add(1), 2) } ]
`

async function frozenSlice1(f) {
  const { ana } = f
  ok(await ana.run('slice', 'open', '1'))
  ana.g('switch', '-q', 'factory-foreman/7-slice-1')
  put(ana, 'e2e/AC-1.ac.mjs', TEST_1)
  commit(ana, 'AC tests for slice 1', 'e2e/AC-1.ac.mjs')
  ok(await ana.run('slice', 'tests', '1', '--save'))
}

async function reviewed(dev, s) {
  const file = join(dev.cwd, '..', `findings-${s}-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify({ reviewers: { 'code-reviewer': [] } }))
  return ok(await dev.run('slice', 'review', 'save', String(s), '--findings', file))
}

test('slice open cuts a stacked branch and draft PR, pinned to the approved pair, within the stack depth', async () => {
  const f = await feature()
  const { ana, world, origin } = f
  const opened = ok(await ana.run('slice', 'open', '1', '--json'))
  const one = JSON.parse(opened.out)
  assert.equal(one.branch, 'factory-foreman/7-slice-1')
  assert.equal(one.base.branch, 'factory-foreman/7')
  assert.deepEqual([ one.pinned.shape.version, one.pinned.design.version ], [ 'v1', 'v1' ])
  // The opening commit has the base's tree, so the PR starts empty.
  assert.equal(origin('rev-parse', `${one.start}^{tree}`), origin('rev-parse', 'factory-foreman/7^{tree}'))
  assert.equal(origin('rev-parse', 'refs/heads/factory-foreman/7-slice-1'), one.start)
  const pr = world.issues.get(one.pr)
  assert.deepEqual([ pr.pr.base, pr.pr.draft, pr.pr.assignees ], [ 'factory-foreman/7', true, [ 'ana' ] ])
  assert.match(pr.comments.at(-1).body, /factory-foreman:record \{"type":"slice"/)
  assert.equal(pr.comments.at(-1).login, 'foreman[bot]')
  assert.match(world.issues.get(7).body, /- \[ \] 1\. Counter \(AC-1\) — #\d+\n- \[ \] 2\. Reset \(AC-2\)/)
  // Slice 2 stacks on slice 1; a third isn't in the Design; a second open of 1 is refused.
  const two = JSON.parse(ok(await ana.run('slice', 'open', '2', '--json')).out)
  assert.equal(two.base.branch, 'factory-foreman/7-slice-1')
  assert.match((await ana.run('slice', 'open', '3')).err, /Slice 3 isn't in the approved Design/)
  assert.match((await ana.run('slice', 'open', '1')).err, /already open/)
  // Another checkout reads the slice back from its PR record.
  const other = JSON.parse(ok(await f.ben.run('slice', 'list', '--json')).out)
  assert.deepEqual([ other['1'].branch, other['2'].base.branch, other['1'].pinned.design.version ], [ 'factory-foreman/7-slice-1', 'factory-foreman/7-slice-1', 'v1' ])
})

test('slice open refuses without approvals, out of order, or past the stack depth', async () => {
  const f = await feature({ config: { stackDepth: 1 } })
  const { ana } = f
  assert.match((await ana.run('slice', 'open', '2')).err, /Open slice 1 first/)
  ok(await ana.run('slice', 'open', '1'))
  assert.match((await ana.run('slice', 'open', '2')).err, /1 slices are open \(1\); the stack depth is 1/)
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7, '')
  const lone = developer(world, 'ana')
  assert.match((await lone.run('slice', 'open', '1')).err, /need an approved Shape and Design|isn't inside a git|origin/)
})

test('slice tests briefs the test-verification-engineer, then freezes only a lone commit of tests covering every AC', async () => {
  const f = await feature()
  const { ana } = f
  ok(await ana.run('slice', 'open', '1'))
  ana.g('switch', '-q', 'factory-foreman/7-slice-1')
  const brief = ok(await ana.run('slice', 'tests', '1')).out
  assert.match(brief, /run as a subagent: the test-verification-engineer agent/)
  assert.match(brief, /It owns AC-1/)
  assert.match(brief, /"testIds":\["count"\]/)
  assert.match(brief, /<shape version="v1">[\s\S]*<design version="v1">/)
  assert.doesNotMatch(brief, /"name":"reset"/)
  // No commit yet; a source file in the tests commit; a test that names no AC.
  assert.match((await ana.run('slice', 'tests', '1', '--save')).err, /0 commit\(s\)/)
  put(ana, 'e2e/counter.ac.mjs', TEST_1.replace('AC-1: ', ''))
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'tests and code', 'e2e/counter.ac.mjs', 'src/counter.mjs')
  const err = (await ana.run('slice', 'tests', '1', '--save')).err
  assert.match(err, /src\/counter\.mjs isn't an AC test/)
  assert.match(err, /AC-1 has no test/)
  ana.g('reset', '-q', '--hard', 'HEAD~1')
  put(ana, 'e2e/AC-1.ac.mjs', TEST_1)
  commit(ana, 'AC tests', 'e2e/AC-1.ac.mjs')
  const frozen = JSON.parse(ok(await ana.run('slice', 'tests', '1', '--save', '--json')).out)
  assert.deepEqual(Object.keys(frozen.files), [ 'e2e/AC-1.ac.mjs' ])
  assert.equal(f.origin('rev-parse', 'refs/heads/factory-foreman/7-slice-1'), frozen.commit)
  assert.match((await ana.run('slice', 'tests', '1')).err, /frozen/)
  // Missing config is a refusal with an example.
  const bare = developer(f.world, 'ana', { config: { tests: { ac: { files: null, run: null, cwd: '.', timeout: 1000 }, show: { files: null } } } })
  assert.match((await bare.run('slice', 'tests', '1')).err, /set tests\.ac\.files, tests\.ac\.run in factory-foreman\.config\.json[\s\S]*"run": \["npx", "playwright", "test"\]/)
})

test('slice iterate: the AC gate passes a test failing on a missing file the slice adds, then pushes, tags and posts', async () => {
  const f = await feature()
  const { ana, world, origin } = f
  await frozenSlice1(f)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  put(ana, 'src/app.mjs', 'export { add } from "./counter.mjs"\nexport const name = "app"\n')
  commit(ana, 'counter', 'src/counter.mjs', 'src/app.mjs')
  // No saved review yet.
  assert.match((await ana.run('slice', 'iterate', '1')).err, /code review of [0-9a-f]{7} isn't saved/)
  await reviewed(ana, 1)
  const it = JSON.parse(ok(await ana.run('slice', 'iterate', '1', '--json')).out)
  assert.equal(it.iteration.k, 1)
  assert.deepEqual(it.gate.base.map((b) => [ b.kind, b.ok ]), [ [ 'import', true ] ])
  assert.deepEqual(it.gate.head.map((h) => h.outcome), [ 'passed' ])
  assert.deepEqual(it.checks.map((c) => [ c.name, c.ok ]), [ [ 'syntax', true ] ])
  const tip = ana.g('rev-parse', 'HEAD')
  assert.equal(origin('rev-parse', 'refs/heads/factory-foreman/7-slice-1'), tip)
  assert.equal(world.tags.get('factory-foreman/7/slice-1/iter-1'), tip)
  const pr = world.issues.get(world.issues.get(7) && [ ...world.issues.values() ].find((i) => i.pr?.head === 'factory-foreman/7-slice-1').number)
  assert.match(pr.comments.at(-1).body, /\*\*Iteration 1\*\* of slice 1[\s\S]*AC gate: 1 test\(s\) fail at base [0-9a-f]{7} for the right reason \(import\)/)
  // A second iteration is K=2 and needs its own review.
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1 // one more\n')
  commit(ana, 'tidy', 'src/counter.mjs')
  assert.match((await ana.run('slice', 'iterate')).err, /isn't saved/)
  await reviewed(ana, 1)
  assert.equal(JSON.parse(ok(await ana.run('slice', 'iterate', '--json')).out).iteration.k, 2)
  assert.equal(world.tags.get('factory-foreman/7/slice-1/iter-2'), ana.g('rev-parse', 'HEAD'))
})

test('slice iterate refuses a hollow test, a file outside the slice, a changed frozen test and failing checks', async () => {
  const f = await feature()
  const { ana } = f
  ok(await ana.run('slice', 'open', '1'))
  ana.g('switch', '-q', 'factory-foreman/7-slice-1')
  // Hollow: imports an existing file under a wrong name, so it can never reach
  // the code. Caught before freezing, so the tests can still be fixed.
  put(ana, 'e2e/AC-1.ac.mjs', TEST_1.replace('../src/counter.mjs', '../src/ap.mjs'))
  commit(ana, 'AC tests', 'e2e/AC-1.ac.mjs')
  const hollow = (await ana.run('slice', 'tests', '1', '--save')).err
  assert.match(hollow, /don't fail at base for the right reasons[\s\S]*imports .*src\/ap\.mjs, which isn't a file the slice adds/)
  // A test that passes already doesn't test the slice either.
  put(ana, 'e2e/AC-1.ac.mjs', "export default [ { name: 'AC-1: always fine', run: () => {} } ]\n")
  ana.g('add', 'e2e/AC-1.ac.mjs'); ana.g('commit', '-q', '--amend', '--no-edit')
  assert.match((await ana.run('slice', 'tests', '1', '--save')).err, /At base, "AC-1: always fine" already passes/)
  put(ana, 'e2e/AC-1.ac.mjs', TEST_1)
  ana.g('add', 'e2e/AC-1.ac.mjs'); ana.g('commit', '-q', '--amend', '--no-edit')
  ok(await ana.run('slice', 'tests', '1', '--save'))
  // At head, a test that does nothing once the import resolves still has to pass;
  // an empty module the slice adds makes it fail, which the gate refuses.
  put(ana, 'src/counter.mjs', 'export const add = () => 0\n')
  commit(ana, 'wrong counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  assert.match((await ana.run('slice', 'iterate', '1')).err, /At head, "AC-1: adding one increases the count by one" fails/)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  // A file another slice owns, and a frozen test edited.
  put(ana, 'src/reset.mjs', 'export const reset = () => 0\n')
  put(ana, 'e2e/AC-1.ac.mjs', `${TEST_1}// edited\n`)
  commit(ana, 'sneak', 'src/reset.mjs', 'e2e/AC-1.ac.mjs')
  await reviewed(ana, 1)
  const scoped = (await ana.run('slice', 'iterate', '1')).err
  assert.match(scoped, /src\/reset\.mjs isn't one of slice 1's files/)
  assert.match(scoped, /e2e\/AC-1\.ac\.mjs was frozen by slice tests and has changed/)
  ana.g('reset', '-q', '--hard', 'HEAD~1')
  // A config the slice brings with it doesn't set its rules.
  put(ana, 'factory-foreman.config.json', '{ "version": 1, "sharedFiles": ["**"], "budgets": { "sliceLines": 99999 } }\n')
  commit(ana, 'loosen the rules', 'factory-foreman.config.json')
  assert.match((await ana.run('slice', 'review', '1')).err, /factory-foreman\.config\.json isn't committed at the slice's base/)
  assert.match((await ana.run('slice', 'iterate', '1')).err, /factory-foreman\.config\.json isn't committed at the slice's base/)
  ana.g('reset', '-q', '--hard', 'HEAD~1')
  // A light check that fails stops the iteration before anything runs or pushes.
  put(ana, 'src/app.mjs', 'export const = broken\n')
  commit(ana, 'broken', 'src/app.mjs')
  await reviewed(ana, 1)
  assert.match((await ana.run('slice', 'iterate', '1')).err, /Light checks failed:[\s\S]*syntax \(exit 1\)/)
  // Uncommitted work isn't an iteration.
  put(ana, 'src/counter.mjs', 'x')
  assert.match((await ana.run('slice', 'iterate', '1')).err, /Commit or stash your changes first/)
})

test('slice merge: a person merges the iterated head once approved there and CI is green, and the slice above restacks', async () => {
  const f = await feature()
  const { ana, ben, world } = f
  await frozenSlice1(f)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  ok(await ana.run('slice', 'iterate', '1'))
  const first = ana.g('rev-parse', 'HEAD')
  ok(await ana.run('slice', 'open', '2'))
  const prOf = (branch) => [ ...world.issues.values() ].find((i) => i.pr?.head === branch)
  const pr1 = prOf('factory-foreman/7-slice-1')
  // Not in an agent's shell; not without approval at the head; not with red or missing CI.
  const agent = developer(world, 'ben', { isTTY: false, answer: 'y' })
  assert.match((await agent.run('slice', 'merge', '1')).err, /must be run by a person in their own terminal/)
  assert.match((await ben.run('slice', 'merge', '1')).err, /isn't approved at its head/)
  pr1.pr.reviews.push({ login: 'ben', type: 'User', state: 'APPROVED', commit: first, at: '2026-11-10T13:00:00Z' })
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1 // tidy\n')
  commit(ana, 'tidy', 'src/counter.mjs')
  await reviewed(ana, 1)
  ok(await ana.run('slice', 'iterate', '1'))
  const second = ana.g('rev-parse', 'HEAD')
  assert.match((await ben.run('slice', 'merge', '1')).err, /isn't approved at its head .*earlier commit doesn't count/)
  pr1.pr.reviews.push({ login: 'eve', type: 'User', state: 'APPROVED', commit: second, at: '2026-11-10T13:05:00Z' })
  assert.match((await ben.run('slice', 'merge', '1')).err, /isn't approved at its head/)
  pr1.pr.reviews.push({ login: 'ben', type: 'User', state: 'APPROVED', commit: second, at: '2026-11-10T13:10:00Z' })
  assert.match((await ben.run('slice', 'merge', '1')).err, /No CI has reported/)
  world.checks = new Map([ [ second, [ { name: 'CI', state: 'failure' } ] ] ])
  assert.match((await ben.run('slice', 'merge', '1')).err, /CI isn't green at [0-9a-f]{7}: CI \(failure\)/)
  assert.match((await ben.run('slice', 'merge', '2')).err, /Merge slice 1 first/)
  world.checks = new Map([ [ second, [ { name: 'CI', state: 'success' } ] ] ])
  const merged = ok(await ben.run('slice', 'merge', '1'))
  assert.match(merged.out, /Merged slice 1 .* at [0-9a-f]{7} into factory-foreman\/7\. Slice 2 now targets factory-foreman\/7/)
  assert.deepEqual(pr1.pr.merged, { sha: second, by: 'ben' })
  assert.equal(pr1.pr.draft, false)
  assert.equal(prOf('factory-foreman/7-slice-2').pr.base, 'factory-foreman/7')
  assert.match(world.issues.get(7).body, /- \[x\] 1\. Counter \(AC-1\) — #\d+/)
  assert.match((await ben.run('slice', 'merge', '1')).err, /isn't open; it is merged/)
})

test('status shows slices from their PR records: a local edit changes nothing, a newer approved Design makes a slice stale', async () => {
  const f = await feature()
  const { ana, ben } = f
  ok(await ana.run('slice', 'open', '1'))
  assert.match(ok(await ana.run('status')).out, /Slices:\n- 1\. open, #\d+, @ana, 0 iteration\(s\), pinned to Shape v1 \/ Design v1$/m)
  // The local cache isn't trusted: editing it changes nothing.
  const file = join(ana.dir(), 'slices.json')
  const all = JSON.parse(readFileSync(file, 'utf8'))
  all.slices['1'].pinned.design.version = 'v0'
  all.slices['1'].tests = { commit: 'f'.repeat(40), files: { 'e2e/x.ac.mjs': 'forged' }, show: {} }
  writeFileSync(file, JSON.stringify(all))
  assert.match(ok(await ana.run('status')).out, /pinned to Shape v1 \/ Design v1$/m)
  assert.equal(JSON.parse(ok(await ana.run('slice', 'list', '--json')).out)['1'].tests, null)
  // A material Design amendment, approved, leaves slice 1 pinned below it.
  await ana.run('draft', 'design', '--reset')
  writeDraft(join(ana.dir(), 'design.md'), DESIGN.replace('"testIds": ["count"]', '"testIds": ["count", "plus"]'))
  ok(await ana.run('amend', 'design', '--reason', 'a second test id'))
  ok(await ben.run('approve', 'design', 'v2'))
  assert.match(ok(await ana.run('status')).out, /pinned to Shape v1 \/ Design v1 \(STALE: newer approved versions\)/)
  // A minor amendment keeps the approval, so pins don't go stale and slices still open.
  await ana.run('draft', 'shape', '--reset')
  writeDraft(join(ana.dir(), 'shape.md'), SHAPE.replace('There\'s no counter.', 'There is no counter.'))
  ok(await ana.run('amend', 'shape', '--reason', 'wording'))
  assert.doesNotMatch((await ana.run('slice', 'open', '2')).err ?? '', /written against Shape/)
})

test('the gate classifies base failures: assertion, import of an added file, locator on a new test id', () => {
  const ctx = { owned: [ 'src/counter.mjs' ], testIds: [ 'count' ] }
  assert.deepEqual(classify("AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n1 !== 2", ctx).kind, 'assertion')
  assert.equal(classify("Cannot find module '/tmp/x/base/src/counter.mjs' imported from /tmp/x/base/e2e/a.mjs", ctx).ok, true)
  assert.equal(classify("Cannot find module '/tmp/x/base/src/ap.mjs' imported from /tmp/x/base/e2e/a.mjs", ctx).ok, false)
  assert.equal(classify('Failed to resolve import "./counter" from "e2e/a.ts". Does the file exist?', { ...ctx, owned: [ 'e2e/counter.ts' ] }).ok, true)
  assert.equal(classify("Cannot find package 'left-pad'", ctx).ok, false)
  assert.deepEqual(classify("locator.click: Timeout 5000ms exceeded.\nwaiting for getByTestId('count')", ctx), { kind: 'locator', detail: 'count', ok: true, why: "waits for test id count, which the slice's contract adds" })
  assert.equal(classify("expect(locator).toBeVisible() failed\nLocator: getByTestId('summary')\nError: element(s) not found", ctx).ok, false)
  // An element that's there but wrong is an assertion, which counts.
  assert.equal(classify("expect(locator).toHaveText(expected) failed\nLocator: getByTestId('summary')\nExpected: \"1 unread\"\nReceived: \"2 unread\"", ctx).kind, 'assertion')
  assert.equal(classify('TypeError: Cannot read properties of undefined', ctx).ok, false)
  assert.deepEqual(parseJUnit('<testsuite><testcase name="a &amp; b" classname="e2e/a.ts"/><testcase name="c"><failure message="x &lt; y">trace</failure></testcase><testcase name="d"><skipped/></testcase></testsuite>').map((c) => [ c.name, c.outcome, c.text ]), [ [ 'a & b', 'passed', '' ], [ 'c', 'failed', 'x < y\ntrace' ], [ 'd', 'skipped', '' ] ])
})

test('AC coverage reads test titles and file names, not comments; globs and affected slices', () => {
  assert.deepEqual([ ...acsIn("// AC-9\ntest('AC-1: x', () => {})\ndescribe.only(`AC-2`, () => {})", 'e2e/a.ts') ], [ 'AC-1', 'AC-2' ])
  assert.deepEqual([ ...acsIn('', 'e2e/AC-3.e2e.ts') ], [ 'AC-3' ])
  assert.ok(matchesAny('e2e/x.e2e.ts', [ 'e2e/**/*.e2e.ts' ]))
  assert.ok(matchesAny('e2e/a/b/x.e2e.ts', [ 'e2e/**/*.e2e.ts' ]))
  assert.ok(!matchesAny('src/x.ts', [ 'e2e/**' ]))
  assert.ok(globToRegExp('show/*.{json,yaml}').test('show/a.yaml'))
  const design = parseDraft(DESIGN)
  const shape = parseDraft(SHAPE)
  assert.deepEqual(affectedSlices({ step: 'shape', before: shape, after: parseDraft(SHAPE.replace('Reset sets the count to zero', 'Reset sets the count to zero at once')), design }), [ 2 ])
  assert.deepEqual(affectedSlices({ step: 'design', before: design, after: parseDraft(DESIGN.replace('"testIds": ["count"]', '"testIds": ["counter"]')) }), [ 1 ])
  assert.deepEqual(affectedSlices({ step: 'design', before: design, after: parseDraft(DESIGN.replace('   files: src/reset.mjs', '   files: src/reset.mjs, src/app.mjs')) }), [ 2 ])
  assert.deepEqual(affectedSlices({ step: 'design', before: design, after: parseDraft(DESIGN.replace('Pure functions in src/.', 'Pure functions.')) }), [])
})

test('slices pin the approved Shape the Design was written against: a waiting Shape warns, an approved newer one refuses', async () => {
  const f = await feature()
  const { ana, ben, world } = f
  const design = world.issues.get(7).comments.map((c) => c.body).find((b) => /"step":"design"/.test(b) && /"type":"checkpoint"/.test(b))
  assert.match(design, /"shapeVersion":"v1"/)
  // Shape v2 posted, not yet approved: slice 1 opens, with a note.
  await ana.run('draft', 'shape', '--reset')
  writeDraft(join(ana.dir(), 'shape.md'), SHAPE.replace('Reset sets the count to zero', 'Reset sets the count to zero at once'))
  ok(await ana.run('checkpoint', 'shape'))
  const opened = ok(await ana.run('slice', 'open', '1'))
  assert.match(opened.out, /^Note: Shape v2 awaits approval\. These slices pin Shape v1; if v2 is approved they go stale/m)
  // Once v2 is approved, Design v1 (written against v1) no longer pairs with it.
  ok(await ben.run('approve', 'shape', 'v2'))
  assert.match((await ana.run('slice', 'open', '2')).err, /Design v1 was written against Shape v1, but the approved Shape is v2/)
  assert.match(ok(await ana.run('status')).out, /- 1\. open, .*pinned to Shape v1 \/ Design v1 \(STALE/)
})

test('the gate reads the failure, not the code frame quoting the test', () => {
  const ctx = { owned: [ 'src/counter.mjs' ], testIds: [ 'count' ] }
  // A page that won't load, with expect( and a test id only in the quoted source.
  const crash = "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4173/\n  3 | test('AC-1', async ({ page }) => {\n> 4 |   await page.goto('/')\n  5 |   await expect(page.getByTestId('count')).toHaveText('1')\nCall log:\n  - navigating to \"http://localhost:4173/\", waiting until \"load\""
  assert.equal(classify(crash, ctx).ok, false)
  assert.equal(classify("TypeError: Cannot read properties of undefined (reading 'x')\n> 7 |   expect(add(1)).toEqual(2)", ctx).ok, false)
  assert.equal(classify("page.goto: Timeout 30000ms exceeded.\n> 9 | await page.getByTestId('count').click()", ctx).ok, false)
  // Imports match by path, not by suffix text.
  assert.equal(classify("Cannot find module './unter' imported from e2e/a.mjs", ctx).ok, false)
  assert.equal(classify("Failed to resolve import \"./\" from \"e2e/a.ts\"", ctx).ok, false)
  assert.equal(classify('Failed to resolve import "../src/counter" from "e2e/a.ts". Does the file exist?', ctx).ok, true)
  assert.equal(classify('Failed to resolve import "../lib/counter" from "e2e/a.ts". Does the file exist?', ctx).ok, false)
  // Vitest and Playwright JUnit: nested suites, CDATA bodies, file attributes.
  const xml = '<testsuites><testsuite name="e2e/a.spec.ts" file="e2e/a.spec.ts"><testcase name="AC-1: x" classname="e2e/a.spec.ts"><failure message="expect(received).toBe(expected)" type="AssertionError"><![CDATA[AssertionError: expected 1 to be 2 // Object.is equality\n ❯ e2e/a.spec.ts:4:20]]></failure><system-out>log</system-out></testcase></testsuite></testsuites>'
  const [ c ] = parseJUnit(xml)
  assert.deepEqual([ c.name, c.file, c.outcome ], [ 'AC-1: x', 'e2e/a.spec.ts', 'failed' ])
  assert.equal(classify(c.text, ctx).kind, 'assertion')
})

test('open picks up where a stopped run left off; iterate on the same commit only re-tags; merge records a PR merged on GitHub and checks its base', async () => {
  const f = await feature()
  const { ana, ben, world } = f
  // createPr fails once: the branch is pushed, the PR isn't.
  const as = world.as.bind(world)
  let failOnce = true
  world.as = (login) => { const gh = as(login); return { ...gh, createPr: async (o) => { if (failOnce) { failOnce = false; throw new Error('gh pr create failed: network') } return gh.createPr(o) } } }
  assert.equal((await ana.run('slice', 'open', '1')).code, 1)
  ok(await ana.run('slice', 'open', '1'))
  world.as = as
  ana.g('switch', '-q', 'factory-foreman/7-slice-1')
  put(ana, 'e2e/AC-1.ac.mjs', TEST_1)
  commit(ana, 'AC tests', 'e2e/AC-1.ac.mjs')
  ok(await ana.run('slice', 'tests', '1', '--save'))
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  ok(await ana.run('slice', 'iterate', '1'))
  const tip = ana.g('rev-parse', 'HEAD')
  world.tags.delete('factory-foreman/7/slice-1/iter-1')
  assert.match(ok(await ana.run('slice', 'iterate', '1')).out, /is already iteration 1 of slice 1/)
  assert.equal(world.tags.get('factory-foreman/7/slice-1/iter-1'), tip)
  // Someone retargets the PR: merge refuses until it's put back.
  const pr = [ ...world.issues.values() ].find((i) => i.pr?.head === 'factory-foreman/7-slice-1')
  pr.pr.reviews.push({ login: 'ben', type: 'User', state: 'APPROVED', commit: tip, at: '2026-11-10T13:00:00Z' })
  world.checks = new Map([ [ tip, [ { name: 'CI', state: 'success' } ] ] ])
  pr.pr.base = 'main'
  assert.match((await ben.run('slice', 'merge', '1')).err, /is factory-foreman\/7-slice-1 into main, but slice 1 is factory-foreman\/7-slice-1 into factory-foreman\/7/)
  pr.pr.base = 'factory-foreman/7'
  // Merged on GitHub by hand: merge records it instead of refusing forever.
  pr.state = 'MERGED'
  pr.pr.merged = { sha: tip, by: 'ben' }
  assert.match(ok(await ben.run('slice', 'merge', '1')).out, /was already merged at [0-9a-f]{7}; recorded it/)
  assert.match(world.issues.get(7).body, /- \[x\] 1\. Counter/)
})

test('real reporters: Playwright and Vitest JUnit, and a Playwright run that stops on a missing import', () => {
  const fixture = (name) => readFileSync(new URL(`./fixtures/junit/${name}`, import.meta.url), 'utf8')
  const ctx = { owned: [ 'src/remove.ts', 'src/undo.ts' ], testIds: [ 'remove' ] }
  const pw = parseJUnit(fixture('playwright.xml'))
  assert.deepEqual(pw.map((c) => [ c.name, c.file, c.type ]), [ [ 'AC-1: assertion fails', 'fail.e2e.ts', 'expect.toHaveText' ], [ 'AC-2: waits for a missing test id', 'fail.e2e.ts', 'TimeoutError' ], [ 'AC-3: plain toBe', 'fail.e2e.ts', 'expect.toBe' ] ])
  // An element found with the wrong text is an assertion; a test id never found is a locator wait.
  assert.deepEqual(pw.map((c) => { const r = classify(c.text, ctx, c.type); return [ r.kind, r.ok ] }), [ [ 'assertion', true ], [ 'locator', true ], [ 'assertion', true ] ])
  assert.equal(classify(pw[1].text, { ...ctx, testIds: [] }, pw[1].type).ok, false)
  const vt = parseJUnit(fixture('vitest.xml'))
  assert.deepEqual(vt.map((c) => [ c.name, c.file, c.type ]), [ [ 'src/fail.test.ts', 'src/fail.test.ts', 'Error' ], [ 'AC-6: vitest assertion', 'src/fail2.test.ts', 'AssertionError' ] ])
  assert.deepEqual(vt.map((c) => { const r = classify(c.text, ctx, c.type); return [ r.kind, r.ok ] }), [ [ 'import', true ], [ 'assertion', true ] ])
  // Playwright reports nothing when a file can't import; the gate reads its output.
  const out = fixture('playwright-import.txt')
  assert.deepEqual(classify(out, ctx), { kind: 'import', detail: '/work/src/remove', ok: true, why: 'imports /work/src/remove, which the slice adds' })
  assert.equal(classify(out, { ...ctx, owned: [ 'src/undo.ts' ] }).ok, false)
  assert.match(classify("Error: Cannot find module '/tmp/ffg-Ab12/a/src/readingList' imported from /tmp/ffg-Ab12/a/e2e/x.e2e.ts", ctx).why, /^imports src\/readingList, which isn't a file the slice adds/)
  // A chained locator (a row, then its new button) that ends in the test's own timeout.
  const chained = parseJUnit(fixture('playwright-chained.xml'))
  assert.deepEqual(chained.map((c) => classify(c.text, { owned: [], testIds: [ 'item-remove' ] }, c.type)), [ { kind: 'locator', detail: 'item-remove', ok: true, why: "waits for test id item-remove, which the slice's contract adds" } ])
  assert.equal(classify(chained[0].text, { owned: [], testIds: [] }, chained[0].type).detail, 'item-remove')
  assert.equal(classify(chained[0].text, { owned: [], testIds: [] }, chained[0].type).ok, false)
  // Nested suites and tests straight under <testsuites> (node's reporter) all count.
  const nested = parseJUnit('<testsuites><testsuite name="e" file="e2e/a.mjs"/><testsuite name="a" file="e2e/b.mjs"><testsuite name="d"><testcase name="AC-1 x"/></testsuite><testcase name="AC-2 y"><failure message="AssertionError: no" type="AssertionError"/></testcase></testsuite><testcase name="AC-3 z" file="e2e/c.mjs"/></testsuites>')
  assert.deepEqual(nested.map((c) => [ c.name, c.file, c.outcome ]), [ [ 'AC-1 x', 'e2e/b.mjs', 'passed' ], [ 'AC-2 y', 'e2e/b.mjs', 'failed' ], [ 'AC-3 z', 'e2e/c.mjs', 'passed' ] ])
})

test('merge records a GitHub merge only with approval at the head and green CI; a closed slice can be opened again; forks are ignored', async () => {
  const f = await feature()
  const { ana, ben, world } = f
  await frozenSlice1(f)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  ok(await ana.run('slice', 'iterate', '1'))
  const tip = ana.g('rev-parse', 'HEAD')
  const pr = [ ...world.issues.values() ].find((i) => i.pr?.head === 'factory-foreman/7-slice-1')
  // Merged on GitHub with no approval and no CI: not recorded.
  pr.state = 'MERGED'
  pr.pr.merged = { sha: tip, by: 'ana' }
  assert.match((await ben.run('slice', 'merge', '1')).err, /isn't approved at its head .*it was merged on GitHub; record it by hand/)
  // A fork's PR from a branch of the same name is ignored.
  world.issues.set(99, { number: 99, title: 'fork', body: '', url: 'x', state: 'OPEN', comments: [], artifacts: [], pr: { head: 'factory-foreman/7-slice-2', base: 'factory-foreman/7', fork: true, reviews: [], assignees: [] } })
  assert.equal(JSON.parse(ok(await ana.run('slice', 'list', '--json')).out)['2'], undefined)
  // Slice 2 opened, then its PR closed unmerged: it can be opened again.
  pr.state = 'OPEN'; pr.pr.merged = null
  const two = JSON.parse(ok(await ana.run('slice', 'open', '2', '--json')).out)
  world.issues.get(two.pr).state = 'CLOSED'
  assert.equal(JSON.parse(ok(await ana.run('slice', 'list', '--json')).out)['2'], undefined)
  const again = JSON.parse(ok(await ana.run('slice', 'open', '2', '--json')).out)
  assert.notEqual(again.pr, two.pr)
})

test('evidence providers: built in or a package from the repo, refused when malformed', async () => {
  const top = mkdtempSync(join(tmpdir(), 'ff-prov-'))
  writeFileSync(join(top, 'package.json'), '{ "name": "t", "type": "module" }')
  assert.deepEqual((await loadProviders({ evidence: { providers: null } }, top)).map((p) => p.name), [ 'agent-browser' ])
  mkdirSync(join(top, 'node_modules', 'my-evidence'), { recursive: true })
  writeFileSync(join(top, 'node_modules', 'my-evidence', 'package.json'), '{ "name": "my-evidence", "type": "module", "exports": "./index.mjs" }')
  writeFileSync(join(top, 'node_modules', 'my-evidence', 'index.mjs'), "export default { name: 'mine', collect: async () => ({ ok: true, files: [], links: [], summary: 'x' }) }\n")
  assert.deepEqual((await loadProviders({ evidence: { providers: [ 'agent-browser', 'my-evidence' ] } }, top)).map((p) => p.name), [ 'agent-browser', 'mine' ])
  await assert.rejects(loadProviders({ evidence: { providers: [ 'not-installed' ] } }, top), /isn't installed in this repo/)
  mkdirSync(join(top, 'node_modules', 'bad-evidence'), { recursive: true })
  writeFileSync(join(top, 'node_modules', 'bad-evidence', 'package.json'), '{ "name": "bad-evidence", "type": "module", "exports": "./index.mjs" }')
  writeFileSync(join(top, 'node_modules', 'bad-evidence', 'index.mjs'), "export default { name: 'mine' }\n")
  await assert.rejects(loadProviders({ evidence: { providers: [ 'bad-evidence' ] } }, top), /isn't an evidence provider/)
})

test('slice iterate publishes evidence under slices/<n>/iter-<k>/ and links it pinned; a gate provider records the head run; a failing provider stops it', async () => {
  const f = await feature()
  const { ana, world, origin } = f
  await frozenSlice1(f)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  // A provider like the Playwright one (adjusts the head run, collects from its
  // checkout) and one like agent-browser (collects afterwards).
  const seen = []
  const recorder = {
    name: 'recorder',
    headRun: ({ run, env }) => { seen.push(run.join(' ')); return { run: [ ...run ], env: { ...env, RECORDING: '1' } } },
    collect: ({ cwd, out }) => { writeFileSync(join(out, 'run.webm'), `video from ${cwd.split('/').pop()}`); return { ok: true, files: [ { path: join(out, 'run.webm'), name: 'run.webm', kind: 'video', label: 'AC-1 run' } ], links: [], summary: '1 video' } },
  }
  const shots = { name: 'shots', collect: ({ out }) => { writeFileSync(join(out, 'after.png'), 'png'); return { ok: true, files: [ { path: join(out, 'after.png'), name: 'after.png', kind: 'image', label: 'AC-1 after' } ], links: [], summary: '1 screenshot' } } }
  ana.loadProviders = [ recorder, shots ]
  const runIt = (...a) => main(a, () => ({ ...ana.ctx(), loadProviders: async () => ana.loadProviders }))
  const it = JSON.parse(ok(await runIt('slice', 'iterate', '1', '--json')).out)
  assert.deepEqual(seen, [ 'node run-ac.mjs e2e/AC-1.ac.mjs' ])
  const commit7 = it.iteration.evidence
  assert.ok(commit7)
  assert.equal(origin('ls-tree', '-r', '--name-only', 'refs/heads/factory-foreman-assets/7'), 'slices/1/iter-1/recorder-run.webm\nslices/1/iter-1/shots-after.png')
  // Collected from the gate's head checkout ("b"), before it was removed.
  assert.equal(origin('show', `${commit7}:slices/1/iter-1/recorder-run.webm`), 'video from b')
  const pr = [ ...world.issues.values() ].find((i) => i.pr?.head === 'factory-foreman/7-slice-1')
  const comment = pr.comments.at(-1).body
  assert.match(comment, /\*\*Evidence\*\* \(pinned at [0-9a-f]{7} on factory-foreman-assets\/7\)/)
  assert.ok(comment.includes(`[AC-1 run](https://github.com/owner/sandbox/blob/${commit7}/slices/1/iter-1/recorder-run.webm?raw=true)`), comment)
  assert.ok(comment.includes(`![AC-1 after](https://github.com/owner/sandbox/blob/${commit7}/slices/1/iter-1/shots-after.png?raw=true)`), comment)
  // A provider that isn't ok stops the iteration before anything is pushed.
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1 // again\n')
  commit(ana, 'again', 'src/counter.mjs')
  await reviewed(ana, 1)
  ana.loadProviders = [ { name: 'broken', collect: () => ({ ok: false, files: [], links: [], summary: 'no videos were recorded' }) } ]
  const before = origin('rev-parse', 'refs/heads/factory-foreman/7-slice-1')
  assert.match((await runIt('slice', 'iterate', '1')).err, /Evidence for slice 1 at [0-9a-f]{7} isn't right:\n {2}- broken: no videos were recorded/)
  assert.equal(origin('rev-parse', 'refs/heads/factory-foreman/7-slice-1'), before)
})

test('core holds no test framework: no Playwright imports or names in its source', () => {
  const files = execFileSync('git', [ 'ls-files', '--cached', '--others', '--exclude-standard', 'src' ], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /from ['"]@?playwright|require\(['"]@?playwright/, file)
  }
})

test('publishing keeps every other folder: iterations add up, design/ stays, an unchanged tree reuses its commit', async () => {
  const f = await feature()
  const { ana, origin } = f
  const { publishAssets } = await import('../src/assets/publish.mjs')
  const ctx = ana.ctx()
  const file = (name, text) => { const p = join(ana.cwd, '..', `${name}-${Date.now()}-${Math.random()}`); writeFileSync(p, text); return p }
  const one = await publishAssets(ctx, { n: 7, folder: 'design', files: [ { name: 'AC-1.png', path: file('a', 'wire') } ], message: 'w', what: 'w' })
  const two = await publishAssets(ctx, { n: 7, folder: 'slices/1/iter-1', files: [ { name: 'shot.png', path: file('b', 's1') } ], message: 'e1', what: 'e' })
  const three = await publishAssets(ctx, { n: 7, folder: 'slices/1/iter-2', files: [ { name: 'shot.png', path: file('c', 's2') } ], message: 'e2', what: 'e' })
  assert.equal(origin('ls-tree', '-r', '--name-only', three.commit), 'design/AC-1.png\nslices/1/iter-1/shot.png\nslices/1/iter-2/shot.png')
  assert.equal(origin('log', '--format=%P', '-1', three.commit), two.commit)
  assert.equal(origin('log', '--format=%P', '-1', two.commit), one.commit)
  assert.match(origin('log', '--format=%s', '-1', three.commit), /\[skip ci\]$/)
  const again = await publishAssets(ctx, { n: 7, folder: 'slices/1/iter-2', files: [ { name: 'shot.png', path: file('d', 's2') } ], message: 'e2', what: 'e' })
  assert.equal(again.commit, three.commit)
  await assert.rejects(publishAssets(ctx, { n: 7, folder: 'x', files: [ { name: 'a.png', path: file('e', '1') }, { name: 'a.png', path: file('f', '2') } ], message: 'm', what: 'w' }), /both called a\.png/)
  await assert.rejects(publishAssets(ctx, { n: 7, folder: 'x', files: [ { name: '..', path: file('g', '1') } ], message: 'm', what: 'w' }), /isn't a plain file name/)
})

test('the agent-browser provider replays at base and head from checkouts: base trouble is evidence, a head failure isn\'t ok', async () => {
  const f = await feature()
  const { ana } = f
  const { agentBrowserEvidence } = await import('../src/evidence/agent-browser.mjs')
  ok(await ana.run('slice', 'open', '1'))
  ana.g('switch', '-q', 'factory-foreman/7-slice-1')
  put(ana, 'show/AC-1.json', JSON.stringify({ ac: 'AC-1', says: 'adds one', steps: [ { click: 'count' } ] }))
  commit(ana, 'show', 'show/AC-1.json')
  const testsCommit = ana.g('rev-parse', 'HEAD')
  const slice = { tests: { commit: testsCommit, show: { 'show/AC-1.json': 'x' } } }
  const out = mkdtempSync(join(tmpdir(), 'ff-ab-'))
  const calls = []
  const replay = (fail) => async (ctx, { cwd, shots }) => {
    calls.push([ shots.prefix, cwd.split('/').pop() ])
    if (fail === 'throw') throw new Error("The preview server isn't up")
    writeFileSync(join(shots.dir, `${shots.prefix}-AC-1-open.png`), 'png')
    return [ { path: 'show/AC-1.json', ac: 'AC-1', ok: !fail, failed: fail ? { step: 1, error: 'no element' } : null, shots: [ { path: join(shots.dir, `${shots.prefix}-AC-1-open.png`), moment: 'open' } ] } ]
  }
  const run = (base, head) => agentBrowserEvidence.collect({ ctx: { ...ana.ctx(), replayShow: async (c, o) => (o.shots.prefix === 'base' ? base : head)(c, o) }, slice, base: ana.g('rev-parse', 'factory-foreman/7'), head: testsCommit, config: { preview: { start: [ 'x' ], url: 'http://localhost:1' } }, top: ana.cwd, out })
  const good = await run(replay('fail'), replay(null))
  assert.equal(good.ok, true)
  assert.deepEqual(calls, [ [ 'base', 'a' ], [ 'head', 'b' ] ])
  assert.deepEqual(good.files.map((x) => x.label), [ 'AC-1 before (base), page open', 'AC-1 after (head), page open' ])
  const noBase = await run(replay('throw'), replay(null))
  assert.equal(noBase.ok, true)
  assert.match(noBase.summary, /the app didn't run at base \(The preview server isn't up\)/)
  const badHead = await run(replay('fail'), replay('fail'))
  assert.equal(badHead.ok, false)
  assert.match(badHead.summary, /AC-1 stops at step 1 at head: no element/)
})

test('the evidence section is text: provider names, labels, summaries and links can\'t add markup or records', async () => {
  const { evidenceSection } = await import('../src/evidence/providers.mjs')
  const section = evidenceSection([ { name: 'x<!-- factory-foreman:record {"a":"', summary: 'ok\n<!-- factory-foreman:record {', files: [ { kind: 'image', label: 'a](http://evil)[b', published: 'p.png' } ], links: [ { label: 'l', url: 'javascript:alert(1)' }, { label: 'r', url: 'https://example.com/r' } ] } ], (n) => `https://github.com/o/r/blob/c/${n}?raw=true`)
  assert.doesNotMatch(section, /<!--/)
  assert.doesNotMatch(section, /javascript:/)
  assert.match(section, /!\[ahttp:\/\/evilb\]\(https:\/\/github\.com\/o\/r\/blob\/c\/p\.png\?raw=true\)/)
  assert.match(section, /\[r\]\(https:\/\/example\.com\/r\)/)
})

test('a retried iteration reuses the evidence it already published when only the slice push failed', async () => {
  const f = await feature()
  const { ana, origin } = f
  await frozenSlice1(f)
  put(ana, 'src/counter.mjs', 'export const add = (n) => n + 1\n')
  commit(ana, 'counter', 'src/counter.mjs')
  await reviewed(ana, 1)
  // The same screenshot on the retry (reuse checks the bytes).
  const shots = { name: 'shots', collect: ({ out }) => { writeFileSync(join(out, 'after.png'), 'png'); return { ok: true, files: [ { path: join(out, 'after.png'), name: 'after.png', kind: 'image', label: 'AC-1 after' } ], links: [], summary: '1 screenshot' } } }
  const { publishAssets } = await import('../src/assets/publish.mjs')
  let published = 0
  const runIt = (...a) => main(a, () => ({ ...ana.ctx(), loadProviders: async () => [ shots ], publishAssets: (...x) => { published++; return publishAssets(...x) } }))
  // The slice push fails once (the evidence goes from the assets repo, so it isn't affected).
  const flag = join(ana.cwd, '..', `fail-push-${Date.now()}`)
  writeFileSync(flag, '1')
  writeFileSync(join(ana.cwd, '.git', 'hooks', 'pre-push'), `#!/bin/sh\n[ -f "${flag}" ] && { rm -f "${flag}"; echo "network down" >&2; exit 1; }\nexit 0\n`, { mode: 0o755 })
  assert.equal((await runIt('slice', 'iterate', '1')).code, 2)
  assert.equal(published, 1)
  const first = origin('rev-parse', 'refs/heads/factory-foreman-assets/7')
  const it = JSON.parse(ok(await runIt('slice', 'iterate', '1', '--json')).out)
  assert.equal(published, 1)
  assert.equal(it.iteration.evidence, first)
  assert.equal(origin('rev-parse', 'refs/heads/factory-foreman-assets/7'), first)
})
