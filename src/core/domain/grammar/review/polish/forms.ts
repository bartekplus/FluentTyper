import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  findingAt,
  type Frame,
  isPl,
  owned,
  PREPOSITIONS,
  runFrames,
  S,
  userOrNamed,
} from "./shared";

/*
 * Word forms set by convention rather than by a neighbour's meaning:
 * abbreviation dots, inflected foreign names and acronyms, the predicative
 * "-e" before "jest, że", and "na" with islands and regions ("na Węgry").
 */

const RULE = "englishPhraseCorrections" as const;
const NOT_LETTER = "(?![\\p{L}])";

/** Destinations taken with "na": "jechać na Węgry", not "do Węgier". */
const NA_PLACES: Record<string, string> = {
  węgier: "na Węgry",
  białorusi: "na Białoruś",
  syberii: "na Syberię",
  moraw: "na Morawy",
  antarktydy: "na Antarktydę",
  kubę: "na Kubę",
  kuby: "na Kubę",
  malty: "na Maltę",
  islandii: "na Islandię",
  sycylii: "na Sycylię",
  sardynii: "na Sardynię",
  korsyki: "na Korsykę",
  krymu: "na Krym",
  kaszub: "na Kaszuby",
  mazur: "na Mazury",
  podhala: "na Podhale",
  śląska: "na Śląsk",
  wołoszczyzny: "na Wołoszczyznę",
  filipin: "na Filipiny",
  madagaskaru: "na Madagaskar",
  hawaje: "na Hawaje",
  hawajów: "na Hawaje",
};

export const FRAMES: readonly Frame[] = [
  // Travel verbs only: "należał do Węgier" (belonged to Hungary) is right.
  {
    pattern: `(?<=(?:jecha\\p{L}*|jadę|jedzie\\p{L}*|jadą|lecie\\p{L}*|leci\\p{L}*|lecę|wyjecha\\p{L}*|wyjeżdża\\p{L}*|wyjedzie\\p{L}*|przyjecha\\p{L}*|pojecha\\p{L}*|pojedzie\\p{L}*|polecia\\p{L}*|poleci\\p{L}*|wylecia\\p{L}*|wybra\\p{L}*${S}się|wybiera\\p{L}*${S}się|podróż\\p{L}*|wycieczk\\p{L}*|wyjazd\\p{L}*|emigrowa\\p{L}*|wyemigrowa\\p{L}*|uciek\\p{L}*|uciec|wróci\\p{L}*|wraca\\p{L}*)${S})(?<target>do${S}(?<place>${Object.keys(NA_PLACES).join("|")}))${NOT_LETTER}`,
    fix: (m) => NA_PLACES[m.groups!.place.toLowerCase()],
    ruleId: RULE,
    messageKey: "review_msg_contextual_grammar",
  },
  // "Ważnym jest, aby": the predicative adjective before a clause is neuter "-e".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:${PREPOSITIONS}|tym|każdym|jednym|nim|kim|czym)${S})(?<target>(?<stem>\\p{L}{3,}?)(?<end>ym|im))(?=(?:${S}(?:również|także|też|zawsze|zatem|więc))?${S}(?:jest|było|byłoby|będzie)(?:${S}to)?[ \\t\\u00a0]*,?[ \\t\\u00a0]*(?:że|aby|żeby|by|iż|gdy|jeśli)${NOT_LETTER})`,
    fix: (m) => `${m.groups!.stem}${m.groups!.end.toLowerCase() === "im" ? "ie" : "e"}`,
    ruleId: RULE,
    messageKey: "review_msg_contextual_grammar",
  },
  {
    pattern: `(?<=(?:jest|było|byłoby|będzie)${S})(?<target>(?<stem>\\p{L}{3,}?)(?<end>ym|im))(?=[ \\t\\u00a0]*,[ \\t\\u00a0]*(?:aby|żeby|by|że|iż)${NOT_LETTER})`,
    fix: (m) => `${m.groups!.stem}${m.groups!.end.toLowerCase() === "im" ? "ie" : "e"}`,
    ruleId: RULE,
    messageKey: "review_msg_contextual_grammar",
  },
  // Abbreviations that keep the word's last letter take no dot: "nr 2", "3 mln złotych".
  {
    // "pod nr. 2" (numerem) is an oblique case, which keeps the dot.
    pattern: `(?<!(?:^|[^\\p{L}])(?:${PREPOSITIONS})${S})(?<target>(?<abbr>nr|mln|mld|ha|kg|km|cm|mm)\\.)(?=[ \\t\\u00a0]+(?:\\p{Ll}|\\d))`,
    fix: (m) => m.groups!.abbr,
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    verbatim: true,
  },
  // "3 m. tkaniny", "200 g. mąki": a unit after a number takes no dot inside the sentence.
  {
    pattern: `(?<=\\p{N}${S})(?<target>(?<abbr>m|g|mg|ml|dag)\\.)(?=[ \\t\\u00a0]+\\p{Ll})`,
    fix: (m) => m.groups!.abbr,
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    verbatim: true,
  },
  // "Dr. Kowalski", "mgr. Anna Nowak", "Dr. hab. Nowak" -> no dot before a name in the
  // nominative (the dot marks "doktora", "magistra").
  {
    pattern: `(?<target>(?<abbr>dr|mgr|dyr)\\.)(?=${S}(?:hab\\.${S})?(?:\\p{Lu}\\p{Ll}+${S})?\\p{Lu}\\p{Ll}*(?:ski|cki|dzki|ska|cka|dzka)${NOT_LETTER})`,
    fix: (m) => m.groups!.abbr,
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    verbatim: true,
  },
  // "dr", "mgr" keep the last letter of "doktor" only: a man's name in an oblique case takes
  // "dr." ("dzięki dr. Kowalskiemu"); a woman's title does not inflect ("z dr Kowalską").
  {
    pattern: `(?<target>dr|mgr|dyr)(?=${S}(?:\\p{Lu}\\p{Ll}+${S})?\\p{Lu}\\p{Ll}*(?:skiego|ckiego|dzkiego|skiemu|ckiemu|dzkiemu|skim|ckim|dzkim|owi)${NOT_LETTER})`,
    fix: (m) => `${m.groups!.target}.`,
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    verbatim: true,
  },
  // Truncations take one:"np.", "tzw.", "itd.", "m.in.", "p.n.e.", "proc.", "ok." before a number.
  {
    pattern: `(?<target>np|tzw|itd|itp|m\\.in|p\\.n\\.e|n\\.e|proc|godz)(?![\\p{L}\\p{N}.])(?=[ \\t\\u00a0,;:)?!]|$)`,
    fix: (m) => `${m.groups!.target}.`,
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    verbatim: true,
  },
  {
    pattern: `(?<target>ok)(?=[ \\t\\u00a0]+\\d)`,
    fix: "ok.",
    ruleId: RULE,
    messageKey: "review_msg_pl_abbreviation_dot",
    lowercase: true,
  },
];

/*
 * Inflected foreign names: the ending joins a name whose last letter is
 * pronounced ("Johnie", "Bentleyu", "Andym"), and an acronym takes a hyphen
 * ("SMS-ów", "PKP-u"). Names ending in a silent "-e" keep the apostrophe.
 */
const NAME_ENDING =
  /(?<![\p{L}\p{N}'’-])(?<name>\p{Lu}\p{Ll}+)(?<mark>['’])(?<end>a|u|owi|em|iem|ie|om|ów|ach|ami|y|i|ego|emu|go|mu|m|im|ym)(?![\p{L}\p{N}])/gu;
const ACRONYM_ENDING =
  /(?<![\p{L}\p{N}'’-])(?<name>\p{Lu}{2,}|\p{Lu}\p{Ll}?\p{Lu}+)(?<mark>['’])?(?<end>a|u|owi|em|ie|om|ów|ach|ami|y|ach)(?![\p{L}\p{N}])/gu;

/**
 * The right spelling of a name ending in a vowel letter with its case ending, or "" when the
 * typed one is right; undefined when the name ends in no such letter.
 * - "-ie" sounds [i] ("Charlie"): adjective endings join without the apostrophe ("Charliego",
 *   "Charliemu", "Charliem").
 * - A silent "-e" ("Joyce", "Steve") keeps the apostrophe before a vowel ending ("Joyce'a",
 *   "Joyce'em", not "Joyce'm"), but the locative "-ie" replaces it ("Stevie", "Stonie");
 *   "-ke" names vary ("Locke'm", "Lockiem") and are left alone.
 * - "-y" sounds [i] ("Andy"): the short "-m" joins without the apostrophe ("Andym").
 */
function silentEnding(name: string, end: string): string | undefined {
  if (/[^aeiouy]ie$/u.test(name)) {
    const short = { ego: "go", go: "go", emu: "mu", mu: "mu", em: "m", m: "m" }[end];
    return short ? name + short : "";
  }
  if (/[^aeiouy]e$/u.test(name)) {
    // "-ke" names vary ("Locke'm", "Lockiem"), so they are left alone.
    if (end === "m") return /ke$/u.test(name) ? "" : `${name}'em`;
    if (end === "ie" && /[nvmbpf]e$/u.test(name)) return `${name.slice(0, -1)}ie`;
    return "";
  }
  if (/e$/u.test(name)) return "";
  if (/[^aeiouy]y$/u.test(name) && end === "m") return `${name}m`;
  return undefined;
}

function inflectedNames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NAME_ENDING)) {
    const { name, end } = m.groups!;
    const silent = silentEnding(name, end);
    if (silent !== undefined) {
      if (silent && !userOrNamed(ctx, name))
        findings.push(
          findingAt(
            ctx,
            m.index,
            m.index + m[0].length,
            [silent],
            RULE,
            "review_msg_pl_inflected_name",
          ),
        );
      continue;
    }
    // Silent French endings ("Jacques'a", "Charles'a") and a pronounced "-y" after a
    // consonant ("Kennedy'ego") keep it too.
    if (/(?:ques|les|ges|ois|eux|aux|oix|ault|eau|[^aeiouy]y)$/u.test(name)) continue;
    // "-y" names drop the "i" of the ending: "Bill'im" -> "Billym" is beyond this check.
    if (/^(?:i|im|ie|iem)$/u.test(end) && /y$/u.test(name)) continue;
    if (userOrNamed(ctx, name)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [name + end],
        RULE,
        "review_msg_pl_inflected_name",
      ),
    );
  }
  for (const m of owned(ctx, ACRONYM_ENDING)) {
    const { name, end } = m.groups!;
    // A capital or a lowercase run inside ("PiS", "WiN") marks the acronym's own spelling.
    if (!m.groups!.mark && name.length < 3) continue;
    // "IPN'ie", "SMS’y": a vowel-initial ending after the apostrophe is the house style of some.
    if (m.groups!.mark && /^(?:ie|y)$/u.test(end)) continue;
    if (/^(?:PL|EU|USA|UK|OK)$/u.test(name) && !m.groups!.mark) continue;
    if (ctx.dictionary.has(m[0].toLowerCase())) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${name}-${end}`],
        RULE,
        "review_msg_pl_inflected_name",
      ),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) ? [...runFrames(ctx, FRAMES), ...inflectedNames(ctx)] : [],
  },
];
