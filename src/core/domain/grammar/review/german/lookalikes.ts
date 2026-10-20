import type { Fixer } from "../../engine/reviewRules";
import { germanAdjective } from "./germanLexicon";

const SHOOT: Readonly<Record<string, string>> = {
  scheißen: "schießen",
  scheißt: "schießt",
  scheiße: "schieße",
  geschissen: "geschossen",
};

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = {
  deScheißen: (m) => (m.groups!.t3 ? "Scheiße" : SHOOT[m.groups!.target ?? m.groups!.t2]),
  deWeis: (m) => (m.groups!.t4 ? "weißt" : m.groups!.t5 ? "Weiß" : "weiß"),
  deIn: (m) => {
    const prep = m.groups!.target.split(/[ \t ]/)[0].toLowerCase();
    const states = /Staaten/.test(m.groups!.target);
    const tail = m.groups!.noun ? " von Amerika" : "";
    const dative = states ? `Vereinigten Staaten${tail}` : "Vereinigten Arabischen Emiraten";
    const accusative = states ? dative : "Vereinigten Arabischen Emirate";
    if (prep === "nach") return `in die ${accusative}`;
    if (prep === "in") return [`in den ${dative}`, `in die ${accusative}`];
    return `${prep} den ${dative}`;
  },
  deVerschossen: (m) =>
    m.groups!.target ? "verschlossen" : m.groups!.t2.replace("schoss", "schloss"),
  deNn3: (m) => (m.groups!.target[0] === "N" ? "Nachdem" : "nachdem"),
  deSoweit: (m) => ((m.groups!.t3 ?? m.groups!.t4) ? "so bald" : "so weit"),
  deStarte: (m) => m.groups!.target.replace("start", "starrt"),
  deGewöhnt: (m) =>
    /(?<!\p{L})(?:an|am|daran|dran)(?!\p{L})/u.test(
      m.input
        .slice(Math.max(0, m.index - 80), m.index)
        .split(/[.!?;\n]/)
        .at(-1)!,
    )
      ? null
      : "gewohnt",
  deIden: (m) => (m.groups!.target ? "Ideen" : "Iden"),
  deChampagne: (m) =>
    m.groups!.target
      ? "Champagner"
      : m.groups!.t2
        ? "Miene"
        : m.groups!.t3.replace("miene", "mine"),
  deEe: (m) =>
    m.groups!.target?.replace("thisch", "thnisch") ?? m.groups!.t2.replace("thnisch", "thisch"),
  deBein: (m) => (m.groups!.target ? "Beim" : m.groups!.t2 ? "Noch" : "sie"),
  deStrickt: (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3).replace("strickt", "strikt"),
  deSpurten: (m) => (m.groups!.target ? "sputen" : "ausgedrückt"),
  deBreit: (m) => (m.groups!.t3 ? "breit" : "bereit"),
  deBerg: (m) => `berg${m.groups!.noun}`,
  deNoun: (m) => (m.groups!.t2 ? `${m.groups!.noun}${m.groups!.t2}` : `${m.groups!.noun}.`),
  deBeide: (m) => (m.groups!.target ? "beiden" : m.groups!.t2 ? "das" : "ihm"),
  deNoun2: (m) => {
    const joined = m.groups!.target.replace(/[ \t ]+Haft/, "haft").toLowerCase();
    return germanAdjective(`${m.groups!.noun.toLowerCase()}haft`) ? joined : null;
  },
} satisfies Record<string, Fixer>;
