#!/usr/bin/env node
// Runs persona evals: each case's task, inputs and the persona's instructions go to
// a harness (Claude Code or Codex) N times; each reply is scored against the case's
// weighted checklist. Results are written as JSON so two variants (the persona as it
// is, and a candidate change) can be compared on the same cases.
//
//   node evals/run.mjs --persona code-reviewer [--cases <dir>] [--agent <file>]
//                      [--harness claude|codex] [--model <id>] [--runs 3]
//                      [--label baseline] [--out <dir>]
//   node evals/run.mjs --persona code-reviewer --lenses a.md,b.md,c.md --verifier v.md ...
//
// With --lenses, each run sends the case to every lens in parallel, then their
// findings to the verifier; only findings the verifier doesn't reject are graded.
// Every run records seconds and tokens (Claude's usage, Codex's "tokens used").
// A run whose harness fails is recorded as an error and left out of the scores,
// never counted as a failed check.
//
// --cases defaults to evals/cases (synthetic cases, public). Cases built from
// private repositories live outside this package and are passed with --cases.
// Nothing in a case is executed; the model only reads it.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { excerpts } from './lib/excerpts.mjs'
import { findingsFrom } from './lib/findings.mjs'
import { grade, summarize } from './lib/grade.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const meanUsage = (us) => (us.length && us.every(Boolean) ? Object.fromEntries(Object.keys(us[0]).map((k) => [ k, us.reduce((t, u) => t + u[k], 0) / us.length ])) : null)
const mean = (xs) => (xs.length && xs.every((x) => typeof x === 'number') ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function parseArgs(argv) {
  const out = { cases: join(here, 'cases'), harness: 'claude', runs: 3, label: 'baseline', out: join(here, 'results') }
  const known = [ 'persona', 'cases', 'agent', 'harness', 'model', 'runs', 'label', 'out', 'lenses', 'verifier' ]
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    // An unknown flag (or several flags passed as one argument) would otherwise eat
    // the next flag as its value and run the wrong variant under a default label.
    if (!known.includes(key)) throw new Error(`Unknown option ${argv[i]}`)
    out[key] = argv[++i]
  }
  if (out.lenses && !out.verifier) throw new Error('--lenses needs --verifier')
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
  if (harness === 'claude') return [ 'claude', '-p', '--output-format', 'json', ...(model ? [ '--model', model ] : []) ]
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolveRun({ code, ...reply(stdout, stderr), stderr: stderr.trim() || `exit ${code ?? signal}${stdout.trim() ? `: ${stdout.trim().slice(-200)}` : ''}`, ms: Date.now() - started }) })
    child.stdin.end(input)
  })
}

// The reply text and its token count. Claude's JSON output carries the result and
// its usage; Codex prints "tokens used" and the count on stderr.
export function reply(stdout, stderr = '') {
  try {
    const j = JSON.parse(stdout)
    if (j && typeof j.result === 'string') {
      const u = j.usage ?? {}
      const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0 }
      const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheCreation
      return { stdout: j.result, tokens: tokens || null, usage, costUsd: j.total_cost_usd ?? null }
    }
  } catch { /* plain text */ }
  const m = /tokens used\s*:?\s*([\d,]+)/iu.exec(`${stderr}\n${stdout}`)
  return { stdout, tokens: m ? Number(m[1].replace(/,/gu, '')) : null, costUsd: null }
}

// What the verifier is told about its input and output in an eval.
export const VERIFY = 'Reply with only a JSON array: every finding you received, each with "id", "severity" (blocking|major|minor), "text", "where", "outcome" (verified|suspected|rejected|merged), "reason", "into" for a merged one, and "ask" (kept from the lens, or added when lenses disagree) when the person needs to decide. Add any "Found while verifying" entries.'

// The verifier's brief: the task, every input that isn't a diff (the change
// description and criteria), and only the diff lines around each finding, not
// the whole diff. It reads further only when that doesn't settle a finding.
export function verifierPrompt(verifierText, scenario, readInput, findings) {
  const instructions = verifierText.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  const inputs = scenario.inputs.map((f) => {
    const text = readInput(f)
    return /\.(diff|patch)$/u.test(f) ? `<excerpts from="${f}">\n${excerpts(text, findings)}\n</excerpts>` : `<file path="${f}">\n${text}\n</file>`
  }).join('\n\n')
  return `${instructions}\n\n# Task\n\n${scenario.task}\n\n${inputs}\n\n# Findings to verify\n\n${JSON.stringify(findings, null, 2)}\n\n${VERIFY}\n`
}

// One pipeline run: every lens in parallel, then the verifier. Returns the kept
// findings as the graded output, and what each step cost.
async function pipelineRun(opts, lensTexts, verifierText, scenario, readInput) {
  const argv = command(opts.harness, opts.model)
  const lensRuns = await Promise.all(lensTexts.map(({ name, text }) => ask(argv, prompt(text, scenario, readInput)).then((r) => ({ name, ...r }))))
  const failed = lensRuns.find((r) => r.code !== 0)
  if (failed) return { error: `${failed.name}: ${failed.stderr.trim().split('\n').at(-1)}`, lensRuns }
  const findings = lensRuns.flatMap(({ name, stdout }) => (findingsFrom(stdout) ?? []).map((f) => ({ ...f, id: `${name}/${f.id ?? 'finding'}` })))
  const v = findings.length ? await ask(argv, verifierPrompt(verifierText, scenario, readInput, findings)) : { code: 0, stdout: '[]', tokens: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, ms: 0 }
  if (v.code !== 0) return { error: `verifier: ${v.stderr.trim().split('\n').at(-1)}`, lensRuns }
  const judged = findingsFrom(v.stdout) ?? []
  // Rejected and merged findings stay in the record but aren't graded: a merged one
  // lives on in the finding it was merged into.
  const kept = judged.filter((f) => f.outcome !== 'rejected' && f.outcome !== 'merged')
  const sum = (k) => [ ...lensRuns, v ].reduce((t, r) => (t === null || r[k] == null ? null : t + r[k]), 0)
  const usage = [ ...lensRuns, v ].reduce((t, r) => (t && r.usage ? Object.fromEntries(Object.entries(t).map(([ k, x ]) => [ k, x + r.usage[k] ])) : null), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
  return {
    output: JSON.stringify(kept),
    ms: Math.max(...lensRuns.map((r) => r.ms)) + v.ms,
    tokens: sum('tokens'),
    usage,
    costUsd: sum('costUsd'),
    calls: lensRuns.length + (findings.length ? 1 : 0),
    lensFindings: findings.length,
    rejected: judged.filter((f) => f.outcome === 'rejected').length,
    merged: judged.filter((f) => f.outcome === 'merged').length,
    unanswered: Math.max(0, findings.length - judged.filter((f) => !/^found while verifying/iu.test(f.text ?? '')).length),
    asks: kept.filter((f) => f.ask).length,
    steps: [ ...lensRuns.map((r) => ({ name: r.name, ms: r.ms, tokens: r.tokens, usage: r.usage, costUsd: r.costUsd, output: r.stdout })), { name: 'verifier', ms: v.ms, tokens: v.tokens, usage: v.usage, costUsd: v.costUsd, output: v.stdout } ],
  }
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
    const scored = c.runs.filter((r) => !r.error && r.output !== undefined)
    for (const r of scored) Object.assign(r, grade(reply(r.output).stdout, criteria))
    Object.assign(c, summarize(scored.map((r) => r.score)))
  }
  report.overall = summarize(Object.values(report.cases).flatMap((c) => c.runs.filter((r) => !r.error && r.output !== undefined).map((r) => r.score)))
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
  const lensTexts = opts.lenses ? opts.lenses.split(',').map((f) => ({ name: f.split('/').at(-1).replace(/\.agent\.md$/u, ''), text: readFileSync(f, 'utf8') })) : null
  const verifierText = lensTexts ? readFileSync(opts.verifier, 'utf8') : null
  const report = { label: opts.label, persona: opts.persona, harness: opts.harness, model: opts.model ?? 'default', runs: opts.runs, at: new Date().toISOString(), ...(lensTexts ? { lenses: lensTexts.map((l) => l.name), verifier: opts.verifier } : {}), cases: {} }
  for (const id of readdirSync(dir).sort()) {
    const caseDir = join(dir, id)
    const { scenario, criteria } = await loadCase(caseDir, resolve(opts.cases))
    const readInput = (f) => readFileSync(join(caseDir, f), 'utf8')
    const text = prompt(agentText, scenario, readInput)
    const runs = []
    for (let k = 1; k <= opts.runs; k++) {
      let run
      if (lensTexts) {
        const p = await pipelineRun(opts, lensTexts, verifierText, scenario, readInput)
        run = p.error ? { k, error: p.error } : { k, ms: p.ms, tokens: p.tokens, usage: p.usage, costUsd: p.costUsd, calls: p.calls, lensFindings: p.lensFindings, rejected: p.rejected, merged: p.merged, unanswered: p.unanswered, asks: p.asks, ...grade(p.output, criteria), output: p.output, steps: p.steps }
      } else {
        const r = await ask(command(opts.harness, opts.model), text)
        run = r.code === 0 ? { k, ms: r.ms, tokens: r.tokens, usage: r.usage, costUsd: r.costUsd, calls: 1, ...grade(r.stdout, criteria), output: r.stdout } : { k, ms: r.ms, error: r.stderr.trim().split('\n').at(-1) }
      }
      runs.push(run)
      console.log(`${id} run ${k}: ${run.error ? `error (${run.error})` : `${(run.score * 100).toFixed(0)}%, ${(run.ms / 1000).toFixed(0)} s, ${run.tokens ?? '?'} tokens`}`)
    }
    const scored = runs.filter((r) => !r.error)
    report.cases[id] = { ...summarize(scored.map((r) => r.score)), errors: runs.length - scored.length, tokens: mean(scored.map((r) => r.tokens)), seconds: mean(scored.map((r) => r.ms / 1000)), costUsd: mean(scored.map((r) => r.costUsd)), usage: meanUsage(scored.map((r) => r.usage)), skipped: (await loadCase(caseDir, resolve(opts.cases))).skipped, runs }
  }
  const all = Object.values(report.cases).flatMap((c) => c.runs.filter((r) => !r.error).map((r) => r.score))
  const cs = Object.values(report.cases)
  report.overall = { ...summarize(all), tokens: mean(cs.map((c) => c.tokens)), seconds: mean(cs.map((c) => c.seconds)), costUsd: mean(cs.map((c) => c.costUsd)), usage: meanUsage(cs.map((c) => c.usage)) }
  mkdirSync(opts.out, { recursive: true })
  const file = join(opts.out, `${opts.persona}-${opts.label}-${report.at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Overall ${(report.overall.mean * 100).toFixed(1)}% ± ${(report.overall.sd * 100).toFixed(1)} over ${all.length} run(s), ${report.overall.seconds?.toFixed(0) ?? '?'} s and ${report.overall.tokens?.toFixed(0) ?? '?'} tokens per run. ${file}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1 })
}
