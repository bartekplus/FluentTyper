import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { CONTEXT, frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, wordBefore } from "./slotWords";

// Real words typed for a neighbour that sounds or looks alike, each in a slot only the
// neighbour fits: "the route of the problem" (root), "walked passed the school" (past), "I
// pic the second one" (pick), "a dose not" (does), "of Asian decent" (descent).

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

const TAKE = ["take", "takes", "took", "taken", "taking"];
const KIN = ["mother", "father", "brother", "sister", "son", "daughter", "parents"];

/** Each typed form is wrong in every context. */
export const PHRASES: readonly PhraseRow[] = [
  [["route cause", "rout cause"], "root cause"],
  [["route causes", "rout causes"], "root causes"],
  ...TAKE.map((verb): PhraseRow => [`${verb} case of`, `${verb} care of`]),
  ["not ad all", "not at all"],
  [["all if a sudden", "all over sudden", "all of sudden", "all of the sudden"], "all of a sudden"],
  ["from no won", "from now on"],
  ["now worries", "no worries"],
  [["has far as", "as far has"], "as far as"],
  ["halve of", "half of"],
  [["try and error", "try-and-error"], "trial and error"],
  ["on and of", "on and off"],
  ["since than", "since then"],
  [["corral reef", "coral reaf"], "coral reef"],
  ["corral reefs", "coral reefs"],
  [["marshal art", "marital art"], "martial art"],
  [["marshal arts", "marital arts"], "martial arts"],
  [["marshal artist", "marital artist"], "martial artist"],
  ["in a sate of", "in a state of"],
  ["accept for the fact", "except for the fact"],
  [
    ["slight of hand", "slights of hand"],
    ["sleight of hand", "sleights of hand"],
  ],
  ["correct spilling", "correct spelling"],
  ["piece of advise", "piece of advice"],
  ["pieces of advise", "pieces of advice"],
  ...["sahara", "gobi", "mojave", "kalahari", "atacama", "sonoran", "arabian"].map(
    (name): PhraseRow => [`${name} dessert`, `${name} desert`],
  ),
  ...["blood", "food", "air", "water", "vector", "insect"].flatMap((source): PhraseRow[] => [
    [[`${source} born`, `${source}-born`, `${source}born`], `${source}borne`],
  ]),
  ...KIN.flatMap((kin): PhraseRow[] => [[[`${kin}-in-low`, `${kin} in low`], `${kin}-in-law`]]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
/** A base verb with no noun or adjective reading: "write", "learn", "clarify". */
const plainBase = (word: string) => {
  const r = read(word);
  return (
    !!r?.verbs.some((v) => v.form === "base" && v.lemma === word.toLowerCase()) &&
    !r.noun &&
    !r.plural &&
    !r.adjective &&
    !FUNCTION_WORDS.has(word.toLowerCase())
  );
};
const OBJECT =
  "(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|it|them|him|me|us|one|up|out)";
const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const FRAMES: readonly Frame[] = [
  // "The route of the problem is unknown": root (a title keeps its capitals).
  {
    rule: CONFUSED,
    cue: ["route", "routes"],
    pattern: `(?<![\\p{L}'’])(?<target>routes?)${S}of${S}the${S}problems?${E}`,
    fix: (m) =>
      // Only the first letter may be a capital.
      m[0].slice(1) === m[0].slice(1).toLowerCase()
        ? m.groups!.target.replace(/oute/i, "oot")
        : null,
  },
  // "I walked passed the school", "get passed the issue": past after a verb of motion.
  {
    rule: CONFUSED,
    cue: ["passed"],
    pattern: `(?:walk|walks|walked|walking|drive|drives|drove|driving|run|runs|ran|running|go|goes|went|going|get|gets|got|getting|move|moved|moving|rush|rushed|fly|flew|flying|sped|race|raced)${S}(?<target>passed)${S}(?:the|a|an|my|your|his|her|our|their|this|that|it|them|him|me)${E}`,
    fix: "past",
  },
  // "I pic the second one", "He wanted to wright a letter": pick, write.
  {
    rule: TYPO,
    cue: ["pic", "wright", "rite", "rote"],
    pattern: `(?<![\\p{L}'’])(?:I|we|you|they|to|will|would|can|could|should|please|just)${S}(?<target>pic|wright|rite|rote)${S}${OBJECT}${E}`,
    fix: (m) =>
      ({ pic: "pick", wright: "write", rite: "write", rote: "wrote" })[
        m.groups!.target.toLowerCase() as "pic"
      ],
  },
  // "Google dose not care", "Dose not seem right": does (not "a dose not exceeding").
  {
    rule: TYPO,
    cue: ["dose"],
    pattern: `(?<![\\p{L}'’])(?<target>dose)${S}not${S}(?<verb>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      if (DETERMINERS.has(before) || /^\d/.test(before) || read(before)?.adjective) return null;
      return read(m.groups!.verb)?.verbs.some((v) => v.form === "base") ? "does" : null;
    },
  },
  // "I scrolled trough the file", "available trough Google": through.
  {
    rule: TYPO,
    cue: ["trough"],
    pattern: `(?<![\\p{L}'’])(?<target>trough)${S}(?<next>the|a|an|my|your|this|it|them|all|\\p{L}+)${E}`,
    fix: (m, ctx) => {
      const next = m.groups!.next;
      // A name after it ("trough Google"); a lowercase noun makes a compound ("trough planters").
      if (next === next.toLowerCase() && !/^(?:the|a|an|my|your|this|it|them|all)$/.test(next))
        return null;
      const before = wordBefore(ctx, m.index);
      return !before || DETERMINERS.has(before) || read(before)?.adjective ? null : "through";
    },
  },
  // "He is of Asian decent": descent.
  {
    rule: CONFUSED,
    cue: ["decent"],
    pattern: `(?<![\\p{L}'’])of${S}(?<origin>\\p{L}+)${S}(?<target>decent)(?=[ \\t\\u00a0]*[.,;!?)]|$)`,
    fix: (m) => (/^\p{Lu}\p{Ll}/u.test(m.groups!.origin) ? "descent" : null),
  },
  // "It is my strong believe that…", "Are there different believes?": belief.
  {
    rule: CONFUSED,
    cue: ["believe", "believes"],
    pattern: `(?<![\\p{L}'’])(?<lead>my|our|his|her|their|your|strong|firm|religious|core|personal|deep|different|common|popular|false)${S}(?<target>believe|believes)(?=${S}(?:that|is|are|was|were|in|about|of)${E}|[ \\t\\u00a0]*[.,;!?])`,
    fix: (m) => (/s$/i.test(m.groups!.target) ? "beliefs" : "belief"),
  },
  // "It happens on the Monday nigh", "I woke at nigh": night.
  {
    rule: TYPO,
    cue: ["nigh"],
    pattern: `(?<![\\p{L}'’])(?:${WEEKDAY}|last|tomorrow|good|at|every|one)${S}(?<target>nigh)${E}`,
    fix: (m, ctx) =>
      /^[ \t ]+(?:on|unto|impossible|invincible)\b/i.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 14),
      )
        ? null
        : "night",
  },
  // "We have not seen him sine Monday": since.
  {
    rule: TYPO,
    cue: ["sine"],
    pattern: `(?<![\\p{L}'’])(?<target>sine)${S}(?:\\d|${WEEKDAY}|last|then|yesterday|january|february|march|april|may|june|july|august|september|october|november|december|the${S}beginning)`,
    fix: (m, ctx) => (/^(?:a|the|of)$/.test(wordBefore(ctx, m.index)) ? null : "since"),
  },
  // "It was too son", "I would son be ready": soon.
  {
    rule: TYPO,
    cue: ["son"],
    pattern: `(?<![\\p{L}'’])(?:too|so|very|as|would|will|how)${S}(?<target>son)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:be|as|enough|after)${E})`,
    fix: "soon",
  },
  // "We can ether go out or stay in": either.
  {
    rule: TYPO,
    cue: ["ether"],
    pattern: `(?<![\\p{L}'’])(?:can|could|will|would|should|must|may|might|to|I|we|you|they|he|she)${S}(?<target>ether)${S}[^.!?;:\\n]{1,40}?${S}or${E}`,
    fix: "either",
  },
  // "Hoe does it work?", "Learn hoe to cook": how.
  {
    rule: TYPO,
    cue: ["hoe"],
    pattern: `(?<![\\p{L}'’])(?<target>hoe)${S}(?:do|does|did|is|are|was|can|could|to|much|many|long|about|would|should)${E}`,
    fix: (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      return (!before && afterBreak(ctx, m.index)) ||
        /^(?:know|learn|see|ask|tell|show|wonder|explain|understand)$/.test(before)
        ? "how"
        : null;
    },
  },
  // "He stood besides me": beside; "Beside that, I have no idea": besides.
  {
    rule: CONFUSED,
    cue: ["besides"],
    pattern: `(?:stood|stand|stands|standing|sat|sit|sits|sitting|lay|lies|lying|walked|walks|knelt)${S}(?<target>besides)${S}(?:me|him|her|us|them|you|it|the|a|my|his|our|their)${E}`,
    fix: "beside",
  },
  {
    rule: CONFUSED,
    cue: ["beside"],
    pattern: `(?<![\\p{L}'’])(?<target>beside)${S}(?:that|this)[ \\t\\u00a0]*,`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "besides" : null),
  },
  // "Grate work!", "It's really grate.": great.
  {
    rule: TYPO,
    cue: ["grate"],
    pattern: `(?<![\\p{L}'’])(?:(?<lead>really|so|very|such${S}a|a)${S})?(?<target>grate)(?=${S}(?:work|job|idea|day|time|news|stuff|post|question)${E}|[ \\t\\u00a0]*[.!])`,
    fix: (m, ctx) => {
      const lead = m.groups!.lead?.toLowerCase();
      if (lead === "a")
        return /^[ \t ]*[.!]/.test(ctx.text.slice(m.index + m[0].length)) ? null : "great";
      return lead || afterBreak(ctx, m.index) ? "great" : null;
    },
  },
  // "He is batter than me": better.
  {
    rule: TYPO,
    cue: ["batter"],
    pattern: `(?:is|are|was|were|be|much|far|even|way|lot|getting|got|feel|feels|felt)${S}(?<target>batter)${S}than${E}`,
    fix: "better",
  },
  // "I have bin there", "haven't bin told": been.
  {
    rule: TYPO,
    cue: ["bin"],
    pattern: `(?<![\\p{L}'’])(?:have|has|had|haven['’]t|hasn['’]t|hadn['’]t|['’]ve|not|never|always|already|just)${S}(?<target>bin)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      const next = m.groups!.next.toLowerCase();
      if (
        /^(?:there|here|to|in|so|very|really|told|done|able|busy|sick|away|out|at|on|with|for|since|ill|unable|asked|a|an|the)$/.test(
          next,
        )
      )
        return "been";
      return read(next)?.verbs.some((v) => v.form === "ing" || v.form === "participle") &&
        !read(next)?.noun
        ? "been"
        : null;
    },
  },
  // "I most do it tomorrow", "I most be unlucky": must.
  {
    rule: CONFUSED,
    cue: ["most"],
    pattern: `(?<![\\p{L}'’])(?:I|we|you|they|he|she|it)${S}(?<target>most)${S}(?:be|have|do)${E}`,
    fix: "must",
  },
  // "I what have done it differently": would.
  {
    rule: CONFUSED,
    cue: ["what"],
    pattern: `(?<![\\p{L}'’])(?:I|we|they|he|she)${S}(?<target>what)${S}(?<verb>have|be|do|go|like|love|prefer|rather|never)${S}(?<next>[a-z]+)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) && m.groups!.next.toLowerCase() !== "you" ? "would" : null,
  },
  // "Everyone is being testes", "Tom has testes negative": tested.
  {
    rule: TYPO,
    cue: ["testes"],
    pattern: `(?:be|being|been|is|was|were|are|has|have|had|get|got)${S}(?<target>testes)${E}`,
    fix: "tested",
  },
  // "ten minuets walking distance": minutes.
  {
    rule: TYPO,
    cue: ["minuets", "minuet"],
    pattern: `(?<![\\p{L}'’])(?:\\d+|one|two|three|four|five|ten|fifteen|twenty|thirty|few|several|many|couple${S}of)${S}(?<target>minuets?)${E}`,
    fix: (m) => (/s$/i.test(m.groups!.target) ? "minutes" : "minute"),
  },
  // "He is in vacation", "I'm at vacation": on vacation.
  {
    rule: CONTEXT,
    cue: ["vacation"],
    pattern: `(?:is|am|are|was|were|be|been|['’]m|['’]re|['’]s)(?:${S}(?:probably|currently|still|now|already))?${S}(?<target>in|at)${S}vacation(?=[ \\t\\u00a0]*[.,!?]|${S}(?:right|now|until|till|for|in|at|with|this|next|today)${E})`,
    fix: "on",
  },
  // "Their has to be a way", "their might be a better one": there.
  {
    rule: CONFUSED,
    cue: ["their"],
    pattern: `(?<![\\p{L}'’])(?<target>their)${S}(?:has|have|had|might|may|must|could|should|would|will|seems?|appears?)${S}(?:to${S}be|be|been|a|an|no|always|never)${E}`,
    fix: "there",
  },
  // "Deer Anne,": Dear.
  {
    rule: TYPO,
    cue: ["deer"],
    pattern: `(?<target>Deer)${S}(?:(?:Mr|Mrs|Ms|Dr|Prof)\\.?${S})?(?<name>\\p{L}+)[ \\t\\u00a0]*[,:]`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) && /^\p{Lu}/u.test(m.groups!.name) && m.groups!.target === "Deer"
        ? "Dear"
        : null,
  },
  // "In principal, I agree": in principle.
  {
    rule: CONFUSED,
    cue: ["principal"],
    pattern: `(?<![\\p{L}'’])in${S}(?<target>principal)(?=[ \\t\\u00a0]*,|${S}(?:I|we|it|this|that|they|you|he|she|there)${E})`,
    fix: "principle",
  },
  // "stayed over night", "worked over time": the one-word adverb.
  {
    rule: CONTEXT,
    cue: ["night"],
    pattern: `(?:stay|stays|stayed|staying|slept|sleep|sleeps|happened|happen|happens|changed|change|down|up|delivered|shipped|parked)${S}(?<target>over${S}night)${E}`,
    fix: "overnight",
  },
  // "He diffused several bombs": defused.
  {
    rule: CONFUSED,
    cue: ["bomb", "bombs"],
    pattern: `(?<target>diffuse|diffuses|diffused|diffusing)${S}(?:the${S}|a${S}|several${S}|two${S}|three${S}|many${S})?(?:bomb|bombs|mine|mines|device|explosive)${E}`,
    fix: (m) => m.groups!.target.toLowerCase().replace(/^dif/, "de"),
  },
  // "The feature is about to implemented": about to be implemented.
  {
    rule: { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_to_base" },
    cue: ["about"],
    pattern: `(?<![\\p{L}'’])about${S}(?<target>to${S}(?<verb>[a-z]+ed))(?=[ \\t\\u00a0]*[.,;!?]|${S}(?:by|in|on|at|for|soon|next|today|tomorrow)${E})`,
    fix: (m) => {
      const verb = m.groups!.verb.toLowerCase();
      const r = read(verb);
      const lemma = r?.verbs.find((v) => v.form === "past" || v.form === "participle")?.lemma;
      if (!lemma || r?.noun || r?.adjective || !englishInflect(lemma, "past")) return null;
      return [`to be ${verb}`, `to ${lemma}`];
    },
  },
  // "I would like her too do it": to before a base verb.
  {
    rule: { ruleId: "englishToToo", messageKey: "review_msg_to_infinitive" },
    cue: ["too"],
    pattern: `(?<![\\p{L}'’])(?<target>too)${S}(?<verb>[a-z]+)${S}(?:${OBJECT}|now|it)${E}`,
    fix: (m, ctx) => {
      // "like her too do it", "decided himself too start"; "The students too realize" is also.
      const before = wordBefore(ctx, m.index);
      if (
        !/^(?:her|him|them|me|us|you|myself|himself|herself|themselves|ourselves|yourself)$/.test(
          before,
        )
      )
        return null;
      return plainBase(m.groups!.verb) || /^(?:do|start|go|be|have)$/.test(m.groups!.verb)
        ? "to"
        : null;
    },
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishConfusedWords",
      "englishPhraseCorrections",
      "englishAuxiliaryBaseVerb",
      "englishToToo",
    ],
    detect: frameDetector(FRAMES),
  },
];
