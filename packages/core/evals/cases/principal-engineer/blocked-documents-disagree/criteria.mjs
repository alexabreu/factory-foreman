// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'
import { statusIn } from '../../../lib/status.mjs'

export default [
  { text: "Returns BLOCKED or NEEDS_CONTEXT", weight: 3, check: statusIn(['BLOCKED', 'NEEDS_CONTEXT']) },
  { text: "Names the disagreement between the Design's null and AC-2", weight: 2, kind: "recall", check: o => matches(o, /(null|Book not found)[^\n]{0,240}(AC-2|criterion|stay|unchanged|no message)|(AC-2|criterion)[^\n]{0,240}(null|Book not found|Design)/iu) },
  { text: "Gives a recommendation", weight: 1, kind: "recall", check: o => matches(o, /(recommend|suggest|I'd (follow|go|pick|keep)|propose)/iu) },
]
