import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { before, group } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { clauseAfter, objectGapBefore, PERMISSION_AFTER } from "./slotWords";

// ---- Context detectors: forms that are also ordinary English elsewhere. ----

export type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
export const PHRASE: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_phrase_correction",
};
export const CONTEXT: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
};
export const TYPO: Rule = { ruleId: "englishPhraseCorrections", messageKey: "review_msg_typo" };
export const COMPOUND: Rule = {
  ruleId: "englishContextualCompounds",
  messageKey: "review_msg_compounds",
};

/** Replacements for the `target` group (or `range`); `raw` keeps their casing as given. */
export type Fix = {
  alternatives: readonly string[];
  range?: readonly [number, number];
  raw?: true;
};
export type FixResult = string | readonly string[] | Fix | null;
export type Frame = {
  rule: Rule;
  /** The frame runs only when one of these words occurs near the chunk. */
  cue?: readonly string[];
  pattern: string | RegExp;
  fix: string | readonly string[] | ((m: RegExpExecArray, ctx: DetectContext) => FixResult);
};

// Function words the lexicon also lists as nouns ("it", "you", "the ins and outs").
const FUNCTION_WORD =
  /^(?:i|me|my|you|your|he|him|his|she|her|it|its|we|us|our|they|them|their|this|that|these|those|the|a|an|if|in|on|at|to|for|with|by|of|off|out|up|down|over|than|and|or|but|so|as|when|because|since|after|before|until|now|then|again|here|there|yet|still|too|very|is|are|was|were|be|been)$/i;
/** A word the lexicon knows as a noun; unknown words are not. */
const nounLike = (word: string | undefined) => {
  if (!word || FUNCTION_WORD.test(word)) return false;
  const known = englishWordInfo(word);
  return !!known && (known.noun || known.plural);
};
/** The word after `end`, or "" when punctuation or the text end comes first. */
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t\u00a0]{1,8}([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u.exec(ctx.text.slice(end, end + 48))?.[1] ?? "";
const matchEnd = (m: RegExpExecArray) => m.index + m[0].length;

/** The typed casing carried onto a replacement: all capitals, or an initial capital. */
export function recase(typed: string, alternative: string, whole: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  const all = whole.replace(/\P{L}/gu, "");
  if (
    letters &&
    letters === letters.toUpperCase() &&
    (letters.length > 1 || all === all.toUpperCase())
  )
    return alternative.toUpperCase();
  return /^\P{L}*\p{Lu}/u.test(typed)
    ? alternative.replace(/\p{L}/u, (c) => c.toUpperCase())
    : alternative;
}

const OBJECT_START = /^(?:the|a|an|my|your|his|her|its|our|their|it|them|him|me|us|you)$/i;
// "need help the most": a degree phrase, not an object.
const DEGREE_AFTER_THE =
  /^[ \t\u00a0]+the[ \t\u00a0]+(?:most|least|best|whole|rest|same|entire|other)\b/i;
const TIME_AFTER =
  /^[ \t\u00a0]+(?:an?|the|this|that|every)[ \t\u00a0]+(?:hour|minute|moment|second|day|week|month|year|while|night|morning|evening)\b/i;
const SUBORDINATE_LEAD =
  /(?:^|[.!?;:\n][ \t\u00a0"“]*)(?:when|whenever|if|after|before|because|while|once|until|since)\b[^.!?;:,\n]*$/i;
function missingTo(m: RegExpExecArray, ctx: DetectContext): string | null {
  const verb = m.groups!.target;
  const known = englishWordInfo(verb);
  // "need further details", "want better tools": comparatives the dictionary lists as verbs.
  if (
    !known?.verbs.some((v) => v.form === "base") ||
    /^(?:be|not|do|further|farther|better|worse|lower|less)$/i.test(verb)
  )
    return null;
  // "agree with", "try out": function words; "tried create+modify" names an operation;
  // "They plan deploy" at the text end may still be typed.
  const rest = ctx.text.slice(matchEnd(m));
  if (FUNCTION_WORD.test(verb) || /^[^\s.,;:!?)]/u.test(rest) || !/\S/.test(rest)) return null;
  // "If it is not what you wanted please let me know": please opens the next clause, and so
  // does a subject + auxiliary ("if you need help you should ask").
  if (/^please$/i.test(verb) || clauseAfter(ctx, matchEnd(m))) return null;
  // "anything you need let me know", "the things he needs depend on": a relative clause. The
  // text before the governor is the match without its last two words.
  if (objectGapBefore(`${before(ctx, m.index, 48)}${m[0]}`.replace(/\s*\S+\s+\S+$/, "")))
    return null;
  const end = matchEnd(m);
  const next = nextWord(ctx, end);
  // "need write access", "want read rights": the verb names a kind of permission.
  if (PERMISSION_AFTER.test(ctx.text.slice(end, end + 32))) return null;
  if (!known.noun && !known.adjective && !known.plural && !known.adverb) return `to ${verb}`;
  // "When we needed help the neighbours came": after a fronted subordinate clause, a noun
  // object can end the clause before the main clause (with no comma).
  if (SUBORDINATE_LEAD.test(before(ctx, m.index, 64))) return null;
  // A word that is also a noun needs an object or "about" after it: "need talk about". A time
  // phrase is no object: "wanted cake an hour ago".
  if (/^about$/i.test(next)) return `to ${verb}`;
  const after = ctx.text.slice(end, end + 32);
  return OBJECT_START.test(next) && !DEGREE_AFTER_THE.test(after) && !TIME_AFTER.test(after)
    ? `to ${verb}`
    : null;
}

// ---- "since two weeks": a length of time takes "for", or "since … ago" for a start. ----
function sinceDuration(m: RegExpExecArray, ctx: DetectContext): Fix | null {
  const { unit, target } = m.groups!;
  // "Since two days were lost, …": the duration is a subject and "since" means "because".
  const next = nextWord(ctx, matchEnd(m));
  if (CLAUSE_VERB.test(next) || hasVerbForm(next, "past", "third")) return null;
  // A following space joins the range, so "ago" lands before the next word.
  const space = /^[ \t\u00a0]*/.exec(ctx.text.slice(matchEnd(m)))![0];
  const [start, end] = group(m, "target");
  const ago = recase(unit, "ago", unit);
  return {
    alternatives: [
      `${recase(target.slice(0, 5), "for", m[0])}${target.slice(5)}${space}`,
      space ? `${target} ${ago}${space}` : `${target} ${ago}`,
    ],
    range: [start, end + space.length],
    raw: true,
  };
}

// ---- "rise the ranks", "raise through the ranks", "rise up in the ranks". ----
const RISE: Record<string, string> = {
  raise: "rise",
  raises: "rises",
  raised: "rose",
  raising: "rising",
  rised: "rose",
};
/** The words between the verb and "the ranks", lowercase and one space apart. */
function ranksMid(m: RegExpExecArray): string {
  const { mid } = m.groups!;
  return mid
    .toLowerCase()
    .trim()
    .replace(/[ \t\u00a0]+/g, " ");
}
/** Errors: a missing preposition, "raise", "rised", or a singular "rank". */
function riseRanks(m: RegExpExecArray): FixResult {
  const verb = m.groups!.verb.toLowerCase();
  const mid = ranksMid(m);
  const plural = /s$/i.test(m.groups!.rank);
  const insert: Fix = { alternatives: ["through the ranks"], range: group(m, "the") };
  if (!(verb in RISE)) {
    if (!mid) return insert;
    return plural ? null : `${m.groups!.verb} through the ranks`;
  }
  // "raise (up) the ranks of" is a transitive "raise"; "rised the ranks" only lacks "through".
  if (!mid || mid === "up")
    return verb !== "rised" ? null : mid ? "rose through the ranks" : insert;
  return verb === "raised"
    ? ["rose through the ranks", "risen through the ranks"]
    : `${RISE[verb]} through the ranks`;
}
/** Style: "rise up the ranks", "rise in the ranks" for the set "rise through the ranks". */
function riseRanksStyle(m: RegExpExecArray): FixResult {
  const mid = ranksMid(m);
  if (m.groups!.verb.toLowerCase() in RISE || !mid || mid === "through") return null;
  return /s$/i.test(m.groups!.rank) ? `${m.groups!.verb} through the ranks` : null;
}

// ---- Phrasal verbs written as their compound noun: "I backup", "to rollback again". ----
const PHRASAL: Record<string, string> = {
  backup: "back up",
  breakup: "break up",
  checkout: "check out",
  cleanup: "clean up",
  comeback: "come back",
  followup: "follow up",
  lookup: "look up",
  pickup: "pick up",
  playback: "play back",
  rollback: "roll back",
  rollout: "roll out",
  setup: "set up",
  shutdown: "shut down",
  signup: "sign up",
  takeover: "take over",
  warmup: "warm up",
  workout: "work out",
};
const phrasal = (m: RegExpExecArray) => PHRASAL[m.groups!.target.toLowerCase()];
// "need to backup if it fails" may name the backup system.
const phrasalInfinitive = (m: RegExpExecArray, ctx: DetectContext) =>
  /^(?:if|when|unless|because|before|after|until|while|and|or|in)$/i.test(
    nextWord(ctx, matchEnd(m)),
  )
    ? null
    : phrasal(m);

const ADVERB_SLOT = /^(?:never|not|just|maybe|always|also|even|only|still|ever|perhaps)$/i;
const AUXILIARY =
  "can|could|will|would|shall|should|may|might|must|do|does|did|am|is|are|was|were|have|has|had";
// A verb right after "since two days" makes the duration a subject.
const CLAUSE_VERB = new RegExp(`^(?:${AUXILIARY}|went|passed|elapsed)$`, "i");
const HIDING =
  /\b(?:hid|hide|hides|hidden|hiding|conceal\w*|keep|keeps|kept|keeping|shield\w*|protect\w*|obscur\w*|disguis\w*|mask\w*|secret\w*|safe|away)\b[^.!?;]*$/i;
const TRASH_AFTER =
  /^(?:away|out|in|into|on|onto|at|over|across|around|everywhere|from|off|down|to|inside|outside|anywhere|there|here)$/i;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // ---- prepositions ----
  idioms5A: (m) => (hasVerbForm(m.groups!.target, "ing") ? `in ${m.groups!.target}` : null),
  idioms5From: (m, ctx) => (HIDING.test(before(ctx, m.index, 80)) ? null : ["to", "with"]),
  idioms5In: (m, ctx) => (nounLike(nextWord(ctx, matchEnd(m))) ? null : "on"),
  idioms5Noun: (m) => (hasVerbForm(m.groups!.ing, "ing") ? `${m.groups!.noun} for` : null),
  idioms5For: (m) => (hasVerbForm(m.groups!.ing, "ing") ? "of" : null),
  idioms5To: (m, ctx) => {
    const next = nextWord(ctx, matchEnd(m));
    // "has a look to it" describes an appearance.
    if (hasVerbForm(next, "base") || (/^ha/i.test(m[0]) && /^(?:it|them)$/i.test(next)))
      return null;
    return "at";
  },
  idioms5Since: sinceDuration,
  idioms5No: (m) => {
    const { no, pron, aux } = m.groups!;
    return { alternatives: [aux ? `${pron} ${aux} ${no}` : `${pron} ${no}`], raw: true };
  },
  idioms5Pron: (m, ctx) =>
    /\bneither\b[^,.!?;:]*$/i.test(before(ctx, m.index, 80))
      ? null
      : { alternatives: [`${m.groups!.aux} ${m.groups!.pron}`], raw: true },
  idioms5Wonts: (m) => (/^(?:he|she|it)$/i.test(m.groups!.subject) ? "wants" : "want"),
  idioms5Serious: (m, ctx) => {
    const object = m.groups!.object;
    if (
      !/^(?:it|me|him|her|them|us|you|this|that|everything|anything|anyone|everyone|nothing)$/i.test(
        object,
      ) &&
      !nounLike(object)
    )
      return null;
    return nounLike(nextWord(ctx, matchEnd(m))) ? null : "seriously";
  },
  idioms5The: (m) => (/^\p{Lu}/u.test(m.groups!.wh) && m[0] !== m[0].toUpperCase() ? null : ""),
  idioms5Verb: riseRanks,
  idioms5Through: (m, ctx) =>
    /(?:^|[.!?;:]\s*|\b(?:to|don['’]t|do|not|will|would|can|could|should|must|please|never|let['’]s|didn['’]t|did|cannot|can['’]t|won['’]t)\s+)$/i.test(
      before(ctx, m.index, 24),
    )
      ? "throw"
      : ["throw", "threw"],
  idioms5Verb2: (m) => {
    const { verb, away, out } = m.groups!;
    if (/^through$/i.test(verb)) return { alternatives: ["throw"], range: group(m, "verb") };
    if (away && /^away/i.test(away))
      return { alternatives: ["out"], range: [group(m, "away")[0], group(m, "away")[0] + 4] };
    if (away || out) return null;
    return { alternatives: ["the baby out"], range: group(m, "baby") };
  },
  idioms5Sort: (m, ctx) => (OBJECT_START.test(nextWord(ctx, matchEnd(m))) ? null : "sought"),
  idioms5Sort2: (m, ctx) => (nounLike(nextWord(ctx, matchEnd(m))) ? "sought" : null),
  idioms5A2: missingTo,
  idioms5Backup: phrasal,
  idioms5Backup2: phrasalInfinitive,
  idioms5Show: (m) => m.groups!.target.replace(/[ \t\u00a0-]+/, ""),
  idioms5Soon: (m, ctx) => {
    const next = nextWord(ctx, group(m, "target")[1]);
    // At a clause start, only a noun makes it attributive: "Soon to be parents filled…".
    if (/^soon/i.test(m[0]) && (!nounLike(next) || hasVerbForm(next, "past", "participle")))
      return null;
    return "soon-to-be";
  },
  idioms5First: (m) => {
    const { first, adverb, verb } = m.groups!;
    if (!ADVERB_SLOT.test(adverb) && !(englishWordInfo(adverb)?.adverb && /ly$/i.test(adverb)))
      return null;
    if (!hasVerbForm(verb, "base")) return null;
    const alternatives = [`${first} ${adverb}`];
    if (/^(?:never|not)$/i.test(adverb)) alternatives.push(`${recase(first, adverb, m[0])} to`);
    return { alternatives, raw: true };
  },
  idioms5Verb3: (m, ctx) =>
    nounLike(nextWord(ctx, matchEnd(m)))
      ? null
      : [`${m.groups!.verb} into a problem`, `${m.groups!.verb} into problems`],
  idioms5First2: (m) => {
    const { first, second } = m.groups!;
    return first.toLowerCase() === second.toLowerCase()
      ? null
      : { alternatives: [first, second], raw: true };
  },
  idioms5Over: (m) => {
    const typed = m.groups!.target;
    // "over 5,000 PLUS": capitals for emphasis are the writer's choice.
    const plus = m.groups!.plus;
    if (plus && plus === plus.toUpperCase() && !/^OVER/.test(typed)) return null;
    const amount = typed.replace(/^over[ \t\u00a0]+/i, "");
    return { alternatives: [`${typed.slice(0, 4)} ${m.groups!.number}`, amount], raw: true };
  },
  idioms5Verb4: (m) => {
    const verb = m.groups!.verb.toLowerCase();
    return verb === "ate"
      ? ["took", "swallowed"]
      : ({ eat: "take", eats: "takes", eaten: "taken", eating: "taking" } as const)[verb as "eat"];
  },
  idioms5Verb5: riseRanksStyle,
  idioms5Verb6: (m, ctx) => {
    const next = nextWord(ctx, matchEnd(m));
    // "garbage data", "garbage comments": a noun (or an unknown word) after it.
    const known = next && !FUNCTION_WORD.test(next) ? englishWordInfo(next) : null;
    const tagged =
      known &&
      (known.noun || known.plural || known.adjective || known.adverb || known.verbs.length);
    if (TRASH_AFTER.test(next) || (known !== null && !tagged)) return null;
    if (nounLike(next) && !hasVerbForm(next, "ing")) return null;
    const { verb, det, noun } = m.groups!;
    const object = `${det}${noun}`;
    return [`${verb} away ${object}`, `${verb} out ${object}`, `${verb} ${object} away`];
  },
} satisfies Record<string, Fixer>;

export { FRAME_SETS } from "../../engine/frameStyles";
