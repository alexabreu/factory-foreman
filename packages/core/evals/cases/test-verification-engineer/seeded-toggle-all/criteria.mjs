// Moved here from the code-reviewer case of the same name (see scenario.json notes).
import { matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Finds that the test asserts only the length, so it cannot fail for the criterion', weight: 3, check: o => matches(o, /(length|toBe\(2\))[^\n]{0,200}(read|criterion|doesn't|does not|never|only)|test[^\n]{0,160}(only|doesn't|does not)[^\n]{0,80}(read|check|assert)/iu) },
]
