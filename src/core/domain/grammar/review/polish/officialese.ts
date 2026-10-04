import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { adjectiveForm, adjectiveForms, virileAdjective } from "./lexicon";
import { CLAUSE_START, END, type Frame, runFrames, S } from "./shared";

/*
 * Opt-in style advice (`stylePhrasing`, theme T10): adjectives the noun already says, in every
 * case, and officialese or calques that have a plainer Polish word. These are register choices,
 * not errors.
 */

const words = (list: string) => list.split(" ");

/** The adjective ending of each case slot (N G D A I L, singular then plural) by gender. */
const SLOTS = {
  m: "y ego emu y ym ym e ych ym e ymi ych",
  // Nouns of men: "i" is the men's plural ("nałogowi alkoholicy").
  p: "y ego emu ego ym ym i ych ym ych ymi ych",
  f: "a ej ej ą ą ej e ych ym e ymi ych",
  n: "e ego emu e ym ym e ych ym e ymi ych",
  plural: "e ych ym e ymi ych",
} as const;

/**
 * "zwodniczy miraż" -> "miraż" in every case. `forms` are the noun's forms in SLOTS order;
 * `after` puts the adjective after the noun ("akwen wodny").
 */
function pleonasm(
  adjectives: string,
  gender: keyof typeof SLOTS,
  forms: string,
  after = false,
): PhraseRow[] {
  const nouns = words(forms);
  return words(adjectives).flatMap((lemma) =>
    words(SLOTS[gender]).map((ending, i): PhraseRow => {
      const adjective = ending === "i" ? virileAdjective(lemma) : adjectiveForm(lemma, ending);
      return [after ? `${nouns[i]} ${adjective}` : `${adjective} ${nouns[i]}`, nouns[i]];
    }),
  );
}

/** One row for each typed form: the accusative often repeats the nominative. */
const unique = (rows: readonly PhraseRow[]) => [
  ...new Map(rows.map((row) => [String(row[0]), row])).values(),
];

export const STYLE: readonly PhraseRow[] = unique([
  ...pleonasm(
    "zwodniczy złudny",
    "m",
    "miraż mirażu mirażowi miraż mirażem mirażu miraże miraży mirażom miraże mirażami mirażach",
  ),
  ...pleonasm(
    "przychylny",
    "f",
    "akceptacja akceptacji akceptacji akceptację akceptacją akceptacji akceptacje akceptacji akceptacjom akceptacje akceptacjami akceptacjach",
  ),
  ...pleonasm(
    "nałogowy",
    "p",
    "alkoholik alkoholika alkoholikowi alkoholika alkoholikiem alkoholiku alkoholicy alkoholików alkoholikom alkoholików alkoholikami alkoholikach",
  ),
  ...pleonasm(
    "kompletny zupełny",
    "n",
    "fiasko fiaska fiasku fiasko fiaskiem fiasku fiaska fiask fiaskom fiaska fiaskami fiaskach",
  ),
  ...pleonasm("autentyczny", "plural", "realia realiów realiom realia realiami realiach"),
  ...pleonasm(
    "jajeczny",
    "n",
    "żółtko żółtka żółtku żółtko żółtkiem żółtku żółtka żółtek żółtkom żółtka żółtkami żółtkach",
  ),
  ...pleonasm(
    "wodny",
    "m",
    "akwen akwenu akwenowi akwen akwenem akwenie akweny akwenów akwenom akweny akwenami akwenach",
    true,
  ),
  ["w glorii chwały", ["w glorii", "w chwale"]],
  // Two words for one idea.
  ["adaptacja i przystosowanie", "adaptacja"],
  ["adaptacji i przystosowania", "adaptacji"],
  ["adaptację i przystosowanie", "adaptację"],
  ["przystosowanie i adaptacja", "przystosowanie"],
  ["przystosowania i adaptacji", "przystosowania"],
  // "z powrotem wrócić": the verb says it already ("wrócić z powrotem" is in style.ts).
  ...words(
    "wrócić wracać wrócę wrócisz wróci wrócimy wrócą wrócił wróciła wróciło wrócili wróciły wróciłem wróciłam wracam wraca wracają wracał wracała wracali wróć wróćmy wracaj",
  ).map((verb): PhraseRow => [`z powrotem ${verb}`, verb]),
  // A weekday is already a day of the week.
  ...[
    "każdy poniedziałek",
    "każdy wtorek",
    "każda środa",
    "każdą środę",
    "każdy czwartek",
    "każdy piątek",
    "każda sobota",
    "każdą sobotę",
    "każda niedziela",
    "każdą niedzielę",
  ].map((day): PhraseRow => [`${day} tygodnia`, day]),
  // Officialese for "zabrakło", "wiele".
  ["wystąpił brak", ["zabrakło", "brakowało"]],
  ["wystąpiłby brak", ["zabrakłoby", "brakowałoby"]],
  ["występowałby brak", "brakowałoby"],
  ["cały szereg", ["wiele", "szereg"]],
  ["całego szeregu", ["wielu", "szeregu"]],
  ["całym szeregiem", ["wieloma", "szeregiem"]],
  // "zorientowany obiektowo" copies "object-oriented": "obiektowy".
  ...adjectiveForms("zorientowany").map((typed, i): PhraseRow => [
    `${typed} obiektowo`,
    adjectiveForms("obiektowy")[i],
  ]),
  ["zorientowani obiektowo", "obiektowi"],
]);

const STYLE_RULE = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" } as const;
/** A preposition after "wiodący" makes it "leading to" ("droga wiodąca do lasu"). */
const ROUTE =
  "do|ku|przez|poprzez|na|w|we|z|ze|od|wzdłuż|pod|nad|między|pomiędzy|obok|koło|prym|żywot\\p{Ll}*|życie|rej|tędy|dokąd|donikąd";
/** "cel podróży" for each case form of "destynacja". */
const DESTINATION: Record<string, string | string[]> = {
  a: "cel podróży",
  ę: "cel podróży",
  ą: "celem podróży",
  i: ["celu podróży", "celów podróży"],
  e: "cele podróży",
  om: "celom podróży",
  ami: "celami podróży",
  ach: "celach podróży",
};
/** Fields of work in officialese "na odcinku kultury". */
const FIELDS =
  "kultury|gospodarki|oświaty|edukacji|szkolnictwa|nauki|rolnictwa|przemysłu|handlu|usług|zdrowia|opieki|wychowania|rozwoju|współpracy|polityki|propagandy|produkcji|budownictwa|transportu|sportu|turystyki|bezpieczeństwa|zatrudnienia|pracy";
/** Verbs that describe something "in terms of" another thing. */
const DESCRIBE =
  "interpret|opis|ujm|ujmow|ujęt|ujął|ujęł|wyraż|wyraz|myśl|mów|rozumi|tłumacz|wyjaśni|analiz|definiow|zdefini|postrzeg|ocen|rozważ";

const FRAMES: readonly Frame[] = [
  // "wiodący" (leading) copies English: "czołowy", "główny". Not "wiodąca do lasu", "wiódł prym".
  {
    pattern: `(?<target>wiodąc(?<end>y|a|e|ego|ej|emu|ą|ym|ych|ymi))${END}(?!(?:${S}\\p{Ll}+)?${S}(?:${ROUTE})${END})`,
    fix: (m) => {
      const ending = m.groups!.end.toLowerCase();
      return [adjectiveForm("czołowy", ending), adjectiveForm("główny", ending)];
    },
    ...STYLE_RULE,
  },
  // "destynacja" copies English: "cel podróży". A singular after an adjective or "ta" keeps
  // its gender, so it is left alone ("ta modna destynacja").
  {
    pattern: `(?=destynacj)(?<!(?:^|[^\\p{L}])(?:\\p{L}{1,20}(?:a|ą|ej)|ta|tę|tą|tej)${S})(?<target>destynacj(?<end>a|ę|ą|i|e|om|ami|ach))${END}`,
    fix: (m) => DESTINATION[m.groups!.end.toLowerCase()],
    ...STYLE_RULE,
  },
  // "w terminach temperamentu" copies "in terms of": "w kategoriach".
  {
    pattern: `(?=w${S}terminach)(?<=(?:^|[^\\p{L}])(?:${DESCRIBE})\\p{Ll}{0,8}(?:${S}\\p{Ll}{1,20}){0,3}${S})(?<target>w${S}terminach)(?=${S}\\p{Ll})`,
    fix: "w kategoriach",
    ...STYLE_RULE,
  },
  // A genesis is already how something came to be: "geneza powstania rękopisu" -> "geneza
  // rękopisu". Not the uprisings ("geneza powstania warszawskiego", "Powstania Styczniowego").
  {
    pattern: `(?<target>(?<noun>genez(?:a|y|ie|ę|ą))${S}(?<tail>powstania))${END}`,
    fix: (m) => {
      const next = /^[ \t\u00a0]{1,8}(\p{L}+)/u.exec(m.input.slice(m.index + m[0].length))?.[1];
      const uprising =
        /^P/u.test(m.groups!.tail) ||
        /^\p{Lu}/u.test(next ?? "") ||
        (/ego$/u.test(next ?? "") && !/^(?:tego|jego|owego)$/iu.test(next!));
      return uprising ? null : m.groups!.noun;
    },
    ...STYLE_RULE,
  },
  // Officialese: "na odcinku kultury" -> "w dziedzinie kultury".
  {
    pattern: `(?<target>na${S}odcinku)(?=${S}(?:${FIELDS})${END})`,
    fix: ["w dziedzinie", "w zakresie"],
    ...STYLE_RULE,
  },
  // Officialese: "na okoliczność urodzin" -> "z okazji", "w sprawie".
  {
    pattern: `(?<target>na${S}okoliczność)(?=${S}\\p{Ll})`,
    fix: ["w sprawie", "z okazji"],
    ...STYLE_RULE,
  },
  // "Generalnie, …" opening a sentence copies "generally": "ogólnie", "zasadniczo".
  {
    pattern: `${CLAUSE_START}(?<target>generalnie)${END}`,
    fix: ["ogólnie", "zasadniczo"],
    ...STYLE_RULE,
  },
  // "Dokładnie!" as a reply copies "Exactly!": "Właśnie", "Owszem".
  {
    pattern: `${CLAUSE_START}(?<target>dokładnie(?<so>${S}tak)?)(?=[ \\t\\u00a0]{0,8}[!.](?![.]))`,
    fix: (m) => (m.groups!.so ? ["właśnie tak", "owszem"] : ["właśnie", "owszem"]),
    ...STYLE_RULE,
  },
  // "i/lub" copies "and/or": "lub" already allows both. Not a path ("i/lub.json").
  {
    pattern: `(?<target>i/lub|lub/i)(?![\\p{L}\\p{N}_/.-])`,
    fix: "lub",
    ...STYLE_RULE,
  },
  // "cofnął się o krok do tyłu": moving back is already "cofać się".
  {
    pattern: `cof\\p{Ll}{0,6}${S}się(?:${S}\\p{Ll}{1,12}){1,2}(?<target>${S}(?:wstecz|do${S}tyłu|w${S}tył))${END}`,
    fix: "",
    ...STYLE_RULE,
  },
];

export const DETECTORS = [
  {
    rules: ["stylePhrasing"] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => runFrames(ctx, FRAMES),
  },
];
