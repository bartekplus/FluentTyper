import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { CLAUSE_START } from "../../src/core/domain/grammar/review/polish/shared";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

/** Polish-only Review checks: every positive gets its first fix, every negative stays clean. */
function findings(ruleId: CatalogRuleId, text: string, lang = "pl_PL") {
  return detectReviewDiagnostics(
    { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

type Case = { pos: Array<[string, string]>; neg: string[] };

export const POLISH_CASES: Array<[CatalogRuleId, string, Case]> = [
  [
    "stylePhrasing",
    '"dwie lub więcej" with its noun recased',
    {
      pos: [
        ["Czekał na nią dwie lub więcej godzin.", "Czekał na nią co najmniej dwie godziny."],
        [
          "Pisał o trzech lub więcej ciekawych książek.",
          "Pisał o co najmniej trzech ciekawych książkach.",
        ],
        ["Pomógł czterem lub więcej rodzin.", "Pomógł co najmniej czterem rodzinom."],
        [
          "Opiekował się dwoma lub więcej kotów sąsiadów.",
          "Opiekował się co najmniej dwoma kotami sąsiadów.",
        ],
        ["Przyszło pięć lub więcej osób.", "Przyszło co najmniej pięć osób."],
        ["Weź dwa lub więcej.", "Weź co najmniej dwa."],
      ],
      neg: ["Weź dwa albo trzy.", "Wypił więcej niż dwie kawy.", "Kupił dwie lub trzy bułki."],
    },
  ],
  [
    "englishClosedCompounds",
    "guarded split words",
    {
      pos: [
        ["Ona na prawdę lubi pływać.", "Ona naprawdę lubi pływać."],
        ["Zrobiliśmy duży krok na przód.", "Zrobiliśmy duży krok naprzód."],
        ["Było śmiesznie i smutne za razem.", "Było śmiesznie i smutne zarazem."],
        ["Wróci za pewne jutro.", "Wróci zapewne jutro."],
        ["Stanął po środku sali.", "Stanął pośrodku sali."],
        ["Kolejka po woli się przesuwa.", "Kolejka powoli się przesuwa."],
        ["Ponad to dostał premię.", "Ponadto dostał premię."],
        ["Nikt z resztą nie pytał.", "Nikt zresztą nie pytał."],
        ["Jest co raz zimniej.", "Jest coraz zimniej."],
        ["Spóźnił się dla tego, że padało.", "Spóźnił się dlatego, że padało."],
        ["Dla czego nie dzwonisz?", "Dlaczego nie dzwonisz?"],
        ["W prawdzie padało, ale poszliśmy.", "Wprawdzie padało, ale poszliśmy."],
        ["Usiadł na tam tym krześle.", "Usiadł na tamtym krześle."],
        ["Nie rób tego dla swojego widzi mi się.", "Nie rób tego dla swojego widzimisię."],
        ["Wyjechała zagranicę na rok.", "Wyjechała za granicę na rok."],
        ["Nie był wstanie odpowiedzieć.", "Nie był w stanie odpowiedzieć."],
        ["Przyjdę jutro popołudniu.", "Przyjdę jutro po południu."],
        ["Krążył na około wieży.", "Krążył naokoło wieży."],
        ["Takie zachowanie jest kary godne.", "Takie zachowanie jest karygodne."],
        ["Tym nie mniej warto spróbować.", "Tym niemniej warto spróbować."],
        ["By najmniej nie żałuję.", "Bynajmniej nie żałuję."],
        ["Za zwyczaj wstaję wcześnie.", "Zazwyczaj wstaję wcześnie."],
        ["To była naj lepsza zabawa roku.", "To była najlepsza zabawa roku."],
        ["Odwiedza nas naj częściej w maju.", "Odwiedza nas najczęściej w maju."],
        ["Gazeta wychodzi co tygodniowo.", "Gazeta wychodzi cotygodniowo."],
        ["Skończę wciągu tygodnia.", "Skończę w ciągu tygodnia."],
        ["To jest kompletnie bezsensu.", "To jest kompletnie bez sensu."],
        ["Zrobił by to bez wahania.", "Zrobiłby to bez wahania."],
        ["Nie mógł bym tak żyć.", "Nie mógłbym tak żyć."],
        ["Chętnie poszła by do kina.", "Chętnie poszłaby do kina."],
        ["Wczoraj zrobili śmy zakupy.", "Wczoraj zrobiliśmy zakupy."],
        ["Wynik był nie zadowalający.", "Wynik był niezadowalający."],
        ["Obiad jest nie gotowy.", "Obiad jest niegotowy."],
        ["Prosimy o nie parkowanie tutaj.", "Prosimy o nieparkowanie tutaj."],
        ["Nie łatwo to przyznać.", "Niełatwo to przyznać."],
        ["Jego obecność była nie potrzebna.", "Jego obecność była niepotrzebna."],
      ],
      neg: [
        "Czekamy na prawdę.",
        "Mamy dowód na prawdę tego twierdzenia.",
        "Przesunął się na przód autobusu.",
        "Strzelał raz za razem.",
        "Uznał to za pewne.",
        "Za pewne kwoty można wiele kupić.",
        "Zasnął po środku nasennym.",
        "Mieszkam po Woli i Mokotowie.",
        "Wyszło ponad to, co planowaliśmy.",
        "Wróciłem z resztą rodziny.",
        "To jest dla tego człowieka.",
        "Nie ma dla czego innego żyć.",
        "Żyli w prawdzie i miłości.",
        "Byłem tam tego dnia.",
        "Nie ma tam tych pieniędzy.",
        "Handel z zagranicą rośnie.",
        "Jutro wstanie wcześnie.",
        "W to popołudniu było cicho.",
        "Straty wyceniono na około pięć milionów.",
        "Wynik wyniósł w około połowie przypadków zero.",
        "Był najwyższej kary godny.",
        "W tym nie mniej niż siedem śledzi.",
        "Nie mniej jednak niż trzydzieści złotych.",
        "Staraj się, by najmniej zaszkodzić.",
        "Uważają łapówki za zwyczaj tak powszechny.",
        "Płacą za co miesięcznie trzydzieści franków?",
        "Morze bezsensu nas otacza.",
        "Ryba przykleiła się do wciągu filtra.",
        "Przyszedł by pomóc.",
        "Chciał bym przyszedł wcześniej.",
        "W tej chwili by się przydał.",
        "Krótko trwały te radości.",
        "Nie można tu palić.",
        "Oni nie giną i nie płoną.",
        "On nie cieszy się z tego.",
        "Wójt nie zabrania picia.",
        "To nie zły pomysł.",
        "Był nie dobry, lecz zły.",
        "Czy nie lepiej zostać?",
        "Jest nie lepszy od brata.",
        "Gdyby nie pewna osoba, przegralibyśmy.",
        "Nie zostanie tu długo.",
        "Nie zna nikogo.",
        "Nie inny jak on to zrobił.",
        "To preferencja, a nie ocena jakości.",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    "look-alike words in context",
    {
      pos: [
        ["Mówiła, ze nic nie wie.", "Mówiła, że nic nie wie."],
        ["Odpisał, ze chce przyjść.", "Odpisał, że chce przyjść."],
        ["Uznano, ze grupa jest za mała.", "Uznano, że grupa jest za mała."],
        ["Ja się tego wcale nie boje.", "Ja się tego wcale nie boję."],
        ["Mamy tak naprawę mało czasu.", "Mamy tak naprawdę mało czasu."],
        ["Był to, rzec jasna, żart.", "Był to, rzecz jasna, żart."],
        ["Zbierali pieniądze na rzec schroniska.", "Zbierali pieniądze na rzecz schroniska."],
        ["Padało, stad też te kałuże.", "Padało, stąd też te kałuże."],
        ["Pies nie dal za wygraną.", "Pies nie dał za wygraną."],
        ["Przedstawiam moją zonę.", "Przedstawiam moją żonę."],
        ["Nie wierze w ani jedno słowo.", "Nie wierzę w ani jedno słowo."],
        ["Mi się to nie podoba.", "Mnie się to nie podoba."],
        ["Ci się tylko tak wydaje.", "Tobie się tylko tak wydaje."],
        ["Przepraszam, ale nic mogę zrobić.", "Przepraszam, ale nic nie mogę zrobić."],
        [
          "Chodzi do Szkoły imieniem Marii Konopnickiej.",
          "Chodzi do Szkoły imienia Marii Konopnickiej.",
        ],
        [
          "Nie zaglądam na fora, bo nie lubię anonimowych for.",
          "Nie zaglądam na fora, bo nie lubię anonimowych forów.",
        ],
        ["Jego nazwisko nie schodzi z łam prasy.", "Jego nazwisko nie schodzi z łamów prasy."],
        ["Powinnam byłam zadzwonić wcześniej.", "Powinnam była zadzwonić wcześniej."],
        ["Ja nie rozumie tego zadania.", "Ja nie rozumiem tego zadania."],
        ["Myślę ze to dobry pomysł.", "Myślę że to dobry pomysł."],
        ["Kupiłem to bezcen.", "Kupiłem to za bezcen."],
        ["Mówi niemiecku bardzo dobrze.", "Mówi po niemiecku bardzo dobrze."],
        ["Szedł ciemku przez las.", "Szedł po ciemku przez las."],
        ["Nie boje się burzy.", "Nie boję się burzy."],
        ["Boje się ciemności.", "Boję się ciemności."],
        ["Padało, wiec zostaliśmy.", "Padało, więc zostaliśmy."],
        ["On tez przyjdzie.", "On też przyjdzie."],
        ["Zapłacił 20% mnie niż ja.", "Zapłacił 20% mniej niż ja."],
        ["Zostało mnie więcej pięć minut.", "Zostało mniej więcej pięć minut."],
        ["To była pierwsza cześć filmu.", "To była pierwsza część filmu."],
        ["Spłynęła na nas boża laska.", "Spłynęła na nas boża łaska."],
        ["Na górze znajduję się pokój gościnny.", "Na górze znajduje się pokój gościnny."],
        ["Musze już iść.", "Muszę już iść."],
        ["Uczniowie maja dziś wolne.", "Uczniowie mają dziś wolne."],
        ["Interesuje się głownie historią.", "Interesuje się głównie historią."],
        ["Stał miedzy nami.", "Stał między nami."],
        ["Problem nadaj występuje.", "Problem nadal występuje."],
        ["Było tam klika osób.", "Było tam kilka osób."],
        ["Był rządny władzy.", "Był żądny władzy."],
        ["Nie zwalniaj tępa pracy.", "Nie zwalniaj tempa pracy."],
        ["Mama karze mu sprzątać.", "Mama każe mu sprzątać."],
        ["Pokarz mi zdjęcia.", "Pokaż mi zdjęcia."],
        ["Nie wierze w to.", "Nie wierzę w to."],
        ["Wyszedł tuz przed północą.", "Wyszedł tuż przed północą."],
        ["Nie oto chodzi.", "Nie o to chodzi."],
        ["Moim zadaniem, to błąd.", "Moim zdaniem, to błąd."],
        ["Przyszedł wraz nim.", "Przyszedł wraz z nim."],
        ["Mimo różnić się dogadali.", "Mimo różnic się dogadali."],
        ["Nie jestem skłony do zmian.", "Nie jestem skłonny do zmian."],
        ["Spłacił koszty sadowe.", "Spłacił koszty sądowe."],
        ["Urodził się 3 litego 1990.", "Urodził się 3 lutego 1990."],
        ["Był to, rzecz można, wzór.", "Był to, rzec można, wzór."],
        ["Damy rade bez ciebie.", "Damy radę bez ciebie."],
        ["Jako widać, działa.", "Jak widać, działa."],
      ],
      neg: [
        "Ci ludzie mieszkają obok.",
        "Za nic mam twoje rady.",
        "Nie łam zasad, proszę.",
        "Mnie się to podoba.",
        "Wyszedł ze szkoły po lekcjach.",
        "Zrobił to ze chciwości.",
        "Na jeziorze kołysały się boje.",
        "Patrzyła w dal przez okno.",
        "Rozmawiali o wierze i nadziei.",
        "Stado owiec szło drogą, a za nim inne stada.",
        "Wyszedł ze szkoły wcześnie.",
        "Rozmawiał ze mną długo.",
        "Wrócę ze dwa razy.",
        "Pochodzi ze Lwowa.",
        "Kupiłem to za bezcen.",
        "Mówi po polsku i angielsku.",
        "Toczyły się boje o miasto.",
        "Zorganizowano wiec poparcia.",
        "Napisał kilka tez programowych.",
        "Dostał ode mnie więcej niż ja od niego.",
        "I coraz mnie mniej.",
        "Cześć jego pamięci!",
        "Oparł się na lasce.",
        "Gdzie się znajduję?",
        "Znajduję się w trudnej sytuacji.",
        "Usiadła na musze.",
        "Wrócili pod koniec maja z urlopu.",
        "Mieszka w Głownie od lat.",
        "Szła wzdłuż miedzy.",
        "Nadaj ten list jutro.",
        "Rządzi nimi klika polityków.",
        "Rządna koalicja przetrwała.",
        "Patrzył tępo w ścianę.",
        "Sąd karze go grzywną.",
        "Pan Bóg nie rychliwy, ale sprawiedliwy, karze złych.",
        "Mieszkam w wierze i nadziei.",
        "Rozdał tuz pik.",
        "Oto chłopiec, o którym mówiłem.",
        "Moim zadaniem jest sprzątanie.",
        "Zgodnie twierdzą, że wygrali.",
        "Ćwiczy skłony do przodu.",
        "Ma sad i sadowe drzewa.",
        "Można rzecz kupić w sklepie.",
        "Sprawił, że się roześmiała.",
      ],
    },
  ],
  [
    "polishNumerals",
    "digits with endings, digit compounds, numeral and noun forms",
    {
      pos: [
        ["Wygrał już 3-ci raz.", "Wygrał już 3. raz."],
        ["Cena wzrosła trzy krotnie.", "Cena wzrosła trzykrotnie."],
        ["Zysk był 4. krotnie wyższy.", "Zysk był 4-krotnie wyższy."],
        ["Zatrudnili 30 - letniego kierowcę.", "Zatrudnili 30-letniego kierowcę."],
        ["Plan 3—letni przyjęto.", "Plan 3-letni przyjęto."],
        ["Przyjechał 12-go czerwca.", "Przyjechał 12 czerwca."],
        ["Moda z lat 80-tych wraca.", "Moda z lat 80. wraca."],
        ["Zaprosiłem 7-miu gości.", "Zaprosiłem siedmiu gości."],
        ["Dostał 6-tkę z matematyki.", "Dostał szóstkę z matematyki."],
        ["Pamiętam XX-go wieku modę.", "Pamiętam XX wieku modę."],
        ["Mamy 8-mio osobowy stół.", "Mamy 8-osobowy stół."],
        ["Była 10 minutowa przerwa.", "Była 10-minutowa przerwa."],
        ["Został 4 krotnym mistrzem.", "Został 4-krotnym mistrzem."],
        ["Ten 15 latek jest zdolny.", "Ten 15-latek jest zdolny."],
        ["Mają trzy dzieci.", "Mają troje dzieci."],
        ["Bilet kosztował 3 złotych.", "Bilet kosztował 3 złote."],
        ["Reszta to 12 grosze.", "Reszta to 12 groszy."],
        ["Dodaj 200 gram mąki.", "Dodaj 200 gramów mąki."],
      ],
      neg: [
        "Wygrał już 3. raz.",
        "Przyjechał 12 czerwca.",
        "Ma 5kg nadwagi i 10km do domu.",
        "Pokój 2-osobowy jest wolny.",
        "Ten 15-latek jest zdolny.",
        "Obchodzimy 10-lecie firmy.",
        "Kupiłem 2 letnie sukienki.",
        "Porozmawiajmy w cztery oczy.",
        "Zdobył 2 złote medale.",
        "Bilet kosztował 3 złote.",
        "Gram w szachy od 5 lat, a 1 gram to mało.",
        "Wysłał CV-ki do 3 firm.",
        "Mam troje dzieci.",
      ],
    },
  ],
  [
    "polishDates",
    "impossible dates, weekdays and month forms",
    {
      pos: [
        ["Wyjazd 5 marzec 2021.", "Wyjazd 5 marca 2021."],
        ["Spotkanie 3. października.", "Spotkanie 3 października."],
        ["Wpis z 14 Lis 2019.", "Wpis z 14 XI 2019."],
        ["Pierwszy wrzesień był ciepły.", "Pierwszy września był ciepły."],
        ["Od 7 lipiec trwa remont.", "Od 7 lipca trwa remont."],
        ["Moda z lat 1980. wraca.", "Moda z lat 80. XX w. wraca."],
        ["Kocham muzykę lat '70 i więcej.", "Kocham muzykę lat 70. i więcej."],
        ["Bilety na mundial '2018 są drogie.", "Bilety na mundial 2018 są drogie."],
      ],
      neg: [
        "Urodził się 30 września 1990.",
        "Było to 29 lutego 2024.",
        "Dziś jest czwartek, 1 października 2026.",
        "Panował w latach 1814–1781 p.n.e.",
        "W roku 1962 – 272 000 osób.",
        "Rozdział 31 IX opisuje bitwę.",
        "Święto 1 Maj obchodzimy co roku.",
        "Obowiązuje od 2012-05-01.",
        "Zawody trwają od 1 do 10 lutego.",
      ],
    },
  ],
  [
    "polishMisplacedComma",
    "commas inside compound conjunctions and set phrases",
    {
      pos: [
        ["Mimo, że padało, wyszliśmy.", "Mimo że padało, wyszliśmy."],
        ["Zostałem w domu mimo, że chciałem iść.", "Zostałem w domu, mimo że chciałem iść."],
        ["Czytał gazetę podczas, gdy ona spała.", "Czytał gazetę, podczas gdy ona spała."],
        ["Przyjdę chyba, że zachoruję.", "Przyjdę, chyba że zachoruję."],
        ["Jest późno, a, więc idziemy.", "Jest późno, a więc idziemy."],
        ["Podaj numer o, ile go masz.", "Podaj numer, o ile go masz."],
        ["Chcąc, nie chcąc poszedł.", "Chcąc nie chcąc poszedł."],
        ["Kupił jabłka, gruszki, itd.", "Kupił jabłka, gruszki itd."],
        ["Lodówka, jest pusta od tygodnia.", "Lodówka jest pusta od tygodnia."],
        ["Każdy pracownik, dostał premię.", "Każdy pracownik dostał premię."],
        ["Herbata, to mój ulubiony napój.", "Herbata to mój ulubiony napój."],
        ["Pojechał tam mimo, że lało.", "Pojechał tam, mimo że lało."],
        ["Zgodzę się pod warunkiem, że zapłacisz.", "Zgodzę się, pod warunkiem że zapłacisz."],
        ["Pod warunkiem, że zdążysz.", "Pod warunkiem że zdążysz."],
        ["Tyle, że nikt mu nie wierzył.", "Tyle że nikt mu nie wierzył."],
        ["Był bogaty, tyle, że skąpy.", "Był bogaty, tyle że skąpy."],
      ],
      neg: [
        "Zostałem w domu, mimo że chciałem iść.",
        "Mówił wtedy nawet, gdy nikt nie słuchał.",
        "Czy tak, czy owak, idziemy.",
        "O, ile tu ludzi!",
        "Kupił jabłka itp., itd.",
        "Zjadł tyle, że pękł.",
        "Mamo, jest już obiad.",
        "Lodówka, jak zwykle, jest pusta.",
        "Ustawa, powiedział, wchodzi w życie jutro.",
        "Herbata, kawa i sok stały na stole.",
        "Poza tym, ze względu na pogodę, mecz przełożono.",
        "Wypił tyle, że zasnął.",
      ],
    },
  ],
  [
    "polishMissingComma",
    "a comma before a subordinate clause",
    {
      pos: [
        ["Myślę że masz rację.", "Myślę, że masz rację."],
        ["Przyszedł żeby pomóc.", "Przyszedł, żeby pomóc."],
        ["Został w domu ponieważ padało.", "Został w domu, ponieważ padało."],
        ["To jest dom w którym mieszkam.", "To jest dom, w którym mieszkam."],
        ["Znam człowieka który to zrobił.", "Znam człowieka, który to zrobił."],
        ["Jest mały ale wygodny.", "Jest mały, ale wygodny."],
        ["Zadzwoń jeśli możesz.", "Zadzwoń, jeśli możesz."],
        ["Poszła na spacer mimo że lało.", "Poszła na spacer, mimo że lało."],
        ["Pomogę ci pod warunkiem że wrócisz.", "Pomogę ci, pod warunkiem że wrócisz."],
        ["Przyjdę nawet gdybyś nie chciał.", "Przyjdę, nawet gdybyś nie chciał."],
        ["Zasnął dopiero gdy zgasło światło.", "Zasnął, dopiero gdy zgasło światło."],
        ["Ja czytam podczas gdy ty śpisz.", "Ja czytam, podczas gdy ty śpisz."],
        ["Nie dość że padało, to jeszcze wiało.", "Nie dość, że padało, to jeszcze wiało."],
        ["Zadzwoń do mnie kiedy wrócisz.", "Zadzwoń do mnie, kiedy wrócisz."],
        ["Uśmiechnął się gdy weszła.", "Uśmiechnął się, gdy weszła."],
        ["Nie wiem gdzie zostawiłem klucze.", "Nie wiem, gdzie zostawiłem klucze."],
        ["Zapytaj szefa dlaczego zwlekał.", "Zapytaj szefa, dlaczego zwlekał."],
        ["Leżał na kanapie zamiast sprzątać.", "Leżał na kanapie, zamiast sprzątać."],
        ["Martwi mnie to że milczy.", "Martwi mnie to, że milczy."],
        ["Nie wiadomo kiedy wróci z delegacji.", "Nie wiadomo, kiedy wróci z delegacji."],
        ["Wyszedł wcześniej by zdążyć na pociąg.", "Wyszedł wcześniej, by zdążyć na pociąg."],
        ["Usiadła przy oknie by się ogrzać.", "Usiadła przy oknie, by się ogrzać."],
        ["Opowiedz o planach jakie masz na lato.", "Opowiedz o planach, jakie masz na lato."],
        ["Trudno sobie wyobrazić jaka to była ulga.", "Trudno sobie wyobrazić, jaka to była ulga."],
        ["Wszystko zależy od tego czy zdąży.", "Wszystko zależy od tego, czy zdąży."],
        ["Nie zwracaj uwagi na to gdzie mieszka.", "Nie zwracaj uwagi na to, gdzie mieszka."],
        ["Wrócił do domu zatem żeby odpocząć.", "Wrócił do domu zatem, żeby odpocząć."],
        ["Pobiegł na stację tylko żeby zdążyć.", "Pobiegł na stację, tylko żeby zdążyć."],
        [
          "Ustawił krzesła tak żeby wszyscy widzieli.",
          "Ustawił krzesła, tak żeby wszyscy widzieli.",
        ],
        ["Okna umyto by nie było smug.", "Okna umyto, by nie było smug."],
        ["Pracuję by dzieci miały co jeść.", "Pracuję, by dzieci miały co jeść."],
        ["Jak widać nikt nie przyszedł.", "Jak widać, nikt nie przyszedł."],
        ["Jak wiadomo koty lubią spać.", "Jak wiadomo, koty lubią spać."],
        ["Musisz się liczyć z tym że odmówi.", "Musisz się liczyć, z tym że odmówi."],
        ["Twierdzono jednak iż to nieprawda.", "Twierdzono jednak, iż to nieprawda."],
        ["Jest miły tylko że się spóźnia.", "Jest miły, tylko że się spóźnia."],
        ["Kupię to pod warunkiem że będzie tanie.", "Kupię to, pod warunkiem że będzie tanie."],
      ],
      neg: [
        "Myślę, że masz rację.",
        "Wyszedł, mimo że padało.",
        "Mówił tak że nikt nie rozumiał.",
        "A że padało, zostaliśmy.",
        "Wiem, że jeśli przyjdzie, to pomoże.",
        "To ustawa, na podstawie której go skazano.",
        "To młotek, za pomocą którego wbił gwóźdź.",
        "Mało który uczeń to wie.",
        "O której mogę przyjść?",
        "Poślij którego z nich.",
        "Nie ma żadnych ale.",
        "Właśnie że nie pójdę.",
        "Był w pokoju, w którym i w którego oknach paliło się światło.",
        "Wyszedł wcześnie, mimo że nikt go nie gonił.",
        "Przyjdę kiedy indziej.",
        "Szukaj gdzie indziej.",
        "Póki co nic nie wiemy, a my póki co czekamy.",
        "A ty gdzie się wybierasz?",
        "Pracowała dużo, dzięki czemu awansowała.",
        "Jaki ojciec, taki syn.",
        "Był jaki taki, ale nasz.",
        "Kupił chleb zamiast bułek.",
        "Ja czytałem, podczas gdy on spał.",
        "Zjadł wszystko, mimo że nie był głodny.",
        "Chodzi o to, że nie mamy czasu.",
        "Nie wiadomo kiedy zrobiło się ciemno.",
        "Nie wiadomo skąd pojawił się na progu kot.",
        "Można by to zrobić szybciej.",
        "Należało by o tym pomyśleć wcześniej.",
        "Dobrze by było wyjechać.",
        "Jaki piękny dzień dziś mamy!",
        "Taki sam jaki był wczoraj.",
        "Czekaliśmy jakie pół godziny.",
        "Kupował to czy tamto.",
        "To co mam teraz zrobić?",
        "Było tego co niemiara.",
        "Zrobiłbym tak by było lepiej.",
        "Nie tylko żeby pomóc.",
        "Jak widać na wykresie ceny rosną.",
        "Jak wiadomo z historii wojny się kończą.",
        "Dusza jak gdyby uleciała.",
        "Nie tylko że przyszedł, ale i pomógł.",
        "Właśnie że nie pójdę.",
        "A to mimo że padało.",
      ],
    },
  ],
  [
    "polishPrepositionForms",
    "w/we, z/ze, od/ode and the other vowel-extended prepositions",
    {
      pos: [
        ["Spotkajmy się w wtorek.", "Spotkajmy się we wtorek."],
        ["Byłem w Francji.", "Byłem we Francji."],
        ["Mieszka we Łodzi.", "Mieszka w Łodzi."],
        ["Wrócił z szkoły.", "Wrócił ze szkoły."],
        ["Pogadaj z wszystkimi.", "Pogadaj ze wszystkimi."],
        ["To prezent od mnie.", "To prezent ode mnie."],
        ["Nie dam rady bez mnie.", "Nie dam rady beze mnie."],
        ["Stał przed mną.", "Stał przede mną."],
        ["Wyszedł przede nim.", "Wyszedł przed nim."],
        ["Uciekł s domu.", "Uciekł z domu."],
      ],
      neg: [
        "Spotkajmy się we wtorek w Warszawie.",
        "Przede wszystkim spokój.",
        "Zbaw nas ode złego.",
        "Idziemy we dwoje.",
        "Wrócił ze Lwowa z wodą.",
        "Popatrzył spode łba.",
        "Byłem w wodzie i we mgle.",
        "Patrz na s. 12 w tekście.",
        "Wrócił z ZSRR i grał ze Sionem.",
        "Chodził w tę i we w tę.",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    "conventional forms: abbreviations, inflected names, na + regions, predicative -e",
    {
      pos: [
        ["Wyjechali do Węgier na urlop.", "Wyjechali na Węgry na urlop."],
        ["Polecimy do Islandii w maju.", "Polecimy na Islandię w maju."],
        ["Ważnym jest, aby odpocząć.", "Ważne jest, aby odpocząć."],
        ["Oczywistym było, że wygra.", "Oczywiste było, że wygra."],
        ["Ma 3 mln. długu.", "Ma 3 mln długu."],
        ["Podziękuj dr Nowakowi za pomoc.", "Podziękuj dr. Nowakowi za pomoc."],
        ["To zasługa mgr Jana Wiśniewskiego.", "To zasługa mgr. Jana Wiśniewskiego."],
        ["Lubię owoce, np jabłka.", "Lubię owoce, np. jabłka."],
        ["Zapłacił ok 50 zł.", "Zapłacił ok. 50 zł."],
        ["Widziałem Mark'a wczoraj.", "Widziałem Marka wczoraj."],
        ["Rozmawiałam wczoraj z Bruce'm.", "Rozmawiałam wczoraj z Bruce'em."],
        ["Wysłałem list do Freddie'go.", "Wysłałem list do Freddiego."],
        ["Myślę o Clive'ie.", "Myślę o Clivie."],
        ["Pojechałam z Tony'm.", "Pojechałam z Tonym."],
        ["Wysłał mi pięć SMSów.", "Wysłał mi pięć SMS-ów."],
      ],
      neg: [
        "Ta ziemia należała do Węgier.",
        "Z każdym jest tak, że się męczy.",
        "Mieszka pod nr. 5.",
        "Rozmawiałem z dr Kowalską.",
        "Przyjmuje dziś dr Jan Kowalski.",
        "Dzięki dr. Kowalskiemu zdążyliśmy.",
        "Wymienił itd. i itp.",
        "Zajmuję się Joyce'em.",
        "Myślę o Mike'u i Locke'u.",
        "Spotkałam Jane'a?",
        "To szansa dla Jacques'a.",
        "Biografia Kennedy'ego.",
        "Partia PiS wygrała.",
      ],
    },
  ],
];

/** Warnings without a fix: the range is flagged and nothing is offered. */
const POLISH_WARNINGS: Array<[CatalogRuleId, string, string]> = [
  ["polishDates", "Urodził się 31 kwietnia.", "31 kwietnia"],
  ["polishDates", "Termin to 30 II 2025.", "30 II 2025"],
  ["polishDates", "Rok 2023 miał dzień 29 lutego 2023.", "29 lutego 2023"],
  ["polishDates", "Było to w piątek, 1 października 2026.", "piątek, 1 października 2026"],
  ["polishDates", "Obóz trwa 20–3 lipca.", "20–3 lipca"],
  ["polishDates", "Wojna trwała w latach 1918–1914.", "1918–1914"],
  ["polishDates", "Faktura z dnia 31.06.2024 jest błędna.", "31.06.2024"],
  ["polishDates", "Zebranie zwołano na 12.15.2025.", "12.15.2025"],
  ["polishDates", "Było to w sobotę, 3.05.2023.", "sobotę, 3.05.2023"],
];

test("dotted dates that exist, and dotted numbers that are not dates, stay clean", () => {
  for (const text of [
    "Spotkanie jest w środę, 3.05.2023.",
    "Urodził się 29.02.2024 w Krakowie.",
    "Serwer ma adres 10.12.2023.4 w sieci.",
    "Wydano wersję 2.10.2024.",
  ])
    expect(findings("polishDates", text)).toEqual([]);
});

test.each(POLISH_WARNINGS)("%s warns on %p", (ruleId, text, original) => {
  const found = findings(ruleId, text);
  expect(found.map((d) => [d.original, d.warningOnly])).toEqual([[original, true]]);
});

describe.each(POLISH_CASES)("%s: %s", (ruleId, _name, { pos, neg }) => {
  test.each(pos)("flags %p", (text, fixed) => {
    const [d, ...rest] = findings(ruleId, text);
    expect(rest).toEqual([]);
    expect(d).toBeDefined();
    expect(applyEdits(text, d.alternatives[0].edits)).toBe(fixed);
    expect(findings(ruleId, fixed)).toEqual([]);
  });
  test.each(neg)("leaves %p", (text) => {
    expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
  });
  test("runs only for Polish", () => {
    for (const [text] of pos) expect(findings(ruleId, text, "en_US")).toEqual([]);
  });
});

// Polish frames with clause lookbehinds must not reread long runs at every position.
const POLISH_TRIGGERS =
  "na prawdę za razem za pewne po woli z resztą co raz dla tego dla czego w prawdzie " +
  "tam ten widzi mi się zrobił by zrobili śmy za zwyczaj co miesięcznie wciągu bezsensu ";

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "pl_PL",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("no Polish chunk stalls on long runs or repeated trigger words", () => {
  slowestChunkMs(POLISH_TRIGGERS.repeat(40));
  const inputs = [
    "\t ".repeat(6_000),
    `x${" ".repeat(3_800)}${POLISH_TRIGGERS}`.repeat(3),
    POLISH_TRIGGERS.repeat(60),
    "ała ".repeat(3_000),
    "słowo ".repeat(700),
    // Clause starts after a line break look back over a bounded run of spaces only.
    `\n${" \t".repeat(1_950)}Mi się boje chodź to`.repeat(2),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});

test("the clause-start lookbehind is bounded (V8 rereads an unbounded one at every position)", () => {
  expect(CLAUSE_START).not.toMatch(/[*+]/);
});

test('",," before a quoted word is the Polish opening quote', () => {
  const fix = (text: string) =>
    findings("duplicatePunctuationCollapse", text).map((d) =>
      applyEdits(text, d.alternatives[0].edits),
    );
  expect(fix('Nazwał to ,,lekką porażką" i wyszedł.')).toEqual([
    'Nazwał to „lekką porażką" i wyszedł.',
  ]);
  expect(fix("Film ,,Rejs” znam na pamięć.")).toEqual(["Film „Rejs” znam na pamięć."]);
  expect(fix("Mówił o ,,przygodzie’’ cały wieczór.")).toEqual([
    "Mówił o „przygodzie’’ cały wieczór.",
  ]);
  expect(fix("Kupiłem chleb,, mleko i masło.")).toEqual(["Kupiłem chleb, mleko i masło."]);
  expect(fix("Pisał ,,coś bez końca i tyle.")).toEqual(["Pisał ,coś bez końca i tyle."]);
});

test("a Polish style row skips a capitalized name inside the sentence", () => {
  expect(findings("stylePhrasing", "Mieszkamy przy Wysokiej Frekwencji od lat.")).toEqual([]);
  expect(findings("stylePhrasing", "Wczoraj była Wysoka frekwencja w klubie.")).toEqual([]);
  expect(findings("stylePhrasing", "Wysoka frekwencja cieszy organizatorów.")).toHaveLength(1);
  expect(findings("stylePhrasing", "Cieszy nas wysoka frekwencja.")).toHaveLength(1);
});

test('Polish "ok." before a numeral and "im." before a title start no sentence', () => {
  const starts = (text: string) => findings("capitalizeSentenceStart", text).map((d) => d.original);
  expect(starts("Czekałem ok. trzech godzin na autobus.")).toEqual([]);
  expect(starts("Przyszło ok. dwudziestu osób.")).toEqual([]);
  expect(starts("Pracuje w szpitalu im. dr. Wandy Błeńskiej.")).toEqual([]);
  expect(starts("Wszystko jest ok. potem pogadamy.")).toEqual(["p"]);
  expect(starts("Oddałem im. potem wyszedłem.")).toEqual(["p"]);
});
