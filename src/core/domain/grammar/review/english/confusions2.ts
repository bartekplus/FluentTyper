import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { namedExampleBefore } from "../exampleCues";
import {
  gluedAfter,
  hasUserOrCasedWord,
  WORD_END,
  WORD_START,
  wordSet as words,
} from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

/** One row per form: `~` stands for each form in both columns. */
const each = (forms: readonly string[], typed: string, replacement: string): PhraseRow[] =>
  forms.map((form) => [typed.replace("~", form), replacement.replace("~", form)]);
const NEGATED = [
  "can't",
  "cant",
  "cannot",
  "can not",
  "couldn't",
  "couldnt",
  "could not",
  "don't",
  "dont",
  "do not",
  "doesn't",
  "doesnt",
  "does not",
  "didn't",
  "didnt",
  "did not",
  "won't",
  "wont",
  "will not",
  "wouldn't",
  "shouldn't",
];

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  ["hazzle", "hassle"],
  ["hazzles", "hassles"],
  ["hazzled", "hassled"],
  ["hazzling", "hassling"],
  ["hazzle-free", "hassle-free"],
  ["at leas", "at least"],
  ["at lest", "at least"],
  ["spinal chord", "spinal cord"],
  ["spinal chords", "spinal cords"],
  ["umbilical chord", "umbilical cord"],
  ["umbilical chords", "umbilical cords"],
  ["electrical chord", "electrical cord"],
  ["electrical chords", "electrical cords"],
  ["vocal chord", "vocal cord"],
  ...each(["strike", "strikes", "struck", "striking"], "~ a cord", "~ a chord"),
  ["the whether", "the weather"],
  ["tuff enough", "tough enough"],
  ["toted as", "touted as"],
  ...each(["much", "widely", "highly", "often"], "~ toted", "~ touted"),
  ["much-toted", "much-touted"],
  ["gun touting", "gun toting"],
  ["gun-touting", "gun-toting"],
  ...each(
    [
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "am",
      "not",
      "isn't",
      "aren't",
      "wasn't",
      "weren't",
    ],
    "~ aloud to",
    "~ allowed to",
  ),
  ...NEGATED.flatMap((aux) =>
    ["to", "for", "until", "till"].map((after): PhraseRow => [
      `${aux} way ${after}`,
      // "I can’t way to proxy it" may have lost "find a".
      after === "to" ? [`${aux} wait to`, `${aux} find a way to`] : `${aux} wait ${after}`,
    ]),
  ),
];
export const COMPOUNDS: readonly PhraseRow[] = [["likely hood", "likelihood"]];
export const STYLE: readonly PhraseRow[] = [];

// Closed-class word sets; open-class decisions go through the lexicon.
const DET = words(
  "the a an this that these those my your his her its our their each every no another",
);
const SUBJECTS = words("i you we they he she it");
const OBJECTS = words("me him her us them you it");
const WH = words("what where which who whom whose how why when");
const MODALS = words(
  "will would could should can can't cannot might must mustn't shouldn't won't wouldn't couldn't may shall",
);
const BE = words("am is are was were be been being isn't aren't wasn't weren't ain't");
const HAVE = words("have has had haven't hasn't hadn't");
const AUX = new Set([...MODALS, ...BE, ...HAVE, ...words("do does did don't doesn't didn't to")]);
const ADVERBS = words(
  "not never just really also still always only even actually sometimes often usually rarely seldom certainly definitely probably already",
);
const PREPOSITIONS = words(
  "of for about with from into onto at by against between among without toward towards under through during despite to on in upon via over across along around behind beside near after before since until till inside outside beyond below above within throughout unlike",
);
// Words the lexicon also lists as nouns ("in", "behind") that never head a noun phrase here.
const CLOSED = new Set([
  ...DET,
  ...SUBJECTS,
  ...OBJECTS,
  ...WH,
  ...AUX,
  ...ADVERBS,
  ...PREPOSITIONS,
  ...words(
    "and or but so if as than then there here now that some any all both more most less much many such own same other else itself themselves yet too very",
  ),
]);
// Time, frequency and direction words a locative "there" takes: "lived there years".
const TIME = words(
  "today tonight tomorrow yesterday morning afternoon evening night nights time times years year months month weeks week days day hours hour minutes decades ages once twice early late last next soon forever overnight recently daily north south east west home abroad online offline upstairs downstairs inland overseas downtown uptown onward onwards straight ahead",
);
// Lemmas that take a bare clause ("I think they're…"), or a place ("went there…") after them.
const BARE_CLAUSE = words(
  "think know hope believe say guess suppose feel wish mean see hear suggest insist find ensure notice assume bet admit doubt swear fear reckon figure understand learn remember forget realize realise prove imagine pretend seem appear look sound agree argue claim decide expect explain hold note predict read report reveal state worry confirm verify make trust wonder deny recall watch be have do get go come need dare",
);
// These take their object first: "tell them they're…", but "Tell they the news" is wrong.
const OBJECT_FIRST = words("tell show remind promise assure convince teach inform warn let help");
const CLAUSE_LEMMAS = new Set([...BARE_CLAUSE, ...OBJECT_FIRST]);
const PLACE_LEMMAS = words(
  "go come get arrive stay live work sit stand wait sleep eat die lie meet stop remain park settle belong exist happen drive fly walk run ride travel head return sail swim hike rush hurry move relocate commute visit",
);
// "remember/forget there was…" needs a be-verb, so only these block a following noun.
const THERE_BLOCK = new Set([
  ...PLACE_LEMMAS,
  ...words(
    "be have do see watch hear notice find think know believe say guess suppose feel hope mean seem appear look sound tell show prove imagine wish bet swear claim",
  ),
]);

type Word = { w: string; raw: string; start: number; end: number };
const TOKEN = "[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*";
const WORD_BEFORE = new RegExp(`(?<![A-Za-z'’-])(${TOKEN})[ \\t\\u00a0]+$`);
const WORD_AFTER = new RegExp(
  `^[ \\t\\u00a0]+(${TOKEN})(?![\\p{L}\\p{N}_'’@/#\\\\-]|\\.[\\p{L}\\p{N}])`,
  "u",
);
const key = (raw: string) => raw.toLowerCase().replace(/’/g, "'");

/** Up to `max` words before `index` on the same clause, nearest first. */
function wordsBefore(text: string, index: number, max: number): Word[] {
  const found: Word[] = [];
  for (let at = index; found.length < max;) {
    const match = WORD_BEFORE.exec(text.slice(Math.max(0, at - 48), at));
    if (!match) break;
    const start = at - match[0].length;
    found.push({ w: key(match[1]), raw: match[1], start, end: start + match[1].length });
    at = start;
  }
  return found;
}
/** Up to `max` words after `index` on the same clause. */
function wordsAfter(text: string, index: number, max: number): Word[] {
  const found: Word[] = [];
  for (let at = index; found.length < max;) {
    const match = WORD_AFTER.exec(text.slice(at, at + 48));
    if (!match) break;
    const end = at + match[0].length;
    found.push({ w: key(match[1]), raw: match[1], start: end - match[1].length, end });
    at = end;
  }
  return found;
}
/** Nothing but spaces, quotes or brackets between a clause boundary and `index`. */
function opens(text: string, index: number): boolean {
  let i = index;
  while (i > 0 && /[ \t\u00a0"“‘(]/.test(text[i - 1])) i -= 1;
  return i === 0 || /[.!?;:\n—–]/.test(text[i - 1]) || text.slice(i - 2, i) === "--";
}
const closes = (text: string, index: number) =>
  /^[ \t\u00a0]{0,8}(?:[.!?,;:)\]"”…]|--|[—–]|$)/.test(text.slice(index, index + 12));

const info = (word: string) => englishWordInfo(word);
const hasForm = (word: string, ...forms: string[]) =>
  info(word)?.verbs.some((verb) => forms.includes(verb.form)) ?? false;
const lemmaIn = (word: string, lemmas: ReadonlySet<string>) =>
  lemmas.has(word) || (info(word)?.verbs.some((verb) => lemmas.has(verb.lemma)) ?? false);
const adjective = (word: string) => info(word)?.adjective ?? false;
/** A noun reading; an unlisted lowercase word is a long pure noun the lexicon omits. */
function nounish(word: string): boolean {
  if (CLOSED.has(word) || TIME.has(word)) return false;
  const entry = info(word);
  if (!entry) return /^[a-z]{4,}$/.test(word);
  if (!entry.verbs.length && !entry.noun && !entry.adjective && !entry.adverb) return true;
  return (entry.noun || entry.plural) && !entry.adverb && !entry.adjective;
}
/** A finite verb that cannot be a noun or adjective: "sprinted", "facilitates". */
function pureFinite(word: string): boolean {
  const entry = info(word);
  return (
    !!entry &&
    entry.verbs.some((verb) => verb.form === "past" || verb.form === "third") &&
    !entry.noun &&
    !entry.plural &&
    !entry.adjective
  );
}
/** Index of the head noun of a short noun phrase at `from` ("relatively low density"), or -1. */
function nounPhrase(next: readonly Word[], from: number, compound = true): number {
  let k = from;
  const entry = next[k] && info(next[k].w);
  if (entry && entry.adverb && !entry.adjective && !entry.noun && !CLOSED.has(next[k].w)) k += 1;
  const modifier = next[k]?.w;
  if (
    modifier &&
    next[k + 1] &&
    !CLOSED.has(modifier) &&
    (adjective(modifier) || hasForm(modifier, "past", "participle")) &&
    nounish(next[k + 1].w)
  )
    k += 1;
  if (!next[k] || !nounish(next[k].w)) return -1;
  // A noun compound: "backup plan", "return policy".
  if (compound && next[k + 1] && nounish(next[k + 1].w) && !info(next[k].w)?.plural) k += 1;
  // A gerund with an object is a clause: "I love they're doing this".
  const after = next[k + 1]?.w ?? "";
  if (hasForm(next[k].w, "ing") && (DET.has(after) || OBJECTS.has(after) || after === "to"))
    return -1;
  return k;
}
// Noun + participle compounds that are adjectives: "They're family owned".
const COMPOUND_PARTICIPLES = words(
  "owned operated run based driven focused oriented led funded backed made built minded",
);
/** The noun phrase at 0 is a subject: a verb that is not a noun follows it. */
function subjectPhrase(next: readonly Word[], compound = true): boolean {
  // "apartment smells like…": a noun compound reading may eat the verb, so try without first.
  if (compound && subjectPhrase(next, false)) return true;
  const head = nounPhrase(next, 0, compound);
  if (head < 0) return false;
  const verb = next[head + 1]?.w;
  if (!verb || COMPOUND_PARTICIPLES.has(verb)) return false;
  if (/^(?:is|was|are|were|has|have|had)$/.test(verb)) return true;
  const like = hasForm(verb, "third") && next[head + 2]?.w === "like";
  // A plural head + "-ed" may be a reduced relative: "They're students funded by…".
  if (info(next[head].w)?.plural) return (hasForm(verb, "third") && pureFinite(verb)) || like;
  return pureFinite(verb) || like;
}
/** A transitive verb with "there"/"they're" as its object's determiner. */
function objectVerb(
  text: string,
  verb: Word | undefined,
  before: Word | undefined,
  blocked: ReadonlySet<string>,
): boolean {
  if (!verb || CLOSED.has(verb.w) || LOCATIVE_LEAD.has(verb.w) || !info(verb.w)?.verbs.length)
    return false;
  if (lemmaIn(verb.w, blocked) || lemmaIn(verb.w, PLACE_LEMMAS)) return false;
  // "the reason they're…", "Reaching there takes…": a noun or a gerund subject.
  if (
    before &&
    (DET.has(before.w) ||
      (adjective(before.w) &&
        !CLOSED.has(before.w) &&
        !info(before.w)?.verbs.length &&
        !info(before.w)?.adverb))
  )
    return false;
  return !(hasForm(verb.w, "ing") && opens(text, verb.start));
}
/** A gerund head ("they're hearing") needs "of" after it, or a past verb before it. */
function gerundHeadOk(hit: Hit, verb: Word | undefined): boolean {
  const k = nounPhrase(hit.N, 0);
  const head = hit.N[k];
  if (!head || !hasForm(head.w, "ing")) return true;
  const after = hit.N[k + 1]?.w ?? "";
  if (after === "of") return true;
  // "lost their hearing might…": a past verb, then the gerund ends its phrase.
  if (!verb || !hasForm(verb.w, "past", "participle")) return false;
  return closes(hit.ctx.text, head.end) || FINITE.has(after) || PREPOSITIONS.has(after);
}
const THERE_PREPOSITIONS = words("about to of from with for into on by");
const LOCATIVE_LEAD = words("out up down over in back away here near far right straight just");
/**
 * "narratives about there past", "stems from there potential to…": a mid-clause preposition,
 * then a noun phrase that ends its phrase. "far from there people live…" goes on with a verb.
 */
function prepositionObject(hit: Hit): boolean {
  const [p0, p1] = hit.P;
  if (!p0 || !p1 || !THERE_PREPOSITIONS.has(p0.w) || opens(hit.ctx.text, p0.start)) return false;
  if (LOCATIVE_LEAD.has(p1.w) || CLOSED.has(p1.w) || lemmaIn(p1.w, THERE_BLOCK)) return false;
  const from = /^(?:most|more|less|least)$/.test(hit.N[0]?.w ?? "") ? 1 : 0;
  let head = nounPhrase(hit.N, from);
  const entry = hit.N[from] && info(hit.N[from].w);
  // A noun that is also an adjective ("potential") still heads the phrase.
  if (head < 0 && entry?.noun && !entry.adverb && !TIME.has(hit.N[from].w)) head = from;
  if (head < 0) return false;
  const next = hit.N[head + 1]?.w ?? "";
  // "from/to there" is mostly a place, so only a continuing phrase counts after them.
  return (
    (!/^(?:from|to)$/.test(p0.w) && closes(hit.ctx.text, hit.N[head].end)) ||
    PREPOSITIONS.has(next) ||
    next === "and" ||
    next === "or"
  );
}
// A clause after these conjunctions has its own subject: "…, but their backup plan worked".
const CONJUNCTIONS = words("and but so yet while whereas because although");
const clauseStart = (hit: Hit) =>
  opens(hit.ctx.text, hit.start) || CONJUNCTIONS.has(hit.P[0]?.w ?? "");

type Hit = {
  ctx: DetectContext;
  word: string;
  start: number;
  end: number;
  readonly P: Word[];
  readonly N: Word[];
};
type Handler = (hit: Hit) => RawFinding | null;

/** A finding for [start, end), cased like the typed text. Names and user words abstain. */
function emit(
  hit: Hit,
  start: number,
  end: number,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  replacements: readonly string[],
  evidence: readonly [number, number] = [start, end],
): RawFinding | null {
  const { ctx } = hit;
  if (start < ctx.from || start >= ctx.to) return null;
  const from = Math.min(start, evidence[0]);
  const to = Math.max(end, evidence[1]);
  if (hasUserOrCasedWord(ctx, ctx.text.slice(from, to))) return null;
  if (gluedAfter(ctx.text, end) || namedExampleBefore(ctx.text, from)) return null;
  const typed = ctx.text.slice(start, end);
  const casing = detectWordCase(typed);
  // A capitalized word after a lowercase one mid-sentence is a name ("the Rally team").
  const previous = wordsBefore(ctx.text, start, 1)[0];
  if (casing === "title" && previous && /^[a-z]/.test(previous.raw) && !opens(ctx.text, start))
    return null;
  const curly = typed.includes("’");
  const alternatives = replacements.map((replacement) => {
    const cased = applyWordCase(replacement, casing);
    return curly ? cased.replace(/'/g, "’") : cased;
  });
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives,
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: { start: Math.max(0, from - 48), end: Math.min(ctx.text.length, to + 16) },
  };
}
const typo = (hit: Hit, replacement: string | readonly string[], first?: Word, last?: Word) =>
  emit(hit, hit.start, hit.end, "englishUsagePhrases", "review_msg_typo", [replacement].flat(), [
    first?.start ?? hit.start,
    last?.end ?? hit.end,
  ]);
const theirFamily = (hit: Hit, key: RawFinding["messageKey"], replacement: string, first?: Word) =>
  emit(
    hit,
    hit.start,
    hit.end,
    "englishTheirThereTheyAre",
    key,
    [replacement],
    [first?.start ?? hit.start, hit.N[0]?.end ?? hit.end],
  );
/** Skips leading words of `set` in `list` from `from`; returns the next index. */
const skip = (list: readonly Word[], set: ReadonlySet<string>, from = 0) => {
  let i = from;
  while (list[i] && set.has(list[i].w)) i += 1;
  return i;
};

const COLD_COMPOUNDS = words(
  "build call email brew press start boot read pitch shoulder plunge smoke roll cut message text contact approach",
);
const PLEAS_INTRANSITIVE = words(
  "go are were have had do remain seem become fall come continue grow mount",
);
const BOARDING_PLACES = words(
  "school schools house college academy hostel hall inn ship home family dorm dormitory farm",
);
const DIRECTIONS = words("left right top bottom side sides edge edges inside outside");
const THREAT_COMPOUNDS = words(
  "model models modeling modelling hunt hunting assess assessment intelligence actor actors level levels vector vectors landscape surface",
);
const SHUT_AUX = new Set([
  ...MODALS,
  ...HAVE,
  ...words("to did didn't don't doesn't please i'll we'll you'll they'll he'll she'll"),
]);
const SHUT_OBJECT = new Set([...DET, ...words("it them everything all any some")]);
const THOUGHT_NEXT = words(
  "i you we they he she it that this there so about of the a maybe it's i'd i'll you'd he'd she'd they'd we'd i'm you're they're we're he's she's there's that's he'll she'll they'll we'll you'll",
);
const MUCH_NEXT = words("more less longer further better worse bigger");
const MUCH_CLAUSE = words(
  "i you we they he she it to do does did have has had will would should can could",
);
const INTENSIFIERS = words(
  "really very so super quite too extremely incredibly totally pretty truly especially",
);
const PERSONAL_BE = /^(?:i'm|you're|we're|they're|he's|she's)$/;
const EXCITED_LINK = words("feel feels felt get gets got getting seem seems seemed");
const READY_NOT = words("willing early");
const WAIST_NOT = words(
  "the a an this that these those about around approximately roughly nearly almost over under just only less more some up",
);
const WASTE_ADJECTIVES = words(
  "total complete huge big massive utter absolute pure real colossal enormous terrible horrible awful needless unnecessary great such entire giant",
);
const RELAY_LEAD = new Set([
  ...MODALS,
  ...words(
    "please often always still usually generally mostly heavily really also just to don't doesn't didn't not never i you we they",
  ),
]);
const THINK_KNOW = words("think thinks thought thinking know knows knew known knowing");
const OFF_IDIOMS = words("top cuff record wall bat beaten coast shore");
const PRIZE_LEAD = words(
  "a the several many two three four five some first second third top big major cash grand another any no",
);
const WIN = words("win wins won winning");
const LOSE_OBJECT = words(
  "it them him her me us you everything anything something weight money time data track sight interest hope control focus my your his our their all",
);
const SETTING_VERBS = words(
  "set sets switch switched change changed turn turned adjust adjusted go went move moved shift",
);
const THEM_PREPOSITIONS = words(
  "to with against between among amongst from into onto toward towards about via upon beside behind at",
);
const THEM_NEXT = words(
  "the a an my your his her our their this that these those for about in on at via with during when how what why where as today tomorrow tonight later again back up down out off to",
);
const THEM_LEAD = new Set([
  ...MODALS,
  ...words("i you we they he she to please don't didn't not also just let's and"),
]);
const FINITE = new Set([...MODALS, ...BE, ...HAVE, ...words("do does did 're")]);
const CUES = words(
  "said says say heard hear think thought guess hope know knew suspect sure maybe perhaps because since if when that",
);
const PLACE_VERBS = words("put place leave set move keep store drop hang stick lay park position");
const PLACE_NEXT = words("to beside next near by for until and so");
const LINKING_LEMMAS = words("look feel seem act sound get stay become");
const SPEECH_LEMMAS = words("speak talk sing shout yell play laugh whisper");
const WERE_PREDICATES = words(
  "able aware allowed sure ready happy right wrong lucky done finished serious awake busy okay ok alright there",
);

const HANDLERS: Record<string, Handler> = {
  // "I cold go" → could: a subject pronoun and a bare verb around it.
  cold(hit) {
    const [p0, p1] = hit.P;
    const n0 = hit.N[0];
    if (!p0 || !n0 || COLD_COMPOUNDS.has(n0.w)) return null;
    const subject =
      /^(?:i|we|they|he|she)$/.test(p0.w) ||
      (/^(?:it|you)$/.test(p0.w) &&
        (opens(hit.ctx.text, p0.start) ||
          /^(?:and|but|so|if|when|because|that)$/.test(p1?.w ?? "")));
    if (!subject || !(ADVERBS.has(n0.w) || hasForm(n0.w, "base"))) return null;
    return typo(hit, "could", p0, n0);
  },
  // "He dos not" → does. An all-caps DOS beside a lowercase pronoun is the system name.
  dos(hit) {
    const subject = hit.P[skip(hit.P, ADVERBS)];
    if (!subject || !/^(?:he|she|it)$/.test(subject.w)) return null;
    const typed = hit.ctx.text.slice(hit.start, hit.end);
    if (typed === "DOS" && subject.raw !== subject.raw.toUpperCase()) return null;
    return typo(hit, "does", subject);
  },
  // "I wok from home" → work: a subject, an auxiliary or an infinitive "to" before it.
  wok(hit) {
    const text = hit.ctx.text;
    const lead = hit.P[skip(hit.P, ADVERBS)];
    if (!lead) return null;
    const n0 = hit.N[0]?.w ?? "";
    const ok =
      (SUBJECTS.has(lead.w) && (!/^(?:it|you)$/.test(lead.w) || opens(text, lead.start))) ||
      (lead.w !== "to" &&
        AUX.has(lead.w) &&
        !(/^(?:do|does|did)$/.test(lead.w) && opens(text, lead.start))) ||
      (lead.w === "to" &&
        (opens(text, lead.start) ||
          /^(?:here|there|on|from|at|with|around|for|late|hard|together|remotely|fast|well|better|overtime)$/.test(
            n0,
          )));
    return ok ? typo(hit, "work", lead) : null;
  },
  // "It is rally going" → really: be + rally + a participle or an adjective.
  rally(hit) {
    const n0 = hit.N[0];
    const entry = n0 && info(n0.w);
    if (
      !entry ||
      !(hasForm(n0.w, "ing") || (entry.adjective && !entry.noun && !entry.verbs.length))
    )
      return null;
    const i = hit.P[0]?.w === "not" ? 1 : 0;
    const p = hit.P[i];
    if (!p) return null;
    const be =
      BE.has(p.w) ||
      /^(?:i'm|you're|we're|they're|he's|she's|it's|that's)$/.test(p.w) ||
      (SUBJECTS.has(p.w) && BE.has(hit.P[i + 1]?.w ?? ""));
    return be ? typo(hit, "really", p, n0) : null;
  },
  // "Pleas review this" → please: a request verb with an object after a clause start or "you".
  pleas(hit) {
    const [n0, n1] = hit.N;
    if (!n0 || !hasForm(n0.w, "base") || PLEAS_INTRANSITIVE.has(n0.w)) return null;
    if (n1 && PREPOSITIONS.has(n1.w)) return null;
    const p0 = hit.P[0]?.w ?? "";
    if (!opens(hit.ctx.text, hit.start) && !/^(?:you|and|but|so|then|now|just|kindly)$/.test(p0))
      return null;
    return typo(hit, "please", undefined, n0);
  },
  // "the boarder of the image", "cross the boarder" → border; boarding pupils keep theirs.
  boarder(hit) {
    const [n0, n1, n2] = hit.N;
    const p = hit.P[0] && DET.has(hit.P[0].w) ? hit.P[1] : hit.P[0];
    let ok = !!p && /^cross(?:es|ed|ing)?$/.test(p.w);
    if (!ok && n0 && n1) {
      if (/^(?:between|around|along|across)$/.test(n0.w)) ok = true;
      else if (n0.w === "of") ok = !BOARDING_PLACES.has(n2?.w ?? n1.w);
      else if (n0.w === "with") ok = true;
      else if (n0.w === "on") ok = DIRECTIONS.has(n1.w) || DIRECTIONS.has(n2?.w ?? "");
    }
    return ok ? typo(hit, hit.word.replace("boarder", "border"), p, n0) : null;
  },
  // "A thieve took my bike" → thief: a determiner (and an adjective) before it.
  thieve(hit) {
    const [p0, p1] = hit.P;
    if (!p0) return null;
    const ok =
      DET.has(p0.w) || (adjective(p0.w) && !info(p0.w)?.verbs.length && DET.has(p1?.w ?? ""));
    return ok ? typo(hit, "thief", p0) : null;
  },
  // "I will threat the vendor" → threaten (or treat): a modal with its subject before it.
  threat(hit) {
    const n0 = hit.N[0];
    if (!n0 || THREAT_COMPOUNDS.has(n0.w)) return null;
    const i = hit.P[0]?.w === "not" ? 1 : 0;
    const [m, s] = [hit.P[i], hit.P[i + 1]];
    if (!m || !s) return null;
    const ok =
      (MODALS.has(m.w) && !WH.has(s.w) && !opens(hit.ctx.text, m.start)) ||
      (SUBJECTS.has(m.w) && MODALS.has(s.w));
    return ok
      ? emit(
          hit,
          hit.start,
          hit.end,
          "englishUsagePhrases",
          "review_msg_contextual_grammar",
          ["threaten", "treat"],
          [s.start, n0.end],
        )
      : null;
  },
  // "My principle job" → principal: a determiner, then a noun that is not a finite verb.
  principle(hit) {
    const p0 = hit.P[0];
    const n0 = hit.N[0];
    if (!p0 || !n0 || !DET.has(p0.w) || n0.w === "worth") return null;
    if (!nounish(n0.w) && !info(n0.w)?.noun) return null;
    // "The principle underlying it": a participle after it modifies the noun "principle".
    if (CLOSED.has(n0.w) || hasForm(n0.w, "third", "past", "ing") || n0.w.endsWith("ing"))
      return null;
    return typo(hit, "principal", p0, n0);
  },
  // "I will shutdown the server" → shut down: an auxiliary (and subject) before, an object after.
  shutdown(hit) {
    const n0 = hit.N[0];
    if (!n0 || !SHUT_OBJECT.has(n0.w)) return null;
    let i = 0;
    while (
      i < 2 &&
      hit.P[i] &&
      (/^(?:not|never|just|already|also|still)$/.test(hit.P[i].w) ||
        SUBJECTS.has(hit.P[i].w) ||
        (i === 0 && /^[A-Z][a-z]+$/.test(hit.P[i].raw)))
    )
      i += 1;
    if (!hit.P[i] || !SHUT_AUX.has(hit.P[i].w)) return null;
    return emit(
      hit,
      hit.start,
      hit.end,
      "englishContextualCompounds",
      "review_msg_compounds",
      ["shut down"],
      [hit.P[i].start, n0.end],
    );
  },
  // "I though it was" → thought: a subject pronoun before, a clause after.
  though(hit) {
    const [p0, p1] = hit.P;
    const n0 = hit.N[0];
    if (!p0 || !n0 || !THOUGHT_NEXT.has(n0.w) || !/^(?:i|we|they|you|he|she)$/.test(p0.w))
      return null;
    if (
      p0.w === "you" &&
      !opens(hit.ctx.text, p0.start) &&
      !/^(?:and|but|so|then|if|when|because|that)$/.test(p1?.w ?? "")
    )
      return null;
    return typo(hit, "thought", p0, n0);
  },
  // "Have you heart of…" → heard: a perfect auxiliary with its subject before.
  heart(hit) {
    if (hit.N[0]?.w !== "of") return null;
    const P = hit.P;
    const i = skip(P, words("ever never not already just all also"));
    const p = P[i];
    if (!p) return null;
    const ok =
      /^(?:(?:i|you|we|they)'ve|(?:i|you|we|they|he|she)'d)$/.test(p.w) ||
      (HAVE.has(p.w) && i > 0 && SUBJECTS.has(P[i + 1]?.w ?? "")) ||
      (SUBJECTS.has(p.w) && HAVE.has(P[i + 1]?.w ?? "")) ||
      (P[i + 1]?.w === "the" && HAVE.has(P[i + 2]?.w ?? ""));
    return ok ? typo(hit, "heard", P[Math.min(P.length - 1, i + 2)], hit.N[0]) : null;
  },
  // "how mach", "how match time" → much.
  mach(hit) {
    const p0 = hit.P[0];
    if (p0?.w !== "how" || /^[ \t\u00a0]*\d/.test(hit.ctx.text.slice(hit.end, hit.end + 4)))
      return null;
    if (/^[A-Z][a-z]/.test(hit.ctx.text.slice(hit.start, hit.end)) && /^[a-z]/.test(p0.raw))
      return null;
    if (hit.word === "match") {
      const [n0, n1] = hit.N;
      if (!n0) return null;
      const entry = info(n0.w);
      const singular = entry
        ? entry.noun && !entry.plural && !hasForm(n0.w, "third", "past", "ing")
        : /^[a-z]{4,}$/.test(n0.w);
      if (!(n0.w === "of" || MUCH_NEXT.has(n0.w) || (singular && MUCH_CLAUSE.has(n1?.w ?? ""))))
        return null;
    }
    return typo(hit, "much", p0);
  },
  // "She is exited about" → excited: be + exited + an emotion's complement.
  exited(hit) {
    const P = hit.P;
    let i = skip(P, words("not"));
    const intense = INTENSIFIERS.has(P[i]?.w ?? "");
    i = skip(P, INTENSIFIERS, i);
    const be = P[i];
    if (!be || !(BE.has(be.w) || PERSONAL_BE.test(be.w) || EXCITED_LINK.has(be.w))) return null;
    const n = hit.N[0]?.w;
    const personal = PERSONAL_BE.test(be.w) || /^(?:i|you|we|they|he|she)$/.test(P[i + 1]?.w ?? "");
    const ok =
      intense || n === "about" || n === "that" || ((n === "for" || n === "to") && personal);
    return ok ? typo(hit, "excited", be, hit.N[0]) : null;
  },
  // "is all ready available" → already: "all ready" before an adjective.
  ready(hit) {
    const p0 = hit.P[0];
    const n0 = hit.N[0];
    if (p0?.w !== "all" || !n0 || CLOSED.has(n0.w) || READY_NOT.has(n0.w) || !adjective(n0.w))
      return null;
    return emit(
      hit,
      p0.start,
      hit.end,
      "englishUsagePhrases",
      "review_msg_typo",
      ["already"],
      [p0.start, n0.end],
    );
  },
  // "there is now way to" → no way.
  way(hit) {
    const [p0, p1, p2] = hit.P;
    if (p0?.w !== "now") return null;
    const [n0, n1] = hit.N;
    let ok = (p1?.w === "in" || p1?.w === "of") && p2?.w !== "as";
    if (!ok && n0) {
      if (/^(?:of|for|around)$/.test(n0.w)) ok = true;
      else if (n0.w === "to") ok = !n1 || !(adjective(n1.w) && !info(n1.w)?.verbs.length);
      else if (/s$/.test(n0.w)) ok = !!info(n0.w)?.plural || (!info(n0.w) && nounish(n0.w));
    }
    if (!ok) return null;
    return emit(
      hit,
      p0.start,
      p0.end,
      "englishUsagePhrases",
      "review_msg_typo",
      ["no"],
      [p0.start, hit.end],
    );
  },
  // "canceled do to bad weather" → due to: a finished event before, a noun phrase after.
  do(hit) {
    const [n0, n1] = hit.N;
    const [p0, p1] = hit.P;
    if (n0?.w !== "to" || !n1 || !p0 || OBJECTS.has(n1.w)) return null;
    const next = info(n1.w);
    if (next?.verbs.some((v) => v.form === "base") && !next.noun && !next.adjective) return null;
    if (/^(?:had|made|let|helped|did|done|been|used|got)$/.test(p0.w)) return null;
    const ok =
      hasForm(p0.w, "past") ||
      (hasForm(p0.w, "base") && MODALS.has(p1?.w ?? "")) ||
      (!!info(p0.w)?.adverb && !CLOSED.has(p0.w) && hasForm(p1?.w ?? "", "past"));
    return ok ? typo(hit, "due", p0, n1) : null;
  },
  // "a waist of time" → waste; a body's "waist of 30 inches" or "the waist of the dress" stays.
  waist(hit) {
    const [n0, n1] = hit.N;
    const p0 = hit.P[0]?.w ?? "";
    if (n0?.w !== "of" || !n1 || WAIST_NOT.has(n1.w)) return null;
    if (/^(?:the|her|his|my|your|its|their|our)$/.test(p0)) return null;
    const evaluative = p0 === "a" || p0 === "an" || WASTE_ADJECTIVES.has(p0);
    if (/^(?:her|his|my|your|its|their|our)$/.test(n1.w) && !evaluative) return null;
    if (p0 && adjective(p0) && !WASTE_ADJECTIVES.has(p0)) return null;
    return typo(hit, "waste", undefined, n1);
  },
  // "They relay on" → rely on: a subject, adverb or auxiliary before; "the relay on…" stays.
  relay(hit) {
    const [n0, n1] = hit.N;
    if (n0?.w !== "on" || !n1 || n1.w === "behalf") return null;
    const p = hit.P[0];
    const ok = p
      ? RELAY_LEAD.has(p.w) ||
        (/ly$/.test(p.w) && !!info(p.w)?.adverb) ||
        (!!info(p.w)?.plural && !DET.has(hit.P[1]?.w ?? ""))
      : opens(hit.ctx.text, hit.start) && OBJECTS.has(n1.w);
    return ok ? typo(hit, "rely", p, n0) : null;
  },
  // "I know off a shop" → of; "off the top of my head" stays.
  off(hit) {
    const p0 = hit.P[0];
    const [n0, n1] = hit.N;
    if (!p0 || !THINK_KNOW.has(p0.w) || !n0 || /^(?:and|of|hand|handedly)$/.test(n0.w)) return null;
    if (n0.w === "the" && OFF_IDIOMS.has(n1?.w ?? "")) return null;
    return typo(hit, "of", p0, n0);
  },
  // "tuff like steel" → tough; volcanic "tuff like basalt" stays.
  tuff(hit) {
    if (hit.N[0]?.w !== "like") return null;
    // Only a determiner, a linking verb or an intensifier may stand before it.
    const p = hit.P[0]?.w;
    if (p && !DET.has(p) && !BE.has(p) && !INTENSIFIERS.has(p) && !lemmaIn(p, LINKING_LEMMAS))
      return null;
    return typo(hit, "tough", undefined, hit.N[0]);
  },
  // "But yeh, it seems" → yeah; a vote's "yea" ("yea or nay") stays.
  yea(hit) {
    const text = hit.ctx.text;
    // A comma or a spaced dash; "Yea—ea—ea!" is a drawn-out cheer.
    const after =
      /^(?:[ \t\u00a0]*,|[ \t\u00a0]+[-–—]+|[-–—]+(?=[ \t\u00a0]))[ \t\u00a0]*([A-Za-z]*)/.exec(
        text.slice(hit.end, hit.end + 24),
      );
    if (!after || /^(?:though|verily|nay)$/i.test(after[1])) return null;
    if (/\b(?:nay|yeas|nays)\b/i.test(text.slice(Math.max(0, hit.start - 64), hit.end + 64)))
      return null;
    return typo(hit, "yeah");
  },
  // "won a price" → prize; "won the price war" stays.
  price(hit) {
    const i = PRIZE_LEAD.has(hit.P[0]?.w ?? "") ? 1 : 0;
    if (!WIN.has(hit.P[i]?.w ?? "")) return null;
    const n0 = hit.N[0];
    if (n0 && !CLOSED.has(n0.w) && !n0.w.includes("'")) {
      const entry = info(n0.w);
      if (entry ? (entry.noun || entry.plural) && !hasForm(n0.w, "past") : nounish(n0.w))
        return null;
    }
    return typo(hit, /s$/.test(hit.word) ? "prizes" : "prize", hit.P[i]);
  },
  // "a pity to loose" → lose; "from tight to loose" and "set to loose" stay.
  loose(hit) {
    const [p0, p1] = hit.P;
    if (p0?.w !== "to" || hit.P.some((p) => p.w === "from") || SETTING_VERBS.has(p1?.w ?? ""))
      return null;
    const n0 = hit.N[0];
    const ok = n0 ? LOSE_OBJECT.has(n0.w) : closes(hit.ctx.text, hit.end);
    return ok ? typo(hit, "lose", p0, n0) : null;
  },
  // "too lose and…" → too loose.
  lose(hit) {
    if (hit.P[0]?.w !== "too") return null;
    const n0 = hit.N[0];
    // "and/or" is no plain word, so the conjunction is read off the text.
    const ok =
      /^[ \t\u00a0]+(?:and|or|but|for|with|in|on|at)(?![A-Za-z])/i.test(
        hit.ctx.text.slice(hit.end, hit.end + 12),
      ) ||
      (!n0 && closes(hit.ctx.text, hit.end));
    return ok ? typo(hit, "loose", hit.P[0], n0) : null;
  },
  // "Talk to they", "Send they the invitation" → them.
  they(hit) {
    const [p0, p1] = hit.P;
    const n0 = hit.N[0];
    if (!p0) return null;
    // A stranded preposition before a new clause: "the city I moved to they call home".
    if (n0 && (FINITE.has(n0.w) || pureFinite(n0.w))) return null;
    const ok =
      (THEM_PREPOSITIONS.has(p0.w) && !(p0.w === "about" && WH.has(p1?.w ?? ""))) ||
      (hasForm(p0.w, "base") &&
        !AUX.has(p0.w) &&
        !lemmaIn(p0.w, BARE_CLAUSE) &&
        !!n0 &&
        THEM_NEXT.has(n0.w) &&
        (opens(hit.ctx.text, p0.start) || THEM_LEAD.has(p1?.w ?? "")));
    return ok
      ? emit(
          hit,
          hit.start,
          hit.end,
          "englishPronounCase",
          "review_msg_pronoun_object_case",
          ["them"],
          [p0.start, n0?.end ?? hit.end],
        )
      : null;
  },
  // "There dog is barking", "forgot there backpacks" → their; "I heard there planning" → they're.
  there(hit) {
    const text = hit.ctx.text;
    const [p0, p1] = hit.P;
    const [n0, n1] = hit.N;
    if (!n0) return null;
    if (p0 && CUES.has(p0.w) && n1 && hasForm(n0.w, "ing") && !/^(?:being|going)$/.test(n0.w))
      return theirFamily(hit, "review_msg_they_are", "they're", p0);
    const object =
      !opens(text, hit.start) &&
      objectVerb(text, p0, p1, THERE_BLOCK) &&
      nounPhrase(hit.N, 0) >= 0 &&
      gerundHeadOk(hit, p0);
    // "people and there ancestral lands.": a coordinated noun phrase with no verb is owned.
    const head = /^(?:and|or)$/.test(p0?.w ?? "") ? nounPhrase(hit.N, 0) : -1;
    const coordinated = head >= 0 && closes(text, hit.N[head].end);
    if (
      object ||
      coordinated ||
      prepositionObject(hit) ||
      (clauseStart(hit) && subjectPhrase(hit.N))
    )
      return theirFamily(hit, "review_msg_their_possessive", "their", p0);
    return null;
  },
  // "Put the folder their, beside…" → there.
  their(hit) {
    const n0 = hit.N[0];
    if (!(n0 ? PLACE_NEXT.has(n0.w) : closes(hit.ctx.text, hit.end))) return null;
    for (let j = 1; j <= 3; j += 1) {
      const verb = hit.P[j];
      const object = hit.P[j - 1];
      if (!verb || !object) return null;
      if (lemmaIn(verb.w, PLACE_VERBS) && (DET.has(object.w) || /^(?:it|them)$/.test(object.w)))
        return theirFamily(hit, "review_msg_their_there", "there", verb);
    }
    return null;
  },
  // "admired they're patience", "They're dog sprinted" → their.
  "they're"(hit) {
    const text = hit.ctx.text;
    const [p0, p1, p2] = hit.P;
    const phrase = nounPhrase(hit.N, 0) >= 0;
    const ok =
      (phrase && !!p0 && /^(?:are|were|is|was)$/.test(p0.w) && WH.has(p1?.w ?? "")) ||
      (phrase && objectVerb(text, p0, p1, CLAUSE_LEMMAS) && gerundHeadOk(hit, p0)) ||
      (phrase &&
        !!p0 &&
        OBJECTS.has(p0.w) &&
        objectVerb(text, p1, p2, CLAUSE_LEMMAS) &&
        gerundHeadOk(hit, p1)) ||
      (clauseStart(hit) && subjectPhrase(hit.N));
    return ok ? theirFamily(hit, "review_msg_their_possessive", "their", p0) : null;
  },
  // "She wants one, to." and "He spoke to loud." → too.
  to(hit) {
    const text = hit.ctx.text;
    const tail = /^[ \t\u00a0]{0,8}[.!?](?![\p{L}\p{N}])|^[ \t\u00a0]*$/u;
    let ok =
      /,[ \t\u00a0]{0,8}$/.test(text.slice(Math.max(0, hit.start - 9), hit.start)) &&
      tail.test(text.slice(hit.end, hit.end + 10));
    if (!ok && /^(?:loud|loudly)$/.test(hit.N[0]?.w ?? "") && hit.N.length === 1) {
      ok = lemmaIn(hit.P[0]?.w ?? "", SPEECH_LEMMAS) && closes(text, hit.N[0].end);
    }
    return ok
      ? emit(
          hit,
          hit.start,
          hit.end,
          "englishToToo",
          "review_msg_to_too",
          ["too"],
          [hit.P[0]?.start ?? hit.start, hit.N[0]?.end ?? hit.end],
        )
      : null;
  },
  // "Where you able to…" → Were: a clause-initial where + subject + predicate.
  where(hit) {
    const [n0, n1] = hit.N;
    if (!opens(hit.ctx.text, hit.start) || !n0 || !/^(?:you|we|they)$/.test(n0.w)) return null;
    if (!n1 || !WERE_PREDICATES.has(n1.w)) return null;
    return emit(
      hit,
      hit.start,
      hit.end,
      "englishWereWhere",
      "review_msg_were_where",
      ["were"],
      [hit.start, n1.end],
    );
  },
};
for (const [alias, target] of [
  ["herd", "heart"],
  ["match", "mach"],
  ["boarders", "boarder"],
  ["prices", "price"],
  ["prise", "price"],
  ["prises", "price"],
  ["yeh", "yea"],
  ["theyre", "they're"],
] as const)
  HANDLERS[alias] = HANDLERS[target];

const TRIGGER = new RegExp(
  `${WORD_START}(?:${Object.keys(HANDLERS)
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replaceAll("'", "['’]"))
    .join("|")})${WORD_END}`,
  "giu",
);

/** Typo-like confusions resolved by the words around one trigger word. */
function contextualConfusions(ctx: DetectContext): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  const findings: RawFinding[] = [];
  const regex = new RegExp(TRIGGER);
  // "all ready" starts one word before its trigger.
  regex.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    const word = key(m[0]);
    const start = m.index;
    const end = start + m[0].length;
    // Context words are read only when a handler asks: "to", "do" and "there" are frequent.
    let before: Word[] | undefined;
    let after: Word[] | undefined;
    const hit: Hit = {
      ctx,
      word,
      start,
      end,
      get P() {
        return (before ??= wordsBefore(ctx.text, start, 4));
      },
      get N() {
        return (after ??= wordsAfter(ctx.text, end, 5));
      },
    };
    const finding = HANDLERS[word](hit);
    if (finding) findings.push(finding);
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishUsagePhrases",
      "englishContextualCompounds",
      "englishPronounCase",
      "englishTheirThereTheyAre",
      "englishWereWhere",
      "englishToToo",
    ],
    detect: contextualConfusions,
  },
];
