import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan as reviewScan } from "./reviewHarness";

// english/clauseFrames.ts: clause-level slips one frame can name. All sentences are our own.
const RULES = new Set([
  "englishSubjectVerbAgreement",
  "englishApostrophes",
  "englishPhraseCorrections",
  "englishVerbComplements",
  "englishConfusedWords",
  "englishUsagePhrases",
  "englishFixedPrepositions",
  "englishNounNumber",
  "englishPerfectParticiples",
  "englishSentenceStructure",
  "englishRepeatedWords",
  "englishContextualCompounds",
  "englishClosedCompounds",
  "englishCanonicalCasing",
]);
function scan(text: string) {
  return reviewScan(text).filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["The United States are a big country.", "The United States is a big country."],
  ["The symptom's vary a lot.", "The symptoms vary a lot."],
  ["It you have any questions, call me.", "If you have any questions, call me."],
  ["Help us helps you.", "Help us help you."],
  ["Nobody told me nothing.", "Nobody told me anything."],
  ["What is reason that it fails?", "What is the reason that it fails?"],
  ["We met in Tuesday.", "We met on Tuesday."],
  ["At this Saturday I have an exam.", "On this Saturday I have an exam."],
  ["Since I rebooted it it's fine.", "Since I rebooted it, it's fine."],
  ["I have a bit money left.", "I have a bit of money left."],
  ["He graduated the university in May.", "He graduated from the university in May."],
  ["This results missed the target.", "These results missed the target."],
  ["Some language are hard.", "Some languages are hard."],
  ["I am interesting in this book.", "I am interested in this book."],
  ["We are interest in it.", "We are interested in it."],
  ["He had been knowing it for years.", "He had known it for years."],
  ["Am I ride?", "Am I right?"],
  ["It is a much fast route.", "It is a much faster route."],
  ["He like me a lot.", "He likes me a lot."],
  ["She entered the he house.", "She entered the house."],
  ["We met at the at the corner.", "We met at the corner."],
  ["Many other have tried.", "Many others have tried."],
  ["The fox' tail was red.", "The fox's tail was red."],
  ["They custom build a solution.", "They custom-build a solution."],
  ["You have been signed-in.", "You have been signed in."],
  ["Put it a side for later.", "Put it aside for later."],
  ["Neither children are happy.", "Neither of the children are happy."],
  ["There are number of birds here.", "There are a number of birds here."],
  ["He lives in the us.", "He lives in the US."],
  ["I hate this kind of stories.", "I hate this kind of story."],
  ["As Christopher show us, it works.", "As Christopher shows us, it works."],
  ["David and I's cat is old.", "David's and my cat is old."],
  ["We left in a harry.", "We left in a hurry."],
  ["It was a quite a show.", "It was quite a show."],
  ["Please fresh up before dinner.", "Please freshen up before dinner."],
  ["See you this after noon.", "See you this afternoon."],
  ["Costs were over stated.", "Costs were overstated."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
});

test.each([
  "The tariffs are about the United States and Canada.",
  "Carlos's notes are short.",
  "Mine is red, and my mom's are blue.",
  "It is what you make of it.",
  "Help us decide.",
  "Nobody knows.",
  "What is reason?",
  "In Monday's meeting we agreed.",
  "He had a bit part in the film.",
  "This series had a twist.",
  "This needs addressed.",
  "This combines armored panels with speed.",
  "Some staff are here.",
  "They are interesting in many ways.",
  "There is interest in the plan.",
  "It is much good to us.",
  "She like me has no idea.",
  "Both his wife and he like it.",
  "The IT team left.",
  "Teens aged 12 and over estimate their income.",
  "It is built over React.",
  "We read it in a Harry Potter book.",
  "Players took a bit rate test.",
  "If Tom read it, fine.",
  "As Parents show us, it works.",
  "A study for the United States are the papers below.",
  "The King and I's run ended.",
  "This kind of stats is hard.",
  "That kind of sucks.",
  "Please help me guys.",
  "History made us friends.",
  "I will be in Monday through Thursday.",
  "We slept in Sunday morning.",
  "I was looking at Wednesday, May 4.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});

// "He like pizza": "like" before a bare noun is the verb or "is like"; the writer chooses.
test.each([
  ["He like pizza.", ["He likes pizza.", "He is like pizza."]],
  ["She like coffee.", ["She likes coffee.", "She is like coffee."]],
  ["She like dogs.", ["She likes dogs.", "She is like dogs."]],
  ["So he like movies now.", ["So he likes movies now.", "So he is like movies now."]],
])("offers a choice for %s and never fixes it in bulk", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(found[0].alternatives.map((a) => applyEdits(input, a.edits))).toEqual(expected);
  expect(found[0].requiresChoice).toBe(true);
  expect(found[0].bulk.eligible).toBe(false);
});

test.each([
  "He, like, left.",
  "It like magic.",
  "He like totally forgot.",
  "He like most people was tired.",
  "She like Sam loves jazz.",
  "She like teachers knows the rules.",
  "He like way more pizza.",
  "Both his wife and he like pizza.",
  "Does he like pizza?",
  "I said he like.",
  // An ellipsis: "he (fought) like lions, she like tigers".
  "They fought: he like lions, she like tigers.",
  "They ran. He like lightning, she like smoke.",
  "They fought. He like a lion, she like a tiger.",
])("leaves bare-noun like: %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
