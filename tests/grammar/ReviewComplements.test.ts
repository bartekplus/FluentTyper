import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import {
  expectChunkSplitParity,
  expectOneRepair,
  expectReviewGuards,
  prepared,
  review,
} from "./grammarTestUtils";
const rule = "englishVerbComplements";
const scan = (
  text: string,
  extra?: Partial<ReviewSourceSnapshot>,
  options?: Partial<ReviewOptions>,
) => review(text, extra, options).diagnostics.filter((d) => d.ruleId === rule);
const errors: [string, string][] = [
  ["We need fix this bug.", "We need to fix this bug."],
  ["They plan deploy tomorrow.", "They plan to deploy tomorrow."],
  ["I want make the change.", "I want to make the change."],
  ["She needs take a break.", "She needs to take a break."],
  ["He wanted write the report.", "He wanted to write the report."],
  ["We planned run the tests.", "We planned to run the tests."],
  ["They needed come home.", "They needed to come home."],
  ["I want see the results.", "I want to see the results."],
  ["She plans learn Rust.", "She plans to learn Rust."],
  ["He wants visit the office.", "He wants to visit the office."],
  ["You need read the file.", "You need to read the file."],
  ["We plan send the message.", "We plan to send the message."],
  ["I look forward to meet you.", "I look forward to meeting you."],
  ["We look forward to make the change.", "We look forward to making the change."],
  ["She looks forward to take a break.", "She looks forward to taking a break."],
  ["He looked forward to write the report.", "He looked forward to writing the report."],
  ["They are looking forward to run the tests.", "They are looking forward to running the tests."],
  ["I am looking forward to come home.", "I am looking forward to coming home."],
  ["We were looking forward to see the results.", "We were looking forward to seeing the results."],
  ["She was looking forward to learn Python.", "She was looking forward to learning Python."],
  ["You look forward to visit the office.", "You look forward to visiting the office."],
  ["He is looking forward to read the file.", "He is looking forward to reading the file."],
  ["They look forward to send the message.", "They look forward to sending the message."],
  ["We look forward to go home.", "We look forward to going home."],
  ["We do not need fix this bug.", "We do not need to fix this bug."],
  ["I don't want make the change.", "I don't want to make the change."],
  ["She doesn’t plan deploy tomorrow.", "She doesn’t plan to deploy tomorrow."],
  ["They did not want visit the office.", "They did not want to visit the office."],
  ["I am not looking forward to run the tests.", "I am not looking forward to running the tests."],
  ["He doesn't look forward to take a break.", "He doesn't look forward to taking a break."],
];
test.each(errors)("verb complements repair %s", (source, expected) => {
  const d = expectOneRepair(scan(source), source, expected, scan);
  expect(d.alternatives[0].edits).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThan(d.range.end);
});
const valid = [
  "We need not change it.",
  "Can you help fix this?",
  "Please let me know.",
  "They made it work.",
  "We need work, not promises.",
  "We need input data.",
  "We need a fix for this bug.",
  "They plan the deployment.",
  "I want a break.",
  "I want change, not promises.",
  "We need to fix this bug.",
  "They plan to deploy tomorrow.",
  "I want to make the change.",
  "She needs to take a break.",
  "He wanted to write the report.",
  "We planned to run the tests.",
  "I need not go home.",
  "He need not read the file.",
  "We don't need to fix this bug.",
  "They do not plan to deploy tomorrow.",
  "Need fix this bug.",
  "Plan deploy tomorrow",
  "Want see the results",
  "Need: fix this bug.",
  "We need fix",
  "They plan deploy",
  "We need unknownword this bug.",
  "We need fix unknownword.",
  "We need\nfix this bug.",
  "We need fix\nthis bug.",
  "We need `fix` this bug.",
  "We need fix this bug.report",
  "We need fix this bug_id.",
  "We need fix this buǵ.",
  'Type "We need fix this bug." exactly.',
  'The example "They plan deploy tomorrow." is wrong.',
  "We need the word fix.",
  "I would like to go home.",
  "I look forward to meeting you.",
  "We are used to working remotely.",
  "I look forward to work.",
  "I look forward to the meeting.",
  "We look forward to the report.",
  "She looks forward to taking a break.",
  "They are looking forward to running the tests.",
  "He looked forward to writing the report.",
  "We look forward to good weather.",
  "I look forward to tomorrow.",
  "I look forward to meet",
  "I look forward to",
  "Look forward to meet you.",
  "I look forward to unknownword today.",
  "I look forward to meet unknownword.",
  "I look forward to went home.",
  "I look forward to\nmeet you.",
  "I look forward to meet\nyou.",
  "I look forward to meet you.name",
  "I look forward to meet you_id.",
  "I look forward to meet yoú.",
  'The phrase "I look forward to meet you." is incorrect.',
  'Type "I look forward to meet you." exactly.',
  "`I look forward to meet you.`",
  "I look forward to make-believe.",
  "I am used to work as a verb in this example.",
  "Please help me run the tests.",
  "Let them visit the office.",
  "Make him read the file.",
  "We can go home.",
  "I saw her write the report.",
  "They had us run the tests.",
  "He made me take a break.",
  "We need meeting notes.",
  "I'd like to meet you.",
  "We'd planned to deploy tomorrow.",
];
test.each(valid)("verb complements preserve %s", (text) => expect(scan(text)).toEqual([]));
test("missing-to insertion uses the existing one-grapheme anchor and preserves separators", () => {
  const text = "We need\tfix this bug.";
  const d = scan(text)[0];
  const start = text.indexOf("fix");
  expect(d.range).toEqual({ start, end: start + 3 });
  expect(d.alternatives[0].edits).toEqual([
    { start, end: start + 1, original: "f", replacement: "to f" },
  ]);
  expect(applyEdits(text, d.alternatives[0].edits)).toBe("We need\tto fix this bug.");
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
const frameErrors: [string, string][] = [
  // look forward to + -ing
  ["I'm looking forward to meet you.", "I'm looking forward to meeting you."],
  ["We look forward to hear from you.", "We look forward to hearing from you."],
  ["She is looking forward to try the new menu.", "She is looking forward to trying the new menu."],
  [
    "They're looking forward to visit our office.",
    "They're looking forward to visiting our office.",
  ],
  [
    "He's not looking forward to clean the garage.",
    "He's not looking forward to cleaning the garage.",
  ],
  ["I LOOK FORWARD TO MEET YOU.", "I LOOK FORWARD TO MEETING YOU."],
  // be worth + -ing
  ["It is worth to try.", "It is worth trying."],
  ["It's not worth to fix it.", "It's not worth fixing it."],
  ["It is worth to mention that the API changed.", "It is worth mentioning that the API changed."],
  ["This was really worth to read.", "This was really worth reading."],
  ["That's worth to keep this in mind.", "That's worth keeping this in mind."],
  // let/make + object + bare verb
  ["Let me to do it.", "Let me do it."],
  ["Let me to explain why.", "Let me explain why."],
  ["She lets us to use her car.", "She lets us use her car."],
  ["They are letting him to go.", "They are letting him go."],
  ["I will let you to decide.", "I will let you decide."],
  ["Let them to run overnight.", "Let them run overnight."],
  ["He made me to understand the problem.", "He made me understand the problem."],
  // went ahead and + past, go ahead and + base
  ["We went ahead and fix it.", "We went ahead and fixed it."],
  ["She went ahead and merge the branch.", "She went ahead and merged the branch."],
  ["I went ahead and close the ticket.", "I went ahead and closed the ticket."],
  ["They went ahead and write the report.", "They went ahead and wrote the report."],
  ["We went ahead and test.", "We went ahead and tested."],
  ["Go ahead and fixed it.", "Go ahead and fix it."],
  // help + object (+ to) + base verb
  ["She helped me fixed it.", "She helped me fix it."],
  ["He helps us to understood.", "He helps us to understand."],
  ["They helped me moved the boxes.", "They helped me move the boxes."],
  ["She helps me finds the file.", "She helps me find the file."],
  ["I helped him finished the job.", "I helped him finish the job."],
  ["We are helping them to wrote the docs.", "We are helping them to write the docs."],
];
test.each(frameErrors)("complement frame repairs %s", (source, expected) => {
  expect(expectOneRepair(scan(source), source, expected, scan).alternatives).toHaveLength(1);
});
test.each([
  ["It allows to edit files.", "It allows editing files.", "It allows you to edit files."],
  [
    "The app allows to export the data.",
    "The app allows exporting the data.",
    "The app allows you to export the data.",
  ],
  ["It allowed to save it.", "It allowed saving it.", "It allowed you to save it."],
  [
    "We allow to cancel within a week.",
    "We allow canceling within a week.",
    "We allow you to cancel within a week.",
  ],
  [
    "You should allow to edit files.",
    "You should allow editing files.",
    "You should allow them to edit files.",
  ],
  [
    "It doesn't allow to apply the patch.",
    "It doesn't allow applying the patch.",
    "It doesn't allow you to apply the patch.",
  ],
])("allow without an object offers -ing or an object: %s", (source, ing, object) => {
  const [d] = scan(source);
  expect(d.messageKey).toBe("review_msg_allow_object");
  expect(d.requiresChoice).toBe(true);
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([ing, object]);
  expect(scan(ing)).toEqual([]);
  expect(scan(object)).toEqual([]);
});
const frameValid = [
  // look forward to: nouns, pronouns, gerunds and unproven verbs
  "I'm looking forward to the weekend.",
  "I'm looking forward to it.",
  "I'm looking forward to Monday.",
  "I'm looking forward to seeing you.",
  "We look forward to hearing from you.",
  "We look forward to dinner.",
  "We look forward to spring.",
  "I look forward to summer this year.",
  "I look forward to summer a lot.",
  "I look forward to lunch the most.",
  "I look forward to lunch with you.",
  "I look forward to spring with you.",
  "I'm looking forward to work the next day.",
  "I am looking forward to all the fun.",
  "I look forward to our meeting.",
  "I look forward to unknownword.",
  "I look forward to Meet the Team.",
  "Looking forward to see the road, he drove on.",
  "She was looking forward to retirement.",
  // worth: nouns, objects and the noun "worth"
  "It is worth the trouble.",
  "It's worth it to me.",
  "It is worth to me.",
  "It is worth to investors.",
  "It's worth to the company.",
  "What is it worth to you?",
  "Its worth to society is large.",
  "Its worth to try.",
  "For what it's worth to anyone, I agree.",
  "It is worth trying.",
  "It Is Worth To Try.",
  // let/make: renting out, reaching, and correct bare verbs
  "They let it to the tenants.",
  "We let it to students.",
  "We let it to family.",
  "We let them to tenants.",
  "He let them to their seats.",
  "We made it to the finals.",
  "We made it to work.",
  "They make them to order.",
  "Let me know.",
  "Let me do it.",
  "She was made to wait.",
  // allow: passives, questions, objects and recipe ellipsis
  "You are allowed to edit files.",
  "You're not allowed to edit files.",
  "Are you allowed to edit files?",
  "Is it allowed to park here?",
  "He's allowed to go.",
  "They got allowed to stay.",
  "Users allowed to edit files can publish.",
  "It allows users to edit files.",
  "It allows editing files.",
  "Allow to cool for ten minutes.",
  "Remove from heat and allow to cool.",
  "The tool allows to a certain extent.",
  "This allows to further reduce costs.",
  "It allows to better understand the code.",
  "It allows to easily edit files.",
  "Doing so allows to dramatically reduce costs.",
  // went/go ahead and: already agreeing, past = base, irregular pasts, new clauses
  "We went ahead and fixed it.",
  "He went ahead and booked the tickets.",
  "They went ahead and put it online.",
  "They went ahead and set it up.",
  "We went ahead and saw it.",
  "The team went ahead and management approved it.",
  "The race went ahead and fans cheered.",
  "Go ahead and merge it.",
  // help: relative clauses, adjectives, prepositions, served food, correct verbs
  "The man who helped me left early.",
  "Everyone who helped us deserved thanks.",
  "I helped her injured brother.",
  "She helped me with the move.",
  "She helped them to drinks.",
  "He helped them to stuffing.",
  "We helped them to baked potatoes.",
  "He helped them to dried fruit.",
  "She helped me set it up.",
  "She helped me read it.",
  "She helped me feel better.",
  "She helped me fix it.",
  "He helps us to understand.",
];
test.each(frameValid)("complement frames preserve %s", (text) => expect(scan(text)).toEqual([]));
// Our own variants of each frame: any subject, any object noun phrase, lexicon-proven verbs.
const broaderErrors: [string, string][] = [
  // help + past or -s form, with no object
  ["I helped built the shed.", "I helped build the shed."],
  ["Our team helped designed the new logo.", "Our team helped design the new logo."],
  ["The grant helped funded 3 schools.", "The grant helped fund 3 schools."],
  ["He has helped wrote most of the docs.", "He has helped write most of the docs."],
  ["They helped chose the venue.", "They helped choose the venue."],
  ["This helps reduces the load.", "This helps reduce the load."],
  ["It is helping improved the score.", "It is helping improve the score."],
  ["The tool we use has helped saved us hours.", "The tool we use has helped save us hours."],
  ["She cooked and helped cleaned the kitchen.", "She cooked and helped clean the kitchen."],
  ["Last year, helped organized the meetup.", "Last year, helped organize the meetup."],
  ["You can help solved this.", "You can help solve this."],
  ["This is a library I helped created.", "This is a library I helped create."],
  ["We moved into a flat that I helped painted.", "We moved into a flat that I helped paint."],
  [
    "We worked on the tool I helped improved and test.",
    "We worked on the tool I helped improve and test.",
  ],
  // help + object or "to"
  [
    "The coach is helping them understood the rules.",
    "The coach is helping them understand the rules.",
  ],
  ["He helps to fixed the build.", "He helps to fix the build."],
  ["She helped everyone moved the boxes.", "She helped everyone move the boxes."],
  ["They helped me to built the deck.", "They helped me to build the deck."],
  // gone/goes ahead and; a noun-verb followed by a non-verb
  ["I've gone ahead and fix the typo.", "I've gone ahead and fixed the typo."],
  ["They had gone ahead and write the tests.", "They had gone ahead and written the tests."],
  ["He goes ahead and merge it anyway.", "He goes ahead and merges it anyway."],
  ["We went ahead and order pizza.", "We went ahead and ordered pizza."],
  ["She went ahead and make sure it works.", "She went ahead and made sure it works."],
  // look forward to: sign-offs, stressed and perfect forms, verbs the lexicon proves
  ["Looking forward to meet you.", "Looking forward to meeting you."],
  [
    "Thanks, and looking forward to hear from you.",
    "Thanks, and looking forward to hearing from you.",
  ],
  ["We're really looking forward to meet you.", "We're really looking forward to meeting you."],
  ["I'm looking forward to hear about it.", "I'm looking forward to hearing about it."],
  ["They've been looking forward to visit you.", "They've been looking forward to visiting you."],
  // worth: any subject, questions, "it" without "is", "worth of"
  ["It's worth to note that the API changed.", "It's worth noting that the API changed."],
  ["Is it worth to upgrade?", "Is it worth upgrading?"],
  ["The book is worth to read.", "The book is worth reading."],
  ["These tools are worth to try.", "These tools are worth trying."],
  ["It's well worth to visit the old town.", "It's well worth visiting the old town."],
  ["Its not worth to argue about it.", "Its not worth arguing about it."],
  ["It doesn't seem worth to update it.", "It doesn't seem worth updating it."],
  ["Some ideas worth to explore remain.", "Some ideas worth exploring remain."],
  ["It is worth of reading.", "It is worth reading."],
  // let/make: indefinite pronouns, noun phrases, "let's" for "lets", an adverb before the verb
  ["Please let the user to choose a theme.", "Please let the user choose a theme."],
  ["It lets users to edit their profile.", "It lets users edit their profile."],
  ["Don't let anyone to see this.", "Don't let anyone see this."],
  ["We let every one to vote.", "We let every one vote."],
  ["They made everyone to wait.", "They made everyone wait."],
  ["The tool let's you to rename files.", "The tool let's you rename files."],
  ["Let me to quickly check.", "Let me quickly check."],
  ["Let it to only load the cache.", "Let it only load the cache."],
  ["Let them to sort/filter the rows.", "Let them sort/filter the rows."],
  ["Nobody lets her to be late.", "Nobody lets her be late."],
  // verbs that take -ing, not "to"
  ["I suggest to use a newer version.", "I suggest using a newer version."],
  ["We recommend to install the update.", "We recommend installing the update."],
  ["Avoid to use global variables.", "Avoid using global variables."],
  ["I enjoy to read books.", "I enjoy reading books."],
  ["She enjoys to travel.", "She enjoys traveling."],
  ["We finished to eat at nine.", "We finished eating at nine."],
  ["Would you mind to close the door?", "Would you mind closing the door?"],
  ["I don't mind to wait.", "I don't mind waiting."],
  ["I'm considering to buy a car.", "I'm considering buying a car."],
  ["They considered to move abroad.", "They considered moving abroad."],
  ["We avoided to mention it.", "We avoided mentioning it."],
  ["We tested it and suggested to add a check.", "We tested it and suggested adding a check."],
];
test.each(broaderErrors)("broader complement frames repair %s", (source, expected) => {
  expect(expectOneRepair(scan(source), source, expected, scan).alternatives).toHaveLength(1);
});
test("verbs that take -ing explain their own frame", () => {
  expect(scan("I enjoy to read books.")[0].messageKey).toBe("review_msg_gerund_complement");
  expect(scan("Avoid to use global variables.")[0].messageKey).toBe("review_msg_gerund_complement");
});
test.each([
  ["It enables to edit files.", "It enables editing files.", "It enables you to edit files."],
  [
    "These settings allow to configure the proxy.",
    "These settings allow configuring the proxy.",
    "These settings allow you to configure the proxy.",
  ],
  [
    "Allow to change the password.",
    "Allow changing the password.",
    "Allow you to change the password.",
  ],
  [
    "Allowing to save drafts helps.",
    "Allowing saving drafts helps.",
    "Allowing you to save drafts helps.",
  ],
])("enable and bare allow offer -ing or an object: %s", (source, ing, object) => {
  const [d] = scan(source);
  expect(d.messageKey).toBe("review_msg_allow_object");
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([ing, object]);
});
const broaderValid = [
  // help: adjectives after help, a relative clause that can be the subject, passives, nouns
  "The volunteers helped injured people.",
  "She helped stranded travelers get home.",
  "They helped displaced families and sick children.",
  "The money helped trained staff stay.",
  "The people we helped moved to Berlin.",
  "The students she helped passed the exam.",
  "I think the people we helped moved away.",
  "I heard the families we helped moved away.",
  "The truth is the people we helped moved on.",
  "Everyone who helped got a medal.",
  "The man who helped built the house next door.",
  "Those who helped organized the event.",
  "Volunteers who came and helped stayed late.",
  "Whoever helped left a note.",
  "What helped made the difference.",
  "Whatever helps works.",
  "So, that helped did it?",
  "Your help made this possible.",
  "A second helping made me full.",
  "It can't be helped, given the weather.",
  "She helped them found a company.",
  "He helped me saw the planks.",
  "The kids I helped read better now.",
  "The tutor helped students understand fractions.",
  "He helped himself to dried fruit.",
  "They helped themselves to baked potatoes.",
  "It helps that you asked.",
  "Every little helps.",
  // went ahead and: a new clause with a noun subject
  "The game went ahead and rain fell all day.",
  "The concert went ahead and work began on the stage.",
  "The vote went ahead and turnout was high.",
  "We went ahead and found the bug.",
  "They went ahead and read the report.",
  // look forward: looking ahead, nouns
  "Keep looking forward to see where you are going.",
  "The camera looks forward to detect obstacles.",
  "Look forward to see the road.",
  "We look forward to dinner with you.",
  // worth as a noun with a recipient
  "The company proved its worth to investors.",
  "He showed his true worth to the team.",
  "Her worth to the company is clear.",
  "It is worth to people who care.",
  "The net worth of being rich is low.",
  "The worth of reading cannot be measured.",
  // let: renting out; make: purposes
  "We let the flat to students.",
  "They let the house to a family.",
  "We let rooms to tourists.",
  "They let it to tenants.",
  "He made a trip to see her.",
  "She made an effort to help.",
  "They made the switch to work remotely.",
  // allow: recipe ellipsis and UI labels
  "Allow to cool completely.",
  "Allow to cool on a rack.",
  "Allow to stand overnight.",
  "Allow to rest 10 minutes.",
  "Allow to set firm.",
  "Enable to receive notifications.",
  "Building permits to construct homes are rare.",
  // -ing verbs: passives, recipients and nouns
  "It is recommended to use a strong password.",
  "It's strongly recommended to set a limit.",
  "It is not recommended to change this option.",
  "It is unsafe and not recommended to change it.",
  "He is considered to be an expert.",
  "I suggested to the team that we wait.",
  "We recommend to all users that they update.",
  "He suggested to management a new plan.",
  "The dosage recommended to treat infections is low.",
  "Keep in mind to check the logs.",
  "I have a mind to quit.",
  "The finish to the wood is smooth.",
  "It was finished to a high standard.",
  "Enjoy to the fullest.",
];
test.each(broaderValid)("broader complement frames preserve %s", (text) =>
  expect(scan(text)).toEqual([]),
);
test("complement evidence respects dictionary, language, protection, selection and chunk ownership", () => {
  for (const [text] of [errors[0], errors[12], frameErrors[0], frameErrors[18], frameErrors[24]]) {
    const d = scan(text)[0];
    expectReviewGuards(scan, text, d, { protectedReason: "code" });
  }
  const text =
    '😀 Café.\r\nShe said, "We need fix this bug." I look forward to meet you. It is worth to try. ' +
    "Let me to do it. It allows to edit files. We went ahead and fix it. She helped me fixed it.";
  const expected = scan(text);
  expect(expected).toHaveLength(7);
  expectChunkSplitParity(prepared(text, {}, { enabledRules: [rule] }), text, expected);
  expect(scan("We need fix\uFFFC this bug.")).toEqual([]);
});
