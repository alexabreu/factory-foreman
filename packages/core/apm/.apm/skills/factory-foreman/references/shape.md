# Writing a Shape

A Shape says what the feature must do and for whom, and nothing about how.
Budget: a lead of at most 100 words and 1800 words in all, unless the repo's
config says otherwise.

```markdown
One paragraph: the problem and the outcome a person will notice.

## Problem
What goes wrong today, and for whom. Evidence if there is any.

## Who it's for
The people affected, and what they're trying to get done.

## Out of scope
What this feature won't do, so nobody builds it by accident.

## Acceptance criteria
| ID | Criterion | Visual |
| --- | --- | --- |
| AC-1 | A book can be marked read | yes |
| AC-2 | The list can show only unread books | no |
```

Each criterion:
- is one observable behavior that a test can pass or fail;
- says what happens, not how it's built (no components, files or APIs);
- is numbered AC-1, AC-2… and keeps its number for the life of the issue;
- is marked visual when a reviewer should see it, which means Design must say
  what they'll see.

Cut a criterion rather than make it vague. If the person hasn't decided
something a criterion depends on, note it as a blocking question instead of
guessing.

## Reviews and amendments

The repo's Shape reviewers (by default `test-verification-engineer`) read every criterion for whether a test could pass or fail it. Expect findings on vague or compound criteria, missing edge cases, and implementation detail; settle each before saving the review. After approval, rewording a criterion's text, adding or removing one, or changing its visual flag is a material amendment that needs approval again; rewording the lead or other sections is minor.
