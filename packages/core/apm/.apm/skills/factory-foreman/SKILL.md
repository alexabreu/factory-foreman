---
name: factory-foreman
description: Use when working a feature on a GitHub issue tracked by factory-foreman (a factory-foreman.config.json at the repo root, or a factory-foreman/<n> branch). Covers noting decisions as they happen, drafting Shape and Design, having reviewers review them, checkpointing them for a person to approve, and amending an approved version.
---

# factory-foreman

A feature moves through checkpoints on its GitHub issue. You draft; the CLI checks
and posts; a person approves. You never approve, and you never edit the issue,
its artifacts or its records by hand: everything goes through `factory-foreman`.

## Note decisions as they happen

Whenever the person decides something, rules something out, or asks something
that has to be answered before you can go on, note it at once, in one sentence:

```sh
factory-foreman note "Syncing between devices is out of scope" --step shape
factory-foreman note "Rejected a modal: the list must stay visible" --kind rejected --step design
factory-foreman note "Can titles repeat?" --kind question --blocking --step shape
```

Notes are the "how we got here" for the next version, and decisions become rows
in the issue's Decisions artifact. Note the decision, not the conversation. Never
put secrets, tokens or personal data in a note.

The session hooks also extract notes from the conversation as it goes (when
enough has been said, and when the session is compacted or ends), on a
`factory-foreman/<n>` branch. Those are guesses until the person confirms them:
`draft` lists them as unconfirmed with an id, and checkpoint refuses while any
logged since the step's latest version are left. Show each one to the person
and run what they choose:

```sh
factory-foreman note --keep 3f9a1c2e
factory-foreman note --edit 3f9a1c2e "Sharing lists is for a later issue"
factory-foreman note --drop 3f9a1c2e
```

Only confirmed notes reach GitHub.

Notes are extracted only from what the person says; your own narration never
becomes a note. In a session with no person in it (claude -p, CI, or a run
marked FACTORY_FOREMAN_NO_PERSON=1), notes you write stay unconfirmed and
`note --keep/--edit/--drop` refuses: leave them. Checkpoint posts without them
and names them, and the person settles them later. Never keep or drop a note on
the person's behalf.

## Draft, check, checkpoint

1. `factory-foreman draft shape` (or `design`) prints the brief: the budget, the
   latest version, the notes since it, and the draft file to edit. For Design it
   also lists the approved Shape's acceptance criteria.
2. Edit the draft file. Keep its front matter: `base` is the version you started
   from, and the CLI uses it to refuse a stale write.
3. Follow `references/shape.md` or `references/design.md` for what goes in each
   section. For a Design whose Shape has a visual criterion, write its
   wireframes and run `factory-foreman wireframes design` (see
   `references/design.md`); it renders, commits and pushes them, and writes
   the draft's Wireframes section. In Codex it checks the pages, then refuses:
   ask the person to run the command it names in their terminal, don't edit
   the draft meanwhile, then re-read the draft it updated and carry on.
4. Show the person the draft and settle anything they raise.
5. Have it reviewed (below).
6. `factory-foreman checkpoint shape` posts it as the next version. If it's
   refused, fix each problem it lists and run it again. If it's refused as
   stale, someone else posted first: run `factory-foreman draft shape --reset`,
   fold your changes into the latest version, and checkpoint again.
7. Tell the person the version is posted and ask whether to approve it.
   Approve only when they say so in the chat: then run
   `factory-foreman approve shape v<N>` as one plain command: nothing before
   it (no `PATH=…`), and nothing chained, piped, redirected (no `2>&1`) or in
   variables. In Claude Code the harness then asks them, showing
   what they're approving; their Allow is the approval. Never answer for them,
   rephrase the command to avoid the prompt, or retry after they deny it.
   Elsewhere (Codex, a headless run) it refuses: they approve in their own
   terminal with the same command.

Design can only be checkpointed once a Shape version is approved.

## Review before you checkpoint

Checkpoint refuses a draft that hasn't been reviewed exactly as it is now.

1. `factory-foreman review shape` (or `design`) prints one brief per reviewer
   the repo configures, and the draft's hash.
2. Run each brief as a native subagent of that reviewer agent, by its name
   (for example `test-verification-engineer`, `software-architect`,
   `ux-designer`), passing the brief as its task. In Claude Code that's the
   Agent tool with the agent's name; in Codex, spawn the agent with that agent
   type. A `second-opinion` brief names its own command, another vendor's model
   (`claude -p` under Codex, `codex exec -` elsewhere); pipe the brief into it.
   Never answer it with a subagent of your own model.
   Only in a harness without subagents, or in CI, does `factory-foreman review
   shape --headless` run every brief through the configured command instead.
3. Each reviewer returns a JSON array of findings. Settle every one with the
   person: `accepted` (they agree, nothing to change), `changed` (you changed
   the draft) or `overruled` (with a reason the person gives).
4. Write the settled findings to a file and save them:

   ```json
   { "reviewers": { "test-verification-engineer": [ { "id": "T1", "text": "…", "settlement": "changed" } ], "ux-designer": [] } }
   ```

   `factory-foreman review save shape --findings findings.json`

The review is saved against the draft's text as it is when you save, so make
your changes before saving. Any edit afterwards needs a new review save.

A draft gets at most two review rounds (`review.maxRounds`) per version it
builds on. Round 1 briefs every reviewer. If settling it changed the draft,
`review shape` again is round 2: it briefs only the reviewers whose findings
caused the changes, on what changed; save round 2 with their findings only (the
others carry over). There's no third round: after round 2, the person settles
whatever is left (accepted, or overruled with their reason), or it becomes an
open question (`note … --kind question`). Polish is never a reason to review
again.

## Build the slices

Once Shape and Design are approved, build the Design's slices in order, one
branch and draft PR each: `factory-foreman slice open <n>`, freeze its AC tests
with `slice tests <n>`, build it, have it reviewed, and `slice iterate`. Follow
`references/slices.md`. The person approves each slice, which merges it once
CI is green, the same way as a version: on their word, you run
`factory-foreman approve slice <n>` and Claude Code asks them.

## Amend an approved version

Once the latest version is approved, change it with amend rather than
checkpoint, and say why:

```sh
factory-foreman amend shape --reason "Clearer problem statement"
```

Draft and review as usual first. If the acceptance criteria, contracts, visual
behaviors and slices are unchanged, the amendment is minor: it is posted as
v1.1, v1.2… and keeps the approval, so there is nothing to approve. If any of
them changed, it is material: it is posted as the next version and the person
approves it as usual. Tell the person which it was.

`factory-foreman status` shows each step's latest and approved version and any
open blocking questions.

## When a command refuses

A refusal exits with code 2 and says what is missing. Fix that and rerun. Don't
work around a refusal by editing the issue body, its comments, or the notes,
reviews and markers under `.factory-foreman/`. The only state file you edit is
the draft there; never commit anything in that folder. A hook stops your shell from running approve or slice merge
unless the person is asked in the chat, and stops pull request reviews and
merges entirely; those are for the person.
