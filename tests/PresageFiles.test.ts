import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import {
  setTextExpansions,
  setUserDictionaryList,
  tunedAffix,
  tuneHunspellSuggestions,
} from "../src/adapters/chrome/background/PresageFiles";

describe("PresageFiles", () => {
  test("writes lowercase expansions to file and updates all presage engines", () => {
    const writeFile = jest.fn();
    const configEn = jest.fn();
    const configFr = jest.fn();

    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setTextExpansions(
      module,
      {
        en_US: { libPresage: { config: configEn } },
        fr_FR: { libPresage: { config: configFr } },
      } as never,
      [
        ["BRB", "be right back" as never],
        ["IDK", "I don't know\nreally" as never],
        // Not a string: never written (PresageHandler drops it too).
        ["OBJ", { phrase: "dropped" }],
      ],
    );

    expect(writeFile).toHaveBeenCalledWith(
      "/textExpansions.txt",
      'brb\t"be right back"\n' + 'idk\t"I don\'t know\\nreally"\n',
    );
    expect(configEn).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
    expect(configFr).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
  });

  test("handles empty expansion lists by writing an empty file", () => {
    const writeFile = jest.fn();
    const config = jest.fn();
    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setTextExpansions(module, { en_US: { libPresage: { config } } } as never, []);

    expect(writeFile).toHaveBeenCalledWith("/textExpansions.txt", "");
    expect(config).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
  });

  describe("Hunspell suggestion tuning", () => {
    const MB = 1_000_000;

    test("drops compound suggestion passes only when the affix file has no compounding", () => {
      const plain = "SET UTF-8\nTRY abc\nSFX A Y 1\nSFX A 0 s .\n";
      expect(tunedAffix(plain, MB)).toBe(`${plain}MAXCPDSUGS 0\n`);
      for (const directive of ["COMPOUNDFLAG Z", "COMPOUNDBEGIN x", "COMPOUNDRULE 2"]) {
        const compounding = `SET UTF-8\n${directive}\n`;
        expect(tunedAffix(compounding, MB)).toBe(compounding);
      }
    });

    test("drops the n-gram pass for a large dictionary, replacing an existing setting", () => {
      const aff = "SET UTF-8\nMAXNGRAMSUGS 12\nMAXDIFF 10\nCOMPOUNDFLAG Z";
      const tuned = tunedAffix(aff, 5 * MB);
      // Hunspell refuses an affix file that sets a parameter twice.
      expect(tuned.match(/^MAXNGRAMSUGS/gm)).toEqual(["MAXNGRAMSUGS"]);
      expect(tuned).toBe("SET UTF-8\nMAXNGRAMSUGS 0\nMAXDIFF 10\nCOMPOUNDFLAG Z");
      expect(tunedAffix(aff, MB)).toBe(aff);
    });

    test("is idempotent and writes only a changed affix file", () => {
      const aff = "SET UTF-8\r\nTRY abc\r\n";
      const once = tunedAffix(aff, 5 * MB);
      expect(tunedAffix(once, 5 * MB)).toBe(once);

      const files: Record<string, string> = {
        "/resources_js/xx_XX/presage.xml":
          "<DICTIONARYBASE>/resources_js/xx_XX/hunspell/xx_XX</DICTIONARYBASE>",
        "/resources_js/xx_XX/hunspell/xx_XX.aff": once,
      };
      const writeFile = jest.fn();
      const module = {
        FS: {
          writeFile,
          readFile: (path: string) => files[path],
          stat: () => ({ size: 5 * MB }),
        },
      } as unknown as PresageModule;
      tuneHunspellSuggestions(module, "xx_XX");
      expect(writeFile).not.toHaveBeenCalled();
      files["/resources_js/xx_XX/hunspell/xx_XX.aff"] = aff;
      tuneHunspellSuggestions(module, "xx_XX");
      expect(writeFile).toHaveBeenCalledWith("/resources_js/xx_XX/hunspell/xx_XX.aff", once);
    });

    test("leaves a language without a Hunspell dictionary alone", () => {
      const writeFile = jest.fn();
      const module = {
        FS: {
          writeFile,
          readFile: () => "<Presage></Presage>",
          stat: () => ({ size: 0 }),
        },
      } as unknown as PresageModule;
      tuneHunspellSuggestions(module, "xx_XX");
      // A module without a file system (test doubles) is not an error either.
      tuneHunspellSuggestions({ FS: { writeFile } } as unknown as PresageModule, "xx_XX");
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  test("writes the user dictionary as newline separated words", () => {
    const writeFile = jest.fn();
    const config = jest.fn();
    const module = {
      FS: { writeFile },
    } as unknown as PresageModule;

    setUserDictionaryList(module, { en_US: { libPresage: { config } } } as never, [
      "fluenttyper",
      "presage",
    ]);

    expect(writeFile).toHaveBeenCalledWith("/userDictionary.txt", "fluenttyper\npresage");
    expect(config).toHaveBeenCalledWith(
      "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
      "/userDictionary.txt",
    );
  });
});
