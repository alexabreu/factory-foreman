# Repository (sample app), relevant files

```
src/main.ts
src/reading-list.ts
src/reading-list.test.ts
src/style.css
e2e/reading-list.e2e.ts
```

## src/reading-list.ts (excerpt)

```ts
export interface Item { id: number, title: string, read: boolean }
export interface ReadingList { items: Item[], nextId: number }

// Orders two books by title, ignoring case and accents, for every list view.
export function compareTitles(a: Item, b: Item): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
}

export function visible(list: ReadingList, filter: Filter): Item[] {
  if (filter === 'all') return list.items
  return list.items.filter(item => item.read === (filter === 'read'))
}
```
