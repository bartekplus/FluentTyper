import type { PhraseRow } from "../englishPhraseTables";
import type { LanguagePhraseTables } from "../languagePhraseTables";

// Misspellings that are never words. A leading و or ف is matched too ("ولاكن").
const WORDS: readonly PhraseRow[] = [
  ["لاكن", "لكن"],
  ["هاذا", "هذا"],
  ["هاذه", "هذه"],
  ["هاذان", "هذان"],
  ["ذالك", "ذلك"],
  ["هاكذا", "هكذا"],
  [["إنشاء الله", "انشاء الله", "إنشالله", "انشالله", "إنشاالله"], "إن شاء الله"],
];

// A doubled future particle and a misspelled idiom.
const PHRASES: readonly PhraseRow[] = [
  ["سوف لن", "لن"],
  [["على حدى", "على حده"], "على حدة"],
];

/** Speech and belief verbs take أنّ (قال: إنّ) directly, not بأنّ. */
function withoutBi(): PhraseRow[] {
  const verbs: ReadonlyArray<readonly [string[], string]> = [
    [["قال", "قالت", "قالوا", "يقول", "تقول", "يقولون"], "إن"],
    [["ذكر", "ذكرت", "ذكروا", "يذكر", "تذكر", "يذكرون"], "أن"],
    [["زعم", "زعمت", "زعموا", "يزعم", "تزعم", "يزعمون"], "أن"],
    [["أكد", "أكدت", "أكدوا", "يؤكد", "تؤكد", "يؤكدون"], "أن"],
    [["أعلن", "أعلنت", "أعلنوا", "يعلن", "تعلن", "يعلنون"], "أن"],
    [["اعتقد", "اعتقدت", "اعتقدوا", "يعتقد", "تعتقد", "يعتقدون"], "أن"],
    [["أقسم", "أقسمت", "أقسموا", "يقسم", "تقسم", "يقسمون"], "أن"],
  ];
  const endings = ["", "ه", "ها", "هم", "ني", "نا"];
  return verbs.flatMap(([forms, particle]) =>
    forms.flatMap((verb) =>
      endings.map((ending): PhraseRow => [`${verb} بأن${ending}`, `${verb} ${particle}${ending}`]),
    ),
  );
}

const DECADES = [
  "العشرين",
  "الثلاثين",
  "الأربعين",
  "الخمسين",
  "الستين",
  "السبعين",
  "الثمانين",
  "التسعين",
];

// Optional usage advice in the tradition of "say, don't say": modern forms that
// careful writers replace. Both are understood; none is a spelling error.
const STYLE: readonly PhraseRow[] = [
  ...withoutBi(),
  // ما and مَن merge with عن and من; left optional, as some writers keep them apart.
  ["عن ما", "عما"],
  ["من ما", "مما"],
  ["عن من", "عمن"],
  ...["ه", "ها", "هم", "ي", "ك", "نا"].map((ending): PhraseRow => [
    `لوحد${ending}`,
    `وحد${ending}`,
  ]),
  [["إمكانيات", "امكانيات"], "إمكانات"],
  ["الإمكانيات", "الإمكانات"],
  ["يتواجد", "يوجد"],
  ["تتواجد", "توجد"],
  ["يتواجدون", "يوجدون"],
  ["التواجد", "الوجود"],
  ["السواح", "السياح"],
  ["سواح", "سياح"],
  [["غسيل الأموال", "غسيل أموال"], "غسل الأموال"],
  ["ملفت للنظر", "لافت للنظر"],
  ["ملفتة للنظر", "لافتة للنظر"],
  ["لأول وهلة", "أول وهلة"],
  ...DECADES.map((tens): PhraseRow => [`${tens}ات`, `${tens}يات`]),
  ["الأخصائي", "الاختصاصي"],
  ["أخصائي", "اختصاصي"],
  ["لصالح", "لمصلحة"],
  ["يتوجب", "يجب"],
  ["الآنف الذكر", "المذكور آنفا"],
  ["نوه إلى", "أشار إلى"],
  ["نفس الشيء", "الشيء نفسه"],
  ["هل لم", "ألم"],
  ["لا يجب أن", "يجب ألا"],
  ["عدا عن", "عدا"],
  ["على أهبة الاستعداد", "على أهبة"],
  [["لابد وأن", "لا بد وأن"], "لا بد أن"],
  ["كما وأن", "كما أن"],
  ["حتى أنه", "حتى إنه"],
  ["إلى عند", "إلى"],
  ["سوف لا", "لن"],
  ...[
    "الله",
    "الرحمن",
    "الرحيم",
    "الملك",
    "العزيز",
    "الكريم",
    "القادر",
    "الناصر",
    "الحميد",
    "السلام",
    "الرزاق",
    "الفتاح",
    "الوهاب",
    "اللطيف",
    "المجيد",
    "الحليم",
  ].map((name): PhraseRow => [`عبد${name}`, `عبد ${name}`]),
];

export const TABLES: LanguagePhraseTables = { words: WORDS, phrases: PHRASES, style: STYLE };
