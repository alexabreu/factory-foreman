// Minimal argv parsing: positionals, --flag, --key value and --key=value.
// Flags listed in `booleans` never take a value.
export function parseArgs(argv, { booleans = [] } = {}) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--') || arg === '--') { positionals.push(arg); continue }
    const eq = arg.indexOf('=')
    const key = arg.slice(2, eq === -1 ? undefined : eq)
    if (eq !== -1) flags[key] = arg.slice(eq + 1)
    else if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[key] = true
    else flags[key] = argv[++i]
  }
  return { positionals, flags }
}

// The issue comes from --issue, or from a branch named factory-foreman/<n>…
export function issueNumber(flags, branch) {
  const raw = flags.issue ?? branch?.match(/^factory-foreman\/(\d+)/)?.[1]
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return undefined
  return Number(raw)
}
