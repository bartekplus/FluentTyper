import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { frameDetector, TYPO, type Frame, type FixResult, type Rule } from "./idioms5";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, wordBefore } from "./slotWords";

// Real words one or two letters from the word the slot needs, each between words that only
// the intended word fits: "I don't now" (know), "let is know" (us), "for tree years"
// (three), "It sees to happen" (seems), "I wan this" (want), "in a ...ly manner" (the
// adjective), "the be finished" (to), "help other" (others).

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

export const PHRASES: readonly PhraseRow[] = [
  [["in another words", "another words"], "in other words"],
  ["et all", "et al."],
  ["climate chance", "climate change"],
  [
    ["ally concern", "ally fear"],
    ["allay concern", "allay fear"],
  ],
  ["needles to say", "needless to say"],
  ["let is know", "let us know"],
  ["dod not", "did not"],
  ["what a coincident", "what a coincidence"],
  ["the true is", "the truth is"],
  ["the filed of", "the field of"],
  ["shipping mall", "shopping mall"],
  ["a pare of", "a pair of"],
  ["in relieve", "in relief"],
  ["no mater what", "no matter what"],
  ["brake away from", "break away from"],
  [["taken a back by", "taken aback by"], "taken aback by"],
  ["doggy-dog world", "dog-eat-dog world"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const OBJECT =
  "the|a|an|my|your|his|her|our|their|its|this|that|these|those|it|them|him|me|us|you|some|any";

/**
 * A frame for `target` between `lead` and `next` (regex alternations; "" for none). `next`
 * sits in a lookahead, so only the target is replaced.
 */
function slot(
  lead: string,
  target: string,
  next: string,
  fix: string | ((m: RegExpExecArray, ctx: DetectContext) => FixResult),
  rule: Rule = TYPO,
): Frame {
  const before = lead ? `(?<![\\p{L}'’])(?:${lead})${S}` : `(?<![\\p{L}'’])`;
  return {
    rule,
    // A plain word is the cue; a target with spaces or groups runs without one.
    ...(/^[A-Za-z]+$/.test(target) ? { cue: [target.toLowerCase()] } : {}),
    pattern: `${before}(?<target>${target})${E}${next ? `(?=${S}(?:${next})${E})` : ""}`,
    fix,
  };
}
/** Only at a sentence start. */
const atStart =
  (fix: string) =>
  (m: RegExpExecArray, ctx: DetectContext): FixResult =>
    afterBreak(ctx, m.index) ? fix : null;
/** Not after a determiner ("the pleas", "a whit"). */
const notAfterDeterminer =
  (fix: string) =>
  (m: RegExpExecArray, ctx: DetectContext): FixResult =>
    DETERMINERS.has(wordBefore(ctx, m.index)) ? null : fix;

const FRAMES: readonly Frame[] = [
  // know / now
  slot(
    `don['’]t|doesn['’]t|didn['’]t|do${S}not|does${S}not|did${S}not`,
    "now",
    "if|whether|what|how|why|who|where|that|and|anything|it|the",
    "know",
  ),
  slot(
    `let${S}(?:me|us|him|her|them)(?:${S}please)?`,
    "now",
    "if|whether|what|how|when|where|who|about",
    "know",
  ),
  slot(
    "can|could|will|would|should|must|might",
    "know",
    "say|tell|go|see|begin|start|confirm",
    "now",
    CONFUSED,
  ),
  slot(
    "i|you|we|they|didn['’]t|don['’]t|not",
    "no",
    `the${S}(?:answer|way|movie|book|truth|reason)|how|what|why|whether|anything|about`,
    "know",
  ),
  // pronoun and verb slips
  {
    rule: CONFUSED,
    cue: ["they"],
    pattern: `(?<![\\p{L}'’])(?<verb>[a-z]+)${S}(?<target>they)(?=[ \\t\\u00a0]*[.!?])`,
    fix: (m) => {
      const r = read(m.groups!.verb);
      return r?.verbs.some((v) => v.form === "base" || v.form === "past") && !r.noun && !r.adjective
        ? "them"
        : null;
    },
  },
  {
    rule: CONFUSED,
    cue: ["the"],
    pattern: `(?<![\\p{L}'’])(?<lead>[a-z]+)${S}(?<target>the)${S}(?:be(?!${S}all)|have${S}(?:you|it|them|been|told|imported|done|seen|made))${E}`,
    // "possible the be finished", "lucky the have imported it": the article before a bare
    // be or have (named features like "the Add a Thing view" never take these two; "the be
    // all and end all" is the idiom).
    fix: (m) => {
      if (DETERMINERS.has(m.groups!.lead.toLowerCase())) return null;
      return /^(?:far|so|then|now)$/i.test(m.groups!.lead) ? ["they", "to"] : ["to", "they"];
    },
  },
  slot(
    "with|by|to|for|from|help|helps|helped|told|tell|ask|asked|and",
    "other",
    "about|in|via|also|run|have|do|think|say",
    "others",
    CONFUSED,
  ),
  {
    rule: CONFUSED,
    cue: ["other"],
    pattern: `(?<![\\p{L}'’])(?:with|by|to|for|from|help|helps|helped|told|tell|ask|asked)${S}(?<target>other)(?=[ \\t\\u00a0]*[.!?,])`,
    // "change the name to Other": a capital names a value.
    fix: (m) => (m.groups!.target === "other" ? "others" : null),
  },
  // "This an all of the above", "in Dutch an already deleted": and. After a preposition or
  // a pronoun, "an already full room" and "to an also inactive unit" keep the article.
  slot(
    "",
    "an",
    `all${S}(?:of|the|things)|also|already`,
    (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      const r = read(before);
      return !before ||
        FUNCTION_WORDS.has(before) ||
        /self$|selves$/.test(before) ||
        (r && !r.noun && !/ing$/.test(before))
        ? null
        : "and";
    },
    CONFUSED,
  ),
  slot("", "I", "my|this|that|our|your|his|her|their", atStart("In"), CONFUSED),
  slot(
    "in|for|of|at|on|with|from",
    "thus",
    "group|case|way|point|reason|purpose|time|team|project",
    "this",
  ),
  slot(
    "",
    "His",
    `a|an|so|very|not|always|never|really|going|been|my|the${S}best`,
    atStart("He's"),
    CONFUSED,
  ),
  slot("\\d+", "hears", "old|ago", "years"),
  slot(
    "for|in|about|over|past|last|the|first|next|only|after",
    "tree",
    "years|days|weeks|months|times|hours|minutes|people|children|kids",
    "three",
  ),
  slot(
    "it|this|that|he|she|which",
    "sees",
    `to${S}(?:be|happen|have|work|go|get|me)`,
    "seems",
    CONFUSED,
  ),
  slot(
    "is|are|was|were|not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t",
    "mean",
    `to${S}(?:be|have)`,
    "meant",
    CONFUSED,
  ),
  slot("otherwise|better|commonly|formerly|widely", "know", "as", "known", CONFUSED),
  slot(
    "have|has|had|not|never|['’]ve|haven['’]t|hasn['’]t",
    "bean",
    "there|here|to|in|happy|able|so|very|really|busy|sick|working|waiting|trying|told|done",
    "been",
  ),
  slot("really|very|so|pretty|quite", "god", "tv|show|movie|book|idea|job|game|one|place", "good"),
  slot(
    "oh|please|so",
    "pleas",
    "help|let|send|call|tell|do|check|find|give|make|note|contact",
    notAfterDeterminer("please"),
  ),
  slot(
    "i|we|you|they|he|she|have|has|had|never",
    "herd",
    "of|about|that|from|nothing|something|anything|so",
    "heard",
    CONFUSED,
  ),
  slot(
    "is|was|be|been|are|were|(?:that|it|what|he|she)['’]s",
    "quiet",
    `a(?!${S}lot)|an|good|nice|different|easy|hard|right|simple|interesting|sure|big|large|small|long|few|well|often|similar`,
    "quite",
    CONFUSED,
  ),
  slot(
    "football|soccer|basketball|hockey|baseball|my|our|your|the|a|whole|support|sales|dev",
    "teem",
    "",
    "team",
  ),
  slot(
    "looking|tried|died|searched|search|searching|hoped|waited|labored|laboured|struggled",
    `in${S}vein`,
    "for|to|since|as|but|\\d",
    "in vain",
  ),
  {
    rule: CONFUSED,
    cue: ["vein"],
    pattern: `(?:looking|tried|died|searched|searching|hoped|waited|struggled)${S}(?<target>in${S}vein)(?=[ \\t\\u00a0]*[.!?,])`,
    fix: "in vain",
  },
  {
    rule: CONFUSED,
    cue: ["sell"],
    pattern: `(?<![\\p{L}'’])(?:homes|houses|cars|items|land|house|car|home|property|properties|apartments?|condos?|lots?|is|are|up)${S}for${S}(?<target>sell)(?![ \\t\\u00a0]*(?:side|off|out|order|price|signal|-))${E}`,
    fix: "sale",
  },
  {
    rule: CONFUSED,
    cue: ["not"],
    pattern: `(?<![\\p{L}'’])all${S}for${S}(?<target>not)(?=[ \\t\\u00a0]*[.!?,…]|$)`,
    fix: "naught",
  },
  slot(
    "to|can|could|will|must|cannot|can['’]t|couldn['’]t|me|us|him|her|them|i|we|you|they",
    "breath",
    "in|out|fresh|deeply|easy|easier|again|normally|air|through",
    "breathe",
    CONFUSED,
  ),
  slot("to", "aide", "you|him|her|them|us|me|in", "aid", CONFUSED),
  slot(
    "deadly|rare|chronic|infectious|contagious|genetic|heart|lung|skin|kidney|liver|autoimmune|terminal|incurable|serious|fatal|a",
    "decease",
    "",
    "disease",
    CONFUSED,
  ),
  slot("to|will|would|can|could|might|may|significantly|not", "altar", OBJECT, "alter", CONFUSED),
  slot(
    "am|is|are|was|were|be|not|i|you|we|they|he|she|['’]m|['’]re",
    "adverse",
    `to${S}[a-z]+ing`,
    "averse",
    CONFUSED,
  ),
  slot(
    "a|the|more|very|really",
    "through",
    "review|analysis|investigation|examination|inspection|discussion|explanation|understanding|check|search|evaluation|assessment|cleaning|overview|description|job|test|testing",
    "thorough",
    CONFUSED,
  ),
  slot(
    "am|is|are|was|were|be|been|['’]m|['’]re|['’]s",
    "wandering",
    "if|whether|why|how|what",
    "wondering",
    CONFUSED,
  ),
  slot("i|we|they|you", "wander", "if|whether|why|how|what", "wonder", CONFUSED),
  slot(
    "is|was|are|were|very|so|brand|completely|totally|relatively|fairly|quite|something|anything",
    "knew",
    "to|for|and",
    "new",
    CONFUSED,
  ),
  {
    rule: CONFUSED,
    cue: ["knew"],
    pattern: `(?<![\\p{L}'’])(?:is|was|very|so|brand|completely|totally|relatively|fairly|quite)${S}(?<target>knew)(?=[ \\t\\u00a0]*[.!?,])`,
    fix: "new",
  },
  slot(
    "this|it|that|he|she|which|what",
    "seams",
    "to|like|wrong|fine|good|ok|okay|strange|odd|weird|right|great|easy|hard|correct|broken",
    "seems",
    CONFUSED,
  ),
  slot(
    "looks|seems|is|was|pretty|very|so|too|quite|fairly",
    "ease",
    "to|for|enough",
    "easy",
    CONFUSED,
  ),
  slot(
    "not",
    "jet",
    "decided|done|ready|finished|available|known|sure|clear|implemented|released|been|seen|started|fixed",
    "yet",
  ),
  slot(
    `a|very|so|really|have${S}a|wish${S}you${S}a`,
    "niece",
    "holiday|day|weekend|time|evening|trip|job|one|place|vacation",
    "nice",
  ),
  slot("would|['’]d", "rater", "go|be|not|have|stay|do|see|wait|die|keep|leave|use", "rather"),
  slot("that|it|this", "whit", OBJECT, notAfterDeterminer("with")),
  slot(
    "let['’]s|to|will|can|should|must|we|i|please|could",
    "asses",
    "the|a|your|our|their|his|her|my|it|this|these|whether|how|what",
    "assess",
    CONFUSED,
  ),
  slot(
    "he|she|i|we|they|you",
    "road",
    "on|a|the|his|her|my|their|our|to|home|in|into|off|away|through|across",
    "rode",
    CONFUSED,
  ),
  slot("he|she|it|who", "caries", "", "carries"),
  slot("he|she|it|who", "writs", "a|an|the|his|her|my|letters|books|code|songs|poems", "writes"),
  slot(
    "it|this|that|which|there",
    `(?:will|can|could|should|would|must)${S}he`,
    "turned|done|fixed|ready|added|sent|used|made|shown|removed|updated|changed|enabled|disabled",
    (m) => m.groups!.target.replace(/he$/i, "be"),
    CONFUSED,
  ),
  slot(
    "i|we|you|they",
    "dun",
    "know|care|think|want|like|have|get|understand|see|need|mind",
    "don't",
  ),
  slot(
    "unable|able|want|wanted|need|needed|going|trying|try|tried|have|has|had",
    "tor",
    "[a-z]+",
    "to",
  ),
  slot(
    `looking|waiting|searching|asking|thanks|thank${S}you|ready`,
    "tor",
    OBJECT + "|work|help|more|it",
    "for",
  ),
  slot(
    "wanted|want|need|needed|going|try|tried|like|love|have|has|had",
    "o",
    "start|go|be|do|get|make|see|try|help|have|know|say|find|use|ask|come|leave|stop|buy",
    "to",
  ),
  slot(
    `to|not|n['’]t|can|could|will|please|unable${S}to`,
    "active",
    "your|the|my|it|this|his|her|their|our|them",
    "activate",
    CONFUSED,
  ),
  slot(
    `can['’]t|cannot|can${S}not|could${S}not|couldn['’]t|to|can|could`,
    "effort",
    "a|an|the|it|to|this|that|any|one|another",
    "afford",
    CONFUSED,
  ),
  slot(
    "['’]ll|will|can|to|i|we|could|should",
    "mange",
    "it|the|to|this|that|them|a|my|your",
    "manage",
  ),
  slot("spelling|it|that|this|which|you|we|i|they", "cab", "be", "can"),
  slot("it|this|that|he|she|there|what", "si", "", "is"),
  slot("not|very|so|is|['’]s|isn['’]t|wasn['’]t", "fare", "to|how|that|enough", "fair", CONFUSED),
  {
    rule: CONFUSED,
    cue: ["fare"],
    pattern: `(?<![\\p{L}'’])(?:not|so|very)${S}(?<target>fare)(?=[ \\t\\u00a0]*[.!?])`,
    fix: "fair",
  },
  slot("to|n['’]t|not|will|can|please|i|we", "sen", OBJECT, "send"),
  slot(
    "to|n['’]t|not|will|can|i|we|they",
    "posses",
    "a|an|the|any|no|some|it|this|that",
    "possess",
  ),
  slot("not|n['’]t|doesn['’]t|don['’]t|didn['’]t|won['’]t|no", "mater", "", "matter", CONFUSED),
  slot("can|could|will|would|should|to|might", "writ", OBJECT, "write"),
  slot(
    "i|we|you|they|don['’]t|didn['’]t|really|just",
    "wan",
    "to|this|that|it|a|an|the|some|more",
    "want",
  ),
  slot(
    "wouldn['’]t|won['’]t|to|will|can|could|should|must|might|['’]ll|don['’]t",
    "git",
    "a|an|the|some|my|your|this|that|them|me|him|her|us|rid|back|out|up|it",
    "get",
    CONFUSED,
  ),
  slot(
    "let['’]s|to|will|can|could|should|we|i|you",
    "meed",
    "tomorrow|today|you|me|him|her|them|us|at|in|the|up|again|soon|on",
    "meet",
  ),
  slot(
    "you|i|we|they",
    "seen",
    `to${S}(?:be|have|ask|know|get|like|want|think|need|make)`,
    "seem",
    CONFUSED,
  ),
  slot(
    `had|has|have|had${S}already|has${S}already|have${S}already`,
    "begone",
    "",
    "begun",
    CONFUSED,
  ),
  slot("", "Than", "you", atStart("Thank"), CONFUSED),
  slot(
    "i|he|she|it",
    "as",
    "looking|going|trying|thinking|wondering|working|waiting",
    "was",
    CONFUSED,
  ),
  slot("would|do|does|did|not|n['’]t|really|just", "wont", "to", "want", CONFUSED),
  slot(
    "set|sets|setting|establish|established|establishes|create|created|creates",
    `a(?:${S}(?:new|dangerous|bad|good|legal))?${S}precedence`,
    "",
    (m) => m.groups!.target.replace(/precedence$/i, "precedent"),
    CONFUSED,
  ),
  slot(
    "been|was|is|fell|slipped|put|remain|remained|remains|in|into",
    `a${S}comma`,
    "",
    (m, ctx) =>
      /^[ \t ]*-/.test(ctx.text.slice(m.index + m[0].length))
        ? null
        : m.groups!.target.replace(/comma$/i, "coma"),
    CONFUSED,
  ),
  slot(
    "have|has|had|got|get|gets|with|caught|catch|getting|having",
    `the${S}flew`,
    "",
    (m) => m.groups!.target.replace(/flew$/i, "flu"),
    CONFUSED,
  ),
  {
    rule: CONFUSED,
    cue: ["granite"],
    pattern: `(?<![\\p{L}'’])(?:take|takes|took|taken|taking)(?:${S}[a-z]+){0,2}${S}for${S}(?<target>granite)${E}`,
    fix: "granted",
  },
  {
    rule: { ruleId: "englishThenThan", messageKey: "review_msg_then_than_temporal" },
    cue: ["than"],
    pattern: `(?<![\\p{L}'’])if${S}[^.!?;:\\n,]{1,60},${S}(?<target>than)${S}(?:we|I|you|they|he|she|it|the)${E}`,
    fix: "then",
  },
  slot(
    "can|could|cannot|can['’]t|couldn['’]t|hardly",
    "await",
    "until|till|for|to",
    "wait",
    CONFUSED,
  ),
  slot(
    "should|would|could|must|might|will|can|did|does|do",
    "knot",
    "have|be|do|go|get|work|need|happen|mind|matter",
    "not",
  ),
  {
    rule: CONFUSED,
    cue: ["sad"],
    pattern: `(?<target>That${S}being${S}sad)(?=[ \\t\\u00a0]*[,.…])`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "That being said" : null),
  },
  {
    rule: CONFUSED,
    cue: ["passed"],
    pattern: `(?<![\\p{L}'’])in${S}the${S}(?<target>passed)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:few|two|three|years?|weeks?|months?|days?)${E})`,
    fix: "past",
  },
  {
    rule: CONFUSED,
    cue: ["lose"],
    pattern: `(?<![\\p{L}'’])on${S}the${S}(?<target>lose)(?=[ \\t\\u00a0]*[.!?,]|$)`,
    fix: "loose",
  },
  {
    rule: CONFUSED,
    cue: ["here"],
    pattern: `(?<![\\p{L}'’])(?<target>here${S}here)(?=[ \\t\\u00a0]*[,!])`,
    fix: "hear hear",
  },
  // "He did it in a hastily manner": the adjective before manner.
  {
    rule: { ruleId: "englishConfusedWords", messageKey: "review_msg_adverb_form" },
    cue: ["manner", "way", "fashion"],
    pattern: `(?<![\\p{L}'’])in${S}(?:a|an)${S}(?<target>[a-z]+ly)${S}(?:manner|way|fashion)${E}`,
    fix: (m) => {
      const word = m.groups!.target.toLowerCase();
      const r = read(word);
      if (!r?.adverb || r.adjective || r.noun) return null;
      const candidates = [
        word.replace(/ily$/, "y"),
        word.replace(/ically$/, "ical"),
        word.replace(/bly$/, "ble"),
        word.slice(0, -2),
      ];
      return candidates.find((c) => c !== word && !!read(c)?.adjective) ?? null;
    },
  },
  {
    rule: TYPO,
    cue: ["sometime"],
    pattern: `(?<target>Sometime)${S}(?:I|we|you|they|he|she|it)${S}(?<verb>[a-z]+)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) &&
      read(m.groups!.verb)?.verbs.some((v) => v.form === "base" || v.form === "third")
        ? "Sometimes"
        : null,
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPhraseCorrections", "englishConfusedWords", "englishThenThan"],
    detect: frameDetector(FRAMES),
  },
];
