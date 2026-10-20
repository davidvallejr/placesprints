// V3 F8 — Nota fiscal (docs/desenho-v3-erp.md § B): montagem PURA (Simples/CSOSN × normal/CST, sem regra = bloqueio por item, nunca inferir, totais em centavos,
// vigência, ST/DIFAL/contribuinte/cupom/frete/pagamento bloqueados), CSV do contador sem eco, fluxo no banco EM MEMÓRIA (rascunho → aprovação → emissão em
// homologação com Focus FALSO → webhook idempotente → XML → anexo ML desligado → cancelamento/carta), chaves desligadas, isolamento por cliente, rotas
// (415/404/403/prévia), certificado e dado do comprador nunca no banco/logs/eventos/tela. Nenhuma chamada a provedor fiscal, SEFAZ ou Mercado Livre.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const { db } = await import('../src/lib/db.js')
const NF = await import('../src/lib/nota-fiscal.js')
const { criarNotaFiscal, compradorDoBilling, lerPedidosMl, anexarXmlMl } = await import('../src/lib/nota-fiscal-real.js')
const { criarFocus, paraFocus } = await import('../src/lib/emissores/focus-nfe.js')
const { criarSefazNativo } = await import('../src/lib/emissores/sefaz-nativo.js')
const { criarRotasNotaFiscal, criarRotaWebhookNota } = await import('../src/rotas-nota-fiscal.js')
const { ROTA_PUBLICA } = await import('../src/lib/guarda-local.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const CFG0 = JSON.parse(readFileSync(new URL('../config/nota-fiscal.json', import.meta.url), 'utf-8'))
const TERMO = readFileSync(new URL('../config/termo-fiscal.md', import.meta.url), 'utf-8')

// documentos válidos gerados (dígitos verificadores reais), nunca de pessoa real
const dv = (b, p) => { const s = [...b].reduce((t, c, i) => t + +c * p[i], 0) % 11; return s < 2 ? 0 : 11 - s }
const cnpj = b12 => { const d1 = dv(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return b12 + d1 + dv(b12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) }
const cpf = b9 => { const d1 = dv(b9, [10, 9, 8, 7, 6, 5, 4, 3, 2]); return b9 + d1 + dv(b9 + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) }
const CNPJ_A = cnpj('112223330001'), CNPJ_B = cnpj('445556660001'), CNPJ_ML = cnpj('030073310001'), CNPJ_CRED = cnpj('105735210001'), CPF_COMPRADOR = cpf('529982247'), CNPJ_COMPRADOR = cnpj('778889990001')
const CFG = { ...CFG0, intermediador: { ...CFG0.intermediador, cnpj: CNPJ_ML }, pagamento: { ...CFG0.pagamento, cnpj_credenciadora: CNPJ_CRED } }
const HOJE = new Date().toISOString().slice(0, 10)
const comprador = (o = {}) => ({ nome: 'Ana Compradora Teste', doc: CPF_COMPRADOR, ie: '', logradouro: 'Rua das Flores', numero: '100', complemento: '', bairro: 'Centro', municipio: 'Santos', uf: 'SP', cep: '11010-000', ...o })
const emitente = (o = {}) => ({ cnpj: CNPJ_A, razao_social: 'Loja A Ltda', ie: '123456789', uf: 'SP', regime: 'simples', termo_ok: true, cert_ref: 'focus:empresa:1', cert_valido_ate: '2099-12-31', vendedor_apelido: 'LOJA_A', modalidade_frete: 0, ...o })
const regra = (sku, o = {}) => ({ cliente: 'A', sku: sku.toLowerCase(), operacao: 'venda_dentro_uf', ncm: '42010000', cest: '', origem: 0, cfop: '5102', cst_csosn: '102', icms_aliquota: null, icms_reducao_bc: null,
  icms_aliquota_credito: null, st: 0, pis_cst: '49', pis_aliquota: 0, cofins_cst: '49', cofins_aliquota: 0, pis_cofins_exclui_icms: null, unidade: 'UN', descricao: '', vigente_de: '2026-01-01', ...o })
const pedido = (o = {}) => ({ cliente: 'A', ref: 'psabcdef01-o1', pack_id: '', order_ids: ['1'], data: HOJE, frete_comprador_c: 0, comprador: comprador(),
  itens: [{ order_id: '1', item_id: 'MLB1', variacao_id: '', sku: 'PEIT-M', descricao: 'Peitoral M', quantidade: 2, preco_unit_c: 5000, cupom_c: null },
    { order_id: '1', item_id: 'MLB2', variacao_id: '', sku: 'GUIA-1', descricao: 'Guia', quantidade: 1, preco_unit_c: 3333, cupom_c: 0 }],
  pagamentos: [{ tipo: 'bank_transfer', metodo: 'pix', valor_c: 13333, autorizacao: '' }], ...o })

// ═══════════════ montagem PURA ═══════════════
await ok('Simples/CSOSN 102: sem destaque de ICMS, PIS/COFINS 49 com alíquota 0 declarada, total em centavos, modalidade do frete declarada, nada bloqueado', () => {
  const { nota, bloqueios } = NF.montarNota(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente(), CFG)
  assert.deepEqual(bloqueios, [])
  assert.equal(nota.emitente.crt, 1); assert.equal(nota.operacao, 'venda_dentro_uf'); assert.equal(nota.local_destino, 1); assert.equal(nota.consumidor_final, 1)
  assert.equal(nota.totais.produtos_c, 13333); assert.equal(nota.totais.frete_c, 0); assert.equal(nota.totais.nota_c, 13333); assert.equal(nota.modalidade_frete, 0)
  assert.equal(nota.totais.icms_c, 0); assert.equal(nota.itens[0].icms_valor_c, null, 'CSOSN 102 não destaca ICMS'); assert.equal(nota.totais.imposto_c, 0)
  assert.equal(nota.itens[0].pis_base_c, 10000); assert.equal(nota.itens[0].pis_valor_c, 0)
  const f = paraFocus(nota, { data_emissao: '2026-10-15T10:00:00-03:00' })
  assert.equal(f.regime_tributario_emitente, 1); assert.equal(f.indicador_intermediario, 1); assert.equal(f.cnpj_intermediario, CNPJ_ML); assert.equal(f.cpf_destinatario, CPF_COMPRADOR)
  assert.equal(f.valor_total, 133.33); assert.equal(f.modalidade_frete, 0); assert.equal(f.items[0].icms_situacao_tributaria, '102'); assert.equal(f.items[0].icms_aliquota, undefined); assert.equal(f.formas_pagamento[0].forma_pagamento, '17')
})

await ok('normal/CST 00 e 20: ICMS só pela alíquota declarada, PIS/COFINS 01 com exclusão do ICMS declarada, arredondamento explícito por item', () => {
  const r = [regra('PEIT-M', { cst_csosn: '00', icms_aliquota: 18, pis_cst: '01', pis_aliquota: 1.65, cofins_cst: '01', cofins_aliquota: 7.6, pis_cofins_exclui_icms: 1 }),
    regra('GUIA-1', { cst_csosn: '20', icms_aliquota: 18, icms_reducao_bc: 33.33, pis_cst: '01', pis_aliquota: 1.65, cofins_cst: '01', cofins_aliquota: 7.6, pis_cofins_exclui_icms: 0 })]
  const { nota, bloqueios } = NF.montarNota(pedido(), r, emitente({ regime: 'normal' }), CFG)
  assert.deepEqual(bloqueios, [])
  const [a, b] = nota.itens
  assert.equal(nota.emitente.crt, 3)
  assert.equal(a.icms_base_c, 10000); assert.equal(a.icms_valor_c, 1800)
  assert.equal(a.pis_base_c, 10000 - 1800); assert.equal(a.pis_valor_c, Math.round(8200 * 1.65 / 100)); assert.equal(a.cofins_valor_c, 623)   // 8200 × 7,6% = 623,2 → 623
  assert.equal(b.icms_base_c, Math.round(3333 * (1 - 0.3333))); assert.equal(b.icms_valor_c, Math.round(b.icms_base_c * 18 / 100))
  assert.equal(b.pis_base_c, 3333, 'sem exclusão declarada, a base é o valor do item')
  assert.equal(nota.totais.icms_c, a.icms_valor_c + b.icms_valor_c); assert.equal(nota.totais.imposto_c, nota.totais.icms_c + nota.totais.pis_c + nota.totais.cofins_c)
  const f = paraFocus(nota, { data_emissao: 'x' })
  assert.equal(f.items[1].icms_reducao_base_calculo, 33.33); assert.equal(f.items[0].icms_modalidade_base_calculo, 3); assert.equal(f.items[0].icms_valor, 18)
})

await ok('sem regra = bloqueio «regra fiscal faltando» SÓ no item sem regra; regra de outro cliente ou de outro SKU nunca é usada; vigência = a mais recente até a data', () => {
  const outra = { ...regra('GUIA-1'), cliente: 'B' }
  const { nota, bloqueios } = NF.montarNota(pedido(), [regra('PEIT-M'), outra, regra('GUIA-2')], emitente(), CFG)
  assert.deepEqual(bloqueios, [{ codigo: 'regra_fiscal_faltando', sku: 'GUIA-1' }])
  assert.equal(nota.itens[1].ncm, '', 'nada inferido'); assert.equal(nota.itens[1].cfop, ''); assert.equal(nota.itens[0].ncm, '42010000')
  const v = NF.regraVigente([regra('X', { vigente_de: '2026-01-01', ncm: '11111111' }), regra('X', { vigente_de: '2026-06-01', ncm: '22222222' }), regra('X', { vigente_de: '2099-01-01', ncm: '33333333' })], 'A', 'x', 'venda_dentro_uf', '2026-10-15')
  assert.equal(v.ncm, '22222222')
  assert.deepEqual(NF.montarNota(pedido({ itens: [{ ...pedido().itens[0], sku: '' }] }), [regra('PEIT-M')], emitente(), CFG).bloqueios.map(b => b.codigo), ['sku_ausente', 'pagamento_diverge_total'])
})

await ok('o que não se monta com segurança vira bloqueio nominal: ST, CSOSN 101, CST 60, DIFAL, contribuinte, MEI, cupom, frete/pagamento não lidos, CFOP incoerente, termo e certificado', () => {
  const cod = (p, r, e) => NF.montarNota(p, r, e, CFG).bloqueios.map(b => b.codigo)
  assert.ok(cod(pedido(), [regra('PEIT-M', { st: 1 }), regra('GUIA-1')], emitente()).includes('st_nao_suportada'))
  assert.ok(cod(pedido(), [regra('PEIT-M', { cst_csosn: '101' }), regra('GUIA-1')], emitente()).includes('csosn_nao_suportado'))
  assert.ok(cod(pedido(), [regra('PEIT-M', { cst_csosn: '60' }), regra('GUIA-1', { cst_csosn: '40' })], emitente({ regime: 'normal' })).includes('st_nao_suportada'))
  const fora = r => ({ ...r, operacao: 'venda_fora_uf', cfop: '6102' })
  assert.ok(cod(pedido({ comprador: comprador({ uf: 'RJ' }) }), [fora(regra('PEIT-M', { cst_csosn: '40' })), fora(regra('GUIA-1', { cst_csosn: '40' }))], emitente({ regime: 'normal' })).includes('difal_nao_suportado'))
  assert.deepEqual(cod(pedido({ comprador: comprador({ uf: 'RJ' }) }), [fora(regra('PEIT-M')), fora(regra('GUIA-1'))], emitente()), [], 'Simples interestadual: sem DIFAL na nota')
  assert.ok(cod(pedido({ comprador: comprador({ doc: CNPJ_COMPRADOR, ie: '110042490114' }) }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('destinatario_contribuinte'))
  assert.ok(cod(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente({ regime: 'mei' })).includes('mei'))
  assert.ok(cod(pedido({ itens: [{ ...pedido().itens[0], cupom_c: 356 }, pedido().itens[1]] }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('cupom_nao_verificado'))
  assert.ok(cod(pedido({ frete_comprador_c: null }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('frete_nao_lido'))
  assert.ok(cod(pedido({ frete_comprador_c: 1000, pagamentos: [{ tipo: 'bank_transfer', metodo: 'pix', valor_c: 14333 }] }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('frete_cobrado'), 'frete cobrado: decisão do contador')
  assert.ok(cod(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente({ modalidade_frete: null })).includes('modalidade_frete'), 'modalidade não declarada')
  assert.ok(cod(pedido({ pagamentos: null }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('pagamento_nao_lido'))
  assert.ok(cod(pedido({ pagamentos: [{ tipo: 'credit_card', metodo: 'visa', valor_c: 13333, autorizacao: '' }] }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('pagamento'), 'cartão sem autorização')
  assert.deepEqual(cod(pedido({ pagamentos: [{ tipo: 'credit_card', metodo: 'visa', valor_c: 13333, autorizacao: '123456' }] }), [regra('PEIT-M'), regra('GUIA-1')], emitente()), [])
  assert.ok(cod(pedido({ pagamentos: [{ tipo: 'account_money', metodo: 'x', valor_c: 13333 }] }), [regra('PEIT-M'), regra('GUIA-1')], emitente()).includes('pagamento'), 'tipo sem mapeamento verificado')
  assert.ok(cod(pedido(), [regra('PEIT-M', { cfop: '6102' }), regra('GUIA-1')], emitente()).includes('regra_incompleta'), 'CFOP 6xxx em operação interna')
  assert.ok(cod(pedido(), [regra('PEIT-M', { cst_csosn: '00' }), regra('GUIA-1', { cst_csosn: '00' })], emitente({ regime: 'normal' })).includes('regra_incompleta'), 'CST 00 sem alíquota declarada')
  assert.ok(cod(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente({ termo_ok: false })).includes('termo_fiscal'))
  assert.ok(cod(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente({ cert_valido_ate: '2020-01-01' })).includes('certificado'))
  assert.ok(cod(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente()).length === 0)
  assert.ok(NF.montarNota(pedido(), [regra('PEIT-M'), regra('GUIA-1')], emitente(), CFG0).bloqueios.some(b => b.codigo === 'intermediador'), 'config de fábrica: CNPJ do intermediador vazio bloqueia')
})

await ok('CSV do contador: «;» ou «,», decimal com vírgula, erro por linha/campo sem ecoar o valor, cabeçalho fechado', () => {
  const cab = 'sku;operacao;ncm;origem;cfop;cst_csosn;st;icms_aliquota;pis_cst;pis_aliquota;cofins_cst;cofins_aliquota;vigente_de'
  const r = NF.lerCsvRegras(`${cab}\nPEIT-M;venda_dentro_uf;4201.00.00;0;5102;102;0;;49;0;49;0;2026-01-01\nGUIA-1;venda_fora_uf;42010000;0;5102;102;0;18,5;49;0;49;0;2026-13-01\nSEGREDO-XYZ;venda_dentro_uf;123;9;5102;102;0;;49;0;49;0;2026-01-01\nSEM-ST;venda_dentro_uf;42010000;0;5102;102;;;;0;49;0;2026-01-01`, CFG)
  assert.equal(r.regras.length, 1); assert.equal(r.regras[0].sku, 'peit-m'); assert.equal(r.regras[0].ncm, '42010000')
  assert.deepEqual(r.erros.filter(e => e.linha === 3).map(e => e.campo).sort(), ['cfop', 'vigente_de'])
  assert.deepEqual(r.erros.filter(e => e.linha === 4).map(e => e.campo).sort(), ['ncm', 'origem'])
  assert.deepEqual(r.erros.filter(e => e.linha === 5).map(e => e.campo).sort(), ['pis_cst', 'st'], 'ST e CST vazios = erro, nunca presumidos')
  assert.ok(!JSON.stringify(r.erros).includes('SEGREDO') && !JSON.stringify(r.erros).includes('123'), 'sem eco do valor recebido')
  assert.equal(NF.lerCsvRegras('sku,operacao\nx,y', CFG).erros[0].campo, 'cabecalho')
  assert.equal(NF.lerCsvRegras(`${cab},hack`.replace(/;/g, ','), CFG).erros[0].motivo, 'coluna fora da lista')
})

await ok('máscaras, ref sem nome do cliente, automático só após 20 seguidas sem correção, recebíveis por semana com «sem data», sinais nf_pendente/nf_regra_faltando', () => {
  assert.equal(NF.mascararDoc(CPF_COMPRADOR), `***.${CPF_COMPRADOR.slice(3, 6)}.***-**`); assert.ok(!NF.mascararDoc(CNPJ_COMPRADOR).includes(CNPJ_COMPRADOR.slice(2, 8)))
  const ref = NF.refDe('Cliente Secreto', { pack_id: '2000001', order_id: '9' }); assert.match(ref, NF.REF_OK); assert.ok(!/secreto/i.test(ref)); assert.ok(ref.endsWith('-p2000001'))
  const limpas = Array.from({ length: 20 }, (_, i) => ({ estado: 'autorizada', corrigida: 0, autorizada_em: `2026-10-${String(i + 1).padStart(2, '0')}` }))
  assert.equal(NF.automaticoLiberado(limpas).ok, true)
  assert.deepEqual(NF.automaticoLiberado([...limpas.slice(1), { estado: 'autorizada', corrigida: 1, autorizada_em: '2026-10-30' }]), { ok: false, limpas: 0, faltam: 20 })
  assert.equal(NF.automaticoLiberado(limpas.slice(0, 19)).faltam, 1)
  const rc = NF.recebiveisDeNotas([{ estado: 'autorizada', total_c: 1000, order_ids: '1' }, { estado: 'anexada', total_c: 500, order_ids: '2,3' }, { estado: 'cancelada', total_c: 9, order_ids: '4' }, { estado: 'autorizada', total_c: 7, order_ids: '5' }],
    { liberacoes: new Map([['1', '2026-10-21'], ['2', '2026-10-20'], ['3', '2026-10-28']]), hoje: '2026-10-15' })
  assert.deepEqual(rc.semanas, [{ inicio: '2026-10-19', valor_c: 1000, n: 1 }, { inicio: '2026-10-26', valor_c: 500, n: 1 }]); assert.deepEqual(rc.sem_data, { valor_c: 7, n: 1 })
  const s = NF.sinaisNota([{ estado: 'rascunho', pago_em: '2026-10-10', ref: 'r1', bloqueios_json: JSON.stringify([{ codigo: 'regra_fiscal_faltando', sku: 'x' }]) }, { estado: 'autorizada', pago_em: '2026-10-01', ref: 'r2', bloqueios_json: '[]' },
    { estado: 'aprovada', pago_em: '2026-10-15', ref: 'r3', bloqueios_json: '[]' }], '2026-10-15T12:00:00Z')
  assert.deepEqual(s, [{ regra: 'nf_pendente', ref: 'r1', desde: '2026-10-10' }, { regra: 'nf_regra_faltando', sku: 'x', desde: '2026-10-10' }])
})

await ok('billing info (formato legado e com address) → comprador; campo ausente = vazio (a montagem bloqueia), nunca inventado', () => {
  const a = compradorDoBilling({ billing_info: { doc_type: 'CPF', doc_number: CPF_COMPRADOR, additional_info: [{ type: 'FIRST_NAME', value: 'Ana' }, { type: 'LAST_NAME', value: 'Teste' }, { type: 'STREET_NAME', value: 'Rua A' },
    { type: 'STREET_NUMBER', value: '10' }, { type: 'CITY_NAME', value: 'Santos' }, { type: 'STATE_NAME', value: 'São Paulo' }, { type: 'ZIP_CODE', value: '11010-000' }, { type: 'NEIGHBORHOOD', value: 'Centro' }] } })
  assert.deepEqual([a.nome, a.doc, a.uf, a.cep, a.numero], ['Ana Teste', CPF_COMPRADOR, 'SP', '11010000', '10'])
  const b = compradorDoBilling({ buyer: { billing_info: { name: 'Bia', last_name: 'X', identification: { type: 'CPF', number: CPF_COMPRADOR }, address: { street_name: 'R', street_number: 5, city_name: 'Rio', state: { code: 'BR-RJ' }, zip_code: '20000000' } } } })
  assert.equal(b.uf, 'RJ'); assert.equal(b.bairro, '')
  assert.ok(NF.montarNota(pedido({ comprador: b }), [regra('PEIT-M'), regra('GUIA-1')], emitente(), CFG).bloqueios.some(x => x.codigo === 'comprador_incompleto'))
})

// ═══════════════ fluxo no banco + Focus FALSO ═══════════════
const dirXml = mkdtempSync(join(tmpdir(), 'nf-teste-'))
const logs = [], chamadas = []
let respostaEmitir = { status: 202, body: { status: 'processando_autorizacao', ref: '' } }
const CHAVE = '35' + '2610' + CNPJ_A + '55' + '001' + '000000001' + '1' + '12345678' + '9'
const fakeFetch = async (url, init = {}) => {
  chamadas.push({ url, metodo: init.method, auth: init.headers?.Authorization, corpo: init.body ? String(init.body) : '' })
  const u = new URL(url)
  if (u.pathname.startsWith('/arquivos/')) return new Response(`<?xml version="1.0"?><nfeProc><chNFe>${CHAVE}</chNFe></nfeProc>`, { status: 200 })
  if (init.method === 'POST' && u.pathname === '/v2/nfe') return new Response(JSON.stringify(respostaEmitir.body), { status: respostaEmitir.status })
  if (init.method === 'DELETE') return new Response(JSON.stringify({ status: 'cancelado', status_sefaz: '135', mensagem_sefaz: 'Evento registrado' }), { status: 200 })
  if (u.pathname.endsWith('/carta_correcao')) return new Response(JSON.stringify({ status: 'autorizado', status_sefaz: '135', numero_carta_correcao: 1 }), { status: 200 })
  if (init.method === 'PUT' && u.pathname.startsWith('/v2/empresas/')) return new Response(JSON.stringify({ certificado_valido_ate: '2027-09-30T00:00:00-03:00' }), { status: 200 })
  if (init.method === 'GET' && u.pathname.startsWith('/v2/nfe/')) return new Response(JSON.stringify({ status: 'processando_autorizacao' }), { status: 200 })
  return new Response('{}', { status: 404 })
}
const SEGREDO_WH = 'segredo-do-gatilho-de-teste'
const focus = criarFocus({ fetch: fakeFetch, segredoWebhook: () => SEGREDO_WH })
const cfgDb = JSON.parse(JSON.stringify(CFG))
const lidos = { comprador: comprador(), pagamentos: [{ tipo: 'bank_transfer', metodo: 'pix', valor_c: 13333, autorizacao: '' }], frete_comprador_c: 0 }
const anexos = []
const nf = criarNotaFiscal({ handle: db, cfg: cfgDb, emissores: { focus, sefaz: criarSefazNativo() }, termoTexto: TERMO, dirXml, raizDados: '/tmp/ps-data-teste',
  ml: { lerPedido: async () => JSON.parse(JSON.stringify(lidos)), anexar: async (c, a) => { anexos.push(a); return { ok: true, http: 201 } } },
  validarPor: nome => (['Giovanna Torres', 'Lider Um'].includes(String(nome).trim()) ? String(nome).trim() : ''), env: { FOCUS_TOKEN_HOMOLOGACAO: 'tok-homolog-xyz' }, log: (nv, m) => logs.push(`${nv} ${m}`) })
const POR = 'Giovanna Torres', T = `${HOJE}T05:00:00.000Z`
const insLinha = db.prepare(`INSERT INTO meli_pedido_item (cliente, order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, tarifa_c, seller_sku, pack_id, cupom_c, status, coletado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
for (const c of ['A', 'B']) {
  insLinha.run(c, '1', 'MLB1', '', HOJE, 2, 5000, 600, 'PEIT-M', '', null, 'paid', T)
  insLinha.run(c, '1', 'MLB2', '', HOJE, 1, 3333, 400, 'GUIA-1', '', 0, 'paid', T)
}
insLinha.run('A', '2', 'MLB3', '', HOJE, 1, 1000, 100, 'SEM-REGRA', '', null, 'paid', T)
db.prepare("INSERT INTO meli_item (cliente, item_id, titulo) VALUES ('A','MLB1','Peitoral H Rock M')").run()
const dados = { cnpj: CNPJ_A, razao_social: 'Loja A Ltda', ie: '123456789', uf: 'SP', regime: 'simples', vendedor_apelido: 'LOJA_A', cert_ref: 'focus:empresa:77', modalidade_frete: 0, contador: 'Contador Fulano CRC 1SP000000' }
const CSV = 'sku;operacao;ncm;origem;cfop;cst_csosn;st;pis_cst;pis_aliquota;cofins_cst;cofins_aliquota;descricao;vigente_de\nPEIT-M;venda_dentro_uf;42010000;0;5102;102;0;49;0;49;0;Peitoral para cães M;2026-01-01\nGUIA-1;venda_dentro_uf;42010000;0;5102;102;0;49;0;49;0;Guia para cães;2026-01-01'

await ok('configuração: prévia não grava, por inválido 403, produção recusada com a chave desligada, cert_ref só referência (base64/caminho em data/ recusados)', async () => {
  assert.equal(nf.configurar({ cliente: 'A', dados, por: POR }).previa, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM cliente_fiscal').get().n, 0)
  assert.throws(() => nf.configurar({ cliente: 'A', dados, por: 'Intruso', confirmar: true }), e => e.status === 403 && !/Intruso/.test(e.message))
  assert.throws(() => nf.configurar({ cliente: 'A', dados: { ...dados, ambiente: 'producao' }, por: POR, confirmar: true }), e => e.status === 409)
  assert.throws(() => nf.configurar({ cliente: 'A', dados: { ...dados, cert_ref: 'MIIK' + 'A'.repeat(200) }, por: POR, confirmar: true }), /cert_ref/)
  assert.throws(() => nf.configurar({ cliente: 'A', dados: { ...dados, cert_ref: 'arquivo:/tmp/ps-data-teste/nf/certs/a.pfx.enc' }, por: POR, confirmar: true }), /cert_ref/, 'arquivo dentro de data/ recusado')
  assert.throws(() => nf.configurar({ cliente: 'A', dados: { ...dados, token_ref: 'tok-homolog-xyz' }, por: POR, confirmar: true }), /token_ref/, 'o token em si nunca vai ao banco')
  assert.throws(() => nf.configurar({ cliente: 'A', dados: { ...dados, politica: 'automatica' }, por: POR, confirmar: true }), e => e.status === 409, 'automática antes de 20 notas')
  assert.equal(nf.configurar({ cliente: 'A', dados, por: POR, confirmar: true }).ok, true)
  nf.configurar({ cliente: 'B', dados: { ...dados, cnpj: CNPJ_B, razao_social: 'Loja B' }, por: POR, confirmar: true })
})

await ok('rascunhos: 1 nota por pacote/pedido, bloqueios nominais (sem termo, sem certificado validado, sem regra), idempotente na 2ª passada', async () => {
  assert.equal(nf.pendentes('A'), 2)
  const g = await nf.gerarRascunhos('A'); assert.deepEqual([g.criadas, g.bloqueadas], [2, 2])
  assert.equal((await nf.gerarRascunhos('A')).criadas, 0, 'idempotente')
  const [n1] = nf.listar('A').filter(x => x.pedidos.includes('1'))
  assert.deepEqual(n1.bloqueios.map(b => b.codigo).sort(), ['certificado', 'regra_fiscal_faltando', 'regra_fiscal_faltando', 'termo_fiscal'])
  assert.equal(nf.aprovar({ cliente: 'A', refs: [n1.ref], por: POR, confirmar: true }).recusadas[0].motivo, 'bloqueio', 'com bloqueio não aprova')
})

await ok('termo + regras do contador + certificado (chave desligada: pendente) → remontagem limpa a nota do pedido 1; a do SKU sem regra segue bloqueada', async () => {
  assert.equal(nf.aceitarTermo({ cliente: 'A', aceito_por: 'Dono da Loja A', aceito_em: HOJE, por: POR }).previa, true)
  nf.aceitarTermo({ cliente: 'A', aceito_por: 'Dono da Loja A', aceito_em: HOJE, por: POR, confirmar: true })
  const pv = nf.importarRegras({ cliente: 'A', csv: CSV, contador: 'Contador Fulano', por: POR }); assert.equal(pv.previa, true); assert.equal(pv.validas, 2)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM regra_fiscal_produto').get().n, 0)
  nf.importarRegras({ cliente: 'A', csv: CSV, contador: 'Contador Fulano', por: POR, confirmar: true })
  const BASE64 = Buffer.concat([Buffer.from([0x30, 0x82]), Buffer.from('CERTIFICADO-FALSO-'.repeat(20))]).toString('base64'), SENHA = 'senha-super-secreta-123'
  globalThis.__cert = { BASE64, SENHA }
  assert.equal((await nf.certificado({ cliente: 'A', base64: BASE64, senha: SENHA, por: POR, confirmar: true })).pendente, 'nf_desligado')
  assert.equal(nf.estado('A').certificado, 'referenciado_sem_validade')
  cfgDb.nf.ligado = true
  const c = await nf.certificado({ cliente: 'A', base64: BASE64, senha: SENHA, por: POR, confirmar: true }); assert.equal(c.cert_valido_ate, '2027-09-30')
  const put = chamadas.find(x => x.metodo === 'PUT'); assert.match(put.url, /^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/empresas\/77$/)
  const [n1] = nf.listar('A').filter(x => x.pedidos.includes('1')), [n2] = nf.listar('A').filter(x => x.pedidos.includes('2'))
  assert.deepEqual(n1.bloqueios, []); assert.equal(n1.total_c, 13333); assert.equal(n1.estado, 'rascunho')
  assert.deepEqual(n2.bloqueios.map(b => b.codigo), ['regra_fiscal_faltando', 'pagamento_diverge_total'])
})

await ok('aprovação (hash) → emissão em HOMOLOGAÇÃO com Basic token: chave nf.ligado desligada = pendente; 202 = enviada; webhook com assinatura errada 401; certo = autorizada + XML; repetido = idempotente', async () => {
  const [n1] = nf.listar('A').filter(x => x.pedidos.includes('1'))
  assert.equal(nf.aprovar({ cliente: 'A', refs: [n1.ref], por: POR }).previa, true)
  assert.equal(nf.aprovar({ cliente: 'A', refs: [n1.ref], por: POR, confirmar: true }).aprovadas, 1)
  cfgDb.nf.ligado = false
  assert.equal((await nf.emitir({ cliente: 'A', por: POR, confirmar: true })).pendente, 'nf_desligado')
  cfgDb.nf.ligado = true
  const pv = await nf.emitir({ cliente: 'A', por: POR }); assert.equal(pv.previa, true); assert.equal(pv.ambiente, 'homologacao'); assert.equal(pv.notas.length, 1)
  assert.equal(chamadas.filter(x => x.metodo === 'POST').length, 0, 'prévia não chama o provedor')
  respostaEmitir = { status: 202, body: { status: 'processando_autorizacao', ref: n1.ref } }
  const e = await nf.emitir({ cliente: 'A', por: POR, confirmar: true }); assert.equal(e.resultados[0].estado, 'enviada')
  const post = chamadas.find(x => x.metodo === 'POST')
  assert.equal(post.url, `https://homologacao.focusnfe.com.br/v2/nfe?ref=${n1.ref}`); assert.equal(post.auth, 'Basic ' + Buffer.from('tok-homolog-xyz:').toString('base64'))
  assert.equal(JSON.parse(post.corpo).valor_total, 133.33)
  await assert.rejects(nf.webhook('focus', { authorization: 'errado' }, { ref: n1.ref, status: 'autorizado' }), e2 => e2.status === 401)
  const wh = { ref: n1.ref, status: 'autorizado', status_sefaz: '100', mensagem_sefaz: 'Autorizado o uso da NF-e', chave_nfe: 'NFe' + CHAVE, numero: '1', serie: '1', caminho_xml_nota_fiscal: `/arquivos/${CNPJ_A}/202610/XMLs/${CHAVE}-nfe.xml` }
  assert.equal((await nf.webhook('focus', { authorization: SEGREDO_WH }, wh)).estado, 'autorizada')
  const evs = () => db.prepare('SELECT COUNT(*) n FROM nota_evento WHERE ref = ?').get(n1.ref).n, antes = evs()
  assert.equal((await nf.webhook('focus', { authorization: SEGREDO_WH }, wh)).duplicado, true)
  assert.equal((await nf.webhook('focus', { authorization: SEGREDO_WH }, wh)).duplicado, true)
  assert.equal(evs(), antes, 'repetição não grava evento novo (idem da transição)')
  const row = db.prepare('SELECT * FROM nota_fiscal WHERE ref = ?').get(n1.ref)
  assert.equal(row.estado, 'autorizada', 'anexo ao ML desligado: continua autorizada'); assert.equal(row.chave, CHAVE); assert.ok(existsSync(row.xml_arquivo)); assert.ok(row.xml_arquivo.startsWith(dirXml))
  assert.equal(anexos.length, 0, 'nf.envio_ml_ligado = false: nenhuma chamada ao ML')
  assert.equal((await nf.anexarMl({ cliente: 'A', ref: n1.ref })).pendente, 'envio_ml_desligado')
  cfgDb.nf.envio_ml_ligado = true
  assert.equal((await nf.anexarMl({ cliente: 'A', ref: n1.ref })).estado, 'anexada'); assert.equal(anexos.length, 1); assert.ok(anexos[0].xml.includes(CHAVE)); assert.equal(anexos[0].order_id, '1')
  cfgDb.nf.envio_ml_ligado = false
})

await ok('cancelamento (justificativa 15–255, prévia, conta como correção) e carta de correção; nota cancelada não volta', async () => {
  const [n1] = nf.listar('A').filter(x => x.pedidos.includes('1'))
  await assert.rejects(nf.cancelar({ cliente: 'A', ref: n1.ref, justificativa: 'curta', por: POR, confirmar: true }), /15 a 255/)
  assert.equal((await nf.cartaCorrecao({ cliente: 'A', ref: n1.ref, correcao: 'Corrigir complemento do endereço de entrega', por: POR, confirmar: true })).ok, true)
  assert.equal((await nf.cancelar({ cliente: 'A', ref: n1.ref, justificativa: 'Pedido cancelado pelo comprador antes do envio', por: POR })).previa, true)
  assert.equal((await nf.cancelar({ cliente: 'A', ref: n1.ref, justificativa: 'Pedido cancelado pelo comprador antes do envio', por: POR, confirmar: true })).estado, 'cancelada')
  const row = db.prepare('SELECT estado, corrigida FROM nota_fiscal WHERE ref = ?').get(n1.ref); assert.deepEqual({ ...row }, { estado: 'cancelada', corrigida: 1 })
  assert.equal((await nf.webhook('focus', { authorization: SEGREDO_WH }, { ref: n1.ref, status: 'autorizado', chave_nfe: CHAVE })).ignorado, true, 'cancelada não volta a autorizada')
  assert.throws(() => db.prepare('DELETE FROM nota_evento').run(), /append-only/); assert.throws(() => db.prepare("UPDATE nota_evento SET por = 'x'").run(), /append-only/)
})

await ok('rejeição da SEFAZ: estado rejeitada, mensagem sem número de documento, correção só por humano (remontagem volta a rascunho)', async () => {
  db.prepare("UPDATE regra_fiscal_produto SET cfop = '5102' WHERE cliente = 'A'").run()
  nf.importarRegras({ cliente: 'A', csv: CSV.replace('GUIA-1;', 'SEM-REGRA;').replace('Guia para cães', 'Item C'), contador: 'Contador Fulano', por: POR, confirmar: true })
  const [n2] = nf.listar('A').filter(x => x.pedidos.includes('2'))
  db.prepare("UPDATE nota_fiscal SET corpo_json = json_set(corpo_json, '$.entrada.pagamentos[0].valor_c', 1000) WHERE ref = ?").run(n2.ref); nf.remontar('A')
  const n2b = nf.listar('A').find(x => x.ref === n2.ref); assert.deepEqual(n2b.bloqueios, [])
  nf.aprovar({ cliente: 'A', refs: [n2.ref], por: POR, confirmar: true })
  respostaEmitir = { status: 201, body: { status: 'erro_autorizacao', status_sefaz: '539', mensagem_sefaz: `Rejeição: duplicidade CPF ${CPF_COMPRADOR}` } }
  const e = await nf.emitir({ cliente: 'A', refs: [n2.ref], por: POR, confirmar: true }); assert.equal(e.resultados[0].estado, 'rejeitada')
  const ev = db.prepare("SELECT detalhe_json FROM nota_evento WHERE ref = ? AND para = 'rejeitada'").get(n2.ref).detalhe_json
  assert.ok(!ev.includes(CPF_COMPRADOR) && ev.includes('539'))
  nf.importarRegras({ cliente: 'A', csv: CSV.replace('GUIA-1;', 'SEM-REGRA;').replace('Guia para cães', 'Item C corrigido'), contador: 'Contador Fulano', por: POR, confirmar: true })
  assert.equal(db.prepare('SELECT estado FROM nota_fiscal WHERE ref = ?').get(n2.ref).estado, 'rascunho')
})

await ok('isolamento: cliente B não lê, não aprova, não cancela nem consulta nota de A (404); listas e sinais separados; webhook acha só pela ref', async () => {
  const [a] = nf.listar('A')
  assert.ok(!nf.listar('B').some(x => x.ref === a.ref))
  assert.equal(nf.aprovar({ cliente: 'B', refs: [a.ref], por: POR, confirmar: true }).recusadas[0].motivo, 'nao_encontrada')
  await assert.rejects(nf.cancelar({ cliente: 'B', ref: a.ref, justificativa: 'x'.repeat(20), por: POR, confirmar: true }), e => e.status === 404)
  assert.throws(() => nf.eventos('B', a.ref), e => e.status === 404)
  assert.throws(() => nf.eventos('A', "x' OR 1=1 --"), e => e.status === 404)
  await nf.gerarRascunhos('B'); assert.notEqual(nf.listar('B')[0].ref, nf.listar('A').find(x => x.pedidos.includes('1')).ref, 'mesmo pedido em 2 clientes = refs diferentes')
})

await ok('certificado, senha, token e dado do comprador NUNCA no banco (fora do corpo da nota), nos logs, nos eventos ou nas projeções', () => {
  const { BASE64, SENHA } = globalThis.__cert
  const tabelas = ['cliente_fiscal', 'termo_fiscal', 'regra_fiscal_produto', 'nota_fiscal', 'nota_item', 'nota_evento']
  const dump = tabelas.map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n')
  for (const s of [BASE64, BASE64.slice(0, 40), SENHA, 'tok-homolog-xyz', 'CERTIFICADO-FALSO']) { assert.ok(!dump.includes(s), 'segredo no banco'); assert.ok(!logs.join('\n').includes(s), 'segredo no log') }
  const semCorpo = tabelas.map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all().map(r => ({ ...r, corpo_json: undefined })))).join('\n')
  for (const s of [CPF_COMPRADOR, 'Compradora', 'Rua das Flores']) { assert.ok(!semCorpo.includes(s), 'comprador fora do corpo'); assert.ok(!logs.join('\n').includes(s), 'comprador no log') }
  const tela = JSON.stringify([nf.listar('A'), nf.estado('A')]); assert.ok(!tela.includes(CPF_COMPRADOR) && !tela.includes('Compradora') && !tela.includes('tok-homolog')); assert.ok(tela.includes('Ana ·'))
  assert.ok(logs.some(l => /Chaveiro · nota fiscal/.test(l)) && logs.some(l => /Smith · nota fiscal/.test(l)), 'logs dizem o sistema')
})

await ok('rotas: 415 sem JSON, prospect/fora da central 404 sem eco, prévia sem confirmar===true, por inválido 403, webhook público exato com 401 fixo; guarda do túnel', async () => {
  const canon = s => ({ a: 'A', b: 'B' })[String(s).trim().toLowerCase()] || ''
  const app = express(); app.use(criarRotaWebhookNota({ nf })); app.use(express.json()); app.use(criarRotasNotaFiscal({ nf, quem: () => [POR], clienteCanonico: canon }))
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`
  const post = (p, b, ct = 'application/json') => fetch(base + p, { method: 'POST', headers: { 'Content-Type': ct }, body: typeof b === 'string' ? b : JSON.stringify(b) })
  try {
    assert.equal((await post('/api/cliente/nf/aprovar', 'x', 'text/plain')).status, 415)
    const r404 = await post('/api/cliente/nf/aprovar', { cliente: '[Comercial] Zeta', refs: ['x'], por: POR }); assert.equal(r404.status, 404); assert.ok(!(await r404.text()).includes('Zeta'))
    assert.equal((await (await fetch(`${base}/api/cliente/nf?cliente=Fantasma`)).status), 404)
    const pv = await (await post('/api/cliente/nf/config', { cliente: 'a', dados, por: POR, confirmar: 'true' })).json(); assert.equal(pv.previa, true, 'confirmar só com true booleano')
    const r403 = await post('/api/cliente/nf/config', { cliente: 'a', dados, por: 'Mallory', confirmar: true }); assert.equal(r403.status, 403); assert.ok(!(await r403.text()).includes('Mallory'))
    const est = await (await fetch(`${base}/api/cliente/nf?cliente=a`)).json(); assert.equal(est.cliente, 'A'); assert.equal(est.config.token, 'configurado'); assert.ok(!JSON.stringify(est).includes('tok-homolog'))
    const lista = await (await fetch(`${base}/api/cliente/nf/notas?cliente=b`)).json(); assert.ok(lista.notas.every(x => !nf.listar('A').some(y => y.ref === x.ref)))
    assert.equal((await fetch(`${base}/api/cliente/nf/notas?cliente=a&estado=hack`)).status, 400)
    const w = await post('/webhook/nf/focus', { ref: 'psabcdef01-o1', status: 'autorizado' }); assert.equal(w.status, 401); assert.deepEqual(await w.json(), { erro: 'não autorizado' })
    assert.equal((await post('/api/cliente/nf/rascunhos', { cliente: 'a', por: POR })).status, 200)
    assert.equal((await post('/api/cliente/nf/rascunhos', { cliente: 'a', por: 'Mallory', confirmar: true })).status, 403)
  } finally { srv.close() }
  assert.equal(ROTA_PUBLICA.test('/webhook/nf/focus'), true); for (const p of ['/webhook/nf', '/webhook/nf/focus/x', '/api/cliente/nf', '/api/cliente/nf/emitir', '/webhook/nf/sefaz']) assert.equal(ROTA_PUBLICA.test(p), false, p)
})

await ok('emissor nativo SEFAZ: só esqueleto, lança «não implementado»; Focus sem token não chama nada; produção só com a chave dupla', async () => {
  const s = criarSefazNativo(); for (const k of ['emitir', 'consultar', 'cancelar', 'cartaCorrecao', 'baixar', 'webhook', 'cadastrarCertificado']) assert.throws(() => s[k](), e => e.code === 'NAO_IMPLEMENTADO')
  const antes = chamadas.length, r = await focus.emitir({}, { ref: 'x', ambiente: 'homologacao', token: '' }); assert.equal(r.estado, 'erro'); assert.equal(chamadas.length, antes)
  await assert.rejects(focus.baixar('/arquivos/../../etc/passwd.xml', { ambiente: 'homologacao', token: 't' }), e => e.status === 400)
  assert.equal(nf.estado('A').config.ambiente, 'homologacao'); assert.equal(nf.estado('A').chaves.producao_ligada, false)
  const sem = await anexarXmlMl({ fetch: async () => { throw new Error('não pode chamar') }, token: '', pack_id: '1', xml: '<x/>' }); assert.equal(sem.motivo, 'sem_token')
  const grande = await anexarXmlMl({ fetch: async () => { throw new Error('não pode chamar') }, token: 't', pack_id: '1', xml: 'x'.repeat(1048577) }); assert.equal(grande.motivo, 'xml_maior_que_1mb')
  const lidoFalha = await lerPedidosMl(async () => ({ _erro: true, status: 403 }), 'A', ['1']); assert.deepEqual(lidoFalha, { comprador: null, pagamentos: null, frete_comprador_c: null }, 'falha de leitura nunca vira 0')
})

await ok('revisão adversarial: chave de outro emitente no webhook = erro; CPF formatado mascarado; releitura do billing destrava o rascunho; certificado vencido barra a emissão', async () => {
  cfgDb.nf.ligado = true
  // pedido novo do cliente A com billing que falhou na 1ª leitura
  insLinha.run('A', '3', 'MLB1', '', HOJE, 1, 5000, 600, 'PEIT-M', '', null, 'paid', T)
  const salvo = JSON.parse(JSON.stringify(lidos)); lidos.comprador = null
  await nf.gerarRascunhos('A')
  const n3 = () => nf.listar('A').find(x => x.pedidos.includes('3'))
  assert.ok(n3().bloqueios.some(b => b.codigo === 'comprador_billing_info'))
  Object.assign(lidos, salvo, { pagamentos: [{ tipo: 'bank_transfer', metodo: 'pix', valor_c: 5000, autorizacao: '' }] })
  const g = await nf.gerarRascunhos('A'); assert.equal(g.relidas, 1); assert.deepEqual(n3().bloqueios, [], 'releitura destravou')
  nf.aprovar({ cliente: 'A', refs: [n3().ref], por: POR, confirmar: true })
  respostaEmitir = { status: 202, body: { status: 'processando_autorizacao' } }
  await nf.emitir({ cliente: 'A', refs: [n3().ref], por: POR, confirmar: true })
  const outra = '35' + '2610' + CNPJ_B + '55001000000009112345678' + '9'
  const r = await nf.webhook('focus', { authorization: SEGREDO_WH }, { ref: n3().ref, status: 'autorizado', status_sefaz: '100', chave_nfe: outra, caminho_xml_nota_fiscal: '/arquivos/x.xml', mensagem_sefaz: `CPF ${CPF_COMPRADOR.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` })
  assert.equal(r.estado, 'erro', 'chave com CNPJ de outro emitente nunca autoriza a nota deste cliente')
  const ev = JSON.stringify(nf.eventos('A', n3().ref)); assert.ok(!ev.includes(CPF_COMPRADOR.slice(0, 3) + '.' + CPF_COMPRADOR.slice(3, 6)), 'CPF formatado mascarado no evento')
  db.prepare("UPDATE cliente_fiscal SET cert_valido_ate = '2020-01-01' WHERE cliente = 'A'").run()
  assert.equal((await nf.emitir({ cliente: 'A', por: POR, confirmar: true })).pendente, 'certificado')
  db.prepare("UPDATE cliente_fiscal SET cert_valido_ate = '2027-09-30' WHERE cliente = 'A'").run()
})

await ok('chaves de fábrica DESLIGADAS em config/nota-fiscal.json; tick não faz nada desligado', async () => {
  assert.equal(CFG0.nf.ligado, false); assert.equal(CFG0.nf.envio_ml_ligado, false); assert.equal(CFG0.nf.producao_ligada, false); assert.equal(CFG0.nf.automatica_apos_notas_sem_correcao, 20)
  cfgDb.nf.ligado = false; assert.equal((await nf.tick()).pendente, 'nf_desligado')
})

rmSync(dirXml, { recursive: true, force: true })
console.log(`\n${n} casos OK — nota fiscal (F8)`)
