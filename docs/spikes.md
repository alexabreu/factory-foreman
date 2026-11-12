# Phase 0 spikes

One answer per spike, with what was run, so a later phase can rerun it. Scripts
live in `tools/spikes/`. Run 10 Nov 2026: A, B and D on Linux, E on macOS, and C from the docs.

| Spike | Answer | Effect on the plan |
| --- | --- | --- |
| A. agent-browser replays a show script | **Yes**, screenshots and video | The "can't record video" risk closes. Screenshots per step stay the primary evidence. |
| B. APM deploys from `node_modules` | **Yes**, but `apm audit --ci` reports false drift through pnpm's symlink | `doctor --ci` runs the audit with `--no-drift` and checks deployed file hashes itself |
| C. Hooks in Codex and VS Code | **Yes**, both block shell commands and fire at stop and session end | The guard and capture run natively in all three harnesses; `note` stays as the backup |
| D. pnpm installs a GitHub subfolder | **Yes**, but a lockfile written with SSH breaks CI without SSH | A target's CI adds a one-line https rewrite before `pnpm install` |
| E. Old artifact versions read back in full | **Yes**, every version in one call | The Changelog artifact stores diffs only; the stale-write check compares version numbers |

## A. agent-browser

`tools/spikes/agent-browser/replay.mjs` replays `fixtures/sample-target/show/AC-1.json` (open, then fill, click,
check, select, wait, each against a test id) with agent-browser **0.41.2** against the sample target's dev server.

- Every step saved a screenshot. `record start` and `record stop` saved a WebM (VP8, 30 fps), and
  `--contact-sheet` adds a timestamped PNG of the frames that changed.
- `AC-2-missing.json` targets a test id the sample doesn't have. The replay stopped at that step at once with
  `Element not found: [data-testid="clear-read"]`, keeping the screenshots up to it. That is the behavior the
  base run of a slice needs.
- About 2 seconds per step, since each step is one CLI call.
- The video only holds frames Chrome painted, so idle time shrinks: a six-second run played back in under three
  seconds. Fine as a supplement; the per-step screenshots are what a reviewer reads.
- Needs a Chromium (`agent-browser install`, or `--executable-path`) and `ffmpeg` on PATH for video.

## B. APM from `node_modules`

`tools/spikes/apm/run.sh` installs a stand-in for `packages/core` with pnpm, then runs APM **0.35.0** with
`./node_modules/factory-foreman/apm` as a local dependency and `targets: [claude, codex, copilot]`.

APM followed pnpm's symlink and deployed:

| Target | Files |
| --- | --- |
| claude | `.claude/agents/*.md`, `.claude/skills/*/`, `.claude/hooks/apm/guard/*`, `.claude/settings.json` (the `PreToolUse` hook) |
| codex | `.codex/agents/*.toml`, `.codex/hooks.json`, `.codex/hooks/apm/guard/*`, skills in `.agents/skills/*/` |
| copilot | `.github/agents/*.agent.md`, `.github/hooks/apm-claude.json`, `.github/hooks/scripts/apm/guard/*`, skills in `.agents/skills/*/` |

- Codex agents lose the `tools` frontmatter field (APM warns that the agent inherits every tool).
- `apm audit --ci` through the symlink: the drift check calls the three agent files "orphaned". The same package
  from a plain directory has no drift, so this is APM not following the symlink when it replays the install.
- Both layouts fail `content-integrity` on the `package.json` APM writes next to the hook script ("missing
  native hook container"). That file is APM's own, so `doctor` accepts this one finding until APM changes it.
- Fallback: a git subpath (`owner/repo/path#ref`, tried with `microsoft/apm/packages/apm-guide`) installs and
  passes every audit check. For factory-foreman that needs the repo to be public, or a token.

For the plan: `doctor --ci` runs `apm audit --ci --no-drift` while the package comes through pnpm, and checks the
`deployed_file_hashes` in `apm.lock.yaml` itself, so a hand-edited deployed file still fails. Report the symlink
drift to APM.

## C. Hooks in Codex and VS Code

From the current docs ([Codex hooks](https://learn.chatgpt.com/docs/hooks), [VS Code agent hooks](https://code.visualstudio.com/docs/agent-customization/hooks),
[Copilot CLI hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)), checked against what APM writes in spike B.
Versions checked: Codex CLI 0.164.0, VS Code 1.145.2.

| | Codex CLI | VS Code and Copilot CLI |
| --- | --- | --- |
| Config | `.codex/hooks.json` or `[hooks]` in `.codex/config.toml`; on by default | `.github/hooks/*.json`, and it also reads `.claude/settings.json` |
| Trust | The project's `.codex/` layer must be trusted, and each hook reviewed in `/hooks`; a changed hook is skipped until trusted again | Repo hooks need workspace admission; VS Code marks hooks Preview |
| Block a shell command | `PreToolUse`, matcher `Bash`, `hookSpecificOutput.permissionDecision: "deny"` or exit 2 | `preToolUse` (`PreToolUse` in Claude format), `permissionDecision: "deny"`; a hook that errors denies, a timeout allows |
| Stop and session end | `Stop`, `SessionEnd`, both with `transcript_path` | `agentStop` with `transcriptPath`; `sessionEnd` |
| Before compaction | `PreCompact` (`manual` or `auto`) | `preCompact` |

For the plan: the approve guard and `note --extract` run natively everywhere; the skill's `note` habit stays as the
backup. Three follow-ups for phase 2: capture on stop or compaction rather than session end, because the
transcript path isn't on every session-end payload; make extraction idempotent per session, because VS Code
reads both `.claude/settings.json` and `.github/hooks/`; and have `doctor` warn that Codex skips the guard after
each update until it's trusted again.

## D. pnpm install from a GitHub subfolder

`tools/spikes/pnpm-git/run.sh` installs `create-vite` from `vitejs/vite` at `v8.3.7` (`path:/packages/create-vite`)
with pnpm **10.33**, then reinstalls from the lockfile with `--frozen-lockfile` the way a CI runner would.

- The subfolder installs, its bin is linked, and the lockfile pins the commit and path.
- Where SSH to GitHub works when the lockfile is written, as on most developer machines, pnpm records
  `git@github.com:` as the remote, even for a `git+https://` specifier. A runner without SSH then fails the
  frozen install.
- With `git config --global url."https://github.com/".insteadOf git@github.com:` before the install, the same
  lockfile installs. A lockfile written without SSH records https and installs anywhere.

For the plan: a target adds that rewrite to every CI job that installs, and `init` should write it. The real
check (factory-foreman at its first tag, in a clean clone of a target and in its CI) runs once that tag exists.

## E. Old artifact versions

Run read-only with gh **2.103.2** against existing issues that have artifacts (issue artifacts are marked
preview in `gh`).

- `gh issue artifact view <issue> <number> --json versions` returns every version in one call, each with
  `version` (1 to N), `createdAt`, `actor`, `name` and the full `body`. For an artifact with ten versions,
  versions 1 and 10 matched the single-version downloads character for character.
- `gh issue artifact download <issue> <number> --version N --output -` prints one old version.
  `view --version N` can't be combined with `--json`.
- `list --json` has no `versions` field, so reading history is one `view` call per artifact.
- Names are versioned too: after a rename, the older versions keep the old name.
- `edit --restore-version N` saves an old version as a new one.

For the plan: diffs are computed from the history, so the `Changelog` artifact doesn't need to keep full copies,
and the stale-write check compares the version a draft started from with the latest `version`. Issue artifacts
are still preview in `gh`, so the calls stay in `github/gh.mjs` behind one function each.

# Week-1 spikes for the thin runner

Run 12 Nov 2026 on `alexabreu/alexabreu-factory-foreman-sample`, on `spike/` branches, with gh **2.103.2** and
gh-stack **v0.3.0**, using the developer's own login. No App key was used.

| Spike | Answer so far | Effect on the plan |
| --- | --- | --- |
| S1. `gh stack` on a feature branch | **Yes**: create, submit, restack, merge one slice, retarget the next; a fully merged stack can't be extended, so the next slice starts a new stack | Our restack code can go; publishing can use `gh stack` and `gh stack link` |
| S2. Publish workflow with the App | **Yes**: an App token from an environment secret; the App opened PR #9 and CI ran on it | — |
| S3. Person merges an App-authored slice; guard routes | Not run: needs S2's setup | — |
| S4. `ready` hook in Codex and VS Code | Not run: needs an interactive Codex TUI (`/hooks` trust) and VS Code | Needs a person at the keyboard, about 15 minutes |
| S5. OpenSpec deltas for a Design revision | **Partly.** Deltas describe behaviour (requirements), not design. Its validate and archive steps belong in CI | Shape revisions use OpenSpec deltas; Design revisions need our own "Changed since vN" |
| S6. Media in issue artifacts | **Yes** with the developer's login; as the App it needs **Contents: write** (the upload refused without it) | Native attachments are the route; the assets branch is only transport or fallback |

## S1. `gh stack` with a feature branch as trunk

- `gh stack init --base spike/s1-feature spike/s1-slice-1` works without prompts when the first branch is named
  (with no name it stops: "interactive input required"). `gh stack add -m` on a branch with no commits yet commits
  there instead of making a new branch.
- `gh stack submit --auto` pushed both branches and opened draft PRs #4 and #5, with #4 based on the feature
  branch and #5 on slice 1, and linked them as stack #6. The PRs are authored by whoever runs it.
- A commit pushed straight to the feature branch underneath the stack: `gh stack rebase` restacked both slices
  onto it and `gh stack push` updated the PRs, with no conflicts and no prompts.
- `gh stack view --json` gives each branch's head, base, PR and `needsRebase`, which is what `sync` needs.
- `gh stack link [--base]` links existing PRs into a stack without local tracking: the route for PRs the App opens.
- Merging a stacked PR needs GitHub's asynchronous merge API: `gh pr merge` refuses ("part of a stack and must be
  merged using the asynchronous merge REST API"). `gh stack merge 4 --squash --yes` merged the bottom slice into the
  feature branch, and GitHub retargeted the next PR (#5) onto the feature branch by itself. Merging the whole stack
  at once is refused while any PR in it is still a draft.
- Once every slice is merged, the stack can't be extended: `gh stack add` says to start a new stack with `gh stack
  init`. So with merge-as-approved (D12), a slice built after everything below it has merged starts a new stack on
  the same feature branch. That works; the feature PR still gathers them all.
- For the plan: the publish workflow merges with `gh stack merge <n>` or the async merge API, never `gh pr merge`.

## S5. OpenSpec deltas

Read from OpenSpec's own docs (`docs/writing-specs.md`). OpenSpec files are plain Markdown, which the agent writes
directly; nothing needs its CLI on a developer's machine.

- A spec is requirements (one `SHALL`/`MUST` each) with GIVEN / WHEN / THEN scenarios. A change carries
  `## ADDED`, `## MODIFIED` (the full new text) and `## REMOVED` (with why) requirement sections; archiving
  appends, replaces and drops them in the living spec.
- OpenSpec keeps the *how* in `design.md`, which has no delta format. So it fits Shape (criteria map to
  requirements and scenarios, and their revisions to deltas) but not Design: the walkthrough's Design v1 to v2
  change (the data source and a signature) is exactly the kind it leaves out.
- For the plan: Shape revisions are written as OpenSpec deltas, which also feed the archive. Design revisions get
  our own "Changed since vN" with the same three headings (added, modified, removed) over contracts, approach and
  slices. OpenSpec's own `validate --strict` and `archive` run in CI or the publish workflow (`npx` in Actions), not
  locally.

## S6. Media in issue artifacts

Tested on issue #7 ("Spike S6"), with the developer's login and `GH_DEBUG=api`.

- `gh issue artifact create … --attach <file>#<alt>` uploads each file with
  `POST https://uploads.github.com/user-attachments/assets?content_type=…&name=…&repository_id=…`, then creates
  the artifact with `POST /repos/{owner}/{repo}/issues/{n}/artifacts`. The body embeds each file as
  `![alt](https://github.com/user-attachments/assets/<id>)`.
- `gh issue artifact edit … --attach <file>` appended a second image and made version 2: a build history on the
  issue.
- The same `user-attachments` URL renders in a PR body (PR #5); GitHub serves it through a signed
  `private-user-images` link, so it needs no assets branch.
- Not yet tested: the upload endpoint with the App's installation token (inside the publish workflow), and video
  (needs ffmpeg for recordings).

## Setup a person has to do for S2, S3 and S6 (App part)

On `alexabreu/alexabreu-factory-foreman-sample`, once:

1. Make sure the factory-foreman App is installed on the repo, with **Issues**, **Contents** and **Pull requests**
   set to read and write.
2. Create an environment, `factory-foreman-publish`, limited to the `main` branch.
3. Add the App's private key to that environment as the secret `FF_APP_PRIVATE_KEY`, and its App id (or client id)
   as the variable `FF_APP_ID`.
4. Merge the spike's publish workflow into `main` when its PR is up, since a dispatch only reads the environment
   from `main`.

## S2. The publish workflow, acting as the App

Sample repo, workflow `factory-foreman-publish-spike.yml` (sample PR #8), environment `factory-foreman-publish`
limited to `main`, secret `FF_APP_PRIVATE_KEY`, variable `FF_APP_ID`.

- `actions/create-github-app-token` minted an installation token from the environment secret, scoped to the repo.
- `open-pr`: the App opened PR #9 from `spike/s2-app-pr`, authored by `app/my-factory-foreman`, and the repo's CI
  ran on it (`pull_request`), which a `GITHUB_TOKEN` PR wouldn't trigger. Because the App is the author, the
  developer can approve the PR on GitHub.
- `artifact` (S6 as the App): refused with "attaching files requires write access to the repository". The App's
  installation needs **Contents: read and write** for media uploads. Rerun once that's granted.
- `link-stack`: the App opened a second PR (#10) on top of #9, then `gh stack link --base main 9 10`, run with the
  App's token in the workflow (no local stack state), linked them as stack #11. So the developer's login pushes the
  slice branches, and the workflow opens the PRs as the App and stacks them.
- Still to run: S3's approve-and-merge by a person.
