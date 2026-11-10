// Unified diffs between artifact versions, and the changelog lines built from them.

// Longest-common-subsequence line diff. Drafts are a few hundred lines, so
// the O(n·m) table is fine and keeps the code obvious.
export function diffLines(a, b) {
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ op: ' ', line: a[i] }); i++; j++ }
    else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push({ op: '-', line: a[i] }); i++ }
    else { ops.push({ op: '+', line: b[j] }); j++ }
  }
  return ops
}

export function unifiedDiff(before, after, { from = 'a', to = 'b', context = 3 } = {}) {
  const split = (s) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))
  const ops = diffLines(split(before), split(after))
  const changed = ops.map((o, k) => (o.op !== ' ' ? k : -1)).filter((k) => k >= 0)
  if (!changed.length) return ''
  const hunks = []
  for (const k of changed) {
    const last = hunks.at(-1)
    if (last && k - last.end <= context * 2) last.end = k
    else hunks.push({ start: k, end: k })
  }
  const out = [ `--- ${from}`, `+++ ${to}` ]
  for (const h of hunks) {
    const start = Math.max(0, h.start - context)
    const end = Math.min(ops.length - 1, h.end + context)
    let oldLine = 1
    let newLine = 1
    for (let k = 0; k < start; k++) {
      if (ops[k].op !== '+') oldLine++
      if (ops[k].op !== '-') newLine++
    }
    const slice = ops.slice(start, end + 1)
    const oldCount = slice.filter((o) => o.op !== '+').length
    const newCount = slice.filter((o) => o.op !== '-').length
    out.push(`@@ -${oldCount ? oldLine : oldLine - 1},${oldCount} +${newCount ? newLine : newLine - 1},${newCount} @@`)
    for (const o of slice) out.push(`${o.op}${o.line}`)
  }
  return `${out.join('\n')}\n`
}

export function diffStats(diff) {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

const title = (step) => step[0].toUpperCase() + step.slice(1)

// One line in the issue body's Changelog section.
export function bodyLine({ step, version, date, author, diff, amend = null }) {
  const { added, removed } = diffStats(diff ?? '')
  const change = diff ? `+${added} −${removed} lines` : 'first version'
  const kind = amend ? `, ${amend.minor ? 'minor' : 'material'} amendment` : ''
  return `- ${date}: ${title(step)} ${version} by @${author} (${change}${kind})`
}

// One full entry in the Changelog artifact: the diff and how we got here.
// An amendment also says why, whether it was minor (wording only, keeps the
// approval) or material (needs a new one), and which slices it affects.
export function artifactEntry({ step, version, previous, date, author, harness, diff, decisions = 0, questions = [], amend = null }) {
  const lines = [ `## ${title(step)} ${version}, ${date}`, '', `By @${author}${harness ? ` from ${harness}` : ''}.${previous ? ` Changes since ${previous}:` : ''}`, '' ]
  if (amend) {
    lines.push(`Amendment (${amend.minor ? `minor: wording only, keeps ${amend.carries}'s approval` : 'material: needs approval'}). Reason: ${amend.reason.replace(/\s+/g, ' ').trim()}`, '', `Affected slices: ${amend.slices?.length ? amend.slices.join(', ') : 'none'}.`, '')
  }
  // Decisions are in the Decisions artifact; the Changelog only counts them.
  if (decisions) lines.push(`${decisions} decision${decisions === 1 ? '' : 's'} added (see the Decisions artifact).`, '')
  if (questions.length) lines.push('Open questions:', '', ...questions.map((q) => `- ${q}`), '')
  if (diff) lines.push('```diff', diff.trimEnd(), '```', '')
  return lines.join('\n')
}
