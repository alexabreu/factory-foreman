// The parts of the issue body the factory owns, each between two markers:
//   <!-- factory-foreman:decisions -->…<!-- /factory-foreman:decisions -->
// Everything outside the markers is the person's own text and is kept as is.
// The status line sits at the top; the rest follow the person's text in ORDER.
import { Refusal } from '../errors.mjs'

export const ORDER = [ 'shape', 'design', 'slices', 'decisions', 'changelog' ]

const open = (name) => `<!-- factory-foreman:${name} -->`
const close = (name) => `<!-- /factory-foreman:${name} -->`

// A marker counts only as a line of its own outside code fences, so one the
// person quotes in their text (inline or in a code block) is left alone.
// A fence never closed (a pasted log, say) runs to the end of the body, so
// when one is left open the body is scanned again without fences: our
// markers after it must still be found, or every run would add another block.
function find(body, name) {
  const scan = (fences) => {
    let offset = 0
    let fence = null
    let start = -1
    for (const line of body.split('\n')) {
      const bare = line.replace(/\s+$/, '')
      const f = fences && bare.match(/^ {0,3}(`{3,}|~{3,})/)
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !bare.slice(f[0].length).trim()) fence = null
      } else if (f) {
        fence = f[1]
      } else if (start === -1 && bare === open(name)) {
        start = offset
      } else if (start !== -1 && bare === close(name)) {
        return { start, end: offset + bare.length, inner: body.slice(start + open(name).length, offset) }
      }
      offset += line.length + 1
    }
    return fence ? 'unclosed' : null
  }
  const found = scan(true)
  return found === 'unclosed' ? scan(false) : found
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
  const have = new Set(current.split('\n').map((l) => l.replace(/\s+$/, '')))
  const lines = rows.map((r) => `| ${cell(r.date)} | ${cell(r.text)} | ${cell(r.by)} | ${cell(r.step ?? '')} |`).filter((l) => !have.has(l))
  if (!lines.length) return body
  return setSection(body, 'decisions', `${current}\n${lines.join('\n')}`)
}

export function addChangelogLine(body, line) {
  const current = getSection(body, 'changelog') ?? '## Changelog'
  if (current.split('\n').some((l) => l.replace(/\s+$/, '') === line)) return body
  return setSection(body, 'changelog', `${current}\n${line}`)
}

// Writes the issue body with `change` applied to the latest one, then reads
// it back and checks the change is still there, ignoring line endings and
// trailing space, which GitHub may rewrite. GitHub has no conditional write,
// so if someone wrote after us the change is applied again on top of theirs;
// `change` must be idempotent.
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
export async function updateBody(github, n, change, tries = 3) {
  let body = (await github.issue(n))?.body ?? ''
  for (let i = 0; i < tries; i++) {
    await github.setBody(n, change(body), 'app')
    body = (await github.issue(n))?.body ?? ''
    if (norm(change(body)) === norm(body)) return body
  }
  throw new Refusal(`Issue #${n}'s description kept changing while it was being updated. Run the command again.`)
}
