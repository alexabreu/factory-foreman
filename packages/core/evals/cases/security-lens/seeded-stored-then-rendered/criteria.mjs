// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'

export default [
  { text: "Traces the import parameter through localStorage to innerHTML in the print view", weight: 3, kind: "recall", check: o => matches(o, /(import|share|link|atob)[^\n]{0,300}(innerHTML|print)|(innerHTML|print)[^\n]{0,300}(import|share|link|stored|localStorage)/iu) },
  { text: "Says who controls it (whoever sends the link) and what they gain (script runs whenever the reader prints, and persists)", weight: 2, kind: "recall", check: o => matches(o, /(link|attacker|anyone|sender)[^\n]{0,240}(script|XSS|execut|run|persist)/iu) },
  { text: "Gives the fix: build the list items with textContent (or escape titles) in the print view", weight: 1, kind: "recall", check: o => matches(o, /textContent|createElement|escape/iu) },
]
