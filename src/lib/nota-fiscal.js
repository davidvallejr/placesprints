// F8 — Nota fiscal (docs/desenho-v3-erp.md § B; decisões do David 15/10/2026). PURO: sem import de banco; db.js executa o SCHEMA_NOTA.
// Regra de ouro: o Place Sprints NÃO decide tributo. NCM, CFOP, CST/CSOSN, origem, alíquotas e ST vêm de regra_fiscal_produto, declarada pelo CONTADOR do
// cliente por SKU × operação, com termo aceito (termo_fiscal). Sem regra = bloqueio «regra fiscal faltando» NAQUELE item; nada é inferido, copiado de outro
// produto/cliente ou «tentado com outro CFOP». A montagem só calcula o que a regra declarada manda (base × alíquota, em centavos, arredondamento explícito) e
// recusa o que não sabe montar com segurança (ST, DIFAL, CSOSN 101/201…, MEI, destinatário contribuinte): vira bloqueio nominal, nunca nota «quase certa».
// Certificado A1: NUNCA no banco — cliente_fiscal guarda só a referência (provedor ou arquivo cifrado fora de data/). CPF/CNPJ do comprador só em
// nota_fiscal.corpo_json (necessário para emitir); toda projeção (tela, log, evento, livro) mascara.
import { createHash } from 'node:crypto'
import { chaveSku } from './produto-estoque.js'

export const SCHEMA_NOTA = `
CREATE TABLE IF NOT EXISTS cliente_fiscal (           -- declarado pelo contador; 1 por cliente
  cliente TEXT PRIMARY KEY,
  cnpj TEXT NOT NULL, razao_social TEXT NOT NULL, ie TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL, regime TEXT NOT NULL CHECK (regime IN ('simples','normal','mei')),
  serie INTEGER NOT NULL DEFAULT 1 CHECK (serie BETWEEN 0 AND 999),
  ambiente TEXT NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao','producao')),
  emissor TEXT NOT NULL DEFAULT 'focus' CHECK (emissor IN ('focus','sefaz')),
  politica TEXT NOT NULL DEFAULT 'aprovar' CHECK (politica IN ('aprovar','automatica')),
  vendedor_apelido TEXT NOT NULL DEFAULT '',          -- id do vendedor no intermediador (idCadIntTran)
  modalidade_frete INTEGER CHECK (modalidade_frete IN (0,1,2,3,4,9)),   -- modFrete declarado pelo contador (Mercado Envios); NULL = não declarado = bloqueio
  cert_ref TEXT NOT NULL DEFAULT '',                  -- 'focus:empresa:<id>' | 'arquivo:<caminho absoluto .enc fora de data/>' — NUNCA o certificado nem a senha
  cert_valido_ate TEXT NOT NULL DEFAULT '',
  token_ref TEXT NOT NULL DEFAULT '',                 -- nome da variável do .env com o token do provedor ('' = FOCUS_TOKEN_<AMBIENTE>); nunca o token
  contador TEXT NOT NULL DEFAULT '',                  -- quem declarou (nome/CRC do contador do cliente)
  por TEXT NOT NULL, em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS termo_fiscal (             -- aceite do cliente (responsabilidade tributária com o contador dele)
  cliente TEXT NOT NULL, versao TEXT NOT NULL, texto_sha256 TEXT NOT NULL,
  aceito_por TEXT NOT NULL,                           -- representante do cliente que aceitou
  aceito_em TEXT NOT NULL,                            -- data do aceite (AAAA-MM-DD)
  registrado_por TEXT NOT NULL, registrado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, versao));
CREATE TABLE IF NOT EXISTS regra_fiscal_produto (     -- por SKU (chaveSku) × operação × vigência; sem linha = sem nota
  cliente TEXT NOT NULL, sku TEXT NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('venda_dentro_uf','venda_fora_uf')),
  ncm TEXT NOT NULL, cest TEXT NOT NULL DEFAULT '', origem INTEGER NOT NULL CHECK (origem BETWEEN 0 AND 8),
  cfop TEXT NOT NULL, cst_csosn TEXT NOT NULL,
  icms_aliquota REAL, icms_reducao_bc REAL, icms_aliquota_credito REAL,
  st INTEGER NOT NULL DEFAULT 0 CHECK (st IN (0,1)),
  pis_cst TEXT NOT NULL, pis_aliquota REAL, cofins_cst TEXT NOT NULL, cofins_aliquota REAL,
  pis_cofins_exclui_icms INTEGER CHECK (pis_cofins_exclui_icms IN (0,1)),
  unidade TEXT NOT NULL DEFAULT 'UN', descricao TEXT NOT NULL DEFAULT '',
  vigente_de TEXT NOT NULL, contador TEXT NOT NULL, por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, sku, operacao, vigente_de));
CREATE TABLE IF NOT EXISTS nota_fiscal (
  cliente TEXT NOT NULL, ref TEXT NOT NULL,           -- refDe(cliente, pacote|pedido): única no provedor, sem nome do cliente
  pack_id TEXT NOT NULL DEFAULT '', order_ids TEXT NOT NULL,   -- pedidos do pacote (1 nota por pacote: o ML aceita 1 XML por pack)
  estado TEXT NOT NULL CHECK (estado IN ('rascunho','aprovada','enviada','autorizada','rejeitada','cancelada','anexada','erro')),
  bloqueios_json TEXT NOT NULL DEFAULT '[]',          -- [{codigo, sku?, item?}] — rascunho com bloqueio não é aprovável
  corpo_json TEXT NOT NULL DEFAULT '{}',              -- nota canônica (ÚNICO lugar com dado do comprador)
  hash TEXT NOT NULL DEFAULT '',                      -- sha256 do corpo; aprovação e emissão conferem o MESMO hash
  total_c INTEGER, imposto_c INTEGER, emissor TEXT NOT NULL DEFAULT '', ambiente TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '', serie TEXT NOT NULL DEFAULT '', chave TEXT NOT NULL DEFAULT '', status_sefaz TEXT NOT NULL DEFAULT '',
  xml_arquivo TEXT NOT NULL DEFAULT '', aprovada_por TEXT NOT NULL DEFAULT '', aprovada_em TEXT NOT NULL DEFAULT '',
  autorizada_em TEXT NOT NULL DEFAULT '', anexada_em TEXT NOT NULL DEFAULT '',
  corrigida INTEGER NOT NULL DEFAULT 0 CHECK (corrigida IN (0,1)),   -- rejeição/carta/cancelamento/remontagem depois de aprovada: zera a contagem das 20
  pago_em TEXT NOT NULL,                              -- dia do pedido pago (meli_pedido_item.dia)
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, ref));
CREATE INDEX IF NOT EXISTS ix_nota_estado ON nota_fiscal (cliente, estado);
CREATE TABLE IF NOT EXISTS nota_item (
  cliente TEXT NOT NULL, ref TEXT NOT NULL, n_item INTEGER NOT NULL,
  order_id TEXT NOT NULL, item_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL, valor_unit_c INTEGER NOT NULL, valor_bruto_c INTEGER NOT NULL, frete_c INTEGER NOT NULL DEFAULT 0,
  ncm TEXT NOT NULL DEFAULT '', cfop TEXT NOT NULL DEFAULT '', cst_csosn TEXT NOT NULL DEFAULT '',
  icms_base_c INTEGER, icms_valor_c INTEGER, pis_valor_c INTEGER, cofins_valor_c INTEGER,
  regra_vigente_de TEXT NOT NULL DEFAULT '',          -- '' = sem regra (bloqueio)
  PRIMARY KEY (cliente, ref, n_item));
CREATE TABLE IF NOT EXISTS nota_evento (              -- append-only (TRIGGER barra UPDATE/DELETE); detalhe SEM dado do comprador, sem token, sem certificado
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, ref TEXT NOT NULL,
  de TEXT NOT NULL, para TEXT NOT NULL, por TEXT NOT NULL DEFAULT 'sistema', sistema TEXT NOT NULL CHECK (sistema IN ('chaveiro','smith')),
  detalhe_json TEXT NOT NULL DEFAULT '{}', idem TEXT, em TEXT NOT NULL,
  UNIQUE (cliente, idem));
CREATE INDEX IF NOT EXISTS ix_nota_evento ON nota_evento (cliente, ref);
CREATE TRIGGER IF NOT EXISTS nota_evento_sem_update BEFORE UPDATE ON nota_evento BEGIN SELECT RAISE(ABORT, 'nota_evento é append-only'); END;
CREATE TRIGGER IF NOT EXISTS nota_evento_sem_delete BEFORE DELETE ON nota_evento BEGIN SELECT RAISE(ABORT, 'nota_evento é append-only'); END;
`

// ── identificadores e máscaras ───────────────────────────────────────────────────────────────────────────────────
export const sha256 = s => createHash('sha256').update(String(s)).digest('hex')
export const digitos = s => String(s ?? '').replace(/\D/g, '')
// ref no provedor: única na conta Focus da Place2u (todos os clientes), sem nome do cliente; pacote vence pedido (1 XML por pack no ML)
export const refDe = (cliente, { pack_id, order_id }) => `ps${sha256(cliente).slice(0, 12)}-${pack_id ? 'p' + digitos(pack_id) : 'o' + digitos(order_id)}`
export const REF_OK = /^ps[0-9a-f]{12}-[po]\d{1,20}$/
export function mascararDoc(doc) {
  const d = digitos(doc)
  return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-**` : d ? '***' : ''
}
const dvMod11 = (base, pesos) => { const s = [...base].reduce((t, c, i) => t + Number(c) * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s }
export function cpfOk(v) {
  const d = digitos(v); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  return dvMod11(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[9] && dvMod11(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[10]
}
export function cnpjOk(v) {
  const d = digitos(v); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  return dvMod11(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[12] && dvMod11(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === +d[13]
}
export const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '))

// ── o que a montagem sabe montar (lista FECHADA; o resto é bloqueio, nunca palpite) ────────────────────────────────────
const CSOSN_OK = new Set(['102', '103', '300', '400'])        // Simples sem destaque de ICMS. 101 (crédito: exige texto legal), 201/202/203/500/900 (ST) = bloqueio
const CST_OK = new Set(['00', '20', '40', '41', '50'])         // normal: tributada, com redução de BC, isenta, não tributada, suspensa. 10/30/60/70/90 (ST) = bloqueio
const CST_ST = new Set(['10', '30', '60', '70', '90', '201', '202', '203', '500', '900'])
const PISCOF_SEM_VALOR = new Set(['04', '05', '06', '07', '08', '09'])
const PISCOF_ALIQ = new Set(['01', '02', '49', '99'])          // base × alíquota declarada (49/99: a alíquota declarada pode ser 0)

// texto FIXO por código (tela e pendência; nunca dado do cliente nem valor recebido)
export const BLOQUEIO = {
  regra_fiscal_faltando: 'regra fiscal faltando para o SKU (o contador do cliente precisa declarar NCM, CFOP, CST/CSOSN e alíquotas)',
  sku_ausente: 'item vendido sem SKU: não há como achar a regra fiscal',
  regra_incompleta: 'regra fiscal do SKU incompleta ou inconsistente com o regime/operação (conferir com o contador)',
  st_nao_suportada: 'substituição tributária não é montada pelo sistema: emitir pelo emissor do contador',
  csosn_nao_suportado: 'situação tributária do Simples fora da lista que o sistema monta: conferir com o contador',
  cst_nao_suportado: 'situação tributária fora da lista que o sistema monta: conferir com o contador',
  difal_nao_suportado: 'venda interestadual a consumidor final no regime normal exige DIFAL: não montado pelo sistema',
  mei: 'MEI: confirmar com o contador se há NF-e de venda e como emitir',
  emitente_incompleto: 'dados fiscais do cliente incompletos (CNPJ, razão social, IE, UF ou regime)',
  termo_fiscal: 'termo de responsabilidade fiscal ainda não aceito pelo cliente (versão vigente)',
  certificado: 'certificado A1 do cliente não cadastrado no provedor ou vencido',
  comprador_billing_info: 'dados fiscais do comprador não lidos do Mercado Livre (billing info)',
  comprador_incompleto: 'dados fiscais do comprador incompletos ou documento inválido',
  destinatario_contribuinte: 'comprador com inscrição estadual (contribuinte): CFOP/ST mudam — confirmar com o contador',
  frete_nao_lido: 'frete cobrado do comprador não lido do pedido',
  frete_cobrado: 'pedido com frete cobrado do comprador: como o frete entra na nota (valor, base, modalidade) é decisão do contador — não montado',
  modalidade_frete: 'modalidade do frete (Mercado Envios) não declarada pelo contador nos dados fiscais do cliente',
  cupom_nao_verificado: 'pedido com cupom: quem financia o desconto não está verificado — não entra na nota',
  pagamento_nao_lido: 'pagamentos do pedido não lidos',
  pagamento: 'forma de pagamento sem mapeamento verificado ou cartão sem autorização/bandeira/credenciadora',
  pagamento_diverge_total: 'soma dos pagamentos diferente do total da nota',
  intermediador: 'CNPJ do intermediador (marketplace) ou apelido do vendedor não declarado',
}
const B = (codigo, extra = {}) => ({ codigo, ...extra })
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pct = (base_c, aliq) => Math.round((base_c * aliq) / 100)     // centavos, meio para cima (base e alíquota ≥ 0)
const crtDe = regime => (regime === 'simples' ? 1 : regime === 'normal' ? 3 : null)

// regra vigente na data: a de maior vigente_de ≤ data, do MESMO cliente e SKU e operação (nunca de outro produto/cliente)
export function regraVigente(regras, cliente, sku, operacao, data) {
  const k = chaveSku(sku), d = String(data).slice(0, 10)
  return regras.filter(r => r.cliente === cliente && r.sku === k && r.operacao === operacao && String(r.vigente_de) <= d)
    .sort((a, b) => String(b.vigente_de).localeCompare(String(a.vigente_de)))[0] || null
}

// incoerência entre a regra e o regime/operação: aponta, não corrige
function regraInconsistente(r, regime, operacao) {
  if (!/^\d{8}$/.test(r.ncm) || !/^\d{4}$/.test(r.cfop) || !(Number.isInteger(r.origem) && r.origem >= 0 && r.origem <= 8)) return true
  if (r.cest && !/^\d{7}$/.test(r.cest)) return true
  if (r.cfop[0] !== (operacao === 'venda_dentro_uf' ? '5' : '6')) return true
  if (regime === 'simples' ? !/^\d{3}$/.test(r.cst_csosn) : !/^\d{2}$/.test(r.cst_csosn)) return true
  return false
}

// pedido: { cliente, ref, pack_id, order_ids[], data, itens:[{order_id,item_id,variacao_id,sku,descricao,quantidade,preco_unit_c,cupom_c}], frete_comprador_c|null,
//           comprador|null {nome, doc, ie, logradouro, numero, complemento, bairro, municipio, uf, cep}, pagamentos|null [{tipo, metodo, valor_c, autorizacao}] }
// regras: linhas de regra_fiscal_produto do cliente · emitente: linha de cliente_fiscal (+ termo_ok) · cfg: config/nota-fiscal.json
// → { nota, bloqueios[] } — nota canônica em centavos; bloqueios vazio = aprovável
export function montarNota(pedido, regras, emitente, cfg) {
  const bloqueios = [], data = String(pedido.data || '').slice(0, 10)
  const e = emitente || {}, regime = e.regime
  if (!cnpjOk(e.cnpj) || !String(e.razao_social || '').trim() || !String(e.ie || '').trim() || !UFS.has(e.uf) || !crtDe(regime)) bloqueios.push(B(regime === 'mei' ? 'mei' : 'emitente_incompleto'))
  if (!e.termo_ok) bloqueios.push(B('termo_fiscal'))
  if (!e.cert_ref || !e.cert_valido_ate || String(e.cert_valido_ate).slice(0, 10) < data) bloqueios.push(B('certificado'))
  if (!cnpjOk(cfg.intermediador?.cnpj) || !String(e.vendedor_apelido || '').trim()) bloqueios.push(B('intermediador'))
  if (![0, 1, 2, 3, 4, 9].includes(e.modalidade_frete)) bloqueios.push(B('modalidade_frete'))

  // destinatário
  const c = pedido.comprador, doc = digitos(c?.doc)
  let ufDest = null, contribuinte = false
  if (!c) bloqueios.push(B('comprador_billing_info'))
  else {
    const docOk = doc.length === 11 ? cpfOk(doc) : cnpjOk(doc)
    ufDest = String(c.uf || '').toUpperCase()
    if (!docOk || !String(c.nome || '').trim() || !String(c.logradouro || '').trim() || !String(c.numero || '').trim() || !String(c.bairro || '').trim()
      || !String(c.municipio || '').trim() || !UFS.has(ufDest) || digitos(c.cep).length !== 8) bloqueios.push(B('comprador_incompleto'))
    const ie = String(c.ie || '').trim().toUpperCase()
    contribuinte = doc.length === 14 && !!ie && ie !== 'ISENTO'
    if (contribuinte) bloqueios.push(B('destinatario_contribuinte'))
  }
  const interna = ufDest ? ufDest === e.uf : true
  const operacao = interna ? 'venda_dentro_uf' : 'venda_fora_uf'
  if (regime === 'normal' && !interna && !contribuinte) bloqueios.push(B('difal_nao_suportado'))

  // itens — cupom nunca entra (financiamento NOT_VERIFIED); frete cobrado do comprador não é montado (decisão do contador), ausente ≠ 0
  const linhas = (pedido.itens || []).map((it, i) => ({ ...it, n_item: i + 1, valor_bruto_c: it.preco_unit_c * it.quantidade }))
  if (linhas.some(l => (l.cupom_c ?? 0) > 0)) bloqueios.push(B('cupom_nao_verificado'))
  if (pedido.frete_comprador_c == null) bloqueios.push(B('frete_nao_lido'))
  else if (pedido.frete_comprador_c > 0) bloqueios.push(B('frete_cobrado'))

  const itens = linhas.map(l => {
    const out = { n_item: l.n_item, order_id: l.order_id, item_id: l.item_id, variacao_id: l.variacao_id || '', sku: l.sku || '', quantidade: l.quantidade,
      valor_unit_c: l.preco_unit_c, valor_bruto_c: l.valor_bruto_c, desconto_c: 0, frete_c: 0, descricao: String(l.descricao || '').slice(0, 120),
      ncm: '', cest: '', cfop: '', origem: null, cst_csosn: '', unidade: 'UN', icms_base_c: null, icms_aliquota: null, icms_valor_c: null, icms_reducao_bc: null,
      pis_cst: '', pis_base_c: null, pis_aliquota: null, pis_valor_c: null, cofins_cst: '', cofins_base_c: null, cofins_aliquota: null, cofins_valor_c: null, regra_vigente_de: '' }
    if (!l.sku) { bloqueios.push(B('sku_ausente', { item: l.item_id })); return out }
    const r = regraVigente(regras, pedido.cliente, l.sku, operacao, data)
    if (!r) { bloqueios.push(B('regra_fiscal_faltando', { sku: l.sku })); return out }
    Object.assign(out, { ncm: r.ncm, cest: r.cest || '', cfop: r.cfop, origem: r.origem, cst_csosn: r.cst_csosn, unidade: r.unidade || 'UN', regra_vigente_de: r.vigente_de,
      descricao: (r.descricao || out.descricao).slice(0, 120) })
    if (!out.descricao) { bloqueios.push(B('regra_incompleta', { sku: l.sku })); return out }
    if (regraInconsistente(r, regime, operacao)) { bloqueios.push(B('regra_incompleta', { sku: l.sku })); return out }
    if (r.st === 1 || CST_ST.has(r.cst_csosn)) { bloqueios.push(B('st_nao_suportada', { sku: l.sku })); return out }
    // ICMS — só o que a regra declara
    const baseCheia = out.valor_bruto_c - out.desconto_c                    // valor da operação (nota sem frete, seguro nem outras despesas: frete cobrado = bloqueio)
    if (regime === 'simples') {
      if (!CSOSN_OK.has(r.cst_csosn)) { bloqueios.push(B('csosn_nao_suportado', { sku: l.sku })); return out }
    } else if (regime === 'normal') {
      if (!CST_OK.has(r.cst_csosn)) { bloqueios.push(B('cst_nao_suportado', { sku: l.sku })); return out }
      if (r.cst_csosn === '00' || r.cst_csosn === '20') {
        const aliq = num(r.icms_aliquota), red = num(r.icms_reducao_bc)
        if (aliq == null || aliq < 0 || aliq > 100 || (r.cst_csosn === '20' && (red == null || red <= 0 || red >= 100))) { bloqueios.push(B('regra_incompleta', { sku: l.sku })); return out }
        const base = r.cst_csosn === '20' ? Math.round(baseCheia * (1 - red / 100)) : baseCheia
        Object.assign(out, { icms_base_c: base, icms_aliquota: aliq, icms_valor_c: pct(base, aliq), icms_reducao_bc: r.cst_csosn === '20' ? red : null })
      }
    }
    // PIS / COFINS — base declarada pelo contador: com ou sem exclusão do ICMS (pis_cofins_exclui_icms), nunca presumida
    for (const t of ['pis', 'cofins']) {
      const cst = String(r[`${t}_cst`] || ''), aliq = num(r[`${t}_aliquota`])
      out[`${t}_cst`] = cst
      if (PISCOF_SEM_VALOR.has(cst)) continue
      if (!PISCOF_ALIQ.has(cst) || aliq == null || aliq < 0 || aliq > 100 || (aliq > 0 && ![0, 1].includes(r.pis_cofins_exclui_icms))) { bloqueios.push(B('regra_incompleta', { sku: l.sku })); return out }
      const base = out.valor_bruto_c - out.desconto_c - (r.pis_cofins_exclui_icms === 1 ? out.icms_valor_c ?? 0 : 0)
      Object.assign(out, { [`${t}_base_c`]: base, [`${t}_aliquota`]: aliq, [`${t}_valor_c`]: pct(base, aliq) })
    }
    return out
  })

  const soma = k => itens.reduce((s, i) => s + (i[k] ?? 0), 0)
  const totais = { produtos_c: soma('valor_bruto_c'), desconto_c: soma('desconto_c'), frete_c: soma('frete_c'), icms_base_c: soma('icms_base_c'), icms_c: soma('icms_valor_c'),
    pis_c: soma('pis_valor_c'), cofins_c: soma('cofins_valor_c') }
  totais.nota_c = totais.produtos_c - totais.desconto_c + totais.frete_c
  totais.imposto_c = totais.icms_c + totais.pis_c + totais.cofins_c

  // pagamento (NT 2025.001): mapeamento só pela tabela do config; cartão exige autorização, bandeira e credenciadora
  const P = cfg.pagamento || {}, pagamentos = []
  if (!Array.isArray(pedido.pagamentos)) bloqueios.push(B('pagamento_nao_lido'))
  else {
    let falta = false
    for (const p of pedido.pagamentos) {
      const forma = P.forma_por_tipo?.[p.tipo], cartao = forma === '03' || forma === '04', band = P.bandeira_por_metodo?.[p.metodo]
      if (!forma || !Number.isInteger(p.valor_c) || (cartao && (!String(p.autorizacao || '').trim() || !band || !cnpjOk(P.cnpj_credenciadora)))) { falta = true; continue }
      pagamentos.push({ forma, valor_c: p.valor_c, ...(cartao ? { tipo_integracao: 1, bandeira: band, autorizacao: String(p.autorizacao).trim(), cnpj_credenciadora: digitos(P.cnpj_credenciadora) } : {}) })
    }
    if (falta) bloqueios.push(B('pagamento'))
    else if (pagamentos.reduce((s, p) => s + p.valor_c, 0) !== totais.nota_c) bloqueios.push(B('pagamento_diverge_total'))
  }

  const nota = { versao: 1, ref: pedido.ref, cliente: pedido.cliente, pack_id: pedido.pack_id || '', order_ids: pedido.order_ids || [], data,
    natureza_operacao: cfg.nf?.natureza_operacao || 'Venda de mercadoria', operacao, local_destino: interna ? 1 : 2, consumidor_final: contribuinte ? 0 : 1,
    emitente: { cnpj: digitos(e.cnpj), razao_social: e.razao_social || '', ie: e.ie || '', uf: e.uf || '', regime: regime || '', crt: crtDe(regime) },
    destinatario: c ? { nome: String(c.nome || '').trim(), doc, ie: String(c.ie || '').trim(), indicador_ie: contribuinte ? 1 : 9, logradouro: c.logradouro || '', numero: c.numero || '',
      complemento: c.complemento || '', bairro: c.bairro || '', municipio: c.municipio || '', uf: ufDest || '', cep: digitos(c.cep) } : null,
    intermediador: { cnpj: digitos(cfg.intermediador?.cnpj), id: String(e.vendedor_apelido || '').trim() },
    modalidade_frete: e.modalidade_frete ?? null,                 // declarada pelo contador (cliente_fiscal); nunca presumida
    itens, totais, pagamentos }
  const vistos = new Set()
  return { nota, bloqueios: bloqueios.filter(b => { const k = `${b.codigo}|${b.sku || ''}|${b.item || ''}`; return vistos.has(k) ? false : vistos.add(k) }) }
}

export const hashNota = nota => sha256(JSON.stringify(nota))
export const reais = c => (c == null ? undefined : Math.round(c) / 100)

// projeção para a tela/lista: nada do comprador além do 1º nome e do documento mascarado
export function projecaoNota(row) {
  let corpo = {}; try { corpo = JSON.parse(row.corpo_json || '{}') } catch { corpo = {} }
  const d = (corpo.nota || corpo).destinatario                         // corpo_json = { entrada, nota }
  let bloqueios = []; try { bloqueios = JSON.parse(row.bloqueios_json || '[]') } catch { bloqueios = [] }
  return { ref: row.ref, pedidos: String(row.order_ids || '').split(',').filter(Boolean), pack_id: row.pack_id || '', estado: row.estado,
    comprador: d ? `${String(d.nome || '').split(/\s+/)[0] || '—'} · ${mascararDoc(d.doc)}` : '—',
    total_c: row.total_c ?? null, imposto_c: row.imposto_c ?? null, numero: row.numero || '', chave: row.chave || '', status_sefaz: row.status_sefaz || '',
    autorizada_em: row.autorizada_em || '', anexada_em: row.anexada_em || '', pago_em: row.pago_em, ambiente: row.ambiente || '',
    bloqueios: bloqueios.map(b => ({ codigo: b.codigo, sku: b.sku || '', item: b.item || '', texto: BLOQUEIO[b.codigo] || b.codigo })) }
}

// ── máquina de estados (lista fechada) ───────────────────────────────────────────────────────────────────────────
export const TRANSICOES = {
  rascunho: ['rascunho', 'aprovada'], aprovada: ['rascunho', 'enviada', 'erro'], enviada: ['enviada', 'autorizada', 'rejeitada', 'erro'],
  autorizada: ['cancelada', 'anexada', 'autorizada'], anexada: ['cancelada', 'anexada'], rejeitada: ['rascunho'], erro: ['rascunho', 'enviada', 'autorizada', 'rejeitada'], cancelada: [],
}
export const podeIr = (de, para) => (TRANSICOES[de] || []).includes(para)

// automático só depois de N notas SEGUIDAS (as mais recentes) autorizadas sem correção, por cliente
export function automaticoLiberado(notas, n = 20) {
  const fechadas = notas.filter(x => ['autorizada', 'anexada', 'cancelada', 'rejeitada'].includes(x.estado) || x.corrigida)
    .sort((a, b) => String(b.autorizada_em || b.atualizado_em).localeCompare(String(a.autorizada_em || a.atualizado_em)))
  let limpas = 0
  for (const x of fechadas) { if (x.corrigida || !['autorizada', 'anexada'].includes(x.estado)) break; limpas++ }
  return { ok: limpas >= n, limpas, faltam: Math.max(0, n - limpas) }
}

// ── importação CSV do contador (prévia; nada grava aqui) ─────────────────────────────────────────────────────────────
const cst2 = v => { const d = digitos(v); return d.length === 1 ? '0' + d : d }   // «1» → «01»; vazio continua vazio (= erro)
const NUM_OPC = new Set(['icms_aliquota', 'icms_reducao_bc', 'icms_aliquota_credito', 'pis_aliquota', 'cofins_aliquota'])
export function lerCsvRegras(texto, cfg, { max = 5000 } = {}) {
  const linhas = String(texto ?? '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (!linhas.length) return { regras: [], erros: [{ linha: 0, campo: 'arquivo', motivo: 'vazio' }] }
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ','
  const cab = linhas[0].split(sep).map(s => s.trim().toLowerCase())
  const COL = cfg.csv_colunas, obrig = ['sku', 'operacao', 'ncm', 'origem', 'cfop', 'cst_csosn', 'st', 'pis_cst', 'cofins_cst', 'vigente_de']
  const faltam = obrig.filter(k => !cab.includes(k)), estranhas = cab.filter(k => !COL.includes(k))
  if (faltam.length || estranhas.length) return { regras: [], erros: [{ linha: 1, campo: 'cabecalho', motivo: faltam.length ? `faltam colunas: ${faltam.join(', ')}` : 'coluna fora da lista' }] }
  if (linhas.length - 1 > max) return { regras: [], erros: [{ linha: 0, campo: 'arquivo', motivo: `mais de ${max} linhas` }] }
  const regras = [], erros = [], vistos = new Set()
  linhas.slice(1).forEach((l, i) => {
    const n = i + 2, v = Object.fromEntries(cab.map((k, j) => [k, String(l.split(sep)[j] ?? '').trim()]))
    const erro = campo => erros.push({ linha: n, campo })
    const r = { sku: chaveSku(v.sku), operacao: v.operacao, ncm: digitos(v.ncm), cest: digitos(v.cest), origem: /^\d$/.test(v.origem) ? +v.origem : null, cfop: digitos(v.cfop),
      cst_csosn: digitos(v.cst_csosn), st: v.st === '1' ? 1 : v.st === '0' ? 0 : null, pis_cst: cst2(v.pis_cst), cofins_cst: cst2(v.cofins_cst),            // ST declarado sempre (vazio = erro, nunca «sem ST» presumido)
      pis_cofins_exclui_icms: v.pis_cofins_exclui_icms === '' || v.pis_cofins_exclui_icms == null ? null : v.pis_cofins_exclui_icms === '1' ? 1 : v.pis_cofins_exclui_icms === '0' ? 0 : -1,
      unidade: (v.unidade || 'UN').slice(0, 6).toUpperCase(), descricao: (v.descricao || '').slice(0, 120), vigente_de: v.vigente_de }
    for (const k of NUM_OPC) { const s = (v[k] ?? '').replace(',', '.'); r[k] = s === '' ? null : /^\d{1,3}(\.\d{1,4})?$/.test(s) ? Number(s) : NaN }
    if (!r.sku || r.sku.length > 80) erro('sku')
    if (!['venda_dentro_uf', 'venda_fora_uf'].includes(r.operacao)) erro('operacao')
    if (!/^\d{8}$/.test(r.ncm)) erro('ncm')
    if (r.cest && !/^\d{7}$/.test(r.cest)) erro('cest')
    if (r.origem == null || r.origem > 8) erro('origem')
    if (!/^\d{4}$/.test(r.cfop) || r.cfop[0] !== (r.operacao === 'venda_fora_uf' ? '6' : '5')) erro('cfop')
    if (!/^\d{2,3}$/.test(r.cst_csosn)) erro('cst_csosn')
    if (r.st == null) erro('st')
    if (!/^\d{2}$/.test(r.pis_cst)) erro('pis_cst')
    if (!/^\d{2}$/.test(r.cofins_cst)) erro('cofins_cst')
    if (r.pis_cofins_exclui_icms === -1) erro('pis_cofins_exclui_icms')
    for (const k of NUM_OPC) if (Number.isNaN(r[k]) || (r[k] != null && r[k] > 100)) erro(k)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vigente_de) || Number.isNaN(Date.parse(r.vigente_de))) erro('vigente_de')
    const k = `${r.sku}|${r.operacao}|${r.vigente_de}`
    if (vistos.has(k)) erro('duplicada'); vistos.add(k)
    if (!erros.some(x => x.linha === n)) regras.push(r)
  })
  return { regras, erros }
}

// ── sinais para o Algoritmo (regras nf_pendente / nf_regra_faltando; ligação ao plano em docs/desenho-v3-erp.md § B.7) ─────────
// notas: linhas de nota_fiscal do cliente · agoraIso · horas: nf.pendente_apos_horas → [{ regra, ref?, sku?, desde }]
export function sinaisNota(notas, agoraIso, horas = 24) {
  const limite = new Date(Date.parse(agoraIso) - horas * 3600e3).toISOString().slice(0, 10), out = [], skus = new Map()
  for (const n of notas) {
    if (['autorizada', 'anexada', 'cancelada'].includes(n.estado)) continue
    if (String(n.pago_em) <= limite) out.push({ regra: 'nf_pendente', ref: n.ref, desde: n.pago_em })
    let bl = []; try { bl = JSON.parse(n.bloqueios_json || '[]') } catch { bl = [] }
    for (const b of bl) if (b.codigo === 'regra_fiscal_faltando' && b.sku && (!skus.has(b.sku) || n.pago_em < skus.get(b.sku))) skus.set(b.sku, n.pago_em)
  }
  for (const [sku, desde] of skus) out.push({ regra: 'nf_regra_faltando', sku, desde })
  return out
}

// ── recebíveis da nota → previsão de caixa (consumo na F9). Só leitura; sem data de liberação = «sem data», nunca uma data inventada ────────
// notas: [{ estado, total_c, order_ids, pago_em }] · liberacoes: Map(order_id → 'AAAA-MM-DD') (money_release_date: NOT_COLLECTED hoje)
export function recebiveisDeNotas(notas, { liberacoes = new Map(), hoje } = {}) {
  const semana = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
  const por = new Map(), sem = { valor_c: 0, n: 0 }, liberado = { valor_c: 0, n: 0 }
  for (const n of notas) {
    if (!['autorizada', 'anexada'].includes(n.estado) || !Number.isInteger(n.total_c)) continue
    const datas = String(n.order_ids || '').split(',').filter(Boolean).map(o => liberacoes.get(o)).filter(Boolean).sort()
    const d = datas.length ? datas[datas.length - 1] : null                    // pacote: libera quando o último pedido libera
    if (!d) { sem.valor_c += n.total_c; sem.n++; continue }
    if (hoje && d < hoje) { liberado.valor_c += n.total_c; liberado.n++; continue }
    const w = semana(d), a = por.get(w) || { inicio: w, valor_c: 0, n: 0 }; a.valor_c += n.total_c; a.n++; por.set(w, a)
  }
  return { semanas: [...por.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)), sem_data: sem, liberado,
    premissas: ['valor = total da nota autorizada (antes das tarifas do Mercado Livre: o líquido vem do lucro por pedido)', 'data de liberação = money_release_date do pagamento (NOT_COLLECTED: sem ela, «sem data»)'] }
}
