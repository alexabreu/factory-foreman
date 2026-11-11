// Decisions live in one place: a "Decisions" artifact on the issue, a table the
// App writes, a new version at each checkpoint and approval, so GitHub keeps
// its history. The issue body only says how many there are and where.
//
// Another checkpoint or approval may write at the same moment, and either
// write could drop the other's rows. So each write holds every row any
// App-written version has held, plus ours, and is checked again, as the
// Changelog is. A table left in the issue body by an older version of
// factory-foreman is carried into the artifact the first time it's written.
import { Refusal } from '../errors.mjs'
import { byBot } from './records.mjs'
import { cell, getSection } from './sections.mjs'

export const DECISIONS = 'Decisions'
const HEADER = '| Date | Decision | By | Step |\n| --- | --- | --- | --- |'

export const decisionRow = (r) => `| ${cell(r.date)} | ${cell(r.text)} | ${cell(r.by)} | ${cell(r.step ?? '')} |`

// Table rows (not the header or its rule) in a text, in order.
// A table's header is the row right before its separator (|---|, |:--|, |--:|).
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?$/
export function tableRows(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.replace(/\s+$/, ''))
  return lines.filter((l, i) => /^\|/.test(l) && !SEPARATOR.test(l) && !SEPARATOR.test(lines[i + 1] ?? ''))
}

export const decisionsBody = (rows) => `# Decisions\n\n${HEADER}\n${rows.join('\n')}\n`

// The decision a row records, so a row written again on another day or step
// (a retry after a write that partly landed) isn't a second decision.
const textOf = (row) => row.split(/(?<!\\)\|/)[2]?.trim() ?? row

// Adds rows to the Decisions artifact; returns how many it holds.
export async function writeDecisions(github, n, rows, { body = '' } = {}) {
  const fresh = rows.map(decisionRow)
  // Rows a body table from before this artifact existed still holds.
  const legacy = tableRows(getSection(body, 'decisions'))
  const named = async () => (await github.artifacts(n)).filter((a) => a.name === DECISIONS).map((a) => a.number).sort((a, b) => a - b)
  let numbers = await named()
  if (!numbers.length) {
    if (!fresh.length && !legacy.length) return 0
    const created = await github.createArtifact(n, DECISIONS, decisionsBody([ ...new Set([ ...legacy, ...fresh ]) ]), 'app')
    // Two writers may each have created one: the first is the one, and the
    // other's rows join it. A listing that doesn't show ours yet still has it.
    numbers = [ ...new Set([ ...await named(), created ]) ].filter((k) => k != null).sort((a, b) => a - b)
  }
  const number = numbers[0]
  // Another writer's duplicate artifact only gains rows while it's being created; read it once.
  const others = []
  for (const k of numbers.slice(1)) others.push(...(await github.history(n, k)).versions)
  for (let i = 0; ; i++) {
    const versions = (await github.history(n, number)).versions
    const all = []
    const seen = new Set()
    const add = (r) => { const t = textOf(r); if (!seen.has(t)) { seen.add(t); all.push(r) } }
    for (const v of [ ...versions, ...others ].filter((v) => byBot(v, github.botLogin))) tableRows(v.body).forEach(add)
    for (const r of [ ...legacy, ...fresh ]) add(r)
    const latest = new Set(tableRows(versions.at(-1)?.body).map(textOf))
    if (all.every((r) => latest.has(textOf(r)))) return all.length
    if (i === 3) throw new Refusal(`The ${DECISIONS} artifact on #${n} kept changing, so the new decisions aren't in it. Run the command again.`)
    await github.editArtifact(n, number, decisionsBody(all), 'app')
  }
}
