import type { MeasurementLocalePolicy, MeasurementUnit } from "./contracts";
import { MEASUREMENT_LOCALES, MEASUREMENT_UNITS } from "./registry-data.generated";

const units = new Map<string, MeasurementUnit>(
  MEASUREMENT_UNITS.map((unit) => [unit.symbol, unit]),
);
const locales = new Map<string, MeasurementLocalePolicy>(
  MEASUREMENT_LOCALES.map((locale) => [locale.locale, locale]),
);
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
  prefix: string,
  name: string,
  kind: "decimal" | "binary",
): MeasurementUnit | undefined {
  if (!symbol.startsWith(prefix)) return;
  const base = units.get(symbol.slice(prefix.length));
  if (!base || (base.prefixes !== kind && base.prefixes !== "both")) return;
  const source = `BIPM-SI-9-4.01; ${base.source}`;
  if (kind === "binary" && base.symbol === "B") {
    const { ambiguity: _ambiguity, ...byte } = base;
    return { ...byte, identity: `${name}${base.identity}`, symbol, safe: true, source };
  }
  return { ...base, identity: `${name}${base.identity}`, symbol, source };
}

/** Exact, case-sensitive prose-symbol lookup with one permitted prefix. */
export function lookupMeasurementUnit(symbol: string): MeasurementUnit | undefined {
  const exact = units.get(symbol);
  if (exact) return exact;
  // Longest-prefix order is not unique ("dag" is deca-gram or deci-ag), so the
  // last declared prefix wins, matching the declaration order of the tables.
  let prefixed: MeasurementUnit | undefined;
  for (const [prefix, name] of decimalPrefixes)
    prefixed = prefixedUnit(symbol, prefix, name, "decimal") ?? prefixed;
  for (const [prefix, name] of binaryPrefixes)
    prefixed = prefixedUnit(symbol, prefix, name, "binary") ?? prefixed;
  return prefixed;
}

/** Resolve only the nine writing locales supported by the grammar policy. */
export function resolveMeasurementLocale(lang?: string): MeasurementLocalePolicy | undefined {
  if (!lang) return undefined;
  const match = /^([A-Za-z]{2})[-_]([A-Za-z]{2})$/.exec(lang);
  return match ? locales.get(`${match[1].toLowerCase()}_${match[2].toUpperCase()}`) : undefined;
}
