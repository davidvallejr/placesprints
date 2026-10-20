// F8 — Nota fiscal: banco + fluxo (docs/desenho-v3-erp.md § B.4). Fábrica SEM import de banco: handle, emissores, leitor/anexador do ML, relógio e validação de
// quem aprova entram por injeção (testes: banco em memória, stubs; nunca provedor real, nunca SEFAZ, nunca ML).
// Fluxo: pedido pago (meli_pedido_item, 1 nota por pacote) → nota em RASCUNHO (montarNota; bloqueio nominal por item) → APROVAÇÃO (líder/consultor, hash do corpo)
// → emissão (chave nf.ligado; homologação × produção por cliente e por chave nf.producao_ligada) → retorno (síncrono, consulta ou webhook idempotente)
// → XML autorizado em data/nf/<cliente-hash>/ → anexo ao pacote do ML (chave nf.envio_ml_ligado) → eventos append-only (nota_evento).
// Automático só depois de N notas seguidas sem correção do cliente, com política «automatica» declarada e termo aceito.
// Sistemas: Chaveiro assina emissão/anexo/cancelamento; Smith assina regime, regras fiscais, termo e certificado (logs e eventos dizem qual).
// Nada aqui loga ou devolve CPF/CNPJ do comprador, nome completo, token do provedor, certificado ou senha.
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { montarNota, hashNota, refDe, REF_OK, projecaoNota, lerCsvRegras, podeIr, automaticoLiberado, sinaisNota, recebiveisDeNotas, sha256, digitos, cnpjOk, UFS, BLOQUEIO } from './nota-fiscal.js'
import { chaveSku, SKU_OFICIAL } from './produto-estoque.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => (typeof v === 'string' ? v.trim() : '')
const DIA = /^\d{4}-\d{2}-\d{2}$/
const mascaraTexto = s => String(s ?? '').replace(/\d[\d./-]{9,60}\d/g, m => (digitos(m).length >= 11 ? '***' : m)).slice(0, 300)   // mensagem da SEFAZ/provedor: nenhum CPF/CNPJ/chave (com ou sem pontuação) passa

// ── leitura do pedido no ML (Trinity, só leitura) — NOT_VERIFIED: formato do billing info novo; authorization_code; shipping_cost ─────────────────────────
const UF_NOME = { acre: 'AC', alagoas: 'AL', amazonas: 'AM', amapa: 'AP', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'minas gerais': 'MG', 'mato grosso do sul': 'MS', 'mato grosso': 'MT', para: 'PA', paraiba: 'PB', pernambuco: 'PE', piaui: 'PI', parana: 'PR', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', rondonia: 'RO', roraima: 'RR', 'rio grande do sul': 'RS', 'santa catarina': 'SC', sergipe: 'SE', 'sao paulo': 'SP', tocantins: 'TO' }
const ufDe = v => { const s = String(v ?? '').trim(); if (UFS.has(s.toUpperCase())) return s.toUpperCase(); return UF_NOME[s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()] || '' }
// GET /orders/billing-info/{site}/{id} → comprador. Aceita o formato legado (doc_type/doc_number/additional_info[]) e o formato com identification/address.
// Campo ausente = '' (a validação da montagem bloqueia); nunca inventado.
export function compradorDoBilling(r) {
  const bi = r?.buyer?.billing_info || r?.billing_info || r
  if (!bi || typeof bi !== 'object') return null
  const add = Object.fromEntries((Array.isArray(bi.additional_info) ? bi.additional_info : []).map(a => [String(a?.type || '').toUpperCase(), String(a?.value ?? '').trim()]))
  const a = bi.address || {}
  const nome = str(bi.name ? [bi.name, bi.last_name].filter(Boolean).join(' ') : '') || add.BUSINESS_NAME || [add.FIRST_NAME, add.LAST_NAME].filter(Boolean).join(' ')
  return { nome: nome.trim(), doc: digitos(bi.identification?.number || bi.doc_number || add.DOC_NUMBER), ie: str(bi.state_registration || add.STATE_REGISTRATION || ''),
    logradouro: str(a.street_name || add.STREET_NAME || ''), numero: str(String(a.street_number ?? add.STREET_NUMBER ?? '')), complemento: str(a.comment || add.COMMENT || ''),
    bairro: str(a.neighborhood?.name || a.neighborhood || add.NEIGHBORHOOD || ''), municipio: str(a.city_name || a.city?.name || add.CITY_NAME || ''),
    uf: ufDe(a.state?.code?.replace(/^BR-/, '') || a.state_code || a.state?.name || a.state_name || add.STATE_CODE || add.STATE_NAME), cep: digitos(a.zip_code || add.ZIP_CODE) }
}
// pedido(s) do pacote → { comprador, pagamentos, frete_comprador_c }; qualquer leitura falha = null naquele campo (a montagem bloqueia, nunca 0)
export async function lerPedidosMl(chamar, cliente, orderIds) {
  let comprador = null, pagamentos = [], frete = 0, freteOk = true, pagOk = true
  for (const id of orderIds) {
    const o = await chamar(cliente, `/orders/${encodeURIComponent(id)}`, { permitirFalha: true })
    if (!o || o._erro) return { comprador: null, pagamentos: null, frete_comprador_c: null }
    for (const p of (Array.isArray(o.payments) ? o.payments : []).filter(p => p?.status === 'approved')) {
      if (typeof p.total_paid_amount !== 'number') pagOk = false
      if (typeof p.shipping_cost === 'number') frete += Math.round(p.shipping_cost * 100); else freteOk = false
      pagamentos.push({ tipo: String(p.payment_type || ''), metodo: String(p.payment_method_id || ''), valor_c: Math.round((p.total_paid_amount ?? 0) * 100), autorizacao: String(p.authorization_code ?? '') })
    }
    const bid = o.buyer?.billing_info?.id
    if (!comprador && bid != null) {
      const b = await chamar(cliente, `/orders/billing-info/MLB/${encodeURIComponent(bid)}`, { permitirFalha: true })
      if (b && !b._erro) comprador = compradorDoBilling(b)
    }
  }
  return { comprador, pagamentos: pagOk ? pagamentos : null, frete_comprador_c: freteOk ? frete : null }
}
// POST /packs/{pack_id}/fiscal_documents (multipart, campo fiscal_document, XML ≤ 1 MB; pack nulo → order_id no mesmo recurso) — doc «Anexar Nota Fiscal».
// 409 = já existe arquivo do tipo (tratado como anexada depois de conferir). Chamada real só com nf.envio_ml_ligado.
export async function anexarXmlMl({ fetch = globalThis.fetch, token, pack_id, order_id, xml, nome = 'nfe.xml' }) {
  if (!token) return { ok: false, motivo: 'sem_token' }
  if (Buffer.byteLength(xml) > 1048576) return { ok: false, motivo: 'xml_maior_que_1mb' }
  const fd = new FormData(); fd.append('fiscal_document', new Blob([xml], { type: 'text/xml' }), nome)
  let r; try { r = await fetch(`https://api.mercadolibre.com/packs/${encodeURIComponent(pack_id || order_id)}/fiscal_documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd, signal: AbortSignal.timeout(30000) }) } catch { return { ok: false, motivo: 'rede' } }
  if (r.ok) return { ok: true, http: r.status }
  return r.status === 409 ? { ok: true, ja_existia: true, http: 409 } : { ok: false, http: r.status, motivo: r.status === 403 ? 'permissao' : r.status === 400 ? 'formato' : 'indisponivel' }
}

// deps: handle · cfg (config/nota-fiscal.json) · emissores { focus, sefaz } · ml { lerPedido(cliente, orderIds) → {comprador,pagamentos,frete_comprador_c}, anexar(cliente, {pack_id, order_id, xml}) }
//       · agora() ISO · validarPor(nome) → canônico líder/consultor ou '' · env (tokens do provedor por nome) · dirXml (pasta de data/nf) · raizDados (data/ — cert fora dela)
//       · termoTexto (texto vigente do termo) · log(nivel, msg)
export function criarNotaFiscal({ handle: h, cfg, emissores = {}, ml = {}, agora = () => new Date().toISOString(), validarPor = () => '', env = process.env, dirXml, raizDados, termoTexto = '', log = () => {} }) {
  const N = cfg.nf, termoVersao = cfg.termo.versao, termoSha = sha256(termoTexto)
  const lg = (sistema, nivel, msg) => log(nivel, `${sistema === 'smith' ? 'Smith' : 'Chaveiro'} · nota fiscal · ${msg}`)
  const quem = nome => { const p = validarPor(str(nome)); if (!p) throw erro('"por" precisa ser um líder ou consultor', 403); return p }
  const fiscal = c => h.prepare('SELECT * FROM cliente_fiscal WHERE cliente = ?').get(c) || null
  const termoOk = c => !!h.prepare('SELECT 1 FROM termo_fiscal WHERE cliente = ? AND versao = ? AND texto_sha256 = ?').get(c, termoVersao, termoSha)
  const nota = (c, ref) => { if (!REF_OK.test(String(ref || ''))) throw erro('nota não encontrada', 404); const n = h.prepare('SELECT * FROM nota_fiscal WHERE cliente = ? AND ref = ?').get(c, ref); if (!n) throw erro('nota não encontrada', 404); return n }
  const corpo = n => { try { return JSON.parse(n.corpo_json || '{}') } catch { return {} } }
  const regrasDe = c => h.prepare('SELECT * FROM regra_fiscal_produto WHERE cliente = ?').all(c)
  const evento = (c, ref, de, para, por, sistema, detalhe = {}, idem = null) =>
    h.prepare('INSERT OR IGNORE INTO nota_evento (cliente, ref, de, para, por, sistema, detalhe_json, idem, em) VALUES (?,?,?,?,?,?,?,?,?)').run(c, ref, de, para, por, sistema, JSON.stringify(detalhe), idem, agora()).changes
  const ambienteDe = f => (f.ambiente === 'producao' && N.producao_ligada === true ? 'producao' : 'homologacao')
  const tokenDe = (f, amb) => str(env[f.token_ref || `FOCUS_TOKEN_${amb.toUpperCase()}`] || '')
  const emissorDe = f => emissores[f.emissor] || null
  const emitenteDe = (c, f) => (f ? { ...f, termo_ok: termoOk(c) } : null)

  // ── configuração (Smith) ─────────────────────────────────────────────────────────────────────────────────────
  function validarCertRef(v) {
    const s = str(v)
    if (!s) return ''
    if (/^focus:empresa:\d{1,12}$/.test(s)) return s
    const m = s.match(/^arquivo:(.+\.enc)$/)
    if (m && isAbsolute(m[1]) && !m[1].includes('..') && raizDados && !resolve(m[1]).startsWith(resolve(raizDados))) return `arquivo:${resolve(m[1])}`
    throw erro('"cert_ref" precisa ser focus:empresa:<id> ou arquivo:<caminho absoluto .enc fora de data/>')
  }
  function configurar({ cliente, dados = {}, por, confirmar }) {
    const p = quem(por), d = dados && typeof dados === 'object' ? dados : {}
    const atual = fiscal(cliente) || {}
    const v = {
      cnpj: digitos(d.cnpj ?? atual.cnpj), razao_social: str(d.razao_social ?? atual.razao_social).slice(0, 120), ie: str(d.ie ?? atual.ie ?? '').slice(0, 20),
      uf: str(d.uf ?? atual.uf).toUpperCase(), regime: str(d.regime ?? atual.regime), serie: d.serie ?? atual.serie ?? N.serie_padrao,
      ambiente: str(d.ambiente ?? atual.ambiente ?? 'homologacao'), emissor: str(d.emissor ?? atual.emissor ?? 'focus'), politica: str(d.politica ?? atual.politica ?? 'aprovar'),
      vendedor_apelido: str(d.vendedor_apelido ?? atual.vendedor_apelido ?? '').slice(0, 60),
      modalidade_frete: d.modalidade_frete === undefined ? atual.modalidade_frete ?? null : d.modalidade_frete === null || d.modalidade_frete === '' ? null : Number(d.modalidade_frete), cert_ref: validarCertRef(d.cert_ref ?? atual.cert_ref ?? ''),
      cert_valido_ate: atual.cert_valido_ate || '', token_ref: str(d.token_ref ?? atual.token_ref ?? ''), contador: str(d.contador ?? atual.contador ?? '').slice(0, 120),
    }
    if (!cnpjOk(v.cnpj)) throw erro('"cnpj" inválido')
    if (!v.razao_social) throw erro('informe "razao_social"')
    if (!UFS.has(v.uf)) throw erro('"uf" inválida')
    if (!['simples', 'normal', 'mei'].includes(v.regime)) throw erro('"regime" precisa ser simples, normal ou mei')
    if (!Number.isInteger(v.serie) || v.serie < 0 || v.serie > 999) throw erro('"serie" inválida')
    if (!['homologacao', 'producao'].includes(v.ambiente)) throw erro('"ambiente" inválido')
    if (v.ambiente === 'producao' && N.producao_ligada !== true) throw erro('produção desligada (nf.producao_ligada): só homologação', 409)
    if (!['focus', 'sefaz'].includes(v.emissor)) throw erro('"emissor" inválido')
    if (!['aprovar', 'automatica'].includes(v.politica)) throw erro('"politica" precisa ser aprovar ou automatica')
    if (v.modalidade_frete !== null && ![0, 1, 2, 3, 4, 9].includes(v.modalidade_frete)) throw erro('"modalidade_frete" precisa ser 0, 1, 2, 3, 4 ou 9 (como o contador declarou)')
    if (v.token_ref && !/^FOCUS_TOKEN_[A-Z0-9_]{1,40}$/.test(v.token_ref)) throw erro('"token_ref" precisa ser o NOME de uma variável FOCUS_TOKEN_… do .env')
    if (!v.contador) throw erro('informe "contador" (quem declarou o regime)')
    if (v.politica === 'automatica') {
      const a = automaticoLiberado(h.prepare('SELECT estado, corrigida, autorizada_em, atualizado_em FROM nota_fiscal WHERE cliente = ?').all(cliente), N.automatica_apos_notas_sem_correcao)
      if (!a.ok || !termoOk(cliente)) throw erro(`emissão automática só depois de ${N.automatica_apos_notas_sem_correcao} notas seguidas sem correção e com o termo aceito`, 409)
    }
    if (confirmar !== true) return { previa: true, cliente, config: { ...v, cert: v.cert_ref ? 'referenciado' : 'ausente' } }
    h.prepare(`INSERT INTO cliente_fiscal (cliente, cnpj, razao_social, ie, uf, regime, serie, ambiente, emissor, politica, vendedor_apelido, modalidade_frete, cert_ref, cert_valido_ate, token_ref, contador, por, em)
      VALUES (@cliente,@cnpj,@razao_social,@ie,@uf,@regime,@serie,@ambiente,@emissor,@politica,@vendedor_apelido,@modalidade_frete,@cert_ref,@cert_valido_ate,@token_ref,@contador,@por,@em)
      ON CONFLICT(cliente) DO UPDATE SET cnpj=@cnpj, razao_social=@razao_social, ie=@ie, uf=@uf, regime=@regime, serie=@serie, ambiente=@ambiente, emissor=@emissor, politica=@politica,
      vendedor_apelido=@vendedor_apelido, modalidade_frete=@modalidade_frete, cert_ref=@cert_ref, token_ref=@token_ref, contador=@contador, por=@por, em=@em`).run({ ...v, cliente, por: p, em: agora() })
    lg('smith', 'info', `dados fiscais de ${cliente} gravados (regime ${v.regime}, ${v.ambiente}) por ${p}`)
    const r = remontar(cliente)
    return { ok: true, cliente, remontadas: r.remontadas }
  }
  function aceitarTermo({ cliente, aceito_por, aceito_em, por, confirmar }) {
    const p = quem(por), rep = str(aceito_por).slice(0, 120), dia = str(aceito_em)
    if (!rep) throw erro('informe "aceito_por" (representante do cliente)')
    if (!DIA.test(dia) || dia > agora().slice(0, 10)) throw erro('"aceito_em" precisa ser uma data (AAAA-MM-DD) até hoje')
    if (!termoTexto) throw erro('texto do termo indisponível', 409)
    if (confirmar !== true) return { previa: true, cliente, versao: termoVersao, texto: termoTexto }
    h.prepare('INSERT OR REPLACE INTO termo_fiscal (cliente, versao, texto_sha256, aceito_por, aceito_em, registrado_por, registrado_em) VALUES (?,?,?,?,?,?,?)').run(cliente, termoVersao, termoSha, rep, dia, p, agora())
    lg('smith', 'info', `termo fiscal ${termoVersao} de ${cliente} registrado por ${p}`)
    return { ok: true, cliente, versao: termoVersao, remontadas: remontar(cliente).remontadas }
  }
  function importarRegras({ cliente, csv, contador, por, confirmar }) {
    const p = quem(por), cont = str(contador).slice(0, 120)
    if (!cont) throw erro('informe "contador" (quem declarou as regras)')
    if (typeof csv !== 'string' || !csv.trim() || csv.length > 2_000_000) throw erro('envie o CSV do contador em "csv" (até 2 MB)')
    const { regras, erros } = lerCsvRegras(csv, cfg)
    const conhecidos = new Set(h.prepare("SELECT sku, sku_fonte FROM meli_anuncio_up WHERE cliente = ? AND sku != ''").all(cliente).filter(r => SKU_OFICIAL.has(r.sku_fonte)).map(r => chaveSku(r.sku)))
    const sem_anuncio = [...new Set(regras.map(r => r.sku).filter(s => !conhecidos.has(s)))].length
    if (confirmar !== true || erros.length) return { previa: true, cliente, validas: regras.length, erros: erros.slice(0, 200), skus_sem_anuncio: sem_anuncio, gravavel: !erros.length && regras.length > 0 }
    const ins = h.prepare(`INSERT OR REPLACE INTO regra_fiscal_produto (cliente, sku, operacao, ncm, cest, origem, cfop, cst_csosn, icms_aliquota, icms_reducao_bc, icms_aliquota_credito, st,
      pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, pis_cofins_exclui_icms, unidade, descricao, vigente_de, contador, por, em)
      VALUES (@cliente,@sku,@operacao,@ncm,@cest,@origem,@cfop,@cst_csosn,@icms_aliquota,@icms_reducao_bc,@icms_aliquota_credito,@st,@pis_cst,@pis_aliquota,@cofins_cst,@cofins_aliquota,
      @pis_cofins_exclui_icms,@unidade,@descricao,@vigente_de,@contador,@por,@em)`)
    const em = agora()
    h.transaction(() => { for (const r of regras) ins.run({ ...r, cliente, contador: cont, por: p, em }) })()
    lg('smith', 'info', `${regras.length} regras fiscais de ${cliente} importadas por ${p} (declaradas por contador)`)
    return { ok: true, cliente, gravadas: regras.length, remontadas: remontar(cliente).remontadas }
  }
  async function certificado({ cliente, base64, senha, por, confirmar }) {
    const p = quem(por), f = fiscal(cliente)
    if (!f) throw erro('cadastre os dados fiscais do cliente antes', 409)
    const m = String(f.cert_ref).match(/^focus:empresa:(\d+)$/)
    if (!m) throw erro('defina "cert_ref" = focus:empresa:<id da empresa na Focus> antes de enviar o certificado', 409)
    const b = Buffer.from(typeof base64 === 'string' ? base64 : '', 'base64')
    if (b.length < 100 || b.length > 5 * 1024 * 1024 || b[0] !== 0x30) throw erro('arquivo não parece um certificado A1 (.pfx/.p12) de até 5 MB')   // PKCS#12 = DER SEQUENCE
    if (typeof senha !== 'string' || !senha) throw erro('informe a senha do certificado (fica só nesta requisição)')
    if (confirmar !== true) return { previa: true, cliente, destino: 'provedor fiscal (Focus NFe), cifrado lá; nada é gravado no banco' }
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    const amb = ambienteDe(f), em = emissorDe(f)
    if (!em) return { ok: false, pendente: 'emissor' }
    const r = await em.cadastrarCertificado({ empresa_id: m[1], base64, senha }, { ambiente: amb, token: tokenDe(f, amb) })
    if (!r.ok || !DIA.test(r.certificado_valido_ate || '')) { lg('smith', 'aviso', `certificado de ${cliente} recusado pelo provedor (HTTP ${r.http || 0})`); return { ok: false, pendente: 'certificado_recusado' } }
    h.prepare('UPDATE cliente_fiscal SET cert_valido_ate = ?, por = ?, em = ? WHERE cliente = ?').run(r.certificado_valido_ate, p, agora(), cliente)
    lg('smith', 'info', `certificado de ${cliente} cadastrado no provedor, válido até ${r.certificado_valido_ate}`)
    return { ok: true, cliente, cert_valido_ate: r.certificado_valido_ate, remontadas: remontar(cliente).remontadas }
  }

  // ── rascunhos a partir das linhas de pedido pagas (1 nota por pacote) ─────────────────────────────────────────────────
  function gruposPendentes(cliente, { limite = 200 } = {}) {
    const linhas = h.prepare(`SELECT p.order_id, p.item_id, p.variacao_id, p.dia, p.quantidade, p.preco_unit_c, p.seller_sku, p.pack_id, p.cupom_c, COALESCE(i.titulo,'') AS titulo,
      (SELECT u.sku FROM meli_anuncio_up u WHERE u.cliente = p.cliente AND u.item_id = p.item_id AND u.variacao_id = p.variacao_id AND u.sku_fonte IN ('seller_sku','variacao','pedido')) AS sku_up
      FROM meli_pedido_item p LEFT JOIN meli_item i ON i.cliente = p.cliente AND i.item_id = p.item_id
      WHERE p.cliente = ? AND p.status = 'paid' ORDER BY p.dia, p.order_id, p.item_id, p.variacao_id`).all(cliente)
    const grupos = new Map()
    for (const l of linhas) {
      const ref = refDe(cliente, l), g = grupos.get(ref) || { ref, pack_id: l.pack_id || '', order_ids: [], dia: l.dia, linhas: [] }
      if (!g.order_ids.includes(l.order_id)) g.order_ids.push(l.order_id)
      if (l.dia > g.dia) g.dia = l.dia
      g.linhas.push(l); grupos.set(ref, g)
    }
    const existe = h.prepare('SELECT 1 FROM nota_fiscal WHERE cliente = ? AND ref = ?')
    return [...grupos.values()].filter(g => !existe.get(cliente, g.ref)).slice(0, limite)
  }
  const pedidoDe = (cliente, g, lido) => ({ cliente, ref: g.ref, pack_id: g.pack_id, order_ids: g.order_ids, data: g.dia, ...lido,
    itens: g.linhas.map(l => ({ order_id: l.order_id, item_id: l.item_id, variacao_id: l.variacao_id, sku: l.seller_sku || l.sku_up || '', descricao: l.titulo,
      quantidade: l.quantidade, preco_unit_c: l.preco_unit_c, cupom_c: l.cupom_c })) })
  function gravarMontagem(cliente, ref, pedido, m, { novo }) {
    const em = agora(), hash = hashNota(m.nota)
    h.transaction(() => {
      if (novo) h.prepare(`INSERT INTO nota_fiscal (cliente, ref, pack_id, order_ids, estado, bloqueios_json, corpo_json, hash, total_c, imposto_c, pago_em, criado_em, atualizado_em)
        VALUES (?,?,?,?,'rascunho',?,?,?,?,?,?,?,?)`).run(cliente, ref, pedido.pack_id || '', pedido.order_ids.join(','), JSON.stringify(m.bloqueios), JSON.stringify({ entrada: pedido, nota: m.nota }), hash, m.nota.totais.nota_c, m.nota.totais.imposto_c, pedido.data, em, em)
      else h.prepare("UPDATE nota_fiscal SET estado = 'rascunho', bloqueios_json = ?, corpo_json = ?, hash = ?, total_c = ?, imposto_c = ?, aprovada_por = '', aprovada_em = '', atualizado_em = ? WHERE cliente = ? AND ref = ?")
        .run(JSON.stringify(m.bloqueios), JSON.stringify({ entrada: pedido, nota: m.nota }), hash, m.nota.totais.nota_c, m.nota.totais.imposto_c, em, cliente, ref)
      h.prepare('DELETE FROM nota_item WHERE cliente = ? AND ref = ?').run(cliente, ref)
      const ins = h.prepare(`INSERT INTO nota_item (cliente, ref, n_item, order_id, item_id, variacao_id, sku, quantidade, valor_unit_c, valor_bruto_c, frete_c, ncm, cfop, cst_csosn, icms_base_c, icms_valor_c, pis_valor_c, cofins_valor_c, regra_vigente_de)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const i of m.nota.itens) ins.run(cliente, ref, i.n_item, i.order_id, i.item_id, i.variacao_id, i.sku, i.quantidade, i.valor_unit_c, i.valor_bruto_c, i.frete_c, i.ncm, i.cfop, i.cst_csosn, i.icms_base_c, i.icms_valor_c, i.pis_valor_c, i.cofins_valor_c, i.regra_vigente_de)
    })()
  }
  async function gerarRascunhos(cliente, { limite = 50 } = {}) {
    const f = fiscal(cliente)
    if (!f) return { ok: false, pendente: 'dados_fiscais' }
    const regras = regrasDe(cliente), emit = emitenteDe(cliente, f)
    let criadas = 0, bloqueadas = 0
    for (const g of gruposPendentes(cliente, { limite })) {
      let lido = { comprador: null, pagamentos: null, frete_comprador_c: null }
      try { if (ml.lerPedido) lido = await ml.lerPedido(cliente, g.order_ids) || lido } catch { /* leitura falhou: a montagem bloqueia com o motivo */ }
      const pedido = pedidoDe(cliente, g, lido), m = montarNota(pedido, regras, emit, cfg)
      gravarMontagem(cliente, g.ref, pedido, m, { novo: true })
      evento(cliente, g.ref, '', 'rascunho', 'sistema', 'chaveiro', { bloqueios: m.bloqueios.map(b => b.codigo) })
      criadas++; if (m.bloqueios.length) bloqueadas++
    }
    // releitura: rascunho bloqueado SÓ por leitura do pedido (billing/frete/pagamento) tenta de novo; o resto do bloqueio é humano
    const LEITURA = new Set(['comprador_billing_info', 'frete_nao_lido', 'pagamento_nao_lido'])
    let relidas = 0
    for (const row of h.prepare("SELECT ref, bloqueios_json, corpo_json FROM nota_fiscal WHERE cliente = ? AND estado = 'rascunho' AND bloqueios_json != '[]' ORDER BY pago_em LIMIT ?").all(cliente, limite)) {
      let bl = []; try { bl = JSON.parse(row.bloqueios_json) } catch { continue }
      if (!bl.some(b => LEITURA.has(b.codigo)) || !ml.lerPedido) continue
      const entrada = corpo(row).entrada
      let lido = null; try { lido = await ml.lerPedido(cliente, entrada.order_ids) } catch { lido = null }
      if (!lido) continue
      const ped = { ...entrada, comprador: lido.comprador ?? entrada.comprador, pagamentos: lido.pagamentos ?? entrada.pagamentos, frete_comprador_c: lido.frete_comprador_c ?? entrada.frete_comprador_c }
      const m = montarNota(ped, regras, emit, cfg)
      if (hashNota(m.nota) === hashNota(corpo(row).nota) && JSON.stringify(m.bloqueios) === row.bloqueios_json) continue
      gravarMontagem(cliente, row.ref, ped, m, { novo: false }); evento(cliente, row.ref, 'rascunho', 'rascunho', 'sistema', 'chaveiro', { relida: true, bloqueios: m.bloqueios.map(b => b.codigo) }); relidas++
    }
    if (criadas || relidas) lg('chaveiro', 'info', `${criadas} nota(s) em rascunho para ${cliente} (${bloqueadas} com bloqueio), ${relidas} relida(s)`)
    return { ok: true, criadas, bloqueadas, relidas }
  }
  // remonta rascunhos/rejeitadas/aprovadas (regra, termo ou dado novo) com a MESMA entrada lida; aprovada que muda volta a rascunho e conta como correção
  function remontar(cliente) {
    const f = fiscal(cliente)
    if (!f) return { remontadas: 0 }
    const regras = regrasDe(cliente), emit = emitenteDe(cliente, f)
    let n = 0
    for (const row of h.prepare("SELECT * FROM nota_fiscal WHERE cliente = ? AND estado IN ('rascunho','aprovada','rejeitada')").all(cliente)) {
      const entrada = corpo(row).entrada
      if (!entrada) continue
      const m = montarNota(entrada, regras, emit, cfg), hash = hashNota(m.nota)
      if (hash === row.hash && row.estado !== 'rejeitada' && JSON.stringify(m.bloqueios) === row.bloqueios_json) continue
      gravarMontagem(cliente, row.ref, entrada, m, { novo: false })
      if (row.estado !== 'rascunho') h.prepare('UPDATE nota_fiscal SET corrigida = 1 WHERE cliente = ? AND ref = ?').run(cliente, row.ref)
      evento(cliente, row.ref, row.estado, 'rascunho', 'sistema', 'smith', { remontada: true, bloqueios: m.bloqueios.map(b => b.codigo) })
      n++
    }
    return { remontadas: n }
  }

  // ── aprovação (líder/consultor) ─────────────────────────────────────────────────────────────────────────────────
  function aprovar({ cliente, refs, por, confirmar }) {
    const p = quem(por)
    if (!Array.isArray(refs) || !refs.length || refs.length > 200) throw erro('informe "refs" (1 a 200 notas)')
    const prontas = [], recusadas = []
    for (const ref of refs) {
      const n = (() => { try { return nota(cliente, ref) } catch { return null } })()
      if (!n) { recusadas.push({ ref: String(ref).slice(0, 40), motivo: 'nao_encontrada' }); continue }
      if (n.estado !== 'rascunho') { recusadas.push({ ref: n.ref, motivo: 'estado' }); continue }
      if (n.bloqueios_json !== '[]') { recusadas.push({ ref: n.ref, motivo: 'bloqueio' }); continue }
      if (hashNota(corpo(n).nota) !== n.hash) { recusadas.push({ ref: n.ref, motivo: 'corpo_alterado' }); continue }
      prontas.push(n)
    }
    if (confirmar !== true) return { previa: true, cliente, aprovaveis: prontas.map(projecaoNota), recusadas }
    const em = agora()
    for (const n of prontas) {
      h.prepare("UPDATE nota_fiscal SET estado = 'aprovada', aprovada_por = ?, aprovada_em = ?, atualizado_em = ? WHERE cliente = ? AND ref = ? AND estado = 'rascunho' AND hash = ?").run(p, em, em, cliente, n.ref, n.hash)
      evento(cliente, n.ref, 'rascunho', 'aprovada', p, 'chaveiro', { hash: n.hash })
    }
    lg('chaveiro', 'info', `${prontas.length} nota(s) de ${cliente} aprovada(s) por ${p}`)
    return { ok: true, cliente, aprovadas: prontas.length, recusadas }
  }

  // ── retorno do emissor (síncrono, consulta ou webhook): transição única, idempotente ─────────────────────────────────────
  async function aplicarResultado(cliente, n, r, { por = 'sistema', origem }) {
    const para = r.estado
    const idem = `${origem}:${para}:${r.status_sefaz || ''}:${r.chave || ''}`
    if (para === n.estado && para !== 'enviada') { evento(cliente, n.ref, n.estado, para, por, 'chaveiro', { origem, duplicado: true }, idem); return { ref: n.ref, estado: n.estado, duplicado: true } }
    if (!podeIr(n.estado, para)) { evento(cliente, n.ref, n.estado, n.estado, por, 'chaveiro', { origem, ignorado: para }, idem); return { ref: n.ref, estado: n.estado, ignorado: true } }
    const em = agora(), det = { origem, status_sefaz: r.status_sefaz || '', mensagem: mascaraTexto(r.mensagem), codigo: r.codigo || '', http: r.http || 0, erros: (r.erros || []).map(e => ({ campo: e.campo, mensagem: mascaraTexto(e.mensagem) })) }
    const f = fiscal(cliente)
    if (para === 'autorizada') {
      // a chave carrega o CNPJ do emitente (posições 7–20): notificação de outro emitente nunca vale aqui
      if (!/^\d{44}$/.test(r.chave || '') || r.chave.slice(6, 20) !== f?.cnpj) { evento(cliente, n.ref, n.estado, 'erro', por, 'chaveiro', { ...det, motivo: 'chave_invalida' }, idem); h.prepare("UPDATE nota_fiscal SET estado = 'erro', atualizado_em = ? WHERE cliente = ? AND ref = ?").run(em, cliente, n.ref); return { ref: n.ref, estado: 'erro' } }
      let xml_arquivo = ''
      try {
        const amb = n.ambiente || ambienteDe(f), xml = await emissorDe(f).baixar(r.caminho_xml, { ambiente: amb, token: tokenDe(f, amb) })
        const dir = join(dirXml, sha256(cliente).slice(0, 12)); mkdirSync(dir, { recursive: true })
        xml_arquivo = join(dir, `${r.chave}.xml`); writeFileSync(xml_arquivo, xml, { mode: 0o600 })
      } catch { det.xml = 'pendente' }
      h.prepare("UPDATE nota_fiscal SET estado = 'autorizada', chave = ?, numero = ?, serie = ?, status_sefaz = ?, xml_arquivo = ?, autorizada_em = ?, atualizado_em = ? WHERE cliente = ? AND ref = ?")
        .run(r.chave, r.numero || '', r.serie || '', r.status_sefaz || '', xml_arquivo, em, em, cliente, n.ref)
      evento(cliente, n.ref, n.estado, 'autorizada', por, 'chaveiro', { ...det, chave: r.chave }, idem)
      lg('chaveiro', 'info', `nota ${n.ref} de ${cliente} autorizada (${n.ambiente || ''})`)
      if (xml_arquivo) await anexarMl({ cliente, ref: n.ref })
      return { ref: n.ref, estado: 'autorizada' }
    }
    const extra = para === 'rejeitada' || para === 'cancelada' ? ', corrigida = 1' : ''
    h.prepare(`UPDATE nota_fiscal SET estado = ?, status_sefaz = ?, atualizado_em = ?${extra} WHERE cliente = ? AND ref = ?`).run(para, r.status_sefaz || n.status_sefaz || '', em, cliente, n.ref)
    evento(cliente, n.ref, n.estado, para, por, 'chaveiro', det, idem)
    if (para === 'rejeitada') lg('chaveiro', 'aviso', `nota ${n.ref} de ${cliente} rejeitada (cStat ${r.status_sefaz || '—'}): correção só por humano (regra ou dado)`)
    return { ref: n.ref, estado: para }
  }

  // ── emissão (Chaveiro): chave global, termo, hash aprovado, token por nome, homologação salvo exceção dupla ──────────────────────────
  async function emitir({ cliente, refs, por, confirmar, automatico = false }) {
    const p = automatico === true ? 'sistema' : quem(por)
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    const f = fiscal(cliente)
    if (!f) return { ok: false, pendente: 'dados_fiscais' }
    if (!termoOk(cliente)) return { ok: false, pendente: 'termo_fiscal' }
    if (!f.cert_valido_ate || f.cert_valido_ate < agora().slice(0, 10)) return { ok: false, pendente: 'certificado' }
    const auto = f.politica === 'automatica' && automaticoLiberado(h.prepare('SELECT estado, corrigida, autorizada_em, atualizado_em FROM nota_fiscal WHERE cliente = ?').all(cliente), N.automatica_apos_notas_sem_correcao).ok
    const estados = auto ? ['aprovada', 'rascunho'] : ['aprovada']
    const alvo = (Array.isArray(refs) && refs.length ? refs.slice(0, 50).map(r => { try { return nota(cliente, r) } catch { return null } }).filter(Boolean)
      : h.prepare(`SELECT * FROM nota_fiscal WHERE cliente = ? AND estado IN (${estados.map(() => '?').join(',')}) ORDER BY pago_em LIMIT 50`).all(cliente, ...estados))
      .filter(n => estados.includes(n.estado) && n.bloqueios_json === '[]' && hashNota(corpo(n).nota) === n.hash)
    const amb = ambienteDe(f)
    if (confirmar !== true) return { previa: true, cliente, ambiente: amb, automatica: auto, notas: alvo.map(projecaoNota) }
    const em = emissorDe(f), token = tokenDe(f, amb)
    if (!em) return { ok: false, pendente: 'emissor' }
    if (!token) return { ok: false, pendente: 'token_emissor' }
    const resultados = []
    for (const n of alvo) {
      const atual = nota(cliente, n.ref)
      if (!estados.includes(atual.estado) || atual.hash !== n.hash) { resultados.push({ ref: n.ref, estado: atual.estado, ignorado: true }); continue }
      if (!h.prepare("UPDATE nota_fiscal SET estado = 'enviada', emissor = ?, ambiente = ?, atualizado_em = ? WHERE cliente = ? AND ref = ? AND estado = ? AND hash = ?").run(em.nome, amb, agora(), cliente, n.ref, atual.estado, n.hash).changes) { resultados.push({ ref: n.ref, estado: atual.estado, ignorado: true }); continue }
      evento(cliente, n.ref, atual.estado, 'enviada', p, 'chaveiro', { ambiente: amb, emissor: em.nome, hash: n.hash, automatica: atual.estado === 'rascunho' })
      let r
      try { r = await em.emitir(corpo(n).nota, { ref: n.ref, ambiente: amb, token, data_emissao: agora() }) } catch { r = { estado: 'erro', codigo: 'excecao' } }
      resultados.push(await aplicarResultado(cliente, { ...atual, estado: 'enviada', ambiente: amb }, r, { por: p, origem: 'emissao' }))
    }
    return { ok: true, cliente, ambiente: amb, resultados }
  }
  async function consultar({ cliente, ref }) {
    const n = nota(cliente, ref), f = fiscal(cliente)
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    if (!['enviada', 'erro'].includes(n.estado)) return { ok: true, ref: n.ref, estado: n.estado }
    const amb = n.ambiente || ambienteDe(f), r = await emissorDe(f).consultar(n.ref, { ambiente: amb, token: tokenDe(f, amb) })
    if (r.http === 404 && n.estado === 'erro') {                                  // o provedor nunca recebeu: volta a rascunho para nova aprovação (nunca reenvio às cegas)
      h.prepare("UPDATE nota_fiscal SET estado = 'rascunho', aprovada_por = '', aprovada_em = '', atualizado_em = ? WHERE cliente = ? AND ref = ? AND estado = 'erro'").run(agora(), cliente, n.ref)
      evento(cliente, n.ref, 'erro', 'rascunho', 'sistema', 'chaveiro', { origem: 'consulta', motivo: 'nao_recebida_pelo_provedor' })
      return { ok: true, ref: n.ref, estado: 'rascunho' }
    }
    return { ok: true, ...(await aplicarResultado(cliente, n, r, { origem: 'consulta' })) }
  }
  // webhook do provedor: assinatura no adaptador; nota achada só pela ref (única por cliente), idempotente pela transição
  async function webhook(nomeEmissor, headers, corpoReq) {
    const em = emissores[nomeEmissor]
    if (!em || N.ligado !== true) throw erro('não autorizado', 401)
    const r = em.webhook(headers, corpoReq)
    if (!REF_OK.test(r.ref)) throw erro('notificação sem referência válida', 400)
    const n = h.prepare('SELECT * FROM nota_fiscal WHERE ref = ?').get(r.ref)
    if (!n) return { ok: true, ignorado: true }
    if (r.estado === 'erro') return { ok: true, ignorado: true }
    return { ok: true, ...(await aplicarResultado(n.cliente, n, r, { origem: 'webhook' })) }
  }
  async function cancelar({ cliente, ref, justificativa, por, confirmar }) {
    const p = quem(por), n = nota(cliente, ref), j = str(justificativa)
    if (j.length < 15 || j.length > 255) throw erro('"justificativa" precisa ter de 15 a 255 caracteres')
    if (!['autorizada', 'anexada'].includes(n.estado)) throw erro('só nota autorizada pode ser cancelada', 409)
    if (confirmar !== true) return { previa: true, cliente, nota: projecaoNota(n), aviso: 'cancelamento pela SEFAZ em até 24 h da autorização (algumas UFs aceitam mais); depois, devolução por nota de entrada conforme o contador' }
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    const f = fiscal(cliente), amb = n.ambiente || ambienteDe(f)
    const r = await emissorDe(f).cancelar(n.ref, j, { ambiente: amb, token: tokenDe(f, amb) })
    const cancelou = r.estado === 'cancelada'
    if (!cancelou) { evento(cliente, n.ref, n.estado, n.estado, p, 'chaveiro', { cancelamento: 'recusado', status_sefaz: r.status_sefaz || '', mensagem: mascaraTexto(r.mensagem) }); return { ok: false, estado: n.estado, motivo: 'cancelamento_recusado', status_sefaz: r.status_sefaz || '' } }
    const out = await aplicarResultado(cliente, n, { estado: 'cancelada', status_sefaz: r.status_sefaz }, { por: p, origem: 'cancelamento' })
    lg('chaveiro', 'info', `nota ${n.ref} de ${cliente} cancelada por ${p}`)
    return { ok: true, ...out }
  }
  async function cartaCorrecao({ cliente, ref, correcao, por, confirmar }) {
    const p = quem(por), n = nota(cliente, ref), t = str(correcao)
    if (t.length < 15 || t.length > 1000) throw erro('"correcao" precisa ter de 15 a 1000 caracteres')
    if (!['autorizada', 'anexada'].includes(n.estado)) throw erro('carta de correção só em nota autorizada', 409)
    if (confirmar !== true) return { previa: true, cliente, nota: projecaoNota(n), aviso: 'a carta de correção não corrige imposto (base, alíquota, valor), emitente/destinatário nem datas' }
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    const f = fiscal(cliente), amb = n.ambiente || ambienteDe(f)
    const r = await emissorDe(f).cartaCorrecao(n.ref, t, { ambiente: amb, token: tokenDe(f, amb) })
    if (r.estado !== 'autorizada') return { ok: false, motivo: 'carta_recusada', status_sefaz: r.status_sefaz || '' }
    h.prepare('UPDATE nota_fiscal SET corrigida = 1, atualizado_em = ? WHERE cliente = ? AND ref = ?').run(agora(), cliente, n.ref)
    evento(cliente, n.ref, n.estado, n.estado, p, 'chaveiro', { carta_correcao: r.numero_carta || '', status_sefaz: r.status_sefaz || '', correcao_sha256: sha256(t) })
    return { ok: true, ref: n.ref, carta: r.numero_carta || '' }
  }
  // anexo ao pacote do ML (Chaveiro): chamada real só com nf.envio_ml_ligado; 409 = já anexada
  async function anexarMl({ cliente, ref }) {
    const n = nota(cliente, ref)
    if (n.estado !== 'autorizada') return { ok: false, motivo: 'estado' }
    if (!n.xml_arquivo || !existsSync(n.xml_arquivo)) return { ok: false, pendente: 'xml' }
    if (statSync(n.xml_arquivo).size > N.max_xml_bytes) return { ok: false, pendente: 'xml_maior_que_1mb' }
    if (N.envio_ml_ligado !== true || !ml.anexar) return { ok: false, pendente: 'envio_ml_desligado' }
    const r = await ml.anexar(cliente, { pack_id: n.pack_id, order_id: String(n.order_ids).split(',')[0], xml: readFileSync(n.xml_arquivo, 'utf-8') })
    if (!r?.ok) { evento(cliente, n.ref, n.estado, n.estado, 'sistema', 'chaveiro', { anexo_ml: r?.motivo || 'falhou', http: r?.http || 0 }); return { ok: false, motivo: r?.motivo || 'falhou' } }
    h.prepare("UPDATE nota_fiscal SET estado = 'anexada', anexada_em = ?, atualizado_em = ? WHERE cliente = ? AND ref = ? AND estado = 'autorizada'").run(agora(), agora(), cliente, n.ref)
    evento(cliente, n.ref, 'autorizada', 'anexada', 'sistema', 'chaveiro', { ja_existia: !!r.ja_existia, http: r.http || 0 })
    return { ok: true, ref: n.ref, estado: 'anexada' }
  }

  // ── leitura ───────────────────────────────────────────────────────────────────────────────────────────────────
  const ESTADOS = new Set(['rascunho', 'aprovada', 'enviada', 'autorizada', 'rejeitada', 'cancelada', 'anexada', 'erro'])
  function listar(cliente, { estado = '', limite = 200 } = {}) {
    if (estado && !ESTADOS.has(estado)) throw erro('"estado" inválido')
    const rows = h.prepare(`SELECT * FROM nota_fiscal WHERE cliente = ?${estado ? ' AND estado = ?' : ''} ORDER BY pago_em DESC, ref LIMIT ?`).all(...[cliente, ...(estado ? [estado] : []), Math.min(500, limite)])
    return rows.map(projecaoNota)
  }
  function estado(cliente) {
    const f = fiscal(cliente), hoje = agora().slice(0, 10)
    const t = h.prepare('SELECT versao, aceito_por, aceito_em, registrado_por FROM termo_fiscal WHERE cliente = ? AND versao = ? AND texto_sha256 = ?').get(cliente, termoVersao, termoSha) || null
    const notas = h.prepare('SELECT estado, corrigida, autorizada_em, atualizado_em, bloqueios_json, pago_em, ref FROM nota_fiscal WHERE cliente = ?').all(cliente)
    const cert = !f?.cert_ref ? 'ausente' : !f.cert_valido_ate ? 'referenciado_sem_validade' : f.cert_valido_ate < hoje ? 'vencido' : f.cert_valido_ate <= new Date(Date.parse(hoje) + 30 * 864e5).toISOString().slice(0, 10) ? 'vence_em_30_dias' : 'valido'
    const regras = h.prepare('SELECT sku, operacao, ncm, cfop, cst_csosn, vigente_de, contador FROM regra_fiscal_produto WHERE cliente = ? ORDER BY sku, operacao, vigente_de DESC LIMIT 500').all(cliente)
    const porEstado = {}; for (const n of notas) porEstado[n.estado] = (porEstado[n.estado] || 0) + 1
    return {
      cliente, chaves: { ligado: N.ligado === true, envio_ml_ligado: N.envio_ml_ligado === true, producao_ligada: N.producao_ligada === true },
      config: f ? { cnpj: f.cnpj, razao_social: f.razao_social, ie: f.ie, uf: f.uf, regime: f.regime, serie: f.serie, ambiente: ambienteDe(f), emissor: f.emissor, politica: f.politica,
        vendedor_apelido: f.vendedor_apelido, modalidade_frete: f.modalidade_frete, contador: f.contador, cert_ref_tipo: f.cert_ref.split(':')[0] || '', cert_valido_ate: f.cert_valido_ate, token: tokenDe(f, ambienteDe(f)) ? 'configurado' : 'ausente', por: f.por, em: f.em } : null,
      certificado: cert, termo: { versao: termoVersao, aceito: t }, regras, total_regras: h.prepare('SELECT COUNT(*) n FROM regra_fiscal_produto WHERE cliente = ?').get(cliente).n,
      notas: porEstado, automatica: automaticoLiberado(notas, N.automatica_apos_notas_sem_correcao),
      sinais: sinaisNota(notas, agora(), N.pendente_apos_horas), bloqueios_texto: BLOQUEIO,
    }
  }
  const eventos = (cliente, ref) => (nota(cliente, ref), h.prepare('SELECT de, para, por, sistema, detalhe_json, em FROM nota_evento WHERE cliente = ? AND ref = ? ORDER BY id').all(cliente, ref)
    .map(e => ({ ...e, detalhe: JSON.parse(e.detalhe_json || '{}'), detalhe_json: undefined })))
  const recebiveis = (cliente, opts = {}) => recebiveisDeNotas(h.prepare('SELECT estado, total_c, order_ids, pago_em FROM nota_fiscal WHERE cliente = ?').all(cliente), opts)

  // tick (10 min): nada com a chave desligada; rascunhos novos e, só com a política automática LIBERADA, a emissão
  async function tick({ limite = 20 } = {}) {
    if (N.ligado !== true) return { ok: false, pendente: 'nf_desligado' }
    const out = []
    for (const { cliente } of h.prepare('SELECT cliente FROM cliente_fiscal').all()) {
      try {
        const g = await gerarRascunhos(cliente, { limite })
        const f = fiscal(cliente)
        const e = f.politica === 'automatica' ? await emitir({ cliente, automatico: true, confirmar: true }) : null
        out.push({ cliente, criadas: g.criadas || 0, emitidas: e?.resultados?.length || 0 })
      } catch (err) { lg('chaveiro', 'erro', `tick de ${cliente}: ${String(err?.message || err).slice(0, 120)}`) }
    }
    return { ok: true, clientes: out }
  }

  return { gerar: ({ cliente, por }) => (quem(por), gerarRascunhos(cliente)), anexar: ({ cliente, ref, por }) => (quem(por), anexarMl({ cliente, ref })),
    pendentes: cliente => gruposPendentes(cliente, { limite: 100000 }).length, estado, configurar, aceitarTermo, importarRegras, certificado, gerarRascunhos, remontar, aprovar, emitir, consultar, webhook, cancelar, cartaCorrecao, anexarMl, listar, eventos, recebiveis, tick,
    sinais: cliente => sinaisNota(h.prepare('SELECT estado, bloqueios_json, pago_em, ref FROM nota_fiscal WHERE cliente = ?').all(cliente), agora(), N.pendente_apos_horas) }
}
