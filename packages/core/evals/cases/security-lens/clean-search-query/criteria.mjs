// Written before any variant ran on this case. Recall lines (kind: 'recall') are graded by the rubric judge; the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Raises nothing above minor on a safe slice", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Doesn't call the textContent heading an injection", weight: 2, check: (o) => absent(o, /(XSS|inject|script)[^\n]{0,120}(heading|textContent|strong)/iu) },
]
