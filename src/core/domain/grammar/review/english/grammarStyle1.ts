import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { englishNounForms, hasCountPrefix } from "../../implementations/helpers/EnglishNounNumber";
import { SPECIALIST } from "../englishCountability";
import { doubledDegree } from "../englishDegree";
import { each, type PhraseRow } from "../englishPhraseTables";
import {
  around,
  caseLike,
  EDGE,
  frame,
  frameMatches,
  found,
  hasUserOrCasedWord,
  nextLowerWord,
  SPACE,
  WORD_END,
  WORD_START,
} from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// ---------------------------------------------------------------------------- tables

const CLICK_ENDINGS = ["", "s", "ed", "ing"];

/** Rows for englishPhraseCorrections. */
export const PHRASES: readonly PhraseRow[] = [
  ["less worse", "less bad"],
  [["least worse", "less worst"], "least bad"],
  ["wear and tears", "wear and tear"],
  ["gooder", "better"],
  ["farer", ["farther", "further"]],
  ["eg.", "e.g."],
  // Misspellings with no other reading.
  ["stoped", "stopped"],
  ["politicans", "politicians"],
  ["easir", "easier"],
  ["breakfest", "breakfast"],
  ["buget", "budget"],
  ["misstake", "mistake"],
  ["misstakes", "mistakes"],
  ["theem", "them"],
  ["worthchecking", "worth checking"],
];

export const COMPOUNDS: readonly PhraseRow[] = [
  ...["right", "left", "middle", "double"].flatMap((side) =>
    each(CLICK_ENDINGS, `${side} click~`, `${side}-click~`),
  ),
  ...each(["", "s", "ed", "ing"], "miss spell~", "misspell~"),
  ...each(["", "s", "ed", "ing"], "miss-spell~", "misspell~"),
  [["miss spelt", "miss-spelt"], "misspelt"],
  ["afew", "a few"],
  ...["two", "three", "four", "five", "ten", "hundred", "thousand"].map((count): PhraseRow => [
    `${count} fold`,
    `${count}fold`,
  ]),
  ...["somewhat", "relatively"].map((before): PhraseRow => [
    `${before} straight forward`,
    `${before} straightforward`,
  ]),
  ...["a big", "a major", "big", "major", "a real", "a huge"].map((before): PhraseRow => [
    `${before} break through`,
    `${before} breakthrough`,
  ]),
  [["pre-built", "pre built"], "prebuilt"],
  ["super users", "superusers"],
  ["super user", "superuser"],
  ["de extinction", "de-extinction"],
];

export const STYLE: readonly PhraseRow[] = [
  [
    ["almost nearly", "nearly almost"],
    ["almost", "nearly"],
  ],
  ["as well too", "as well"],
  ["too as well", "as well"],
  ["too also", "also"],
  // Contradictory pairings.
  ["amateur expert", ["amateur", "expert"]],
  ["advancing backwards", ["retreating", "moving backwards"]],
  ["alludes explicitly", "refers explicitly"],
  ["explicitly alludes", "explicitly refers"],
  // "first" adds nothing to a verb of origin.
  ...["coined", "invented", "discovered", "introduced", "released", "originated", "founded"].map(
    (verb): PhraseRow => [`first ${verb}`, verb],
  ),
  // Regional words with a US equivalent.
  ["aubergine", "eggplant"],
  ["aubergines", "eggplants"],
  ["brinjal", "eggplant"],
  ["coriander", "cilantro"],
  ["bag of crisps", "bag of chips"],
  ["footpath", "sidewalk"],
  ["spanner", "wrench"],
  ["light globe", "light bulb"],
  ["windscreen", "windshield"],
  ["blood nose", "nosebleed"],
  ["updation", "update"],
  ["nought", "zero"],
  ["godown", "warehouse"],
  [["lakh", "lakhs"], "hundred thousand"],
  [["crore", "crores"], "ten million"],
];

// ---------------------------------------------------------------------------- helpers

/** The chunk's text names a word at all: rare-word detectors skip chunks without it. */
// `word` is a global, literal-led regex: the engine scans for it quickly.
export const mentions = (ctx: DetectContext, word: RegExp) => {
  word.lastIndex = Math.max(0, ctx.from - 256);
  const m = word.exec(ctx.scanText);
  return !!m && m.index < ctx.to + 64;
};
/** A detector run only on chunks that contain its rare literal. */
export const gated =
  (gate: RegExp, detect: (ctx: DetectContext) => RawFinding[]) =>
  (ctx: DetectContext): RawFinding[] =>
    mentions(ctx, gate) ? detect(ctx) : [];
/** frameMatches, skipped outright on chunks without the pattern's rare literal. */
export function* gatedMatches(
  ctx: DetectContext,
  gate: RegExp,
  pattern: string | RegExp,
  owner?: Parameters<typeof frameMatches>[2],
): Generator<RegExpExecArray> {
  if (mentions(ctx, gate)) yield* frameMatches(ctx, pattern, owner);
}

const atClauseStart = (ctx: DetectContext, index: number) => {
  const before = ctx.text.slice(Math.max(0, index - 96), index);
  return (
    (index <= 96 && /^[ \t\u00a0]*$/.test(before)) ||
    /(?:[.!?;:"“]|\n[ \t\u00a0]*\n)[ \t\u00a0\n]*$/.test(before)
  );
};

/** The base of a past or participle form that is not itself a base ("went", "needed"). */
function pastLemma(word: string): string | null {
  const w = word.toLowerCase();
  const irregular = englishVerbForms(w);
  if (irregular)
    return w !== irregular.lemma && (w === irregular.past || w === irregular.participle)
      ? irregular.lemma
      : null;
  if (!w.endsWith("ed")) return null;
  const info = englishWordInfo(w);
  if (!info || info.noun || info.verbs.some((v) => v.form === "base")) return null;
  return englishLemma(w, "past");
}

const isParticiple = (word: string) => {
  const w = word.toLowerCase();
  const irregular = englishVerbForms(w);
  return irregular ? w === irregular.participle && w !== irregular.lemma : !!pastLemma(w);
};

// ---------------------------------------------------------------------------- degree

const IRREGULAR_DEGREE = new Set(["better", "best", "worse", "worst", "farther", "farthest"]);

/** A comparative or superlative adjective ("faster", "easiest", "bigger", "best"). */
function graded(word: string): boolean {
  if (IRREGULAR_DEGREE.has(word)) return true;
  const suffix = /est$/.test(word) ? 3 : /er$/.test(word) ? 2 : 0;
  if (!suffix || word.length < suffix + 2) return false;
  const info = englishWordInfo(word);
  if (!info || info.noun || info.verbs.length) return false;
  const stem = word.slice(0, -suffix);
  const stems = [stem, `${stem}e`, stem.replace(/i$/, "y"), stem.replace(/(.)\1$/, "$1")];
  return stems.some((s) => englishWordInfo(s)?.adjective);
}

/** Known to the dictionary as neither a noun nor a verb ("bigger", "cuter"). */
function plainWord(word: string): boolean {
  const info = englishWordInfo(word);
  return !!info && !info.noun && !info.verbs.length;
}

/** The one-word comparative of a base adjective, when the dictionary has one. */
function comparative(word: string): string[] {
  if (word === "bad") return ["worse"];
  if (word === "far") return ["farther", "further"];
  // Short adjectives only: "more robust", "more often" are standard.
  const syllables =
    (word.replace(/e$/, "").match(/[aeiouy]+/g)?.length ?? 0) + (/[^aeiou]le$/.test(word) ? 1 : 0);
  if (syllables > (word.endsWith("y") ? 2 : 1) || !englishWordInfo(word)?.adjective) return [];
  return [
    `${word}er`,
    `${word}r`,
    word.replace(/y$/, "ier"),
    word.replace(/([^aeiou][aeiou])([bdgmnpt])$/, "$1$2$2er"),
  ]
    .filter((form, i, all) => form !== word && all.indexOf(form) === i && plainWord(form))
    .slice(0, 1);
}

/**
 * The comparison ends where the clause shows it: a mark, "than" + a word, "to" + a verb, a
 * verb, or one singular noun. "more older workers" counts workers; unknown words abstain.
 */
function finishedComparison(ctx: DetectContext, start: number, end: number): boolean {
  const tail = ctx.text.slice(end, end + 48);
  if (/^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(tail) && tail.length < 48) return true;
  // "a most best quality file": one thing, so "most" cannot count.
  if (/\ban?[ \t\u00a0]+$/i.test(ctx.text.slice(Math.max(0, start - 8), start))) return true;
  const [, next, after] = /^[ \t\u00a0]+([A-Za-z]+)(?:[ \t\u00a0]+([A-Za-z]+))?/.exec(tail) ?? [];
  if (!next || next !== next.toLowerCase()) return false;
  if (next === "than") return !!after;
  // "most better for me": a preposition closes the phrase too.
  if (/^(?:for|with|in|on|at|by|from|about)$/.test(next)) return true;
  if (next === "to") return hasVerbForm(after ?? "", "base");
  if (/^(?:is|are|was|were)$/.test(next)) return true;
  if (FUNCTION_WORDS.test(next)) return false;
  const info = englishWordInfo(next);
  return !!info?.noun && !info.plural;
}

const DOUBLED = `(?<target>(?<marker>more|most)${SPACE}(?<adj>[A-Za-z]+))${WORD_END}`;
const MORE_BASE = `(?<target>more${SPACE}(?<adj>[A-Za-z]+))(?=${SPACE}than${WORD_END}|[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;

function degree(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // The core frames own their matches; this one adds the rest.
  const core = new Set(doubledDegree(ctx).map((f) => f.range.start));
  for (const m of frameMatches(ctx, DOUBLED)) {
    if (core.has(m.indices!.groups!.target[0])) continue;
    const { marker, adj: typed } = m.groups!;
    const adj = typed.toLowerCase();
    // Capitals other than a sentence's first letter are a name or emphasis.
    const markerCase =
      marker === marker.toLowerCase() ||
      (marker === caseLike("A", marker.toLowerCase()) && atClauseStart(ctx, m.index));
    if (typed !== adj || !markerCase || hasUserOrCasedWord(ctx, m[0])) continue;
    // "honest" is a base adjective ("honestly"), not hon + -est.
    if (!graded(adj) || englishWordInfo(`${adj}ly`)) continue;
    const [start, end] = m.indices!.groups!.target;
    if (!finishedComparison(ctx, start, end)) continue;
    findings.push(
      found(ctx, m, "englishDoubledDegree", "review_msg_doubled_degree", [
        caseLike(m.groups!.marker, m.groups!.adj),
      ]),
    );
  }
  if (ctx.rules && !ctx.rules.has("stylePhrasing")) return findings;
  for (const m of frameMatches(ctx, MORE_BASE)) {
    const adj = m.groups!.adj.toLowerCase();
    const forms = comparative(adj);
    if (!forms.length || hasUserOrCasedWord(ctx, m[0])) continue;
    // "more human than machine", "more subtle than direct" weigh two descriptions.
    const than = /^[ \t\u00a0]+than[ \t\u00a0]+([A-Za-z]+)/i.exec(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 40),
    );
    const compared = than ? englishWordInfo(than[1]) : null;
    if (compared && (compared.noun || compared.adjective)) continue;
    findings.push(
      found(
        ctx,
        m,
        "stylePhrasing",
        "review_msg_style_phrasing",
        forms.map((form) => caseLike(m[0], form)),
      ),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------- verb forms

const DID = `did(?<negated>n['’]?t|${SPACE}not)?(?:${SPACE}(?:I|you|he|she|it|we|they))?(?:${SPACE}(?:really|just|ever|even|actually|also))?${SPACE}(?<target>[A-Za-z]+)${WORD_END}`;
// "who helped made this possible"; "helped given that", "who helped got" stay.
const HELPED = `helped${SPACE}(?<target>[A-Za-z]+)${SPACE}(?:this|that|it|them|us|me|him|her|the|a|an|my|our|your|their|his|its)${WORD_END}`;
// "What I did changed everything": did ends a noun clause.
const NOUN_CLAUSE =
  /\b(?:what|whatever|everything|anything|something|nothing|all|thing|things)\b(?:[ \t\u00a0]+[\p{L}'’]+){0,3}[ \t\u00a0]+$/iu;

/** "did went", "didn't saw", "helped made": do-support and help take a base verb. */
function doSupport(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const [pattern, isDid] of [
    [DID, true],
    [HELPED, false],
  ] as const) {
    // Owned by "did"/"helped": the auxiliary is the evidence, so a scope without it abstains.
    for (const m of frameMatches(ctx, pattern, (match) => match.index)) {
      const verb = m.groups!.target;
      const lemma = pastLemma(verb);
      if (!lemma || verb !== verb.toLowerCase() || hasUserOrCasedWord(ctx, verb)) continue;
      // "should've helped given that…": "given" works as a preposition.
      if (!isDid && (/^(?:do|have|be)$/.test(lemma) || verb.toLowerCase() === "given")) continue;
      if (isDid && NOUN_CLAUSE.test(ctx.text.slice(Math.max(0, m.index - 48), m.index))) continue;
      if (isDid && /^(?:supposed|used)$/.test(verb.toLowerCase())) continue;
      // Affirmative "did" is also the main verb ("They did needed repairs", "The new server
      // did logged it"): it needs a pronoun subject, or "Did" opening the clause, and an object.
      const after = nextLowerWord(ctx, m.index + m[0].length);
      // "I did wanted catch it": a bare verb after the participle is no object either.
      const verbNext = !!after && !FUNCTION_WORDS.test(after) && hasVerbForm(after, "base");
      if (isDid && !m.groups!.negated) {
        const subject = /([A-Za-z]+)[ \t\u00a0]+$/.exec(
          ctx.text.slice(Math.max(0, m.index - 24), m.index),
        )?.[1];
        const opens = atClauseStart(ctx, m.index) && /^Did$/.test(m[0].slice(0, 3));
        if (!opens && !/^(?:I|you|he|she|it|we|they|this|that|i)$/.test(subject ?? "")) continue;
        if (
          !opens &&
          !/^[ \t\u00a0]+(?:it|them|him|her|us|me|this|that|the|a|an|my|your|his|its|our|their|to)\b/i.test(
            ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 12),
          ) &&
          !verbNext
        )
          continue;
      }
      if (isDid && englishWordInfo(verb)?.adjective && englishWordInfo(after)?.noun && !verbNext)
        continue;
      findings.push(
        found(ctx, m, "englishAuxiliaryBaseVerb", "review_msg_auxiliary_base", [lemma]),
      );
    }
  }
  return findings;
}

// "may of" before a participle; the core rule covers could/would/should/must/might.
const MAY_OF = `may${SPACE}(?<target>of)${SPACE}(?<verb>[a-z]+)${WORD_END}`;

/** "I may of made a mistake": "of" heard for 've. */
function modalOf(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, MAY_OF)]
    .filter((m) => isParticiple(m.groups!.verb))
    .map((m) =>
      found(ctx, m, "englishModalOfCorrection", "review_msg_modal_of", [
        caseLike(m.groups!.target, "have"),
      ]),
    );
}

// Irregular plurals that englishNounForms does not have. Regularized forms ("childs",
// "eated") are left to Review's dictionary spelling check, which already offers the
// irregular form first.
const IRREGULAR_PLURALS: Record<string, string> = {
  foot: "feet",
  elf: "elves",
  hero: "heroes",
  echo: "echoes",
  veto: "vetoes",
  torpedo: "torpedoes",
};
// ---------------------------------------------------------------------------- agreement

const BE = "(?:is|are|was|were|am|be)";
// A contracted be ("We're are") follows its word, so the frame starts at the apostrophe.
const DOUBLE_BE = new RegExp(
  `(?:${WORD_START}${BE}|(?<=\\p{L})['’](?:s|re|m))(?<target>${SPACE}(?<second>${BE}))${WORD_END}`,
  "gidu",
);

/** "This is are", "I'm am": two forms of be left from an edit; the second goes. */
function doubleBe(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, DOUBLE_BE)) {
    const first = m[0].slice(0, m.indices!.groups!.target[0] - m.index);
    const second = m.groups!.second;
    // Identical pairs are repeated words; "the question is are we" asks a question.
    if (first.replace(/^['’]/, "").toLowerCase() === second.toLowerCase()) continue;
    if (/^(?:I|you|we|they|he|she|it|there)$/i.test(nextLowerWord(ctx, m.index + m[0].length)))
      continue;
    // "Let's be", and "Mateo's are": after a name, "'s" is a possessive standing for its noun.
    if (/^['’]/.test(first) && second.toLowerCase() === "be") continue;
    if (
      /^['’]s$/.test(first) &&
      /\p{Lu}\p{L}*$/u.test(ctx.text.slice(Math.max(0, m.index - 24), m.index))
    )
      continue;
    findings.push(found(ctx, m, "englishSentenceStructure", "review_msg_sentence_structure", [""]));
  }
  return findings;
}

const THE_SOME = `(?<target>the${SPACE}some)${WORD_END}`;

/** "the some candidates" is "some candidates"; "the some approach" was "the same approach". */
function theSome(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, THE_SOME)) {
    const [the, some] = m.groups!.target.split(/[ \t\u00a0]+/);
    const next = nextLowerWord(ctx, m.index + m[0].length);
    const info = next ? englishWordInfo(next) : null;
    const some2 = caseLike(the, some.toLowerCase());
    const same = `${the}${m.groups!.target.slice(the.length, -some.length)}${caseLike(some, "same")}`;
    // The lexicon leaves long plain nouns out ("layout"), so an unknown word counts as one.
    const singular =
      (info ? info.noun && !info.plural : next.length > 5 && !next.endsWith("s")) &&
      !/^[ \t\u00a0]*\S+['’]s\b/.test(ctx.text.slice(m.index + m[0].length));
    findings.push(
      found(
        ctx,
        m,
        "englishSentenceStructure",
        "review_msg_sentence_structure",
        singular ? [same, some2] : [some2, same],
      ),
    );
  }
  return findings;
}

const PLURAL_COUNT = `(?:these|those|several|many|both|few|multiple|various|numerous|two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9][0-9]+)`;
const MODIFIER = `(?:(?!(?:of|the|a|an|this|that|which|and|or|to)${WORD_END})\\(?[A-Za-z][A-Za-z-]*\\)?)`;
// An ellipsis may open the phrase ("...one criteria"), so these start at any non-word character.
const LOOSE_START = "(?<![\\p{L}\\p{N}_'’@/#\\\\-])";
// Noun first, then the count before it: "three other (practical) criterion", "one criteria".
const GREEK = new RegExp(
  `${LOOSE_START}(?:criterion|phenomenon|criteria|phenomena)${WORD_END}`,
  "gidu",
);
const PLURAL_BEFORE = new RegExp(
  `${LOOSE_START}${PLURAL_COUNT}(?:${SPACE}${MODIFIER}){0,3}${SPACE}$`,
  "iu",
);
const SINGLE_BEFORE = new RegExp(
  `${LOOSE_START}(?:one|this|each|every|single|(?<that>that))${SPACE}$`,
  "iu",
);

/** Greek plurals: "three criterion" and "one criteria" swap number. */
function greekPlurals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, GREEK, (match) => match.index)) {
    const noun = m[0];
    const plural = noun.endsWith("on");
    const window = ctx.text.slice(Math.max(0, m.index - 80), m.index);
    const count = (plural ? PLURAL_BEFORE : SINGLE_BEFORE).exec(window);
    if (!count || noun !== noun.toLowerCase() || hasUserOrCasedWord(ctx, count[0] + noun)) continue;
    const end = m.index + noun.length;
    // "that" is also a conjunction: only "that phenomena." closing its clause.
    if (count.groups?.that && !/^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(ctx.text.slice(end, end + 9)))
      continue;
    const before = ctx.text.slice(
      Math.max(0, m.index - 96 - count[0].length),
      m.index - count[0].length,
    );
    // "twenty one phenomena", "one or two criterion", "section one criteria".
    if (/\bof[ \t\u00a0]+$/i.test(before) || hasCountPrefix(before)) continue;
    // A bare "many criterion" is left to the core count rule.
    if (/^many[ \t\u00a0]+$/i.test(count[0])) continue;
    const corrected = noun.replace(/(?:on|a)$/, plural ? "a" : "on");
    findings.push({
      ruleId: "englishCountability",
      messageKey: "review_msg_countable_number",
      range: { start: m.index, end },
      alternatives: [corrected],
      context: around(ctx, m),
    });
  }
  return findings;
}

const THINGS_IS = `(?<target>(?<head>some|any|every|no)(?<things>things))(?=${SPACE}(?:(?:really|just|still|always|not)${SPACE})?[A-Za-z]+ing${WORD_END})`;

/** "Somethings going well": the contraction of "something is" lost its apostrophe. */
function thingsIs(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, THINGS_IS)) {
    const typed = m.groups!.target;
    const word = typed.slice(0, -1);
    const s = typed.slice(-1);
    const mark = ctx.text.slice(Math.max(0, m.index - 200), m.index + 200).includes("’")
      ? "’"
      : "'";
    findings.push(
      found(ctx, m, "englishContractionNormalization", "review_msg_contraction", [
        `${word}${mark}${s}`,
        `${word} ${s === "S" ? "IS" : "is"}`,
      ]),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------- countability

/** Uncountable nouns, the count word that measures them, and countable synonyms. */
const MASS: Record<string, { unit: string; count?: readonly [string, string][] }> = {
  advice: {
    unit: "piece of",
    count: [
      ["tip", "tips"],
      ["suggestion", "suggestions"],
    ],
  },
  information: { unit: "piece of" },
  info: { unit: "piece of" },
  furniture: { unit: "piece of" },
  luggage: {
    unit: "piece of",
    count: [
      ["suitcase", "suitcases"],
      ["bag", "bags"],
    ],
  },
  baggage: { unit: "piece of", count: [["bag", "bags"]] },
  equipment: { unit: "piece of" },
  evidence: { unit: "piece of" },
  feedback: { unit: "piece of" },
  software: {
    unit: "piece of",
    count: [
      ["application", "applications"],
      ["software package", "software packages"],
    ],
  },
  firmware: { unit: "piece of" },
  hardware: { unit: "piece of" },
  malware: { unit: "piece of" },
  ransomware: { unit: "piece of" },
  clothing: { unit: "item of", count: [["garment", "garments"]] },
  punctuation: { unit: "punctuation mark", count: [["punctuation mark", "punctuation marks"]] },
};
const MASS_WORDS = Object.keys(MASS).join("|");
const MASS_GATE = new RegExp(`${MASS_WORDS}|horsepower`, "gi");
const SINGLE = "(?<single>an?|one|another|each|every|single)";
const SEVERAL = `(?<several>(?<how>how${SPACE}|so${SPACE}|too${SPACE})?many|(?<afew>a${SPACE})?few|fewer|several|multiple|both|numerous|two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9][0-9]+)`;
// Noun first, then its count word: the nouns are rare, so most text is skipped quickly.
const MASS_NOUN = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/#\\\\.-])(?:${MASS_WORDS})(?![\\p{L}\\p{N}_'’@/#\\\\-])`,
  "giu",
);
const COUNTED_BEFORE = new RegExp(`(?<![\\p{L}\\p{N}_'’-])(?:${SINGLE}|${SEVERAL})${SPACE}$`, "iu");
// Plurals no context makes countable. "advices", "informations" and "equipments" have legal and
// trade senses and quantified uses the core rule decides; here only after "kind of" or a
// judging adjective with no count before it ("You gave me bad advices").
const MASS_PLURAL = `(?<target>(?<noun>softwares|furnitures|luggages|clothings|firmwares|hardwares|horsepowers))${WORD_END}`;
const JUDGED_PLURAL = `(?<target>(?<noun>advices|informations|equipments))${WORD_END}`;
const JUDGED_BEFORE = new RegExp(
  `(?:(?:kind|sort|type)${SPACE}of|(?<!(?:${PLURAL_COUNT}|the|a|an|my|your|our|their|his|her|these|those)${SPACE})(?:bad|good|great|wise|sound|terrible|wrong|conflicting))${SPACE}$`,
  "iu",
);
const ARTICLE_EXEMPT = /\b(?:payment|remittance|shipping|credit|debit|legal)[ \t\u00a0]+$/i;
const plural = (unit: string) =>
  unit
    .replace(/^(\w+)/, (word) => (word === "piece" || word === "item" ? `${word}s` : word))
    .replace(/mark$/, "marks");

const FUNCTION_WORDS =
  /^(?:would|could|should|will|can|may|might|must|is|are|was|were|has|have|had|do|does|did|to|for|with|of|in|on|at|by|from|about|into|than|that|which|who|and|or|but|as|so|if|when|while|because|you|i|we|they|he|she|it|this|these|those)$/;

/** The next word continues a compound noun ("a software engineer", "a software rendered game"). */
function compoundHead(ctx: DetectContext, end: number): boolean {
  const next = nextLowerWord(ctx, end);
  if (!next || FUNCTION_WORDS.test(next)) return false;
  const info = englishWordInfo(next);
  // The lexicon leaves long plain nouns out ("component").
  if (!info) return next.length > 5;
  if (pastLemma(next)) {
    const after = nextLowerWord(ctx, end + ctx.text.slice(end).indexOf(next) + next.length);
    return !!after && !FUNCTION_WORDS.test(after) && !!englishWordInfo(after)?.noun;
  }
  // A noun after it heads the compound ("a software engineer", "a information frames").
  return info.noun || info.plural;
}

/** "an advice", "many information", "softwares": uncountable nouns used as counts. */
function massNouns(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, MASS_NOUN, (match) => match.index)) {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    const counted = COUNTED_BEFORE.exec(before);
    if (!counted) continue;
    const { single, several, how, afew } = counted.groups!;
    const noun = m[0];
    const n = noun.toLowerCase();
    const start = m.index - before.length + counted.index;
    const end = m.index + noun.length;
    if (noun !== n || hasUserOrCasedWord(ctx, ctx.text.slice(start, end))) continue;
    // "a software engineer": the noun modifies the next one.
    if (compoundHead(ctx, end)) continue;
    // "a information" is the core rule's warning.
    if (n === "information" && single && /^an?$/i.test(single)) continue;
    const { unit, count = [] } = MASS[n];
    const det = single ?? several;
    const kase = (text: string) => caseLike(det, text);
    let alternatives: string[];
    if (single) {
      const article = /^an?$/i.test(single);
      const withUnit = unit.endsWith("of") ? `${unit} ${n}` : unit;
      alternatives = article
        ? [
            `some ${n}`,
            `a ${withUnit}`,
            ...count.map(([one]) => `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}`),
          ]
        : [
            `${single.toLowerCase()} ${withUnit}`,
            ...count.map(([one]) => `${single.toLowerCase()} ${one}`),
          ];
    } else {
      const d = det.toLowerCase();
      const unitPlural = unit.endsWith("of") ? `${plural(unit)} ${n}` : plural(unit);
      alternatives = [
        ...(how ? [`${how.toLowerCase()}much ${n}`] : []),
        ...(d === "fewer" ? [`less ${n}`] : []),
        `${afew ? "a few" : d.replace(/^(?:how|so|too)\s+/, `${how ? how.toLowerCase() : ""}`)} ${unitPlural}`,
        ...count.map(([, many]) => `${d.replace(/\s+/g, " ")} ${many}`),
      ];
    }
    const offered = [...new Set(alternatives.map(kase))];
    findings.push({
      ruleId: "englishCountability",
      messageKey: "review_msg_countability",
      range: { start, end },
      alternatives: offered,
      ...(offered.length > 1 ? { requiresChoice: true as const } : {}),
      context: around(ctx, m),
    });
  }
  const judged = [...frameMatches(ctx, JUDGED_PLURAL)].filter((m) =>
    JUDGED_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 48), m.index)),
  );
  for (const m of [...frameMatches(ctx, MASS_PLURAL), ...judged]) {
    const noun = m.groups!.noun;
    if (noun !== noun.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) continue;
    if (ARTICLE_EXEMPT.test(ctx.text.slice(Math.max(0, m.index - 16), m.index))) continue;
    if (SPECIALIST.test(ctx.text.slice(Math.max(0, m.index - 128), m.index + m[0].length + 128)))
      continue;
    if (compoundHead(ctx, m.index + m[0].length)) continue;
    findings.push(
      found(ctx, m, "englishCountability", "review_msg_mass_noun", [noun.slice(0, -1)]),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------- noun number

const TAILS =
  /^(?:is|was|has|had|does|did|can|could|will|would|should|must|that|which|who|where|with|in|on|at|of|for|to|from|and|or)$/;
const ONE_OF = `one${SPACE}of${SPACE}(?:the|my|your|his|her|our|their|these|those)(?<words>(?:${SPACE}(?!(?:of|and|or|that|which|who)${WORD_END})[A-Za-z][A-Za-z-]*){1,7})(?!${EDGE})`;
const COLLECTIVE =
  /^(?:family|team|crew|gang|staff|group|band|crowd|audience|public|committee|club|party|class|army|jury|best|most|few|same|other|kind|sort|type|lot)$/;
// Words that end the search for the noun: a plural is already right ("the trees behind him"),
// and a pronoun, preposition or number is not the head ("the many notes she included").
const NOT_A_HEAD_NOUN =
  /^(?:people|men|women|children|feet|teeth|mice|geese|police|data|media|criteria|phenomena|few|many|several|i|me|you|he|him|she|her|it|we|us|they|them|this|that|these|those|behind|above|below|under|over|after|before|between|among|without|within|during|about|around|into|onto|upon|across|along|against|toward|towards|near|beside|beyond|through|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million)$/;

/** Where "one of the …" ends: a clause end, a function word or a verb ("node loses"). */
function closesNounPhrase(next: string | undefined, after: string): boolean {
  // The end of the text closes it too; typing proposals never reach the word at the caret.
  if (!next)
    return (
      /^[ \t\u00a0]*(?:[.!?,;:)]|[ \t\u00a0]+[A-Za-z]+)/.test(after) ||
      (/^[ \t\u00a0]*$/.test(after) && after.length < 24)
    );
  if (TAILS.test(next)) return true;
  // "one of the car parks": a plural after the word is the noun itself.
  const info = englishWordInfo(next);
  return !!info?.verbs.some((v) => v.form === "third" || v.form === "past") && !info.plural;
}

/** "one of the test" names one member of a plural set. */
function oneOfPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ONE_OF, (match) => match.index)) {
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [wordsStart] = m.indices!.groups!.words;
    const words = [...m.groups!.words.matchAll(/[A-Za-z][A-Za-z-]*/g)];
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    let head = -1;
    for (let i = 0; i < words.length && head < 0; i++) {
      const word = words[i][0].toLowerCase();
      if (NOT_A_HEAD_NOUN.test(word) || englishWordInfo(word)?.plural) break;
      if (closesNounPhrase(words[i + 1]?.[0], after)) head = i;
    }
    if (head < 0) continue;
    const noun = words[head][0];
    if (COLLECTIVE.test(noun) || !/^[a-z]+$/.test(noun)) continue;
    // Authored nouns ("person", "device") take their authored plural; the core rule's
    // identical finding for the same span merges with this one.
    const authored = englishNounForms(noun);
    const info = englishWordInfo(noun);
    if (authored ? noun !== authored.singular : !info?.noun || info.plural || info.adjective)
      continue;
    const plural =
      authored?.plural ??
      IRREGULAR_PLURALS[noun] ??
      [`${noun}s`, `${noun}es`, noun.replace(/([^aeiou])y$/, "$1ies")].find(
        (form) => form !== noun && englishWordInfo(form)?.plural,
      );
    if (!plural) continue;
    const start = wordsStart + words[head].index;
    findings.push({
      ruleId: "englishNounNumber",
      messageKey: "review_msg_one_of",
      range: { start, end: start + noun.length },
      alternatives: [plural],
      context: around(ctx, m),
    });
  }
  return findings;
}

const DECADE_WORDS =
  "style|styled|era|music|fashion|vibes?|aesthetic|rock|pop|kids|look|design|tech|technology|cartoons|movies|films|songs|hits|culture|nostalgia|retro|sound";
const DECADE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@#.\\\\-])(?:(?<age>(?:my|his|her|their|our|your)${SPACE}(?:(?:early|mid|late)[ \\t\\u00a0-]{1,8})?)(?<two>[1-9]0)|(?<when>(?:early|mid|late)[ \\t\\u00a0-]{1,8})(?<span>1[0-9]{2}0|20[0-9]0|[1-9]0)|(?<decade>1[0-9]{2}0|20[0-9]0|[1-9]0)(?=['’]s(?:[ \\t\\u00a0]{1,8}|-)(?:${DECADE_WORDS})(?![\\p{L}])))(?<mark>['’])s(?![\\p{L}\\p{N}_'’@#\\\\])`,
  "gidu",
);

/** "in my 30's", "late 1970's", "an 80's style": decades and ages take a plain s. */
function decades(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const digits = (m: RegExpExecArray) =>
    m.indices!.groups![m.groups!.two ? "two" : m.groups!.span ? "span" : "decade"];
  for (const m of frameMatches(ctx, DECADE, (match) => digits(match)[0])) {
    const [start] = digits(m);
    const number = m.groups!.two ?? m.groups!.span ?? m.groups!.decade;
    const end = m.index + m[0].length;
    const short = number.length === 2 && !m.groups!.age;
    findings.push({
      ruleId: "englishNounNumber",
      messageKey: "review_msg_decade_plural",
      range: { start, end },
      alternatives: short ? [`${m.groups!.mark}${number}s`, `${number}s`] : [`${number}s`],
      ...(short ? { requiresChoice: true as const } : {}),
      context: around(ctx, m),
    });
  }
  return findings;
}

const COUNT_WORDS = "two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|hundred";
const EACH_COUNT = `(?<target>each)${SPACE}(?:[2-9]|[1-9][0-9]+|${COUNT_WORDS})${SPACE}[a-z]+s${WORD_END}`;
const VAGUE_COUNT = `(?<target>(?<vague>several|many|numerous)${SPACE}(?<count>${COUNT_WORDS}|[2-9]|[1-9][0-9]+))${SPACE}[a-z]+s${WORD_END}`;

/** "each 2 hours" is "every 2 hours"; "several two hosts" states two counts. */
function quantifiedNumbers(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, EACH_COUNT))
    findings.push(
      found(ctx, m, "englishNounNumber", "review_msg_noun_count", [
        caseLike(m.groups!.target, "every"),
      ]),
    );
  for (const m of frameMatches(ctx, VAGUE_COUNT))
    findings.push(
      found(ctx, m, "englishNounNumber", "review_msg_noun_count", [
        caseLike(m.groups!.vague, m.groups!.count),
        m.groups!.vague,
      ]),
    );
  return findings;
}

const NUMBER_UNIT = `(?<![\\p{N}.,])(?<target>(?<n>[0-9]+)${SPACE}(?<unit>day|week|month|year|hour|minute|mile|page|step|point))(?=-[a-z]|${SPACE}(?<next>[a-z]+)${WORD_END})`;
const NOT_A_HEAD =
  /^(?:ago|old|olds|later|earlier|before|after|of|and|or|to|in|on|at|for|from|with|by|per|each|is|was|are|were|left|long|away|late|early|off)$/;

/** "a 3 day course": a number and unit before a noun are hyphenated. */
function numberUnits(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, NUMBER_UNIT)) {
    const { n, unit, next } = m.groups!;
    if (n === "1" || (next && NOT_A_HEAD.test(next))) continue;
    if (next && !englishWordInfo(next)?.noun && !englishWordInfo(next)?.adjective) continue;
    findings.push(
      found(ctx, m, "englishContextualCompounds", "review_msg_compounds", [`${n}-${unit}`]),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------- words

const YOU_R = `(?<target>(?<pronoun>you|we|they)${SPACE}r)${WORD_END}(?![.'’])`;
const THAT_S = `(?<target>(?<word>that|it|there|what|here|who|he|she|where|let)${SPACE}s)${WORD_END}(?![.'’])`;
// A stray single letter ("weirdl y"), found first; the word before it is read afterwards.
const SPLIT_LETTER = /[ \t\u00a0][b-hj-z](?![\p{L}\p{N}_'’@/#\\-])/gu;
const NO_BODY = `(?<target>no${SPACE}body)${SPACE}(?<verb>[a-z]+)${WORD_END}`;

// The university and hospital are named after Johns Hopkins; another John Hopkins is a person.
const JOHN_HOPKINS = `(?<target>john)(?=[ \\t\\u00a0\\n]{1,8}hopkins(?<institution>-|${SPACE}(?:university|hospital|medicine|medical|school)${WORD_END})?(?![\\p{L}]))`;
const VISITED = /\b(?:at|to|toured|visited|attend|attends|attended|the)[ \t\u00a0]{1,8}$/i;

/** Chat spellings and words split by a stray space. */
function splitWords(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of gatedMatches(ctx, /[ \t\u00a0]r\b/gi, YOU_R)) {
    const pronoun = m.groups!.pronoun;
    const kase =
      pronoun === pronoun.toUpperCase() ? (s: string) => s.toUpperCase() : (s: string) => s;
    findings.push(
      found(ctx, m, "englishPhraseCorrections", "review_msg_phrase_correction", [
        `${pronoun} ${kase("are")}`,
        `${pronoun}${kase("'re")}`,
      ]),
    );
  }
  for (const m of gatedMatches(ctx, /john/gi, JOHN_HOPKINS)) {
    const place = VISITED.test(ctx.text.slice(Math.max(0, m.index - 16), m.index));
    if (!place && !m.groups!.institution) continue;
    const typed = m[0];
    findings.push(
      found(ctx, m, "englishPhraseCorrections", "review_msg_phrase_correction", [
        `${typed}${typed === typed.toUpperCase() ? "S" : "s"}`,
      ]),
    );
  }
  for (const m of gatedMatches(ctx, /[ \t\u00a0]s\b/gi, THAT_S)) {
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    findings.push(
      found(ctx, m, "englishContractionNormalization", "review_msg_contraction", [
        `${m.groups!.word}'s`,
      ]),
    );
  }
  for (const m of frameMatches(ctx, SPLIT_LETTER, (match) => match.index + 1)) {
    const letterAt = m.index + 1;
    const head = /(?<![\p{L}\p{N}_'’@/#\\.-])[a-z]{3,}(?=[ \t\u00a0]+$)/u.exec(
      ctx.text.slice(Math.max(0, letterAt - 40), letterAt),
    )?.[0];
    const word = head && head + ctx.text[letterAt];
    if (!head || englishWordInfo(head) || ctx.dictionary.has(head) || !englishWordInfo(word!))
      continue;
    const start = ctx.text.lastIndexOf(head, letterAt);
    findings.push({
      ruleId: "englishTypoWhitelistCorrection",
      messageKey: "review_msg_typo",
      range: { start, end: letterAt + 1 },
      alternatives: [word!],
      context: around(ctx, m),
    });
  }
  for (const m of gatedMatches(ctx, /no[ \t\u00a0]+body/gi, NO_BODY)) {
    const info = englishWordInfo(m.groups!.verb);
    if (!info?.verbs.some((v) => v.form === "past" || v.form === "third") || info.noun) continue;
    findings.push(
      found(ctx, m, "englishContextualCompounds", "review_msg_compounds", [
        caseLike(m.groups!.target, "nobody"),
      ]),
    );
  }
  return findings;
}

const DANGLING = `(?<target>the${SPACE}(?:and|or|but|because|nor))${WORD_END}|(?=an?${SPACE})(?<=(?:^|[.!?][ \\t\\u00a0]+))(?<article>An?${SPACE}(?:because|although|unless))${WORD_END}`;

/** "The and other options": a determiner with no noun after it. */
function danglingDeterminers(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, DANGLING, (match) => match.index)) {
    if (m.groups!.target && !/^the[ \t\u00a0]+[a-z]+$/i.test(m.groups!.target)) continue;
    if (m.groups!.target && /[A-Z]/.test(m.groups!.target.split(/\s+/)[1])) continue;
    const finding = found(
      ctx,
      m,
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      [],
      m.groups!.target ? "target" : "article",
    );
    findings.push({ ...finding, warningOnly: true });
  }
  return findings;
}

// ---------------------------------------------------------------------------- typography

// Words that open a sentence and never a dotted name's next part ("table.The room").
const STARTERS =
  "The|A|An|It|Its|I|So|But|And|This|That|These|Those|He|She|We|They|You|There|Then|What|When|Where|Why|How|If|My|Our|Your|His|Her|Their|Some|Many|One|No|Yes|Now|Also|However|After|Before|As|Each|Every|All";
const MISSING_SPACE = new RegExp(
  `(?<=(?:^|[\\s(“"])\\p{L}*\\p{Ll}\\p{L})(?:(?<period>\\.)(?=(?:${STARTERS})[ \\t\\u00a0,])|(?<mark>[?!])(?=\\p{Lu}\\p{Ll}*[ \\t\\u00a0,])|(?<semi>;)(?=\\p{Ll}{2,}[ \\t\\u00a0,]))`,
  "gu",
);
/**
 * Dotted tokens that are prose, not names: "a.m.", a decimal range ("1.5-2.5"), two
 * sentences glued at a period ("table.The") and the brand "WordPress.com" (grammarStyle2.ts
 * fixes its casing). Review's technical-token guard lets them through.
 */
export const PROSE_DOTTED_TOKEN = new RegExp(
  `^(?:\\p{Nd}{1,9}(?:\\.\\p{Nd}{1,9})?[-–—]\\p{Nd}{1,9}(?:\\.\\p{Nd}{1,9})?|[ap]\\.m|[AP]\\.M|\\p{L}*\\p{Ll}{2}\\.(?:${STARTERS})|[Ww]ord[Pp]ress\\.com)$`,
  "u",
);

/** "table.The room": a sentence mark glued to the next sentence. */
function missingSpace(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, MISSING_SPACE, (match) => match.index)) {
    const start = m.index;
    const before = /[\p{L}]+$/u.exec(ctx.text.slice(Math.max(0, start - 32), start))?.[0] ?? "";
    if (ctx.text[start - before.length - 1] === "&") continue;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_after_mark",
      range: { start, end: start + 1 },
      alternatives: [`${m[0]} `],
      context: { start: Math.max(0, start - 16), end: Math.min(ctx.text.length, start + 16) },
    });
  }
  return findings;
}

const RANGE = new RegExp(
  `(?<![\\p{L}\\p{N}.,:/#+–—-])(?<a>[0-9]+(?:\\.[0-9]+)?)(?<dash>[-—])(?<b>[0-9]+(?:\\.[0-9]+)?)(?![\\p{L}\\p{N}_]|[-–—/:][0-9]|[.,][0-9])`,
  "gdu",
);

/** Optional typography: a number range takes an en dash ("pages 12–14"). */
function numberRanges(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, RANGE, (match) => match.index)) {
    const { a, b } = m.groups!;
    // Telephone and postal numbers: "555-1234", "12345-6789".
    if (b.length === 4 && (a.length === 3 || a.length === 5)) continue;
    const at = m.indices!.groups!.dash[0];
    findings.push({
      ruleId: "emdashShortcut",
      messageKey: "review_msg_typed_dash",
      range: { start: at, end: at + 1 },
      alternatives: ["–"],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------- optional style

const STYLE_WORDS: Record<string, string[]> = {
  fav: ["favorite"],
  favs: ["favorites"],
  fave: ["favorite"],
  faves: ["favorites"],
  ppl: ["people"],
  omg: ["oh my god"],
  rly: ["really"],
  eli5: ["explain like I'm five"],
  iykyk: ["if you know, you know"],
  iiuc: ["if I understand correctly"],
  shit: ["crap", "sh*t"],
  fuck: ["****"],
  fucking: ["****ing"],
  fucked: ["****ed"],
  fucker: ["****er"],
  fuckers: ["****ers"],
};
const STYLE_WORD = frame(`(?<target>${Object.keys(STYLE_WORDS).join("|")})${WORD_END}`);
const STYLE_GATE = new RegExp(Object.keys(STYLE_WORDS).join("|"), "gi");
// Fillers and hedges that leave the sentence intact once removed.
const FILLER = `(?<![0-9][ \\t\\u00a0]{0,8})(?<target>(?:uh|um|umm|uhm|uhh|erm|I${SPACE}would${SPACE}argue${SPACE}that)${SPACE})(?=[A-Za-z])`;
const INCREASINGLY = `(?<target>increasingly${SPACE}(?<degree>more|less))${SPACE}(?<adj>[A-Za-z]+)${WORD_END}`;
const FIRST_TIME = `discover(?:ed|s|ing)?(?:${SPACE}[A-Za-z]+){0,3}(?<target>${SPACE}for${SPACE}the${SPACE}first${SPACE}time)${WORD_END}`;

const MARKERS =
  "however|therefore|meanwhile|furthermore|nevertheless|consequently|thus|instead|moreover|alternatively|frankly|nowadays|now a days|for example|for instance|on the other hand|additionally|hence";
const MARKER_GATE = new RegExp(MARKERS.replaceAll(" ", "[ \\t\\u00a0]+"), "gi");
const MARKER = `(?<target>${MARKERS.replaceAll(" ", SPACE)})(?=${SPACE}(?<next>[A-Za-z]+))`;
const MARKER_COMPLEMENTS = /^(?:of|far|much|many|long|often|hard|good|bad|little|few|more|less)$/;

const MERIDIEM = `(?<number>[0-9]{1,2}(?::[0-5][0-9])?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?<meridiem>[ \\t\\u00a0]?(?:[ap]\\.m\\.|[AP]\\.M\\.|[ap]m|[AP]M))`;
const TIME_OF_DAY = `(?<target>${MERIDIEM}(?<tail>${SPACE}(?:in${SPACE}the${SPACE}(?:morning|afternoon|evening)|at${SPACE}night)))(?!${EDGE})`;

const UNIT_WORDS: Record<string, string> = {
  B: "byte",
  kB: "kilobyte",
  MB: "megabyte",
  GB: "gigabyte",
  TB: "terabyte",
  PB: "petabyte",
  EB: "exabyte",
  ZB: "zettabyte",
  YB: "yottabyte",
  RB: "ronnabyte",
  QB: "quettabyte",
  KiB: "kibibyte",
  MiB: "mebibyte",
  GiB: "gibibyte",
  TiB: "tebibyte",
  PiB: "pebibyte",
  EiB: "exbibyte",
  ZiB: "zebibyte",
  YiB: "yobibyte",
  RiB: "robibyte",
  QiB: "quebibyte",
  hr: "hour",
  hrs: "hour",
  min: "minute",
  mins: "minute",
  sec: "second",
  secs: "second",
  ms: "millisecond",
  msec: "millisecond",
  msecs: "millisecond",
};
const UNIT = new RegExp(
  `(?<![\\p{L}\\p{N}.,_+-])(?<n>[0-9]+(?:\\.[0-9]+)?)(?:(?<sep>[ \\u00a0]|-)B|(?<sep2>[ \\u00a0]?|-)(?<unit>${Object.keys(
    UNIT_WORDS,
  )
    .filter((unit) => unit !== "B")
    .join("|")}))(?![\\p{L}\\p{N}_'’@/#\\\\-]|\\.[\\p{L}\\p{N}])`,
  "gdu",
);
const REFLEXIVE = "myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself";
const SELF_VERB = `(?<target>(?<self>self)[- \\t\\u00a0]?)(?<verb>[A-Za-z]+)(?:${SPACE}(?:it|one|them|this|that|to|on)){0,1}${SPACE}(?:${REFLEXIVE})${WORD_END}`;

const INTENSIFIED =
  /^[ \t\u00a0]+(?:is|isn['’]t|was|wasn['’]t|are|has|does|doesn['’]t|can|will|would|should|must)\b/i;

const style = (ctx: DetectContext, m: RegExpExecArray, alternatives: string[], group = "target") =>
  found(ctx, m, "stylePhrasing", "review_msg_style_phrasing", alternatives, group);

/** Optional style advice the phrase tables cannot express. */
function optionalStyle(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of gatedMatches(ctx, STYLE_GATE, STYLE_WORD)) {
    const typed = m.groups!.target;
    if (ctx.dictionary.has(typed.toLowerCase()) || hasUserOrCasedWord(ctx, typed)) continue;
    // "PPL" in capitals is also an acronym, unless the text around it shouts too.
    if (typed.length > 1 && typed === typed.toUpperCase()) {
      const near = ctx.text.slice(Math.max(0, m.index - 24), m.index + typed.length + 24);
      const words = (near.match(/\p{L}{2,}/gu) ?? []).filter((w) => w !== typed);
      if (words.length && !words.some((w) => w === w.toUpperCase())) continue;
    }
    findings.push(
      style(
        ctx,
        m,
        STYLE_WORDS[typed.toLowerCase()].map((r) => caseLike(typed, r)),
      ),
    );
  }
  for (const m of gatedMatches(ctx, /\b(?:uh|um|umm|uhm|uhh|erm|argue)\b/gi, FILLER))
    findings.push(style(ctx, m, [""]));
  for (const m of gatedMatches(ctx, /increasingly/gi, INCREASINGLY)) {
    // An adjective follows: "more prevalent", not "more people" or "more than".
    const word = m.groups!.adj.toLowerCase();
    const adj = englishWordInfo(word);
    if (FUNCTION_WORDS.test(word) || (adj && !adj.adjective && !plainWord(word))) continue;
    const degree = m.groups!.degree.toLowerCase();
    findings.push(style(ctx, m, [caseLike(m.groups!.target, `${degree} and ${degree}`)]));
  }
  for (const m of gatedMatches(ctx, /first[ \t\u00a0]+time/gi, FIRST_TIME))
    findings.push(style(ctx, m, [""]));
  for (const m of gatedMatches(ctx, MARKER_GATE, MARKER)) {
    const next = m.groups!.next.toLowerCase();
    if (!atClauseStart(ctx, m.index) || MARKER_COMPLEMENTS.test(next)) continue;
    if (/^however$/i.test(m.groups!.target) && englishWordInfo(next)?.adjective) continue;
    findings.push(style(ctx, m, [`${m.groups!.target},`]));
  }
  for (const m of gatedMatches(ctx, /morning|afternoon|evening|night/gi, TIME_OF_DAY)) {
    const { number, meridiem, tail } = m.groups!;
    // "5 P.M. in the afternoon." keeps one period.
    const end = m.index + m[0].length;
    const time = number + meridiem;
    const doubled = time.endsWith(".") && ctx.text[end] === ".";
    const finding = style(ctx, m, [time.slice(0, doubled ? -1 : undefined), `${number}${tail}`]);
    findings.push(finding);
  }
  for (const m of gatedMatches(ctx, /[0-9]/g, UNIT, (match) => match.index)) {
    const { n, unit = "B" } = m.groups!;
    const sep = m.groups!.sep ?? m.groups!.sep2;
    const word = UNIT_WORDS[unit];
    const hyphen = sep === "-";
    findings.push({
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${n}${hyphen ? "-" : " "}${word}${hyphen || n === "1" ? "" : "s"}`],
      context: around(ctx, m),
    });
  }
  for (const m of gatedMatches(ctx, /self/gi, SELF_VERB)) {
    const verb = m.groups!.verb;
    if (!englishWordInfo(verb)?.verbs.length && !/(?:ing|ed|s)$/i.test(verb)) continue;
    // "self harm itself isn't…": the reflexive stresses a noun subject.
    if (INTENSIFIED.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 16)))
      continue;
    const [start] = m.indices!.groups!.target;
    const [, verbEnd] = m.indices!.groups!.verb;
    findings.push({
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start, end: verbEnd },
      alternatives: [caseLike(m.groups!.self, verb)],
      context: around(ctx, m),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------- contractions

const NOT_STEMS =
  /^(?:is|are|was|were|do|does|did|has|have|had|could|would|should|might|must|need|may|ought|dare)$/;
const SUBJECTS = /^(?:I|you|he|she|it|we|they|that|this|there|here|what|who|where|how|when|why)$/i;
const CONTRACTION = frame(
  `(?<target>(?<word>[A-Za-z]+)['’](?<ending>t|m|re|ve|ll|d|s)(?:['’](?<have>ve))?)${WORD_END}`,
);

/** The full form(s) of a contraction, or null when it is not one ("John's", "o'clock"). */
function expandContraction(
  word: string,
  ending: string,
  have: string | undefined,
): string[] | null {
  const w = word.toLowerCase();
  const e = ending.toLowerCase();
  let full: string[] | null = null;
  if (e === "t") {
    if (!w.endsWith("n")) return null;
    const stem = w.slice(0, -1);
    const special: Record<string, string> = { ca: "cannot", wo: "will not", sha: "shall not" };
    full = special[stem] ? [special[stem]] : NOT_STEMS.test(stem) ? [`${stem} not`] : null;
  } else if (e === "m") full = w === "i" ? ["I am"] : null;
  else if (e === "re")
    full = /^(?:you|we|they|who|what|how|where|there|why|when)$/.test(w) ? [`${w} are`] : null;
  else if (e === "ve")
    full = /^(?:i|you|we|they|who|what|could|would|should|might|must|may)$/.test(w)
      ? [`${w} have`]
      : null;
  else if (e === "ll") full = SUBJECTS.test(w) ? [`${w} will`] : null;
  else if (e === "d") full = SUBJECTS.test(w) ? [`${w} would`, `${w} had`] : null;
  else if (w === "let") full = ["let us"];
  else if (e === "s" && SUBJECTS.test(w) && w !== "i") full = [`${w} is`, `${w} has`];
  return full && full.map((f) => (have ? `${f} have` : f).replace(/^i\b/, "I"));
}

/** Optional formal register: contractions written out. */
function contractions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CONTRACTION)) {
    const { word, ending, have, target } = m.groups!;
    if (hasUserOrCasedWord(ctx, target)) continue;
    const full = expandContraction(word, ending, have);
    if (!full) continue;
    findings.push(
      found(
        ctx,
        m,
        "styleContractions",
        "review_msg_avoid_contractions",
        full.map((f) => caseLike(target, f)),
      ),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------- serial comma

const ITEM = `[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*(?:${SPACE}[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*){0,2}`;
const LIST_TAIL = new RegExp(
  `(?<=[\\p{L}\\p{N})])(?<comma>,)${SPACE}(?<item>${ITEM})(?<oxford>,)?${SPACE}(?<conj>and|or|nor)${SPACE}(?<after>[\\p{L}\\p{N}]+)`,
  "gdu",
);
const INTRO =
  /^(?:however|when|whenever|if|after|before|in|on|at|for|while|although|though|because|since|yes|no|hello|hi|hey|well|so|also|then|now|first|second|finally|thus|therefore|meanwhile|as|once|until|unless|whether|by|with|from|during|to|dear|oh|okay|ok|sadly|luckily|unfortunately|fortunately)$/i;
const SUBJECT_PRONOUN = /^(?:I|you|he|she|it|we|they|there)$/i;

/** Optional serial comma: "A, B and C" or "A, B, and C", by the writer's chosen style. */
function serialCommas(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const add = !ctx.rules || ctx.rules.has("styleOxfordComma");
  const remove = !ctx.rules || ctx.rules.has("styleNoOxfordComma");
  for (const m of frameMatches(ctx, LIST_TAIL, (match) => match.index)) {
    const { item, oxford, after } = m.groups!;
    const before = ctx.text.slice(Math.max(0, m.index - 160), m.index);
    const clause = before.slice(before.search(/[^.!?;:\n]*$/));
    const head = clause.trimStart().split(/[ \t\u00a0,]+/)[0] ?? "";
    // An introductory word or clause before the first comma is not a list item.
    if (
      !clause.includes(",") &&
      (INTRO.test(head) || (/ly$/i.test(head) && !/[ \t\u00a0]/.test(clause.trim())))
    )
      continue;
    const words = item.split(/[ \t\u00a0]+/);
    if (words.some((word) => SUBJECT_PRONOUN.test(word) || /^(?:and|or|nor|but)$/i.test(word)))
      continue;
    // ", affecting relationships and identity" is a participle clause, not a list item.
    if (words.length > 1 && /ing$/i.test(words[0])) continue;
    const [conjStart] = m.indices!.groups!.conj;
    if (oxford) {
      if (!remove || SUBJECT_PRONOUN.test(after)) continue;
      const [at] = m.indices!.groups!.oxford;
      findings.push({
        ruleId: "styleNoOxfordComma",
        messageKey: "review_msg_no_oxford_comma",
        range: { start: at, end: conjStart },
        alternatives: [" "],
        context: { start: m.index, end: m.index + m[0].length },
      });
    } else if (add) {
      const [, itemEnd] = m.indices!.groups!.item;
      findings.push({
        ruleId: "styleOxfordComma",
        messageKey: "review_msg_oxford_comma",
        range: { start: itemEnd, end: conjStart },
        alternatives: [`,${ctx.text.slice(itemEnd, conjStart)}`],
        context: { start: m.index, end: m.index + m[0].length },
      });
    }
  }
  return findings;
}

const OPENERS = '"“`(';
const CLOSERS = '"”`)';

/** Inside a short quotation or parenthesis on its line: an example under discussion. */
export function quotedMention(ctx: DetectContext, finding: RawFinding): boolean {
  const before = ctx.text.slice(Math.max(0, finding.range.start - 48), finding.range.start);
  const after = ctx.text.slice(finding.range.end, finding.range.end + 48);
  const open = Math.max(...[...OPENERS].map((mark) => before.lastIndexOf(mark)));
  if (open < 0 || /[\n.!?]/.test(before.slice(open + 1))) return false;
  const closer = CLOSERS[OPENERS.indexOf(before[open])];
  const close = after.indexOf(closer);
  return close >= 0 && !/\n/.test(after.slice(0, close));
}
/** English only; findings inside a quoted or parenthesized example are dropped. */
export const english =
  (...detectors: ((ctx: DetectContext) => RawFinding[])[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US"
      ? []
      : detectors.flatMap((detect) => detect(ctx)).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishDoubledDegree", "stylePhrasing"],
    detect: english(gated(/mo(?:re|st)\b/gi, degree)),
  },
  {
    rules: ["englishAuxiliaryBaseVerb", "englishModalOfCorrection"],
    detect: english(gated(/did|helped/gi, doSupport), gated(/may[ \t\u00a0]+of\b/gi, modalOf)),
  },
  {
    rules: [
      "englishTypoWhitelistCorrection",
      "englishPhraseCorrections",
      "englishContractionNormalization",
      "englishContextualCompounds",
    ],
    detect: english(splitWords, gated(/things/gi, thingsIs)),
  },
  {
    rules: ["englishSentenceStructure"],
    detect: english(
      gated(
        /\b(?:is|are|was|were|am|be|['’](?:s|re|m))[ \t\u00a0]+(?:is|are|was|were|am|be)\b/gi,
        doubleBe,
      ),
      gated(/the[ \t\u00a0]+some\b/gi, theSome),
      gated(
        /\b(?:the|an?)[ \t\u00a0]+(?:and|or|but|because|nor|although|unless)\b/gi,
        danglingDeterminers,
      ),
    ),
  },
  {
    rules: ["englishCountability"],
    detect: english(gated(/criteri|phenomen/gi, greekPlurals), gated(MASS_GATE, massNouns)),
  },
  {
    rules: ["englishNounNumber", "englishContextualCompounds"],
    detect: english(
      gated(/one[ \t\u00a0]+of\b/gi, oneOfPlural),
      gated(/[0-9]['’]s/g, decades),
      gated(/each|several|many|numerous/gi, quantifiedNumbers),
      gated(
        /[0-9][ \t\u00a0]+(?:day|week|month|year|hour|minute|mile|page|step|point)\b/gi,
        numberUnits,
      ),
    ),
  },
  { rules: ["commaPeriodSpacing"], detect: english(gated(/\p{Ll}[.?!;]\p{L}/gu, missingSpace)) },
  { rules: ["emdashShortcut"], detect: gated(/[0-9][-—][0-9]/g, numberRanges) },
  { rules: ["stylePhrasing"], detect: english(optionalStyle) },
  { rules: ["styleContractions"], detect: english(gated(/['’]/g, contractions)) },
  { rules: ["styleOxfordComma", "styleNoOxfordComma"], detect: english(serialCommas) },
];
