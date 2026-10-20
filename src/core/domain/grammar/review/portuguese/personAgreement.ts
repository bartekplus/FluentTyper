import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { FORM_ROWS, NOT_SUBJECT, NOT_VERBS } from "./agreement";
import { firstPersonStem, IRREGULAR_STEM, verbStems } from "./subjunctive";
import { SENTENCE_START } from "./nounAgreement";

/**
 * A regular verb in the person of its pronoun subject, in the present, imperfect and preterite:
 * "Eu passeiam" -> "passeio", "Tu não falam" -> "falas", "Nós come" -> "comemos", "A gente
 * vamos" is agreement.ts's; "Eu e a Rita viajam" -> "viajamos". The verb is told by the stems of
 * everyday verbs (verbStems.generated.ts); a form two conjugations or tenses share for
 * different persons stays alone, and so does the first person singular after a third-person
 * pronoun ("ele trabalho" may be the noun). The frames are in grammar/rules/pt_BR.yaml.
 */

type Person = "1s" | "2s" | "3s" | "1p" | "3p";
type Conjugation = "ar" | "er" | "ir";
type Tense = "present" | "imperfect" | "preterite";
const PERSONS: Person[] = ["1s", "2s", "3s", "1p", "3p"];
const ENDINGS: Record<Conjugation, Record<Tense, string[]>> = {
  ar: {
    present: ["o", "as", "a", "amos", "am"],
    imperfect: ["ava", "avas", "ava", "ávamos", "avam"],
    preterite: ["ei", "aste", "ou", "amos", "aram"],
  },
  er: {
    present: ["o", "es", "e", "emos", "em"],
    imperfect: ["ia", "ias", "ia", "íamos", "iam"],
    preterite: ["i", "este", "eu", "emos", "eram"],
  },
  ir: {
    present: ["o", "es", "e", "imos", "em"],
    imperfect: ["ia", "ias", "ia", "íamos", "iam"],
    preterite: ["i", "iste", "iu", "imos", "iram"],
  },
};
// Imperfects of crer, ler, ver and rir spelled like presents of criar, liar, viar, riar.
const OTHER_IMPERFECTS = new Set(
  "cria crias criam lia lias liam via vias viam ria rias riam".split(" "),
);
// -iar verbs conjugated like -ear (odeio, anseio).
const LIKE_EAR = /^(?:odi|ansi|remedi|medi|incendi|intermedi)$/;

let firstPersonForms: Map<string, Array<["er" | "ir", string]>> | undefined;
/** "conheço" -> [["er", "conhec"]]: the first person present of the regular -er/-ir verbs. */
function firstPersons(): Map<string, Array<["er" | "ir", string]>> {
  if (firstPersonForms) return firstPersonForms;
  firstPersonForms = new Map();
  const sets = verbStems();
  for (const conjugation of ["er", "ir"] as const)
    for (const stem of sets[conjugation]) {
      if (IRREGULAR_STEM.test(stem)) continue;
      const form = `${firstPersonStem(stem, conjugation)}o`;
      firstPersonForms.set(form, [...(firstPersonForms.get(form) ?? []), [conjugation, stem]]);
    }
  return firstPersonForms;
}

type Analysis = { conjugation: Conjugation; stem: string; tense: Tense; persons: Set<Person> };

/** Every reading of `word` as a regular form of an everyday verb. */
function analyses(word: string): Analysis[] {
  const sets = verbStems();
  const found: Analysis[] = [];
  for (const conjugation of ["ar", "er", "ir"] as const) {
    for (const tense of ["present", "imperfect", "preterite"] as const) {
      ENDINGS[conjugation][tense].forEach((ending, index) => {
        if (!word.endsWith(ending)) return;
        let stem = word.slice(0, -ending.length);
        // "passeia", "passeio": -ear verbs add an i under stress.
        if (conjugation === "ar" && tense === "present" && index !== 3 && /ei$/.test(stem))
          stem = stem.slice(0, -1);
        // "fiquei", "cheguei", "comecei".
        if (conjugation === "ar" && tense === "preterite" && index === 0)
          stem = /[qg]u$/.test(stem)
            ? stem.slice(0, -1).replace(/q$/, "c")
            : stem.replace(/c$/, "ç");
        if (!sets[conjugation].has(stem) || stem.length < 2 || LIKE_EAR.test(stem)) return;
        // "estar" and "dar" are irregular.
        if (conjugation === "ar" && /^(?:est|d)$/.test(stem)) return;
        if (conjugation !== "ar" && IRREGULAR_STEM.test(stem)) return;
        // "sair", "construir", "roer": a stem ending in a vowel conjugates on its own.
        if (conjugation !== "ar" && /(?:[aeoi]|(?<![gq])u)$/.test(stem)) return;
        // "conheço", "sinto": the first person present has its own stem.
        if (conjugation !== "ar" && tense === "present" && index === 0) return;
        const existing = found.find(
          (a) => a.conjugation === conjugation && a.stem === stem && a.tense === tense,
        );
        if (existing) existing.persons.add(PERSONS[index]);
        else found.push({ conjugation, stem, tense, persons: new Set([PERSONS[index]]) });
      });
    }
  }
  // The first person present of -er/-ir verbs: "conheço" -> "conhec", "sinto" -> "sent".
  for (const [conjugation, stem] of firstPersons().get(word) ?? [])
    found.push({ conjugation, stem, tense: "present", persons: new Set(["1s"]) });
  return found;
}

/** The regular form of `analysis`'s verb and tense for `person`. */
function inflect({ conjugation, stem, tense }: Analysis, person: Person): string {
  const index = PERSONS.indexOf(person);
  const ending = ENDINGS[conjugation][tense][index];
  if (conjugation === "ar") {
    if (tense === "present" && index !== 3 && /e$/.test(stem)) return `${stem}i${ending}`;
    if (tense === "preterite" && index === 0)
      return `${stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c")}${ending}`;
    return `${stem}${ending}`;
  }
  if (tense === "present" && index === 0) return `${firstPersonStem(stem, conjugation)}o`;
  // "produz", "conduz": -uzir verbs drop the e of the third person singular.
  if (tense === "present" && index === 2 && /uz$/.test(stem)) return stem;
  return `${stem}${ending}`;
}

const PRONOUNS: Record<string, Person> = {
  eu: "1s",
  tu: "2s",
  ele: "3s",
  ela: "3s",
  você: "3s",
  nós: "1p",
  eles: "3p",
  elas: "3p",
  vocês: "3p",
};
const KNOWN = new Set(
  "eu e tu ele ela você eles elas vocês o a os as meu minha meus minhas".split(" "),
);
const DETERMINER = /^(?:o|a|os|as|meu|minha|meus|minhas)$/i;
const PLURAL_LEAD =
  /^(?:os|as|uns|umas|estes|estas|esses|essas|aqueles|aquelas|meus|minhas|seus|suas|nossos|nossas|alguns|algumas|muitos|muitas|vários|várias)$/i;
/** Frames ignore case: a word that is no pronoun and follows no determiner is a name. */
function namesCapitalized(subject: string): boolean {
  const words = subject.split(/[ \t ]+/);
  return words.every(
    (word, i) =>
      KNOWN.has(word.toLowerCase()) || DETERMINER.test(words[i - 1] ?? "") || /^\p{Lu}/u.test(word),
  );
}
// "e eu" belongs to WE_SUBJECT; "em nós", "estes nós" (knots), "mais do que eu" are no subject.
const NOT_PRONOUN_SUBJECT =
  /(?:(?:^|[^\p{L}])(?:e|em|estes|estas|esses|essas|aqueles|aquelas|dos|pelos|seus|meus|nossos|vários|muitos)|(?:do|mais|menos|melhor|pior|maior|menor|tanto|tão)[ \t ]+que)[ \t ]+$/iu;

// Heads that may agree with the plural after them: "A maioria dos alunos passaram".
const COLLECTIVE = new Set(
  "maioria minoria parte metade grupo porcentagem percentagem conjunto série totalidade resto número quantidade multidão bando dezena centena milhar milhão bilhão trilhão".split(
    " ",
  ),
);

/** Whether `word` reads as a finite verb: then the word before it was no verb. */
const isVerb = (word: string) => FORM_ROWS.has(word) || analyses(word).length > 0;

function check(ctx: DetectContext, m: RegExpExecArray, subject: Person): RawFinding | null {
  const target = m.groups!.target;
  if (
    target !== target.toLowerCase() ||
    ctx.dictionary.has(target) ||
    NOT_VERBS.has(target) ||
    OTHER_IMPERFECTS.has(target)
  )
    return null;
  const found = analyses(target);
  if (found.length === 0 || found.some((a) => a.persons.has(subject))) return null;
  // One verb and tense only; "-o" after a third person may be a noun ("ela trabalho").
  const [first] = found;
  if (found.some((a) => a.stem !== first.stem || a.tense !== first.tense)) return null;
  if (found.some((a) => a.conjugation !== first.conjugation)) return null;
  if (/o$/.test(target) && first.tense === "present" && subject !== "1p" && subject !== "2s")
    return null;
  const wanted = inflect(first, subject);
  if (wanted === target) return null;
  const [start, end] = m.indices!.groups!.target;
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_agreement",
    range: { start, end },
    alternatives: [applyWordCase(wanted, detectWordCase(target))],
    context: { start: m.index, end },
  };
}

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  personPronounSubject: (m, ctx) => {
    const pronoun = m.groups!.pronoun;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before) || NOT_PRONOUN_SUBJECT.test(before)) return null;
    // "Eu" capitalized inside a sentence is a noun; "e eu" belongs to WE_SUBJECT.
    if (/^\p{Lu}/u.test(pronoun) && !SENTENCE_START.test(before)) return null;
    const after = ctx.text.slice(m.indices!.groups!.pronoun[1], m.indices!.groups!.pronoun[1] + 8);
    if (/^[ \t\u00a0]+e(?![\p{L}])/u.test(after)) return null;
    return check(ctx, m, PRONOUNS[pronoun.toLowerCase()]);
  },
  personNounSubject: (m, ctx) => {
    const { lead, noun } = m.groups!;
    if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) return null;
    if (lead.slice(1) !== lead.slice(1).toLowerCase() || noun !== noun.toLowerCase()) return null;
    if (COLLECTIVE.has(noun) || NOT_VERBS.has(noun)) return null;
    const plural = PLURAL_LEAD.test(lead);
    if (/s$/.test(noun) !== plural) return null;
    // "Os livros de capa dura custam": an adjective, not the verb, when a verb follows.
    const [, end] = m.indices!.groups!.target;
    const next = /^[ \t\u00a0]+(\p{Ll}+)/u.exec(ctx.text.slice(end, end + 30))?.[1];
    if (next && isVerb(next)) return null;
    // Only third persons trade places here: "-as" or "-o" after a noun may be no verb.
    if (!analyses(m.groups!.target).every((a) => a.persons.has("3s") || a.persons.has("3p")))
      return null;
    return check(ctx, m, plural ? "3p" : "3s");
  },
  personWeSubject: (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before) && !SENTENCE_START.test(before)) return null;
    if (!namesCapitalized(m.groups!.we)) return null;
    return check(ctx, m, "1p");
  },
} satisfies Record<string, MatchFixer>;
