import type { DetectContext, RawFinding } from "../reviewDetectors";
import { isGerman } from "./shared";

// Letter salutations: "Lieber Herr Müller", "Liebe Frau Weber", "Sehr geehrte Damen und
// Herren" take the title's gender ("Liebe Herr" → Lieber); after a greeting the adjective is
// lowercase ("Hallo liebe Katja").

const GREETING = "(?:Hallo|Hi|Hey|Moin|Servus|Guten[ \\t]{1,4}(?:Morgen|Tag|Abend))";
// At a line start, or after a greeting.
const TITLE =
  /(?<=(?:^|\n)[ \t]{0,8}(?:(?:Hallo|Hi|Hey|Moin|Servus|Guten[ \t]{1,4}(?:Morgen|Tag|Abend))[ \t]{1,4}|Sehr[ \t]{1,4})?)(?<adj>[Ll]ieb(?:e|en|er|es)?|geehrt(?:e|en|er|es)?)(?=[ \t]+(?<title>Herr|Frau|Damen)(?![\p{L}\p{M}]))/gu;
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

/** "Liebe Herr Müller" → Lieber; run by germanAdjectiveForms. */
export function salutationEndings(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, TITLE)) {
    const { adj, title } = m.groups!;
    const stem = adj.replace(/(?:e|en|er|es)$/, "");
    const wanted = stem + (title === "Herr" ? "er" : "e");
    if (wanted === adj) continue;
    // "Lieber Frau Müller als Herrn Schmidt": the adverb "rather".
    const line = /^[^\n,!:.?]*/.exec(ctx.text.slice(m.index, m.index + 120))![0];
    if (/(?<!\p{L})(?:als|wie)(?!\p{L})/u.test(line)) continue;
    findings.push({
      ruleId: "germanAdjectiveForms",
      messageKey: "review_msg_german_adjective_ending",
      range: { start: m.index, end: m.index + adj.length },
      alternatives: [wanted],
      context: { start: m.index, end: m.index + adj.length + title.length + 1 },
    });
  }
  return findings;
}

/** "Hallo Liebe Katja" → liebe; run by germanNounCasing. */
export function salutationCase(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, AFTER_GREETING)) {
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_idiom_case",
      range: { start: m.index, end: m.index + 1 },
      alternatives: ["l"],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}
