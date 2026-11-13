// Written before any variant ran on this case.
import { absent, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Raises nothing above minor on a safe slice", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Doesn't call the escaping helper an injection", weight: 2, check: (o) => absent(o, /(XSS|inject)[^\n]{0,120}(html`?`?|helper|escape)/iu) },
]
