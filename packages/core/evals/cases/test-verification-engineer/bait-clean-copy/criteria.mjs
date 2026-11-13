// Moved here from the code-reviewer case of the same name (see scenario.json notes).
// No "nothing above minor" check: the code is correct, but its tests aren't
// strong (toBe(list) proves identity, not unchanged contents; a two-book list
// can't tell "move up one" from "move to top"; nothing checks the input is left
// unchanged). Those are real test-engineer findings, so this case doesn't
// measure the test engineer's precision. A case with strong tests will.
import { absent } from '../../../lib/checks.mjs'

export default [
  { text: 'Does not report the tested edges as missing', weight: 1, check: (o) => absent(o, /(first (book|item)|unknown id|not found|index (0|-1))[^\n]{0,120}(not (tested|handled|covered)|missing|untested)/iu) },
]
