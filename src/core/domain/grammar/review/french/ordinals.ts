import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { ownedFrenchWords } from "./frenchTokens";
import { finding } from "../finding";
import { rangeDashes } from "../rangeDash";
import { isLang } from "../phraseTemplates";

// Ordinal abbreviations (opt-in): typographic French writes "2e", "1re", "1er", "2d", not "2ème",
// "2eme", "2ième", "1ère" or "2nd".

const RULE = "frenchOrdinals";
const MESSAGE = "review_msg_fr_ordinal";

// "2ème", "XIXè", "16me", "2-ièmes", "XIX ième": an Arabic or Roman number and the suffix, glued,
// after a hyphen, or after a space when the suffix is no word of its own.
const SUFFIX = "ièmes?|iemes?|èmes?|emes?|ères?|eres?|ières?|ieres?|ier|nds?|ndes?|è|mes?";
const ORDINAL = new RegExp(
  `(?<![\\p{L}\\p{N}_.,/-])(?<number>\\d{1,4}|[IVXLC]{1,7})(?<join>-|[ \\u00a0](?=(?:ièmes?|iemes?|èmes?|emes?)(?![\\p{L}])))?(?<suffix>${SUFFIX})(?![\\p{L}\\p{N}_])`,
  "gu",
);

function suffixFor(number: string, typed: string): string | null {
  const plural = /s$/i.test(typed) ? "s" : "";
  const suffix = typed.toLowerCase().replace(/s$/, "");
  if (/^(?:ère|ere|ière|iere)$/.test(suffix)) return number === "1" ? `re${plural}` : null;
  if (suffix === "ier") return number === "1" ? "er" : null;
  if (suffix === "nd" || suffix === "nde")
    return number === "2" ? `${suffix.slice(1)}${plural}` : null;
  // "1ème" is neither 1er nor 1re: left alone.
  return number === "1" || number === "I" ? null : `e${plural}`;
}

function ordinals(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, ORDINAL)) {
    const { number, join = "", suffix } = m.groups!;
    // "Il a 16 ans, 2 me suffisent": a lowercase "me" may be the pronoun; "DIX", "MIXER" words.
    if (/^mes?$/.test(suffix) && join) continue;
    if (
      /^[IVXLC]/.test(number) &&
      (/^(?:nd|ier|ère|ere|ière|iere)/.test(suffix) || !/\p{Ll}/u.test(suffix))
    )
      continue;
    const fixed = suffixFor(number, suffix);
    if (!fixed || namedExampleBefore(ctx.text, m.index)) continue;
    const start = m.index + number.length;
    const end = start + join.length + suffix.length;
    findings.push(
      finding(RULE, MESSAGE, start, end, [fixed], {
        context: { start: m.index, end },
      }),
    );
  }
  return findings;
}

// "pages 10-15" -> "10–15" (emdashShortcut, opt-in). Not after a label of a code or a law
// ("tél. 12-34", "art. 3-5", "n° 12-14").
const RANGE_CODE =
  /(?:^|[^\p{L}])(?:tél|tel|téléphone|portable|mobile|fax|n°|no|numéro|réf|référence|code|cp|dossier|facture|commande|compte|iban|art|article|loi|décret|alinéa|al|version|vol|ligne|quai|chambre|salle|modèle|type|isbn)\.?[ \t ]*:?[ \t ]*$|§[ \t ]*$/iu;
// "gagné 3-1", "le match s'est terminé 2-2", "mène 1-0".
const RANGE_SCORE =
  /(?:^|[^\p{L}])(?:gagn|perd|battu|victoire|défaite|score|match|nul|mène|menait|emport|impos|set|mi-temps|résultat)\p{L}*(?:[ \t '’]+\p{L}+){0,3}[ \t ]+$/iu;

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: [RULE], detect: ordinals },
  {
    rules: ["emdashShortcut"],
    lang: "fr",
    detect: (ctx: DetectContext) =>
      isLang(ctx, "fr") ? rangeDashes(ctx, { code: RANGE_CODE, score: RANGE_SCORE }) : [],
  },
];
