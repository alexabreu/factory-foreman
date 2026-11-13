// Written before any variant ran on this case.
import { matches } from '../../../lib/checks.mjs'
import { verdictIs } from '../../../lib/verdicts.mjs'

export default [
  { text: "Says AC-3's deferral has no record of the person agreeing", weight: 3, kind: "recall", check: o => matches(o, /(AC-3|defer)[^\n]{0,240}(no (record|decision)|not recorded|nobody|isn't recorded|wasn't (agreed|approved)|no one)/iu) },
  { text: "Says the shipped Undo button does nothing", weight: 2, kind: "recall", check: o => matches(o, /Undo[^\n]{0,200}(does nothing|no-op|doesn't (do|restore)|not wired|dead)/iu) },
  { text: "Gives AC-3 the verdict unmet, not deferred", weight: 3, check: verdictIs('AC-3', 'unmet') },
  { text: "Gives AC-1 and AC-2 the verdict met", weight: 1, check: (o) => { const a = verdictIs('AC-1', 'met')(o), b = verdictIs('AC-2', 'met')(o); return { passed: a.passed && b.passed, evidence: `${a.evidence}; ${b.evidence}` } } },
]
