import { expect, test } from "bun:test";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { cpuMs, slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

// Adversarial input in the worst-case style of ReviewWorstCase.test.ts, for pt_BR.
const options = {
  lang: "pt_BR",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const TRIGGERS =
  "na fabrica da duvida em pratica de musica para a policia um critica uma duvida em a de o " +
  "um forte grande estimulo tão pratico não dir-lhe-ei poderia-se eles não tem fazem dez anos " +
  "de Niterói/RJ 31 de abril de 2023 30/02/2024 para mim fazer esta coberto " +
  "Uma problema dos cidade os situações o nossa mesma todo os erros não querem-na " +
  "Os meninos dança. Já deu dez horas foi eu Enviarão ontem espero que você está " +
  "É necessário uma festa às 10.00 h a política econômico Grande distancia " +
  "Queria que a Maria Clara de Souza estudava Caso talvez ele conhece " +
  "foi a dois anos ele nos da mais bom de que tem direito entre ela e eu Por que cinto " +
  "comecei a lendo na termos O serviço continuo uma diferencia no 1ª lugar na 2º posição " +
  "fez a análise dos realizaram o envio de ";

test("Portuguese frames stay fast on long runs of trigger words and spaces", () => {
  slowestChunkMs(TRIGGERS.repeat(20), "pt_BR");
  const inputs = [
    TRIGGERS.repeat(60),
    `x${" ".repeat(3_800)}${TRIGGERS}`.repeat(3),
    "da ".repeat(3_000),
    "em a ".repeat(1_500),
    "1/1/1 ".repeat(1_500),
    "de Aa Bb Cc Dd Ee Ff Gg ".repeat(500),
    "eles não já também tem ".repeat(600),
    "palavra , no entanto , no entanto portanto, ".repeat(400),
    "os o as a uma um da do nos ".repeat(400),
    "o nossa os mesma uns outro ".repeat(500),
    "espero que quero que embora caso talvez que a ".repeat(300),
    "devido a quanto a vou a à uma acesso as se refere a ".repeat(300),
    "eu falo tu e eu nós comia eles fiquei a palavra está correto ".repeat(250),
    "a uns a dois a mais bom de que o a b c d direito ".repeat(300),
    "Serviço continuo. Aulas praticas. O apoio continuo ".repeat(300),
    "fez a análise realizaram o efetuar a seleção fazer o d ".repeat(300),
    ". 1 abc 22 casas ".repeat(600),
    "foram corrigido o já si que agente vai á tira-mos as vão fazerem ".repeat(250),
    "afear a faca evento a b c tomará lugar em pedir um concelho, quando poder trás o ".repeat(200),
    "acho que baixou os preços passou muitas fala das questões uma boa questão é boa sob o ".repeat(
      150,
    ),
  ];
  for (const text of inputs) expect(slowestChunkMs(text, "pt_BR")).toBeLessThan(100);
  const live = { ...options, liveRules: [] };
  findLiveGrammarProposals(TRIGGERS.repeat(5), live);
  expect(cpuMs(() => findLiveGrammarProposals(TRIGGERS.repeat(5), live))).toBeLessThan(50);
});
