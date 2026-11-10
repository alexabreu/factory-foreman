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
