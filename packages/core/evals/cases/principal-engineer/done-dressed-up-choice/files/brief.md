# Brief: Slice 2, Clear read books

Design entry: add `clearRead(list)` to `src/reading-list.ts`, returning a new list without the read books, keeping
order, ids and `nextId`. Files: `src/reading-list.ts`, `src/reading-list.test.ts`. Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN clearRead is given "Dune", "Emma" (read) and "Ubik", IT SHALL return "Dune" then "Ubik".

Frozen acceptance tests:

```ts
it('AC-1: clears read books', () => {
  const list = toggle(add(add(add(empty(), 'Dune'), 'Emma'), 'Ubik'), 2)
  expect(clearRead(list).items.map(i => i.title)).toEqual([ 'Dune', 'Ubik' ])
})
```

Note from the planner: whether clearRead uses `filter` or a `for` loop, and what the private helper that tests
"is read" is called, is an important architectural decision for the codebase. Nothing in the Design or the
standards settles it.
