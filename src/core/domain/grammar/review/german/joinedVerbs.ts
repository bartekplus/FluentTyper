import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { Detector } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanVerbLike } from "./germanLexicon";
import {
  BOUNDARY,
  gated,
  isGerman,
  PRONOUNS,
  tokensAfter,
  tokensBefore,
  VERB_GOVERNORS,
} from "./shared";

// A verb written apart from a first part with which it makes one verb: "zunichte gemacht"
// (zunichtegemacht), "fest genommen" (festgenommen), "schief gehen" (schiefgehen). The first
// part comes before the verb only where the verb ends its clause: a participle, an infinitive,
// a zu-infinitive or the finite verb of a subordinate clause ("wenn das schief geht"). In a
// main clause the verb comes first ("Das geht schief"), and nothing is joined.

// The forms of the strong and irregular verbs below that a stem does not give (authored).
const IRREGULAR: Readonly<Record<string, string>> = {
  nehmen: "nimmt nimmst nahm nahmen genommen",
  lassen: "lässt ließ ließen gelassen",
  sehen: "sieht siehst sah sahen gesehen",
  schreiben: "schrieb schrieben geschrieben",
  gehen: "ging gingen gegangen",
  laufen: "läuft lief liefen gelaufen",
  geben: "gibt gibst gab gaben gegeben",
  halten: "hält hielt hielten gehalten",
  treten: "tritt trat traten getreten",
  stehen: "stand standen gestanden",
  sprechen: "spricht sprach sprachen gesprochen",
  heißen: "hieß hießen geheißen",
  fallen: "fällt fiel fielen gefallen",
  tun: "tue tust tut tat taten getan",
  haben: "habe hast hat habt hatte hatten gehabt",
  kommen: "kam kamen gekommen",
  werden: "wird wurde wurden geworden",
  fahren: "fährt fuhr fuhren gefahren",
  ziehen: "zog zogen gezogen",
  bringen: "brachte brachten gebracht",
  schließen: "schloss schlossen geschlossen",
  sitzen: "saß saßen gesessen",
  wohnen: "",
};

// First parts that never stand alone, with their verbs (germanCompounds, on by default).
const BOUND: Readonly<Record<string, string>> = {
  zunichte: "machen werden",
  inne: "haben halten wohnen werden",
  zuteil: "werden",
  vonstatten: "gehen",
  zugute: "kommen halten",
  preis: "geben",
};
// Adjectives and adverbs that make one verb of one meaning with these verbs (germanJoinedVerbs,
// opt-in). "zusammen", "wohl", "frei" and "gut schreiben" are left out: both readings are common.
const OPEN: Readonly<Record<string, string>> = {
  fest: "nehmen legen stellen halten setzen schreiben machen fahren",
  klar: "machen stellen kommen",
  // "den Sekt kalt stellen" is literal.
  kalt: "lassen",
  krank: "schreiben melden",
  hoch: "gehen rechnen laden stufen",
  groß: "schreiben ziehen",
  klein: "schreiben reden",
  schwarz: "sehen arbeiten fahren",
  rot: "sehen",
  schief: "gehen laufen",
  glatt: "gehen",
  zufrieden: "lassen geben stellen",
  allein: "lassen",
  satt: "haben",
  gut: "tun heißen",
  heilig: "sprechen",
  kürzer: "treten",
  schwer: "fallen tun",
  sicher: "stellen",
  kurz: "fassen schließen",
  nahe: "stehen treten legen bringen gehen",
  // "wieder gut machen", "wieder gutmachen": wiedergutmachen.
  wiedergut: "machen",
  wieder: "gutmachen",
};

type Kind = "infinitive" | "finite" | "participle" | "attribute";
/** The forms of an infinitive, each with its kind: "machen" → "macht" (finite), "gemacht". */
function verbForms(infinitive: string): Map<string, Kind> {
  const forms = new Map<string, Kind>([[infinitive, "infinitive"]]);
  const irregular = IRREGULAR[infinitive];
  const stem = infinitive.replace(/e?n$/, "");
  const e = /[td]$/.test(stem) ? "e" : "";
  const participles =
    irregular === undefined || irregular === ""
      ? [`ge${stem}${e}t`]
      : irregular.split(" ").filter((f) => f.startsWith("ge"));
  if (irregular === undefined || irregular === "") {
    for (const end of ["e", "st", "t", "te", "ten", "test"])
      forms.set(stem + (end === "e" ? "" : e) + end, "finite");
  } else {
    for (const form of irregular.split(" ")) if (!form.startsWith("ge")) forms.set(form, "finite");
    forms.set(`${stem}e`, "finite");
  }
  for (const p of participles) {
    forms.set(p, "participle");
    for (const end of ["e", "en", "er", "es", "em"]) forms.set(p + end, "attribute");
  }
  return forms;
}

const tables = (table: Readonly<Record<string, string>>) =>
  new Map(
    Object.entries(table).map(([first, verbs]) => {
      const forms = new Map<string, Kind>();
      for (const verb of verbs.split(" ")) for (const [f, k] of verbForms(verb)) forms.set(f, k);
      return [first, forms];
    }),
  );
let bound: Map<string, Map<string, Kind>> | undefined;
let open: Map<string, Map<string, Kind>> | undefined;

// Words before the first part that make it a plain adverb: "genauso gut tun", "zu nahe treten".
const DEGREE = /^(?:zu|allzu|so|genauso|ebenso|ganz|besonders|ziemlich|recht|wie|eher)$/;

const OPEN_FRAME = gated(
  `(?<first>wieder${SPACE}gut|${Object.keys(OPEN)
    .filter((first) => first !== "wiedergut")
    .join("|")})(?<zu>${SPACE}zu)?${SPACE}(?<verb>\\p{Ll}+)${WORD_END}`,
);
// "zu teil", "von statten", "zu Pass(e)": a bound first part written as two words.
const BOUND_FRAME = gated(
  `(?<first>${Object.keys(BOUND).join("|")}|zu${SPACE}teil|von${SPACE}statten|Preis)(?:(?<zu>${SPACE}zu)?${SPACE}(?<verb>\\p{Ll}+))?${WORD_END}`,
);
const ZU_PASS = gated(
  `(?<first>zu${SPACE}Passe?|zupasse?)(?:${SPACE}(?<verb>\\p{Ll}+))?${WORD_END}`,
);
const KOMMEN = /^(?:kommen|kommt|kam|kamen|käme|kämen|gekommen)$/;

/** Whether the clause goes on after a verb form of this kind. */
function closes(kind: Kind, after: string[]): boolean {
  const next = after[0] ?? "";
  if (kind === "attribute") return /^\p{Lu}/u.test(next);
  if (BOUNDARY.test(next) || next === "und" || next === "oder") return true;
  // "zufrieden lassen sie": the finite verb of a main clause, then its subject.
  if (kind === "finite" || PRONOUNS.has(next)) return false;
  return VERB_GOVERNORS.has(next) || germanVerbLike(next);
}

function joined(
  ctx: DetectContext,
  pattern: RegExp,
  table: Map<string, Map<string, Kind>>,
  ruleId: "germanCompounds" | "germanJoinedVerbs",
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, pattern, "first")) {
    const typed = m.groups!.first;
    const first = typed.replace(/[ \t ]+/g, "").toLowerCase();
    const { zu, verb } = m.groups!;
    const [start] = m.indices!.groups!.first;
    const end = m.index + m[0].length;
    const before = tokensBefore(ctx.text, start, 6);
    const prior = (before.at(-1) ?? "").toLowerCase();
    if (DEGREE.test(prior)) continue;
    const after = tokensAfter(ctx.text, end, 2);
    const forms = table.get(first);
    const kind = verb ? forms?.get(verb) : undefined;
    // "Preis" is a noun after a determiner or an adjective ("einen hohen Preis geben").
    if (
      typed === "Preis" &&
      !/^(?:nicht|nie|es|sich|alles|nichts|kaum|nur|gern|gerne|sofort)$/.test(prior)
    )
      continue;
    if (!kind || (zu && kind !== "infinitive")) {
      // "zu teil.", "von statten", "Er gab es nicht Preis.": the bound part alone, at the end.
      if (ruleId !== "germanCompounds" || verb) continue;
      if (!BOUNDARY.test(after[0] ?? "")) continue;
      if (first === "preis" && !before.some((t) => /^(?:gab|gibt|gaben|gebe|gibst)$/.test(t)))
        continue;
      if (!/[ \t]|^Preis$/.test(typed)) continue;
      findings.push(finding(ruleId, start, start + typed.length, first));
      continue;
    }
    // "preis geben", "zugute kommen": the infinitive frame of compounds.ts joins these.
    if (kind === "infinitive" && (typed === "preis" || typed === "zugute")) continue;
    if (!closes(kind, after)) continue;
    findings.push(finding(ruleId, start, end, `${first}${zu ? "zu" : ""}${verb}`));
  }
  return findings;
}

const finding = (
  ruleId: "germanCompounds" | "germanJoinedVerbs",
  start: number,
  end: number,
  fix: string,
): RawFinding => ({
  ruleId,
  messageKey: "review_msg_closed_compound",
  range: { start, end },
  alternatives: [fix],
  context: { start: Math.max(0, start - 40), end: end + 20 },
});

/** "zu Pass kam", "kam ihm zu Pass": "zupass" next to a form of "kommen". */
function zuPass(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ZU_PASS, "first")) {
    const typed = m.groups!.first;
    const verb = m.groups!.verb ?? "";
    const [start] = m.indices!.groups!.first;
    const near = KOMMEN.test(verb) || tokensBefore(ctx.text, start, 4).some((t) => KOMMEN.test(t));
    if (!near || (!/[ \t]/.test(typed) && !KOMMEN.test(verb))) continue;
    const fix = `zupass${KOMMEN.test(verb) ? verb : ""}`;
    findings.push(
      finding(
        "germanCompounds",
        start,
        KOMMEN.test(verb) ? m.index + m[0].length : start + typed.length,
        fix,
      ),
    );
  }
  return findings;
}

/** Bound first parts written apart (germanCompounds). */
export function boundVerbs(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  bound ??= tables(BOUND);
  return [...joined(ctx, BOUND_FRAME, bound, "germanCompounds"), ...zuPass(ctx)];
}

export const PREDICATES = {
  joinedVerbs: (ctx) => {
    if (!isGerman(ctx)) return [];
    open ??= tables(OPEN);
    return joined(ctx, OPEN_FRAME, open, "germanJoinedVerbs");
  },
} satisfies Record<string, Detector>;
