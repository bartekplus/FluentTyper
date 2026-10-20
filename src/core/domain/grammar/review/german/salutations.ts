import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { isGerman } from "./shared";
import { germanInfinitive } from "./germanLexicon";
import { tokensBefore } from "./shared";
import { finding } from "../finding";

// Letter salutations: "Lieber Herr Müller", "Liebe Frau Weber", "Sehr geehrte Damen und
// Herren" take the title's gender ("Liebe Herr" → Lieber); after a greeting the adjective is
// lowercase ("Hallo liebe Katja"). The scans are frames of grammar/rules/de.yaml.

// Words that may open an imperative clause before its verb.
const OPENERS = /^(?:bitte|so|und|oder|aber|dann|jetzt|nun|doch|also)$/i;

/** The named frame fixes of the salutation frames of grammar/rules/de.yaml. */
export const FIXERS = {
  /** "Liebe Herr Müller" → Lieber; run by germanAdjectiveForms. */
  salutationEnding: (m, ctx) => {
    const { adj, title } = m.groups!;
    const stem = adj.replace(/(?:e|en|er|es)$/, "");
    const wanted = stem + (title === "Herr" ? "er" : "e");
    if (wanted === adj) return null;
    // "Lieber Frau Müller als Herrn Schmidt": the adverb "rather".
    const line = /^[^\n,!:.?]*/.exec(ctx.text.slice(m.index, m.index + 120))![0];
    if (/(?<!\p{L})(?:als|wie)(?!\p{L})/u.test(line)) return null;
    return {
      ruleId: "germanAdjectiveForms",
      messageKey: "review_msg_german_adjective_ending",
      range: { start: m.index, end: m.index + adj.length },
      alternatives: [wanted],
      context: { start: m.index, end: m.index + adj.length + title.length + 1 },
    };
  },
  /**
   * The polite imperative: the verb opens its clause and the sentence ends in "!" or asks with
   * "bitte", so "sie" is the polite "Sie" ("Kommen sie schnell!", "…, oder fügen sie ihn hier
   * ein!"); "Kommen sie heute?" asks about "them". Run by germanNounCasing.
   */
  politeImperative: (m, ctx) => {
    const { verb } = m.groups!;
    if (!germanInfinitive(verb.toLowerCase())) return null;
    const start = m.index + m[0].length - 3;
    const rest = /^[^.!?\n]*([.!?\n]?)/.exec(ctx.text.slice(start))!;
    const end = rest[1];
    // "Führen sie bitte die Bestellung aus.": "bitte" makes it a request without the "!".
    const please =
      end !== "?" &&
      /(?<!\p{L})bitte(?!\p{L})/iu.test(ctx.text.slice(Math.max(0, m.index - 8), start) + rest[0]);
    if (end !== "!" && !please) return null;
    const before = tokensBefore(ctx.text, m.index, 2);
    const prior = before.at(-1) ?? "";
    const opens = (token: string | undefined) =>
      token === undefined || /^(?:[.!?:,;„“"»«]|\n)$/.test(token);
    if (!opens(before.at(-1)) && !(OPENERS.test(prior) && opens(before.at(-2)))) return null;
    return finding("germanNounCasing", "review_msg_german_polite_sie", start, start + 1, ["S"], {
      context: { start: m.index, end: start + 3 },
    });
  },
  /** "Hallo Liebe Katja" → liebe; run by germanNounCasing. */
  salutationCase: (m) =>
    finding("germanNounCasing", "review_msg_german_idiom_case", m.index, m.index + 1, ["l"], {
      context: { start: m.index, end: m.index + m[0].length },
    }),
  /** "Sehr geehrter Herr Müller" ending its line with no comma; run by germanCommas. */
  salutationComma: (m) => {
    const end = m.index + m[0].length;
    // "Liebe Grüße": a closing formula, its noun no name.
    const named = /^Liebe[r]?[ \t]+(\p{L}+)/u.exec(m[0])?.[1];
    if (named && /^(?:Grüße|Gruß|Grüßen|Wünsche|Wünschen)$/.test(named)) return null;
    const word = /\p{L}+\.?!?$/u.exec(m[0])![0];
    const start = end - word.length;
    return {
      ruleId: "germanCommas",
      messageKey: "review_msg_german_comma",
      range: { start, end },
      alternatives: [`${word.replace(/!$/, "")},`],
      context: { start: m.index, end },
    };
  },
} satisfies Record<string, MatchFixer>;

// TEMP until nounCasing moves
const GREETING = "(?:Hallo|Hi|Hey|Moin|Servus|Guten[ \\t]{1,4}(?:Morgen|Tag|Abend))";
const AFTER_GREETING = new RegExp(
  `(?<=(?:^|\\n)[ \\t]{0,8}${GREETING}[ \\t]{1,4})(?<adj>Lieb(?:e|er|es))(?=[ \\t]+\\p{Lu})`,
  "gu",
);

function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  // The lookbehinds read the text before lastIndex.
  regex.lastIndex = ctx.from;
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index >= ctx.from) yield m;
  }
}

// A verb in -en right before a lowercase "sie": "Kommen sie bitte herein!".
const VERB_SIE =
  /(?<![\p{L}\p{M}\p{N}_-])(?<verb>\p{L}+en)[ \t]+(?<sie>sie)(?![\p{L}\p{M}\p{N}_-])/gu;
/**
 * The polite imperative: the verb opens its clause and the sentence ends in "!" or asks with
 * "bitte", so "sie" is
 * the polite "Sie" ("Kommen sie schnell!", "…, oder fügen sie ihn hier ein!"); "Kommen sie
 * heute?" asks about "them". Run by germanNounCasing.
 */
export function politeImperativeOld(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, VERB_SIE)) {
    const { verb } = m.groups!;
    if (!germanInfinitive(verb.toLowerCase())) continue;
    const start = m.index + m[0].length - 3;
    const rest = /^[^.!?\n]*([.!?\n]?)/.exec(ctx.text.slice(start))!;
    const end = rest[1];
    // "Führen sie bitte die Bestellung aus.": "bitte" makes it a request without the "!".
    const please =
      end !== "?" &&
      /(?<!\p{L})bitte(?!\p{L})/iu.test(ctx.text.slice(Math.max(0, m.index - 8), start) + rest[0]);
    if (end !== "!" && !please) continue;
    const before = tokensBefore(ctx.text, m.index, 2);
    const prior = before.at(-1) ?? "";
    const opens = (token: string | undefined) =>
      token === undefined || /^(?:[.!?:,;„“"»«]|\n)$/.test(token);
    if (!opens(before.at(-1)) && !(OPENERS.test(prior) && opens(before.at(-2)))) continue;
    findings.push(
      finding("germanNounCasing", "review_msg_german_polite_sie", start, start + 1, ["S"], {
        context: { start: m.index, end: start + 3 },
      }),
    );
  }
  return findings;
}

/** "Hallo Liebe Katja" → liebe; run by germanNounCasing. */
export function salutationCaseOld(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, AFTER_GREETING)) {
    findings.push(
      finding("germanNounCasing", "review_msg_german_idiom_case", m.index, m.index + 1, ["l"], {
        context: { start: m.index, end: m.index + m[0].length },
      }),
    );
  }
  return findings;
}
