// Evidence providers: what an iteration shows a reviewer besides passing tests.
//
// A provider is an object (a package's default export, or a built-in):
//   {
//     name: 'my-provider',
//     // Optional: adjust the AC gate's head run of the frozen tests (argv and
//     // environment), for evidence recorded while they run. Such a provider's
//     // collect() is called in that run's checkout, before it's removed.
//     headRun?({ run, env, cwd, config }) -> { run, env },
//     // Collects evidence once the gate has passed, writing files into `out`.
//     collect({ ctx, slice, base, head, config, top, cwd, out }) ->
//       { ok, files: [{ path, name, kind: 'image'|'video'|'file', label }], links: [{ label, url }], summary }
//   }
// Files are published to the issue's assets branch under slices/<n>/iter-<k>/
// and linked, pinned to that commit, from the iteration comment. A provider
// that isn't ok stops the iteration.
//
// config.evidence.providers names them: "agent-browser" is built in (show
// scripts replayed at base and head, with screenshots); any other name is a
// package resolved from the target repo, like a preset. Core knows no test
// framework: a provider package brings its own.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Refusal } from '../errors.mjs'
import { inert } from '../issue/sections.mjs'
import { agentBrowserEvidence } from './agent-browser.mjs'

export const BUILTIN = { 'agent-browser': agentBrowserEvidence }
export const DEFAULT_PROVIDERS = [ 'agent-browser' ]

export async function loadProviders(config, top) {
  const names = [ ...new Set(config.evidence?.providers ?? DEFAULT_PROVIDERS) ]
  const providers = []
  for (const name of names) {
    if (BUILTIN[name]) { providers.push(BUILTIN[name]); continue }
    // A package, never a path: a file in the working tree is the slice's to change.
    if (/^[./]/.test(name) || name.includes('\\')) throw new Refusal(`evidence.providers names ${name}; a provider is a package name, not a path.`)
    const file = resolvePackage(name, top)
    if (!file) throw new Refusal(`evidence.providers names ${name}, which isn't installed in this repo. Install it (as a dev dependency) or take it out of the config.`)
    const module = await import(pathToFileURL(file).href)
    const provider = module.default ?? module.provider
    if (typeof provider?.name !== 'string' || typeof provider?.collect !== 'function' || (provider.headRun !== undefined && typeof provider.headRun !== 'function')) {
      throw new Refusal(`${name} isn't an evidence provider: its default export needs a "name" and a "collect" function (and, optionally, "headRun").`)
    }
    if (providers.some((p) => p.name === provider.name)) throw new Refusal(`Two evidence providers are both called ${provider.name}.`)
    providers.push(provider)
  }
  return providers
}

// The package's ESM entry (its exports' import or default, or main), found from
// the repo's own node_modules.
function resolvePackage(name, top) {
  let pkgFile
  try {
    pkgFile = createRequire(join(top, 'package.json')).resolve(`${name}/package.json`)
  } catch {
    try { return createRequire(join(top, 'package.json')).resolve(name) } catch { return null }
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const pick = (e) => (typeof e === 'string' ? e : e && (pick(e.import) ?? pick(e.default) ?? pick(e.node)))
  const entry = pick(typeof pkg.exports === 'object' && !Array.isArray(pkg.exports) && pkg.exports['.'] !== undefined ? pkg.exports['.'] : pkg.exports) ?? pkg.main ?? 'index.js'
  const file = join(dirname(pkgFile), entry)
  return existsSync(file) ? file : null
}

// The iteration comment's evidence section, with each file at its pinned URL.
// Everything a provider wrote is text, never markup or a factory record.
const text = (s) => inert(String(s ?? '')).replace(/[\r\n]+/g, ' ').replace(/[[\]()<>`]/g, '').trim()
const href = (u) => (/^https:\/\/[^\s()<>]+$/.test(String(u ?? '')) ? u : null)
export function evidenceSection(results, urlOf) {
  const lines = []
  for (const r of results) {
    const head = `- ${text(r.name)}: ${text(r.summary) || 'nothing to show'}`
    lines.push(head)
    for (const f of r.files) lines.push(f.kind === 'image' ? `  <br>${text(f.label)}<br>![${text(f.label)}](${urlOf(f.published)})` : `  - [${text(f.label)}](${urlOf(f.published)})`)
    for (const l of r.links ?? []) if (href(l.url)) lines.push(`  - [${text(l.label)}](${l.url})`)
  }
  return lines.join('\n')
}
