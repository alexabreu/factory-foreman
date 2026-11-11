// The approve guard: an agent's shell may not approve, merge a slice, or
// review or merge a pull request, however the command is dressed up.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { decide, verdict } from '../apm/guard/approve-guard.mjs'

const DENIED = [
  'factory-foreman approve shape v2',
  'factory-foreman approve slice 1',
  'npx factory-foreman@latest approve slice 1',
  "gh pr comment 2 --body '<!-- factory-''foreman:record {} -->'",
  'gh pr comment 2 -Frec.md',
  "gh api graphql -f query='mutation{addComment(input:{subjectId:\"x\",body:\"y\"}){clientMutationId}}' -F body=@rec.md",
  'gh pr comment 2 --body "<!-- factory-foreman:record {} -->"',
  'gh pr comment 2 --body-file rec.md',
  'gh issue comment 2 -F rec.md',
  'gh pr comment 2 --body "$(cat rec.md)"',
  'B=x; gh pr comment 2 --body "$B"',
  'gh api repos/o/r/issues/2/comments -F body=@rec.md',
  'gh api -X POST repos/o/r/issues/2/comments --input rec.json',
  'factory-foreman --issue 7 approve slice 2',
  'factory-foreman --issue 7 approve shape v2',
  'factory-foreman approve shape v2 --issue 7',
  'factory-foreman slice merge 2',
  './node_modules/.bin/factory-foreman approve design v1',
  '/abs/path/node_modules/.bin/factory-foreman approve design v1',
  'npx factory-foreman approve shape v1',
  'npx --yes factory-foreman approve shape v1',
  'pnpm exec factory-foreman approve shape v1',
  'pnpm factory-foreman approve shape v1',
  'pnpm dlx factory-foreman approve shape v1',
  'yarn factory-foreman approve shape v1',
  'npm exec factory-foreman approve shape v1',
  'bunx factory-foreman approve shape v1',
  'node node_modules/factory-foreman/src/cli.mjs approve shape v1',
  'node --no-warnings node_modules/factory-foreman/src/cli.mjs approve shape v1',
  'FOO=1 factory-foreman approve shape v1',
  'env FACTORY_FOREMAN_REPO=a/b factory-foreman approve shape v1',
  'env -i PATH=/usr/bin factory-foreman approve shape v1',
  'true && factory-foreman approve shape v1',
  'false || factory-foreman approve shape v1',
  'echo hi; factory-foreman approve shape v1',
  'echo yes | factory-foreman approve shape v1',
  'echo hi & factory-foreman approve shape v1',
  '(factory-foreman approve shape v1)',
  '{ factory-foreman approve shape v1; }',
  'echo $(factory-foreman approve shape v1)',
  'echo `factory-foreman approve shape v1`',
  'bash -c "factory-foreman approve shape v1"',
  "sh -c 'factory-foreman approve shape v1'",
  'zsh -lc "cd x && factory-foreman approve shape v1"',
  '"factory-foreman" approve shape v1',
  "'factory-foreman' 'approve' shape v1",
  'factory-foreman "approve" shape v1',
  'fact\\ory-foreman approve shape v1',
  'factory-foreman \\\napprove shape v1',
  'command factory-foreman approve shape v1',
  'exec factory-foreman approve shape v1',
  'nohup factory-foreman approve shape v1',
  'time factory-foreman approve shape v1',
  'xargs factory-foreman approve shape < args',
  'cd /tmp\nfactory-foreman approve shape v1',
  'gh pr merge 12',
  'gh pr merge 12 --squash --delete-branch',
  'gh -R owner/repo pr merge 12',
  'gh pr review 12 --approve',
  'gh pr review --approve 12',
  'env GH_TOKEN=x gh pr review 12 -a',
  'gh api -X POST repos/o/r/pulls/12/reviews -f event=APPROVE',
  'gh api --method PUT repos/o/r/pulls/12/merge',
  'gh api repos/o/r/pulls/12/reviews -f event=APPROVE',
  'gh api repos/o/r/pulls/12/reviews -F event=APPROVE',
  'gh api repos/o/r/pulls/12/reviews --input review.json',
  'gh api --method=POST repos/o/r/pulls/12/reviews',
  'gh api -XPUT repos/o/r/pulls/12/merge',
  'gh api graphql -f query="mutation { addPullRequestReview(input: {}) { clientMutationId } }"',
  'gh api graphql -f query="mutation { mergePullRequest(input: {}) { clientMutationId } }"',
  'gh api graphql -f query="mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }"',
  'gh api graphql -F query=@merge.graphql',
  'gh api repos/{owner}/{repo}/pulls/12/merge -X PUT',
  'if true; then factory-foreman approve shape v1; fi',
  'for i in 1; do factory-foreman approve shape v1; done',
  'while true; do gh pr merge 3; done',
  '! factory-foreman approve shape v1',
  'pnpm --filter factory-foreman exec factory-foreman approve shape v1',
  'pnpm -C packages/core exec factory-foreman approve shape v1',
  'pnpm --dir packages/core exec factory-foreman approve shape v1',
  'npx -p factory-foreman factory-foreman approve shape v1',
  'timeout 30 factory-foreman approve shape v1',
  'nice -n 5 factory-foreman approve shape v1',
  'watch -n 2 factory-foreman approve shape v1',
  'sudo -u me factory-foreman approve shape v1',
  'node packages/core/src/cli.mjs approve shape v1',
  'node -r ./x.cjs node_modules/factory-foreman/src/cli.mjs approve shape v1',
  'echo "$(factory-foreman approve shape v1)"',
  'bash <<EOF\nfactory-foreman approve shape v1\nEOF',
  'eval "factory-foreman approve shape v1"',
  [ 'factory-foreman', 'approve', 'shape', 'v1' ],
  [ 'bash', '-lc', 'gh pr merge 3' ],
  [ '/bin/zsh', '-lc', "cd x && factory-foreman approve shape v1 --reason 'it's fine'" ],
  'time -p factory-foreman approve shape v1',
  'command -p factory-foreman approve shape v1',
  'sudo -n factory-foreman approve shape v1',
  'xargs -r factory-foreman approve shape v1',
  'timeout -s KILL 30 factory-foreman approve shape v1',
  'node --env-file .env node_modules/factory-foreman/src/cli.mjs approve shape v1',
  'yarn workspace core exec factory-foreman approve shape v1',
  'npm --prefix packages/core exec factory-foreman approve shape v1',
  'exec -a foo factory-foreman approve shape v1',
  'env -S "factory-foreman approve shape v1"',
  'bash <<< "factory-foreman approve shape v1"',
  'gh api graphql -f "query=$(cat merge.graphql)"',
  'gh api graphql -Fquery=@merge.graphql',
]

const ALLOWED = [
  'grep -rn "factory-foreman:record" packages/core/src',
  "gh pr comment 2 --body \"$(cat <<'EOF'\nLooks good.\nEOF\n)\"",
  'gh pr comment 2 --body "looks good"',
  'gh pr comment 2 --body "costs $5"',
  'gh api repos/o/r/issues/2/comments',
  'gh api repos/o/r/issues/2/comments -f body=hi',
  'factory-foreman checkpoint shape',
  'factory-foreman draft shape --reset',
  'factory-foreman note "approve later" --kind question',
  'factory-foreman review shape',
  'factory-foreman amend shape --reason "approve wording"',
  'factory-foreman status',
  'factory-foreman slice list',
  'git commit -m "factory-foreman approve docs"',
  'echo factory-foreman approve shape v1 is a person\'s job',
  'gh pr view 12',
  'gh pr list',
  'gh pr checks 12',
  'gh pr create --title "Merge the approve flow"',
  'gh api repos/o/r/pulls/12/reviews',
  'gh api repos/o/r/pulls/12',
  'gh api -X GET repos/o/r/pulls/12/reviews',
  'gh issue view 7',
  'ls -la',
  'git commit -m "guard: refuse; factory-foreman approve shape v1 from agents"',
  'git commit -F - <<EOF\nfactory-foreman approve shape v1\ngh pr merge 3\nEOF',
  "cat <<'EOF' > notes.md\nfactory-foreman approve shape v1\nEOF\nls",
  'gh pr create --title x --body "gh pr merge 3"',
  'echo "(gh pr merge 3)"',
  'gh api -X GET repos/o/r/pulls/12/reviews -F per_page=100',
  'gh api repos/{owner}/{repo}/pulls/12',
  'cat <<< "factory-foreman approve shape v1"',
  'sudo -n ls',
  '',
]

test('denies approving, slice merges and PR reviews or merges, however they are wrapped', () => {
  for (const command of DENIED) assert.ok(verdict(command), `should deny: ${JSON.stringify(command)}`)
})

test('allows everything else, including text that only mentions those words', () => {
  for (const command of ALLOWED) assert.equal(verdict(command), null, `should allow: ${JSON.stringify(command)}`)
})

test('Claude Code and Codex payloads are denied by exit code 2 with the reason on stderr', () => {
  // Claude Code's payload, and Codex's (it adds turn_id, model and the like).
  for (const payload of [ { tool_name: 'Bash', tool_input: { command: 'factory-foreman approve shape v1' } }, { session_id: 's', turn_id: 't', hook_event_name: 'PreToolUse', model: 'm', tool_name: 'Bash', tool_use_id: 'u', tool_input: { command: 'gh pr merge 3' } } ]) {
    const deny = decide(payload)
    assert.equal(deny.code, 2)
    assert.match(deny.stderr, /person in their own terminal\. Ask the person to run it\.$/)
    // No stdout: Codex refuses JSON with fields it doesn't know, and a refused hook lets the command run.
    assert.equal(deny.stdout, undefined)
  }
  // A stray camelCase key doesn't turn a Claude or Codex payload into Copilot's JSON form.
  assert.deepEqual(decide({ toolName: 'bash', tool_input: { command: 'gh pr merge 3' } }).code, 2)
  assert.equal(decide({ tool_input: { command: 'ls' } }), null)
  assert.equal(decide({}), null)
})

test('Copilot\'s camelCase payloads get a top-level JSON deny on stdout', () => {
  for (const payload of [ { toolName: 'bash', toolArgs: JSON.stringify({ command: 'gh pr merge 3' }) }, { toolName: 'bash', toolArgs: 'gh pr merge 3' }, { toolName: 'bash', toolArgs: { command: 'gh pr merge 3' } }, { toolInput: { command: 'gh pr review 3 --approve' } } ]) {
    const deny = decide(payload)
    assert.equal(deny.code, 0, JSON.stringify(payload))
    assert.deepEqual(Object.keys(JSON.parse(deny.stdout)), [ 'permissionDecision', 'permissionDecisionReason' ])
    assert.equal(JSON.parse(deny.stdout).permissionDecision, 'deny')
  }
  assert.equal(decide({ toolName: 'bash', toolArgs: JSON.stringify({ command: 'ls' }) }), null)
})

test('runs as a hook: exit 2 and the reason on stderr, silent otherwise, failing closed on what it can\'t read', () => {
  const guard = new URL('../apm/guard/approve-guard.mjs', import.meta.url).pathname
  const run = (input) => spawnSync(process.execPath, [ guard ], { input, encoding: 'utf8' })
  const denied = run(JSON.stringify({ tool_input: { command: 'pnpm exec factory-foreman approve shape v1' } }))
  assert.deepEqual([ denied.status, denied.stdout ], [ 2, '' ])
  assert.match(denied.stderr, /^factory-foreman approve is for a person in their own terminal\. Ask the person to run it\.\n$/)
  const copilot = run(JSON.stringify({ toolName: 'bash', toolArgs: '{"command":"gh pr merge 3"}' }))
  assert.deepEqual([ copilot.status, JSON.parse(copilot.stdout).permissionDecision ], [ 0, 'deny' ])
  for (const input of [ JSON.stringify({ tool_input: { command: 'factory-foreman status' } }), 'not json', '', '{"tool_input": {"command": "ls"' ]) {
    const out = run(input)
    assert.deepEqual([ out.status, out.stdout, out.stderr ], [ 0, '', '' ], input)
  }
  // A payload it can't read is denied when it could hold an approve or a merge.
  for (const input of [ '{"tool_input": {"command": "factory-foreman approve shape v1"', 'gh pr merge 3' ]) {
    const out = run(input)
    assert.deepEqual([ out.status, out.stdout ], [ 2, '' ], input)
    assert.match(out.stderr, /couldn't read this command/)
  }
  // Copilot's payload, unread, gets its JSON deny as well as exit 2.
  const unread = run('{"toolName": "bash", "toolArgs": "{\\"command\\": \\"gh pr merge 3')
  assert.equal(unread.status, 2)
  assert.equal(JSON.parse(unread.stdout).permissionDecision, 'deny')
})

test('the guard stays small and dependency-free', () => {
  const source = readFileSync(new URL('../apm/guard/approve-guard.mjs', import.meta.url), 'utf8')
  assert.ok(source.split('\n').length < 100)
  // No packages: only the guard's sibling and Node's own modules.
  assert.deepEqual([ ...source.matchAll(/^import .* from '([^']+)'/gm) ].map((m) => m[1]), [ './approve-ask.mjs' ])
  const ask = readFileSync(new URL('../apm/guard/approve-ask.mjs', import.meta.url), 'utf8')
  assert.ok([ ...ask.matchAll(/^import .* from '([^']+)'/gm) ].every((m) => m[1].startsWith('node:')))
})

test('the hook config wires the guard and capture for every harness APM deploys to', () => {
  const root = new URL('../apm/', import.meta.url)
  const hooks = JSON.parse(readFileSync(new URL('.apm/hooks/claude.json', root), 'utf8')).hooks
  assert.equal(hooks.PreToolUse[0].matcher, 'Bash')
  assert.match(hooks.PreToolUse[0].hooks[0].command, /guard\/approve-guard\.mjs/)
  for (const event of [ 'PreCompact', 'SessionEnd', 'Stop' ]) assert.match(hooks[event][0].hooks[0].command, /guard\/capture-hook\.mjs/)
  for (const script of [ 'guard/approve-guard.mjs', 'guard/capture-hook.mjs' ]) assert.ok(existsSync(new URL(script, root)), script)
  assert.match(readFileSync(new URL('apm.yml', root), 'utf8'), /- claude\n\s+- codex\n\s+- copilot/)
})

test('the six reviewer agents are named, scoped and each loads its standards skill', () => {
  const dir = new URL('../apm/.apm/agents/', import.meta.url)
  const expected = { 'test-verification-engineer': 'standards-testing', 'software-architect': 'standards-architecture', 'ux-designer': 'standards-ux', 'code-reviewer': 'standards-code-review', 'product-engineer': 'standards-product', 'principal-engineer': 'standards-engineering' }
  for (const [ name, skill ] of Object.entries(expected)) {
    const text = readFileSync(new URL(`${name}.agent.md`, dir), 'utf8')
    // No model: each harness uses its own session model (a Claude model name means nothing to Codex).
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\ntools: .+\\n---\\n`), name)
    assert.match(text, new RegExp(`\`${skill}\``), `${name} loads ${skill}`)
    assert.match(text, /JSON\s+array\s+of\s+findings/, `${name} answers in the brief's format`)
  }
})

test('the package stays free of any one product\'s names', () => {
  const root = new URL('../', import.meta.url)
  const files = execFileSync('git', [ 'ls-files', '--cached', '--others', '--exclude-standard', 'src', 'apm', 'README.md', 'factory-foreman.config.schema.json' ], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.ok(files.length > 20)
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), /\b(esri|arcgis|calcite|lumina|flight[- ]?components)\b/i, file)
})

test('in a Claude Code chat, approve and slice merge ask the person instead of refusing; elsewhere they still refuse', () => {
  const bin = mkdtempSync(join(tmpdir(), 'ff-bin-'))
  const asks = mkdtempSync(join(tmpdir(), 'ff-asks-'))
  // A stand-in CLI: the describe run prints what it would do and a ticket nonce.
  writeFileSync(join(bin, 'factory-foreman'), '#!/bin/sh\ncase "$*" in *--ask-ticket*) printf \'{"summary":"Approve Design v2 on #1","nonce":"%s"}\' "$(printf a%.0s $(seq 32))";; *) echo ran;; esac\n', { mode: 0o755 })
  const saved = { PATH: process.env.PATH, FACTORY_FOREMAN_ASKS_DIR: process.env.FACTORY_FOREMAN_ASKS_DIR, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR }
  process.env.PATH = `${bin}:${process.env.PATH}`
  process.env.FACTORY_FOREMAN_ASKS_DIR = asks
  process.env.CLAUDE_PROJECT_DIR = bin
  try {
    const claude = (command, extra = {}) => decide({ session_id: 's', transcript_path: '/t.jsonl', cwd: bin, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command, description: 'd' }, ...extra })
    const asked = claude('factory-foreman approve design v2 --issue 1')
    assert.equal(asked.code, 0)
    const out = JSON.parse(asked.stdout).hookSpecificOutput
    assert.equal(out.permissionDecision, 'ask')
    assert.match(out.permissionDecisionReason, /^Approve Design v2 on #1\n\nAllow confirms it as you/)
    assert.deepEqual(out.updatedInput, { command: `FACTORY_FOREMAN_ASK=${'a'.repeat(32)} ${join(bin, 'factory-foreman')} approve design v2 --issue 1`, description: 'd' })
    assert.equal(JSON.parse(claude('factory-foreman slice merge 1').stdout).hookSpecificOutput.permissionDecision, 'ask')
    // Modes that wouldn't ask, chained commands, Codex, and hand-made tickets are refused.
    assert.match(claude('factory-foreman approve design v2', { permission_mode: 'bypassPermissions' }).stderr, /In bypassPermissions mode Claude Code wouldn't ask you/)
    assert.match(claude('factory-foreman approve design v2', { permission_mode: 'dontAsk' }).stderr, /dontAsk/)
    assert.match(claude('factory-foreman approve design v2', { permission_mode: 'auto' }).stderr, /In auto mode Claude Code wouldn't ask you/)
    assert.match(claude('factory-foreman approve design v2 && echo hi').stderr, /one plain command/)
    assert.match(claude('factory-foreman approve design v2 # ok').stderr, /one plain command/)
    // The agent's text never picks what runs: no env prefixes, runner options or variables.
    assert.match(claude(`PATH=${bin}:/bin factory-foreman approve design v2`).stderr, /one plain command/)
    assert.match(claude('npx -p left-pad factory-foreman approve design v2').stderr, /one plain command/)
    assert.match(claude('NODE_OPTIONS=--require=/x factory-foreman approve design v2').stderr, /one plain command/)
    assert.match(claude('factory-foreman approve design "$V"').stderr, /one plain command/)
    assert.match(claude('factory-foreman approve design v2 &').stderr, /one plain command/)
    assert.match(claude('(factory-foreman approve design v2)').stderr, /one plain command/)
    assert.match(claude('factory-foreman approve design v2 2>&1').stderr, /one plain command/)
    assert.match(claude('factory-foreman approve design v2 <<< y').stderr, /one plain command/)
    assert.equal(JSON.parse(claude("factory-foreman approve design 'v2'").stdout).hookSpecificOutput.permissionDecision, 'ask')
    assert.equal(JSON.parse(claude('npx factory-foreman approve design v2').stdout).hookSpecificOutput.permissionDecision, 'ask')
    assert.match(claude('factory-foreman approve design v2', { turn_id: 't', model: 'gpt' }).stderr, /is for a person in their own terminal/)
    assert.match(claude('factory-foreman approve design v2 --ask-ticket x').stderr, /tickets are written and used by the approve hook alone/)
    assert.match(claude('FACTORY_FOREMAN_ASK=abc factory-foreman approve design v2').stderr, /tickets are written and used by the approve hook alone/)
    // A command carrying a live ticket is asked about again, never let through on its own.
    writeFileSync(join(asks, `${'b'.repeat(32)}.json`), JSON.stringify({ summary: 'Approve Design v2 on #1' }))
    const again = JSON.parse(claude(`FACTORY_FOREMAN_ASK=${'b'.repeat(32)} factory-foreman approve design v2`).stdout).hookSpecificOutput
    assert.equal(again.permissionDecision, 'ask')
    assert.match(again.permissionDecisionReason, /^Approve Design v2 on #1\n/)
    assert.equal(again.updatedInput, undefined)
    assert.match(claude(`FACTORY_FOREMAN_ASK=${'b'.repeat(32)} factory-foreman approve design v2; gh pr merge 5`).stderr, /one plain command/)
    assert.match(claude(`FACTORY_FOREMAN_ASK=${'b'.repeat(32)} factory-foreman approve design v2`, { permission_mode: 'bypassPermissions' }).stderr, /wouldn't ask you/)
    // Ordinary commands are untouched; without Claude Code's own marker it's not taken for Claude Code.
    assert.equal(claude('ls'), null)
    delete process.env.CLAUDE_PROJECT_DIR
    assert.match(claude('factory-foreman approve design v2').stderr, /is for a person in their own terminal/)
  } finally {
    process.env.PATH = saved.PATH
    if (saved.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved.CLAUDE_PROJECT_DIR
    if (saved.FACTORY_FOREMAN_ASKS_DIR === undefined) delete process.env.FACTORY_FOREMAN_ASKS_DIR; else process.env.FACTORY_FOREMAN_ASKS_DIR = saved.FACTORY_FOREMAN_ASKS_DIR
  }
})
