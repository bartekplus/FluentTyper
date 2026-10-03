import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { englishVerbForms } from "../../src/core/domain/grammar/implementations/helpers/EnglishVerbForms";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";

const ruleId = "englishAuxiliaryBaseVerb";
function scan(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    { id: "aux", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    {
      enabledRules: reviewRuleIds({ codeMode: false }),
      lang: "en_US",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  );
}
const review = (text: string) => scan(text).diagnostics.filter((d) => d.ruleId === ruleId);

const positives = [
  // A regular past after "did" before a closed word: the base verb.
  ["They did traveled there.", "They did travel there."],
  // "seen" before an adjective or "to" is seem; a perfect modal before a bare participle lost have.
  ["It doesn't seen fair.", "It doesn't seem fair."],
  ["I can't seen to log in.", "I can't seem to log in."],
  ["We should gone earlier.", "We should have gone earlier."],
  // A question about a feeling takes be: "Are you interested?".
  ["Do you interested in chess?", "Are you interested in chess?"],
  ["Did they worried about the exam?", "Were they worried about the exam?"],
  ["Doesn't she bored at home?", "Isn't she bored at home?"],
  ["Don't I tired easily?", "Aren't I tired easily?"],
  ["I did not understood the change.", "I did not understand the change."],
  ["Did she went home?", "Did she go home?"],
  ["He can works remotely.", "He can work remotely."],
  ["Does she knows the answer?", "Does she know the answer?"],
  ["We didn't ate the cake.", "We didn't eat the cake."],
  ["They didn’t came yesterday.", "They didn’t come yesterday."],
  ["She should really took a break.", "She should really take a break."],
  ["Would you just gave me a minute?", "Would you just give me a minute?"],
  ["We must not wrote on this page.", "We must not write on this page."],
  ["You might even spoke to them.", "You might even speak to them."],
  ["I do actually knows the route.", "I do actually know the route."],
  ["He doesn't understood the message.", "He doesn't understand the message."],
  ["They won’t brought the parcel.", "They won’t bring the parcel."],
  ["Could she bought it locally?", "Could she buy it locally?"],
  ["They will sent a letter.", "They will send a letter."],
  ["We cannot chose for you.", "We cannot choose for you."],
  ["You may began now.", "You may begin now."],
  ["She can worked.", "She can work."],
  ["Did you thought about it?", "Did you think about it?"],
  ["She didn’t drew the map.", "She didn’t draw the map."],
  ["We can't forgot this.", "We can't forget this."],
  ["Will you told them?", "Will you tell them?"],
  ["Would they undertook it?", "Would they undertake it?"],
  ["I DID NOT HEARD IT.", "I DID NOT HEAR IT."],
  ["I\t did not really understood this.", "I\t did not really understand this."],
  ['He shouted, "I did not understood it!"', 'He shouted, "I did not understand it!"'],
  // Regular verbs, by spelling: -s takes the third-person lemma, -ed the past one.
  ["Did they forked the repo?", "Did they fork the repo?"],
  ["It didn't used a macro.", "It didn't use a macro."],
  ["He doesn't wants it.", "He doesn't want it."],
  ["She can fixes it.", "She can fix it."],
  ["We should updated the docs.", "We should update the docs."],
  ["Does it supports dark mode?", "Does it support dark mode?"],
  ["They won't accepted the offer.", "They won't accept the offer."],
  ["Can you checked the logs?", "Can you check the logs?"],
  ["She might tries it.", "She might try it."],
  ["We don’t needed them.", "We don’t need them."],
  ["I did reviewed it.", "I did review it."],
  ["I didn't used to like it.", "I didn't use to like it."],
  ["I WILL CALLED HIM.", "I WILL CALL HIM."],
  ["I won't being late.", "I won't be late."],
  // A determiner and one noun as the subject.
  ["The server did logged the error.", "The server did log the error."],
  ["This test doesn't passes.", "This test doesn't pass."],
  ["Our team couldn't fixed it.", "Our team couldn't fix it."],
  ["My sister didn't liked the film.", "My sister didn't like the film."],
  ["A friend could helps.", "A friend could help."],
  ["Its owner won't sold it.", "Its owner won't sell it."],
  // The dictionary lexicon resolves what spelling cannot (delete or delet?).
  ["He can deleted this.", "He can delete this."],
  ["She will edited the file.", "She will edit the file."],
  // "to" after heads that always take an infinitive.
  ["I want to went home.", "I want to go home."],
  ["You need to fixed it.", "You need to fix it."],
  ["She is going to calls you.", "She is going to call you."],
  ["We have to updated it.", "We have to update it."],
  ["He tried to fixes it.", "He tried to fix it."],
  ["They decided to moved.", "They decided to move."],
  ["I would like to went home.", "I would like to go home."],
  ["You're supposed to calls me.", "You're supposed to call me."],
  ["We ought to reviewed it.", "We ought to review it."],
  ["She is trying to sleeps.", "She is trying to sleep."],
  ["I had to wrote it again.", "I had to write it again."],
  ["He wants to knows more.", "He wants to know more."],
  ["They were able to finished it.", "They were able to finish it."],
  // Any subject word before a modal or a negative do, mid-sentence too.
  ["The old cat will slept all day.", "The old cat will sleep all day."],
  ["Our release notes will mentions every fix.", "Our release notes will mention every fix."],
  ["The parser couldn't handles nested lists.", "The parser couldn't handle nested lists."],
  ["The report may contains errors.", "The report may contain errors."],
  ["The migration might broke the cache.", "The migration might break the cache."],
  ["Every request must includes a token.", "Every request must include a token."],
  ["This change doesn't affects old clients.", "This change doesn't affect old clients."],
  ["Their servers didn't responded in time.", "Their servers didn't respond in time."],
  ["Some customers don't wants the update.", "Some customers don't want the update."],
  ["I hope the patch will fixes it.", "I hope the patch will fix it."],
  ["I think it may causes a crash.", "I think it may cause a crash."],
  ["They said we could went early.", "They said we could go early."],
  ["Duplicate keys will throws an error.", "Duplicate keys will throw an error."],
  ["Plugins can't accessed the network.", "Plugins can't access the network."],
  ["Our docs should explains this better.", "Our docs should explain this better."],
  ["Unused SDKs will slows the build.", "Unused SDKs will slow the build."],
  ["It'll works fine.", "It'll work fine."],
  ["They’ll came tomorrow.", "They’ll come tomorrow."],
  ["He'd goes there every day.", "He'd go there every day."],
  // Inverted questions with a determiner + noun subject, and wh-questions.
  ["Will the fix works?", "Will the fix work?"],
  ["Can the server handles it?", "Can the server handle it?"],
  ["Can the new server handles it?", "Can the new server handle it?"],
  ["Does the app supports dark mode?", "Does the app support dark mode?"],
  ["Why did the build failed?", "Why did the build fail?"],
  ["How does it works?", "How does it work?"],
  ["What does this means?", "What does this mean?"],
  ["Where did the user went?", "Where did the user go?"],
  ["Should the server crashes, restart it.", "Should the server crash, restart it."],
  ["Did your sister liked the film?", "Did your sister like the film?"],
  // Infinitive "to" after any head when the verb form cannot be a noun or state.
  ["A fix is expected to arrives soon.", "A fix is expected to arrive soon."],
  ["It is important to understood the risk.", "It is important to understand the risk."],
  ["She managed to fixed it.", "She managed to fix it."],
  ["I forgot to closed the door.", "I forgot to close the door."],
  ["To rebuilt the index, run the script.", "To rebuild the index, run the script."],
  ["We hope to finished the work by Friday.", "We hope to finish the work by Friday."],
  ["The tickets are going to sold out.", "The tickets are going to sell out."],
  ["I'd like to went home.", "I'd like to go home."],
  ["She was able to proved it.", "She was able to prove it."],
];
const choices: [string, string[]][] = [
  // Homographs after do: "saw" and "found" are base verbs too, so the user picks.
  ["Did you saw the movie?", ["Did you see the movie?"]],
  ["I did saw it!", ["I did see it!"]],
  ["Did you left the keys?", ["Did you leave the keys?"]],
  ["Did it bit you?", ["Did it bite you?"]],
  ["They didn't found it.", ["They didn't find it."]],
  // A modal before -ing, or before -ed without an object: base form or a missing "be".
  ["I will walking home.", ["I will walk home.", "I will be walking home."]],
  ["It will raining tomorrow.", ["It will rain tomorrow.", "It will be raining tomorrow."]],
  ["We shouldn't waiting.", ["We shouldn't wait.", "We shouldn't be waiting."]],
  [
    "The build couldn't finishing.",
    ["The build couldn't finish.", "The build couldn't be finishing."],
  ],
  ["We should updated.", ["We should update.", "We should be updated."]],
  [
    "You might interested in this.",
    ["You might interest in this.", "You might be interested in this."],
  ],
  [
    "New updates will arriving next week.",
    ["New updates will arrive next week.", "New updates will be arriving next week."],
  ],
  ["Users can't logged in.", ["Users can't log in.", "Users can't be logged in."]],
  [
    "The cache will expired soon.",
    ["The cache will expire soon.", "The cache will be expired soon."],
  ],
  [
    "A tool that will coming later.",
    ["A tool that will come later.", "A tool that will be coming later."],
  ],
  // 'd is would (base) or had (participle).
  // need/want + to + a noun: the object lost its article, or "to" is extra.
  [
    "We need to permission from the owner.",
    ["We need the permission from the owner.", "We need permission from the owner."],
  ],
  [
    "Users need to authentication first.",
    ["Users need the authentication first.", "Users need authentication first."],
  ],
  [
    "I want to information about it.",
    ["I want the information about it.", "I want information about it."],
  ],
  [
    "Needing to clarification delayed us.",
    ["Needing the clarification delayed us.", "Needing clarification delayed us."],
  ],
  [
    "They will need to data exported.",
    ["They will need the data exported.", "They will need data exported."],
  ],
];
test.each(choices)("offers a choice for %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  expect(findings[0].requiresChoice).toBe(true);
  expect(findings[0].bulk.eligible).toBe(false);
  expect(findings[0].alternatives.map((a) => applyEdits(source, a.edits))).toEqual(expected);
});

test("explains the missing be and the infinitive separately", () => {
  expect(review("I will walking home.")[0].messageKey).toBe("review_msg_modal_be");
  expect(review("We should updated the docs.")[0].messageKey).toBe("review_msg_auxiliary_base");
  expect(review("I want to went home.")[0].messageKey).toBe("review_msg_to_base");
  expect(review("I need to information.")[0].messageKey).toBe("review_msg_to_noun");
});

test.each(positives)("repairs %s", (source, expected) => {
  const findings = review(source);
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  expect(finding.original).toBe(source.slice(finding.range.start, finding.range.end));
  expect(finding.context.start).toBeLessThanOrEqual(finding.range.start);
  expect(finding.context.end).toBeGreaterThanOrEqual(finding.range.end);
  expect(finding.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
  expect(applyEdits(source, finding.alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

const negatives = [
  "Did she read the document?",
  "We did cut the cable.",
  "It might work.",
  "How does your work help?",
  "We will record the result.",
  "The can works as a container.",
  "She will present the works tomorrow.",
  "What I did works for us.",
  "Everything he does works.",
  "I do works of charity.",
  "She does runs for charity.",
  "We did reads of the script.",
  "They did takes of the scene.",
  "She does cuts for the salon.",
  "We did sets of exercises.",
  "I can saw wood.",
  "They will found a company.",
  "We did set the table.",
  "Did she know the answer?",
  "I did not understand the change.",
  "He can work remotely.",
  "She should have eaten.",
  "We might have gone.",
  "They could have written.",
  "He is working.",
  "She has worked.",
  "They had understood.",
  "I did.",
  "Did she?",
  "I can",
  "She does not",
  "We could of gone.",
  "He can Works remotely.",
  "Did her work matter?",
  "Does your work help?",
  "Do the works matter?",
  'Do not write "Did she went home?".',
  'The example "He can works" is wrong.',
  "`I did not understood it`",
  "```\nDid she went home?\n```",
  "I did `not` understood it.",
  "I did\nnot understood it.",
  "He can\n\nworks remotely.",
  "He can works.com",
  "I did understood@example.org",
  "He can works_file",
  "Did she went/go?",
  "He can workś remotely.",
  "He can 42works remotely.",
  "He can works-in-progress.",
  // Homographs of another verb, noun or adjective, and "do" as a main verb.
  "They will fell the old oak.",
  "Could you bore a hole here?",
  "We did ground checks.",
  "Can you lay the table?",
  "Did he lay the cards down?",
  "We did builds every night.",
  "They do rides at the fair.",
  "I did splits in gym class.",
  "We do resets on Mondays.",
  "Did you ask Drew?",
  "Will you Drew it?",
  // Lexical do with plural nouns, participle adjectives and homograph modifiers.
  "He did bit parts in films.",
  "We did tests on it.",
  "It did wonders for me.",
  "They do drugs.",
  "Do drugs ruin lives?",
  "We do reviews every week.",
  "She does interviews for the paper.",
  "We did advanced training.",
  "They did needed repairs.",
  "He does damage.",
  "The team did their best.",
  "Their kids did chores.",
  "The dog did tricks.",
  // will, can and may as nouns or names.
  "His will needs to be read.",
  "The will states it clearly.",
  "The last will states it.",
  "Her free will matters.",
  "The trash can smells.",
  "The tin can holds water.",
  "My May plans fell through.",
  "I saw Will walking home.",
  // Base verbs ending in -s/-ed, be forms, valid perfects and passives.
  "Did she miss the bus?",
  "Does it focus on speed?",
  "Can you process it?",
  "Can we proceed?",
  "Did you need it?",
  "It could been worse.",
  "We should have updated the docs.",
  "She will have finished.",
  "It may be used.",
  "They might be walking.",
  // -ing that is an everyday noun, "to" + -ing, and do + -ing.
  "We will meeting at noon.",
  "She should training more.",
  "We do testing on Fridays.",
  "We committed to fixing it.",
  "I look forward to seeing you.",
  // "supposed to"/"used to" after do or a modal: the repair is elsewhere.
  "I didn't supposed to go.",
  "It can used to store data.",
  // Casing, closed-class noun slots, and one noun only.
  "The Server did logged the error.",
  "That it did works.",
  "The new server did logged it.",
  // Prepositional "to" and heads outside the closed set.
  "I am going to meetings this week.",
  "I am going to advanced classes.",
  "Going to classes helps.",
  "She is used to working late.",
  "The key to success is focus.",
  "According to reports, it works.",
  "I listen to records.",
  "He is to blame.",
  "Our travel plans to Paris changed.",
  "We want to thank everyone.",
  "He has to leave.",
  "They need to be careful.",
  "He tried to.",
  "I wanted to, but it rained.",
  "Compared to yours, it works.",
  // Mid-sentence will/can/might/must that are nouns, names or follow inversion triggers.
  "Her last will was read aloud.",
  "The living will states her wishes.",
  "Political will matters more than money.",
  "He went against his own will.",
  "Employees can leave at will provided they give notice.",
  "The people's will prevailed.",
  "John's will named his sister.",
  "The tin can rolled away.",
  "A watering can leaked on the floor.",
  "The military might impressed the visitors.",
  "With all his might he pushed the door.",
  "Economic might matters.",
  "Free will tools are fun.",
  "Some say the will was forged.",
  "The second will specified otherwise.",
  "Nor will users notice the change.",
  "Only then can teams scale.",
  "When can users expect a fix?",
  "We will pay should costs rise further.",
  "We refund orders should affected users complain.",
  "They must needs come down.",
  "Anything you can do, I can do better.",
  "It may containg escapes.",
  // Inverted questions whose subject continues past a verb-shaped word.
  "Did the old works survive?",
  "Do the works matter?",
  "Does the app support dark modes?",
  "Does the app support exports?",
  // 'd + participle is had; 'd rather/better.
  "They'd gone home.",
  "She'd written it already.",
  "They'd finished by noon.",
  "I'd rather go home.",
  // "to" as a preposition before a state, a noun or a stranded clause end.
  "The file it points to exists.",
  "The site I went to went offline.",
  "The status changed from pending to approved.",
  "Set the flag to disabled.",
  "The project is close to finished.",
  "It defaults to enabled.",
  "This is related to costs.",
  "The fee is subject to changes.",
  "He moved to advanced topics.",
  "I'm going to meetings.",
  "I am going to meetings this week.",
  "Thanks to advanced tooling, it works.",
  "Listen to recorded lectures.",
  "They need to funds released first.",
  "to checked",
  // need/want + to + a word that is or may be a verb.
  "You need to password to log in.",
  "We need to backup daily.",
  "I need to unit test this.",
  "I need to override in the config.",
  "You want to proxy websockets.",
  "They need to proxy requests.",
  "I need to reposition the button.",
  "I need to repartition the disk.",
  "The need to information security is clear.",
  "We need to version the API.",
  "I need to clean up.",
];
test.each(negatives)("preserves %s", (text) => expect(review(text)).toEqual([]));

test("preserves dictionary, language, selected scope and code islands", () => {
  const text = "Did she went home?";
  const only = (result: ReturnType<typeof scan>) =>
    result.diagnostics.filter((d) => d.ruleId === ruleId);
  expect(only(scan(text, {}, { userDictionary: ["WENT"] }))).toEqual([]);
  expect(only(scan(text, {}, { lang: "fr_FR" }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 8, end: text.length } }))).toEqual([]);
  expect(only(scan(text, { scope: { start: 0, end: 10 } }))).toEqual([]);
  expect(only(scan(text, { protectedRanges: [{ start: 4, end: 7, reason: "code" }] }))).toEqual([]);
});

test("bounded lookups preserve ambiguous homographs and never guess unknown suffixes", () => {
  expect(englishVerbForms("understood")?.lemma).toBe("understand");
  expect(englishVerbForms("saw")?.ambiguous).toContain("saw");
  expect(englishVerbForms("found")?.ambiguous).toContain("found");
  expect(englishVerbForms("read")?.lemma).toBe("read");
  expect(englishVerbForms("fabricatedUnknowned")).toBeNull();
  // "lay" is lay's lemma and lie's past: no guess.
  expect(englishVerbForms("lay")).toBeNull();
  expect(englishVerbForms("laid")?.lemma).toBe("lay");
  expect(englishVerbForms("lain")?.lemma).toBe("lie");
  expect(englishVerbForms("Fell")?.ambiguous).toContain("fell");
  expect(englishVerbForms("underwent")).toMatchObject({
    lemma: "undergo",
    participle: "undergone",
  });
  for (const regular of ["showed", "proved", "gotten", "dove"])
    expect(englishVerbForms(regular)).toBeNull();
});

test("chunk-edge evidence, emoji and CRLF keep exact offsets", () => {
  const text = "😀 Café́. " + "word ".repeat(795) + ". Did she went home?\r\nHe can works remotely.";
  const findings = review(text);
  expect(findings).toHaveLength(2);
  expect(findings[0].range.start).toBe(text.indexOf("Did"));
  expect(findings[1].range.start).toBe(text.indexOf("He"));
  let corrected = text;
  for (const finding of [...findings].reverse())
    corrected = applyEdits(corrected, finding.alternatives[0].edits)!;
  expect(corrected).toBe(text.replace("went", "go").replace("works", "work"));
  expect(review(corrected)).toEqual([]);
});

test("native overlap stays distinct and typing never instantiates this rule", () => {
  const findings = scan("We could of gone. You was late. Did she went home?").diagnostics;
  expect(findings.filter((d) => d.ruleId === ruleId)).toHaveLength(1);
  expect(findings.filter((d) => d.ruleId === "englishModalOfCorrection")).toHaveLength(1);
  expect(findings.filter((d) => d.ruleId === "englishPronounVerbWhitelistAgreement")).toHaveLength(
    1,
  );
  expect(
    createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }).map((r) => r.id),
  ).not.toContain(ruleId);
});

test("leaves 'd + irregular past to englishPerfectParticiples", () => {
  for (const source of [
    "They'd went home.",
    "She’d wrote it already.",
    "We knew they'd ran out of time.",
  ]) {
    const all = scan(source).diagnostics;
    expect(all.filter((d) => d.ruleId === ruleId)).toEqual([]);
    expect(all.filter((d) => d.ruleId === "englishPerfectParticiples")).toHaveLength(1);
  }
});
