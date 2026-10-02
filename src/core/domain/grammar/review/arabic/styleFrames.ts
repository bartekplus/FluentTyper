import type { RawFinding } from "../reviewDetectors";

type Finding = Omit<RawFinding, "ruleId">;
export type StyleToken = { word: string; start: number; end: number; gap: string };

/** Two words in a row: only spaces (and a tanwin) between them. */
const adjacent = (token: StyleToken) => /^ً?[ \t ]+$/u.test(token.gap);
const PREPOSITIONS = new Set("في على من إلى عن مع عند لدى حول خلال بين".split(" "));

// ---------------------------------------------------- light verb قام بـ

// قام's forms, and the slot each one fills in a verb's paradigm.
export const QAMA = [
  "قام",
  "قامت",
  "قاموا",
  "قمت",
  "قمنا",
  "قمتم",
  "قمن",
  "يقوم",
  "تقوم",
  "يقومون",
  "تقومون",
  "نقوم",
  "أقوم",
  "يقم",
  "تقم",
  "نقم",
  "أقم",
  "يقوموا",
  "تقوموا",
];
const QAMA_SLOT = new Map(QAMA.map((form, slot) => [form, slot]));
/** A sound verb's form in the slot of QAMA, from its past and imperfect stems. */
export function conjugate(past: string, present: string, slot: number): string {
  const first = present.startsWith("أ") ? "آ" + present.slice(1) : "أ" + present;
  return [
    past,
    past + "ت",
    past + "وا",
    past + "ت",
    past + "نا",
    past + "تم",
    past + "ن",
    "ي" + present,
    "ت" + present,
    "ي" + present + "ون",
    "ت" + present + "ون",
    "ن" + present,
    first,
    "ي" + present,
    "ت" + present,
    "ن" + present,
    first,
    "ي" + present + "وا",
    "ت" + present + "وا",
  ][slot];
}
// Verbal noun -> [past stem, imperfect stem] of a verb with no weak or doubled radical
// in the forms built here.
const VERBAL_NOUNS = new Map<string, readonly [string, string]>([
  ["عمل", ["عمل", "عمل"]],
  ["أكل", ["أكل", "أكل"]],
  ["دراسة", ["درس", "درس"]],
  ["كتابة", ["كتب", "كتب"]],
  ["شرح", ["شرح", "شرح"]],
  ["فحص", ["فحص", "فحص"]],
  ["جمع", ["جمع", "جمع"]],
  ["بحث", ["بحث", "بحث"]],
  ["سؤال", ["سأل", "سأل"]],
  ["تحليل", ["حلل", "حلل"]],
  ["تنظيم", ["نظم", "نظم"]],
  ["تطوير", ["طور", "طور"]],
  ["تصميم", ["صمم", "صمم"]],
  ["تقديم", ["قدم", "قدم"]],
  ["تنفيذ", ["نفذ", "نفذ"]],
  ["تحقيق", ["حقق", "حقق"]],
  ["تغيير", ["غير", "غير"]],
  ["تسجيل", ["سجل", "سجل"]],
  ["تعديل", ["عدل", "عدل"]],
  ["ترجمة", ["ترجم", "ترجم"]],
  ["مراجعة", ["راجع", "راجع"]],
  ["مساعدة", ["ساعد", "ساعد"]],
  ["مناقشة", ["ناقش", "ناقش"]],
  ["متابعة", ["تابع", "تابع"]],
  ["مشاركة", ["شارك", "شارك"]],
  ["إرسال", ["أرسل", "رسل"]],
  ["إصلاح", ["أصلح", "صلح"]],
  ["إعلان", ["أعلن", "علن"]],
  ["إغلاق", ["أغلق", "غلق"]],
  ["إنتاج", ["أنتج", "نتج"]],
  ["استخدام", ["استخدم", "ستخدم"]],
  ["استقبال", ["استقبل", "ستقبل"]],
]);
// Form I verbal nouns used after القيام بـ, with no verb built from them here.
const PLAIN_VERBAL_NOUNS = new Set(
  "ضرب قتل فتح نقل دفع رفع حفظ طبخ غسل رسم كشف زرع قراءة زراعة صناعة".split(" "),
);
const WEAK = /[اويىءئؤأإآ]/u;
/**
 * The verb stems of a derived verbal noun by its pattern: تفعيل -> فعّل,
 * مفاعلة -> فاعل, إفعال -> أفعل, افتعال -> افتعل, انفعال -> انفعل, استفعال ->
 * استفعل, تفاعل -> تفاعل. Weak radicals change these patterns: skipped.
 */
function derivedStems(noun: string): readonly [string, string] | undefined {
  const known = VERBAL_NOUNS.get(noun);
  if (known) return known;
  const sound = (...letters: string[]) => letters.every((letter) => !WEAK.test(letter));
  let m: RegExpExecArray | null;
  if ((m = /^است(\p{L})(\p{L})ا(\p{L})$/u.exec(noun)) && sound(m[2], m[3]))
    return [`است${m[1]}${m[2]}${m[3]}`, `ست${m[1]}${m[2]}${m[3]}`];
  if ((m = /^ان(\p{L})(\p{L})ا(\p{L})$/u.exec(noun)) && sound(m[1], m[2], m[3]))
    return [`ان${m[1]}${m[2]}${m[3]}`, `ن${m[1]}${m[2]}${m[3]}`];
  if ((m = /^ا(\p{L})ت(\p{L})ا(\p{L})$/u.exec(noun)) && sound(m[1], m[2], m[3]))
    return [`ا${m[1]}ت${m[2]}${m[3]}`, `${m[1]}ت${m[2]}${m[3]}`];
  if ((m = /^إ(\p{L})(\p{L})ا(\p{L})$/u.exec(noun)) && sound(m[1], m[2], m[3]))
    return [`أ${m[1]}${m[2]}${m[3]}`, `${m[1]}${m[2]}${m[3]}`];
  if ((m = /^ت(\p{L})(\p{L})ي(\p{L})$/u.exec(noun)) && sound(m[2], m[3]))
    return [`${m[1]}${m[2]}${m[3]}`, `${m[1]}${m[2]}${m[3]}`];
  if ((m = /^م(\p{L})ا(\p{L})(\p{L})ة$/u.exec(noun)) && sound(m[1], m[2], m[3]))
    return [`${m[1]}ا${m[2]}${m[3]}`, `${m[1]}ا${m[2]}${m[3]}`];
  if ((m = /^ت(\p{L})ا(\p{L})(\p{L})$/u.exec(noun)) && sound(m[1], m[2], m[3]))
    return [`ت${m[1]}ا${m[2]}${m[3]}`, `ت${m[1]}ا${m[2]}${m[3]}`];
}
const QAMA_WORD = /^(?<pre>[وف]?)(?<future>س?)(?<verb>\p{L}+)$/u;

/**
 * "قام بدراسة الملف" -> "درس الملف": the light verb قام بـ + verbal noun says
 * what the verb alone says. Only when the noun has its object after it (a
 * definite genitive) or, with the article, a preposition or the clause end:
 * an adjective on the noun ("بزيارة رسمية") has no place on the verb.
 */
function lightVerbs(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const m = QAMA_WORD.exec(list[i].word);
    const slot = m && QAMA_SLOT.get(m.groups!.verb);
    if (slot === undefined || slot === null || !at(list[i].start)) continue;
    if (m!.groups!.future && slot < 7) continue;
    const noun = list[i + 1];
    if (!adjacent(noun)) continue;
    const parts = /^ب(?<article>ال)?(?<noun>\p{L}+)$/u.exec(noun.word);
    const stems = parts && derivedStems(parts.groups!.noun);
    if (!stems) continue;
    const after = list[i + 2];
    const next = after && adjacent(after) ? after.word : "";
    const fits = parts.groups!.article
      ? next === "" || PREPOSITIONS.has(next)
      : next.startsWith("ال");
    if (!fits) continue;
    const { pre, future } = m!.groups!;
    findings.push({
      messageKey: "review_msg_style_phrasing",
      range: { start: list[i].start, end: noun.end },
      alternatives: [pre + future + conjugate(stems[0], stems[1], slot)],
      context: { start: list[i].start, end: after?.end ?? noun.end },
    });
  }
  return findings;
}

// ------------------------------------------------- and + relative pronoun

const RELATIVE = /^(?:الذي|التي|الذين|اللذان|اللتان|اللذين|اللتين|اللواتي|اللاتي)$/u;

/**
 * "السياسة الجديدة والتي ستطبق" -> "التي": a relative pronoun right after its
 * antecedent takes no "و" (a calque of ", which"). A second relative clause
 * joined to a first one keeps it.
 */
function andRelatives(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 1; i < list.length; i++) {
    const word = list[i].word;
    if (!word.startsWith("و") || !RELATIVE.test(word.slice(1)) || !at(list[i].start)) continue;
    if (!/^،?[ \t ]*$/u.test(list[i].gap) || !/^(?:[وفبلك]{0,2})ال/u.test(list[i - 1].word))
      continue;
    const sentence = text.slice(Math.max(0, list[i].start - 200), list[i].start);
    const clause = sentence.slice(sentence.search(/[^.!؟?\n]*$/u));
    if (
      /(?<![\p{L}])(?:و)?(?:الذي|التي|الذين|اللذان|اللتان|اللواتي|اللاتي)(?![\p{L}])/u.test(clause)
    )
      continue;
    findings.push({
      messageKey: "review_msg_style_phrasing",
      range: { start: list[i].start, end: list[i].start + 1 },
      alternatives: [""],
      context: { start: list[i - 1].start, end: list[i].end },
    });
  }
  return findings;
}

// ---------------------------------------------------------- elatives

const ELATIVES = new Set(
  (
    "أكبر أصغر أفضل أحسن أسوأ أكثر أقل أشد أعظم أهم أعلى أدنى أقوى أضعف أطول أقصر " +
    "أسرع أقرب أبعد أغنى أفقر أجمل أقدم أحدث أوسع أضيق أدهى أعجب أخطر أصعب أسهل " +
    "أعمق أثقل أخف أغلى أرخص أذكى أبرز أنسب"
  ).split(" "),
);
// Feminine elatives: "المرتبة العليا", "الحرب الكبرى".
const FEMININE_ELATIVE = new Map([
  ["أعلى", "عليا"],
  ["أدنى", "دنيا"],
  ["أكبر", "كبرى"],
  ["أصغر", "صغرى"],
  ["أفضل", "فضلى"],
  ["أعظم", "عظمى"],
  ["أقصى", "قصوى"],
  ["أوسط", "وسطى"],
  ["أحسن", "حسنى"],
]);
const NOT_FEMININE = new Set("خليفة علامة رحالة داعية نابغة".split(" "));
// A definite plural of things on فعائل/مفاعل/فواعل ("النتائج", "المدارس", "الشوارع"):
// it agrees as a feminine singular ("النتائج الفضلى"). Not a nisba ("الصحافي").
const BROKEN_PLURAL = /^(?:[وفبلك]{0,2})ال\p{L}{2}ا\p{L}(?!ي)\p{L}$/u;
// أفعال ("الأعداد", "الأطفال"): things or people.
const PLURAL_AF3AL = /^(?:[وفبلك]{0,2})الأ\p{L}{2}ا\p{L}$/u;

/**
 * "والأدهى من ذلك" -> "وأدهى من ذلك": an elative with ال takes no من of
 * comparison (partitive "الجزء الأكبر من الوقت" after a noun is fine);
 * "المرتبة الأعلى" -> "المرتبة العليا": with ال it agrees with a feminine noun.
 */
function elatives(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = /^(?<pre>[وف]?)ال(?<elative>\p{L}+)$/u.exec(list[i].word);
    const elative = m?.groups!.elative;
    if (!elative || !(ELATIVES.has(elative) || FEMININE_ELATIVE.has(elative))) continue;
    if (!at(list[i].start)) continue;
    const previous = i > 0 && adjacent(list[i]) ? list[i - 1].word : "";
    const next = list[i + 1];
    const afterMin = list[i + 2]?.word ?? "";
    if (
      ELATIVES.has(elative) &&
      next?.word === "من" &&
      adjacent(next) &&
      !/^(?:[وفبلك]{0,2})ال/u.test(previous) &&
      !/^(?:بين|بينها|بينهم|نوعه|نوعها|نوعهم)$/u.test(afterMin)
    ) {
      findings.push({
        messageKey: "review_msg_style_phrasing",
        range: { start: list[i].start, end: list[i].end },
        alternatives: [m.groups!.pre + elative],
        context: { start: list[i].start, end: next.end },
      });
      continue;
    }
    // "الأعداد الأكبر من 10": a number after من compares, it is no part.
    if (
      ELATIVES.has(elative) &&
      next?.word === "من" &&
      adjacent(next) &&
      !m.groups!.pre &&
      /^[ \t\u00a0]+[0-9٠-٩]/u.test(text.slice(next.end, next.end + 8))
    ) {
      // Only after a plural: "الجزء الأكبر من 2020" is a part of the year.
      const people = PLURAL_AF3AL.test(previous);
      if (
        people ||
        /^(?:[وفبلك]{0,2})ال\p{L}{2,}ات$/u.test(previous) ||
        BROKEN_PLURAL.test(previous)
      ) {
        findings.push({
          messageKey: "review_msg_style_phrasing",
          range: { start: list[i].start, end: list[i].end },
          // أفعال may name people: "الأطفال الذين هم أكبر من عشر سنين".
          alternatives: [`التي هي ${elative}`, ...(people ? [`الذين هم ${elative}`] : [])],
          ...(people ? { requiresChoice: true as const } : {}),
          context: { start: list[i].start, end: next.end },
        });
        continue;
      }
    }
    // The feminine noun must not close an idafa ("مستوى الجودة الأعلى" is the level's).
    const feminine = FEMININE_ELATIVE.get(elative);
    // "هي الأكبر بين القارات" -> "هي الكبرى".
    if (feminine && !m.groups!.pre && previous === "هي") {
      findings.push({
        messageKey: "review_msg_style_phrasing",
        range: { start: list[i].start, end: list[i].end },
        alternatives: ["ال" + feminine],
      });
      continue;
    }
    const noun =
      /^(?:[وفبلك]{0,2})ال(?<stem>\p{L}{2,}ة)$/u.exec(previous)?.groups!.stem ??
      (BROKEN_PLURAL.test(previous) ? previous : undefined);
    if (!feminine || m.groups!.pre || !noun || NOT_FEMININE.has(noun)) continue;
    const before = i > 1 && adjacent(list[i - 1]) ? list[i - 2].word : "";
    if (before && !PREPOSITIONS.has(before) && !/^(?:[وفبلك]{0,2})ال/u.test(before)) continue;
    findings.push({
      messageKey: "review_msg_style_phrasing",
      range: { start: list[i].start, end: list[i].end },
      alternatives: ["ال" + feminine],
      context: { start: list[i - 1].start, end: list[i].end },
    });
  }
  return findings;
}

// -------------------------------------------------------- كـ for "as"

const WORK = /^[وف]?(?:عمل|عملت|عملوا|يعمل|تعمل|يعملون|نعمل|أعمل|اشتغل|اشتغلت|يشتغل|تشتغل)$/u;

/** "يعمل كمدير" -> "يعمل بصفة مدير": كـ compares; a role is بصفة. */
function asRole(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    if (!WORK.test(list[i].word)) continue;
    for (const j of [i + 1, i + 2]) {
      const role = list[j];
      if (!role || !adjacent(role)) break;
      const m = /^ك(?<role>(?!ال)\p{L}{3,})$/u.exec(role.word);
      if (m && at(role.start)) {
        findings.push({
          messageKey: "review_msg_style_phrasing",
          range: { start: role.start, end: role.start + 1 },
          alternatives: ["بصفة "],
          context: { start: list[i].start, end: role.end },
        });
        break;
      }
      if (role.word.startsWith("ك")) break;
    }
  }
  return findings;
}

/** "سيما الراتب" -> "لا سيما الراتب": سيّما is not used without لا. */
function laSiyyama(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  return list.flatMap((token, i): Finding[] => {
    if (!/^[وف]?سيما$/u.test(token.word) || !at(token.start)) return [];
    if (i > 0 && adjacent(token) && /^[وف]?لا$/u.test(list[i - 1].word)) return [];
    const start = token.end - 4;
    return [
      {
        messageKey: "review_msg_style_phrasing",
        range: { start, end: token.end },
        alternatives: ["لا سيما"],
        context: { start: token.start, end: token.end },
      },
    ];
  });
}

/** "ل" + a word: "الكتاب" -> "للكتاب", "اللغة" -> "للغة". */
const withLam = (word: string) =>
  word.startsWith("الل")
    ? "ل" + word.slice(2)
    : word.startsWith("ال")
      ? "ل" + word.slice(1)
      : "ل" + word;
const style = (start: number, end: number, fixed: string): Finding => ({
  messageKey: "review_msg_style_phrasing",
  range: { start, end },
  alternatives: [fixed],
});

/**
 * "القيام بدراسة الملف" -> "دراسة الملف": the verbal noun alone names the act.
 * Only for a noun that is itself a verbal noun ("القيام بالواجب" keeps its verb).
 */
function doingTheAct(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const m = /^(?<conj>[وف]?)(?<prep>بال|لل|ال)قيام$/u.exec(list[i].word);
    const act = list[i + 1];
    const parts = /^ب(?<article>ال)?(?<noun>\p{L}{3,})$/u.exec(act.word);
    if (!m || !parts || !adjacent(act) || !at(list[i].start)) continue;
    const noun = parts.groups!.noun;
    if (!derivedStems(noun) && !PLAIN_VERBAL_NOUNS.has(noun)) continue;
    const phrase = (parts.groups!.article ?? "") + noun;
    const { conj, prep } = m.groups!;
    const fixed = prep === "بال" ? "ب" + phrase : prep === "لل" ? withLam(phrase) : phrase;
    findings.push(style(list[i].start, act.end, conj + fixed));
  }
  return findings;
}

// "بشكل كبير" -> "كثيرا": adverbs for the commonest adjectives.
const ADVERBS = new Map([
  ["عام", "عموما"],
  ["خاص", "خصوصا"],
  ["كبير", "كثيرا"],
  ["جيد", "جيدا"],
  ["قوي", "بقوة"],
  ["سريع", "بسرعة"],
  ["دائم", "دائما"],
  ["مستمر", "باستمرار"],
  ["مباشر", "مباشرة"],
  ["واضح", "بوضوح"],
  ["كامل", "كاملا"],
]);
// Adjective shapes: participles (م-), فاعل, فعيل, فعول.
const ADJECTIVE = /^(?:م\p{L}{3,}|\p{L}ا\p{L}{2}|\p{L}{2}[يو]\p{L})$/u;

/**
 * "بشكل مناسب" -> "على نحو مناسب", "بصورة يومية" -> "يوميا", "بأسلوب عام" ->
 * "عموما": a calque of "in a ... way"; a relational adjective makes an adverb,
 * others take على نحو.
 */
function inAWay(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const m = /^(?<pre>[وف]?)ب(?<way>شكل|صورة|أسلوب|طريقة)$/u.exec(list[i].word);
    const next = list[i + 1];
    if (!m || !adjacent(next) || !at(list[i].start)) continue;
    let adjective = next.word;
    if (m.groups!.way.endsWith("ة")) {
      if (!adjective.endsWith("ة")) continue;
      adjective = adjective.slice(0, -1);
    } else if (adjective.endsWith("ة")) continue;
    if (adjective.startsWith("ال")) continue;
    const fixed =
      ADVERBS.get(adjective) ??
      (/^\p{L}{2,}ي$/u.test(adjective)
        ? adjective + "ا"
        : ADJECTIVE.test(adjective)
          ? `على نحو ${adjective}`
          : undefined);
    if (fixed) findings.push(style(list[i].start, next.end, m.groups!.pre + fixed));
  }
  return findings;
}

// Durations and their accusative: "لأيام" -> "أياما".
const DURATIONS = new Map<string, string>([
  ...(
    "ساعة ساعات ساعتين يومين أسابيع أسبوعين شهرين سنة سنوات سنين سنتين عامين دقيقة دقائق " +
    "دقيقتين فترة مدة لحظة لحظات"
  )
    .split(" ")
    .map((word): [string, string] => [word, word]),
  ...["يوم", "أيام", "أسبوع", "شهر", "أشهر", "شهور", "عام", "أعوام", "قرن", "قرون"].map(
    (word): [string, string] => [word, word + "ا"],
  ),
]);
const SINGULAR_DURATION = /^(?:ساعة|يوم|أسبوع|شهر|سنة|عام|دقيقة|لحظة|قرن)$/u;
const DURATION_ADJECTIVE = /^(?:واحد|واحدة|كامل|كاملة|طويل|طويلة|قصير|قصيرة|أو)$/u;
/** A finite verb by its shape: a past with a subject ending, or an imperfect. */
const VERB_LIKE = /^[وف]?(?:س?[يتنأ]\p{L}{2,}(?:ون)?|\p{L}{2,}(?<!ا)(?:ت|تم|نا|وا))$/u;

/**
 * "عملت لساعات" -> "عملت ساعات": a duration after a verb is an adverb in the
 * accusative, with no لـ. Not after a noun ("خطة لعامين"), nor before a genitive
 * ("ليوم الجمعة").
 */
function forADuration(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 1; i < list.length; i++) {
    const m = /^(?<pre>[وف]?)ل(?<noun>\p{L}+)$/u.exec(list[i].word);
    const fixed = m && DURATIONS.get(m.groups!.noun);
    if (!fixed || !adjacent(list[i]) || !at(list[i].start)) continue;
    const next = list[i + 1] && adjacent(list[i + 1]) ? list[i + 1].word : "";
    if (next.startsWith("ال")) continue;
    if (SINGULAR_DURATION.test(m.groups!.noun) && next && !DURATION_ADJECTIVE.test(next)) continue;
    const previous = list[i - 1].word;
    const verb =
      (VERB_LIKE.test(previous) && !previous.endsWith("ة")) ||
      (/^ال\p{L}+$/u.test(previous) &&
        i > 1 &&
        adjacent(list[i - 1]) &&
        VERB_LIKE.test(list[i - 2].word));
    if (verb) findings.push(style(list[i].start, list[i].end, m.groups!.pre + fixed));
  }
  return findings;
}

const NOT_LAM_PREPOSITION =
  /^(?:لا|لم|لن|لكن\p{L}*|لكي|لدى|لدي\p{L}*|لأن\p{L}*|لما|لقد|لعل|لو|ليس\p{L}*|ليت|لذلك|لهذا|لهذه|لي)$/u;
const MA_PRONOUNS = new Map([
  ["معه", "به"],
  ["معها", "بها"],
  ["معهم", "بهم"],
  ["معي", "بي"],
  ["معنا", "بنا"],
  ["معك", "بك"],
  ["معكم", "بكم"],
]);
const LI_PRONOUNS = new Map([
  ["له", "فيه"],
  ["لها", "فيها"],
  ["لهم", "فيهم"],
]);
const WISH = /^[وفبل]?(?:ال|لل)?رغب(?:ة|ات|ته|تها|تهم|تي|تنا|تك|تكم)$/u;
const RELATION = /^[وفبل]?(?:ال|لل)?علاق(?:ة|ات|ته|تها|تهم|تي|تنا|تك|تكم|اته|اتها|اتهم|اتنا)$/u;

/**
 * Prepositions after nouns: a wish is "في" ("رغبة في الكتابة"), a relation
 * "بـ" ("علاقة بابنه"), caution "لـ" ("تحسبا لكل طارئ"). One feminine adjective
 * may stand between the noun and its preposition ("رغبة شديدة لـ").
 */
function nounPrepositions(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  const push = (start: number, end: number, fixed: string) => {
    if (at(start)) findings.push(style(start, end, fixed));
  };
  for (let i = 0; i + 2 < list.length; i++) {
    const head = list[i].word;
    let j = i + 1;
    if (!adjacent(list[j])) continue;
    // A feminine adjective between: "رغبة شديدة لـ", "علاقة وثيقة مع".
    if (/^[^ل]\p{L}{2,}ة$/u.test(list[j].word) && adjacent(list[j + 1])) j++;
    const word = list[j].word;
    if (WISH.test(head)) {
      if (!/^ل\p{L}{2,}$/u.test(word) || NOT_LAM_PREPOSITION.test(word)) continue;
      push(
        list[j].start,
        list[j].end,
        LI_PRONOUNS.get(word) ??
          (word.startsWith("لل") ? "في ال" + word.slice(2) : "في " + word.slice(1)),
      );
    } else if (RELATION.test(head)) {
      const pronoun = MA_PRONOUNS.get(word);
      if (pronoun) push(list[j].start, list[j].end, pronoun);
      else if (word === "مع" && list[j + 1] && adjacent(list[j + 1]))
        push(list[j].start, list[j + 1].end, "ب" + list[j + 1].word);
    } else if (/^و?تحسبا$/u.test(head) && list[i + 1].word === "من" && adjacent(list[i + 2])) {
      push(list[i + 1].start, list[i + 2].end, withLam(list[i + 2].word));
    }
  }
  return findings;
}

const SEPARATE_PREPOSITIONS = new Set("على في من إلى عن مع".split(" "));
// "غير بالغ" (not adult), "غير بالضرورة" (not necessarily): adverbs, not an object.
const NOT_AFTER_GHAYR = /^بال(?:غ|ضرورة|كامل|مرة|تأكيد|طبع)/u;
/**
 * "لا تستعن سوى بالله" -> "بسوى الله", "غير بالله" -> "بغير الله": the preposition goes
 * before the word of exception (for غير only بـ: "غير بالغ" is "not adult").
 */
function exceptPreposition(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const word = list[i].word;
    if ((word !== "سوى" && word !== "غير") || !adjacent(list[i + 1]) || !at(list[i].start))
      continue;
    const next = list[i + 1].word;
    const attached = /^(?<p>[بل])(?<rest>ال\p{L}{2,})$/u.exec(
      next.startsWith("لل") ? "لال" + next.slice(2) : next,
    );
    if (word === "غير" && (attached?.groups!.p !== "ب" || NOT_AFTER_GHAYR.test(next))) continue;
    const fixed = SEPARATE_PREPOSITIONS.has(next)
      ? `${next} ${word}`
      : attached && `${attached.groups!.p}${word} ${attached.groups!.rest}`;
    if (fixed) findings.push(style(list[i].start, list[i + 1].end, fixed));
  }
  return findings;
}

const CLAUSE_BREAK = /[.،,؛;!؟?:\n]/u;
const STILL = /^(?:زال|زلت|زالت|زلنا|زالوا|دام|دمت|برح|انفك)$/u;
/**
 * "لم أره أبدا" -> "لم أره قط": أبدًا is for the future, قطّ for the past;
 * "أثناء العمل" -> "في أثناء العمل".
 */
function timeAdverbs(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < list.length; i++) {
    const word = list[i].word;
    if (word === "أبدا" && at(list[i].start)) {
      for (let k = i - 1; k >= 0 && k >= i - 5; k--) {
        if (CLAUSE_BREAK.test(list[k + 1].gap) || /^[وف]?(?:لن|لا)$/u.test(list[k].word)) break;
        const past =
          list[k].word === "لم" || (list[k].word === "ما" && !STILL.test(list[k + 1].word));
        if (!past) continue;
        const end = list[i].end + (text[list[i].end] === "ً" ? 1 : 0);
        findings.push(style(list[i].start, end, "قط"));
        break;
      }
    }
    const during = /^(?<pre>[وف]?)أثناء$/u.exec(word);
    if (!during || !at(list[i].start)) continue;
    const before = i > 0 && !CLAUSE_BREAK.test(list[i].gap) ? list[i - 1].word : "";
    if (!/^[وف]?(?:في|من)$/u.test(before))
      findings.push(style(list[i].start, list[i].end, during.groups!.pre + "في أثناء"));
  }
  return findings;
}

/**
 * "الجهاز عبارة عن صندوق" -> "الجهاز صندوق": عبارة عن adds nothing to the
 * predicate. After هو/هي the table rows keep the pronoun.
 */
function amountsTo(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 2 < list.length; i++) {
    if (list[i].word !== "عبارة" || list[i + 1].word !== "عن" || !adjacent(list[i + 1])) continue;
    if (!adjacent(list[i + 2]) || !at(list[i].start)) continue;
    if (i > 0 && /^(?:هو|هي|هم)$/u.test(list[i - 1].word)) continue;
    findings.push(style(list[i].start, list[i + 2].start, ""));
  }
  return findings;
}

/** "فأما أن تحفظه وأما أن تضيعه" -> "فإما ... وإما": the choice is إمّا. */
function eitherOr(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const first = /^(?<pre>[وف]?)أما$/u.exec(list[i].word);
    if (!first || list[i + 1].word !== "أن" || !adjacent(list[i + 1])) continue;
    for (let k = i + 2; k + 1 < list.length && k < i + 14; k++) {
      if (/[.!؟?\n]/u.test(list[k].gap)) break;
      if (list[k].word !== "وأما" || list[k + 1].word !== "أن") continue;
      if (at(list[i].start))
        findings.push(style(list[i].start, list[i].end, first.groups!.pre + "إما"));
      if (at(list[k].start)) findings.push(style(list[k].start, list[k].end, "وإما"));
      break;
    }
  }
  return findings;
}

// هامّ is "worrying": an important matter is مهمّ. A bare هام is also "wandered",
// so only as a predicate closing the clause ("الأمر هام", "القرار هام جدا").
const HAMM = /^(?<pre>[وف]?)هام(?<f>ة?)$/u;

function important(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 1; i < list.length; i++) {
    const m = HAMM.exec(list[i].word);
    if (!m || !adjacent(list[i]) || !/^[وف]?ال\p{L}{2,}$/u.test(list[i - 1].word)) continue;
    const next = list[i + 1];
    const closes =
      !next ||
      CLAUSE_BREAK.test(text.slice(list[i].end, next.start)) ||
      /^(?:جدا|للغاية|لنا|لي|لك|لكم|له|لها|لهم)$/u.test(next.word);
    if (closes && at(list[i].start))
      findings.push(style(list[i].start, list[i].end, `${m.groups!.pre}مهم${m.groups!.f}`));
  }
  return findings;
}

// Verbs that take their objects directly: "أعطى صاحبه كتابا", "كلفه العمل" (not the bare
// "أصحبه", also "I accompany him").
const DIRECT_LI = /^[وف]?(?:أعطى|أعطت|أعطوا|يعطي|تعطي|يعطون|نعطي)$/u;
const DIRECT_BI =
  /^[وف]?(?:كلف|كلفت|كلفوا|يكلف|تكلف|يكلفون|غرم|غرمت|يغرم|أصحبت|أصحبوا)(?:ه|ها|هم|ني|نا|ك|كم)$/u;
const BI_PRONOUN = new Map([
  ["به", "إياه"],
  ["بها", "إياها"],
  ["بهم", "إياهم"],
]);

// One trades in (في) goods. Not the bare "تاجر", also "a merchant".
const TRADE = /^[وف]?(?:تاجرت|تاجروا|يتاجر|تتاجر|يتاجرون|نتاجر|أتاجر)$/u;

/**
 * "أعطى لصاحبه كتابا" -> "أعطى صاحبه", "كلفه بالعمل" -> "كلفه العمل", "كلفه به" ->
 * "كلفه إياه".
 */
function directObjects(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const object = list[i + 1];
    if (!adjacent(object) || !at(object.start)) continue;
    const li = DIRECT_LI.test(list[i].word) && /^ل\p{L}{3,}$/u.exec(object.word);
    if (li && !NOT_LAM_PREPOSITION.test(object.word)) {
      const word = object.word;
      findings.push(
        style(
          object.start,
          object.end,
          word.startsWith("لل") ? "ال" + word.slice(2) : word.slice(1),
        ),
      );
      continue;
    }
    if (DIRECT_BI.test(list[i].word) && /^ب(?:ال\p{L}{2,}|\p{L}{3,}ة)$/u.test(object.word))
      findings.push(style(object.start, object.end, object.word.slice(1)));
    else if (DIRECT_BI.test(list[i].word) && BI_PRONOUN.has(object.word))
      findings.push(style(object.start, object.end, BI_PRONOUN.get(object.word)!));
    else if (TRADE.test(list[i].word) && /^ب\p{L}{3,}$/u.test(object.word))
      findings.push(style(object.start, object.end, "في " + object.word.slice(1)));
  }
  return findings;
}

// Verbs of mutual fit: "يتناسب مع رأيه" (or "يتناسب هو ورأيه"), not "يتناسب ورأيه".
const MUTUAL =
  /^[وف]?(?:[يت](?:تناسب|تنافى|تلاءم|تلائم|تعارض|تناقض|تطابق|توافق|تكامل|تساوى)(?:ون|ان)?|تناسبت|تنافت|تعارضت|تناقضت|تطابقت|توافقت)$/u;
// Words whose own first letter is و: "لا يتناسب وضعه مع دخله" (his situation).
const WAW_ROOT =
  /^و(?:ال)?(?:ضع|قت|جه|جو|زن|صف|ظيف|عد|اقع|سع|طن|حد|لد|قع|سائل|سيل|ثيق|صول|قوف|جب|عي|زير|زار|رق|رد|فق|فر|سط|حش|هم|راث|ريث|صي)/u;

/** "يتناسب ورأيه" -> "يتناسب مع رأيه": with no pronoun between, the partner takes مع. */
function mutualWaw(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const partner = list[i + 1];
    if (!MUTUAL.test(list[i].word) || !adjacent(partner) || !at(partner.start)) continue;
    const m = /^و(?<rest>\p{L}{2,})$/u.exec(partner.word);
    if (!m || WAW_ROOT.test(partner.word)) continue;
    // "لا يتناسب ... مع": the partner comes later, this is the subject.
    if (list.slice(i + 2, i + 5).some((token) => /^مع\p{L}*$/u.test(token.word))) continue;
    findings.push(style(partner.start, partner.end, `مع ${m.groups!.rest}`));
  }
  return findings;
}

const NEGATION = /^[وف]?(?:ما|لا|لم|لن|ليس|ليست)$/u;
// After و, a word that is no verb: a pronoun, قد of a state, a preposition with a pronoun,
// or a verb whose root starts with و ("إلا وجدته").
const NOT_AFTER_ILLA_WAW =
  /^و(?:هو|هي|هم|هن|أنا|نحن|أنت|أنتم|قد|لكن|لا|في\p{L}*|ل(?:ه|ها|هم|هما|نا|ي|ك|كم)|ب(?:ه|ها|هم)|علي\p{L}*|من\p{L}*|عند\p{L}*|مع\p{L}*|ال\p{L}*)$|^و(?:جد|صل|قع|ضع|قف|لد|عد|جب|ثق|رد|سع|هب|زن|فى|كل|دع|صف|لي|عى|قى|رث)/u;

/** "ما تحدث إلا وقال خيرا" -> "إلا قال": after an exception the verb takes no و. */
function exceptAnd(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 1; i + 1 < list.length; i++) {
    const verb = list[i + 1];
    if (list[i].word !== "إلا" || !adjacent(verb) || !at(verb.start)) continue;
    if (!/^و\p{L}{3,6}$/u.test(verb.word) || NOT_AFTER_ILLA_WAW.test(verb.word)) continue;
    let negated = false;
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      if (CLAUSE_BREAK.test(text.slice(list[j].end, list[j + 1].start))) break;
      if (NEGATION.test(list[j].word)) {
        negated = true;
        break;
      }
    }
    if (negated) findings.push(style(verb.start, verb.start + 1, ""));
  }
  return findings;
}

/** "نحن كمعلمين" -> "نحن المعلمين": "we, the teachers" is the specifying accusative. */
function weAs(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const group = list[i + 1];
    if (!/^[وف]?نحن$/u.test(list[i].word) || !adjacent(group) || !at(group.start)) continue;
    const m = /^ك(?<who>م\p{L}{3,}(?:ين|ون)|عرب|بشر)$/u.exec(group.word);
    if (m) findings.push(style(group.start, group.end, "ال" + m.groups!.who));
  }
  return findings;
}

/** "بين ما كنت عائدا" at a sentence start -> "بينما" (while), not "between what". */
function whileJoined(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i + 2 < list.length; i++) {
    if (list[i].word !== "بين" || list[i + 1].word !== "ما" || !adjacent(list[i + 1])) continue;
    const from = Math.max(0, list[i].start - 40);
    const lead = text.slice(from, list[i].start);
    if (!/(?:[.!؟?\n]|^)[^\p{L}\p{N}]*$/u.test(lead) || (from > 0 && !/[.!؟?\n]/u.test(lead)))
      continue;
    if (!/^(?:كان|كانت|كنت|كنا|كانوا|كنتم)$/u.test(list[i + 2].word)) continue;
    // "بين ما كان وما سيكون": between the two.
    const clause = list.slice(i + 3, i + 10);
    const end = clause.findIndex((token) => CLAUSE_BREAK.test(token.gap));
    if ((end < 0 ? clause : clause.slice(0, end)).some((token) => token.word === "وما")) continue;
    if (at(list[i].start)) findings.push(style(list[i].start, list[i + 1].end, "بينما"));
  }
  return findings;
}

/** Optional Arabic style frames over the chunk's words. */
export function styleFrames(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  return [
    ...lightVerbs(list, at),
    ...andRelatives(text, list, at),
    ...elatives(text, list, at),
    ...asRole(list, at),
    ...laSiyyama(list, at),
    ...doingTheAct(list, at),
    ...inAWay(list, at),
    ...forADuration(list, at),
    ...nounPrepositions(list, at),
    ...exceptPreposition(list, at),
    ...timeAdverbs(text, list, at),
    ...eitherOr(list, at),
    ...important(text, list, at),
    ...directObjects(list, at),
    ...amountsTo(list, at),
    ...mutualWaw(list, at),
    ...exceptAnd(text, list, at),
    ...weAs(list, at),
    ...whileJoined(text, list, at),
  ];
}
