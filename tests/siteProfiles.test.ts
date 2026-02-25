import {
  normalizeDomainHost,
  resolveSiteProfiles,
  getSiteProfileForDomain,
  removeSiteProfileForDomain,
  setSiteProfileForDomain,
} from "../src/shared/siteProfiles";

describe("site profiles helpers", () => {
  const enabledLanguages = ["en_US", "fr_FR", "de_DE"];

  test("normalizeDomainHost accepts URLs and bare domains", () => {
    expect(normalizeDomainHost("https://Example.COM/path")).toBe("example.com");
    expect(normalizeDomainHost("example.com")).toBe("example.com");
    expect(normalizeDomainHost("example.com.")).toBe("example.com");
    expect(normalizeDomainHost("[" as unknown as string)).toBeUndefined();
  });

  test("resolveSiteProfiles keeps only valid domains and profiles", () => {
    const profiles = resolveSiteProfiles(
      {
        "https://example.com": {
          language: "fr_FR",
          numSuggestions: 7.6,
          inline_suggestion: true,
        },
        "bad-domain-[": {
          language: "en_US",
        },
        "other.example": {
          language: "auto_detect",
          inline_suggestion: false,
        },
      },
      enabledLanguages,
    );

    expect(profiles).toEqual({
      "example.com": {
        language: "fr_FR",
        numSuggestions: 8,
        inline_suggestion: true,
      },
    });
  });

  test("resolveSiteProfiles applies deterministic precedence for normalized duplicate domains", () => {
    const profiles = resolveSiteProfiles(
      {
        "https://example.com/path": {
          language: "en_US",
          numSuggestions: -3,
        },
        "example.com": {
          language: "fr_FR",
          inline_suggestion: false,
        },
      },
      enabledLanguages,
    );

    expect(profiles).toEqual({
      "example.com": {
        language: "fr_FR",
        inline_suggestion: false,
      },
    });
  });

  test("resolveSiteProfiles drops entries with language that is no longer enabled", () => {
    const profiles = resolveSiteProfiles(
      {
        "alpha.example": {
          language: "fr_FR",
        },
        "beta.example": {
          language: "en_US",
        },
      },
      ["en_US"],
    );

    expect(profiles).toEqual({
      "beta.example": {
        language: "en_US",
      },
    });
  });

  test("setSiteProfileForDomain creates and updates a profile with clamped values", () => {
    const created = setSiteProfileForDomain(
      {},
      "https://docs.example",
      {
        language: "de_DE",
        numSuggestions: 99,
      },
      enabledLanguages,
    );
    expect(created).toEqual({
      "docs.example": {
        language: "de_DE",
        numSuggestions: 10,
      },
    });

    const updated = setSiteProfileForDomain(
      created,
      "docs.example",
      {
        language: "en_US",
        inline_suggestion: false,
      },
      enabledLanguages,
    );
    expect(updated).toEqual({
      "docs.example": {
        language: "en_US",
        inline_suggestion: false,
      },
    });
  });

  test("getSiteProfileForDomain and removeSiteProfileForDomain work with normalized domains", () => {
    const profiles = {
      "example.com": {
        language: "en_US",
        numSuggestions: 3,
      },
    };
    const profile = getSiteProfileForDomain(
      profiles,
      "http://example.com/path",
      enabledLanguages,
    );
    expect(profile).toEqual({
      language: "en_US",
      numSuggestions: 3,
    });

    const removed = removeSiteProfileForDomain(
      profiles,
      "https://example.com",
      enabledLanguages,
    );
    expect(removed).toEqual({});
  });

  test("getSiteProfileForDomain returns undefined for unmatched or malformed inputs", () => {
    expect(
      getSiteProfileForDomain(
        {
          "example.com": {
            language: "en_US",
          },
        },
        "https://other.example",
        enabledLanguages,
      ),
    ).toBeUndefined();

    expect(
      getSiteProfileForDomain(
        {
          "example.com": {
            language: "en_US",
          },
        },
        "[",
        enabledLanguages,
      ),
    ).toBeUndefined();
  });
});
