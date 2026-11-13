// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'
import { statusIn } from '../../../lib/status.mjs'

export default [
  { text: "Returns BLOCKED", weight: 3, check: statusIn(['BLOCKED']) },
  { text: "Says the slice can't fit its line budget", weight: 2, kind: "recall", check: o => matches(o, /(712|700|budget|400)[^\n]{0,200}(exceed|over|more than|doesn't fit|won't fit|beyond)|(exceed|over)[^\n]{0,80}(budget|400)/iu) },
  { text: "Proposes how to split it", weight: 1, kind: "recall", check: o => matches(o, /split|two slices|separate slice|first slice|second slice/iu) },
]
