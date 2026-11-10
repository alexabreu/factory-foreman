import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS, loadConfig, merge } from '../src/config/load.mjs'
import { Refusal } from '../src/errors.mjs'

function target(config, presets = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ff-config-'))
  writeFileSync(join(root, 'package.json'), '{ "name": "t", "private": true }')
  writeFileSync(join(root, 'factory-foreman.config.json'), JSON.stringify(config))
  for (const [ name, preset ] of Object.entries(presets)) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports: { './preset.json': './preset.json' } }))
    writeFileSync(join(dir, 'preset.json'), JSON.stringify(preset))
  }
  return root
}

test('a minimal config gets every default', () => {
  const config = loadConfig(target({ version: 1 }))
  assert.deepEqual(config, structuredClone(DEFAULTS))
})

test('presets merge left to right, then the target file', () => {
  const root = target(
    { version: 1, extends: [ 'preset-a', 'preset-b' ], sharedFiles: [ 'c/**' ], budgets: { words: { lead: 80 } } },
    { 'preset-a': { sharedFiles: [ 'a/**' ], stackDepth: 2 }, 'preset-b': { sharedFiles: [ 'a/**', 'b/**' ], stackDepth: 4 } },
  )
  const config = loadConfig(root)
  assert.deepEqual(config.sharedFiles, [ 'a/**', 'b/**', 'c/**' ])
  assert.equal(config.stackDepth, 4)
  assert.deepEqual(config.budgets.words, { lead: 80, shape: 1800, design: 1900 })
})

test('other arrays are replaced, not concatenated', () => {
  const merged = merge(DEFAULTS, { reviewers: { shape: [ 'product-engineer' ] } })
  assert.deepEqual(merged.reviewers.shape, [ 'product-engineer' ])
  assert.deepEqual(merged.reviewers.design, DEFAULTS.reviewers.design)
})

test('merging never shares arrays with the defaults', () => {
  const merged = merge(DEFAULTS, { sharedFiles: [ 'x' ] })
  merged.reviewers.shape.push('mutated')
  assert.deepEqual(DEFAULTS.reviewers.shape, [ 'test-verification-engineer' ])
})

test('refuses a config that breaks the schema, naming each problem', () => {
  const root = target({ version: 2, stackDepth: 0, nope: true, checks: { tiers: { slice: [ { name: 'lint', run: 'pnpm lint' } ] } } })
  assert.throws(() => loadConfig(root), (error) => {
    assert.ok(error instanceof Refusal)
    for (const part of [ '$.version: must be 1', '$.stackDepth: must be at least 1', '$: unknown key nope', '$.checks.tiers.slice[0].run: expected array' ]) {
      assert.ok(error.message.includes(part), `${part} in ${error.message}`)
    }
    return true
  })
})

test('refuses a missing file, a missing preset and invalid JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-config-'))
  assert.throws(() => loadConfig(root), /No factory-foreman.config.json/)
  assert.throws(() => loadConfig(target({ version: 1, extends: [ 'nowhere' ] })), /can't find nowhere\/preset.json/)
  const bad = target({ version: 1 })
  writeFileSync(join(bad, 'factory-foreman.config.json'), '{ version: 1 ')
  assert.throws(() => loadConfig(bad), /not valid JSON/)
})

test('a check command must be an argv array and `when` must be always or changed:<glob>', () => {
  const ok = loadConfig(target({ version: 1, checks: { tiers: { slice: [ { name: 'lint', run: [ 'pnpm', 'lint' ], when: 'changed:src/**' } ] } } }))
  assert.equal(ok.checks.tiers.slice[0].when, 'changed:src/**')
  assert.throws(() => loadConfig(target({ version: 1, checks: { tiers: { slice: [ { name: 'lint', run: [ 'x' ], when: 'sometimes' } ] } } })), /must match/)
})
