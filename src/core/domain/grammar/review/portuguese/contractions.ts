import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * "em a" -> "na", "de este" -> "deste", "a aquele" -> "àquele", "por o" -> "pelo":
 * the prepositions a, de, em and por fuse with a following article, demonstrative
 * or third-person pronoun. They stay apart when that word opens an infinitive clause
 * ("antes de o sol nascer", "gosto de o ouvir"). Brazilian "em um", "de um" and the
 * literary "doutro", "mo", "lho" are left alone.
 */

const DEMONSTRATIVES = ["este", "esta", "estes", "estas", "esse", "essa", "esses", "essas"];
const FAR = ["aquele", "aquela", "aqueles", "aquelas", "aquilo"];
const ARTICLES = ["a", "as", "o", "os"];
const PRONOUNS = ["ele", "ela", "eles", "elas"];

const FUSED: Record<string, Record<string, string>> = {
  a: {
    a: "à",
    as: "às",
    o: "ao",
    os: "aos",
    ...Object.fromEntries(FAR.map((word) => [word, `à${word.slice(1)}`])),
  },
  de: {
    ...Object.fromEntries(ARTICLES.map((word) => [word, `d${word}`])),
    ...Object.fromEntries(DEMONSTRATIVES.map((word) => [word, `d${word}`])),
    ...Object.fromEntries(FAR.map((word) => [word, `d${word}`])),
    ...Object.fromEntries(PRONOUNS.map((word) => [word, `d${word}`])),
    isto: "disto",
    isso: "disso",
    aqui: "daqui",
    ali: "dali",
    aí: "daí",
  },
  em: {
    ...Object.fromEntries(ARTICLES.map((word) => [word, `n${word}`])),
    ...Object.fromEntries(DEMONSTRATIVES.map((word) => [word, `n${word}`])),
    ...Object.fromEntries(FAR.map((word) => [word, `n${word}`])),
    ...Object.fromEntries(PRONOUNS.map((word) => [word, `n${word}`])),
    isto: "nisto",
    isso: "nisso",
  },
  por: { a: "pela", as: "pelas", o: "pelo", os: "pelos" },
};

const SECOND = [...new Set(Object.values(FUSED).flatMap((table) => Object.keys(table)))].join("|");
// An article must start more text: a bare letter ("termina em o.") is a mention.
const PATTERN = `(?<target>(?<first>a|de|em|por)${SPACE}(?<second>${SECOND}))${WORD_END}(?:(?<=\\p{L}{3})|(?=${SPACE}[\\p{L}\\d"“«'‘]))`;
// An infinitive (personal or not) later in the clause: the pair opens its subject or object.
const INFINITIVE =
  /^(?:\p{L}+(?:ar|er|ir|ares|eres|ires|armos|ermos|irmos|arem|erem|irem)|\p{L}*p[oô]r|\p{L}*por(?:es|mos|em)|\p{L}+(?:ar|er|ir)-(?:me|te|se|lhes?|nos|vos)|\p{L}+[áêíô]-[ln][oa]s?)$/u;
// Words ending like an infinitive that are nouns or adjectives after an article.
const NOUN_R = new Set(
  "ser seres mulher mulheres poder poderes lugar lugares ar lar lares qualquer olhar olhares mar mares líder líderes câncer celular celulares prazer prazeres caráter dever deveres saber saberes titular titulares jantar jantares par pares bar bares militar militares familiar familiares açúcar parlamentar parlamentares altar altares dólar dólares colher colheres talher talheres pilar pilares radar luar patamar polegar escolar escolares similar similares popular populares particular particulares exemplar exemplares".split(
    " ",
  ),
);
const CLAUSE_AHEAD = /^[^.;:!?()\n]{0,80}/;
// Right after the article these are nouns ("do ser humano"); further on, verbs ("de a casa ser").
const VERB_LATER = new Set(["ser", "poder", "dever", "saber", "olhar", "jantar"]);
const infinitiveAhead = (text: string) =>
  (CLAUSE_AHEAD.exec(text)![0].match(/[\p{L}\p{M}-]+/gu) ?? []).some((word, index, words) => {
    const lower = word.toLowerCase();
    // "deixar de o ser.": a lone "ser" closing the clause is the verb.
    const verb = VERB_LATER.has(lower) && (index > 0 || words.length === 1);
    return INFINITIVE.test(word) && (!NOUN_R.has(lower) || verb);
  });
// "por" after a modal is "pôr" (portugueseConfusions says so).
const MODAL_BEFORE =
  /(?<![\p{L}])(?:pode|posso|podemos|podem|podia|quero|queremos|quer|queria|deve|devemos|devem|deveria|preciso|precisamos|precisa|precisam|para|sem|que|de|há|hei)[ \t ]+$/iu;
const SENTENCE_START = /(?:^|[.!?:;]["”»)]?[ \t ]*|\n[ \t ]*)$/;

export function contractions(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const { first, second, target } = m.groups!;
    // Lowercase words, or a capital only where a sentence starts ("Em a" in a title stays).
    if (second !== second.toLowerCase()) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (first !== first.toLowerCase() && !SENTENCE_START.test(before)) continue;
    const fused = FUSED[first.toLowerCase()][second];
    if (!fused) continue;
    const end = m.index + target.length;
    if (infinitiveAhead(ctx.text.slice(end, end + 96))) continue;
    if (first.toLowerCase() === "por" && MODAL_BEFORE.test(before)) continue;
    if (ctx.dictionary.has(target.toLowerCase())) continue;
    findings.push({
      ruleId: "portugueseContractions",
      messageKey: "review_msg_pt_contraction",
      range: { start: m.index, end },
      alternatives: [applyWordCase(fused, detectWordCase(first))],
      context: { start: m.index, end: Math.min(ctx.text.length, end + 24) },
    });
  }
  return findings;
}
