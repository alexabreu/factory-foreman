// An in-memory GitHub with the same interface as createGitHub, for tests.
// `as(login)` returns a view that reads and writes as that developer, while
// `app` writes appear as the bot.
import { spawnSync } from 'node:child_process'
export function fakeGitHub({ repo = 'owner/sandbox', botLogin = 'foreman[bot]', permissions = {}, blobs = new Map() } = {}) {
  const issues = new Map()
  let clock = Date.parse('2026-11-10T00:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()
  const log = []

  const world = {
    repo,
    botLogin,
    issues,
    log,
    permissions,
    blobs,
    addIssue(n, body = '') {
      issues.set(n, { number: n, title: `Issue ${n}`, body, url: `https://github.com/${repo}/issues/${n}`, state: 'OPEN', comments: [], artifacts: [] })
      return issues.get(n)
    },
    as(viewer) {
      const who = (w) => (w === 'app' ? { login: botLogin, type: 'Bot' } : { login: viewer, type: 'User' })
      const get = (n) => issues.get(n)
      return {
        repo,
        botLogin,
        async viewer() { return viewer },
        // From world.blobs, or the bare repo standing in for GitHub when a test sets one.
        async blob(commit, path) {
          if (world.blobs?.has(`${commit}:${path}`)) return world.blobs.get(`${commit}:${path}`)
          if (!world.gitDir) return null
          const r = spawnSync('git', [ '--git-dir', world.gitDir, 'cat-file', 'blob', `${commit}:${path}` ])
          return r.status === 0 ? r.stdout : null
        },
        async permission(login) { return permissions[login] ?? 'none' },
        async issue(n) {
          const i = get(n)
          return i && { number: i.number, title: i.title, body: i.body, url: i.url, state: i.state }
        },
        async appReady() {},
        editComment(n, id, body) { const c = get(n).comments.find((x) => x.id === id); c.body = body; c.updatedAt = tick() },
        async setBody(n, body, w = 'app') { get(n).body = body; log.push({ op: 'setBody', n, by: who(w).login }) },
        async comments(n) { return get(n).comments.map((c) => ({ ...c })) },
        async comment(n, body, w) {
          const at = tick()
          const c = { id: get(n).comments.length + 1, ...who(w), body, createdAt: at, updatedAt: at, url: `${get(n).url}#c` }
          get(n).comments.push(c)
          log.push({ op: 'comment', n, by: c.login })
          return { id: c.id, url: c.url }
        },
        async artifacts(n) { return get(n).artifacts.map((a) => ({ number: a.number, name: a.versions.at(-1).name, updatedAt: a.versions.at(-1).createdAt })) },
        async history(n, number) {
          const a = get(n).artifacts.find((x) => x.number === number)
          return { number, name: a.versions.at(-1).name, versions: a.versions.map((v) => ({ ...v })) }
        },
        async createArtifact(n, name, body, w = 'app') {
          const number = get(n).artifacts.length + 1
          get(n).artifacts.push({ number, versions: [ { version: 1, name, body: body.replace(/\s+$/, ''), createdAt: tick(), actor: { login: who(w).login } } ] })
          log.push({ op: 'createArtifact', n, name, by: who(w).login })
          return number
        },
        async editArtifact(n, number, body, w = 'app') {
          const a = get(n).artifacts.find((x) => x.number === number)
          a.versions.push({ version: a.versions.length + 1, name: a.versions.at(-1).name, body: body.replace(/\s+$/, ''), createdAt: tick(), actor: { login: who(w).login } })
          log.push({ op: 'editArtifact', n, number, by: who(w).login })
        },
      }
    },
  }
  return world
}
