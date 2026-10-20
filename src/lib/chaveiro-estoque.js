// Chaveiro · sincronismo de estoque (V3 F6 — docs/desenho-v3-erp.md § A; docs/desenho-v3-produto-estoque-financeiro.md § 7.3). PURO: sem banco, sem rede.
// O ÚNICO caminho que escreve estoque no Mercado Livre passa por aqui (decisão do David nº 5, 15/10/2026). Não decide prioridade (isso é do Arquiteto, regra
// estoque_sincronizar): só calcula, a partir do estoque FÍSICO informado (nunca o available_quantity), quanto cada estoque próprio do produto deve mostrar, e as travas.
//   fonte do físico → físico agora (− vendas pagas desde a informação) → segurança = dias × venda prevista → alvo = físico − segurança (nunca zera pela segurança;
//   0 só com físico 0 de fato, depois do aviso «vai zerar em N dias») → divisão pela venda (alocarEstoque, Σ = alvo, Full fora) → ordem com hash → travas → payload por
//   tipo de conta → conferência em todos os irmãos (2xx ≠ feito; sem reverter ao snapshot: «desfazer» = ordem nova a partir do físico atual).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT } from './env.js'
import { alocarEstoque, chaveSku, SKU_OFICIAL } from './produto-estoque.js'

export const CFG = JSON.parse(readFileSync(join(ROOT, 'config', 'chaveiro.json'), 'utf-8'))
export const SYNC = CFG.sync_estoque

export const SCHEMA_CHAVEIRO = `
CREATE TABLE IF NOT EXISTS exec_politica (              -- Chaveiro: autonomia por cliente (desenho do executor § 2); nasce 'propor' e com todo adaptador desligado
  cliente TEXT PRIMARY KEY,
  nivel TEXT NOT NULL DEFAULT 'propor' CHECK (nivel IN ('observar','propor','executar_com_aprovacao','executar_e_avisar')),
  adaptadores_live_json TEXT NOT NULL DEFAULT '{}',    -- {"ml_estoque":1} = pode escrever de verdade
  max_ordens_dia INTEGER NOT NULL DEFAULT 1,           -- estreia supervisionada: 1
  produtos_json TEXT NOT NULL DEFAULT '[]',            -- ml_estoque: SKUs liberados (estreia = 1 produto)
  liberado_por TEXT NOT NULL DEFAULT '', liberado_em TEXT NOT NULL DEFAULT '',
  cliente_informado_por TEXT NOT NULL DEFAULT '', cliente_informado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exec_ordem (                 -- UMA ordem por intervenção: o que o Chaveiro vai fazer, fez e conferiu
  id TEXT PRIMARY KEY,                                 -- CH-xxxxxxxxxx
  cliente TEXT NOT NULL, acao_id TEXT NOT NULL DEFAULT '', regra TEXT NOT NULL, item_id TEXT NOT NULL DEFAULT '', produto TEXT NOT NULL DEFAULT '',
  caminho TEXT NOT NULL CHECK (caminho IN ('automatico','assistido','cliente','sem_caminho')),
  adaptador TEXT NOT NULL CHECK (adaptador IN ('ml_item','ml_estoque','nf','ofertas','promocoes','ads','notion','pendencia','nenhum')),
  operacao TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', snapshot_antes_json TEXT NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL DEFAULT '', chave_idem TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'preparada' CHECK (estado IN ('preparada','aguardando_aprovacao','aprovada','executando','em_conferencia','executada','divergente','falhou','recusada','cancelada','obsoleta')),
  aviso_em TEXT NOT NULL DEFAULT '',                   -- «vai zerar em N dias» avisado antes de escrever 0
  aprovado_por TEXT NOT NULL DEFAULT '', aprovado_em TEXT NOT NULL DEFAULT '',
  executado_em TEXT NOT NULL DEFAULT '', conferir_em TEXT NOT NULL DEFAULT '', conferido_em TEXT NOT NULL DEFAULT '', conferencias INTEGER NOT NULL DEFAULT 0,
  resultado_json TEXT NOT NULL DEFAULT '{}', erro TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_exec_ordem_cliente ON exec_ordem (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_exec_ordem_produto ON exec_ordem (cliente, produto, estado);
CREATE TABLE IF NOT EXISTS exec_evento (                -- auditoria append-only de toda transição e de toda escrita (status HTTP, x-version, lido antes/depois; nunca token)
  id INTEGER PRIMARY KEY AUTOINCREMENT, ordem_id TEXT NOT NULL, cliente TEXT NOT NULL,
  de TEXT NOT NULL, para TEXT NOT NULL, por TEXT NOT NULL DEFAULT 'sistema', detalhe_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_exec_evento_ordem ON exec_evento (ordem_id);
CREATE TRIGGER IF NOT EXISTS exec_evento_sem_update BEFORE UPDATE ON exec_evento BEGIN SELECT RAISE(ABORT, 'exec_evento é append-only'); END;
CREATE TRIGGER IF NOT EXISTS exec_evento_sem_delete BEFORE DELETE ON exec_evento BEGIN SELECT RAISE(ABORT, 'exec_evento é append-only'); END;
CREATE TABLE IF NOT EXISTS produto_regra_estoque (      -- F6: regras do sincronismo por cliente/produto ('*' = conta toda). Sem «mínimo» nem faixas (vendem sem estoque por desenho)
  cliente TEXT NOT NULL, produto TEXT NOT NULL,         -- produto = SKU oficial normalizado (chaveSku) ou '*'
  dias_protecao REAL CHECK (dias_protecao IS NULL OR dias_protecao BETWEEN 0 AND 60),   -- segurança = dias × venda prevista; NULL = padrão (2 d)
  maximo_por_anuncio INTEGER CHECK (maximo_por_anuncio IS NULL OR maximo_por_anuncio BETWEEN 1 AND 100000),
  nao_escrever INTEGER NOT NULL DEFAULT 0 CHECK (nao_escrever IN (0,1)),
  por TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (cliente, produto));
`

export const ESTADOS_ABERTOS = ['preparada', 'aguardando_aprovacao', 'aprovada', 'executando', 'em_conferencia']
export const TRANSICOES = {
  preparada: ['aguardando_aprovacao', 'aprovada', 'obsoleta', 'cancelada', 'recusada'], aguardando_aprovacao: ['aprovada', 'obsoleta', 'cancelada', 'recusada'],
  aprovada: ['executando', 'cancelada', 'obsoleta', 'recusada', 'divergente'], executando: ['em_conferencia', 'falhou', 'divergente', 'recusada'],
  em_conferencia: ['executada', 'divergente', 'falhou'], executada: [], divergente: [], falhou: [], recusada: [], cancelada: [], obsoleta: [],
}
export const podeIr = (de, para) => (TRANSICOES[de] || []).includes(para)

// textos FIXOS (nunca o valor recebido nem dado do cliente)
export const MOTIVOS = {
  chave_global: 'sincronismo de estoque desligado (config/chaveiro.json → sync_estoque_ligado)',
  parado: 'sincronismo de estoque parado pelo botão de emergência',
  sem_politica: 'cliente não liberado para o sincronismo (falta a liberação do líder com o cliente informado)',
  nivel: 'política do cliente não executa (nível observar/propor)',
  adaptador: 'escrita de estoque não liberada para este cliente (adaptador ml_estoque)',
  cliente_informado: 'o cliente ainda não foi informado do sincronismo',
  produto_fora: 'produto fora da estreia supervisionada deste cliente',
  confirmar: 'falta confirmar === true (confirmação explícita)',
  hash: 'o conteúdo da ordem mudou depois de preparada (hash não confere): prepare de novo',
  teto_dia: 'teto de ordens por dia deste cliente atingido (estreia supervisionada)',
  integracao: 'cliente sem integração com o Mercado Livre ativa',
  prospect: 'prospect do comercial não é cliente',
  fisico_vencido: 'estoque físico informado vencido para escrever (mais de 24 h): informe de novo',
  sem_fisico: 'sem estoque físico informado (cliente, equipe, ERP ou planilha): o sincronismo não escreve',
  nao_escrever: 'produto marcado para não escrever',
  sem_pool: 'nenhum estoque próprio do produto pode ser escrito (Full, Flex independente ou anúncio alinhado ficam fora)',
  estado: 'a ordem não está aprovada para executar',
  outra_aberta: 'já existe uma ordem aberta deste produto: uma intervenção por vez',
  full: 'o produto ganhou estoque no Full ou Flex independente: escrita recusada (Full só por envio pelo painel)',
  multi_deposito: 'multi-depósito: distribuir no painel (o rateio por depósito entra com o 1º caso real)',
  pausado: 'anúncio do produto pausado pelo vendedor ou fora do ar: escrita recusada',
  alinhado: 'anúncio com alinhamento vivo (pausado de propósito, descontinuado ou teste): fora do sincronismo',
  divergente: 'o estoque no Mercado Livre mudou fora do sistema desde a prévia (alguém mexeu no painel): nada foi escrito',
  vendas_nao_conferidas: 'não foi possível conferir as vendas desde a informação do físico: nada foi escrito',
  aviso_zerar: 'antes de escrever 0 o sistema avisa «vai zerar em N dias»: aviso registrado, a escrita espera a próxima execução',
  nao_confirmou: 'o canal não confirmou: conferir no painel',
  payload: 'o Mercado Livre recusou o formato da escrita: nada é reenviado',
  permissao: 'sem permissão do app no Mercado Livre (reconectar a conta)',
  limite: 'limite de chamadas do Mercado Livre: tenta no próximo ciclo',
  incerto: 'resposta incerta do Mercado Livre: a conferência decide (nunca reenvio às cegas)',
  conflito: 'versão do estoque desatualizada (409) duas vezes: nada mais é enviado',
  sem_mudanca: 'nada a escrever: o Mercado Livre já mostra o alvo',
}

// ── estoques próprios (pools) do produto = SKU oficial: arestas com o SKU (anúncio e VARIAÇÃO) + irmãos do mesmo UP + vínculo manual ao sku; recusa tira. Full fora.
// arestas: meli_anuncio_up (+ status vigente) · vinculos: produto_vinculo · upEstoque: meli_up_estoque (próprio lido) · validadeDias: leitura /stock
// → { pools[{ chave, up, itens[{ item_id, variacao_id, estoque, status }], mostrado, fonte, divergente }], fora[{ chave, motivo }] }
export function poolsDoSku({ sku, arestas = [], vinculos = [], upEstoque = [], hoje = '', validadeDias = 2 } = {}) {
  const alvo = chaveSku(sku), prod = `sku:${alvo}`
  const vivas = arestas.filter(a => a.status === 'active' || a.status === 'paused')
  const origem = a => (a.user_product_id ? `up:${a.user_product_id}` : `item:${a.item_id}`)
  const recusada = a => vinculos.some(v => v.tipo === 'recusado' && v.produto === prod && v.origem === origem(a))
  const manual = new Set(vinculos.filter(v => v.tipo === 'manual' && v.produto === prod).map(v => v.origem))
  const base = vivas.filter(a => (SKU_OFICIAL.has(a.sku_fonte) && chaveSku(a.sku) === alvo) || manual.has(origem(a)))
  const ups = new Set(base.map(a => a.user_product_id).filter(Boolean))
  const membros = [...new Map([...base, ...vivas.filter(a => a.user_product_id && ups.has(a.user_product_id))].filter(a => !recusada(a)).map(a => [`${a.item_id}|${a.variacao_id || ''}`, a])).values()]
  const grupos = new Map()
  for (const a of membros) { const k = a.user_product_id ? `up:${a.user_product_id}` : `item:${a.item_id}${a.variacao_id ? ':' + a.variacao_id : ''}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(a) }
  const desde = hoje ? addDiasIso(hoje, -validadeDias) : ''
  const stock = new Map(upEstoque.filter(r => r.local === 'proprio' && r.quantidade != null && (!desde || String(r.lido_em).slice(0, 10) >= desde)).map(r => [r.user_product_id, r]))
  const pools = [], fora = []
  for (const [chave, l] of [...grupos].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (l.some(a => a.logistica === 'fulfillment')) { fora.push({ chave, motivo: 'full' }); continue }       // Full e Full + Flex (selling_address) nunca: só por envio pelo painel
    if (l.some(a => /(^|,)bundle(,|$)/.test(a.tags || ''))) { fora.push({ chave, motivo: 'kit_virtual' }); continue }  // Kit Virtual: o ML calcula pelo componente, nunca escrito
    const up = l[0].user_product_id || '', s = up ? stock.get(up) : null
    const nums = l.map(a => a.estoque).filter(x => x != null)
    const itens = l.map(a => ({ item_id: a.item_id, variacao_id: a.variacao_id || '', estoque: a.estoque ?? null, status: a.status })).sort((a, b) => a.item_id.localeCompare(b.item_id) || a.variacao_id.localeCompare(b.variacao_id))
    const lido_em = s ? String(s.lido_em) : l.map(a => String(a.lido_em || '')).sort()[0] || ''           // quando o número «de» foi lido (as vendas depois disso explicam a queda)
    pools.push({ chave, up, itens, lojas: s?.lojas ?? null, lido_em, mostrado: s ? s.quantidade : nums.length ? Math.max(...nums) : null, fonte: s ? 'stock' : nums.length ? 'anuncio' : '', divergente: !s && new Set(nums).size > 1 })
  }
  return { sku: alvo, pools, fora }
}
const addDiasIso = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// físico agora = o informado − vendas pagas dos estoques próprios do produto desde a informação. linhas = meli_pedido_item [{ item_id, variacao_id, dia, quantidade, status }]
// O dia da linha é local (-03:00) e `em` é ISO UTC: desconta desde a VÉSPERA do dia de `em` (desconta a mais, nunca a menos — o lado seguro). Cancelado não desconta.
// → { valido (para escrever), fisico, informado, deduzido, idade_h, fonte, em, motivo }
export function fisicoAgora({ fonte = null, linhas = [], pools = [], agoraISO, validadeHoras = SYNC.validade_fisico_horas } = {}) {
  if (!fonte || !Number.isInteger(fonte.quantidade)) return { valido: false, fisico: null, motivo: 'sem_fisico' }
  const idade_h = (Date.parse(agoraISO) - Date.parse(fonte.em)) / 3_600_000
  const membros = new Set(pools.flatMap(p => p.itens.map(i => `${i.item_id}|${i.variacao_id}`))), desde = addDiasIso(String(fonte.em).slice(0, 10), -1)
  const deduzido = linhas.filter(l => l.status === 'paid' && l.dia >= desde && (membros.has(`${l.item_id}|${l.variacao_id || ''}`) || (membros.has(`${l.item_id}|`) && !l.variacao_id))).reduce((t, l) => t + (l.quantidade || 0), 0)
  const fisico = Math.max(0, fonte.quantidade - deduzido)
  return { valido: Number.isFinite(idade_h) && idade_h >= 0 && idade_h <= validadeHoras, fisico, informado: fonte.quantidade, deduzido, idade_h: Number.isFinite(idade_h) ? Math.round(idade_h * 10) / 10 : null, fonte: fonte.fonte, em: fonte.em,
    motivo: Number.isFinite(idade_h) && idade_h <= validadeHoras ? '' : 'fisico_vencido' }
}

// segurança em UNIDADES = ceil(dias de proteção × venda prevista/dia) (decisão do David: 2 dias × venda prevista, ajustável por cliente/produto)
export const segurancaUn = (vBase, dias = SYNC.dias_protecao_padrao) => Math.max(0, Math.ceil((vBase || 0) * (dias ?? SYNC.dias_protecao_padrao) - 1e-9))

// PLANO de UM produto: { fisico, seguranca, vBase, pools[{ chave, v, mostrado }], regra: { maximo_por_anuncio, nao_escrever } } →
// { alvo_total, pools[{ chave, de, para }], escreve, aviso_zerar: { dias } | null, seguranca_consumida, risco_vender_sem_estoque, motivo }
// Nunca sobe o total acima do físico; a segurança nunca zera (com físico > 0 e alvo 0, o total só pode CAIR até o físico); 0 só com físico 0 de fato.
export function planejarSync({ fisico, seguranca = 0, vBase = 0, pools = [], regra = {}, tolerancia = { un: SYNC.tolerancia_un, pct: SYNC.tolerancia_pct }, avisoDias = SYNC.aviso_zerar_dias } = {}) {
  if (regra.nao_escrever) return { escreve: false, motivo: 'nao_escrever', pools: [] }
  if (!pools.length) return { escreve: false, motivo: 'sem_pool', pools: [] }
  if (fisico == null) return { escreve: false, motivo: 'sem_fisico', pools: [] }
  const mostrados = pools.map(p => p.mostrado), soma = mostrados.every(x => x != null) ? mostrados.reduce((t, x) => t + x, 0) : null
  let alvo = Math.max(0, fisico - seguranca), consumida = false
  if (alvo === 0 && fisico > 0) { alvo = Math.min(fisico, soma ?? 0); consumida = true }             // a segurança não zera o anúncio: só corta o que passa do físico
  const max = Number.isInteger(regra.maximo_por_anuncio) ? regra.maximo_por_anuncio : undefined
  const q = new Map(alocarEstoque(alvo, pools.map(p => ({ chave: p.chave, v: p.v, max }))).map(x => [x.chave, x.quantidade]))
  const linhas = pools.map(p => ({ chave: p.chave, de: p.mostrado, para: q.get(p.chave) ?? 0 }))
  const dif = linhas.map(l => (l.de == null ? Infinity : Math.abs(l.para - l.de))), tol = Math.max(tolerancia.un, Math.ceil(alvo * tolerancia.pct / 100))
  const risco = soma == null || soma > fisico                                                          // o ML mostra mais que existe = vender sem estoque
  const escreve = linhas.some(l => l.de == null || l.de !== l.para) && (risco || dif.some(d => d > tol))
  const dias = vBase > 0 ? Math.floor(fisico / vBase) : null
  const zera = linhas.some(l => l.para === 0 && (l.de == null || l.de > 0))
  return { alvo_total: alvo, pools: linhas, escreve, seguranca_consumida: consumida, risco_vender_sem_estoque: risco, soma_mostrada: soma,
    aviso_zerar: (dias != null && dias <= avisoDias) || zera ? { dias, zera } : null, motivo: escreve ? '' : 'sem_mudanca' }
}

// previa_em fica fora do hash: a mesma prévia (mesmo físico, mesmos alvos) = a mesma ordem (idempotente)
export const hashOrdem = payload => createHash('sha256').update(JSON.stringify({ ...payload, previa_em: undefined })).digest('hex').slice(0, 24)
export const idOrdem = chave => 'CH-' + createHash('sha256').update(chave).digest('hex').slice(0, 10)

// TRAVAS (puras) de uma execução ao vivo → { liberado, motivos[] }. Todas precisam passar; qualquer uma fechada = nada sai para o ML.
export function verificarTravas({ cfg = CFG, parado = false, politica = null, ordem = null, confirmar, executadasHoje = 0, integracaoOk = false, prospect = false, fisico = null, regra = {}, sku = '' } = {}) {
  const m = []
  if (cfg.sync_estoque_ligado !== true) m.push(MOTIVOS.chave_global)
  if (parado) m.push(MOTIVOS.parado)
  if (prospect) m.push(MOTIVOS.prospect)
  if (!integracaoOk) m.push(MOTIVOS.integracao)
  if (!politica || !politica.liberado_por) m.push(MOTIVOS.sem_politica)
  else {
    if (!['executar_com_aprovacao', 'executar_e_avisar'].includes(politica.nivel)) m.push(MOTIVOS.nivel)
    if (politica.adaptadores?.ml_estoque !== 1) m.push(MOTIVOS.adaptador)
    if (!politica.cliente_informado_em) m.push(MOTIVOS.cliente_informado)
    if (!(politica.produtos || []).includes(chaveSku(sku))) m.push(MOTIVOS.produto_fora)
    if (executadasHoje >= (politica.max_ordens_dia ?? 1)) m.push(MOTIVOS.teto_dia)
  }
  if (confirmar !== true) m.push(MOTIVOS.confirmar)
  if (!ordem || !['aprovada', 'aguardando_aprovacao', 'preparada'].includes(ordem.estado)) m.push(MOTIVOS.estado)
  else if (hashOrdem(ordem.payload) !== ordem.hash) m.push(MOTIVOS.hash)
  if (!fisico || fisico.fisico == null) m.push(MOTIVOS.sem_fisico)
  else if (!fisico.valido) m.push(MOTIVOS.fisico_vencido)
  if (regra.nao_escrever) m.push(MOTIVOS.nao_escrever)
  return { liberado: m.length === 0, motivos: m }
}

// leitura ao vivo de um pool: GET /user-products/{UP}/stock → { proprio, x_version, local (o único seller_warehouse), recusa }. selling_address (Flex independente) ou
// meli_facility > 0 = recusa (Full/Flex nunca por API); 2+ depósitos = recusa (multi-depósito). Corpo fora do formato = null (nunca 0).
export function lerStock(corpo, headers = {}) {
  const locs = Array.isArray(corpo?.locations) ? corpo.locations : null
  if (!locs || locs.some(l => !Number.isFinite(l?.quantity))) return null
  const wh = locs.filter(l => l.type === 'seller_warehouse'), sa = locs.filter(l => l.type === 'selling_address'), full = locs.filter(l => l.type === 'meli_facility')
  const xv = headers['x-version'] ?? headers['X-Version'] ?? null
  const recusa = full.some(l => l.quantity > 0) ? 'full' : sa.length && wh.length ? 'full' : new Set(wh.map(l => String(l.store_id ?? ''))).size > 1 ? 'multi_deposito' : ''
  const prop = [...wh, ...sa].reduce((t, l) => t + Math.round(l.quantity), 0)
  return { proprio: prop, x_version: xv == null ? null : String(xv), local: wh[0] ? { store_id: wh[0].store_id, network_node_id: wh[0].network_node_id } : null, recusa, so_selling_address: !wh.length && sa.length > 0 }
}

// payload de UM pool (lista fechada de campos): conta multiorigem (tag warehouse_management) → PUT /user-products/{UP}/stock/type/seller_warehouse com x-version;
// senão → PUT /items/{um item do UP} { available_quantity } (o ML replica aos irmãos do UP) ou { variations:[{ id, available_quantity }] }. Nada além disso sai.
// variações: o PUT de variations no item REMOVE as variações que não forem listadas — vão TODAS as irmãs por id (lidas ao vivo), só a do pool com available_quantity;
// sem a lista lida ao vivo, não há escrita segura (null)
export function payloadDoPool(pool, quantidade, { multiorigem = false, x_version = null, local = null, variacoes = null } = {}) {
  if (!Number.isInteger(quantidade) || quantidade < 0) throw new Error('quantidade inválida para o payload de estoque')
  if (multiorigem) {
    if (!pool.up || !x_version || !local?.store_id) return null                                         // sem UP, sem versão ou sem depósito: não há escrita segura
    // NOT_VERIFIED: a doc mostra o corpo com a chave `stock` (api-ml-verificada § 4; o desenho-v3-erp marca `locations` × `stock`) — a conferência decide se teve efeito
    return { metodo: 'PUT', caminho: `/user-products/${pool.up}/stock/type/seller_warehouse`, headers: { 'x-version': String(x_version) }, corpo: { stock: [{ store_id: local.store_id, network_node_id: local.network_node_id, quantity: quantidade }] } }
  }
  const it = pool.itens[0]
  if (!it) return null
  if (it.variacao_id) {
    const ids = Array.isArray(variacoes) ? variacoes.map(String) : null
    if (!ids || !ids.includes(String(it.variacao_id))) return null
    return { metodo: 'PUT', caminho: `/items/${it.item_id}`, headers: {}, corpo: { variations: ids.map(id => (id === String(it.variacao_id) ? { id: Number(id) || id, available_quantity: quantidade } : { id: Number(id) || id })) } }
  }
  return { metodo: 'PUT', caminho: `/items/${it.item_id}`, headers: {}, corpo: { available_quantity: quantidade } }
}

// resposta de uma escrita → classe (2xx ≠ feito: só a conferência diz «executada»)
export function classificarStatus(status) {
  if (status >= 200 && status < 300) return 'enviado'
  if (status === 409) return 'conflito'
  if (status === 429) return 'limite'
  if (status === 401 || status === 403) return 'permissao'
  if (status === 400 || (status >= 402 && status < 500)) return 'payload'
  return 'incerto'                                                                                       // 5xx / rede / timeout: pode ter gravado
}

// conferência de um pool/irmão: esperado (o que foi escrito) × lido agora × vendas desde a escrita → 'confere' | 'divergente' (mostra MAIS que o escrito) | 'aguardando'
export function conferirPool({ esperado, lido, vendasDesde = 0 }) {
  if (lido == null) return 'aguardando'
  if (lido > esperado) return 'divergente'
  return esperado - lido <= vendasDesde ? 'confere' : 'aguardando'
}

// releitura ao vivo × o que a prévia viu (de) × vendas desde a prévia: mexeu para CIMA, ou caiu mais que as vendas = alguém mexeu no painel → divergente (não escreve)
export const conferePrevia = ({ de, lido, vendasDesde = 0 }) => lido != null && de != null && lido <= de && de - lido <= vendasDesde

// Merovíngio — marco «sync_estoque»: antes × depois da 1ª escrita conferida, nos anúncios sincronizados × controle (os demais anúncios ativos do cliente, sem sync).
// por grupo: { dias_sem_estoque, cancelados, unidades } em N dias antes e N depois. Associação temporal, nunca causa. → { tratado, controle, efeito, rotulo }
export function medirSyncEstoque({ tratado, controle, N }) {
  const taxa = (g, k) => (g && g[k] != null ? g[k] : null)
  const delta = g => ({ dias_sem_estoque: dif(taxa(g?.antes, 'dias_sem_estoque'), taxa(g?.depois, 'dias_sem_estoque')), cancelados: dif(taxa(g?.antes, 'cancelados'), taxa(g?.depois, 'cancelados')),
    unidades: dif(taxa(g?.antes, 'unidades'), taxa(g?.depois, 'unidades')) })
  const t = delta(tratado), c = delta(controle)
  const liquido = k => (t[k] == null || c[k] == null ? null : Math.round((t[k] - c[k]) * 100) / 100)
  const completo = !!(tratado?.completo && controle?.completo)
  return { janela_dias: N, tratado: { ...tratado, delta: t }, controle: { ...controle, delta: c }, efeito: { dias_sem_estoque: liquido('dias_sem_estoque'), cancelados: liquido('cancelados'), unidades: liquido('unidades') },
    estado: completo ? 'medido' : 'em_maturacao', rotulo: 'associação temporal ajustada pelo controle (anúncios sem sincronismo), não prova de causa' }
}
const dif = (a, b) => (a == null || b == null ? null : b - a)
