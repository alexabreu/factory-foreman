// Scores one output against a case's weighted checklist, and summarizes runs.
export function grade(output, criteria) {
  const results = criteria.map((c) => ({ text: c.text, weight: c.weight ?? 1, ...c.check(output) }))
  const total = results.reduce((s, r) => s + r.weight, 0)
  const earned = results.reduce((s, r) => s + (r.passed ? r.weight : 0), 0)
  return { score: total ? earned / total : 0, results }
}

export function summarize(scores) {
  const n = scores.length
  const mean = n ? scores.reduce((s, x) => s + x, 0) / n : 0
  const sd = n > 1 ? Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0
  return { n, mean, sd, min: Math.min(...scores), max: Math.max(...scores) }
}
