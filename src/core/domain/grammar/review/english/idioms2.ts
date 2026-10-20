import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import {
  CLAUSE,
  COMPLETE,
  type Frame,
  frameDetectors,
  notAfter,
  SPACE as S,
  WORD_END as E,
} from "../phraseTemplates";
import type { Detector } from "../../engine/reviewRules";

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

// The frame detector of one rule of FRAMES.
const frames = (rule: Rule): Detector => frameDetectors({ [rule]: FRAMES[rule] })[0].detect;

/** The Review detectors by name; grammar/rules/en.yaml sets their checks and order. */
export const PREDICATES = {
  idiomPhrases2: frames("englishPhraseCorrections"),
  idiomCompounds2: frames("englishClosedCompounds"),
  idiomStyle2: frames("stylePhrasing"),
} satisfies Record<string, Detector>;
