// The feature reviewer's per-criterion verdicts: the JSON array after a
// "VERDICTS:" line, each { criterion, verdict: met|unmet|deferred, tests, slices }.
export function verdictsOf(reply) {
  const text = String(reply)
  const at = text.search(/VERDICTS\s*:/u)
  if (at === -1) return null
  const rest = text.slice(at)
  const start = rest.indexOf('[')
  for (let end = rest.lastIndexOf(']'); start !== -1 && end > start; end = rest.lastIndexOf(']', end - 1)) {
    try { const v = JSON.parse(rest.slice(start, end + 1)); if (Array.isArray(v)) return v } catch { /* shorter */ }
  }
  return null
}

// A check that the verdict for `criterion` (an id such as "AC-2") is `want`.
export const verdictIs = (criterion, want) => (o) => {
  const v = (verdictsOf(o) ?? []).find((x) => new RegExp(`\\b${criterion}\\b`, 'u').test(String(x.criterion ?? x.id ?? '')))
  const got = v ? String(v.verdict).toLowerCase() : null
  return { passed: got === want, evidence: `Verdict for ${criterion}: ${got ?? 'none'}; wanted ${want}` }
}

// Every criterion in `ids` has a verdict that names at least one test.
export const everyCriterionMapped = (ids) => (o) => {
  const vs = verdictsOf(o) ?? []
  const missing = ids.filter((id) => !vs.some((x) => new RegExp(`\\b${id}\\b`, 'u').test(String(x.criterion ?? x.id ?? '')) && (x.verdict !== 'met' || (Array.isArray(x.tests) ? x.tests.length : x.tests))))
  return { passed: missing.length === 0, evidence: missing.length ? `No verdict, or a met verdict with no tests, for ${missing.join(', ')}` : `All of ${ids.join(', ')} have verdicts` }
}
