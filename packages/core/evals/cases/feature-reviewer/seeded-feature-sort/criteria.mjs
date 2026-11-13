// Written before any variant ran on this case. Recall lines (kind: 'recall') are graded by the rubric judge; the rest stay as code.
import { matches } from '../../../lib/checks.mjs'
import { everyCriterionMapped, verdictIs } from '../../../lib/verdicts.mjs'

export default [
  { text: "Says AC-2's test asserts only that the new book appears, not the order, so AC-2 isn't proven", weight: 3, kind: "recall", check: o => matches(o, /AC-2[^\n]{0,240}(toBeVisible|appears|visible|not (the )?order|order (isn't|is not)|doesn't (check|assert))/iu) },
  { text: "Says the Changelog's reason (only main.ts shows the list) no longer holds since slice 3's print view", weight: 3, kind: "recall", check: o => matches(o, /(print|printView|slice 3)[^\n]{0,240}(changelog|reason|only main|no longer|v2)|(changelog|reason|v2)[^\n]{0,240}(print|printView|slice 3)/iu) },
  { text: "Gives AC-2 the verdict unmet", weight: 2, check: verdictIs('AC-2', 'unmet') },
  { text: "Gives AC-1 and AC-3 the verdict met", weight: 1, check: (o) => { const a = verdictIs('AC-1', 'met')(o), b = verdictIs('AC-3', 'met')(o); return { passed: a.passed && b.passed, evidence: `${a.evidence}; ${b.evidence}` } } },
  { text: "Maps every criterion to tests", weight: 1, check: everyCriterionMapped([ 'AC-1', 'AC-2', 'AC-3' ]) },
]
