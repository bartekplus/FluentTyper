import { afterAll, describe, expect, test } from "bun:test";
import { FRAME_SETS } from "../../src/core/domain/grammar/review/english/idioms5";
import { frame, FRAME_AUDIT } from "../../src/core/domain/grammar/review/phraseTemplates";
import { languageRules, scanResult } from "./reviewHarness";

// Plain sentences: with the audit on, every frame a detector reaches compiles and scans.
const PLAIN: Record<string, string> = {
  en_US:
    "We met at the station on Monday. She doesn't think the plan will work, but I'll try it. The U.S. team has 3 new members.",
  fr_FR: "Nous avons pris le train hier soir. Elle pense que le projet avancera bien en 2025.",
  es_ES: "Ayer fuimos al mercado con mis padres. El informe estará listo el lunes 3 de marzo.",
  pt_BR: "Ontem fomos ao mercado com os meus pais. O relatório fica pronto na segunda-feira.",
  de_DE: "Wir sind gestern mit dem Zug gefahren. Der Bericht ist am Montag, dem 3. März, fertig.",
  pl_PL: "Wczoraj pojechaliśmy pociągiem do Krakowa. Raport będzie gotowy w poniedziałek.",
  sv_SE: "Vi åkte tåg till Göteborg i går. Rapporten blir klar på måndag den 3 mars.",
  el_GR: "Χθες πήγαμε στην αγορά με τους γονείς μου. Η αναφορά θα είναι έτοιμη τη Δευτέρα.",
  ar_SA: "ذهبنا إلى السوق أمس مع والدي. سيكون التقرير جاهزا يوم الاثنين.",
};

describe("Review frame health", () => {
  afterAll(() => {
    FRAME_AUDIT.all = false;
  });

  test("every frame of the English frame engine compiles and has cue words that can match", () => {
    const broken: string[] = [];
    for (const frames of FRAME_SETS)
      for (const { pattern, cue } of frames) {
        const source = typeof pattern === "string" ? pattern : pattern.source;
        // Cue words are read as runs of letters, lowercased: "don't" and "1" never occur.
        if (cue && (cue.length === 0 || cue.some((word) => !/^\p{Ll}+$/u.test(word))))
          broken.push(`cue ${JSON.stringify(cue)}: ${source.slice(0, 60)}`);
        if (typeof pattern === "string")
          try {
            frame(pattern);
          } catch {
            broken.push(`regex: ${source.slice(0, 60)}`);
          }
      }
    expect(broken).toEqual([]);
  });

  test.each(Object.entries(PLAIN))("no rule fails on plain %s text", (lang, text) => {
    FRAME_AUDIT.all = true;
    try {
      const { coverage } = scanResult(text, { lang, enabledRules: languageRules(lang) });
      expect(coverage.failedRules).toEqual([]);
    } finally {
      FRAME_AUDIT.all = false;
    }
  });
});
