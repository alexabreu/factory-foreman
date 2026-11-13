# Brief: Slice 3, the "clear read" button

Design entry: add a toolbar button in `src/main.ts` that calls `clearRead` and re-renders, then shows a short message
saying how many books went. Files: `src/main.ts`, `e2e/reading-list.e2e.ts`. Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN the person uses the toolbar's clear control with "Emma" read, THE list SHALL no longer show "Emma".

The e2e test finds the button by its role and accessible name, which this slice chooses.

Nothing in the Shape, the Design or the repo's standards gives the button's label or the message's wording. The
product uses short, plain labels elsewhere ("Add", "Show").
