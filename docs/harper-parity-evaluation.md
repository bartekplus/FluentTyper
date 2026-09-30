# Evaluation against Harper's test cases

Some checks were inspired by [Harper](https://github.com/Automattic/harper). Its unit tests, whole-document tests and clean snapshot lines (harper-core at `0759a1b6`) were run **locally** against FluentTyper to find false positives and misses. No Harper code, data or test text is in this repository; every regression test here uses our own sentences. Baseline is `c7f91676`.

## False-positive scan

- **Clean text**: 764 texts Harper leaves unflagged (17 whole documents and 745 snapshot lines, hard-wrapped fragments marked). Review ran with every native rule on (`en_US`, `en_GB` for British documents, no dictionary). Typing ran every typing rule character by character, except the opt-in typographic rewrites (smart quotes, auto-close brackets, ellipsis and em dash shortcuts).
  - Baseline: 4 Review findings (decades such as `1970s` read as seconds), 2 typing rewrites (HTML attribute spacing, `from you was` → `were`).
  - Now: 0. The rest are expected: a lowercase start of a hard-wrapped fragment, a quote closed on the next line, trailing spaces trimmed before a line break.
- **Per-rule negative cases**: 2,484 distinct inputs that one Harper rule must leave alone. These may contain other errors, so each finding was reviewed.
  - Review: 11 false `to to` repairs (a stranded preposition or an elided infinitive) are now 0. The other findings are real errors: lowercase `i`, `dont`, `their was`, `Javascript`, a repeated `the`.
  - Typing: fixed live rewrites of `... and`, `$4,000`, `(18+,`, `SameSite=Lax`, `/help` and `iPhone` at a sentence start.

## Parity with Harper rules that have a FluentTyper counterpart

27 Harper rules map to existing FluentTyper rules. Harper's ignored (known-failing) cases are skipped. "Fix" passes when a sequence of FluentTyper's own suggestions for the mapped rule reaches Harper's expected text.

| Case type                    | Baseline |     Now |
| ---------------------------- | -------: | ------: |
| Must stay silent (`no_lint`) |  307/321 | 316/321 |
| Must be repaired (`fix`)     |   40/391 |  50/391 |
| Must be flagged (`lint`)     |    12/46 |   14/46 |

The 5 remaining `no_lint` differences are deliberate: FluentTyper capitalizes a lowercase sentence start even for lowercase product names (2), flags `Its not`/`Its never` because a possessive cannot precede them (2), and reports double spaces after a period (1; Harper splits this into two opposing opt-in rules).

Misses are mostly by design. FluentTyper's contextual rules (its/it's, their/there/they're, your/you're, to/too, agreement, then/than) fire only inside finite, audited frames, so Harper's broader cases score low: for example existential agreement 0/53 and their/there families 14/158. Recall was widened only where precision was clear:

- `might of` and negated modals (`couldn't of`); the noun `might` stays untouched. `may of` is left out (`May of 2020`).
- then/than before an object pronoun or `ever`, `X rather then Y`, `easier said then done`.
- `its` before words a possessive never precedes (`its a`, `its been`, `its because`).
- Repeated `and` and `as`.
- Title case (`Could Of` → `Could Have`), the text's own apostrophe style, and `(i think)`.

Also deliberately unchanged: a bare final `i` (may be a variable), wrong ordinal suffixes such as `2st` outside the existing ordinal frames, full-width CJK commas, `than` → `then`, and `to to` after a noun (`the way to to do`). Removing the 11 false `to to` repairs cost 3 true ones (5/8 → 2/8).

The harness and corpus stay outside the repository; rerun them from a local Harper checkout when these rules change.

## Whole-checker coverage of Harper's English cases

Every Harper `fix`/`lint` case (5,907) was run through Review with all native rules on (`en_US`, no dictionary). A case counts as detected when any finding overlaps the expected change, and exact when applying FluentTyper's suggestions yields Harper's expected text.

| Snapshot                       | Detected | Exact |
| ------------------------------ | -------: | ----: |
| Baseline `c7f91676`            |      475 |   356 |
| After the Harper-inspired work |    1,016 |   857 |

Most remaining misses need part-of-speech data (noun/verb confusions, possessive `'s`, "me and Alex"), dialect choices, or Harper's style opinions that FluentTyper leaves off by default.

## Architecture comparison and proposals

Harper lexes text once into tokens that carry dictionary metadata (part of speech, inflection, countability) and matches rules against that token stream; most of its recall comes from lexical data plus general rule shapes, not from its engine alone. FluentTyper's editor safety, snapshot validation and proven Fix all were already stricter than Harper's apply-one-at-a-time model, so the proposals borrow ideas and data _shapes_ (never Harper's code or data):

| #   | Proposal                                                                 | Status                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Authored irregular verb and noun tables with ambiguity marking           | Done: 140 verbs, ~50 irregular plurals                                                                                                           |
| 2   | General "have + past-only form" participle check                         | Done, individual-only                                                                                                                            |
| 3   | Irregular forms first for regularized unknown words (`finded`, `childs`) | Done, pick-one choice                                                                                                                            |
| 4   | a/an by initial sound instead of word lists                              | Done: typing rule stays opt-in, Review individual-only                                                                                           |
| 5   | One shared frame matcher and quoted-example guard                        | Done: 13 detectors migrated, output byte-identical, net fewer lines                                                                              |
| 6   | Data-driven fixed phrases, compounds, names and style advice             | Done: own tables for 9 languages, table-driven tests                                                                                             |
| 7   | Skip spelling in paragraphs written in another language                  | Done: reported as a coverage gap                                                                                                                 |
| 8   | Overlap resolution (longest span wins)                                   | Measured and rejected: realistic prose has no colliding fixes, and the Fix all planner already defers collisions; a guard test keeps it that way |
| 9   | Typo-shaped re-ranking of spelling candidates                            | Deferred: would undo Presage's recently tuned context order                                                                                      |
| 10  | Per-unit result caching for every detector                               | Deferred: a full 50k-character scan already takes about 100–150 ms                                                                               |
| 11  | Build-time English lexicon with part of speech                           | Open (maintainer decision): unlocks the remaining misses above, costs bundle size                                                                |
| 12  | harper.js as an optional extra Review source                             | Open (maintainer decision): several MB of WASM, English-only                                                                                     |
| –   | Persistent context-hash ignores                                          | Rejected: would persist hashes of typed text, which Review promises not to do                                                                    |

Beyond the proposals, Harper's grouping inspired Review _kinds_ (agreement, confused words, usage, split/joined words, …) shown on each card and used to group Settings, and its live underline-then-choose model inspired **grammar proposals while typing**: uncertain Review fixes are offered as an unselected popup row and applied only on explicit choice, while typing rules keep auto-applying only certain fixes.
