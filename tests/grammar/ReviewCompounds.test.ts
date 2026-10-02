import { expect, test } from "bun:test";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { spellingCandidates } from "../../src/core/domain/grammar/review/reviewSpelling";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { TYPING_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import type {
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
const rule = "englishContextualCompounds";
function all(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  options: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(
    { id: "compounds", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      ...options,
    },
  ).diagnostics;
}
const scan = (text: string) => all(text).filter((d) => d.ruleId === rule);
const repairs: [string, string][] = [
  ["I use this tool everyday.", "I use this tool every day."],
  ["She checks the report everyday.", "She checks the report every day."],
  ["We read the file everyday.", "We read the file every day."],
  ["He opened the app everyday.", "He opened the app every day."],
  ["They visit the office everyday.", "They visit the office every day."],
  ["You reviewed the plan everyday.", "You reviewed the plan every day."],
  ["She tests the device everyday.", "She tests the device every day."],
  ["We work remotely everyday.", "We work remotely every day."],
  ["He walks home everyday.", "He walks home every day."],
  ["They ran the tests everyday.", "They ran the tests every day."],
  ["I write code everyday.", "I write code every day."],
  ["We sent the report everyday.", "We sent the report every day."],
  ["I use this unknownword everyday.", "I use this unknownword every day."],
  ["We stretch everyday, even on weekends.", "We stretch every day, even on weekends."],
  ["Each and everyday matters.", "Each and every day matters."],
  ["Please login to continue.", "Please log in to continue."],
  ["You can login to your account.", "You can log in to your account."],
  ["We need to login to the account.", "We need to log in to the account."],
  ["They will login again.", "They will log in again."],
  ["I should login today.", "I should log in today."],
  ["We plan to login tomorrow.", "We plan to log in tomorrow."],
  ["You must login before continuing.", "You must log in before continuing."],
  ["Please login with your password.", "Please log in with your password."],
  ["They can login using your password.", "They can log in using your password."],
  ["I want to login to view the report.", "I want to log in to view the report."],
  ["We need to login to open the file.", "We need to log in to open the file."],
  ["You can login to check your messages.", "You can log in to check your messages."],
  ["We need to setup the environment.", "We need to set up the environment."],
  ["Please setup your account.", "Please set up your account."],
  ["You can setup the device.", "You can set up the device."],
  ["They plan to setup our project.", "They plan to set up our project."],
  ["He will setup the server.", "He will set up the server."],
  ["I want to setup this folder.", "I want to set up this folder."],
  ["We should setup the test.", "We should set up the test."],
  ["She can setup the screen.", "She can set up the screen."],
  ["You must setup your keyboard.", "You must set up your keyboard."],
  ["Please setup the connection.", "Please set up the connection."],
  ["We need to setup the database.", "We need to set up the database."],
  ["They will setup the workspace.", "They will set up the workspace."],
  ["We need to setup an unknownword.", "We need to set up an unknownword."],
  ["Ask the team to login before noon.", "Ask the team to log in before noon."],
  ["Why can't I login?", "Why can't I log in?"],
];
test.each(repairs)("contextual compounds repair %s", (source, expected) => {
  const findings = scan(source);
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.alternatives).toHaveLength(1);
  expect(d.context.start).toBeLessThan(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
const valid = [
  "These are everyday tasks.",
  "Our everyday work is important.",
  "This is an everyday problem.",
  "I use this tool every day.",
  "An every-day occurrence.",
  "Everyday life changes.",
  "I use everyday tools.",
  "I use this tool Everyday.",
  "I use this tool EVERYDAY.",
  "I use this tool everyDay.",
  "I use this tool everydayMode.",
  "I use this tool everyday.example",
  "I use this tool everyday_id.",
  "I use this tool everydaý.",
  "I use this tool\neveryday.",
  "I use this tool `everyday`.",
  'Type "I use this tool everyday." exactly.',
  'The example "I use this tool everyday." is wrong.',
  "Every day is different.",
  "It is everyday.",
  "Our everyday.",
  "These are everyday.",
  "Everyday objects, everyday people.",
  "Everyday is a product name.",
  "I work on Everyday.",
  "I like the word everyday.",
  "The login failed.",
  "The login page is ready.",
  "Please log in to continue.",
  "The log-in failed.",
  "The log in failed.",
  "Call login() before starting.",
  "Run login --help.",
  "Please run login to continue.",
  "Use --login to continue.",
  "The command is login.",
  "Please login",
  "Please login to",
  "Please login unknownword.",
  "Please Login to continue.",
  "Please LOGIN to continue.",
  "Please logIn to continue.",
  "Please loginMode to continue.",
  "Please login\nto continue.",
  "Please\nlogin to continue.",
  "Please login to continue.next",
  "Please login to continue_id.",
  "Please login to continué.",
  'Type "Please login to continue." exactly.',
  "`Please login to continue.`",
  "https://example.test/login",
  "We use Login for authentication.",
  "The setup is complete.",
  "The setup guide is ready.",
  "The set-up is complete.",
  "The set up is complete.",
  "The configuration key is setupMode.",
  "Call setup() before starting.",
  "Please run setup --help.",
  "Use setup.exe.",
  "We need to setup",
  "We need to setup the",
  "We need to setupMode the environment.",
  "We need to Setup the environment.",
  "We need to SETUP the environment.",
  "We need to setUp the environment.",
  "We need to\nsetup the environment.",
  "We need to setup\nthe environment.",
  "We need to setup the environment.name",
  "We need to setup the environment_id.",
  "We need to setup the environment́.",
  'The example "We need to setup the environment." is wrong.',
  "`We need to setup the environment.`",
  "The webhook received the payload.",
  "Our changelog is available.",
  "The input handler works.",
  "A background task failed.",
  "Please set up the environment.",
];
test.each(valid)("contextual compounds preserve %s", (text) => expect(scan(text)).toEqual([]));
test("native compound findings own spelling spans without touching candidate ordering", () => {
  for (const [text] of [repairs[0], repairs[12], repairs[24]]) {
    const findings = scan(text);
    const d = findings[0];
    const prepared = prepareReview(
      { id: "spell", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: [rule],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    );
    expect(spellingCandidates(prepared, []).map((c) => c.word)).toContain(d.original);
    expect(
      spellingCandidates(
        prepared,
        findings.map((d) => d.range),
      ).map((c) => c.word),
    ).not.toContain(d.original);
  }
  expect(TYPING_RULE_IDS as readonly string[]).not.toContain(rule);
});
test("compound replacements respect dictionary, read-only segments, language and scope", () => {
  for (const [text] of [repairs[0], repairs[12], repairs[24]]) {
    const d = scan(text)[0];
    const only = (extra: Partial<ReviewSourceSnapshot>, options: Partial<ReviewOptions> = {}) =>
      all(text, extra, { enabledRules: [rule], ...options });
    expect(only({}, { lang: "fr_FR" })).toEqual([]);
    expect(only({}, { userDictionary: [d.original] })).toEqual([]);
    expect(only({ protectedRanges: [{ ...d.range, reason: "code" }] })).toEqual([]);
    expect(only({ scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
    expect(only({ scope: d.range })).toHaveLength(1);
    expect(only({ id: "new" })[0].id).not.toBe(d.id);
  }
  expect(scan("We need to setup\uFFFC the environment.")).toEqual([]);
  expect(scan("Please\tlogin to continue.")).toHaveLength(1);
  expect(scan("We need to\u00a0setup the environment.")).toHaveLength(1);
});
test("compound findings belong to one chunk through Unicode and ordinary quoted prose", () => {
  const text = '😀 Café.\r\nShe said, "Please login to continue." I use this tool everyday.';
  const prepared = prepareReview(
    { id: "chunks", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules: [rule], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  const expected = scan(text);
  expect(expected).toHaveLength(2);
  for (let cut = 1; cut < text.length; cut++) {
    const raw = [
      ...scanReviewChunk(prepared, { start: 0, end: cut }).findings,
      ...scanReviewChunk(prepared, { start: cut, end: text.length }).findings,
    ].sort((a, b) => a.range.start - b.range.start);
    expect(raw.map((d) => [d.range, text.slice(d.range.start, d.range.end)])).toEqual(
      expected.map((d) => [d.range, d.original]),
    );
  }
});

test.each([
  ["The every day routine helps.", "The everyday routine helps."],
  ["It solves an every day problem.", "It solves an everyday problem."],
  ["Beyond every day things, it helps.", "Beyond everyday things, it helps."],
])("every day before a listed noun joins: %s", (source, expected) => {
  const [d] = scan(source);
  expect(scan(source)).toHaveLength(1);
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});
test.each([
  "I run every day routine checks.",
  "Every day life changes.",
  "We meet every day people.",
])("every day without a determiner stays apart: %s", (text) => expect(scan(text)).toEqual([]));
