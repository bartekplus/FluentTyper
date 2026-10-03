import { frameMatches, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { isGerman } from "./shared";

// German multi-part abbreviations take a dot after each part and a (non-breaking) space
// between the parts: "z. B.", "d. h.", "i. d. R.", "Dr. med.", "Dipl.-Ing.". Typed with a
// part's dot or the space missing ("z.B.", "zB", "u.a", "Dr.med."), they get the full form.
// A form already spaced with a plain space is the writer's choice and stays.

const NBSP = " ";
// The parts of each abbreviation, as written.
const ABBREVIATIONS = [
  "z B",
  "d h",
  "u a",
  "o Ä",
  "u Ä",
  "o ä",
  "u ä",
  "i d R",
  "m E",
  "s o",
  "s u",
  "u v a",
  "u v m",
  "n Chr",
  "v Chr",
  "i A",
  "e V",
  "n V",
  "z T",
  "z Hd",
  "z Hdn",
  "a a O",
  "b a W",
  "p a",
  "c t",
  "s t",
  "Dr med",
  "Dr phil",
  "Dr jur",
  "Dr rer nat",
  "Dr rer pol",
  "Dr med dent",
  "Dr med vet",
  "Prof Dr",
].map((parts) => parts.split(" "));

const SEP = "[ \\t\\u00a0]?";

// The run-together forms ("z.B", "i.d.R", "Dr.med"): abbreviations, not dotted names.
const RUN_TOGETHER = new Set(ABBREVIATIONS.map((parts) => parts.join(".").toLowerCase()));
/** "z.B", "u.a", "Dr.med" (without the last dot): a German abbreviation typed without spaces. */
export const isGermanAbbreviationToken = (token: string) =>
  RUN_TOGETHER.has(token.toLowerCase().replace(/\.$/, ""));
const FRAMES = ABBREVIATIONS.map((parts) => ({
  parts,
  regex: new RegExp(
    `${WORD_START}(?<target>${parts.map((p, i) => `${i === 0 ? `[${p[0]}${p[0].toUpperCase()}]${p.slice(1)}` : p}\\.?`).join(SEP)})(?![\\p{L}\\p{N}])`,
    "gdu",
  ),
}));
// "Dipl.-Ing.", "Dipl.-Kfm.": a dot, a hyphen and a dot.
const DIPLOMA = new RegExp(
  `${WORD_START}(?<target>Dipl(?:\\.?-|\\.[ \\t]|[ \\t]?-[ \\t]?)(?<subject>\\p{Lu}\\p{Ll}{1,10})\\.?)${WORD_END}`,
  "gdu",
);
const LATIN = new RegExp(
  `${WORD_START}(?<target>et[ \\t]al|ad[ \\t]lib)(?![\\p{L}\\p{N}.])`,
  "gdu",
);
// "2 mio", "3 Mrd": the abbreviated numbers take a capital and a dot.
const LARGE_NUMBER = new RegExp(
  `(?<=\\p{N}[ \\t\\u00a0])(?<target>[mM](?:io|rd)|Mill|Bill)(?![\\p{L}\\p{N}.])`,
  "gdu",
);

function finding(
  start: number,
  end: number,
  replacement: string,
  ruleId: "germanAbbreviations" | "germanAbbreviationSpacing" = "germanAbbreviations",
): RawFinding {
  return {
    ruleId,
    messageKey: "review_msg_german_abbreviation",
    range: { start, end },
    alternatives: [replacement],
    context: { start, end },
  };
}

function abbreviations(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const { parts, regex } of FRAMES) {
    for (const m of frameMatches(ctx, regex)) {
      const typed = m.groups!.target;
      const dots = (typed.match(/\./g) ?? []).length;
      // A dot right after the first part ("z.B", "Dr.med."), or a known run-together form
      // ("zB", "idR", "eV."); "so." and "u a" are words.
      const joined = typed.replace(/[.\s]/g, "");
      const firstDot = typed.startsWith(`${typed.slice(0, parts[0].length)}.`);
      // "u a.", "n Chr", "o Ä.": a single letter first, spaced, with a later dot or a later
      // part no word could be ("Chr", "Hdn", "Ä").
      const letterFirst =
        parts[0].length === 1 &&
        /^\p{L}[ \t]/u.test(typed) &&
        (dots > 0 || parts.slice(1).some((p) => p.length > 1 || /\p{Lu}/u.test(p)));
      if (!firstDot && !letterFirst && !/^(?:zB|idR|eV|zT|uU)$/.test(joined)) continue;
      const canonical = parts.map((p, i) => `${i === 0 ? typed[0] + p.slice(1) : p}.`).join(NBSP);
      // Every dot and every space already there: the writer's spacing stays.
      if (dots === parts.length && typed.split(/[ \t ]/).length === parts.length) continue;
      if (ctx.dictionary.has(typed.toLowerCase())) continue;
      const [start, end] = m.indices!.groups!.target;
      // Every dot there, only the spaces missing ("z.B."): a common spelling, so the spaced
      // form is optional advice.
      const spacingOnly = dots === parts.length;
      findings.push(
        finding(start, end, canonical, spacingOnly ? "germanAbbreviationSpacing" : undefined),
      );
    }
  }
  // "Müller et al (2021)", "ad lib": the Latin abbreviation takes its dot.
  for (const m of frameMatches(ctx, LATIN)) {
    const [start, end] = m.indices!.groups!.target;
    findings.push(finding(start, end, `${m.groups!.target}.`));
  }
  for (const m of frameMatches(ctx, DIPLOMA)) {
    const [start, end] = m.indices!.groups!.target;
    const replacement = `Dipl.-${m.groups!.subject}.`;
    if (m.groups!.target !== replacement) findings.push(finding(start, end, replacement));
  }
  for (const m of frameMatches(ctx, LARGE_NUMBER)) {
    const [start, end] = m.indices!.groups!.target;
    const typed = m.groups!.target;
    findings.push(finding(start, end, `${typed[0].toUpperCase()}${typed.slice(1)}.`));
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanAbbreviations", "germanAbbreviationSpacing"], detect: abbreviations },
];
