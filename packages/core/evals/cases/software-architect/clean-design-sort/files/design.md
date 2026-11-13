# Design v1

Approach: add `sorted(items: Item[]): Item[]` to `src/reading-list.ts`. It copies the array and orders the copy with
the existing `compareTitles`, so it never reorders what it's given (`visible(list, 'all')` returns `list.items`
itself). `src/main.ts` keeps a `sortByTitle` flag next to its existing filter state and renders
`sortByTitle ? sorted(visible(list, filter)) : visible(list, filter)`, so a newly added book lands in order on the
next render and the filter still applies.

Slices:
1. `sorted(items)` in `src/reading-list.ts` and its unit tests, including mixed case, an empty list, and that the
   input array is left in its order (AC-1).
2. The "Sort by title" toggle in `src/main.ts` (new code in an existing file), and an e2e test in
   `e2e/reading-list.e2e.ts` that sorts, adds a book and checks the order (AC-1, AC-2).

Contracts: `sorted(items: Item[]): Item[]`, returning a new array; the toggle is a button with the accessible name "Sort by title" and
`aria-pressed`.

Rejected: a separate `src/sorting.ts`. It would hold one function and import `compareTitles` from
`src/reading-list.ts`, splitting the list's ordering rules across two files for no caller that needs them apart.

Risks: sorting a very long list on every render. Mitigation: lists are under a few hundred books; measure in slice 2.
