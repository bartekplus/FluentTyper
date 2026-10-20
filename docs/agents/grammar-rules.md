# Write grammar rules

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Grammar rules

Grammar, punctuation, spacing, typography and Review rules are declared in YAML files. A build step compiles the files into TypeScript modules. The runtime never reads YAML.

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

Then run `bun run compile:grammar`. The build runs the same step. No engine or dispatcher code changes.

- `checks` names the settings switch that controls the rule. Use an existing check, or add a check (see [Checks](#checks)).
- `message` is a key of the Review explanation table (`review/reviewExplanations.ts`).
- Put a rule for all languages in `common.yaml` and give it `lang: "*"`. To limit it, use `includeLangs` or `excludeLangs`.

## Files

| Path                                                     | Content                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/core/domain/grammar/rules/common.yaml`              | The settings catalog (`checks`), shared rules, and the typing rules    |
| `src/core/domain/grammar/rules/<lang>.yaml`              | The rules and phrase tables of one language (`en`, `de`, `pt_BR`, ...) |
| `src/core/domain/grammar/engine/compiler.ts`             | Validates the files and compiles them (pure, also used by tests)       |
| `src/core/domain/grammar/engine/*.generated.ts`          | The compiled output. Do not edit                                       |
| `src/core/domain/grammar/engine/tokenizer.ts`            | The single-pass tokenizer                                              |
| `src/core/domain/grammar/engine/matcher.ts`              | Pattern matching with the literal anchor index                         |
| `src/core/domain/grammar/engine/predicates.ts`           | Named token predicates                                                 |
| `src/core/domain/grammar/engine/reviewRules.ts`          | Builds the Review detectors from the compiled rules                    |
| `src/core/domain/grammar/engine/liveRules.ts`            | Builds the typing rules from the compiled rules                        |
| `src/core/domain/grammar/review/<lang>/ruleDetectors.ts` | The named Review detectors of a language                               |

The file order is `common`, `en`, `es`, `fr`, `hr`, `el`, `sv`, `pl`, `de`, `pt_BR`, `ar_SA`.

## Commands

| Task                                            | Command                           |
| ----------------------------------------------- | --------------------------------- |
| Compile the rule files                          | `bun run compile:grammar`         |
| Fail when the generated modules are not current | `bun run compile:grammar --check` |

`bun run build` compiles the files before it bundles. `bun run check` and the unit tests fail when a generated module is not current.

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

A rule reports findings for the checks in `checks`. A rule is a token pattern or a named predicate.

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
| `predicate`    | A named detector, in place of `pattern`.                                             |
| `cacheable`    | The Review cache can keep the results of the detector.                               |

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

### Named Predicates

Use a predicate only for logic that a pattern cannot state: a phonetic test, a lexicon, an agreement check, or a clause reader.

- **Token predicates** (`engine/predicates.ts`) test one token in a pattern, for example `enStartsWithVowelSound`, `isMeasurementUnit` or `isNotAbbreviation`. They must stay small: content scripts load them.
- **Review detectors** are functions `(ctx) => RawFinding[]`. A language registers them in the `PREDICATES` record of `review/<lang>/ruleDetectors.ts`. The shared detectors are in `CORE_PREDICATES` of `review/reviewDetectors.ts`. A rule names one with `predicate: <name>`. Use `<file>:<name>` to name a detector of another file.
- **Live implementations** are typing rules that read the cursor state (`engine/liveRules.ts`). A rule with `modes: [live]` names one.

A name that no module defines stops the extension at load. The unit tests find it first.

## Phrase Tables

A language file can hold phrase tables: rows of "typed = fix". They feed `englishPhraseCorrections`, `englishClosedCompounds` and `stylePhrasing`.

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
- Review gets the pattern results of a chunk from one shared pass. The named detectors keep their own cost.

---

[Architecture](architecture.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
