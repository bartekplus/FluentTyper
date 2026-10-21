import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { deumlaut, germanNounReading } from "./germanLexicon";

// Pleonasms (opt-in style advice, run by stylePhrasing): an adjective that the noun already
// says ("eine runde Kugel", "die toten Leichen", "eine weibliche Ärztin") and a compound whose
// first part the second already says ("Glasvitrine", "Fußpedal"). The adjective or the first
// part goes. Every row is authored.

// Adjective stem: the nouns it repeats.
const ADJECTIVE_NOUNS: Readonly<Record<string, readonly string[]>> = {
  rund: ["Kugel", "Kreis"],
  weiß: ["Schimmel"],
  schwarz: ["Rappe"],
  tot: ["Leiche", "Leichnam"],
  alt: ["Greis", "Greisin"],
  ander: ["Alternative"],
  selten: ["Rarität"],
  falsch: ["Trugschluss", "Irrtum"],
  zeitlich: ["Verzögerung", "Verspätung", "Dauer"],
  semantisch: ["Bedeutung"],
  viereckig: ["Quadrat"],
  jüdisch: ["Synagoge"],
  islamisch: ["Moschee"],
  katholisch: ["Papst"],
  akustisch: ["Klang"],
  einvernehmlich: ["Konsens"],
  wahr: ["Tatsache", "Fakt"],
  problematisch: ["Problem"],
  künstlich: ["Artefakt"],
  üblich: ["Gepflogenheit"],
  überflüssig: ["Ballast"],
  schriftlich: ["Klausur"],
  neu: ["Neuheit", "Innovation", "Novität"],
  groß: ["Riese"],
  klein: ["Zwerg"],
  leer: ["Vakuum"],
  letzt: ["Ultimatum"],
  gemeinsam: ["Kooperation", "Zusammenarbeit"],
  ehemalig: ["Exfreund", "Exfreundin", "Expartner", "Expartnerin"],
};
// "weibliche Ärztin": a feminine person noun says it already.
const FEMININE = "weiblich";
// Case and number endings a noun may carry.
const NOUN_ENDING = "(?:e|en|n|s|es|er|ern|nen)?";

// First part: the heads it repeats ("Glas" in "Glasvitrine").
const COMPOUND_HEADS: Readonly<Record<string, readonly string[]>> = {
  Trommel: ["revolver"],
  Glas: ["vitrine"],
  Fuß: ["pedal"],
  Baum: ["allee"],
  Außen: ["fassade"],
  Eier: ["omelett", "omelette"],
  Papp: ["karton"],
  Internet: ["blog"],
  Alt: ["veteran"],
  Billig: ["discounter"],
  Haar: ["frisur"],
  Gesichts: ["mimik"],
  Vogel: ["voliere"],
  Holz: ["xylophon", "xylofon"],
  Zeit: ["verzögerung"],
  Haupt: ["protagonist", "protagonistin"],
  Einzel: ["individuum"],
  Lebens: ["biografie", "biographie"],
  Rück: ["erinnerung"],
};
function repeats(stem: string, noun: string): boolean {
  const low = stem.toLowerCase();
  if (low === FEMININE) {
    const base = /^(\p{Lu}\p{Ll}+?)in(?:nen)?$/u.exec(noun)?.[1]?.toLowerCase();
    return !!base && [base, deumlaut(base)].some((b) => germanNounReading(b) !== null);
  }
  return ADJECTIVE_NOUNS[low].some((n) => new RegExp(`^${n}${NOUN_ENDING}$`, "u").test(noun));
}

/** The advice to drop the repeated part: `fix` replaces text[start, end). */
function advise(ctx: DetectContext, start: number, end: number, fix: string): RawFinding | null {
  const typed = ctx.text.slice(start, end);
  if (ctx.dictionary.has(typed.toLowerCase()) || namedExampleBefore(ctx.text, start)) return null;
  return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [fix], {
    context: { start, end },
  });
}

/** The named frame fixes of the de.redundancy rule (grammar/rules/de.yaml). */
export const FIXERS = {
  redundantAdjective: (m, ctx) => {
    const { stem, noun } = m.groups!;
    if (!repeats(stem, noun)) return null;
    return advise(ctx, m.indices!.groups!.adj[0], m.indices!.groups!.noun[1], noun);
  },
  redundantCompound: (m, ctx) => {
    const { prefix, head, ending } = m.groups!;
    if (!COMPOUND_HEADS[prefix].includes(head)) return null;
    return advise(
      ctx,
      m.index,
      m.index + m[0].length,
      head[0].toUpperCase() + head.slice(1) + ending,
    );
  },
} satisfies Record<string, MatchFixer>;
