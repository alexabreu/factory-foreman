// Moved here from the code-reviewer case of the same name (see scenario.json notes).
// Round 2 (13 Nov): widened to the other word order and "intervening"; round 1
// missed correct Codex findings worded "undo after an intervening addition, but
// this test immediately calls undo". Round 1 results stay recorded.
import { matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Notes the test does not cover a book added between remove and undo', weight: 2, check: o => matches(o, /test[^\n]{0,200}(in between|between|added (after|before|in)|interleav|AC-2)|(in between|between|intervening|meanwhile|after an? (addition|add)|added (after|before|in))[^\n]{0,200}(test|untested|never|not (checked|covered|exercised))/iu) },
]
