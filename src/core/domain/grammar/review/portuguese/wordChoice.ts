import type { PortugueseFixer } from "./confusions";

/** Swaps the stem `from` of the typed word for `to`: "afeou" -> "afiou". */
const restem = (from: string, to: string) => (typed: string) => [
  typed.replace(new RegExp(`^${from}`, "iu"), to),
];
const table = (map: Record<string, string>) => (typed: string) => [map[typed.toLowerCase()]];

const EAT_TO_TAKE: Record<string, string> = {
  comer: "tomar",
  como: "tomo",
  come: "toma",
  comemos: "tomamos",
  comem: "tomam",
  comi: "tomei",
  comeu: "tomou",
  comeram: "tomaram",
  comia: "tomava",
  comiam: "tomavam",
  comendo: "tomando",
  comido: "tomado",
};
const TAKE_PLACE: Record<string, string> = {
  toma: "tem",
  tomam: "têm",
  tomou: "teve",
  tomaram: "tiveram",
  tomará: "terá",
  tomarão: "terão",
  tomaria: "teria",
  tomariam: "teriam",
  tomava: "tinha",
  tomavam: "tinham",
  tomasse: "tivesse",
  tomassem: "tivessem",
};
const HAD_TO: Record<string, string> = {
  estive: "tive",
  esteve: "teve",
  estivemos: "tivemos",
  estiveram: "tiveram",
};

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  ptAfe: restem("afe", "afi"),
  ptArre: restem("arre", "arri"),
  ptComer: table(EAT_TO_TAKE),
  ptToma: table(TAKE_PLACE),
  ptConcelhos: (typed) => [typed.replace(/nc/i, "ns")],
  ptConsertos: (typed) => [typed.replace(/ns/i, "nc")],
  ptConsertos2: (typed) => [typed.replace(/ns/i, "nc")],
  ptAmostras: (typed) => [typed.slice(1)],
  ptEstive: table(HAD_TO),
  ptPercas: (typed) => [typed.replace(/c/i, "d")],
  ptSensos: (typed) => [typed.replace(/^s/i, "c")],
} satisfies Record<string, PortugueseFixer>;
