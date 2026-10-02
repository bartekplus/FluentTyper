import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildPortugueseLexicon,
  buildPortugueseVerbLexicon,
  buildPortugueseVerbStems,
  PORTUGUESE_LEXICON_SOURCES,
} from "../../scripts/generate-portuguese-lexicon";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import {
  REVIEW_RULE_METADATA,
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
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const LANG = "pt_BR";

function findings(ruleId: CatalogRuleId, text: string, lang = LANG, userDictionary: string[] = []) {
  return detectReviewDiagnostics(
    { id: "pt", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** Every finding's first alternative applied at once. */
function repaired(ruleId: CatalogRuleId, text: string): string {
  const edits = findings(ruleId, text).flatMap((d) => d.alternatives[0]?.edits ?? []);
  return applyEdits(text, edits);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const RULES: Array<[CatalogRuleId, Fixture]> = [
  [
    "portugueseAccentParonyms",
    {
      pos: [
        ["Ele trabalha na fabrica de tecidos.", "Ele trabalha na fábrica de tecidos."],
        ["Tenho uma duvida sobre o contrato.", "Tenho uma dúvida sobre o contrato."],
        ["Vamos colocar o plano em pratica amanhã.", "Vamos colocar o plano em prática amanhã."],
        ["Ela gosta de musica clássica.", "Ela gosta de música clássica."],
        ["Saiu na ultima edição do jornal.", "Saiu na última edição do jornal."],
        ["Recebemos a visita do medico ontem.", "Recebemos a visita do médico ontem."],
        ["Ligaram para a policia às duas.", "Ligaram para a polícia às duas."],
        ["Sem duvida, foi o melhor dia.", "Sem dúvida, foi o melhor dia."],
        ["Cada critica ajudou o texto.", "Cada crítica ajudou o texto."],
        ["Ele mora em uma fabrica antiga.", "Ele mora em uma fábrica antiga."],
        ["Houve um forte estimulo ao setor.", "Houve um forte estímulo ao setor."],
        ["A principal evidencia sumiu.", "A principal evidência sumiu."],
        ["Foi um trabalho tão pratico.", "Foi um trabalho tão prático."],
        ["Toda critica ajuda.", "Toda crítica ajuda."],
        ["Tenho duvidas sobre o plano.", "Tenho dúvidas sobre o plano."],
      ],
      neg: [
        "Por último publica os dados.",
        "O velho critica tudo.",
        "Ela própria critica o texto.",
        "Ela pratica natação toda semana.",
        "Ele nos critica sempre que pode.",
        "O governo publica os dados hoje.",
        "Um critica, o outro elogia.",
        "A secretaria da escola fecha cedo.",
        "Ele a fabrica em casa.",
        "Fiquei na dúvida até o fim.",
        "Isso seria uma boa ideia.",
        "A palavra “duvida” é um verbo.",
        "Visitamos a Fabrica de Ideias.",
        "Ele sabia da verdade.",
        "Abra o arquivo da pratica.md agora.",
      ],
    },
  ],
  [
    "portugueseConfusions",
    {
      pos: [
        ["Ainda à pouco que fazer aqui.", "Ainda há pouco que fazer aqui."],
        ["Não nos falamos a muito tempo.", "Não nos falamos há muito tempo."],
        ["Moro aqui dês que nasci.", "Moro aqui desde que nasci."],
        ["Chove dês da manhã.", "Chove desde a manhã."],
        ["Decidiram por termo ao contrato.", "Decidiram pôr termo ao contrato."],
        ["Queremos por em prática a ideia.", "Queremos pôr em prática a ideia."],
        ["Moro aqui à vinte anos.", "Moro aqui há vinte anos."],
        ["Não nos vemos à muito tempo.", "Não nos vemos há muito tempo."],
        ["Começamos à trabalhar cedo.", "Começamos a trabalhar cedo."],
        ["A loja abre de segunda à sexta.", "A loja abre de segunda a sexta."],
        ["A reunião começa as 14h30.", "A reunião começa às 14h30."],
        ["Você saiu por quê não gostou?", "Você saiu por que não gostou?"],
        ["Ele foi embora, mas porque?", "Ele foi embora, mas por quê?"],
        ["Ninguém entendeu o porque da demora.", "Ninguém entendeu o porquê da demora."],
        ["Porque você não veio ontem?", "Por que você não veio ontem?"],
        ["Isso não e possível agora.", "Isso não é possível agora."],
        ["Qual e o seu nome?", "Qual é o seu nome?"],
        ["O sistema esta funcionando de novo.", "O sistema está funcionando de novo."],
        ["Ele esta bem melhor hoje.", "Ele está bem melhor hoje."],
        ["Onde esta?", "Onde está?"],
        ["Isso não me da vontade de sair.", "Isso não me dá vontade de sair."],
        ["Esse plano não da certo.", "Esse plano não dá certo."],
        ["Por favor, me de um minuto.", "Por favor, me dê um minuto."],
        ["Espero que ele de atenção ao filho.", "Espero que ele dê atenção ao filho."],
        ["Ontem ouve muitos problemas na rede.", "Ontem houve muitos problemas na rede."],
        ["O livro ficou encima da mesa.", "O livro ficou em cima da mesa."],
        ["Precisamos por os pratos na mesa.", "Precisamos pôr os pratos na mesa."],
        ["Elas também tem dois cachorros.", "Elas também têm dois cachorros."],
        ["Elas não mantém a casa limpa.", "Elas não mantêm a casa limpa."],
        ["Faziam meses que não chovia.", "Fazia meses que não chovia."],
        ["Vão fazer dois anos que ela partiu.", "Vai fazer dois anos que ela partiu."],
        ["Vamos sair está noite.", "Vamos sair esta noite."],
        ["O portão esta fechado desde ontem.", "O portão está fechado desde ontem."],
        ["Não sei se poço ajudar.", "Não sei se posso ajudar."],
        ["Já tentei varias vezes.", "Já tentei várias vezes."],
        ["Caminhei ate a praia.", "Caminhei até a praia."],
        ["Guardei o bolo para tu.", "Guardei o bolo para ti."],
        ["Ficou entre eu e ela.", "Ficou entre mim e ela."],
        ["A tarefa é para mim fazer hoje.", "A tarefa é para eu fazer hoje."],
        ["Mesmo assim e possível ganhar.", "Mesmo assim é possível ganhar."],
        ["As vezes eu corro.", "Às vezes eu corro."],
        ["Saímos as dez horas.", "Saímos às dez horas."],
        ["Vou as compras.", "Vou às compras."],
        ["Vire a esquerda na praça.", "Vire à esquerda na praça."],
        ["Deu acesso à documentos antigos.", "Deu acesso a documentos antigos."],
        ["Ontem assistimos o jogo inteiro.", "Ontem assistimos ao jogo inteiro."],
        ["Nem sempre ele obedece os pais.", "Nem sempre ele obedece aos pais."],
        ["Prefiro praia do que montanha.", "Prefiro praia a montanha."],
      ],
      neg: [
        "Daqui a muito tempo ninguém lembra.",
        "Quero que me dês do teu chá.",
        "Ele saiu por fim de manhã.",
        "Por termos tempo, ficamos.",
        "Para eles tem sido um ano duro.",
        "Todas as vezes que saio, chove.",
        "Lembro as vezes em que fomos.",
        "Ela chegou à Homicídios cedo.",
        "Isso leva à mais pura alegria.",
        "O médico assistiu o paciente.",
        "Vamos assistir a uma aula.",
        "Obedeça a sua mãe.",
        "Prefiro ler mais do que escrever.",
        "Ela se acostumou com a cidade.",
        "Eles obedeciam a leis antigas.",
        "Os gêmeos fazem dez anos amanhã.",
        "Lá fora já está noite.",
        "Esta chegada foi rápida.",
        "O poço secar seria um desastre.",
        "Tu varias muitas vezes de opinião.",
        "Espero que ele ate o barco.",
        "Para eu sair, preciso da chave.",
        "Ficou difícil para mim entender.",
        "Entre eu sair e ficar, escolho ficar.",
        "Daqui a vinte anos tudo muda.",
        "Fomos à praia de manhã.",
        "Ele voltou à mulher que amava.",
        "Entre as 14h e as 16h não atendo.",
        "Ele saiu porque não gostou.",
        "Não sei por quê.",
        "Por que você não veio?",
        "Ele e a irmã são possíveis candidatos.",
        "Esta casa está à venda.",
        "Uma situação como esta.",
        "Ela gosta da escola nova.",
        "Ele ouve música todos os dias.",
        "A torre encima a colina.",
        "Ele passou por aqui ontem.",
        "Vou por esse caminho mais curto.",
        "Vamos de segunda até sexta, da segunda à sexta semana.",
      ],
    },
  ],
  [
    "portugueseContractions",
    {
      pos: [
        ["Deixei a chave em a gaveta.", "Deixei a chave na gaveta."],
        ["O preço de este carro subiu.", "O preço deste carro subiu."],
        ["Entreguei o livro a o professor.", "Entreguei o livro ao professor."],
        ["Não volto mais a aquele lugar.", "Não volto mais àquele lugar."],
        ["Passamos por a ponte velha.", "Passamos pela ponte velha."],
        ["A casa de ele fica longe.", "A casa dele fica longe."],
        ["Em a primeira vez, errei.", "Na primeira vez, errei."],
        ["Não pense mais em isso agora.", "Não pense mais nisso agora."],
      ],
      neg: [
        "Antes de o sol nascer, saímos.",
        "Gosto de o ouvir cantar.",
        "Apesar de a casa ser antiga, é confortável.",
        "Seria o caso de o governo apresentá-las hoje.",
        "Moro em um apartamento pequeno.",
        "Ele precisa de um carro novo.",
        "A palavra termina em o.",
        "Li a notícia em O Globo.",
        "Vale de A a Z.",
        "Temos que por o lixo para fora.",
      ],
    },
  ],
  [
    "portugueseNumberFormat",
    {
      pos: [
        ["O ônibus sai às 18hrs.", "O ônibus sai às 18h."],
        ["A loja abre às 9 hs em ponto.", "A loja abre às 9 h em ponto."],
        ["A palestra começa às 14:30 hrs.", "A palestra começa às 14:30."],
        ["O jantar é às 20H.", "O jantar é às 20h."],
        ["Hoje fez 32ºC na praia.", "Hoje fez 32°C na praia."],
        ["Ela terminou em 3o lugar.", "Ela terminou em 3o lugar."],
        ["Ela ficou com o 3o lugar.", "Ela ficou com o 3º lugar."],
        ["Moro no 8° andar.", "Moro no 8º andar."],
        ["A cidade fica a 40 Km daqui.", "A cidade fica a 40 km daqui."],
        ["O terreno tem 300 m2 de área.", "O terreno tem 300 m² de área."],
      ].filter(([typed, fixed]) => typed !== fixed) as Array<[string, string]>,
      neg: [
        "O ônibus sai às 18h.",
        "A reunião é às 14:30 h.",
        "Chegamos às 7:00h.",
        "Hoje fez 32 °C na praia.",
        "Ela ficou com o 3º lugar.",
        "A água ferve a 100° no nível do mar.",
        "O modelo K2 foi lançado.",
        "Comprei um HB20 usado.",
        "A sala 2a fica no fim do corredor.",
        "Use a chave Km3 no arquivo.",
      ],
    },
  ],
  [
    "portugueseTypographyStyle",
    {
      pos: [
        ["A aula começa às 8.30 da manhã.", "A aula começa às 8:30 da manhã."],
        ["O voo sai às 22.15 h.", "O voo sai às 22:15 h."],
        ["Atendemos das 9.00 às 17.00.", "Atendemos das 9:00 às 17:00."],
        ["A sala mede 4 x 5 metros.", "A sala mede 4 × 5 metros."],
        ["O resultado é 3*4.", "O resultado é 3×4."],
        ["A água é H2O.", "A água é H₂O."],
        ["O carro emite CO2 demais.", "O carro emite CO₂ demais."],
        ["O etanol é C2H5OH.", "O etanol é C₂H₅OH."],
        ["Ela nasceu em Niterói/RJ.", "Ela nasceu em Niterói–RJ."],
        ["O time de Campinas (SP) venceu.", "O time de Campinas–SP venceu."],
        ["Ele mora em Salvador - BA.", "Ele mora em Salvador–BA."],
      ],
      neg: [
        "O ingresso custa das 2,50 libras.",
        "Chegou às 10.000 assinaturas.",
        "Ele mora em Salvador–BA.",
        "Abra a pasta Docs/RJ/fotos.",
        "O vírus H1N1 voltou.",
        "Comprei um HB20 e um PS4.",
        "A norma ISO9001 exige isso.",
        "O endereço 0x1F é válido.",
        "Ligue para o SNS24.",
      ],
    },
  ],
  [
    "portugueseCliticPlacement",
    {
      pos: [
        ["Não diga-me isso agora.", "Não me diga isso agora."],
        ["Nunca contou-lhe a verdade.", "Nunca lhe contou a verdade."],
        ["Ninguém lembrou-se do prazo.", "Ninguém se lembrou do prazo."],
        ["Todos admiram-se da coragem dela.", "Todos se admiram da coragem dela."],
        ["Não encontramo-nos desde maio.", "Não nos encontramos desde maio."],
        ["Quem enviou-te esta carta?", "Quem te enviou esta carta?"],
        ["Já conhecia-te de outros carnavais.", "Já te conhecia de outros carnavais."],
        ["Ele nunca vendeu-o barato.", "Ele nunca o vendeu barato."],
        ["Os dois não deixam-na sair.", "Os dois não a deixam sair."],
        ["Nunca comemo-lo inteiro.", "Nunca o comemos inteiro."],
        ["Nunca contar-lhe-ei o segredo.", "Nunca lhe contarei o segredo."],
        ["Talvez vendê-lo-íamos mais tarde.", "Talvez o venderíamos mais tarde."],
        ["Com isso poderia-se evitar o atraso.", "Com isso poder-se-ia evitar o atraso."],
        ["Amanhã entregarás-lhe as chaves.", "Amanhã entregar-lhe-ás as chaves."],
        ["Depois veremo-nos na praia.", "Depois ver-nos-emos na praia."],
        ["Se der, faria-o com gosto.", "Se der, fá-lo-ia com gosto."],
        ["Os vizinhos venderão-na logo.", "Os vizinhos vendê-la-ão logo."],
        ["Os alunos não querem-na como chefe.", "Os alunos não a querem como chefe."],
        ["Nunca preferes-me aos outros.", "Nunca me preferes aos outros."],
        ["Por favor, não esperem-nos para o jantar.", "Por favor, não nos esperem para o jantar."],
      ],
      neg: [
        "Nunca quis comprá-lo.",
        "O caso passou-se em 1990.",
        "Que bom revê-la!",
        "Poder-se-ia pensar o contrário.",
        "A loteria-relâmpago saiu.",
        "Ontem tirei-lhe uma foto.",
        "Ele queria-me ver.",
        "Acho que deve-lhe uma explicação.",
        "Vou ignorá-lo.",
        "Ele disse-me a verdade.",
        "Para não dizer-lhe nada, saí.",
        "Não querendo-se expor, calou.",
        "É melhor não fazerem-no sozinhos.",
        "Para não saberes-lhe o nome, sai.",
        "Seria pior não pararem-se ali.",
        "Não me diga isso.",
        "Diga-me, não esqueça.",
        "Não, diga-me depois.",
      ],
    },
  ],
  [
    "portugueseAgreement",
    {
      pos: [
        ["No bairro existe vários mercados.", "No bairro existem vários mercados."],
        ["Ontem aconteceu dois acidentes.", "Ontem aconteceram dois acidentes."],
        ["Ainda restava algumas dúvidas.", "Ainda restavam algumas dúvidas."],
        ["Amanhã deve ocorrer uns atrasos.", "Amanhã devem ocorrer uns atrasos."],
        ["Ela próprio preparou o jantar.", "Ela própria preparou o jantar."],
        ["Eles mesmos e elas próprios votaram.", "Eles mesmos e elas próprias votaram."],
        ["Isso é muito estranha.", "Isso é muito estranho."],
        ["Tudo aquilo foi tão divertida!", "Tudo aquilo foi tão divertido!"],
        ["Quando eu ver o resultado, ligo.", "Quando eu vir o resultado, ligo."],
        ["Amanhã nós vai cedo.", "Amanhã nós vamos cedo."],
        ["A gente fomos ao parque.", "A gente foi ao parque."],
        ["Elas não sabe o caminho.", "Elas não sabem o caminho."],
        ["Você são muito gentil.", "Você é muito gentil."],
        ["Eles não gosta de café.", "Eles não gostam de café."],
        ["Nós sempre gostava de ler.", "Nós sempre gostávamos de ler."],
        ["Vocês fala demais.", "Vocês falam demais."],
        ["Ela não trabalham aos sábados.", "Ela não trabalha aos sábados."],
        ["Eu adoraram a viagem.", "Eu adorei a viagem."],
        ["Você produzem muito.", "Você produz muito."],
        ["Vocês não leu o aviso?", "Vocês não leram o aviso?"],
        ["Nós partiu às seis.", "Nós partimos às seis."],
        ["Se a gente fazer tudo hoje, descansa.", "Se a gente fizer tudo hoje, descansa."],
        ["Assim que vocês terem tempo, venham.", "Assim que vocês tiverem tempo, venham."],
        ["Se nós não podermos ir, avisamos.", "Se nós não pudermos ir, avisamos."],
        ["Recebi uma problema sério no trabalho.", "Recebi um problema sério no trabalho."],
        ["Ele chegou do cidade vizinha.", "Ele chegou da cidade vizinha."],
        ["Os situações mudaram rápido.", "As situações mudaram rápido."],
        ["Ela fez uma grande esforço.", "Ela fez um grande esforço."],
        ["Fiquei preso num garagem escura.", "Fiquei preso numa garagem escura."],
        ["Gostei muito dos fotos da viagem.", "Gostei muito das fotos da viagem."],
        ["A vizinha trouxe uns frutas maduras.", "A vizinha trouxe umas frutas maduras."],
        ["Falei disso nos reuniões de março.", "Falei disso nas reuniões de março."],
        ["Os menina chegou cedo.", "A menina chegou cedo."],
        ["Conversei com os professor ontem.", "Conversei com o professor ontem."],
        ["Pelo janela entrava o vento.", "Pela janela entrava o vento."],
        ["O nossa casa fica longe.", "A nossa casa fica longe."],
        ["Passei o mesma semana em casa.", "Passei a mesma semana em casa."],
        ["Os outro meninos saíram.", "Os outros meninos saíram."],
        ["Toda as cidades votaram.", "Todas as cidades votaram."],
        ["Alguns pessoas não vieram.", "Algumas pessoas não vieram."],
        ["A reforma tributário saiu do papel.", "A reforma tributária saiu do papel."],
        ["Falamos da cultura japonês na aula.", "Falamos da cultura japonesa na aula."],
        ["Os produtos brasileiras são bons.", "Os produtos brasileiros são bons."],
        ["Mudou a situação econômico do bairro.", "Mudou a situação econômica do bairro."],
        ["As crianças brinca no quintal.", "As crianças brincam no quintal."],
        ["Os vizinhos não gostou da festa.", "Os vizinhos não gostaram da festa."],
        ["Meus primos mora em Recife.", "Meus primos moram em Recife."],
        ["O cachorro latem a noite toda.", "O cachorro late a noite toda."],
        ["A professora explicaram tudo.", "A professora explicou tudo."],
        ["Quando deu onze horas, saímos.", "Quando deram onze horas, saímos."],
        ["Já está batendo 9h e nada.", "Já estão batendo 9h e nada."],
        ["Quem pagou a conta foi nós.", "Quem pagou a conta fomos nós."],
        ["Precisam-se de garçons.", "Precisa-se de garçons."],
        ["Comprarão ontem a passagem.", "Compraram ontem a passagem."],
        ["Viajaram amanhã cedo.", "Viajarão amanhã cedo."],
        ["Espero que vocês estão bem.", "Espero que vocês estejam bem."],
        ["Peço que ele chega mais cedo.", "Peço que ele chegue mais cedo."],
        ["Embora tem dinheiro, não viaja.", "Embora tenha dinheiro, não viaja."],
        ["Desejo que a reunião termina cedo.", "Desejo que a reunião termine cedo."],
        ["Queria que ele vem amanhã.", "Queria que ele viesse amanhã."],
        ["Gostaria que vocês ficam para o jantar.", "Gostaria que vocês ficassem para o jantar."],
        ["Duvido que a Maria Clara sabe a resposta.", "Duvido que a Maria Clara saiba a resposta."],
        ["Caso você precisa de ajuda, ligue.", "Caso você precise de ajuda, ligue."],
        ["Talvez ele conhece o caminho.", "Talvez ele conheça o caminho."],
        ["Esperava que os alunos estudavam mais.", "Esperava que os alunos estudassem mais."],
        ["Sugiro que vocês passeiam na praia.", "Sugiro que vocês passeiem na praia."],
        ["Exijo que a empresa devolve o dinheiro.", "Exijo que a empresa devolva o dinheiro."],
        ["Não acho que ele mente.", "Não acho que ele minta."],
        ["É necessário uma revisão completa.", "É necessária uma revisão completa."],
        ["Será proibido as visitas no domingo.", "Serão proibidas as visitas no domingo."],
        ["Foi necessária um novo teste.", "Foi necessário um novo teste."],
      ],
      neg: [
        "Isso acontece muitas vezes.",
        "A reunião ocorre dois dias depois.",
        "Existem muitos problemas.",
        "Ele resta sozinho em casa.",
        "Isso é boa notícia.",
        "Ela própria decidiu.",
        "Deve haver muitas opções.",
        "Até eu fazer isso, espere.",
        "Depois de eu ver o filme, durmo.",
        "Quando ele por fim chegou, jantamos.",
        "Para eles foi um alívio.",
        "Eu e ela vamos juntas.",
        "Nós é que pagamos a conta.",
        "Conheço eles faz muitos anos.",
        "Vi elas hoje cedo.",
        "Nós comia ali todo dia.",
        "Eles se encontraram.",
        "Eles realmente precisam de ajuda.",
        "Ele também viajou.",
        "Eu sempre passeio na praia.",
        "Ele o ajuda com a lição.",
        "Nós as alimentamos bem.",
        "Cada um ajuda como pode.",
        "Isso me da trabalho.",
        "Estes são os meus livros.",
        "O filme foi chamado por muitos de obra-prima.",
        "Sou todo ouvidos.",
        "O camisa 9 perdeu o pênalti.",
        "Guardei os óculos no porta luvas.",
        "Ao termos as respostas, seguimos.",
        "Pelo menos ela tentou.",
        "O seu pelo brilha ao sol.",
        "A meu ver, ninguém errou.",
        "Mil e uma noites de chuva.",
        "O dia do jornalista é amanhã.",
        "Ela é uma atleta e ele é um modelo.",
        "Vi as fotos do sistema novo.",
        "Nos vemos depois da aula.",
        "Ela está nos ajudando muito.",
        "O mundo todo a respeita.",
        "Ele voltou da viagem cansado.",
        "Na escola brasileiro aprende cedo a ler.",
        "A palavra inglês tem acento.",
        "A empresa cheira a tinta fresca.",
        "Todos os anos chove no verão.",
        "Os alunos este ano estudaram mais.",
        "Os jogadores fora de campo descansam.",
        "A pé vão mais rápido.",
        "Este mês vencem as contas.",
        "O sino bateu doze horas.",
        "Ele deu 10 horas de aula.",
        "Deu uma hora da tarde.",
        "Fui eu mesmo.",
        "Os pacientes tratam-se de manhã.",
        "O prazo era amanhã.",
        "Para amanhã, deixe tudo pronto.",
        "Elas esperam amanhã a resposta.",
        "O casarão ontem pegou fogo.",
        "Acho que você está certo.",
        "Espero que você esteja bem.",
        "O desejo que tenho é viajar.",
        "Espera que eu já volto.",
        "Disse o mesmo que ele disse.",
        "Quero que ele venda o carro.",
        "Espero que ele cobre o valor justo.",
        "Espero que a sala limpa esteja pronta.",
        "Espero que o que ele disse seja verdade.",
        "Desde que cheguei, chove.",
        "Ainda acho que ele mente.",
        "Contei antes que ela chegou.",
        "Os meninos é que sabem.",
        "É proibido o uso de celulares.",
        "É necessário os alunos estudarem mais.",
        "É necessário a todos manter a calma.",
        "É proibida a entrada de animais.",
      ],
    },
  ],
  [
    "portugueseAO90",
    {
      pos: [
        ["Minha auto-estima melhorou.", "Minha autoestima melhorou."],
        ["Comprei um creme anti-rugas.", "Comprei um creme antirrugas."],
        ["Vendi o carro semi-novo.", "Vendi o carro seminovo."],
        ["O vice diretor chegou.", "O vice-diretor chegou."],
        ["Tomei um anti inflamatório.", "Tomei um anti-inflamatório."],
        ["O prazo vence em 28 de Janeiro.", "O prazo vence em 28 de janeiro."],
        ["Até o próximo Domingo.", "Até o próximo domingo."],
      ],
      neg: [
        "Esquente no micro-ondas.",
        "O super-herói voou.",
        "Moro na Rua Sete de Setembro.",
        "Viajaram na Sexta-Feira Santa.",
        "Ela faz a pós em Direito.",
        "O caso está sub judice.",
        "Somos anti Marco.",
      ],
    },
  ],
];

describe.each(RULES)("%s", (ruleId, { pos, neg }) => {
  test("runs only for Portuguese", () => {
    expect(runsInReviewLanguage(ruleId, LANG)).toBe(true);
    for (const lang of ["en_US", "es_ES", "fr_FR", "auto_detect"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
  });
  test.each(pos)("flags %p", (text, expected) => {
    expect(repaired(ruleId, text)).toBe(expected);
    expect(findings(ruleId, expected)).toEqual([]);
  });
  test.each(neg.map((text) => [text]))("leaves %p alone", (text) => {
    expect(findings(ruleId, text)).toEqual([]);
  });
  test("stays silent in other languages and for the user's own words", () => {
    const [text] = pos[0];
    expect(findings(ruleId, text, "es_ES")).toEqual([]);
    const typed = findings(ruleId, text)[0];
    const word = text.slice(typed.range.start, typed.range.end).toLowerCase();
    expect(findings(ruleId, text, LANG, [word])).toEqual([]);
  });
});

describe("portugueseCommas", () => {
  test.each([
    ["A obra atrasou, no entanto ficou boa.", "A obra atrasou, no entanto, ficou boa."],
    ["Ela é, na verdade muito tímida.", "Ela é, na verdade, muito tímida."],
    ["Pense, por exemplo que tudo muda.", "Pense, por exemplo, que tudo muda."],
    ["Ele aceitou portanto, a proposta.", "Ele aceitou, portanto, a proposta."],
    ["O plano falhou por outro lado, aprendemos.", "O plano falhou, por outro lado, aprendemos."],
    ["Boa noite Carla.", "Boa noite, Carla."],
    ["Obrigada Pedro!", "Obrigada, Pedro!"],
    ["Não não vou.", "Não, não vou."],
  ])("fixes %p", (text, expected) => {
    expect(repaired("portugueseCommas", text)).toBe(expected);
    expect(findings("portugueseCommas", expected)).toEqual([]);
    expect(findings("portugueseCommas", text, "es_ES")).toEqual([]);
  });
  test.each([
    "Vários países, por exemplo o Brasil, aderiram.",
    "A lei vale, com efeito retroativo a maio.",
    "Ele estava portanto pronto.",
    "Mas na verdade, ninguém sabe.",
    "Frutas como por exemplo, maçãs.",
    "Bom dia a todos.",
    "Bom dia Brasil é um telejornal.",
    "Disse que não, não quero.",
    "Não via nada além disso, nem queria.",
    "Aumenta muito, por exemplo se dobrar a carga.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseCommas", text)).toEqual([]);
  });
});

describe("portugueseDates", () => {
  test("runs only for Portuguese", () => {
    expect(runsInReviewLanguage("portugueseDates", LANG)).toBe(true);
    for (const lang of ["en_US", "es_ES", "auto_detect"])
      expect(runsInReviewLanguage("portugueseDates", lang)).toBe(false);
  });
  test.each([
    ["A reunião ficou para 31 de abril.", "31 de abril"],
    ["O boleto vence em 30/02/2024.", "30/02/2024"],
    ["Ela nasceu em 29 de fevereiro de 2023.", "29 de fevereiro de 2023"],
    ["Prazo final: 31-06-2025.", "31-06-2025"],
    ["Chegamos no dia 31 set. de 2019.", "31 set. de 2019"],
  ])("points at %p without a fix", (text, date) => {
    const [finding, ...rest] = findings("portugueseDates", text);
    expect(rest).toEqual([]);
    expect(text.slice(finding.range.start, finding.range.end)).toBe(date);
    expect(finding.warningOnly).toBe(true);
    expect(finding.alternatives).toEqual([]);
    expect(findings("portugueseDates", text, "es_ES")).toEqual([]);
  });
  test.each([
    "Ela nasceu em 29 de fevereiro de 2024.",
    "O Natal americano cai em 12/25/2024.",
    "Preencha a data: 00/00/0000.",
    "Atualize para a versão 10.13.2024.",
    "Faltam 31 mais coisas.",
    "Ela nasceu em 29/02/2000.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseDates", text)).toEqual([]);
  });
});

test("the clean Portuguese corpus has no default-on findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/portuguese-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const enabledRules = REVIEW_SUPPORTED_RULE_IDS.filter(
    (id) =>
      runsInReviewLanguage(id, LANG) &&
      REVIEW_RULE_METADATA[id].defaultEnabled &&
      !["capitalizeSentenceStart", "capitalizeAfterLineBreak"].includes(id),
  );
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules, lang: LANG, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics;
  expect(
    found.map(
      (d) => `${d.ruleId}: ${d.original} @ ${text.slice(d.range.start - 20, d.range.end + 10)}`,
    ),
  ).toEqual([]);
});

test("the committed paronym and verb tables match pt_BR.dic/.aff (bun run generate:portuguese-lexicon)", async () => {
  const [dic, aff, paronyms, verbs, stems, trie, counts] = await Promise.all([
    readFile(PORTUGUESE_LEXICON_SOURCES.dic),
    readFile(PORTUGUESE_LEXICON_SOURCES.aff),
    readFile(PORTUGUESE_LEXICON_SOURCES.out, "utf8"),
    readFile(PORTUGUESE_LEXICON_SOURCES.verbsOut, "utf8"),
    readFile(PORTUGUESE_LEXICON_SOURCES.stemsOut, "utf8"),
    Bun.file(PORTUGUESE_LEXICON_SOURCES.trie).arrayBuffer(),
    Bun.file(PORTUGUESE_LEXICON_SOURCES.counts).arrayBuffer(),
  ]);
  expect(buildPortugueseLexicon(dic, aff)).toBe(paronyms);
  expect(buildPortugueseVerbLexicon(dic, aff)).toBe(verbs);
  expect(buildPortugueseVerbStems(dic, aff, trie, counts)).toBe(stems);
});

// Adversarial input in the worst-case style of ReviewWorstCase.test.ts, for pt_BR.
const options = {
  lang: LANG,
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
  "Queria que a Maria Clara de Souza estudava Caso talvez ele conhece ";

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("Portuguese frames stay fast on long runs of trigger words and spaces", () => {
  slowestChunkMs(TRIGGERS.repeat(20));
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
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
  const live = { ...options, liveRules: [] };
  findLiveGrammarProposals(TRIGGERS.repeat(5), live);
  const start = performance.now();
  findLiveGrammarProposals(TRIGGERS.repeat(5), live);
  expect(performance.now() - start).toBeLessThan(50);
});
