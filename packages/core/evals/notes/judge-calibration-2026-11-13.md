# Judge calibration, 13 Nov 2026: every disagreement

Claude judge (default model) on 177 stored replies from the public cases only (code-reviewer and test-verification-engineer: seeded-remove-undo, seeded-toggle-all, seeded-mock-and-tautology), 171 recall verdicts. Runner and cases 0a5249e; the quote fix is 3344185. Each row: the case and rubric line, which engine wrote the reply, who passed it, the judge's quote, an excerpt of the reply around it, and my verdict after reading it.

First pass: 143/171 agree (Claude-written 74/82, Codex-written 69/89); 21 judge-only passes, 7 regex-only. After the quote fix, re-checked from the stored quotes with no new judge calls: 150/171 (Claude-written 81/82, Codex-written 69/89), 21 judge-only passes, 0 regex-only.

## 1. code-reviewer/seeded-toggle-all (claude-written, run 2, v9-public-contract-claude)

- Line: Finds that deciding by the first book breaks AC-1 for a mixed list
- Passed by: regex only (first pass)
- Judge quote: "If the list is \"Emma\" (read) then \"Dune\" (unread), the first book is read, so `read` comes out false and both books turn unread, which breaks AC-1's intent."
- Reply excerpt: "on every book. AC-2 says to unread only when every book is already read, so a partly read list should become all read. If the list is \"Emma\" (read) then \"Dune\" (unread), the first book is read, so `read` comes out false and both books turn unread, which breaks AC-1's intent. The result changes with the order of the books. Fix: `const read = !list.items.every(item => item.read)"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 2. code-reviewer/seeded-toggle-all (claude-written, run 1, v9-public-contract-claude)

- Line: Finds that deciding by the first book breaks AC-1 for a mixed list
- Passed by: regex only (first pass)
- Judge quote: "If the list is \"Emma\" (read) then \"Dune\" (unread), marking all read sets both to unread, which is the opposite of what the person asked for."
- Reply excerpt: "ms[0].read`. AC-2 says books go unread only when *every* book is already read, but this code checks just the first one. If the list is \"Emma\" (read) then \"Dune\" (unread), marking all read sets both to unread, which is the opposite of what the person asked for. AC-1 passes only because \"Dune\" happens to be first. The comment on line 32 (\"if the first one is already read\") descri"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 3. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 2, v13-main-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "Both input books are unread"
- Reply excerpt: "\"where\": \"src/reading-list.test.ts:27\" }, { \"id\": \"missing-ac-assertion\", \"severity\": \"major\", \"text\": \"Both input books are unread, and length >= 0 passes for every array, including an unchanged list or an empty result. Mark Dune as read, leave Emma unread, and assert that the returned items contain exactly Emma. This must detect both retaining Dune and incorre"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 4. test-verification-engineer/seeded-mock-and-tautology (claude-written, run 2, v13-contract-tve-claude)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: regex only (first pass)
- Judge quote: "never marks \"Dune\" as read, so the list has no read books"
- Reply excerpt: "\", \"severity\": \"blocking\", \"text\": \"The setup doesn't match AC-1's example. `add(add(empty(), 'Dune'), 'Emma')` never marks \"Dune\" as read, so the list has no read books and an implementation that does nothing would give the right answer. Fix: build the list as `toggle(add(add(empty(), 'Dune'), 'Emma'), 1)`, the same way the summary test sets up a read book, then assert"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 5. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 2, r2-main-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "any array satisfies length >= 0"
- Reply excerpt: "}, { \"id\": \"missing-ac1-proof\", \"severity\": \"major\", \"text\": \"The fixture never marks Dune as read, and any array satisfies length >= 0. Even after removing the mock, this cannot detect a broken AC-1. Mark Dune read, leave Emma unread, and assert that the returned items contain exactly the original Emma item.\", \"where\": \"src/reading-list.test.ts:30\" } ]"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 6. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, v13-main-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "Every array has a nonnegative length"
- Reply excerpt: "\"where\": \"src/reading-list.test.ts:28\" }, { \"id\": \"vacuous-assertion\", \"severity\": \"major\", \"text\": \"Every array has a nonnegative length, so this assertion accepts an unchanged list, an empty list, or the wrong surviving book. Assert that the returned items contain exactly the unread Emma item; verify the test fails for implementations that return the input"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 7. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, v13-main-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "Both added books are unread, so the fixture does not exercise AC-1's read-book removal."
- Reply excerpt: "\"where\": \"src/reading-list.test.ts:27\" }, { \"id\": \"incorrect-fixture\", \"severity\": \"major\", \"text\": \"Both added books are unread, so the fixture does not exercise AC-1's read-book removal. Toggle Dune to read before calling clearRead, leaving Emma unread.\", \"where\": \"src/reading-list.test.ts:28\" }, { \"id\": \"vacuous-assertion\", \"severity\": \"maj"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 8. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 3, v13-main-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "An array's length is always nonnegative, so this assertion cannot detect incorrect results."
- Reply excerpt: "\": \"src/reading-list.test.ts:27\" }, { \"id\": \"missing-behavior-assertion\", \"severity\": \"major\", \"text\": \"An array's length is always nonnegative, so this assertion cannot detect incorrect results. The fixture also never marks Dune as read. Mark Dune read, leave Emma unread, and assert that the returned items contain exactly Emma; this must fail if Dune remains or"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 9. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, v13-contract-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "the only result assertion accepts every array length"
- Reply excerpt: "r\", \"text\": \"AC-1 requires read Dune to disappear and unread Emma to remain, but the fixture leaves both unread and the only result assertion accepts every array length. An in-memory `node --input-type=module -e` check confirmed `no-op: current result assertion PASSES` and `remove-all: current result assertion PASSES`. Mark Dune read with toggle(input, 1), call the real cle"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 10. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, v13-contract-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "the fixture leaves both unread"
- Reply excerpt: "1-assertion\", \"severity\": \"major\", \"text\": \"AC-1 requires read Dune to disappear and unread Emma to remain, but the fixture leaves both unread and the only result assertion accepts every array length. An in-memory `node --input-type=module -e` check confirmed `no-op: current result assertion PASSES` and `remove-all: current result assertion PASSES`. Mark Dune read with"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 11. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 2, v13-contract-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "AC-1's only result assertion accepts every array length"
- Reply excerpt: "\"where\": \"src/reading-list.test.ts:27\" }, { \"id\": \"vacuous-result-check\", \"severity\": \"major\", \"text\": \"AC-1's only result assertion accepts every array length, so retaining Dune or deleting Emma would go undetected even after removing the mock. Evidence: `node -e 'for (const items of [[],[\"Dune\",\"Emma\"]]) console.log(JSON.stringify(items), items.length >= 0)'`"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 12. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 3, v13-contract-tve-codex)

- Line: Finds that toBeGreaterThanOrEqual(0) can never fail
- Passed by: judge only
- Judge quote: "the only result assertion accepts every array length, including zero"
- Reply excerpt: "r\", \"text\": \"AC-1 requires read Dune to disappear and unread Emma to remain. The fixture never marks Dune read, and the only result assertion accepts every array length, including zero. Even after removing the mock, clearing nothing or deleting every book would pass. Mark Dune read with toggle, then assert the returned titles equal exactly ['Emma']. Evidence: `cat evals/cas"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 13. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, r2-contract-tve-codex)

- Line: Finds that the test mocks clearRead, the function it is meant to test
- Passed by: judge only
- Judge quote: "the test replaces it with a canned result and then checks that its own call occurred"
- Reply excerpt: "[ { \"id\": \"mocked-subject\", \"severity\": \"major\", \"text\": \"AC-1 never exercises clearRead: the test replaces it with a canned result and then checks that its own call occurred. A no-op or throwing implementation would remain undetected. Evidence: `nl -ba evals/cases/test-verification-engineer/seeded-mock-and-tautology/files/pr.diff` shows `mockRetur"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 14. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, r2-contract-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "The fixture leaves both unread"
- Reply excerpt: "\"missing-outcome\", \"severity\": \"major\", \"text\": \"AC-1 requires Dune read, Emma unread, and only Emma remaining. The fixture leaves both unread, while `length >= 0` cannot fail for any valid array. Thus retaining Dune or deleting every book passes this assertion. Evidence: the read-only `node --input-type=module -e` fixture/assertion probe reported both books with `read:"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 15. test-verification-engineer/seeded-mock-and-tautology (claude-written, run 1, v13-main-tve-claude)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: regex only (first pass)
- Judge quote: "The input `add(add(empty(), 'Dune'), 'Emma')` never marks \"Dune\" as read"
- Reply excerpt: ": \"src/reading-list.test.ts:30\" }, { \"id\": \"fixture-has-no-read-book\", \"severity\": \"blocking\", \"text\": \"The input `add(add(empty(), 'Dune'), 'Emma')` never marks \"Dune\" as read, so it doesn't match AC-1's setup of Dune (read) and Emma (unread). With no read book in the list, a `clearRead` that does nothing gives the same result as a correct one. Fix: build the i"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 16. test-verification-engineer/seeded-mock-and-tautology (claude-written, run 2, r2-contract-tve-claude)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "`add(add(empty(), 'Dune'), 'Emma')` adds both books as unread"
- Reply excerpt: "id\": \"ac1-fixture-has-no-read-book\", \"severity\": \"major\", \"text\": \"The input list doesn't match AC-1's example. `add(add(empty(), 'Dune'), 'Emma')` adds both books as unread, so even a real `clearRead` call here would remove nothing. The test would never exercise the case where a read book is cleared. Fix: mark 'Dune' as read with `toggle(..., 1)` before calling `clearR"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 17. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 1, r2-main-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "Both books start unread"
- Reply excerpt: "\": \"src/reading-list.test.ts:27\" }, { \"id\": \"missing-behavior-assertion\", \"severity\": \"major\", \"text\": \"Both books start unread, and length >= 0 passes for every array, including an empty list or one still containing Dune. Mark Dune read, leave Emma unread, and assert that the returned items contain exactly Emma. This establishes AC-1's precondition and detects"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 18. test-verification-engineer/seeded-mock-and-tautology (codex-written, run 2, r2-contract-tve-codex)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: judge only
- Judge quote: "AC-1 requires Dune read and Emma unread, but both added books are unread."
- Reply excerpt: "\", \"where\": \"src/reading-list.test.ts:27\" }, { \"id\": \"wrong-fixture\", \"severity\": \"major\", \"text\": \"AC-1 requires Dune read and Emma unread, but both added books are unread. The read-only Node probe (`node --input-type=module -e …`) confirmed both have read:false and real clearRead retains both. Toggle Dune before clearing; otherwise this fixture cannot dete"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 19. test-verification-engineer/seeded-mock-and-tautology (claude-written, run 1, v13-contract-tve-claude)

- Line: Finds that no book in the test input is read, so AC-1 is never exercised
- Passed by: regex only (first pass)
- Judge quote: "The fixture is wrong too: it never marks \"Dune\" as read"
- Reply excerpt: "`toHaveBeenCalled()` only shows the test called the spy itself, and `items.length >= 0` is true even for an empty list. The fixture is wrong too: it never marks \"Dune\" as read, so it isn't the AC-1 example (\"Dune\" read, \"Emma\" unread). If `clearRead` returned `list` unchanged, returned `[]`, or dropped unread books instead of read ones, this test would still pass. It is also re"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 20. test-verification-engineer/seeded-remove-undo (codex-written, run 1, r2-main-tve-codex)

- Line: Notes the test does not cover a book added between remove and undo
- Passed by: judge only
- Judge quote: "AC-2 explicitly requires undo after another book is added, but this test immediately undoes removal."
- Reply excerpt: "here\": \"src/reading-list.test.ts:5\" }, { \"id\": \"missing-intervening-add\", \"severity\": \"major\", \"text\": \"AC-2 explicitly requires undo after another book is added, but this test immediately undoes removal. An implementation that restores an old snapshot and discards the added book would pass. Add Foundation to result.list before undoing, then assert the exact ord"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 21. test-verification-engineer/seeded-remove-undo (claude-written, run 3, r2-contract-tve-claude)

- Line: Notes the test does not cover a book added between remove and undo
- Passed by: regex only (first pass)
- Judge quote: "AC-2's clause \"even if a book was added in between\" has no test."
- Reply excerpt: "\"where\": \"src/reading-list.ts:42\" }, { \"id\": \"ac2-in-between-missing\", \"severity\": \"major\", \"text\": \"AC-2's clause \"even if a book was added in between\" has no test. The test calls `undo` straight after `remove`, so an `undo` that just restores an old snapshot of the list would pass. So would one that ignores books added since. Fix: add a test that removes Du"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 22. test-verification-engineer/seeded-remove-undo (claude-written, run 2, v11-public-contract-tve-claude)

- Line: Notes the test does not cover a book added between remove and undo
- Passed by: regex only (first pass)
- Judge quote: "AC-2 says the original order comes back \"even if a book was added in between\", and no test does that."
- Reply excerpt: ").toEqual(['Emma'])`.\",\"where\":\"src/reading-list.test.ts:3\"},{\"id\":\"ac2-add-between-missing\",\"severity\":\"major\",\"text\":\"AC-2 says the original order comes back \"even if a book was added in between\", and no test does that. The test calls undo straight after remove. An undo that just appends, or one that restores a saved copy of the whole list (which would lose the added book), p"
- My verdict: Both right. The judge passed it too, but my quote check failed on the reply's JSON-escaped quotation marks (fixed in 3344185; the quote is in the reply).

## 23. test-verification-engineer/seeded-toggle-all (codex-written, run 1, v13-contract-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "AC-1 asserts only the item count, so doing nothing passes."
- Reply excerpt: "[ { \"id\": \"ac1-no-state-proof\", \"severity\": \"major\", \"text\": \"AC-1 asserts only the item count, so doing nothing passes. The fixture also creates both books unread, whereas AC-1 requires Emma already read. An in-memory `node --input-type=module -e …` replay reported `identity mutant: AC-1: mark all read: PASS`. Initializ"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 24. test-verification-engineer/seeded-toggle-all (codex-written, run 3, r2-contract-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "the sole assertion checks only their count"
- Reply excerpt: "or\", \"text\": \"AC-1 requires Dune unread and Emma read to become both read. This setup creates two unread books, and the sole assertion checks only their count. An in-memory `node -e` probe executing the supplied test reported 'identity regression: supplied assertion PASS; input read=[false,false]; output read=[false,false]': doing nothing passes. Initialize Emma as read and"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 25. test-verification-engineer/seeded-toggle-all (codex-written, run 2, v11-public-main-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "the assertion checks only their count. A no-op implementation passes"
- Reply excerpt: "[ { \"id\": \"ac1-not-proven\", \"severity\": \"major\", \"text\": \"Both books start unread, and the assertion checks only their count. A no-op implementation passes, so this does not prove AC-1. Initialize Dune unread and Emma read, then assert that both named books are read after toggleAll.\", \"where\": \"src/reading-list.test.ts:4\" }, { \"id\":"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 26. test-verification-engineer/seeded-toggle-all (codex-written, run 3, r2-main-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "The assertion checks only the item count and passes even when toggleAll returns the input unchanged."
- Reply excerpt: "[ { \"id\": \"ac1-assertion\", \"severity\": \"major\", \"text\": \"The assertion checks only the item count and passes even when toggleAll returns the input unchanged. Assert that both Dune and Emma have read: true after the action.\", \"where\": \"src/reading-list.test.ts:5\" }, { \"id\": \"ac1-fixture\", \"severity\":"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 27. test-verification-engineer/seeded-toggle-all (codex-written, run 3, v13-main-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "The AC-1 test checks only item count, so a no-op toggleAll would pass."
- Reply excerpt: "[ { \"id\": \"ac1-unproven\", \"severity\": \"major\", \"text\": \"The AC-1 test checks only item count, so a no-op toggleAll would pass. It also never establishes the required mixed state. Start with Dune unread and Emma read, then assert that both books remain present and are read.\", \"where\": \"src/reading-list.test.ts:5"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.

## 28. test-verification-engineer/seeded-toggle-all (codex-written, run 1, r2-main-tve-codex)

- Line: Finds that the test asserts only the length, so it cannot fail for the criterion
- Passed by: judge only
- Judge quote: "asserts only the item count"
- Reply excerpt: "ac1-not-proven\", \"severity\": \"major\", \"text\": \"The AC-1 test never marks Emma read before calling toggleAll and asserts only the item count. It misses the required mixed-state input and would pass if toggleAll returned the list unchanged. Start with Dune unread and Emma read, then assert that both books are read.\", \"where\": \"src/reading-list.test.ts:4\" }, {"
- My verdict: Judge right: the reply makes the point in words the regex does not know, and the quote is in the reply verbatim.
