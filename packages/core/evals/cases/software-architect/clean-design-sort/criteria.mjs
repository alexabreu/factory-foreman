// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Raises nothing above minor on a sound Design", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Doesn't claim a named file is missing", weight: 2, check: (o) => absent(o, /(src\/reading-list\.ts|src\/main\.ts|e2e\/reading-list\.e2e\.ts)[^\n]{0,80}(doesn't exist|does not exist|not (in|found)|no such|missing)/iu) },
]
