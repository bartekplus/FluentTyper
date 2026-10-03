import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildSpanishLexicon,
  SPANISH_LEXICON_SOURCES,
} from "../../scripts/generate-spanish-lexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  finiteVerb,
  genderedForm,
  isGenderedEntry,
  isNoun,
  subjunctiveLike,
} from "../../src/core/domain/grammar/review/spanish/lexicon";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const SPANISH_RULES: CatalogRuleId[] = [
  "spanishAccents",
  "spanishConfusions",
  "spanishTypography",
  "spanishAgreement",
];
const SPANISH_ON = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) =>
    runsInReviewLanguage(id, "es_ES") &&
    !["capitalizeSentenceStart", "capitalizeAfterLineBreak", "styleLongSentence"].includes(id),
);

function findings(ruleId: CatalogRuleId, text: string, userDictionary: string[] = []) {
  return detectReviewDiagnostics(
    { id: "es", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang: "es_ES", userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, string, Fixture]> = [
  [
    "spanishAccents",
    "esta/está, estas/estás, este/esté",
    {
      pos: [
        ["Mi hermano esta en casa.", "Mi hermano está en casa."],
        ["La sopa esta muy caliente.", "La sopa está muy caliente."],
        ["El perro esta durmiendo.", "El perro está durmiendo."],
        ["¿Dónde esta el baño?", "¿Dónde está el baño?"],
        ["Ella esta cansada de esperar.", "Ella está cansada de esperar."],
        ["Esta claro que miente.", "Está claro que miente."],
        ["Creo que no se lo esta tomando en serio.", "Creo que no se lo está tomando en serio."],
        ["La puerta esta abierta.", "La puerta está abierta."],
        ["¿Ya estas listo?", "¿Ya estás listo?"],
        ["Si estas cansado, descansa.", "Si estás cansado, descansa."],
        ["¿Cómo estas?", "¿Cómo estás?"],
        ["Avísame cuando este listo.", "Avísame cuando esté listo."],
        ["Ojalá que este bien.", "Ojalá que esté bien."],
        ["Quiero que este en casa a las diez.", "Quiero que esté en casa a las diez."],
        ["Vivo con está chica desde hace un año.", "Vivo con esta chica desde hace un año."],
        ["Para está ocasión me pondré traje.", "Para esta ocasión me pondré traje."],
        ["Está misma tarde te llamo.", "Esta misma tarde te llamo."],
        ["Mi abuela no vino, esta resfriada.", "Mi abuela no vino, está resfriada."],
        ["Esta sentada en el sofá.", "Está sentada en el sofá."],
        ["Esta cada vez más delgada.", "Está cada vez más delgada."],
        ["Esta encantada con el regalo.", "Está encantada con el regalo."],
      ],
      neg: [
        "Esta subida de precios preocupa a todos.",
        "Ya que esta depende de ti, decide tú.",
        "Aunque esta fuera la última vez, iría.",
        "¿Dónde has puesto esta carta?",
        "Esta mañana llovió mucho.",
        "Me gusta esta camisa.",
        "De todas, esta es la mejor.",
        "Combina esta falda con la chaqueta.",
        "Esta llamada duró una hora.",
        "Esta preciosa casa es de mi tía.",
        "Aunque esta en concreto no me gusta.",
        "Estas a su vez se dividen en dos.",
        "Creo que este cambio llega tarde.",
        "Lo que este informe refleja es grave.",
        "Una casa como esta no se encuentra.",
        "Según está escrito, nadie puede entrar.",
        "La moto esta no arranca.",
        "Ella está cansada.",
      ],
    },
  ],
  [
    "spanishAccents",
    "question words and stressed monosyllables",
    {
      pos: [
        ["¿Donde vives ahora?", "¿Dónde vives ahora?"],
        ["¿Como se llama tu perro?", "¿Cómo se llama tu perro?"],
        ["¿Por que no viniste?", "¿Por qué no viniste?"],
        ["¿Que estás haciendo?", "¿Qué estás haciendo?"],
        ["¿Que te pasa?", "¿Qué te pasa?"],
        ["¡Que bonito día!", "¡Qué bonito día!"],
        ["No sé que decir.", "No sé qué decir."],
        ["¿Sabes que hora es?", "¿Sabes qué hora es?"],
        ["Este regalo es para mi.", "Este regalo es para mí."],
        ["A mi me encanta el cine.", "A mí me encanta el cine."],
        ["Tu tienes la culpa.", "Tú tienes la culpa."],
        ["Tu no lo sabías.", "Tú no lo sabías."],
        ["Mañana iré con el.", "Mañana iré con él."],
        ["El se fue temprano.", "Él se fue temprano."],
        ["Ya lo se.", "Ya lo sé."],
        ["No se si vendrá.", "No sé si vendrá."],
        ["Quiero que le de las gracias.", "Quiero que le dé las gracias."],
        ["Me tomo un te cada tarde.", "Me tomo un té cada tarde."],
        ["Le pregunté y dijo que si.", "Le pregunté y dijo que sí."],
        ["Aun no ha llegado nadie.", "Aún no ha llegado nadie."],
        ["Ni aún así lo consiguió.", "Ni aun así lo consiguió."],
        ["Es lo mas importante.", "Es lo más importante."],
        ["Viene tú padre a buscarte.", "Viene tu padre a buscarte."],
      ],
      neg: [
        "¡Que te vaya bien!",
        "¡Que aproveche!",
        "¿A que no sabes quién ha venido?",
        "¿Que has visto un fantasma?",
        "¿Que te odian tus vecinos?",
        "¿Que nos adora?",
        "¿Que estás temblando?",
        "¿Que no están durmiendo?",
        "Sé que tienes razón.",
        "Sé que bajar música sin pagar está mal.",
        "Si, por ejemplo, llueve, nos quedamos.",
        "Para mi madre, la familia es lo primero.",
        "Lo hizo en mi contra.",
        "Tu hermano y mi prima se conocen.",
        "Él dice que el tren llega tarde.",
        "El que llegue primero gana.",
        "No se lo digas a nadie.",
        "Tomaré un té con limón.",
        "Ni aun así lo consiguió.",
        "Mas no por ello se rindió.",
        "¿Y tú qué opinas?",
        "Le dio el sí delante de todos.",
      ],
    },
  ],
  [
    "spanishAccents",
    "verb forms against their accented twins",
    {
      pos: [
        ["Apunta el numero de teléfono.", "Apunta el número de teléfono."],
        ["Lo leí en la pagina web.", "Lo leí en la página web."],
        ["Por ultimo, gracias a todos.", "Por último, gracias a todos."],
        ["Fue muy explicito con nosotros.", "Fue muy explícito con nosotros."],
        ["Tengo dos practicas esta semana.", "Tengo dos prácticas esta semana."],
        ["La empresa se creo en 1990.", "La empresa se creó en 1990."],
        ["Ella hablo con el director.", "Ella habló con el director."],
        ["Yo no sabia nada.", "Yo no sabía nada."],
        ["Se hacia tarde.", "Se hacía tarde."],
        ["El problema no continua.", "El problema no continúa."],
        ["Se amplia el plazo.", "Se amplía el plazo."],
        ["Ya veras qué bien.", "Ya verás qué bien."],
      ],
      neg: [
        "Practico yoga todos los martes.",
        "Este opera desde el domingo.",
        "La termino mañana sin falta.",
        "Con ella hablo todos los días.",
        "¿Tiene usted cambio?",
        "Ella, creo, no lo sabe.",
        "Miró hacia abajo con miedo.",
        "Se lio con los papeles.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "homophones in fixed frames",
    {
      pos: [
        ["Nos vimos el ano pasado en Sevilla.", "Nos vimos el año pasado en Sevilla."],
        ["Viajo a Roma dos veces al ano.", "Viajo a Roma dos veces al año."],
        ["La música de los anos ochenta.", "La música de los años ochenta."],
        ["Ya lo he echo todo.", "Ya lo he hecho todo."],
        ["Le hecho sal a la sopa.", "Le echo sal a la sopa."],
        ["No hay podido venir.", "No ha podido venir."],
        ["¿Ya haz terminado?", "¿Ya has terminado?"],
        ["Espero que no halla llegado tarde.", "Espero que no haya llegado tarde."],
        ["El museo se haya en el centro.", "El museo se halla en el centro."],
        ["Estaba apunto de salir.", "Estaba a punto de salir."],
        ["Debería a ver estudiado más.", "Debería haber estudiado más."],
        ["Haber si nos vemos pronto.", "A ver si nos vemos pronto."],
        ["Cuando vallas a la tienda, compra pan.", "Cuando vayas a la tienda, compra pan."],
        ["Se reunieron entorno a la mesa.", "Se reunieron en torno a la mesa."],
        ["Vivo en una cuidad pequeña.", "Vivo en una ciudad pequeña."],
        ["Aún que llueva, iremos.", "Aunque llueva, iremos."],
        ["Necesito el menos dos horas.", "Necesito al menos dos horas."],
      ],
      neg: [
        "¿No la ves desde ahí?",
        "Te echo de menos.",
        "Las hechas a mano duran más.",
        "No hay pescado fresco.",
        "El pueblo se halla situado junto al río.",
        "No creo que se haya ido.",
        "Lo apunto en mi agenda.",
        "Su mérito fue haber llegado el primero.",
        "Espero que no se vuelva a ver afectado.",
        "El haz de luz atravesaba la niebla.",
        "La valla del jardín está rota.",
        "Vivimos en un entorno rural.",
        "Es más difícil aún que el anterior.",
        "Hace dos años que no lo veo.",
      ],
    },
  ],
  [
    "spanishTypography",
    "conjunctions, years, months, acronyms",
    {
      pos: [
        ["Padres y hijos llegaron juntos.", "Padres e hijos llegaron juntos."],
        ["Francia y Italia jugarán la final.", "Francia e Italia jugarán la final."],
        ["Siete o ocho personas esperaban.", "Siete u ocho personas esperaban."],
        ["Agua e hielo en el vaso.", "Agua y hielo en el vaso."],
        ["Mezcla sodio e iones de cloro.", "Mezcla sodio y iones de cloro."],
        ["Nació en el año 1.989.", "Nació en el año 1989."],
        ["Volvimos el 4 de Julio de 2020.", "Volvimos el 4 de julio de 2020."],
        ["Nos vemos el Lunes por la tarde.", "Nos vemos el lunes por la tarde."],
        ["Las ONGs trabajan sin descanso.", "Las ONG trabajan sin descanso."],
        ["Trajeron manzanas, peras, etc...", "Trajeron manzanas, peras, etc."],
        ["Nació el 31 de abril de 1990.", "Nació el 30 de abril de 1990."],
        ["La factura es del 31-11-2019.", "La factura es del 30-11-2019."],
        ["Fue el 29 de febrero de 2023.", "Fue el 28 de febrero de 2023."],
        ["Llegó el lunes, 7 de octubre de 2014.", "Llegó el martes, 7 de octubre de 2014."],
      ],
      neg: [
        "Hitler y Himmler firmaron la orden.",
        "Bailamos salsa y hip-hop.",
        "¿Y Isabel?",
        "La vocal u no suena aquí.",
        "Cuesta 2.000 euros al mes.",
        "El Viernes de Dolores no abren.",
        "Las ONG trabajan sin descanso.",
        "Mezcla en proporción 30/2 con agua.",
        "Nació el 29 de febrero de 2024.",
        "Abre del 16 al 31 de mayo.",
        "Llegó el martes, 7 de octubre de 2014.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "prefixes written apart",
    {
      pos: [
        ["Es una medida anti crisis.", "Es una medida anticrisis."],
        ["Habló el vice presidente.", "Habló el vicepresidente."],
        ["Es un movimiento anti racista.", "Es un movimiento antirracista."],
        ["Las ex-colonias británicas.", "Las excolonias británicas."],
        ["Trabaja en ciber seguridad.", "Trabaja en ciberseguridad."],
        ["Una reunión inter departamental.", "Una reunión interdepartamental."],
        ["Es la co autora del libro.", "Es la coautora del libro."],
        ["Estudia micro biología.", "Estudia microbiología."],
        ["Ocupa dos mega-bytes.", "Ocupa dos megabytes."],
        ["Compré un saca corchos nuevo.", "Compré un sacacorchos nuevo."],
        ["Los niños llevaban un pasa montañas.", "Los niños llevaban un pasamontañas."],
        ["Siempre mal gasta la paga.", "Siempre malgasta la paga."],
      ],
      neg: [
        "Al que mal vive, el miedo le sigue.",
        "Terminará mal para todos.",
        "Habló sobre protección de datos.",
        "El socio fundador firmó el acta.",
        "Le dio al guarda unas monedas.",
        "Vio un caza moderno en la base.",
        "Dio a su prima regalos.",
        "Padece beta-talasemia.",
        "Era el vice primer ministro del país.",
        "El ex presidente dio una rueda de prensa.",
        "Es una campaña anti-OTAN.",
        "Toca en re menor la segunda pieza.",
        "Quiero que me des algo de beber.",
        "Publiqué un post nuevo en el blog.",
        "La tele está encendida.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "verb forms after auxiliaries and de que",
    {
      pos: [
        ["La noticia ha sorprendida a todos.", "La noticia ha sorprendido a todos."],
        ["Todavía no se han realizando las obras.", "Todavía no se han realizado las obras."],
        ["Se han encontraron restos antiguos.", "Se han encontrado restos antiguos."],
        ["El precio ha ido aumentado cada año.", "El precio ha ido aumentando cada año."],
        ["Mi hermana a terminado la carrera.", "Mi hermana ha terminado la carrera."],
        ["Nunca e probado el sushi.", "Nunca he probado el sushi."],
        ["Lo ha vuelto ha intentar.", "Lo ha vuelto a intentar."],
        ["Se dio cuenta que era tarde.", "Se dio cuenta de que era tarde."],
        ["Nos alegramos que estés bien.", "Nos alegramos de que estés bien."],
        ["Estoy seguro que vendrá.", "Estoy seguro de que vendrá."],
        ["Pienso de que tienes razón.", "Pienso que tienes razón."],
        ["Es posible de que llueva.", "Es posible que llueva."],
        ["Han habido muchas quejas.", "Ha habido muchas quejas."],
        ["Dicen que habían habido dos heridos.", "Dicen que había habido dos heridos."],
      ],
      neg: [
        "Había llamadas perdidas en el móvil.",
        "Los socios han habido de pagar la multa.",
        "Espero que no haya malentendidos.",
        "Ha estado cerrado todo el verano.",
        "Está permitido aparcar aquí.",
        "Huele a quemado en la cocina.",
        "Pasó de acusador a acusado.",
        "Me alegra que hayas venido.",
        "Me alegro de que hayas venido.",
        "Seguro que mañana hace sol.",
        "No me acuerdo de qué dijo.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "determiner and noun, uno de, primer, cardinals",
    {
      pos: [
        ["Compré la camisas azules.", "Compré las camisas azules."],
        ["Guardé las taza en el armario.", "Guardé la taza en el armario."],
        ["Mis vecinos tienen un perros enormes.", "Mis vecinos tienen unos perros enormes."],
        ["Me prestó el bicicleta de su hermano.", "Me prestó la bicicleta de su hermano."],
        ["Pinté la techo de blanco.", "Pinté el techo de blanco."],
        ["En este casa hace frío.", "En esta casa hace frío."],
        ["Bajaron cajas del camiones.", "Bajaron cajas de los camiones."],
        ["Tengo miedo del canción.", "Tengo miedo de la canción."],
        ["Hablé con aquellos personas.", "Hablé con aquellas personas."],
        ["Llenó un vaso de este agua.", "Llenó un vaso de esta agua."],
        ["La problema es el precio.", "El problema es el precio."],
        ["Uno de las niñas lloraba.", "Una de las niñas lloraba."],
        ["Muchos de ellas no vinieron.", "Muchas de ellas no vinieron."],
        ["Es la primer vez que nado.", "Es la primera vez que nado."],
        ["Será el primero ministro en dimitir.", "Será el primer ministro en dimitir."],
        ["Adoptamos tres gato.", "Adoptamos tres gatos."],
      ],
      neg: [
        "El agua del pozo estaba helada.",
        "Un hacha vieja colgaba de la pared.",
        "Tú la cuentas mejor que yo.",
        "Este cuenta con el apoyo de todos.",
        "Estas son las fotos de la boda.",
        "Juan las casa a todas.",
        "La modelo y la testigo llegaron juntas.",
        "Ella es una de nosotros.",
        "Treinta y un años después, volvió.",
        "Los lunes cierro la tienda.",
        "El análisis de la crisis fue largo.",
        "Los bien pagados no siempre son felices.",
        "Unos frente a otros esperaban.",
        "Es demasiado pequeña para su edad.",
        "Lo hizo mano a mano con su socio.",
        "La versión dos punto cero sale mañana.",
        "El cura bendijo la cura.",
        "Hizo un macro análisis del mercado.",
        "Salimos de esta vivos de milagro.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "porque, porqué, por qué, por que",
    {
      pos: [
        ["Nadie entiende el porque.", "Nadie entiende el porqué."],
        ["Explícame el por qué de tu enfado.", "Explícame el porqué de tu enfado."],
        ["Conoce los por qués de la crisis.", "Conoce los porqués de la crisis."],
        ["¿Y porqué no llamaste?", "¿Y por qué no llamaste?"],
        ["No entiendo porqué lo dijo.", "No entiendo por qué lo dijo."],
        ["Dime porque te ríes.", "Dime por qué te ríes."],
        ["No hay porque asustarse.", "No hay por qué asustarse."],
        ["No tienes por que venir.", "No tienes por qué venir."],
        ["Nadie sabe por que se fue.", "Nadie sabe por qué se fue."],
        ["Ignoro por que razón lo hizo.", "Ignoro por qué razón lo hizo."],
      ],
      neg: [
        "Lo haré porque me apetece.",
        "¿Porque llegué tarde ya no me hablas?",
        "Se entendería porque era evidente.",
        "Votaron por que se repitiera la prueba.",
        "No tienes nada por que disculparte.",
        "Nadie conoce la razón del porqué no vino.",
        "Quiero saber el porqué.",
        "No tienes más razón porque grites.",
        "La causa por que luchamos es justa.",
        "Lo sé porque lo vi con mis ojos.",
      ],
    },
  ],
  [
    "spanishTypography",
    "comma after an opening connector and before the person greeted",
    {
      pos: [
        ["Sin embargo nadie protestó.", "Sin embargo, nadie protestó."],
        ["Además cobra menos que antes.", "Además, cobra menos que antes."],
        ["Hace frío, por tanto me quedo.", "Hace frío, por tanto, me quedo."],
        ["Por otra parte conviene esperar.", "Por otra parte, conviene esperar."],
        ["Es decir nadie lo sabía.", "Es decir, nadie lo sabía."],
        ["Hola Marta, ¿qué tal?", "Hola, Marta, ¿qué tal?"],
        ["¡Buenas noches vecinos!", "¡Buenas noches, vecinos!"],
      ],
      neg: [
        "Además de caro, es lento.",
        "Por tanto esfuerzo merece un premio.",
        "O sea que no vienes.",
        "Al contrario de lo que dicen, funciona.",
        "Por otro lado del puente pasa el tren.",
        "¡Hola a todos!",
        "Buenos días tenga usted.",
        "Gracias por tanto.",
        "Sin embargo, nadie protestó.",
      ],
    },
  ],
  [
    "spanishAccents",
    "preterite after a named or noun subject",
    {
      pos: [
        ["Marta llamo a su madre.", "Marta llamó a su madre."],
        ["El tren paro en la estación.", "El tren paró en la estación."],
        ["Pedro nunca contesto el correo.", "Pedro nunca contestó el correo."],
        ["Mi jefe pago la cena.", "Mi jefe pagó la cena."],
        ["Ana Belén canto en el teatro.", "Ana Belén cantó en el teatro."],
        ["Rosa contesto enseguida.", "Rosa contestó enseguida."],
        ["Pilar compro el pan.", "Pilar compró el pan."],
      ],
      neg: [
        "En Madrid trabajo mucho.",
        "El pan compro yo.",
        "Ahora limpio la cocina.",
        "El niño modelo saluda al público.",
        "Últimamente aprecio más el silencio.",
        "Luis, trabajo mañana.",
        "Rosa trabajo es lo que quiero.",
        "El precio medio de la vivienda subió.",
        "Un árbol repleto de frutas.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "subject and verb, gustar, plural copula and participle",
    {
      pos: [
        ["Los vecinos tiene un perro.", "Los vecinos tienen un perro."],
        ["Juan tienen dos gatos.", "Juan tiene dos gatos."],
        ["Dijo que Iker vienen mañana.", "Dijo que Iker viene mañana."],
        ["Marta Ruiz llegan hoy.", "Marta Ruiz llega hoy."],
        ["Ellas llega mañana.", "Ellas llegan mañana."],
        ["Mi hermano no se levantan temprano.", "Mi hermano no se levanta temprano."],
        ["Este pastel están riquísimo.", "Este pastel está riquísimo."],
        ["Las tiendas ha cerrado ya.", "Las tiendas han cerrado ya."],
        ["Nos encanta las películas de miedo.", "Nos encantan las películas de miedo."],
        ["Les preocupa los exámenes.", "Les preocupan los exámenes."],
        ["Estamos agotado después del viaje.", "Estamos agotados después del viaje."],
        ["La sala es estrecho.", "La sala es estrecha."],
        ["Mi abuela estaba muy cansado.", "Mi abuela estaba muy cansada."],
        ["Ellos son simpáticas.", "Ellos son simpáticos."],
        ["La carta fue escrito a mano.", "La carta fue escrita a mano."],
      ],
      neg: [
        "El problema son los precios.",
        "Su pasión han sido los viajes.",
        "Las manzanas las compra mi padre.",
        "Los domingos abre a las diez.",
        "La mayoría votaron en contra.",
        "Me gustan el cine y la música.",
        "No me gustan esa clase de bromas.",
        "Ellos hace años que no se ven.",
        "Las cosas parece que mejoran.",
        "Son resultado de mucho trabajo.",
        "No eran pecado.",
        "Mi amigo Eren es de Turquía.",
        "Quizás tienen razón.",
        "Ojalá vengan pronto.",
        "Creo que Juan y Ana vienen.",
        "Oye, vienen ya.",
        "Ella es médico en un hospital.",
        "Su profesión es abogado.",
        "La vida es puro teatro.",
        "La casa está justo enfrente.",
        "La sala estaba mal iluminada.",
      ],
    },
  ],
  [
    "spanishAccents",
    "hacia/hacía and seria/sería",
    {
      pos: [
        ["Hacia tres meses que no llovía.", "Hacía tres meses que no llovía."],
        ["Aquel invierno hacia frío.", "Aquel invierno hacía frío."],
        ["El pan lo hacia mi abuelo.", "El pan lo hacía mi abuelo."],
        ["Nadie sabía lo que hacia en casa.", "Nadie sabía lo que hacía en casa."],
        ["Este plan seria perfecto.", "Este plan sería perfecto."],
        ["Sin ti todo seria más triste.", "Sin ti todo sería más triste."],
        ["La propuesta seria aprobada mañana.", "La propuesta sería aprobada mañana."],
      ],
      neg: [
        "Caminamos hacia el río.",
        "Miró hacia atrás.",
        "Se construyó hacia 1900.",
        "Avanzan hacia más derechos.",
        "Una mujer seria.",
        "Es una persona seria la que necesitamos.",
        "Se puso seria de repente.",
        "Supone una seria amenaza.",
      ],
    },
  ],
  [
    "spanishAccents",
    "está before an article or coordinated participles, qué closing a clause, dé with its object",
    {
      pos: [
        [
          "Detrás del ayuntamiento esta la biblioteca.",
          "Detrás del ayuntamiento está la biblioteca.",
        ],
        ["¿Dónde esta ese libro?", "¿Dónde está ese libro?"],
        ["Mi prima esta casada y separada.", "Mi prima está casada y separada."],
        ["Vino tarde y esta agotada.", "Vino tarde y está agotada."],
        ["¡Qué lejos esta!", "¡Qué lejos está!"],
        ["El pueblo esta más allá del río.", "El pueblo está más allá del río."],
        ["¿Me lo cambias a cambio de que?", "¿Me lo cambias a cambio de qué?"],
        ["Al final no recuerdo que.", "Al final no recuerdo qué."],
        ["No sé que quieres de mí.", "No sé qué quieres de mí."],
        ["No sé que le pasa al coche.", "No sé qué le pasa al coche."],
        ["Ojalá que él de permiso para salir.", "Ojalá que él dé permiso para salir."],
        ["Espero que alguien de cuenta del error.", "Espero que alguien dé cuenta del error."],
        ["Pide que usted de su opinión.", "Pide que usted dé su opinión."],
        ["Los arboles daban sombra.", "Los árboles daban sombra."],
        ["Estudiamos las formulas.", "Estudiamos las fórmulas."],
        ["Vive en una zona critica.", "Vive en una zona crítica."],
        [
          "Necesitamos soluciones practicas y baratas.",
          "Necesitamos soluciones prácticas y baratas.",
        ],
      ],
      neg: [
        "Esta la compré en Roma.",
        "Esta los domingos no abre.",
        "Compré pan y esta revista.",
        "Pero esta la ganó él.",
        "¿Crees que no sé que me mientes?",
        "No sé que sea para tanto.",
        "Es más fácil de lo que parece.",
        "Lo que de verdad importa es la salud.",
        "Más que de cuenta, hablo de dinero.",
        "Dijo que ella de niña vivía en el campo.",
        "Espero que alguien de la oficina me llame.",
        "La gente critica sin saber.",
        "Es algo que la gente critica.",
        "La empresa valida los datos.",
        "La termino de una vez.",
        "Por este motivo solicito una revisión.",
        "Él la practica cada día.",
        "Quiero que las ordenes ya.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "an adjective after a time noun or in a superlative",
    {
      pos: [
        ["El martes pasada no hubo clase.", "El martes pasado no hubo clase."],
        ["Nos vemos la semana próximo.", "Nos vemos la semana próxima."],
        ["En los meses pasado subió el pan.", "En los meses pasados subió el pan."],
        ["La canción más escuchado del verano.", "La canción más escuchada del verano."],
        ["Los platos más pedido son caros.", "Los platos más pedidos son caros."],
        [
          "Eligieron la obra más votado por los lectores.",
          "Eligieron la obra más votada por los lectores.",
        ],
      ],
      neg: [
        "Una vez pasados los exámenes, descansamos.",
        "La vez pasada fue mejor.",
        "Terminó la carrera más cansado que nunca.",
        "Volvió de las vacaciones más relajado.",
        "Tomó la curva más rápido de lo normal.",
        "Es la casa más bonita del barrio.",
        "La explicación es mucho más complicada.",
        "El domingo pasado llovió.",
      ],
    },
  ],
  [
    "spanishAccents",
    "aún/aun, sé/se and sí/si from the words around them",
    {
      pos: [
        ["Aún sin dormir, siguió trabajando.", "Aun sin dormir, siguió trabajando."],
        ["Aún herido, terminó la carrera.", "Aun herido, terminó la carrera."],
        ["Mi abuelo aun trabaja en el campo.", "Mi abuelo aún trabaja en el campo."],
        ["Estábamos aun cenando.", "Estábamos aún cenando."],
        ["Tenía las manos aun mojadas.", "Tenía las manos aún mojadas."],
        ["Se de qué me hablas.", "Sé de qué me hablas."],
        ["Mi hermana también se tocar la guitarra.", "Mi hermana también sé tocar la guitarra."],
        ["Se paciente con ella.", "Sé paciente con ella."],
        ["Si, me encanta.", "Sí, me encanta."],
        ["Eso si es un buen plan.", "Eso sí es un buen plan."],
        ["No tengo coche, pero si una moto.", "No tengo coche, pero sí una moto."],
      ],
      neg: [
        "Aún no ha llegado.",
        "Aun así, fue a trabajar.",
        "Aun cuando llueve, sale.",
        "Aun niños, ya trabajaban.",
        "¿Aun muerto sigues pensando en eso?",
        "Se vende piso.",
        "Se casó muy joven.",
        "Si, como dices, llueve, no iremos.",
        "Te lo doy si lo necesitas.",
        "Eso si es necesario lo hacemos.",
        "Lo haré, pero si a ti te parece bien.",
        "Dijo que «si» es una conjunción.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "por qué after a question mark, a negated verb of knowing or a noun that asks",
    {
      pos: [
        ["¿Porque no me llamaste?", "¿Por qué no me llamaste?"],
        ["No sé porque se enfadó.", "No sé por qué se enfadó."],
        ["La duda es porque nadie avisó.", "La duda es por qué nadie avisó."],
        ["No tengo idea de por que vino.", "No tengo idea de por qué vino."],
        ["Entiendo perfectamente porqué lo hizo.", "Entiendo perfectamente por qué lo hizo."],
      ],
      neg: [
        "¿Porque no lo hice vas a odiarme?",
        "Lo sé porque me lo dijo.",
        "No lo sé porque nadie me lo dijo.",
        "Lucha por que haya paz.",
        "Los premios por que competían eran buenos.",
        "Vine porque quise.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a pronoun picking one from a group of nouns",
    {
      pos: [
        ["Uno de sus hijas vive aquí.", "Una de sus hijas vive aquí."],
        ["Muchos de mis plantas murieron.", "Muchas de mis plantas murieron."],
        ["Alguna de estos libros es tuyo.", "Alguno de estos libros es tuyo."],
        ["Pocas de aquellos problemas quedan.", "Pocos de aquellos problemas quedan."],
        ["Cada una de los coches tiene seguro.", "Cada uno de los coches tiene seguro."],
      ],
      neg: [
        "Una de mis hermanos vino.",
        "Una de nosotros ganó.",
        "Este año fue uno de muchas novedades.",
        "Uno de sus mejores amigos.",
        "Una de sus manos.",
        "Uno de los problemas.",
      ],
    },
  ],
  [
    "spanishTypography",
    "ordinal abbreviations and unit symbols",
    {
      pos: [
        ["Vivo en el 3ro izquierda.", "Vivo en el 3.º izquierda."],
        ["Quedó en 2da posición.", "Quedó en 2.ª posición."],
        ["Es su 1er libro.", "Es su 1.er libro."],
        ["En el 4to. piso hay goteras.", "En el 4.º piso hay goteras."],
        ["Abre a las 9 hrs. de la mañana.", "Abre a las 9 h de la mañana."],
        ["Añade 200grs de harina.", "Añade 200 g de harina."],
      ],
      neg: [
        "Vivo en el 3.º izquierda.",
        "Llegó el 2 de mayo.",
        "Vivían 500 h. de distintas nacionalidades.",
        "Añade 200 g de harina.",
        "El modelo B2do no existe.",
        "A las 15 h.",
      ],
    },
  ],
  [
    "emdashShortcut",
    "the Spanish dialogue dash",
    {
      pos: [
        ["Ya voy -contestó desde la cocina.", "Ya voy —contestó desde la cocina."],
        ["-¿Quién es?", "—¿Quién es?"],
        ["-Buenos días, señora.", "—Buenos días, señora."],
        ["Pasa -dijo-, que hace frío.", "Pasa —dijo-, que hace frío."],
        ["No lo sé –respondió.", "No lo sé —respondió."],
      ],
      neg: [
        "- Primer punto del orden del día.",
        "Es un ex-ministro del ramo.",
        "Llámame -si puedes- mañana.",
        "El tramo Madrid-Toledo.",
        "—¿Quién es?",
      ],
    },
  ],
  [
    "spanishConfusions",
    "sino and si no",
    {
      pos: [
        ["No lo pintó ella si no su hermano.", "No lo pintó ella sino su hermano."],
        ["No es para hoy si no para el lunes.", "No es para hoy sino para el lunes."],
        ["No pido que vuelva, si no que me escriba.", "No pido que vuelva, sino que me escriba."],
        ["Sino vienes, me enfado.", "Si no vienes, me enfado."],
        ["No lo dijo él si no ella.", "No lo dijo él sino ella."],
      ],
      neg: [
        "No iré si no para de llover.",
        "No lo compro si no está barato.",
        "No lo hago si no me pagas.",
        "No fue hace un siglo, sino hace dos meses.",
        "Su sino es fracasar.",
        "No quiero agua sino vino.",
        "Hazlo hoy; si no, mañana.",
      ],
    },
  ],
  [
    "spanishAccents",
    "relatives after their antecedent, el before a bare noun, hacía before an amount of time",
    {
      pos: [
        ["No tengo nada qué decir.", "No tengo nada que decir."],
        ["Busca a alguien en quién apoyarse.", "Busca a alguien en quien apoyarse."],
        ["Me gusta la manera cómo lo explica.", "Me gusta la manera como lo explica."],
        ["No encuentro el sitio por dónde entrar.", "No encuentro el sitio por donde entrar."],
        ["Lo aprobaron con él permiso de todos.", "Lo aprobaron con el permiso de todos."],
        ["Al llegar, él tren ya se había ido.", "Al llegar, el tren ya se había ido."],
        ["Hacia ya cinco años que vivía allí.", "Hacía ya cinco años que vivía allí."],
        ["Hacia más o menos un mes que no llovía.", "Hacía más o menos un mes que no llovía."],
      ],
      neg: [
        "No tengo qué comer.",
        "Me pregunto de qué manera lo hizo.",
        "¿Qué hora es?",
        "Con él voto yo.",
        "Vine con él ayer.",
        "Él solo lo hizo.",
        "Para él regalos no.",
        "Caminó hacia unos árboles que había.",
        "Fueron hacia un pueblo lejano.",
        "Vino hacia la una.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "nouns whose ending hides their gender, -sis nouns, tanto and cuánto",
    {
      pos: [
        ["Abrieron el sucursal nueva.", "Abrieron la sucursal nueva."],
        ["Pintamos el pared del salón.", "Pintamos la pared del salón."],
        ["Defendió un tesis brillante.", "Defendió una tesis brillante."],
        ["Plantaron las árboles ayer.", "Plantaron los árboles ayer."],
        ["Nunca vi tanto gente junta.", "Nunca vi tanta gente junta."],
        ["No sé cuanto horas faltan.", "No sé cuantas horas faltan."],
      ],
      neg: [
        "Hay tanto hombres como mujeres.",
        "¿Cuánto cuesta?",
        "¿Cuántos coches ha tenido él?",
        "La mar estaba en calma.",
        "En todos los cruces de ferrocarril.",
        "La misión del piel roja.",
        "Las crisis económicas.",
        "El análisis fue largo.",
        "En cuanto llegues, avísame.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "a clitic before an infinitive, a bare participle or a noun",
    {
      pos: [
        ["Este libro te gustar mucho.", "Este libro te gusta mucho."],
        ["A Luis le preocupar el examen.", "A Luis le preocupa el examen."],
        ["Nos levantarnos temprano.", "Nos levantamos temprano."],
        ["Ya le dicho que no.", "Ya le ha dicho que no."],
        ["¿Quién te llamado?", "¿Quién te ha llamado?"],
        ["Me olvidado las llaves.", "Me he olvidado las llaves."],
        ["Recoge les libros del suelo.", "Recoge los libros del suelo."],
        ["Le coche no arranca.", "El coche no arranca."],
        ["Os niños ya duermen.", "Los niños ya duermen."],
        [
          "Volvió sin despedirse y al marchase lloró.",
          "Volvió sin despedirse y al marcharse lloró.",
        ],
        ["Vamos a prepara la cena.", "Vamos a preparar la cena."],
      ],
      neg: [
        "Le vino bien el descanso.",
        "Les traje un regalo.",
        "Yo le valido la entrada.",
        "Le duele la espalda.",
        "Les cuento un secreto.",
        "Te quiero ver mañana.",
        "Pidió un té helado.",
        "Les tenías miedo.",
        "Fue a casa de su madre.",
        "La clase de hoy fue larga.",
        "Me he olvidado de todo.",
        "Lo dicho, nos vemos.",
      ],
    },
  ],
  [
    "commaPeriodSpacing",
    "a sentence mark glued to the next sentence",
    {
      pos: [
        ["Llegamos tarde.La cena ya estaba fría.", "Llegamos tarde. La cena ya estaba fría."],
        ["No vino nadie.Pero da igual.", "No vino nadie. Pero da igual."],
        ["Pasa.¿Quieres café?", "Pasa. ¿Quieres café?"],
        ["¿Te gustó?Mucho.", "¿Te gustó? Mucho."],
        ["¡Qué frío!Cierra la ventana.", "¡Qué frío! Cierra la ventana."],
        ["Y entonces…nada.", "Y entonces… nada."],
        ["Lo pensé mucho .Al final dije que no.", "Lo pensé mucho. Al final dije que no."],
      ],
      neg: [
        "Visita la web ejemplo.es para más datos.",
        "Abre el archivo datos.Final antes de salir.",
        "Lo firmó J.R.Tolkien en persona.",
        "Viajó a EE.UU.Hoy vuelve.",
        "El valor es 3.5 metros.",
        "Guarda el fichero como .txt y ciérralo.",
        "Añade buscar?tema=uno al final del enlace.",
        "Llegamos tarde. La cena ya estaba fría.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "adjectives after a subject's or an attribute's noun, and after an article and más",
    {
      pos: [
        ["Los coches rojas están aparcados fuera.", "Los coches rojos están aparcados fuera."],
        ["Es una película muy aburrido.", "Es una película muy aburrida."],
        ["Eran ventanas pequeños.", "Eran ventanas pequeñas."],
        ["El agua helado me despertó.", "El agua helada me despertó."],
        ["Son soluciones posible.", "Son soluciones posibles."],
        ["Mi abuela es la más simpático de todas.", "Mi abuela es la más simpática de todas."],
        ["Elige los menos maduro.", "Elige los menos maduros."],
        [
          "Todos dan por hecho la victoria del equipo.",
          "Todos dan por hecha la victoria del equipo.",
        ],
        ["Damos por supuesto las disculpas.", "Damos por supuestas las disculpas."],
      ],
      neg: [
        "Juan dejó la oficina cansado.",
        "Llegó a la fiesta contento.",
        "La gente mayor vive en el centro.",
        "El pez espada nada rápido.",
        "La mujer piloto aterrizó sin problemas.",
        "Es una camiseta blanco y negro.",
        "Las chicas solo quieren bailar.",
        "La casa junto al río está vacía.",
        "Aparecieron diez perros, la mayoría cachorros.",
        "El jefe valida la propuesta.",
        "Lo da por hecho el ministro.",
        "Es el más allá de la vida.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "plural subjects before a singular attribute",
    {
      pos: [
        ["Somos consciente del riesgo.", "Somos conscientes del riesgo."],
        ["Estamos muy contento con el resultado.", "Estamos muy contentos con el resultado."],
        ["Debemos estar atento a las señales.", "Debemos estar atentos a las señales."],
        ["Tenemos que ser capaz de resolverlo.", "Tenemos que ser capaces de resolverlo."],
        ["Ellas son guapo.", "Ellas son guapas."],
        ["Ella es muy simpático.", "Ella es muy simpática."],
        ["Mi novela ha sido publicado en Chile.", "Mi novela ha sido publicada en Chile."],
      ],
      neg: [
        "Somos buena gente.",
        "Estamos mejor así.",
        "Somos solo cuatro.",
        "Queremos ser médico de familia.",
        "Ella es médico.",
        "Ella es ingeniero de caminos.",
        "Su obra ha sido traducida al francés.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "an infinitive after a modal, tener que and haber de",
    {
      pos: [
        ["A mi hermano le gusta dibuja paisajes.", "A mi hermano le gusta dibujar paisajes."],
        ["Esto debería arregla el problema.", "Esto debería arreglar el problema."],
        ["Tenemos que termina antes del lunes.", "Tenemos que terminar antes del lunes."],
        ["Suelen madruga los domingos.", "Suelen madrugar los domingos."],
        ["Hay que vuelve a empezar.", "Hay que volver a empezar."],
        ["Los socios han de aprueban las cuentas.", "Los socios han de aprobar las cuentas."],
      ],
      neg: [
        "No me gusta nada.",
        "Me gusta este libro.",
        "Cuando puede, intenta ayudar.",
        "Llegó al poder hace años.",
        "Aún pueden verse las ruinas.",
        "Si te gusta comparte el enlace.",
        "Debe de haber un error.",
        "Puede que venga mañana.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "a pronoun written apart from its gerund or infinitive",
    {
      pos: [
        ["Estaba leyendo lo en el tren.", "Estaba leyéndolo en el tren."],
        ["Siguió repitiendo la hasta el final.", "Siguió repitiéndola hasta el final."],
        ["Vengo a ver te.", "Vengo a verte."],
        ["Voy a llevar las a casa.", "Voy a llevarlas a casa."],
        ["Está explicándose lo a sus alumnos.", "Está explicándoselo a sus alumnos."],
      ],
      neg: [
        "Voy a hacer lo que quieras.",
        "Prefiero comer la de chocolate.",
        "Estaba cantando la canción.",
        "Al llegar se fue a dormir.",
        "Quiero ver lo bien que lo haces.",
        "Al terminar, se fue a casa.",
      ],
    },
  ],
  [
    "spanishAccents",
    "para qué before an indicative",
    {
      pos: [
        ["No sé para que sirve este botón.", "No sé para qué sirve este botón."],
        ["Pregúntale para que quiere el dinero.", "Pregúntale para qué quiere el dinero."],
        ["No entiendo para que estudia tanto.", "No entiendo para qué estudia tanto."],
        ["Explica para que lo usas.", "Explica para qué lo usas."],
        ["¿Para que llamas tan tarde?", "¿Para qué llamas tan tarde?"],
      ],
      neg: [
        "Lo hago para que sepas la verdad.",
        "Vino para que habláramos.",
        "Para que podamos ganar más.",
        "Te lo digo para que lo pienses.",
        "Ahorra para que sus hijos estudien.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a plural verb before the impersonal haber",
    {
      pos: [
        ["Pueden haber varios problemas.", "Puede haber varios problemas."],
        ["Tienen que haber más opciones.", "Tiene que haber más opciones."],
        ["Deben de haber muchos errores.", "Debe de haber muchos errores."],
        ["Van a haber dos turnos.", "Va a haber dos turnos."],
        ["Podrían haber 30 personas.", "Podría haber 30 personas."],
      ],
      neg: [
        "Pueden haber cambiado de opinión.",
        "Deben haber salido ya.",
        "Puede haber varios problemas.",
        "Tienen que haberlo visto.",
        "Van a haber terminado para entonces.",
      ],
    },
  ],
  [
    "spanishTypography",
    "commas around sino que, pero no, a subject and the person addressed",
    {
      pos: [
        ["No lo pagó ella sino que lo pagué yo.", "No lo pagó ella, sino que lo pagué yo."],
        ["Lo intentamos pero no salió bien.", "Lo intentamos, pero no salió bien."],
        ["El problema, es que no hay tiempo.", "El problema es que no hay tiempo."],
        ["Los vecinos nuevos, son muy ruidosos.", "Los vecinos nuevos son muy ruidosos."],
        ["Muchas gracias señora.", "Muchas gracias, señora."],
        ["¡Un abrazo Lucía!", "¡Un abrazo, Lucía!"],
        ["Os deseo buenas noches amigos.", "Os deseo buenas noches, amigos."],
        ["¿Cómo estás Marta?", "¿Cómo estás, Marta?"],
        ["Afortunadamente nadie se hizo daño.", "Afortunadamente, nadie se hizo daño."],
      ],
      neg: [
        "No te pido sino que te escuches.",
        "No es azul sino verde.",
        "Estaba cansado pero feliz.",
        "Mi amor, está lista la cena.",
        "El lunes, llegaron todos.",
        "El problema, dice Juan, es grave.",
        "¿Este método, es seguro?",
        "¿Cómo está Marta?",
        "Gracias por todo.",
        "Francamente bueno.",
      ],
    },
  ],
  [
    "stylePhrasing",
    "hace and atrás together",
    {
      pos: [
        ["Lo compré hace dos años atrás.", "Lo compré hace dos años."],
        ["Hace unos meses atrás vivía aquí.", "Hace unos meses vivía aquí."],
        ["Se fue hace un rato atrás.", "Se fue hace un rato."],
        ["Pasó hace casi una década atrás.", "Pasó hace casi una década."],
        ["Llegó hace una semana y media atrás.", "Llegó hace una semana y media."],
      ],
      neg: [
        "Lo compré hace dos años.",
        "Lo compré dos años atrás.",
        "Hace frío y nos vamos atrás.",
        "Mira hacia atrás.",
        "Hace tiempo que no miro atrás.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "a punto de",
    {
      pos: [
        ["Estaba apunto de salir.", "Estaba a punto de salir."],
        ["Está apunto de llover.", "Está a punto de llover."],
        ["Estuve apunto de llamarte.", "Estuve a punto de llamarte."],
        ["Apunto de cerrar, llegó un cliente.", "A punto de cerrar, llegó un cliente."],
        ["Estamos apunto de terminar.", "Estamos a punto de terminar."],
      ],
      neg: [
        "Lo apunto de memoria.",
        "Siempre apunto de nuevo la dirección.",
        "Estaba a punto de salir.",
        "Apunto la hora en la agenda.",
        "Te apunto el número.",
      ],
    },
  ],
  [
    "spanishAccents",
    "nouns and adjectives that look like verbs, before a noun, after an adjective or haber",
    {
      pos: [
        ["La ultima vez nos reímos mucho.", "La última vez nos reímos mucho."],
        ["Esa magnifica actuación ganó el premio.", "Esa magnífica actuación ganó el premio."],
        ["Fue un solo termino el que falló.", "Fue un solo término el que falló."],
        ["Inventaron una nueva formula de pago.", "Inventaron una nueva fórmula de pago."],
        ["No había numero de teléfono.", "No había número de teléfono."],
        ["Hay que poner limite a los gastos.", "Hay que poner límite a los gastos."],
        ["La maquina de café no funciona.", "La máquina de café no funciona."],
        ["Es un termino cuyo uso se extendió.", "Es un término cuyo uso se extendió."],
        ["Mi hija tiene practica de natación.", "Mi hija tiene práctica de natación."],
        ["Fue una realmente magnifica ocasión.", "Fue una realmente magnífica ocasión."],
      ],
      neg: [
        "Él tristemente celebre su cumpleaños solo.",
        "Tengo que practicar más.",
        "Ella la practica de vez en cuando.",
        "Juan la practica de vez en cuando.",
        "La autora critica de arriba abajo a los jóvenes.",
        "La termino mañana.",
        "Antes de salir practico yoga.",
        "La practica a diario.",
      ],
    },
  ],
  [
    "spanishAccents",
    "mí before an adjective closing the phrase, está after a longer subject",
    {
      pos: [
        ["Es un tema para mi imposible.", "Es un tema para mí imposible."],
        ["Fue para mi más difícil de lo esperado.", "Fue para mí más difícil de lo esperado."],
        ["Se acercó a mi asustado por el ruido.", "Se acercó a mí asustado por el ruido."],
        ["Esto es para mi preferible.", "Esto es para mí preferible."],
        ["Para mi son detalles sin importancia.", "Para mí son detalles sin importancia."],
        ["Para mi era una alegría verte.", "Para mí era una alegría verte."],
        ["En lo que a mi respecta, todo bien.", "En lo que a mí respecta, todo bien."],
        [
          "Su última película esta basada en un libro.",
          "Su última película está basada en un libro.",
        ],
        ["La vieja casa esta cerrada.", "La vieja casa está cerrada."],
        ["La tienda esta al final de la calle.", "La tienda está al final de la calle."],
      ],
      neg: [
        "Te doy mi más sincero pésame.",
        "Vino con mi querido amigo.",
        "Bailamos al ritmo de mi son cubano.",
        "Vivimos en mi era favorita.",
        "Hola de parte de mi hermano.",
        "Es para mi nuevo proyecto.",
        "Lo guardo en mi mueble.",
        "Me gusta la casa esta a la que vamos.",
        "Esta preciosa casa es de mi tía.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "este/ese for esto/eso before a noun, determiners across an adjective, doubled pronouns",
    {
      pos: [
        ["En esto momento no puedo atenderte.", "En este momento no puedo atenderte."],
        ["Todo eso dinero es tuyo.", "Todo ese dinero es tuyo."],
        ["Con esto calor no se puede dormir.", "Con este calor no se puede dormir."],
        ["De aquel gran ilusión no quedó nada.", "De aquella gran ilusión no quedó nada."],
        ["Los principales razones son dos.", "Las principales razones son dos."],
        ["A mí no te gusta el café.", "A mí no me gusta el café."],
        ["A ellos le encanta bailar.", "A ellos les encanta bailar."],
      ],
      neg: [
        "Esto cuenta mucho.",
        "Haz eso mañana.",
        "Eso significa mucho.",
        "Por eso mismo lo hice.",
        "El gran hacha cayó.",
        "La mejor parte llega ahora.",
        "A él me lo presentaron ayer.",
        "A ella la vi ayer.",
        "A ti te encanta.",
      ],
    },
  ],
  [
    "spanishAccents",
    "inglés, París, sería and -ar futures read from their frame",
    {
      pos: [
        ["Mi ingles mejora cada día.", "Mi inglés mejora cada día."],
        ["Tengo clase de ingles los lunes.", "Tengo clase de inglés los lunes."],
        ["Este verano viajamos a Paris.", "Este verano viajamos a París."],
        ["No sé quién seria capaz de hacerlo.", "No sé quién sería capaz de hacerlo."],
        ["Esperar seria lo mejor.", "Esperar sería lo mejor."],
        ["Llegara mañana a las diez.", "Llegará mañana a las diez."],
        ["¿Cuándo terminaras el informe?", "¿Cuándo terminarás el informe?"],
      ],
      neg: [
        "Le dolían las ingles.",
        "Depilación de ingles.",
        "Vino con Paris Hilton.",
        "El juicio de Paris.",
        "Es una mujer seria y formal.",
        "Es una persona seria lo que buscamos.",
        "Si me llamara mañana, iría.",
        "Quería que cantara mañana.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "aquel and esos before a paired noun of another gender or number",
    {
      pos: [
        ["Aquellos abogadas ganaron el juicio.", "Aquellas abogadas ganaron el juicio."],
        ["Esos niñas juegan en el parque.", "Esas niñas juegan en el parque."],
        ["Aquella vecinos se mudaron.", "Aquellos vecinos se mudaron."],
        ["Aquel abuela era muy alegre.", "Aquella abuela era muy alegre."],
        ["Esas alumnos aprobaron.", "Esos alumnos aprobaron."],
      ],
      neg: [
        "Aquellos interesados pueden venir.",
        "Se escribe con ese mayúscula.",
        "Esas cansadas de esperar se fueron.",
        "La médico llegó tarde.",
        "Aquellas enfermeras trabajaban de noche.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "dar de alta takes lo/la, dar el alta takes le",
    {
      pos: [
        ["Ayer la dieron el alta.", "Ayer le dieron el alta."],
        ["A los pacientes los darán el alta mañana.", "A los pacientes les darán el alta mañana."],
        ["No las han dado la baja todavía.", "No les han dado la baja todavía."],
        ["Les van a dar de alta hoy.", "Los van a dar de alta hoy."],
        ["Ya les dieron de baja.", "Ya los dieron de baja."],
      ],
      neg: [
        "Le dieron de alta ayer.",
        "Se le dio de alta ayer.",
        "Le dieron el alta.",
        "Ya lo dieron de alta.",
        "La dieron de baja en el gimnasio.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "permitir a + infinitive, and a preposition before a present form",
    {
      pos: [
        ["El plan permite que los vecinos opinar.", "El plan permite a los vecinos opinar."],
        ["No dejó que el perro salir.", "No dejó al perro salir."],
        ["Lo supimos al informa.", "Lo supimos al informar."],
        ["Se rio del multiplica.", "Se rio del multiplicar."],
        ["Lo dijo al termina.", "Lo dijo al terminar."],
        ["Nadie ganó nada con insulta.", "Nadie ganó nada con insultar."],
        ["Se cansó de camina por el monte.", "Se cansó de caminar por el monte."],
        ["Pasó la tarde sin estudia.", "Pasó la tarde sin estudiar."],
      ],
      neg: [
        "El plan permite que los vecinos opinen.",
        "Lo compré con ayuda de mi hermano.",
        "Se presentó sin cita y en contra de todos.",
        "Según informa la radio, llueve.",
        "Imprime, copia y hasta escanea.",
        "Se puso en marcha tras consulta con los vecinos.",
        "Hablamos sobre reforma y sobre deporte.",
        "Desde hace años vive aquí.",
        "Lo vi de cerca.",
        "Hablamos de política.",
        "Hay un botón de descarga.",
        "Permitió que el niño jugara.",
      ],
    },
  ],
  [
    "stylePhrasing",
    "the same adverb twice in a short clause",
    {
      pos: [
        ["También lo sabe también Juan.", "También lo sabe Juan."],
        ["Ya lo tenía ya preparado.", "Ya lo tenía preparado."],
        ["Aún no ha llegado aún.", "Aún no ha llegado."],
        ["Nunca lo vi nunca.", "Nunca lo vi."],
        ["Siempre llega siempre tarde.", "Siempre llega tarde."],
      ],
      neg: [
        "Ya sea uno ya sea otro.",
        "También, también.",
        "Ya lo sé. Ya voy.",
        "Siempre lo dice y lo hace bien siempre.",
        "Nunca jamás lo haré.",
      ],
    },
  ],
  [
    "spanishAccents",
    "qué after a preposition, a verb of knowing or wondering, and aun before a negated gerund",
    {
      pos: [
        [
          "Nadie entiende hasta que punto le importa.",
          "Nadie entiende hasta qué punto le importa.",
        ],
        ["Dime de que color lo quieres.", "Dime de qué color lo quieres."],
        ["No sabíamos a que hora salía el tren.", "No sabíamos a qué hora salía el tren."],
        ["Ignoro de que se queja.", "Ignoro de qué se queja."],
        ["Me pregunto que pensaba mi abuelo.", "Me pregunto qué pensaba mi abuelo."],
        [
          "Les preguntamos que libros leer este verano.",
          "Les preguntamos qué libros leer este verano.",
        ],
        [
          "No sabía que comprarle a mi hermana por su cumpleaños.",
          "No sabía qué comprarle a mi hermana por su cumpleaños.",
        ],
        ["Aún no teniendo dinero, nos invitó.", "Aun no teniendo dinero, nos invitó."],
        ["Para mi es un honor.", "Para mí es un honor."],
      ],
      neg: [
        "Esperó hasta que llegó su madre.",
        "Lo conoce desde que era niño.",
        "Se dio cuenta de que llovía.",
        "Le pregunté que si venía a cenar.",
        "Lo hizo de modo que nadie lo viera.",
        "Se alegra de que gente como tú venga.",
        "Sé que bajar música sin pagar está mal.",
        "Aún no ha llegado el cartero.",
        "En mi era no había teléfonos móviles.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a determiner against the agreeing word and the noun after it",
    {
      pos: [
        ["Trajo muchos otras cosas.", "Trajo muchas otras cosas."],
        ["Volvió una pocas semanas después.", "Volvió unas pocas semanas después."],
        ["¿Tienes alguna otro remedio para la tos?", "¿Tienes algún otro remedio para la tos?"],
        ["Leí la tres novelas del verano.", "Leí las tres novelas del verano."],
        ["Vivió en los tres casas del barrio.", "Vivió en las tres casas del barrio."],
        ["Estos dos casas son nuevas.", "Estas dos casas son nuevas."],
      ],
      neg: [
        "Había demasiado pocas sillas para todos.",
        "Uno tardó dos días y otro tres días.",
        "Es la tres veces campeona de Europa.",
        "Comí con el dos veces ganador del torneo.",
        "Las otras tres hermanas llegaron tarde.",
        "Unos pocos días bastaron.",
      ],
    },
  ],
  [
    "spanishAccents",
    "a first person preterite after a sentence-opening yo, me or ayer",
    {
      pos: [
        ["Yo lo arregle con cinta.", "Yo lo arreglé con cinta."],
        ["Ayer compre pan y leche.", "Ayer compré pan y leche."],
        ["Anoche cene con mis padres.", "Anoche cené con mis padres."],
        ["Me canse de esperar.", "Me cansé de esperar."],
        ["Me equivoque.", "Me equivoqué."],
      ],
      neg: [
        "Quiero que yo cante primero.",
        "Me envíe la factura, por favor.",
        "Cuando yo llegue, cenamos.",
        "Ayer el viento levante sopló fuerte.",
        "Me gusta que me escuches.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "the auxiliary ha/he after a clitic, a subject or a verb's adverb, and por que after a reason",
    {
      pos: [
        ["Él a dicho la verdad.", "Él ha dicho la verdad."],
        ["Nunca a estado en Roma.", "Nunca ha estado en Roma."],
        ["Te e traído un regalo.", "Te he traído un regalo."],
        ["E terminado el informe.", "He terminado el informe."],
        ["No entiendo el motivo porque se marchó.", "No entiendo el motivo por que se marchó."],
        ["Esa es la razón porque vine.", "Esa es la razón por que vine."],
        ["Abrió la ventana para que halla luz.", "Abrió la ventana para que haya luz."],
        ["Ojalá halla sitio para todos.", "Ojalá haya sitio para todos."],
      ],
      neg: [
        "Se puso a cubierto de la lluvia.",
        "Tiene la razón porque lo vio con sus ojos.",
        "Perdió la causa porque su abogado faltó.",
        "Con razón porque nadie lo avisó.",
        "Vino a casa y él e Isabel cenaron.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "grading prefixes before an adjective and doubled words",
    {
      pos: [
        ["Es un grupo pro europeo.", "Es un grupo proeuropeo."],
        ["Lleva una vida cuasi perfecta.", "Lleva una vida cuasiperfecta."],
        ["Tiene ideas ultra modernas.", "Tiene ideas ultramodernas."],
        ["Los niños jugaban al pilla-pilla.", "Los niños jugaban al pillapilla."],
        ["No me vengas con el bla-bla de siempre.", "No me vengas con el blabla de siempre."],
      ],
      neg: [
        "Compramos en un súper cercano.",
        "Hablamos de los pros y los contras.",
        "Se oía el tic-tac del reloj.",
        "Es un súper de barrio.",
        "Votó en pro de la reforma.",
      ],
    },
  ],
  [
    "spanishAccents",
    "nouns opening a heading or before a number",
    {
      pos: [
        ["Capitulo 7.", "Capítulo 7."],
        ["Lee la pagina 12 del libro.", "Lee la página 12 del libro."],
        ["Critica de teatro.", "Crítica de teatro."],
        ["Las ultimas.", "Las últimas."],
        ["Lideres del grupo.", "Líderes del grupo."],
      ],
      neg: [
        "Termino de cenar.",
        "Practica de noche.",
        "Critica a sus amigos.",
        "Practica la natación los lunes.",
        "Critica de todo lo que ve.",
      ],
    },
  ],
  [
    "spanishAccents",
    "hacia after a verb, hacía las veces, an emphatic sí and irá before a gerund",
    {
      pos: [
        ["Corrió hacía la salida.", "Corrió hacia la salida."],
        ["Mi tío hacia las veces de padre.", "Mi tío hacía las veces de padre."],
        ["Si terminé los deberes.", "Sí terminé los deberes."],
        ["Pues si llamé a tu madre.", "Pues sí llamé a tu madre."],
        ["Mañana ira mejorando poco a poco.", "Mañana irá mejorando poco a poco."],
        ["Se ira de vacaciones en julio.", "Se irá de vacaciones en julio."],
      ],
      neg: [
        "Creía que hacía la cena.",
        "Si quieres.",
        "Si llegó tarde, no lo sé.",
        "Si tuvo suerte antes de emigrar.",
        "Sentía la ira creciendo en su pecho.",
        "Mostró miedo e ira contenida.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "a finite form after the perfect auxiliary",
    {
      pos: [
        ["Ya he termina la tarea.", "Ya he terminado la tarea."],
        ["Nunca ha viaja solo.", "Nunca ha viajado solo."],
        ["Hoy he llamé a mi abuela.", "Hoy he llamado a mi abuela."],
        ["Los niños han come pronto.", "Los niños han comido pronto."],
        ["¿Has decido algo?", "¿Has decidido algo?"],
      ],
      neg: [
        "He de irme pronto.",
        "Ha de volver a casa.",
        "Puede haber cambios mañana.",
        "Lo ha dicho su madre.",
        "Ha bendecido la mesa.",
      ],
    },
  ],
  [
    "spanishAccents",
    "a question word made a noun by el",
    {
      pos: [
        ["Importa el qué y el como.", "Importa el qué y el cómo."],
        ["No sabemos el donde ni el cuándo.", "No sabemos el dónde ni el cuándo."],
        ["Discutieron el cuanto, no el qué.", "Discutieron el cuánto, no el qué."],
        ["No importa el quien sino el qué.", "No importa el quién sino el qué."],
        ["No importa el que sino el cómo.", "No importa el qué sino el cómo."],
      ],
      neg: [
        "Fue el que vino primero.",
        "Es el que.",
        "Ese es el que más sabe.",
        "Ese es el como lo hace.",
        "Era el cual buscábamos.",
      ],
    },
  ],
  [
    "spanishTypography",
    "a comma between an opening subject and any verb that agrees with it",
    {
      pos: [
        ["El gobierno, anunció nuevas medidas.", "El gobierno anunció nuevas medidas."],
        ["Los vecinos, no llegaron a tiempo.", "Los vecinos no llegaron a tiempo."],
        ["La empresa, fabrica coches eléctricos.", "La empresa fabrica coches eléctricos."],
        ["Nuestros abuelos, vivieron en el campo.", "Nuestros abuelos vivieron en el campo."],
        ["Esta ley, protege a los menores.", "Esta ley protege a los menores."],
      ],
      neg: [
        "El libro, lo leí ayer.",
        "Mi amor, va a llover.",
        "El problema, dice Juan, es grave.",
        "Esta temporada, jugamos mejor.",
        "El coche, compramos uno nuevo.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "lo before a plural, and an adjective opening a noun phrase without determiner",
    {
      pos: [
        ["Votaron a favor de lo trabajadores.", "Votaron a favor de los trabajadores."],
        ["Lo viejos tiempos no vuelven.", "Los viejos tiempos no vuelven."],
        ["Lo cocinó con frescos verduras.", "Lo cocinó con frescas verduras."],
        ["Viajó en contadas ocasión.", "Viajó en contada ocasión."],
        ["Hermosas paisajes.", "Hermosos paisajes."],
      ],
      neg: [
        "Lo pequeños que son.",
        "Lo hacemos mañana.",
        "Lo comes todos los días.",
        "Con buenas intenciones no basta.",
        "Somos rubias.",
        "Solo hombres en la sala.",
      ],
    },
  ],
  [
    "spanishAccents",
    "está closing a clause after a participle or como, and after que before a participle",
    {
      pos: [
        ["Dicho esta.", "Dicho está."],
        ["Déjalo como esta.", "Déjalo como está."],
        ["Es la pieza que esta pegada por dentro.", "Es la pieza que está pegada por dentro."],
        [
          "Una casa que esta basada en planos antiguos.",
          "Una casa que está basada en planos antiguos.",
        ],
        [
          "La caja de la cual esta sellada con cinta.",
          "La caja de la cual está sellada con cinta.",
        ],
      ],
      neg: [
        "Después de toda esta recogida de datos.",
        "Me gusta como esta.",
        "Dijo que esta salida es mejor.",
        "Finalizada esta en 1445, se mudó.",
        "La casa es mejor que esta.",
      ],
    },
  ],
  [
    "spanishAccents",
    "a preterite after a subject pronoun, past a noun or adjective twin",
    {
      pos: [
        ["Él trabajo dos turnos seguidos.", "Él trabajó dos turnos seguidos."],
        ["Ella limpio la cocina.", "Ella limpió la cocina."],
        ["Él no le hablo en todo el día.", "Él no le habló en todo el día."],
        ["Ella dibujo un mapa del barrio.", "Ella dibujó un mapa del barrio."],
        ["Él no me contesto.", "Él no me contestó."],
      ],
      neg: [
        "Él tranquilo, ella nerviosa.",
        "Él solo lo sabe.",
        "Él mismo lo dijo.",
        "Ella, creo, no lo sabe.",
        "Para él trabajo es todo.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "se before a possessive or a participle",
    {
      pos: [
        ["Es la foto se mi abuela.", "Es la foto de mi abuela."],
        ["Pueden se reparados mañana.", "Pueden ser reparados mañana."],
        ["Deben se revisadas cada año.", "Deben ser revisadas cada año."],
        ["Ya se terminado la función.", "Ya se ha terminado la función."],
        ["La tienda se cerrado por obras.", "La tienda se ha cerrado por obras."],
      ],
      neg: [
        "Se ha cerrado la tienda.",
        "No lo sé, dado que llueve.",
        "Se lo dio a su madre.",
        "Se cansa de esperar.",
        "Pueden ser reparados.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "a perfect participle before a quantifier, a ver after a verb of motion, a before a place",
    {
      pos: [
        ["Ya habían vendidos todos los billetes.", "Ya habían vendido todos los billetes."],
        ["Se han reparadas tres farolas.", "Se han reparado tres farolas."],
        ["Los precios pueden haber subidos.", "Los precios pueden haber subido."],
        ["Mañana fue haber a su tía.", "Mañana fue a ver a su tía."],
        ["Los llevaron haber el partido.", "Los llevaron a ver el partido."],
        ["Quiero volver ha casa pronto.", "Quiero volver a casa pronto."],
        ["Voy ha Sevilla mañana.", "Voy a Sevilla mañana."],
        ["Nos vimos el la plaza mayor.", "Nos vimos en la plaza mayor."],
      ],
      neg: [
        "Pueden haber heridos en la sala.",
        "En la sala pueden haber muertos.",
        "Había determinadas personas esperando.",
        "La causa fue haber un error de cálculo.",
        "Lo peor fue haber dicho eso.",
        "Ir ha sido un error.",
        "Volver ha costado mucho esfuerzo.",
        "Toca el la de la orquesta.",
        "Afinó el la con cuidado.",
      ],
    },
  ],
  [
    "spanishAccents",
    "qué before a missing thing or event, está before a count, cómo estás in a greeting, sí",
    {
      pos: [
        ["Nunca supe que había en el sótano.", "Nunca supe qué había en el sótano."],
        ["Vamos a ver que hay detrás de la puerta.", "Vamos a ver qué hay detrás de la puerta."],
        ["Nadie sabe que ocurrió ayer.", "Nadie sabe qué ocurrió ayer."],
        ["Mamá ya sabe que has hecho.", "Mamá ya sabe qué has hecho."],
        ["Me pregunto que podemos hacer para ayudar.", "Me pregunto qué podemos hacer para ayudar."],
        ["No sé en que o cómo influyó.", "No sé en qué o cómo influyó."],
        ["El faro esta 20 millas al norte.", "El faro está 20 millas al norte."],
        ["¿A qué distancia esta Lima de Quito?", "¿A qué distancia está Lima de Quito?"],
        ["Hola, como está usted?", "Hola, cómo está usted?"],
        ["A ver si el la tiene.", "A ver si él la tiene."],
        ["Si pero no quiero.", "Sí pero no quiero."],
        ["No tengo coche, pero si tengo moto.", "No tengo coche, pero sí tengo moto."],
        ["Pasó esto, si, ¿y ahora qué?", "Pasó esto, sí, ¿y ahora qué?"],
      ],
      neg: [
        "Es fácil ver que hay en la ciudad muchos parques.",
        "Sé que hay en la sala un piano.",
        "Sé que pasó el tren.",
        "Sé que lo has hecho por mí.",
        "Ya sabes que mañana va a hacer frío.",
        "Sabemos que te hace falta.",
        "Sabemos que hay gente buena.",
        "Esta 2.ª edición es mejor.",
        "¿Como estas?",
        "¿Quieres manzanas verdes, como estas?",
        "Lo haré, si, y solo si, me pagas.",
        "No vino, pero si viene mañana lo verás.",
        "No lo sé, pero si lo sabes dímelo.",
        "Ella cantó el la de la obra.",
      ],
    },
  ],
  [
    "spanishAccents",
    "nouns and adjectives after a possessive, a count, cuyo, ser + article or before a verb",
    {
      pos: [
        ["La fabrica produjo lo necesario.", "La fábrica produjo lo necesario."],
        ["La critica que haces es injusta.", "La crítica que haces es injusta."],
        ["¿Le pondrías ese titulo?", "¿Le pondrías ese título?"],
        ["Un destacado interprete tocó ayer.", "Un destacado intérprete tocó ayer."],
        ["Tengo 3 practicas esta semana.", "Tengo 3 prácticas esta semana."],
        ["A cuyo termino se fue.", "A cuyo término se fue."],
        ["Dame tu numero de teléfono.", "Dame tu número de teléfono."],
        ["De las dos, esta es la valida.", "De las dos, esta es la válida."],
      ],
      neg: [
        "La empresa fabrica coches.",
        "Mi madre critica eso.",
        "El jefe valida los datos.",
        "La gente critica mucho.",
        "En el año 2010 practicas más.",
        "Tú practicas mucho.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "contractions, a la, y demás, q, compounds after a determiner or in quotes, irse + gerund",
    {
      pos: [
        ["Vivo cerca de el río.", "Vivo cerca del río."],
        ["Dáselo a el que llegue antes.", "Dáselo al que llegue antes."],
        ["Mañana voy ala oficina.", "Mañana voy a la oficina."],
        ["Trajeron pan, queso y de más.", "Trajeron pan, queso y demás."],
        ["No sé q decir.", "No sé que decir."],
        ["Compramos un mini bar.", "Compramos un minibar."],
        ["Sus tíos la sobre protegen.", "Sus tíos la sobreprotegen."],
        ["Necesito un abre-latas.", "Necesito un abrelatas."],
        ["Es un «saca corchos» viejo.", "Es un «sacacorchos» viejo."],
        ["Nos hemos ido alejado del centro.", "Nos hemos ido alejando del centro."],
        ["Lo supe desde es niño.", "Lo supe desde que es niño."],
        ["Fui a decirle ola.", "Fui a decirle hola."],
      ],
      neg: [
        "Habló de el.",
        "Y A el área le sumamos B.",
        "Vuela en ala delta.",
        "El ala derecha del avión.",
        "La letra q es rara.",
        "Grabé una macro nueva.",
        "Usa una macro para eso.",
        "Escribe sobre animales.",
        "Nos hemos ido cansados.",
        "Lo dije de veras.",
        "La de es la cuarta letra.",
        "Una ola gigante.",
      ],
    },
  ],
  [
    "spanishAccents",
    "dé before con, según, a possessive object or an article and its object",
    {
      pos: [
        ["Que de con generosidad.", "Que dé con generosidad."],
        ["Que cada uno de según pueda.", "Que cada uno dé según pueda."],
        ["Espero que no de su permiso.", "Espero que no dé su permiso."],
        ["Ojalá que alguien de una respuesta.", "Ojalá que alguien dé una respuesta."],
        ["Pide que nadie de su aprobación.", "Pide que nadie dé su aprobación."],
      ],
      neg: [
        "Es la casa de al lado.",
        "Dijo que de su casa salió.",
        "Espero que de una vez llegue.",
        "Que de un golpe lo rompió.",
        "Lo sé de su madre.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a person noun's number, nouns counted by miles or decenas, a singular copula's attribute",
    {
      pos: [
        ["Hablé con unos periodista.", "Hablé con un periodista."],
        ["Lo vio otras dentista.", "Lo vio otra dentista."],
        ["Cayeron decenas de árbol.", "Cayeron decenas de árboles."],
        ["Asistieron miles de estudiante.", "Asistieron miles de estudiantes."],
        ["Soy conscientes del problema.", "Soy consciente del problema."],
        ["Estoy cansados de esperar.", "Estoy cansado de esperar."],
        ["Eres capaces de todo.", "Eres capaz de todo."],
      ],
      neg: [
        "Ganó millones de dinero público.",
        "Miles de millones de estrellas.",
        "Soy todo oídos.",
        "Tú y yo estamos cansados.",
        "Somos conscientes del problema.",
        "Unos dicen que sí.",
      ],
    },
  ],
  [
    "spanishTypography",
    "the number sign, abbreviation periods, a glued count, a capitalized opening article",
    {
      pos: [
        ["Vive en el portal n° 7.", "Vive en el portal n.º 7."],
        ["Habló con el Dr Pérez.", "Habló con el Dr. Pérez."],
        ["Está en la pág 12.", "Está en la pág. 12."],
        ["Pagamos 300euros.", "Pagamos 300 euros."],
        ["LA reunión fue larga.", "La reunión fue larga."],
      ],
      neg: [
        "Vive en el portal n.º 7.",
        "N° 12 del registro.",
        "Habló con el Dr. Pérez.",
        "Mide 5km de largo.",
        "EL PAÍS publicó la noticia.",
        "LAS 3 LEYES DE NEWTON.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a count after a verb, a plural adjective after two singular nouns joined by de",
    {
      pos: [
        ["Compré tres libro usados.", "Compré tres libros usados."],
        ["Vendieron cincuenta casa en un año.", "Vendieron cincuenta casas en un año."],
        ["Pesa dos kilo exactos.", "Pesa dos kilos exactos."],
        ["La mesa de madera blancas.", "La mesa de madera blanca."],
        ["El coche de mi padre rojos.", "El coche de mi padre rojo."],
      ],
      neg: [
        "A las tres llamo a mi madre.",
        "Son las dos y trabajo.",
        "Somos tres, trabajo mucho.",
        "La casa del pueblo blanca.",
        "El jefe de ventas nuevos.",
      ],
    },
  ],
  [
    "spanishAccents",
    "lo + adjective + que, mi before a note, aún before a subjunctive",
    {
      pos: [
        ["Lo ultimo que pido es calma.", "Lo último que pido es calma."],
        ["No sabes lo incomodo que fue.", "No sabes lo incómodo que fue."],
        ["Tocó un concierto en mí bemol.", "Tocó un concierto en mi bemol."],
        ["Es una sonata en mí menor.", "Es una sonata en mi menor."],
        ["Me duele que aun tenga dudas.", "Me duele que aún tenga dudas."],
      ],
      neg: [
        "Lo hizo por mí.",
        "Pensó en mí mayor parte del día.",
        "Ni aun tenga razón.",
        "Lo practico cada día.",
        "Lo termino mañana.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "ha opening a perfect, an article before a number",
    {
      pos: [
        ["Hay venido muy tarde.", "Ha venido muy tarde."],
        ["Hay dicho que no.", "Ha dicho que no."],
        ["Les 20 primeros ganan.", "Los 20 primeros ganan."],
        ["Hay debido perderse.", "Ha debido perderse."],
        ["Les 3 mejores pasan.", "Los 3 mejores pasan."],
      ],
      neg: [
        "Hay helado de fresa.",
        "Hay helado.",
        "Les di 20 euros.",
        "Les 1 de mayo.",
        "Hay heridos graves.",
      ],
    },
  ],
  [
    "spanishAgreement",
    "a shortened adjective before a plural, a second coordinated adjective",
    {
      pos: [
        ["Son buen amigos míos.", "Son buenos amigos míos."],
        ["Tiene gran casas en el campo.", "Tiene grandes casas en el campo."],
        ["Fueron los primer días.", "Fueron los primeros días."],
        [
          "Asumió las consecuencias directas e indirectos.",
          "Asumió las consecuencias directas e indirectas.",
        ],
        ["Lleva una camisa blanca y negro.", "Lleva una camisa blanca y negra."],
      ],
      neg: [
        "Es un buen amigo.",
        "Instalaron un gran cortafuegos.",
        "Viajó a Gran Bretaña.",
        "Los hombres altos y fuertes.",
        "Las faldas rojas y pantalones blancos.",
      ],
    },
  ],
  [
    "spanishAccents",
    "continúa and perpetúa before a gerund or after a pronoun",
    {
      pos: [
        ["Continua lloviendo en el norte.", "Continúa lloviendo en el norte."],
        ["El problema se perpetua así.", "El problema se perpetúa así."],
        ["Ella continua trabajando.", "Ella continúa trabajando."],
        ["Lo continua mañana.", "Lo continúa mañana."],
        ["Continuan llegando cartas.", "Continúan llegando cartas."],
      ],
      neg: [
        "La lluvia continua molesta.",
        "Es una mejora continua.",
        "Cadena perpetua para el reo.",
        "Hubo una lluvia continua toda la noche.",
        "Formación continua y gratuita.",
      ],
    },
  ],
  [
    "spanishTypography",
    "the closing ? or ! of a question or exclamation",
    {
      pos: [
        ["¿Qué es lo que pasa aquí.", "¿Qué es lo que pasa aquí?"],
        ["¡Qué bonito", "¡Qué bonito!"],
        ["¿Dónde vives", "¿Dónde vives?"],
        ["¡Hola! ¿Qué tal.", "¡Hola! ¿Qué tal?"],
        [
          "Me preguntó ¿cuándo vienes. Le dije que mañana.",
          "Me preguntó ¿cuándo vienes? Le dije que mañana.",
        ],
      ],
      neg: [
        "¿Vino el Sr. García?",
        "¿Qué dices! Ya voy.",
        "Dijo: «¿Vienes?».",
        "¿Qué pasa? Nada.",
        "¡Qué día!",
      ],
    },
  ],
  [
    "spanishAgreement",
    "toda las, lo before a feminine noun, el mismo área, a participle before its subject",
    {
      pos: [
        ["Leí toda las páginas.", "Leí todas las páginas."],
        ["Vendrá por lo noche.", "Vendrá por la noche."],
        ["Es del mismo área.", "Es de la misma área."],
        ["Queda garantizado la entrega.", "Queda garantizada la entrega."],
        ["Ya está hecho la cama.", "Ya está hecha la cama."],
        ["Está previsto la reunión.", "Está prevista la reunión."],
      ],
      neg: [
        "Eran sobre todo las charlas del profesor.",
        "Se eliminan del todo las diferencias.",
        "¿Tienen todos el mismo precio?",
        "Por lo general, llega tarde.",
        "El libro está considerado la mejor obra.",
        "Estoy harto la verdad.",
      ],
    },
  ],
  [
    "englishRepeatedWords",
    "two Spanish words typed twice",
    {
      pos: [
        ["Volvimos a casa a casa.", "Volvimos a casa."],
        ["Lo pongo como un como un ejemplo.", "Lo pongo como un ejemplo."],
        ["Me dijo que vino que vino ayer.", "Me dijo que vino ayer."],
        ["Es muy bueno muy bueno.", "Es muy bueno."],
        ["Nos vemos el lunes el lunes.", "Nos vemos el lunes."],
      ],
      neg: [
        "Sube paso a paso a la montaña.",
        "De dos en dos en el árbol.",
        "A diferencia de los de los pájaros.",
        "Sea quien sea quien venga.",
        "Más y más y más.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "revelado before its agent",
    {
      pos: [
        ["El secreto rebelado por la prensa.", "El secreto revelado por la prensa."],
        ["Los datos rebelados por el estudio.", "Los datos revelados por el estudio."],
        ["La verdad fue rebelada por un testigo.", "La verdad fue revelada por un testigo."],
        ["Las cifras rebeladas por el ministerio.", "Las cifras reveladas por el ministerio."],
        ["Un plan rebelado por error.", "Un plan revelado por error."],
      ],
      neg: [
        "El pueblo se ha rebelado contra el rey.",
        "Los soldados rebelados huyeron.",
        "Se rebeló por la injusticia.",
        "Lo ha revelado por fin.",
        "Las tropas se rebelaron.",
      ],
    },
  ],
  [
    "spanishAccents",
    "a demonstrative before its noun, cómo no in an exclamation",
    {
      pos: [
        ["Éste señor es mi vecino.", "Este señor es mi vecino."],
        ["Compré éstas sillas ayer.", "Compré estas sillas ayer."],
        ["Aquél día llovió mucho.", "Aquel día llovió mucho."],
        ["Ésa idea me gusta.", "Esa idea me gusta."],
        ["¡Pero como no le va a gustar!", "¡Pero cómo no le va a gustar!"],
      ],
      neg: [
        "Ésta es la casa.",
        "Éste trabaja aquí.",
        "De todas, ésa me gusta.",
        "¡Como no vengas, me enfado!",
        "¡Cómo no!",
      ],
    },
  ],
  [
    "spanishAgreement",
    "uno before a plural noun",
    {
      pos: [
        ["Votó a favor de uno acreedores.", "Votó a favor de unos acreedores."],
        ["Había uno libros en la mesa.", "Había unos libros en la mesa."],
        ["Trajo uno platos nuevos.", "Trajo unos platos nuevos."],
        ["Vimos uno barcos lejos.", "Vimos unos barcos lejos."],
        ["Pidió uno días libres.", "Pidió unos días libres."],
      ],
      neg: [
        "Cada uno sus cosas.",
        "Uno más y nos vamos.",
        "Uno tras otro llegaron.",
        "Es uno de los mejores.",
        "Uno a uno, entraron.",
      ],
    },
  ],
  [
    "spanishTypography",
    "the degree sign in temperatures",
    {
      pos: [
        ["Hace 25ºC fuera.", "Hace 25 °C fuera."],
        ["El agua hierve a 100 ºC.", "El agua hierve a 100 °C."],
        ["Bajó a 3,5ºC anoche.", "Bajó a 3,5 °C anoche."],
        ["Marca 70ºF ahora.", "Marca 70 °F ahora."],
        ["Estamos a 30ºC.", "Estamos a 30 °C."],
      ],
      neg: [
        "Hace 25 °C fuera.",
        "El 1º de mayo.",
        "Vive en el 3º C.",
        "El 2º Congreso.",
        "Llegó el 5º.",
      ],
    },
  ],
  [
    "spanishAccents",
    "esté before a feminine participle or a la after a subjunctive trigger",
    {
      pos: [
        ["Avísame cuando tu factura este pagada.", "Avísame cuando tu factura esté pagada."],
        ["Para que la tarea este terminada.", "Para que la tarea esté terminada."],
        [
          "Permite que cualquier tienda este a la última.",
          "Permite que cualquier tienda esté a la última.",
        ],
        ["Cuando la sopa este servida, come.", "Cuando la sopa esté servida, come."],
        ["Ojalá que mi carta este enviada.", "Ojalá que mi carta esté enviada."],
      ],
      neg: [
        "Dijo que el libro está a la venta.",
        "Quiero que este lista sea útil.",
        "Cuando este coche llegue, avísame.",
        "Para que este plan funcione.",
        "Creo que este a la larga gana.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "haber after a modal, años before a plural time word",
    {
      pos: [
        ["Podría a ver más gente.", "Podría haber más gente."],
        ["Debería a verlo sabido.", "Debería haberlo sabido."],
        ["Pudo a ver otra salida.", "Pudo haber otra salida."],
        ["Los anos siguientes fueron duros.", "Los años siguientes fueron duros."],
        ["Los anos pasados fueron mejores.", "Los años pasados fueron mejores."],
      ],
      neg: [
        "Vamos a ver la película.",
        "Fue a ver a su madre.",
        "Podemos ir a ver el partido.",
        "Volvió a ver a su hermano.",
        "Quiere a ver si llueve.",
      ],
    },
  ],
];

test("a Spanish pronoun before an imperative that carries one is flagged without a fix", () => {
  for (const text of [
    "Lo dame ahora.",
    "Le dale el libro.",
    "Te dímelo luego.",
    "Lo hazlo bien.",
  ]) {
    const found = findings("spanishConfusions", text);
    expect(found).toHaveLength(1);
    expect(found[0].alternatives).toEqual([]);
  }
  for (const text of [
    "Tú dale que te dale.",
    "Se vende piso.",
    "La dama llegó.",
    "Le dio la mano.",
  ])
    expect(findings("spanishConfusions", text)).toEqual([]);
});

test("a Spanish preposition before a conjugated verb is flagged without a fix", () => {
  for (const text of [
    "De debería probar otra vez.",
    "Lo hizo en cantaba.",
    "Es de llegaron tarde.",
    "De lo debemos todo.",
    "Viven en los estamos juntos.",
    "Es un problema de las cases medias.",
  ]) {
    const found = findings("spanishConfusions", text);
    expect(found).toHaveLength(1);
    expect(found[0].alternatives).toEqual([]);
  }
  for (const text of [
    "Salimos de la calle al final de la tarde.",
    "Más alto que cualquiera de las de enfrente.",
    "Lo dije de veras.",
    "Ganó con creces.",
    "Vamos de compras.",
    "Vuelve de arriba abajo.",
    "Viene de la oficina.",
    "Es de lo mejor.",
    "Habló de lo que sabía.",
    "Pensó en los demás.",
  ])
    expect(findings("spanishConfusions", text)).toEqual([]);
});

describe.each(FIXTURES)("%s: %s", (ruleId, _family, fixture) => {
  test("at least 5 positives and 5 negatives", () => {
    expect(fixture.pos.length).toBeGreaterThanOrEqual(5);
    expect(fixture.neg.length).toBeGreaterThanOrEqual(5);
  });
  test.each(fixture.pos)("repairs %p", (input, expected) => {
    const found = findings(ruleId, input);
    expect(found).toHaveLength(1);
    expect(found[0].bulk.eligible).toBe(false);
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(findings(ruleId, expected)).toEqual([]);
  });
  test.each(fixture.neg)("keeps %p", (input) => {
    expect(findings(ruleId, input).map((d) => d.original)).toEqual([]);
  });
});

test("a Spanish subject pronoun with a verb of another person is flagged without a fix", () => {
  for (const text of [
    "Yo tienes razón.",
    "Tú quiero ir.",
    "Vosotros vamos al cine.",
    "Nosotros sabéis poco.",
  ]) {
    const found = findings("spanishAgreement", text);
    expect(found).toHaveLength(1);
    expect(found[0].warningOnly).toBe(true);
  }
  for (const text of [
    "Yo tenía frío.",
    "Tú solo puedes hacerlo.",
    "Yo mismo lo hice.",
    "Nosotros hace años que no nos vemos.",
    "Donde nosotros nieva en enero.",
    "Nadie más que nosotros sabe lo que pasa.",
    "Yo apenas dormí.",
    "Tú calla.",
  ])
    expect(findings("spanishAgreement", text)).toEqual([]);
});

test("Spanish checks run only on Spanish text and are on by default", () => {
  for (const ruleId of SPANISH_RULES) {
    expect(runsInReviewLanguage(ruleId, "es_ES")).toBe(true);
    for (const lang of ["en_US", "fr_FR", "pt_BR", "auto_detect", "ar_SA"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
    expect(reviewRuleIds({ codeMode: false, overrides: {} })).toContain(ruleId);
  }
});

test("an impossible Spanish date is flagged without a guessed fix", () => {
  for (const text of [
    "Llegó el 34 de marzo.",
    "La cita es el 14/45/2025.",
    "Firmado el 33.12.2020.",
    "Se casaron el 250 de mayo.",
  ]) {
    const found = findings("spanishTypography", text);
    expect(found).toHaveLength(1);
    expect(found[0].warningOnly).toBe(true);
  }
  for (const text of [
    "Vendimos 45 de marzo y 30 de abril.",
    "Cédula: 6-51-2032",
    "Pedido N° 99/73/2022",
    "Pagó el 12/31/2025.",
    "La tasa subió el 30.2 por ciento.",
    "Ganaron el 3-2 en la final.",
    "Tengo 31.4 euros.",
    "Nació el 29.02.88.",
  ])
    expect(findings("spanishTypography", text)).toEqual([]);
  // A two-digit year, no year where the clause ends, a short month name.
  for (const [text, fixed] of [
    ["Se fue el 31.06.97.", "Se fue el 30.06.97."],
    ["Volvió el 31.09.", "Volvió el 30.09."],
    ["Firmó el 30-feb-2021.", "Firmó el 28-feb-2021."],
  ])
    expect(applyEdits(text, findings("spanishTypography", text)[0].alternatives[0].edits)).toBe(
      fixed,
    );
  expect(
    applyEdits(
      "Nació el 31.11.1989.",
      findings("spanishTypography", "Nació el 31.11.1989.")[0].alternatives[0].edits,
    ),
  ).toBe("Nació el 30.11.1989.");
});

test("a user-dictionary word and a cited example stay as typed", () => {
  expect(findings("spanishAccents", "Mi hermano esta en casa.", ["esta"])).toEqual([]);
  expect(findings("spanishAccents", "Escribe la palabra «esta en» con cuidado.")).toEqual([]);
});

test("the clean Spanish corpus has no findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/spanish-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: SPANISH_ON,
      lang: "es_ES",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

test("Spanish stem alternations apply only to the paradigms that have them", () => {
  // Plural nouns whose stem would need another class's alternation stay nouns.
  for (const noun of ["cajas", "sillas", "hijas", "vigas"]) expect(finiteVerb(noun)).toBe(false);
  for (const verb of ["busqué", "empiece", "cojo", "elija", "piensa", "vuelve", "pidió", "sirve"])
    expect(finiteVerb(verb)).toBe(true);
  expect(subjunctiveLike("pague")).toBe(true);
  expect(subjunctiveLike("pie")).toBe(false);
});

test("the Spanish lexicon reads gendered nouns, plurals and gender pairs the dictionary blurs", () => {
  // Gender pairs that are nouns, beside the adjectives ("lleno") and ordinals ("último").
  for (const noun of ["señor", "niño", "profesores", "vecinos"]) expect(isNoun(noun)).toBe(true);
  for (const adjective of ["lleno", "último", "cansados"]) expect(isNoun(adjective)).toBe(false);
  // "nuevo" and "enfermo" have gender forms; "azul" and "mercantil" have none.
  expect(genderedForm("nuevas")).toEqual({ feminine: true, plural: true });
  expect(genderedForm("enferma")).toEqual({ feminine: true, plural: false });
  for (const word of ["azul", "mercantil"]) expect(isGenderedEntry(word)).toBe(false);
  expect(isGenderedEntry("programador")).toBe(true);
  // A common plural reads before the rare verb made from its singular ("españolar").
  for (const plural of ["españoles", "colores", "azules"]) {
    expect(finiteVerb(plural)).toBe(false);
    expect(subjunctiveLike(plural)).toBe(false);
  }
  for (const verb of ["canceles", "mires", "señales"]) expect(finiteVerb(verb)).toBe(true);
});

test("Spanish typewriter quote pairs get angle and curly single quotes, opt-in", () => {
  expect(reviewRuleIds({ codeMode: false })).not.toContain("spanishQuotes");
  const fix = (text: string) => {
    let out = text;
    for (const d of findings("spanishQuotes", text).reverse())
      out = applyEdits(out, d.alternatives[0].edits) ?? out;
    return out;
  };
  expect(fix('Lo llaman "el jefe" en la oficina.')).toBe("Lo llaman «el jefe» en la oficina.");
  expect(fix('("Hasta luego"), dijo.')).toBe("(«Hasta luego»), dijo.");
  expect(fix("Es un asunto 'urgente' de verdad.")).toBe("Es un asunto ‘urgente’ de verdad.");
  for (const text of [
    "Sotheby's subasta cuadros.",
    "Mide 5' 10\" de alto.",
    "Lo llaman «el jefe».",
    'Un "\n" salto',
    "D'Artagnan y O'Connor llegaron.",
  ])
    expect(findings("spanishQuotes", text)).toEqual([]);
});

test("the committed Spanish lexicon matches es_ES.dic/.aff and the n-gram counts (bun run generate:spanish-lexicon)", async () => {
  const S = SPANISH_LEXICON_SOURCES;
  const [dic, aff, committed] = await Promise.all(
    [S.dic, S.aff, S.out].map((path) => readFile(path, "utf8")),
  );
  const [trie, counts] = await Promise.all([
    Bun.file(S.trie).arrayBuffer(),
    Bun.file(S.counts).arrayBuffer(),
  ]);
  expect(buildSpanishLexicon(dic, aff, trie, counts)).toBe(committed);
});

// JavaScriptCore may run a regex in its interpreter (late in the full suite it did): a frame
// with an unbounded run of spaces in a lookbehind then rereads the run at every position. A
// child process without the regex JIT makes that cost visible.
test("Spanish frames stay linear on long space runs without the regex JIT", () => {
  const module = `${import.meta.dir}/../../src/core/domain/grammar/review/reviewDiagnostics.ts`;
  const script = `
    const { prepareReview, reviewChunks, scanReviewChunk } = await import(${JSON.stringify(module)});
    const rules = ${JSON.stringify(SPANISH_ON)};
    const text = "el." + "\\t ".repeat(6000) + " el 32 de enero. Vino a las 5 hrs. y el 2do. Son casas rojos.";
    let slowest = 0;
    for (let run = 0; run < 2; run++) {
      const prepared = prepareReview(
        { id: "jit", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
        { lang: "es_ES", enabledRules: rules, userDictionary: [], insertSpaceAfterAutocomplete: true },
      );
      for (const chunk of reviewChunks(prepared)) {
        const start = performance.now();
        scanReviewChunk(prepared, chunk);
        if (run) slowest = Math.max(slowest, performance.now() - start);
      }
    }
    console.log(slowest);`;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(child.exitCode).toBe(0);
  expect(Number(child.stdout.toString().trim())).toBeLessThan(100);
});

test("no Spanish chunk stalls on repeated trigger words", () => {
  const options = {
    lang: "es_ES",
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
    "¿Que esta este estas el tu mi si se de aun mas? ¡Que bonito! No se si esta bien. " +
    "La casas del uno de las la primer dos perro. Los amigos tiene me gusta las son cansado. " +
    "Una frase.Y así?Siempre…nada le dado te ayudar les medidas un saca leches sobre salían " +
    "micro biología uno de sus casas aun recuerdo se tocar Si, pero eso si es ¿Porque no? " +
    "El domingo pasada la serie más seguido. Juan tienen esta la casa que de cuenta. " +
    "Son casas rojos. La más rojo dan por hecho la Somos consciente debería funciona tiene que " +
    "considera para que sirve cantando lo en pueden haber dos. No lo hice yo sino que pero no " +
    "fue. El problema, es Hola amigo cómo estás Ella es hermoso ha sido traducido. ";
  slowest(triggers.repeat(50));
  for (const text of [
    triggers.repeat(60),
    "esta ".repeat(900),
    `x${" ".repeat(3_800)}${triggers}`.repeat(3),
    "¿".repeat(4_000),
  ])
    expect(slowest(text)).toBeLessThan(100);
});
