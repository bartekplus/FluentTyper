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
import { findingAt, isPl, owned, PREPOSITIONS, userOrNamed } from "./shared";

/*
 * Commas set by fixed words rather than by a clause parse: an indirect question after
 * "wiem", "sprawdź", "zastanawiam się" ("Nie wiem, co robić"), "ktoś, kto" and "to, czego",
 * "Im…, tym…", the second of a repeated "ani"/"albo"/"bądź", and a parenthetical opener
 * ("Co więcej, …"). And no comma after a linking adverb ("Jednak miałem rację"), inside
 * "w którym", or before a single "ani"/"lub" between two nouns.
 */

const MISSING = "polishMissingComma" as const;
const EXTRA = "polishMisplacedComma" as const;
/** Spaces between words, bounded so look-behinds stay linear on whitespace runs. */
const SP = "[ \\t\\u00a0]{1,8}";
const END = "(?![\\p{L}\\p{N}])";
/** A clause starts here; the look-back is bounded so whitespace runs stay linear. */
const CLAUSE_START = '(?<=(?:^|[.!?…:;]["”’»)]{0,3}[ \\t\\u00a0]{1,8}|\\n[ \\t\\u00a0]{0,8}))';

/** Opening phrases that are asides and may keep their comma ("Na szczęście,", "Po pierwsze,"). */
const ASIDE_PHRASE =
  /^(?:po (?:pierwsze|drugie|trzecie|czwarte|piąte|ostatnie|prostu|kolei|czym|co)|z (?:jednej|drugiej|innej|mojej|twojej|naszej) strony|w (?:końcu|ogóle|sumie|skrócie|zasadzie|rezultacie|efekcie|praktyce|rzeczywistości|istocie|gruncie rzeczy|każdym razie|przeciwnym razie|takim razie|tym razie|tym przypadku|tym wypadku|związku z tym|dodatku|zamian|zamian za to|ten sposób|szczególności|przeciwieństwie|porównaniu|skrócie|razie czego|razie potrzeby|razie wątpliwości|międzyczasie|tym czasie)|na (?:szczęście|nieszczęście|koniec|początek|przykład|razie|pewno|marginesie|wstępie|zakończenie|dodatek|ogół|odwrót|wszelki wypadek|domiar złego|przyszłość|tym etapie|wszelki)|przede wszystkim|mimo (?:to|wszystko)|pomimo to|bez (?:wątpienia|względu|dwóch zdań)|dla (?:przykładu|porządku|jasności|ścisłości)|ponad (?:to|wszystko)|poza tym|z (?:tego|tej) (?:powodu|przyczyny)|od (?:razu|tego czasu|teraz|dziś|jutra)|do (?:tego|rzeczy)|przy (?:tym|okazji)|za (?:to|chwilę|moment)|o (?:dziwo|ile))$/u;
/** Words that open a clause or an aside after the comma ("Po chwili, gdy…", "W domu, który…"). */
const OPENS_CLAUSE =
  /^(?:gdy|kiedy|jak|jeśli|jeżeli|że|iż|żeby|aby|by|bo|gdzie|dokąd|skąd|co|kto|czy|choć|chociaż|zanim|odkąd|dopóki|póki|skoro|ponieważ|gdyż|zwłaszcza|szczególnie|czyli|oraz|i|a|ale|lecz|albo|lub|bądź|ani|natomiast|jednak|więc|zatem|tj|np|tzn|około|mniej|więcej|między|jako|niż|tak|to|któr\p{L}*|jak\p{L}*|czyj\p{L}*)$/u;

const PREPOSITION_WORDS = new Set(PREPOSITIONS.split("|"));

interface CommaFrame {
  ruleId: typeof MISSING | typeof EXTRA;
  messageKey: RawFinding["messageKey"];
  regex: RegExp;
  /** The replacement for the `target` group, or null to skip the match. */
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
}

/** Verbs and phrases that introduce an indirect question. */
const ASKING = [
  "wiem|wiesz|wie|wiemy|wiecie|wiedzą|wiedział\\p{L}*|wiedzieć|wiadomo",
  "sprawdź|sprawdźmy|sprawdzić|sprawdzam|sprawdza|sprawdzę|sprawdził\\p{L}*",
  "spytać|spytam|spytaj|spytał\\p{L}*|zapytać|zapytam|zapytaj|zapytał\\p{L}*|pytam|pyta|pytał\\p{L}*",
  "zobacz|zobaczmy|zobaczyć|zobaczę|zobaczymy",
  `zastanawiam${SP}się|zastanawia${SP}się|zastanawiał\\p{L}*${SP}się|wahał\\p{L}*${SP}się|waham${SP}się`,
  `ustalić|zdecydować|pamiętam|pamiętasz|rozumiem|wyobraź${SP}sobie|powiedz|pokaż`,
  `wyobrazić${SP}sobie|wyobrażam${SP}sobie|wyobraża${SP}sobie|stwierdzić|ocenić|przewidzieć|określić|zrozumieć|wyjaśnić|wytłumaczyć|opisać|powiedzieć|pokazać`,
].join("|");
const QUESTION_WORD = "czy|co|jak|gdzie|kiedy|dlaczego|skąd|dokąd|ile|kto|którędy|czemu";
/**
 * "Nie wiadomo kiedy zrobiło się ciemno", "nie wiadomo skąd pojawił się kot": the idiom (before
 * one noticed, out of nowhere) before a verb of passing or appearing asks nothing.
 */
const UNNOTICED = `(?<=nie${SP}wiadomo)${SP}(?:kiedy|skąd|jak)${SP}(?:się${SP})?(?:zrobił|minął|minęł|upłynął|upłynęł|zleciał|przeleciał|przemknął|przemknęł|wyrósł|wyrosł|pojawił|zjawił|znalazł|zniknął|zniknęł|nastał|nadszedł|nadeszł|zapadł|przeminął|przeminęł|ściemnił|wyskoczył|wyrwał)\\p{L}*${END}`;

const SET_OFF =
  "(?:Co więcej|Innymi słowy|Jednym słowem|Krótko mówiąc|Szczerze mówiąc|Nawiasem mówiąc|Ogólnie mówiąc|Prawdę mówiąc|Po pierwsze|Po drugie|Po trzecie|Tak czy siak|Tak czy owak)";
const LINKING =
  "(?:Jednak|Jednakże|Poza tym|Ponadto|Natomiast|Dlatego|Dlatego też|Zatem|Toteż|Wobec tego)";
const RELATIVE = "który|która|które|którego|której|któremu|którą|którym|których|którymi|którzy";
const PRONOUN_HEAD =
  "ktoś|coś|ten|ta|ci|tego|tym|temu|wszystko|wszystkiego|wszystkim|wszystkiemu|każdy|nic|niczego";
const PRONOUN_RELATIVE = "kto|kogo|komu|kim|czego|czym|czemu|co|czyj\\p{L}*";

export const FRAMES: readonly CommaFrame[] = [
  // "Nie wiem co robić" -> "Nie wiem, co robić" (not "jak najszybciej", "co nieco").
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>(?:${ASKING}))(?=${SP}(?:${QUESTION_WORD})${SP}\\p{L})(?!${SP}(?:jak${SP}naj|co${SP}nieco|co${SP}do${END}|jak${SP}i${END}))(?!${UNNOTICED})`,
      "giud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "ktoś kto", "coś czego", "wszystko co" -> "ktoś, kto"; not a question ("Ten co?").
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>${PRONOUN_HEAD})(?=${SP}(?:${PRONOUN_RELATIVE})${SP}[^.!?\\n]*[.!…]?)(?!${SP}(?:${PRONOUN_RELATIVE})${SP}[^.!?\\n]*\\?)(?!${SP}co${SP}(?:do|nieco|niemiara|najmniej|najwyżej|prawda|innego|chwila|dzień|roku|rusz|raz)${END})(?!${SP}\\p{L}+${SP}\\p{L}+ć${END})`,
      "giud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "zależy od tego czy", "pytanie co", "kwestia gdzie" -> "tego, czy": an indirect question
  // after a pronoun or a noun asking it; not "to czy tamto", "tego czy owego", "kiedy indziej".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>tego|(?<=(?:na|o|przez|za|w|pod|nad|przed)${SP})to|tym|temu|pytanie|pytania|pytaniu|kwestia|kwestii|kwestię)(?=${SP}(?:czy|gdzie|kiedy|dlaczego|skąd|dokąd|ile|co)${SP}\\p{L})(?!${SP}\\p{L}+${SP}(?:tamto|tamtego|tamtym|owo|owego|owym|inne|innego|innym|nie|indziej)${END})(?!${SP}co${SP}(?:do|nieco|niemiara|najmniej|najwyżej|prawda|innego|chwila|rusz|raz)${END})`,
      "giud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Tam gdzie nie ma dróg" -> "Tam, gdzie".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}(?<target>Tam|Tu|Tutaj)(?=${SP}(?:gdzie|dokąd|skąd)${END})`,
      "gud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Im większa tym lepiej" -> "Im większa, tym lepiej".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}Im${SP}(?:[^,.!?;\\n ]+${SP}){0,4}?[^,.!?;\\n ]+(?<target>${SP}tym)${END}`,
      "gud",
    ),
    fix: (m) => `, ${m.groups!.target.trim()}`,
  },
  // "Tak jak wczoraj tak i dziś" -> "Tak jak wczoraj, tak i dziś".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}Tak${SP}jak${SP}(?:[^,.!?;\\n ]+${SP}){0,4}?[^,.!?;\\n ]+(?<target>${SP}tak)(?=${SP}(?:i|też|samo)${END})`,
      "gud",
    ),
    fix: (m) => `, ${m.groups!.target.trim()}`,
  },
  // "Była to tak czy inaczej porażka" -> "Była to, tak czy inaczej, porażka": the aside is set off
  // inside the sentence too (not "czy tak czy owak", the repeated question).
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(
      `(?<=(?<![\\p{L}])(?!czy${END})\\p{Ll}+)(?<target>${SP}tak${SP}czy${SP}(?:inaczej|siak|owak)${SP})(?=\\p{L})`,
      "gud",
    ),
    fix: (m) => `, ${m.groups!.target.trim().replace(/\s+/gu, " ")}, `,
  },
  // "nie jest twoja tylko moja" -> "twoja, tylko moja": "tylko" contrasting with a denial.
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])nie${SP}(?:(?:jest|są|był|była|było|były|byli|jako|dla|do|na|w|z|o)${SP})?(?<target>\\p{Ll}+)(?=${SP}tylko${SP}\\p{Ll})`,
      "giud",
    ),
    fix: (m) => {
      const word = m.groups!.target;
      // "nie mam tylko czasu", "nie tylko": "tylko" means "only" after a verb.
      if (finiteVerb(word) || /^(?:tylko|ma|mam|mamy|chodzi|wiem|ten|to|ta|się)$/u.test(word))
        return null;
      return `${word},`;
    },
  },
  // "kawę a nie herbatę" -> "kawę, a nie herbatę"; "ciekawy a to dzięki" -> "ciekawy, a to dzięki".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<target>\\p{Ll}{2,})(?=${SP}a${SP}(?:nie${SP}\\p{L}|to${SP}(?:z${SP}powodu|dzięki|dlatego|ze${SP}względu|przez|z${SP}uwagi)${END}))`,
      "gud",
    ),
    fix: (m, ctx) => {
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
  },
  // "Po zakończeniu prac, biuro zamknięto" -> no comma after an opening prepositional phrase;
  // not after a set aside ("Na szczęście,", "Z drugiej strony,") or before a clause ("Po
  // chwili, gdy…"), and only when nothing else in the sentence could pair with the comma.
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `${CLAUSE_START}(?<phrase>(?:${PREPOSITIONS})${SP}(?:\\p{L}+${SP})?(?<noun>\\p{L}+))(?<target>,)(?=${SP}(?<rest>\\p{L}[^,;:()"„”—–\\n]*)[.!?])`,
      "giud",
    ),
    fix: (m) => {
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
  },
  // "między Pawłem, a Gawłem" -> "między Pawłem a Gawłem".
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?:po)?między${SP}(?:\\p{L}+${SP}){0,2}\\p{L}+(?<target>,)${SP}a${SP}\\p{L}`,
      "giud",
    ),
    fix: () => "",
  },
  // "Ani prośby ani groźby" -> "Ani prośby, ani groźby".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(
      `(?<![\\p{L}])(?<first>ani|albo|bądź)${SP}(?!(?:co|jak)${SP}bądź)(?:[^,.!?;\\n ]+${SP}){0,1}?[^,.!?;\\n ]+(?<target>${SP}\\k<first>)${END}`,
      "giud",
    ),
    fix: (m) => `, ${m.groups!.target.trim()}`,
  },
  // "Co więcej nie ma sensu" -> "Co więcej, nie ma sensu".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(`${CLAUSE_START}(?<target>${SET_OFF})(?=${SP}\\p{L})`, "gud"),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Jak widać nikt nie przyszedł" -> "Jak widać, nikt": the aside ends before the clause; not
  // "Jak widać na wykresie, …" or "Jak wiadomo z historii".
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_comma_aside",
    regex: new RegExp(
      `${CLAUSE_START}(?<target>Jak${SP}(?:widać|wiadomo|się${SP}okazało))(?=${SP}\\p{L}[^,;:\\n.!?]*[.!?])(?!${SP}(?:${PREPOSITIONS}|że|iż|później|potem|wcześniej|dotąd|dziś|dzisiaj|wczoraj)${END})`,
      "gud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
  // "Jednak, miałem rację" -> "Jednak miałem rację"; not before a phrase set off as an aside
  // ("Poza tym, ze względu na koszty …").
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `${CLAUSE_START}${LINKING}(?<target>,)(?!${SP}(?:${PREPOSITIONS})${END})(?=${SP}\\p{Ll}[^,;:\\n]*[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "Jest to więc, problem" -> no comma after a mid-sentence "więc"/"jednak"/"zatem".
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<=\\p{Ll}${SP})(?:więc|jednak|zatem)(?<target>,)(?=${SP}\\p{Ll}+(?:${SP}\\p{Ll}+)?[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "w którym, przygotowujemy" -> no comma right after the relative pronoun.
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<=(?<![\\p{L}])(?:${PREPOSITIONS})${SP}(?:${RELATIVE}))(?<target>,)(?=${SP}\\p{Ll}[^,;:\\n]*[.!?])`,
      "gud",
    ),
    fix: () => "",
  },
  // "Gazeta, jest źródłem", "Każdy uczeń, wie": no comma between a subject and its verb. Only
  // a noun that cannot be a vocative ("Mamo, jest obiad"), or one after "każdy", is the subject.
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `${CLAUSE_START}(?:(?<det>każdy|każda|każde|Każdy|Każda|Każde|ten|ta|Ten|Ta)${SP})?(?<noun>\\p{L}\\p{Ll}+)(?<target>,)${SP}(?<verb>\\p{Ll}+)${END}(?<aside>,)?`,
      "gud",
    ),
    fix: (m) => {
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
  },
  // "gruszek, ani jabłek", "gruszek, i jabłek": no comma before a single joining conjunction
  // between two nouns, nor between two verbs of one sentence ("Kupiłem chleb, oraz zjadłem").
  {
    ruleId: EXTRA,
    messageKey: "review_msg_pl_extra_comma",
    regex: new RegExp(
      `(?<![\\p{L}])(?<left>\\p{Ll}{3,})(?<target>,)${SP}(?<conj>ani|ni|lub|albo|bądź|oraz|i)${SP}(?<right>\\p{Ll}{3,})${END}`,
      "gud",
    ),
    fix: (m, ctx) => {
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
  },
  // "Oto do czego to prowadzi" -> "Oto, do czego": an indirect question after "oto" ("Oto jak…"
  // reads as one phrase).
  {
    ruleId: MISSING,
    messageKey: "review_msg_pl_missing_comma",
    regex: new RegExp(
      `${CLAUSE_START}(?<target>Oto)(?=${SP}(?:(?:${PREPOSITIONS})${SP})?(?:co|czego|czemu|czym|kto|kogo|komu|kim|gdzie|dlaczego|dokąd|skąd)${SP}\\p{L})`,
      "gud",
    ),
    fix: (m) => `${m.groups!.target},`,
  },
];

function commaFrames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { ruleId, messageKey, regex, fix } of FRAMES) {
    if (ctx.rules && !ctx.rules.has(ruleId)) continue;
    for (const m of owned(ctx, regex)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const typed = ctx.source.slice(start, end);
      if (/\p{L}/u.test(typed) && userOrNamed(ctx, typed)) continue;
      const fixed = fix(m, ctx);
      if (fixed === null || fixed === typed) continue;
      findings.push(findingAt(ctx, start, end, [fixed], ruleId, messageKey));
    }
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [MISSING, EXTRA] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? commaFrames(ctx) : []),
  },
];
