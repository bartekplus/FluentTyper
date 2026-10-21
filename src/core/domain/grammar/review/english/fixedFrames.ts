import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";

// Real words slipped into fixed frames: sound-alikes and one-letter slips that are words
// themselves ("walk down the isle", "looking foreword to", "a bran new car"), idioms with a
// swapped word ("add salt to injury"), and fixed verb, adjective and preposition pairings
// ("do jogging", "superior than", "take into count"). Every row is wrong as typed. The rows are
// in grammar/rules/en.yaml; this module keeps their guards.

// Rows whose words also have an ordinary reading in a frame the row cannot see: the text before
// or after the match decides. Keyed by the typed words, lowercased.
const DETERMINER_BEFORE =
  /\b(?:a|an|the|two|many|several|no|any|some|these|those|of|handle|detect|were|are|was|is)[ \t\u00a0]+$/i;
const GUARDS: Record<
  string,
  { before?: RegExp; after?: RegExp; next?: (word: string) => boolean }
> = {
  // "It was very responsible of you to call": considerate of the person, not "for".
  "responsible of": { after: /^[ \t\u00a0]+(?:you|him|her|them|us|me)\b/i },
  "responsable of": { after: /^[ \t\u00a0]+(?:you|him|her|them|us|me)\b/i },
  // "member and ETC director": a name goes on; the list ending stands last.
  "and etc": {
    after:
      /^[ \t\u00a0]+(?!(?:is|are|was|were|will|would|can|could|should|has|have|had|that|which|there|here|now|too)\b)\p{L}/iu,
  },
  // "While the boat was towed the line broke": the passive, then a new clause.
  "towed the line": { before: /\b(?:was|were|is|are|be|been|being|get|gets|got)[ \t\u00a0]+$/i },
  // "Best of all though, …"
  "all though": { before: /\bof[ \t\u00a0]+$/i },
  // "beaten up coming home"
  "up coming": {
    after: /^[ \t\u00a0]+(?:home|back|out|in|up|down|through|over|along|to|from|with)\b/i,
  },
  // "some how-to", "find some how to that"
  "some how": { after: /^(?:-|[ \t\u00a0]+to\b)/i },
  // "a wide spread of versions", "an artificially wide spread."
  "wide spread": { after: /^(?:[ \t\u00a0]+of\b|[ \t\u00a0]*(?:[.!?,;:]|$))/ },
  // "none the less true": "less" compares the next word.
  "none the less": { next: (word) => !!englishWordInfo(word)?.adjective },
  // "But I went in anyway."
  "in anyway": {
    before:
      /\b(?:went|go|goes|going|gone|came|come|comes|walked|ran|run|stepped|jumped|got|get|moved|rushed|barged|let|broke)[ \t\u00a0]+$/i,
  },
  // "Why won't my dog eat dog food?"
  // "a lat pulldown machine leaning back"
  "machine leaning": { after: /^[ \t\u00a0]+(?:back|forward|against|on|over|to)\b/i },
  // "over the whether there was just cause": a stray "the", not the weather.
  "the whether": { after: /^[ \t\u00a0]+(?:there|or|to|it|this|that|they|we|he|she|I)\b/ },
  // Sailors pay a deck or a seam with tar, and pay out a rope.
  payed: { after: /^[ \t\u00a0]+(?:out\b|the[ \t\u00a0]+(?:deck|seams?|hull)\b)/i },
  // "When did a mistake appear?": a question, not "make a mistake".
  "did a mistake": { after: /^[ \t\u00a0]+(?:appear|happen|occur|make|cause|get|go|come)\b/i },
  // "Keep quiet a while": still the adjective after keep/stay.
  "quiet a while": {
    before:
      /\b(?:keep|keeps|kept|keeping|stay|stays|stayed|staying|remain|remained|sit|sat|lie|lay)[ \t\u00a0]+$/i,
  },
  "quiet a bit": {
    before:
      /\b(?:keep|keeps|kept|keeping|stay|stays|stayed|staying|remain|remained|sit|sat|lie|lay)[ \t\u00a0]+$/i,
  },
  // "First off all animals were safe": "first off", then the subject.
  "first off all": {
    after:
      /^[ \t\u00a0]+(?!(?:I|we|you|they|he|she|it|the|my|our|let|thank|thanks|please)\b)\p{L}/iu,
  },
  "quiet a lot": { after: /^[ \t\u00a0]+of[ \t\u00a0]+times\b/i },
  "dog eat dog": {
    before:
      /\b(?:my|your|his|her|our|their|won't|will|can|did|does|do|let|make|watch|see)[ \t\u00a0]+$/i,
  },
  // A click as a noun: "a double click", "too many double clicks".
  ...Object.fromEntries(
    ["right", "left", "middle", "double"].flatMap((side) =>
      ["click", "clicks"].map((click) => [`${side} ${click}`, { before: DETERMINER_BEFORE }]),
    ),
  ),
};

/** True when a phrase row's text sits in a frame that gives its words their ordinary reading. */
export function rowGuarded(text: string, typed: string, start: number, end: number): boolean {
  // "serve(d)" continues the word; "Free Reign Entertainment" is a company's name.
  if (text[end] === "(") return true;
  if (
    /^\p{Lu}/u.test(typed) &&
    /^[ \t\u00a0]+(?:Entertainment|Inc|Ltd|Group|Records|Studios?|Productions|Media|Company|Corp|LLC)\b/.test(
      text.slice(end, end + 20),
    )
  )
    return true;
  const guard = GUARDS[typed.toLowerCase().replace(/[ \t\u00a0]+/g, " ")];
  if (!guard) return false;
  return (
    (!!guard.before && guard.before.test(text.slice(Math.max(0, start - 24), start))) ||
    (!!guard.after && guard.after.test(text.slice(end, end + 24))) ||
    (!!guard.next && guard.next(/^[ \t\u00a0]+([a-z]+)/.exec(text.slice(end, end + 24))?.[1] ?? ""))
  );
}
