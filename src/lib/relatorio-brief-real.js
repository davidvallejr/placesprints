// Fiação REAL do relatório curto (relatorio-brief.js): banco, Mercado Livre e o resto do sistema entram aqui, e só aqui.
// A frente de envio importa apenas { briefReal, nomesInternos } (server.js); os testes dela usam um brief sintético e os desta frente, dados sintéticos.
// Somente LEITURA do Notion e do Mercado Livre. montarSemanal é chamado com `leve: true`: pula a lista de produtos mais vendidos e NÃO grava a linha semanal de métricas
// (`metricas_semana`), então a prévia do relatório é 100% somente leitura. As pendências do cliente vêm do avaliador único (leitura local do banco, sem Mercado Livre).
import { db, hojeLocal, agora } from './db.js'
import { montarSemanal } from './semanal.js'
import { lerAcoes } from './plano-cliente.js'
import { historico } from './preco-historico.js'
import { relatorioVendas } from './meli-api.js'
import { cfgRetro } from './retroalimentacao.js'
import { listaOficial } from './analistas.js'
import { lideresEConsultores } from './equipe.js'
import { analistasDe } from './impacto-tarefas.js'
import { criarBrief } from './relatorio-brief.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { alinhamentosReal } from './alinhamentos-real.js'

// nomes de gente da equipe para o auditor: responsáveis das tarefas e das ações do cliente, analistas oficiais, líderes e consultores.
// O auditor barra qualquer um deles (palavra inteira) em texto visível ao cliente.
export function nomesInternos(cliente) {
  const nomes = new Set()
  const add = txt => { for (const n of analistasDe(txt)) if (n && n !== '—') nomes.add(n) }
  for (const r of db.prepare("SELECT DISTINCT responsavel FROM tarefas WHERE cliente = ? AND arquivada = 0 AND responsavel <> ''").all(cliente)) add(r.responsavel)
  for (const r of db.prepare("SELECT DISTINCT responsavel, delegado_a, squad FROM acoes_plano WHERE cliente = ?").all(cliente)) { add(r.responsavel); add(r.delegado_a); add(r.squad) }
  for (const a of listaOficial()) nomes.add(a.nome)
  for (const n of lideresEConsultores()) nomes.add(n)
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export const briefReal = criarBrief({
  montarSemanal,
  hoje: hojeLocal,
  agora,
  lerAcoes,
  eventos: (cliente, janela) => historico.eventosAnuncio(cliente, janela),
  inicioHistorico: cliente => historico.inicioHistorico(cliente),
  // o dia em andamento é cortesia: o brief ignora falha e demora. relatorioVendas = a mesma conta de pedidos pagos do relatorioNegocio (faturamento, pedidos),
  // sem as visitas por anúncio, os cancelamentos e as reclamações — poucas chamadas ao Mercado Livre por relatório
  negocioHoje: async (cliente, dia) => { const r = await relatorioVendas(cliente, { de: dia, ate: dia }); return { disponivel: r.disponivel, faturamento: r.faturamento, vendas: r.pedidos } },
  nomesInternos,
  pendencias: { avaliar: (cliente, opcoes) => pendenciasReal().avaliar(cliente, opcoes) },   // preguiçoso: o avaliador só nasce na 1ª geração (ciclo de imports de diagnostico-conta)
  limiarRupturaDias: cfgRetro.queda?.limiar_ruptura_dias,
  alinhado: (cliente, dia) => alinhamentosReal().predicado(cliente, { hoje: dia }),          // alinhamentos com o cliente: o predicado único decide o que sai rotulado ou omitido
  // listarOfertas: o motor (semanal.ofertas) já traz as promoções; não há segunda chamada ao Mercado Livre
})
