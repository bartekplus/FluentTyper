import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { CONTEXT, frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, FUNCTION_WORDS, nounOnly, wordBefore } from "./slotWords";

// More real words typed for a neighbour, each in the slot only the neighbour fits: "of
// cause" (course), "a rally good idea" (really), "I tent to agree" (tend), "sounds god"
// (good), "the trail expired" (trial), "switched of the light" (off), "except my apologies"
// (accept), "hours ego" (ago). The frames name the words around the slot.

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const DET = "(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those)";
const OBJECT = "(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|it|them|him|us|me)";

export const PHRASES: readonly PhraseRow[] = [
  [["blueray", "blue-ray", "blu ray"], "Blu-ray"],
  [["bluerays", "blue-rays"], "Blu-rays"],
  ["altar ego", "alter ego"],
  ["alter boy", "altar boy"],
  ["of coarse", "of course"],
  ...[
    "playing",
    "gold cart",
    "gold carts",
    "gold club",
    "gold clubs",
    "gold course",
    "gold ball",
  ].map((typed): PhraseRow =>
    typed === "playing" ? ["playing gold", "playing golf"] : [typed, typed.replace("gold", "golf")],
  ),
  ...["great", "good", "nice"].map((lead): PhraseRow => [`${lead} jib`, `${lead} job`]),
  ...["authorized", "military", "medical", "director of", "key", "unauthorized"].map(
    (lead): PhraseRow => [`${lead} personal`, `${lead} personnel`],
  ),
  ...["hours of", "pay for", "paid for"].map((lead): PhraseRow => [
    `${lead} over time`,
    `${lead} overtime`,
  ]),
  ...["heath department", "heath care", "heath insurance", "mental heath", "public heath"].map(
    (typed): PhraseRow => [typed, typed.replace("heath", "health")],
  ),
  ["world heath organization", "World Health Organization"],
  [["best of lick", "best of lock"], "best of luck"],
  ...["to no affect", "an affect on", "the affect on"].map((typed): PhraseRow => [
    typed,
    typed.replace("affect", "effect"),
  ]),
  [["at soon as possible", "as soon at possible"], "as soon as possible"],
  ...["route cause", "route causes"].map((typed): PhraseRow => [
    typed,
    typed.replace("route", "root"),
  ]),
  ...["city", "cities", "town", "towns", "garden"].map((noun): PhraseRow => [
    `wallet ${noun}`,
    `walled ${noun}`,
  ]),
  ...["bitcoin", "crypto"].map((lead): PhraseRow => [`${lead} walled`, `${lead} wallet`]),
  ...["hold my", "hold your", "out of", "catch my", "catch your", "a deep", "waste your"].map(
    (lead): PhraseRow => [`${lead} breathe`, `${lead} breath`],
  ),
  ...["free", "30-day", "14-day", "7-day"].map((lead): PhraseRow => [
    `${lead} trail`,
    `${lead} trial`,
  ]),
  ...["period", "version", "account", "license", "expired", "ends", "ended"].map(
    (tail): PhraseRow => [`trail ${tail}`, `trial ${tail}`],
  ),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const adjectiveWord = (word: string) => !!read(word)?.adjective && !FUNCTION_WORDS.has(word);
const third = (word: string) => !!read(word)?.verbs.some((v) => v.form === "third");
const ing = (word: string) => !!read(word)?.verbs.some((v) => v.form === "ing");
const base = (word: string) => !!read(word)?.verbs.some((v) => v.form === "base");

const FRAMES: readonly Frame[] = [
  // "Of cause, I will be there": of course (not "the law of cause and effect").
  {
    rule: TYPO,
    cue: ["cause"],
    pattern: `(?<target>of${S}cause)(?=[ \\t\\u00a0]*[,!.]|${S}(?:I|we|you|it|not|they|he|she)${E})`,
    fix: "of course",
  },
  // "a rally good idea", "It rally hurts": really.
  {
    rule: TYPO,
    cue: ["rally"],
    pattern: `(?<target>rally)${S}(?<next>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const next = m.groups!.next;
      // "The rally drew a crowd": after a determiner the noun is meant.
      const determiner = /^(?:the|a|an|this|that|our|their|his|her|my|your)$/.test(
        wordBefore(ctx, m.index),
      );
      return (adjectiveWord(next) && !read(next)?.noun) ||
        (third(next) && !read(next)?.noun && !determiner) ||
        /^(?:good|bad|nice|great|cool|like|want|need|appreciate|hope|is|was|hurts|helps)$/.test(
          next,
        )
        ? "really"
        : null;
    },
  },
  // "I tent to agree": tend.
  {
    rule: TYPO,
    cue: ["tent", "tents"],
    pattern: `(?:I|we|you|they|people|he|she|it|users|kids|children|most|many|some|often|usually|still|also|generally)${S}(?<target>tents?)${S}to${S}[a-z]+${E}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "tents" ? "tends" : "tend"),
  },
  // "That sounds god", "as god as me": good.
  {
    rule: TYPO,
    cue: ["god"],
    pattern: `(?:sounds|sound|looks|look|feels|feel|seems|seem|very|so|as|pretty|really|quite|too)${S}(?<target>god)(?=[ \\t\\u00a0]*[,.!]|${S}(?:thanks|as|to|idea|job|luck|enough)${E})`,
    fix: "good",
  },
  // "I'm tankful for your help": thankful.
  {
    rule: TYPO,
    cue: ["tankful"],
    pattern: `(?:I['’]m|am|are|is|was|were|be|so|very|really|truly|we['’]re|feel)${S}(?<target>tankful)${E}`,
    fix: "thankful",
  },
  // "Can you check this, pleas?", "could pleas check": please.
  {
    rule: TYPO,
    cue: ["pleas"],
    pattern: `(?:(?<=,${S})(?<target>pleas)(?=[ \\t\\u00a0]*[?.!])|(?:could|would|can|will)${S}(?:you${S})?(?<target2>pleas)${S}(?:check|help|send|let|tell|confirm|look|review|advise|call)${E})`,
    fix: "please",
  },
  // "It sees that he is unhappy": seems.
  {
    rule: TYPO,
    cue: ["sees"],
    pattern: `(?:it|this|that)${S}(?<target>sees)${S}(?:that|to${S}me|like|as${S}if|as${S}though)${E}`,
    fix: "seems",
  },
  // "Any help would me appreciated": be.
  {
    rule: TYPO,
    cue: ["me"],
    pattern: `(?:would|will|could|might|may|should|must|to)${S}(?<target>me)${S}(?:interested|appreciated|able|happy|glad|available|helpful|useful|great|nice|fine|possible|grateful|ready|done)${E}`,
    fix: "be",
  },
  // "Her you go!", "Her you can see it": here.
  {
    rule: TYPO,
    cue: ["her"],
    pattern: `(?<target>her)${S}(?:you|we|is|are|it)${S}(?:go|can|is|are|will|have|see)${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "here" : null),
  },
  // "a really cheep car": cheap.
  {
    rule: TYPO,
    cue: ["cheep"],
    pattern: `(?:really|very|so|too|pretty|quite|super|a|is|was)${S}(?<target>cheep)(?=${S}[a-z]+${E}|[ \\t\\u00a0]*[.!,])`,
    fix: "cheap",
  },
  // "a whit horse": white.
  {
    rule: TYPO,
    cue: ["whit"],
    pattern: `(?:a|the|of|lot${S}of)${S}(?<target>whit)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => (m.groups!.noun !== "of" && nounOnly(m.groups!.noun) ? "white" : null),
  },
  // "I asses the work": assess.
  {
    rule: TYPO,
    cue: ["asses"],
    pattern: `(?:I|we|you|they|to|didn['’]t|don['’]t|will|can|should|must|please)${S}(?<target>asses)${S}${OBJECT}${E}`,
    fix: "assess",
  },
  // "I well help you": will.
  {
    rule: TYPO,
    cue: ["well"],
    pattern: `(?<![\\p{L}'’])(?:I|we|you|they|he|she|it)${S}(?<target>well)${S}(?:help|be|do|go|come|see|call|send|try|make|get|take|let|check|look|need|have)${E}`,
    fix: (m, ctx) => (/^as$/.test(wordBefore(ctx, m.index)) ? null : "will"),
  },
  // "I'm looking tor the exit": for.
  {
    rule: TYPO,
    cue: ["tor"],
    pattern: `(?:looking|look|wait|waiting|search|searching|thanks|thank${S}you|ask|asking|apply|applied)${S}(?<target>tor)${S}${DET}${E}`,
    fix: "for",
  },
  // "We have to new developers": two before a plural noun.
  {
    rule: CONFUSED,
    cue: ["to"],
    pattern: `(?<lead>have|has|had|hired|bought|got)${S}(?<target>to)${S}(?<adj>(?:new|more|small|big|large|different|separate|other|extra)${S})?(?<noun>[a-z]+s)${E}(?<after>${S}[a-z]+)?`,
    // "the effect they have to teenagers": after have, an adjective or a verb after the noun
    // shows the count ("have to new developers", "have to charts showing…").
    fix: (m) => {
      if (nounOnly(m.groups!.noun) !== "plural") return null;
      const after = m.groups!.after?.trim();
      return !/^ha/i.test(m.groups!.lead) || m.groups!.adj || (after && ing(after)) ? "two" : null;
    },
  },
  // "Apple shout not require it": should.
  {
    rule: TYPO,
    cue: ["shout"],
    pattern: `(?:I|we|you|they|he|she|it|[a-z]{2,})${S}(?<target>shout)${S}(?:not|be|have|require|do|consider|try|make|use|know)${E}`,
    fix: "should",
  },
  // "Yes, we cab.", "Cab you confirm?": can.
  {
    rule: TYPO,
    cue: ["cab"],
    pattern: `(?:(?<![\\p{L}'’])(?:I|we|you|they)${S}(?<target>cab)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:not|do|be|see|help|go)${E})|(?<target2>cab)${S}(?:you|I|we|they)${S}[a-z]+)`,
    fix: (m, ctx) => (m.groups!.target || afterBreak(ctx, m.index) ? "can" : null),
  },
  // "I have sen you a message", "I can't sen it": sent/send.
  {
    rule: TYPO,
    cue: ["sen"],
    pattern: `(?<lead>have|has|had|can|can['’]t|will|to|please|could|would)${S}(?<target>sen)${S}(?:you|him|her|them|us|me|it|${DET})${E}`,
    fix: (m) => (/^ha/i.test(m.groups!.lead) ? "sent" : "send"),
  },
  // "She posses a car", "will posses": possess.
  {
    rule: TYPO,
    cue: ["posses"],
    pattern: `(?<lead>will|to|must|should|does|do|I|we|they|he|she|it)${S}(?<target>posses)${S}(?:a|an|the|one|some|many|great|good|strong|excellent|${DET})${E}`,
    fix: (m) => (/^(?:he|she|it)$/i.test(m.groups!.lead) ? "possesses" : "possess"),
  },
  // "Call me wen you are ready": when.
  {
    rule: TYPO,
    cue: ["wen"],
    pattern: `(?<target>wen)${S}(?:you|I|we|they|he|she|it|the)${S}[a-z]+${E}`,
    fix: "when",
  },
  // "Would yo do it?", "What do yo think?": you.
  {
    rule: TYPO,
    cue: ["yo"],
    pattern: `(?:would|could|do|did|can|will|are|have|thank|should|if|when)${S}(?<target>yo)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) => (base(m.groups!.verb) || ing(m.groups!.verb) ? "you" : null),
  },
  // "He as been busy": has.
  {
    rule: TYPO,
    cue: ["as"],
    pattern: `(?<![\\p{L}'’])(?:he|she|it|this|that)${S}(?<target>as)${S}(?:been|had|got|gotten|done|seen|made|taken)${E}`,
    fix: "has",
  },
  // "Put a coma between the clauses": comma.
  {
    rule: TYPO,
    cue: ["coma"],
    pattern: `(?:(?:put|add|added|missed|missing|insert|remove|use|place|need|needs|forgot)${S}(?:a|the)${S}(?<target>coma)|(?<target2>coma)${S}(?:between|after|before)${S}(?:the|a|each|every|two|clauses|items))${E}`,
    fix: "comma",
  },
  // "Turn of the TV", "The light was switched of": off.
  {
    rule: TYPO,
    cue: ["of"],
    pattern: `(?:switch|switched|switching|shut|shutting|turned|turning|logged|log|dozed|doze)${S}(?<target>of)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:the|it|this|that|my|your|his|her|all|now)${E})`,
    fix: (m, ctx) => (/^(?:the|a|an)$/.test(wordBefore(ctx, m.index)) ? null : "off"),
  },
  {
    rule: TYPO,
    cue: ["of"],
    pattern: `(?<![\\p{L}'’])turn${S}(?<target>of)${S}(?:the${S}(?:tv|light|lights|radio|music|engine|computer|phone|alarm|heater|water|power|oven|stove)|it|everything|all)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) || wordBefore(ctx, m.index) === "please" ? "off" : null,
  },
  // "I am all ready doing it": already.
  {
    rule: CONTEXT,
    cue: ["ready"],
    pattern: `(?<target>all${S}ready)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => (ing(m.groups!.next) && !read(m.groups!.next)?.noun ? "already" : null),
  },
  // "Shell we dance?", "We shell overcome": shall.
  {
    rule: TYPO,
    cue: ["shell"],
    pattern: `(?:(?<target>shell)${S}(?:we|I)${S}[a-z]+|(?<![\\p{L}'’])(?:we|I)${S}(?<target2>shell)${S}(?<verb>[a-z]+))${E}`,
    fix: (m, ctx) =>
      m.groups!.target
        ? afterBreak(ctx, m.index)
          ? "shall"
          : null
        : base(m.groups!.verb)
          ? "shall"
          : null,
  },
  // "You can loose so much": lose.
  {
    rule: CONFUSED,
    cue: ["loose"],
    pattern: `(?:can|could|will|would|might|may|to|don['’]t|didn['’]t|not|never)${S}(?<target>loose)${S}(?:a|so|all|the|my|your|our|their|his|her|money|time|weight|it|them|everything|interest|track|sight|hope|control)${E}`,
    fix: "lose",
  },
  // "My tooth got knocked lose": loose.
  {
    rule: CONFUSED,
    cue: ["lose"],
    pattern: `(?:knocked|came|come|comes|break|broke|broken|cut|set|let|run|ran|got|get|hang|hanging|is|was|are|were)${S}(?<target>lose)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:from|and|again|now)${E})`,
    fix: "loose",
  },
  // "Do not chance these settings": change.
  {
    rule: TYPO,
    cue: ["chance", "chances"],
    pattern: `(?:do${S}not|don['’]t|please|to|can|will|should|must|never|always|he|she|it|we|you|they|I)${S}(?<target>chances?)${S}(?:the|these|this|that|those|my|your|its|his|her|our|their|settings|colors|colours)${E}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "chances" ? "changes" : "change"),
  },
  // "She breaths fresh air": breathes.
  {
    rule: TYPO,
    cue: ["breaths"],
    pattern: `(?:he|she|it|who|[a-z]{2,})${S}(?<target>breaths)${S}(?:in|out|fresh|deeply|heavily|slowly|the|air)${E}`,
    fix: "breathes",
  },
  // "Last Sunday I whore a dress": wore.
  {
    rule: TYPO,
    cue: ["whore"],
    pattern: `(?<![\\p{L}'’])(?:I|he|she|we|they|you|[a-z]{2,})${S}(?<target>whore)${S}(?:a|an|the|my|his|her|their|our|your|black|white|red|blue|green|jeans|shoes|glasses)${E}`,
    fix: "wore",
  },
  // "Please except my apologies": accept.
  {
    rule: CONFUSED,
    cue: ["except"],
    pattern: `(?:please|kindly|I|we|to|will|would|can|could)${S}(?<target>except)${S}(?:my|our|this|the|your|an|his|her)${S}(?:sincere${S}|deepest${S}|humble${S})?(?:apology|apologies|offer|invitation|condolences|thanks|gratitude|resignation|terms|challenge|proposal)${E}`,
    fix: "accept",
  },
  // "I was asked buy a friend": by after a passive participle.
  {
    rule: CONFUSED,
    cue: ["buy"],
    pattern: `(?:asked|requested|written|made|built|sent|given|owned|caused|done|created|signed|approved|called|founded|designed|developed|reviewed|painted|published)${S}(?<target>buy)${S}(?:one|the|my|a|an|his|her|their|our|your|someone|them|him|me|us|[a-z]{2,})${E}`,
    fix: "by",
  },
  // "Buy making it our pick", "features buy using NER": by.
  {
    rule: CONFUSED,
    cue: ["buy"],
    pattern: `(?<target>buy)${S}(?<verb>using|making|doing|clicking|adding|following|taking|going|providing|offering|creating|selecting|pressing|typing|entering|calling|sending)${E}`,
    fix: "by",
  },
  // "Al other prices": all.
  {
    rule: TYPO,
    cue: ["al"],
    pattern: `(?<target>Al)${S}(?:other|of|the|my|our|your|these|those|right)${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "all" : null),
  },
  // "Such an exiting experience": exciting.
  {
    rule: TYPO,
    cue: ["exiting"],
    pattern: `(?:an|so|very|really|such${S}an|most|more|quite|pretty|super)${S}(?<target>exiting)(?=${S}(?:experience|news|time|times|day|opportunity|game|trip|event|project|year|week)${E}|[ \\t\\u00a0]*[!.])`,
    fix: "exciting",
  },
  {
    rule: TYPO,
    cue: ["amassing"],
    pattern: `(?:so|is|are|was|were|very|really|you['’]re|it['’]s|that['’]s|truly|absolutely)${S}(?<target>amassing)(?=[ \\t\\u00a0]*[!.,])`,
    fix: "amazing",
  },
  // "Have you read my replay?": reply.
  {
    rule: TYPO,
    cue: ["replay"],
    pattern: `(?:read|reading|received|got|get|send|sent|await|awaiting|for|thanks${S}for)${S}(?:my|your|his|her|their|our|a|the)${S}(?:(?:quick|fast|prompt|kind)${S})?(?<target>replay)${E}`,
    fix: "reply",
  },
  // "It doesn't see to happen": seem.
  {
    rule: TYPO,
    cue: ["see"],
    pattern: `(?:doesn['’]t|don['’]t|didn['’]t|does${S}not|do${S}not|can['’]t|cannot)${S}(?<target>see)${S}to${S}(?:me|be|have|happen|work|get|make|find|matter|help)${E}`,
    fix: "seem",
  },
  // "has been adder": added.
  {
    rule: TYPO,
    cue: ["adder"],
    pattern: `(?:been|have|has|had|was|were|is|are)${S}(?<target>adder)${E}`,
    fix: "added",
  },
  // "The president signed the degree": decree.
  {
    rule: TYPO,
    cue: ["degree"],
    pattern: `(?:signed|sign|signs|issued|issue|royal|presidential|executive|imperial)${S}(?:the${S}|a${S})?(?<target>degree)${E}(?!${S}(?:in|of|from)${E})`,
    fix: "decree",
  },
  // "The format sometimes various depending on…": varies.
  {
    rule: TYPO,
    cue: ["various"],
    pattern: `(?:sometimes|often|also|it|this|that|price|format|which|greatly)${S}(?<target>various)${S}(?:depending|by|from|between|with|widely|greatly|a${S}lot)${E}`,
    fix: "varies",
  },
  // "to farther her career": further.
  {
    rule: CONFUSED,
    cue: ["farther"],
    pattern: `to${S}(?<target>farther)${S}(?:my|your|his|her|their|our|the)${S}(?:career|education|cause|goals?|interests?|research|studies|development|knowledge|understanding)${E}`,
    fix: "further",
  },
  // "I want to say you the truth": tell.
  {
    rule: CONFUSED,
    cue: ["say"],
    pattern: `(?:to|will|can|let${S}me|I['’]ll|must|should)${S}(?<target>say)${S}(?:you|him|her|them|me|us)${S}(?:the${S}truth|a${S}secret|something|everything|nothing|a${S}story|about)${E}`,
    fix: "tell",
  },
  // "He is wining the championship": winning (not "wining and dining").
  {
    rule: TYPO,
    cue: ["wining"],
    pattern: `(?:is|are|was|were|been|be|keep|kept|up|after|for|the|a|start|started)${S}(?<target>wining)${E}(?!${S}and${S}dining)`,
    fix: "winning",
  },
  // "I wondered whet the problem was", "Whet a pity!": what.
  {
    rule: TYPO,
    cue: ["whet"],
    pattern: `(?:(?:wondered|wonder|know|ask|asked|see|tell|understand)${S}(?<target>whet)${S}(?:the|a|is|was|you|I|we|they|it|this)|(?<target2>whet)${S}(?:a|an)${S}[a-z]+[ \\t\\u00a0]*!)`,
    fix: "what",
  },
  // "It's the worse possible outcome": worst.
  {
    rule: CONFUSED,
    cue: ["worse"],
    pattern: `the${S}(?<target>worse)${S}(?:possible|case|thing|part|day|idea|outcome|mistake|of${S}(?:all|them|the))${E}`,
    fix: "worst",
  },
  // "I'd like to know hwy this fails": why.
  {
    rule: TYPO,
    cue: ["hwy"],
    pattern: `(?:(?:know|wonder|ask|see|tell|me|understand|that['’]s|and|but|so)${S}(?<target>hwy)${S}(?:this|the|it|you|I|we|they|he|she|is|are|do|does|did|not)|(?<target2>Hwy)${S}(?:are|is|do|does|did|would|can|not)${S}[a-z]+)${E}`,
    fix: (m, ctx) => (m.groups!.target || afterBreak(ctx, m.index) ? "why" : null),
  },
  // "Please don't overdue it": overdo.
  {
    rule: TYPO,
    cue: ["overdue"],
    pattern: `(?:don['’]t|do${S}not|not|never|might|may|could|will|would|to|easy${S}to)${S}(?<target>overdue)${S}it${E}`,
    fix: "overdo",
  },
  // "Is this what you art looking for?", "What art you…": are (not "art thou").
  {
    rule: TYPO,
    cue: ["art"],
    pattern: `(?:(?<![\\p{L}'’])(?:you|we|they)${S}(?<target>art)${S}(?<verb>[a-z]+ing)|(?:what|where|how|why|who)${S}(?<target2>art)${S}(?:you|we|they))${E}`,
    fix: "are",
  },
  // "Tom is my college and friend", "My colleges and I": colleague.
  {
    rule: TYPO,
    cue: ["college", "colleges"],
    pattern: `(?:my|our|his|her|your|their)${S}(?<target>colleges?)${S}(?:and${S}(?:I|me|friend|friends)|at${S}work|from${S}work)${E}`,
    fix: (m) => (/s$/i.test(m.groups!.target) ? "colleagues" : "colleague"),
  },
  // "They as for permission": ask.
  {
    rule: TYPO,
    cue: ["as"],
    pattern: `(?<![\\p{L}'’])(?:they|we|I|you|can|could|will|would|to|please|always|should)${S}(?<target>as)${S}for${S}(?:permission|help|advice|more|money|time|forgiveness|directions|feedback|patience|support|understanding|input|details|information|a|an|the)${E}`,
    fix: "ask",
  },
  // "Good lock, Tom", "Good lock with that": luck.
  {
    rule: TYPO,
    cue: ["lock", "lick"],
    pattern: `(?:good${S}(?<target>lock)|best${S}of${S}(?<target2>lock|lick))(?=[ \\t\\u00a0]*[,!.]|${S}(?:with|on|to|tomorrow|today)${E})`,
    fix: "luck",
  },
  // "Three hours ego": ago.
  {
    rule: TYPO,
    cue: ["ego"],
    pattern: `(?:hours|days|years|weeks|months|minutes|seconds|long|while)${S}(?<target>ego)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:and|but|I|we|when)${E})`,
    fix: "ago",
  },
  // "She it so clever", "this it just so good": is.
  {
    rule: CONTEXT,
    cue: ["it"],
    pattern: `(?<![\\p{L}'’])(?:she|he|this|that)${S}(?<target>it)${S}(?:so|very|just|really|too|not|quite|always|never)${S}[a-z]+${E}`,
    fix: "is",
  },
  // "It was really had to do": hard.
  {
    rule: TYPO,
    cue: ["had"],
    pattern: `(?:is|was|be|been|it['’]s|isn['’]t|wasn['’]t)${S}(?:(?:really|very|so|too|quite|pretty|not)${S})?(?<target>had)${S}to${S}(?<verb>[a-z]+)${E}`,
    fix: (m) => (base(m.groups!.verb) ? "hard" : null),
  },
  // "as they are want to do": wont.
  {
    rule: TYPO,
    cue: ["want"],
    pattern: `(?:is|are|was|were|am)${S}(?<target>want)${S}to${S}(?:do|say|be|go)${E}`,
    fix: "wont",
  },
  // "He is always by passing the meeting": bypassing.
  {
    rule: TYPO,
    cue: ["passing"],
    pattern: `(?:is|are|was|were|am|not|always)${S}(?<target>by${S}passing)${E}`,
    fix: "bypassing",
  },
  // "almost ell editors": all.
  {
    rule: TYPO,
    cue: ["ell"],
    pattern: `(?:almost|with|of|for|at|in|and|to)${S}(?<target>ell)${S}(?<next>[a-z]+)${E}`,
    fix: (m) =>
      nounOnly(m.groups!.next) === "plural" || adjectiveWord(m.groups!.next) ? "all" : null,
  },
  // "Their elicit behavior": illicit.
  {
    rule: CONFUSED,
    cue: ["elicit"],
    pattern: `(?:the|their|his|her|an|of|in|its|our|for)${S}(?<target>elicit)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => (nounOnly(m.groups!.noun) || read(m.groups!.noun)?.noun ? "illicit" : null),
  },
  // "It's also wort checking": worth.
  {
    rule: TYPO,
    cue: ["wort"],
    pattern: `(?<target>wort)${S}(?:to|it|reading|checking|the|a|noting|mentioning|considering|trying|watching|every)${E}`,
    fix: "worth",
  },
  // "The princes was beautiful": princess.
  {
    rule: TYPO,
    cue: ["princes"],
    pattern: `(?:the|a)${S}(?<target>princes)${S}(?:is|was|has)${E}`,
    fix: "princess",
  },
  // "Is it lager than…": larger.
  {
    rule: TYPO,
    cue: ["lager"],
    pattern: `(?<target>lager)${S}than${E}`,
    fix: "larger",
  },
  // "Can you look at thus?": this.
  {
    rule: TYPO,
    cue: ["thus"],
    pattern: `(?:at|about|with|on|for)${S}(?<target>thus)(?=[ \\t\\u00a0]*[?.!])`,
    fix: "this",
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPhraseCorrections", "englishConfusedWords"],
    detect: frameDetector(FRAMES),
  },
];
