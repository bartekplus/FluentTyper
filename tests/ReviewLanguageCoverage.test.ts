import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  resolveReviewLanguage,
  reviewDictionaryLanguage,
  SUPPORTED_LANGUAGES_SHORT_CODE,
} from "../src/core/domain/lang";
import { reviewLanguageRegions } from "../src/core/application/review/ReviewLanguageRegions";
import { withDeadline } from "../src/core/application/transport-utils";
import { detectReviewDiagnostics } from "../src/core/domain/grammar/review/reviewDiagnostics";
import { spellingCandidates } from "../src/core/domain/grammar/review/reviewSpelling";
import { prepareReview } from "../src/core/domain/grammar/review/reviewDiagnostics";

const enabled = Object.values(SUPPORTED_LANGUAGES_SHORT_CODE);

describe("Review language coverage", () => {
  test.each(["en_NZ", "en_IE"])("unverified variant %s has no dictionary fallback", (language) => {
    expect(reviewDictionaryLanguage(language)).toBeNull();
    expect(resolveReviewLanguage(language)).toEqual({
      language,
      source: "explicit",
      resource: null,
    });
    expect(resolveReviewLanguage("auto_detect", language, enabled, "en_US")).toEqual({
      language,
      source: "detected",
      resource: null,
    });
  });

  test("every advertised dictionary has packaged sources; Japanese has no substitute", () => {
    expect(enabled).toHaveLength(10);
    for (const lang of enabled) {
      expect(reviewDictionaryLanguage(lang)).toBe(lang);
      for (const ext of ["aff", "dic"])
        expect(existsSync(`resources_js/${lang}/hunspell/${lang}.${ext}`)).toBe(true);
    }
    expect(resolveReviewLanguage("auto_detect", "ja", enabled, "en_US")).toEqual({
      language: "ja",
      source: "detected",
      resource: null,
    });
  });

  test("explicit choices win, regional compatibility is bounded, and uncertainty is visible", () => {
    expect(resolveReviewLanguage("en_US", "pl", enabled, "pl_PL")).toEqual({
      language: "en_US",
      resource: "en_US",
      source: "explicit",
    });
    expect(resolveReviewLanguage("en-GB")).toEqual({
      language: "en_GB",
      resource: "en_US",
      source: "explicit",
    });
    expect(resolveReviewLanguage("pt-PT").resource).toBeNull();
    expect(resolveReviewLanguage("En-gb").resource).toBe("en_US");
    expect(
      resolveReviewLanguage("auto_detect", "ja", enabled, "en_US", "This paragraph is ready."),
    ).toMatchObject({ source: "fallback", language: "en_US" });
    expect(resolveReviewLanguage("auto_detect", "fr", enabled, "en_US", "hi")).toMatchObject({
      language: "en_US",
      source: "fallback",
    });
    expect(resolveReviewLanguage("auto_detect", null, enabled, "pl_PL")).toEqual({
      language: "pl_PL",
      resource: "pl_PL",
      source: "fallback",
    });
    expect(resolveReviewLanguage("auto_detect", "fr", enabled, "en_US").language).toBe("fr_FR");
    expect(resolveReviewLanguage("auto_detect", "pl", ["en_US"], "en_US").resource).toBeNull();
    expect(resolveReviewLanguage("auto_detect", null, enabled, "ja").source).toBe("unresolved");
  });

  test("paragraph evidence excludes foreign and uncertain text and deduplicates requests", async () => {
    const english = "This is an English sentence.";
    const polish = "To jest polskie zdanie.";
    const uncertain = "Words without reliable evidence.";
    const text = [english, polish, uncertain, polish].join("\n");
    const requests: string[] = [];
    const regions = await reviewLanguageRegions(text, "en_US", async (sample) => {
      requests.push(sample);
      return sample === english ? "en" : sample === polish ? "pl" : null;
    });
    expect(requests).toEqual([english, polish, uncertain]);
    expect(regions.map((range) => [text.slice(range.start, range.end), range.reason])).toEqual([
      [polish, "other-language"],
      [uncertain, "language-uncertain"],
      [polish, "other-language"],
    ]);
    let calls = 0;
    const long = Array.from({ length: 40 }, (_, i) => `${i} This is a long paragraph.`).join("\n");
    const limited = await reviewLanguageRegions(long, "en_US", async () => {
      calls++;
      return "en";
    });
    expect(calls).toBe(32);
    expect(limited).toHaveLength(8);
    // An explicit language does not hide the paragraphs past the request cap.
    expect(await reviewLanguageRegions(long, "en_US", async () => "en", false)).toEqual([]);
  });

  test("mixed script and code cannot become native or spelling findings", async () => {
    const text = "teh cat\nこれは日本語です teh\n`teh` https://example.com user_name";
    const snapshot = {
      id: "mixed",
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: await reviewLanguageRegions(text, "en_US", async () => "en"),
    };
    const options = {
      lang: "en_US",
      enabledRules: ["englishTypoWhitelistCorrection"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    };
    const result = detectReviewDiagnostics(snapshot, options);
    expect(result.diagnostics.map((finding) => finding.original)).toEqual(["teh"]);
    expect(result.coverage.skipped["other-language"]).toBeGreaterThan(0);
    expect(
      spellingCandidates(prepareReview(snapshot, options), []).map((candidate) => candidate.word),
    ).toEqual(["teh", "cat"]);
  });

  test("deadline rejects and ignores late resource completion", async () => {
    let complete: (value: string) => void = () => {};
    const pending = withDeadline(
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
      1,
    );
    await expect(pending).rejects.toThrow("resource-timeout");
    complete("late");
    await expect(withDeadline(Promise.resolve("cached"))).resolves.toBe("cached");
  });
});
