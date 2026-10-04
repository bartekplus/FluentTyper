import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import {
  englishNounForms,
  knownEnglishNounNumber,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishNounNumber";
import {
  expectChunkSplitParity,
  expectOneRepair,
  expectReviewGuards,
  prepared,
  review,
} from "./grammarTestUtils";
const rule = "englishNounNumber";
const all = (text: string) => review(text).diagnostics;
const scan = (text: string) => all(text).filter((d) => d.ruleId === rule);
const repairs: [string, string][] = [
  ["One of the device failed.", "One of the devices failed."],
  ["One of the file is missing.", "One of the files is missing."],
  ["One of the new report arrived.", "One of the new reports arrived."],
  ["One of the document was missing.", "One of the documents was missing."],
  ["One of the key is broken.", "One of the keys is broken."],
  ["One of the account has failed.", "One of the accounts has failed."],
  ["One of the answer is useful.", "One of the answers is useful."],
  ["One of the keyboard was broken.", "One of the keyboards was broken."],
  ["One of the message arrived.", "One of the messages arrived."],
  ["One of the child returned.", "One of the children returned."],
  ["One of the person is missing.", "One of the people is missing."],
  ["One of the mouse returned.", "One of the mice returned."],
  ["We found two error in the report.", "We found two errors in the report."],
  ["We found three file in the folder.", "We found three files in the folder."],
  ["I saw 4 device on the table.", "I saw 4 devices on the table."],
  ["We received five message.", "We received five messages."],
  ["They found six key in the room.", "They found six keys in the room."],
  ["We need seven account.", "We need seven accounts."],
  ["I saw eight child.", "I saw eight children."],
  ["They found nine person near the office.", "They found nine people near the office."],
  ["We counted ten mouse.", "We counted ten mice."],
  ["We found zero problem.", "We found zero problems."],
  ["One files arrived.", "One file arrived."],
  ["We received 1 documents.", "We received 1 document."],
  ["Those file are missing.", "Those files are missing."],
  ["These device were broken.", "These devices were broken."],
  ["Those new report are ready.", "Those new reports are ready."],
  ["These document were useful.", "These documents were useful."],
  ["Those key are old.", "Those keys are old."],
  ["These account are new.", "These accounts are new."],
  ["Those child are ready.", "Those children are ready."],
  ["These person were available.", "These people were available."],
  ["Those mouse are missing.", "Those mice are missing."],
  ["These file is missing.", "This file is missing."],
  ["Those device was broken.", "That device was broken."],
  ["These new report is ready.", "This new report is ready."],
  ["We hired three new woman.", "We hired three new women."],
  ["One of the criterion failed.", "One of the criteria failed."],
  ["Those tooth are broken.", "Those teeth are broken."],
  ["These analysis were useful.", "These analyses were useful."],
  ["She owns one knives.", "She owns one knife."],
  ["We interviewed 2 fisherman.", "We interviewed 2 fishermen."],
];
test.each(repairs)("noun number repairs %s", (source, expected) => {
  const d = expectOneRepair(scan(source), source, expected, scan);
  expect(d.alternatives).toHaveLength(1);
  expect(d.context.end).toBeGreaterThan(d.range.end);
});
const choices: [string, string, string][] = [
  ["Those file failed.", "Those files failed.", "That file failed."],
  ["These device arrived.", "These devices arrived.", "This device arrived."],
  ["Those child returned.", "Those children returned.", "That child returned."],
  ["These old report arrived.", "These old reports arrived.", "This old report arrived."],
];
test.each(choices)("noun number asks for the intended count in %s", (source, plural, singular) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.requiresChoice).toBe(true);
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual([plural, singular]);
  expect(scan(plural)).toEqual([]);
  expect(scan(singular)).toEqual([]);
});
const valid = [
  "One of the devices failed.",
  "These data are useful.",
  "The news is good.",
  "The two sheep returned.",
  "This series is complete.",
  "A five-year plan.",
  "A two-device setup.",
  "Those file names are confusing.",
  "These account settings are useful.",
  "Two file names are missing.",
  "One of the device drivers failed.",
  "Those report authors are missing.",
  "One of the file formats is old.",
  "One of the child actors arrived.",
  "Those mouse pads are new.",
  "Those key bindings are useful.",
  "Two device IDs returned.",
  "2 kg.",
  "3 ms.",
  "1 MB.",
  "Two metres.",
  "Three degrees.",
  "Model 2 file.",
  "Version 3 device.",
  "Code 4 error.",
  "A 2-device setup.",
  "A 10-key keyboard.",
  "A two-file report.",
  "1.2 file.",
  "1/2 file.",
  "1,000 file.",
  "We received twenty one files.",
  "We received one hundred and one files.",
  "We received zero point one files.",
  "We received two or one files.",
  "1,001 files.",
  "1, 001 files.",
  "1 001 files.",
  "1\u00a0001 files.",
  "1\u202f001 files.",
  "The 2nd file arrived.",
  "The third device failed.",
  "16rd",
  "42RD",
  "Two series arrived.",
  "One news arrived.",
  "Two fish returned.",
  "Two deer returned.",
  "Two unknownword arrived.",
  "Those unknownword are missing.",
  "One of the unknownword failed.",
  "One of the equipment failed.",
  "Two information.",
  "These furniture are old.",
  "These scissors are new.",
  "Those trousers are old.",
  "One file arrived.",
  "Two files arrived.",
  "Those files are missing.",
  "These devices were broken.",
  "This file is missing.",
  "That device was broken.",
  "One of the children returned.",
  "One of the people is missing.",
  "We found three mice.",
  "We found zero problems.",
  "We received 1 document.",
  "Those files failed.",
  "That file failed.",
  "Those file",
  "We found two",
  "Those file have unknownword.",
  "Those file names.",
  "One of\nthe device failed.",
  "Two\nfile arrived.",
  "Those file\nare missing.",
  "Those `file` are missing.",
  "One of the device.failed",
  "Two file.path",
  "Those file are missing_id.",
  "Those file are missinǵ.",
  'Type "One of the device failed." exactly.',
  'The example "Those file are missing." is wrong.',
  "`We found two error in the report.`",
  "These FILE_ID are missing.",
  "These fIle are missing.",
  // Pronoun "one" followed by a verb.
  "No one answers.",
  "Each one reports.",
  "The one leaves.",
  "She waited. One leaves.",
  "“One lives.”",
  // Measurements, same-form and shared plurals stay out of the table.
  "He is six foot.",
  "The two fish are ready.",
  "Those axes are sharp.",
  // A no-break space after a label word ("model two") is a space too.
  "See model\u00a0two file failed.",
];
test.each(valid)("noun number preserves %s", (text) => expect(scan(text)).toEqual([]));
test("shared noun forms are explicit and existential agreement follows quantity repair", () => {
  expect(englishNounForms("child")).toEqual({ singular: "child", plural: "children" });
  expect(knownEnglishNounNumber("children")).toBe("plural");
  for (const word of ["sheep", "news", "series", "data", "unknowns", "foot", "axes", "schemas"])
    expect(englishNounForms(word)).toBeNull();
  const source = "There is two error in the report.";
  expect(all(source).filter((d) => d.ruleId === "englishExistentialAgreement")).toEqual([]);
  const d = scan(source)[0];
  const next = applyEdits(source, d.alternatives[0].edits)!;
  expect(next).toBe("There is two errors in the report.");
  const agreement = all(next).filter((d) => d.ruleId === "englishExistentialAgreement");
  expect(agreement).toHaveLength(1);
  expect(applyEdits(next, agreement[0].alternatives[0].edits)).toBe(
    "There are two errors in the report.",
  );
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("number findings preserve dictionary, scope, language and protected evidence", () => {
  for (const text of [repairs[0][0], repairs[12][0], repairs[24][0], choices[0][0]]) {
    const d = scan(text)[0];
    expectReviewGuards(
      (text, extra, options) =>
        review(text, extra, { enabledRules: [rule], ...options }).diagnostics,
      text,
      d,
      { dictionaryWord: d.original.split(" ").at(-1)!, protectedReason: "code" },
    );
  }
  expect(scan("Those file\uFFFC are missing.")).toEqual([]);
});
test("fixed and ambiguous ranges belong to one chunk in Unicode quoted prose", () => {
  const text = '😀 Café.\r\nShe said, "Those file failed." We found two error in the report.';
  const expected = scan(text);
  expect(expected).toHaveLength(2);
  expectChunkSplitParity(prepared(text, {}, { enabledRules: [rule] }), text, expected);
});

test.each([
  ["One of the old ticket is still valid.", "One of the old tickets is still valid."],
  ["She was one of the best teacher I had.", "She was one of the best teachers I had."],
  ["We lost one of our user in the move.", "We lost one of our users in the move."],
  ["Not a single one of the step, sadly.", "Not a single one of the steps, sadly."],
  ["One of the user account is locked.", "One of the user accounts is locked."],
  ["We saw one of these elephant.", "We saw one of these elephants."],
])("one of + singular pluralizes %s", (source, expected) => {
  expectOneRepair(scan(source), source, expected, scan);
});
test.each([
  "One of the file formats is old.",
  "One of the test cases failed.",
  "One of the team is here.",
  "One of the best is here.",
  "This is one of the ways.",
])("one of + noun preserves %s", (text) => expect(scan(text)).toEqual([]));

test.each([
  ["Music from the 1960's still sells.", ["Music from the 1960s still sells."]],
  ["It was big in the late 1990’s.", ["It was big in the late 1990s."]],
  ["A radio (1950's) sat on the shelf.", ["A radio (1950s) sat on the shelf."]],
  ["We loved the 90's.", ["We loved the '90s.", "We loved the 90s."]],
  ["We loved the 90’s.", ["We loved the ’90s.", "We loved the 90s."]],
  ["There were 100's of replies.", ["There were 100s of replies."]],
])("decades and round plurals drop the apostrophe: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.requiresChoice ?? false).toBe(expected.length > 1);
  expect(d.alternatives.map((a) => applyEdits(source, a.edits))).toEqual(expected);
  for (const text of expected) expect(all(text)).toEqual([]);
});
test.each([
  "Windows 10's taskbar is new.",
  "The HP 1910's fan is loud.",
  "1977's best month was May.",
  "2020's biggest hits were loud.",
  "View user-2000's avatar.",
  "We loved the 1990s.",
  "We loved the '80s.",
  "Version 3.10's changelog is short.",
  "The 200's are rare.",
])("decade plurals preserve %s", (text) => expect(scan(text)).toEqual([]));
