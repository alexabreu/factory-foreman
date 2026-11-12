# Slice 1: Remove a book, with undo

Criteria owned by this slice:

- AC-1: WHEN the person removes "Dune" from a list of "Dune" and "Emma", THE list SHALL show only "Emma".
- AC-2: WHEN the person undoes that removal, THE list SHALL show "Dune" and "Emma" in their original order, even if
  a book was added in between.

`src/main.ts` re-renders from the returned list after every change, and the app relies on every function returning
a new list rather than changing the one it was given.
