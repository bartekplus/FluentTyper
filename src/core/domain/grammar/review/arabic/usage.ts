import type { PhraseRow } from "../englishPhraseTables";
import type { RawFinding } from "../reviewDetectors";
import { conjugate, QAMA, type StyleToken } from "./styleFrames";

// Optional "say, don't say" advice from Arabic usage guides: a modern verb, frame
// or word form careful writers replace with the classical one. Each entry is
// spelled out over its inflections here, so the rows match real prose and not one
// example: verbs over person and tense, nouns over the article and the attached
// prepositions بـ/لـ/كـ (و and ف are matched by the phrase matcher itself).

type Pair = readonly [string, string | readonly string[]];

/** Every form of a sound verb (by its past and imperfect stems) and its replacement. */
function verb(
  past: string,
  present: string,
  fixPast: string,
  fixPresent: string,
  tails: ReadonlyArray<readonly [string, string]> = [["", ""]],
): Pair[] {
  const seen = new Map<string, string>();
  for (let slot = 0; slot < QAMA.length; slot++) {
    const typed = conjugate(past, present, slot);
    const fixed = conjugate(fixPast, fixPresent, slot);
    for (const [tail, fixTail] of tails) seen.set(typed + tail, fixed + fixTail);
  }
  // "تتعطش" -> "تعطش" would land on the typed past "تعطش": such a form is left out.
  for (const [typed, fixed] of seen) if (fixed !== typed && seen.has(fixed)) seen.delete(typed);
  return [...seen];
}

/** Without the bare past form, which is also a noun or participle ("فشل في" "failure in"). */
const finite = (pairs: readonly Pair[], past: string) =>
  pairs.filter(([typed]) => typed !== past && !typed.startsWith(past + " "));

/** A pronoun object on a verb form: "أطلقوا" + "ه" -> "أطلقوه", "أعطى" + "ه" -> "أعطاه". */
function attach(form: string, pronoun: string): string {
  if (form.endsWith("وا")) return form.slice(0, -1) + pronoun;
  if (form.endsWith("تم")) return form + "و" + pronoun;
  if (form.endsWith("ى")) return form.slice(0, -1) + "ا" + pronoun;
  return form + pronoun;
}
const OBJECTS = ["ه", "ها", "هم", "ك", "كم", "نا"];

/** The same pairs with a pronoun object on both verbs. */
const withObjects = (pairs: readonly Pair[]): Pair[] =>
  pairs.flatMap(([typed, fixed]) =>
    OBJECTS.map((pronoun): Pair => [attach(typed, pronoun), attach(fixed as string, pronoun)]),
  );

/** "ل" + a definite word: "الكتاب" -> "للكتاب", "اللغة" -> "للغة". */
const withLam = (word: string) =>
  word.startsWith("الل")
    ? "ل" + word.slice(2)
    : word.startsWith("ال")
      ? "ل" + word.slice(1)
      : "ل" + word;

/**
 * A noun phrase, bare and definite, after بـ/لـ/كـ: "مشوار" -> "المشوار",
 * "بالمشوار", "للمشوار". The first word takes the prefixes.
 */
function nominal(typed: string, fixed: string | readonly string[], definite = true): Pair[] {
  const fixes = [fixed].flat();
  const define = (phrase: string) =>
    phrase
      .split(" ")
      .map((word) => (word.startsWith("ال") ? word : "ال" + word))
      .join(" ");
  const forms: Array<[string, readonly string[]]> = [[typed, fixes]];
  if (definite && !typed.startsWith("ال")) forms.push([define(typed), fixes.map(define)]);
  return forms.flatMap(([form, alternatives]) =>
    (
      [[(w: string) => w], [(w: string) => "ب" + w], [(w: string) => "ك" + w], [withLam]] as const
    ).map(([prefix]): Pair => {
      const apply = (phrase: string) => {
        const [first, ...rest] = phrase.split(" ");
        return [prefix(first), ...rest].join(" ");
      };
      const out = alternatives.map(apply);
      return [apply(form), out.length === 1 ? out[0] : out];
    }),
  );
}

// ------------------------------------------------------------------ verbs

const VERBS: Pair[] = [
  // استقلّ is "became independent"; one rides (ركب) a vehicle.
  ...verb(
    "استقل",
    "ستقل",
    "ركب",
    "ركب",
    ["السيارة", "سيارة", "سيارته", "القطار", "الطائرة", "الحافلة"].map(
      (vehicle) => [` ${vehicle}`, ` ${vehicle}`] as const,
    ),
  ),
  // استلفت is "asked to borrow"; one draws (لفت) attention.
  ...verb("استلفت", "ستلفت", "لفت", "لفت"),
  // سراح is the release itself: one releases (أطلق) the prisoner.
  ...verb("أطلق", "طلق", "أطلق", "طلق", [[" سراح", ""]]),
  ...verb("أطلق", "طلق", "أطلق", "طلق").flatMap(([typed, fixed]) =>
    OBJECTS.map((pronoun): Pair => [`${typed} سراح${pronoun}`, attach(fixed as string, pronoun)]),
  ),
  ...["", "ب", "ل"].flatMap((pre): Pair[] => [
    [`${pre}إطلاق سراح`, `${pre}إطلاق`],
    ...["ه", "ها", "هم"].map((pronoun): Pair => [
      `${pre}إطلاق سراح${pronoun}`,
      `${pre}إطلاق${pronoun}`,
    ]),
  ]),
  ...[
    ["فك", "أطلق"],
    ["فكت", "أطلقت"],
    ["فكوا", "أطلقوا"],
    ["يفك", "يطلق"],
    ["تفك", "تطلق"],
  ].flatMap(([typed, fix]): Pair[] => [
    [`${typed} سراح`, fix],
    ...OBJECTS.map((pronoun): Pair => [`${typed} سراح${pronoun}`, attach(fix, pronoun)]),
  ]),
  // أسعف is "gave first aid": one takes (نقل) the injured to hospital.
  ...withObjects(verb("أسعف", "سعف", "نقل", "نقل")).map(([typed, fixed]): Pair => [
    `${typed} إلى`,
    `${fixed as string} إلى`,
  ]),
  // Longing is تشوّق إلى; تلهّف is "grieved".
  ...verb(
    "تلهف",
    "تلهف",
    "تشوق",
    "تشوق",
    [
      ["على", "إلى"],
      ["عليه", "إليه"],
      ["عليها", "إليها"],
      ["عليهما", "إليهما"],
      ["عليهم", "إليهم"],
      ["إلى", "إلى"],
      ["إليه", "إليه"],
      ["إليها", "إليها"],
    ].map(([typed, fixed]) => [` ${typed}`, ` ${fixed}`] as const),
  ),
  // أوكل is not classical: وكَل الأمرَ إليه, and the thing entrusted is موكول.
  ...[
    ["أوكل", "وكل"],
    ["أوكلت", "وكلت"],
    ["أوكلوا", "وكلوا"],
    ["أوكلنا", "وكلنا"],
    ["يوكل", "يكل"],
    ["يوكلون", "يكلون"],
    ["نوكل", "نكل"],
  ].flatMap(([typed, fix]) =>
    ["إلى", "إليه", "إليها", "إليهم", "إليك", "إلينا"].flatMap((to): Pair[] => [
      [`${typed} ${to}`, `${fix} ${to}`],
      [`${typed} الأمر ${to}`, `${fix} الأمر ${to}`],
    ]),
  ),
  ...["موكل", "موكلة", "الموكل", "الموكلة"].flatMap((typed) =>
    ["إلى", "إليه", "إليها", "إليهم"].map((to): Pair => [
      `${typed} ${to}`,
      `${typed.replace("موكل", "موكول")} ${to}`,
    ]),
  ),
  // تستّر is "hid himself": one covers up for someone with ستر على.
  ...verb(
    "تستر",
    "تستر",
    "ستر",
    "ستر",
    ["على", "عليه", "عليها", "عليهم"].map((on) => [` ${on}`, ` ${on}`] as const),
  ),
  ...nominal("التستر على", "الستر على", false),
  // Longing is عطش إلى.
  ...verb(
    "تعطش",
    "تعطش",
    "عطش",
    "عطش",
    ["إلى", "إليه", "إليها", "إليهم"].map((to) => [` ${to}`, ` ${to}`] as const),
  ),
  // One looks closely: أمعن النظر في.
  ...finite(
    verb(
      "تمعن",
      "تمعن",
      "أمعن",
      "معن",
      ["في", "فيه", "فيها", "فيهم"].map((into) => [` ${into}`, ` النظر ${into}`] as const),
    ),
    "تمعن",
  ),
  ...nominal("التمعن في", "إمعان النظر في", false),
  // دهَم, not داهَم; دعَس, not دهَس; خضَع, not رضَخ (which is "gave a little").
  // "خطر داهم": the bare form is also دهَم's participle.
  ...finite(verb("داهم", "داهم", "دهم", "دهم"), "داهم"),
  ...withObjects(verb("داهم", "داهم", "دهم", "دهم")),
  ...verb("دهس", "دهس", "دعس", "دعس"),
  ...withObjects(verb("دهس", "دهس", "دعس", "دعس")),
  ...nominal("الدهس", "الدعس", false),
  ...verb("رضخ", "رضخ", "خضع", "خضع"),
  ...nominal("الرضوخ", "الخضوع", false),
  // A council ratifies (صدّق على); صادق is "befriended".
  ...finite(
    verb(
      "صادق",
      "صادق",
      "صدق",
      "صدق",
      ["على", "عليه", "عليها", "عليهم"].map((on) => [` ${on}`, ` ${on}`] as const),
    ),
    "صادق",
  ),
  ...nominal("المصادقة على", "التصديق على", false),
  ...nominal("مصادقة على", "تصديق على", false),
  // Making sure is تحقّق من; تأكّد is "became firm".
  ...verb(
    "تأكد",
    "تأكد",
    "تحقق",
    "تحقق",
    ["من", "منه", "منها", "منهم"].map((of) => [` ${of}`, ` ${of}`] as const),
  ),
  ...nominal("التأكد من", "التحقق من", false),
  // فشِل is "lost heart"; failing at something is أخفق في.
  ...finite(
    verb(
      "فشل",
      "فشل",
      "أخفق",
      "خفق",
      ["في", "فيه", "فيها"].map((at) => [` ${at}`, ` ${at}`] as const),
    ),
    "فشل",
  ),
  ...verb("انذهل", "نذهل", "ذهل", "ذهل"),
  ...verb("تأقلم", "تأقلم", "تكيف", "تكيف"),
  ...nominal("التأقلم", "التكيف", false),
  ...[
    ["احتار", "تحير"],
    ["احتارت", "تحيرت"],
    ["احتاروا", "تحيروا"],
    ["احترت", "تحيرت"],
    ["احترنا", "تحيرنا"],
    ["يحتار", "يتحير"],
    ["تحتار", "تتحير"],
    ["يحتارون", "يتحيرون"],
    ["أحتار", "أتحير"],
    ["نحتار", "نتحير"],
    ["محتار", "متحير"],
    ["محتارة", "متحيرة"],
    ["محتارون", "متحيرون"],
    ["محتارين", "متحيرين"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  ...[
    ["تحمم", "استحم"],
    ["تحممت", "استحممت"],
    ["تحمموا", "استحموا"],
    ["يتحمم", "يستحم"],
    ["تتحمم", "تستحم"],
    ["يتحممون", "يستحمون"],
    ["أتحمم", "أستحم"],
    ["نتحمم", "نستحم"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  ...[
    ["تمحور", "دار"],
    ["تمحورت", "دارت"],
    ["يتمحور", "يدور"],
    ["تتمحور", "تدور"],
    ["يتمحورون", "يدورون"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  ...[
    ["اختلى", "خلا"],
    ["اختلت", "خلت"],
    ["اختلوا", "خلوا"],
    ["اختليت", "خلوت"],
    ["يختلي", "يخلو"],
    ["تختلي", "تخلو"],
    ["يختلون", "يخلون"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // انطلى is not classical: a trick passes (جازت) on someone.
  ...[
    ["انطلى", "جاز"],
    ["انطلت", "جازت"],
    ["ينطلي", "يجوز"],
    ["تنطلي", "تجوز"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // أحنى is not classical: حنى رأسه.
  ...[
    ["أحنى", "حنى"],
    ["أحنت", "حنت"],
    ["أحنوا", "حنوا"],
    ["أحنيت", "حنيت"],
    ["أحنينا", "حنينا"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // ملأ, not أملأ (a bare "أملأ" is also "I fill").
  ...[
    ["أملأت", "ملأت"],
    ["أملأوا", "ملأوا"],
    ["أملأنا", "ملأنا"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // Hoping is أمل; تأمّل is "contemplated".
  ...[
    ["يتأمل خيرا", "يأمل خيرا"],
    ["تتأمل خيرا", "تأمل خيرا"],
    ["نتأمل خيرا", "نأمل خيرا"],
    ["أتأمل خيرا", "آمل خيرا"],
    ["تأملت خيرا", "أملت خيرا"],
    ["تأملنا خيرا", "أملنا خيرا"],
    ["تأملوا خيرا", "أملوا خيرا"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // نعى is already "announced the death of".
  ...["نعى", "نعت", "نعوا", "ينعى", "تنعى", "ينعون", "ننعى"].map((form): Pair => [
    `${form} وفاة`,
    form,
  ]),
  // Disgust is اشمأزّ; قرِف is colloquial.
  ...[
    ["قرف", "اشمأز"],
    ["قرفت", "اشمأزت"],
    ["قرفوا", "اشمأزوا"],
    ["يقرف", "يشمئز"],
    ["تقرف", "تشمئز"],
    ["أقرف", "أشمئز"],
  ].flatMap(([typed, fix]) =>
    ["من", "منه", "منها", "منهم"].map((of): Pair => [`${typed} ${of}`, `${fix} ${of}`]),
  ),
  // A sun shines (أشعّت); شعّ is "scattered".
  ...[
    ["شعت الشمس", "أشعت الشمس"],
    ["شع النور", "أشع النور"],
    ["شع الضوء", "أشع الضوء"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // Relieving of a post is أعفى.
  ...[
    ["عفاه", "أعفاه"],
    ["عفاها", "أعفاها"],
    ["عفاهم", "أعفاهم"],
    ["عفته", "أعفته"],
    ["عفوه", "أعفوه"],
  ].map(([typed, fix]): Pair => [`${typed} من`, `${fix} من`]),
  // An article covers (شمل) points; غطّى is "put a cover on".
  ...[
    ["غطى", "شمل"],
    ["غطت", "شملت"],
    ["يغطي", "يشمل"],
    ["تغطي", "تشمل"],
  ].flatMap(([typed, fix]) =>
    ["المقال", "التقرير", "البحث", "الكتاب", "الدراسة", "المحاضرة"].map((what): Pair => [
      `${typed} ${what}`,
      `${fix} ${what}`,
    ]),
  ),
  // مزح takes its partner directly in مازح: "مازحته", not "مزحت معه".
  ...[
    ["مزح", "مازح"],
    ["مزحت", "مازحت"],
    ["مزحوا", "مازحوا"],
    ["يمزح", "يمازح"],
    ["تمزح", "تمازح"],
    ["يمزحون", "يمازحون"],
    ["أمزح", "أمازح"],
    ["نمزح", "نمازح"],
  ].flatMap(([typed, fix]) =>
    [...OBJECTS, "ي"].map((pronoun): Pair => [
      `${typed} مع${pronoun}`,
      attach(fix, pronoun === "ي" ? "ني" : pronoun),
    ]),
  ),
  // "يتماشى مع القانون": it agrees with (يوافق) the law.
  ...[
    ["يتماشى", "يوافق"],
    ["تتماشى", "توافق"],
    ["تماشى", "وافق"],
    ["تماشت", "وافقت"],
    ["يتماشون", "يوافقون"],
    ["يتمشى", "يوافق"],
    ["تتمشى", "توافق"],
  ].flatMap(([typed, fix]): Pair[] => [
    [`${typed} مع`, fix],
    ...["ه", "ها", "هم"].map((pronoun): Pair => [`${typed} مع${pronoun}`, fix + pronoun]),
  ]),
  // ناف ينوف is "rose"; a number exceeds (أناف يُنيف) another.
  ...[
    ["ينوف", "ينيف"],
    ["تنوف", "تنيف"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // أعطى takes two objects: "أعطى صاحبه كتابا".
  ...["أعطى", "أعطت", "أعطوا", "يعطي", "تعطي", "يعطون"].flatMap((form): Pair[] => [
    [`${form} إلى`, form],
    ...["ه", "ها", "هم"].map((pronoun): Pair => [`${form} إلي${pronoun}`, attach(form, pronoun)]),
  ]),
  // عوّده الأمرَ: the habit is the second object.
  ...["عوده", "عودها", "عودهم", "عودني", "عودنا", "عودته", "عودتها", "عودتهم"].map((form): Pair => [
    `${form} على`,
    form,
  ]),
  // أحاطه علما is "surrounded him with knowledge": أعلمه.
  ...[
    ["يحطه علما", "يعلمه"],
    ["يحيطكم علما", "يعلمكم"],
    ["نحيطكم علما", "نعلمكم"],
    ["أحيطكم علما", "أعلمكم"],
    ["نحيطك علما", "نعلمك"],
    ["أحيطك علما", "أعلمك"],
    ["أحطتكم علما", "أعلمتكم"],
    ["أحطناكم علما", "أعلمناكم"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // The beard is shaved, not the chin.
  ...["حلق", "حلقت", "حلقوا", "يحلق", "تحلق", "أحلق", "نحلق"].flatMap((form) =>
    [
      ["ذقنه", "لحيته"],
      ["ذقني", "لحيتي"],
      ["ذقنك", "لحيتك"],
      ["ذقونهم", "لحاهم"],
    ].map(([chin, beard]): Pair => [`${form} ${chin}`, `${form} ${beard}`]),
  ),
  // تماثل is already "drew near recovery".
  ...["تماثل", "تماثلت", "يتماثل", "تتماثل"].map((form): Pair => [`${form} للشفاء`, form]),
  // "ما تمالك نفسه أن": تمالك already says "held himself back".
  ...["تمالك", "تمالكت", "يتمالك", "تتمالك", "أتمالك", "نتمالك"].flatMap((form) =>
    ["نفسه", "نفسها", "نفسي", "نفسك", "أنفسهم", "أنفسنا"].map((self): Pair => [
      `${form} ${self}`,
      form,
    ]),
  ),
  // فرض is "imposed"; supposing is افترض.
  ...[
    ["لنفرض أن", "لنفترض أن"],
    ["نفرض أن", "نفترض أن"],
    ["فرضنا أن", "افترضنا أن"],
    ["لو فرضنا", "لو افترضنا"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // تعالَ إلى: come "to", not "at".
  ...["تعال", "تعالي", "تعالوا", "تعاليا"].flatMap((come) =>
    [
      ["عند", "إلى"],
      ["عندنا", "إلينا"],
      ["عندي", "إلي"],
      ["عنده", "إليه"],
      ["عندها", "إليها"],
    ].map(([at, to]): Pair => [`${come} ${at}`, `${come} ${to}`]),
  ),
  // وقد is "burned" (the fire itself); one lights (أوقد) the fuel.
  ...[
    ["وقدت", "أوقدت"],
    ["وقدنا", "أوقدنا"],
    ["وقدوا", "أوقدوا"],
    ["يقد", "يوقد"],
    ["تقد", "توقد"],
  ].flatMap(([typed, fix]) =>
    ["الحطب", "الفحم", "الخشب", "الموقد", "المدفأة", "الفرن"].map((fuel): Pair => [
      `${typed} ${fuel}`,
      `${fix} ${fuel}`,
    ]),
  ),
  // كرى is "dug" or "dozed"; one lets (أكرى) a house.
  ...[
    ["كرى", "أكرى"],
    ["كريت", "أكريت"],
    ["كرينا", "أكرينا"],
    ["كروا", "أكروا"],
  ].flatMap(([typed, fix]) =>
    ["البيت", "الدار", "المنزل", "الشقة", "الغرفة", "الدكان"].map((home): Pair => [
      `${typed} ${home}`,
      `${fix} ${home}`,
    ]),
  ),
  // تولّج is "entered"; one takes on (تولّى) an office.
  ...[
    ["تولج", "تولى"],
    ["تولجت", "تولت"],
    ["يتولج", "يتولى"],
    ["تتولج", "تتولى"],
  ].flatMap(([typed, fix]) =>
    ["الأمر", "المنصب", "الحكم", "القيادة", "الرئاسة", "المسؤولية", "الوزارة", "الإدارة"].map(
      (office): Pair => [`${typed} ${office}`, `${fix} ${office}`],
    ),
  ),
  // One grates (بشر يبشر) cheese or soap; برش is colloquial.
  ...[
    ["برش", "بشر"],
    ["برشت", "بشرت"],
    ["يبرش", "يبشر"],
    ["تبرش", "تبشر"],
    ["ابرش", "ابشر"],
    ["ابرشي", "ابشري"],
  ].flatMap(([typed, fix]) =>
    ["الصابون", "الجبن", "الجزر", "البصل", "الليمون", "الشوكولاتة"].map((food): Pair => [
      `${typed} ${food}`,
      `${fix} ${food}`,
    ]),
  ),
  // اقتصد is "was thrifty"; a sum put aside is saved (ادّخر).
  ...[
    ["اقتصد", "ادخر"],
    ["اقتصدت", "ادخرت"],
    ["اقتصدنا", "ادخرنا"],
    ["اقتصدوا", "ادخروا"],
    ["يقتصد", "يدخر"],
    ["تقتصد", "تدخر"],
  ].flatMap(([typed, fix]) =>
    ["مبلغا", "مالا", "المال", "نقودا", "النقود"].map((sum): Pair => [
      `${typed} ${sum}`,
      `${fix} ${sum}`,
    ]),
  ),
  // دلف is "walked with short steps"; a roof leaks (وكف يكف).
  ...[
    ["دلف السقف", "وكف السقف"],
    ["يدلف السقف", "يكف السقف"],
    ["دلفت السقوف", "وكفت السقوف"],
  ].map(([typed, fix]): Pair => [typed, fix]),
];

// ----------------------------------------------------- nouns, adjectives

const WORDS: Pair[] = [
  // Colloquial or borrowed nouns with a standard word.
  ...nominal("مشوار", ["طريق", "مسافة", "نزهة"]),
  ...nominal("ماكينة", "آلة"),
  ...nominal("ماكينات", "آلات"),
  ...nominal("استبيان", "استبانة"),
  ...nominal("استبيانات", "استبانات"),
  ...nominal("تطمين", "طمأنة"),
  ...nominal("محلات", "محال"),
  ...nominal("خمارة", "حانة"),
  ...nominal("خمارات", "حانات"),
  ...nominal("شراهة", "شره"),
  ...nominal("وضاحة", "وضوح"),
  ...nominal("بواسل", "بسلاء"),
  ...nominal("عرايا", "عراة"),
  ...nominal("الشوي", "الشي", false),
  ["شويا", "شيا"],
  ...nominal("طقوس دينية", "شعائر دينية"),
  // مخاط is mucus; sewn is مخيط. نذر is a vow; scant is نزر.
  ...["ثوب", "قميص", "فستان", "سروال"].map((cloth): Pair => [`${cloth} مخاط`, `${cloth} مخيط`]),
  ...nominal("نذر يسير", "نزر يسير"),
  ...["عطاء", "مال", "شيء", "قدر"].map((noun): Pair => [`${noun} نذر`, `${noun} نزر`]),
  // Participles on the wrong pattern or measure.
  ...(
    [
      ["شيق", "شائق"],
      ["شيقة", "شائقة"],
      ["مثلج", "مثلوج"],
      ["مثلجة", "مثلوجة"],
      ["مصان", "مصون"],
      ["مصانة", "مصونة"],
      ["مهاب", "مهيب"],
      ["محاك", "محوك"],
      ["محاكة", "محوكة"],
      ["مفتخر", "فاخر"],
      ["مفتخرة", "فاخرة"],
      ["مبهر", "باهر"],
      ["مبهرة", "باهرة"],
      ["مريع", "مروع"],
      ["مريعة", "مروعة"],
      ["مهووس", "مهوس"],
      ["مهووسة", "مهوسة"],
      ["مهووسون", "مهوسون"],
      ["مهووسين", "مهوسين"],
      ["مذهول", "ذاهل"],
      ["مذهولة", "ذاهلة"],
      ["مذهولون", "ذاهلون"],
      ["مذهولين", "ذاهلين"],
      ["داكن", "أدكن"],
      ["داكنة", "دكناء"],
      ["صبوح", "صبيح"],
      ["مغلي", "مغلى"],
      ["مغلية", "مغلاة"],
      ["معفي", "معفى"],
      ["معفية", "معفاة"],
      ["معفوة", "معفاة"],
      ["لاغية", "ملغاة"],
      ["مليء", ["مملوء", "ملآن"]],
      ["مليئة", ["مملوءة", "ملأى"]],
      // متأكّد "made firm"; certainty is متيقّن.
      ["متأكد", "متيقن"],
      ["متأكدة", "متيقنة"],
      ["متأكدون", "متيقنون"],
      ["متأكدين", "متيقنين"],
      // امتنّ is "bestowed a favour": a grateful person is شاكر.
      ["ممتن", "شاكر"],
      ["ممتنة", "شاكرة"],
      ["ممتنون", "شاكرون"],
      ["ممتنين", "شاكرين"],
      ["ممنون", "شاكر"],
      ["ممنونة", "شاكرة"],
      ["مستهتر", "مستخف"],
      ["مستهترة", "مستخفة"],
      ["مستهترون", "مستخفون"],
      ["مستهترين", "مستخفين"],
      ["خلوق", "حسن الخلق"],
      ["خلوقة", "حسنة الخلق"],
      // The relational -ي is not needed on رئيس.
      ["رئيسيان", "رئيسان"],
      ["رئيسيين", "رئيسين"],
      ["رئيسيون", "رئيسون"],
    ] as const
  ).flatMap(([typed, fix]) => nominal(typed, fix)),
  ...nominal("الرئيسي", "الرئيس", false),
  ["لاغ", "ملغى"],
  // A beast of prey is ضارٍ; كاسر is "breaking".
  ...(
    [
      ["وحش كاسر", "وحش ضار"],
      ["الوحش الكاسر", "الوحش الضاري"],
      ["وحوش كاسرة", "وحوش ضارية"],
      ["الوحوش الكاسرة", "الوحوش الضارية"],
      ["حيوانات كاسرة", "حيوانات ضارية"],
      ["الحيوانات الكاسرة", "الحيوانات الضارية"],
    ] as const
  ).map(([typed, fix]): Pair => [typed, fix]),
  // "حسن العشرة", "كلام جزل", "الواقع المعيش".
  ...["حسن", "حسنة", "طيب", "طيبة", "سيئ", "سيئة"].map((good): Pair => [
    `${good} المعشر`,
    `${good} العشرة`,
  ]),
  ...["كلام", "أسلوب", "لفظ", "شعر", "الكلام", "الأسلوب"].map((speech): Pair => [
    `${speech} ${speech.startsWith("ال") ? "الجذل" : "جذل"}`,
    `${speech} ${speech.startsWith("ال") ? "الجزل" : "جزل"}`,
  ]),
  ...["الواقع", "الحال", "الوضع"].map((state): Pair => [`${state} المعاش`, `${state} المعيش`]),
  // بسيط is "spread out": a small amount is يسير.
  ...["شيء", "أمر", "مبلغ", "فرق", "خطأ", "عدد", "جزء", "تعديل", "تغيير", "وقت"].flatMap(
    (noun): Pair[] => [
      [`${noun} بسيط`, `${noun} يسير`],
      [`ال${noun} البسيط`, `ال${noun} اليسير`],
      [`بال${noun} البسيط`, `بال${noun} اليسير`],
    ],
  ),
  ...["زيادة", "نسبة", "كمية", "مدة", "فترة"].flatMap((noun): Pair[] => [
    [`${noun} بسيطة`, `${noun} يسيرة`],
    [`ال${noun} البسيطة`, `ال${noun} اليسيرة`],
  ]),
  // Accusative of the masculine participles: "يقف مذهولا".
  ...(
    [
      ["مذهولا", "ذاهلا"],
      ["شيقا", "شائقا"],
      ["مهابا", "مهيبا"],
      ["مبهرا", "باهرا"],
      ["مريعا", "مروعا"],
      ["متأكدا", "متيقنا"],
      ["ممتنا", "شاكرا"],
      ["مستهترا", "مستخفا"],
    ] as const
  ).map(([typed, fix]): Pair => [typed, fix]),
  // Misformed participles of hollow and defective verbs: مقود, مصوغة, مجبية, مهيج.
  ...(
    [
      ["مقاد", "مقود"],
      ["مقادة", "مقودة"],
      ["مصاغة", "مصوغة"],
      ["مجباة", "مجبية"],
      ["مهاج", "مهيج"],
      ["مشبوه", "مشتبه فيه"],
      ["مشبوهة", "مشتبه فيها"],
      ["مشبوهون", "مشتبه فيهم"],
      ["مشبوهين", "مشتبه فيهم"],
      // A tolerant, easy law is سمحة; سمحاء is a colour pattern.
      ["سمحاء", "سمحة"],
      // صعيد has the plural صُعُد.
      ["أصعدة", "صعد"],
      ["كلل", "كلال"],
    ] as const
  ).flatMap(([typed, fix]) => nominal(typed, fix)),
  ...nominal("مشبوه فيه", "مشتبه فيه", false),
  ...[
    ["يطال", "يطول"],
    ["تطال", "تطول"],
    ["يطاله", "يطوله"],
    ["يطالها", "يطولها"],
    ["يطالهم", "يطولهم"],
    ["تطاله", "تطوله"],
    ["تطالها", "تطولها"],
    ["تطالهم", "تطولهم"],
    ["تصامم", "تصام"],
    ["يتصامم", "يتصام"],
    ["رشيت", "رشوت"],
    ["رشيته", "رشوته"],
    ["رشيتهم", "رشوتهم"],
    ["لغا", "ألغى"],
    ["يغط", "يشمل"],
    ["تغط", "تشمل"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // سحب is "dragged": a complaint or request is withdrawn (استردّ).
  ...[
    ["سحب", "استرد"],
    ["سحبت", "استردت"],
    ["سحبوا", "استردوا"],
    ["يسحب", "يسترد"],
    ["تسحب", "تسترد"],
  ].flatMap(([typed, fix]) =>
    ["شكواه", "شكواها", "شكواهم", "الشكوى", "شكواي"].map((what): Pair => [
      `${typed} ${what}`,
      `${fix} ${what}`,
    ]),
  ),
  // Clothes are mended (رفا يرفو); رثى is "mourned", رتا is not a word.
  ...[
    ["رتا", "رفا"],
    ["رثا", "رفا"],
    ["رتى", "رفا"],
    ["رتت", "رفت"],
    ["رتوت", "رفوت"],
    ["رثوت", "رفوت"],
    ["رتيت", "رفوت"],
    ["يرتو", "يرفو"],
    ["يرثو", "يرفو"],
    ["يرتي", "يرفو"],
    ["ترتو", "ترفو"],
    ["ترتي", "ترفو"],
  ].flatMap(([typed, fix]) =>
    ["الثوب", "ثوبه", "ثوبها", "الثياب", "ثيابه", "القميص", "قميصه", "الجورب", "الجوارب"].map(
      (cloth): Pair => [`${typed} ${cloth}`, `${fix} ${cloth}`],
    ),
  ),
  // Calques: "last but not least", "the negotiating table".
  ["أخيرا وليس آخرا", "أخيرا"],
  ...["المفاوضات", "المداولات", "الحوار"].map((talks): Pair => [`طاولة ${talks}`, talks]),
  ["بين آونة وأخرى", "بين حين وآخر"],
  ["فإن لا", "فإلا"],
  // من خلال is "through the gaps of": a means is عن طريق or بواسطة.
  ["من خلال", ["عن طريق", "بواسطة"]],
  ...["ه", "ها", "هم"].map((pronoun): Pair => [
    `من خلال${pronoun}`,
    [`عن طريق${pronoun}`, `بواسطت${pronoun}`],
  ]),
  // شكّل is "formed": a danger is (يُعدّ) one, it is not formed.
  ...[
    ["يشكل", "يعد"],
    ["تشكل", "تعد"],
    ["يشكلون", "يعدون"],
    ["شكلت", "عدت"],
  ].flatMap(([typed, fix]) =>
    ["خطرا", "تهديدا", "عائقا", "عبئا", "تحديا"].map((what): Pair => [
      `${typed} ${what}`,
      `${fix} ${what}`,
    ]),
  ),
  // Adverbs and particles.
  ...["مؤخرا", "مؤخراً"].map((typed): Pair => [typed, ["حديثا", "أخيرا"]]),
  ...["مسبقا", "مسبقاً"].map((typed): Pair => [typed, ["سلفا", "مقدما"]]),
  ...["خصيصا", "خصيصاً"].map((typed): Pair => [typed, "خصيصى"]),
  ["بالتالي", "لذلك"],
  ["بمثابة", "بمنزلة"],
  ["ككل", ["كليا", "عموما"]],
  ...["ه", "ها", "هم"].map((pronoun): Pair => [
    `بأكمل${pronoun}`,
    [`برمت${pronoun}`, `كل${pronoun}`],
  ]),
  ["علاوة على", "فضلا عن"],
  ["عن كثب", "من كثب"],
  ["يا أبتي", "يا أبت"],
  ...["", "ه", "ها", "هم"].map((pronoun): Pair => [`في ثنايا${pronoun}`, `في طيات${pronoun}`]),
  ...["مئة", "مائة", "ألف"].map((number): Pair => [`نيف و${number}`, `${number} ونيف`]),
  ...["", "ه", "ها", "هم", "ك", "كم", "ي"].map((pronoun): Pair => [
    `هل إن${pronoun}`,
    `أإن${pronoun}`,
  ]),
  ...["عاطل", "عاطلة", "عاطلون", "عاطلين", "العاطلين", "العاطلون"].map((idle): Pair => [
    `${idle} عن العمل`,
    `${idle} من العمل`,
  ]),
  ...["موشك", "موشكة", "موشكون", "موشكين"].map((near): Pair => [`${near} على`, "على وشك"]),
  ...["هو", "هي", "هم"].map((pronoun): Pair => [`${pronoun} عبارة عن`, pronoun]),
  ...["لغسيل", "بغسيل", "غسيل"].flatMap((washing) =>
    ["الأموال", "أموال", "أمواله", "أموالها", "أموالهم"].map((money): Pair => [
      `${washing} ${money}`,
      `${washing.replace("غسيل", "غسل")} ${money}`,
    ]),
  ),
  // Prepositions after nouns: remarks are "on" a thing.
  ...["ملاحظات", "ملاحظة", "تعليق", "تعليقات", "استدراك", "تعقيب", "مآخذ"].flatMap((noun) =>
    [
      ["حول", "على"],
      ["حوله", "عليه"],
      ["حولها", "عليها"],
      ["حولهم", "عليهم"],
    ].map(([about, on]): Pair => [`${noun} ${about}`, `${noun} ${on}`]),
  ),
  ...["رأي", "رأيه", "رأيها", "رأيهم", "رأيي", "رأيك", "رأيكم", "رأينا", "آراؤهم", "آرائهم"].map(
    (opinion): Pair => [`${opinion} حول`, `${opinion} في`],
  ),
  ...["تعصب", "تعصبت", "تعصبوا", "يتعصب", "تتعصب", "متعصب", "متعصبة", "متعصبون", "متعصبين"].flatMap(
    (form) =>
      [
        ["ضد", "على"],
        ["ضده", "عليه"],
        ["ضدها", "عليها"],
        ["ضدهم", "عليهم"],
      ]
        .filter(([against]) => !(form === "تعصب" && against === "ضد"))
        .map(([against, on]): Pair => [`${form} ${against}`, `${form} ${on}`]),
  ),
  ...["لصالحك", "لصالحه", "لصالحها", "لصالحهم", "لصالحنا", "لصالحي", "لصالحكم"].map(
    (form): Pair => [form, form.replace("لصالح", "لمصلحت")],
  ),
  // The calque "in every sense of the word".
  ...[
    "بكل معنى الكلمة",
    "بكل ما تحمله الكلمة من معنى",
    "بكل ما للكلمة من معنى",
    "بكل ما في الكلمة من معنى",
  ].map((typed): Pair => [typed, "حقا"]),
  // Being moved is التأثر; التأثير is the effect one has.
  ["من شدة التأثير", "من شدة التأثر"],
  // Limited to is مقصور على; قاصر is "falling short" or "a minor".
  ...[
    ["قاصر على", "مقصور على"],
    ["قاصرة على", "مقصورة على"],
    ["قاصرا على", "مقصورا على"],
    ["قاصرون على", "مقصورون على"],
    ["قاصرين على", "مقصورين على"],
  ].map(([typed, fix]): Pair => [typed, fix]),
  // Participles of باع and of a low place: مبيع, منخفض.
  ...nominal("مباع", "مبيع"),
  ...nominal("مباعة", "مبيعة"),
  ...nominal("واطئ", "منخفض"),
  ...nominal("واطئة", "منخفضة"),
  // برهة is a long while; a moment is هنيهة.
  ...nominal("برهة", "هنيهة", false),
  // سوية is "evenness": a high standard is a مرتبة or درجة.
  ...["عالية", "رفيعة", "متدنية", "متقدمة"].flatMap((level) =>
    nominal(`سوية ${level}`, [`مرتبة ${level}`, `درجة ${level}`]),
  ),
  // A dream seen in sleep is a حلم or رؤيا; منام is the sleep.
  ...["رأى", "رأت", "رأيت", "رأوا", "رأينا", "يرى", "ترى", "أرى", "نرى", "يرون"].map(
    (form): Pair => [`${form} مناما`, `${form} حلما`],
  ),
  // قارب takes its object directly: "يقارب ألفا".
  ...[
    ["يقارب من", "يقارب"],
    ["يقارب عددهم من", "يقارب عددهم"],
    ["يقارب عددها من", "يقارب عددها"],
  ].map(([typed, fix]): Pair => [typed, fix]),
];

/** The rows: every typed form once. */
export const USAGE_STYLE: readonly PhraseRow[] = [
  ...new Map([...VERBS, ...WORDS].map(([typed, fixed]) => [typed, fixed] as const)),
].map(([typed, fixed]): PhraseRow => [typed, fixed as string | string[]]);

/** Verb forms (typed -> replacement) of one entry, without tails. */
const forms = (pairs: readonly Pair[]) =>
  new Map(pairs.map(([typed, fixed]) => [typed, fixed as string]));

// The same verb advice when the subject or a word stands between the verb and
// the word that shows its sense: "استقل الوزير السيارة", "فتحت الشرطة النار".
const GAPPED: ReadonlyArray<readonly [ReadonlyMap<string, string>, RegExp]> = [
  [forms(verb("استقل", "ستقل", "ركب", "ركب")), /^(?:ال)?(?:سيار|قطار|طائر|حافل|سفين)\p{L}*$/u],
  [forms(verb("فتح", "فتح", "أطلق", "طلق")), /^(?:النار|الرصاص)$/u],
  [forms(verb("تستر", "تستر", "ستر", "ستر")), /^على\p{L}*$/u],
  [forms(verb("صادق", "صادق", "صدق", "صدق")), /^على\p{L}*$/u],
  [forms(verb("افتقد", "فتقد", "افتقر", "فتقر")), /^إلى$/u],
  // "تمادى الطالب على زميله": against a person it is تطاول على.
  [
    new Map([
      ["تمادى", "تطاول"],
      ["تمادت", "تطاولت"],
      ["تمادوا", "تطاولوا"],
      ["يتمادى", "يتطاول"],
      ["تتمادى", "تتطاول"],
      ["يتمادون", "يتطاولون"],
    ]),
    /^على\p{L}*$/u,
  ],
];
// A preposition between them opens its own phrase: "تمادى في الكذب على الناس".
const GAP_PREPOSITION = /^(?:في|على|إلى|من|عن|مع|ب\p{L}+|ل\p{L}+)$/u;

const SPACES = /^[ \t\u00a0]+$/u;

/**
 * A verb from GAPPED, one or two words, then its confirming word, with only
 * spaces between: the verb gets the replacement. Adjacent pairs are table rows.
 */
export function gappedUsage(
  list: readonly StyleToken[],
  at: (start: number) => boolean,
): Array<Omit<RawFinding, "ruleId">> {
  const findings: Array<Omit<RawFinding, "ruleId">> = [];
  for (let i = 0; i + 2 < list.length; i++) {
    const word = list[i].word;
    for (const [verbs, target] of GAPPED) {
      // "فتحت" is a verb of its own; "وفتحت" carries و.
      const pre = verbs.has(word) || !/^[وف]/u.test(word) ? "" : word[0];
      const fixed = verbs.get(word.slice(pre.length));
      if (!fixed) continue;
      for (let k = i + 2; k <= i + 3 && k < list.length; k++) {
        if (!SPACES.test(list[k].gap) || !SPACES.test(list[k - 1].gap)) break;
        if (GAP_PREPOSITION.test(list[k - 1].word)) break;
        if (!target.test(list[k].word)) continue;
        if (at(list[i].start))
          findings.push({
            messageKey: "review_msg_style_phrasing",
            range: { start: list[i].start, end: list[i].end },
            alternatives: [pre + fixed],
          });
        break;
      }
    }
  }
  return findings;
}
