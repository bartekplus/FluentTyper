import type { Fixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  cases,
  FEMININE,
  finiteVerb,
  impersonalVerb,
  MASCULINE,
  NEUTER,
  nounTags,
  onlyNoun,
} from "./lexicon";
import { PREPOSITIONS } from "./shared";

/*
 * Commas set by fixed words rather than by a clause parse: an indirect question after
 * "wiem", "sprawdź", "zastanawiam się" ("Nie wiem, co robić"), "ktoś, kto" and "to, czego",
 * "Im…, tym…", the second of a repeated "ani"/"albo"/"bądź", and a parenthetical opener
 * ("Co więcej, …"). And no comma after a linking adverb ("Jednak miałem rację"), inside
 * "w którym", or before a single "ani"/"lub" between two nouns.
 */

const MISSING = "polishMissingComma" as const;
const EXTRA = "polishMisplacedComma" as const;

/** Opening phrases that are asides and may keep their comma ("Na szczęście,", "Po pierwsze,"). */
const ASIDE_PHRASE =
  /^(?:po (?:pierwsze|drugie|trzecie|czwarte|piąte|ostatnie|prostu|kolei|czym|co)|z (?:jednej|drugiej|innej|mojej|twojej|naszej) strony|w (?:końcu|ogóle|sumie|skrócie|zasadzie|rezultacie|efekcie|praktyce|rzeczywistości|istocie|gruncie rzeczy|każdym razie|przeciwnym razie|takim razie|tym razie|tym przypadku|tym wypadku|związku z tym|dodatku|zamian|zamian za to|ten sposób|szczególności|przeciwieństwie|porównaniu|skrócie|razie czego|razie potrzeby|razie wątpliwości|międzyczasie|tym czasie)|na (?:szczęście|nieszczęście|koniec|początek|przykład|razie|pewno|marginesie|wstępie|zakończenie|dodatek|ogół|odwrót|wszelki wypadek|domiar złego|przyszłość|tym etapie|wszelki)|przede wszystkim|mimo (?:to|wszystko)|pomimo to|bez (?:wątpienia|względu|dwóch zdań)|dla (?:przykładu|porządku|jasności|ścisłości)|ponad (?:to|wszystko)|poza tym|z (?:tego|tej) (?:powodu|przyczyny)|od (?:razu|tego czasu|teraz|dziś|jutra)|do (?:tego|rzeczy)|przy (?:tym|okazji)|za (?:to|chwilę|moment)|o (?:dziwo|ile))$/u;
/** Words that open a clause or an aside after the comma ("Po chwili, gdy…", "W domu, który…"). */
const OPENS_CLAUSE =
  /^(?:gdy|kiedy|jak|jeśli|jeżeli|że|iż|żeby|aby|by|bo|gdzie|dokąd|skąd|co|kto|czy|choć|chociaż|zanim|odkąd|dopóki|póki|skoro|ponieważ|gdyż|zwłaszcza|szczególnie|czyli|oraz|i|a|ale|lecz|albo|lub|bądź|ani|natomiast|jednak|więc|zatem|tj|np|tzn|około|mniej|więcej|między|jako|niż|tak|to|któr\p{L}*|jak\p{L}*|czyj\p{L}*)$/u;

const PREPOSITION_WORDS = new Set(PREPOSITIONS.split("|"));

export interface CommaFrame {
  ruleId: typeof MISSING | typeof EXTRA;
  messageKey: RawFinding["messageKey"];
  regex: RegExp;
  /** The replacement for the `target` group, or null to skip the match. */
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
}

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  // "Nie wiem co robić" -> "Nie wiem, co robić" (not "jak najszybciej", "co nieco").
  commaFramesWiem: (m) => `${m.groups!.target},`,
  // "ktoś kto", "coś czego", "wszystko co" -> "ktoś, kto"; not a question ("Ten co?").
  commaFramesKtoś: (m) => `${m.groups!.target},`,
  // "zależy od tego czy", "pytanie co", "kwestia gdzie" -> "tego, czy": an indirect question
  // after a pronoun or a noun asking it; not "to czy tamto", "tego czy owego", "kiedy indziej".
  commaFramesTego: (m) => `${m.groups!.target},`,
  // "zarówno Lecha jak i Jarosława" -> "Lecha, jak i": the pair's second half is set off.
  commaFramesT: (m) => `, ${m.groups!.target.trim()}`,
  // "Tam gdzie nie ma dróg" -> "Tam, gdzie".
  commaFramesTam: (m) => `${m.groups!.target},`,
  // "Im większa tym lepiej" -> "Im większa, tym lepiej" (not "o tym" inside the first clause).
  commaFramesT2: (m) => `, ${m.groups!.target.trim()}`,
  // "Tak jak wczoraj tak i dziś" -> "Tak jak wczoraj, tak i dziś".
  commaFramesT3: (m) => `, ${m.groups!.target.trim()}`,
  // "Była to tak czy inaczej porażka" -> "Była to, tak czy inaczej, porażka": the aside is set off
  // inside the sentence too (not "czy tak czy owak", the repeated question).
  commaFramesT4: (m) => `, ${m.groups!.target.trim().replace(/\s+/gu, " ")}, `,
  // "nie jest twoja tylko moja" -> "twoja, tylko moja": "tylko" contrasting with a denial.
  commaFramesP: (m) => {
    const word = m.groups!.target;
    // "nie mam tylko czasu", "nie tylko": "tylko" means "only" after a verb.
    if (finiteVerb(word) || /^(?:tylko|ma|mam|mamy|chodzi|wiem|ten|to|ta|się)$/u.test(word))
      return null;
    return `${word},`;
  },
  // "kawę a nie herbatę" -> "kawę, a nie herbatę"; "ciekawy a to dzięki" -> "ciekawy, a to dzięki".
  commaFramesP2: (m, ctx) => {
    const word = m.groups!.target;
    // "taki a nie inny" is one phrase.
    if (
      /^(?:czy|i|a|albo|lub|ani|oraz|nie|że|to|tak(?:i|a|ie|iego|iej|iemu|ą|im|ich|imi))$/u.test(
        word,
      )
    )
      return null;
    // "między domem a nie szkołą" keeps "między X a Y" whole.
    const sentence = ctx.text
      .slice(Math.max(0, m.index - 60), m.index)
      .split(/[.!?;:,\n]/u)
      .at(-1)!;
    if (/(?:^|[^\p{L}])(?:po)?między(?![\p{L}])/iu.test(sentence)) return null;
    return `${word},`;
  },
  // "Po zakończeniu prac, biuro zamknięto" -> no comma after an opening prepositional phrase;
  // not after a set aside ("Na szczęście,", "Z drugiej strony,") or before a clause ("Po
  // chwili, gdy…"), and only when nothing else in the sentence could pair with the comma.
  commaFramesT5: (m) => {
    const { phrase, noun, rest } = m.groups!;
    const lower = phrase.toLowerCase().replace(/\s+/gu, " ");
    if (ASIDE_PHRASE.test(lower)) return null;
    // A noun, or a name ("W Krakowie,").
    if (!onlyNoun(nounTags(noun.toLowerCase()), true) && !/^\p{Lu}\p{Ll}+$/u.test(noun))
      return null;
    const words = rest.toLowerCase().match(/\p{L}+/gu) ?? [];
    const first = words[0] ?? "";
    if (OPENS_CLAUSE.test(first) || /ąc$/u.test(first)) return null;
    // "W pracy, w domu i w szkole": a list of phrases.
    if (PREPOSITION_WORDS.has(first)) return null;
    // "W rolnictwie, przemyśle i budownictwie": a list goes on in the same case.
    const fold = (tags: number) => (tags | (tags >> 7)) & 0x7f;
    const verb = words.findIndex((word) => finiteVerb(word));
    if (
      fold(nounTags(noun.toLowerCase())) & fold(nounTags(first)) &&
      words
        .slice(1, verb < 0 ? undefined : verb)
        .some((word) => /^(?:i|oraz|lub|albo|ani)$/u.test(word))
    )
      return null;
    return words.some((word) => finiteVerb(word) || impersonalVerb(word) || /ć$/u.test(word))
      ? ""
      : null;
  },
  // "między Pawłem, a Gawłem" -> "między Pawłem a Gawłem".
  commaFramesT6: () => "",
  // "Ani prośby ani groźby" -> "Ani prośby, ani groźby".
  commaFramesT7: (m) => `, ${m.groups!.target.trim()}`,
  // "Co więcej nie ma sensu" -> "Co więcej, nie ma sensu".
  commaFramesCo: (m) => `${m.groups!.target},`,
  // "Jak widać nikt nie przyszedł" -> "Jak widać, nikt": the aside ends before the clause; not
  // "Jak widać na wykresie, …" or "Jak wiadomo z historii".
  commaFramesJak: (m) => `${m.groups!.target},`,
  // "Jednak, miałem rację" -> "Jednak miałem rację"; not before a phrase set off as an aside
  // ("Poza tym, ze względu na koszty …").
  commaFramesT8: () => "",
  // "Jest to więc, problem" -> no comma after a mid-sentence "więc"/"jednak"/"zatem".
  commaFramesT9: () => "",
  // "w którym, przygotowujemy" -> no comma right after the relative pronoun.
  commaFramesT10: () => "",
  // "Gazeta, jest źródłem", "Każdy uczeń, wie": no comma between a subject and its verb. Only
  // a noun that cannot be a vocative ("Mamo, jest obiad"), or one after "każdy", is the subject.
  commaFramesT11: (m) => {
    const tags = nounTags(m.groups!.noun.toLowerCase());
    if (!onlyNoun(tags) || !(tags & cases("Ns"))) return null;
    if (!m.groups!.det && tags & cases("Vs")) return null;
    // A form of two nouns may be a name too ("Marek, przyszedł list").
    if ([MASCULINE, FEMININE, NEUTER].filter((gender) => tags & gender).length !== 1) return null;
    const verb = m.groups!.verb;
    // "Uchwała, powiedział, ustala…": a reporting verb set off inside the sentence.
    if (
      m.groups!.aside &&
      /^(?:powiedzia|mówi|twierdz|doda|zauważy|podkreśli|stwierdzi|zaznaczy|napisa|wyjaśni|przyzna|uważa|sądz|odpowiedzia|zapewni)/u.test(
        verb,
      )
    )
      return null;
    return verb === "to" || finiteVerb(verb) ? "" : null;
  },
  // "gruszek, ani jabłek", "gruszek, i jabłek": no comma before a single joining conjunction
  // between two nouns, nor between two verbs of one sentence ("Kupiłem chleb, oraz zjadłem").
  commaFramesT12: (m, ctx) => {
    const { left, conj, right } = m.groups!;
    const sentence = ctx.text
      .slice(Math.max(0, m.index - 120), m.index)
      .split(/[.!?;:\n]/u)
      .at(-1)!;
    // A repeated conjunction ("ani X, ani Y") keeps its comma.
    if (new RegExp(`(?<![\\p{L}])${conj}(?![\\p{L}])`, "iu").test(sentence)) return null;
    const a = nounTags(left);
    const b = nounTags(right);
    // The same case, in either number ("czasu, ani pieniędzy").
    const fold = (tags: number) => (tags | (tags >> 7)) & 0x7f;
    if (onlyNoun(a) && onlyNoun(b) && fold(a) & fold(b)) return "";
    // Two verbs: the comma may close an inserted clause, so only with no other comma before
    // and a verb in the first part ("Wstał, który…, i wyszedł" keeps it). "ani" stays out:
    // "Nie oddał, ani nie przeprosił" may stress the second denial.
    if (conj === "ani" || conj === "ni" || !finiteVerb(right) || sentence.includes(","))
      return null;
    return (sentence.match(/\p{L}+/gu) ?? []).some((word) => finiteVerb(word.toLowerCase()))
      ? ""
      : null;
  },
  // "Oto do czego to prowadzi" -> "Oto, do czego": an indirect question after "oto" ("Oto jak…"
  // reads as one phrase).
  commaFramesOto: (m) => `${m.groups!.target},`,
  // "tym bardziej, że" -> "tym bardziej że": the comma goes before the whole conjunction.
  commaFramesT13: () => "",
  // "wątpliwości, co do raportu": "co do" is a preposition here ("co do których" opens a clause).
  commaFramesT14: () => "",
  // "Oto, jak to działa" -> "Oto jak": the pair reads as one phrase.
  commaFramesT15: () => "",
  // "Nie wiem, dlaczego." -> no comma before a question word that stands alone at the end.
  commaFramesT16: () => "",
  // "w trakcie, którego" -> "w trakcie którego": the preposition and its relative are one phrase.
  commaFramesT17: () => "",
  // "odzywał, się sygnał": "się" never opens a clause.
  commaFramesT18: () => "",
  // "coś do powiedzenia a mianowicie" -> ", a mianowicie"; "Dorota w miarę jak rosła" -> ", w miarę jak".
  commaFramesT19: (m) => `,${m.groups!.target}`,
  // "O ile …, o tyle …": the second half is set off.
  commaFramesT20: (m) => `,${m.groups!.target}`,
  // "Nie ma to innymi słowy sensu" -> ", innymi słowy,": an aside inside the sentence.
  commaFramesT21: (m) => `,${m.groups!.target}${m.groups!.after === "," ? "" : ","}`,
  // "Musi tak być i koniec!" -> ", i koniec": after a verb, the phrase closes the matter.
  commaFramesT22: (m) =>
    /ć$/u.test(m.groups!.verb) || finiteVerb(m.groups!.verb) ? `,${m.groups!.target}` : null,
  // "bez względu na to gdzie" -> "na to, gdzie": an indirect question after "to".
  commaFramesTo: () => "to,",
} satisfies Record<string, Fixer>;
