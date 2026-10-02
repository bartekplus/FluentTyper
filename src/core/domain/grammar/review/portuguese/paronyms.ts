import { frameMatches, gluedAfter, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { PORTUGUESE_PARONYMS } from "./paronyms.generated";

/**
 * "da fabrica", "uma duvida", "em pratica": after a determiner or a preposition a
 * word is a noun or adjective, never a finite verb, so the verb form that differs
 * from a noun only by its written accent stands for the noun (fábrica, dúvida, prática).
 * Bare "a/o/as/os" stay out: they are also object pronouns ("ele a pratica").
 */

const PLAIN_VOWEL: Record<string, string> = {
  á: "a",
  â: "a",
  é: "e",
  ê: "e",
  í: "i",
  ó: "o",
  ô: "o",
  ú: "u",
};
const plain = (word: string) => word.replace(/[áâéêíóôú]/g, (vowel) => PLAIN_VOWEL[vowel]);

let twins: Map<string, string[]> | undefined;
function accentedTwins(word: string): string[] | undefined {
  twins ??= new Map(
    PORTUGUESE_PARONYMS.split(" ").map((row) => {
      const forms = row.split("|");
      return [plain(forms[0]), forms];
    }),
  );
  return twins.get(word);
}

// Contracted articles, indefinites, quantifiers and possessives: never before a finite verb.
const DETERMINERS =
  "d[ao]s?|n[ao]s?|num|numa|nuns|numas|dum|duma|duns|dumas|pel[ao]s?|algum|alguma|alguns|algumas|nenhum|nenhuma|qualquer|quaisquer|cada|muita|muitas|muitos|pouca|poucas|poucos|tanta|tantas|tantos|toda|certa|tal|várias|vários|diversas|diversos|inúmeras|inúmeros|outras|outros|cuj[ao]s?|minhas?|meus?|tuas?|teus?|suas?|seus?|nossos?|nossas?|vossos?|vossas?|um|uma|uns|umas";
// Adjectives that come before a noun and seldom stand for a person on their own, so after an
// article they still announce a noun: "um forte estimulo", "a principal evidencia", "da
// terceira vitima". "novo", "velho", "pequeno" or "melhor" stay out: "o velho critica tudo".
const ADJECTIVES =
  "grandes?|fortes?|principa(?:l|is)|simples|excelentes?|vast[oa]s?|breves?|enormes?|long[oa]s?|eventua(?:l|is)|recentes?|supost[oa]s?|mer[oa]s?|notóri[oa]s?|devid[oa]s?|verdadeir[oa]s?|rápid[oa]s?|profund[oa]s?|graves?|séri[oa]s?|constantes?|intens[oa]s?|bel[oa]s?|ótim[oa]s?|péssim[oa]s?|terríve(?:l|is)|maldit[oa]s?|vil|imens[oa]s?|plen[oa]s?|tamanhas?|maior(?:es)?|menor(?:es)?|própri[oa]s?|únic[oa]s?|determinad[oa]s?|terceir[oa]s?|quart[oa]s?|quint[oa]s?|sext[oa]s?|sétim[oa]s?|oitav[oa]s?|non[oa]s?|décim[oa]s?|últim[oa]s?";
// Prepositions, optionally with an article: "com a pratica", "para o publico".
const PREPOSITIONS =
  "(?:com|sem|para|por|sobre|entre|contra|após|perante|desde)[ \\t\\u00a0]{1,8}(?:[ao]s?)(?![\\p{L}])|de|em|com|sem|para|por|sobre|entre|contra|após|perante|desde";
// "nos" is also the pronoun "us" before a verb ("ele nos critica"); "no" only follows hyphenated.
const PATTERN = `(?<lead>(?!nos${WORD_END})(?:${DETERMINERS})|${PREPOSITIONS})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// The same leads, or an article, before one of those adjectives; "tão" before an adjective.
// "por último" is an adverb ("por último publica os dados").
const MODIFIED = `(?<lead>(?!por${SPACE}últim)(?:(?!nos${WORD_END})(?:${DETERMINERS})|${PREPOSITIONS}|[ao]s?)${SPACE}(?:${ADJECTIVES})|t[ãa]o)(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// A transitive verb before its object: "tenho duvidas", "há duvida", "pediu credito". Two
// finite verbs never stand side by side.
const VERBS =
  "tem|tenho|temos|têm|tinha|tinham|teve|tive|há|houve|havia|pede|pedi|pediu|pedem|fez|faz|fiz|fazem|deu|dá|dei|dão|tomou|toma|tomei|tomam|paga|pagou|paguei|vê|vi|viu|traga|traz|trouxe|recebeu|recebi|recebe|recebem|sinto|sente|sentiu|senti|exige|exigiu|merece|mereceu|ganhou|ganhei|perdeu|perdi|causa|causou|causam|gera|gerou|geram|mostra|mostrou|sofreu|sofre|dar|ter|fazer|pedir|receber|tomar|pagar|ver|sentir|causar|gerar|sofrer";
const VERB_LED = `(?<lead>${VERBS})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// After "ser" or "tornar" comes a noun or adjective: "foi publica" -> "pública", "tornou
// especifica" -> "específica", "ser interprete" -> "intérprete".
const COPULA_LED = `(?<lead>é|era|eram|foi|foram|fui|ser|será|seria|sou|torna|tornou|tornam|tornaram|tornar|dava|davam)(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// One of those adjectives opening a sentence: "Grande distancia" -> "distância".
const OPENING = `(?<lead>${ADJECTIVES})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
const SENTENCE_START = /(?:^|[.!?;:\n]["'”’»)]*)[ \t\u00a0]*["'“‘«(]?[ \t\u00a0]*$/u;
// "Um critica, o outro elogia": indefinite "um/uma" as a pronoun with "outro" later on.
const RECIPROCAL = /^[^.!?;\n]{0,80}(?<![\p{L}])outr[oa]s?(?![\p{L}])/iu;

export function accentParonyms(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of [
    ...frameMatches(ctx, PATTERN),
    ...frameMatches(ctx, MODIFIED),
    ...frameMatches(ctx, VERB_LED),
    ...frameMatches(ctx, COPULA_LED),
    ...[...frameMatches(ctx, OPENING)].filter((m) =>
      SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)),
    ),
  ]) {
    const target = m.groups!.target;
    const alternatives = accentedTwins(target);
    if (!alternatives || ctx.dictionary.has(target)) continue;
    const [start, end] = m.indices!.groups!.target;
    if (gluedAfter(ctx.text, end) || findings.some((found) => found.range.start === start))
      continue;
    if (/^um/i.test(m.groups!.lead) && RECIPROCAL.test(ctx.text.slice(end, end + 96))) continue;
    findings.push({
      ruleId: "portugueseAccentParonyms",
      messageKey: "review_msg_pt_accent_paronym",
      range: { start, end },
      alternatives,
      context: { start: m.index, end },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  }
  return findings;
}
