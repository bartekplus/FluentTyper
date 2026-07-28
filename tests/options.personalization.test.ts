import {
  createSettingsExportSnapshot,
  sanitizeSettingsImportSnapshot,
} from "../src/ui/options/settings";
import { PERSONALIZATION_STORAGE_KEY } from "../src/core/application/personalization/PersonalizationRepository";

describe("options personalization privacy", () => {
  test("excludes learned words from settings export and import", () => {
    const source = {
      "store.settings.language": JSON.stringify("en_US"),
      [PERSONALIZATION_STORAGE_KEY]: JSON.stringify({
        version: 1,
        languages: { en_US: { private: { display: "private", score: 2 } } },
      }),
    };

    expect(createSettingsExportSnapshot(source)).toEqual({
      "store.settings.language": JSON.stringify("en_US"),
    });
    expect(sanitizeSettingsImportSnapshot(source)).toEqual({
      "store.settings.language": JSON.stringify("en_US"),
    });
    expect(Object.hasOwn(source, PERSONALIZATION_STORAGE_KEY)).toBe(true);
  });
});
