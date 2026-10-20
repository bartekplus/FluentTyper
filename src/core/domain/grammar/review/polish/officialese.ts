import type { Detector } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { adjectiveForm } from "./lexicon";
import { CLAUSE_START, END, type Frame, runFrames, S } from "./shared";

/*
 * Opt-in style advice (`stylePhrasing`, theme T10): officialese or calques that have a plainer
 * Polish word. The pleonasm rows are in grammar/rules/pl.yaml. These are register choices, not
 * errors.
 */

const STYLE_RULE = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" } as const;
/** A preposition after "wiodący" makes it "leading to" ("droga wiodąca do lasu"). */
const ROUTE =
  "do|ku|przez|poprzez|na|w|we|z|ze|od|wzdłuż|pod|nad|między|pomiędzy|obok|koło|prym|żywot\\p{L}*|życie|rej|tędy|dokąd|donikąd";
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
    pattern: `(?<target>wiodąc(?<end>y|a|e|ego|ej|emu|ą|ym|ych|ymi))${END}(?!(?:${S}\\p{L}+)?${S}(?:${ROUTE})${END})`,
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
    pattern: `(?=w${S}terminach)(?<=(?:^|[^\\p{L}])(?:${DESCRIBE})\\p{L}{0,8}(?:${S}\\p{L}{1,20}){0,3}${S})(?<target>w${S}terminach)(?=${S}\\p{L})`,
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
    pattern: `(?<target>na${S}okoliczność)(?=${S}\\p{L})`,
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
    pattern: `cof\\p{L}{0,6}${S}się(?:${S}\\p{L}{1,12}){1,2}(?<target>${S}(?:wstecz|do${S}tyłu|w${S}tył))${END}`,
    fix: "",
    ...STYLE_RULE,
  },
];

export const PREDICATES = {
  officialese: (ctx: DetectContext) => runFrames(ctx, FRAMES),
} satisfies Record<string, Detector>;
