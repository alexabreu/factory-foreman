# Shape: Clear read books

Problem: finished books crowd out the ones people still want to read.
People: readers with 20 or more books, two of whom asked for this.

Criteria:

- AC-1: WHEN the person clears read books from "Dune", "Emma" (read), "Ubik" and "Solaris" (read), THE list SHALL
  show "Dune" then "Ubik".
- AC-2: WHEN the person clears read books, THE app SHALL show how many were cleared ("2 books cleared" for AC-1's
  list) with an Undo button for 10 seconds.
- AC-3: WHEN the person chooses Undo within those 10 seconds, THE list SHALL show the cleared books again in their
  original places.
- AC-4: WHEN no book is read, THE "Clear read" button SHALL be disabled.

Decided (12 Nov, by the person): clear at once and offer undo, rather than asking first. Once the 10 seconds
pass, cleared books are deleted; the person doesn't want finished books kept.

Out of scope: exporting, syncing across devices.
