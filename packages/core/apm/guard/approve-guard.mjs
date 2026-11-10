// PreToolUse guard: an agent's shell may not approve a checkpoint, merge a
// slice, or review or merge a pull request; a person does those in their own
// terminal. Reads the hook payload on stdin and prints a deny decision. Zero deps.
// It stops honest mistakes and casual workarounds; it is not a sandbox.
export const VALUE_FLAGS = new Set([ '--issue', '--draft', '--kind', '--step', '--slice', '--findings', '--reason', '--transcript', '--session', '--event', '-R', '--repo' ])
const WRAPPERS = new Set([ 'env', 'command', 'exec', 'nohup', 'time', 'sudo', 'xargs', 'builtin', 'eval', 'bash', 'sh', 'zsh', 'dash', 'fish', '-c', '-lc', '-ec', '--' ])
const RUNNERS = { npx: [], bunx: [], pnpx: [], pnpm: [ 'exec', 'dlx', 'run' ], yarn: [ 'exec', 'dlx', 'run' ], npm: [ 'exec', 'x', 'run' ] }
const base = (t) => t.split('/').pop()
const words = (seg) => seg.trim().split(/\s+/).filter(Boolean)

// The command's words with wrappers, env prefixes and package runners removed.
function head(tokens) {
  let t = tokens
  for (let i = 0; i < 20 && t.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || WRAPPERS.has(base(t[0])) || (t[0].startsWith('-') && i > 0)) { t = t.slice(1); continue }
    const runner = RUNNERS[base(t[0])]
    if (runner) { t = t.slice(1); if (runner.includes(t[0])) t = t.slice(1); continue }
    if (base(t[0]).startsWith('node') && t[1]) { t = t.slice(1); continue }
    break
  }
  return t
}

const subcommand = (t) => {
  const args = []
  for (let i = 0; i < t.length; i++) {
    if (VALUE_FLAGS.has(t[i])) { i++; continue }
    if (!t[i].startsWith('-')) args.push(t[i])
  }
  return args
}

const WRITE = /^(-X|--method)$/
const WRITE_METHOD = /^(POST|PUT|PATCH|DELETE)$/i
const FIELD = /^(-f|-F|--field|--raw-field|--input)$/
const MUTATION = /\b(addPullRequestReview|submitPullRequestReview|mergePullRequest|enablePullRequestAutoMerge|approvePullRequest)\b/i
function ghApiWrites(t, whole) {
  // A GraphQL query spans braces, so look for the mutation in the whole command.
  if (t.includes('graphql') && MUTATION.test(whole)) return true
  const text = t.join(' ')
  if (!/\bpulls\/[^\s/]+\/(reviews|merge)\b/.test(text)) return false
  return t.some((w, i) => (WRITE.test(w) && WRITE_METHOD.test(t[i + 1] ?? '')) || /^(-X|--method=)(POST|PUT|PATCH|DELETE)$/i.test(w) || FIELD.test(w) || /^--(field|raw-field|input)=/.test(w))
}

// Why the command is denied, or null to let it run.
export function verdict(command) {
  if (typeof command !== 'string' || !command.trim()) return null
  // Quotes and escapes don't change what runs, so read the command without them.
  const flat = command.replace(/\\\n/g, ' ').replace(/["'\\]/g, '')
  for (const seg of flat.split(/&&|\|\||[;|&\n(){}`]|\$\(|<\(|>\(/)) {
    const t = head(words(seg))
    if (!t.length) continue
    const name = base(t[0])
    const isCli = name === 'factory-foreman' || (/^cli\.m?js$/.test(name) && /factory-foreman/.test(t[0]))
    if (isCli) {
      const [ sub, next ] = subcommand(t.slice(1))
      if (sub === 'approve') return 'factory-foreman approve is for a person in their own terminal.'
      if (sub === 'slice' && next === 'merge') return 'factory-foreman slice merge is for a person in their own terminal.'
    }
    if (name === 'gh') {
      const [ group, action ] = subcommand(t.slice(1))
      if (group === 'pr' && (action === 'review' || action === 'merge')) return `gh pr ${action} is for a person in their own terminal.`
      if (group === 'api' && ghApiWrites(t.slice(1), flat)) return 'Writing pull request reviews or merges through gh api is for a person in their own terminal.'
    }
  }
  return null
}

export function decide(payload) {
  let command = payload?.tool_input?.command ?? payload?.toolInput?.command
  if (command === undefined && typeof payload?.toolArgs === 'string') {
    try { command = JSON.parse(payload.toolArgs)?.command } catch { command = payload.toolArgs }
  }
  const reason = verdict(command)
  if (!reason) return null
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${reason} Ask the person to run it.` } }
}

if (import.meta.main) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => {
    let payload = {}
    try { payload = JSON.parse(input || '{}') } catch { /* not JSON: nothing to judge */ }
    const out = decide(payload)
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`)
  })
}
