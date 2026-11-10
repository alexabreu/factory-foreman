# Writing a Design

A Design says how the approved Shape gets built, in slices small enough to
review. It refers to the Shape's AC ids and never changes them. Budget: a lead of
at most 100 words and 1900 words in all, unless the repo's config says otherwise.

````markdown
One paragraph: the approach.

## Approach
The structure of the change, the parts it touches, and why this way rather than
the alternatives the person rejected.

## Contracts
```contract
{ "name": "toggle read", "testIds": ["item-toggle"], "files": ["src/reading-list.ts"] }
```

## Visual behaviors
- AC-1: the row's checkbox shows checked, and the summary count drops by one.

## Slices
1. Toggle read (AC-1)
   files: src/reading-list.ts, src/main.ts
2. Filter to unread (AC-2)
````

- **Contracts** name what tests will rely on: the test ids an element carries,
  the functions and files involved. Each is a JSON block with `name` and
  `testIds`. Tests are written later against these names only, so a name here is
  a promise.
- **Visual behaviors** say in words what a reviewer should see for each visual
  AC. No selectors: those come from the contracts.
- **Slices** are numbered from 1. Each owns at least one AC, and every AC in the
  approved Shape is owned by exactly one slice. List the files a slice owns
  where you know them; a slice stays reviewable in one sitting.

## Reviews and amendments

The repo's Design reviewers (by default `software-architect`, `ux-designer` when the approved Shape has a visual criterion, and a second opinion through the configured command) check fit with the codebase, contracts, slice ownership and what a person will see. After approval, changing a contract, a visual behavior, or which criteria or files a slice owns is a material amendment that needs approval again; rewording the approach or a slice's title is minor.
