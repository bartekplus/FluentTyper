import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { finding } from "../finding";

/**
 * The 1990 Spelling Agreement (portugueseAO90, opt-in: texts in the older
 * European spelling follow other rules). Prefixes join their word except before
 * h or the vowel they end in (auto-estima -> autoestima, anti rugas -> antirrugas,
 * micro-ondas stays), and r/s double after a vowel; vice, ex, pós, pré, pró and
 * recém always take a hyphen. Months and weekdays are lowercase in running text
 * (28 de Janeiro -> janeiro, no próximo Domingo -> domingo). The frames are in
 * grammar/rules/pt_BR.yaml.
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

function joined(prefix: string, word: string): string | null {
  const first = word[0];
  if (prefix === "co") return `co${first === "h" ? word.slice(1) : word}`;
  if (first === "h" || PREFIXES[prefix].includes(first)) return `${prefix}-${word}`;
  // A prefix ending in a vowel doubles a following r or s: antirrugas, minissaia.
  if (/[aeiou]$/.test(prefix) && /^[rs]/.test(word)) return `${prefix}${first}${word}`;
  return `${prefix}${word}`;
}

// Latin phrases and words that only look prefixed.
const KEEP = new Set(["sub judice", "sub rosa", "pós doc"]);
// "a pós em Direito": the clipped noun before a small word.
const SMALL = /^(?:que|em|de|do|da|dos|das|e|o|a|os|as|no|na|com|para|por|se|um|uma)$/;

// Street, bridge and square names keep their capitals ("Rua Sete de Setembro").
const NAMED_PLACE =
  /(?<![\p{L}])(?:Rua|Avenida|Av\.|Praça|Largo|Travessa|Estrada|Rodovia|Ponte|Estádio|Escola|Colégio|Parque|Vila|Bairro|Jardim|Hospital|Revolução)[ \t ]+(?:\d{1,2}|\p{Lu}\p{Ll}+)[ \t ]+de[ \t ]+$/u;

/** A finding unless the typed text is in the user's dictionary. */
function push(ctx: DetectContext, start: number, end: number, replacement: string) {
  if (ctx.dictionary.has(ctx.text.slice(start, end).toLowerCase())) return null;
  return finding("portugueseAO90", "review_msg_pt_ao90", start, end, [replacement]);
}

/** A spaced prefix, joined by `join`, unless it is a Latin phrase or a clipped noun. */
const spaced =
  (join: (prefix: string, word: string) => string | null): MatchFixer =>
  (m, ctx) => {
    const { prefix, word, target } = m.groups!;
    if (KEEP.has(target.toLowerCase()) || SMALL.test(word)) return null;
    if (prefix !== prefix.toLowerCase() || word !== word.toLowerCase()) return null;
    const fixed = join(prefix, word);
    return fixed ? push(ctx, m.index, m.index + target.length, fixed) : null;
  };

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  ao90Hyphenated: (m, ctx) => {
    const { prefix, word } = m.groups!;
    const fixed = joined(prefix, word);
    return fixed && fixed !== m[0] ? push(ctx, m.index, m.index + m[0].length, fixed) : null;
  },
  ao90Spaced: spaced(joined),
  ao90SpacedAlways: spaced((prefix, word) => `${prefix}-${word}`),
  ao90Nao: (m, ctx) => {
    const { word, target } = m.groups!;
    if (target !== target.toLowerCase() || word === "me") return null;
    return push(ctx, m.index, m.index + target.length, `não ${word}`);
  },
  ao90Lowercase: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    const typed = m.groups!.target;
    if (!/^\p{Lu}\p{Ll}/u.test(typed)) return null;
    // "Sexta-Feira Santa", "Domingo de Ramos": a holiday name keeps its capitals.
    if (
      /-F/.test(typed) ||
      /^[ \t\u00a0]+(?:de[ \t\u00a0]+)?\p{Lu}/u.test(ctx.text.slice(end, end + 8))
    )
      return null;
    if (NAMED_PLACE.test(ctx.text.slice(Math.max(0, start - 40), start))) return null;
    return push(ctx, start, end, typed.toLowerCase());
  },
} satisfies Record<string, MatchFixer>;
