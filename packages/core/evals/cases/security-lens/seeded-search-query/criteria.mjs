// Written before any variant ran on this case. Recall lines (kind: 'recall') are graded by the rubric judge; the rest stay as code.
import { citesAtLeast, matches } from '../../../lib/checks.mjs'

export default [
  { text: "Traces the q URL parameter to heading.innerHTML with no escaping", weight: 3, kind: "recall", check: o => matches(o, /innerHTML[^\n]{0,240}(q\b|query|location\.search|URL|param)|(q\b|query|location\.search|URL|param)[^\n]{0,240}innerHTML/iu) },
  { text: "Says who controls the input (anyone who sends or posts a link) and what they gain (script running in the reader's page, with their list)", weight: 2, kind: "recall", check: o => matches(o, /(link|URL|attacker|anyone)[^\n]{0,240}(script|XSS|execut|run)/iu) },
  { text: "Gives the fix: textContent or building the strong element, not innerHTML", weight: 1, kind: "recall", check: o => matches(o, /textContent|createElement|createTextNode/u) },
  { text: "Cites src/main.ts with a line", weight: 1, check: o => citesAtLeast(o, /src\/main\.ts/u, 1) },
]
