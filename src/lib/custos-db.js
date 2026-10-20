// Núcleo dos custos por SKU vindos de Bling, Tiny ou planilha (spec docs/integracao-custos-erp-SPEC.md, módulo M1; assinaturas congeladas em §11.1).
// aplicarLote é a ÚNICA porta de escrita de custo externo. Regras inegociáveis: custo ausente/vazio/null/NaN/≤0 NUNCA vira custo (linha rejeitada com
// código e motivo; o vigente anterior continua valendo); nada de inventar número; SKU↔MLB só pela resolução declarada de custo-vinculo.js (manual > SKU exato >
// SKU normalizado de chave única > grupo user_product_id; semelhança de nome só SUGERE); toda query filtra `cliente`; envio
// completo nunca apaga SKU (só marca "não visto"); quarentena não troca o vigente até o dono aprovar; toda mudança vai para o histórico e a auditoria.
// Banco = o de promocoes-db.js (PS_PROMO_MEMORIA=1 troca por memória nos testes); nunca importa db.js — o log é injetado (configurarLog).
import { createHash } from 'node:crypto'
import { db, agora, auditar } from './promocoes-db.js'
import { lerCusto, CUSTO_MAX } from './promocoes-mc.js'
import { criarCustoVinculo } from './custo-vinculo.js'

export const FONTES_EXTERNAS = ['bling', 'tiny', 'sheets']                  // fontes CONECTADAS (estado, frescor, webhook/OAuth)
// 'upload' (15/10/2026, src/lib/custos-upload.js): planilha subida na tela pela equipe — escreve pelo aplicarLote como as outras, mas não tem conexão nem frescor.
// Precedência padrão: manual > upload > bling > tiny > sheets (a equipe conferiu a prévia do upload; o ERP é leitura automática).
export const FONTES_LOTE = ['upload', ...FONTES_EXTERNAS]
export const FONTES = ['manual', ...FONTES_LOTE]
const LISTAS = ['sku_erp_sem_anuncio', 'anuncio_sem_custo', 'anuncio_sem_sku', 'conflito', 'rejeitadas', 'quarentena', 'nao_visto', 'kits_pendentes', 'divergencia_fontes']
const LISTAS_DO_ANUNCIO = new Set(['sku_erp_sem_anuncio', 'anuncio_sem_custo', 'anuncio_sem_sku'])     // dependem de promo_anuncio (coleta de promoções)
const CODIGOS_KIT = ['kit_sem_estrutura', 'kit_componente_sem_custo']
const ESTADOS_FONTE = ['desconectado', 'conectado', 'erro', 'reautorizar', 'pausado']
const COBRA_FRESCOR = new Set(['conectado', 'erro', 'reautorizar'])                                  // "fonte conectada" p/ o frescor (desconectado/pausado não cobram)
const DE = { bling: 'do Bling', tiny: 'do Tiny', sheets: 'da planilha', upload: 'da planilha enviada' }
const MAX_LISTA = 200, DIA = 86400e3

let log = () => {}
export function configurarLog(fn) { log = typeof fn === 'function' ? fn : () => {} }

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const json = (s, padrao) => { try { return s ? JSON.parse(s) : padrao } catch { return padrao } }
const txt = (v, max) => String(v ?? '').slice(0, max)
const r1 = n => Math.round(n * 10) / 10
const brl = n => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const pct = n => `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const faixa = (v, min, max, padrao) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao }
const exigirCliente = c => { if (typeof c !== 'string' || !c.trim()) throw erro('cliente obrigatório') }
const exigirFonte = (f, lista = FONTES_EXTERNAS) => { if (!lista.includes(f)) throw erro(`fonte inválida: use ${lista.join(', ')}`) }
const custoValido = c => typeof c === 'number' && Number.isFinite(c) && c > 0 && c <= CUSTO_MAX       // revalida ao LER (linha inserida por fora não passa)
const variacaoPct = (novo, antes) => antes > 0 ? r1((novo - antes) / antes * 100) : null
const acimaDe = (novo, base, limitePct) => Math.round(Math.abs(novo - base) / base * 100 * 1e6) / 1e6 > limitePct   // arredonda: 0,3→0,45 é 50%, não 50,000…01%
const hashCusto = (cliente, key, fonte, campo, custoTxt) => createHash('sha256').update([cliente, key, fonte, campo, custoTxt].join('|')).digest('hex')
// defesa em profundidade (o M6 já sanitiza): token/segredo nunca chega a ultimo_erro
const sanitizarErro = v => txt(String(v ?? '').replace(/bearer\s+[^\s"',]+/gi, 'Bearer [removido]')
  .replace(/(\b(?:access_token|refresh_token|client_secret|code)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[removido]'), 300)

// ── normalização declarada (§5.1), sem fuzzy: espaços internos, caixa visível, zeros à esquerda e hífens ficam como vieram ──
const limparSku = s => typeof s === 'string' || (typeof s === 'number' && Number.isFinite(s))
  ? String(s).normalize('NFC').replace(/\u{A0}/gu, ' ').replace(/[\u{200B}-\u{200D}\u{FEFF}]/gu, '').trim() : ''
export function normalizarSku(s) { const t = limparSku(s); return t.length <= 80 ? t : '' }
export function chaveSku(s) { return normalizarSku(s).toLowerCase() }
// "não é este" (custo_vinculo 'recusado'): o SKU do próprio anúncio deixa de contar como "tem anúncio" para aquele custo (reconciliação e lote),
// igual à resolução única. skuLivre devolve a chave do SKU do anúncio, ou '' quando o par foi recusado.
const recusados = cliente => new Set(db.prepare("SELECT item_id, sku_custo FROM custo_vinculo WHERE cliente = ? AND origem = 'recusado'").all(cliente).map(r => `${r.item_id}|${r.sku_custo}`))
const skuLivre = (rec, a) => { const k = chaveSku(a.sku); return k && !rec.has(`${a.item_id}|${k}`) ? k : '' }
export function normalizarMlb(s) { const t = typeof s === 'string' ? s.trim().toUpperCase() : ''; return /^MLB\d{1,14}$/.test(t) ? t : '' }   // MLBU de catálogo não vale

// ── custo de máquina (§5.2): número JSON ou decimal canônico com ponto ("36.3200000000", formato dos ERPs). Vírgula, "R$", milhar = inválido:
// máquina não adivinha pt-BR (a colagem manual segue com parseNumeroBR). Arredonda a 4 casas ANTES de validar (0.00001 vira 0 e é rejeitado).
export function lerCustoMaquina(v) {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return { codigo: 'custo_ausente', motivo: 'custo vazio' }
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d{1,10})?$/.test(v.trim()) ? Number(v.trim()) : NaN
  if (!Number.isFinite(n)) return { codigo: 'custo_invalido', motivo: 'custo não numérico (use número com ponto decimal, ex.: 12.5; sem "R$", vírgula ou milhar)' }
  const r = Number(n.toFixed(4)), c = lerCusto(r)
  if (c.motivo) return r > CUSTO_MAX ? { codigo: 'custo_acima_maximo', motivo: 'custo acima de R$ 10.000.000' } : { codigo: 'custo_zero_ou_negativo', motivo: 'custo deve ser > 0 (zero ou negativo não é custo)' }
  return { custo: c.custo, custo_txt: String(c.custo) }           // já arredondado: "36.32", "0.0001" (sem expoente até 1e7)
}

// ── configuração por cliente (defaults = decisões do dono, §13) ─────────────────
const CFG_PADRAO = { ordem_fontes: ['manual', 'upload', 'bling', 'tiny', 'sheets'], limiar_variacao_pct: 50, quarentena_custo_ge_preco: 1, campo_custo_tiny: 'preco_custo', velho_dias_erp: 3, velho_dias_sheets: 14 }
const ordemValida = o => Array.isArray(o) && o.every(f => FONTES.includes(f)) && new Set(o).size === o.length
const LIM_CFG = { limiar_variacao_pct: [1, 1000, false], velho_dias_erp: [1, 365, true], velho_dias_sheets: [1, 365, true] }
const numeroCfg = v => typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : NaN
export function getCfgCustos(cliente) {
  const r = db.prepare('SELECT * FROM erp_cliente_cfg WHERE cliente = ?').get(cliente)
  if (!r) return { ...CFG_PADRAO, ordem_fontes: [...CFG_PADRAO.ordem_fontes], cliente, atualizado_em: '', por: '' }
  const ordem = json(r.ordem_fontes, null)
  return { ...r, ordem_fontes: ordemValida(ordem) ? ordem : [...CFG_PADRAO.ordem_fontes] }
}
export function setCfgCustos(cliente, patch, por = '') {
  exigirCliente(cliente)
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw erro('configuração inválida')
  const antes = getCfgCustos(cliente), novo = { ...antes }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'ordem_fontes') {
      const o = typeof v === 'string' ? json(v, null) : v
      if (!ordemValida(o)) throw erro(`ordem_fontes inválida: lista sem repetição de ${FONTES.join(', ')} (fonte fora da lista não é consumida)`)
      novo.ordem_fontes = o
    } else if (k === 'quarentena_custo_ge_preco') {
      if (![0, 1, '0', '1', true, false].includes(v)) throw erro('quarentena_custo_ge_preco inválido (0 ou 1)')
      novo[k] = v === true || v === 1 || v === '1' ? 1 : 0
    } else if (k === 'campo_custo_tiny') {
      if (!['preco_custo', 'custo_medio'].includes(v)) throw erro('campo_custo_tiny inválido: preco_custo ou custo_medio (sem fallback entre os dois)')
      novo[k] = v
    } else if (LIM_CFG[k]) {
      const [min, max, inteiro] = LIM_CFG[k], n = numeroCfg(v)
      if (!Number.isFinite(n) || n < min || n > max || (inteiro && !Number.isInteger(n))) throw erro(`${k} inválido (${min} a ${max}${inteiro ? ', inteiro' : ''}; envie um número)`)
      novo[k] = n
    } else throw erro(`campo de configuração desconhecido: ${k}`)
  }
  db.prepare(`INSERT INTO erp_cliente_cfg (cliente, ordem_fontes, limiar_variacao_pct, quarentena_custo_ge_preco, campo_custo_tiny, velho_dias_erp, velho_dias_sheets, atualizado_em, por)
    VALUES (@cliente,@ordem,@limiar_variacao_pct,@quarentena_custo_ge_preco,@campo_custo_tiny,@velho_dias_erp,@velho_dias_sheets,@em,@por)
    ON CONFLICT(cliente) DO UPDATE SET ordem_fontes=@ordem, limiar_variacao_pct=@limiar_variacao_pct, quarentena_custo_ge_preco=@quarentena_custo_ge_preco,
      campo_custo_tiny=@campo_custo_tiny, velho_dias_erp=@velho_dias_erp, velho_dias_sheets=@velho_dias_sheets, atualizado_em=@em, por=@por`)
    .run({ cliente, ordem: JSON.stringify(novo.ordem_fontes), limiar_variacao_pct: novo.limiar_variacao_pct, quarentena_custo_ge_preco: novo.quarentena_custo_ge_preco,
      campo_custo_tiny: novo.campo_custo_tiny, velho_dias_erp: novo.velho_dias_erp, velho_dias_sheets: novo.velho_dias_sheets, em: agora(), por: txt(por, 80) })
  const depois = getCfgCustos(cliente)
  auditar(cliente, 'custos_config', { autor: por, antes, depois, detalhe: Object.keys(patch).join(', ') })
  return depois
}

// ── statements compartilhados (as tabelas já existem: promocoes-db.js roda o SCHEMA no import) ──
const stVig = db.prepare('SELECT * FROM erp_custos_sku WHERE cliente = ? AND sku_key = ? AND fonte = ?')
const stQ = db.prepare('SELECT * FROM erp_quarentena WHERE cliente = ? AND sku_key = ? AND fonte = ?')
const stDelQ = db.prepare('DELETE FROM erp_quarentena WHERE cliente = ? AND sku_key = ? AND fonte = ?')
const stDelQPend = db.prepare("DELETE FROM erp_quarentena WHERE cliente = ? AND sku_key = ? AND fonte = ? AND estado = 'pendente'")
const stDelRej = db.prepare('DELETE FROM erp_rejeitadas WHERE cliente = ? AND fonte = ? AND chave = ?')
const stVisto = db.prepare("UPDATE erp_custos_sku SET visto_em = ?, nao_visto_desde = '' WHERE cliente = ? AND sku_key = ? AND fonte = ?")
const stUpVig = db.prepare(`INSERT INTO erp_custos_sku (cliente, sku_key, fonte, sku, custo, custo_txt, campo, id_externo, mlb_dica, atualizado_na_fonte, recebido_em, visto_em, nao_visto_desde, hash, lote_id)
  VALUES (@cliente,@sku_key,@fonte,@sku,@custo,@custo_txt,@campo,@id_externo,@mlb_dica,@atualizado_na_fonte,@em,@em,'',@hash,@lote_id)
  ON CONFLICT(cliente, sku_key, fonte) DO UPDATE SET sku=@sku, custo=@custo, custo_txt=@custo_txt, campo=@campo, id_externo=@id_externo, mlb_dica=@mlb_dica,
    atualizado_na_fonte=@atualizado_na_fonte, recebido_em=@em, visto_em=@em, nao_visto_desde='', hash=@hash, lote_id=@lote_id`)
const stUpQ = db.prepare(`INSERT INTO erp_quarentena (cliente, sku_key, fonte, sku, motivo, custo_proposto, custo_txt, campo, id_externo, mlb_dica, atualizado_na_fonte, custo_vigente, variacao_pct, preco_ref, estado, recebido_em, lote_id)
  VALUES (@cliente,@sku_key,@fonte,@sku,@motivo,@custo,@custo_txt,@campo,@id_externo,@mlb_dica,@atualizado_na_fonte,@custo_vigente,@variacao_pct,@preco_ref,'pendente',@recebido_em,@lote_id)
  ON CONFLICT(cliente, sku_key, fonte) DO UPDATE SET sku=@sku, motivo=@motivo, custo_proposto=@custo, custo_txt=@custo_txt, campo=@campo, id_externo=@id_externo, mlb_dica=@mlb_dica,
    atualizado_na_fonte=@atualizado_na_fonte, custo_vigente=@custo_vigente, variacao_pct=@variacao_pct, preco_ref=@preco_ref, estado='pendente', recebido_em=@recebido_em,
    lote_id=@lote_id, decidido_por='', decidido_em=''`)
const stRej = db.prepare(`INSERT INTO erp_rejeitadas (cliente, fonte, chave, sku, mlb, codigo, motivo, custo_txt, custo_mantido, linha, lote_id, em)
  VALUES (@cliente,@fonte,@chave,@sku,@mlb,@codigo,@motivo,@custo_txt,@custo_mantido,@linha,@lote_id,@em)
  ON CONFLICT(cliente, fonte, chave) DO UPDATE SET sku=@sku, mlb=@mlb, codigo=@codigo, motivo=@motivo, custo_txt=@custo_txt, custo_mantido=@custo_mantido, linha=@linha, lote_id=@lote_id, em=@em`)
const stHist = db.prepare(`INSERT INTO erp_custos_hist (cliente, sku_key, sku, fonte, evento, custo_antes, custo_depois, variacao_pct, campo, lote_id, atualizado_na_fonte, em, por, detalhe)
  VALUES (@cliente,@sku_key,@sku,@fonte,@evento,@custo_antes,@custo_depois,@variacao_pct,@campo,@lote_id,@atualizado_na_fonte,@em,@por,@detalhe)`)
const hist = h => stHist.run({ custo_antes: null, custo_depois: null, variacao_pct: null, campo: '', lote_id: '', atualizado_na_fonte: '', por: '', ...h, detalhe: txt(h.detalhe, 500) })
const brutoTxt = v => { try { return txt(v !== null && typeof v === 'object' ? JSON.stringify(v) : v, 40) } catch { return '' } }

// ── aplicarLote (§5.3–5.6, §5.10): transação única; linha ruim vira rejeição, NUNCA exceção. Erro de argumento (programação) lança 400 ──
export function aplicarLote({ cliente, fonte, modo = 'parcial', lote_id = '', linhas, origem = 'sync', por = '' } = {}) {
  exigirCliente(cliente); exigirFonte(fonte, FONTES_LOTE)
  if (!['parcial', 'completo'].includes(modo)) throw erro('modo inválido (parcial | completo)')
  if (!['webhook', 'sync', 'fila', 'upload'].includes(origem)) throw erro('origem inválida (webhook | sync | fila | upload)')
  if (!Array.isArray(linhas)) throw erro('linhas deve ser uma lista')
  if (linhas.length > 20000) throw erro('máximo de 20.000 linhas por lote')
  lote_id = txt(lote_id, 64); por = txt(por, 80)
  const em = agora(), cfg = getCfgCustos(cliente)
  const R = { lote_id, recebidas: linhas.length, aceitas: 0, novas: 0, alteradas: 0, inalteradas: 0, recusado_antes: 0, recusado_antes_lista: [], duplicadas_iguais: 0,
    em_quarentena: 0, quarentena_lista: [], rejeitadas: 0, rejeitadas_lista: [], impacto: { skus_com_aprovacao_afetada: 0 } }
  db.transaction(() => {
    const anuncios = db.prepare('SELECT item_id, sku, user_product_id, preco, preco_original FROM promo_anuncio WHERE cliente = ?').all(cliente)
    const skuDoMlb = new Map(anuncios.map(a => [String(a.item_id).toUpperCase(), String(a.sku || '')]))
    // chaves do anúncio: o SKU dele (custo novo que ainda não casou) + a da resolução única (vínculo manual, SKU normalizado, grupo)
    // ponytail: custo NOVO que só casaria por SKU normalizado/grupo não tem preço de referência neste lote (casa a partir do próximo)
    const res = vinculosCusto.custosDosAnuncios(cliente, anuncios), rec = recusados(cliente), chavesDe = a => [skuLivre(rec, a), res.get(a.item_id)?.chave].filter(Boolean)
    const precoRef = new Map()               // chave do lado do anúncio (= consumidor): MENOR COALESCE(NULLIF(preco_original,0), preco)
    for (const a of anuncios) { const p = a.preco_original > 0 ? a.preco_original : a.preco; for (const k of chavesDe(a)) if (p > 0 && !(precoRef.get(k) <= p)) precoRef.set(k, p) }
    const comAprovacao = new Set(db.prepare(`SELECT DISTINCT a.item_id, a.sku FROM promo_decisao d JOIN promo_anuncio a ON a.cliente = d.cliente AND a.item_id = d.item_id
      WHERE d.cliente = ? AND d.aprovado = 1 AND d.marcado = 1`).all(cliente).flatMap(chavesDe))
    const afetados = new Set()

    const rejeitar = (l, i, { key = '', sku = '', mlb = '', chave = '' }, codigo, motivo) => {
      const linha = Number.isInteger(l.linha) ? l.linha : Number.isInteger(l.line) ? l.line : null, id = txt(l.id_externo, 64)
      chave ||= key ? `sku:${key}` : id ? `id:${id}` : mlb ? `mlb:${mlb}` : `linha:${linha ?? i + 1}`
      const vig = key ? stVig.get(cliente, key, fonte) : null
      if (vig) stVisto.run(em, cliente, key, fonte)     // o SKU está na fonte (só a linha é inválida): o custo não muda e ele não vira "não visto"
      stRej.run({ cliente, fonte, chave, sku: txt(sku, 80), mlb: txt(mlb, 20), codigo, motivo: txt(motivo, 300), custo_txt: brutoTxt(l.custo),
        custo_mantido: vig?.custo ?? null, linha: linha == null ? '' : String(linha), lote_id, em })
      R.rejeitadas++
      if (R.rejeitadas_lista.length < MAX_LISTA) R.rejeitadas_lista.push({ sku: txt(sku, 80), mlb: txt(mlb, 20), linha, codigo, motivo })
    }

    // 1) identidade da linha: SKU/MLB declarados, sem adivinhar
    const candidatas = []
    linhas.forEach((l0, i) => {
      const l = l0 && typeof l0 === 'object' && !Array.isArray(l0) ? l0 : {}
      const tipoOk = l.sku == null || typeof l.sku === 'string' || (typeof l.sku === 'number' && Number.isFinite(l.sku))
      let sku = limparSku(l.sku)
      const mlbBruto = l.mlb == null ? '' : String(l.mlb).trim(), mlb = normalizarMlb(mlbBruto)
      if (!tipoOk) return rejeitar(l, i, { mlb }, 'sku_invalido', 'SKU com tipo inválido (envie texto)')
      if (sku.length > 80) return rejeitar(l, i, { sku, mlb }, 'sku_invalido', 'SKU com mais de 80 caracteres')
      if (mlbBruto && !mlb) return rejeitar(l, i, { sku, mlb: mlbBruto.toUpperCase() }, 'mlb_invalido', 'MLB inválido: use MLB seguido de números (MLBU de catálogo não vale)')
      if (!sku && !mlb) return rejeitar(l, i, {}, 'sku_vazio', 'linha sem SKU e sem MLB')
      if (mlb) {
        const doAnuncio = skuDoMlb.get(mlb)
        if (sku && doAnuncio && chaveSku(doAnuncio) !== chaveSku(sku))
          return rejeitar(l, i, { key: sku.toLowerCase(), sku, mlb, chave: `mlb:${mlb}` }, 'conflito_sku_mlb', `o anúncio ${mlb} tem o SKU "${txt(doAnuncio, 80)}" no Mercado Livre e a linha diz "${sku}": nada foi casado`)
        if (!sku) {
          sku = normalizarSku(doAnuncio)
          if (!sku) return rejeitar(l, i, { mlb }, 'mlb_sem_sku', doAnuncio === undefined ? `o anúncio ${mlb} não está na última coleta de promoções do cliente: sem SKU para casar` : `o anúncio ${mlb} não tem SKU no Mercado Livre: nada é casado por adivinhação`)
        }
      }
      candidatas.push({ l, i, key: sku.toLowerCase(), sku, mlb, c: CODIGOS_KIT.includes(l.kit_pendente) ? { codigo: l.kit_pendente } : lerCustoMaquina(l.custo) })
    })

    // 2) SKU repetido no lote: custos iguais = vale um; diferentes (ou algum inválido) = TODAS rejeitadas (o último ganharia em silêncio)
    const grupos = new Map()
    for (const x of candidatas) { if (!grupos.has(x.key)) grupos.set(x.key, []); grupos.get(x.key).push(x) }
    const aplicar = []
    for (const g of grupos.values()) {
      if (g.length === 1 || g.every(x => x.c.codigo)) { aplicar.push(...g); continue }
      const valores = [...new Set(g.map(x => x.c.custo_txt ?? '(inválido)'))]
      if (valores.length === 1) { aplicar.push(g[0]); R.duplicadas_iguais += g.length - 1; continue }
      for (const x of g) rejeitar(x.l, x.i, x, 'sku_duplicado_no_lote', `SKU repetido no lote com custos diferentes (${valores.slice(0, 5).join(' / ')}): nenhum vale`)
    }

    // 3) custo, sanidade/quarentena, mudança e histórico
    for (const { l, i, key, sku, mlb, c } of aplicar.sort((a, b) => a.i - b.i)) {
      if (c.codigo) {
        const kit = { kit_sem_estrutura: 'estrutura de componentes do kit não disponível: custo do kit pendente (nada é inventado)', kit_componente_sem_custo: 'componente do kit sem custo válido: a soma não é calculada' }[c.codigo]
        rejeitar(l, i, { key, sku, mlb }, c.codigo, (kit || c.motivo) + (l.dica ? ` — ${txt(l.dica, 160)}` : ''))
        continue
      }
      const campo = txt(l.campo || (fonte === 'sheets' ? 'sheets.coluna_custo' : fonte === 'upload' ? 'upload.coluna_custo' : ''), 80), id_externo = txt(l.id_externo, 64)
      const atualizado_na_fonte = typeof l.atualizado_na_fonte === 'string' ? txt(l.atualizado_na_fonte, 40) : ''
      const hash = hashCusto(cliente, key, fonte, campo, c.custo_txt), vig = stVig.get(cliente, key, fonte)
      stDelRej.run(cliente, fonte, `sku:${key}`); if (id_externo) stDelRej.run(cliente, fonte, `id:${id_externo}`)     // linha aceita limpa a rejeição dela
      const linha = Number.isInteger(l.linha) ? l.linha : Number.isInteger(l.line) ? l.line : null
      if (vig?.hash === hash) { stVisto.run(em, cliente, key, fonte); stDelQPend.run(cliente, key, fonte); R.inalteradas++; R.aceitas++; continue }
      const q = stQ.get(cliente, key, fonte)
      if (q?.estado === 'recusada' && q.custo_txt === c.custo_txt) {   // o dono já recusou ESTE valor: o vigente continua (a planilha mostra "recusado", nunca "OK")
        if (vig) stVisto.run(em, cliente, key, fonte)
        R.recusado_antes++
        if (R.recusado_antes_lista.length < MAX_LISTA) R.recusado_antes_lista.push({ sku, linha, custo_mantido: vig?.custo ?? null,
          motivo: vig ? `o painel mantém ${brl(vig.custo)} (custo anterior ${DE[fonte]})` : `não há custo anterior ${DE[fonte]} para este SKU no painel` })
        continue
      }
      // preco_ref da linha: o upload já resolveu o anúncio (inclusive fora de promo_anuncio, pelo F1); só vale quando a coleta de promoções não deu referência
      const variacao = vig ? variacaoPct(c.custo, vig.custo) : null, ref = precoRef.get(key) ?? (typeof l.preco_ref === 'number' && l.preco_ref > 0 ? l.preco_ref : null)
      const proprio = l.kit_custo_proprio == null ? null : lerCustoMaquina(l.kit_custo_proprio)
      const motivos = []
      if (vig && acimaDe(c.custo, vig.custo, cfg.limiar_variacao_pct)) motivos.push(['variacao_brusca', `variação de ${pct(variacao)} sobre ${brl(vig.custo)} (limite ${cfg.limiar_variacao_pct}%)`])
      if (cfg.quarentena_custo_ge_preco && ref != null && c.custo >= ref) motivos.push(['custo_ge_preco', `custo ${brl(c.custo)} ≥ preço cheio do anúncio (${brl(ref)})`])
      if (proprio?.custo && acimaDe(c.custo, proprio.custo, 1)) motivos.push(['kit_divergente', `soma dos componentes ${brl(c.custo)} difere do custo próprio do kit ${brl(proprio.custo)} em mais de 1%`])
      if (motivos.length) {                   // quarentena: o vigente NÃO muda; o SKU está na fonte (não vira "não visto")
        const codigo = motivos[0][0], motivo = motivos.map(m => m[1]).join('; ')
        const mesma = q?.estado === 'pendente' && q.custo_txt === c.custo_txt && q.campo === campo
        if (vig) stVisto.run(em, cliente, key, fonte)
        stUpQ.run({ cliente, sku_key: key, fonte, sku, motivo: codigo, custo: c.custo, custo_txt: c.custo_txt, campo, id_externo, mlb_dica: mlb, atualizado_na_fonte,
          custo_vigente: vig?.custo ?? null, variacao_pct: variacao, preco_ref: ref, recebido_em: mesma ? q.recebido_em : em, lote_id })
        if (!mesma) hist({ cliente, sku_key: key, sku, fonte, evento: 'quarentena', custo_antes: vig?.custo ?? null, custo_depois: c.custo, variacao_pct: variacao, campo, lote_id, atualizado_na_fonte, em, por, detalhe: motivo })
        R.em_quarentena++
        if (R.quarentena_lista.length < MAX_LISTA) R.quarentena_lista.push({ sku, linha, codigo, motivo, variacao_pct: variacao })
        continue
      }
      stUpVig.run({ cliente, sku_key: key, fonte, sku, custo: c.custo, custo_txt: c.custo_txt, campo, id_externo, mlb_dica: mlb, atualizado_na_fonte, em, hash, lote_id })
      stDelQ.run(cliente, key, fonte)          // proposta pendente/recusada antiga perde para o valor aceito agora
      hist({ cliente, sku_key: key, sku, fonte, evento: vig ? 'alterado' : 'novo', custo_antes: vig?.custo ?? null, custo_depois: c.custo, variacao_pct: variacao, campo, lote_id, atualizado_na_fonte, em, por })
      if (vig) R.alteradas++; else R.novas++
      R.aceitas++
      if (comAprovacao.has(key)) afetados.add(key)
    }
    R.impacto.skus_com_aprovacao_afetada = afetados.size
    if (origem === 'webhook') {               // liveness (§5.8): lote autenticado e processado = fonte viva, por mais linhas que tenham sido rejeitadas
      const e = estadoFonte(cliente, fonte)
      gravarEstadoFonte(cliente, fonte, { estado: ['desconectado', 'erro'].includes(e.estado) ? 'conectado' : e.estado, ultimo_sync_em: em, ultimo_sync_ok_em: em, ultimo_erro: '' })
    }
    auditar(cliente, 'custos_lote', { autor: por || origem, detalhe: `${fonte} · ${modo} · ${origem}${lote_id ? ` · lote ${lote_id}` : ''}: ${R.recebidas} recebida(s), ${R.novas} nova(s), ${R.alteradas} alterada(s), ${R.inalteradas} inalterada(s), `
      + `${R.em_quarentena} em quarentena, ${R.recusado_antes} já recusada(s), ${R.rejeitadas} rejeitada(s)${afetados.size ? ` — ${afetados.size} SKU(s) com aprovação de promoção afetada: a aprovação valia para a MC antiga e pode ser revogada na próxima rodada` : ''}` })
  })()
  log('info', `custos: lote ${fonte}/${origem} · ${R.recebidas} recebida(s), ${R.aceitas} aceita(s), ${R.em_quarentena} em quarentena, ${R.rejeitadas} rejeitada(s)`)
  return R
}

// ── fecha o envio COMPLETO (§5.6): só marca "não visto" — NUNCA apaga SKU nem zera custo. Quem chama garante que todos os lotes chegaram ──
export function fecharSyncCompleto(cliente, fonte, inicioISO) {
  exigirCliente(cliente); exigirFonte(fonte)
  if (typeof inicioISO !== 'string' || !Number.isFinite(Date.parse(inicioISO))) throw erro('inicioISO inválido')
  const inicio = new Date(inicioISO).toISOString()
  let r
  db.transaction(() => {
    db.prepare("UPDATE erp_custos_sku SET nao_visto_desde = ? WHERE cliente = ? AND fonte = ? AND visto_em < ? AND nao_visto_desde = ''").run(inicio, cliente, fonte, inicio)
    r = { nao_vistos: db.prepare('SELECT COUNT(*) n FROM erp_custos_sku WHERE cliente = ? AND fonte = ? AND visto_em < ?').get(cliente, fonte, inicio).n,
      rejeitadas_removidas: db.prepare('DELETE FROM erp_rejeitadas WHERE cliente = ? AND fonte = ? AND em < ?').run(cliente, fonte, inicio).changes }
    auditar(cliente, 'custos_sync_completo', { autor: 'sistema', depois: r, detalhe: `${fonte} · envio completo iniciado em ${inicio}` })
  })()
  return r
}

// ── precedência de leitura (§5.7): 1ª fonte de cfg.ordem_fontes com custo válido vence; fonte fora da lista não é consumida; quarentena não existe aqui ──
function candidatos(cliente) {
  const por = new Map(), add = (k, x) => { if (!por.has(k)) por.set(k, {}); por.get(k)[x.fonte] = x }
  for (const r of db.prepare('SELECT sku, custo, fonte, atualizado_em FROM promo_custos_sku WHERE cliente = ?').all(cliente))   // camada manual: a MESMA chave das fontes externas
    add(chaveSku(r.sku) || String(r.sku).toLowerCase(), { fonte: 'manual', sku: String(r.sku), custo: r.custo, campo: r.fonte, atualizado_na_fonte: '', recebido_em: r.atualizado_em, visto_em: r.atualizado_em, nao_visto_desde: '', id_externo: '' })
  for (const r of db.prepare('SELECT sku_key, sku, fonte, custo, campo, atualizado_na_fonte, recebido_em, visto_em, nao_visto_desde, id_externo FROM erp_custos_sku WHERE cliente = ?').all(cliente))
    add(r.sku_key, r)
  return por
}
function vencedores(cliente, cfg = getCfgCustos(cliente)) {
  const m = new Map()
  for (const [k, fs] of candidatos(cliente)) { const v = cfg.ordem_fontes.map(f => fs[f]).find(x => x && custoValido(x.custo)); if (v) m.set(k, { v, fs }) }
  return m
}
export function custosEfetivos(cliente) {
  return new Map([...vencedores(cliente)].map(([k, { v }]) => [k, v.custo]))      // drop-in de custosSku: Map<sku_minúsculo, número>
}
// resolução única custo ↔ anúncio (custo-vinculo.js): manual > SKU exato > SKU normalizado (chave única) > grupo user_product_id
export const vinculosCusto = criarCustoVinculo(db, { efetivos: cliente => new Map([...vencedores(cliente)].map(([k, { v }]) => [k, { sku: v.sku, custo: v.custo }])), chaveSku, auditar })
function frescor(e, cfg, agoraMs) {
  const limite = e.fonte === 'sheets' ? cfg.velho_dias_sheets : cfg.velho_dias_erp, ok = Date.parse(e.ultimo_sync_ok_em), dias = (agoraMs - ok) / DIA
  return { limite, idade_dias: Number.isFinite(ok) ? r1(dias) : null, velha: COBRA_FRESCOR.has(e.estado) && (!Number.isFinite(ok) || dias > limite) }
}
export function custosEfetivosDetalhe(cliente, { fonte = '', q = '', limite = 200, offset = 0 } = {}) {
  if (fonte) exigirFonte(fonte, FONTES)
  const cfg = getCfgCustos(cliente), agoraMs = Date.now(), busca = String(q ?? '').trim().toLowerCase().slice(0, 80)
  const velha = Object.fromEntries(FONTES_EXTERNAS.map(f => [f, frescor(estadoFonte(cliente, f), cfg, agoraMs).velha]))
  const itens = []
  for (const [k, { v, fs }] of vencedores(cliente, cfg)) {
    if ((fonte && v.fonte !== fonte) || (busca && !k.includes(busca))) continue
    const vistoMs = Date.parse(v.visto_em)
    itens.push({ sku: v.sku, custo: v.custo, fonte: v.fonte, campo: v.campo, atualizado_na_fonte: v.atualizado_na_fonte, recebido_em: v.recebido_em, visto_em: v.visto_em,
      nao_visto_desde: v.nao_visto_desde, id_externo: v.id_externo, idade_dias: Number.isFinite(vistoMs) ? r1((agoraMs - vistoMs) / DIA) : null, velha: !!velha[v.fonte],
      perdedoras: Object.values(fs).filter(x => x !== v && custoValido(x.custo)).map(x => ({ fonte: x.fonte, custo: x.custo })) })
  }
  itens.sort((a, b) => a.sku.localeCompare(b.sku))
  const off = faixa(offset, 0, 1e9, 0)
  return { total: itens.length, itens: itens.slice(off, off + faixa(limite, 1, 1000, 200)) }
}

export function historicoSku(cliente, sku, limite = 100) {
  const k = chaveSku(sku)
  if (!k) throw erro('SKU inválido')
  return db.prepare(`SELECT id, sku, fonte, evento, custo_antes, custo_depois, variacao_pct, campo, lote_id, atualizado_na_fonte, em, por, detalhe
    FROM erp_custos_hist WHERE cliente = ? AND sku_key = ? ORDER BY id DESC LIMIT ?`).all(cliente, k, faixa(limite, 1, 1000, 100))
}

// ── quarentena e descarte (decisões do dono, auditadas) ──────────────────────
export function listarQuarentena(cliente, { estado = 'pendente' } = {}) {
  if (!['pendente', 'recusada'].includes(estado)) throw erro('estado inválido (pendente | recusada)')
  return db.prepare(`SELECT sku, fonte, motivo, custo_proposto, custo_txt, campo, id_externo, mlb_dica, atualizado_na_fonte, custo_vigente, variacao_pct, preco_ref,
    estado, recebido_em, lote_id, decidido_por, decidido_em FROM erp_quarentena WHERE cliente = ? AND estado = ? ORDER BY recebido_em DESC, sku`).all(cliente, estado)
}
export function decidirQuarentena(cliente, itens, decisao, por = '') {
  exigirCliente(cliente)
  if (!['aprovar', 'recusar'].includes(decisao)) throw erro('decisao inválida (aprovar | recusar)')
  if (!Array.isArray(itens) || !itens.length || itens.length > 5000) throw erro('itens: lista de {sku, fonte} (1 a 5.000)')
  por = txt(por, 80)
  const em = agora(), r = { aprovados: 0, recusados: 0, ignorados: 0 }
  db.transaction(() => {
    for (const it of itens) {
      const key = chaveSku(it?.sku), fonte = it?.fonte
      const q = key && FONTES_LOTE.includes(fonte) ? stQ.get(cliente, key, fonte) : null
      if (q?.estado !== 'pendente') { r.ignorados++; continue }
      const vig = stVig.get(cliente, key, fonte), base = { cliente, sku_key: key, sku: q.sku, fonte, custo_antes: vig?.custo ?? null, custo_depois: q.custo_proposto,
        variacao_pct: vig ? variacaoPct(q.custo_proposto, vig.custo) : null, campo: q.campo, lote_id: q.lote_id, atualizado_na_fonte: q.atualizado_na_fonte, em, por }
      if (decisao === 'recusar') {
        db.prepare("UPDATE erp_quarentena SET estado = 'recusada', decidido_por = ?, decidido_em = ? WHERE cliente = ? AND sku_key = ? AND fonte = ?").run(por, em, cliente, key, fonte)
        hist({ ...base, evento: 'recusado', detalhe: `quarentena (${q.motivo}) recusada: o vigente continua` }); r.recusados++
        continue
      }
      stUpVig.run({ cliente, sku_key: key, fonte, sku: q.sku, custo: q.custo_proposto, custo_txt: q.custo_txt, campo: q.campo, id_externo: q.id_externo, mlb_dica: q.mlb_dica,
        atualizado_na_fonte: q.atualizado_na_fonte, em, hash: hashCusto(cliente, key, fonte, q.campo, q.custo_txt), lote_id: q.lote_id })
      stDelQ.run(cliente, key, fonte)
      hist({ ...base, evento: 'aprovado', detalhe: `quarentena (${q.motivo}) aprovada` }); r.aprovados++
    }
    auditar(cliente, 'custos_quarentena', { autor: por, depois: r, detalhe: `${decisao}: ${r.aprovados + r.recusados} decidido(s), ${r.ignorados} ignorado(s) (sem quarentena pendente)` })
  })()
  return r
}
// remove o vigente da fonte (volta a SEM CUSTO se nenhuma outra fonte tiver). Só fontes externas: o manual segue pela aba Custos das promoções
export function descartarCusto(cliente, sku, fonte, por = '') {
  exigirCliente(cliente); exigirFonte(fonte, FONTES_LOTE)
  const key = chaveSku(sku)
  if (!key) throw erro('SKU inválido')
  const vig = stVig.get(cliente, key, fonte)
  if (!vig) throw erro('não há custo vigente desta fonte para o SKU', 404)
  const em = agora()
  db.transaction(() => {
    db.prepare('DELETE FROM erp_custos_sku WHERE cliente = ? AND sku_key = ? AND fonte = ?').run(cliente, key, fonte)
    hist({ cliente, sku_key: key, sku: vig.sku, fonte, evento: 'descartado', custo_antes: vig.custo, campo: vig.campo, lote_id: vig.lote_id, em, por: txt(por, 80), detalhe: 'descartado pelo dono' })
    auditar(cliente, 'custos_descarte', { autor: por, antes: { sku: vig.sku, fonte, custo: vig.custo, campo: vig.campo } })
  })()
  return { sku: vig.sku, fonte, custo_antes: vig.custo }
}

// ── reconciliação (§10.1), calculada na LEITURA. Custo do anúncio = a resolução única (vinculosCusto: manual > SKU > SKU normalizado > grupo), igual ao consumidor ──
const porFat = (a, b) => (b.fat30 || 0) - (a.fat30 || 0) || String(a.item_id).localeCompare(String(b.item_id))
const anuncioItem = a => ({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, status: a.status, preco: a.preco, preco_original: a.preco_original, fat30: a.fat30 })
function cobertura(anuncios, comCusto) {                // comCusto = Map(item_id → custo resolvido)
  const comSku = anuncios.filter(a => a.sku), temCusto = a => comCusto.has(a.item_id)
  const fat = l => l.reduce((s, a) => s + (a.fat30 || 0), 0), total = fat(anuncios)
  return { anuncios_total: anuncios.length, anuncios_sem_sku: anuncios.length - comSku.length, anuncios_sem_custo: comSku.filter(a => !temCusto(a)).length,
    cobertura_receita_pct: total > 0 ? r1(fat(anuncios.filter(temCusto)) / total * 100) : null }
}
export function reconciliacao(cliente, lista, { limite = 200 } = {}) {
  exigirCliente(cliente)
  if (!LISTAS.includes(lista)) throw erro(`lista inválida: use ${LISTAS.join(', ')}`)
  const anuncios = db.prepare('SELECT item_id, sku, titulo, status, preco, preco_original, fat30, user_product_id FROM promo_anuncio WHERE cliente = ?').all(cliente)
  const disponivel = anuncios.length > 0, motivo = disponivel ? '' : 'rode a coleta de promoções do cliente'
  if (LISTAS_DO_ANUNCIO.has(lista) && !disponivel) return { lista, disponivel, motivo, total: 0, itens: [], cobertura: null }
  const efetivos = custosEfetivos(cliente), res = disponivel ? vinculosCusto.custosDosAnuncios(cliente, anuncios) : new Map(), cob = disponivel ? cobertura(anuncios, res) : null
  const fim = itens => ({ lista, disponivel: true, motivo: '', total: itens.length, itens: itens.slice(0, faixa(limite, 1, 1000, 200)), cobertura: cob })
  const rej = (codigos = null) => db.prepare(`SELECT fonte, chave, sku, mlb, codigo, motivo, custo_txt, custo_mantido, linha, lote_id, em FROM erp_rejeitadas WHERE cliente = ?
    ${codigos ? `AND codigo IN (${codigos.map(() => '?').join(',')})` : ''} ORDER BY em DESC, chave`).all(cliente, ...(codigos || []))
  switch (lista) {
    case 'anuncio_sem_sku': return fim(anuncios.filter(a => !a.sku).sort(porFat).map(anuncioItem))
    case 'anuncio_sem_custo': return fim(anuncios.filter(a => a.sku && !res.has(a.item_id)).sort(porFat).map(anuncioItem))
    case 'sku_erp_sem_anuncio': {               // SKU do anúncio + o que a resolução única ligou (vínculo manual, SKU normalizado, grupo)
      const rec = recusados(cliente), doAnuncio = new Set([...anuncios.map(a => skuLivre(rec, a)), ...[...res.values()].map(r => r.chave)].filter(Boolean)), m = new Map()
      for (const r of db.prepare('SELECT sku_key, sku, fonte, custo FROM erp_custos_sku WHERE cliente = ? ORDER BY sku_key, fonte').all(cliente))
        if (!doAnuncio.has(r.sku_key)) { if (!m.has(r.sku_key)) m.set(r.sku_key, { sku: r.sku, fontes: [] }); m.get(r.sku_key).fontes.push({ fonte: r.fonte, custo: r.custo }) }
      return fim([...m.values()])
    }
    case 'conflito': return fim(rej(['conflito_sku_mlb']))
    case 'rejeitadas': return fim(rej())
    case 'kits_pendentes': return fim(rej(CODIGOS_KIT))
    case 'quarentena': return fim(listarQuarentena(cliente))
    case 'nao_visto': return fim(db.prepare(`SELECT sku, fonte, custo, campo, id_externo, visto_em, nao_visto_desde FROM erp_custos_sku
      WHERE cliente = ? AND nao_visto_desde <> '' ORDER BY nao_visto_desde, sku`).all(cliente))
    case 'divergencia_fontes': {
      const itens = []
      for (const [k, fs] of candidatos(cliente)) {
        const valores = Object.values(fs).filter(x => custoValido(x.custo))
        if (new Set(valores.map(x => x.custo)).size > 1) itens.push({ sku: valores[0].sku, efetiva: efetivos.get(k) ?? null, valores: valores.map(x => ({ fonte: x.fonte, custo: x.custo })) })
      }
      return fim(itens.sort((a, b) => a.sku.localeCompare(b.sku)))
    }
  }
}

// ── estado por fonte, resumo do cartão e pendências (§5.8) ─────────────────────
export function estadoFonte(cliente, fonte) {
  exigirFonte(fonte)
  const r = db.prepare('SELECT * FROM erp_fontes WHERE cliente = ? AND fonte = ?').get(cliente, fonte) || { cliente, fonte, estado: 'desconectado', ultimo_sync_em: '', ultimo_sync_ok_em: '',
    ultimo_resumo_json: '{}', ultimo_erro: '', sync_estado: '', sync_iniciada_em: '', tentativas_dia: 0, tentativas_dia_data: '', criado_em: '', atualizado_em: '' }
  return { ...r, ultimo_resumo: json(r.ultimo_resumo_json, {}) }
}
const TEXTO_FONTE = ['ultimo_sync_em', 'ultimo_sync_ok_em', 'sync_iniciada_em', 'tentativas_dia_data']
export function gravarEstadoFonte(cliente, fonte, patch = {}) {
  exigirCliente(cliente); exigirFonte(fonte)
  const n = { ...estadoFonte(cliente, fonte) }
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'estado') { if (!ESTADOS_FONTE.includes(v)) throw erro(`estado inválido (${ESTADOS_FONTE.join(' | ')})`); n.estado = v }
    else if (k === 'sync_estado') { if (!['', 'rodando'].includes(v)) throw erro("sync_estado inválido ('' | 'rodando')"); n.sync_estado = v }
    else if (k === 'ultimo_resumo') n.ultimo_resumo_json = JSON.stringify(v ?? {}).slice(0, 20000)
    else if (k === 'ultimo_erro') n.ultimo_erro = sanitizarErro(v)
    else if (k === 'tentativas_dia') { const t = Math.trunc(Number(v)); if (!Number.isFinite(t) || t < 0) throw erro('tentativas_dia inválido'); n.tentativas_dia = t }
    else if (TEXTO_FONTE.includes(k)) n[k] = txt(v, 40)
    else throw erro(`campo de estado desconhecido: ${k}`)
  }
  const em = agora()
  db.prepare(`INSERT INTO erp_fontes (cliente, fonte, estado, ultimo_sync_em, ultimo_sync_ok_em, ultimo_resumo_json, ultimo_erro, sync_estado, sync_iniciada_em, tentativas_dia, tentativas_dia_data, criado_em, atualizado_em)
    VALUES (@cliente,@fonte,@estado,@ultimo_sync_em,@ultimo_sync_ok_em,@ultimo_resumo_json,@ultimo_erro,@sync_estado,@sync_iniciada_em,@tentativas_dia,@tentativas_dia_data,@em,@em)
    ON CONFLICT(cliente, fonte) DO UPDATE SET estado=@estado, ultimo_sync_em=@ultimo_sync_em, ultimo_sync_ok_em=@ultimo_sync_ok_em, ultimo_resumo_json=@ultimo_resumo_json,
      ultimo_erro=@ultimo_erro, sync_estado=@sync_estado, sync_iniciada_em=@sync_iniciada_em, tentativas_dia=@tentativas_dia, tentativas_dia_data=@tentativas_dia_data, atualizado_em=@em`)
    .run({ cliente, fonte, estado: n.estado, ultimo_sync_em: n.ultimo_sync_em, ultimo_sync_ok_em: n.ultimo_sync_ok_em, ultimo_resumo_json: n.ultimo_resumo_json, ultimo_erro: n.ultimo_erro,
      sync_estado: n.sync_estado, sync_iniciada_em: n.sync_iniciada_em, tentativas_dia: n.tentativas_dia, tentativas_dia_data: n.tentativas_dia_data, em })
  return estadoFonte(cliente, fonte)
}
const contarPorFonte = (sql, cliente) => Object.fromEntries(db.prepare(sql).all(cliente).map(r => [r.fonte, r.n]))
export function resumoCustos(cliente, agoraMs = Date.now()) {
  const cfg = getCfgCustos(cliente), fontes = {}
  const skus = contarPorFonte('SELECT fonte, COUNT(*) n FROM erp_custos_sku WHERE cliente = ? GROUP BY fonte', cliente)
  const naoVistos = contarPorFonte("SELECT fonte, COUNT(*) n FROM erp_custos_sku WHERE cliente = ? AND nao_visto_desde <> '' GROUP BY fonte", cliente)
  const rejeitadas = contarPorFonte('SELECT fonte, COUNT(*) n FROM erp_rejeitadas WHERE cliente = ? GROUP BY fonte', cliente)
  const quarentena = contarPorFonte("SELECT fonte, COUNT(*) n FROM erp_quarentena WHERE cliente = ? AND estado = 'pendente' GROUP BY fonte", cliente)
  for (const f of FONTES_EXTERNAS) {
    const e = estadoFonte(cliente, f), fr = frescor(e, cfg, agoraMs)
    fontes[f] = { estado: e.estado, ultimo_sync_em: e.ultimo_sync_em, ultimo_sync_ok_em: e.ultimo_sync_ok_em, idade_dias: fr.idade_dias, velha: fr.velha, ultimo_erro: e.ultimo_erro,
      sync_estado: e.sync_estado, contagens: { skus: skus[f] || 0, rejeitadas: rejeitadas[f] || 0, quarentena: quarentena[f] || 0, nao_vistos: naoVistos[f] || 0 } }
  }
  const venc = vencedores(cliente, cfg), por_fonte = Object.fromEntries(FONTES.map(f => [f, 0]))
  for (const { v } of venc.values()) por_fonte[v.fonte]++
  const anuncios = db.prepare('SELECT item_id, sku, user_product_id, fat30 FROM promo_anuncio WHERE cliente = ?').all(cliente)
  const cob = anuncios.length ? cobertura(anuncios, vinculosCusto.custosDosAnuncios(cliente, anuncios)) : { anuncios_total: 0, anuncios_sem_sku: 0, anuncios_sem_custo: 0, cobertura_receita_pct: null }
  return { fontes, efetivo: { skus_com_custo: venc.size, por_fonte, ...cob }, reconciliacao_disponivel: anuncios.length > 0, reconciliacao_motivo: anuncios.length ? '' : 'rode a coleta de promoções do cliente' }
}
export function pendenciasCustos(cliente, agoraMs = Date.now()) {
  const cfg = getCfgCustos(cliente), p = []
  for (const f of FONTES_EXTERNAS) {
    const e = estadoFonte(cliente, f), fr = frescor(e, cfg, agoraMs)
    if (fr.velha) p.push({ codigo: 'CUSTO_FONTE_VELHA', estado: 'ATENCAO', texto: `Custos ${DE[f]} ${fr.idade_dias == null ? 'nunca sincronizaram com sucesso' : `sem sincronização há ${fr.idade_dias.toLocaleString('pt-BR')} dia(s)`} (limite ${fr.limite}): o custo já recebido continua valendo — ${f === 'sheets' ? 'confira o Apps Script da planilha (ele reenvia tudo 1×/dia)' : 'confira a conexão e use "Sincronizar agora"'}.` })
    if (e.estado === 'erro') p.push({ codigo: 'CUSTO_FONTE_ERRO', estado: 'ATENCAO', texto: `A última sincronização ${DE[f]} falhou${e.ultimo_erro ? `: ${e.ultimo_erro}` : ''}. Os custos já recebidos continuam valendo.` })
    if (e.estado === 'reautorizar') p.push({ codigo: 'CUSTO_REAUTORIZAR', estado: 'NEEDS_EXTERNAL_DATA', texto: `A conexão ${DE[f]} pede nova autorização do cliente (Integrações → Custos → gerar link de autorização). Os custos já recebidos continuam valendo.` })
  }
  const conta = sql => db.prepare(sql).get(cliente).n
  const q = conta("SELECT COUNT(*) n FROM erp_quarentena WHERE cliente = ? AND estado = 'pendente'")
  if (q) p.push({ codigo: 'CUSTO_QUARENTENA', estado: 'ATENCAO', texto: `${q} custo(s) em quarentena (variação brusca, custo ≥ preço cheio ou kit divergente): o valor novo NÃO vale até o dono aprovar.` })
  const rj = conta('SELECT COUNT(*) n FROM erp_rejeitadas WHERE cliente = ?')
  if (rj) p.push({ codigo: 'CUSTO_REJEITADO', estado: 'ATENCAO', texto: `${rj} linha(s) de custo rejeitada(s) (vazio, zero, texto, SKU repetido, conflito com o anúncio ou kit pendente): nenhum número é inventado — veja a reconciliação.` })
  const nv = conta("SELECT COUNT(*) n FROM erp_custos_sku WHERE cliente = ? AND nao_visto_desde <> ''")
  if (nv) p.push({ codigo: 'CUSTO_NAO_VISTO', estado: 'ATENCAO', texto: `${nv} SKU(s) não apareceram no último envio completo da fonte: o custo continua valendo (nada é apagado) — confira se o produto saiu do ERP/planilha.` })
  return p
}

export function skuPorIdExterno(cliente, fonte, id) {
  exigirFonte(fonte)
  const i = txt(id, 64)
  if (!i) return null
  return db.prepare('SELECT sku FROM erp_custos_sku WHERE cliente = ? AND fonte = ? AND id_externo = ? LIMIT 1').get(cliente, fonte, i)?.sku
    ?? db.prepare('SELECT sku FROM erp_quarentena WHERE cliente = ? AND fonte = ? AND id_externo = ? LIMIT 1').get(cliente, fonte, i)?.sku ?? null
}

// ── retenção (1×/dia): histórico 24 meses, lotes 30 dias, eventos 7 dias, state OAuth 1 dia, rejeitadas até 5.000 por (cliente, fonte) ──
export function podarCustos(agoraMs = Date.now()) {
  const iso = ms => new Date(ms).toISOString(), d24 = new Date(agoraMs)
  d24.setUTCMonth(d24.getUTCMonth() - 24)
  const r = {}
  db.transaction(() => {
    r.historico = db.prepare('DELETE FROM erp_custos_hist WHERE em < ?').run(d24.toISOString()).changes
    r.lotes = db.prepare('DELETE FROM erp_lotes WHERE recebido_em < ?').run(iso(agoraMs - 30 * DIA)).changes
    r.eventos = db.prepare('DELETE FROM erp_eventos_vistos WHERE em < ?').run(iso(agoraMs - 7 * DIA)).changes
    r.oauth_state = db.prepare('DELETE FROM erp_oauth_state WHERE criado_em < ?').run(iso(agoraMs - DIA)).changes
    r.rejeitadas = db.prepare(`DELETE FROM erp_rejeitadas WHERE rowid IN (SELECT rowid FROM (SELECT rowid,
      ROW_NUMBER() OVER (PARTITION BY cliente, fonte ORDER BY em DESC, rowid DESC) rn FROM erp_rejeitadas) WHERE rn > 5000)`).run().changes
  })()
  log('info', `custos: poda diária ${JSON.stringify(r)}`)
  return r
}
