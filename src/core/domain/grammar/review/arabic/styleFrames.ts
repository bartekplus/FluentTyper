import type { RawFinding } from "../reviewDetectors";

type Finding = Omit<RawFinding, "ruleId">;
export type StyleToken = { word: string; start: number; end: number; gap: string };

/** Two words in a row: only spaces (and a tanwin) between them. */
const adjacent = (token: StyleToken) => /^ً?[ \t ]+$/u.test(token.gap);
const PREPOSITIONS = new Set("في على من إلى عن مع عند لدى حول خلال بين".split(" "));

// ---------------------------------------------------- light verb قام بـ

// قام's forms, and the slot each one fills in a verb's paradigm.
const QAMA = [
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
function conjugate(past: string, present: string, slot: number): string {
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
    const stems = parts && VERBAL_NOUNS.get(parts.groups!.noun);
    if (!stems) continue;
    const after = list[i + 2];
    const next = after && adjacent(after) ? after.word : "";
    const fits = parts!.groups!.article
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

/**
 * "والأدهى من ذلك" -> "وأدهى من ذلك": an elative with ال takes no من of
 * comparison (partitive "الجزء الأكبر من الوقت" after a noun is fine);
 * "المرتبة الأعلى" -> "المرتبة العليا": with ال it agrees with a feminine noun.
 */
function elatives(list: readonly StyleToken[], at: (start: number) => boolean): Finding[] {
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
        alternatives: [m!.groups!.pre + elative],
        context: { start: list[i].start, end: next.end },
      });
      continue;
    }
    // The feminine noun must not close an idafa ("مستوى الجودة الأعلى" is the level's).
    const feminine = FEMININE_ELATIVE.get(elative);
    const noun = /^(?:[وفبلك]{0,2})ال(?<stem>\p{L}{2,}ة)$/u.exec(previous)?.groups!.stem;
    if (!feminine || m!.groups!.pre || !noun || NOT_FEMININE.has(noun)) continue;
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

/** Optional Arabic style frames over the chunk's words. */
export function styleFrames(
  text: string,
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Finding[] {
  return [
    ...lightVerbs(list, at),
    ...andRelatives(text, list, at),
    ...elatives(list, at),
    ...asRole(list, at),
    ...laSiyyama(list, at),
  ];
}
