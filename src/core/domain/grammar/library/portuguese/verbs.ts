// The rule library (library.ts): Portuguese verbs. The stems of the everyday verbs, the forms
// of the irregular ones, and the conjugation of a form into another tense, mood or person.
import { wordTable } from "../../review/wordTable";
import { graphWords } from "../../review/wordGraph";
import type * as Forms from "../../review/portuguese/verbs.generated";
import type * as Data from "../../review/portuguese/verbStems.generated";
import { reviewData } from "../../review/reviewLanguageData";

/** A grammatical person: first, second or third, singular or plural. */
export type PtPerson = "1s" | "2s" | "3s" | "1p" | "3p";
type Conjugation = "ar" | "er" | "ir";

let stems: { ar: Set<string>; er: Set<string>; ir: Set<string> } | undefined;
/** The stems of the everyday -ar, -er and -ir verbs (infinitive minus its ending). */
export const ptVerbStems = () =>
  (stems ??= {
    ar: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_AR_STEMS)),
    er: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_ER_STEMS)),
    ir: new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_IR_STEMS)),
  });

let rStems: Set<string> | undefined;
/** A verb stem ending in a vowel and r (esper, quer, prefer): its finite forms end like a
 * personal infinitive. */
export const ptRStem = (stem: string): boolean =>
  (rStems ??= new Set(graphWords(reviewData<typeof Forms>("pt").PORTUGUESE_R_STEMS))).has(stem);

/** The infinitive of a finite form ("fala" -> "falar", "dormi" -> "dormir"), or null. */
export function ptInfinitive(word: string): string | null {
  const own = ptVerbStems();
  const stem = word.slice(0, -1);
  const vowel = word.slice(-1);
  const ar = vowel === "a" && own.ar.has(stem);
  const er = vowel !== "a" && own.er.has(stem);
  const ir = vowel !== "a" && own.ir.has(stem);
  if (Number(ar) + Number(er) + Number(ir) !== 1) return null;
  return `${stem}${ar ? "ar" : er ? "er" : "ir"}`;
}

// -------------------------------------------------------------- frequent irregular verbs

// Frequent irregular verbs, one row per tense: first singular, third singular, first plural,
// third plural.
const CONJUGATIONS = [
  "sou é somos são",
  "fui foi fomos foram",
  "era era éramos eram",
  "serei será seremos serão",
  "estou está estamos estão",
  "estive esteve estivemos estiveram",
  "estava estava estávamos estavam",
  "vou vai vamos vão",
  "ia ia íamos iam",
  "tenho tem temos têm",
  "tive teve tivemos tiveram",
  "tinha tinha tínhamos tinham",
  "faço faz fazemos fazem",
  "fiz fez fizemos fizeram",
  "fazia fazia fazíamos faziam",
  "posso pode podemos podem",
  "pude pôde pudemos puderam",
  "podia podia podíamos podiam",
  "quero quer queremos querem",
  "quis quis quisemos quiseram",
  "queria queria queríamos queriam",
  "sei sabe sabemos sabem",
  "soube soube soubemos souberam",
  "sabia sabia sabíamos sabiam",
  "dou dá damos dão",
  "dei deu demos deram",
  "dava dava dávamos davam",
  "digo diz dizemos dizem",
  "disse disse dissemos disseram",
  "dizia dizia dizíamos diziam",
].map((row) => row.split(" "));
/** The columns of a row of PT_FORM_ROWS. */
export const PT_ROW_PERSONS: readonly string[] = ["eu", "ele", "nós", "eles"];
/** Each form of a frequent irregular verb -> the rows (tenses) it belongs to: first singular,
 * third singular, first plural, third plural. */
export const PT_FORM_ROWS: ReadonlyMap<string, readonly (readonly string[])[]> = (() => {
  const rows = new Map<string, string[][]>();
  for (const row of CONJUGATIONS)
    for (const form of new Set(row)) rows.set(form, [...(rows.get(form) ?? []), row]);
  return rows;
})();

/** Words ending in -a or -e that are no verb after a pronoun: pronouns, adverbs, prepositions,
 * numbers, "pra". */
export const PT_NOT_VERBS: ReadonlySet<string> = new Set(
  `se me te lhe de que bastante breve e a da na pela para pra sobre sempre hoje ainda agora nunca lá cá onde
  quase toda cada nada contra entre desde enquanto essa esta aquela uma outra nenhuma alguma
  este esse aquele tarde noite longe dentre ante diante adiante mesma mesme ora sete nove onze
  doze treze quinze dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta
  sessenta setenta oitenta noventa duzentas trezentas tampouco cedo pouca muita tanta toda
  sozinha juntas juntos fora embora talvez agorinha aqui ali logo ontem ou meu teu seu céu
  réu véu chapéu troféu museu europeu`.split(/\s+/),
);
/** Words ending in -em that are no plural verb. */
export const PT_NOT_PLURAL_VERBS: ReadonlySet<string> = new Set(
  `também porém além aquém alguém ninguém quem nem sem bem cem ontem homem jovem nuvem ordem
  item trem refém harém armazém vintém desdém virgem`.split(/\s+/),
);

/** The singular form of a third person plural for "eu" or a third person, or undefined when
 * irregular ("gostam" -> "gosto" or "gosta"). */
export function ptSingularVerb(plural: string, firstPerson: boolean): string | undefined {
  // "constroem" -> "constrói" (construir).
  const oi = /^(\p{L}+)oem$/u.exec(plural)?.[1];
  if (oi && !firstPerson && ptInfinitive(`${oi}ui`)) return `${oi}ói`;
  if (/(?:gem|eem|oem)$/.test(plural)) return undefined;
  if (firstPerson) {
    if (/avam$/.test(plural)) return plural.slice(0, -1);
    if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ei`;
    if (/[^i]am$/.test(plural) && !/[eiá]ram$/.test(plural)) return `${plural.slice(0, -2)}o`;
    return undefined;
  }
  if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ou`;
  // "saíram" -> "saiu", "incluíram" -> "incluiu".
  if (/[au]íram$/.test(plural)) return `${plural.slice(0, -4)}iu`;
  if (/[eiíá]ram$/.test(plural)) return undefined;
  if (/zem$/.test(plural)) return plural.slice(0, -2);
  if (/aem$/.test(plural)) return `${plural.slice(0, -3)}ai`;
  // "seguem" -> "segue", but "possuem" -> "possui".
  if (/[gq]uem$/.test(plural)) return plural.slice(0, -1);
  if (/uem$/.test(plural)) return `${plural.slice(0, -3)}ui`;
  return plural.slice(0, -1);
}

/** The third person plural of a singular verb ("dança" -> "dançam", "saiu" -> "saíram"). */
export function ptPluralVerb(verb: string): string | undefined {
  for (const row of PT_FORM_ROWS.get(verb) ?? []) if (row[1] === verb) return row[3];
  if (PT_FORM_ROWS.has(verb)) return undefined;
  if (/ou$/.test(verb)) return `${verb.slice(0, -2)}aram`;
  if (/eu$/.test(verb)) return `${verb.slice(0, -2)}eram`;
  if (/[^a]iu$/.test(verb)) return `${verb.slice(0, -2)}iram`;
  // "saiu" -> "saíram", "inclui" -> "incluem", "constrói" -> "constroem".
  if (/[au]iu$/.test(verb)) return `${verb.slice(0, -2)}íram`;
  if (/[au]i$/.test(verb)) return `${verb.slice(0, -1)}em`;
  if (/ói$/.test(verb)) return `${verb.slice(0, -2)}oem`;
  if (/[^aeiou](?:a|e)$/.test(verb) || /(?:ia|ava)$/.test(verb)) return `${verb}m`;
  return undefined;
}

// -------------------------------------------------------------- finite forms

const words = (list: string) => new Set(list.split(/\s+/));
/** Words that are no finite verb: the PT_NOT_VERBS, weekdays, prepositions, colors. */
export const PT_NOT_FINITE: ReadonlySet<string> = words(
  `${[...PT_NOT_VERBS].join(" ")} dia semana segunda terça quarta quinta sexta forma vez maneira
  hora mesmo inclusive exceto sequer cerca perante durante mediante conforme sobre desde dele dela
  deles delas nele nela neles nelas tem vem violeta creme rosa laranja cinza vinho bege lilás
  turquesa prata`,
);

// Finite endings, and the vowels of the present singular that the verb stems check them with:
// "falam" -> "fala", "comeu" -> "come", "partiram" -> "parti", "deixei" -> "deixa".
const FINITE: [RegExp, string[]][] = [
  [/^(\p{L}{2,}?)(?:a|am|ou|aram|ava|avam|ei|amos)$/u, ["a"]],
  [/^(\p{L}{2,}?)(?:e|em|eu|eram)$/u, ["e"]],
  [/^(\p{L}{2,}?)(?:iu|iram)$/u, ["i"]],
  [/^(\p{L}{2,}?)(?:ia|iam)$/u, ["e", "i"]],
];

// Forms the regular endings miss: "sai", "saem", "saiu", "saíram" (sair), "inclui", "incluíram"
// (incluir), "constrói", "constroem" (construir).
const HIATUS = /^(\p{L}+[au])(?:i|em|iu|íram|ía|íam)$/u;
const OI = /^(\p{L}+)(?:ói|oem)$/u;

/** A finite verb: an irregular row, or a regular form of a known stem. */
export function ptFiniteVerb(w: string): boolean {
  if (PT_FORM_ROWS.has(w)) return true;
  if (PT_NOT_FINITE.has(w) || PT_NOT_PLURAL_VERBS.has(w)) return false;
  const hiatus = HIATUS.exec(w)?.[1];
  if (hiatus && ptInfinitive(`${hiatus}i`)?.endsWith("ir")) return true;
  const oi = OI.exec(w)?.[1];
  if (oi && ptInfinitive(`${oi}ui`)?.endsWith("ir")) return true;
  return FINITE.some(([ending, vowels]) => {
    const stem = ending.exec(w)?.[1];
    if (!stem) return false;
    if (vowels.some((vowel) => !!ptInfinitive(stem + vowel))) return true;
    // "sobe", "fogem", "cospe" (subir, fugir, cuspir): -ir verbs whose stem "u" reads "o".
    const u = stem.replace(/o([^aeiou]+)$/, "u$1");
    return u !== stem && /^(?:e|em)$/.test(w.slice(stem.length)) && !!ptInfinitive(`${u}i`);
  });
}

// -------------------------------------------------------------- future and past

const CONJUGATION: Record<string, Conjugation> = {
  ar: "ar",
  er: "er",
  ir: "ir",
  a: "ar",
  á: "ar",
  e: "er",
  ê: "er",
  i: "ir",
  í: "ir",
};

/** A future or pluperfect form whose stem is a known verb of its conjugation: "enviaras"
 * (envi-ar). */
export function ptKnownVerb(form: string): boolean {
  const m =
    /^(\p{L}+?)(ar|er|ir)(?:ás|emos|eis)$/u.exec(form) ??
    /^(\p{L}+?)([aeiáêí])r(?:as|eis)$/u.exec(form);
  return !!m && ptVerbStems()[CONJUGATION[m[2]]].has(m[1]);
}

/** The past forms of a future: "enviarão" -> "enviaram", "enviará" -> "enviou" or "enviara". */
export function ptPastOfFuture(future: string): string[] {
  const stem = future.replace(/(?:ão|ás|á|ei|emos|eis)$/, "");
  const vowel = stem.slice(-2, -1);
  if (/ão$/.test(future)) return [`${stem}am`];
  if (/ei$/.test(future)) return [`${stem.slice(0, -2)}${vowel === "a" ? "ei" : "i"}`];
  if (/emos$/.test(future)) return [`${stem.slice(0, -1)}mos`];
  if (/eis$/.test(future)) {
    const accented = ({ a: "á", e: "ê", i: "í" } as Record<string, string>)[vowel];
    return [`${stem.slice(0, -1)}stes`, `${stem.slice(0, -2)}${accented}reis`];
  }
  if (/ás$/.test(future)) return [`${stem.slice(0, -1)}ste`, `${stem}as`];
  const preterite = `${stem.slice(0, -2)}${{ a: "ou", e: "eu", i: "iu" }[vowel]}`;
  return [preterite, `${stem}a`];
}

/** The future of a past form: "enviaram" -> "enviarão", "enviara" -> "enviará". */
export function ptFutureOfPast(past: string): string {
  const plain: Record<string, string> = { á: "a", ê: "e", í: "i" };
  if (/reis$/.test(past)) return past.replace(/([áêí])reis$/, (_, v: string) => `${plain[v]}reis`);
  if (past.endsWith("m")) return `${past.slice(0, -2)}ão`;
  if (past.endsWith("s")) return `${past.slice(0, -2)}ás`;
  return `${past.slice(0, -1)}á`;
}

// -------------------------------------------------------------- the subjunctive

// Present and imperfect subjunctive of the irregular indicatives (present, and imperfect for
// past governors). "vão" and "vamos" are spelled alike in both moods.
const IRREGULAR: Record<string, [present: string | null, past: string]> = wordTable({});
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

/** -er/-ir stems with an irregular subjunctive (fazer, ter, ver, vir, pôr and their compounds). */
export const PT_IRREGULAR_STEM =
  /(?:faz|diz|traz|sab|cab|pod|quer|perd|val|hav|jaz|praz|ped|med|ouv)$|^(?:man|con|ob|de|re|entre|a|abs|sus)?t$|^(?:pre|re|inter|con|pro|ad|sobre)?v$|^(?:re)?l$|^cr$|^s$/;

const ENDINGS: Record<
  Conjugation,
  { present: Record<string, PtPerson>; imperfect: Record<string, PtPerson> }
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
const SUBJUNCTIVE_ENDINGS: Record<"ar" | "er", Record<PtPerson, string>> = {
  ar: { "1s": "e", "2s": "es", "3s": "e", "1p": "emos", "3p": "em" },
  er: { "1s": "a", "2s": "as", "3s": "a", "1p": "amos", "3p": "am" },
};
const PAST_ENDINGS: Record<PtPerson, string> = {
  "1s": "sse",
  "2s": "sses",
  "3s": "sse",
  "1p": "ssemos",
  "3p": "ssem",
};
const PAST_VOWEL = { ar: ["a", "á"], er: ["e", "ê"], ir: ["i", "í"] } as const;

/** The subjunctive forms of an indicative: the present (null for an imperfect), the imperfect,
 * and the person its ending names (null for an irregular form). */
export type PtSubjunctive = { present: string | null; past: string; person: PtPerson | null };

/** The subjunctive forms of a regular indicative form, or null when it is none. */
function regular(word: string): PtSubjunctive | null {
  const { ar, er, ir } = ptVerbStems();
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
        if (conjugation !== "ar" && PT_IRREGULAR_STEM.test(stem)) return null;
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
function presentOf(stem: string, conjugation: Conjugation, person: PtPerson): string {
  if (conjugation === "ar") {
    const written = stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c");
    // "passear" -> "passeie", but "passeemos".
    const stress = /e$/.test(stem) && person !== "1p" ? "i" : "";
    return `${written}${stress}${SUBJUNCTIVE_ENDINGS.ar[person]}`;
  }
  return `${ptFirstPersonStem(stem, conjugation)}${SUBJUNCTIVE_ENDINGS.er[person]}`;
}

/** The stem of the first person present of an -er/-ir verb: "conhec" -> "conheç", "sent" -> "sint". */
export function ptFirstPersonStem(stem: string, conjugation: "er" | "ir"): string {
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

/** The subjunctive forms of an indicative form, or null when it is none. */
export function ptSubjunctive(word: string): PtSubjunctive | null {
  const irregular = IRREGULAR[word];
  if (irregular) return { present: irregular[0], past: irregular[1], person: null };
  return regular(word);
}

// -------------------------------------------------------------- persons of regular verbs

type Tense = "present" | "imperfect" | "preterite";
const PERSONS: PtPerson[] = ["1s", "2s", "3s", "1p", "3p"];
const PERSON_ENDINGS: Record<Conjugation, Record<Tense, string[]>> = {
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
// -iar verbs conjugated like -ear (odeio, anseio).
const LIKE_EAR = /^(?:odi|ansi|remedi|medi|incendi|intermedi)$/;

let firstPersonForms: Map<string, Array<["er" | "ir", string]>> | undefined;
/** "conheço" -> [["er", "conhec"]]: the first person present of the regular -er/-ir verbs. */
function firstPersons(): Map<string, Array<["er" | "ir", string]>> {
  if (firstPersonForms) return firstPersonForms;
  firstPersonForms = new Map();
  const sets = ptVerbStems();
  for (const conjugation of ["er", "ir"] as const)
    for (const stem of sets[conjugation]) {
      if (PT_IRREGULAR_STEM.test(stem)) continue;
      const form = `${ptFirstPersonStem(stem, conjugation)}o`;
      firstPersonForms.set(form, [...(firstPersonForms.get(form) ?? []), [conjugation, stem]]);
    }
  return firstPersonForms;
}

/** A reading of a form as a regular form of an everyday verb: its verb, tense and persons. */
export type PtVerbReading = {
  conjugation: Conjugation;
  stem: string;
  tense: Tense;
  persons: Set<PtPerson>;
};

/** Every reading of `word` as a regular form of an everyday verb. */
export function ptVerbReadings(word: string): PtVerbReading[] {
  const sets = ptVerbStems();
  const found: PtVerbReading[] = [];
  for (const conjugation of ["ar", "er", "ir"] as const) {
    for (const tense of ["present", "imperfect", "preterite"] as const) {
      PERSON_ENDINGS[conjugation][tense].forEach((ending, index) => {
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
        if (conjugation !== "ar" && PT_IRREGULAR_STEM.test(stem)) return;
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

/** The regular form of a reading's verb and tense for `person`. */
export function ptInflect({ conjugation, stem, tense }: PtVerbReading, person: PtPerson): string {
  const index = PERSONS.indexOf(person);
  const ending = PERSON_ENDINGS[conjugation][tense][index];
  if (conjugation === "ar") {
    if (tense === "present" && index !== 3 && /e$/.test(stem)) return `${stem}i${ending}`;
    if (tense === "preterite" && index === 0)
      return `${stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c")}${ending}`;
    return `${stem}${ending}`;
  }
  if (tense === "present" && index === 0) return `${ptFirstPersonStem(stem, conjugation)}o`;
  // "produz", "conduz": -uzir verbs drop the e of the third person singular.
  if (tense === "present" && index === 2 && /uz$/.test(stem)) return stem;
  return `${stem}${ending}`;
}

// -------------------------------------------------------------- the 17 slots of a verb

// Slots: infinitive; present 1sg 3sg 1pl 3pl; preterite 1sg 3sg 3pl; imperfect 3sg 3pl;
// future 3sg; conditional 3sg; present subjunctive 3sg; imperfect subjunctive 3sg; future
// subjunctive 3sg; gerund; participle.
const SLOT_ROWS: Record<string, string> = wordTable({
  dar: "dou dá damos dão dei deu deram dava davam dará daria dê desse der dando dado",
  fazer:
    "faço faz fazemos fazem fiz fez fizeram fazia faziam fará faria faça fizesse fizer fazendo feito",
  ter: "tenho tem temos têm tive teve tiveram tinha tinham terá teria tenha tivesse tiver tendo tido",
  manter:
    "mantenho mantém mantemos mantêm mantive manteve mantiveram mantinha mantinham manterá manteria mantenha mantivesse mantiver mantendo mantido",
  estar:
    "estou está estamos estão estive esteve estiveram estava estavam estará estaria esteja estivesse estiver estando estado",
  ser: "sou é somos são fui foi foram era eram será seria seja fosse for sendo sido",
  ir: "vou vai vamos vão fui foi foram ia iam irá iria vá fosse for indo ido",
  pôr: "ponho põe pomos põem pus pôs puseram punha punham porá poria ponha pusesse puser pondo posto",
  propor:
    "proponho propõe propomos propõem propus propôs propuseram propunha propunham proporá proporia proponha propusesse propuser propondo proposto",
  vir: "venho vem vimos vêm vim veio vieram vinha vinham virá viria venha viesse vier vindo vindo",
  ver: "vejo vê vemos veem vi viu viram via viam verá veria veja visse vir vendo visto",
  dizer:
    "digo diz dizemos dizem disse disse disseram dizia diziam dirá diria diga dissesse disser dizendo dito",
  saber:
    "sei sabe sabemos sabem soube soube souberam sabia sabiam saberá saberia saiba soubesse souber sabendo sabido",
  trazer:
    "trago traz trazemos trazem trouxe trouxe trouxeram trazia traziam trará traria traga trouxesse trouxer trazendo trazido",
  perder:
    "perco perde perdemos perdem perdi perdeu perderam perdia perdiam perderá perderia perca perdesse perder perdendo perdido",
  pedir:
    "peço pede pedimos pedem pedi pediu pediram pedia pediam pedirá pediria peça pedisse pedir pedindo pedido",
  cair: "caio cai caímos caem caí caiu caíram caía caíam cairá cairia caia caísse cair caindo caído",
  sair: "saio sai saímos saem saí saiu saíram saía saíam sairá sairia saia saísse sair saindo saído",
  subir:
    "subo sobe subimos sobem subi subiu subiram subia subiam subirá subiria suba subisse subir subindo subido",
  engolir:
    "engulo engole engolimos engolem engoli engoliu engoliram engolia engoliam engolirá engoliria engula engolisse engolir engolindo engolido",
  abrir:
    "abro abre abrimos abrem abri abriu abriram abria abriam abrirá abriria abra abrisse abrir abrindo aberto",
  sentir:
    "sinto sente sentimos sentem senti sentiu sentiram sentia sentiam sentirá sentiria sinta sentisse sentir sentindo sentido",
  seguir:
    "sigo segue seguimos seguem segui seguiu seguiram seguia seguiam seguirá seguiria siga seguisse seguir seguindo seguido",
  conseguir:
    "consigo consegue conseguimos conseguem consegui conseguiu conseguiram conseguia conseguiam conseguirá conseguiria consiga conseguisse conseguir conseguindo conseguido",
  preferir:
    "prefiro prefere preferimos preferem preferi preferiu preferiram preferia preferiam preferirá preferiria prefira preferisse preferir preferindo preferido",
  repetir:
    "repito repete repetimos repetem repeti repetiu repetiram repetia repetiam repetirá repetiria repita repetisse repetir repetindo repetido",
  dormir:
    "durmo dorme dormimos dormem dormi dormiu dormiram dormia dormiam dormirá dormiria durma dormisse dormir dormindo dormido",
  fugir:
    "fujo foge fugimos fogem fugi fugiu fugiram fugia fugiam fugirá fugiria fuja fugisse fugir fugindo fugido",
  ouvir:
    "ouço ouve ouvimos ouvem ouvi ouviu ouviram ouvia ouviam ouvirá ouviria ouça ouvisse ouvir ouvindo ouvido",
  poder:
    "posso pode podemos podem pude pôde puderam podia podiam poderá poderia possa pudesse puder podendo podido",
  querer:
    "quero quer queremos querem quis quis quiseram queria queriam quererá quereria queira quisesse quiser querendo querido",
  ler: "leio lê lemos leem li leu leram lia liam lerá leria leia lesse ler lendo lido",
  roer: "roo rói roemos roem roí roeu roeram roía roíam roerá roeria roa roesse roer roendo roído",
  obter:
    "obtenho obtém obtemos obtêm obtive obteve obtiveram obtinha obtinham obterá obteria obtenha obtivesse obtiver obtendo obtido",
  contrair:
    "contraio contrai contraímos contraem contraí contraiu contraíram contraía contraíam contrairá contrairia contraia contraísse contrair contraindo contraído",
  diferir:
    "difiro difere diferimos diferem diferi diferiu diferiram diferia diferiam diferirá diferiria difira diferisse diferir diferindo diferido",
});

/** The 17 slot forms of a verb: infinitive; present 1sg 3sg 1pl 3pl; preterite 1sg 3sg 3pl;
 * imperfect 3sg 3pl; future 3sg; conditional 3sg; present, imperfect and future subjunctive
 * 3sg; gerund; participle. The irregular row, or the regular paradigm of its ending. */
export function ptConjugate(verb: string): string[] {
  const row = SLOT_ROWS[verb];
  if (row) return [verb, ...row.split(" ")];
  const stem = verb.slice(0, -2);
  const ending = verb.slice(-2);
  if (ending === "ar") {
    // "ficar" -> "fiquei", "pagar" -> "paguei", "começar" -> "comecei"; "passear" -> "passeia".
    const soft = stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c");
    const ear = /e$/.test(stem) ? `${stem}i` : stem;
    return [
      verb,
      `${ear}o`,
      `${ear}a`,
      `${stem}amos`,
      `${ear}am`,
      `${soft}ei`,
      `${stem}ou`,
      `${stem}aram`,
      `${stem}ava`,
      `${stem}avam`,
      `${stem}ará`,
      `${stem}aria`,
      /e$/.test(stem) ? `${ear}e` : `${soft}e`,
      `${stem}asse`,
      verb,
      `${stem}ando`,
      `${stem}ado`,
    ];
  }
  if (ending !== "er" && ending !== "ir") throw new Error(`Not a verb: ${verb}`);
  // "concluir": the stressed i after a vowel takes an accent ("concluíram", "conclui").
  if (ending === "ir" && /[^gq]u$/.test(stem))
    return [
      verb,
      `${stem}o`,
      `${stem}i`,
      `${stem}ímos`,
      `${stem}em`,
      `${stem}í`,
      `${stem}iu`,
      `${stem}íram`,
      `${stem}ía`,
      `${stem}íam`,
      `${stem}irá`,
      `${stem}iria`,
      `${stem}a`,
      `${stem}ísse`,
      verb,
      `${stem}indo`,
      `${stem}ído`,
    ];
  // "conhecer" -> "conheço", "proteger" -> "protejo", "fingir" -> "finjo".
  const hard = stem.replace(/c$/, "ç").replace(/g$/, "j");
  const vowel = ending[0];
  return [
    verb,
    `${hard}o`,
    `${stem}e`,
    `${stem}${vowel}mos`,
    `${stem}em`,
    `${stem}i`,
    `${stem}${vowel === "e" ? "eu" : "iu"}`,
    `${stem}${vowel}ram`,
    `${stem}ia`,
    `${stem}iam`,
    `${stem}${vowel}rá`,
    `${stem}${vowel}ria`,
    `${hard}a`,
    `${stem}${vowel}sse`,
    verb,
    `${stem}${vowel}ndo`,
    `${stem}ido`,
  ];
}

/** The slot (ptConjugate) of each form of the verbs; the first verb that has a form wins. */
export function ptVerbSlots(verbs: readonly string[]): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  for (const verb of verbs)
    ptConjugate(verb).forEach((form, slot) => slots.has(form) || slots.set(form, slot));
  return slots;
}
