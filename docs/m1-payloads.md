# M1 payloads (draft)

Draft shapes for the records M1 writes. They hold whichever source of truth the person picks: if the issue is the
only record, these travel as workflow-dispatch inputs and issue artifacts; if a trail branch is kept, the same JSON
is a file on it. Nothing here depends on that choice. Schemas are JSON Schema 2020-12, shortened to their fields.

## The `ask` on a finding

The slice brief's output contract (`src/commands/slice.mjs`) gains one optional field. A reviewer adds it only when
the finding's fix needs the person's call (accepting a risk, changing a shipped contract, a hard-to-undo choice, or
sources that contradict each other); every other finding goes to whoever fixes it.

```json
{ "id": "<short-id>", "severity": "blocking|major|minor", "text": "…", "where": "<file:line>",
  "ask": { "question": "…", "recommendation": "…", "options": [ "…" ], "why": "…" } }
```

- `ask` may also be a plain string (the question with its recommendation), as the personas word it; the runner
  normalizes it to the object, with `recommendation` empty when none was given.
- After the verifier, the runner collects every `ask` on a finding that isn't `rejected` or `merged`, de-duplicates
  by question, and raises one card each, with the recommendation first. The answer is recorded as a `ask.answered`
  event and, where it settles a recurring question, proposed as a ruling (step 7, once its card is answered).
- An implementer's `BLOCKED` or `NEEDS_CONTEXT` carries the same object, so a stop and a review question look alike
  on the card.

The brief's line becomes:

`Reply with only a JSON array of findings: [{ "id", "severity", "text", "where", "ask"? }]. Add "ask" only when the
fix needs the person's call: { "question", "recommendation", "options"?, "why" }. Reply [] when there is nothing to fix.`

## Ledger event

One line per event in the ledger (`ledger.jsonl` locally; the Ledger artifact on the issue).

```json
{
  "v": 1,
  "id": "<ulid>",
  "at": "<ISO 8601>",
  "feature": 7,
  "kind": "shape.published | design.published | slice.ready | slice.approved | slice.merged | review.recorded | ask.raised | ask.answered | override.recorded | cost.recorded",
  "actor": { "kind": "person | agent | app", "id": "<account id, persona name, or App slug>" },
  "agent": { "harness": "claude-code | codex | …", "model": "<id>", "effort": "<level>" },
  "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheCreation": 0, "costUsd": 0, "seconds": 0 },
  "refs": { "pr": 13, "head": "<sha>", "patchId": "<sha>", "artifact": "<name@version>", "run": "<workflow run URL>" },
  "payload": {}
}
```

- `agent` and `usage` appear on agent events only. `usage` keeps cached reads apart, since they cost far less; a
  harness that reports one total (Codex) fills `input` and leaves the rest 0, marked `"totalOnly": true`.
- `payload` is one of the shapes below, chosen by `kind`.

## Approval (`slice.approved`)

The person's approval in chat or on a card. As workflow-dispatch inputs it's the merge run's proof; GitHub records
who started the run, and the workflow refuses if the PR's diff no longer matches.

```json
{ "pr": 13, "head": "<40-hex sha>", "patchId": "<40-hex>", "approver": "<account id>",
  "via": "chat | card", "messageId": "<the message or card id>", "approvedAt": "<ISO 8601>", "correlation": "<id>" }
```

The workflow recomputes `git diff base...head | git patch-id --stable` and merges only when it equals `patchId` and
`head` is still the PR's head.

## Review (`review.recorded`)

```json
{ "slice": 2, "round": 1, "reviewers": [ "code-reviewer", "test-verification-engineer", "security-lens?" ],
  "skipped": [ { "reviewer": "security-lens", "why": "the slice touches no input, auth, secrets, CI or dependencies" } ],
  "findings": [ { "id": "…", "by": "code-reviewer", "severity": "…", "text": "…", "where": "…",
                  "outcome": "verified | suspected | rejected | merged", "into": "<id>?", "reason": "…", "ask": {}? } ],
  "secondOpinion": { "harness": "codex", "disagreements": [ "<finding id>" ] } }
```

## Override (`override.recorded`)

A check that would have stopped the line, recorded instead of refused.

```json
{ "check": "<name>", "who": "<account id>", "why": "<at least one specific sentence>", "until": "<date or event>?" }
```

Three overrides of the same check propose changing its default on the next card.

## Artifact version header

Each issue artifact version starts with a collapsed header naming what produced it, so the issue alone shows where
every version came from.

```json
{ "artifact": "Design", "version": 2, "run": "<workflow run URL>", "event": "<ledger event id>",
  "reason": "<the Changelog line for this version>" }
```
