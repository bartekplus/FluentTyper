import { VERB_HOMOGRAPHS, VERB_LEMMAS, VERB_RULES } from "./frenchLexicon.generated";
import { ADJECTIVE_RULES } from "./frenchAdjectives.generated";
import { FEMININE, MASCULINE } from "./frenchGender.generated";
import { NOT_PLURALS, NOUN_GRAPH } from "./frenchNouns.generated";
import { COMPOUNDS, LONG_COMPOUNDS } from "./frenchCompounds.generated";
import { graphWords, WordGraph } from "../wordGraph";
import { memoize } from "../../implementations/helpers/GenericRuleShared";

/** Subject persons as bits: je, tu, il/elle/on, nous, vous, ils/elles. */
export const JE = 1;
export const TU = 2;
export const IL = 4;
export const NOUS = 8;
export const VOUS = 16;
export const ILS = 32;

/** A person bitmask for a finite form; I infinitive, G present participle, Q past participle. */
export type VerbSlot = number | "I" | "G" | "Q";

export interface VerbReading {
  lemma: string;
  slot: VerbSlot;
  /** The rule's flag and tense position, to conjugate the same tense for another person. */
  flag: string;
  tense: number;
}

type Rule = { strip: string; add: string; cond: RegExp; slot: VerbSlot; tense: number };

let rulesByFlag: Map<string, Rule[]> | null = null;
let rulesByEnding: Map<string, Array<Rule & { flag: string }>> | null = null;
let lemmaFlags: Map<string, readonly string[]> | null = null;
let homographs: Set<string> | null = null;

const lowest = (mask: number) => mask & -mask;

function decodeFrontCoded(text: string): string[] {
  let previous = "";
  return text
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      previous = previous.slice(0, parseInt(token[0], 36)) + token.slice(1);
      return previous;
    });
}

function load() {
  if (rulesByFlag) return;
  rulesByFlag = new Map();
  rulesByEnding = new Map();
  let flag = "";
  let common: [string, string] = ["", ""];
  let tense = 0;
  let previous: VerbSlot = "I";
  for (const line of VERB_RULES.split("\n")) {
    const parts = line.split(" ");
    if (line.startsWith("@")) {
      flag = parts[0].slice(1);
      common = [parts[1], parts[2]];
      tense = 0;
      previous = "I";
      rulesByFlag.set(flag, []);
      continue;
    }
    const [add, rawSlot] = parts;
    const [strip, cond] =
      parts.length > 2 ? [parts[2], parts.length > 3 ? parts[3] : parts[2]] : common;
    const slot: VerbSlot = /^\d+$/.test(rawSlot) ? Number(rawSlot) : (rawSlot as VerbSlot);
    // A tense runs je -> ils; a finite rule whose first person is not after the previous rule's
    // starts the next one (variants of one slot share its mask).
    if (typeof slot === "number") {
      if (typeof previous !== "number" || (slot !== previous && lowest(slot) <= lowest(previous)))
        tense++;
    }
    previous = slot;
    const rule = { strip, add, cond: new RegExp(`${cond}$`), slot, tense };
    rulesByFlag.get(flag)!.push(rule);
    const key = add.slice(-1);
    const list = rulesByEnding.get(key) ?? [];
    list.push({ ...rule, flag });
    rulesByEnding.set(key, list);
  }
  lemmaFlags = new Map();
  for (const entry of graphWords(VERB_LEMMAS)) {
    const bar = entry.indexOf("|");
    lemmaFlags.set(entry.slice(0, bar), entry.slice(bar + 1).match(/../g) ?? []);
  }
  homographs = new Set(graphWords(VERB_HOMOGRAPHS));
}

/** Every verb reading of a lowercase word form, from the bundled dictionary's conjugations.
 * Detectors ask about the same words many times per chunk: the answers are cached. */
export const verbReadings = memoize(readingsOf, 5_000);

function readingsOf(word: string): VerbReading[] {
  load();
  const out: VerbReading[] = [];
  for (const key of [word.slice(-1), ""]) {
    for (const rule of rulesByEnding!.get(key) ?? []) {
      if (!word.endsWith(rule.add)) continue;
      const lemma = word.slice(0, word.length - rule.add.length) + rule.strip;
      if (!rule.cond.test(lemma) || !lemmaFlags!.get(lemma)?.includes(rule.flag)) continue;
      out.push({ lemma, slot: rule.slot, flag: rule.flag, tense: rule.tense });
    }
  }
  return out;
}

/** The persons a word can agree with as a finite verb (0 when it is not one). */
export function finitePersons(word: string): number {
  let mask = 0;
  for (const { slot } of verbReadings(word)) if (typeof slot === "number") mask |= slot;
  return mask;
}

/** The lemma's forms in a reading's tense for a person. */
export function conjugate(reading: VerbReading, person: number): string[] {
  load();
  const forms = new Set<string>();
  for (const rule of rulesByFlag!.get(reading.flag) ?? []) {
    if (rule.tense !== reading.tense || typeof rule.slot !== "number" || !(rule.slot & person))
      continue;
    if (!rule.cond.test(reading.lemma) || !reading.lemma.endsWith(rule.strip)) continue;
    forms.add(reading.lemma.slice(0, reading.lemma.length - rule.strip.length) + rule.add);
  }
  if (!forms.size && reading.tense > 2) return subjunctivePlural(reading, person);
  return [...forms];
}

/**
 * The dictionary spells the present subjunctive's plural only where it differs from the
 * indicative, so that tense ends at "il": "ils prennent" is the present's, "nous prenions" and
 * "vous preniez" the imperfect's, for a tense whose singular is in -e ("prenne").
 */
function subjunctivePlural(reading: VerbReading, person: number): string[] {
  if (person !== IL && person !== NOUS && person !== VOUS && person !== ILS) return [];
  const singular = conjugate(reading, JE).find((form) => form.endsWith("e"));
  if (!singular) return [];
  // "qu'il aille": a "je" form in -e that the dictionary does not repeat for "il".
  if (person === IL) return [singular];
  const stem = singular.slice(0, -1);
  if (person === ILS)
    return conjugate({ ...reading, tense: 1 }, ILS).filter((form) => form === `${stem}ent`);
  return conjugate({ ...reading, tense: 2 }, person);
}

/** A verb's masculine singular past participle ("compris", "reçu"), the shortest Q form. */
export function pastParticiple(lemma: string): string | null {
  load();
  let best: string | null = null;
  for (const flag of lemmaFlags!.get(lemma) ?? []) {
    for (const rule of rulesByFlag!.get(flag) ?? []) {
      if (rule.slot !== "Q" || !rule.cond.test(lemma) || !lemma.endsWith(rule.strip)) continue;
      const form = lemma.slice(0, lemma.length - rule.strip.length) + rule.add;
      if (!best || form.length < best.length) best = form;
    }
  }
  return best;
}

/** Whether the lemma is a dictionary verb. */
export function isVerbLemma(lemma: string): boolean {
  load();
  return lemmaFlags!.has(lemma);
}

/** A verb form that is also spelled by a non-verb entry: "porte", "passé", "dîner". */
export function isVerbHomograph(word: string): boolean {
  load();
  return homographs!.has(word);
}

let compounds: Set<string> | null = null;

/** Whether the dictionary spells this lowercase two-part compound with a hyphen. */
export function isDictionaryCompound(word: string): boolean {
  compounds ??= new Set(graphWords(COMPOUNDS));
  return compounds.has(word);
}

let longCompounds: Map<string, string[]> | null = null;

/** The dictionary's hyphenated names and three-part compounds whose first part is `first`
 * (case as typed): "Aix" -> ["Aix-en-Provence", "Aix-la-Chapelle", ...]. */
export function compoundsStartingWith(first: string): readonly string[] {
  if (!longCompounds) {
    longCompounds = new Map();
    for (const word of graphWords(LONG_COMPOUNDS)) {
      const key = word.slice(0, word.indexOf("-"));
      const list = longCompounds.get(key) ?? [];
      list.push(word);
      longCompounds.set(key, list);
    }
  }
  return longCompounds.get(first) ?? [];
}

let nounGraph: WordGraph | null = null;
let notPlurals: Set<string> | null = null;

/** The gender-inflecting flags of a masculine singular entry ("grand" -> ["F."]), else []. */
function adjectiveFlags(word: string): string[] {
  nounGraph ??= new WordGraph(NOUN_GRAPH);
  const [flags] = nounGraph.completions(`${word}|`);
  return flags?.match(/../g) ?? [];
}

/** Whether the word is itself a noun or adjective entry: a singular ("maison", "grand") or an
 * invariable word in s or x ("fils", "temps"), not a plural ("maisons"). */
export function isNounLemma(word: string): boolean {
  nounGraph ??= new WordGraph(NOUN_GRAPH);
  if (!nounGraph.has(word) && !adjectiveFlags(word).length) return false;
  // A verb form no other entry spells is exactly known: "dîné" is no noun.
  return !verbReadings(word).length || isVerbHomograph(word);
}

/** The singulars a regular plural may come from: "maisons" -> "maison", "chevaux" -> "cheval". */
export function pluralSingulars(word: string): string[] {
  const out: string[] = [];
  if (/aux$/.test(word)) out.push(`${word.slice(0, -3)}al`);
  if (/[sx]$/.test(word)) out.push(word.slice(0, -1));
  return out;
}

/** Whether the dictionary inflects this lowercase word as a noun or adjective: an entry
 * (isNounLemma) or a regular plural of one ("enfants", "cheveux", "chevaux"). */
export function isInflectedNoun(word: string): boolean {
  if (isNounLemma(word)) return true;
  if (verbReadings(word).length && !isVerbHomograph(word)) return false;
  notPlurals ??= new Set(decodeFrontCoded(NOT_PLURALS));
  return !notPlurals.has(word) && pluralSingulars(word).some(isNounLemma);
}

// Invariable words the verb and noun lists leave out, vowel- or y-initial ones: what an elision
// runs into.
const FUNCTION_WORDS = new Set(
  (
    "il ils elle elles on en y un une à au aux avec après avant aussi alors ainsi assez autant " +
    "autour autre autres aucun aucune auprès aujourd'hui ailleurs afin encore ensuite ensemble " +
    "entre envers environ et est ici ou où oui eux enfin hier aussitôt autrefois auparavant " +
    "emblée exprès ô"
  ).split(" "),
);

/** Whether a lowercase word is French as far as the bundled lists know: a verb form, a noun or
 * adjective (singular or plural), an -ment adverb or a function word. Foreign words ("also",
 * "up", "off") are not. */
export function isFrenchWord(word: string): boolean {
  if (FUNCTION_WORDS.has(word) || word.endsWith("ment")) return true;
  return verbReadings(word).length > 0 || isInflectedNoun(word);
}

export type Gender = "m" | "f";

// Endings that give a noun its gender (null: an ending of both genders, which stops a shorter
// ending). The longest ending that matches wins. Exceptions are in the generated lists (from the
// n-gram counts), in SUFFIX_EXCEPTIONS or in EITHER_GENDER.
const SUFFIX_GENDER: ReadonlyArray<[string, Gender | null]> = (
  [
    // Feminine.
    ["graphie", "f"],
    ["logie", "f"],
    ["ssure", "f"],
    ["eille", "f"],
    ["ture", "f"],
    ["erie", "f"],
    ["euse", "f"],
    ["ité", "f"],
    ["tion", "f"],
    ["sion", "f"],
    ["xion", "f"],
    ["gion", "f"],
    ["nion", "f"],
    ["aison", "f"],
    ["oison", "f"],
    ["trice", "f"],
    ["ance", "f"],
    ["ence", "f"],
    ["esse", "f"],
    ["ette", "f"],
    ["ure", "f"],
    ["té", "f"],
    ["tié", "f"],
    ["ée", "f"],
    ["ie", "f"],
    ["ue", "f"],
    ["ade", "f"],
    ["ude", "f"],
    ["ine", "f"],
    ["ière", "f"],
    ["elle", "f"],
    ["ille", "f"],
    ["ise", "f"],
    ["ose", "f"],
    ["use", "f"],
    ["ase", "f"],
    ["èse", "f"],
    // Masculine.
    ["illon", "m"],
    ["isme", "m"],
    ["ment", "m"],
    ["eau", "m"],
    ["ier", "m"],
    ["age", "m"],
    ["nt", "m"],
    ["sme", "m"],
    ["au", "m"],
    ["ail", "m"],
    ["eil", "m"],
    ["euil", "m"],
    ["ueil", "m"],
    ["oir", "m"],
    ["er", "m"],
    ["ing", "m"],
    ["et", "m"],
    ["at", "m"],
    ["ot", "m"],
    ["ut", "m"],
    ["out", "m"],
    ["oût", "m"],
    ["ac", "m"],
    ["ec", "m"],
    ["ic", "m"],
    ["oc", "m"],
    ["uc", "m"],
    ["um", "m"],
    ["on", "m"],
    ["ou", "m"],
    ["in", "m"],
    ["é", "m"],
    ["eu", "m"],
    ["ème", "m"],
    ["ège", "m"],
    ["al", "m"],
    ["ard", "m"],
    ["oi", "m"],
    ["us", "m"],
    ["is", "m"],
    // Masculine inside a feminine ending: "chlorure", "dinosaure", "glucose", "diocèse".
    ["aure", "m"],
    ["orure", "m"],
    ["omure", "m"],
    ["odure", "m"],
    ["lfure", "m"],
    ["rbure", "m"],
    ["trure", "m"],
    ["phure", "m"],
    ["anure", "m"],
    ["ctose", "m"],
    ["ucose", "m"],
    ["xtrose", "m"],
    ["charose", "m"],
    ["iocèse", "m"],
    ["ganèse", "m"],
    // Both genders.
    ["ison", null],
    ["çon", null],
    ["sson", null],
    ["oine", null],
    ["ième", null],
    ["gue", null],
    ["que", null],
  ] as Array<[string, Gender | null]>
).sort((a, b) => b[0].length - a[0].length);
// Endings that also gender a participle ("la félicité") or a form of a gender-inflecting entry
// ("le plombier"); the others skip them ("pendant", "général").
const WIDE_ENDINGS = new Set(
  (
    "graphie logie aison ssure trice eille illon tion sion xion ture ance ence esse ette erie " +
    "euse isme ment ité age eau ail eil oir ier ing et at"
  ).split(" "),
);

/** Exceptions to the endings (null: either gender). */
const SUFFIX_EXCEPTIONS = new Map<string, Gender | null>([
  ...(
    "silence bastion cation comité côté quinté karité comté pâté aparté thé karaté lycée musée " +
    "trophée mausolée apogée scarabée caducée périnée pygmée camée colisée gynécée hyménée " +
    "coryphée prytanée empyrée macchabée spondée trochée propylée nymphée périgée hypogée " +
    "pédigrée cookie foie génie incendie messie parapluie sosie amphibie zombie brownie hippie " +
    "yuppie brie stade grade jade coude prélude interlude postlude domaine magazine " +
    "trampoline pipeline tajine cimetière violoncelle vermicelle polichinelle libelle " +
    "portefeuille chèvrefeuille millefeuille gorille vaudeville quadrille codicille braille " +
    "bidonville trille poison murmure mercure parjure augure cyanure hydrure hydrocarbure silure " +
    "cytise penthouse gymnase pégase dièse suspense squelette diocèse iodure"
  )
    .split(" ")
    .map((w): [string, Gender] => [w, "m"]),
  ...(
    "jument dent gent image plage cage nage rage peau clé télé psyché acné nounou main catin " +
    "blockchain cuiller newsletter fois oasis souris brebis catharsis syphilis propolis " +
    "paroi chanson crème bohème trirème suspicion prison trahison guérison garnison"
  )
    .split(" ")
    .map((w): [string, Gender] => [w, "f"]),
  ...(
    "sage sauvage volage capitaine maussade rétrograde prude tranquille grandiose morose mature " +
    "obèse super hyper synopsis noël cache"
  )
    .split(" ")
    .map((w): [string, null] => [w, null]),
]);

// Nouns of either gender: people named by one form ("un/une élève") and words whose gender
// changes their meaning ("le/la tour"). Endings of people's names are covered as a whole.
const EITHER_GENDER = new Set(
  (
    "enfant élève ministre secrétaire collègue camarade adulte malade partenaire bénévole " +
    "responsable membre juge guide garde interprète philosophe stagiaire cadre aide concierge " +
    "complice architecte astronaute pilote poète médecin professeur auteur docteur ingénieur chef " +
    "écrivain peintre maire témoin mannequin successeur prédécesseur défenseur entrepreneur " +
    "amateur sénateur gouverneur procureur notaire libraire vétérinaire militaire fonctionnaire " +
    "tour livre poste mode manche voile page moule somme vase critique mémoire physique pendule " +
    "crêpe greffe merci pupille radio solde office espace œuvre orge hymne foudre enseigne faune " +
    "finale geste mousse ombre parallèle platine pourpre relâche vague gens amour délice orgue " +
    "pâque couple interview chose personne propre comptable coupable contribuable notable " +
    "nomade rose virtuose athée rebelle marine poêle mort coche laque mauve putain box focus holding designer manager reporter trader supporter leader gamer surfer dealer " +
    "blogger rapper speaker biker loser"
  ).split(" "),
);
const EITHER_ENDINGS = /(?:iste|logue|graphe|naute|aire|crate|phile|phobe|cide)$/;
// Adverbs, prepositions and numbers that are also nouns ("le devant", "le plus", "un cent"):
// mostly not nouns, so they take no gender.
const NO_GENDER = new Set(
  "plus moins pas avant devant derrière dessus dessous arrière environ abord cent mille trois".split(
    " ",
  ),
);

let genders: Map<string, Gender> | null = null;

function loadGenders() {
  if (genders) return;
  genders = new Map();
  for (const w of graphWords(MASCULINE)) genders.set(w, "m");
  for (const w of graphWords(FEMININE)) genders.set(w, "f");
  for (const [list, gender] of [
    [AUTHORED_MASCULINE, "m"],
    [AUTHORED_FEMININE, "f"],
  ] as const)
    for (const w of list.split(" ")) if (!genders.has(w)) genders.set(w, gender);
}

/** Whether a noun has one gender by the authored lists and endings (the n-gram lists aside). */
export function authoredGenderable(word: string): boolean {
  return !EITHER_GENDER.has(word) && !NO_GENDER.has(word) && !EITHER_ENDINGS.test(word);
}

/** Whether a noun has one gender this module may tell: not a noun of either gender, unless a
 * list names its gender ("le salaire" against "un/une notaire"). */
export function genderable(word: string): boolean {
  loadGenders();
  if (EITHER_GENDER.has(word) || NO_GENDER.has(word)) return false;
  return !EITHER_ENDINGS.test(word) || genders!.has(word);
}

/** The gender a noun's ending gives it, if any. A plural ("fourmis") takes no gender from an
 * ending in s. */
export function suffixGender(word: string): Gender | null {
  if (SUFFIX_EXCEPTIONS.has(word)) return SUFFIX_EXCEPTIONS.get(word)!;
  const match = SUFFIX_GENDER.find(
    ([ending]) => word.endsWith(ending) && word.length > ending.length + 1,
  );
  if (!match || !match[1]) return null;
  const [ending, gender] = match;
  if (/[sx]$/.test(ending) && !isNounLemma(word)) return null;
  if (WIDE_ENDINGS.has(ending)) return gender;
  // "manger", "pendant", "requis": an infinitive, a present participle or a masculine past
  // participle ("arrivée" keeps its ending); "client", "général": a form of a gender-inflecting
  // entry, whose own forms tell its gender.
  const verbal = ["I", "G", gender === "m" || ending.endsWith("é") ? "Q" : "I"];
  if (verbReadings(word).some((r) => verbal.includes(r.slot as string))) return null;
  return adjectiveReadings(word).length ? null : gender;
}

// Common nouns whose gender neither the n-gram counts nor an ending tell (authored; the
// generated lists win where they know the word).
const AUTHORED_MASCULINE =
  "mois euro avis match record litre humour mouton alcool milliard drap copain canard honneur " +
  "habit virus volcan devis chœur horizon colis atlas légume tennis croc algorithme jambon " +
  "abandon pneu kilo moine bienfait rocher dégât champignon complot bourg hibou semestre minuit " +
  "bisou pignon bonbon bond refus pronom gant hydrocarbure processus oncle ouragan violon ongle " +
  "pieu biscuit uniforme trombone artifice trophée rail ennui crampon rein hospice flanc atome " +
  "gabarit auditoire grief aéroport escroc palais référendum coupon arbuste vison diapason " +
  "bandit renne faîte accroc aluminium patio lupin brigand azur canon zeppelin tympan cadran " +
  "divan musée lycée scarabée mausolée apogée athée caducée bois bonus souvenir biais sourire " +
  "acquis mérite coach amont mets préavis dîner comble paradis exposé arôme résidu débris goûter " +
  "relais plancher prospect cil marbre abus coloris vœu prétexte cannabis fitness ustensile " +
  "tracas préjugé dépit enthousiasme tenon surplus frelon drone cursus péril grade combustible " +
  "engrais essor sourcil apôtre plâtre pois solo aléa foot phare transit recoin carrefour " +
  "harnais podcast consensus glamour adieu pastel châssis spot gluten désaccord implant diesel " +
  "pronostic lavabo raisin trône bronze semblant jeton satellite instinct prion pli termite " +
  "jacuzzi stéréotype laiton germe revers chaton égout bistrot whisky intervalle microbe " +
  "surcroît attribut puzzle bal pore triangle porc campus soja cholestérol triomphe hectare " +
  "dividende engin safari haricot intitulé ego éclair sodium pasteur cacao empire reproche " +
  "cliché concentré imprimé moustique chlore formulaire salaire dialogue mars septembre " +
  "commentaire mai anniversaire octobre décembre novembre bonjour avril août bus paragraphe " +
  "catalogue horaire synonyme annuaire itinéraire séminaire vocabulaire questionnaire silicone " +
  "documentaire exemplaire os logos flash wifi sanctuaire inventaire dictionnaire luminaire " +
  "millénaire cylindre yaourt conservatoire monoxyde bec cidre périple clip baume monastère " +
  "scandale arc paradigme répit grès trio latex psaume spam coq badge feutre pollen fusil nickel " +
  "comprimé balai karma hockey index lustre quiz short laps jeans compresseur mix ascenseur " +
  "dentifrice différend gong dilemme polyuréthane parasol désastre show cash repli insecticide " +
  "mentor cube proverbe judo bingo déclencheur peigne quad processeur capricorne édifice " +
  "génocide décolleté défilé décompte référé porno rosé parapente timbre étang dé pyjama radar " +
  "horoscope cumul exergue legs persil chili leurre rempart rite scellé cortisol massacre singe " +
  "polystyrène shiatsu frisson infrarouge oxygène raccourci dôme diagramme folio soupçon oubli " +
  "repentir labeur cèdre plaid hydrogène délire porto blues lexique sandwich nectar calvaire " +
  "vestiaire millésime prototype pixel polo tournesol tumulte cadavre rallye tonnerre cerf sabre " +
  "déluge handball malentendu verdict concile loft gouffre joug phosphore webcam diaporama " +
  "quinoa cartable delta parachute titane reflux body bitume soufre connecteur binôme étui dogme " +
  "mascara colloque évangile gala cadenas kiosque buisson showroom square centime fenouil loto " +
  "district zoo buste fard galop tempo mât teck concombre contreplaqué tramway avatar microphone " +
  "saphir enclos mug trépied préambule exode gravats carrousel exploit caviar plexiglas " +
  "hélicoptère rebord diaphragme insert hypertexte lierre yacht baromètre totem antivol denim " +
  "surnom bug farniente proxy sacerdoce polymère remords polycarbonate amiante brunch raccord " +
  "recto verso boom rosaire monologue prologue épilogue repère change rire envol chrome yeux " +
  "palace mécène méfait plasma vertige antidote sponsor calibre dolmen menhir ion éloge gendarme " +
  "rhume cor tic val marshmallow";
const AUTHORED_FEMININE =
  "rumeur onde ballade amande compagne aile corvée cape cerise averse psychose autoroute arête " +
  "dune datte molécule grange contrepartie olive artère madeleine hélice secousse dynastie " +
  "myrtille larme glacière falaise berline bravoure bourrasque ordure patate sacoche cotte " +
  "améthyste perdrix contrebasse horreur candeur ardeur pâleur rougeur blancheur minceur " +
  "grosseur clameur torpeur stupeur langueur rancœur teneur moiteur tiédeur froideur laideur " +
  "raideur rondeur senteur intempérie marchandise coordonnée recharge racine tombe bactérie " +
  "laine graine tuile décennie destinée vitamine résine foire traite patte herbe épaule paie " +
  "enceinte remarque fraude particule panique céréale perle consigne rayure guêpe farine " +
  "allergie faille épice archive plume balise frappe poussée lentille brique paille aptitude " +
  "renommée algue enchère ride puce toxine manœuvre flèche vidange fesse papille statue " +
  "inquiétude décharge cendre denrée guirlande cuisse traversée dentelle aiguille anxiété " +
  "rouille selle mouche chapelle canne cloison impureté lacune carotte larve régie devise mèche " +
  "vogue pitié révolte trame brûlure gueule coupure gencive culotte cloche bouchée envergure " +
  "maille altitude coulisse nappe chèvre angoisse haleine bordure cheville friandise poupée " +
  "bille sandale fraise jante banane bretelle synergie cartouche griffe cannelle fée oasis " +
  "cascade poutre poutine souris liste affaire revanche piste grammaire flotte coque fabrique " +
  "console glisse cote file réclame pile paye trompe aire info lessive peluche annexe pédale " +
  "boxe retouche voûte remorque hotte tôle sangle pelle javel frange perruque rime récidive " +
  "croûte souche traîne salive entrave grêle polémique bascule attache pyramide pilule caravane " +
  "rampe sirène tante blague loupe torche louange sonde dispute cravate tisane réplique maxime " +
  "fente antenne bosse moutarde startup escale bâtisse loge intrigue fresque gomme barque forge " +
  "chape tumeur élite pétanque auberge palme hormone audace halte capsule arnaque marguerite " +
  "injustice mare peste brume flûte longe nef controverse banne spatule pellicule bûche licorne " +
  "énigme meute trappe corne brocante dinde jauge trêve poire secte épingle brèche truffe mue " +
  "cocotte perche argile sauge carafe caverne ruse vanne syntaxe crête fourche rallonge chaire " +
  "transe citerne galère carcasse capuche pipe hache taupe broche embauche liqueur déprime " +
  "paranoïa orthographe offrande microfibre gymnastique apocalypse marne plancha prépa auto " +
  "estime serre pousse relève conserve découpe invite moustiquaire péniche encre seiche " +
  "réprimande égide dépêche émeute entraide macédoine bouilloire java vulgate quiche biche " +
  "friche";

/** A singular noun's gender from the generated or authored lists or its ending; null when either
 * or unknown. */
export function nounGender(word: string): Gender | null {
  if (!genderable(word)) return null;
  const gender = genders!.get(word) ?? endingGender(word);
  // "les cours" of "la cour" and "le cours": a word in s that is also the plural of a singular of
  // the other gender tells nothing.
  if (gender && /[sx]$/.test(word)) {
    const other = pluralSingulars(word).filter((s) => s !== word && isNounLemma(s));
    if (other.some((s) => nounGender(s) && nounGender(s) !== gender)) return null;
  }
  return gender;
}

/** The gender a noun's ending gives it when no list names it (genderable words only). */
export function endingGender(word: string): Gender | null {
  if (EITHER_ENDINGS.test(word) || !isInflectedNoun(word)) return null;
  // "invité": an ending a gendered adjective or noun form contradicts tells nothing.
  const suffix = suffixGender(word);
  if (suffix && adjectiveReadings(word).some((r) => r.slot[0] !== suffix)) return null;
  return suffix;
}

/** Masculine/feminine and singular/plural. */
export type Inflection = "ms" | "mp" | "fs" | "fp";

export interface AdjectiveReading {
  /** The masculine singular entry. */
  lemma: string;
  flag: string;
  slot: Inflection;
}

type AdjectiveRule = { add: string; slot: Inflection; strip: string; cond: RegExp };
let adjectiveRules: Map<string, AdjectiveRule[]> | null = null;

function loadAdjectives() {
  if (adjectiveRules) return;
  adjectiveRules = new Map();
  let list: AdjectiveRule[] = [];
  for (const line of ADJECTIVE_RULES.split("\n")) {
    if (line.startsWith("@")) {
      list = [];
      adjectiveRules.set(line.slice(1), list);
      continue;
    }
    const [add, slot, strip, cond] = line.split(" ").map((part) => (part === "0" ? "" : part));
    list.push({ add, slot: slot as Inflection, strip, cond: new RegExp(`${cond}$`) });
  }
}

/** The gender and number readings of a lowercase adjective (or gendered noun) form. */
export const adjectiveReadings = memoize(adjectiveReadingsOf, 5_000);

function adjectiveReadingsOf(word: string): AdjectiveReading[] {
  loadAdjectives();
  const out: AdjectiveReading[] = [];
  const lemmaFlags = new Map<string, string[]>();
  for (const [flag, rules] of adjectiveRules!) {
    for (const rule of rules) {
      if (!word.endsWith(rule.add)) continue;
      const lemma = word.slice(0, word.length - rule.add.length) + rule.strip;
      if (!rule.cond.test(lemma)) continue;
      if (!lemmaFlags.has(lemma)) lemmaFlags.set(lemma, adjectiveFlags(lemma));
      if (!lemmaFlags.get(lemma)!.includes(flag)) continue;
      out.push({ lemma, flag, slot: rule.slot });
      // "frais", "gris": a masculine in s, x or z is its own plural.
      if (rule.slot === "ms" && /[sxz]$/.test(lemma)) out.push({ lemma, flag, slot: "mp" });
      // "drôle", "maître": a form in -e whose -esse form is a noun is also the feminine.
      if (flag === "F+" && rule.add.length < 2 && /e$/.test(lemma) && rule.slot[0] === "m")
        out.push({ lemma, flag, slot: rule.slot === "ms" ? "fs" : "fp" });
    }
  }
  return out;
}

/** A reading's forms for another gender and number. */
export function inflect(reading: AdjectiveReading, slot: Inflection): string[] {
  loadAdjectives();
  const forms = new Set<string>();
  for (const rule of adjectiveRules!.get(reading.flag) ?? []) {
    const ms = rule.slot === "ms" && slot === "mp" && /[sxz]$/.test(reading.lemma);
    if ((rule.slot !== slot && !ms) || !rule.cond.test(reading.lemma)) continue;
    if (!reading.lemma.endsWith(rule.strip)) continue;
    forms.add(reading.lemma.slice(0, reading.lemma.length - rule.strip.length) + rule.add);
  }
  return [...forms];
}
