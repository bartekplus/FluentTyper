import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { DETERMINER, readNoun } from "./agreement";
import { finiteVerb, subjunctiveLike } from "./lexicon";

// porque / porqué / por qué / por que: the conjunction (because), the noun (the reason), the
// question word (why) and preposition + relative. The frame around each picks the spelling:
// a determiner makes the noun ("el porqué"), a verb of knowing the question ("no sé por qué").

const RULE = "spanishConfusions" as const;

const SINGULAR_DETERMINERS = words(
  "el un del al su este ese aquel ningún algún otro mi tu nuestro vuestro cuyo",
);
const PLURAL_DETERMINERS = words("los unos sus estos esos aquellos mis tus nuestros vuestros");
// Verbs whose object can be a "why" question: "no entiendo por qué", "dime por qué".
const KNOWING =
  /^(?:sé|sabe|sabes|sabemos|saben|sabía|sabías|sabían|saber|supe|supo|sepa|sepas|sepan|entienda|entiendas|comprenda|pregunto|pregunta|preguntas|preguntan|preguntó|preguntaba|preguntarse|preguntarle|entiendo|entiendes|entiende|entender|comprendo|comprende|comprender|explica|explicar|explícame|explicarme|ignoro|averiguar|imagino|imagina|recuerdo|recuerda|dime|dinos|decirme|decirnos|aquí)$/u;
// "Dime porque lo has hecho": a command to tell why.
const TELL = words("dime dinos decirme decirnos explícame explícanos explicarme explicarnos");
const NEED = words(
  "hay había habrá habría tengo tienes tiene tenemos tenéis tienen tenía tenías tenían",
);
const REASON = words("razón razones motivo motivos causa causas");

type Spelling = {
  end: number;
  kind: "porque" | "porqué" | "por que" | "por qué" | "plural";
};

/** The spelling starting at tokens[i], or null: "porque", "porqué", "por que", "por qués". */
function spellingAt(tokens: Token[], i: number): Spelling | null {
  const token = tokens[i];
  if (token.lower === "porque" || token.lower === "porqué") return { end: i, kind: token.lower };
  if (token.lower === "porques" || token.lower === "porqués") return { end: i, kind: "plural" };
  const next = tokens[i + 1];
  if (token.lower !== "por" || !next?.word || next.broken) return null;
  if (next.lower === "que") return { end: i + 1, kind: "por que" };
  if (next.lower === "qué") return { end: i + 1, kind: "por qué" };
  if (next.lower === "qués") return { end: i + 1, kind: "plural" };
  return null;
}

// Function words a loose verb reading would count: "no", "me", "una".
const CLOSED = words("no me te se le les lo la los las nos os un una el ya muy más");
// Nouns that ask why: "la pregunta es por qué", "no tengo idea de por qué".
const ASKING_NOUNS = words("pregunta cuestión duda idea misterio incógnita");

/** Two finite verbs before the question closes: a "porque" clause and the main one. */
function secondVerb(tokens: Token[], from: number): boolean {
  let verbs = 0;
  for (let j = from + 1; j < tokens.length && j < from + 16; j++) {
    const token = tokens[j];
    if (token.broken || /^[?.!]$/u.test(token.text)) break;
    if (token.word && finiteVerb(token.lower) && !CLOSED.has(token.lower)) verbs++;
  }
  return verbs > 1;
}

function fixFor(tokens: Token[], i: number, spelling: Spelling): string[] | null {
  const at = new Around(tokens, i);
  // "entiendo perfectamente por qué": an adverb in -mente between the verb and the question.
  const skip = /^\p{L}{3,}mente$/u.test(at.prev()) ? 1 : 0;
  const prev = at.prev(1 + skip);
  // "¿Porque no viniste?", "¿Y porque no?": a question opening with the word asks why.
  const opens = tokens[i - 1]?.text === "¿" || (tokens[i - 2]?.text === "¿" && at.prev() === "y");
  // "la pregunta es por qué", "idea de por qué".
  const asked =
    ((prev === "es" || prev === "era") && ASKING_NOUNS.has(at.prev(2 + skip))) ||
    (prev === "de" && ASKING_NOUNS.has(at.prev(2 + skip)));
  const after = new Around(tokens, spelling.end);
  const next = after.next();
  const closes = after.endsAfter() || next === "de" || next === "del";
  if (spelling.kind === "plural")
    return PLURAL_DETERMINERS.has(prev) && tokens[i].lower !== "porqués" ? ["porqués"] : null;
  // "el porque", "un por qué", "del por que": the noun, before a stop or its "de".
  if (SINGULAR_DETERMINERS.has(prev))
    return spelling.kind !== "porqué" && closes ? ["porqué"] : null;
  if (PLURAL_DETERMINERS.has(prev)) return closes ? ["porqués"] : null;
  if (spelling.kind === "por qué") return null;
  if (asked) return ["por qué"];
  if (spelling.kind === "porqué") {
    // "¿Y porqué no viniste?", "no entiendo porqué lo hizo": the question word.
    if (opens || KNOWING.test(prev)) return ["por qué"];
    // "No vino porqué no pudo": because, or why.
    return finiteVerb(prev) && next && !closes ? ["porque", "por qué"] : null;
  }
  const negated = at.prev(2) === "no" || at.prev(3) === "no";
  if (spelling.kind === "por que") {
    if (opens || KNOWING.test(prev) || REASON.has(next)) return ["por qué"];
    if (NEED.has(prev) && negated && isInfinitive(next)) return ["por qué"];
    // "no le gustan por que sabe…": after a verb, a finite clause is a cause or a question;
    // a subjunctive after "por que" is a purpose ("lucha por que haya paz").
    const verb = /^(?:él|ella|ellos|ellas|usted|yo|tú|se|me|te|le|les|lo|la|nos)$/u.test(next)
      ? after.next(2)
      : next;
    return (finiteVerb(prev) || isInfinitive(prev)) &&
      !readNoun(prev) &&
      !!verb &&
      finiteVerb(verb) &&
      !subjunctiveLike(verb)
      ? ["porque", "por qué"]
      : null;
  }
  // "la razón porque lo pienso" -> "por que": the relative after a reason noun with its
  // determiner ("tiene la razón porque…", "le dio la razón porque…" and "perdió la causa
  // porque…" give a cause).
  if (
    spelling.kind === "porque" &&
    /^(?:razón|razones|motivo|motivos)$/u.test(prev) &&
    DETERMINER.has(at.prev(2)) &&
    next &&
    ![3, 4].some((k) => /^(?:(?:ten|tien|tuv|tend|d[aiáé])\p{L}*|con|sin)$/u.test(at.prev(k)))
  )
    return ["por que"];
  // "porque": "dime porque", "no tienes porque preocuparte", "¿Porque no viniste?",
  // "no sé porque se fue".
  // "¿Porque no lo hice vas a odiarme?": a cause before the question's own verb.
  if (opens && next && !secondVerb(tokens, spelling.end)) return ["por qué"];
  const subject = at.prev(2 + skip) === "se" ? 3 + skip : 2 + skip;
  if (KNOWING.test(prev) && at.prev(subject) === "no" && next) return ["por qué"];
  if (TELL.has(prev) && next) return ["por qué"];
  return NEED.has(prev) && negated && isInfinitive(next) ? ["por qué"] : null;
}

/** A finite verb, past function words a loose reading would count. */
const verbAt = (token: Token | undefined) =>
  !!token?.word && !CLOSED.has(token.lower) && finiteVerb(token.lower) && !readNoun(token.lower);

/**
 * sino (but rather) against si no (if not): "no lo hizo él si no su primo" contrasts a phrase
 * with no verb of its own after a negation; "sino vienes" and "¿qué hacer sino quería…?" put a
 * finite verb right after, which "sino" never takes without "que".
 */
function sino(tokens: Token[], i: number): { end: number; fix: string[] } | null {
  const at = new Around(tokens, i);
  const word = tokens[i].lower;
  if (word === "sino") {
    const next = tokens[i + 1];
    if (!next?.word || next.broken || next.lower === "que") return null;
    // "su sino" (fate); "sino hace dos meses" (but rather two months ago).
    if (DETERMINER.has(at.prev()) || /^(?:hace|hacía|hay)$/u.test(next.lower)) return null;
    // "no canta sino baila": "sino que" or "si no" before a finite verb.
    if (PREPOSITIONS.has(next.lower)) return null;
    const verb = CLITICS.has(next.lower) ? tokens[i + 2] : next;
    if (!verb || !verbAt(verb) || subjunctiveLike(verb.lower)) return null;
    return {
      end: i,
      fix: at.starts || !negatedBefore(tokens, i) ? ["si no"] : ["si no", "sino que"],
    };
  }
  if (word !== "si" || at.next() !== "no" || tokens[i + 1].broken) return null;
  const after = tokens[i + 2];
  const before = tokens[i - 1];
  // "Si no, mañana": otherwise; "Si no puedes…" opens a condition.
  if (!after?.word || after.broken || !before || /^[.;:!?¿¡]$/u.test(before.text)) return null;
  if (tokens[i].broken || !negatedBefore(tokens, i)) return null;
  if (after.lower === "que") return { end: i + 1, fix: ["sino"] };
  for (let j = i + 2; j < tokens.length && j < i + 10; j++) {
    const token = tokens[j];
    if (token.broken || /^[.;:!?]$/u.test(token.text)) return { end: i + 1, fix: ["sino"] };
    const lower = token.lower;
    if (token.text === "," || CLITICS.has(lower)) return null;
    // "si no para de llover": "para" before "de" is the verb "parar".
    if (lower === "para" && at.tokens[j + 1]?.lower === "de") return null;
    if (!token.word || PREPOSITIONS.has(lower) || CLOSED.has(lower)) continue;
    // "si no vendrá", "si no me pagas": a verb makes it a condition.
    if (FINITE_LOOK.test(lower) || (finiteVerb(lower) && !readNoun(lower))) return null;
  }
  return null;
}

// Futures and conditionals the loose verb reading misses: "vendrá", "sabría".
const FINITE_LOOK = /\p{L}{2,}(?:rá|rán|ré|rás|ría|rían|ríamos|remos)$/u;

/** A "no" earlier in the clause: "No lo hizo él si no…", "para hoy no si no…". */
function negatedBefore(tokens: Token[], i: number): boolean {
  for (let j = i - 1; j >= 0 && j > i - 12; j--) {
    const token = tokens[j];
    if (/^[.;:!?¿¡]$/u.test(token.text) || tokens[j + 1].broken) return false;
    if (token.lower === "no" || token.lower === "nunca" || token.lower === "tampoco") return true;
  }
  return false;
}

function porque(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word || tokens[i].start < ctx.from || tokens[i].start >= ctx.to) continue;
    const contrast = sino(tokens, i);
    if (contrast) {
      const last = tokens[contrast.end];
      const span = { ...tokens[i], end: last.end, text: ctx.text.slice(tokens[i].start, last.end) };
      const finding = replaceToken(ctx, span, contrast.fix, RULE, "review_msg_spanish_confusion");
      if (finding) findings.push(finding);
      i = contrast.end;
      continue;
    }
    const spelling = spellingAt(tokens, i);
    if (!spelling || tokens[spelling.end].broken) continue;
    const fixes = fixFor(tokens, i, spelling);
    if (!fixes) continue;
    const last = tokens[spelling.end];
    const span = { ...tokens[i], end: last.end, text: ctx.text.slice(tokens[i].start, last.end) };
    const finding = replaceToken(ctx, span, fixes, RULE, "review_msg_spanish_confusion");
    if (finding) findings.push(finding);
    i = spelling.end;
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: porque }];
