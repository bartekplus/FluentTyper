import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { Around, replaceToken, tokenize, words, type Token } from "./common";
import { isNoun } from "./lexicon";

// The comma after a sentence connector that opens its clause ("Sin embargo, no ganó") and
// between a greeting and the person greeted ("Hola, Marta").

const RULE = "spanishTypography" as const;
const MESSAGE = "review_msg_spanish_comma" as const;

const CONNECTORS = [
  "sin embargo",
  "por lo tanto",
  "por tanto",
  "por consiguiente",
  "por ende",
  "en consecuencia",
  "en cambio",
  "por el contrario",
  "al contrario",
  "por otro lado",
  "por otra parte",
  "por un lado",
  "por una parte",
  "además",
  "asimismo",
  "así pues",
  "en primer lugar",
  "en segundo lugar",
  "en tercer lugar",
  "por último",
  "en conclusión",
  "en resumen",
  "en definitiva",
  "en efecto",
  "es decir",
  "o sea",
  "de hecho",
  "por cierto",
  "en fin",
  "aun así",
  "de todos modos",
  "de todas formas",
].map((phrase) => phrase.split(" "));
// What may follow a connector's words in another reading: "además de", "al contrario que",
// "o sea que", "por otro lado del río", "de hecho y de derecho".
const NOT_CONNECTOR_AFTER = words("de del que a al y e o u como");

const GREETINGS = [
  "hola",
  "adiós",
  "buenos días",
  "buenas tardes",
  "buenas noches",
  "felicidades",
  "enhorabuena",
  "hasta luego",
  "hasta pronto",
  "felices fiestas",
  "muchos besos",
].map((phrase) => phrase.split(" "));
const ADDRESSED = words(
  "amigo amiga amigos amigas chico chica chicos chicas guapo guapa guapos guapas cariño " +
    "querido querida queridos queridas señor señora señores señoras señorita jefe jefa " +
    "compañero compañera compañeros compañeras hermano hermana tío tía mamá papá abuelo " +
    "abuela hijo hija niños niñas estimado estimada estimados estimadas colega colegas " +
    "preciosa precioso amor cielo vecino vecina vecinos chaval chavales muchachos " +
    "muchachas gente familia equipo",
);

/** tokens[i..] spell `phrase` on one line: the index of its last token, or -1. */
function phraseAt(tokens: Token[], i: number, phrase: string[]): number {
  for (let k = 0; k < phrase.length; k++) {
    const token = tokens[i + k];
    if (!token?.word || token.lower !== phrase[k] || (k > 0 && token.broken)) return -1;
  }
  return i + phrase.length - 1;
}

function commas(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word || !new Around(tokens, i).starts) continue;
    let last = -1;
    for (const phrase of CONNECTORS) {
      last = phraseAt(tokens, i, phrase);
      if (last < 0) continue;
      const after = tokens[last + 1];
      const next = after?.lower ?? "";
      // Only before a word of the clause it opens; "Por tanto esfuerzo" is "for so much".
      if (!after?.word || after.broken || NOT_CONNECTOR_AFTER.has(next)) last = -1;
      else if (phrase.join(" ") === "por tanto" && isNoun(next)) last = -1;
      break;
    }
    if (last < 0) {
      for (const phrase of GREETINGS) {
        last = phraseAt(tokens, i, phrase);
        if (last < 0) continue;
        const after = tokens[last + 1];
        // "Hola Marta", "Adiós amigos"; "¡Hola a todos!" greets no one by name.
        const addressed =
          !!after?.word &&
          !after.broken &&
          (ADDRESSED.has(after.lower) || /^\p{Lu}\p{Ll}/u.test(after.text));
        if (!addressed) last = -1;
        break;
      }
    }
    if (last < 0) continue;
    const token = tokens[last];
    const finding = replaceToken(ctx, token, [`${token.lower},`], RULE, MESSAGE, tokens[last + 1]);
    if (finding) findings.push(finding);
    i = last;
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: commas }];
