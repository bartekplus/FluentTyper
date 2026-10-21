// The rule library (library.ts): German conjugation. The person forms of the irregular verbs and
// the forms that fit a subject.
import {
  germanAdjective,
  germanGender as germanGenderOf,
  germanInfinitive,
  germanNounReading,
} from "../../review/german/germanLexicon";

/** Person slots: ich, du, er/sie/es, wir, ihr, sie/Sie. */
export type GermanSlot = 0 | 1 | 2 | 3 | 4 | 5;
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
/** A listed verb form: its paradigm line, its tense and its person slot. */
type GermanVerbForm = { line: string[][]; tense: number; slot: GermanSlot };
const FORMS = new Map<string, GermanVerbForm[]>();
for (const paradigm of PARADIGMS) {
  const line = paradigm.split("|").map((tense) => tense.split(" "));
  line.forEach((forms, tense) =>
    forms.forEach((form, slot) => {
      if (form === "-") return;
      const list = FORMS.get(form) ?? [];
      list.push({ line, tense, slot: slot as GermanSlot });
      FORMS.set(form, list);
    }),
  );
}
// The forms of sein, haben, werden, the modals and wissen (the first ten paradigms).
const AUXILIARIES = new Set(PARADIGMS.slice(0, 10).flatMap((p) => p.split(/[| ]/)));
// "werden" (present and subjunctive) and the modals, which take an infinitive.
const MODALS = new Set(
  PARADIGMS.slice(2, 9)
    .flatMap((p) => p.split(/[| ]/))
    .filter((w) => !/^wurde/.test(w)),
);

/** A form of sein, haben, werden, a modal or wissen ("hat", "könnte"). */
export const germanAuxiliary = (word: string) => AUXILIARIES.has(word);
/** A form of "werden" (not its past) or of a modal ("will", "würde"). */
export const germanModal = (word: string) => MODALS.has(word);
/** The listed forms of a verb form ("gibt": the third person present of "geben"). */
export const germanVerbForms = (word: string): readonly GermanVerbForm[] | undefined =>
  FORMS.get(word);
/** The infinitive of a listed verb form: "gibt" → "geben", "bin" → "sein". */
export const germanInfinitiveOf = (word: string) => {
  // The "wir" form is the infinitive, except for sein ("sind").
  const wir = FORMS.get(word)?.[0].line[0][3];
  return wir === "sind" ? "sein" : (wir ?? null);
};

// "er habe", "sie wisse": the present subjunctive of the third person is the "ich" form.
const SUBJUNCTIVE: Readonly<Record<string, string>> = { bin: "sei" };
// Strong verbs that change their vowel for "du" ("du fährst"): no regular ending is offered.
const STRONG =
  /(?:fahr|schlaf|trag|fall|halt|lass|wasch|wachs|lad|rat|brat|grab|schlag|lauf|sauf|geb|nehm|seh|les|sprech|helf|ess|treff|vergess|werf|sterb|empfehl|stehl|brech|tret|gelt|mess|befehl|fress|stoß)t$/;
// Words ending like a verb that are none: "wir selbst", "ich eben".
const NOT_VERBS = new Set(
  (
    "selbst erst sonst fast meist zuerst zuletzt längst jüngst nicht nichts jetzt bereits " +
    "stets recht eben oben unten neben gegen morgen gestern selten trotzdem allein beiden " +
    "allen einen vielen anderen"
  ).split(" "),
);
/** A word that ends like a verb form but is none ("selbst", "morgen"). */
export const germanNotVerb = (word: string) => NOT_VERBS.has(word);

/**
 * The forms of the verb of `typed` that fit the person `slots`: the listed forms of its
 * paradigm and tense, or a regular form from its ending. Null when `typed` fits, or no form is
 * known.
 */
export function germanFittingForms(typed: string, slots: readonly GermanSlot[]): string[] | null {
  const low = typed.toLowerCase();
  const forms = FORMS.get(low);
  if (forms) {
    if (forms.some((f) => slots.includes(f.slot))) return null;
    // "er habe": the subjunctive.
    if (slots.includes(2) && forms.some((f) => f.slot === 0 && f.tense === 0)) {
      if (!SUBJUNCTIVE[low]) return null;
    }
    if (low === "sei" && (slots.includes(0) || slots.includes(2))) return null;
    // "ich musst": "musste" with the last letter dropped, or the present. "ich könnt", "ich
    // wollt" may be that or "ihr könnt" mistyped, so they are left alone.
    const clipped = FORMS.get(`${low}e`)?.some((f) => slots.includes(f.slot)) ? `${low}e` : null;
    if (clipped && !low.endsWith("st")) return null;
    const out = new Set<string>(clipped ? [clipped] : []);
    for (const f of forms)
      for (const s of slots) {
        const fit = f.line[f.tense]?.[s];
        if (fit && fit !== "-") out.add(fit);
      }
    return out.size > 0 ? [...out] : null;
  }
  if (NOT_VERBS.has(low) || !/^\p{Ll}+$/u.test(low)) return null;
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

/** Whether a noun form is a plural ("Kinder", "Lehrerinnen", "Gäste"). */
export function germanPluralNoun(noun: string): boolean {
  const reading = germanGenderOf(noun);
  if (reading) return reading.gender !== "f" ? reading.plural : false;
  // "Lehrerinnen", "Frauen", "Regeln": a feminine noun's plural.
  if (/innen$/.test(noun)) return germanGenderOf(noun.slice(0, -3))?.gender === "f";
  const singular = /^(.+?)e?n$/.exec(noun)?.[1];
  if (singular && singular.length >= 3 && germanGenderOf(singular)?.gender === "f") return true;
  // "Gäste", "Bäume": an umlauted plural of a masculine noun.
  const umlaut = /^(.*)([äöü])([^aeiouäöü]*)e$/.exec(noun);
  if (!umlaut) return false;
  const base = umlaut[1] + { ä: "a", ö: "o", ü: "u" }[umlaut[2]]! + umlaut[3];
  return germanGenderOf(base)?.gender === "m";
}
/** The infinitive of a finite form that is no participle, adjective or noun: "kaufe", "habe". */
export function germanFiniteInfinitive(form: string): string | null {
  const listed = germanInfinitiveOf(form);
  if (listed) return listed;
  if (/(?:en|ern|eln)$/.test(form) || NOT_VERBS.has(form) || germanAdjective(form)) return null;
  // "gekauft", "besucht", "verkauft", "probiert", "unterstützt", "überprüft": participles.
  if (
    /^(?:ge|be|ver|er|ent|zer|emp|miss|unter|über|durch|hinter|wider)\p{Ll}+(?:t|en)$|iert$/u.test(
      form,
    )
  )
    return null;
  if (germanNounReading(form) !== null) return null;
  const stem = /^(\p{Ll}{2,}?)(?:te|e|st|t|est|et)$/u.exec(form)?.[1];
  if (!stem) return null;
  return [`${stem}en`, `${stem}n`].find((inf) => germanInfinitive(inf)) ?? null;
}
