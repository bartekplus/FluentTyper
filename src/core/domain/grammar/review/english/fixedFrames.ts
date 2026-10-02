import type { PhraseRow } from "../englishPhraseTables";
import type { ReviewDetectorEntry } from "../reviewDetectors";

// Real words slipped into fixed frames: sound-alikes and one-letter slips that are words
// themselves ("walk down the isle", "looking foreword to", "a bran new car"), idioms with a
// swapped word ("add salt to injury"), and fixed verb, adjective and preposition pairings
// ("do jogging", "superior than", "take into count"). Every row is wrong as typed.

const GO = ["go", "goes", "went", "going", "gone"];
// A subject pronoun with each form: "we do", "she does", "they did".
const SUBJECTS = ["I", "you", "we", "they", "he", "she"];
const third = (p: string) => p === "he" || p === "she";
const DO_SUBJECT = SUBJECTS.flatMap((p) => [`${p} ${third(p) ? "does" : "do"}`, `${p} did`]);
const GO_SUBJECT = SUBJECTS.flatMap((p) => [`${p} ${third(p) ? "goes" : "go"}`, `${p} went`]);
const PLAY_SUBJECT = SUBJECTS.flatMap((p) => [
  `${p} ${third(p) ? "plays" : "play"}`,
  `${p} played`,
]);
const HAVE_SUBJECT = SUBJECTS.flatMap((p) => [`${p} ${third(p) ? "has" : "have"}`, `${p} had`]);
const subjectForms = (typed: string[], plain: string[], rest: string): PhraseRow[] =>
  typed.map((form, i): PhraseRow => [`${form} ${rest}`, `${plain[i]} ${rest}`]);
const BE = ["am", "is", "are", "was", "were", "be", "been", "being"];

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  // Sound-alikes in their set phrases.
  ...["walk", "walks", "walked", "walking"].flatMap((walk): PhraseRow[] => [
    [`${walk} down the isle`, `${walk} down the aisle`],
  ]),
  [
    ["sides of the isle", "side of the isle"],
    ["sides of the aisle", "side of the aisle"],
  ],
  ["across the isle", "across the aisle"],
  ["the air to the throne", "the heir to the throne"],
  ["air apparent", "heir apparent"],
  ["bran new", "brand new"],
  ["bran-new", "brand-new"],
  ["bran awareness", "brand awareness"],
  ["lending page", "landing page"],
  ["lending pages", "landing pages"],
  [["key stokes", "key-stokes"], "keystrokes"],
  ["from bad to worst", "from bad to worse"],
  ...["large", "certain", "great", "lesser", "some", "high"].map((size): PhraseRow => [
    `to a ${size} decree`,
    `to a ${size} degree`,
  ]),
  ["to some decree", "to some degree"],
  ["to what decree", "to what degree"],
  ...["look", "looks", "looked", "looking"].map((look): PhraseRow => [
    `${look} foreword to`,
    `${look} forward to`,
  ]),
  ...["details", "information", "questions", "assistance", "notice", "discussion"].map(
    (noun): PhraseRow => [`farther ${noun}`, `further ${noun}`],
  ),
  ["until farther notice", "until further notice"],
  ...["no", "have", "has", "need", "needs", "gain", "get", "easy", "direct", "full"].map(
    (lead): PhraseRow => [`${lead} excess to`, `${lead} access to`],
  ),
  ["an access of", "an excess of"],
  ["hart of a lion", "heart of a lion"],
  ["hart of gold", "heart of gold"],
  [["unites states", "unite states"], "United States"],
  ["unite kingdom", "United Kingdom"],
  ...["so", "very", "really", "most", "more", "quite", "too"].map((degree): PhraseRow => [
    `${degree} exiting`,
    `${degree} exciting`,
  ]),
  ...["about", "for"].map((prep): PhraseRow => [`exited ${prep}`, `excited ${prep}`]),
  ...["doesn't", "don't", "didn't", "does not", "do not", "did not"].flatMap((not): PhraseRow[] => [
    [`${not} see to be`, `${not} seem to be`],
    [`${not} see to have`, `${not} seem to have`],
    [`${not} see as if`, `${not} seem as if`],
  ]),
  ["dies not know", "does not know"],
  ["what dies that mean", "what does that mean"],
  ...["me", "him", "her", "us", "them"].flatMap((who): PhraseRow[] =>
    ["how", "what", "where", "why", "when", "the truth"].map((what): PhraseRow => [
      `say ${who} ${what}`,
      `tell ${who} ${what}`,
    ]),
  ),
  ["the lest time", "the last time"],
  ...BE.slice(0, 5).map((be): PhraseRow => [`${be} died`, `${be} dead`]),
  ["ass well", "as well"],
  ["ass soon as", "as soon as"],
  ["ass long as", "as long as"],
  ...["the", "these", "those", "my", "our", "them", "us"].map((rest): PhraseRow => [
    `moist of ${rest}`,
    `most of ${rest}`,
  ]),
  ...["I", "we"].flatMap((p): PhraseRow[] => [[`${p} which you`, `${p} wish you`]]),
  ["which you good luck", "wish you good luck"],
  ["which you a happy", "wish you a happy"],
  ["which you all the best", "wish you all the best"],
  ["I hope hat", "I hope that"],
  ...["addend", "to addend"].flatMap((lead): PhraseRow[] => [
    [`${lead} the`, `${lead.replace("addend", "attend")} the`],
    [`${lead} your`, `${lead.replace("addend", "attend")} your`],
  ]),
  [
    ["very ruff", "so ruff", "as ruff as"],
    ["very rough", "so rough", "as rough as"],
  ],
  ["lager than", "larger than"],
  ["greats you", "greets you"],
  ["brows the web", "browse the web"],
  ["brows the internet", "browse the internet"],
  ["fin it", "find it"],
  ["princes diana", "Princess Diana"],
  ["none profit", "non-profit"],
  ["non of", "none of"],
  [
    ["fast paste", "fast-paste"],
    ["fast-paced", "fast paced"],
  ],
  ["your prompt replay", "your prompt reply"],
  ["thanks for your replay", "thanks for your reply"],
  ["replay to my", "reply to my"],
  ["replay to this", "reply to this"],
  // A word written for a near neighbour in a fixed phrase.
  ["all over the word", "all over the world"],
  ["in the entire word", "in the entire world"],
  ["in the whole word", "in the whole world"],
  ...["largest", "biggest", "best", "first", "most", "leading", "oldest", "tallest"].map(
    (top): PhraseRow => [`the word's ${top}`, `the world's ${top}`],
  ),
  ["feel tree to", "feel free to"],
  ...["easiest", "fastest", "quickest", "simplest", "cheapest", "best"].map((top): PhraseRow => [
    `is the ${top} was to`,
    `is the ${top} way to`,
  ]),
  [["et. al.", "et. al"], "et al."],
  ["de juro", "de jure"],
  ["in another words", "in other words"],
  ["another words,", "in other words,"],
  ["I thin you", "I think you"],
  ["I thin that", "I think that"],
  ...["most", "best", "few", "biggest", "worst", "first"].map((top): PhraseRow => [
    `on of the ${top}`,
    `one of the ${top}`,
  ]),
  [
    ["torn a part", "tore a part"],
    ["torn apart", "tore apart"],
  ],
  ["cold not be", "could not be"],
  ["cold have been", "could have been"],
  ...["make", "makes", "made", "making"].map((make): PhraseRow => [
    `${make} us of`,
    `${make} use of`,
  ]),
  ["the us of", "the use of"],
  ["it beings to", "it begins to"],
  ["to being with,", "to begin with,"],
  ["stop been", "stop being"],
  ...["be", "not"].map((be): PhraseRow => [`${be} gong to`, `${be} going to`]),
  ["are dong", "are doing"],
  ["ah ha moment", "aha moment"],
  ...["more", "of", "late", "too", "longer"].map((rest): PhraseRow => [
    `a but ${rest}`,
    `a bit ${rest}`,
  ]),
  ["ling overdue", "long overdue"],
  ["ling time", "long time"],
  ["I'l", "I'll"],
  ...["do", "does", "did", "is", "are", "was", "were", "has", "have", "had"].flatMap(
    (aux): PhraseRow[] => [[`${aux} n't`, `${aux}n't`]],
  ),
  ...["could", "would", "should"].map((modal): PhraseRow => [`${modal} n't`, `${modal}n't`]),
  ["did' t", "didn't"],
  [
    ["has not bee", "have not bee", "had not bee"],
    ["has not been", "have not been", "had not been"],
  ],
  ...["can", "could", "will", "would", "should", "must"].flatMap((modal): PhraseRow[] => [
    [`${modal} be see`, `${modal} be seen`],
    [`${modal} be seem`, `${modal} be seen`],
  ]),
  ...["used", "spelt", "placed", "led", "judged", "matched"].map((verb): PhraseRow => [
    `miss ${verb}`,
    `mis${verb}`,
  ]),
  ["your helps", "your help"],
  ["the united state", "the United States"],
  ["were're", "we're"],
  ...["sound", "look", "seem", "feel", "smell", "taste"].map((verb): PhraseRow => [
    `${verb} slike`,
    `${verb}s like`,
  ]),
  ...["it", "we", "you", "they"].map((p): PhraseRow => [`${p} cam`, `${p} can`]),
  ["in mu opinion", "in my opinion"],
  ["mu own", "my own"],
  ...["best", "first", "same", "most", "last"].map((top): PhraseRow => [
    `thee ${top}`,
    `the ${top}`,
  ]),
  ["breath of scope", "breadth of scope"],
  ["breath of knowledge", "breadth of knowledge"],
  ["breath of experience", "breadth of experience"],
  ["a couple or them", "a couple of them"],
  // Idioms with a swapped word.
  ["add salt to injury", "add insult to injury"],
  ["salt to injury", "insult to injury"],
  ["right in my alley", "right up my alley"],
  ["two peas in a pot", "two peas in a pod"],
  [
    ["batter safe than sorry", "better save than sorry", "better safe then sorry"],
    "better safe than sorry",
  ],
  ["better to be save than sorry", "better to be safe than sorry"],
  // Verbs, adjectives and their fixed partners. "do" + activity only after a subject pronoun:
  // "why does jogging help" and "did running come easily" are gerund subjects.
  ...["jogging", "swimming", "running", "hiking", "skiing", "fishing", "camping"].flatMap(
    (activity) => subjectForms(DO_SUBJECT, GO_SUBJECT, activity),
  ),
  ...[
    "soccer",
    "football",
    "tennis",
    "basketball",
    "baseball",
    "golf",
    "volleyball",
    "chess",
  ].flatMap((game) => subjectForms(DO_SUBJECT, PLAY_SUBJECT, game)),
  ...subjectForms(DO_SUBJECT, HAVE_SUBJECT, "a meeting"),
  ...subjectForms(DO_SUBJECT, HAVE_SUBJECT, "a party"),
  ...GO.map((go): PhraseRow => [`${go} to a trip`, `${go} on a trip`]),
  ...BE.flatMap((be): PhraseRow[] => [
    [`${be} on shock`, `${be} in shock`],
    [`${be} in pressure`, `${be} under pressure`],
    [`${be} in a secret mission`, `${be} on a secret mission`],
  ]),
  ...["me", "him", "her", "us", "them", "everyone"].map((who): PhraseRow => [
    `obvious for ${who}`,
    `obvious to ${who}`,
  ]),
  ["superior than", "superior to"],
  ["inferior than", "inferior to"],
  ["more inferior than", "inferior to"],
  ["more superior than", "superior to"],
  ...["search", "searched", "searching", "find", "found", "read", "published"].map(
    (verb): PhraseRow => [`${verb} in the internet`, `${verb} on the internet`],
  ),
  ["today morning", "this morning"],
  ["today afternoon", "this afternoon"],
  ["today evening", "this evening"],
  ["today night", "tonight"],
  ["in nowadays", "nowadays"],
  ["countless of", "countless"],
  ...["take", "takes", "took", "taking", "taken"].flatMap((take): PhraseRow[] =>
    ["", "it ", "this ", "that ", "them "].flatMap((what): PhraseRow[] => [
      [`${take} ${what}into count`, `${take} ${what}into account`],
      [`${take} ${what}in to account`, `${take} ${what}into account`],
    ]),
  ),
  [["passionate by", "passionated by"], "passionate about"],
  [["responsible of", "responsable of"], "responsible for"],
  ["accustomed with", "accustomed to"],
  ["deprived from", "deprived of"],
  ...["get", "gets", "got", "getting", "gotten"].map((get): PhraseRow => [
    `${get} rid from`,
    `${get} rid of`,
  ]),
  ["suffers of", "suffers from"],
  ["aimed on", "aimed at"],
  ["ashamed from", "ashamed of"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];
export const DETECTORS: readonly ReviewDetectorEntry[] = [];
