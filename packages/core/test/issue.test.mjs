import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hash, nextVersion, parseRecords, recordComment, stepState, trustedRecords } from '../src/issue/records.mjs'
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

test('a huge label someone posted is ignored, so numbering stays exact', () => {
  const comment = (version) => ({ id: 1, login: 'mallory', type: 'User', body: recordComment('x', { step: 'shape', version }), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' })
  for (const version of [ 'v99999999999999999', `v${'9'.repeat(400)}` ]) {
    assert.equal(nextVersion(stepState([], 'shape', { comments: [ comment(version) ] })), 'v1')
  }
  assert.equal(nextVersion(stepState([], 'shape', { comments: [ comment('v41') ] })), 'v42')
})

test('labels stop at v999999 instead of repeating', () => {
  const comments = [ { id: 1, login: 'mallory', type: 'User', body: recordComment('x', { step: 'shape', version: 'v999999' }), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } ]
  assert.throws(() => nextVersion(stepState([], 'shape', { comments })), /reached v999999/)
})
