import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  CONJUNCTIONS,
  DETERMINERS,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  verbLike,
  words,
  type Token,
} from "./common";
import { readNoun } from "./agreement";
import { attribute, finiteVerb, isGerund, isNoun, participle, secondPersonVerb } from "./lexicon";

// Spanish homophones decided by a closed-class frame around them: "cada ves" (vez), "el ano
// pasado" (año), "ha echo" (hecho), "a ver estudiado" (haber). The typed word is a real word,
// so each check names the neighbour that rules its reading out.

const RULE = "spanishConfusions" as const;

const NUMBER_WORDS = words(
  "un una uno dos tres cuatro cinco seis siete ocho nueve diez once doce quince veinte " +
    "treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento mil",
);
const isNumber = (token: Token | undefined) =>
  !!token && (/^\p{N}/u.test(token.text) || NUMBER_WORDS.has(token.lower));
export const HABER = words(
  "he has ha hemos habéis han había habías habíamos habíais habían hube hubo habré habrás " +
    "habrá habremos habrán habría habrías habríamos habrían haya hayas hayamos hayan hubiera " +
    "hubieras hubiéramos hubieran hubiese haber habiendo",
);
export const IR = words(
  "voy vas va vamos vais van iba ibas íbamos iban fui fuiste fuimos fueron vaya vayas vayamos " +
    "vayan ir yendo",
);
// "a ver" / "haber": what comes after a perfect "haber" is a participle.
export const isPerfectParticiple = (word: string) =>
  /o$/u.test(word) && !!participle(word) && !participle(word)!.plural;

/** "año" frames: a time word or a number makes "ano" the year. */
function yearReading(at: Around): boolean {
  const tokens = at.tokens;
  const prev = at.prev();
  const next = at.next();
  const plural = tokens[at.i].lower === "anos";
  if (isNumber(tokens[at.i - 1]) && !tokens[at.i].broken) return true;
  if (/^(?:pasado|próximo|siguiente|anterior|entrante|nuevo|que)$/u.test(next)) return true;
  if (plural && /^(?:pasados|próximos|siguientes|anteriores|venideros)$/u.test(next)) return true;
  if (
    /^(?:cada|este|ese|aquel|primer|último|próximo|pasado|medio|nuevo|todo|esos|estos|aquellos|varios|muchos|pocos|algunos|siguientes|últimos|primeros)$/u.test(
      prev,
    )
  )
    return true;
  if (
    plural &&
    /^(?:ochenta|noventa|setenta|sesenta|cincuenta|cuarenta|treinta|veinte)$/u.test(next)
  )
    return true;
  // "en el ano 1920", "del ano 2010".
  if (isNumber(tokens[at.i + 1]) && !tokens[at.i + 1].broken && /^(?:el|del|al|los)$/u.test(prev))
    return true;
  // "tres veces al ano", "días del ano".
  return (
    (prev === "al" || prev === "por" || prev === "del") &&
    at.endsAfter() &&
    /^(?:veces|vez|días|semanas|meses|euros|dólares|€|\$)$/u.test(at.tokens[at.i - 2]?.lower ?? "")
  );
}

type Check = (at: Around) => string[] | null;

const MODALS = words(
  "puede pueden podía podían podrá podrán podría podrían debe deben debía debían debería " +
    "deberían suele suelen solía solían",
);

/** Checks by the typed (lowercase) word. Each returns the replacement(s) or null. */
const CHECKS: Record<string, Check> = {
  ano: (at) => (yearReading(at) ? ["año"] : null),
  anos: (at) => (yearReading(at) ? ["años"] : null),
  // "ha echo", "está echo de madera": haber or estar + the participle of "hacer".
  echo: (at) =>
    HABER.has(at.prev()) || /^(?:está|parece|bien|mal)$/u.test(at.prev()) ? ["hecho"] : null,
  // "se los hecha", "hecha de menos": the verb "echar".
  hecho: (at) => echar(at, "echo"),
  hecha: (at) => echar(at, "echa"),
  hechas: (at) => echar(at, "echas"),
  hechan: (at) => echar(at, "echan"),
  hechamos: (at) => echar(at, "echamos"),
  // "hay gustado", "no hay podido": a participle after "hay" wants "ha".
  hay: (at) => {
    const next = at.next();
    if (at.tokens[at.i - 1]?.text === "¡" && next === "de") return ["ay"];
    if (!isPerfectParticiple(next) || isNoun(next)) return null;
    // "Hay venido tarde", "Hay dicho que no": opening the sentence, before what a verb takes
    // ("Hay helado de fresa" names a thing).
    const verbal =
      at.starts &&
      (isInfinitive(at.next(2)) ||
        DETERMINERS.has(at.next(2)) ||
        /^(?:que|muy|tarde|pronto|temprano|ya|bien|mal|mucho|hoy|ayer|aquí|allí)$/u.test(
          at.next(2),
        ));
    return CLITICS.has(at.prev()) || at.prev() === "no" || verbal || !attribute(next)
      ? ["ha"]
      : null;
  },
  // "haz hecho": "haz" (do!) takes no participle; "haz de venir" is "has de".
  haz: (at) => {
    const prev = at.prev();
    if (DETERMINERS.has(prev) || PREPOSITIONS.has(prev)) return null;
    const next = at.next();
    if (isPerfectParticiple(next) && !isNoun(next)) return ["has"];
    return next === "de" && isInfinitive(at.next(2)) ? ["has"] : null;
  },
  // "el día se mi cumpleaños" -> "de": no clitic goes before a possessive. "Pueden se
  // compensados" -> "ser", "lo que se dado en llamar" -> "se ha": nor before a participle.
  se: (at) => {
    const next = at.next();
    if (!next || at.tokens[at.i + 1].broken) return null;
    if (/^(?:mi|mis|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras)$/u.test(next)) return ["de"];
    const form = participle(next);
    if (!form || !/[ai]d[oa]s?$/u.test(next)) return null;
    if (MODALS.has(at.prev())) return isNoun(next) ? null : ["ser"];
    // Even participles that are nouns or adjectives too ("dado", "acabado").
    return !form.feminine && !form.plural ? ["se ha"] : null;
  },
  valla: (at) => goVerb(at, "vaya"),
  vallas: (at) => goVerb(at, "vayas"),
  vallan: (at) => goVerb(at, "vayan"),
  vallamos: (at) => goVerb(at, "vayamos"),
  // "que halla comprado": a participle after it makes "halla" the auxiliary "haya".
  halla: (at) => subjunctiveHaber(at, "haya"),
  hallan: (at) => subjunctiveHaber(at, "hayan"),
  hallas: (at) => subjunctiveHaber(at, "hayas"),
  // "Se haya en el centro": "hallarse en" (to be located).
  haya: (at) => locatedHallar(at, "halla"),
  hayan: (at) => locatedHallar(at, "hallan"),
  // "estaba apunto de llegar": the phrase "a punto (de)".
  apunto: (at) => {
    const prev = at.prev();
    if (CLITICS.has(prev) || prev === "yo" || prev === "lo") return null;
    if (at.next() === "de" && isInfinitive(at.next(2))) return ["a punto"];
    return /^(?:estaba|estaban|está|están|estar|estoy|estás|estamos|todo|puesta|poner|ponerlo|ponerla|ponerlos|ponerlas)$/u.test(
      prev,
    ) && at.endsAfter()
      ? ["a punto"]
      : null;
  },
  // "giran entorno a", "miraban entorno": the phrase "en torno (a)".
  entorno: (at) => {
    const prev = at.prev();
    if (!prev || DETERMINERS.has(prev) || PREPOSITIONS.has(prev) || CONJUNCTIONS.has(prev))
      return null;
    if (attribute(prev)) return null;
    if (isNoun(prev) && !verbLike(prev)) return null;
    const next = at.next();
    return /^(?:a|al|de|del|suyo|suya|mío|tuyo|nuestro)$/u.test(next) || at.endsAfter()
      ? ["en torno"]
      : null;
  },
  cuidad: (at) =>
    /^(?:la|mi|tu|su|nuestra|vuestra|esta|esa|aquella|una|gran|cada|otra|misma|propia)$/u.test(
      at.prev(),
    )
      ? ["ciudad"]
      : null,
  // "Me lamo Pedro", "¿Cómo te lamas?": "llamarse" before a name.
  lamo: (at) => calledName(at, "llamo"),
  lamas: (at) => calledName(at, "llamas"),
  lama: (at) => calledName(at, "llama"),
  lamamos: (at) => calledName(at, "llamamos"),
  // "¡Ola!", "Ola, Juan": a greeting.
  ola: (at) => {
    const next = at.tokens[at.i + 1];
    // "decir ola", "¿Ola, qué tal?", "Ola qué tal": a greeting said or opening a question.
    if (
      /^(?:decir|decirle|decirte|dije|dijo|digo|dice|saludar)$/u.test(at.prev()) &&
      at.endsAfter()
    )
      return ["hola"];
    return at.starts &&
      (!next ||
        /^[,!]$/u.test(next.text) ||
        (next.word && /^\p{Lu}/u.test(next.text)) ||
        /^(?:qué|cómo|quién)$/u.test(next.lower))
      ? ["hola"]
      : null;
  },
  // "Fue el la plaza": an article cannot precede another; before a noun it is "en".
  el: (at) => {
    const noun = at.next(2);
    return /^(?:la|las)$/u.test(at.next()) &&
      at.tokens[at.i + 2]?.text === noun &&
      isNoun(noun) &&
      !finiteVerb(noun) &&
      !verbLike(noun) &&
      !/^(?:bemol|sostenido|mayor|menor|natural)$/u.test(noun)
      ? ["en"]
      : null;
  },
  // "una gran hola": the wave.
  hola: (at) =>
    /^(?:una|la|gran|esta|esa|aquella|otra|cada|primera|segunda|nueva)$/u.test(at.prev())
      ? ["ola"]
      : null,
  // "Haber si puedes", "Haber, ¿qué pasa?", "fue haber a su abuela": "a ver".
  haber: (at) => {
    const next = at.next();
    const nextToken = at.tokens[at.i + 1];
    const before = at.tokens[at.i - 1];
    if (!before || at.tokens[at.i].broken || /^[.!?¡…«“"]$/u.test(before.text)) {
      if (/^(?:si|qué|quién|quiénes|cuántos|cuántas|cuánto|cuándo|cómo|dónde|por)$/u.test(next))
        return ["a ver"];
      if (nextToken?.text === ",") return ["a ver"];
    }
    // "fue haber a su abuela", "empezó haber la serie": "ir"/"empezar" take "a"; before a
    // noun phrase it may be "a haber" too ("va haber una fiesta").
    const prev = at.prev();
    const motion =
      IR.has(prev) || prev === "fue" || /^(?:llev|acompañ|mand|envi|vin|vien)\p{L}+$/u.test(prev);
    if (
      !(motion || /^(?:empez|comenz|empiez|comienz)\p{L}+$/u.test(prev)) ||
      !next ||
      isPerfectParticiple(next)
    )
      return null;
    // "La causa fue haber un error": "ser" before an existential infinitive.
    if (DETERMINERS.has(next) || /^(?:buen|buenos|buenas|mucho|mucha|muchos|muchas)$/u.test(next))
      return prev === "fue" ? null : IR.has(prev) || !motion ? ["a ver", "a haber"] : ["a ver"];
    return CLITICS.has(next) || !motion ? null : ["a ver"];
  },
};

const PLURAL_HABER: Record<string, string> = {
  han: "ha",
  habían: "había",
  habrán: "habrá",
  habrían: "habría",
  hayan: "haya",
  hubieran: "hubiera",
  hubiesen: "hubiese",
};

/** "más efímera aún que": a comparative a few words back. */
const comparative = (at: Around) =>
  [1, 2, 3].some((k) => /^(?:más|menos|mayor|menor|mejor|peor|tanto)$/u.test(at.prev(k)));

function echar(at: Around, fix: string): string[] | null {
  const prev = at.prev();
  // "hecha de menos" (misses); "un hecho de menos importancia" is a noun phrase.
  if (at.next() === "de" && at.next(2) === "menos" && (at.endsAfter(2) || at.next(3) === "a"))
    return [fix];
  if (/^(?:me|te|le|les|nos|os|se)$/u.test(prev)) return [fix];
  if (!/^(?:lo|la|los|las)$/u.test(prev)) return null;
  // "las hechan", "lo hechas": no participle agrees there; "las hechas a mano" (the ones made).
  const participleForm = /^hech[oa]s?$/u.test(at.tokens[at.i].lower);
  return !participleForm || (prev === "lo" && !fix.endsWith("o")) ? [fix] : null;
}

function goVerb(at: Around, fix: string): string[] | null {
  if (DETERMINERS.has(at.prev()) || PREPOSITIONS.has(at.prev())) return null;
  const next = at.next();
  if (
    (next === "a" || next === "al") &&
    /^(?:que|cuando|si|ojalá|lo|me|te|se|nos)$/u.test(at.prev())
  )
    return [fix];
  return isGerund(next) ? [fix] : null;
}

function subjunctiveHaber(at: Around, fix: string): string[] | null {
  // "que halla", "que te halla", "que no halla", "que no te halla".
  const words = [1, 2, 3].map((k) => at.prev(k));
  // "para que halla climatización", "ojalá halla suerte": these only take a subjunctive.
  if ((words[0] === "que" && words[1] === "para") || words[0] === "ojalá") return [fix];
  if (words[0] !== "que" && words[0] !== "no" && (!CLITICS.has(words[0]) || words[0] === "se"))
    return null;
  const trigger = words
    .slice(0, words.indexOf("que") + 1 || 0)
    .every((word, k, all) => k === all.length - 1 || word === "no" || CLITICS.has(word));
  if (!trigger || !words.includes("que")) return null;
  const next = at.next();
  if (isPerfectParticiple(next)) return [fix];
  // "que halla más huelgas": existential.
  return /^(?:más|menos|algo|alguien|nada|nadie|un|una|unos|unas|mucho|mucha|muchos|muchas)$/u.test(
    next,
  ) && words[0] === "que"
    ? [fix]
    : null;
}

function locatedHallar(at: Around, fix: string): string[] | null {
  if (at.prev() !== "se") return null;
  const next = at.next();
  if (next === "en") return [fix];
  // A main clause cannot be subjunctive: "Se haya situado al final" at a sentence start.
  const start = new Around(at.tokens, at.i - 1).starts;
  return start && /^(?:ubicad|situad|instalad|sitiad|localizad)[oa]s?$/u.test(next) ? [fix] : null;
}

function calledName(at: Around, fix: string): string[] | null {
  const prev = at.prev();
  if (!/^(?:me|te|se|nos|os)$/u.test(prev)) return null;
  const next = at.tokens[at.i + 1];
  if (next?.word && !next.broken && /^\p{Lu}/u.test(next.text)) return [fix];
  return at.prev(2) === "cómo" && at.endsAfter() ? [fix] : null;
}

const PERFECT_BEFORE =
  /^(?:pod\p{L}*|deb\p{L}*|pued\p{L}*|pud\p{L}*|tenía|tendría|que|sin|de|por|para|parece|parecía|habría)$/u;

/** "a ver estudiado", "a verlo dicho": "haber" before a participle. */
function aVer(tokens: Token[], i: number): { end: number; fix: string } | null {
  const a = tokens[i];
  const ver = tokens[i + 1];
  if (a.lower !== "a" || !ver?.word || ver.broken) return null;
  const m = /^(ver|vér)((?:me|te|se|nos|os|le|les|lo|los|la|las){0,2})$/u.exec(ver.lower);
  if (!m) return null;
  // "podría a ver sido", "sin a ver dicho", "¡A ver estudiado!"; "vuelva a ver afectado" sees.
  const prev = new Around(tokens, i);
  if (!prev.starts && !PERFECT_BEFORE.test(prev.prev())) return null;
  const next = tokens[i + 2];
  // "Podría a ver otros", "debería a verlo": a modal takes no "a", so "haber" is meant.
  if (/^(?:pod|deb|pued|pud)\p{L}*$/u.test(prev.prev()) && !next?.broken)
    return { end: ver.end, fix: `hab${m[1] === "vér" ? "é" : "e"}r${m[2]}` };
  if (!next?.word || next.broken || !isPerfectParticiple(next.lower) || isNoun(next.lower))
    return null;
  return { end: ver.end, fix: `hab${m[1] === "vér" ? "é" : "e"}r${m[2]}` };
}

function confusions(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    // "aún que" / "aun que" are "aunque" (but "más aún que" compares).
    if (
      (token.lower === "aún" || token.lower === "aun") &&
      at.next() === "que" &&
      (at.starts || tokens[i - 1]?.text === "," || (token.lower === "aun" && !comparative(at)))
    ) {
      const span = {
        ...token,
        end: tokens[i + 1].end,
        text: ctx.text.slice(token.start, tokens[i + 1].end),
      };
      const finding = replaceToken(ctx, span, ["aunque"], RULE, "review_msg_spanish_confusion");
      if (finding) findings.push(finding);
      continue;
    }
    // Existential "haber" has no plural: "han habido quejas" is "ha habido"; "han habido de
    // irse" (haber de + infinitive, had to) agrees with its subject.
    const singular = PLURAL_HABER[token.lower];
    if (singular && at.next() === "habido" && at.next(2) !== "de") {
      const span = {
        ...token,
        end: tokens[i + 1].end,
        text: ctx.text.slice(token.start, tokens[i + 1].end),
      };
      const finding = replaceToken(
        ctx,
        span,
        [`${singular} habido`],
        RULE,
        "review_msg_spanish_confusion",
      );
      if (finding) findings.push(finding);
      continue;
    }
    // "el menos tres": "al menos".
    if (
      token.lower === "el" &&
      !/^(?:en|a|de|del|hasta|desde|entre|está|es)$/u.test(at.prev()) &&
      at.next() === "menos" &&
      isNumber(tokens[i + 2]) &&
      !tokens[i + 2].broken
    ) {
      const finding = replaceToken(
        ctx,
        token,
        ["al"],
        RULE,
        "review_msg_spanish_confusion",
        tokens[i + 1],
      );
      if (finding) findings.push(finding);
      continue;
    }
    const haber = aVer(tokens, i);
    if (haber) {
      const span = { ...token, end: haber.end, text: ctx.text.slice(token.start, haber.end) };
      const finding = replaceToken(
        ctx,
        span,
        [haber.fix],
        RULE,
        "review_msg_spanish_confusion",
        tokens[i + 2],
      );
      if (finding) findings.push(finding);
      continue;
    }
    const check = CHECKS[token.lower];
    const fixes = check?.(at);
    if (!fixes) continue;
    const finding = replaceToken(
      ctx,
      token,
      fixes,
      RULE,
      "review_msg_spanish_confusion",
      tokens[i + 1],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

// "rebeló que" / "revelarse contra": reveal versus rebel, by the word after.
function rebelReveal(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const m = /^(re)(b|v)(el\p{L}*)$/u.exec(token.lower);
    if (
      !m ||
      !/^el(?:o|a|as|amos|an|é|ó|aron|ar|arse|ado|ada|ados|adas|ando|aba|aban)$/u.test(m[3])
    )
      continue;
    const next = at.next();
    // "el misterio rebelado por el detective": "rebelarse" has no passive; "revelar" does.
    const passive = m[2] === "b" && /^el(?:ado|ada|ados|adas)$/u.test(m[3]) && next === "por";
    const fix = passive
      ? `rev${m[3]}`
      : m[2] === "v" && next === "contra"
        ? `reb${m[3]}`
        : m[2] === "b" &&
            (next === "que" ||
              (DETERMINERS.has(next) && !CLITICS.has(at.prev()) && !m[3].endsWith("se")))
          ? `rev${m[3]}`
          : null;
    if (!fix) continue;
    const finding = replaceToken(
      ctx,
      token,
      [fix],
      RULE,
      "review_msg_spanish_confusion",
      tokens[i + 1],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

/**
 * "y les medidas", "os interesados" -> "las", "los": "les" and "os" are only clitics, and no
 * clitic goes before a plural noun or participle that is no verb form.
 */
function cliticArticle(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    if (!/^(?:les|os|Les|Os)$/u.test(token.text) || tokens[i + 1].broken) continue;
    const next = tokens[i + 1].lower;
    if (!/^\p{Ll}+$/u.test(tokens[i + 1].text) || ctx.dictionary.has(next)) continue;
    const noun = readNoun(next);
    if (!noun?.plural || finiteVerb(next) || secondPersonVerb(next) || isGerund(next)) continue;
    const forms = noun.gender ? [noun.gender === "f" ? "las" : "los"] : ["los", "las"];
    const finding = replaceToken(
      ctx,
      token,
      forms.map((form) =>
        /^\p{Lu}/u.test(token.text) ? `${form[0].toUpperCase()}${form.slice(1)}` : form,
      ),
      RULE,
      "review_msg_spanish_confusion",
      tokens[i + 1],
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [RULE],
    detect: (ctx) => [...confusions(ctx), ...rebelReveal(ctx), ...cliticArticle(ctx)],
  },
];
