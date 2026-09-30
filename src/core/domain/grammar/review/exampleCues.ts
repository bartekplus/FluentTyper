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

/** Ends with a cue, right where a quotation opens: `write ` + `"…"`. */
export const CUE_BEFORE_QUOTE = new RegExp(`${CUE}$`, "iu");
/** Ends with a cue and the opening quote itself: `write "` + `the the`. French pads guillemets. */
export const CUE_AND_QUOTE = new RegExp(
  `${CITING_CUE}[${OPENING_QUOTES}][ \\u00a0\\u202f]?$`,
  "iu",
);
/** Ends inside a named example, up to 80 characters past its opening quote. */
export const INSIDE_NAMED_EXAMPLE = new RegExp(
  `${CITING_CUE}[${OPENING_QUOTES}][^\\r\\n\\uFFFC]{0,80}$`,
  "iu",
);

/** Words naming a quotation mark itself: `the character "`, `das Zeichen „`. */
export const MARK_CUE = new RegExp(
  "(?<![\\p{L}\\p{M}])(?:character|symbol|mark|quote|zeichen|anführungszeichen|caractère|symbole|signe|guillemets?|carácter|símbolo|signo|comillas|caractere|sinal|aspas|znak|cudzysł[oó]w\\p{L}*|tecken|citattecken|simbol|navodnik\\p{L}*|χαρακτήρας|σύμβολο|εισαγωγικά|رمز|علامة)(?:[ \\t]+(?:is|ist|est|es|é|jest|är|je|είναι))?[ :\\t]*$",
  "iu",
);
