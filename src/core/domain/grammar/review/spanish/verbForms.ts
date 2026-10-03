import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  DETERMINERS,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  words,
  type Tokens,
} from "./common";
import { DETERMINER, readNoun } from "./agreement";
import { HABER, IR, isPerfectParticiple } from "./confusions";
import {
  attribute,
  finiteVerb,
  genderedForm,
  isGerund,
  isNoun,
  isVerb,
  participle,
  presentInfinitive,
  subjunctiveLike,
} from "./lexicon";
import { isLang } from "../phraseTemplates";

// Verb forms after an auxiliary ("han realizando" -> realizado, "ha ido aumentado" ->
// aumentando), the auxiliary "ha"/"he" written as the preposition "a" or the conjunction "e",
// and "de que" against the verbs that take or refuse it.

const RULE = "spanishConfusions" as const;

// "había llamadas": existential forms also stand before plural nouns.
const EXISTENTIAL = words("había hubo habrá haya hubiera hubiese habría haber habiendo");
const ESTAR = words("estoy estás está estamos estáis están estaba estabas estábamos estaban");
const PERFECT = words("he has ha hemos habéis han había habías habíamos habían");
const QUANTIFIER_AFTER = words(
  "todos todas ambos ambas dos tres cuatro cinco seis siete ocho nueve diez cien mil varios varias",
);

/** The gerund of a regular participle's verb: "aumentado" -> "aumentando", "leído" -> "leyendo". */
function gerundOf(word: string): string | null {
  let m = /^(\p{L}+)ado$/u.exec(word);
  if (m) return `${m[1]}ando`;
  m = /^(\p{L}+)ído$/u.exec(word);
  if (m) return `${m[1]}yendo`;
  m = /^(\p{L}+)ido$/u.exec(word);
  return m ? `${m[1]}iendo` : null;
}

/** "salpicadas" -> "salpicado", "realizando" -> "realizado", "encontraron" -> "encontrado". */
/** `nominal`: an agreeing participle may be an adjective or noun here ("había determinadas"). */
function perfectOf(word: string, nominal: boolean): string | null {
  const agreement = participle(word);
  if (agreement && (agreement.feminine || agreement.plural) && !nominal)
    return word.replace(/[oa]s?$/u, "o");
  let m = /^(\p{L}+)ando$/u.exec(word);
  if (m && isGerund(word) && isVerb(`${m[1]}ar`)) return `${m[1]}ado`;
  m = /^(\p{L}+)iendo$/u.exec(word);
  if (m && isGerund(word) && (isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`))) return `${m[1]}ido`;
  m = /^(\p{L}+)aron$/u.exec(word);
  if (m && isVerb(`${m[1]}ar`)) return `${m[1]}ado`;
  m = /^(\p{L}+)ieron$/u.exec(word);
  return m && (isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`)) ? `${m[1]}ido` : null;
}

/** "he intenta", "me he cansa", "he decido", "he quedé" -> "intentado", "cansado", "decidido". */
function finitePerfect(word: string): string | null {
  // "volver ha casa" is the preposition and "ha desecho" a misspelled "deshecho": a noun
  // reading leaves the word alone (an adjective one, "intenta", does not).
  if (word.length < 4 || !finiteVerb(word) || isInfinitive(word) || isGerund(word)) return null;
  if (isNoun(word)) return null;
  if (participle(word)?.feminine === false && /[ai]do$/u.test(word)) return null;
  const found = new Set<string>();
  const ar = /^(\p{L}{2,}?)(?:o|a|as|an|e|es|en|é|ó|aste|ad|amos)$/u.exec(word);
  if (ar && isVerb(`${ar[1]}ar`)) found.add(`${ar[1]}ado`);
  const erIr = /^(\p{L}{2,}?)(?:o|e|es|en|í|ió|iste|ed|id|emos|imos)$/u.exec(word);
  if (erIr && (isVerb(`${erIr[1]}er`) || isVerb(`${erIr[1]}ir`))) found.add(`${erIr[1]}ido`);
  return found.size === 1 ? [...found][0] : null;
}

const BEFORE_AUXILIARY = words(
  "él ella usted ello me te se nos os le les lo la no ya siempre nunca también todavía",
);
// "huele a quemado", "sabe a podrido": a smell or taste, not the auxiliary.
const SENSES = /^(?:huel\p{L}*|ol\p{L}*|sab\p{L}*|sup\p{L}*)$/u;

/**
 * The auxiliary "ha" written as the preposition "a" before a participle: "se a ido", "ella a
 * vuelto", "el atleta a corrido", "A templado los ánimos". The preposition stays in "ponerse a
 * cubierto", "a pedido de", "huele a quemado", "de acusador a acusado" and "sujetos a borrado".
 */
function auxiliaryA(at: Around): boolean {
  const prev = at.prev();
  const next = at.next();
  const typed = at.tokens[at.i].text;
  const nextToken = at.tokens[at.i + 1];
  if (!isPerfectParticiple(next) || nextToken.broken) return false;
  if (typed !== "a" && !(typed === "A" && at.starts)) return false;
  if (/^(?:cubierto|salvo|medio|pedido|contado)$/u.test(next)) return false;
  // After a clitic, a subject pronoun or a verb's adverb only the auxiliary fits, even before
  // a participle that is a noun too ("dicho", "estado").
  if (BEFORE_AUXILIARY.has(prev) || /^(?:alguien|nadie|quien)$/u.test(prev)) return true;
  // Opening the sentence before what the verb takes: "A templado los ánimos".
  if (at.starts && !isNoun(next) && (DETERMINERS.has(at.next(2)) || at.next(2) === "de"))
    return true;
  // A noun subject right before: "el atleta a corrido" ("fue a parar" has no participle).
  if (
    /^(?:el|la|un|una|este|esta|ese|esa|mi|tu|su)$/u.test(at.prev(2)) &&
    isNoun(prev) &&
    !finiteVerb(prev)
  )
    return true;
  return (
    !attribute(prev)?.plural &&
    !isNoun(next) &&
    !genderedForm(next) &&
    !SENSES.test(prev) &&
    !CLITICS.has(prev) &&
    /^\p{Ll}/u.test(nextToken.text) &&
    at.tokens[at.i + 2]?.text !== "-" &&
    ![1, 2, 3, 4].some((k) => at.prev(k) === "de")
  );
}

function check(at: Around): string[] | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  const next = at.next();
  // "ha salpicadas", "han realizando", "se han encontraron": the participle after "haber".
  // "había determinadas posibilidades": an adjective before its noun.
  // "había empadronados", "haya malentendidos": existential "haber" takes nominal participles;
  // "1.900 ha desarboladas" is the hectare.
  const unit = /^\p{N}/u.test(at.tokens[at.i - 2]?.text ?? "");
  if (HABER.has(prev) && !unit) {
    // "pueden haber cambiado", "se puede haber dicho": existential "haber" takes a singular
    // modal and no "se", so after these the infinitive is the perfect's ("pueden haber
    // muertos" is a plural modal before existential "haber" and a noun).
    const existential =
      EXISTENTIAL.has(prev) &&
      !(
        prev === "haber" &&
        !isNoun(word) &&
        (/^(?:\p{L}+(?:mos|is)|puedo|debo|podría|debería)$/u.test(at.prev(2)) ||
          // "Los precios pueden haber…": a plural modal after its subject ("Pueden haber
          // heridos" lacks one and is existential).
          (/^\p{L}+n$/u.test(at.prev(2)) &&
            ((isNoun(at.prev(3)) && DETERMINERS.has(at.prev(4)) && !PREPOSITIONS.has(at.prev(5))) ||
              /^(?:ellos|ellas|ustedes)$/u.test(at.prev(3)))) ||
          at.prev(3) === "se")
      );
    // "habían clasificados todos los papeles": a quantifier or number starts no noun phrase
    // the participle could describe.
    const nominal =
      existential || (isNoun(next) && !QUANTIFIER_AFTER.has(next) && !/^\p{N}/u.test(next));
    const fix = perfectOf(word, nominal) ?? (existential ? null : finitePerfect(word));
    if (fix && fix !== word) return [fix];
  }
  // "nos hemos ido cansado": after a plural "haber" + "ido", a singular participle agrees with
  // nothing, so it is the gerund (or the plural adjective).
  if (
    prev === "ido" &&
    /^(?:hemos|habéis|han|habíamos|habíais|habían)$/u.test(at.prev(2)) &&
    /[ai]do$/u.test(word) &&
    participle(word)
  ) {
    const gerund = gerundOf(word);
    if (gerund) return [gerund, `${word}s`];
  }
  // "ha ido aumentado", "ha estado intentado", "me estoy acostumbrado": a gerund.
  // "ha estado interesado", "se fue cansado": an adjective may follow; only a plain participle
  // ("aumentado", "intentado") wants the gerund.
  if (isPerfectParticiple(word) && !isNoun(word) && !genderedForm(word)) {
    const reflexiveEstar = ESTAR.has(prev) && /^(?:me|te|se|nos|os)$/u.test(at.prev(2));
    // "estás intentado burlarte"; "está permitido fumar" is a passive.
    const estarInfinitive =
      ESTAR.has(prev) && isInfinitive(next) && /^(?:intent|trat|procur|pens)ado$/u.test(word);
    if (
      ((prev === "ido" || prev === "estado") && PERFECT.has(at.prev(2))) ||
      ((prev === "ido" || prev === "estado") && CLITICS.has(at.prev(2))) ||
      reflexiveEstar ||
      estarInfinitive
    ) {
      const fix = gerundOf(word);
      if (fix) return [fix];
    }
  }
  if (word === "a" && auxiliaryA(at)) return ["ha"];
  // "nos e incluido", "siempre e ido": after a clitic, a subject pronoun or a verb's adverb only
  // the auxiliary fits, even before a participle that is a noun too ("dicho", "estado").
  if (
    word === "e" &&
    at.tokens[at.i].text === word &&
    isPerfectParticiple(next) &&
    (BEFORE_AUXILIARY.has(prev) || prev === "yo")
  )
    return ["he"];
  // "E invitado a un amigo": a sentence opens with the auxiliary, not with "and".
  if (word === "e" && at.starts && at.tokens[at.i].text === "E" && isPerfectParticiple(next))
    return ["he"];
  // "siempre e comido": "e" (and) only goes before an i- sound.
  if (word === "e" && isPerfectParticiple(next) && !/^h?i/u.test(next)) return ["he"];
  // "lo ha vuelto ha hacer", "ha estos": the preposition "a".
  if (word === "ha" && next) {
    const after = at.tokens[at.i + 1];
    if (isInfinitive(next) && next !== "haber") return ["a"];
    // "volver ha casa", "voy ha Sevilla": a verb of motion or an infinitive, then a place;
    // "comer ha sido" keeps the auxiliary before its participle.
    if (
      (IR.has(prev) || /^(?:volver|regresar|llegar|venir|ir)$/u.test(prev)) &&
      after.word &&
      !isPerfectParticiple(next) &&
      !/^(?:de|que|sido|estado)$/u.test(next)
    )
      return ["a"];
    if (
      /^(?:este|esta|estos|estas|ese|esa|esos|esas|los|las|el|la)$/u.test(next) &&
      !/^\p{Lu}/u.test(after.text)
    )
      return at.starts ? null : ["a"];
  }
  return null;
}

// Verbs and phrases that take "de que" (queísmo when it is missing) and those that refuse it.
const DAR = words(
  "di diste dio dimos disteis dieron doy das da damos dan daba dabas dábamos daban dado dar " +
    "darse darme darte darnos dé des den diera dieras dieran daría darás dará",
);
const PRONOMINAL =
  /^(?:alegr|quej|enter|acord|acuerd|olvid|hart|arrepent|arrepient|convenc)\p{L}*$/u;
const REFLEXIVE = words("me te se nos os");
const SAYING =
  /^(?:pienso|piensa|piensas|pensamos|piensan|pensaba|pensé|pensó|creo|cree|crees|creemos|creen|creía|opino|opina|opinan|considero|considera|dijo|dije|dicen|digo|dice|decía|supongo|imagino|afirmó|afirma|comentó|asegura|aseguró|anunció|anunciar|explicó|declaró|parece|resulta|resultó)$/u;
const IMPERSONAL = words("posible fácil probable necesario importante seguro cierto difícil");

/** "nos alegramos", "me quejo", "se han enterado", "alegrarse": the verb is reflexive. */
function reflexive(at: Around): boolean {
  const verb = at.prev();
  if (/(?:ar|er|ir|ndo)(?:se|me|te|nos|os)$/u.test(verb)) return true;
  let k = 2;
  if (/(?:ado|ido)$/u.test(verb) && HABER.has(at.prev(2))) k = 3;
  const pronoun = at.prev(k);
  if (!REFLEXIVE.has(pronoun)) return false;
  // "me alegra que" (it pleases me) is not reflexive: the verb agrees with the pronoun.
  if (k === 3) return true;
  if (pronoun === "me") return /(?:o|é|aba|ía)$/u.test(verb);
  if (pronoun === "te") return /s(?:te)?$/u.test(verb);
  if (pronoun === "nos") return /mos$/u.test(verb);
  if (pronoun === "os") return /is$/u.test(verb);
  return !/(?:o|é|mos)$/u.test(verb);
}

function deQue(tokens: Tokens, i: number): { span: [number, number]; fix: string } | null {
  const at = new Around(tokens, i);
  const word = tokens[i].lower;
  if (word === "que" && !tokens[i].broken) {
    const prev = at.prev();
    // "se dio cuenta que", "nos alegramos que", "estoy seguro que": "de que".
    const verb =
      (prev === "cuenta" && DAR.has(at.prev(2))) ||
      (PRONOMINAL.test(prev) && reflexive(at)) ||
      (/^segur[oa]s?$/u.test(prev) &&
        /^(?:estoy|estás|está|estamos|están|estaba|estaban|estar)$/u.test(at.prev(2)));
    if (verb) return { span: [i, i], fix: "de que" };
  }
  if (word === "de" && at.next() === "que" && tokens[i + 1]?.text === "que") {
    const prev = at.prev();
    // "pienso de que", "es posible de que", "me alegra de que": just "que".
    if (
      SAYING.test(prev) ||
      (IMPERSONAL.has(prev) && /^(?:es|era|sería|será|fue)$/u.test(at.prev(2))) ||
      (/^(?:alegra|alegró|alegraba)$/u.test(prev) && /^(?:me|te|le|nos|os|les)$/u.test(at.prev(2)))
    )
      return { span: [i, i + 1], fix: "que" };
  }
  return null;
}

// ------------------------------------------------- clitics before a non-finite form

// Futures that do not keep the infinitive whole ("mantener" -> "mantendrá").
const IRREGULAR_FUTURE: [string, string][] = [
  ["tener", "tendrá"],
  ["poner", "pondrá"],
  ["salir", "saldrá"],
  ["venir", "vendrá"],
  ["valer", "valdrá"],
  ["poder", "podrá"],
  ["querer", "querrá"],
  ["saber", "sabrá"],
  ["caber", "cabrá"],
  ["haber", "habrá"],
  ["hacer", "hará"],
  ["decir", "dirá"],
];

/** "ayudar" -> ["ayuda", "ayudará"]: the third person the clitic most often goes with. */
function thirdPerson(infinitive: string): string[] {
  const irregular = IRREGULAR_FUTURE.find(([ending]) => infinitive.endsWith(ending));
  const future = irregular
    ? `${infinitive.slice(0, -irregular[0].length)}${irregular[1]}`
    : `${infinitive}á`;
  const stem = infinitive.slice(0, -2);
  // Stems that may change ("encuentra", "pide", "envía") get no guessed present.
  const lastVowel = /[aeiouáéíóú](?=[^aeiouáéíóú]*$)/u.exec(stem)?.[0];
  if (irregular || !lastVowel || /[eo]/u.test(lastVowel) || /[iu]$/u.test(stem)) return [future];
  return [`${stem}${infinitive.endsWith("ar") ? "a" : "e"}`, future];
}

/** "nos acomodarnos" -> "nos acomodamos": the clitic written twice around an infinitive. */
const FIRST_PLURAL: Record<string, string> = { ar: "amos", er: "emos", ir: "imos" };

// "le ha dado", "te he encontrado": the "haber" a clitic before a participle needs.
const PERFECT_FOR: Record<string, string[]> = {
  me: ["he", "ha"],
  te: ["ha", "he"],
  se: ["ha", "han"],
  le: ["ha", "he"],
  les: ["ha", "he"],
  nos: ["ha", "hemos"],
  os: ["ha", "habéis"],
};

// Irregular verb forms that are also nouns: "le vino", "le traje", "les dije".
const VERB_NOUNS = words("vino traje dije puse tuve hice vine fui cupo");
const ARTICLE: Record<string, [string, string]> = { m: ["el", "los"], f: ["la", "las"] };

type Fix = { span: [number, number]; fixes: string[]; key: RawFinding["messageKey"] };

/**
 * A clitic where Spanish allows none: before an infinitive ("te ayudar"), before a participle
 * without "haber" ("le dado"), or before a noun where the article goes ("les medidas").
 */
function cliticSlot(tokens: Tokens, i: number): Fix | null {
  const at = new Around(tokens, i);
  const clitic = tokens[i].lower;
  const next = at.next();
  const nextToken = tokens[i + 1];
  if (!PERFECT_FOR[clitic] || !next || !/^\p{Ll}/u.test(nextToken.text)) return null;
  // "un te helado": the tea; "No se nadar" is "sé" (accents.ts).
  if (clitic === "se" || /^(?:un|el|del|al|mi|tu|su)$/u.test(at.prev())) return null;
  const inf = /^(\p{L}+?)([aei])r(nos)?$/u.exec(next);
  if (inf && isVerb(`${inf[1]}${inf[2]}r`)) {
    const infinitive = `${inf[1]}${inf[2]}r`;
    if (inf[3])
      return clitic === "nos"
        ? { span: [i + 1, i + 1], fixes: [`${inf[1]}${FIRST_PLURAL[`${inf[2]}r`]}`], key: VERB }
        : null;
    return { span: [i + 1, i + 1], fixes: thirdPerson(infinitive), key: VERB };
  }
  // "le valido", "le olvido": a first person present that looks like a participle.
  if (
    isPerfectParticiple(next) &&
    !isVerb(`${next.slice(0, -1)}ar`) &&
    // "le hecho sal": the verb "echar" (confusions.ts).
    next !== "hecho" &&
    at.next(2) !== "de" &&
    !/^(?:nos|os)$/u.test(clitic)
  )
    return {
      span: [i, i + 1],
      fixes: PERFECT_FOR[clitic].map((aux) => `${clitic} ${aux} ${next}`),
      key: VERB,
    };
  const noun = readNoun(next);
  if (
    !noun?.gender ||
    !/^(?:le|les|nos|os)$/u.test(clitic) ||
    participle(next) ||
    noun.plural !== (clitic !== "le") ||
    // "les tenias", "le sabia": an imperfect missing its accent.
    (/ia[sn]?$/u.test(next) && ["er", "ir"].some((e) => isVerb(next.replace(/ia[sn]?$/u, e)))) ||
    finiteVerb(next) ||
    subjunctiveLike(next) ||
    isGerund(next) ||
    VERB_NOUNS.has(next) ||
    DETERMINERS.has(next)
  )
    return null;
  return {
    span: [i, i],
    fixes: [ARTICLE[noun.gender][noun.plural ? 1 : 0]],
    key: "review_msg_spanish_pronoun_article",
  };
}

// "empezó a involucrase", "al encontrase": a preposition takes the infinitive ("-arse"), never
// the imperfect subjunctive; "se va a celebra": "ir a" takes the infinitive.
function prepositionVerb(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  if (!/^(?:a|al|de|del|para|sin|por|tras|hasta)$/u.test(prev) || isNoun(word)) return null;
  let m = /^(\p{L}{3,}?)ase$/u.exec(word);
  if (m && isVerb(`${m[1]}ar`)) return `${m[1]}arse`;
  m = /^(\p{L}{2,}?)iese$/u.exec(word);
  if (m) {
    const infinitive = [`${m[1]}er`, `${m[1]}ir`].find(isVerb);
    if (infinitive) return `${infinitive}se`;
  }
  m = /^(\p{L}{3,}?)([ae])$/u.exec(word);
  if (prev === "a" && m && IR.has(at.prev(2)) && !genderedForm(word)) {
    const infinitive = (m[2] === "a" ? [`${m[1]}ar`] : [`${m[1]}er`, `${m[1]}ir`]).find(isVerb);
    if (infinitive) return infinitive;
  }
  return null;
}

// Verbs whose complement is an infinitive: "debería funcionar", "suele llegar", "me gusta comer".
const MODALS =
  /^(?:deb(?:e|en|o|es|emos|ía|ías|ían|ería|erían|erías|eríamos|ió|ieron|erá|erán|erás)|suel(?:e|en|o|es)|sol(?:ía|ían|íamos)|pued(?:e|en|o|es)|pod(?:emos|ía|ías|ían|ría|rían|rías|rá|rán|rás)|gust(?:a|aba|aría|aban|an))$/u;
// "tener que", "hay que", "haber de": the phrase's last word comes right before the infinitive.
const TENER = /^(?:t(?:ien|eng|en|uv|endr)\p{L}*|hay|había|habrá|habría)$/u;
const HABER_DE = words("he has ha hemos habéis han había habían habrá habrán");
// Words after a modal that are no verb form, though they look like one: "no me gusta nada".
const NOT_GOVERNED = words(
  "nada cada toda nunca siempre ahora entre sobre bajo este esta ese esa aquella otra otro " +
    "cerca fuera dentro arriba abajo delante detrás antes mientras tarde pronto alguna ninguna " +
    "mucha poca demasiada tanta cuanta media mitad que",
);
// Subordinators after which "puede"/"quiere" stand alone: "cuando puede, intenta escapar".
const ALONE_AFTER = words("cuando como si donde quien quienes mientras según");

/** "debería funciona" -> "funcionar", "tiene que considera" -> "considerar". */
function governedVerb(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  if (!prev || !/^\p{Ll}/u.test(at.tokens[at.i].text) || NOT_GOVERNED.has(word)) return null;
  const governs =
    (MODALS.test(prev) &&
      !ALONE_AFTER.has(at.prev(2)) &&
      (!/^gust/u.test(prev) || (CLITICS.has(at.prev(2)) && !ALONE_AFTER.has(at.prev(3))))) ||
    (prev === "que" && TENER.test(at.prev(2))) ||
    (prev === "de" && HABER_DE.has(at.prev(2)));
  if (!governs || CLITICS.has(word) || DETERMINERS.has(word) || DETERMINER.has(word)) return null;
  if (isNoun(word) || genderedForm(word) || participle(word) || isInfinitive(word)) return null;
  // "deberán formalizase", "podías encontrara": a past subjunctive that lost the infinitive's
  // "r" ("formalizarse", "encontrar").
  const past = /^(\p{L}{2,}?)(ara|ase|iera|iese)$/u.exec(word);
  if (past) {
    const ending = past[2].startsWith("a")
      ? "ar"
      : ["er", "ir"].find((e) => isVerb(`${past[1]}${e}`));
    if (ending && isVerb(`${past[1]}${ending}`))
      return `${past[1]}${ending}${past[2] === "ase" ? "se" : ""}`;
  }
  return presentInfinitive(word);
}

const VERB = "review_msg_spanish_verb_form" as const;

// Words that read as finite verbs but close set phrases after these prepositions: "de veras",
// "con creces".
const AFTER_PREPOSITION = words("veras creces sobra sobras");
const PAST_OR_CONDITIONAL =
  /(?:aba|abas|aban|ábamos|rías?|rían|ríamos|aron|ieron|asteis|isteis|aste|iste)$/u;

/**
 * "de debería probar", "desde es adulto", "en sueles": a preposition right before a form that
 * is only a finite verb. "desde" lost its "que"; the others hide a mistyped word.
 */
function strayFinite(at: Around): boolean {
  const word = at.tokens[at.i].lower;
  // "de lo debemos", "en los estamos": a pronoun between changes nothing; it needs a verb.
  const k = CLITICS.has(at.prev()) && at.prev() !== "se" ? 2 : 1;
  const prev = at.prev(k);
  if (!/^(?:de|del|en|con|desde|sin)$/u.test(prev) || !/^\p{Ll}+$/u.test(at.tokens[at.i].text))
    return false;
  if (k === 2) {
    if (prev === "del" || prev === "desde") return false;
    // "de las cases": a present subjunctive no noun shares counts too.
    return (
      (PAST_OR_CONDITIONAL.test(word) ||
        /^\p{L}{2,}(?:amos|emos|imos)$/u.test(word) ||
        (/^\p{L}{2,}(?:e|es)$/u.test(word) && subjunctiveLike(word) && !genderedForm(word))) &&
      finiteVerb(word) &&
      !isNoun(word) &&
      !attribute(word) &&
      !isInfinitive(word)
    );
  }
  if (at.tokens[at.i - 2]?.text === "-" || AFTER_PREPOSITION.has(word)) return false;
  // "la de es la cuarta letra": the letter's name.
  if (/^(?:la|una|letra)$/u.test(at.prev(2))) return false;
  // "desde es adulto": "es" is the letter's name too, but no preposition takes that.
  if (/^(?:es|eres|soy|somos|estoy|hay|fue|fui|fueron)$/u.test(word)) return true;
  // Only endings no noun or adverb shares ("debería", "cantaba", "llegaron"); a present form
  // ("arriba", "sede") is too often a word the lexicon does not list as a noun.
  return (
    PAST_OR_CONDITIONAL.test(word) &&
    finiteVerb(word) &&
    !isNoun(word) &&
    !attribute(word) &&
    !isInfinitive(word) &&
    !isGerund(word) &&
    !CLITICS.has(word) &&
    !DETERMINERS.has(word) &&
    !DETERMINER.has(word) &&
    !PREPOSITIONS.has(word) &&
    !/^(?:que|como|cuando|donde|si|no|ya|más|menos|bien|mal|tal|tan|sí)$/u.test(word)
  );
}

function verbForms(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const slot = cliticSlot(tokens, i);
    if (slot) {
      const [from, to] = slot.span;
      const span = {
        ...tokens[from],
        end: tokens[to].end,
        text: ctx.text.slice(tokens[from].start, tokens[to].end),
      };
      const finding = replaceToken(ctx, span, slot.fixes, RULE, slot.key, tokens[i]);
      if (finding) findings.push(finding);
      continue;
    }
    const infinitive =
      prepositionVerb(new Around(tokens, i)) ?? governedVerb(new Around(tokens, i));
    if (infinitive) {
      const finding = replaceToken(ctx, token, [infinitive], RULE, VERB, tokens[i - 1]);
      if (finding) findings.push(finding);
      continue;
    }
    if (strayFinite(new Around(tokens, i))) {
      const prep =
        CLITICS.has(tokens[i - 1].lower) && tokens[i - 2]?.word ? tokens[i - 2] : tokens[i - 1];
      const span = { ...prep, end: token.end, text: ctx.text.slice(prep.start, token.end) };
      const desde = prep.lower === "desde";
      const finding = replaceToken(
        ctx,
        desde ? prep : span,
        desde ? ["desde que"] : [],
        RULE,
        desde ? VERB : "review_msg_spanish_preposition_verb",
        token,
      );
      if (finding) findings.push(desde ? finding : { ...finding, warningOnly: true });
      continue;
    }
    const fixes = check(new Around(tokens, i));
    if (fixes) {
      const finding = replaceToken(
        ctx,
        token,
        fixes,
        RULE,
        "review_msg_spanish_verb_form",
        tokens[i + 1],
      );
      if (finding) findings.push(finding);
      continue;
    }
    const de = deQue(tokens, i);
    if (!de) continue;
    const [from, to] = de.span;
    const span = {
      ...token,
      end: tokens[to].end,
      text: ctx.text.slice(tokens[from].start, tokens[to].end),
    };
    const finding = replaceToken(
      ctx,
      span,
      [de.fix],
      RULE,
      "review_msg_spanish_verb_form",
      tokens[to + 1],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbForms }];
