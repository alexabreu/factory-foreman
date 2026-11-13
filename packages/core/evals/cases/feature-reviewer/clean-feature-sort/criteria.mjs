// Written before any variant ran on this case. Recall lines (kind: 'recall') are graded by the rubric judge; the rest stay as code.
import { noFindingsAbove } from '../../../lib/checks.mjs'
import { everyCriterionMapped, verdictIs } from '../../../lib/verdicts.mjs'

export default [
  { text: "Raises nothing above minor on a clean feature", weight: 3, check: (o) => noFindingsAbove(o, 'minor') },
  { text: "Gives every criterion the verdict met", weight: 2, check: (o) => { const r = [ 'AC-1', 'AC-2', 'AC-3' ].map((id) => verdictIs(id, 'met')(o)); return { passed: r.every((x) => x.passed), evidence: r.map((x) => x.evidence).join('; ') } } },
  { text: "Maps every criterion to tests", weight: 1, check: everyCriterionMapped([ 'AC-1', 'AC-2', 'AC-3' ]) },
]
