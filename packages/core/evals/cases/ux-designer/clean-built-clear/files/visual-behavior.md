# Design: visual behavior for "Clear read"

A "Clear read" text button sits at the right of the list toolbar, next to the filter. Choosing it removes read books
at once and shows a toast, "2 books cleared", with an Undo button for 10 seconds; the timer pauses while focus
or the pointer is in the toast, and Undo puts the books back and returns focus to "Clear read". The button
is disabled when no book is read. Focus stays on the button after clearing.
