# Slice 3: Move a book up

Criteria owned by this slice:

- AC-1: WHEN the person moves "Emma" up in a list of "Dune" then "Emma", THE list SHALL show "Emma" then "Dune".
- AC-2: WHEN the person moves the first book up, THE list SHALL stay as it was.
- AC-3: WHEN the id isn't in the list, THE list SHALL stay as it was.

`src/main.ts` re-renders from the returned list, and every function returns a new list rather than changing the
one it was given.
