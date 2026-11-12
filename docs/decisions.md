# Decisions

One row per decision, with where it came from. **Decided** means the person said so. **Recommended** means it's
proposed and waiting for them. A decided item is reopened only with new evidence, recorded here. The plan these
belong to is [thin-runner.md](thin-runner.md).

| # | Decision | Status | Source and evidence |
| --- | --- | --- | --- |
| D1 | Work happens locally; GitHub gets pieces when they're ready, and GitHub activity syncs back | Decided, 12 Nov | The person: "work should be done locally and then sync'd to GH"; the approval round-trips required context switching |
| D2 | Slices are stacked PRs on the feature branch, reviewed one by one; one feature PR to the base branch gets a holistic review | Decided, 12 Nov | The person: stacked slice PRs "can't end up giant PRs"; "a feature still needs a holistic pass" |
| D3 | Every slice has a checkpoint a person can see working (a demo), not "trust me" | Decided, 12 Nov | The person: "each slice needs to have some sort of checkpoint that is visible … to a human" |
| D4 | A thin runner: the skill, CLI refusals, harness hooks; no runner process or orchestrator dependency now | Decided, 12 Nov | The person asked for the thin-runner plan; the review found Archon saves only ~300–400 lines and diverges on stacks, the frozen-test gate, Codex and where questions are answered |
| D5 | Archon is reconsidered as a replaceable runner only if the pilot shows a need for durable waits or unattended runs | Recommended | See thin-runner.md, Toolchain → Rejected |
| D6 | Avoid vendor lock-in; Claude Code and Codex are equals; use existing tools, one owner per concern, no conflicting tools | Decided, 12 Nov | The person: "trying to avoid vendor lock in", "don't want to pull in conflicting tools" |
| D7 | No Claude or project attribution in commits, PR bodies or comments | Decided, 11 Nov | The person: "want no attributions moving forward" |
| D8 | Record provenance per step: harness, model, reasoning effort, tokens, time | Decided, 12 Nov | The person: "we should be attributing agent/harness, model, reasoning level, tokens consumed, time spent" |
| D9 | Provenance appears as structured footers on factory-foreman's own artifacts and check runs, not as commit or PR attribution lines | Recommended | Reconciles D7 and D8 |
| D10 | Customization through layered APM packages (core → profiles → org/team → repo), hook points around stages, adapters; trust gates can't be removed | Recommended | The person: extensibility of skills and workflows for Esri teams is important |
| D11 | First profiles: web-components, then arcgis, from flight-components/factory content | Recommended | |
| D12 | Merge each slice into the feature branch as it's approved (not all at the end) | Recommended | Avoids rebasing long stacks and dismissed approvals; the base branch is untouched until the feature PR |
| D13 | The demo contract is a required field of each slice in Design, and its demo gates readiness | Recommended | Implements D3 |
| D14 | Slice budget stays at 400 changed lines | Recommended | Existing `budgets.sliceLines` |
| D15 | Preview host: Cloudflare Pages via wrangler (alternative: GitHub Pages with pr-preview-action) | Recommended | GitHub Pages has no native per-PR previews |
| D16 | Spec format: our Shape and Design stay native; OpenSpec is the archive format after merge; spec-kit not adopted | Recommended | Read-only comparison of the actual templates, 12 Nov |
| D17 | Borrow prompt text (implementer brief, clarifying protocol, review evidence bar, per-AC feature verdict) from superpowers, spec-kit, OpenSpec, Anthropic's review plugins, Archon, dev-team and our predecessor; adopt none of their workflows | Recommended | Same comparison: our gates are stronger; our implementer, clarifying and review prompts are weaker |
| D18 | Tessl code review is an optional second-opinion engine, not the default | Recommended | Paid; reconciles lenses well |
| D19 | PR #12's stance line is replaced by the review evidence bar before #12 merges | Recommended | The stance line invites taste-based findings |
| D20 | Prompts first (milestone P), then M1–M4, then a pilot | Recommended | Biggest quality gain for the least change |
