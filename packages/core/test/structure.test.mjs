import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config/load.mjs'
import { checkStructure, countWords, parseDraft, splitFrontMatter, withFrontMatter } from '../src/steps/structure.mjs'

export const SHAPE = `---
step: shape
base: 0
---
Readers lose track of what they've read. Let them mark a book read and filter the list.

## Problem
The list mixes read and unread books.

## Who it's for
Anyone keeping a reading list.

## Out of scope
Syncing between devices.

## Acceptance criteria
| ID | Criterion | Visual |
| --- | --- | --- |
| AC-1 | A book can be marked read | yes |
| AC-2 | The list can show only unread books | no |
`

export const DESIGN = `---
step: design
base: 0
---
A checkbox per row and a filter select, both driven by the list's pure functions.

## Approach
Keep state in reading-list.ts.

## Contracts
\`\`\`contract
{ "name": "toggle", "testIds": ["item-toggle"], "files": ["src/reading-list.ts"] }
\`\`\`

## Visual behaviors
- AC-1: the row's checkbox shows checked.

## Slices
1. Toggle read (AC-1)
   files: src/reading-list.ts, src/main.ts
2. Filter (AC-2)
`

test('front matter round-trips, with numbers parsed', () => {
  const { meta, body } = splitFrontMatter(SHAPE)
  assert.deepEqual(meta, { step: 'shape', base: 0 })
  assert.equal(splitFrontMatter(withFrontMatter(meta, body)).body, body)
})

test('parses a Shape: lead, sections and acceptance criteria', () => {
  const shape = parseDraft(SHAPE)
  assert.match(shape.lead, /^Readers lose track/)
  assert.deepEqual(shape.sections, [ 'Problem', "Who it's for", 'Out of scope', 'Acceptance criteria' ])
  assert.deepEqual(shape.criteria, [
    { id: 'AC-1', criterion: 'A book can be marked read', visual: true },
    { id: 'AC-2', criterion: 'The list can show only unread books', visual: false },
  ])
  assert.deepEqual(checkStructure('shape', shape, { budgets: DEFAULTS.budgets }), [])
})

test('parses a Design: contracts, visual behaviors and slices', () => {
  const design = parseDraft(DESIGN)
  assert.deepEqual(design.contracts, [ { value: { name: 'toggle', testIds: [ 'item-toggle' ], files: [ 'src/reading-list.ts' ] } } ])
  assert.deepEqual(design.visualBehaviors, [ { id: 'AC-1', text: "the row's checkbox shows checked." } ])
  assert.deepEqual(design.slices, [
    { n: 1, title: 'Toggle read', acs: [ 'AC-1' ], files: [ 'src/reading-list.ts', 'src/main.ts' ] },
    { n: 2, title: 'Filter', acs: [ 'AC-2' ], files: [] },
  ])
  assert.deepEqual(checkStructure('design', design, { budgets: DEFAULTS.budgets, shape: parseDraft(SHAPE) }), [])
})

test('headings inside code blocks are not sections', () => {
  const draft = parseDraft('Lead.\n\n## Approach\n```\n## Not a section\n```\n')
  assert.deepEqual(draft.sections, [ 'Approach' ])
})

test('counts words a reader reads, not code or table borders', () => {
  assert.equal(countWords('One two.\n| a | b |\n| --- | --- |\n```\nignored words here\n```\nthree'), 5)
})

test('refuses a Shape that is over budget, missing sections or rows', () => {
  const problems = checkStructure('shape', parseDraft('---\nstep: shape\n---\n## Problem\nx\n'), { budgets: DEFAULTS.budgets })
  assert.ok(problems.includes('Start with a lead paragraph before the first section.'))
  assert.ok(problems.includes('Missing the "## Acceptance criteria" section.'))
  assert.ok(problems.some((p) => p.startsWith('Acceptance criteria needs at least one row')))
  const long = parseDraft(SHAPE.replace('Readers lose', `${'word '.repeat(120)}Readers lose`))
  assert.ok(checkStructure('shape', long, { budgets: DEFAULTS.budgets }).some((p) => /^The lead is \d+ words; the budget is 100\.$/.test(p)))
})

test('refuses duplicate AC ids', () => {
  const dup = parseDraft(SHAPE.replace('| AC-2 |', '| AC-1 |'))
  assert.ok(checkStructure('shape', dup, { budgets: DEFAULTS.budgets }).includes('AC-1 appears twice.'))
})

test('cross-checks a Design against the approved Shape', () => {
  const shape = parseDraft(SHAPE)
  const design = parseDraft(DESIGN.replace('2. Filter (AC-2)', '2. Filter (AC-1, AC-3)').replace('- AC-1: the row', '- AC-4: the row'))
  const problems = checkStructure('design', design, { budgets: DEFAULTS.budgets, shape })
  assert.ok(problems.includes('Slice 2 names AC-3, which the approved Shape doesn\'t have.'))
  assert.ok(problems.includes('No slice owns AC-2.'))
  assert.ok(problems.includes('AC-1 is owned by slices 1 and 2; give it to one.'))
  assert.ok(problems.includes('AC-1 is visual: add "- AC-1: what a reviewer sees" under Visual behaviors.'))
  assert.ok(problems.includes('Visual behaviors names AC-4, which the approved Shape doesn\'t have.'))
})

test('refuses a contract that is not JSON or lacks names and test ids', () => {
  const design = parseDraft(DESIGN.replace('{ "name": "toggle", "testIds": ["item-toggle"], "files": ["src/reading-list.ts"] }', '{ "name": "toggle" }\n```\n```contract\n{ nope'))
  const problems = checkStructure('design', design, { budgets: DEFAULTS.budgets })
  assert.ok(problems.includes('Contract 1 needs a "name" and a non-empty "testIds" list.'))
  assert.ok(problems.some((p) => p.startsWith('Contract 2 isn\'t valid JSON')))
})

test('the unedited skeletons, empty sections and empty contracts are refused', () => {
  const empty = parseDraft('---\nstep: shape\nbase: 0\n---\nLead.\n\n## Problem\n\n## Who it\'s for\n\n## Out of scope\n\n## Acceptance criteria\n| ID | Criterion | Visual |\n| --- | --- | --- |\n| AC-1 |  |  |\n')
  const problems = checkStructure('shape', empty, { budgets: DEFAULTS.budgets })
  assert.ok(problems.includes('The "## Problem" section is empty.'))
  assert.ok(problems.includes('AC-1 has no criterion.'))
  const contract = parseDraft(DESIGN.replace('{ "name": "toggle", "testIds": ["item-toggle"], "files": ["src/reading-list.ts"] }', '{ "name": "", "testIds": [], "files": [] }'))
  assert.ok(checkStructure('design', contract, { budgets: DEFAULTS.budgets }).includes('Contract 1 needs a "name" and a non-empty "testIds" list.'))
})

test('comments, tilde fences and fenced tables are not structure', () => {
  const sneaky = parseDraft(`${SHAPE}\n<!--\n## Hidden\n-->\n~~~\n## Also hidden\n| AC-9 | fenced | no |\n~~~\n\`\`\`\n| AC-8 | fenced | no |\n\`\`\`\n`)
  assert.ok(!sneaky.sections.includes('Hidden') && !sneaky.sections.includes('Also hidden'))
  assert.deepEqual(sneaky.criteria.map((c) => c.id), [ 'AC-1', 'AC-2' ])
})

test('a draft carrying issue-body markers is refused', () => {
  const marked = parseDraft(SHAPE.replace('Syncing between devices.', 'Syncing. <!-- factory-foreman:decisions --> x'))
  assert.ok(checkStructure('shape', marked, { budgets: DEFAULTS.budgets }).some((p) => p.includes('"factory-foreman:" markers')))
})

test('fences with info strings, longer fences and tildes hide their contents', () => {
  for (const [ open, close ] of [ [ '``` text', '```' ], [ '```c++', '```' ], [ '````', '````' ], [ '~~~~', '~~~~' ] ]) {
    const draft = parseDraft(`Lead.\n\n## Approach\nx\n${open}\n## Problem\n| AC-1 | hidden | no |\n\`\`\`\nstill inside\n${close}\n`)
    assert.ok(!draft.sections.includes('Problem'), open)
  }
})

test('a draft that ends inside a code block is refused', () => {
  const problems = checkStructure('shape', parseDraft(`${SHAPE}\nExample:\n\`\`\`\nGET /books?unread=1\n`), { budgets: DEFAULTS.budgets })
  assert.ok(problems.some((p) => /never closed/.test(p)), problems.join('\n'))
})
