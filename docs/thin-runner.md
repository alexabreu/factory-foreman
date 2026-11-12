# factory-foreman: the thin runner

This is the plan for factory-foreman's next version: what it's for, how it's put together, which tools do which
job, and what changes from the prototype on `main`. It's the working reference for building it. Decisions, with
their sources and history, are in [decisions.md](decisions.md).

It follows the vision document "factory-foreman: vision, proposal and plan review" (12 Nov 2026), which revised
the first draft of this plan after an independent review. Nothing below was live-tested unless it says so.

## Contents

1. [What we're building](#what-were-building)
2. [Four layers](#four-layers)
3. [One feature, end to end](#one-feature-end-to-end)
4. [Changing course](#changing-course)
5. [Checks: what each is for](#checks-what-each-is-for)
6. [The trail](#the-trail)
7. [The thin runner](#the-thin-runner)
8. [The factory-foreman GitHub App](#the-factory-foreman-github-app)
9. [What GitHub shows](#what-github-shows)
10. [Toolchain](#toolchain)
11. [Harness tiers](#harness-tiers)
12. [Extensibility](#extensibility)
13. [Repeatability](#repeatability)
14. [Recovery and cost](#recovery-and-cost)
15. [Changes to the codebase](#changes-to-the-codebase)
16. [Milestones](#milestones)
17. [Risks and open questions](#risks-and-open-questions)
18. [Working agreements](#working-agreements)

## What we're building

factory-foreman's value isn't its gates. It's a **decision trail that travels with the work**. Every checkpoint is
a snapshot of what was decided, why, and with what (who, harness, model, effort, tokens, time). Every change after
that is a recorded delta against the snapshot, with its reason. All of it reaches GitHub, where reviewers already
look. The structure keeps work moving and makes every feature look the same. It never stops anyone from changing
course.

The product is a human-in-the-loop automated SDLC with five properties:

| Property | What it means here |
| --- | --- |
| Consistent | Every feature, on every team, goes through the same stages and produces the same artifacts |
| Transparent | Snapshots, deltas, reasons and provenance are on the issue and the PRs, not only on a laptop |
| Flexible | Anything can change at any point. The change is captured, not refused |
| Reliable | Each slice comes with evidence a person can see: tests, and before/after screenshots and a recording of its checkpoint |
| Repeatable | The same prompts, profiles and steps give comparable results, and prompt changes are measured |

A step that blocks a change is out of line with this. A step that records the change is in line with it.

### What it gives a developer

- **Stay in the harness.** Shape, design, build, review and publish all happen from Claude Code or Codex. The
  only interruption is one question when something is ready.
- **Change your mind freely.** A slice can rewrite an earlier slice, and a Design can move to v3 halfway through.
  The factory records it, drafts the reason, and shows the delta.
- **Hand over work a reviewer can trust.** Each slice arrives as a small PR with its criteria, tests, a demo and
  what changed since the plan it started from.
- **Answer "why is it like this?" months later.** Every decision, change, reason and review outcome is on the
  issue and PRs, with the model, effort, tokens and time behind it.
- **The same flow on every team, tuned to their stack.** One versioned factory installs into any harness; teams
  add standards and checks without forking it.

### Principles

1. **The value is in the trail:** snapshots, deltas, reasons and evidence.
2. **Record, don't refuse.** A rule that would block a change records it instead, with a reason the agent drafts.
   Denial is kept only for what must never happen: an agent merging anything (the base branch, or slices, which
   only the App merges), an agent approving a PR, an agent writing approval events or hook configuration, and
   writing the person's own settings.
3. **Borrow text, not workflows.** Where another project prompts better, take its words. Don't install a second
   workflow that competes with ours.
4. **One owner per job.** Never two tools doing the same job (two spec formats, two planning flows, two review
   posters, two runs of the same check).
5. **No vendor lock-in.** Claude Code and Codex are both first-class targets (see [Harness tiers](#harness-tiers)
   for where they differ today). State is plain files. Every step is a CLI command, so any orchestrator could
   sit on top later.
6. **Small, visible slices.** Agents generate faster than people review. Slices are small, vertical, best-effort,
   and each has a demo a person can see.
7. **Write code only where it adds value.** Everything outside the trail and the stage order is picked, not built.

## Four layers

Each layer has one job, and each tool sits in exactly one layer.

| Layer | Job | Pieces | Build or pick |
| --- | --- | --- | --- |
| 1. Harness | Where the developer and the agent work | Claude Code, Codex, Copilot / VS Code; the Claude app for answering on the go | Pick |
| 2. Factory contract | The same stages, prompts and checks everywhere, at a known version | factory-foreman CLI and skill (stage order, drafts, revisions, publish, sync); personas and hooks packaged with APM; profiles per stack; prompt text borrowed from Archon, Tessl, spec-kit, OpenSpec, superpowers and our predecessor | Build the CLI, skill and profiles; pick APM; borrow the text |
| 3. Trail | Snapshots, deltas, reasons and provenance that outlive the session | The ledger; the trail branch; harness transcripts for model, effort, tokens and time; the publish workflow, posting as the factory-foreman GitHub App to issue artifacts and PR bodies; sync bringing GitHub back | Build the ledger, templates and publish workflow; pick the App, gh and issue artifacts |
| 4. Evidence and review | A visible checkpoint per slice, and holistic review as you go | gh stack; agent-browser capturing each slice locally at base and head; Playwright (or the profile's runner); the repo's CI test report (or an optional AC-check job); review personas with borrowed evidence rules; Tessl review as an optional second opinion | Pick |

The **factory version** is five things together: the factory-foreman package tag, the APM lockfile, the publish
workflow's ref, the AC-check job's ref (when used), and the repo's `factory-foreman.config.json`. All five are written
into every trail record, so "which factory made this" always has an answer.

No existing tool does layer 3. It's the reason factory-foreman exists, and it's where most of our code goes; layer 2
holds only the thin CLI, the skill and the profiles.

## One feature, end to end

The developer talks to one agent in their harness and never types a factory-foreman command; the agent runs the
CLI. Factory output posts to GitHub as the App; the developer's own words post as themselves.

| Step | What the developer does | What happens | What lands in the trail |
| --- | --- | --- | --- |
| 1. Start | Points the agent at an issue, or describes an idea | `start` creates the feature branch `factory-foreman/<n>` and local state, reads the issue (or drafts one in the team's template and asks "open this issue?"), looks through the code first, and syncs | Feature opened, factory version |
| 2. Clarify | Answers up to 5 questions, each with a recommended default | Clarifying protocol; harness question UI | Each question, its options, the recommendation, the answer and who gave it |
| 3. Shape and Design | Talks it through, then answers "publish Shape v1? / Design v1?" | Personas draft; holistic review with the evidence bar; the App publishes the artifacts | Shape v1 and Design v1 snapshots, finding outcomes, provenance |
| 4. Slice 1 | Watches or leaves; settles findings; answers "publish slice 1?" | Tests written first and checked red at base; implementer brief; holistic review; slice branches pushed with `gh stack`; agent-browser captures the before/after locally; the publish workflow opens the PR as the App; CI posts the per-criterion check | The slice snapshot, red-at-base and green-at-head results, demo, finding outcomes, provenance |
| 5. Review on GitHub | A teammate (or the developer) reviews slice 1 like any PR | GitHub review; `sync` brings comments into the next session as findings to settle | Each comment and how it was settled, with the reply on the thread |
| 6. Change of course | Answers "publish Design v2?" with the drafted reason shown | `revise design` drafts v2 with the delta and what it touches | Design v2, the delta against v1, the reason, and the affected slices and tests |
| 7. Slice 2 | Same as slice 1. It changes slice 1's code and one of its tests | Same tools; the guard records the test edit instead of blocking it | "Changes to earlier slices", with reasons, in the PR |
| 8. Feature PR | Reviews the whole feature once | Feature review with a per-criterion verdict and an exploratory pass; the App opens the feature PR | How the plan evolved, the verdict, the provenance roll-up; the ledger published |
| 9. After merge | Nothing | OpenSpec archive updates the living spec (M4) | Current behaviour described in the repo |

The developer's input is one question round, a tap at each ready point, the GitHub reviews, and their own
judgment when things change.

## Changing course

The forward path is the default. Going back is a normal move, not an exception.

- **`revise shape` and `revise design`**, usable at any stage. The agent drafts the next version, computes the
  delta against the last published one, and lists what it touches: criteria, slices already merged into the
  feature branch, tests, and slices still to come. The person gets the usual prompt with the **drafted reason**
  shown, to confirm or edit. On publish, the artifact opens with "Changed since vN, because …". Work carries on in
  the same stack; nothing is redone unless the delta says so.
- **Holistic review feeds forward.** Every slice review writes a short "what this changes" note: earlier code to
  revisit, a criterion that now reads differently, a slice to split or drop. Each note becomes a proposal for the
  next slice or a revision. The ledger records both (a `review-note` event and a `proposal` event linked to it, then
  the decision that settles it), so feed-forward is traceable.
- **Fixes to a slice whose PR is still open update that PR.** Only **merged** slices get changes carried forward:
  those land in the current slice's PR, under "Changes to earlier slices", with the files, the reason, and any test
  that changed. Merged PRs aren't rewritten.
- **Tests can change.** The tests are the current snapshot of "done". Changing one records the old and new
  assertion, the reason, the criterion, and the Shape or Design version that caused it, and the slice PR shows it.
- **Discoveries end as a decision:** in this slice, a later slice, a revision, or a follow-up issue.
- **Reopening a decision** adds a new entry that supersedes the old one and links to it, with the reason.
- **Reasons are cheap.** The agent drafts every reason from the conversation; the person confirms or edits it in
  the same prompt.
- **The delta format:** OpenSpec's added / modified / removed requirements against the current spec. To be tested
  on a real Design revision before M1 (spike S5).

## Checks: what each is for

Every check stays only where it keeps work moving or catches real defects. Each is a **default a profile can
tune**, and going past it is recorded with a reason, not refused.

| Check | What it's for | Default | Going past it |
| --- | --- | --- | --- |
| Red at base, green at head | Evidence the tests describe what this slice adds, not what already exists | On. "Red for the right reason" is judged by a profile adapter (today's `gate.mjs` is web-shaped; a refactor slice's tests should pass at base) | Recorded with a reason |
| Tests written before the code, from Shape and Design only | Tests describe what was agreed, not what was built | On | Later edits allowed and recorded |
| Slice files | Keeps a slice reviewable | Files outside the slice are listed as "changes to earlier slices" or "outside the plan" | Never blocked; listed with a reason |
| Slice size, 400 changed lines | Keeps a slice reviewable | Warning | Over is fine with a reason |
| Review rounds, at most 2 | Rounds that end | After the cap, open disagreements go to the person | The person decides; recorded |
| Evidence bar on findings | Fewer, truer findings | On; the profile tunes the bar | A person can raise a finding below the bar; recorded |
| Demo per slice | A person can see it working | Required field in Design, kind chosen by the slice | A slice with no visible output says why (for example, a refactor shows its tests and a before/after) |
| Feature-branch rules | Slices reach the feature branch through a PR | The ruleset in [Setup](#publishing-model-decided-d21) | The person can relax it per repo; `doctor` records the ruleset state |
| Merge to base | The base branch only changes through a reviewed feature PR | Always | Never by an agent |
| Cost per stage | Stops runaway token use | Budget in config, warning at 80% | Over budget asks the person; recorded |

**One owner per check.**

- **Locally:** red-at-base, and the **visual checkpoint**. An agent-browser step builds and runs the app at base
  and at head, captures before/after screenshots and a short recording of the slice's checkpoint, and computes the
  visual delta (`diff screenshot`). These are attached to that slice's issue artifact and shown on the slice PR, through the publish
  workflow; the trail keeps their hashes and links.
- **Green at head**, by default, comes from the repo's own CI test report when there is one, or else from the local
  green-at-head run recorded in the trail. factory-foreman doesn't need to know how a repo builds or tests. An
  optional AC-check job turns either into a per-criterion check run on the PR (with `GITHUB_TOKEN`) for teams that
  want one.
- **Builds and previews belong to the repo's own CI.** There's no Esri standard for staging (GitHub Pages, AWS and
  others are all in use), so factory-foreman doesn't build or host previews. If the repo's CI produces a deployment,
  GitHub already shows it on the PR, and the slice PR body links it when present. It doesn't go onto the issue.

## The trail

### Local: the ledger

Working state lives in `.factory-foreman/<issue>/` (self-ignoring, per checkout). What's published is committed
separately, to the trail branch (see [Publishing model](#publishing-model-decided-d21)).

| File | Contents |
| --- | --- |
| `ledger.jsonl` | Append-only events: snapshot, revision (with its delta and reason), question asked and answered, finding and its outcome, review note and the proposal it becomes, test changed, check run, published, synced. Each event carries the factory version and its provenance |
| `shape.md`, `design.md` | Current drafts (published versions are committed as `shape.v<N>.md`, `design.v<N>.md`) |
| `reviews/` | Review rounds and finding outcomes |
| `slices/<n>.json` | Slice state: tests, iterations, head, PR |
| `sync.json` | GitHub cursors and ETags |

Decisions, approvals and the Changelog are derived from the ledger; there's no separate local file for them.

Every decision is recorded in one shape, borrowed from Archon's attention items: **question, options, a
recommendation with its reason, the answer, who gave it, and when.**

Every review finding ends with one of three outcomes, borrowed from Tessl: **fixed, refuted** (the claim was
false) or **declined** (true, but not here, with the reason). A refuted or declined finding isn't raised again in a
later round.

### Issue artifacts

Issue artifacts are versioned documents attached to the issue, and the public home of the trail. Every old version
reads back in full ([Phase 0 spike E](spikes.md)), so a delta between two versions can always be recomputed. Records
are no longer posted as comments: each kind of record has an artifact. Transcripts stay local; published records
carry their session ids.

| Artifact | What it holds | When it's written | How a revision renders | Committed snapshot file (trail branch) |
| --- | --- | --- | --- | --- |
| **Shape** | Problem, who it's for, out of scope, criteria with example values | Each `publish shape` / `revise shape` | A new artifact version. It opens with "Changed since vN": each added, modified or removed item, with its reason and a link to the decision; the snapshot follows | `shape.v<N>.md`. The artifact version is published from the file at a commit, and its footer names that commit |
| **Design** | Approach and the rejected option, contracts and signatures, code to reuse, slices with demo contracts; wireframe images attached | Each `publish design` / `revise design` | The same: "Changed since vN" with what each change touches (criteria, merged slices, tests, slices to come), then the snapshot; changed wireframes attached again | `design.v<N>.md`, same rule |
| **Decisions** | Every decision in the attention-item shape (question, options, recommendation and why, answer, who, when); reopenings supersede and link | As each decision is made | Append-only rows; a superseded row is marked and links to its replacement | None; derived from the committed ledger events |
| **Changelog** | One entry per published version or revision: what changed, why, and which slices it touches | On every publish | Append-only; each entry links the two artifact versions it compares | None; built from the committed snapshots and decisions |
| **Slice k** (new, one per slice) | The slice's **evidence history**: its criteria, demo contract, PR, red-at-base and green-at-head results, finding outcomes, changes to earlier slices, approval and merge, and for every publish the **before/after screenshots, the recording and the visual delta**, attached | When the slice is published (each publish appends that build's evidence), approved and merged | Each publish appends a dated entry with that build's media; the artifact's version history keeps every build | `slices/<k>.json` (media on the assets branch) |
| **Verification** (new) | The feature review: a met / unmet / deferred verdict per criterion with evidence, the exploratory pass's findings, and the final before/after of the whole feature, attached | When the feature PR opens, and again if it changes | A new version per review | `verification.v<N>.md` |
| **Ledger** (new) | The full event log, with provenance on every event | When the feature closes | One version per export | `ledger.jsonl` (transcripts stay local) |

Records that aren't issue artifacts:

| Where | What | When |
| --- | --- | --- |
| Issue body | Stage, links to every artifact and PR, provenance roll-up | On every publish |
| Slice PR body | What the slice delivers, before/after screenshots and recording, changes since its Design, changes to earlier slices, provenance | On publish |
| Check run (optional) | Per-criterion results at the slice head | From the optional AC-check job |
| Feature PR body | Plan history, per-criterion verdict, provenance roll-up | When the feature PR opens |

Slice records, including the screenshots, recordings and visual delta, go to that slice's **Slice k** artifact
on the issue, so the build history lives on the issue. The slice PR body shows the latest build's media and links
the artifact.

Optionally, **issue fields** (GA) hold the feature's stage, slices merged out of planned, and the factory version,
so a project board can show them.

**Trail branch layout** (`factory-foreman-trail/<n>`, folder `trail/`): `shape.v<N>.md`, `design.v<N>.md`,
`ledger.jsonl` (events, including captured approvals), `slices/<k>.json`, `verification.v<N>.md`. Each file kind has a
JSON Schema in the package, which the workflow validates against; writing the schemas is part of M1.

**How media gets to the issue and the PR.** The expected route is **native media in the issue artifact**: issue
artifacts show images and video, and `gh issue artifact create` and `edit` take `--attach <image or video>` (an edit
with only `--attach` appends as a new version). Spike S6 first checks how artifacts accept images and video
programmatically with the App's token in the publish workflow.

1. **Getting the files to the workflow:** the CLI pushes screenshots, recordings and visual deltas with the
   developer's login to the media-only branch `factory-foreman-assets/<n>` (the prototype already does this, in
   `src/assets/publish.mjs`). That branch is transport only and is never merged; the trail records each file's hash
   and the pinned commit. No media is on the trail branch, and none merges into base.
2. **On the issue:** the publish workflow reads the files at that commit and attaches them natively to the slice's
   issue artifact.
3. **On the PR:** the slice PR body embeds the same media, linking the attachment URLs if they're viewable from a
   PR, since GitHub has no documented REST API for uploading attachments to a PR.
4. **Fallback, only if native attachment fails in S6:** the issue artifact and the PR body embed the pinned
   assets-branch URLs instead.

Workflow-dispatch inputs are short strings, so media never goes through them.

### Provenance

Per step: harness, model, effort, tokens in and out (including thinking), wall time, session id, and the factory
version. Read from the Claude Code transcript (`message.model`, `message.usage`, `effort`, timestamps) and the
Codex rollout (`turn_context`, `token_count`), or from ccusage. These are internal formats, so the parser records
`unknown` rather than guessing, and is tested against fixtures for each harness version. Before publishing,
provenance is scrubbed of paths and anything that looks like a secret. It appears as a collapsed footer on every
App-authored record. Commits, PR boilerplate and comments carry no attribution lines.

## The thin runner

There's no runner process. Four things do the job:

1. **The skill** tells the agent the stage order, how to use each command, and how to change course.
2. **The CLI** keeps the stages in order. Forward is the default; `revise` is the way back. It never skips a record:
   publishing a slice whose Design isn't published yet publishes the Design first. Everything else is allowed.
3. **The harness** is the loop: it runs the agent, subagents and the question UI.
4. **Hooks** (packaged with APM) add what the harness doesn't do by itself:

| Hook | Events | What it does |
| --- | --- | --- |
| `sync` | SessionStart, and UserPromptSubmit rate-limited | Pulls new GitHub comments, reviews and check results since the cursor and gives the agent a "since you last looked" note |
| `ready` | Stop | A nudge, not a check: reads the readiness result that `slice iterate` (or `publish --check`) cached. When something is ready and the person hasn't been asked about this exact version or head, it asks the agent to put the readiness question, which names the slice's patch id so the answer can be matched. Uses `stop_hook_active` so it never loops, and is idempotent when VS Code reads both `.claude/settings.json` and `.github/hooks/` |
| `capture` | PreCompact, SessionEnd, Stop; PostToolUse on the harness's question tool; UserPromptSubmit | Decision capture (existing), provenance for the current stage, and **approval events**: written only here, from the question tool's result or a card answer the platform attests. Free text from relayed or peer-session messages is recorded but never counts as an approval |
| `guard` | PreToolUse | **Records** edits to tests and to earlier slices' files and asks the agent for a reason. **Denies** only the denials in principle 2: an agent merging (`gh pr merge`, `gh stack merge`), approving a PR (`gh pr review --approve`, the reviews API), writing approval events or the ledger directly, editing hook configuration (`.claude/settings*.json`, `.codex/hooks.json`, `.github/hooks/`, the APM-deployed hook files), and writing the person's own settings (`~/.factory-foreman`, `~/.claude`, `~/.codex`) |

### The readiness question

"Publish slice 2? (publish / not yet / changes)", with the drafted reason when it's a revision.

- Claude Code: AskUserQuestion. Codex: its question UI, or one short chat question. The Claude app: a decision
  card. The agent never tells the person to type or run a command.
- The answer is recorded in the decision shape above. "Not yet" isn't asked again until the version or head
  changes. "Changes" becomes notes to work on.
- In chat, plain words ("approve slice 2") are the same answer.

### Merge authority

- **In M1, the person merges slice PRs on GitHub.** The App authors the PRs, so the developer (or a teammate) approves
  and merges natively, and `sync` records the merge in the trail. Nothing more is needed to start.
- **Later, only if real use shows the need:** the App merges a slice after a recorded answer. Slices into the feature
  branch then need one of:
  - the person's approval from the readiness question or a card, captured by the `capture` hook and matched to the
    slice's **patch id** (its diff against its base), so a server-side rebase of the stack doesn't invalidate it; or
  - an approval on the slice PR by a teammate, meaning a person with write access other than the developer whose
    login dispatches the workflow.

  Then **the App performs the merge** through the publish workflow, with `PUT /pulls/{n}/merge` and `sha=` set to
  the head it checked, so a push in between makes the merge fail. Never the agent's own `gh` command.
- **The feature PR into the base branch:** GitHub's normal review and merge. A person decides.
- **Why not an allow rule:** allow rules for `factory-foreman approve` and `factory-foreman slice merge` were tried
  on 11 Nov; Claude Code's auto mode still blocked the agent's merges after a relayed tap ("Merge Without Review").
  The merge has to happen outside the agent.
- **Either way, never the agent.** If the App's merge is ever adopted and fails, the person merges on GitHub.

### Threat model

The guards stop **accidents and drift**, not a hostile agent. The agent runs with the developer's git push rights
and `gh` login, so it could in principle write any file the CLI writes, or approve a PR as the developer. The guard
denies the obvious routes (above), and the workflow checks every input (below), but a determined agent could get
around a hook. That's why:

- a GitHub approval counts only from someone other than the dispatching login;
- solo work relies on the captured answer, which is good evidence of intent but not proof;
- the feature PR into the base branch always goes through a person's GitHub review.

## The factory-foreman GitHub App

The App is the factory's own identity on GitHub. It keeps factory output apart from people's words, and because it
authors the PRs, the person can approve them on GitHub.

| Job | What the App does |
| --- | --- |
| Publishing snapshots and deltas | Writes issue artifacts and the issue body |
| Opening PRs | Opens slice and feature PRs, so the person can approve them on GitHub |
| Merging slices (later) | Merges an approved slice once the recorded approval matches the slice's patch id; in M1 the person merges on GitHub |

**No App key on a laptop.** The prototype keeps `app.pem` in `~/.config/factory-foreman` and signs locally. The new
version drops this; the key exists only as a GitHub environment secret.

### Publishing model (decided, D21)

The App's key never touches a developer's machine. Everything the App does runs in one publish workflow.

1. **The CLI commits snapshot files** (Shape, Design, ledger events including captured approvals, slice
   records) to the **trail branch** `factory-foreman-trail/<n>`, not the feature branch, so publishing never moves the
   stack's trunk. It **pushes with the developer's own login** and **dispatches the publish workflow** with inputs:
   the trail commit's SHA, the operation (`publish`, `open-pr` or `merge`) and a correlation id. The run's
   `run-name` includes the correlation id, so `sync` can find it.
2. **The workflow** mints a short-lived App token with `actions/create-github-app-token`, scoped with `repositories:`
   and `permission-*` inputs to this repo and this run's needs. It checks its inputs, **reads the files at that SHA
   only**, **validates them against the schemas**, and **posts as the App**: issue artifacts, the issue body, slice
   PRs, the feature PR, and slice merges after a recorded approval. It records `github.actor` as the person it acted
   for.
3. **Stacking:** the developer's login creates and pushes the slice branches locally with `gh stack`; the workflow
   opens or updates their PRs as the App and links them into the stack, or uses the REST API if `gh stack` can't
   (spike S2).
4. **`sync` reads back with the developer's own `gh` login.** No App token is needed locally.

**Input checks in the workflow**

- The SHA is 40 hex characters and reachable from `factory-foreman-trail/<n>` (compare API).
- Every file read is under `trail/` and matches its schema.
- A captured answer's "who" equals `github.actor`. (When the App's merge is adopted later, an approval must also
  name the slice's patch id and match the PR's current diff.)
- Inputs reach scripts through environment variables, never interpolated into `run:` lines.

**Safeguards**

- **The key lives in a GitHub environment secret**, not a plain org secret (a plain org secret can be read by any
  workflow on any branch). The environment's deployment branches are limited to the default branch, so a run
  dispatched from another branch with an edited workflow can't read it. That policy, not a convention about which
  ref to dispatch on, is what protects the key.
- One central, reusable publish workflow, called with a `uses:` line pinned to a tag or SHA.
- CODEOWNERS on `.github/workflows/` and on `.github/CODEOWNERS` itself, with "Require review from Code Owners" on
  the default branch. The central workflow's repo is protected the same way.
- The App's permissions kept to the minimum below.

**Known limits**

- `GITHUB_TOKEN` can open PRs where the repo allows it, but those PRs don't trigger workflows and are authored by
  `github-actions[bot]`. The App token is required for PRs.
- Check runs come from the AC-check job, which runs on the PR and can't read the environment secret. It posts with
  `GITHUB_TOKEN` (`checks: write`), so checks show under GitHub Actions rather than the App.
- The rule "require approval of the most recent push by someone other than the pusher" stays **off** on feature
  branches in solo work: the developer pushes the slice branches, so their own approval could never satisfy it. It
  also applies only to the bottom PR of a stack, since the upper PRs target the slice below.
- Publishing takes a workflow run, so it's slower than a local call.

**Setup**, one time, by a repo or org admin:

1. Install the App on the repo.
2. Create the environment with the key as its secret, limited to the default branch.
3. Add the caller workflow, and allow access to the central workflow repo in its Actions settings.
4. Add CODEOWNERS and the default-branch rule.
5. Optional, only when the App's merge is adopted: add the feature-branch ruleset. It targets `factory-foreman/*` but excludes `factory-foreman/*-slice-*`;
   requires a pull request; restricts updates, not creations, so `start` can create the branch; and lists the App
   as a bypass actor for pull requests only, so the person's fallback merge on GitHub still works.

Developers never handle the key.

**Open questions** (not blocking):

- Who can create environments and set secrets in the ArcGIS org's repos, and which repos have the App installed.
- Whether the key is copied into each repo's environment, or lives once in a central publisher repo that mints
  tokens for target repos.
- Whether the trail branch is merged into the base branch when the feature closes (as the repo's own copy of the
  trail), or kept as a branch plus the Ledger artifact.

**App permissions** (smallest set, to confirm in S2): Issues read and write; Contents read and write; Pull requests
read and write; Metadata read (implicit); Workflows write only if slices may change `.github/workflows`. The issue
artifacts API's permission name is to confirm. Setting the ruleset needs admin rights, used once at setup, not an
App permission.

## What GitHub shows

Rendered from templates and checked before posting: markdown lint, link check, length budgets (including the issue
body's), a preview through
GitHub's `/markdown` renderer, an editor pass that cuts restated or empty content, and snapshot tests.

- **Issue body:** compact and scannable, never a novel. Full history lives in the artifacts, not the body. Layout,
  top to bottom:
  1. **Status header**, a few lines: the stage, the current slice, what needs the person (if anything), and what
     changed since they last looked.
  2. **The newest change first:** a short "Changed since vN" delta for the latest publish, linking the artifact
     version that has the detail.
  3. **One collapsible section per artifact** (Shape, Design, each slice, Decisions, Changelog, Verification),
     collapsed by default, each with a one-line summary and a link to the full artifact. Media stays in the slice
     artifacts; the body shows at most a thumbnail of the latest slice's after-screenshot.
  4. **Provenance roll-up**, collapsed: time and tokens per stage.

  **Budget:** at most 3,000 characters of Markdown and one image. The pre-publish check moves anything over budget into the
  relevant artifact before posting.
- **Shape and Design artifacts:** "Changed since vN" first, then the snapshot.
- **Slice PR body:** what this slice delivers (its criteria), how to see it (demo, screenshots, the one command to
  run it locally), what changed since the Design it started from, changes to earlier slices, and collapsed
  provenance. Short.
- **Check run:** a pass/fail line per criterion, screenshots, and a link to the full report.
- **Feature PR body:** the slices in order with their demos, a met / unmet / deferred verdict per criterion with
  evidence, a short history of how the plan evolved ("Design v1 to v2: filter on server delay data, because
  browser status can be stale"), and the provenance roll-up.
- **Comments:** only what a person needs to read, plus replies that settle review threads.

**Previews** are the repo's own CI's job; factory-foreman doesn't build or host them. The slice PR shows the local
before/after screenshots and recording, links the repo's deployment when GitHub has one, and gives one command to
run the slice locally.

## Toolchain

Each tool does one job better than we'd write it. Statuses: **Adopt** (we depend on it), **Borrow** (we take its
words, formats or ideas, not the tool), **Optional** (a team can plug it in, or we revisit after real use).

### Layer 1: harness

| Tool | Role | Value | Status |
| --- | --- | --- | --- |
| Claude Code | Personas as subagents, AskUserQuestion, hooks, transcripts | The loop and the raw provenance, with nothing of ours running | Adopt (tier 1) |
| Codex CLI | Same role: hooks (Stop can continue the turn), subagents, rollout logs | No lock-in to one vendor | Adopt (tier 2) |
| Copilot / VS Code | Agents, skills and hooks through APM | Reaches VS Code teams; no provenance fields yet | Adopt (tier 3) |
| Claude app (Remote Control) | Decision cards for readiness questions | Answer from anywhere | Adopt where available |

### Layer 2: factory contract

| Tool | Role | Value | Status |
| --- | --- | --- | --- |
| factory-foreman skill and CLI | Stage order, drafts, revisions, publish, sync, the ledger | The same steps on every feature, all recorded | Build |
| APM (microsoft/apm) | Deploys personas, skills, hooks and instructions to every harness; lockfile; `apm audit`; tighten-only policy | One install for every harness; the agent half of the factory version | Adopt |
| Profiles (ours, APM packages) | Per stack: standards skills, review lenses, checks, test runner, evidence provider, demo kinds, "red for the right reason" adapter | Fits each team's stack | Build |
| Predecessor (flight-components/factory) | Batched clarifying questions with defaults; design-it-twice; one example value per criterion; the verification table; persona eval cases | Proven on our own repos | Borrow |
| spec-kit (clarify, checklist, analyze) | At most 5 questions, ranked by impact × uncertainty, each with a recommendation, answers written back | Fewer, better questions | Borrow |
| OpenSpec | "Don't ask what you can verify"; "surface added scope, don't absorb it"; added / modified / removed deltas; living specs | Revisions read as deltas; the repo keeps current behaviour | Borrow now; spike as the revision format; adopt as the archive (M4) |
| superpowers (obra) | Implementer brief: unit tests red then green, root cause before a fix, stop after 3 failed fixes, no "done" without fresh evidence | Fewer false "done" claims | Borrow the text |
| Archon (SDLC pack text) | The attention-item shape for decisions; the evidence bar for findings; severity set by one synthesis pass; per-criterion verdict; round limits; risk-lane settings (`protected_paths`) | Every decision in one shape; fewer taste findings | Borrow |
| Anthropic code-review and pr-review-toolkit | "If you're not certain it's real, don't flag it"; the false-positive list | Less noise per round | Borrow |
| bdfinst dev-team | Quote the actual code; downgrade a finding that can't be falsified | Grounded findings | Borrow |
| Tessl (respond-to-code-review, eval format) | Fixed / refuted / declined with a reply; stop when the same concern keeps coming back; scenario evals with weighted checklists | A decision record on every finding; rounds that end; measured prompt changes | Borrow |

### Layer 3: trail

| Tool | Role | Value | Status |
| --- | --- | --- | --- |
| The ledger and templates (ours) | Events, snapshots, deltas; issue, PR and check-run templates | The part no tool does | Build |
| The publish workflow (ours) | Reusable workflow that validates committed snapshots and posts them as the App | The App's key never leaves GitHub | Build |
| Harness transcripts | Model, effort, tokens and time per step | Provenance nobody has to type | Adopt |
| ccusage | Token and cost totals from the same logs | A roll-up without our own tracker | Adopt, or read the logs directly |
| factory-foreman GitHub App | Factory identity for artifacts, PRs and slice merges; its token exists only inside the publish workflow | Machine output apart from people's words; approval on GitHub | Adopt (exists) |
| gh CLI | Every GitHub call; polling with ETags for sync | One client both ways | Adopt |
| GitHub issue artifacts | Shape, Design, Decisions, Changelog, one per slice, Verification, the Ledger; media attached with `--attach` | The public home of the trail; every version reads back ([Phase 0 spike E](spikes.md)) | Adopt (preview API, behind one module) |

### Layer 4: evidence and review

| Tool | Role | Value | Status |
| --- | --- | --- | --- |
| gh stack (github/gh-stack) | One PR per slice, stacked on the feature branch; merges from the bottom, GitHub rebases the rest | Small PRs without our restack code | Adopt |
| GitHub Actions (AC-check job) | Reads the repo CI's test report (or the trail's local result) and posts a per-criterion check | A per-criterion check for teams that want one, without knowing the build | Optional |
| GitHub check runs | Pass/fail per criterion, posted by the optional AC-check job with `GITHUB_TOKEN` | Status without leaving the PR | Optional |
| Playwright Test (or the profile's runner) | Criteria tests | Evidence that the slice does what was agreed | Adopt, via the profile |
| agent-browser | Builds and runs the app locally at base and head; screenshots, recording, visual delta (`diff screenshot`), accessibility audit, the `dogfood` exploratory pass | A person sees the slice's checkpoint, before and after | Adopt (already used) |
| ffmpeg | Video and GIFs for agent-browser's recordings | Short recordings inline in the PR | Adopt, locally |
| Tessl Code Review | Our persona files as lenses over a git range, reconciled (`--json`); paid | A second opinion from another engine | Optional, per team |
| act | Runs the slice workflow locally | Catches CI breakage early | Optional |
| Argos | Visual-diff check | Screenshot changes reviewed like code | Optional, per profile |
| reviewdog | Lint as inline comments | Lint off the reviewer's plate | Optional |

### Later, if real use asks for it

| Tool | What would bring it in | What it would add |
| --- | --- | --- |
| Archon as a runner | Review comments sit for a day because no session was open, or the person wants work moving while away | Durable waits, queues, unattended runs, worktrees; it would call our CLI, so the trail stays ours |
| DBOS | Crash-resume of long local runs matters | Durable steps as a library over SQLite |
| cmux, Conductor, Vibe Kanban | Several sessions at once | Side-by-side sessions; a personal choice |

### Left out on purpose

| Tool | Why |
| --- | --- |
| Archon as the engine now | See D22 in [decisions.md](decisions.md): its direction is less human involvement, its record lives in its own database, it doesn't stack PRs, and Codex steps under it lose Archon's hooks, skills and cost reporting. The predecessor was dropped over approvals on GitHub, not over Archon |
| spec-kit or OpenSpec as the live spec format | Two formats would mean two owners. Shape and Design stay ours; OpenSpec covers deltas and the archive |
| superpowers as a workflow | Its plan-and-execute flow competes with our stages, and it says "do not pause to check in" |
| Tessl plugins and registry | Overlaps with APM; one owner |
| LangGraph, Mastra, CrewAI | They orchestrate model API calls; we'd lose the harness's hooks, skills and transcripts |
| Windmill, Temporal, Restate, Inngest | A server for one developer's local loop |
| gh-aw, Tessl loops | They run the agent loop remotely; ours stays local. (`tessl launch skill --agent claude-code` does run locally) |
| Goose, OpenHands, docker-agent | Agent runtimes, not an SDLC; docker-agent runs Codex with permissions skipped |
| git-spice, Graphite | gh stack covers stacks |
| Webhooks, `gh webhook forward` | Need a public server, or drop events while offline; polling with ETags is enough |
| Building or hosting previews | Each repo's CI already builds and deploys, and there's no Esri standard for staging. factory-foreman links a deployment if GitHub shows one; it doesn't know how it's built |

## Harness tiers

| Tier | Harness | What works | Known gaps |
| --- | --- | --- | --- |
| 1 | Claude Code | Everything: hooks, AskUserQuestion, subagents with tool limits, transcripts with model, effort and tokens | Auto mode blocks agent merges (why the App merges) |
| 2 | Codex CLI | Hooks (Stop continues the turn), subagents, rollout logs with model, effort and tokens | A changed hook is skipped until the person re-trusts it; agents' `tools` limits are dropped, so reviewers aren't read-only; the question UI in default mode is unverified |
| 3 | Copilot / VS Code | Agents, skills, hooks through APM | Stop continuation and matchers unverified; no provenance fields; the readiness question falls back to chat |

`doctor` checks each harness on the machine and says what's missing (for example, a hook awaiting re-trust in
Codex).

## Extensibility

Layers, each an APM package a config `extends`:

1. **Core:** stages, the trail, publish, sync. Teams can't remove the record.
2. **Profiles** per stack. First `profile-web-components` (from the predecessor's lumina skills and conventions
   profile), then `profile-arcgis`. A profile tunes checks; it can't turn off recording.
3. **Org and team presets**, governed by APM policy (tighten-only).
4. **Repo config:** picks profiles, small overrides.

Teams customize through **hook points** around each stage (add a reviewer, a check, an artifact, a question or a
step) and **adapters** with one interface each: test runner, "red for the right reason" judge, evidence provider,
review engine (shaped like Tessl's JSON so it plugs in cheaply), spec archive, harness. Adapters are
runtime code loaded by the CLI; APM distributes the files and pins their versions.

## Repeatability

| What | How |
| --- | --- |
| Persona and prompt evals | Tessl's format: scenarios scored on weighted checklists, each run with and without the change, at least 3 runs. Cases from the predecessor's real issues plus seeded defects from real flight-components PRs. Runs on any harness, not only `claude -p` |
| Judging a prompt change | Precision up, recall not down, over repeated runs. "Fewer findings" alone isn't success |
| Recommendation rate | From the ledger: how often the person took each recommendation, by kind of decision (Archon's metric). Shows which questions are worth asking |
| Pinned versions | The factory version on every record, so results can be compared |

## Recovery and cost

- **Idempotent publish:** every publish can be re-run. A failed or partial workflow run is surfaced by `sync`;
  re-dispatching the same SHA is idempotent, and the workflow reconciles artifacts and PRs against what's already
  there.
- **`resume` and `doctor`** rebuild state from the ledger and GitHub after a crash, a wiped checkout or a new
  machine.
- **Revert and abandon:** reverting a merged slice and abandoning a feature are recorded moves, with reasons.
- **Cost:** per-stage token budgets and round caps in config, fed by provenance. A warning at 80%; over budget, the
  agent asks the person.

## Changes to the codebase

Based on `main` at a2ede98 (about 4,950 lines) plus PR #12 (whole-feature review, trimmed to its first commit).
The in-flight work on the sample repo (issue #1, slice PR #2) and its assumptions are dropped; it isn't carried
into this plan.

Paths are under `packages/core/` (`src/…` and `apm/…`).

### Keep

| Module | Note |
| --- | --- |
| `src/steps/structure.mjs` | Shape and Design checks; add example values, demo contracts, "changed since" |
| `src/slices/gate.mjs` | Red-at-base and green-at-head become evidence; "red for the right reason" moves behind a profile adapter |
| `src/slices/show.mjs`, `checks.mjs`, `plan.mjs` | Demos and checks; `plan` gains demo contracts |
| `src/review/*` (with #12's `feature.mjs`) | Briefs get the evidence bar, synthesis and finding outcomes; rounds get the stop rule |
| `src/capture/extract.mjs` | Decision capture, extended for provenance |
| `src/evidence/*`, `src/assets/publish.mjs` | Evidence providers |
| `src/github/gh.mjs` | The GitHub client, used with the person's login (sync, workflow dispatch) |
| `src/issue/*`, `src/changelog.mjs` | Issue rendering, moving to templates |
| `src/config/*`, `src/state/local.mjs`, `src/util/*`, CLI shell; `note`, `review`, `wireframes`, `status` | Plumbing and commands |

### Change

| Module | Change |
| --- | --- |
| `src/commands/checkpoint.mjs`, `amend` | Become `publish` and `revise`: snapshots with deltas and drafted reasons, committed to the trail branch |
| `src/commands/draft.mjs` | Drops the approval prerequisite (Design needs a published Shape, not an approved one) |
| `src/github/app.mjs` | Local signing removed; token minting moves into the publish workflow |
| `src/commands/slice.mjs` | Keeps open, tests, review, iterate; branches and PRs through `gh stack` as the App; the merge moves to the App after a recorded approval; our restack goes |
| `apm/guard/*` | From deny to record, except the denials in principle 2; `capture` writes approval records |
| `apm/.apm/skills/factory-foreman/SKILL.md` | Trimmed to the stage order, readiness and changing course; harness detail moves to references |
| Personas | Evidence bar, false-positive list, falsifiability, finding outcomes; severity left to synthesis; PR #12's stance line replaced |

### Delete

| Module | Why |
| --- | --- |
| Chat approval tickets, `approve slice`, the approve-guard's ticket and relay paths | One approval path: a recorded answer in chat or on a card, and the App merges |
| Slice restack and retarget | `gh stack` |

Relayed approvals (#11) aren't deleted outright: their record (channel, reference, what was shown, who answered)
becomes the decision shape in the ledger.

### Add

`start`, `publish`, `revise`, `sync`, `resume`, `doctor`; the ledger and the trail branch's snapshot files; the
`ready` hook; approval capture in `capture`; provenance capture; demo contracts; the publish workflow (App token,
input checks, artifacts, PRs, slice merges) and the trail-branch schemas; templates and the publish check; the
AC-check job; the implementer brief and the clarifying protocol (text); the eval harness; profiles; the OpenSpec
archive.

## Milestones

Spikes (S) and evals (Ev) come before rewrites; deletions come after their replacement works (end of M1). Every
milestone ends with **cleanup**: whatever it replaced (code, branches, PRs, local state, docs) is removed, not left
sitting.

| # | Scope | Done when | Estimate |
| --- | --- | --- | --- |
| S | **Spikes** on a scratch repo (S1–S6, below) | Each spike has a written answer in `docs/spikes.md`; spike branches, PRs and issues closed | 2–3 days |
| Ev | **Eval harness**: Tessl-format scenarios, the predecessor's cases, seeded defects, at least 3 runs per variant | Current personas have a baseline score; throwaway eval runs removed | 1–2 days |
| P | **Prompts**: implementer brief; clarifying protocol; evidence bar, synthesis and finding outcomes; per-criterion feature verdict; SKILL.md trimmed. Then merge PR #12 with these | Precision up and recall not down against the baseline; PR #12 closed and the prompts it carried folded in | 2 days |
| M1 | **Stacks and the trail**: setup (environment, App install, CODEOWNERS); the publish workflow and the trail-branch schemas; `start`; slice branches through `gh stack` and PRs opened by the App, merged by the person on GitHub; `publish` and `revise` with deltas and drafted reasons; feed-forward notes and proposals in the ledger; demo contracts; the `ready` hook and question; guard records instead of denying; tickets and restack deleted | A sample feature goes through Shape, Design, two slices and one Design revision, with every step in the trail; the deleted code paths, their tests and docs gone, and stale branches and local state from the prototype removed | 3–4 days |
| First real feature | The first real feature after M1, ideally one that revises its Design | What hurts decides M2 and M3 | — |
| M2 | **Evidence**: the local agent-browser capture (base and head, screenshots, recording, visual delta) pushed to the assets branch and attached to the slice's issue artifact and PR by the publish workflow; the Verification artifact; green-at-head from the repo CI's report or the trail; the optional AC-check job; feature PR with the verdict and plan history | A reviewer sees each criterion pass and the before/after without leaving the PR; the old iteration records and evidence comments retired | 2–3 days |
| M3 | **Trail on GitHub and sync**: Decisions and Changelog as they happen; provenance capture and footers; `sync` with ETags; `resume` and `doctor` | A GitHub comment shows up in the next session as a finding; every record shows its provenance; the old record formats removed | 2–3 days |
| M4 | **Profiles and polish**: profile-web-components; templates with the publish check; OpenSpec archive; cost budgets. The App merging slices after a recorded answer only if real use asked for it (ruleset with bypass, patch-id matching) | A second repo extends the profile and gets its standards and demos; unused options, flags and docs removed | 2–3 days |

Spikes:

- **S1:** `gh stack` non-interactively, with the feature branch as trunk, merge-as-approved, and main moving
  underneath.
- **S2:** the publish workflow: minting the App token from an environment secret, validating committed files at a
  SHA, posting artifacts, and opening stacked PRs as the App, with `gh stack` or the REST API (can `gh stack` link
  PRs for branches it didn't push from that checkout?).
- **S3:** a person approving and merging an App-authored slice PR, and `sync` recording it; which guard routes an
  agent can get around. (The App's own merge is tested only if it's adopted later.)
- **S4:** the `ready` hook in Codex (including re-trust) and VS Code (including double firing).
- **S5:** an OpenSpec delta for a real Design revision.
- **S6:** media on the issue and PR: first, how issue artifacts accept images and video programmatically (the API
  behind `gh issue artifact --attach`) with the App's token in the publish workflow; then whether the attachment URLs
  embed in a PR body; the assets-branch links only as a fallback.

About 3 weeks to M1 through M4, including spikes and evals, with no scheduled pilot. The first real feature after M1
is the test; which one is to be chosen, and the flight-components feature considered earlier isn't it for now.

## Risks and open questions

| Item | Why it matters | How to settle |
| --- | --- | --- |
| `gh stack` with merge-as-approved | A fully merged stack can't be extended; it requires linear history; several commands are interactive | S1 |
| The publish workflow | Approval on GitHub, merge authority and every App write depend on it; adds a workflow run per publish | S2, S3 |
| Org setup | Who can create environments and set secrets in the ArcGIS org's repos; which repos have the App | Open question for the App owner |
| Approval capture | An agent could write an approval event or approve as the developer | Threat model: guards against accidents, teammates' approvals only on GitHub, input checks in the workflow; S3 maps the remaining routes |
| Codex and VS Code hooks | Re-trust, double firing, Stop continuation | S4 |
| OpenSpec as the delta format | A good fit on paper | S5 |
| Issue artifacts are in preview | API may change | Kept behind one module |
| Provenance formats | Internal transcript formats change | `unknown` over guessing; fixtures per version |
| Prompt changes making things worse | Borrowed text may not fit | Eval baseline before P |
| Scope | A lot is planned | Milestones in order; nothing from a later one starts early |

## Working agreements

- Decisions are recorded in [decisions.md](decisions.md) with their source. Reopening one adds a new entry that
  supersedes it, with the reason.
- Every decision the person makes is asked as a card or a harness question with a recommendation.
- No Claude or project attribution in commits, PR bodies or comments. Provenance lives in factory-foreman's own
  records.
- Nothing merges into a base branch without the person's word.
