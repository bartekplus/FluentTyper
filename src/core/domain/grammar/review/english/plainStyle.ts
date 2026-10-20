import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { type PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Detector } from "../../engine/reviewRules";
import { quotedMention } from "./grammarStyle1";
import { finding } from "../finding";
import { table } from "./tables";

// Plain and informal English, all optional except a few set phrases nobody means as typed:
// redundant pairs in every verb form ("combined together"), wordy officialese ("utilize",
// "for the purpose of"), slang reductions ("wanna", "gotta"), weak intensifiers ("extremely
// tired" -> "exhausted"), regional vocabulary under the dialect rules, and formal negative
// questions ("Why do not you" -> "Why don't you").

/** Optional tables with their own rules, indexed with the phrase corrections. */
export const OPTIONAL: readonly {
  rows: readonly PhraseRow[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}[] = [
  {
    rows: table("plainStyle.wordChoice"),
    ruleId: "styleWordChoice",
    messageKey: "review_msg_word_choice",
  },
  {
    rows: table("plainStyle.british"),
    ruleId: "englishBritishSpelling",
    messageKey: "review_msg_british_spelling",
  },
  {
    rows: table("plainStyle.american"),
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

export const PREDICATES = {
  plainStyle: english(
    negativeQuestions,
    whomAfterPrepositions,
    adverbPositions,
    adjectiveInDimension,
    doubledAmounts,
    returnBack,
  ),
} satisfies Record<string, Detector>;
