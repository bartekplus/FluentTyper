import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { COMPOUND, frameDetector, type Frame, type Rule } from "./idioms5";
import { afterBreak, nounOnly } from "./slotWords";

// Prepositions a word or a verb with its object takes: "suffering of" (from), "anxious of"
// (about), "accused him for lying" (of), "participate to" (in), "arrived on the beach" (at),
// "came in the house" (into), "ask to the user" (ask the user), "a trip in Paris" (to).

const PREPOSITION: Rule = {
  ruleId: "englishFixedPrepositions",
  messageKey: "review_msg_fixed_prepositions",
};
const PRONOUN = "(?:me|you|him|her|us|them|it)";
const MONTHS =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

export const PHRASES: readonly PhraseRow[] = [
  ["consider about", "consider"],
  ["considering about", "considering"],
  ["named it as", "named it"],
  [
    ["spend it for", "spent it for"],
    ["spend it on", "spent it on"],
  ],
  ["talk down about", "talk down to"],
  ["in the recent years", "in recent years"],
  ...["go", "goes", "went", "going"].map((verb): PhraseRow => [
    `${verb} to vacation`,
    `${verb} on vacation`,
  ]),
  ...["prior the", "prior my", "prior his", "prior her", "prior our", "prior their"].map(
    (typed): PhraseRow => [typed, typed.replace("prior", "prior to")],
  ),
  ...[
    "middle",
    "top left corner",
    "top right corner",
    "bottom left corner",
    "bottom right corner",
    "top-left corner",
    "top-right corner",
    "bottom-left corner",
    "bottom-right corner",
  ].map((place): PhraseRow => [`on the ${place} of`, `in the ${place} of`]),
  ...["top", "bottom"].flatMap((edge) =>
    ["screen", "page"].map((place): PhraseRow => [
      `in the ${edge} of the ${place}`,
      `at the ${edge} of the ${place}`,
    ]),
  ),
  ["it is sure that", "it is certain that"],
  ["it's sure that", "it's certain that"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const ing = (word: string) =>
  !!englishWordInfo(word.toLowerCase())?.verbs.some((v) => v.form === "ing");

const FRAMES: readonly Frame[] = [
  {
    rule: PREPOSITION,
    cue: ["suffering", "suffer", "suffers", "suffered"],
    pattern: `(?:is|are|was|were|people|patients|someone|who|those|still|be|been)${S}(?:suffering|suffer|suffered)${S}(?<target>of)${E}`,
    fix: "from",
  },
  {
    rule: PREPOSITION,
    cue: ["anxious"],
    pattern: `(?:am|is|are|was|were|be|been|feel|felt|very|so|too|getting)${S}anxious${S}(?<target>of)${E}`,
    fix: ["about", "for"],
  },
  {
    rule: PREPOSITION,
    cue: ["accused", "accuse", "accuses", "accusing"],
    pattern: `(?:accuse|accused|accuses|accusing)${S}(?:${PRONOUN}|the${S}[a-z]+|[a-z]{2,})${S}(?<target>for)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) => (ing(m.groups!.verb) ? "of" : null),
  },
  {
    rule: PREPOSITION,
    cue: ["addiction"],
    pattern: `addiction${S}(?<target>of)${S}(?<noun>drugs|alcohol|gambling|nicotine|cocaine|heroin|opioids|sugar|caffeine|social${S}media|video${S}games|smoking|food)${E}`,
    fix: "to",
  },
  {
    rule: PREPOSITION,
    cue: ["participate", "participates", "participated", "participating"],
    pattern: `(?:participate|participates|participated|participating)${S}(?<target>to)${S}(?!(?:be|see|make|help|do|get|win)${E})`,
    fix: "in",
  },
  {
    rule: PREPOSITION,
    cue: ["damage"],
    pattern: `(?:cause|causes|caused|causing|do|does|did|doing|serious|severe|lasting|permanent)${S}damage${S}(?<target>of)${E}`,
    fix: "to",
  },
  {
    rule: PREPOSITION,
    cue: ["perspective", "perspectives"],
    pattern: `(?:different|new|fresh|unique|personal|his|her|their|my|our|your)${S}perspectives?${S}(?<target>about)${E}`,
    fix: "on",
  },
  {
    rule: PREPOSITION,
    cue: ["near", "closer"],
    pattern: `(?:near|closer)${S}(?<target>from)${E}`,
    fix: "to",
  },
  {
    rule: PREPOSITION,
    cue: ["complain", "complained", "complains", "complaining"],
    pattern: `(?:complain|complained|complains|complaining)${S}(?<target>for)${S}(?:the|my|your|his|her|our|their|this|that)${E}(?!${S}(?:whole|entire|next|past|last|first|rest)${E})`,
    fix: "about",
  },
  {
    rule: PREPOSITION,
    cue: ["cure", "cured", "cures"],
    pattern: `(?:cure|cured|cures|curing)${S}(?:${PRONOUN}|the${S}patient|patients|people)${S}(?<target>from)${E}`,
    fix: "of",
  },
  {
    rule: PREPOSITION,
    cue: ["divide", "divided", "divides", "dividing"],
    pattern: `(?:divide|divided|divides|dividing)${S}(?:${PRONOUN}|the${S}[a-z]+)${S}(?<target>in)${S}(?:two|three|four|five|six|eight|ten|parts|pieces|groups|sections|halves|equal)${E}`,
    fix: "into",
  },
  {
    rule: PREPOSITION,
    cue: ["boasted", "boast", "boasts", "boasting"],
    pattern: `(?:boast|boasted|boasts|boasting)${S}(?<target>for)${S}(?:his|her|their|my|our|your|the|its)${E}`,
    fix: ["about", "of"],
  },
  // "Please ask to the user to…": ask takes its object directly.
  {
    rule: PREPOSITION,
    cue: ["ask"],
    pattern: `(?<target>ask${S}to)${S}(?:the|all|our|your|my|his|her|their|every|each)${S}(?!(?:dance|prom|party|ball|wedding|movies|cinema)${E})[a-z]+${E}`,
    fix: "ask",
  },
  // "By example, …", "On fact, …" at a clause start.
  {
    rule: PREPOSITION,
    cue: ["example", "fact"],
    pattern: `(?<target>by${S}example|on${S}fact)(?=[ \\t\\u00a0]*,)`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index)
        ? /example/i.test(m.groups!.target)
          ? "for example"
          : "in fact"
        : null,
  },
  // "their departure of New York": from a place.
  {
    rule: PREPOSITION,
    cue: ["departure"],
    pattern: `departure${S}(?<target>of)${S}(?<place>[a-z]{2,})`,
    fix: (m) => (MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place) ? null : "from"),
  },
  // "entering in the room": enter takes the room directly.
  {
    rule: PREPOSITION,
    cue: ["enter", "enters", "entered", "entering"],
    pattern: `(?:enter|enters|entered|entering)${S}(?<target>in${S})(?=(?:the|a|my|his|her|our|their)${S}(?:room|house|building|office|class|classroom|kitchen|car|shop|store|church|hall|hospital|bank|restaurant)${E})`,
    fix: "",
  },
  // "Judy came in the house": into.
  {
    rule: PREPOSITION,
    cue: ["came", "come", "comes", "walked", "ran", "went", "go", "goes", "run"],
    pattern: `(?:came|come|comes|walked|walks|ran|runs|went|goes)${S}(?<target>in)${S}the${S}(?:house|room|office|kitchen|building|shop|store|church|classroom|bedroom|bathroom|hall)${E}`,
    fix: "into",
  },
  // "arrived on the beach": at a point.
  {
    rule: PREPOSITION,
    cue: ["arrive", "arrived", "arrives", "arriving"],
    pattern: `(?:arrive|arrived|arrives|arriving)${S}(?<target>on)${S}the${S}(?:beach|station|airport|hotel|office|party|museum|school|island)${E}`,
    fix: "at",
  },
  // "arrive at the city": in a city or country.
  {
    rule: PREPOSITION,
    cue: ["arrive", "arrived", "arrives", "arriving", "arrival"],
    pattern: `(?:arrive|arrived|arrives|arriving|arrival)${S}(?<target>at|to)${S}the${S}(?:city|country|town)${E}`,
    fix: "in",
  },
  {
    rule: PREPOSITION,
    cue: ["arrival"],
    pattern: `arrival${S}(?<target>to)${S}the${S}(?:house|airport|station|hotel|office|party|scene|school)${E}`,
    fix: "at",
  },
  // "Who is in charge for this shop?": of (not "in charge for only three days").
  {
    rule: PREPOSITION,
    cue: ["charge"],
    pattern: `in${S}charge${S}(?<target>for)${S}(?:this|the|that|these|those|our|my|your|his|her|their)${E}(?!${S}(?:next|first|last|past|whole|rest)${E})`,
    fix: "of",
  },
  // "Studying grammar is difficult to me": for.
  {
    rule: PREPOSITION,
    cue: ["difficult", "hard", "easy", "impossible"],
    pattern: `(?:is|was|are|were|be|it['’]s|very|so|too|quite)${S}(?:difficult|hard|easy|impossible)${S}(?<target>to)${S}(?:me|him|her|us|them)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:to|because|since|now)${E})`,
    fix: "for",
  },
  {
    rule: PREPOSITION,
    cue: ["important"],
    pattern: `(?:is|are|was|were|be|very|so)${S}important${S}(?<target>with)${S}(?:you|me|him|her|us|them)${E}`,
    fix: "to",
  },
  // "I am waiting after her": for.
  {
    rule: PREPOSITION,
    cue: ["waiting", "wait", "waited"],
    pattern: `(?:waiting|wait|waited|waits)${S}(?<target>after)${S}(?:him|her|them|me|us|you)${E}`,
    fix: "for",
  },
  // "Anne is waiting her patient": waiting for.
  {
    rule: PREPOSITION,
    cue: ["waiting"],
    pattern: `(?:am|is|are|was|were|be|been)${S}(?<target>waiting)${S}(?:her|his|my|your|their|our)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) =>
      nounOnly(m.groups!.noun) || englishWordInfo(m.groups!.noun)?.noun ? "waiting for" : null,
  },
  {
    rule: PREPOSITION,
    cue: ["contribution", "contributions"],
    pattern: `contributions?${S}(?<target>on)${S}(?!behalf${E})`,
    fix: "to",
  },
  {
    rule: PREPOSITION,
    cue: ["analysis"],
    pattern: `analysis${S}(?<target>about)${E}`,
    fix: "of",
  },
  // "Prior leaving, he…": prior to.
  {
    rule: PREPOSITION,
    cue: ["prior"],
    pattern: `(?<target>prior)${S}(?<verb>[a-z]+ing)${E}`,
    fix: (m) => (ing(m.groups!.verb) ? "prior to" : null),
  },
  // "knocked the door": on.
  {
    rule: PREPOSITION,
    cue: ["knock", "knocks", "knocked", "knocking"],
    pattern: `(?<target>knock|knocks|knocked|knocking)${S}(?:the|his|her|their|my|our|your)${S}(?:door|window|wall|gate)${E}(?!${S}(?:down|open|off|over|in|out)${E})`,
    fix: (m) => `${m.groups!.target} on`,
  },
  // "Land reclamation is in the internet": on.
  {
    rule: PREPOSITION,
    cue: ["internet", "wikipedia", "web", "website"],
    pattern: `(?<target>in)${S}(?:the${S})?(?:internet|Wikipedia|web)${E}(?!${S}(?:age|era|world|of|industry|access|connection|cafe)${E})`,
    fix: "on",
  },
  // "located on 11056 Main Street": at an address.
  {
    rule: PREPOSITION,
    cue: ["located"],
    pattern: `located${S}(?<target>on|in)${S}[0-9]+${S}(?<street>[A-Za-z]+)`,
    fix: (m) => (/^[A-Z]/.test(m.groups!.street) ? "at" : null),
  },
  // "She comes in car", "I came to plane": by.
  {
    rule: PREPOSITION,
    cue: ["car", "plane", "train", "bus", "taxi", "bike", "boat", "ship"],
    pattern: `(?:come|comes|came|go|goes|went|travel|travels|traveled|travelled|arrive|arrives|arrived|work|get|got)(?:${S}to${S}work)?${S}(?<target>in|to|with)${S}(?:car|plane|train|bus|taxi|bike|boat|ship|subway)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:to|every|each|today|tomorrow|yesterday|and)${E})`,
    fix: "by",
  },
  // "I was on a meeting": in.
  {
    rule: PREPOSITION,
    cue: ["meeting"],
    pattern: `(?:am|is|are|was|were|be|been|['’]m|['’]re)${S}(?<target>on)${S}a${S}meeting${E}`,
    fix: "in",
  },
  // "I met her in a party": at.
  {
    rule: PREPOSITION,
    cue: ["party"],
    pattern: `(?:met|meet|saw|see|danced|was|were|be|been|drunk)${S}(?:(?:her|him|them|you|us)${S})?(?<target>in)${S}a${S}party${E}(?!${S}of${E})`,
    fix: "at",
  },
  // "I like to do soccer", "to do a meeting": after "to" or as -ing (fixedFrames owns
  // "I do soccer", "we did a meeting" after a subject).
  {
    rule: PREPOSITION,
    cue: [
      "soccer",
      "football",
      "basketball",
      "tennis",
      "baseball",
      "hockey",
      "volleyball",
      "chess",
    ],
    pattern: `(?:to${S}(?<target>do)|(?:like|love|enjoy|hate|start|started|stop|stopped|keep)${S}(?<target2>doing))${S}(?:soccer|football|basketball|tennis|baseball|hockey|volleyball|chess|golf)${E}`,
    fix: (m) => (m.groups!.target ? "play" : "playing"),
  },
  {
    rule: PREPOSITION,
    cue: ["meeting", "party"],
    pattern: `(?:to${S}(?<target>do|make)|(?:like|love|enjoy|hate|about|for|by)${S}(?<target2>doing|making))${S}a${S}(?<what>meeting|party)${E}(?!${S}(?:list|lists|planner|hat|hats|favou?rs?|room|game|games|bus|line|leader|members?|notes|minutes|agenda|invite|invites|invitation)${E})`,
    fix: (m) => {
      const party = m.groups!.what.toLowerCase() === "party";
      return m.groups!.target ? (party ? "throw" : "have") : party ? "throwing" : "having";
    },
  },
  // "Bring Suzanne at the party": to.
  {
    rule: PREPOSITION,
    cue: ["bring", "brought", "brings", "take", "took", "drove", "drive"],
    pattern: `(?:bring|brought|brings|took|take|drove|drive|driven)${S}(?:${PRONOUN}|[a-z]{2,})${S}(?<target>at|in)${S}the${S}(?:party|meeting|office|house|wedding|airport|station|hospital|hotel|school)${E}`,
    fix: "to",
  },
  // "That accounts a rise in price": accounts for.
  {
    rule: PREPOSITION,
    cue: ["accounts", "account", "accounted"],
    pattern: `(?:that|this|it|which)${S}(?<target>accounts|accounted)${S}(?:a|an|the|most|much|half|about|nearly|almost)${E}`,
    fix: (m) => `${m.groups!.target} for`,
  },
  // "The plant is at the kitchen": in a room.
  {
    rule: PREPOSITION,
    cue: ["kitchen", "bathroom", "bedroom", "garden"],
    pattern: `(?:is|are|was|were|be|it['’]s|sits|stays)${S}(?<target>at)${S}the${S}(?:kitchen|bathroom|bedroom|garden|living${S}room)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:now|today|again|and)${E})`,
    fix: "in",
  },
  // "You can apply to welfare": for a benefit; "apply for another university": to a school.
  {
    rule: PREPOSITION,
    cue: ["apply", "applied", "applies", "applying"],
    pattern: `(?:apply|applied|applies|applying)${S}(?<target>to)${S}(?:welfare|benefits|a${S}grant|a${S}loan|a${S}visa|a${S}scholarship|a${S}mortgage)${E}`,
    fix: "for",
  },
  {
    rule: PREPOSITION,
    cue: ["apply", "applied", "applies", "applying"],
    pattern: `(?:apply|applied|applies|applying)${S}(?<target>for)${S}(?:another|a|the|this|that|my|your)${S}(?:university|college|school)${E}`,
    fix: "to",
  },
  // "I eat in my desk": at.
  {
    rule: PREPOSITION,
    cue: ["desk"],
    pattern: `(?:eat|eats|ate|eating|sit|sits|sat|sitting|work|works|worked|working)${S}(?<target>in)${S}(?:my|his|her|your|our|their|the)${S}desk${E}`,
    fix: "at",
  },
  // "living in a small island": on.
  {
    rule: PREPOSITION,
    cue: ["island"],
    pattern: `(?:live|lives|lived|living|located|stranded|born|is|are)${S}(?<target>in)${S}(?:a|an|the)${S}(?:(?:small|tiny|remote|deserted|big|large|beautiful|tropical)${S})?island${E}`,
    fix: "on",
  },
  // "live in the planet Earth": on.
  {
    rule: PREPOSITION,
    cue: ["planet", "earth"],
    pattern: `(?:live|lives|lived|living|life|exist|exists)${S}(?<target>in)${S}(?:the${S}planet|planet${S}earth|earth)${E}`,
    fix: "on",
  },
  // "There is no big difference about the week and the weekend": between.
  {
    rule: PREPOSITION,
    cue: ["difference"],
    pattern: `difference${S}(?<target>about)${S}[^.!?,;\\n]{1,40}${S}and${S}`,
    fix: "between",
  },
  // "Listen to that in the album": on.
  {
    rule: PREPOSITION,
    cue: ["album"],
    pattern: `(?:song|songs|track|tracks|that|it|this)${S}(?<target>in)${S}(?:the|this|that|his|her|their|my)${S}album${E}(?!['’])`,
    fix: "on",
  },
  // "the bus that brought them in the airport": to.
  {
    rule: PREPOSITION,
    cue: ["brought", "took", "drove"],
    pattern: `(?:brought|took|drove|carried)${S}(?:them|him|her|us|me|you)${S}(?<target>in)${S}the${S}(?:airport|station|hospital|hotel|office|city)${E}`,
    fix: "to",
  },
  // "open your books at page 6": to a page.
  {
    rule: PREPOSITION,
    cue: ["page", "pages"],
    pattern: `(?:open|opened|opening)${S}(?:your|the|their|his|her|my|our)${S}(?:book|books|textbook|textbooks|notebooks?)${S}(?<target>at|on)${S}pages?${E}`,
    fix: "to",
  },
  // "returning in the office", "returning in Montreal": to.
  {
    rule: PREPOSITION,
    cue: ["return", "returned", "returning", "returns"],
    pattern: `(?:return|returns|returned|returning)${S}(?<target>in)${S}(?:the${S}(?:office|city|country|house|hotel|room|school|station)${E}|(?<place>[a-z]{2,}))`,
    fix: (m) =>
      m.groups!.place && (MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place))
        ? null
        : "to",
  },
  // "a trip in New York": to.
  {
    rule: PREPOSITION,
    cue: ["trip"],
    pattern: `(?:a|the|our|my|his|her|their|on${S}a)${S}trip${S}(?<target>in)${S}(?<place>[a-z]{2,})`,
    fix: (m) => (MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place) ? null : "to"),
  },
  // "an exception of the rule": to.
  {
    rule: PREPOSITION,
    cue: ["exception"],
    pattern: `(?:is|was|are|be|been|an)${S}exception${S}(?<target>of)${S}(?:the|this|that|our|these)${S}(?:rule|rules|guideline|guidelines|policy|law)${E}`,
    fix: "to",
  },
  // "I have 25 years old": be.
  {
    rule: PREPOSITION,
    cue: ["years", "old"],
    pattern: `(?<subject>I|he|she|we|they|you)${S}(?<target>have|has)${S}[0-9]{1,3}${S}years?${S}old${E}`,
    fix: (m) =>
      /^I$/.test(m.groups!.subject) ? "am" : /^(?:he|she)$/i.test(m.groups!.subject) ? "is" : "are",
  },
  // "non standard", "anti communist": prefixed adjectives are hyphenated.
  {
    rule: COMPOUND,
    cue: ["non", "anti"],
    pattern: `(?<!qua${S})(?<target>(?<prefix>non|anti)${S}(?!(?:new|old|compos|sequitur|grata|stop|existent)${E})(?<word>[a-z]+))${E}`,
    fix: (m) => {
      const read = englishWordInfo(m.groups!.word);
      const nonNoun =
        m.groups!.prefix.toLowerCase() === "non" && (read?.noun || !!nounOnly(m.groups!.word));
      return (read?.adjective || nonNoun) && !read?.verbs.some((v) => v.form !== "base")
        ? `${m.groups!.prefix}-${m.groups!.word}`
        : null;
    },
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishFixedPrepositions", "englishContextualCompounds"],
    detect: frameDetector(FRAMES),
  },
];
