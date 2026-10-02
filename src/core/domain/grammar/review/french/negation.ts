import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { finitePersons, isInflectedNoun, TU, verbReadings } from "./frenchLexicon";
import {
  capitalizedName,
  CLITICS,
  ownedFrenchWords,
  tokensAfter,
  tokensBefore,
} from "./frenchTokens";

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

const isFinite = (word: string) => verbReadings(word).some((r) => typeof r.slot === "number");

function missingNe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const anchor = m[0].toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 8);
  if (before.some((t) => t.w === "ne" || t.w === "n'" || t.w === "ni")) return null;
  const verb = before[0];
  if (!verb || verb.hyphen || verb.end + 3 < m.index) return null;
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
  if (anchor === "plus" && !(next && AFTER_PLUS.has(next.w))) return null;
  // "rien que pour toi" (only), "rien ne l'arrête" (a new subject).
  if (anchor === "rien" && next && ["que", "qu'", "ne", "n'"].includes(next.w)) return null;
  if (anchor === "jamais" && before.some((t) => EVER.has(t.w))) return null;
  // The clitics between the subject and the verb, then the subject.
  let i = 1;
  while (before[i] && CLITICS.has(before[i].w) && !(i > 1 && ELIDED_SUBJECT[before[i].w])) i++;
  let first = before[i - 1];
  let subject = before[i];
  // "Vous inquiétez pas", "T'as pas": the chain's first pronoun is the subject.
  if (!subject && i > 1) {
    const lead = before[i - 1];
    if (lead.w === "t'" && i === 2) {
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
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start, end: verb.end },
    alternatives: [replacement],
    context: { start: subject.start, end: m.index + m[0].length },
  };
}

const ANCHOR =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:pas|jamais|plus|rien|personne|guère|aucune?)(?![\p{L}\p{M}\p{N}_'’-])/giu;

function negations(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, ANCHOR)) {
    const finding = missingNe(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: negations }];
