import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// Open, closed and hyphenated compounds: rows for forms that are never right written apart,
// and slot frames for the ones that are a phrase in one position and a compound in another.

const S = SPACE;
const E = WORD_END;

/** "a b" -> "ab" (or "a-b"), once per ending added to the second part. */
const rows = (pairs: string, joiner: "" | "-", endings: readonly string[] = [""]): PhraseRow[] =>
  pairs
    .trim()
    .split(/\s*,\s*/)
    .flatMap((pair) => {
      const [a, b] = pair.split(" ");
      return endings.map((end): PhraseRow => [`${a} ${b}${end}`, `${a}${joiner}${b}${end}`]);
    });

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];

export const COMPOUNDS: readonly PhraseRow[] = [
  // Nouns whose plural cannot be read as a noun and a verb ("my head aches" is left out).
  ...rows(
    "foot ball, air port, rain bow, wheel chair, key hole, share holder, stake holder, sky line, " +
      "cock tail, super market, motor bike, motor cycle, smart phone, fire fighter, goal keeper, " +
      "trouble maker, ghost writer, house maid, back log, land lord, land lady, out break, " +
      "eye lid, eye brow, space ship, hair style, finger print, finger nail, counter part, " +
      "dock yard, ship yard, back yard, grave yard, hand rail, stale mate, swim suit, bath robe, " +
      "bull dog, breast plate, home town, play ground, mouth piece, score card, video tape, " +
      "law maker, law breaker, girl friend, boy friend, home owner, door bell, door knob, " +
      "door step, door way, land line, user name, head phone, ear phone, " +
      "cyber attack, thunder storm, under graduate, hand book, car pool, day dreamer, " +
      "sleep walker, well wisher, step son, step daughter, step mother, step father, " +
      "step brother, step sister, step parent, step dad, step mom, neighbor hood, " +
      "neighbour hood, web sight",
    "",
    ["", "s"],
  ),
  ...rows("smart watch, eye lash, hair brush, mail box", "", ["", "es"]),
  ...rows(
    "back ache, head ache, tooth ache, law suit, drive ways, left overs, " +
      "sea food, day light, country side, nut shell, out door, out doors, half way, side ways, " +
      "eye sight, space craft, cyber security, cyber space, cyber bullying, thunder struck, " +
      "under stood, under developed, under explored, under appreciated, under rated, " +
      "under paid, under staffed, over complicated, over thinking, over rated, over priced, " +
      "over whelming, over whelmed, over looked, over worked, out dated, out spoken, " +
      "out numbered, out grown, out sourced, out sourcing, up dated, heart broken, " +
      "heart breaking, ground breaking, bullet proof, water proof, fire proof, sound proof, " +
      "fool proof, shatter proof, hand cuffs, hand cuffed, hand written, car pooling, " +
      "tail gating, sleep walking, sleep walked, news worthy, trust worthy, praise worthy, " +
      "note worthy, sea worthy, step child, step children, business man, business men, " +
      "business woman, business women, up date, up dates, out perform, out performs, " +
      "out performed, out performing, out weigh, out weighs, out weighed, out compete, " +
      "out competed, out competing, safe guarded, safe guarding, over think",
    "",
  ),
  ...["any", "some", "every"].map((q): PhraseRow => [`${q} one else`, `${q}one else`]),
  ...["any", "some", "every", "no"].map((q): PhraseRow => [`${q} body else`, `${q}body else`]),
  ["pick up truck", "pickup truck"],
  ["pick up trucks", "pickup trucks"],
  ["pick up line", "pickup line"],
  ["pick up lines", "pickup lines"],
  ["up and coming", "up-and-coming"],
  ["editor in chief", "editor-in-chief"],
  ["editors in chief", "editors-in-chief"],
  ["well wishes", "well-wishes"],
  ["one pager", "one-pager"],
  ["one pagers", "one-pagers"],
  ["one trick pony", "one-trick pony"],
  ["one stop shop", "one-stop shop"],
  ["one stop shops", "one-stop shops"],
  ["natural born", "natural-born"],
  ["picture perfect", "picture-perfect"],
  ["time critical", "time-critical"],
  ["twin engined", "twin-engined"],
  ["four engined", "four-engined"],
  ["Harley Davidson", "Harley-Davidson"],
  ...["right", "left"].flatMap((side) =>
    ["man", "side", "corner", "drive", "lane", "turn", "column", "margin"].map(
      (noun): PhraseRow => [`${side} hand ${noun}`, `${side}-hand ${noun}`],
    ),
  ),
  ...rows("off ramp, on ramp", "-", ["", "s"]),
  ["passer by", "passer-by"],
  ["passers by", "passers-by"],
  ...rows("whole sale, market place, pay roll, steel worker, safe guard", "", ["", "s"]).filter(
    ([typed]) => typed !== "safe guards" && typed !== "whole sales",
  ),
  ...rows("out run, back filled, under appreciate, under appreciated, under appreciates", ""),
  ...rows("hitch hike, hitch hiked, hitch hiking, hitch hiker, hitch hikers", ""),
  ["call to action button", "call-to-action button"],
  ["call to action buttons", "call-to-action buttons"],
  ...["girls", "boys"].flatMap((kind): PhraseRow[] => [
    [`all ${kind} school`, `all-${kind} school`],
    [`all ${kind} schools`, `all-${kind} schools`],
  ]),
  ["no go area", "no-go area"],
  ["no go zone", "no-go zone"],
  ["week-end", "weekend"],
  ["week-ends", "weekends"],
  ["common used", "commonly used"],
  ...["sign", "log"].flatMap((verb): PhraseRow[] =>
    ["s", "ing"].flatMap((end): PhraseRow[] =>
      ["in", "out"].map((particle): PhraseRow => {
        const form = verb === "log" && end === "ing" ? "logging" : `${verb}${end}`;
        return [`${form}-${particle}`, `${form} ${particle}`];
      }),
    ),
  ),
  ...rows("re doing, re done", ""),
  // Verb compounds whose past form is always the compound ("peer-reviewed evidence").
  ...rows(
    "peer reviewed, fact checked, guest edited, spot checked, cross checked, hand delivered, " +
      "kick started, deep fried, stir fried, daisy chained, guilt tripped, " +
      "green lighted, fine tuned",
    "-",
  ),
  ["dead lifted", "deadlifted"],
  ["force fed", "force-fed"],
  ["spoon fed", "spoon-fed"],
  ["Miami Dade", "Miami-Dade"],
  ...rows("water resistant, heat resistant, fire resistant, stain resistant, shock resistant", "-"),
  ...rows("scratch resistant, wrinkle resistant, tamper resistant", "-"),
  // Fixed modifiers that only ever precede their noun.
  ...[
    ["one night stand", "one-night stand"],
    ["red light district", "red-light district"],
    ["money back guarantee", "money-back guarantee"],
    ["no fly zone", "no-fly zone"],
    ["set top box", "set-top box"],
    ["two stroke engine", "two-stroke engine"],
    ["four stroke engine", "four-stroke engine"],
    ["subject matter expert", "subject-matter expert"],
    ["denial of service attack", "denial-of-service attack"],
    ["push up bra", "push-up bra"],
    ["dry erase marker", "dry-erase marker"],
    ["dry erase board", "dry-erase board"],
    ["zero day exploit", "zero-day exploit"],
    ["zero day vulnerability", "zero-day vulnerability"],
    ["near death experience", "near-death experience"],
    ["to do list", "to-do list"],
    ["run on sentence", "run-on sentence"],
    ["button up shirt", "button-up shirt"],
    ["button down shirt", "button-down shirt"],
    ["in app purchase", "in-app purchase"],
    ["black hat hacker", "black-hat hacker"],
    ["white hat hacker", "white-hat hacker"],
    ["built up area", "built-up area"],
    ["chicken and egg problem", "chicken-and-egg problem"],
    ["chicken and egg situation", "chicken-and-egg situation"],
    ["same day delivery", "same-day delivery"],
    ["next day delivery", "next-day delivery"],
    ["open heart surgery", "open-heart surgery"],
    ["one term president", "one-term president"],
    ["two term president", "two-term president"],
    ["two state solution", "two-state solution"],
    ["one state solution", "one-state solution"],
  ].flatMap(([typed, fix]): PhraseRow[] => [
    [typed, fix],
    [
      `${typed}${/(?:x|ss)$/.test(typed) ? "es" : "s"}`,
      `${fix}${/(?:x|ss)$/.test(fix) ? "es" : "s"}`,
    ],
  ]),
  ["to dos", "to-dos"],
  ["to do's", "to-dos"],
  ["open heart surgeries", "open-heart surgeries"],
];

export const STYLE: readonly PhraseRow[] = [];

// ---------------------------------------------------------------------------- frames

type Finding = RawFinding;
const lower = (word: string | undefined) => (word ?? "").toLowerCase();
const info = (word: string | undefined) => (word ? englishWordInfo(lower(word)) : null);
const group = (m: RegExpExecArray, name: string) => m.indices!.groups![name];
/** A regex alternation of phrases, longest first, with any run of spaces between words. */
const alternation = (keys: readonly string[]) =>
  [...new Set(keys)]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replaceAll(" ", S))
    .join("|");
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t ]{1,8}(["“]?[\p{L}\p{N}][\p{L}\p{N}'’-]*)/u.exec(ctx.text.slice(end, end + 48))?.[1] ?? "";
// A determiner, possessive or object pronoun after a particle makes it a preposition with its
// own object: "the walk through the park", "a hand over his mouth".
const OBJECT =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|me|him|us|them|it|you|some|any|every|each|all|no|one|two|three|other|another|more|less)$/i;

/** The typed casing on a replacement: capitals, an initial capital, or lowercase. */
function recase(typed: string, fix: string): string {
  if (typed.length > 1 && typed === typed.toUpperCase()) return fix.toUpperCase();
  return /^\p{Lu}/u.test(typed) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
}

function found(
  ctx: DetectContext,
  m: RegExpExecArray,
  alternatives: readonly string[],
  ruleId: RawFinding["ruleId"] = "englishContextualCompounds",
  messageKey: RawFinding["messageKey"] = "review_msg_compounds",
): Finding | null {
  const [start, end] = group(m, "target");
  const typed = ctx.text.slice(start, end);
  if (hasUserOrCasedWord(ctx, typed) || titled(typed)) return null;
  const cased = alternatives.map((alt) => recase(typed, alt));
  if (cased.includes(typed)) return null;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: cased,
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    context: {
      start: Math.max(0, m.index - 24),
      end: Math.min(ctx.text.length, m.index + m[0].length + 24),
    },
  };
}

// Phrasal verbs whose noun is joined or hyphenated: "a warm up" is "a warm-up". A word after
// the particle that opens a noun phrase makes it a preposition: "the walk through the park".
const PHRASAL_NOUNS: Record<string, readonly string[]> = {
  "warm up": ["warm-up"],
  "mock up": ["mock-up"],
  "sit up": ["sit-up"],
  "push up": ["push-up"],
  "pull up": ["pull-up"],
  "chin up": ["chin-up"],
  "start up": ["startup", "start-up"],
  "break up": ["breakup", "break-up"],
  "knock out": ["knockout", "knock-out"],
  "kick off": ["kickoff", "kick-off"],
  "take down": ["takedown", "take-down"],
  "take over": ["takeover", "take-over"],
  "take off": ["takeoff", "take-off"],
  "take away": ["takeaway"],
  "buy back": ["buyback"],
  "flash back": ["flashback"],
  "work around": ["workaround"],
  "work out": ["workout"],
  "roll out": ["rollout", "roll-out"],
  "sign up": ["sign-up"],
  "log out": ["logout"],
  "check up": ["checkup"],
  "lay out": ["layout"],
  "lay off": ["layoff"],
  "print out": ["printout"],
  "sell out": ["sellout"],
  "lock down": ["lockdown"],
  "shut down": ["shutdown"],
  "break down": ["breakdown"],
  "break out": ["breakout", "break-out"],
  "set back": ["setback"],
  "push back": ["pushback"],
  "follow up": ["follow-up"],
  "catch up": ["catch-up"],
  "clean up": ["cleanup"],
  "cut off": ["cutoff"],
  "pick up": ["pickup"],
  "write up": ["write-up"],
  "write down": ["write-down"],
  "write off": ["write-off"],
  "hook up": ["hookup"],
  "mix up": ["mix-up"],
  "round up": ["roundup"],
  "tune up": ["tune-up"],
  "wake up": ["wake-up"],
  "stand up": ["stand-up"],
  "get together": ["get-together"],
  "make over": ["makeover"],
  "do over": ["do-over"],
  "blow out": ["blowout"],
  "come back": ["comeback"],
  "hang over": ["hangover"],
  "pay off": ["payoff"],
  "pay out": ["payout"],
  "give away": ["giveaway"],
  "get away": ["getaway"],
  "carry over": ["carryover"],
  "cover up": ["cover-up"],
  "close up": ["close-up"],
  "hold up": ["holdup", "hold-up"],
  "let down": ["letdown"],
  "melt down": ["meltdown"],
  "touch down": ["touchdown"],
  "count down": ["countdown"],
  "slow down": ["slowdown"],
  "trade off": ["trade-off"],
  "add on": ["add-on"],
  "send off": ["send-off"],
  "rip off": ["rip-off"],
  "bail out": ["bailout"],
  "black out": ["blackout"],
  "burn out": ["burnout"],
  "lift off": ["liftoff"],
  "lock out": ["lockout"],
  "shoot out": ["shootout"],
  "stand off": ["standoff"],
  "take out": ["takeout"],
  "turn around": ["turnaround"],
  "drive through": ["drive-through"],
  "back up": ["backup"],
  "left over": ["leftover"],
  "how to": ["how-to"],
  "opt in": ["opt-in"],
  "opt out": ["opt-out"],
  "catch all": ["catch-all"],
  "toss up": ["toss-up"],
};
// First words that are also everyday nouns ("a sign in front", "the work out of the way",
// "your back up straight"): these need a noun after the particle ("the sign up form").
const NOUN_HEADS = new Set(
  "drive left hold count touch close set sign check work stand cut round lift push".split(" "),
);
// "a chin up", "the back up": these also read as a body part with an adverb after a possessive
// ("keep your chin up"), so only an article may come before them.
const ARTICLE_HEADS = new Set(["back", "chin"]);
const PHRASAL_KEYS = Object.keys(PHRASAL_NOUNS)
  .map((key) => key.replace(" ", S))
  .join("|");
// "(?=\\p{L})" opens the long frames: off words (on runs of spaces) their alternations never run.
const PHRASAL_PLURAL = `(?=\\p{L})(?<target>${Object.keys(PHRASAL_NOUNS)
  .filter((key) => !/^(?:left|how|opt|catch|back) /.test(key))
  .map((key) => `${key.replace(" ", S)}s`)
  .join("|")})${E}`;
const PREMODIFIER =
  /^(?:first|second|third|final|last|next|quick|big|small|major|minor|huge|brief|daily|weekly|monthly|annual|usual|regular|complete|full|proper|good|great|real|official|early|late|short|long|new|old|initial|informal|formal|official|massive|total)$/i;
const ARTICLE = "a|an|the|my|your|his|our|their|its|another|every|no|any|first|this|that";
const PHRASAL_NOUN = `(?=\\p{L})(?<det>${ARTICLE}|(?:after|before|during|since|of|from|with|about|for|in|on)${S}her)${S}(?:(?<adj>[a-z]+)${S})?(?<target>${PHRASAL_KEYS})${E}`;

function phrasalNouns(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PHRASAL_NOUN)) {
    const { det, adj, target } = m.groups!;
    const key = lower(target).split(/\s+/).join(" ");
    const head = key.split(" ")[0];
    const fixes = PHRASAL_NOUNS[key];
    if (!fixes) continue;
    // "this" and "that" stand alone as pronouns: "let this warm up".
    if (/^(?:this|that)$/i.test(det) && !adj) continue;
    if (adj) {
      // An adjective, ordinal or number between: "a quick warm up", "our first informal get together".
      const entry = info(adj);
      // A noun reading ("the baby wake up") could be the subject: only plain adjectives.
      if (!PREMODIFIER.test(adj) && (!entry || !entry.adjective || entry.noun || entry.plural))
        continue;
    }
    const next = nextWord(ctx, m.index + m[0].length);
    if (OBJECT.test(next)) continue;
    // "a break out of jail": "break out" takes its noun only as a modifier.
    if ((NOUN_HEADS.has(head) || key === "break out") && !strictNoun(next)) continue;
    if (ARTICLE_HEADS.has(head) && !/^(?:an?|the)$/i.test(det)) continue;
    const finding = found(ctx, m, fixes);
    if (finding) findings.push(finding);
  }
  // Plurals have no verb reading: "two warm ups", "the kick offs".
  for (const m of frameMatches(ctx, PHRASAL_PLURAL)) {
    const [verb, particles] = lower(m.groups!.target).split(/\s+/);
    const singular = PHRASAL_NOUNS[`${verb} ${particles.slice(0, -1)}`];
    if (!singular) continue;
    const finding = found(
      ctx,
      m,
      singular.map((fix) => `${fix}s`),
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

// Compound verbs written open in a verb slot: "we will peer review it" -> "peer-review".
const COMPOUND_VERBS: readonly (readonly [string, string])[] = [
  ["peer review", "peer-review"],
  ["day trade", "day-trade"],
  ["role play", "role-play"],
  ["roller skate", "roller-skate"],
  ["strong arm", "strong-arm"],
  ["dead lift", "deadlift"],
  ["guilt trip", "guilt-trip"],
  ["daisy chain", "daisy-chain"],
  ["green light", "green-light"],
  ["fund raise", "fundraise"],
  ["problem solve", "problem-solve"],
  ["hand write", "handwrite"],
  ["hand deliver", "hand-deliver"],
  ["hand stitch", "hand-stitch"],
  ["hand craft", "handcraft"],
  ["hand pick", "handpick"],
  ["fine tune", "fine-tune"],
  ["cross check", "cross-check"],
  ["spot check", "spot-check"],
  ["fact check", "fact-check"],
  ["kick start", "kick-start"],
  ["jump start", "jump-start"],
  ["force feed", "force-feed"],
  ["spoon feed", "spoon-feed"],
  ["drop ship", "drop-ship"],
  ["sleep walk", "sleepwalk"],
  ["day dream", "daydream"],
  ["guest edit", "guest-edit"],
  ["test drive", "test-drive"],
  ["back fill", "backfill"],
  ["baby sit", "babysit"],
  ["sky dive", "skydive"],
  ["deep fry", "deep-fry"],
  ["stir fry", "stir-fry"],
  ["cherry pick", "cherry-pick"],
  ["mass produce", "mass-produce"],
  ["short change", "shortchange"],
  ["sweet talk", "sweet-talk"],
  ["spell check", "spell-check"],
  ["brain storm", "brainstorm"],
  ["bench press", "bench-press"],
  ["pressure wash", "pressure-wash"],
  ["power wash", "power-wash"],
];
type VerbForm = "base" | "third" | "past" | "ing";
/** Every form of every compound: typed lowercase "a b" -> [joined, form]. */
const VERB_FORMS = new Map<string, readonly [string, VerbForm]>();
for (const [typed, joined] of COMPOUND_VERBS) {
  const [first, second] = typed.split(" ");
  const sep = joined.includes("-") ? "-" : "";
  VERB_FORMS.set(typed, [joined, "base"]);
  // "green lighted" beside the irregular "green lit".
  if (second === "light") VERB_FORMS.set(`${first} lighted`, [`${first}${sep}lighted`, "past"]);
  for (const form of ["third", "past", "ing"] as const) {
    const inflected = englishInflect(second, form);
    if (inflected) VERB_FORMS.set(`${first} ${inflected}`, [`${first}${sep}${inflected}`, form]);
  }
}
const VERB_KEYS = [...VERB_FORMS.keys()]
  .sort((a, b) => b.length - a.length)
  .map((key) => key.replace(" ", S))
  .join("|");
const ADVERB = `(?:(?:always|never|often|usually|just|also|really|sometimes|then|still|already|even|not|please|yet)${S})?`;
const CLAUSE =
  '(?<=(?:^|[.!?;:,(\\n]|\\b(?:and|but|or|so|that|if|when|because|then))[ \\t\\u00a0"“]{0,8})';
const SLOT =
  `(?:(?<modal>will|would|can|could|should|must|might|may|shall|cannot|can['’]t|won['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t|don['’]t|didn['’]t|doesn['’]t|do${S}not|did${S}not|does${S}not|let['’]s|please|to)` +
  `|(?<asked>(?:can|could|would|will|should|shall|do|did|does)${S}(?:I|you|we|they|he|she))` +
  `|${CLAUSE}(?<subject>I|you|we|they|he|she)` +
  `|(?<have>have|has|had|(?:I|you|we|they)['’](?:ve|d))` +
  `|(?<be>am|is|are|was|were|be|been|point|(?:I|you|we|they|he|she)['’](?:m|re|s)))`;
const COMPOUND_VERB = `(?=\\p{L})${SLOT}${S}${ADVERB}(?<target>${VERB_KEYS})${E}`;
// Words after "to" that make the compound a verb with an object: "to peer review your work".
const TO_OBJECT =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|me|him|us|them|it|you|everything|something|anything|someone|everyone|today|tomorrow|now|again|yet|before|online|myself|yourself|himself|herself|ourselves|themselves)$/i;

function compoundVerbs(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, COMPOUND_VERB)) {
    const { modal, asked, subject, have, be, target } = m.groups!;
    const entry = VERB_FORMS.get(lower(target).split(/\s+/).join(" "));
    if (!entry) continue;
    const [joined, form] = entry;
    const third = /^(?:he|she)$/i.test(subject ?? "");
    const ok =
      modal || asked
        ? form === "base"
        : subject
          ? form === "past" || form === (third ? "third" : "base")
          : have
            ? form === "past"
            : be
              ? form === "ing"
              : false;
    if (!ok) continue;
    const next = nextWord(ctx, m.index + m[0].length);
    if (/^to$/i.test(modal ?? "") && !TO_OBJECT.test(next) && !/^\p{N}/u.test(next)) continue;
    // "I peer review comments": a noun after the subject's compound is a noun phrase.
    if (subject && form !== "past" && next && !TO_OBJECT.test(next)) {
      const known = info(next);
      if (known && (known.noun || known.plural) && !known.adverb) continue;
    }
    const finding = found(ctx, m, [joined], "englishClosedCompounds", "review_msg_closed_compound");
    if (finding) findings.push(finding);
  }
  return findings;
}

// Modifiers hyphenated before a noun; a noun must follow (or a determiner precede).
const NOUN_MODIFIERS = [
  "low cost",
  "high end",
  "low end",
  "top down",
  "bottom up",
  "open plan",
  "true crime",
  "late term",
  "same sex",
  "prime time",
  "on off",
  "no haggle",
  "no fault",
  "note taking",
  "decision making",
  "read only",
  "make or break",
  "out of pocket",
  "logged in",
  "mail in",
  "on screen",
  "on page",
  "all you can eat",
  "week long",
  "day long",
  "month long",
  "year long",
  "hour long",
  "week over week",
  "month over month",
  "year over year",
  "quarter over quarter",
  "hands free",
  "high speed",
  "full time",
  "part time",
  "two thirds",
  "one third",
  "three quarters",
  "one quarter",
];
const MODIFIER_KEYS = alternation(NOUN_MODIFIERS);
// Modifiers after an article or possessive: "the end to end trip", "your go to person".
const ARTICLE_MODIFIERS: Record<string, string> = Object.fromEntries(
  (
    "end to end|day to day|month to month|year to year|step by step|door to door|face to face|" +
    "head to head|back to back|peer to peer|person to person|point to point|one to one|" +
    "one to many|many to many|up to date|state of the art|straight up|for profit|" +
    "not for profit|much needed|long awaited|long established|long standing|long lasting|" +
    "short lived|long lived|life changing|life saving|life threatening|time consuming|" +
    "mind blowing|eye catching|record breaking|award winning|best selling|fast growing|" +
    "never ending|so called|all knowing|all seeing|all powerful|all inclusive|" +
    "all encompassing|all natural|all new|go to|go to market|easy to use|easy to understand|" +
    "easy to read|easy to learn|easy to install|easy to follow|simple to use|hard to find|" +
    "hard to use|difficult to use|ready to use|all time|million dollar|billion dollar|" +
    "multi million dollar|second largest|third largest|fourth largest|fifth largest|" +
    "second biggest|third biggest|second highest|second best|third best|" +
    "out of the way|out of the box|out of place|off the shelf|one of a kind|last minute|" +
    "long term|short term|well known|high quality|low cost|real time|open source|first class|" +
    "second hand|full scale|large scale|small scale|world class|top notch|high level|" +
    "low level|high end|low end|old fashioned|user friendly|above mentioned|" +
    "tailor made|even handed|read only|ill advised|well meaning|well established|" +
    "brand new|first hand|duty free|tax free|heavy duty|cut throat|do or die|wall to wall|" +
    "coast to coast|out of body|rags to riches|mom and pop|hand to hand|fly by night|" +
    "card carrying|cooling off|cut and paste|bug eyed|dual purpose|knife edge|follow on|" +
    "new look|down and out|brick red|full time|part time|open ended|hard working|" +
    "good looking|middle aged|left handed|right handed|long distance|long range|short range|" +
    "high speed|high risk|low risk|last ditch|far reaching|single use"
  )
    .split("|")
    .map((key) => [key, key.replaceAll(" ", "-")]),
);
ARTICLE_MODIFIERS["life long"] = "lifelong";
ARTICLE_MODIFIERS["under cover"] = "undercover";
ARTICLE_MODIFIERS["out going"] = "outgoing";
ARTICLE_MODIFIERS["on board"] = "onboard";
// Compound nouns that may also close the phrase: "a one off", "a know it all".
const ARTICLE_NOUNS: Record<string, string> = Object.fromEntries(
  "all in one|one off|catch all|know it all|do it yourself|drive through|about face|post it|zero day|no go|hands on"
    .split("|")
    .map((key) => [key, key.replaceAll(" ", "-")]),
);
Object.assign(ARTICLE_NOUNS, {
  "home work": "homework",
  "drive way": "driveway",
  "check box": "checkbox",
  "over use": "overuse",
});
const MODIFIER = `(?=\\p{L})(?<target>${MODIFIER_KEYS})${E}`;
const DETERMINER =
  "a|an|the|my|your|his|her|our|their|its|this|these|those|some|any|every|each|another|very|more|most|best|(?!(?:let|it|that|there|what|he|she|who|here|where)['’]s)\\p{L}+['’]s";
const ARTICLE_MODIFIER = `(?<det>${DETERMINER})${S}(?<target>${alternation([
  ...Object.keys(ARTICLE_MODIFIERS),
  ...Object.keys(ARTICLE_NOUNS),
])})${E}`;
const NOT_NOUN =
  /^(?:of|to|in|on|at|for|from|with|by|and|or|but|is|are|was|were|be|been|has|have|had|will|would|can|could|may|might|must|shall|should|it|this|that|there|then|than|as|so|very|too|now|here|again|also|not|before|after|the|a|an|zone|zones|frame|frames|line|lines|limit|limits|slot|slots|stamp|stamps|span|travel)$/i;

const hyphenate = (typed: string) => lower(typed).split(/\s+/).join("-");
/** A noun or adjective (or an unknown word) heads the phrase after a modifier. */
function isNounNext(next: string): boolean {
  if (!next || NOT_NOUN.test(next) || OBJECT.test(next) || /^\p{N}/u.test(next)) return false;
  if (/^["“'‘]/u.test(next)) return true;
  const entry = info(next);
  return !entry || entry.noun || entry.plural || entry.adjective;
}
/**
 * A lowercase noun, not an adverb or adjective ("the sign up form", "a stand up comedian"); a
 * long word the lexicon leaves out counts as a noun.
 */
function strictNoun(next: string): boolean {
  if (!isNounNext(next) || !/^\p{Ll}/u.test(next)) return false;
  const entry = info(next);
  if (!entry) return /^[a-z]{6,}$/.test(next);
  return (entry.noun || entry.plural) && !entry.adverb && !(entry.adjective && !entry.plural);
}
/** "Prime Time Wrestling", "Part Time Lord": a capital after the first word is a title. */
const titled = (typed: string) => /\s\p{Lu}/u.test(typed);

function modifiers(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  const add = (m: RegExpExecArray, fix: string) => {
    if (titled(m.groups!.target)) return;
    const finding = found(ctx, m, [fix], "englishClosedCompounds", "review_msg_closed_compound");
    if (finding) findings.push(finding);
  };
  for (const m of frameMatches(ctx, MODIFIER)) {
    const next = nextWord(ctx, m.index + m[0].length);
    if (!isNounNext(next)) continue;
    // "I read only the first page": a verb reading after "read only"; "raise your right hand
    // high" keeps the hand.
    if (/^read/i.test(m.groups!.target) && info(next)?.verbs.length) continue;
    add(m, hyphenate(m.groups!.target));
  }
  for (const m of frameMatches(ctx, ARTICLE_MODIFIER)) {
    const key = lower(m.groups!.target).split(/\s+/).join(" ");
    const next = nextWord(ctx, m.index + m[0].length);
    const noun = ARTICLE_NOUNS[key];
    // "so called because", "the state of the art.": a modifier needs its noun.
    // "an easy to use, friendly tool": a comma between two modifiers.
    const listed =
      /^(?:easy|simple|hard|difficult)/i.test(key) && ctx.text[m.index + m[0].length] === ",";
    if (noun ? OBJECT.test(next) : !isNounNext(next) && !listed) continue;
    // "the state of the art deals with": a verb may follow the noun phrase instead.
    if (!noun && info(next)?.verbs.some((v) => v.form === "third")) continue;
    // "very hands on" is the adjective; "very" before another compound noun is not.
    if (noun && /^(?:very|more|most|best)$/i.test(m.groups!.det) && key !== "hands on") continue;
    // "the all time" after "of" is "of all time"; "all the hands on deck" names hands.
    if (key === "all time" && !isNounNext(next)) continue;
    add(m, noun ?? ARTICLE_MODIFIERS[key]);
  }
  return findings;
}

// Prefixes that are hyphenated before their word: "quasi judicial", "mid thirties", "pre 1995".
const PREFIXED = `(?<target>(?<prefix>quasi|mid|pre|post|anti)${S}(?<word>[\\p{L}\\p{N}]+))${E}`;
const EX_PEOPLE =
  "president|presidents|wife|wives|husband|husbands|boyfriend|boyfriends|girlfriend|girlfriends|partner|partners|employee|employees|member|members|colleague|colleagues|boss|convict|convicts|smoker|smokers|minister|ministers|soldier|soldiers|spouse|spouses|champion";
const EX = `(?<target>ex${S}(?:${EX_PEOPLE}))${E}`;

const PREFIX_WORDS: Record<string, RegExp> = {
  quasi: /^[a-z]{4,}$/,
  mid: /^(?:1[0-9]{3}s?|20[0-9]{2}s?|[0-9]{2}s|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|teens|century|season|week|month|year|morning|afternoon|evening|sentence|air|flight|game|range|size|level|term|life|career|race|summer|winter|spring|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)$/i,
  pre: /^(?:1[0-9]{3}|20[0-9]{2})s?$/,
  post: /^(?:1[0-9]{3}|20[0-9]{2})s?$/,
  anti: /^\p{Lu}\p{Ll}{3,}$/u,
};

function prefixes(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PREFIXED)) {
    const prefix = lower(m.groups!.prefix);
    const word = m.groups!.word;
    if (!PREFIX_WORDS[prefix]?.test(word)) continue;
    const typed = m.groups!.target;
    const [start, end] = group(m, "target");
    if (hasUserOrCasedWord(ctx, `${prefix} ${/^\p{Lu}/u.test(word) ? "" : word}`)) continue;
    findings.push({
      ruleId: "englishClosedCompounds",
      messageKey: "review_msg_closed_compound",
      range: { start, end },
      alternatives: [`${typed.slice(0, prefix.length)}-${word}`],
      context: { start: Math.max(0, m.index - 24), end: Math.min(ctx.text.length, end + 24) },
    });
  }
  for (const m of frameMatches(ctx, EX)) {
    const finding = found(
      ctx,
      m,
      [hyphenate(m.groups!.target)],
      "englishClosedCompounds",
      "review_msg_closed_compound",
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

// Numbers and units joined before a noun: "a 10 page report", "a two year old car".
const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|single|multi";
const UNITS =
  "day|week|month|year|hour|minute|second|mile|page|step|point|word|character|paragraph|digit|letter|bit|byte|room|bedroom|bath|bathroom|door|story|storey|floor|season|figure|cylinder|car|degree|piece|karat|carat|wheel|course|inch|foot|meter|metre|yard|seat|person|man|member|player|lane|line|part|stage|level|track|game|hole|star|speed|gallon|liter|litre|pound|ounce|ton|watt|volt|megapixel|headed|sided|legged|wheeled|engined|factor|family";
const NUMBER = `(?<n>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\\.[0-9]+)?|${NUMBER_WORDS})`;
const NUMBER_UNIT = `(?<![\\p{N}.,/])(?<target>${NUMBER}${S}(?<unit>${UNITS})(?:${S}(?<old>old)(?<olds>s)?|-(?<hold>old)(?<holds>s)?)?)(?=${S}(?<next>[\\p{L}\\p{N}]+)|[ \\t\\u00a0]*(?<end>[.,;:!?)]|$))`;
const AGE_ONLY = `(?<![\\p{N}.,/])(?<target>(?<n>[0-9]+|${NUMBER_WORDS})-(?<unit>year|month|week|day)${S}(?<old>old)(?<olds>s)?)${E}`;
const NOT_A_HEAD =
  /^(?:ago|old|olds|later|earlier|before|after|of|and|or|to|in|on|at|for|from|with|by|per|each|is|was|are|were|left|long|away|late|early|off|behind|ahead|apart|tall|high|wide|deep|thick|away|younger|older|more|less|than|time|times|out|into|over|back|down|up|running|straight|old|this|that|the|a|an|it|he|she|we|they|you|i|there|here|now|then|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand)$/i;

const STEP_KIN =
  /^(?:daughters?|sons?|mothers?|fathers?|sisters?|brothers?|child|children|kids?|parents?|dads?|moms?|mums?|siblings?)$/i;

function numberUnits(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, NUMBER_UNIT)) {
    const { n, unit, old, olds, hold, holds, next } = m.groups!;
    const aged = old ?? hold;
    const plural = olds ?? holds;
    // "the Seven Mile Beach", "2018 Year-End": a capitalized unit is part of a name.
    if (/^\p{Lu}/u.test(unit)) continue;
    if (aged) {
      // "a two year old car", "the two year olds"; "is two years old" has a plural unit.
      if (!plural && !isNounNext(next ?? "")) continue;
    } else {
      // "a 3 day course": the older digit frame shares plain numbers with its units; the
      // same edit from both is shown once.
      // "one hour" is a duration far more often than a modifier.
      if (/^(?:1|one)$/i.test(n)) continue;
      if (!isNounNext(next ?? "") || NOT_A_HEAD.test(next ?? "")) continue;
      // "my 2 step daughters": a count of stepchildren, not a two-step one.
      if (unit === "step" && STEP_KIN.test(next ?? "")) continue;
      // "exceeded 100,000 page edits", "over 100,000 day trip passengers": a large count
      // needs "a" or "the" to be a modifier ("an over 5,000 year history").
      if (
        /^[0-9,]{4,}$/.test(n) &&
        !/\b(?:a|an|the)[ \t\u00a0]+(?:(?:over|under|nearly|almost|about)[ \t\u00a0]+)?$/i.test(
          ctx.text.slice(Math.max(0, m.index - 16), m.index),
        )
      )
        continue;
      if (/^\p{Lu}/u.test(next ?? "") && info(next) === null) continue;
    }
    const [start, end] = group(m, "target");
    const typed = ctx.text.slice(start, end);
    if (hasUserOrCasedWord(ctx, typed.replace(/[0-9,.]+/g, ""))) continue;
    findings.push({
      ruleId: "englishContextualCompounds",
      messageKey: "review_msg_compounds",
      range: { start, end },
      alternatives: [aged ? `${n}-${unit}-old${plural ?? ""}` : `${n}-${unit}`],
      context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
    });
  }
  // "a two-year old reindeer": the hyphen stops one word short.
  for (const m of frameMatches(ctx, AGE_ONLY)) {
    const { n, unit, olds } = m.groups!;
    const next = nextWord(ctx, m.index + m[0].length);
    if (!olds && !isNounNext(next)) continue;
    const finding = found(ctx, m, [`${n}-${unit}-old${olds ?? ""}`]);
    if (finding) findings.push(finding);
  }
  return findings;
}

// "May be I am wrong" opens with the adverb "maybe"; "it may be" is the verb.
const MAY_BE = `(?=may${S}be)(?:(?<=(?:^|[.!?(\\n])[ \\t\\u00a0"“]{0,8})(?<target>may${S}be)(?=${S}(?:I|we|you|he|she|they|there|his|her|my|your|our|their|someone|somebody|something|this|that|it['’]s|not)${E})|(?<=\\b(?:is|are|was|were|it['’]s|this['’]s|that['’]s)${S})(?<target2>may${S}be)(?=${S}(?:the|a|an|some|just|because|not|it|this|that|too|very|so|more|less|still|also|only|even|better|worse)${E})|(?<target3>may${S}be)(?=${S}(?:could|can|should|would|will)${E}))`;

function mayBe(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, MAY_BE, (match) => match.index)) {
    const name = m.groups!.target ? "target" : m.groups!.target2 ? "target2" : "target3";
    const [start, end] = group(m, name);
    const typed = ctx.text.slice(start, end);
    // The month opens a sentence too: "May be the warmest month" has no subject after it.
    if (hasUserOrCasedWord(ctx, typed)) continue;
    findings.push({
      ruleId: "englishContextualCompounds",
      messageKey: "review_msg_compounds",
      range: { start, end },
      alternatives: [recase(typed, "maybe")],
      context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
    });
  }
  return findings;
}

// The frames below open with a lookahead on their words: the clause lookbehinds after it then
// run only where the words are, not at every position (JavaScriptCore's regex interpreter
// would try them all).
// "an on going problem", "on going maintenance" at a sentence start; "keep on going" stays.
const ON_GOING = `(?=on${S}going)(?:(?<=\\b(?:an|the|their|our|his|her|its|my|your|this|that|any|usual|an${S})${S})|(?<=(?:^|[.!?\\n])[ \\t\\u00a0]{0,8}))(?<target>on${S}going)${E}`;
// "Does any one need help?": the pronoun before a verb, not "any one of them".
const ANY_ONE = `(?=(?:any|some)${S}one)(?<=(?:^|[.!?;\\n]|\\b(?:does|did|do|can|could|will|would|has|have|is|was|if|when|and|but)${S})[ \\t\\u00a0]{0,8})(?<target>(?<q>any|some)${S}one)${S}(?<verb>[a-z]+)${E}`;

// "sign into your account" is "sign in to"; "signed into law" is the verb with "into".
const SIGN_INTO = `(?<target>(?<verb>sign|signs|signed|signing|log|logs|logged|logging)${S}into)(?=${S}(?:your|my|his|her|our|their|the|an?)${S}(?:[\\p{L}-]+${S})?(?:accounts?|profiles?|apps?|sites?|website|portal|system|computer|e-?mail|server|dashboard|meeting|session|network|device)${E})`;
// "an American born scientist", "English speaking people".
const ORIGIN = `(?<target>(?<place>\\p{Lu}\\p{Ll}{2,})${S}(?<kind>born|speaking|based))${E}`;
// "I paid (may be) too much."
const PAREN_MAY_BE = `(?<=\\()(?<target>may${S}be)(?=\\))`;

function smallFrames(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  const add = (m: RegExpExecArray, fix: string, ruleId?: RawFinding["ruleId"]) => {
    const finding = ruleId
      ? found(ctx, m, [fix], ruleId, "review_msg_closed_compound")
      : found(ctx, m, [fix]);
    if (finding) findings.push(finding);
  };
  for (const m of frameMatches(ctx, SIGN_INTO)) add(m, `${m.groups!.verb} in to`);
  for (const m of frameMatches(ctx, ORIGIN)) {
    // "oil based paint" needs a noun before "based"; born and speaking need a name.
    const { place, kind } = m.groups!;
    if (!/^\p{Lu}/u.test(place) && (lower(kind) !== "based" || !info(place)?.noun)) continue;
    // "When Paris based its…": the place must lead a noun phrase, mid-sentence.
    if (!strictNoun(nextWord(ctx, m.index + m[0].length))) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    if (/^\s*$/.test(before) || /[.!?]\s*$/.test(before)) continue;
    add(m, `${m.groups!.place}-${lower(m.groups!.kind)}`, "englishClosedCompounds");
  }
  for (const m of frameMatches(ctx, PAREN_MAY_BE)) add(m, "maybe");
  for (const m of frameMatches(ctx, ON_GOING)) {
    const next = nextWord(ctx, m.index + m[0].length);
    if (!isNounNext(next)) continue;
    const finding = found(ctx, m, ["ongoing"]);
    if (finding) findings.push(finding);
  }
  for (const m of frameMatches(ctx, ANY_ONE)) {
    const verb = m.groups!.verb;
    const entry = info(verb);
    if (!entry || verb === "of" || !entry.verbs.length) continue;
    if (entry.noun && !entry.verbs.some((v) => v.form === "third" || v.form === "base")) continue;
    // "any one person": a noun-only word after it is the numeral.
    if (entry.verbs.every((v) => v.form === "ing")) continue;
    const finding = found(ctx, m, [`${lower(m.groups!.q)}one`]);
    if (finding) findings.push(finding);
  }
  return findings;
}

function detect(ctx: DetectContext): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  const findings: Finding[] = [];
  const closed = !ctx.rules || ctx.rules.has("englishClosedCompounds");
  const contextual = !ctx.rules || ctx.rules.has("englishContextualCompounds");
  if (contextual)
    findings.push(...phrasalNouns(ctx), ...numberUnits(ctx), ...mayBe(ctx), ...smallFrames(ctx));
  if (closed) findings.push(...compoundVerbs(ctx), ...modifiers(ctx), ...prefixes(ctx));
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishClosedCompounds", "englishContextualCompounds"], detect },
];
