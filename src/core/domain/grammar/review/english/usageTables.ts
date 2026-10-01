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

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["stylePhrasing"], detect: frames },
];
