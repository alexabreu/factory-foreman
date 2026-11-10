import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byBot, hash, nextVersion, parseRecords, recordComment, stepState, trustedRecords } from '../src/issue/records.mjs'
import { addDecisionRows, getSection, inert, setSection } from '../src/issue/sections.mjs'
import { statusLine } from '../src/issue/status.mjs'

test('sections keep the person\'s text and sit in a fixed order', () => {
  let body = 'Written by a person.'
  body = setSection(body, 'changelog', '## Changelog\n- one')
  body = setSection(body, 'shape', '## Shape v1')
  body = setSection(body, 'status', '**Status:** x')
  body = setSection(body, 'decisions', '## Decisions')
  const order = [ 'status', 'shape', 'decisions', 'changelog' ].map((n) => body.indexOf(`<!-- factory-foreman:${n} -->`))
  assert.deepEqual([ ...order ].sort((a, b) => a - b), order)
  assert.ok(body.indexOf('Written by a person.') < order[1])
  body = setSection(body, 'shape', '## Shape v2')
  assert.equal(getSection(body, 'shape'), '## Shape v2')
  assert.equal(body.match(/<!-- factory-foreman:shape -->/g).length, 1)
  assert.equal(getSection('no markers', 'shape'), null)
})

test('decision rows escape pipes and newlines', () => {
  const body = addDecisionRows('', [ { date: 'd', text: 'a | b\nc', by: '@x', step: 'Shape v1' } ])
  assert.match(getSection(body, 'decisions'), /\| d \| a \\\| b c \| @x \| Shape v1 \|$/)
})

test('a record survives a "--" in its text and round-trips', () => {
  const record = { type: 'checkpoint', step: 'shape', version: 'v1', note: 'a -- b -->' }
  const body = recordComment('Visible.', record)
  assert.ok(!body.slice(body.indexOf('<!--') + 4, body.lastIndexOf('-->')).includes('-->'))
  const [ parsed ] = parseRecords([ { id: 1, login: 'b', type: 'Bot', body } ])
  assert.equal(parsed.note, 'a -- b -->')
})

test('state: an approval counts only for its checkpoint, after it, with the same hash', async () => {
  let id = 0
  const at = (k) => `2026-11-10T00:00:0${k}Z`
  const cp = (version, h) => { id++; return { id, login: 'bot[bot]', type: 'Bot', createdAt: at(id), updatedAt: at(id), body: recordComment('x', { type: 'checkpoint', step: 'shape', version, hash: h, artifact: { number: 1, version: 1 } }) } }
  const ap = (login, version, h, checkpoint, when = id + 1) => { id++; return { id, login, type: 'User', createdAt: at(when), updatedAt: at(when), body: recordComment('x', { type: 'approval', step: 'shape', version, hash: h, approver: login, checkpoint }) } }
  const comments = [ cp('v1', hash('a')), cp('v2', hash('b')) ]
  comments.push(ap('ana', 'v1', hash('a'), 1), ap('ana', 'v2', hash('other'), 2), ap('ana', 'v2', hash('b'), 1))
  const records = await trustedRecords(comments, { botLogin: 'bot[bot]', permission: async () => 'write' })
  const state = stepState(records, 'shape')
  assert.equal(state.latest.version, 'v2')
  assert.equal(state.approved.version, 'v1')
  assert.equal(statusLine({ shape: state, design: stepState(records, 'design') }), '**Status:** Shape v2 awaiting approval (v1 approved) · Design not started')
})

test('an edited comment is never trusted, even the App\'s', async () => {
  const body = recordComment('x', { type: 'approval', step: 'shape', version: 'v1', approver: 'cto' })
  const records = parseRecords([ { id: 1, login: 'cto', type: 'User', body, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:05:00Z' } ])
  assert.deepEqual(records, [])
})

test('records for another repo or issue are ignored', async () => {
  const c = { id: 1, login: 'bot[bot]', type: 'Bot', createdAt: 't', updatedAt: 't', body: recordComment('x', { type: 'checkpoint', step: 'shape', version: 'v1', repo: 'o/other', issue: 7 }) }
  assert.deepEqual(await trustedRecords([ c ], { botLogin: 'bot[bot]', permission: async () => 'write', repo: 'o/r', issue: 7 }), [])
})

test('a second approver is enforced when reading records, not only when approving', async () => {
  const c1 = { id: 1, login: 'bot[bot]', type: 'Bot', createdAt: '2026-11-10T00:00:01Z', body: recordComment('x', { type: 'checkpoint', step: 'shape', version: 'v1', hash: 'h', author: 'ana' }) }
  const c2 = { id: 2, login: 'ana', type: 'User', createdAt: '2026-11-10T00:00:02Z', body: recordComment('x', { type: 'approval', step: 'shape', version: 'v1', hash: 'h', approver: 'ana', checkpoint: 1 }) }
  const records = await trustedRecords([ c1, c2 ], { botLogin: 'bot[bot]', permission: async () => 'write' })
  assert.equal(stepState(records, 'shape').approved.version, 'v1')
  assert.equal(stepState(records, 'shape', { requireSecondApprover: true }).approved, null)
})

test('table cells and inserted draft text can\'t open markers or close details', () => {
  const body = addDecisionRows('', [ { date: 'd', text: '<!-- factory-foreman:status -->', by: '@x' } ])
  assert.equal(body.match(/<!-- factory-foreman:status -->/g), null)
  assert.equal(inert('a <!-- b --> </details> c'), 'a &lt;!-- b --> &lt;/details> c')
})

test('a fresh checkpoint with no approval yet is awaiting approval', () => {
  assert.equal(statusLine({ shape: { latest: { version: 'v1' }, approved: null }, design: {} }), '**Status:** Shape v1 awaiting approval · Design not started')
})

test('labels count from the App\'s comments only, and a huge one is ignored', () => {
  const comment = (version, login = 'ff[bot]') => ({ id: 1, login, type: 'Bot', body: recordComment('x', { step: 'shape', version }), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' })
  const next = (c) => nextVersion(stepState([], 'shape', { comments: [ c ], botLogin: 'ff[bot]' }))
  for (const version of [ 'v99999999999999999', `v${'9'.repeat(400)}` ]) assert.equal(next(comment(version)), 'v1')
  assert.equal(next(comment('v41')), 'v42', 'an edited App comment still counts')
  assert.equal(next({ ...comment('v999999', 'mallory'), type: 'User' }), 'v1', 'someone else\'s label is ignored')
})

test('labels stop at v999999 instead of repeating', () => {
  const comments = [ { id: 1, login: 'ff[bot]', type: 'Bot', body: recordComment('x', { step: 'shape', version: 'v999999' }), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } ]
  assert.throws(() => nextVersion(stepState([], 'shape', { comments, botLogin: 'ff[bot]' })), /reached v999999/)
})

test('a marker quoted in the person\'s text is left alone', () => {
  const body = 'Note: the bot owns `<!-- factory-foreman:shape -->` blocks.\n\n```\n<!-- factory-foreman:shape -->\n```\n\nIMPORTANT user paragraph.'
  const once = setSection(body, 'shape', 'one')
  const twice = setSection(once, 'shape', 'two')
  assert.match(twice, /IMPORTANT user paragraph\./)
  assert.equal(getSection(twice, 'shape'), 'two')
  assert.equal(twice.split('<!-- /factory-foreman:shape -->').length, 2)
  assert.match(setSection('Text.\r\n<!-- factory-foreman:shape -->\r\nold\r\n<!-- /factory-foreman:shape -->\r\nAfter.', 'shape', 'new'), /Text\.\r\n<!-- factory-foreman:shape -->\nnew\n<!-- \/factory-foreman:shape -->\r\nAfter\./)
})

test('byBot is true only for the App\'s own login', () => {
  assert.equal(byBot({ actor: { login: 'ff[bot]' } }, 'ff[bot]'), true)
  assert.equal(byBot({ actor: { login: 'ff', type: 'Bot' } }, 'ff[bot]'), true)
  assert.equal(byBot({ actor: { login: 'ff', type: 'User' } }, 'ff[bot]'), false)
  assert.equal(byBot({ actor: null }, 'ff[bot]'), false)
  assert.equal(byBot({ actor: { login: 'ff[bot]' } }, null), false)
})
