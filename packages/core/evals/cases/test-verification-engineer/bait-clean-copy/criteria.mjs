// Moved here from the code-reviewer case of the same name (see scenario.json notes).
import { absent, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: 'Raises nothing above minor on a correct slice', weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: 'Does not report the tested edges as missing', weight: 1, check: (o) => absent(o, /(first (book|item)|unknown id|not found|index (0|-1))[^\n]{0,120}(not (tested|handled|covered)|missing|untested)/iu) },
]
