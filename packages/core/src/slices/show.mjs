// Show scripts: JSON a reviewer can replay to see a visual AC work.
//   { "ac": "AC-1", "says": "…", "url": "/", "steps": [ { "fill": "new-title", "text": "Dune" }, { "click": "add" } ] }
// Each step targets a test id. Replayed with agent-browser against the repo's
// preview server (config preview: { start, url, ready }).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Refusal } from '../errors.mjs'

const STEPS = { fill: (s) => [ 'fill', id(s.fill), String(s.text ?? '') ], click: (s) => [ 'click', id(s.click) ], check: (s) => [ 'check', id(s.check) ], select: (s) => [ 'select', id(s.select), String(s.value ?? '') ], wait: (s) => [ 'wait', id(s.wait) ] }
const id = (testId) => `[data-testid="${String(testId).replace(/["\\]/g, '\\$&')}"]`

// Problems with a show script's shape, before anything runs.
export function checkShowScript(script) {
  const problems = []
  if (!script || typeof script !== 'object') return [ 'it isn\'t a JSON object' ]
  if (typeof script.ac !== 'string' || !/^AC-\d+$/.test(script.ac)) problems.push('"ac" must name the criterion, like "AC-1"')
  if (!Array.isArray(script.steps) || !script.steps.length) problems.push('"steps" must be a non-empty list')
  for (const [ i, step ] of (script.steps ?? []).entries()) {
    const kinds = Object.keys(step ?? {}).filter((k) => STEPS[k])
    if (kinds.length !== 1) problems.push(`step ${i + 1} must have exactly one of ${Object.keys(STEPS).join(', ')}`)
  }
  return problems
}

export const stepArgs = (step) => STEPS[Object.keys(step).find((k) => STEPS[k])](step)

const answers = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return r.status < 500
  } catch {
    return false
  }
}

// Up within `ms`, or the reason it never came up.
async function waitFor(url, ms, exited) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (exited.why) return exited.why
    if (await answers(url)) return null
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return `it didn't answer at ${url} within ${ms / 1000} s`
}

// Stops the server's whole process group: a launcher like npm can exit and leave
// the real server (and the port) behind.
async function stop(server) {
  const group = (signal) => { try { process.kill(-server.pid, signal); return true } catch { return false } }
  const leaderGone = server.exitCode !== null || server.signalCode !== null
  const gone = leaderGone ? Promise.resolve() : new Promise((resolve) => server.once('exit', resolve))
  if (!group('SIGTERM')) return
  const timer = setTimeout(() => group('SIGKILL'), 5000)
  await gone
  clearTimeout(timer)
  if (leaderGone) { await new Promise((resolve) => setTimeout(resolve, 500)); group('SIGKILL') }
}

// Starts the preview server, replays each script, stops the server. With
// `shots` ({ dir, prefix }), it screenshots each script once the page is open
// and again where it ends (its last step, or the step that failed).
export async function replayShowScripts(ctx, { scripts, preview, cwd, shots = null }) {
  if (!preview) throw new Refusal('Replaying show scripts needs the app running: set preview in factory-foreman.config.json, for example { "start": ["npm", "run", "dev"], "url": "http://localhost:5173" }.')
  // Something already answering there (your own dev server, say) may be another branch's app.
  if (await answers(preview.url)) throw new Refusal(`Something is already serving ${preview.url}. Stop it, so the show scripts replay against this slice's app.`)
  const server = spawn(preview.start[0], preview.start.slice(1), { cwd, env: ctx.env, stdio: 'ignore', detached: true })
  const exited = { why: null }
  server.on('error', (error) => { exited.why = `${preview.start[0]} couldn't start: ${error.message}` })
  server.on('exit', (code, signal) => { exited.why ??= `it exited (${signal ?? `code ${code}`}) before answering at ${preview.url}` })
  const sockets = mkdtempSync(join(tmpdir(), 'ffs-'))
  const env = { ...ctx.env, AGENT_BROWSER_SOCKET_DIR: sockets }
  const session = `factory-foreman-show-${process.pid}`
  const results = []
  try {
    const notUp = await waitFor(preview.url, 90_000, exited)
    if (notUp) throw new Refusal(`The preview server (${preview.start.join(' ')}) isn't up: ${notUp}.`)
    for (const { path, script } of scripts) {
      const run = (args) => ctx.exec([ 'agent-browser', '--session', session, ...args ], { env, timeout: 60_000 })
      const opened = await run([ 'open', new URL(script.url ?? '/', preview.url).href ])
      if (opened.code === 127) throw new Refusal('Install agent-browser to replay show scripts: npm install -g agent-browser, then agent-browser install.')
      let failed = opened.code === 0 ? null : { step: 'open', error: String(opened.stderr || opened.stdout).trim().split('\n').at(-1) }
      const taken = []
      // Screenshots are evidence, not checks: one that fails is left out, never fatal.
      const shot = async (moment) => {
        if (!shots) return
        // Named by the script's file, so two scripts for one AC never collide.
        const file = join(shots.dir, `${shots.prefix}-${basename(path).replace(/\.json$/, '').replace(/[^\w.-]/g, '-')}-${moment}.png`)
        const r = await run([ 'screenshot', file, '--full' ])
        if (r.code === 0 && existsSync(file)) taken.push({ path: file, moment })
      }
      if (!failed) await shot('open')
      for (const [ i, step ] of script.steps.entries()) {
        if (failed) break
        const r = await run(stepArgs(step))
        if (r.code !== 0) failed = { step: i + 1, error: String(r.stderr || r.stdout).trim().split('\n').at(-1) }
      }
      if (opened.code === 0) await shot('end')
      results.push({ path, ac: script.ac, says: script.says ?? '', ok: !failed, failed, shots: taken })
    }
  } finally {
    await ctx.exec([ 'agent-browser', '--session', session, 'close' ], { env, timeout: 30_000 })
    rmSync(sockets, { recursive: true, force: true })
    await stop(server)
  }
  return results
}
