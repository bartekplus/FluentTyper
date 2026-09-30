# Review Text

"Review text" proofreads text you have already written, in the editor you are
using, with local grammar and spelling checks and optional style advice. It runs
entirely in the page: no text leaves the browser, nothing is logged or stored,
and it needs no extra permissions.

![Starting a review: categorized highlights and the panel; nothing in the text changed](images/review-mode/1-review-started.png)

## Using it

Put the cursor in a text field, then either:

- press **Alt+Shift+R** (the suggested shortcut; change it in the browser's
  extension shortcut settings),
- click the **Review** button in the corner of the text box you are writing in, or
- open the FluentTyper popup and choose **Review text**.

With several text boxes on a page, each of these reviews only the one you are
in (the one with the cursor); the others are never read or changed.
In Google Docs, use the shortcut or the popup; there is no Review button there.

![The Review button in the corner of the text box being written in](images/review-mode/8-review-button.png)

The **Review button** is one small button, drawn in FluentTyper's own layer,
so the page's layout and the field's padding are untouched:

- It appears only on the focused **multi-line** field (text areas and rich
  editors, not search boxes or other single-line inputs), once the field
  holds some text, and only where review can run (not in sensitive, locked,
  code or very small fields, not in Google Docs, not in code mode).
- It hides while you type, comes back when you pause, and steps aside while
  that field's review is open. Clicking it keeps your cursor and selection, so
  a selection is reviewed on its own, exactly as with the shortcut.
- One icon per field: where FluentTyper waits for the "enable here" icon
  (a field with the browser's own autocomplete), that icon shows instead.
- It is not a tab stop; keyboard users have the shortcut. Turn it off under
  **Settings → Grammar → Review text**.

What gets reviewed:

- A selection wholly inside one editor: **that selection** ("Selection" in the panel).
- Otherwise: **the whole focused editor** ("Whole field"). Review never scans the page.
- A selection that crosses editors, a password, payment, security-code or
  one-time-code field (by type, `autocomplete` token, name or masking), and
  hidden, unrendered, read-only or disabled fields are refused with an
  explanation.
- In a modal dialog the review opens inside the dialog, so it stays usable.

Starting a review changes nothing: not the text, formatting, selection,
settings or learning data. Suggestions and typing-time corrections keep
working while a review is open; the review rechecks once you pause typing.
They pause only while the review writes a fix. Escape closes an open
suggestion popup first, then the card, then the review. In Google Docs,
typing-time corrections and suggestions still pause for the whole review.

### Highlights and the card

| Category                      | Color  | Line             | Badge |
| ----------------------------- | ------ | ---------------- | ----- |
| Spelling                      | red    | wavy underline   | `abc` |
| Grammar                       | amber  | double underline | `G`   |
| Punctuation and spacing       | blue   | dotted underline | `,.`  |
| Capitalization and typography | purple | dashed underline | `Aa`  |
| Optional style advice         | teal   | dotted underline | `S`   |

Color is never the only signal: each category also has its own line style and
badge, and the card and list name the category in words. The underline colors
keep at least 3:1 contrast on light and dark pages alike, whatever the OS theme. In forced-colors
(high-contrast) mode the highlights use system colors with the same line styles.

The card header also names the kind of problem a native check finds, for
example **Grammar · Agreement** or **Punctuation and spacing · Spacing**. Kinds
are finer than categories and are only a label: filters, colors and Fix all
still follow the category. The kinds are typo, split or joined words,
agreement, word form, confused words, usage, capitalization, repetition,
spacing, numbers and units, punctuation marks, redundancy, readability and
terminology. Dictionary spelling and Local AI cards show only the category.

Click a highlight, or choose a finding in the list, to open its card:
category, explanation, the change (original and replacement), any
alternatives, and **Apply**, **Ignore once** and, for single-word spelling findings,
**Add "word" to dictionary** (the existing FluentTyper dictionary).

Native and dictionary cards also offer **Ignore matching occurrences in this review**. It suppresses current findings with the same rule, language, normalized evidence and suggested edits, including the protected context. It is deliberately more specific than ignoring every use of a word. The visible hint explains that new occurrences are not automatically ignored. AI findings retain Ignore once only.

**Restore ignored findings** in the footer resets both kinds of session ignores. Counts, filters, navigation and Fix all planning use the remaining findings. Matching ignores track their occurrence and evidence with the existing position remapper: edits before unchanged evidence can move them, while evidence edits, protection changes, deletion/reinsertion or ambiguous placement release suppression. Close and reopen Review to clear every ignore. Another editor has its own session. No dictionary learning, setting changes, sentence hashes or reviewed prose are saved by either ignore action. **Disable this check in Review** remains a separate persistent preference.

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
- **Escape** closes an open Local AI preview first, then the card, then the review. Focus returns to the editor.
- Pressing the shortcut again while the panel has focus keeps the review.
- In the editor, review never captures **Tab** or **Enter**.

### States

The panel names every state:

- **Loading:** "Checking…"
- **Results:** "Issues: N"
- **Nothing found:** "No issues found by the review checks"
- **Code mode:** "No review checks run in code mode."
- **All resolved:** "All found issues are resolved. Fixed: N."
- **Ignored:** "Ignored: N", and "All remaining issues are ignored." once nothing else is left
- **Paused:** while an IME composes ("Paused while you compose")
- **Stale selection:** after an edit at the selection's edge
- **Unsupported, review-only or sensitive editor:** says which
- **Partial coverage:** protected text skipped, the size limit, rules
  skipped for the language, or (Google Docs, past 50,000 characters) text outside
  the window around the cursor, with the scope shown as "Part of the document"
- **Fix outcomes:** a fix the editor refused, or one it only partly applied
- **Error:** "Review failed. Close it and try again." (a scan that fails never
  leaves "Checking…" on screen)
- **Planning:** "Fix all safe (…)" while dependent fixes in a very large,
  error-dense text are still being proven; Fix all waits for the proof

## Rules and categories

Review reuses the typing-time rules' own patterns, word lists and helpers.
Each catalog rule is classified in
[`reviewCatalog.ts`](../src/core/domain/grammar/review/reviewCatalog.ts), and
its `Record` type makes an unclassified new rule a compile error: every
supported rule names its category and kind, and every excluded typing rule its
category. Native Review checks have independent switches in
**Settings → Grammar → Review text**. They are listed under the Review
categories, each card badged with its kind, "Off by default" for optional
checks and "English only" where that applies. Typing switches are listed under
the same categories.
Core checks default on. The two optional style checks default off; restoring defaults
keeps them off. Typing switches still control only automatic corrections.
A native finding's **Disable this check in Review** action saves that rule's choice
and refreshes open reviews. Restore it in settings, individually or with **Restore defaults**.
Disabling every native check leaves dictionary spelling and separately configured Local AI available.
Code mode disables Review checks.

Only supported native rule IDs and boolean choices are stored. Missing choices
inherit explicit catalog defaults; malformed known choices are disabled and unknown
IDs are discarded. Existing typing preferences are never migrated into Review choices.
No reviewed text is stored by these controls.
Each rule runs only in the languages it supports, and the panel says how many enabled
rules were skipped for the language. Some English rules have Review-only tables for
other languages (doubled comparatives, merged words, French elisions, German day and
month capitals); those findings are always individual-only. The full rule × language
matrix, with the reason for every unsupported cell, is in
[review-language-matrix.md](review-language-matrix.md). With the language
set to auto-detect, Review first identifies the text's language on the device (the
browser's own detector) and uses the matching enabled language, or the fallback language.

Supported (**Typing** is the rule's default for typing; Review has separate switches):

| Rule                                   | Language | Typing      | Category    | Kind               | Fix all                                                                                           |
| -------------------------------------- | -------- | ----------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `englishExistentialAgreement`          | English  | unavailable | grammar     | agreement          | individual only                                                                                   |
| `englishThenThan`                      | English  | unavailable | grammar     | confused words     | individual only                                                                                   |
| `englishYourYouAre`                    | English  | unavailable | grammar     | confused words     | individual only                                                                                   |
| `englishTheirThereTheyAre`             | English  | unavailable | grammar     | confused words     | individual only                                                                                   |
| `englishToToo`                         | English  | unavailable | grammar     | confused words     | individual only                                                                                   |
| `englishAuxiliaryBaseVerb`             | English  | unavailable | grammar     | word form          | individual only                                                                                   |
| `englishRepeatedWords`                 | all      | unavailable | grammar     | repetition         | individual only                                                                                   |
| `capitalizeSentenceStart`              | all      | on          | typography  | capitalization     | yes (after a quote or bracket closing a period: individual only)                                  |
| `capitalizeAfterLineBreak`             | all      | on          | typography  | capitalization     | individual only: line starts in poems, lists and hard-wrapped text are often lowercase on purpose |
| `englishPronounICapitalization`        | English  | on          | typography  | capitalization     | yes                                                                                               |
| `englishContractionNormalization`      | en, fr   | on          | spelling    | typo               | English yes; French elisions individual only                                                      |
| `englishTypoWhitelistCorrection`       | English  | on          | spelling    | typo               | yes                                                                                               |
| `englishModalOfCorrection`             | English  | on          | grammar     | confused words     | yes                                                                                               |
| `englishYourWelcomeCorrection`         | English  | on          | grammar     | confused words     | yes                                                                                               |
| `englishTheirThereBeVerb`              | English  | on          | grammar     | confused words     | yes                                                                                               |
| `englishAlotCorrection`                | 8 langs  | on          | spelling    | split/joined words | English yes; other languages' merged words individual only                                        |
| `englishPronounVerbWhitelistAgreement` | English  | on          | grammar     | agreement          | original pairs only; expanded forms and contextual "you was" are individual only                  |
| `englishArticleAnCorrection`           | English  | off         | grammar     | agreement          | individual only: word-list heuristic; a letter or identifier can look like an article             |
| `englishOrdinalSuffix`                 | English  | off         | typography  | numbers and units  | yes                                                                                               |
| `englishProperNounCapitalization`      | en, de   | on          | typography  | capitalization     | English yes (German nouns individual only; months that need a date as evidence: individual only)  |
| `measurementUnitFormatting`            | all      | on          | punctuation | numbers and units  | individual only: units in technical prose are meaning-sensitive                                   |
| `currencySpacing`                      | all      | on          | punctuation | numbers and units  | yes                                                                                               |
| `commaPeriodSpacing`                   | all      | on          | punctuation | spacing            | yes (Greek `;`, Arabic `؟ ؛` and Spanish `¿ ¡` padding: individual only)                          |
| `collapseRepeatedSpaces`               | all      | on          | punctuation | spacing            | yes (alignment gaps and Markdown table padding are left alone)                                    |
| `duplicatePunctuationCollapse`         | all      | off         | punctuation | repetition         | yes                                                                                               |

Agreement retains the six original typing pairs and their existing bulk rules.
`englishContextualCompounds` is a separate Review-only check for curated compound pairs. It splits everyday into every day after a complete listed pronoun-led action, and splits login/setup into log in/set up in explicit modal, infinitive or please-imperative slots with complete listed complements. New spaces use the existing grapheme-anchored editor transaction; unrelated formatting remains intact. Findings own their spans before dictionary spelling runs, so the same token does not receive redundant spelling cards. Presage candidates and ranking are unchanged.

Noun/adjective uses such as everyday tasks, the login and the setup are preserved. This check does not join two-word noun spellings or impose a login/log-in or setup/set-up house style. Unknown compounds, incomplete contexts, command arguments, URL components, mixed-case identifiers, capitalized product-name candidates and user-dictionary words abstain. The listed lowercase tokens, including aswell after tested/checked/reviewed, are split; every finding remains individual-only and typing is unchanged.

The established-usage check covers for all intensive purposes before a known completion clause, one in the same in explicit plural identity clauses, and peak/peaks/peaked/peaking someone’s interest with known subjects, modals and progressive auxiliaries. It also recognizes bounded indirect-question, pronoun-case, lexical-confusion and malformed finded constructions; meaning-ambiguous effect/affect uses abstain. Case, tense, possessive determiners and surrounding whitespace are preserved. The phrase-matching loop is shared with fixed prepositions; there is no general search/replace engine or external phrase database.

Literal peak meanings and locative one in the same room, unrecognized frames, recognized creative/dialect cues, named quotations, technical tokens, dictionaries and protected text abstain. These are grammar-category cards with usage-specific explanations, independently configurable and individual-only. Native spelling-span ownership prevents duplicate spelling cards. Typing and existing modal-of corrections are unchanged.

The doubled-degree check removes redundant more/most only in complete this/that/it or known-noun clauses with is/was. It uses the same ten explicit comparative words as then/than, plus easier/simpler, and eleven explicit superlatives. Supported tails are bounded to known to-infinitives, known comparison targets, ungrouped integer targets, or a complete sentence ending; superlatives require a known noun. Numerical values and comparison targets are preserved. A then/than error can become detectable after removing the redundant degree marker; the normal snapshot recheck supplies fresh offsets and invalidates the previous card.

Quantity phrases, hyphenated noun modifiers, heading fragments, quoted examples, unknown degree forms, capitalized names and mixed-case identifiers abstain. Valid multiword adjectives, very unique, far better and repeated emphatic better and better are untouched. No suffix inference, style enforcement, typing correction or Fix all eligibility is added. The rule can be disabled independently in Review settings.

The native countability check covers ordinary-prose malformed plurals of information, advice and equipment in bounded complete frames: a page/guide/report/document contains/provides/includes useful information; thanks/appreciation for helpful advice; and we/they/you need/use/bought/ordered/checked/tested specified equipment. Small adjective lists supply context. It also repairs criterion/criteria and phenomenon/phenomena after explicit one–ten or single-digit counts, preserving the count exactly. These special noun pairs stay within the individually suppressible countability family rather than expanding the shared general noun-number rule.

Specialist legal, banking, commercial, regional and archaic evidence in the bounded context causes abstention. Quoted examples, identifiers, capitalized names and dictionary words are protected. Known quantified feedback/information/advice and a information frames can show a warning without an edit; other quantified mass-noun constructions abstain. No unit, amount or partial determiner repair is invented. Data agreement, fewer/less preferences, coffee, experience, work and paper are outside this check. All findings are individual-only; typing is unchanged.

`englishNounNumber` is a separate native Review-only check using the shared authored noun-pair map (now including device/devices). It handles complete `one of the` clauses, explicit counts zero–ten or up to four ungrouped digits, and these/those followed by a known singular noun and a supported predicate. Explicit counts retain their value and change only noun inflection; `one of the` pluralizes the set noun while leaving its outer singular subject and verb untouched.

For these/those, a following are/were establishes plural and is/was establishes singular. Past predicates such as failed/arrived/returned do not establish number: the existing choice-card UI offers either pluralizing the noun or changing the demonstrative to this/that, with nothing preselected. All findings remain individual-only. Complete bounded predicates/locations prevent noun-modifier edits such as `those file names`. Unknown/invariant nouns, data/news/series, units, ordinal tokens, grouped/decimal/fractional numbers, technical model labels and hyphenated measurements abstain. Quantity repair can make a separate existential-agreement finding available on the next scan; it never changes the number to fit the verb.

`englishPerfectParticiples` is a separate Review-only check for pronoun + have/has/had followed by a known simple-past form where the shared verb table specifies a different participle. Thirteen listed verb/argument frames supply complete grammatical evidence. It changes only that verb. Up to two listed adverbs (including not), negative auxiliaries and unambiguous `'ve`/`’ve` contractions are supported. Wrong have/has agreement is left to the existing agreement check, with the participle reconsidered on the next scan.

Possessive and causative have, noun uses such as `have saw blades`, shared past/participle forms (read/cut/set), unlisted morphology, unknown complements and ambiguous `'s`/`'d` contractions abstain. Regional learned/learnt, burned/burnt, got/gotten and other unlisted forms remain untouched. Existing auxiliary, spelling and typing behavior is unchanged; findings stay individual-only.

`englishVerbComplements` is a separate Review-only check for complete pronoun-led complement frames. It inserts `to` after audited need/want/plan forms before a known base verb with a listed argument; after `look forward to` (including inflected and progressive forms), it replaces that verb with an explicitly stored gerund. Fourteen lexical argument frames cover fix a specified bug, deploy today/tomorrow, meet a person, make the change, take a break, write the report, run the tests, come/go home, see the results, learn a listed language, visit the office, read the file and send the message. Optional do-not/don't negation is preserved, as is not before progressive looking. Contractions accept straight or curly apostrophes.

Additional bounded frames cover enjoy/avoid, decide, suggest, make/let and help. Gerund content clauses after decide and restrictive participles after allows remain protected.

These checks abstain on subjectless fragments/headings, incomplete or unknown arguments, noun readings such as `need work` and `need input data`, existing infinitives/gerunds, `need not`, and optional/forbidden-to frames such as `help fix`, `let me know` and `make it work`. They do not infer gerunds by adding a suffix. Missing `to` uses the existing one-grapheme insertion anchor, retaining the following verb's formatting; no adapter bypass is used. Malformed auxiliary forms remain owned by the auxiliary checker. Every finding is individual-only; typing behavior is unchanged.

`englishFixedPrepositions` checks established constructions in bounded contexts. It removes `of` plus its following horizontal separator after `despite` before a complete listed noun phrase; removes `about` plus its separator after pronoun-led `discuss/discussed/discusses` or be + `discussing`, or `please discuss`, before a complete listed topic; and changes `on` to `in` in pronoun + be + `interested on` before a listed activity/topic. Additional frames cover responsible for, duration for/since, arrive at, wait for and investigate, with known predicates and objects. Complete phrase evidence and punctuation/end boundaries are required. Known adjectives are bounded; multiline and protected evidence abstain.

This is not a global preposition replacement. Approximate quantities (`discussed about five issues`), embedded questions (`discussed what the book was about`), noun uses (`discussion about`), temporal/location attachments (`interested on Monday`, `interested on screen`), incomplete complements and unlisted objects remain untouched. Existing correct `in spite of`, `talked/asked about`, `interested in` and `depends on` are preserved. Findings stay individual-only and do not alter typing.

Three native Review-only contextual apostrophe checks are independently configurable:

- `englishItsContext`: possessive `its` after a listed transitive verb and before a complete known noun phrase, or in a clause-opening noun phrase with a supported predicate. Conversely, clause-opening `its` before listed complete predicates such as `ready to use`, `cold outside`, `working now` or `been fixed` becomes `it's`.
- `englishLetsContext`: clause-opening `lets` before a complete listed suggestion such as `try again`, `go home` or `take a break` becomes `let's`. Lexical `lets` with a subject is preserved.
- `englishElsePossessive`: `elses` after someone/somebody/anyone/anybody/everyone/nobody/no one and before a complete known noun phrase becomes `else's`. Capitalized `Elses` is preserved as a possible name.

All three change only the target token, remain outside Fix all safe, and leave existing contraction normalization and typing untouched. Existing straight or curly apostrophes are accepted for possessive `it's`; new apostrophes follow the existing normalizer's straight-apostrophe convention. No global quote normalization occurs. Evidence uses bounded horizontal spacing, listed nouns/adjectives/predicates and a phrase boundary. Unknown noun phrases, unlisted predicates, arbitrary names, singular/plural owners, multiline evidence and technical tokens abstain. Named quoted examples are protected; supported ordinary nested quotations remain eligible. These are bounded recognizers, not general ownership inference.

Additional Review-only constructions run under `englishPronounVerbWhitelistAgreement`:
clause-opening we/they/you with is/am/was/has/does, and he/she/it with are/am/were/have/do.
One listed adverb (really, still, also, always, never) may intervene. These new forms
change only the finite verb, retain negation, and are individual-only. Object
pronouns, coordinated subjects, subjunctives after a preceding clause, named quoted
examples, technical/mixed-case identifiers and unfinished phrases abstain.

The independent `englishExistentialAgreement` check recognizes clause-opening
There is/are/was/were + optional not/still/also + an explicit quantity, many/several or a lot of + a known countable noun,
optionally with one listed adjective and a simple location phrase. Quantity and
noun number must agree before the verb can be repaired. Its 15 authored noun pairs
include child/children, person/people and mouse/mice; no noun suffix guessing is used.
Known plural phrases may continue with that/which/with. Unknown, collective and
invariant-number nouns, coordinated subjects, singular relative clauses, hard-wrapped
continuations and contradictory quantity/noun combinations abstain. The quantity, noun, adjective and negation are never rewritten.

Contextual word confusions have four independent Review-only identities:

- `englishThenThan`: a copula, a listed comparative and a complete comparison
  argument (a known noun phrase or object pronoun). Temporal "then", unknown noun
  phrases and following finite clauses abstain.
- `englishYourYouAre`: clause-opening "your going to" with a listed verb and
  object, or an object-taking verb followed by "you're own" and a known noun.
  Possessive gerunds ("your going away", "I dislike your going…") abstain.
- `englishTheirThereTheyAre`: the same bounded future construction for
  "their/there going to", and "there/they're own" in a complete object noun phrase.
- `englishToToo`: copular "to + listed adjective + to + listed verb". Ambiguous
  adjectives that are also verbs ("fast", "slow", "light") are not included.

These checks replace only the confused word and record the surrounding evidence.
They do not depend on dictionary misspellings. Existing "your welcome" and
"their is" checks retain sole ownership. Named quoted examples, technical glue,
protected islands and newline-spanning constructions are excluded. These finite
lists provide bounded coverage, not a general homophone or English parser.

Auxiliary verb forms are Review-only. A small authored table covers 24 common
verbs, with no suffix guessing. Pronoun-led clauses and inverted pronoun questions
support do/does/did, modals, straight/curly negative contractions, and up to two
listed intervening adverbs. The auxiliary, subject and negation are preserved.
Independent base homographs (`read`, `cut`, `set`, `saw`, `found`), noun readings
such as "do works"/"do runs", unknown forms, mixed-case identifiers, protected text,
and directly named quoted examples are left alone. Clause-internal subordinate
syntax ("What I did works"), noun subjects and newline-spanning phrases are outside
this initial scope. Existing modal-of and agreement checks retain their ownership.

Repeated words are Review-only: a bounded per-language allowlist (English `the`, `a`, `an`, `is`,
`are`, `was`, `were`, `in`, `on`, `at`, `for`, `with`, `from`, `of`, `to`; plus short lists of
articles and prepositions for every other supported language) separated by
1–8 spaces, tabs or no-break spaces. The first word keeps its casing; one
suggestion deletes one duplicate and its separator. Longer runs recheck after
each repair. Newlines, hyphens, protected islands, dictionary words and directly
named quoted examples are excluded. This intentionally misses arbitrary repeated
words and distant metalinguistic context; it is not a general repetition parser.
Words that legitimately double are never listed: German `die die`/`das das`, French
`nous nous`/`vous vous`, Spanish and Portuguese `para para`, Croatian `je je`, Greek
`με με`, Polish `to to`. An unresolved auto-detect language runs no list.
Normal quoted prose remains eligible. No typing rule or automatic fix is installed.

Some text is left alone because it only looks like an error: "you" as an
object ("Everything I told you was a lie"), a lowercase dialogue tag after a
quoted "!" or "?" ("“Stop!” she said"), a named mark ("press . to repeat",
"use the . key", "type '.' to repeat"), and a word joined to a hyphen after it
("--dont-ask", "dont-care"). A double hyphen is a dash ("I dont--really--care"
is fixed). After a hyphen ("x-teh"), where typing still corrects it, the fix is
individual only. So is "you was" after a verb that can open a clause ("I heard
you was sick", "I was hoping you was coming"), where "you" is usually the
subject.

Unlike typing, review sees the words after a word as well as before it, so it
decides some cases typing has to leave as typed. These are always individual
fixes (never in Fix all), because the deciding words are only evidence:

- **Months:** "in may.", "until march,", "last may,", "the end of august",
  "on 5 may." and "april or may" are the month. "It may rain", "they march",
  "an august institution" and "the last march" stay as written.
- **Contractions:** "cant", "wont" and "ill" before a bare verb: "I cant go",
  "It wont work", "ill be there". "The cant of the roof", "as is his wont" and
  "fell ill" stay.
- **"i" ending a sentence:** "taller than i." (typing cannot rule out "i.e.").
  A roman-numeral list marker ("i. First") or part ("Part i.") stays.

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

### Unknown words

Besides the rules, review checks each prose word against the language's
dictionary: the same local Presage engine (Hunspell and Aspell predictors) that
offers spelling corrections while you type. A word the dictionary does not know
("Where **wa** it?") is listed with Presage's single-word suggestions,
ranked for the words before it.

![Choosing a replacement for an unknown word](images/review-mode/7-spelling-choice.png)

- **Nothing is preselected and nothing is fixed automatically.** The card shows
  the word and one button per suggestion; one click (or Enter) on a suggestion
  replaces the word with it, as one native undo step. Arrow keys move between
  suggestions; **Ignore** and **Add to dictionary** work as for any finding.
- **Never in Fix all.** These findings count as left for individual review.
- **Presage's suggestions.** Review offers up to five single-word candidates in
  Presage's order, without an edit-distance cutoff. It skips words the dictionary
  knows and likely compounds whose split ranks ahead of every single-word choice
  ("changelog", "webhook"). Nothing is listed when no usable candidate remains.
- **Left out:** names (a capitalized word inside a sentence), acronyms and
  mixed case ("NASA", "iPhone"), words glued to digits, symbols or hyphens,
  anything touching code or protected text, words another rule already flags,
  and the user's dictionary.
- **When it runs:** after the rule results are shown ("Checking spelling…"
  while it runs), a few words at a time, with answers remembered for rechecks.
  Each different word is looked up once, and each request to the background
  engine stops after about 40 ms, so typing suggestions in other tabs never wait
  long. One pass checks at most 2,000 different words, and stops early once 100
  are unknown (text in another language, say); the panel then says spelling was
  checked only in the first part, and a recheck continues from there.
  It does not run in code mode, and it needs a Presage dictionary for the
  language; without one the panel says spelling suggestions are unavailable.
- **Local:** the words go from the page's content script to the extension's own
  background engine and back; nothing leaves the browser, nothing is stored or
  logged, and the engine does not learn from them.

A finding whose fix depends on context another fix changes is batched only
when re-detection proves both still hold together. Otherwise both are left
for individual review. A fix that would create a new finding is never chained:
the new finding appears on the recheck.

## Local AI (optional)

On Chrome and Edge, Review can also use a small language model that runs on your
device (WebGPU). It is off until you set it up, and basic Review works the same with or
without it. It never runs while you type: suggestions and autocomplete stay Presage-only.

**Setting it up.** The first review offers "Set up local AI…" once (with the download
size), or open **Settings → Grammar → Local AI**. There you choose **Recommended**
(Gemma 4 E4B, about 4.9 GB) or **Compact** (Qwen3 4B Instruct, about 2.9 GB, finds fewer
mistakes), see the download size, and press **Download and enable**, which asks you to
confirm first. The model files come from Hugging Face once, from a pinned revision, and each
file is checked against its known hash; the runtime that executes them ships inside the
extension. After that it works offline. The model occupies GPU memory only while a review
with Local AI is open; opening a review loads it from disk (a few seconds). **Delete model** frees the disk space; nothing is
downloaded again until you press Download. Turning the switch off keeps the model but
stops using it. On a browser or device that cannot run it (no WebGPU, no 16-bit float
shader support, Firefox), the settings say why and Review never asks again.

**Languages.** Local AI runs only for English reviews for now: that is what the models
were evaluated on. For another review language the panel says so once, and the rule and
dictionary checks work as always.

**Correct (the default).** When a review opens, the rule and dictionary results appear
first, as always. Then the model checks the scope in the background, up to two short
sentences per request with their neighbours as read-only context ("Checking context
locally…"), and adds
what it finds to the same list as it goes, tagged **Local AI**. It is asked to fix clear
errors (spelling, missing apostrophes, agreement, verb forms, articles, wrong words such
as "then/than", day and month capitals, double negatives) and to leave correct wording
alone: no polishing or rephrasing.

Gemma pairs contain at most 200 editable characters and keep separate IDs and ranges. Larger
pairs are sent as two individual requests without regrouping their neighbours; a lone
sentence retains its 400-character limit. Compact keeps single-sentence requests.
See the measured tradeoffs in
[Local AI evaluation](local-ai-evaluation.md#gemma-correct-batching-2026-09-29).

Every proposal is checked before it is shown:

- only the reviewed scope is sent, with at most a few hundred characters of nearby text
  from the same field as read-only context; code, URLs, e-mail addresses, paths and other
  protected text are never editable (they are sent, at most, as opaque markers);
- a proposal is dropped if it changes a number, a name, a technical token, a negation
  ("not", "never"…), a hedge ("may", "maybe"…), quoted text, or line breaks, or if it
  swaps words for synonyms or rewrites more than a correction needs;
- each change is checked on its own, so one doubtful change does not hide the good ones
  in the same sentence; changes a word apart form one fix, so "user paste" → "a user
  pastes" is applied together;
- a proposal identical to a rule's fix is shown once (as the rule's); one that makes a
  rule's fix and more ("is saved immediatly" → "are saved immediately") is shown too;
  where the model and a rule disagree about the same word ("dont" → "don't" or
  "doesn't"), the model's fix is a second option on that finding, labelled **Local AI**
  and never preselected; any other overlap is left out.

After an edit, unchanged sentence pairs keep their grouping so a sentence deletion does not
force the rest of the document to be checked again. Only identical requests reuse answers.

Local AI shows checking progress as a percentage of planned chunks, including cached answers.
After an edit, its waiting message is separate from model loading; progress is not a time estimate.

Local AI fixes are **never part of Fix all safe**. Apply them one at a time from the card,
or with **Apply selected AI corrections**, which first previews the combined change (and
leaves out fixes that overlap each other) and applies it only when you confirm; that
button appears only where the editor supports verified multi-edit writes. The panel says
whether the Local AI check is running, complete, partial (for example text over its size
limit or a paragraph that failed), paused, or did not finish; "No issues found" never
claims more than the checks that actually ran. **Pause** stops it for this review. If
you edit the text, results are dropped and the check reruns after a pause (a paragraph
whose text and surrounding context are unchanged is not checked again).

**Rewrite (only when you ask).** Switch the panel to **Rewrite**, choose a style (**Keep
my voice** by default, Professional, Friendly, Concise, Clearer, or Context-aware, which
shows the style it picked and lets you say whether you are writing a chat message, an
e-mail or something general) and press **Generate**. You get one proposal for the
selection or field, shown as a before/after diff. Nothing changes until you press
**Apply**, which is enabled only for a complete proposal. Each sentence of it must pass
the same fact checks (numbers, names, technical tokens, negation, certainty) and add no
promise, deadline, apology or greeting you did not write; a sentence that fails is kept
exactly as you wrote it, and the panel says how many were kept. Resolving a double
negative ("not change nothing" → "not change anything") is allowed. Editing the text
makes the proposal stale.
Rewrite works on up to about 2,000 characters; select a passage for longer text. In a
review-only editor there is no Apply: **Copy** puts the proposal on the clipboard when you
click it. Every new review starts in Correct.

**Privacy.** The text goes from the page's content script to the extension's own
background service worker and back, bound to that tab and review; it is never
uploaded, logged or stored, and the model's conversation is reset between requests.
Nothing is downloaded or loaded before you set it up.

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

| Editor                                                                                 | Highlights                                                              | Apply one                               | Fix all | Undo                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- | ------- | ---------------------------------------- |
| `<textarea>`, text `<input>`                                                           | overlay measured through a hidden mirror in FluentTyper's shadow root   | yes                                     | yes     | one native undo step for the whole batch |
| `contenteditable`                                                                      | CSS Custom Highlights (overlay fallback, e.g. inside shadow DOM)        | yes                                     | yes     | one native undo step per fix             |
| Quill                                                                                  | CSS Custom Highlights                                                   | yes                                     | yes     | Quill history (a batch is one step)      |
| ProseMirror, Lexical, Slate, Draft.js, CKEditor 4/5, Trix, TinyMCE, Froala, Summernote | yes                                                                     | no: review-only, the panel explains     | no      | —                                        |
| Google Docs (existing bridge)                                                          | overlay over the text Docs shows; list only where Docs has not drawn it | yes: one verified replacement at a time | no      | Docs history                             |
| Code editors, sensitive and ineligible fields                                          | refused with an explanation                                             | —                                       | —       | —                                        |

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
A text field that refuses that command is reported as refused rather than
written another way that undo would not restore, and so is a fix that would
make it longer than its `maxlength` (the browser would cut it). Focusing the editor can run
page code, so the checks above are repeated after focus moves and before the
write. The caret and selection keep their place between fixes.
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
             reviewSpelling.ts   unknown words: what to look up, which suggestions to offer
             bulkPlanner.ts      Fix-all planning: conflicts deferred, proofs in rounds
             textRanges.ts       edits, diffs, remapping, grapheme boundaries
             reviewMessages.ts   explanations and UI strings (9 languages)
Application  src/core/application/review/ReviewSession.ts
             lifecycle, debounced rechecks, ignores, apply / Fix all through a port
Adapters     src/adapters/chrome/content-script/review/
             ReviewTargets.ts, ContentEditableTextMap.ts, GoogleDocsReviewTarget.ts
             ReviewController.ts (listeners, painting, focus)
UI           ReviewUi.ts, reviewStyles.ts (shadow DOM, top-layer popover)
Background   CommandRouter (shortcut), MessageRouter (add to dictionary, dictionary
             lookups through PresageEngine.lookupWords)
```

Nothing is created, observed or scanned until the first review. The review code
does ship in the content script, which grows by about 124 KB minified (43 KB
gzip) and is parsed in every frame; loading it as a separate chunk on first use
would need a `web_accessible_resources` manifest entry, left for a maintainer to
decide.

Limits: 50,000 characters per review (a larger scope is cut, and the panel
says so), scanned in chunks of about 4,000 characters that yield to the page.
Rechecks after edits are debounced by 400 ms and cancel stale work.

Whole-field drafts over 8,000 characters can reuse unchanged fixed-preposition
and usage-phrase results within the open session. Reuse compares the source and
surrounding evidence, settings, dictionary and protection; structure changes
clear it. Other detectors and safe-batch proof still rescan. Partial selections,
unread/oversized sources and short drafts use the full scan. The cache retains
at most 64 entries and 500,000 serialized UTF-16 units, and is cleared on close.

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

- Findings are limited to the catalog rules above and the dictionary check for
  unknown words. Review is not a general grammar checker, and most rules are
  English-only.
- The dictionary check finds words the dictionary lacks, not real words in the
  wrong place ("form" for "from"). It follows the language setting: under
  `en_US`, British spellings are unknown words, and a name that opens a
  sentence is listed (with "Add to dictionary" to accept it).
- The review UI language follows the browser language (English, French,
  Croatian, Spanish, Greek, Swedish, German, Polish, Portuguese).
- Google Docs: findings are highlighted where Docs shows their text. Docs
  paints text on a canvas, and for an extension it allows (FluentTyper registers
  as one, as it does for autocomplete) it lays an invisible labelled box over
  each run of text; review places those runs in the document's text and
  measures each finding inside its run. Docs draws only the pages near where
  you are, so a finding elsewhere is in the list until you scroll to it; if
  Docs shows no runs at all, the panel says findings are listed only. A run
  is placed only where it and the runs drawn beside it agree with the text:
  a header, footer or table cell whose text repeats elsewhere may stay
  unhighlighted, but never highlights other text. Text set in columns, and
  table cells drawn far apart, may be listed only. Highlights stay inside the
  editor and are not drawn over Docs' menus, dialogs and bubbles. A click on
  a highlight opens its card; a drag, shift-click or double click selects
  text as usual, and Escape in the document closes the card. No Fix all (one
  verified replacement at a time).
- Google Docs: a document of up to 50,000 characters is reviewed whole, even
  with all of it selected. In a longer one, 50,000 characters around the
  cursor are reviewed, starting at a sentence and ending at a whole word; the
  panel reports how much was not checked. Typing in the document rechecks. A
  change made without typing (a collaborator, a menu command) is noticed when
  Docs redraws the page, once its editor has focus (Docs is read only then).
- Model-backed editors are review-only: writing behind their document model is not safe.
- Contenteditable undo is one step per fix; textarea and Quill undo a batch in one step.
  In Firefox, a fix that replaces all of a formatted word's text (a word that is
  its own bold, italic or link) takes two steps, so the space beside it is kept;
  a one-character link ("i" -> "I") cannot be written that way and is refused.
- Textarea highlights can be misplaced under an ancestor with CSS `zoom`.
- Chrome may turn a space next to an edit into a no-break space. Review
  accepts only that change next to the edit; any other difference, or text the
  browser put outside the link or formatting it came from, is reported.
- Ignore once belongs to one occurrence and is dropped when an edit (including
  an undo) spans the ignored text.
- Chains of more than 8 mutually dependent fixes are left for individual review.
- A lowercase "i" before "is", or named by the word before it ("the variable
  i", "the index i"), and "i has" after words like "if" or "while", is left
  alone: it is usually a variable.
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

### Quotation warnings

`unclosedQuotation` checks complete fields for unmatched opening quotation marks in the
review language's convention: straight double, curly double/single and guillemets by
default; German „…“, ‚…‘ and »…«; Polish „…” and «…»; Croatian „…” and »…«; Swedish ”…”
and »…». A mark that opens in one convention but closes in another abstains. It supports nested styles and
paragraph continuation marks. A warning highlights the opening mark, explains the
problem and offers Ignore/Disable actions; it has no replacement, Apply button or
Fix all safe path. Keyboard focus enters the card at its close control.

Partial selections, unread windows, fields over the Review limit and any protected
text suppress this check because the missing closing mark cannot be established.
Straight single quotes, escaped or named quote symbols, unfamiliar/mixed quotation
conventions and ambiguous nesting abstain. Apostrophes and measurement marks are
preserved. This check does not insert punctuation, repair brackets, enforce Oxford
commas or infer comma splices. Warning labels are localized in all nine UI languages;
the rule is Review-only and can be disabled independently.

### Canonical brand and acronym casing

`englishCanonicalCasing` offers the established forms GitHub, JavaScript, TypeScript,
WebRTC, FluentTyper, iPhone, macOS and eBay in prose of any review language. It accepts lowercase or
ordinary title-case input and inserts the exact canonical form; it does not apply
sentence title casing to brand names. The native sentence-start suggestion yields
only when an enabled canonical suggestion covers that start. Existing mixed-case
sentence-start protection keeps corrected lower-camel names stable. Its
findings are in the Capitalization and typography category, with every other
capitalization check.

All-uppercase emphasis, arbitrary mixed-case identifiers, URLs, paths, handles,
file names, glued/possessive tokens, code, dictionary words and named quoted
spellings are preserved. Isolated quoted names also abstain as potentially literal
spellings. Ambiguous common words such as go, rust and may are not brand entries.
This independently configurable Review check remains individual-only, adds no
terminology preferences and does not change typing behavior.

Case-only ASCII repairs change only the affected letters, preserving formatting
between them. Textareas keep their existing single-step transaction; contenteditable
fields keep the adapter's advertised per-edit native undo behavior.

### Your preferred terminology

In **Settings → Grammar → Preferred terminology**, add a source phrase, preferred
phrase and your own explanation. Choose the language, exact or insensitive case
matching, and whether the entry applies to any reviewed prose or only an explicit
selection. Save the entry, then enable preferred terminology in Review. The list
starts empty and disabled; there are no default vendor renamings. The separate
Review check must also remain enabled.

Edit preserves the entry's ID; Remove deletes it and rechecks an open Review.
Insensitive matching still inserts the preferred phrase exactly as authored.
Findings are labeled as user-authored advice, display the explanation as plain
text and require individual Apply. They do not create typing snippets or modify
the dictionary. Preferred wording takes precedence over overlapping native,
spelling and local-AI correction suggestions, preventing recheck loops.

Import accepts a versioned JSON file and explicitly **replaces the list and its
enabled state**. Export contains only this authored configuration. Limits are 64
entries, 64 KiB per import, 80 characters for sources, 120 for replacements and
240 for explanations (UTF-16 units). Text must be nonempty, trimmed and NFC;
control characters are rejected. Imports are validated as a whole, including
IDs, supported concrete languages, duplicate sources and potential replacement
cycles. Cycle detection is conservative for phrase overlaps and Unicode casing.
An import cannot overwrite a newer save made while its file is being read.

Example configuration (an authored preference, not a mandatory correction):

```json
{
  "version": 1,
  "enabled": true,
  "entries": [
    {
      "id": "acme-suite",
      "source": "Acme Suite",
      "replacement": "Acme Workspace",
      "casePolicy": "exact",
      "explanation": "Our preferred product name.",
      "language": "en_US",
      "scope": "all-prose",
      "enabled": true
    }
  ]
}
```

Matching is literal, with complete phrase boundaries and existing code, technical,
dictionary and selection protections. Longest overlapping phrases win. Settings,
matching and import/export work locally; analyzed prose is never persisted. The
50,000-character Review window also bounds terminology work; oversized direct
scans report their skipped coverage.

## Optional style and readability advice

In **Settings → Grammar → Review text**, enable either optional style check explicitly.
Both start off, remain off when defaults are restored, and never run while typing or
enter **Fix all safe**. The panel has a separate **Style advice** count and filter;
these findings do not count as grammar/spelling errors. Applying or ignoring advice
also stays separate from resolved/ignored errors. Correct mode works as before with
these checks disabled; Rewrite remains its own user-selected action.

- **Redundancy advice** offers `PIN` for `PIN number` and `ATM` for `ATM machine`.
  These are optional individual suggestions, not declarations that the original is
  ungrammatical. Quoted wording, code, dictionary entries, identifiers, plurals and
  ambiguous casing are left alone. Hedges, politeness, negation, adverbs, emphasis
  and numerical values are not rewritten.
- **Long-sentence advice** shows a warning for a fully visible prose sentence (segmented with
  the review language's sentence rules and abbreviations)
  exceeding the **Long-sentence word threshold**. The default is **35 words**; the
  settings field accepts whole numbers from **10 to 200**. This is your preference,
  not a universal quality score. Changing it saves locally and rechecks an open
  review, but does not enable advice. There is no suggested split and no Apply button.

Readability counting treats internal apostrophes/hyphens and decimal dots as part of
one word. Titles, initials and recognized abbreviations do not spuriously end a
sentence; ambiguous endings are skipped. Lists, protected text, dangling unpunctuated
fragments, cropped sentences and unread/over-50k sources are excluded. A complete
sentence wholly inside a selection can still receive advice. Literal decimals and
a small set of dotted prose abbreviations remain readable; URLs and code remain
protected. If native sentence segmentation is unavailable, coverage reports that
check as incomplete instead of claiming a successful check.

These checks use native local logic, no AI calls, model changes or remote processing.
Spelling and independently enabled Local AI corrections remain visible alongside
style advice. All edits use the existing editor transaction and native undo behavior.

### Coverage added from the prose regression corpus

Native Review recognizes additional bounded subject/verb, preposition, comparison,
possessive, complement and indirect-question constructions. These remain individual
suggestions and do not enable typing corrections or bulk application. Known quantified
mass-noun cases can produce a warning without an Apply action: the checker does not
invent how many pieces or kinds the writer meant.

Explicitly named quoted error examples remain unchanged by native grammar and spelling.
Ordinary dialogue still receives checks. Finite rules do not infer narrative tense,
article definiteness, dialect intent or the meaning of ambiguous effect/affect uses.
See [the corpus evaluation](native-review-corpus-evaluation.md) for measured coverage
and remaining gaps.
