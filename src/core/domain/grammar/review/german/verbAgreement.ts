import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive } from "./germanLexicon";
import { englishLine, isGerman, tokensAfter, tokensBefore, words, wordSet } from "./shared";

// A pronoun subject and a finite verb that does not fit it: "wir habe" (haben), "du kann"
// (kannst), "Sollte wir" (Sollten), "ich hast" (habe), "ihr fragst" (fragt). Auxiliaries,
// modals and common irregular verbs are listed in full; a regular verb only where its ending
// belongs to one person alone ("ihr fragst", "ich sagen").

// Person slots: ich, du, er/sie/es, wir, ihr, sie/Sie.
type Slot = 0 | 1 | 2 | 3 | 4 | 5;
// Each line: present, past and past subjunctive, six forms each ("-" where none).
const PARADIGMS = [
  "bin bist ist sind seid sind|war warst war waren wart waren|wäre wärst wäre wären wärt wären",
  "habe hast hat haben habt haben|hatte hattest hatte hatten hattet hatten|hätte hättest hätte hätten hättet hätten",
  "werde wirst wird werden werdet werden|wurde wurdest wurde wurden wurdet wurden|würde würdest würde würden würdet würden",
  "kann kannst kann können könnt können|konnte konntest konnte konnten konntet konnten|könnte könntest könnte könnten könntet könnten",
  "muss musst muss müssen müsst müssen|musste musstest musste mussten musstet mussten|müsste müsstest müsste müssten müsstet müssten",
  "soll sollst soll sollen sollt sollen|sollte solltest sollte sollten solltet sollten",
  "will willst will wollen wollt wollen|wollte wolltest wollte wollten wolltet wollten",
  "darf darfst darf dürfen dürft dürfen|durfte durftest durfte durften durftet durften|dürfte dürftest dürfte dürften dürftet dürften",
  "mag magst mag mögen mögt mögen|mochte mochtest mochte mochten mochtet mochten|möchte möchtest möchte möchten möchtet möchten",
  "weiß weißt weiß wissen wisst wissen|wusste wusstest wusste wussten wusstet wussten",
  "laufe läufst läuft laufen lauft laufen",
  "fahre fährst fährt fahren fahrt fahren",
  "gebe gibst gibt geben gebt geben",
  "nehme nimmst nimmt nehmen nehmt nehmen",
  "sehe siehst sieht sehen seht sehen",
  "lese liest liest lesen lest lesen",
  "spreche sprichst spricht sprechen sprecht sprechen",
  "helfe hilfst hilft helfen helft helfen",
  "esse isst isst essen esst essen",
  "schlafe schläfst schläft schlafen schlaft schlafen",
  "trage trägst trägt tragen tragt tragen",
  "halte hältst hält halten haltet halten",
  "lasse lässt lässt lassen lasst lassen|ließ ließt ließ ließen ließt ließen",
  "gehe gehst geht gehen geht gehen|ging gingst ging gingen gingt gingen",
  "komme kommst kommt kommen kommt kommen|kam kamst kam kamen kamt kamen",
];
type Form = { line: string[][]; tense: number; slot: Slot };
const FORMS = new Map<string, Form[]>();
for (const paradigm of PARADIGMS) {
  const line = paradigm.split("|").map((tense) => tense.split(" "));
  line.forEach((forms, tense) =>
    forms.forEach((form, slot) => {
      if (form === "-") return;
      const list = FORMS.get(form) ?? [];
      list.push({ line, tense, slot: slot as Slot });
      FORMS.set(form, list);
    }),
  );
}
// "er habe", "sie wisse": the present subjunctive of the third person is the "ich" form.
const SUBJUNCTIVE: Readonly<Record<string, string>> = { bin: "sei" };
// Imperatives that a "du" may follow: "Sei du still", "Lies du vor".
const IMPERATIVES = wordSet(
  "sei hab habe werd werde tu tue lauf laufe fahr fahre gib nimm sieh lies sprich hilf iss " +
    "schlaf schlafe trag trage halt halte lass lasse geh gehe komm komme wisse",
);
// Pronoun subjects and the persons they take. "sie" is she or they; "es" also takes a
// plural ("es sind viele"); "sie", "es" and "ihr" may also be objects ("Ihr habe ich …").
const SUBJECT_SLOTS: Readonly<Record<string, readonly Slot[]>> = {
  ich: [0],
  du: [1],
  er: [2],
  es: [2, 5],
  man: [2],
  sie: [2, 5],
  wir: [3],
  ihr: [4],
};
const OBJECT_TOO = wordSet("sie es ihr");
const SUBJECTS = wordSet("ich du er sie es man wir ihr Sie");
// "Ich denke, wir habe …": a main clause after an opinion verb and its comma.
const OPINION = /^(?:glaube|denke|hoffe|finde|meine|weiß|schätze|vermute|befürchte|wette)$/;
// Strong verbs that change their vowel for "du" ("du fährst"): no regular ending is offered.
const STRONG =
  /(?:fahr|schlaf|trag|fall|halt|lass|wasch|wachs|lad|rat|brat|grab|schlag|lauf|sauf|geb|nehm|seh|les|sprech|helf|ess|treff|vergess|werf|sterb|empfehl|stehl|brech|tret|gelt|mess|befehl|fress|stoß)t$/;
// Words ending like a verb that are none: "wir selbst", "ich eben".
const NOT_VERBS = wordSet(
  "selbst erst sonst fast meist zuerst zuletzt längst jüngst nicht nichts jetzt bereits " +
    "stets recht eben oben unten neben gegen morgen gestern selten trotzdem allein beiden " +
    "allen einen vielen anderen",
);

const tokenEnd = /^(?:[.!?:;]|\n)$/;

/** Forms of the verb in `form`'s paradigm and tense that fit `slots`, or a regular guess. */
function fitting(typed: string, slots: readonly Slot[]): string[] | null {
  const low = typed.toLowerCase();
  const forms = FORMS.get(low);
  // "ich wart hier" (warte), "seid du nicht da bist" (seit): another word.
  if (low === "wart" || low === "seid") return null;
  if (forms) {
    if (forms.some((f) => slots.includes(f.slot))) return null;
    // "er habe": the subjunctive.
    if (slots.includes(2) && forms.some((f) => f.slot === 0 && f.tense === 0)) {
      if (!SUBJUNCTIVE[low]) return null;
    }
    if (low === "sei" && (slots.includes(0) || slots.includes(2))) return null;
    // "ich könnt", "ich wollt": "könnte", "wollte" with the last letter dropped.
    if (FORMS.get(`${low}e`)?.some((f) => slots.includes(f.slot))) return null;
    // "er weißt auf … hin": "weist" (weisen) as much as "weiß".
    if (low === "weißt" && slots.includes(2)) return ["weiß", "weist"];
    const out = new Set<string>();
    for (const f of forms)
      for (const s of slots) {
        const fit = f.line[f.tense]?.[s];
        if (fit && fit !== "-") out.add(fit);
      }
    return out.size > 0 ? [...out] : null;
  }
  if (NOT_VERBS.has(low) || !/^\p{Ll}+$/u.test(low)) return null;
  // "er lies den Boden machen": "ließ", not the imperative of "lesen".
  if (low === "lies" && (slots.includes(0) || slots.includes(2))) return ["ließ"];
  // "ihr fragst", "wir sagst", "ich machst": the "du" ending on another person.
  // A stem in -t or -d keeps an -e- ("wartest", "wartet").
  const du = /^(.+[^sßzxt])st$/u.exec(low);
  const dental = /^(.+[td])est$/u.exec(low);
  const stem =
    du && germanInfinitive(`${du[1]}en`)
      ? du[1]
      : dental && germanInfinitive(`${dental[1]}en`)
        ? dental[1]
        : null;
  if (stem && !slots.includes(1)) {
    const t = /[td]$/.test(stem) ? "et" : "t";
    const out = slots.map(
      (s) => [`${stem}e`, "", `${stem}${t}`, `${stem}en`, `${stem}${t}`, `${stem}en`][s],
    );
    return [...new Set(out)];
  }
  // "du macht": the third person's ending after "du".
  const third = /^(.+[^sßzxtd])t$/u.exec(low);
  if (third && slots.length === 1 && slots[0] === 1 && !STRONG.test(low)) {
    if (germanInfinitive(`${third[1]}en`) && !/(?:te|et)$/.test(third[1])) return [`${third[1]}st`];
  }
  // "Ich sagen das": an infinitive after "ich".
  if (slots.length === 1 && slots[0] === 0 && /en$/.test(low) && germanInfinitive(low)) {
    return [`${low.slice(0, -1)}`];
  }
  return null;
}

function finding(start: number, typed: string, fits: string[], context: [number, number]) {
  const cased = fits.map((f) => (/^\p{Lu}/u.test(typed) ? f[0].toUpperCase() + f.slice(1) : f));
  return {
    ruleId: "germanVerbAgreement",
    messageKey: "review_msg_german_verb_agreement",
    range: { start, end: start + typed.length },
    alternatives: cased,
    context: { start: context[0], end: context[1] },
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
  } satisfies RawFinding;
}

function verbAgreement(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of words(ctx)) {
    const typed = m[0];
    const low = typed.toLowerCase();
    const slots = SUBJECT_SLOTS[low];
    if (!slots) continue;
    const at = m.index;
    const end = at + typed.length;
    const before = tokensBefore(ctx.text, at, 4);
    const after = tokensAfter(ctx.text, end, 3);
    // "du und ich sind", "ich, der …": a coordinated subject or an apposition.
    if (/^(?:und|oder|sowie|bzw|,|&|\/|-)$/.test(after[0] ?? "")) continue;
    if (englishLine(ctx.text, at) || namedExampleBefore(ctx.text, at)) continue;
    const prior = before.at(-1);
    const sentenceStart = prior === undefined || tokenEnd.test(prior) || /^[„“"»«]$/.test(prior);
    const afterOpinion = prior === "," && OPINION.test(before.at(-2) ?? "");
    // "Wir sollte heute gehen": the subject opens the sentence, the verb follows; "Sie hast
    // du gesehen": an object before the verb and its subject.
    const verb = after[0];
    if (
      (sentenceStart || afterOpinion) &&
      verb &&
      /^\p{Ll}/u.test(verb) &&
      !SUBJECTS.has(after[1] ?? "") &&
      !/^['’]$/.test(after[1] ?? "")
    ) {
      // "es läuft": the plural fits "es" only before a plural subject ("es kamen viele").
      const fits = fitting(verb, slots)?.slice(0, low === "es" ? 1 : undefined);
      if (fits) {
        const start = ctx.text.indexOf(verb, end);
        findings.push(finding(start, verb, fits, [at, start + verb.length]));
        continue;
      }
    }
    // "Sollte wir uns kümmern?", "Bei Jan habe wir": the verb before its subject.
    if (OBJECT_TOO.has(low) || !prior || !/^\p{L}+$/u.test(prior)) continue;
    if (typed !== low && !sentenceStart) continue;
    if (!FORMS.has(prior.toLowerCase())) continue;
    if (low === "du" && IMPERATIVES.has(prior.toLowerCase())) continue;
    // "Ich weiß du magst …": the verb has its own subject; a new clause starts at "du".
    if (SUBJECTS.has(before.at(-2) ?? "") || SUBJECTS.has(before.at(-2)?.toLowerCase() ?? ""))
      continue;
    const fits = fitting(prior, slots);
    if (!fits) continue;
    const start = ctx.text.lastIndexOf(prior, at);
    findings.push(finding(start, prior, fits, [start, end]));
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanVerbAgreement"], detect: verbAgreement },
];
