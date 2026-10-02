import type { DetectContext, RawFinding } from "../reviewDetectors";
import { nounTags, onlyNoun } from "./lexicon";
import { findingAt, isPl, owned, PREPOSITIONS, userOrNamed } from "./shared";

/*
 * Commas set by fixed words rather than by a clause parse: an indirect question after
 * "wiem", "sprawdź", "zastanawiam się" ("Nie wiem, co robić"), "ktoś, kto" and "to, czego",
 * "Im…, tym…", the second of a repeated "ani"/"albo"/"bądź", and a parenthetical opener
 * ("Co więcej, …"). And no comma after a linking adverb ("Jednak miałem rację"), inside
 * "w którym", or before a single "ani"/"lub" between two nouns.
 */

const MISSING = "polishMissingComma" as const;
const EXTRA = "polishMisplacedComma" as const;
/** Spaces between words, bounded so look-behinds stay linear on whitespace runs. */
const SP = "[ \\t\\u00a0]{1,8}";
const END = "(?![\\p{L}\\p{N}])";
/** A clause starts here; the look-back is bounded so whitespace runs stay linear. */
const CLAUSE_START = '(?<=(?:^|[.!?…:;]["”’»)]{0,3}[ \\t\\u00a0]{1,8}|\\n[ \\t\\u00a0]{0,8}))';

interface CommaFrame {
  ruleId: typeof MISSING | typeof EXTRA;
  messageKey: RawFinding["messageKey"];
  regex: RegExp;
  /** The replacement for the `target` group, or null to skip the match. */
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
}

/** Verbs and phrases that introduce an indirect question. */
const ASKING = [
  "wiem|wiesz|wie|wiemy|wiecie|wiedzą|wiedział\\p{L}*|wiedzieć|wiadomo",
  "sprawdź|sprawdźmy|sprawdzić|sprawdzam|sprawdza|sprawdzę|sprawdził\\p{L}*",
  "spytać|spytam|spytaj|spytał\\p{L}*|zapytać|zapytam|zapytaj|zapytał\\p{L}*|pytam|pyta|pytał\\p{L}*",
  "zobacz|zobaczmy|zobaczyć|zobaczę|zobaczymy",
  `zastanawiam${SP}się|zastanawia${SP}się|zastanawiał\\p{L}*${SP}się|wahał\\p{L}*${SP}się|waham${SP}się`,
  `ustalić|zdecydować|pamiętam|pamiętasz|rozumiem|wyobraź${SP}sobie|powiedz|pokaż`,
].join("|");
const QUESTION_WORD = "czy|co|jak|gdzie|kiedy|dlaczego|skąd|dokąd|ile|kto|którędy|czemu";
/**
 * "Nie wiadomo kiedy zrobiło się ciemno", "nie wiadomo skąd pojawił się kot": the idiom (before
 * one noticed, out of nowhere) before a verb of passing or appearing asks nothing.
 */
const UNNOTICED = `(?<=nie${SP}wiadomo)${SP}(?:kiedy|skąd|jak)${SP}(?:się${SP})?(?:zrobił|minął|minęł|upłynął|upłynęł|zleciał|przeleciał|przemknął|przemknęł|wyrósł|wyrosł|pojawił|zjawił|znalazł|zniknął|zniknęł|nastał|nadszedł|nadeszł|zapadł|przeminął|przeminęł|ściemnił|wyskoczył|wyrwał)\\p{L}*${END}`;

const SET_OFF =
  "(?:Co więcej|Innymi słowy|Jednym słowem|Krótko mówiąc|Szczerze mówiąc|Nawiasem mówiąc|Ogólnie mówiąc|Prawdę mówiąc|Po pierwsze|Po drugie|Po trzecie|Tak czy siak|Tak czy owak)";
const LINKING =
  "(?:Jednak|Jednakże|Poza tym|Ponadto|Natomiast|Dlatego|Dlatego też|Zatem|Toteż|Wobec tego)";
const RELATIVE = "który|która|które|którego|której|któremu|którą|którym|których|którymi|którzy";
const PRONOUN_HEAD = "ktoś|coś|ten|ta|ci|tego|tym|temu|wszystko|wszystkiego|każdy|nic|niczego";
const PRONOUN_RELATIVE = "kto|kogo|komu|kim|czego|czym|czemu|co|czyj\\p{L}*";

export const FRAMES: readonly CommaFrame[] = [
  // "Nie wiem co robić" -> "Nie wiem, co robić" (not "jak najszybciej", "co nieco").
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>(?:${ASKING}))(?=${SP}(?:${QUESTION_WORD})${SP}\\p{L})(?!${SP}(?:jak${SP}naj|co${SP}nieco|co${SP}do${END}|jak${SP}i${END}))(?!${UNNOTICED})`,
      "giud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "ktoś kto", "coś czego", "wszystko co" -> "ktoś, kto"; not a question ("Ten co?").
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>${PRONOUN_HEAD})(?=${SP}(?:${PRONOUN_RELATIVE})${SP}[^.!?\\n]*[.!…]?)(?!${SP}(?:${PRONOUN_RELATIVE})${SP}[^.!?\\n]*\\?)(?!${SP}co${SP}(?:do|nieco|niemiara|najmniej|najwyżej|prawda|innego|chwila|dzień|roku|rusz|raz)${END})(?!${SP}\\p{L}+${SP}\\p{L}+ć${END})`,
      "giud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Tam gdzie nie ma dróg" -> "Tam, gdzie".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}(?<target>Tam|Tu|Tutaj)(?=${SP}(?:gdzie|dokąd|skąd)${END})`,
      "gud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Im większa tym lepiej" -> "Im większa, tym lepiej".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}Im${SP}(?:[^,.!?;\\n ]+${SP}){0,4}?[^,.!?;\\n ]+(?<target>${SP}tym)${END}`,
      "gud",
    ),
    fix: (m) => `, ${m.groups!.target.trim()}`,
  },
  // "Ani prośby ani groźby" -> "Ani prośby, ani groźby".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(
      `(?<![\\p{L}])(?<first>ani|albo|bądź)${SP}(?!(?:co|jak)${SP}bądź)(?:[^,.!?;\\n ]+${SP}){0,1}?[^,.!?;\\n ]+(?<target>${SP}\\k<first>)${END}`,
      "giud",
    ),
    fix: (m) => `, ${m.groups!.target.trim()}`,
  },
  // "Co więcej nie ma sensu" -> "Co więcej, nie ma sensu".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(`${CLAUSE_START}(?<target>${SET_OFF})(?=${SP}\\p{L})`, "gud"),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Jednak, miałem rację" -> "Jednak miałem rację".
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `${CLAUSE_START}${LINKING}(?<target>,)(?=${SP}\\p{Ll}[^,;:\\n]*[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "Jest to więc, problem" -> no comma after a mid-sentence "więc"/"jednak"/"zatem".
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<=\\p{Ll}${SP})(?:więc|jednak|zatem)(?<target>,)(?=${SP}\\p{Ll}+(?:${SP}\\p{Ll}+)?[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "w którym, przygotowujemy" -> no comma right after the relative pronoun.
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<=(?<![\\p{L}])(?:${PREPOSITIONS})${SP}(?:${RELATIVE}))(?<target>,)(?=${SP}\\p{Ll}[^,;:\\n]*[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "gruszek, ani jabłek", "gruszek, lub jabłek": no comma before a single joining conjunction.
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<left>\\p{Ll}{3,})(?<target>,)${SP}(?<conj>ani|ni|lub|albo|bądź|oraz)${SP}(?<right>\\p{Ll}{3,})${END}`,
      "gud",
    ),
    fix: (m, ctx) => {
      const { left, conj, right } = m.groups!;
      const a = nounTags(left);
      const b = nounTags(right);
      // The same case, in either number ("czasu, ani pieniędzy").
      const fold = (tags: number) => (tags | (tags >> 7)) & 0x7f;
      if (!onlyNoun(a) || !onlyNoun(b) || !(fold(a) & fold(b))) return null;
      // A repeated conjunction ("ani X, ani Y") keeps its comma.
      const sentence = ctx.text
        .slice(Math.max(0, m.index - 120), m.index)
        .split(/[.!?;:\n]/u)
        .at(-1)!;
      return new RegExp(`(?<![\\p{L}])${conj}(?![\\p{L}])`, "iu").test(sentence) ? null : "";
    },
  },
];

function commaFrames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { ruleId, messageKey, regex, fix } of FRAMES) {
    if (ctx.rules && !ctx.rules.has(ruleId)) continue;
    for (const m of owned(ctx, regex)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const typed = ctx.source.slice(start, end);
      if (/\p{L}/u.test(typed) && userOrNamed(ctx, typed)) continue;
      const fixed = fix(m, ctx);
      if (fixed === null || fixed === typed) continue;
      findings.push(findingAt(ctx, start, end, [fixed], ruleId, messageKey));
    }
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [MISSING, EXTRA] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? commaFrames(ctx) : []),
  },
];
