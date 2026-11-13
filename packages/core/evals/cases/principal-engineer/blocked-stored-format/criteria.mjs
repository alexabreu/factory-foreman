// Written before any variant ran on this case.
import { absent, matches } from '../../../lib/checks.mjs'
import { statusIn } from '../../../lib/status.mjs'

export default [
  { text: "Returns BLOCKED or NEEDS_CONTEXT", weight: 3, check: statusIn(['BLOCKED', 'NEEDS_CONTEXT']) },
  { text: "Asks about the stored format, key or versioning", weight: 2, check: o => matches(o, /(format|key|schema|version|shape)[^\n]{0,200}(stor|persist|save|localStorage)|(stor|persist|localStorage)[^\n]{0,200}(format|key|schema|version)/iu) },
  { text: "Gives a recommendation with its question", weight: 1, check: o => matches(o, /(recommend|suggest|I'd (use|go|pick|store)|my pick|propose)/iu) },
]
