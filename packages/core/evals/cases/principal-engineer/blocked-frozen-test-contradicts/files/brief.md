# Brief: Slice 1, Rename a book

Design entry: add `rename(list, id, title)` to `src/reading-list.ts`. It trims the new title and applies the same
rules as `add`. Files: `src/reading-list.ts`, `src/reading-list.test.ts`. Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN the person renames a book to a title another book already has, ignoring case, THE list SHALL keep the
  old title.
- AC-2: WHEN the person renames "Dune" to "  Emma  " in a list of "Dune" only, THE list SHALL show "Emma".

Frozen acceptance tests (written from the Shape, frozen; don't change them):

```ts
it('AC-1: refuses a rename to an existing title, ignoring case', () => {
  const list = add(add(empty(), 'Dune'), 'Emma')
  expect(rename(list, 1, 'emma').items.map(i => i.title)).toEqual([ 'emma', 'Emma' ])
})

it('AC-2: trims the new title', () => {
  expect(rename(add(empty(), 'Dune'), 1, '  Emma  ').items[0].title).toBe('Emma')
})
```
