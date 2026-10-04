import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { chunkTimes, scan } from "./reviewHarness";

const style = (text: string) =>
  scan(text, { lang: "fr_FR", enabledRules: ["stylePhrasing"] }).filter(
    (d) => d.ruleId === "stylePhrasing",
  );

// [text, the text with the first alternative applied]
const POSITIVES: Array<[string, string]> = [
  // A verb calqued on English before its object takes the French verb in the same form.
  ["Ils complètent le formulaire ce soir.", "Ils remplissent le formulaire ce soir."],
  ["Complète la fiche avant lundi.", "Remplis la fiche avant lundi."],
  ["Je complète le questionnaire.", "Je remplis le questionnaire."],
  ["Nous avons rencontré tous nos objectifs.", "Nous avons atteint tous nos objectifs."],
  ["Cette usine ne rencontre pas les normes.", "Cette usine ne respecte pas les normes."],
  ["Il faut rencontrer de nouvelles exigences.", "Il faut respecter de nouvelles exigences."],
  ["Mon oncle opère une petite boutique.", "Mon oncle exploite une petite boutique."],
  ["La mairie émettra les passeports demain.", "La mairie délivrera les passeports demain."],
  ["Le syndicat a endossé sa candidature.", "Le syndicat a appuyé sa candidature."],
  ["Ils coupent les dépenses partout.", "Ils réduisent les dépenses partout."],
  ["Les pompiers ont contrôlé l'incendie.", "Les pompiers ont maîtrisé l'incendie."],
  ["Elle a brisé le record du club.", "Elle a battu le record du club."],
  ["J'ai placé une commande hier.", "J'ai passé une commande hier."],
  ["Il veut partir une entreprise.", "Il veut lancer une entreprise."],
  ["On va solutionner ce souci.", "On va résoudre ce souci."],
  ["Elle était très émotionnée.", "Elle était très émue."],
  // Word order, units, "chez", "à", direct objects and "de" before an infinitive.
  ["J'ai patienté un bon vingt minutes.", "J'ai patienté vingt bonnes minutes."],
  ["Il a marché un bon trois jours.", "Il a marché trois bons jours."],
  ["La photo pèse 12MB environ.", "La photo pèse 12Mo environ."],
  ["Le disque fait 2 TB.", "Le disque fait 2 To."],
  ["Il va au dentiste chaque année.", "Il va chez le dentiste chaque année."],
  ["Nous irons à la fleuriste demain.", "Nous irons chez la fleuriste demain."],
  ["Adressez-vous auprès du secrétariat.", "Adressez-vous au secrétariat."],
  ["Il faut s'adresser auprès d'un agent.", "Il faut s'adresser à un agent."],
  ["Je me rappelle de cette soirée.", "Je me rappelle cette soirée."],
  ["Tu te rappelles du premier cours ?", "Tu te rappelles le premier cours ?"],
  ["Merci pour nous avoir prévenus.", "Merci de nous avoir prévenus."],
  ["Je vous remercie pour être venue.", "Je vous remercie d'être venue."],
  ["Au final, le match fut nul.", "Finalement, le match fut nul."],
  ["Le chat monte en haut.", "Le chat monte."],
  ["Ils marchent à pied jusqu'au village.", "Ils marchent jusqu'au village."],
  // Spoken "y a" without "il", and "à moi" for the possessive after "c'est".
  ["Y a du vent ce matin.", "Il y a du vent ce matin."],
  ["Bref, y a rien à faire.", "Bref, il n'y a rien à faire."],
  ["Y a vraiment personne ici.", "Il n'y a vraiment personne ici."],
  ["Demande si y en a encore.", "Demande s'il y en a encore."],
  ["Je crois qu'y a un souci.", "Je crois qu'il y a un souci."],
  ["C'est la valise à moi.", "C'est ma valise."],
  ["Ce sont les gants à lui.", "Ce sont ses gants."],
  ["C'est l'idée à nous.", "C'est notre idée."],
  // English words French has a word for.
  ["Le muffler de ma voiture est percé.", "Le silencieux de ma voiture est percé."],
  ["Le foreman arrive à sept heures.", "Le contremaître arrive à sept heures."],
];

const NEGATIVES = [
  "Il y a du vent ce matin.",
  "Il n'y en a plus.",
  "Paul y a dormi deux nuits.",
  "Le comité, y a compté les votes.",
  "Y a -t-il du pain ?",
  "Y a-t-il un médecin ici ?",
  "Il a rendu la valise à moi, pas à toi.",
  "C'est la tâche à lui seul.",
  "Un ami à moi arrive.",
  "C'est la lettre à lui adressée.",
  "Une version complète du formulaire est en ligne.",
  "La coupe des salaires a choqué.",
  "La place des commandes est au fond.",
  "Il a rencontré des difficultés en route.",
  "Le chirurgien opère un patient.",
  "Le serveur émet un certificat signé.",
  "On part d'un projet simple.",
  "La part des entreprises augmente.",
  "Il a coupé le poste de radio.",
  "Merci pour le dîner.",
  "Merci pour tout.",
  "Un combat sans merci pour sauver son honneur.",
  "Rappelle-toi de fermer la porte.",
  "Je me rappelle de lui.",
  "Il va au cinéma.",
  "Elle va au bout de ses idées.",
  "Le format MBR est ancien.",
  "Un bon élève lit dix pages.",
  "Au final de la sonate, le piano se tait.",
  "Galinette Solutionnée arrive demain.",
  "On dit littéralement « clause grand-père » là-bas.",
  "La fête tombe à date fixe.",
  "Il monte en haut de la colline.",
  "La marche à pied est bonne pour le cœur.",
  "Une longue marche à pied nous attend.",
];

test.each(POSITIVES)("French style: %p", (text, fixed) => {
  const found = style(text);
  expect(found).toHaveLength(1);
  expect(applyEdits(text, found[0].alternatives[0].edits)).toBe(fixed);
  expect(style(fixed)).toEqual([]);
});

test.each(NEGATIVES)("French style stays silent: %p", (text) => {
  expect(style(text)).toEqual([]);
});

test("French style frames stay fast on adversarial input", () => {
  // chunkTimes scans each case once before it times it: the one-time table and lexicon loads
  // stay out of the budget.
  const times = chunkTimes(
    [
      "il complète la le les un une des la fiche ".repeat(300),
      "un bon dix un bon vingt un bon minutes ".repeat(300),
      "va au va à la va aux coiffeur ".repeat(400),
      "me rappelle de du de ce merci pour me pour le ".repeat(250),
      "4MB 5 GB 6kB 7 TB ".repeat(500),
      "y a si y en a qu'y a c'est la valise à moi les clés à toi ".repeat(250),
    ].map((text) => ["fr_FR", text, ["stylePhrasing"]] as const),
  );
  for (const ms of times) expect(ms).toBeLessThan(30);
});
