// The rule library (library.ts): Portuguese clauses. The words of the shared clause reader, and
// the verb of a clause after its subject.
import type { ClauseProfile } from "../../review/clauseReader";
import { ptNoun } from "./nouns";
import { PT_NOT_FINITE, ptFiniteVerb, type PtPerson } from "./verbs";

const words = (list: string) => new Set(list.split(/\s+/));
const DETERMINERS = words(
  `o a os as um uma uns umas este esta estes estas esse essa esses essas aquele aquela aqueles
  aquelas meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas`,
);
const PREPOSITIONS = words(
  `de do da dos das em no na nos nas com para por pelo pela pelos pelas sobre entre sem contra
  desde ao aos à às`,
);
const ADVERBS = words("não já ainda também sempre nunca só quase aqui ali lá hoje ontem muito");

/** The Portuguese words of the shared clause reader (review/clauseReader.ts). Portuguese has no
 * verb lexicon, so the reader reads only what the endings show. */
export const PT_CLAUSE: ClauseProfile = {
  determiners: DETERMINERS,
  prepositions: PREPOSITIONS,
  quantifiers: words("todos todas alguns algumas muitos muitas vários várias poucos poucas"),
  numbers: words("dois duas três quatro cinco seis sete oito nove dez cem mil"),
  notHeads: new Set([...DETERMINERS, ...PREPOSITIONS, ...PT_NOT_FINITE, "que", "quem"]),
  coordinators: words("e ou"),
  joins: words("e"),
  pronouns: words("mim ti ele ela eles elas nós vós você vocês"),
  relatives: words("que"),
  clitics: words("não já se me te lhe lhes nos"),
  isAdverb: (t) => ADVERBS.has(t.w) || (/mente$/.test(t.w) && t.w.length > 6),
  isNoun: (text, t) =>
    text.slice(t.start, t.end) === t.w
      ? !!ptNoun(t.w)
      : /^\p{Lu}\p{Ll}+$/u.test(text.slice(t.start, t.end)),
  nominal: () => false,
  // "as cartas enviadas": a participle.
  postnominal: (t) => !!t && /^\p{L}{3,}(?:ad|id)[oa]s?$/u.test(t.w),
  prenominal: (_text, _tokens, i) => i,
  isFiniteVerb: (t) => ptFiniteVerb(t.w),
};

// -------------------------------------------------------------- the verb of a clause

const PRONOUNS: Record<string, PtPerson> = {
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
const SUBJECT_DETERMINERS = words(
  `o a os as um uma uns umas este esta estes estas esse essa esses essas aquele aquela aqueles
  aquelas meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas
  muitos muitas alguns algumas poucos poucas vários várias cada nenhum nenhuma`,
);
// Words after a determiner that are no noun: "o que", "o mesmo", "os dois" stays a noun.
const NOT_NOUNS = words(
  "que qual quais quanto mesmo mesma mesmos mesmas outro outra outros outras próprio própria",
);
const CLAUSE_ADVERBS = words(
  "não já ainda também realmente sempre nunca só apenas mesmo logo até enfim afinal sequer bem",
);
const CLITICS = words("me te se lhe lhes nos vos o a os as");

const TOKEN = /[\p{L}]+(?:-[\p{L}]+)*|[^\s\p{L}]/uy;

/** The verb of a clause: its offsets and text, the person of the subject before it (null: no
 * subject), whether a noun is that subject, and the lowercase word after the verb. */
export type PtClauseVerb = {
  start: number;
  end: number;
  word: string;
  person: PtPerson | null;
  afterNoun: boolean;
  next: string | undefined;
};

/** The verb of the clause that starts at `from`: after its subject (a pronoun, a name, or a
 * determiner and its noun), up to two adverbs and an object pronoun. */
export function ptClauseVerb(text: string, from: number): PtClauseVerb | null {
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
  let person: PtPerson | null = null;
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
  } else if (SUBJECT_DETERMINERS.has(lower(0)) && tokens[0].word === lower(0)) {
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
  for (let adverbs = 0; adverbs < 2 && CLAUSE_ADVERBS.has(lower(i)); adverbs++) i++;
  if (CLITICS.has(lower(i)) && tokens[i + 1] && /^\p{Ll}/u.test(tokens[i + 1].word)) i++;
  const target = tokens[i];
  if (!target || !/^\p{Ll}+$/u.test(target.word)) return null;
  return { ...target, person, afterNoun, next: lower(i + 1) };
}
