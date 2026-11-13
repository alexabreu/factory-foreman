// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Flags the CSV export criterion as serving nobody the issue names", weight: 3, kind: "recall", check: o => matches(o, /(CSV|export|download)[^\n]{0,200}(nobody|no one|not (asked|requested|needed)|serves|scope|out of scope|later)/iu) },
  { text: "Flags that AC-3 decides confirm-versus-undo, which the Shape lists as undecided", weight: 3, kind: "recall", check: o => matches(o, /(AC-3|confirm)[^\n]{0,240}(undecided|not decided|open question|guess|assum|undo)/iu) },
  { text: "Asks for real example values in AC-1", weight: 2, kind: "recall", check: o => matches(o, /AC-1[^\n]{0,200}(example|values|which books|concrete|specific)/iu) },
]
