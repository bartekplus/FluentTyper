// French style advice (opt-in stylePhrasing): calques of English with a native French form,
// criticized phrasings and pleonasms. Also a few fixed phrases that are plain errors.
import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { frameMatches, isLang, SPACE, WORD_END } from "../phraseTemplates";
import { finding } from "../finding";
import { isInflectedNoun, isVerbHomograph, nounGender, verbReadings } from "./frenchLexicon";
import {
  capitalizedName,
  CLITICS,
  ownedFrenchWords,
  SENTENCE_START,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

/** "a|b", or "x [a|b] y" for "x a y|x b y". */
const forms = (text: string) => {
  const group = /\[(.*)\]/.exec(text);
  if (!group) return text.split("|");
  const [before, after] = [text.slice(0, group.index), text.slice(group.index + group[0].length)];
  return group[1].split("|").map((part) => before + part + after);
};

/**
 * One row per line: "typed|typed2 = fix|fix2" (or with a "[a|b]" group). Each typed form takes
 * the fix at its position (or the last one); "; " separates choices the writer picks from.
 */
const table = (text: string): PhraseRow[] =>
  text
    .trim()
    .split(/\n+/)
    .flatMap((line) => {
      const [typed, fixed] = line.split(" = ");
      const fixes = forms(fixed);
      return forms(typed).map((form, i): PhraseRow => {
        const choices = (fixes[i] ?? fixes.at(-1)!).split("; ");
        return [form, choices.length > 1 ? choices : choices[0]];
      });
    });

/** Plain errors in fixed phrases (default-on, with the other French phrase rows). */
export const PHRASES = table(`
sans [dessus dessous|dessus-dessous] = sens dessus dessous
tant pire = tant pis
plus pire = pire
peut importe = peu importe
par acquis de conscience = par acquit de conscience
[tenir|tient|tenu] pour acquit = [tenir|tient|tenu] pour acquis
coq en patte = coq en pâte
à pied levé = au pied levé
pire-aller|pire aller = pis-aller
maigre comme une échalote = maigre comme un échalas
rubis sur l'onde = rubis sur l'ongle
à brasse-corps|à brasse corps = à bras-le-corps
à pleine dent = à pleines dents
[rabattre|rabat|rabattent|rabattu] les oreilles = [rebattre|rebat|rebattent|rebattu] les oreilles
[chiffre|chiffres] d'affaire = [chiffre|chiffres] d'affaires
[carnet|carnets] de chèque = [carnet|carnets] de chèques
[débit|débits] de boisson = [débit|débits] de boissons
en terme de = en termes de
en générale = en général
au même temps = en même temps
pas sans ignorer = pas sans savoir
contredites = contredisez
assis-toi = assieds-toi
assisez-vous = asseyez-vous
soi-disamment = soi-disant
[serais|serait|serions|seriez|seraient] gré = [saurais|saurait|saurions|sauriez|sauraient] gré
en bonne et [dû|du] forme = en bonne et due forme
à toute fin utile = à toutes fins utiles
dans le cas échéant = le cas échéant
[aux|à mes|à tes|à ses|à nos|à vos|à leurs] dépends = [aux|à mes|à tes|à ses|à nos|à vos|à leurs] dépens
[l'a|l'ai|l'as|l'avons|l'avez|l'ont] échappée belle = [l'a|l'ai|l'as|l'avons|l'avez|l'ont] échappé belle
[mis à|mise à|mettre à|mis sur|mettre sur] pieds = [mis à|mise à|mettre à|mis sur|mettre sur] pied
de pieds [fermes|en cap] = de pied [ferme|en cap]
rue passagère|rues passagères|avenue passagère|boulevard passager|artère passagère = rue passante|rues passantes|avenue passante|boulevard passant|artère passante
[prendre|prend|pris] à parti = [prendre|prend|pris] à partie
[prendre|prend|pris|prennent] partie pour = [prendre|prend|pris|prennent] parti pour
[tirer|tire|tiré|tirent] partie de = [tirer|tire|tiré|tirent] parti de
[faisaient|fera] parti de = [faisaient|fera] partie de
`);

// Calques of English, mostly from business and daily life in Quebec French: each has a form
// French dictionaries give. Words that are also correct in France or Belgium are left out.
const CALQUES = `
compte à payer|comptes à payer|compte payable|comptes payables = compte fournisseur|comptes fournisseurs|compte fournisseur|comptes fournisseurs
compte à recevoir|comptes à recevoir|compte recevable|comptes recevables = compte client|comptes clients|compte client|comptes clients
[compte|comptes] de banque = compte bancaire|comptes bancaires
[compte|comptes] d'électricité = [facture|factures] d'électricité
[compte|comptes] de téléphone = [facture|factures] de téléphone
[carte|cartes] d'affaires = [carte|cartes] de visite
heures d'affaires = heures d'ouverture
[place|places] d'affaires = établissement|établissements
communauté [des affaires|d'affaires] = milieu des affaires
bureau-chef|bureau chef = siège social
bureau des directeurs = conseil d'administration
directeur exécutif|directeurs exécutifs|directrice exécutive|directrices exécutives = directeur général|directeurs généraux|directrice générale|directrices générales
assistant-directeur|assistant directeur|assistante-directrice|assistante directrice = directeur adjoint|directeur adjoint|directrice adjointe|directrice adjointe
assistant-gérant|assistant gérant = gérant adjoint
erreur cléricale|erreurs cléricales = [erreur|erreurs] d'écriture
travail clérical = travail de bureau
personnel clérical = personnel de bureau
comité aviseur|comités aviseurs = comité consultatif|comités consultatifs
aviseur légal|aviseurs légaux|conseiller légal|conseillers légaux|conseillère légale = conseiller juridique|conseillers juridiques|conseiller juridique|conseillers juridiques|conseillère juridique
aviseur technique|aviseurs techniques = conseiller technique|conseillers techniques
[service|département] légal = service juridique
poursuite légale|poursuites légales = poursuite judiciaire|poursuites judiciaires
bris de contrat = rupture de contrat
règlement hors cour = règlement à l'amiable
mépris de cour = outrage au tribunal
[plan|plans] de pension = [régime|régimes] de retraite
[plan|plans] d'assurance = [régime|régimes] d'assurance
assurance-groupe|assurance de groupe = assurance collective
fonds [mutuel|mutuels] = fonds [commun|communs] de placement
[retour|retours] d'impôt = [remboursement|remboursements] d'impôt
rapport d'impôt|rapport d'impôts|rapports d'impôt = [déclaration|déclaration|déclarations] de revenus
[payeur|payeurs] de taxes = contribuable|contribuables
[chèque|chèques] sans fonds = [chèque|chèques] sans provision
livret de chèques = carnet de chèques
paiement préautorisé|paiements préautorisés = prélèvement automatique|prélèvements automatiques
prix de liste = prix catalogue
prix [coupé|coupés] = prix [réduit|réduits]
prix régulier = prix habituel
prix d'admission = prix d'entrée
admission gratuite = entrée gratuite
pas d'admission = entrée interdite
charge additionnelle|charges additionnelles = supplément|suppléments
dépenses de voyage = frais de déplacement
[vente|ventes] de garage = vide-grenier|vide-greniers
[vente|ventes] de trottoir = braderie|braderies
centre d'achats|centre d'achat|centres d'achats = centre commercial|centre commercial|centres commerciaux
[magasin|magasins] à rayons = grand magasin|grands magasins
coupon-rabais|coupon rabais|coupons-rabais|coupons rabais = [bon|bon|bons|bons] de réduction
certificat-cadeau|certificat cadeau|certificats-cadeaux|certificats cadeaux = chèque-cadeau|chèque-cadeau|chèques-cadeaux|chèques-cadeaux
bénéfices marginaux = avantages sociaux
[conférence|conférences] de nouvelles = [conférence|conférences] de presse
annonces classées = petites annonces
[carte|cartes] d'identification = [carte|cartes] d'identité
statut civil = état civil
code régional = indicatif régional
[ligne|lignes] d'attente = [file|files] d'attente
appel conférence|appel-conférence|appels conférences = conférence téléphonique|conférence téléphonique|conférences téléphoniques
courrier enregistré|lettre enregistrée|lettres enregistrées = courrier recommandé|lettre recommandée|lettres recommandées
boîte téléphonique|boîtes téléphoniques = cabine téléphonique|cabines téléphoniques
[boîte|boîtes] de scrutin = urne|urnes
pause commerciale|pauses commerciales = pause publicitaire|pauses publicitaires
contracteur|contracteurs|sous-contracteur|sous-contracteurs = entrepreneur|entrepreneurs|sous-traitant|sous-traitants
conseil de ville = conseil municipal
[chambre|chambres] de bains = [salle|salles] de bains
chambre des maîtres = chambre principale
chambre des joueurs = vestiaire
[cuillère|cuiller|cuillères] à table = [cuillère|cuillère|cuillères] à soupe
pâte à dents = dentifrice
papier sablé|papier-sablé = papier de verre
patate sucrée|patates sucrées = patate douce|patates douces
liqueur douce|liqueurs douces = boisson gazeuse|boissons gazeuses
pain [brun|de blé entier] = pain complet
[barre|barres] de savon = [pain|pains] de savon
huile à chauffage = mazout
huile de castor = huile de ricin
[boule|boules] à mites = [boule|boules] de naphtaline
drap contour|drap-contour|draps contours = drap-housse|drap-housse|draps-housses
porte patio|porte-patio|portes patio|portes-patio = porte-fenêtre|porte-fenêtre|portes-fenêtres|portes-fenêtres
tapis mur à mur = moquette
couvre-plancher|couvre plancher = revêtement de sol
chute à [déchets|déchet|linge] = vide-ordures|vide-ordures|vide-linge
boîte à malle = boîte aux lettres
[canne|cannes] de conserve = [boîte|boîtes] de conserve
coffre à gants = boîte à gants
frein à bras = frein à main
[cap|caps] de roue = enjoliveur|enjoliveurs
[câble|câbles] à booster = [câble|câbles] de démarrage
changement d'huile = vidange
bicyclette de montagne = vélo tout-terrain
parc d'amusement|parc d'amusements|parcs d'amusement = [parc|parc|parcs] d'attractions
service de valet = service de voiturier
[billet|billets] de saison = abonnement|abonnements
liste des vins = carte des vins
ami de garçon|amie de fille = petit ami|petite amie
fichier attaché|fichiers attachés|pièce attachée|pièces attachées = fichier joint|fichiers joints|pièce jointe|pièces jointes
ligne de montage|ligne d'assemblage|lignes de montage = [chaîne|chaîne|chaînes] de montage
livre de banque = livret de banque
chute en enfer = descente aux enfers
arche du pied = voûte plantaire
[budget|budgets|coûts|frais] d'opération = budget de fonctionnement|budgets de fonctionnement|coûts d'exploitation|frais d'exploitation
passé dû = en souffrance
partir à son compte = se mettre à son compte
formule d'application = formulaire de demande
allocation de départ|prime de séparation|paye de séparation|paie de séparation = indemnité de départ
[blanc|blancs] de mémoire = [trou|trous] de mémoire
chiffre de [jour|nuit|soir] = quart de [jour|nuit|soir]
débalancé|débalancée|débalancés|débalancées = déséquilibré|déséquilibrée|déséquilibrés|déséquilibrées
cuirette = similicuir
pare-chocs à pare-chocs = pare-chocs contre pare-chocs
point d'ordre = rappel au règlement
serviette sanitaire|serviettes sanitaires = serviette hygiénique|serviettes hygiéniques
ronde de [négociations|négociation] = cycle de négociations
immeuble à revenus|immeuble à revenu|immeubles à revenus = [immeuble|immeuble|immeubles] de rapport
bloc-appartements|bloc appartements = immeuble d'habitation
jobine|jobines = petit boulot|petits boulots
champion défendant = tenant du titre
acte de Dieu = cas de force majeure
boîte à fleurs = jardinière
bol de toilette = cuvette
lettre de références = lettre de recommandation
salle de montre = salle d'exposition
agent d'immeuble|agents d'immeubles = agent immobilier|agents immobiliers
mise en nomination = mise en candidature
nominé|nominée|nominés|nominées = sélectionné|sélectionnée|sélectionnés|sélectionnées
[la raison|les raisons] pourquoi = la raison pour laquelle|les raisons pour lesquelles
comment [as-tu|avez-vous] aimé = [as-tu|avez-vous] aimé
même à ça = même ainsi
pour dire le moins = c'est le moins qu'on puisse dire
pour votre information = pour information; à titre d'information
pour aussi peu que = pour seulement
au montant de = d'un montant de
[pour|sous] aucune considération = sous aucun prétexte
sans préjudice à = sans préjudice de
au meilleur de mes connaissances = à ma connaissance
au meilleur de ma mémoire = autant que je m'en souvienne
au meilleur de mon jugement = autant que je puisse en juger
à venir à date = jusqu'à présent
tomber en amour|tombé en amour|tombée en amour = tomber amoureux; tomber amoureuse|tombé amoureux|tombée amoureuse
suis en amour|est en amour|sont en amour = suis amoureux; suis amoureuse|est amoureux; est amoureuse|sont amoureux; sont amoureuses
[faire|fais|faites] sûr que = [s'assurer|assure-toi|assurez-vous] que
faire [un fou|une folle] de soi = se ridiculiser
mettre l'épaule à la roue = mettre la main à la pâte
jouer les seconds violons = jouer les seconds rôles
parler à travers son chapeau = parler à tort et à travers
laisser sortir le chat du sac = vendre la mèche
[mettre|met|mettent|mis] la clé dans la porte = [mettre|met|mettent|mis] la clé sous la porte
changement pour le [mieux|pire] = changement en [mieux|pire]
[changer|change|changent|changé] pour le mieux = [changer|change|changent|changé] en mieux
[changer|change|changé] pour le pire = [changer|change|changé] en pire
[porter|porte|portent|porté] fruit = [porter|porte|portent|porté] ses fruits
[casser|casse|cassé] égal = [rentrer|rentre|rentré] dans ses frais
avoir le meilleur sur = l'emporter sur
bonne main d'applaudissements = salve d'applaudissements
[payer|paie|paye|paient|payé] une visite = [rendre|rend|rend|rendent|rendu] visite
[prendre|prend|prennent|prenons|prenez] action = agir|agit|agissent|agissons|agissez
[faire|font] application = postuler|postulent
[appeler|appelle|appellent|appelé] une réunion = [convoquer|convoque|convoquent|convoqué] une réunion
[appeler|appelé] une assemblée = [convoquer|convoqué] une assemblée
[retourner|retourne|retournez|retourné] l'appel = rappeler|rappelle|rappelez|rappelé
[retourner|retourne|retourné] un appel = rappeler|rappelle|rappelé
[siéger|siège|siégé] sur le comité = [siéger|siège|siégé] au comité
[siéger|siège] sur un comité = [siéger|siège] à un comité
[siéger|siège] sur le conseil = [siéger|siège] au conseil
[assumer|assume|assumons|assumez|assument|assumé] que = [supposer|suppose|supposons|supposez|supposent|supposé] que
insister que|insiste que|insistent que|insisté que = insister pour que; insister sur le fait que|insiste pour que; insiste sur le fait que|insistent pour que; insistent sur le fait que|insisté pour que; insisté sur le fait que
[capitaliser|capitalise|capitalisent|capitalisé] sur = [tirer|tire|tirent|tiré] parti de
[mettre|met|mettent|mis] le focus sur = [mettre|met|mettent|mis] l'accent sur
[faire|fait] un focus sur = [faire|fait] le point sur
[développer|développé] un goût pour = [prendre|pris] goût à
[frapper|frappé] un nœud = [tomber|tombé] sur un os
[forger une|forgé une|forgé sa] signature = [contrefaire une|contrefait une|contrefait sa] signature
[accrocher|accroche|accrochent|accroché|accrochée|accrochés|accrochées] sur le mur = [accrocher|accroche|accrochent|accroché|accrochée|accrochés|accrochées] au mur
[accrocher|accroché|accrochés|accrochées] sur les murs = [accrocher|accroché|accrochés|accrochées] aux murs
[mettre|mis|mise] sous arrêt = [mettre|mis|mise] en état d'arrestation
[partir|part] le bal = [ouvrir|ouvre] le bal
[imputable|imputables] de = [responsable|responsables] de
[confiant|confiante|confiants|confiantes] que = [convaincu|convaincue|convaincus|convaincues] que
process = processus
[transformation|stratégie|communication|économie|ère] digitale = [transformation|stratégie|communication|économie|ère] numérique
marketing digital|monde digital|outils digitaux|le digital = marketing numérique|monde numérique|outils numériques|le numérique

congé férié|congés fériés = jour férié|jours fériés
[gagner|gagné] son point = [avoir|eu] gain de cause
[prendre|prend|pris] la part de = [prendre|prend|pris] le parti de
[déduction|déductions] à la source = [retenue|retenues] à la source
déductions sur le salaire = retenues sur le salaire
émission [d'un passeport|du passeport|des passeports|d'un diplôme|du diplôme] = délivrance [d'un passeport|du passeport|des passeports|d'un diplôme|du diplôme]
image corporative = image de marque
droit corporatif = droit des sociétés
nom corporatif|noms corporatifs = raison sociale|raisons sociales
citoyen corporatif|entreprise citoyenne corporative = entreprise citoyenne
chiffres conservateurs|estimation conservatrice = chiffres prudents|estimation prudente
comité conjoint|comités conjoints = comité mixte|comités mixtes
[clinique|cliniques] de sang = [collecte|collectes] de sang
clause [grand-père|orphelin] = clause de [droits acquis|disparité]
coupures [budgétaires|de postes] = compressions budgétaires|suppressions de postes
course sous harnais = course attelée
enveloppe retour|enveloppe-retour|enveloppes-retour = enveloppe-réponse|enveloppe-réponse|enveloppes-réponse
exécutif syndical = bureau syndical
clé maîtresse|clé-maîtresse = passe-partout
année de calendrier = année civile
[boîte|caisse|boîtes] de son = enceinte acoustique|enceinte acoustique|enceintes acoustiques
ajusteur [d'assurances|d'assurance] = expert en sinistres
[reçu|reçus] d'impôt = reçu fiscal|reçus fiscaux
club santé|club-santé = salle de sport
maison semi-détachée|maisons semi-détachées = maison jumelée|maisons jumelées
assistant-cuisinier|assistant cuisinier = aide-cuisinier
ballon météo|ballon-météo = ballon-sonde
[offrir|offre|toutes] mes sympathies = [offrir|offre|toutes] mes condoléances
termes faciles = facilités de paiement
en avant de [son|leur] temps = en avance sur [son|leur] temps
[changer|changé] un chèque = [encaisser|encaissé] un chèque
[arrêter|arrêté] un chèque = [faire|fait] opposition à un chèque
boîte des témoins = barre des témoins
remplir une ordonnance|remplir une prescription|rempli une ordonnance = [exécuter|exécuter|exécuté] une ordonnance
remplir [un|le] poste = pourvoir [un|le] poste
[aller|va|vont] en grève = [faire|fait|font] grève
[aller|va|vont] en appel = [faire|fait|font] appel
[aller|va] en ondes = [passer|passe] à l'antenne
[aller|va|vont] en prolongation = [jouer|joue|jouent] les prolongations
se tirer dans le pied|se tirer dans les pieds|s'est tiré dans le pied = [se tirer|se tirer|s'est tiré] une balle dans le pied
[appel|appels] sans frais = appel gratuit|appels gratuits
tranquilliseur|tranquilliseurs = tranquillisant|tranquillisants
couvre-siège|couvre siège|couvre-sièges = [housse|housse|housses] de siège
bureau d'échange = bureau de change
adresse de retour = adresse de l'expéditeur
mandatoire|mandatoires = obligatoire|obligatoires
assurance-feu|assurance feu = assurance incendie
preuve circonstancielle|preuves circonstancielles = preuve indirecte|preuves indirectes
trappage = piégeage
journalisme jaune = presse à sensation
tordage de bras = pressions
cours [privé|privés] = cours [particulier|particuliers]
cuir patent = cuir verni
centre-jardin|centre jardin = jardinerie
tour d'eau = château d'eau
pâte de [tomate|tomates] = concentré de [tomate|tomates]
secrétaire privée = secrétaire particulière
[compagnie|compagnies] de finance = [société|sociétés] de crédit
[ligne|lignes] de piquetage = [piquet|piquets] de grève
[ensemble|meuble|meubles] de patio = [salon|meuble|meubles] de jardin
voteur|voteurs = électeur|électeurs
au meilleur de [ses|nos|leurs] capacités = de [son|notre|leur] mieux
avocat de litige = avocat plaidant
employé régulier|employés réguliers = employé permanent|employés permanents
séance régulière = séance ordinaire
essence régulière = essence ordinaire
prix par unité = prix unitaire
directeur créatif|directrice créative = [directeur|directrice] de création
passé date = périmé
[partir en|parti en|partir dans les] affaires = [se lancer en|lancé en|se lancer dans les] affaires
[appliquer|applique|appliqué] sur un emploi = [postuler|postule|postulé] à un emploi
appels conférence = conférences téléphoniques
ça regarde [mal|bien] = ça s'annonce [mal|bien]
pince-grip|pince grip = pince-étau
le chat est sorti du sac = la mèche est vendue
payeur de taxe = contribuable
[être|est|sont] en affaires = [être|est|sont] dans les affaires
[être|suis|est|sont] dans le trouble = [avoir|ai|a|ont] des ennuis
être en amour = être amoureux; être amoureuse
bonne main d'applaudissement = salve d'applaudissements
taxe de bienvenue = droits de mutation
champ de spécialisation = domaine de spécialisation
bain tourbillon|bain-tourbillon = bain à remous
technicalité|technicalités = détail technique|détails techniques
fausse représentation|fausses représentations = déclaration mensongère|déclarations mensongères
[aliment|aliments] de santé = aliment naturel|aliments naturels
est en charge du|est en charge des|sont en charge du|sont en charge des = est chargé du|est chargé des|sont chargés du|sont chargés des
été en charge [de|du|des] = été chargé [de|du|des]
[laissez-le-moi|laisse-le-moi] savoir = [faites-le-moi|fais-le-moi] savoir
[étais|était|étions] sous l'impression = [avais|avait|avions] l'impression
[tenir|tenu] à date = [tenir|tenu] à jour
prendre ça personnel = le prendre personnellement
[remercie|remercier|remercions] à tous = [remercie|remercier|remercions] tous
pareil comme = comme
avérée vraie|avérés vrais|avérées vraies = avérée exacte|avérés exacts|avérées exactes
c'est de [ma|ta|sa|notre|votre|leur] faute = c'est [ma|ta|sa|notre|votre|leur] faute
pas de [ma|ta|sa|notre|votre|leur|la] faute = pas [ma|ta|sa|notre|votre|leur|la] faute
[il fait|elle fait|cela fait|ceci fait|faisait|font|faire|fera|ferait] sens = [il a|elle a|cela a|ceci a|avait|ont|avoir|aura|aurait] du sens
est de [ma|ta|sa|notre|votre|leur] faute = est [ma|ta|sa|notre|votre|leur] faute
[as-tu|avez-vous] de la température = as-tu de la fièvre|avez-vous de la fièvre`;

// English words used in French where French has a word of its own.
const ANGLICISMS = `
bullying = harcèlement
branding = stratégie de marque
malware|malwares = logiciel malveillant|logiciels malveillants
freeware|freewares = logiciel gratuit|logiciels gratuits
shareware|sharewares = partagiciel|partagiciels
adware|adwares = logiciel publicitaire|logiciels publicitaires
phishing = hameçonnage
serial [killer|killers] = [tueur|tueurs] en série
standing ovation = ovation debout
junk food = malbouffe
junk mail = courrier indésirable
checkpoint|checkpoints|check-point = [point|points|point] de contrôle
per capita = par habitant
stakeholder|stakeholders = partie prenante|parties prenantes
partnership = partenariat
engineering = ingénierie
encryption = chiffrement
shortcut|shortcuts = raccourci|raccourcis
cruise control = régulateur de vitesse
painkiller|painkillers = analgésique|analgésiques
zucchini = courgette
pet shop = animalerie
tomboy = garçon manqué
lifeguard|lifeguards = maître-nageur|maîtres-nageurs
overbooking = surréservation
team = équipe
cute = mignon
momentum = élan
stamina = endurance
too bad = dommage
hit-and-run = délit de fuite
red tape = paperasserie
blind date = rendez-vous arrangé
flashlight = lampe de poche
bouncer|bouncers = videur|videurs
speed bump = ralentisseur
wishful thinking = vœu pieux
free-for-all = mêlée générale
chainsaw = tronçonneuse
crowbar = pied-de-biche
plywood = contreplaqué
wiper|wipers = essuie-glace|essuie-glaces
zipper = fermeture éclair
locker|lockers = casier|casiers
intercom = interphone
napkin|napkins = [serviette|serviettes] de table
potluck = repas-partage
wetsuit = combinaison de plongée
minivan = monospace
jellyfish = méduse
coconut = noix de coco
eggnog = lait de poule
follow up = suivi
per diem = indemnité journalière
traveller's cheque|traveler's cheque|traveller's cheques = [chèque|chèque|chèques] de voyage
hit and run = délit de fuite
short cut = raccourci
junkfood = malbouffe
masking tape = ruban-cache
muffler|mufflers = silencieux|silencieux
breaker|breakers = disjoncteur|disjoncteurs
corduroy = velours côtelé
cashew|cashews = noix de cajou|noix de cajou
bellboy|bellboys = chasseur|chasseurs
photoradar|photoradars = radar photographique|radars photographiques
entrepreneurship = entrepreneuriat
foreman = contremaître
drop-out|dropout|drop-outs = décrocheur|décrocheur|décrocheurs
`;

// Criticized phrasings: a form French usage guides prefer.
const TURNS = `
de sorte à ce [que|qu'] = de sorte [que|qu']
loin s'en faut = tant s'en faut; loin de là
s'en [suivit|suivirent|suit|suivent] = s'ensuivit|s'ensuivirent|s'ensuit|s'ensuivent
de mal en pire = de mal en pis
de temps à autres = de temps à autre
pareil que = pareil à
moins pire = moins mauvais; moins grave
aussi pire = aussi mauvais; aussi grave
la madame = la dame
[lire|lu|lis|lit] sur le journal = [lire|lu|lis|lit] dans le journal
conforme avec|conformes avec|en conformité à = conforme à|conformes à|en conformité avec
autre alternative|autres alternatives = autre possibilité; autre solution|autres possibilités; autres solutions
deux alternatives|plusieurs alternatives = deux possibilités; deux solutions|plusieurs possibilités; plusieurs solutions
[avoir|ai|as|a] de la température = [avoir|ai|as|a] de la fièvre
comme [dans|en] l'an 40 = comme de l'an 40
levée de rideau = lever de rideau
`;

// Pleonasms: the second part says what the first already says.
const PLEONASMS = `
tunnel souterrain|tunnels souterrains = tunnel|tunnels
[bourrasque|bourrasques] de vent = bourrasque|bourrasques
perspectives d'avenir = perspectives
dessiner un dessin = faire un dessin
dire oralement = dire
[piétiner|piétine|piétinent] sur place = piétiner|piétine|piétinent
[projections|prévisions] futures = projections|prévisions
[période|périodes] de temps = période|périodes
riche milliardaire|riches milliardaires = milliardaire|milliardaires
à un certain moment donné = à un moment donné
[progresser|progresse] en avant = progresser|progresse
[additionner|mélanger|mélange] ensemble = additionner|mélanger|mélange
nouvelle innovation|nouvelles innovations = innovation|innovations
[extrait tiré|extraits tirés] de = [extrait|extraits] de
bail de location = bail
défrayer les frais = défrayer
[donner|donne|donnent|donné] gratuitement = donner|donne|donnent|donné
se [lever|lève] debout = se [lever|lève]
solidaires les uns des autres = solidaires
dernier ultimatum = ultimatum
fondements de base = fondements
rénover à neuf = rénover
[s'enchevêtrer|s'enchevêtrent] les uns dans les autres = s'enchevêtrer|s'enchevêtrent
contraint malgré lui|contrainte malgré elle|contraints malgré eux|contraintes malgré elles|contraindre malgré soi = contraint|contrainte|contraints|contraintes|contraindre
[levé|levée|levés|levées] debout = levé|levée|levés|levées
`;

export const STYLE = table(CALQUES + ANGLICISMS + TURNS + PLEONASMS);

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
const VERB_WORD = /(?<![\p{L}\p{M}\p{N}_-])\p{L}[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_-])/gu;

// "un bon dix minutes": the English word order; French puts "bon" after the number.
const NUMBER_WORDS = new Set(
  "deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante cinquante soixante cent et".split(
    " ",
  ),
);
const FEMININE_UNITS = new Set("minutes heures secondes semaines journées années".split(" "));
const GOOD_NUMBER = `(?<target>un${SPACE}bon${SPACE}(?<count>\\p{L}+(?:-\\p{L}+)*|\\d+)${SPACE}(?<unit>minutes|heures|secondes|semaines|journées|années|jours|mois|ans))${WORD_END}`;

function goodNumber(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, GOOD_NUMBER)) {
    const { count, unit } = m.groups!;
    if (
      !/^\d+$/.test(count) &&
      !count
        .toLowerCase()
        .split("-")
        .every((w) => NUMBER_WORDS.has(w))
    )
      continue;
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
    if (found) findings.push({ ...found, range: { start, end } });
  }
  return findings;
}

// "41 MB": French writes bytes as octets.
const BYTE_UNITS: Record<string, string> = { KB: "ko", kB: "ko", MB: "Mo", GB: "Go", TB: "To" };
const BYTES = /(?<=\d[  ]?)(?<target>[KkMGT]B)(?![\p{L}\p{N}_])/dgu;

function byteUnits(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BYTES)) {
    const unit = BYTE_UNITS[m[0]];
    if (unit) findings.push(finding(RULE, MESSAGE, m.index, m.index + m[0].length, [unit]));
  }
  return findings;
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
const SPOKEN_Y =
  /(?:(?<=(?<!\p{L})[qQ]u['’])|(?<![\p{L}\p{M}\p{N}_'’-]))[yY](?=[ \t]+(?:en[ \t]+)?a(?![\p{L}\p{M}\p{N}_'’-]))/gu;

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
const OWNER_AFTER =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<det>le|la|les|l['’])[ \t]*(?<noun>\p{L}+)[ \t]+à[ \t]+(?<who>moi|toi|lui|elle|nous|vous|eux|elles)(?![\p{L}\p{M}\p{N}_'’])/giu;

const RAPPELER =
  /(?<![\p{L}\p{M}\p{N}_-])rappel(?:le|les|lent|ons|ez|ais|ait|aient|é|ée|és|ées|er)(?![\p{L}\p{M}\p{N}_-])/giu;

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

function frenchStyle(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  load();
  const findings: RawFinding[] = [...goodNumber(ctx), ...byteUnits(ctx)];
  const add = (found: RawFinding | null) => found && findings.push(found);
  for (const m of ownedFrenchWords(ctx, VERB_WORD)) {
    const word = m[0].toLowerCase();
    if (typedForms!.has(word)) add(verbCalque(ctx, m));
    else if (word === "au" || word === "aux" || word === "à") add(goToTrade(ctx, m));
    else if (word === "auprès") add(addressedTo(ctx, m));
    else if (word === "pour") add(thanksFor(ctx, m));
    else if (word === "final") add(inTheEnd(ctx, m));
    else if (word === "haut") add(upHigh(ctx, m));
  }
  for (const m of ownedFrenchWords(ctx, RAPPELER)) add(rememberOf(ctx, m));
  for (const m of ownedFrenchWords(ctx, SPOKEN_Y)) add(spokenYa(ctx, m));
  for (const m of ownedFrenchWords(ctx, OWNER_AFTER)) add(ownerAfterNoun(ctx, m));
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: frenchStyle }];
