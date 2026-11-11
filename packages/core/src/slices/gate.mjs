// The AC gate: the slice's frozen AC tests must fail at the slice's base for a
// reason the slice will fix, and pass at its head.
//
// At base, a failure counts only if it is
//   - an assertion that ran and didn't hold,
//   - an import of a file the slice owns and base doesn't have, or
//   - a locator waiting for a test id the slice's contract adds;
// anything else (a passing test, an import of a file that isn't the slice's, a
// crash, a page that won't load) means the test doesn't test the slice.
// At head the runner must exit 0, and every frozen file and every owned AC
// must have a passing test. The gate proves the tests fail before and pass
// after; whether they assert enough is the reviewers' call.
//
// Each side is checked out into a fresh temporary folder outside the repo
// with a temporary index (only reading .git, so it works where .git is
// read-only), with the repo's installed node_modules linked in.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, posix, relative } from 'node:path'
import { Refusal } from '../errors.mjs'
import { matchesAny } from '../util/glob.mjs'
import { git, gitTest } from '../util/git.mjs'

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ''
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&')

// Test cases from JUnit XML: name, file, outcome, failure type and text.
// Every <testcase> counts, however suites nest (node's reporter nests describe
// blocks and puts top-level tests straight under <testsuites>); its file is its
// own file or classname attribute, or else the nearest enclosing suite's.
export function parseJUnit(xml) {
  const src = String(xml)
  const suites = []
  for (const m of src.matchAll(/<(\/?)testsuite\b([^>]*?)(\/?)>/g)) suites.push({ at: m.index, close: m[1] === '/', self: m[3] === '/', attrs: m[2] })
  const fileAt = (pos) => {
    const stack = []
    for (const e of suites) {
      if (e.at >= pos) break
      if (e.close) stack.pop()
      else if (!e.self) stack.push(e.attrs)
    }
    const inner = stack.reverse()
    for (const attrs of inner) { const f = attr(attrs, 'file'); if (f) return unescape(f) }
    for (const attrs of inner) { const f = attr(attrs, 'name'); if (f) return unescape(f) }
    return ''
  }
  const cases = []
  for (const m of src.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const inner = m[3] ?? ''
    const failure = inner.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/)
    const skipped = /<skipped\b/.test(inner)
    const body = (failure?.[3] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    const text = failure ? unescape(`${attr(failure[2], 'message')}\n${body}`).trim() : ''
    cases.push({ name: unescape(attr(m[1], 'name')), file: unescape(attr(m[1], 'file') || attr(m[1], 'classname')) || fileAt(m.index), outcome: failure ? 'failed' : skipped ? 'skipped' : 'passed', type: failure ? unescape(attr(failure[2], 'type')) : '', text })
  }
  return cases
}

// The failure without code frames, stack lines and runners' headers, which
// quote the test's source and would match anything. The call log stays: it's
// where Playwright says what a locator was waiting for.
export function failureMessage(text) {
  const lines = []
  for (const line of String(text).split('\n')) {
    if (/^\s*>?\s*\d+\s*\|/.test(line) || /^\s*\|\s*\^/.test(line) || /^\s+at\s/.test(line) || /^\s*\S+:\d+:\d+ › /.test(line) || /^\s*❯ /.test(line)) continue
    lines.push(line)
  }
  return lines.join('\n').trim()
}

const IMPORT = /Cannot find module ['"]([^'"]+)['"](?: imported from ['"]?([^'"\s]+))?|Failed to (?:resolve|load url) (?:import )?["']?([^"'\s]+)["']?(?: (?:from|in) ["']([^"']+)["'])?|Could not resolve ["']([^"']+)["'](?: from ["']([^"']+)["'])?|Cannot find package ['"]([^'"]+)['"]/
// What a call log says a locator waited for: its "- waiting for …" and
// "Locator: …" lines only (a custom expect message can echo anything
// elsewhere), cut at " with timeout".
const WAIT_LINE = /^\s*(?:-\s*waiting for|Locator:)\s+(.+?)(?:\s+with timeout \d+ms)?\s*$/
const waitsIn = (block) => block.split('\n').map((l) => l.match(WAIT_LINE)?.[1]).filter(Boolean)
// The test ids a locator names at its top level, in order, or null when it's a
// union (.or, .and), whose target can't be told. Ids inside a filter's
// has/hasNot only narrow it.
const TOP_ID = /^(?:getByTestId\(\s*['"]([^'"]+)['"]\s*\)|locator\(\s*['"]\[data-testid=(?:\\?["']([^"'\\]+)\\?["']|([\w-]+))\]['"]\s*\))/
export function chainIds(expr) {
  const ids = []
  let depth = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (depth === 0) {
      if (/^\.(?:or|and)\(/.test(expr.slice(i))) return null
      const m = expr.slice(i).match(TOP_ID)
      if (m && (i === 0 || expr[i - 1] === '.')) { ids.push(m[1] ?? m[2] ?? m[3]); i += m[0].length - 1; continue }
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === "'" || ch === '"' || ch === '`') {
      // Skip the string, escapes included (Playwright prints 'it\'s').
      let j = i + 1
      while (j < expr.length && expr[j] !== ch) j += expr[j] === '\\' ? 2 : 1
      i = j
    }
  }
  return ids
}
// Every test id a failure's call logs name, for checking which exist at base.
export const waitedIds = (message) => waitsIn(message).flatMap((w) => chainIds(w) ?? [])
// A failure's top-level sections: Playwright puts two blank lines between
// errors (a soft expect, then what ended the test), one inside an error. The
// echo of the message's first line, and attachment and error-context notes,
// aren't sections of their own.
function sections(message) {
  const raw = message.split(/\n[ \t]*\n(?:[ \t]*\n)+/).map((p) => p.trim()).filter(Boolean).filter((p) => !/^(?:Error Context:|attachment #\d+:|─)/.test(p))
  const parts = []
  for (const p of raw) {
    const last = parts.at(-1)
    // Still inside one error: toPass's own call log, a diff with blank lines
    // before the error reaches its call log, or a value quoted in the call log.
    // An "unexpected value" in the call log can span blank lines too, until its closing quote.
    const openValue = last !== undefined && /- unexpected value "[^"]*$/.test(last)
    if (last !== undefined && (/^Call Log:/.test(p) || openValue || (/^\s*Locator:/m.test(last) && !/^\s*Call log:/m.test(last) && !/^\w*Error: /.test(p)))) parts[parts.length - 1] = `${last}\n\n${p}`
    else parts.push(p)
  }
  // A test or hook timeout heads the error that was pending, when there is one.
  for (let i = parts.length - 2; i >= 0; i--) if (/^Test timeout of \d+ms exceeded[^\n]*$/.test(parts[i])) parts.splice(i, 2, `${parts[i]}\n\n${parts[i + 1]}`)
  return parts.filter((p, i) => !(!p.includes('\n') && parts.slice(i + 1).some((q) => q.split('\n').some((l) => l.trim().replace(/^\w*Error: /, '') === p.replace(/^\w*Error: /, '')))))
}
const FOUND = /locator resolved to (?!0 elements)|^\s*Received(?: string| value)?:\s*(?!<element\(s\) not found>)\S/m
const ASSERTION_TYPE = /^(?:\w*AssertionError|expect\.\w+)$/
const ASSERTION_LINE = /^(?:\w*AssertionError\b|Error: expect\(|expect\(|Error: Timed out \d+ms waiting for expect\()/

const noExt = (p) => p.replace(/\.[cm]?[jt]sx?$/, '')

// Why a test failed at base, and whether that's a failure the slice fixes.
// `owned` are the files the slice adds; `testIds` the contract's ids base lacks.
// `known` are other test ids base already has (null: not checked).
export function classify(text, { owned, testIds, known = null }, type = '') {
  const message = failureMessage(text)
  const imported = message.match(IMPORT)
  if (imported) {
    const spec = imported[1] ?? imported[3] ?? imported[5] ?? imported[7]
    const importer = imported[2] ?? imported[4] ?? imported[6] ?? null
    let ok = false
    if (spec.startsWith('/')) ok = owned.some((f) => noExt(spec).endsWith(`/${noExt(f)}`))
    else if (spec.startsWith('.')) {
      const target = importer && !importer.startsWith('/') ? noExt(posix.normalize(posix.join(posix.dirname(importer), spec))) : null
      const bare = noExt(spec.replace(/^(\.\.?\/)+/, ''))
      ok = Boolean(bare) && owned.some((f) => (target ? noExt(f) === target : noExt(f) === bare || noExt(f).endsWith(`/${bare}`)))
    }
    // A path inside the gate's checkout reads as the repo's own path.
    const shown = spec.replace(/^.*\/ffg-[^/]+\/[ab]\//, '')
    return { kind: 'import', detail: spec, ok, why: ok ? `imports ${shown}, which the slice adds` : `imports ${shown}, which isn't a file the slice adds: the test can't reach the code it's meant to test` }
  }
  // A locator that never found its element; one that found it and saw the
  // wrong thing is an assertion.
  // Where a failure names locators (a Playwright run), every section must be
  // one the slice fixes: a wait for an element that isn't there yet, ending on
  // a test id the contract adds, or an assertion on an element that is. Every
  // test id a locator passes through must be the contract's or exist at base,
  // found or not, so a typo can't hide behind an assertion.
  if (waitsIn(message).length && /^\s*(?:Call log:|Locator:)/m.test(message)) {
    const verdicts = sections(message).map((section) => {
      const ws = waitsIn(section)
      const found = FOUND.test(section)
      for (const w of ws) {
        const chain = chainIds(w)
        if (chain === null) return { kind: 'locator', ok: false, detail: w.slice(0, 120), why: `waits for ${w.slice(0, 120)}, a union (or/and) whose target can't be told` }
        const unknown = chain.find((id) => !testIds.includes(id) && known && !known.includes(id))
        if (unknown) return { kind: 'locator', ok: false, detail: unknown, why: `waits on test id ${unknown}, which neither base nor the slice's contract has` }
        if (found) continue
        if (!chain.length) return { kind: 'locator', ok: false, detail: w.slice(0, 120), why: `waits for ${w.slice(0, 120)}, which doesn't end on a test id (by role, text or CSS isn't checked against the contract)` }
        const target = chain.at(-1)
        if (!testIds.includes(target)) return { kind: 'locator', ok: false, detail: target, why: `waits for test id ${target}, which the slice's contract doesn't add (or base already has)${/has(?:Not)?:/.test(w) ? '; an id inside a has filter only narrows it' : ''}` }
      }
      if (ws.length && !found) {
        const id = chainIds(ws.at(-1)).at(-1)
        return { kind: 'locator', ok: true, detail: id, why: `waits for test id ${id}, which the slice's contract adds` }
      }
      const line = section.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      if (ASSERTION_LINE.test(line) || (ws.length && found)) return { kind: 'assertion', ok: true, detail: line.slice(0, 160), why: 'an assertion that doesn\'t hold yet' }
      return { kind: 'other', ok: false, detail: line.slice(0, 160), why: `fails for a reason the slice doesn't fix: ${line.slice(0, 160)}` }
    })
    return verdicts.find((v) => !v.ok) ?? verdicts.filter((v) => v.kind === 'locator').at(-1) ?? verdicts[0]
  }
  const first = message.split('\n').map((l) => l.trim()).find((l) => /^\w*(Error|AssertionError)\b|^expect\(/.test(l)) ?? message.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (ASSERTION_TYPE.test(type) || ASSERTION_LINE.test(first)) return { kind: 'assertion', detail: first.slice(0, 160), ok: true, why: 'an assertion that doesn\'t hold yet' }
  return { kind: 'other', detail: first.slice(0, 160), ok: false, why: `fails for a reason the slice doesn't fix: ${first.slice(0, 160)}` }
}

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isDirectory()) walk(path, root, out)
    else if (stat.isFile()) out.push(relative(root, path).split('\\').join('/'))
  }
  return out
}

// The repo's tree at a commit, with the frozen tests and installed packages.
export async function exportAt(ctx, { sha, into, top, tests = [], testsCommit = null, cwd = '.' }) {
  mkdirSync(into, { recursive: true })
  const index = join(dirname(into), `index-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const env = { ...ctx.env, GIT_INDEX_FILE: index }
  await git(ctx, [ 'read-tree', sha ], `Reading ${sha.slice(0, 12)}`, { cwd: top, env, timeout: 10 * 60_000 })
  await git(ctx, [ 'checkout-index', '--all', `--prefix=${into}/` ], `Checking out ${sha.slice(0, 12)}`, { cwd: top, env, timeout: 10 * 60_000 })
  rmSync(index, { force: true })
  for (const path of tests) {
    const blob = await ctx.exec([ 'git', 'cat-file', 'blob', `${testsCommit}:${path}` ], { cwd: top, timeout: 60_000 })
    if (blob.code !== 0) throw new Refusal(`Reading the frozen test ${path} failed: ${String(blob.stderr).trim()}`)
    mkdirSync(dirname(join(into, path)), { recursive: true })
    writeFileSync(join(into, path), blob.stdout)
  }
  for (const rel of new Set([ '.', cwd ])) {
    const modules = join(top, rel, 'node_modules')
    if (existsSync(modules) && existsSync(join(into, rel)) && !existsSync(join(into, rel, 'node_modules'))) symlinkSync(modules, join(into, rel, 'node_modules'), 'dir')
  }
  if (!existsSync(join(into, cwd))) throw new Refusal(`tests.ac.cwd (${cwd}) isn't in the tree at ${sha.slice(0, 12)}.`)
}

async function runTests(ctx, { dir, config, tests, providers = [] }) {
  const ac = config.tests.ac
  const cwd = join(dir, ac.cwd ?? '.')
  const files = tests.map((t) => relative(cwd, join(dir, t)).split('\\').join('/'))
  const reportFiles = () => [ ...new Set([ ...walk(cwd).filter((f) => matchesAny(f, config.evidence.reports)).map((f) => join(cwd, f)), ...walk(dir).filter((f) => matchesAny(f, config.evidence.reports)).map((f) => join(dir, f)) ]) ]
  // Reports from an earlier run (or committed ones) mustn't count.
  for (const f of reportFiles()) rmSync(f, { force: true })
  // Evidence providers may adjust the run (Playwright video, say); only at head.
  let run = [ ...ac.run, ...files ]
  let env = { ...ctx.env, CI: '1' }
  for (const p of providers) ({ run = run, env = env } = (await p.headRun({ run, env, cwd, config })) ?? {})
  const result = await ctx.exec(run, { cwd, timeout: ac.timeout, env })
  // Reports are looked for from the test folder and from the repo root.
  const cases = reportFiles().flatMap((f) => parseJUnit(readFileSync(f, 'utf8')))
  return { code: result.code, output: `${result.stdout}\n${result.stderr}`, cases }
}

// The test ids the slice's contract adds: those base doesn't mention, quoted.
export async function newTestIds(ctx, { base, testIds, top }) {
  const fresh = []
  for (const id of testIds) {
    const quoted = [ `"${id}"`, `'${id}'`, `\`${id}\`` ].flatMap((q) => [ '-e', q ])
    if (!(await gitTest(ctx, [ 'grep', '-q', '-F', ...quoted, base, '--', '.' ], { cwd: top }))) fresh.push(id)
  }
  return fresh
}

// Which frozen file a case came from, matching whole path segments (Playwright's
// classname is relative to its test folder).
const samePath = (a, b) => { a = normalize(a); b = normalize(b); return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) }
const caseFile = (c, tests) => tests.find((t) => c.file && samePath(c.file, t)) ?? tests.find((t) => samePath(c.name, t)) ?? null

// Runs the frozen tests at base (and, unless `baseOnly`, at head).
export async function acGate(ctx, { base, head, tests, testsCommit, owned, testIds, acs, config, baseOnly = false, providers = [], evidenceDir = null, slice = null }) {
  const top = await git(ctx, [ 'rev-parse', '--show-toplevel' ], 'Finding the repo root')
  const out = { base: [], head: [], problems: [], evidence: [] }
  const recording = providers.filter((p) => p.headRun)
  const ids = await newTestIds(ctx, { base, testIds, top })
  const work = mkdtempSync(join(tmpdir(), 'ffg-'))
  try {
    for (const [ side, sha ] of baseOnly ? [ [ 'base', base ] ] : [ [ 'base', base ], [ 'head', head ] ]) {
      const dir = join(work, side === 'base' ? 'a' : 'b')
      await exportAt(ctx, { sha, into: dir, top, tests, testsCommit, cwd: config.tests.ac.cwd ?? '.' })
      if (side === 'head') {
        const run = await runTests(ctx, { dir, config, tests, providers: recording })
        // Providers that recorded the head run collect from its checkout before it goes.
        for (const p of recording) {
          const into = join(evidenceDir, p.name.replace(/[^\w.-]/g, '-'))
          mkdirSync(into, { recursive: true })
          out.evidence.push({ name: p.name, ...(await p.collect({ ctx, slice, base, head, config, top, cwd: join(dir, config.tests.ac.cwd ?? '.'), out: into })) })
        }
        if (!run.cases.length) { out.problems.push(`At head (${sha.slice(0, 12)}) the AC tests wrote no report matching evidence.reports (${config.evidence.reports.join(', ')}); the runner exited with code ${run.code}: ${run.output.trim().split('\n').slice(-3).join(' / ')}`); continue }
        if (run.code !== 0) out.problems.push(`At head the test runner exited with code ${run.code}: ${run.output.trim().split('\n').slice(-3).join(' / ')}`)
        for (const c of run.cases) {
          out.head.push({ name: c.name, file: caseFile(c, tests), outcome: c.outcome })
          if (c.outcome !== 'passed') out.problems.push(`At head, "${c.name}" ${c.outcome === 'skipped' ? 'is skipped' : `fails: ${failureMessage(c.text).split('\n')[0].slice(0, 200)}`}.`)
        }
        const passing = out.head.filter((c) => c.outcome === 'passed')
        for (const t of tests) if (!passing.some((c) => c.file === t)) out.problems.push(`At head, ${t} has no passing test: every frozen file must run and pass.`)
        for (const ac of acs) if (!passing.some((c) => new RegExp(`\\b${ac}\\b`).test(`${c.name} ${c.file ?? ''}`))) out.problems.push(`At head, no passing test covers ${ac}.`)
        continue
      }
      // Test ids a locator passes through on the way to a new one must exist at base.
      const seen = new Map()
      const knownAt = async (list) => {
        for (const id of list) if (!seen.has(id)) seen.set(id, (await newTestIds(ctx, { base, testIds: [ id ], top })).length === 0)
        return list.filter((id) => seen.get(id))
      }
      // At base each file runs alone, so one file that can't load (some runners
      // then report nothing at all) doesn't hide the others.
      for (const t of tests) {
        const run = await runTests(ctx, { dir, config, tests: [ t ] })
        const cases = run.cases.length ? run.cases : [ { name: t, file: t, outcome: 'failed', type: '', text: run.output.trim() || `the runner exited with code ${run.code} and wrote no report` } ]
        for (const c of cases) {
          if (c.outcome === 'passed') {
            out.base.push({ name: c.name, kind: 'passed', ok: false })
            out.problems.push(`At base, "${c.name}" already passes, so it doesn't test what the slice builds.`)
          } else if (c.outcome === 'skipped') {
            out.base.push({ name: c.name, kind: 'skipped', ok: false })
            out.problems.push(`At base, "${c.name}" is skipped; an AC test runs.`)
          } else {
            const why = classify(c.text, { owned, testIds: ids, known: await knownAt(waitedIds(failureMessage(c.text)).filter((id) => !ids.includes(id))) }, c.type)
            out.base.push({ name: c.name, file: t, ...why })
            if (!why.ok) out.problems.push(`At base, "${c.name}" ${why.why}.`)
          }
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return { ok: !out.problems.length, ...out, newTestIds: ids }
}
