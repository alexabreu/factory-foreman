// Path globs, as used in config (sharedFiles, tests.ac.files, evidence.reports):
// `**` matches any number of folders, `*` anything within one, `?` one
// character, and `{a,b}` either. Paths are repo-relative with forward slashes.
const cache = new Map()

export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob)
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` is zero or more folders; a trailing `**` is anything.
      if (glob[i + 2] === '/') { out += '(?:[^/]+/)*'; i += 2 } else { out += '.*'; i += 1 }
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) { out += '\\{'; continue }
      out += `(?:${glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      i = end
    } else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  const re = new RegExp(`^${out}$`)
  cache.set(glob, re)
  return re
}

export const matchesAny = (path, globs = []) => (globs ?? []).some((g) => globToRegExp(g.replace(/^\.\//, '')).test(path.replace(/^\.\//, '')))
