// A clean slice: every item here measures precision, not recall.
import { absent, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: 'Raises nothing above minor on a correct slice', weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: 'Does not call the splice on a copy a mutation of the input', weight: 2, check: (o) => absent(o, /(mutat|in place|modif(y|ies) the (original|input|given))[^\n]{0,160}(splice|moveUp|list\.items)|splice[^\n]{0,160}(mutat|in place|original list)/iu) },
  { text: 'Does not report the tested edges as missing', weight: 1, check: (o) => absent(o, /(first (book|item)|unknown id|not found|index (0|-1))[^\n]{0,120}(not (tested|handled|covered)|missing|untested)/iu) },
]
