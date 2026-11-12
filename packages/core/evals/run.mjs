#!/usr/bin/env node
// Runs persona evals: each case's task, inputs and the persona's instructions go to
// a harness (Claude Code or Codex) N times; each reply is scored against the case's
// weighted checklist. Results are written as JSON so two variants (the persona as it
// is, and a candidate change) can be compared on the same cases.
//
//   node evals/run.mjs --persona code-reviewer [--cases <dir>] [--agent <file>]
//                      [--harness claude|codex] [--model <id>] [--runs 3]
//                      [--label baseline] [--out <dir>]
//
// --cases defaults to evals/cases (synthetic cases, public). Cases built from
// private repositories live outside this package and are passed with --cases.
// Nothing in a case is executed; the model only reads it.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findingsFrom } from './lib/findings.mjs'
import { grade, summarize } from './lib/grade.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export function parseArgs(argv) {
  const out = { cases: join(here, 'cases'), harness: 'claude', runs: 3, label: 'baseline', out: join(here, 'results') }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    out[key] = argv[++i]
  }
  out.runs = Number(out.runs)
  if (!out.persona) throw new Error('Name the persona: --persona <name>')
  out.agent ??= join(here, '..', 'apm', '.apm', 'agents', `${out.persona}.agent.md`)
  return out
}

// The persona's instructions without the front matter, then the task and inputs.
export function prompt(agentText, scenario, readInput) {
  const instructions = agentText.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  const inputs = scenario.inputs.map((f) => `<file path="${f}">\n${readInput(f)}\n</file>`).join('\n\n')
  return `${instructions}\n\n# Task\n\n${scenario.task}\n\n${inputs}\n\n${OUTPUT}\n`
}

// The same output contract the real slice-review brief gives (src/commands/slice.mjs),
// so evals measure the persona under the conditions it runs in.
export const OUTPUT = 'Reply with only a JSON array of findings: [{ "id": "<short-id>", "severity": "blocking|major|minor", "text": "…", "where": "<file:line>" }]. Reply [] when there is nothing to fix.'

export function command(harness, model) {
  if (harness === 'claude') return [ 'claude', '-p', '--output-format', 'text', ...(model ? [ '--model', model ] : []) ]
  if (harness === 'codex') return [ 'codex', 'exec', ...(model ? [ '-m', model ] : []), '-' ]
  throw new Error(`Unknown harness ${harness}; use claude or codex`)
}

function ask(argv, input, timeoutMs = 600_000) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    const child = spawn(argv[0], argv.slice(1), { stdio: [ 'pipe', 'pipe', 'pipe' ], env: { ...process.env, FACTORY_FOREMAN_CAPTURE: '1' } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr, ms: Date.now() - started }) })
    child.stdin.end(input)
  })
}

// Criteria from the predecessor's format that need a repository snapshot and
// tools, which these evals don't provide; they're skipped and listed in the report.
export const NEEDS_REPO = [ /deterministic tool output/iu, /change (repository|any) files/iu, /does not change/iu ]

// The reviewer personas reply with a JSON array of findings; the predecessor's
// checks expect its Markdown style (blocker/concern/nit, Why, Fix, file:line).
// This renders JSON findings that way, ahead of the original reply, so legacy
// format checks judge the same content. Replies that aren't JSON pass through.
const SEVERITY = { blocking: 'blocker', blocker: 'blocker', critical: 'blocker', high: 'blocker', major: 'concern', medium: 'concern', concern: 'concern', minor: 'nit', low: 'nit', nit: 'nit' }
export function asLegacyReview(reply) {
  const findings = findingsFrom(reply)
  if (!findings?.length) return reply
  const lines = findings.map((f) => {
    const where = f.where ?? (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '')
    const text = f.text ?? f.summary ?? f.issue ?? [ f.title, f.body ].filter(Boolean).join(': ') ?? f.description ?? ''
    return [ `- **${SEVERITY[String(f.severity ?? '').toLowerCase()] ?? 'concern'}** ${where}: ${text}`, f.why ? `  Why: ${f.why}` : '', f.fix ? `  Fix: ${f.fix}` : '' ].filter(Boolean).join('\n')
  })
  return `${lines.join('\n')}\n\n${reply}`
}

// A case in this package's format (scenario.json, criteria.mjs), or in the
// predecessor's (case.yaml, prompt.md, graders/assertions.mjs), read in place.
export async function loadCase(caseDir, casesRoot) {
  if (existsSync(join(caseDir, 'scenario.json'))) {
    return {
      scenario: JSON.parse(readFileSync(join(caseDir, 'scenario.json'), 'utf8')),
      criteria: (await import(pathToFileURL(join(caseDir, 'criteria.mjs')).href)).default,
      skipped: [],
    }
  }
  const { parseCaseFile } = await import(pathToFileURL(join(casesRoot, 'lib', 'case-file.mjs')).href)
  const meta = parseCaseFile(readFileSync(join(caseDir, 'case.yaml'), 'utf8'))
  const assertions = (await import(pathToFileURL(join(caseDir, 'graders', 'assertions.mjs')).href)).default
  const kept = assertions.filter((a) => !NEEDS_REPO.some((re) => re.test(a.text)))
  const task = `${readFileSync(join(caseDir, 'prompt.md'), 'utf8').trim()}\n\nThere is no repository checkout here: the change description and the diff are included below, so review from them.`
  return {
    scenario: { id: meta.name, persona: meta.persona, task, inputs: meta.inputs },
    criteria: kept.map((a) => ({ text: a.text, weight: 1, check: (o) => { const t = asLegacyReview(o); return a.check({ output: t, all: t, changedFiles: [] }) } })),
    skipped: assertions.filter((a) => !kept.includes(a)).map((a) => a.text),
  }
}

// Re-scores a saved report's replies against the cases' current criteria, without
// running the model again (for a corrected grader).
async function regrade(file, casesRoot) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  for (const [ id, c ] of Object.entries(report.cases)) {
    const { criteria } = await loadCase(join(resolve(casesRoot), report.persona, id), resolve(casesRoot))
    for (const r of c.runs) Object.assign(r, grade(r.output, criteria))
    Object.assign(c, summarize(c.runs.map((r) => r.score)))
  }
  report.overall = summarize(Object.values(report.cases).flatMap((c) => c.runs.map((r) => r.score)))
  report.regradedAt = new Date().toISOString()
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${report.label}: ${(report.overall.mean * 100).toFixed(1)}% ± ${(report.overall.sd * 100).toFixed(1)} after regrading`)
}

async function main(argv) {
  if (argv[0] === '--regrade') return regrade(argv[1], argv[3] ?? join(here, 'cases'))
  const opts = parseArgs(argv)
  const dir = join(resolve(opts.cases), opts.persona)
  if (!existsSync(dir)) throw new Error(`No cases for ${opts.persona} in ${dir}`)
  const agentText = readFileSync(opts.agent, 'utf8')
  const report = { label: opts.label, persona: opts.persona, harness: opts.harness, model: opts.model ?? 'default', runs: opts.runs, at: new Date().toISOString(), cases: {} }
  for (const id of readdirSync(dir).sort()) {
    const caseDir = join(dir, id)
    const { scenario, criteria } = await loadCase(caseDir, resolve(opts.cases))
    const text = prompt(agentText, scenario, (f) => readFileSync(join(caseDir, f), 'utf8'))
    const runs = []
    for (let k = 1; k <= opts.runs; k++) {
      const r = await ask(command(opts.harness, opts.model), text)
      const g = r.code === 0 ? grade(r.stdout, criteria) : { score: 0, results: [], error: r.stderr.trim().split('\n').at(-1) }
      runs.push({ k, ms: r.ms, ...g, output: r.stdout })
      console.log(`${id} run ${k}: ${(g.score * 100).toFixed(0)}%${g.error ? ` (failed: ${g.error})` : ''}`)
    }
    report.cases[id] = { ...summarize(runs.map((r) => r.score)), skipped: (await loadCase(caseDir, resolve(opts.cases))).skipped, runs }
  }
  const all = Object.values(report.cases).flatMap((c) => c.runs.map((r) => r.score))
  report.overall = summarize(all)
  mkdirSync(opts.out, { recursive: true })
  const file = join(opts.out, `${opts.persona}-${opts.label}-${report.at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Overall ${(report.overall.mean * 100).toFixed(1)}% ± ${(report.overall.sd * 100).toFixed(1)} over ${all.length} run(s). ${file}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1 })
}
