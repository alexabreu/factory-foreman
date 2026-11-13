// Written before any variant ran on this case.
import { noFindingsAbove } from '../../../lib/checks.mjs'
import { verdictIs } from '../../../lib/verdicts.mjs'

export default [
  { text: "Raises nothing above minor on a clean feature", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Gives AC-3 the verdict deferred", weight: 2, check: verdictIs('AC-3', 'deferred') },
  { text: "Gives AC-1 and AC-2 the verdict met", weight: 1, check: (o) => { const a = verdictIs('AC-1', 'met')(o), b = verdictIs('AC-2', 'met')(o); return { passed: a.passed && b.passed, evidence: `${a.evidence}; ${b.evidence}` } } },
]
