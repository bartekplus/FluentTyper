import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { Around, CLITICS, isInfinitive, replaceToken, tokenize, words, type Token } from "./common";
import { HABER, isPerfectParticiple } from "./confusions";
import { genderedForm, isGerund, isNoun, isVerb, participle } from "./lexicon";

// Verb forms after an auxiliary ("han realizando" -> realizado, "ha ido aumentado" ->
// aumentando), the auxiliary "ha"/"he" written as the preposition "a" or the conjunction "e",
// and "de que" against the verbs that take or refuse it.

const RULE = "spanishConfusions" as const;

// "había llamadas": existential forms also stand before plural nouns.
const EXISTENTIAL = words("había hubo habrá haya hubiera hubiese habría haber habiendo");
const ESTAR = words("estoy estás está estamos estáis están estaba estabas estábamos estaban");
const PERFECT = words("he has ha hemos habéis han había habías habíamos habían");

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

// "huele a quemado", "sabe a podrido": a smell or taste, not the auxiliary.
const SENSES = /^(?:huel\p{L}*|ol\p{L}*|sab\p{L}*|sup\p{L}*)$/u;

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
    const fix = perfectOf(word, EXISTENTIAL.has(prev) || isNoun(next));
    if (fix && fix !== word) return [fix];
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
  // "el atleta a corrido": the preposition before a participle is "ha".
  // "de acusador a acusado", "Serie A", "a templado-frescos" are not.
  const nextToken = at.tokens[at.i + 1];
  if (
    word === "a" &&
    (at.tokens[at.i].text === "a" || at.starts) &&
    isPerfectParticiple(next) &&
    !isNoun(next) &&
    !genderedForm(next) &&
    !SENSES.test(prev) &&
    !CLITICS.has(prev) &&
    /^\p{Ll}/u.test(nextToken.text) &&
    at.tokens[at.i + 2]?.text !== "-" &&
    ![1, 2, 3, 4].some((k) => at.prev(k) === "de")
  )
    return ["ha"];
  // "siempre e comido": "e" (and) only goes before an i- sound.
  if (word === "e" && isPerfectParticiple(next) && !/^h?i/u.test(next)) return ["he"];
  // "lo ha vuelto ha hacer", "ha estos": the preposition "a".
  if (word === "ha" && next) {
    const after = at.tokens[at.i + 1];
    if (isInfinitive(next) && next !== "haber") return ["a"];
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

function deQue(tokens: Token[], i: number): { span: [number, number]; fix: string } | null {
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

function verbForms(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
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
