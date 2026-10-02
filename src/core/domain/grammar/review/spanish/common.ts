import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { attribute, isVerb } from "./lexicon";

/** A word, number or punctuation mark of the read window, with its lowercase form. */
export interface Token {
  text: string;
  lower: string;
  start: number;
  end: number;
  word: boolean;
  /** A line break, or protected text, separates it from the previous token. */
  broken: boolean;
}

// Words, numbers (with their separators), then any other single non-space character.
const TOKEN = /\p{L}[\p{L}\p{M}]*|\p{N}+(?:[.,:]\p{N}+)*|[^\s\p{L}\p{N}]/gu;
// A letter run glued to a path, mention, address, number or dotted name is not prose.
const GLUE_BEFORE = /[@#/\\_\p{N}\uFFFC-]/u;
const GLUE_AFTER = /[@/\\_\p{N}\uFFFC]/u;
const READ_BEFORE = 160;
const READ_AFTER = 160;

/** Tokens around [from, to): the chunk's own plus some context on both sides. */
export function tokenize(ctx: DetectContext): Token[] {
  const from = Math.max(0, ctx.from - READ_BEFORE);
  const to = Math.min(ctx.text.length, ctx.to + READ_AFTER);
  const tokens: Token[] = [];
  const regex = new RegExp(TOKEN);
  regex.lastIndex = from;
  let last = from;
  for (let m = regex.exec(ctx.text); m && m.index < to; m = regex.exec(ctx.text)) {
    const start = m.index;
    const end = start + m[0].length;
    const word = /^\p{L}/u.test(m[0]);
    const glued =
      word &&
      (GLUE_BEFORE.test(ctx.text[start - 1] ?? "") ||
        GLUE_AFTER.test(ctx.text[end] ?? "") ||
        (ctx.text[start - 1] === "." && /\p{L}/u.test(ctx.text[start - 2] ?? "")) ||
        (ctx.text[end] === "." && /\p{L}/u.test(ctx.text[end + 1] ?? "")));
    tokens.push({
      text: m[0],
      lower: m[0].toLowerCase(),
      start,
      end,
      // A technical piece reads as punctuation: no frame runs through it.
      word: word && !glued,
      broken: /[\n\r\uFFFC]/.test(ctx.text.slice(last, start)),
    });
    last = end;
  }
  return tokens;
}

/** The typed word's casing on a replacement: "Esta" -> "Está", "ESTA" -> "ESTÁ". */
export function carryCase(typed: string, replacement: string): string {
  const kind = detectWordCase(typed);
  if (kind === "upper" && typed.length > 1) return replacement.toUpperCase();
  if (kind === "title" || (kind === "upper" && typed.length === 1))
    return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** "eSTA" or a user-dictionary word: the writer's own spelling. */
export function keepsTyped(ctx: DetectContext, typed: string): boolean {
  return (
    ctx.dictionary.has(typed.toLowerCase()) ||
    (applyWordCase(typed, detectWordCase(typed)) !== typed && typed.length > 1)
  );
}

/**
 * A finding replacing one token, with its casing carried, or null for a user word, odd casing,
 * a cited example or a token outside the chunk.
 */
export function replaceToken(
  ctx: DetectContext,
  token: Token,
  replacements: string[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  evidence: Token = token,
  /** The replacement's own casing ("Julio" -> "julio", "ONGs" -> "ONG"). */
  exact = false,
): RawFinding | null {
  if (token.start < ctx.from || token.start >= ctx.to) return null;
  if (exact ? ctx.dictionary.has(token.lower) : keepsTyped(ctx, token.text)) return null;
  if (namedExampleBefore(ctx.text, token.start)) return null;
  const alternatives = exact ? replacements : replacements.map((r) => carryCase(token.text, r));
  if (alternatives.includes(token.text)) return null;
  return {
    ruleId,
    messageKey,
    range: { start: token.start, end: token.end },
    alternatives,
    context: {
      start: Math.min(token.start, evidence.start),
      end: Math.max(token.end, evidence.end),
    },
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  };
}

/** Space-separated words as a set. */
export const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

export const PREPOSITIONS = words(
  "a al ante bajo con contra de del desde durante en entre hacia hasta mediante para por " +
    "según sin sobre tras",
);
export const SER = words(
  "es era fue sea fuera fuese siendo ser será sería son eran fueron sean serán serían sido",
);
export const CONJUNCTIONS = words(
  "y e o u ni pero que si aunque porque pues mientras cuando como donde sino cual cuales quien",
);
export const CLITICS = words("me te se le les lo los la las nos os");

// Invariant adjectives the dictionary files as nouns, common after "estar".
export const INVARIANT = words(
  "feliz felices triste tristes alegre verde grande enorme joven mayor menor mejor peor fácil " +
    "difícil útil inútil débil fuerte libre pobre caliente inteligente disponible ausente " +
    "presente pendiente consciente capaz dispuesto dispuesta",
);

export const BOUNDARY = /^[.,;:!?…)»”"]$/u;
export const OPENING = /^[¿¡(«“"—–-]$/u;

export const isBoundary = (token: Token | undefined) =>
  !token || token.broken || BOUNDARY.test(token.text);

/** Neighbouring words of tokens[i] on the same line: "" past punctuation or a break. */
export class Around {
  constructor(
    readonly tokens: Token[],
    readonly i: number,
  ) {}
  /** The word k tokens before (k > 0) or after (k < 0... use next). */
  prev(k = 1): string {
    for (let j = this.i; j > this.i - k; j--)
      if (!this.tokens[j] || this.tokens[j].broken) return "";
    const token = this.tokens[this.i - k];
    return token?.word ? token.lower : "";
  }
  next(k = 1): string {
    for (let j = this.i + 1; j <= this.i + k; j++)
      if (!this.tokens[j] || this.tokens[j].broken) return "";
    const token = this.tokens[this.i + k];
    return token?.word ? token.lower : "";
  }
  /** The clause starts right before tokens[i]. */
  get starts(): boolean {
    const before = this.tokens[this.i - 1];
    return (
      !before ||
      this.tokens[this.i].broken ||
      BOUNDARY.test(before.text) ||
      OPENING.test(before.text)
    );
  }
  /** The clause ends right after tokens[i + k]. */
  endsAfter(k = 0): boolean {
    return isBoundary(this.tokens[this.i + k + 1]);
  }
  /** A capitalized word inside a sentence: a name. */
  get prevIsName(): boolean {
    const before = this.tokens[this.i - 1];
    return (
      !!before?.word &&
      !this.tokens[this.i].broken &&
      /^\p{Lu}/u.test(before.text) &&
      !new Around(this.tokens, this.i - 1).starts
    );
  }
}

/** What may follow "está" as its attribute: a participle, an adjective, an invariant adjective. */
export function attributeOf(word: string) {
  if (!word) return null;
  if (INVARIANT.has(word)) return { feminine: null, plural: /s$/.test(word) };
  return attribute(word);
}

export const DETERMINERS = words(
  "el la los las un una unos unas mi mis tu tus su sus nuestro nuestra nuestros nuestras " +
    "vuestro vuestra este esta estos estas ese esa esos esas aquel aquella cada otro otra",
);

/** A present-tense look: "combina", "divide", "gustan" (stem + -ar/-er/-ir is a verb). */
export const verbLike = (word: string) => {
  const m = /^(\p{L}+?)([aeo])(?:n|s)?$/u.exec(word);
  if (!m) return false;
  const [, stem, vowel] = m;
  const endings = vowel === "a" ? ["ar"] : vowel === "e" ? ["er", "ir"] : ["ar", "er", "ir"];
  return endings.some((ending) => isVerb(`${stem}${ending}`));
};

export const isInfinitive = (word: string) => {
  const m = /^(\p{L}+?[aeií]r)(?:me|te|se|nos|os|le|les|lo|los|la|las){0,2}$/u.exec(word);
  return !!m && isVerb(m[1].replace("í", "i"));
};
