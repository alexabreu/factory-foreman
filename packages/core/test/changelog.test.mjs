import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactEntry, bodyLine, diffStats, unifiedDiff } from '../src/changelog.mjs'

test('a unified diff with context and correct hunk headers', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\n'
  const after = 'a\nb\nc\nD\ne\nf\ng\nh\ni\n'
  assert.equal(unifiedDiff(before, after, { from: 'v1', to: 'v2', context: 1 }), [
    '--- v1', '+++ v2',
    '@@ -3,3 +3,3 @@', ' c', '-d', '+D', ' e',
    '@@ -8,1 +8,2 @@', ' h', '+i', '',
  ].join('\n'))
})

test('identical texts have no diff; a first version is all additions', () => {
  assert.equal(unifiedDiff('same\n', 'same\n'), '')
  const first = unifiedDiff('', 'one\ntwo\n')
  assert.match(first, /^@@ -0,0 \+1,2 @@$/m)
  assert.deepEqual(diffStats(first), { added: 2, removed: 0 })
})

test('the diff applies: replaying it rebuilds the new text', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const after = before.replace('line 3', 'line three').replace('line 30\n', '').concat('\nline 40')
  const diff = unifiedDiff(`${before}\n`, `${after}\n`)
  const old = before.split('\n')
  const rebuilt = []
  let cursor = 0
  for (const hunk of diff.split(/^(?=@@)/m).slice(1)) {
    const start = Number(hunk.match(/^@@ -(\d+)/)[1]) - 1
    rebuilt.push(...old.slice(cursor, start))
    cursor = start
    for (const line of hunk.split('\n').slice(1).filter(Boolean)) {
      if (line[0] === ' ') { rebuilt.push(line.slice(1)); cursor++ } else if (line[0] === '-') cursor++
      else rebuilt.push(line.slice(1))
    }
  }
  rebuilt.push(...old.slice(cursor))
  assert.equal(rebuilt.join('\n'), after)
})

test('body line and artifact entry', () => {
  const diff = unifiedDiff('a\n', 'b\n', { from: 'v1', to: 'v2' })
  assert.equal(bodyLine({ step: 'shape', version: 'v2', date: '2026-11-10', author: 'alx', diff }), '- 2026-11-10: Shape v2 by @alx (+1 −1 lines)')
  assert.equal(bodyLine({ step: 'design', version: 'v1', date: '2026-11-10', author: 'alx', diff: '' }), '- 2026-11-10: Design v1 by @alx (first version)')
  const entry = artifactEntry({ step: 'shape', version: 'v2', previous: 'v1', date: '2026-11-10', author: 'alx', harness: 'codex', diff, notes: [ 'Dropped sync' ] })
  assert.match(entry, /^## Shape v2, 2026-11-10\n\nBy @alx from codex\. Changes since v1:/)
  assert.match(entry, /How we got here:\n\n- Dropped sync/)
  assert.match(entry, /```diff\n--- v1\n\+\+\+ v2\n@@ -1,1 \+1,1 @@\n-a\n\+b\n```/)
})
