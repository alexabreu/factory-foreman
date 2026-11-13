# Brief: Slice 1, Remove a book

Design entry: add `remove(list, id)` to `src/reading-list.ts`. It returns the new list, or `null` when the id isn't in
the list, so `main.ts` can show "Book not found". Files: `src/reading-list.ts`, `src/reading-list.test.ts`. Budget: 400
changed lines.

Criteria owned by this slice:

- AC-1: WHEN the person removes "Dune" from "Dune" and "Emma", THE list SHALL show only "Emma".
- AC-2: WHEN the id isn't in the list, THE list SHALL stay as it was and no message SHALL be shown.

Frozen acceptance tests:

```ts
it('AC-1: removes a book', () => {
  expect(remove(add(add(empty(), 'Dune'), 'Emma'), 1)!.items.map(i => i.title)).toEqual([ 'Emma' ])
})
```
