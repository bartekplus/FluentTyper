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
