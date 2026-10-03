import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { verbReadings } from "./frenchLexicon";
import { ownedFrenchWords, tokensAfter, tokensBefore } from "./frenchTokens";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// The auxiliary a verb takes: "je suis allé" not "j'ai allé", "il a nagé" not "il est nagé",
// "il a été" not "il est été"; and "avoir raison/tort", "avoir 20 ans".

const RULE = "frenchVerbForms";
const MESSAGE = "review_msg_fr_auxiliary";

// Avoir's simple forms and être's in the same tense and person.
const AVOIR_TO_ETRE: Record<string, string> = {
  ai: "suis",
  as: "es",
  a: "est",
  avons: "sommes",
  avez: "êtes",
  ont: "sont",
  avais: "étais",
  avait: "était",
  avions: "étions",
  aviez: "étiez",
  avaient: "étaient",
  aurai: "serai",
  auras: "seras",
  aura: "sera",
  aurons: "serons",
  aurez: "serez",
  auront: "seront",
  aurais: "serais",
  aurait: "serait",
  aurions: "serions",
  auriez: "seriez",
  auraient: "seraient",
};
const ETRE_TO_AVOIR: Record<string, string> = {};
for (const [avoir, etre] of Object.entries(AVOIR_TO_ETRE))
  if (!(etre in ETRE_TO_AVOIR) && avoir !== "as") ETRE_TO_AVOIR[etre] = avoir;
ETRE_TO_AVOIR.es = "as";
// "tu es" and "il est" share no avoir form with another person: "es" -> "as", "est" -> "a".

// Verbs that only ever take être: "il est allé", never "il a allé".
const ETRE_VERBS = new Set(
  "aller venir devenir revenir parvenir survenir advenir arriver partir repartir naître mourir décéder".split(
    " ",
  ),
);
// Intransitive verbs that only take avoir and have no passive: "il a nagé", never "il est nagé".
const AVOIR_VERBS = new Set(
  "nager dormir marcher voyager travailler rire sourire pleurer dîner déjeuner tousser éternuer mentir bavarder".split(
    " ",
  ),
);
const SUBJECTS = new Set("je j' tu il elle on nous vous ils elles".split(" "));
// The agreed participle forms each subject allows after être (the masculine singular aside).
const SUBJECT_FORMS: Record<string, string[]> = {
  je: ["fs"],
  "j'": ["fs"],
  tu: ["fs"],
  elle: ["fs"],
  on: ["fs", "mp", "fp"],
  nous: ["mp", "fp"],
  vous: ["fs", "mp", "fp"],
  ils: ["mp"],
  elles: ["fp"],
};
const BETWEEN = new Set("pas plus jamais déjà encore bien toujours souvent vraiment".split(" "));

const participleOf = (word: string, lemmas: ReadonlySet<string>) =>
  verbReadings(word).some((r) => r.slot === "Q" && lemmas.has(r.lemma)) &&
  verbReadings(word).every((r) => r.slot === "Q");

function auxiliary(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 3);
  // The subject, past "ne": "je n'ai", "il ne s'est".
  let k = 0;
  if (before[k]?.w === "n'" || before[k]?.w === "ne") k++;
  const subject = before[k];
  if (!subject || !SUBJECTS.has(subject.w)) return null;
  if (ctx.text[m.index - 1] === "-" || ctx.text[m.index + typed.length] === "-") return null;
  const after = tokensAfter(ctx.text, m.index + typed.length, 4);
  let i = 0;
  while (after[i] && BETWEEN.has(after[i].w)) i++;
  const next = after[i];
  // "il est 20 ans": avoir gives an age ("il est trois ans plus jeune" compares).
  const age =
    /^[ \t]+(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante)[ \t]+ans(?![\p{L}\p{M}\p{N}_'’-])(?![ \t]+(?:plus|moins|trop|de[ \t]+(?:plus|moins|trop|retard|avance)|d['’]avance))/iu.exec(
      ctx.text.slice(m.index + typed.length, m.index + typed.length + 24),
    );
  if (!age && (!next || next.hyphen)) return null;
  const end = age ? m.index + typed.length + age[0].length : next.end;
  let fixed: string | null = null;
  if (lower in AVOIR_TO_ETRE && next && participleOf(next.w, ETRE_VERBS)) {
    // "ils avaient partie liée": an agreed form that fits no être subject here is a noun.
    const form = /es$/.test(next.w)
      ? "fp"
      : /e$/.test(next.w)
        ? "fs"
        : /s$/.test(next.w)
          ? "mp"
          : "";
    if (form && !SUBJECT_FORMS[subject.w]?.includes(form)) return null;
    fixed = AVOIR_TO_ETRE[lower];
  } else if (lower in ETRE_TO_AVOIR) {
    const etre = verbReadings(lower).some((r) => r.lemma === "être");
    if (!etre) return null;
    if (age) fixed = ETRE_TO_AVOIR[lower];
    else if (next.w === "été" && i === 0) fixed = ETRE_TO_AVOIR[lower];
    else if (participleOf(next.w, AVOIR_VERBS)) fixed = ETRE_TO_AVOIR[lower];
    // "il est tort", "elle est raison": avoir's locutions.
    else if (i === 0 && ["tort", "tord", "raison"].includes(next.w)) fixed = ETRE_TO_AVOIR[lower];
  }
  if (!fixed || ctx.dictionary.has(lower)) return null;
  // "j'ai" -> "je suis", "n'ai" -> "ne suis", "je suis" -> "j'ai": the elided word right
  // before follows the new form.
  let start = m.index;
  let replacement = carryCase(typed, fixed);
  const lead = before[0];
  const word =
    lead &&
    (lead.w === "j'" || lead.w === "je" ? "je" : lead.w === "n'" || lead.w === "ne" ? "ne" : null);
  if (lead && word && lead.end >= m.index - 1) {
    const typedLead = ctx.text.slice(lead.start, lead.end);
    const apostrophe = /’/.test(ctx.text.slice(Math.max(0, m.index - 200), m.index)) ? "’" : "'";
    const vowel = /^[aeéêio]/.test(fixed);
    const leadForm = vowel ? `${word[0]}${apostrophe}` : `${word} `;
    start = lead.start;
    const form = leadForm.trimEnd();
    const cased = /^\p{Lu}/u.test(typedLead) ? form[0].toUpperCase() + form.slice(1) : form;
    replacement = `${cased}${vowel ? "" : " "}${replacement}`;
  }
  const original = ctx.text.slice(start, m.index + typed.length);
  if (replacement === original) return null;
  return finding(RULE, MESSAGE, start, m.index + typed.length, [replacement], {
    context: { start: subject.start, end },
  });
}

const AUXILIARY = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_-])(?:${[...Object.keys(AVOIR_TO_ETRE), ...Object.keys(ETRE_TO_AVOIR)].join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "giu",
);

function auxiliaries(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, AUXILIARY)) {
    const finding = auxiliary(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: auxiliaries }];
