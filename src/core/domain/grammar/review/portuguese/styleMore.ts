/**
 * More opt-in wording advice for the `pt` style table (stylePhrasing): wordy frames with a
 * shorter form, pleonasms and worn idioms. Data only: style.ts conjugates the verb rows (the
 * first word is an infinitive, "a|b" lists heads that share the rest) and expands "de*" and the
 * like into each article.
 */
type Row = [string, string | string[]];

/** Verb frames with a shorter verb. */
export const CONCISE_VERBS: Row[] = [
  ["tornar possível", ["possibilitar", "permitir"]],
  ["tornar impossível", "impossibilitar"],
  ["tornar mais fácil", "facilitar"],
  ["tornar mais difícil", "dificultar"],
  ["tornar mais forte", "fortalecer"],
  ["tornar mais fraco", "enfraquecer"],
  ["tornar mais claro", "esclarecer"],
  ["tornar mais rápido", "acelerar"],
  ["dar valor a*", "valorizar *"],
  ["dar um exemplo de*", "exemplificar *"],
  ["dar exemplos de*", "exemplificar *"],
  ["dar destaque a*", "destacar *"],
  ["dar ênfase a*", "enfatizar *"],
  ["dar preferência a*", "preferir *"],
  ["dar uma ajuda", "ajudar"],
  ["dar a sua opinião", "opinar"],
  ["fazer uso de*", "usar *"],
  ["passar através de*", "atravessar *"],
  ["correr o risco de", "arriscar-se a"],
  ["ficar parado no tempo", "estagnar"],
  ["vir à mente", "ocorrer"],
  ["vir à cabeça", "ocorrer"],
  ["perfazer um total de", "totalizar"],
  ["somar um total de", "totalizar"],
  ["ter o nome de", "chamar-se"],
  ["fazer uma crítica a*", "criticar *"],
  ["fazer críticas a*", "criticar *"],
  ["fazer um elogio a*", "elogiar *"],
  ["fazer elogios a*", "elogiar *"],
  ["fazer um comentário sobre", "comentar"],
  ["fazer uma reclamação", "reclamar"],
  ["fazer um esforço para", "esforçar-se para"],
  ["estar em desacordo com*", "discordar de*"],
  ["fazer um teste de*", "testar *"],
];

/**
 * "fazer a seleção de" -> "selecionar": a noun that names the action of a regular verb, after
 * "fazer", "realizar" or "efetuar" (the actionNouns check in style.ts).
 */
export const ACTION_NOUNS = new Map(
  (
    "a seleção:selecionar a coleta:coletar a distribuição:distribuir a preparação:preparar " +
    "a aplicação:aplicar a configuração:configurar a remoção:remover a inclusão:incluir " +
    "a exclusão:excluir a alteração:alterar a modificação:modificar a identificação:identificar " +
    "a classificação:classificar a elaboração:elaborar a execução:executar " +
    "a programação:programar a negociação:negociar a reformulação:reformular " +
    "a validação:validar a aprovação:aprovar a utilização:utilizar a marcação:marcar " +
    "a digitação:digitar a conversão:converter a edição:editar a publicação:publicar " +
    "a gravação:gravar a emissão:emitir a solicitação:solicitar a apuração:apurar " +
    "a análise:analisar a avaliação:avaliar a verificação:verificar a correção:corrigir " +
    "a instalação:instalar a organização:organizar a limpeza:limpar a entrega:entregar " +
    "a divulgação:divulgar a contratação:contratar a criação:criar a atualização:atualizar " +
    "a implementação:implementar a revisão:revisar a leitura:ler a descrição:descrever " +
    "o planejamento:planejar o agendamento:agendar o orçamento:orçar o conserto:consertar " +
    "o preenchimento:preencher o tratamento:tratar o armazenamento:armazenar " +
    "o processamento:processar o desenvolvimento:desenvolver o mapeamento:mapear " +
    "o lançamento:lançar o encerramento:encerrar o recebimento:receber " +
    "o fornecimento:fornecer o treinamento:treinar o ajuste:ajustar o cálculo:calcular " +
    "o cadastro:cadastrar o registro:registrar o envio:enviar o acompanhamento:acompanhar " +
    "o monitoramento:monitorar o pagamento:pagar"
  )
    .split(/ (?=[ao] )/)
    .map((entry) => entry.split(":") as [string, string]),
);

/** Fixed wordy phrases with a shorter form. */
export const CONCISE_FIXED: Row[] = [
  ["devido ao fato de que", "porque"],
  ["em virtude do fato de que", "porque"],
  ["apesar do fato de que", "embora"],
  ["não obstante o fato de que", "embora"],
  ["com a finalidade de", "para"],
  ["com o objetivo de", "para"],
  ["de forma a", "para"],
  ["de modo a", "para"],
  ["de maneira a", "para"],
  ["no decorrer de*", "durante *"],
  ["em que não há", "sem"],
  ["em que não existe", "sem"],
  ["em que não existem", "sem"],
  ["coisas mais importantes a fazer", "prioridades"],
  ["coisas mais importantes para fazer", "prioridades"],
  ["um grande número de", ["muitos", "muitas"]],
  ["no dia de amanhã", "amanhã"],
  ["durante o dia de hoje", "hoje"],
  ...["domingo", "sábado"].map((day): Row => [`o ${day} de hoje`, `este ${day}`]),
  ...["segunda", "terça", "quarta", "quinta", "sexta"].map((day): Row => [
    `a ${day}-feira de hoje`,
    `esta ${day}-feira`,
  ]),
  // "a nível" is a calque: an adverb, or "em âmbito" for a scope.
  ...(
    "pessoal:pessoalmente profissional:profissionalmente técnico:tecnicamente " +
    "político:politicamente social:socialmente econômico:economicamente " +
    "financeiro:financeiramente emocional:emocionalmente físico:fisicamente " +
    "mental:mentalmente teórico:teoricamente cultural:culturalmente legal:legalmente " +
    "jurídico:juridicamente"
  )
    .split(" ")
    .map((pair): Row => {
      const [adjective, adverb] = pair.split(":");
      return [`a nível ${adjective}`, adverb];
    }),
  ...["nacional", "mundial", "internacional", "regional", "local", "estadual", "municipal"]
    .concat(["federal", "global"])
    .map((scope): Row => [`a nível ${scope}`, `em âmbito ${scope}`]),
];
