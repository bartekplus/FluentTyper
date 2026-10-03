/**
 * More opt-in wording advice for the `pt` style table (stylePhrasing): wordy frames with a
 * shorter form, pleonasms and worn idioms. Data only: style.ts conjugates the verb rows (the
 * first word is an infinitive, "a|b" lists heads that share the rest) and expands "de*" and the
 * like into each article.
 */
type Row = [string, string | string[]];

/** Verb frames with a shorter verb. */
export const CONCISE_VERBS: Row[] = [
  ["dar um exemplo de*", "exemplificar *"],
  ["dar exemplos de*", "exemplificar *"],
  ["dar destaque a*", "destacar *"],
  ["dar ênfase a*", "enfatizar *"],
  ["dar preferência a*", "preferir *"],
  ["dar uma ajuda", "ajudar"],
  ["dar a sua opinião", "opinar"],
  ["fazer uso de*", "usar *"],
  ["passar através de*", "atravessar *"],
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
];

/**
 * "tornar possível o acesso" -> "possibilitar o acesso": "tornar" and an adjective that one verb
 * says (the verbFrames check in style.ts; not after a reflexive "se").
 */
export const TORNAR = new Map([
  ["possível", "possibilitar"],
  ["impossível", "impossibilitar"],
  ["mais fácil", "facilitar"],
  ["mais difícil", "dificultar"],
  ["mais forte", "fortalecer"],
  ["mais fraco", "enfraquecer"],
  ["mais claro", "esclarecer"],
  ["mais rápido", "acelerar"],
]);

/**
 * "fazer a seleção de" -> "selecionar": a noun that names the action of a regular verb, after
 * "fazer", "realizar" or "efetuar" (the verbFrames check in style.ts).
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
  ["em que não há", "sem"],
  ["em que não existe", "sem"],
  ["em que não existem", "sem"],
  ["coisas mais importantes a fazer", "prioridades"],
  ["coisas mais importantes para fazer", "prioridades"],
  ["no dia de amanhã", "amanhã"],
  ["durante o dia de hoje", "hoje"],
  ...["domingo", "sábado"].map((day): Row => [`o ${day} de hoje`, `este ${day}`]),
  ...["segunda", "terça", "quarta", "quinta", "sexta"].map((day): Row => [
    `a ${day}-feira de hoje`,
    `esta ${day}-feira`,
  ]),
];

/** Verbs with a tail that only says them again. */
export const PLEONASM_VERBS: Row[] = [
  ["repetir de novo", "repetir"],
  ["repetir novamente", "repetir"],
  ["acrescentar ainda mais", "acrescentar"],
  ["olhar com os olhos", "olhar"],
  ["ouvir com os ouvidos", "ouvir"],
  ["comer com a boca", "comer"],
  ["suicidar-se a si mesmo", "suicidar-se"],
  ["suicidar-se a si próprio", "suicidar-se"],
  ["cursar um curso", "fazer um curso"],
  ["resumir resumidamente", "resumir"],
  ["voar pelo ar", "voar"],
  ["mesclar juntos", "mesclar"],
  ["expulsar para fora", "expulsar"],
  ["exultar de alegria", "exultar"],
  ["enfrentar de frente", "enfrentar"],
  ["sussurrar baixo", "sussurrar"],
  ["tirar de dentro de*", "tirar de*"],
];

/** Phrases that say a thing twice. */
export const PLEONASM_FIXED: Row[] = [
  ["ainda continuar", "continuar"],
  ["canja de galinha", "canja"],
  ["cardume de peixe", "cardume"],
  ["enxame de abelha", "enxame"],
  ["panorama geral", "panorama"],
  ["abertura inaugural", "abertura"],
  ["preconceito prévio", "preconceito"],
  ["sorriso nos lábios", "sorriso"],
  ["detalhe minucioso", "detalhe"],
  ["plano para o futuro", "plano"],
  ["superavit positivo", "superavit"],
  ["deficit negativo", "deficit"],
  ["maluco da cabeça", "maluco"],
  ["louco da cabeça", "louco"],
  ["de jeito maneira", "de jeito nenhum"],
  ...["razão", "motivo", "causa"].flatMap((noun): Row[] => [
    [`${noun} é porque`, `${noun} é que`],
    [`${noun} foi porque`, `${noun} foi que`],
  ]),
  ...["no entanto", "porém", "contudo", "todavia", "entretanto"].map((but): Row => [
    `mas ${but}`,
    ["mas", but],
  ]),
];
