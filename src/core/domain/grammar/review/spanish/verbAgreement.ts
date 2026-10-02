import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { DETERMINER, pluralOf, readNoun } from "./agreement";
import {
  Around,
  CONJUNCTIONS,
  GIVEN_NAMES,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { finiteVerb, genderedForm, isGenderedEntry, isNoun, isVerb, participle } from "./lexicon";

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

/** A capitalized given name, or mid-sentence a capitalized word the lexicon does not know. */
function personName(token: Token, sentenceStart: boolean): boolean {
  if (!/^\p{Lu}\p{Ll}+$/u.test(token.text)) return false;
  const word = token.lower;
  if (GIVEN_NAMES.has(word)) return true;
  // Every word is capitalized at the start: "Quizás", "Ojalá" and "Oye" name no one.
  if (sentenceStart) return false;
  return (
    word.length > 2 &&
    !isNoun(word) &&
    !isGenderedEntry(word) &&
    !genderedForm(word) &&
    !finiteVerb(word) &&
    !DETERMINER.has(word) &&
    !PREPOSITIONS.has(word) &&
    !CONJUNCTIONS.has(word) &&
    !CLOSED_WORDS.has(word) &&
    !/mente$/u.test(word)
  );
}
const CLOSED_WORDS = words(
  "yo tú él ella usted nosotros nosotras vosotros vosotras ellos ellas ustedes no ya hoy ayer " +
    "mañana aquí allí así también tampoco muy más menos siempre nunca entonces luego después " +
    "antes ahora todavía aún quien quienes cual cuales donde cuando como qué quién cómo dónde " +
    "cuándo cuál todo todos todas nada nadie algo alguien eso esto aquello ambos varios",
);

type Person = "1s" | "2s" | "1p" | "2p" | "3p" | "vowel";
const FIRST_SINGULAR = words("soy estoy voy doy he sé");

/** The person a verb form's ending shows, or null; "vowel" is a 1st or 3rd singular. */
function personOf(word: string): Person | null {
  if (FIRST_SINGULAR.has(word)) return "1s";
  if (/mos$/u.test(word)) return "1p";
  if (/(?:áis|éis|ís)$/u.test(word)) return "2p";
  if (/n$/u.test(word)) return "3p";
  if (/(?:as|es|ás|és|ste)$/u.test(word)) return "2s";
  if (/[^aeiouáéíóú]o$/u.test(word)) return "1s";
  return /[aeéí]$/u.test(word) ? "vowel" : null;
}
// What each subject pronoun's verb may show: "yo tenía" shares the 3rd person's form.
const PERSONS: Record<string, Person[]> = {
  yo: ["1s", "vowel"],
  tú: ["2s"],
  nosotros: ["1p"],
  nosotras: ["1p"],
  vosotros: ["2p"],
  vosotras: ["2p"],
};
const NOT_VERBS = words(
  "solo sola mismo misma mismos mismas también tampoco todo todos todas ahora siempre nunca " +
    "antes después aquí allí bien mal más menos tanto apenas casi",
);

/** "Yo vienes", "Tú vengo", "Vosotros venimos": a subject pronoun and a verb of another person. */
function pronounPerson(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const allowed = PERSONS[tokens[i].lower];
  if (!allowed || !clauseStart(tokens, i)) return null;
  // "donde nosotros nieva" (where we live), "nadie más que nosotros sabe": no subject.
  const at = new Around(tokens, i);
  if (at.prev() === "donde" || /^(?:más|menos|tanto|igual|mejor|peor)$/u.test(at.prev(2)))
    return null;
  const v = verbAfter(tokens, i);
  if (v < 0 || /^\p{Lu}/u.test(tokens[v].text)) return null;
  const verb = tokens[v].lower;
  if (NOT_VERBS.has(verb) || CONJUNCTIONS.has(verb) || PREPOSITIONS.has(verb)) return null;
  // "Nosotros hace dos años…", "nieva": impersonal verbs take no subject.
  if (IMPERSONAL.test(verb) || /^(?:llueve|nieva|graniza|truena|amanece|anochece)$/u.test(verb))
    return null;
  if (!finiteVerb(verb) || isNoun(verb) || genderedForm(verb) || participle(verb)) return null;
  const person = personOf(verb);
  if (!person || allowed.includes(person)) return null;
  // "tú" before a vowel-final form may be an imperative's subject: "Tú calla".
  if (tokens[i].lower === "tú" && person === "vowel") return null;
  const finding = replaceToken(ctx, tokens[v], [], RULE, MESSAGE, tokens[i]);
  return finding && { ...finding, warningOnly: true };
}

/** Subject (pronoun, or determiner + noun) at clause start and the verb after it. */
function subjectVerb(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const token = tokens[i];
  if (!clauseStart(tokens, i)) return null;
  let subject: "singular" | "plural";
  let last = i;
  if (SINGULAR_PRONOUNS.has(token.lower)) subject = "singular";
  else if (PLURAL_PRONOUNS.has(token.lower)) subject = "plural";
  else if (personName(token, new Around(tokens, i).starts)) {
    // "Juan tienen", "Marta Ruiz llegan": a person's name, with up to two more name parts.
    subject = "singular";
    while (last < i + 2 && /^\p{Lu}\p{Ll}+$/u.test(tokens[last + 1]?.text ?? "")) last++;
    if (tokens[last + 1]?.broken) return null;
  } else {
    const det = DETERMINER.get(token.lower);
    const nounToken = tokens[i + 1];
    if (!det || !nounToken?.word || nounToken.broken || det.forms[0].includes(" ")) return null;
    if (/^(?:del|al)$/u.test(token.lower) || NOT_SUBJECTS.has(nounToken.lower)) return null;
    // "¿Cuántos coches ha tenido?", "Tantas cosas ha visto": a fronted object.
    if (/^(?:tant|cuant|cuánt)/u.test(token.lower)) return null;
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

// "La casa es bonito", "Ellos son bella", "Su madre estaba casado": an adjective after a
// copula agrees with the subject opening the clause.
const COPULA = words(
  "es era fue será sería sea está estaba estuvo estará estaría esté parece parecía resulta " +
    "resultó queda quedó son eran fueron serán serían sean están estaban estuvieron estarán " +
    "estarían estén parecen parecían resultan resultaron quedan quedaron",
);
const ESTAR = /^(?:est\p{L}+|qued\p{L}+)$/u;
const DEGREE = words("muy tan bastante demasiado más menos siempre ya bien mal casi");
// Adjectives that lead a noun phrase of their own: "La vida es puro teatro", "es otro mundo".
const LEADING = words(
  "otro otra otros otras mismo misma mismos mismas primero primera último última mucho " +
    "mucha muchos muchas poco poca pocos pocas todo toda todos todas tanto tanta cierto " +
    "cierta alguno alguna ninguno ninguna uno una solo sola medio media puro pura justo",
);

const PROFESSIONS = words(
  "médico abogado ingeniero arquitecto maestro técnico ministro secretario cocinero camarero " +
    "enfermero psicólogo biólogo químico físico político diputado juez notario veterinario " +
    "farmacéutico informático fontanero carpintero mecánico funcionario empleado ayudante " +
    "músico bombero policía soldado piloto",
);

/** The form of a paired adjective for a gender and number: "bonito" -> "bonitas". */
function adjectiveFor(word: string, feminine: boolean, plural: boolean): string | null {
  const m = /^(\p{L}+?)(?:o|a|os|as)$/u.exec(word);
  if (m && isGenderedEntry(`${m[1]}o`)) return `${m[1]}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
  const base = /^(\p{L}+?)(?:a|as|es)?$/u.exec(word)?.[1];
  if (!base || !isGenderedEntry(base) || /[aeiouáéíóú]$/u.test(base)) return null;
  if (feminine) return `${base}a${plural ? "s" : ""}`;
  return plural ? pluralOf(base) : base;
}

function attribute(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  if (!clauseStart(tokens, i)) return null;
  const token = tokens[i];
  let feminine: boolean | null;
  let plural: boolean;
  let pronoun = false;
  let k = i + 1;
  if (/^(?:él|ella|ellos|ellas)$/u.test(token.lower)) {
    feminine = /^ella/u.test(token.lower);
    plural = token.lower.endsWith("s");
    pronoun = true;
  } else {
    const det = DETERMINER.get(token.lower);
    const nounToken = tokens[i + 1];
    if (!det || det.forms[0].includes(" ") || !nounToken?.word || nounToken.broken) return null;
    if (NOT_SUBJECTS.has(nounToken.lower) || /^(?:tant|cuant|cuánt)/u.test(token.lower))
      return null;
    const noun = readNoun(nounToken.lower);
    if (!noun || noun.plural !== det.slot >= 2) return null;
    feminine = noun.gender ? noun.gender === "f" : null;
    plural = noun.plural;
    k = i + 2;
  }
  if (tokens[k]?.lower === "no") k++;
  const copula = tokens[k]?.lower ?? "";
  if (!COPULA.has(copula) || tokens[k].broken) return null;
  const copulaPlural = /n$/u.test(copula);
  if (copulaPlural !== plural) return null;
  k++;
  while (DEGREE.has(tokens[k]?.lower ?? "") || /mente$/u.test(tokens[k]?.lower ?? "")) k++;
  const adjToken = tokens[k];
  if (!adjToken?.word || adjToken.broken || !/^\p{Ll}/u.test(adjToken.text)) return null;
  const word = adjToken.lower;
  if (LEADING.has(word) || ctx.dictionary.has(word)) return null;
  const form = genderedForm(word);
  if (!form) return null;
  // "La vida es puro teatro": the adjective leads a noun after it.
  const after = new Around(tokens, k).next();
  if (after && (DETERMINER.has(after) || (readNoun(after) && !readNoun(after)?.paired)))
    return null;
  const numberClash = form.plural !== plural;
  // "Ella es médico", "Su profesión es abogado": with "ser", a masculine form after a
  // feminine subject may name a profession.
  const profession = feminine && !ESTAR.test(copula) && (pronoun || PROFESSIONS.has(word));
  const genderClash = feminine !== null && form.feminine !== feminine && !profession;
  if (!numberClash && !genderClash) return null;
  const fix = adjectiveFor(word, genderClash ? !form.feminine : form.feminine, plural);
  if (!fix || fix === word) return null;
  return replaceToken(ctx, adjToken, [fix], RULE, MESSAGE, tokens[i]);
}

function verbAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  const attributes: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word || tokens[i].start < ctx.from - 64 || tokens[i].start >= ctx.to) continue;
    const finding =
      subjectVerb(ctx, tokens, i) ??
      pronounPerson(ctx, tokens, i) ??
      liking(ctx, tokens, i) ??
      copulaParticiple(ctx, tokens, i);
    if (finding) findings.push(finding);
    const adjective = attribute(ctx, tokens, i);
    if (adjective) attributes.push(adjective);
  }
  // The subject's gender beats the copula's number alone: "Ellas están cansado" -> cansadas.
  const taken = new Set(attributes.map((f) => f.range.start));
  return [...findings.filter((f) => !taken.has(f.range.start)), ...attributes];
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbAgreement }];
