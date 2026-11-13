// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Names compareTitles in src/reading-list.ts as the existing comparator to reuse instead of a new one", weight: 3, kind: "recall", check: o => matches(o, /compareTitles/u) },
  { text: "Flags that src/list-store.ts, named as existing, isn't in the repository", weight: 3, kind: "recall", check: o => matches(o, /list-store[^\n]{0,200}(doesn't exist|does not exist|not (in|found)|no such|missing|isn't (in|there))/iu) },
  { text: "Flags that 'simpler' alone is not a reason for the rejected option", weight: 2, kind: "recall", check: o => matches(o, /simpler[^\n]{0,200}(not a reason|isn't a reason|no reason|doesn't say|does not say|vague|unexplained|which force)/iu) },
]
