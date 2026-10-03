import {
  DIGIT as AR_DIGIT,
  MONTH_NUMBER as AR_MONTHS,
  number as arabicNumber,
} from "./arabic/dates";
import { MONTHS as FR_MONTHS } from "./french/dates";
import { MONTHS as DE_MONTHS } from "./german/dates";
import { frameMatches } from "./phraseTemplates";
import { GENITIVE as PL_MONTHS } from "./polish/dates";
import { MONTHS as PT_MONTHS } from "./portuguese/dates";
import { dateSide, dayCount, recentPast } from "./reviewClock";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "./reviewDetectors";
import { MONTH_NAMES as ES_MONTH_NAMES, monthNumber as esMonth } from "./spanish/typography";

/*
 * A verb tense that the date next to it rules out, in German, French, Spanish, Portuguese,
 * Polish and Arabic: a past verb on a date that has not come yet ("Wir haben am 7.8.2031 den
 * Kunden angerufen"), and a future verb on a date of the last three years. The Review clock
 * (reviewClock.ts) gives today's date. English has its own frames in english/tenseSlots.ts.
 *
 * Only a date with a four-digit year after the preposition a date takes is read, and only the
 * words of the same clause count: at most 6 before the date and 10 after it. Plans, reports
 * and conditions are other clauses, and verbs of planning ("planned for", "postponed to")
 * name the date of the plan, so they never count. A finding only warns: the date or the
 * tense can be the slip.
 */

type Tense = "past" | "future" | null;
interface Clause {
  /** Words of the clause before the date phrase, nearest last (at most 6). */
  before: string[];
  /** Words of the clause after the date (at most 10). */
  after: string[];
  /** True when `after` reaches the end of the clause. */
  closed: boolean;
  /** The word that opens the clause, lowercased, if a boundary word does. */
  opener?: string;
}
interface Language {
  /** Date frames: groups `date`, `day`, `year`, and `month` (digits) or `name`. */
  dates: string[];
  month(name: string): number;
  /** Words that start another clause. */
  boundary: ReadonlySet<string>;
  /** Words that open a condition or a question: the clause asserts nothing. */
  conditional: ReadonlySet<string>;
  tense(clause: Clause): Tense;
  number?: (digits: string) => number;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/));
const lower = (list: readonly string[]) => list.map((word) => word.toLowerCase());
const S = "[ \\t\\u00a0]+";
const NOT_AFTER = "(?![\\p{L}\\p{N}])";
/** The day, a dotted, slashed or dashed month and the year: "7/8/2031", "07.08.2031". */
const NUMERIC = "(?<day>\\d{1,2})(?<sep>[/.-])(?<month>\\d{1,2})\\k<sep>(?<year>\\d{4})";
/** One frame per date shape: the preposition, the date (`date`), an optional suffix. */
const frames = (prefix: string, dates: string[], suffix = "") =>
  dates.map((date) => `${prefix}(?<date>${date})${suffix}${NOT_AFTER}`);
/** True when a word in `list` comes right before a word in `next` (with up to `gap` between). */
function pairAt(
  list: readonly string[],
  first: (w: string) => boolean,
  next: (w: string) => boolean,
  gap = 0,
): number {
  for (let i = 0; i < list.length; i++)
    if (first(list[i]))
      for (let j = i + 1; j <= i + 1 + gap && j < list.length; j++) if (next(list[j])) return i;
  return -1;
}

// ---------------------------------------------------------------- German

const DE_HABEN = words("habe hast hat haben habt hatte hattest hatten hattet");
const DE_SEIN = words("bin bist ist sind seid war warst waren wart");
const DE_WERDEN = words("werde wirst wird werden werdet");
const DE_PRONOUNS = words("ich du er sie wir ihr");
// Simple past forms that no other form shares, and their plural.
const DE_PAST = new Set(
  (
    "war ging kam sah flog fuhr schwamm lief gab nahm fand blieb schrieb sprach traf aß trank " +
    "saß stand lag rief hielt ließ fiel zog bat schlief starb sang sprang gewann begann verlor " +
    "half warf wurde brachte dachte kannte nannte rannte wusste ritt stieg fing bekam verließ erhielt"
  )
    .split(" ")
    .flatMap((w) => [w, w.endsWith("e") ? `${w}n` : `${w}en`])
    .concat("warst", "wart"),
);
const DE_PARTICIPLE =
  /^(?:(?:ab|an|auf|aus|bei|ein|fest|fort|heim|her|hin|los|mit|nach|statt|teil|vor|weg|weiter|zu|zurück|zusammen|um|durch|über)?ge\p{Ll}{2,}(?:t|en)|(?:be|emp|ent|er|miss|ver|zer)\p{Ll}{2,}t|\p{Ll}{3,}iert)$/u;
const DE_NOT_PARTICIPLE = words("gegen gesamt insgesamt gerecht");
// "sein" takes the perfect of motion and change: "sind geflogen", but "ist geschlossen" is a state.
const DE_SEIN_PARTICIPLE =
  /(?:gangen|fahren|flogen|kommen|laufen|schwommen|gereist|wesen|blieben|storben|fallen|zogen|sprungen|wandert|rannt|stiegen|folgt|passiert|schehen|wachsen|worden|ritten|segelt|wacht|kehrt)$/u;
// Planning verbs name the date of the plan; "geöffnet", "geschlossen" are opening hours.
const DE_ARRANGING =
  /(?:plant|bucht|reserviert|bestellt|vereinbart|schoben|verlegt|gesetzt|festgelegt|beworben|gemeldet|terminiert|kündigt|geladen|vorgesehen|bestätigt|gesagt|organisiert|getragen|notiert|gemerkt|gelegt|beantragt|gefragt|genehmigt|versprochen|geboten|gewünscht|geöffnet|geschlossen|fixiert|datiert|befristet|begrenzt)$/u;

function germanTense({ before, after, closed }: Clause): Tense {
  const all = lower([...before, ...after]);
  const last = closed ? after.at(-1) : undefined;
  if (all.some((w) => w.startsWith("würd"))) return null;
  if (all.some((w) => DE_WERDEN.has(w))) {
    // "wird … reisen"; "wird … gewesen sein" is a guess about the past.
    if (!last || !/^\p{Ll}+(?:en|ern|eln)$/u.test(last) || DE_PARTICIPLE.test(last)) return null;
    const prev = after.at(-2);
    if (/^(?:sein|haben)$/.test(last) && prev && DE_PARTICIPLE.test(prev)) return null;
    return "future";
  }
  // "Ich war am … schon ausgebucht": a planning verb names the date of the plan.
  if (last && DE_ARRANGING.test(last)) return null;
  if (last && DE_PARTICIPLE.test(last) && !DE_NOT_PARTICIPLE.has(last)) {
    if (all.some((w) => DE_HABEN.has(w))) return "past";
    if (all.some((w) => DE_SEIN.has(w)) && DE_SEIN_PARTICIPLE.test(last)) return "past";
  }
  // A simple past next to its pronoun: "ich war am …", "am … schwamm ich".
  const b = lower(before);
  if (b.length >= 2 && DE_PRONOUNS.has(b.at(-2)!) && DE_PAST.has(b.at(-1)!)) return "past";
  const a = lower(after).slice(0, 6);
  return pairAt(
    a,
    (w) => DE_PAST.has(w),
    (w) => DE_PRONOUNS.has(w),
  ) >= 0
    ? "past"
    : null;
}

const GERMAN: Language = {
  dates: frames(
    `am${S}(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag),?${S}(?:den${S})?)?`,
    [
      `(?<day>\\d{1,2})\\.(?:[ \\t\\u00a0]?(?<month>\\d{1,2})\\.[ \\t\\u00a0]?|[ \\t\\u00a0]*(?<name>${Object.keys(DE_MONTHS).join("|")})\\.?${S})(?<year>\\d{4})`,
    ],
  ),
  month: (name) => DE_MONTHS[name.toLowerCase()] ?? 0,
  boundary: words(
    "dass ob wenn falls weil als bevor nachdem sobald bis und aber oder sondern denn damit obwohl während",
  ),
  conditional: words("wenn falls ob"),
  tense: germanTense,
};

// ---------------------------------------------------------------- French

const FR_AVOIR = words("ai as a avons avez ont avais avait avions aviez avaient");
const FR_ETRE = words("suis es est sommes êtes sont étais était étions étiez étaient");
const FR_ADVERBS = words(
  "pas jamais déjà bien tout tous enfin aussi encore beaucoup rien plus toujours vraiment finalement",
);
const FR_PARTICIPLE =
  /^\p{Ll}{2,}(?:é|ée|és|ées|i|ie|is|ies|it|ite|u|ue|us|ues|ert|erte|ait|aite|eint|ainte)$/u;
const FR_NOT_PARTICIPLE = words(
  "plus tous nous vous sous jus dessus ainsi aussi ici parmi lui qui si ni tu du lit bien tout lundi mardi mercredi jeudi vendredi samedi midi aujourd",
);
const FR_MOTION = words(
  "allé venu parti arrivé rentré revenu sorti entré monté descendu tombé né mort resté retourné devenu parvenu",
);
const FR_ARRANGING =
  /^(?:prévu|planifié|fixé|programmé|réservé|commandé|reporté|décalé|déplacé|annoncé|confirmé|convenu|organisé|inscrit|demandé|proposé|promis|annulé|invité|noté|calé|repoussé|avancé|retenu|bloqué|posé|pris)(?:e|s|es)?$/u;
const FR_SUBJECTS = words("je j tu il elle on nous vous ils elles");
const FR_OBJECTS = words("ne n y en le la les l lui leur me m te t se s nous vous");
const FR_FUTURE =
  /^(?:\p{Ll}+(?:er|ir|dr|ttr|aîtr)|ser|aur|fer|ir|pourr|verr|devr|saur|courr|mourr|enverr|recevr|vivr|suivr|écrir|lir|dir|boir|croir|plair)(?:ai|as|a|ons|ez|ont)$/u;
const FR_ALLER = words("vais vas va allons allez vont");
const FR_INFINITIVE = /^\p{Ll}{2,}(?:er|ir|re|oir)$/u;
/** "allées" -> "allé": a participle without its agreement ending. */
const frStem = (w: string) => w.replace(/(?<=[éiu])(?:e|s|es)$/u, "");

function frenchTense({ before, after }: Clause): Tense {
  for (const list of [lower(before), lower(after)]) {
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      // The past: "avons visité", "sommes partis", "avaient déjà signé"; "il y a" is "there is".
      if ((FR_AVOIR.has(w) && list[i - 1] !== "y") || FR_ETRE.has(w)) {
        let j = i + 1;
        while (j < list.length && FR_ADVERBS.has(list[j])) j++;
        const part = list[j];
        if (!part || !FR_PARTICIPLE.test(part) || FR_NOT_PARTICIPLE.has(part)) continue;
        if (FR_ARRANGING.test(part)) return null;
        if (FR_AVOIR.has(w) || FR_MOTION.has(frStem(part))) return "past";
      }
      // The future: "nous viendrons", "il ne viendra pas", "nous allons signer".
      if (FR_SUBJECTS.has(w)) {
        let j = i + 1;
        while (j < list.length && j <= i + 3 && FR_OBJECTS.has(list[j])) j++;
        const verb = list[j];
        if (verb && FR_FUTURE.test(verb)) {
          // "aura signé": the future perfect guesses about the past.
          const next = list[j + 1];
          if (/^(?:aur|ser)/.test(verb) && next && FR_PARTICIPLE.test(next)) return null;
          return "future";
        }
        if (verb && FR_ALLER.has(verb) && FR_INFINITIVE.test(list[j + 1] ?? "")) return "future";
      }
    }
  }
  return null;
}

const FRENCH: Language = {
  dates: frames(`le${S}(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)${S})?`, [
    `(?<day>\\d{1,2})(?:er)?${S}(?<name>${FR_MONTHS.flat().join("|")})${S}(?<year>\\d{4})`,
    NUMERIC,
  ]),
  month: (name) => FR_MONTHS.findIndex((names) => names.includes(name.toLowerCase())) + 1,
  boundary: words("que qu si quand lorsque lorsqu et mais ou car donc puis dont où qui comme"),
  conditional: words("si"),
  tense: frenchTense,
};

// ---------------------------------------------------------------- Spanish

const ES_HABER = words("he has ha hemos habéis han había habías habíamos habíais habían");
const ES_PARTICIPLE =
  /^(?:\p{Ll}{2,}(?:ado|ada|ados|adas|ido|ida|idos|idas)|visto|hecho|dicho|puesto|escrito|abierto|vuelto|roto|muerto|cubierto|resuelto|devuelto|descubierto|impreso|satisfecho)$/u;
const ES_PAST_WORDS = words(
  "fui fue fuimos fuiste fueron estuve estuvo estuvimos estuvieron tuve tuvo tuvimos tuvieron hice hizo hicimos hicieron dije dijo dijimos dijeron vinimos vinieron pude pudo pudimos pudieron puse puso pusimos pusieron quise quiso supe supo traje trajo trajimos era eras éramos eran iba ibas íbamos iban vio vimos vieron dio dimos dieron",
);
const ES_PAST =
  /^\p{Ll}{3,}(?:é|ó|aste|iste|aron|ieron|yeron|asteis|isteis|aba|abas|ábamos|abais|aban|íamos|íais|ían)$/u;
const ES_NOT_PAST = words(
  "esté dé sé fe café bebé josé comité puré chalé té qué porqué dominó buró rococó mamá papá",
);
const ES_ARRANGING =
  /^(?:re)?(?:program|previst|prev|plane|reserv|fij|pospu|aplaz|convoc|anunci|confirm|acord|organiz|cancel|ped|pid|solicit|promet|agend|cit|inscri|qued|traslad|cambi|mov|apunt)/u;
const ES_FUTURE = /^(?:\p{Ll}{2,}(?:ré|rás|rá|réis|rán)|\p{Ll}+[ai]remos)$/u;
const ES_IR = words("voy vas va vamos vais van");
const ES_INFINITIVE = /^\p{Ll}{2,}(?:ar|er|ir)$/u;
/** A conditional ("visitaríamos") is no past. */
const CONDITIONAL = /[aeií]r(?:íamos|íais|ían|íeis|iam)$/u;

function spanishTense({ before, after }: Clause): Tense {
  for (const list of [lower(before), lower(after)]) {
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const next = list[i + 1] ?? "";
      if (
        (ES_FUTURE.test(w) && !/^(?:atrás|detrás)$/.test(w)) ||
        (ES_IR.has(w) && next === "a" && ES_INFINITIVE.test(list[i + 2] ?? ""))
      )
        return "future";
      if (ES_HABER.has(w)) {
        const part = next === "ya" ? list[i + 2] : next;
        if (part && ES_PARTICIPLE.test(part)) return ES_ARRANGING.test(part) ? null : "past";
        continue;
      }
      const past =
        ES_PAST_WORDS.has(w) || (ES_PAST.test(w) && !ES_NOT_PAST.has(w) && !CONDITIONAL.test(w));
      if (!past) continue;
      // "íbamos a firmar", "queríamos firmar": a plan, not the past.
      if (ES_INFINITIVE.test(next) || (next === "a" && ES_INFINITIVE.test(list[i + 2] ?? "")))
        continue;
      return ES_ARRANGING.test(w) ? null : "past";
    }
  }
  return null;
}

const SPANISH: Language = {
  dates: frames(
    `el${S}(?:día${S})?(?:(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo),?${S})?`,
    [
      `(?<day>\\d{1,2})${S}de${S}(?<name>${ES_MONTH_NAMES})${S}(?:de|del)${S}(?<year>\\d{4})`,
      NUMERIC,
    ],
  ),
  month: esMonth,
  boundary: words("que si cuando porque aunque y e pero o u ni mientras donde quien como"),
  conditional: words("si"),
  tense: spanishTense,
};

// ---------------------------------------------------------------- Portuguese

const PT_PAST_WORDS = words(
  "fui foi fomos foram foste estive esteve estivemos estiveram tive teve tivemos tiveram fiz fez fizemos fizeram disse dissemos disseram vi viu vimos viram pude pôde pudemos puderam era eras éramos eram vim veio viemos vieram quis quisemos soube trouxe pus pôs",
);
const PT_PAST =
  /^\p{Ll}{2,}(?:ei|ou|aste|este|iste|aram|eram|iram|ava|avas|ávamos|áveis|avam|íamos|íeis|iam)$/u;
const PT_NOT_PAST = words("sei lei rei grei sou estou vou dou");
const PT_PLUPERFECT = words("tinha tinhas tínhamos tinham havia havíamos haviam");
const PT_PARTICIPLE =
  /^(?:\p{Ll}{2,}(?:ado|ada|ados|adas|ido|ida|idos|idas)|visto|feito|dito|posto|escrito|aberto|vindo|ganho|gasto|pago|entregue|morto|coberto)$/u;
const PT_ARRANGING =
  /^(?:re|des)?(?:marc|agend|planej|plane|program|reserv|adi|confirm|anunci|combin|cancel|convid|promet|solicit|ped|previ|prev|fix|inscrev|inscri|transfer|mud)/u;
const PT_FUTURE = /^(?:\p{Ll}{2,}(?:rá|rás|rão)|\p{Ll}+[aei]rei|\p{Ll}+[ai]remos)$/u;
const PT_IR = words("vou vais vai vamos ides vão");
const PT_INFINITIVE = /^(?:\p{Ll}{2,}(?:ar|er|ir|or)|pôr)$/u;

function portugueseTense({ before, after }: Clause): Tense {
  for (const list of [lower(before), lower(after)]) {
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const next = list[i + 1] ?? "";
      if ((PT_FUTURE.test(w) && w !== "atrás") || (PT_IR.has(w) && PT_INFINITIVE.test(next)))
        return "future";
      if (PT_PLUPERFECT.has(w)) {
        if (PT_PARTICIPLE.test(next)) return PT_ARRANGING.test(next) ? null : "past";
        continue;
      }
      const past =
        PT_PAST_WORDS.has(w) || (PT_PAST.test(w) && !PT_NOT_PAST.has(w) && !CONDITIONAL.test(w));
      // "queríamos visitar", "íamos assinar": a plan; "estávamos a visitar" is the past.
      if (!past || PT_INFINITIVE.test(next)) continue;
      return PT_ARRANGING.test(w) ? null : "past";
    }
  }
  return null;
}

const PT_MONTH = `${PT_MONTHS.join("|")}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez`;
const PORTUGUESE: Language = {
  dates: frames(
    `(?:em|a|no${S}dia|dia)${S}(?:(?:(?:segunda|terça|quarta|quinta|sexta)(?:-feira)?|sábado|domingo),?${S})?`,
    [
      `(?<day>\\d{1,2})[º°]?${S}(?:de${S})?(?<name>${PT_MONTH})\\.?(?:${S}de|,)?${S}(?<year>\\d{4})`,
      `(?<name>${PT_MONTH})\\.?${S}(?<day>\\d{1,2}),?${S}(?<year>\\d{4})`,
      NUMERIC,
    ],
  ),
  month: (name) => {
    const lowered = name.toLowerCase();
    return PT_MONTHS.findIndex((month) => month.startsWith(lowered)) + 1;
  },
  boundary: words("que se quando porque embora e mas ou enquanto onde quem como"),
  conditional: words("se"),
  tense: portugueseTense,
};

// ---------------------------------------------------------------- Polish

const PL_FUTURE = words("będę będziesz będzie będziemy będziecie będą");
const PL_PAST_PERSON = /^\p{Ll}{2,}(?:łem|łam|łeś|łaś|liśmy|łyśmy|liście|łyście)$/u;
const PL_PAST = /^\p{Ll}{2,}(?:[aiyą]ł|[aiyę]ła|[aiyę]ło|[aiyę]li|[aiyę]ły)$/u;
const PL_NOT_PAST = words(
  "kanał upał zapał dział udział materiał przedział podział rozdział pył wał szał skała siła mogiła ciało mało działo chwili fali sali stali cały mały biały stały trwały doskonały dojrzały wspaniały okazały śmiały siły skały mogiły",
);
const PL_ARRANGING =
  /^(?:za)?(?:plan|rezerw|zarezerw|przełoż|przesun|umówi|umawia|ustal|zapisa|zaprosi|zamówi|ogłosi|potwierdzi|wyznaczy|zgłosi|zapowiedzi|odwoła|obieca|zaprogramowa|zaplanowa)/u;
const PL_INFINITIVE = /^\p{Ll}{2,}(?:ć|c)$/u;

function polishTense({ before, after }: Clause): Tense {
  const list = lower([...before, ...after]);
  if (list.some((w) => PL_FUTURE.has(w))) return "future";
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (!PL_PAST_PERSON.test(w) && (!PL_PAST.test(w) || PL_NOT_PAST.has(w))) continue;
    // "miało się odbyć", "chcieliśmy pojechać": a plan, not the past.
    const next = list[i + 1] === "się" ? list[i + 2] : list[i + 1];
    if (next && PL_INFINITIVE.test(next)) continue;
    return PL_ARRANGING.test(w) ? null : "past";
  }
  return null;
}

const POLISH: Language = {
  dates: frames(
    `(?<![\\p{L}\\p{N}.,/-])(?:(?:dnia|w${S}dniu)${S})?`,
    [
      `(?<day>\\d{1,2})${S}(?<name>${PL_MONTHS.join("|")})${S}(?<year>\\d{4})`,
      `(?<day>\\d{1,2})\\.(?<month>\\d{1,2})\\.(?<year>\\d{4})`,
    ],
    // "12 marca 2028 r.", "… 2028 roku"
    `(?:${S}r\\.|${S}roku)?`,
  ),
  month: (name) => PL_MONTHS.indexOf(name.toLowerCase()) + 1,
  boundary: words(
    "że czy jeśli jeżeli gdy gdyby kiedy bo ponieważ aby żeby i ale lub albo oraz a który która które którzy jak",
  ),
  conditional: words("jeśli jeżeli gdyby czy"),
  tense: polishTense,
};

// ---------------------------------------------------------------- Arabic

const AR_PAST = words("لقد كان كانت كنا كنت كانوا كنتم قمنا قمت قام قامت");
const AR_FUTURE = words("سوف لن");

function arabicTense({ before, after }: Clause): Tense {
  const list = [...before, ...after];
  if (list.some((w) => AR_FUTURE.has(w))) return "future";
  // "كان من المقرر": "was planned for", a plan.
  return list.some((w, i) => AR_PAST.has(w) && list[i + 1] !== "من") ? "past" : null;
}

const ARABIC: Language = {
  dates: frames(`(?:(?:في|يوم|بتاريخ)${S})?`, [
    `(?<day>${AR_DIGIT}{1,2})${S}(?<name>${[...AR_MONTHS.keys()].sort((a, b) => b.length - a.length).join("|")})${S}(?<year>${AR_DIGIT}{4})`,
  ]),
  month: (name) => AR_MONTHS.get(name) ?? 0,
  boundary: words("أن إن إذا لو عندما حتى لأن الذي التي الذين لكن ثم بينما"),
  conditional: words("إذا لو إن"),
  tense: arabicTense,
  number: arabicNumber,
};

const LANGUAGES: Readonly<Record<string, Language>> = {
  de: GERMAN,
  fr: FRENCH,
  es: SPANISH,
  pt: PORTUGUESE,
  pl: POLISH,
  ar: ARABIC,
};

// ---------------------------------------------------------------- shared

const BREAK = /[!?;()\n"“”«»„،؛؟]|[.:](?=\s|$)|,/gu;
const WORD = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*|\p{N}+(?:[.:]\p{N}+)*/gu;

/** The words of the clause around a date phrase at [start, end). */
function clauseAround(
  text: string,
  start: number,
  end: number,
  boundary: ReadonlySet<string>,
): Clause {
  let head = text.slice(Math.max(0, start - 160), start);
  let cut = 0;
  for (const m of head.matchAll(BREAK)) cut = m.index + m[0].length;
  head = head.slice(cut);
  let before: string[] = head.match(WORD) ?? [];
  const opens = before.map((w) => boundary.has(w.toLowerCase())).lastIndexOf(true);
  const opener = opens >= 0 ? before[opens].toLowerCase() : undefined;
  before = before.slice(opens + 1).slice(-6);
  // "Am 7.8.2031, …": a comma after a date that opens the sentence ends no clause.
  let tail = text.slice(end, end + 200);
  if (!before.length) tail = tail.replace(/^[ \t ]*,/, "");
  BREAK.lastIndex = 0;
  const stop = tail.search(BREAK);
  let closed = stop >= 0 || end + 200 >= text.length;
  let after: string[] = (stop >= 0 ? tail.slice(0, stop) : tail).match(WORD) ?? [];
  const ends = after.findIndex((w) => boundary.has(w.toLowerCase()));
  if (ends >= 0) [after, closed] = [after.slice(0, ends), true];
  if (after.length > 10) [after, closed] = [after.slice(0, 10), false];
  return { before, after, closed, opener };
}

/** "future", "past" (of the last three years) or null for every reading of the date. */
function side(lang: Language, g: Record<string, string | undefined>): Tense {
  const num = lang.number ?? Number;
  const [year, day, name] = [num(g.year!), num(g.day!), g.name];
  const month = name ? lang.month(name) : num(g.month!);
  // A slashed date can also be month first: "10/27/2031".
  const readings = [[year, month, day]];
  if (!name && g.sep === "/") readings.push([year, day, month]);
  const valid = readings.filter(([y, m, d]) => dayCount(y, m, d) !== null);
  if (!valid.length) return null;
  if (valid.every(([y, m, d]) => dateSide(y, m, d) === "future")) return "future";
  if (valid.every(([y, m, d]) => recentPast(y, m, d))) return "past";
  return null;
}

function dateTense(ctx: DetectContext): RawFinding[] {
  const lang = LANGUAGES[ctx.lang.slice(0, 2)];
  if (!lang) return [];
  const findings: RawFinding[] = [];
  for (const pattern of lang.dates)
    for (const m of frameMatches(ctx, pattern, "date")) {
      const dateSideNow = side(lang, m.groups!);
      if (!dateSideNow) continue;
      const [start, end] = m.indices!.groups!.date;
      const clause = clauseAround(ctx.text, m.index, m.index + m[0].length, lang.boundary);
      if (clause.opener && lang.conditional.has(clause.opener)) continue;
      const tense = lang.tense(clause);
      if (!tense || tense === dateSideNow) continue;
      findings.push({
        ruleId: "dateTenseConsistency",
        messageKey:
          dateSideNow === "future" ? "review_msg_future_date_past" : "review_msg_past_date_future",
        range: { start, end },
        alternatives: [],
        warningOnly: true,
      });
    }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["dateTenseConsistency"], detect: dateTense },
];
