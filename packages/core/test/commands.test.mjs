// The phase 1 flow against an in-memory GitHub: two developers checkpoint
// Shape, the second is refused as stale, approval is refused from an agent's
// shell and recorded from a terminal, and the changelog carries the diff.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { main } from '../src/cli.mjs'
import { DEFAULTS } from '../src/config/load.mjs'
import { parseRecords } from '../src/issue/records.mjs'
import { getSection } from '../src/issue/sections.mjs'
import { stateDir, worktreeDraftPath } from '../src/state/local.mjs'
import { fakeGitHub } from './fixtures/github.mjs'
import { DESIGN, SHAPE } from './structure.test.mjs'

function clone() {
  const dir = mkdtempSync(join(tmpdir(), 'ff-clone-'))
  execFileSync('git', [ 'init', '-q' ], { cwd: dir })
  return dir
}

function developer(world, login, { env = {}, isTTY = false, answer = '', config = {} } = {}) {
  const cwd = clone()
  let minute = 0
  const ctxFor = () => ({
    cwd,
    env,
    harness: env.CLAUDECODE ? 'claude-code' : 'terminal',
    isTTY,
    now: () => new Date(Date.parse('2026-11-10T12:00:00Z') + (minute++) * 60_000),
    // Phase 1's flow needs no review; the review tests turn reviewers on.
    config: () => ({ ...structuredClone(DEFAULTS), reviewers: { shape: [], design: [] }, secondOpinion: null, ...config }),
    issue: () => 7,
    stateDir: () => stateDir(cwd, 7),
    draftPath: (step) => worktreeDraftPath(cwd, 7, step),
    author: () => login,
    github: () => world.as(login),
    prompt: async () => answer,
  })
  const run = (...argv) => main(argv, ctxFor)
  return { cwd, run, ctx: ctxFor, draft: (step) => worktreeDraftPath(cwd, 7, step) }
}

const ctxOf = (dev) => dev.ctx()

function writeDraft(file, body) {
  const head = readFileSync(file, 'utf8').match(/^---\n[\s\S]*?\n---\n/)[0]
  writeFileSync(file, head + body.replace(/^---\n[\s\S]*?\n---\n/, ''))
}

test('two developers, a stale refusal, approval and the changelog', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write' } })
  world.addIssue(7, 'Readers want to track what they have read.')
  const ana = developer(world, 'ana')
  const ben = developer(world, 'ben')

  // Both start from nothing.
  assert.equal((await ana.run('draft', 'shape')).code, 0)
  assert.equal((await ben.run('draft', 'shape')).code, 0)
  assert.equal((await ana.run('note', 'Syncing is out of scope', '--step', 'shape')).code, 0)

  writeDraft(ana.draft('shape'), SHAPE)
  const first = await ana.run('checkpoint', 'shape')
  assert.equal(first.code, 0, first.err)
  assert.match(first.out, /Posted Shape v1/)

  // Ben's draft started from nothing, so it's stale now.
  writeDraft(ben.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing lists.'))
  const stale = await ben.run('checkpoint', 'shape')
  assert.equal(stale.code, 2)
  assert.match(stale.err, /Stale: Shape is at version 1 .*started from version 0/)

  // He redrafts from the latest and posts v2.
  assert.equal((await ben.run('draft', 'shape', '--reset')).code, 0)
  writeDraft(ben.draft('shape'), SHAPE.replace('Syncing between devices.', 'Syncing between devices, and sharing lists.'))
  const second = await ben.run('checkpoint', 'shape')
  assert.equal(second.code, 0, second.err)
  assert.match(second.out, /Posted Shape v2/)

  const issue = world.issues.get(7)
  const changelog = issue.artifacts.find((a) => a.versions[0].name === 'Changelog').versions.at(-1).body
  assert.match(changelog, /## Shape v2, 2026-11-10\n\nBy @ben from terminal\. Changes since v1:/)
  assert.match(changelog, /-Syncing between devices\.\n\+Syncing between devices, and sharing lists\./)
  assert.match(getSection(issue.body, 'changelog'), /Shape v1 by @ana \(first version\)\n- 2026-11-10: Shape v2 by @ben \(\+1 −1 lines\)/)
  assert.match(getSection(issue.body, 'decisions'), /\| Syncing is out of scope \| @ana \| Shape v1 \|/)
  assert.match(getSection(issue.body, 'status'), /Shape v2 awaiting approval/)
  assert.ok(issue.body.startsWith('<!-- factory-foreman:status -->'))
  assert.match(issue.body, /Readers want to track what they have read\./)

  // Every factory write was the App's; nothing posted as a person so far.
  assert.ok(world.log.every((e) => e.by === 'foreman[bot]'))

  // Approval from an agent's shell is refused, from a terminal it's recorded.
  const agent = developer(world, 'ana', { env: { CLAUDECODE: '1' }, isTTY: true, answer: 'y' })
  const refused = await agent.run('approve', 'shape', 'v2')
  assert.equal(refused.code, 2)
  assert.match(refused.err, /Claude Code's shell/)
  const noTty = developer(world, 'ana', { answer: 'y' })
  assert.match((await noTty.run('approve', 'shape', 'v2')).err, /no interactive terminal/)

  const old = developer(world, 'ana', { isTTY: true, answer: 'y' })
  assert.match((await old.run('approve', 'shape', 'v1')).err, /v1 isn't the latest Shape; v2 is/)

  const posted = world.log.filter((e) => e.op === 'comment').length
  for (const no of [ '', 'n', 'no', 'approve', 'y es' ]) {
    const declined = await developer(world, 'ana', { isTTY: true, answer: no }).run('approve', 'shape', 'v2')
    assert.equal(declined.code, 2, `"${no}" declines`)
    assert.match(declined.err, /Not approved\./)
  }
  assert.equal(world.log.filter((e) => e.op === 'comment').length, posted, 'declining posts nothing')
  let asked = ''
  const shown = await main([ 'approve', 'shape', 'v2' ], () => ({ ...developer(world, 'ana', { isTTY: true }).ctx(), prompt: async (q) => { asked = q; return 'n' } }))
  assert.equal(shown.code, 2)
  assert.match(asked, /Shape v2 on #7 \(https:\/\/github\.com\/owner\/sandbox\/issues\/7\), posted by @ben:\n {2}AC-1: A book can be marked read \(visual\)\n {2}AC-2: /)
  assert.match(asked, /\nApprove Shape v2 on #7 as @ana\? \[y\/N\] $/)

  const terminal = developer(world, 'ana', { isTTY: true, answer: 'y' })
  const approved = await terminal.run('approve', 'shape', 'v2')
  assert.equal(approved.code, 0, approved.err)
  const approval = world.log.findLast((e) => e.op === 'comment')
  assert.equal(approval.by, 'ana')
  assert.match(getSection(issue.body, 'decisions'), /\| Approved Shape v2 \| @ana \| Shape v2 \|/)
  assert.match(getSection(issue.body, 'status'), /Shape v2 approved · Design not started/)
  assert.match(getSection(issue.body, 'shape'), /## Shape v2 \(approved\)\n\nReaders lose track/)
  assert.match((await terminal.run('approve', 'shape', 'v2')).err, /already approved/)
})

test('records are trusted only from the App, or from the approver themselves with write access', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write', eve: 'read' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  assert.equal((await ana.run('checkpoint', 'shape')).code, 0)
  const issue = world.issues.get(7)
  const [ real ] = parseRecords(issue.comments)
  // Bound to the real checkpoint, so only the trust rule can drop them.
  const bound = { checkpoint: real.comment.id, repo: real.repo, issue: 7 }
  // A forged approval for ana posted by eve, and eve approving herself without write access.
  issue.comments.push({ id: 90, login: 'eve', type: 'User', createdAt: '2026-11-10T13:00:00Z', body: `<!-- factory-foreman:record ${JSON.stringify({ type: 'approval', ...bound, step: 'shape', version: 'v1', hash: real.hash, artifact: real.artifact, approver: 'ana' })} -->` })
  issue.comments.push({ id: 91, login: 'eve', type: 'User', createdAt: '2026-11-10T13:00:01Z', body: `<!-- factory-foreman:record ${JSON.stringify({ type: 'approval', ...bound, step: 'shape', version: 'v1', hash: real.hash, artifact: real.artifact, approver: 'eve' })} -->` })
  // A forged checkpoint posted by a person.
  issue.comments.push({ id: 92, login: 'eve', type: 'User', createdAt: '2026-11-10T13:00:02Z', body: `<!-- factory-foreman:record ${JSON.stringify({ ...real, comment: undefined, version: 'v2' })} -->` })
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN)
  const design = await ana.run('checkpoint', 'design')
  assert.equal(design.code, 2)
  assert.match(design.err, /Design needs an approved Shape first/)
  const terminal = developer(world, 'ana', { isTTY: true, answer: 'y' })
  assert.equal((await terminal.run('approve', 'shape', 'v1')).code, 0)
})

test('approve refuses a version changed on GitHub after it was posted', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await world.as('mallory').editArtifact(7, 1, 'edited in the browser', 'user')
  const terminal = developer(world, 'ana', { isTTY: true, answer: 'y' })
  assert.match((await terminal.run('approve', 'shape', 'v1')).err, /changed on GitHub after v1 was posted/)
})

test('a second approver can be required', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana', { config: { approvals: { requireSecondApprover: true } } })
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  const self = developer(world, 'ana', { isTTY: true, answer: 'y', config: { approvals: { requireSecondApprover: true } } })
  assert.match((await self.run('approve', 'shape', 'v1')).err, /requires a second approver/)
  const ben = developer(world, 'ben', { isTTY: true, answer: 'y', config: { approvals: { requireSecondApprover: true } } })
  assert.equal((await ben.run('approve', 'shape', 'v1')).code, 0)
})

test('design checkpoints against the approved shape, and refuses a bad draft with every problem', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await developer(world, 'ana', { isTTY: true, answer: 'y' }).run('approve', 'shape', 'v1')

  const brief = await ana.run('draft', 'design')
  assert.match(brief.out, /Approved Shape \(v1\), acceptance criteria:\n- AC-1: A book can be marked read \(visual\)/)
  writeDraft(ana.draft('design'), DESIGN.replace('2. Filter (AC-2)', '2. Filter (AC-1)'))
  const bad = await ana.run('checkpoint', 'design', '--json')
  assert.equal(bad.code, 2)
  assert.deepEqual(JSON.parse(bad.err).problems, [ 'AC-1 is owned by slices 1 and 2; give it to one.', 'No slice owns AC-2.' ])
  writeDraft(ana.draft('design'), DESIGN)
  const ok = await ana.run('checkpoint', 'design')
  assert.equal(ok.code, 0, ok.err)
  assert.match(getSection(world.issues.get(7).body, 'status'), /Shape v1 approved · Design v1 awaiting approval/)
})

test('note validates its flags; an unchanged draft is not posted', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  assert.match((await ana.run('note')).err, /Say what to note/)
  assert.match((await ana.run('note', 'x', '--kind', 'idea')).err, /--kind is one of/)
  assert.match((await ana.run('note', 'x', '--blocking')).err, /only goes with --kind question/)
  assert.equal((await ana.run('note', 'Is sync needed?', '--kind', 'question', '--blocking')).code, 0)
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  assert.match((await ana.run('checkpoint', 'shape')).err, /nothing to post/)
})

test('an approval forged by editing an old comment is not trusted', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write', cto: 'admin' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  const cto = world.as('cto')
  await cto.comment(7, 'Looks good to me.', 'user')
  const issue = world.issues.get(7)
  const [ cp ] = parseRecords(issue.comments)
  const old = issue.comments.at(-1)
  cto.editComment(7, old.id, `${old.body}\n<!-- factory-foreman:record ${JSON.stringify({ type: 'approval', repo: world.repo, issue: 7, step: 'shape', version: 'v1', checkpoint: cp.comment.id, hash: cp.hash, artifact: cp.artifact, approver: 'cto' })} -->`)
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN)
  assert.match((await ana.run('checkpoint', 'design')).err, /Design needs an approved Shape first/)
})

test('a write that lands between the stale check and ours is reported, not recorded', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing.'))
  // Someone writes version 2 the moment after ana's stale check passes.
  const view = world.as('ana')
  const edit = view.editArtifact
  let once = true
  view.editArtifact = async (...args) => { if (once) { once = false; await edit.call(view, 7, 1, 'interloper', 'user') } return edit.apply(view, args) }
  const raced = await main([ 'checkpoint', 'shape' ], () => ({ ...ctxOf(ana), github: () => view }))
  assert.equal(raced.code, 2)
  assert.match(raced.err, /at the same moment, so artifact version 3 isn't recorded/)
  assert.equal(parseRecords(world.issues.get(7).comments).filter((r) => r.type === 'checkpoint').length, 1)
})

test('a checkpoint that failed after posting can be finished by checkpointing the same text', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  const view = world.as('ana')
  view.comment = async () => { throw new Error('network') }
  const failed = await main([ 'checkpoint', 'shape' ], () => ({ ...ctxOf(ana), github: () => view }))
  assert.equal(failed.code, 1)
  await ana.run('draft', 'shape', '--reset')
  const finished = await ana.run('checkpoint', 'shape')
  assert.equal(finished.code, 0, finished.err)
  assert.equal(world.issues.get(7).artifacts[0].versions.length, 1)
  // The failed run's Changelog entry already named v1, so the label moves on:
  // a skipped label is safe, a repeated one isn't.
  assert.match(finished.out, /Posted Shape v2 on #7 \(artifact version 1\)/)
})

test('labels never repeat after a checkpoint comment is edited, and approval follows the comment', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing.'))
  await ana.run('checkpoint', 'shape')
  assert.equal((await developer(world, 'ana', { isTTY: true, answer: 'y' }).run('approve', 'shape', 'v2')).code, 0)
  const issue = world.issues.get(7)
  const first = issue.comments.find((c) => c.body.includes('"version":"v1"'))
  world.as('mallory').editComment(7, first.id, `${first.body} `)
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Printing.'))
  const third = await ana.run('checkpoint', 'shape')
  assert.match(third.out, /Posted Shape v3/)
  assert.match(getSection(issue.body, 'status'), /Shape v3 awaiting approval \(v2 approved\)/)
})

test('repo names match whatever their case', async () => {
  const world = fakeGitHub({ repo: 'Owner/Sandbox', permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  const lower = world.as('ben')
  lower.repo = 'owner/sandbox'
  const ben = developer(world, 'ben')
  const view = await main([ 'draft', 'shape' ], () => ({ ...ben.ctx(), github: () => lower }))
  assert.match(view.out, /Latest: version 1 \(v1 by @ana\)/)
})

test('adopting refuses a version a person wrote, naming the versions in between', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await world.as('ben').editArtifact(7, 1, SHAPE.replace(/^---[\s\S]*?---\n/, '').replace('Syncing between devices.', 'Ben was here.'), 'user')
  await ana.run('draft', 'shape', '--reset')
  const result = await ana.run('checkpoint', 'shape')
  assert.equal(result.code, 2)
  assert.match(result.err, /unrecorded versions 2 to 2 since v1, not all written by the factory/)
})

test('a deleted checkpoint comment does not free its label: the Changelog remembers it', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Content A.'))
  await ana.run('checkpoint', 'shape')
  const issue = world.issues.get(7)
  issue.comments.splice(issue.comments.findIndex((c) => c.body.includes('"version":"v2"')), 1)
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Content B.'))
  assert.match((await ana.run('checkpoint', 'shape')).out, /Posted Shape v3/)
})

test('two first checkpoints at once: the first artifact wins and the other run stops', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  const ben = developer(world, 'ben')
  await ana.run('draft', 'shape')
  await ben.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  writeDraft(ben.draft('shape'), SHAPE.replace('Syncing between devices.', 'Ben\'s text.'))
  const results = await Promise.all([ ana.run('checkpoint', 'shape'), ben.run('checkpoint', 'shape') ])
  assert.deepEqual(results.map((r) => r.code).sort(), [ 0, 2 ])
  assert.match(results.find((r) => r.code === 2).err, /created Shape at the same moment/)
  const records = parseRecords(world.issues.get(7).comments).filter((r) => r.type === 'checkpoint')
  assert.equal(records.length, 1)
  assert.equal(records[0].artifact.number, 1)
})

test('two checkpoints appending to the Changelog at once both keep their entries', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing.'))
  // Another run writes the Changelog from the version this one read, just after it.
  const view = world.as('ana')
  const edit = view.editArtifact
  let once = true
  view.editArtifact = async (n, number, body, w) => {
    const result = await edit.call(view, n, number, body, w)
    if (number === 2 && once) { once = false; await edit.call(view, n, 2, '# Changelog\n\n## Design v9, other run', 'app') }
    return result
  }
  const posted = await main([ 'checkpoint', 'shape' ], () => ({ ...ctxOf(ana), github: () => view }))
  assert.equal(posted.code, 0, posted.err)
  const log = world.issues.get(7).artifacts.find((a) => a.number === 2).versions.at(-1).body
  assert.match(log, /## Design v9, other run/)
  assert.match(log, /## Shape v2, /)
})

test('a draft for another issue is refused, and a Windows draft is read', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  const text = readFileSync(ana.draft('shape'), 'utf8')
  writeFileSync(ana.draft('shape'), text.replace('issue: 7', 'issue: 8'))
  assert.match((await ana.run('checkpoint', 'shape')).err, /is a draft for #8, not #7/)
  writeFileSync(ana.draft('shape'), text.replace(/\n/g, '\r\n'))
  assert.equal((await ana.run('checkpoint', 'shape')).code, 0)
})

test('--reset keeps the old draft as a backup', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  const reset = await ana.run('draft', 'shape', '--reset')
  const backup = reset.out.match(/previous draft is at (\S+\.bak);/)[1]
  assert.match(backup, /shape\.md\..+\.bak$/)
  assert.match(readFileSync(backup, 'utf8'), /Syncing between devices/)
  await ana.run('draft', 'shape', '--reset')
  assert.match(readFileSync(backup, 'utf8'), /Syncing between devices/, 'a second reset keeps the first backup')
})

test('approve stops if a new version is posted while the person confirms', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  const terminal = developer(world, 'ana', { isTTY: true })
  const result = await main([ 'approve', 'shape', 'v1' ], () => ({
    ...terminal.ctx(),
    prompt: async () => {
      await ana.run('draft', 'shape', '--reset')
      writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing.'))
      await ana.run('checkpoint', 'shape')
      return 'y'
    },
  }))
  assert.equal(result.code, 2)
  assert.match(result.err, /Shape v2 was posted while you were confirming/)
})

test('note checks --step and --slice, and -- ends the flags', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  assert.match((await ana.run('note', 'x', '--step', 'build')).err, /--step is shape or design/)
  assert.match((await ana.run('note', 'x', '--slice', 'abc')).err, /--slice is a slice number/)
  assert.match((await ana.run('note', '--', '--kind', 'is text here')).out, /Noted decision \([0-9a-f]{8}\): --kind is text here/)
})

test('a Changelog write that lands just before ours, from the version we read, is kept', async () => {
  const world = fakeGitHub({ permissions: { ana: 'write' } })
  world.addIssue(7)
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE)
  await ana.run('checkpoint', 'shape')
  await ana.run('draft', 'shape', '--reset')
  writeDraft(ana.draft('shape'), SHAPE.replace('Syncing between devices.', 'Sharing.'))
  // The other run read the same version, appended, and finished before we write.
  const view = world.as('ana')
  const edit = view.editArtifact
  let once = true
  view.editArtifact = async (n, number, body, w) => {
    if (number === 2 && once) {
      once = false
      const before = world.issues.get(7).artifacts.find((a) => a.number === 2).versions.at(-1).body
      await edit.call(view, n, 2, `${before}\n\n## Design v9, other run`, 'app')
    }
    return edit.call(view, n, number, body, w)
  }
  assert.equal((await main([ 'checkpoint', 'shape' ], () => ({ ...ctxOf(ana), github: () => view }))).code, 0)
  const log = world.issues.get(7).artifacts.find((a) => a.number === 2).versions.at(-1).body
  assert.match(log, /## Shape v1, [\s\S]*## Design v9, other run[\s\S]*## Shape v2, /)
})

test('approve shows a Design\'s slices, strips control characters, and accepts a padded yes', async () => {
  const { approvedBody } = await import('../src/commands/common.mjs')
  assert.equal(typeof approvedBody, 'function')
  const world = fakeGitHub({ permissions: { ana: 'write', ben: 'write' } })
  world.addIssue(7, '')
  const ana = developer(world, 'ana')
  await ana.run('draft', 'shape')
  writeDraft(ana.draft('shape'), SHAPE.replace('A book can be marked read', 'A book can be marked read\u001b[8m hidden'))
  assert.equal((await ana.run('checkpoint', 'shape')).code, 0)
  let asked = ''
  const shapeOk = await main([ 'approve', 'shape', 'v1' ], () => ({ ...developer(world, 'ben', { isTTY: true }).ctx(), prompt: async (q) => { asked = q; return ' Yes \n' } }))
  assert.equal(shapeOk.code, 0, shapeOk.err)
  assert.ok(!asked.includes(String.fromCharCode(27)), 'no escape character reaches the terminal')
  assert.match(asked, /AC-1: A book can be marked read \[8m hidden \(visual\)/)
  await ana.run('draft', 'design')
  writeDraft(ana.draft('design'), DESIGN)
  assert.equal((await ana.run('checkpoint', 'design')).code, 0)
  await main([ 'approve', 'design', 'v1' ], () => ({ ...developer(world, 'ben', { isTTY: true }).ctx(), prompt: async (q) => { asked = q; return 'n' } }))
  assert.match(asked, /Design v1 on #7 \(.*\), posted by @ana:\n {2}1\. .+ \(AC-1\)/)
})
