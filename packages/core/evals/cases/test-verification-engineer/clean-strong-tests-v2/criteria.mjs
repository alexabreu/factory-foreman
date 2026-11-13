// A clean slice with strong tests: every item measures precision. Written before
// any variant ran on this case.
import { absent, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: 'Raises nothing above minor on a slice with strong tests', weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: 'Does not say the input is left unchecked', weight: 2, check: (o) => absent(o, /(input|original|given) (list )?[^\n]{0,60}(not|never|isn't|is not) (checked|tested|verified|asserted)|(no test|nothing)[^\n]{0,60}(input|original)[^\n]{0,40}unchanged/iu) },
  { text: 'Does not say the base run is missing', weight: 1, check: (o) => absent(o, /(no|missing|without)[^\n]{0,40}(red|run|evidence)[^\n]{0,40}(at|on) (the )?base/iu) },
]
