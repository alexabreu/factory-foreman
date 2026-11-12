# factory-foreman: the thin runner

This is the plan for factory-foreman's next version: what it's for, which tools it's made of and the value each
one adds, how the pieces fit together, and what changes from the prototype on `main` (phases 0–3b). It's the
working reference for building it. Decisions and their status live in [decisions.md](decisions.md).

Written 12 Nov 2026, from a review of the prototype, the predecessor in `flight-components/factory`, and the
tools listed in [Toolchain](#toolchain). That review read source and docs; nothing below was live-tested unless it
says so.

## Contents

1. [What we're building](#what-were-building)
2. [What changes, in one page](#what-changes-in-one-page)
3. [Toolchain](#toolchain)
4. [The pipeline, stage by stage](#the-pipeline-stage-by-stage)
5. [The thin runner](#the-thin-runner)
6. [What GitHub shows](#what-github-shows)
7. [Extensibility](#extensibility)
8. [Changes to the codebase](#changes-to-the-codebase)
9. [Milestones](#milestones)
10. [Risks and things to verify](#risks-and-things-to-verify)
11. [Working agreements](#working-agreements)

## What we're building

A way to build features with coding agents (Claude Code, Codex, Copilot) that a person can **trust**: every step
is traceable, every slice is reviewable and visibly working, and the history explains itself. The goals are trust,
traceability, reliability, consistency, visibility and transparency.

The prototype made GitHub the system of record while work was still in progress. Every checkpoint, approval and
slice was a GitHub write, so the person kept switching context to approve things, and the approval plumbing
(terminal prompts, chat tickets, relayed channels, cards) kept being reworked. This version turns that around:

- **Work happens locally.** Drafts, reviews, tests, slices and evidence build up in the working tree, under gates
  the CLI enforces.
- **GitHub is where finished pieces are published.** A slice goes up as a stacked pull request once it's ready,
  and carries something a person can see working.
- **One prompt, when something is ready.** The harness asks "publish / not yet / changes". Nothing else
  interrupts the person.
- **GitHub flows back.** Comments, reviews and CI results come back into the local session as things to settle.

### Principles

- **The value is in the gates, not the engine.** Frozen acceptance tests that must fail at base for the right
  reason, slices that each own their criteria, and settlements pinned by hash are what no other tool provides.
  Everything else uses existing tools.
- **Borrow text, not workflows.** Where another project prompts the agent better, take its words into our
  personas and briefs. Don't install a second workflow that competes with ours.
- **One owner per concern.** Never two tools owning the same job (two spec formats, two planning flows, two
  review posters).
- **No vendor lock-in.** Claude Code and Codex are equals. Workflow and state are plain files. Any orchestrator is
  replaceable because every step is a CLI command.
- **Small, verifiable slices.** Agents generate faster than people review. Slices are capped, vertical, and each
  has a demo a person can run or watch.
- **Write code only where it adds value.** If GitHub, a harness or a maintained tool does it, use that.

## What changes, in one page

| Area | Prototype (main) | Thin runner |
| --- | --- | --- |
| Source of truth during work | GitHub issue and records | Local files under `.factory-foreman/<issue>/` |
| Shape and Design | Checkpointed to the issue at every version, each approved | Versioned locally; published to the issue when ready; formal approval optional per repo |
| Slices | Our own stacked branches, draft PRs, restack, `slice merge` | `gh stack` on the feature branch; slices merge into the feature branch as they're approved |
| What a slice PR shows | Iteration records as comments | Per-AC check run, a preview build, a demo (video, screenshots, HTTP transcript…), a short PR body |
| Human input | Approve commands, chat tickets, relayed channels | One readiness prompt in the harness or the Claude app; GitHub PR review for merges |
| Feature | No final review | One feature PR (feature branch → base) with a holistic review |
| Coming back from GitHub | Nothing | `sync` at session start and on demand |
| Provenance | Who approved what, against which hash | That, plus model, effort, tokens and time per step |
| Prompts | Lean personas; no implementer guidance; no clarifying protocol; reviews without an evidence bar | Borrowed implementer brief, clarifying protocol, review evidence bar, per-AC feature verdict |
| Orchestrator | The skill plus CLI refusals | The same, plus a Stop hook. No runner process |

## Toolchain

Every tool in the solution, the value it adds, and its status. **Adopt** means we depend on it. **Borrow** means
we take its text or ideas, not the tool. **Optional** means a team can plug it in. **Rejected** tools are listed
with the reason, so the question doesn't come back.

### Adopted

| Tool | Role | Value it adds | Replaces in our code |
| --- | --- | --- | --- |
| **Claude Code** | Harness | Runs the personas as subagents, the hooks (SessionStart, Stop, PreToolUse, SessionEnd), AskUserQuestion for the readiness prompt, transcripts with model, effort and tokens per request | Any runner or agent loop of our own |
| **Codex CLI** | Harness | Same role as Claude Code: hooks (Stop can continue the turn), subagents, session logs with model, effort and token counts per turn | — |
| **Copilot / VS Code** | Harness (partial) | Agents, skills and hooks through APM; no provenance fields yet | — |
| **APM** (microsoft/apm) | Packaging | Deploys agents, skills, hooks and instructions to every harness from one package; lockfile; `apm audit`; policy files with tighten-only inheritance (enterprise → org → repo) | Per-harness install scripts; org governance |
| **gh CLI** | GitHub access | Auth, REST and GraphQL calls, `gh run watch` | — |
| **gh stack** (github/gh-stack, GA 6 Oct 2026) | Stacked PRs | Stacks on the feature branch, atomic bottom-up merges, server-side rebase of the rest, stack-aware rules and CI (`pull_request.stack.position`), review UI with stack navigation | Our slice branches, restack, retarget and `slice merge` (~300 lines) |
| **GitHub check runs** | Per-AC results | One check per slice: an AC table (✅/❌) in the summary, details in `<details>`, screenshots, a link to the evidence, up to three buttons, and it can be a required check | Iteration records posted as comments |
| **GitHub Deployments and environments** | Preview link | The PR's own "View deployment" button | — |
| **GitHub issue artifacts** (public preview) | Shape, Design, Decisions, Changelog | Versioned documents on the issue (already used) | — |
| **GitHub Actions** (reusable workflow plus composite actions) | Slice CI | Builds the preview, runs the AC suite and the demos, posts the check run; adopted by a repo with one `uses:` line | — |
| **Cloudflare Pages** via `wrangler` (or **pr-preview-action** on GitHub Pages) | Preview host | A stable URL per slice branch, with the Playwright report alongside | — |
| **Playwright Test** | AC test runner | Deterministic assertions, traces and HTML report; the default runner in the web-components profile | — |
| **agent-browser** (0.42, installed) | Show scripts, wireframes, UI evidence | Replays demos against test ids, screenshots, video (`record`, needs ffmpeg), base-vs-head pixel diff (`diff screenshot`), axe accessibility audit (`a11y`), web vitals, and the `dogfood` exploratory-testing skill | — (already used) |
| **ffmpeg** | Video | Needed by `agent-browser record` and for GIFs in PR bodies | — |
| **ccusage**, or the transcripts directly | Provenance | Tokens and cost per session and model from the local Claude and Codex logs | A usage tracker of our own |

### Borrowed (text and ideas, not the tool)

| Source | What we take | Where it goes |
| --- | --- | --- |
| **flight-components/factory** (our predecessor) | Batched clarifying questions, each with a recommended default and a reason; "answer what you can yourself first"; design-it-twice; one example value per acceptance criterion; the verification table (AC → test → result → evidence); persona evals from real issues | Clarifying protocol, `references/shape.md`, `references/design.md`, evals |
| **spec-kit** (`templates/commands/clarify.md`, `checklist.md`, `analyze.md`) | At most 5 questions ranked by impact × uncertainty, each with a recommended option, answers written back into the draft | Clarifying protocol; Shape and Design review lenses |
| **OpenSpec** (`explore`, `apply`) | "Don't ask what you can verify"; "surface added scope and ask; don't absorb it silently"; spec deltas against living specs | Clarifying protocol, implementer brief; and adopted as the archive format (below) |
| **superpowers** (obra) | TDD for unit tests below the frozen AC tests; root cause before fixes and stop after 3 failed fixes; no completion claims without fresh verification; receiving review: verify before implementing, push back with reasons | Implementer brief; the settle step |
| **Anthropic code-review and pr-review-toolkit** | "If you're not certain an issue is real, don't flag it"; the false-positive list (pre-existing issues, linter territory, style without a rule) | Reviewer personas |
| **Archon** SDLC pack (v0.14 `review-code.md`, `review-synthesize`) | The evidence bar for a finding (line, reachable path, wrong outcome, evidence, smallest fix; "everything unproved is silence"); severity set by one synthesis pass; per-AC met/unmet/deferred verdict; a `rulings.md` of answers already given; the question shape (options plus a recommendation); findings with `sources` and `round` | Reviewer personas, review synthesis, feature review, questions, provenance |
| **bdfinst dev-team** | Quote the actual code; downgrade a finding that can't be falsified; spec compliance as the first gate | Reviewer personas, feature review |
| **Tessl** | A refuted or declined finding never comes back in a later round | Review rounds |

### Adopted later, or optional

| Tool | Role | Value | When |
| --- | --- | --- | --- |
| **OpenSpec** | Living specs (archive) | After a feature merges, its Shape and Design are written as an OpenSpec change and archived into `openspec/specs/`, so the repo keeps a current description of behaviour | M4 |
| **Tessl code review** | Second-opinion engine | Runs our persona files as lenses over a git range and reconciles them (`--json`); paid | Optional, per team |
| **Argos** | Visual diffs | PR check and review UI for screenshot changes | Optional, per profile |
| **reviewdog** | Inline lint | Posts light-check output as inline PR comments | Optional |
| **act** (installed) | Local CI | Runs the slice workflow locally before publishing | Optional |
| **cmux** | One window | Agent sessions side by side with attention rings (macOS only) | Personal choice |
| **Archon** | Runner | Durable waits, worktrees, unattended and parallel runs. If needed, a factory-foreman pack calling our CLI, with its questions bridged to the chat | Only if a pilot shows the need |

### Rejected, and why

| Tool | Why not |
| --- | --- |
| **Archon as the engine now** | Its SDLC pack runs direction through GitHub issues; no stacked PRs ("never rebases"); no frozen-test gate; weaker Codex support (no hooks, skills, cost or resolved model); 12 releases and 21 breaking changes Aug–Nov 2026; two maintainers; Bun and SQLite; its questions live outside the chat. It saves about 300–400 lines we'd otherwise write |
| **spec-kit as the spec format** | One standalone folder per feature with no living spec; no spec validation; contradicts itself on tests first; never mentions reusing existing code |
| **OpenSpec as the live format** | Our Shape and Design are stronger under our gates; OpenSpec stops at tasks. Kept as the archive format instead |
| **superpowers as a workflow** | Its own plan and execute flow, worktrees and ledger compete with our slices, and it says "do not pause to check in" |
| **LangGraph, Mastra, CrewAI** | They orchestrate model API calls; we'd have to wrap Claude Code and Codex as tools and lose their hooks, skills, sessions and transcripts |
| **Windmill, Temporal, Restate, Inngest** | A server for one developer's local loop. DBOS, a library over SQLite, if crash-resume ever matters |
| **gh-aw, Tessl agent and loops** | Run in GitHub Actions or the cloud, the opposite of local-first |
| **Goose, docker-agent, OpenHands** | Agent runtimes, not SDLC pipelines; docker-agent runs Codex with permissions skipped |
| **Vibe Kanban, Conductor, Sculptor** | Parallel-session managers with no pipeline |
| **some-useful-agents, Contenox** | Interesting, but one author and a few stars each |
| **wshobson, VoltAgent personas** | Keyword lists; VoltAgent ships a made-up example result |
| **git-spice, Graphite** | GitHub's native stacks cover it |
| **Webhooks / `gh webhook forward`** | Need a public server, or drop events while the laptop is offline; polling with ETags is enough |

## The pipeline, stage by stage

The person talks to one agent in their harness. The skill tells it the order; the CLI refuses anything out of
order. Each stage lists its owner, gate, what's kept locally, what's published, and when the person is asked.

### 0. Start

- `factory-foreman start <issue>` (new) creates the feature branch `factory-foreman/<n>` from the base branch and
  the local state folder, and runs a first `sync`.
- Local: `.factory-foreman/<n>/` (see [Local state](#local-state)).

### 1. Clarify

- **Owner:** the product-engineer persona, with the clarifying protocol (borrowed).
- **How:** look in the code, issue and docs first. Then at most 5 questions in one round, each with a recommended
  default and a reason, ranked by impact × uncertainty. The answers are written back into the draft, and each one
  goes into `rulings.md` so it's never asked again.
- **Asked:** one question round, through the harness's question UI.

### 2. Shape

- **Owner:** product-engineer drafts; test-verification-engineer reviews (plus any profile lenses).
- **Content:** problem, who it's for, out of scope, and acceptance criteria. Each criterion is one observable
  behaviour with **one example value**, written WHEN … THE SYSTEM SHALL … where that helps.
- **Gate:** structure checks, word budgets, settled review (existing).
- **Ready when:** the gate passes. The harness asks "publish Shape vN / not yet / changes". Publishing writes the
  Shape artifact and updates the issue body. A repo can require a formal approval here (config); by default the
  readiness tap is enough.

### 3. Design

- **Owner:** software-architect drafts and reviews; ux-designer when there's a visual criterion.
- **Content:** approach (with a second option considered and rejected), contracts (test ids, files and
  **signatures**), code to reuse (named), wireframes for visual criteria, and slices.
- **Slices:** vertical, each owning its criteria and files, under the line budget, with a **demo contract**: the
  kind of demo (UI, API, CLI, library, refactor) and exactly how a person will see it work.
- **Gate:** every criterion owned by one slice; every slice has a demo contract; settled review.
- **Ready when:** the gate passes; same prompt as Shape.

### 4. Each slice

1. `slice open <n>`: the next branch in the `gh stack` on the feature branch.
2. `slice tests <n>`: the test-verification-engineer writes the AC tests and demo scripts from Shape and Design
   only. `--save` freezes them by hash and checks each fails at base for a reason the slice fixes (existing
   gate).
3. **Implement**, using the implementer brief (borrowed): unit tests red-green below the AC tests; root cause
   before fixes, and stop after 3 failed fixes; follow the existing patterns; no changes outside the slice's
   files; surface added scope instead of absorbing it; fix the code, never the frozen tests; no "done" without
   fresh evidence.
4. `slice review <n>`: the code reviewer (and principal-engineer, and profile lenses) read the whole feature so far
   against base, with the slice's diff as what's new. Every finding must meet the evidence bar. One synthesis pass
   sets severity. The person settles findings with the agent (accept, change, overrule with a reason).
5. `slice iterate`: light checks, the AC gate at base and head, the saved review, the demo produced locally. This
   is the slice's readiness gate.
6. **Ready:** the Stop hook sees the gate is green and the agent asks "publish slice n / not yet / changes".
   On publish: `gh stack submit` pushes and opens or updates the PR, with the PR body template.
7. **CI** (reusable workflow): builds the preview, runs the AC suite and the demo scripts, records video and
   screenshots, posts the per-AC check run and the deployment link.
8. **Review on GitHub** by a person. Their comments and review come back through `sync` as findings to settle
   locally; changes go back up with `gh stack`.
9. **Merge into the feature branch** once approved and green: `gh stack merge` at that PR (GitHub merges it and
   everything below it, then rebases the rest). The base branch isn't touched.

### 5. Feature

1. `review feature` (from PR #12, extended): the whole feature against base, plus a per-AC verdict table (met,
   unmet, deferred, with cited evidence; "read the assertion, not the test title"), plus an agent-browser
   `dogfood` pass on the visual criteria (reproduce each issue, with a retry, before reporting it).
2. **Ready:** "open the feature PR / not yet / changes". The feature PR (feature branch → base) carries a body
   linking each slice PR and its demo, in order, and the final preview.
3. **Holistic review** by a person on GitHub, using GitHub's own review and branch rules. This is the formal
   approval.
4. **After merge:** the OpenSpec change is archived into the living specs (M4), and the local state is closed.

### Human touchpoints, all of them

- One clarifying round per feature.
- A readiness prompt per Shape, Design, slice and the feature PR.
- Settling review findings (in the chat).
- Reviewing slice PRs and the feature PR on GitHub, where review belongs.

## The thin runner

There's no runner process. Four existing things do the job.

1. **The skill** tells the agent the order of the stages and how to use each command.
2. **The CLI** is the state machine: each command refuses unless the stage before it is complete (no Design
   without a ready Shape, no iterate without frozen tests and a saved review, no publish without a green gate).
3. **The harness** is the loop: it runs the agent, the subagents and the question UI.
4. **Hooks** add what the harness doesn't do by itself:

| Hook | Harness events | What it does |
| --- | --- | --- |
| `sync` | SessionStart (and UserPromptSubmit, rate-limited) | Pulls new GitHub comments, reviews and check runs since the cursor (ETags) and gives the agent a short "since you last looked" note |
| `ready` | Stop (Claude Code, Codex) | Runs the readiness check for the current stage. If it's green and the person hasn't been asked about this exact version or head, blocks the stop with a reason that makes the agent ask the readiness question. Uses `stop_hook_active` so it never loops |
| `capture` | PreCompact, SessionEnd, Stop | Existing decision capture, plus provenance: model, effort, tokens and time for the session, attributed to the current stage |
| `guard` | PreToolUse | Shrinks to protecting what agents must never do: edit frozen tests, write the person's own settings, merge to the base branch, post review approvals |

### The readiness question

- **Claude Code:** AskUserQuestion with three options: publish (recommended when green), not yet, changes.
- **Codex:** its own question UI, or one short question in the chat.
- **Claude app:** a decision card, when the session runs through Remote Control.
- The answer and who gave it are recorded in the ledger. "Not yet" isn't asked again until something changes.
  "Changes" turns into notes to work on.
- The agent never tells the person to type or run a command.

### Local state

`.factory-foreman/<issue>/` (already self-ignoring and per checkout):

| File | Contents |
| --- | --- |
| `ledger.jsonl` | Append-only events: draft saved, review round, finding settled, gate run, question asked and answered, published, synced. Each event carries its provenance |
| `shape.md`, `design.md` | Current drafts, plus versions |
| `reviews/` | Saved, settled reviews (existing) |
| `slices/<n>.json` | Slice state: tests frozen, iterations, head, PR (existing, simplified) |
| `rulings.md` | Answers the person has given, read before asking anything |
| `sync.json` | GitHub cursors and ETags |

### Provenance

Per step: harness, model, effort, tokens in and out (including thinking), wall time, session id, the profile
versions in use, and the commit. Read from the Claude Code transcript (`message.model`, `message.usage`, `effort`,
timestamps) and the Codex rollout (`turn_context`, `token_count`), or from ccusage. Published as a collapsed
footer on each artifact and check run, and as a roll-up in the issue body. This is structured provenance on
factory-foreman's own records; commits and PR boilerplate carry no attribution lines.

## What GitHub shows

Rendered from templates, checked before posting (markdown lint, link check, length budgets, a preview through
GitHub's `/markdown` renderer, and an editor pass that cuts restated or empty content), with snapshot tests.

- **Issue body:** a status line with the stage; `<details>` sections for Shape, Design, Decisions, Slices (a table
  of PR, CI, demo and preview links), Open questions, and Provenance.
- **Slice PR body:** what this slice delivers (its criteria), how to see it (preview link, demo GIF or transcript),
  links to the checks, and collapsed provenance. Short.
- **Per-AC check run:** a ✅/❌ table per criterion in the summary; screenshots; the trace and report on the
  preview; a "Re-verify" button.
- **Feature PR body:** the slices in order with their demos, the final preview, the per-AC verdict, and the
  roll-up of provenance.
- **Comments:** only for things a person needs to read. No records as comments.

## Extensibility

Layers, each an APM package a config `extends`:

1. **Core** (this package): stages, gates, publish, sync, provenance. Teams can't remove the trust gates.
2. **Profiles** per stack: standards skills per role, extra reviewers or lenses, check commands, the AC runner,
   the evidence provider, the preview build, demo kinds, and additions to the Shape and Design templates. First:
   `profile-web-components` (Calcite, accessibility, visual diffs), from the predecessor's lumina skills and
   conventions profile; then `profile-arcgis`.
3. **Org and team presets**, governed by APM policy (tighten-only): an org adds gates, a team adds lenses.
4. **Repo config**: picks profiles, small overrides.

Teams customize through **hook points** around each stage (add a reviewer, check, artifact, question or step), not
by editing the core flow. Adapters with one interface each: AC runner, evidence provider, preview host, review
engine, spec archive, harness. Each profile ships evals for its personas, and provenance records which profile
versions produced each artifact.

## Changes to the codebase

Based on `main` at a2ede98 (about 4,950 lines) plus PR #12.

### Keep (about 70%)

| Module | Lines | Note |
| --- | --- | --- |
| `src/steps/structure.mjs` | 258 | Shape and Design checks; add the demo contract and example values |
| `src/slices/gate.mjs`, `show.mjs`, `checks.mjs`, `plan.mjs` | 542 | The AC gate and demos; `plan` gains demo contracts |
| `src/review/briefs.mjs`, `rounds.mjs`, `feature.mjs` (#12) | ~250 | Review briefs; add the evidence bar and synthesis |
| `src/capture/extract.mjs` | 269 | Decision capture; extended for provenance |
| `src/evidence/*`, `src/assets/publish.mjs` | 259 | Evidence providers |
| `src/config/*`, `src/state/local.mjs`, `src/util/*`, `src/args.mjs`, `src/errors.mjs`, `src/cli.mjs` | ~600 | Plumbing |
| `src/commands/draft`, `note`, `review`, `wireframes`, `status` | ~550 | Commands |
| `src/issue/*`, `src/github/*`, `src/changelog.mjs` | ~690 | GitHub client and issue rendering, moving to templates |

### Change (about 15%)

| Module | Change |
| --- | --- |
| `src/commands/checkpoint.mjs` | Saves a local version; publishing becomes `publish shape` and `publish design` |
| `src/commands/slice.mjs` | Keeps open, tests, review, iterate; `open` and publish use `gh stack`; `merge` and our restack go |
| `apm/.apm/skills/factory-foreman/SKILL.md` | Trimmed to the stage order and the readiness rule; approval and harness detail move to references |
| Personas (`apm/.apm/agents/*`) | Evidence bar, false-positive list, falsifiability rule; severity left to synthesis; PR #12's stance line replaced |

### Delete (about 10–15%)

| Module | Why |
| --- | --- |
| `src/approval/ask.mjs` (tickets, relays), `src/commands/approve.mjs` (`approve slice`, relayed) | Approvals move to the readiness prompt and GitHub's PR review |
| `apm/guard/approve-ask.mjs`, most of `approve-guard.mjs` | Same; the guard keeps only what agents must never do |
| Slice restack and retarget in `slice.mjs` | `gh stack` |

### Add (about 2,000–2,500 lines)

`start`, `publish`, `sync`; the `ready` Stop hook; provenance capture; the ledger; demo contracts and their gate;
templates and the publish check; the reusable workflow and composite actions (preview, AC suite, demos, check
run); the implementer brief and the clarifying protocol (text); profiles; the OpenSpec archive.

## Milestones

Each one leaves something usable. Estimates assume agent-built code with tests.

| # | Scope | Done when | Estimate |
| --- | --- | --- | --- |
| P | **Prompts first:** implementer brief; clarifying protocol; review evidence bar plus synthesis; per-AC feature verdict; SKILL.md trimmed. Then merge PR #12 with these | A test run of review and implement on the sample shows fewer, evidenced findings and no early "done" | 2 days |
| M1 | **Stacks and readiness:** `start`; `gh stack` for slices on the feature branch; demo contracts in Design and their gate; the `ready` Stop hook and question; approval tickets, relays and restack deleted | A sample feature goes from Shape to two stacked slice PRs with one tap each | 2–3 days |
| M2 | **What a slice shows:** reusable workflow; preview (Cloudflare or Pages); per-AC check run; demo video, screenshots and HTTP transcripts; feature PR with the per-AC verdict | A reviewer opens a slice PR and sees each criterion pass, the demo and a running preview | 2–3 days |
| M3 | **Sync and provenance:** `sync` with ETags at session start; findings from GitHub comments; provenance capture and footers | A GitHub review comment shows up in the next session as a finding; every artifact shows model, effort, tokens and time | ~2 days |
| M4 | **Profiles and polish:** profile-web-components from the predecessor's content; issue and PR templates with the publish check and snapshot tests; OpenSpec archive on merge | flight-components can extend the profile and get its standards and demos | 2–3 days |
| Pilot | One real feature on the sample, then one on flight-components | The person uses it day to day | — |

About 2.5 weeks in all. After the pilot, decide on Archon with evidence.

## Risks and things to verify

| Item | Why it matters | How to settle |
| --- | --- | --- |
| `gh stack` and the merge queue | Docs disagree on whether a stack is queued as one group; auto-merge may still be rolling out | Try it on a scratch repo in M1 |
| Codex's question UI | Its default-mode question support is reported, not documented | Check on the installed Codex in M1; fall back to one chat question |
| Stop-hook continuation in VS Code/Copilot | Unverified there | Test in M1; Copilot gets the chat-question fallback |
| ffmpeg for video | Not installed here | Install in CI images; screenshots stay the primary evidence |
| Preview host | Cloudflare needs an account; GitHub Pages has no native PR previews | Decision D15 in decisions.md |
| Issue artifacts are in preview | API may change | Keep the GitHub client behind one module |
| Prompt changes making things worse | Borrowed text may not fit | Keep the predecessor's eval cases and add seeded-defect cases per persona |
| Scope creep | This plan has a lot in it | Milestones in order; nothing from a later milestone starts early |

## Working agreements

- Decisions go in [decisions.md](decisions.md), with the evidence. A decided item isn't reopened without new
  evidence.
- Every decision the person makes is asked as a card or harness question with a recommendation, not left in
  prose.
- No Claude or project attribution in commits, PR bodies or comments. Provenance lives in factory-foreman's
  own records.
- Nothing merges without the person's word.
