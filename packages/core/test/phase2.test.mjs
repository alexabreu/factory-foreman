// Phase 2: reviews that must be settled before a checkpoint, amendments that
// keep or need approval, status, and notes captured from transcripts.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { main } from '../src/cli.mjs'
import { CONFIG_FILE, DEFAULTS, loadConfig } from '../src/config/load.mjs'
import { isBotLogin, nextMinor, nextVersion, parseLabel, parseRecords, stepState, trustedRecords } from '../src/issue/records.mjs'
import { checkSettlements, parseFindings, reviewersFor, secondOpinionCommand } from '../src/review/briefs.mjs'
import { parseExtracted, transcriptText } from '../src/capture/extract.mjs'
import { detectHarness, readLog, stateDir, worktreeDraftPath } from '../src/state/local.mjs'
import { parseDraft, structuralBlocks } from '../src/steps/structure.mjs'
import { fakeGitHub } from './fixtures/github.mjs'
import { DESIGN, SHAPE, WIREFRAME_COMMIT, WIREFRAME_PNG } from './structure.test.mjs'

const REVIEWED = { reviewers: { shape: [ 'test-verification-engineer' ], design: [ 'software-architect', 'ux-designer?visual' ] }, secondOpinion: null }

function developer(world, login, { env = {}, isTTY = false, answer = '', config = {}, exec = null } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ff-p2-'))
  execFileSync('git', [ 'init', '-q' ], { cwd })
  let minute = 0
  const calls = []
  const dev = { cwd, calls, browser: null, world }
  // git runs for real; any other command is stubbed.
  const git = (argv, opts) => { const r = spawnSync('git', argv.slice(1), { cwd: opts?.cwd ?? cwd, encoding: 'utf8', input: opts?.input, env: opts?.env ? { ...process.env, ...opts.env } : undefined }); return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr } }
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
    exec: async (argv, opts) => { if (argv[0] === 'git') return git(argv, opts); calls.push({ argv, opts }); const stub = dev.exec ?? exec; return stub ? stub(argv, opts) : { code: 0, stdout: '[]', stderr: '' } },
    ...(dev.browser ? { browser: () => dev.browser } : {}),
  })
  return Object.assign(dev, { run: (...argv) => main(argv, ctx), draft: (step) => worktreeDraftPath(cwd, 7, step), dir: () => stateDir(cwd, 7) })
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
  world.blobs.set(`${WIREFRAME_COMMIT}:design/AC-1.png`, WIREFRAME_PNG)
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

test('second opinion: another vendor\'s model by default, Claude under Codex and Codex elsewhere', () => {
  assert.deepEqual(secondOpinionCommand(DEFAULTS, 'codex'), [ 'claude', '-p' ])
  for (const harness of [ 'claude-code', 'vscode', 'terminal' ]) assert.deepEqual(secondOpinionCommand(DEFAULTS, harness), [ 'codex', 'exec', '-' ])
  assert.deepEqual(secondOpinionCommand({ secondOpinion: { command: [ 'gemini' ], steps: [] } }, 'codex'), [ 'gemini' ])
  assert.equal(secondOpinionCommand({ secondOpinion: null }, 'codex'), null)
  const root = mkdtempSync(join(tmpdir(), 'ff-so-'))
  // One argv replaces the per-harness default; a per-harness map needs a default.
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, secondOpinion: { command: [ 'gemini', '-p' ], steps: [ 'design' ] } }))
  assert.deepEqual(secondOpinionCommand(loadConfig(root), 'codex'), [ 'gemini', '-p' ])
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, secondOpinion: { command: { 'claude-code': [ 'gemini' ], default: [ 'codex', 'exec', '-' ] }, steps: [ 'design' ] } }))
  assert.deepEqual(secondOpinionCommand(loadConfig(root), 'claude-code'), [ 'gemini' ])
  // A map replaces the default map whole: no default codex entry survives.
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, secondOpinion: { command: { default: [ 'gemini', '-p' ] }, steps: [ 'design' ] } }))
  assert.deepEqual(loadConfig(root).secondOpinion.command, { default: [ 'gemini', '-p' ] })
  assert.deepEqual(secondOpinionCommand(loadConfig(root), 'codex'), [ 'gemini', '-p' ])
  for (const command of [ { codex: [ 'claude', '-p' ] }, { default: [ 'x' ], claude: [ 'y' ] }, { default: [ 'x' ], Codex: [ 'y' ] } ]) {
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 1, secondOpinion: { command, steps: [ 'design' ] } }))
    assert.throws(() => loadConfig(root), /schema/, JSON.stringify(command))
  }
  // Tied to real harness detection: Codex's shell gets Claude, Claude Code's gets Codex.
  assert.deepEqual(secondOpinionCommand(DEFAULTS, detectHarness({ CODEX_TOOL_CALL_ID: 'c1' })), [ 'claude', '-p' ])
  assert.deepEqual(secondOpinionCommand(DEFAULTS, detectHarness({ CLAUDECODE: '1' })), [ 'codex', 'exec', '-' ])
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

test('the second-opinion brief names the other vendor\'s command for the harness it runs in', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7, '')
  const config = { secondOpinion: { ...structuredClone(DEFAULTS.secondOpinion), steps: [ 'shape' ] } }
  for (const [ env, command ] of [ [ { CODEX_HOME: '/x' }, 'claude -p' ], [ { CLAUDECODE: '1' }, 'codex exec -' ] ]) {
    const ana = developer(world, 'ana', { env, config })
    await ana.run('draft', 'shape')
    writeDraft(ana.draft('shape'), SHAPE)
    const out = (await ana.run('review', 'shape')).out
    assert.ok(out.includes(`=== second-opinion (pipe this brief into: ${command}) ===`), out.split('\n').filter((l) => l.startsWith('===')).join('\n'))
  }
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
  // A changed wireframe image is material; the same image pushed in a later commit is not.
  assert.notEqual(structuralBlocks(parseDraft(DESIGN.replace(/sha256:[0-9a-f]{64}/, `sha256:${'0'.repeat(64)}`))), base)
  assert.notEqual(structuralBlocks(parseDraft(DESIGN.replace('AC-1 normal,', 'AC-1 empty,'))), base)
  assert.equal(structuralBlocks(parseDraft(DESIGN.replace('a'.repeat(40), 'b'.repeat(40)))), base)
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

test('all state lives in the working tree under .factory-foreman, which ignores itself, and nothing touches .git', async () => {
  const { stateDir, worktreeDraftPath, appendLog, readLog } = await import('../src/state/local.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'ff-state-'))
  execFileSync('git', [ 'init', '-q' ], { cwd })
  const before = execFileSync('find', [ join(cwd, '.git') ], { encoding: 'utf8' })
  const sub = join(cwd, 'src')
  execFileSync('mkdir', [ '-p', sub ])
  const root = execFileSync('git', [ 'rev-parse', '--show-toplevel' ], { cwd, encoding: 'utf8' }).trim()
  assert.equal(stateDir(sub, 7), join(root, '.factory-foreman', '7'))
  assert.equal(worktreeDraftPath(cwd, 7, 'shape'), join(root, '.factory-foreman', '7', 'shape.md'))
  writeFileSync(worktreeDraftPath(cwd, 7, 'shape'), 'draft')
  appendLog(stateDir(cwd, 7), { id: 'a1', kind: 'decision', text: 'x' })
  assert.equal(execFileSync('git', [ 'status', '--porcelain', '--untracked-files=all' ], { cwd, encoding: 'utf8' }), '', 'never shows as a change')
  assert.equal(execFileSync('find', [ join(cwd, '.git') ], { encoding: 'utf8' }), before, 'nothing written under .git')
  // A linked worktree has its own state, ignored the same way.
  execFileSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init' ], { cwd })
  const linked = join(cwd, '..', `${cwd.split('/').pop()}-wt`)
  execFileSync('git', [ 'worktree', 'add', '-q', linked ], { cwd })
  assert.deepEqual(readLog(stateDir(linked, 7)), [])
  writeFileSync(worktreeDraftPath(linked, 7, 'shape'), 'linked draft')
  assert.equal(execFileSync('git', [ 'status', '--porcelain', '--untracked-files=all' ], { cwd: linked, encoding: 'utf8' }), '')
})

test('state left in .git by an older version is copied over once, reading .git only', async () => {
  const { stateDir, readLog } = await import('../src/state/local.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'ff-migrate-'))
  execFileSync('git', [ 'init', '-q' ], { cwd })
  const old = join(cwd, '.git', 'factory-foreman', '8')
  execFileSync('mkdir', [ '-p', join(old, 'drafts'), join(old, 'reviews') ])
  writeFileSync(join(old, 'log.jsonl'), '{"id":"o1","kind":"decision","text":"old note"}\n')
  writeFileSync(join(old, 'drafts', 'design.md'), 'old draft')
  writeFileSync(join(old, 'reviews', 'design-abc.json'), '{}')
  execFileSync('chmod', [ '-R', 'a-w', join(cwd, '.git', 'factory-foreman') ])
  const dir = stateDir(cwd, 8)
  assert.deepEqual(readLog(dir).map((e) => e.text), [ 'old note' ])
  assert.equal(readFileSync(join(dir, 'design.md'), 'utf8'), 'old draft')
  assert.ok(existsSync(join(dir, 'reviews', 'design-abc.json')))
  // Odd old layouts are skipped, never block: a directory where a file was, a lock.
  const odd = mkdtempSync(join(tmpdir(), 'ff-migrate-odd-'))
  execFileSync('git', [ 'init', '-q' ], { cwd: odd })
  const oldOdd = join(odd, '.git', 'factory-foreman', '9')
  execFileSync('mkdir', [ '-p', join(oldOdd, 'log.jsonl'), join(oldOdd, 'drafts', 'shape.md'), join(oldOdd, 'capture') ])
  writeFileSync(join(oldOdd, 'capture', 's.lock'), 'stale')
  writeFileSync(join(oldOdd, 'capture', 's.json'), '{"offset":3}')
  const oddDir = stateDir(odd, 9)
  assert.deepEqual(readLog(oddDir), [])
  assert.ok(!existsSync(join(oddDir, 'shape.md')))
  assert.ok(!existsSync(join(oddDir, 'capture', 's.lock')), 'a stale lock is not carried over')
  assert.ok(existsSync(join(oddDir, 'capture', 's.json')))
  // Once only: a later edit of the old log isn't copied again.
  execFileSync('chmod', [ '-R', 'u+w', join(cwd, '.git', 'factory-foreman') ])
  writeFileSync(join(old, 'log.jsonl'), '{"id":"o2","kind":"decision","text":"later"}\n')
  assert.deepEqual(readLog(stateDir(cwd, 8)).map((e) => e.text), [ 'old note' ])
})

test('review --headless refuses inside Codex\'s sandbox and points to subagents', async () => {
  const world = fakeGitHub()
  world.addIssue(7, '')
  const dev = developer(world, 'ana', { env: { CODEX_SANDBOX: 'seatbelt' } })
  await dev.run('draft', 'shape')
  writeDraft(dev.draft('shape'), SHAPE)
  const out = await dev.run('review', 'shape', '--headless')
  assert.equal(out.code, 2)
  assert.match(out.err, /doesn't run inside Codex[\s\S]*run each as a subagent by its agent name \(test-verification-engineer\)/)
  assert.equal(dev.calls.length, 0)
  assert.match((await dev.run('review', 'shape')).out, /=== test-verification-engineer \(run as a subagent: the test-verification-engineer agent\) ===/)
})

// A repo with a bare origin, and a browser that writes a PNG per page.
function withOrigin(dev) {
  const remote = mkdtempSync(join(tmpdir(), 'ff-origin-'))
  execFileSync('git', [ 'init', '-q', '--bare' ], { cwd: remote })
  const g = (...a) => execFileSync('git', a, { cwd: dev.cwd, encoding: 'utf8' }).trim()
  g('config', 'user.name', 'Ana'); g('config', 'user.email', 'ana@example.com')
  g('commit', '-q', '--allow-empty', '-m', 'start')
  g('checkout', '-q', '-b', 'factory-foreman/7')
  // origin names the GitHub repo; insteadOf sends it to the bare repo standing in for GitHub.
  g('remote', 'add', 'origin', 'https://github.com/owner/sandbox.git')
  g('config', `url.${remote}.insteadOf`, 'https://github.com/owner/sandbox.git')
  dev.world.gitDir = remote
  const rendered = []
  dev.browser = { render: async (html, png) => { rendered.push(html); writeFileSync(png, `PNG of ${readFileSync(html, 'utf8')}`) }, close: async () => { dev.closed = true } }
  const pages = join(dev.dir(), 'wireframes')
  mkdirSync(pages, { recursive: true })
  const origin = (...a) => execFileSync('git', a, { cwd: remote, encoding: 'utf8' }).trim()
  return { remote, origin, g, rendered, pages }
}
const PAGE = (label) => `<!doctype html><title>${label}</title><main style="font:16px sans-serif"><label><input type="checkbox"> ${label}</label></main>`

test('wireframes design renders each page and pushes it to an assets-only branch, leaving the checkout untouched', async () => {
  const { ana } = await approvedShape()
  const { origin, g, rendered, pages } = withOrigin(ana)
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN.replace(/\n## Wireframes[\s\S]*$/, '\n'))
  writeFileSync(join(pages, 'AC-1.html'), PAGE('Mark read'))
  writeFileSync(join(pages, 'AC-1-empty.html'), PAGE('No books yet'))
  // Work in progress, staged and unstaged, on the issue branch.
  writeFileSync(join(ana.cwd, 'staged.txt'), 'x'); g('add', 'staged.txt')
  writeFileSync(join(ana.cwd, 'loose.txt'), 'y')
  const before = { head: g('rev-parse', 'HEAD'), branch: g('branch', '--show-current'), status: g('status', '--porcelain'), index: g('ls-files', '--stage'), branches: g('branch', '--list'), objects: g('count-objects') }
  const out = await ana.run('wireframes', 'design', '--json')
  assert.equal(out.code, 0, out.err)
  const result = JSON.parse(out.out)
  assert.equal(result.branch, 'factory-foreman-assets/7')
  assert.deepEqual(result.files.map((f) => `${f.id} ${f.state}`), [ 'AC-1 normal', 'AC-1 empty' ])
  assert.equal(rendered.length, 2)
  assert.ok(ana.closed)
  // Nothing was written to the target's .git: the assets repo is in the ignored state folder.
  assert.equal(g('count-objects'), before.objects)
  assert.ok(existsSync(join(ana.cwd, '.factory-foreman', 'assets.git', 'HEAD')))
  delete before.objects
  // The checkout is exactly as it was: same commit, branch, index, files and local branches.
  assert.deepEqual({ head: g('rev-parse', 'HEAD'), branch: g('branch', '--show-current'), status: g('status', '--porcelain'), index: g('ls-files', '--stage'), branches: g('branch', '--list') }, before)
  // The assets commit holds only the pages and images, by the developer, with no parent.
  assert.equal(origin('rev-parse', 'refs/heads/factory-foreman-assets/7'), result.commit)
  assert.equal(origin('ls-tree', '-r', '--name-only', result.commit), 'design/AC-1-empty.html\ndesign/AC-1-empty.png\ndesign/AC-1.html\ndesign/AC-1.png')
  assert.equal(origin('log', '-1', '--format=%an %s %P', result.commit), 'Ana Wireframes for the Design of #7')
  assert.equal(origin('show', `${result.commit}:design/AC-1.html`), PAGE('Mark read'))
  assert.throws(() => origin('rev-parse', '--verify', 'refs/heads/factory-foreman/7'))
  // The draft links each image at that commit.
  const draft = parseDraft(readFileSync(ana.draft('design'), 'utf8'))
  assert.deepEqual(draft.wireframes.map((w) => [ w.id, w.state, w.commit, w.path ]), [ [ 'AC-1', 'normal', result.commit, 'design/AC-1.png' ], [ 'AC-1', 'empty', result.commit, 'design/AC-1-empty.png' ] ])
  assert.match(readFileSync(ana.draft('design'), 'utf8'), /https:\/\/github\.com\/owner\/sandbox\/blob\/[0-9a-f]{40}\/design\/AC-1\.png\?raw=true/)
  // Nothing changed: the same commit, and still one section.
  const again = JSON.parse((await ana.run('wireframes', 'design', '--json')).out)
  assert.equal(again.commit, result.commit)
  assert.equal(readFileSync(ana.draft('design'), 'utf8').match(/^## Wireframes$/gm).length, 1)
  // A changed page and a dropped one: a new commit on top, without the dropped files.
  writeFileSync(join(pages, 'AC-1.html'), PAGE('Mark as read'))
  execFileSync('rm', [ join(pages, 'AC-1-empty.html') ])
  const third = JSON.parse((await ana.run('wireframes', 'design', '--json')).out)
  assert.notEqual(third.commit, result.commit)
  assert.equal(origin('log', '-1', '--format=%P', third.commit), result.commit)
  assert.equal(origin('ls-tree', '-r', '--name-only', third.commit), 'design/AC-1.html\ndesign/AC-1.png')
  assert.notEqual(third.files[0].hash, result.files[0].hash)
  // Checkpoint reads each pinned image back from GitHub and checks its hash.
  await settle(ana, 'design', { 'software-architect': [], 'ux-designer': [] })
  const posted = await ana.run('checkpoint', 'design')
  assert.equal(posted.code, 0, posted.err)
  // The ux-designer's brief points at the images in the state folder; the architect's doesn't.
  const briefs = JSON.parse((await ana.run('review', 'design', '--json')).out).briefs
  const ux = briefs.find((b) => b.reviewer === 'ux-designer').brief
  assert.ok(ux.includes(`- AC-1 normal: ${join(pages, 'AC-1.png')}`), ux.slice(-600))
  assert.match(ux, /Open and look at each wireframe image/)
  assert.doesNotMatch(briefs.find((b) => b.reviewer === 'software-architect').brief, /wireframe image/)
})

test('wireframes design refuses a missing or unknown AC, a bad name or a page that loads from elsewhere', async () => {
  const { ana } = await approvedShape()
  await ana.run('draft', 'design')
  const { origin, rendered, pages } = withOrigin(ana)
  assert.match((await ana.run('wireframes', 'design')).err, /AC-1 is visual and has no wireframe: write .*wireframes\/AC-1\.html/)
  writeFileSync(join(pages, 'AC-1.html'), PAGE('ok'))
  writeFileSync(join(pages, 'AC-9.html'), PAGE('?'))
  writeFileSync(join(pages, 'ac-1 edge.html'), PAGE('?'))
  writeFileSync(join(pages, 'AC-1-normal.html'), PAGE('?'))
  writeFileSync(join(pages, 'AC-1-font.html'), '<link rel="stylesheet" href="https://fonts.example/x.css">')
  writeFileSync(join(pages, 'AC-1-img.html'), '<img src=//cdn.example/x.png>')
  const err = (await ana.run('wireframes', 'design')).err
  for (const why of [ /AC-9\.html: the approved Shape has no AC-9/, /ac-1 edge\.html: name it AC-<n>\.html/, /AC-1-normal\.html: the normal state is AC-1\.html/, /AC-1-font\.html isn't self-contained: it has a <link>/, /AC-1-img\.html isn't self-contained: it refers to \/\/cdn/ ]) assert.match(err, why)
  assert.equal(rendered.length, 0)
  assert.equal(origin('branch', '--list'), '')
})

test('a wireframe page may refer only to itself or data: URLs', async () => {
  const { notSelfContained } = await import('../src/commands/wireframes.mjs')
  const outside = [ '<script>fetch("x")</script>', '<iframe src="../../.aws/credentials"></iframe>', '<img srcset="https://x/a.png 2x">', '<img src="https:x.example/a.png">', '<img src="/etc/hosts">', '<div style="background:url(https:x/a.png)">', '<style>@import "local.css";</style>', '<meta http-equiv=refresh content="0;url=https://x">', '<object data="x.pdf"></object>', '<video poster="x.png"></video>', '<form action="https://x">', '<a href=https://x>', "<div style='background-image: url( \"file:///etc/passwd\" )'>" ]
  for (const html of outside) assert.ok(notSelfContained(html), html)
  outside.push('<img src="data:," onerror="location=\'file:///etc/hosts\'">', '<body onload="fetch(\'https://x\')">', '<div style="background:image-set(\'https://x/a.png\' 1x)">', '<div style="background:u\\72l(https://x)">', '<style>div{background:u\\72l(https://x)}</style>', '<svg><a><animate attributeName="href" to="https://x"/></a></svg>', '<svg><set attributeName="href" to="https://x"/></svg>')
  for (const html of outside.slice(-7)) assert.ok(notSelfContained(html), html)
  const inside = [ '<meta charset="utf-8">', '<meta name="viewport" content="width=960">', '<a href="#top">Top</a>', '<img src="data:image/png;base64,AAAA" alt="">', '<p>See http://example.com in the docs</p>', '<div style="background:url(#g)">', '<label for="x">Read</label><input id="x" type="checkbox">' ]
  for (const html of inside) assert.equal(notSelfContained(html), null, html)
})

test('without agent-browser, wireframes refuses with how to install it', async () => {
  const { ana } = await approvedShape()
  await ana.run('draft', 'design')
  const { pages } = withOrigin(ana)
  ana.browser = null
  writeFileSync(join(pages, 'AC-1.html'), PAGE('ok'))
  // agent-browser isn't on PATH: spawning it fails as a missing binary does.
  ana.exec = () => ({ code: 127, stdout: '', stderr: 'spawn agent-browser ENOENT' })
  const out = await ana.run('wireframes', 'design')
  assert.equal(out.code, 2)
  assert.match(out.err, /npm install -g agent-browser, then agent-browser install/)
  assert.equal(ana.calls[0].argv[0], 'agent-browser')
})

test('checkpoint refuses a wireframe whose pinned image is missing or isn\'t the one its hash names', async () => {
  const { ana } = await approvedShape()
  const { pages } = withOrigin(ana)
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN.replace(/\n## Wireframes[\s\S]*$/, '\n'))
  writeFileSync(join(pages, 'AC-1.html'), PAGE('Mark read'))
  const { commit } = JSON.parse((await ana.run('wireframes', 'design', '--json')).out)
  const text = readFileSync(ana.draft('design'), 'utf8')
  // Another image's hash claimed for this one.
  writeFileSync(ana.draft('design'), text.replace(/sha256:[0-9a-f]{64}/, `sha256:${'0'.repeat(64)}`))
  await settle(ana, 'design', { 'software-architect': [], 'ux-designer': [] })
  assert.match((await ana.run('checkpoint', 'design')).err, /isn't the image its hash names/)
  // A commit GitHub doesn't have.
  writeFileSync(ana.draft('design'), text.replaceAll(commit, 'c'.repeat(40)))
  await settle(ana, 'design', { 'software-architect': [], 'ux-designer': [] })
  assert.match((await ana.run('checkpoint', 'design')).err, /isn't on GitHub at cccccccccccc/)
})

test('the Wireframes section is replaced in place, and headings inside code blocks are left alone', async () => {
  const { withWireframes, wireframeFiles } = await import('../src/commands/wireframes.mjs')
  const section = '## Wireframes\nnew\n'
  const middle = '---\nstep: design\n---\nLead.\n\n## Approach\n```md\n## Wireframes\nin a fence\n```\n\n## Wireframes\nold\n\n## Slices\n1. A (AC-1)\n'
  const out = withWireframes(middle, section)
  assert.match(out, /```md\n## Wireframes\nin a fence\n```/)
  assert.match(out, /## Wireframes\nnew\n\n## Slices\n1\. A \(AC-1\)\n$/)
  assert.doesNotMatch(out, /\nold\n/)
  assert.match(withWireframes('---\nstep: design\n---\nLead.\n\n## Approach\nx\n', section), /## Approach\nx\n\n## Wireframes\nnew\n$/)
  // AC order is numeric, normal state first.
  const dir = mkdtempSync(join(tmpdir(), 'ff-wf-'))
  for (const name of [ 'AC-10.html', 'AC-2-empty.html', 'AC-2.html', 'AC-1.html' ]) writeFileSync(join(dir, name), PAGE(name))
  assert.deepEqual(wireframeFiles(dir).files.map((f) => f.name), [ 'AC-1.html', 'AC-2.html', 'AC-2-empty.html', 'AC-10.html' ])
})

test('the assets repo gets the target\'s own and included git config, in the environment', async () => {
  const { carriedConfig } = await import('../src/commands/wireframes.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'ff-cfg-'))
  const g = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
  g('init', '-q')
  const assets = join(cwd, '.factory-foreman', 'assets.git')
  execFileSync('git', [ 'init', '-q', '--bare', assets ])
  writeFileSync(join(cwd, 'extra.gitconfig'), '[core]\n\tsshCommand = ssh -i ~/.ssh/work\n')
  g('config', 'include.path', join(cwd, 'extra.gitconfig'))
  g('config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic c2VjcmV0')
  g('config', 'user.name', 'not carried')
  const exec = async (argv) => { const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8' }); return { code: r.status, stdout: r.stdout, stderr: r.stderr } }
  const env = await carriedConfig({ exec }, assets)
  const pairs = Object.fromEntries(Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [ env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`] ]))
  assert.equal(pairs['core.sshcommand'], 'ssh -i ~/.ssh/work')
  assert.equal(pairs['http.https://github.com/.extraheader'], 'AUTHORIZATION: basic c2VjcmV0')
  assert.equal(pairs['user.name'], undefined)
  // Global settings both repos already see aren't carried twice.
  const both = execFileSync('git', [ '--git-dir', assets, 'config', '--null', '--get-regexp', '^credential\\..*' ], { encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const entry of both) assert.ok(!Object.entries(pairs).some(([ k, v ]) => `${k}\n${v}` === entry), entry)
})

test('only a posted version\'s wireframes commit is tagged, at checkpoint; an SSH alias origin naming the repo is accepted', async () => {
  const { ana, world } = await approvedShape()
  await ana.run('draft', 'design')
  const { origin, g, pages, remote } = withOrigin(ana)
  writeDraft(ana.draft('design'), DESIGN.replace(/\n## Wireframes[\s\S]*$/, '\n'))
  writeFileSync(join(pages, 'AC-1.html'), PAGE('draft one'))
  const first = JSON.parse((await ana.run('wireframes', 'design', '--json')).out).commit
  writeFileSync(join(pages, 'AC-1.html'), PAGE('draft two'))
  const second = JSON.parse((await ana.run('wireframes', 'design', '--json')).out).commit
  // Rendering pushes the branch and no tags.
  assert.equal(origin('tag', '--list'), '')
  await settle(ana, 'design', { 'software-architect': [], 'ux-designer': [] })
  const posted = await ana.run('checkpoint', 'design')
  assert.equal(posted.code, 0, posted.err)
  assert.equal(posted.err, undefined)
  // The posted version's commit is tagged, as the developer; the rerender before it isn't.
  assert.deepEqual([ ...world.tags ], [ [ `factory-foreman-assets/7/${second.slice(0, 12)}`, second ] ])
  assert.ok(world.log.some((e) => e.op === 'tag' && e.by === 'ana'))
  assert.ok(![ ...world.tags.values() ].includes(first))
  // One call per pinned commit, however many images it holds.
  assert.equal(world.tagCalls, 1)
  // A tag already at another commit is reported, and the version is still posted.
  world.tags.set(`factory-foreman-assets/7/${second.slice(0, 12)}`, 'f'.repeat(40))
  await ana.run('draft', 'design', '--reset')
  writeFileSync(ana.draft('design'), readFileSync(ana.draft('design'), 'utf8').replace('Keep state in reading-list.ts.', 'Keep all state in reading-list.ts.'))
  await settle(ana, 'design', { 'software-architect': [], 'ux-designer': [] })
  const again = await ana.run('checkpoint', 'design')
  assert.equal(again.code, 0, again.err)
  assert.match(again.err, /Couldn't tag the wireframes commit .* already points at ffffffffffff.*gh api -X POST repos\/owner\/sandbox\/git\/refs -f ref=refs\/tags\/factory-foreman-assets\/7\//s)
  // A multi-account SSH alias for github.com, rewritten here to the bare repo.
  g('remote', 'set-url', 'origin', 'git@github-work:owner/sandbox.git')
  g('config', `url.${remote}.insteadOf`, 'git@github-work:owner/sandbox.git')
  assert.equal((await ana.run('wireframes', 'design')).code, 0)
  g('remote', 'set-url', 'origin', 'git@github-work:someone/else.git')
  assert.match((await ana.run('wireframes', 'design')).err, /but this issue is on owner\/sandbox/)
})
