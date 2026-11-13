#!/usr/bin/env node
// Calibrates the rubric judge on stored replies: for each case, every stored
// reply (from any variant and engine) is shuffled, labelled R1..Rn, and judged in
// batches against the case's recall lines. The judge's verdict is compared with
// the stored regex verdict, split by the engine that wrote the reply, and every
// disagreement is written out to be read by hand.
//
//   node evals/calibrate.mjs --cases <dir> --judge claude|codex --out <file> <result.json>...
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isRecall, judgePrompt, verdicts } from './lib/judge.mjs'
import { askHarness, loadCase, reply } from './run.mjs'

const BATCH = 6

function shuffle(xs, seed = 7) {
  const a = [ ...xs ]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [ a[i], a[j] ] = [ a[j], a[i] ] }
  return a
}

export async function calibrate({ files, cases, judge, model }) {
  const byCase = new Map()
  for (const file of files) {
    const report = JSON.parse(readFileSync(file, 'utf8'))
    for (const [ id, c ] of Object.entries(report.cases)) {
      for (const run of c.runs) {
        if (run.error || run.output === undefined || run.steps) continue
        const key = `${report.persona}/${id}`
        if (!byCase.has(key)) byCase.set(key, [])
        byCase.get(key).push({ engine: report.harness, label: report.label, k: run.k, text: reply(run.output).stdout, results: run.results })
      }
    }
  }
  const rows = []
  let calls = 0
  let seconds = 0
  let tokens = 0
  let cost = 0
  const raw = []
  for (const [ key, all ] of byCase) {
    const caseDir = join(resolve(cases), key)
    const { scenario, criteria } = await loadCase(caseDir, resolve(cases))
    const lines = criteria.filter(isRecall).map((c) => c.text)
    if (!lines.length) continue
    const replies = shuffle(all).map((r, i) => ({ ...r, id: `R${i + 1}` }))
    for (let i = 0; i < replies.length; i += BATCH) {
      const batch = replies.slice(i, i + BATCH)
      const r = await askHarness(judge, model, judgePrompt(scenario, (f) => readFileSync(join(caseDir, f), 'utf8'), lines, batch))
      calls++; seconds += r.ms / 1000; tokens += r.tokens ?? 0; cost += r.costUsd ?? 0
      raw.push({ case: key, batch: batch.map((x) => ({ id: x.id, engine: x.engine, label: x.label, k: x.k })), reply: r.stdout })
      if (r.code !== 0) { console.log(`${key} batch ${i / BATCH + 1}: judge error (${r.stderr})`); continue }
      const v = verdicts(r.stdout, batch, lines.length)
      for (const rep of batch) {
        lines.forEach((line, n) => {
          const regex = rep.results?.find((x) => x.text === line)
          if (!regex) return
          rows.push({ case: key, line, engine: rep.engine, label: rep.label, k: rep.k, regex: regex.passed, judge: v[rep.id][n].pass, why: v[rep.id][n].why, quote: v[rep.id][n].quote, regexEvidence: regex.evidence, reply: rep.text })
        })
      }
      console.log(`${key} batch ${i / BATCH + 1}: ${batch.length} replies judged`)
    }
  }
  const split = (engine) => {
    const r = rows.filter((x) => !engine || x.engine === engine)
    const agree = r.filter((x) => x.regex === x.judge).length
    return { verdicts: r.length, agree, rate: r.length ? agree / r.length : null, judgeOnly: r.filter((x) => x.judge && !x.regex).length, regexOnly: r.filter((x) => x.regex && !x.judge).length }
  }
  return { judge, model: model ?? 'default', at: new Date().toISOString(), calls, seconds, tokens, costUsd: cost, overall: split(), claude: split('claude'), codex: split('codex'), disagreements: rows.filter((x) => x.regex !== x.judge), rows, raw }
}

async function main(argv) {
  const opts = { judge: 'claude', files: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]
    else opts.files.push(argv[i])
  }
  const out = await calibrate(opts)
  writeFileSync(opts.out, `${JSON.stringify(out, null, 2)}\n`)
  for (const k of [ 'overall', 'claude', 'codex' ]) console.log(`${k}: ${out[k].agree}/${out[k].verdicts} agree (${((out[k].rate ?? 0) * 100).toFixed(1)}%), judge-only passes ${out[k].judgeOnly}, regex-only passes ${out[k].regexOnly}`)
  console.log(`${out.calls} judge calls, ${out.seconds.toFixed(0)} s, ${out.tokens} tokens. ${opts.out}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1 })
