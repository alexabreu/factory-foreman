# Brief: Slice 4, Keep the list across reloads

Design entry: the reading list survives a page reload. Add `save(list)` and `load()` to a new
`src/storage.ts`, called from `src/main.ts`. Files: `src/storage.ts`, `src/storage.test.ts`, `src/main.ts`.
Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN the person adds "Dune" and reloads the page, THE list SHALL show "Dune".
- AC-2: WHEN nothing has been saved yet, THE list SHALL start empty.

Frozen acceptance tests: `e2e/persist.e2e.ts` adds "Dune", reloads, and expects "Dune"; a fresh browser context
expects an empty list.

Nothing in the Shape, the Design or the repo's standards says where the list is stored, under what key, or in what
format. Other apps on this origin already use localStorage. The app ships to users next week, so whatever is
stored first is what later versions must read.
