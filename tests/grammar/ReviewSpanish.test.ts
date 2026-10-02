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
      ],
      neg: [
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
      ],
      neg: [
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
      ],
      neg: [
        "En Madrid trabajo mucho.",
        "El pan compro yo.",
        "Ahora limpio la cocina.",
        "El niño modelo saluda al público.",
        "Últimamente aprecio más el silencio.",
        "Luis, trabajo mañana.",
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
        ["Volvió sin despedirse y al marchase lloró.", "Volvió sin despedirse y al marcharse lloró."],
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
];

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

test("the committed Spanish lexicon matches es_ES.dic/.aff (bun run generate:spanish-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [SPANISH_LEXICON_SOURCES.dic, SPANISH_LEXICON_SOURCES.aff, SPANISH_LEXICON_SOURCES.out].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildSpanishLexicon(dic, aff)).toBe(committed);
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
    "La casas del uno de las la primer dos perro. Los amigos tiene me gusta las son cansado. ";
  slowest(triggers.repeat(50));
  for (const text of [
    triggers.repeat(60),
    "esta ".repeat(900),
    `x${" ".repeat(3_800)}${triggers}`.repeat(3),
    "¿".repeat(4_000),
  ])
    expect(slowest(text)).toBeLessThan(100);
});
