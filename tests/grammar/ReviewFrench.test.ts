import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildFrenchAdjectives,
  buildFrenchCompounds,
  buildFrenchGender,
  buildFrenchLexicon,
  buildFrenchNouns,
  FRENCH_LEXICON_SOURCES,
  readDeterminerBigrams,
} from "../../scripts/generate-french-lexicon";
import {
  adjectiveReadings,
  conjugate,
  finitePersons,
  IL,
  ILS,
  inflect,
  isDictionaryCompound,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  JE,
  nounGender,
  NOUS,
  TU,
  verbReadings,
  VOUS,
} from "../../src/core/domain/grammar/review/french/frenchLexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { encodeWordGraph, WordGraph } from "../../src/core/domain/grammar/review/french/wordGraph";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

function findings(ruleId: CatalogRuleId, text: string, lang = "fr_FR") {
  return detectReviewDiagnostics(
    { id: "fr", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** [text, text with the first alternative applied] where the rule fires; texts where it must not. */
type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, Fixture]> = [
  [
    "frenchVerbForms",
    {
      pos: [
        ["Ce plat est simple à préparé.", "Ce plat est simple à préparer."],
        ["Il a du mal à trouvé le sommeil.", "Il a du mal à trouver le sommeil."],
        // After avoir / être: the participle.
        [
          "Hier soir, nous avons manger chez mes parents.",
          "Hier soir, nous avons mangé chez mes parents.",
        ],
        ["Elle est tomber dans l'escalier.", "Elle est tombée dans l'escalier."],
        ["Ils sont arriver en retard.", "Ils sont arrivés en retard."],
        ["Avez-vous terminer le rapport ?", "Avez-vous terminé le rapport ?"],
        ["Je n'ai pas encore regarder le film.", "Je n'ai pas encore regardé le film."],
        ["Elle a signez la lettre ce matin.", "Elle a signé la lettre ce matin."],
        // After a preposition or a governing verb: the infinitive.
        ["Je voudrais acheté une voiture.", "Je voudrais acheter une voiture."],
        ["Il faut lavé la vaisselle.", "Il faut laver la vaisselle."],
        ["Nous allons visité le musée.", "Nous allons visiter le musée."],
        ["Il est parti sans payé l'addition.", "Il est parti sans payer l'addition."],
        ["J'ai oublié de fermé la porte.", "J'ai oublié de fermer la porte."],
        ["Il se fait souvent appelé par son surnom.", "Il se fait souvent appeler par son surnom."],
        ["J'ai déjà pu testé cette application.", "J'ai déjà pu tester cette application."],
        ["Elle commence à mangé sa soupe.", "Elle commence à manger sa soupe."],
        ["Je vais vous expliquez la situation.", "Je vais vous expliquer la situation."],
        ["Il est temps de commencez la réunion.", "Il est temps de commencer la réunion."],
        ["Le chef va vous rappelez demain.", "Le chef va vous rappeler demain."],
        // A "vous" subject: the -ez form.
        [
          "Si vous continuer comme ça, tout ira bien.",
          "Si vous continuez comme ça, tout ira bien.",
        ],
        [
          "Quand vous arriver à la gare, appelez-moi.",
          "Quand vous arrivez à la gare, appelez-moi.",
        ],
        ["Vous aimer marcher le long du canal.", "Vous aimez marcher le long du canal."],
        // "c'est" + an infinitive with a degree adverb, a time word or a question.
        ["Ce n'est pas très compliquer.", "Ce n'est pas très compliqué."],
        ["Comment c'est arriver ?", "Comment c'est arrivé ?"],
        // An infinitive right after a noun for its participle.
        [
          "Elle portait une robe froisser par le voyage.",
          "Elle portait une robe froissée par le voyage.",
        ],
        ["Il a les mains geler.", "Il a les mains gelées."],
      ],
      neg: [
        "La teinte passe de doré à cuivré.",
        "Le chat a mangé.",
        "C'est rêver.",
        "Partir, c'est mourir un peu.",
        "Ce qui compte, c'est gagner.",
        "C'est manger des pommes qui compte.",
        "Elle a senti son cœur cogner.",
        "Dans cette pièce fumer est interdit.",
        "Il peut de cette manière trier les fiches.",
        "Elle laisse les enfants jouer dehors.",
        "Ma mère aimer le chocolat.",
        "Il a une machine a laver toute neuve.",
        "Il y a dîner chez Paul ce soir.",
        "Il est boucher depuis vingt ans.",
        "Partir, c'est mourir un peu.",
        "Rien de changé depuis hier.",
        "Je le veux terminé pour lundi.",
        "Je l'ai laissé fermé toute la nuit.",
        "Il se sait observé.",
        "Vous aider est notre priorité.",
        "Comment vous remercier pour tout ?",
        "Pour vous aider, nous avons créé ce guide.",
        "Je tiens à vous saluer et vous remercier de votre visite.",
        "Il ne fait que vous répéter la même chose.",
        "Un homme sans passé arrive en ville.",
        "Il a obtenu sa carte d'abonné.",
        "Le chat à mangé la souris.",
        "On a été manger au restaurant.",
        "Il semble fatigué ce soir.",
        "Elle est fière de son fils.",
        "Il est né à Vitré.",
        "Le menu affiché en vitrine change chaque jour.",
        "C'est tout à fait réglé.",
        "Il a en fait déjà mangé.",
        "Nous sommes près de vous, élevé ou pas.",
        "Le lieu d'arrivé reste à fixer.",
        "Le devoir sacré de chacun est de voter.",
        "Allez venez, on y va !",
      ],
    },
  ],
  [
    "frenchHomophones",
    {
      pos: [
        ["Des 2015, la ville a changé.", "Dès 2015, la ville a changé."],
        [
          "J'ai très peu de temps a la fin de la journée.",
          "J'ai très peu de temps à la fin de la journée.",
        ],
        ["Il est a la gare depuis midi.", "Il est à la gare depuis midi."],
        ["Il a écrit ce roman a vingt ans.", "Il a écrit ce roman à vingt ans."],
        ["Le but et de gagner la coupe.", "Le but est de gagner la coupe."],
        ["Merci pour vous conseils avisés.", "Merci pour vos conseils avisés."],
        ["Il se peut qu'elle soi déjà partie.", "Il se peut qu'elle soit déjà partie."],
        ["Soi patient avec lui.", "Sois patient avec lui."],
        ["Elle parle trop de soit.", "Elle parle trop de soi."],
        ["Merci à ceux qui on fait le gâteau.", "Merci à ceux qui ont fait le gâteau."],
        [
          "Je connais des gens qui on beaucoup de chance.",
          "Je connais des gens qui ont beaucoup de chance.",
        ],
        ["Je n'ai pas d'argent a la banque.", "Je n'ai pas d'argent à la banque."],
        ["Entrée gratuite des 18 h.", "Entrée gratuite dès 18 h."],
        ["Nous avons vécu un an magnifique.", "Nous avons vécu une année magnifique."],
        ["Elle prépare l'an universitaire.", "Elle prépare l'année universitaire."],
        ["Ils suivent aveuglement leur chef.", "Ils suivent aveuglément leur chef."],
        ["Leur aveuglément les a perdus.", "Leur aveuglement les a perdus."],
        ["Il à mangé toute la tarte.", "Il a mangé toute la tarte."],
        ["Je confie cette mission a ton frère.", "Je confie cette mission à ton frère."],
        ["Le match a du être reporté.", "Le match a dû être reporté."],
        ["Nous aurions sans doute du les prévenir.", "Nous aurions sans doute dû les prévenir."],
        ["Vous n'auriez jamais du !", "Vous n'auriez jamais dû !"],
        ["La ferme se trouve prés du lac.", "La ferme se trouve près du lac."],
        ["Je ne la connais guerre.", "Je ne la connais guère."],
        ["Tachez de finir avant midi.", "Tâchez de finir avant midi."],
        ["Elle a décidé de ce préparer tôt.", "Elle a décidé de se préparer tôt."],
        ["Le bruit qui ce propage est gênant.", "Le bruit qui se propage est gênant."],
        ["On c'est bien amusés hier.", "On s'est bien amusés hier."],
        ["Pour se faire, prenez un crayon.", "Pour ce faire, prenez un crayon."],
        ["Viens vite, s'est prêt !", "Viens vite, c'est prêt !"],
        ["Ce son nos voisins qui ont appelé.", "Ce sont nos voisins qui ont appelé."],
        ["Mes cousins son ici depuis lundi.", "Mes cousins sont ici depuis lundi."],
        ["Deux trains son annulés ce matin.", "Deux trains sont annulés ce matin."],
        ["Mais ou sont passées mes lunettes ?", "Mais où sont passées mes lunettes ?"],
        ["Vous habitez ou maintenant ?", "Vous habitez où maintenant ?"],
        ["C'est un quartier ou les loyers baissent.", "C'est un quartier où les loyers baissent."],
        ["La chambre ou Paul dort est froide.", "La chambre où Paul dort est froide."],
        ["Elle tache toujours de ne rien oublier.", "Elle tâche toujours de ne rien oublier."],
        ["Porte ces cartons a la cave.", "Porte ces cartons à la cave."],
        ["Tu ressembles beaucoup a ta mère.", "Tu ressembles beaucoup à ta mère."],
        ["On à déjà fini le travail.", "On a déjà fini le travail."],
        ["Ça à l'air facile.", "Ça a l'air facile."],
        ["Hier, Marie à trouvé la solution.", "Hier, Marie a trouvé la solution."],
        ["La maison à été vendue.", "La maison a été vendue."],
        ["Je pense a toi tous les jours.", "Je pense à toi tous les jours."],
        ["J'ai répondu a ta lettre hier.", "J'ai répondu à ta lettre hier."],
        ["Il faut parler a ta mère.", "Il faut parler à ta mère."],
        ["L'adresse a laquelle tu écris.", "L'adresse à laquelle tu écris."],
        ["Il n'y a rien a faire.", "Il n'y a rien à faire."],
        ["Le jour ou il est venu, il pleuvait.", "Le jour où il est venu, il pleuvait."],
        ["Je ne sais pas ou aller.", "Je ne sais pas où aller."],
        ["Ou sont mes clés ?", "Où sont mes clés ?"],
        ["Deux où trois personnes sont venues.", "Deux ou trois personnes sont venues."],
        ["Il faut se renseigner sûr les horaires.", "Il faut se renseigner sur les horaires."],
        ["Il est sur d'arriver à l'heure.", "Il est sûr d'arriver à l'heure."],
        ["Il ce lève tôt.", "Il se lève tôt."],
        ["Se sont des histoires.", "Ce sont des histoires."],
        ["Il a dit sa pour rire.", "Il a dit ça pour rire."],
        ["Il ma dit la vérité.", "Il m'a dit la vérité."],
        ["Je la vu hier.", "Je l'ai vu hier."],
        ["Il est parti avec sont frère.", "Il est parti avec son frère."],
        ["Il a du partir tôt.", "Il a dû partir tôt."],
        ["Ont dit que c'est facile.", "On dit que c'est facile."],
      ],
      neg: [
        "Il a vendu des 2000 exemplaires la moitié.",
        "Elle est contente, son frère a la grippe.",
        "Il est malade et son frère a la grippe.",
        "Je suis sûr que Paul a la clé.",
        "Ce qu'il est a changé.",
        "Ce garçon a deux chiens.",
        "Le pain et de la confiture.",
        "Je sais qui on fait venir ce soir.",
        "Merci à vous messieurs.",
        "Pour nous autres, c'est simple.",
        "Quoi qu'il en soit, je viendrai.",
        "Chacun pour soi.",
        "Le soi profond reste caché.",
        "C'est lui qui on dit.",
        "Les élèves des 15 ans passent un examen.",
        "L'an prochain, nous partirons.",
        "Il a vingt ans révolus.",
        "Un an après, tout avait changé.",
        "Cet aveuglement collectif inquiète.",
        "S'était une fois encore distingué par son calme.",
        "Prenons pour ce faire une feuille blanche.",
        "Pour ce faire, il suffit d'attendre.",
        "Tu connais celui qui ce matin a appelé ?",
        "C'est qui ce garçon ?",
        "Il a trébuché, s'est relevé et a couru.",
        "Ce son des cloches me réveille chaque matin.",
        "Les voisins aiment son jardin.",
        "Tu veux une maison ou tu préfères un appartement ?",
        "Tu restes ici ou tu pars avec nous ?",
        "Vous habitez Paris ou Lyon ?",
        "Une ville ou un village, peu importe.",
        "Cette encre tache de bleu les doigts.",
        "Une tache de graisse est restée.",
        "Il a du pouvoir et du savoir.",
        "Les vaches paissent dans les prés du village.",
        "Elle a fait une demande de prêt.",
        "Ils ne partent pas en guerre.",
        "On ne gagne jamais une guerre seul.",
        "La porte a une serrure neuve.",
        "Chambre à coucher de la maison a deux fenêtres.",
        "Ce que tu portes a une grande valeur.",
        "Le livre que je lis a une belle couverture.",
        "Il pense à sa mère.",
        "Va-t-il à Paris ?",
        "C'est à elle à décider.",
        "Une eau à capter pour la ville.",
        "Réponse à tout donnée en direct.",
        "Ce qu'il pense a de l'importance.",
        "Paul a la grippe.",
        "Maria a de longs cheveux.",
        "A la fin du film, tout le monde pleurait.",
        "Il faut distinguer a et b.",
        "Je ne pouvais pas le croire a priori.",
        "Le droit de voter a ses limites.",
        "Tu préfères le jour ou la nuit ?",
        "Je commande pour un mois ou je m'abonne pour un an.",
        "On dit ou on écrit, peu importe.",
        "Ou serait-ce l'inverse ?",
        "Il gagnera à coup sûr le match.",
        "Le livre est sur la table.",
        "Ils se sont levés tôt.",
        "Les musiciens se séparent, mais se sont retrouvés plus tard.",
        "Il s'est levé tôt.",
        "Ce que s'est dit Paul reste un mystère.",
        "Sa mère est là.",
        "Il la dit souvent.",
        "Les drames en vers sont une bonne source.",
        "Il a du pain.",
        "Il a du pouvoir.",
        "Ont-ils fini ?",
      ],
    },
  ],
  [
    "frenchHyphenation",
    {
      pos: [
        ["Pouvez vous m'aider ?", "Pouvez-vous m'aider ?"],
        ["As tu fini tes devoirs ?", "As-tu fini tes devoirs ?"],
        ["Y a t il des risques ?", "Y a-t-il des risques ?"],
        ["Où va t'on maintenant ?", "Où va-t-on maintenant ?"],
        ["Que mange il ce soir ?", "Que mange-t-il ce soir ?"],
        ["Que faut t-il faire ?", "Que faut-il faire ?"],
        ["Est ce que tu viens ?", "Est-ce que tu viens ?"],
        ["Comment est ce possible ?", "Comment est-ce possible ?"],
        ["Il partira peut être demain.", "Il partira peut-être demain."],
        ["Vous avez peut être raison.", "Vous avez peut-être raison."],
        ["Peut être viendra-t-il.", "Peut-être viendra-t-il."],
        // Hyphenated names and compounds of three parts.
        ["Elle a grandi à Aix en Provence.", "Elle a grandi à Aix-en-Provence."],
        ["Le colis est pour Anne Sophie.", "Le colis est pour Anne-Sophie."],
        ["Le bureau est au rez de chaussée.", "Le bureau est au rez-de-chaussée."],
      ],
      neg: [
        "Ils vont d'ici peu être livrés.",
        "Tout Paris est à la fête.",
        "Ils luttent corps à corps.",
        "Il est parti sur le champ de bataille.",
        "Quand tu viens tu manges ?",
        "Le but est ce que tu dis.",
        "C'est ce que je pense ?",
        "Il nous parle ?",
        "Il veut vous voir ?",
        "Quel est ce bruit ?",
        "Quel est ce son ?",
        "Il peut être tard.",
        "Cela peut être utile.",
        "Tout ce que vous dites peut être utilisé.",
        "Peut être résilié chaque mois.",
        "L'Écosse peut être très chaude.",
        "Pouvez-vous m'aider ?",
      ],
    },
  ],
  [
    "frenchSubjectVerbAgreement",
    {
      pos: [
        ["Je peut venir demain.", "Je peux venir demain."],
        ["Il dans le jardin depuis ce matin.", "Il est dans le jardin depuis ce matin."],
        ["Si vous aimer le froid, venez en hiver.", "Si vous aimez le froid, venez en hiver."],
        ["Est-ce que vous chercher un logement ?", "Est-ce que vous cherchez un logement ?"],
        ["Ils sous la tente quand l'orage éclate.", "Ils sont sous la tente quand l'orage éclate."],
        ["Tu mange trop vite.", "Tu manges trop vite."],
        ["Ils mange ensemble.", "Ils mangent ensemble."],
        ["Nous avez raison.", "Nous avons raison."],
        ["Il peux partir.", "Il peut partir."],
        ["On allons voir.", "On va voir."],
        ["Les élèves dans la cour joue au ballon.", "Les élèves dans la cour jouent au ballon."],
        [
          "Les écarts entre ces trois villes semble énormes.",
          "Les écarts entre ces trois villes semblent énormes.",
        ],
        ["Je ne comprend pas.", "Je ne comprends pas."],
        ["Elle se sont donné la main.", "Elle s'est donné la main."],
        ["J'est fini.", "Je suis fini."],
        ["Je rêver souvent du chalet.", "Je rêve souvent du chalet."],
        ["Elle est arrivé hier.", "Elle est arrivée hier."],
        ["Ils sont passé ici.", "Ils sont passés ici."],
        ["Elles étaient fatigué.", "Elles étaient fatiguées."],
        // A noun subject, its number from a numeral, past a complement, or two coordinated.
        ["Les chaises est cassées.", "Les chaises sont cassées."],
        ["Les 12 candidats attend les résultats.", "Les 12 candidats attendent les résultats."],
        ["Trois voisins vient ce soir.", "Trois voisins viennent ce soir."],
        ["30 salariés perd leur emploi.", "30 salariés perdent leur emploi."],
        ["Le goût des fraises plaisent à tous.", "Le goût des fraises plaît à tous."],
        ["Les élèves de Marie travaille bien.", "Les élèves de Marie travaillent bien."],
        ["Le chien et la chèvre dort dehors.", "Le chien et la chèvre dorment dehors."],
        [
          "Hier soir, la porte des voisins claquaient.",
          "Hier soir, la porte des voisins claquait.",
        ],
        // A noun or a bare participle where the verb goes.
        ["Tu sorts", "Tu sors"],
        ["Ce soir, je sorts avec Paul.", "Ce soir, je sors avec Paul."],
        // Demonstratives, "personne ne" and a sentence-initial "nous"/"vous".
        ["Ça marchent très bien.", "Ça marche très bien."],
        ["Personne ne veux partir.", "Personne ne veut partir."],
        ["Celles-ci coûte trop cher.", "Celles-ci coûtent trop cher."],
        ["Nous ne comprends pas.", "Nous ne comprenons pas."],
        // A second verb joined by "et" shares the subject.
        ["Ils chantaient et dansait.", "Ils chantaient et dansaient."],
        ["Il ouvrit la porte et senti le froid.", "Il ouvrit la porte et sentit le froid."],
        ["Il voit loin et il oubli tout.", "Il voit loin et il oublie tout."],
        ["Ce matin, il terminé son rapport.", "Ce matin, il a terminé son rapport."],
        ["Hier, j'aperçu un renard.", "Hier, j'ai aperçu un renard."],
        ["Elle s'en souvenu.", "Elle s'en est souvenu."],
        // Names, longer noun phrases, relative clauses and "et" between two clauses.
        ["Hier soir, Nathalie viens de rentrer.", "Hier soir, Nathalie vient de rentrer."],
        // A participle after a demonstrative with an object; an -ir/-re infinitive.
        ["Cela coûté une fortune.", "Cela a coûté une fortune."],
        ["Tu lui écrire demain.", "Tu lui écris demain."],
        [
          "Je crois que Lucas et Inès arrive demain.",
          "Je crois que Lucas et Inès arrivent demain.",
        ],
        [
          "Les colis que tu as commandés hier arrive ce soir.",
          "Les colis que tu as commandés hier arrivent ce soir.",
        ],
        [
          "Le jardin dont je m'occupe chaque été fleurissent en mai.",
          "Le jardin dont je m'occupe chaque été fleurit en mai.",
        ],
        [
          "Les voisins qui habitent au fond de la rue me salue souvent.",
          "Les voisins qui habitent au fond de la rue me saluent souvent.",
        ],
        [
          "Les tarifs postaux actuels augmente encore.",
          "Les tarifs postaux actuels augmentent encore.",
        ],
        [
          "Il pleuvait fort et les rivières déborde.",
          "Il pleuvait fort et les rivières débordent.",
        ],
      ],
      neg: [
        "Il, dans sa grande bonté, a tout pardonné.",
        "Nous avec nos amis, sommes partis tôt.",
        "Je ne veux que vous aider.",
        "Mieux vaut vous prévenir que vous consoler.",
        "Paul viens ici !",
        "Le pain et le vin sont bons.",
        "Les deux tiers des habitants votent.",
        "Les peintres tels que Picasso sont rares.",
        "Agathe, Léo ainsi que Rudy vont l'aider.",
        "Elle et Mrs. Smith sont là.",
        "Les hommes avec lesquels tu parles sont partis.",
        "Il connaît Berlin, Londres et Rome qui ont changé.",
        "Le prix du pain et du lait augmente.",
        "La plupart des invités sont partis.",
        "Un groupe de touristes attendent devant le musée.",
        "Chaque matin des oiseaux chantent.",
        "Dix minutes suffit amplement.",
        "Le nom des joueurs qui ont gagné est affiché.",
        "Une pomme, une poire et une banane suffisent.",
        "Nous deux partirons demain.",
        "Ça, vous devez le demander au guichet.",
        "Des outils comme celui-ci servent souvent.",
        "La force qui, semblable au vent, nous pousse.",
        "Personne n'est venu ce matin.",
        "Il fut arrêté et condamné.",
        "Je mange du pain et Paul boit du lait.",
        "Il mange une pomme et sa sœur une poire.",
        "Je fais ça tous les jours.",
        "Il s'est tu pendant des heures.",
        "Elle partie, la maison sembla vide.",
        "Je soussigné certifie l'exactitude de ces informations.",
        "Que s'est-il passé hier ?",
        "Il ou elle viendra demain.",
        "Ils et elles travaillent ensemble.",
        "Tu ne la vois pas.",
        "Il nous parle souvent.",
        "Nous vous remercions.",
        "Vous nous avez aidés.",
        "Il le livre demain.",
        "Les avantages que vous offrent ces cours.",
        "Pierre et elle étaient fiancés.",
        "Nous sont parvenus des parchemins.",
        "Je vous écrirai et vous téléphonerai demain.",
        "Peux tu aller voir ?",
        "D'où vous vient cette idée ?",
        "Dit-il en riant.",
        "Elles se sont parlé.",
        "Il est arrivé une lettre.",
        "Pierre et elle étaient fiancés.",
        "Les dates limite sont fixées.",
        "Les pays en voie de développement progressent.",
        "Les roues avant tournent mal.",
        "Les chambres sur place restent libres.",
        "Les amis de mon frère montre en main attendaient.",
      ],
    },
  ],
  [
    "frenchElision",
    {
      pos: [
        ["Je aime le chocolat.", "J'aime le chocolat."],
        ["Je pense que il va venir.", "Je pense qu'il va venir."],
        ["Il est parti lorsque il a plu.", "Il est parti lorsqu'il a plu."],
        ["Je viens de y aller.", "Je viens d'y aller."],
        ["Je le aime bien.", "Je l'aime bien."],
        ["C'est le ami de Paul.", "C'est l'ami de Paul."],
        ["J ai froid.", "J'ai froid."],
        ["Il n arrive jamais.", "Il n'arrive jamais."],
        ["Ils ont beaucoup d’ enfants.", "Ils ont beaucoup d’enfants."],
        ["Passe-moi le sel sil te plaît.", "Passe-moi le sel s'il te plaît."],
        ["On sortira sil fait beau.", "On sortira s'il fait beau."],
      ],
      neg: [
        "Viendra t il demain ?",
        "Le sil est une argile ocre.",
        "Le oui l'emporte.",
        "La une du journal.",
        "De un à dix.",
        "Lorsque Anna arrive.",
        "Les points a, b, c, d et e.",
        "Il faut 2 l eau.",
        "M. J Dupont est là.",
        "Prends-le à gauche.",
        "Fais-le entrer.",
        "Le hasard fait bien les choses.",
        "On omet souvent le ne explétif.",
        "Et la il est parti.",
        "Si c divise a, alors c est premier avec b.",
        "Il n' pas hésité.",
        "Le titre est Kiss Me Once.",
      ],
    },
  ],
  [
    "frenchDates",
    {
      pos: [
        ["Rendez-vous le 31 septembre.", "Rendez-vous le 30 septembre."],
        ["Elle est née le 31-04-1988.", "Elle est née le 30-04-1988."],
        ["Le 29 février 2023 tombait un mercredi.", "Le 28 février 2023 tombait un mercredi."],
        ["Mardi 3 mars 2025, la séance reprend.", "Lundi 3 mars 2025, la séance reprend."],
        [
          "La fête a eu lieu dimanche 14 juillet 2018.",
          "La fête a eu lieu samedi 14 juillet 2018.",
        ],
        ["Mercredi 2024/01/02 au matin.", "Mardi 2024/01/02 au matin."],
      ],
      neg: [
        "Rendez-vous le 30 septembre.",
        "Le 29 février 2024 était un jeudi.",
        "Né un 29 février, il fête rarement son anniversaire.",
        "Le 1er mai est férié.",
        "Lundi 3 mars 2025, la séance reprend.",
        "La version 31/09 du logiciel.",
        "Il a 31 ans et 12 mois de plus.",
        "Le mot « 31 septembre » est faux.",
      ],
    },
  ],
  [
    "frenchNounNumber",
    {
      pos: [
        ["Mes enfant sont partis.", "Mes enfants sont partis."],
        ["Elle a trois enfant.", "Elle a trois enfants."],
        ["Les voiture roulent vite.", "Les voitures roulent vite."],
        ["La routes est longue.", "La route est longue."],
        ["Un plans de la ville.", "Un plan de la ville."],
        ["Les bateau coulent.", "Les bateaux coulent."],
        ["Les cheval galopent.", "Les chevaux galopent."],
        ["Des porte claquent.", "Des portes claquent."],
      ],
      neg: [
        "Je les aime beaucoup.",
        "Le numéro deux allemand a gagné.",
        "Il a raison à cent pour cent.",
        "Un appartement neuf idéal pour une famille.",
        "Tu la portes bien.",
        "Il les porte.",
        "Ce sont mes amis.",
        "Le fils de Paul.",
        "Le temps passe.",
        "Les quatre saisons.",
        "Les tout premiers jours.",
        "Les Dupont arrivent.",
        "Vos nom et prénom, s'il vous plaît.",
        "Les voyant si nerveux, il se tut.",
        "Deux cent une personnes arrivent.",
        "Il a soixante et un ans.",
        "Les lundi et mardi sont fériés.",
        "Je suis sûr de les avoir vus.",
      ],
    },
  ],
  [
    "frenchNounGender",
    {
      pos: [
        ["Je pars au Norvège en juin.", "Je pars en Norvège en juin."],
        ["Elle travaille en Japon depuis un an.", "Elle travaille au Japon depuis un an."],
        ["Ils ont émigré au Pays-Bas.", "Ils ont émigré aux Pays-Bas."],
        ["Il est retourné à la Grèce l'été dernier.", "Il est retourné en Grèce l'été dernier."],
        ["Nous avons visité un maison ancienne.", "Nous avons visité une maison ancienne."],
        ["Aucun voiture ne passe.", "Aucune voiture ne passe."],
        // Two determiners in a row, and a verb form or participle where the noun goes.
        ["Elle pense à vos ces projets.", "Elle pense à vos projets."],
        ["Il travaille des sa jeunesse.", "Il travaille dès sa jeunesse."],
        ["Je lis du votre journal.", "Je lis de votre journal."],
        ["J'ai acheté des légumes au marche.", "J'ai acheté des légumes au marché."],
        ["Le prêtre parle avec le cure.", "Le prêtre parle avec le curé."],
        ["Le projet connaît un développent rapide.", "Le projet connaît un développement rapide."],
        ["Elle attend sa sorti de prison.", "Elle attend sa sortie de prison."],
        ["Mon dîné était délicieux.", "Mon dîner était délicieux."],
        ["Nous attendons l'arrivé du train.", "Nous attendons l'arrivée du train."],
        ["Il lit dans mes pensés.", "Il lit dans mes pensées."],
        ["Nous visitons un musé.", "Nous visitons un musée."],
        ["Il ne voit pas la nécessite de partir.", "Il ne voit pas la nécessité de partir."],
        ["Elle a résolu cette problème hier.", "Elle a résolu ce problème hier."],
        ["Il conduit un voiture neuve.", "Il conduit une voiture neuve."],
        ["Le réunion commence à neuf heures.", "La réunion commence à neuf heures."],
        ["Je pense à cet idée depuis lundi.", "Je pense à cette idée depuis lundi."],
        ["Il parle du situation actuelle.", "Il parle de la situation actuelle."],
        ["Ma vélo est garé devant la porte.", "Mon vélo est garé devant la porte."],
        ["On a parlé de la gouvernement.", "On a parlé du gouvernement."],
        ["Elle pense à la projet.", "Elle pense au projet."],
      ],
      neg: [
        "Il rend hommage à la Grèce antique.",
        "Elle vit en Haïti depuis dix ans.",
        "Nous allons au Portugal puis en Espagne.",
        "Elle est une élève brillante et un enfant curieux l'admire.",
        "Je la porte tous les jours.",
        "Ce base sur quoi, ton avis ?",
        "Mon amie arrive demain.",
        "Le Monde a publié un article.",
        "Un unique sommet domine la vallée.",
        "C'est une tout autre histoire.",
        "Il a lu le tour de France et visité la tour Eiffel.",
        "Le sixième jour, elle est partie.",
        "Dans un après-midi pluvieux, rien ne bouge.",
        "La une du journal était consacrée au sport.",
        "Leur maison est plus grande que la leur.",
        "C'est un des meilleurs films de l'année.",
        "Le la du diapason sert de référence.",
        "Il le coupe en deux.",
        "Ce sont des histoires anciennes.",
        "Appuyez sur le un pour continuer.",
        "Il a un double sens.",
        "Ton chien est plus calme que le votre.",
        "Les Le Pen et les La Fontaine.",
        "Son indigne frère est parti.",
        "Il la facilite beaucoup.",
        "Elle est à la retraite depuis un an.",
        "Les invités arrivent et l'élu parle.",
        "Leur vécu compte autant que son passé.",
      ],
    },
  ],
  [
    "frenchAdjectiveAgreement",
    {
      pos: [
        ["Nous traversons une forêt tropical.", "Nous traversons une forêt tropicale."],
        ["Nous avons un climat chaude.", "Nous avons un climat chaud."],
        ["Range les dossiers triées dans l'armoire.", "Range les dossiers triés dans l'armoire."],
        ["Cette réunion est annulé.", "Cette réunion est annulée."],
        ["Hier soir, Sophie était vraiment fatigué.", "Hier soir, Sophie était vraiment fatiguée."],
        ["Julien n'est pas très contente.", "Julien n'est pas très content."],
        ["Nathalie Durand semble ravi.", "Nathalie Durand semble ravie."],
        ["Ces équipes sont vraiment forts.", "Ces équipes sont vraiment fortes."],
        ["Elles sont bien entendu invités.", "Elles sont bien entendu invitées."],
        ["La maison semble très grand.", "La maison semble très grande."],
        ["Ils sont françaises depuis toujours.", "Ils sont français depuis toujours."],
        ["Elle est vraiment heureux de venir.", "Elle est vraiment heureuse de venir."],
        ["Les routes sont dangereux ce matin.", "Les routes sont dangereuses ce matin."],
        // Past "de" complements, two subjects joined by "et", a participle that is also a noun.
        ["La couleur des volets du salon est passé.", "La couleur des volets du salon est passée."],
        ["Le niveau de la rivière était inquiétante.", "Le niveau de la rivière était inquiétant."],
        ["La lampe et la table sont cassés.", "La lampe et la table sont cassées."],
        ["Le vase et la tasse sont cassées.", "Le vase et la tasse sont cassés."],
        ["Est-il entrée sans frapper ?", "Est-il entré sans frapper ?"],
        // Reflexive verbs agree with their subject; quantifiers as subjects.
        ["Elle s'est endormi dans le salon.", "Elle s'est endormie dans le salon."],
        ["Les invités se sont installé au salon.", "Les invités se sont installés au salon."],
        ["Certaines étaient arrivé en avance.", "Certaines étaient arrivées en avance."],
        // Avoir l'air: the subject's inflection or the masculine singular of "air".
        ["Ses voisines ont l'air ravie.", "Ses voisines ont l'air ravies."],
        ["Il a l'air inquiète ce matin.", "Il a l'air inquiet ce matin."],
        // Two adjectives joined by "et" or "ou" share their noun's gender and number.
        ["Un hiver long et rigoureuse.", "Un hiver long et rigoureux."],
        ["Une offre claire et avantageuses.", "Une offre claire et avantageuse."],
        // A color with a shade is invariable.
        ["Elle porte des gants verts foncés.", "Elle porte des gants vert foncé."],
        // A modal before être or "avoir été".
        ["Cette erreur peut être corrigé.", "Cette erreur peut être corrigée."],
        ["Les murs semblent avoir été repeint.", "Les murs semblent avoir été repeints."],
        ["Elle doit être arrivés tôt.", "Elle doit être arrivée tôt."],
        // After "été", after je/tu/nous, a demonstrative or an inversion.
        ["Les ponts ont été construites en 1900.", "Les ponts ont été construits en 1900."],
        ["Ce matin, la séance a été reporté.", "Ce matin, la séance a été reportée."],
        ["Tu étais malades hier soir.", "Tu étais malade hier soir."],
        ["Nous sommes vraiment ravi de venir.", "Nous sommes vraiment ravis de venir."],
        ["Celle-ci est trop petit.", "Celle-ci est trop petite."],
        ["Sont-elles arrivé tôt ?", "Sont-elles arrivées tôt ?"],
        ["Le banc est peut-être mouillée.", "Le banc est peut-être mouillé."],
        // After avoir: an object pronoun before it, or an object after the participle.
        ["Ton vélo ? Je l'ai vendus hier.", "Ton vélo ? Je l'ai vendu hier."],
        ["Ces photos, nous les avons regardé.", "Ces photos, nous les avons regardés."],
        ["Elle lui a offerte un livre.", "Elle lui a offert un livre."],
        ["Mes parents ont vendus leur maison.", "Mes parents ont vendu leur maison."],
      ],
      neg: [
        "Elles se sont lavé les mains.",
        "Elle a l'air content de son sort.",
        "Les politiques économique et sociale du pays.",
        "Les verts clairs dominent la toile.",
        "Un ciel bleu clair.",
        "Face à une situation incongrue et pris de panique, il fuit.",
        "L'hiver est neigeux et dure longtemps.",
        "Elles avaient l'air sérieux.",
        "Ils se sont parlé hier soir.",
        "Elles se sont vu refuser l'entrée.",
        "Elles se sont rendu compte du problème.",
        "La moitié des invités sont partis.",
        "Nous sommes fin prêts pour le départ.",
        "Ils avaient été pendant des années voisins.",
        "Se sont-elles écrit depuis ?",
        "J'étais quelques fois absent.",
        "Je suis fils unique.",
        "Je les ai entendus chanter.",
        "Il nous a vus partir.",
        "Elle m'a appelée hier.",
        "Les enfants ont mangé des pommes.",
        "La lettre que je lui ai envoyée est arrivée.",
        "Elle a l'air fatiguée ce soir.",
        "Ils sont bien sûr partis à l'heure.",
        "Il porte une chemise bleu clair et un pull rouge.",
        "Thomas passe ses journées enfermé dans sa chambre.",
        "La loi contraint chacun à payer.",
        "Une main tenant un flambeau orne la façade.",
        "Elle porte des chaussures marron.",
        "Les drapeaux français et italien flottent au vent.",
        "Pierre et elle étaient fiancés depuis un an.",
        "Je suis un peu perdue ce matin.",
        "Les voitures dernier cri coûtent cher.",
        "Ils sont très avares de compliments.",
        "Avec une jupe et un pull noirs, elle était élégante.",
      ],
    },
  ],
  [
    "frenchTout",
    {
      pos: [
        ["Toute va bien ce matin.", "Tout va bien ce matin."],
        ["Nous avons toute rangé avant de partir.", "Nous avons tout rangé avant de partir."],
        ["Elle surveille tout trace de fumée.", "Elle surveille toute trace de fumée."],
        ["Elles sont parties, toute sont rentrées.", "Elles sont parties, toutes sont rentrées."],
        ["Sa robe est tout neuve.", "Sa robe est toute neuve."],
        ["Des chemises tout neuves.", "Des chemises toutes neuves."],
        ["Ma sœur était toute énervée.", "Ma sœur était tout énervée."],
        ["C'est une toute autre histoire.", "C'est une tout autre histoire."],
        ["Tout autre solution serait meilleure.", "Toute autre solution serait meilleure."],
        ["Il pleut tout les jours en novembre.", "Il pleut tous les jours en novembre."],
        ["Toute le village est venu.", "Tout le village est venu."],
        ["Toutes les soirs, il lit un roman.", "Tous les soirs, il lit un roman."],
        ["Merci à tout ceux qui ont aidé.", "Merci à tous ceux qui ont aidé."],
        ["Tous ça ne sert à rien.", "Tout ça ne sert à rien."],
        ["Elle a travaillé tout la nuit.", "Elle a travaillé toute la nuit."],
        ["Elle a lu toute mon courrier.", "Elle a lu tout mon courrier."],
        [
          "J'ai répondu à tout personne qui écrivait.",
          "J'ai répondu à toute personne qui écrivait.",
        ],
        ["Tous le monde est content.", "Tout le monde est content."],
        ["Elles sont toute deux parties.", "Elles sont toutes deux parties."],
      ],
      neg: [
        "Il sait tout montre qu'il ment.",
        "Tout porte à croire qu'elle viendra.",
        "Elle a toute la journée devant elle.",
        "Son roman, Toute une vie, sort demain.",
        "Elles sont toutes heureuses de venir.",
        "Ils sont tous contents.",
        "Elle est tout entière à son travail.",
        "Elles sont toutes arrivées à l'heure.",
        "Un tout autre problème se pose.",
        "Toutes ces idées sont bonnes.",
        "Ils ont tous le même âge.",
        "Elles ont toutes la grippe.",
        "Tous le savent depuis longtemps.",
        "Il faut tout leur dire.",
        "Elle est tout sourire.",
        "Il est tout ouïe.",
        "Toute mon enfance s'est passée ici.",
        "Les invités, tous la mine réjouie, arrivèrent.",
        "Nous avons tous nos secrets.",
        "Ils faisaient tous les deux partie du club.",
        "Je remercie avant tout ceux qui sont venus.",
        "Il a dit à tous la vérité.",
        "Tout ou partie du texte sera repris.",
      ],
    },
  ],
  [
    "frenchMood",
    {
      pos: [
        ["Il faut que tu viens ce soir.", "Il faut que tu viennes ce soir."],
        ["Je veux que vous êtes à l'heure.", "Je veux que vous soyez à l'heure."],
        ["Bien qu'il pleut, nous sortons.", "Bien qu'il pleuve, nous sortons."],
        [
          "Pour que tout le monde comprend, parle lentement.",
          "Pour que tout le monde comprenne, parle lentement.",
        ],
        [
          "Il est important que nous prenons une décision.",
          "Il est important que nous prenions une décision.",
        ],
        ["Il vaut mieux que tu pars tôt.", "Il vaut mieux que tu partes tôt."],
        ["Je souhaite qu'il réussit son examen.", "Je souhaite qu'il réussisse son examen."],
        ["Si j'aurais su, je serais venu.", "Si j'avais su, je serais venu."],
        ["S'ils viendront demain, préviens-moi.", "S'ils viennent demain, préviens-moi."],
        ["J'aurai aimé connaître la fin.", "J'aurais aimé connaître la fin."],
        ["J'aimerai bien partir en vacances.", "J'aimerais bien partir en vacances."],
        ["Je viendrais demain matin.", "Je viendrai demain matin."],
        ["Je mangerai du chocolat si j'aimais ça.", "Je mangerais du chocolat si j'aimais ça."],
      ],
      neg: [
        "Je sais bien que tu reviendras.",
        "Il est probable qu'il viendra.",
        "Je pense que tu as raison.",
        "Il était si content qu'il a pleuré.",
        "Il se doute que son voisin ment.",
        "Je me demande si tu viendrais.",
        "Je pourrais venir demain.",
        "Si tu veux, je viendrais demain.",
        "Quand je serai grand, je voudrai être pilote.",
        "C'est toi que j'aimerai toujours.",
        "J'aurai fini avant midi.",
        "Il faut que les enfants mangent.",
        "Il est possible que la situation va changer.",
      ],
    },
  ],
  [
    "frenchOrdinals",
    {
      pos: [
        ["Il habite au 3ème étage.", "Il habite au 3e étage."],
        ["C'est sa 1ère victoire.", "C'est sa 1re victoire."],
        ["Les 2emes places sont prises.", "Les 2es places sont prises."],
        ["Le 1ier janvier est férié.", "Le 1er janvier est férié."],
        ["Il est arrivé 2nd au sprint.", "Il est arrivé 2d au sprint."],
        ["Elle fête son 20ième anniversaire.", "Elle fête son 20e anniversaire."],
      ],
      neg: [
        "Il habite au 3e étage.",
        "C'est sa 1re victoire et son 1er titre.",
        "Le fichier v2ème.txt est là.",
        "Il a gagné 1ème place.",
        "La version 2.3ème est sortie.",
      ],
    },
  ],
  [
    "frenchCommas",
    {
      pos: [
        ["Ils, partent ce soir.", "Ils partent ce soir."],
        ["Mes voisins, rentrent tard.", "Mes voisins rentrent tard."],
        ["Elle range ses, vieux livres.", "Elle range ses vieux livres."],
        ["Je ne, sais pas.", "Je ne sais pas."],
        ["Je te, réponds demain.", "Je te réponds demain."],
        ["Nous avons, fini le repas.", "Nous avons fini le repas."],
        ["Tu peux, venir demain.", "Tu peux venir demain."],
        ["Il part tôt parce, qu'il travaille.", "Il part tôt parce qu'il travaille."],
        ["C'est elle, qui chante.", "C'est elle qui chante."],
        ["La maison où, nous habitons est vieille.", "La maison où nous habitons est vieille."],
        ["Cela, dépend du temps.", "Cela dépend du temps."],
        ["Il ne mange, jamais de viande.", "Il ne mange jamais de viande."],
        ["Le pire c'est l'attente.", "Le pire, c'est l'attente."],
        ["Ces lettres je les garde.", "Ces lettres, je les garde."],
        ["Il viendra demain répondit-elle.", "Il viendra demain, répondit-elle."],
        ["Je pars ajouta-t-il en riant.", "Je pars, ajouta-t-il, en riant."],
      ],
      neg: [
        "Ils partent ce soir.",
        "Lui, il sait tout.",
        "Elle, elle reste ici.",
        "Si, je viens avec toi.",
        "Les enfants, venez manger.",
        "Mes amis, qui veut du café ?",
        "Il a, bien sûr, réussi l'examen.",
        "Ce sont les leurs, pas les nôtres.",
        "Un, deux, trois, partez.",
        "Elle s'en alla, fatiguée par la route.",
        "Tout occupé que tu sois, tu dois manger.",
        "Un nom qui, sans sa copie fidèle, ne dit rien.",
        "Que dit-il ?",
        "Ainsi dit-il la vérité.",
        "Le plus grand des deux arrive.",
        "Ce matin je le vois.",
        "J'en peux plus, avancer !",
      ],
    },
  ],
  [
    "frenchMissingNe",
    {
      pos: [
        ["Parle bas pour pas qu'il se réveille.", "Parle bas pour qu'il ne se réveille pas."],
        ["Je note tout pour pas que j'oublie.", "Je note tout pour que je n'oublie pas."],
        ["J'ai pas compris ta question.", "Je n'ai pas compris ta question."],
        ["T'as pas vu mes clés ?", "Tu n'as pas vu mes clés ?"],
        ["On sait jamais avec lui.", "On ne sait jamais avec lui."],
        ["Il y a rien à manger.", "Il n'y a rien à manger."],
        ["C'est pas grave.", "Ce n'est pas grave."],
        ["Je m'attendais pas à ça.", "Je ne m'attendais pas à ça."],
        ["Mon frère veut pas venir.", "Mon frère ne veut pas venir."],
        ["Nous habitons pas ici.", "Nous n'habitons pas ici."],
        ["Elle répond à personne.", "Elle ne répond à personne."],
        ["Personne habite ici.", "Personne n'habite ici."],
        ["Rien bouge dans la rue.", "Rien ne bouge dans la rue."],
        ["Plus personne lui écrit.", "Plus personne ne lui écrit."],
        ["Ils savent plus très bien.", "Ils ne savent plus très bien."],
        ["Elle veut plus sortir le soir.", "Elle ne veut plus sortir le soir."],
      ],
      neg: [
        "C'est le meilleur film que j'ai jamais vu.",
        "Il y a pas mal de monde.",
        "Je ne sais pas.",
        "J'en veux plus.",
        "Une personne est venue.",
        "Il avance pas à pas.",
        "Il te suit rien que pour t'embêter.",
        "S'il revient, rien ne l'empêche de rester.",
        "Personne est un nom commun.",
        "Il passe de personne à personne.",
        "Je travaille plus que toi.",
        "Personne âgée cherche une aide.",
        "Rien de nouveau sous le soleil.",
      ],
    },
  ],
];

describe.each(FIXTURES)("%s", (ruleId, { pos, neg }) => {
  test("runs only for French", () => {
    expect(runsInReviewLanguage(ruleId, "fr_FR")).toBe(true);
    for (const lang of ["en_US", "de_DE", "es_ES", "auto_detect"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
  });
  test.each(pos)("fires on %p", (text, fixed) => {
    const [finding, ...rest] = findings(ruleId, text);
    expect(rest).toEqual([]);
    expect(finding).toBeDefined();
    const out = applyEdits(text, finding.alternatives[0].edits)!;
    expect(out).toBe(fixed);
    expect(findings(ruleId, out)).toEqual([]);
  });
  test.each(neg)("stays silent on %p", (text) => {
    expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
  });
});

describe("French lexicon", () => {
  test("the committed lexicon matches fr_FR.dic/.aff (bun run generate:french-lexicon)", async () => {
    const [dic, aff, committed] = await Promise.all(
      [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff, FRENCH_LEXICON_SOURCES.out].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildFrenchLexicon(dic, aff)).toBe(committed);
  });

  test.each([
    ["mange", JE | IL],
    ["manges", TU],
    ["mangeons", NOUS],
    ["mangez", VOUS],
    ["mangent", ILS],
    ["mangeais", JE | TU],
    ["peux", JE | TU],
    ["peut", IL],
    ["vont", ILS],
    ["suis", JE | TU],
    ["sommes", TU | NOUS],
    ["faites", VOUS],
    ["viennent", ILS],
    ["livre", JE | IL],
    ["chaise", 0],
  ])("%s agrees with persons %d", (word, persons) => {
    expect(finitePersons(word as string)).toBe(persons as number);
  });

  test("the present subjunctive conjugates for every person", () => {
    const subjunctive = (word: string, lemma: string) =>
      verbReadings(word).find((r) => r.lemma === lemma && r.tense > 2)!;
    const prenne = subjunctive("prenne", "prendre");
    expect(conjugate(prenne, ILS)).toEqual(["prennent"]);
    expect(conjugate(prenne, NOUS)).toEqual(["prenions"]);
    expect(conjugate(prenne, VOUS)).toEqual(["preniez"]);
    expect(conjugate(subjunctive("aille", "aller"), IL)).toEqual(["aille"]);
    expect(conjugate(subjunctive("vienne", "venir"), ILS)).toEqual(["viennent"]);
  });

  test("readings name the lemma, the participles and the infinitives", () => {
    expect(verbReadings("mangé").map((r) => [r.lemma, r.slot])).toEqual([["manger", "Q"]]);
    expect(verbReadings("dû").map((r) => [r.lemma, r.slot])).toEqual([["devoir", "Q"]]);
    expect(verbReadings("aller").map((r) => r.slot)).toContain("I");
    const [peut] = verbReadings("peut");
    expect(conjugate(peut, JE)).toContain("peux");
    expect(conjugate(peut, ILS)).toEqual(["peuvent"]);
    const [allaient] = verbReadings("allaient");
    expect(conjugate(allaient, NOUS)).toEqual(["allions"]);
  });

  test("the noun filter knows inflected nouns and invariable words in s", () => {
    for (const word of ["maison", "cheval", "bateau", "fils", "temps", "grand", "cours", "frais"]) {
      expect(isNounLemma(word)).toBe(true);
      expect(isInflectedNoun(word)).toBe(true);
    }
    for (const word of ["maisons", "chevaux", "peintures", "gâteaux", "cadres", "grands"]) {
      expect(isNounLemma(word)).toBe(false);
      expect(isInflectedNoun(word)).toBe(true);
    }
    for (const word of ["mangeons", "grandes", "dîné", "dînés", "parlons"])
      expect(isInflectedNoun(word)).toBe(false);
  });

  test("authored genders fill what the n-gram counts miss", () => {
    for (const word of ["rumeur", "chaleur", "voix", "cerise"]) expect(nounGender(word)).toBe("f");
    for (const word of ["ouragan", "temps", "honneur", "musée"]) expect(nounGender(word)).toBe("m");
  });

  test("the noun list is exact: strings near an entry are no entries", () => {
    // A Bloom filter let about 1% of other strings through ("enis" read as a noun, so "denis"
    // became "d'enis").
    for (const word of ["enis", "miniembout", "miniembouts", "mini-putt", "maisonz", "grandd"])
      expect(isInflectedNoun(word)).toBe(false);
    expect(findings("frenchElision", "Il a vu denis hier.")).toEqual([]);
    expect(findings("frenchHyphenation", "Un lot de 15 mini embouts.")).toEqual([]);
  });

  test("a word graph holds exactly its words", () => {
    const words = ["chat", "chats", "chaton", "rat", "rateau", "plat", "grand|F.", "petit|F."];
    const graph = new WordGraph(encodeWordGraph(words));
    for (const word of words) expect(graph.has(word)).toBe(true);
    for (const word of ["", "cha", "chatons", "rats", "grand", "grand|", "plats", "zat"])
      expect(graph.has(word)).toBe(false);
    expect(graph.completions("grand|")).toEqual(["F."]);
    expect(graph.completions("chat").sort()).toEqual(["", "on", "s"]);
    expect(graph.completions("x")).toEqual([]);
  });

  test("the noun filter leaves out function words in s and x", () => {
    for (const word of ["dans", "depuis", "désormais", "les", "nous", "très", "toujours", "chez"])
      expect(isInflectedNoun(word)).toBe(false);
    for (const word of ["pas", "vers", "dessous", "temps", "corps"])
      expect(isInflectedNoun(word)).toBe(true);
  });

  test("the committed noun filter matches fr_FR.dic/.aff", async () => {
    const [dic, aff, committed] = await Promise.all(
      [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff, FRENCH_LEXICON_SOURCES.nouns].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildFrenchNouns(dic, aff)).toBe(committed);
  });

  // Needs python3 with marisa-trie and numpy (scripts/requirements.txt) to read the n-gram trie.
  const bigrams = readDeterminerBigrams();
  test.skipIf(bigrams === null)(
    "the committed gender lists match fr_FR.dic/.aff and the n-gram counts",
    async () => {
      const [dic, aff, committed] = await Promise.all(
        [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff, FRENCH_LEXICON_SOURCES.gender].map(
          (path) => readFile(path, "utf8"),
        ),
      );
      expect(buildFrenchGender(dic, aff, bigrams!)).toBe(committed);
    },
  );

  test("nouns get their gender from the lists or their ending, never for either-gender words", () => {
    for (const word of ["maison", "voiture", "réunion", "liberté", "soif"])
      expect(nounGender(word)).toBe("f");
    for (const word of ["arbre", "problème", "gouvernement", "camion", "silence"])
      expect(nounGender(word)).toBe("m");
    for (const word of ["élève", "tour", "journaliste", "xyzzy"])
      expect(nounGender(word)).toBe(null);
  });

  test("the committed adjective forms match fr_FR.dic/.aff", async () => {
    const [dic, aff, committed] = await Promise.all(
      [
        FRENCH_LEXICON_SOURCES.dic,
        FRENCH_LEXICON_SOURCES.aff,
        FRENCH_LEXICON_SOURCES.adjectives,
      ].map((path) => readFile(path, "utf8")),
    );
    expect(buildFrenchAdjectives(dic, aff)).toBe(committed);
  });

  test("the committed compounds match fr_FR.dic and leave free phrases out", async () => {
    const [dic, committed] = await Promise.all(
      [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.compounds].map((path) =>
        readFile(path, "utf8"),
      ),
    );
    expect(buildFrenchCompounds(dic)).toBe(committed);
    expect(isDictionaryCompound("coffre-fort")).toBe(true);
    expect(isDictionaryCompound("petite-fille")).toBe(false);
    expect(isDictionaryCompound("compte-rendu")).toBe(false);
  });

  test("adjective readings give gender and number, and the other forms", () => {
    const [tropicale] = adjectiveReadings("tropicale");
    expect([tropicale.lemma, tropicale.slot]).toEqual(["tropical", "fs"]);
    expect(inflect(tropicale, "mp")).toEqual(["tropicaux"]);
    expect(adjectiveReadings("vieux").map((r) => r.slot)).toEqual(["ms", "mp"]);
    expect(inflect(adjectiveReadings("blanc")[0], "fs")).toEqual(["blanche"]);
    expect(adjectiveReadings("maison")).toEqual([]);
  });

  test("homographs are verb forms that another entry also spells", () => {
    expect(isVerbHomograph("passé")).toBe(true);
    expect(isVerbHomograph("dîner")).toBe(true);
    expect(isVerbHomograph("mangé")).toBe(false);
  });
});

test("no French chunk stalls on adversarial input", () => {
  const options = {
    lang: "fr_FR",
    enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options,
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const triggers =
    "vous ne le lui avez pas encore demander pour vous aider à mangé de passé il faut lavé. ";
  slowest(triggers.repeat(10));
  for (const text of [
    triggers.repeat(60),
    "vous ".repeat(1_000),
    "de de de mangé ".repeat(400),
    `x${" ".repeat(3_800)}${triggers}`,
    "mangé ".repeat(800),
    "il à a ou où sa se ce la ma sont du ont ".repeat(150),
    "un maison la problème cette arbre du réunion ma vélo comme même que also ".repeat(150),
    "les rues était calmes et les dossiers triées que j'ai aidée nous avons mangés ".repeat(120),
    "c'est moi qui ceux qui le la les un une ".repeat(250),
    "ont peut quant la son on peux là ".repeat(250),
    "tout toute tous toutes les le la ceux ça ".repeat(250),
    "il faut que bien qu' si s'ils j'aurai aimé je viendrais demain ".repeat(150),
    "j'ai pas on sait jamais il y a rien c'est pas ".repeat(200),
    "il ni si sans mes dans leurs mêmes d'avantage quel que soit anti sur sous néo-x ".repeat(150),
  ])
    expect(slowest(text)).toBeLessThan(100);
});

test("French impossible days and months are flagged without a fix", () => {
  for (const text of ["Elle est née le 32 janvier.", "Il est né le 11/50/2014."]) {
    const [finding, ...rest] = findings("frenchDates", text);
    expect(rest).toEqual([]);
    expect(finding.alternatives).toEqual([]);
  }
});

test("French keeps glued hours but spaces other units and currencies", () => {
  expect(findings("measurementUnitFormatting", "Il a couru 10km hier.")).toHaveLength(1);
  expect(findings("currencySpacing", "Le livre coûte 5€.")).toHaveLength(1);
});

test("French time zones and pronoun + article pairs stay clean", () => {
  for (const text of ["La réunion commence à 15:00 CEST.", "Rendez-vous à 20h30, cest."])
    expect(findings("englishContractionNormalization", text)).toEqual([]);
  expect(findings("englishContractionNormalization", "Je pense que cest vrai.")).toHaveLength(1);
  expect(findings("englishRepeatedWords", "Je m'en achèterai un un jour.")).toEqual([]);
  expect(findings("englishRepeatedWords", "Il a pris les les clés.")).toHaveLength(1);
});

const FRENCH_ON = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) =>
    runsInReviewLanguage(id, "fr_FR") &&
    !["capitalizeSentenceStart", "capitalizeAfterLineBreak", "styleLongSentence"].includes(id),
);

test("the clean French corpus has no findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/french-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: FRENCH_ON,
      lang: "fr_FR",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

test.each([
  ["measurementUnitFormatting", "Rendez-vous à 14h devant la gare, ou à 9h demain."],
  ["frenchHomophones", "Le 3 mai il pleuvait."],
  ["frenchHomophones", "Ce sont les mêmes si je me souviens bien."],
  ["frenchHomophones", "Il a tiré avantage de la situation."],
  ["frenchHomophones", "Il n'y a pas d'avantage à attendre."],
  ["frenchHomophones", "Ils ont fini leurs devoirs."],
  ["frenchHomophones", "Quels que soient le lieu de livraison et le mode de paiement."],
  ["frenchHomophones", "J'ai trois années d'expérience."],
  ["frenchHomophones", "Nous avons passé deux années difficiles."],
  ["frenchHomophones", "Le pain et le beurre sont sur la table."],
  ["frenchHomophones", "Elle et moi sommes partis."],
  ["frenchHomophones", "Le rouge et noir lui va bien."],
  ["frenchHomophones", "Ce qui est fait est fait."],
  ["frenchHyphenation", "Viens le voir demain."],
  ["frenchHyphenation", "Porte la valise jusqu'au train."],
  ["frenchHyphenation", "Mets en marche le moteur."],
  ["frenchHyphenation", "Garde la tête haute."],
  ["frenchDates", "La version 31.4 est sortie."],
  ["frenchDates", "Il revient le 12.5 au matin."],
  ["frenchDates", "Les 300 janvier de la série."],
  ["frenchDates", "Il est né le 29/02/2024."],
  ["frenchHomophones", "Deux cents millions d'habitants."],
  ["frenchHomophones", "Trois cent mille euros et quatre-vingt-dix centimes."],
  ["frenchHomophones", "Le taux atteint trois pour cent."],
  ["frenchHyphenation", "Il compte sur tout le monde."],
  ["frenchHyphenation", "Elle est sous pression."],
  ["frenchHyphenation", "Un verre anti-reflets et un écran auto-bronzant."],
  ["frenchHyphenation", "Ce texte peut être utile."],
  ["frenchHyphenation", "Il est peut-être là."],
  ["frenchHyphenation", "Il se lève tôt le matin."],
  ["frenchElision", "Ma sœur et quelle chance !"],
  ["frenchHomophones", "Tu viens ou tu restes ?"],
  ["frenchHomophones", "Ce qu'il veut est simple."],
  ["frenchHomophones", "Il compte bien sur nous et sur elle."],
  ["frenchHomophones", "Celui qui part est triste."],
  ["frenchHomophones", "Il a des pièces vissées ou est fixé avec des clous."],
  ["frenchHomophones", "On voit ou on ne voit pas."],
  ["frenchHomophones", "Je ne sais pas quel âge a ton frère."],
  ["frenchHomophones", "Mon frère mange et sa femme a la grippe."],
  ["frenchElision", "Il travaille davantage le soir."],
  ["frenchElision", "Deux ans après nait sa fille."],
  ["frenchElision", "The den is dark and the sun is out."],
  ["frenchElision", "Il porte un jean et une veste."],
  ["frenchHyphenation", "Le nord est froid en hiver."],
  ["frenchHyphenation", "Une petite fille joue dans le parc."],
  ["frenchHyphenation", "Il a rédigé un compte rendu."],
  ["frenchHyphenation", "Les équations non linéaires sont difficiles."],
  ["frenchHyphenation", "Je l'ai vu chez vous."],
  ["frenchHyphenation", "Visez le sans faute !"],
  ["frenchHyphenation", "Il est arrivé à cent pour cent."],
  ["frenchElision", "Le sigle vient de also known as, en anglais."],
  ["frenchElision", "Il épelle son nom : d o r a."],
  ["frenchSubjectVerbAgreement", "« Je est un autre » reste une formule célèbre."],
  ["frenchSubjectVerbAgreement", "Le pronom personnel tu n'est pas toujours exprimé."],
  ["frenchHomophones", "Il a l'air ravi de sa journée."],
  ["frenchHomophones", "S'est dit d'un outil qu'on emporte partout."],
  ["frenchHomophones", "Comme même les plus prudents se trompent, restons humbles."],
  ["frenchVerbForms", "Ces travaux ont bien entendu gêné les riverains."],
  ["frenchNounNumber", "Un tiens vaut mieux que deux tu l'auras."],
  ["frenchHyphenation", "Ce texte devra peu à peu être corrigé."],
  ["englishPhraseCorrections", "La créatrice Mary Quant, Quant on la cite, fait sourire."],
  ["duplicatePunctuationCollapse", "Jean Dupont (1960-....) est peintre."],
  ["frenchVerbForms", "Il a peur des orages depuis l'enfance."],
  ["frenchVerbForms", "Il y a trait à la santé publique."],
  ["frenchVerbForms", "Elle a envie de partir loin."],
  ["frenchAdjectiveAgreement", "Je les ai vus hier soir."],
  ["frenchAdjectiveAgreement", "Marie est médecin et Paul est infirmier."],
  ["frenchAdjectiveAgreement", "Julien et Sophie sont mariés depuis dix ans."],
  ["frenchAdjectiveAgreement", "Marie-Pierre est contente."],
  ["frenchAdjectiveAgreement", "Camille est fatigué ce soir."],
  ["frenchAdjectiveAgreement", "Avec Martine, Paul est heureux."],
  ["frenchAdjectiveAgreement", "Ces chanteuses chantent fort."],
  ["frenchAdjectiveAgreement", "Elles sont fort aimables."],
  ["frenchAdjectiveAgreement", "Les étagères sont haut placées."],
  ["frenchAdjectiveAgreement", "Quelles pommes vous avez mangées ?"],
  ["frenchAdjectiveAgreement", "Les musiciennes que j'ai entendu chanter étaient douées."],
  ["frenchAdjectiveAgreement", "La maison que j'ai eu la chance de visiter est vendue."],
  ["frenchAdjectiveAgreement", "Une humiliation qu'elle a réussi à cacher."],
  ["frenchAdjectiveAgreement", "La lettre que j'ai voulu t'envoyer est perdue."],
  ["frenchAdjectiveAgreement", "Un camion qui passait nous a éclaboussés."],
  ["frenchAdjectiveAgreement", "Elles ont été invitées au mariage."],
  ["frenchAdjectiveAgreement", "Les colis que j'ai attendus sont enfin là."],
  ["frenchAdjectiveAgreement", "Nous avons attendu le bus sous la pluie."],
  ["frenchAdjectiveAgreement", "Le juge a lu les attendus du jugement."],
  ["frenchAdjectiveAgreement", "La rumeur qu'il avait été arrêté circulait déjà."],
  ["frenchAdjectiveAgreement", "Ces deux clans ont partie liée depuis longtemps."],
  ["englishCanonicalCasing", "Je skype avec ma sœur chaque dimanche."],
  ["englishCanonicalCasing", "Marc skype souvent avec ses clients."],
  ["capitalizeSentenceStart", "Prenez un moule de 18 cm. de diamètre et beurrez-le."],
  ["frenchElision", "Puis je y entrer sans billet ?"],
  ["frenchSubjectVerbAgreement", "Des idées, en as tu encore ?"],
  ["frenchAdjectiveAgreement", "Voici la photo du jardin que j'ai dessiné."],
  ["frenchAdjectiveAgreement", "Sa voisine m'a paru gentille et discrète."],
  ["frenchAdjectiveAgreement", "La maison nous a coûté cher."],
  ["frenchAdjectiveAgreement", "Les filles nous ont parlé longtemps."],
  ["frenchAdjectiveAgreement", "Elle garde la clé de la maison que son père a construit."],
  ["frenchAdjectiveAgreement", "Les copies que tu as rendues étaient propres."],
  ["frenchHomophones", "À qui on parlé de cette affaire ?"],
  ["frenchHomophones", "Quelqu'un peut m'aider ?"],
  ["frenchHomophones", "Il est trop peut-être, mais il a raison."],
  ["frenchHomophones", "Quant à moi, je reste ici."],
  ["frenchHomophones", "Je la vois tous les jours."],
  ["frenchHomophones", "Do ré mi fa sol la."],
  ["frenchHomophones", "Donne-la à ta sœur."],
  ["frenchHomophones", "C'est celle la plus chère."],
  ["frenchHomophones", "Il a bientôt fini son travail."],
  ["frenchHomophones", "Il a moins de chance que toi."],
  ["frenchHomophones", "Sa grâce a séduit le public."],
  ["frenchHomophones", "Le rapport a été publié hier."],
  ["frenchHomophones", "Soit a tel que a soit positif."],
  ["frenchHomophones", "Sami a télécharger l'application."],
  ["frenchHomophones", "Les enfants de son frère jouent dehors."],
  ["frenchSubjectVerbAgreement", "Le policier le plus proche intervient."],
  ["frenchSubjectVerbAgreement", "Ce matin nous avons froid."],
  ["frenchSubjectVerbAgreement", "Des copains plus vieux que moi qui fumaient."],
  ["frenchSubjectVerbAgreement", "Notre Père qui êtes aux cieux."],
  ["frenchSubjectVerbAgreement", "Un exemple frappant sont les nouvelles lois."],
  ["frenchSubjectVerbAgreement", "Les habitants comme le maire ont voté."],
  ["frenchSubjectVerbAgreement", "Une intoxication en cours peut être grave."],
  ["frenchHomophones", "Le chat a faim depuis ce matin."],
  ["frenchHomophones", "La loi a valeur de règle."],
  ["frenchHomophones", "Le public a accès au jardin."],
  ["frenchHomophones", "Le gâteau a bon goût."],
  ["frenchHomophones", "La réunion a lieu demain."],
  ["frenchHomophones", "Je sais que le chat a peur."],
  ["frenchHomophones", "Ce que je dis a du sens."],
  ["frenchHomophones", "Chaque photo a son histoire."],
  ["frenchHomophones", "L'article a bien été ajouté."],
  ["frenchHomophones", "Il dit que celui qui ment a tort."],
  ["frenchHomophones", "Eux non plus ne viendront pas."],
  ["frenchHomophones", "Les filles, non pas les garçons, ont gagné."],
  ["frenchHomophones", "Les enfants, on mange !"],
  ["frenchHomophones", "Quand les enfants dorment on les laisse."],
  ["frenchHomophones", "Les voisins on les voit souvent."],
  ["frenchHomophones", "Les enquêteurs on fait ce qu'on peut."],
  ["frenchHomophones", "Des cerises sures et des pommes sures."],
  ["frenchSubjectVerbAgreement", "Nous deux partirons demain."],
  ["frenchHyphenation", "Mon pseudo actuel est court."],
  ["frenchHomophones", "Ce sont des amis fidèles."],
  ["frenchHomophones", "Ce pouvoir est immense."],
  ["frenchHomophones", "Le chat ce matin dort."],
  ["frenchHomophones", "C'est vrai que les gens partent."],
  ["frenchHomophones", "Ce dimanche reste calme."],
  ["frenchHyphenation", "Une auto électrique passe."],
  ["frenchHyphenation", "C'est extra aujourd'hui."],
  ["frenchHyphenation", "Il regarde la télé ce soir."],
  ["frenchHyphenation", "Un produit bio frais."],
  ["frenchHyphenation", "L'agence Martin and Co accompagne ses clients."],
  ["frenchHyphenation", "Les relations franco-allemandes."],
  ["frenchSubjectVerbAgreement", "Elles trois chantent."],
  ["frenchSubjectVerbAgreement", "Il agit en tant que personne ne voulant rien."],
  ["frenchSubjectVerbAgreement", "C'est pour qui travail ?"],
  ["frenchHomophones", "Le stylo est sur ou sous le cahier."],
  ["frenchHomophones", "C'est sur elle que tout repose."],
  ["frenchHomophones", "C'est sur la table."],
  ["frenchHomophones", "Il compte plus sur toi que sur moi."],
  ["frenchSubjectVerbAgreement", "Mes amis, qui veut du café ?"],
  ["frenchSubjectVerbAgreement", "Demande à tes amis qui veut venir."],
  ["frenchSubjectVerbAgreement", "Beaucoup de monde pense ainsi."],
  ["frenchSubjectVerbAgreement", "Un des enfants qui jouait est tombé."],
  ["frenchSubjectVerbAgreement", "La mère des enfants qui est venue nous attend."],
  ["frenchSubjectVerbAgreement", "C'est la manière dont ils traitent leurs clients qui compte."],
  ["frenchSubjectVerbAgreement", "Les plats faits maison sont bons."],
  ["frenchSubjectVerbAgreement", "De quels livres parles-tu ?"],
  ["frenchSubjectVerbAgreement", "Combien de fois ai je dit cela ?"],
  ["frenchSubjectVerbAgreement", "Beaucoup de temps passe ainsi."],
  ["frenchSubjectVerbAgreement", "Il parle avec les voisins de Paul qui habite en face."],
] as Array<[CatalogRuleId, string]>)("%s stays silent on %p", (ruleId, text) => {
  expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
});

test.each([
  ["frenchHomophones", "Il ni comprend rien.", "Il n'y comprend rien."],
  ["frenchHomophones", "Elle si prend bien.", "Elle s'y prend bien."],
  ["frenchHomophones", "Il sans va demain.", "Il s'en va demain."],
  ["frenchHomophones", "Il est fatigué, mes je continue.", "Il est fatigué, mais je continue."],
  ["frenchHomophones", "Je viens dans prendre.", "Je viens d'en prendre."],
  ["frenchHomophones", "Cela leurs permet de partir.", "Cela leur permet de partir."],
  ["frenchHomophones", "Il viendra mêmes si tu refuses.", "Il viendra même si tu refuses."],
  ["frenchHomophones", "Je pense d'avantage à toi.", "Je pense davantage à toi."],
  ["frenchHomophones", "Quel que soit sa raison, il part.", "Quelle que soit sa raison, il part."],
  [
    "frenchHomophones",
    "Quelles que soit ses idées, on écoute.",
    "Quelles que soient ses idées, on écoute.",
  ],
  ["frenchHomophones", "Ma fille a maintenant six années.", "Ma fille a maintenant six ans."],
  ["frenchHomophones", "Il est âgé de quarante années.", "Il est âgé de quarante ans."],
  ["frenchHomophones", "Le facteur et arrivé en retard.", "Le facteur est arrivé en retard."],
  ["frenchHomophones", "Ceci et une erreur.", "Ceci est une erreur."],
  ["frenchHomophones", "C'est celle qui et devant.", "C'est celle qui est devant."],
  ["frenchHomophones", "Ils arrivent est repartent vite.", "Ils arrivent et repartent vite."],
  ["frenchHomophones", "Il partit tôt est ne revint pas.", "Il partit tôt et ne revint pas."],
  ["frenchHyphenation", "Dis lui bonjour de ma part.", "Dis-lui bonjour de ma part."],
  ["frenchHyphenation", "Regarde la.", "Regarde-la."],
  ["frenchHyphenation", "Prends en un peu.", "Prends-en un peu."],
  ["frenchHyphenation", "Faites les entrer.", "Faites-les entrer."],
  ["frenchDates", "Il est né le 31.11.1989.", "Il est né le 30.11.1989."],
  ["frenchDates", "Elle arrive le 31-9-24.", "Elle arrive le 30-9-24."],
  ["frenchDates", "Elle est née le 31.04.", "Elle est née le 30.04."],
  ["frenchHomophones", "J'ai acheté trois cent timbres.", "J'ai acheté trois cents timbres."],
  [
    "frenchHomophones",
    "Il a payé deux cents cinquante euros.",
    "Il a payé deux cent cinquante euros.",
  ],
  ["frenchHomophones", "Mon grand-père a quatre-vingt ans.", "Mon grand-père a quatre-vingts ans."],
  ["frenchHyphenation", "Un rapport néo-rural.", "Un rapport néorural."],
  ["frenchHyphenation", "Ils sont sur exploités.", "Ils sont surexploités."],
  ["frenchHyphenation", "Les pays sous développés.", "Les pays sous-développés."],
  ["frenchHyphenation", "Il veut contre attaquer.", "Il veut contre-attaquer."],
  [
    "frenchHyphenation",
    "Range l'argent dans le coffre fort.",
    "Range l'argent dans le coffre-fort.",
  ],
  ["frenchHyphenation", "Il a acheté un porte monnaie.", "Il a acheté un porte-monnaie."],
  ["frenchHyphenation", "Les sous titres sont lisibles.", "Les sous-titres sont lisibles."],
  [
    "frenchHyphenation",
    "Le secteur agro alimentaire recrute.",
    "Le secteur agro-alimentaire recrute.",
  ],
  ["frenchHyphenation", "Ma grand mère tricote.", "Ma grand-mère tricote."],
  ["frenchHyphenation", "Il n'est peut être pas venu.", "Il n'est peut-être pas venu."],
  [
    "frenchHyphenation",
    "Ainsi, peut être que tout ira bien.",
    "Ainsi, peut-être que tout ira bien.",
  ],
  ["frenchHyphenation", "Il peut-être têtu.", "Il peut être têtu."],
  ["frenchHomophones", "Il est venu comme même.", "Il est venu quand même."],
  ["frenchHomophones", "C'est comme même bizarre.", "C'est quand même bizarre."],
  ["frenchHyphenation", "Il viendra peu être demain.", "Il viendra peut-être demain."],
  ["frenchHyphenation", "C'est peu être la bonne réponse.", "C'est peut-être la bonne réponse."],
  ["frenchElision", "Il parle de un ami.", "Il parle d'un ami."],
  [
    "frenchVerbForms",
    "Hier, j'ai enfin comprit le problème.",
    "Hier, j'ai enfin compris le problème.",
  ],
  ["frenchVerbForms", "Elle a reçut un colis ce matin.", "Elle a reçu un colis ce matin."],
  ["frenchVerbForms", "Nous avons prit le dernier train.", "Nous avons pris le dernier train."],
  [
    "frenchVerbForms",
    "Ils ont beaucoup rit pendant le film.",
    "Ils ont beaucoup ri pendant le film.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Nous avons visités le château hier.",
    "Nous avons visité le château hier.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Elle n'a rien répondue à ma lettre.",
    "Elle n'a rien répondu à ma lettre.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Les fleurs que j'ai cueilli sont fanées.",
    "Les fleurs que j'ai cueillies sont fanées.",
  ],
  ["frenchAdjectiveAgreement", "Avez-vous reçus mon message ?", "Avez-vous reçu mon message ?"],
  ["frenchVerbForms", "J'ai allé au marché ce matin.", "Je suis allé au marché ce matin."],
  ["frenchMood", "Si tu étais venu, je serai resté.", "Si tu étais venu, je serais resté."],
  ["frenchMood", "Si j'avais su, je n'aurai rien dit.", "Si j'avais su, je n'aurais rien dit."],
  ["frenchVerbForms", "Nous avons arrivé en retard.", "Nous sommes arrivé en retard."],
  ["frenchVerbForms", "Elle est dormi tout l'après-midi.", "Elle a dormi tout l'après-midi."],
  ["frenchVerbForms", "Il est été malade toute la semaine.", "Il a été malade toute la semaine."],
  ["frenchVerbForms", "Tu es raison sur ce point.", "Tu as raison sur ce point."],
  ["frenchVerbForms", "Demain, elle est douze ans.", "Demain, elle a douze ans."],
  ["frenchAdjectiveAgreement", "Les as-tu rangé hier ?", "Les as-tu rangés hier ?"],
  ["frenchAdjectiveAgreement", "L'a-t-il vendus ?", "L'a-t-il vendu ?"],
  ["frenchNounGender", "Tire du chasse avant de sortir.", "Tire de la chasse avant de sortir."],
  ["frenchNounGender", "Cette crayon est cassé.", "Ce crayon est cassé."],
  [
    "frenchAdjectiveAgreement",
    "Les chansons que nous avons aimé passent encore.",
    "Les chansons que nous avons aimées passent encore.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Les lettres que j'ai beaucoup relu sont là.",
    "Les lettres que j'ai beaucoup relues sont là.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Le roman qu'elle a lue était passionnant.",
    "Le roman qu'elle a lu était passionnant.",
  ],
  // A participle that is also a noun ("un attendu", "un rendu") is the participle after avoir.
  [
    "frenchAdjectiveAgreement",
    "Les réponses que nous avions attendu sont bonnes.",
    "Les réponses que nous avions attendues sont bonnes.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Les copies que tu as rendu étaient propres.",
    "Les copies que tu as rendues étaient propres.",
  ],
  ["frenchAdjectiveAgreement", "Ils ont attendus dehors.", "Ils ont attendu dehors."],
  ["frenchSubjectVerbAgreement", "Je leur ait envoyé une carte.", "Je leur ai envoyé une carte."],
  // A linking verb past an indirect object pronoun, "a paru", or a modal's "a pu être".
  ["frenchAdjectiveAgreement", "Sa réponse m'a paru blessant.", "Sa réponse m'a paru blessante."],
  ["frenchAdjectiveAgreement", "La salle leur semblait petit.", "La salle leur semblait petite."],
  [
    "frenchAdjectiveAgreement",
    "Les murs ont pu être construit en hiver.",
    "Les murs ont pu être construits en hiver.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Dès que Paul et Léa arrive je pars.",
    "Dès que Paul et Léa arrivent je pars.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Il faut que je lui ait répondu avant midi.",
    "Il faut que je lui aie répondu avant midi.",
  ],
  ["frenchHomophones", "Mes cousins son très gentils.", "Mes cousins sont très gentils."],
  [
    "frenchHomophones",
    "Je salue ceux qui on fui la guerre.",
    "Je salue ceux qui ont fui la guerre.",
  ],
  ["frenchHomophones", "Elle mange trop peut le soir.", "Elle mange trop peu le soir."],
  ["frenchHomophones", "Il est passé il y a peut.", "Il est passé il y a peu."],
  ["frenchHomophones", "Peut de gens le savent.", "Peu de gens le savent."],
  ["frenchHomophones", "Ici, ont peut tout acheter.", "Ici, on peut tout acheter."],
  ["frenchHomophones", "Tu reviendras quant ?", "Tu reviendras quand ?"],
  ["frenchHomophones", "C'est la que tout a commencé.", "C'est là que tout a commencé."],
  ["frenchHomophones", "Ton frère est la ?", "Ton frère est là ?"],
  ["frenchHomophones", "Il habite la-bas depuis un an.", "Il habite là-bas depuis un an."],
  ["frenchDates", "Rendez-vous le 31/04 à midi.", "Rendez-vous le 30/04 à midi."],
  ["frenchElision", "Attends, jarrive tout de suite.", "Attends, j'arrive tout de suite."],
  ["frenchHomophones", "C'est la seule fois ou il a ri.", "C'est la seule fois où il a ri."],
  ["frenchHomophones", "Elle est drôle est gentille.", "Elle est drôle et gentille."],
  ["frenchHomophones", "Nous en sommes surs.", "Nous en sommes sûrs."],
  ["frenchHomophones", "Il viendra bien sur très vite.", "Il viendra bien sûr très vite."],
  ["frenchHomophones", "Assieds-toi ou tu veux.", "Assieds-toi où tu veux."],
  ["frenchHomophones", "Je ne vois pas ou aller.", "Je ne vois pas où aller."],
  ["frenchHomophones", "Elle envoie un colis a sa mère.", "Elle envoie un colis à sa mère."],
  ["frenchElision", "Il nen veut plus.", "Il n'en veut plus."],
  ["frenchElision", "C'est le livre dun ami.", "C'est le livre d'un ami."],
  ["frenchElision", "Je laurais acheté.", "Je l'aurais acheté."],
  ["frenchElision", "Il s en souvient.", "Il s'en souvient."],
  ["frenchHomophones", "Pose-le la où tu l'as pris.", "Pose-le là où tu l'as pris."],
  ["frenchHomophones", "Elle est toujours la.", "Elle est toujours là."],
  ["frenchHomophones", "Que faites-vous la ?", "Que faites-vous là ?"],
  ["frenchHomophones", "Ce soir-la, il neigeait.", "Ce soir-là, il neigeait."],
  ["frenchHomophones", "Je préfère celle la.", "Je préfère celle-là."],
  ["frenchHomophones", "Il reste beaucoup a faire.", "Il reste beaucoup à faire."],
  ["frenchHomophones", "Il me reste un exercice a finir.", "Il me reste un exercice à finir."],
  ["frenchHomophones", "La poste est a côté.", "La poste est à côté."],
  ["frenchHomophones", "Je viendrai, a moins qu'il pleuve.", "Je viendrai, à moins qu'il pleuve."],
  ["frenchHomophones", "Salut, a demain !", "Salut, à demain !"],
  ["frenchHomophones", "Il a réussi grâce a toi.", "Il a réussi grâce à toi."],
  ["englishPhraseCorrections", "Elles ne son pas prêtes.", "Elles ne sont pas prêtes."],
  [
    "frenchSubjectVerbAgreement",
    "Les routes était glissantes ce matin.",
    "Les routes étaient glissantes ce matin.",
  ],
  ["frenchSubjectVerbAgreement", "Mon voisin ne peux pas venir.", "Mon voisin ne peut pas venir."],
  [
    "frenchSubjectVerbAgreement",
    "Les trains n'arrive plus à l'heure.",
    "Les trains n'arrivent plus à l'heure.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Ma sœur qui habitent à Lyon viendra.",
    "Ma sœur qui habite à Lyon viendra.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "C'est toi qui a gagné la partie.",
    "C'est toi qui as gagné la partie.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Celles qui travaille ici sont contentes.",
    "Celles qui travaillent ici sont contentes.",
  ],
  ["frenchHomophones", "Il range sa boîte a outils.", "Il range sa boîte à outils."],
  ["frenchHomophones", "Passe-moi la brosse a cheveux.", "Passe-moi la brosse à cheveux."],
  ["frenchHomophones", "Je crois qu'elle ira a la plage.", "Je crois qu'elle ira à la plage."],
  [
    "frenchHomophones",
    "Les candidats ont été reçus a l'oral.",
    "Les candidats ont été reçus à l'oral.",
  ],
  ["frenchHomophones", "Nos cousins son partis tôt.", "Nos cousins sont partis tôt."],
  [
    "frenchSubjectVerbAgreement",
    "Beaucoup de touristes visite le musée.",
    "Beaucoup de touristes visitent le musée.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "La plupart des clients achète en ligne.",
    "La plupart des clients achètent en ligne.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "De nombreux habitants proteste.",
    "De nombreux habitants protestent.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Je connais un homme qui parlent six langues.",
    "Je connais un homme qui parle six langues.",
  ],
  ["frenchSubjectVerbAgreement", "Voici les livres qui manque.", "Voici les livres qui manquent."],
  [
    "frenchSubjectVerbAgreement",
    "Les invités, qui arrive de loin, sont fatigués.",
    "Les invités, qui arrivent de loin, sont fatigués.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Les amis de Jean Martin arrive ce soir.",
    "Les amis de Jean Martin arrivent ce soir.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Les filles comme Julie aime danser.",
    "Les filles comme Julie aiment danser.",
  ],
  ["frenchSubjectVerbAgreement", "Nos enfants viendrons demain.", "Nos enfants viendront demain."],
  ["frenchSubjectVerbAgreement", "Les ouvriers fait du bruit.", "Les ouvriers font du bruit."],
  ["frenchHomophones", "Les chèvres on du foin.", "Les chèvres ont du foin."],
  ["frenchHomophones", "Paul et Léa on gagné.", "Paul et Léa ont gagné."],
  ["frenchHomophones", "Beaucoup d'élèves on réussi.", "Beaucoup d'élèves ont réussi."],
  ["frenchHomophones", "Celles-ci on 20 ans.", "Celles-ci ont 20 ans."],
  ["frenchHomophones", "Elles non jamais menti.", "Elles n'ont jamais menti."],
  ["frenchHomophones", "Ces mots non pas de sens.", "Ces mots n'ont pas de sens."],
  [
    "frenchHomophones",
    "Elles se sentent enfin surs d'elles.",
    "Elles se sentent enfin sûrs d'elles.",
  ],
  ["frenchHomophones", "Êtes-vous vraiment sures ?", "Êtes-vous vraiment sûres ?"],
  ["frenchHomophones", "Ce pont n'est pas sur.", "Ce pont n'est pas sûr."],
  ["frenchSubjectVerbAgreement", "Ils ne dix jamais rien.", "Ils ne disent jamais rien."],
  [
    "frenchSubjectVerbAgreement",
    "La ville dans laquelle tu vie est belle.",
    "La ville dans laquelle tu vis est belle.",
  ],
  ["frenchSubjectVerbAgreement", "Tu me test encore ?", "Tu me testes encore ?"],
  [
    "frenchSubjectVerbAgreement",
    "C'est un ami qui travail beaucoup.",
    "C'est un ami qui travaille beaucoup.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "La tâche est plus dure que vous ne l'imaginer.",
    "La tâche est plus dure que vous ne l'imaginez.",
  ],
  ["frenchSubjectVerbAgreement", "Je ne mangé pas.", "Je ne mange pas."],
  ["frenchHyphenation", "Mon co pilote dort.", "Mon copilote dort."],
  ["frenchVerbForms", "Il a quand même terminer.", "Il a quand même terminé."],
  ["frenchVerbForms", "Elle a peu à peu oublier.", "Elle a peu à peu oublié."],
  ["frenchVerbForms", "Il espère être arriver à temps.", "Il espère être arrivé à temps."],
  [
    "frenchHomophones",
    "Ce baigner dans la mer est agréable.",
    "Se baigner dans la mer est agréable.",
  ],
  ["frenchHomophones", "Ce virus ce propage vite.", "Ce virus se propage vite."],
  ["frenchHomophones", "C'est fleurs sont fanées.", "Ces fleurs sont fanées."],
  [
    "frenchHomophones",
    "Elle est contente de c'être reposée.",
    "Elle est contente de s'être reposée.",
  ],
  ["frenchHyphenation", "Un éco système fragile.", "Un écosystème fragile."],
  ["frenchHyphenation", "Quelle co incidence !", "Quelle coïncidence !"],
  ["frenchHyphenation", "Un traitement anti âge.", "Un traitement anti-âge."],
  ["frenchHyphenation", "Les accords anglo irlandais.", "Les accords anglo-irlandais."],
  ["frenchHyphenation", "Une arme semi automatique.", "Une arme semi-automatique."],
  ["frenchSubjectVerbAgreement", "Nous ne sorts jamais.", "Nous ne sortons jamais."],
  ["frenchHomophones", "Ce sont des gens qui son gentils.", "Ce sont des gens qui sont gentils."],
  ["frenchHomophones", "C'est sur il viendra.", "C'est sûr il viendra."],
  ["frenchHomophones", "Tu peux bien sur partir.", "Tu peux bien sûr partir."],
  ["frenchHomophones", "C'est un sur moyen de gagner.", "C'est un sûr moyen de gagner."],
] as Array<[CatalogRuleId, string, string]>)("%s fixes %p", (ruleId, text, fixed) => {
  const [finding, ...rest] = findings(ruleId, text);
  expect(rest).toEqual([]);
  expect(applyEdits(text, finding.alternatives[0].edits)).toBe(fixed);
});

test.each(["Elles son arrivées hier.", "Les filles son arrivé hier.", "Ils son contents."])(
  "only the homophone check reads %p, whose son is sont",
  (text) => {
    for (const ruleId of [
      "frenchNounNumber",
      "frenchNounGender",
      "frenchSubjectVerbAgreement",
    ] as CatalogRuleId[])
      expect(findings(ruleId, text)).toEqual([]);
    expect(findings("frenchHomophones", text)).toHaveLength(1);
  },
);
