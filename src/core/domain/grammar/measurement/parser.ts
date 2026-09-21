import type { MeasurementLocalePolicy } from "./contracts";
import { lookupMeasurementUnit } from "./registry";

const MAX_EXPRESSION_LENGTH = 128;
const MAX_GROUP_DEPTH = 4;
const UNIT_CHAR = /[\p{L}%°Ωµμ]/u;
const DIGIT = /[0-9]/;
const SUPERSCRIPT = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/u;

export interface ParsedMeasurementExpression {
  start: number;
  numberEnd: number;
  unitStart: number;
}

/** Parses a complete number + unit expression ending at the end of `text`. */
export function parseMeasurementExpression(
  text: string,
  locale: MeasurementLocalePolicy,
): ParsedMeasurementExpression | null {
  const boundedStart = Math.max(0, text.length - MAX_EXPRESSION_LENGTH);

  for (let start = text.length - 1; start >= boundedStart; start -= 1) {
    if (
      !DIGIT.test(text[start]) &&
      !((text[start] === "+" || text[start] === "-") && DIGIT.test(text[start + 1] ?? ""))
    ) {
      continue;
    }
    if (start > 0 && /[\p{L}\p{N}_.,/\\+\-±]/u.test(text[start - 1])) {
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
    if (unitStart === text.length || !parseUnitExpression(text, unitStart)) {
      continue;
    }

    return { start, numberEnd, unitStart };
  }
  return null;
}

function readNumber(text: string, start: number, locale: MeasurementLocalePolicy): number | null {
  let index = start;
  if (text[index] === "+" || text[index] === "-") {
    index += 1;
  }
  const integerStart = index;
  while (DIGIT.test(text[index] ?? "")) {
    index += 1;
  }
  if (index === integerStart) {
    return null;
  }

  if (locale.decimalMarks.includes(text[index])) {
    index += 1;
    const fractionStart = index;
    while (DIGIT.test(text[index] ?? "")) {
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
