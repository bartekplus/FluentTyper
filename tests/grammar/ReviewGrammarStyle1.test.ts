import { expect, test } from "bun:test";
import { REVIEW_RULE_METADATA } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview } from "./grammarTestUtils";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const review = (text: string, rule: CatalogRuleId, lang = "en_US") =>
  runReview(text, {}, { lang, enabledRules: [rule] }).diagnostics;
/** Every finding's offered repairs, each applied to the whole text. */
const repaired = (text: string, rule: CatalogRuleId) =>
  review(text, rule).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [rule, typed, the repairs offered by its one finding]
const positives: [CatalogRuleId, string, string[]][] = [
  // Agreement: regular verbs from the dictionary, negated be, "I were", "i are".
  ["englishPronounVerbWhitelistAgreement", "She study every night.", ["She studies every night."]],
  ["englishPronounVerbWhitelistAgreement", "They fixes it quickly.", ["They fix it quickly."]],
  ["englishPronounVerbWhitelistAgreement", "I wants this one.", ["I want this one."]],
  ["englishPronounVerbWhitelistAgreement", "He aren't home.", ["He isn't home."]],
  ["englishPronounVerbWhitelistAgreement", "We wasn't told.", ["We weren't told."]],
  ["englishPronounVerbWhitelistAgreement", "I were tired yesterday.", ["I was tired yesterday."]],
  ["englishPronounVerbWhitelistAgreement", "Then i are going.", ["Then i am going."]],
  // A base verb that is also its participle ("come", "run") still needs -s.
  ["englishPronounVerbWhitelistAgreement", "She come home late.", ["She comes home late."]],
  [
    "englishPronounVerbWhitelistAgreement",
    "It become slow at night.",
    ["It becomes slow at night."],
  ],
  // Two forms of be, "the some", a dangling determiner.
  ["englishSentenceStructure", "The plan is are fine.", ["The plan is fine."]],
  ["englishSentenceStructure", "They're are late.", ["They're late."]],
  ["englishRepeatedWords", "Where is is the key?", ["Where is the key?"]],
  ["englishSentenceStructure", "He is never be on time.", ["He is never on time."]],
  ["englishPronounVerbWhitelistAgreement", "It only matter once.", ["It only matters once."]],
  [
    "englishSentenceStructure",
    "We hired the some interns.",
    ["We hired some interns.", "We hired the same interns."],
  ],
  [
    "englishSentenceStructure",
    "We used the some layout.",
    ["We used the same layout.", "We used some layout."],
  ],
  // Doubled comparison where the clause shows it is finished.
  ["englishDoubledDegree", "Our build got more faster?", ["Our build got faster?"]],
  ["englishDoubledDegree", "It was the most easiest to read.", ["It was the easiest to read."]],
  ["englishDoubledDegree", "Pick a most best answer.", ["Pick a best answer."]],
  // Do-support and help with a past form; "may of".
  ["englishAuxiliaryBaseVerb", "It did crashed the app.", ["It did crash the app."]],
  ["englishAuxiliaryBaseVerb", "She didn't found it.", ["She didn't find it."]],
  ["englishAuxiliaryBaseVerb", "Did they wrote it?", ["Did they write it?"]],
  [
    "englishAuxiliaryBaseVerb",
    "Friends helped built this house.",
    ["Friends helped build this house."],
  ],
  ["englishModalOfCorrection", "We may of missed it.", ["We may have missed it."]],
  // Countability: Greek plurals and mass nouns.
  ["englishCountability", "These criterion differ.", ["These criteria differ."]],
  ["englishCountability", "Several odd phenomenon occur.", ["Several odd phenomena occur."]],
  ["englishCountability", "Each criteria counts.", ["Each criterion counts."]],
  [
    "englishCountability",
    "She has a few information for us.",
    ["She has a few pieces of information for us."],
  ],
  ["englishCountability", "Each furniture was new.", ["Each piece of furniture was new."]],
  ["englishCountability", "We installed two softwares.", ["We installed two software."]],
  ["englishCountability", "He got bad advices.", ["He got bad advice."]],
  // Noun number: one of + singular, decades, counted quantifiers, number + unit.
  ["englishNounNumber", "One of the screen failed.", ["One of the screens failed."]],
  ["englishNounNumber", "She is in her 50's now.", ["She is in her 50s now."]],
  ["englishNounNumber", "A mid 1960's design.", ["A mid 1960s design."]],
  ["englishNounNumber", "Backups run each 6 hours.", ["Backups run every 6 hours."]],
  ["englishContextualCompounds", "It was a 4 week course.", ["It was a 4-week course."]],
  ["englishContextualCompounds", "No body knows.", ["Nobody knows."]],
  // Split words and chat spellings.
  [
    "englishContractionNormalization",
    "Everythings changing fast.",
    ["Everything's changing fast.", "Everything is changing fast."],
  ],
  ["englishContractionNormalization", "That s fine.", ["That's fine."]],
  ["englishTypoWhitelistCorrection", "It ended abruptl y.", ["It ended abruptly."]],
  ["englishPhraseCorrections", "We r done.", ["We are done.", "We're done."]],
  ["englishPhraseCorrections", "We toured John Hopkins today.", ["We toured Johns Hopkins today."]],
  ["englishPhraseCorrections", "It was less worse than before.", ["It was less bad than before."]],
  // Compounds and casing.
  ["englishClosedCompounds", "Right click the file.", ["Right-click the file."]],
  ["englishClosedCompounds", "I often miss spell it.", ["I often misspell it."]],
  ["englishCanonicalCasing", "Nato met today.", ["NATO met today."]],
  ["englishCanonicalCasing", "I sync my ipad.", ["I sync my iPad."]],
  ["englishCanonicalCasing", "We sailed the south china sea.", ["We sailed the South China Sea."]],
  ["englishProperNounCapitalization", "Since last march we grew.", ["Since last March we grew."]],
  [
    "englishProperNounCapitalization",
    "We met between march 3 and 5.",
    ["We met between March 3 and 5."],
  ],
  ["englishPronounICapitalization", "She runs faster than i", ["She runs faster than I"]],
  // Typography.
  ["commaPeriodSpacing", "We left.Then it rained.", ["We left. Then it rained."]],
  ["commaPeriodSpacing", "Ready?Go now.", ["Ready? Go now."]],
  ["commaPeriodSpacing", "It rained;nobody came.", ["It rained; nobody came."]],
  ["commaPeriodSpacing", "，", [","]],
  ["duplicatePunctuationCollapse", "..", ["...", "."]],
  ["currencySpacing", "Her 3rd$ went far.", ["Her $3rd went far."]],
  ["emdashShortcut", "Read pages 4-9 first.", ["Read pages 4–9 first."]],
  ["styleRedundancy", "Replace the LCD display.", ["Replace the LCD."]],
  // Optional style.
  ["stylePhrasing", "Meet at 7 pm in the evening.", ["Meet at 7 pm.", "Meet at 7 in the evening."]],
  ["stylePhrasing", "It ran at 3am at night.", ["It ran at 3am.", "It ran at 3 at night."]],
  ["stylePhrasing", "It needs 4 GB.", ["It needs 4 gigabytes."]],
  ["stylePhrasing", "Wait 1 min.", ["Wait 1 minute."]],
  ["stylePhrasing", "Moreover it works.", ["Moreover, it works."]],
  ["stylePhrasing", "They self-taught themselves.", ["They taught themselves."]],
  ["stylePhrasing", "Many ppl came.", ["Many people came."]],
  ["stylePhrasing", "My favs are here.", ["My favorites are here."]],
  ["stylePhrasing", "Well, um it broke.", ["Well, it broke."]],
  ["stylePhrasing", "It got increasingly less stable.", ["It got less and less stable."]],
  ["stylePhrasing", "The fox is more quick than us.", ["The fox is quicker than us."]],
  ["stylePhrasing", "It was first invented here.", ["It was invented here."]],
  ["stylePhrasing", "Slice the aubergine.", ["Slice the eggplant."]],
  ["styleContractions", "They don't know.", ["They do not know."]],
  ["styleContractions", "WE CAN'T.", ["WE CANNOT."]],
  ["styleContractions", "It's late.", ["It is late.", "It has late."]],
  ["styleOxfordComma", "Bring pens, paper and tape.", ["Bring pens, paper, and tape."]],
  ["styleNoOxfordComma", "Bring pens, paper, and tape.", ["Bring pens, paper and tape."]],
  // Progressive after have: be, contracted be, or have been.
  [
    "englishPerfectParticiples",
    "They have working on it.",
    ["They are working on it.", "They're working on it.", "They have been working on it."],
  ],
  [
    "englishPerfectParticiples",
    "Ive reading it now.",
    ["I'm reading it now.", "I've been reading it now."],
  ],
  [
    "englishClosedCompounds",
    "The word was miss spelt in the title.",
    ["The word was misspelt in the title."],
  ],
  ["englishContractionNormalization", "THAT S GREAT", ["THAT'S GREAT"]],
];
test.each(positives)("%s repairs %s", (rule, text, repairs) => {
  expect(repaired(text, rule)).toEqual([repairs]);
});

// [rule, text that is right, or that the rule leaves to the writer]
const negatives: [CatalogRuleId, string][] = [
  ["englishPronounVerbWhitelistAgreement", "She studies every night."],
  ["englishPronounVerbWhitelistAgreement", "If I were taller, I would reach it."],
  ["englishPronounVerbWhitelistAgreement", "You kids get inside."],
  ["englishPronounVerbWhitelistAgreement", "It will work."],
  ["englishSentenceStructure", "What it is is unclear."],
  ["englishSentenceStructure", "Let's be clear."],
  ["englishSentenceStructure", "Tom's are better."],
  ["englishSentenceStructure", "Those little one's are asleep."],
  ["englishSentenceStructure", "Mine are new but my sister's are old."],
  ["englishSentenceStructure", "The question is are we done?"],
  // A pseudo-cleft: the first verb closes a free relative ("What there are is ...").
  ["englishSentenceStructure", "What there are is a pile of unpaid invoices."],
  ["englishSentenceStructure", "Who they were is still a mystery to me."],
  ["englishRepeatedWords", "What it is is a cheap trick."],
  ["englishSentenceStructure", "To be or not to be is the old question."],
  ["englishSentenceStructure", "My motto is always be kind."],
  ["englishSentenceStructure", "The trick is just be patient."],
  ["englishDoubledDegree", "We hired more older workers."],
  ["englishDoubledDegree", "This is the most honest reply."],
  ["englishAuxiliaryBaseVerb", "Whatever she did worked."],
  ["englishAuxiliaryBaseVerb", "We did advanced drills."],
  ["englishAuxiliaryBaseVerb", "It should've helped given that."],
  ["englishModalOfCorrection", "In May of 2020 we moved."],
  ["englishCountability", "These criteria differ."],
  ["englishCountability", "One of the criteria failed."],
  ["englishCountability", "She is a software engineer."],
  ["englishCountability", "Thanks for these advices."],
  ["englishNounNumber", "One of the cars stalled."],
  ["englishNounNumber", "She is one of the few honest people."],
  ["englishNounNumber", "Windows 10's update shipped."],
  ["englishContextualCompounds", "It lasted 4 weeks."],
  ["englishContextualCompounds", "I have a head but no body."],
  ["englishContractionNormalization", "Some things change."],
  ["englishTypoWhitelistCorrection", "Set the value of x to 2."],
  ["englishPhraseCorrections", "John Hopkins said hello."],
  ["englishClosedCompounds", "Click the right button."],
  ["englishCanonicalCasing", "Ai Weiwei spoke."],
  ["englishCanonicalCasing", "Save it as a pdf file."],
  ["englishProperNounCapitalization", "What happens next may surprise you."],
  ["commaPeriodSpacing", "Call user.Save() later."],
  ["commaPeriodSpacing", "Open example.com today."],
  ["duplicatePunctuationCollapse", "cd .."],
  ["emdashShortcut", "Call 555-1234 today."],
  ["emdashShortcut", "It shipped on 2024-01-05."],
  ["styleRedundancy", "Replace the LCD."],
  ["stylePhrasing", "Meet at 7 pm."],
  ["stylePhrasing", "Qwen3 4B runs locally."],
  ["stylePhrasing", "However hard it gets, we stay."],
  ["stylePhrasing", "Use a self-portrait of yourself."],
  ["stylePhrasing", "The (PPL) value rose."],
  ["stylePhrasing", "It is more robust than before."],
  ["stylePhrasing", "It is more human than machine."],
  ["styleContractions", "John's car is red."],
  ["styleOxfordComma", "When I left, Sam and Ana stayed."],
  ["styleOxfordComma", "Yes, Sam and Ana stayed."],
  ["styleNoOxfordComma", "I went home, and she stayed."],
  ["englishPerfectParticiples", "We have training on Monday."],
  ["englishPerfectParticiples", 'Avoid "She has cleaning the room" in prose.'],
  ["englishClosedCompounds", "The word was miss spellt in the title."],
];
test.each(negatives)("%s leaves %s", (rule, text) => {
  expect(review(text, rule)).toEqual([]);
});

test("quoted examples, other languages and the user dictionary stay untouched", () => {
  expect(review('Never write "these criterion" here.', "englishCountability")).toEqual([]);
  expect(review("These criterion differ.", "englishCountability", "de_DE")).toEqual([]);
  expect(
    runReview("Many ppl came.", {}, { enabledRules: ["stylePhrasing"], userDictionary: ["ppl"] })
      .diagnostics,
  ).toEqual([]);
});

test("register and serial-comma styles are opt-in and never batched", () => {
  for (const id of ["styleContractions", "styleOxfordComma", "styleNoOxfordComma"] as const) {
    expect(REVIEW_RULE_METADATA[id]).toMatchObject({
      review: "supported",
      defaultEnabled: false,
      bulk: "individual",
    });
  }
});
