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
| `approve <shape\|design> v<N>` | A person approves that version from their own terminal: it shows the criteria (or slices) and asks y/N |
| `status` | Each step's latest and approved version, and open blocking questions |

Every issue command takes `--issue <n>`, or reads it from a `factory-foreman/<n>`
branch, and `--json` for machine-readable output. A refusal exits with code 2
and says what is missing; any other error exits with code 1.

## Who posts what

Factory output (the Shape, Design and Changelog artifacts, the records, the issue
body) posts as the factory's GitHub App. Approvals post under the approver's own
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
`?visual` is used only when there is a visual criterion. The package ships six:
`test-verification-engineer`, `software-architect`, `ux-designer`,
`code-reviewer`, `product-engineer` and `principal-engineer`. Each loads the
repo's `standards-*` skill for its role when there is one. Steps listed in
`secondOpinion.steps` also get a brief for `secondOpinion.command`, which by
default is the other vendor's model: `claude -p` under Codex, `codex exec -`
everywhere else (give one argv, or one per harness with a `default`; Claude
Code started from inside Codex counts as Codex, so set `command` there), and
`review.headless.command` (default `codex exec -`) runs briefs for `--headless`,
which is for harnesses without subagents and for CI; Claude Code and Codex run
reviewers as native subagents by agent name. Each command reads its brief on
stdin.

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

### Known limitation: rendering inside Codex's sandbox

Under Codex (workspace-write), `factory-foreman wireframes design` can't render:

- agent-browser's daemon socket would go in `~/.agent-browser`, which is
  read-only there. That one is handled: the socket goes in a fresh temp folder.
- With the sandbox's network off, the daemon can't open its local socket
  ("Failed to bind socket: Operation not permitted"). The command needs network
  to push anyway.
- With network on, Chrome still crashes at launch: its own sandbox can't start
  inside Codex's.

So in Codex, the agent writes the wireframe pages and asks the person to run
`factory-foreman wireframes design` in their own terminal, then carries on with
the draft it wrote. Claude Code and a terminal render as usual.

Possible fix: under Codex only, start Chrome without its own sandbox
(`AGENT_BROWSER_ARGS=--no-sandbox`). Chrome would still run inside Codex's
sandbox, and the pages it renders are static, self-contained and can't load
anything or run scripts, so the added risk is small; but it switches off one of
Chrome's safety layers, so it should be a deliberate, opt-in setting (for
example `wireframes.chromeSandbox: false` in the config), not a default.

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
