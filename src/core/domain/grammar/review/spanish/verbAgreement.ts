import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { DETERMINER, readNoun } from "./agreement";
import {
  Around,
  CONJUNCTIONS,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { finiteVerb, isNoun, isVerb, participle } from "./lexicon";

// Number agreement around the verb: a subject opening its clause and the verb right after
// it ("Los amigos tiene sed", "Ellos viene"), "gustar" and its kin with the noun phrase
// after them ("Me gusta las manzanas"), and a plural "ser"/"estar" before a participle
// ("Son documentado").

const RULE = "spanishAgreement" as const;
const MESSAGE = "review_msg_spanish_verb_agreement" as const;

const SINGULAR_VERB: Record<string, string> = {
  es: "son",
  fue: "fueron",
  ha: "han",
  va: "van",
  da: "dan",
  ve: "ven",
  era: "eran",
  iba: "iban",
  está: "están",
  estaba: "estaban",
  había: "habían",
  tiene: "tienen",
};
const PLURAL_VERB: Record<string, string> = Object.fromEntries(
  Object.entries(SINGULAR_VERB).map(([singular, plural]) => [plural, singular]),
);

/** A third-person verb's number ("tiene" -> singular, "siguen" -> plural), or null. */
function verbNumber(word: string): "singular" | "plural" | null {
  if (PREPOSITIONS.has(word) || CONJUNCTIONS.has(word) || IMPERSONAL.test(word)) return null;
  if (SINGULAR_VERB[word]) return "singular";
  if (PLURAL_VERB[word]) return "plural";
  if (!finiteVerb(word) || word.length < 3) return null;
  if (/[aeáéó]$/u.test(word)) return "singular";
  // "-mos" and "-s" are first and second persons; "-n" the third plural.
  return /[aeá]n$/u.test(word) ? "plural" : null;
}

/** The same tense in the other number: "tiene" <-> "tienen", "habló" <-> "hablaron". */
function otherNumber(word: string, number: "singular" | "plural"): string | null {
  if (number === "singular") {
    if (SINGULAR_VERB[word]) return SINGULAR_VERB[word];
    const preterite = /^(\p{L}+)ó$/u.exec(word);
    if (preterite) {
      const stem = preterite[1];
      if (stem.endsWith("i")) return `${stem.slice(0, -1)}ieron`;
      if (stem.endsWith("y")) return `${stem}eron`;
      return isVerb(`${stem}ar`) ? `${stem}aron` : null;
    }
    return `${word}n`;
  }
  if (PLURAL_VERB[word]) return PLURAL_VERB[word];
  let m = /^(\p{L}+)aron$/u.exec(word);
  if (m) return `${m[1]}ó`;
  m = /^(\p{L}+?)(i|y)eron$/u.exec(word);
  if (m) return `${m[1]}${m[2]}ó`;
  return word.slice(0, -1);
}

// Impersonal verbs: "Ellos hace días que…", "Las cosas parece que…", "Ellos puede que no".
const IMPERSONAL = /^(?:hace|hacía|hay|puede|podía|parec\p{L}*|sobre|bajo)$/u;

const SINGULAR_PRONOUNS = words("él ella usted");
const PLURAL_PRONOUNS = words("ellos ellas ustedes");
// Words that may stand between a subject and its verb: "Los niños no se lo dan".
const BETWEEN = words("no se me te le les lo la los las nos os ya también nunca siempre");
// Words after which a clause starts.
const CLAUSE_OPENERS = words("que pero cuando si porque aunque mientras donde");
// Noun phrases that are times, not subjects ("Los domingos abre"), and collectives that
// take either number ("La mayoría votaron").
const NOT_SUBJECTS = words(
  "semana semanas año años mes meses día días tarde tardes noche noches mañana mañanas vez " +
    "veces momento momentos rato ratos verano veranos invierno inviernos lunes martes " +
    "miércoles jueves viernes sábado sábados domingo domingos mayoría mitad resto parte " +
    "cantidad número grupo serie conjunto montón multitud infinidad totalidad minoría " +
    "docena centenar verdad par clase tipo especie",
);
const SER = words("es son era eran fue fueron será serán sería serían sea sean");

function clauseStart(tokens: Token[], i: number): boolean {
  const at = new Around(tokens, i);
  return at.starts || CLAUSE_OPENERS.has(at.prev());
}

/** The verb after the subject ending at tokens[i]: its index, past "no", clitics and adverbs. */
function verbAfter(tokens: Token[], i: number): number {
  let j = i + 1;
  for (let n = 0; n < 3 && BETWEEN.has(tokens[j]?.lower ?? "") && !tokens[j].broken; n++) j++;
  const token = tokens[j];
  return token?.word && !token.broken && !tokens[i + 1].broken ? j : -1;
}

/** Subject (pronoun, or determiner + noun) at clause start and the verb after it. */
function subjectVerb(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const token = tokens[i];
  if (!clauseStart(tokens, i)) return null;
  let subject: "singular" | "plural";
  let last = i;
  if (SINGULAR_PRONOUNS.has(token.lower)) subject = "singular";
  else if (PLURAL_PRONOUNS.has(token.lower)) subject = "plural";
  else {
    const det = DETERMINER.get(token.lower);
    const nounToken = tokens[i + 1];
    if (!det || !nounToken?.word || nounToken.broken || det.forms[0].includes(" ")) return null;
    if (/^(?:del|al)$/u.test(token.lower) || NOT_SUBJECTS.has(nounToken.lower)) return null;
    const noun = readNoun(nounToken.lower);
    if (!noun || noun.plural !== det.slot >= 2) return null;
    subject = noun.plural ? "plural" : "singular";
    last = i + 1;
  }
  const v = verbAfter(tokens, last);
  if (v < 0) return null;
  // "Las manzanas las compra Juan": a fronted object, taken up by its clitic.
  for (let j = last + 1; j < v; j++)
    if (
      /^(?:lo|la|los|las)$/u.test(tokens[j].lower) &&
      /s$/u.test(tokens[j].lower) === (subject === "plural")
    )
      return null;
  const verb = tokens[v].lower;
  // "Mi amigo Eren es…": a name, not a verb.
  if (/^\p{Lu}/u.test(tokens[v].text) || tokens[last + 1]?.lower === "de") return null;
  const number = verbNumber(verb);
  if (!number || number === subject) return null;
  // "Las cosas había parecido que…": an impersonal perfect.
  if (IMPERSONAL.test(tokens[v + 1]?.lower ?? "")) return null;
  // "El problema son los precios": "ser" agrees with a plural complement after it.
  // "Su pasión han sido las fresas": the perfect of "ser" too.
  const sido = /^(?:ha|han|había|habían)$/u.test(verb) && tokens[v + 1]?.lower === "sido";
  if (SER.has(verb) || sido) {
    const next = new Around(tokens, sido ? v + 1 : v).next();
    const complement = readNoun(next);
    // A noun phrase after it may be what the verb agrees with; an adjective may not.
    if (DETERMINER.has(next) || (complement && !complement.paired)) return null;
    if (SER.has(verb) && !/^(?:muy|tan|bastante|demasiado)$/u.test(next) && !complement)
      return null;
    if (complement?.plural === (number === "plural")) return null;
  }
  const fix = otherNumber(verb, number);
  if (!fix || fix === verb) return null;
  return replaceToken(ctx, tokens[v], [fix], RULE, MESSAGE, tokens[last]);
}

// "Me gusta las manzanas": these verbs agree with the noun phrase after them.
const LIKING =
  /^(?:gust|encant|interes|import|molest|fascin|preocup|apetec|falt|sobr)(?:a|an|aba|aban|ó|aron|aría|arían|e|en|ará|arán)$/u;
const LIKING_PARTICIPLE =
  /^(?:gust|encant|interes|import|molest|fascin|preocup|apetec|falt|sobr)ado$/u;

function liking(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (!/^(?:me|te|le|nos|os|les)$/u.test(at.prev())) return null;
  const word = tokens[i].lower;
  // "Me ha gustado las manzanas": the auxiliary agrees.
  const perfect = /^(?:ha|han)$/u.test(word) && LIKING_PARTICIPLE.test(at.next());
  if (!perfect && !LIKING.test(word)) return null;
  let j = i + (perfect ? 2 : 1);
  while (/^(?:mucho|más|muchísimo|bastante|tanto|poco)$/u.test(tokens[j]?.lower ?? "")) j++;
  const detToken = tokens[j];
  const nounToken = tokens[j + 1];
  const det = detToken && DETERMINER.get(detToken.lower);
  if (!det || det.forms[0].includes(" ") || !nounToken?.word || nounToken.broken) return null;
  // "No me gustan esa clase de bromas": the noun after "de" counts.
  if (NOT_SUBJECTS.has(nounToken.lower)) return null;
  const noun = readNoun(nounToken.lower);
  if (!noun || noun.plural !== det.slot >= 2) return null;
  // "Me gustan el cine y la música": a coordinated subject is plural.
  const after = new Around(tokens, j + 1).next();
  if (/^(?:y|e|o|u|ni)$/u.test(after) || tokens[j + 2]?.text === ",") return null;
  const number = verbNumber(word);
  if (!number || (number === "plural") === noun.plural) return null;
  const fix = otherNumber(word, number);
  return fix ? replaceToken(ctx, tokens[i], [fix], RULE, MESSAGE, nounToken) : null;
}

// "Son documentado", "Estamos cansado", "Han sido cantado": a plural copula before a
// singular participle.
const PLURAL_COPULA = words(
  "son eran fueron serán serían sean somos éramos fuimos seremos están estaban estuvieron " +
    "estarán estarían estén estamos estábamos estuvimos",
);

function copulaParticiple(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const word = tokens[i].lower;
  let plural = PLURAL_COPULA.has(word);
  // "han sido", "hemos estado".
  if (/^(?:sido|estado)$/u.test(word) && /^(?:han|hemos|habían|habíamos)$/u.test(at.prev()))
    plural = true;
  if (!plural) return null;
  let k = 1;
  if (/mente$/u.test(at.next(k)) || /^(?:siempre|ya|muy|todavía)$/u.test(at.next(k))) k++;
  const next = at.next(k);
  // "Son resultado de…", "No eran pecado": a noun in -ado.
  if (!/^\p{L}+[aií]do$/u.test(next) || !participle(next) || isNoun(next)) return null;
  // "Son pasado mañana", "están hecho polvo" (an idiom some write so).
  if (/^(?:pasado|hecho)$/u.test(next)) return null;
  const token = tokens[i + k];
  return replaceToken(ctx, token, [`${next}s`], RULE, MESSAGE, tokens[i]);
}

function verbAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word || tokens[i].start < ctx.from - 64 || tokens[i].start >= ctx.to) continue;
    const finding =
      subjectVerb(ctx, tokens, i) ?? liking(ctx, tokens, i) ?? copulaParticiple(ctx, tokens, i);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbAgreement }];
