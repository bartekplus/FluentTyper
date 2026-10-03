import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { ownedFrenchWords } from "./frenchTokens";
import { finding } from "../finding";

// Ordinal abbreviations (opt-in): typographic French writes "2e", "1re", "1er", "2d", not "2ème",
// "2eme", "2ième", "1ère" or "2nd".

const RULE = "frenchOrdinals";
const MESSAGE = "review_msg_fr_ordinal";

const ORDINAL =
  /(?<![\p{L}\p{N}_.,/-])(?<number>\d{1,4})(?<suffix>ièmes?|iemes?|èmes?|emes?|ères?|eres?|ières?|ieres?|ier|nds?|ndes?)(?![\p{L}\p{N}_])/giu;

function suffixFor(number: string, typed: string): string | null {
  const plural = /s$/i.test(typed) ? "s" : "";
  const suffix = typed.toLowerCase().replace(/s$/, "");
  if (/^(?:ère|ere|ière|iere)$/.test(suffix)) return number === "1" ? `re${plural}` : null;
  if (suffix === "ier") return number === "1" ? "er" : null;
  if (suffix === "nd" || suffix === "nde")
    return number === "2" ? `${suffix.slice(1)}${plural}` : null;
  // "1ème" is neither 1er nor 1re: left alone.
  return number === "1" ? null : `e${plural}`;
}

function ordinals(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, ORDINAL)) {
    const { number, suffix } = m.groups!;
    const fixed = suffixFor(number, suffix);
    if (!fixed || namedExampleBefore(ctx.text, m.index)) continue;
    const start = m.index + number.length;
    findings.push(
      finding(RULE, MESSAGE, start, start + suffix.length, [fixed], {
        context: { start: m.index, end: start + suffix.length },
      }),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: ordinals }];
