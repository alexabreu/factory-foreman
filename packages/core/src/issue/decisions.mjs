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
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/
export function tableRows(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.replace(/\s+$/, ''))
  return lines.filter((l, i) => /^\|/.test(l) && !SEPARATOR.test(l) && !SEPARATOR.test(lines[i + 1] ?? ''))
}

export const decisionsBody = (rows) => `# Decisions\n\n${HEADER}\n${rows.join('\n')}\n`

// Adds rows to the Decisions artifact; returns how many it holds.
export async function writeDecisions(github, n, rows, { body = '' } = {}) {
  const fresh = rows.map(decisionRow)
  // Rows a body table from before this artifact existed still holds.
  const legacy = tableRows(getSection(body, 'decisions'))
  const named = async () => (await github.artifacts(n)).filter((a) => a.name === DECISIONS).map((a) => a.number).sort((a, b) => a - b)
  let numbers = await named()
  if (!numbers.length) {
    if (!fresh.length && !legacy.length) return 0
    await github.createArtifact(n, DECISIONS, decisionsBody([ ...new Set([ ...legacy, ...fresh ]) ]), 'app')
    // Two writers may each have created one: the first is the one, and the other's rows join it.
    numbers = await named()
  }
  const number = numbers[0]
  for (let i = 0; ; i++) {
    const versions = (await github.history(n, number)).versions
    const all = []
    for (const k of numbers) {
      const vs = k === number ? versions : (await github.history(n, k)).versions
      for (const v of vs.filter((v) => byBot(v, github.botLogin))) for (const r of tableRows(v.body)) if (!all.includes(r)) all.push(r)
    }
    for (const r of [ ...legacy, ...fresh ]) if (!all.includes(r)) all.push(r)
    const latest = tableRows(versions.at(-1)?.body)
    if (all.every((r) => latest.includes(r))) return all.length
    if (i === 3) throw new Refusal(`The ${DECISIONS} artifact on #${n} kept changing, so the new decisions aren't in it. Run the command again.`)
    await github.editArtifact(n, number, decisionsBody(all), 'app')
  }
}
