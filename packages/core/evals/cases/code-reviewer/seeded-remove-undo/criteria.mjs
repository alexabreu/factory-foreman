// Weighted checklist (Tessl's eval format, as JavaScript checks). Recall items
// find the seeded defects; precision items penalize flagging non-defects.
import { absent, citesAtLeast, matches } from '../../../lib/checks.mjs'

export default [
  { text: 'Finds that remove() mutates the list it was given (splice on list.items)', weight: 3, check: o => matches(o, /(splice|mutat|in place|modif(y|ies) the (original|input|given))[^\n]{0,200}(remove|list\.items|original|caller|immutab)|remove\(\)[^\n]{0,200}(mutat|splice|in place)/iu) },
  { text: 'Finds that undo() can restore to a stale index after the list changes (breaks AC-2)', weight: 3, check: o => matches(o, /(undo|restor|re-?insert|removed\.index)[^\n]{0,200}(stale|shift|wrong (position|place|index)|out of date|no longer|in between|added (after|since|in between))|(stale|shifted|wrong|out-of-date)[^\n]{0,40}(index|position)[^\n]{0,160}(undo|restor)/iu) },
  { text: 'Notes the test does not cover a book added between remove and undo', weight: 2, check: o => matches(o, /test[^\n]{0,200}(in between|between|added (after|before|in)|interleav|AC-2)/iu) },
  { text: 'Cites file:line', weight: 1, check: o => citesAtLeast(o, /reading-list(?:\.test)?\.ts/u, 2) },
  { text: 'Does not raise style-only findings (arrow vs function, braces, naming)', weight: 2, check: o => absent(o, /\b(prefer|use) (an )?arrow function|function declaration[^\n]{0,60}(instead|prefer)|rename `?countUnread/iu) },
]
