import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { type PhraseRow } from "../englishPhraseTables";
import type { RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
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

const CONTRACTED: Record<string, string> = {
  am: "aren't",
  can: "can't",
  will: "won't",
};
const QUESTION_LEADS = new Set("why how what where when who".split(" "));

const PARTITIVES = new Set(
  "many some all most none each both few several one two three neither either".split(" "),
);

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

const adverbPosition = (start: number, end: number, replacement: string): Finding =>
  finding("stylePhrasing", "review_msg_adverb_position", start, end, [replacement]);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  plainNegativeQuestion: (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    const lead = /([A-Za-z]+)[ \t ]+$/.exec(before)?.[1].toLowerCase();
    const start = /(?:^|[.!?\n"“(])[ \t ]*$/.test(before);
    if (!start && !(lead && QUESTION_LEADS.has(lead))) return null;
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const aux = m.groups!.aux;
    const lower = aux.toLowerCase();
    let contracted = CONTRACTED[lower] ?? `${lower}n't`;
    if (/^[A-Z]/.test(aux)) contracted = contracted[0].toUpperCase() + contracted.slice(1);
    const end = m.index + aux.length + m[0].slice(aux.length).search(/not/) + 3;
    return finding("stylePhrasing", "review_msg_style_phrasing", m.index, end, [contracted]);
  },
  plainWhom: (m, ctx) => {
    const { prep, who, rest } = m.groups!;
    if (!rest) return null;
    const before = /([A-Za-z]+)[ \t ]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 16), m.index),
    )?.[1];
    const partitive = prep === "of" && !!before && PARTITIVES.has(before.toLowerCase());
    const objectFollows = /^\s+(?:I|you|he|she|it|we|they)$/.test(rest);
    // "of who were" needs a partitive before it; elsewhere a subject must follow.
    if (!(partitive || (objectFollows && prep !== "of"))) return null;
    // "for who I am": "who" completes "be" and stays.
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (
      objectFollows &&
      /^[ \t\u00a0]*(?:am|are|is|was|were|be|['’](?:m|re|s))(?![\p{L}])/u.test(after)
    )
      return null;
    const [start, end] = m.indices!.groups!.who;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [
      who === "whoever" ? "whomever" : "whom",
    ]);
  },
  plainAdverbAfterAux: (m) => {
    const { subject, adv, aux } = m.groups!;
    // A noun subject only when it is a plain lowercase plural ("appearances often are").
    if (!/^(?:I|you|he|she|it|we|they)$/i.test(subject) && !englishWordInfo(subject)?.plural)
      return null;
    const [start] = m.indices!.groups!.adv;
    const [, end] = m.indices!.groups!.aux;
    return adverbPosition(start, end, `${aux} ${adv}`);
  },
  plainAdverbBeforeVerb: (m) => {
    const { verb, adv } = m.groups!;
    const read = englishWordInfo(verb);
    // A main verb in the present or past, not a form of "be" or an auxiliary.
    if (!read?.verbs.some((v) => v.form === "base" || v.form === "past" || v.form === "third"))
      return null;
    if (/^(?:am|is|are|was|were|be|been|have|has|had|do|does|did)$/i.test(verb)) return null;
    const [start] = m.indices!.groups!.verb;
    const [, end] = m.indices!.groups!.adv;
    return adverbPosition(start, end, `${adv} ${verb}`);
  },
  plainInDimension: (m) => {
    const { adj, dim } = m.groups!;
    if (!DIMENSIONS[dim.toLowerCase()]?.test(adj)) return null;
    const [start, end] = m.indices!.groups!.target;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
      context: { start: m.index, end },
    });
  },
  plainDoubledAmount: (m) => {
    const [start, end] = m.indices!.groups!.dollars ?? m.indices!.groups!.plus;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
      context: { start: m.index, end },
    });
  },
  plainReturnBack: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return finding("stylePhrasing", "review_msg_style_phrasing", start, end, [""], {
      context: { start: m.index, end: m.index + m[0].length },
    });
  },
} satisfies Record<string, MatchFixer>;
