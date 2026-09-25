# Review Text

"Review text" proofreads text you have already written, in the editor you are
using, with the same local grammar rules that correct you while typing. It runs
entirely in the page: no text leaves the browser, nothing is logged or stored,
and it needs no extra permissions.

![Starting a review: categorized highlights and the panel; nothing in the text changed](images/review-mode/1-review-started.png)

## Using it

Put the cursor in a text field, then either:

- press **Alt+Shift+R** (the suggested shortcut; change it in the browser's
  extension shortcut settings), or
- open the FluentTyper popup and choose **Review text**.

What gets reviewed:

- A selection wholly inside one editor: **that selection** ("Selection" in the panel).
- Otherwise: **the whole focused editor** ("Whole field"). Review never scans the page.
- A selection that crosses editors, a password, payment, security-code or
  one-time-code field (by type, `autocomplete` token, name or masking), and
  hidden, unrendered, read-only or disabled fields are refused with an
  explanation.
- In a modal dialog the review opens inside the dialog, so it stays usable.

Starting a review changes nothing: not the text, formatting, selection,
settings or learning data. While a review is open, typing-time corrections
and suggestions pause for that editor, and resume when it closes.

### Highlights and the card

| Category                      | Color  | Line             | Badge |
| ----------------------------- | ------ | ---------------- | ----- |
| Spelling                      | red    | wavy underline   | `abc` |
| Grammar                       | amber  | double underline | `G`   |
| Punctuation and spacing       | blue   | dotted underline | `,.`  |
| Capitalization and typography | purple | dashed underline | `Aa`  |

Color is never the only signal: each category also has its own line style and
badge, and the card and list name the category in words. The underline colors
keep at least 3:1 contrast on light and dark pages alike, whatever the OS theme. In forced-colors
(high-contrast) mode the highlights use system colors with the same line styles.

Click a highlight, or choose a finding in the list, to open its card:
category, explanation, the change (original and replacement), any
alternatives, and **Apply**, **Ignore** and, for single-word spelling findings,
**Add "word" to dictionary** (the existing FluentTyper dictionary).

![The correction card](images/review-mode/2-correction-card.png)

The panel shows the scope, the count, per-category filters, previous and next,
close, and **Fix all safe (N)**. Fix all applies only the findings that are
visible under the current filters, whose rule is batch-approved, and whose fix
is proven not to conflict with another fix. Everything else stays for review
one by one. The line under the button says what Fix all covers.

| Ignore one finding                               | Fix all safe                                 | Native undo                            |
| ------------------------------------------------ | -------------------------------------------- | -------------------------------------- |
| ![Ignored](images/review-mode/4-ignored-one.png) | ![Fix all](images/review-mode/5-fix-all.png) | ![Undo](images/review-mode/6-undo.png) |

Note that `teh` inside the code span, the bold text and the link are untouched.

### Keyboard

- The panel takes focus when a review starts (except in Google Docs, which
  needs its own focus). **Tab** moves through the panel. Arrow keys move
  through the list. **Enter** or **Space** opens the card for a finding.
- **Escape** closes the card first, then the review. Focus returns to the editor.
- Pressing the shortcut again while the panel has focus keeps the review.
- In the editor, review never captures **Tab** or **Enter**.

### States

The panel names every state:

- **Loading:** "Checking…"
- **Results:** "Issues: N"
- **Nothing found:** "No issues found by the enabled checks"
- **All resolved:** "All found issues are resolved. Fixed: N."
- **Ignored:** "Ignored: N", and "All remaining issues are ignored." once nothing else is left
- **Paused:** while an IME composes ("Paused while you compose")
- **Stale selection:** after an edit at the selection's edge
- **Unsupported, review-only or sensitive editor:** says which
- **Partial coverage:** protected text skipped, the size limit, or rules
  skipped for the language
- **Fix outcomes:** a fix the editor refused, or one it only partly applied
- **Error:** "Review failed. Close it and try again." (a scan that fails never
  leaves "Checking…" on screen)
- **Planning:** "Fix all safe (…)" while dependent fixes in a very large,
  error-dense text are still being proven; Fix all waits for the proof

## Rules and categories

Review reuses the typing-time rules' own patterns, word lists and helpers.
Each catalog rule is classified in
[`reviewCatalog.ts`](../src/core/domain/grammar/review/reviewCatalog.ts), and
its `Record` type makes an unclassified new rule a compile error. Only rules
enabled in settings run (the "Disable all" switch disables all of them).
English rules are skipped for other languages, and the panel says so.

Supported:

| Rule                                   | Language | Default | Category    | Fix all                                                                                           |
| -------------------------------------- | -------- | ------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `capitalizeSentenceStart`              | all      | on      | typography  | yes                                                                                               |
| `capitalizeAfterLineBreak`             | all      | on      | typography  | individual only: line starts in poems, lists and hard-wrapped text are often lowercase on purpose |
| `englishPronounICapitalization`        | English  | on      | typography  | yes                                                                                               |
| `englishContractionNormalization`      | English  | on      | spelling    | yes                                                                                               |
| `englishTypoWhitelistCorrection`       | English  | on      | spelling    | yes                                                                                               |
| `englishModalOfCorrection`             | English  | on      | grammar     | yes                                                                                               |
| `englishYourWelcomeCorrection`         | English  | on      | grammar     | yes                                                                                               |
| `englishTheirThereBeVerb`              | English  | on      | grammar     | yes                                                                                               |
| `englishAlotCorrection`                | English  | on      | spelling    | yes                                                                                               |
| `englishPronounVerbWhitelistAgreement` | English  | on      | grammar     | yes                                                                                               |
| `englishArticleAnCorrection`           | English  | off     | grammar     | individual only: word-list heuristic; a letter or identifier can look like an article             |
| `englishOrdinalSuffix`                 | English  | off     | typography  | yes                                                                                               |
| `englishProperNounCapitalization`      | English  | on      | typography  | yes (months that need a date as evidence: individual only)                                        |
| `measurementUnitFormatting`            | all      | on      | punctuation | individual only: units in technical prose are meaning-sensitive                                   |
| `currencySpacing`                      | all      | on      | punctuation | yes                                                                                               |
| `commaPeriodSpacing`                   | all      | on      | punctuation | yes                                                                                               |
| `collapseRepeatedSpaces`               | all      | on      | punctuation | yes (alignment gaps are left alone)                                                               |
| `duplicatePunctuationCollapse`         | all      | off     | punctuation | yes                                                                                               |

Excluded (typing conveniences, not errors in finished text):

| Rule                                 | Why                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `doubleSpaceToPeriod`                | Typing shortcut: existing double spaces are not sentence ends.             |
| `technicalTokenCompaction`           | Ambiguous in finished text: "Chapter 3: 5 tips" is not a clock time.       |
| `mathOperatorSpacing`                | Typing-time style; existing operators are often code or notation.          |
| `slashContextSpacing`                | Spacing around an existing slash is style, not an error.                   |
| `openingBracketSpacing`              | Only spaces code-like `){`; not prose proofreading.                        |
| `closingBracketSpacing`              | Bracket spacing in finished text is often notation, Markdown or intervals. |
| `trimSpaceBeforeLineBreak`           | Invisible, and two trailing spaces are a Markdown line break.              |
| `ellipsisShortcut`, `emdashShortcut` | Typing shortcuts, not errors.                                              |
| `smartQuoteNormalization`            | Straight quotes in finished text may be code or deliberate.                |
| `frenchPunctuationSpacing`           | Typing-time convention; invisible no-break space changes.                  |
| `autoBracketClose`                   | Review never inserts closing brackets.                                     |

A finding whose fix depends on context another fix changes is batched only
when re-detection proves both still hold together. Otherwise both are left
for individual review. A fix that would create a new finding is never chained:
the new finding appears on the recheck.

## What is protected

Review never flags or edits:

- **Code:** `code`, `pre`, `kbd` and `samp` elements; Quill code blocks; code
  editors (CodeMirror, Monaco, Ace…); code mode (none of the supported rules
  is code-safe); and Markdown code: backtick spans, ` ``` ` and `~~~`
  fences, and indented blocks.
- **Technical tokens:** URLs, e-mail addresses, paths, @mentions, #hashtags,
  dotted names, and any token over 100 characters (hashes, base64, minified code).
- **Structure:** images, embeds and `contenteditable=false` islands (read as
  one object character); block and line breaks; collapsed whitespace runs; and
  zero-width cursor guards.

Protected text is masked for the detectors, so no pattern can join words
across it. The panel reports how much text was skipped.

Formatting-only changes, such as text turned into code, change the snapshot
signature and invalidate pending fixes.

## Editor support

| Editor                                                                                 | Highlights                                                            | Apply one                               | Fix all | Undo                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- | ------- | ---------------------------------------- |
| `<textarea>`, text `<input>`                                                           | overlay measured through a hidden mirror in FluentTyper's shadow root | yes                                     | yes     | one native undo step for the whole batch |
| `contenteditable`                                                                      | CSS Custom Highlights (overlay fallback, e.g. inside shadow DOM)      | yes                                     | yes     | one native undo step per fix             |
| Quill                                                                                  | CSS Custom Highlights                                                 | yes                                     | yes     | Quill history (a batch is one step)      |
| ProseMirror, Lexical, Slate, Draft.js, CKEditor 4/5, Trix, TinyMCE, Froala, Summernote | yes                                                                   | no: review-only, the panel explains     | no      | —                                        |
| Google Docs (existing bridge)                                                          | no; list and card only                                                | yes: one verified replacement at a time | no      | Docs history                             |
| Code editors, sensitive and ineligible fields                                          | refused with an explanation                                           | —                                       | —       | —                                        |

Highlights never change the page's editor DOM. CSS highlights are registered
under FluentTyper's own names (`fluenttyper-review-*`); the page's and other
extensions' highlights are never touched. Everything is removed on close, on
navigation or when FluentTyper is disabled. If the editor leaves the page, the
panel says it is no longer available and nothing stays painted; a scripted
change to a text field is noticed within a second.

### Writes

Before every write, review re-reads the editor and checks all of these:

- the target is the same element and still eligible;
- the text matches the snapshot the finding came from;
- the structure signature is unchanged;
- the scope still holds;
- the edit's original characters are still there;
- no IME composition is active.

Findings are located by offsets into that snapshot, never by searching for the text.

Writes go through the browser's native editing command, so native undo works.
After writing, review reads the editor back and reports anything that doesn't
match: a refusal, a partial write, or a result it could not verify. It never
retries blindly, and always rechecks afterwards. In a contenteditable, each edit
is verified in its own block, then the whole editor is read once at the end.
Long batches pause every 50 ms to keep the page responsive, and stop if the
text, focus or composition changed during a pause.

## Architecture

```
Domain       src/core/domain/grammar/review/
             types.ts            diagnostic contract (UTF-16, end-exclusive, one snapshot)
             reviewCatalog.ts    per-rule review metadata and coverage map
             reviewDetectors.ts  detectors built on the typing rules' exports
             reviewDiagnostics.ts prepare / chunk / scan / finalize; proof step
             bulkPlanner.ts      Fix-all planning: conflicts deferred, proofs in rounds
             textRanges.ts       edits, diffs, remapping, grapheme boundaries
             reviewMessages.ts   explanations and UI strings (9 languages)
Application  src/core/application/review/ReviewSession.ts
             lifecycle, debounced rechecks, ignores, apply / Fix all through a port
Adapters     src/adapters/chrome/content-script/review/
             ReviewTargets.ts, ContentEditableTextMap.ts, GoogleDocsReviewTarget.ts
             ReviewController.ts (listeners, painting, focus)
UI           ReviewUi.ts, reviewStyles.ts (shadow DOM, top-layer popover)
Background   CommandRouter (shortcut), MessageRouter (add to dictionary)
```

Nothing is created, observed or scanned until the first review. The review code
does ship in the content script, which grows by about 124 KB minified (43 KB
gzip) and is parsed in every frame; loading it as a separate chunk on first use
would need a `web_accessible_resources` manifest entry, left for a maintainer to
decide.

Limits: 50,000 characters per review (a larger scope is cut, and the panel
says so), scanned in chunks of about 4,000 characters that yield to the page.
Rechecks after edits are debounced by 400 ms and cancel stale work.

## Performance

These are measurements, not a budget. Environment: 4 vCPU Xeon (2.8 GHz),
headless Chrome for Testing 154 and Firefox 156 via Puppeteer, Bun 1.3.11.
The documents are deliberately dense: about one finding per 30 characters.

| Document                   | Findings | Chrome: results | Chrome: Fix all | Firefox: results | Firefox: Fix all |
| -------------------------- | -------- | --------------- | --------------- | ---------------- | ---------------- |
| textarea, 300 chars        | 12       | 40–60 ms        | 10–25 ms        | 130–150 ms       | 15–25 ms         |
| textarea, 10k              | 324      | 155–215 ms      | 75–95 ms        | 160–190 ms       | 40 ms            |
| textarea, 50k              | 1,616    | 410–575 ms      | 430–450 ms      | 490–500 ms       | 230–250 ms       |
| contenteditable, 434 chars | 14       | 35–40 ms        | 20–35 ms        | 95–105 ms        | 30–60 ms         |
| contenteditable, 10k       | 329      | 95–120 ms       | 245–295 ms      | 120–150 ms       | 1.1–1.6 s        |
| contenteditable, 50k       | 1,610    | 340–400 ms      | 1.9–2.3 s       | 315–345 ms       | 13.7 s           |

Detection alone (Bun, best of 5): 300 characters in 2 ms, 10k in 20–40 ms
and 50k in 95–150 ms. Planning Fix all for 1,352 findings takes 4 ms. No
single scan chunk takes longer than about 80 ms, even on adversarial input
(e.g. 50k of `2th`, `may 15` or `i dont`).

Known costs:

- The first paint of a 50k textarea includes one layout of the mirror
  (about 150 ms in Chrome).
- Firefox's native contenteditable editing costs about 5 ms per edit at 50k,
  so a very large contenteditable batch takes seconds. It pauses every 50 ms,
  so the page stays responsive.

## Limitations

- Findings are limited to the catalog rules above. Review is not a general
  grammar checker, and most rules are English-only.
- The review UI language follows the browser language (English, French,
  Croatian, Spanish, Greek, Swedish, German, Polish, Portuguese).
- Google Docs: no inline highlights and no Fix all (one verified replacement at a time).
- Model-backed editors are review-only: writing behind their document model is not safe.
- Contenteditable undo is one step per fix; textarea and Quill undo a batch in one step.
- Textarea highlights can be misplaced under an ancestor with CSS `zoom`.
- Chrome may turn a space next to an edit into a no-break space. Review
  accepts only that change next to the edit; any other difference is reported.
- An ignore belongs to one occurrence and is dropped when an edit (including
  an undo) spans the ignored text.
- Chains of more than 8 mutually dependent fixes are left for individual review.
- A lowercase "i" before "is" (and before "has" after words like "if" or
  "while") is left alone: it is usually a variable.
- A sentence that ends right after a contraction ("I don't. the end") is not
  seen as ended: the shared sentence rule reads "t." as an initial.
- "Add to dictionary" accepts one word (letters with inner apostrophes or
  hyphens) and only from a real click.

## Testing

```
bun run test                                  # unit: domain, session, adapters (jsdom), routing
bun run test:e2e / test:e2e:full              # Chrome; add -- --platform=firefox for Firefox
bun run test:e2e:docs                         # Google Docs fixture
bun run check:e2e:coverage                    # review_* behaviors in tests/e2e/coverage-matrix.json
E2E_EXTENSION_PATH=$PWD/build bun scripts/review-demo.ts   # demo and screenshots
```
