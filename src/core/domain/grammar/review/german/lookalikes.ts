import { SPACE as S, WORD_END as E, WORD_START } from "../phraseTemplates";
import type { Frame } from "./confusions";
import { NOT_BLANK } from "./shared";

// More look-alike words in frames where only the other word fits (run by confusions.ts):
// "auf dem Geist gehen" (den), "zur Salzsäure erstarrt" (Salzsäule), "Tore scheißen"
// (schießen), "ich weis" (weiß), "sowohl … aber auch" (als auch), "in Einsatz sein" (im).
// Authored frames; the first named group with a value is the typed text.

const re = (source: string) => new RegExp(`${NOT_BLANK}${WORD_START}(?:${source})`, "gdu");
const DATIVES = "mir|dir|ihm|ihr|uns|euch|ihnen|Ihnen";
const GEHEN = "gehen|gehst|geht|ging|gingst|gingen|gegangen|gehe";
const SEIN = "ist|sind|war|waren|bin|bist|seid|wäre|wären|sei|sein|gewesen";
const SHOOT: Readonly<Record<string, string>> = {
  scheißen: "schießen",
  scheißt: "schießt",
  scheiße: "schieße",
  geschissen: "geschossen",
};

export const LOOKALIKE_FRAMES: readonly Frame[] = [
  // "Das geht mir auf dem Geist", "Geh mir nicht auf dem Wecker!": the idiom takes "den".
  {
    regex: re(
      `(?<=[Aa]uf${S})(?<target>dem)(?=${S}(?:Geist|Wecker|Keks|Senkel|Zeiger|Nerv)(?:${S}\\p{Ll}+){0,2}${S}(?:${GEHEN})${E})|` +
        `(?<=(?:[Gg]eh|[Gg]eht|[Gg]ehst|ging|gingen)${S}(?:${DATIVES})(?:${S}\\p{Ll}+){0,2}${S}auf${S})(?<t2>dem)(?=${S}(?:Geist|Wecker|Keks|Senkel|Zeiger|Nerv)${E})`,
    ),
    fix: "den",
  },
  // "Sie erstarrte zur Salzsäure" → Salzsäule.
  {
    regex: re(
      `(?<=erstarr\\p{Ll}*${S}zur${S})(?<target>Salzsäure|Salzseule|Salzeule|Salzkeule)${E}|` +
        `(?<=zur${S})(?<t2>Salzsäure|Salzseule|Salzeule|Salzkeule)(?=${S}(?:erstarrt|erstarren|erstarrte|erstarrten)${E})`,
    ),
    fix: "Salzsäule",
  },
  // "Tore scheißen", "wie Pilze aus dem Boden scheißen" → schießen; "echt Schieße" → Scheiße.
  {
    regex: re(
      `(?<=(?:Tor|Tore|Toren|Eigentor|Eigentore|Eigentoren|Elfmeter|Freistoß|Pilze${S}aus${S}dem${S}Boden)${S})(?<target>scheißen|scheißt|scheiße|geschissen)${E}|` +
        `(?<t2>scheißen|scheißt|scheiße)(?=${S}wie${S}Pilze${S}aus${S}dem${S}Boden${E})|` +
        `(?<=(?:echt|totale|totaler|große|reine|einfach|ja|nur|alles|so${S}eine|eine)${S})(?<t3>Schieße)(?=[ \\t]*(?:[.!?,;]|$))`,
    ),
    fix: (m) => (m.groups!.t3 ? "Scheiße" : SHOOT[m.groups!.target ?? m.groups!.t2]),
  },
  // "ohne Punk und Komma", "der springende Punk", "Punk für Punkt" → Punkt.
  {
    regex: re(
      `(?<=[Oo]hne${S})(?<target>Punk)(?=${S}und${S}Komma${E})|(?<=springende[n]?${S})(?<t2>Punk)${E}|` +
        `(?<t3>Punk)(?=${S}für${S}Punkt?${E})|(?<=Punkt${S}für${S})(?<t4>Punk)${E}`,
    ),
    fix: "Punkt",
  },
  // "Ich weis nicht", "das weis ich", "Weis auch nicht." → weiß; "Weiß du, …" → Weißt; "in
  // weis" → Weiß. "Das macht er mir weis" (weismachen) keeps the particle.
  {
    regex: re(
      `(?<=(?:[Ii]ch|[Ee]r|[Ss]ie|[Mm]an|[Ee]s|[Dd]as)(?:${S}(?:doch|auch|ja|schon|halt|eben|selbst|genau|wirklich|ehrlich|leider))?${S})(?<target>weis)(?=${S}(?:nicht|nichts|es|das|ich|auch|doch|schon|ja|nur|genau|noch|wirklich|gar|überhaupt|eben|leider|selbst)${E}|[ \\t]*[.,!?])|` +
        `(?<!(?:${DATIVES}|etwas|nichts|was)${S})(?<t2>weis)(?=${S}ich${E})|` +
        `(?<=(?:^|[.!?:„"«»]${S}?|\\n))(?<t3>Weis)(?=${S}(?:ich|nicht|auch|wirklich|es|leider)${E})|` +
        `(?<=(?:^|[.!?:„"«»]${S}?|\\n))(?<t4>Weiß)(?=${S}du${E})|` +
        `(?<=[Ii]n${S})(?<t5>weis)(?=[ \\t]*[.,!?;])`,
    ),
    fix: (m) => (m.groups!.t4 ? "weißt" : m.groups!.t5 ? "Weiß" : "weiß"),
  },
  // "Die Milch steht hinten link", "link oben" → links.
  {
    regex: re(
      `(?<=(?:[Oo]ben|[Uu]nten|[Hh]inten|[Vv]orne|[Vv]orn|ganz)${S})(?<target>link)(?=[ \\t]*[.,!?;]|${S}(?:\\p{Ll}|oben|unten|hinten|vorne|vorn)${E})|` +
        `(?<!(?:der|den|dem|des|einen|ein|einem|diesen|diesem|im|am|zum|the|a|this|your|my)${S})(?<t2>link)(?=${S}(?:oben|unten|hinten|vorne|vorn)${E})`,
    ),
    fix: "links",
  },
  // "sowohl heute aber auch morgen", "sowohl Bus sowie auch Bahn" → als auch.
  {
    regex: re(`(?<=[Ss]owohl${S}[^.!?;,\\n]{1,60}?${S})(?<target>aber${S}auch|sowie${S}auch)${E}`),
    fix: "als auch",
  },
  // "Die Feuerwehr war in Einsatz", "in Nullkommanichts" → im.
  {
    regex: re(
      `(?<=(?:${SEIN}|befindet|befinden|stehen|steht|stand|standen)(?:${S}\\p{L}+){0,3}${S})(?<target>in)(?=${S}Einsatz${E}(?![ \\t]*[-–]))|` +
        `(?<t2>in)(?=${S}Einsatz${S}(?:${SEIN})${E})|` +
        `(?<t3>in)(?=${S}(?:Nullkommanichts|Nullkommanix)${E})`,
    ),
    fix: "im",
  },
  // "in Vereinigten Staaten", "nach Vereinigte Arabische Emirate": these names take the plural
  // article ("in den Vereinigten Staaten", "in die Vereinigten Arabischen Emirate").
  {
    regex: re(
      `(?<!Made${S})(?<target>(?:in|nach|aus|von|In|Nach|Aus|Von)${S}Vereinigten?${S}(?:Staaten(?<noun>${S}von${S}Amerika)?|Arabischen?${S}Emiraten?))${E}`,
    ),
    fix: (m) => {
      const prep = m.groups!.target.split(/[ \t ]/)[0].toLowerCase();
      const states = /Staaten/.test(m.groups!.target);
      const tail = m.groups!.noun ? " von Amerika" : "";
      const dative = states ? `Vereinigten Staaten${tail}` : "Vereinigten Arabischen Emiraten";
      const accusative = states ? dative : "Vereinigten Arabischen Emirate";
      if (prep === "nach") return `in die ${accusative}`;
      if (prep === "in") return [`in den ${dative}`, `in die ${accusative}`];
      return `${prep} den ${dative}`;
    },
  },
  // "auf halben Weg" → halbem.
  {
    regex: re(`(?<=[Aa]uf${S})(?<target>halben)(?=${S}Wege?${E})`),
    fix: "halbem",
  },
];
