import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { main, repoFromRemote } from '../src/cli.mjs'
import { Refusal } from '../src/errors.mjs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('prints the package version', async () => {
  assert.deepEqual(await main([ '--version' ]), { code: 0, out: version })
})

test('refuses an unknown command with exit code 1', async () => {
  assert.equal((await main([ 'nope' ])).code, 1)
})

test('runs as a bin', () => {
  const out = execFileSync(process.execPath, [ fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), '--version' ], { encoding: 'utf8' })
  assert.equal(out.trim(), version)
})

test('finds owner/repo in ssh and https remotes', () => {
  assert.equal(repoFromRemote('git@github.com:owner/repo.git'), 'owner/repo')
  assert.equal(repoFromRemote('https://github.com/owner/re.po'), 'owner/re.po')
  assert.equal(repoFromRemote('https://github.com/owner/repo.git/'), 'owner/repo')
  assert.equal(repoFromRemote('https://gitlab.com/owner/repo.git'), null)
})

test('an issue command outside a factory branch asks which issue', async () => {
  const result = await main([ 'draft', 'shape' ], () => ({ issue: () => { throw new Refusal('Which issue?') } }))
  assert.deepEqual(result, { code: 2, err: 'Refused: Which issue?' })
})

test('--issue must be a positive whole number', async () => {
  const { issueNumber } = await import('../src/args.mjs')
  assert.equal(issueNumber({ issue: true }), undefined)
  assert.equal(issueNumber({ issue: '0x10' }), undefined)
  assert.equal(issueNumber({ issue: '1e1' }), undefined)
  assert.equal(issueNumber({ issue: '12' }), 12)
  assert.equal(issueNumber({}, 'factory-foreman/34-slice-1'), 34)
  assert.equal(repoFromRemote('https://notgithub.com/o/r.git'), null)
})
