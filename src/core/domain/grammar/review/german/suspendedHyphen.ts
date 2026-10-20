import type { MatchFixer } from "../../engine/reviewRules";
import {
  germanAdjective,
  germanInfinitive,
  germanListedNoun,
  germanNounReading,
} from "./germanLexicon";
import { determinerFits } from "./articleGender";
import { BOUNDARY, tokensAfter, tokensBefore, wordSet } from "./shared";

// The shortened first part of a coordination takes a hyphen: "Vor- und Nachteile",
// "Ein- und Ausgang", "an- und abmelden". Flagged when the first part is no word of its own
// there and joining it to the second part's tail spells a dictionary word (Vor + teile).

/** "Groß/Kleinschreibung", "Preis/Leistung": two capitalized words joined by a slash are prose, not
 * a path; Review's technical-token guard lets them through in German text. */
export const GERMAN_SLASH_PAIR = /^\p{Lu}\p{Ll}+\/\p{Lu}\p{Ll}+$/u;

// Singular finite verbs after a subject: "wurde", "ist", "hat".
const SINGULAR_VERBS =
  /^(?:ist|war|wird|wurde|hat|hatte|kann|muss|soll|darf|bleibt|gilt|steht|liegt|geht|kommt)$/;
const knownNoun = (word: string) => germanNounReading(word) !== null;
/** A noun, or a compound ending in one ("bestandskunden"). */
const nounTail = (word: string) =>
  [...word].some((_, i) => word.length - i >= 4 && knownNoun(word.slice(i)));
const knownLower = (word: string) =>
  germanInfinitive(word) || germanAdjective(word) || germanNounReading(word) !== null;

// Words that open a compound as a modifier: particles and adjective stems.
const PARTICLES = wordSet(
  "vor nach ober unter ein aus an ab in im ex auf zu hin her rück vorder hinter über " +
    "inner außer innen außen nah fern hoch tief",
);
const modifier = (word: string) =>
  PARTICLES.has(word) || (germanAdjective(word) && germanNounReading(word) === null);

/** Whether some tail of `second` joined to `first` spells a word of the same kind. */
function joins(first: string, second: string, noun: boolean): boolean {
  const low = second.toLowerCase();
  for (let i = 2; i <= low.length - 3; i++) {
    let tail = low.slice(i);
    if (noun) {
      if (!knownNoun(tail)) continue;
      if (tail.length >= 4 && knownNoun(first.toLowerCase() + tail)) return true;
      // "Vor und Nachteile", "Neu und Gebrauchtwagen": two modifiers on one noun, as the
      // dictionary lists few compounds whole.
      // A short adjective-like piece ("ger|undium") is no modifier.
      const piece = low.slice(0, i);
      if (
        modifier(first.toLowerCase()) &&
        (PARTICLES.has(piece) || (piece.length >= 4 && modifier(piece)))
      )
        return true;
      continue;
    }
    // "auszuloggen" → "loggen": a zu-infinitive's tail.
    if (tail.startsWith("zu") && low.slice(0, i).length >= 2) tail = tail.slice(2);
    if (tail.length >= 3 && knownLower(tail) && knownLower(first + tail)) return true;
    // "ober und untergärige": two particles before one inflected adjective ("obergärig").
    const lemma = tail.replace(/e[mnrs]?$/, "");
    if (PARTICLES.has(first) && PARTICLES.has(low.slice(0, i)) && germanAdjective(first + lemma))
      return true;
  }
  return false;
}

/** The named frame fixes of the de.suspendedHyphen rule (grammar/rules/de.yaml). */
export const FIXERS = {
  suspendedPart: (m, ctx) => {
    const { target: first, second } = m.groups!;
    // "Ober und untergärige Sorten": a lowercase first part capitalized at a sentence start.
    const opening = BOUNDARY.test(tokensBefore(ctx.text, m.index, 1).at(-1) ?? "");
    const capital = /^\p{Lu}/u.test(first) && !(opening && /^\p{Ll}/u.test(second));
    // Both parts nouns ("Vor und Nachteile") or both lowercase ("ein und auszuloggen").
    if (capital !== /^\p{Lu}/u.test(second) || first.length > 14) return null;
    if (!capital && /^\p{Lu}/u.test(first) && !PARTICLES.has(first.toLowerCase())) return null;
    // "die Unterlagen bis Freitag": "bis" between nouns is a range, not a shortened part.
    if (capital && /bis/.test(m.groups!.join)) return null;
    if (ctx.dictionary.has(first.toLowerCase())) return null;
    let sure = false;
    if (capital) {
      const low = first.toLowerCase();
      const before = tokensBefore(ctx.text, m.index, 3);
      const prior = before.at(-1) ?? "";
      // "eine freie Stil und Grammatikprüfung", "die Gewinn und Verlustrechnung": the article,
      // past its adjectives, fits the compound and not the first noun.
      let at = before.length - 1;
      while (
        at > 0 &&
        /^\p{Ll}+(?:e|en|er|es|em)$/u.test(before[at]) &&
        germanAdjective(before[at].replace(/(?:e|en|er|es|em)$/, "")) &&
        !/^(?:k?ein|[dms]ein|ihr|unser|eur|dies|jed|jen|welch)(?:e|en|er|es|em)$/.test(before[at])
      )
        at--;
      const article = before[at] ?? "";
      // The second part's gender may be unknown ("Umweltthemen"): its noun tail is enough.
      const secondFits = determinerFits(article, second);
      sure =
        determinerFits(article, first) === false &&
        (secondFits === true || (secondFits === null && nounTail(second.toLowerCase())));
      // "Die Summen und Saldenliste wurde …": two nouns as subject would take a plural verb.
      const verb = tokensAfter(ctx.text, m.index + m[0].length, 1)[0] ?? "";
      sure ||=
        /^(?:der|die|das|ein|eine)$/i.test(article) &&
        BOUNDARY.test(before[at - 1] ?? "") &&
        SINGULAR_VERBS.test(verb) &&
        nounTail(second.toLowerCase()) &&
        germanListedNoun(second.toLowerCase()) === null;
      // "an Neu und Bestandskunden": a capitalized adjective inside a sentence ("für Jung und
      // Alt" pairs two adjectives; "Stumpf", "Schal" are nouns too, with noun forms "Stumpfs").
      sure ||=
        prior !== "" &&
        !BOUNDARY.test(prior) &&
        germanAdjective(low) &&
        germanNounReading(low) === null &&
        ![`${low}s`, `${low}es`, `${low}en`].some((form) => germanNounReading(form) === "noun") &&
        !germanAdjective(second.toLowerCase()) &&
        // A compound after "und" ("mit Stumpf und Stiel" pairs two nouns).
        germanListedNoun(second.toLowerCase()) === null &&
        nounTail(second.toLowerCase());
      // "Staats und Regierungschefs": a linking -s marks a compound part. "Umwelt und
      // Naturschutz": the first part is a noun of its own, so both readings work.
      const linking = /s$/.test(low) && knownNoun(low.slice(0, -1));
      // "die Staats und Regierungschefs", "beim Anwalts und Notarverein": a linking -s before a
      // compound, not a genitive after its own article ("des Staats").
      sure ||=
        /s$/.test(low) &&
        nounTail(low.slice(0, -1)) &&
        !/^(?:des|eines|keines|meines|deines|seines|ihres|unseres|eures|dieses|jenes|jedes)$/i.test(
          prior,
        ) &&
        germanListedNoun(second.toLowerCase()) === null &&
        nounTail(second.toLowerCase());
      if (!sure && !linking && germanNounReading(low) === "noun") return null;
    }
    if (!sure && !joins(capital ? first : first.toLowerCase(), second, capital)) return null;
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "germanSuspendedHyphen",
      messageKey: "review_msg_german_suspended_hyphen",
      range: { start, end },
      alternatives: [`${first}-`],
      context: { start: m.index, end: m.index + m[0].length },
    };
  },
  torn: (m) => {
    const [start, end] = m.indices!.groups!.target;
    const hin = m.groups!.hin;
    return {
      ruleId: "germanSuspendedHyphen",
      messageKey: "review_msg_german_suspended_hyphen",
      range: { start, end },
      alternatives: [`${hin}- und hergerissen`],
      context: { start, end },
    };
  },
} satisfies Record<string, MatchFixer>;
