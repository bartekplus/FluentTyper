// French style advice (opt-in stylePhrasing) that needs more than a fixed phrase. The phrase
// rows (calques, criticized phrasings, pleonasms) are in grammar/rules/fr.yaml.
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";
import { isInflectedNoun, isVerbHomograph, nounGender, verbReadings } from "./frenchLexicon";
import {
  capitalizedName,
  CLITICS,
  inChunk,
  SENTENCE_START,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

const RULE = "stylePhrasing";
const MESSAGE = "review_msg_style_phrasing";

// Verb forms in one order: infinitive; present je, tu, il, nous, vous, ils; imperfect il, ils;
// future il, ils; conditional il; past participle m, f, m plural, f plural; present participle.
const [P1, P2, P3] = [1, 2, 3];
const Q = 12;
const IRREGULAR: Record<string, string> = {
  émettre:
    "émettre émets émets émet émettons émettez émettent émettait émettaient émettra émettront émettrait émis émise émis émises émettant",
  partir:
    "partir pars pars part partons partez partent partait partaient partira partiront partirait parti partie partis parties partant",
  remplir:
    "remplir remplis remplis remplit remplissons remplissez remplissent remplissait remplissaient remplira rempliront remplirait rempli remplie remplis remplies remplissant",
  satisfaire:
    "satisfaire satisfais satisfais satisfait satisfaisons satisfaites satisfont satisfaisait satisfaisaient satisfera satisferont satisferait satisfait satisfaite satisfaits satisfaites satisfaisant",
  atteindre:
    "atteindre atteins atteins atteint atteignons atteignez atteignent atteignait atteignaient atteindra atteindront atteindrait atteint atteinte atteints atteintes atteignant",
  battre:
    "battre bats bats bat battons battez battent battait battaient battra battront battrait battu battue battus battues battant",
  réduire:
    "réduire réduis réduis réduit réduisons réduisez réduisent réduisait réduisaient réduira réduiront réduirait réduit réduite réduits réduites réduisant",
  soutenir:
    "soutenir soutiens soutiens soutient soutenons soutenez soutiennent soutenait soutenaient soutiendra soutiendront soutiendrait soutenu soutenue soutenus soutenues soutenant",
  conclure:
    "conclure conclus conclus conclut concluons concluez concluent concluait concluaient conclura concluront conclurait conclu conclue conclus conclues concluant",
  conduire:
    "conduire conduis conduis conduit conduisons conduisez conduisent conduisait conduisaient conduira conduiront conduirait conduit conduite conduits conduites conduisant",
  résoudre:
    "résoudre résous résous résout résolvons résolvez résolvent résolvait résolvaient résoudra résoudront résoudrait résolu résolue résolus résolues résolvant",
  émouvoir:
    "émouvoir émeus émeus émeut émouvons émouvez émeuvent émouvait émouvaient émouvra émouvront émouvrait ému émue émus émues émouvant",
  pourvoir:
    "pourvoir pourvois pourvois pourvoit pourvoyons pourvoyez pourvoient pourvoyait pourvoyaient pourvoira pourvoiront pourvoirait pourvu pourvue pourvus pourvues pourvoyant",
};

/** The forms of a verb in SLOTS order; -er verbs are built ("lançons", "appuie", "complète"). */
function verbForms(lemma: string): string[] {
  if (IRREGULAR[lemma]) return IRREGULAR[lemma].split(" ");
  const stem = lemma.slice(0, -2);
  const hard = stem.replace(/c$/, "ç").replace(/g$/, "ge");
  const mute = stem.replace(/y$/, "i").replace(/é([^aeiouéèêy]+)$/, "è$1");
  const future = stem.replace(/y$/, "i");
  return [
    lemma,
    `${mute}e`,
    `${mute}es`,
    `${mute}e`,
    `${hard}ons`,
    `${stem}ez`,
    `${mute}ent`,
    `${hard}ait`,
    `${hard}aient`,
    `${future}era`,
    `${future}eront`,
    `${future}erait`,
    ...["é", "ée", "és", "ées"].map((end) => stem + end),
    `${hard}ant`,
  ];
}

// "calque > native native : nouns". The calque takes the native verb before these objects;
// "*" means any use, and "!" marks a verb that "de" after it makes correct ("partir d'un projet").
const VERBS = `
rencontrer > respecter : norme exigence échéance critère obligation engagement
rencontrer > satisfaire : besoin attente demande
rencontrer > atteindre : objectif cible quota
compléter > remplir : formulaire questionnaire fiche déclaration sondage
compléter > conclure : transaction vente entente accord
opérer > exploiter : entreprise commerce magasin restaurant usine boutique franchise hôtel mine compagnie
opérer > conduire manœuvrer : machine grue véhicule chariot
émettre > délivrer : passeport permis visa diplôme licence attestation
émettre > publier : communiqué
endosser > appuyer : candidature candidat candidate proposition
supporter > soutenir appuyer : candidat candidate candidature cause initiative proposition réforme
adresser > aborder traiter : problème enjeu préoccupation défi problématique sujet
couper > réduire : dépense coût budget subvention salaire effectif prix
couper > supprimer : emploi
contrôler > maîtriser : incendie brasier
briser > battre : record
passer > adopter : loi règlement résolution motion
placer > passer : commande appel
loger > déposer : plainte grief
initier > lancer amorcer : projet programme processus démarche réforme changement dialogue enquête procédure
!partir > lancer : entreprise compagnie commerce projet mode rumeur débat discussion
combler > pourvoir : poste
solutionner > résoudre : *
impacter > toucher affecter : *
émotionner > émouvoir : *
`;

type Calque = { natives: string[]; nouns: Set<string> | null; noDe: boolean };
const plural = (noun: string) =>
  /[sxz]$/.test(noun) ? noun : /al$/.test(noun) ? `${noun.slice(0, -2)}aux` : `${noun}s`;

let calques: Map<string, Calque[]> | null = null;
/** Typed form -> the calque entries of its verb and the slots it fills. */
let typedForms: Map<string, { lemma: string; slots: number[] }> | null = null;
const nativeForms = new Map<string, string[]>();

function load() {
  if (calques) return;
  calques = new Map();
  typedForms = new Map();
  for (const line of VERBS.trim().split("\n")) {
    const [head, nouns] = line.split(" : ");
    const [calque, natives] = head.split(" > ");
    const lemma = calque.replace("!", "");
    const entry: Calque = {
      natives: natives.split(" "),
      nouns: nouns === "*" ? null : new Set(nouns.split(" ").flatMap((n) => [n, plural(n)])),
      noDe: calque.startsWith("!"),
    };
    calques.set(lemma, [...(calques.get(lemma) ?? []), entry]);
    if (calques.get(lemma)!.length > 1) continue;
    verbForms(lemma).forEach((form, slot) => {
      const known = typedForms!.get(form);
      if (known) known.slots.push(slot);
      else typedForms!.set(form, { lemma, slots: [slot] });
    });
  }
}

const formsOf = (lemma: string) => {
  let forms = nativeForms.get(lemma);
  if (!forms) nativeForms.set(lemma, (forms = verbForms(lemma)));
  return forms;
};

const ADVERBS = new Set(
  "pas plus jamais point toujours déjà bien enfin aussi souvent rarement encore vraiment finalement rapidement mieux mal".split(
    " ",
  ),
);
const DETERMINERS = new Set(
  "le la l' les un une des du de d' ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs tous toutes chaque plusieurs certains certaines quelques nombreux nombreuses".split(
    " ",
  ),
);

/** The object noun after a verb: adverbs, one or two determiners, at most one more word. */
function objectAfter(text: string, end: number, entry: Calque): Token | null {
  const after = tokensAfter(text, end, 7);
  let i = 0;
  while (i < 2 && ADVERBS.has(after[i]?.w)) i++;
  if (!DETERMINERS.has(after[i]?.w) || (entry.noDe && /^d/.test(after[i].w))) return null;
  i++;
  if (DETERMINERS.has(after[i]?.w)) i++;
  return [after[i], after[i + 1]].find((t) => t && entry.nouns!.has(t.w)) ?? null;
}

const AUXILIARIES = new Set(
  "a ai as avons avez ont avait avaient aura auront aurait avoir ayant".split(" "),
);

/** "Il complète le formulaire" -> "remplit", "rencontrer les normes" -> "respecter". */
function verbCalque(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const known = typedForms!.get(typed.toLowerCase());
  if (!known || capitalizedName(ctx.text, m.index, typed)) return null;
  const before = tokensBefore(ctx.text, m.index, 3);
  const subject = before.find((t) => !CLITICS.has(t.w) && t.w !== "ne" && t.w !== "n'");
  // "une version complète du formulaire", "la coupe des salaires": a noun or adjective. A
  // subject pronoun, an auxiliary or the clause start makes it a verb.
  if (
    isVerbHomograph(typed.toLowerCase()) &&
    before.length > 0 &&
    before[0].w !== "ne" &&
    before[0].w !== "n'" &&
    !SUBJECT_PRONOUNS.has(subject?.w ?? "") &&
    !AUXILIARIES.has(subject?.w ?? "")
  )
    return null;
  const end = m.index + typed.length;
  for (const entry of calques!.get(known.lemma)!) {
    const noun = entry.nouns === null ? null : objectAfter(ctx.text, end, entry);
    if (entry.nouns && !noun) continue;
    let slots = known.slots;
    // "complète": je, il or an imperative; the subject picks the native form.
    if (slots.includes(P1) && slots.length > 1) {
      const sentenceStart =
        !before.length && SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 4), m.index));
      const person =
        subject?.w === "je" || subject?.w === "j'" || sentenceStart
          ? P1
          : subject?.w === "tu"
            ? P2
            : P3;
      const narrowed = slots.filter((slot) => slot === person || slot >= Q);
      if (narrowed.length) slots = narrowed;
    }
    const alternatives = entry.natives.flatMap((native) =>
      [...new Set(slots.map((slot) => formsOf(native)[slot]))].slice(0, 1),
    );
    const found = wordFinding(ctx, m.index, typed, alternatives, RULE, MESSAGE, {
      start: before.at(-1)?.start ?? m.index,
      end: noun?.end ?? end,
    });
    if (found) return found;
  }
  return null;
}

// "un bon dix minutes": the English word order; French puts "bon" after the number.
const NUMBER_WORDS = new Set(
  "deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante soixante cent et".split(
    " ",
  ),
);
const FEMININE_UNITS = new Set("minutes heures secondes semaines journées années".split(" "));

function goodNumber(m: RegExpExecArray, ctx: DetectContext): RawFinding | null {
  const { count, unit } = m.groups!;
  if (
    !/^\d+$/.test(count) &&
    !count
      .toLowerCase()
      .split("-")
      .every((w) => NUMBER_WORDS.has(w))
  )
    return null;
  const [start, end] = m.indices!.groups!.target;
  const good = FEMININE_UNITS.has(unit.toLowerCase()) ? "bonnes" : "bons";
  const found = wordFinding(
    ctx,
    start,
    m.groups!.target,
    [`${count} ${good} ${unit}`],
    RULE,
    MESSAGE,
  );
  return found && { ...found, range: { start, end } };
}

// "41 MB": French writes bytes as octets.
const BYTE_UNITS: Record<string, string> = { KB: "ko", kB: "ko", MB: "Mo", GB: "Go", TB: "To" };

function byteUnits(m: RegExpExecArray): RawFinding | null {
  const unit = BYTE_UNITS[m[0]];
  return unit ? finding(RULE, MESSAGE, m.index, m.index + m[0].length, [unit]) : null;
}

/** Forms of "aller", for "aller au coiffeur". */
const ALLER = new Set(
  "aller vais vas va allons allez vont allé allée allés allées allais allait allions alliez allaient irai iras ira irons irez iront irais irait irions iriez iraient aille ailles aillent".split(
    " ",
  ),
);
const TRADES = new Set(
  "coiffeur coiffeuse médecin docteur dentiste boulanger boulangère boucher bouchère garagiste notaire pharmacien pharmacienne vétérinaire opticien opticienne kiné kinésithérapeute ostéopathe psychologue psy avocat avocate épicier épicière cordonnier ophtalmo ophtalmologue dermatologue gynécologue pédiatre généraliste orthodontiste fleuriste"
    .split(" ")
    .flatMap((w) => [w, `${w}s`]),
);

/** "Il va au coiffeur" -> "chez le coiffeur": one goes to a person's place with "chez". */
function goToTrade(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 3);
  if (!before.some((t, i) => ALLER.has(t.w) && before.slice(0, i).every((b) => ADVERBS.has(b.w))))
    return null;
  const after = tokensAfter(ctx.text, m.index, 3);
  const [article, trade] = word === "à" ? [after[1], after[2]] : [null, after[1]];
  if (word === "à" && article?.w !== "la") return null;
  if (!trade || !TRADES.has(trade.w)) return null;
  const end = article ? article.end : m.index + m[0].length;
  const fix = word === "au" ? "chez le" : word === "aux" ? "chez les" : "chez la";
  return wordFinding(ctx, m.index, ctx.text.slice(m.index, end), [fix], RULE, MESSAGE, {
    start: before.at(-1)!.start,
    end: trade.end,
  });
}

/** "Adressez-vous auprès du guichet" -> "au guichet": one addresses oneself "à" someone. */
function addressedTo(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const skip = (t: Token) =>
    ADVERBS.has(t.w) || /^(?:directement|immédiatement|vous|nous|toi|moi)$/.test(t.w);
  const verb = before.find((t) => !skip(t));
  if (!verb || !/^adress/.test(verb.w)) return null;
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const fix = { de: "à", du: "au", des: "aux", "d'": "à " }[next?.w ?? ""];
  if (!fix) return null;
  return wordFinding(ctx, m.index, ctx.text.slice(m.index, next.end), [fix], RULE, MESSAGE, {
    start: verb.start,
    end: next.end,
  });
}

const REFLEXIVE = new Set(["me", "m'", "te", "t'", "se", "s'", "nous", "vous"]);
const POSSESSIVES = new Set(
  "ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs".split(" "),
);

/** "Je me rappelle de ce jour" -> "Je me rappelle ce jour": "se rappeler" takes a direct object. */
function rememberOf(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (!before || !REFLEXIVE.has(before.w)) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  let i = 0;
  while (i < 2 && ADVERBS.has(after[i]?.w)) i++;
  const de = after[i];
  const next = after[i + 1];
  if (!de || !next) return null;
  let start: number;
  let fix: string;
  if (de.w === "de" && POSSESSIVES.has(next.w)) [start, fix] = [de.start, ""];
  else if (de.w === "du" && !verbReadings(next.w).some((r) => r.slot === "I"))
    [start, fix] = [de.start, "le "];
  else return null;
  return wordFinding(ctx, start, ctx.text.slice(start, next.start), [fix], RULE, MESSAGE, {
    start: before.start,
    end: next.end,
  });
}
// Words after "y a" that need the "ne" written French adds: "il n'y a pas".
const NEGATIVES = new Set(["pas", "plus", "rien", "jamais", "personne", "point", "guère"]);
const Y_A_OPENERS = new Set(["si", "qu'", "que", "mais", "car", "donc", "quand", "comme"]);

/** "Y a un problème", "si y a pas le choix", "qu'y a": spoken French leaves out "il" (and
 * "ne"); written French says "il y a", "s'il n'y a pas", "qu'il y a". */
function spokenYa(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  const opener = before && Y_A_OPENERS.has(before.w) ? before : null;
  if (before && !opener) return null;
  if (!before && !/(?:^|[.!?…,;:(\n])[\s ]*$/u.test(ctx.text.slice(0, m.index))) return null;
  const after = tokensAfter(ctx.text, m.index + 1, 4);
  const k = after[0]?.w === "en" ? 1 : 0;
  const verb = after[k];
  if (verb?.w !== "a" || verb.hyphen) return null;
  // "Y a -t-il": an inversion; "Le recensement, y a dénombré": "y" and a compound tense.
  if (/^[ \t]*-/.test(ctx.text.slice(verb.end, verb.end + 3))) return null;
  const next = after[k + 1]?.w ?? "";
  if (next !== "eu" && verbReadings(next).some((r) => r.slot === "Q")) return null;
  // "y a vraiment personne": the negation word may follow an adverb. "y a plus intéressant"
  // compares: "plus" leaves both readings.
  const word = ADVERBS.has(next) && !NEGATIVES.has(next) ? (after[k + 2]?.w ?? "") : next;
  const nots = word === "plus" ? ["n'", ""] : NEGATIVES.has(word) ? ["n'"] : [""];
  const start = opener?.start ?? m.index;
  const typed = ctx.text.slice(start, m.index + 1);
  const fixes = nots.map((not) => {
    if (opener?.w === "si") return `s'il ${not}y`;
    if (opener?.w === "qu'") return `qu'il ${not}y`;
    if (opener) return `${ctx.text.slice(opener.start, m.index).trimEnd()} il ${not}y`;
    return `il ${not}y`;
  });
  return wordFinding(ctx, start, typed, fixes, RULE, MESSAGE, { start, end: verb.end });
}

const STRESSED_OWNERS: Record<string, [string, string, string]> = {
  moi: ["mon", "ma", "mes"],
  toi: ["ton", "ta", "tes"],
  lui: ["son", "sa", "ses"],
  elle: ["son", "sa", "ses"],
  nous: ["notre", "notre", "nos"],
  vous: ["votre", "votre", "vos"],
  eux: ["leur", "leur", "leurs"],
  elles: ["leur", "leur", "leurs"],
};

/** "C'est la voiture à moi" -> "ma voiture": after "c'est" or "ce sont", the possessive. */
function ownerAfterNoun(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { det, noun, who } = m.groups!;
  const before = tokensBefore(ctx.text, m.index, 3).map((t) => t.w);
  const copula = /^(?:est|sont|était|étaient)$/.test(before[0] ?? "");
  if (!copula || !["c'", "ce"].includes(before[before[1] === "ne" || before[1] === "n'" ? 2 : 1]))
    return null;
  const end = m.index + m[0].length;
  // "à lui seul", "à moi-même": the pronoun is not the owner.
  if (
    /^(?:-|[ \t]+(?:seule?s?|même|aussi|tout|toute|tous|toutes|de|d['’])(?![\p{L}]))/u.test(
      ctx.text.slice(end, end + 8),
    )
  )
    return null;
  // "la lettre à lui adressée": the pronoun goes with the participle after it.
  const next = tokensAfter(ctx.text, end, 1)[0];
  if (next && verbReadings(next.w).some((r) => r.slot === "Q")) return null;
  const article = det.toLowerCase().replace("’", "'");
  const word = noun.toLowerCase();
  if (!isInflectedNoun(word) && !nounGender(word)) return null;
  // "l'amie" -> "mon amie": before a vowel the possessive has its masculine form.
  const [m1, f1, plural] = STRESSED_OWNERS[who.toLowerCase()];
  const owner = article === "les" ? plural : article === "la" ? f1 : m1;
  return wordFinding(ctx, m.index, m[0], [`${owner} ${noun}`], RULE, MESSAGE);
}

/** "Merci pour m'avoir aidé" -> "de m'avoir aidé": thanks take "de" before an infinitive. */
function thanksFor(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 4);
  const thanks = before.findIndex((t) => t.w === "merci" || /^remerci/.test(t.w));
  // "un combat sans merci pour sauver son honneur": the idiom, not thanks.
  if (before[thanks + 1]?.w === "sans") return null;
  if (
    thanks < 0 ||
    !before
      .slice(0, thanks)
      .every((t) => /^(?:beaucoup|encore|infiniment|vous|te|tous|bien)$/.test(t.w))
  )
    return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  let i = 0;
  while (i < 2 && CLITICS.has(after[i]?.w)) i++;
  const verb = after[i];
  if (!verb || !verbReadings(verb.w).some((r) => r.slot === "I")) return null;
  // "merci pour le dîner": an article, not a pronoun, before a noun spelled like a verb.
  if (i > 0 && /^l/.test(after[i - 1].w) && isVerbHomograph(verb.w)) return null;
  const first = after[0];
  const fix = /^[aeiouyhéèêâîôû]/i.test(first.w) ? "d'" : "de ";
  return wordFinding(ctx, m.index, ctx.text.slice(m.index, first.start), [fix], RULE, MESSAGE, {
    start: before[thanks].start,
    end: verb.end,
  });
}

/** "Au final, il a gagné" -> "Finalement"; "au final de la sonate" names the finale. */
function inTheEnd(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const au = tokensBefore(ctx.text, m.index, 1)[0];
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (au?.w !== "au" || au.end + 1 !== m.index || /^d/.test(next?.w ?? "")) return null;
  const typed = ctx.text.slice(au.start, m.index + m[0].length);
  return wordFinding(ctx, au.start, typed, ["finalement", "en fin de compte"], RULE, MESSAGE);
}

const MONTER = new Set(
  "monter monte montes montons montez montent monté montée montés montées montait montaient".split(
    " ",
  ),
);
/** "Il monte en haut." -> "Il monte."; "monter en haut de la tour" names where. */
function upHigh(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const [en, verb] = tokensBefore(ctx.text, m.index, 2);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (en?.w !== "en" || !MONTER.has(verb?.w ?? "") || /^d/.test(next?.w ?? "")) return null;
  const end = m.index + m[0].length;
  return wordFinding(ctx, verb.end, ctx.text.slice(verb.end, end), [""], RULE, MESSAGE, {
    start: verb.start,
    end,
  });
}

/** A word that may open a style finding: a verb calque or the head word of a phrase. */
function styleWord(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  load();
  const word = m[0].toLowerCase();
  if (typedForms!.has(word)) return verbCalque(ctx, m);
  if (word === "au" || word === "aux" || word === "à") return goToTrade(ctx, m);
  if (word === "auprès") return addressedTo(ctx, m);
  if (word === "pour") return thanksFor(ctx, m);
  if (word === "final") return inTheEnd(ctx, m);
  if (word === "haut") return upHigh(ctx, m);
  return null;
}

/** The named frame fixes of grammar/rules/fr.yaml (`fixer:`). */
export const FIXERS = {
  goodNumber,
  byteUnits,
  styleWord: inChunk(styleWord),
  rememberOf: inChunk(rememberOf),
  spokenYa: inChunk(spokenYa),
  ownerAfterNoun: inChunk(ownerAfterNoun),
} satisfies Record<string, MatchFixer>;
