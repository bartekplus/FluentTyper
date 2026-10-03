import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { namedExampleBefore } from "../exampleCues";
import { quotedMention } from "./grammarStyle1";
import { finding } from "../finding";

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

// "She isn't coming is she?": a question tag; "I found it thanks.": a closing thanks.
// A tag pairs a negative auxiliary with a positive statement ("isn't she?") or a positive one
// with a negative statement ("is she?"); "do it?" ends in an object, not a tag.
const TAG =
  /(?<=[\p{L}\p{N}])(?<gap>[ \t ]+)(?:(?<neg>isn't|wasn't|aren't|weren't|don't|doesn't|didn't|won't|wouldn't|can't|couldn't|haven't|hasn't|shouldn't)[ \t ]+(?:I|you|he|she|it|we|they|there)|(?<pos>is|was|are|were|do|does|did|will|would|can|could|have|has|should)[ \t ]+(?:I|you|he|she|we|they|there|it(?<=(?:is|was)[ \t ]+it)))[ \t ]*\?/gu;
const QUESTION_OPENING =
  /^(?:is|isn't|was|wasn't|are|aren't|were|weren't|do|don't|does|doesn't|did|didn't|will|won't|would|wouldn't|can|can't|could|couldn't|have|haven't|has|hasn't|should|shouldn't|shall|may|might|must|what|who|whom|whose|which|where|when|why|how)\b/i;
// "I found it thanks.", "Sounds good thanks.": a short reply, then its thanks.
const CLOSING_THANKS = /(?<=[\p{L}\p{N}])(?<gap>[ \t\u00a0]+)thanks(?=[ \t\u00a0]*[.!])/giu;
const BEFORE_THANKS = new Set(
  "it that this them good great perfect fine awesome helpful nice cool works worked helped helps done fixed".split(
    " ",
  ),
);

function asideCommas(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  const add = (start: number, gap: string) =>
    out.push(
      finding("styleClauseComma", "review_msg_aside_comma", start, start + gap.length, [
        `,${gap.replace(/^[ \t ]*/, " ")}`,
      ]),
    );
  for (const m of owned(ctx, TAG)) {
    // The statement before the tag opens its sentence with neither an auxiliary nor a wh-word.
    const before = ctx.text.slice(Math.max(0, m.index - 200), m.index);
    const cut = Math.max(...[...".!?\n￼"].map((c) => before.lastIndexOf(c)));
    const sentence = before.slice(cut + 1).trim();
    if (!sentence || QUESTION_OPENING.test(sentence) || /,$/.test(sentence)) continue;
    // "Guess who is it?", "I wonder what is it?": an embedded question, not a tag.
    if (
      /\b(?:who|what|which|where|when|why|how|whether|if|than|as|so|that|because)$/i.test(sentence)
    )
      continue;
    if (!/\b(?:I|you|he|she|it|we|they|there|this|that)\b|^\p{Lu}/u.test(sentence)) continue;
    const negative = /n['’]t\b|\bnot\b|\bnever\b/i.test(sentence);
    if (m.groups!.neg ? negative : !negative) continue;
    add(m.index, m.groups!.gap);
  }
  for (const m of owned(ctx, CLOSING_THANKS)) {
    const word = /([\p{L}\p{N}']+)$/u.exec(ctx.text.slice(Math.max(0, m.index - 24), m.index))?.[1];
    if (!word || !BEFORE_THANKS.has(word.toLowerCase())) continue;
    // The sentence before has a verb or is a reply ("Sounds good thanks").
    add(m.index, m.groups!.gap);
  }
  return out;
}

function punctuation(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  const add = (start: number, end: number, alternatives: string[]) =>
    out.push(
      finding("englishPunctuation", "review_msg_stray_comma", start, end, alternatives, {
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      }),
    );
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
// Bounded gaps: an unbounded run in the lookbehind is reread at every position of a long run
// of spaces (quadratic, and 100+ ms a chunk once JavaScriptCore runs the regex interpreted).
const OPENER = new RegExp(
  `(?<=(?:^|[.!?]["”’)]?[ \\t\\u00a0]{1,8}|\\n[ \\t\\u00a0]{0,8}))(?<w>${LINKING})(?<gap>[ \\t\\u00a0]+)(?<next>[\\p{L}]+)`,
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

// ---------------------------------------------------------------------------- styleClauseComma

// "I voted early and I plan to vote again" -> "early, and I": two complete clauses joined by a
// coordinator take a comma. Both sides must read as clauses: the first opens with its subject
// and has a finite verb; the second opens with a subject and its verb, an inverted question,
// or "please" + a request.
const JOINERS =
  /(?<=[\p{L}\p{N}%)'’])(?<gap>[ \t\u00a0]+)(?<conj>and|but|or|so|yet|although)(?=[ \t\u00a0])/gu;
const CLAUSE_WORD = /[\p{L}\p{N}$][\p{L}\p{N}'’$.&/-]*/gu;
// A clause boundary: a sentence mark before a capital, other stops, a comma or protected text.
const CLAUSE_BREAK = /[.!?]["”’)]*(?=[ \t\u00a0]+["“(]?\p{Lu}|$)|[;:\n\uFFFC]|,(?!\d)/gu;
const AUX = new Set(
  "am is are was were has have had do does did will would can could shall should may might must isn't aren't wasn't weren't hasn't haven't hadn't don't doesn't didn't won't wouldn't can't cannot couldn't shouldn't mustn't".split(
    " ",
  ),
);
const SUBJECTS = new Set("i you he she we they it".split(" "));
const OPENING_SUBJECTS = new Set(
  "i you he she it we they this that there these those the my your his her our their its some most many all both each every no one nobody everyone everybody someone somebody nothing everything something".split(
    " ",
  ),
);
const DETERMINERS = new Set(
  "the my your his her our their its this these those some every each no most many several".split(
    " ",
  ),
);
// A subordinate opening or an embedded clause makes the coordinator ambiguous: "I think Tom and
// I agree", "Tell me if you go and I will come". Only when a clause follows the word.
const SUBORDINATE = new Set(
  "if whether when whenever because since while although though unless until till before after where which who whom whose what how why than once either neither between whereas that think thought believe believed know knew guess hope hoped say said says feel felt suppose expect mean wonder wondered realize realized assume assumed heard tell told sure wish".split(
    " ",
  ),
);
// After a subordinator these leave nothing for it to govern: "I know that", "once before".
const INERT = new Set("it that this them so too then before yet again now".split(" "));
// Words that cannot end a complete first clause before the coordinator.
const NOT_CLAUSE_END = new Set(
  "to of for with at by from in on into about as the a an my your his her our their its both either neither between than rather more less not just only even very too so and or but i he she we they".split(
    " ",
  ),
);
const LEAD_ADVERBS = new Set(
  "so therefore then again hopefully instead now thus still also immediately honestly".split(" "),
);
const MID_ADVERBS = new Set(
  "often just really also never already still always only actually probably usually even then all both".split(
    " ",
  ),
);
const WH = new Set("what why how when where who which".split(" "));
const POLITE_OPENING = /^(?:thank you|thanks|sorry|pardon me|excuse me)\b/i;
const CONTRACTED =
  /^[\p{L}]+'(?:m|re|ve|ll|d)$|^(?:it|he|she|that|there|what|who|here|let)'s$|n't$/iu;
const PURPOSE = /^(?:can|could|may|might|would|will|won't|wouldn't|can't|couldn't)$/;

const words = (text: string): string[] =>
  [...text.matchAll(CLAUSE_WORD)].map((m) => m[0].replace(/’/g, "'"));
const adverb = (word: string) => MID_ADVERBS.has(word) || /^[a-z]{3,}ly$/.test(word);

/** The word reads as a finite verb after the subject word `subject`. */
function finiteVerb(word: string, subject: string | undefined, opening: boolean): boolean {
  const lower = word.toLowerCase();
  if (AUX.has(lower) || CONTRACTED.test(lower)) return true;
  if (subject && DETERMINERS.has(subject)) return false;
  const verbs = englishWordInfo(lower)?.verbs ?? [];
  if (verbs.some((v) => v.form === "past")) return true;
  if (subject && SUBJECTS.has(subject))
    return verbs.some((v) => v.form === (/^(?:he|she|it)$/.test(subject) ? "third" : "base"));
  // "Something happens", "The plug works": a -s verb right after a one-word opening subject.
  return opening && verbs.some((v) => v.form === "third");
}

/** Index of the word governing position i, skipping adverbs in between. */
function subjectBefore(lower: string[], i: number): number {
  let at = i - 1;
  while (at > 0 && adverb(lower[at])) at--;
  return at;
}

/** The text before the coordinator reads as a complete clause with its own subject and verb. */
function firstClause(segment: string, conj: string, question: boolean): boolean {
  let ws = words(segment);
  if (/^(?:and|but|or|so|yet|then)$/i.test(ws[0] ?? "")) ws = ws.slice(1);
  const lower = ws.map((w) => w.toLowerCase());
  const polite = POLITE_OPENING.test(lower.join(" "));
  // "I'm 27" counts as three words.
  const size = ws.length + lower.filter((w) => CONTRACTED.test(w)).length;
  if (size < 2 && !polite) return false;
  const last = lower[lower.length - 1];
  if (NOT_CLAUSE_END.has(last) || AUX.has(last)) return false;
  for (let i = question ? 1 : 0; i < lower.length; i++)
    if (SUBORDINATE.has(lower[i]) && lower.slice(i + 1).some((w) => !INERT.has(w))) return false;
  if (conj === "so" && lower.some((w) => w === "so" || w === "such")) return false;
  if (conj === "yet" && lower.some((w) => w === "not" || w.endsWith("n't"))) return false;
  if (polite) return true;
  // An imperative ("Rake the leaves and we'll burn them") has no subject of its own.
  const head = lower[0];
  const asks = question && (AUX.has(head) || WH.has(head));
  if (!asks && !OPENING_SUBJECTS.has(head)) {
    if (!/^\p{Lu}/u.test(ws[0])) return false;
    // An all-capitals acronym ("BOD") is a name, not a verb.
    const verbs = /^\p{Lu}+$/u.test(ws[0]) ? [] : (englishWordInfo(head)?.verbs ?? []);
    if (verbs.some((v) => v.form === "base") && !finiteVerb(ws[1], undefined, false)) return false;
  }
  if (asks || CONTRACTED.test(head)) return true;
  return ws.some((w, i) => {
    if (i === 0) return false;
    const at = subjectBefore(lower, i);
    return finiteVerb(w, lower[at], at === 0);
  });
}

/** The text after the coordinator opens a complete clause. */
function secondClause(rest: string, conj: string, question: boolean): boolean {
  let ws = words(rest);
  if (conj !== "so" && LEAD_ADVERBS.has(ws[0]?.toLowerCase())) ws = ws.slice(1);
  const lower = ws.map((w) => w.toLowerCase());
  if (ws.length < 2) return false;
  // "and I was too", "but she wasn't either": an elliptical echo, not a full clause.
  if (ws.length <= 4 && /^(?:too|either|neither)$/.test(lower[ws.length - 1])) return false;
  const [first, second] = lower;
  if (conj === "although") return subjectAndVerb(ws, lower, conj);
  if (first === "please") {
    const verb = lower[adverb(second) ? 2 : 1];
    return englishWordInfo(verb ?? "")?.verbs.some((v) => v.form === "base") ?? false;
  }
  // "and thanks for", "so apologies for".
  if (/^(?:thanks|sorry|apologies)$/.test(first) && second === "for") return true;
  if (question) {
    const at = WH.has(first) ? 1 : 0;
    const next = lower[at + 1];
    if (AUX.has(lower[at]) && next && (at === 1 || SUBJECTS.has(next) || DETERMINERS.has(next)))
      return true;
  }
  return subjectAndVerb(ws, lower, conj);
}

function subjectAndVerb(ws: string[], lower: string[], conj: string): boolean {
  const [first, second] = lower;
  if (first === "there") return AUX.has(second);
  if (CONTRACTED.test(first) && !first.endsWith("n't"))
    // "so I'll", "so you'd" usually state a purpose.
    return !(conj === "so" && /'(?:ll|d)$/.test(first));
  if (SUBJECTS.has(first) || /^th(?:is|ese|ose)$/.test(first)) {
    const at = adverb(second) ? 2 : 1;
    const verb = lower[at];
    if (!verb || !finiteVerb(ws[at], SUBJECTS.has(first) ? first : "it", false)) return false;
    // "so I can see", "so they would know": a purpose clause, no comma.
    return !(conj === "so" && PURPOSE.test(verb));
  }
  // "and the game was", "but its owners left", "but Google isn't": a short subject and a verb.
  // "so Max's sister is happy" may state a purpose: "so" takes only a pronoun subject.
  const named = /^\p{Lu}/u.test(ws[0]) && !SUBJECTS.has(first);
  if (conj !== "so" && (DETERMINERS.has(first) || named || /'s?$/.test(first))) {
    for (let at = 1; at <= 5 && at < lower.length; at++) {
      const word = lower[at];
      if (AUX.has(word) || CONTRACTED.test(word)) return !(conj === "so" && PURPOSE.test(word));
      if (adverb(word)) continue;
      const read = englishWordInfo(word);
      if (at > 1 && read?.verbs.some((v) => v.form === "past" || v.form === "third"))
        return read.noun !== true || read.verbs.some((v) => v.form === "past");
      // Unknown words, possessives and -ing modifiers can sit in the subject phrase.
      if (NOT_CLAUSE_END.has(word) || /^(?:that|who|which|whose)$/.test(word)) return false;
      if (read && !read.noun && !read.adjective && !/'s?$|ing$/.test(word)) return false;
    }
  }
  return false;
}

const NEXT = /[ \t ]+([\p{L}'’]+)/uy;
/** Cheap gate before any clause reading: the word after the coordinator can open a clause. */
function opensClause(text: string, at: number): boolean {
  NEXT.lastIndex = at;
  const word = NEXT.exec(text)?.[1];
  if (!word) return false;
  const lower = word.toLowerCase().replace(/’/g, "'");
  return (
    /^\p{Lu}|'/u.test(word) ||
    SUBJECTS.has(lower) ||
    DETERMINERS.has(lower) ||
    LEAD_ADVERBS.has(lower) ||
    WH.has(lower) ||
    AUX.has(lower) ||
    /^(?:there|please|thanks|sorry|apologies)$/.test(lower)
  );
}

// "The older we get the wiser we are", "The sooner the better": a comma ends the first half.
const CORRELATIVE = `(?<![\\p{L}'’])[Tt]he${S}(?:more|less|fewer|[a-z]{2,}er)(?:${S}(?:I|we|you|he|she|they|it|one|people)${S}(?<verb>[a-z]+))?(?<gap>${S})the${S}(?:more|less|fewer|[a-z]{2,}er)${E}`;

function correlativeCommas(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  for (const m of frameMatches(ctx, CORRELATIVE, "gap")) {
    const words = m[0].toLowerCase().split(/[ \t ]+/);
    // Comparatives only: "the other the", "the water the" are no pair.
    const compared = [words[1], words[words.length - 1]].every(
      (w) =>
        /^(?:more|less|fewer)$/.test(w) ||
        /^(?:bett|wors|old|young|fast|slow|big|small|great|high|low|long|short|soon|late|earl|hard|easi|cheap|strong|weak|rich|poor|far|near|wid|tall|heavi|light|happi|harder|warm|cold|hot|loud|quiet)/.test(
          w,
        ),
    );
    if (
      !compared ||
      /^(?:other|another|water|paper|number|order|matter|under|over|after|never|ever|either|neither|together)$/.test(
        words[1],
      )
    )
      continue;
    const [start] = m.indices!.groups!.gap;
    out.push(
      finding("styleClauseComma", "review_msg_clause_comma", start, start + m.groups!.gap.length, [
        `,${m.groups!.gap}`,
      ]),
    );
  }
  return out;
}

function clauseCommas(ctx: DetectContext): Finding[] {
  const out: Finding[] = [...correlativeCommas(ctx), ...asideCommas(ctx)];
  for (const m of owned(ctx, JOINERS)) {
    const { gap, conj } = m.groups!;
    const after = m.index + gap.length + conj.length;
    if (!opensClause(ctx.text, after)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 256), m.index);
    let cut = 0;
    for (const b of before.matchAll(CLAUSE_BREAK)) cut = b.index + b[0].length;
    if (conj === "so" && /^[ \t\u00a0]+that\b/i.test(ctx.text.slice(after, after + 8))) continue;
    const tail = ctx.text.slice(after, after + 240);
    const end = tail.search(/[.!?;:,\n\uFFFC]/);
    const rest = end < 0 ? tail : tail.slice(0, end);
    const question = /^[^.!\n]*\?/.test(tail);
    if (!firstClause(before.slice(cut), conj, question)) continue;
    if (!secondClause(rest, conj, question)) continue;
    // "you and I went": a coordinated subject, not two clauses.
    if (/\byou$/i.test(before) && !/thank you$/i.test(before) && /^[ \t\u00a0]*I\b/.test(tail))
      continue;
    out.push(
      finding("styleClauseComma", "review_msg_clause_comma", m.index, m.index + gap.length, [
        `,${gap}`,
      ]),
    );
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
  { rules: ["styleClauseComma"], detect: english(clauseCommas) },
];
