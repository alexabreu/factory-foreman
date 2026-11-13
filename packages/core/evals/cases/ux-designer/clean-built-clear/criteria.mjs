// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Raises nothing above minor when the built screen matches the Design", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Doesn't claim the undo or the accessible name is missing", weight: 2, check: (o) => absent(o, /(no|missing|without|lacks?)[^\n]{0,40}(undo|accessible name|aria-label)/iu) },
]
