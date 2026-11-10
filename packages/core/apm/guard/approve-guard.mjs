// PreToolUse guard: an agent's shell may not approve a checkpoint, merge a slice, or review or
// merge a pull request; a person does those in their own terminal. Reads the hook payload on
// stdin and prints a deny decision. Zero deps. It stops honest mistakes, not determined ones.
const SKIP = new Set([ 'env', 'command', 'exec', 'nohup', 'time', 'sudo', 'xargs', 'builtin', 'nice', 'timeout', 'watch', 'stdbuf', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', '--' ])
const SHELLS = new Set([ 'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish' ])
const VALUE = new Set([ '-u', '-g', '-n', '-s', '-k', '-p', '--package', '--filter', '-F', '-C', '--dir', '-w', '--workspace', '-r', '--require', '--import', '--loader', '--issue', '--draft', '--kind', '--step', '--slice', '--findings', '--reason', '--transcript', '--session', '--event', '-R', '--repo' ])
const RUNNERS = { npx: [], bunx: [], pnpx: [], pnpm: [ 'exec', 'dlx', 'run' ], yarn: [ 'exec', 'dlx', 'run' ], npm: [ 'exec', 'x', 'run' ], node: [], bun: [ 'x', 'run' ] }
const base = (t) => t.split('/').pop()
const MUTATION = /\b(addPullRequestReview|submitPullRequestReview|mergePullRequest|enablePullRequestAutoMerge|approvePullRequest)\b/i
// Splits a command line into simple commands (lists of words) as a shell would, keeping quoted
// text whole. Text a shell runs on its own ($(…), `…`, heredocs fed to a shell) goes to `nested`.
export function lex(src, nested = []) {
  const cmds = [ [] ]
  let word = null
  const end = () => { if (word !== null) cmds.at(-1).push(word); word = null }
  const add = (s) => { word = (word ?? '') + s }
  const sub = (i, open, close) => { let d = 1; let j = i; while (j < src.length && d) { if (src[j] === open && open !== close) d++; else if (src[j] === close) d--; j++ } nested.push(src.slice(i, j - 1)); add('_'); return j }
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === '\\') { if (src[i + 1] !== '\n') add(src[i + 1] ?? ''); i += 2; continue }
    if (c === "'") { const j = src.indexOf("'", i + 1); add(src.slice(i + 1, j === -1 ? src.length : j)); i = j === -1 ? src.length : j + 1; continue }
    if (c === '"') {
      let j = i + 1
      for (add(''); j < src.length && src[j] !== '"';) if (src[j] === '\\') { add(src[j + 1] ?? ''); j += 2 } else if (src.startsWith('$(', j)) j = sub(j + 2, '(', ')'); else if (src[j] === '`') j = sub(j + 1, '`', '`'); else add(src[j++])
      i = j + 1; continue
    }
    if (src.startsWith('$(', i)) { i = sub(i + 2, '(', ')'); continue }
    if (c === '`') { i = sub(i + 1, '`', '`'); continue }
    const heredoc = src.slice(i).match(/^<<-?\s*(['"]?)(\w+)\1/)
    if (heredoc) {
      end(); const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? -1 : src.slice(nl + 1).search(new RegExp(`^\\s*${heredoc[2]}\\s*$`, 'm'))
      const body = nl === -1 ? '' : src.slice(nl + 1, stop === -1 ? undefined : nl + 1 + stop)
      if (SHELLS.has(base(cmds.at(-1)[0] ?? ''))) nested.push(body)
      src = src.slice(0, i) + src.slice(i + heredoc[0].length, nl === -1 ? undefined : nl) + (stop === -1 || nl === -1 ? '' : `\n${src.slice(nl + 1 + stop).replace(/^[^\n]*/, '')}`)
      continue
    }
    if (/[;&|\n()]/.test(c)) { end(); if (cmds.at(-1).length) cmds.push([]); i++; continue }
    if (/\s/.test(c)) { end(); i++; continue }
    add(c); i++
  }
  end()
  return cmds.filter((c) => c.length)
}
// The command's words with wrappers, env prefixes and package runners removed.
function head(t) {
  for (let n = 0; n < 30 && t.length; n++) {
    if (VALUE.has(t[0])) t = t.slice(2)
    else if (/^[A-Za-z_]\w*=/.test(t[0]) || SKIP.has(base(t[0])) || t[0].startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(t[0])) t = t.slice(1)
    else if (RUNNERS[base(t[0])]) t = t.slice(RUNNERS[base(t[0])].includes(t[1]) ? 2 : 1)
    else break
  }
  return t
}
const args = (t) => t.filter((w, i) => !w.startsWith('-') && !VALUE.has(t[i - 1]))
// An explicit GET reads; a write method or any field makes gh api write.
const GH_WRITE = (t) => !t.some((w, i) => (/^(-X|--method)$/.test(w) && /^GET$/i.test(t[i + 1])) || /^(-XGET|--method=GET)$/i.test(w)) && t.some((w, i) => (/^(-X|--method)$/.test(w) && /^(POST|PUT|PATCH|DELETE)$/i.test(t[i + 1] ?? '')) || /^(-X|--method=)(POST|PUT|PATCH|DELETE)$/i.test(w) || /^(-f|-F|--field|--raw-field|--input)$/.test(w) || /^--(field|raw-field|input)=/.test(w))
// Why the command is denied, or null to let it run.
export function verdict(command, depth = 0) {
  if (Array.isArray(command)) command = command.join(' ')
  if (typeof command !== 'string' || !command.trim() || depth > 4) return null
  const nested = []
  for (const words of lex(command, nested)) {
    const t = head(words)
    const name = base(t[0] ?? '')
    const c = t.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w))
    if (SHELLS.has(name) && c > 0) nested.push(t[c + 1] ?? '')
    if (name === 'eval') nested.push(t.slice(1).join(' '))
    const isCli = name === 'factory-foreman' || /^cli\.m?js$/.test(name)
    const [ sub, next ] = isCli ? args(t.slice(1)) : []
    if (sub === 'approve') return 'factory-foreman approve is for a person in their own terminal.'
    if (sub === 'slice' && next === 'merge') return 'factory-foreman slice merge is for a person in their own terminal.'
    if (name !== 'gh') continue
    const [ group, action, path ] = args(t.slice(1))
    if (group === 'pr' && (action === 'review' || action === 'merge')) return `gh pr ${action} is for a person in their own terminal.`
    const graphql = action === 'graphql' && t.some((w) => MUTATION.test(w) || /^(query=@|--input)/.test(w))
    if (group === 'api' && (graphql || (/\bpulls\/[^\s/]+\/(reviews|merge)\b/.test(t.join(' ')) && GH_WRITE(t)))) return `Writing pull request reviews or merges through gh api (${path ?? action}) is for a person in their own terminal.`
  }
  for (const text of nested) { const why = verdict(text, depth + 1); if (why) return why }
  return null
}
export function decide(payload) {
  let command = payload?.tool_input?.command ?? payload?.toolInput?.command
  if (command === undefined && typeof payload?.toolArgs === 'string') { try { command = JSON.parse(payload.toolArgs)?.command } catch { command = payload.toolArgs } }
  const reason = verdict(command)
  if (!reason) return null
  const why = `${reason} Ask the person to run it.` // Copilot CLI reads the top level; others, hookSpecificOutput.
  return { permissionDecision: 'deny', permissionDecisionReason: why, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
}
if (import.meta.main) {
  let input = ''
  process.stdin.setEncoding('utf8').on('data', (chunk) => { input += chunk }).on('end', () => {
    let payload = {}
    try { payload = JSON.parse(input || '{}') } catch { /* not JSON: nothing to judge */ }
    const out = decide(payload); if (out) process.stdout.write(`${JSON.stringify(out)}\n`)
  })
}
