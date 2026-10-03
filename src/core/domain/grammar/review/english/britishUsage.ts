import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { frameDetector, type Frame, type Rule } from "./idioms5";

// englishBritishSpelling (optional): American words and spellings that need their context to
// be read as such. A measured "10-meter" is the unit (a "parking meter" is not), a car's
// "trunk" is its boot, "license" after an owner is the noun, an apartment is a flat.

const BRITISH: Rule = {
  ruleId: "englishBritishSpelling",
  messageKey: "review_msg_british_spelling",
};

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const OWNERS = ["my", "your", "his", "her", "our", "their", "the", "this", "valid", "new"];
const LICENSED = ["driving", "software", "fishing", "gun", "marriage", "liquor", "TV", "pilot's"];
/** Rows for the British table (dialects' englishBritishSpelling index). */
export const BRITISH_ROWS: readonly PhraseRow[] = [
  ...[...OWNERS, ...LICENSED].flatMap((owner): PhraseRow[] => [
    [`${owner} license`, `${owner} licence`],
    [`${owner} licenses`, `${owner} licences`],
  ]),
  ["an apartment", "a flat"],
  ["apartment", "flat"],
  ["apartments", "flats"],
  [["air plane", "air-plane"], "aeroplane"],
  [["air planes", "air-planes"], "aeroplanes"],
  ["gotten", "got"],
  ["anymore", "any more"],
  ...[
    ["take", "have"],
    ["takes", "has"],
    ["took", "had"],
    ["taking", "having"],
  ].flatMap(([take, have]): PhraseRow[] =>
    ["nap", "rest", "break", "holiday", "lie-in"].map((thing): PhraseRow => [
      `${take} a ${thing}`,
      `${have} a ${thing}`,
    ]),
  ),
];

const UNITS: Record<string, string> = {
  meter: "metre",
  meters: "metres",
  liter: "litre",
  liters: "litres",
};
const PREFIX = "(?:kilo|centi|milli|micro|nano|deci)?";

const CAR =
  "(?:car|cars|automobiles?|vehicles?|sedans?|hatchbacks?|SUVs?|Volkswagens?|Chryslers?|Fords?|Toyotas?|Hondas?|taxis?)";

/** A boot named nearby makes the trunk the luggage in it. */
const boot = (m: RegExpExecArray, ctx: DetectContext) => {
  const sentence = ctx.text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
  if (/\bboots?\b/i.test(sentence)) return null;
  return m.groups!.target.toLowerCase() === "trunks" ? "boots" : "boot";
};

const FRAMES: readonly Frame[] = [
  // "a 10-meter rope", "5 kilometers away", "2 liters of milk": a number before the unit.
  {
    rule: BRITISH,
    cue: ["meter", "meters", "liter", "liters"],
    pattern: `(?<![\\p{L}\\p{N}.,])[0-9]+(?:[.,][0-9]+)?(?:-|${S})(?<target>${PREFIX}(?:meters?|liters?))${E}`,
    fix: (m) => {
      const typed = m.groups!.target.toLowerCase();
      const unit = Object.keys(UNITS).find((key) => typed.endsWith(key))!;
      return typed.slice(0, typed.length - unit.length) + UNITS[unit];
    },
  },
  // "the car has a small trunk", "trunks on some cars": a car's boot, not a travel chest.
  {
    rule: BRITISH,
    cue: ["trunk", "trunks"],
    pattern: `(?:${CAR}(?:['’]s?)?|${CAR}${S}(?:(?:usually|often|all|also)${S})?(?:has|have|had|with)(?:${S}an?)?(?:${S}(?:small|large|big|huge|tiny|spacious|roomy|deep|full))?)${S}(?<target>trunks?)${E}`,
    fix: boot,
  },
  {
    rule: BRITISH,
    cue: ["trunk", "trunks"],
    pattern: `(?<target>trunks?)(?=${S}(?:on|of|in)${S}(?:(?:the|a|some|most|many|this|that|these|those|my|your|our|their)${S})?(?:\\p{L}+${S})?${CAR}${E})`,
    fix: boot,
  },
];

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishBritishSpelling"], detect: frameDetector(FRAMES) },
];
