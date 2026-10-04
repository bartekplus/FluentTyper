import { expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("no Spanish chunk stalls on repeated trigger words", () => {
  const slowest = (text: string) => slowestChunkMs(text, "es_ES");
  const triggers =
    "¿Que esta este estas el tu mi si se de aun mas? ¡Que bonito! No se si esta bien. " +
    "La casas del uno de las la primer dos perro. Los amigos tiene me gusta las son cansado. " +
    "Una frase.Y así?Siempre…nada le dado te ayudar les medidas un saca leches sobre salían " +
    "micro biología uno de sus casas aun recuerdo se tocar Si, pero eso si es ¿Porque no? " +
    "El domingo pasada la serie más seguido. Juan tienen esta la casa que de cuenta. " +
    "Son casas rojos. La más rojo dan por hecho la Somos consciente debería funciona tiene que " +
    "considera para que sirve cantando lo en pueden haber dos. No lo hice yo sino que pero no " +
    "fue. El problema, es Hola amigo cómo estás Ella es hermoso ha sido traducido. " +
    "Siempre e ido voy hablar ah sido no ay mi mama dice está tal mal todo el ano las españoles. " +
    "Él sera Veras que Venia de un buen termino estos serian. De esta forma queda hecho la " +
    "Tenía prevista el un puñado de persona. Cuando aya llegado e correo pueden ven la ora. " +
    "En el caso que llueva son bastantes caros te haz dado sobretodo ha desecho un bueno día. " +
    "Vine ara ayudarte le ara bien obtenidos través de las. Un lio el rio hace frio Rio de " +
    "Janeiro el viaje en si fue. Hay que se el mejor y va a se muy fácil, debe cree. Los más seguro es lo más rápidos posibles…etc. " +
    "Uno, dos, etc el s XIX la O.N.U de J. R Tolkien p.ej. nº 4 pag 12 tlf: 6 el 3° del '92 la sra. Gómez. Sí sí, Este Verano. NO lo veo a las 6hrs. de las tics 30 m2 -> páginas 12-18 ganó 3-1 tel. 915-5512 se han firmar te se cae No contad muy gravísimo, dado a que Podrían haber retrasos ";
  slowest(triggers.repeat(50));
  for (const text of [
    triggers.repeat(60),
    "esta ".repeat(900),
    `x${" ".repeat(3_800)}${triggers}`.repeat(3),
    "¿".repeat(4_000),
  ])
    expect(slowest(text)).toBeLessThan(100);
});
