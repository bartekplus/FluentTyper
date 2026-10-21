# Write grammar rules

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Grammar rules

Grammar, punctuation, spacing, typography, typing and Review rules are declared in YAML files: their patterns, their logic and their fixes. A build step compiles the files into TypeScript modules. The runtime never reads YAML. A rule names no TypeScript function: logic that a pattern cannot state is code in the rule file (see [Code in Rule Files](#code-in-rule-files)), which calls only the generic rule library.

## Add a Rule in Five Lines

To add a rule, add an entry to the `rules` list of the rule file for the language. This entry replaces "could of" with "could have":

```yaml
- id: en.couldOf
  checks: [englishModalOfCorrection]
  pattern: [{ lower: [could, should, would] }, { lower: of }]
  target: [2, 2]
  replacements: [have]
  message: review_msg_contextual_grammar
```

Then run `bun run compile:grammar` (`bun install`, `check`, `lint`, `typecheck`, `test` and `build` run it first). No engine or dispatcher code changes.

- `checks` names the settings switch that controls the rule. Use an existing check, or add a check (see [Checks](#checks)).
- `message` is a key of the Review explanation table (`review/reviewExplanations.ts`).
- Put a rule for all languages in `common.yaml` and give it `lang: "*"`. To limit it, use `includeLangs` or `excludeLangs`.

## Files

| Path                                                  | Content                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/domain/grammar/rules/common.yaml`           | The settings catalog (`checks`), shared rules, and the typing rules                              |
| `src/core/domain/grammar/rules/<lang>.yaml`           | The rules and phrase tables of one language (`en`, `de`, `pt_BR`, ...)                           |
| `src/core/domain/grammar/engine/compiler.ts`          | Validates the files and compiles them (pure, also used by tests)                                 |
| `src/core/domain/grammar/engine/*.generated.ts`       | The compiled rules. Generated, not in git                                                        |
| `src/core/domain/grammar/review/rules/*.generated.ts` | The code of each rule file (`<file>.live.generated.ts`: its typing rules). Generated, not in git |
| `src/core/domain/grammar/engine/expressions.ts`       | Checks the expressions of the rule files                                                         |
| `src/core/domain/grammar/engine/ruleCode.ts`          | The code of a rule file: names, bindings, conditions, kinds of function                          |
| `src/core/domain/grammar/library.ts`, `library/*.ts`  | The rule library: the only TypeScript that rule code calls                                       |
| `src/core/domain/grammar/engine/tokenizer.ts`         | The single-pass tokenizer                                                                        |
| `src/core/domain/grammar/engine/matcher.ts`           | Pattern matching with the literal anchor index                                                   |
| `src/core/domain/grammar/engine/predicates.ts`        | Named token predicates                                                                           |
| `src/core/domain/grammar/engine/phraseRows.ts`        | The phrase-table kind: row index and row matcher on the engine tokens                            |
| `src/core/domain/grammar/engine/reviewTokens.ts`      | The tokens of a Review chunk: one pass for all rule kinds                                        |
| `src/core/domain/grammar/engine/reviewRules.ts`       | Builds the Review detectors from the compiled rules                                              |
| `src/core/domain/grammar/engine/liveRules.ts`         | Builds the typing rules from the compiled rules                                                  |

The file order is `common`, `en`, `es`, `fr`, `hr`, `el`, `sv`, `pl`, `de`, `pt_BR`, `ar_SA`.

## Commands

| Task                                     | Command                           |
| ---------------------------------------- | --------------------------------- |
| Compile the rule files                   | `bun run compile:grammar`         |
| Compile again even when no input changed | `bun run compile:grammar --force` |

The modules that the compiler writes from the rule files are not in git (`.gitignore`). `bun install` writes them (postinstall), and `bun run check`, `lint`, `typecheck`, `test` and `build` compile first. A `bun test` run compiles first too (`tests/bun-test-preload.ts`). The compile writes only when its inputs changed or an output is missing (`review/rules/.inputs` holds the hash of the inputs and the list of outputs). The generated modules are not formatted. oxlint skips the files that `.gitignore` names, so the `lint` script names the generated modules on the command line. The lexicon data modules (`*Lexicon.generated.ts` and the others that `bun run generate:lexicons` writes) stay in git.

## Checks

A check is one settings switch and one catalog id. `common.yaml` lists the current checks in the order that settings show them. A language file can add more checks after them.

```yaml
checks:
  - id: englishModalOfCorrection
    modes: [live, review]
    priority: 29
    scope: en_US
    title: grammar_rule_english_modal_of
    category: grammar
    kind: usage
    safeToFix: true
    example:
      lang: en_US
      before: "You could of told me."
      after: "You could have told me."
```

| Field       | Meaning                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `modes`     | `live`: a typing rule. `review`: Review runs it.                                                                                             |
| `priority`  | Lower runs first while typing. Review uses it to pick between findings on the same text.                                                     |
| `scope`     | `all` (default) or `en_US`.                                                                                                                  |
| `title`     | The i18n key of the title. Default: `grammar_rule_<id>`. The description is `<title>_desc`.                                                  |
| `rollout`   | Typing rules: `on` (default) or `off`.                                                                                                       |
| `codeSafe`  | The rule can run in code mode.                                                                                                               |
| `category`  | `spelling`, `grammar`, `punctuation`, `typography` or `style`.                                                                               |
| `kind`      | The kind of problem (`ReviewKind` in `review/types.ts`).                                                                                     |
| `safeToFix` | "Fix all safe" can apply the fix, and a live pattern rule fixes it while the user types.                                                     |
| `enabled`   | Review: on by default. Default `true`.                                                                                                       |
| `languages` | Review languages: a list, `named` (all), or `{ phraseTables: [words, phrases] }`.                                                            |
| `note`      | Why the check is optional or individual.                                                                                                     |
| `excluded`  | A check without mode `review` gives the reason here.                                                                                         |
| `text`      | The settings title and description in each UI language (`en`, `fr`, `hr`, `es`, `el`, `sv`, `de`, `pl`, `pr`). A Review-only check needs it. |
| `example`   | The settings example: `lang`, `before`, and `after` (`null` for a warning). Each check needs one; a test runs it through the check.          |

The title and description of a typing check are in `src/ui/options/fluenttyperI18n.ts` (other pages also show them). A new typing check can give them in `text`; the options page then reads them from there.

Use `exclusive` for checks that undo each other. Only the first enabled check of a group runs.

## Rules

A rule reports findings for the checks in `checks`. A rule is a token pattern, a list of frames, a findings rule, or code (`let`, `when`, `return`).

| Field          | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| `id`           | Unique: `<file>.<name>`.                                                             |
| `checks`       | The checks of the findings; a pattern reports for the first one.                     |
| `lang`         | `*`, or a language. Default: the language of the file.                               |
| `modes`        | Default `[review]`. A live pattern needs a check with `safeToFix` and mode `live`.   |
| `stage`        | Evaluation stage. Default 0. Lower stages run first; file order inside a stage.      |
| `pattern`      | A list of token matchers (see below).                                                |
| `replacements` | One or more templates. Two or more make the user choose.                             |
| `target`       | The elements `[from, to]` that the fix replaces (1-based). Default: the whole match. |
| `preserveCase` | A literal replacement takes the casing of the text it replaces. Default `true`.      |
| `message`      | The Review message key.                                                              |
| `crossLines`   | The elements can be on different lines. Default `false`.                             |
| `bulkBlock`    | `context-dependent` or `ambiguous`: Fix all never applies it.                        |
| `return`       | Code in place of `pattern` (see [Code in Rule Files](#code-in-rule-files)).          |
| `cacheable`    | The Review cache can keep the results of the rule's code.                            |

The evaluation order is the file order, then the order in the file. The order decides which of two equal findings Review keeps.

### Token Matchers

The tokenizer reads the text one time. A token is a `word`, `number`, `punct`, `symbol` or `protected` token. Whitespace is not a token: each token keeps the whitespace before it. URLs, e-mail addresses, paths, inline code, emoji shortcodes and masked text are `protected` tokens. A matcher never accepts a protected token unless it names the type.

| Field                   | The token must ...                                             |
| ----------------------- | -------------------------------------------------------------- |
| `lower`                 | have a lowercase key that is one of these values               |
| `surface`               | have exactly this text (one value or a list)                   |
| `type`                  | be of this type (one value or a list)                          |
| `regex`, `negateRegex`  | match, or not match, this Unicode regex (the whole token)      |
| `casing`                | have this casing: `lower`, `upper`, `title`, `mixed` or `none` |
| `spaceBefore`           | have whitespace before it (`true`) or none (`false`)           |
| `spaceAfter`            | have whitespace (or the text end) after it, or none            |
| `exactWhitespaceBefore` | have exactly this whitespace before it                         |
| `matchRef`              | have the same key as element N (1-based), for repeated words   |
| `isSentenceStart`       | start a sentence, or not                                       |
| `isSentenceEnd`         | come before sentence-final punctuation or the text end, or not |
| `prevTokenNotLower`     | not come after one of these words                              |
| `nextTokenNotLower`     | not come before one of these words                             |
| `predicate`             | pass the named token predicate of `engine/predicates.ts`       |

The key of a token is its lowercase text without Arabic harakat and tatweel.

### Replacement Templates

| Template     | Result                                          |
| ------------ | ----------------------------------------------- |
| `have`       | The literal, in the casing of the replaced text |
| `$2`         | The text of element 2                           |
| `${2:lower}` | Element 2 in lowercase (also `upper`, `title`)  |
| `${1}n $2`   | A mix: "A hour" gives "An hour"                 |

### Frames

A frame rule lists regex frames for English text. Each frame has a `target` group, which its fix replaces. The engine runs a frame only on chunks that contain one of its literals; the compiler finds these literals at build time.

```yaml
fragments:
  POSSESSOR: "the|a|an|this|that|its|their|his|her|our|my|your|no"
rules:
  - id: en.idiomPhrases1
    checks: [englishPhraseCorrections]
    message: review_msg_phrase_correction
    frames:
      - regex: "(?:cure|cures|cured|curing){{S}}(?<target>against){{E}}"
        fix: for
      - regex: "{{notAfter:{{POSSESSOR}}}}(?<target>cause){{S}}it{{S}}is{{E}}"
        fix: [because]
      - regex: "on{{S}}(?<target>[a-z]+){{S}}basis{{E}}"
        return: 'target === "a" ? null : "a"'
        raw: true
```

| Field    | Meaning                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `regex`  | The frame. `{{NAME}}` inserts a fragment: the file's `fragments`, or `S` (spaces), `E` (word end), `COMPLETE`, `COMPLETE_OR_PAREN`, `CLAUSE`, `TOKEN_END`. `{{notAfter:a | b}}` means "not right after these words". |
| `fix`    | The fix, or a list of fixes to choose from. The fix takes the casing of the typed words.                                                                                 |
| `return` | Code that gives the fix (with `let` and `when`, see [Code in Rule Files](#code-in-rule-files)). `null` drops the match.                                                  |
| `raw`    | The fix already has the typed casing.                                                                                                                                    |

A rule can also give:

- `style: template`: the frames run in every language of the check, each frame has one `fix` string (an empty string deletes the target), and a finding keeps 96 characters of context before the match and 9 after it.
- `filter:` code over `findings` (all findings of the rule) that returns the ones to keep.
- `style: <name>`: the other styles (`slot`, `carry`, `german`, `portuguese`, `cased`, `polish`, `comma`, `swap`) set the language, the casing of the fix and the guards of a language. The comment on `style` in `engine/types.ts` gives each one.

All frame styles run in one loop: `detectFrames` in `engine/frameStyles.ts`. A style is a row of the `STYLES` table there, not a loop of its own. To change how a style reads a match, change its row.

### Match Frames

Use `style: match` when a fix needs logic that a frame alone cannot state: a lexicon lookup, a look at the words around the match, or a finding of another shape. The rule file gives the regex, the scan and the code that reads each match.

```yaml
- id: en.bewareOf
  checks: [englishFixedPrepositions]
  style: match
  message: review_msg_fixed_prepositions
  frames:
    # "Beware on the step": the thing to beware of takes "of".
    - regex: "beware{{S}}(?<target>in|on|at){{S}}(?:the|that|this|these|those){{E}}"
      gate: beware
      when: "enOpensClause(ctx, m.index, /^(?:to|and|but)$/)"
      return: caseLike(target, "of")
```

The code of a match frame returns:

- `null`, `undefined` or `[]`: no finding.
- A string or a list of strings: a finding that replaces the `target` group, 96 characters of context before the match and 9 after it.
- A `RawFinding` or a list of them: findings of any other shape.

| Field       | Meaning                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan`      | `frame` (default): a frame scan with the word-start guard. `owned`: the regex over the scan text, from `lookback` characters before the chunk. `text`: the same over the text. `polish`: the Polish owned scan. |
| `flags`     | The regex flags of a complete regex. A frame scan needs `g` and `d`; the other scans need `g`.                                                                                                                  |
| `lookback`  | `owned` and `text` scans: the characters read before the chunk.                                                                                                                                                 |
| `lookahead` | `owned` and `text` scans: a match may start this many characters after the chunk.                                                                                                                               |
| `owner`     | Frame scans: the group whose start must be in the chunk (default `target`). `a\|b`: the first group that matched. `none`: every match.                                                                          |
| `gate`      | A regex that must occur near the chunk before the frame runs (a rare word). `gateFlags` sets its flags (default `gi`).                                                                                          |
| `check`     | The check of the frame, when it is not the rule's first check.                                                                                                                                                  |
| `anyCheck`  | The frame runs when any check of the rule is on. Its code returns findings of several checks.                                                                                                                   |

The code of an `owned`, `text` or `polish` frame can call `frame.resume(index)`: the scan reads its next match from `index`, for matches that overlap.

More rule and frame fields:

- `lang: <code>` on a frame: the frame runs only on text of that language. One rule can hold the frames of several languages.
- A frame rule may also have code of its own (`let`, `when`, `return` on the rule). It runs after the frames, for logic that is no scan (for example the phrase rows of the rule files).
- `group: <name>`: consecutive rules of one group run as one detector. A rule that throws stops its group and drops the group's findings, as one composite check did before.
- `findings: style | terminology | quotation` (instead of frames or a pattern): the rule reports the findings that Review made before the rule scan (style advice, the user's preferred terms, unclosed quotations) whose range starts in the chunk.

## Code in Rule Files

All logic of a rule is in its rule file. A frame, a rule and a rule's `filter` can hold code:

```yaml
- regex: "{{WG}}(?:(?<target>{{COLLOCATION_NOUNS}})...)"
  let: # bindings, in order
    typed: m.groups!.target ?? m.groups!.t2
    own: COLLOCATIONS[typed.toLowerCase()]
  when: # conditions: when one fails, the code gives "nothing"
    - idiomOpen(m, ctx)
    - "lowerWords(m.input.slice(m.index - 40, m.index)).some((w) => own.test(w))"
  return: idiomFinding(m, ctx, frame, capitalize(typed))
```

- `let` binds names in order. `when` lists conditions. `return` is the result.
- A `when` runs right after the last binding it reads, and never before the condition above it: write the conditions and bindings in the order the code must test them.
- When a `when` fails, the code gives `null` (a frame), `[]` (a `portuguese` frame or a rule's Review code), the findings unchanged (a filter) or `null` (a typing rule).

| Where the code is                                       | It reads                                                              | It returns                |
| ------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| A frame (all styles except `template` and `portuguese`) | `m` (the match), `ctx` (the chunk), `frame`, the match groups by name | the fix (see each style)  |
| A `portuguese` frame                                    | `target`                                                              | a list of fixes           |
| A Review rule (`return` on the rule)                    | `ctx`                                                                 | `RawFinding[]`            |
| A rule's `filter`                                       | `ctx`, `findings`                                                     | the findings to keep      |
| A typing rule (`modes: [live]`, with `triggers: [...]`) | `context` (the text before the cursor), `options`                     | a `GrammarEdit` or `null` |

### Helpers

A file, and each of its rules, can define helpers for its code. All the names of a file share one scope. Put a helper beside the rule that uses it. The names of `common.yaml` reach every other file; a file's own name hides a shared name.

```yaml
sets:
  STOP: [a, an, the] # a ReadonlySet<string>
maps:
  OPPOSITE: { left: right, right: left } # a Readonly<Record<string, string>>
defs:
  NEHMEN: /^(?:nehm|nimm|nahm|nähm|genommen)/ # a constant
  clauseBefore: # a function
    args: "ctx: DetectContext, m: RegExpExecArray"
    return: 'ctx.text.slice(Math.max(0, m.index - 120), m.index).split(/[.!?;,:\n]/).at(-1) ?? ""'
```

A function def can also have `let`, `when`, `else` (what it gives when a `when` fails; default `null`) and `type` (its result type; a recursive def needs it).

### Expressions

An expression is a TypeScript expression: literals, regex and template literals, arrays and objects, member access, `?.`, `!`, `??`, `&&`, `||`, conditionals, comparisons, arithmetic, `in`, `typeof`, calls (also of methods that change a collection, such as `.add` or `.set`), arrow functions with an expression body, `as`, `satisfies`, and `new` for `Set`, `Map`, `WeakSet`, `WeakMap` and `RegExp`. Assignment, statements, `this`, classes and the properties `constructor`, `prototype`, `__proto__`, `call`, `apply` and `bind` are errors. A loop is a method such as `some`, `find` or `reduce`, or a recursive def. State kept between calls is a `Map`, `WeakMap` or `WeakSet` def.

The compiler checks each expression and each name it reads. The generator writes the code of each rule file into a typed module (`review/rules/<file>.generated.ts`), so `bun run typecheck` and `bun run lint` read every expression against the types of the library. An error in a generated module is an error in its rule file: the comment above each function names its rule and frame.

In YAML, quote a value that starts with `!`, `[`, `{`, `*`, `&`, `|`, `>`, `'`, `"`, `%` or `@`, or that holds `: ` or ` #`. Single quotes keep backslashes as typed (`'/\p{L}+/u.test(word)'`).

### The Rule Library

`library.ts` and the `library/` files it re-exports are the only TypeScript that rule code calls. A library function answers a question about the text or the language (lexicon, inflection, words around a position, casing, quotations), or builds a finding or an edit from the parts it gets. It names no check and no message, and it holds no rule's trigger words, exceptions or fix text: those stay in the rule files. Library names have an area prefix (`en`, `EN_`, `de`, `es`, ...). `tests/grammar/RuleLibrary.test.ts` checks these limits, and that no library file loads the engine (an import cycle) and that the typing rules load no Review code (the content scripts stay small).

A TypeScript module that tests import keeps its path as a facade: it re-exports names of a generated module or the library, and a typing rule class delegates to `liveRule(id)` of `engine/liveRules.ts`.

### Token Predicates

A token matcher of a pattern can name a token predicate of `engine/predicates.ts` (`enStartsWithVowelSound`, `isMeasurementUnit`, `isNotAbbreviation`). They are generic tests of one token and must stay small: content scripts load them.

A name that no module defines is an error of the compiler or of the type checker.

## Phrase Tables

A language file can hold phrase tables: rows of "typed = fix". They feed `englishPhraseCorrections`, `englishClosedCompounds` and `stylePhrasing`. The engine runs them (`engine/phraseRows.ts`): each word token of a chunk reads the rows that start with it, longest first, and a literal matcher confirms the row. The Review checks that only Review needs (names, quotations, article gender, casing) are in `review/englishPhraseCorrections.ts`.

```yaml
phrases:
  words: |
    Standart = Standard
    Rythmus | Rhytmus = Rhythmus
    bisherig = bisher; bisherige
```

- `a | b = fix`: two typed forms with one fix.
- `typed = fix1; fix2`: the user chooses a fix.
- The kinds are `words`, `phrases`, `compounds` and `style`. The kinds of a language set the languages of the phrase checks.
- A language with Review data (`ar`, `de`, `es`, `fr`, `pl`, `pt`, `sv`) ships its tables in that data: the compiler writes them to `review/<language>/phrases.generated.ts`, and the build writes them to `review-data/<lang>.json`. The background loads the file before the first check of text in that language. The tables of the other languages are in `engine/review.generated.ts`.
- English tables are named tables: `tables: { <name>: <rows> }`. The compiler gives them as `TABLES["en.<name>"]`.

## Performance

- The tokenizer reads the text one time. Each token finds its rules with one read of the anchor index: a rule is indexed by the literal of its pattern that is most selective. Rules without a literal run in the same pass.
- The time of a pass follows the number of tokens, not the number of rules. `tests/grammar/GrammarEngine.timing.test.ts` checks a full draft of each language against more than 30,000 rules (under 5 ms), and a single-sentence live check (under 0.5 ms).
- Review gets the pattern results of a chunk from one shared pass. A frame regex runs only where a match can start: at its fixed start letters (found with `indexOf` and kept per chunk), or in the windows before a fixed word that every match holds. Gates skip a frame whose required word is not in the chunk.
- `bun run bench:review` times a full Review of a 3,000-character draft in each Review language (median of 60 runs). Every language must stay under 5 ms; `bun run bench:review --check` fails when one does not. Run it on a machine with no other load: CI runners are slower, so this is not a unit test.

---

[Architecture](architecture.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
