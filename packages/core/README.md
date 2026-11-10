# factory-foreman

The checkpoint CLI and the `factory-foreman` workflow skill. Stack-neutral:
anything specific to a repo comes from its `factory-foreman.config.json` and its
`standards-*` skills.

**Status: phase 1 (alpha).** Shape and Design checkpoints work; slices, reviews and
verify arrive in later phases.

## Commands

| Command | What it does |
| --- | --- |
| `note "<text>" [--kind decision\|rejected\|question] [--blocking] [--step s] [--slice n]` | Logs a decision in your private log for the issue |
| `draft <shape\|design> [--reset]` | Prints the drafting brief and writes the draft file |
| `checkpoint <shape\|design> [--draft <file>]` | Checks the draft and posts it as the next version |
| `approve <shape\|design> v<N>` | A person approves that version, from their own terminal |

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

## Local state

Drafts and the decision log live under `$(git rev-parse --git-common-dir)/factory-foreman/<issue>/`,
shared by every worktree of a clone and never committed.
