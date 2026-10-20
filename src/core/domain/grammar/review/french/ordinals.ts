import { namedExampleBefore } from "../exampleCues";
import type { DetectContext } from "../reviewDetectors";
import type { Detector, MatchFixer } from "../../engine/reviewRules";
import { inChunk } from "./frenchTokens";
import { finding } from "../finding";
import { rangeDashes } from "../rangeDash";
import { isLang } from "../phraseTemplates";

// Ordinal abbreviations (opt-in): typographic French writes "2e", "1re", "1er", "2d", not "2ème",
// "2eme", "2ième", "1ère" or "2nd".

const RULE = "frenchOrdinals";
const MESSAGE = "review_msg_fr_ordinal";

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

/** The named frame fixes of grammar/rules/fr.yaml (`fixer:`). */
export const FIXERS = {
  ordinal: inChunk((ctx, m) => {
    const { number, join = "", suffix } = m.groups!;
    // "Il a 16 ans, 2 me suffisent": a lowercase "me" may be the pronoun; "DIX", "MIXER" words.
    if (/^mes?$/.test(suffix) && join) return null;
    if (
      /^[IVXLC]/.test(number) &&
      (/^(?:nd|ier|ère|ere|ière|iere)/.test(suffix) || !/\p{Ll}/u.test(suffix))
    )
      return null;
    const fixed = suffixFor(number, suffix);
    if (!fixed || namedExampleBefore(ctx.text, m.index)) return null;
    const start = m.index + number.length;
    const end = start + join.length + suffix.length;
    return finding(RULE, MESSAGE, start, end, [fixed], {
      context: { start: m.index, end },
    });
  }),
} satisfies Record<string, MatchFixer>;

// "pages 10-15" -> "10–15" (emdashShortcut, opt-in). Not after a label of a code or a law
// ("tél. 12-34", "art. 3-5", "n° 12-14").
const RANGE_CODE =
  /(?:^|[^\p{L}])(?:tél|tel|téléphone|portable|mobile|fax|n°|no|numéro|réf|référence|code|cp|dossier|facture|commande|compte|iban|art|article|loi|décret|alinéa|al|version|vol|ligne|quai|chambre|salle|modèle|type|isbn)\.?[ \t ]*:?[ \t ]*$|§[ \t ]*$/iu;
// "gagné 3-1", "le match s'est terminé 2-2", "mène 1-0".
const RANGE_SCORE =
  /(?:^|[^\p{L}])(?:gagn|perd|battu|victoire|défaite|score|match|nul|mène|menait|emport|impos|set|mi-temps|résultat)\p{L}*(?:[ \t '’]+\p{L}+){0,3}[ \t ]+$/iu;

export const PREDICATES = {
  rangeDashes: (ctx: DetectContext) =>
    isLang(ctx, "fr") ? rangeDashes(ctx, { code: RANGE_CODE, score: RANGE_SCORE }) : [],
} satisfies Record<string, Detector>;
