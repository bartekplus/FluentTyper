import type { MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import { ci } from "./shared";

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
const body = (parts: string[]) => parts.map((p, i) => `${i === 0 ? ci(p) : p}\\.?`).join(SEP);
// The longer forms first ("Dr. med. dent." before "Dr. med."), as in the frame of de.yaml.
const LONGEST_FIRST = [...ABBREVIATIONS].sort(
  (a, b) => b.length - a.length || b.join("").length - a.join("").length,
);
const FRAMES = LONGEST_FIRST.map((parts) => ({
  parts,
  whole: new RegExp(`^${body(parts)}$`, "u"),
}));

function abbreviationFinding(
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

/**
 * A multi-part abbreviation: the full form (germanAbbreviations), or only the spaces it misses
 * (germanAbbreviationSpacing).
 */
const abbreviation: MatchFixer = (m, ctx) => {
  const typed = m.groups!.target;
  const { parts } = FRAMES.find(({ whole }) => whole.test(typed))!;
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
  if (!firstDot && !letterFirst && !/^(?:zB|idR|eV|zT|uU)$/.test(joined)) return null;
  const canonical = parts.map((p, i) => `${i === 0 ? typed[0] + p.slice(1) : p}.`).join(NBSP);
  // Every dot and every space already there: the writer's spacing stays.
  if (dots === parts.length && typed.split(/[ \t ]/).length === parts.length) return null;
  if (ctx.dictionary.has(typed.toLowerCase())) return null;
  const [start, end] = m.indices!.groups!.target;
  // Every dot there, only the spaces missing ("z.B."): a common spelling, so the spaced
  // form is optional advice.
  const spacingOnly = dots === parts.length;
  return abbreviationFinding(
    start,
    end,
    canonical,
    spacingOnly ? "germanAbbreviationSpacing" : undefined,
  );
};

/** The named frame fixes of the de.abbreviations rule (grammar/rules/de.yaml). */
export const FIXERS = {
  abbreviation,
  abbreviationDot: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return abbreviationFinding(start, end, `${m.groups!.target}.`);
  },
  diploma: (m) => {
    const [start, end] = m.indices!.groups!.target;
    const replacement = `Dipl.-${m.groups!.subject}.`;
    return m.groups!.target !== replacement ? abbreviationFinding(start, end, replacement) : null;
  },
  titleOrder: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ...abbreviationFinding(start, end, `${m.groups!.address} ${m.groups!.title}`),
      messageKey: "review_msg_german_title_order",
    };
  },
  percentSpacing: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ...abbreviationFinding(start, end, `${m.groups!.n}${NBSP}%`, "germanAbbreviationSpacing"),
      messageKey: "review_msg_measurement_spacing",
    };
  },
  largeNumber: (m) => {
    const [start, end] = m.indices!.groups!.target;
    const typed = m.groups!.target;
    return abbreviationFinding(start, end, `${typed[0].toUpperCase()}${typed.slice(1)}.`);
  },
} satisfies Record<string, MatchFixer>;
