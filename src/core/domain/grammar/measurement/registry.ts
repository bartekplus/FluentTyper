import type { MeasurementLocalePolicy, MeasurementUnit } from "./contracts";
import { MEASUREMENT_LOCALES, MEASUREMENT_UNITS } from "./registry-data.generated";

const units = new Map<string, MeasurementUnit>(
  MEASUREMENT_UNITS.map((unit) => [unit.symbol, unit]),
);
const locales = new Map<string, MeasurementLocalePolicy>(
  MEASUREMENT_LOCALES.map((locale) => [locale.locale, locale]),
);
const prefixedUnits = new Map<string, MeasurementUnit>();

const decimalPrefixes = [
  ["da", "deca"],
  ["Q", "quetta"],
  ["R", "ronna"],
  ["Y", "yotta"],
  ["Z", "zetta"],
  ["E", "exa"],
  ["P", "peta"],
  ["T", "tera"],
  ["G", "giga"],
  ["M", "mega"],
  ["k", "kilo"],
  ["h", "hecto"],
  ["d", "deci"],
  ["c", "centi"],
  ["m", "milli"],
  ["µ", "micro"],
  ["μ", "micro"],
  ["n", "nano"],
  ["p", "pico"],
  ["f", "femto"],
  ["a", "atto"],
  ["z", "zepto"],
  ["y", "yocto"],
  ["r", "ronto"],
  ["q", "quecto"],
] as const;
const binaryPrefixes = [
  ["Ki", "kibi"],
  ["Mi", "mebi"],
  ["Gi", "gibi"],
  ["Ti", "tebi"],
  ["Pi", "pebi"],
  ["Ei", "exbi"],
  ["Zi", "zebi"],
  ["Yi", "yobi"],
  ["Ri", "robi"],
  ["Qi", "quebi"],
] as const;

function prefixedUnit(
  symbol: string,
  prefixes: readonly (readonly [string, string])[],
  kind: "decimal" | "binary",
): MeasurementUnit | undefined {
  for (const [prefix, name] of prefixes) {
    if (!symbol.startsWith(prefix)) continue;
    const base = units.get(symbol.slice(prefix.length));
    if (!base || (base.prefixes !== kind && base.prefixes !== "both")) continue;
    const binaryByte = kind === "binary" && base.symbol === "B";
    const source = `BIPM-SI-9-4.01; ${base.source}`;
    if (binaryByte) {
      const { ambiguity: _ambiguity, ...byte } = base;
      return { ...byte, identity: `${name}${base.identity}`, symbol, safe: true, source };
    }
    return {
      ...base,
      identity: `${name}${base.identity}`,
      symbol,
      source,
    };
  }
}

for (const base of units.values()) {
  if (base.prefixes === "decimal" || base.prefixes === "both") {
    for (const [prefix] of decimalPrefixes) {
      const symbol = prefix + base.symbol;
      const unit = prefixedUnit(symbol, decimalPrefixes, "decimal");
      if (unit) prefixedUnits.set(symbol, unit);
    }
  }
  if (base.prefixes === "binary" || base.prefixes === "both") {
    for (const [prefix] of binaryPrefixes) {
      const symbol = prefix + base.symbol;
      const unit = prefixedUnit(symbol, binaryPrefixes, "binary");
      if (unit) prefixedUnits.set(symbol, unit);
    }
  }
}

/** Exact, case-sensitive prose-symbol lookup with one permitted prefix. */
export function lookupMeasurementUnit(symbol: string): MeasurementUnit | undefined {
  return units.get(symbol) ?? prefixedUnits.get(symbol);
}

/** Resolve only the nine writing locales supported by the grammar policy. */
export function resolveMeasurementLocale(lang?: string): MeasurementLocalePolicy | undefined {
  if (!lang) return undefined;
  const match = /^([A-Za-z]{2})[-_]([A-Za-z]{2})$/.exec(lang);
  return match ? locales.get(`${match[1].toLowerCase()}_${match[2].toUpperCase()}`) : undefined;
}
