// Loads factory-foreman.config.json from the target root, merged over the core
// defaults and each `extends` preset, and validated against the schema.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Refusal } from '../errors.mjs'
import { validate } from './validate.mjs'

export const CONFIG_FILE = 'factory-foreman.config.json'
const schema = JSON.parse(readFileSync(new URL('../../factory-foreman.config.schema.json', import.meta.url), 'utf8'))

export const DEFAULTS = Object.freeze({
  version: 1,
  extends: [],
  baseBranch: 'origin/HEAD',
  approvals: { requireSecondApprover: false },
  budgets: { words: { lead: 100, shape: 1800, design: 1900 }, sliceLines: 400 },
  stackDepth: 3,
  sharedFiles: [],
  publicEntries: [],
  reviewers: {
    shape: [ 'test-verification-engineer' ],
    design: [ 'software-architect', 'ux-designer?visual' ],
    slice: [ 'code-reviewer' ],
    verify: [ 'test-verification-engineer' ],
  },
  // Each command reads its prompt on stdin.
  secondOpinion: { command: [ 'codex', 'exec', '-' ], steps: [ 'design', 'verify' ] },
  review: { headless: { command: [ 'codex', 'exec', '-' ] } },
  capture: { claude: [ 'claude', '-p', '--model', 'haiku' ], codex: [ 'codex', 'exec', '-' ], minChars: 4000 },
  checks: { tiers: { slice: [], verify: 'ci' }, plugins: [] },
  evidence: { reports: [ 'test-results/**/*.xml' ], providers: null },
  preview: null,
  specSnapshot: null,
  labels: { tracked: 'factory-foreman', light: 'factory-foreman:light' },
  evals: { dir: 'evals', judge: null, maxDrop: 5 },
})

// Arrays of globs concatenate and dedupe; every other array and scalar is replaced.
const GLOB_ARRAYS = new Set([ 'sharedFiles', 'publicEntries', 'evidence.reports' ])
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function merge(base, layer, path = '') {
  const out = structuredClone(base)
  for (const [ key, value ] of Object.entries(layer)) {
    const at = path ? `${path}.${key}` : key
    if (GLOB_ARRAYS.has(at) && Array.isArray(value) && Array.isArray(base[key])) out[key] = [ ...new Set([ ...base[key], ...value ]) ]
    else if (isObject(value) && isObject(base[key])) out[key] = merge(base[key], value, at)
    else out[key] = structuredClone(value)
  }
  return out
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Refusal(`${file} is not valid JSON: ${error.message}`)
  }
}

function checkAgainstSchema(value, label) {
  const errors = validate(schema, value)
  if (errors.length) throw new Refusal(`${label} doesn't match the config schema:\n  ${errors.join('\n  ')}`, { errors })
}

// A preset is a package, resolved from the target root, with preset.json at its root.
function loadPreset(name, root) {
  const require = createRequire(join(root, 'package.json'))
  let file
  try {
    file = require.resolve(`${name}/preset.json`)
  } catch {
    throw new Refusal(`extends: can't find ${name}/preset.json from ${root}. Is ${name} installed?`)
  }
  const preset = readJson(file)
  checkAgainstSchema({ version: 1, ...preset }, `${name}/preset.json`)
  return preset
}

export function loadConfig(root, { file = join(root, CONFIG_FILE) } = {}) {
  if (!existsSync(file)) throw new Refusal(`No ${CONFIG_FILE} at ${root}. Add one (factory-foreman init writes it from phase 5).`)
  const target = readJson(file)
  checkAgainstSchema(target, CONFIG_FILE)
  let config = structuredClone(DEFAULTS)
  for (const name of target.extends ?? []) {
    // A preset's own `extends` isn't followed: presets stay one level deep.
    const preset = loadPreset(name, root)
    delete preset.extends
    config = merge(config, preset)
  }
  config = merge(config, target)
  delete config.$schema
  return config
}
