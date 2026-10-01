import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { COMPLETE, frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

const S = SPACE;
const E = WORD_END;

/** One row per word: `~` stands for the word in every typed form and replacement. */
const each = (
  words: readonly string[],
  typed: string | readonly string[],
  replacement: string | readonly string[],
): PhraseRow[] =>
  words.map((word) => [
    [typed].flat().map((form) => form.replace("~", word)),
    [replacement].flat().map((form) => form.replace("~", word)),
  ]);
/** Singular and plural rows: `~` is "" or "s". */
const plural = (typed: string | readonly string[], replacement: string | readonly string[]) =>
  each(["", "s"], typed, replacement);
const GO = ["go", "goes", "went", "going", "gone"];
const TAKE = ["take", "takes", "took", "taken", "taking"];
const LAST_DITCH = ["effort", "attempt", "bid", "option", "measure", "push", "stand", "fix"];
const SOMEBODY = ["somebody", "someone", "anybody", "anyone", "everybody", "everyone", "nobody"];

/** Misheard idioms and wrong words in set phrases. */
export const PHRASES: readonly PhraseRow[] = [
  ...each(["it's", "that's", "is", "was"], "~ here nor there", "~ neither here nor there"),
  ...each(["after", "afterward", "afterwards"], "not along ~", "not long ~"),
  ...plural("ticking time clock~", ["ticking time bomb~", "ticking clock~"]),
  ["the another", "the other"],
  ["out of sink", ["out of sync", "out of synch"]],
  ...each(GO, ["~ through great lengths", "~ to a great length"], "~ to great lengths"),
  ["read and writes", ["reads and writes", "read and write"]],
  ...each(TAKE, "~ it personal", "~ it personally"),
  ...["doubly", "singly", "circular"].flatMap((kind) =>
    plural(`${kind} link list~`, `${kind} linked list~`),
  ),
  ...plural("double-link list~", "double-linked list~"),
  ...plural("link list implementation~", "linked list implementation~"),
  ["underneath of", ["underneath", "under"]],
  ...plural(["highly kept secret~", "highly-kept secret~"], "well-kept secret~"),
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
  [["rule of thumbs", "rule-of-thumbs", "rules of thumbs"], "rules of thumb"],
  ["in top of", "on top of"],
  ["on top off", "on top of"],
  ...LAST_DITCH.flatMap((noun) =>
    plural(
      [`last ditch ${noun}~`, `last ditched ${noun}~`, `last-ditched ${noun}~`],
      `last-ditch ${noun}~`,
    ),
  ),
  ["managerial reigns", "managerial reins"],
  ...plural("slippy slope~", "slippery slope~"),
  [["not without a lack of", "not without lack of"], "not for lack of"],
  ["trail and error", "trial and error"],
  ["line of codes", ["lines of code", "line of code"]],
  ["lines of codes", "lines of code"],
  ...each(["luck", "genius"], "strike of ~", "stroke of ~"),
  ...each(["luck", "genius"], "strikes of ~", "strokes of ~"),
  ["the entire of", "the entirety of"],
  ["without out", "without"],
  ...plural("sneaky suspicion~", "sneaking suspicion~"),
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
  ...plural("worst case scenario~", "worst-case scenario~"),
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
const MESSAGES = {
  englishPhraseCorrections: "review_msg_phrase_correction",
  englishClosedCompounds: "review_msg_closed_compound",
  stylePhrasing: "review_msg_style_phrasing",
} as const;
/** A frame's `target` group is replaced; `fix` may veto (null) after a closer look. */
type Frame = {
  pattern: string;
  fix: string | readonly string[] | ((m: RegExpExecArray) => string | readonly string[] | null);
  /** The fix already carries the typed casing. */
  raw?: true;
};

/** Not right after one of these whole words. */
const notAfter = (words: string) => `(?<!(?<![\\p{L}'’])(?:${words})${S})`;
const CLAUSE = `(?:^|[.!?,;:(\\n])[ \\t]*`;
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
        const an = /^(?:[aeio]|u(?!ni|s[aeu]|t)|hour|honest|hono)/i.test(adj) ? "an" : "a";
        return `${adj === adj.toUpperCase() ? an.toUpperCase() : an} ${adj}`;
      },
      raw: true,
    },
    {
      // A verb "laugh of someone"; "the laugh of a child" and "Laughs of joy…" are nouns.
      pattern: `${notAfter(DETERMINERS)}(?<verb>laugh|laughs|laughed|laughing)${S}(?<target>of)${S}(?<next>\\p{L}+)${E}`,
      fix: (m) => {
        const { verb, next } = m.groups!;
        if (/s$/i.test(verb) && new RegExp(`${CLAUSE}$`).test(m.input.slice(0, m.index)))
          return null;
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
      pattern: `(?<=(?:(?<![\\p{L}'’])(?:is|are|am|was|were|be|been|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)|(?<!let)['’](?:s|re|m))${S})(?<target>suppose)${S}to${E}`,
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
      pattern: `(?<=${CLAUSE}|(?<![\\p{L}])(?:but|and|so|yet|well)${S})(?<target>suffice${S})to${S}say${E}`,
      fix: "suffice it ",
    },
    { pattern: `(?<target>in)${S}some${S}degree${COMPLETE}`, fix: "to" },
    {
      // "send an email to the team" is "email the team"; "send an email to confirm" and the
      // passive "was sent an email to…" stay.
      pattern: `${notAfter("is|are|am|was|were|be|been|being|get|gets|got|getting")}(?<target>(?<verb>send|sends|sent|sending)${S}an${S}e-?mail${S}to)${S}(?<next>\\p{L}+)${E}`,
      fix: (m) => {
        const next = m.groups!.next.toLowerCase();
        if (!OBJECT.test(next) && englishWordInfo(next)?.verbs.some((v) => v.form === "base"))
          return null;
        return EMAIL[m.groups!.verb.toLowerCase()];
      },
    },
  ],
};

function detectFrames(ctx: DetectContext, rule: Rule): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, fix, raw } of FRAMES[rule]) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      if (hasUserOrCasedWord(ctx, ctx.text.slice(m.index, Math.max(end, m.index + m[0].length))))
        continue;
      const value = typeof fix === "function" ? fix(m) : fix;
      if (value === null) continue;
      const style = detectWordCase(m.groups!.target.trim());
      const alternatives = [value].flat().map((alt) => (raw ? alt : applyWordCase(alt, style)));
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
  (rule) => ({
    rules: [rule],
    detect: (ctx) => (ctx.lang.startsWith("en") ? detectFrames(ctx, rule) : []),
  }),
);
