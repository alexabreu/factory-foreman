// Reads a Shape or Design draft written in markdown and checks its structure.
//
// A draft is front matter, a lead paragraph, then `## ` sections:
//   Shape:  Problem, Who it's for, Out of scope, Acceptance criteria (a table
//           whose rows are | AC-n | criterion | visual? |)
//   Design: Approach, Contracts (```contract JSON blocks), Visual behaviors
//           ("- AC-n: what a reviewer sees"), Slices ("1. Title (AC-1, AC-2)",
//           optionally followed by "   files: a, b"), and Wireframes when the
//           approved Shape has a visual criterion: images rendered by
//           `factory-foreman wireframes design`, one or more per visual AC,
//           "![AC-n <state>, sha256:<hash>](<this repo's design/AC-n.png at a commit>?raw=true)"
// Either may hold ```show JSON blocks; slices use them from phase 3.

// A fence opens with three or more backticks or tildes, indented at most three
// spaces, and closes on the same character at least as long, with nothing after.
export const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
export const closes = (open, line) => { const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/); return Boolean(m && m[1][0] === open[0] && m[1].length >= open.length) }
const AC_ID = /^AC-\d+$/
// A wireframe image: its alt text names the AC, the state shown and the image's
// content hash; its link is the image's blob at one commit, so it never changes.
const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)\)/g
const WIREFRAME_ALT = /^(AC-\d+) ([a-z][a-z0-9-]*), sha256:([0-9a-f]{64})$/
const PINNED = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([0-9a-f]{40})\/(\S+?)\?raw=true$/
// Anything that shows an image or media: only pinned wireframes may.
const ANY_IMAGE = /!\[|<\s*(?:img|picture|source|svg|image|video|audio|object|embed|iframe)\b/gi
// Where a wireframe of an AC in a state sits in the assets commit.
export const wireframePath = (id, state) => `design/${id}${state === 'normal' ? '' : `-${state}`}.png`

export const REQUIRED_SECTIONS = {
  shape: [ 'Problem', "Who it's for", 'Out of scope', 'Acceptance criteria' ],
  design: [ 'Approach', 'Contracts', 'Slices' ],
}

export function splitFrontMatter(text) {
  text = text.replace(/\r\n/g, '\n')
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    const raw = kv[2].trim()
    meta[kv[1]] = /^-?\d+$/.test(raw) ? Number(raw) : raw
  }
  return { meta, body: text.slice(match[0].length) }
}

export function withFrontMatter(meta, body) {
  const lines = Object.entries(meta).map(([ k, v ]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body.replace(/^\n+/, '')}`
}

// Words a reader reads: code blocks and table borders don't count.
export function countWords(text) {
  let fence = null
  let words = 0
  for (const line of stripComments(text).split('\n')) {
    if (fence) { if (closes(fence, line)) fence = null; continue }
    const open = line.match(FENCE)
    if (open) { fence = open[1]; continue }
    words += line.split(/[\s|]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  }
  return words
}

function parseTableRow(line) {
  // GitHub renders \| as a literal pipe inside a cell, so split only on the others.
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

// HTML comments are invisible on GitHub, so nothing inside one counts.
const stripComments = (text) => text.replace(/<!--[\s\S]*?(-->|$)/g, '')

export function parseDraft(text) {
  const { meta, body } = splitFrontMatter(text)
  const sections = new Map()
  const fences = []
  const leadLines = []
  let current = null
  let fence = null
  for (const line of stripComments(body).split('\n')) {
    if (fence) {
      if (closes(fence.marker, line)) { fences.push({ ...fence, section: current }); fence = null } else fence.lines.push(line)
      if (current) sections.get(current).push({ line, fenced: true })
      continue
    }
    const open = line.match(FENCE)
    if (open) {
      fence = { marker: open[1], lang: open[2], lines: [] }
      if (current) sections.get(current).push({ line, fenced: true })
      continue
    }
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) { current = heading[1]; sections.set(current, []); continue }
    if (current) sections.get(current).push({ line, fenced: false })
    else if (!line.startsWith('# ')) leadLines.push(line)
  }
  const lead = leadLines.join('\n').trim().split(/\n\s*\n/)[0] ?? ''
  const text_ = (name) => (sections.get(name) ?? []).map((l) => l.line).join('\n')
  // Lines outside code blocks: where tables and lists are read from.
  const prose = (name) => (sections.get(name) ?? []).filter((l) => !l.fenced).map((l) => l.line)

  const criteria = []
  for (const line of prose('Acceptance criteria')) {
    if (!line.trim().startsWith('|')) continue
    const [ id, criterion = '', visual = '' ] = parseTableRow(line)
    if (!AC_ID.test(id)) continue
    criteria.push({ id, criterion, visual: /^(yes|y|true|visual|✓)$/i.test(visual) })
  }

  const blocks = (lang) => fences.filter((f) => f.lang === lang).map((f) => {
    try {
      return { value: JSON.parse(f.lines.join('\n')) }
    } catch (error) {
      return { error: error.message }
    }
  })

  const visualBehaviors = []
  for (const line of prose('Visual behaviors')) {
    const m = line.match(/^\s*[-*]\s+(AC-\d+):\s*(.+)$/)
    if (m) visualBehaviors.push({ id: m[1], text: m[2].trim() })
  }

  const slices = []
  for (const line of prose('Slices')) {
    const item = line.match(/^(\d+)\.\s+(.+?)\s*(?:\(([^)]*)\))?\s*$/)
    if (item) {
      const acs = (item[3] ?? '').split(/[\s,]+/).filter(Boolean)
      slices.push({ n: Number(item[1]), title: item[2].trim(), acs, files: [] })
      continue
    }
    const files = line.match(/^\s+files:\s*(.+)$/)
    if (files && slices.length) slices.at(-1).files.push(...files[1].split(',').map((f) => f.trim()).filter(Boolean))
  }

  const wireframes = []
  for (const line of prose('Wireframes')) {
    for (const [ , alt, url ] of line.matchAll(IMAGE)) {
      const a = alt.trim().match(WIREFRAME_ALT)
      const u = url.match(PINNED)
      wireframes.push({ alt: alt.trim(), url, id: a?.[1] ?? null, state: a?.[2] ?? null, hash: a?.[3] ?? null, repo: u?.[1] ?? null, commit: u?.[2] ?? null, path: u?.[3] ?? null })
    }
  }
  // Every image anywhere outside code blocks, wireframe or not.
  // Code spans and escaped characters don't render, so they aren't images.
  const images = [ ...leadLines, ...[ ...sections.keys() ].flatMap(prose) ].join('\n').replace(/(`+)[\s\S]*?\1/g, '').replace(/\\[<!]/g, '').match(ANY_IMAGE)?.length ?? 0

  return {
    unclosedFence: Boolean(fence),
    meta,
    body,
    lead,
    sections: [ ...sections.keys() ],
    section: text_,
    criteria,
    contracts: blocks('contract'),
    showScripts: blocks('show'),
    visualBehaviors,
    slices,
    wireframes,
    images,
    words: countWords(body),
    leadWords: countWords(lead),
  }
}

// Returns a list of problems; an empty list means the draft can be posted.
// `shape` is the parsed approved Shape, used to cross-check a Design.
export function checkStructure(step, draft, { budgets, shape, repo } = {}) {
  const problems = []
  const words = budgets?.words ?? {}
  if (/<!--\s*\/?factory-foreman:/.test(draft.body)) problems.push('The draft mustn\'t contain "factory-foreman:" markers; they belong to the issue body.')
  if (draft.unclosedFence) problems.push('A code block is never closed; close it with a line of matching backticks or tildes.')
  if (!draft.lead) problems.push('Start with a lead paragraph before the first section.')
  else if (words.lead && draft.leadWords > words.lead) problems.push(`The lead is ${draft.leadWords} words; the budget is ${words.lead}.`)
  if (words[step] && draft.words > words[step]) problems.push(`The draft is ${draft.words} words; the ${step} budget is ${words[step]}.`)
  for (const name of REQUIRED_SECTIONS[step] ?? []) {
    if (!draft.sections.includes(name)) problems.push(`Missing the "## ${name}" section.`)
    else if (!/[\p{L}\p{N}]/u.test(draft.section(name))) problems.push(`The "## ${name}" section is empty.`)
  }

  // An image that isn't a pinned wireframe could change after approval.
  if (draft.images > (step === 'design' ? draft.wireframes.length : 0)) problems.push(step === 'design' ? 'Images go only in the Wireframes section, as factory-foreman wireframes design writes them: no other images, titled images, reference images or HTML images or media.' : 'A Shape has no images: describe what a person sees in its criteria, and draw it in the Design\'s wireframes.')

  if (step === 'shape') {
    if (!draft.criteria.length) problems.push('Acceptance criteria needs at least one row: | AC-1 | criterion | visual |.')
    const seen = new Set()
    for (const { id, criterion } of draft.criteria) {
      if (/^\s*$/.test(criterion)) { problems.push(`${id} has no criterion.`); continue }
      if (seen.has(id)) problems.push(`${id} appears twice.`)
      seen.add(id)
    }
  }

  if (step === 'design') {
    if (!draft.contracts.length) problems.push('Contracts needs at least one ```contract block.')
    draft.contracts.forEach((c, i) => {
      if (c.error) problems.push(`Contract ${i + 1} isn't valid JSON: ${c.error}`)
      else if (typeof c.value?.name !== 'string' || !c.value.name.trim() || !Array.isArray(c.value?.testIds) || !c.value.testIds.length || !c.value.testIds.every((t) => typeof t === 'string' && t.trim())) problems.push(`Contract ${i + 1} needs a "name" and a non-empty "testIds" list.`)
      else if (c.value.slice !== undefined && !draft.slices.some((s) => s.n === c.value.slice)) problems.push(`Contract ${i + 1} ("${c.value.name}") names slice ${JSON.stringify(c.value.slice)}, which isn't in Slices.`)
    })
    if (!draft.slices.length) problems.push('Slices needs at least one numbered slice: 1. Title (AC-1).')
    draft.slices.forEach((s, i) => {
      if (s.n !== i + 1) problems.push(`Slices must be numbered 1, 2, 3…; found ${s.n} at position ${i + 1}.`)
      if (!s.acs.length) problems.push(`Slice ${s.n} names no acceptance criteria.`)
    })
    for (const w of draft.wireframes) {
      if (!w.id) problems.push(`The wireframe image "${w.alt}" needs alt text "AC-n <state>, sha256:<64-hex hash>"; factory-foreman wireframes design writes it.`)
      const where = w.id ? wireframePath(w.id, w.state) : 'design/<AC>.png'
      if (!w.commit || !w.path || w.path !== where || (repo && w.repo?.toLowerCase() !== repo.toLowerCase())) problems.push(`The wireframe for ${w.id ?? w.alt} must link to this repo's image at a commit: https://github.com/${repo ?? '<owner>/<repo>'}/blob/<commit sha>/${where}?raw=true. factory-foreman wireframes design writes it.`)
    }
    if (shape) {
      const ids = new Set(shape.criteria.map((c) => c.id))
      const owners = new Map()
      for (const s of draft.slices) {
        for (const id of s.acs) {
          if (!ids.has(id)) problems.push(`Slice ${s.n} names ${id}, which the approved Shape doesn't have.`)
          owners.set(id, [ ...(owners.get(id) ?? []), s.n ])
        }
      }
      for (const id of ids) {
        const by = owners.get(id) ?? []
        if (by.length === 0) problems.push(`No slice owns ${id}.`)
        if (by.length > 1) problems.push(`${id} is owned by slices ${by.join(' and ')}; give it to one.`)
      }
      const described = new Set(draft.visualBehaviors.map((v) => v.id))
      for (const c of shape.criteria.filter((c) => c.visual)) {
        if (!described.has(c.id)) problems.push(`${c.id} is visual: add "- ${c.id}: what a reviewer sees" under Visual behaviors.`)
      }
      for (const v of draft.visualBehaviors) if (!ids.has(v.id)) problems.push(`Visual behaviors names ${v.id}, which the approved Shape doesn't have.`)
      const drawn = new Set(draft.wireframes.map((w) => w.id))
      for (const c of shape.criteria.filter((c) => c.visual)) {
        if (!drawn.has(c.id)) problems.push(`${c.id} is visual: add its wireframe (write wireframes/${c.id}.html in the issue's state folder, which factory-foreman draft design names, then run factory-foreman wireframes design).`)
      }
      for (const id of new Set(draft.wireframes.map((w) => w.id).filter(Boolean))) if (!ids.has(id)) problems.push(`Wireframes names ${id}, which the approved Shape doesn't have.`)
    }
  }
  return problems
}

// The parts of a draft that other work depends on: the acceptance criteria,
// the contracts, the visual behaviors, the slices and the wireframe images. Two drafts with the same
// blocks differ only in wording, so an amendment between them is minor.
// Whitespace inside a criterion or behavior is normalised; anything else
// (an added word in a criterion, a changed ID or visual flag, a slice owning
// different criteria or files) is material. A slice's title is wording.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim()
export function structuralBlocks(draft) {
  return JSON.stringify({
    criteria: draft.criteria.map((c) => [ c.id, squash(c.criterion), c.visual ]),
    contracts: draft.contracts.map((c) => (c.error ? { error: true } : c.value)),
    visualBehaviors: draft.visualBehaviors.map((v) => [ v.id, squash(v.text) ]),
    slices: draft.slices.map((s) => [ s.n, s.acs, s.files ]),
    // The image's content, not the commit it was pushed in: re-pushing the same image is wording.
    wireframes: draft.wireframes.map((w) => [ w.id, w.state, w.hash ?? w.url ]),
  })
}
