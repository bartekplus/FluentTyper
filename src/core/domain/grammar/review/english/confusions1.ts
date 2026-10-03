import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, wordSet as set, isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { finding } from "../finding";

// Lookalike words decided by their syntactic slot: "I thing" is a verb slot, "good advise" a
// noun slot. Every frame reads at most a few words on each side of the target, within its block.

/** One row per form: `~` stands for the typed lookalike, replaced by the intended word. */
const rows = (forms: string[], typed: string, fixed: string): PhraseRow[] =>
  forms.map((form) => [form.replace("~", typed), form.replace("~", fixed)]);

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  ...rows(["I ~", "you ~", "he ~", "she ~", "it ~", "we ~", "they ~"], "dint", "didn't"),
  ["over they're", "over there"],
  ["very quite", "very quiet"],
  ...rows(["~ often", "~ a few", "~ a bit", "~ a lot", "~ a while"], "quiet", "quite"),
  ["now and than", "now and then"],
  ...rows(["it is ~ to", "it's ~ to", "it was ~ to", "is it ~ to", "was it ~ to"], "save", "safe"),
  ...rows(
    [
      "cause and ~",
      "placebo ~",
      "greenhouse ~",
      "ripple ~",
      "snowball ~",
      "domino ~",
      "butterfly ~",
      "knock-on ~",
      "with immediate ~",
      "to great ~",
      "to good ~",
      "to little ~",
    ],
    "affect",
    "effect",
  ),
  ["baton rogue", "baton rouge"],
  ["khmer rogue", "khmer rouge"],
  ...rows(
    [
      "go ~",
      "goes ~",
      "went ~",
      "gone ~",
      "going ~",
      "a ~ who",
      "~ nation",
      "~ nations",
      "~ state",
      "~ states",
      "~ trader",
      "~ traders",
      "~ squadron",
      "~ agent",
      "~ agents",
      "~-like",
      "~-likes",
      "~-lite",
      "~ like",
      "~ likes",
      "~like",
      "~likes",
      "~ wave",
      "~ waves",
      "~ planet",
      "~ process",
      "~ processes",
      "~ device",
      "~ devices",
      "~ employee",
      "~ employees",
      "~ actor",
      "~ actors",
    ],
    "rouge",
    "rogue",
  ),
  ...rows(
    [
      "chemotherapy ~",
      "chemotherapeutic ~",
      "therapeutic ~",
      "treatment ~",
      "dose ~",
      "dosing ~",
      "dosage ~",
      "drug ~",
      "medication ~",
      "antibiotic ~",
      "training ~",
      "workout ~",
      "exercise ~",
      "fitness ~",
      "skincare ~",
      "diet ~",
      "dietary ~",
      "supplement ~",
    ].flatMap((form) => [form, `${form}s`]),
    "regiment",
    "regimen",
  ),
  ...rows(["~ dress", "~ dresses", "~ outfit", "~ outfits"], "summary", "summery"),
  ["dissembly", "disassembly"],
];

export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// ---------------------------------------------------------------------------------------------
// Tokens around a target, on its line: b[0] is the nearest word before, a[0] the nearest after.

type Tok = { text: string; w: string; start: number; end: number };
const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu;

function tokens(ctx: DetectContext, from: number, to: number): Tok[] {
  const slice = ctx.text.slice(from, to);
  const out: Tok[] = [];
  for (const m of slice.matchAll(TOKEN))
    out.push({
      text: m[0],
      w: m[0].toLowerCase().replace(/’/g, "'"),
      start: from + m.index,
      end: from + m.index + m[0].length,
    });
  return out;
}
// A wrapped line continues its sentence; a blank line or a list, heading or quote line does not.
const BLOCK_START = /^[ \t]*(?:\r?\n|[-*+#>|][ \t]|\d+[.)][ \t])/;
const blockBreak = (text: string, nl: number) =>
  BLOCK_START.test(text.slice(nl + 1, nl + 8)) ||
  /\n[ \t]*\r?$/.test(text.slice(Math.max(0, nl - 8), nl));

function before(ctx: DetectContext, start: number): Tok[] {
  let from = Math.max(0, start - 72);
  // Line breaks inside the window only, nearest first: a search of the whole text
  // before every target would grow with its position.
  const window = ctx.text.slice(from, start);
  for (
    let nl = window.lastIndexOf("\n");
    nl >= 0;
    nl = nl > 0 ? window.lastIndexOf("\n", nl - 1) : -1
  )
    if (blockBreak(ctx.text, from + nl)) {
      from += nl + 1;
      break;
    }
  const list = tokens(ctx, from, start);
  // A word cut by the window is not a word.
  if (from > 0 && list[0]?.start === from && /[\p{L}\p{N}]/u.test(ctx.text[from - 1] ?? ""))
    list.shift();
  return list.reverse();
}
function after(ctx: DetectContext, end: number): Tok[] {
  let to = Math.min(ctx.text.length, end + 72);
  const window = ctx.text.slice(end, to);
  for (let nl = window.indexOf("\n"); nl >= 0; nl = window.indexOf("\n", nl + 1))
    if (blockBreak(ctx.text, end + nl)) {
      to = end + nl;
      break;
    }
  const list = tokens(ctx, end, to);
  if (to < ctx.text.length && list.at(-1)?.end === to && /[\p{L}\p{N}]/u.test(ctx.text[to] ?? ""))
    list.pop();
  return list;
}

const isWord = (t: Tok | undefined) => !!t && /^[\p{L}\p{N}]/u.test(t.text);
const BOUNDARY = /^[.!?;:"“”([…\uFFFC*+#>|-]$/;
/** Nothing, or clause punctuation, before. */
const opens = (t: Tok | undefined) => !t || BOUNDARY.test(t.text);
const ends = (t: Tok | undefined) => !t || /^[.!?;:,)"”…]$/.test(t.text);

const SUBJECT = set("i you we they");
const THIRD = set("he she it");
const MODAL = set(
  "can could will would shall should may might must do does did cannot can't couldn't won't wouldn't shan't shouldn't mightn't mustn't don't doesn't didn't",
);
// Bare modals that are also nouns ("the will", "a can").
const NOUN_MODAL = set("can will may must might");
const HAVE = set("have has had having i've you've we've they've i'd you'd he'd she'd we'd they'd");
const INDEFINITE = set("everyone anyone anybody everybody someone somebody nobody");
const DETERMINER = set("a an the my your his our their its this no every");
const OBJECT_START = set(
  "the a an my your his her its our their this that these those me him us them you it everyone everything someone something anyone anything how what whether which who all some any every each no both",
);
const OBJECT_PRONOUN = set("me him her us them you it");
// Closed-class words that never head a noun subject.
const FUNCTION = set(
  "i you we they he she it me him us them the a an this that these those my your our their his her its and or but so then if when what where how why who which not to of in on at by for from with",
);
const ADVERB = set(
  "not never always also just really only still even often usually sometimes maybe ever personally definitely probably actually already certainly simply generally typically normally honestly truly perhaps absolutely completely totally once again kinda sorta all",
);
// Words the lexicon marks adjective that work as adverbs or quantifiers before a verb.
const ADVERBISH = set(
  "just sure still even well only very so too quite rather pretty kind sort first last please right enough much more most less least",
);
const CONJUNCTION = set(
  "if when what that so and but because as than where how why unless until once while whether since or though although before after cause maybe then",
);
// "to" after these is a preposition, not an infinitive marker.
const PREPOSITION_HEAD = set(
  "according due prior thanks next close similar compared related attached opposed contrary back up down from way path key answer reply response addition reference regard respect relation comparison subject prone open exposed equal",
);
// Heads that take a bare infinitive after "to".
const TO_HEAD = set(
  "want wants wanted wanting need needs needed needing have has had having able try tries tried trying decide decides decided supposed ought plan plans planned like liked going tend tends tended seem seems seemed start starts started begin began remember forget forgot refuse refused hope hoped wish chose choose manage managed used how what where when whether why continue continued learn learned afraid easy hard help helps helped important possible impossible better best",
);
// What a causing "effect" takes: "effect change", "effect a transformation".
const EFFECT_OBJECT = set(
  "change changes reform reforms substitution substitutions transformation transformations improvement improvements repair repairs cure escape rescue transfer transfers entry compromise reconciliation merger restoration recovery transaction transactions payment payments sale sales settlement settlements arrest arrests",
);

function isAdverb(w: string): boolean {
  if (ADVERB.has(w)) return true;
  if (!/^[a-z]{3,}ly$/.test(w)) return false;
  const info = englishWordInfo(w);
  return !info || info.adverb || (!info.noun && !info.verbs.length);
}
/** A plain adjective: no verb, adverb or quantifier reading ("good", "strong", "deep"). */
function plainAdjective(w: string): boolean {
  if (ADVERBISH.has(w) || DETERMINER.has(w) || FUNCTION.has(w)) return false;
  const info = englishWordInfo(w);
  return !!info && info.adjective && !info.adverb && !info.verbs.length && !/ly$/.test(w);
}
const hasVerb = (w: string) => !!englishWordInfo(w)?.verbs.length;
const baseVerb = (w: string) => !!englishWordInfo(w)?.verbs.some((v) => v.form === "base");

type Cue = {
  kind: "subject" | "third" | "modal" | "to" | "indefinite" | "who" | "have";
  at: number;
  adverbs: number;
};

/** The word that makes the slot after the adverbs before a target: subject, modal, to... */
function cue(b: Tok[]): Cue | null {
  let i = 0;
  while (i < 3 && isWord(b[i]) && isAdverb(b[i].w)) i++;
  const t = b[i];
  if (!isWord(t)) {
    // "Never breath a word" at a clause start.
    if (i > 0 && /^(?:never|always|just)$/.test(b[i - 1].w))
      return { kind: "subject", at: i - 1, adverbs: i - 1 };
    return null;
  }
  const w = t.w;
  const base = { at: i, adverbs: i };
  if (SUBJECT.has(w)) {
    // "give you advice": an object "you" after a verb.
    if (w === "you" && isWord(b[i + 1])) {
      const p = b[i + 1].w;
      if (!MODAL.has(p) && !CONJUNCTION.has(p) && !isAdverb(p) && hasVerb(p)) return null;
      if (/^(?:to|for|with|of|thank|than)$/.test(p) && p !== "than") return null;
    }
    return { kind: "subject", ...base };
  }
  if (THIRD.has(w)) return { kind: "third", ...base };
  if (HAVE.has(w)) return { kind: "have", ...base };
  if (MODAL.has(w) || /^[a-z]+'(?:d|ll)$/.test(w)) {
    // "the will", "a can": a noun.
    if (
      NOUN_MODAL.has(w) &&
      isWord(b[i + 1]) &&
      /^(?:a|an|the|my|your|his|our|their|its|no|every)$/.test(b[i + 1].w)
    )
      return null;
    // Affirmative do is also the main verb: "do safe optimizations", "Do breath exercises".
    if (/^(?:do|does|did)$/.test(w) && i === 0) return null;
    // "Should intent be…?": an affirmative modal opening a question, with a noun subject.
    if (opens(b[i + 1]) && !/n't$|^cannot$/.test(w)) return null;
    return { kind: "modal", ...base };
  }
  if (w === "to") return { kind: "to", ...base };
  // Imperatives: "Please advice me", "And never breath a word".
  if (w === "please") return { kind: "subject", ...base };
  if (
    i > 0 &&
    /^(?:never|always|just)$/.test(b[i - 1].w) &&
    (opens(t) || /^(?:and|but|so|then)$/.test(w))
  )
    return { kind: "subject", at: i - 1, adverbs: i - 1 };
  // "How will this outage effect…": an inverted question with a determiner + noun subject.
  if (
    i === 0 &&
    !FUNCTION.has(w) &&
    !englishWordInfo(w)?.adjective &&
    isWord(b[1]) &&
    /^(?:the|this|that|my|your|our|their|his|its)$/.test(b[1].w) &&
    isWord(b[2]) &&
    MODAL.has(b[2].w) &&
    ((isWord(b[3]) && /^(?:how|why|when|where|what|which)$/.test(b[3].w)) ||
      (opens(b[3]) && !/^(?:do|does|did)$/.test(b[2].w)))
  )
    return { kind: "modal", at: 2, adverbs: 0 };
  if (INDEFINITE.has(w) || (w === "body" && b[i + 1]?.w === "every"))
    return { kind: "indefinite", ...base };
  if (w === "who") return { kind: "who", ...base };
  return null;
}

/** "to" as an infinitive marker before the target. */
function infinitiveTo(b: Tok[], c: Cue, next: Tok | undefined): boolean {
  const head = b[c.at + 1];
  if (!isWord(head) || PREPOSITION_HEAD.has(head.w)) return false;
  if (c.adverbs > 0 || TO_HEAD.has(head.w)) return true;
  return isWord(next) && OBJECT_START.has(next!.w);
}

type Ctx = DetectContext;
const RULE = "englishConfusedWords";
const KEY: ReviewMessageKey = "review_msg_confused_word";

function make(
  ctx: Ctx,
  start: number,
  end: number,
  alternatives: string[],
  messageKey: ReviewMessageKey = KEY,
): RawFinding | null {
  const typed = ctx.source.slice(start, end);
  const kase = detectWordCase(typed.replace(/[^\p{L}]/gu, "") || typed);
  const cased = alternatives.map((alt) => {
    if (kase === "upper") return alt.toUpperCase();
    if (kase === "title") return alt.charAt(0).toUpperCase() + alt.slice(1);
    return alt;
  });
  if (cased.includes(typed)) return null;
  return finding(RULE, messageKey, start, end, cased, {
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    context: { start: Math.max(0, start - 80), end: Math.min(ctx.text.length, end + 80) },
  });
}

// ---------------------------------------------------------------------------------------------
// Handlers, one per target word family. Each returns the replacement(s) or null.

type Hit = { start: number; end: number; alts: string[]; key?: ReviewMessageKey };
type Handler = (ctx: Ctx, t: Tok, b: Tok[], a: Tok[]) => Hit | Hit[] | null;
const hit = (t: Tok, ...alts: string[]): Hit => ({ start: t.start, end: t.end, alts });

// A noun typed in a verb slot: "I thing", "can advice", "to breath some air".
const NOUN_FOR_VERB: Record<string, string> = {
  advice: "advise",
  belief: "believe",
  breath: "breathe",
  intent: "intend",
  emphasis: "emphasize",
  response: "respond",
  thing: "think",
};
function nounForVerb(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const c = cue(b);
  if (!c || c.kind === "have" || c.kind === "third") return null;
  if (c.kind === "indefinite" && t.w !== "thing") return null;
  if (c.kind === "who" && c.adverbs === 0) return null;
  if (c.kind === "to" && (t.w === "response" || !infinitiveTo(b, c, a[0]))) return null;
  // "intent on": the adjective ("they were intent on winning").
  if (t.w === "intent" && a[0]?.w === "on") return null;
  return hit(t, NOUN_FOR_VERB[t.w]);
}

// A verb typed in a noun slot: "good advise", "my strong believe", "a breathe".
const VERB_FOR_NOUN: Record<string, string> = {
  advise: "advice",
  believe: "belief",
  breathe: "breath",
  intend: "intent",
};
function verbForNoun(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (isWord(a[0]) && OBJECT_START.has(a[0].w)) return null;
  let i = 0;
  if (isWord(b[0]) && plainAdjective(b[0].w)) i = 1;
  const p = b[i];
  const noun =
    (isWord(p) && (DETERMINER.has(p.w) || /^(?:of|for|without)$/.test(p.w))) ||
    // "Good advise", "potentially bad advise", "Take deep breathe"
    (i === 1 &&
      (opens(p) ||
        (isWord(p) && (isAdverb(p.w) || (hasVerb(p.w) && !MODAL.has(p.w) && !SUBJECT.has(p.w))))));
  return noun ? hit(t, VERB_FOR_NOUN[t.w]) : null;
}

// effect/affect in both directions.
function effect(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const third = t.w === "effects";
  const next = a[0];
  if (
    !isWord(next) ||
    /^(?:of|on|in|is|was|are|were|that|for|and|or|to|from|has|have)$/.test(next.w)
  )
    return null;
  if (a.slice(0, 3).some((x) => EFFECT_OBJECT.has(x.w)) || next.w === "a" || next.w === "an")
    return null;
  const c = cue(b);
  const alt = third ? "affects" : "affect";
  if (c) {
    if (third ? c.kind === "third" && c.adverbs >= 0 : c.kind === "modal" || c.kind === "subject")
      return hit(t, alt);
    if (!third && c.kind === "to" && infinitiveTo(b, c, next) && OBJECT_START.has(next.w))
      return hit(t, alt);
    if (!third && c.kind === "to" && TO_HEAD.has(b[c.at + 1]?.w ?? "")) return hit(t, alt);
  }
  // "droughts severely effect crop yields", "outages effect our customers".
  let i = 0;
  while (i < 2 && isWord(b[i]) && isAdverb(b[i].w) && b[i].w !== "not") i++;
  const s = b[i];
  if (!isWord(s) || DETERMINER.has(s.w)) return null;
  const info = englishWordInfo(s.w);
  const subject = third
    ? info?.noun && !info.plural
    : info?.plural || (!info && /[^s]s$/.test(s.w));
  if (!subject || (i === 0 && !OBJECT_START.has(next.w))) return null;
  // The subject opens its clause, maybe after a determiner and modifiers: "have side effects it…" does not.
  let j = i + 1;
  const modifier = (w: string) => {
    if (FUNCTION.has(w) || HAVE.has(w) || MODAL.has(w) || BE_FINITE.has(w)) return false;
    const info = englishWordInfo(w);
    // "Prolonged droughts", "Lighting conditions": participles modify the subject noun too.
    return (
      !info ||
      info.noun ||
      info.plural ||
      info.adjective ||
      info.verbs.some((v) => v.form === "participle" || v.form === "ing")
    );
  };
  while (j < i + 3 && isWord(b[j]) && modifier(b[j].w)) j++;
  if (
    !opens(b[j]) &&
    !(
      isWord(b[j]) &&
      (DETERMINER.has(b[j].w) || CONJUNCTION.has(b[j].w) || /^(?:these|those)$/.test(b[j].w))
    )
  )
    return null;
  return hit(t, alt);
}
const COLLOCATION = set(
  "side special sound placebo ripple snowball greenhouse domino butterfly halo net desired intended unintended cumulative opposite adverse visual audio cascading chilling lasting overall combined positive negative",
);
function affect(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const alt = t.w === "affects" ? "effects" : "effect";
  const next = a[0];
  // "affect on/of": only the noun takes these; "affects on average" is the verb.
  if (isWord(next) && /^(?:on|upon|of)$/.test(next.w) && a[1]?.w !== "average") return hit(t, alt);
  // "have an affect", "had little affect", "will have the opposite affect"
  let i = 0;
  while (
    i < 3 &&
    isWord(b[i]) &&
    (DETERMINER.has(b[i].w) ||
      /^(?:little|much|any|some|great|big)$/.test(b[i].w) ||
      plainAdjective(b[i].w) ||
      englishWordInfo(b[i].w)?.adjective)
  )
    i++;
  if (i > 0 && isWord(b[i]) && HAVE.has(b[i].w)) return hit(t, alt);
  // "put the plan into affect", "comes into affect"; "research into affect regulation" is the noun.
  if (
    b[0]?.w === "into" &&
    b
      .slice(1, 6)
      .some((x) =>
        /^(?:put|puts|putting|come|comes|came|coming|go|goes|went|going|gone|bring|brings|brought|bringing)$/.test(
          x.w,
        ),
      )
  )
    return hit(t, alt);
  // "now in affect", "remains in affect"
  if (
    b[0]?.w === "in" &&
    isWord(b[1]) &&
    /^(?:is|are|was|were|be|been|now|still|already|remain|remains|remained|stay|stays|stayed|currently|fully|come|comes|came)$/.test(
      b[1].w,
    )
  )
    return hit(t, alt);
  // "Sound affects were added", "its sound affect remains"
  if (isWord(b[0]) && COLLOCATION.has(b[0].w) && (!isWord(next) || !OBJECT_START.has(next.w))) {
    if (
      !isWord(next) ||
      /^(?:is|are|was|were|remain|remains|remained|can|could|will|would|may|might|amplified|warms|included|include|includes|across|throughout|than)$/.test(
        next.w,
      ) ||
      ends(next)
    )
      return hit(t, alt);
  }
  return null;
}

// "I'm bias", "he is worry about", "we were shock": a noun or verb where be needs the adjective.
const BE_ADJECTIVE: Record<string, string> = {
  bias: "biased",
  concern: "concerned",
  prejudice: "prejudiced",
  worry: "worried",
  shock: "shocked",
};
const PERSONAL_BE = set("i'm im i'am he's she's we're you're they're theyre");
function beAdjective(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  let i = 0;
  while (i < 2 && isWord(b[i]) && isAdverb(b[i].w)) i++;
  const be = b[i];
  if (!isWord(be)) return null;
  const personal =
    PERSONAL_BE.has(be.w) ||
    (/^(?:am|is|are|was|were)$/.test(be.w) &&
      isWord(b[i + 1]) &&
      /^(?:i|he|she|we|you|they)$/.test(b[i + 1].w));
  if (!personal) return null;
  // "you're worry is…" is "your worry"; "worry free" is a compound.
  if (isWord(a[0]) && /^(?:is|was|are|were|has|have|had|will|can|free)$/.test(a[0].w)) return null;
  // "they're shock jocks", "worry warts": a noun compound.
  if (isWord(a[0]) && englishWordInfo(a[0].w)?.plural) return null;
  return hit(t, BE_ADJECTIVE[t.w]);
}

// "modal + safe" is the verb save: "You should safe your work".
function safe(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const next = a[0];
  if (
    !isWord(next) ||
    /^(?:to|from|for|and|or|enough|with|in|on|at|than|as|by|if|when|place|mode|side|now|here)$/.test(
      next.w,
    )
  )
    return null;
  const c = cue(b);
  if (!c) return null;
  if (
    c.kind === "modal" ||
    (c.kind === "to" && infinitiveTo(b, c, next) && OBJECT_START.has(next.w))
  )
    return hit(t, "save");
  return null;
}

// "you weigh" at a clause end: "How much do you weight?"
// "weight" is also a verb ("we weight each sample"), so only a clause-final one after do/than.
function weight(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (!ends(a[0]) || !isWord(b[0]) || !/^(?:i|you|we|they|he|she|it)$/.test(b[0].w)) return null;
  return isWord(b[1]) && /^(?:do|does|did|than|will|would|can|could|should|might|may)$/.test(b[1].w)
    ? hit(t, "weigh")
    : null;
}

// "I bough a laptop": the past of buy after a subject or have.
function bough(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const c = cue(b);
  if (!c || !/^(?:subject|third|have)$/.test(c.kind) || !isWord(a[0])) return null;
  return hit(t, "bought");
}

// "I fell like…", "please fell free", "didn't fell good": feel before its complements.
const FALL_STATE = set(
  "ill sick silent asleep quiet dead flat short open vacant due pregnant still hard heavy low apart behind back down away foul unconscious limp loose dark empty idle mute",
);
function fell(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const c = cue(b);
  if (!c || !/^(?:subject|modal|who)$/.test(c.kind)) return null;
  const n = a[0];
  if (!isWord(n)) return null;
  const n1 = a[1];
  let feel = false;
  if (n.w === "like")
    feel = !isWord(n1) || !/^(?:a|an|the|rain|dominoes|flies|stones?|rocks?)$/.test(n1.w);
  else if (n.w === "free" || n.w === "that") feel = true;
  else if (/^(?:i|i'm|i've|i'd|we|you|they|he|she|it's|that's|there's|this)$/.test(n.w))
    feel = true;
  else if (n.w === "it")
    feel =
      isWord(n1) &&
      !!englishWordInfo(n1.w)?.verbs.some((v) => v.form === "third" || v.form === "past");
  else if (!FALL_STATE.has(n.w)) {
    const info = englishWordInfo(n.w);
    feel = !!info && info.adjective && !info.adverb;
  }
  return feel ? hit(t, "feel") : null;
}

// quiet for quite: before a degree-taking adjective at a clause end, or a verb after can't.
function quiet(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  if (!isWord(n)) return null;
  const info = englishWordInfo(n.w);
  // "That was quiet remarkable."
  const verbal = info?.verbs.every((v) => v.form === "ing" || v.form === "participle");
  if (info && info.adjective && !info.noun && verbal && !ADVERBISH.has(n.w)) {
    const n1 = a[1];
    if (ends(n1) || /^(?:that|to|and|but|for|in|at)$/.test(n1.w)) return hit(t, "quite");
  }
  // "I can't quiet read it"
  if (/n't$|^(?:not|never)$/.test(b[0]?.w ?? "") && baseVerb(n.w) && !OBJECT_PRONOUN.has(n.w)) {
    if (
      !/^(?:down|up|people|things|everyone|everybody|them|us|the|a|an)$/.test(n.w) &&
      !englishWordInfo(n.w)?.plural
    )
      return hit(t, "quite");
  }
  return null;
}

// "everything was find": fine after be at a clause end.
function find(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  let i = 0;
  if (isWord(b[0]) && /^(?:all|totally|perfectly|just|really|also)$/.test(b[0].w)) i = 1;
  const be = b[i];
  if (
    !isWord(be) ||
    !/^(?:am|is|are|was|were|be|been|i'm|im|it's|that's|we're|you're|they're|he's|she's)$/.test(
      be.w,
    )
  )
    return null;
  const n = a[0];
  if (
    !ends(n) &&
    !/^(?:for|with|but|and|now|not|by|here|there|too|as|so|though|otherwise|either|without)$/.test(
      n.w,
    )
  )
    return null;
  return hit(t, "fine");
}

// hop/hope: "I hop we can", and hope for hop before a vehicle or call.
const BOARDED = set(
  "bus train plane airplane flight call boat ferry bike horse car taxi cab subway tram meeting stream server",
);
function hop(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (t.w === "hop" || t.w === "hops") {
    if (!isWord(b[0]) || !/^(?:i|we|they|you)$/.test(b[0].w)) return null;
    if (
      !isWord(a[0]) ||
      !/^(?:we|you|i|they|he|she|that|this|everything|everyone|so|not|it'll|it's|you're|we're|they're)$/.test(
        a[0].w,
      )
    )
      return null;
    return hit(t, t.w === "hop" ? "hope" : "hopes");
  }
  if (a[0]?.w !== "on" || !isWord(a[1]) || !/^(?:a|an|the|my|our|your|their|his|her)$/.test(a[1].w))
    return null;
  if (!isWord(a[2]) || !BOARDED.has(a[2].w)) return null;
  // "I hope on the train there's wifi": hope + a clause.
  if (
    isWord(a[3]) &&
    /^(?:we|you|i|they|he|she|it|there|there's|it's|everyone|someone|this|that)$/.test(a[3].w)
  )
    return null;
  const alt = { hope: "hop", hopes: "hops", hoped: "hopped", hoping: "hopping" }[t.w];
  return alt ? hit(t, alt) : null;
}

// "Bob cant go", "Cant you…": can't before a bare verb or an inverted pronoun.
function cant(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (t.text === "CANT" || !isWord(a[0])) return null;
  const n = a[0].w;
  if (opens(b[0]) && /^(?:you|we|i|they|he|she|it)$/.test(n))
    return { ...hit(t, "can't"), key: "review_msg_contraction" };
  const v = isAdverb(n) && isWord(a[1]) ? a[1].w : n;
  if (v === "cant") return null;
  const info = englishWordInfo(v);
  if (!info?.verbs.some((x) => x.form === "base") || info.plural || DETERMINER.has(v)) return null;
  // "the cant of the roof", "political cant".
  if (isWord(b[0]) && (DETERMINER.has(b[0].w) || plainAdjective(b[0].w))) return null;
  return { ...hit(t, "can't"), key: "review_msg_contraction" };
}

// rouge (make-up) for rogue: "lip rogue", "Rogue Lipstick--".
function rogue(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  return b[0]?.w === "lip" || a[0]?.w === "lipstick" ? hit(t, "rouge") : null;
}

// "He roller skated home": the verb is hyphenated; "the roller skated" is a noun subject.
function roller(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  if (n?.w !== "skated" || ctx.text.slice(t.end, n.start).includes("\n")) return null;
  if (isWord(b[0]) && (DETERMINER.has(b[0].w) || plainAdjective(b[0].w))) return null;
  const sep = ctx.text.slice(t.end, n.start);
  if (!/^[ \t\u00a0]+$/.test(sep)) return null;
  return {
    start: t.start,
    end: n.end,
    alts: [`${t.text}-${n.text}`],
    key: "review_msg_closed_compound",
  };
}

// summery (summer-like) where the noun summary is meant.
const SEASONAL = set(
  "dress dresses outfit outfits look looks vibe vibes day days weather colors colours colour color feel style scent salad drink drinks cocktail cocktails evening afternoon morning mood palette print prints fabric hue hues tones tone flavor flavour sundress breeze night nights read",
);
function summery(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (ctx.text[t.start - 1] === "-") return null;
  if (isWord(a[0]) && SEASONAL.has(a[0].w) && ctx.text[t.end] !== "-") return null;
  if (
    isWord(b[0]) &&
    /^(?:very|so|too|quite|more|most|rather|really|pretty|feel|feels|felt|look|looks|looked|sound|sounds|seem|seems)$/.test(
      b[0].w,
    )
  )
    return null;
  // "The weather is summery." / "is summery and warm": a predicate adjective.
  if (
    isWord(b[0]) &&
    /^(?:is|was|are|were|be|been|it's|that's)$/.test(b[0].w) &&
    (ends(a[0]) || /^(?:and|but|with|today|again|now|outside)$/.test(a[0].w))
  )
    return null;
  return hit(t, "summary");
}

// "theses days", "I like theses apples": the demonstrative before a plural noun.
function theses(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  if (!isWord(n)) return null;
  const info = englishWordInfo(n.w);
  if (!(info ? info.plural : /[^s]s$/.test(n.w))) return null;
  const p = b[0];
  if (
    isWord(p) &&
    (DETERMINER.has(p.w) ||
      /^(?:these|those|some|many|several|two|three|both|all|her|doctoral|master's|masters|phd|other|such|their|whose)$/.test(
        p.w,
      ) ||
      /['’]s$/.test(p.w) ||
      /^\d/.test(p.w) ||
      plainAdjective(p.w))
  )
    return null;
  return hit(t, "these");
}

// "brandish him a traitor": brand someone.
const BRAND: Record<string, string> = {
  brandish: "brand",
  brandishes: "brands",
  brandished: "branded",
  brandishing: "branding",
};
function brandish(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (!isWord(a[0]) || !/^(?:him|her|them|us|me|you)$/.test(a[0].w)) return null;
  if (!isWord(a[1]) || !/^(?:a|an|as|with)$/.test(a[1].w)) return null;
  return hit(t, BRAND[t.w]);
}

// "deny the offer": an offer is declined or rejected.
const DENY: Record<string, [string, string]> = {
  deny: ["decline", "reject"],
  denies: ["declines", "rejects"],
  denied: ["declined", "rejected"],
  denying: ["declining", "rejecting"],
};
function deny(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  let i = 0;
  if (isWord(a[0]) && /^(?:the|an|your|their|his|her|my|our|this|that|any|every|all)$/.test(a[0].w))
    i = 1;
  if (!isWord(a[i]) || !/^offers?$/.test(a[i].w)) return null;
  // "deny the offer was made": deny a claim.
  const gerundSubject =
    t.w === "denying" && (opens(b[0]) || (isWord(b[0]) && isAdverb(b[0].w) && opens(b[1])));
  if (
    !gerundSubject &&
    isWord(a[i + 1]) &&
    /^(?:was|is|were|are|had|has|existed|exists|ever)$/.test(a[i + 1].w)
  )
    return null;
  return hit(t, ...DENY[t.w]);
}

// dissemble (feign) for disassemble (take apart).
function dissemble(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  const later = /\bassembl/i.test(ctx.text.slice(t.end, t.end + 80));
  const object =
    isWord(n) &&
    /^(?:the|a|an|my|this|that|it|them|these|those|his|her|our|their|your|from)$/.test(n.w);
  if (!later && !object && ctx.text[t.end] !== "/") return null;
  return hit(t, t.w.replace(/^dissembl/, "disassembl"));
}

// "whatever that I have": a relative pronoun after whatever/whoever/whenever.
function everRelative(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const rel = a[0];
  if (!isWord(rel) || !/^(?:that|which|who)$/.test(rel.w)) return null;
  const n = a[1];
  if (!isWord(n)) return null;
  if (rel.w === "that" && !/^(?:i|i've|i'm|i'd|you|we|they|he|she|you've|we've|they've)$/.test(n.w))
    return null;
  if (rel.w === "which" && /^(?:way|one|ones)$/.test(n.w)) return null;
  if (rel.w === "who" && t.w !== "whoever" && t.w !== "whatever") return null;
  return { start: t.end, end: rel.end, alts: [""] };
}

// everyday as a subject or before a subject: "Everyday is the same", "everyday we adapt".
function everyday(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  const p = b[0];
  if (
    isWord(p) &&
    /^(?:the|an?|word|is|are|was|were|be|so|very|quite|more|most|less|such|of|called|named|my|your|our|their|his|her|its)$/.test(
      p.w,
    )
  )
    return null;
  let ok = false;
  // "Everyday is…" opens a sentence capitalized; a product name would be quoted or cased.
  if (
    isWord(n) &&
    /^(?:is|was|feels?|seems?|brings|starts|begins)$/.test(n.w) &&
    ((opens(p) && /^[Ee]veryday$/.test(t.text)) ||
      (isWord(p) && /^(?:does|did|why|and|but|because|so)$/.test(p.w)))
  )
    ok = true;
  if (isWord(n) && /^(?:we|i|you|they|he|she)$/.test(n.w) && (opens(p) || p?.text === ","))
    ok = true;
  // Shouted text: "MEET SOMEONE NEW EVERYDAY."
  if (t.text === "EVERYDAY" && ends(n) && isWord(p) && p.text === p.text.toUpperCase()) ok = true;
  return ok ? { ...hit(t, "every day"), key: "review_msg_every_day" } : null;
}

// "slower that the same build": that for than after an -er comparative.
// An -er comparative of an adjective the lexicon knows: "taller", "bigger", "stupider".
function comparative(w: string): boolean {
  if (w.length < 5 || !w.endsWith("er")) return false;
  const info = englishWordInfo(w);
  if (!info || info.noun || info.verbs.length) return false;
  const stem = w.slice(0, -2);
  // -er comparatives come from one-syllable adjectives and -y/-le/-ow ones: not "presenter".
  if ((stem.match(/[aeiouy]+/g) ?? []).length > 1 && !/(?:i|l|ow)$/.test(stem) && w !== "stupider")
    return false;
  return [stem, `${stem}e`, stem.replace(/(.)\1$/, "$1"), stem.replace(/i$/, "y")].some(
    (base) => englishWordInfo(base)?.adjective,
  );
}
// Comparatives that also open "that" clauses or phrases: "better that you go", "later that day".
const CLAUSE_COMPARATIVE = set(
  "better worse more less later earlier sooner rather further farther other latter former fewer lesser",
);
const BE_FINITE = set("is are was were has have had");
function thatThan(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const p = b[0];
  if (!isWord(p) || p.text !== p.w || CLAUSE_COMPARATIVE.has(p.w) || !comparative(p.w)) return null;
  // "no longer that…", "so much faster that…", and extraposed "make it clearer that…".
  if (b[1]?.w === "no" || b.slice(1, 6).some((x) => /^(?:so|such)$/.test(x.w))) return null;
  if (b.slice(1, 4).some((x) => x.w === "it" || x.w === "it's")) {
    const clause = a.slice(0, 8);
    const stop = clause.findIndex((x) => !isWord(x));
    const finite = (stop < 0 ? clause : clause.slice(0, stop)).some(
      (x) =>
        MODAL.has(x.w) ||
        BE_FINITE.has(x.w) ||
        !!englishWordInfo(x.w)?.verbs.some((v) => v.form === "past" || v.form === "third"),
    );
    if (finite) return null;
  }
  const n = a[0];
  if (!isWord(n)) return null;
  const info = englishWordInfo(n.w);
  // "no longer that simple", "bigger that way".
  if (
    (info?.adjective && !info.noun) ||
    info?.adverb ||
    /^(?:way|much|is|was|it|i|you|we|they|he|she)$/.test(n.w)
  )
    return null;
  return { ...hit(t, "than"), key: "review_msg_then_than" };
}

// "stupider then her", "better then no bread". "met her earlier then him" stays a sequence;
// right after an intransitive verb ("arrived earlier then him") it compares.
function thenThan(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const p = b[0];
  if (!isWord(p) || ctx.text.slice(p.end, t.start).includes(",")) return null;
  const n = a[0];
  if (!isWord(n)) return null;
  const verb = isWord(b[1]) ? englishWordInfo(b[1].w) : null;
  const compared =
    (comparative(p.w) &&
      (!/^(?:earlier|later)$/.test(p.w) ||
        (!!verb?.verbs.some((v) => v.form === "past") && !verb.noun && !verb.adjective))) ||
    /^(?:better|worse|more|less)$/.test(p.w) ||
    (isWord(b[1]) && /^(?:more|less)$/.test(b[1].w));
  if (!compared) return null;
  const n1 = a[1];
  const closes = ends(n1) || /^(?:but|and|at|in|on|too|or|for)$/.test(n1.w);
  if (/^(?:her|him|me|us|them|some|most|others|many|few|anyone|everyone)$/.test(n.w) && closes)
    return { ...hit(t, "than"), key: "review_msg_then_than" };
  // "better then no bread"
  if (n.w === "no" && isWord(n1) && /^(?:better|worse)$/.test(p.w))
    return { ...hit(t, "than"), key: "review_msg_then_than" };
  return null;
}

// Verbs that take a clause: "I found it's broken", "she said it's code".
const CLAUSE_VERB = set(
  "think thinks thought guess know knew knows hope hoped hopes say said says believe believed mean means meant seem seems seemed feel feels felt sure suppose found find finds realized realised noticed heard hear saw see read learned discovered figured decided assume assumed promise bet agree agreed admit admitted show shows showed prove proves proved confirm confirms confirmed ensure claim claims claimed suggest suggests suggested note notes noted forget forgot remember remembered understand understood explain explained argue argued insist insisted doubt doubted suspect suspected wonder wondered check checked verify verified looks sounds is was",
);
// its/it's in frames the core detector leaves out.
function its(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const contraction = t.w !== "its";
  const n = a[0];
  if (!isWord(n)) return null;
  const its = { ...hit(t, "its"), key: "review_msg_its_possessive" as const };
  if (!contraction) {
    // "I guess its March 6.", "They doubt its Tesla this year."
    if (
      !isWord(b[0]) ||
      !/^(?:think|thinks|hope|hopes|guess|assume|doubt|suppose|believe|bet)$/.test(b[0].w)
    )
      return null;
    if (!/^\p{Lu}\p{Ll}/u.test(n.text)) return null;
    const rest = a.slice(1, 4);
    const tail =
      ends(rest[0]) ||
      (/^\d/.test(rest[0].text) && ends(rest[1])) ||
      (/^(?:this|next|last)$/.test(rest[0].w) && isWord(rest[1]) && ends(rest[2]));
    return tail ? { ...hit(t, "it's"), key: "review_msg_its_contraction" } : null;
  }
  // "lost it's 7th chapter", "at it's 8th floor"
  if (
    /^\d+(?:st|nd|rd|th)$/.test(n.w) &&
    isWord(a[1]) &&
    (englishWordInfo(a[1].w)?.noun ?? true) &&
    isWord(b[0]) &&
    !opens(b[0])
  ) {
    const p = b[0].w;
    if (
      !/^(?:think|guess|know|hope|say|said|says|believe|sure|suppose|mean|means|seems|now|so|and|but|because|that|if|when)$/.test(
        p,
      )
    )
      return its;
  }
  const info = englishWordInfo(n.w);
  const nounOnly =
    !!info &&
    (info.noun || info.plural) &&
    !info.adjective &&
    !info.adverb &&
    !/(?:ing|ed)$/.test(n.w);
  // "It's ancestor is still around."
  if (
    (opens(b[0]) || b[0]?.text === ",") &&
    isWord(a[1]) &&
    /^(?:is|was|has|are|were|have)$/.test(a[1].w) &&
    (nounOnly || (!info && !/(?:ing|ed|ly)$/.test(n.w))) &&
    !/^(?:time|everything|nothing|something|anything|one|what|who|this|that|here|there|now|all)$/.test(
      n.w,
    )
  )
    return its;
  // "The engine lost it's compression.": a verb that takes no clause, then one noun.
  // "he recognizes it's Bob", "whose hands it's in": a name or a stranded preposition.
  if (
    nounOnly &&
    n.text === n.w &&
    !/^(?:in|on|at|for|from|with|by|about|of|to|up|down|out|off|over|under|there|here)$/.test(
      n.w,
    ) &&
    ends(a[1]) &&
    isWord(b[0]) &&
    !CLAUSE_VERB.has(b[0].w) &&
    englishWordInfo(b[0].w)?.verbs.some((v) => v.form === "past" || v.form === "third")
  )
    return its;
  // "I like it's various colors"
  if (n.w === "various" && isWord(a[1]) && !/^(?:who|that|which)$/.test(a[2]?.w ?? "")) return its;
  // "Understand it's code, it's values, and it's purpose."
  const listed = (x: Tok | undefined) => isWord(x) && /^it's$/.test(x!.w);
  if (nounOnly && a[1]?.text === "," && (listed(a[2]) || (a[2]?.w === "and" && listed(a[3]))))
    return its;
  if (nounOnly && b[0]?.text === "," && listed(b[2])) return its;
  if (nounOnly && b[0]?.w === "and" && b[1]?.text === "," && listed(b[3])) return its;
  return null;
}

// lets/let's: "so lets push", "lets proceed", "The crutch let's him walk".
const LETS_CUE = set("so then now ok okay well first next finally maybe hey end guys");
function lets(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  if (!isWord(n)) return null;
  if (t.w === "let's") {
    // "let's" + object pronoun: "it let's us do", "let's me do".
    if (!/^(?:me|us|him|her|them|you)$/.test(n.w) || !isWord(a[1]) || !baseVerb(a[1].w))
      return null;
    return { ...hit(t, "lets"), key: KEY };
  }
  if (!opens(b[0]) && !(isWord(b[0]) && LETS_CUE.has(b[0].w))) return null;
  // "let Align = new…": a capitalized name after it is code or a title.
  if (n.text !== n.w || n.w.length < 2 || a.slice(1, 3).some((x) => x.text === "=")) return null;
  const info = englishWordInfo(n.w);
  if (!info?.verbs.some((v) => v.form === "base") || info.plural || OBJECT_START.has(n.w))
    return null;
  // "lets staff restore", "Let chance decide": a noun reading needs an object after the verb.
  // "Let angle A be x": a capital letter after it is a variable, not an article.
  if (
    (info.noun || info.adjective) &&
    !(isWord(a[1]) && OBJECT_START.has(a[1].w) && a[1].text === a[1].w)
  )
    return null;
  if (
    t.w === "let" &&
    (/^(?:go|slip|fly|pass|drop|fall|rip|loose|be|know)$/.test(n.w) || !opens(b[0]))
  )
    return null;
  return { ...hit(t, "let's"), key: "review_msg_lets_contraction" };
}

// "you're PR was merged", "You're car is black": the possessive before a noun and a verb.
function youre(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  const n = a[0];
  if (!isWord(n) || !isWord(a[1]) || !/^(?:is|was|has|had|are|were)$/.test(a[1].w)) return null;
  const info = englishWordInfo(n.w);
  const noun =
    /^[A-Z]{2,}$/.test(n.text) ||
    (!!info &&
      (info.noun || info.plural) &&
      !info.adjective &&
      !info.adverb &&
      !/(?:ing|ed)$/.test(n.w));
  if (!noun || /^(?:all|both|each|one|right|welcome|here|there|now|what|who)$/.test(n.w))
    return null;
  return { ...hit(t, "your"), key: "review_msg_your_possessive" };
}

// "Were the best team." / "were a good team": we're at a clause start before a closed noun phrase.
function were(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (!opens(b[0]) || !isWord(a[0]) || !/^(?:a|an|the)$/.test(a[0].w)) return null;
  let i = 1;
  for (; i < 5 && isWord(a[i]); i++) {
    const info = englishWordInfo(a[i].w);
    if (
      info?.verbs.some((v) => v.form === "past" || v.form === "participle" || v.form === "third") &&
      !info.noun
    )
      return null;
    if (/(?:ed|ing)$/.test(a[i].w) || /^(?:there|here|you|we|they|it|he|she|i)$/.test(a[i].w))
      return null;
  }
  const end = a[i];
  if (i < 3 || (end && !/^[.!]$/.test(end.text))) return null;
  return hit(t, "we're");
}

// "open the TV": a device is turned on.
const DEVICE = set("tv television lights light fan radio aircon ac heater heating stove");
const TURN: Record<string, string> = {
  open: "turn on",
  opens: "turns on",
  opened: "turned on",
  opening: "turning on",
};
function openDevice(ctx: Ctx, t: Tok, b: Tok[], a: Tok[]): Hit | null {
  if (
    !isWord(a[0]) ||
    !/^(?:the|my|your|our|their|his|her)$/.test(a[0].w) ||
    !isWord(a[1]) ||
    !DEVICE.has(a[1].w)
  )
    return null;
  // "open the TV app", "opens the TV up to", "the fan control": only a clause boundary may follow.
  const n = a[2];
  if (
    isWord(n) &&
    !/^(?:to|when|and|so|for|because|now|please|before|after|while|if|again|then|or)$/.test(n.w)
  )
    return null;
  return hit(t, TURN[t.w]);
}

const HANDLERS: Record<string, Handler> = {
  ...Object.fromEntries(Object.keys(NOUN_FOR_VERB).map((w) => [w, nounForVerb])),
  ...Object.fromEntries(Object.keys(VERB_FOR_NOUN).map((w) => [w, verbForNoun])),
  ...Object.fromEntries(Object.keys(BE_ADJECTIVE).map((w) => [w, beAdjective])),
  ...Object.fromEntries(Object.keys(BRAND).map((w) => [w, brandish])),
  ...Object.fromEntries(Object.keys(DENY).map((w) => [w, deny])),
  ...Object.fromEntries(Object.keys(TURN).map((w) => [w, openDevice])),
  effect,
  effects: effect,
  affect,
  affects: affect,
  safe,
  weight,
  bough,
  fell,
  quiet,
  find,
  hop,
  hops: hop,
  hope: hop,
  hopes: hop,
  hoped: hop,
  hoping: hop,
  cant,
  rogue,
  roller,
  summery,
  theses,
  whatever: everRelative,
  whoever: everRelative,
  whenever: everRelative,
  wherever: everRelative,
  everyday,
  that: thatThan,
  then: thenThan,
  its,
  "it's": its,
  lets,
  "let's": lets,
  let: lets,
  "you're": youre,
  were,
};
const TARGET = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/#\\\\.-])(?:${Object.keys(HANDLERS)
    .map((w) => w.replaceAll("'", "['’]"))
    .sort((x, y) => y.length - x.length)
    .join("|")}|dissembl[a-z]*)(?![\\p{L}\\p{N}_'’@#\\\\])`,
  "giu",
);

const QUOTE = /^["“”'‘’]$/;
/** A quoted example: a quote within a word of each side ("I cant go" in a style guide). */
function mentioned(ctx: Ctx, h: Hit): boolean {
  const b = before(ctx, h.start).slice(0, 2);
  const a = after(ctx, h.end).slice(0, 2);
  return b.some((t) => QUOTE.test(t.text)) && a.some((t) => QUOTE.test(t.text));
}

function confusedWords(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "en")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, TARGET, (x) => x.index)) {
    const text = m[0];
    const w = text.toLowerCase().replace(/’/g, "'");
    // Mixed case names something; a user word is the user's.
    if (applyWordCase(text, detectWordCase(text)) !== text || ctx.dictionary.has(w)) continue;
    const glue = ctx.text[m.index + text.length];
    if ((glue === "-" && w !== "summery") || (glue === "/" && !/^(?:dissembl|bias)/.test(w)))
      continue;
    const t: Tok = { text, w, start: m.index, end: m.index + text.length };
    const handler = w.startsWith("dissembl") ? dissemble : HANDLERS[w];
    const result = handler(ctx, t, before(ctx, t.start), after(ctx, t.end));
    for (const h of [result ?? []].flat()) {
      if (mentioned(ctx, h)) continue;
      // Evidence words the user added to the dictionary or cased as names abstain.
      const finding = make(ctx, h.start, h.end, h.alts, h.key);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [RULE],
    detect: confusedWords,
  },
];
