import type { RuleFixtures } from "./types";

const NB = " ";

export const measurement: RuleFixtures = {
  en_US: {
    pos: [
      ["It weighs 10kg in total.", `It weighs 10${NB}kg in total.`],
      ["We walked 5km today.", `We walked 5${NB}km today.`],
      ["The board is 20cm wide.", `The board is 20${NB}cm wide.`],
      ["Add 100ml of milk.", `Add 100${NB}ml of milk.`],
      ["It is 2.5kg heavier.", `It is 2.5${NB}kg heavier.`],
    ],
    neg: [
      "It weighs 10 kg in total.",
      "Print it on A4 paper.",
      "Save it as mp3 first.",
      "Set margin: 10px in CSS.",
      "Open file v2 now.",
    ],
  },
  fr_FR: {
    pos: [
      ["Il pèse 10kg au total.", `Il pèse 10${NB}kg au total.`],
      ["Nous avons marché 5km.", `Nous avons marché 5${NB}km.`],
      ["La planche fait 20cm de large.", `La planche fait 20${NB}cm de large.`],
      ["Ajoutez 100ml de lait.", `Ajoutez 100${NB}ml de lait.`],
      ["Il fait 2,5kg de plus.", `Il fait 2,5${NB}kg de plus.`],
    ],
    neg: [
      "Il pèse 10 kg au total.",
      "Imprimez sur du papier A4.",
      "Enregistrez en mp3 d'abord.",
      "Mettez margin: 10px en CSS.",
      "Ouvrez le fichier v2.",
    ],
  },
  de_DE: {
    pos: [
      ["Es wiegt 10kg insgesamt.", `Es wiegt 10${NB}kg insgesamt.`],
      ["Wir liefen 5km heute.", `Wir liefen 5${NB}km heute.`],
      ["Das Brett ist 20cm breit.", `Das Brett ist 20${NB}cm breit.`],
      ["Gib 100ml Milch dazu.", `Gib 100${NB}ml Milch dazu.`],
      ["Es ist 2,5kg schwerer.", `Es ist 2,5${NB}kg schwerer.`],
    ],
    neg: [
      "Es wiegt 10 kg insgesamt.",
      "Drucke es auf A4 aus.",
      "Speichere es als mp3.",
      "Setze margin: 10px in CSS.",
      "Öffne die Datei v2.",
    ],
  },
  pl_PL: {
    pos: [
      ["Waży 10kg w sumie.", `Waży 10${NB}kg w sumie.`],
      ["Przeszliśmy 5km dzisiaj.", `Przeszliśmy 5${NB}km dzisiaj.`],
      ["Deska ma 20cm szerokości.", `Deska ma 20${NB}cm szerokości.`],
      ["Dodaj 100ml mleka.", `Dodaj 100${NB}ml mleka.`],
      ["Jest cięższy o 2,5kg teraz.", `Jest cięższy o 2,5${NB}kg teraz.`],
    ],
    neg: [
      "Waży 10 kg w sumie.",
      "Wydrukuj na papierze A4.",
      "Zapisz jako mp3.",
      "Ustaw margin: 10px w CSS.",
      "Otwórz plik v2.",
    ],
  },
  es_ES: {
    pos: [
      ["Pesa 10kg en total.", `Pesa 10${NB}kg en total.`],
      ["Caminamos 5km hoy.", `Caminamos 5${NB}km hoy.`],
      ["La tabla mide 20cm de ancho.", `La tabla mide 20${NB}cm de ancho.`],
      ["Añade 100ml de leche.", `Añade 100${NB}ml de leche.`],
      ["Pesa 2,5kg más.", `Pesa 2,5${NB}kg más.`],
    ],
    neg: [
      "Pesa 10 kg en total.",
      "Imprímelo en papel A4.",
      "Guárdalo como mp3.",
      "Pon margin: 10px en CSS.",
      "Abre el archivo v2.",
    ],
  },
  pt_BR: {
    pos: [
      ["Pesa 10kg no total.", `Pesa 10${NB}kg no total.`],
      ["Andamos 5km hoje.", `Andamos 5${NB}km hoje.`],
      ["A tábua tem 20cm de largura.", `A tábua tem 20${NB}cm de largura.`],
      ["Adicione 100ml de leite.", `Adicione 100${NB}ml de leite.`],
      ["Pesa 2,5kg a mais.", `Pesa 2,5${NB}kg a mais.`],
    ],
    neg: [
      "Pesa 10 kg no total.",
      "Imprima em papel A4.",
      "Salve como mp3.",
      "Use margin: 10px no CSS.",
      "Abra o arquivo v2.",
    ],
  },
  sv_SE: {
    pos: [
      ["Den väger 10kg totalt.", `Den väger 10${NB}kg totalt.`],
      ["Vi gick 5km idag.", `Vi gick 5${NB}km idag.`],
      ["Brädan är 20cm bred.", `Brädan är 20${NB}cm bred.`],
      ["Tillsätt 100ml mjölk.", `Tillsätt 100${NB}ml mjölk.`],
      ["Den är 2,5kg tyngre.", `Den är 2,5${NB}kg tyngre.`],
    ],
    neg: [
      "Den väger 10 kg totalt.",
      "Skriv ut på A4.",
      "Spara som mp3.",
      "Sätt margin: 10px i CSS.",
      "Öppna filen v2.",
    ],
  },
  hr_HR: {
    pos: [
      ["Teži 10kg ukupno.", `Teži 10${NB}kg ukupno.`],
      ["Hodali smo 5km danas.", `Hodali smo 5${NB}km danas.`],
      ["Daska je široka 20cm.", `Daska je široka 20${NB}cm.`],
      ["Dodaj 100ml mlijeka.", `Dodaj 100${NB}ml mlijeka.`],
      ["Teži 2,5kg više.", `Teži 2,5${NB}kg više.`],
    ],
    neg: [
      "Teži 10 kg ukupno.",
      "Ispiši na papir A4.",
      "Spremi kao mp3.",
      "Postavi margin: 10px u CSS-u.",
      "Otvori datoteku v2.",
    ],
  },
  el_GR: {
    pos: [
      ["Ζυγίζει 10kg συνολικά.", `Ζυγίζει 10${NB}kg συνολικά.`],
      ["Περπατήσαμε 5km σήμερα.", `Περπατήσαμε 5${NB}km σήμερα.`],
      ["Η σανίδα είναι 20cm φαρδιά.", `Η σανίδα είναι 20${NB}cm φαρδιά.`],
      ["Πρόσθεσε 100ml γάλα.", `Πρόσθεσε 100${NB}ml γάλα.`],
      ["Είναι 2,5kg βαρύτερο.", `Είναι 2,5${NB}kg βαρύτερο.`],
    ],
    neg: [
      "Ζυγίζει 10 kg συνολικά.",
      "Τύπωσε σε χαρτί A4.",
      "Αποθήκευσε ως mp3.",
      "Βάλε margin: 10px στο CSS.",
      "Άνοιξε το αρχείο v2.",
    ],
  },
  ar_SA: {
    pos: [
      ["الوزن 10kg تقريبا.", `الوزن 10${NB}kg تقريبا.`],
      ["مشينا 5km اليوم.", `مشينا 5${NB}km اليوم.`],
      ["العرض 20cm فقط.", `العرض 20${NB}cm فقط.`],
      ["أضف 100ml من الحليب.", `أضف 100${NB}ml من الحليب.`],
      ["الفرق 2.5kg تقريبا.", `الفرق 2.5${NB}kg تقريبا.`],
    ],
    neg: [
      "الوزن 10 kg تقريبا.",
      "اطبعه على ورق A4.",
      "احفظه بصيغة mp3.",
      "استخدم margin: 10px في CSS.",
      "افتح الملف v2.",
    ],
  },
};

export const currency: RuleFixtures = {
  en_US: {
    pos: [
      ["It costs 5€ today.", `It costs 5${NB}€ today.`],
      ["Pay 10EUR now.", `Pay 10${NB}EUR now.`],
      ["It was 20USD last year.", `It was 20${NB}USD last year.`],
      ["Send 15GBP please.", `Send 15${NB}GBP please.`],
      ["It costs 3.50€ each.", `It costs 3.50${NB}€ each.`],
    ],
    neg: [
      "It costs 5 € today.",
      "It costs €5 today.",
      "Use the EUR2USD converter.",
      "Play the mp3 file.",
      "Take the A4 sheet.",
    ],
  },
  fr_FR: {
    pos: [
      ["Ça coûte 5€ aujourd'hui.", `Ça coûte 5${NB}€ aujourd'hui.`],
      ["Payez 10EUR maintenant.", `Payez 10${NB}EUR maintenant.`],
      ["C'était 20USD l'an dernier.", `C'était 20${NB}USD l'an dernier.`],
      ["Envoyez 15CHF svp.", `Envoyez 15${NB}CHF svp.`],
      ["Il coûte 3,50€ pièce.", `Il coûte 3,50${NB}€ pièce.`],
    ],
    neg: [
      "Ça coûte 5 € aujourd'hui.",
      "Ça coûte 5 € aujourd'hui.",
      "Utilisez le convertisseur EUR2USD.",
      "Écoutez le fichier mp3.",
      "Prenez la feuille A4.",
    ],
  },
  de_DE: {
    pos: [
      ["Es kostet 5€ heute.", `Es kostet 5${NB}€ heute.`],
      ["Zahle 10EUR jetzt.", `Zahle 10${NB}EUR jetzt.`],
      ["Es waren 20USD letztes Jahr.", `Es waren 20${NB}USD letztes Jahr.`],
      ["Schick 15CHF bitte.", `Schick 15${NB}CHF bitte.`],
      ["Es kostet 3,50€ pro Stück.", `Es kostet 3,50${NB}€ pro Stück.`],
    ],
    neg: [
      "Es kostet 5 € heute.",
      "Es kostet 5 € heute.",
      "Nutze den EUR2USD Rechner.",
      "Spiel die mp3 Datei.",
      "Nimm das A4 Blatt.",
    ],
  },
  pl_PL: {
    pos: [
      ["Kosztuje 5zł dzisiaj.", `Kosztuje 5${NB}zł dzisiaj.`],
      ["Zapłać 10PLN teraz.", `Zapłać 10${NB}PLN teraz.`],
      ["To było 20EUR w zeszłym roku.", `To było 20${NB}EUR w zeszłym roku.`],
      ["Wyślij 15USD proszę.", `Wyślij 15${NB}USD proszę.`],
      ["Kosztuje 3,50zł za sztukę.", `Kosztuje 3,50${NB}zł za sztukę.`],
    ],
    neg: [
      "Kosztuje 5 zł dzisiaj.",
      "Kosztuje 5 zł dzisiaj.",
      "Użyj przelicznika PLN2EUR.",
      "Odtwórz plik mp3.",
      "Weź kartkę A4.",
    ],
  },
  es_ES: {
    pos: [
      ["Cuesta 5€ hoy.", `Cuesta 5${NB}€ hoy.`],
      ["Paga 10EUR ahora.", `Paga 10${NB}EUR ahora.`],
      ["Fueron 20USD el año pasado.", `Fueron 20${NB}USD el año pasado.`],
      ["Envía 15MXN por favor.", `Envía 15${NB}MXN por favor.`],
      ["Cuesta 3,50€ cada uno.", `Cuesta 3,50${NB}€ cada uno.`],
    ],
    neg: [
      "Cuesta 5 € hoy.",
      "Cuesta 5 € hoy.",
      "Usa el conversor EUR2USD.",
      "Reproduce el archivo mp3.",
      "Toma la hoja A4.",
    ],
  },
  pt_BR: {
    pos: [
      ["Custa 5€ hoje.", `Custa 5${NB}€ hoje.`],
      ["Pague 10BRL agora.", `Pague 10${NB}BRL agora.`],
      ["Foram 20USD no ano passado.", `Foram 20${NB}USD no ano passado.`],
      ["Envie 15EUR por favor.", `Envie 15${NB}EUR por favor.`],
      ["Custa 3,50€ cada.", `Custa 3,50${NB}€ cada.`],
    ],
    neg: [
      "Custa 5 € hoje.",
      "Custa 5 € hoje.",
      "Use o conversor BRL2USD.",
      "Toque o arquivo mp3.",
      "Pegue a folha A4.",
    ],
  },
  sv_SE: {
    pos: [
      ["Det kostar 5kr idag.", `Det kostar 5${NB}kr idag.`],
      ["Betala 10SEK nu.", `Betala 10${NB}SEK nu.`],
      ["Det var 20EUR förra året.", `Det var 20${NB}EUR förra året.`],
      ["Skicka 15NOK tack.", `Skicka 15${NB}NOK tack.`],
      ["Det kostar 3,50kr styck.", `Det kostar 3,50${NB}kr styck.`],
    ],
    neg: [
      "Det kostar 5 kr idag.",
      "Det kostar 5 kr idag.",
      "Använd SEK2EUR omvandlaren.",
      "Spela mp3 filen.",
      "Ta A4 arket.",
    ],
  },
  hr_HR: {
    pos: [
      ["Košta 5€ danas.", `Košta 5${NB}€ danas.`],
      ["Plati 10EUR sada.", `Plati 10${NB}EUR sada.`],
      ["Bilo je 20USD prošle godine.", `Bilo je 20${NB}USD prošle godine.`],
      ["Pošalji 15CHF molim.", `Pošalji 15${NB}CHF molim.`],
      ["Košta 3,50€ po komadu.", `Košta 3,50${NB}€ po komadu.`],
    ],
    neg: [
      "Košta 5 € danas.",
      "Košta 5 € danas.",
      "Koristi pretvornik EUR2USD.",
      "Pusti mp3 datoteku.",
      "Uzmi A4 papir.",
    ],
  },
  el_GR: {
    pos: [
      ["Κοστίζει 5€ σήμερα.", `Κοστίζει 5${NB}€ σήμερα.`],
      ["Πλήρωσε 10EUR τώρα.", `Πλήρωσε 10${NB}EUR τώρα.`],
      ["Ήταν 20USD πέρσι.", `Ήταν 20${NB}USD πέρσι.`],
      ["Στείλε 15GBP παρακαλώ.", `Στείλε 15${NB}GBP παρακαλώ.`],
      ["Κοστίζει 3,50€ το ένα.", `Κοστίζει 3,50${NB}€ το ένα.`],
    ],
    neg: [
      "Κοστίζει 5 € σήμερα.",
      "Κοστίζει 5 € σήμερα.",
      "Χρησιμοποίησε τον μετατροπέα EUR2USD.",
      "Παίξε το αρχείο mp3.",
      "Πάρε το χαρτί A4.",
    ],
  },
  ar_SA: {
    pos: [
      ["السعر 5SAR اليوم.", `السعر 5${NB}SAR اليوم.`],
      ["ادفع 10AED الآن.", `ادفع 10${NB}AED الآن.`],
      ["كان 20USD العام الماضي.", `كان 20${NB}USD العام الماضي.`],
      ["أرسل 15EUR من فضلك.", `أرسل 15${NB}EUR من فضلك.`],
      ["السعر 3.50€ للقطعة.", `السعر 3.50${NB}€ للقطعة.`],
    ],
    neg: [
      "السعر 5 SAR اليوم.",
      "السعر 5 SAR اليوم.",
      "استخدم محول SAR2USD.",
      "شغل ملف mp3.",
      "خذ ورقة A4.",
    ],
  },
};
