# Evaluation against LanguageTool's rule examples

Review's native checks were measured against [LanguageTool](https://github.com/languagetool-org/languagetool) (LT). The example sentences in LT's rule files were run **locally** through FluentTyper, for every language both projects support. LT was a scorecard and a source of ideas only. No LT code, rule XML, word lists, messages or example text is in this repository. Every table row, pattern and regression test here was written from scratch in our own words. The harness and its corpus stay outside the repository.

Baseline: FluentTyper `bda1ebe2` (Harper parity, #432) against LanguageTool `68deb137`.

## Method

- **Corpus.** The harness reads LT's `grammar*.xml` and `style*.xml` files for English, French, German, Portuguese, Spanish, Polish, Arabic, Greek and Swedish. Each `<example>` becomes a record with its rule, category, LT default state, marker span and corrections. Following LT's own convention, an example counts as _incorrect_ when it has a correction or `type="incorrect"`; every other example counts as _correct_. LT's `triggers_error` examples are correct sentences that LT knowingly flags. They are left out of the false-positive counts.
- **Configuration.** Every Review rule is on, including the opt-in ones, with an empty user dictionary. Spelling is included: the run adds the offline dictionary pass every user has, which skips ranges already covered by grammar findings and drops paragraphs written in another language.
  - Each finding records whether its rule is on by default and whether it is a spelling finding. That lets the default-on and non-spelling columns be read separately.
  - Locales: en_US, fr_FR, de_DE, pt_BR, es_ES, pl_PL, ar_SA, el_GR and sv_SE. FluentTyper has no en_GB, pt_PT or de_CH locale. British, Australian and New Zealand examples therefore run en_US with British spelling advice instead of American. European Portuguese runs as pt_BR, and Swiss and Austrian German as de_DE.
- **Scoring incorrect examples.**
  - _Detected_: any finding overlaps LT's marker.
  - _Exact_: applying one of FluentTyper's alternatives yields one of LT's expected texts. Whitespace runs collapse and Arabic harakat are ignored. Exact counts as detected. Only examples that carry a correction can be exact.
  - Capitalizing the lowercase start of a sentence fragment does not count as detecting an example unless LT's correction makes the same change. Without that exclusion, French and Portuguese detection would double from fragments alone.
- **Scoring correct examples.** A correct example is a false positive (fp) when any finding lands on it. The table reports default-on findings, and default-on non-spelling findings separately. Most spelling fps are names, foreign words and technical terms.
- **What a correct-example fp means.** LT promises only that a correct example is clean for the rule it illustrates. Many of them contain other real errors: a missing hyphen, a wrong verb ending, a lowercase sentence start, a doubled space. A finding on such an error is not a false positive.
  - Every language pass listed its new hits on correct examples and judged each one. A real false positive was fixed, or its rule was made opt-in.
  - An independent spot check drew 25 random new French default-on non-spelling hits, leaving out sentence-start capitalization. About 23 of the 25 were genuine errors. The one debatable case was spacing between a number and a unit symbol.
  - Precision audits then classified every default-on hit on correct examples in four languages:
    - Spanish: 52 hits; 47 genuine errors, 2 contested, 3 real false positives fixed.
    - French: 576 hits; 536 genuine, 34 contested, 7 fixed.
    - German: 149 hits; about 101 genuine, 32 sentence-fragment capitalizations, 5 contested, 5 fixed.
    - Polish: all 48 genuine.
  - The column therefore overstates false positives. A rise in it is a prompt to look, not a regression in itself.

## Snapshot: `lt-parity` at `7422722a`

One full run of all nine languages, spelling included, on the final integration tree. Refresh this section with the harness when the rules change.

| Language | Incorrect | Detected (baseline → now) | Exact (baseline → now) | Correct | Default-on fp | Default-on non-spelling fp |
| -------- | --------: | ------------------------: | ---------------------: | ------: | ------------: | -------------------------: |
| en       |    10,095 |     2,244 → 6,530 (64.7%) |          1,502 → 5,516 |  14,776 | 1,785 → 1,629 |                  752 → 750 |
| fr       |     9,171 |       741 → 2,924 (31.9%) |            207 → 2,213 |  10,044 | 1,832 → 2,079 |              1,286 → 1,664 |
| de       |     7,622 |       515 → 3,730 (48.9%) |            140 → 3,199 |   4,821 |     383 → 430 |                   65 → 130 |
| pt       |     6,030 |       738 → 2,987 (49.5%) |            323 → 2,452 |   7,812 |   1,028 → 961 |                  331 → 426 |
| es       |     3,060 |       313 → 2,102 (68.7%) |             91 → 1,810 |   4,182 |     711 → 738 |                  389 → 425 |
| pl       |     2,143 |       163 → 1,398 (65.2%) |             47 → 1,171 |   3,112 |     183 → 128 |                    50 → 48 |
| ar       |       639 |          23 → 479 (75.0%) |                5 → 385 |     400 |       29 → 25 |                    20 → 16 |
| el       |        60 |             3 → 60 (100%) |                 3 → 60 |      58 |         4 → 3 |                      0 → 0 |
| sv       |        32 |            5 → 31 (96.9%) |                 2 → 29 |      13 |         1 → 1 |                      1 → 1 |
| All      |    38,852 |    4,745 → 20,241 (52.1%) |         2,320 → 16,835 |  45,218 | 5,956 → 5,994 |              2,894 → 3,460 |

How much of this comes from rules that are on by default:

| Language | Detected by default-on rules (baseline → now) | Largest opt-in contributors                                                                                |
| -------- | --------------------------------------------: | ---------------------------------------------------------------------------------------------------------- |
| en       |                                 1,797 → 5,402 | contractions style, wording advice, passive voice note, clause and introductory commas, sentence fragments |
| fr       |                                   715 → 2,678 | pleonasm and calque advice, missing `ne`                                                                   |
| de       |                                   506 → 3,498 | recommended spellings, wording advice, colloquial forms, straight quotes, question marks                   |
| pt       |                                   711 → 2,594 | wordiness, idiom and register advice, AO90 spellings, typographic style, introductory commas               |
| es       |                                   303 → 2,036 | redundancy advice, Spanish quotation marks, typographic style                                              |
| pl       |                                   152 → 1,230 | pleonasm, officialese and calque advice, „…” quotes                                                        |
| ar       |                                      23 → 180 | prescriptive usage advice (about 300 of the 479 detections)                                                |
| el       |                                        2 → 37 | strict final-ν, connector commas                                                                           |
| sv       |                                        5 → 23 | wording advice                                                                                             |

The first commit of the effort fixed spelling bugs and abbreviation handling, and every number dropped. English detection fell from 2,244 to 2,129 because ordinary dictionary words ("id", "re", "true") were no longer reported as misspelled, which had counted as detecting LT examples by accident. Default-on fps fell in every language except Greek and Swedish for the same reason. The gains in the table were made on top of that lower line.

**Croatian** is a FluentTyper language with a bundled dictionary, but LanguageTool has no Croatian module, so there is nothing to score. Its Review checks are unchanged by this effort apart from the shared infrastructure fixes below.

### Where the remaining non-spelling fps come from

Sentence-start capitalization on lowercase fragments dominates. LT's correct examples are often clause fragments. This accounts for about 1,160 of French's 1,664, 380 of Spanish's 425, 255 of Portuguese's 426, 150 of English's 750 and 30 of German's 130. It is the same finding a user gets when starting a sentence in lowercase, and it is not tuned to the corpus.

What is left, by language:

- **French and Portuguese:** the rises are new agreement, homophone, hyphenation and elision findings on real errors in correct examples (spot-checked above).
- **German:** the rise is mostly genuine missing commas before subordinate clauses. That check stays on by default.
- **Arabic:** almost all fps are doubled spaces.
- **Polish and Greek:** stayed flat or fell.

The English clean-prose corpus (`tests/grammar/ReviewCorpus.test.ts`) stayed at zero findings throughout.

## What was added, per language

New rules are on by default only when they are precise. Uncertain repairs need an explicit choice (`requiresChoice`) or are left out of Fix all. Opinions and register advice are opt-in.

The lexicons are generated at build time from the bundled Hunspell dictionaries (`resources_js/<lang>/hunspell`), and some also use the bundled Presage n-gram counts. Each one has a `bun run generate:<language>-lexicon` script and a drift test, like the English lexicon. No word list was transcribed from LT.

### English

Default-on:

- **Real-word slips caught by slot:** by/buy/be, then/than, ever/every, now/know, an/and, were/where, no/not, to/too and its/your contractions decided by the class of the next word.
- **Verb groups:** forms after have, be, get, do and inverted modals; participles after perfects and passives.
- **Agreement:** subjects led by a determiner, relative-clause and comma-closed subjects, existential there/here, pairs of names, gerund subjects, and wh-subjects.
- **Missing words and noun number:** a missing `be`, noun number against determiners and counts, these/those before a singular noun.
- **One table of governed prepositions,** plus collocation slots.
- **Compounds:** joined, split and hyphenated by slot.
- **Names and capitals:** brand and name spellings, nationality and holiday capitals, the missing `the` before place names and superlatives.
- **Question tags** checked against their clause, and the `-ly` adverb for an adjective that modifies a verb.
- **New rules:** `englishDateConsistency` (weekday against a full date, impossible dates), `englishTenseConsistency` (time words and future dates against the verb tense), `englishApostrophes`, `englishNotation` (decimal commas, thousands dots, initialisms, degrees) and `englishPunctuation`.

Opt-in:

- `englishTypography`, `stylePassiveVoice`, `styleIntroductoryComma`, `styleClauseComma` (comma between two full clauses) and `englishSentenceFragment`.
- Plain-English, slang, dialect and redundancy tables; wider British usage advice; frequency-adverb placement.

Lexicon: the existing generated English lexicon was tightened (prefixes, `-ly` and `-est` readings). It stays about 133 KB.

### French

Default-on:

- `frenchSubjectVerbAgreement`: pronoun, noun, name, `ça`/`cela` and coordinated subjects, and subjects past a relative clause.
- `frenchAdjectiveAgreement`: adjectives and participles, including agreement after être and with a preceding `que` object.
- `frenchNounGender` and `frenchNounNumber`: gender and number between determiner and noun.
- `frenchVerbForms`: -é/-er/-ez, and infinitive against participle.
- `frenchHomophones`: et/est, son/sont, on/ont, où/ou, à/a, peu/peut, quand/quant, là/la, se/ce, plus sound-alike nouns inside fixed phrases.
- `frenchElision`, `frenchHyphenation` (inverted subjects, imperatives with their pronoun, and the compounds the dictionary hyphenates), `frenchMood` (subjunctive and conditional triggers), `frenchTout` and `frenchDates` (impossible dates, wrong weekdays).
- The 1990 reformed spellings without a circumflex are accepted.

Opt-in: `frenchMissingNe`, `frenchOrdinals`, and pleonasm, calque and loanword advice.

Lexicons: about 374 KB in five files from `fr_FR.dic`/`.aff`:

- an exact word graph of nouns and gender-inflecting entries, 169 KB (it replaced an approximate Bloom filter)
- verb conjugations, 143 KB
- hyphenated compounds, 50 KB
- noun genders read from the n-gram counts, 9 KB
- adjective inflection rules, 2 KB

### German

Default-on:

- `germanNounCasing`: lowercase nouns, adjectives used as nouns, superlatives and ordinals, and multi-word names.
- `germanCompounds` and `germanSuspendedHyphen`: compounds written apart, separable verbs split at the end of a clause, zu-infinitives, conjunctions and shortened compound parts.
- `germanConfusedWords`: das/dass, seit/seid, wider/wieder, look-alike words and a verb written twice.
- `germanAdjectiveForms`: endings, strong endings without an article, and the dative plural -n.
- `germanPrepositionCase`, `germanArticleGender` and `germanVerbAgreement`.
- `germanCommas`: subordinate clauses and infinitive groups.
- `germanDates`, `germanNumbers`, `germanQuotes` and `germanAbbreviations`.

Opt-in: `germanColloquial`, `germanStraightQuotes`, `germanQuestionMarks`, `germanAbbreviationSpacing`, and advice on doubled meanings.

Lexicons: about 161 KB. The nouns are a 140 KB filter cascade over `de_DE.dic`/`.aff`. Noun genders and usage come to 10 KB each, read from the n-gram counts.

### Portuguese

Default-on:

- `portugueseAccentParonyms`: an accented noun or adjective written as its unaccented verb-form twin.
- `portugueseConfusions`: crase, por que, mais/mas, há for elapsed time, and other lookalikes.
- `portugueseAgreement`: inside the noun phrase, subject and verb, existential verbs, predicate adjectives and `cujo`. It also checks the subjunctive after governing verbs and conjunctions.
- `portugueseContractions`: a preposition fused with an article or pronoun.
- `portugueseCliticPlacement`, `portugueseCommas` (asides, addressees, greetings), `portugueseDates` and `portugueseNumberFormat` (hours, ordinals, degrees, units, coordinates).

Opt-in:

- `portugueseTypographyStyle`.
- Wording advice: wordiness, idioms with plain meanings, office formulas, chat shorthand, pleonasms, spoken contractions, and neutral terms for words that demean a group.

Lexicons: about 76 KB from the pt_BR dictionary: paronyms 37 KB, finite lookalikes 23 KB and verb stems 16 KB.

### Spanish

Default-on:

- `spanishAccents`: está/esta, preterites, question words, mí/mi, sí/si, aún/aun, sé/se and stem-alternating verbs.
- `spanishConfusions`: porque/porqué/por qué, sino/si no, hacia/hacía, and a preposition before a conjugated verb.
- `spanishAgreement`: noun phrases, subject and verb, adjectives after a copula, and determiners.
- `spanishTypography`: unclosed ¿ and ¡, ordinals, unit symbols, the dialogue dash, the degree sign, and prefixes and compounds written apart.
- Impossible dates.

Opt-in: `spanishQuotes`, and redundancy and set-phrase advice.

Lexicon: 147 KB from `es_ES.dic`/`.aff` and the n-gram counts.

### Polish

Default-on:

- `polishMissingComma` and `polishMisplacedComma`.
- `polishCaseAgreement`: adjective and noun, `który`, the genitive after negation, prepositions and numerals.
- `polishNumerals`, `polishDates` (impossible days, weekdays, decades), `polishCapitalization`, `polishTypography` and `polishPrepositionForms`.
- Real-word confusion frames, `nie` joined to adjectives and participles, and closed compounds.

Opt-in: `polishQuotes`, and pleonasm, officialese and calque advice.

Lexicons: about 243 KB from `pl_PL.dic`/`.aff` and the n-gram counts: noun and adjective paradigms, 146 KB, and verb classes and words, 97 KB.

### Arabic, Greek and Swedish

- **Arabic.** Default-on:
  - `arabicAgreement`: gender after demonstratives, numbers and counted nouns, and relative pronouns.
  - `arabicDates` and `arabicCaseEndings`.
  - Slashed and Arabic-Indic dates now reach the date checks (a shared fix that helps every language).
  - Most of the Arabic gain is opt-in prescriptive usage advice (verb forms, prepositions, calques). LT enables it, but careful writers dispute much of it.
  - Lexicon: 24 KB from `ar_SA.dic`.
- **Greek:**
  - Default-on: `greekFinalNu` and `greekQuestionAccent` (πού/πώς).
  - Opt-in: `greekStrictFinalNu` and `greekPunctuation` (connector commas).
  - Checks for δεν/μην, εν with the dative and masculine determiners.
- **Swedish:**
  - `swedishAgreement`: en/ett from an 88 KB generated neuter lexicon, and de/dem.
  - `swedishTypography`, blended idioms and split compounds.

## Shared infrastructure fixes

The language work surfaced bugs that affected every user, not just the scorecard:

- **pt_BR dictionary encoding.** The bundled pt_BR Hunspell dictionary was Latin-1 while Presage passes UTF-8. Every accented Portuguese word was unknown, suggestions were garbled and lookups took seconds.
  - Converted the dictionary to UTF-8 and made the dictionary build convert on install.
  - A test keeps every bundled dictionary UTF-8.
- **`true`/`false` spelling.** Predictions were JSON-parsed, so "true", "false", "null" and numbers vanished from the dictionary and were flagged. Only quoted text expansions are parsed now.
- **Short known words.** A short known word such as "app" or "id" was flagged when more frequent completions outranked it. The lookup now searches every predictor's whole list for the typed word.
- **Spelling-suggestion speed.** Unknown words cost 150–700 ms each in pt_BR, pl_PL, el_GR and fr_FR.
  - The bundled affix files are now tuned in memory. Dictionaries without compounding skip the compound suggestion passes, and dictionaries over 2 MB skip the n-gram pass.
  - A lookup asks for each predictor's whole list at once.
  - Corpus examples over 200 ms dropped: French 208 → 59, Portuguese 218 → 37, Polish 93 → 1.
  - Typing suggestions use the same engine and got the same speed-up.
- **Unbounded lookbehinds without the regex JIT.** JavaScriptCore sometimes runs a regex on its interpreter. A lookbehind over an unbounded space run then rereads the run at every position, which is quadratic.
  - This showed up as the worst-case timing test failing only in the full suite.
  - Every language now bounds those gaps, and starts costly frames with a cheap lookahead on their own words.
  - Each language has a worst-case test that runs in a child process with the JIT off.
- **Quoted-example guard stall.** The shared guard that keeps quoted examples unflagged (`exampleCues.ts`) took every apostrophe for an opening quote and retried a long cue alternation behind each one. With the JIT off, the worst chunk took about 730 ms.
  - An apostrophe after a letter or digit no longer opens a quotation, and the cue's last word is checked first.
  - The worst chunk now takes about 150 ms with the JIT off and about 23 ms with it.
- **Cache key collision.** `NativeReviewCache` cached every single-rule detector entry. Several detectors serve the same rule, so a cached chunk could return another detector's findings. Only detectors marked `cacheable()` are cached now.
- **frameMatches overlap and prefilter.**
  - The shared frame matcher resumed after the whole match, so trailing context hid a frame starting inside it. It now resumes after the owner group. The two false positives this unmasked were fixed.
  - Its required-literal prefilter now also covers case-sensitive frames and accented Latin letters, so frames whose words are absent never run. Findings are identical in every language.
- **Detector failure isolation.** When one part of a composite detector threw, every part's findings were lost. Sibling findings are now kept, and only the failing entry's rules are reported as failed.
- **Debug-leftover guard.** Two `process.env` debug lines had slipped into English agreement detectors. `process` can be undefined in the background bundle, which would make the detector throw. The lines were removed, and `ReviewNoDebugLeftovers` keeps `process.env` reads and `console.log` out of the grammar sources.
- **Smaller fixes:**
  - Per-language abbreviation lists stop false sentence-start capitals, for example after months, titles, degrees and Roman ordinals.
  - Acronym recasing is English-only.
  - A trailing-off `..` is no longer collapsed.
  - An import cycle in the phrase index is broken.

## What remains, and why

Misses are a long tail: no single LT rule accounts for more than about 150 of any language's remaining examples. They fall into five groups.

[LanguageTool parity: decisions for the maintainer](languagetool-parity-decisions.md) lists every rule family that was skipped or only partly done. Each row gives the pros, the cons and a suggested option, and leaves the decision to the maintainer.

- **Spelling and names.** LT's typo and name rules expect one specific correction for a misspelled proper noun, brand or rare word. Review's dictionary often flags the word but offers other suggestions, or knows the name in another spelling. Polish is the clearest case: about 340 of its 745 misses are typo and spelling rules, and the bundled pl_PL dictionary accepts some word fragments as words. Names alone account for about 140 French and 75 Portuguese misses.
- **Style and opinion.** Many LT style families are register choices: formal versus colloquial wording, shortening, clarity, academic tone, pleonasms, regionalisms, anglicisms and profanity. Where FluentTyper took them on, they are opt-in. Many were left out because they would flag acceptable prose.
- **Cases where LT contradicts itself or is wrong.**
  - Some families have rules in both directions (-ize/-ise, Oxford comma, pre- and post-reform spellings), so no single setting can pass all of them.
  - Some examples expect a variant FluentTyper has no locale for: British English, European Portuguese, Swiss and Austrian German.
  - Some incorrect examples are acceptable usage. The Arabic pass deliberately skipped about 160 examples it judged wrong, ambiguous or accepted. One French style row was dropped because its phrase is correct with a complement.
- **Clock-dependent rules.** Some LT rules depend on the day the check runs:
  - a weekday checked against a date with no year, which assumes the current year (English, German, Portuguese, Spanish);
  - last year's date written in January;
  - a past verb on a date still in the future.
  - FluentTyper checks weekdays only against full dates. It handles future dates with a past verb in English (`englishTenseConsistency`) but not yet in German or Portuguese (about 50 and 7 examples). The run date changes these results, so they are poor targets.
- **Data limits.** The general rules only reach as far as their generated lexicons.
  - The German dictionary lacks some common nouns, and its noun lexicon contains some names.
  - The Spanish lexicon still misreads the word class or gender of a few common words.
  - A full Arabic part-of-speech lexicon would need about 250 KB.
  - The French spelling-suggestion floor of about 130–200 ms per unknown word needs a rebuilt Presage WASM.

By language:

- **English** (3,565 missed; 63% grammar or confusions):
  - preposition-verb and adjective-adverb slots, missing articles (off by default in LT too), a/an before plurals, agreement at the sentence start, your/you, have and been with the wrong form, collocations (93);
  - sentence fragments and frequency-adverb placement, where the opt-in checks are deliberately narrow.
- **French** (6,247 missed):
  - grammar (1,750) and homophones and paronyms (1,314) remain the largest families;
  - about a third is style: critical turns of phrase, calques, repetition, anglicisms, regionalisms and pleonasms;
  - gender agreement past the determiner is partial.
- **German** (3,892 missed):
  - casing (847) and compounding (556) cases need nouns the dictionary does not list;
  - confused words (437) and grammar (434), colloquialisms (152), and the clock-dependent date rules (66).
- **Portuguese** (3,043 missed):
  - most misses are style and register, much of it written for European Portuguese: formal register, shortening, clarity, academic tone and colloquialisms;
  - confused words (200), typography (194) and grammar (163).
- **Spanish** (958 missed): accents that need sentence-level context (266), confusions (149), misspellings (113) and noun-phrase agreement (94).
- **Polish** (745 missed): typos and spelling (336), style (106), syntax (75) and punctuation (69).
- **Arabic** (160 missed): mostly the examples skipped as wrong, ambiguous or accepted usage, and LT's own test and review categories.
- **Greek:** none missed.
- **Swedish:** one missed.

## Rerunning

The harness (`extract.ts`, `run.ts`) and its corpus live outside the repository. Point it at a FluentTyper checkout and an LT checkout. A full run of all nine languages takes a few minutes and writes per-language results plus a summary. Copy the new totals into the Snapshot section with the commit they were measured at.
