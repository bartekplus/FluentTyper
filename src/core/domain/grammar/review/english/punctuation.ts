import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { namedExampleBefore } from "../exampleCues";
import { quotedMention } from "./grammarStyle1";

// English commas and stray marks.
// englishPunctuation (on by default): a comma right before a sentence mark (",." ",!"), a comma
// inside a closing parenthesis (",)"), a comma splitting "neither … nor" or an indirect
// question from its verb ("Do you know, if").
// styleIntroductoryComma (optional): the comma after an opening linking word ("However",
// "In addition"), between an opening phrase and its clause ("With it I can" -> "With it, I"),
// after a condition ("If I can I will"), and before a name addressed ("Thanks Tom").

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const S = SPACE;
const E = WORD_END;
type Finding = RawFinding;

/** Matches of a global regex starting in [from, to), outside named examples. */
function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText))
    if (m.index >= ctx.from && !namedExampleBefore(ctx.text, m.index)) yield m;
}

// ---------------------------------------------------------------------------- englishPunctuation

const COMMA_MARK = /(?<=\p{L}|\p{N}|[)"”’])[,;](?=[.!?](?!\.))/gu;
const COMMA_PAREN = /(?<=[\p{L}\p{N}]),\)/gu;
// "neither rich, nor poor": two items take no comma.
const NEITHER =
  /\bneither\b(?<items>[^,.;:!?\n]{1,60}),(?=[  ]+nor\b(?![^.;:!?\n]*,[  ]*nor\b))/giu;
const INDIRECT = `(?<lead>let me know|let us know|I wonder|I'm wondering|I am wondering|I was wondering|I don't know|I do not know|do you know|does anyone know|does anybody know|I'm not sure|I am not sure)(?<comma>,)${S}(?:if|whether|who|what|where|when|why|how)${E}`;
const POLITE_IF = `(?:would be (?:great|nice|good|helpful|wonderful)|would appreciate it|would be grateful|would you mind)(?<comma>,)${S}if${S}(?:you|we|I|someone|anyone|somebody|anybody)${E}`;

function punctuation(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  const add = (start: number, end: number, alternatives: string[]) =>
    out.push({
      ruleId: "englishPunctuation",
      messageKey: "review_msg_stray_comma",
      range: { start, end },
      alternatives,
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  for (const m of owned(ctx, COMMA_MARK)) add(m.index, m.index + 1, [""]);
  for (const m of owned(ctx, COMMA_PAREN)) add(m.index, m.index + 2, ["),", ")"]);
  for (const m of owned(ctx, NEITHER)) {
    const start = m.index + m[0].length - 1;
    add(start, start + 1, [""]);
  }
  for (const pattern of [INDIRECT, POLITE_IF])
    for (const m of frameMatches(ctx, pattern, "comma")) {
      const [start] = m.indices!.groups!.comma;
      add(start, start + 1, [""]);
    }
  return out;
}

// ---------------------------------------------------------------------------- styleIntroductoryComma

const LINKING =
  "However|Nonetheless|Nevertheless|Besides|Alas|Similarly|Also|Furthermore|Moreover|Therefore|" +
  "Consequently|Meanwhile|Otherwise|Additionally|Finally|Firstly|Secondly|Lastly|Unfortunately|" +
  "Fortunately|Of course|For example|For instance|In fact|In addition|In conclusion|In summary|" +
  "On the other hand|As a result|In other words|By default|That said|Indeed|Instead|Likewise";
const OPENER = new RegExp(
  `(?<=(?:^|[.!?]["”’)]?[ \\t\\u00a0]+|\\n[ \\t\\u00a0]*))(?<w>${LINKING})(?<gap>[ \\t\\u00a0]+)(?<next>[\\p{L}]+)`,
  "gu",
);
// "However large errors can occur" reads as "in whatever way large": only before a subject.
const SUBJECT_STARTS = new Set(
  "I you he she it we they this that these those there the a an my your his her our their its".split(
    " ",
  ),
);
const OBJECT = "it|you|me|him|her|them|us";
const SUBJECT = "I|we|you|they|he|she|it";
const PREPOSITIONS = "with|for|to|at|about|on|in|by|after|around|from|into|without|like";
// "With it I can", "if you work at it you can": a phrase ending in an object pronoun, then a
// new subject with its verb.
const PHRASE_THEN_CLAUSE = `(?:${PREPOSITIONS})${S}(?<obj>${OBJECT})(?<gap>${S})(?<subject>${SUBJECT})${S}(?<verb>[a-z]+(?:['’][a-z]+)?)${E}`;
// "If I can I will", "If it does it usually is": a short condition, then the main clause.
const CONDITION = `(?<lead>If|if)${S}(?:${SUBJECT})${S}(?<aux>can|can['’]t|cannot|could|couldn['’]t|does|doesn['’]t|do|don['’]t|did|didn['’]t|is|isn['’]t|was|wasn['’]t|will|won['’]t|would|wouldn['’]t|have|haven['’]t|has|hasn['’]t)(?:${S}not)?(?<gap>${S})(?<subject>${SUBJECT}|we['’]ll|I['’]ll|you['’]ll|they['’]ll|it['’]ll|I['’]m)${E}`;
const NAME_ADDRESS = `(?<w>Thanks|Thank you|Hi|Hello|Hey there|Happy Birthday|Good morning|Good night)(?<gap>${S})(?<name>[A-Za-z]+)${E}`;
const NOT_NAMES = new Set(
  "again all everyone everybody guys folks so very for to and you".split(" "),
);
const FINITE = new Set(
  "am is are was were have has had do does did will would can could should may might must need want think know see get got noticed figured created mean like became".split(
    " ",
  ),
);

function introductoryCommas(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  // The comma goes before the space after the phrase.
  const add = (start: number, gap: string) =>
    out.push({
      ruleId: "styleIntroductoryComma",
      messageKey: "review_msg_introductory_comma",
      range: { start, end: start + gap.length },
      alternatives: [`,${gap}`],
    });
  for (const m of owned(ctx, OPENER)) {
    const { w, next } = m.groups!;
    if (w === "However" && !SUBJECT_STARTS.has(next.toLowerCase())) continue;
    // "Also known as", "Finally done": an adverb modifying the next word.
    if (
      englishWordInfo(next)?.verbs.some((v) => v.form === "participle") &&
      !SUBJECT_STARTS.has(next.toLowerCase())
    )
      continue;
    add(m.index + w.length, m.groups!.gap);
  }
  for (const m of frameMatches(ctx, PHRASE_THEN_CLAUSE, "gap")) {
    const verb = m.groups!.verb.toLowerCase();
    const read = englishWordInfo(verb);
    if (!FINITE.has(verb) && !/['’]/.test(verb) && !read?.verbs.some((v) => v.form !== "ing"))
      continue;
    add(m.indices!.groups!.gap[0], m.groups!.gap);
  }
  for (const m of frameMatches(ctx, CONDITION, "gap")) {
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    // "If" opens its sentence or follows a comma.
    if (
      m.index > 0 &&
      !/(?:[.!?,;:]["”’)]?[ \t ]+|\n|^)$/.test(ctx.text.slice(0, m.index).slice(-4)) &&
      before.trim()
    )
      continue;
    add(m.indices!.groups!.gap[0], m.groups!.gap);
  }
  for (const m of frameMatches(ctx, NAME_ADDRESS, "gap")) {
    const name = m.groups!.name;
    // The frame ignores case; a name is capitalized.
    if (!/^[A-Z][a-z]+$/.test(name)) continue;
    // "Thanks Again", "Thank you Very much": a capitalized ordinary word, not a name.
    const read = englishWordInfo(name.toLowerCase());
    if (read?.adverb || read?.adjective || NOT_NAMES.has(name.toLowerCase())) continue;
    add(m.indices!.groups!.gap[0], m.groups!.gap);
  }
  return out;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (detect: (ctx: DetectContext) => Finding[]) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US" ? [] : detect(ctx).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishPunctuation"], detect: english(punctuation) },
  { rules: ["styleIntroductoryComma"], detect: english(introductoryCommas) },
];
