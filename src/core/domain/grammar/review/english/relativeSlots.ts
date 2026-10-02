import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { COLLECTIVE } from "./agreementSlots";
import { MASS, nounNumber } from "./nounNumberSlots";
import {
  afterBreak,
  AUXILIARIES,
  caseLike,
  DETERMINERS,
  english,
  evidence,
  FUNCTION_WORDS,
  PREPOSITIONS,
  tokensAfter,
} from "./slotWords";

// The verb of a subject relative clause agrees with the noun the relative pronoun stands for:
// "a report that describe" (describes), "tools that runs" (run), "He who wake" (wakes). The
// noun must plainly own the clause: not inside a prepositional phrase, a cleft or a list.

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const SINGULAR_PRONOUNS =
  /^(?:he|she|something|anything|everything|nothing|someone|anyone|everyone|somebody|anybody|everybody)$/;
// Counts and quantities ("two that follow", "the handful that remain"), time words ("these
// days that is"), and nouns whose "that" opens a content clause ("the chances that happens").
const NOT_ANTECEDENT =
  /^(?:none|one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|handful|faculty|days?|weeks?|months?|years?|times?|hours?|minutes?|moments?|nights?|mornings?|evenings?|summer|winter|spring|autumn|fall|season|decades?|century|era|fact|idea|chances?|possibility|probability|likelihood|hope|belief|claim|notion|odds|risk|sign|proof|assumption|impression|feeling|rumou?r|suggestion|way)$/;
// "It's the chemicals in it that make it…", "Is it X that…": a cleft's that-clause.
const CLEFT = /\b(?:it|this|that)(?:['’]s|[ \t\u00a0]+(?:is|was))\b|\b(?:is|was)[ \t\u00a0]+it\b/i;
const TO_PLURAL: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };
const TO_SINGULAR: Record<string, string> = { are: "is", were: "was", have: "has", do: "does" };
// An object or determiner right after a noun-or-verb word shows it is the verb: "that show
// the request", "that make it".
const VERB_EVIDENCE =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|these|those|it|them|me|us|him|you|every|each|any|some|all)$/;
const ADVERB = "(?:always|also|never|still|just|only|usually|often|really|actually|already|now)";
const MODALS = /^(?:can|could|will|would|shall|should|may|might|must|need|dare|ought|be)$/;

/** The number of the noun before the relative pronoun, or null when the clause may be another's. */
function antecedent(
  ctx: DetectContext,
  word: string,
  index: number,
  pronoun: string,
): "singular" | "plural" | null {
  if (SINGULAR_PRONOUNS.test(word)) return "singular";
  if (word === "those") return "plural";
  if (FUNCTION_WORDS.has(word) || NOT_ANTECEDENT.test(word) || COLLECTIVE.has(word)) return null;
  // The clause so far: a cleft or an earlier relative pronoun leaves the owner open ("a place
  // that shows art that depends on…").
  // A comma inside a number ("12,000 items") does not end it.
  const clause = /(?:[^.!?;:,()\n—]|[,;](?=[\dA-Za-z]))*$/.exec(
    ctx.text.slice(Math.max(0, index - 120), index),
  )![0];
  if (CLEFT.test(clause) || /\b(?:that|which|who)\b/i.test(clause)) return null;
  const before = (clause.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*/g) ?? []).map((w) => w.toLowerCase());
  // "tools for customers that…", "servers on computers running Apache that…": a noun inside a
  // prepositional phrase may not own the clause. Look back past participles to an auxiliary.
  for (const w of before.slice(-6).reverse()) {
    if (PREPOSITIONS.has(w) || /^(?:to|amongst|among|like|than|given)$/.test(w)) return null;
    if (AUXILIARIES.has(w) || /n['’]t$/.test(w)) break;
  }
  const previous = before.at(-1);
  if (pronoun === "that" && /^(?:so|such|now)$/.test(previous ?? "")) return null;
  // "Please note that…"; "useless junk that fail": a collective mass noun.
  if (previous === "please" || /^(?:stuff|junk|gear|crap|garbage|rubbish)$/.test(word)) return null;
  const read = englishWordInfo(word);
  // A word that may be the verb itself needs a determiner, adjective or verb before it: not
  // "the piston fires that…", "Please note that…", "Greta treats which…".
  if (read?.verbs.length) {
    const prev = previous ? englishWordInfo(previous) : null;
    const opens =
      !!previous &&
      (DETERMINERS.has(previous) || (!!prev && (prev.adjective || prev.verbs.length > 0)));
    if (!opens) return null;
  }
  const counted = nounNumber(word)?.number;
  // "A people that loses its past": a singular determiner makes the plural form one group.
  if (counted === "plural" && /^(?:a|an|every|each|one|another)$/.test(previous ?? "")) return null;
  if (counted) return counted;
  // Derived nouns the pair table misses: "manager", "drivers".
  if (!read?.noun || read.verbs.length || read.adjective || read.adverb) return null;
  return read.plural ? "plural" : "singular";
}

/** "Here is a screenshot that show …", "processes that runs …": a relative verb's number. */
function relativeAgreement(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<noun>[a-z]+)${SPACE}(?<pronoun>that|who|which)(?:${SPACE}${ADVERB})?${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const { noun, verb } = m.groups!;
    const pronoun = m.groups!.pronoun.toLowerCase();
    // A capital names something, except at a sentence start ("Users who uses…").
    if (verb !== verb.toLowerCase() || (noun !== noun.toLowerCase() && !afterBreak(ctx, m.index)))
      continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const finite = verb in TO_PLURAL || verb in TO_SINGULAR;
    if (!finite && (FUNCTION_WORDS.has(verb) || MODALS.test(verb))) continue;
    const number = antecedent(ctx, noun.toLowerCase(), m.index, pronoun);
    if (!number) continue;
    const end = m.index + m[0].length;
    const next = tokensAfter(ctx, end, 1)[0];
    const read = englishWordInfo(verb);
    // "tells the collector which host the data…": after which, a noun-or-verb is a noun.
    const evidenced =
      pronoun !== "which" &&
      next?.kind === "word" &&
      (VERB_EVIDENCE.test(next.lower) ||
        (/ly$/.test(next.lower) && !!englishWordInfo(next.lower)?.adverb));
    let replacement: string | null;
    if (number === "plural") {
      replacement = TO_PLURAL[verb] ?? null;
      if (!replacement && read?.verbs.some((v) => v.form === "third")) {
        // "plans", "changes" are nouns too: "told the users that changes were coming".
        const verbOnly = !read.noun && !read.plural && !read.adjective;
        if (verbOnly || evidenced) replacement = englishLemma(verb, "third");
      }
    } else {
      // "the issues and the uncertainty that still exist": a list before owns it.
      const listed = /\b(?:and|or)\b(?:[ \t\u00a0]+[A-Za-z]+){0,3}[ \t\u00a0]*$/i.test(
        ctx.text.slice(Math.max(0, m.index - 40), m.index),
      );
      // "useless junk that fail": a mass noun can stand for a group.
      if (listed || MASS.has(noun)) continue;
      replacement = TO_SINGULAR[verb] ?? null;
      // "do" and "have" need an object or verb after them to be finite here.
      if ((verb === "do" || verb === "have") && !evidenced) replacement = null;
      const base =
        !replacement &&
        !MODALS.test(verb) &&
        read?.verbs.some((v) => v.form === "base" && v.lemma === verb) &&
        !read.verbs.some((v) => v.form !== "base") &&
        !/^(?:please|thank)$/.test(verb);
      if (base) {
        const verbOnly = !read!.noun && !read!.plural && !read!.adjective && !read!.adverb;
        if (verbOnly || evidenced) replacement = englishInflect(verb, "third");
      }
    }
    if (!replacement || replacement === verb) continue;
    const [start, verbEnd] = m.indices!.groups!.verb;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end: verbEnd },
      alternatives: [caseLike(verb, replacement)],
      context: evidence(ctx, m.index, verbEnd),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishSubjectVerbAgreement"], detect: english(relativeAgreement) },
];
