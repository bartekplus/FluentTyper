import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// Contractions split by a space, holiday names with their apostrophes, and optional plain-style
// rewrites of wordy phrases.

const S = SPACE;
const E = WORD_END;

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  // "He ll be late": the apostrophe became a space.
  ...["he", "she", "it", "they", "you", "we"].map((p): PhraseRow => [`${p} ll`, `${p}'ll`]),
  ...["I", "you", "we", "they"].map((p): PhraseRow => [`${p} ve`, `${p}'ve`]),
  ...["he", "she", "they", "you"].map((p): PhraseRow => [`${p} d`, `${p}'d`]),
  ["I m", "I'm"],
  ["you re", "you're"],
  ["they re", "they're"],
  ["we re", ["we're", "were"]],
  ...[
    "don",
    "doesn",
    "didn",
    "isn",
    "aren",
    "wasn",
    "weren",
    "haven",
    "hasn",
    "hadn",
    "couldn",
    "wouldn",
    "shouldn",
  ].map((w): PhraseRow => [`${w} t`, `${w}'t`]),
  ["can t", "can't"],
  ["won t", "won't"],
  // Holidays named after their owners.
  [["valentines day", "valentine day"], "Valentine's Day"],
  [["new years day", "new years' day"], "New Year's Day"],
  [["new years eve", "new years' eve"], "New Year's Eve"],
  ["new years resolution", "New Year's resolution"],
  ["new years resolutions", "New Year's resolutions"],
  [["mothers day", "mothers' day"], "Mother's Day"],
  [["fathers day", "fathers' day"], "Father's Day"],
  [["veteran's day", "veterans' day", "veteran day"], "Veterans Day"],
  ["all saints day", "All Saints' Day"],
  ["april fools day", "April Fools' Day"],
  [["st patricks day", "st. patricks day", "saint patricks day"], "St. Patrick's Day"],
  [["womens day", "womans day", "woman's day"], "Women's Day"],
  // Words split or joined at the wrong letter.
  ...["I a m", "we a re", "you a re", "they a re", "there a re"].map((typed): PhraseRow => [
    typed,
    typed.replace(" a ", " a"),
  ]),
  ["the re are", "there are"],
  ["the re is", "there is"],
  ["overt he", "over the"],
  ["re cent", "recent"],
  ["an then", "and then"],
  // Real words that are slips in a fixed frame.
  ["machine leaning", "machine learning"],
  [["kid regards", "kin regards"], "kind regards"],
  [["beat regards", "bets regards"], "best regards"],
  ["died in the wool", "dyed in the wool"],
  ["died-in-the-wool", "dyed-in-the-wool"],
  [["well suiting", "well suitable"], "well suited"],
  [["well-suiting", "well-suitable"], "well-suited"],
  ["pee-configured", "pre-configured"],
  ["pee-installed", "pre-installed"],
  ["add-no", "add-on"],
  ["add-nos", "add-ons"],
  ["papa new guinea", "Papua New Guinea"],
  ["papa new guinean", "Papua New Guinean"],
  ["word war", "World War"],
  ...["brother", "sister", "mother", "father", "son", "daughter"].flatMap((kin): PhraseRow[] => [
    [[`${kin}-in-laws`, `${kin}s-in-laws`], `${kin}s-in-law`],
  ]),
  ["compered to", "compared to"],
  ["compered with", "compared with"],
  ...["my", "his", "your", "our", "their"].map((owner): PhraseRow => [
    `${owner} should`,
    `${owner} shoulder`,
  ]),
  ...["has", "have", "had", "hasn't", "haven't", "hadn't"].map((aux): PhraseRow => [
    `${aux} bee`,
    `${aux} been`,
  ]),
  ["been see", "been seen"],
  ["to be see", "to be seen"],
  ["feel myself good", "feel good"],
  ["felt myself good", "felt good"],
  ["the bad new is", "the bad news is"],
  ["the good new is", "the good news is"],
  ["a was to", "a way to"],
  ["also know as", "also known as"],
  ["best know for", "best known for"],
  ["well know for", "well known for"],
  ...["am", "are", "is", "was", "were", "I'm", "you're", "we're", "they're"].map(
    (be): PhraseRow => [`${be} gong to`, `${be} going to`],
  ),
  ["Briney Spears", "Britney Spears"],
];

export const COMPOUNDS: readonly PhraseRow[] = [];

export const STYLE: readonly PhraseRow[] = [
  ["first of all", ["first", "firstly"]],
  ["little bit", ["little", "bit"]],
  [
    ["with regard to", "in regard to", "in reference to", "with reference to"],
    ["about", "regarding", "concerning"],
  ],
  ["returned back", "returned"],
  ["returns back", "returns"],
  ["returning back", "returning"],
  [["the question as to whether", "the question of whether", "as to whether"], "whether"],
  ["whether or not", "whether"],
  [["in light of the fact that", "owing to the fact that", "in view of the fact that"], "because"],
  ["by reason of", "because of"],
  [["add an additional", "add a further"], "add another"],
  ...(
    [
      ["I", "myself"],
      ["you", "yourself"],
      ["you", "yourselves"],
      ["he", "himself"],
      ["she", "herself"],
      ["we", "ourselves"],
      ["they", "themselves"],
    ] as const
  ).map(([subject, self]): PhraseRow => [`${subject} ${self}`, subject]),
];

// ---------------------------------------------------------------------------- frames

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const STYLE_RULE: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };
const info = (word: string) => englishWordInfo(word.toLowerCase());

/** The -ly adverb of an adjective, when the dictionary lists it: hasty -> hastily. */
function adverbOf(adjective: string): string | null {
  const a = adjective.toLowerCase();
  const form = a.endsWith("ic")
    ? `${a}ally`
    : /[^aeiou]y$/.test(a)
      ? `${a.slice(0, -1)}ily`
      : /[^aeiou]le$/.test(a)
        ? `${a.slice(0, -1)}y`
        : `${a}ly`;
  return info(a)?.adjective && info(form)?.adverb ? form : null;
}

// "in a hasty manner" -> "hastily"; "in a way that…" and "in a manner of speaking" stay.
const MANNER = `(?<target>in${S}an?${S}(?<adjective>[a-z]+)${S}(?:manner|way|fashion))${E}(?![ \\t\\u00a0]+(?:that|which|to|as|of|than|for|in|you|we|I|it)${E})`;
// "sent me an email" -> "emailed me".
const SEND_EMAIL = `(?<target>(?<verb>send|sends|sent|sending)${S}(?<object>me|you|him|her|us|them)${S}an${S}(?<mail>email|e-mail))${E}`;
// "is not complete" -> "is incomplete": the adjective's negative prefix form, when listed.
const NOT_ADJECTIVE = `(?:is|are|was|were|be|been|being|seems?|seemed|looks?|looked)${S}(?<target>not${S}(?<adjective>[a-z]{4,}))${E}(?![ \\t\\u00a0]+(?:enough|only|just|as|so|but)${E})`;

function frames(ctx: DetectContext): RawFinding[] {
  if (!ctx.lang.startsWith("en") || (ctx.rules && !ctx.rules.has("stylePhrasing"))) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, alternatives: string[]) => {
    const [start, end] = m.indices!.groups!.target;
    if (hasUserOrCasedWord(ctx, m[0])) return;
    const typed = ctx.text.slice(start, end);
    const cased = alternatives.map((alt) =>
      /^\p{Lu}/u.test(typed) ? alt[0].toUpperCase() + alt.slice(1) : alt,
    );
    findings.push({
      ...STYLE_RULE,
      range: { start, end },
      alternatives: cased,
      ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    });
  };
  for (const m of frameMatches(ctx, MANNER)) {
    const adverb = adverbOf(m.groups!.adjective);
    if (adverb) push(m, [adverb]);
  }
  for (const m of frameMatches(ctx, SEND_EMAIL)) {
    const { verb, object, mail } = m.groups!;
    const form = { send: "", sends: "s", sent: "ed", sending: "ing" }[verb.toLowerCase()];
    if (form === undefined) continue;
    push(m, [`${mail.toLowerCase()}${form} ${object}`]);
  }
  for (const m of frameMatches(ctx, NOT_ADJECTIVE)) {
    const adjective = m.groups!.adjective.toLowerCase();
    if (!info(adjective)?.adjective) continue;
    const negative = ["un", "in", "im", "ir", "il"]
      .map((prefix) => prefix + adjective)
      .find((word) => {
        const entry = info(word);
        return !!entry?.adjective && !entry.verbs.length;
      });
    if (negative) push(m, [negative]);
  }
  return findings;
}

// "We'Re", "don'T", "I'Ve": a capital after the apostrophe of a contraction. All capitals
// ("DON'T", "I'M") are emphasis, and "O'Neil" is no contraction ending.
const CONTRACTION_CASE =
  /(?<![\p{L}\p{N}_'’])(?<head>\p{L}+)(?<mark>['’])(?<tail>s|t|re|ve|ll|d|m)(?![\p{L}\p{N}_])/giu;

function contractionCase(ctx: DetectContext): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CONTRACTION_CASE, (match) => match.index)) {
    const { head, mark, tail } = m.groups!;
    const tailHasUpper = tail !== tail.toLowerCase();
    if (!tailHasUpper || (head === head.toUpperCase() && tail === tail.toUpperCase())) continue;
    if (ctx.dictionary.has(`${head}${mark}${tail}`.toLowerCase())) continue;
    const start = m.index + head.length + mark.length;
    findings.push({
      ruleId: "englishContractionNormalization",
      messageKey: "review_msg_contraction",
      range: { start, end: start + tail.length },
      alternatives: [tail.toLowerCase()],
      context: { start: m.index, end: start + tail.length },
    });
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["stylePhrasing"], detect: frames },
  { rules: ["englishContractionNormalization"], detect: contractionCase },
];
