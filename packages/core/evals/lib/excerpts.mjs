// The parts of a unified diff that a list of findings points at: for each
// finding's file:line, the diff lines within `radius` of that line in the new
// file, with the file and hunk headers. A finding whose file is in the diff but
// whose line isn't gets that file's whole section; one whose file isn't in the
// diff is listed as such. This is what the verifier reads first (fix 10).
export function excerpts(diff, findings, radius = 20) {
  const lines = String(diff).split('\n')
  const files = [] // { path, header: [i...], rows: [{ i, line }] }
  let file = null
  let next = 0
  lines.forEach((text, i) => {
    if (text.startsWith('diff --git ')) { file = { path: null, start: i, header: [ i ], rows: [] }; files.push(file); return }
    if (!file) return
    if (text.startsWith('+++ ')) { file.path = text.slice(4).replace(/^b\//u, ''); file.header.push(i); return }
    if (text.startsWith('--- ') || text.startsWith('index ')) { file.header.push(i); return }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text)
    if (hunk) { next = Number(hunk[1]); file.rows.push({ i, line: next, hunk: true }); return }
    if (text.startsWith('-')) { file.rows.push({ i, line: next }); return }
    file.rows.push({ i, line: next++ })
  })
  const picked = new Map() // file -> Set of line indexes
  const missing = []
  for (const f of findings) {
    const where = String(f.where ?? (f.file ? `${f.file}:${f.line ?? ''}` : ''))
    const m = /([^\s:()]+\.[a-z0-9]+)(?::(\d+))?/iu.exec(where)
    const target = m && files.find((x) => x.path && (x.path === m[1] || x.path.endsWith(`/${m[1]}`) || m[1].endsWith(x.path)))
    if (!target) { missing.push(where || f.id); continue }
    const set = picked.get(target) ?? new Set(target.header)
    picked.set(target, set)
    const line = m[2] ? Number(m[2]) : null
    const near = line === null ? [] : target.rows.filter((r) => !r.hunk && Math.abs(r.line - line) <= radius)
    if (!near.length) { target.rows.forEach((r) => set.add(r.i)); continue }
    for (const r of near) set.add(r.i)
    // Keep the hunk header above each kept line, so line numbers stay readable.
    for (const r of near) { const h = [ ...target.rows ].reverse().find((x) => x.hunk && x.i < r.i); if (h) set.add(h.i) }
  }
  const parts = [ ...picked.entries() ].map(([ , set ]) => {
    const idx = [ ...set ].sort((a, b) => a - b)
    return idx.map((i, k) => (k && i !== idx[k - 1] + 1 ? `…\n${lines[i]}` : lines[i])).join('\n')
  })
  if (missing.length) parts.push(`Not in the diff: ${[ ...new Set(missing) ].join(', ')}`)
  return parts.join('\n\n')
}
