// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Raises nothing above minor on a sound Shape", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Doesn't call the decided undo choice an open question", weight: 2, check: (o) => absent(o, /(undo|confirm)[^\n]{0,120}(undecided|not decided|open question|still open)/iu) },
]
