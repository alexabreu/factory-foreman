# Design v1

Approach: add `src/sorting.ts` with a new comparator, `titleOrder(a, b)`, that lowercases both titles and compares
them with `<`. `sortBy(list, order)` returns the list's items in that order.

Slices:
1. `src/sorting.ts` and its unit tests (AC-1).
2. Keep the sort applied after adding: call `sortBy` from the existing `src/list-store.ts`, which holds the current
   view's state (AC-2).

Contracts: `sortBy(list, order)`; the toolbar button has the accessible name "Sort by title".

Rejected: sorting inside `src/reading-list.ts`. Rejected because a separate module is simpler.
