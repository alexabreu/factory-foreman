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
  assert.deepEqual(command('claude', 'opus'), [ 'claude', '-p', '--output-format', 'json', '--model', 'opus' ])
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
      // A persona's own case has at least one check; a test-engineer case holds the
      // test-quality checks moved out of the code-reviewer case of the same name.
      assert.equal(scenario.persona, persona)
      assert.ok(criteria.length >= 1 && criteria.every((c) => typeof c.check === 'function' && c.text), `${persona}/${id}`)
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

test('the remove-undo case has no stale-index check: add() appends, so restoring by index is correct for AC-2', async () => {
  const criteria = (await import('../evals/cases/code-reviewer/seeded-remove-undo/criteria.mjs')).default
  assert.equal(criteria.find((c) => /stale index/u.test(c.text)), undefined)
  const tve = (await import('../evals/cases/test-verification-engineer/seeded-remove-undo/criteria.mjs')).default
  const between = tve.find((c) => /added between/u.test(c.text))
  assert.equal(between.check('AC-2: the test never adds a book in between remove and undo').passed, true)
})

test('evidence for the remove-undo case: with an appending add(), undo by stored index restores the original order', () => {
  // The diff's remove and undo, and the sample's add (src/reading-list.ts:25), replayed on plain arrays.
  const add = (items, title) => [ ...items, title ]
  const remove = (items, i) => ({ items: items.filter((_, j) => j !== i), removed: { item: items[i], index: i } })
  const undo = (items, removed) => { const out = [ ...items ]; out.splice(removed.index, 0, removed.item); return out }
  for (const i of [ 0, 1 ]) {
    const r = remove([ 'Dune', 'Emma' ], i)
    assert.deepEqual(undo(add(r.items, 'Ubik'), r.removed), [ 'Dune', 'Emma', 'Ubik' ])
  }
})

test('replies give their text and tokens: Claude JSON usage, Codex "tokens used", or plain text with none', async () => {
  const { reply } = await import('../evals/run.mjs')
  const claude = reply(JSON.stringify({ result: '[]', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, total_cost_usd: 0.01 }))
  assert.deepEqual(claude, { stdout: '[]', tokens: 115, usage: { input: 10, output: 5, cacheRead: 100, cacheCreation: 0 }, costUsd: 0.01 })
  assert.equal(reply('[]', 'tokens used\n12,345\n').tokens, 12345)
  assert.equal(reply('[]', '\u001b[2mtokens used\u001b[0m\n3,675\n').tokens, 3675)
  assert.deepEqual(reply('[{"id":"a"}]'), { stdout: '[{"id":"a"}]', tokens: null, costUsd: null })
})

test('the verifier gets the case, the lens findings and its own output contract instead of the finders\'', async () => {
  const { verifierPrompt, OUTPUT, VERIFY } = await import('../evals/run.mjs')
  const read = (f) => (f === 'pr.md' ? 'AC-1: it works' : DIFF)
  const text = verifierPrompt('---\nname: v\n---\nJudge.', { task: 'Review.', inputs: [ 'pr.md', 'pr.diff' ] }, read, [ { id: 'correctness-lens/x', text: 'bug', where: 'src/a.ts:40' } ])
  assert.ok(text.includes('correctness-lens/x') && text.includes(VERIFY) && !text.includes(OUTPUT))
  assert.ok(text.includes('AC-1: it works'), 'the description goes whole')
  assert.ok(text.includes('line 40') && !text.includes('line 2\n'), 'the diff goes as excerpts')
})

test('the verifier is told to keep a lens\'s ask and to add one when lenses disagree', async () => {
  const { VERIFY } = await import('../evals/run.mjs')
  assert.match(VERIFY, /"ask"/u)
  assert.match(VERIFY, /Found while verifying/u)
})

test('options are checked, so flags passed as one argument fail instead of running the wrong variant', () => {
  assert.throws(() => parseArgs([ '--persona', 'p', '--lenses a.md --verifier v.md', '--label', 'x' ]), /Unknown option/u)
  assert.throws(() => parseArgs([ '--persona', 'p', '--lenses', 'a.md' ]), /needs --verifier/u)
  assert.equal(parseArgs([ '--persona', 'p', '--lenses', 'a.md', '--verifier', 'v.md' ]).verifier, 'v.md')
})

// A diff of src/a.ts with 80 lines, every one added, so new line n reads "line n".
const DIFF = [ 'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -0,0 +1,80 @@', ...Array.from({ length: 80 }, (_, i) => `+line ${i + 1}`) ].join('\n')

test('excerpts keep the lines around each finding, the headers, and name what the diff lacks', async () => {
  const { excerpts } = await import('../evals/lib/excerpts.mjs')
  const out = excerpts(DIFF, [ { where: 'src/a.ts:40' }, { where: 'src/b.ts:3' } ], 5)
  assert.match(out, /\+\+\+ b\/src\/a\.ts/u)
  assert.match(out, /@@ -0,0 \+1,80 @@/u)
  for (const n of [ 35, 40, 45 ]) assert.match(out, new RegExp(`\\+line ${n}\\n|\\+line ${n}$`, 'u'))
  assert.doesNotMatch(out, /\+line 34\n/u)
  assert.doesNotMatch(out, /\+line 46\n/u)
  assert.match(out, /Not in the diff: src\/b\.ts:3/u)
  assert.match(excerpts(DIFF, [ { where: 'src/a.ts' } ]), /\+line 80/u, 'no line: the whole file section')
})

test('test-quality checks live in the test engineer\'s cases, and the slice row grades both personas together', async () => {
  const { loadCase, union } = await import('../evals/run.mjs')
  const root = join(import.meta.dirname, '..', 'evals', 'cases')
  const cr = (await loadCase(join(root, 'code-reviewer', 'seeded-toggle-all'), root)).criteria.map((c) => c.text)
  const tve = (await loadCase(join(root, 'test-verification-engineer', 'seeded-toggle-all'), root)).criteria.map((c) => c.text)
  assert.ok(!cr.some((t) => /asserts only the length/u.test(t)) && tve.some((t) => /asserts only the length/u.test(t)))
  const { mkdtempSync, writeFileSync: write } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'ff-union-'))
  const run = (output) => ({ k: 1, ms: 1000, tokens: 10, output })
  write(join(dir, 'a.json'), JSON.stringify({ persona: 'code-reviewer', harness: 'claude', cases: { 'seeded-toggle-all': { runs: [ run('items[0] is undefined on an empty list, so it crashes. The first book decides for a mixed list, breaking AC-1. reading-list.ts:31 reading-list.ts:33') ] } } }))
  write(join(dir, 'b.json'), JSON.stringify({ persona: 'test-verification-engineer', harness: 'claude', cases: { 'seeded-toggle-all': { runs: [ run('The test checks only the length with toBe(2), so it never checks read.') ] } } }))
  const report = await union(join(dir, 'a.json'), join(dir, 'b.json'), root, 'test', dir)
  assert.equal(report.cases['seeded-toggle-all'].runs[0].score, 1)
  assert.equal(report.cases['seeded-toggle-all'].runs[0].tokens, 20)
})

test('in a slice row, a check marked own judges only its persona\'s reply', async () => {
  const { union } = await import('../evals/run.mjs')
  const { mkdtempSync, writeFileSync: write } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const root = join(import.meta.dirname, '..', 'evals', 'cases')
  const dir = mkdtempSync(join(tmpdir(), 'ff-own-'))
  const run = (output) => ({ k: 1, ms: 1, tokens: 1, output })
  write(join(dir, 'a.json'), JSON.stringify({ persona: 'code-reviewer', cases: { 'bait-clean-copy': { runs: [ run('[]') ] } } }))
  write(join(dir, 'b.json'), JSON.stringify({ persona: 'test-verification-engineer', cases: { 'bait-clean-copy': { runs: [ run('[{"id":"t","severity":"major","text":"toBe(list) proves identity, not contents","where":"src/reading-list.test.ts:12"}]') ] } } }))
  const r = await union(join(dir, 'a.json'), join(dir, 'b.json'), root, 'own', dir)
  assert.equal(r.cases['bait-clean-copy'].runs[0].results.find((c) => /above minor/u.test(c.text)).passed, true)
})

test('a run that errors is retried; a case with a run that never completes is incomplete and not scored', async () => {
  const { mkdtempSync, mkdirSync: mk, writeFileSync: write, readdirSync: ls, readFileSync: read } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const tmp = mkdtempSync(join(tmpdir(), 'ff-retry-'))
  // A stand-in claude: fails on its first call for case "flaky", always fails for "down".
  const bin = join(tmp, 'bin'); mk(bin)
  write(join(bin, 'claude'), `#!/bin/sh\nin=$(cat)\ncase "$in" in *DOWN*) exit 1;; esac\ncase "$in" in *FLAKY*) [ -f ${tmp}/seen ] || { touch ${tmp}/seen; echo 403 >&2; exit 1; };; esac\necho '{"result":"[]","usage":{"input_tokens":1,"output_tokens":1}}'\n`, { mode: 0o755 })
  for (const [ id, word ] of [ [ 'down', 'DOWN' ], [ 'flaky', 'FLAKY' ] ]) {
    const d = join(tmp, 'cases', 'p', id); mk(join(d, 'files'), { recursive: true })
    write(join(d, 'files', 'in.md'), word)
    write(join(d, 'scenario.json'), JSON.stringify({ id, persona: 'p', task: 't', inputs: [ 'files/in.md' ] }))
    write(join(d, 'criteria.mjs'), "export default [ { text: 'replies', check: (o) => ({ passed: o.includes('[]') }) } ]\n")
  }
  write(join(tmp, 'agent.md'), '---\nname: p\n---\nReview.')
  const r = spawnSync(process.execPath, [ join(import.meta.dirname, '..', 'evals', 'run.mjs'), '--persona', 'p', '--cases', join(tmp, 'cases'), '--agent', join(tmp, 'agent.md'), '--runs', '1', '--out', join(tmp, 'out') ], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FF_EVAL_BACKOFF_MS: '1,1' }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const report = JSON.parse(read(join(tmp, 'out', ls(join(tmp, 'out'))[0]), 'utf8'))
  assert.equal(report.cases.flaky.incomplete, false)
  assert.equal(report.cases.flaky.attemptErrors, 1)
  assert.equal(report.cases.down.incomplete, true)
  assert.equal(report.cases.down.attemptErrors, 3)
  assert.deepEqual(report.incomplete, [ 'down' ])
  assert.equal(report.overall.n, 1)
})

test('round 2 cases: the in-between check reads either word order, and the retired clean case is kept but not run', async () => {
  const tve = (await import('../evals/cases/test-verification-engineer/seeded-remove-undo/criteria.mjs')).default
  const between = tve.find((c) => /added between/u.test(c.text))
  assert.equal(between.check('AC-2 explicitly requires undo after an intervening addition, but this test immediately calls undo').passed, true)
  assert.equal(between.check('remove() mutates the list it was given').passed, false)
  const retired = JSON.parse(readFileSync(new URL('../evals/cases/test-verification-engineer/clean-strong-tests/scenario.json', import.meta.url), 'utf8'))
  assert.ok(retired.retired)
})

test('round 3: the tautology check reads the phrasings round 2 undercounted', async () => {
  const c = (await import('../evals/cases/test-verification-engineer/seeded-mock-and-tautology/criteria.mjs')).default.find((x) => /never fail/u.test(x.text))
  for (const said of [ 'toBeGreaterThanOrEqual(0)` holds for any array, so no input can make it fail', 'toBeGreaterThanOrEqual(0)` holds for every array', "AC-1's length >= 0 assertion cannot fail for any array", 'toBeGreaterThanOrEqual(0)` can\'t fail, because an array\'s length is never negative' ]) assert.equal(c.check(said).passed, true, said)
  assert.equal(c.check('The test mocks clearRead, so it never runs the real function').passed, false)
})

test('the implementer\'s status is read from its STATUS line; a case can name its own output contract', async () => {
  const { statusOf, statusIn } = await import('../evals/lib/status.mjs')
  assert.equal(statusOf('STATUS: DONE_WITH_CONCERNS\nreport'), 'DONE_WITH_CONCERNS')
  assert.equal(statusOf('Some narration.\n**STATUS:** BLOCKED\n'), 'BLOCKED')
  assert.equal(statusOf('STATUS: DONE'), 'DONE')
  assert.equal(statusOf('I am done.'), null)
  assert.equal(statusIn([ 'BLOCKED', 'NEEDS_CONTEXT' ])('STATUS: NEEDS_CONTEXT').passed, true)
  assert.equal(statusIn([ 'DONE' ])('STATUS: DONE_WITH_CONCERNS').passed, false)
  const text = prompt('---\nname: x\n---\nBuild.', { task: 'T', inputs: [], output: 'Reply with STATUS first.' }, () => '')
  assert.ok(text.endsWith('Reply with STATUS first.\n'))
})

test('the judge keeps a pass only when its quote is really in the reply, and only recall checks go to it', async () => {
  const { verdicts, isRecall, judgePrompt } = await import('../evals/lib/judge.mjs')
  const replies = [ { id: 'R1', text: 'The test mocks `clearRead`, so it never runs the real function.' }, { id: 'R2', text: 'Looks fine.' } ]
  const judged = JSON.stringify([ { reply: 'R1', line: 1, pass: true, quote: 'The test mocks clearRead' }, { reply: 'R2', line: 1, pass: true, quote: 'the test mocks clearRead' } ])
  const v = verdicts(judged, replies, 1)
  assert.equal(v.R1[0].pass, true)
  assert.deepEqual([ v.R2[0].pass, v.R2[0].why ], [ false, 'quote not in the reply' ])
  const crit = (await import('../evals/cases/code-reviewer/bait-clean-copy/criteria.mjs')).default
  assert.equal(crit.filter(isRecall).length, 0, 'precision checks stay as code')
  const tve = (await import('../evals/cases/test-verification-engineer/seeded-mock-and-tautology/criteria.mjs')).default
  assert.deepEqual(tve.map(isRecall), [ true, true, true, false ], 'the citation check stays as code')
  const p = judgePrompt({ inputs: [ 'a.diff' ] }, () => 'DIFF', [ 'Finds X' ], replies)
  assert.ok(p.includes('<reply id="R2">') && p.includes('1. Finds X') && !/claude|codex|variant|contract/iu.test(p.split('# Replies')[1]))
})

test('a quote matches a JSON reply whose quotation marks are escaped', async () => {
  const { verdicts } = await import('../evals/lib/judge.mjs')
  const replies = [ { id: 'R1', text: '[{"text":"The input never marks \\"Dune\\" as read, so AC-1 never runs."}]' } ]
  const v = verdicts(JSON.stringify([ { reply: 'R1', line: 1, pass: true, quote: 'never marks "Dune" as read' } ]), replies, 1)
  assert.equal(v.R1[0].pass, true)
})

test('every public recall case has 3 or 4 decoys, each aimed at one of its recall lines', async () => {
  const { isRecall } = await import('../evals/lib/judge.mjs')
  const root = join(import.meta.dirname, '..', 'evals', 'cases')
  // Every seeded case of a reviewer persona has decoys; clean cases have no recall lines.
  const seeded = readdirSync(root).flatMap((p) => readdirSync(join(root, p)).filter((id) => id.startsWith('seeded-')).map((id) => `${p}/${id}`))
  assert.ok(seeded.length >= 8)
  for (const c of seeded) {
    const { decoys } = JSON.parse(readFileSync(join(root, c, 'decoys.json'), 'utf8'))
    const lines = (await import(pathToFileURL(join(root, c, 'criteria.mjs')).href)).default.filter(isRecall).map((x) => x.text)
    assert.ok(decoys.length >= 3 && decoys.length <= 4, c)
    for (const d of decoys) assert.ok(lines.includes(d.line), `${c}: ${d.line}`)
  }
})

test('with --judge, recall checks take the judge\'s verdict, the regex verdict stays beside it, and decoy passes are counted', async () => {
  const { mkdtempSync, mkdirSync: mk, writeFileSync: write } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { judgeCase } = await import('../evals/run.mjs')
  const tmp = mkdtempSync(join(tmpdir(), 'ff-judge-'))
  const bin = join(tmp, 'bin'); mk(bin)
  // A stand-in judge: passes line 1 for every reply, quoting "mocks clearRead".
  write(join(bin, 'claude'), `#!/bin/sh\nin=$(cat)\nn=$(printf '%s' "$in" | grep -o '<reply id="R[0-9]*">' | wc -l | tr -d ' ')\nout='['\ni=1\nwhile [ $i -le $n ]; do out="$out{\\"reply\\":\\"R$i\\",\\"line\\":1,\\"pass\\":true,\\"quote\\":\\"mocks clearRead\\"},"; i=$((i+1)); done\nout="\${out%,}]"\nnode -e 'console.log(JSON.stringify({result: process.argv[1]}))' "$out"\n`, { mode: 0o755 })
  const caseDir = join(tmp, 'case'); mk(caseDir)
  write(join(caseDir, 'decoys.json'), JSON.stringify({ decoys: [ { line: 'Finds the mock', reply: 'Spying is fine; it mocks clearRead neatly.' } ] }))
  const criteria = [ { text: 'Finds the mock', weight: 3, check: (o) => matches(o, /mocks clearRead/u) }, { text: 'Cites', weight: 1, check: () => ({ passed: true }) } ]
  const runs = [ { k: 1, output: 'It never says so.', score: 0.25, results: [ { text: 'Finds the mock', weight: 3, passed: false, evidence: 'no' }, { text: 'Cites', weight: 1, passed: true } ] } ]
  const saved = process.env.PATH
  process.env.PATH = `${bin}:${saved}`
  try {
    const j = await judgeCase({ judge: 'claude' }, caseDir, { inputs: [] }, () => '', criteria, runs)
    // The real reply doesn't contain the quote, so the judge's pass is refused.
    assert.equal(runs[0].results[0].passed, false)
    assert.equal(runs[0].results[0].by, 'judge')
    assert.equal(runs[0].results[0].regexPassed, false)
    assert.equal(runs[0].regexScore, 0.25)
    // The decoy does contain it, so that's a counted false pass.
    assert.equal(j.decoyFalsePasses, 1)
  } finally { process.env.PATH = saved }
})
