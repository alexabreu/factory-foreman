# Brief: Slice 2, rename `Item.read` to `Item.finished`

Design entry: rename the field everywhere so the code matches the product's wording. Files: every file that reads or
writes `read` on an item. Budget: 400 changed lines.

Criteria owned by this slice:

- AC-1: WHEN the code is built, NO file SHALL refer to `item.read`.
- AC-2: WHEN the person loads a list saved before this change, THE list SHALL show the same books as finished.

`git grep -n "\.read\b" src e2e` finds 31 call sites across 14 files. Loading old saved lists needs a migration of
the stored JSON plus its tests. A dry run of the rename and the migration, counted with `git diff --stat`, came to
712 changed lines.
