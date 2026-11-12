// Small, objective checks the criteria compose. Each returns { passed, evidence },
// so every score explains itself. Adapted from the predecessor's eval checks
// (flight-components/factory/evals/lib/checks.mjs).
const excerpt = (text, index, length) => text.slice(Math.max(0, index - 60), index + length + 60).replaceAll('\n', ' ').trim()

export function matches(text, pattern) {
  const m = text.match(pattern)
  return m ? { passed: true, evidence: `Found: "…${excerpt(text, m.index, m[0].length)}…"` } : { passed: false, evidence: `No match for ${pattern}` }
}

export function absent(text, pattern) {
  const m = text.match(pattern)
  return m ? { passed: false, evidence: `Unexpected: "…${excerpt(text, m.index, m[0].length)}…"` } : { passed: true, evidence: `No match for ${pattern}, as expected` }
}

export function countAtLeast(text, pattern, minimum) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const distinct = [ ...new Set([ ...text.matchAll(new RegExp(pattern.source, flags)) ].map((m) => m[0])) ]
  return { passed: distinct.length >= minimum, evidence: `${distinct.length} distinct match(es) of ${pattern} (need ${minimum})` }
}

// Locations cited for a file, as `file.ts:12` or as JSON `"file": "...file.ts", "line": 12`
// (the reviewer personas reply with a JSON array of findings).
export function citesAtLeast(text, file, minimum) {
  const inline = [ ...text.matchAll(new RegExp(`${file.source}:\\d+`, 'gu')) ].map((m) => m[0])
  const json = [ ...text.matchAll(new RegExp(`"file"\\s*:\\s*"[^"]*${file.source}"[^}]{0,200}?"line"\\s*:\\s*(\\d+)`, 'gu')) ].map((m) => `${m[0].match(/"file"\s*:\s*"([^"]*)"/u)[1]}:${m[1]}`)
  const distinct = [ ...new Set([ ...inline, ...json ]) ]
  return { passed: distinct.length >= minimum, evidence: `${distinct.length} distinct location(s) (need ${minimum}): ${distinct.slice(0, 6).join(', ')}` }
}
