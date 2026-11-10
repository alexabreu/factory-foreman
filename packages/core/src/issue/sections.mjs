// The parts of the issue body the factory owns, each between two markers:
//   <!-- factory-foreman:decisions -->…<!-- /factory-foreman:decisions -->
// Everything outside the markers is the person's own text and is kept as is.
// The status line sits at the top; the rest follow the person's text in ORDER.
export const ORDER = [ 'shape', 'design', 'slices', 'decisions', 'changelog' ]

const open = (name) => `<!-- factory-foreman:${name} -->`
const close = (name) => `<!-- /factory-foreman:${name} -->`

function find(body, name) {
  const start = body.indexOf(open(name))
  if (start === -1) return null
  const end = body.indexOf(close(name), start)
  if (end === -1) return null
  return { start, end: end + close(name).length, inner: body.slice(start + open(name).length, end) }
}

export function getSection(body, name) {
  return find(body ?? '', name)?.inner.trim() ?? null
}

export function setSection(body, name, content) {
  body = body ?? ''
  const block = `${open(name)}\n${content.trim()}\n${close(name)}`
  const found = find(body, name)
  if (found) return body.slice(0, found.start) + block + body.slice(found.end)
  if (name === 'status') return `${block}\n\n${body.replace(/^\n+/, '')}`
  // Insert before the first owned section that comes later in ORDER.
  const later = ORDER.slice(ORDER.indexOf(name) + 1).map((n) => find(body, n)).filter(Boolean).sort((a, b) => a.start - b.start)[0]
  if (later) return `${body.slice(0, later.start)}${block}\n\n${body.slice(later.start)}`
  return `${body.replace(/\s+$/, '')}\n\n${block}\n`
}

// Escapes text for one cell of a markdown table.
export const cell = (text) => String(text).replace(/</g, '&lt;').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

// Text from a draft, made safe to sit inside an owned section: no markers or
// comments, and no closing tag that would end the <details> around it.
export const inert = (text) => String(text).replace(/<!--/g, '&lt;!--').replace(/<\/details>/gi, '&lt;/details>')

export function addDecisionRows(body, rows) {
  if (!rows.length) return body
  const header = '## Decisions\n\n| Date | Decision | By | Step |\n| --- | --- | --- | --- |'
  const current = getSection(body, 'decisions') ?? header
  const lines = rows.map((r) => `| ${cell(r.date)} | ${cell(r.text)} | ${cell(r.by)} | ${cell(r.step ?? '')} |`)
  return setSection(body, 'decisions', `${current}\n${lines.join('\n')}`)
}

export function addChangelogLine(body, line) {
  const current = getSection(body, 'changelog') ?? '## Changelog'
  return setSection(body, 'changelog', `${current}\n${line}`)
}
