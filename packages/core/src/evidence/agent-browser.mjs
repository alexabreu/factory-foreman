// The built-in evidence provider: each frozen show script replayed with
// agent-browser against the app at the slice's base and at its head, with a
// screenshot once the page is open and another where the script ends. At base
// the script is expected to stop early (the feature isn't there yet); at head
// it must run to the end.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportAt } from '../slices/gate.mjs'
import { replayShowScripts } from '../slices/show.mjs'

async function scriptsOf(ctx, slice, top) {
  const scripts = []
  for (const path of Object.keys(slice.tests?.show ?? {})) {
    const r = await ctx.exec([ 'git', 'show', `${slice.tests.commit}:${path}` ], { cwd: top, timeout: 60_000 })
    if (r.code === 0) scripts.push({ path, script: JSON.parse(r.stdout) })
  }
  return scripts
}

export const agentBrowserEvidence = {
  name: 'agent-browser',
  async collect({ ctx, slice, base, head, config, top, out }) {
    const scripts = await scriptsOf(ctx, slice, top)
    if (!scripts.length) return { ok: true, files: [], links: [], summary: 'no show scripts (no visual criteria)' }
    const replay = ctx.replayShow ?? replayShowScripts
    // Both sides run from clean checkouts of their commits, so nothing ignored in
    // the working tree (a stale build, a local .env) shapes what's shown. At
    // base the app may not even start: that's evidence too, not a stop.
    const work = mkdtempSync(join(tmpdir(), 'ffe-'))
    let atBase
    let atHead
    let baseNote = null
    try {
      for (const [ side, sha ] of [ [ 'base', base ], [ 'head', head ] ]) {
        const dir = join(work, side === 'base' ? 'a' : 'b')
        await exportAt(ctx, { sha, into: dir, top })
        if (side === 'base') {
          try {
            atBase = await replay(ctx, { scripts, preview: config.preview, cwd: dir, shots: { dir: out, prefix: 'base' } })
          } catch (error) {
            atBase = []
            baseNote = `the app didn't run at base (${error.message})`
          }
        } else {
          atHead = await replay(ctx, { scripts, preview: config.preview, cwd: dir, shots: { dir: out, prefix: 'head' } })
        }
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    const files = []
    for (const [ side, results ] of [ [ 'before', atBase ], [ 'after', atHead ] ]) {
      for (const r of results) {
        for (const s of r.shots ?? []) {
          files.push({ path: s.path, name: s.path.split('/').pop(), kind: 'image', label: `${r.ac} ${side} (${side === 'before' ? 'base' : 'head'}), ${s.moment === 'open' ? 'page open' : r.failed ? `stopped at step ${r.failed.step}` : 'last step'}` })
        }
      }
    }
    const broken = atHead.filter((r) => !r.ok)
    return {
      ok: !broken.length,
      files,
      links: [],
      summary: broken.length ? `${broken.map((r) => `${r.ac} stops at step ${r.failed.step} at head: ${r.failed.error}`).join('; ')}` : `${scripts.length} show script(s) replayed at base and head${baseNote ? `; ${baseNote}` : ''}`,
    }
  },
}
