import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { group, hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { table } from "./tables";

// Open, closed and hyphenated compounds: rows for forms that are never right written apart,
// and slot frames for the ones that are a phrase in one position and a compound in another.

export const COMPOUNDS = table("compoundForms.compounds");

// ---------------------------------------------------------------------------- frames

type Finding = RawFinding;
const lower = (word: string | undefined) => (word ?? "").toLowerCase();
const info = (word: string | undefined) => (word ? englishWordInfo(lower(word)) : null);
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t\u00a0]{1,8}(["“]?[\p{L}\p{N}][\p{L}\p{N}'’-]*)/u.exec(
    ctx.text.slice(end, end + 48),
  )?.[1] ?? "";
// A determiner, possessive or object pronoun after a particle makes it a preposition with its
// own object: "the walk through the park", "a hand over his mouth".
const OBJECT =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|me|him|us|them|it|you|some|any|every|each|all|no|one|two|three|other|another|more|less)$/i;

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
  const cased = alternatives.map((alt) => carryCase(typed, alt));
  if (cased.includes(typed)) return null;
  return finding(ruleId, messageKey, start, end, cased, {
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    context: {
      start: Math.max(0, m.index - 24),
      end: Math.min(ctx.text.length, m.index + m[0].length + 24),
    },
  });
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
const PREMODIFIER =
  /^(?:first|second|third|final|last|next|quick|big|small|major|minor|huge|brief|daily|weekly|monthly|annual|usual|regular|complete|full|proper|good|great|real|official|early|late|short|long|new|old|initial|informal|formal|official|massive|total)$/i;

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
// Words after "to" that make the compound a verb with an object: "to peer review your work".
const TO_OBJECT =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|me|him|us|them|it|you|everything|something|anything|someone|everyone|today|tomorrow|now|again|yet|before|online|myself|yourself|himself|herself|ourselves|themselves)$/i;

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

// Prefixes that are hyphenated before their word: "quasi judicial", "mid thirties", "pre 1995".
const PREFIX_WORDS: Record<string, RegExp> = {
  quasi: /^[a-z]{4,}$/,
  mid: /^(?:1[0-9]{3}s?|20[0-9]{2}s?|[0-9]{2}s|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|teens|century|season|week|month|year|morning|afternoon|evening|sentence|air|flight|game|range|size|level|term|life|career|race|summer|winter|spring|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)$/i,
  pre: /^(?:1[0-9]{3}|20[0-9]{2})s?$/,
  post: /^(?:1[0-9]{3}|20[0-9]{2})s?$/,
  anti: /^\p{Lu}\p{Ll}{3,}$/u,
};

// Numbers and units joined before a noun: "a 10 page report", "a two year old car".
const NOT_A_HEAD =
  /^(?:ago|old|olds|later|earlier|before|after|of|and|or|to|in|on|at|for|from|with|by|per|each|is|was|are|were|left|long|away|late|early|off|behind|ahead|apart|tall|high|wide|deep|thick|away|younger|older|more|less|than|time|times|out|into|over|back|down|up|running|straight|old|this|that|the|a|an|it|he|she|we|they|you|i|there|here|now|then|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand)$/i;

const STEP_KIN =
  /^(?:daughters?|sons?|mothers?|fathers?|sisters?|brothers?|child|children|kids?|parents?|dads?|moms?|mums?|siblings?)$/i;

const closed = (ctx: DetectContext, m: RegExpExecArray, fix: string) =>
  found(ctx, m, [fix], "englishClosedCompounds", "review_msg_closed_compound");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  compoundPhrasalNoun: (m, ctx) => {
    const { det, adj, target } = m.groups!;
    const key = lower(target).split(/\s+/).join(" ");
    const head = key.split(" ")[0];
    const fixes = PHRASAL_NOUNS[key];
    if (!fixes) return null;
    // "this" and "that" stand alone as pronouns: "let this warm up".
    if (/^(?:this|that)$/i.test(det) && !adj) return null;
    if (adj) {
      // An adjective, ordinal or number between: "a quick warm up", "our first informal get together".
      const entry = info(adj);
      // A noun reading ("the baby wake up") could be the subject: only plain adjectives.
      if (!PREMODIFIER.test(adj) && (!entry || !entry.adjective || entry.noun || entry.plural))
        return null;
    }
    const next = nextWord(ctx, m.index + m[0].length);
    if (OBJECT.test(next)) return null;
    // "a break out of jail": "break out" takes its noun only as a modifier.
    if ((NOUN_HEADS.has(head) || key === "break out") && !strictNoun(next)) return null;
    if (ARTICLE_HEADS.has(head) && !/^(?:an?|the)$/i.test(det)) return null;
    return found(ctx, m, fixes);
  },
  compoundPhrasalPlural: (m, ctx) => {
    const [verb, particles] = lower(m.groups!.target).split(/\s+/);
    const singular = PHRASAL_NOUNS[`${verb} ${particles.slice(0, -1)}`];
    if (!singular) return null;
    return found(
      ctx,
      m,
      singular.map((fix) => `${fix}s`),
    );
  },
  compoundNumberUnit: (m, ctx) => {
    const { n, unit, old, olds, hold, holds, next } = m.groups!;
    const aged = old ?? hold;
    const plural = olds ?? holds;
    // "the Seven Mile Beach", "2018 Year-End": a capitalized unit is part of a name.
    if (/^\p{Lu}/u.test(unit)) return null;
    if (aged) {
      // "a two year old car", "the two year olds"; "is two years old" has a plural unit.
      if (!plural && !isNounNext(next ?? "")) return null;
    } else {
      // "a 3 day course": the older digit frame shares plain numbers with its units; the
      // same edit from both is shown once.
      // "one hour" is a duration far more often than a modifier, unless "a" or a possessive
      // owns it ("Tom's one hour workout"; "the 1 person rowing" counts). After "a", a count +
      // unit is always a modifier, even before an -ing word ("a 35 hour working week").
      const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
      const determined = /(?:\b(?:a|an|my|your|his|her|our|their|its)|['’]s)[ \t\u00a0]+$/i.test(
        before,
      );
      if (/^(?:1|one)$/i.test(n) && !determined) return null;
      const article = /\b(?:a|an)[ \t\u00a0]+$/i.test(before);
      if (!next || NOT_A_HEAD.test(next) || (!isNounNext(next) && !article)) return null;
      // "my 2 step daughters": a count of stepchildren, not a two-step one.
      if (unit === "step" && STEP_KIN.test(next ?? "")) return null;
      // "exceeded 100,000 page edits", "over 100,000 day trip passengers": a large count
      // needs "a" or "the" to be a modifier ("an over 5,000 year history").
      if (
        /^[0-9,]{4,}$/.test(n) &&
        !/\b(?:a|an|the)[ \t\u00a0]+(?:(?:over|under|nearly|almost|about)[ \t\u00a0]+)?$/i.test(
          ctx.text.slice(Math.max(0, m.index - 16), m.index),
        )
      )
        return null;
      if (/^\p{Lu}/u.test(next ?? "") && info(next) === null) return null;
    }
    const [start, end] = group(m, "target");
    const typed = ctx.text.slice(start, end);
    if (hasUserOrCasedWord(ctx, typed.replace(/[0-9,.]+/g, ""))) return null;
    return {
      ruleId: "englishContextualCompounds",
      messageKey: "review_msg_compounds",
      range: { start, end },
      alternatives: [aged ? `${n}-${unit}-old${plural ?? ""}` : `${n}-${unit}`],
      context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
    };
  },
  compoundAgeOnly: (m, ctx) => {
    const { n, unit, olds } = m.groups!;
    const next = nextWord(ctx, m.index + m[0].length);
    if (!olds && !isNounNext(next)) return null;
    return found(ctx, m, [`${n}-${unit}-old${olds ?? ""}`]);
  },
  compoundMayBe: (m, ctx) => {
    // The match owns its finding where it starts.
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const name = m.groups!.target ? "target" : m.groups!.target2 ? "target2" : "target3";
    const [start, end] = group(m, name);
    const typed = ctx.text.slice(start, end);
    // The month opens a sentence too: "May be the warmest month" has no subject after it.
    if (hasUserOrCasedWord(ctx, typed)) return null;
    return {
      ruleId: "englishContextualCompounds",
      messageKey: "review_msg_compounds",
      range: { start, end },
      alternatives: [carryCase(typed, "maybe")],
      context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
    };
  },
  compoundSignInto: (m, ctx) => found(ctx, m, [`${m.groups!.verb} in to`]),
  compoundOrigin: (m, ctx) => {
    // "oil based paint" needs a noun before "based"; born and speaking need a name.
    const { place, kind } = m.groups!;
    if (!/^\p{Lu}/u.test(place) && (lower(kind) !== "based" || !info(place)?.noun)) return null;
    // "When Paris based its…": the place must lead a noun phrase, mid-sentence.
    if (!strictNoun(nextWord(ctx, m.index + m[0].length))) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
    if (/^\s*$/.test(before) || /[.!?]\s*$/.test(before)) return null;
    return closed(ctx, m, `${place}-${lower(kind)}`);
  },
  compoundParenMaybe: (m, ctx) => found(ctx, m, ["maybe"]),
  compoundOnGoing: (m, ctx) =>
    isNounNext(nextWord(ctx, m.index + m[0].length)) ? found(ctx, m, ["ongoing"]) : null,
  compoundAnyOne: (m, ctx) => {
    const verb = m.groups!.verb;
    const entry = info(verb);
    if (!entry || verb === "of" || !entry.verbs.length) return null;
    if (entry.noun && !entry.verbs.some((v) => v.form === "third" || v.form === "base"))
      return null;
    // "any one person": a noun-only word after it is the numeral.
    if (entry.verbs.every((v) => v.form === "ing")) return null;
    return found(ctx, m, [`${lower(m.groups!.q)}one`]);
  },
  compoundVerb: (m, ctx) => {
    const { modal, asked, subject, have, be, target } = m.groups!;
    const entry = VERB_FORMS.get(lower(target).split(/\s+/).join(" "));
    if (!entry) return null;
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
    if (!ok) return null;
    const next = nextWord(ctx, m.index + m[0].length);
    if (/^to$/i.test(modal ?? "") && !TO_OBJECT.test(next) && !/^\p{N}/u.test(next)) return null;
    // "I peer review comments": a noun after the subject's compound is a noun phrase.
    if (subject && form !== "past" && next && !TO_OBJECT.test(next)) {
      const known = info(next);
      if (known && (known.noun || known.plural) && !known.adverb) return null;
    }
    return closed(ctx, m, joined);
  },
  compoundNounModifier: (m, ctx) => {
    const next = nextWord(ctx, m.index + m[0].length);
    if (!isNounNext(next)) return null;
    // "I read only the first page": a verb reading after "read only"; "raise your right hand
    // high" keeps the hand.
    if (/^read/i.test(m.groups!.target) && info(next)?.verbs.length) return null;
    return titled(m.groups!.target) ? null : closed(ctx, m, hyphenate(m.groups!.target));
  },
  compoundArticleModifier: (m, ctx) => {
    const key = lower(m.groups!.target).split(/\s+/).join(" ");
    const next = nextWord(ctx, m.index + m[0].length);
    const noun = ARTICLE_NOUNS[key];
    // "so called because", "the state of the art.": a modifier needs its noun.
    // "an easy to use, friendly tool": a comma between two modifiers.
    const listed =
      /^(?:easy|simple|hard|difficult)/i.test(key) && ctx.text[m.index + m[0].length] === ",";
    if (noun ? OBJECT.test(next) : !isNounNext(next) && !listed) return null;
    // "the state of the art deals with": a verb may follow the noun phrase instead.
    if (!noun && info(next)?.verbs.some((v) => v.form === "third")) return null;
    // "very hands on" is the adjective; "very" before another compound noun is not.
    if (noun && /^(?:very|more|most|best)$/i.test(m.groups!.det) && key !== "hands on") return null;
    // "the all time" after "of" is "of all time"; "all the hands on deck" names hands.
    if (key === "all time" && !isNounNext(next)) return null;
    return titled(m.groups!.target) ? null : closed(ctx, m, noun ?? ARTICLE_MODIFIERS[key]);
  },
  compoundPrefixed: (m, ctx) => {
    const prefix = lower(m.groups!.prefix);
    const word = m.groups!.word;
    if (!PREFIX_WORDS[prefix]?.test(word)) return null;
    const typed = m.groups!.target;
    const [start, end] = group(m, "target");
    if (hasUserOrCasedWord(ctx, `${prefix} ${/^\p{Lu}/u.test(word) ? "" : word}`)) return null;
    return {
      ruleId: "englishClosedCompounds",
      messageKey: "review_msg_closed_compound",
      range: { start, end },
      alternatives: [`${typed.slice(0, prefix.length)}-${word}`],
      context: { start: Math.max(0, m.index - 24), end: Math.min(ctx.text.length, end + 24) },
    };
  },
  compoundExPartner: (m, ctx) => closed(ctx, m, hyphenate(m.groups!.target)),
} satisfies Record<string, MatchFixer>;
