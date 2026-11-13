# Merged slices

## Slice 1: clearRead (AC-1)

```ts
// src/reading-list.test.ts
it('AC-1: clears read books', () => {
  const list = toggle(add(add(add(empty(), 'Dune'), 'Emma'), 'Ubik'), 2)
  expect(clearRead(list).items.map(i => i.title)).toEqual([ 'Dune', 'Ubik' ])
})
```

## Slice 2: the button and its message (AC-2)

```ts
// e2e/reading-list.e2e.ts
test('AC-2: says how many were cleared (no Undo yet, D14)', async ({ page }) => {
  await addBooks(page, [ 'Dune', 'Emma', 'Ubik' ])
  await markRead(page, [ 'Emma', 'Ubik' ])
  await page.getByRole('button', { name: 'Clear read' }).click()
  await expect(page.getByRole('status')).toHaveText('2 books cleared')
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
})
```

Slice 2's card: "AC-3 is deferred to #31 (D14); no Undo button ships until then."
