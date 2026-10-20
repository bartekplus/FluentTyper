import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { likeTyped } from "./shared";

// Spellings the Duden recommends where two are allowed (opt-in): -graf-, -fon and Fantasie for
// -graph-, -phon and Phantasie ("Geografie", "Mikrofon"), adverbs joined from a preposition and
// a noun ("aufgrund", "instand"), and "zu Hause", "bekannt geben" written apart.

const REPLACE_PH: Array<[RegExp, string]> = [
  [/phantas/g, "fantas"],
  [/Phantas/g, "Fantas"],
  [/PHANTAS/g, "FANTAS"],
  [/PHOTO/g, "FOTO"],
  [/graph/g, "graf"],
  [/Graph/g, "Graf"],
  [/GRAPH/g, "GRAF"],
  [/phon/g, "fon"],
  [/elphin/g, "elfin"],
  [/^Photo/, "Foto"],
  [/^photo/, "foto"],
  [/(?<=\p{L})photo/gu, "foto"],
];

// The adverb and participle pairs the Duden joins ("vielsagend").
const PAIRS = new Set([
  "viel sagend",
  "hoch begabt",
  "schwer behindert",
  "allein erziehend",
  "hoch geschätzt",
  "wohl erzogen",
  "wohl temperiert",
]);
// The joined pairs the Duden writes apart ("tief betrübt").
const APART_SET = new Set([
  "tiefbetrübt",
  "tiefhängend",
  "hochkompliziert",
  "vielbeschäftigt",
  "nichtrostend",
  "freistehend",
  "rotlackiert",
  "neubekehrt",
]);

function finding(start: number, end: number, replacement: string): RawFinding {
  return {
    ruleId: "germanRecommendedSpelling",
    messageKey: "review_msg_german_recommended_spelling",
    range: { start, end },
    alternatives: [replacement],
    context: { start: Math.max(0, start - 30), end: end + 30 },
  };
}

/** The finding for the `name` group of `m`, unless it is already right or the writer's word. */
function push(ctx: DetectContext, m: RegExpExecArray, name: string, replacement: string) {
  const typed = m.groups![name];
  const [start, end] = m.indices!.groups![name];
  if (replacement === typed || ctx.dictionary.has(typed.toLowerCase())) return null;
  if (namedExampleBefore(ctx.text, start)) return null;
  return finding(start, end, replacement);
}

/** The named frame fixes of the de.recommended rule (grammar/rules/de.yaml). */
export const FIXERS = {
  phSpelling: (m, ctx) => {
    const typed = m.groups!.target;
    // "Graph", "Graphen": the mathematical graph and graphene.
    if (/^(?:graph|graphen|graphs|graphe)$/i.test(typed)) return null;
    // A name in quotes or after "Deutsche": "der „Telegraph“", "Deutsche Grammophon".
    const before = ctx.text.slice(Math.max(0, m.index - 10), m.index);
    if (/["„“”«»'‚‘]$|Deutsche[ \t]+$/.test(before)) return null;
    return push(
      ctx,
      m,
      "target",
      REPLACE_PH.reduce((word, [from, to]) => word.replace(from, to), typed),
    );
  },
  // "auf Grund" → "aufgrund": the two words joined, in lowercase.
  joinedAdverb: (m, ctx) => {
    const typed = m.groups!.target;
    return push(ctx, m, "target", likeTyped(typed, typed.replace(/[ \t ]/g, "").toLowerCase()));
  },
  todo: (m, ctx) => {
    const { plural, list, lists } = m.groups!;
    const many = !!lists || !!list?.endsWith("s") || (!list && !!plural);
    return push(
      ctx,
      m,
      "target",
      list ? `To-do-Liste${many ? "n" : ""}` : `To-do${many ? "s" : ""}`,
    );
  },
  together: (m, ctx) => {
    const { lead, rest, stem } = m.groups!;
    // "Er ist wohl erzogen worden": "wohl" may mean "probably", so only before a noun.
    if (/^[Ww]ohl$/.test(lead) && rest === stem) return null;
    return PAIRS.has(`${lead.toLowerCase()} ${stem}`) ? push(ctx, m, "target", lead + rest) : null;
  },
  rechtWeiteres: (m, ctx) =>
    m.groups!.t3
      ? push(ctx, m, "t3", `W${m.groups!.t3.slice(1)}`)
      : push(ctx, m, m.groups!.target ? "target" : "t2", "recht"),
  apartPairs: (m, ctx) => {
    const { lead, rest } = m.groups!;
    const stem = rest.replace(/(?:e|en|er|es|em)$/, "");
    return APART_SET.has(lead.toLowerCase() + stem)
      ? push(ctx, m, "target", `${lead} ${rest}`)
      : null;
  },
  apart: (m, ctx) => {
    if (m.groups!.target) return push(ctx, m, "target", "zu Hause");
    // "bekanntzugeben" → "bekannt zu geben".
    const verb = m.groups!.verb.replace(/^zu(?=\p{Ll}{3})/u, "zu ");
    return push(ctx, m, "t2", `${m.groups!.lead} ${verb}`);
  },
} satisfies Record<string, MatchFixer>;
