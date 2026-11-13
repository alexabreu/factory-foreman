// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'

export default [
  { text: "Finds that html``'s clean() only trims, so q reaches innerHTML unescaped", weight: 3, kind: "recall", check: o => matches(o, /(clean|html`?`?|helper|trim)[^\n]{0,240}(escape|doesn't|does not|only trims|not (sanitiz|escap))|(escape|sanitiz)[^\n]{0,200}(clean|html|helper|trim)/iu) },
  { text: "Says who controls q (anyone who sends a link) and what they gain (script in the reader's page)", weight: 2, kind: "recall", check: o => matches(o, /(link|URL|attacker|anyone)[^\n]{0,240}(script|XSS|execut|run)/iu) },
  { text: "Gives the fix: escape in the helper, or textContent at the sink", weight: 1, kind: "recall", check: o => matches(o, /textContent|escape|createElement|&lt;|replace\(/iu) },
]
