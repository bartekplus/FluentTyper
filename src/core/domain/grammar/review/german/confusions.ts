import type { Fixer } from "../../engine/reviewRules";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import {
  deumlaut,
  germanAdjective,
  germanGender,
  germanInfinitive,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import { determinerFits } from "./articleGender";
import { VERB_GOVERNORS } from "./shared";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// ci and any take either case of the first letter only: "\p{Lu}" in a frame keeps meaning a capital.

// Adjectives that comment on a "dass" clause after them: "Schön, dass du da bist".
const THAT_ADJECTIVES = new Set(
  (
    "gut schön super toll schade klasse prima wichtig komisch seltsam klar logisch " +
    "merkwürdig erstaunlich interessant traurig spannend praktisch blöd ärgerlich"
  ).split(" "),
);

// Adjectives with a dative object, which "mir" may open as an attribute (authored).
const DATIVE_ADJECTIVES =
  /(?:bekannt|vertraut|fremd|lieb|wichtig|verfügbar|zugänglich|nah|ähnlich|treu|dankbar|egal|bewusst|verständlich|peinlich|unheimlich|angenehm|unangenehm|zugetan|gewogen|überlegen|unterlegen|gleich|teuer|wert|zugeteilt|zugewiesen|anvertraut|geschenkt|gegeben|empfohlen)$/;

// A ship earlier in the clause, up to 60 characters before the word.
const SHIP_BEFORE = new RegExp(
  `(?:Schiff|Schiffe|Boot|Boote|U-Boot|Ölplattform|Armada|Flotte|Fregatte|Kreuzer|Tanker|Frachter|Zerstörer|Kriegsschiff)${E}[^.!?;\\n]{0,60}${S}$`,
  "u",
);

// Machines and vehicles one starts (authored).
const STARTED_THINGS =
  /(?<!\p{L})(?:Motor|Motoren|Auto|Autos|Wagen|Maschine|Maschinen|Rechner|Computer|PC|Laptop|Server|Generator|Fahrzeug|Fahrzeuge|Motorrad|Roller|Traktor|Rasenmäher|Triebwerk|Triebwerke|Turbine|Anlage|Aggregat|Kettensäge|Programm|Gerät|Geräte|Boot|Lkw|Bus)(?!\p{L})/u;

// Countries and regions named with their article: "die Türkei", "der Vatikan", "die USA".
const COUNTRIES: Readonly<Record<string, "f" | "m" | "p" | "i">> = {
  Türkei: "f",
  Schweiz: "f",
  Ukraine: "f",
  Slowakei: "f",
  Mongolei: "f",
  Tschechei: "f",
  Vatikan: "m",
  Jemen: "m",
  Libanon: "m",
  Sudan: "m",
  Tschad: "m",
  Kongo: "m",
  Niederlande: "p",
  USA: "p",
  VAE: "p",
  Bahamas: "i",
  Malediven: "i",
  Seychellen: "i",
  Philippinen: "i",
};
/** The preposition and article a country needs after "aus", "in", "nach" or "von". */
function withArticle(prep: string, country: string): string[] | null {
  const kind = COUNTRIES[country];
  const p = prep.toLowerCase();
  const into = { f: "in die", m: "in den", p: "in die", i: "auf die" }[kind];
  const at = { f: "in der", m: "im", p: "in den", i: "auf den" }[kind];
  const from = { f: "aus der", m: "aus dem", p: "aus den", i: "von den" }[kind];
  const of = { f: "von der", m: "vom", p: "von den", i: "von den" }[kind];
  const forms = p === "aus" ? [from] : p === "nach" ? [into] : p === "von" ? [of] : [at, into];
  return forms.map((f) => `${f} ${country}`);
}
const SEIN_FOR: Readonly<Record<string, string>> = {
  hat: "ist",
  hast: "bist",
  haben: "sind",
  habt: "seid",
  hatte: "war",
  hatten: "waren",
  hattest: "warst",
  hätte: "wäre",
  hätten: "wären",
};

/** A clause with its finite verb last and none before: "dem Mann ein Zahn fehlt". */
function subjectClause(clause: string): boolean {
  const tokens = clause.trim().split(/\s+/);
  const last = tokens.at(-1) ?? "";
  if (tokens.slice(0, -1).some((t) => isAuxiliary(t))) return false;
  if (isAuxiliary(last)) return true;
  const stem = /^(\p{Ll}+?)(?:e|t|et|en|te|ten)$/u.exec(last)?.[1];
  return !!stem && germanInfinitive(`${stem}en`);
}

// Adverbs after "da" + preposition that show the pronominal adverb: "da nach nicht" (danach).
/** A verb form: listed, regular present or past of a known verb, or a strong past. */
function verbForm(word: string): boolean {
  if (germanVerbLike(word) || isAuxiliary(word) || germanInfinitiveOf(word)) return true;
  if (germanPastInfinitives(word).length > 0) return true;
  const stem = /^(\p{Ll}{2,}?)(?:e|st|t|est|et|te|ten|test|tet)$/u.exec(word)?.[1];
  return !!stem && (germanInfinitive(`${stem}en`) || germanInfinitive(`${stem}n`));
}
const DA_ADVERBS = new Set(
  "nicht auch noch schon gar kaum nie nur immer sofort bitte doch ja selbst wohl eben erst bald".split(
    " ",
  ),
);
const DECONTRACTED: Readonly<Record<string, string>> = {
  zum: "zu",
  zur: "zu",
  am: "an",
  ans: "an",
  ins: "in",
  im: "in",
  vom: "von",
  beim: "bei",
  aufs: "auf",
  fürs: "für",
  übers: "über",
  ums: "um",
  durchs: "durch",
};

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = {
  deSs: (m) => (m.groups!.target[0] === "S" ? "Seit" : "seit"),
  deDas: (m) => {
    if (!m.groups!.t2) return "dass";
    // "sagt das die Startseite zur Zeit": no verb at the end, so "das" is the object.
    const rest = m.input.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const clause = rest.split(/[.,;:!?()\n]/)[0].trim();
    return /(?:^|\s)\p{Ll}\p{L}*$/u.test(clause) ? `${m.groups!.verb}, dass` : null;
  },
  deDas2: (m) => (subjectClause(m.groups!.clause) ? "Dass" : null),
  deAdj: (m) => `${m.groups!.adj}, dass`,
  deHead: (m) => {
    const { head, next, rest } = m.groups!;
    // "das Menschen", "das Autos": a plural form of a known noun, or a masculine or feminine.
    const noun = germanGender(next);
    const pluralForm =
      (!noun || noun.plural) &&
      ["en", "n", "e", "er", "s"].some(
        (end) =>
          next.endsWith(end) &&
          next.length - end.length >= 3 &&
          germanGender(next.slice(0, -end.length)) !== null,
      );
    if (!pluralForm && (!noun || noun.gender === "n" || noun.gender === "x")) return null;
    // The clause needs a verb at its end: "toll das Menschen helfen".
    const last = /\p{Ll}+$/u.exec(rest)![0];
    if (
      ![germanVerbLike, germanInfinitive, isAuxiliary].some((f) => f(last)) &&
      !/\p{Ll}{2}t$/u.test(last)
    )
      return null;
    const before = m.input.slice(Math.max(0, m.index - 40), m.index);
    if (THAT_ADJECTIVES.has(head.toLowerCase())) {
      // "Wirklich toll das …", "Das ist super das …": a predicative adjective.
      const adjective = /^\p{Ll}/u.test(head) || /(?:^|[.!?\n])[ \t]*$/u.test(before);
      const placed =
        /(?:^|[.!?\n])[ \t]*(?:(?:sehr|wirklich|echt|ganz|so)[ \t]+)?$|(?:ist|war|wäre|finde|fand)[ \t]+(?:(?:sehr|wirklich|echt|ganz|so|doch|ja)[ \t]+)?$/iu.test(
          before,
        );
      return adjective && placed ? `${head}, dass` : null;
    }
    // "den Hinweis das …": a masculine or feminine noun "das" cannot refer back to.
    const own = germanGender(head);
    if (!own || own.gender === "n" || own.gender === "x" || own.plural) return null;
    if (
      !/(?<!\p{L})(?:d(?:er|ie|en|em)|k?eine[mnr]?|(?:mein|dein|sein|ihr|unser)e[mnr]?)[ \t]+$/iu.test(
        before,
      )
    )
      return null;
    return `${head}, dass`;
  },
  deWider: (m) =>
    /(?<!\p{L})(?:spiegel|hall|kling|klang|schein|schien)\p{Ll}*[^.!?;\n]*$/u.test(
      m.input.slice(Math.max(0, m.index - 80), m.index),
    )
      ? null
      : "wieder",
  deDen: (m) => (germanAdjective(m.groups!.verb.replace(/e?n$/, "")) ? null : "Denn"),
  deSchon: (m) => m.groups!.target.replace("schon", "schön"),
  deSeien: (m) => (m.groups!.noun ? "seinen" : "sein"),
  dePrep: (m) => withArticle(m.groups!.prep, m.groups!.country),
  deHh: (m) => {
    const typed = m.groups!.target.toLowerCase();
    // Words in between that change the structure: an infinitive's "zu", another verb.
    const rest = m.input
      .slice(m.index + m[0].length, m.index + m[0].length + 80)
      .split(/[.,;:!?]/)[0];
    if (
      /(?<!\p{L})(?:zu|lassen|sehen|hören|worden|wird|werden|und|oder|aber|sondern|bin|bist|ist|sind|seid|war|waren|wäre|sei)(?!\p{L})/u.test(
        rest,
      )
    )
      return null;
    if (/(?<!\p{L})zu\s+$/u.test(m.input.slice(Math.max(0, m.index - 4), m.index))) return null;
    // "nachdem ich angefangen habe in …": the end of the clause before (missing comma).
    if (/(?<!\p{L})\p{Ll}{4,}(?:en|t)\s+$/u.test(m.input.slice(Math.max(0, m.index - 20), m.index)))
      return null;
    if (typed !== "habe") return SEIN_FOR[typed];
    // "Ich habe … angekommen" → bin; reported speech "Er habe … " → sei.
    const before = m.input.slice(Math.max(0, m.index - 6), m.index);
    return /(?<!\p{L})ich\s*$/iu.test(before) || /^\s+ich(?!\p{L})/iu.test(rest) ? "bin" : "sei";
  },
  deEign: (m) => m.groups!.target.replace(/^eign/, "eigen"),
  deKamm: (m) =>
    /^(?:der|den|dem|des|einen|einem|eines|ein|kein|mein|dein|sein)$/i.test(m.groups!.noun)
      ? null
      : ["kann", "kam"],
  deWie: (m) => {
    const word = m.groups!.noun;
    const before = m.input.slice(Math.max(0, m.index - 12), m.index);
    if (/(?:^|[^\p{L}])(?:so|ein|eine|einer)\s+$/u.test(before)) return null;
    // "im gleichen Maße besser wie sie", "genauso … wie": a comparison of equals.
    const clause = m.input
      .slice(Math.max(0, m.index - 60), m.index)
      .split(/[.!?;,]/)
      .at(-1)!;
    if (/(?:^|[^\p{L}])(?:genauso|ebenso|gleiche[mnrs]?|gleich|so)(?!\p{L})/u.test(clause))
      return null;
    // "weiter wie bisher", "später wie sein Vater", "eher wie": adverbs of time and manner.
    if (
      /^(?:weiter|später|früher|eher|öfter|immer|wieder|aber|oder|über|unter|hinter|wider)$/.test(
        word,
      )
    )
      return null;
    if (/^(?:besser|lieber|mehr|weniger|anders)$/.test(word)) return "als";
    const stem = word.slice(0, -2);
    const plain = deumlaut(stem);
    // "klüger" (klug), "größer" (groß): an umlaut the lemma lacks marks the comparative.
    const comparative =
      (plain !== stem && germanAdjective(plain)) ||
      (!germanAdjective(word) &&
        [stem, `${stem}e`].some((s) => s.length >= 2 && germanAdjective(s)));
    return comparative ? "als" : null;
  },
  deUnd: (m) => {
    const before = m.input.slice(Math.max(0, m.index - 80), m.index);
    const at = before.search(/(?<!\p{L})sowohl(?!\p{L})(?![^]*(?<!\p{L})als(?!\p{L}))/u);
    return at >= 0 && !/[.!?;]/.test(before.slice(at)) ? "als auch" : null;
  },
  deDiene: (m) => (/^(?:ich|und|oder|gern|gerne)$/.test(m.groups!.noun) ? null : "deine"),
  deÖö: (m) => `ökumenisch${m.groups!.end ?? m.groups!.end2 ?? ""}`,
  deAb: (m) =>
    // "durchs Fenster geschossen", "auf die Tür geschossen": shot through or at it.
    /(?<!\p{L})(?:durch|durchs|aus|auf|aufs|gegen|in|ins|an|ans|über|unter|zwischen|hinter)\s+(?:\p{Ll}+\s+){0,3}\p{Lu}\p{Ll}+(?:\s+\p{Ll}+){0,3}\s*$/u.test(
      m.input.slice(Math.max(0, m.index - 60), m.index),
    )
      ? null
      : (m.groups!.target ?? m.groups!.t2)
          .replace(/schossen/, "schlossen")
          .replace(/schießen/, "schließen")
          .replace(/^schoss$/, "schloss"),
  deEinweis: (m) =>
    ({
      einweist: "einweihst",
      einweise: "einweihe",
      einweisen: "einweihen",
      einweistest: "einweihtest",
      einweistet: "einweihtet",
      eingewiesen: "eingeweiht",
    })[m.groups!.target] ?? null,
  deVersengt: (m) =>
    SHIP_BEFORE.test(m.input.slice(Math.max(0, m.index - 80), m.index)) &&
    // "Das Feuer hat die Planke am Schiff versengt": something burned it.
    !/(?:Feuer|Flamme|Hitze|Sonne|Glut|Brand|Blitz|Funken|Fackel|Lötlampe)/u.test(
      m.input
        .slice(Math.max(0, m.index - 80), m.index)
        .split(/[.!?;\n]/)
        .at(-1)! + m.input.slice(m.index, m.index + 40).split(/[.!?;\n]/)[0],
    )
      ? m.groups!.target.replace("versengt", "versenkt")
      : null,
  deDen2: (m) => {
    const question =
      /(?:^|[.!?\n]\s*)(Was|Wer|Wen|Wie|Wo|Wann|Warum|Wieso|Weshalb|Woher|Wohin)\s+(\p{Ll}+)[^.!?\n]*$/u.exec(
        m.input.slice(Math.max(0, m.index - 80), m.index),
      );
    if (!question) return null;
    const copula = /^(?:bin|bist|ist|sind|seid|war|warst|wart|waren|wäre|wärst)$/.test(question[2]);
    return /^(?:Was|Wer|Wen)$/.test(question[1]) || copula ? "denn" : null;
  },
  deGegen: (m) =>
    // A form of "haben" or "werden" in the sentence ("Hast du …", "dass … wurde").
    /(?<!\p{L})(?:hast|hat|habe|haben|habt|hatte|hatten|wurde|wurden|werden|worden|wird)(?!\p{L})/iu.test(
      m.input.slice(Math.max(0, m.index - 80), m.index + 30),
    )
      ? "gegeben"
      : null,
  deSs2: (m) => {
    const before = m.input.slice(Math.max(0, m.index - 12), m.index);
    const after = m.input.slice(m.index + 6, m.index + 60);
    if (/(?:^|[.!?:\n„"]|wie|so)[ \t]*$/iu.test(before) || /^[^.!?\n]*\?/.test(after)) return null;
    return "stets";
  },
  deSs3: (m) =>
    STARTED_THINGS.test(m.input.slice(m.index, m.index + 80).split(/[.!?,;\n]/)[0])
      ? null
      : ({
          starte: "starrte",
          starten: "starrten",
          startet: "starrt",
          startete: "starrte",
          starteten: "starrten",
        }[m.groups!.target.toLowerCase()] ?? null),
  deBewehr: (m) => (m.groups!.target ?? m.groups!.t2).replace("bewehr", "bewähr"),
  deNn: (m) => {
    const { target, noun } = m.groups!;
    const reading = germanGender(noun);
    if (!reading || reading.gender === "f" || (reading.plural && /[^n]$/.test(noun))) return null;
    const verb = /^[ \t]+\p{Lu}\p{Ll}+[ \t]+(\p{Ll}+)/u.exec(
      m.input.slice(m.index + target.length),
    )?.[1];
    if (
      verb &&
      !isAuxiliary(verb) &&
      !germanVerbLike(verb) &&
      !germanPastInfinitives(verb).length &&
      !/\p{Ll}{2,}t$/u.test(verb)
    )
      return null;
    return `${target.slice(0, -3)} dem`;
  },
  deKomma: (m) => (m.groups!.target ? "Koma" : "Komma"),
  deSichtweise: (m) => (m.groups!.target ? "Sichtweite" : "Sichtweise"),
  deWurden: (m) => {
    const clause = m.input
      .slice(Math.max(0, m.index - 120), m.index)
      .split(/[.!?;:,\n]/)
      .at(-1)!;
    const words = clause.match(/\p{L}+/gu) ?? [];
    const sein = words.findIndex((w) =>
      /^(?:ist|sind|war|waren|seid|bist|bin|sei|wäre|wären|gewesen)$/.test(w),
    );
    if (sein < 0) return null;
    // Another clause after "sein": a relative pronoun after a noun ("ein Haus das gebaut
    // wurde"), a conjunction ("als neue Bäume gepflanzt wurden") or a modal.
    const relative = words
      .slice(sein + 1)
      .some(
        (w, i, rest) =>
          /^(?:als|wie|bis|dass|weil|wenn|ob|da|und|oder|kann|können|muss|müssen|soll|sollen|darf|dürfen|will|wollen)$/.test(
            w,
          ) ||
          (/^(?:der|die|das|den|dem|denen|welche[mnrs]?)$/.test(w) &&
            /^\p{Lu}/u.test(rest[i - 1] ?? words[sein])),
      );
    return relative ? null : "worden";
  },
  deMir: (m) => {
    const { adj, noun } = m.groups!;
    const stem = adj.slice(0, -2);
    const quantity = /^(?:einig|viel|wenig|mehrer|beid|zahlreich|verschieden|ander)$/.test(stem);
    // "die mir keinen Nutzen bringen": a determiner.
    if (/^(?:k?ein|[dms]ein|ihr|unser|eur|dies|jen|jed|welch|solch|manch|all)$/.test(stem)) {
      return null;
    }
    // "mir bekannten Leuten", "mir vertrauter Stimme": an adjective that takes "mir".
    if (DATIVE_ADJECTIVES.test(stem)) return null;
    if (!quantity && !germanAdjective(stem)) return null;
    const reading = germanGender(noun);
    // "-em" is dative alone.
    if (adj.endsWith("em")) return "mit";
    if (adj.endsWith("er")) return reading?.gender === "f" && !reading.plural ? "mit" : null;
    // "-en": a dative plural, not "mir einigen Kummer" (masculine accusative).
    return /e?n$/.test(noun) && reading?.gender !== "m" && reading?.gender !== "n" ? "mit" : null;
  },
  deVor: (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3).replace("nahme", "name"),
  deRatten: (m) => {
    if (m.groups!.target) {
      // "in 6 Ratten wurde das Virus gefunden": only where the sentence pays.
      const before = m.input
        .slice(Math.max(0, m.index - 60), m.index)
        .split(/[.!?\n]/)
        .at(-1)!;
      const after = m.input.slice(m.index, m.index + 60).split(/[.!?\n]/)[0];
      return /zahl|überweis|finanzier|stotter|kauf|tilg|monatlich|€|Euro/u.test(before + after)
        ? "Raten"
        : null;
    }
    const typed = m.groups!.t2 ?? m.groups!.t3;
    return typed === "Rate" ? "Ratte" : "Ratten";
  },
  deDd: (m) => {
    if (m.groups!.target) return "das";
    // The relative "das" needs a neuter noun before the comma, and the clause no subject.
    const noun = /(\p{Lu}\p{Ll}+),[ \t]+$/u.exec(
      m.input.slice(Math.max(0, m.index - 40), m.index),
    )![1];
    const reading = germanGender(noun);
    if (!reading || (reading.gender !== "n" && reading.gender !== "x")) return null;
    const clause = /^[^.!?,;]*/.exec(m.input.slice(m.index + 4))![0];
    if (
      /(?<!\p{L})(?:ich|du|er|sie|es|wir|ihr|man|der|die|den|dem|ein|eine)(?!\p{L})/u.test(clause)
    )
      return null;
    return "das";
  },
  deSs4: (m) => (m.groups!.target[0] === "S" ? "So weit" : "so weit"),
  deDd2: (m) => {
    const noun = m.groups!.noun;
    const reading = germanGender(noun);
    if (!reading || reading.plural || /^Gott(?:es)?$/.test(noun)) return null;
    const possessive = m.groups!.target.replace(/ien/, "ein");
    return determinerFits(possessive, noun) ? possessive : null;
  },
  deAls: (m) => {
    const sentence = m.input
      .slice(Math.max(0, m.index - 120), m.index)
      .split(/[.!?;\n]/)
      .at(-1)!;
    return /(?<!\p{L})[Ii]ns(?:ofern|oweit)(?!\p{L})/u.test(sentence) ? "als" : null;
  },
  dePrep2: (m) => {
    const { prep, a, b } = m.groups!;
    // "seit 3000 bis 4000 Jahren": "for 3000 to 4000 years", a span with no start.
    const after = m.input.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (
      /^seit$/i.test(prep) &&
      /^[ \t]+(?:Jahr|Monat|Woche|Tag|Stunde|Minute|Jahrzehnt|Jahrhundert)\p{Ll}*n(?!\p{L})/u.test(
        after,
      )
    )
      return null;
    return [`zwischen ${a} und ${b}`, `von ${a} bis ${b}`];
  },
  deDd3: (m) => {
    const { prep } = m.groups!;
    const after = m.input.slice(m.index + m[0].length);
    const next = /^[ \t]+(\p{Ll}+)/u.exec(after)?.[1] ?? "";
    if (next) {
      // "da durch steigen", "da mit machen": the particle of the verb after it.
      if (germanInfinitive(prep + next) || germanVerbLike(prep + next)) return null;
      if (!verbForm(next) && !DA_ADVERBS.has(next)) return null;
    }
    return `${m.groups!.target[0] === "D" ? "Da" : "da"}${prep}`;
  },
  deWahr: (m) => (m.groups!.t2 ? "War" : "war"),
  deAa: (m) => {
    const noun = m.groups!.noun;
    if (!germanGender(noun) || /^(?:Inclusive|Star|Stars|You)$/.test(noun)) return null;
    return m.groups!.target[0] === "A" ? "Alle" : "alle";
  },
  deZz: (m) => DECONTRACTED[m.groups!.target.toLowerCase()],
  deBereist: (m) => {
    const clause = m.input
      .slice(Math.max(0, m.index - 80), m.index)
      .split(/[.,;:!?\n]/)
      .at(-1)!;
    const words = clause.match(/\p{L}+/gu) ?? [];
    return words.some((w) => isAuxiliary(w.toLowerCase())) ? "bereits" : null;
  },
  deLies: (m) => {
    const inf = /(\p{Ll}+)[ \t]+$/u.exec(m.input.slice(Math.max(0, m.index - 40), m.index))?.[1];
    return inf && germanInfinitive(inf) ? "ließ" : null;
  },
  deErden: (m) => `w${m.groups!.target ?? m.groups!.t2}`,
  deLehren: (m) => m.groups!.target.replace("lehr", "leer"),
  deIch: (m) => (m.groups!.t2 ? "uns" : "mich"),
  deBedenke: (m) => (m.groups!.target ?? m.groups!.t2).replace("denk", "dank"),
  deSchon2: (m) => (m.groups!.t2 ? "schon" : "schön"),
  deHohle: (m) => (m.groups!.t2 ? "Hol" : "hole"),
  deWeißt: (m) =>
    /(?<!\p{L})[Dd]u(?!\p{L})/u.test(m.input.slice(Math.max(0, m.index - 60), m.index + 60))
      ? null
      : "weist",
  deN: (m) => `${m.groups!.n}-tägig${m.groups!.end ?? m.groups!.e2 ?? ""}`,
  deHarz: (m) => (m.groups!.t2 ? "Harz" : "Hartz IV"),
  deSchacht: (m) => (m.groups!.t2 ? "Trab" : "Schach"),
  deVv: (m) => (m.groups!.t2 ? "vielen Dank" : "viel"),
  deHead2: (m) => `${m.groups!.head}p${m.groups!.s ?? ""}`,
  deVersanden: (m) => {
    const clause = m.input
      .slice(Math.max(0, m.index - 100), m.index)
      .split(/[.,;:!?\n]/)
      .at(-1)!;
    return /(?<!\p{L})(?:hat|habe|haben|hatte|hatten|hast|habt)(?!\p{L})/u.test(clause)
      ? "verstanden"
      : null;
  },
  deVerendet: (m) =>
    (m.groups!.target ?? m.groups!.t2) === "geendet" ? "gesendet" : ["versendet", "verwendet"],
  deP: (m) => {
    // "schrieben" → "schreiben", "berieten" → "bereiten": the vowels swapped.
    const word = m.groups!.target;
    if (germanInfinitive(word) || !word.includes("ie")) return null;
    const swapped = word.replace("ie", "ei");
    return germanInfinitive(swapped) ? swapped : null;
  },
  deP2: (m) => {
    const { target, t2 } = m.groups!;
    if (t2) return germanInfinitive(`${t2}en`) ? `${t2}t` : null;
    return germanInfinitive(`${target}n`) && !germanAdjective(target) && !germanGender(target)
      ? `${target}n`
      : null;
  },
  deNn2: (m) => m.groups!.target.replace(/n$/, "m"),
  deWw: (m) => (m.groups!.target[0] === "W" ? "Weißt" : "weißt"),
  dePre: (m) => `${m.groups!.pre}-Channel${m.groups!.s ?? ""}`,
  deÜberlasen: (m) => {
    const clause = m.input
      .slice(Math.max(0, m.index - 120), m.index)
      .split(/[.,;:!?\n]/)
      .at(-1)!;
    const words = clause.match(/\p{L}+/gu) ?? [];
    return words.some((w) => VERB_GOVERNORS.has(w.toLowerCase())) ? "überlassen" : null;
  },
} satisfies Record<string, Fixer>;
