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
export const tableRows = (text) => String(text ?? '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => /^\|/.test(l) && !/^\|\s*Date\s*\|/.test(l) && !/^\|\s*-{3,}/.test(l))

export const decisionsBody = (rows) => `# Decisions\n\n${HEADER}\n${rows.join('\n')}\n`

// The issue body's line pointing at the artifact.
export const decisionsLine = (count) => `## Decisions\n\n${count} decision${count === 1 ? '' : 's'} so far: see the ${DECISIONS} artifact on this issue.`

// Adds rows to the Decisions artifact; returns how many it holds.
export async function writeDecisions(github, n, rows, { body = '' } = {}) {
  const fresh = rows.map(decisionRow)
  // Rows a body table from before this artifact existed still holds.
  const legacy = tableRows(getSection(body, 'decisions'))
  const artifacts = await github.artifacts(n)
  let number = artifacts.filter((a) => a.name === DECISIONS).sort((a, b) => a.number - b.number)[0]?.number
  if (!number) {
    if (!fresh.length && !legacy.length) return 0
    number = await github.createArtifact(n, DECISIONS, decisionsBody([ ...new Set([ ...legacy, ...fresh ]) ]), 'app')
  }
  for (let i = 0; ; i++) {
    const versions = (await github.history(n, number)).versions
    const all = []
    for (const v of versions.filter((v) => byBot(v, github.botLogin))) for (const r of tableRows(v.body)) if (!all.includes(r)) all.push(r)
    for (const r of [ ...legacy, ...fresh ]) if (!all.includes(r)) all.push(r)
    const latest = tableRows(versions.at(-1)?.body)
    if (all.every((r) => latest.includes(r))) return all.length
    if (i === 3) throw new Refusal(`The ${DECISIONS} artifact on #${n} kept changing, so the new decisions aren't in it. Run the command again.`)
    await github.editArtifact(n, number, decisionsBody(all), 'app')
  }
}
