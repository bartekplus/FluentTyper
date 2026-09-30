type InitialSound ="vowel" | "consonant" | "either";

// Letters whose spoken name starts with a vowel sound: "an F" (ef), "an H"
// (aitch), "an X" (ex); "a U" (you), "a B" (bee).
const VOWEL_NAMED_LETTERS = /^[aefhilmnorsx]/i;

// Initialisms said as a word by some and letter by letter by others.
const EITHER_INITIALISMS = new Set(["SQL", "URL", "LED", "FAQ"]);

// Spellings whose first sound is not the one their first letter suggests. The
// longest matching prefix wins: "unin-" is "un-in" but "uni-" is "you-ni".
const PREFIX_SOUNDS = new Map<string, InitialSound>([
  // Silent h.
  ["hour", "vowel"],
  ["honest", "vowel"],
  ["honor", "vowel"],
  ["honour", "vowel"],
  ["heir", "vowel"],
  // Said with or without the h, depending on the speaker.
  ["herb", "either"],
  ["histor", "either"],
  // u, eu and ew said "you".
  ["uni", "consonant"],
  ["unin", "vowel"],
  ["unim", "vowel"],
  ["unident", "vowel"],
  ["unidio", "vowel"],
  ["uniss", "vowel"],
  ["unitem", "vowel"],
  ["uniro", "vowel"],
  ["unanim", "consonant"],
  ["use", "consonant"],
  ["usu", "consonant"],
  ["usa", "consonant"],
  ["usur", "consonant"],
  ["ut", "consonant"],
  ["utt", "vowel"],
  ["utm", "vowel"],
  ["ura", "consonant"],
  ["ure", "consonant"],
  ["uri", "consonant"],
  ["uro", "consonant"],
  ["ubi", "consonant"],
  ["uga", "consonant"],
  ["uk", "consonant"],
  ["ude", "consonant"],
  ["ukul", "either"],
  ["eu", "consonant"],
  ["euler", "vowel"],
  ["ew", "consonant"],
  // o said "w".
  ["one", "consonant"],
  ["once", "consonant"],
  ["oner", "vowel"],
]);
const LONGEST_PREFIX = Math.max(...[...PREFIX_SOUNDS.keys()].map((prefix) => prefix.length));

/**
 * Whether `word` starts with a vowel or a consonant sound, which is what picks
 * "an" or "a" ("an hour", "a user", "an FBI", "a GIF"). "either" means both are
 * heard or the sound is unknown ("SQL", "herb", "NASA", "8"): callers abstain.
 */
export function englishInitialSound(word: string): InitialSound {
  if (!/^[A-Za-z]/.test(word) || EITHER_INITIALISMS.has(word)) return "either";
  const spelled = spelledOutSound(word);
  if (spelled) return spelled;
  const lower = word.toLowerCase();
  for (let length = Math.min(LONGEST_PREFIX, lower.length); length > 1; length -= 1) {
    const sound = PREFIX_SOUNDS.get(lower.slice(0, length));
    if (sound) return sound;
  }
  return /^[aeiou]/.test(lower) ? "vowel" : "consonant";
}

/**
 * The sound of a word read letter by letter, or null for a word said as a word.
 * Letters are read one by one in a single letter ("U-turn"), a small letter
 * before a capital ("iPhone", "mDNS"), and a run of capitals that does not open
 * with consonant-vowel ("FBI", "HTML", "the MP of MP3", "the FF of FFmpeg").
 */
function spelledOutSound(word: string): InitialSound | null {
  const capitals = word.match(/^[A-Z]+/)?.[0] ?? "";
  const spelled =
    word.length === 1 ||
    /^[a-z][A-Z]/.test(word) ||
    (capitals.length > 1 && !/^[^AEIOU][AEIOU]./.test(capitals));
  if (spelled) return VOWEL_NAMED_LETTERS.test(word) ? "vowel" : "consonant";
  // "NASA", "REST": probably said as a word, but "an N-A-S-A" is heard too
  // when the letter's name starts with a vowel.
  if (capitals.length > 1) return VOWEL_NAMED_LETTERS.test(word) ? "either" : "consonant";
  return null;
}
