import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { arabicDates } from "./dates";

type Finding = Omit<RawFinding, "ruleId">;
type Token = { word: string; start: number; end: number; gap: string };

// Whole unvowelled words: a vowelled word is left to the writer. A trailing tanwin
// fath ("رجلا\u064B") is kept apart so the word itself still reads.
const TOKEN = /(?<![\p{L}\p{M}\p{N}])\p{L}+(?=\u064B?(?![\p{L}\p{M}\p{N}]))/gu;

/** The words from shortly before the chunk to shortly after it, with the text between them. */
function tokens(ctx: DetectContext): Token[] {
  const list: Token[] = [];
  TOKEN.lastIndex = Math.max(0, ctx.from - 96);
  const limit = Math.min(ctx.text.length, ctx.to + 160);
  for (let m = TOKEN.exec(ctx.text); m && m.index < limit; m = TOKEN.exec(ctx.text)) {
    const previous = list.at(-1);
    list.push({
      word: m[0],
      start: m.index,
      end: m.index + m[0].length,
      gap: previous ? ctx.text.slice(previous.end, m.index) : "",
    });
  }
  return list;
}
/** Two words in a row: only spaces (and a tanwin) between them. */
const adjacent = (token: Token) => /^\u064B?[ \t\u00a0]+$/u.test(token.gap);
const owns = (ctx: DetectContext, at: number) =>
  at >= ctx.from && at < ctx.to && !namedExampleBefore(ctx.text, at);

/** The word without "ال". */
const bare = (word: string) => (word.startsWith("ال") ? word.slice(2) : word);

// --------------------------------------------------------- noun shapes

// Feminine nouns without ة (body pairs, earth, sun, fire, war...).
const FEMININE = new Set(
  "أرض شمس نار حرب دار ريح بئر عصا كأس فأس يد عين أذن كتف ساق قدم كف سن".split(" "),
);
// Masculine words with ة, and human plurals that take هؤلاء (not هذه).
const NOT_FEMININE = new Set(
  "خليفة علامة رحالة داعية نابغة طلبة أساتذة تلامذة كتبة سحرة خونة بررة كفرة فجرة جبابرة عباقرة صيادلة فلاسفة أباطرة قياصرة أئمة".split(
    " ",
  ),
);
/** A definite singular feminine noun: "السلامة", "الأرض". */
function definiteFeminine(word: string): boolean {
  if (!word.startsWith("ال")) return false;
  const stem = word.slice(2);
  if (NOT_FEMININE.has(stem) || stem.endsWith("اة")) return false;
  return (stem.endsWith("ة") && stem.length > 2) || FEMININE.has(stem);
}
// Words in -تان that are not duals of a feminine noun.
const NOT_FEMININE_DUAL = /(?:ستان|ستين|^بستان|^فستان|^كتان|^بهتان|^شتان)$/u;

type Dual = { gender: "m" | "f"; oblique: boolean; stem: string };
/** A dual noun ("البطاقتان", "كتفين"), its gender and case, or undefined. */
function dual(word: string): Dual | undefined {
  const m = /^(?<stem>\p{L}{2,})(?<ending>ان|ين)$/u.exec(word);
  if (!m) return;
  const { stem, ending } = m.groups!;
  const oblique = ending === "ين";
  const noun = bare(stem);
  if (stem.endsWith("ت") && noun.length > 2 && !NOT_FEMININE_DUAL.test(word))
    return { gender: "f", oblique, stem };
  if (FEMININE.has(noun)) return { gender: "f", oblique, stem };
  if (noun.length < 3) return;
  return { gender: "m", oblique, stem };
}

/**
 * A sound masculine plural or a dual by its shape ("المسافرون", "عاملين",
 * "صفحتان"): a participle (م-, فاعل) or a nisba (-ي) before -ون/-ين, or a
 * feminine dual in -تان/-تين. Singulars that end the same way ("قانون",
 * "مكان", "مضمون", "تلفزيون") have a shorter stem or another pattern.
 */
function soundPlural(word: string): { stem: string; oblique: boolean } | undefined {
  const m = /^(?<stem>\p{L}+)(?<ending>ون|ين)$/u.exec(word);
  if (!m) return;
  const { stem, ending } = m.groups!;
  const noun = bare(stem);
  if (noun.length < 4 || /^(?:تلفزي|تليفزي)/u.test(noun)) return;
  if (noun.startsWith("م") || noun[1] === "ا" || (noun.endsWith("ي") && noun.length > 4))
    return { stem, oblique: ending === "ين" };
}

// ------------------------------------------------------ demonstratives

const DEMONSTRATIVE = /^(?<pre>[وف]?[بلك]?)(?<dem>هذا|هذه|ذلك|تلك|هذان|هاتان|هذين|هاتين)$/u;
const DUAL_FORMS = { m: ["هذان", "هذين"], f: ["هاتان", "هاتين"] } as const;
const PREPOSITIONS = new Set(
  "في إلى على عن مع بين حول نحو عند لدى بعد قبل خلال دون منذ ضد عبر".split(" "),
);
// "بعد ذلك" + a new clause: after these, ذلك/تلك is a pronoun, not an article phrase.
const PRONOUN_AFTER = new Set([...PREPOSITIONS, "رغم", "مثل", "غير", "من"]);

/** "هذا السلامة", "هذان البطاقتان", "هذين الكتابان": a demonstrative agrees with its noun. */
function demonstratives(ctx: DetectContext, list: Token[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const m = DEMONSTRATIVE.exec(list[i].word);
    const noun = list[i + 1];
    if (!m || !adjacent(noun) || !owns(ctx, list[i].start)) continue;
    const { pre, dem } = m.groups!;
    const before =
      i > 0 && adjacent(list[i]) ? list[i - 1].word.replace(/^[وف](?=\p{L}{2})/u, "") : "";
    const far = dem === "ذلك" || dem === "تلك";
    if (far && (/[بلك]$/u.test(pre) || PRONOUN_AFTER.has(before))) continue;
    const at = list[i].start + pre.length;
    const context = { start: list[i].start, end: noun.end };
    if (dem === "هذا" || dem === "ذلك") {
      if (!definiteFeminine(noun.word)) continue;
      findings.push({
        messageKey: "review_msg_arabic_demonstrative_gender",
        range: { start: at, end: list[i].end },
        alternatives: [dem === "هذا" ? "هذه" : "تلك"],
        context,
      });
      continue;
    }
    if (dem === "هذه" || dem === "تلك") continue;
    const d = dual(noun.word);
    if (!d) continue;
    const prepositional = pre.length > 0 && /[بلك]$/u.test(pre);
    const afterPreposition = prepositional || PREPOSITIONS.has(before);
    const demOblique = dem === "هذين" || dem === "هاتين";
    const demGender = dem.startsWith("ها") ? "f" : "m";
    const genderFix = demGender !== d.gender;
    // After a preposition both are oblique; otherwise either side may be the slip.
    const options: Array<[boolean, boolean]> = afterPreposition
      ? [[true, true]]
      : demOblique === d.oblique
        ? [[demOblique, d.oblique]]
        : [
            [d.oblique, d.oblique],
            [demOblique, demOblique],
          ];
    const alternatives = options
      .map(([demCase, nounCase]) => {
        const fixedDem = DUAL_FORMS[d.gender][demCase ? 1 : 0];
        const fixedNoun = d.stem + (nounCase ? "ين" : "ان");
        return { fixedDem, fixedNoun };
      })
      .filter(({ fixedDem, fixedNoun }) => fixedDem !== dem || fixedNoun !== noun.word);
    if (!alternatives.length) continue;
    const nounChanges = alternatives.some(({ fixedNoun }) => fixedNoun !== noun.word);
    findings.push({
      messageKey: genderFix
        ? "review_msg_arabic_demonstrative_gender"
        : "review_msg_arabic_dual_case",
      range: { start: at, end: nounChanges ? noun.end : list[i].end },
      alternatives: alternatives.map(({ fixedDem, fixedNoun }) =>
        nounChanges ? fixedDem + noun.gap + fixedNoun : fixedDem,
      ),
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context,
    });
  }
  return findings;
}

// -------------------------------------------------------------- numbers

const UNITS: ReadonlyArray<readonly [string, string]> = [
  ["ثلاثة", "ثلاث"],
  ["أربعة", "أربع"],
  ["خمسة", "خمس"],
  ["ستة", "ست"],
  ["سبعة", "سبع"],
  ["ثمانية", "ثماني"],
  ["تسعة", "تسع"],
];
/** Unit word -> [form before a masculine noun, form before a feminine noun]. */
const UNIT_FORMS = new Map<string, readonly [string, string]>(
  UNITS.flatMap((pair) => [
    [pair[0], pair],
    [pair[1], pair],
  ]),
);
UNIT_FORMS.set("ثمان", UNITS[5]);
const TENS = /^(?<pre>[وبلك]{0,2})(?<stem>عشر|ثلاث|أربع|خمس|ست|سبع|ثمان|تسع)(?<ending>ون|ين)$/u;
const NOMINATIVE_NUMBERS = new Map([
  ["اثنان", "اثنين"],
  ["اثنتان", "اثنتين"],
  ["مئتان", "مئتين"],
  ["مائتان", "مائتين"],
  ["ألفان", "ألفين"],
  ["مليونان", "مليونين"],
  ["ملياران", "مليارين"],
]);
const NUMBER_WORDS = new RegExp(
  `^[وبلك]{0,2}(?:${[
    ...UNIT_FORMS.keys(),
    "واحد|واحدة|اثنان|اثنين|اثنتان|اثنتين|عشر|عشرة|مئة|مائة|مئتان|مئتين|مائتان|مائتين|ألف|ألفا|ألفان|ألفين|آلاف|مليون|مليونا|مليونان|مليونين|ملايين|مليار|ملياران|مليارين",
    "\\p{L}+مئة|\\p{L}+مائة",
    "(?:عشر|ثلاث|أربع|خمس|ست|سبع|ثمان|تسع)(?:ون|ين)",
  ].join("|")})$`,
  "u",
);

/** The counted noun's gender: "طالبة" is feminine, "رجلا" (tanwin alif) masculine. */
function countedGender(token: Token | undefined, text: string): "m" | "f" | undefined {
  if (!token || !adjacent(token)) return;
  const word = token.word;
  if (word.endsWith("ة") && !NOT_FEMININE.has(word)) return "f";
  if (/^\p{L}{2,}ا$/u.test(word) && !/(?:اء|ىا)$/u.test(word)) return "m";
  if (text[token.end] === "\u064B" && !word.endsWith("ة")) return "m";
}

/** 11-19 and 21-99 agree with the counted noun; after a preposition they are oblique. */
function numbers(ctx: DetectContext, list: Token[]): Finding[] {
  const findings: Finding[] = [];
  const push = (start: number, end: number, alternative: string, key: Finding["messageKey"]) => {
    if (!owns(ctx, start) || findings.some((f) => f.range.start < end && start < f.range.end))
      return;
    if (ctx.source.slice(start, end) === alternative) return;
    findings.push({
      messageKey: key,
      range: { start, end },
      alternatives: [alternative],
      context: { start, end: Math.min(ctx.text.length, end + 24) },
    });
  };
  for (let i = 0; i < list.length; i++) {
    const word = list[i].word;
    const next = list[i + 1];
    const afterNext = list[i + 2];

    // A number phrase after a preposition: every nominative part becomes oblique.
    const attached = /^[بلك](?=\p{L})/u.test(word) && NUMBER_WORDS.test(word);
    if (PREPOSITIONS.has(word) || word === "من" || attached) {
      for (let j = attached ? i : i + 1; j < list.length && (j === i || adjacent(list[j])); j++) {
        const part = list[j].word;
        if (!NUMBER_WORDS.test(part)) break;
        const tens = TENS.exec(part);
        const [, pre = "", rest = part] = /^([وبلك]{0,2})(.*)$/u.exec(part) ?? [];
        const oblique = tens
          ? tens.groups!.ending === "ون"
            ? pre + tens.groups!.stem + "ين"
            : undefined
          : NOMINATIVE_NUMBERS.has(rest)
            ? pre + NOMINATIVE_NUMBERS.get(rest)
            : undefined;
        if (oblique) push(list[j].start, list[j].end, oblique, "review_msg_arabic_number_case");
      }
    }

    // 11 and 12: the parts agree with each other and with the noun.
    if (next && adjacent(next) && /^(?:عشر|عشرة)$/u.test(next.word)) {
      const gender = countedGender(afterNext, ctx.text);
      const units =
        /^(?<pre>[وبلك]{0,2})(?<n>أحد|إحدى|اثنا|اثنتا|اثني|اثنتي|ثلاث|ثلاثة|أربع|أربعة|خمس|خمسة|ست|ستة|سبع|سبعة|ثمان|ثماني|ثمانية|تسع|تسعة)$/u.exec(
          word,
        );
      if (units && gender) {
        const { pre, n } = units.groups!;
        const f = gender === "f";
        const oblique = n === "اثني" || n === "اثنتي";
        const unit =
          n === "أحد" || n === "إحدى"
            ? f
              ? "إحدى"
              : "أحد"
            : /^اثن/u.test(n)
              ? (f ? "اثنت" : "اثن") + (oblique ? "ي" : "ا")
              : UNIT_FORMS.get(n)![f ? 1 : 0];
        const ten = f ? "عشرة" : "عشر";
        if (pre + unit !== word || ten !== next.word)
          push(
            list[i].start,
            next.end,
            pre + unit + next.gap + ten,
            "review_msg_arabic_number_gender",
          );
        continue;
      }
    }

    // 21-99: the unit before "و" + tens takes the opposite gender of the noun (1 and 2 the same).
    if (next && adjacent(next) && TENS.exec(next.word)?.groups!.pre === "و") {
      const unitMatch = /^(?<pre>[بلك]?)(?<n>\p{L}+)$/u.exec(word)!;
      const { pre, n } = unitMatch.groups!;
      const gender = countedGender(afterNext, ctx.text);
      if (!gender) continue;
      const f = gender === "f";
      const forms = UNIT_FORMS.get(n);
      const fixed = forms
        ? forms[f ? 1 : 0]
        : n === "واحد" || n === "واحدة"
          ? f
            ? "واحدة"
            : "واحد"
          : /^(?:اثنان|اثنتان|اثنين|اثنتين)$/u.test(n)
            ? (f ? "اثنت" : "اثن") + n.slice(n.startsWith("اثنت") ? 4 : 3)
            : undefined;
      if (fixed && fixed !== n)
        push(list[i].start, list[i].end, pre + fixed, "review_msg_arabic_number_gender");
      continue;
    }

    // 3-10 before a sound masculine plural: the masculine count takes ة.
    const counted = next && adjacent(next) ? soundPlural(next.word) : undefined;
    if (counted && !next.word.startsWith("ال")) {
      const m = /^(?<pre>[وبلك]{0,2})(?<n>\p{L}+)$/u.exec(word)!;
      const { pre, n } = m.groups!;
      const forms = n === "عشر" ? (["عشرة", "عشر"] as const) : UNIT_FORMS.get(n);
      if (forms && n !== forms[0])
        push(list[i].start, list[i].end, pre + forms[0], "review_msg_arabic_number_gender");
    }
    // "إحدى" before a masculine plural is "أحد".
    if (/^[وبلك]{0,2}إحدى$/u.test(word) && next && adjacent(next) && soundPlural(next.word))
      push(
        list[i].start,
        list[i].end,
        word.replace("إحدى", "أحد"),
        "review_msg_arabic_number_gender",
      );
  }
  return findings;
}

// --------------------------------------------------------- case endings

// إنّ and its sisters (لكنّ is left out: unvowelled it is also the light لكن).
const ACCUSATIVE_GOVERNORS = new Set("إن أن كأن ليت لعل".split(" "));
const CASE_PREPOSITIONS = new Set([...PREPOSITIONS].filter((p) => p !== "منذ"));
const JUSSIVE = /^[وف]?لم$/u;
const SUBJUNCTIVE = /^[وف]?(?:لن|أن|كي|لكي)$/u;

/**
 * "في المسافرون", "إن الكتابان": a sound plural or dual is oblique after a
 * preposition or إنّ; "لم يستطيعون", "لن يذهبون": the five verbs drop their ن,
 * and "لم يجري" shortens its last vowel.
 */
function caseEndings(ctx: DetectContext, list: Token[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const head = list[i].word;
    const next = list[i + 1];
    if (!adjacent(next) || !owns(ctx, next.start)) continue;
    const word = next.word;
    const governs = CASE_PREPOSITIONS.has(head) || ACCUSATIVE_GOVERNORS.has(head);
    if (governs) {
      const plural = soundPlural(word);
      const d = plural ? undefined : dual(word);
      const fixed =
        plural && !plural.oblique
          ? plural.stem + "ين"
          : d &&
              !d.oblique &&
              (d.gender === "f" || /^(?:ال)?(?:م\p{L}{3,}|\p{L}ا\p{L}{2})$/u.test(d.stem))
            ? d.stem + "ين"
            : undefined;
      if (fixed && !/^(?:ال)?مهرج$/u.test(fixed.slice(0, -2)))
        findings.push({
          messageKey: "review_msg_arabic_case_ending",
          range: { start: next.start, end: next.end },
          alternatives: [fixed],
          context: { start: list[i].start, end: next.end },
        });
      continue;
    }
    const jussive = JUSSIVE.test(head);
    if (!jussive && !SUBJUNCTIVE.test(head)) continue;
    // "لِمَ" (why) also opens a question with an indicative verb.
    const sentenceEnd = /[.!؟?\n]/u.exec(ctx.text.slice(next.end, next.end + 200));
    if (sentenceEnd && /[؟?]/u.test(sentenceEnd[0])) continue;
    const five = /^(?<stem>[يت]\p{L}{2,})ون$/u.exec(word);
    if (five) {
      const stem = five.groups!.stem;
      // Singular verbs whose root ends in -ون ("يتكون", "يتعاون") are not plurals.
      if (stem.endsWith("ا") || (stem.length === 3 && stem[1] === "ت")) continue;
      findings.push({
        messageKey: jussive ? "review_msg_arabic_jussive" : "review_msg_arabic_subjunctive",
        range: { start: next.start, end: next.end },
        alternatives: [stem + "وا"],
        context: { start: list[i].start, end: next.end },
      });
      continue;
    }
    if (jussive && /^[يأن]\p{L}+[يوى]$/u.test(word) && word.length >= 3)
      findings.push({
        messageKey: "review_msg_arabic_jussive",
        range: { start: next.start, end: next.end },
        alternatives: [word.slice(0, -1)],
        context: { start: list[i].start, end: next.end },
      });
  }
  return findings;
}

// ------------------------------------------------------- optional style

const ILLA_FAQAT =
  /(?<![\p{L}\p{M}])إلا(?:[ \t\u00a0]+[\p{L}\p{M}]+){1,5}(?<faqat>[ \t\u00a0]+فقط)(?![\p{L}\p{M}])/dgu;
const KULLAMA = /(?<![\p{L}\p{M}])كلما[^.!؟?\n،]{1,80}،[ \t\u00a0]*(?<second>كلما[ \t\u00a0]+)/dgu;
const BAYNA =
  /(?<![\p{L}\p{M}])بين[ \t\u00a0]+(?<first>[\p{L}]+)[ \t\u00a0]+(?<second>وبين[ \t\u00a0]+)(?=\p{L})/dgu;
// A pronoun suffix on the first term: "بيني وبينه" repeats بين as it must.
const PRONOUN_SUFFIX = /(?:ي|ه|ها|هما|هم|هن|ك|كما|كم|كن|نا)$/u;

/**
 * Optional style: "فقط" after إلا, a second كلما, and بين repeated before a
 * second noun ("بين محمد وعلي").
 */
function arabicStyle(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  const scan = (regex: RegExp, each: (m: RegExpExecArray) => Finding | undefined) => {
    regex.lastIndex = Math.max(0, ctx.from - 160);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const finding = each(m);
      if (finding && owns(ctx, finding.range.start)) findings.push(finding);
    }
  };
  const remove = (key: Finding["messageKey"], group: string) => (m: RegExpExecArray) => {
    const [start, end] = m.indices!.groups![group];
    return {
      messageKey: key,
      range: { start, end },
      alternatives: [""],
      context: { start: m.index, end: m.index + m[0].length },
    };
  };
  scan(ILLA_FAQAT, remove("review_msg_style_phrasing", "faqat"));
  scan(KULLAMA, remove("review_msg_style_phrasing", "second"));
  scan(BAYNA, (m) => {
    if (PRONOUN_SUFFIX.test(m.groups!.first) && !m.groups!.first.startsWith("ال")) return;
    const [start, end] = m.indices!.groups!.second;
    return {
      messageKey: "review_msg_style_phrasing",
      range: { start, end },
      alternatives: ["و"],
      context: { start: m.index, end: m.index + m[0].length },
    };
  });
  return findings;
}

const as =
  (ruleId: RawFinding["ruleId"], detect: (ctx: DetectContext, list: Token[]) => Finding[]) =>
  (ctx: DetectContext): RawFinding[] =>
    !ctx.lang.startsWith("ar") || (ctx.rules && !ctx.rules.has(ruleId))
      ? []
      : detect(ctx, tokens(ctx)).map((f) => ({ ruleId, ...f }));

/** Arabic checks appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["arabicAgreement"],
    detect: as("arabicAgreement", (ctx, list) => [
      ...demonstratives(ctx, list),
      ...numbers(ctx, list),
    ]),
  },
  { rules: ["arabicCaseEndings"], detect: as("arabicCaseEndings", caseEndings) },
  { rules: ["arabicDates"], detect: as("arabicDates", (ctx) => arabicDates(ctx)) },
  { rules: ["stylePhrasing"], detect: as("stylePhrasing", (ctx) => arabicStyle(ctx)) },
];
