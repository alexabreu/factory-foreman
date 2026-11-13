# Slice 2: Search the list

Criteria owned by this slice:

- AC-1: WHEN the person opens the app with `?q=dune`, THE list SHALL show only books whose title contains "dune",
  and a heading "Results for dune".
- AC-2: WHEN the person types in the search box, THE URL SHALL update to `?q=<text>` so the search can be shared.

The app is a static site served from a public origin; the list is kept in this browser's localStorage.
