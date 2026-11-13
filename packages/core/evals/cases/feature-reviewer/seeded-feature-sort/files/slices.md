# Merged slices

## Slice 1: `sorted(list)` (AC-1)

```ts
// src/reading-list.test.ts
it('AC-1: sorts by title, ignoring case', () => {
  const list = add(add(add(empty(), 'Ubik'), 'dune'), 'Emma')
  // A case-sensitive sort would give Emma, Ubik, dune.
  expect(sorted(list).map(i => i.title)).toEqual([ 'dune', 'Emma', 'Ubik' ])
})
```

## Slice 2: the "Sort by title" toggle (AC-1, AC-2, AC-3)

```ts
// e2e/reading-list.e2e.ts
test('AC-1 and AC-3: the toggle sorts and unsorts', async ({ page }) => {
  await addBooks(page, [ 'Ubik', 'Dune', 'Emma' ])
  await page.getByRole('button', { name: 'Sort by title' }).click()
  await expect(page.getByRole('listitem')).toHaveText([ 'Dune', 'Emma', 'Ubik' ])
  await page.getByRole('button', { name: 'Sort by title' }).click()
  await expect(page.getByRole('listitem')).toHaveText([ 'Ubik', 'Dune', 'Emma' ])
})

test('AC-2: keeps the order after adding', async ({ page }) => {
  await addBooks(page, [ 'Ubik', 'Dune' ])
  await page.getByRole('button', { name: 'Sort by title' }).click()
  await addBooks(page, [ 'Emma' ])
  await expect(page.getByRole('listitem', { name: 'Emma' })).toBeVisible()
})
```

```ts
// src/main.ts (render)
const items = sortByTitle ? sorted(list) : list.items
```

## Slice 3: print view

```ts
// src/print.ts
export function printView(list: ReadingList): string {
  return list.items.map(i => `- ${i.title}`).join('\n')
}
```
