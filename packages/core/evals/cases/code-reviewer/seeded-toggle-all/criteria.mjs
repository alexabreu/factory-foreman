import { countAtLeast, matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Finds the crash on an empty list (items[0] is undefined)', weight: 3, check: o => matches(o, /(empty|no (books|items)|zero)[^\n]{0,160}(crash|throw|undefined|TypeError|items\[0\])|items\[0\][^\n]{0,160}(undefined|empty|crash|throw)/iu) },
  { text: 'Finds that deciding by the first book breaks AC-1 for a mixed list', weight: 3, check: o => matches(o, /(first (book|item)|items\[0\])[^\n]{0,200}(mixed|some|AC-1|unread|all read|every)|AC-1[^\n]{0,200}(first|mixed)/iu) },
  { text: 'Finds that the test asserts only the length, so it cannot fail for the criterion', weight: 3, check: o => matches(o, /(length|toBe\(2\))[^\n]{0,200}(read|criterion|doesn't|does not|never|only)|test[^\n]{0,160}(only|doesn't|does not)[^\n]{0,80}(read|check|assert)/iu) },
  { text: 'Cites file:line', weight: 1, check: o => countAtLeast(o, /reading-list(\.test)?\.ts:\d+/u, 2) },
]
