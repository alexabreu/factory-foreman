// PreToolUse guard: an agent's shell may not approve, merge a slice, review or merge a pull request, or post a record; a
// person does those in their own terminal. Reads the hook payload on stdin and denies (see decide). Zero deps. It stops honest mistakes, not determined ones.
import { chatDecision } from './approve-ask.mjs'
const SKIP = new Set([ 'env', 'command', 'exec', 'nohup', 'time', 'sudo', 'xargs', 'builtin', 'nice', 'timeout', 'watch', 'stdbuf', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', '--' ])
const SHELLS = new Set([ 'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish' ]); const base = (t) => t.split('/').pop()
const VALUE = new Set([ '--issue', '--draft', '--kind', '--step', '--slice', '--findings', '--reason', '--transcript', '--session', '--event', '-R', '--repo' ])
const OWN = { sudo: [ '-u', '-g', '-C', '-h', '-p' ], timeout: [ '-s', '-k', '--signal', '--kill-after' ], nice: [ '-n' ], watch: [ '-n' ], exec: [ '-a' ], env: [ '-u', '--unset', '-C', '--chdir' ], npx: [ '-p', '--package' ], pnpm: [ '--filter', '-F', '-C', '--dir', '-w', '--workspace' ], yarn: [ 'workspace', '--cwd' ], npm: [ '--prefix', '-w', '--workspace' ], node: [ '-r', '--require', '--import', '--loader', '--env-file' ] } // value flags of each wrapper or runner, which count only right after it
const RUNNERS = { npx: [], bunx: [], pnpx: [], pnpm: [ 'exec', 'dlx', 'run' ], yarn: [ 'exec', 'dlx', 'run' ], npm: [ 'exec', 'x', 'run' ], node: [], bun: [ 'x', 'run' ] }; const MUTATION = /\b(addPullRequestReview|submitPullRequestReview|mergePullRequest|enablePullRequestAutoMerge|approvePullRequest)\b/i
// Splits a command line into simple commands as a shell would, quoted text whole; text a shell runs on its own ($(…), `…`, heredocs) goes to `nested`.
export function lex(src, nested = []) {
  const cmds = [ [] ]; let word = null
  let here = false // the next word is a here-string, which a shell runs as a script
  const end = () => { if (word !== null && here && SHELLS.has(base(cmds.at(-1)[0] ?? ''))) nested.push(word); else if (word !== null) cmds.at(-1).push(word); if (word !== null) here = false; word = null }
  const add = (s) => { word = (word ?? '') + s }
  const sub = (i, open, close) => { let d = 1; let j = i; while (j < src.length && d) { if (src[j] === open && open !== close) d++; else if (src[j] === close) d--; j++ } nested.push(src.slice(i, j - 1)); add('\uE000'); return j }
  for (let i = 0; i < src.length;) {
    const c = src[i]; if (c === '\\') { if (src[i + 1] !== '\n') add(src[i + 1] ?? ''); i += 2; continue }
    if (c === "'") { const j = src.indexOf("'", i + 1); add(src.slice(i + 1, j === -1 ? src.length : j)); i = j === -1 ? src.length : j + 1; continue }
    if (c === '"') { let j = i + 1
      for (add(''); j < src.length && src[j] !== '"';) if (src[j] === '\\') { add(src[j + 1] ?? ''); j += 2 } else if (src.startsWith('$(', j)) j = sub(j + 2, '(', ')'); else if (src[j] === '`') j = sub(j + 1, '`', '`'); else add(src[j++])
      i = j + 1; continue
    }
    if (src.startsWith('$(', i)) { i = sub(i + 2, '(', ')'); continue }
    if (c === '`') { i = sub(i + 1, '`', '`'); continue }
    if (src.startsWith('<<<', i)) { end(); here = true; i += 3; continue }
    const heredoc = src.slice(i).match(/^<<-?\s*(['"]?)(\w+)\1/)
    if (heredoc) {
      end(); const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? -1 : src.slice(nl + 1).search(new RegExp(`^\\s*${heredoc[2]}\\s*$`, 'm'))
      const body = nl === -1 ? '' : src.slice(nl + 1, stop === -1 ? undefined : nl + 1 + stop)
      if (SHELLS.has(base(cmds.at(-1)[0] ?? ''))) nested.push(body); src = src.slice(0, i) + src.slice(i + heredoc[0].length, nl === -1 ? undefined : nl) + (stop === -1 || nl === -1 ? '' : `\n${src.slice(nl + 1 + stop).replace(/^[^\n]*/, '')}`)
      continue
    }
    if (/[;&|\n()]/.test(c)) { end(); if (cmds.at(-1).length) cmds.push([]); i++; continue }
    if (/\s/.test(c)) { end(); i++; continue } else { add(c); i++ }
  }
  end()
  return cmds.filter((c) => c.length)
}
// The command's words with wrappers, env prefixes and package runners removed.
function head(t) {
  let owner = null
  for (let n = 0; n < 40 && t.length; n++) {
    if (OWN[owner]?.includes(t[0])) t = t.slice(2)
    else if (owner === 'env' && /^(-S|--split-string)$/.test(t[0])) t = [ ...(t[1] ?? '').split(/\s+/), ...t.slice(2) ]
    else if (/^[A-Za-z_]\w*=/.test(t[0]) || t[0].startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(t[0])) t = t.slice(1)
    else if (SKIP.has(base(t[0]))) { owner = base(t[0]); t = t.slice(1) } else if (RUNNERS[base(t[0])]) { owner = base(t[0]); t = t.slice(RUNNERS[owner].includes(t[1]) ? 2 : 1) } else break
  }
  return t
}
const args = (t) => t.filter((w, i) => !w.startsWith('-') && !VALUE.has(t[i - 1]))
// An explicit GET reads; a write method or any field makes gh api write.
const GH_WRITE = (t) => !t.some((w, i) => (/^(-X|--method)$/.test(w) && /^GET$/i.test(t[i + 1])) || /^(-XGET|--method=GET)$/i.test(w)) && t.some((w, i) => (/^(-X|--method)$/.test(w) && /^(POST|PUT|PATCH|DELETE)$/i.test(t[i + 1] ?? '')) || /^(-X|--method=)(POST|PUT|PATCH|DELETE)$/i.test(w) || /^(-f|-F|--field|--raw-field|--input)$/.test(w) || /^--(field|raw-field|input)=/.test(w))
// Why the command is denied, or null to let it run.
export function verdict(command, depth = 0) {
  if (Array.isArray(command)) command = command.map((w) => (/^[\w./=:@%+,-]+$/.test(w) ? w : `'${String(w).replace(/'/g, "'\\''")}'`)).join(' ')
  if (typeof command !== 'string' || !command.trim() || depth > 4) return null
  if (/FACTORY_FOREMAN_ASK|--ask-ticket/.test(command)) return 'factory-foreman\'s approval tickets are written and used by the approve hook alone.'
  // Records come from factory-foreman itself: a terminal approval is only as strong as this.
  const nested = []; for (const words of lex(command, nested)) {
    const t = head(words)
    const name = base(t[0] ?? '').replace(/^((?:@[^/]+\/)?[^@]+)@[^/]*$/, '$1')
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
    const opaque = nested.some((n) => !/^\s*cat\s+<<-?\s*['"]?\w+['"]?\s*\n/.test(n)); const hidden = (w) => /^(--body-file|--input|-F|--field)(=|$)|^-F./.test(w) || (opaque && w.includes('\uE000')) || /\$[A-Za-z_{]/.test(w) // text it can't see (a file, stdin, a variable, a command's output, not a heredoc) could hold a record
    const comments = ((group === 'pr' || group === 'issue') && action === 'comment') || (group === 'api' && (/\bissues\/([^\s/]+\/)?comments\b/.test(t.join(' ')) && GH_WRITE(t) || (action === 'graphql' && /addComment/.test(t.join(' '))))); if (comments && (/factory-foreman:record/.test(command) || /factory-foreman:record/.test(t.join('')))) return 'Writing a factory-foreman record by hand is refused; records come from factory-foreman commands.'
    if (comments && t.some(hidden)) return `A comment through gh ${group} whose text comes from a file, a variable or a command's output is refused, since it could hold a factory-foreman record; pass the text inline.`
    const graphql = action === 'graphql' && t.some((w) => MUTATION.test(w) || /^(-[fF])?query=(@|.*\uE000)|^--input/.test(w))
    if (group === 'api' && (graphql || (/\bpulls\/[^\s/]+\/(reviews|merge)\b/.test(t.join(' ')) && GH_WRITE(t)))) return `Writing pull request reviews or merges through gh api (${path ?? action}) is for a person in their own terminal.`
  }
  for (const text of nested) { const why = verdict(text, depth + 1); if (why) return why }
  return null
}
// Claude Code and Codex block on exit 2 with the reason on stderr (Codex rejects unknown JSON
// fields and runs the command); Copilot's camelCase payload gets JSON, plus exit 2 if unread.
const COPILOT = (p) => p?.tool_input === undefined && p?.tool_name === undefined && [ 'toolName', 'toolArgs', 'toolInput' ].some((k) => p?.[k] !== undefined)
const deny = (why, copilot, code = copilot ? 0 : 2) => ({ code, stderr: code === 2 ? why : undefined, stdout: copilot ? JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: why }) : undefined })
export function decide(payload) {
  let command = payload?.tool_input?.command ?? payload?.toolInput?.command; const args = payload?.toolArgs
  if (command === undefined && args !== undefined) { try { command = (typeof args === 'string' ? JSON.parse(args) : args)?.command } catch { command = args } }
  const reason = verdict(command); const chat = chatDecision(payload, command, reason, { lex }) // Claude Code asks the person in the chat
  return chat ? (chat.ask ? { code: 0, stdout: JSON.stringify(chat.ask) } : deny(chat.refuse, false)) : reason ? deny(`${reason} Ask the person to run it.`, COPILOT(payload)) : null
}
const UNREAD = 'The approve guard couldn\'t read this command, and it may approve or merge. Ask the person to run it.'
export function run(input) { try { return decide(JSON.parse(input || '{}')) } catch { return /factory-foreman|cli\.m?js|\bgh\b/.test(input) ? deny(UNREAD, /"tool(Name|Args|Input)"/.test(input) && !/"tool_(name|input)"/.test(input), 2) : null } } // fails closed
if (import.meta.main) {
  let input = ''; process.stdin.setEncoding('utf8').on('error', () => { process.stderr.write(`${UNREAD}\n`); process.exitCode = 2 }).on('data', (chunk) => { input += chunk }).on('end', () => {
    const out = run(input); if (out?.stdout) process.stdout.write(`${out.stdout}\n`); if (out?.stderr) process.stderr.write(`${out.stderr}\n`); process.exitCode = out?.code ?? 0
  })
}
