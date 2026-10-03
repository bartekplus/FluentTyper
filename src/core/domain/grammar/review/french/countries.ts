import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { verbReadings } from "./frenchLexicon";
import { ownedFrenchWords, tokensBefore, wordFinding } from "./frenchTokens";

// "Je vais au France" -> "en France", "il vit en Portugal" -> "au Portugal": a country takes
// "en" when feminine or vowel-initial, "au" when masculine, "aux" when plural, and "à" when it
// has no article (islands, city-states).

const RULE = "frenchNounGender";
const MESSAGE = "review_msg_fr_country_preposition";

type Kind = "en" | "au" | "aux" | "à";
const COUNTRIES = new Map<string, Kind>();
const add = (kind: Kind, names: string) => {
  for (const name of names.split(",")) COUNTRIES.set(name.trim(), kind);
};
add(
  "en",
  "France, Belgique, Suisse, Allemagne, Autriche, Espagne, Italie, Grèce, Pologne, Hongrie, " +
    "Roumanie, Bulgarie, Croatie, Serbie, Slovénie, Slovaquie, Tchéquie, Albanie, Bosnie, " +
    "Macédoine, Moldavie, Ukraine, Russie, Biélorussie, Lituanie, Lettonie, Estonie, Finlande, " +
    "Suède, Norvège, Irlande, Écosse, Angleterre, Islande, Turquie, Géorgie, Arménie, Syrie, " +
    "Jordanie, Arabie saoudite, Chine, Inde, Corée, Mongolie, Thaïlande, Malaisie, Indonésie, " +
    "Birmanie, Australie, Nouvelle-Zélande, Algérie, Tunisie, Libye, Égypte, Mauritanie, " +
    "Éthiopie, Somalie, Tanzanie, Zambie, Namibie, Ouganda, Guinée, Côte d'Ivoire, Argentine, " +
    "Bolivie, Colombie, Guyane, Jamaïque, Californie, Floride, Bretagne, Normandie, Provence, " +
    "Alsace, Lorraine, Bourgogne, Aquitaine, Corse, Sardaigne, Sicile, Catalogne, Bavière, " +
    // Masculine names that start with a vowel take "en" too.
    "Iran, Irak, Afghanistan, Ouzbékistan, Équateur, Uruguay, Azerbaïdjan, Ontario",
);
add(
  "au",
  "Portugal, Danemark, Luxembourg, Royaume-Uni, Canada, Québec, Mexique, Brésil, Pérou, " +
    "Chili, Venezuela, Paraguay, Guatemala, Honduras, Nicaragua, Salvador, Japon, Vietnam, " +
    "Cambodge, Laos, Népal, Pakistan, Bangladesh, Tibet, Kazakhstan, Liban, Qatar, Koweït, " +
    "Yémen, Maroc, Sénégal, Mali, Niger, Nigeria, Tchad, Cameroun, Gabon, Congo, Kenya, " +
    "Rwanda, Burundi, Togo, Bénin, Ghana, Soudan, Mozambique, Zimbabwe, Botswana, Groenland",
);
add("aux", "États-Unis, Pays-Bas, Philippines, Bahamas, Maldives, Comores, Seychelles, Antilles");
add("à", "Chypre, Cuba, Madagascar, Malte, Singapour, Haïti, Monaco, Taïwan, Bahreïn, Maurice");

// Verbs after which "à la" + a country names where one goes or is: "arrivé à la Belgique".
const PLACE_VERBS = new Set(
  (
    "aller venir vivre habiter voyager partir arriver rester retourner séjourner travailler " +
    "étudier déménager émigrer immigrer naître rentrer"
  ).split(" "),
);

const NAMES = [...COUNTRIES.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/['’]/g, "['’]"))
  .join("|");
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<prep>aux|au|en|à[ \\t]+la|à[ \\t]+l['’])(?:[ \\t]+|(?<=['’]))(?<country>${NAMES})(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "giu",
);

function countryPreposition(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.prep;
  const prep = typed.toLowerCase().replace(/\s+/g, " ").replace("’", "'");
  const country = m.groups!.country;
  const right = COUNTRIES.get(country) ?? COUNTRIES.get(country.replace("’", "'"));
  if (!right || prep === right) return null;
  // "à la Pologne" only after a place verb ("il pense à la Pologne" is fine); "en Haïti" is as
  // good as "à Haïti".
  if (prep === "à la" || prep === "à l'") {
    if (right !== "en") return null;
    const verb = tokensBefore(ctx.text, m.index, 1)[0];
    if (!verb || !verbReadings(verb.w).some((r) => PLACE_VERBS.has(r.lemma))) return null;
  }
  if (prep === "en" && right === "à") return null;
  return wordFinding(ctx, m.index, typed, [right], RULE, MESSAGE, {
    start: m.index,
    end: m.index + m[0].length,
  });
}

function countries(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, PATTERN)) {
    const finding = countryPreposition(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: countries }];
