import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  finitePersons,
  IL,
  isInflectedNoun,
  TU,
  verbReadings,
} from "./frenchLexicon";
import {
  capitalizedName,
  CLITICS,
  ownedFrenchWords,
  tokensAfter,
  tokensBefore,
} from "./frenchTokens";
import { finding } from "../finding";

// Written French keeps the "ne" of a negation that spoken French drops: "j'ai pas compris" ->
// "je n'ai pas compris", "on sait jamais" -> "on ne sait jamais". Opt-in: the dropped "ne" is
// the norm of informal writing.

const RULE = "frenchMissingNe";
const MESSAGE = "review_msg_fr_missing_ne";

const VOWEL = /^[aeiouyâàäéèêëîïôöûùüœæ]/i;
// h-initial verbs that elide ("je n'habite pas").
const MUTE_H = new Set(
  "habiter habituer hésiter hériter honorer humilier héberger hiberner".split(" "),
);
const SUBJECTS = new Set(
  "je tu il elle on nous vous ils elles ça cela ceci c' j' t' personne rien".split(" "),
);
/** Elided subjects and their full form: "j'ai" -> "je n'ai". */
const ELIDED_SUBJECT: Record<string, string> = { "j'": "je", "c'": "ce" };
const DETERMINERS = new Set(
  "le la les l' un une ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs".split(
    " ",
  ),
);
// "jamais" meaning "ever": after a relative, a comparison or a doubt.
const EVER = new Set(
  "que qu' qui si sans avant plus moins meilleur meilleure pire seul seule quiconque premier première dernier dernière".split(
    " ",
  ),
);
// "pas mal", "pas loin", "pas à pas": no negation of the verb.
const NOT_NEGATING_PAS = new Set(["mal", "loin", "cher", "moins", "plus", "tard"]);
const AFTER_PLUS = new Set(["jamais", "rien", "personne", "aucun", "aucune", "guère"]);
// "je joue plus beaucoup", "c'est plus très loin", "plus du tout": "plus" before a degree word
// only negates ("more" would follow it).
const DEGREE_AFTER_PLUS = new Set(["beaucoup", "très", "trop", "tellement", "vraiment", "du"]);
// "ils peuvent plus penser": after these verbs "plus" and an infinitive negate.
const MODALS = new Set(["pouvoir", "vouloir", "savoir", "oser", "devoir", "falloir"]);
// "il parle à personne", "il pense à rien": a preposition between the verb and its object.
const OBJECT_PREPOSITIONS = new Set(["à", "de", "d'", "avec", "pour", "sur", "chez"]);

const isFinite = (word: string) => verbReadings(word).some((r) => typeof r.slot === "number");

function missingNe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const anchor = m[0].toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 8);
  if (before.some((t) => t.w === "ne" || t.w === "n'" || t.w === "ni")) return null;
  if (anchor === "personne" || anchor === "rien") {
    const subject = subjectNegation(ctx, m, before);
    if (subject !== undefined) return subject;
  }
  const skip =
    (anchor === "personne" || anchor === "rien") && OBJECT_PREPOSITIONS.has(before[0]?.w ?? "")
      ? 1
      : 0;
  const verb = before[skip];
  if (!verb || verb.hyphen || verb.end + 3 < (skip ? before[0].start : m.index)) return null;
  const typedVerb = ctx.text.slice(verb.start, verb.end);
  if (/\p{Lu}/u.test(typedVerb.slice(1)) || !isFinite(verb.w)) return null;
  // "un pas", "le faux pas": a noun.
  if (isInflectedNoun(verb.w) && !verbReadings(verb.w).some((r) => r.lemma === "être")) {
    if (!["avoir", "aller", "faire"].some((l) => verbReadings(verb.w).some((r) => r.lemma === l)))
      return null;
  }
  const [next, second] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (anchor === "pas" && next && NOT_NEGATING_PAS.has(next.w)) return null;
  if (anchor === "pas" && next?.w === "à" && second?.w === "pas") return null;
  // "de personne à personne": person to person.
  if (skip && next?.w === "à") return null;
  if (
    anchor === "plus" &&
    !(
      next &&
      (AFTER_PLUS.has(next.w) ||
        (DEGREE_AFTER_PLUS.has(next.w) && (next.w !== "du" || second?.w === "tout")) ||
        (verbReadings(verb.w).some((r) => MODALS.has(r.lemma)) &&
          verbReadings(next.w).some((r) => r.slot === "I")))
    )
  )
    return null;
  // "rien que pour toi" (only), "rien ne l'arrête" (a new subject).
  if (anchor === "rien" && next && ["que", "qu'", "ne", "n'"].includes(next.w)) return null;
  if (anchor === "jamais" && before.some((t) => EVER.has(t.w))) return null;
  // The clitics between the subject and the verb, then the subject.
  let i = 1 + skip;
  while (before[i] && CLITICS.has(before[i].w) && !(i > 1 + skip && ELIDED_SUBJECT[before[i].w]))
    i++;
  let first = before[i - 1];
  let subject = before[i];
  // "Vous inquiétez pas", "T'as pas": the chain's first pronoun is the subject.
  if (!subject && i > 1 + skip) {
    const lead = before[i - 1];
    if (lead.w === "t'" && i === 2 + skip) {
      subject = lead;
      first = verb;
    } else if (lead.w === "vous" || lead.w === "nous") {
      subject = lead;
      first = before[i - 2] ?? verb;
    }
  }
  if (!subject) return null;
  const typedSubject = ctx.text.slice(subject.start, subject.end);
  const isPronoun = SUBJECTS.has(subject.w);
  const isName =
    /^\p{Lu}\p{L}+$/u.test(typedSubject) &&
    capitalizedName(ctx.text, subject.start, typedSubject) &&
    !isFinite(subject.w);
  const isNoun = !isFinite(subject.w) && DETERMINERS.has(before[i + 1]?.w ?? "");
  if (!isPronoun && !isName && !isNoun) return null;
  if (namedExampleBefore(ctx.text, m.index) || ctx.dictionary.has(anchor)) return null;
  // "finiras pas comprendre": "par" mistyped, not a negation.
  if (anchor === "pas" && verbReadings(verb.w).some((r) => r.lemma === "finir")) return null;
  // "t'a pas": an elided "tu" needs a second-person verb.
  if (subject.w === "t'" && !(finitePersons(verb.w) & TU)) return null;
  const apostrophe = ctx.text.slice(Math.max(0, m.index - 200), m.index).includes("’") ? "’" : "'";
  const head = first === verb ? verb : first;
  const headWord = head.w.replace(/'$/, "");
  const elides =
    VOWEL.test(headWord) ||
    (headWord.startsWith("h") && verbReadings(headWord).some((r) => MUTE_H.has(r.lemma)));
  const ne = elides ? `n${apostrophe}` : "ne ";
  // "j'ai pas" -> "je n'ai pas", "t'as pas" -> "tu n'as pas".
  const elided = subject.w === "t'" ? "tu" : ELIDED_SUBJECT[subject.w];
  const start = elided && subject.end === head.start ? subject.start : head.start;
  let replacement = ne + ctx.text.slice(head.start, verb.end);
  if (start === subject.start) {
    const full = /^\p{Lu}/u.test(typedSubject) ? elided[0].toUpperCase() + elided.slice(1) : elided;
    replacement = `${full} ${replacement}`;
  }
  return finding(RULE, MESSAGE, start, verb.end, [replacement], {
    context: { start: subject.start, end: m.index + m[0].length },
  });
}

// What may open the clause before a subject "personne" or "rien": "Plus personne", "que rien".
const SUBJECT_OPENERS = new Set("plus que qu' et mais si car donc alors quand".split(" "));

/** "Personne vient" -> "Personne ne vient", "Rien va plus" -> "Rien ne va": "personne" or
 * "rien" as the clause's subject; undefined when it is not one. */
function subjectNegation(
  ctx: DetectContext,
  m: RegExpExecArray,
  before: ReturnType<typeof tokensBefore>,
): RawFinding | null | undefined {
  if (!before.every((t) => SUBJECT_OPENERS.has(t.w))) return undefined;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  let i = 0;
  while (after[i] && CLITICS.has(after[i].w) && after[i].w !== "nous" && after[i].w !== "vous") i++;
  const verb = after[i];
  if (!verb || verb.hyphen || !(finitePersons(verb.w) & IL)) return undefined;
  if (/\p{Lu}/u.test(ctx.text.slice(verb.start, verb.end))) return undefined;
  // "Personne morale": an adjective. A noun homograph is the verb there ("Rien bouge").
  if (adjectiveReadings(verb.w).length) return undefined;
  // "Personne est un terme...": the noun named and defined.
  if (
    verbReadings(verb.w).some((r) => r.lemma === "être") &&
    DETERMINERS.has(after[i + 1]?.w ?? "")
  )
    return undefined;
  if (namedExampleBefore(ctx.text, m.index) || ctx.dictionary.has(m[0].toLowerCase())) return null;
  const head = after[0];
  const typed = ctx.text.slice(head.start, verb.end);
  const elides =
    VOWEL.test(head.w) ||
    (head === verb &&
      head.w.startsWith("h") &&
      verbReadings(head.w).some((r) => MUTE_H.has(r.lemma)));
  const apostrophe = ctx.text.slice(Math.max(0, m.index - 200), m.index).includes("’") ? "’" : "'";
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: head.start, end: verb.end },
    alternatives: [`${elides ? `n${apostrophe}` : "ne "}${typed}`],
    context: { start: m.index, end: verb.end },
  };
}

const ANCHOR =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:pas|jamais|plus|rien|personne|guère|aucune?)(?![\p{L}\p{M}\p{N}_'’-])/giu;

const POUR_PAS_QUE = /(?<![\p{L}\p{M}\p{N}_'’-])pour[ \t]+pas[ \t]+qu(?:e[ \t]+|['’])/giu;
const FULL_SUBJECT: Record<string, string> = { "j'": "je", "c'": "ce" };
const NEGATED_CLITICS = new Set(
  "me m' te t' se s' y en le la les l' lui leur nous vous".split(" "),
);

/** "pour pas qu'il se fâche" -> "pour qu'il ne se fâche pas": the written negation of the
 * purpose clause wraps its verb. */
function pourPasQue(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  const subject = after[0];
  if (!subject || !(SUBJECTS.has(subject.w) || subject.w in FULL_SUBJECT)) return null;
  let i = 1;
  while (after[i] && NEGATED_CLITICS.has(after[i].w)) i++;
  const verb = after[i];
  if (!verb || verb.hyphen || !isFinite(verb.w)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const apostrophe = /’/.test(ctx.text.slice(m.index, verb.end)) ? "’" : "'";
  const typedPour = ctx.text.slice(m.index, m.index + 4);
  const que = /['’]$/.test(m[0]) ? `qu${apostrophe}` : "que ";
  const subjectWord = FULL_SUBJECT[subject.w] ?? ctx.text.slice(subject.start, subject.end);
  const head = after[1] && i > 1 ? after[1] : verb;
  const rest = ctx.text.slice(head.start, verb.end);
  const ne = VOWEL.test(head.w) ? `n${apostrophe}` : "ne ";
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: m.index, end: verb.end },
    alternatives: [`${typedPour} ${que}${subjectWord} ${ne}${rest} pas`],
    context: { start: m.index, end: verb.end },
  };
}

function negations(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, ANCHOR)) {
    const finding = missingNe(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, POUR_PAS_QUE)) {
    const finding = pourPasQue(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: negations }];
