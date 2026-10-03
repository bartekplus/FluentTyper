import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { Frame } from "./confusions";
import { germanAdjective } from "./germanLexicon";
import { WORD_GATE } from "./shared";

// More look-alike words in frames where only the other word fits (run by confusions.ts):
// "auf dem Geist gehen" (den), "zur Salzsäure erstarrt" (Salzsäule), "Tore scheißen"
// (schießen), "ich weis" (weiß), "sowohl … aber auch" (als auch), "in Einsatz sein" (im).
// Authored frames; the first named group with a value is the typed text.

const re = (source: string) => new RegExp(`${WORD_GATE}(?:${source})`, "gdu");
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
  // "Das Projekt lauft gut", "Lauft es?" → läuft; "ihr lauft", "Lauft schnell!" stay.
  {
    regex: re(
      `(?<!(?:ihr|Ihr)${S}(?:\\p{L}+${S}){0,2})(?<![,!]${S}?)(?<target>lauft)(?!${S}(?:ihr|Ihr)${E}|[ \\t]*!)${E}|` +
        `(?<=(?:^|[.!?]${S}|\\n))(?<t2>Lauft)(?=${S}(?:es|er|das|der|die|alles|denn|bei)${E})`,
    ),
    fix: "läuft",
  },
  // "War die Tür verschossen?", "Er schoss die Tür" → verschlossen, schloss.
  {
    regex: re(
      `(?<=(?:Tür|Türen|Fenster|Tresor|Schrank|Kiste|Dose|Deckel|luftdicht|fest)${S})(?<target>verschossen)${E}|` +
        `(?<t2>schoss|schossen)(?=${S}(?:die|das|den|seine|ihre)${S}(?:Tür|Türen|Fenster|Augen|Laden)${E}|${S}sich${S}zusammen${E})`,
    ),
    fix: (m) => (m.groups!.target ? "verschlossen" : m.groups!.t2.replace("schoss", "schloss")),
  },
  // "Nach dem der Spieler gewonnen hatte, …", "erst nach dem ich fragte" → nachdem: "dem"
  // before a subject and a clause that a comma closes after its verb.
  {
    regex: re(
      `(?<=(?:^|[.!?\\n„"]|[Ee]rst|[Kk]urz|[Gg]leich|[Ll]ange|[Bb]ald|[Ss]chon|[Dd]irekt|[Uu]nmittelbar)[ \\t]*)(?<target>[Nn]ach${S}dem)(?=${S}(?:ich|du|er|sie|es|wir|ihr|man|der|die|das|dieser|diese|mein|meine|sein|seine|unser|unsere)${E}[^.!?;,\\n]{1,80}\\p{Ll}[ \\t]*,)`,
    ),
    fix: (m) => (m.groups!.target[0] === "N" ? "Nachdem" : "nachdem"),
  },
  // "soweit das Auge reicht", "Es ist soweit." → so weit; "sobald wie
  // möglich", "nicht sobald wieder" → so bald. "soweit" and "sobald" are conjunctions.
  {
    regex: re(
      `(?<target>soweit)(?=${S}(?:das${S}Auge|seine${S}Augen|ihre${S}Augen)${S}reicht)|` +
        `(?<=(?:ist|sind|war|wäre|bin|bist)${S}(?:es${S})?)(?<t2>soweit)(?=[ \\t]*[.!?])|` +
        `(?<t3>sobald)(?=${S}(?:wie|als)${S}möglich${E}|${S}nicht${S}wieder${E})|(?<=nicht${S})(?<t4>sobald)(?=${S}wieder${E})`,
    ),
    fix: (m) => ((m.groups!.t3 ?? m.groups!.t4) ? "so bald" : "so weit"),
  },
  // "Das kann nicht seien" → sein: an infinitive after a modal verb.
  {
    regex: re(
      `(?<=(?:kann|könnte|muss|müsste|soll|sollte|wird|würde|darf|dürfte|mag)(?:${S}(?:doch|gar|nicht|ja|schon|wohl|auch|noch|so))*${S})(?<target>seien)(?=[ \\t]*[.!?,;])`,
    ),
    fix: "sein",
  },
  // "Das ist nicht war", "kann nicht war sein", ", nicht war?", "war werden" → wahr.
  {
    regex: re(
      `(?<=(?:ist|sei|wäre|kann|könnte|muss|darf)(?:${S}(?:doch|ja|gar|einfach))*${S}nicht${S})(?<target>war)(?=[ \\t]*[.!?,]|${S}sein${E})|` +
        `(?<=,${S}nicht${S})(?<t2>war)(?=[ \\t]*\\?)|(?<t3>war)(?=${S}(?:werden|wird)${E})`,
    ),
    fix: "wahr",
  },
  // "Er gibt zu fiel Geld aus" → viel.
  {
    regex: re(`(?<=(?:zu|sehr|ziemlich|so${S}sehr)${S})(?<target>fiel)(?=${S}\\p{L})`),
    fix: "viel",
  },
  // "Er starte ins Leere", "starrten auf den Monitor" → starrte.
  {
    regex: re(
      `(?<target>starte|starten)(?=${S}(?:ins${S}Leere|auf${S}(?:den|das|seinen|ihren)${S}(?:Monitor|Bildschirm|Boden|Fernseher|Display|Handy))${E})`,
    ),
    fix: (m) => m.groups!.target.replace("start", "starrt"),
  },
  // "Ich bin es so gewöhnt", "Das bin ich gewöhnt" → gewohnt; "an etwas gewöhnt sein" stays.
  {
    regex: re(
      `(?<=(?:bin|bist|ist|sind|seid|war|waren|wäre)${S}(?:(?:ich|du|er|sie|wir|ihr)${S})?(?:es|das|so)(?:${S}(?:so|nicht|schon|einfach|halt|eben|ja))*${S})(?<target>gewöhnt)(?=[ \\t]*[.!?,])`,
    ),
    fix: (m) =>
      /(?<!\p{L})(?:an|am|daran|dran)(?!\p{L})/u.test(
        m.input
          .slice(Math.max(0, m.index - 80), m.index)
          .split(/[.!?;\n]/)
          .at(-1)!,
      )
        ? null
        : "gewohnt",
  },
  // "Deine Iden" → Ideen; "die Ideen des März" → Iden.
  {
    regex: re(
      `(?<=(?:[Dd]eine|[Mm]eine|[Ss]eine|[Ii]hre|[Uu]nsere|[Ee]ure|gute|tolle|neue|viele|keine)${S})(?<target>Iden)${E}|(?<t2>Ideen)(?=${S}des${S}März)`,
    ),
    fix: (m) => (m.groups!.target ? "Ideen" : "Iden"),
  },
  // "ein Glas Champagne" → Champagner; "mit versteinerter Mine", "Kugelschreibermiene".
  {
    regex: re(
      `(?<=(?:Glas|Gläser|Flasche|Flaschen|trank|tranken|trinken|trinkt)${S})(?<target>Champagne)(?![\\p{L}-])|` +
        `(?<=(?:versteinerter|ernster|finsterer|ausdrucksloser|betretener|mürrischer|unbewegter|säuerlicher|gute)${S})(?<t2>Mine)(?![\\p{L}-])|` +
        `(?<t3>\\p{L}*(?:Kugelschreiber|Bleistift|Kuli|Stift)mienen?)${E}`,
    ),
    fix: (m) =>
      m.groups!.target
        ? "Champagner"
        : m.groups!.t2
          ? "Miene"
          : m.groups!.t3.replace("miene", "mine"),
  },
  // "ethische Minderheiten" → ethnische; "ethnische Bedenken" → ethische.
  {
    regex: re(
      `(?<target>[Ee]thische[nmrs]?)(?=${S}(?:Minderheit|Minderheiten|Säuberung|Säuberungen|Herkunft|Gruppe|Gruppen|Zugehörigkeit)${E})|` +
        `(?<t2>[Ee]thnische[nmrs]?)(?=${S}(?:Bedenken|Grundsätze|Fragen|Werte|Verantwortung|Normen|Gründe|Prinzipien)${E})`,
    ),
    fix: (m) =>
      m.groups!.target?.replace("thisch", "thnisch") ?? m.groups!.t2.replace("thnisch", "thisch"),
  },
  // "Die Sache hat einen Hacken" → Haken.
  {
    regex: re(
      `(?<=(?:hat|hatte|haben|hätte|gibt${S}es)${S}(?:\\p{Ll}+${S})?einen${S})(?<target>Hacken)${E}`,
    ),
    fix: "Haken",
  },
  // "Hans lies die Tür offen" → ließ; "Lies die Zeitung!" is the imperative of "lesen".
  {
    regex: re(
      `(?<!(?:Bitte|Dann|Jetzt|Nun|Also|Und|Oder|Aber|Hier|Da|Doch|Einfach|Erst|Zuerst|Nochmal|bitte|dann|jetzt|nun|und|oder|aber|doch|einfach|erst|mal|nochmal)${S})(?<=(?:\\p{Lu}\\p{Ll}+|er|sie|man)${S})(?<target>lies)(?=${S}(?:die|den|das|sich|ihn|mich|uns|ihm|ihr)${E})`,
    ),
    fix: "ließ",
  },
  // "Bein nächsten Update", "Nach am selben Tag", "Sei ließ sich scheiden", "weil sei die …".
  {
    regex: re(
      `(?<=(?:^|[.!?]${S}|\\n))(?<target>Bein)(?=${S}\\p{Ll}+en${S}\\p{L})|` +
        `(?<=(?:^|[.!?]${S}|\\n))(?<t2>Nach)(?=${S}(?:am|im|in|an)${S}(?:selben|derselben|demselben|gleichen)${E})|` +
        `(?<=(?:^|[.!?]${S}|\\n))(?<t3>Sei)(?=${S}(?:ließ|hat|hatte|war|ist|kam|ging|sagte|wollte|konnte)${E})|` +
        `(?<=(?:weil|dass|ob|obwohl)${S})(?<t4>sei)(?=${S}(?:die|den|das|der|ein|eine|einen|ihn|ihm|ihr|mir|dir|uns)${E})`,
    ),
    fix: (m) => (m.groups!.target ? "Beim" : m.groups!.t2 ? "Noch" : "sie"),
  },
  // "Ministerpräsident von Sachen und Thüringen", "Bundesland Sachen" → Sachsen.
  {
    regex: re(
      `(?<=(?:Bundesland|Freistaat)${S})(?<target>Sachen)${E}|(?<t2>Sachen)(?=${S}und${S}(?:Thüringen|Bayern|Brandenburg|Hessen|Berlin)${E})|(?<=(?:Thüringen|Bayern|Brandenburg|Hessen|Berlin)${S}und${S})(?<t3>Sachen)${E}`,
    ),
    fix: "Sachsen",
  },
  // "strickt einzuhalten", "strickte Bettruhe" → strikt.
  {
    regex: re(
      `(?<target>strickt)(?=${S}(?:einzuhalten|verboten|untersagt|abgelehnt|getrennt|vertraulich|limitiert)${E})|(?<=nicht${S})(?<t2>strickt)(?=${S}gegen${E})|` +
        `(?<t3>strickte[nmrs]?)(?=${S}(?:Bettruhe|Regel|Regeln|Vorgabe|Vorgaben|Trennung|Verbot|Diät|Ablehnung|Einhaltung|Neutralität)${E})`,
    ),
    fix: (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3).replace("strickt", "strikt"),
  },
  // "Ich muss mich spurten" → sputen; "Anders ausgerückt" → ausgedrückt.
  {
    regex: re(
      `(?<=(?:mich|dich|sich|uns|euch)(?:${S}(?:jetzt|aber|doch|mal|noch|ja|besser))*${S})(?<target>spurten)(?=[ \\t]*[.!?,])|` +
        `(?<=(?:[Aa]nders|[Bb]esser|[Ee]infach|[Vv]orsichtig|[Ss]alopp|[Dd]rastisch|mich|dich|sich|uns|euch)(?:${S}\\p{Ll}+){0,3}${S})(?<t2>ausgerückt)${E}`,
    ),
    fix: (m) => (m.groups!.target ? "sputen" : "ausgedrückt"),
  },
  // "Von Berlin ach München", "von links mach rechts" → nach.
  {
    regex: re(
      `(?<=[Vv]on${S}(?:\\p{Lu}\\p{Ll}+|links|rechts|oben|unten|vorne|hinten)${S})(?<target>ach|mach)(?=${S}(?:\\p{Lu}\\p{Ll}+|links|rechts|oben|unten|vorne|hinten)${E})`,
    ),
    fix: "nach",
  },
  // "Ich erkläre mich breit" → bereit; "weit und bereit" → breit.
  {
    regex: re(
      `(?<=(?:erkläre|erklärt|erklärst|erklärte|erklärten|erklären)${S}(?:mich|dich|sich|uns|euch)${S})(?<target>breit)${E}|(?<=(?:mich|dich|sich|uns|euch)(?:${S}\\p{Ll}+){0,2}${S})(?<t2>breit)(?=${S}(?:erklärt|erkläre|erklärst|erklären|erklärte|erklärten)${E})|(?<=[Ww]eit${S}und${S})(?<t3>bereit)${E}`,
    ),
    fix: (m) => (m.groups!.t3 ? "breit" : "bereit"),
  },
  // "Er hat soviel gewonnen" → so viel; "soviel ich weiß" is the conjunction, and LT accepts
  // "heißt soviel wie".
  {
    regex: re(
      `(?<=(?<!\\p{L})\\p{Ll}+${S})(?<target>soviel)(?!${S}(?:ich|wir|man|du|er|sie|ihr|mir|bekannt|wie|als)${E})${E}`,
    ),
    fix: "so viel",
  },
  // "es geht steil Berg ab" → bergab.
  {
    regex: re(
      `(?<=(?:steil|wieder|es|geht|ging|nur|stetig)${S})(?<target>Berg${S}(?<noun>ab|auf))(?=[ \\t]*[.!?,]|${S}(?:mit|geht|ging|gehen|gegangen)${E})`,
    ),
    fix: (m) => `berg${m.groups!.noun}`,
    ownCase: true,
  },
  // "Es ist ihr 80gster Geburtstag" → 80.; "in den 80gern" → 80ern.
  {
    regex: re(
      `(?<target>(?<noun>\\d{2,3})(?:g|zig|ig)(?:ste[rnms]?|(?<t2>ern?)))(?![\\p{L}\\p{N}])`,
    ),
    fix: (m) => (m.groups!.t2 ? `${m.groups!.noun}${m.groups!.t2}` : `${m.groups!.noun}.`),
  },
  // "Die beide Brüder" → beiden, not after a relative pronoun ("die beide Lehrer wurden");
  // "auf da Bett" → das; "sich bei im bedanken" → ihm.
  {
    regex: re(
      `(?<!,${S}(?:\\p{Ll}+${S})?(?:[Dd]ie|der|den)${S})(?<=(?:[Dd]ie|der|den|[Dd]iese|dieser|[Mm]eine|[Dd]eine|[Ss]eine|[Ii]hre|[Uu]nsere|[Ee]ure)${S})(?<target>beide)(?=${S}(?:\\p{Ll}+en${S})?\\p{Lu}\\p{Ll}+${E})|` +
        `(?<=(?:auf|in|an|über|unter|für|durch|um|vor|hinter)${S})(?<t2>da)(?=${S}\\p{Lu}\\p{Ll}+${E})|` +
        `(?<=(?:sich|mich|dich|uns|euch)${S}bei${S})(?<t3>im)(?=${S}\\p{Ll})|(?<t4>im)(?=${S}zu[ \\t]*[.!?,])`,
    ),
    fix: (m) => (m.groups!.target ? "beiden" : m.groups!.t2 ? "das" : "ihm"),
  },
  // "eine Fehler Hafte Abbuchung" → fehlerhafte: a noun and "-haft" written apart.
  {
    regex: re(`(?<target>(?<noun>\\p{Lu}\\p{Ll}{2,})${S}Haft(?:e|en|er|es|em)?)${E}`),
    fix: (m) => {
      const joined = m.groups!.target.replace(/[ \t ]+Haft/, "haft").toLowerCase();
      return germanAdjective(`${m.groups!.noun.toLowerCase()}haft`) ? joined : null;
    },
    ownCase: true,
  },
];
