// Spanish month names and the dotted tokens that are prose, not names. The Spanish typography
// checks are in grammar/rules/es.yaml; the rule library (library/spanish.ts) exports these.

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
/** The number of a month name, 1 to 12 ("setiembre" is September), or 0. */
export const monthNumber = (month: string) =>
  month.toLowerCase() === "setiembre" ? 9 : MONTHS.indexOf(month.toLowerCase()) + 1;

// Words that open a Spanish sentence and never a dotted name's next part ("frase.Y otra"). The
// STARTERS fragment of grammar/rules/es.yaml holds the same list.
const STARTERS =
  "El|La|Los|Las|Lo|Un|Una|Unos|Unas|Y|Pero|Es|Son|Era|Fue|Está|Hay|No|Sí|Yo|Tú|Él|Ella|Ellos|" +
  "Ellas|Nosotros|Usted|Este|Esta|Estos|Estas|Eso|Esto|Ese|Esa|Se|Me|Te|Le|Les|Nos|Mi|Su|Sus|" +
  "Tu|En|Del|Al|Con|Por|Para|Sin|Como|Cuando|Si|Que|Qué|Cómo|Dónde|Cuándo|Pues|Así|Luego|" +
  "Después|Entonces|Ahora|Hoy|Ayer|También|Además|Ya|Todo|Siempre|Nunca|Aquí|Allí|Hola|" +
  "Gracias|Bueno|Claro|Aunque|Porque|Mientras|Desde|Hasta|Según";
/**
 * "frase.Y", "Ven.Como": two sentences glued at a period, prose rather than a dotted name.
 * "p.ej", "p.e": a squeezed "p. ej." is prose too.
 */
export const SPANISH_PROSE_DOTTED_TOKEN = new RegExp(
  `^(?:\\p{L}*\\p{Ll}{2}\\.(?:${STARTERS})|[pP]\\.ej?)$`,
  "u",
);
