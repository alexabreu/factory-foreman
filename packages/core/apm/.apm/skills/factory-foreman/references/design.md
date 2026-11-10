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

## Wireframes
Low-fidelity wireframes, rendered at 3f2a1c9.

### AC-1
![AC-1 normal, sha256:9c1e…](https://github.com/<owner>/<repo>/blob/<commit>/design/AC-1.png?raw=true)
````

- **Contracts** name what tests will rely on: the test ids an element carries,
  the functions and files involved. Each is a JSON block with `name` and
  `testIds`. Tests are written later against these names only, so a name here is
  a promise.
- **Visual behaviors** say in words what a reviewer should see for each visual
  AC. No selectors: those come from the contracts.
- **Wireframes** show each visual AC before any code is written. Don't write
  this section by hand: `factory-foreman wireframes design` writes it (below).
- **Slices** are numbered from 1. Each owns at least one AC, and every AC in the
  approved Shape is owned by exactly one slice. List the files a slice owns
  where you know them; a slice stays reviewable in one sitting.

## Wireframes

When the approved Shape has a visual criterion, draw one wireframe per visual AC
before the review:

1. Read the existing component or page the AC changes first, and take its real
   layout: the regions, their order, the controls already there. A wireframe of
   a layout the product doesn't have is wrong however clean it looks.
2. Write `AC-<n>.html` in the issue's state folder, at
   `.factory-foreman/<n>/wireframes/` (`factory-foreman draft design` names
   it): a small, self-contained,
   low-fidelity page. Grey boxes and plain text, inline styles only, nothing
   loaded from elsewhere (no links, scripts, fonts or images from other hosts),
   at a desktop width of about 960 px. Every control carries its real label,
   matching the accessible names in the contracts.
3. Where the AC has an edge state (empty, error, loading, long content, a
   disabled control), add `AC-<n>-<state>.html` showing it, for example
   `AC-1-empty.html`.
4. Keep each page short (a screenful) and show only what the AC needs.
5. Run `factory-foreman wireframes design`. It renders each page to PNG with
   agent-browser, commits the pages and images to the assets-only branch
   `factory-foreman-assets/<n>` without touching the checkout, pushes it, and
   writes the draft's Wireframes section with each image pinned to that commit.
   Run it again after changing a page. It never writes to the repo's `.git`,
   and it pushes, so it needs network access. In Codex it checks the pages,
   then refuses, because Chrome can't start in Codex's sandbox: ask the person
   to run the command it gives in their own terminal, don't edit the draft
   meanwhile, then re-read the draft it updated and carry on.

## Reviews and amendments

The repo's Design reviewers (by default `software-architect`, `ux-designer` when the approved Shape has a visual criterion, and a second opinion through the configured command) check fit with the codebase, contracts, slice ownership and what a person will see; `ux-designer` opens the wireframe images. After approval, changing a contract, a visual behavior, a wireframe image, or which criteria or files a slice owns is a material amendment that needs approval again; rewording the approach or a slice's title is minor.
