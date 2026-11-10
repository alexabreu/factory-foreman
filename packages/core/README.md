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
`secondOpinion.steps` also get a brief for `secondOpinion.command`, and
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
