---
name: factory-foreman
description: Use when working a feature on a GitHub issue tracked by factory-foreman (a factory-foreman.config.json at the repo root, or a factory-foreman/<n> branch). Covers noting decisions as they happen, drafting Shape and Design, and checkpointing them for a person to approve.
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
in the issue's Decisions table. Note the decision, not the conversation. Never
put secrets, tokens or personal data in a note.

## Draft, check, checkpoint

1. `factory-foreman draft shape` (or `design`) prints the brief: the budget, the
   latest version, the notes since it, and the draft file to edit. For Design it
   also lists the approved Shape's acceptance criteria.
2. Edit the draft file. Keep its front matter: `base` is the version you started
   from, and the CLI uses it to refuse a stale write.
3. Follow `references/shape.md` or `references/design.md` for what goes in each
   section.
4. Show the person the draft and settle anything they raise.
5. `factory-foreman checkpoint shape` posts it as the next version. If it's
   refused, fix each problem it lists and run it again. If it's refused as
   stale, someone else posted first: run `factory-foreman draft shape --reset`,
   fold your changes into the latest version, and checkpoint again.
6. Tell the person the version is posted and that they approve it themselves,
   in their own terminal: `factory-foreman approve shape v<N>`. Don't run
   approve yourself; it refuses in an agent's shell anyway.

Design can only be checkpointed once a Shape version is approved.

## When a command refuses

A refusal exits with code 2 and says what is missing. Fix that and rerun. Don't
work around a refusal by editing files under `.git/factory-foreman/`, the issue
body or its comments.
