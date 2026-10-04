import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveForm, adjectiveOf, finiteVerb, hasAdjective } from "./lexicon";
import { caseLike, findingAt, isPl, owned, S, userOrNamed } from "./shared";

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
const ADVERBS: Record<string, string> = {
  dobrze: "lepiej",
  źle: "gorzej",
  // Adverbs in -o whose comparative changes the stem ("brzydko" -> "brzydziej").
  ...Object.fromEntries(
    [
      "szybko szybciej",
      "brzydko brzydziej",
      "krótko krócej",
      "słodko słodziej",
      "nisko niżej",
      "blisko bliżej",
      "wysoko wyżej",
      "ciężko ciężej",
      "lekko lżej",
      "rzadko rzadziej",
      "głęboko głębiej",
      "daleko dalej",
      "długo dłużej",
      "często częściej",
      "cicho ciszej",
      "głośno głośniej",
      "mocno mocniej",
      "łatwo łatwiej",
      "trudno trudniej",
      "tanio taniej",
      "drogo drożej",
      "wesoło weselej",
    ].map((pair) => pair.split(" ") as [string, string]),
  ),
};
/** Adjectives that name an extreme and take no degree. */
const UNGRADED = /^(?:optymaln|maksymaln|minimaln)(?:y|a|e|ego|ej|emu|ą|ym|ych|ymi|ie)$/u;

/** The synthetic comparative of a positive adjective, when the lexicon lists one. */
function comparativeOf(lemma: string): string | null {
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
  /(?<![\p{L}])(?<marker>(?:naj)?bardziej|coraz[ \t ]+naj(?:bardziej|mniej))[ \t ]+(?<word>\p{L}{3,})(?![\p{L}])/giu;

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
      // "coraz najbardziej popularna" -> "coraz bardziej", "coraz najmniej" -> "coraz mniej".
      const fixed = marker.replace(/naj(?=bardziej|mniej)/iu, "");
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
    // "coraz bardziej popularna" and "mniej i bardziej poważnych" keep the analytic form.
    const longer = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (
      /(?:^|[^\p{L}])(?:coraz|(?:naj)?mniej[ \t\u00a0]+(?:i|lub|albo|czy))[ \t\u00a0]+$/iu.test(
        longer,
      )
    )
      continue;
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

const COMPARED = new RegExp(
  `(?<![\\p{L}])(?<word>\\p{L}{4,})${S}(?<target>jak)${S}(?<next>\\p{L}+)(?![\\p{L}])`,
  "giud",
);
/** Words after "jak" that make it "if" or "as" ("lepiej jak przyjdziesz", "jak najszybciej"). */
const CLAUSE_AFTER =
  /^(?:naj\p{L}*|i|ja|ty|on|ona|ono|my|wy|oni|one|się|to|tylko|zwykle|zawsze|wiadomo|wspomniałem|mówiłem|sądzę|myślę|widać|każdy|ktoś|coś|nikt|nic|gdyby|by|już)$/u;

/** "większy jak stary", "lepiej jak w domu" -> "niż": a comparison after a comparative. */
function comparedWithJak(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, COMPARED)) {
    const { word, target, next } = m.groups!;
    const lower = word.toLowerCase();
    const after = next.toLowerCase();
    if (lower.startsWith("naj") || !alreadyGraded(lower) || userOrNamed(ctx, word)) continue;
    // "później, jak wróci": "jak" after a time adverb opens a clause of time.
    if (lower === "później" || lower === "wcześniej") continue;
    // "nic więcej jak", "niczym więcej jak" (nothing but) is a set phrase.
    if (
      /(?:^|[^\p{L}])(?:nic|niczym|niczego)[ \t\u00a0]+$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      continue;
    if (CLAUSE_AFTER.test(after) || finiteVerb(after)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ...findingAt(
        ctx,
        start,
        end,
        [caseLike(target, "niż")],
        "englishPhraseCorrections",
        "review_msg_contextual_grammar",
      ),
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: ["englishPhraseCorrections"] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? comparedWithJak(ctx) : []),
  },
  {
    rules: [DOUBLED, STYLE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? degrees(ctx) : []),
  },
];
