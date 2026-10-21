/**
 * Portuguese number writing and typography. The frames and their code are in
 * grammar/rules/pt_BR.yaml; Review diagnostics read the prose tokens below.
 */

export { userWord } from "../../library/portuguese/text";

// The 27 Brazilian federative units.
const UF = "(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)";
/** "Niterói/RJ": a place and its state code, prose rather than a path. */
export const PLACE_STATE_TOKEN = new RegExp(`^\\p{Lu}[\\p{Ll}\\p{M}]+/${UF}$`, "u");
/** Prose that looks technical: a dotted ordinal ("12.º", "3.ª", "12.o"), "e.t.c", "kW/h". */
export const PORTUGUESE_PROSE_TOKEN = /^(?:\d{1,4}\.[ºªoa]s?|e\.t\.c|[kK]W[/.]h)$/u;
