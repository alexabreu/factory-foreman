# Building a slice

A slice is one numbered piece of the approved Design, built on its own branch
and draft pull request, stacked on the slice below. Its acceptance tests come
first and are frozen; the code then has to make them pass.

1. `factory-foreman slice open <n>` cuts `factory-foreman/<issue>-slice-<n>`
   and opens the draft PR. Switch to that branch.
2. `factory-foreman slice tests <n>` prints a brief for the
   `test-verification-engineer`. Run it as a native subagent of that agent (the
   Agent tool in Claude Code; spawn the agent type in Codex), passing the brief.
   It reads only the approved Shape and Design, and writes:
   - at least one test per owned AC, with `AC-n` in the test's title or the
     file's name, finding elements only by the contracts' test ids and
     importing only the files the contracts name;
   - one show script per visual AC: `{ "ac": "AC-1", "says": "…", "url": "/",
     "steps": [ { "fill": "<test id>", "text": "…" }, { "click": "<test id>" } ] }`.
   Commit those files, and only those, as one commit. Then
   `factory-foreman slice tests <n> --save` freezes them. Never edit them after.
3. Build the slice in its own files (the Design lists them) plus the repo's
   shared files. Commit.
4. `factory-foreman slice review <n>`: run each brief as a subagent, settle
   every finding with the person, then `slice review save <n> --findings <file>`.
   A new commit needs a new review.
5. `factory-foreman slice iterate`. If it refuses, fix what it lists:
   - the AC gate: each test must fail at the slice's base only because the
     slice isn't built yet (an assertion, an import of a file the slice adds, or
     a missing test id its contract adds), and pass at head. A test that can't
     reach the code (a wrong import name, say) is refused: that's a test
     problem, so tell the person; frozen tests aren't yours to change;
   - a file outside the slice: move the change to the slice that owns it;
   - over the line budget: tell the person the slice needs splitting.
   When it passes, it pushes, tags the iteration and posts it on the PR.
6. Tell the person the iteration is up and ask whether to approve it. When they
   say so, run `factory-foreman approve slice <n>` as one plain command: Claude
   Code asks them, showing the PR's head and CI, and their Allow approves it
   under their login and merges it once CI is green. If CI isn't green yet, say
   so; when it is and they ask, run `factory-foreman slice merge <n>` the same
   way. Never post a factory-foreman record or a comment from a file with gh.

In Codex's sandbox `.git` is read-only, so committing and pushing need the
person to add it as a writable root; `slice iterate` refuses there and names
the command for the person to run.
