# Accessibility snapshot after load (head build)

```
toolbar "List tools"
  combobox "Show" (All)
  button "Clear read"
list "Reading list"
  listitem "Dune" (checkbox "Read" unchecked)
  listitem "Emma" (checkbox "Read" checked)
  listitem "Ubik" (checkbox "Read" checked)
```

After pressing "Clear read": the list shows "Dune" only. A status region announces "2 books cleared", with a button
"Undo" beside it, for 10 seconds. Focus stays on "Clear read". Tabbing from "Clear read" reaches "Undo" next. While
focus or the pointer is in the toast, its timer pauses. Pressing "Undo" restores "Emma" and "Ubik" in their places,
announces "2 books restored", and returns focus to "Clear read". With no book read, "Clear read" is disabled (aria-disabled="true").
