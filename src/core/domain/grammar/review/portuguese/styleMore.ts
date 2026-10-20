// Data of the verbFrames check in style.ts: frames that one plain verb says.

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
