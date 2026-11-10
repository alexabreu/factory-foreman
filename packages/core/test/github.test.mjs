import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Refusal } from '../src/errors.mjs'
import { appJwt, appTokens, readApp } from '../src/github/app.mjs'
import { createGitHub } from '../src/github/gh.mjs'

function recorder(outputs = {}) {
  const calls = []
  const run = async (args, opts = {}) => {
    calls.push({ args, ...opts })
    const key = Object.keys(outputs).find((k) => args.join(' ').startsWith(k))
    return key ? outputs[key] : ''
  }
  return { calls, run }
}

test('reads go out as the developer, writes as the App with its token', async () => {
  const { calls, run } = recorder({ 'issue artifact create': 'https://github.com/o/r/issues/7/artifacts/3\n' })
  const gh = createGitHub({ repo: 'o/r', run, appToken: async (repo) => `token-for-${repo}`, botLogin: 'b[bot]' })
  await gh.issue(7)
  assert.equal(await gh.createArtifact(7, 'Shape', 'body'), 3)
  await gh.comment(7, 'hello', 'user')
  await gh.setBody(7, 'new body')
  assert.deepEqual(calls[0].args, [ 'issue', 'view', '7', '-R', 'o/r', '--json', 'number,title,body,url,state' ])
  assert.equal(calls[0].token, undefined)
  assert.deepEqual(calls[1].args, [ 'issue', 'artifact', 'create', '7', '-R', 'o/r', '--name', 'Shape', '--body-file', '-' ])
  assert.equal(calls[1].token, 'token-for-o/r')
  assert.equal(calls[1].input, 'body')
  assert.equal(calls[2].token, undefined)
  assert.deepEqual(JSON.parse(calls[2].input), { body: 'hello' })
  assert.equal(calls[3].token, 'token-for-o/r')
})

test('without an App, factory writes are refused rather than posted as the developer', async () => {
  const { calls, run } = recorder()
  const gh = createGitHub({ repo: 'o/r', run, appToken: null, botLogin: null })
  await assert.rejects(gh.setBody(7, 'x'), Refusal)
  assert.equal(calls.length, 0)
})

test('history comes back oldest first; comments flatten across pages', async () => {
  const { run } = recorder({
    'issue artifact view': JSON.stringify({ number: 2, name: 'Shape', versions: [ { version: 2, body: 'b' }, { version: 1, body: 'a' } ] }),
    'api --paginate': JSON.stringify([ [ { id: 1, user: { login: 'a', type: 'User' }, body: 'x', created_at: 't' } ], [ { id: 2, user: { login: 'b[bot]', type: 'Bot' }, body: 'y', created_at: 'u' } ] ]),
  })
  const gh = createGitHub({ repo: 'o/r', run })
  assert.deepEqual((await gh.history(7, 2)).versions.map((v) => v.version), [ 1, 2 ])
  assert.deepEqual((await gh.comments(7)).map((c) => [ c.id, c.login, c.type ]), [ [ 1, 'a', 'User' ], [ 2, 'b[bot]', 'Bot' ] ])
})

function appHome() {
  const home = mkdtempSync(join(tmpdir(), 'ff-app-'))
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  writeFileSync(join(home, 'app.json'), JSON.stringify({ id: 42, slug: 'my-foreman', bot: { login: 'my-foreman[bot]' } }))
  writeFileSync(join(home, 'app.pem'), privateKey.export({ type: 'pkcs1', format: 'pem' }))
  chmodSync(join(home, 'app.pem'), 0o600)
  return { home, publicKey }
}

test('the App JWT is RS256, signed by the key, and short-lived', () => {
  const { home, publicKey } = appHome()
  const app = readApp({ FACTORY_FOREMAN_HOME: home })
  assert.equal(app.botLogin, 'my-foreman[bot]')
  const jwt = appJwt(app.id, readFileSync(app.keyFile, 'utf8'), 1_000_000)
  const [ header, payload, signature ] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: 999_940, exp: 1_000_540, iss: '42' })
  assert.ok(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'))
})

test('no App files means no App; a key others can read is refused', () => {
  assert.equal(readApp({ FACTORY_FOREMAN_HOME: mkdtempSync(join(tmpdir(), 'ff-none-')) }), null)
  const { home } = appHome()
  chmodSync(join(home, 'app.pem'), 0o644)
  assert.throws(() => readApp({ FACTORY_FOREMAN_HOME: home }), /readable by other users/)
})

test('installation tokens are fetched once per repo and reused until near expiry', async () => {
  const { home } = appHome()
  const app = readApp({ FACTORY_FOREMAN_HOME: home })
  let now = Date.parse('2026-11-10T00:00:00Z')
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method ?? 'GET', body: init.body, auth: init.headers.authorization })
    if (url.endsWith('/repos/o/missing/installation')) return { ok: false, status: 404, text: async () => '{"message":"Not Found"}' }
    if (url.endsWith('/installation')) return { ok: true, status: 200, text: async () => '{"id":9}' }
    return { ok: true, status: 201, text: async () => JSON.stringify({ token: `t${requests.length}`, expires_at: new Date(now + 3_600_000).toISOString() }) }
  }
  const token = appTokens({ app, fetch, api: 'https://api.test', clock: () => now })
  assert.equal(await token('o/r'), 't2')
  assert.equal(await token('o/r'), 't2')
  assert.equal(requests.length, 2)
  assert.match(requests[0].auth, /^Bearer ey/)
  assert.deepEqual(JSON.parse(requests[1].body), { repositories: [ 'r' ] })
  now += 56 * 60_000
  assert.equal(await token('o/r'), 't4')
  await assert.rejects(token('o/missing'), /isn't installed on o\/missing/)
})

test('an App that returns no token is an error, never a write as the developer', async () => {
  const { calls, run } = recorder()
  const gh = createGitHub({ repo: 'o/r', run, appToken: async () => undefined, botLogin: 'b[bot]' })
  await assert.rejects(gh.setBody(7, 'x'), /no installation token/)
  assert.equal(calls.length, 0)
})

test('permission: not a collaborator is none, other failures are errors', async () => {
  const fail = (stderr) => async () => { const e = new Error('gh failed'); e.stderr = stderr; throw e }
  assert.equal(await createGitHub({ repo: 'o/r', run: fail('gh: Not Found (HTTP 404)') }).permission('x'), 'none')
  await assert.rejects(createGitHub({ repo: 'o/r', run: fail('connection reset') }).permission('x'), /gh failed/)
})

test('issue: a missing issue is null, other failures are errors', async () => {
  const fail = (stderr) => async () => { const e = new Error('gh failed'); e.stderr = stderr; throw e }
  assert.equal(await createGitHub({ repo: 'o/r', run: fail('GraphQL: Could not resolve to an issue or pull request with the number of 9. (repository.issue)') }).issue(9), null)
  await assert.rejects(createGitHub({ repo: 'o/r', run: fail('connection reset') }).issue(9), /gh failed/)
})
