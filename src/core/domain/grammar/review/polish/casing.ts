import type { Fixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { placeForm } from "./lexicon";
import { findingAt, isPl, owned, sentenceStartAt, userOrNamed } from "./shared";

/*
 * Polish capitals: weekdays, months and language or regional adjectives take a small letter
 * ("w piątek", "po angielsku", "język polski", "województwo mazowieckie"); holidays and the
 * names of seas and oceans capitalize every word ("Wielki Piątek", "Morze Bałtyckie").
 */

const RULE = "polishCapitalization" as const;
const MESSAGE = "review_msg_pl_capitals" as const;

const lower = (word: string) => word.toLowerCase();
const capital = (word: string) =>
  word
    .split(/(?<=[ \t\u00a0-])/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

/** Holiday words around a weekday ("Wielki Piątek", "Niedziela Palmowa", "Tłusty Czwartek"). */
const HOLIDAY_BEFORE =
  /(?:Wielk\p{Ll}+|Tłust\p{Ll}+|Biał\p{Ll}+|Czarn\p{Ll}+|Zielon\p{Ll}+)[ \t\u00a0]+$/u;
const HOLIDAY_AFTER =
  /^[ \t\u00a0]+(?:Palmow|Wielkanocn|Popielcow|Miłosierdzi|Zesłani|Bożego|Zielon|Świąt)/u;

const DAY_CONTEXT =
  /(?:\p{N}\.?|(?<![\p{L}])(?:w|we|co|od|do|na|przez|po|przed|z|ze|około|każd\p{Ll}*|ten|tę|ta|tej|zeszł\p{Ll}*|przyszł\p{Ll}*|następn\p{Ll}*|ostatni\p{Ll}*|najbliższ\p{Ll}*|początku|końcu|połowie))[ \t\u00a0]+$/u;

/** Adjective endings (with the -i/-y spellings) that agree with a noun by its ending. */
const AGREEING: Array<[RegExp, RegExp]> = [
  [/owi$/u, /(?:i|y)?emu$/u],
  // "-u" is the genitive ("oceanu Atlantyckiego"), the dative or the locative.
  [/u$/u, /(?:i|y)?(?:ego|emu)$|(?:i|y)m$/u],
  [/(?:em|ie)$/u, /(?:i|y)m$/u],
  [/(?:e|o)$/u, /i?e$/u],
  [/a$/u, /(?:i|y)?ego$/u],
  [/(?:[^aeiouyąęó])$/u, /(?:i|y)$/u],
];
function agrees(noun: string, adjective: string): boolean {
  const n = noun.toLowerCase();
  const a = adjective.toLowerCase().split("-").at(-1)!;
  const row = AGREEING.find(([ending]) => ending.test(n));
  return !!row && row[1].test(a);
}

/** A feminine noun's ending and the adjective endings of the same case. */
const FEMININE_AGREEING: Array<[RegExp, RegExp]> = [
  [/a$/u, /a$/u],
  [/o$/u, /a$/u],
  [/[iy]$/u, /ej$/u],
  [/e$/u, /ej$/u],
  [/[ęą]$/u, /ą$/u],
];

export interface Swap {
  regex: RegExp;
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
}

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  // "co Piątek", "w Maju" -> lowercase, not at a sentence start or in a holiday name.
  casingPoniedział: (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (
      sentenceStartAt(ctx.text, m.index) ||
      HOLIDAY_BEFORE.test(before) ||
      HOLIDAY_AFTER.test(after)
    )
      return null;
    // A heading or a list item ("Piątek: …", "• Sobota").
    if (
      /^[ \t\u00a0]*[:–—-]/u.test(after) ||
      /(?:^|\n)[ \t\u00a0]*[-•*]?[ \t\u00a0]*$/u.test(before)
    )
      return null;
    // Surnames share the words ("pan Środa", "Lipiec"): only after a date or a word that
    // asks for a day or month ("w", "co", "każdy", "zeszły", "5").
    if (!DAY_CONTEXT.test(before)) return null;
    // "Lipa", "Marek", "Marzena": a name sharing the stem.
    if (
      !/^(?:Poniedział|Wtor|Środ|Czwart|Piąt|Sobot|Niedziel|Stycz|Lut[yemu]|Marc|Marz[ec]|Kwietni|Kwiecień|Czerw|Lip(?:iec|ca|cu|cem)|Sierp|Wrze[sś]|Październik|Listopad|Grud)/u.test(
        m[0],
      )
    )
      return null;
    return lower(m[0]);
  },
  // "wielki piątek", "środę popielcową" -> every word capitalized.
  casingFrame: (m) => capital(m[0]),
  // "Morza bałtyckiego", "oceanu Atlantyckiego" -> "Morza Bałtyckiego", "Oceanu Atlantyckiego".
  casingFrame2: (m) => (agrees(m.groups!.noun, m.groups!.adj) ? capital(m[0]) : null),
  // "Ameryka łacińska", "republika Czeska", "Ruda śląska", "Sri lanka" -> every word
  // capitalized; a lowercase "ruda" (ore) or "republika" before a plain adjective stays.
  casingFrame3: (m) => {
    const [first, second] = m[0].split(/[ \t ]+/u);
    // A feminine noun and its adjective in one case ("w Ameryce północne stany" is two phrases).
    const ending = FEMININE_AGREEING.find(([noun]) => noun.test(first))?.[1];
    return /^(?:Sri|Now|now|Wielk)/u.test(first) || ending?.test(second) ? capital(m[0]) : null;
  },
  // "Bielsko-biała", "Rabka-zdrój", "Kędzierzyn-koźle": a hyphenated town name capitalizes
  // both parts.
  casingFrame4: (m) => capital(m[0]),
  // "Europa zachodnia" -> "Europa Zachodnia": the region's name capitalizes both words.
  casingFrame5: (m) => capital(m[0]),
  // "po Angielsku" -> "po angielsku".
  casingFrame6: (m) => lower(m[0]),
  // "w języku Katalońskim", "województwo Mazowieckie" -> lowercase adjective.
  casingFrame7: (m) => (agrees(m.groups!.noun, m[0]) ? lower(m[0]) : null),
  // "kilkuset Hertzów", "100 Ohmów" -> "herców", "omów".
  casingFrame8: (m) =>
    lower(m[0])
      .replace(/^hertz/, "herc")
      .replace(/^ohm/, "om")
      .replace(/^watt/, "wat")
      .replace(/^volt/, "wolt"),
  // "na Ty", "per „Ty”" -> "na ty".
  casingFrame9: (m) => m[0].replace(/[„"”]/gu, "").replace("Ty", "ty"),
  // "Sztuką zajmują się Ci, którzy" -> "ci".
  casingFrame10: () => "ci",
  // "Zostań z Nami!", "z Naszymi doradcami" -> "nami", "naszymi": the writers' own "nas" and
  // "nasz" take no capital inside a sentence (only the reader's "Ty", "Wy" may, in a letter).
  // A capital word before or after makes it a name ("Ojcze Nasz", "Nasz Dziennik").
  casingFrame11: (m) => lower(m[0]),
  // "Warszawie, Ul. Długa", "mieszka przy Ulicy Polnej" -> "ul.", "ulicy": the generic word of a
  // street name is lowercase inside the sentence.
  casingFrame12: (m) => lower(m[0]),
  // "al. Ujazdowskie", "w alejach Jerozolimskich" -> "Al.", "Alejach": "Aleje" is part of a
  // plural avenue name.
  casingFrame13: (m) => capital(m[0]),
  // "Frankfurt Nad Menem", "Kazimierz Nad Wisłą" -> "nad".
  casingFrame14: (m) => lower(m[0]),
  // "w gdańsku", "do niemiec", "na mazurach" -> a place name takes a capital (not "po
  // gdańsku", the Gdańsk way).
  casingFrame15: (m) => (placeForm(m[0]) ? capital(m[0]) : null),
} satisfies Record<string, Fixer>;

// Each lookbehind above sits after a one-letter lookahead: most positions fail on that letter
// and never read back.
/**
 * The swaps of a swap rule of grammar/rules/pl.yaml, on Polish text: the whole match is
 * replaced by its fixer's value; names and user-dictionary words stay.
 */
export function runSwaps(
  ctx: DetectContext,
  swaps: readonly Swap[],
  ruleId: RawFinding["ruleId"] = RULE,
  messageKey: RawFinding["messageKey"] = MESSAGE,
): RawFinding[] {
  if (!isPl(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const { regex, fix } of swaps)
    for (const m of owned(ctx, regex)) {
      const typed = m[0];
      if (userOrNamed(ctx, typed)) continue;
      const fixed = fix(m, ctx);
      if (fixed === null || fixed === typed) continue;
      findings.push(findingAt(ctx, m.index, m.index + typed.length, [fixed], ruleId, messageKey));
    }
  return findings;
}
