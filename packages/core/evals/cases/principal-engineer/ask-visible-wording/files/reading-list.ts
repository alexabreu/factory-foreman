// src/reading-list.ts (current)
export type Filter = 'all' | 'unread' | 'read'
export interface Item { id: number, title: string, read: boolean }
export interface ReadingList { items: Item[], nextId: number }
export const empty = (): ReadingList => ({ items: [], nextId: 1 })

// Adds a title, trimmed. Blank titles and exact duplicates (ignoring case) are refused.
export function add(list: ReadingList, title: string): ReadingList {
  const clean = title.trim()
  if (!clean) return list
  if (list.items.some(item => item.title.toLowerCase() === clean.toLowerCase())) return list
  return { items: [ ...list.items, { id: list.nextId, title: clean, read: false } ], nextId: list.nextId + 1 }
}

export function toggle(list: ReadingList, id: number): ReadingList {
  return { ...list, items: list.items.map(item => (item.id === id ? { ...item, read: !item.read } : item)) }
}
