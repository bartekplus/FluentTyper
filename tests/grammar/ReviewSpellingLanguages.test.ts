import { describe, expect, test } from "bun:test";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  parseSpellingRequest,
  spellingCandidates,
} from "../../src/core/domain/grammar/review/reviewSpelling";

function candidates(text: string, lang: string) {
  const prepared = prepareReview(
    { id: "spell", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  return spellingCandidates(prepared, []);
}

/**
 * Per language: words typed with a held Shift get the first-capital form
 * (`casing`); prose words are looked up; names inside a sentence, technical
 * tokens, digit-glued words and acronym plurals are never looked up.
 */
const LANGUAGES: Record<
  string,
  { casing: Array<[string, string]>; lookedUp: string[]; skipped: string[] }
> = {
  en_US: {
    casing: [
      ["THe cat sleeps.", "The"],
      ["We LEt it go.", "Let"],
      ["It is GOod.", "Good"],
      ["A NEw day.", "New"],
      ["Go HOme now.", "Home"],
    ],
    lookedUp: ["teh", "recieve", "adress", "occured", "wich"],
    skipped: ["Anna", "IDs", "NASA", "user_name", "mp3"],
  },
  fr_FR: {
    casing: [
      ["LEs chats dorment.", "Les"],
      ["Il est BOn.", "Bon"],
      ["Une NOuvelle idée.", "Nouvelle"],
      ["Viens ICi.", "Ici"],
      ["C'est TRès bien.", "Très"],
    ],
    lookedUp: ["mangé", "ecole", "aujourdui", "beacoup", "tres"],
    skipped: ["Marie", "PDFs", "SNCF", "nom_fichier", "mp3"],
  },
  de_DE: {
    casing: [
      ["DIe Katze schläft.", "Die"],
      ["Es ist GUt.", "Gut"],
      ["Ein NEuer Tag.", "Neuer"],
      ["Komm HEute.", "Heute"],
      ["Das ist SEhr schön.", "Sehr"],
    ],
    lookedUp: ["schnel", "vieleicht", "wiederum", "garnix", "eigendlich"],
    // Nouns and names are both capitalized mid-sentence: neither is looked up.
    skipped: ["Hauss", "IDs", "BMW", "datei_name", "mp3"],
  },
  pl_PL: {
    casing: [
      ["DZień dobry.", "Dzień"],
      ["To jest DObre.", "Dobre"],
      ["Nowy DZień.", "Dzień"],
      ["Chodź TUtaj.", "Tutaj"],
      ["Jest BArdzo dobrze.", "Bardzo"],
    ],
    lookedUp: ["wogule", "napewno", "kturego", "żeczywiście", "bendzie"],
    skipped: ["Anna", "PDFy", "PKP", "nazwa_pliku", "mp3"],
  },
  es_ES: {
    casing: [
      ["LOs gatos duermen.", "Los"],
      ["Es BUeno.", "Bueno"],
      ["Un NUevo día.", "Nuevo"],
      ["Ven AQuí.", "Aquí"],
      ["Está MUy bien.", "Muy"],
    ],
    lookedUp: ["haver", "echo", "tanbien", "aver", "desir"],
    skipped: ["Pablo", "PDFs", "RENFE", "nombre_archivo", "mp3"],
  },
  pt_BR: {
    casing: [
      ["O GAto dorme.", "Gato"],
      ["É BOm.", "Bom"],
      ["Um NOvo dia.", "Novo"],
      ["Vem AQui.", "Aqui"],
      ["Está MUito bem.", "Muito"],
    ],
    lookedUp: ["concerteza", "excessão", "mais", "derrepente", "previlégio"],
    skipped: ["Pedro", "PDFs", "CPF", "nome_arquivo", "mp3"],
  },
  sv_SE: {
    casing: [
      ["KAtten sover.", "Katten"],
      ["Det är BRa.", "Bra"],
      ["En NYa dag.", "Nya"],
      ["Kom HIt.", "Hit"],
      ["Det är MYcket bra.", "Mycket"],
    ],
    lookedUp: ["iallafall", "fämton", "gickk", "ocksa", "kansek"],
    skipped: ["Anna", "PDFs", "SAS", "fil_namn", "mp3"],
  },
  hr_HR: {
    casing: [
      ["MAčka spava.", "Mačka"],
      ["To je DObro.", "Dobro"],
      ["Novi DAn.", "Dan"],
      ["Dođi OVdje.", "Ovdje"],
      ["Jako je DObro.", "Dobro"],
    ],
    lookedUp: ["nemogu", "neznam", "dali", "šta", "zašt"],
    skipped: ["Ivan", "PDFovi", "HNK", "ime_datoteke", "mp3"],
  },
  el_GR: {
    casing: [
      ["Η ΓΆτα κοιμάται.", "Γάτα"],
      ["Είναι ΚΑλό.", "Καλό"],
      ["Μια ΝΈα μέρα.", "Νέα"],
      ["Έλα ΕΔώ.", "Εδώ"],
      ["Είναι ΠΟλύ καλό.", "Πολύ"],
    ],
    lookedUp: ["καλιμέρα", "ευχαριστο", "σημερα", "αυριο", "παιδι"],
    skipped: ["Γιάννης", "PDFs", "ΟΤΕ", "όνομα_αρχείου", "mp3"],
  },
  // Arabic script is uncased: no two-initial-capitals findings on Arabic words.
  ar_SA: {
    casing: [
      ["مرحبا HEllo.", "Hello"],
      ["كلمة WOrld هنا.", "World"],
      ["هذا GOod.", "Good"],
      ["نص NEw هنا.", "New"],
      ["قال THe كلام.", "The"],
    ],
    lookedUp: ["مرحبا", "شكرا", "كتاب", "مدرسه", "انشاء"],
    skipped: ["PDFs", "NASA", "اسم_الملف", "mp3", "٣كتب"],
  },
};

describe.each(Object.entries(LANGUAGES))("%s", (lang, fixture) => {
  test.each(fixture.casing)("offers the first-capital form in %p", (text, casing) => {
    expect(candidates(text, lang).find((c) => c.casing)?.casing).toBe(casing);
  });
  test("looks up prose words", () => {
    const text = `${fixture.lookedUp.join(" ")}.`;
    const words = candidates(text, lang).map((c) => c.word.toLowerCase());
    for (const word of fixture.lookedUp) expect(words).toContain(word);
  });
  test.each(fixture.skipped)("never looks up %p inside a sentence", (word) => {
    const text = `ok ${word} ok.`;
    expect(candidates(text, lang).map((c) => c.word)).not.toContain(word);
    expect(candidates(text, lang).some((c) => c.casing)).toBe(false);
  });
  test("lookups are accepted for the language", () => {
    expect(parseSpellingRequest({ lang, words: [{ word: "ok", before: "" }] })?.lang).toBe(lang);
  });
});

test("an all-capitals short word is emphasis or an acronym, not a held Shift", () => {
  for (const [text, lang] of [
    ["LE chat.", "fr_FR"],
    ["EL gato.", "es_ES"],
    ["En NY dag.", "sv_SE"],
  ]) {
    expect(candidates(text, lang).some((c) => c.casing)).toBe(false);
  }
});

test("an unresolved auto-detect language asks no dictionary", () => {
  expect(parseSpellingRequest({ lang: "auto_detect", words: [{ word: "ok", before: "" }] })).toBe(
    null,
  );
});

test("a language's own short -s word typed with a held Shift is not an acronym plural", () => {
  for (const [text, lang, casing] of [
    ["LEs chats.", "fr_FR", "Les"],
    ["LOs gatos.", "es_ES", "Los"],
    ["DAs Haus.", "de_DE", "Das"],
    ["It WAs late.", "en_US", "Was"],
    ["DOs meninos.", "pt_BR", "Dos"],
  ]) {
    expect(candidates(text, lang).find((c) => c.casing)?.casing).toBe(casing);
  }
  // Still acronym plurals in every language.
  for (const lang of ["en_US", "fr_FR", "de_DE"]) {
    expect(candidates("Two IDs and TVs.", lang).some((c) => c.casing)).toBe(false);
  }
});
