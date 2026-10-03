import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, gluedAfter, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { analyze } from "./nounAgreement";
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
let accented: Set<string> | undefined;
/** The unaccented verb form of an accented noun or adjective twin ("cópia" -> "copia"). */
function verbTwin(word: string): string | undefined {
  accented ??= new Set(PORTUGUESE_PARONYMS.split(/[ |]/));
  return accented.has(word) ? plain(word) : undefined;
}
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
  "tem|tenho|temos|têm|tinha|tinham|teve|tive|há|houve|havia|pede|pedi|pediu|pedem|fez|faz|fiz|fazem|deu|dá|dei|dão|tomou|toma|tomei|tomam|paga|pagou|paguei|vê|vi|viu|traga|traz|trouxe|recebeu|recebi|recebe|recebem|sinto|sente|sentiu|senti|exige|exigiu|merece|mereceu|ganhou|ganhei|perdeu|perdi|causa|causou|causam|gera|gerou|geram|mostra|mostrou|sofreu|sofre|dar|ter|fazer|pedir|receber|tomar|pagar|ver|sentir|causar|gerar|sofrer|ouço|ouvia|ouviu|ouvem|escuto|escutava|escutei|escutou|escutam|ouvir|escutar|restam|resta|restou|restaram|sobram|sobrou|faltam|falta|faltou|faltaram|buscam|buscar|procuram|procurar|requer|requerem|exigem|exigir";
const VERB_LED = `(?<lead>${VERBS})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// After "ser" or "tornar" comes a noun or adjective: "foi publica" -> "pública", "tornou
// especifica" -> "específica", "ser interprete" -> "intérprete".
const COPULA_LED = `(?<lead>é|era|eram|foi|foram|fui|ser|será|seria|sou|torna|tornou|tornam|tornaram|tornar|dava|davam)(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// One of those adjectives opening a sentence: "Grande distancia" -> "distância".
const OPENING = `(?<lead>${ADJECTIVES})(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
// A bare article opening a sentence: a clitic "o/a" never starts written prose ("A
// arvore caiu" -> "árvore"), so there it is the article.
const ARTICLE_OPENING = `(?<lead>[aoAO]s?)(?=${SPACE}(?<target>[a-zçãõáéíóúâêô]+)${WORD_END})`;
const SENTENCE_START = /(?:^|[.!?;:\n]["'”’»)]*)[ \t\u00a0]*["'“‘«(]?[ \t\u00a0]*$/u;
// "Um critica, o outro elogia": indefinite "um/uma" as a pronoun with "outro" later on.
const RECIPROCAL = /^[^.!?;\n]{0,80}(?<![\p{L}])outr[oa]s?(?![\p{L}])/iu;

/**
 * The other way round: "Ele influência quem", "Você cópia os dados", "Prática-se muito". After a
 * singular subject pronoun, with a verb ending of that person and more words after it, or
 * before a hyphenated object pronoun, the accented noun twin stands for its verb form.
 * "nós médicos" (an apposition) and a pronoun after a preposition ("dei a ela prática") stay out.
 */
const PERSON_ENDING: Record<string, RegExp> = {
  eu: /o$/,
  tu: /[ae]s$/,
  ele: /[ae]$/,
  ela: /[ae]$/,
  você: /[ae]$/,
};
const SUBJECT_LED = `(?<lead>eu|tu|ele|ela|você)(?:${SPACE}(?:não|já|também|sempre|nunca|ainda|só|me|te|se|lhe|lhes|nos|vos))?${SPACE}(?<target>\\p{Ll}*[áâéêíóôú]\\p{Ll}*)${WORD_END}`;
const PREPOSITION_BEFORE =
  /(?:^|[^\p{L}])(?:a|à|ante|até|com|contra|de|desde|em|entre|para|perante|por|sem|sob|sobre|após|como|que nem)[ \t\u00a0]+$/iu;
// A word after it, not "de": "Ele médico, ela enfermeira" and "eu, cópia de" stay out.
const OBJECT_AFTER = /^[ \t\u00a0]+(?!(?:de|da|do|das|dos)(?![\p{L}]))[\p{L}\d"“«]/u;
const HYPHEN_LED = `(?<target>\\p{L}*[áâéêíóôúÁÂÉÊÍÓÔÚ]\\p{L}*)(?=-(?:me|te|se|lhe|lhes|nos|vos)${WORD_END})`;

function verbForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, typed: string, context: RawFinding["context"]) => {
    const verb = verbTwin(typed.toLowerCase());
    if (!verb || ctx.dictionary.has(typed.toLowerCase())) return;
    findings.push({
      ruleId: "portugueseAccentParonyms",
      messageKey: "review_msg_pt_accent_verb",
      range: { start, end },
      alternatives: [applyWordCase(verb, detectWordCase(typed))],
      context,
    });
  };
  for (const m of frameMatches(ctx, SUBJECT_LED)) {
    const { lead, target } = m.groups!;
    const [start, end] = m.indices!.groups!.target;
    if (!PERSON_ENDING[lead.toLowerCase()].test(plain(target))) continue;
    if (PREPOSITION_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (!OBJECT_AFTER.test(ctx.text.slice(end, end + 12))) continue;
    push(start, end, target, { start: m.index, end });
  }
  for (const m of frameMatches(ctx, HYPHEN_LED)) {
    const [start, end] = m.indices!.groups!.target;
    push(start, end, m.groups!.target, { start, end: end + 4 });
  }
  return findings;
}

/**
 * "O serviço continuo" -> "contínuo", "Aulas praticas" -> "práticas", "Novo negocio" ->
 * "negócio": after a noun or adjective opening a sentence, a first-person form ("-o") or a
 * second-person one ("-as", "-es") cannot be the verb of that subject, so it is the accented
 * twin agreeing with the word before. Third-person forms stay ("a natureza continua bela").
 */
const AFTER_NOUN = `(?<det>(?:[oa]s?|um|uma|uns|umas|est[ea]s?|ess[ea]s?|aquel[ea]s?|meus?|minhas?|seus?|suas?|nossos?|nossas?)${SPACE})?(?<noun>\\p{Ll}{3,})${SPACE}(?<target>[a-zçãõáéíóúâêô]{3,}(?:o|as|es))${WORD_END}(?!-)`;
// A gerund, an infinitive or "a" + infinitive after it: the verb reading ("o resto continuo
// amanhã a fazer", "o livro continuo lendo").
const VERB_AFTER =
  /^[ \t\u00a0]+(?:(?:a[ \t\u00a0]+)?\p{Ll}+(?:ndo|[aei]r)|amanhã|depois|hoje|agora|logo|mais[ \t\u00a0]+tarde|sempre|ainda)(?![\p{L}])/u;
// Time words open a sentence as an adverb: "Sábado continuo", "Este ano pratico mais".
const TIME_NOUNS = new Set(
  "ano anos mês meses dia dias semana semanas sábado domingo verão inverno outono semestre trimestre momento tempo período fim resto turno amanhã hoje ontem agora depois cedo tarde logo".split(
    " ",
  ),
);

// "da diferencia" -> "diferença", "alguma licencia" -> "licença": a Spanish-looking "-ncia"
// that Portuguese has only as a form of the "-nciar" verb; the noun ends in "-nça".
const NCA_NOUN =
  /(?:diferen|licen|senten|presen|finan|esperan|cren|aven|perten|parecen|queren)cias?$/;
const spanishNoun = (word: string) =>
  NCA_NOUN.test(word) ? [word.replace(/cia(s?)$/, "ça$1")] : undefined;

function afterNoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, AFTER_NOUN)) {
    const { noun, target } = m.groups!;
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (!SENTENCE_START.test(before) || ctx.dictionary.has(target)) continue;
    const lower = noun.toLowerCase();
    if (target !== target.toLowerCase() || noun.slice(1) !== lower.slice(1)) continue;
    const info = TIME_NOUNS.has(lower) ? null : analyze(lower);
    const twins = accentedTwins(target);
    if (!info || !twins) continue;
    const [start, end] = m.indices!.groups!.target;
    if (gluedAfter(ctx.text, end) || VERB_AFTER.test(ctx.text.slice(end, end + 32))) continue;
    const fits = twins.filter((twin) =>
      /o$/.test(twin)
        ? info.feminine === false && !info.plural
        : /as$/.test(twin)
          ? info.feminine !== false && info.plural
          : info.plural,
    );
    if (fits.length !== 1) continue;
    findings.push({
      ruleId: "portugueseAccentParonyms",
      messageKey: "review_msg_pt_accent_paronym",
      range: { start, end },
      alternatives: fits,
      context: { start: m.index, end },
    });
  }
  return findings;
}

export function accentParonyms(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [...verbForms(ctx), ...afterNoun(ctx)];
  for (const m of [
    ...frameMatches(ctx, PATTERN),
    ...frameMatches(ctx, MODIFIED),
    ...frameMatches(ctx, VERB_LED),
    ...frameMatches(ctx, COPULA_LED),
    ...[...frameMatches(ctx, OPENING), ...frameMatches(ctx, ARTICLE_OPENING)].filter((m) =>
      SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)),
    ),
  ]) {
    const target = m.groups!.target;
    const alternatives = accentedTwins(target) ?? spanishNoun(target);
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
