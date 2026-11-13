# Accessibility snapshot after load (head build)

```
toolbar "List tools"
  combobox "Show" (All)
  button ""            <- svg trash icon, no text, no aria-label
list "Reading list"
  listitem "Dune" (checkbox "Read" unchecked)
  listitem "Emma" (checkbox "Read" checked)
  listitem "Ubik" (checkbox "Read" checked)
```

After pressing the icon button: the list shows "Dune" only. No toast or status message appears, and no Undo
control exists anywhere on the page. Focus moves to the document body.
