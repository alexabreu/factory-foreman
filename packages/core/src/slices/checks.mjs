// Light checks for a slice iteration: config checks.tiers.slice, each
// { name, run: argv, when: "always" | "changed:GLOB" }. Commands run as argv,
// never through a shell, from the repo root.
import { matchesAny } from '../util/glob.mjs'

export function checksToRun(checks, changed) {
  return (checks ?? []).map((c) => {
    const when = c.when ?? 'always'
    if (when === 'always') return { ...c, run: c.run, skip: null }
    if (!when.startsWith('changed:')) return { ...c, skip: null, bad: `"when" must be "always" or "changed:GLOB", not "${when}"` }
    const glob = when.slice('changed:'.length)
    const hit = changed.some((f) => matchesAny(f, [ glob ]))
    return { ...c, skip: hit ? null : `no changed file matches ${glob}` }
  })
}

export async function runChecks(ctx, { checks, changed, cwd }) {
  const results = []
  for (const c of checksToRun(checks, changed)) {
    if (c.bad) { results.push({ name: c.name, ok: false, code: null, tail: c.bad }); continue }
    if (c.skip) { results.push({ name: c.name, ok: true, skipped: c.skip }); continue }
    const r = await ctx.exec(c.run, { cwd, timeout: 10 * 60_000 })
    results.push({ name: c.name, ok: r.code === 0, code: r.code, tail: `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-5).join('\n') })
  }
  return results
}
