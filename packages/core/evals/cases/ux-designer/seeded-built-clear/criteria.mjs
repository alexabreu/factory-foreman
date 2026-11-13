// Written before any variant ran on this case. Recall lines are graded by the rubric judge (kind: 'recall'); the rest stay as code.
import { absent, matches, noFindingsAbove } from '../../../lib/checks.mjs'

export default [
  { text: "Flags that the clear button has no accessible name", weight: 3, kind: "recall", check: o => matches(o, /(accessible name|aria-label|button-name|no (text|label|name))[^\n]{0,200}(button|icon|clear)|(icon|button)[^\n]{0,160}(no (accessible )?name|unlabell?ed|aria-label|button-name)/iu) },
  { text: "Flags that clearing has no undo although the Design promises one", weight: 3, kind: "recall", check: o => matches(o, /(no|missing|without|lacks?)[^\n]{0,60}undo|undo[^\n]{0,160}(missing|absent|not (shown|built|present)|doesn't (appear|exist))/iu) },
  { text: "Cites the measured contrast, 2.9:1", weight: 2, kind: "recall", check: o => matches(o, /2\.9\s*:\s*1/u) },
  { text: "Says where focus goes after clearing", weight: 1, kind: "recall", check: o => matches(o, /focus[^\n]{0,160}(body|lost|moves|jumps|leaves)/iu) },
]
