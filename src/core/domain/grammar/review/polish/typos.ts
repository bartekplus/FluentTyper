import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { cases, finiteVerb, listedVerb, nounTags, NEUTER, onlyNoun, pastByShape } from "./lexicon";
import {
  adjectiveRows,
  caseLike,
  CLAUSE_START,
  END,
  findingAt,
  type Frame,
  isPl,
  owned,
  runFrames,
  S,
  userOrNamed,
} from "./shared";

/*
 * Real-word slips: a dictionary word typed for its look-alike ("szkody średniej" for
 * "szkoły"), a word cut short ("coraz lepie") or a lost or doubled small word. Each frame
 * names the neighbour that only the intended word fits.
 */

const words = (list: string) => list.split(" ");

/** Forms that are no Polish words, whatever their neighbours. */
export const WORDS: readonly PhraseRow[] = [
  ["struj", "strój"],
  ["pryz", "przy"],
  ["koniczność", "konieczność"],
  ...adjectiveRows("koniczn", "konieczn"),
  ...words("drzem drzemu drzemem drzemy drzemów").map((form): PhraseRow => [
    form,
    `dżem${form.slice(5)}`,
  ]),
  ...words("sytem sytemu sytemie sytemy sytemów").map((form): PhraseRow => [
    form,
    `system${form.slice(5)}`,
  ]),
  // "rozpatrzać" is no verb: "rozpatrywać" (or the perfective "rozpatrzyć").
  ["rozpatrzać", "rozpatrywać"],
  ["rozpatrza", "rozpatruje"],
  ["rozpatrzają", "rozpatrują"],
  ["rozpatrzał", ["rozpatrywał", "rozpatrzył"]],
  ["rozpatrzała", ["rozpatrywała", "rozpatrzyła"]],
];

/** Word pairs where the typed form is never right. */
export const PHRASES: readonly PhraseRow[] = [
  ["półwieku temu", "pół wieku temu"],
  ["nie jetem", "nie jestem"],
  ["od dawana", "od dawna"],
  ["do niedawana", "do niedawna"],
  ["od niedawana", "od niedawna"],
  ["ku ucieszy", "ku uciesze"],
  ["w razie pytać", "w razie pytań"],
  ["na papieże", "na papierze"],
  ["w tak sposób", "w taki sposób"],
  ["po prost", "po prostu"],
  ["po kątem", "pod kątem"],
  ["tan naprawdę", "tak naprawdę"],
  ["nie wolo", "nie wolno"],
  ["w zgodnie z", ["zgodnie z", "w zgodzie z"]],
  ["za maż", "za mąż"],
  ["z dania na dzień", "z dnia na dzień"],
  ["że względu na", "ze względu na"],
  ["sadzę, że", "sądzę, że"],
  ["sadzę że", "sądzę że"],
  ["nie sadzę", "nie sądzę"],
  ["wydaja się", "wydają się"],
  ["ja się okazuje", "jak się okazuje"],
  ["ja się wydaje", "jak się wydaje"],
  ["wszech rzeczy", "wszechrzeczy"],
  ["dla czemu", "dlaczego"],
  ["na całym świcie", "na całym świecie"],
  ["po całym świcie", "po całym świecie"],
  ...([
    ["jazda kona", "jazda konna"],
    ["jazdy konej", "jazdy konnej"],
    ["jazdę koną", "jazdę konną"],
    ["jazdą koną", "jazdą konną"],
    ["jeździe konej", "jeździe konnej"],
    ["błąd litrowy", "błąd literowy"],
    ["błędu litrowego", "błędu literowego"],
    ["błędy litrowe", "błędy literowe"],
    ["błędów litrowych", "błędów literowych"],
    ["pozycji lezącej", "pozycji leżącej"],
    ["pozycja leząca", "pozycja leżąca"],
    ["pozycję lezącą", "pozycję leżącą"],
    ["miejsce zamieszania", "miejsce zamieszkania"],
    ["miejsca zamieszania", "miejsca zamieszkania"],
    ["miejscu zamieszania", "miejscu zamieszkania"],
    ["adres zamieszania", "adres zamieszkania"],
    ["wiórki koksowe", "wiórki kokosowe"],
    ["wiórków koksowych", "wiórków kokosowych"],
    ["wiórkami koksowymi", "wiórkami kokosowymi"],
    ["mleko koksowe", "mleko kokosowe"],
    ["mleczko koksowe", "mleczko kokosowe"],
  ] satisfies PhraseRow[]),
  // "pół godziny": "pól" is the genitive plural of "pole" (fields).
  ...words("godziny roku litra kilo minuty miesiąca dnia wieku metra tony etatu").map(
    (span): PhraseRow => [`pól ${span}`, `pół ${span}`],
  ),
  ...words("golfowych ryżowych minowych bitewnych naftowych").map((kind): PhraseRow => [
    `pół ${kind}`,
    `pól ${kind}`,
  ]),
  // "szkoła średnia": "szkoda" is damage.
  ...(
    [
      ["szkoda", "szkoła", "a"],
      ["szkody", "szkoły", "ej"],
      ["szkodę", "szkołę", "ą"],
      ["szkodzie", "szkole", "ej"],
      ["szkodą", "szkołą", "ą"],
    ] as const
  ).flatMap(([typed, fixed, ending]) =>
    ["średni", "podstawow"].map((kind): PhraseRow => {
      const adj = `${kind}${kind.endsWith("i") ? ending.replace(/^e/u, "") : ending}`;
      return [`${typed} ${adj}`, `${fixed} ${adj}`];
    }),
  ),
  // "z tego powodu": "powody" is the plural.
  ...["", "tego ", "jakiego ", "innego ", "tego samego ", "jakiegoś ", "żadnego "].map(
    (det): PhraseRow => [`z ${det}powody`, `z ${det}powodu`],
  ),
  ...words("tego tamtego całego danego ostatniego").map((det): PhraseRow => [
    `${det} okresy`,
    `${det} okresu`,
  ]),
  // A cookie cutter cuts ("wykrawacz"); a metal detector detects ("wykrywacz").
  ...words("wykrywacz wykrywacza wykrywacze wykrywaczem wykrywaczy").flatMap((tool) =>
    ["do ciastek", "do ciasta"].map((use): PhraseRow => [
      `${tool} ${use}`,
      `wykrawacz${tool.slice(9)} ${use}`,
    ]),
  ),
  ...words("wykrawacz wykrawacza wykrawacze wykrawaczem").flatMap((tool) =>
    ["metali", "min"].map((use): PhraseRow => [
      `${tool} ${use}`,
      `wykrywacz${tool.slice(9)} ${use}`,
    ]),
  ),
];

const RULE = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
} as const;
/** The typed word starts with a capital: a name or a title, not the slip. */
const lower = (fix: string) => (m: RegExpExecArray) =>
  /^\p{Lu}/u.test(m.groups!.target) ? null : fix;
const NEXT_WORD = `(?=${S}\\p{Ll})`;
const CLAUSE_END = "(?=[ \\t\\u00a0]*(?:[.!?,;]|$))";

const FRAMES: readonly Frame[] = [
  // "Skłam serdeczne życzenia" -> "Składam".
  {
    pattern: `(?<target>skłamy?)(?=(?:${S}\\p{Ll}{3,20}(?:e|ie)){1,2}${S}życzenia${END})`,
    fix: (m) => (m.groups!.target.length === 6 ? "składamy" : "składam"),
    ...RULE,
  },
  // "tam i z potworem" -> "tam i z powrotem".
  {
    pattern: `(?<target>potworem)(?<=(?:^|[^\\p{L}])(?:tam|tu|do${S}\\p{L}{2,20}(?:${S}\\p{L}{2,20})?)${S}i${S}z${S}potworem)${CLAUSE_END}`,
    fix: "powrotem",
    ...RULE,
  },
  // "podlegać ocenie" (dative); "podlać" waters something.
  {
    pattern: `(?<target>podleją|podleje)(?=${S}(?:ocenie|kontroli|opodatkowaniu|zmianie|zmianom|karze|regulacji|ochronie|przepisom|ustawie|weryfikacji|likwidacji|wymianie)${END})|(?<=(?:^|[^\\p{L}])(?:temu|czemu)${S})(?<target>podleją|podleje)${END}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "podleją" ? "podlegają" : "podlega"),
    ...RULE,
  },
  // "nie mieć nic wspólnego": "noc" (night) is a slip.
  {
    pattern: `(?<target>noc)(?=${S}wspólnego(?:${S}z${END}|[ \\t\\u00a0]*[.!?,;]))`,
    fix: "nic",
    ...RULE,
  },
  // "pół szklanki wody": "szklani" are glass men.
  {
    pattern: `(?<target>szklani)(?=${S}(?:wody|wrzątku|mleka|soku|herbaty|cukru|mąki|wina|piwa|kawy|kefiru|śmietany|oleju|ryżu|kaszy)${END})`,
    fix: "szklanki",
    ...RULE,
  },
  // "bardziej" cut short after a degree word or before an adverb; "o bardzie" is a bard.
  {
    pattern: `(?<target>bardzie)${END}(?:(?<=(?:^|[^\\p{L}])(?:im|a|coraz|jeszcze|dużo|znacznie|nieco|trochę|wiele|zdecydowanie)${S}bardzie)|(?=${S}(?:\\p{Ll}{3,20}(?:nie|wo|ko)|niż)${END}))`,
    fix: "bardziej",
    ...RULE,
  },
  // "u stóp góry": "stup" is the plural genitive of "stupa".
  {
    pattern: `(?<target>stup)(?=${S}(?:góry|gór|wzgórza|zapory|schodów|łóżka|ołtarza|tronu|pomnika|zamku)${END})`,
    fix: "stóp",
    ...RULE,
  },
  // "coraz lepie", "jeszcze wyże": a comparative adverb that lost its "-j".
  {
    pattern: `(?<target>lepie|wyże|niże|gorze|bliże|częście|szybcie|dłuże)${END}(?<=(?:^|[^\\p{L}])(?:coraz|jeszcze|znacznie|dużo|nieco|trochę|zdecydowanie|wiele|daleko)${S}\\p{Ll}{4,7})`,
    fix: (m) => `${m.groups!.target}j`,
    ...RULE,
  },
  // "coraz skutecznej." -> "skuteczniej": after "coraz", a clause-final word is an adverb.
  {
    pattern: `(?<target>\\p{Ll}{2,20}nej)${CLAUSE_END}(?<=(?:^|[^\\p{L}])coraz${S}\\p{Ll}{5,23})`,
    fix: (m) => `${m.groups!.target.slice(0, -3)}niej`,
    ...RULE,
  },
  // "w przededniu wyborów" is the only use of "przededniu" (with a genitive after it).
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|jej|jego|ich|tego|tym|swoim|owym)${S})(?<target>przededniu)(?=${S}(?:\\p{L}{1,20}(?:ów|ych|ich|ego|ej|y|i|a|u)|świąt)${END})`,
    fix: "w przededniu",
    ...RULE,
  },
  // "na podstawie danych": the preposition is part of the phrase.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:na|o|w|przy|po|ku|się|tej|jej|tylko|samej|solidnej|mocnej)${S})(?<target>podstawie)(?=${S}(?:danych|informacji|umowy|ustawy|art|artykułu|przepisów|wyników|badań|analizy|decyzji|dokumentów|faktury|wniosku|opinii|zaświadczenia|orzeczenia|uchwały|porozumienia)${END})`,
    fix: "na podstawie",
    ...RULE,
  },
  // "niezbyt dobrze": "niebyt" is nonexistence.
  {
    pattern: `(?<target>niebyt)(?=${S}(?:dobrze|dobry|dobra|dobre|dużo|duży|duża|duże|wiele|często|długo|chętnie|mądrze|mądry|ładnie|jasno|jasne|pewnie|pewny|daleko|blisko|szybko|wysoko|wysoki|zadowolony|zadowolona|zadowoleni|zdrowy|zdrowo|udany|udana|udane|miło|miły|wygodnie|wygodny|łatwo|łatwy|łatwe|trudny|trudno|ciekawy|ciekawe|ciekawie)${END})`,
    fix: "niezbyt",
    ...RULE,
  },
  // "Nagroda Główna", "Dworzec Główny": the capital names the institution.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:Nagroda|Nagrodę|Nagrody|Nagrodą|Komenda|Komendy|Komendzie|Komendę|Biblioteka|Biblioteki|Bibliotece|Księgowa|Księgowej|Kwatera|Kwatery|Rada|Rady|Radzie|Poczta|Poczty|Poczcie|Dworzec|Dworca|Dworcu|Urząd|Urzędu|Urzędzie|Inspektorat|Inspektoratu|Sztab|Sztabu|Rynek|Rynku)${S})(?<target>Gówn(?:a|ej|ą|ę|y|ego|ym|emu))${END}`,
    fix: (m) => (/^G/u.test(m.groups!.target) ? `Główn${m.groups!.target.slice(4)}` : null),
    ...RULE,
    verbatim: true,
  },
  // "ogólne informacje": "w ogóle" keeps "ogóle".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:w|we)${S})(?<target>ogóle)(?=${S}(?:informacje|zasady|warunki|przepisy|uwagi|wiadomości|pojęcia|wytyczne|założenia|dane|kryteria|cechy|wymagania|postanowienia)${END})`,
    fix: "ogólne",
    ...RULE,
  },
  // "jedna rzecz": lowercase "jena" is no word ("Jena" is a town).
  {
    pattern: `(?<target>jena)(?=${S}(?:rzecz|osoba|sprawa|strona|część|kobieta|noc|chwila|godzina|minuta|książka|odpowiedź|myśl|droga|szansa|z)${END})`,
    fix: lower("jedna"),
    ...RULE,
  },
  // "o tej porze": "potrze" is a verb ("rub").
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:o|tej|każdej|dowolnej|późnej|wczesnej|nocnej|samej|innej|jakiej)${S})(?<target>potrze)${END}`,
    fix: "porze",
    ...RULE,
  },
  // "popełnić literówkę": "litrówka" is a litre bottle.
  {
    pattern: `(?<target>litrówk\\p{Ll}{0,3})(?<=(?:^|[^\\p{L}])popełni\\p{Ll}{0,6}${S}(?:\\p{Ll}{2,12}${S})?litrówk\\p{Ll}{0,3})${END}`,
    fix: (m) => `literówk${m.groups!.target.slice(7)}`,
    ...RULE,
  },
  // "boja się o" (a buoy) -> "boję się", "boją się".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:nie|się)${S})(?<target>boja)(?=${S}się(?:${S}(?:o|że|tego|go|jej|ich|mnie|ciebie|was|nas|ją|ludzi)${END}|,${S}że${END}))`,
    fix: ["boję", "boją"],
    ...RULE,
  },
  // "ludzie lubią": "lubą" is the instrumental of "luba" (sweetheart).
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:nie|oni|one|ludzie|wszyscy|dzieci|którzy|które)${S})(?<target>lubą)${END}`,
    fix: "lubią",
    ...RULE,
  },
  // A nursery is "żłobek" ("żłobka"); the crib in Bethlehem is "żłóbek".
  {
    pattern: `(?<target>żłóbk(?:a|u|iem|i|ach|ów))(?=${S}(?:przyzakładow|miejsk|publiczn|prywatn|gminn|integracyjn|państwow)\\p{Ll}{1,4}${END})`,
    fix: (m) => `żłobk${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  {
    pattern: `(?<target>żłobk(?:a|u|iem|ach))(?=${S}betlejemsk\\p{Ll}{1,4}${END})`,
    fix: (m) => `żłóbk${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  // "zmysł wzroku": "wzorek" is a pattern.
  {
    pattern: `(?<target>wzorku)${END}(?<=(?:^|[^\\p{L}])(?:zmysł\\p{Ll}{0,3}|narząd\\p{Ll}{0,3}|ostrość|ostrości|utrat\\p{Ll}{1,2}|zaburzeni\\p{Ll}{1,3}|badani\\p{Ll}{1,3}|kontakt\\p{Ll}{0,3})${S}wzorku)`,
    fix: "wzroku",
    ...RULE,
  },
  // "przedstawić zarzuty": "przestawić" moves something.
  {
    pattern: `(?<target>przestawi(?:ono|ł|ła|li|ć|a|ają|any|ane|one))(?=(?:${S}\\p{Ll}{2,15}){0,2}${S}zarzut\\p{Ll}{0,3}${END})|(?<target>przestawi(?:ono|ł|ła|li))${END}(?<=(?:^|[^\\p{L}])zarzut\\p{Ll}{0,3}(?:${S}\\p{Ll}{2,15})?${S}przestawi\\p{Ll}{1,3})`,
    fix: (m) => `przed${m.groups!.target.slice(4)}`,
    ...RULE,
  },
  // "podrapał si po głowie" -> "się" after a past form or an infinitive.
  {
    pattern: `(?<target>si)(?=${S}(?!(?:bemol|dur|moll|krzyżyk)${END})\\p{Ll}|[ \\t\\u00a0]*[.,!?;])(?<=(?:^|[^\\p{L}])\\p{Ll}{2,20}(?:ł|ła|ło|li|ły|ać|ić|yć|eć|ąć)${S}si)`,
    fix: "się",
    ...RULE,
  },
  // "mamy naprawdę wiele": "naprawę" (a repair) before an intensified word.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:mamy|jest|są|to|był|była|było|byli|ale|bo|czy)${S})(?<target>naprawę)(?=${S}(?:wiele|dużo|bardzo|mało|super|świetn\\p{Ll}{1,3}|fajn\\p{Ll}{1,3}|dobr\\p{Ll}{1,3}|ciekaw\\p{Ll}{1,3}|trudn\\p{Ll}{1,3}|ważn\\p{Ll}{1,3}|nie)${END})`,
    fix: "naprawdę",
    ...RULE,
  },
  // "To mój prezent dal niego" -> "dla"; "w dal" is "into the distance".
  {
    pattern: `(?<!(?:^|[^\\p{L}])w${S})(?<target>dal)(?=${S}(?:niego|niej|nich|ciebie|siebie|nas|was|mnie|mamy|taty|dzieci)${END})`,
    fix: lower("dla"),
    ...RULE,
  },
  // "ściśle określone": the adverb, not the adjective "ścisły".
  {
    pattern: `(?<target>ścisł(?:e|y|a|ą|ym|ego|ej|i))(?=${S}(?:określon|związan|ustalon|zdefiniowan|wyznaczon|ograniczon|przestrzegan|regulowan|kontrolowan|tajn)\\p{Ll}{1,3}${END})`,
    fix: "ściśle",
    ...RULE,
  },
  // "różnych": "rożny" is the corner of a pitch ("rzut rożny").
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:rzut\\p{Ll}{0,3}|róg|rogu|kąt\\p{Ll}{0,3}|chorągiew\\p{Ll}{0,3}|chorągiewk\\p{Ll}{0,3})${S})(?<target>rożn(?:ych|ymi|ego|ej|ym))(?=${S}(?!rzut)\\p{Ll})`,
    fix: (m) => `różn${m.groups!.target.slice(4)}`,
    ...RULE,
  },
  // "stała się gwiazdą": "stałą" is an adjective form, not the past verb.
  {
    pattern: `(?<target>(?:stał|okazał|wydawał|zdawał)ą)(?=${S}się${S}\\p{Ll}{2,20}(?:ą|em|ym|im|ami)${END})`,
    fix: (m) => `${m.groups!.target.slice(0, -1)}a`,
    ...RULE,
  },
  // "Wiśniewski, alei" after "nie tylko": "ale i".
  {
    pattern: `(?<target>alei)(?<=nie${S}tylko[^.!?]{1,80},${S}alei)${NEXT_WORD}`,
    fix: "ale i",
    ...RULE,
  },
  // "Ta strona zawiera informacje": "zwierać" clenches.
  {
    pattern: `(?<target>zwiera(?:ją|ł|ła|ło|ły)?)(?=(?:${S}\\p{Ll}{2,15})?${S}(?:informacj\\p{Ll}{1,3}|dane|danych|treść|treści|tekst|opis|opisy|listę|wykaz|zbiór|instrukcj\\p{Ll}{1,3}|przepisy|zapisy)${END})`,
    fix: (m) => `zawiera${m.groups!.target.slice(6)}`,
    ...RULE,
  },
  // "miał zamiar": "miął" crumples.
  {
    pattern: `(?<target>miął)(?=${S}(?:zamiar|ochotę|nadzieję|rację|okazję|czas|problem|pecha|szczęście|być)${END})`,
    fix: "miał",
    ...RULE,
  },
  // "nadstawiać karku": "nastawiać" sets something.
  {
    pattern: `(?<target>nastawi\\p{Ll}{0,5})(?=(?:${S}\\p{Ll}{2,12}){0,3}${S}(?:karku|głowy|ucha|uszu)${END})`,
    fix: (m) => `nad${m.groups!.target.slice(2)}`,
    ...RULE,
  },
  // "wysoką rangę": the English "range" after a Polish adjective.
  {
    pattern: `(?<target>range)${END}(?<=\\p{Ll}{2,20}ą${S}range)`,
    fix: lower("rangę"),
    ...RULE,
  },
  // "znaczną część": "znaczą" is a verb ("they mean").
  {
    pattern: `(?<target>znaczą)(?=${S}(?:część|ilość|większość|liczbę|kwotę|sumę|poprawę|przewagę)${END})`,
    fix: "znaczną",
    ...RULE,
  },
  // "Nie oznacza to, że": "oznacz" is the imperative.
  {
    pattern: `(?<target>oznacz)(?=${S}to(?:${S}(?:jednak|wcale|jeszcze))?,?${S}że${END})`,
    fix: "oznacza",
    ...RULE,
  },
  // "Ministerstwo Zdrowia": "zdrowa" is the adjective.
  {
    pattern: `(?<target>zdrowa)${END}(?<=(?:^|[^\\p{L}])(?:ministerstw\\p{Ll}{0,3}|ministr\\p{Ll}{0,3}|ochron\\p{Ll}{0,2}|służb\\p{Ll}{0,2}|poradni\\p{Ll}{0,2}|ośrod\\p{Ll}{0,4}|centrum|fundusz\\p{Ll}{0,2})${S}zdrowa)`,
    fix: "zdrowia",
    ...RULE,
  },
  // "Powstanie Warszawskie": "postanie" means "will stand".
  {
    pattern: `(?<target>postanie)(?=${S}(?:warszawski|styczniow|listopadow|wielkopolski|śląski|kościuszkowski)\\p{Ll}{1,3}${END})`,
    fix: "powstanie",
    ...RULE,
  },
  // "do nich": the particle "niech" never follows a preposition.
  {
    pattern: `(?<=(?:^|[^\\p{L}])(?:do|od|z|u|dla|bez|przez|na|o|po|za|przy|wśród|między|przed|nad|pod)${S})(?<target>niech)${END}`,
    fix: "nich",
    ...RULE,
  },
  // "pozwala sobie": "pozawalać" knocks things down.
  {
    pattern: `(?<target>pozawal\\p{Ll}{1,5})(?=${S}(?:sobie|mu|jej|im|nam|wam|mi|ci|na|to${S}na)${END})`,
    fix: (m) => `pozwal${m.groups!.target.slice(7)}`,
    ...RULE,
  },
  // "startować w wyborach": "stratować" tramples.
  {
    pattern: `(?<target>stratow\\p{Ll}{1,5})(?=${S}w${S}(?:wyborach|igrzyskach|zawodach|konkursie|maratonie|wyścigu|turnieju|mistrzostwach|olimpiadzie|plebiscycie)${END})`,
    fix: (m) => `start${m.groups!.target.slice(5)}`,
    ...RULE,
  },
  // "ponieść straty": "starty" are starts.
  {
    pattern: `(?<target>starty)${END}(?<=(?:^|[^\\p{L}])(?:poni\\p{Ll}{1,5}|ponosi\\p{Ll}{0,3}|odrabia\\p{Ll}{0,3}|odrobi\\p{Ll}{0,3}|wyrówna\\p{Ll}{0,3})(?:${S}\\p{Ll}{2,15})?${S}starty)`,
    fix: "straty",
    ...RULE,
  },
  // "z naprzeciwka", "z przeciwka": the words exist only after "z".
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:z|na|zna)${S})(?<target>naprzeciwka|przeciwka)${END}`,
    fix: (m) => `z ${m.groups!.target}`,
    ...RULE,
  },
  // "na czele": "czele" lives only in the phrase.
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:na|w)(?:${S}\\p{L}{1,15}){0,2}${S})(?<target>czele)${END}`,
    fix: "na czele",
    ...RULE,
  },
  // "wespół z kimś", "wespół w zespół".
  {
    pattern: `(?<target>wespół)(?=${S}(?!(?:z|ze|w)${END})\\p{Ll}{0,20}(?:ą|em|iem|ami|mi|ymi|imi|kimś|nim|nią)${END})`,
    fix: "wespół z",
    ...RULE,
  },
  {
    pattern: `(?<target>wespół${S}w)(?=${S}\\p{Ll}{2,20}(?:ami|mi|ymi|imi)${END})`,
    fix: "wespół z",
    ...RULE,
  },
  {
    pattern: `(?<target>wespół${S}zespół)${END}`,
    fix: "wespół w zespół",
    ...RULE,
  },
  // "a w związku z tym": the phrase needs its "w".
  {
    pattern: `(?<=(?:(?:^|[^\\p{L}])(?:a|i|ale|lecz|więc|oraz)|[,;])${S})(?<target>związku)(?=${S}z${S}(?:tym|powyższym|czym)${END})`,
    fix: "w związku",
    ...RULE,
  },
  // "W lato" -> "Latem", "W lecie".
  {
    pattern: `${CLAUSE_START}(?<target>W${S}lato)${NEXT_WORD}`,
    fix: ["Latem", "W lecie"],
    ...RULE,
    verbatim: true,
  },
  // "inny niż": "jak" compares like things ("nikt inny jak" keeps it).
  {
    pattern: `(?<!(?:^|[^\\p{L}])(?:nikt|nic|ktoś|coś|kto|co|któż|cóż|nikogo|niczego|nikomu|niczym|nikim)${S})(?<target>inn(?:y|a|e|i|ego|ej|emu|ą|ym|ych|ymi)${S}jak)(?=${S}(?!nie${END})\\p{Ll})`,
    fix: (m) => m.groups!.target.replace(/jak$/iu, "niż"),
    ...RULE,
  },
];

const NO_LETTER_AFTER = "(?![\\p{L}\\p{N}_'’-])";
/** A preposition straight before an infinitive or an adverbial participle. */
const PREPOSITION_VERB = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<prep>na|do|od|dla|bez|przez|przy|u|z|ze|w|we|o)[ \\t\\u00a0]{1,8}(?<verb>\\p{Ll}{3,}(?:ać|eć|ić|yć|ąć|uć|ąc))${NO_LETTER_AFTER}`,
  "gu",
);
/** "cale życie": "cale" (inches) before a neuter noun is "całe". */
const INCHES = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<target>cale)[ \\t\\u00a0]{1,8}(?<noun>\\p{Ll}{3,20})${NO_LETTER_AFTER}`,
  "giu",
);
/** "bać" is always reflexive: a form with no "się" in its clause. */
const AFRAID = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?<verb>bał|bała|bało|bały|bałem|bałam|bałeś|bałaś|baliśmy|bałyśmy|boi|boję|boisz|boimy|boicie|bać)${NO_LETTER_AFTER}`,
  "giu",
);
/** "się bał się": one "się" serves the verb. */
const TWO_SIE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])się[ \\t\\u00a0]{1,8}(?<verb>\\p{Ll}{2,20})(?<gap>[ \\t\\u00a0]{1,8})się${NO_LETTER_AFTER}`,
  "giu",
);
const NOT_A_VERB = new Set(
  words("to nie tak już teraz tu tam i a że by jak gdy co też tylko bardzo trochę wtedy znowu"),
);

function slips(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const push = (start: number, end: number, fix: string) => {
    const typed = ctx.source.slice(start, end);
    if (userOrNamed(ctx, typed)) return;
    findings.push(findingAt(ctx, start, end, [caseLike(typed, fix)], RULE.ruleId, RULE.messageKey));
  };
  for (const m of owned(ctx, PREPOSITION_VERB)) {
    const { verb } = m.groups!;
    if (nounTags(verb) || /(?:siąc|zając)$/u.test(verb)) continue;
    push(m.index, m.index + m[0].length, verb);
  }
  for (const m of owned(ctx, INCHES)) {
    const tags = nounTags(m.groups!.noun);
    if (!onlyNoun(tags) || !(tags & NEUTER) || !(tags & cases("Ns As"))) continue;
    if (/^\p{Lu}/u.test(m.groups!.target)) continue;
    push(m.index, m.index + 4, "całe");
  }
  for (const m of owned(ctx, AFRAID)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = ctx.text.slice(Math.max(0, start - 48), start);
    const after = ctx.text.slice(end, end + 40);
    const clauseBefore = before.slice(before.search(/[^.!?;:,\n]*$/u));
    const clauseAfter = after.slice(0, (after.search(/[.!?;:,\n]/u) + 1 || after.length + 1) - 1);
    if (/(?:^|[^\p{L}])się(?![\p{L}])/iu.test(`${clauseBefore} ${clauseAfter}`)) continue;
    // "za boją", "o boi": the noun "boja".
    if (/(?:^|[^\p{L}])(?:z|za|przed|nad|pod|między|o|na|przy|po|w|we)[ \t\u00a0]+$/iu.test(before))
      continue;
    push(start, end, `${m.groups!.verb} się`);
  }
  for (const m of owned(ctx, TWO_SIE)) {
    const verb = m.groups!.verb;
    const lowerVerb = verb.toLowerCase();
    if (NOT_A_VERB.has(lowerVerb)) continue;
    if (!finiteVerb(lowerVerb) && !listedVerb(lowerVerb) && !pastByShape(lowerVerb)) continue;
    const start = m.index + m[0].indexOf(verb, 3);
    push(start, m.index + m[0].length, verb);
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE.ruleId] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) && (!ctx.rules || ctx.rules.has(RULE.ruleId))
        ? [...runFrames(ctx, FRAMES), ...slips(ctx)]
        : [],
  },
];
