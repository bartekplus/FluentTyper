import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { adjectiveReadings, isInflectedNoun, isVerbHomograph, verbReadings } from "./frenchLexicon";
import {
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
} from "./frenchTokens";
import { isLang } from "../phraseTemplates";

// Words that do not agree. An adjective used as an adverb after its verb: "coûter cher", "sentir
// bon", "voler bas". A colour named by a noun ("des yeux marron") and a compound colour ("des
// robes bleu clair").

const RULE = "frenchAdjectiveAgreement";

// Adverbial adjective -> the verbs that take it bare.
const ADVERBIAL: Record<string, string[]> = {
  cher: ["coûter", "valoir", "payer", "vendre", "acheter"],
  bas: ["voler", "parler"],
  haut: ["voler", "parler", "viser"],
  bon: ["sentir"],
  mauvais: ["sentir"],
  juste: ["viser", "chanter", "deviner", "tomber"],
  faux: ["chanter", "sonner", "jouer"],
  clair: ["voir"],
  droit: ["marcher", "aller", "filer"],
  franc: ["parler", "jouer"],
  fort: ["parler", "crier", "frapper", "taper"],
  court: ["couper", "tourner"],
  dur: ["travailler", "bosser", "cogner"],
  lourd: ["peser"],
};
// Agreed form -> masculine singular, for the adjectives above.
const AGREED: Record<string, string> = {};
for (const base of Object.keys(ADVERBIAL)) {
  const feminine: Record<string, string> = {
    cher: "chère",
    bas: "basse",
    bon: "bonne",
    faux: "fausse",
    franc: "franche",
    juste: "juste",
    mauvais: "mauvaise",
  };
  const f = feminine[base] ?? `${base}e`;
  for (const form of [f, `${f}s`, /[sx]$/.test(base) ? base : `${base}s`])
    if (form !== base) AGREED[form] = base;
}
const REFLEXIVE = new Set("me m' te t' se s' nous vous".split(" "));

/** "La vie coûte chère" -> "cher", "Ces fleurs sentent bonnes" -> "bon". */
function adverbialAdjective(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const base = AGREED[typed.toLowerCase()];
  if (!base) return null;
  const before = tokensBefore(ctx.text, m.index, 4);
  let i = 0;
  if (["pas", "plus", "jamais", "vraiment", "très", "trop", "si", "aussi"].includes(before[0]?.w))
    i = 1;
  const verb = before[i];
  if (!verb || !verbReadings(verb.w).some((r) => ADVERBIAL[base].includes(r.lemma))) return null;
  // "elle se sent bonne", "il se voit claire": a reflexive verb takes an attribute.
  if (before.slice(i + 1).some((t) => REFLEXIVE.has(t.w))) return null;
  // "la coupe courte", "une marche droite": a noun spelled like the verb.
  if (isVerbHomograph(verb.w) && !SUBJECT_PRONOUNS.has(before[i + 1]?.w ?? "")) return null;
  const found = wordFinding(ctx, m.index, typed, [base], RULE, "review_msg_fr_adverbial_adjective");
  return found && { ...found, context: { start: verb.start, end: m.index + typed.length } };
}
const ADVERBIAL_FORM = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:${Object.keys(AGREED).join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "giu",
);

// Colours named by a noun: they stay invariable ("rose", "mauve", "fauve" agree and are left out).
const NOUN_COLOURS = new Set(
  (
    "marron kaki crème turquoise émeraude ocre saumon olive ivoire bordeaux prune cerise " +
    "chocolat caramel moutarde corail azur sable citron framboise lavande abricot bronze " +
    "argent cuivre acajou anthracite indigo"
  ).split(" "),
);
const BASE_COLOURS = new Set(
  "bleu vert rouge jaune gris brun noir blanc violet orange beige".split(" "),
);
const SHADES = new Set("clair foncé pâle vif sombre marine ciel nuit électrique".split(" "));

/** "des yeux marrons" -> "marron", "des robes bleues claires" -> "bleu clair". */
function invariableColour(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const singular = lower.replace(/s$/, "");
  const colour = lower.replace(/(?:e?s|e)$/, "");
  const named = NOUN_COLOURS.has(singular) && lower !== singular;
  if (!named && !BASE_COLOURS.has(colour) && !BASE_COLOURS.has(singular)) return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  // After a plural noun only: "les marrons" (chestnuts) is a noun of its own.
  if (!previous || !/[sx]$/.test(previous.w) || !isInflectedNoun(previous.w)) return null;
  if (adjectiveReadings(previous.w).length) return null;
  if (verbReadings(previous.w).length && !isVerbHomograph(previous.w)) return null;
  if (named) {
    const found = wordFinding(ctx, m.index, typed, [singular], RULE, MESSAGE);
    return found && { ...found, context: { start: previous.start, end: m.index + typed.length } };
  }
  // A base colour and a shade both agreed: "bleus clairs", "vertes foncées".
  const next = tokensAfter(ctx.text, m.index + typed.length, 1)[0];
  if (!next || next.start > m.index + typed.length + 1) return null;
  const shade = next.w.replace(/(?:e?s|e)$/, "");
  const shadeBase = SHADES.has(shade) ? shade : SHADES.has(`${shade}é`) ? `${shade}é` : null;
  if (!shadeBase || next.w === shadeBase) return null;
  const base = BASE_COLOURS.has(colour) ? colour : singular;
  const end = next.end;
  const original = ctx.text.slice(m.index, end);
  const found = wordFinding(ctx, m.index, original, [`${base} ${shadeBase}`], RULE, MESSAGE);
  return found && { ...found, context: { start: previous.start, end } };
}
const MESSAGE = "review_msg_fr_invariable_colour";
const COLOUR = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:${[...NOUN_COLOURS, ...BASE_COLOURS].join("|")})\\p{Ll}{0,3}(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "gu",
);

function invariables(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, ADVERBIAL_FORM)) {
    const found = adverbialAdjective(ctx, m);
    if (found) findings.push(found);
  }
  for (const m of ownedFrenchWords(ctx, COLOUR)) {
    const found = invariableColour(ctx, m);
    if (found) findings.push(found);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: invariables }];
