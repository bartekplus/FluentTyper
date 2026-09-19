import { describe, expect, test } from "bun:test";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import sourceUnits from "../../data/measurement/units.json";
import sourceLocales from "../../data/measurement/locales.json";

import {
  lookupMeasurementUnit,
  resolveMeasurementLocale,
} from "@core/domain/grammar/measurement/registry";
import {
  MEASUREMENT_LOCALES,
  MEASUREMENT_UNITS,
} from "@core/domain/grammar/measurement/registry-data.generated";

describe("measurement registry", () => {
  test("recognizes exact and single-prefixed symbols case-sensitively", () => {
    expect(lookupMeasurementUnit("kg")?.identity).toBe("kilogram");
    expect(lookupMeasurementUnit("qmol")?.identity).toBe("quectomole");
    expect(lookupMeasurementUnit("MiB")?.identity).toBe("mebibyte");
    expect(lookupMeasurementUnit("kWh")?.identity).toBe("kilowatt hour");
    expect(lookupMeasurementUnit("n")?.identity).toBeUndefined();
    expect(lookupMeasurementUnit("kkg")).toBeUndefined();
  });

  test("reports prose ambiguities instead of accepting them as safe", () => {
    for (const symbol of ["in", "as", "Ms", "am", "dam", "Pa", "B", "Mb", "rad"]) {
      const unit = lookupMeasurementUnit(symbol);
      expect(unit?.safe).toBe(false);
      expect(unit?.ambiguity).toBeTruthy();
    }
    expect(lookupMeasurementUnit("MiB")?.safe).toBe(true);
    expect(lookupMeasurementUnit("YiB")?.identity).toBe("yobibyte");
  });

  test("resolves only approved exact writing locales", () => {
    expect(resolveMeasurementLocale("en-US")).toEqual({
      locale: "en_US",
      separator: "\u00a0",
      decimalMarks: ["."],
    });
    expect(resolveMeasurementLocale("pl_PL")?.decimalMarks).toEqual([","]);
    expect(resolveMeasurementLocale("en") ?? resolveMeasurementLocale("en_GB")).toBeUndefined();
    expect(resolveMeasurementLocale("pt-PT")).toBeUndefined();
  });

  test("keeps every generated exact unit and locale reachable", () => {
    expect(MEASUREMENT_UNITS).toEqual(sourceUnits.map(({ ucum: _ucum, ...unit }) => unit));
    expect(new Set(sourceUnits.map(({ symbol }) => symbol)).size).toBe(sourceUnits.length);
    expect(MEASUREMENT_LOCALES).toEqual(sourceLocales);
    for (const unit of MEASUREMENT_UNITS) {
      expect(lookupMeasurementUnit(unit.symbol)).toEqual(unit);
      expect(unit.source.length).toBeGreaterThan(0);
    }
    expect(MEASUREMENT_LOCALES.map(({ locale }) => locale).sort()).toEqual(
      Object.keys(SUPPORTED_LANGUAGES)
        .filter((locale) => !["auto_detect", "textExpander"].includes(locale))
        .sort(),
    );
  });

  test("covers every supported decimal and binary prefix", () => {
    for (const prefix of [
      "Q",
      "R",
      "Y",
      "Z",
      "E",
      "P",
      "T",
      "G",
      "M",
      "k",
      "h",
      "da",
      "d",
      "c",
      "m",
      "µ",
      "n",
      "p",
      "f",
      "a",
      "z",
      "y",
      "r",
      "q",
    ]) {
      expect(lookupMeasurementUnit(`${prefix}mol`)).toBeDefined();
    }
    for (const prefix of ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi", "Yi", "Ri", "Qi"]) {
      expect(lookupMeasurementUnit(`${prefix}B`)?.safe).toBe(true);
    }
  });
});
