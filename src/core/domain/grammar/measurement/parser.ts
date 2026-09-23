import type { MeasurementLocalePolicy } from "./contracts";
import { lookupMeasurementUnit } from "./registry";

const MAX_EXPRESSION_LENGTH = 128;
const MAX_GROUP_DEPTH = 4;
const UNIT_CHAR = /[\p{L}%°Ωµμ]/u;
const DIGIT = /[0-9]/;
const SUPERSCRIPT = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/u;

interface ParsedMeasurementExpression {
  start: number;
  numberEnd: number;
  unitStart: number;
}

/** Parses a complete number + unit expression ending at the end of `text`. */
export function parseMeasurementExpression(
  text: string,
  locale: MeasurementLocalePolicy,
  isUnit: (text: string, start: number) => boolean = parseUnitExpression,
): ParsedMeasurementExpression | null {
  const boundedStart = Math.max(0, text.length - MAX_EXPRESSION_LENGTH);

  for (let start = text.length - 1; start >= boundedStart; start -= 1) {
    const signed = text[start] === "+" || text[start] === "-";
    if (!digitSystemAt(text[signed ? start + 1 : start], locale)) {
      continue;
    }
    // Arabic ٫ and ٬ are number punctuation too: "١٬٥٠٠kg" must not start at "٥".
    if (start > 0 && /[\p{L}\p{N}_.,٫٬/\\+\-±]/u.test(text[start - 1])) {
      continue;
    }

    const numberEnd = readNumber(text, start, locale);
    if (numberEnd === null) {
      continue;
    }
    let unitStart = numberEnd;
    while (text[unitStart] === " " || text[unitStart] === "\u00a0") {
      unitStart += 1;
    }
    if (unitStart === text.length || !isUnit(text, unitStart)) {
      continue;
    }

    return { start, numberEnd, unitStart };
  }
  return null;
}

const LATIN_DIGITS = "0123456789";

interface DigitSystem {
  digits: string;
  decimalMarks: readonly string[];
}

function isDigitOf(digits: string, char: string | undefined): boolean {
  return !!char && digits.includes(char);
}

function digitSystemAt(
  char: string | undefined,
  locale: MeasurementLocalePolicy,
): DigitSystem | null {
  if (isDigitOf(LATIN_DIGITS, char)) {
    return { digits: LATIN_DIGITS, decimalMarks: locale.decimalMarks };
  }
  const native = locale.nativeDigits;
  if (native && isDigitOf(native.digits, char)) {
    return { digits: native.digits, decimalMarks: [native.decimalMark] };
  }
  return null;
}

function readNumber(text: string, start: number, locale: MeasurementLocalePolicy): number | null {
  let index = start;
  if (text[index] === "+" || text[index] === "-") {
    index += 1;
  }
  // One number uses one digit system and that system's decimal mark; "1٫5" and
  // "١.٥" stop at the foreign mark and so fail as unit expressions.
  const system = digitSystemAt(text[index], locale);
  if (!system) {
    return null;
  }
  while (isDigitOf(system.digits, text[index])) {
    index += 1;
  }

  if (system.decimalMarks.includes(text[index])) {
    index += 1;
    const fractionStart = index;
    while (isDigitOf(system.digits, text[index])) {
      index += 1;
    }
    if (index === fractionStart) {
      return null;
    }
  }
  return index;
}

function parseUnitExpression(text: string, start: number): boolean {
  // A leading group could be algebraic multiplication, not a unit designation.
  if (text[start] === "(") return false;
  // "pm" is a clock suffix in prose; explicit compounds such as "pm/s" remain valid.
  if (text.slice(start) === "pm") return false;
  let index = start;
  let atomCount = 0;
  let invalidComposition = false;

  const readAtom = (depth: number): boolean => {
    if (depth > MAX_GROUP_DEPTH) {
      return false;
    }
    if (text[index] === "(") {
      index += 1;
      atomCount += 1;
      if (!readExpression(depth + 1) || text[index] !== ")") {
        return false;
      }
      index += 1;
    } else {
      const symbolStart = index;
      while (UNIT_CHAR.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === symbolStart) {
        return false;
      }
      const symbol = text.slice(symbolStart, index);
      const unit = lookupMeasurementUnit(symbol);
      if (!unit?.safe || unit.ambiguity) {
        return false;
      }
      atomCount += 1;
      invalidComposition ||= !unit.composition;
    }

    if (invalidComposition && (text[index] === "^" || SUPERSCRIPT.test(text[index] ?? ""))) {
      return false;
    }
    if (text[index] === "^") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") {
        index += 1;
      }
      const exponentStart = index;
      while (DIGIT.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === exponentStart) {
        return false;
      }
    } else if (SUPERSCRIPT.test(text[index] ?? "")) {
      if (text[index] === "⁻") {
        index += 1;
      }
      const exponentStart = index;
      while (SUPERSCRIPT.test(text[index] ?? "") && text[index] !== "⁻") index += 1;
      if (index === exponentStart) return false;
    }
    return true;
  };

  const readExpression = (depth: number): boolean => {
    if (!readAtom(depth)) {
      return false;
    }
    while (
      text[index] === "/" ||
      text[index] === "·" ||
      text[index] === "⋅" ||
      text[index] === "*"
    ) {
      index += 1;
      if (!readAtom(depth)) {
        return false;
      }
    }
    return true;
  };

  return readExpression(0) && index === text.length && (atomCount === 1 || !invalidComposition);
}
