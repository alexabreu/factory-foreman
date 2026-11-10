// A factory-foreman evidence provider: when the AC gate runs a slice's frozen
// tests at head with Playwright, record a video of each, and publish them with
// the iteration. Name it in factory-foreman.config.json:
//   { "evidence": { "providers": ["agent-browser", "@factory-foreman/evidence-playwright"] } }
//
// The repo's own Playwright config is never changed: for that one run, the
// provider writes an overlay config next to it that imports it and turns video
// on, and adds --config to the run. Runs that aren't Playwright are left alone.
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const CONFIGS = [ 'playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs' ]
const OVERLAY = 'factory-foreman-video.config'
const VIDEOS = '.factory-foreman-videos'

export const isPlaywright = (run) => run.some((a) => /(^|[/@])playwright$/.test(a) || a === '@playwright/test') && run.includes('test')

// The repo's config: the one --config names (--config x, --config=x, -c x), or
// the usual file in cwd.
export function baseConfig(run, cwd) {
  const eq = run.findIndex((a) => a.startsWith('--config='))
  if (eq !== -1) return { file: join(cwd, run[eq].slice('--config='.length)), rest: [ ...run.slice(0, eq), ...run.slice(eq + 1) ] }
  const i = run.findIndex((a) => a === '--config' || a === '-c')
  if (i !== -1 && run[i + 1]) return { file: join(cwd, run[i + 1]), rest: [ ...run.slice(0, i), ...run.slice(i + 2) ] }
  const found = CONFIGS.find((c) => existsSync(join(cwd, c)))
  return found ? { file: join(cwd, found), rest: run } : null
}

export function overlaySource(configFile, outputDir) {
  const from = `./${basename(configFile)}`
  return `// Written by @factory-foreman/evidence-playwright for one run of the AC tests.
import base from ${JSON.stringify(from)}

const on = (use) => ({ ...use, video: 'on' })
// The repo's reporters, plus a JSON report that says which test each video is.
const reporters = (r) => (Array.isArray(r) ? r : r ? [ [ r ] ] : [ [ process.env.CI ? 'dot' : 'list' ] ]).map((x) => (Array.isArray(x) ? x : [ x ]))
// Every project records into the one folder factory-foreman collects from, even
// one with an outputDir of its own.
export default {
  ...base,
  outputDir: ${JSON.stringify(outputDir)},
  reporter: [ ...reporters(base.reporter), [ 'json', { outputFile: ${JSON.stringify(`${outputDir}/report.json`)} } ] ],
  use: on(base.use),
  ...(base.projects ? { projects: base.projects.map((p, i) => ({ ...p, use: on(p.use), outputDir: ${JSON.stringify(outputDir)} + '/' + (p.name ?? String(i)).replace(/[^\\w.-]/g, '-') })) } : {}),
}
`
}

// Video path -> { title, retry }, from Playwright's JSON report.
export function videoTitles(reportFile) {
  const map = new Map()
  if (!existsSync(reportFile)) return map
  let report
  try { report = JSON.parse(readFileSync(reportFile, 'utf8')) } catch { return map }
  const visit = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      const title = [ ...trail, spec.title ].filter(Boolean).join(' › ')
      for (const t of spec.tests ?? []) for (const r of t.results ?? []) for (const a of r.attachments ?? []) if (a.name === 'video' && a.path) map.set(a.path, { title, retry: r.retry ?? 0 })
    }
    for (const s of suite.suites ?? []) visit(s, [ ...trail, s.title ])
  }
  for (const s of report.suites ?? []) visit(s, [])
  return map
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

// Which head runs were recorded, by their folder: collect() says why there's nothing otherwise.
const recorded = new Map()

export default {
  name: 'playwright-video',

  headRun({ run, env, cwd }) {
    const base = isPlaywright(run) ? baseConfig(run, cwd) : null
    if (!base) { recorded.set(cwd, null); return { run, env } }
    // The overlay sits next to the repo's config, so the paths it resolves
    // from its own folder (testDir, reporters' files, webServer.cwd) stay right.
    const ext = /\.(c|m)?js$/.test(base.file) ? base.file.match(/\.(c|m)?js$/)[0] : '.ts'
    const overlay = join(dirname(base.file), `${OVERLAY}${ext}`)
    const videos = join(cwd, VIDEOS)
    writeFileSync(overlay, overlaySource(base.file, videos))
    recorded.set(cwd, videos)
    return { run: [ ...base.rest, '--config', relative(cwd, overlay) ], env }
  },

  collect({ cwd, out }) {
    // A run that isn't `playwright test`, or has no config, has nothing to record; that isn't an error.
    if (recorded.get(cwd) === null) return { ok: true, files: [], links: [], summary: 'not recorded: the AC tests don\'t run through `playwright test` with a config (set tests.ac.run to run it directly to get videos)' }
    const videos = walk(join(cwd, VIDEOS)).filter((f) => f.endsWith('.webm'))
    const titles = videoTitles(join(cwd, VIDEOS, 'report.json'))
    const files = videos.map((path, i) => {
      // The test's full title from the JSON report; else Playwright's folder name, which it shortens.
      const test = basename(join(path, '..'))
      const known = titles.get(path)
      const name = `${String(i + 1).padStart(2, '0')}-${test}.webm`.replace(/[^\w.-]/g, '-')
      copyFileSync(path, join(out, name))
      return { path: join(out, name), name, kind: 'video', label: known ? `${known.title}${known.retry ? ` (retry ${known.retry})` : ''}` : `${test.replace(/-/g, ' ')} (video)` }
    })
    return {
      ok: videos.length > 0,
      files,
      links: [],
      summary: videos.length ? `${videos.length} video(s) of the AC tests at head` : 'no videos were recorded; is the AC test run Playwright (tests.ac.run) with a playwright.config in tests.ac.cwd?',
    }
  },
}
