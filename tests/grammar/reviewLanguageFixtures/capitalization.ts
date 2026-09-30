import type { RuleFixtures } from "./types";

export const sentenceStart: RuleFixtures = {
  en_US: {
    pos: [
      ["It rained. we stayed home.", "It rained. We stayed home."],
      ["Really? yes.", "Really? Yes."],
      ["Great! let us go.", "Great! Let us go."],
      ["good morning, all.", "Good morning, all."],
      ["It is done. next we test.", "It is done. Next we test."],
    ],
    neg: [
      "Call Mr. smith tomorrow.",
      "It costs approx. five dollars.",
      "Open config.json first.",
      "She yelled “stop!” and ran.",
      "Press . to repeat the command.",
    ],
  },
  fr_FR: {
    pos: [
      ["Il pleut. nous restons.", "Il pleut. Nous restons."],
      ["Quoi ? rien.", "Quoi ? Rien."],
      ["Super ! on y va.", "Super ! On y va."],
      ["bonjour à tous.", "Bonjour à tous."],
      ["C'est fini. après, on dîne.", "C'est fini. Après, on dîne."],
    ],
    neg: [
      "Voir chap. deux.",
      "Il arrive env. dix heures.",
      "Il a dit « oui ! » puis il est parti.",
      "Le fichier config.json est prêt.",
      "Voir aussi fig. trois et suiv. pages.",
    ],
  },
  de_DE: {
    pos: [
      ["Es regnet. wir bleiben.", "Es regnet. Wir bleiben."],
      ["Wirklich? ja.", "Wirklich? Ja."],
      ["Toll! das klappt.", "Toll! Das klappt."],
      ["heute ist Montag.", "Heute ist Montag."],
      ["Das ist z. B. gut. aber teuer.", "Das ist z. B. gut. Aber teuer."],
    ],
    neg: [
      "Er wurde am 3. mai geboren.",
      "Das sog. problem bleibt.",
      "Es kostet ca. zehn Euro.",
      "Die Datei main.ts ist da.",
      "Er rief „Halt!“ und lief.",
    ],
  },
  pl_PL: {
    pos: [
      ["Pada deszcz. zostajemy.", "Pada deszcz. Zostajemy."],
      ["Naprawdę? tak.", "Naprawdę? Tak."],
      ["Super! idziemy.", "Super! Idziemy."],
      ["dzień dobry.", "Dzień dobry."],
      ["To np. test. ale dobry.", "To np. test. Ale dobry."],
    ],
    neg: [
      "Mam 10 tys. złotych.",
      "To tzw. problem.",
      "Mieszkam przy ul. długiej.",
      "Plik app.js działa.",
      "Krzyknął „Stój!” i uciekł.",
    ],
  },
  es_ES: {
    pos: [
      ["Llueve. nos quedamos.", "Llueve. Nos quedamos."],
      ["¿Vienes? sí.", "¿Vienes? Sí."],
      ["¡Hola! ¿qué tal?", "¡Hola! ¿Qué tal?"],
      ["buenos días.", "Buenos días."],
      ["Es el Sr. García. después se fue.", "Es el Sr. García. Después se fue."],
    ],
    neg: [
      "Vive en la Avda. del Mar.",
      "Ver pág. diez.",
      "Son aprox. diez euros.",
      "El archivo index.html está listo.",
      "Gritó «¡Alto!» y se fue.",
    ],
  },
  pt_BR: {
    pos: [
      ["Chove. ficamos em casa.", "Chove. Ficamos em casa."],
      ["Sério? sim.", "Sério? Sim."],
      ["Oba! vamos.", "Oba! Vamos."],
      ["bom dia.", "Bom dia."],
      ["O Sr. Silva chegou. depois saiu.", "O Sr. Silva chegou. Depois saiu."],
    ],
    neg: [
      "Ele mora na Av. paulista.",
      "Veja pág. dez.",
      "Custa aprox. dez reais.",
      "O arquivo app.js funciona.",
      "Ela gritou “Pare!” e saiu.",
    ],
  },
  sv_SE: {
    pos: [
      ["Det regnar. vi stannar.", "Det regnar. Vi stannar."],
      ["Verkligen? ja.", "Verkligen? Ja."],
      ["Toppen! vi går.", "Toppen! Vi går."],
      ["god morgon.", "God morgon."],
      ["T.ex. detta. sen det.", "T.ex. detta. Sen det."],
    ],
    neg: [
      "Jag köpte 5 st. äpplen.",
      "Det kostar ca. tio kronor.",
      "Se bl.a. katter.",
      "Filen app.js fungerar.",
      "Han ropade ”Stopp!” och sprang.",
    ],
  },
  hr_HR: {
    pos: [
      ["Pada kiša. ostajemo.", "Pada kiša. Ostajemo."],
      ["Stvarno? da.", "Stvarno? Da."],
      ["Super! idemo.", "Super! Idemo."],
      ["dobar dan.", "Dobar dan."],
      ["Npr. ovo je test. ali dobar.", "Npr. ovo je test. Ali dobar."],
    ],
    neg: [
      "Tj. ne znam.",
      "Kupio sam npr. kruh.",
      "Rođen je 3. svibnja.",
      "Datoteka app.js radi.",
      "Viknuo je „Stani!” i pobjegao.",
    ],
  },
  el_GR: {
    pos: [
      ["Βρέχει. μένουμε.", "Βρέχει. Μένουμε."],
      ["Αλήθεια; ναι.", "Αλήθεια; Ναι."],
      ["Τέλεια! πάμε.", "Τέλεια! Πάμε."],
      ["καλημέρα σε όλους.", "Καλημέρα σε όλους."],
      ["Ήρθε. μετά έφυγε.", "Ήρθε. Μετά έφυγε."],
    ],
    neg: [
      "Δες σελ. δέκα.",
      "Βλ. παρακάτω.",
      "Φρούτα, λαχανικά κλπ. και ψωμί.",
      "Το αρχείο app.js λειτουργεί.",
      "Φώναξε «Στοπ!» και έφυγε.",
    ],
  },
  // Arabic script is uncased: only Latin runs inside Arabic text are capitalized.
  ar_SA: {
    pos: [
      ["مرحبا. hello there.", "مرحبا. Hello there."],
      ["كيف حالك؟ fine thanks.", "كيف حالك؟ Fine thanks."],
      ["شكرا! see you.", "شكرا! See you."],
      ["hello مرحبا.", "Hello مرحبا."],
      ["انتهى. then we left.", "انتهى. Then we left."],
    ],
    neg: [
      "مرحبا. كيف حالك؟",
      "السعر عشرة ريالات. شكرا",
      "قال: «نعم!» ثم ذهب.",
      "الملف app.js يعمل.",
      "هذا، ثم ذلك؛ وانتهى.",
    ],
  },
};

export const lineStart: RuleFixtures = {
  en_US: {
    pos: [
      ["Line one.\nnext line.", "Line one.\nNext line."],
      ["Why?\nbecause.", "Why?\nBecause."],
      ["Stop!\nwait.", "Stop!\nWait."],
      ["Intro\n\nfirst point.", "Intro\n\nFirst point."],
      ["Done.\n  later we test.", "Done.\n  Later we test."],
    ],
    neg: [
      "This line wraps\ninto the next one.",
      "Items are:\napples and pears.",
      "First,\nsecond.",
      "See e.g.\nthe docs.",
      "Talk to Mr.\nsmith today.",
    ],
  },
  fr_FR: {
    pos: [
      ["Fin.\nsuite ici.", "Fin.\nSuite ici."],
      ["Pourquoi ?\nparce que.", "Pourquoi ?\nParce que."],
      ["Stop !\nattends.", "Stop !\nAttends."],
      ["Titre\n\npremier point.", "Titre\n\nPremier point."],
      ["C'est fait.\nensuite on teste.", "C'est fait.\nEnsuite on teste."],
    ],
    neg: [
      "Cette ligne continue\nsur la suivante.",
      "Voici la liste :\npommes et poires.",
      "Premier,\ndeuxième.",
      "Voir chap.\ndeux.",
      "Il arrive env.\ndix heures.",
    ],
  },
  de_DE: {
    pos: [
      ["Ende.\nweiter geht es.", "Ende.\nWeiter geht es."],
      ["Warum?\nweil.", "Warum?\nWeil."],
      ["Halt!\nwarte.", "Halt!\nWarte."],
      ["Titel\n\nerster Punkt.", "Titel\n\nErster Punkt."],
      ["Fertig.\ndann testen wir.", "Fertig.\nDann testen wir."],
    ],
    neg: [
      "Diese Zeile geht\nweiter.",
      "Die Liste:\nÄpfel und Birnen.",
      "Erstens,\nzweitens.",
      "Siehe z. B.\nfolgendes.",
      "Am 3.\nmai.",
    ],
  },
  pl_PL: {
    pos: [
      ["Koniec.\ndalej tutaj.", "Koniec.\nDalej tutaj."],
      ["Dlaczego?\nbo tak.", "Dlaczego?\nBo tak."],
      ["Stop!\nczekaj.", "Stop!\nCzekaj."],
      ["Tytuł\n\npierwszy punkt.", "Tytuł\n\nPierwszy punkt."],
      ["Gotowe.\npotem testujemy.", "Gotowe.\nPotem testujemy."],
    ],
    neg: [
      "Ta linia trwa\ndalej.",
      "Lista:\njabłka i gruszki.",
      "Po pierwsze,\npo drugie.",
      "To np.\njabłko.",
      "Mam 10 tys.\nzłotych.",
    ],
  },
  es_ES: {
    pos: [
      ["Fin.\nsigue aquí.", "Fin.\nSigue aquí."],
      ["¿Por qué?\nporque sí.", "¿Por qué?\nPorque sí."],
      ["¡Alto!\nespera.", "¡Alto!\nEspera."],
      ["Título\n\nprimer punto.", "Título\n\nPrimer punto."],
      ["Hecho.\nluego probamos.", "Hecho.\nLuego probamos."],
    ],
    neg: [
      "Esta línea sigue\nen la otra.",
      "La lista:\nmanzanas y peras.",
      "Primero,\nsegundo.",
      "Ver pág.\ndiez.",
      "Son aprox.\ndiez euros.",
    ],
  },
  pt_BR: {
    pos: [
      ["Fim.\ncontinua aqui.", "Fim.\nContinua aqui."],
      ["Por quê?\nporque sim.", "Por quê?\nPorque sim."],
      ["Pare!\nespere.", "Pare!\nEspere."],
      ["Título\n\nprimeiro ponto.", "Título\n\nPrimeiro ponto."],
      ["Feito.\ndepois testamos.", "Feito.\nDepois testamos."],
    ],
    neg: [
      "Esta linha continua\nna outra.",
      "A lista:\nmaçãs e peras.",
      "Primeiro,\nsegundo.",
      "Veja pág.\ndez.",
      "Custa aprox.\ndez reais.",
    ],
  },
  sv_SE: {
    pos: [
      ["Slut.\nfortsätt här.", "Slut.\nFortsätt här."],
      ["Varför?\nför att.", "Varför?\nFör att."],
      ["Stopp!\nvänta.", "Stopp!\nVänta."],
      ["Rubrik\n\nförsta punkten.", "Rubrik\n\nFörsta punkten."],
      ["Klart.\nsedan testar vi.", "Klart.\nSedan testar vi."],
    ],
    neg: [
      "Den här raden fortsätter\npå nästa.",
      "Listan:\näpplen och päron.",
      "Först,\nsedan.",
      "Jag köpte 5 st.\näpplen.",
      "Det kostar ca.\ntio kronor.",
    ],
  },
  hr_HR: {
    pos: [
      ["Kraj.\nnastavak ovdje.", "Kraj.\nNastavak ovdje."],
      ["Zašto?\nzato.", "Zašto?\nZato."],
      ["Stani!\nčekaj.", "Stani!\nČekaj."],
      ["Naslov\n\nprva točka.", "Naslov\n\nPrva točka."],
      ["Gotovo.\nzatim testiramo.", "Gotovo.\nZatim testiramo."],
    ],
    neg: [
      "Ovaj red se nastavlja\nu sljedećem.",
      "Popis:\njabuke i kruške.",
      "Prvo,\ndrugo.",
      "Kupio sam npr.\nkruh.",
      "Rođen je 3.\nsvibnja.",
    ],
  },
  el_GR: {
    pos: [
      ["Τέλος.\nσυνέχεια εδώ.", "Τέλος.\nΣυνέχεια εδώ."],
      ["Γιατί;\nεπειδή.", "Γιατί;\nΕπειδή."],
      ["Στοπ!\nπερίμενε.", "Στοπ!\nΠερίμενε."],
      ["Τίτλος\n\nπρώτο σημείο.", "Τίτλος\n\nΠρώτο σημείο."],
      ["Έτοιμο.\nμετά δοκιμάζουμε.", "Έτοιμο.\nΜετά δοκιμάζουμε."],
    ],
    neg: [
      "Αυτή η γραμμή συνεχίζει\nστην επόμενη.",
      "Η λίστα:\nμήλα και αχλάδια.",
      "Πρώτον,\nδεύτερον.",
      "Δες σελ.\nδέκα.",
      "Φρούτα κλπ.\nκαι ψωμί.",
    ],
  },
  ar_SA: {
    pos: [
      ["انتهى.\nnext line.", "انتهى.\nNext line."],
      ["لماذا؟\nbecause.", "لماذا؟\nBecause."],
      ["قف!\nwait.", "قف!\nWait."],
      ["عنوان\n\nfirst point.", "عنوان\n\nFirst point."],
      ["تم.\nthen we test.", "تم.\nThen we test."],
    ],
    neg: [
      "هذا السطر يستمر\nفي التالي.",
      "القائمة:\nتفاح وكمثرى.",
      "أولا،\nثانيا.",
      "انتهى.\nمرحبا.",
      "لماذا؟\nلأن.",
    ],
  },
};
