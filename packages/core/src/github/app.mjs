// The factory's GitHub App identity. Factory output (artifacts, records, the
// issue body) posts as the App with a short-lived installation token, so a
// person's login only ever carries their own words.
//
// The App lives in FACTORY_FOREMAN_HOME (default ~/.config/factory-foreman):
//   app.json  { "id": 123, "slug": "my-app", "bot": { "login": "my-app[bot]" } }
//   app.pem   the App's private key, readable only by its owner
// Neither file is ever in a repository.
import { createSign } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Refusal } from '../errors.mjs'

export const appHome = (env = process.env) => env.FACTORY_FOREMAN_HOME || join(homedir(), '.config', 'factory-foreman')

export function readApp(env = process.env) {
  const home = appHome(env)
  const file = join(home, 'app.json')
  const keyFile = join(home, 'app.pem')
  if (!existsSync(file) || !existsSync(keyFile)) return null
  const app = JSON.parse(readFileSync(file, 'utf8'))
  if (!Number.isInteger(app.id) || typeof app.slug !== 'string') throw new Refusal(`${file} needs a numeric "id" and a "slug".`)
  if (process.platform !== 'win32' && (statSync(keyFile).mode & 0o077) !== 0) throw new Refusal(`${keyFile} is readable by other users. Run: chmod 600 ${keyFile}`)
  return { id: app.id, slug: app.slug, botLogin: app.bot?.login ?? `${app.slug}[bot]`, keyFile }
}

const base64url = (input) => Buffer.from(input).toString('base64url')

// A JWT that authenticates as the App itself, valid for under ten minutes.
// iat is backdated a minute to allow for clock drift, as GitHub recommends.
export function appJwt(appId, pem, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }))
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(pem, 'base64url')
  return `${header}.${payload}.${signature}`
}

async function call(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  const text = await response.text()
  if (!response.ok) {
    const message = (() => { try { return JSON.parse(text).message } catch { return text } })()
    const error = new Error(`GitHub ${init.method ?? 'GET'} ${new URL(url).pathname}: ${response.status} ${message}`)
    error.status = response.status
    throw error
  }
  return JSON.parse(text)
}

// An installation token for one repository, scoped to just that repository.
// Cached in memory until five minutes before it expires.
export function appTokens({ app, fetch: fetchImpl = globalThis.fetch, api = process.env.GITHUB_API_URL || 'https://api.github.com', clock = () => Date.now() }) {
  const cache = new Map()
  return async function token(repo) {
    const hit = cache.get(repo)
    if (hit && hit.expires - clock() > 5 * 60_000) return hit.token
    const jwt = appJwt(app.id, readFileSync(app.keyFile, 'utf8'), Math.floor(clock() / 1000))
    const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${jwt}`, 'x-github-api-version': '2022-11-28' }
    let installation
    try {
      installation = await call(fetchImpl, `${api}/repos/${repo}/installation`, { headers })
    } catch (error) {
      if (error.status === 404) throw new Refusal(`The ${app.slug} App isn't installed on ${repo}. Install it from https://github.com/apps/${app.slug}/installations/new`)
      throw error
    }
    const name = repo.split('/')[1]
    const result = await call(fetchImpl, `${api}/app/installations/${installation.id}/access_tokens`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ repositories: [ name ] }),
    })
    cache.set(repo, { token: result.token, expires: Date.parse(result.expires_at) })
    return result.token
  }
}
