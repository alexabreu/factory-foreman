// Every GitHub call goes through `gh`, one function per call, so a change in
// gh (issue artifacts are still preview) is fixed in one place.
//
// Each write says who it is: `app` posts as the factory's App with an
// installation token, `user` posts as the developer's own gh login.
import { execFile } from 'node:child_process'
import { Refusal } from '../errors.mjs'

export function ghRunner({ bin = 'gh', env = process.env, cwd } = {}) {
  return (args, { input, token } = {}) => new Promise((resolve, reject) => {
    const childEnv = { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
    if (token) { childEnv.GH_TOKEN = token; delete childEnv.GITHUB_TOKEN }
    const child = execFile(bin, args, { env: childEnv, cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') return reject(new Refusal('gh is not installed. Install it from https://cli.github.com and run gh auth login.'))
        const failure = new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(stderr || error.message).trim()}`)
        failure.stderr = stderr
        return reject(failure)
      }
      resolve(stdout)
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

const json = (text) => (text.trim() ? JSON.parse(text) : null)

export function createGitHub({ repo, run, appToken, botLogin }) {
  const as = async (who) => {
    if (who === 'user') return {}
    if (!appToken) throw new Refusal('No GitHub App is set up for factory-foreman. Put app.json and app.pem in ~/.config/factory-foreman (see the README).')
    const token = await appToken(repo)
    // Never fall through to the developer's own login.
    if (!token) throw new Error('The GitHub App returned no installation token.')
    return { token }
  }
  const R = [ '-R', repo ]
  let viewer

  return {
    repo,
    botLogin,

    async viewer() {
      viewer ??= (await run([ 'api', 'user', '--jq', '.login' ])).trim()
      return viewer
    },

    async permission(login) {
      try {
        return (await run([ 'api', `repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`, '--jq', '.permission' ])).trim()
      } catch (error) {
        // Not a collaborator is "none"; anything else is an error, not a quiet "no".
        if (/HTTP 404|Not Found/.test(error.stderr ?? error.message)) return 'none'
        throw error
      }
    },

    // A file's bytes at a commit, or null when there is no such file there.
    // Read through the blobs API, which serves files the contents API won't (over 1 MB).
    async blob(commit, path) {
      try {
        const sha = (await run([ 'api', `repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`, '--jq', '.sha' ])).trim()
        if (!sha) return null
        const content = (await run([ 'api', `repos/${repo}/git/blobs/${sha}`, '--jq', '.content' ])).replace(/\s/g, '')
        return Buffer.from(content, 'base64')
      } catch (error) {
        if (/HTTP 404|Not Found|No commit found/i.test(error.stderr ?? error.message)) return null
        throw error
      }
    },

    // A missing issue reads as null; gh reports it as an error.
    async issue(n) {
      try {
        return json(await run([ 'issue', 'view', String(n), ...R, '--json', 'number,title,body,url,state' ]))
      } catch (error) {
        if (/Could not resolve to an issue/i.test(error.stderr ?? '')) return null
        throw error
      }
    },

    // Fails early, before anything is posted, when the App can't write here.
    async appReady() {
      await as('app')
    },

    async setBody(n, body, who = 'app') {
      await run([ 'issue', 'edit', String(n), ...R, '--body-file', '-' ], { input: body, ...(await as(who)) })
    },

    async comments(n) {
      const pages = json(await run([ 'api', '--paginate', '--slurp', `repos/${repo}/issues/${n}/comments?per_page=100` ])) ?? []
      return pages.flat().map((c) => ({ id: c.id, login: c.user?.login, type: c.user?.type, body: c.body ?? '', createdAt: c.created_at, updatedAt: c.updated_at, url: c.html_url }))
    },

    async comment(n, body, who) {
      const out = json(await run([ 'api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '--input', '-' ], { input: JSON.stringify({ body }), ...(await as(who)) }))
      return { id: out?.id, url: out?.html_url }
    },

    async artifacts(n) {
      return json(await run([ 'issue', 'artifact', 'list', String(n), ...R, '--json', 'number,name,updatedAt' ])) ?? []
    },

    // Every version, oldest first: { version, createdAt, actor, name, body }.
    async history(n, number) {
      const out = json(await run([ 'issue', 'artifact', 'view', String(n), String(number), ...R, '--json', 'number,name,versions' ]))
      const versions = [ ...(out?.versions ?? []) ].sort((a, b) => a.version - b.version)
      return { number: out?.number ?? number, name: out?.name, versions }
    },

    async createArtifact(n, name, body, who = 'app') {
      const out = await run([ 'issue', 'artifact', 'create', String(n), ...R, '--name', name, '--body-file', '-' ], { input: body, ...(await as(who)) })
      const number = Number(out.match(/\/artifacts\/(\d+)/)?.[1])
      if (number) return number
      const found = (await this.artifacts(n)).filter((a) => a.name === name).sort((a, b) => b.number - a.number)[0]
      if (!found) throw new Error(`Created the ${name} artifact on #${n} but can't find it.`)
      return found.number
    },

    async editArtifact(n, number, body, who = 'app') {
      await run([ 'issue', 'artifact', 'edit', String(n), String(number), ...R, '--body-file', '-' ], { input: body, ...(await as(who)) })
    },
  }
}
