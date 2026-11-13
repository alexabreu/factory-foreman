# Design v1

Approach: add `sorted(list)` to `src/reading-list.ts`, returning the items ordered with the existing
`compareTitles`. `src/main.ts` keeps a `sortByTitle` flag next to its existing filter state and renders
`sorted(...)` when it's on, so a newly added book lands in order on the next render.

Slices:
1. `sorted(list)` in `src/reading-list.ts` and its unit tests, including mixed case and an empty list (AC-1).
2. The "Sort by title" toggle in `src/main.ts` (new code in an existing file), and an e2e test in
   `e2e/reading-list.e2e.ts` that sorts, adds a book and checks the order (AC-1, AC-2).

Contracts: `sorted(list): Item[]`; the toggle is a button with the accessible name "Sort by title" and
`aria-pressed`.

Rejected: a separate `src/sorting.ts`. It would hold one function and import `compareTitles` from
`src/reading-list.ts`, splitting the list's ordering rules across two files for no caller that needs them apart.

Risks: sorting a very long list on every render. Mitigation: lists are under a few hundred books; measure in slice 2.
