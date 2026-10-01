import { VERB_HOMOGRAPHS, VERB_LEMMAS, VERB_RULES } from "./frenchLexicon.generated";

/** Subject persons as bits: je, tu, il/elle/on, nous, vous, ils/elles. */
export const JE = 1;
export const TU = 2;
export const IL = 4;
export const NOUS = 8;
export const VOUS = 16;
export const ILS = 32;

/** A person bitmask for a finite form; I infinitive, G present participle, Q past participle. */
export type VerbSlot = number | "I" | "G" | "Q";

export interface VerbReading {
  lemma: string;
  slot: VerbSlot;
  /** The rule's flag and tense position, to conjugate the same tense for another person. */
  flag: string;
  tense: number;
}

type Rule = { strip: string; add: string; cond: RegExp; slot: VerbSlot; tense: number };

let rulesByFlag: Map<string, Rule[]> | null = null;
let rulesByEnding: Map<string, Array<Rule & { flag: string }>> | null = null;
let lemmaFlags: Map<string, readonly string[]> | null = null;
let homographs: Set<string> | null = null;

const lowest = (mask: number) => mask & -mask;

function decodeFrontCoded(text: string): string[] {
  let previous = "";
  return text
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      previous = previous.slice(0, parseInt(token[0], 36)) + token.slice(1);
      return previous;
    });
}

function load() {
  if (rulesByFlag) return;
  rulesByFlag = new Map();
  rulesByEnding = new Map();
  let flag = "";
  let common: [string, string] = ["", ""];
  let tense = 0;
  let previous: VerbSlot = "I";
  for (const line of VERB_RULES.split("\n")) {
    const parts = line.split(" ");
    if (line.startsWith("@")) {
      flag = parts[0].slice(1);
      common = [parts[1], parts[2]];
      tense = 0;
      previous = "I";
      rulesByFlag.set(flag, []);
      continue;
    }
    const [add, rawSlot] = parts;
    const [strip, cond] =
      parts.length > 2 ? [parts[2], parts.length > 3 ? parts[3] : parts[2]] : common;
    const slot: VerbSlot = /^\d+$/.test(rawSlot) ? Number(rawSlot) : (rawSlot as VerbSlot);
    // A tense runs je -> ils; a finite rule whose first person is not after the previous rule's
    // starts the next one (variants of one slot share its mask).
    if (typeof slot === "number") {
      if (typeof previous !== "number" || (slot !== previous && lowest(slot) <= lowest(previous)))
        tense++;
    }
    previous = slot;
    const rule = { strip, add, cond: new RegExp(`${cond}$`), slot, tense };
    rulesByFlag.get(flag)!.push(rule);
    const key = add.slice(-1);
    rulesByEnding.set(key, [...(rulesByEnding.get(key) ?? []), { ...rule, flag }]);
  }
  lemmaFlags = new Map();
  for (const line of VERB_LEMMAS.split("\n")) {
    const [flags, ending, ...rest] = line.split(" ");
    const list = flags.match(/../g) ?? [];
    for (const stem of decodeFrontCoded(rest.join(" "))) lemmaFlags.set(stem + ending, list);
  }
  homographs = new Set(decodeFrontCoded(VERB_HOMOGRAPHS));
}

/** Every verb reading of a lowercase word form, from the bundled dictionary's conjugations. */
export function verbReadings(word: string): VerbReading[] {
  load();
  const out: VerbReading[] = [];
  for (const key of [word.slice(-1), ""]) {
    for (const rule of rulesByEnding!.get(key) ?? []) {
      if (!word.endsWith(rule.add)) continue;
      const lemma = word.slice(0, word.length - rule.add.length) + rule.strip;
      if (!rule.cond.test(lemma) || !lemmaFlags!.get(lemma)?.includes(rule.flag)) continue;
      out.push({ lemma, slot: rule.slot, flag: rule.flag, tense: rule.tense });
    }
  }
  return out;
}

/** The persons a word can agree with as a finite verb (0 when it is not one). */
export function finitePersons(word: string): number {
  let mask = 0;
  for (const { slot } of verbReadings(word)) if (typeof slot === "number") mask |= slot;
  return mask;
}

/** The lemma's forms in a reading's tense for a person. */
export function conjugate(reading: VerbReading, person: number): string[] {
  load();
  const forms = new Set<string>();
  for (const rule of rulesByFlag!.get(reading.flag) ?? []) {
    if (rule.tense !== reading.tense || typeof rule.slot !== "number" || !(rule.slot & person))
      continue;
    if (!rule.cond.test(reading.lemma) || !reading.lemma.endsWith(rule.strip)) continue;
    forms.add(reading.lemma.slice(0, reading.lemma.length - rule.strip.length) + rule.add);
  }
  return [...forms];
}

/** Whether the lemma is a dictionary verb. */
export function isVerbLemma(lemma: string): boolean {
  load();
  return lemmaFlags!.has(lemma);
}

/** A verb form that is also spelled by a non-verb entry: "porte", "passé", "dîner". */
export function isVerbHomograph(word: string): boolean {
  load();
  return homographs!.has(word);
}
