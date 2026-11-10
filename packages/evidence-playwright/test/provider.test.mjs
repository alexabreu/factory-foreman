import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import provider, { baseConfig, isPlaywright, overlaySource } from '../index.mjs'

test('only a playwright test run gets the overlay, which imports the repo config and turns video on', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ffpw-'))
  writeFileSync(join(cwd, 'playwright.config.ts'), 'export default {}\n')
  const { run } = provider.headRun({ run: [ 'npx', 'playwright', 'test', 'e2e/a.e2e.ts' ], env: {}, cwd })
  assert.deepEqual(run, [ 'npx', 'playwright', 'test', 'e2e/a.e2e.ts', '--config', 'factory-foreman-video.config.ts' ])
  const overlay = readFileSync(join(cwd, 'factory-foreman-video.config.ts'), 'utf8')
  assert.match(overlay, /import base from "\.\/playwright\.config\.ts"/)
  assert.match(overlay, /video: 'on'/)
  assert.match(overlay, /projects: base\.projects\.map/)
  // The repo's config is untouched.
  assert.equal(readFileSync(join(cwd, 'playwright.config.ts'), 'utf8'), 'export default {}\n')
  // Not Playwright, or no config: left alone.
  assert.deepEqual(provider.headRun({ run: [ 'npx', 'vitest', 'run' ], env: { A: 1 }, cwd }), { run: [ 'npx', 'vitest', 'run' ], env: { A: 1 } })
  const bare = mkdtempSync(join(tmpdir(), 'ffpw-'))
  assert.deepEqual(provider.headRun({ run: [ 'npx', 'playwright', 'test' ], env: {}, cwd: bare }).run, [ 'npx', 'playwright', 'test' ])
})

test('an explicit --config is replaced by the overlay of that config', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ffpw-'))
  writeFileSync(join(cwd, 'pw.e2e.config.mjs'), 'export default {}\n')
  const { run } = provider.headRun({ run: [ 'pnpm', 'exec', 'playwright', 'test', '--config', 'pw.e2e.config.mjs', 'e2e/a.ts' ], env: {}, cwd })
  assert.deepEqual(run, [ 'pnpm', 'exec', 'playwright', 'test', 'e2e/a.ts', '--config', 'factory-foreman-video.config.mjs' ])
  assert.match(readFileSync(join(cwd, 'factory-foreman-video.config.mjs'), 'utf8'), /import base from "\.\/pw\.e2e\.config\.mjs"/)
  assert.ok(isPlaywright([ 'node_modules/.bin/playwright', 'test' ]))
  assert.ok(!isPlaywright([ 'npx', 'playwright', 'show-report' ]))
  assert.equal(baseConfig([ 'x' ], mkdtempSync(join(tmpdir(), 'ffpw-'))), null)
  assert.match(overlaySource('/a/playwright.config.js', '/a/out'), /outputDir: "\/a\/out"/)
})

test('collect copies each recorded video out, and finds none as not ok', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ffpw-'))
  const out = mkdtempSync(join(tmpdir(), 'ffpw-out-'))
  assert.equal(provider.collect({ cwd, out }).ok, false)
  for (const t of [ 'a.e2e.ts-AC-1-removes-a-book', 'a.e2e.ts-AC-2-undo' ]) {
    mkdirSync(join(cwd, '.factory-foreman-videos', t), { recursive: true })
    writeFileSync(join(cwd, '.factory-foreman-videos', t, 'video.webm'), 'webm')
  }
  const r = provider.collect({ cwd, out })
  assert.equal(r.ok, true)
  assert.deepEqual(r.files.map((f) => [ f.name, f.kind ]), [ [ '01-a.e2e.ts-AC-1-removes-a-book.webm', 'video' ], [ '02-a.e2e.ts-AC-2-undo.webm', 'video' ] ])
  assert.equal(readFileSync(join(out, r.files[0].name), 'utf8'), 'webm')
})

test('a config outside cwd gets its overlay next to it; --config= and per-project outputDir; a non-Playwright run is ok with nothing to record', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffpw-'))
  mkdirSync(join(root, 'cfg')); mkdirSync(join(root, 'e2e'))
  writeFileSync(join(root, 'cfg', 'pw.config.ts'), 'export default {}\n')
  const cwd = join(root, 'e2e')
  const { run } = provider.headRun({ run: [ 'npx', 'playwright', 'test', '--config=../cfg/pw.config.ts' ], env: {}, cwd })
  assert.deepEqual(run, [ 'npx', 'playwright', 'test', '--config', '../cfg/factory-foreman-video.config.ts' ])
  const overlay = readFileSync(join(root, 'cfg', 'factory-foreman-video.config.ts'), 'utf8')
  assert.match(overlay, /import base from "\.\/pw\.config\.ts"/)
  assert.match(overlay, /outputDir: .*\.factory-foreman-videos" \+ '\/' \+ \(p\.name/)
  const other = mkdtempSync(join(tmpdir(), 'ffpw-'))
  provider.headRun({ run: [ 'pnpm', 'test:e2e' ], env: {}, cwd: other })
  const r = provider.collect({ cwd: other, out: mkdtempSync(join(tmpdir(), 'ffpw-out-')) })
  assert.equal(r.ok, true)
  assert.match(r.summary, /not recorded/)
})
