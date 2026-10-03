import { namedExampleBefore } from "./exampleCues";
import { POLISH_SPLIT_WORDS } from "./polish";
import { SPACE, WORD_START as EDGE_BEFORE, isLang } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import { carryCase } from "../implementations/helpers/GenericRuleShared";

/**
 * Review-only extensions of English rules to the other supported languages.
 * Each is a bounded word table; a form that also reads correctly somewhere is
 * left out, and every finding is individual-only.
 */

const EDGE_AFTER = "(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]|\\.[\\p{L}\\p{N}])";

function wordTable(entries: Record<string, string>): { regex: RegExp; map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    regex: new RegExp(`${EDGE_BEFORE}(?:${[...map.keys()].join("|")})${EDGE_AFTER}`, "giu"),
    map,
  };
}

function* ownedWords(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = ctx.from;
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    yield m;
  }
}

// ------------------------------------------------------------ doubled degree

interface DegreeTable {
  marker: string;
  words: string;
  /** A negation in the clause before: "ne … plus meilleur" is "no longer better". */
  negation?: RegExp;
  regex?: RegExp;
  /** Words right before the marker that make it another phrase ("de plus", "en plus"). */
  blockedBefore?: RegExp;
}

const DEGREE: Record<string, DegreeTable> = {
  fr: {
    marker: "plus",
    words: "meilleure?s?|pires?",
    negation: /(?<![\p{L}])(?:ne(?![\p{L}])|n['’])[^.!?;:\n]{0,40}$/iu,
    blockedBefore: /(?<![\p{L}])(?:de|en)[ \t ]+$/iu,
  },
  // "cuanto más mejor", "quanto mais melhor": "the more the better".
  es: {
    marker: "más",
    words: "mejor(?:es)?|peor(?:es)?",
    blockedBefore: /(?<![\p{L}])cu[aá]nto[ \t\u00a0]+$/iu,
  },
  pt: {
    marker: "mais",
    words: "melhor(?:es)?|pior(?:es)?",
    negation: /(?<![\p{L}])(?:não|nunca|jamais)(?![\p{L}])[^.!?;:\n]{0,40}$/iu,
    blockedBefore: /(?<![\p{L}])quanto[ \t\u00a0]+$/iu,
  },
  pl: {
    marker: "bardziej",
    // "tym bardziej" is "all the more": "tym bardziej lepiej" doubles nothing.
    blockedBefore: /(?<![\p{L}])tym[ \t\u00a0]+$/iu,
    words:
      "lepsz(?:y|a|e|ego|ej|ym|ych|ymi|ą)|lepsi|lepiej|gorsz(?:y|a|e|ego|ej|ym|ych|ymi|ą)|gorsi|gorzej",
  },
  hr: {
    marker: "više",
    // "gori" (burns), "gora" (mountain) and "gore" (up) are other words.
    words: "bolj(?:i|a|eg|em|oj|ih|im|u)",
    negation:
      /(?<![\p{L}])(?:ne|ni|nije|nisu|nisam|nisi|nismo|niste|nikad)(?![\p{L}])[^.!?;:\n]{0,40}$/iu,
  },
  sv: { marker: "mera?", words: "bättre|sämre" },
  // Any synthetic comparative (-τερος, accent before the suffix: "ισχυρότερα",
  // "ανώτερη"); ordinals and "neutral", "later" only look like one.
  el: {
    marker: "πιο",
    words:
      "(?!ουδέτερ|δεύτερ|ύστερ|πρότερ|έτερ|αμφότερ)\\p{L}*[άέήίόύώ]\\p{L}*τερ(?:ος|η|ο|οι|ες|α|ου|ης|ων|ους)",
  },
};
for (const table of Object.values(DEGREE)) {
  table.regex = new RegExp(
    `${EDGE_BEFORE}(?<target>(?<marker>${table.marker})${SPACE}(?<word>${table.words}))${EDGE_AFTER}`,
    "giu",
  );
}

/** "plus meilleur", "más mejor", "bardziej lepszy", "πιο καλύτερος": the word is already comparative. */
export function doubledDegreeByLanguage(ctx: DetectContext): RawFinding[] {
  const table = DEGREE[ctx.lang.slice(0, 2)];
  if (!table) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedWords(ctx, table.regex!)) {
    const start = m.index;
    const end = start + m[0].length;
    const { marker, word } = m.groups!;
    const before = ctx.text.slice(Math.max(0, start - 64), start);
    if (table.negation?.test(before) || table.blockedBefore?.test(before)) continue;
    if (namedExampleBefore(ctx.text, start)) continue;
    if (ctx.dictionary.has(marker.toLowerCase()) || ctx.dictionary.has(word.toLowerCase()))
      continue;
    findings.push({
      ruleId: "englishDoubledDegree",
      messageKey: "review_msg_doubled_degree",
      range: { start, end },
      alternatives: [carryCase(marker, word)],
      context: { start: Math.max(0, start - 64), end },
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}

// --------------------------------------------------------------- split words

// Closed spellings that are always two words. Left out because the joined form
// is a real word too: fr "entrain", es "entorno"/"sobretodo"/"talvez"/"osea"
// (ósea, typed without its accent), pt
// "agente", pl "niema", hr "dali"/"nemam"/"neću", sv "hursomhelst".
const SPLIT_WORDS: Record<string, Record<string, string>> = {
  de: {
    garnicht: "gar nicht",
    garnichts: "gar nichts",
    garkein: "gar kein",
    garkeine: "gar keine",
    garkeinen: "gar keinen",
    garkeinem: "gar keinem",
    garkeiner: "gar keiner",
    vorallem: "vor allem",
    aufjedenfall: "auf jeden Fall",
    desweiteren: "des Weiteren",
  },
  fr: {
    parcontre: "par contre",
    biensûr: "bien sûr",
    biensur: "bien sûr",
    tanpis: "tant pis",
    toutdesuite: "tout de suite",
    parceque: "parce que",
    desfois: "des fois",
  },
  es: {
    aveces: "a veces",
    enserio: "en serio",
    porfavor: "por favor",
    apesar: "a pesar",
    sinembargo: "sin embargo",
    almenos: "al menos",
    deacuerdo: "de acuerdo",
  },
  pt: {
    derrepente: "de repente",
    concerteza: "com certeza",
    apartir: "a partir",
    porisso: "por isso",
    denovo: "de novo",
    emcima: "em cima",
    atoa: "à toa",
    porfavor: "por favor",
  },
  pl: {
    napewno: "na pewno",
    wogóle: "w ogóle",
    narazie: "na razie",
    poprostu: "po prostu",
    niewiem: "nie wiem",
    niemam: "nie mam",
    conajmniej: "co najmniej",
    wkońcu: "w końcu",
    naprzykład: "na przykład",
    przedewszystkim: "przede wszystkim",
    odrazu: "od razu",
    niemożna: "nie można",
    ...POLISH_SPLIT_WORDS,
  },
  sv: {
    iallafall: "i alla fall",
    iallfall: "i alla fall",
    förmycket: "för mycket",
    tillsist: "till sist",
    iochmed: "i och med",
    tillochmed: "till och med",
    förövrigt: "för övrigt",
  },
  hr: {
    nemogu: "ne mogu",
    nemožeš: "ne možeš",
    nemože: "ne može",
    nemožemo: "ne možemo",
    nemožete: "ne možete",
    neznam: "ne znam",
    neznaš: "ne znaš",
    nezna: "ne zna",
    neznamo: "ne znamo",
    neznate: "ne znate",
    nebi: "ne bi",
    nebih: "ne bih",
    nebismo: "ne bismo",
    nebiste: "ne biste",
  },
};
// Joined forms that are also a transitive verb when an object follows: "o rebocador atoa o barco"
// (atoar, to tow). After "ficar", "andar", "estar" or "viver" it is still the adverb "à toa"
// ("ficou atoa o dia todo").
const SPLIT_VERB_OBJECT: Record<string, { object: RegExp; adverbAfter: RegExp }> = {
  atoa: {
    object:
      /^[ \t\u00a0]+(?:[oa]s?|uns?|umas?|seus?|suas?|ess[ea]s?|est[ea]s?|aquel[ea]s?|nossos?|nossas?)(?![\p{L}])/iu,
    adverbAfter: /(?<![\p{L}])(?:fic|and|est|viv)\p{L}*[ \t\u00a0]+$/iu,
  },
};
const SPLIT_TABLES = new Map(
  Object.entries(SPLIT_WORDS).map(([lang, entries]) => [lang, wordTable(entries)]),
);

/** Two words written as one ("napewno", "aveces"): the "alot" rule for other languages. */
export function splitWords(ctx: DetectContext): RawFinding[] {
  const table = SPLIT_TABLES.get(ctx.lang.slice(0, 2));
  if (!table) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedWords(ctx, table.regex)) {
    const typed = m[0];
    const lower = typed.toLowerCase();
    if (ctx.dictionary.has(lower) || namedExampleBefore(ctx.text, m.index)) continue;
    const end = m.index + typed.length;
    const verb = SPLIT_VERB_OBJECT[lower];
    if (
      verb?.object.test(ctx.text.slice(end, end + 16)) &&
      !verb.adverbAfter.test(ctx.text.slice(Math.max(0, m.index - 24), m.index))
    )
      continue;
    // "te aveces" is the verb "avezarse".
    if (
      lower === "aveces" &&
      /(?:^|\s)(?:me|te|se|nos|os)\s+$/iu.test(ctx.text.slice(Math.max(0, m.index - 6), m.index))
    )
      continue;
    const replacement = table.map.get(lower)!;
    findings.push({
      ruleId: "englishAlotCorrection",
      messageKey: "review_msg_split_words",
      range: { start: m.index, end: m.index + typed.length },
      alternatives: [carryCase(typed, replacement)],
      dictionaryWord: typed,
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}

// ----------------------------------------------------------- French elision

// Forms that are no French word without their apostrophe. "nest", "sil",
// "quelle" and "jen" are words (or English words) and stay out.
const FRENCH_ELISIONS = wordTable({
  cest: "c'est",
  cétait: "c'était",
  jai: "j'ai",
  jaime: "j'aime",
  jétais: "j'étais",
  jespère: "j'espère",
  quil: "qu'il",
  quils: "qu'ils",
  quon: "qu'on",
  aujourdhui: "aujourd'hui",
  daccord: "d'accord",
  dailleurs: "d'ailleurs",
  lorsquil: "lorsqu'il",
  puisquil: "puisqu'il",
});

/** The text's own apostrophe style near `index`: curly only where no straight one is used. */
function apostropheAt(ctx: DetectContext, index: number): string {
  const nearby = ctx.text.slice(Math.max(0, index - 400), index + 400);
  return nearby.includes("’") && !nearby.includes("'") ? "’" : "'";
}

/** "cest", "jai", "aujourdhui": a French elision missing its apostrophe. */
export function frenchElisions(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedWords(ctx, FRENCH_ELISIONS.regex)) {
    const typed = m[0];
    const lower = typed.toLowerCase();
    if (ctx.dictionary.has(lower) || namedExampleBefore(ctx.text, m.index)) continue;
    // "15:00 CEST": only the capital form is the time zone. A lowercase
    // "cest" after a time ("À 20:40, cest terminé.") is still "c'est".
    if (typed === "CEST") continue;
    const replacement = FRENCH_ELISIONS.map.get(lower)!.replaceAll("'", apostropheAt(ctx, m.index));
    findings.push({
      ruleId: "englishContractionNormalization",
      messageKey: "review_msg_contraction",
      range: { start: m.index, end: m.index + typed.length },
      alternatives: [carryCase(typed, replacement)],
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}

// ------------------------------------------------- apostrophe look-alikes

// An acute accent or a backtick typed for an apostrophe ("don´t", "c´est",
// "geht´s", "d´água"): a spacing accent is never a letter of these languages.
// Group 1 is the mark. English also slips to ";" on the neighbouring key.
const MARKED_APOSTROPHE: Record<string, RegExp> = {
  en: /(?<![\p{L}\p{M}\p{N}_])(?<base>\p{L}+)([´`;])(?<end>t|s|m|d|ll|re|ve)(?![\p{L}\p{M}\p{N}_])/giu,
  fr: /(?<![\p{L}\p{M}\p{N}_])(?:c|d|j|l|m|n|s|t|qu|jusqu|lorsqu|puisqu|quoiqu|presqu)([´`])(?=[aeiouyhàâæéèêëîïôœùûü])/giu,
  de: /(?<=\p{L})([´`])s(?![\p{L}\p{M}\p{N}_])/gu,
  pt: /(?<![\p{L}\p{M}\p{N}_])d([´`])(?=[aeiouáâãàéêíóôõú])/giu,
};
// "don;t" is only read as a contraction with a base that takes that ending.
const SEMICOLON_BASES: Record<string, RegExp> = {
  t: /^(?:don|can|won|isn|aren|wasn|weren|didn|doesn|haven|hasn|hadn|shouldn|couldn|wouldn|mustn|needn|ain)$/i,
  m: /^i$/i,
  s: /^(?:it|let|that|there|here|he|she|what|who|where|how)$/i,
  d: /^(?:i|you|we|they|he|she|it|that|there|who)$/i,
  ll: /^(?:i|you|we|they|he|she|it|that|there|who)$/i,
  re: /^(?:you|we|they|there|who|what)$/i,
  ve: /^(?:i|you|we|they|who|could|would|should|might|must)$/i,
};

/** "don´t", "I;m", "c´est", "gibt´s": an apostrophe typed as another mark. */
export function markedApostrophes(ctx: DetectContext): RawFinding[] {
  const lang = ctx.lang.slice(0, 2);
  const regex = MARKED_APOSTROPHE[lang];
  if (!regex) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedWords(ctx, regex)) {
    const mark = m[lang === "en" ? 2 : 1];
    const start = m.index + m[0].indexOf(mark, m.groups?.base.length ?? 0);
    if (namedExampleBefore(ctx.text, start)) continue;
    if (mark === ";" && !SEMICOLON_BASES[m.groups!.end.toLowerCase()].test(m.groups!.base)) {
      continue;
    }
    // "`code`s": a backtick pair on the line is Markdown code, not an apostrophe. Backticks
    // inside words only ("Won`t … You`re") open no code span.
    if (mark === "`") {
      // Read the line within a window, so a long line of marks stays linear.
      const from = Math.max(0, start - 256);
      const around = ctx.text.slice(from, start + 256);
      const at = start - from;
      const lineEnd = around.indexOf("\n", at);
      const line = around.slice(
        around.lastIndexOf("\n", at) + 1,
        lineEnd < 0 ? undefined : lineEnd,
      );
      if (line.split("`").length > 2 && /(?<!\p{L})`|`(?!\p{L})/u.test(line)) continue;
    }
    findings.push({
      ruleId: "englishContractionNormalization",
      messageKey: "review_msg_apostrophe_mark",
      range: { start, end: start + 1 },
      alternatives: [apostropheAt(ctx, start)],
      context: { start: m.index, end: Math.min(ctx.text.length, m.index + m[0].length + 1) },
      // Only the English accent is certain; a semicolon or backtick may be meant.
      bulkBlock: lang === "en" && mark === "´" ? undefined : "context-dependent",
    });
  }
  return findings;
}

// ------------------------------------------------- German days and months

// Nouns, so always capitalized; the adverbs ("montags") and compounds stay as
// typed. "august" is also an adjective: only after a date word.
const GERMAN_NOUNS = new RegExp(
  `${EDGE_BEFORE}(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|januar|jänner|februar|märz|april|mai|juni|juli|september|oktober|november|dezember|weihnachten|ostern|pfingsten|august)${EDGE_AFTER}`,
  "gu",
);
const AUGUST_CONTEXT =
  /(?:(?<![\p{L}])(?:im|anfang|ende|mitte|seit|bis|ab|vom|zum|nächsten|letzten|diesen|kommenden)|\d{1,2}\.)[ \t ]+$/iu;

/** "am montag", "im märz": German days, months and holidays are nouns. */
export function germanNounCapitals(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "de")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedWords(ctx, GERMAN_NOUNS)) {
    const typed = m[0];
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (typed === "august" && !AUGUST_CONTEXT.test(before)) continue;
    if (ctx.dictionary.has(typed) || namedExampleBefore(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "englishProperNounCapitalization",
      messageKey: "review_msg_german_noun_capital",
      range: { start: m.index, end: m.index + 1 },
      alternatives: [typed[0].toUpperCase()],
      context: { start: Math.max(0, m.index - 24), end: m.index + typed.length },
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}
