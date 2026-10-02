import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { Around, isInfinitive, replaceToken, tokenize, words, type Token } from "./common";
import { finiteVerb } from "./lexicon";

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
  /^(?:sé|sabe|sabes|sabemos|saben|sabía|sabías|sabían|saber|supe|supo|pregunto|pregunta|preguntas|preguntan|preguntó|preguntaba|preguntarse|preguntarle|entiendo|entiendes|entiende|entender|comprendo|comprende|comprender|explica|explicar|explícame|explicarme|ignoro|averiguar|imagino|imagina|recuerdo|recuerda|dime|dinos|decirme|decirnos|aquí)$/u;
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

function fixFor(tokens: Token[], i: number, spelling: Spelling): string[] | null {
  const at = new Around(tokens, i);
  const prev = at.prev();
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
  if (spelling.kind === "porqué") {
    // "¿Y porqué no viniste?", "no entiendo porqué lo hizo": the question word.
    const question = tokens[i - 1]?.text === "¿" || (tokens[i - 2]?.text === "¿" && prev === "y");
    if (question || KNOWING.test(prev)) return ["por qué"];
    // "No vino porqué no pudo": because, or why.
    return finiteVerb(prev) && next && !closes ? ["porque", "por qué"] : null;
  }
  const negated = at.prev(2) === "no" || at.prev(3) === "no";
  if (spelling.kind === "por que") {
    if (KNOWING.test(prev) || REASON.has(next)) return ["por qué"];
    return NEED.has(prev) && negated && isInfinitive(next) ? ["por qué"] : null;
  }
  // "porque": "dime porque", "no tienes porque preocuparte".
  if (TELL.has(prev) && next) return ["por qué"];
  return NEED.has(prev) && negated && isInfinitive(next) ? ["por qué"] : null;
}

function porque(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word || tokens[i].start < ctx.from || tokens[i].start >= ctx.to) continue;
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
