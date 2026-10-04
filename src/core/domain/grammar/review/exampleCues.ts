/**
 * Words that name the quotation after them as an example rather than prose:
 * `write "the the"`, `schreibe „ein ein“`, `le mot « dans dans »`. Every
 * language's cues apply to every text: they only ever suppress a finding.
 */
const CUE_WORDS = [
  // en
  "writes?|types?|spell(?:s|ed|ing)?|phrases?|words?|examples?|literals?|texts?|terms?|forms?",
  "headings?|titles?|labels?|identifiers?|property|variables?|names?",
  // de
  "schreib|schreibe|schreibt|schreiben|tippe|tippt|tippen|wort|wortes|wörter|begriff\\p{L}*|ausdruck\\p{L}*|beispiel\\p{L}*",
  "titel|überschrift",
  // fr
  "écris|écrivez|écrire|tape[sz]?|taper|saisissez|saisir|mots?|termes?|expressions?|exemples?|textes?|titres?",
  // es / pt
  "escribe|escriba|escribes|escribir|teclea|teclee|teclear|palabras?|términos?|expresi(?:ón|ones)|frases?|ejemplos?|textos?",
  "títulos?|palavras?|escreva|escreve|escrever|digite|digita|digitar|termos?|express(?:ão|ões)|exemplos?",
  // pl
  "napisz|napiszcie|pisze|pisać|wpisz|wpiszcie|wpisać|słow\\p{L}*|wyraz\\p{L}*|termin\\p{L}*|wyrażeni\\p{L}*",
  "fraz\\p{L}*|przykład\\p{L}*|tekst\\p{L}*|tytuł\\p{L}*",
  // sv
  "skriv|skriver|skriva|ord(?:et|en)?|termen|uttryck(?:et)?|frasen|exempel|exemplet|rubrik(?:en)?",
  // hr
  "napiši|napišite|piši|pišite|upiši|upišite|pisati|upisati|riječ\\p{L}*|pojam|pojma|izraz\\p{L}*|primjer\\p{L}*",
  "naslov\\p{L}*",
  // el
  "γράψε|γράψτε|γράφε|γράφει|πληκτρολόγησε|πληκτρολογήστε|λέξ\\p{L}*|όρο\\p{L}*|έκφραση|φράση|παράδειγμα",
  "κείμενο|τίτλο\\p{L}*",
  // ar
  "اكتب|كلمة|الكلمة|عبارة|مثال|نص|مصطلح",
].join("|");
// Speech and "reads" verbs: a quotation after them is ordinary quoted prose, but
// an error right at its start ("it says “the the”") is still taken as cited.
const SPEECH_WORDS =
  "says?|reads?|sagt|heißt|lautet|dit|dice|diz|mówi|brzmi|säger|kaže|glasi|λέει|يقول";
// "the word is", "das Wort lautet", "comme", "jak", "όπως".
const LINKING =
  "is|was|are|such[ \\t]+as|like|name|ist|war|wie|est|était|comme|es|era|como|é|jest|był|jak|är|var|som|je|bio|kao|είναι|ήταν|όπως";
const cue = (words: string) => `(?<![\\p{L}\\p{M}])(?:${words})(?:[ \\t]+(?:${LINKING}))?[ :\\t]*`;
const CUE = cue(CUE_WORDS);
const CITING_CUE = cue(`${CUE_WORDS}|${SPEECH_WORDS}`);
/** Opening quotation marks of every supported language's convention. */
export const OPENING_QUOTES = "\"'“‘„‚«»”‹›";

/** [start, end) is quoted by itself: an opening quote right before it, a closing quote right after it. */
export const quotedSpan = (text: string, start: number, end: number) =>
  OPENING_QUOTES.includes(text[start - 1] || "\n") && /["”'’“‘»«›‹]/.test(text[end] ?? "");

/** Ends with a cue, right where a quotation opens: `write ` + `"…"`. */
export const CUE_BEFORE_QUOTE = new RegExp(`${CUE}$`, "iu");
/** Ends with a cue and the opening quote itself: `write "` + `the the`. French pads guillemets. */
export const CUE_AND_QUOTE = new RegExp(
  `${CITING_CUE}[${OPENING_QUOTES}][ \\u00a0\\u202f]?$`,
  "iu",
);
// Ends inside a named example, up to 80 characters past its opening quote. "replace" only
// cites here: `replace "their going"` names the text to change.
const CUE_BEFORE_EXAMPLE = new RegExp(`${cue(`${CUE_WORDS}|${SPEECH_WORDS}|replace`)}$`, "iu");
const QUOTES = new Set(OPENING_QUOTES);
const QUOTE_OR_LINE = new RegExp(`[${OPENING_QUOTES}\\n\\r\\uFFFC]`);
// The cue's last word, tested alone first: a `$`-anchored alternation is retried from every
// position, which costs milliseconds per call when the regex JIT is off.
const CUE_TAIL = new RegExp(`^(?:${CUE_WORDS}|${SPEECH_WORDS}|replace|${LINKING}|as)$`, "iu");
const LETTER = /[\p{L}\p{M}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The word ending `text` before trailing spaces, tabs or a colon; "" when there is none. */
function lastWord(text: string): string {
  let end = text.length;
  while (end > 0 && /[ :\t]/.test(text[end - 1])) end--;
  let start = end;
  while (start > 0 && LETTER.test(text[start - 1])) start--;
  return text.slice(start, end);
}

/**
 * The one quoted-example guard for Review frames: `index` sits inside a named
 * example (`write "he go"`, `the word is “teh”`) opened in the 128 characters
 * before it, at most 80 characters back on the same line.
 */
export function namedExampleBefore(text: string, index: number): boolean {
  const floor = Math.max(0, index - 128);
  // Cheap gate: most frame matches have no quote and no line end in reach.
  if (!QUOTE_OR_LINE.test(text.slice(Math.max(floor, index - 81), index))) return false;
  // Each opening quote on the line within reach; the cue right before it is read from a
  // short window that starts on a word boundary, not the whole 128 characters.
  for (let q = index - 1; q >= floor && q >= index - 81; q--) {
    const char = text[q];
    if (char === "\n" || char === "\r" || char === "\uFFFC") return false;
    if (!QUOTES.has(char)) continue;
    // An apostrophe after a letter or digit ("see's", "90's") opens no quotation.
    if ((char === "'" || char === "’") && LETTER_OR_DIGIT.test(text[q - 1] ?? "")) continue;
    let start = Math.max(floor, q - 48);
    while (start > floor && /[\p{L}\p{M}]/u.test(text[start - 1])) start++;
    const cue = text.slice(start, q);
    const word = lastWord(cue);
    if (word && CUE_TAIL.test(word) && CUE_BEFORE_EXAMPLE.test(cue)) return true;
  }
  return false;
}

/** Words naming a quotation mark itself: `the character "`, `das Zeichen „`. */
export const MARK_CUE = new RegExp(
  "(?<![\\p{L}\\p{M}])(?:character|symbol|mark|quote|zeichen|anführungszeichen|caractère|symbole|signe|guillemets?|carácter|símbolo|signo|comillas|caractere|sinal|aspas|znak|cudzysł[oó]w\\p{L}*|tecken|citattecken|simbol|navodnik\\p{L}*|χαρακτήρας|σύμβολο|εισαγωγικά|رمز|علامة)(?:[ \\t]+(?:is|ist|est|es|é|jest|är|je|είναι))?[ :\\t]*$",
  "iu",
);
