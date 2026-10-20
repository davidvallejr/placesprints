// Diagnóstico de conta para APRESENTAR a um prospect (Comercial): lê a conta que ELE autorizou (Mercado Livre, só leitura) e monta o relatório
// com resumo, funil, 80/20, ímãs de conversão, Ads, estoque/Full e as oportunidades priorizadas — cada uma com evidência e impacto como HIPÓTESE.
// Só dado da conta do próprio prospect: nada de outro cliente, de tarefa, de Notion ou de aprendizado da base entra no documento.
import { db, hojeLocal } from './db.js'
import { prospecto } from './comercial.js'
import { diagnosticarConta } from './diagnostico-conta.js'
import { montarAcoes, previsaoDoPlano } from './plano-anuncios.js'
import { paretoItens } from './retroalimentacao.js'
import { metricasFull } from './full-metricas.js'
import { paraProspect } from './render-diagnostico-comercial.js'
import { coberturaPedidos } from './meli-serie.js'

// no máximo 3 por tipo de regra (senão 8 vagas viram "recuperar caixa de compra" ×8); descarta a sugestão de Full sem quantidade (0 / 0 / 0) e a pendência administrativa
export function selecionarOportunidades(acoes, max = 8, porRegra = 3) {
  const cont = {}, out = []
  for (const a of acoes) {
    if (a.previsao?.tipo === 'pendencia') continue
    if (/: 0 \/ 0 \/ 0 un/.test((a.dados.como || []).join(' '))) continue
    cont[a.regra] = (cont[a.regra] || 0) + 1
    if (cont[a.regra] > porRegra) continue
    const d = a.dados
    out.push({ ...a, dados: { ...d, como: (d.como || []).map(paraProspect), evidencia: paraProspect(d.evidencia), hipotese: paraProspect(d.hipotese) } })
    if (out.length >= max) break
  }
  return out
}
export function montarDiagnosticoComercial(id, { hoje = hojeLocal() } = {}) {
  const p = prospecto(id)
  if (!p) throw Object.assign(new Error('prospect não encontrado'), { status: 404 })
  if (!p.conectado) return { disponivel: false, motivo: p.conexao_erro ? 'A conexão com o Mercado Livre foi perdida — gere e reenvie o link de conexão.' : 'A conta ainda não foi conectada — envie o link ao prospect.' }
  const chave = p.chave_conexao
  // "ainda não lida" é decidido pela cobertura de pedidos (coberturaPedidos, a mesma das telas) ou pela série gravada — conta lida sem venda não é "não lida"
  if (!coberturaPedidos(chave).de && !db.prepare('SELECT 1 FROM meli_serie_item WHERE cliente = ? LIMIT 1').get(chave))
    return { disponivel: false, precisa_coletar: true, motivo: 'A conta está conectada, mas os dados ainda não foram lidos. Use "Ler os dados da conta" (leva alguns minutos).' }
  const diag = diagnosticarConta(chave, { hoje })
  if (!diag.disponivel) return { disponivel: false, motivo: diag.motivo }
  // sem venda no período E sem venda no anterior: não há desempenho. Conta que VENDIA e parou (gmv_anterior > 0) tem desempenho — a queda a zero é o achado, e o relatório sai
  if (diag.motivo && !(diag.resumo.gmv_anterior > 0)) return { disponivel: false, motivo: `A conta está conectada e lida, mas ${diag.motivo}: ainda não há desempenho para diagnosticar.` }
  const acoes = montarAcoes(chave, diag, { hoje, retro: null })     // só calcula: nada é gravado para o prospect
  const previsao = previsaoDoPlano(diag, acoes)
  let full = null
  try { full = metricasFull(chave, { hoje }) } catch { /* sem Full: o relatório omite o bloco */ }
  const cobertura = db.prepare('SELECT MIN(dia) de, MAX(dia) ate FROM meli_coleta_dia WHERE cliente = ?').get(chave)
  return {
    disponivel: true, hoje, prospecto: { id: p.id, nome: p.nome, empresa: p.empresa }, diag, previsao, pareto: paretoItens(diag.itens), full, cobertura,
    oportunidades: selecionarOportunidades(acoes),
    omitidas: acoes.omitidas || {},
    reputacao: p.reputacao,                                                         // lida ao vivo no fim da coleta ({ lida:false, motivo } quando a API não entregou)
    nao_coletado: naoColetado(diag),                                                // o que a API/coleta NÃO entregou, com motivo — declarado no relatório, nunca zero
    interno: { email: p.email, telefone: p.telefone, utm: p.utm, origem: p.origem, criado_em: p.criado_em, consentimento_versao: p.consentimento_versao, formulario: p.formulario },   // só o relatório do painel usa
  }
}
// NOT_COLLECTED / NOT_AUTHORIZED do data_quality (saúde, cancelamentos, variação com lacuna…) + o que o prospect não tem (custos, metas). Canais sem API e campanhas ficam fora: não são "da conta dele".
export function naoColetado(diag) {
  const b = diag?.data_quality?.analises_bloqueadas || []
  return b.filter(x => ['NOT_COLLECTED', 'NOT_AUTHORIZED', 'NEEDS_EXTERNAL_DATA'].includes(x.estado) && !/^Diagnóstico de /.test(x.analise))
    .map(x => ({ analise: x.analise, estado: x.estado, motivo: x.motivo }))
}
