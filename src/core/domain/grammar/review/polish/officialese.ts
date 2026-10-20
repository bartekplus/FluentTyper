import type { Fixer } from "../../engine/reviewRules";
import { adjectiveForm } from "./lexicon";

/** "cel podróży" for each case form of "destynacja". */
const DESTINATION: Record<string, string | string[]> = {
  a: "cel podróży",
  ę: "cel podróży",
  ą: "celem podróży",
  i: ["celu podróży", "celów podróży"],
  e: "cele podróży",
  om: "celom podróży",
  ami: "celami podróży",
  ach: "celach podróży",
};

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  // "wiodący" (leading) copies English: "czołowy", "główny". Not "wiodąca do lasu", "wiódł prym".
  officialeseWiodąc: (m) => {
    const ending = m.groups!.end.toLowerCase();
    return [adjectiveForm("czołowy", ending), adjectiveForm("główny", ending)];
  },
  // "destynacja" copies English: "cel podróży". A singular after an adjective or "ta" keeps
  // its gender, so it is left alone ("ta modna destynacja").
  officialeseDestynacj: (m) => DESTINATION[m.groups!.end.toLowerCase()],
  // A genesis is already how something came to be: "geneza powstania rękopisu" -> "geneza
  // rękopisu". Not the uprisings ("geneza powstania warszawskiego", "Powstania Styczniowego").
  officialeseNoun: (m) => {
    const next = /^[ \t\u00a0]{1,8}(\p{L}+)/u.exec(m.input.slice(m.index + m[0].length))?.[1];
    const uprising =
      /^P/u.test(m.groups!.tail) ||
      /^\p{Lu}/u.test(next ?? "") ||
      (/ego$/u.test(next ?? "") && !/^(?:tego|jego|owego)$/iu.test(next!));
    return uprising ? null : m.groups!.noun;
  },
  // "Dokładnie!" as a reply copies "Exactly!": "Właśnie", "Owszem".
  officialeseDokładnie: (m) => (m.groups!.so ? ["właśnie tak", "owszem"] : ["właśnie", "owszem"]),
} satisfies Record<string, Fixer>;
