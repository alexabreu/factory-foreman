// The approve guard: an agent's shell may not approve, merge a slice, or
// review or merge a pull request, however the command is dressed up.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decide, verdict } from '../apm/guard/approve-guard.mjs'

const DENIED = [
  'factory-foreman approve shape v2',
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

test('reads Claude, Codex and Copilot payloads and answers with a PreToolUse deny', () => {
  const deny = decide({ tool_name: 'Bash', tool_input: { command: 'factory-foreman approve shape v1' } })
  assert.equal(deny.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(deny.permissionDecision, 'deny')
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /person in their own terminal/)
  assert.ok(decide({ toolName: 'bash', toolArgs: JSON.stringify({ command: 'gh pr merge 3' }) }))
  assert.ok(decide({ toolInput: { command: 'gh pr review 3 --approve' } }))
  assert.equal(decide({ tool_input: { command: 'ls' } }), null)
  assert.equal(decide({}), null)
})

test('runs as a hook: prints the deny JSON, stays silent otherwise, never crashes', () => {
  const guard = new URL('../apm/guard/approve-guard.mjs', import.meta.url).pathname
  const run = (input) => execFileSync(process.execPath, [ guard ], { input, encoding: 'utf8' })
  assert.equal(JSON.parse(run(JSON.stringify({ tool_input: { command: 'pnpm exec factory-foreman approve shape v1' } }))).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(run(JSON.stringify({ tool_input: { command: 'factory-foreman status' } })), '')
  assert.equal(run('not json'), '')
  assert.equal(run(''), '')
})

test('the guard stays small and dependency-free', () => {
  const source = readFileSync(new URL('../apm/guard/approve-guard.mjs', import.meta.url), 'utf8')
  assert.ok(source.split('\n').length < 100)
  assert.deepEqual([ ...source.matchAll(/^import .* from '([^']+)'/gm) ].map((m) => m[1]), [])
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
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\ntools: .+\\nmodel: \\w+\\n---\\n`), name)
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
