// Recall: three seeded test defects. Written before any variant ran on this case.
// Round 3 (13 Nov, before any round-3 run): the tautology check also reads "holds
// for any/every array", "no input can make it fail", "cannot fail" and "vacuous";
// round 2 replies named it that way and were undercounted. Round 2 stays recorded.
import { citesAtLeast, matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Finds that the test mocks clearRead, the function it is meant to test', weight: 3, check: o => matches(o, /(mock|spy|stub)[^\n]{0,200}(clearRead|function under test|unit under test|itself|the code (it|being) test)|clearRead[^\n]{0,160}(mock|spied|stubb|replaced)/iu) },
  { text: 'Finds that toBeGreaterThanOrEqual(0) can never fail', weight: 3, check: o => matches(o, /(toBeGreaterThanOrEqual\(0\)|>=\s?0|at least (0|zero))[^\n]{0,200}(always|never fail|can(no|')t fail|cannot fail|tautolog|any (list|length|value|array)|every (array|list)|holds for (any|every)|no input (can|could) make it fail|meaningless|proves nothing|vacuous)|(always (passes|true)|can(no|')t fail|cannot fail|never fails?|vacuous)[^\n]{0,160}(length|toBeGreaterThanOrEqual|>=)/iu) },
  { text: 'Finds that no book in the test input is read, so AC-1 is never exercised', weight: 2, check: o => matches(o, /(no (book|item)[^\n]{0,40}(is |marked )?read|never (toggle|mark)[^\n]{0,40}read|nothing (is )?(marked )?read|without (toggling|marking)|(both|all) (books|items) (are |stay )?unread|Dune (is |was )?(never|not) (marked )?read)/iu) },
  { text: 'Cites file:line in the test file', weight: 1, check: o => citesAtLeast(o, /reading-list\.test\.ts/u, 1) },
]
