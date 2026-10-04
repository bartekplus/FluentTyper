import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import { each, PLURAL, TAKE, type PhraseRow } from "../englishPhraseTables";
import {
  CLAUSE,
  COMPLETE,
  type Frame,
  frameDetectors,
  notAfter,
  SPACE as S,
  WORD_END as E,
} from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";

const GO = ["go", "goes", "went", "going", "gone"];
const LAST_DITCH = ["effort", "attempt", "bid", "option", "measure", "push", "stand", "fix"];
const SOMEBODY = ["somebody", "someone", "anybody", "anyone", "everybody", "everyone", "nobody"];

/** Misheard idioms and wrong words in set phrases. */
export const PHRASES: readonly PhraseRow[] = [
  ...each(["it's", "that's", "is", "was"], "~ here nor there", "~ neither here nor there"),
  ...each(["after", "afterward", "afterwards"], "not along ~", "not long ~"),
  ...each(PLURAL, "ticking time clock~", ["ticking time bomb~", "ticking clock~"]),
  ["the another", "the other"],
  ["out of sink", ["out of sync", "out of synch"]],
  ...each(GO, ["~ through great lengths", "~ to a great length"], "~ to great lengths"),
  ["read and writes", ["reads and writes", "read and write"]],
  ...each(TAKE, "~ it personal", "~ it personally"),
  ...["doubly", "singly", "circular"].flatMap((kind) =>
    each(PLURAL, `${kind} link list~`, `${kind} linked list~`),
  ),
  ...each(PLURAL, "double-link list~", "double-linked list~"),
  ...each(PLURAL, "link list implementation~", "linked list implementation~"),
  ["underneath of", ["underneath", "under"]],
  ...each(PLURAL, ["highly kept secret~", "highly-kept secret~"], "well-kept secret~"),
  ...each(["you", "them", "us", "these", "those"], "may of ~", "many of ~"),
  ["yesterday night", "last night"],
  ["a lots of", ["a lot of", "lots of"]],
  ["a lots", ["a lot", "a lot's"]],
  ["lot's and lot's", "lots and lots"],
  ["per-say", "per se"],
  ["t he", "the"],
  ["last but not last", "last but not least"],
  ["quite many", "quite a few"],
  ["thanks lot", "thanks a lot"],
  ["spacial attention", ["special attention", "spatial attention"]],
  ["very known", "very well-known"],
  [
    ["more than what meets the eye", "more that meets the eye", "more that what meets the eye"],
    "more than meets the eye",
  ],
  ["let along", "let alone"],
  ["similar like", "similar to"],
  [["the different between", "the differents between"], "the difference between"],
  ...each(SOMEBODY, ["~'s else", "~'s else's"], "~ else's"),
  [
    [
      ...["in the spur of the moment", "at the spur of the moment"],
      ...["in the spurt of the moment", "at the spurt of the moment", "on the spurt of the moment"],
    ],
    "on the spur of the moment",
  ],
  ["unless if", "unless"],
  ["like as if", "as if"],
  ["in top of", "on top of"],
  ["on top off", "on top of"],
  ...LAST_DITCH.flatMap((noun) =>
    each(
      PLURAL,
      [`last ditch ${noun}~`, `last ditched ${noun}~`, `last-ditched ${noun}~`],
      `last-ditch ${noun}~`,
    ),
  ),
  ["managerial reigns", "managerial reins"],
  ...each(PLURAL, "slippy slope~", "slippery slope~"),
  [["not without a lack of", "not without lack of"], "not for lack of"],
  ["trail and error", "trial and error"],
  ["line of codes", ["lines of code", "line of code"]],
  ["lines of codes", "lines of code"],
  ...each(["luck", "genius"], "strike of ~", "stroke of ~"),
  ...each(["luck", "genius"], "strikes of ~", "strokes of ~"),
  ["the entire of", "the entirety of"],
  ["without out", "without"],
  ...each(PLURAL, "sneaky suspicion~", "sneaking suspicion~"),
  ["on second though", "on second thought"],
  ["every once and a while", "every once in a while"],
  [["point of views", "points of views"], "points of view"],
];

/** Split, joined and hyphenated forms. */
export const COMPOUNDS: readonly PhraseRow[] = [
  ["nerve racking", "nerve-racking"],
  ["nerve wracking", ["nerve-racking", "nerve-wracking"]],
  ["low hanging fruit", "low-hanging fruit"],
  ["low hanging fruits", ["low-hanging fruit", "low-hanging fruits"]],
  ["per-se", "per se"],
  [["on topof", "ontop off"], "on top of"],
  ...each(PLURAL, "worst case scenario~", "worst-case scenario~"),
];

/** Optional advice: accepted variants of an idiom and contested usage. */
export const STYLE: readonly PhraseRow[] = [
  ["nerve-wracking", "nerve-racking"],
  ["low-hanging fruits", "low-hanging fruit"],
  ["surrealness", "surreality"],
  ["last but not the least", "last but not least"],
  ["like no tomorrow", "like there's no tomorrow"],
  ["was comprised of", ["consisted of", "was composed of"]],
  ["truth to the fact that", ["truth to the claim that", "truth to the allegation that"]],
];

// ---- Context frames: forms that are also ordinary English elsewhere. ----

type Rule = "englishPhraseCorrections" | "englishClosedCompounds" | "stylePhrasing";

/** CLAUSE ends at `index`: only spaces or tabs back to a clause mark or the text start. */
function afterClause(text: string, index: number): boolean {
  while (index > 0 && (text[index - 1] === " " || text[index - 1] === "\t")) index--;
  return index === 0 || ".!?,;:(\n".includes(text[index - 1]);
}
const POSSESSIVE = "my|your|his|her|our|their|its|one['’]s";
const DETERMINERS = `a|an|the|this|that|these|those|${POSSESSIVE}|each|every|whose|which|what`;
// Closed-class words that cannot fill the adjective slot of "on a … basis".
const NOT_BASIS_ADJECTIVE = new Set(
  "a an the this that these those which what whose each every its his her their our my your any some no one such same another either neither whichever whatever".split(
    " ",
  ),
);
const OBJECT = /^(?:him|her|them|us|me|you|it|my|your|his|their|our|its)$/i;
const SUBJECT = /^(?:I|he|she|we|they|you|it|who|then|soon|and|later)$/i;
const EMAIL: Record<string, string> = {
  send: "email",
  sends: "emails",
  sent: "emailed",
  sending: "emailing",
};
const word = (text: string, at: number) =>
  /(\p{L}[\p{L}'’]*)[ \t ]*$/u.exec(text.slice(Math.max(0, at - 32), at))?.[1] ?? "";

const FRAMES: Record<Rule, readonly Frame[]> = {
  englishPhraseCorrections: [
    // "true to her word" keeps a promise.
    { pattern: `true${S}to${S}(?:${POSSESSIVE})${S}(?<target>words)${E}`, fix: "word" },
    {
      pattern: `(?:turn|turns|turned|turning)${S}(?:it|them|this|that)${S}(?<target>of)${COMPLETE}`,
      fix: "off",
    },
    { pattern: `(?:turn|turns|turned|turning)${S}(?<target>i${S}of)${COMPLETE}`, fix: "it off" },
    {
      pattern: `${notAfter("I|we|you|they|who|people|users|all|also|still|finally|already|now")}now${S}(?<target>know)${S}as${E}(?!${S}(?:much|many|well|little|far|soon|long|good|bad|fact|a|an|the|of|it|they|we|i|you)${E})`,
      fix: "known",
    },
    {
      // "on daily basis": the adjective slot needs its article.
      pattern: `on${S}(?<target>(?:bi${S})?[a-z]+(?:-[a-z]+)*|ad${S}hoc)${S}basis${E}`,
      fix: (m) => {
        const adj = m.groups!.target;
        const known = englishWordInfo(
          adj
            .toLowerCase()
            .replace(/^bi[ \t\u00a0-]*/, "")
            .split("-")[0],
        );
        if (!known || NOT_BASIS_ADJECTIVE.has(adj.toLowerCase())) return null;
        // The lexicon knows the word, thus it is not spelled out ("HOURLY" is "hourly").
        // Use "a" when people say the word with the two articles ("a historic").
        const an = englishInitialSound(adj.toLowerCase()) === "vowel" ? "an" : "a";
        return `${adj === adj.toUpperCase() ? an.toUpperCase() : an} ${adj}`;
      },
      raw: true,
    },
    {
      // A verb "laugh of someone"; "the laugh of a child" and "Laughs of joy…" are nouns.
      pattern: `${notAfter(DETERMINERS)}(?<verb>laugh|laughs|laughed|laughing)${S}(?<target>of)${S}(?<next>\\p{L}+)${E}`,
      fix: (m) => {
        const { verb, next } = m.groups!;
        if (/s$/i.test(verb) && afterClause(m.input, m.index)) return null;
        return OBJECT.test(next) || /^\p{Lu}\p{Ll}+$/u.test(next) ? "at" : null;
      },
    },
    {
      // "I very much so want…": "so" only closes an answer ("Very much so.").
      pattern: `very${S}much${S}(?<target>so${S})(?<next>[a-z]+)${E}`,
      fix: (m) => {
        const next = m.groups!.next.toLowerCase();
        if (
          /^(?:that|this|it|i|we|you|he|she|they|in|on|at|for|and|but|or|if|as|too|far|long|much|many|well|good|soon|fast)$/.test(
            next,
          )
        )
          return null;
        return englishWordInfo(next)?.verbs.length ? "" : null;
      },
    },
    {
      // "leaving to England" travels "for" a place; "leave to appeal" and "turn left to Main
      // Street" stay.
      pattern: `${notAfter("granted|grant|grants|seek|seeks|seeking|sought|refused|refuse|given|give|apply|applied|for|of|the|a|no|without|on|sick|annual|shore|home|and|or|from|to")}(?<verb>leave|leaves|leaving|left)${S}(?<target>to)${S}(?<next>\\p{L}+)${E}`,
      fix: (m) => {
        const { verb, next } = m.groups!;
        if (!/^\p{Lu}\p{Ll}+$/u.test(next) || /^(?:I|God|Right|Left|Top|Bottom)$/.test(next))
          return null;
        if (/^left$/i.test(verb) && !SUBJECT.test(word(m.input, m.index))) return null;
        return "for";
      },
    },
    {
      pattern: `(?:avoid|avoids|avoided|avoiding|shun|shuns|shunned|shunning)(?:${S}[\\p{L}'’-]+){0,4}${S}like${S}(?<target>a)${S}plague${E}`,
      fix: "the",
    },
    {
      // "some the trees"; "to some the answer is…" and "gave some the answer" stay.
      pattern: `${notAfter("for|to|with|by|from|among|of|and|but|while|give|gave|gives|giving|tell|told|show|showed|offer|offered|send|sent|teach|taught|bring|brought")}(?<target>some${S})the${S}(?=\\p{L})`,
      fix: "some of ",
    },
    {
      pattern: `once${S}(?<target>a)${S}while${E}(?!${S}(?:back|ago|later|before|earlier|longer|now|loop|loops|statement|block|condition|clause)${E})`,
      fix: "in a",
    },
    { pattern: `(?<target>on)${S}(?:(?:a|the)${S})?first${S}glance(?!\\p{L})`, fix: "at" },
    {
      pattern: `(?:my|his|her|our|their|your|a)${S}second${S}(?<target>though)${S}(?:is|was)${S}that${E}`,
      fix: "thought",
    },
    {
      pattern: `(?:learn|learns|learning|learned|learnt|study|studies|studying|studied|teach|teaches|teaching|taught|identify|identifying|identified|tag|tagging|tagged)${S}(?:the${S})?(?<target>parts?${S}of${S}speeches)${E}(?!${S}(?:by|from|given|made|delivered|of|at|in|during)${E})`,
      fix: "parts of speech",
    },
    { pattern: `(?<target>to${S}worried)${S}about${E}`, fix: ["to worry", "too worried"] },
    {
      pattern: `(?=suppose${S})(?<=(?:(?<![\\p{L}'’])(?:is|are|am|was|were|be|been|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)|(?<!let)['’](?:s|re|m))${S})(?<target>suppose)${S}to${E}`,
      fix: "supposed",
    },
    { pattern: `(?<target>suppose)${S}to${COMPLETE}`, fix: "supposed" },
    {
      // "lot's of" is "lots of"; "the parking lot's on fire" is a possessive or "lot is".
      pattern: `${notAfter(`${DETERMINERS}|parking|car|whole|vacant|empty|one|building|school|back|front`)}(?<target>lot['’]s)${S}(?:of|to|on)${E}`,
      fix: "lots",
    },
  ],
  englishClosedCompounds: [
    {
      pattern: `(?:to|as|for|than|by|with|unto|about)${S}(?<target>one['’]s${S}self)${E}`,
      fix: "oneself",
    },
    {
      pattern: `(?:look|looks|looked|looking)${S}(?<target>in${S}to)${S}(?:what|who|whom|whose|where|when|why|how|which|whichever|whoever|whomever|whenever|wherever|whether|whatever)${E}`,
      fix: "into",
    },
    {
      pattern: `(?:to|will|would|can|could|should|must|might|may|shall|please)${S}(?<target>backout)${E}`,
      fix: "back out",
    },
  ],
  stylePhrasing: [
    // "suffice it to say" is the set form; "a word will suffice to say it" stays.
    {
      pattern: `(?=suffice)(?<=${CLAUSE}|(?<![\\p{L}])(?:but|and|so|yet|well)${S})(?<target>suffice${S})to${S}say${E}`,
      fix: "suffice it ",
    },
    { pattern: `(?<target>in)${S}some${S}degree${COMPLETE}`, fix: "to" },
    {
      // "send an email to the team" is "email the team"; "send an email to confirm" and the
      // passive "was sent an email to…" stay.
      pattern: `${notAfter("is|are|am|was|were|be|been|being|get|gets|got|getting")}(?<target>(?<verb>send|sends|sent|sending)${S}an${S}e-?mail${S}to)${S}(?<next>\\p{L}+)${E}`,
      fix: (m) => {
        const next = m.groups!.next.toLowerCase();
        const info = englishWordInfo(next);
        // A noun closing the clause is the recipient: "send an email to support."
        const recipient =
          !!info?.noun &&
          /^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(
            m.input.slice(m.index + m[0].length, m.index + m[0].length + 9),
          );
        if (!OBJECT.test(next) && !recipient && info?.verbs.some((v) => v.form === "base"))
          return null;
        return EMAIL[m.groups!.verb.toLowerCase()];
      },
    },
  ],
};

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = frameDetectors(FRAMES);
