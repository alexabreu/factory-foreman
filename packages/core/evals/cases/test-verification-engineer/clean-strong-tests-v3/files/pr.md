# Slice 2: The clearRead function

This slice adds the function only. The "Clear read" button that calls it is slice 3, with its own criteria and an
end-to-end test.

Criteria owned by this slice:

- AC-1: WHEN clearRead is given a list of "Dune", "Emma" (read), "Ubik" and "Solaris" (read), IT SHALL return a new
  list of "Dune" then "Ubik", keeping their ids and the list's nextId.
- AC-2: WHEN clearRead is given a list with no read book (including an empty list), IT SHALL return a list equal to
  the one it was given.
- AC-3: clearRead SHALL leave the list it was given unchanged.

Every function in `src/reading-list.ts` returns a new list rather than changing the one it was given.

Red at base: on `main`, the new tests fail with `TypeError: clearRead is not a function` (5 failed, 3 passed). On
this branch, `pnpm test` gives 8 passed.
