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
        async ensureTag(name, sha) {
          world.tags ??= new Map()
          world.tagCalls = (world.tagCalls ?? 0) + 1
          if (world.tags.has(name) && world.tags.get(name) !== sha) throw new Error(`tag ${name} already points at ${world.tags.get(name).slice(0, 12)}`)
          world.tags.set(name, sha)
          log.push({ op: 'tag', name, sha, by: viewer })
        },
        // From world.blobs, or the bare repo standing in for GitHub when a test sets one.
        async blob(commit, path) {
          if (world.blobs?.has(`${commit}:${path}`)) return world.blobs.get(`${commit}:${path}`)
          if (!world.gitDir) return null
          const r = spawnSync('git', [ '--git-dir', world.gitDir, 'cat-file', 'blob', `${commit}:${path}` ])
          return r.status === 0 ? r.stdout : null
        },
        // Pull requests live in the issue numbering, as on GitHub. A PR's head
        // commit is read from the bare repo standing in for GitHub.
        async createPr({ head, base, title, body, draft = true }) {
          const number = Math.max(0, ...issues.keys()) + 1
          issues.set(number, { number, title, body, url: `https://github.com/${repo}/pull/${number}`, state: 'OPEN', comments: [], artifacts: [], pr: { head, base, draft, author: viewer, reviews: [], assignees: [], merged: null } })
          log.push({ op: 'createPr', number, head, base, by: viewer })
          return number
        },
        async pr(n) {
          const i = get(n)
          if (!i?.pr) return null
          const sha = world.gitDir ? spawnSync('git', [ '--git-dir', world.gitDir, 'rev-parse', `refs/heads/${i.pr.head}` ], { encoding: 'utf8' }).stdout.trim() : null
          return { number: n, url: i.url, state: i.state, isDraft: i.pr.draft, headRefName: i.pr.head, headRefOid: i.pr.merged?.sha ?? sha, baseRefName: i.pr.base, author: { login: i.pr.author } }
        },
        async prForBranch(branch) {
          const all = [ ...issues.values() ].filter((x) => x.pr?.head === branch && !x.pr.fork)
          const i = all.find((x) => x.state === 'OPEN') ?? all.find((x) => x.state === 'MERGED') ?? all[0]
          return i ? { number: i.number, state: i.state, baseRefName: i.pr.base, url: i.url } : null
        },
        async prReviews(n) { return get(n).pr.reviews.map((r) => ({ ...r })) },
        async checksAt(sha) { return (world.checks?.get(sha) ?? []).map((c) => ({ ...c })) },
        async runsFor(sha) { return (world.runs?.get(sha) ?? []).map((r) => ({ ...r })) },
        async mergePr(n, sha) {
          const pr = await this.pr(n)
          if (pr.headRefOid !== sha) throw Object.assign(new Error('gh api failed: Head branch was modified. Review and try the merge again.'), { stderr: 'HTTP 409: Head branch was modified' })
          get(n).state = 'MERGED'
          get(n).pr.merged = { sha, by: viewer }
          log.push({ op: 'mergePr', n, sha, by: viewer })
          return { sha: `merge-of-${sha.slice(0, 7)}`, merged: true }
        },
        async markReady(n) { get(n).pr.draft = false; log.push({ op: 'ready', n, by: viewer }) },
        async setPrBase(n, base) { get(n).pr.base = base; log.push({ op: 'setPrBase', n, base, by: viewer }) },
        async addAssignee(n, login) { get(n).pr.assignees.push(login); log.push({ op: 'assign', n, login, by: viewer }) },
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
