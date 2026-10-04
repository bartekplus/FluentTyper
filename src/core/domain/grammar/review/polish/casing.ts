import type { DetectContext, RawFinding } from "../reviewDetectors";
import { placeForm } from "./lexicon";
import { findingAt, isPl, owned, S as SP, sentenceStartAt, userOrNamed } from "./shared";

/*
 * Polish capitals: weekdays, months and language or regional adjectives take a small letter
 * ("w piątek", "po angielsku", "język polski", "województwo mazowieckie"); holidays and the
 * names of seas and oceans capitalize every word ("Wielki Piątek", "Morze Bałtyckie").
 */

const RULE = "polishCapitalization" as const;
const MESSAGE = "review_msg_pl_capitals" as const;
/** Spaces between words, bounded so look-behinds stay linear on whitespace runs. */
const END = "(?![\\p{L}\\p{N}])";

const PLACE_PREPOSITIONS = (
  "w we do z ze na od ode przez pod nad przy koło około spod znad u dla obok wokół niedaleko " +
  "ku przed za między pomiędzy"
).split(" ");

const lower = (word: string) => word.toLowerCase();
const capital = (word: string) =>
  word
    .split(/(?<=[ \t\u00a0-])/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

const WEEKDAY_OR_MONTH =
  "(?:Poniedział\\p{Ll}*|Wtor\\p{Ll}*|Środ\\p{Ll}*|Czwart\\p{Ll}*|Piąt\\p{Ll}*|Sobot\\p{Ll}*|Niedziel\\p{Ll}*|Styczni\\p{Ll}*|Styczeń|Lut\\p{Ll}+|Marz\\p{Ll}*|Marc\\p{Ll}*|Kwie\\p{Ll}+|Czerw\\p{Ll}+|Lip\\p{Ll}+|Sierp\\p{Ll}+|Wrze\\p{Ll}+|Październik\\p{Ll}*|Listopad\\p{Ll}*|Grud\\p{Ll}+)";
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

interface Swap {
  regex: RegExp;
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
}

const SWAPS: Swap[] = [
  // "co Piątek", "w Maju" -> lowercase, not at a sentence start or in a holiday name.
  {
    regex: new RegExp(`(?<![\\p{L}])(?<target>${WEEKDAY_OR_MONTH})${END}`, "gu"),
    fix: (m, ctx) => {
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
  },
  // "wielki piątek", "środę popielcową" -> every word capitalized.
  {
    regex: new RegExp(
      `(?<![\\p{L}])(?:wielk\\p{Ll}+${SP}(?:piąt\\p{Ll}+|sobot\\p{Ll}+|czwart\\p{Ll}+)|tłust\\p{Ll}+${SP}czwart\\p{Ll}+|niedziel\\p{Ll}+${SP}(?:palmow|wielkanocn)\\p{Ll}+|poniedział\\p{Ll}+${SP}wielkanocn\\p{Ll}+|środ\\p{Ll}+${SP}popielcow\\p{Ll}+)${END}`,
      "giu",
    ),
    fix: (m) => capital(m[0]),
  },
  // "Morza bałtyckiego", "oceanu Atlantyckiego" -> "Morza Bałtyckiego", "Oceanu Atlantyckiego".
  {
    regex: new RegExp(
      `(?<![\\p{L}])(?<noun>morz(?:e|a|u|em)|ocean(?:|u|owi|em|ie))${SP}(?<adj>(?:bałtyck|czarn|śródziemn|kaspijsk|adriatyck|egejsk|martw|północn|atlantyck|spokojn|indyjsk|arktyczn)\\p{Ll}+)${END}`,
      "giu",
    ),
    // Only an adjective in the noun's case ("nad morzem bałtyckie rybitwy" is two phrases).
    fix: (m) => (agrees(m.groups!.noun, m.groups!.adj) ? capital(m[0]) : null),
  },
  // "Ameryka łacińska", "republika Czeska", "Ruda śląska", "Sri lanka" -> every word
  // capitalized; a lowercase "ruda" (ore) or "republika" before a plain adjective stays.
  {
    regex: new RegExp(
      `(?<![\\p{L}])(?:Amery(?:ka|ki|kę|ką|ko|ce)${SP}(?:łacińsk|północn|południow|środkow)\\p{Ll}+|[Rr]epubli(?:ka|ki|kę|ką|ce|ko)${SP}(?:[Cc]zesk|[Ss]łowack|[Dd]ominikańsk|[Pp]ołudniowoafrykańsk)\\p{Ll}+|Rud(?:a|y|zie|ę|ą)${SP}śląsk\\p{Ll}+|Sri${SP}(?:lank(?:a|i|ę|ą)|lance)|[Nn]ow(?:a|ej|ą)${SP}[Zz]elandi(?:a|i|ę|ą)|Wielk(?:a|iej|ą)${SP}[Bb]rytani(?:a|i|ę|ą))${END}`,
      "gu",
    ),
    fix: (m) => {
      const [first, second] = m[0].split(/[ \t ]+/u);
      // A feminine noun and its adjective in one case ("w Ameryce północne stany" is two phrases).
      const ending = FEMININE_AGREEING.find(([noun]) => noun.test(first))?.[1];
      return /^(?:Sri|Now|now|Wielk)/u.test(first) || ending?.test(second) ? capital(m[0]) : null;
    },
  },
  // "Bielsko-biała", "Rabka-zdrój", "Kędzierzyn-koźle": a hyphenated town name capitalizes
  // both parts.
  {
    regex: new RegExp(
      `(?<![\\p{L}-])\\p{Lu}\\p{Ll}+-(?:biał(?:a|ej|ą)|zdr(?:ój|oju|ojem|oje)|koźl(?:e|a|u|em))${END}`,
      "gu",
    ),
    fix: (m) => capital(m[0]),
  },
  // "Europa zachodnia" -> "Europa Zachodnia": the region's name capitalizes both words.
  {
    regex: new RegExp(
      `(?=[zwśp])(?<=(?<![\\p{L}])Europ(?:a|y|ie|ę|ą)${SP})(?:zachodni|wschodni|środkow|północn|południow)(?:a|ej|ą)${END}`,
      "gu",
    ),
    fix: (m) => capital(m[0]),
  },
  // "po Angielsku" -> "po angielsku".
  {
    regex: new RegExp(`(?=\\p{Lu})(?<=(?<![\\p{L}])po${SP})\\p{Lu}\\p{Ll}+sku${END}`, "gu"),
    fix: (m) => lower(m[0]),
  },
  // "w języku Katalońskim", "województwo Mazowieckie" -> lowercase adjective.
  {
    regex: new RegExp(
      `(?=\\p{Lu})(?<=(?<![\\p{L}])(?<noun>język\\p{Ll}*|województw\\p{Ll}*|powiat\\p{Ll}*|powiecie)${SP})\\p{Lu}\\p{Ll}+(?:sk|ck)\\p{Ll}+(?:-\\p{Lu}\\p{Ll}+(?:sk|ck)\\p{Ll}+)?${END}`,
      "gu",
    ),
    // "województwa Radoszewski" is a surname, not the province's adjective.
    fix: (m) => (agrees(m.groups!.noun, m[0]) ? lower(m[0]) : null),
  },
  // "kilkuset Hertzów", "100 Ohmów" -> "herców", "omów".
  {
    regex: new RegExp(
      `(?=[HOWV])(?<=(?:\\p{N}|kilku\\p{Ll}*|stu|tysięcy|wielu)${SP})(?:Hertz|Herc|Ohm|Watt|Volt)(?:ów|y|a|e)?${END}`,
      "giu",
    ),
    fix: (m) =>
      lower(m[0])
        .replace(/^hertz/, "herc")
        .replace(/^ohm/, "om")
        .replace(/^watt/, "wat")
        .replace(/^volt/, "wolt"),
  },
  // "na Ty", "per „Ty”" -> "na ty".
  {
    regex: new RegExp(`(?<![\\p{L}])(?:na|per)${SP}[„"]?Ty[”"]?${END}`, "gu"),
    fix: (m) => m[0].replace(/[„"”]/gu, "").replace("Ty", "ty"),
  },
  // "Sztuką zajmują się Ci, którzy" -> "ci".
  {
    regex: new RegExp(`(?=C)(?<=\\p{Ll}${SP})Ci(?=,?${SP}(?:którzy|co)${END})`, "gu"),
    fix: () => "ci",
  },
  // "Warszawie, Ul. Długa", "mieszka przy Ulicy Polnej" -> "ul.", "ulicy": the generic word of a
  // street name is lowercase inside the sentence.
  {
    regex: new RegExp(
      `(?=U)(?<=\\p{L},?${SP})(?:Ul\\.|Ulic(?:a|y|ę|ą|e))(?=${SP}\\p{Lu}\\p{Ll})`,
      "gu",
    ),
    fix: (m) => lower(m[0]),
  },
  // "al. Ujazdowskie", "w alejach Jerozolimskich" -> "Al.", "Alejach": "Aleje" is part of a
  // plural avenue name.
  {
    regex: new RegExp(
      `(?<![\\p{L}])(?:al\\.|alej(?:e|ach|ami|om)|alei)(?=${SP}\\p{Lu}\\p{Ll}+(?:skie|ckie|dzkie|skich|ckich|dzkich|skim|ckim|skimi|ckimi)${END})`,
      "gu",
    ),
    fix: (m) => capital(m[0]),
  },
  // "Frankfurt Nad Menem", "Kazimierz Nad Wisłą" -> "nad".
  {
    regex: new RegExp(`(?=[NP])(?<=\\p{Lu}\\p{Ll}+${SP})(?:Nad|Pod)(?=${SP}\\p{Lu}\\p{Ll}+)`, "gu"),
    fix: (m) => lower(m[0]),
  },
  // "w gdańsku", "do niemiec", "na mazurach" -> a place name takes a capital (not "po
  // gdańsku", the Gdańsk way).
  {
    regex: new RegExp(
      `(?=\\p{Ll})(?<=(?<![\\p{L}\\p{N}_'’.@/-])(?:${PLACE_PREPOSITIONS.map(
        (prep) => `[${prep[0]}${prep[0].toUpperCase()}]${prep.slice(1)}`,
      ).join("|")})${SP})\\p{Ll}+(?:-\\p{Ll}+)?${END}`,
      "gu",
    ),
    fix: (m) => (placeForm(m[0]) ? capital(m[0]) : null),
  },
];

// Each lookbehind above sits after a one-letter lookahead: most positions fail on that letter
// and never read back.
function capitals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { regex, fix } of SWAPS)
    for (const m of owned(ctx, regex)) {
      const typed = m[0];
      if (userOrNamed(ctx, typed)) continue;
      const fixed = fix(m, ctx);
      if (fixed === null || fixed === typed) continue;
      findings.push(findingAt(ctx, m.index, m.index + typed.length, [fixed], RULE, MESSAGE));
    }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? capitals(ctx) : []),
  },
];
