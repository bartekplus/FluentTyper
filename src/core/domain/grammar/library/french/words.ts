// The rule library (library/french.ts): French word facts that several rules ask.
import {
  adjectiveReadings,
  isVerbHomograph,
  nounGender,
  verbReadings,
} from "../../review/french/frenchLexicon";

// Words in h that refuse elision (h aspiré), by lemma: "le hibou", "je hurle", "la hausse".
const H_ASPIRE = new Set(
  (
    "hache hachis hacher haie haillon haine haïr hall halle halte hamac hameau hamburger hamster " +
    "hanche handicap hangar hanneton hanter happer harceler hardi hareng hargne haricot harnais " +
    "harpe hasard hâte hâter hausse hausser haut hauteur havre hennir hérisson hernie héron " +
    "héros hêtre heurter hibou hideux hiérarchie hisser hocher hockey homard honte honteux " +
    "hoquet horde hors hotte houblon houle housse hublot huer huit huitième hululer hurler " +
    "hutte hyène hippie hobby harem halo hasch haddock hurlement houx hâle hagard hanap " +
    "harpon hautbois havane heurt hongrois hussard huppe hure huche " +
    // English loans keep their h: "le hacker", "la holding".
    "hacker hardware hashtag hipster hit holding hooligan hotline hub handball"
  ).split(" "),
);

/** Whether a word in h refuses elision: its noun singular, verb lemma or adjective lemma is an h
 * aspiré word. */
export function hAspire(word: string): boolean {
  if (H_ASPIRE.has(word) || H_ASPIRE.has(word.replace(/[sx]$/, ""))) return true;
  return [...verbReadings(word), ...adjectiveReadings(word)].some((r) => H_ASPIRE.has(r.lemma));
}

/** The masculine noun a form in -e stands for with an accent: "cure" -> "curé", "marche" ->
 * "marché"; null when no masculine noun, adjective or participle is spelled so. */
export function accentedNoun(word: string): string | null {
  if (!word.endsWith("e")) return null;
  const accented = `${word.slice(0, -1)}é`;
  if (nounGender(accented) === "f") return null;
  const noun =
    nounGender(accented) === "m" ||
    adjectiveReadings(accented).some((r) => r.slot === "ms") ||
    (isVerbHomograph(accented) && verbReadings(accented).some((r) => r.slot === "Q"));
  return noun ? accented : null;
}
