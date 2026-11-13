# Brief: Slice 2, Clear read books

Design entry: add `clearRead(list)` to `src/reading-list.ts`. It returns a new list without the read books; unread
books keep their order and ids, and `nextId` is unchanged. Files: `src/reading-list.ts`,
`src/reading-list.test.ts`. Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN clearRead is given "Dune", "Emma" (read) and "Ubik", IT SHALL return "Dune" then "Ubik".
- AC-2: WHEN clearRead is given a list with no read book, IT SHALL return a list equal to the one it was given.

Frozen acceptance tests:

```ts
it('AC-1: clears read books', () => {
  const list = toggle(add(add(add(empty(), 'Dune'), 'Emma'), 'Ubik'), 2)
  expect(clearRead(list).items.map(i => i.title)).toEqual([ 'Dune', 'Ubik' ])
})

it('AC-2: keeps a list with nothing read', () => {
  const list = add(add(empty(), 'Dune'), 'Emma')
  expect(clearRead(list)).toEqual(list)
})
```

Not settled anywhere, and internal: whether the "is it read" check is inline or a small named helper, and where in
the file the function goes.
