// Chaveiro — núcleo puro (sem banco, sem rede): caminho declarado de cada ação do plano e cobertura do plano.
// F1 do desenho (docs/desenho-causalidade-executor.md § 3.1/3.4/5): só classifica; nenhuma escrita externa acontece aqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { TEXTO_CATALOGO, escopoDeConteudo } from './catalogo-cfg.js'

export const CFG = JSON.parse(readFileSync(join(ROOT, 'config', 'chaveiro.json'), 'utf-8'))
export const CAMINHOS = ['automatico', 'assistido', 'cliente', 'sem_caminho']
// lista fechada: adaptador → operações que podem existir numa ordem (nada fora disto sai do sistema)
export const OPERACOES = { ml_item: ['preco', 'frete_gratis', 'status_ativar'], ml_estoque: ['alocar'], nf: ['emitir'], ofertas: ['job'], promocoes: ['plano'], ads: ['verba', 'pausar_anuncio'], notion: ['card'], pendencia: ['registrar'], nenhum: [] }

const semCaminho = (motivo, pendencias = [], janela = CFG.janela_prova_padrao_dias) => ({ caminho: 'sem_caminho', adaptador: 'nenhum', operacao: '', motivo, pendencias, janela_prova_dias: janela, experimento_elegivel: false })

// Lê a ação (regra, causa escolhida, executar_via, catálogo, custos) + config → { caminho, adaptador, operacao, motivo, pendencias[], janela_prova_dias, experimento_elegivel }.
// Nunca decide sozinho: a entrada da regra vem de config/chaveiro.json; os textos são fixos (nunca dado do cliente).
export function classificarCaminho(acao, { item = null, custosInformados = false, catalogoOrigem = 'nao', syncLiberado = false, cfg = CFG } = {}) {
  // acoes_plano guarda 'anuncio_<regra>'; a regra 'anuncio_restrito' também começa assim, por isso tenta a chave crua antes de tirar o prefixo
  const bruta = String(acao?.regra || ''), regra = cfg.caminho_por_regra[bruta] ? bruta : bruta.replace(/^anuncio_/, '')
  const dados = acao?.dados || {}
  const janela = dados.prova_janela_dias ?? cfg.janela_prova_padrao_dias
  const ent = cfg.caminho_por_regra[regra]
  if (!ent) return semCaminho(cfg.motivos.sem_regra, [], janela)
  let e = ent, caminho, motivo = `${cfg.motivos.declarado} (${regra})`
  if (ent.operacao_por_causa) {
    // regra por causa: a 1ª causa possível decide; sem causa (ou causa não listada) o humano decide
    const causa = dados.causas_possiveis?.[0]?.causa
    e = causa ? ent.operacao_por_causa[causa] : null
    if (!e) return { caminho: 'assistido', adaptador: 'notion', operacao: 'card', motivo: causa ? cfg.motivos.causa_nao_listada : cfg.motivos.sem_causa, pendencias: [], janela_prova_dias: janela, experimento_elegivel: false }
    motivo = `${cfg.motivos.declarado} (${regra} · ${causa})`
  }
  caminho = e.caminho
  const pendencias = []
  // coerência com o plano: ação que o plano manda por Ofertas/Promoções sai por esse adaptador
  const viaPlano = dados.executar_via === 'oferta' ? 'ofertas' : dados.executar_via === 'promocoes' ? 'promocoes' : null
  const adaptador = viaPlano || e.adaptador, operacao = viaPlano ? OPERACOES[viaPlano][0] : e.operacao
  // catálogo: conteúdo (galeria/ficha/título/oferta completa) não é do vendedor
  if (adaptador === 'ofertas' && e.escopo && escopoDeConteudo(e.escopo) && catalogoOrigem !== 'nao') {
    if (catalogoOrigem === 'terceiros') return semCaminho(TEXTO_CATALOGO.terceiros, [cfg.pendencias.catalogo], janela)
    caminho = 'assistido'; motivo = cfg.motivos.catalogo_proprio
  }
  if (adaptador === 'ads') { caminho = 'assistido'; motivo = cfg.motivos.ads_assistido; pendencias.push(cfg.pendencias.api_ads) }   // seção 10: Ads sem escrita até a F6
  if (adaptador === 'ml_item' && ['preco', 'frete_gratis'].includes(operacao) && !custosInformados) { caminho = 'assistido'; motivo = cfg.motivos.sem_custos; pendencias.push(cfg.pendencias.custos) }
  // V3 F6: escrita de estoque só com a chave global sync_estoque_ligado E o cliente liberado (exec_politica); senão o ajuste sai preparado e o humano aplica no painel
  if (adaptador === 'ml_estoque' && !(cfg.sync_estoque_ligado === true && syncLiberado)) { caminho = 'assistido'; motivo = cfg.motivos.sync_desligado; pendencias.push(cfg.pendencias.sync_estoque) }
  return { caminho, adaptador, operacao, motivo, pendencias, janela_prova_dias: janela, experimento_elegivel: caminho === 'automatico' && e.experimento === true }
}

// Cobertura do plano: lê a.dados.execucao de cada ação; ação antiga sem execucao conta como sem_caminho.
export function cobertura(acoes = []) {
  const por_caminho = { automatico: 0, assistido: 0, cliente: 0, sem_caminho: 0 }, por_adaptador = {}
  for (const a of acoes) {
    const ex = a?.dados?.execucao || semCaminho(CFG.motivos.sem_execucao)
    por_caminho[CAMINHOS.includes(ex.caminho) ? ex.caminho : 'sem_caminho']++
    por_adaptador[ex.adaptador || 'nenhum'] = (por_adaptador[ex.adaptador || 'nenhum'] || 0) + 1
  }
  const total = acoes.length, com_caminho = total - por_caminho.sem_caminho
  return { total, com_caminho, por_caminho, por_adaptador, pct_com_caminho: total ? Math.round(100 * com_caminho / total) : 0 }
}
