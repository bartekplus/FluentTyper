import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { RawFinding } from "../reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import { quotedMention } from "./grammarStyle1";
import { finding } from "../finding";

// English commas and stray marks; grammar/rules/en.yaml holds their frames.
// englishPunctuation (on by default): a comma right before a sentence mark (",." ",!"), a comma
// inside a closing parenthesis (",)"), a comma splitting "neither … nor" or an indirect
// question from its verb ("Do you know, if").
// styleIntroductoryComma (optional): the comma after an opening linking word ("However",
// "In addition"), between an opening phrase and its clause ("With it I can" -> "With it, I"),
// after a condition ("If I can I will"), and before a name addressed ("Thanks Tom").

type Finding = RawFinding;

// ---------------------------------------------------------------------------- englishPunctuation

const ABBREVIATION = /^(?:etc|inc|ltd|corp|approx|vol|eds|misc|dept|est|fig|ibid|viz|incl)$/;
// Set phrases that end with a period: "What do you know.", "How do you do.", and a
// suggestion "Why don't you call her first."
const NOT_A_QUESTION = /^(?:What do you know\.$|How do you do\.$|Why don['’]t (?:you|we)\b)/;

const QUESTION_OPENING =
  /^(?:is|isn't|was|wasn't|are|aren't|were|weren't|do|don't|does|doesn't|did|didn't|will|won't|would|wouldn't|can|can't|could|couldn't|have|haven't|has|hasn't|should|shouldn't|shall|may|might|must|what|who|whom|whose|which|where|when|why|how)\b/i;
const BEFORE_THANKS = new Set(
  "it that this them good great perfect fine awesome helpful nice cool works worked helped helps done fixed".split(
    " ",
  ),
);

// ---------------------------------------------------------------------------- styleIntroductoryComma

// "However large errors can occur" reads as "in whatever way large": only before a subject.
const SUBJECT_STARTS = new Set(
  "I you he she it we they this that these those there the a an my your his her our their its".split(
    " ",
  ),
);
const NOT_NAMES = new Set(
  "again all everyone everybody guys folks so very for to and you".split(" "),
);
const FINITE = new Set(
  "am is are was were have has had do does did will would can could should may might must need want think know see get got noticed figured created mean like became".split(
    " ",
  ),
);

// ---------------------------------------------------------------------------- styleClauseComma

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

// CLAUSE_WORD reads ' and ’ alike: one replace before the match spares one per word.
const words = (text: string): string[] => text.replace(/’/g, "'").match(CLAUSE_WORD) ?? [];
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

const stray = (start: number, end: number, alternatives: string[]): Finding =>
  finding("englishPunctuation", "review_msg_stray_comma", start, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
const aside = (start: number, gap: string): Finding =>
  finding("styleClauseComma", "review_msg_aside_comma", start, start + gap.length, [
    `,${gap.replace(/^[ \t ]*/, " ")}`,
  ]);
// The comma goes before the space after the phrase.
const introductory = (start: number, gap: string): Finding => ({
  ruleId: "styleIntroductoryComma",
  messageKey: "review_msg_introductory_comma",
  range: { start, end: start + gap.length },
  alternatives: [`,${gap}`],
});
const atGap = (m: RegExpExecArray) => introductory(m.indices!.groups!.gap[0], m.groups!.gap);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  punctuationCommaMark: (m) => stray(m.index, m.index + 1, [""]),
  punctuationCommaParen: (m) => stray(m.index, m.index + 2, ["),", ")"]),
  punctuationPeriodQuotePeriod: (m) =>
    ABBREVIATION.test(m.groups!.word)
      ? null
      : finding("englishPunctuation", "review_msg_duplicate_punctuation", m.index, m.index + 1, [
          "",
        ]),
  punctuationWhQuestion: (m) => {
    if (NOT_A_QUESTION.test(m[0])) return null;
    const at = m.index + m[0].length - 1;
    return finding("englishPunctuation", "review_msg_question_mark", at, at + 1, ["?"]);
  },
  punctuationLastMark: (m) => {
    const start = m.index + m[0].length - 1;
    return stray(start, start + 1, [""]);
  },
  punctuationComma: (m) => {
    const [start] = m.indices!.groups!.comma;
    return stray(start, start + 1, [""]);
  },
  introductoryOpener: (m) => {
    const { w, next } = m.groups!;
    if (w === "However" && !SUBJECT_STARTS.has(next.toLowerCase())) return null;
    // "Also known as", "Finally done": an adverb modifying the next word.
    if (
      englishWordInfo(next)?.verbs.some((v) => v.form === "participle") &&
      !SUBJECT_STARTS.has(next.toLowerCase())
    )
      return null;
    return introductory(m.index + w.length, m.groups!.gap);
  },
  introductoryPhrase: (m) => {
    const verb = m.groups!.verb.toLowerCase();
    const read = englishWordInfo(verb);
    if (!FINITE.has(verb) && !/['’]/.test(verb) && !read?.verbs.some((v) => v.form !== "ing"))
      return null;
    return atGap(m);
  },
  introductoryCondition: (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    // "If" opens its sentence or follows a comma.
    if (
      m.index > 0 &&
      !/(?:[.!?,;:]["”’)]?[ \t ]+|\n|^)$/.test(ctx.text.slice(0, m.index).slice(-4)) &&
      before.trim()
    )
      return null;
    return atGap(m);
  },
  introductoryGreeting: (m) => introductory(m.index + m.groups!.w.length, m.groups!.gap),
  introductoryIForOne: (m) => ({
    ruleId: "styleIntroductoryComma",
    messageKey: "review_msg_introductory_comma",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [`I, for one,`],
  }),
  introductoryNameAddress: (m) => {
    const name = m.groups!.name;
    // The frame ignores case; a name is capitalized.
    if (!/^[A-Z][a-z]+$/.test(name)) return null;
    // "Thanks Again", "Thank you Very much": a capitalized ordinary word, not a name.
    const read = englishWordInfo(name.toLowerCase());
    if (read?.adverb || read?.adjective || NOT_NAMES.has(name.toLowerCase())) return null;
    return atGap(m);
  },
  clauseCorrelative: (m) => {
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
      return null;
    const [start] = m.indices!.groups!.gap;
    return finding(
      "styleClauseComma",
      "review_msg_clause_comma",
      start,
      start + m.groups!.gap.length,
      [`,${m.groups!.gap}`],
    );
  },
  clauseTag: (m, ctx) => {
    // The statement before the tag opens its sentence with neither an auxiliary nor a wh-word.
    const before = ctx.text.slice(Math.max(0, m.index - 200), m.index);
    const cut = Math.max(...[...".!?\n￼"].map((c) => before.lastIndexOf(c)));
    const sentence = before.slice(cut + 1).trim();
    if (!sentence || QUESTION_OPENING.test(sentence) || /,$/.test(sentence)) return null;
    // "Guess who is it?", "I wonder what is it?": an embedded question, not a tag.
    if (
      /\b(?:who|what|which|where|when|why|how|whether|if|than|as|so|that|because)$/i.test(sentence)
    )
      return null;
    if (!/\b(?:I|you|he|she|it|we|they|there|this|that)\b|^\p{Lu}/u.test(sentence)) return null;
    const negative = /n['’]t\b|\bnot\b|\bnever\b/i.test(sentence);
    if (m.groups!.neg ? negative : !negative) return null;
    return aside(m.index, m.groups!.gap);
  },
  clauseClosingThanks: (m, ctx) => {
    const word = /([\p{L}\p{N}']+)$/u.exec(ctx.text.slice(Math.max(0, m.index - 24), m.index))?.[1];
    if (!word || !BEFORE_THANKS.has(word.toLowerCase())) return null;
    // The sentence before has a verb or is a reply ("Sounds good thanks").
    return aside(m.index, m.groups!.gap);
  },
  clauseJoiner: (m, ctx) => {
    const { gap, conj } = m.groups!;
    const after = m.index + gap.length + conj.length;
    if (!opensClause(ctx.text, after)) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 256), m.index);
    let cut = 0;
    for (const b of before.matchAll(CLAUSE_BREAK)) cut = b.index + b[0].length;
    if (conj === "so" && /^[ \t ]+that\b/i.test(ctx.text.slice(after, after + 8))) return null;
    const tail = ctx.text.slice(after, after + 240);
    const end = tail.search(/[.!?;:,\n￼]/);
    const rest = end < 0 ? tail : tail.slice(0, end);
    const question = /^[^.!\n]*\?/.test(tail);
    if (!firstClause(before.slice(cut), conj, question)) return null;
    if (!secondClause(rest, conj, question)) return null;
    // "you and I went": a coordinated subject, not two clauses.
    if (/\byou$/i.test(before) && !/thank you$/i.test(before) && /^[ \t ]*I\b/.test(tail))
      return null;
    return finding("styleClauseComma", "review_msg_clause_comma", m.index, m.index + gap.length, [
      `,${gap}`,
    ]);
  },
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  /** US English only; findings inside a quoted or parenthesized example are dropped. */
  usOutsideExamples: (ctx, findings) =>
    ctx.lang !== "en_US" ? [] : findings.filter((f) => !quotedMention(ctx, f)),
} satisfies Record<string, FindingsFilter>;
