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
  "d[ao]s?|n[ao]s?|num|numa|nuns|numas|dum|duma|duns|dumas|pel[ao]s?|algum|alguma|alguns|algumas|nenhum|nenhuma|qualquer|quaisquer|cada|muitas|poucas|várias|cuj[ao]s?|minhas?|meus?|tuas?|teus?|suas?|seus?|nossos?|nossas?|vossos?|vossas?|um|uma|uns|umas";
// Prepositions, optionally with an article: "com a pratica", "para o publico".
const PREPOSITIONS =
  "(?:com|sem|para|por|sobre|entre|contra|após|perante|desde)[ \\t\\u00a0]{1,8}(?:[ao]s?)(?![\\p{L}])|de|em|com|sem|para|por|sobre|entre|contra|após|perante|desde";
// "nos" is also the pronoun "us" before a verb ("ele nos critica"); "no" only follows hyphenated.
const PATTERN = `(?<lead>(?!nos${WORD_END})(?:${DETERMINERS})|${PREPOSITIONS})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// "Um critica, o outro elogia": indefinite "um/uma" as a pronoun with "outro" later on.
const RECIPROCAL = /^[^.!?;\n]{0,80}(?<![\p{L}])outr[oa]s?(?![\p{L}])/iu;

export function accentParonyms(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const target = m.groups!.target;
    const alternatives = accentedTwins(target);
    if (!alternatives || ctx.dictionary.has(target)) continue;
    const [start, end] = m.indices!.groups!.target;
    if (gluedAfter(ctx.text, end)) continue;
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
