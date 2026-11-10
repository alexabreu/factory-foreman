// Phase 2: reviews that must be settled before a checkpoint, amendments that
// keep or need approval, status, and notes captured from transcripts.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { main } from '../src/cli.mjs'
import { DEFAULTS } from '../src/config/load.mjs'
import { isBotLogin, nextMinor, nextVersion, parseLabel, parseRecords, stepState, trustedRecords } from '../src/issue/records.mjs'
import { checkSettlements, parseFindings, reviewersFor } from '../src/review/briefs.mjs'
import { parseExtracted, transcriptText } from '../src/capture/extract.mjs'
import { readLog, stateDir, worktreeDraftPath } from '../src/state/local.mjs'
import { parseDraft, structuralBlocks } from '../src/steps/structure.mjs'
import { fakeGitHub } from './fixtures/github.mjs'
import { DESIGN, SHAPE } from './structure.test.mjs'

const REVIEWED = { reviewers: { shape: [ 'test-verification-engineer' ], design: [ 'software-architect', 'ux-designer?visual' ] }, secondOpinion: null }

function developer(world, login, { env = {}, isTTY = false, answer = '', config = {}, exec = null } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ff-p2-'))
  execFileSync('git', [ 'init', '-q' ], { cwd })
  let minute = 0
  const calls = []
  const ctx = () => ({
    cwd,
    env,
    harness: env.CODEX_HOME ? 'codex' : env.CLAUDECODE ? 'claude-code' : 'terminal',
    isTTY,
    now: () => new Date(Date.parse('2026-11-10T12:00:00Z') + (minute++) * 60_000),
    config: () => ({ ...structuredClone(DEFAULTS), ...REVIEWED, ...config }),
    issue: () => 7,
    stateDir: () => stateDir(cwd, 7),
    draftPath: (step) => worktreeDraftPath(cwd, 7, step),
    author: () => login,
    github: () => world.as(login),
    prompt: async () => answer,
    exec: async (argv, opts) => { calls.push({ argv, opts }); return exec ? exec(argv, opts) : { code: 0, stdout: '[]', stderr: '' } },
  })
  return { cwd, calls, run: (...argv) => main(argv, ctx), draft: (step) => worktreeDraftPath(cwd, 7, step), dir: () => stateDir(cwd, 7) }
}

function writeDraft(file, body) {
  const head = readFileSync(file, 'utf8').match(/^---\n[\s\S]*?\n---\n/)[0]
  writeFileSync(file, head + body.replace(/^---\n[\s\S]*?\n---\n/, ''))
}

async function settle(dev, step, reviewers = { 'test-verification-engineer': [] }) {
  const file = join(dev.cwd, `${step}-findings.json`)
  writeFileSync(file, JSON.stringify({ reviewers }))
  const saved = await dev.run('review', 'save', step, '--findings', file)
  assert.equal(saved.code, 0, saved.err)
  return saved
}

function setup() {
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write' } })
  world.addIssue(7, 'Readers want to track what they have read.')
  return { world, ana: developer(world, 'ana'), ben: developer(world, 'ben', { isTTY: true, answer: 'y' }) }
}

// Shape v1, reviewed and approved by ben.
async function approvedShape() {
  const { world, ana, ben } = setup()
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await settle(ana, 'shape')
  assert.equal((await ana.run('checkpoint', 'shape')).code, 0)
  const ok = await ben.run('approve', 'shape', 'v1')
  assert.equal(ok.code, 0, ok.err)
  return { world, ana, ben }
}

test('labels: vN and vN.M parse, and numbering only goes up', () => {
  assert.deepEqual(parseLabel('v3'), { major: 3, minor: 0 })
  assert.deepEqual(parseLabel('v3.2'), { major: 3, minor: 2 })
  for (const bad of [ 'v0', 'v1.0', 'v1.', 'v1.2.3', '3', 'v1234567', 'v1.1234567' ]) assert.equal(parseLabel(bad), null, bad)
  const state = { highest: [ 'v1', 'v1.1', 'v1.2', 'v2', 'v1.3' ] }
  assert.equal(nextVersion(state), 'v3')
  assert.equal(nextMinor(state, 1), 'v1.4')
  assert.equal(nextMinor(state, 2), 'v2.1')
  assert.throws(() => nextVersion({ highest: [ 'v999999' ] }), /reached v999999/)
})

test('a GraphQL bot login counts only when the account is a Bot', () => {
  assert.equal(isBotLogin('foreman[bot]', 'Bot', 'foreman[bot]'), true)
  assert.equal(isBotLogin('foreman', 'Bot', 'foreman[bot]'), true)
  assert.equal(isBotLogin('foreman', 'User', 'foreman[bot]'), false)
  assert.equal(isBotLogin('foreman', undefined, 'foreman[bot]'), false)
  assert.equal(isBotLogin(null, 'Bot', 'foreman[bot]'), false)
  assert.equal(isBotLogin('foreman', 'Bot', null), false)
})

test('a checkpoint record from the bare bot slug counts only as a Bot', async () => {
  const body = '<!-- factory-foreman:record {"type":"checkpoint","step":"shape","version":"v1","hash":"h","artifact":{"number":1,"version":1}} -->'
  const at = '2026-11-10T00:00:00Z'
  const comments = [
    { id: 1, login: 'foreman', type: 'Bot', body, createdAt: at, updatedAt: at },
    { id: 2, login: 'foreman', type: 'User', body: body.replace('v1', 'v9'), createdAt: at, updatedAt: at },
  ]
  const trusted = await trustedRecords(comments, { botLogin: 'foreman[bot]', permission: async () => 'none' })
  assert.deepEqual(trusted.map((r) => r.version), [ 'v1' ])
  // The User's v9 doesn't push numbering either.
  assert.deepEqual(stepState(trusted, 'shape', { comments, botLogin: 'foreman[bot]' }).highest, [ 'v1', 'v1' ])
})

test('reviewers: ?visual only when a criterion is visual, and the second opinion when configured', () => {
  const config = { ...structuredClone(DEFAULTS), ...REVIEWED, secondOpinion: { command: [ 'codex', 'exec' ], steps: [ 'design' ] } }
  const visualShape = parseDraft(SHAPE)
  const plainShape = parseDraft(SHAPE.replace('| A book can be marked read | yes |', '| A book can be marked read | no |'))
  assert.deepEqual(reviewersFor('design', config, { draft: parseDraft(DESIGN), shape: visualShape }), [ 'software-architect', 'ux-designer', 'second-opinion' ])
  assert.deepEqual(reviewersFor('design', config, { draft: parseDraft(DESIGN), shape: plainShape }), [ 'software-architect', 'second-opinion' ])
  assert.deepEqual(reviewersFor('shape', config, { draft: visualShape }), [ 'test-verification-engineer' ])
  assert.deepEqual(reviewersFor('shape', { ...config, reviewers: { shape: [] } }, { draft: visualShape }), [])
})

test('findings: a reply is read from a fenced block or plain text, and bad items are dropped', () => {
  assert.deepEqual(parseFindings('Here you go:\n```json\n[{"id":"x","severity":"blocking","text":"AC-2 is vague","where":"AC-2"}]\n```'), [ { id: 'x', severity: 'blocking', text: 'AC-2 is vague', where: 'AC-2' } ])
  assert.deepEqual(parseFindings('[{"text":"Missing edge case"},{"id":"empty"}]'), [ { id: 'F1', severity: 'major', text: 'Missing edge case', where: '' } ])
  assert.deepEqual(parseFindings('[]'), [])
  assert.throws(() => parseFindings('no findings here'), /no JSON array/)
})

test('settlements: every reviewer present, every finding settled, every overrule explained', () => {
  const reviewers = [ 'a', 'b' ]
  assert.deepEqual(checkSettlements({ reviewers: { a: [], b: [] } }, reviewers), [])
  assert.match(checkSettlements({ reviewers: { a: [] } }, reviewers).join('\n'), /b is missing/)
  assert.match(checkSettlements({ reviewers: { a: [], b: [], c: [] } }, reviewers).join('\n'), /c wasn't briefed/)
  assert.match(checkSettlements({ reviewers: { a: [ { id: '1', text: 't' } ], b: [] } }, reviewers).join('\n'), /isn't settled/)
  assert.match(checkSettlements({ reviewers: { a: [ { id: '1', text: 't', settlement: 'overruled', reason: ' ' } ], b: [] } }, reviewers).join('\n'), /overruled without a reason/)
  assert.deepEqual(checkSettlements({ reviewers: { a: [ { id: '1', text: 't', settlement: 'overruled', reason: 'out of scope' } ], b: [ { text: 'u', settlement: 'changed' } ] } }, reviewers), [])
  assert.match(checkSettlements({ reviewers: [] }, reviewers).join('\n'), /needs \{ "reviewers"/)
})

test('review prints one brief per reviewer with the draft hash; checkpoint waits for a saved review', async () => {
  const { world, ana } = setup()
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  const briefs = await ana.run('review', 'shape', '--json')
  assert.equal(briefs.code, 0, briefs.err)
  const out = JSON.parse(briefs.out)
  assert.equal(out.briefs.length, 1)
  assert.equal(out.briefs[0].reviewer, 'test-verification-engineer')
  assert.match(out.briefs[0].brief, /<draft>[\s\S]*AC-2[\s\S]*<\/draft>/)
  assert.match(out.briefs[0].brief, /"severity"/)
  assert.match(out.briefs[0].brief, new RegExp(out.hash))

  const unreviewed = await ana.run('checkpoint', 'shape')
  assert.equal(unreviewed.code, 2)
  assert.match(unreviewed.err, /hasn't been reviewed as it is now/)
  assert.equal(world.log.length, 0, 'nothing posted')

  // An unsettled finding can't be saved.
  const file = join(ana.cwd, 'findings.json')
  writeFileSync(file, JSON.stringify({ reviewers: { 'test-verification-engineer': [ { id: 'T1', text: 'AC-2 needs a case for an empty list' } ] } }))
  const unsettled = await ana.run('review', 'save', 'shape', '--findings', file)
  assert.equal(unsettled.code, 2)
  assert.match(unsettled.err, /T1 isn't settled/)

  await settle(ana, 'shape', { 'test-verification-engineer': [ { id: 'T1', text: 'AC-2 needs a case for an empty list', settlement: 'overruled', reason: 'An empty list shows nothing either way.' } ] })
  const saved = readdirSync(join(ana.dir(), 'reviews'))
  assert.equal(saved.length, 1)
  assert.match(saved[0], /^shape-[0-9a-f]{64}\.json$/)

  // An edit after saving needs a new review save.
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Syncing between devices, for now.'))
  assert.match((await ana.run('checkpoint', 'shape')).err, /hasn't been reviewed as it is now/)
  await settle(ana, 'shape')
  const posted = await ana.run('checkpoint', 'shape', '--json')
  assert.equal(posted.code, 0, posted.err)
  assert.match(JSON.parse(posted.out).review, /^[0-9a-f]{64}$/)
})

test('review --headless runs every brief through the configured commands and refuses when one fails', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7, '')
  const exec = (argv) => (argv[0] === 'second' ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '```json\n[{"id":"A1","severity":"minor","text":"Name the filter","where":"AC-2"}]\n```', stderr: '' })
  const ana = developer(world, 'ana', { exec, config: { review: { headless: { command: [ 'codex', 'exec' ] } }, secondOpinion: { command: [ 'second', 'opinion' ], steps: [ 'shape' ] } } })
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  const run = await ana.run('review', 'shape', '--headless')
  assert.equal(run.code, 2)
  assert.match(run.err, /test-verification-engineer: 1 finding\(s\)\n- \[minor\] A1: Name the filter \(AC-2\)/)
  assert.match(run.err, /second-opinion: FAILED \(exited with code 1: boom\)/)
  assert.deepEqual(ana.calls.map((c) => c.argv), [ [ 'codex', 'exec' ], [ 'second', 'opinion' ] ])
  // The brief goes on stdin, and the reviewer's session isn't captured as notes.
  assert.match(ana.calls[0].opts.input, /You are the test-verification-engineer reviewer/)
  assert.equal(ana.calls[0].opts.env.FACTORY_FOREMAN_CAPTURE, '1')
})

test('a Design brief includes the approved Shape, and ux-designer only for a visual Shape', async () => {
  const { ana } = await approvedShape()
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN)
  const out = JSON.parse((await ana.run('review', 'design', '--json')).out)
  assert.deepEqual(out.briefs.map((b) => b.reviewer), [ 'software-architect', 'ux-designer' ])
  assert.match(out.briefs[0].brief, /approved Shape \(v1\)[\s\S]*<shape>[\s\S]*AC-1/)
})

test('amend: wording only is minor and keeps the approval; a changed criterion is material', async () => {
  const { world, ana, ben } = await approvedShape()

  // Amending needs a reason.
  assert.match((await ana.run('amend', 'shape')).err, /Say why/)

  // A wording change: v1.1, no approval needed, v1's approval carries.
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('The list mixes read and unread books.', 'Today the list mixes read and unread books.'))
  await settle(ana, 'shape')
  const minor = await ana.run('amend', 'shape', '--reason', 'Clearer problem statement', '--json')
  assert.equal(minor.code, 0, minor.err)
  const record = JSON.parse(minor.out)
  assert.equal(record.version, 'v1.1')
  assert.equal(record.minor, true)
  assert.equal(record.carries, 'v1')
  const status = await ana.run('status')
  assert.match(status.out, /Shape: v1\.1 approved \(carries v1\)/)
  assert.match(world.issues.get(7).body, /Shape v1\.1 approved \(carries v1\)/)
  const approveMinor = await ben.run('approve', 'shape', 'v1.1')
  assert.equal(approveMinor.code, 2)
  assert.match(approveMinor.err, /carries v1's approval/)

  // The Changelog says why, and that it was minor.
  const changelog = world.issues.get(7).artifacts.find((a) => a.versions[0].name === 'Changelog').versions.at(-1).body
  assert.match(changelog, /## Shape v1\.1, [\s\S]*Amendment \(minor: wording only, keeps v1's approval\)\. Reason: Clearer problem statement[\s\S]*Affected slices: none\./)

  // Changing one criterion: v2, and it needs approval.
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Today the list mixes', 'The list mixes').replace('| The list can show only unread books | no |', '| The list can show only unread books, newest first | no |'))
  await settle(ana, 'shape')
  const material = await ana.run('amend', 'shape', '--reason', 'Order matters', '--json')
  assert.equal(material.code, 0, material.err)
  assert.equal(JSON.parse(material.out).version, 'v2')
  assert.equal(JSON.parse(material.out).minor, false)
  assert.match((await ana.run('status')).out, /Shape: v2 awaiting approval \(v1\.1 approved\)/)

  // Not approved, so there's nothing to amend.
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Anyone keeping a reading list.', 'Anyone who keeps a reading list.'))
  await settle(ana, 'shape')
  const early = await ana.run('amend', 'shape', '--reason', 'Wording')
  assert.equal(early.code, 2)
  assert.match(early.err, /isn't approved, so there is nothing to amend/)

  const approveV2 = await developer(world, 'ben', { isTTY: true, answer: 'YES' }).run('approve', 'shape', 'v2')
  assert.equal(approveV2.code, 0, approveV2.err)
  assert.match((await ana.run('status')).out, /Shape: v2 approved/)
})

test('a minor amendment of an older approval doesn\'t carry past a material version', () => {
  const at = (s) => `2026-11-10T00:00:${String(s).padStart(2, '0')}Z`
  const cp = (id, version, extra = {}) => ({ type: 'checkpoint', step: 'shape', version, hash: `h${id}`, author: 'ana', comment: { id, login: 'foreman[bot]', type: 'Bot', createdAt: at(id) }, ...extra })
  const ap = (id, version, checkpoint) => ({ type: 'approval', step: 'shape', version, checkpoint, hash: `h${checkpoint}`, approver: 'ben', comment: { id, login: 'ben', type: 'User', createdAt: at(id) } })
  const records = [ cp(1, 'v1'), ap(2, 'v1', 1), cp(3, 'v1.1', { minor: true, carries: 'v1' }), cp(4, 'v2'), cp(5, 'v1.2', { minor: true, carries: 'v1' }) ]
  const state = stepState(records, 'shape')
  assert.equal(state.approvedCheckpoint.version, 'v1.1')
  assert.equal(state.latest.version, 'v1.2')
  // A minor that claims to carry another approval doesn't carry this one.
  const forged = stepState([ cp(1, 'v1'), ap(2, 'v1', 1), cp(3, 'v1.1', { minor: true, carries: 'v7' }) ], 'shape')
  assert.equal(forged.approvedCheckpoint.version, 'v1')
})

test('structural blocks ignore wording and whitespace but not criteria, contracts, behaviors or slice ownership', () => {
  const base = structuralBlocks(parseDraft(DESIGN))
  assert.equal(structuralBlocks(parseDraft(DESIGN.replace('Keep state in reading-list.ts.', 'Keep all state in reading-list.ts.'))), base)
  assert.notEqual(structuralBlocks(parseDraft(DESIGN.replace('"item-toggle"', '"item-check"'))), base)
  assert.equal(structuralBlocks(parseDraft(SHAPE.replace('A book can be marked read', 'A book  can be marked read'))), structuralBlocks(parseDraft(SHAPE)))
  assert.notEqual(structuralBlocks(parseDraft(SHAPE.replace('| A book can be marked read | yes |', '| A book can be marked read | no |'))), structuralBlocks(parseDraft(SHAPE)))
})

test('notes: keep, edit and drop extracted entries; checkpoint waits for them; only confirmed ones are posted', async () => {
  const { world, ana } = setup()
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await settle(ana, 'shape')
  const transcript = join(ana.cwd, 'session.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Let us drop syncing and keep sharing for later.' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [ { type: 'text', text: 'Agreed: syncing is out.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } } ] } }),
    '',
  ].join('\n'))
  const extracted = [ { kind: 'decision', text: 'Syncing is out of scope', step: 'shape' }, { kind: 'rejected', text: 'Sharing lists', step: 'shape' }, { kind: 'question', text: 'Do we need export?', step: null, blocking: true } ]
  const capturer = developer(world, 'ana', { exec: () => ({ code: 0, stdout: JSON.stringify(extracted), stderr: '' }) })
  // Same clone, so the same log.
  capturer.cwd = ana.cwd
  const hooked = await main([ 'note', '--extract', '--transcript', transcript, '--session', 's1', '--event', 'SessionEnd' ], () => ({ ...ctxFrom(ana, capturer) }))
  assert.equal(hooked.code, 0, hooked.err)
  const log = readLog(ana.dir())
  assert.equal(log.length, 3)
  assert.ok(log.every((e) => e.source === 'extracted' && e.confirmed === false && /^[0-9a-f]{8}$/.test(e.id)))

  const draft = await ana.run('draft', 'shape')
  assert.match(draft.out, /unconfirmed: note --keep, --edit or --drop\] [0-9a-f]{8}: Syncing is out of scope/)
  const waiting = await ana.run('checkpoint', 'shape')
  assert.equal(waiting.code, 2)
  assert.match(waiting.err, /3 extracted note\(s\) since the start aren't confirmed/)

  const [ syncing, sharing, exportQ ] = log
  assert.equal((await ana.run('note', '--keep', syncing.id)).code, 0)
  assert.equal((await ana.run('note', '--edit', sharing.id, 'Sharing lists is for later')).code, 0)
  assert.equal((await ana.run('note', '--drop', exportQ.id)).code, 0)
  assert.equal((await ana.run('note', '--keep', exportQ.id)).code, 2, 'a dropped note can\'t be kept')
  assert.equal((await ana.run('note', '--keep', 'nope')).code, 2)

  const posted = await ana.run('checkpoint', 'shape')
  assert.equal(posted.code, 0, posted.err)
  const body = world.issues.get(7).body
  assert.match(body, /Syncing is out of scope/)
  assert.match(body, /Rejected: Sharing lists is for later/)
  assert.doesNotMatch(body, /export/)
})

test('capture: reads only what is new, waits on Stop for enough text, and never fails a session', async () => {
  const world = fakeGitHub()
  world.addIssue(7, '')
  let replies = 0
  const dev = developer(world, 'ana', { exec: () => { replies++; return { code: 0, stdout: `[{"kind":"decision","text":"Decision ${replies}"}]`, stderr: '' } }, config: { capture: { claude: [ 'claude', '-p' ], codex: [ 'codex', 'exec' ], minChars: 1000 } } })
  const transcript = join(dev.cwd, 't.jsonl')
  const line = (text) => `${JSON.stringify({ message: { role: 'user', content: text } })}\n`
  writeFileSync(transcript, line('We chose the checkbox.'))
  const run = (...extra) => dev.run('note', '--extract', '--transcript', transcript, '--session', 's1', ...extra)

  // Stop with little new text waits.
  assert.equal((await run('--event', 'Stop')).code, 0)
  assert.equal(replies, 0)
  // SessionEnd reads it.
  assert.equal((await run('--event', 'SessionEnd')).code, 0)
  assert.equal(replies, 1)
  assert.match(dev.calls[0].opts.input, /user:\nWe chose the checkbox\./)
  assert.deepEqual(dev.calls[0].argv, [ 'claude', '-p' ])
  assert.equal(dev.calls[0].opts.env.FACTORY_FOREMAN_CAPTURE, '1')
  // Nothing new: no model call.
  assert.equal((await run('--event', 'SessionEnd')).code, 0)
  assert.equal(replies, 1)
  // Only the new part is sent.
  writeFileSync(transcript, readFileSync(transcript, 'utf8') + line('And the filter select.'))
  await run('--event', 'PreCompact')
  assert.doesNotMatch(dev.calls.at(-1).opts.input, /checkbox/)
  assert.match(dev.calls.at(-1).opts.input, /filter select/)

  // A failing model, a missing transcript, a nested capture: exit 0.
  const failing = developer(world, 'ana', { exec: () => ({ code: 1, stdout: '', stderr: 'no auth' }) })
  writeFileSync(join(failing.cwd, 't.jsonl'), line('x'))
  const failed = await failing.run('note', '--extract', '--transcript', join(failing.cwd, 't.jsonl'), '--event', 'SessionEnd')
  assert.equal(failed.code, 0)
  assert.match(failed.err, /capture: claude exited with code 1: no auth/)
  assert.equal((await failing.run('note', '--extract', '--transcript', '/nope.jsonl')).code, 0)
  const nested = developer(world, 'ana', { env: { FACTORY_FOREMAN_CAPTURE: '1' } })
  assert.equal((await nested.run('note', '--extract', '--transcript', transcript, '--event', 'SessionEnd')).code, 0)
  assert.equal(nested.calls.length, 0)
})

test('capture with no issue for the branch exits 0 quietly', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ff-noissue-'))
  writeFileSync(join(cwd, 't.jsonl'), '{"message":{"role":"user","content":"hi"}}\n')
  const ctx = () => ({ cwd, env: {}, harness: 'terminal', now: () => new Date(), config: () => DEFAULTS, issue: () => { throw new Error('no issue') }, stateDir: () => { throw new Error('unreachable') }, exec: async () => assert.fail('no model call') })
  const out = await main([ 'note', '--extract', '--transcript', join(cwd, 't.jsonl'), '--event', 'SessionEnd' ], ctx)
  assert.deepEqual([ out.code, out.out, out.err ], [ 0, '', undefined ])
})

test('transcripts: text from users and assistants, not tools or system lines', () => {
  const chunk = [
    JSON.stringify({ message: { role: 'system', content: 'secret setup' } }),
    JSON.stringify({ message: { role: 'user', content: [ { type: 'text', text: 'Use a select.' }, { type: 'tool_result', content: 'big output' } ] } }),
    JSON.stringify({ type: 'response_item', payload: { role: 'assistant', content: [ { type: 'output_text', text: 'OK, a select.' } ] } }),
    '{"partial',
  ].join('\n')
  const text = transcriptText(chunk)
  assert.match(text, /user:\nUse a select\./)
  assert.match(text, /assistant:\nOK, a select\./)
  assert.doesNotMatch(text, /secret|big output/)
  assert.deepEqual(parseExtracted('[{"kind":"question","text":" Export? ","blocking":true,"step":"x"},{"kind":"nope","text":"y"}]'), [ { kind: 'question', text: 'Export?', step: null, blocking: true } ])
})

test('status lists open blocking questions and slices', async () => {
  const { ana } = setup()
  assert.equal((await ana.run('note', 'Do we need export?', '--kind', 'question', '--blocking', '--step', 'shape')).code, 0)
  const out = await ana.run('status', '--json')
  assert.equal(out.code, 0, out.err)
  const json = JSON.parse(out.out)
  assert.deepEqual(json.steps.shape, { latest: null, approved: null, latestApproved: false })
  assert.deepEqual(json.questions.map((q) => q.text), [ 'Do we need export?' ])
  assert.deepEqual(json.slices, [])
  assert.match((await ana.run('status')).out, /Open blocking questions \(1\):\n- Do we need export\? \(shape\)\nSlices: none yet/)
})

test('parseRecords keeps the bot type so the bare slug can be checked', () => {
  const at = '2026-11-10T00:00:00Z'
  const [ r ] = parseRecords([ { id: 1, login: 'foreman', type: 'Bot', body: '<!-- factory-foreman:record {"type":"checkpoint"} -->', createdAt: at, updatedAt: at } ])
  assert.equal(r.comment.type, 'Bot')
})

// Rebuilds a context for the shared clone with another exec, for the capture test.
function ctxFrom(owner, capturer) {
  const cwd = owner.cwd
  return {
    cwd,
    env: {},
    harness: 'claude-code',
    isTTY: false,
    now: () => new Date('2026-11-10T11:00:00Z'),
    config: () => ({ ...structuredClone(DEFAULTS), ...REVIEWED }),
    issue: () => 7,
    stateDir: () => stateDir(cwd, 7),
    draftPath: (step) => worktreeDraftPath(cwd, 7, step),
    author: () => 'ana',
    github: () => null,
    exec: async (argv, opts) => { capturer.calls.push({ argv, opts }); return { code: 0, stdout: JSON.stringify([ { kind: 'decision', text: 'Syncing is out of scope', step: 'shape' }, { kind: 'rejected', text: 'Sharing lists', step: 'shape' }, { kind: 'question', text: 'Do we need export?', step: null, blocking: true } ]), stderr: '' } },
  }
}

test('the capture hook never fails, even on bad input', () => {
  const hook = new URL('../apm/guard/capture-hook.mjs', import.meta.url).pathname
  for (const input of [ '', 'not json', '{}', '{"transcript_path":"/nope","cwd":"/definitely/not/here"}' ]) {
    execFileSync(process.execPath, [ hook ], { input, env: { ...process.env, FACTORY_FOREMAN_CAPTURE: '' } })
  }
  assert.ok(existsSync(hook))
})

test('config: review and capture commands default sensibly and are validated', async () => {
  const { validate } = await import('../src/config/validate.mjs')
  const schema = JSON.parse(readFileSync(new URL('../factory-foreman.config.schema.json', import.meta.url), 'utf8'))
  assert.deepEqual(DEFAULTS.review.headless.command, [ 'codex', 'exec', '-' ])
  assert.deepEqual(DEFAULTS.capture.claude, [ 'claude', '-p', '--model', 'haiku' ])
  assert.deepEqual(validate(schema, structuredClone(DEFAULTS)), [])
  assert.deepEqual(validate(schema, { version: 1, review: { headless: { command: [ 'my-runner', '--json' ] } }, capture: { minChars: 0 } }), [])
  assert.notDeepEqual(validate(schema, { version: 1, review: { headless: { command: [] } } }), [])
  assert.notDeepEqual(validate(schema, { version: 1, review: { headless: {} } }), [])
  assert.notDeepEqual(validate(schema, { version: 1, capture: { minChars: -1 } }), [])
  assert.notDeepEqual(validate(schema, { version: 1, capture: { other: [ 'x' ] } }), [])
})

test('an escaped pipe stays inside its cell, so the criterion and visual flag read as GitHub shows them', () => {
  const draft = parseDraft(SHAPE.replace('| A book can be marked read | yes |', '| A book can be marked read in under 5 s \\| ms | yes |'))
  assert.deepEqual(draft.criteria[0], { id: 'AC-1', criterion: 'A book can be marked read in under 5 s | ms', visual: true })
  const changed = parseDraft(SHAPE.replace('| A book can be marked read | yes |', '| A book can be marked read in under 50 s \\| ms | yes |'))
  assert.notEqual(structuralBlocks(changed), structuralBlocks(draft))
})

test('structural blocks cover slice ownership and visual behaviors', () => {
  const base = structuralBlocks(parseDraft(DESIGN))
  const design = parseDraft(DESIGN)
  assert.ok(design.slices.length && design.visualBehaviors.length, 'the fixture has slices and visual behaviors')
  const firstSlice = DESIGN.match(/^1\. .*$/m)[0]
  assert.notEqual(structuralBlocks(parseDraft(DESIGN.replace(firstSlice, firstSlice.replace(/\(([^)]*)\)/, '(AC-9)')))), base, 'a slice owning other criteria')
  assert.equal(structuralBlocks(parseDraft(DESIGN.replace(firstSlice, firstSlice.replace(/^1\. [^(]*/, '1. Renamed slice ')))), base, 'a slice title is wording')
  const behavior = DESIGN.match(/^- AC-\d+: .*$/m)[0]
  assert.notEqual(structuralBlocks(parseDraft(DESIGN.replace(behavior, `${behavior} And it flashes.`))), base, 'a changed visual behavior')
})

test('a second minor amendment after a second approval is v2.1', async () => {
  const { world, ana } = await approvedShape()
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('| The list can show only unread books | no |', '| The list can show only unread books, oldest first | no |'))
  await settle(ana, 'shape')
  assert.equal(JSON.parse((await ana.run('checkpoint', 'shape', '--json')).out).version, 'v2')
  assert.equal((await developer(world, 'ben', { isTTY: true, answer: 'YES' }).run('approve', 'shape', 'v2')).code, 0)
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('| The list can show only unread books | no |', '| The list can show only unread books, oldest first | no |').replace('Anyone keeping a reading list.', 'Anyone who keeps a reading list.'))
  await settle(ana, 'shape')
  const minor = JSON.parse((await ana.run('amend', 'shape', '--reason', 'Wording', '--json')).out)
  assert.deepEqual([ minor.version, minor.minor, minor.carries ], [ 'v2.1', true, 'v2' ])
})

test('an approval of a minor label never counts, so it can\'t break the carry', () => {
  const at = (s) => `2026-11-10T00:00:${String(s).padStart(2, '0')}Z`
  const cp = (id, version, extra = {}) => ({ type: 'checkpoint', step: 'shape', version, hash: `h${id}`, author: 'ana', comment: { id, login: 'foreman[bot]', type: 'Bot', createdAt: at(id) }, ...extra })
  const ap = (id, version, checkpoint) => ({ type: 'approval', step: 'shape', version, checkpoint, hash: `h${checkpoint}`, approver: 'ben', comment: { id, login: 'ben', type: 'User', createdAt: at(id) } })
  const state = stepState([ cp(1, 'v1'), ap(2, 'v1', 1), cp(3, 'v1.1', { minor: true, carries: 'v1' }), ap(4, 'v1.1', 3), cp(5, 'v1.2', { minor: true, carries: 'v1' }) ], 'shape')
  assert.equal(state.approved.version, 'v1')
  assert.equal(state.approvedCheckpoint.version, 'v1.2')
})

test('a saved review missing a reviewer, or damaged, is refused', async () => {
  const { ana } = setup()
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await settle(ana, 'shape')
  const [ file ] = readdirSync(join(ana.dir(), 'reviews'))
  writeFileSync(join(ana.dir(), 'reviews', file), JSON.stringify({ reviewers: {} }))
  const missing = await ana.run('checkpoint', 'shape')
  assert.equal(missing.code, 2)
  assert.match(missing.err, /no findings from test-verification-engineer/)
  writeFileSync(join(ana.dir(), 'reviews', file), '{ not json')
  const damaged = await ana.run('checkpoint', 'shape')
  assert.equal(damaged.code, 2)
  assert.match(damaged.err, /is damaged/)
})

test('status leaves out unconfirmed and dropped blocking questions', async () => {
  const { ana } = setup()
  const { appendLog } = await import('../src/state/local.mjs')
  appendLog(ana.dir(), { id: 'aaaa0001', at: '2026-11-10T12:00:00Z', kind: 'question', text: 'Unconfirmed?', blocking: true, confirmed: false, source: 'extracted' })
  appendLog(ana.dir(), { id: 'aaaa0002', at: '2026-11-10T12:00:00Z', kind: 'question', text: 'Dropped?', blocking: true, confirmed: false, source: 'extracted' })
  appendLog(ana.dir(), { op: 'drop', id: 'aaaa0002' })
  assert.deepEqual(JSON.parse((await ana.run('status', '--json')).out).questions, [])
  appendLog(ana.dir(), { op: 'keep', id: 'aaaa0001' })
  assert.deepEqual(JSON.parse((await ana.run('status', '--json')).out).questions.map((q) => q.text), [ 'Unconfirmed?' ])
})

test('capture: one run per session at a time, and a new transcript file starts over', async () => {
  const world = fakeGitHub()
  world.addIssue(7, '')
  const dev = developer(world, 'ana', { exec: () => ({ code: 0, stdout: '[]', stderr: '' }) })
  const { claimCapture } = await import('../src/state/local.mjs')
  const line = (text) => `${JSON.stringify({ message: { role: 'user', content: text } })}\n`
  const first = join(dev.cwd, 'a.jsonl')
  writeFileSync(first, line('First file, first line.'))
  const release = claimCapture(dev.dir(), 's1')
  const busy = await dev.run('note', '--extract', '--transcript', first, '--session', 's1', '--event', 'SessionEnd', '--json')
  assert.equal(busy.code, 0)
  assert.match(JSON.parse(busy.out).skipped, /another capture/)
  assert.equal(dev.calls.length, 0)
  release()
  await dev.run('note', '--extract', '--transcript', first, '--session', 's1', '--event', 'SessionEnd')
  assert.equal(dev.calls.length, 1)
  const second = join(dev.cwd, 'b.jsonl')
  writeFileSync(second, line('Second file.') + line('More.'))
  await dev.run('note', '--extract', '--transcript', second, '--session', 's1', '--event', 'SessionEnd')
  assert.match(dev.calls.at(-1).opts.input, /Second file\./)
})

test('exec survives a child that exits before reading its input, and stops a slow one', async () => {
  const { context } = await import('../src/cli.mjs')
  const ctx = context({ cwd: process.cwd() })
  const early = await ctx.exec([ process.execPath, '-e', 'process.exit(3)' ], { input: 'x'.repeat(2_000_000) })
  assert.equal(early.code, 3)
  const slow = await ctx.exec([ process.execPath, '-e', 'setTimeout(() => {}, 5000)' ], { timeout: 200 })
  assert.notEqual(slow.code, 0)
  assert.match(slow.stderr, /stopped after 0\.2 s/)
})

test('a capture claim is released only by its owner', async () => {
  const { claimCapture } = await import('../src/state/local.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'ff-claim-'))
  const first = claimCapture(dir, 's')
  assert.ok(first)
  assert.equal(claimCapture(dir, 's'), null, 'held')
  // Eleven minutes later the claim is stale and taken over.
  const second = claimCapture(dir, 's', Date.now() + 11 * 60_000)
  assert.ok(second)
  first()
  assert.equal(claimCapture(dir, 's'), null, 'the old owner can\'t release the new claim')
  second()
  assert.ok(claimCapture(dir, 's'))
})

test('harness detection: the innermost harness wins when one was started from another', async () => {
  const { agentShell, detectHarness } = await import('../src/state/local.mjs')
  assert.equal(detectHarness({ CLAUDECODE: '1' }), 'claude-code')
  assert.equal(detectHarness({ CODEX_THREAD_ID: 't' }), 'codex')
  // Codex launched from a Claude Code shell: Codex's own shell call is innermost.
  assert.equal(detectHarness({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CODEX_THREAD_ID: 't', CODEX_TOOL_CALL_ID: 'c' }), 'codex')
  assert.equal(agentShell({ env: { CLAUDECODE: '1', CODEX_TOOL_CALL_ID: 'c' }, isTTY: true }), 'this is Codex\'s shell')
  assert.equal(detectHarness({ TERM_PROGRAM: 'vscode' }), 'vscode')
  // Each Codex runtime variable alone still refuses; a person's CODEX_HOME doesn't.
  for (const k of [ 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_CI', 'CODEX_TOOL_CALL_ID' ]) assert.ok(agentShell({ env: { [k]: '' }, isTTY: true }), k)
  assert.equal(agentShell({ env: { CODEX_HOME: '/x' }, isTTY: true }), null)
  assert.equal(detectHarness({ CODEX_HOME: '/x' }), 'terminal')
  assert.equal(agentShell({ env: {}, isTTY: true }), null)
  assert.equal(detectHarness({}), 'terminal')
})

test('drafts live in the working tree under .factory-foreman, excluded from git', async () => {
  const { worktreeDraftPath } = await import('../src/state/local.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'ff-draftdir-'))
  execFileSync('git', [ 'init', '-q' ], { cwd })
  const sub = join(cwd, 'src')
  execFileSync('mkdir', [ '-p', sub ])
  const file = worktreeDraftPath(sub, 7, 'shape')
  assert.equal(file, join(execFileSync('git', [ 'rev-parse', '--show-toplevel' ], { cwd, encoding: 'utf8' }).trim(), '.factory-foreman', '7', 'shape.md'))
  writeFileSync(file, 'draft')
  worktreeDraftPath(cwd, 7, 'design')
  const exclude = readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8')
  assert.equal(exclude.split('\n').filter((l) => l === '/.factory-foreman/').length, 1, 'added once')
  assert.equal(execFileSync('git', [ 'status', '--porcelain', '--untracked-files=all' ], { cwd, encoding: 'utf8' }), '', 'never shows as a change')
  // A linked worktree gets its own drafts, excluded through the shared exclude file.
  execFileSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init' ], { cwd })
  const linked = join(cwd, '..', `${cwd.split('/').pop()}-wt`)
  execFileSync('git', [ 'worktree', 'add', '-q', linked ], { cwd })
  writeFileSync(worktreeDraftPath(linked, 7, 'shape'), 'linked draft')
  assert.equal(execFileSync('git', [ 'status', '--porcelain', '--untracked-files=all' ], { cwd: linked, encoding: 'utf8' }), '')
  // A draft from before drafts moved out of .git is moved over.
  const { gitCommonDir } = await import('../src/state/local.mjs')
  const old = join(gitCommonDir(cwd), 'factory-foreman', '8', 'drafts')
  execFileSync('mkdir', [ '-p', old ])
  writeFileSync(join(old, 'design.md'), 'old draft')
  assert.equal(readFileSync(worktreeDraftPath(cwd, 8, 'design'), 'utf8'), 'old draft')
  assert.ok(!existsSync(join(old, 'design.md')))
})
