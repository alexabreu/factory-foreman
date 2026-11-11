// factory-foreman slice open|tests|review|iterate|merge|list
//
// A slice is one numbered piece of the approved Design, built on its own branch
// (factory-foreman/<issue>-slice-<n>) and draft pull request, stacked on the
// slice below it. Its AC tests are written first, from the approved Shape and
// Design only, checked to fail at base and frozen; every iteration then has to
// pass the AC gate, the light checks, a settled code review and its show
// scripts before it's pushed.
//
// The rules a slice is held to (tests, checks, budgets, shared files,
// reviewers) are read from the config at the slice's base, never from the
// slice itself, and a slice may not change the config.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pinnedUrl, publishAssets } from '../assets/publish.mjs'
import { CONFIG_FILE, loadConfig } from '../config/load.mjs'
import { evidenceSection, loadProviders } from '../evidence/providers.mjs'
import { Refusal } from '../errors.mjs'
import { isApproved, sliceApprovers } from '../issue/records.mjs'
import { inert, setSection, updateBody } from '../issue/sections.mjs'
import { SEVERITIES, checkSettlements } from '../review/briefs.mjs'
import { runChecks } from '../slices/checks.mjs'
import { acGate } from '../slices/gate.mjs'
import { acsIn, issueBranch, iterationTag, sliceBranch, slicePlan } from '../slices/plan.mjs'
import { checkShowScript, replayShowScripts } from '../slices/show.mjs'
import { loadSlice, postSliceRecord, writeSlice } from '../slices/state.mjs'
import { inCodexSandbox } from '../state/local.mjs'
import { confirm, requireTerminal } from '../approval/ask.mjs'
import { parseDraft } from '../steps/structure.mjs'
import { matchesAny } from '../util/glob.mjs'
import { changedFiles, currentBranch, git, gitTest, head, lineCounts, requireWritableGit, topLevel } from '../util/git.mjs'
import { approvedBody, loadIssue } from './common.mjs'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const short = (sha) => String(sha).slice(0, 7)

export function sliceNumber(raw, sub, usage = `slice ${sub}`) {
  if (!/^[1-9]\d*$/.test(String(raw ?? ''))) throw new Refusal(`Name the slice: factory-foreman ${usage} <n>.`)
  return Number(raw)
}

function requireTestConfig(config, plan) {
  const ac = config.tests?.ac ?? {}
  const missing = [ !ac.files?.length && 'tests.ac.files', !ac.run?.length && 'tests.ac.run', plan?.visual.length && !config.tests?.show?.files?.length && 'tests.show.files' ].filter(Boolean)
  if (missing.length) {
    throw new Refusal(`Slices need to know where the AC tests are and how to run them: set ${missing.join(', ')} in ${CONFIG_FILE}, for example:\n  "tests": { "ac": { "files": ["e2e/**/*.e2e.ts"], "run": ["npx", "playwright", "test"] }, "show": { "files": ["show/**/*.json"] } }\nThe runner gets the AC test files as arguments and must write JUnit XML where evidence.reports finds it.`)
  }
}

// The config as it is at a commit: what a slice is held to is its base's.
async function configAt(ctx, sha) {
  const file = await ctx.exec([ 'git', 'show', `${sha}:${CONFIG_FILE}` ], { timeout: 60_000 })
  if (file.code !== 0) {
    // A config only in the working tree would let a slice set its own rules.
    if (existsSync(join(await topLevel(ctx), CONFIG_FILE))) throw new Refusal(`${CONFIG_FILE} isn't committed at the slice's base (${short(sha)}); slices are held to the committed one. Commit it on the base branch first.`)
    return ctx.config()
  }
  const dir = mkdtempSync(join(tmpdir(), 'ffc-'))
  try {
    writeFileSync(join(dir, CONFIG_FILE), file.stdout)
    return loadConfig(await topLevel(ctx), { file: join(dir, CONFIG_FILE) })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The approved Shape and Design a slice pins, checked to belong together. A
// minor amendment keeps its version's approval, so pins use the approved vN.
async function approvedPair(ctx, github, n) {
  const state = await loadIssue(github, n, ctx.config().approvals)
  const shapeBody = approvedBody(state.steps.shape)
  const designBody = approvedBody(state.steps.design)
  if (!shapeBody || !designBody) throw new Refusal(`Slices need an approved Shape and Design on #${n}${shapeBody ? '' : ' (Shape isn\'t approved)'}${designBody ? '' : ' (Design isn\'t approved)'}.`)
  const shapeVersion = state.steps.shape.approved.version
  const designVersion = state.steps.design.approved.version
  const designCp = state.steps.design.approvedCheckpoint
  const warnings = []
  if (designCp.shapeVersion && designCp.shapeVersion.replace(/\.\d+$/, '') !== shapeVersion) throw new Refusal(`Design ${designVersion} was written against Shape ${designCp.shapeVersion}, but the approved Shape is ${shapeVersion}. Amend the Design against Shape ${shapeVersion} and approve it first.`)
  if (!designCp.shapeVersion) warnings.push(`Design ${designVersion} doesn't record which Shape it was written against; pinning it with Shape ${shapeVersion}.`)
  const waiting = state.steps.shape.latest && !isApproved(state.steps.shape) ? state.steps.shape.latest.version : null
  if (waiting) warnings.push(`Shape ${waiting} awaits approval. These slices pin Shape ${shapeVersion}; if ${waiting} is approved they go stale until the Design is amended.`)
  return {
    state,
    shapeBody,
    designBody,
    shape: parseDraft(shapeBody),
    design: parseDraft(designBody),
    pinned: { shape: { version: shapeVersion, hash: state.steps.shape.approvedCheckpoint.hash }, design: { version: designVersion, hash: designCp.hash } },
    warnings,
  }
}

const isStale = (slice, pinned) => slice.pinned.shape.version !== pinned.shape.version || slice.pinned.design.version !== pinned.design.version

// Every slice of the Design, from its PR record.
async function allSlices(ctx, github, n, design) {
  const out = {}
  for (const s of design.slices) {
    const found = await loadSlice(ctx, github, n, s.n)
    if (found) out[s.n] = found
  }
  return out
}

// The issue body's Slices checklist, from the approved Design and the slices' records.
async function updateChecklist(ctx, github, n) {
  const state = await loadIssue(github, n, ctx.config().approvals)
  const body = approvedBody(state.steps.design)
  if (!body) return
  const design = parseDraft(body)
  const slices = await allSlices(ctx, github, n, design)
  const lines = design.slices.map((s) => {
    const st = slices[s.n]
    return `- [${st?.state === 'merged' ? 'x' : ' '}] ${s.n}. ${s.title}${s.acs.length ? ` (${s.acs.join(', ')})` : ''}${st?.pr ? ` — #${st.pr}${st.state === 'open' && st.iterations?.length ? `, iteration ${st.iterations.length}` : ''}` : ''}`
  })
  await updateBody(github, n, (b) => setSection(b, 'slices', `### Slices\n${lines.join('\n')}`))
}

async function remoteSha(ctx, branch) {
  const out = await git(ctx, [ 'ls-remote', 'origin', `refs/heads/${branch}` ], `Reading ${branch} on origin`)
  return out.split(/\s/)[0] || null
}

// ── open ────────────────────────────────────────────────────────────────────
async function open(ctx, { positionals }) {
  const n = ctx.issue()
  const s = sliceNumber(positionals[1], 'open')
  const github = ctx.github()
  await requireWritableGit(ctx, 'slice open')
  await github.appReady()
  const { shape, design, pinned, warnings } = await approvedPair(ctx, github, n)
  const config = ctx.config()
  const plan = slicePlan({ shape, design }, s)
  const slices = await allSlices(ctx, github, n, design)
  if (slices[s]?.state === 'open') throw new Refusal(`Slice ${s} is already open: #${slices[s].pr} on ${slices[s].branch}.`)
  if (slices[s]?.state === 'merged') throw new Refusal(`Slice ${s} is already merged (#${slices[s].pr}).`)
  const opened = Object.values(slices).filter((x) => x.state === 'open')
  if (opened.length >= config.stackDepth) throw new Refusal(`${opened.length} slices are open (${opened.map((x) => x.n).join(', ')}); the stack depth is ${config.stackDepth}. Merge one first.`)
  const unopened = design.slices.filter((x) => x.n < s && !slices[x.n]).map((x) => x.n)
  if (unopened.length) throw new Refusal(`Open slice ${unopened[0]} first: slices stack in order.`)
  const branch = sliceBranch(n, s)

  // The base: the open slice below, or the issue branch once everything below is merged.
  const prev = s > 1 ? slices[s - 1] : null
  const baseBranch = prev?.state === 'open' ? prev.branch : issueBranch(n)
  let baseSha = await remoteSha(ctx, baseBranch)
  if (!baseSha) {
    if (baseBranch !== issueBranch(n) || !(await gitTest(ctx, [ 'rev-parse', '--verify', '--quiet', `refs/heads/${baseBranch}` ]))) throw new Refusal(`${baseBranch} isn't on origin. Push it first.`)
    await git(ctx, [ 'push', '--quiet', 'origin', `refs/heads/${baseBranch}:refs/heads/${baseBranch}` ], `Pushing ${baseBranch}`)
    baseSha = await remoteSha(ctx, baseBranch)
  }
  await git(ctx, [ 'fetch', '--quiet', 'origin', `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}` ], `Fetching ${baseBranch}`)

  // GitHub won't open a pull request with no commits, so the slice starts with an
  // empty one; its tree is the base's. A run that stopped partway is picked up:
  // an existing start commit on the base, and a PR already opened for the branch.
  let start = await remoteSha(ctx, branch)
  if (start) {
    await git(ctx, [ 'fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}` ], `Fetching ${branch}`)
    const parent = await git(ctx, [ 'rev-parse', `${start}^` ], `Reading ${branch}`)
    const sameTree = (await git(ctx, [ 'rev-parse', `${start}^{tree}` ], `Reading ${branch}`)) === (await git(ctx, [ 'rev-parse', `${baseSha}^{tree}` ], `Reading ${baseBranch}`))
    if (parent !== baseSha || !sameTree) throw new Refusal(`${branch} is already on origin with other work; it isn't a slice start on ${baseBranch} at ${short(baseSha)}. Delete or rename it first.`)
  } else {
    start = await git(ctx, [ 'commit-tree', `${baseSha}^{tree}`, '-p', baseSha, '-m', `Open slice ${s}: ${plan.title} (#${n})` ], 'Starting the slice')
    await git(ctx, [ 'push', '--quiet', 'origin', `${start}:refs/heads/${branch}` ], `Pushing ${branch}`)
  }
  const local = await gitTest(ctx, [ 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}` ])
  if (!local) await git(ctx, [ 'branch', branch, start ], `Creating ${branch}`)

  const owner = await github.viewer()
  const existing = await github.prForBranch(branch)
  if (existing?.state === 'MERGED') throw new Refusal(`${branch} was already merged (#${existing.number}).`)
  const body = [
    `Slice ${s} of #${n}: **${plan.title}**.`,
    '',
    `Owns ${plan.acs.join(', ')}${plan.visual.length ? ` (visual: ${plan.visual.join(', ')})` : ''}${plan.files.length ? ` and ${plan.files.map((f) => `\`${f}\``).join(', ')}` : ''}.`,
    `Pinned to Shape ${pinned.shape.version} and Design ${pinned.design.version}.`,
    '',
    `Next: \`factory-foreman slice tests ${s}\` writes and freezes its AC tests.`,
  ].join('\n')
  const pr = (existing?.state === 'OPEN' ? existing.number : null) ?? await github.createPr({ head: branch, base: baseBranch, title: `Slice ${s}: ${plan.title} (#${n})`, body, draft: true })
  await github.addAssignee(pr, owner)
  const slice = writeSlice(ctx.stateDir(), { n: s, branch, base: { branch: baseBranch, sha: baseSha }, start, pr, pinned, tests: null, iterations: [], owner, state: 'open' })
  await postSliceRecord(github, { issue: n, slice, text: `**Slice ${s} opened** by @${owner}, pinned to Shape ${pinned.shape.version} and Design ${pinned.design.version}.` })
  await updateChecklist(ctx, github, n)
  return {
    out: [ ...warnings.map((w) => `Note: ${w}`), `Opened slice ${s} (${plan.title}): #${pr}, branch ${branch} from ${baseBranch} at ${short(baseSha)}.`, `Switch to it (git fetch origin ${branch} && git switch ${branch}), then: factory-foreman slice tests ${s}` ].join('\n'),
    json: slice,
  }
}

// ── tests ───────────────────────────────────────────────────────────────────
function testsBrief({ n, s, plan, shapeBody, designBody, pinned, config }) {
  return [
    `You are the test-verification-engineer. Write the acceptance tests for slice ${s} of issue #${n}, before any of its code exists. Read only the approved Shape (${pinned.shape.version}) and Design (${pinned.design.version}) below; don't read or assume the implementation.`,
    '',
    `Slice ${s}: ${plan.title}. It owns ${plan.acs.join(', ')}${plan.visual.length ? `; visual: ${plan.visual.join(', ')}` : ''}.`,
    `Contracts it builds (test against these names only): ${JSON.stringify(plan.contracts)}`,
    '',
    'Rules:',
    `- At least one test per AC, with the AC id in the test's title, e.g. test('${plan.acs[0]}: …'). Test files match ${config.tests.ac.files.join(', ')}.`,
    '- Find elements only by the contracts\' test ids; import only the files the contracts name.',
    '- Each test must fail before the slice is built for a reason the slice fixes: an assertion, an import of a file the slice adds, or waiting for a test id its contract adds. A test that passes now, or fails any other way, is refused when you freeze.',
    plan.visual.length ? `- One show script per visual AC (${plan.visual.join(', ')}), a JSON file matching ${config.tests.show.files.join(', ')}: { "ac": "AC-n", "says": "what a reviewer sees", "url": "/", "steps": [ { "fill": "<test id>", "text": "…" }, { "click": "<test id>" }, { "check": "<test id>" }, { "select": "<test id>", "value": "…" }, { "wait": "<test id>" } ] }.` : '- This slice has no visual AC, so no show scripts.',
    `- Commit only these test and show-script files, as one commit on the slice branch, then run: factory-foreman slice tests ${s} --save`,
    '',
    `<shape version="${pinned.shape.version}">`, shapeBody.trim(), '</shape>',
    '',
    `<design version="${pinned.design.version}">`, designBody.trim(), '</design>',
  ].join('\n')
}

async function tests(ctx, { positionals, flags }) {
  const n = ctx.issue()
  const s = sliceNumber(positionals[1], 'tests')
  const github = ctx.github()
  const slice = await loadSlice(ctx, github, n, s)
  if (slice?.state !== 'open') throw new Refusal(`Slice ${s} isn't open. Open it first: factory-foreman slice open ${s}.`)
  const { shape, design, shapeBody, designBody, pinned } = await approvedPair(ctx, github, n)
  if (isStale(slice, pinned)) throw new Refusal(`Slice ${s} is pinned to Shape ${slice.pinned.shape.version} and Design ${slice.pinned.design.version}, but the approved ones are ${pinned.shape.version} and ${pinned.design.version}. It's stale: its tests would be written against the wrong versions.`)
  const config = await configAt(ctx, slice.base.sha)
  const plan = slicePlan({ shape, design }, s)
  requireTestConfig(config, plan)
  if (!flags.save) {
    if (slice.tests) throw new Refusal(`Slice ${s}'s AC tests are frozen (${short(slice.tests.commit)}).`)
    const brief = testsBrief({ n, s, plan, shapeBody, designBody, pinned, config })
    return { out: `=== test-verification-engineer (run as a subagent: the test-verification-engineer agent) ===\n${brief}`, json: { slice: s, brief } }
  }

  if (slice.tests) throw new Refusal(`Slice ${s}'s AC tests are already frozen (${short(slice.tests.commit)}).`)
  await requireWritableGit(ctx, 'slice tests --save')
  if ((await currentBranch(ctx)) !== slice.branch) throw new Refusal(`Switch to ${slice.branch} first.`)
  const tip = await head(ctx)
  const commits = (await git(ctx, [ 'rev-list', `${slice.start}..${tip}` ], 'Listing the slice\'s commits')).split('\n').filter(Boolean)
  if (commits.length !== 1) throw new Refusal(`The AC tests must be the slice's first commit, alone: ${slice.branch} has ${commits.length} commit(s) since it was opened. ${commits.length ? 'Squash the tests into one commit with nothing else in it.' : 'Commit the tests first.'}`)
  const files = await changedFiles(ctx, slice.start, tip)
  const acGlobs = config.tests.ac.files
  const showGlobs = config.tests.show?.files ?? []
  const problems = []
  for (const f of files) if (!matchesAny(f, acGlobs) && !matchesAny(f, showGlobs)) problems.push(`${f} isn't an AC test (${acGlobs.join(', ')}) or a show script (${showGlobs.join(', ') || 'none configured'}); the tests commit holds only those.`)
  const deleted = await changedFiles(ctx, slice.start, tip, 'D')
  for (const f of deleted) problems.push(`${f} is deleted; the tests commit only adds or changes tests.`)
  const testFiles = files.filter((f) => matchesAny(f, acGlobs) && !deleted.includes(f))
  const showFiles = files.filter((f) => matchesAny(f, showGlobs) && !matchesAny(f, acGlobs) && !deleted.includes(f))
  const contents = Object.fromEntries(await Promise.all([ ...testFiles, ...showFiles ].map(async (f) => [ f, await git(ctx, [ 'show', `${tip}:${f}` ], `Reading ${f}`) ])))
  if (!testFiles.length) problems.push('The commit has no AC test files.')
  const covered = new Set(testFiles.flatMap((f) => [ ...acsIn(contents[f], f) ]))
  for (const ac of plan.acs) if (!covered.has(ac)) problems.push(`${ac} has no test: put "${ac}" in a test's title (or the file's name).`)
  const shown = new Set()
  for (const f of showFiles) {
    let script
    try { script = JSON.parse(contents[f]) } catch (error) { problems.push(`${f} isn't JSON: ${error.message}`); continue }
    const bad = checkShowScript(script)
    if (bad.length) problems.push(`${f}: ${bad.join('; ')}.`)
    else if (!plan.acs.includes(script.ac)) problems.push(`${f} shows ${script.ac}, which slice ${s} doesn't own.`)
    else shown.add(script.ac)
  }
  for (const ac of plan.visual) if (!shown.has(ac)) problems.push(`${ac} is visual and has no show script.`)
  if (problems.length) throw new Refusal(`Slice ${s}'s AC tests can't be frozen yet:\n  - ${problems.join('\n  - ')}`, { problems })

  // Before freezing: each test must fail at base for a reason the slice fixes.
  const owned = await ownedNew(ctx, plan, slice.base.sha)
  const gate = await (ctx.acGate ?? acGate)(ctx, { base: slice.base.sha, tests: testFiles, testsCommit: tip, owned, testIds: plan.testIds, acs: plan.acs, config, baseOnly: true })
  if (!gate.ok) throw new Refusal(`Slice ${s}'s AC tests don't fail at base for the right reasons, so they can't be frozen:\n  - ${gate.problems.join('\n  - ')}\nFix the tests (a new tests commit replacing this one) and save again.`, { gate })

  await git(ctx, [ 'push', '--quiet', 'origin', `HEAD:refs/heads/${slice.branch}` ], `Pushing ${slice.branch}`)
  const frozen = { commit: tip, files: Object.fromEntries(testFiles.map((f) => [ f, sha256(contents[f]) ])), show: Object.fromEntries(showFiles.map((f) => [ f, sha256(contents[f]) ])) }
  const updated = writeSlice(ctx.stateDir(), { ...slice, tests: frozen })
  await postSliceRecord(github, { issue: n, slice: updated, text: `**AC tests frozen** for slice ${s} at ${short(tip)}: ${testFiles.length} test file(s) covering ${plan.acs.join(', ')}${showFiles.length ? `, ${showFiles.length} show script(s)` : ''}. Each fails at base ${short(slice.base.sha)} for the right reason (${[ ...new Set(gate.base.map((b) => b.kind)) ].join(', ')}).` })
  return { out: `Froze slice ${s}'s AC tests at ${short(tip)}: ${[ ...testFiles, ...showFiles ].join(', ')}. Build the slice, then: factory-foreman slice review ${s}, then slice iterate ${s}.`, json: frozen }
}

// The slice's own files that base doesn't have yet: the ones a test may import before they exist.
async function ownedNew(ctx, plan, base) {
  const out = []
  for (const f of plan.files) if (!(await gitTest(ctx, [ 'cat-file', '-e', `${base}:${f}` ]))) out.push(f)
  return out
}

// ── review ──────────────────────────────────────────────────────────────────
const reviewPath = (dir, s, sha) => join(dir, 'reviews', `slice-${s}-${sha}.json`)

async function review(ctx, { positionals, flags }) {
  const saving = positionals[1] === 'save'
  const s = sliceNumber(positionals[saving ? 2 : 1], saving ? 'review save' : 'review')
  const n = ctx.issue()
  const github = ctx.github()
  const slice = await loadSlice(ctx, github, n, s)
  if (!slice?.tests) throw new Refusal(`Freeze slice ${s}'s AC tests first: factory-foreman slice tests ${s}.`)
  const config = await configAt(ctx, slice.base.sha)
  const reviewers = (config.reviewers.slice ?? []).map((r) => r.split('?')[0])
  const tip = await head(ctx)
  if (saving) {
    if (typeof flags.findings !== 'string') throw new Refusal(`Name the settled findings: factory-foreman slice review save ${s} --findings <file>.`)
    let findings
    try { findings = JSON.parse(readFileSync(flags.findings, 'utf8')) } catch (error) { throw new Refusal(`Can't read ${flags.findings} as JSON: ${error.message}`) }
    const problems = checkSettlements(findings, reviewers)
    if (problems.length) throw new Refusal(`The review can't be saved yet:\n  - ${problems.join('\n  - ')}`, { problems })
    mkdirSync(join(ctx.stateDir(), 'reviews'), { recursive: true })
    writeFileSync(reviewPath(ctx.stateDir(), s, tip), `${JSON.stringify({ slice: s, head: tip, savedAt: ctx.now().toISOString(), reviewers: Object.fromEntries(reviewers.map((r) => [ r, findings.reviewers[r] ])) }, null, 2)}\n`)
    return { out: `Saved the review of slice ${s} at ${short(tip)}. A new commit needs a new review.`, json: { slice: s, head: tip } }
  }
  const diff = await git(ctx, [ 'diff', `${slice.tests.commit}..${tip}` ], 'Reading the slice\'s diff')
  const briefs = reviewers.map((reviewer) => ({ reviewer, brief: [
    `You are the ${reviewer} reviewer. Follow your agent instructions (the ${reviewer} agent), and load the repo's standards skill for your role if it has one.`,
    `Review slice ${s} of issue #${n} at ${short(tip)}: the change since its frozen AC tests. The tests aren't yours to change, but say if one doesn't really test its criterion.`,
    '', '<diff>', diff, '</diff>', '',
    `Reply with only a JSON array of findings: [{ "id": "<short-id>", "severity": "${SEVERITIES.join('|')}", "text": "…", "where": "<file:line>" }]. Reply [] when there is nothing to fix.`,
  ].join('\n') }))
  return { out: [ `Review of slice ${s} at ${short(tip)}.`, ...briefs.flatMap((b) => [ '', `=== ${b.reviewer} (run as a subagent: the ${b.reviewer} agent) ===`, b.brief ]), '', `Settle every finding, then: factory-foreman slice review save ${s} --findings <file>` ].join('\n'), json: { slice: s, head: tip, briefs } }
}

// ── iterate ─────────────────────────────────────────────────────────────────
async function iterate(ctx, { positionals }) {
  const n = ctx.issue()
  const branchNow = await currentBranch(ctx)
  const s = positionals[1] ? sliceNumber(positionals[1], 'iterate') : Number(branchNow.match(/-slice-(\d+)$/)?.[1])
  if (!s) throw new Refusal('Which slice? factory-foreman slice iterate <n>, or run it on the slice\'s branch.')
  const github = ctx.github()
  if (inCodexSandbox(ctx.env)) throw new Refusal(`slice iterate runs the AC tests in a browser and pushes, which Codex's sandbox can't do. Ask the person to run it in their own terminal: cd ${JSON.stringify(ctx.cwd)} && factory-foreman slice iterate ${s} --issue ${n}`)
  await requireWritableGit(ctx, 'slice iterate')
  await github.appReady()
  const slice = await loadSlice(ctx, github, n, s)
  if (slice?.state !== 'open') throw new Refusal(`Slice ${s} isn't open.`)
  if (!slice.tests) throw new Refusal(`Slice ${s}'s AC tests aren't frozen yet: factory-foreman slice tests ${s}.`)
  if (branchNow !== slice.branch) throw new Refusal(`Switch to ${slice.branch} first.`)
  const tip = await head(ctx)
  // The same commit again: make sure its tag is there, and stop.
  const last = slice.iterations?.at(-1)
  if (last?.head === tip) {
    await github.ensureTag(last.tag, tip)
    return { out: `${short(tip)} is already iteration ${last.k} of slice ${s} (${last.tag}). Commit the next change first.`, json: { iteration: last } }
  }
  const dirty = (await git(ctx, [ 'status', '--porcelain' ], 'Reading the working tree')).split('\n').filter(Boolean)
  if (dirty.length) throw new Refusal(`Commit or stash your changes first; an iteration is what's committed:\n  ${dirty.slice(0, 10).join('\n  ')}`)
  const hidden = (await git(ctx, [ 'ls-files', '-v' ], 'Reading the index')).split('\n').filter((l) => /^[a-zS] /.test(l))
  if (hidden.length) throw new Refusal(`Some files are marked assume-unchanged or skip-worktree, so the working tree may not be what's committed: ${hidden.slice(0, 5).map((l) => l.slice(2)).join(', ')}. Clear the marks first.`)
  const config = await configAt(ctx, slice.base.sha)
  const { shape, design, pinned, warnings } = await approvedPair(ctx, github, n)
  if (isStale(slice, pinned)) warnings.push(`Slice ${s} is pinned to Shape ${slice.pinned.shape.version} and Design ${slice.pinned.design.version}; the approved ones are now ${pinned.shape.version} and ${pinned.design.version}.`)
  const plan = slicePlan({ shape, design }, s)
  requireTestConfig(config, plan)
  const top = await topLevel(ctx)
  const problems = []

  // Frozen tests and show scripts are exactly as frozen.
  const frozen = { ...slice.tests.files, ...slice.tests.show }
  for (const [ path, digest ] of Object.entries(frozen)) {
    const now = await ctx.exec([ 'git', 'show', `${tip}:${path}` ], { timeout: 60_000 })
    if (now.code !== 0) problems.push(`${path} was frozen by slice tests and is gone.`)
    else if (sha256(now.stdout.replace(/\n$/, '')) !== digest) problems.push(`${path} was frozen by slice tests and has changed.`)
  }
  const sinceTests = await changedFiles(ctx, slice.tests.commit, tip)
  for (const f of sinceTests) if (!frozen[f] && (matchesAny(f, config.tests.ac.files) || matchesAny(f, config.tests.show?.files ?? []))) problems.push(`${f} is a new AC test or show script; the slice's tests were frozen at ${short(slice.tests.commit)}.`)

  // Only owned and shared files, within the line budget; never the config.
  const changed = (await changedFiles(ctx, slice.start, tip)).filter((f) => !frozen[f])
  for (const f of changed) {
    if (f === CONFIG_FILE) problems.push(`${CONFIG_FILE} is the rules a slice is held to; a slice can't change it. Change it in its own pull request.`)
    else if (!plan.files.includes(f) && !matchesAny(f, config.sharedFiles)) problems.push(`${f} isn't one of slice ${s}'s files (${plan.files.join(', ') || 'none listed'}) or a shared file; change it in the slice that owns it, or amend the Design.`)
  }
  const lines = (await lineCounts(ctx, slice.start, tip)).filter((c) => !frozen[c.path]).reduce((sum, c) => sum + c.lines, 0)
  if (lines > config.budgets.sliceLines) problems.push(`The slice changes ${lines} lines; the budget is ${config.budgets.sliceLines}. Split it, or amend the Design.`)

  // A settled review of exactly this commit.
  const reviewers = (config.reviewers.slice ?? []).map((r) => r.split('?')[0])
  if (reviewers.length && !existsSync(reviewPath(ctx.stateDir(), s, tip))) problems.push(`The code review of ${short(tip)} isn't saved: factory-foreman slice review ${s}, settle every finding, then slice review save ${s} --findings <file>.`)
  if (problems.length) throw new Refusal(`Slice ${s} can't iterate yet:\n  - ${problems.join('\n  - ')}`, { problems })

  // Light checks, the AC gate, then the show scripts (read as frozen).
  const checks = await runChecks(ctx, { checks: config.checks.tiers.slice, changed, cwd: top })
  const failed = checks.filter((c) => !c.ok)
  if (failed.length) throw new Refusal(`Light checks failed:\n${failed.map((c) => `  - ${c.name} (exit ${c.code}):\n${c.tail.replace(/^/gm, '      ')}`).join('\n')}`, { checks })
  const owned = await ownedNew(ctx, plan, slice.base.sha)
  if (Object.keys(slice.tests.show).length && !config.preview) throw new Refusal('Slice ' + s + ' has show scripts, which replay against the running app: set preview in factory-foreman.config.json, for example { "start": ["npm", "run", "dev"], "url": "http://localhost:5173" }.')
  const providers = await (ctx.loadProviders ?? loadProviders)(config, top)
  const evidenceDir = mkdtempSync(join(tmpdir(), 'ffv-'))
  try {
    const gate = await (ctx.acGate ?? acGate)(ctx, { base: slice.base.sha, head: tip, tests: Object.keys(slice.tests.files), testsCommit: slice.tests.commit, owned, testIds: plan.testIds, acs: plan.acs, config, providers, evidenceDir, slice })
    if (!gate.ok) throw new Refusal(`The AC gate refused slice ${s} at ${short(tip)}:\n  - ${gate.problems.join('\n  - ')}`, { gate })
    // Show scripts must replay at head. The agent-browser provider does that
    // (with screenshots); without it they're replayed here as a plain check.
    let shows = []
    if (!providers.some((p) => p.name === 'agent-browser')) {
      const scripts = []
      for (const path of Object.keys(slice.tests.show)) scripts.push({ path, script: JSON.parse(await git(ctx, [ 'show', `${slice.tests.commit}:${path}` ], `Reading ${path}`)) })
      shows = scripts.length ? await (ctx.replayShow ?? replayShowScripts)(ctx, { scripts, preview: config.preview, cwd: top }) : []
      const unshown = shows.filter((r) => !r.ok)
      if (unshown.length) throw new Refusal(`Show scripts don't replay at ${short(tip)}:\n${unshown.map((r) => `  - ${r.path} (${r.ac}) stops at step ${r.failed.step}: ${r.failed.error}`).join('\n')}`, { shows })
    }
    const evidence = [ ...(gate.evidence ?? []) ]
    for (const p of providers.filter((x) => !x.headRun)) {
      // Each provider writes into a folder of its own.
      const out = join(evidenceDir, p.name.replace(/[^\w.-]/g, '-'))
      mkdirSync(out, { recursive: true })
      evidence.push({ name: p.name, ...(await p.collect({ ctx, slice, base: slice.base.sha, head: tip, config, top, cwd: top, out })) })
    }
    const unwell = evidence.filter((e) => !e.ok)
    if (unwell.length) throw new Refusal(`Evidence for slice ${s} at ${short(tip)} isn't right:\n${unwell.map((e) => `  - ${e.name}: ${e.summary}`).join('\n')}`, { evidence })
    return await pushIteration(ctx, { n, s, slice, tip, github, config, reviewers, checks, gate, shows, evidence, changed, lines, warnings })
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true })
  }
}

// Publishes the evidence, pushes the slice, posts the iteration and tags it.
async function pushIteration(ctx, { n, s, slice, tip, github, config, reviewers, checks, gate, shows, evidence, changed, lines, warnings }) {
  const k = (slice.iterations?.length ?? 0) + 1
  // Evidence first, on the assets branch under slices/<n>/iter-<k>/, so the
  // comment can link it pinned; a failure stops before the slice is pushed.
  const files = evidence.flatMap((e) => e.files.map((f) => ({ ...f, published: `${e.name}-${f.name}`.replace(/[^\w.-]/g, '-') })))
  const folder = `slices/${s}/iter-${k}`
  // A retry of this same head and iteration (the slice push failed after the
  // evidence went up) reuses that commit instead of publishing it again.
  const pendingFile = join(ctx.stateDir(), `evidence-slice-${s}.json`)
  let pending = null
  try { pending = JSON.parse(readFileSync(pendingFile, 'utf8')) } catch { /* none */ }
  // Reused only when it's exactly these files, byte for byte.
  const digests = Object.fromEntries(files.map((f) => [ f.published, sha256(readFileSync(f.path)) ]))
  const reuse = pending?.head === tip && pending?.k === k && pending.repo === github.repo && files.length && files.length === Object.keys(pending.files ?? {}).length && files.every((f) => pending.files[f.published] === digests[f.published])
  const published = !files.length ? null : reuse
    ? { commit: pending.commit, branch: pending.branch, url: (name) => pinnedUrl(github.repo, pending.commit, `${folder}/${name}`) }
    : await (ctx.publishAssets ?? publishAssets)(ctx, { n, folder, files: files.map((f) => ({ name: f.published, path: f.path })), message: `Evidence for slice ${s}, iteration ${k} (#${n})`, what: 'the evidence' })
  if (published && !reuse) writeFileSync(pendingFile, `${JSON.stringify({ head: tip, k, repo: github.repo, commit: published.commit, branch: published.branch, files: digests })}\n`)

  // Push, record, then tag: a rerun on the same commit only re-tags.
  await git(ctx, [ 'push', '--quiet', 'origin', `HEAD:refs/heads/${slice.branch}` ], `Pushing ${slice.branch}`)
  const tag = iterationTag(n, s, k)
  const runs = await github.runsFor(tip)
  const iteration = { k, head: tip, tag, lines, at: ctx.now().toISOString(), ...(published ? { evidence: published.commit } : {}) }
  const updated = writeSlice(ctx.stateDir(), { ...slice, iterations: [ ...(slice.iterations ?? []), iteration ] })
  const text = [
    `**Iteration ${k}** of slice ${s} at ${short(tip)} (\`${tag}\`).`,
    '',
    `- Light checks: ${checks.length ? checks.map((c) => `${c.name} ${c.skipped ? 'skipped' : 'passed'}`).join(', ') : 'none configured'}.`,
    `- AC gate: ${gate.base.length} test(s) fail at base ${short(slice.base.sha)} for the right reason (${[ ...new Set(gate.base.map((b) => b.kind)) ].join(', ')}); ${gate.head.length} pass at head.`,
    `- Code review: settled by ${reviewers.join(', ') || 'no reviewers configured'}.`,
    `- Show scripts: ${!Object.keys(slice.tests.show).length ? 'none (no visual criteria)' : shows.length ? `${shows.length} replay at head` : 'replayed by agent-browser (below)'}.`,
    `- Diff: ${changed.length} file(s), ${lines} of ${config.budgets.sliceLines} lines.`,
    `- CI: ${runs.length ? runs.map((r) => `[${inert(r.name).replace(/[[\]]/g, '')}](${r.url})`).join(', ') : 'not started yet'}.`,
    ...(evidence.length ? [ '', `**Evidence**${published ? ` (pinned at ${short(published.commit)} on ${published.branch})` : ''}:`, evidenceSection(evidence.map((e) => ({ ...e, summary: inert(e.summary ?? ''), files: e.files.map((f) => ({ ...f, label: inert(f.label), published: f.published ?? `${e.name}-${f.name}`.replace(/[^\w.-]/g, '-') })) })), (name) => published.url(name)) ] : []),
  ].join('\n')
  await postSliceRecord(github, { issue: n, slice: updated, text })
  rmSync(pendingFile, { force: true })
  await github.ensureTag(tag, tip)
  await updateChecklist(ctx, github, n)
  return { out: [ ...warnings.map((w) => `Note: ${w}`), `Iteration ${k} of slice ${s} pushed at ${short(tip)} and tagged ${tag}.${files.length ? ` Evidence: ${files.length} file(s) on ${published.branch} at ${short(published.commit)}.` : ''}`, `When the PR is approved and CI is green, the person merges it: factory-foreman slice merge ${s}` ].join('\n'), json: { iteration, gate, checks, shows, evidence: evidence.map((e) => ({ name: e.name, ok: e.ok, summary: e.summary, files: e.files.map((f) => ({ label: f.label, kind: f.kind, url: published?.url(f.published ?? `${e.name}-${f.name}`.replace(/[^\w.-]/g, '-')) })) })) } }
}

// ── merge (a person: in their chat when the harness asks them, or in their terminal) ─────────────────────────────────
const WRITE = new Set([ 'admin', 'maintain', 'write' ])
export const GREEN = new Set([ 'success', 'neutral', 'skipped' ])

async function restack(ctx, github, n, s, slice) {
  const above = await loadSlice(ctx, github, n, s + 1)
  if (above?.state !== 'open') return []
  await github.setPrBase(above.pr, slice.base.branch)
  const moved = writeSlice(ctx.stateDir(), { ...above, base: { ...above.base, branch: slice.base.branch } })
  await postSliceRecord(github, { issue: n, slice: moved, text: `Slice ${s} merged, so slice ${s + 1} now targets ${slice.base.branch}.` })
  return [ s + 1 ]
}

// Everything slice merge requires, checked; refuses with the first thing missing.
// `readOnly` (when only describing) writes nothing; `approved` counts an approval
// just posted, which GitHub's listing may not show yet.
export async function mergeChecks(ctx, github, n, s, { readOnly = false, approved = null } = {}) {
  const slice = await loadSlice(ctx, github, n, s)
  if (!slice) throw new Refusal(`Slice ${s} isn't open.`)
  if (slice.state === 'merged') {
    if (readOnly) throw new Refusal(`Slice ${s} isn't open; it is merged.`)
    // A rerun after a stop between the merge and the restack finishes the restack.
    const restacked = await restack(ctx, github, n, s, slice)
    if (restacked.length) await updateChecklist(ctx, github, n)
    throw new Refusal(`Slice ${s} isn't open; it is merged.${restacked.length ? ` Slice ${restacked.join(', ')} now targets ${slice.base.branch}.` : ''}`)
  }
  for (let k = 1; k < s; k++) {
    const below = await loadSlice(ctx, github, n, k)
    if (below?.state !== 'merged') throw new Refusal(`Merge slice ${k} first: slices merge in order.`)
  }
  const pr = await github.pr(slice.pr)
  if (pr.headRefName !== slice.branch || pr.baseRefName !== slice.base.branch) throw new Refusal(`#${slice.pr} is ${pr.headRefName} into ${pr.baseRefName}, but slice ${s} is ${slice.branch} into ${slice.base.branch}. Put its base back before merging.`)
  const sha = pr.headRefOid
  if (pr.state !== 'OPEN' && pr.state !== 'MERGED') throw new Refusal(`#${slice.pr} is ${pr.state.toLowerCase()}.`)
  if (!slice.iterations?.some((it) => it.head === sha)) throw new Refusal(`#${slice.pr}'s head ${short(sha)} isn't an iteration; ${pr.state === 'MERGED' ? `it was merged on GitHub outside the slice's checks. Record it by hand.` : `run factory-foreman slice iterate ${s} on it first.`}`)
  // The same gates whether it's merged here or was merged on GitHub already.
  const reviews = await github.prReviews(slice.pr)
  const latest = new Map()
  for (const r of reviews) if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(r.login, r)
  const blocking = [ ...latest.values() ].filter((r) => r.state === 'CHANGES_REQUESTED')
  const where = pr.state === 'MERGED' ? ' (it was merged on GitHub; record it by hand if that was right)' : ''
  if (blocking.length) throw new Refusal(`@${blocking.map((r) => r.login).join(', @')} requested changes on #${slice.pr}${where}.`)
  const approvers = []
  for (const r of latest.values()) if (r.state === 'APPROVED' && r.commit === sha && r.type !== 'Bot' && WRITE.has(await github.permission(r.login))) approvers.push(r.login)
  // GitHub won't let a PR's author approve it, so a person may approve the head
  // with factory-foreman approve slice instead, unless a second approver is required.
  const second = ctx.config().approvals.requireSecondApprover
  if (!second && approved?.head === sha && !approvers.includes(approved.login)) approvers.push(approved.login)
  if (!second) for (const login of await sliceApprovers(await github.comments(slice.pr), { permission: (l) => github.permission(l), repo: github.repo, issue: n, slice: s, pr: slice.pr, head: sha })) if (!approvers.includes(login)) approvers.push(login)
  if (!approvers.length) throw new Refusal(`#${slice.pr} isn't approved at its head ${short(sha)} by someone with write access${second ? ' in a GitHub review (this repo requires a second approver)' : `: approve it on GitHub, or, if you opened it, run factory-foreman approve slice ${s}`}. An approval of an earlier commit doesn't count${where}.`)
  const checks = await github.checksAt(sha)
  const red = checks.filter((c) => !GREEN.has(c.state))
  if (!checks.length) throw new Refusal(`No CI has reported on ${short(sha)} yet; merge once it's green${where}.`)
  if (red.length) throw new Refusal(`CI isn't green at ${short(sha)}: ${red.map((c) => `${c.name} (${c.state})`).join(', ')}${where}.`)
  return { slice, pr, sha, approvers, checks }
}

// Merges a slice that passed mergeChecks (or records one merged on GitHub), then restacks.
export async function finishMerge(ctx, github, n, s, { slice, pr, sha }, via = null) {
  const how = via ? ` (confirmed ${via === 'claude-code-ask' ? 'in the chat' : 'in a terminal'})` : ''
  if (pr.state === 'MERGED') {
    const merged = writeSlice(ctx.stateDir(), { ...slice, state: 'merged', merged: { sha, at: ctx.now().toISOString() } })
    await postSliceRecord(github, { issue: n, slice: merged, text: `**Slice ${s} merged** at ${short(sha)} into ${slice.base.branch} (merged on GitHub; checks confirmed)${how}.` })
    const restacked = await restack(ctx, github, n, s, slice)
    await updateChecklist(ctx, github, n)
    return { out: `#${slice.pr} was already merged at ${short(sha)}; recorded it.${restacked.length ? ` Slice ${restacked.join(', ')} now targets ${slice.base.branch}.` : ''}`, json: { slice: s, sha, restacked } }
  }
  if (pr.isDraft) await github.markReady(slice.pr)
  await github.mergePr(slice.pr, sha)
  const merged = writeSlice(ctx.stateDir(), { ...slice, state: 'merged', merged: { sha, at: ctx.now().toISOString() } })
  await postSliceRecord(github, { issue: n, slice: merged, text: `**Slice ${s} merged** at ${short(sha)} into ${slice.base.branch}${how}.` })
  const restacked = await restack(ctx, github, n, s, slice)
  await updateChecklist(ctx, github, n)
  return { out: `Merged slice ${s} (#${slice.pr}) at ${short(sha)} into ${slice.base.branch}.${restacked.length ? ` Slice ${restacked.join(', ')} now targets ${slice.base.branch}.` : ''}`, json: { slice: s, sha, restacked } }
}

async function merge(ctx, { positionals, flags = {}, argv = [] }) {
  const s = sliceNumber(positionals[1], 'merge')
  requireTerminal(ctx, flags, 'slice merge')
  const n = ctx.issue()
  const github = ctx.github()
  await github.appReady()
  const ready = await mergeChecks(ctx, github, n, s, { readOnly: flags['ask-ticket'] !== undefined })
  const { slice, pr, sha, approvers, checks } = ready
  const summary = pr.state === 'MERGED'
    ? `#${slice.pr} was merged on GitHub at ${short(sha)}, approved by @${approvers.join(', @')} with CI green.`
    : `Slice ${s} (#${slice.pr}) at ${short(sha)} into ${pr.baseRefName}, approved by @${approvers.join(', @')}, CI green (${checks.length} check(s)).`
  const how = await confirm(ctx, { flags, argv, bind: `merge:${github.repo}:${n}:${s}:${slice.pr}:${sha}:${pr.baseRefName}:${pr.state}`, summary, question: pr.state === 'MERGED' ? `Record slice ${s} as merged?` : `Merge slice ${s}?`, no: pr.state === 'MERGED' ? 'Not recorded.' : 'Not merged.' })
  if (how.describe) return how.describe
  return finishMerge(ctx, github, n, s, ready, how.via)
}

// ── list ────────────────────────────────────────────────────────────────────
async function list(ctx) {
  const n = ctx.issue()
  const github = ctx.github()
  const state = await loadIssue(github, n, ctx.config().approvals)
  const body = approvedBody(state.steps.design)
  const slices = body ? await allSlices(ctx, github, n, parseDraft(body)) : {}
  const rows = Object.values(slices).sort((a, b) => a.n - b.n).map((x) => `${x.n}. ${x.state}, #${x.pr}, @${x.owner}, ${x.iterations?.length ?? 0} iteration(s), Shape ${x.pinned.shape.version} / Design ${x.pinned.design.version}${x.tests ? '' : ', tests not frozen'}`)
  return { out: rows.length ? rows.join('\n') : `No slices open on #${n}.`, json: slices }
}

// Every Design slice from its PR record, for status.
export async function slicesFor(ctx, github, n, designBody) {
  return designBody ? allSlices(ctx, github, n, parseDraft(designBody)) : {}
}

const SUBCOMMANDS = { open, tests, review, iterate, merge, list }
export async function slice(ctx, args) {
  const sub = args.positionals[0]
  if (!SUBCOMMANDS[sub]) throw new Refusal(`factory-foreman slice ${Object.keys(SUBCOMMANDS).join('|')} <n>`)
  return SUBCOMMANDS[sub](ctx, args)
}
