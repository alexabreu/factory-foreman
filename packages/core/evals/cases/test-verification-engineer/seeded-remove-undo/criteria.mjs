// Moved here from the code-reviewer case of the same name (see scenario.json notes).
import { matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Notes the test does not cover a book added between remove and undo', weight: 2, check: o => matches(o, /test[^\n]{0,200}(in between|between|added (after|before|in)|interleav|AC-2)/iu) },
]
