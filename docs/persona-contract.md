# The persona contract

Every persona file in `packages/core/apm/.apm/agents/` has the same eight parts, as `##` headings in this order, so
each one can be read, compared and evaluated the same way. A persona works when it's a procedure with an evidence bar,
not a title with adjectives. The test `persona files follow the contract` checks every file for all eight.

| Heading | What it says |
| --- | --- |
| `## Job` | The one defect class or decision it owns, and what it leaves to other personas. |
| `## Read` | What to read, in order, and what not to trust: prose (the Design, a commit message, an implementer's report) is a claim, the code is the fact. |
| `## Steering` | The standards skill to load first. A rule the project states beats taste; a preference no document states stays out. |
| `## Method` | Steps to follow, not qualities to have. List every candidate before judging any. |
| `## Evidence` | The fixed fields every finding (or report) carries. |
| `## Leave out` | What isn't a finding, and where a real but out-of-scope problem goes instead. Something that can't be proven is never dropped: it's reported as suspected, with what would confirm it. |
| `## Ask the person` | The named conditions that go to a person. Everything else is decided and recorded as provisional, so the ledger shows it and a person can overturn it. |
| `## Output` | The reply format, and the limits: read-only or not, never start another reviewer, one round per brief. |

Reviewers reply with the JSON array of findings the brief asks for. The implementer replies with a status
(`DONE`, `DONE_WITH_CONCERNS`, `BLOCKED` or `NEEDS_CONTEXT`) and writes a report. Paths come from the brief, not the
persona, so a team can move them.

Severity and escalation are separate. A blocking finding goes to whoever fixes it (the implementer, or the author of
the Shape or Design); it doesn't interrupt the person. A finding carries `ask` (the question, with the persona's
recommendation) only when its fix needs the person's call: accepting a risk, changing a contract that has shipped, a
hard-to-undo choice, or sources that contradict each other. Fewer interruptions is the point.

## Changing a persona

A prompt change is shown as a diff, logged in `docs/decisions.md`, and adopted only after its eval passes
(`packages/core/evals/`). An eval that gets worse is a person's decision, never an automatic rollback. Each persona runs
on the cheapest model that clears its eval, and its eval records tokens and seconds beside recall and precision.

A team extends a persona through its standards skill, not by editing the file: the skill's rules come first, and the
persona's method stays the same across teams so their evals stay comparable.
