import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { Around, isInfinitive, PREPOSITIONS, SER, replaceToken, tokenize, words } from "./common";
import { ACCENTED_NOMINAL, attribute, isNoun, isVerb } from "./lexicon";

// Accents that tell a verb form from its twin: "el termino" (término, the noun), "se creo"
// (creó, the preterite), "no sabia" (sabía, the imperfect).

const RULE = "spanishAccents" as const;

// Determiners that are never clitics: "el termino", "su numero", "dos practicas".
const DETERMINERS = words(
  "el un una unos unas del al mi mis tus su sus cada nuestro nuestra nuestros nuestras dos tres cuatro " +
    "cinco varios varias muchas muchos pocas pocos otra otro otras otros toda todo",
);
const DEGREE = words("muy más tan bastante");
// Demonstratives are also subject pronouns ("este opera"): only after a preposition.
const DEMONSTRATIVES = words(
  "este esta estos estas ese esa esos esas aquel aquella aquellos aquellas",
);
const SUBJECTS = words("él ella usted");
// Before these, an imperfect or conditional verb: "no sabía", "se hacía", "yo tenía".
const BEFORE_VERB = words("me te se le les nos os no yo él ella usted lo");

/** "termino" -> "término" where a noun or adjective goes, not a verb. */
function nominal(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const accented = ACCENTED_NOMINAL.get(word);
  if (!accented) return null;
  const prev = at.prev();
  const next = at.next();
  if (DETERMINERS.has(prev) || DEGREE.has(prev) || SER.has(prev)) return accented;
  if (DEMONSTRATIVES.has(prev) && PREPOSITIONS.has(at.prev(2))) return accented;
  // "en la página", "parar la máquina", "la máquina del tiempo": "la" is no clitic there.
  if (/^(?:la|las|los)$/u.test(prev)) {
    const before = at.prev(2);
    return PREPOSITIONS.has(before) ||
      isInfinitive(before) ||
      /(?:ado|ido)$/u.test(before) ||
      (!!before && (next === "de" || next === "del"))
      ? accented
      : null;
  }
  // A preposition never governs a finite verb: "de termino", "en linea", "por ultimo".
  return PREPOSITIONS.has(prev) && prev !== "a" ? accented : null;
}

/** "se creo" -> "creó", "él hablo" -> "habló", "no sabia" -> "sabía". */
function verbAccent(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  // A first-person present never follows "se" or a third-person subject.
  // The subject opens its clause: "Ella habló", "y él no le habló" (not "tiene usted empleo").
  const opens = (k: number) => {
    const before = new Around(at.tokens, at.i - k);
    return before.starts || /^(?:y|e|pero|que|cuando|porque|pues|aunque)$/u.test(before.prev());
  };
  const subject =
    (SUBJECTS.has(prev) && opens(1)) ||
    (SUBJECTS.has(at.prev(2)) && /^(?:no|le|les|lo|la|me|te|nos)$/u.test(prev) && opens(2));
  if ((prev === "se" && at.prev(2) !== "per") || subject) {
    const m = /^(\p{L}{2,})o$/u.exec(word);
    // "lio" and "guion" take no accent; nouns and adjectives after "él" are not verbs.
    // "Ella, creo, no lo sabe": a parenthetical first person.
    const aside = subject && /^(?:creo|pienso|supongo|digo|imagino|opino)$/u.test(word);
    if (m && word.length > 3 && !aside && !(subject && (isNoun(word) || attribute(word)))) {
      if (isVerb(`${m[1]}ar`)) return `${m[1]}ó`;
      if ((isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`)) && !isNoun(word)) return `${m[1]}ió`;
    }
  }
  if (BEFORE_VERB.has(prev)) {
    const m = /^(\p{L}+)ia(s|n|mos)?$/u.exec(word);
    // "lo hacia abajo": the preposition "hacia".
    const direction =
      word === "hacia" &&
      /^(?:abajo|arriba|adelante|atrás|afuera|adentro|allá|acá|aquí|allí|delante|el|la|los|las)$/u.test(
        at.next(),
      );
    if (!direction && m && (isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`) || isInfinitive(m[1])))
      return `${m[1]}ía${m[2] ?? ""}`;
  }
  return null;
}

function verbAccents(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const fix = nominal(at) ?? verbAccent(at);
    if (!fix) continue;
    const finding = replaceToken(
      ctx,
      token,
      [fix],
      RULE,
      "review_msg_spanish_accent",
      tokens[i - 1] ?? token,
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbAccents }];
