import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { COMPOUND, CONTEXT, frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, FUNCTION_WORDS, wordBefore } from "./slotWords";

// Real words typed for a neighbour in a slot only the neighbour fits, each frame naming the
// words around it: "know id you'll" (if), "I an not" (am), "Whose at the door?" (Who's),
// "look the door" (lock), "How is it like?" (What), "one the best" (one of the).

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

export const PHRASES: readonly PhraseRow[] = [
  [["once and a while", "once and awhile"], "once in a while"],
  ...["in the", "final", "death"].map((lead): PhraseRow => [
    `${lead} throws of`,
    `${lead} throes of`,
  ]),
  ["am note sure", "am not sure"],
  ["i'm note sure", "i'm not sure"],
  ["fair sure that", "fairly sure that"],
  ...["am", "i'm", "was", "be"].map((be): PhraseRow => [`${be} fair sure`, `${be} fairly sure`]),
  ...["sincere", "my", "our", "your"].map((lead): PhraseRow => [
    `${lead} complements on`,
    `${lead} compliments on`,
  ]),
  ["take the complement", "take the compliment"],
  ...["sign", "signed", "signing", "sign the", "breach of", "breach the"].map((lead): PhraseRow => [
    `${lead} contact`,
    `${lead} contract`,
  ]),
  ...["boxer", "champion", "division", "title", "class"].flatMap((noun): PhraseRow[] => [
    [`light weight ${noun}`, `lightweight ${noun}`],
    [`heavy weight ${noun}`, `heavyweight ${noun}`],
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [
  ...["out grow", "out grows", "out grew", "out grown", "out growing"].map((typed): PhraseRow => [
    typed,
    typed.replace(" ", ""),
  ]),
  ...["back fire", "back fires", "back fired", "back firing"].map((typed): PhraseRow => [
    typed,
    typed.replace(" ", ""),
  ]),
];
export const STYLE: readonly PhraseRow[] = [];

const adjectiveOnly = (word: string) => {
  const read = englishWordInfo(word.toLowerCase());
  return !!read?.adjective;
};
const verbBase = (word: string) =>
  !!englishWordInfo(word.toLowerCase())?.verbs.some((v) => v.form === "base");

const FRAMES: readonly Frame[] = [
  // "take the reigns" is the reins; "the reigns of these kings" are reigns.
  {
    rule: TYPO,
    cue: ["reigns"],
    pattern: `(?:take|takes|took|taking|taken|grab|grabbed|hand${S}over|handed${S}over|hold|holding|held)${S}the${S}(?<target>reigns)${E}(?!${S}of${S}(?:these|those|the${S}(?:kings?|queens?|emperors?|monarchs?|pharaohs?)|kings?|queens?|emperors?|monarchs?))`,
    fix: "reins",
  },
  // "I want to know id you'll be there": if.
  {
    rule: TYPO,
    cue: ["id"],
    pattern: `(?:know|ask|asked|wonder|wondering|see|check|determine|tell|sure|whether)${S}(?<target>id)${S}(?:you|you['’]ll|you['’]re|I|we|they|he|she|it|the|there|this|that|anyone)${E}`,
    fix: "if",
  },
  // "I an not sure": am.
  {
    rule: TYPO,
    cue: ["an"],
    pattern: `(?<![\\p{L}'’])I${S}(?<target>an)${S}(?<next>not|so|very|really|sure|glad|happy|going|trying|looking|afraid|still|just|also|new|here|there|able|unable)${E}`,
    fix: "am",
  },
  // "Wed gone so far", "wed love to": we'd.
  {
    rule: TYPO,
    cue: ["wed"],
    pattern: `(?<target>wed)${S}(?:love|like|rather|better|gone|been|have|never)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) || /^(?:and|but|so|then|actually)$/.test(wordBefore(ctx, m.index))
        ? "we'd"
        : null,
  },
  // "Whose at the door?", "Whose the boss here?": who's.
  {
    rule: CONFUSED,
    cue: ["whose"],
    pattern: `(?<target>whose)${S}(?:the|a|an|at|in|on|going|coming|there|here|this|that|ready|next|calling|responsible|available|your|my|our|his|her|in${S}charge)${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "who's" : null),
  },
  // "Hell be there": he'll.
  {
    rule: TYPO,
    cue: ["hell"],
    pattern: `(?<target>hell)${S}be${S}(?:there|here|back|fine|ok|okay|home|late|able|happy|glad|right|ready|soon|in${S}touch)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) || /^(?:and|but|so|then)$/.test(wordBefore(ctx, m.index))
        ? "he'll"
        : null,
  },
  // "Th water is hot": the.
  {
    rule: TYPO,
    cue: ["th"],
    pattern: `(?<target>Th)${S}(?<next>[a-z]+)${E}`,
    // Thorium is "Th" too: only before a plain noun ("Th door was open").
    fix: (m, ctx) => {
      const read = englishWordInfo(m.groups!.next);
      return afterBreak(ctx, m.index) &&
        !!read?.noun &&
        !read.adverb &&
        !read.adjective &&
        !read.verbs.some((v) => v.form !== "base") &&
        !FUNCTION_WORDS.has(m.groups!.next)
        ? "the"
        : null;
    },
  },
  // "My life as gotten busier": has.
  {
    rule: TYPO,
    cue: ["as"],
    pattern: `(?<![\\p{L}'’])(?<lead>[a-z]+)${S}(?<target>as)${S}(?:gotten|taken|been|done|grown|shown|written|eaten|chosen|broken|spoken|driven|forgotten|become)${S}(?:a|the|this|that|my|his|her|our|their|its|me|him|us|them|it|lot|very|much)${E}`,
    fix: (m) => (FUNCTION_WORDS.has(m.groups!.lead.toLowerCase()) ? null : "has"),
  },
  // "A lot of vary happy people": very.
  {
    rule: TYPO,
    cue: ["vary"],
    pattern: `(?:a|an|the|of|is|are|was|were|be|so|not)${S}(?<target>vary)${S}(?<adj>[a-z]+)${E}`,
    fix: (m) => (adjectiveOnly(m.groups!.adj) ? "very" : null),
  },
  // "The heart sill pumped", "I'm sill looking": still.
  {
    rule: TYPO,
    cue: ["sill"],
    pattern: `(?:I['’]m|am|is|are|was|were|I|we|you|they|he|she|it|heart)${S}(?<target>sill)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      const read = englishWordInfo(m.groups!.next);
      return /^(?:not|here|there|alive|working|waiting|looking|open)$/.test(m.groups!.next) ||
        read?.verbs.some((v) => v.form === "ing" || v.form === "past")
        ? "still"
        : null;
    },
  },
  // "Too twenty-three students", "increases too 1000's": to before a count.
  {
    rule: { ruleId: "englishToToo", messageKey: "review_msg_to_too" },
    cue: ["too"],
    pattern: `(?<target>too)${S}(?:[0-9]+(?:['’]s)?|(?:two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)(?:-[a-z]+)?${S}[a-z]+s)${E}`,
    fix: (m, ctx) =>
      // "It's too 1990's for me": a decade as a predicate.
      /^(?:me|you|us|them|him|her|it|is|was|it['’]s|that['’]s|so|be)$/.test(
        wordBefore(ctx, m.index),
      )
        ? null
        : "to",
  },
  // "Ur a nice guy": you're.
  {
    rule: TYPO,
    cue: ["ur"],
    pattern: `(?<target>ur)${S}(?:a|an|the|so|very|not|right|welcome|going|always|never|such|too)${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "you're" : null),
  },
  // "You mus see it", "Mus you go?": must.
  {
    rule: TYPO,
    cue: ["mus"],
    pattern: `(?:(?<![\\p{L}'’])(?:I|you|we|they|he|she|it)${S}(?<target>mus)${S}(?<verb>[a-z]+)|(?<target2>mus)${S}(?:I|you|we|they|he|she|it)${S}[a-z]+)${E}`,
    fix: (m, ctx) =>
      m.groups!.target
        ? verbBase(m.groups!.verb)
          ? "must"
          : null
        : afterBreak(ctx, m.index)
          ? { alternatives: ["must"], range: [m.index, m.index + 3] }
          : null,
  },
  // "Look the door behind you": lock.
  {
    rule: TYPO,
    cue: ["door", "gate", "car", "safe", "drawer"],
    // Not "Look the door is open": the noun must not start a clause of its own.
    pattern: `(?<target>look|looked|looking)${S}(?:the|your|my|our|his|her|their)${S}(?:door|doors|gate|car|safe|drawer|cabinet|bike|front${S}door|back${S}door)${E}(?!${S}(?:is|was|are|were|has|had|will|won['’]t|isn['’]t|wasn['’]t|opened|closed|broke)${E})`,
    fix: (m) => m.groups!.target.toLowerCase().replace("look", "lock"),
  },
  // "How is your teacher like?": what … like.
  {
    rule: CONTEXT,
    cue: ["like"],
    pattern: `(?<target>how)${S}(?:is|was|are|were|['’]s)${S}[^.!?\\n]{1,40}?${S}like(?=[ \\t\\u00a0]*\\?)`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "what" : null),
  },
  // "Cold her father hear him?", "This cold be true": could.
  {
    rule: TYPO,
    cue: ["cold"],
    pattern: `(?:(?<![\\p{L}'’])(?:this|that|it|he|she|I|you|we|they)${S}(?<target>cold)${S}(?:be|have|not|never|you|I|we|they|he|she|it)|(?<target2>cold)${S}(?:I|you|we|they|he|she|it|her|his|my|your|the)${S}(?:[a-z]+${S}){0,2}?(?:be|have|hear|see|help|do|get|go|come|make|take|give|tell|find|ask|try)${S}[^.!?\\n]{0,40}\\?)`,
    fix: (m, ctx) =>
      m.groups!.target
        ? "could"
        : afterBreak(ctx, m.index)
          ? { alternatives: ["could"], range: [m.index, m.index + 4] }
          : null,
  },
  // "What ca I do?", "You ca do it!": can.
  {
    rule: TYPO,
    cue: ["ca"],
    pattern: `(?<target>ca)${S}(?:I|you|we|they|he|she|it|do|go|be|see|get|not|help|find|make)${E}`,
    fix: (m) => (m.groups!.target === "CA" ? null : "can"),
  },
  // "It is no possible": not.
  {
    rule: CONFUSED,
    cue: ["no"],
    pattern: `(?:is|are|was|were|['’]s|['’]re)${S}(?<target>no)${S}(?:possible|impossible|necessary|available|allowed|required|needed|supported|true|sure|clear|ready|able|correct|right|working|finished|enough|related|valid)${E}`,
    fix: "not",
  },
  // "She is one the most talented": one of the.
  {
    rule: CONTEXT,
    cue: ["one"],
    pattern: `(?<target>one${S}the)${S}(?:most|least|best|worst|[a-z]+est)${E}`,
    fix: "one of the",
  },
  // "Them it became clear", "Than it became clear": then.
  {
    rule: TYPO,
    cue: ["them", "than"],
    pattern: `(?<target>them|than)${S}(?:it|I|we|they|he|she|you)${S}(?<verb>[a-z]+)${E}`,
    fix: (m, ctx) => {
      if (!afterBreak(ctx, m.index) || m.groups!.target[0] !== m.groups!.target[0].toUpperCase())
        return null;
      const read = englishWordInfo(m.groups!.verb);
      return read?.verbs.some((v) => v.form !== "base") ||
        /^(?:will|would|can|could)$/.test(m.groups!.verb)
        ? "then"
        : null;
    },
  },
  // "I think is should be fine": it.
  {
    rule: TYPO,
    cue: ["is"],
    pattern: `(?:think|hope|guess|believe|say|said|so|because|that|then)${S}(?<target>is)${S}(?:should|would|will|could|must|might|may)${S}be${E}`,
    fix: "it",
  },
  // "the opening seen of the play": scene.
  {
    rule: TYPO,
    cue: ["seen"],
    pattern: `(?:opening|final|closing|last|first|crime|love|fight|death|deleted|famous|sex|chase)${S}(?<target>seen)(?=${S}(?:of|in|was|is|where|from)${E}|[ \\t\\u00a0]*[.!?,])`,
    fix: "scene",
  },
  // "fully complaint with the rules": compliant.
  {
    rule: TYPO,
    cue: ["complaint"],
    pattern: `(?:is|are|be|being|been|fully|not|was|were|remain|remains|stay|stays|fully)${S}(?<target>complaint)${S}with${E}`,
    fix: "compliant",
  },
  // "a link withe the info": with.
  {
    rule: TYPO,
    cue: ["withe"],
    pattern: `(?<target>withe)${S}(?:the|my|a|an|your|our|their|his|her|this|that|these|those|me|him|us|them|it)${E}`,
    fix: "with",
  },
  // "We can hangout": the verb is two words.
  {
    rule: COMPOUND,
    cue: ["hangout"],
    pattern: `(?:can|will|to|we|they|you|I|let['’]s|could|should|would|wanna|gonna|often|usually|always)${S}(?<target>hangout)${E}`,
    fix: "hang out",
  },
  // "Please contract me": contact.
  {
    rule: TYPO,
    cue: ["contract"],
    pattern: `(?:please|to|can|will|could|should|don['’]t|do${S}not|feel${S}free${S}to)${S}(?<target>contract)${S}(?:me|us|him|her|them|you)${E}`,
    fix: "contact",
  },
  // "I go in to the garden": into.
  {
    rule: COMPOUND,
    cue: ["in"],
    pattern: `(?:go|goes|went|going|walk|walked|walks|walking|run|ran|runs|running|jump|jumped|jumps|fall|fell|falls|move|moved|moves|break|broke|get|got|gets|crash|crashed|bump|bumped)${S}(?<target>in${S}to)${S}(?:the|a|an|my|your|his|her|our|their)${S}[a-z]+${E}(?!${S}(?:to|and)${E})`,
    fix: "into",
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishPhraseCorrections",
      "englishConfusedWords",
      "englishToToo",
      "englishContextualCompounds",
    ],
    detect: frameDetector(FRAMES),
  },
];
