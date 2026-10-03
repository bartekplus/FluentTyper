import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase, opensClause } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

export const AGREEMENT_REGEX = /\b(i\s+is|i\s+has|you\s+was|(he|she|it)\s+are)(\s+\S+)$/i;
export const AGREEMENT_CORRECTIONS = new Map([
  ["i is", "i am"],
  ["i has", "i have"],
  ["you was", "you were"],
  ["he are", "he is"],
  ["she are", "she is"],
  ["it are", "it is"],
]);

export class EnglishPronounVerbWhitelistAgreementRule implements GrammarRule {
  readonly id = "englishPronounVerbWhitelistAgreement" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, AGREEMENT_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[1];

    const corrected = AGREEMENT_CORRECTIONS.get(phrase.toLowerCase().replace(/\s+/, " "));
    if (!corrected) {
      return null;
    }
    if (phrase.split(/\s+/)[0] === "i" && isVariableI(boundaryContext.core, phraseStart)) {
      return null;
    }
    // "Getting away from you was the point": the same guard as Review.
    if (/^you/i.test(phrase) && isObjectYou(boundaryContext.core, phraseStart)) {
      return null;
    }

    const [pronoun, verb] = correctPronounVerb(phrase, corrected);

    return {
      replacement: `${pronoun} ${verb}${match[3] ?? ""}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}

// "i is"/"i has" is a variable after a condition or an identifier word ("while i has
// items", "the i has"); "if i go" is still the pronoun, so this only guards those verbs.
// Review uses the identifier words in a different order: the build finds that string to
// make sure that Review detection is not in a content script.
const VARIABLE_CONTEXT_BEFORE =
  /\b(?:if|while|until|unless|whether|when|where|the|a|each|every|index|variable|counter|iterator|loop)\s+$/i;

/** True when the lowercase "i" at `start` is a variable: "if i is None", "the i has". */
export function isVariableI(text: string, start: number): boolean {
  return VARIABLE_CONTEXT_BEFORE.test(text.slice(Math.max(0, start - 24), start));
}

/** [pronoun, verb] of `corrected` ("i am") in the case of the typed `phrase`. */
export function correctPronounVerb(phrase: string, corrected: string): [string, string] {
  const [inputPronoun] = phrase.split(/\s+/);
  const [pronoun, verb] = corrected.split(" ");
  const pronounStyle = detectWordCase(inputPronoun || pronoun);
  const verbStyle =
    pronounStyle === "upper" && (inputPronoun || "").toLowerCase() !== "i" ? "upper" : "lower";
  return [applyWordCase(pronoun, pronounStyle), applyWordCase(verb, verbStyle)];
}

// The word right before a phrase, on the same line.
export const PREVIOUS_WORD = /([A-Za-z]+)[ \t\u00A0]+$/;
// Verbs and prepositions after which "you" can only be their object: "I told
// you was" reads "(what) I told you was". Verbs that can introduce a clause
// ("I heard you was sick", "I knew you was lying") are left out: after them
// "you" is usually the subject of the new clause.
const OBJECT_YOU_BEFORE = new Set([
  ...["tell", "tells", "told", "give", "gives", "gave", "given", "show", "shows", "showed"],
  ...["shown", "send", "sends", "sent", "ask", "asks", "asked", "thank", "thanks", "thanked"],
  ...["teach", "teaches", "taught", "pay", "pays", "paid", "bring", "brings", "brought"],
  ...["buy", "buys", "bought", "owe", "owes", "owed", "lend", "lends", "lent", "sell"],
  ...["sells", "sold", "write", "writes", "wrote", "written", "remind", "reminds"],
  ...["reminded", "warn", "warns", "warned", "offer", "offers", "offered", "promise"],
  ...["promises", "promised", "meet", "met", "love", "hate", "help", "call", "leave", "left"],
  ...["hit", "hurt", "keep", "kept", "miss", "choose", "chose", "chosen", "lose", "lost"],
  ...["beat", "catch", "caught", "bless", "blessed", "make", "made", "let", "want", "wanted"],
  ...["need", "needed"],
  ...["to", "for", "with", "of", "about", "from", "at", "by", "on", "upon", "onto", "into"],
  ...["toward", "towards", "against", "without", "behind", "beside", "besides", "around"],
  ...["near", "among", "between", "beyond", "under", "over", "through", "unto", "within"],
]);
// Words ending in "ing" that are not gerunds taking an object.
const NOT_GERUNDS = /^(?:\p{L}*thing|during|morning|evening|ceiling|king|spring|string)$/u;
// Gerunds that can introduce a clause: "Knowing you was lying, I left".
const CLAUSE_GERUNDS = new Set([
  ...["knowing", "hearing", "seeing", "finding", "thinking", "believing", "feeling"],
  ...["noticing", "realizing", "realising", "hoping", "wishing", "saying", "guessing"],
  ...["supposing", "assuming", "figuring", "imagining", "remembering", "forgetting"],
  ...["understanding", "learning", "reading", "deciding", "suspecting", "fearing"],
  ...["expecting", "pretending", "claiming", "admitting", "doubting", "trusting"],
]);

/**
 * True when the "you" at `youStart` can only be the object of the word before
 * it. A past tense or a gerund elsewhere may take "you" as its object ("the man
 * calling you") or introduce a clause ("I assumed you was busy", "I was hoping
 * you was"), so its ending alone never decides it.
 */
export function isObjectYou(text: string, youStart: number): boolean {
  const lookback = Math.max(0, youStart - 32);
  const previous = PREVIOUS_WORD.exec(text.slice(lookback, youStart));
  if (!previous) return false;
  const word = previous[1].toLowerCase();
  if (OBJECT_YOU_BEFORE.has(word)) return true;
  // A gerund opening its clause is the subject, and "you" its object:
  // "Meeting you was great".
  const gerund = word.length > 4 && word.endsWith("ing") && !NOT_GERUNDS.test(word);
  return gerund && !CLAUSE_GERUNDS.has(word) && opensClause(text, lookback + previous.index);
}
