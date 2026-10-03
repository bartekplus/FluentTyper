import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { conjugate, JE, NOUS, TU, verbReadings, VOUS, type VerbReading } from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  SENTENCE_START,
  tokensAfter,
  wordFinding,
} from "./frenchTokens";
import { isLang } from "../phraseTemplates";

// A sentence that opens with "ne" and no subject gives an order: the verb is an imperative.
// "Ne prend pas" -> "Ne prends pas", "N'y vas pas" -> "N'y va pas", "Ne soit pas" -> "Ne sois
// pas", "Ne me demander pas" -> "Ne me demandez pas".

const RULE = "frenchVerbForms";
const MESSAGE = "review_msg_fr_imperative";

// The second singular imperative of verbs whose present does not give it.
const SINGULAR: Record<string, string> = {
  être: "sois",
  avoir: "aie",
  savoir: "sache",
  vouloir: "veuille",
  aller: "va",
};
const PLURAL: Record<string, string[]> = {
  être: ["soyons", "soyez"],
  avoir: ["ayons", "ayez"],
};
const NEGATIONS = new Set("pas plus jamais rien point guère personne".split(" "));
// Words that show a second person addressee: "ne me prend pas pour ton frère".
const SECOND_PERSON = new Set("te t' toi ton ta tes tien tienne".split(" "));
// Nouns that take avoir bare: "n'es pas peur" -> "n'aie pas peur".
const AVOIR_NOUNS = new Set("peur honte froid faim soif peine".split(" "));

const present = (r: VerbReading, person: number) => conjugate({ ...r, tense: 1 }, person);

/** The second singular imperative of a reading's verb: "prendre" -> "prends", "manger" ->
 * "mange", "offrir" -> "offre". */
function singularImperative(r: VerbReading): string | undefined {
  if (r.lemma in SINGULAR) return SINGULAR[r.lemma];
  const first = present(r, JE)[0];
  return r.lemma.endsWith("er") || first?.endsWith("e") ? first : present(r, TU)[0];
}

/** "Ne prend pas", "N'aies pas peur", "Ne vous laisser pas faire": a negated order. */
function negatedOrder(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  let i = 0;
  while (after[i] && CLITICS.has(after[i].w)) i++;
  const verb = after[i];
  const negation = after[i + 1];
  if (!verb || verb.hyphen || !negation || !NEGATIONS.has(negation.w)) return null;
  if (ctx.text.slice(verb.start, verb.end) !== verb.w) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length) return null;
  const clitics = after.slice(0, i).map((t) => t.w);
  const forms = new Set<string>();
  const infinitive = readings.find((r) => r.slot === "I" && r.lemma === verb.w);
  if (infinitive) {
    // "Ne me demander pas": an -er infinitive for the imperative of "tu" or "vous".
    if (!verb.w.endsWith("er")) return null;
    const vous = present(infinitive, VOUS)[0];
    const tu = singularImperative(infinitive);
    if (!clitics.includes("te") && !clitics.includes("t'") && vous) forms.add(vous);
    if (!clitics.includes("vous") && tu) forms.add(tu);
  } else {
    const finite = readings.filter((r) => typeof r.slot === "number");
    if (finite.length !== readings.length) return null;
    // Already an imperative: "ne mange pas", "ne prends pas", "ne soyez pas".
    for (const r of finite) {
      const valid = [
        singularImperative(r),
        ...(PLURAL[r.lemma] ?? [present(r, NOUS)[0], present(r, VOUS)[0]]),
      ];
      if (valid.includes(verb.w)) return null;
    }
    // A third singular in "ne sait pas lire" may be a note with its subject left out; only a
    // second person in the sentence or an exclamation makes it an order.
    // A subjunctive ("ne soit pas") never opens a note.
    const third = finite.every((r) => !((r.slot as number) & TU) && r.tense < 6);
    if (third) {
      const sentence = ctx.text.slice(verb.end, verb.end + 120).split(/[.!?…\n]/u)[0];
      const words = sentence.toLowerCase().split(/[^\p{L}'’]+/u);
      const exclaims = /^[^.?…\n]*!/u.test(ctx.text.slice(verb.end, verb.end + 120));
      const addressed = [...clitics, ...words].some((w) => SECOND_PERSON.has(w));
      if (!exclaims && !addressed) return null;
    }
    const noun = after[i + 2];
    for (const r of finite) {
      const lemma =
        r.lemma === "être" && noun && AVOIR_NOUNS.has(noun.w) && negation.w === "pas"
          ? "avoir"
          : r.lemma;
      const form = lemma === r.lemma ? singularImperative(r) : SINGULAR.avoir;
      if (form) forms.add(form);
    }
  }
  if (!forms.size || forms.size > 2) return null;
  const found = wordFinding(ctx, verb.start, verb.w, [...forms], RULE, MESSAGE);
  return found && { ...found, context: { start: m.index, end: negation.end } };
}

/** "Veillez ne pas" -> "Veuillez": veiller takes "à"; "Veuillez à" -> "Veillez à": vouloir takes
 * a bare infinitive. */
function veillezVeuillez(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0].toLowerCase();
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  if (typed === "veuillez") {
    // "Veuillez à nouveau saisir": the adverb, not veiller's "à".
    if (after[0]?.w !== "à" || after[1]?.w === "nouveau") return null;
    return wordFinding(ctx, m.index, m[0], ["veillez"], HOMOPHONES, HOMOPHONE);
  }
  let i = 0;
  while (after[i] && CLITICS.has(after[i].w)) i++;
  const next = after[i];
  if (!next) return null;
  const infinitive = verbReadings(next.w).some((r) => r.slot === "I" && r.lemma === next.w);
  if (!infinitive && !(i === 0 && (next.w === "ne" || next.w === "n'"))) return null;
  return wordFinding(ctx, m.index, m[0], ["veuillez"], HOMOPHONES, HOMOPHONE);
}
const HOMOPHONES = "frenchHomophones";
const HOMOPHONE = "review_msg_fr_homophone";
const VEILLEZ = /(?<![\p{L}\p{M}\p{N}_'’-])veu?illez(?![\p{L}\p{M}\p{N}_'’-])/giu;

const NE = /(?<![\p{L}\p{M}\p{N}_'’-])n(?:e(?![\p{L}\p{M}\p{N}_'’-])|['’](?=\p{L}))/giu;

function imperatives(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, NE)) {
    const found = negatedOrder(ctx, m);
    if (found) findings.push(found);
  }
  return findings;
}

function veillez(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, VEILLEZ)) {
    const found = veillezVeuillez(ctx, m);
    if (found) findings.push(found);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: [RULE], detect: imperatives },
  { rules: [HOMOPHONES], detect: veillez },
];
