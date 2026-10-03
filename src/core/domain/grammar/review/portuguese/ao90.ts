import { frameMatches, SPACE, WORD_END, isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { finding } from "../finding";

/**
 * The 1990 Spelling Agreement (portugueseAO90, opt-in: texts in the older
 * European spelling follow other rules). Prefixes join their word except before
 * h or the vowel they end in (auto-estima -> autoestima, anti rugas -> antirrugas,
 * micro-ondas stays), and r/s double after a vowel; vice, ex, pós, pré, pró and
 * recém always take a hyphen. Months and weekdays are lowercase in running text
 * (28 de Janeiro -> janeiro, no próximo Domingo -> domingo).
 */

// Prefix -> the letters after which it keeps its hyphen (beyond h).
const PREFIXES: Record<string, string> = {
  anti: "i",
  auto: "o",
  contra: "a",
  extra: "a",
  infra: "a",
  intra: "a",
  ultra: "a",
  mega: "a",
  micro: "o",
  macro: "o",
  neo: "o",
  pseudo: "o",
  proto: "o",
  semi: "i",
  mini: "i",
  multi: "i",
  arqui: "i",
  tele: "e",
  bio: "o",
  super: "r",
  hiper: "r",
  inter: "r",
  sub: "rb",
  bi: "i",
  tri: "i",
  tetra: "a",
  penta: "a",
  hexa: "a",
  euro: "o",
  // "pan" and "circum" keep it before a vowel, m and n too: pan-americano, circum-navegação.
  pan: "aeiouáéíóúmn",
  circum: "aeiouáéíóúmn",
  // "co" always joins, dropping an h: coautor, coerdeiro, cooperar.
  co: "",
};
// Prefixes that are never words on their own, so "anti inflamatório" is one word split.
const NEVER_ALONE = ["anti", "intra", "infra", "pseudo", "proto", "semi", "multi", "sub", "neo"];
const ALWAYS_HYPHEN = "vice|pós|pré|pró|recém";
const LETTERS = "[a-zçáéíóúâêôãõà]+";

function joined(prefix: string, word: string): string | null {
  const first = word[0];
  if (prefix === "co") return `co${first === "h" ? word.slice(1) : word}`;
  if (first === "h" || PREFIXES[prefix].includes(first)) return `${prefix}-${word}`;
  // A prefix ending in a vowel doubles a following r or s: antirrugas, minissaia.
  if (/[aeiou]$/.test(prefix) && /^[rs]/.test(word)) return `${prefix}${first}${word}`;
  return `${prefix}${word}`;
}

const HYPHENATED = new RegExp(
  `(?<![\\p{L}\\p{N}-])(?<prefix>${Object.keys(PREFIXES).join("|")})-(?<word>${LETTERS})(?![\\p{L}\\p{N}-])`,
  "gu",
);
// "não-agressão" -> "não agressão": the 1990 Agreement drops the hyphen after "não" ("não-me-toques"
// is a plant).
const NAO = `(?<target>não-(?<word>${LETTERS}))${WORD_END}(?!-)`;
const SPACED = `(?<target>(?<prefix>${NEVER_ALONE.join("|")})${SPACE}(?<word>${LETTERS}))${WORD_END}`;
const SPACED_ALWAYS = `(?<target>(?<prefix>${ALWAYS_HYPHEN})${SPACE}(?<word>${LETTERS}))${WORD_END}`;
// Latin phrases and words that only look prefixed.
const KEEP = new Set(["sub judice", "sub rosa", "pós doc"]);
// "a pós em Direito": the clipped noun before a small word.
const SMALL = /^(?:que|em|de|do|da|dos|das|e|o|a|os|as|no|na|com|para|por|se|um|uma)$/;

const MONTH =
  "Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro";
const WEEKDAY = "(?:Segunda|Terça|Quarta|Quinta|Sexta)-[Ff]eiras?|Sábados?|Domingo";
// A day number (not an ordinal holiday name such as "1.º de Maio") before the month.
const MONTH_DATE = `(?<![º°ª.]\\s?)\\d{1,2}${SPACE}de${SPACE}(?<target>${MONTH})${WORD_END}`;
const MONTH_YEAR = `(?:em|de|até|desde)${SPACE}(?<target>${MONTH})${SPACE}de${SPACE}\\d{4}`;
const WEEKDAY_AFTER = `(?:próximo|próxima|último|última|no|na|nos|nas|neste|nesta|nesse|nessa|todo|toda|todos|todas|aos|às|cada)${SPACE}(?<target>${WEEKDAY})${WORD_END}(?!${SPACE}de${SPACE}\\p{Lu})`;
// Street, bridge and square names keep their capitals ("Rua Sete de Setembro").
const NAMED_PLACE =
  /(?<![\p{L}])(?:Rua|Avenida|Av\.|Praça|Largo|Travessa|Estrada|Rodovia|Ponte|Estádio|Escola|Colégio|Parque|Vila|Bairro|Jardim|Hospital|Revolução)[ \t ]+(?:\d{1,2}|\p{Lu}\p{Ll}+)[ \t ]+de[ \t ]+$/u;

export function ao90(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, replacement: string) => {
    if (ctx.dictionary.has(ctx.text.slice(start, end).toLowerCase())) return;
    findings.push(finding("portugueseAO90", "review_msg_pt_ao90", start, end, [replacement]));
  };
  HYPHENATED.lastIndex = ctx.from;
  for (
    let m = HYPHENATED.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = HYPHENATED.exec(ctx.scanText)
  ) {
    const { prefix, word } = m.groups!;
    const fixed = joined(prefix, word);
    if (fixed && fixed !== m[0]) push(m.index, m.index + m[0].length, fixed);
  }
  for (const pattern of [SPACED, SPACED_ALWAYS]) {
    for (const m of frameMatches(ctx, pattern)) {
      const { prefix, word, target } = m.groups!;
      if (KEEP.has(target.toLowerCase()) || SMALL.test(word)) continue;
      if (prefix !== prefix.toLowerCase() || word !== word.toLowerCase()) continue;
      const fixed = pattern === SPACED ? joined(prefix, word) : `${prefix}-${word}`;
      if (fixed) push(m.index, m.index + target.length, fixed);
    }
  }
  for (const m of frameMatches(ctx, NAO)) {
    const { word, target } = m.groups!;
    if (target !== target.toLowerCase() || word === "me") continue;
    push(m.index, m.index + target.length, `não ${word}`);
  }
  for (const pattern of [MONTH_DATE, MONTH_YEAR, WEEKDAY_AFTER]) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      const typed = m.groups!.target;
      if (!/^\p{Lu}\p{Ll}/u.test(typed)) continue;
      // "Sexta-Feira Santa", "Domingo de Ramos": a holiday name keeps its capitals.
      if (
        /-F/.test(typed) ||
        /^[ \t\u00a0]+(?:de[ \t\u00a0]+)?\p{Lu}/u.test(ctx.text.slice(end, end + 8))
      )
        continue;
      if (NAMED_PLACE.test(ctx.text.slice(Math.max(0, start - 40), start))) continue;
      push(start, end, typed.toLowerCase());
    }
  }
  return findings;
}
