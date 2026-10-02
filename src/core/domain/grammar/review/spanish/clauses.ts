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
import { finiteVerb, isGerund, isNoun, isVerb, participle, subjunctiveLike } from "./lexicon";

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
  // "para que nadie", "para que todo": the verb is further on.
  if (isNoun(verb) || participle(verb)) return null;
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
  const ends = isBoundary(tokens[i + 2]) && tokens[i + 2]?.text !== ",";
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

type Frame = (ctx: DetectContext, tokens: Token[], i: number) => RawFinding | null;

function scan(...frames: Frame[]) {
  return (ctx: DetectContext): RawFinding[] => {
    if (ctx.lang.slice(0, 2) !== "es") return [];
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
  { rules: ["spanishAccents"], detect: scan(paraQue) },
  { rules: ["spanishConfusions"], detect: scan(separatedEnclitic, aPunto) },
  { rules: ["stylePhrasing"], detect: scan(agoBack) },
  { rules: ["spanishAgreement"], detect: scan(impersonalHaber) },
];
