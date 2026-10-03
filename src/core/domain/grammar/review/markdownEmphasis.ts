// Markdown emphasis around a token: "**31/04/2020**", "_31/04/2020_", "~~31/04/2020~~".
// The delimiters are not part of the token. Backticks are not emphasis: code stays protected.

/** Quotes and brackets before a token: `("31/12/2025"`. */
export const TOKEN_LEAD = /^["'(“‘[<]*/;
/** Punctuation after a token: `31/12/2025).`. */
export const TOKEN_TRAIL = /[.,;:!?)\]"'”’>]+$/u;
/** A balanced emphasis pair around a token: "**x**", "__x__", "*x*", "_x_", "~~x~~". */
const EMPHASIS_PAIR = /^(\*\*|__|~~|\*|_)(.+)\1$/su;

/**
 * The token in balanced emphasis, and its offset in `bare`. It removes each pair ("***x***",
 * "**_x_**"), and the quotes and the punctuation in the pair ("**31/04/2020.**").
 */
export function unwrapEmphasis(bare: string): { inner: string; offset: number } {
  let inner = bare;
  let offset = 0;
  for (let pair = EMPHASIS_PAIR.exec(inner); pair; pair = EMPHASIS_PAIR.exec(inner)) {
    const lead = TOKEN_LEAD.exec(pair[2])![0].length;
    const next = pair[2].slice(lead).replace(TOKEN_TRAIL, "");
    // Punctuation only in the pair ("**.**"): the token stays as it is.
    if (!next) break;
    offset += pair[1].length + lead;
    inner = next;
  }
  return { inner, offset };
}

/** Regex source: zero to three emphasis delimiters between a cue word and a date ("le **"). */
export const EMPHASIS_MARKS = "[*_~]{0,3}";
/**
 * Regex source: the date does not continue a word or a number. An underscore glued to a word
 * continues it ("v_31/04/2020"). An underscore after a space is emphasis ("_31/04/2020_").
 */
export const NO_WORD_BEFORE = `(?<![\\p{L}\\p{N}]${EMPHASIS_MARKS})`;
/** Regex source: no word or number continues the date, also after emphasis delimiters. */
export const NO_WORD_AFTER = `(?!${EMPHASIS_MARKS}[\\p{L}\\p{N}])`;
