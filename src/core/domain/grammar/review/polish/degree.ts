import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveForm, adjectiveOf, hasAdjective } from "./lexicon";
import { caseLike, findingAt, isPl, owned, userOrNamed } from "./shared";

/*
 * Degrees of comparison. "bardziej" with a form that is already comparative ("bardziej
 * ważniejszy", "najbardziej bliżej") or cannot be graded ("bardziej optymalny") doubles the
 * degree. "bardziej ważny" where "ważniejszy" exists is a style choice (opt-in).
 */

const DOUBLED = "englishDoubledDegree" as const;
const STYLE = "stylePhrasing" as const;

/** Irregular comparatives the stem rules do not reach. */
const IRREGULAR: Record<string, string> = {
  dobry: "lepszy",
  zły: "gorszy",
  duży: "większy",
  mały: "mniejszy",
  wysoki: "wyższy",
  niski: "niższy",
  bliski: "bliższy",
  daleki: "dalszy",
  szeroki: "szerszy",
  głęboki: "głębszy",
  lekki: "lżejszy",
  ciężki: "cięższy",
  długi: "dłuższy",
};
/** Comparative adverbs not spelled from their adjective. */
const IRREGULAR_ADVERBS = new Set(
  "lepiej gorzej więcej mniej bliżej dalej wyżej niżej szybciej później wcześniej dłużej krócej".split(
    " ",
  ),
);
const ADVERBS: Record<string, string> = { dobrze: "lepiej", źle: "gorzej" };
/** Adjectives that name an extreme and take no degree. */
const UNGRADED = /^(?:optymaln|maksymaln|minimaln)(?:y|a|e|ego|ej|emu|ą|ym|ych|ymi|ie)$/u;

/** The synthetic comparative of a positive adjective, when the lexicon lists one. */
export function comparativeOf(lemma: string): string | null {
  if (lemma.endsWith("szy")) return null;
  const candidates = [
    IRREGULAR[lemma],
    lemma.replace(/ny$/, "niejszy"),
    lemma.replace(/ni$/, "ńszy"),
    lemma.replace(/(?:o|e)?k[iy]$/, "szy"),
    lemma.replace(/[iy]$/, "szy"),
  ];
  return candidates.find((c) => c && c !== lemma && hasAdjective(c)) ?? null;
}

/** "ważniejszy", "najważniejszy", "dokładniej", "najbliżej": already a degree. */
function alreadyGraded(word: string): boolean {
  const bare = word.startsWith("naj") ? word.slice(3) : word;
  if (IRREGULAR_ADVERBS.has(bare) || (/ej$/.test(bare) && hasAdjective(`${bare}szy`))) return true;
  const adj = adjectiveOf(bare);
  return !!adj && /szy$/.test(adj.lemma) && adj.lemma !== "pierwszy";
}

const MARKED =
  /(?<![\p{L}])(?<marker>(?:naj)?bardziej|coraz[ \t ]+najbardziej)[ \t ]+(?<word>\p{Ll}{3,})(?![\p{L}])/giu;

function degrees(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, MARKED)) {
    const { marker, word } = m.groups!;
    if (userOrNamed(ctx, word)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 8), m.index);
    // "tym bardziej lepiej" is "all the more"; "im bardziej" sets up a comparison.
    if (/(?:^|[^\p{L}])(?:tym|im)[ \t ]+$/iu.test(before)) continue;
    const lower = marker.toLowerCase();
    const start = m.index;
    const end = start + m[0].length;
    if (lower.startsWith("coraz")) {
      // "coraz najbardziej popularna" -> "coraz bardziej".
      const fixed = marker.replace(/naj(?=bardziej)/iu, "");
      findings.push(
        findingAt(ctx, start, start + marker.length, [fixed], DOUBLED, "review_msg_doubled_degree"),
      );
      continue;
    }
    if (ctx.rules?.has(DOUBLED) !== false && (alreadyGraded(word) || UNGRADED.test(word))) {
      if (/^(?:lepsz|gorsz|lepiej|gorzej|lepsi|gorsi)/u.test(word) && lower === "bardziej")
        continue;
      findings.push(
        findingAt(ctx, start, end, [caseLike(marker, word)], DOUBLED, "review_msg_doubled_degree"),
      );
      continue;
    }
    if (ctx.rules && !ctx.rules.has(STYLE)) continue;
    const naj = lower === "najbardziej" ? "naj" : "";
    const adverb = ADVERBS[word] ?? (word.endsWith("nie") ? word : null);
    let fixed: string | null = null;
    if (adverb && ADVERBS[word]) fixed = naj + ADVERBS[word];
    else if (adverb) {
      // "dokładnie" -> "dokładniej", from the comparative "dokładniejszy".
      const comparative = hasAdjective(`${word.slice(0, -2)}y`)
        ? comparativeOf(`${word.slice(0, -2)}y`)
        : null;
      if (comparative?.endsWith("iejszy")) fixed = naj + comparative.slice(0, -3);
    }
    if (!fixed) {
      const adj = adjectiveOf(word);
      const comparative = adj && comparativeOf(adj.lemma);
      if (adj && comparative) fixed = naj + adjectiveForm(comparative, adj.ending);
    }
    if (fixed)
      findings.push(
        findingAt(ctx, start, end, [caseLike(marker, fixed)], STYLE, "review_msg_style_phrasing"),
      );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [DOUBLED, STYLE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? degrees(ctx) : []),
  },
];
