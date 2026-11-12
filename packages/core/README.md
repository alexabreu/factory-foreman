# factory-foreman

The checkpoint CLI and the `factory-foreman` workflow skill. Stack-neutral:
anything specific to a repo comes from its `factory-foreman.config.json` and its
`standards-*` skills.

**Status: phase 2 (alpha).** Shape and Design checkpoints, reviews, amendments,
capture and the approve guard work; slices and verify arrive in later phases.

## Commands

| Command | What it does |
| --- | --- |
| `note "<text>" [--kind decision\|rejected\|question] [--blocking] [--step s] [--slice n]` | Logs a decision in your private log for the issue |
| `note --keep <id>` / `--edit <id> "<text>"` / `--drop <id>` | Confirms, rewrites or discards a note extracted from a session |
| `note --extract --transcript <path> [--session <id>] [--event <name>]` | Extracts notes from a session transcript (run by the session hooks) |
| `draft <shape\|design> [--reset]` | Prints the drafting brief and writes the draft file |
| `wireframes design` | Renders each wireframe page to PNG with agent-browser, pushes pages and images to the `factory-foreman-assets/<n>` branch, and links them in the draft at that commit |
| `review <shape\|design> [--headless]` | Prints one brief per reviewer with the draft's hash; `--headless` runs them through a command |
| `review save <shape\|design> --findings <file>` | Saves the settled findings for the draft as it is now |
| `checkpoint <shape\|design> [--draft <file>]` | Checks the draft and its saved review, and posts it as the next version |
| `amend <shape\|design> --reason "<why>"` | Changes an approved version: minor (vN.M, keeps the approval) or material (vN+1, needs one) |
| `approve <shape\|design> v<N>` | A person approves that version: in a Claude Code chat the harness asks them (see Approving from the chat), or in their own terminal it shows the criteria (or slices) and asks y/N |
| `slice open <n>` | Cuts slice n's branch and draft PR, stacked on the slice below, pinned to the approved Shape and Design |
| `slice tests <n> [--save]` | Briefs the test-verification-engineer, then freezes the AC tests and show scripts it committed |
| `slice review <n>` / `slice review save <n> --findings <file>` | Code review of the slice's head commit, settled like Shape and Design reviews |
| `slice iterate [<n>]` | Light checks, the AC gate, the saved review and the show scripts; then pushes, tags and posts the iteration |
| `approve slice <n>` | A person approves the slice PR's head (they can't on GitHub if they opened it) and it merges once CI is green |
| `slice merge <n>` | A person merges the slice once its PR is approved at the head and CI is green |
| `slice list` | Each slice: state, PR, owner, iterations and pinned versions |
| `status` | Each step's latest and approved version, open blocking questions, and slices (stale ones flagged) |

Every issue command takes `--issue <n>`, or reads it from a `factory-foreman/<n>`
branch, and `--json` for machine-readable output. A refusal exits with code 2
and says what is missing; any other error exits with code 1.

## Who posts what

Factory output (the Shape, Design, Changelog and Decisions artifacts, the
records, the issue body) posts as the factory's GitHub App. Decisions live only
in the Decisions artifact, a table with a version per checkpoint and approval;
the issue body just counts them and points there, and each Changelog entry says
how many decisions its version added. A Decisions table an older version left in
the body moves into the artifact the first time it's written. Approvals post under the approver's own
`gh` login, so a person's login only carries their own words, and an approval
counts only when it comes from the person it names and they have write access.

The App's files live in `~/.config/factory-foreman` (or `$FACTORY_FOREMAN_HOME`),
never in a repository:

- `app.json`: `{ "id": 123, "slug": "my-app", "bot": { "login": "my-app[bot]" } }`
- `app.pem`: the App's private key, `chmod 600`

The App needs Issues read and write, and must be installed on the target repo.
Without it, factory writes are refused rather than posted as you.

## Reviews

`reviewers` in the config names the reviewer agents per step; a name ending in
`?visual` is used only when there is a visual criterion. The package ships twelve, each
following the [persona contract](../../docs/persona-contract.md):
`test-verification-engineer`, `software-architect`, `ux-designer`,
`product-engineer`, `maintainer`, `code-reviewer`, the slice-review lenses
`correctness-lens`, `silent-failure-lens`, `scope-lens` and `security-lens`, the
`verifier` that judges every lens finding, and `principal-engineer` (the
implementer, which builds slices rather than reviewing them). The lenses and the
verifier replace `code-reviewer` once their eval beats it. Each loads the
repo's `standards-*` skill for its role when there is one. Steps listed in
`secondOpinion.steps` also get a brief for `secondOpinion.command`, which by
default is the other vendor's model: `claude -p` under Codex, `codex exec -`
everywhere else (give one argv, or one per harness with a `default`; Claude
Code started from inside Codex counts as Codex, so set `command` there), and
`review.headless.command` (default `codex exec -`) runs briefs for `--headless`,
which is for harnesses without subagents and for CI; Claude Code and Codex run
reviewers as native subagents by agent name. Each command reads its brief on
stdin.

A draft gets at most `review.maxRounds` review rounds (default 2) per version
it builds on. Round 1 briefs every reviewer; round 2 re-briefs only the
reviewers whose findings changed the draft, with what changed and how their
findings were settled, and their findings replace only theirs when it's saved.
A third `review` is refused: what's left is the person's to settle, or an open
question. The saved review records its round.

## Hooks

APM deploys one hook file to Claude Code, Codex and VS Code / Copilot:

- **Approve guard** (`PreToolUse` on shell commands): denies `factory-foreman
  approve`, `factory-foreman slice merge`, `gh pr review`, `gh pr merge` and
  `gh api` writes of PR reviews or merges, however they are wrapped. It stops
  honest mistakes; it isn't a sandbox.
- **Capture** (`PreCompact`, `SessionEnd`, `Stop`): on a `factory-foreman/<n>`
  branch, hands the transcript to `note --extract` in the background. It reads only what is new, asks a small
  model (`capture.claude`, or `capture.codex` under Codex) for decisions,
  rejected options and questions, and logs them unconfirmed. `Stop` waits until
  `capture.minChars` of new text. It never blocks or fails a session.
  Only what the person says is extracted (the agent's turns are context, and
  text a harness injects isn't the person); a stretch with nothing from the
  person makes no model call. A session has no person in it when it's a
  headless Claude agent (`claude -p` or the SDK), CI, or a run an orchestrator
  marks with `FACTORY_FOREMAN_NO_PERSON=1` (needed for `codex exec`, which looks
  like interactive Codex); `FACTORY_FOREMAN_PERSON=1` says a person is there
  (ignored under a headless Claude agent).
  There, capture doesn't run, notes written by hand stay unconfirmed, `note
  --keep/--edit/--drop` refuses, and checkpoint posts without the unconfirmed
  notes and names them in its comment. They're kept for the person: once kept,
  the next checkpoint posts them.

## Approving from the chat

In Claude Code, the person approves without leaving the chat. They tell the
agent to approve; it runs `factory-foreman approve …` (or `approve slice`,
`slice merge`) as one plain command. The approve hook has factory-foreman check
everything and say what would happen, then has Claude Code ask the person in
its own permission prompt: the version and its slices, or the PR's head
commit, iteration and CI. Their Allow is the approval: it's posted under their
GitHub login, marked `"via": "claude-code-ask"`. Approving a slice merges it
once CI is green.

The command must be plain: `factory-foreman approve …` (or `npx` /
`pnpm exec factory-foreman …`), with nothing before it and no chains, pipes,
redirects or variables. The hook never runs the agent's text: it runs the
factory-foreman it finds itself (`FACTORY_FOREMAN_CLI` if set in Claude Code's
environment, else Claude Code's PATH; never a copy inside the repo) with the
command's arguments, and the command that runs after Allow is that same
program, by path.

Behind the prompt is a one-shot ticket in `~/.factory-foreman/asks`, for
exactly that command and what it would act on (including who approves and,
for a merge, into which branch), good for ten minutes. The command uses it up,
and refuses if any of that changed since the person was asked. A settings
allow rule doesn't silence the prompt (tested with `claude -p`, which then
refuses). Headless and SDK runs, and the `bypassPermissions` and `dontAsk`
modes, which don't ask a person, refuse approvals outright. So does `auto`
mode for now, until it's checked that its classifier never answers the prompt
on the person's behalf; use default, acceptEdits or plan mode. Asking again
replaces the earlier ticket for the same thing.

What this stops: an agent approving or merging without the person seeing and
allowing it, approving in a mode that doesn't ask, replaying an approval, or
approving something other than what was shown. What it doesn't: a determined
agent runs as the person, with their GitHub login, and could approve through a
route the hook doesn't see (a script, curl with their token). Isolating the
agent's identity would close that; it isn't done.

Codex can't do this yet: its hooks can't ask (an "ask" lets the command run),
and its prompt rules can be answered by an automated reviewer or a remembered
"approve for session". In Codex, approving stays in the person's own terminal.

## Approving from elsewhere (relayed)

A person can also approve in a place factory-foreman can't see, such as a
decision card they tap in the Claude app. They turn this on themselves, in
their own settings file `~/.factory-foreman/config.json` (outside any repo,
theirs alone: a link, or a file others can write, doesn't count):

    { "approvals": { "relay": ["claude-app"] } }

An agent never writes that file; the approve hook refuses it if it tries.
Then the agent that saw the person's tap runs, as one plain command:

    factory-foreman approve slice 1 --relayed claude-app:<card id> --expect approve:<head shown> --as <login shown>

(or `approve <step> v<N> … --expect approve:<the version's hash>`, or
`slice merge <n> … --expect merge:<head>`). `--expect` is the action and what
the card showed, `--as` who it said approves; if any of them no longer holds,
it's refused. It's refused in CI and in runs marked as having no person. The
approval is posted under the person's GitHub login with `"via": "relayed"`,
the channel and the card's id, and a slice merges once CI is green. The
approve hook lets exactly this form through for a channel that's on, and
refuses every other approve or merge from an agent's shell.

The trust here is plain: the agent attests that the person tapped. Nothing
checks the tap itself, so a misbehaving agent could claim one. That's the same
honest-agent bar as everything else that runs under the person's login (see
Approving from the chat); the record names the channel and card, so an
approval can be traced back to what the person saw.

## Wireframes

A Design whose approved Shape has a visual criterion needs a wireframe for each
one. The drafting agent writes a small, self-contained, low-fidelity HTML page
per visual criterion at `.factory-foreman/<n>/wireframes/AC-<n>.html` (and
`AC-<n>-<state>.html` for an edge state), laid out like the real component it
extends. A page may refer only to itself (`#…`) or to `data:` URLs: no scripts,
event handlers, frames, links, fonts, images or CSS that loads anything, so it
renders offline and can't pull a local file into a pushed image.

`factory-foreman wireframes design` renders each page to PNG with
[agent-browser](https://github.com/vercel-labs/agent-browser) (`npm install -g
agent-browser`, then `agent-browser install`) and puts the pages and images in
one commit, by you, on the assets-only branch `factory-foreman-assets/<n>`
(under `design/`, on top of that branch's last commit). When a version that
pins it is checkpointed or amended, that commit is tagged
`factory-foreman-assets/<n>/<first 12 hex of the commit>`, so a posted
version's images stay reachable if the branch is deleted; a rerender nobody
posts leaves no tag. The tag is made through your gh login, which needs write access
to the repo's contents; if it can't, checkpoint still posts and prints the
`gh api` command that makes the tag. It builds and pushes that commit from a bare repo of its own,
`.factory-foreman/assets.git`, so nothing is written to your repo's `.git`: your
working tree, index and current branch are never touched, and the issue branch
never carries the assets into the product. It pushes to origin, which must name the issue's repo, with your git
credentials: the ssh command, credential helpers, http, URL-rewrite and signing
settings your repo has (from its own config, its includes, or an includeIf that
matches it) are passed on through the environment, and it signs the commit when
you sign commits. A global `core.hooksPath` pre-push hook still runs. It needs network access.
Then it writes the draft's `## Wireframes` section.

Each image's alt text carries the image's full sha256, and its link is this
repo's `design/<AC>.png` at that commit with `?raw=true`. Checkpoint reads every
pinned image back from GitHub and refuses one that's missing or doesn't match
its hash, so a posted version's images are the ones that were reviewed, and a
changed image makes an amendment material. It also refuses a Design missing a
visual criterion's wireframe, naming an unknown criterion, or holding any other
image (titled, by reference, in HTML, or outside Wireframes). Reviewers
configured with `?visual` (by default `ux-designer`) get the pinned images as
files in their brief and look at them.

## Slices

Once Shape and Design are approved, each slice of the Design is built on its
own branch, `factory-foreman/<issue>-slice-<n>`, with a draft pull request
stacked on the slice below (slice 1 on `factory-foreman/<issue>`). At most
`stackDepth` slices are open at once. A slice pins the approved Shape and
Design; the Design's checkpoint records the Shape it was written against, and
a slice won't open on a pair that doesn't match. A newer Shape awaiting
approval is a warning; once approved, slices pinned below it show as stale in
`status`, and a material amendment names the slices it affects.

1. `slice open <n>`.
2. `slice tests <n>` briefs the `test-verification-engineer`, which reads only
   the approved Shape and Design and writes the slice's AC tests (an `AC-n` in
   each test's title or file name) against its contracts' test ids, plus a show
   script per visual AC, as the slice's first commit. `slice tests <n> --save`
   freezes them: only test and show-script files, every owned AC covered, and
   each test failing at base for a reason the slice fixes (the base half of
   the AC gate), so a hollow test is caught while it can still be fixed.
3. Build the slice, `slice review <n>`, settle the findings, `slice review save`.
4. `slice iterate` refuses unless the frozen tests and show scripts are
   unchanged, the diff stays within the slice's files plus `sharedFiles` and
   `budgets.sliceLines` (and never touches `factory-foreman.config.json`), the
   review of that commit is saved, the light checks pass, the AC gate passes,
   and every show script replays. Then it pushes, tags
   `factory-foreman/<issue>/slice-<n>/iter-<k>` and the App posts the iteration
   on the PR.
5. A person runs `slice merge <n>`: the PR must be approved at its head commit
   by someone with write access, CI green there, and the slices below merged.
   GitHub won't let a PR's author approve it, so the person who opened the
   slice PR can run `approve slice <n>` in their terminal instead: it posts an
   approval of the head commit under their own login on the PR, and a new
   commit needs a new one. With `approvals.requireSecondApprover`, only a
   GitHub review by someone else counts.
   A terminal approval is only as strong as the approve guard: the guard
   refuses an agent posting a record by hand, or a PR comment whose text it
   can't see (from a file, a variable or a command's output).
   It stops an honest agent, not a determined one: a script, curl with the
   person's token, or a GitHub MCP tool isn't seen. Isolating the agent's
   credentials is the real fix, and it's deferred.
   It merges exactly that commit and retargets the slice above.

The rules a slice is held to (tests, checks, budgets, `sharedFiles`,
reviewers) are read from the config at the slice's base, so a slice can't
loosen them for itself.

**The AC gate** checks the slice's base and head out into a temporary folder
outside the repo (through a temporary index, only reading `.git`), links the
repo's `node_modules`, copies in the frozen tests and runs `tests.ac.run` on
them. It reads the JUnit reports `evidence.reports` finds, from `tests.ac.cwd`
or the repo root, and judges each failure by its message, not the code frame
quoting the test. At base every test must fail for a reason the slice fixes: an
assertion, an import of a file the slice owns and base doesn't have, or a
locator waiting for a test id the slice's contract adds (one base doesn't
quote). A test that passes at base, or fails any other way (a page that won't
load, importing an existing file under a wrong name), is refused. At head the
runner must exit 0 and every frozen file and owned AC must have a passing test.
The gate proves the tests fail before and pass after; whether they assert
enough is for the reviewers.

The AC tests' files and runner have no defaults, since they're each repo's own;
`slice tests` and `slice iterate` refuse until they're set:

```json
{
  "tests": {
    "ac": { "files": ["e2e/**/*.e2e.ts"], "run": ["npx", "playwright", "test"], "cwd": ".", "timeout": 600000 },
    "show": { "files": ["show/**/*.json"] }
  },
  "checks": { "tiers": { "slice": [ { "name": "types", "run": ["npx", "tsc", "--noEmit"], "when": "changed:src/**" } ] } },
  "preview": { "start": ["npm", "run", "dev"], "url": "http://localhost:5173" }
}
```

A contract belongs to the slice it names (`"slice": 2`), or else to every slice
owning one of its files. The truth about a slice is the App's latest record on
its pull request, found by the slice's branch; `.factory-foreman/<n>/slices.json`
is only a copy of it, never read back as truth.

## Evidence

Each iteration also publishes evidence for a reviewer, on the issue's assets
branch under `slices/<n>/iter-<k>/` (the same plumbing as wireframes: your
checkout and its `.git` untouched), linked from the iteration comment and
pinned to that commit. `evidence.providers` names who collects it; the default
is the built-in `agent-browser`, which replays each frozen show script against
the app (`preview`) at the slice's base and at its head, with a screenshot once
the page is open and another where the script ends. At head every script must
run to the end.

Other providers are packages installed in the repo and named in the config.
Core knows no test framework; `@factory-foreman/evidence-playwright` records a
video of each AC test while the gate runs them at head, through an overlay
config that imports the repo's own Playwright config:

```json
{ "evidence": { "providers": ["agent-browser", "@factory-foreman/evidence-playwright"] } }
```

A provider is a package whose default export is `{ name, collect, headRun? }`:
`collect({ ctx, slice, base, head, config, top, cwd, out })` writes files into
`out` and returns `{ ok, files: [{ path, name, kind, label }], links, summary }`;
`headRun({ run, env, cwd, config })`, if given, adjusts the gate's head run of
the AC tests, and that provider collects from the run's checkout. A provider
that isn't ok stops the iteration before anything is pushed.

## Known limitations

**The AC gate errs on the side of refusing at base.** It reads Playwright's
JUnit text, and some legitimate base failures look like ones the slice can't
fix, so they're refused (write the test another way):
- a wait on a new test id that only ends when an `afterEach` hook times out
  (Playwright says the action "ended with the test", which a click left running
  beside a hang also says);
- a new test id reached only through a regex (`getByTestId(/…/)`), a compound
  CSS selector, or a `filter({ has: … })`;
- a body timeout and an after-hook timeout in the same failure.

**Wireframes don't render inside Codex's sandbox.** agent-browser needs the
sandbox's network on to open its local socket, and even then Chrome can't start
inside Codex's sandbox without `--no-sandbox`. Under Codex, `wireframes design`
checks the pages, then refuses and gives the command for the person to run in
their own terminal; the agent then re-reads the draft, which that run updates,
and carries on. Possible solutions:

1. An opt-in setting that passes `--no-sandbox` to Chrome only under Codex:
   reasonably safe, since the pages are self-contained and can't load anything
   or run scripts, but it switches off one of Chrome's safety layers.
2. Render in CI with a GitHub Action once the pages are pushed through the
   assets repo (which still needs network): no local browser, at the cost of a
   workflow and a wait for CI.
3. Generate wireframes as SVG, which GitHub renders directly, removing the
   browser step: loses the fidelity of laying them out with HTML and CSS.
4. Revisit if Codex's sandbox gains a way to allow Chrome.

**Slices need a writable `.git` to commit.** `slice open`, `slice tests --save`
and `slice iterate` commit and push. Codex's workspace-write sandbox makes
`.git` read-only, so there they refuse until the person adds `.git` as a
writable root; `slice iterate` also runs the AC tests in a browser and refuses
inside Codex with the command for the person to run.

**Frozen tests are final.** `slice tests --save` checks each test fails at base
for the right reason before freezing, but a frozen test that turns out wrong
(it can't pass however the slice is built) has no command to unfreeze it yet:
the person closes the slice's pull request and deletes its branch, and the
slice is opened again.

**Show scripts need the preview URL free.** `slice iterate` starts
`preview.start` and refuses if something already answers at `preview.url`.

**Workspace packages resolve to your checkout.** The gate links the repo's
installed `node_modules` into its base and head checkouts. In a pnpm or yarn
workspace those link back to the packages in your working tree, so a slice
that changes a shared workspace package is tested against your copy of it, not
the base's or head's.

**Merging needs CI.** `slice merge` refuses until at least one check or status
has reported on the head commit, and all are green.

## Local state

All local state (drafts, the decision log, saved reviews and capture markers)
lives in the working tree at `.factory-foreman/<issue>/`. The folder ignores
itself with its own `.gitignore`, so it never shows as a change and is never
committed, and nothing is written under `.git`: Claude Code refuses agent edits
there and Codex's sandbox makes it read-only. State is per checkout (each
worktree has its own). It isn't kept anywhere else, so `git clean -dx` and
`git worktree remove` delete it, including notes and reviews not yet posted.
State left at the old `.git/factory-foreman/` path is copied into each checkout
once.
