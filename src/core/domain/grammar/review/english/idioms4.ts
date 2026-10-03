import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { each, PLURAL, type PhraseRow } from "../englishPhraseTables";
import {
  type Frame,
  frameDetectors,
  type FrameRule,
  notAfter,
  SPACE as S,
  WORD_END as E,
} from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";

const DIG: [string, string][] = [
  ["dig", "look"],
  ["digs", "looks"],
  ["dug", "looked"],
  ["digging", "looking"],
];
// "in this day in age", "these days and age": every misheard shape of "in this day and age".
const DAY_AND_AGE = [
  "this day in age",
  "this day an age",
  "this day of age",
  "this day and ages",
  "this day in ages",
  "this days and age",
  "these day and age",
  "these day in age",
  "these days and age",
  "these days and ages",
  "these days in age",
];
const REASONS = [
  "obvious",
  "other",
  "financial",
  "security",
  "similar",
  "various",
  "several",
  "technical",
  "personal",
  "legal",
  "historical",
  "practical",
  "performance",
  "compatibility",
  "safety",
  "health",
  "privacy",
  "unknown",
  "different",
  "multiple",
  "numerous",
  "political",
  "business",
];
const IT_IS = ["it's", "it is", "it was", "that's", "that is"];
const HEREBY = [
  "declare",
  "declares",
  "declared",
  "grant",
  "grants",
  "granted",
  "certify",
  "certifies",
  "certified",
  "agree",
  "confirm",
  "acknowledge",
  "authorize",
  "authorise",
  "authorized",
  "authorised",
  "give",
  "notify",
  "resign",
  "accept",
  "release",
  "waive",
  "appoint",
  "consent",
  "revoke",
  "affirm",
];

/** Rows for englishPhraseCorrections. */
export const PHRASES: readonly PhraseRow[] = [
  [DAY_AND_AGE.map((form) => `in ${form}`), "in this day and age"],
  [
    // "people of this day and age" is correct: "of" only goes with a misspelled form.
    ["at", "by", "is", "it", "of", "to"].flatMap((word) => [
      ...(word === "of" ? [] : [`${word} this day and age`]),
      ...DAY_AND_AGE.map((form) => `${word} ${form}`),
    ]),
    "in this day and age",
  ],
  [DAY_AND_AGE, "in this day and age"],
  ["far be it for", "far be it from"],
  ["fascinated about", ["fascinated by", "fascinated with"]],
  ["fed up of", "fed up with"],
  ...["first aid", "first-aid", "starter", "travel", "tool"].flatMap((kind) =>
    each(PLURAL, `${kind} kid~`, `${kind} kit~`),
  ),
  [["fish nor bird", "fish nor foul"], "fish nor fowl"],
  [["full fleshed", "full pledged", "full fledge"], "full fledged"],
  [["full-fleshed", "full-pledged", "full-fledge"], "full-fledged"],
  ["fully pledged", "fully fledged"],
  ["fully-pledged", "fully-fledged"],
  ["fully fledged out", ["fully fleshed out", "fully fledged"]],
  ["fully-fledged out", ["fully fleshed out", "fully-fledged"]],
  ...each(
    [
      ["fledge", "flesh"],
      ["fledges", "fleshes"],
      ["fledged", "fleshed"],
      ["fledging", "fleshing"],
    ],
    "~ out",
    "~ out",
  ),
  ["a hand full of", "a handful of"],
  [["hand-full of", "hand - full of"], "handful of"],
  ...each(["jump", "jumps", "jumped", "jumping"], ["~ a gun", "~ the guns"], "~ the gun"),
  ["led rise to", "gave rise to"],
  ...each(["has", "have", "had"], ["~ led rise to", "~ lead rise to"], "~ given rise to"),
  ["lead rise to", ["give rise to", "gave rise to"]],
  ["leads rise to", "gives rise to"],
  ["leading rise to", "giving rise to"],
  ...each(
    ["leave", "leaves", "left", "leaving", "flee", "flees", "fled", "fleeing", "quit"],
    "~ in drones",
    "~ in droves",
  ),
  ...each(IT_IS, "~ little known fact", "~ a little known fact"),
  ...each(IT_IS, "~ little-known fact", "~ a little-known fact"),
  ...each(IT_IS, "~ a little known that", "~ little known that"),
  ...each(IT_IS, "~ a little-known that", "~ little-known that"),
  ...each(
    ["someone", "anyone", "everyone", "no one", "somebody", "anybody", "everybody", "nobody"],
    "~ elses",
    "~ else's",
  ),
  ["for same reason", "for the same reason"],
  ...each(REASONS, "for ~ reason", "for ~ reasons"),
];
export const COMPOUNDS: readonly PhraseRow[] = [
  ...each(HEREBY, "here by ~", "hereby ~"),
  ...["left", "right"].flatMap((side) =>
    ["side", "corner", "column", "pane", "panel", "menu", "edge", "margin", "sidebar"].flatMap(
      (part) => each(PLURAL, `${side} hand ${part}~`, `${side}-hand ${part}~`),
    ),
  ),
];
/** Mixed metaphors: "dig under the hood" blends "dig into" and "look under the hood". */
export const STYLE: readonly PhraseRow[] = [
  ...each(DIG, "~ under the hood", "~ under the hood"),
  ...each(DIG, "~ under the bonnet", "~ under the bonnet"),
];

// ---- Context frames: forms that are also ordinary English elsewhere. ----

/** Only spaces, then closing punctuation or the end of the text. */
const CLOSES = `(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)"”]|$))`;
/**
 * The start of a sentence or line, an opening quote allowed. Frames check their word first
 * (`(?=word)`): tried at every position of a long run of spaces, this lookbehind rereads the
 * run each time in JavaScriptCore.
 */
const SENTENCE = `(?<=(?:^|[.!?\\n]["”’)]*)[ \\t\\u00a0]*["“'‘(]?)`;
const DETERMINER =
  "the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|all|every|each";
const OBJECT = new Set(
  `${DETERMINER}|it|them|me|him|us|you`.split("|").map((word) => word.toLowerCase()),
);
const SUBJECT_START = new Set(
  `${DETERMINER}|it|you|we|they|he|she|i|there|many|most|no|both|nobody|nothing|everyone|everybody|everything|someone|somebody|something|anyone|anybody|anything`.split(
    "|",
  ),
);
// Words after "in demand" / "in depth" that close the phrase instead of naming a noun.
const NOT_MODIFIED =
  /^(?:by|today|these|those|this|that|now|nowadays|than|as|and|or|but|in|on|at|for|to|of|with|right|here|there|again|too|also|lately|recently|since|during|among|across|everywhere|worldwide|anymore|yet|then|when|while|because|if)$/i;
const capitalized = (word: string) => /^\p{Lu}/u.test(word);
const MAKE: Record<string, string> = {
  do: "make",
  does: "makes",
  did: "made",
  doing: "making",
  done: "made",
};
const GO: Record<string, string> = {
  become: "go",
  becomes: "goes",
  became: "went",
  becoming: "going",
};
const OURS: Record<string, string> = {
  me: "mine",
  you: "yours",
  us: "ours",
  him: "his",
  them: "theirs",
};
// "how come", "how dare you" and "how people…" are not a missing "to".
const NOT_HOW_TO = new Set(
  "come dare do go people be say mean will can may might must shall should would could".split(" "),
);
const ORDINAL =
  "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|(?:thir|four|fif|six|seven|eigh|nine)teenth|twentieth|thirtieth|hundredth|thousandth|millionth|billionth|umpteenth|nth|last|[0-9]+(?:st|nd|rd|th))";
const LENGTH = `(?:[0-9][0-9,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|a${S}hundred|hundreds${S}of|several|a${S}few)`;

const FRAMES: readonly (Frame & { rule: FrameRule })[] = [
  // ---- englishPhraseCorrections ----
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:cure|cures|cured|curing)${S}(?<target>against)${E}`,
    fix: "for",
  },
  {
    // "despite it is": "despite" takes a noun; a clause needs "although".
    rule: "englishPhraseCorrections",
    pattern: `(?<target>despite)${S}(?:I|you|we|they|he|she|it|there)${S}(?:am|is|are|was|were|has|have|had|do|does|did|can|could|will|would|should|may|might|must)${E}`,
    fix: ["although", "despite the fact that"],
  },
  {
    // "did the mistake" is "made"; "Did that mistake…" and "where did the mistake…" ask.
    // The core table owns "do/did/doing a mistake".
    rule: "englishPhraseCorrections",
    pattern: `(?=do|did)(?<!(?:^|[.!?\\n]["”’)]*)[ \\t\\u00a0]*["“'‘(]?)${notAfter("where|when|why|how|what|which|whose")}(?!(?:do|did|doing)${S}a${S}mistake${E})(?<target>do|does|did|doing|done)${S}(?:(?:${DETERMINER}|several|many|no|few|more|fewer|such|same|lots${S}of|so${S}many|too${S}many)${S})(?:\\p{L}+${S})?mistakes?${E}`,
    fix: (m) => MAKE[m.groups!.target.toLowerCase()],
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:the|an?)${S}(?:\\p{L}+${S})?(?<target>except)${S}of${E}`,
    fix: "exception",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?<!(?<![\\p{L}'’])(?:the|an?)${S}(?:\\p{L}+${S})?)except${S}(?<target>of)${E}(?!${S}course${E})`,
    fix: "for",
  },
  // "to and fro" keeps its "fro".
  {
    rule: "englishPhraseCorrections",
    pattern: `${notAfter("to|and")}(?<target>fro)${E}`,
    fix: "for",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?<target>for${S})${ORDINAL}${S}time${E}(?:${CLOSES}|(?=${S}(?:and|but|or|so|now|today|in|on|at|since|with|without|because|when|after|before|then|ever|yet|already|again|this|to|of|from|by|i|we|you|he|she|they|it)${E}))`,
    fix: "for the ",
  },
  {
    // "The trial is fee for members": a predicate "free"; "there is a fee" stays.
    rule: "englishPhraseCorrections",
    pattern: `(?<=(?:(?<!there${S})(?<![\\p{L}'’])(?:is|was|are|were|be|been)|(?<!there)['’]s)${S}(?:(?:totally|completely|entirely|absolutely|really|always|now|still|also|actually|just|basically|usually|currently)${S})?)(?<target>fee)${E}(?:${CLOSES}|(?=${S}(?:for|to|and|or|but|forever|now|again|today)${E}))`,
    fix: "free",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:friends?|enem(?:y|ies)|colleagues?|cousins?|neighbou?rs?)${S}of${S}(?<target>me|you|us|him|them)${E}(?!${S}(?:all|both|two|three|guys|folks|and|or)${E})`,
    fix: (m) => OURS[m.groups!.target.toLowerCase()],
  },
  {
    // "full to the brim of the cup" names the brim.
    rule: "englishPhraseCorrections",
    pattern: `(?:full|filled|fill|fills|filling|packed)${S}to${S}the${S}brim${S}(?<target>of)${E}(?!${S}(?:the|a|an|its|each|every)${E})`,
    fix: "with",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:get|gets|got|gotten|getting|go|goes|went|gone|going)${S}(?<target>pass)${S}(?=(?:${DETERMINER})${E})(?!the${S}(?:time|ball|salt|word|test|exam|buck|torch|hat)${E})`,
    fix: "past",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:go|goes|went|going|gone)${S}(?<target>at|in|on)${S}war${E}(?:(?=${S}(?:with|against)${E})|${CLOSES})`,
    fix: "to",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:go|goes|went|going|gone)${S}(?<target>into)${S}sleep${E}(?!${S}(?:mode|modes|state|states|cycle|timer|setting|settings)${E})`,
    fix: "to",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:go|goes|went|gone|going)${S}so${S}far${S}(?<target>to)${S}(?<next>\\p{L}+)${E}`,
    fix: (m) => {
      const next = m.groups!.next;
      return /^(?:even|actually|really|just|literally|also)$/i.test(next) ||
        englishWordInfo(next)?.adverb ||
        (hasVerbForm(next, "base") && !OBJECT.has(next.toLowerCase()))
        ? "as to"
        : null;
    },
  },
  {
    // "not good in python": a skill is "good at"; "good in practice" and "in the long run" stay.
    rule: "englishPhraseCorrections",
    pattern: `(?<![\\p{L}'’])(?:am|is|are|was|were|be|been|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|im|i['’]m|you['’]re|we['’]re|they['’]re|he['’]s|she['’]s|its|it['’]s|not)${S}(?:(?:always|all|so|very|really|pretty|quite|too|particularly|especially|super|extremely|that|not)${S}){0,2}good${S}(?<target>in)${S}(?!(?:${DETERMINER}|practice|theory|general|terms|real|parts|places|moderation|comparison|person|shape|condition|health|spirit|faith|time|production|most${S}(?:cases|situations|respects|ways|places)|many|certain|one|both|red|blue|black|white|green|dark|light)${E})(?=\\p{L})`,
    fix: "at",
  },
  {
    rule: "englishPhraseCorrections",
    // "a handful of more advanced recipes" is "of" plus a comparative.
    pattern: `a${S}handful${S}(?<target>of${S})more${S}(?=(?<next>\\p{L}+)${E})`,
    fix: (m) => {
      const next = englishWordInfo(m.groups!.next);
      return next && !next.noun && !next.plural ? null : "";
    },
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:have|has|had|having)${S}(?<target>(?:(?<adverb>real|really|very|extremely|super|incredibly|particularly|pretty)${S})?hard)${S}time${E}(?!${S}(?:limits?|constraints?|budgets?|deadlines?|requirements?|bounds?|windows?|slots?|frames?)${E})`,
    fix: (m) => {
      const typed = m.groups!.target;
      const an = /^[aeiou]/i.test(typed) ? "an" : "a";
      return `${typed === typed.toUpperCase() ? an.toUpperCase() : an} ${typed}`;
    },
    raw: true,
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?=halo)${SENTENCE}(?<target>halo)(?=[ \\t\\u00a0]*[,!?]|${S}(?:there|world|everyone|everybody|all|guys|folks|friends?|team)${E}|${S}(?<name>\\p{L}+)[ \\t\\u00a0]*[,!.?])`,
    fix: (m) => (m.groups!.name && !capitalized(m.groups!.name) ? null : "hello"),
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `in${S}(?<target>(?<word>favou?r)${S})(?<ing>\\p{L}+ing)${E}`,
    fix: (m) => (hasVerbForm(m.groups!.ing, "ing") ? `${m.groups!.word} of ` : null),
    raw: true,
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?<=(?<![\\p{L}'’])(?:am|is|are|was|were|be|been|being|back|have|has|had|having|keep|keeps|kept|it|them|inventory|not|still|currently|already)${S})(?<target>on)${S}stock${E}(?:${CLOSES}|(?=${S}(?:at|but|or|for|and|in|again|now|yet|anymore|soon|today|until|right|though)${E}))`,
    fix: "in",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `interested${S}(?<target>about|at|into|of|on|with)${E}(?!${S}all${E})`,
    fix: "in",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?:it|this)${S}(?:looks|looked|seems|seemed)${S}like${S}(?<target>that${S})(?<next>\\p{L}+)${E}`,
    fix: (m) => {
      const next = m.groups!.next;
      return SUBJECT_START.has(next.toLowerCase()) ||
        capitalized(next) ||
        (hasVerbForm(next, "ing") && !englishWordInfo(next)?.noun)
        ? ""
        : null;
    },
  },
  {
    // "I would be a shame": the impersonal subject is "it".
    rule: "englishPhraseCorrections",
    pattern: `(?<target>I)${S}(?:would|might|will|could|may|should)(?:${S}not)?${S}be${S}(?:a${S}(?:(?:real|great|huge|big|total|terrible|crying)${S})?(?:shame|pity|bummer)|an?${S}(?:good|bad|great|better|nice|terrible|smart|wise|cool|neat)${S}idea)${E}`,
    fix: (m) =>
      new RegExp(`${SENTENCE}$`, "u").test(m.input.slice(Math.max(0, m.index - 8), m.index))
        ? "It"
        : "it",
    raw: true,
  },
  {
    // "jealous from within", "jealous from 2010 on": "from" starts a place or a time.
    rule: "englishPhraseCorrections",
    pattern: `jealous${S}(?<target>from)${E}(?!${S}(?:within|without|then|now|day|birth|childhood|the${S}(?:start|beginning|outset)|[0-9]))`,
    fix: "of",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `${notAfter("a|very|so|too|how|the|this|that|really|pretty|quite|such|fairly|extremely|super|rather|not")}(?<target>long)${S}time${S}ago${E}`,
    fix: "a long",
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?<target>(?<verb>look|looks|looked|looking)${S}(?<owner>my|your|his|her|its|our|their|one['’]s)${S}(?<nose>noses?)${S}down)${E}`,
    fix: (m) => `${m.groups!.verb} down ${m.groups!.owner} ${m.groups!.nose}`,
    raw: true,
  },
  {
    // "if I would've known": the past conditional takes "had".
    rule: "englishPhraseCorrections",
    pattern: `if${S}(?:I|you|we|they|he|she|it|(?:the|that|this|my|your|his|her|our|their)${S}\\p{L}+)${S}(?<target>would['’]ve|would${S}have|would${S}of|had['’]ve|hadve|had${S}of|had${S}have)${S}(?<done>\\p{L}+)${E}`,
    fix: (m) => {
      const done = m.groups!.done.toLowerCase();
      return done === "been" || englishWordInfo(done)?.verbs.some((v) => v.form === "participle")
        ? "had"
        : null;
    },
  },
  {
    rule: "englishPhraseCorrections",
    pattern: `(?<target>for${S}free${S}of${S}charge)${E}(?:${CLOSES}|(?=${S}(?:for|to|and|or|but|are|is|was|were|in|on|at|with|by|if|as|so|from|via|until|since|because|anything)${E}))`,
    fix: ["free of charge", "for free"],
  },
  // ---- other rules ----
  {
    rule: "englishCountability",
    pattern: `(?:against|detect|detects|detected|detecting|select|selects|selected|selecting|vehicle|car|road)${S}(?<target>damages)${E}`,
    fix: "damage",
  },
  {
    rule: "englishCountability",
    pattern: `(?:types?|kinds?|sorts?)${S}of${S}(?<target>damages)${S}(?:on|of)${E}`,
    fix: "damage",
  },
  {
    // "in despite of" is an old fixed form. englishFixedPrepositions keeps its narrow evidence.
    rule: "englishPhraseCorrections",
    pattern: `${notAfter("in")}despite${S}(?<target>of${S})(?=\\p{L})`,
    fix: "",
  },
  {
    rule: "englishSubjectVerbAgreement",
    pattern: `(?=has)${SENTENCE}(?<target>has)${S}(?:I|we|you|they)${E}(?![/.-])`,
    fix: "have",
  },
  {
    rule: "englishAuxiliaryBaseVerb",
    pattern: `how${S}(?:does|do|did)${S}(?:it|that|this|he|she|one)${S}(?<target>compared|compares)${S}(?:to|with)${E}`,
    fix: "compare",
  },
  {
    // "how install Rust": "how" before a bare verb and its object needs "to".
    rule: "englishVerbComplements",
    pattern: `how${S}(?<target>\\p{L}+)${S}(?<next>\\p{L}+)${E}`,
    fix: (m) => {
      const { target, next } = m.groups!;
      const verb = englishWordInfo(target);
      if (
        capitalized(target) ||
        NOT_HOW_TO.has(target.toLowerCase()) ||
        !verb?.verbs.some((v) => v.form === "base") ||
        verb.adjective ||
        verb.adverb
      )
        return null;
      const object = englishWordInfo(next);
      return OBJECT.has(next.toLowerCase()) ||
        capitalized(next) ||
        hasVerbForm(next, "ing") ||
        // "how form submissions are…": a noun before a noun is a compound subject.
        (!verb.noun && (object ? object.noun && !object.verbs.length : next.length > 5))
        ? `to ${target}`
        : null;
    },
    raw: true,
  },
  {
    // "Need help, its critical": "it's" before a lone predicate adjective.
    rule: "englishItsContext",
    pattern: `(?<=,${S}|(?<![\\p{L}'’])(?:because|since|so|but|and|if|when|think|hope|guess|know|sure)${S})(?<target>its)${S}(?<adjective>\\p{L}+)(?:(?=${S}(?:for|to|that|because|and|but|if|when|now|again|too|enough|here|there|anyway|though|since|as)${E})|${CLOSES})`,
    fix: (m) => {
      const word = englishWordInfo(m.groups!.adjective);
      return word?.adjective && !word.noun && !word.verbs.length ? "it's" : null;
    },
  },
  {
    rule: "englishClosedCompounds",
    pattern: `(?=hand)${SENTENCE}(?<target>hand${S}full)${S}of${E}`,
    fix: "handful",
  },
  {
    rule: "englishClosedCompounds",
    pattern: `(?<target>like${S}wise)(?=[ \\t\\u00a0]{0,8}[,;.!?])`,
    fix: "likewise",
  },
  {
    rule: "englishClosedCompounds",
    pattern: `(?<target>fully(?<joint>-|${S})fleshed)${E}(?!${S}out${E})`,
    fix: (m) => [`fully${m.groups!.joint}fledged`, `fully${m.groups!.joint}fleshed out`],
  },
  {
    rule: "englishContextualCompounds",
    pattern: `(?:more|most|very|quite|pretty|really|fairly|less|so|too|an|a)${S}(?<target>in${S}depth)${E}`,
    fix: "in-depth",
  },
  {
    // "an in depth review", "most in demand skills": a modifier before its noun.
    rule: "englishContextualCompounds",
    pattern: `(?:of|for|with|and|the|some|more|most|very|highly|less|so)${S}(?<target>in${S}(?<noun>depth|demand))${S}(?<next>\\p{L}+)${E}`,
    fix: (m) => {
      const word = m.groups!.next;
      const next = englishWordInfo(word);
      if (
        NOT_MODIFIED.test(word) ||
        (next ? next.adverb || !(next.noun || next.adjective) : word.length < 6)
      )
        return null;
      return `in-${m.groups!.noun.toLowerCase()}`;
    },
  },
  {
    rule: "stylePhrasing",
    // "has become missing" stays; "become missing children" names a group.
    pattern: `${notAfter("have|has|had|having")}(?<!['’](?:ve|d)${S})(?<target>become|becomes|became|becoming)${S}missing${E}(?:${CLOSES}|(?=${S}(?:and|but|or|from|in|on|at|after|when|because|again|too|for|during|without|since|while|if|then|so|\\p{L}+ly)${E}))`,
    fix: (m) => GO[m.groups!.target.toLowerCase()],
  },
  {
    // "implement it into the app": a feature is implemented "in" something.
    rule: "stylePhrasing",
    pattern: `(?:implement|implements|implemented|implementing)(?:${S}[\\p{L}\\p{N}]+){0,3}?${S}(?<target>into)${E}`,
    // "implements Into" names a Rust trait.
    fix: (m) => (capitalized(m.groups!.target) ? null : "in"),
  },
  {
    rule: "styleRedundancy",
    pattern: `(?<target>fellow${S})(?=co(?:-|${S})?(?:workers?|hosts?|authors?|founders?|maintainers?|contributors?|creators?|developers?|organi[sz]ers?|pilots?|owners?|presenters?|stars?)${E})`,
    fix: "",
  },
  {
    rule: "styleRedundancy",
    pattern: `(?:fall|falls|fell|falling|fallen)${S}${LENGTH}${S}(?:feet|foot|ft|meters?|metres?|m|yards?|miles?|stories|storeys|floors)(?<target>${S}below)${E}(?:${CLOSES}|(?=${S}(?:and|but|then)${E}))`,
    fix: "",
  },
  {
    rule: "styleRedundancy",
    pattern: `(?<target>in${S})(?:[0-9]+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|a${S}few|several|a${S}couple${S}of)${S}(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?)${S}from${S}now${E}`,
    fix: "",
  },
];

const BY_RULE = new Map<FrameRule, Frame[]>();
for (const frame of FRAMES) BY_RULE.set(frame.rule, [...(BY_RULE.get(frame.rule) ?? []), frame]);

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = frameDetectors(
  Object.fromEntries(BY_RULE),
);
