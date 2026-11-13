# Slice 2: Clear read books

Criteria owned by this slice:

- AC-1: WHEN the person clears read books from a list of "Dune" (read) and "Emma" (unread), THE list SHALL show only "Emma".

`src/main.ts` re-renders from the returned list, and every function returns a new list rather than changing the
one it was given.

Tests: `pnpm test` passes on this branch (4 passed).
