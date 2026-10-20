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

## Snapshot: `lt-parity-2026-10` at `a2b93ffc`

One full run of all nine languages, spelling included, with the clock fixed at `--now=2014-06-15`, against LanguageTool `8ed25c5`. The left side of each arrow is master `6a535941`, measured with the same harness and corpus. Refresh this section with the harness when the rules change. _Detected_ counts opt-in rules too.

| Language | Incorrect | Detected (master → now) | Detected default-on | Exact (master → now) | Correct | Default-on fp | Default-on non-spelling fp |
| -------- | --------: | ----------------------: | ------------------: | -------------------: | ------: | ------------: | -------------------------: |
| en       |    10,095 |   7,342 → 7,366 (73.0%) |       6,171 → 6,196 |        6,314 → 6,328 |  14,776 | 1,615 → 1,566 |                  757 → 704 |
| fr       |     9,169 |   4,650 → 4,767 (52.0%) |       3,627 → 3,731 |        3,550 → 3,667 |  10,044 | 2,124 → 2,131 |              1,717 → 1,724 |
| de       |     7,622 |   4,836 → 4,924 (64.6%) |       4,383 → 4,424 |        4,161 → 4,247 |   4,821 |     464 → 456 |                  148 → 139 |
| pt       |     6,056 |   3,339 → 3,367 (55.6%) |       2,739 → 2,767 |        2,719 → 2,731 |   7,846 |     956 → 955 |                  434 → 433 |
| es       |     3,053 |   2,301 → 2,318 (75.9%) |       2,228 → 2,245 |        2,031 → 2,049 |   4,182 |     752 → 750 |                  442 → 440 |
| pl       |     2,143 |   1,665 → 1,683 (78.5%) |       1,412 → 1,425 |        1,425 → 1,434 |   3,112 |     129 → 127 |                    53 → 50 |
| ar       |       639 |       506 → 506 (79.2%) |           186 → 186 |            403 → 403 |     400 |       25 → 25 |                    16 → 16 |
| el       |        60 |          60 → 60 (100%) |             37 → 37 |              60 → 60 |      58 |         3 → 3 |                      0 → 0 |
| sv       |        32 |         31 → 31 (96.9%) |             23 → 23 |              29 → 29 |      13 |         1 → 1 |                      1 → 1 |
| All      |    38,869 | 24,730 → 25,022 (64.4%) |     20,806 → 21,034 |      20,692 → 20,948 |  45,252 | 6,069 → 6,014 |              3,568 → 3,507 |

- The first parity effort raised detection from 4,745 (`bda1ebe2`) to about 24,700. The 2026-10 pass added 292 more.
- The incorrect counts differ a little from the older snapshot because LT changed between `68deb137` and `8ed25c5`.
- The harness now reads LT's external entity files. Before, 66 Portuguese examples kept literal entities such as `&deg;` and could not score.
- 19 default-on non-spelling findings are new against master (15 French, 4 English). Each one marks a real error in the LT "correct" sentence, for example a subjunctive where the indicative belongs ("Je ne la voie pas") or a wrong noun number ("These measure are"). 92 old ones are gone, mostly English and German false positives that the pass fixed.

### The 2026-10 pass

Each language group first classified every default-on non-spelling finding on correct examples, then fixed the real false positives with a regression test each: English 68, German 11, French 5, Polish 4, Spanish 2, Portuguese 1. Then it added the largest missed groups that the [decisions](languagetool-parity-decisions.md) allow: new LT groups, the small open rules (item 7), the `do` rows and leftovers of working rules. New rules are on by default only when they are precise.

- **English:** article + adjective + "of" with no noun (a warning), "the/an" + "be", a missing "is" before "also/still" + adjective, "allow/permit/require" with no object before "to", these/those with a singular noun, and person questions with was/were.
- **French:** agreement with a far subject, past the determiner and past the noun, in questions, after "qui est" and after an inverted subject; the indicative and subjunctive in more clauses; more forms of "tout"; words cut by a hyphen. New opt-in rule `frenchRepeatedWords`.
- **German:** bound first parts written apart (zunichte, inne, zuteil and similar), "zu" + participle after haben, a verb capitalized after its pronoun, forms after werden, "eine Millionen" and English digit groups. New opt-in rule `germanJoinedVerbs`; a no-break space before "%" in opt-in `germanAbbreviationSpacing`.
- **Portuguese:** regular feminine forms, past and future tense against time phrases, "prestes a", "bater palmas", and an apostrophe for the decimal comma.
- **Spanish:** gender of nouns in -e and in a consonant, a pronoun subject with an adverb before the verb, a comma before "ya que" and "puesto que", spaces inside straight quotes, "hacia" phrases, ordinal gender, "porque", and "esta" before a participle.
- **Polish:** BC year ranges, decades written as "lata 1900.", a comma after a preposition, "Ad.", a dash with a space on one side, and subject case after an instrumental predicate. Opt-in: fragments and a "Czy" question that ends with a full stop.
- **Swedish:** "släppa los" and related particle forms. Arabic and Greek did not change: their remaining misses are contested advice or LT drafts.

The clean-room script of the harness checked every added string literal and every commit message against the LT corpus. Test sentences that were close to LT examples were rewritten.

**Croatian** is a FluentTyper language with a bundled dictionary, but LanguageTool has no Croatian module, so there is nothing to score. Its Review checks are unchanged by this effort apart from the shared infrastructure fixes below.

### Where the remaining non-spelling fps come from

Sentence-start capitalization on lowercase fragments dominates. LT's correct examples are often clause fragments. This accounts for about 1,190 of French's 1,724, 380 of Spanish's 440, 260 of Portuguese's 433, 155 of English's 704 and 32 of German's 139. It is the same finding a user gets when starting a sentence in lowercase, and it is not tuned to the corpus.

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

- **Spelling and names.** LT's typo and name rules expect one specific correction for a misspelled proper noun, brand or rare word. Review's dictionary often flags the word but offers other suggestions, or knows the name in another spelling. Polish is the clearest case: many of its misses are typo and spelling rules, and the bundled pl_PL dictionary accepts some word fragments as words. Names alone account for about 140 French and 75 Portuguese misses.
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

- **English** (2,729 missed):
  - preposition-verb and adjective-adverb slots, missing articles (off by default in LT too), a/an before plurals, agreement at the sentence start, your/you, have and been with the wrong form, collocations (93);
  - sentence fragments and frequency-adverb placement, where the opt-in checks are deliberately narrow.
- **French** (4,402 missed):
  - grammar (1,750) and homophones and paronyms (1,314) remain the largest families;
  - about a third is style: critical turns of phrase, calques, repetition, anglicisms, regionalisms and pleonasms;
  - gender agreement past the determiner is partial.
- **German** (2,698 missed):
  - casing (847) and compounding (556) cases need nouns the dictionary does not list;
  - confused words (437) and grammar (434), colloquialisms (152), and the clock-dependent date rules (66).
- **Portuguese** (2,689 missed):
  - most misses are style and register, much of it written for European Portuguese: formal register, shortening, clarity, academic tone and colloquialisms;
  - confused words (200), typography (194) and grammar (163).
- **Spanish** (735 missed): accents that need sentence-level context (266), confusions (149), misspellings (113) and noun-phrase agreement (94).
- **Polish** (460 missed): typos and spelling (336), style (106), syntax (75) and punctuation (69).
- **Arabic** (133 missed): mostly the examples skipped as wrong, ambiguous or accepted usage, and LT's own test and review categories.
- **Greek:** none missed.
- **Swedish:** one missed.

## Rerunning

The harness (`extract.ts`, `run.ts`) and its corpus live outside the repository. Point it at a FluentTyper checkout and an LT checkout. A full run of all nine languages takes a few minutes and writes per-language results plus a summary. Copy the new totals into the Snapshot section with the commit they were measured at.
