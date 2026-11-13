// Recall: three seeded test defects. Written before any variant ran on this case.
import { citesAtLeast, matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Finds that the test mocks clearRead, the function it is meant to test', weight: 3, check: o => matches(o, /(mock|spy|stub)[^\n]{0,200}(clearRead|function under test|unit under test|itself|the code (it|being) test)|clearRead[^\n]{0,160}(mock|spied|stubb|replaced)/iu) },
  { text: 'Finds that toBeGreaterThanOrEqual(0) can never fail', weight: 3, check: o => matches(o, /(toBeGreaterThanOrEqual\(0\)|>=\s?0|at least (0|zero))[^\n]{0,200}(always|never fail|can(no|')t fail|tautolog|any (list|length|value)|meaningless|proves nothing)|(always (passes|true)|can(no|')t fail|never fails?)[^\n]{0,160}(length|toBeGreaterThanOrEqual|>=)/iu) },
  { text: 'Finds that no book in the test input is read, so AC-1 is never exercised', weight: 2, check: o => matches(o, /(no (book|item)[^\n]{0,40}(is |marked )?read|never (toggle|mark)[^\n]{0,40}read|nothing (is )?(marked )?read|without (toggling|marking)|(both|all) (books|items) (are |stay )?unread|Dune (is |was )?(never|not) (marked )?read)/iu) },
  { text: 'Cites file:line in the test file', weight: 1, check: o => citesAtLeast(o, /reading-list\.test\.ts/u, 1) },
]
