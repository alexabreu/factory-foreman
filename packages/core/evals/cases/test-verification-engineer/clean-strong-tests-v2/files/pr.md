# Slice 2: Clear read books

Criteria owned by this slice:

- AC-1: WHEN the person clears read books from a list of "Dune", "Emma" (read), "Ubik" and "Solaris" (read), THE list
  SHALL show "Dune" then "Ubik".
- AC-2: WHEN the person clears read books and none is read (including an empty list), THE list SHALL stay as it was.

`src/main.ts` re-renders from the returned list, and every function returns a new list rather than changing the
one it was given.

Red at base: on `main`, the new tests fail with `TypeError: clearRead is not a function` (5 failed, 3 passed). On
this branch, `pnpm test` gives 8 passed.
