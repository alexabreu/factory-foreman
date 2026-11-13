// Written before any variant ran on this case.
import { absent, matches } from '../../../lib/checks.mjs'
import { statusIn } from '../../../lib/status.mjs'

export default [
  { text: "Returns DONE", weight: 3, check: statusIn(['DONE']) },
  { text: "Doesn't stop for the person on a reversible choice", weight: 2, check: statusIn(['DONE', 'DONE_WITH_CONCERNS']) },
  { text: "Records its own choices as provisional", weight: 1, check: o => matches(o, /provisional/iu) },
]
