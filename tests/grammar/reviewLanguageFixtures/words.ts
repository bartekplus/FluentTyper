import type { RuleFixtures } from "./types";

const term = (language: string, source: string, replacement: string) => ({
  id: `term-${language}`,
  source,
  replacement,
  casePolicy: "insensitive" as const,
  explanation: "House style.",
  language,
  scope: "all-prose" as const,
  enabled: true,
});

/** One preferred term per language; each only applies to its own language. */
export const TERMINOLOGY_ENTRIES = [
  term("en_US", "whitelist", "allowlist"),
  term("fr_FR", "mail", "courriel"),
  term("de_DE", "Handy", "Mobiltelefon"),
  term("pl_PL", "mejl", "e-mail"),
  term("es_ES", "email", "correo"),
  term("pt_BR", "deletar", "excluir"),
  term("sv_SE", "mejl", "e-post"),
  term("hr_HR", "mail", "e-pošta"),
  term("el_GR", "σάιτ", "ιστότοπος"),
  term("ar_SA", "إيميل", "بريد"),
];

export const terminology: RuleFixtures = {
  en_US: {
    pos: [
      ["Add it to the whitelist.", "Add it to the allowlist."],
      ["The whitelist is long.", "The allowlist is long."],
      ["Check the whitelist today.", "Check the allowlist today."],
      ["Our whitelist grew.", "Our allowlist grew."],
      ["Update whitelist rules.", "Update allowlist rules."],
    ],
    neg: [
      "The whitelisted hosts are fine.",
      "Open #whitelist now.",
      "Run `whitelist` in the shell.",
      "Add it to the allowlist.",
      "Nothing to change here.",
    ],
  },
  fr_FR: {
    pos: [
      ["Envoie-moi un mail.", "Envoie-moi un courriel."],
      ["Le mail est arrivé.", "Le courriel est arrivé."],
      ["Lis ce mail demain.", "Lis ce courriel demain."],
      ["Un mail de Paul.", "Un courriel de Paul."],
      ["Réponds au mail vite.", "Réponds au courriel vite."],
    ],
    neg: [
      "Ouvre la mailbox.",
      "Écris à #mail maintenant.",
      "Lance `mail` dans le terminal.",
      "Envoie-moi un courriel.",
      "Rien à changer ici.",
    ],
  },
  de_DE: {
    pos: [
      ["Mein Handy ist leer.", "Mein Mobiltelefon ist leer."],
      ["Das Handy klingelt.", "Das Mobiltelefon klingelt."],
      ["Leg das Handy weg.", "Leg das Mobiltelefon weg."],
      ["Ein neues Handy.", "Ein neues Mobiltelefon."],
      ["Ruf mich am Handy an.", "Ruf mich am Mobiltelefon an."],
    ],
    neg: [
      "Die Handyhülle ist rot.",
      "Folge #Handy jetzt.",
      "Starte `Handy` im Terminal.",
      "Mein Mobiltelefon ist leer.",
      "Hier gibt es nichts zu ändern.",
    ],
  },
  pl_PL: {
    pos: [
      ["Wyślij mi mejl.", "Wyślij mi e-mail."],
      ["Ten mejl doszedł.", "Ten e-mail doszedł."],
      ["Przeczytaj mejl jutro.", "Przeczytaj e-mail jutro."],
      ["Mejl od Pawła.", "E-mail od Pawła."],
      ["Odpisz na mejl szybko.", "Odpisz na e-mail szybko."],
    ],
    neg: [
      "Mejlowanie jest proste.",
      "Napisz na #mejl teraz.",
      "Uruchom `mejl` w terminalu.",
      "Wyślij mi e-mail.",
      "Nic tu nie trzeba zmieniać.",
    ],
  },
  es_ES: {
    pos: [
      ["Envíame un email.", "Envíame un correo."],
      ["El email llegó.", "El correo llegó."],
      ["Lee ese email mañana.", "Lee ese correo mañana."],
      ["Un email de Pablo.", "Un correo de Pablo."],
      ["Responde al email pronto.", "Responde al correo pronto."],
    ],
    neg: [
      "Los emails antiguos se borran.",
      "Escribe a #email ahora.",
      "Ejecuta `email` en la terminal.",
      "Envíame un correo.",
      "Nada que cambiar aquí.",
    ],
  },
  pt_BR: {
    pos: [
      ["Vou deletar o arquivo.", "Vou excluir o arquivo."],
      ["Não deletar nada.", "Não excluir nada."],
      ["Deletar é fácil.", "Excluir é fácil."],
      ["Pode deletar agora.", "Pode excluir agora."],
      ["Quer deletar isso?", "Quer excluir isso?"],
    ],
    neg: [
      "Ele deletou o arquivo.",
      "Siga #deletar agora.",
      "Rode `deletar` no terminal.",
      "Vou excluir o arquivo.",
      "Nada a mudar aqui.",
    ],
  },
  sv_SE: {
    pos: [
      ["Skicka ett mejl.", "Skicka ett e-post."],
      ["Mitt mejl kom fram.", "Mitt e-post kom fram."],
      ["Läs mejl i morgon.", "Läs e-post i morgon."],
      ["Ett mejl från Per.", "Ett e-post från Per."],
      ["Svara på mejl snabbt.", "Svara på e-post snabbt."],
    ],
    neg: [
      "Mejlet kom fram.",
      "Skriv till #mejl nu.",
      "Kör `mejl` i terminalen.",
      "Skicka e-post.",
      "Inget att ändra här.",
    ],
  },
  hr_HR: {
    pos: [
      ["Pošalji mi mail.", "Pošalji mi e-pošta."],
      ["Taj mail je stigao.", "Taj e-pošta je stigao."],
      ["Pročitaj mail sutra.", "Pročitaj e-pošta sutra."],
      ["Mail od Ivana.", "E-pošta od Ivana."],
      ["Odgovori na mail brzo.", "Odgovori na e-pošta brzo."],
    ],
    neg: [
      "Mailovi su stigli.",
      "Piši na #mail sada.",
      "Pokreni `mail` u terminalu.",
      "Pošalji mi e-poštu.",
      "Ovdje nema ništa za promijeniti.",
    ],
  },
  el_GR: {
    pos: [
      ["Άνοιξε το σάιτ.", "Άνοιξε το ιστότοπος."],
      ["Το σάιτ είναι αργό.", "Το ιστότοπος είναι αργό."],
      ["Δες το σάιτ αύριο.", "Δες το ιστότοπος αύριο."],
      ["Ένα νέο σάιτ.", "Ένα νέο ιστότοπος."],
      ["Φτιάξε σάιτ γρήγορα.", "Φτιάξε ιστότοπος γρήγορα."],
    ],
    neg: [
      "Τα σάιτς είναι αργά.",
      "Γράψε στο #σάιτ τώρα.",
      "Τρέξε `σάιτ` στο τερματικό.",
      "Άνοιξε τον ιστότοπο.",
      "Τίποτα να αλλάξει εδώ.",
    ],
  },
  ar_SA: {
    pos: [
      ["أرسل لي إيميل اليوم.", "أرسل لي بريد اليوم."],
      ["وصل إيميل جديد.", "وصل بريد جديد."],
      ["اقرأ إيميل غدا.", "اقرأ بريد غدا."],
      ["إيميل من أحمد.", "بريد من أحمد."],
      ["رد على إيميل بسرعة.", "رد على بريد بسرعة."],
    ],
    neg: [
      "وصل الإيميل أمس.",
      "اكتب إلى #إيميل الآن.",
      "شغل `إيميل` في الطرفية.",
      "أرسل لي بريد اليوم.",
      "لا شيء للتغيير هنا.",
    ],
  },
};

const drop = (text: string, word: string) => text.replace(`${word} ${word}`, word);
const pairs = (word: string, texts: string[]): Array<[string, string]> =>
  texts.map((text) => [text, drop(text, word)]);

export const repeatedWords: RuleFixtures = {
  en_US: {
    pos: [
      ...pairs("the", ["I opened the the report."]),
      ...pairs("in", ["Save it in in the folder."]),
      ...pairs("with", ["Come with with me."]),
      ...pairs("of", ["A cup of of tea."]),
      ...pairs("is", ["This is is new."]),
    ],
    neg: [
      "I had had enough.",
      "I know that that works.",
      'Do not write "the the".',
      "The, the report.",
      "the\nthe report",
    ],
  },
  fr_FR: {
    pos: [
      ...pairs("dans", ["Il est dans dans la maison."]),
      ...pairs("pour", ["C'est pour pour toi."]),
      ...pairs("avec", ["Viens avec avec moi."]),
      ...pairs("sur", ["Pose-le sur sur la table."]),
      ...pairs("les", ["Je vois les les enfants."]),
      ...pairs("je", ["Hier, je je suis parti tôt."]),
      ...pairs("à", ["Il pense à à son frère."]),
    ],
    neg: [
      "Nous nous levons tôt.",
      "Vous vous trompez.",
      "Le mot « dans dans » est faux.",
      "Dans, dans la maison.",
      "Tra la la, chante-t-il.",
    ],
  },
  de_DE: {
    pos: [
      ...pairs("einem", ["Ich wohne in einem einem Haus."]),
      ...pairs("mit", ["Komm mit mit uns."]),
      ...pairs("von", ["Ein Brief von von Anna."]),
      ...pairs("für", ["Das ist für für dich."]),
      ...pairs("auf", ["Leg es auf auf den Tisch."]),
    ],
    neg: [
      "Die Frau die die Blumen kauft.",
      "Ich weiß, dass das das Beste ist.",
      "Das Wort „ein ein“ ist falsch.",
      "Mit, mit Freude.",
      "Er kam, kam und ging.",
    ],
  },
  pl_PL: {
    pos: [
      ...pairs("się", ["Cieszę się się bardzo."]),
      ...pairs("na", ["Leży na na stole."]),
      ...pairs("do", ["Idę do do domu."]),
      ...pairs("od", ["List od od Anny."]),
      ...pairs("że", ["Wiem, że że przyjdzie."]),
    ],
    neg: [
      "To to jest problem.",
      "Słowo „na na” jest błędne.",
      "Na, na pewno.",
      "Na\nna stole.",
      "Nie nie wiem.",
    ],
  },
  es_ES: {
    pos: [
      ...pairs("en", ["Vivo en en Madrid."]),
      ...pairs("con", ["Ven con con nosotros."]),
      ...pairs("los", ["Veo los los niños."]),
      ...pairs("una", ["Es una una casa."]),
      ...pairs("del", ["Sale del del coche."]),
    ],
    neg: [
      "Ella para para descansar.",
      "La la la, canta.",
      "La palabra «en en» es incorrecta.",
      "En, en serio.",
      "Que que no.",
    ],
  },
  pt_BR: {
    pos: [
      ...pairs("em", ["Moro em em São Paulo."]),
      ...pairs("com", ["Vem com com a gente."]),
      ...pairs("os", ["Vejo os os meninos."]),
      ...pairs("uma", ["É uma uma casa."]),
      ...pairs("do", ["Sai do do carro."]),
    ],
    neg: [
      "Ele para para pensar.",
      "A palavra “em em” está errada.",
      "Em, em casa.",
      "Nos nos vemos amanhã.",
      "Tchau tchau.",
    ],
  },
  sv_SE: {
    pos: [
      ...pairs("att", ["Jag vill att att du kommer."]),
      ...pairs("ett", ["Det är ett ett hus."]),
      ...pairs("på", ["Den ligger på på bordet."]),
      ...pairs("till", ["Vi går till till skolan."]),
      ...pairs("med", ["Kom med med oss."]),
    ],
    neg: [
      "Han för för många båtar.",
      "Ordet ”att att” är fel.",
      "Att, att du kom.",
      "Om om det regnar vet jag inte.",
      "Som som vanligt.",
    ],
  },
  hr_HR: {
    pos: [
      ...pairs("na", ["Idem na na posao."]),
      ...pairs("za", ["To je za za tebe."]),
      ...pairs("od", ["Pismo od od Ane."]),
      ...pairs("iz", ["Dolazim iz iz Zagreba."]),
      ...pairs("do", ["Idem do do grada."]),
    ],
    neg: [
      "Pitao je je jučer.",
      "Riječ „na na” je pogrešna.",
      "Da da, naravno.",
      "Na, na stolu.",
      "Se se ne sjeća.",
    ],
  },
  el_GR: {
    pos: [
      ...pairs("στο", ["Πάω στο στο σπίτι."]),
      ...pairs("από", ["Έρχομαι από από την Αθήνα."]),
      ...pairs("για", ["Είναι για για σένα."]),
      ...pairs("ένα", ["Είναι ένα ένα σπίτι."]),
      ...pairs("στην", ["Πάω στην στην αγορά."]),
    ],
    neg: [
      "Άσε με με την ησυχία μου.",
      "Το το είδα χθες.",
      "Η λέξη «στο στο» είναι λάθος.",
      "Στο, στο σπίτι.",
      "Και και οι δύο ήρθαν.",
    ],
  },
  ar_SA: {
    pos: [
      ...pairs("في", ["هو في في البيت."]),
      ...pairs("على", ["الكتاب على على الطاولة."]),
      ...pairs("إلى", ["ذهبت إلى إلى المدرسة."]),
      ...pairs("عن", ["تحدث عن عن العمل."]),
      ...pairs("في", ["نلتقي في في المساء."]),
    ],
    neg: ["هو وفي في البيت.", "كلمة «في في» خطأ.", "في، في البيت.", "في\nفي البيت.", "من من أنت؟"],
  },
};

const brandNeg = (lang: string): string[] => {
  const words: Record<string, [string, string, string]> = {
    en_US: ["I use", "Visit", "The word"],
    fr_FR: ["J'utilise", "Visitez", "Le mot"],
    de_DE: ["Ich nutze", "Besuche", "Das Wort"],
    pl_PL: ["Używam", "Odwiedź", "Słowo"],
    es_ES: ["Uso", "Visita", "La palabra"],
    pt_BR: ["Eu uso", "Visite", "A palavra"],
    sv_SE: ["Jag använder", "Besök", "Ordet"],
    hr_HR: ["Koristim", "Posjeti", "Riječ"],
    el_GR: ["Χρησιμοποιώ", "Επισκέψου", "Η λέξη"],
    ar_SA: ["أستخدم", "زر", "كلمة"],
  };
  const [use, visit, word] = words[lang];
  return [
    `${use} GitHub.`,
    `${use} GITHUB.`,
    `${visit} github.com.`,
    `${use} @github.`,
    `${word} "github".`,
  ];
};

export const canonicalCasing: RuleFixtures = {
  en_US: {
    pos: [
      ["I use github daily.", "I use GitHub daily."],
      ["It runs javascript.", "It runs JavaScript."],
      ["We write typescript.", "We write TypeScript."],
      ["My iphone died.", "My iPhone died."],
      ["It needs macos.", "It needs macOS."],
    ],
    neg: brandNeg("en_US"),
  },
  fr_FR: {
    pos: [
      ["J'utilise github.", "J'utilise GitHub."],
      ["Il tourne en javascript.", "Il tourne en JavaScript."],
      ["Nous écrivons du typescript.", "Nous écrivons du TypeScript."],
      ["Mon iphone est mort.", "Mon iPhone est mort."],
      ["Il faut macos.", "Il faut macOS."],
    ],
    neg: brandNeg("fr_FR"),
  },
  de_DE: {
    pos: [
      ["Ich nutze github.", "Ich nutze GitHub."],
      ["Es läuft mit javascript.", "Es läuft mit JavaScript."],
      ["Wir schreiben typescript.", "Wir schreiben TypeScript."],
      ["Mein iphone ist leer.", "Mein iPhone ist leer."],
      ["Es braucht macos.", "Es braucht macOS."],
    ],
    neg: brandNeg("de_DE"),
  },
  pl_PL: {
    pos: [
      ["Używam github.", "Używam GitHub."],
      ["Działa w javascript.", "Działa w JavaScript."],
      ["Piszemy w typescript.", "Piszemy w TypeScript."],
      ["Mój iphone padł.", "Mój iPhone padł."],
      ["Wymaga macos.", "Wymaga macOS."],
    ],
    neg: brandNeg("pl_PL"),
  },
  es_ES: {
    pos: [
      ["Uso github a diario.", "Uso GitHub a diario."],
      ["Funciona con javascript.", "Funciona con JavaScript."],
      ["Escribimos typescript.", "Escribimos TypeScript."],
      ["Mi iphone murió.", "Mi iPhone murió."],
      ["Necesita macos.", "Necesita macOS."],
    ],
    neg: brandNeg("es_ES"),
  },
  pt_BR: {
    pos: [
      ["Uso github todo dia.", "Uso GitHub todo dia."],
      ["Roda em javascript.", "Roda em JavaScript."],
      ["Escrevemos typescript.", "Escrevemos TypeScript."],
      ["Meu iphone morreu.", "Meu iPhone morreu."],
      ["Precisa de macos.", "Precisa de macOS."],
    ],
    neg: brandNeg("pt_BR"),
  },
  sv_SE: {
    pos: [
      ["Jag använder github.", "Jag använder GitHub."],
      ["Det körs i javascript.", "Det körs i JavaScript."],
      ["Vi skriver typescript.", "Vi skriver TypeScript."],
      ["Min iphone dog.", "Min iPhone dog."],
      ["Det kräver macos.", "Det kräver macOS."],
    ],
    neg: brandNeg("sv_SE"),
  },
  hr_HR: {
    pos: [
      ["Koristim github.", "Koristim GitHub."],
      ["Radi u javascript.", "Radi u JavaScript."],
      ["Pišemo typescript.", "Pišemo TypeScript."],
      ["Moj iphone je prazan.", "Moj iPhone je prazan."],
      ["Treba macos.", "Treba macOS."],
    ],
    neg: brandNeg("hr_HR"),
  },
  el_GR: {
    pos: [
      ["Χρησιμοποιώ github.", "Χρησιμοποιώ GitHub."],
      ["Τρέχει σε javascript.", "Τρέχει σε JavaScript."],
      ["Γράφουμε typescript.", "Γράφουμε TypeScript."],
      ["Το iphone μου χάλασε.", "Το iPhone μου χάλασε."],
      ["Χρειάζεται macos.", "Χρειάζεται macOS."],
    ],
    neg: brandNeg("el_GR"),
  },
  ar_SA: {
    pos: [
      ["أستخدم github يوميا.", "أستخدم GitHub يوميا."],
      ["يعمل بلغة javascript.", "يعمل بلغة JavaScript."],
      ["نكتب typescript.", "نكتب TypeScript."],
      ["هاتفي iphone تعطل.", "هاتفي iPhone تعطل."],
      ["يحتاج macos.", "يحتاج macOS."],
    ],
    neg: brandNeg("ar_SA"),
  },
};

const warn = (texts: string[]): Array<[string, null]> => texts.map((text) => [text, null]);

export const unclosedQuotation: RuleFixtures = {
  en_US: {
    pos: warn([
      'He said "hello and left.',
      "She wrote “yes and went.",
      "Call it ‘draft and move on.",
      "The «title is here.",
      'First "one" and then "two.',
    ]),
    neg: [
      'He said "hello" and left.',
      "Don't stop.",
      "The ‘inner’ word.",
      "He is 5'10\" tall.",
      "She wrote “yes” and went.",
    ],
  },
  fr_FR: {
    pos: warn([
      "Il a dit « bonjour et il est parti.",
      'Il a dit "bonjour et il est parti.',
      "Elle a écrit “oui et elle est partie.",
      "Il a dit ‹ oui et il est parti.",
      "D'abord « un », puis « deux.",
    ]),
    neg: [
      "Il a dit « bonjour » et il est parti.",
      "L'homme est là.",
      "Aujourd’hui il pleut.",
      'Il a dit "bonjour" et il est parti.',
      "Elle a écrit “oui” et elle est partie.",
    ],
  },
  de_DE: {
    pos: warn([
      "Er sagte „Hallo und ging.",
      "Sie rief »Halt und lief.",
      "Er schrieb ‚ja und ging.",
      'Er sagte "Hallo und ging.',
      "Erst „eins“, dann „zwei.",
    ]),
    neg: [
      "Er sagte „Hallo“ und ging.",
      "Sie rief »Halt« und lief.",
      "Er schrieb ‚ja‘ und ging.",
      "Peter’s Haus.",
      "Er ist 5'10\" groß.",
    ],
  },
  pl_PL: {
    pos: warn([
      "Powiedział „dobrze i wyszedł.",
      "Powiedział «dobrze i wyszedł.",
      'Powiedział "dobrze i wyszedł.',
      "Najpierw „jeden”, potem „dwa.",
      "Napisała „tak i poszła.",
    ]),
    neg: [
      "Powiedział „dobrze” i wyszedł.",
      "Powiedział «dobrze» i wyszedł.",
      'Powiedział "dobrze" i wyszedł.',
      "Książka „Lalka” jest dobra.",
      "Ma 5'10\" wzrostu.",
    ],
  },
  es_ES: {
    pos: warn([
      "Dijo «hola y se fue.",
      'Dijo "hola y se fue.',
      "Escribió “sí y se fue.",
      "Primero «uno», luego «dos.",
      "Dijo ‘hola y se fue.",
    ]),
    neg: [
      "Dijo «hola» y se fue.",
      'Dijo "hola" y se fue.',
      "Escribió “sí” y se fue.",
      "Dijo «ella dijo “no” ayer» y salió.",
      "Mide 5'10\" de alto.",
    ],
  },
  pt_BR: {
    pos: warn([
      "Disse “olá e saiu.",
      'Disse "olá e saiu.',
      "Disse «olá e saiu.",
      "Primeiro “um”, depois “dois.",
      "Disse ‘olá e saiu.",
    ]),
    neg: [
      "Disse “olá” e saiu.",
      'Disse "olá" e saiu.',
      "Disse «olá» e saiu.",
      "Disse “ela disse ‘não’ ontem” e saiu.",
      "Mede 5'10\" de altura.",
    ],
  },
  sv_SE: {
    pos: warn([
      "Han sa ”hej och gick.",
      "Han sa »hej och gick.",
      'Han sa "hej och gick.',
      "Först ”ett”, sedan ”två.",
      "Hon skrev ”ja och gick.",
    ]),
    neg: [
      "Han sa ”hej” och gick.",
      "Han sa »hej» och gick.",
      'Han sa "hej" och gick.',
      "Boken ”Röda rummet” är bra.",
      "Han är 5'10\" lång.",
    ],
  },
  hr_HR: {
    pos: warn([
      "Rekao je „bok i otišao.",
      "Rekao je »bok i otišao.",
      'Rekao je "bok i otišao.',
      "Prvo „jedan”, zatim „dva.",
      "Napisala je „da i otišla.",
    ]),
    neg: [
      "Rekao je „bok” i otišao.",
      "Rekao je »bok« i otišao.",
      'Rekao je "bok" i otišao.',
      "Knjiga „Zločin i kazna” je dobra.",
      "On je visok 5'10\".",
    ],
  },
  el_GR: {
    pos: warn([
      "Είπε «γεια και έφυγε.",
      'Είπε "γεια και έφυγε.',
      "Έγραψε “ναι και έφυγε.",
      "Πρώτα «ένα», μετά «δύο.",
      "Είπε ‘γεια και έφυγε.",
    ]),
    neg: [
      "Είπε «γεια» και έφυγε.",
      'Είπε "γεια" και έφυγε.',
      "Έγραψε “ναι” και έφυγε.",
      "Είπε «εκείνος είπε “όχι” χθες» και έφυγε.",
      "Είναι 5'10\" ψηλός.",
    ],
  },
  ar_SA: {
    pos: warn([
      "قال «مرحبا وذهب.",
      'قال "مرحبا وذهب.',
      "كتب “نعم وذهب.",
      "أولا «واحد»، ثم «اثنان.",
      "قال ‘مرحبا وذهب.",
    ]),
    neg: [
      "قال «مرحبا» وذهب.",
      'قال "مرحبا" وذهب.',
      "كتب “نعم” وذهب.",
      "قال «هو قال “لا” أمس» وذهب.",
      "الطول 5'10\" تقريبا.",
    ],
  },
};

export const longSentence: RuleFixtures = {
  en_US: {
    pos: warn([
      "The team reviewed every open issue in the tracker before the release meeting on Friday.",
      "We tested the new build on three phones and two tablets without finding any crash.",
      "Please send the final report to the whole team before you leave the office tonight.",
      "After lunch we walked along the river and talked about the plans for next summer.",
      "The old library downtown will close for renovation from March until the end of the year.",
    ]),
    neg: [
      "Short sentence here.",
      "One. Two. Three short ones.",
      "- a list item that goes on and on with many words in it for sure.",
      "A fragment without a final mark that keeps going on and on and on forever",
      "It is fine. It is short.",
    ],
  },
  fr_FR: {
    pos: warn([
      "L'équipe a relu chaque ticket ouvert dans l'outil avant la réunion de vendredi prochain.",
      "Nous avons testé la nouvelle version sur trois téléphones et deux tablettes sans aucun problème.",
      "Merci d'envoyer le rapport final à toute l'équipe avant de quitter le bureau ce soir.",
      "Après le déjeuner nous avons marché le long de la rivière en parlant de nos projets.",
      "La vieille bibliothèque du centre fermera pour travaux de mars jusqu'à la fin de l'année.",
    ]),
    neg: [
      "Phrase courte ici.",
      "Un. Deux. Trois courtes.",
      "- un élément de liste qui continue encore et encore avec beaucoup de mots dedans.",
      "Un fragment sans point final qui continue encore et encore et encore sans jamais finir",
      "Voir chap. deux. C'est court.",
    ],
  },
  de_DE: {
    pos: warn([
      "Das Team hat vor dem Treffen am Freitag jedes offene Ticket im System noch einmal geprüft.",
      "Wir haben die neue Version auf drei Handys und zwei Tablets ohne einen einzigen Absturz getestet.",
      "Bitte schick den fertigen Bericht vor Feierabend heute Abend noch an das ganze Team im Büro.",
      "Nach dem Mittagessen sind wir am Fluss entlang gelaufen und haben über den nächsten Sommer gesprochen.",
      "Die alte Bibliothek in der Innenstadt schließt z. B. wegen Umbau von März bis zum Jahresende.",
    ]),
    neg: [
      "Kurzer Satz hier.",
      "Eins. Zwei. Drei kurze.",
      "- ein Listenpunkt der immer weiter und weiter geht mit sehr vielen Wörtern darin.",
      "Ein Fragment ohne Schlusspunkt das immer weiter und weiter geht und niemals endet hier",
      "Siehe z. B. Kapitel zwei. Das ist kurz.",
    ],
  },
  pl_PL: {
    pos: warn([
      "Zespół przejrzał każde otwarte zgłoszenie w systemie przed piątkowym spotkaniem całego działu firmy.",
      "Przetestowaliśmy nową wersję na trzech telefonach i dwóch tabletach bez żadnej awarii ani błędu.",
      "Proszę wysłać końcowy raport do całego zespołu przed wyjściem z biura dzisiaj wieczorem koniecznie.",
      "Po obiedzie spacerowaliśmy wzdłuż rzeki i rozmawialiśmy o planach na następne lato z przyjaciółmi.",
      "Stara biblioteka w centrum będzie zamknięta np. z powodu remontu od marca do końca roku.",
    ]),
    neg: [
      "Krótkie zdanie tutaj.",
      "Raz. Dwa. Trzy krótkie.",
      "- punkt listy który ciągnie się dalej i dalej z bardzo wieloma słowami w środku.",
      "Fragment bez kropki na końcu który ciągnie się dalej i dalej i nigdy się nie kończy",
      "To np. test. Jest krótki.",
    ],
  },
  es_ES: {
    pos: warn([
      "El equipo revisó cada incidencia abierta en el sistema antes de la reunión del viernes por la mañana.",
      "Probamos la nueva versión en tres teléfonos y dos tabletas sin encontrar ningún fallo grave.",
      "Por favor envía el informe final a todo el equipo antes de salir de la oficina esta noche.",
      "Después de comer caminamos junto al río y hablamos de los planes para el próximo verano.",
      "La vieja biblioteca del centro cerrará por obras desde marzo hasta el final del año que viene.",
    ]),
    neg: [
      "Frase corta aquí.",
      "Uno. Dos. Tres cortas.",
      "- un elemento de lista que sigue y sigue con muchísimas palabras dentro de él.",
      "Un fragmento sin punto final que sigue y sigue y sigue y nunca termina aquí",
      "¿Vienes? Sí, voy.",
    ],
  },
  pt_BR: {
    pos: warn([
      "A equipe revisou cada chamado aberto no sistema antes da reunião de sexta-feira pela manhã.",
      "Testamos a nova versão em três celulares e dois tablets sem encontrar nenhuma falha grave.",
      "Por favor envie o relatório final para toda a equipe antes de sair do escritório hoje à noite.",
      "Depois do almoço caminhamos ao longo do rio e conversamos sobre os planos para o próximo verão.",
      "A velha biblioteca do centro vai fechar para reforma de março até o final do ano que vem.",
    ]),
    neg: [
      "Frase curta aqui.",
      "Um. Dois. Três curtas.",
      "- um item de lista que continua e continua com muitíssimas palavras dentro dele.",
      "Um fragmento sem ponto final que continua e continua e continua e nunca termina aqui",
      "Sério? Sim, vou.",
    ],
  },
  sv_SE: {
    pos: warn([
      "Teamet gick igenom varje öppet ärende i systemet före mötet på fredag förmiddag med chefen.",
      "Vi testade den nya versionen på tre telefoner och två surfplattor utan att hitta något fel.",
      "Skicka gärna den slutliga rapporten till hela teamet innan du lämnar kontoret i kväll tack.",
      "Efter lunch promenerade vi längs floden och pratade om planerna för nästa sommar tillsammans med vänner.",
      "Det gamla biblioteket i centrum stänger för renovering från mars till slutet av nästa år.",
    ]),
    neg: [
      "Kort mening här.",
      "Ett. Två. Tre korta.",
      "- en listpunkt som fortsätter och fortsätter med väldigt många ord i sig hela tiden.",
      "Ett fragment utan slutpunkt som fortsätter och fortsätter och fortsätter och aldrig tar slut",
      "Verkligen? Ja, visst.",
    ],
  },
  hr_HR: {
    pos: warn([
      "Tim je pregledao svaki otvoreni zahtjev u sustavu prije sastanka u petak ujutro s voditeljem.",
      "Testirali smo novu verziju na tri telefona i dva tableta bez ijedne greške ili rušenja.",
      "Molim te pošalji konačni izvještaj cijelom timu prije nego što večeras napustiš ured zauvijek.",
      "Nakon ručka šetali smo uz rijeku i razgovarali o planovima za sljedeće ljeto s prijateljima.",
      "Stara knjižnica u centru bit će zatvorena npr. zbog obnove od ožujka do kraja godine.",
    ]),
    neg: [
      "Kratka rečenica ovdje.",
      "Jedan. Dva. Tri kratke.",
      "- stavka popisa koja se nastavlja dalje i dalje s jako puno riječi unutra zauvijek.",
      "Fragment bez točke na kraju koji se nastavlja dalje i dalje i nikad ne završava ovdje",
      "Stvarno? Da, naravno.",
    ],
  },
  el_GR: {
    pos: warn([
      "Η ομάδα εξέτασε κάθε ανοιχτό ζήτημα στο σύστημα πριν από τη συνάντηση της Παρασκευής το πρωί.",
      "Δοκιμάσαμε τη νέα έκδοση σε τρία κινητά και δύο τάμπλετ χωρίς να βρούμε κανένα σφάλμα.",
      "Παρακαλώ στείλε την τελική αναφορά σε όλη την ομάδα πριν φύγεις από το γραφείο απόψε.",
      "Μετά το μεσημεριανό περπατήσαμε δίπλα στο ποτάμι και μιλήσαμε για τα σχέδια του επόμενου καλοκαιριού.",
      "Η παλιά βιβλιοθήκη του κέντρου θα κλείσει για ανακαίνιση από τον Μάρτιο μέχρι το τέλος της χρονιάς.",
    ]),
    neg: [
      "Σύντομη πρόταση εδώ.",
      "Ένα. Δύο. Τρεις σύντομες.",
      "- ένα στοιχείο λίστας που συνεχίζει και συνεχίζει με πάρα πολλές λέξεις μέσα του πάντα.",
      "Ένα απόσπασμα χωρίς τελεία στο τέλος που συνεχίζει και συνεχίζει και ποτέ δεν τελειώνει εδώ",
      "Τι κάνεις; Καλά, ευχαριστώ.",
    ],
  },
  ar_SA: {
    pos: warn([
      "راجع الفريق كل طلب مفتوح في النظام قبل اجتماع يوم الجمعة صباحا مع المدير الجديد.",
      "اختبرنا الإصدار الجديد على ثلاثة هواتف وجهازين لوحيين دون أن نجد أي خطأ أو عطل.",
      "من فضلك أرسل التقرير النهائي إلى الفريق كله قبل أن تغادر المكتب هذا المساء بالتأكيد.",
      "بعد الغداء مشينا على طول النهر وتحدثنا عن خططنا للصيف القادم مع الأصدقاء والعائلة كلها.",
      "هل ستغلق المكتبة القديمة في وسط المدينة للتجديد من شهر مارس حتى نهاية العام القادم؟",
    ]),
    neg: [
      "جملة قصيرة هنا.",
      "واحد. اثنان. ثلاث قصيرة.",
      "- عنصر قائمة يستمر ويستمر مع كلمات كثيرة جدا بداخله طوال الوقت هنا.",
      "جزء بدون نقطة نهاية يستمر ويستمر ويستمر ولا ينتهي أبدا هنا في النص",
      "سؤال قصير؟ جواب قصير.",
    ],
  },
};
