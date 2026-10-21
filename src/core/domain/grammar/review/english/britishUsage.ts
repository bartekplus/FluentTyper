import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";

const UNITS: Record<string, string> = {
  meter: "metre",
  meters: "metres",
  liter: "litre",
  liters: "litres",
};

/** A boot named nearby makes the trunk the luggage in it. */
const boot = (m: RegExpExecArray, ctx: DetectContext) => {
  const sentence = ctx.text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
  if (/\bboots?\b/i.test(sentence)) return null;
  return m.groups!.target.toLowerCase() === "trunks" ? "boots" : "boot";
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "a 10-meter rope", "5 kilometers away", "2 liters of milk": a number before the unit.
  britishUsageKilo: (m) => {
    const typed = m.groups!.target.toLowerCase();
    const unit = Object.keys(UNITS).find((key) => typed.endsWith(key))!;
    return typed.slice(0, typed.length - unit.length) + UNITS[unit];
  },
  // "the car has a small trunk", "trunks on some cars": a car's boot, not a travel chest.
  britishUsageTrunks: boot,
  britishUsageTrunks2: boot,
} satisfies Record<string, Fixer>;
