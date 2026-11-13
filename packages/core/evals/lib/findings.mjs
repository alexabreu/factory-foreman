// The JSON array of findings in a reply: a fenced ```json block if there is one,
// otherwise the first well-formed array in the text. Narration before or after the
// JSON, or brackets in prose, don't hide it. Returns null when there's none.
export function findingsFrom(reply) {
  // The feature reviewer puts its verdicts after a VERDICTS: line; they aren't findings.
  const text = String(reply).split(/\n\s*\**VERDICTS\**\s*:/u)[0]
  const fenced = [ ...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/gu) ].map((m) => m[1])
  for (const block of fenced) {
    try { const v = JSON.parse(block.trim()); if (Array.isArray(v)) return v } catch { /* not this block */ }
  }
  const end = text.lastIndexOf(']')
  for (let i = text.indexOf('['); i !== -1 && i < end; i = text.indexOf('[', i + 1)) {
    try { const v = JSON.parse(text.slice(i, end + 1)); if (Array.isArray(v) && v.every((f) => f && typeof f === 'object')) return v } catch { /* try the next bracket */ }
  }
  return null
}
