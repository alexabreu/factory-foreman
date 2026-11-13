// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'
import { statusIn } from '../../../lib/status.mjs'

export default [
  { text: "Returns BLOCKED or NEEDS_CONTEXT", weight: 3, check: statusIn(['BLOCKED', 'NEEDS_CONTEXT']) },
  { text: "Asks about the visible label or message wording", weight: 2, kind: "recall", check: o => matches(o, /(label|wording|text|name|message)[^\n]{0,200}(button|toast|message|person|see)/iu) },
  { text: "Gives a recommended wording", weight: 1, kind: "recall", check: o => matches(o, /(recommend|suggest|propose|I'd (use|go|pick))[^\n]{0,160}["'“]/iu) },
]
