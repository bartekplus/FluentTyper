import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  isBoundary,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { readNoun } from "./agreement";
import {
  finiteVerb,
  isGerund,
  isNoun,
  isVerb,
  participle,
  presentInfinitive,
  subjunctiveLike,
} from "./lexicon";
import { isLang } from "../phraseTemplates";

// Clause-level frames: "para que" before an indicative asks ("para qué sirve"), a pronoun
// written apart from the gerund or infinitive it hangs on ("cantando lo" -> "cantándolo"), and
// a plural verb before the impersonal "haber" ("pueden haber cuatro" -> "puede haber").

// ------------------------------------------------------------------ para qué

// Past subjunctives look like other tenses: "para que hablaran", "para que viniese".
const PAST_SUBJUNCTIVE = /(?:ra|ras|ra|ramos|rais|ran|se|ses|semos|seis|sen)$/u;
// Present indicative endings, which "para que" (purpose) never takes.
const PRESENT_INDICATIVE = /(?:o|as|a|amos|áis|an|es|e|emos|éis|en|imos|ís)$/u;

/** "Quiero saber para que sirve" -> "para qué": an indicative after it asks for a purpose. */
function paraQue(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (tokens[i].lower !== "que" || at.prev() !== "para" || tokens[i].text !== "que") return null;
  let k = 1;
  while (k < 3 && CLITICS.has(at.next(k))) k++;
  const verb = at.next(k);
  if (!verb || /^\p{Lu}/u.test(tokens[i + k].text) || PAST_SUBJUNCTIVE.test(verb)) return null;
  if (!PRESENT_INDICATIVE.test(verb) || subjunctiveLike(verb) || !finiteVerb(verb)) return null;
  // "para que nadie", "para que todo", "para que como usuario puedas": the verb is further on.
  // "para que halla": "haya" misspelled, not a question.
  if (
    isNoun(verb) ||
    participle(verb) ||
    /^(?:como|cuando|donde|mientras|halla|hallas|hallan)$/u.test(verb)
  )
    return null;
  // "para que podamos": an -er/-ir subjunctive in -a looks like an -ar indicative.
  const a = /^(\p{L}+?)(?:a|as|an|amos|áis)$/u.exec(verb);
  if (a && (isVerb(`${a[1]}er`) || isVerb(`${a[1]}ir`))) return null;
  return replaceToken(
    ctx,
    tokens[i],
    ["qué"],
    "spanishAccents",
    "review_msg_spanish_interrogative",
    tokens[i + k],
  );
}

// ------------------------------------------------------------------ enclitics

const ENCLITIC = words("lo la los las le les me te se nos");
const STRESS: Record<string, string> = { a: "á", e: "é" };

/** The gerund or infinitive with a pronoun joined to it: "cantando" + "lo" -> "cantándolo". */
function joined(verb: string, pronoun: string): string | null {
  if (isInfinitive(verb)) return `${verb}${pronoun}`;
  // A gerund already carrying a pronoun has its accent: "diciéndose" + "lo".
  if (/[áé]ndo/u.test(verb)) return `${verb}${pronoun}`;
  const m = /^(\p{L}*?)([ae])(ndo)$/u.exec(verb);
  return m ? `${m[1]}${STRESS[m[2]]}${m[3]}${pronoun}` : null;
}

/**
 * "Estaba cantando lo en la puerta" -> "cantándolo": a pronoun after a gerund or infinitive and
 * before a preposition or the clause end can only hang on that verb, so it is written joined.
 * "hacer lo que", "comer la de chocolate" and "cantando la canción" keep their article.
 */
function separatedEnclitic(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const verb = tokens[i].lower;
  const pronoun = at.next();
  if (!ENCLITIC.has(pronoun) || tokens[i + 1].broken) return null;
  if (!isGerund(verb) && !isInfinitive(verb)) return null;
  const after = at.next(2);
  // "ver los «caminos naturales»": an opening quote starts the article's noun.
  const ends =
    isBoundary(tokens[i + 2]) &&
    tokens[i + 2]?.text !== "," &&
    !/^["“«'‘]$/u.test(tokens[i + 2]?.text ?? "");
  if (!ends && (!PREPOSITIONS.has(after) || /^(?:de|del|que)$/u.test(after))) return null;
  // "hasta ver lo." is odd but "a la vez" is no pronoun: "lo"/"la" before "a" may be an article
  // of a noun cut off by a line break.
  if (tokens[i + 2]?.broken) return null;
  const fix = joined(verb, pronoun);
  if (!fix) return null;
  const span = {
    ...tokens[i],
    end: tokens[i + 1].end,
    text: ctx.text.slice(tokens[i].start, tokens[i + 1].end),
  };
  return replaceToken(ctx, span, [fix], "spanishConfusions", "review_msg_spanish_enclitic");
}

// ------------------------------------------------------------------ impersonal haber

const PLURAL_MODAL: Record<string, string> = {
  pueden: "puede",
  podían: "podía",
  podrían: "podría",
  pudieron: "pudo",
  deben: "debe",
  debían: "debía",
  deberían: "debería",
  suelen: "suele",
  solían: "solía",
  van: "va",
  iban: "iba",
  tienen: "tiene",
  tenían: "tenía",
  tendrán: "tendrá",
  tendrían: "tendría",
};
// What the impersonal "haber" introduces: a quantity or a plural noun phrase.
const QUANTITY = words(
  "muchos muchas varios varias algunos algunas unos unas pocos pocas demasiados demasiadas " +
    "tantos tantas más menos dos tres cuatro cinco seis siete ocho nueve diez cien mil miles " +
    "cientos millones otros otras nuevos nuevas grandes",
);

/** "Pueden haber cuatro" -> "Puede": the verb before an impersonal "haber" stays singular. */
function impersonalHaber(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const fix = PLURAL_MODAL[tokens[i].lower];
  if (!fix) return null;
  const at = new Around(tokens, i);
  // "tienen que haber", "van a haber" need their linking word; "deben de haber" may have it.
  const link = /^t/u.test(tokens[i].lower)
    ? "que"
    : /^(?:van|iban)$/u.test(tokens[i].lower)
      ? "a"
      : null;
  let k = 1;
  if (link) {
    if (at.next() !== link) return null;
    k = 2;
  } else if (at.next() === "de") k = 2;
  if (at.next(k) !== "haber") return null;
  const what = at.next(k + 1);
  const quantity = QUANTITY.has(what) || /^\p{N}/u.test(tokens[i + k + 1]?.text ?? "");
  if (!quantity) return null;
  return replaceToken(
    ctx,
    tokens[i],
    [fix],
    "spanishAgreement",
    "review_msg_spanish_impersonal_haber",
    tokens[i + k],
  );
}

// ------------------------------------------------------------------ set phrases

const TIME_UNITS =
  /^(?:segundo|minuto|hora|día|semana|mes|año|siglo|década|lustro|rato|tiempo)(?:s|es)?$/u;

/**
 * "hace dos años atrás" -> "hace dos años" or "dos años atrás": "hace" and "atrás" both say
 * "ago". Up to five words of amount may stand between: "hace exactamente un mes y medio atrás".
 */
function agoBack(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  if (tokens[i].lower !== "hace") return null;
  const at = new Around(tokens, i);
  let unit = 0;
  for (let k = 1; k <= 5 && at.next(k); k++)
    if (TIME_UNITS.test(at.next(k))) {
      unit = k;
      break;
    }
  if (!unit) return null;
  let end = unit + 1;
  if (at.next(end) === "y" && /^medi[oa]$/u.test(at.next(end + 1))) end += 2;
  if (at.next(end) !== "atrás") return null;
  const last = tokens[i + end];
  const text = ctx.text.slice(tokens[i].start, last.end);
  const span = { ...tokens[i], end: last.end, text };
  const amount = ctx.text.slice(tokens[i + 1].start, tokens[i + end - 1].end);
  return replaceToken(
    ctx,
    span,
    [`hace ${amount}`, `${amount} atrás`],
    "stylePhrasing",
    "review_msg_style_phrasing",
  );
}

/** "Está apunto de llover" -> "a punto de": "apuntar" takes no "de" before an infinitive. */
function aPunto(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (tokens[i].lower !== "apunto" || at.next() !== "de" || !isInfinitive(at.next(2))) return null;
  return replaceToken(
    ctx,
    tokens[i],
    ["a punto"],
    "spanishConfusions",
    "review_msg_spanish_confusion",
    tokens[i + 2],
  );
}

// ------------------------------------------------------------------ doubled pronouns

// The dative clitic each "a" + pronoun doubles: "a mí me gusta", "a ellas les gusta".
const DOUBLED: Record<string, string> = {
  mí: "me",
  ti: "te",
  él: "le",
  ella: "le",
  usted: "le",
  nosotros: "nos",
  nosotras: "nos",
  vosotros: "os",
  vosotras: "os",
  ellos: "les",
  ellas: "les",
  ustedes: "les",
};
const DATIVE = words("me te le les nos os");

/** "A mí no te gusta" -> "me": the clitic repeats the person "a" + pronoun names. */
function doubledPronoun(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (tokens[i].lower !== "a" || !at.starts) return null;
  const want = DOUBLED[at.next()];
  if (!want) return null;
  let k = 2;
  while (k < 4 && /^(?:no|ya|también|tampoco|nunca|siempre|sí)$/u.test(at.next(k))) k++;
  const clitic = at.next(k);
  // "A él me lo presentaron": two clitics, and the doubled one may be "lo".
  if (!DATIVE.has(clitic) || CLITICS.has(at.next(k + 1)) || !finiteVerb(at.next(k + 1)))
    return null;
  if (clitic === want) return null;
  return replaceToken(
    ctx,
    tokens[i + k],
    [want],
    "spanishAgreement",
    "review_msg_spanish_doubled_pronoun",
    tokens[i + 1],
  );
}

// ------------------------------------------------------------------ accents read from a frame

// "el ingles", "curso de ingles": the language; "las ingles" (the groin) is plural.
const BEFORE_LANGUAGE = words("el del al mi tu su un en y o buen mal nuestro vuestro");
const LANGUAGE_NOUNS = words(
  "curso cursos clase clases profesor profesora profesores examen nivel libro libros alumnos " +
    "alumnas academia traducción diccionario",
);
// What a conditional "sería" goes on with and the adjective "seria" does not.
const AFTER_SERIA = words(
  "lo un una mejor peor posible imposible necesario necesaria conveniente preferible suficiente",
);

/** "el ingles" -> "inglés", "en Paris" -> "París", "cuál seria" -> "sería". */
function framedAccent(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const word = tokens[i].lower;
  const prev = at.prev();
  let fix: string | null = null;
  // "curso de ingles", but "depilación de ingles" is the groin.
  const languageDe = prev === "de" && LANGUAGE_NOUNS.has(at.prev(2));
  if (word === "ingles" && (BEFORE_LANGUAGE.has(prev) || languageDe)) fix = "inglés";
  else if (
    tokens[i].text === "Paris" &&
    // "el juicio de Paris" names the Trojan prince: only prepositions of place.
    /^(?:a|en|hacia|desde|hasta|para|por)$/u.test(prev) &&
    !/^\p{Lu}/u.test(tokens[i + 1]?.text ?? "")
  )
    fix = "París";
  else if (
    word === "seria" &&
    (/^(?:cuál|qué|quién|cómo|dónde)$/u.test(prev) ||
      // "una persona seria lo que buscamos": "lo que" is a relative.
      (AFTER_SERIA.has(at.next()) && at.next(2) !== "que"))
  )
    fix = "sería";
  if (!fix) return null;
  return replaceToken(
    ctx,
    tokens[i],
    [fix],
    "spanishAccents",
    "review_msg_spanish_accent",
    tokens[i - 1],
  );
}

// ------------------------------------------------------------------ dar de alta / dar el alta

const DAR = /^d(?:a|as|an|ar|ado|ando|aba|aban|ió|ieron|ará|arán|aría|arían|é|en|iera|ieran)$/u;
const ALTA_AUXILIARIES =
  /^(?:ha|han|he|has|hemos|había|habían|habrán|va|van|iba|iban|a|puede|pueden|deben|debe|quieren|quiere)$/u;

/**
 * "No les han dado de alta" -> "los"/"las", "No la dieron el alta" -> "le": "dar de alta" takes
 * the person as its object, "dar el alta" gives the discharge to them.
 */
function altaClitic(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const clitic = tokens[i].lower;
  if (!/^(?:le|les|lo|la|los|las)$/u.test(clitic)) return null;
  const at = new Around(tokens, i);
  // "se le dio de alta": the impersonal "se" takes "le".
  if (at.prev() === "se") return null;
  // Only auxiliaries between the clitic and "dar": "les han dado", "los iban a dar".
  let k = 1;
  while (k <= 3 && ALTA_AUXILIARIES.test(at.next(k))) k++;
  if (!DAR.test(at.next(k))) return null;
  const phrase = `${at.next(k + 1)} ${at.next(k + 2)}`;
  const plural = clitic.endsWith("s");
  let fixes: string[] = [];
  // "le" for a man ("le dieron de alta") is accepted leísmo; "les" for a group is not.
  if (/^de (?:alta|baja)$/u.test(phrase) && clitic === "les") fixes = ["los", "las"];
  else if (/^(?:el alta|la baja)$/u.test(phrase) && !clitic.startsWith("le"))
    fixes = [plural ? "les" : "le"];
  if (!fixes.length) return null;
  return replaceToken(
    ctx,
    tokens[i],
    fixes,
    "spanishConfusions",
    "review_msg_spanish_alta",
    tokens[i + k + 2],
  );
}

// ------------------------------------------------------------------ permitir a + infinitive

// Verbs whose person takes an infinitive after "a": "permitió a los niños conocer".
const LETTING = /^(?:permit|dej|impid|imped|prohib)\p{L}*$/u;

/**
 * "Permitió que los niños conocer" -> "a los niños conocer": after "que" the verb would be a
 * subjunctive; with an infinitive the person is introduced by "a".
 */
function permitQue(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (tokens[i].lower !== "que" || !LETTING.test(at.prev())) return null;
  const det = at.next();
  if (!/^(?:el|la|los|las|mi|mis|tu|tus|su|sus|este|esta|estos|estas)$/u.test(det)) return null;
  const noun = at.next(2);
  if (!noun || !readNoun(noun) || isInfinitive(noun) || !isInfinitive(at.next(3))) return null;
  if (det === "el") {
    const span = {
      ...tokens[i],
      end: tokens[i + 1].end,
      text: ctx.text.slice(tokens[i].start, tokens[i + 1].end),
    };
    return replaceToken(
      ctx,
      span,
      ["al"],
      "spanishConfusions",
      "review_msg_spanish_verb_form",
      tokens[i + 3],
    );
  }
  return replaceToken(
    ctx,
    tokens[i],
    ["a"],
    "spanishConfusions",
    "review_msg_spanish_verb_form",
    tokens[i + 3],
  );
}

// ------------------------------------------------------------------ repeated adverbs

const REPEATABLE_ADVERBS = words("también tampoco ya solo sólo aún todavía siempre nunca");

/** "También se llama también así" -> drop one: the same adverb twice in a short clause. */
function repeatedAdverb(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const word = tokens[i].lower;
  // "ya sea uno, ya sea otro": the correlative repeats on purpose.
  if (!REPEATABLE_ADVERBS.has(word) || (word === "ya" && tokens[i + 1]?.lower === "sea"))
    return null;
  for (let k = 2; k <= 4; k++) {
    const token = tokens[i + k];
    if (!token || token.broken || !tokens[i + k - 1]?.word || !token.word) return null;
    if (token.lower !== word) continue;
    // Remove the second one with the space before it.
    const start = tokens[i + k - 1].end;
    const span = { ...token, start, text: ctx.text.slice(start, token.end) };
    return replaceToken(
      ctx,
      span,
      [""],
      "stylePhrasing",
      "review_msg_style_phrasing",
      tokens[i],
      true,
    );
  }
  return null;
}

// ------------------------------------------------------------------ preposition + finite verb

// Prepositions, which take a noun or an infinitive and never a present form ("al informa",
// "con informa"). Only -a forms are read: the lexicon knows the nouns spelled like one ("de
// descarga", "con ayuda") better than those spelled like an -e form ("de aguante"). "hasta"
// may mean "even" and "según" a clause ("y hasta escanea", "según informa la radio").
const GOVERNING = words("del al de en con por sin desde sobre entre hacia contra tras");
// Adverbs and nouns that look like verb forms after a preposition: "de cerca", "desde hace".
const NOT_FINITE_HERE = words(
  "hace cerca acerca fuera dentro arriba abajo delante detrás antes encima debajo afuera adentro este " +
    "atrás adelante nada toda cada media mitad sobre bajo entre tarde pronto mientras",
);

/**
 * "al informa." -> "al informar", "con informa." -> "con informar": a preposition takes a noun
 * or an infinitive, never a present form, when nothing but a preposition or the clause end
 * follows it.
 */
function prepositionFinite(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const word = tokens[i].lower;
  if (!GOVERNING.has(at.prev()) || NOT_FINITE_HERE.has(word) || tokens[i].broken) return null;
  if (!/^\p{Ll}/u.test(tokens[i].text) || word.length < 4) return null;
  if (isNoun(word) || readNoun(word) || participle(word) || isInfinitive(word)) return null;
  if (!finiteVerb(word) || !/a$/u.test(word)) return null;
  if (!at.endsAfter() && !PREPOSITIONS.has(at.next())) return null;
  const infinitive = presentInfinitive(word);
  return infinitive
    ? replaceToken(
        ctx,
        tokens[i],
        [infinitive],
        "spanishConfusions",
        "review_msg_spanish_verb_form",
        tokens[i - 1],
      )
    : null;
}

type Frame = (ctx: DetectContext, tokens: Token[], i: number) => RawFinding | null;

function scan(...frames: Frame[]) {
  return (ctx: DetectContext): RawFinding[] => {
    if (!isLang(ctx, "es")) return [];
    const tokens = tokenize(ctx);
    const findings: RawFinding[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i].word || tokens[i].start < ctx.from || tokens[i].start >= ctx.to) continue;
      for (const frame of frames) {
        const finding = frame(ctx, tokens, i);
        if (finding) findings.push(finding);
      }
    }
    return findings;
  };
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["spanishAccents"], detect: scan(paraQue, framedAccent) },
  {
    rules: ["spanishConfusions"],
    detect: scan(separatedEnclitic, aPunto, altaClitic, permitQue, prepositionFinite),
  },
  { rules: ["stylePhrasing"], detect: scan(agoBack, repeatedAdverb) },
  { rules: ["spanishAgreement"], detect: scan(impersonalHaber, doubledPronoun) },
];
