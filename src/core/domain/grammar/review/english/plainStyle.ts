import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { STYLE_PHRASES, type PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";
import { finding } from "../finding";

// Plain and informal English, all optional except a few set phrases nobody means as typed:
// redundant pairs in every verb form ("combined together"), wordy officialese ("utilize",
// "for the purpose of"), slang reductions ("wanna", "gotta"), weak intensifiers ("extremely
// tired" -> "exhausted"), regional vocabulary under the dialect rules, and formal negative
// questions ("Why do not you" -> "Why don't you").

/** Every form of a regular or listed verb: base, -s, past, -ing. */
function verbForms(lemma: string): string[] {
  const forms = [lemma];
  for (const form of ["third", "past", "ing"] as const) {
    const inflected = englishLexiconInflect(lemma, form);
    if (inflected) forms.push(inflected);
  }
  return forms;
}
/** Rows for a verb + word ("combine together") to the bare verb, in each matching form. */
function verbWith(lemma: string, extra: string, plain = lemma): PhraseRow[] {
  const typed = verbForms(lemma);
  const plainForms = verbForms(plain);
  if (plainForms.length !== typed.length) return [[`${lemma} ${extra}`, plain]];
  return typed.map((form, i): PhraseRow => [`${form} ${extra}`, plainForms[i]]);
}
/** Rows for one verb to another, form by form ("utilizes" -> "uses"). */
function verbFor(lemma: string, plain: string): PhraseRow[] {
  const typed = verbForms(lemma);
  const plainForms = verbForms(plain);
  return typed.length === plainForms.length
    ? typed.map((form, i): PhraseRow => [form, plainForms[i]])
    : [[lemma, plain]];
}

/** Rows for englishPhraseCorrections: set phrases written wrong, never meant as typed. */
export const PHRASES: readonly PhraseRow[] = [
  // Not "one for all and all for one".
  ["all and all,", "all in all,"],
  ...["it", "it's", "I", "we", "the", "this", "that"].map((next): PhraseRow => [
    `all and all ${next}`,
    `all in all ${next}`,
  ]),
  ["ever so often", "every so often"],
  ["early adapter", "early adopter"],
  ["early adapters", "early adopters"],
  ["money is no option", "money is no object"],
  ["now and days", "nowadays"],
  [["round a bouts", "round abouts"], "roundabouts"],
  ["qui bono", "cui bono"],
  ["along the same vein", "in the same vein"],
  ["makes since", "makes sense"],
  ["makes no since", "makes no sense"],
  ["make any since", "make any sense"],
  ["make more since", "make more sense"],
  [
    ["doesn't make since", "does not make since"],
    ["doesn't make sense", "does not make sense"],
  ],
  ["thank you much", ["thank you so much", "thank you very much"]],
  ["bestest", "best"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];

const EXISTING = new Set(STYLE_PHRASES.flatMap(([typed]) => [typed].flat()));

/** Rows for stylePhrasing (optional). */
const STYLE_ROWS: PhraseRow[] = [
  // A verb that already says "together", "back", "again" or "forward".
  ...[
    ...["combine", "join", "merge", "blend", "mix", "collaborate", "cooperate", "unite"],
    ...["associate", "connect", "link", "fuse", "weld", "assemble", "gather", "huddle"],
  ].flatMap((verb) => verbWith(verb, "together")),
  ...["revert", "reply", "refer", "retreat", "recede", "return"].flatMap((verb) =>
    verbWith(verb, "back"),
  ),
  ...["repeat", "reiterate", "restate", "resume", "reread", "redo", "retry"].flatMap((verb) =>
    verbWith(verb, "again"),
  ),
  ...["proceed", "progress", "advance"].flatMap((verb) => verbWith(verb, "forward")),
  ...["descend", "plummet", "plunge"].flatMap((verb) => verbWith(verb, "down")),
  ...["ascend"].flatMap((verb) => verbWith(verb, "up")),
  ...["commute"].flatMap((verb) => verbWith(verb, "back and forth")),
  ...verbWith("continue", "to remain", "remain"),
  // An adjective that needs no help.
  [
    ["sufficient enough", "adequate enough"],
    ["sufficient", "adequate"],
  ],
  ["completely unanimous", "unanimous"],
  ["totally unique", "unique"],
  ["directly antithetical", "antithetical"],
  ["approximately about", ["approximately", "about"]],
  ["sworn affidavit", "affidavit"],
  ["sworn affidavits", "affidavits"],
  ["former alumnus", "alumnus"],
  ["former alumni", "alumni"],
  ["honest truth", "truth"],
  ["famous celebrity", "celebrity"],
  ["famous celebrities", "celebrities"],
  ...["classmate", "colleague", "coworker", "co-worker", "teammate"].flatMap(
    (peer): PhraseRow[] => [
      [`fellow ${peer}`, peer],
      [`fellow ${peer}s`, `${peer}s`],
    ],
  ),
  ["work colleague", "colleague"],
  ["work colleagues", "colleagues"],
  ["past memories", "memories"],
  ["foreign imports", "imports"],
  ["therapeutic treatment", "treatment"],
  ["salsa sauce", "salsa"],
  ["chai tea", "chai"],
  ["naan bread", "naan"],
  ["advance planning", "planning"],
  ["plan ahead", "plan"],
  ["planned ahead", "planned"],
  ["first and foremost", "first"],
  ["final conclusion", "conclusion"],
  ["close scrutiny", "scrutiny"],
  ["exact same", "same"],
  ["the reason why", "the reason"],
  ["so therefore", ["so", "therefore"]],
  ["and also", ["and", "also"]],
  ["but however", ["but", "however"]],
  ["because of the fact that", "because"],
  ["originally born in", "born in"],
  ["off of", "off"],
  ["outside of", "outside"],
  ["inside of", "inside"],
  ["all of the", "all the"],
  ["the fall season", "the fall"],
  ["self-admitted", "admitted"],
  ["ask the question", "ask"],
  ["asked the question", "asked"],
  ["introduced for the first time", "introduced"],
  ["on two separate occasions", "twice"],
  ["on a few occasions", "occasionally"],
  ["every now and then", ["occasionally", "now and then"]],
  ["at all times", "always"],
  ["at your earliest convenience", "as soon as you can"],
  ["for the purpose of", ["to", "for"]],
  ["by means of", ["by", "with", "through"]],
  [
    ["in the neighborhood of", "in the neighbourhood of"],
    ["about", "around"],
  ],
  ["in the vicinity of", "near"],
  ["until such time as", "until"],
  ["sooner rather than later", "soon"],
  ["regard as being", "regard as"],
  ["regarded as being", "regarded as"],
  [
    ["in the final analysis", "in the ultimate analysis"],
    ["finally", "in the end"],
  ],
  ["as a matter of fact", ["in fact", "actually"]],
  ["along the lines of", "like"],
  ["in the nature of", "like"],
  ["in the event of", ["if there is", "in case of"]],
  ["in the affirmative", "yes"],
  ["on the occasion of", ["on", "for"]],
  ["your attention is drawn to", ["please see", "please note"]],
  ["draw your attention to", "point out"],
  [["make an attempt to", "make an effort to", "make a try to"], "try to"],
  [["makes an attempt to", "makes an effort to"], "tries to"],
  [["made an attempt to", "made an effort to", "made a try to"], "tried to"],
  [["making an attempt to", "making an effort to"], "trying to"],
  ["make a decision about", "decide on"],
  ["make decisions about", "decide on"],
  ["made a decision about", "decided on"],
  ["has a tendency to", "tends to"],
  ["have a tendency to", "tend to"],
  ["had a tendency to", "tended to"],
  ["is able to", "can"],
  ["are able to", "can"],
  ["at this time", "now"],
  [
    ["above-mentioned", "abovementioned", "aforementioned", "afore-mentioned"],
    ["this", "these"],
  ],
  [
    ["before-mentioned", "beforementioned"],
    ["this", "these"],
  ],
  [
    ["above-listed", "abovelisted"],
    ["this", "these"],
  ],
  ["as per usual", "as usual"],
  ["as per", ["according to", "as"]],
  ["in lieu of", "instead of"],
  ["in the amount of", "for"],
  ["per annum", ["a year", "per year"]],
  ["inasmuch as", ["since", "because"]],
  ["pursuant to", ["under", "in line with"]],
  ["henceforth", "from now on"],
  ["heretofore", "until now"],
  ["notwithstanding", ["despite", "still"]],
  ["utilization", "use"],
  ["assistance", "help"],
  ["remuneration", "pay"],
  ["numerous", "many"],
  ["sufficient", "enough"],
  ["approximately", "about"],
  ["belated", "late"],
  // Officialese verbs, form by form.
  ...verbFor("utilize", "use"),
  ...verbFor("utilise", "use"),
  ...verbFor("facilitate", "help"),
  ...verbFor("assist", "help"),
  ...verbFor("initiate", "start"),
  ...verbFor("terminate", "end"),
  ...verbFor("commence", "start"),
  ...verbFor("ascertain", "learn"),
  ...verbFor("endeavor", "try"),
  ...verbFor("endeavour", "try"),
  ...verbFor("expedite", "speed"),
  ...verbFor("disseminate", "spread"),
  ...verbFor("remunerate", "pay"),
  ...verbFor("procure", "get"),
  ...verbFor("peruse", "read"),
  ...verbFor("ameliorate", "improve"),
  ...verbFor("accentuate", "stress"),
  ...verbFor("solicit", "ask"),
  // Slang and spoken reductions.
  [["gonna", "gunna", "gona", "finna"], "going to"],
  ["wanna to", "want to"],
  ["wanna", "want to"],
  ...["he", "she", "it"].flatMap((p): PhraseRow[] => [
    [`${p} wanna`, `${p} wants to`],
    [`${p} gotta`, [`${p} has to`, `${p} has got to`]],
    [`${p} dunno`, `${p} doesn't know`],
  ]),
  ["gotta", ["have to", "got to", "got a"]],
  ["have gotta", ["have got to", "have got a"]],
  ["'ve gotta", ["'ve got to", "'ve got a"]],
  ["dunno", "don't know"],
  [["tryna", "try'na"], "trying to"],
  [
    ["y'all", "ya'll"],
    ["you all", "all of you"],
  ],
  ["all of y'all", "all of you"],
  [["dontcha", "don'tcha"], "don't you"],
  ["whatcha", ["what are you", "what do you"]],
  ["gotcha", "got you"],
  ["outta", "out of"],
  ["lemme", "let me"],
  ["gimme", "give me"],
  ["kinda", "kind of"],
  ["sorta", "sort of"],
  ["lotta", "lot of"],
  ["hafta", "have to"],
  ["oughta", "ought to"],
  ["coulda", "could have"],
  ["shoulda", "should have"],
  ["woulda", "would have"],
  ["musta", "must have"],
  ["innit", "isn't it"],
  ["coz", "because"],
  ["luv", "love"],
  ["luvs", "loves"],
  [["pls", "plz"], "please"],
  [["thx", "thnx"], "thanks"],
  ["ppl", "people"],
  ["tonite", "tonight"],
  ["anyways", "anyway"],
  ...["I", "I'm", "he's", "she's", "it's", "we're", "they're", "you're"].map((p): PhraseRow => [
    `${p} bout to`,
    `${p} about to`,
  ]),
  ...["he", "she", "they", "we", "you"].map((p): PhraseRow => [
    `${p} bout to`,
    `${p}${p === "he" || p === "she" ? "'s" : "'re"} about to`,
  ]),
  ["here're", "here are"],
  ["there're", "there are"],
  // Nonstandard usage that formal writing avoids.
  ["most everyone", "almost everyone"],
  ["most everybody", "almost everybody"],
  ["most everything", "almost everything"],
  ["most everywhere", "almost everywhere"],
  ["most anyone", "almost anyone"],
  ...["times", "days", "years", "moments", "occasions", "the time", "the day"].map(
    (time): PhraseRow => [`${time} where`, `${time} when`],
  ),
  ["bored of", ["bored with", "bored by"]],
  ["different than", "different from"],
  ["an invite", "an invitation"],
  [["in an alphabetical order", "in alphabetic order"], "in alphabetical order"],
  ["in a chronological order", "in chronological order"],
  ["in a numerical order", "in numerical order"],
  [
    ["light years ago", "light-years ago", "lightyears ago"],
    ["ages ago", "many years ago"],
  ],
  ["upgradation", "upgrade"],
  ["do the needful", "do what is needed"],
  ["annexure", "appendix"],
  ["annexures", "appendices"],
  // An abbreviation that already names its noun: "ATM machine", "PIN number".
  ...(
    [
      ["CD", "disc,disk,discs,disks"],
      ["DVD", "disc,disk,discs,disks"],
      ["ATM", "machine,machines"],
      ["ISBN", "number,numbers"],
      ["LCD", "display,displays"],
      ["HIV", "virus"],
      ["UPC", "code,codes"],
      ["GPS", "system,systems"],
      ["RAM", "memory"],
      ["LAN", "network,networks"],
      ["PDF", "format"],
    ] as const
  ).flatMap(([abbr, nouns]) =>
    nouns
      .split(",")
      .map((noun): PhraseRow => [
        `${abbr.toLowerCase()} ${noun}`,
        /s$/.test(noun) ? `${abbr}s` : abbr,
      ]),
  ),
  ["rio grande river", "Rio Grande"],
  ["mount fujiyama", "Mount Fuji"],
  ["free gifts", "gifts"],
  ...["exaggerates", "exaggerated", "exaggerating", "exaggeration"].flatMap((word): PhraseRow[] => [
    [[`over ${word}`, `over-${word}`, `over${word}`], word],
  ]),
  ["over-exaggerate", "exaggerate"],
  ...["agree", "agrees", "agreed", "disagree", "disagrees", "disagreed"].map((verb): PhraseRow => [
    `${verb} with the fact that`,
    `${verb} that`,
  ]),
  ["the point being is that", "the point is that"],
  ["will in the future", "will"],
  ["incredible to believe", "hard to believe"],
  [["bald-headed", "bald headed"], "bald"],
  ["brief moment", "moment"],
  ["so as to", "to"],
  ["there are also other", "there are other"],
  ["there is also another", "there is another"],
  ["a small number of", "a few"],
  // Dictionaries still list "Web site" beside "website": the closed form is a style choice.
  ["web site", "website"],
  ["web sites", "websites"],
];
export const STYLE: readonly PhraseRow[] = STYLE_ROWS.filter(
  ([typed]) => ![typed].flat().some((form) => EXISTING.has(form)),
);

// "extremely tired" -> "exhausted": one strong adjective for intensifier + plain adjective.
const STRONG: readonly (readonly [string, string | string[]])[] = [
  ["angry", "furious"],
  ["big", ["huge", "enormous"]],
  ["large", ["huge", "enormous"]],
  ["small", "tiny"],
  ["cold", "freezing"],
  ["hot", ["scorching", "boiling"]],
  ["tired", "exhausted"],
  ["hungry", "starving"],
  ["funny", "hilarious"],
  ["scary", "terrifying"],
  ["scared", "terrified"],
  ["ugly", "hideous"],
  ["dirty", "filthy"],
  ["clean", "spotless"],
  ["old", "ancient"],
  ["pretty", "gorgeous"],
  ["beautiful", "stunning"],
  ["bad", ["terrible", "awful"]],
  ["interesting", "fascinating"],
  ["surprising", "astonishing"],
  ["crowded", "packed"],
  ["happy", ["delighted", "thrilled"]],
  ["sad", "heartbroken"],
  ["smart", "brilliant"],
  ["important", "crucial"],
  ["wet", "soaked"],
  ["tasty", "delicious"],
  ["boring", "tedious"],
  ["sure", "certain"],
  ["rich", "wealthy"],
];
const WORD_CHOICE: readonly PhraseRow[] = STRONG.flatMap(([plain, strong]) =>
  ["very", "extremely", "really", "so"].map((adverb): PhraseRow => [`${adverb} ${plain}`, strong]),
);

/** American words with a distinct British one: typed American -> British (englishBritishSpelling). */
const BRITISH_VOCABULARY: readonly PhraseRow[] = [
  ...["take", "takes", "took", "taking", "taken"].flatMap((take): PhraseRow[] => {
    const have = { take: "have", takes: "has", took: "had", taking: "having", taken: "had" }[take]!;
    return [
      [`${take} a bath`, `${have} a bath`],
      [`${take} a shower`, `${have} a shower`],
    ];
  }),
  [
    ["trunk of the car", "car trunk"],
    ["boot of the car", "car boot"],
  ],
  ["zip code", "postcode"],
  ["zip codes", "postcodes"],
  ["movie theater", "cinema"],
  ["movie theaters", "cinemas"],
  ["gas station", "petrol station"],
  ["gas stations", "petrol stations"],
  ["parking lot", "car park"],
  ["parking lots", "car parks"],
  ["cell phone", "mobile phone"],
  ["cell phones", "mobile phones"],
  ["ground beef", "minced beef"],
  ["band-aid", "plaster"],
  ["band-aids", "plasters"],
  [["driver's license", "drivers license"], "driving licence"],
  [["driver's licenses", "drivers licenses"], "driving licences"],
  ["apartment building", "block of flats"],
  ["lunchroom", "canteen"],
  ["elevator", "lift"],
  ["elevators", "lifts"],
  ["garbage can", "rubbish bin"],
  ["trash can", "rubbish bin"],
  ["freeway", "motorway"],
  ["freeways", "motorways"],
];
/** British words with a distinct American one: typed British -> American (englishAmericanSpelling). */
const AMERICAN_VOCABULARY: readonly PhraseRow[] = [
  ...["have", "has", "had", "having"].flatMap((have): PhraseRow[] => {
    const take = { have: "take", has: "takes", had: "took", having: "taking" }[have]!;
    return [
      [`${have} a shower`, `${take} a shower`],
      [`${have} a bath`, `${take} a bath`],
    ];
  }),
  ["at the weekend", "on the weekend"],
  ["at weekends", "on weekends"],
  ["master's dissertation", "master's thesis"],
  ["postcode", "zip code"],
  ["postcodes", "zip codes"],
  ["car park", "parking lot"],
  ["car parks", "parking lots"],
  ["mobile phone", "cell phone"],
  ["mobile phones", "cell phones"],
  ["petrol station", "gas station"],
  ["petrol", "gas"],
  ["lorry", "truck"],
  ["lorries", "trucks"],
  ["motorway", "freeway"],
  ["motorways", "freeways"],
  ["fortnight", "two weeks"],
  ["minced beef", "ground beef"],
];

/** Optional tables with their own rules, indexed with the phrase corrections. */
export const OPTIONAL: readonly {
  rows: readonly PhraseRow[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}[] = [
  { rows: WORD_CHOICE, ruleId: "styleWordChoice", messageKey: "review_msg_word_choice" },
  {
    rows: BRITISH_VOCABULARY,
    ruleId: "englishBritishSpelling",
    messageKey: "review_msg_british_spelling",
  },
  {
    rows: AMERICAN_VOCABULARY,
    ruleId: "englishAmericanSpelling",
    messageKey: "review_msg_american_spelling",
  },
];

type Finding = RawFinding;

// "Why do not you", "Are not you": a negative question puts "not" after the subject or
// contracts it.
// Not "had"/"were": "Had not they..." may be a conditional, which never contracts.
const NEGATIVE_QUESTION = `(?<aux>are|is|am|was|do|does|did|have|has|can|could|will|would|should|must)${S}not${S}(?<subject>I|you|he|she|it|we|they|this|that|there|anyone|someone|everyone|anybody)${E}`;
const CONTRACTED: Record<string, string> = {
  am: "aren't",
  can: "can't",
  will: "won't",
};
const QUESTION_LEADS = new Set("why how what where when who".split(" "));

function negativeQuestions(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, NEGATIVE_QUESTION, null)) {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    const lead = /([A-Za-z]+)[ \t ]+$/.exec(before)?.[1].toLowerCase();
    const start = /(?:^|[.!?\n"“(])[ \t ]*$/.test(before);
    if (!start && !(lead && QUESTION_LEADS.has(lead))) continue;
    if (m.index < ctx.from || m.index >= ctx.to) continue;
    const aux = m.groups!.aux;
    const lower = aux.toLowerCase();
    let contracted = CONTRACTED[lower] ?? `${lower}n't`;
    if (/^[A-Z]/.test(aux)) contracted = contracted[0].toUpperCase() + contracted.slice(1);
    const end = m.index + aux.length + m[0].slice(aux.length).search(/not/) + 3;
    findings.push(
      finding("stylePhrasing", "review_msg_style_phrasing", m.index, end, [contracted]),
    );
  }
  return findings;
}

// "with who you shared", "many of who were": "whom" as the object of a preposition.
const PREPOSITION_WHO = `(?<prep>with|to|from|for|of|in|on|by|about|without|against)${S}(?<who>who|whoever)${E}(?<rest>${S}(?:I|you|he|she|it|we|they|were|are|was|is)${E})?`;
const PARTITIVES = new Set(
  "many some all most none each both few several one two three neither either".split(" "),
);

function whomAfterPrepositions(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PREPOSITION_WHO, "who")) {
    const { prep, who, rest } = m.groups!;
    if (!rest) continue;
    const before = /([A-Za-z]+)[ \t ]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 16), m.index),
    )?.[1];
    const partitive = prep === "of" && !!before && PARTITIVES.has(before.toLowerCase());
    const objectFollows = /^\s+(?:I|you|he|she|it|we|they)$/.test(rest);
    // "of who were" needs a partitive before it; elsewhere a subject must follow.
    if (!(partitive || (objectFollows && prep !== "of"))) continue;
    // "for who I am": "who" completes "be" and stays.
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (
      objectFollows &&
      /^[ \t\u00a0]*(?:am|are|is|was|were|be|['’](?:m|re|s))(?![\p{L}])/u.test(after)
    )
      continue;
    const [start, end] = m.indices!.groups!.who;
    findings.push(
      finding("stylePhrasing", "review_msg_style_phrasing", start, end, [
        who === "whoever" ? "whomever" : "whom",
      ]),
    );
  }
  return findings;
}

// "I always will love you" -> "will always love"; "it often is" -> "is often"; "we go often to
// bed" -> "often go": a frequency adverb goes after a modal or "be" and before a main verb.
const FREQUENCY =
  "always|never|often|sometimes|usually|rarely|seldom|frequently|normally|generally";
const AUX_AFTER = `(?<subject>I|you|he|she|it|we|they|[a-z]+s)${S}(?<adv>${FREQUENCY})${S}(?<aux>will|would|can|could|should|must|might|am|is|are|was|were)${E}`;
const VERB_BEFORE = `(?<subject>I|you|he|she|it|we|they)${S}(?<verb>[a-z]+)${S}(?<adv>often|sometimes|always|usually|rarely|seldom|hardly)${S}(?<next>to|about|in|at|on|as|into|during|here|there)${E}`;

function adverbPositions(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  const add = (start: number, end: number, replacement: string) =>
    findings.push(
      finding("stylePhrasing", "review_msg_adverb_position", start, end, [replacement]),
    );
  for (const m of frameMatches(ctx, AUX_AFTER, "adv")) {
    const { subject, adv, aux } = m.groups!;
    // A noun subject only when it is a plain lowercase plural ("appearances often are").
    if (!/^(?:I|you|he|she|it|we|they)$/i.test(subject) && !englishWordInfo(subject)?.plural)
      continue;
    const [start] = m.indices!.groups!.adv;
    const [, end] = m.indices!.groups!.aux;
    add(start, end, `${aux} ${adv}`);
  }
  for (const m of frameMatches(ctx, VERB_BEFORE, "verb")) {
    const { verb, adv } = m.groups!;
    const read = englishWordInfo(verb);
    // A main verb in the present or past, not a form of "be" or an auxiliary.
    if (!read?.verbs.some((v) => v.form === "base" || v.form === "past" || v.form === "third"))
      continue;
    if (/^(?:am|is|are|was|were|be|been|have|has|had|do|does|did)$/i.test(verb)) continue;
    const [start] = m.indices!.groups!.verb;
    const [, end] = m.indices!.groups!.adv;
    add(start, end, `${adv} ${verb}`);
  }
  return findings;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (...detectors: ((ctx: DetectContext) => Finding[])[]) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US"
      ? []
      : detectors.flatMap((detect) => detect(ctx)).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
// "big in size", "few in number", "bitter in taste": the adjective already names the dimension.
const DIMENSIONS: Record<string, RegExp> = {
  size: /^(?:big|bigger|biggest|small|smaller|smallest|large|larger|largest|tiny|huge|enormous|little|massive|immense)$/,
  shape: /^(?:round|square|oval|circular|rectangular|triangular|spherical|cylindrical)$/,
  colour:
    /^(?:red|redder|blue|green|yellow|black|white|pink|purple|orange|brown|grey|gray|violet)$/,
  color: /^(?:red|redder|blue|green|yellow|black|white|pink|purple|orange|brown|grey|gray|violet)$/,
  number: /^(?:few|fewer|fewest|many|numerous)$/,
  duration: /^(?:brief|briefer|briefest|short|shorter|shortest|long|longer|longest)$/,
  taste: /^(?:bitter|sweet|sour|salty|sweeter|sourer)$/,
  height: /^(?:tall|taller|tallest)$/,
  weight: /^(?:heavy|heavier|heaviest|light|lighter|lightest)$/,
};
const IN_DIMENSION = `(?<adj>[a-z]+)(?<target>${S}in${S}(?<dim>size|shape|colou?r|number|duration|taste|height|weight))(?=[ \\t\\u00a0]*(?:[.!?,;:)]|$)|${S}(?:and|but|or|than|as)${E})`;

function adjectiveInDimension(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, IN_DIMENSION)) {
    const { adj, dim } = m.groups!;
    if (!DIMENSIONS[dim.toLowerCase()]?.test(adj)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
        context: { start: m.index, end },
      }),
    );
  }
  return findings;
}

// "return the book back to her": "return" already goes back.
const RETURN_BACK = `(?:return|returns|returned|returning)${S}(?:it|them|me|you|him|her|us|(?:the|my|your|his|her|our|their|this|that|these|those)(?:${S}[a-z]+){1,2})(?<target>${S}back)${S}to${E}`;

function returnBack(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, RETURN_BACK)].map((m): RawFinding => {
    const [start, end] = m.indices!.groups!.target;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
      context: { start: m.index, end: m.index + m[0].length },
    });
  });
}

// "$55 dollars", "more than 100+ customers": the amount says it twice.
const DOUBLED_AMOUNT = `(?:\\$[0-9][0-9,.]*(?<dollars>${S}dollars?)|more${S}than${S}[0-9][0-9,]*(?<plus>\\+))${E}`;

function doubledAmounts(ctx: DetectContext): RawFinding[] {
  return [
    ...frameMatches(
      ctx,
      DOUBLED_AMOUNT,
      (m) => (m.indices!.groups!.dollars ?? m.indices!.groups!.plus)[0],
    ),
  ].map((m): RawFinding => {
    const [start, end] = m.indices!.groups!.dollars ?? m.indices!.groups!.plus;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
      context: { start: m.index, end },
    });
  });
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["stylePhrasing"],
    detect: english(
      negativeQuestions,
      whomAfterPrepositions,
      adverbPositions,
      adjectiveInDimension,
      doubledAmounts,
      returnBack,
    ),
  },
];
