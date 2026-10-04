import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  buildPortugueseLexicon,
  buildPortugueseVerbLexicon,
  buildPortugueseVerbStems,
  PORTUGUESE_LEXICON_SOURCES,
} from "../../scripts/generate-portuguese-lexicon";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { cpuMs, scan, slowestChunkMs } from "./reviewHarness";

const LANG = "pt_BR";

function findings(ruleId: CatalogRuleId, text: string, lang = LANG, userDictionary: string[] = []) {
  return scan(text, { enabledRules: [ruleId], lang, userDictionary }).filter(
    (d) => d.ruleId === ruleId,
  );
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
        ["Não restam duvidas sobre isso.", "Não restam dúvidas sobre isso."],
        ["O apoio continuo da equipe ajudou.", "O apoio contínuo da equipe ajudou."],
        ["Aulas praticas começam amanhã.", "Aulas práticas começam amanhã."],
        ["Pequeno negocio também paga imposto.", "Pequeno negócio também paga imposto."],
        ["Não vejo nenhuma diferencia.", "Não vejo nenhuma diferença."],
        ["Ganhou uma licencia especial.", "Ganhou uma licença especial."],
        ["Escuto radio no carro.", "Escuto rádio no carro."],
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
        ["A musica tocou a noite toda.", "A música tocou a noite toda."],
        ["Choveu. O transito parou na ponte.", "Choveu. O trânsito parou na ponte."],
        ["As duvidas ficaram para amanhã.", "As dúvidas ficaram para amanhã."],
        ["Ele sempre cópia as respostas do colega.", "Ele sempre copia as respostas do colega."],
        ["Eu cálculo que faltam dez minutos.", "Eu calculo que faltam dez minutos."],
        ["Ela não influência ninguém na equipe.", "Ela não influencia ninguém na equipe."],
        ["Tu últimas o relatório hoje?", "Tu ultimas o relatório hoje?"],
        ["Prática-se muito esporte aqui.", "Pratica-se muito esporte aqui."],
        ["A empresa diz que providência-se tudo.", "A empresa diz que providencia-se tudo."],
      ],
      neg: [
        "Amanhã continuo o relatório.",
        "Este ano pratico mais esportes.",
        "O relatório continuo amanhã.",
        "Isso diferencia os dois.",
        "O resto continuo depois.",
        "A natureza continua bela.",
        "Por último publica os dados.",
        "Ele médico, ela enfermeira.",
        "Entreguei a ela prática suficiente para a prova.",
        "Nós médicos sabemos disso.",
        "Eu cópia de mim mesmo? Nunca.",
        "Ela secretária, ele diretor.",
        "Ele a cópia fiel do pai.",
        "O velho critica tudo.",
        "Ela própria critica o texto.",
        "Ela pratica natação toda semana.",
        "Ele nos critica sempre que pode.",
        "O governo publica os dados hoje.",
        "Um critica, o outro elogia.",
        "A secretaria da escola fecha cedo.",
        "Ele a fabrica em casa.",
        "Ela, como sempre, o critica em público.",
        "Quem a pratica sabe disso.",
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
        ["Está escola é nova.", "Esta escola é nova."],
        ["Levei as crianças á praia.", "Levei as crianças à praia."],
        ["Eu acho que agente já sabe a resposta.", "Eu acho que a gente já sabe a resposta."],
        ["Agente nunca desiste.", "A gente nunca desiste."],
        ["Isso é muito caro para agente.", "Isso é muito caro para a gente."],
        ["Ela concluiu a pos-graduação.", "Ela concluiu a pós-graduação."],
        ["Os recem-chegados esperam.", "Os recém-chegados esperam."],
        ["Então ela já si arrependeu.", "Então ela já se arrependeu."],
        ["Será que algum de voz sabe a senha?", "Será que algum de vós sabe a senha?"],
        ["No verão passado tivemos de férias.", "No verão passado estivemos de férias."],
        ["Ele tinha de folga até segunda.", "Ele estava de folga até segunda."],
        ["Ela sera transferida em breve.", "Ela será transferida em breve."],
        ["Acho que você tera sorte.", "Acho que você terá sorte."],
        ["O que sera feito agora?", "O que será feito agora?"],
        ["Apôs 2010, a empresa cresceu.", "Após 2010, a empresa cresceu."],
        ["Gostei do filme, mais não do final.", "Gostei do filme, mas não do final."],
        ["Saiu cedo e mas tarde voltou.", "Saiu cedo e mais tarde voltou."],
        ["Tu não vez o problema?", "Tu não vês o problema?"],
        ["Na foto tem sou duas pessoas.", "Na foto tem só duas pessoas."],
        ["Como foi as provas?", "Como foram as provas?"],
        ["Comprei uma cerra nova.", "Comprei uma serra nova."],
        ["Mudei de casa a três semanas.", "Mudei de casa há três semanas."],
        ["O vizinho da de ombros para tudo.", "O vizinho dá de ombros para tudo."],
        ["Ela sempre nos da conselhos úteis.", "Ela sempre nos dá conselhos úteis."],
        ["Das duas camisas, quero está.", "Das duas camisas, quero esta."],
        ["O ônibus saiu a dez minutos", "O ônibus saiu há dez minutos"],
        ["Ela só pensa em se mesma.", "Ela só pensa em si mesma."],
        ["Vou traduzir a carta em francês.", "Vou traduzir a carta para francês."],
        ["Perdi a minha ora de almoço.", "Perdi a minha hora de almoço."],
        ["Esperei duas oras na fila.", "Esperei duas horas na fila."],
        ["Ele quer ficar tanto forte quanto o irmão.", "Ele quer ficar tão forte quanto o irmão."],
        ["Você da aulas de piano?", "Você dá aulas de piano?"],
        ["A melhor opção é está.", "A melhor opção é esta."],
        ["A porta esta fechada.", "A porta está fechada."],
        ["Este bolo é mais bom que o de ontem.", "Este bolo é melhor que o de ontem."],
        ["Era a cidade mais grande da região.", "Era a cidade maior da região."],
        ["Recebeu o auxílio de que tinha direito.", "Recebeu o auxílio a que tinha direito."],
        ["Ficou um segredo entre ela e eu.", "Ficou um segredo entre ela e mim."],
        ["Por que perdeu o ônibus.", "Porque perdeu o ônibus."],
        ["Eu me cinto cansado hoje.", "Eu me sinto cansado hoje."],
        ["A estação fica à sul do rio.", "A estação fica ao sul do rio."],
        ["O motivo é por que ela viajou.", "O motivo é porque ela viajou."],
        ["Explique o porque disso.", "Explique o porquê disso."],
        [
          "Isso se refere certamente a proposta antiga.",
          "Isso se refere certamente à proposta antiga.",
        ],
        ["Ainda à pouco que fazer aqui.", "Ainda há pouco que fazer aqui."],
        ["Fizemos uma viajem ao Peru.", "Fizemos uma viagem ao Peru."],
        ["A viajem atrasou duas horas.", "A viagem atrasou duas horas."],
        ["Espero que vocês viagem tranquilos.", "Espero que vocês viajem tranquilos."],
        ["Comprei um sinto de couro.", "Comprei um cinto de couro."],
        ["A grade de asso enferrujou.", "A grade de aço enferrujou."],
        ["Em relação a proposta, nada mudou.", "Em relação à proposta, nada mudou."],
        ["Graças a ajuda dos vizinhos, saímos.", "Graças à ajuda dos vizinhos, saímos."],
        ["Ela tem acesso as informações.", "Ela tem acesso às informações."],
        ["O valor é superior a média.", "O valor é superior à média."],
        ["Amanhã vamos a praia.", "Amanhã vamos à praia."],
        ["Quanto a viagem, decidimos depois.", "Quanto à viagem, decidimos depois."],
        ["Ela se candidatou a vaga.", "Ela se candidatou à vaga."],
        ["Fui à uma festa ontem.", "Fui a uma festa ontem."],
        ["Pergunte à Sua Excelência.", "Pergunte a Sua Excelência."],
        ["O ingresso equivale à R$ 50.", "O ingresso equivale a R$ 50."],
        ["E tudo isso porque?", "E tudo isso por quê?"],
        ["Juntei dinheiro afim de viajar.", "Juntei dinheiro a fim de viajar."],
        ["Falamos com ele acerca de dez minutos.", "Falamos com ele há cerca de dez minutos."],
        ["Vieram acerca de 300 pessoas.", "Vieram cerca de 300 pessoas."],
        ["Aonde você mora agora?", "Onde você mora agora?"],
        ["Senão fosse por ela, ninguém viria.", "Se não fosse por ela, ninguém viria."],
        ["Não só estudou, mais também trabalhou.", "Não só estudou, mas também trabalhou."],
        ["Não dá pra mim sair hoje.", "Não dá pra eu sair hoje."],
        ["Já fazem dois anos que não o vejo.", "Já faz dois anos que não o vejo."],
        ["Enquanto houverem dúvidas, pergunte.", "Enquanto houver dúvidas, pergunte."],
        ["Case eles não venham, cancelamos.", "Caso eles não venham, cancelamos."],
        ["O dinheiro foi gastado em festas.", "O dinheiro foi gasto em festas."],
        ["A conta foi pagada ontem.", "A conta foi paga ontem."],
        ["Ele saiu ás cinco horas.", "Ele saiu às cinco horas."],
        ["De uma olhada nisso.", "Dê uma olhada nisso."],
        ["Não de ouvidos a ele.", "Não dê ouvidos a ele."],
        ["Ele esta de saída.", "Ele está de saída."],
        ["Conheço a Ana à quase 30 anos.", "Conheço a Ana há quase 30 anos."],
        ["Vou na praia amanhã.", "Vou à praia amanhã."],
        ["Vamos no cinema hoje.", "Vamos ao cinema hoje."],
        ["Devem haver baratas ali.", "Deve haver baratas ali."],
        ["Eu evito de comer fritos.", "Eu evito comer fritos."],
        ["Penso de que estamos bem.", "Penso que estamos bem."],
        ["O que ouve com ela?", "O que houve com ela?"],
        ["Ouve algo com ele?", "Houve algo com ele?"],
        ["Isso esta confuso.", "Isso está confuso."],
        ["Fiquei tao cansada.", "Fiquei tão cansada."],
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
        "Está difícil hoje.",
        "O nome dela começa com um á agudo.",
        "O agente vai investigar o caso.",
        "Agente secreto não revela nada.",
        "Ela trabalha como agente.",
        "Ele tem um tom de voz grave.",
        "Tive de sair mais cedo.",
        "Ela tinha de férias apenas uma semana.",
        "O notário apôs o selo no documento.",
        "Que sera, sera, cantava a avó.",
        "Está chovendo desde cedo.",
        "Uma vez o vi na praça.",
        "Eu sou feliz aqui.",
        "Como foi a viagem?",
        "Volto daqui a três semanas.",
        "O prazo foi reduzido a dois dias.",
        "A praia fica a duas horas daqui.",
        "O curso dura de dois a três anos.",
        "Precisamos de mais boa vontade.",
        "Ele trouxe mais boas notícias.",
        "Tenho a certeza de que ela tem direito.",
        "A casa da de cima é mais bonita.",
        "Por que ele saiu, ninguém sabe.",
        "Comprei um cinto muito bonito.",
        "Eu sinto muito pelo atraso.",
        "Gosto de quando sinto o vento.",
        "Que viagem incrível foi aquela!",
        "Talvez viagem seja a palavra certa.",
        "Não sei se ela sinta frio.",
        "Ela trabalha tanto quanto a irmã.",
        "O atraso foi devido a problemas técnicos.",
        "Em relação a isso, nada mudou.",
        "Saímos à uma hora da manhã.",
        "Devido a muita chuva, ficamos em casa.",
        "Em relação a minha proposta, nada mudou.",
        "Isso equivale a dizer que não.",
        "Devido a Maria, chegamos tarde.",
        "Lá vai a bola.",
        "Refere-se a um caso antigo.",
        "Quero entender o porquê do atraso.",
        "O teu porquê não me convence.",
        "Ela é uma pessoa afim às artes.",
        "Falamos acerca de dois assuntos importantes.",
        "Aonde você vai?",
        "Não faz nada senão reclamar.",
        "Venha cedo, senão perdemos o ônibus.",
        "Isso é para mim, obrigado.",
        "Os gêmeos fazem dez anos amanhã.",
        "Eles haviam saído cedo.",
        "Case com ela logo.",
        "Ele tinha pagado a conta.",
        "De um lado, o rio.",
        "De uma forma ou de outra.",
        "Prefiro esta de vidro.",
        "O ás do volante venceu.",
        "Ele deve haver chegado cedo.",
        "Ele foi na praia que a conheceu.",
        "Como você está indo na escola?",
        "Ele acredita no que ouve.",
        "Você ouve algo?",
        "O tao é antigo.",
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
        ["Moro em China há dois anos.", "Moro na China há dois anos."],
        ["Ele voltou de Estados Unidos ontem.", "Ele voltou dos Estados Unidos ontem."],
        ["Vamos a Peru nas férias.", "Vamos ao Peru nas férias."],
        ["Viajou para Costa Rica sozinha.", "Viajou para a Costa Rica sozinha."],
        ["Passamos por Brasil e Chile.", "Passamos pelo Brasil e Chile."],
        ["O preço de este carro subiu.", "O preço deste carro subiu."],
        ["Entreguei o livro a o professor.", "Entreguei o livro ao professor."],
        ["Não volto mais a aquele lugar.", "Não volto mais àquele lugar."],
        ["Passamos por a ponte velha.", "Passamos pela ponte velha."],
        ["A casa de ele fica longe.", "A casa dele fica longe."],
        ["Em a primeira vez, errei.", "Na primeira vez, errei."],
        ["Não pense mais em isso agora.", "Não pense mais nisso agora."],
      ],
      neg: [
        "Visitei a Argentina no verão.",
        "Vou para Portugal amanhã.",
        "Moramos em França há anos.",
        "O Banco de Brasil Seguros ligou.",
        "Ela é a China que todos conhecem.",
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
        ["Ficou no 3ª lugar.", "Ficou no 3º lugar."],
        ["Chegou na 1º posição.", "Chegou na 1ª posição."],
        ["O ônibus sai às 18hrs.", "O ônibus sai às 18h."],
        ["A loja abre às 9 hs em ponto.", "A loja abre às 9 h em ponto."],
        ["A palestra começa às 14:30 hrs.", "A palestra começa às 14:30."],
        ["O jantar é às 20H.", "O jantar é às 20h."],
        ["Hoje fez 32ºC na praia.", "Hoje fez 32°C na praia."],
        ["Ela terminou em 3o lugar.", "Ela terminou em 3o lugar."],
        ["Ela ficou com o 3o lugar.", "Ela ficou com o 3º lugar."],
        ["Ela ficou com o 7.o lugar.", "Ela ficou com o 7.º lugar."],
        ["Saiu a 4.a edição do guia.", "Saiu a 4.ª edição do guia."],
        ["Os 10.os colocados ganham medalha.", "Os 10.ºs colocados ganham medalha."],
        ["Mora na 5.º avenida.", "Mora na 5.ª avenida."],
        ["Moro no 8° andar.", "Moro no 8º andar."],
        ["A cidade fica a 40 Km daqui.", "A cidade fica a 40 km daqui."],
        ["O terreno tem 300 m2 de área.", "O terreno tem 300 m² de área."],
        ["A fatura soma 12,480.75 reais.", "A fatura soma 12.480,75 reais."],
        ["Foram 3,215,900.5 votos válidos.", "Foram 3.215.900,5 votos válidos."],
        ["A mochila pesa 4.5 kg vazia.", "A mochila pesa 4,5 kg vazia."],
        ["O lago cobre 12.75 km² do parque.", "O lago cobre 12,75 km² do parque."],
        ["A febre chegou a 38,5º ontem.", "A febre chegou a 38,5° ontem."],
        ["A cidade fica a 23º sul do equador.", "A cidade fica a 23° sul do equador."],
        ["O navio seguiu a 40o N por dias.", "O navio seguiu a 40° N por dias."],
        ["Desenhe um ângulo de 45º.", "Desenhe um ângulo de 45°."],
        ["O farol fica a 23º 32' 51\" S.", "O farol fica a 23°\u202f32′\u202f51″ S."],
        ["A ilha fica a 8º15’ de latitude.", "A ilha fica a 8°\u202f15′ de latitude."],
        ["Ontem fez 31º, que calor.", "Ontem fez 31°, que calor."],
      ].filter(([typed, fixed]) => typed !== fixed) as Array<[string, string]>,
      neg: [
        "Ganhou a 2ª corrida e o 3º lugar.",
        "A febre chegou a 39º ontem.",
        "A reunião é às 14:30 h.",
        "Chegamos às 7:00h.",
        "Hoje fez 32 °C na praia.",
        "A água ferve a 100° no nível do mar.",
        "O modelo K2 foi lançado.",
        "Comprei um HB20 usado.",
        "A sala 2a fica no fim do corredor.",
        "Use a chave Km3 no arquivo.",
        "Instale a versão 4.12.3 do pacote.",
        "O roteador responde em 192.168.10.254 sempre.",
        "Custou 12.480,75 reais.",
        "A tabela 4.5 mostra os dados.",
        "Saímos às 17.40 h em ponto.",
        "Atualize para 1,234.5.6 hoje.",
        "Ele ficou em 3º lugar na prova.",
        "O 2º sul-americano a vencer foi ele.",
        "Ficou em 2º, atrás do João.",
        "Fez o 5º gol da partida.",
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
        ["Quero vender-lo ainda hoje.", "Quero vendê-lo ainda hoje."],
        ["Depois, analisa-mos os dados.", "Depois, analisamos os dados."],
        ["Daqui vê-mos a serra.", "Daqui vemos a serra."],
        ["Ela tentou abrir-la sem a chave.", "Ela tentou abri-la sem a chave."],
        ["Então fiz-los esperar.", "Então fi-los esperar."],
        ["Não diga-me isso agora.", "Não me diga isso agora."],
        ["Já eu conhecia-te naquela época.", "Já eu te conhecia naquela época."],
        ["Ele vai escreve-lo amanhã.", "Ele vai escrevê-lo amanhã."],
        ["Vim para ajuda-la.", "Vim para ajudá-la."],
        ["Não quero distrai-los.", "Não quero distraí-los."],
        ["Preciso compo-la hoje.", "Preciso compô-la hoje."],
        ["Muitos tinham-o como amigo.", "Muitos tinham-no como amigo."],
        ["Põe-as na gaveta.", "Põe-nas na gaveta."],
        ["Você precisa partir-o ao meio.", "Você precisa parti-lo ao meio."],
        ["E fez-o de maneira estranha.", "E fê-lo de maneira estranha."],
        ["Vamos comer-as agora.", "Vamos comê-las agora."],
        ["Todos eles deram-lhe razão.", "Todos eles lhe deram razão."],
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
        ["Sei que devo-lhe um favor.", "Sei que lhe devo um favor."],
        ["Quando vi-te na rua, corri.", "Quando te vi na rua, corri."],
        ["O livro que deram-me sumiu.", "O livro que me deram sumiu."],
        ["Ainda lembro-me daquele verão.", "Ainda me lembro daquele verão."],
        ["Também chamaram-nos para a festa.", "Também nos chamaram para a festa."],
        ["Se encontrá-la, avise a família.", "Se a encontrar, avise a família."],
        ["Quando vendê-los, guarde o recibo.", "Quando os vender, guarde o recibo."],
        ["Farei-te um bolo amanhã.", "Far-te-ei um bolo amanhã."],
        ["Direi-lhes tudo depois.", "Dir-lhes-ei tudo depois."],
      ],
      neg: [
        "Quero parti-lo ao meio.",
        "Ele dá-mos sempre que pode.",
        "Tu vende-lo caro.",
        "Amamo-la muito.",
        "Quero fazê-lo já.",
        "Ele fez-se de bobo.",
        "Venda porta-a-porta.",
        "O boca-a-boca funcionou.",
        "Nunca quis comprá-lo.",
        "O caso passou-se em 1990.",
        "Que bom revê-la!",
        "Poder-se-ia pensar o contrário.",
        "A loteria-relâmpago saiu.",
        "Ontem tirei-lhe uma foto.",
        "Ele queria-me ver.",
        "Ontem chamei-lhe a atenção.",
        "Para vendê-lo, faltava a nota.",
        "Preciso que, depois, liguem-me.",
        "O caso ficou-se por ali.",
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
        ["Foram adiado o jogo e a festa.", "Foi adiado o jogo e a festa."],
        ["Ela voltou a bebe depois da festa.", "Ela voltou a beber depois da festa."],
        ["Eles vão trazerem os documentos.", "Eles vão trazer os documentos."],
        ["As duas começaram a correrem cedo.", "As duas começaram a correr cedo."],
        ["O estudo trata numa séries de casos.", "O estudo trata numas séries de casos."],
        ["As notas vieram da papéis antigos.", "As notas vieram dos papéis antigos."],
        ["Foi vendidos os carros antigos.", "Foram vendidos os carros antigos."],
        [
          "Se forem necessário os dois testes, avise.",
          "Se forem necessários os dois testes, avise.",
        ],
        ["Talvez haja surgido dúvidas no caminho.", "Talvez hajam surgido dúvidas no caminho."],
        ["Pode ainda faltar mais cadeiras.", "Podem ainda faltar mais cadeiras."],
        ["Já comecei a lendo o livro.", "Já comecei a ler o livro."],
        ["Uma sapatos estão sujos.", "Uns sapatos estão sujos."],
        ["Tem muita pessoas aqui.", "Tem muitas pessoas aqui."],
        ["Este livros são meus.", "Estes livros são meus."],
        ["Ela voltou a pondo a mesa.", "Ela voltou a pôr a mesa."],
        ["O país tem duas milhões de árvores.", "O país tem dois milhões de árvores."],
        ["Vieram as milhares de fãs.", "Vieram os milhares de fãs."],
        ["Gastou uma milhão de reais.", "Gastou um milhão de reais."],
        ["Sobraram muitas poucas vagas.", "Sobraram muito poucas vagas."],
        [
          "A Júlia estava meia cansada depois da prova.",
          "A Júlia estava meio cansada depois da prova.",
        ],
        ["Segue anexo a planilha de custos.", "Segue anexa a planilha de custos."],
        ["Seguem anexo os recibos do mês.", "Seguem anexos os recibos do mês."],
        [
          "O documento foi entregue na prazos certos.",
          "O documento foi entregue nos prazos certos.",
        ],
        ["A culpa foi atribuída pelo testemunhas.", "A culpa foi atribuída pelas testemunhas."],
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
        ["A palavra está correto.", "A palavra está correta."],
        ["Elas são altos.", "Elas são altas."],
        ["A porta está fechado.", "A porta está fechada."],
        ["A comida estava muito gostoso.", "A comida estava muito gostosa."],
        ["Ele está cansada hoje.", "Ele está cansado hoje."],
        ["A reunião foi marcado para amanhã.", "A reunião foi marcada para amanhã."],
        ["Eu passeiam na praia.", "Eu passeio na praia."],
        ["Tu não falam inglês.", "Tu não falas inglês."],
        ["Nós come muito bem.", "Nós comemos muito bem."],
        ["Eu e a Rita viajam amanhã.", "Eu e a Rita viajamos amanhã."],
        ["Você falas muito.", "Você fala muito."],
        ["Eu comiam pouco.", "Eu comia pouco."],
        ["Nós comia ali todo dia.", "Nós comíamos ali todo dia."],
        ["Eles fiquei em casa.", "Eles ficaram em casa."],
        ["Eu conhece a cidade.", "Eu conheço a cidade."],
        ["As crianças da escola brinca no pátio.", "As crianças da escola brincam no pátio."],
        ["O preço das passagens aumentaram ontem.", "O preço das passagens aumentou ontem."],
        ["Meus primos de Recife chega amanhã.", "Meus primos de Recife chegam amanhã."],
        ["Já aconteceu erros parecidos.", "Já aconteceram erros parecidos."],
        ["Falta muitos detalhes no projeto.", "Faltam muitos detalhes no projeto."],
        ["Tem existido muitas dúvidas.", "Têm existido muitas dúvidas."],
        ["Pode nunca mais sobrar tantas vagas.", "Podem nunca mais sobrar tantas vagas."],
        ["Existe pessoas boas.", "Existem pessoas boas."],
        ["Esta foi a razão pelo qual saí.", "Esta foi a razão pela qual saí."],
        ["Foi um dos motivos pelas quais saí.", "Foi um dos motivos pelos quais saí."],
        ["Aqui vende-se casas antigas.", "Aqui vendem-se casas antigas."],
        ["Aluga-se apartamentos.", "Alugam-se apartamentos."],
        ["Estamos muitos contentes.", "Estamos muito contentes."],
        ["Elas estão muitas cansadas.", "Elas estão muito cansadas."],
        ["Ele sempre segui os meus passos.", "Ele sempre seguiu os meus passos."],
        ["É necessário uma revisão completa.", "É necessária uma revisão completa."],
        ["Será proibido as visitas no domingo.", "Serão proibidas as visitas no domingo."],
        ["Foi necessária um novo teste.", "Foi necessário um novo teste."],
      ],
      neg: [
        "Dirige-se as mesas do fundo sem pressa.",
        "O destaque foi convidados de honra.",
        "Ele passa a bola para o colega.",
        "Os heróis voltaram cansados.",
        "As crianças são resultado de muito esforço.",
        "Eles são cara de pau.",
        "Os documentos foram enviados ontem.",
        "Maria tem faltado aulas demais.",
        "Foram dados os avisos.",
        "A cidade fica a milhares de quilômetros.",
        "Duas mil pessoas vieram ao show.",
        "Segue anexo o contrato assinado.",
        "Segue anexo a este e-mail o contrato.",
        "Segue em anexo a planilha.",
        "Este é o livro que comprei.",
        "A pé são duas horas.",
        "Muito obrigado pela ajuda.",
        "Abra o módulo no contas a receber.",
        "Ele continua a seguindo pela rua.",
        "Passou a tarde trabalhando.",
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
        "A gente está cansado.",
        "A cidade é palco de festivais.",
        "A crise é resultado de erros.",
        "A modelo está cansada.",
        "As borboletas são ótimos indicadores.",
        "Ela estava junto à porta.",
        "Ele não é nada além de um tolo.",
        "As pessoas ficam demasiado imersas.",
        "Ela e eu trabalhamos juntos.",
        "Estes nós representam ligações.",
        "Elas nada sabem.",
        "Ele sabe mais do que eu conseguiria.",
        "Eu cria em fadas quando criança.",
        "Ela trabalho é tudo.",
        "Eu estou cansada.",
        "Os livros de capa dura custam caro.",
        "A maioria dos alunos passaram.",
        "Um bilhão de pessoas falam inglês.",
        "As regras nas quais se baseia o texto.",
        "A chance de prosseguir trilhas é pequena.",
        "Falta de dinheiro atrapalha.",
        "A polícia chegou alguns instantes depois.",
        "Ocorreu diversas vezes.",
        "Basta pensarmos nisso.",
        "Ele tem existido em paz.",
        "A empresa na qual trabalho fechou.",
        "O estudo ou a metodologia pelo qual foi feito.",
        "Vende-se esta casa.",
        "Leva-se anos para aprender.",
        "Leia-se superstições.",
        "Ele sai cedo.",
        "Estamos muitos aqui.",
        "São muitos interessados no curso.",
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
        ["Vivem em regime de co-dependência.", "Vivem em regime de codependência."],
        ["O pacto de não-agressão foi assinado.", "O pacto de não agressão foi assinado."],
        ["São penta-campeões do mundo.", "São pentacampeões do mundo."],
        ["As crenças pan-teístas são antigas.", "As crenças panteístas são antigas."],
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
        "O time pan-americano venceu.",
        "A circum-navegação durou anos.",
        "Comprei um não-me-toques.",
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
    ["Por exemplo hoje choveu muito.", "Por exemplo, hoje choveu muito."],
    ["Podemos sim vencer o jogo.", "Podemos, sim, vencer o jogo."],
    ["Eles vão, sim cumprir o prazo.", "Eles vão, sim, cumprir o prazo."],
    ["Você deve sim, pedir desculpas.", "Você deve, sim, pedir desculpas."],
    ["Muito bem, sim senhor!", "Muito bem, sim, senhor!"],
    ["Não senhora, não foi isso.", "Não, senhora, não foi isso."],
    ["Planejamos tudo mas, no fim, choveu.", "Planejamos tudo, mas, no fim, choveu."],
    ["Atenciosamente\nMarta", "Atenciosamente,\nMarta"],
    ["Com os melhores cumprimentos.", "Com os melhores cumprimentos,"],
    ["Prezado Senhor Silva\nEscrevo para", "Prezado Senhor Silva,\nEscrevo para"],
    ["Caro Doutor Santos!", "Caro Doutor Santos,"],
    ["O que é que aconteceu aqui.", "O que é que aconteceu aqui?"],
    ["Como é que vocês chegaram tão cedo.", "Como é que vocês chegaram tão cedo?"],
    ["Chegou cedo e além disso, trouxe o bolo.", "Chegou cedo e, além disso, trouxe o bolo."],
    ["Ficou caro, e, no fundo ninguém ligou.", "Ficou caro, e, no fundo, ninguém ligou."],
    ["Correu muito, mas ao mesmo tempo, sorriu.", "Correu muito, mas, ao mesmo tempo, sorriu."],
    ["Ela estuda e, em geral trabalha à noite.", "Ela estuda e, em geral, trabalha à noite."],
    ["Feliz natal Rui!", "Feliz natal, Rui!"],
    ["Bem-vinda Joana.", "Bem-vinda, Joana."],
    ["Gosto de praia mas não sei nadar.", "Gosto de praia, mas não sei nadar."],
    ["O carro é velho mas é confiável.", "O carro é velho, mas é confiável."],
  ])("fixes %p", (text, expected) => {
    expect(repaired("portugueseCommas", text)).toBe(expected);
    expect(findings("portugueseCommas", expected)).toEqual([]);
    expect(findings("portugueseCommas", text, "es_ES")).toEqual([]);
  });
  test.each([
    "Vários países, por exemplo o Brasil, aderiram.",
    "Não só ele mas também ela veio.",
    "Simples mas é bom.",
    "Vai mas é estudar, menino!",
    "A lei vale, com efeito retroativo a maio.",
    "Ele estava portanto pronto.",
    "Mas na verdade, ninguém sabe.",
    "Frutas como por exemplo, maçãs.",
    "Bom dia a todos.",
    "Ele disse sim ao pedido de casamento.",
    "Podemos, sim, vencer o jogo.",
    "O sim senhor dele soou falso demais.",
    "Não só ele, mas, sobretudo, ela.",
    "Bom dia Brasil é um telejornal.",
    "Disse que não, não quero.",
    "Não via nada além disso, nem queria.",
    "Aumenta muito, por exemplo se dobrar a carga.",
    "Por favor de quem?",
    "Atenciosamente, João.",
    "Caro amigo, tudo bem?",
    "Prezado Senhor,",
    "Não sei o que é que aconteceu.",
    "A carta terminava com atenciosamente e a assinatura.",
    "Como é que ele descobriu ainda é um mistério.",
    "O que é que ele quer eu não sei.",
    "A pedra caiu no fundo, e sumiu.",
    "Trabalha e ao mesmo tempo estuda.",
    "Chegaram ao mesmo tempo, e saíram juntos.",
    "E além disso, ninguém reclamou.",
    "Os carros, em geral caros, venderam bem.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseCommas", text)).toEqual([]);
  });
});

describe("infinitive after an auxiliary", () => {
  test.each([
    ["As crianças vão dormi cedo hoje.", "As crianças vão dormir cedo hoje."],
    ["Você pode fala mais devagar?", "Você pode falar mais devagar?"],
    ["Amanhã vou come na casa da avó.", "Amanhã vou comer na casa da avó."],
    ["Eles não conseguem termina a obra.", "Eles não conseguem terminar a obra."],
    ["Ela vai lembra-se disso.", "Ela vai lembrar-se disso."],
    ["Quero bebe um suco gelado.", "Quero beber um suco gelado."],
    ["Você deve escreve o nome aqui.", "Você deve escrever o nome aqui."],
    ["Ele tentou subi no muro.", "Ele tentou subir no muro."],
    ["Precisamos decidi hoje.", "Precisamos decidir hoje."],
  ])("fixes %p", (text, expected) => {
    expect(repaired("portugueseAgreement", text)).toBe(expected);
    expect(findings("portugueseAgreement", expected)).toEqual([]);
  });
  test.each([
    "Vou para casa depois da aula.",
    "Você quer ajuda com as malas?",
    "Ele deve conta ao banco.",
    "Ela vai bem, obrigada.",
    "Vamos agora mesmo.",
    "Isso não vai nada bem.",
    "Quero parte do lucro.",
    "Ele quer leite com café.",
    "Você deve sorte a ela.",
    "Tentou de novo à tarde.",
    "Precisa de frete grátis.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseAgreement", text)).toEqual([]);
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
    // A part above 31 is not a day or a month in any order.
    ["A consulta ficou para 32/04/2020.", "32/04/2020"],
    ["O contrato termina em 15/45/2027.", "15/45/2027"],
    ["Pagamos a taxa em 00/05/2021.", "00/05/2021"],
    ["Ele chegou em 10/00/2019.", "10/00/2019"],
    // A dotted date after a date cue: a part above 31 is a wrong day, not a version.
    ["A data é 32.04.2020.", "32.04.2020"],
    ["Ele chegou em 15.45.2020.", "15.45.2020"],
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
    "Escreva no campo 99/99/9999 se não souber.",
    "Use o formato 99/99/99 no cartão.",
    "Baixe a versão 2.45.2020 do programa.",
    "Instale o pacote 2.45.2020 hoje.",
    "Atualize para a versão 10.13.2024.",
    "Faltam 31 mais coisas.",
    "Ela nasceu em 29/02/2000.",
    "A prova é na sexta-feira, 2 de outubro de 2026.",
    "Abrimos no domingo (dia 4/10/2026) cedo.",
    "Na quarta, 7 de outubro, saímos.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseDates", text)).toEqual([]);
  });
  test.each([
    [
      "A prova é na quinta-feira, 2 de outubro de 2026.",
      "quinta-feira, 2",
      ["sexta-feira, 2", "quinta-feira, 1"],
    ],
    [
      "Abrimos no sábado (dia 4/10/2026) cedo.",
      "sábado (dia 4",
      ["domingo (dia 4", "sábado (dia 3"],
    ],
    ["Seg, 6 out 2026: reunião.", "Seg, 6", ["Terça-feira, 6", "Seg, 5"]],
  ])("checks the weekday in %p", (text, typed, alternatives) => {
    const [finding, ...rest] = findings("portugueseDates", text);
    expect(rest).toEqual([]);
    expect(finding.original).toBe(typed);
    expect(finding.alternatives.map((alternative) => alternative.preview)).toEqual(alternatives);
    expect(finding.requiresChoice).toBe(true);
  });
});

describe("cujo, esta a + infinitive and bem-/mal- compounds", () => {
  test.each([
    [
      "portugueseAgreement",
      "Conheci a autora cuja livro ganhou o prêmio.",
      "Conheci a autora cujo livro ganhou o prêmio.",
    ],
    [
      "portugueseAgreement",
      "Visitei o bairro cujo praça foi reformada.",
      "Visitei o bairro cuja praça foi reformada.",
    ],
    [
      "portugueseConfusions",
      "A equipa esta a preparar o relatório.",
      "A equipa está a preparar o relatório.",
    ],
    [
      "portugueseConfusions",
      "O motor esta a aquecer-se demais.",
      "O motor está a aquecer-se demais.",
    ],
    [
      "englishPhraseCorrections",
      "Era o aluno melhor educado da turma.",
      "Era o aluno mais bem-educado da turma.",
    ],
    [
      "englishPhraseCorrections",
      "Hoje acordou pior humorada que ontem.",
      "Hoje acordou mais mal-humorada que ontem.",
    ],
  ] as Array<[CatalogRuleId, string, string]>)("%s: %p", (ruleId, text, fixed) => {
    expect(repaired(ruleId, text)).toBe(fixed);
  });
  test.each([
    ["portugueseAgreement", "A cidade cuja população cresce pede mais escolas."],
    ["portugueseAgreement", "Uma empresa cujo principal objetivo é o lucro."],
    ["portugueseConfusions", "Esta é a casa; esta a que me referi ontem."],
    ["portugueseConfusions", "Prefiro esta à outra."],
    ["englishPhraseCorrections", "Ele é o mais bem-educado da turma."],
  ] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, text) => {
    expect(findings(ruleId, text)).toEqual([]);
  });
});

describe("a contracted article before a demonstrative", () => {
  test.each([
    ["Foi o que senti na aquela hora.", "Foi o que senti naquela hora."],
    ["Moro do este lado do rio.", "Moro deste lado do rio."],
    ["Ninguém falou no isso depois.", "Ninguém falou nisso depois."],
    ["Pedi ajuda ao aquele vizinho.", "Pedi ajuda àquele vizinho."],
  ])("%p -> %p", (text, fixed) => {
    expect(repaired("englishPhraseCorrections", text)).toBe(fixed);
  });
  test("da before a demonstrative may be the verb dá", () => {
    const [finding] = findings("englishPhraseCorrections", "Ele da aquela risada alta.");
    expect(finding.alternatives.map((a) => a.preview)).toEqual(["daquela", "dá aquela"]);
    expect(finding.requiresChoice).toBe(true);
  });
});

describe("Portuguese opening comma (styleIntroductoryComma, opt-in)", () => {
  test.each([
    ["Por favor feche a porta.", "Por favor, feche a porta."],
    ["Felizmente ninguém se feriu.", "Felizmente, ninguém se feriu."],
    ["Choveu. Além disso fez frio.", "Choveu. Além disso, fez frio."],
    ["Na verdade ele nem apareceu.", "Na verdade, ele nem apareceu."],
    ["Enfim chegamos ao topo.", "Enfim, chegamos ao topo."],
  ])("%p -> %p", (text, fixed) => {
    expect(repaired("styleIntroductoryComma", text)).toBe(fixed);
    expect(findings("styleIntroductoryComma", text, "es_ES")).toEqual([]);
  });
  test.each([
    "Por favor, feche a porta.",
    "Por favor de quem foi isso?",
    "Ele felizmente veio.",
    "Além disso tudo, havia o frete.",
    "Enfim.",
  ])("%p stays clean", (text) => {
    expect(findings("styleIntroductoryComma", text)).toEqual([]);
  });
});

describe("Portuguese wording advice (stylePhrasing)", () => {
  // Idioms and hidden verbs are listed by infinitive; the plain wording follows the tense.
  test.each([
    ["No fim, eles pagaram o pato pelo erro.", "No fim, eles levaram a culpa pelo erro."],
    ["Ela pôs lenha na fogueira ontem.", "Ela agravou a situação ontem."],
    ["Os técnicos chegaram a uma conclusão.", "Os técnicos concluíram."],
    ["O time trabalhou de forma rápida.", "O time trabalhou rapidamente."],
    ["Ele sempre puxa o saco do chefe.", "Ele sempre bajula o chefe."],
    ["Eles deram início à reunião.", "Eles iniciaram a reunião."],
    ["Ele perdeu as estribeiras na reunião.", "Ele descontrolou-se na reunião."],
    ["Quero dar uma olhada no relatório.", "Quero olhar o relatório."],
  ])("%p -> %p", (text, fixed) => {
    expect(repaired("stylePhrasing", text)).toBe(fixed);
  });
  test.each([
    "A temperatura pode descer abaixo de zero.",
    "A galera atracou no porto antes do amanhecer.",
    "É mais fácil acreditar numa boa mentira.",
    "Eles abriram os olhos de manhã.",
    "O pintor deu uma mão de tinta na parede.",
  ])("%p stays clean", (text) => {
    expect(findings("stylePhrasing", text)).toEqual([]);
  });
  // A noun that hides a verb after "fazer", "realizar" or "efetuar", and wordy frames.
  test.each([
    ["A equipe fez a revisão do contrato.", "A equipe revisou o contrato."],
    ["Amanhã vamos realizar a coleta das amostras.", "Amanhã vamos coletar as amostras."],
    ["Os sócios efetuaram o encerramento da conta.", "Os sócios encerraram a conta."],
    ["Faço a digitação de textos em casa.", "Digito textos em casa."],
    [
      "O novo sistema torna possível o acesso remoto.",
      "O novo sistema possibilita o acesso remoto.",
    ],
    ["O vento tornou mais difícil a travessia.", "O vento dificultou a travessia."],
    ["As vendas perfazem um total de mil reais.", "As vendas totalizam mil reais."],
    ["Moramos numa rua em que não há calçada.", "Moramos numa rua sem calçada."],
    ["Estou em desacordo com a proposta.", "Discordo da proposta."],
    ["O professor repetiu de novo a lição.", "O professor repetiu a lição."],
    ["Eles expulsaram para fora o intruso.", "Eles expulsaram o intruso."],
    ["A razão foi porque choveu.", "A razão foi que choveu."],
    ["Tirou de dentro da bolsa a chave.", "Tirou da bolsa a chave."],
    ["O projeto não saiu do papel.", "O projeto não foi realizado."],
    ["Na reunião, eles trocaram farpas.", "Na reunião, eles discutiram."],
    ["Levantei-me com o pé esquerdo hoje.", "Comecei mal o dia hoje."],
  ])("%p -> %p", (text, fixed) => {
    expect(repaired("stylePhrasing", text)).toBe(fixed);
  });
  test.each([
    "Ela fez a Análise Combinatória no segundo ano.",
    "Fizemos a mala de viagem.",
    "Vamos sair com o fim de semana chegando.",
    "Não pensei nisso de forma alguma.",
    "Ele faz a coleta seletiva toda semana.",
    "A empresa realiza a seleção em março.",
    "Sem luz, a leitura se torna impossível para mim.",
    "Com o tempo, tudo vai-se tornar mais fácil.",
    "A chuva tornou mais difícil com o barro.",
    "O perito deu valor ao imóvel.",
    "Ele andou com os pés descalços.",
    "Não há outras alternativas além desta.",
    "Coitado, ele foi pego de surpresa.",
    "O mergulhador trouxe a boia até a margem.",
  ])("%p stays clean", (text) => {
    expect(findings("stylePhrasing", text)).toEqual([]);
  });
});

describe("Portuguese pleonasm tails that head a de phrase (stylePhrasing)", () => {
  test.each([
    ["O cavalo recuou para trás assustado.", "O cavalo recuou assustado."],
    ["Os atletas avançaram para a frente sem medo.", "Os atletas avançaram sem medo."],
    ["Ela adiou para depois a decisão.", "Ela adiou a decisão."],
    ["O técnico previu antes a derrota.", "O técnico previu a derrota."],
    ["Planejamos com antecedência a festa.", "Planejamos a festa."],
  ])("%p -> %p", (text, fixed) => {
    expect(repaired("stylePhrasing", text)).toBe(fixed);
  });
  // The tail starts "para trás de" (behind), "para a frente de" (in front of) and the like.
  test.each([
    "O gato recuou para trás da poltrona.",
    "A banda avançou para a frente do palco.",
    "O carro avançou para frente dum caminhão.",
    "Ela adiou para depois do almoço.",
    "O analista previu antes dos colegas a queda.",
    "Planejamos com antecedência de dois meses.",
    "O governo projetou para o futuro das cidades.",
    "O médico introduziu dentro da veia um cateter.",
    "Ela anexou junto do contrato a fatura.",
  ])("%p stays clean", (text) => {
    expect(findings("stylePhrasing", text)).toEqual([]);
  });
});

describe("a figure that opens a sentence (styleSpelledNumbers, opt-in)", () => {
  const spelled = (text: string) =>
    findings("styleSpelledNumbers", text).map((d) => d.alternatives.map((a) => a.preview));
  test.each([
    ["12 alunos faltaram à prova.", ["Doze"]],
    ["Choveu muito. 3 casas caíram.", ["Três"]],
    ["1 pessoa ficou ferida.", ["Uma"]],
    ["200 cidades votaram ontem.", ["Duzentas"]],
    ["21 dias se passaram.", ["Vinte e um"]],
    ["2 sistemas falharam ontem.", ["Dois", "Duas"]],
    ["105 livros chegaram hoje.", ["Cento e cinco"]],
  ])("%p -> %p", (text, forms) => {
    expect(spelled(text)).toEqual([forms]);
  });
  test.each([
    "Chegaram 12 alunos ontem.",
    "2 xícaras de farinha",
    "2014 foi um ano difícil.",
    "15 de março é feriado.",
    "10 kg de arroz bastam.",
    "1. Introdução ao tema.",
  ])("%p stays clean", (text) => {
    expect(findings("styleSpelledNumbers", text)).toEqual([]);
  });
});

test("an article and a possessive before a noun of either gender offer both repairs", () => {
  const [finding] = findings("portugueseAgreement", "Ele é o último da seu estirpe.");
  expect(finding.alternatives.map((a) => a.preview)).toEqual(["do seu", "da sua"]);
  // "-écie" tells the gender, so only the possessive is wrong.
  const [known] = findings("portugueseAgreement", "Ele é o último da seu espécie.");
  expect(known.alternatives.map((a) => a.preview)).toEqual(["sua"]);
  expect(finding.requiresChoice).toBe(true);
});

test("a user-dictionary word on the determiner silences noun agreement", () => {
  const text = "Os carro estão na garagem. O nossa equipe venceu.";
  expect(findings("portugueseAgreement", text).length).toBe(2);
  expect(findings("portugueseAgreement", text, LANG, ["os", "o"])).toEqual([]);
});

test("the committed paronym and verb tables match pt_BR.dic/.aff (bun run generate:lexicons portuguese)", async () => {
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

test("grouped decimals are prose; versions and addresses stay technical", () => {
  const technical = (text: string) =>
    prepareReview(
      { id: "pt", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      { enabledRules: [], lang: LANG, userDictionary: [], insertSpaceAfterAutocomplete: true },
    )
      .protectedRanges.filter((range) => range.reason === "technical")
      .map((range) => text.slice(range.start, range.end));
  expect(technical("Pagou 12,480.75 e 3,215,900.5 no total.")).toEqual([]);
  expect(technical("Use 4.12.3 em 192.168.10.254 ou 1,234.5.6.")).toEqual([
    "4.12.3",
    "192.168.10.254",
    "1,234.5.6",
  ]);
});

// "-ema" and "-oma" are mostly masculine, but "soma", "gema", "goma", "redoma" are feminine:
// the ending must not decide their gender. "mantra" is masculine although it ends in -a.
test.each([
  "Pagamos uma soma alta pelo carro.",
  "O anel tem uma gema verde.",
  "A lâmpada fica sob uma redoma.",
  "Esta é a soma pela qual trabalhamos.",
  "Ela canta um mantra antes de dormir.",
])("portugueseAgreement reads the gender of -ma nouns in %p", (text) => {
  expect(findings("portugueseAgreement", text)).toEqual([]);
});

test("portugueseAgreement still fixes the article of a feminine -ma noun", () => {
  expect(repaired("portugueseAgreement", "Pagamos um soma alta.")).toBe("Pagamos uma soma alta.");
});

describe("Portuguese word choice and stressed quê (portugueseConfusions)", () => {
  test.each([
    ["Preciso afear o machado antes do inverno.", "Preciso afiar o machado antes do inverno."],
    ["Ao fim da tarde, arrearam a bandeira.", "Ao fim da tarde, arriaram a bandeira."],
    ["Ela come os comprimidos depois do almoço.", "Ela toma os comprimidos depois do almoço."],
    ["A feira tomará lugar no centro da cidade.", "A feira terá lugar no centro da cidade."],
    ["Fui pedir um concelho ao meu avô.", "Fui pedir um conselho ao meu avô."],
    ["Assistimos ao conserto da banda no sábado.", "Assistimos ao concerto da banda no sábado."],
    ["A amostra de fotografia abre hoje.", "A mostra de fotografia abre hoje."],
    ["Já estou contanto com a sua ajuda.", "Já estou contando com a sua ajuda."],
    ["Ontem estiveram de voltar mais cedo.", "Ontem tiveram de voltar mais cedo."],
    ["Tenho grande a preço pelo trabalho dela.", "Tenho grande apreço pelo trabalho dela."],
    ["Responda o mas breve possível.", "Responda o mais breve possível."],
    ["A fábrica teve percas de produção.", "A fábrica teve perdas de produção."],
    ["Ela sempre trás um bolo para nós.", "Ela sempre traz um bolo para nós."],
    ["O próximo senso será em breve.", "O próximo censo será em breve."],
    ["Só lhe peco paciência.", "Só lhe peço paciência."],
    ["Os passageiros já estão abordo do navio.", "Os passageiros já estão a bordo do navio."],
    ["Se caso eles precisem, liguem.", "Caso eles precisem, liguem."],
    ["Você falou com quem? Com que?", "Você falou com quem? Com quê?"],
    ["Levamos copos, pratos e etc.", "Levamos copos, pratos, etc."],
    ["Trouxe livros, cadernos, e. t. c.", "Trouxe livros, cadernos, etc."],
  ])("flags %p", (text, expected) => {
    expect(repaired("portugueseConfusions", text)).toBe(expected);
  });
  test.each([
    "Ele afiou a faca ontem.",
    "Vamos arrear o cavalo cedo.",
    "Ela comeu o bolo inteiro.",
    "O convidado da festa tomou lugar na mesa.",
    "O concelho de Sintra aprovou a obra.",
    "Levei o carro ao conserto.",
    "O conserto do piano custou caro.",
    "Mandei uma amostra de sangue ao laboratório.",
    "Contanto que chegue cedo, tudo bem.",
    "Esteve de azar o mês inteiro.",
    "Comprei o carro a preço de custo.",
    "Não percas de vista o teu objetivo.",
    "Olhou para trás o tempo todo.",
    "Tem um novo senso de urgência.",
    "Eu abordo da mesma forma esse tema.",
    "Ele se caso com ela, fica feliz.",
    "O que você quer?",
    "Levamos copos, pratos, etc.",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseConfusions", text)).toEqual([]);
  });
});

describe("Portuguese future subjunctive without a subject (portugueseAgreement)", () => {
  test.each([
    ["Eu ligo quando poder.", "Eu ligo quando puder."],
    ["Responda assim que ter tempo.", "Responda assim que tiver tempo."],
    ["Pode vir sempre que querer.", "Pode vir sempre que quiser."],
    ["Mande o texto logo que fazer a revisão.", "Mande o texto logo que fizer a revisão."],
    ["Saímos depois que estar tudo pronto.", "Saímos depois que estiver tudo pronto."],
  ])("flags %p", (text, expected) => {
    expect(repaired("portugueseAgreement", text)).toBe(expected);
  });
  test.each([
    "Ninguém sabe quando parar.",
    "Quando usar o hífen?",
    "Ela perguntou quando fazer a inscrição.",
    "E agora, quando ir ao médico?",
    "Até quando esperar por ele?",
  ])("leaves %p alone", (text) => {
    expect(findings("portugueseAgreement", text)).toEqual([]);
  });
});

describe("Portuguese units, years and mark spacing", () => {
  test.each([
    [
      "portugueseNumberFormat",
      "A sede foi fundada no ano de 1.957.",
      "A sede foi fundada no ano de 1957.",
    ],
    ["portugueseNumberFormat", "Tudo mudou em março de 2.004.", "Tudo mudou em março de 2004."],
    [
      "portugueseNumberFormat",
      "O site recebeu 2,300,450 visitas.",
      "O site recebeu 2.300.450 visitas.",
    ],
    ["portugueseNumberFormat", "Ele governou de 1998 –2006.", "Ele governou de 1998–2006."],
    [
      "portugueseNumberFormat",
      "A água ferve a 100° C ao nível do mar.",
      "A água ferve a 100 °C ao nível do mar.",
    ],
    ["portugueseNumberFormat", "O hélio liquefaz a 4 ºK.", "O hélio liquefaz a 4 K."],
    [
      "commaPeriodSpacing",
      "Temos dois caminhos : ficar ou partir.",
      "Temos dois caminhos: ficar ou partir.",
    ],
    ["commaPeriodSpacing", "Ela pensou...depois desistiu.", "Ela pensou... depois desistiu."],
    ["commaPeriodSpacing", "E assim termina a história …", "E assim termina a história…"],
    ["measurementUnitFormatting", "O anexo tem 12MB e passa.", "O anexo tem 12 MB e passa."],
    ["portugueseTypographyStyle", "A obra é do século 19.", "A obra é do século XIX."],
    ["englishTypography", "Viveu entre 1890 - 1950.", "Viveu entre 1890–1950."],
    ["englishTypography", "O valor é 3,2 +- 0,1 mm.", "O valor é 3,2 ± 0,1 mm."],
  ] as Array<[CatalogRuleId, string, string]>)("%s fixes %p", (ruleId, text, expected) => {
    expect(repaired(ruleId, text)).toBe(expected);
  });
  test.each([
    ["portugueseNumberFormat", "Foram 1.500 pessoas em 1.989 casos registrados."],
    ["portugueseNumberFormat", "O preço caiu para 5,500 reais."],
    ["portugueseNumberFormat", "Ele governou de 1998 – 2006."],
    ["portugueseNumberFormat", "Está fazendo 22 °C lá fora."],
    ["commaPeriodSpacing", "Veja History of the Caribbean : a study."],
    ["commaPeriodSpacing", "Ficou triste :( mas passou."],
    ["commaPeriodSpacing", "… e assim foi o …"],
    ["commaPeriodSpacing", "Ela pensou... Depois desistiu."],
    ["measurementUnitFormatting", "O anexo tem 12 MB e passa."],
    ["portugueseTypographyStyle", "O século 2,5 não existe."],
    ["englishTypography", "Festival de Rock 2014 - 31/10/2014"],
    ["englishTypography", "Opções: (a) um, (b) dois, (c) 2014 itens."],
  ] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, text) => {
    expect(findings(ruleId, text)).toEqual([]);
  });
});

describe("Portuguese formal register (stylePhrasing, opt-in)", () => {
  test.each([
    ["Eu acho que o prazo é curto.", "Eu considero que o prazo é curto."],
    ["A loja baixou os preços em maio.", "A loja reduziu os preços em maio."],
    ["A família passou muitas privações.", "A família passou por muitas privações."],
    ["Ela pegou uma infecção no hospital.", "Ela contraiu uma infecção no hospital."],
    ["Pegaram os resultados no laboratório.", "Obtiveram os resultados no laboratório."],
    ["Arrumei um emprego novo.", "Consegui um emprego novo."],
    ["O gerente fez um orçamento detalhado.", "O gerente elaborou um orçamento detalhado."],
    ["O diretor não deixou que o grupo entrasse.", "O diretor não permitiu que o grupo entrasse."],
    ["O cliente pediu esclarecimentos ao banco.", "O cliente solicitou esclarecimentos ao banco."],
    ["Não chateie a vizinha.", "Não incomode a vizinha."],
    ["Ninguém atura tanto barulho.", "Ninguém suporta tanto barulho."],
    ["Pegaram o trem das seis.", "Tomaram o trem das seis."],
    ["Joguei fora os papéis velhos.", "Descartei os papéis velhos."],
    ["O livro fala dos temas da época.", "O livro aborda os temas da época."],
    ["Ninguém mexeu no contrato.", "Ninguém alterou o contrato."],
    ["Visto sob o ponto de vista legal, está certo.", "Visto do ponto de vista legal, está certo."],
    ["Segue o arquivo, segundo combinado.", "Segue o arquivo, conforme combinado."],
    ["O debate girou em volta do orçamento.", "O debate girou em torno do orçamento."],
    ["Foi uma boa pergunta.", "Foi uma pergunta pertinente."],
    ["Esse argumento é bom.", "Esse argumento é pertinente."],
  ])("flags %p", (text, expected) => {
    expect(repaired("stylePhrasing", text)).toBe(expected);
  });
  test.each([
    "Você acha que vai chover?",
    "Ela achou a chave no carro.",
    "Baixei o arquivo ontem.",
    "Passei por dificuldades.",
    "Pegou o livro na estante.",
    "A bota nova apertou.",
    "A fala do ministro foi curta.",
    "O segundo previsto chegou cedo.",
    "Deixou a casa cedo.",
    "Ele pediu demissão ontem.",
    "O bolo de ontem estava bom.",
  ])("leaves %p alone", (text) => {
    expect(findings("stylePhrasing", text)).toEqual([]);
  });
});
