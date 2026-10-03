import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits, editTouches } from "../../src/core/domain/grammar/review/textRanges";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { spellingCandidates } from "../../src/core/domain/grammar/review/reviewSpelling";
import type { ReviewEdit } from "../../src/core/domain/grammar/review/types";
import * as capitalization from "./reviewLanguageFixtures/capitalization";
import * as measurement from "./reviewLanguageFixtures/measurement";
import * as punctuation from "./reviewLanguageFixtures/punctuation";
import * as words from "./reviewLanguageFixtures/words";
import { MATRIX_LANGUAGES, type RuleFixtures } from "./reviewLanguageFixtures/types";
function scan(text: string, lang = "en_US") {
  return detectReviewDiagnostics(
    { id: "corpus", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
}
const repairs = [
  ["englishUsagePhrases", "We finally finded the problem.", "We finally found the problem."],
  [
    "englishContextualCompounds",
    "Formatting should be tested aswell.",
    "Formatting should be tested as well.",
  ],
  [
    "englishSubjectVerbAgreement",
    "Done. The feature look promising.",
    "Done. The feature looks promising.",
  ],
  [
    "englishUsagePhrases",
    "Do you know where is the configuration file?",
    "Do you know where the configuration file is?",
  ],
  [
    "englishUsagePhrases",
    "Can you tell me why did the process crash?",
    "Can you tell me why the process crashed?",
  ],
  ["englishUsagePhrases", "I wonder what does this option do.", "I wonder what this option does."],
  [
    "englishUsagePhrases",
    "Nobody knows when will the new version be released.",
    "Nobody knows when the new version will be released.",
  ],
  ...(
    [
      ["The feature look quite promising.", "The feature looks quite promising."],
      ["The application sometimes accept words.", "The application sometimes accepts words."],
      [
        "The system also struggle with constructions.",
        "The system also struggles with constructions.",
      ],
      ["The software make many mistakes.", "The software makes many mistakes."],
      ["The feature work correctly.", "The feature works correctly."],
      ["It suggest a correction.", "It suggests a correction."],
      ["It completely forget an article.", "It completely forgets an article."],
      ["Everyone have other tasks to finish.", "Everyone has other tasks to finish."],
      ["Nobody have checked the file.", "Nobody has checked the file."],
      ["The last few weeks has been busy.", "The last few weeks have been busy."],
      [
        "Verb tense detection still need improvements.",
        "Verb tense detection still needs improvements.",
      ],
      ["Prepositions often causes subtle issues.", "Prepositions often cause subtle issues."],
      ["Conditional sentences also causes trouble.", "Conditional sentences also cause trouble."],
      [
        "Numbers and dates creates additional edge cases.",
        "Numbers and dates create additional edge cases.",
      ],
      [
        "Some sentences are grammatical but still sounds unnatural.",
        "Some sentences are grammatical but still sound unnatural.",
      ],
      ["Each of them were consuming memory.", "Each of them was consuming memory."],
      ["Each of the tests have passed.", "Each of the tests has passed."],
      ["Some of them isn't detected.", "Some of them aren't detected."],
      [
        "The solution actually solve the original issue.",
        "The solution actually solves the original issue.",
      ],
      ["Everything seem to work.", "Everything seems to work."],
      ["The results looks good.", "The results look good."],
    ] as const
  ).map(([source, expected]) => ["englishSubjectVerbAgreement", source, expected]),
  [
    "englishCountability",
    "We need to buy new equipments for the laboratory.",
    "We need to buy new equipment for the laboratory.",
  ],
  [
    "englishCountability",
    "Review all the datas collected during previous tests.",
    "Review all the data collected during previous tests.",
  ],
  [
    "englishCountability",
    "Decide which criterias should be used.",
    "Decide which criteria should be used.",
  ],
  [
    "englishFixedPrepositions",
    "He is responsible of testing the Windows version.",
    "He is responsible for testing the Windows version.",
  ],
  [
    "englishFixedPrepositions",
    "She has been working here since three years, while I rest.",
    "She has been working here for three years, while I rest.",
  ],
  ["englishFixedPrepositions", "I have worked here from 2021.", "I have worked here since 2021."],
  [
    "englishFixedPrepositions",
    "We arrived to the office at 9:00.",
    "We arrived at the office at 9:00.",
  ],
  [
    "englishFixedPrepositions",
    "We waited the manager for nearly 30 minutes.",
    "We waited for the manager for nearly 30 minutes.",
  ],
  [
    "englishFixedPrepositions",
    "We agreed to investigate on it later.",
    "We agreed to investigate it later.",
  ],
  ["englishUsagePhrases", "Between you and I, this works.", "Between you and me, this works."],
  [
    "englishUsagePhrases",
    "The configuration had a big affect on performance.",
    "The configuration had a big effect on performance.",
  ],
  [
    "englishUsagePhrases",
    "I don't know weather they will finish it today.",
    "I don't know whether they will finish it today.",
  ],
  [
    "englishUsagePhrases",
    "The developer who's laptop crashed said that it broke.",
    "The developer whose laptop crashed said that it broke.",
  ],
  ["englishUsagePhrases", "It was caused by a lose cable.", "It was caused by a loose cable."],
  [
    "englishUsagePhrases",
    "It is intuitive, accept for the advanced settings page.",
    "It is intuitive, except for the advanced settings page.",
  ],
  [
    "englishVerbComplements",
    "I enjoy to work on difficult technical problems.",
    "I enjoy working on difficult technical problems.",
  ],
  ["englishVerbComplements", "I avoid to work late at night.", "I avoid working late at night."],
  [
    "englishVerbComplements",
    "We decided testing the feature again tomorrow.",
    "We decided to test the feature again tomorrow.",
  ],
  [
    "englishVerbComplements",
    "We suggested to add more unit tests.",
    "We suggested adding more unit tests.",
  ],
  [
    "englishVerbComplements",
    "She made me to restart the service.",
    "She made me restart the service.",
  ],
  ["englishVerbComplements", "She let me to check the logs.", "She let me check the logs."],
  [
    "englishVerbComplements",
    "It helps them to finding mistakes.",
    "It helps them to find mistakes.",
  ],
  [
    "englishPronounVerbWhitelistAgreement",
    "It also don't always notice duplicated words.",
    "It also doesn't always notice duplicated words.",
  ],
  [
    "englishExistentialAgreement",
    "There is also several problems.",
    "There are also several problems.",
  ],
  ["englishExistentialAgreement", "There was several problems.", "There were several problems."],
  [
    "englishExistentialAgreement",
    "There is still a lot of problems.",
    "There are still a lot of problems.",
  ],
  [
    "englishFixedPrepositions",
    "We discussed about the problem during the meeting.",
    "We discussed the problem during the meeting.",
  ],
  [
    "englishFixedPrepositions",
    "I am interested on checking the Linux build.",
    "I am interested in checking the Linux build.",
  ],
  [
    "englishItsContext",
    "The company changed it's policy, but it worked.",
    "The company changed its policy, but it worked.",
  ],
  [
    "englishItsContext",
    "It works, but its unclear whether the change will affect us.",
    "It works, but it's unclear whether the change will affect us.",
  ],
  [
    "englishDoubledDegree",
    "The new version is more faster than the previous one.",
    "The new version is faster than the previous one.",
  ],
  [
    "englishDoubledDegree",
    "It is also much more simpler to use.",
    "It is also much simpler to use.",
  ],
  [
    "englishDoubledDegree",
    "This algorithm is the most easiest solution we tried so far.",
    "This algorithm is the easiest solution we tried so far.",
  ],
  ["englishOrdinalSuffix", "We met on October 3st.", "We met on October 3rd."],
];
test.each(repairs)("corpus regression %s: %s", (rule, source, expected) => {
  const findings = scan(source).filter((d) => d.ruleId === rule);
  expect(findings).toHaveLength(1);
  expect(applyEdits(source, findings[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected).filter((d) => d.ruleId === rule)).toEqual([]);
  for (const quoted of [`The example "${source}" is incorrect.`, `\`${source}\``])
    expect(scan(quoted).filter((d) => d.ruleId === rule)).toEqual([]);
});
test("quantified mass nouns warn without inventing a quantity or repair", () => {
  for (const source of [
    "We received many useful feedbacks from our users.",
    "We received several important informations from the testing team.",
    "One tester gave us three advices about the user interface.",
    "It provides a information.",
  ]) {
    const findings = scan(source).filter((d) => d.ruleId === "englishCountability");
    expect(findings).toHaveLength(1);
    expect(findings[0].warningOnly).toBe(true);
    expect(findings[0].alternatives).toEqual([]);
    expect(findings[0].bulk.eligible).toBe(false);
  }
});
test("nearby valid grammar and ambiguous interpretations remain untouched", () => {
  for (const source of [
    "I suggest that the feature work correctly.",
    "It is essential that everyone have other tasks.",
    "If each of them were consuming memory, we would notice.",
    "The team are working together.",
    "The software makes many mistakes.",
    "Since three years ago, it has worked.",
    "I have worked here since three years ago.",
    "I worked here from 2021 to 2023.",
    "We arrived to find the office empty.",
    "We waited the whole day.",
    "We discussed what the book was about.",
    "We need more faster computers.",
    "We should effect a change.",
    "The intervention did not effect stability.",
    "The system and the application work correctly.",
    "The features of the application work correctly.",
    "The result of the applications looks good.",
    "The features of\nthe application work correctly.",
    "The system and\nthe application work correctly.",
    "The result of\nthe applications looks good.",
    "The patient displayed a flat affect.",
    "The weather they predicted arrived.",
    "We suggested testing the feature.",
    "We decided testing the feature and writing the documentation would take a week.",
    "We decided testing the feature, rather than documenting it, was necessary.",
    "The application allows users editing their text, but not users reading it.",
    "We allowed users editing their text to continue.",
    "The application allows users editing their text to continue.",
    "The bank gave us three advices about the user interface.",
    "We received three pieces of advice.",
    "Where is the configuration file?",
    "Why did the process crash?",
    "What does this option do?",
    "When will the new version be released?",
  ]) {
    expect(
      scan(source).filter((d) =>
        [
          "englishSubjectVerbAgreement",
          "englishFixedPrepositions",
          "englishUsagePhrases",
          "englishDoubledDegree",
          "englishVerbComplements",
          "englishCountability",
        ].includes(d.ruleId),
      ),
    ).toEqual([]);
  }
});
test("review formats supported measurements in a prose list without changing technical expressions", () => {
  const text = "Users may type 10kg, 25km, 100ms, 5GB or 20% CPU usage.";
  expect(
    scan(text)
      .filter((d) => d.ruleId === "measurementUnitFormatting")
      .map((d) => d.original),
  ).toEqual(["10kg", "25km", "100ms"]);
  for (const text of [
    "f(10kg, 25km)",
    "x=[10kg, 25km]",
    "https://example.com/10kg, 25km",
    "10kg+25km",
    "10kg_name, 25km",
  ]) {
    expect(scan(text).filter((d) => d.ruleId === "measurementUnitFormatting")).toEqual([]);
  }
});
test("explicit quoted error examples stay unchanged while ordinary dialogue is checked", () => {
  for (const text of [
    'Somebody writes "the the application crashed".',
    'Words such as "recieve", "seperate" and "definately" are examples.',
    'The example "We discussed about the problem." is incorrect.',
    "The example ‘We don’t recieve it.’ is wrong.",
    "The example 'We don't recieve it.' is wrong.",
    "The example ‘The users’ recieve mail.’ is wrong.",
    "The example ‘THE USERS’ recieve mail.’ is wrong.",
    "The example ‘The users’ Recieve mail.’ is wrong.",
  ])
    expect(scan(text)).toEqual([]);
  expect(
    scan('She said, "I saw the the file."').some((d) => d.ruleId === "englishRepeatedWords"),
  ).toBe(true);
  expect(
    scan('She said, "Please recieve it."').some(
      (d) => d.ruleId === "englishTypoWhitelistCorrection",
    ),
  ).toBe(true);
});
test("dictionary candidates preserve quoted examples and numeric second abbreviations", () => {
  const text = "The example “recieve” is wrong. We waited 0.75 sec. Please recieve it.";
  const prepared = prepareReview(
    { id: "spelling", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules: [], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  const candidates = spellingCandidates(prepared, []);
  expect(candidates.filter((c) => c.word === "recieve").map((c) => c.range.start)).toEqual([
    text.lastIndexOf("recieve"),
  ]);
  expect(candidates.some((c) => c.word === "sec")).toBe(false);
});
test("repeated infinitival to is an individual repair", () => {
  const text = "We need to to restart it.";
  const d = scan(text).find((d) => d.ruleId === "englishRepeatedWords")!;
  expect(d).toBeDefined();
  expect(d.bulk.eligible).toBe(false);
  expect(applyEdits(text, d.alternatives[0].edits)).toBe("We need to restart it.");
});
test("balanced earlier quotes do not silence distant unquoted ordinals", () => {
  const text =
    'She said, "Ready."\n' +
    "Ordinary prose continues here. ".repeat(160) +
    "We met on September 21th.";
  expect(
    scan(text)
      .filter((d) => d.ruleId === "englishOrdinalSuffix")
      .map((d) => d.alternatives[0].preview),
  ).toEqual(["21st"]);
  expect(
    scan('She said, "We met on September 21th."').filter(
      (d) => d.ruleId === "englishOrdinalSuffix",
    ),
  ).toEqual([]);
});

test("st remains a measurement outside named date context", () => {
  for (const text of [
    "He weighs 12st.",
    "The patient weighs 3st.",
    "Weight: 10st.",
    "11st 4lb",
    "16rd",
    "42RD",
  ])
    expect(scan(text).filter((d) => d.ruleId === "englishOrdinalSuffix")).toEqual([]);
});
test("decades and leading elisions do not open a quotation", () => {
  for (const prefix of ["We played '90s music.", "'Tis a fine day.", "‘Twas yesterday."])
    expect(
      scan(`${prefix} We met on September 21th.`)
        .filter((d) => d.ruleId === "englishOrdinalSuffix")
        .map((d) => d.original),
    ).toEqual(["21th"]);
  expect(
    scan("The example '90s 21th' is literal.").filter((d) => d.ruleId === "englishOrdinalSuffix"),
  ).toEqual([]);
});
test("supplied full prose retains supported repairs and its reference stays clean", () => {
  const broken = readFileSync(
    new URL("../fixtures/native-review-corpus/broken.txt", import.meta.url),
    "utf8",
  );
  const reference = readFileSync(
    new URL("../fixtures/native-review-corpus/reference.txt", import.meta.url),
    "utf8",
  );
  const findings = scan(broken);
  for (const [anchor, rule, replacement] of [
    ["We discussed about the problem during the meeting", "englishFixedPrepositions", ""],
    ["changed it's policy", "englishItsContext", "its"],
    ["more faster than the previous one", "englishDoubledDegree", "faster"],
    ["september 21th", "englishOrdinalSuffix", "21st"],
    ["october 3st", "englishOrdinalSuffix", "3rd"],
    ["what does this option do", "englishUsagePhrases", "this option does"],
    ["25km", "measurementUnitFormatting", "25\u00a0km"],
  ]) {
    const start = broken.indexOf(anchor);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(
      findings.some(
        (d) =>
          d.ruleId === rule &&
          d.range.start >= start &&
          d.range.end <= start + anchor.length &&
          d.alternatives.some((a) => a.preview === replacement),
      ),
    ).toBe(true);
  }
  expect(scan(reference)).toEqual([]);
});

/** Overlap, a shared insertion point, or an insertion inside the other edit (as Fix all plans). */
function collide(a: ReviewEdit, b: ReviewEdit): boolean {
  return a.start === a.end ? editTouches(a, b) : editTouches(b, a);
}

test("realistic prose never gets two findings whose fixes collide", () => {
  // Measured before choosing an overlap policy: nowhere in this corpus or the
  // language fixtures do two findings' fixes touch the same characters. Pairs
  // that do (a capital at a lowercase sentence start inside a longer fix: "a
  // apple") only appear in fragments; Fix all defers or proves such a group
  // (bulkPlanner) and applying one card rechecks the other, so no finding is
  // dropped in favour of another. This guards that choice.
  const texts: Array<[string, string]> = ["broken.txt", "reference.txt"].map((name) => [
    "en_US",
    readFileSync(new URL(`../fixtures/native-review-corpus/${name}`, import.meta.url), "utf8"),
  ]);
  for (const [, source, expected] of repairs) texts.push(["en_US", source], ["en_US", expected]);
  for (const fixtures of [capitalization, measurement, punctuation, words].flatMap((module) =>
    Object.values(module).filter((value): value is RuleFixtures => "en_US" in Object(value)),
  )) {
    for (const lang of MATRIX_LANGUAGES) {
      for (const [input] of fixtures[lang].pos) texts.push([lang, input]);
      for (const input of fixtures[lang].neg) texts.push([lang, input]);
    }
  }
  const collisions: string[] = [];
  for (const [lang, text] of texts) {
    const fixes = scan(text, lang).filter((d) => !d.warningOnly && d.alternatives.length > 0);
    fixes.forEach((a, i) => {
      for (const b of fixes.slice(i + 1)) {
        const [editsA, editsB] = [a, b].map((d) => d.alternatives[0].edits);
        if (editsA.some((x) => editsB.some((y) => collide(x, y))))
          collisions.push(`${lang} ${a.ruleId} x ${b.ruleId}: ${text}`);
      }
    });
  }
  expect(texts.length).toBeGreaterThan(500);
  expect(collisions).toEqual([]);
});

// Labelled acceptable prose: these examples must not produce default native findings.
const conservativeAcceptable = [
  ["informal", "Yeah, gonna grab food."],
  ["fragment", "Maybe tomorrow."],
  ["heading", "Release notes"],
  ["bullet", "- Small changes"],
  ["quotation", 'The example "their going" is intentional.'],
  ["dialect", "Our team have finished."],
  ["name", "Ask Priya today."],
  ["jargon", "Set rtpjitterbuffer latency=200."],
  ["style", "We have many tools in order to finish the work."],
  ["code", "Use `teh` in the example."],
  ["wrap", "We carry the text\nacross the page."],
];
test.each(conservativeAcceptable)("conservative native control: %s", (_label, text) => {
  expect(scan(text)).toEqual([]);
});

const conservativeRepairs = [
  ["spelling", "We saw teh cat.", "We saw the cat."],
  ["grammar", "We saw the the cat.", "We saw the cat."],
  ["grammar", "She go home now.", "She goes home now."],
  ["punctuation", "We saw the cat .", "We saw the cat."],
  ["typography", "the cat is here.", "The cat is here."],
];
test.each(conservativeRepairs)("conservative native repair: %s", (category, text, expected) => {
  const findings = scan(text);
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every((finding) => finding.category === category)).toBe(true);
  expect(
    applyEdits(
      text,
      findings.flatMap((finding) => finding.alternatives[0].edits),
    ),
  ).toBe(expected);
});
