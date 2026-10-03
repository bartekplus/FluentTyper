import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, isLang, SPACE as S } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { graphWords } from "../wordGraph";
import {
  PORTUGUESE_AR_STEMS,
  PORTUGUESE_ER_STEMS,
  PORTUGUESE_IR_STEMS,
} from "./verbStems.generated";

/**
 * The subjunctive after words that govern it, where an indicative was written:
 * - after a wish, request, fear or doubt and "que" ("Espero que você está bem" -> "esteja",
 *   "Peço que a equipe chega cedo" -> "chegue"), and a concessive or conditional conjunction
 *   ("Embora tem", "Caso parece", "Talvez ele vem");
 * - the imperfect subjunctive after the same verbs in a past or conditional tense ("Queria que
 *   ele vem" -> "viesse", "Gostaria que vocês ficam" -> "ficassem").
 * The verb of the clause is the first word after an optional subject (a pronoun, a name, or a
 * determiner and its noun), a few adverbs and an object pronoun. Regular verbs are only told
 * from nouns through the stems of everyday verbs (verbStems.generated.ts); a stem shared by an
 * -ar and an -er/-ir verb (sentar/sentir: "sente") stays out.
 */

// Present and imperfect subjunctive of the irregular indicatives (present, and imperfect for
// past governors). "vão" and "vamos" are spelled alike in both moods.
const IRREGULAR: Record<string, [present: string | null, past: string]> = {};
for (const row of [
  "é seja fosse|são sejam fossem|sou seja fosse|somos sejamos fôssemos|és sejas fosses",
  "era - fosse|eram - fossem|éramos - fôssemos",
  "está esteja estivesse|estão estejam estivessem|estou esteja estivesse|estamos estejamos estivéssemos|estás estejas estivesses",
  "estava - estivesse|estavam - estivessem",
  "tem tenha tivesse|têm tenham tivessem|tenho tenha tivesse|temos tenhamos tivéssemos|tens tenhas tivesses",
  "tinha - tivesse|tinham - tivessem",
  "vai vá fosse|vou vá fosse|vais vás fosses|ia - fosse|iam - fossem",
  "vem venha viesse|vêm venham viessem|venho venha viesse|vens venhas viesses|vinha - viesse|vinham - viessem",
  "pode possa pudesse|podem possam pudessem|posso possa pudesse|podemos possamos pudéssemos|podes possas pudesses",
  "podia - pudesse|podiam - pudessem",
  "sabe saiba soubesse|sabem saibam soubessem|sei saiba soubesse|sabemos saibamos soubéssemos|sabes saibas soubesses",
  "faz faça fizesse|fazem façam fizessem|faço faça fizesse|fazemos façamos fizéssemos|fazes faças fizesses",
  "diz diga dissesse|dizem digam dissessem|digo diga dissesse|dizemos digamos disséssemos",
  "quer queira quisesse|querem queiram quisessem|quero queira quisesse|queremos queiramos quiséssemos|queres queiras quisesses",
  "há haja houvesse|havia - houvesse",
  "dá dê desse|dão deem dessem|dou dê desse|damos - déssemos|dás dês desses",
  "vê veja visse|veem vejam vissem|vejo veja visse|vemos vejamos víssemos|vês vejas visses",
  "traz traga trouxesse|trazem tragam trouxessem|trago traga trouxesse|trazemos tragamos trouxéssemos",
  "põe ponha pusesse|põem ponham pusessem|ponho ponha pusesse|pomos ponhamos puséssemos",
  "ouve ouça ouvisse|ouvem ouçam ouvissem|ouço ouça ouvisse",
  "pede peça pedisse|pedem peçam pedissem|peço peça pedisse",
  "perde perca perdesse|perdem percam perdessem|perco perca perdesse",
  "lê leia lesse|leem leiam lessem|leio leia lesse",
  "crê creia cresse|creem creiam cressem|creio creia cresse",
  "cabe caiba coubesse|cabem caibam coubessem",
  "vale valha valesse|valem valham valessem",
  "dorme durma dormisse|dormem durmam dormissem|durmo durma dormisse",
  "sobe suba subisse|sobem subam subissem",
  "foge fuja fugisse|fogem fujam fugissem",
  "consome consuma consumisse|consomem consumam consumissem",
  "some suma sumisse|somem sumam sumissem",
  "cobre - cobrisse|cobrem - cobrissem",
  "chove chova chovesse",
].flatMap((line) => line.split("|"))) {
  const [form, present, past] = row.split(" ");
  IRREGULAR[form] = [present === "-" ? null : present, past];
}

let stems: { ar: Set<string>; er: Set<string>; ir: Set<string> } | undefined;
export const verbStems = () =>
  (stems ??= {
    ar: new Set(graphWords(PORTUGUESE_AR_STEMS)),
    er: new Set(graphWords(PORTUGUESE_ER_STEMS)),
    ir: new Set(graphWords(PORTUGUESE_IR_STEMS)),
  });

// -er/-ir stems with an irregular subjunctive (fazer, ter, ver, vir, pôr and their compounds),
// handled by IRREGULAR or left alone.
export const IRREGULAR_STEM =
  /(?:faz|diz|traz|sab|cab|pod|quer|perd|val|hav|jaz|praz|ped|med|ouv)$|^(?:man|con|ob|de|re|entre|a|abs|sus)?t$|^(?:pre|re|inter|con|pro|ad|sobre)?v$|^(?:re)?l$|^cr$|^s$/;

type Person = "1s" | "2s" | "3s" | "1p" | "3p";
const ENDINGS: Record<
  "ar" | "er" | "ir",
  { present: Record<string, Person>; imperfect: Record<string, Person> }
> = {
  ar: {
    present: { a: "3s", am: "3p", as: "2s", o: "1s", amos: "1p" },
    imperfect: { ava: "3s", avam: "3p", avas: "2s", ávamos: "1p" },
  },
  er: {
    present: { e: "3s", em: "3p", es: "2s", o: "1s", emos: "1p" },
    imperfect: { ia: "3s", iam: "3p", ias: "2s", íamos: "1p" },
  },
  ir: {
    present: { e: "3s", em: "3p", es: "2s", o: "1s", imos: "1p" },
    imperfect: { ia: "3s", iam: "3p", ias: "2s", íamos: "1p" },
  },
};
const SUBJUNCTIVE_ENDINGS: Record<"ar" | "er", Record<Person, string>> = {
  ar: { "1s": "e", "2s": "es", "3s": "e", "1p": "emos", "3p": "em" },
  er: { "1s": "a", "2s": "as", "3s": "a", "1p": "amos", "3p": "am" },
};
const PAST_ENDINGS: Record<Person, string> = {
  "1s": "sse",
  "2s": "sses",
  "3s": "sse",
  "1p": "ssemos",
  "3p": "ssem",
};
const PAST_VOWEL = { ar: ["a", "á"], er: ["e", "ê"], ir: ["i", "í"] } as const;

type Reading = { present: string | null; past: string; person: Person | null };

/** The subjunctive forms of a regular indicative form, or null when it is none. */
function regular(word: string): Reading | null {
  const { ar, er, ir } = verbStems();
  for (const conjugation of ["ar", "er", "ir"] as const) {
    for (const tense of ["present", "imperfect"] as const) {
      for (const [ending, person] of Object.entries(ENDINGS[conjugation][tense])) {
        if (!word.endsWith(ending)) continue;
        let stem = word.slice(0, -ending.length);
        // "passeia", "receiam": -ear verbs add an i under stress.
        if (conjugation === "ar" && tense === "present" && /ei$/.test(stem) && person !== "1p")
          stem = stem.slice(0, -1);
        const own = conjugation === "ar" ? ar : conjugation === "er" ? er : ir;
        if (!own.has(stem) || stem.length < 2) continue;
        // A stem of two conjugations reads both ways: "sente" (sentir, sentar), "venda".
        const others = [ar, er, ir].filter((set) => set !== own);
        if (others.some((set) => set.has(stem))) return null;
        if (conjugation !== "ar" && IRREGULAR_STEM.test(stem)) return null;
        const [vowel, accented] = PAST_VOWEL[conjugation];
        const past = `${stem}${person === "1p" ? accented : vowel}${PAST_ENDINGS[person]}`;
        return {
          present: tense === "present" ? presentOf(stem, conjugation, person) : null,
          past,
          person,
        };
      }
    }
  }
  return null;
}

/** The present subjunctive from a stem: "cheg" -> "chegue", "conhec" -> "conheça", "sent" -> "sinta". */
function presentOf(stem: string, conjugation: "ar" | "er" | "ir", person: Person): string {
  if (conjugation === "ar") {
    const written = stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c");
    // "passear" -> "passeie", but "passeemos".
    const stress = /e$/.test(stem) && person !== "1p" ? "i" : "";
    return `${written}${stress}${SUBJUNCTIVE_ENDINGS.ar[person]}`;
  }
  return `${firstPersonStem(stem, conjugation)}${SUBJUNCTIVE_ENDINGS.er[person]}`;
}

/** The stem of the first person present of an -er/-ir verb: "conhec" -> "conheç", "sent" -> "sint". */
export function firstPersonStem(stem: string, conjugation: "er" | "ir"): string {
  let first = stem;
  if (conjugation === "ir") {
    // -ir verbs raise a last stem "e" to "i": sentir -> sinto, seguir -> sigo, preferir -> prefiro;
    // and an "o" to "u" in a few: dormir -> durmo, cobrir -> cubro.
    first = first.replace(/e([^aeiou]+u?)$/, "i$1");
    if (/(?:dorm|cobr|toss|engol)$/.test(first)) first = first.replace(/o([^aeiou]+)$/, "u$1");
  }
  if (/gu$/.test(first)) return first.slice(0, -1);
  if (/qu$/.test(first)) return `${first.slice(0, -2)}c`;
  return first.replace(/c$/, "ç").replace(/g$/, "j");
}

function reading(word: string): Reading | null {
  const irregular = IRREGULAR[word];
  if (irregular) return { present: irregular[0], past: irregular[1], person: null };
  return regular(word);
}

// -------------------------------------------------------------- the clause after the governor

const PRONOUNS: Record<string, Person> = {
  eu: "1s",
  tu: "2s",
  ele: "3s",
  ela: "3s",
  você: "3s",
  "a gente": "3s",
  isso: "3s",
  isto: "3s",
  aquilo: "3s",
  tudo: "3s",
  nada: "3s",
  ninguém: "3s",
  alguém: "3s",
  algo: "3s",
  nós: "1p",
  eles: "3p",
  elas: "3p",
  vocês: "3p",
  todos: "3p",
  todas: "3p",
};
const DETERMINERS = new Set(
  `o a os as um uma uns umas este esta estes estas esse essa esses essas aquele aquela aqueles
  aquelas meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas
  muitos muitas alguns algumas poucos poucas vários várias cada nenhum nenhuma`.split(/\s+/),
);
// Words after a determiner that are no noun: "o que", "o mesmo", "os dois" stays a noun.
const NOT_NOUNS = new Set(
  "que qual quais quanto mesmo mesma mesmos mesmas outro outra outros outras próprio própria".split(
    " ",
  ),
);
const ADVERBS = new Set(
  "não já ainda também realmente sempre nunca só apenas mesmo logo até enfim afinal sequer bem".split(
    " ",
  ),
);
const CLITICS = new Set("me te se lhe lhes nos vos o a os as".split(" "));
// "Espero que a sala limpa esteja pronta": an adjective, not the verb, when one of these follows.
const VERB_NEXT = new Set(
  `seja sejam esteja estejam fique fiquem fosse fossem estivesse estivessem ficasse ficassem é são
  está estão era eram foi foram fica ficam ficou parece parecem pareça continue tenha tenham tem
  têm possa possam pode podem deve devem vá vai vão venha venham`.split(/\s+/),
);

const TOKEN = /[\p{L}]+(?:-[\p{L}]+)*|[^\s\p{L}]/uy;

type Clause = {
  start: number;
  end: number;
  word: string;
  person: Person | null;
  afterNoun: boolean;
};

/** The verb of the clause that starts at `from`: after its subject, adverbs and a clitic. */
function clauseVerb(text: string, from: number): Clause | null {
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  let pos = from;
  while (tokens.length < 10 && pos < text.length && pos < from + 160) {
    const space = /[ \t ]*/y;
    space.lastIndex = pos;
    space.exec(text);
    TOKEN.lastIndex = space.lastIndex;
    const m = TOKEN.exec(text);
    if (!m) break;
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    pos = m.index + m[0].length;
  }
  const lower = (i: number) => tokens[i]?.word.toLowerCase();
  const capitalized = (i: number) =>
    tokens[i] !== undefined && /^\p{Lu}\p{Ll}/u.test(tokens[i].word);
  let i = 0;
  let person: Person | null = null;
  let afterNoun = false;
  if (lower(0) === "a" && lower(1) === "gente") {
    person = "3s";
    i = 2;
  } else if (/^tod[oa]s$/.test(lower(0) ?? "") && /^[oa]s$/.test(lower(1) ?? "")) {
    i = 3;
    person = "3p";
    afterNoun = true;
  } else if (PRONOUNS[lower(0)] && tokens[0].word === lower(0)) {
    person = PRONOUNS[lower(0)];
    i = 1;
  } else if (DETERMINERS.has(lower(0)) && tokens[0].word === lower(0)) {
    const noun = tokens[1]?.word;
    // "a Maria", "o João Pedro".
    if (!noun || (!/^\p{Ll}{2,}$/u.test(noun) && !capitalized(1)) || NOT_NOUNS.has(noun))
      return null;
    person = /s$/.test(lower(0)) ? "3p" : "3s";
    afterNoun = true;
    i = 2;
    while (capitalized(i)) i++;
    if (/^d[oa]s?$|^de$/.test(lower(i) ?? "") && /^\p{L}+$/u.test(tokens[i + 1]?.word ?? ""))
      i += 2;
  } else if (capitalized(0)) {
    person = "3s";
    afterNoun = true;
    i = 1;
    while (capitalized(i)) i++;
  }
  // "no final", "no fim": a short adverbial before the verb.
  if (lower(i) === "no" && /^(?:final|fim)$/.test(lower(i + 1) ?? "")) i += 2;
  for (let adverbs = 0; adverbs < 2 && ADVERBS.has(lower(i)); adverbs++) i++;
  if (CLITICS.has(lower(i)) && tokens[i + 1] && /^\p{Ll}/u.test(tokens[i + 1].word)) i++;
  const target = tokens[i];
  if (!target || !/^\p{Ll}+$/u.test(target.word)) return null;
  if (afterNoun && VERB_NEXT.has(lower(i + 1))) return null;
  return { ...target, person, afterNoun };
}

/** Whether `reading`'s person fits the subject found ("-o" only after "eu"). */
function fits(form: string, read: Reading, subject: Person | null): boolean {
  if (read.person === null) return true;
  if (subject) return read.person === subject;
  // No subject: the ending alone names the person; "-o" is as often a noun.
  return read.person !== "1s" && !/o$/.test(form);
}

// -------------------------------------------------------------- governors

const PRESENT_GOVERNORS = [
  "espero|esperamos|esperam|espera-se|desejo|desejamos|desejam|deseja|deseja-se",
  "quero|queremos|querem|quer|peço|pedimos|pedem|pede|pede-se|exijo|exigimos|exigem|exige",
  "proíbo|proibimos|proíbem|proíbe|duvido|duvidamos|duvidam|prefiro|preferimos|preferem",
  "sugiro|sugerimos|sugerem|sugere|recomendo|recomendamos|recomendam|recomenda|proponho",
  "propomos|propõem|propõe|temo|tememos|temem|evito|evitamos|evitam|evita|evitaremos|nego",
  "negamos|negam|nega|negas|tomara|oxalá|permito|permite|permitem|impede|impedem|impeço",
  `não${S}(?:acho|creio|penso|suponho|acredito)`,
  `é${S}(?:preciso|necessário|importante|possível|provável|fundamental|essencial|imprescindível|bom|natural|normal|urgente)`,
].join("|");
const PAST_GOVERNORS = [
  "esperava|esperavam|esperávamos|esperei|esperou|esperaram|desejava|desejavam|desejei|desejou",
  "queria|queriam|queríamos|quis|quisemos|quiseram|quisera|pedia|pediam|pedi|pediu|pediram",
  "exigia|exigiam|exigi|exigiu|exigiram|proibia|proibi|proibiu|proibiram|proibiria|duvidava",
  "duvidei|duvidou|preferia|preferiam|preferi|preferiu|sugeria|sugeri|sugeriu|sugeriram",
  "recomendava|recomendei|recomendou|propunha|propus|propôs|propuseram|temia|temiam|temi",
  "temeu|evitava|evitei|evitou|evitaria|evitaríamos|negava|negou|neguei|desejaria|gostaria",
  "gostaríamos|gostariam|preferiria|permitia|permitiu|impedia|impediu|mandou|mandava",
  `(?:era|foi|seria)${S}(?:preciso|necessário|importante|possível|provável|fundamental|essencial|imprescindível|bom|natural|melhor)`,
].join("|");
// Conjunctions that take the present subjunctive.
const CONJUNCTIONS = `embora|conquanto|caso|talvez|nem${S}que|a${S}não${S}ser${S}que|a${S}menos${S}que|sem${S}que|antes${S}que|contanto${S}que|desde${S}que(?=${S}(?:não${S})?(?:haja|tenha|seja|esteja|ele|ela|você|eu|nós|eles|elas|vocês))|ainda${S}que|mesmo${S}que`;
// "no caso", "o mesmo que", "acho ainda que": these read as conjunctions only opening a clause.
const CLAUSE_ONLY = /^(?:caso|ainda|mesmo|antes)/i;
const CLAUSE_BEFORE = /(?:^|[.!?;:,\n]["'”’»)]*)[ \t ]*$/u;
const DETERMINER_BEFORE =
  /(?:^|[^\p{L}])(?:o|a|os|as|um|uma|do|da|no|na|ao|pelo|pela|este|esse|aquele|meu|seu|nosso|cada|qualquer|tal|neste|nesse|desse|deste|em|de)[ \t ]+$/iu;

const FRAMES: Array<{ pattern: string; past: boolean }> = [
  { pattern: `(?<lead>${PRESENT_GOVERNORS})${S}que(?=[ \\t\\u00a0])`, past: false },
  { pattern: `(?<lead>${PAST_GOVERNORS})${S}que(?=[ \\t\\u00a0])`, past: true },
  { pattern: `(?<lead>${CONJUNCTIONS})(?=[ \\t\\u00a0])`, past: false },
];

export function subjunctives(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const { pattern, past } of FRAMES) {
    for (const m of frameMatches(ctx, pattern, "lead")) {
      const lead = m.groups!.lead;
      const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
      if (DETERMINER_BEFORE.test(before)) continue;
      if (CLAUSE_ONLY.test(lead) && !CLAUSE_BEFORE.test(before)) continue;
      // "Espera que eu já volto": a sentence-opening "espera" is the imperative "wait".
      if (/^esper[ae]$/i.test(lead) && CLAUSE_BEFORE.test(before)) continue;
      const clause = clauseVerb(ctx.text, m.index + m[0].length);
      if (!clause || ctx.dictionary.has(clause.word)) continue;
      const read = reading(clause.word);
      if (!read || !fits(clause.word, read, clause.person)) continue;
      const wanted = past ? read.past : read.present;
      if (!wanted || wanted === clause.word) continue;
      findings.push({
        ruleId: "portugueseAgreement",
        messageKey: "review_msg_pt_subjunctive",
        range: { start: clause.start, end: clause.end },
        alternatives: [applyWordCase(wanted, detectWordCase(clause.word))],
        context: { start: m.index, end: clause.end },
      });
    }
  }
  return findings;
}
