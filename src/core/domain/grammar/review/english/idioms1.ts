import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { COMPLETE, frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

const S = SPACE;
const E = WORD_END;
const DETERMINER =
  "(?:a|an|the|this|that|these|those|my|your|his|her|its|our|their|every|each|some|any)";

/** One row per verb form: `~` stands for the form in both columns. */
const forms = (
  typed: string,
  replacement: string,
  pairs: readonly [string, string][],
): PhraseRow[] =>
  pairs.map(([from, to]) => [typed.replace("~", from), replacement.replace("~", to)]);
const CAPITALIZE: [string, string][] = [
  "ize",
  "izes",
  "ized",
  "izing",
  "ise",
  "ises",
  "ised",
  "ising",
].map((ending) => [`capital${ending}`, `capital${ending}`]);
const COURSE: [string, string][] = [
  ["curse", "course"],
  ["curses", "courses"],
  ["cursed", "coursed"],
  ["cursing", "coursing"],
];

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  ["a mean to an end", "a means to an end"],
  [["a whole another", "a whole 'nother"], "a whole other"],
  ["as nauseam", "ad nauseam"],
  [["al be it", "al beit", "all beit", "allbe it", "albe it"], "albeit"],
  ["all well in good", "all well and good"],
  ["and the such", "and such"],
  ["another things", "other things"],
  ["another ones", "other ones"],
  ["as compare to", "as compared to"],
  ["as is evident by", "as is evidenced by"],
  ["as was evident by", "as was evidenced by"],
  ["as evident by", "as evidenced by"],
  ...["this", "that", "which"].map((word): PhraseRow => [
    `${word} is evident by`,
    `${word} is evidenced by`,
  ]),
  ["as early back as", "as far back as"],
  ...["anything", "everything"].map((word): PhraseRow => [
    `as is with ${word}`,
    [`as with ${word}`, `as is the case with ${word}`],
  ]),
  ["as long that", "as long as"],
  ["as much than", "as much as"],
  ["as many than", "as many as"],
  ["as of currently", ["currently", "as of now"]],
  ["as of lately", "as of late"],
  ["at all cost", "at all costs"],
  [["at face values", "on face values"], "at face value"],
  [["at the expanse of", "at the expance of", "at the expenses of"], "at the expense of"],
  ["aware about", "aware of"],
  ["unaware about", "unaware of"],
  ...forms("~ off of", "~ on", CAPITALIZE),
  ...forms("~ off", "~ on", CAPITALIZE),
  ["comprises of", ["comprises", "is comprised of"]],
  ["comprising of", "comprising"],
  ...["", "my ", "your ", "his ", "her ", "our ", "their ", "the "].flatMap((owner) =>
    forms(`~ through ${owner}veins`, `~ through ${owner}veins`, COURSE),
  ),
  [["cutting age", "cutting-age"], "cutting-edge"],
  ...["will", "would", "to", "must", "should", "can", "could", "may", "might"].map(
    (word): PhraseRow => [`${word} do diligence`, `${word} do due diligence`],
  ),
  ["egg yoke", "egg yolk"],
  ["egg yokes", "egg yolks"],
  ["environmental var", "environment var"],
  ["environmental vars", "environment vars"],
  ["every once and again", ["every once in a while", "every now and again"]],
  ["every single of", "every single one of"],
  ["far and few between", "few and far between"],
  ["finish touches", "finishing touches"],
  ["for most part", "for the most part"],
  ["hidden into", "hidden in"],
  [["humans beings", "human's beings"], "human beings"],
  ["hunger pain", "hunger pang"],
  ["impressed of", ["impressed by", "impressed with"]],
  ["in ideal world", "in an ideal world"],
  ["in do course", "in due course"],
  [
    ["on hindsight", "on hind sight", "on hind-sight", "in hind sight", "in hind-sight"],
    "in hindsight",
  ],
  [["in lue of", "in leu of", "in liu of", "in lieu off"], "in lieu of"],
  ["in need for", "in need of"],
  ["in of itself", ["in and of itself", "in itself"]],
  ["in of themselves", ["in and of themselves", "in themselves"]],
  [
    [
      "in the grand scale of things",
      "on the grand scheme of things",
      "on the grand scale of things",
    ],
    "in the grand scheme of things",
  ],
  ["in the same vane", "in the same vein"],
  [["in same vein", "in same vain", "in same vane"], "in the same vein"],
  ...[".", ",", ";", ":"].map((mark): PhraseRow => [
    `in the same veins${mark}`,
    `in the same vein${mark}`,
  ]),
  ["incidence report", "incident report"],
  ["incidence reports", "incident reports"],
  ["initiatively", "proactively"],
  ["unsensitive", "insensitive"],
  ["unsurmountable", "insurmountable"],
  ...["I", "we", "you", "they"].map((subject): PhraseRow => [
    `${subject}'ve go to`,
    `${subject}'ve got to`,
  ]),
  ["kinda of", "kind of"],
  ["sorta of", "sort of"],
  [["on masse", "in masse"], "en masse"],
  ["on route to", "en route to"],
  ["on-route to", "en-route to"],
];
export const COMPOUNDS: readonly PhraseRow[] = [
  ["afterall", "after all"],
  ["aslong", "as long"],
  ["in anyway", "in any way"],
  [["before hand", "before-hand"], "beforehand"],
];
export const STYLE: readonly PhraseRow[] = [
  ["as it so happens", "as it happens"],
  ["in the best of times", "at the best of times"],
  ["hearable", "audible"],
  ["bad rep", "bad rap"],
  ["brutalness", "brutality"],
  ["environmental variable", "environment variable"],
  ["environmental variables", "environment variables"],
  ["into a different direction", "in a different direction"],
];

type Rule = "englishPhraseCorrections" | "englishClosedCompounds" | "stylePhrasing";
const MESSAGES = {
  englishPhraseCorrections: "review_msg_phrase_correction",
  englishClosedCompounds: "review_msg_closed_compound",
  stylePhrasing: "review_msg_style_phrasing",
} as const;
/** A frame's `target` group is replaced; `fix` may veto (null) after a lexicon check. */
type Frame = {
  pattern: string;
  fix: string | readonly string[] | ((m: RegExpExecArray) => string | readonly string[] | null);
};

const verbBase = (word: string) =>
  englishWordInfo(word.toLowerCase())?.verbs.some((v) => v.form === "base") ?? false;
// Words after "a little of" that make it a correct partitive ("a little of everything").
const PARTITIVE =
  "(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|it|them|him|me|us|you|what|which|whatever|each|every|both|all|any|some|either|neither|one|much|many|more|most|other|others|another|everything|anything|something|nothing|everyone|anyone|someone|everybody|anybody|somebody|[a-z]+self|[a-z]+selves)";
const CONDITIONAL = new Set([
  "possible",
  "necessary",
  "needed",
  "required",
  "appropriate",
  "available",
]);
// A lookbehind over a run of spaces comes after `(?=word)`: tried at every position of a
// long run, it rereads the run each time in JavaScriptCore.
const CLAUSE = `(?:^|[.!?,;:(\\n])[ \\t]*`;
const POSSESSOR = "the|a|an|this|that|its|their|his|her|our|my|your|no";
/** Not right after one of these words. */
const notAfter = (words: string) => `(?<!(?<![a-z'’])(?:${words})${S})`;

const FRAMES: Record<Rule, readonly Frame[]> = {
  englishPhraseCorrections: [
    // "a little of practice": a bare noun after "a little of".
    {
      pattern: `(?<target>a${S}little${S}of)${S}(?!${PARTITIVE}${E})[a-z]+${E}(?!['’])`,
      fix: ["a little", "a bit of"],
    },
    {
      pattern: `(?<target>along${S}time)${E}(?!${S}(?:ago|and|or|axis|axes|series|scales?|dimensions?|lines?)${E})`,
      fix: "a long time",
    },
    {
      // The target ends at the determiner, so the edit inserts "of " right before it.
      pattern: `(?:take|takes|took|taken|taking)${S}(?<target>advantage${S})(?=${DETERMINER}${E})(?!a${S}(?:lot|bit|little|few|couple|while)${E})`,
      fix: "advantage of ",
    },
    { pattern: `(?:after|for|in)${S}(?<target>while)${COMPLETE}`, fix: "a while" },
    {
      pattern: `(?:go|goes|went|going|gone)${S}ahead${S}(?<target>an)${S}(?<verb>[a-z]+)${E}`,
      fix: (m) => (verbBase(m.groups!.verb) ? "and" : null),
    },
    {
      // "an in with the boss", "an in group" (in-group): the noun "in".
      pattern: `(?<target>an)${S}in${S}(?!(?:with|at|to|for|on|into|among|groups?|crowd|joke|jokes|house|depth|person|store|game|app)${E})[a-z]`,
      fix: "and",
    },
    { pattern: `${notAfter("one")}another${S}(?<target>an${S})(?=[a-z])`, fix: "" },
    {
      pattern: `as${S}(?<target>follow)${E}(?!${S}(?:up|ups|through|suit|on)${E})`,
      fix: "follows",
    },
    {
      pattern: `(?=on)(?<=${CLAUSE}|(?<![a-z])(?:and|but|or|so|yet|that)${S})(?<target>on)${S}face${S}value${E}`,
      fix: "at",
    },
    {
      pattern: `${notAfter("not|n['’]t")}(?<target>in)${S}the${S}very${S}least${E}`,
      fix: "at",
    },
    {
      pattern: `(?<=(?:(?<![a-z'’])(?:is|was|are|were|be|been|seems|seemed)|[a-z]['’]s)${S})(?<target>besides)${S}the${S}point${E}`,
      fix: "beside",
    },
    {
      pattern: `${notAfter("the|a")}better${S}(?<target>of)(?:${COMPLETE}|(?=${S}(?:[a-z]+ing|with|without|now|at|if|not|than|before|after|when|because|since|for|today|here|there|anyway|financially|then|can|could|will|would|and|but|or|so|overall|already)${E}))`,
      fix: "off",
    },
    {
      pattern: `beware${S}(?<target>about|with${S}regard${S}to|regarding|concerning|against|for|with|among|between)${E}`,
      fix: "of",
    },
    {
      // The noun "cause" ("a worthy cause it is", "the root cause it is") follows a determiner
      // and at most one modifier; the verb follows a modal ("can cause it").
      pattern: `${notAfter(`${POSSESSOR}|can|could|will|would|may|might|must|should|shall|to|did|does|do|not|n['’]t`)}(?<!(?<![a-z'’])(?:${POSSESSOR})${S}[a-z]+${S})(?<target>cause)${S}it${S}is${E}`,
      fix: (m) => {
        const before = /([a-z]+)\s+$/i.exec(m.input.slice(Math.max(0, m.index - 40), m.index));
        const info = before && englishWordInfo(before[1].toLowerCase());
        return info?.adjective && !info.adverb && !info.noun && !info.verbs.length
          ? null
          : "because";
      },
    },
    {
      pattern: `${notAfter("most|more|least|less")}curious${S}(?<target>on|of)${E}`,
      fix: "about",
    },
    {
      pattern: `(?:(?:do|does|did)n['’]t|(?:do|does|did)${S}not)${S}(?<target>wan)${E}`,
      fix: "want",
    },
    {
      pattern: `(?<target>(?<aux>do|does|did)n['’]t${S}can)${S}(?<verb>[a-z]+)${E}`,
      fix: (m) =>
        verbBase(m.groups!.verb)
          ? m.groups!.aux.toLowerCase() === "did"
            ? "couldn't"
            : "can't"
          : null,
    },
    {
      // "during ages 5 to 10", "during ages: 35-40" name an age range.
      pattern: `(?<target>during)${S}ages${E}(?![ \\t]*:|${S}(?:of${S})?[0-9])`,
      fix: "for",
    },
    {
      pattern: `(?=in)(?<=${CLAUSE}|(?:(?<![a-z'’])(?:is|are|am|was|were|be|been|being|already|still|now|currently|while)|[a-z]['’](?:s|re|m))${S})(?<target>in)${S}route${S}to${E}`,
      fix: "en",
    },
    { pattern: `(?:I|we|you|they|he|she)${S}(?<target>fond)${S}on${E}`, fix: "found" },
    {
      pattern: `${notAfter("I|we|you|they|he|she")}fond${S}(?<target>on)${E}`,
      fix: "of",
    },
    {
      pattern: `(?<=(?<![a-z])why${E}[^.!?\\n]{1,80})(?<target>at)${S}the${S}first${S}place${E}`,
      fix: "in",
    },
    {
      pattern: `${notAfter("the|a|this|that|its|your|my|our|their|his|her|turn|turned|turns|switch|switched|toggle|toggled|set")}(?<target>(?<word>kind|sort)${S}off)(?=${S}[a-z])`,
      fix: (m) => `${m.groups!.word.toLowerCase()} of`,
    },
    {
      pattern: `(?<target>kind${S}if)${S}(?<next>[a-z]+)${E}`,
      fix: (m) => {
        const next = m.groups!.next.toLowerCase();
        if (next === "a" || next === "an") return "kind of";
        const info = englishWordInfo(next);
        const adjective = info?.adjective || info?.verbs.some((v) => v.form === "participle");
        return adjective && !CONDITIONAL.has(next) ? "kind of" : null;
      },
    },
    {
      pattern: `inspired${S}(?<target>from)${E}(?!${S}(?:an?${S}(?:early|young)|the${S}(?:start|beginning|outset)|day${S}one|birth|childhood|then|now)${E})`,
      fix: "by",
    },
  ],
  englishClosedCompounds: [
    {
      pattern: `(?<target>along${S}side)(?:${COMPLETE}|(?=${S}(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|him|them|us|me|it|each|one|other)${E}))`,
      fix: "alongside",
    },
  ],
  stylePhrasing: [
    // "cliche" is an accepted spelling; the accented form is the conventional one.
    // A frame keeps capitals that a single-word style row would read as an abbreviation.
    { pattern: `(?<target>cliche)(?=(?:s|d)?${E}|-)`, fix: "cliché" },
    // "arrive Monday" is common American usage; "arrive on Monday" is the neutral form.
    {
      pattern: `(?<target>(?<verb>arrive|arrives|arrived|arriving)${S})(?=(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)${E})`,
      fix: (m) => `${m.groups!.verb} on `,
    },
  ],
};

function detectFrames(ctx: DetectContext, rule: Rule): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, fix } of FRAMES[rule]) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      if (hasUserOrCasedWord(ctx, ctx.text.slice(m.index, Math.max(end, m.index + m[0].length))))
        continue;
      const value = typeof fix === "function" ? fix(m) : fix;
      if (value === null) continue;
      const typed = m.groups!.target;
      const style = detectWordCase(typed.trim());
      const alternatives = [value].flat().map((alt) => applyWordCase(alt, style));
      findings.push({
        ruleId: rule,
        messageKey: MESSAGES[rule],
        range: { start, end },
        alternatives,
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
        context: {
          start: Math.max(0, m.index - 40),
          end: Math.min(ctx.text.length, m.index + m[0].length + 20),
        },
      });
    }
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = (Object.keys(FRAMES) as Rule[]).map(
  (rule) => ({ rules: [rule], detect: (ctx) => detectFrames(ctx, rule) }),
);
