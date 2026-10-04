import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  IL,
  ILS,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  JE,
  nounGender,
  NOUS,
  pluralSingulars,
  TU,
  verbReadings,
  VOUS,
} from "./frenchLexicon";
import { ownedFrenchWords, tokensBefore, type Token } from "./frenchTokens";
import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";
import { isLang } from "../phraseTemplates";

// A verb's object noun takes a determiner: "il ferme porte." -> "il ferme la porte", "j'ai
// baissé store." -> "un store". Read only at the end of a clause, right after a pronoun
// subject and its verb, where a bare noun is a locution ("il prend froid", "elle porte
// plainte") or a missing determiner.

const RULE = "frenchNounGender";
const MESSAGE = "review_msg_fr_missing_determiner";

const PERSON: Record<string, number> = {
  je: JE,
  "j'": JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
// Possessives by person: masculine, feminine, plural.
const POSSESSIVE: Record<number, [string, string, string]> = {
  [JE]: ["mon", "ma", "mes"],
  [TU]: ["ton", "ta", "tes"],
  [IL]: ["son", "sa", "ses"],
  [NOUS]: ["notre", "notre", "nos"],
  [VOUS]: ["votre", "votre", "vos"],
  [ILS]: ["leur", "leur", "leurs"],
};

// Verbs that take a bare attribute, a bare topic, a time or a manner after them: "il devient
// médecin", "il parle affaires", "il travaille dimanche", "il sort vainqueur", "il dit merci".
const NO_OBJECT = new Set(
  (
    "avoir être devenir rester demeurer sembler paraître naître mourir vivre finir terminer " +
    "sortir partir arriver revenir tomber passer parler aller venir retourner entrer rentrer " +
    "monter descendre valoir coûter peser mesurer compter voter dire répondre travailler dormir " +
    "habiter rouler chausser voir sentir chanter sonner falloir manquer nommer élire appeler " +
    "juger considérer croire signer danser étudier enseigner apprendre réviser jurer crier " +
    "risquer miser parier penser rêver commencer continuer durer rester sauter courir marcher"
  ).split(" "),
);

// Bare nouns of locutions and other words a verb takes without a determiner.
const BARE = new Set(
  // Locutions: "prendre part", "faire peur", "porter plainte", "rendre visite".
  (
    "part peur faim soif mal raison tort pied fin feu place forme corps racine soin garde " +
    "conscience congé position note acte contact goût plaisir pitié patience courage langue " +
    "face confiance semblant attention honte envie signe partie fortune faillite naufrage " +
    "carrière défaut appel date foi recette office obstacle écho étape escale halte silence " +
    "surface irruption route marche merveille sensation scandale sens légion loi preuve usage " +
    "suite lieu naissance satisfaction cours ordre espoir connaissance haleine compte parole " +
    "tête compagnie rigueur rancune visite service hommage justice grâce plainte secours " +
    "malheur bonheur atteinte préjudice chance conseil assistance terme asile refuge moyen " +
    "preneur victoire famine gare vengeance prise casaque bride querelle noise monnaie campagne " +
    "retraite pavillon mesure temps terrain boutique bataille effet jour nuit soleil gaffe " +
    "cause droit besoin horreur hâte affaire recours trait coutume tendance charge vocation " +
    "accès priorité intérêt cœur coeur idée avantage mission autorité peine force valeur gain " +
    "main fait objet référence allusion mention état figure illusion école mouche débat tache " +
    "souche polémique grève front bloc masse nombre mine don vœu voeu serment relâche diète " +
    "carême ripaille bombance trempette dodo pipi caca tilt parti profit domicile possession " +
    "rang ombrage exemple modèle femme mari époux épouse fiancée contenance pardon audience " +
    "réparation table cash crédit comptant acompte quartier relais exception erreur tout rien " +
    "famille maison carbone fleurette chemin pièce passage ruine tribut culotte vie gorge chorus " +
    // Interjections and greetings a verb quotes: "il dit merci", "elle répond présent".
    "merci bonjour bonsoir adieu amen stop bravo oui non salut chapeau bingo pouce " +
    // Family words used as names, times, roles and subjects of study.
    "maman papa mamie mamy papi papy tonton tata mémé pépé bébé chéri chérie lundi mardi " +
    "mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin juillet août " +
    "septembre octobre novembre décembre matin soir midi minuit demain aujourd'hui semaine " +
    "gardien attaquant défenseur arrière ailier milieu avant pivot meneur titulaire remplaçant " +
    "médecine droit lettres philo philosophie maths mathématiques physique chimie biologie " +
    "informatique économie sciences histoire géographie solo duo trio bis pile"
  ).split(" "),
);

const SUBJECT_OPENERS = new Set(
  "et mais ou donc car que qu' quand si puis alors lorsque lorsqu' puisque puisqu' comme où".split(
    " ",
  ),
);
const INDIRECT = new Set(["lui", "leur"]);

const finite = (word: string, person: number) =>
  verbReadings(word).filter((r) => typeof r.slot === "number" && (r.slot & person) > 0);

/** The person of a pronoun subject that opens its clause at `before[i]`, or 0. */
function subjectAt(before: Token[], i: number): number {
  const subject = before[i];
  if (!subject || !(subject.w in PERSON)) return 0;
  const opener = before[i + 1];
  return !opener || SUBJECT_OPENERS.has(opener.w) ? PERSON[subject.w] : 0;
}

/** The person of the subject when `before` is a pronoun subject, maybe "lui"/"leur", and a
 * finite verb that takes an object; or a pronoun, avoir and a participle. 0 otherwise. */
function objectVerbPerson(before: Token[]): number {
  const [verb] = before;
  if (!verb || verb.hyphen || verb.w.length < 2) return 0;
  // "j'ai baissé store": avoir and a participle.
  const participle = verbReadings(verb.w).find((r) => r.slot === "Q");
  if (participle && !NO_OBJECT.has(participle.lemma) && !isVerbHomograph(verb.w)) {
    const person = subjectAt(before, 2);
    const auxiliary = before[1];
    if (person && auxiliary && finite(auxiliary.w, person).some((r) => r.lemma === "avoir"))
      return person;
  }
  const i = INDIRECT.has(before[1]?.w ?? "") ? 2 : 1;
  const person = subjectAt(before, i);
  if (!person) return 0;
  const readings = finite(verb.w, person);
  return readings.length && readings.every((r) => !NO_OBJECT.has(r.lemma)) ? person : 0;
}

const VOWEL = /^[aeiouyàâäéèêëîïôöûùüœæ]/;

/** "porte" -> ["une porte", "la porte", "sa porte"]; [] when the noun is not plainly a noun. */
function determined(word: string, person: number): string[] {
  const plural =
    /[sx]$/.test(word) && !isNounLemma(word) && pluralSingulars(word).some(isNounLemma);
  const possessive = POSSESSIVE[person];
  if (plural) return [`des ${word}`, `les ${word}`, `${possessive[2]} ${word}`];
  const gender = nounGender(word);
  if (!gender) return [];
  const vowel = VOWEL.test(word);
  const article = vowel ? `l'${word}` : `${gender === "m" ? "le" : "la"} ${word}`;
  const owner = gender === "f" && !vowel ? possessive[1] : possessive[0];
  return [`${gender === "m" ? "un" : "une"} ${word}`, article, `${owner} ${word}`];
}

/** A noun as far as the lists know, and nothing else: no adjective, adverb or verb form only. */
function plainNoun(word: string): boolean {
  if (word.length < 3 || BARE.has(word) || word.endsWith("ment") || word.startsWith("h"))
    return false;
  if (adjectiveReadings(word).length) return false;
  if (verbReadings(word).length && !isVerbHomograph(word)) return false;
  // "il prend parti", "elle a fini premier": a participle or a word in -é is no plain noun.
  if (verbReadings(word).some((r) => r.slot === "Q" || r.slot === "I")) return false;
  return isInflectedNoun(word);
}

function bareNoun(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0];
  const end = m.index + word.length;
  // The scan text may cut the clause short: read its end in the full text.
  if (!/^[ \t\u00a0]*(?:[.!?…;,]|$)/u.test(ctx.text.slice(end, end + 20))) return null;
  if (ctx.dictionary.has(word) || !plainNoun(word)) return null;
  const before = tokensBefore(ctx.text, m.index, 5);
  const person = objectVerbPerson(before);
  if (!person || namedExampleBefore(ctx.text, m.index)) return null;
  const alternatives = determined(word, person);
  if (!alternatives.length) return null;
  const subject = before.find((t) => t.w in PERSON)!;
  return finding(RULE, MESSAGE, m.index, end, alternatives, {
    context: { start: subject.start, end },
    requiresChoice: true,
  });
}

// A lowercase word that closes its clause.
const CLAUSE_END_WORD =
  /(?<![\p{L}\p{M}\p{N}_'’-])\p{Ll}[\p{Ll}\p{M}]{2,}(?=[ \t ]*(?:[.!?…;,]|$))/gu;

function bareNouns(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CLAUSE_END_WORD)) {
    const found = bareNoun(ctx, m);
    if (found) findings.push(found);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: bareNouns }];
