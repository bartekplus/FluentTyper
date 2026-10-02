import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanAdjective, germanInfinitive, germanNounReading } from "./germanLexicon";
import { determinerFits } from "./articleGender";
import { BOUNDARY, isGerman, tokensBefore, wordSet } from "./shared";

// The shortened first part of a coordination takes a hyphen: "Vor- und Nachteile",
// "Ein- und Ausgang", "an- und abmelden". Flagged when the first part is no word of its own
// there and joining it to the second part's tail spells a dictionary word (Vor + teile).

const PAIR = new RegExp(
  `${WORD_START}(?<target>\\p{L}+)(?<join>${SPACE}(?:und|oder|bzw\\.|bis)${SPACE}|\\/)(?<second>\\p{L}+)${WORD_END}`,
  "gdu",
);

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
      if (knownNoun(first.toLowerCase() + tail)) return true;
      // "Vor und Nachteile", "Neu und Gebrauchtwagen": two modifiers on one noun, as the
      // dictionary lists few compounds whole.
      if (modifier(first.toLowerCase()) && modifier(low.slice(0, i))) return true;
      continue;
    }
    // "auszuloggen" → "loggen": a zu-infinitive's tail.
    if (tail.startsWith("zu") && low.slice(0, i).length >= 2) tail = tail.slice(2);
    if (tail.length >= 3 && knownLower(tail) && knownLower(first + tail)) return true;
  }
  return false;
}

function suspendedHyphen(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PAIR)) {
    const { target: first, second } = m.groups!;
    const capital = /^\p{Lu}/u.test(first);
    // Both parts nouns ("Vor und Nachteile") or both lowercase ("ein und auszuloggen").
    if (capital !== /^\p{Lu}/u.test(second) || first.length > 14) continue;
    if (ctx.dictionary.has(first.toLowerCase())) continue;
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
        germanAdjective(before[at].replace(/(?:e|en|er|es|em)$/, ""))
      )
        at--;
      const article = before[at] ?? "";
      sure = determinerFits(article, first) === false && determinerFits(article, second) === true;
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
        !knownNoun(second.toLowerCase()) &&
        nounTail(second.toLowerCase());
      // "Staats und Regierungschefs": a linking -s marks a compound part. "Umwelt und
      // Naturschutz": the first part is a noun of its own, so both readings work.
      const linking = /s$/.test(low) && knownNoun(low.slice(0, -1));
      if (!sure && !linking && germanNounReading(low) === "noun") continue;
    }
    if (!sure && !joins(first, second, capital)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "germanSuspendedHyphen",
      messageKey: "review_msg_german_suspended_hyphen",
      range: { start, end },
      alternatives: [`${first}-`],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanSuspendedHyphen"], detect: suspendedHyphen },
];
