// Classes de status da tarefa — fonte única para lib, rotas, scripts e testes (sem import: constantes puras).
// "Dependência do cliente" sai do backlog ativo sem contar como entregue nem como bloqueada (face no Notion: OPCAO_NOTION_DEPENDENCIA).
export const ORDEM = ['bloqueada', 'andamento', 'validacao', 'nao_iniciada', 'dependencia_cliente', 'concluida', 'cancelada']
export const ROTULOS = {                                                                      // ordem das chaves = ordem de exibição (filtros, gráfico, select)
  nao_iniciada: 'Não iniciada', andamento: 'Em andamento', validacao: 'Em validação', concluida: 'Concluída',
  bloqueada: 'Bloqueada', dependencia_cliente: 'Dependência do cliente', cancelada: 'Cancelada',
}
export const FECHADAS = ['concluida', 'cancelada', 'dependencia_cliente']                       // fora do backlog ativo
export const ABERTA_SQL = "status NOT IN ('concluida','cancelada','dependencia_cliente')"
export const PLANEJADA_SQL = "status NOT IN ('cancelada','dependencia_cliente')"                // denominador: planejadas, burnup, plano do mês
export const ehAberta = t => !FECHADAS.includes(t.status)
export const ehPlanejada = t => t.status !== 'cancelada' && t.status !== 'dependencia_cliente'
export const ehDependencia = t => t.status === 'dependencia_cliente'
export const OPCAO_NOTION_DEPENDENCIA = 'Aguardando Devolutiva do Cliente'
