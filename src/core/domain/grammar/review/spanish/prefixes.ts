import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import { DETERMINER, readNoun } from "./agreement";
import {
  atToken,
  Around,
  attributeOf,
  carryCase,
  CLITICS,
  keepsTyped,
  PRENOMINAL,
  words,
} from "./common";
import {
  attribute,
  finiteVerb,
  genderedForm,
  isGenderedEntry,
  isNoun,
  NOUN_ENDING,
  plain,
} from "./lexicon";
import { finding } from "../finding";

// Spanish prefixes join the word they modify: "anti ruso" -> "antirruso", "ex-colonias" ->
// "excolonias". Apart or hyphenated only before a capital, a number or a phrase.

const RULE = "spanishConfusions" as const;

// Prefixes that are also words ("ex", "pro", "tele", "foto", "euro"): joined when hyphenated,
// or apart when the joined form is a word the dictionary knows ("micro biología"). The FREE
// fragment of grammar/rules/es.yaml holds the same list.
const FREE =
  "ex|pro|des|post|poli|tele|video|foto|euro|afro|micro|macro|mini|ultra|super|súper|auto|radio|bio|eco|socio|mega|giga|kilo|zoo|extra|astro|hispano|anglo|franco|luso|físico|químico|cuasi";
// Free prefixes that join any adjective they grade: "pro democrático", "ultra conservador",
// "cuasi perfecto"; the words themselves stand before nouns ("los pro y los contra").
const GRADING = new Set(["pro", "ultra", "cuasi", "super", "súper"]);
const FREE_SET = new Set(FREE.split("|"));
// Adjective forms that open a compound of two related adjectives.
const RELATIONAL = new Set(["hispano", "anglo", "franco", "luso", "físico", "químico"]);
const SIZE = new Set(["macro", "micro", "mini", "mega", "maxi"]);

/**
 * A noun or adjective the dictionary lists: "microbiología", "hispanohablantes". A noun ending
 * alone ("-sión") says nothing after "des", which is also a misspelled "de" ("des discusión").
 */
const knownWord = (word: string) =>
  !(word.startsWith("des") && NOUN_ENDING.test(word)) &&
  (isNoun(word) || isGenderedEntry(word) || !!genderedForm(word));

/** "pre" + "rebajas" -> "prerrebajas": a word-initial r doubles after a vowel. */
function join(prefix: string, word: string): string {
  // "súper", "físico": the first element loses its accent inside the compound.
  const base = plain(prefix);
  return /[aeiou]$/iu.test(base) && word.startsWith("r") && !word.startsWith("rr")
    ? `${base}r${word}`
    : `${base}${word}`;
}

/** "anti ruso", "ex-colonias": a prefix apart from its word or hyphenated (PREFIXED frame). */
const prefixed: MatchFixer = (m, ctx) => {
  if (m.index < ctx.from) return null;
  const [typed, prefix, hyphen, word] = m;
  const lower = word.toLowerCase();
  // "un súper cercano": after a determiner the word is the noun (the supermarket).
  const before = /(\p{L}+)[ \t]+$/u.exec(ctx.text.slice(Math.max(0, m.index - 24), m.index));
  const graded =
    GRADING.has(prefix.toLowerCase()) &&
    !!genderedForm(lower) &&
    !isNoun(lower) &&
    !DETERMINER.has(before?.[1].toLowerCase() ?? "");
  // "ex presidente" was the rule until 2010 and is still everywhere: only "ex-" is joined.
  if (!hyphen && prefix.toLowerCase() === "ex") return null;
  // "relaciones hispano-estadounidenses", "un análisis físico-químico": two adjectives that
  // each keep their meaning keep the hyphen ("hispanohablante" fuses into one).
  if (hyphen && RELATIONAL.has(prefix.toLowerCase()) && !isNoun(lower)) return null;
  if (
    hyphen &&
    RELATIONAL.has(prefix.toLowerCase()) &&
    /(?:ense|és|ano|ana|ino|ina)s?$|eses$/u.test(lower)
  )
    return null;
  // "un macro análisis", "una mini falda": between a determiner and a noun of its number,
  // a size prefix can only be part of the noun.
  const det = DETERMINER.get(before?.[1].toLowerCase() ?? "");
  const noun = readNoun(lower);
  const sized =
    SIZE.has(prefix.toLowerCase()) &&
    !!det &&
    !!noun &&
    !noun.paired &&
    !attributeOf(lower) &&
    !PRENOMINAL.has(lower) &&
    (noun.invariant || noun.plural === det.slot >= 2);
  if (
    !hyphen &&
    FREE_SET.has(prefix.toLowerCase()) &&
    !graded &&
    !sized &&
    !knownWord(join(prefix.toLowerCase(), word))
  )
    return null;
  // "vice primer ministro", "ex alto cargo": the prefix takes a whole phrase.
  const after = /^[ \t]{1,8}(\p{L}+)/u.exec(ctx.text.slice(m.index + typed.length))?.[1] ?? "";
  if (/^\p{Lu}/u.test(word)) return null;
  const apocope = /^(?:primer|tercer|gran|buen|mal|algún|ningún|alto|alta)$/u.test(word);
  if (
    !hyphen &&
    (apocope || attribute(word)) &&
    (isNoun(after.toLowerCase()) || isGenderedEntry(after.toLowerCase()))
  )
    return null;
  // "re menor" is the note.
  if (prefix.toLowerCase() === "re" && /^(?:mayor|menor|bemol|sostenido)$/u.test(word)) return null;
  if (keepsTyped(ctx, prefix) || ctx.dictionary.has(word) || namedExampleBefore(ctx.text, m.index))
    return null;
  const joined = carryCase(prefix, join(prefix.toLowerCase(), word));
  return finding(RULE, "review_msg_closed_compound", m.index, m.index + typed.length, [joined], {
    bulkBlock: "context-dependent",
  });
};

// Masculine determiners: "un saca corchos" can only be a compound noun, since "saca" (the verb)
// takes no article and "la saca" (the sack) no masculine one.
const MASCULINE = words("el un del al este ese aquel los unos estos esos aquellos");

// Verbs "mal" fuses with into a new meaning; "mal vive" (lives badly) stays apart.
const MAL_VERBS = /^(?:interpret|gast|trat|cri|vend|her|entend|entiend|acostumbr)\p{L}+$/u;

/**
 * Compounds written apart: a verb and its object after a masculine determiner ("un lanza
 * misiles" -> "lanzamisiles") and "sobre"/"mal" before a verb ("sobre protegen",
 * "mal interprete").
 */
const splitCompounds = atToken((ctx, tokens, i, frame) => {
  if (i < 1 || i + 1 >= tokens.length) return null;
  const first = tokens[i];
  // "un lanza-misiles": a hyphen between the two halves.
  const hyphen = tokens[i + 1].text === "-" && first.end === tokens[i + 1].start && !!tokens[i + 2];
  const second = hyphen ? tokens[i + 2] : tokens[i + 1];
  // The tokenizer marks a word after a hyphen as glued; its letters still count here.
  if (!first.word || (!second.word && !hyphen) || second.broken || first.start < ctx.from)
    return null;
  if (first.start >= ctx.to) return null;
  if (hyphen && (ctx.text[second.end] === "-" || ctx.text[first.start - 1] === "-")) return null;
  const gap = ctx.text.slice(first.end, second.start);
  if (gap !== " " && !(hyphen && gap === "-")) return null;
  if (!/^\p{Ll}+$/u.test(second.text) || !/^\p{Ll}+$/u.test(first.text)) return null;
  const at = new Around(tokens, i);
  const head = first.lower;
  const tail = second.lower;
  // "un «apaga fuegos»": the determiner before an opening quote.
  const quoted = /^[«“"]$/u.test(tokens[i - 1].text) && !tokens[i].broken;
  const det = quoted ? new Around(tokens, i - 1).prev() : at.prev();
  let joined: string | null = null;
  if (MASCULINE.has(det) && /[^aeiou][ae]$/u.test(head) && finiteVerb(head)) {
    // The noun after is the object: plural, or a mass noun the compound keeps singular.
    const noun = readNoun(tail);
    const nounHead = readNoun(head);
    if (
      noun &&
      !noun.paired &&
      // "al guarda", "el lanza": only a feminine noun reading, which "el" cannot take.
      (!nounHead || nounHead.gender === "f") &&
      (noun.plural || isNoun(join(head, tail)))
    )
      joined = join(head, tail);
  } else if (
    !hyphen &&
    (head === "sobre" || (head === "mal" && MAL_VERBS.test(tail))) &&
    !isNoun(tail) &&
    !attribute(tail)
  ) {
    const compound = join(head, tail);
    if (finiteVerb(tail) && finiteVerb(compound) && !CLITICS.has(tail)) joined = compound;
    // "la sobre protegen": a clitic before "sobre" makes the whole a verb.
    else if (
      head === "sobre" &&
      CLITICS.has(at.prev()) &&
      finiteVerb(tail) &&
      !isNoun(tail) &&
      !CLITICS.has(tail)
    )
      joined = compound;
  }
  if (!joined || keepsTyped(ctx, head) || ctx.dictionary.has(tail)) return null;
  if (namedExampleBefore(ctx.text, first.start)) return null;
  // The next match starts after the second half.
  frame.resume?.(second.end);
  return finding(RULE, "review_msg_closed_compound", first.start, second.end, [joined], {
    bulkBlock: "context-dependent",
  });
});

/** "pilla-pilla", "taca-taca": a doubled word is one compound (DOUBLED frame). */
const doubled: MatchFixer = (m, ctx) => {
  if (m.index < ctx.from || m[1] !== m[2] || ctx.dictionary.has(m[0].toLowerCase())) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: RULE,
    messageKey: "review_msg_closed_compound",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [`${m[1]}${m[2]}`],
    bulkBlock: "context-dependent",
  };
};

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = { prefixed, doubled, splitCompounds } satisfies Record<string, MatchFixer>;
