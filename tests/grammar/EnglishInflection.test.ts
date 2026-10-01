import { describe, expect, test } from "bun:test";
import {
  englishInflect,
  englishLemma,
  type EnglishInflection,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishInflection";
import {
  ENGLISH_VERB_FORMS,
  englishVerbForms,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishVerbForms";

type Case = [word: string, form: EnglishInflection, lemma: string];

const words = (form: EnglishInflection, pairs: string): Case[] =>
  pairs.split(" ").map((pair) => {
    const [word, lemma] = pair.split(">");
    return [word, form, lemma];
  });

// Every regular case also round-trips: englishInflect(lemma, form) === word.
const REGULAR: Case[] = [
  ...words(
    "third",
    "wants>want fixes>fix pushes>push tries>try misses>miss uses>use causes>cause plays>play " +
      "dies>die watches>watch reaches>reach sizes>size deletes>delete creates>create " +
      "updates>update thanks>thank glasses>glass makes>make agrees>agree",
  ),
  ...words(
    "past",
    "forked>fork walked>walk logged>log stopped>stop tried>try applied>apply used>use liked>like " +
      "hoped>hope changed>change merged>merge solved>solve handled>handle enabled>enable " +
      "parsed>parse caused>cause updated>update created>create validated>validate decided>decide " +
      "included>include required>require secured>secure opened>open offered>offer " +
      "developed>develop called>call missed>miss added>add padded>pad erred>err cited>cite " +
      "cleaned>clean loaded>load failed>fail explained>explain controlled>control " +
      "committed>commit preferred>prefer occurred>occur eyed>eye dyed>dye owed>owe aged>age " +
      "danced>dance judged>judge argued>argue queued>queue toggled>toggle styled>style " +
      "typed>type quoted>quote squared>square guided>guide acquired>acquire evaluated>evaluate " +
      "treated>treat persuaded>persuade picked>pick feasted>feast interfered>interfere " +
      "intervened>intervene determined>determine examined>examine compiled>compile " +
      "escaped>escape described>describe invoked>invoke scheduled>schedule showed>show " +
      "fixed>fix played>play enjoyed>enjoy watched>watch laughed>laugh banged>bang " +
      "longed>long plunged>plunge arranged>arrange waltzed>waltz booed>boo founded>found " +
      "sawed>saw happened>happen galloped>gallop " +
      // Spelling alone cannot tell -e or doubling; the dictionary lexicon can.
      "deleted>delete completed>complete targeted>target budgeted>budget edited>edit " +
      "visited>visit united>unite invited>invite labeled>label installed>install " +
      "boycotted>boycott focused>focus biased>bias tasted>taste lasted>last panicked>panic " +
      "agreed>agree freed>free echoed>echo toed>toe hinged>hinge winged>wing buzzed>buzz " +
      "quizzed>quiz cached>cache synced>sync traveled>travel benefited>benefit deterred>deter",
  ),
  ...words("third", "caches>cache buzzes>buzz focuses>focus biases>bias"),
  ...words(
    "ing",
    "visiting>visit editing>edit installing>install traveling>travel focusing>focus " +
      "singeing>singe putting>put",
  ),
  ...words(
    "ing",
    "fixing>fix making>make running>run seeing>see dying>die walking>walk tying>tie " +
      "singing>sing bringing>bring writing>write rewriting>rewrite going>go doing>do lying>lie " +
      "using>use aging>age hoping>hope hopping>hop opening>open beginning>begin " +
      "committing>commit preferring>prefer offering>offer developing>develop listening>listen " +
      "happening>happen arguing>argue continuing>continue handling>handle changing>change " +
      "agreeing>agree fleeing>flee wining>wine winning>win adding>add controlling>control " +
      "taking>take hiding>hide biting>bite skiing>ski",
  ),
];

test.each(REGULAR)("%p (%s) has lemma %p and inflects back", (word, form, lemma) => {
  expect(englishLemma(word, form)).toBe(lemma);
  expect(englishInflect(lemma, form)).toBe(word);
});

test.each([
  ["goes", "third", "go"],
  ["has", "third", "have"],
  ["is", "third", "be"],
  ["went", "past", "go"],
  ["gone", "past", "go"],
  ["was", "past", "be"],
  ["been", "past", "be"],
  ["fled", "past", "flee"],
  ["being", "ing", "be"],
  ["Walked", "past", "walk"],
] as Case[])("irregular %p (%s) has lemma %p", (word, form, lemma) =>
  expect(englishLemma(word, form)).toBe(lemma),
);

test.each(
  [
    // British spellings the en_US lexicon lacks, and dictionary entries spelling two lemmas
    // (bath/bathe). The table owns an irregular verb's past (hanged, lighted).
    "past labelled travelled cancelled bathed hanged",
    "third echoes",
    "ing travelling earring",
    // Not verb forms, or another form of an irregular verb.
    "past bed red need seed feed speed bleed breed exceed proceed shed wed led hundred naked " +
      "seabed found saw lighted goed runned walk wicked rugged ragged jagged wretched beloved " +
      "embed",
    "third this his us bus yes always news series species was walk perhaps sometimes towards " +
      "afterwards besides nowadays",
    "ing thing king ring sing bring string spring during morning nothing ceiling evening " +
      "something ongoing walk pudding herring darling sibling outgoing",
    // Known words that are not verbs at all.
    "past such",
    "ing such",
  ].flatMap((line) => {
    const [form, ...list] = line.split(" ");
    return list.map((word) => [word, form]);
  }) as [string, EnglishInflection][],
)("%p (%s) has no lemma", (word, form) => expect(englishLemma(word, form)).toBeNull());

test.each([
  ["fix", "fixes", "fixed", "fixing"],
  ["try", "tries", "tried", "trying"],
  ["play", "plays", "played", "playing"],
  ["go", "goes", "went", "going"],
  ["stop", "stops", "stopped", "stopping"],
  ["like", "likes", "liked", "liking"],
  ["agree", "agrees", "agreed", "agreeing"],
  ["see", "sees", "saw", "seeing"],
  ["die", "dies", "died", "dying"],
  ["be", "is", null, "being"],
  ["run", "runs", "ran", "running"],
  ["visit", "visits", "visited", "visiting"],
  ["edit", "edits", "edited", "editing"],
  ["limit", "limits", "limited", "limiting"],
  ["target", "targets", "targeted", "targeting"],
  ["abandon", "abandons", "abandoned", "abandoning"],
  ["monitor", "monitors", "monitored", "monitoring"],
  ["begin", "begins", "began", "beginning"],
  ["forget", "forgets", "forgot", "forgetting"],
  ["submit", "submits", "submitted", "submitting"],
  ["emit", "emits", "emitted", "emitting"],
  ["regret", "regrets", "regretted", "regretting"],
  ["compel", "compels", "compelled", "compelling"],
  ["panic", "panics", "panicked", "panicking"],
  ["sync", "syncs", "synced", "syncing"],
  ["focus", "focuses", "focused", "focusing"],
  ["travel", "travels", "traveled", "traveling"],
  ["benefit", "benefits", "benefited", "benefiting"],
  ["deter", "deters", "deterred", "deterring"],
  ["quiz", null, "quizzed", "quizzing"],
  ["echo", null, "echoed", "echoing"],
  ["radio", "radios", "radioed", "radioing"],
  ["eye", "eyes", "eyed", "eyeing"],
  ["singe", "singes", "singed", "singeing"],
  ["hope", "hopes", "hoped", "hoping"],
  ["hop", "hops", "hopped", "hopping"],
  // Known words that are not verbs: "She is such a dear" is not "is suching".
  ["such", null, null, null],
  ["information", null, null, null],
  ["lay", "lays", "laid", "laying"],
  // Another verb's form is not a base; an ambiguous one is also a regular verb.
  ["went", null, null, null],
  ["found", "founds", "founded", "founding"],
])("%p inflects to %p, %p, %p", (lemma, third, past, ing) => {
  expect(englishInflect(lemma, "third")).toBe(third);
  expect(englishInflect(lemma, "past")).toBe(past);
  expect(englishInflect(lemma, "ing")).toBe(ing);
});

describe("agrees with the irregular table", () => {
  test.each(ENGLISH_VERB_FORMS.map((entry) => [entry.lemma, entry] as const))("%p", (_, entry) => {
    expect(englishInflect(entry.lemma, "third")).toBe(entry.third);
    expect(englishInflect(entry.lemma, "past")).toBe(entry.past);
    const ing = englishInflect(entry.lemma, "ing");
    expect(ing).not.toBeNull();
    expect(englishLemma(ing!, "ing")).toBe(entry.lemma);
    // A form shared with another row ("lay") or written on purpose ("saw") abstains.
    const expected = (form: string) =>
      englishVerbForms(form) && !entry.ambiguous.includes(form) ? entry.lemma : null;
    expect(englishLemma(entry.third, "third")).toBe(expected(entry.third));
    expect(englishLemma(entry.past, "past")).toBe(expected(entry.past));
    expect(englishLemma(entry.participle, "past")).toBe(expected(entry.participle));
  });
});
