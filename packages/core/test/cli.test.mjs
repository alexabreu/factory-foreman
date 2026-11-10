import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli.mjs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('prints the package version', () => {
  assert.deepEqual(main([ '--version' ]), { code: 0, out: version })
})

test('refuses an unknown command with exit code 1', () => {
  assert.equal(main([ 'nope' ]).code, 1)
})

test('runs as a bin', () => {
  const out = execFileSync(process.execPath, [ fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), '--version' ], { encoding: 'utf8' })
  assert.equal(out.trim(), version)
})
