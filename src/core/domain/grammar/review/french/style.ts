// French style advice (opt-in stylePhrasing): calques of English with a native French form,
// criticized phrasings and pleonasms. Also a few fixed phrases that are plain errors.
import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { frameMatches, isLang, SPACE, WORD_END } from "../phraseTemplates";
import { finding } from "../finding";
import { isVerbHomograph, verbReadings } from "./frenchLexicon";
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

/**
 * One row per line: "typed|typed2 = fix|fix2". Each typed form takes the fix at its position
 * (or the last one); "; " separates choices the writer picks from.
 */
const table = (text: string): PhraseRow[] =>
  text
    .trim()
    .split(/\n+/)
    .flatMap((line) => {
      const [typed, fixed] = line.split(" = ");
      const fixes = fixed.split("|");
      return typed.split("|").map((form, i): PhraseRow => {
        const choices = (fixes[i] ?? fixes.at(-1)!).split("; ");
        return [form, choices.length > 1 ? choices : choices[0]];
      });
    });

/** Plain errors in fixed phrases (default-on, with the other French phrase rows). */
export const PHRASES = table(`
sans dessus dessous|sans dessus-dessous = sens dessus dessous
tant pire = tant pis
plus pire = pire
peut importe = peu importe
par acquis de conscience = par acquit de conscience
tenir pour acquit|tient pour acquit|tenu pour acquit = tenir pour acquis|tient pour acquis|tenu pour acquis
coq en patte = coq en pâte
à pied levé = au pied levé
pire-aller|pire aller = pis-aller
maigre comme une échalote = maigre comme un échalas
rubis sur l'onde = rubis sur l'ongle
à brasse-corps|à brasse corps = à bras-le-corps
à pleine dent = à pleines dents
rabattre les oreilles|rabat les oreilles|rabattent les oreilles|rabattu les oreilles = rebattre les oreilles|rebat les oreilles|rebattent les oreilles|rebattu les oreilles
chiffre d'affaire|chiffres d'affaire = chiffre d'affaires|chiffres d'affaires
carnet de chèque|carnets de chèque = carnet de chèques|carnets de chèques
débit de boisson|débits de boisson = débit de boissons|débits de boissons
en terme de = en termes de
en générale = en général
au même temps = en même temps
pas sans ignorer = pas sans savoir
contredites = contredisez
assis-toi = assieds-toi
assisez-vous = asseyez-vous
soi-disamment = soi-disant
serais gré|serait gré|serions gré|seriez gré|seraient gré = saurais gré|saurait gré|saurions gré|sauriez gré|sauraient gré
en bonne et dû forme|en bonne et du forme = en bonne et due forme
à toute fin utile = à toutes fins utiles
dans le cas échéant = le cas échéant
aux dépends|à mes dépends|à tes dépends|à ses dépends|à nos dépends|à vos dépends|à leurs dépends = aux dépens|à mes dépens|à tes dépens|à ses dépens|à nos dépens|à vos dépens|à leurs dépens
l'a échappée belle|l'ai échappée belle|l'as échappée belle|l'avons échappée belle|l'avez échappée belle|l'ont échappée belle = l'a échappé belle|l'ai échappé belle|l'as échappé belle|l'avons échappé belle|l'avez échappé belle|l'ont échappé belle
mis à pieds|mise à pieds|mettre à pieds|mis sur pieds|mettre sur pieds = mis à pied|mise à pied|mettre à pied|mis sur pied|mettre sur pied
de pieds fermes|de pieds en cap = de pied ferme|de pied en cap
rue passagère|rues passagères|avenue passagère|boulevard passager|artère passagère = rue passante|rues passantes|avenue passante|boulevard passant|artère passante
prendre à parti|prend à parti|pris à parti = prendre à partie|prend à partie|pris à partie
prendre partie pour|prend partie pour|pris partie pour|prennent partie pour = prendre parti pour|prend parti pour|pris parti pour|prennent parti pour
tirer partie de|tire partie de|tiré partie de|tirent partie de = tirer parti de|tire parti de|tiré parti de|tirent parti de
faisaient parti de|fera parti de = faisaient partie de|fera partie de
`);

// Calques of English, mostly from business and daily life in Quebec French: each has a form
// French dictionaries give. Words that are also correct in France or Belgium are left out.
const CALQUES = `
compte à payer|comptes à payer|compte payable|comptes payables = compte fournisseur|comptes fournisseurs|compte fournisseur|comptes fournisseurs
compte à recevoir|comptes à recevoir|compte recevable|comptes recevables = compte client|comptes clients|compte client|comptes clients
compte de banque|comptes de banque = compte bancaire|comptes bancaires
compte d'électricité|comptes d'électricité = facture d'électricité|factures d'électricité
compte de téléphone|comptes de téléphone = facture de téléphone|factures de téléphone
carte d'affaires|cartes d'affaires = carte de visite|cartes de visite
heures d'affaires = heures d'ouverture
place d'affaires|places d'affaires = établissement|établissements
communauté des affaires|communauté d'affaires = milieu des affaires
bureau-chef|bureau chef = siège social
bureau des directeurs = conseil d'administration
directeur exécutif|directeurs exécutifs|directrice exécutive|directrices exécutives = directeur général|directeurs généraux|directrice générale|directrices générales
assistant-directeur|assistant directeur|assistante-directrice|assistante directrice = directeur adjoint|directeur adjoint|directrice adjointe|directrice adjointe
assistant-gérant|assistant gérant = gérant adjoint
erreur cléricale|erreurs cléricales = erreur d'écriture|erreurs d'écriture
travail clérical = travail de bureau
personnel clérical = personnel de bureau
comité aviseur|comités aviseurs = comité consultatif|comités consultatifs
aviseur légal|aviseurs légaux|conseiller légal|conseillers légaux|conseillère légale = conseiller juridique|conseillers juridiques|conseiller juridique|conseillers juridiques|conseillère juridique
aviseur technique|aviseurs techniques = conseiller technique|conseillers techniques
service légal|département légal = service juridique
poursuite légale|poursuites légales = poursuite judiciaire|poursuites judiciaires
bris de contrat = rupture de contrat
règlement hors cour = règlement à l'amiable
mépris de cour = outrage au tribunal
plan de pension|plans de pension = régime de retraite|régimes de retraite
plan d'assurance|plans d'assurance = régime d'assurance|régimes d'assurance
assurance-groupe|assurance de groupe = assurance collective
fonds mutuel|fonds mutuels = fonds commun de placement|fonds communs de placement
retour d'impôt|retours d'impôt = remboursement d'impôt|remboursements d'impôt
rapport d'impôt|rapport d'impôts|rapports d'impôt = déclaration de revenus|déclaration de revenus|déclarations de revenus
payeur de taxes|payeurs de taxes = contribuable|contribuables
chèque sans fonds|chèques sans fonds = chèque sans provision|chèques sans provision
livret de chèques = carnet de chèques
paiement préautorisé|paiements préautorisés = prélèvement automatique|prélèvements automatiques
prix de liste = prix catalogue
prix coupé|prix coupés = prix réduit|prix réduits
prix régulier = prix habituel
prix d'admission = prix d'entrée
admission gratuite = entrée gratuite
pas d'admission = entrée interdite
charge additionnelle|charges additionnelles = supplément|suppléments
dépenses de voyage = frais de déplacement
vente de garage|ventes de garage = vide-grenier|vide-greniers
vente de trottoir|ventes de trottoir = braderie|braderies
centre d'achats|centre d'achat|centres d'achats = centre commercial|centre commercial|centres commerciaux
magasin à rayons|magasins à rayons = grand magasin|grands magasins
coupon-rabais|coupon rabais|coupons-rabais|coupons rabais = bon de réduction|bon de réduction|bons de réduction|bons de réduction
certificat-cadeau|certificat cadeau|certificats-cadeaux|certificats cadeaux = chèque-cadeau|chèque-cadeau|chèques-cadeaux|chèques-cadeaux
bénéfices marginaux = avantages sociaux
conférence de nouvelles|conférences de nouvelles = conférence de presse|conférences de presse
annonces classées = petites annonces
carte d'identification|cartes d'identification = carte d'identité|cartes d'identité
statut civil = état civil
code régional = indicatif régional
ligne d'attente|lignes d'attente = file d'attente|files d'attente
appel conférence|appel-conférence|appels conférences = conférence téléphonique|conférence téléphonique|conférences téléphoniques
courrier enregistré|lettre enregistrée|lettres enregistrées = courrier recommandé|lettre recommandée|lettres recommandées
boîte téléphonique|boîtes téléphoniques = cabine téléphonique|cabines téléphoniques
boîte de scrutin|boîtes de scrutin = urne|urnes
pause commerciale|pauses commerciales = pause publicitaire|pauses publicitaires
contracteur|contracteurs|sous-contracteur|sous-contracteurs = entrepreneur|entrepreneurs|sous-traitant|sous-traitants
conseil de ville = conseil municipal
chambre de bains|chambres de bains = salle de bains|salles de bains
chambre des maîtres = chambre principale
chambre des joueurs = vestiaire
cuillère à table|cuiller à table|cuillères à table = cuillère à soupe|cuillère à soupe|cuillères à soupe
pâte à dents = dentifrice
papier sablé|papier-sablé = papier de verre
patate sucrée|patates sucrées = patate douce|patates douces
liqueur douce|liqueurs douces = boisson gazeuse|boissons gazeuses
pain brun|pain de blé entier = pain complet
barre de savon|barres de savon = pain de savon|pains de savon
huile à chauffage = mazout
huile de castor = huile de ricin
boule à mites|boules à mites = boule de naphtaline|boules de naphtaline
drap contour|drap-contour|draps contours = drap-housse|drap-housse|draps-housses
porte patio|porte-patio|portes patio|portes-patio = porte-fenêtre|porte-fenêtre|portes-fenêtres|portes-fenêtres
tapis mur à mur = moquette
couvre-plancher|couvre plancher = revêtement de sol
chute à déchets|chute à déchet|chute à linge = vide-ordures|vide-ordures|vide-linge
boîte à malle = boîte aux lettres
canne de conserve|cannes de conserve = boîte de conserve|boîtes de conserve
coffre à gants = boîte à gants
frein à bras = frein à main
cap de roue|caps de roue = enjoliveur|enjoliveurs
câble à booster|câbles à booster = câble de démarrage|câbles de démarrage
changement d'huile = vidange
bicyclette de montagne = vélo tout-terrain
parc d'amusement|parc d'amusements|parcs d'amusement = parc d'attractions|parc d'attractions|parcs d'attractions
service de valet = service de voiturier
billet de saison|billets de saison = abonnement|abonnements
liste des vins = carte des vins
ami de garçon|amie de fille = petit ami|petite amie
fichier attaché|fichiers attachés|pièce attachée|pièces attachées = fichier joint|fichiers joints|pièce jointe|pièces jointes
ligne de montage|ligne d'assemblage|lignes de montage = chaîne de montage|chaîne de montage|chaînes de montage
livre de banque = livret de banque
chute en enfer = descente aux enfers
arche du pied = voûte plantaire
budget d'opération|budgets d'opération|coûts d'opération|frais d'opération = budget de fonctionnement|budgets de fonctionnement|coûts d'exploitation|frais d'exploitation
passé dû = en souffrance
partir à son compte = se mettre à son compte
formule d'application = formulaire de demande
allocation de départ|prime de séparation|paye de séparation|paie de séparation = indemnité de départ
blanc de mémoire|blancs de mémoire = trou de mémoire|trous de mémoire
chiffre de jour|chiffre de nuit|chiffre de soir = quart de jour|quart de nuit|quart de soir
débalancé|débalancée|débalancés|débalancées = déséquilibré|déséquilibrée|déséquilibrés|déséquilibrées
cuirette = similicuir
pare-chocs à pare-chocs = pare-chocs contre pare-chocs
point d'ordre = rappel au règlement
serviette sanitaire|serviettes sanitaires = serviette hygiénique|serviettes hygiéniques
ronde de négociations|ronde de négociation = cycle de négociations
immeuble à revenus|immeuble à revenu|immeubles à revenus = immeuble de rapport|immeuble de rapport|immeubles de rapport
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
la raison pourquoi|les raisons pourquoi = la raison pour laquelle|les raisons pour lesquelles
comment as-tu aimé|comment avez-vous aimé = as-tu aimé|avez-vous aimé
même à ça = même ainsi
pour dire le moins = c'est le moins qu'on puisse dire
pour votre information = pour information; à titre d'information
pour aussi peu que = pour seulement
au montant de = d'un montant de
pour aucune considération|sous aucune considération = sous aucun prétexte
sans préjudice à = sans préjudice de
au meilleur de mes connaissances = à ma connaissance
au meilleur de ma mémoire = autant que je m'en souvienne
au meilleur de mon jugement = autant que je puisse en juger
à venir à date = jusqu'à présent
tomber en amour|tombé en amour|tombée en amour = tomber amoureux; tomber amoureuse|tombé amoureux|tombée amoureuse
suis en amour|est en amour|sont en amour = suis amoureux; suis amoureuse|est amoureux; est amoureuse|sont amoureux; sont amoureuses
faire sûr que|fais sûr que|faites sûr que = s'assurer que|assure-toi que|assurez-vous que
faire un fou de soi|faire une folle de soi = se ridiculiser
mettre l'épaule à la roue = mettre la main à la pâte
jouer les seconds violons = jouer les seconds rôles
parler à travers son chapeau = parler à tort et à travers
laisser sortir le chat du sac = vendre la mèche
mettre la clé dans la porte|met la clé dans la porte|mettent la clé dans la porte|mis la clé dans la porte = mettre la clé sous la porte|met la clé sous la porte|mettent la clé sous la porte|mis la clé sous la porte
changement pour le mieux|changement pour le pire = changement en mieux|changement en pire
changer pour le mieux|change pour le mieux|changent pour le mieux|changé pour le mieux = changer en mieux|change en mieux|changent en mieux|changé en mieux
changer pour le pire|change pour le pire|changé pour le pire = changer en pire|change en pire|changé en pire
porter fruit|porte fruit|portent fruit|porté fruit = porter ses fruits|porte ses fruits|portent ses fruits|porté ses fruits
casser égal|casse égal|cassé égal = rentrer dans ses frais|rentre dans ses frais|rentré dans ses frais
avoir le meilleur sur = l'emporter sur
bonne main d'applaudissements = salve d'applaudissements
payer une visite|paie une visite|paye une visite|paient une visite|payé une visite = rendre visite|rend visite|rend visite|rendent visite|rendu visite
prendre action|prend action|prennent action|prenons action|prenez action = agir|agit|agissent|agissons|agissez
faire application|font application = postuler|postulent
appeler une réunion|appelle une réunion|appellent une réunion|appelé une réunion = convoquer une réunion|convoque une réunion|convoquent une réunion|convoqué une réunion
appeler une assemblée|appelé une assemblée = convoquer une assemblée|convoqué une assemblée
retourner l'appel|retourne l'appel|retournez l'appel|retourné l'appel = rappeler|rappelle|rappelez|rappelé
retourner un appel|retourne un appel|retourné un appel = rappeler|rappelle|rappelé
siéger sur le comité|siège sur le comité|siégé sur le comité = siéger au comité|siège au comité|siégé au comité
siéger sur un comité|siège sur un comité = siéger à un comité|siège à un comité
siéger sur le conseil|siège sur le conseil = siéger au conseil|siège au conseil
assumer que|assume que|assumons que|assumez que|assument que|assumé que = supposer que|suppose que|supposons que|supposez que|supposent que|supposé que
insister que|insiste que|insistent que|insisté que = insister pour que; insister sur le fait que|insiste pour que; insiste sur le fait que|insistent pour que; insistent sur le fait que|insisté pour que; insisté sur le fait que
capitaliser sur|capitalise sur|capitalisent sur|capitalisé sur = tirer parti de|tire parti de|tirent parti de|tiré parti de
mettre le focus sur|met le focus sur|mettent le focus sur|mis le focus sur = mettre l'accent sur|met l'accent sur|mettent l'accent sur|mis l'accent sur
faire un focus sur|fait un focus sur = faire le point sur|fait le point sur
développer un goût pour|développé un goût pour = prendre goût à|pris goût à
frapper un nœud|frappé un nœud = tomber sur un os|tombé sur un os
forger une signature|forgé une signature|forgé sa signature = contrefaire une signature|contrefait une signature|contrefait sa signature
accrocher sur le mur|accroche sur le mur|accrochent sur le mur|accroché sur le mur|accrochée sur le mur|accrochés sur le mur|accrochées sur le mur = accrocher au mur|accroche au mur|accrochent au mur|accroché au mur|accrochée au mur|accrochés au mur|accrochées au mur
accrocher sur les murs|accroché sur les murs|accrochés sur les murs|accrochées sur les murs = accrocher aux murs|accroché aux murs|accrochés aux murs|accrochées aux murs
mettre sous arrêt|mis sous arrêt|mise sous arrêt = mettre en état d'arrestation|mis en état d'arrestation|mise en état d'arrestation
partir le bal|part le bal = ouvrir le bal|ouvre le bal
imputable de|imputables de = responsable de|responsables de
confiant que|confiante que|confiants que|confiantes que = convaincu que|convaincue que|convaincus que|convaincues que
process = processus
transformation digitale|stratégie digitale|communication digitale|économie digitale|ère digitale = transformation numérique|stratégie numérique|communication numérique|économie numérique|ère numérique
marketing digital|monde digital|outils digitaux|le digital = marketing numérique|monde numérique|outils numériques|le numérique

congé férié|congés fériés = jour férié|jours fériés
gagner son point|gagné son point = avoir gain de cause|eu gain de cause
prendre la part de|prend la part de|pris la part de = prendre le parti de|prend le parti de|pris le parti de
déduction à la source|déductions à la source = retenue à la source|retenues à la source
déductions sur le salaire = retenues sur le salaire
émission d'un passeport|émission du passeport|émission des passeports|émission d'un diplôme|émission du diplôme = délivrance d'un passeport|délivrance du passeport|délivrance des passeports|délivrance d'un diplôme|délivrance du diplôme
image corporative = image de marque
droit corporatif = droit des sociétés
nom corporatif|noms corporatifs = raison sociale|raisons sociales
citoyen corporatif|entreprise citoyenne corporative = entreprise citoyenne
chiffres conservateurs|estimation conservatrice = chiffres prudents|estimation prudente
comité conjoint|comités conjoints = comité mixte|comités mixtes
clinique de sang|cliniques de sang = collecte de sang|collectes de sang
clause grand-père|clause orphelin = clause de droits acquis|clause de disparité
coupures budgétaires|coupures de postes = compressions budgétaires|suppressions de postes
course sous harnais = course attelée
enveloppe retour|enveloppe-retour|enveloppes-retour = enveloppe-réponse|enveloppe-réponse|enveloppes-réponse
exécutif syndical = bureau syndical
clé maîtresse|clé-maîtresse = passe-partout
année de calendrier = année civile
boîte de son|caisse de son|boîtes de son = enceinte acoustique|enceinte acoustique|enceintes acoustiques
ajusteur d'assurances|ajusteur d'assurance = expert en sinistres
reçu d'impôt|reçus d'impôt = reçu fiscal|reçus fiscaux
club santé|club-santé = salle de sport
maison semi-détachée|maisons semi-détachées = maison jumelée|maisons jumelées
assistant-cuisinier|assistant cuisinier = aide-cuisinier
ballon météo|ballon-météo = ballon-sonde
offrir mes sympathies|offre mes sympathies|toutes mes sympathies = offrir mes condoléances|offre mes condoléances|toutes mes condoléances
termes faciles = facilités de paiement
en avant de son temps|en avant de leur temps = en avance sur son temps|en avance sur leur temps
changer un chèque|changé un chèque = encaisser un chèque|encaissé un chèque
arrêter un chèque|arrêté un chèque = faire opposition à un chèque|fait opposition à un chèque
boîte des témoins = barre des témoins
remplir une ordonnance|remplir une prescription|rempli une ordonnance = exécuter une ordonnance|exécuter une ordonnance|exécuté une ordonnance
remplir un poste|remplir le poste = pourvoir un poste|pourvoir le poste
aller en grève|va en grève|vont en grève = faire grève|fait grève|font grève
aller en appel|va en appel|vont en appel = faire appel|fait appel|font appel
aller en ondes|va en ondes = passer à l'antenne|passe à l'antenne
aller en prolongation|va en prolongation|vont en prolongation = jouer les prolongations|joue les prolongations|jouent les prolongations
se tirer dans le pied|se tirer dans les pieds|s'est tiré dans le pied = se tirer une balle dans le pied|se tirer une balle dans le pied|s'est tiré une balle dans le pied
appel sans frais|appels sans frais = appel gratuit|appels gratuits
tranquilliseur|tranquilliseurs = tranquillisant|tranquillisants
couvre-siège|couvre siège|couvre-sièges = housse de siège|housse de siège|housses de siège
bureau d'échange = bureau de change
adresse de retour = adresse de l'expéditeur
mandatoire|mandatoires = obligatoire|obligatoires
assurance-feu|assurance feu = assurance incendie
preuve circonstancielle|preuves circonstancielles = preuve indirecte|preuves indirectes
trappage = piégeage
journalisme jaune = presse à sensation
tordage de bras = pressions
cours privé|cours privés = cours particulier|cours particuliers
cuir patent = cuir verni
centre-jardin|centre jardin = jardinerie
tour d'eau = château d'eau
pâte de tomate|pâte de tomates = concentré de tomate|concentré de tomates
secrétaire privée = secrétaire particulière
compagnie de finance|compagnies de finance = société de crédit|sociétés de crédit
ligne de piquetage|lignes de piquetage = piquet de grève|piquets de grève
ensemble de patio|meuble de patio|meubles de patio = salon de jardin|meuble de jardin|meubles de jardin
voteur|voteurs = électeur|électeurs
au meilleur de ses capacités|au meilleur de nos capacités|au meilleur de leurs capacités = de son mieux|de notre mieux|de leur mieux
avocat de litige = avocat plaidant
employé régulier|employés réguliers = employé permanent|employés permanents
séance régulière = séance ordinaire
essence régulière = essence ordinaire
prix par unité = prix unitaire
directeur créatif|directrice créative = directeur de création|directrice de création
passé date = périmé
partir en affaires|parti en affaires|partir dans les affaires = se lancer en affaires|lancé en affaires|se lancer dans les affaires
appliquer sur un emploi|applique sur un emploi|appliqué sur un emploi = postuler à un emploi|postule à un emploi|postulé à un emploi
appels conférence = conférences téléphoniques
ça regarde mal|ça regarde bien = ça s'annonce mal|ça s'annonce bien
pince-grip|pince grip = pince-étau
le chat est sorti du sac = la mèche est vendue
payeur de taxe = contribuable
être en affaires|est en affaires|sont en affaires = être dans les affaires|est dans les affaires|sont dans les affaires
être dans le trouble|suis dans le trouble|est dans le trouble|sont dans le trouble = avoir des ennuis|ai des ennuis|a des ennuis|ont des ennuis
être en amour = être amoureux; être amoureuse
bonne main d'applaudissement = salve d'applaudissements
taxe de bienvenue = droits de mutation
champ de spécialisation = domaine de spécialisation
bain tourbillon|bain-tourbillon = bain à remous
technicalité|technicalités = détail technique|détails techniques
fausse représentation|fausses représentations = déclaration mensongère|déclarations mensongères
aliment de santé|aliments de santé = aliment naturel|aliments naturels
est en charge du|est en charge des|sont en charge du|sont en charge des = est chargé du|est chargé des|sont chargés du|sont chargés des
été en charge de|été en charge du|été en charge des = été chargé de|été chargé du|été chargé des
laissez-le-moi savoir|laisse-le-moi savoir = faites-le-moi savoir|fais-le-moi savoir
étais sous l'impression|était sous l'impression|étions sous l'impression = avais l'impression|avait l'impression|avions l'impression
tenir à date|tenu à date = tenir à jour|tenu à jour
prendre ça personnel = le prendre personnellement
remercie à tous|remercier à tous|remercions à tous = remercie tous|remercier tous|remercions tous
pareil comme = comme
avérée vraie|avérés vrais|avérées vraies = avérée exacte|avérés exacts|avérées exactes
c'est de ma faute|c'est de ta faute|c'est de sa faute|c'est de notre faute|c'est de votre faute|c'est de leur faute = c'est ma faute|c'est ta faute|c'est sa faute|c'est notre faute|c'est votre faute|c'est leur faute
pas de ma faute|pas de ta faute|pas de sa faute|pas de notre faute|pas de votre faute|pas de leur faute|pas de la faute = pas ma faute|pas ta faute|pas sa faute|pas notre faute|pas votre faute|pas leur faute|pas la faute`;

// English words used in French where French has a word of its own.
const ANGLICISMS = `
bullying = harcèlement
branding = stratégie de marque
malware|malwares = logiciel malveillant|logiciels malveillants
freeware|freewares = logiciel gratuit|logiciels gratuits
shareware|sharewares = partagiciel|partagiciels
adware|adwares = logiciel publicitaire|logiciels publicitaires
phishing = hameçonnage
serial killer|serial killers = tueur en série|tueurs en série
standing ovation = ovation debout
junk food = malbouffe
junk mail = courrier indésirable
checkpoint|checkpoints|check-point = point de contrôle|points de contrôle|point de contrôle
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
napkin|napkins = serviette de table|serviettes de table
potluck = repas-partage
wetsuit = combinaison de plongée
minivan = monospace
jellyfish = méduse
coconut = noix de coco
eggnog = lait de poule
`;

// Criticized phrasings: a form French usage guides prefer.
const TURNS = `
de sorte à ce que|de sorte à ce qu' = de sorte que|de sorte qu'
loin s'en faut = tant s'en faut; loin de là
s'en suivit|s'en suivirent|s'en suit|s'en suivent = s'ensuivit|s'ensuivirent|s'ensuit|s'ensuivent
de mal en pire = de mal en pis
de temps à autres = de temps à autre
pareil que = pareil à
moins pire = moins mauvais; moins grave
aussi pire = aussi mauvais; aussi grave
la madame = la dame
lire sur le journal|lu sur le journal|lis sur le journal|lit sur le journal = lire dans le journal|lu dans le journal|lis dans le journal|lit dans le journal
conforme avec|conformes avec|en conformité à = conforme à|conformes à|en conformité avec
autre alternative|autres alternatives = autre possibilité; autre solution|autres possibilités; autres solutions
deux alternatives|plusieurs alternatives = deux possibilités; deux solutions|plusieurs possibilités; plusieurs solutions
avoir de la température|ai de la température|as de la température|a de la température = avoir de la fièvre|ai de la fièvre|as de la fièvre|a de la fièvre
comme dans l'an 40|comme en l'an 40 = comme de l'an 40
levée de rideau = lever de rideau
`;

// Pleonasms: the second part says what the first already says.
const PLEONASMS = `
tunnel souterrain|tunnels souterrains = tunnel|tunnels
bourrasque de vent|bourrasques de vent = bourrasque|bourrasques
perspectives d'avenir = perspectives
dessiner un dessin = faire un dessin
dire oralement = dire
piétiner sur place|piétine sur place|piétinent sur place = piétiner|piétine|piétinent
projections futures|prévisions futures = projections|prévisions
période de temps|périodes de temps = période|périodes
riche milliardaire|riches milliardaires = milliardaire|milliardaires
à un certain moment donné = à un moment donné
progresser en avant|progresse en avant = progresser|progresse
additionner ensemble|mélanger ensemble|mélange ensemble = additionner|mélanger|mélange
nouvelle innovation|nouvelles innovations = innovation|innovations
extrait tiré de|extraits tirés de = extrait de|extraits de
bail de location = bail
défrayer les frais = défrayer
donner gratuitement|donne gratuitement|donnent gratuitement|donné gratuitement = donner|donne|donnent|donné
se lever debout|se lève debout = se lever|se lève
solidaires les uns des autres = solidaires
dernier ultimatum = ultimatum
fondements de base = fondements
rénover à neuf = rénover
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
  }
  for (const m of ownedFrenchWords(ctx, RAPPELER)) add(rememberOf(ctx, m));
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: frenchStyle }];
