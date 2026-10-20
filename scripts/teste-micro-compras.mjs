// Autoteste do MICRO-RELATÓRIO DE COMPRAS (pedido do David, 15/10/2026): itensMicroCompras + montarMicroCompras (src/lib/plano-semana-texto.js), lote 'compras' no pipeline
// dos gatilhos (src/lib/gatilhos.js) e scripts/micro-compras.mjs (regra das 24 h, envio aprovado). Banco EM MEMÓRIA, fontes stub, relógio falso: sem rede, sem n8n.
// Rodar: node scripts/teste-micro-compras.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { criarGatilhos, lerConfig, validarConfig } from '../src/lib/gatilhos.js'
import { itensMicroCompras, montarMicroCompras, auditarMensagem, janelaInteira } from '../src/lib/plano-semana-texto.js'
import { preverCompras } from '../src/lib/compras-previsao.js'
import { riscoRuptura } from '../src/lib/lead-time.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'
const { avisado24h, criarCompor, enviarItens, lerArgs } = await import('./micro-compras.mjs')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const ALG = JSON.parse(readFileSync(new URL('../config/algoritmo.json', import.meta.url), 'utf8')), L = ALG.limiares, CICLO = ALG.compras.ciclo_compra_dias
const GRUPO = '120363012345678901@g.us', POR = 'Giovanna Torres'
const PERIODO = { de: '2026-09-17', ate: '2026-10-14' }
// R ruptura (A, 4 dias), P abaixo do ponto (B), F pedir até (A, folga dentro do ciclo), S sobra (A, 200 dias), C curva C sem pedido
const itensBase = () => [
  { id: 'MLB1001', titulo: 'Ração Premium Cães Adultos 15kg', curva: 'A', status: 'active', cobertura: 4, estoque: 8, ponto_reposicao: 56, u: 56, r: 5600, preco: 199.9, logistica: 'self_service' },
  { id: 'MLB1002', titulo: 'Coleira Pet Ajustável Nylon', curva: 'B', status: 'active', cobertura: 20, estoque: 40, ponto_reposicao: 56, u: 56, r: 1400, preco: 39.9, logistica: 'fulfillment' },
  { id: 'MLB1003', titulo: 'Areia Sanitária Gatos 4kg', curva: 'A', status: 'active', cobertura: 40, estoque: 80, ponto_reposicao: 56, u: 56, r: 900, preco: 29.9, logistica: 'self_service' },
  { id: 'MLB1004', titulo: 'Shampoo Pet Neutro 500ml', curva: 'A', status: 'active', cobertura: 200, estoque: 400, ponto_reposicao: 56, u: 56, r: 900, preco: 25, logistica: 'self_service' },
  { id: 'MLB1005', titulo: 'Brinquedo Mordedor Corda', curva: 'C', status: 'active', cobertura: 300, estoque: 30, ponto_reposicao: 5, u: 3, r: 60, preco: 19.9, logistica: 'self_service' },
]
const diag = (itens = itensBase(), pedidos = { de: '2026-06-01', lacunas: [] }) => ({ disponivel: true, hoje: '2026-10-15', periodo: PERIODO, data_quality: { cobertura: { pedidos } }, itens })
const compras = d => preverCompras(d, { cfg: ALG })
const micro = (d = diag(), extra = {}) => montarMicroCompras({ rotulo: 'Acme', itens: itensMicroCompras(d, compras(d), { limiares: L, ciclo_dias: CICLO }).itens, folga: L.estoque_seguranca_dias, ...extra })

await ok('itens direto do diagnóstico: ruptura, abaixo do ponto e «pedir até» da previsão de compras; sobra e curva C fora; um por anúncio', () => {
  const r = itensMicroCompras(diag(), compras(diag()), { limiares: L, ciclo_dias: CICLO })
  assert.equal(r.disponivel, true)
  const por = Object.fromEntries(r.itens.map(i => [i.id, i]))
  assert.equal(por.MLB1001.origem, 'ruptura'); assert.equal(por.MLB1002.origem, 'ponto'); assert.equal(por.MLB1003.origem, 'pedir_ate')
  assert.ok(!por.MLB1004 && !por.MLB1005)
  assert.equal(new Set(r.itens.map(i => i.id)).size, r.itens.length)
  // perda = riscoRuptura com a folga de segurança (prazo + folga), conservador–base
  const k = riscoRuptura(itensBase()[0], L, { folga: L.estoque_seguranca_dias })
  assert.deepEqual(por.MLB1001.impacto, { c: Math.round(k.cenarios.conservador), b: Math.round(k.cenarios.base), dias: L.lead_time_reposicao_dias + L.estoque_seguranca_dias })
  assert.equal(por.MLB1003.impacto.b, 0)                                  // estoque cobre prazo + folga: zero calculado, linha sem R$
})

await ok('linha: MLB · título curto · preço de venda · estoque (~dias) → perda em R$ nos próximos N dias; total no topo; premissa, resposta e assinatura', () => {
  const m = micro(), t = m.texto
  assert.match(t, /^Oi, time Acme! Aqui é o \*Merovíngio\*/)
  assert.match(t, /💰 \*Total em jogo:\* R\$ [\d.]+ a R\$ [\d.]+ em vendas nos próximos 28 dias/)
  assert.match(t, /\n• MLB1001 · Ração Premium Cães Adultos 15kg · R\$ 199,90 · estoque 8 un \(~4 dias\) → se não repor: −R\$ [\d.]+ a −R\$ [\d.]+ em vendas nos próximos 28 dias/)
  assert.match(t, /• MLB1002 · .+ · R\$ 39,90 · estoque 40 un no Full \(~20 dias\) → se não repor: −R\$/)
  assert.match(t, /• MLB1003 · .+ → pedir até \d\d\/\d\d para não faltar/)
  assert.ok(t.indexOf('MLB1001') < t.indexOf('MLB1002'))                  // maior perda primeiro
  assert.ok(t.includes('_Estimativa pelo ritmo de vendas dos últimos 28 dias e prazo de reposição de 21 dias + 7 de folga; não é garantia._\nSe o pedido já saiu, responda com a data prevista que ajustamos.\n*Merovíngio · Place Sprints | Equipe Place2u*'))
  assert.ok(t.length <= 2000); assert.deepEqual(m.avisar.map(a => a.id).sort(), ['MLB1001', 'MLB1002', 'MLB1003'])
  assert.ok(!/culpa|você não|vocês não|prejuízo/i.test(t))
})

await ok('sem dado = sem número: janela de 28 dias incompleta → nenhuma linha com R$ e sem total', () => {
  const d = diag(itensBase(), { de: '2026-10-01', lacunas: [] })
  assert.equal(janelaInteira(d), false)
  const m = micro(d)
  assert.ok(m.texto && !/R\$ [\d.]+ a|−R\$|Total em jogo/.test(m.texto.replace(/ · R\$ \d+,\d\d/g, '')))
  assert.equal(m.total, null)
  assert.match(m.texto, /• MLB1001 · .+ → pedir agora para não faltar/)
})

await ok('até 8 linhas + «e mais N», ≤ 2.000 caracteres; sem estoque diz «sem estoque»', () => {
  const muitos = Array.from({ length: 14 }, (_, k) => ({ id: `MLB20${String(k).padStart(2, '0')}`, titulo: `Produto Muito Vendido Modelo ${k} Edição Especial Completa`, curva: 'A', status: 'active', cobertura: k, estoque: k * 2, ponto_reposicao: 56, u: 56, r: 3000 + k, preco: 10 + k, logistica: 'self_service' }))
  const m = micro(diag(muitos))
  assert.equal(m.n, 8); assert.equal(m.resto, 6); assert.match(m.texto, /• e mais 6 produtos, já somados no total/)
  assert.ok(m.texto.length <= 2000)
  assert.match(m.texto, /· sem estoque → se não repor/)
  const curto = micro(diag(muitos), { maxCaracteres: 900 }); assert.ok(curto.texto.length <= 900 && curto.n < 8)
})

await ok('auditor: o texto passa (MLB no começo da linha é o código do anúncio do cliente); MLB solto em outro texto continua barrado; título reprovado sai da lista', () => {
  assert.deepEqual(auditarMensagem(micro().texto, auditarTexto, { permitidos: ['Acme'] }), [])
  const longo = micro(diag(itensBase().map((i, k) => ({ ...i, id: `MLB478916779${k}` })))).texto; assert.match(longo, /• MLB4789167790 · /)
  assert.deepEqual(auditarMensagem(longo, auditarTexto, { permitidos: ['Acme'] }), [])
  assert.ok(auditarMensagem('Veja o anúncio MLB4789167797 hoje', auditarTexto, {}).length > 0)
  const m = micro(diag(), { tituloOk: t => !/Ração/.test(t) }); assert.ok(!m.texto.includes('MLB1001'))
})

await ok('regra das 24 h: mesmos produtos sem piora = pula; produto novo ou piora = sai', () => {
  const agora = Date.parse('2026-10-15T12:00:00Z'), em = '2026-10-15T08:00:00Z', velho = '2026-10-13T08:00:00Z'
  const av = [{ item_id: 'MLB1', snap_json: '{"estoque":8,"cobertura":4}', enviado_em: em }, { item_id: 'MLB2', snap_json: '{"estoque":40,"cobertura":20}', enviado_em: em }]
  assert.equal(avisado24h([{ id: 'MLB1', snap: { estoque: 7, cobertura: 4 } }, { id: 'MLB2', snap: { estoque: 40, cobertura: 20 } }], av, agora), true)
  assert.equal(avisado24h([{ id: 'MLB1', snap: { estoque: 7, cobertura: 4 } }, { id: 'MLB3', snap: { estoque: 1, cobertura: 1 } }], av, agora), false)
  assert.equal(avisado24h([{ id: 'MLB1', snap: { estoque: 0, cobertura: 0 } }], av, agora), false)        // zerou = piora
  assert.equal(avisado24h([{ id: 'MLB1', snap: { estoque: 8, cobertura: 4 } }], av.map(r => ({ ...r, enviado_em: velho })), agora), false)
  assert.deepEqual(lerArgs(['--ignorar-24h']).ignorar24, true); assert.ok(lerArgs(['--enviar']).erro)
})

// ── pipeline dos gatilhos (lote 'compras') em memória ──
function mundo({ clientes = [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['[Comercial] Loja X', 'Ativo']], integracao = () => ({ ok: true, motivo: '' }) } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT '', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  for (const [c, st] of clientes) h.prepare('INSERT INTO clientes_central (cliente, status_cs) VALUES (?,?)').run(c, st)
  const r = { ms: Date.parse('2026-10-15T10:00:00-03:00') }, envios = [], D = new Map()
  const envio = { configurado: () => true, enviar: async ({ lote, notificacao }) => { envios.push({ lote, canais: Object.keys(notificacao.canais).filter(k => notificacao.canais[k].ligado) }); return { estado: 'enviado', motivo: '', recibos: {} } } }
  const cfg = validarConfig(JSON.parse(JSON.stringify(lerConfig())))
  const g = criarGatilhos({ handle: h, fontes: { diagnostico: c => D.get(c) || { disponivel: false } }, agora: () => new Date(r.ms).toISOString(), nomesInternos: () => [POR], cfg, validarPor: v => v === POR ? v : '',
    elegiveis: () => clientes.map(([c, st]) => ({ cliente: c, status: st })), clienteCanonico: nome => clientes.map(([c]) => c).find(c => c === nome) || '', envio, integracao, coletaCompleta: () => true })
  const grupo = (c, w = { ligado: true, destino: GRUPO }) => h.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(JSON.stringify({ canais: { whatsapp: w, email: { ligado: true, destino: 'a@b.com.br' } }, liberado_por: POR }), c)
  const compor = criarCompor({ diagnostico: c => D.get(c) || { disponivel: false, motivo: 'sem dados' }, compras: (c, d) => compras(d), rotulo: c => g.rotulo(c), alg: ALG })
  return { h, r, g, D, envios, grupo, compor, cfg }
}

await ok('piso: total base abaixo de urgente.impacto_min_reais não sai (abaixo_do_piso); sem compor o lote compras é recusado (nada sai pela rota HTTP)', async () => {
  const m = mundo(); m.grupo('Acme')
  m.D.set('Acme', diag([{ id: 'MLB9', titulo: 'Item Pequeno Barato', curva: 'A', status: 'active', cobertura: 25, estoque: 5, ponto_reposicao: 6, u: 6, r: 60, preco: 10, logistica: 'self_service' }]))
  const l = m.g.montarLote('Acme', 'compras', { gravar: false, compor: m.compor })
  assert.equal(l.vazio, true); assert.equal(l.motivo, 'abaixo_do_piso')
  assert.throws(() => m.g.montarLote('Acme', 'compras', { gravar: false }), /scripts\/micro-compras/)
})

await ok('universo/elegibilidade (tipo compras, manual = o portão do envio): prospect fora, canal desligado = sem_canal, sem integração ML = motivo dela; início do urgente', async () => {
  const m = mundo({ integracao: c => c === 'Beta' ? { ok: false, motivo: 'sem_conexao_ml' } : { ok: true } })
  m.grupo('Acme'); m.grupo('Beta')
  assert.deepEqual(m.g.elegivel('Acme', { tipo: 'compras', manual: true }), { ok: true })
  assert.equal(m.g.elegivel('Beta', { tipo: 'compras', manual: true }).motivo, 'sem_conexao_ml')
  assert.throws(() => m.g.elegivel('[Comercial] Loja X', { tipo: 'compras', manual: true }), /não encontrado/)
  m.grupo('Acme', { ligado: false, destino: GRUPO }); m.h.prepare("UPDATE clientes_central SET notificacao_json = json_set(notificacao_json, '$.canais.email.ligado', json('false')) WHERE cliente = 'Acme'").run()
  assert.equal(m.g.elegivel('Acme', { tipo: 'compras', manual: true }).motivo, 'sem_canal')
})

await ok('envio pelo pipeline: lote compras gravado, só WhatsApp, produtos ditos viram gatilho_avisado (estoque), 2º no mesmo dia = teto; nenhuma ação do plano exigida', async () => {
  const m = mundo(); m.grupo('Acme'); m.D.set('Acme', diag())
  const prev = m.g.montarLote('Acme', 'compras', { gravar: false, compor: m.compor })
  assert.ok(prev.texto_final && prev.total.b >= m.cfg.urgente.impacto_min_reais)
  const previa = { data: '2026-10-15', itens: [{ cliente: 'Acme', destino: GRUPO, hash: prev.hash, sha256: (await import('node:crypto')).createHash('sha256').update(prev.texto_final, 'utf8').digest('hex'), texto: prev.texto_final }] }
  const r = await enviarItens({ previa, hoje: '2026-10-15', g: m.g, compor: m.compor, centralDe: c => m.h.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?').get(c), horaOk: () => true, por: POR, esperar: async () => {} })
  assert.equal(r.enviados.length, 1, JSON.stringify(r.pulados))
  assert.deepEqual(m.envios[0].canais, ['whatsapp']); assert.equal(m.envios[0].lote.tipo, 'compras'); assert.equal(m.envios[0].lote.texto, prev.texto_final)
  const lote = m.h.prepare("SELECT * FROM gatilho_lote WHERE cliente = 'Acme' AND tipo = 'compras'").get(); assert.equal(lote.estado, 'enviado'); assert.equal(lote.itens_ids_json, '[]')
  const av = m.h.prepare("SELECT item_id FROM gatilho_avisado WHERE cliente = 'Acme' AND familia = 'estoque' ORDER BY item_id").all().map(x => x.item_id)
  assert.deepEqual(av, ['MLB1001', 'MLB1002', 'MLB1003'])
  const de2 = await enviarItens({ previa, hoje: '2026-10-15', g: m.g, compor: m.compor, centralDe: c => m.h.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?').get(c), horaOk: () => true, por: POR, esperar: async () => {} })
  assert.equal(de2.enviados.length, 0)                                     // já existe / teto do dia: nada sai de novo
  assert.equal(m.envios.length, 1)
  // a regra das 24 h no envio: prévia sem --ignorar-24h com os mesmos produtos já ditos = pula
  assert.equal(avisado24h(m.compor('Acme').avisar, m.h.prepare("SELECT item_id, snap_json, enviado_em FROM gatilho_avisado WHERE cliente = 'Acme'").all(), m.r.ms), true)
})

await ok('envio recusa: prévia de outro dia, hash divergente, canal desligado de propósito e grupo diferente do arquivo', async () => {
  const m = mundo(); m.grupo('Acme'); m.D.set('Acme', diag())
  const prev = m.g.montarLote('Acme', 'compras', { gravar: false, compor: m.compor }), sha = (await import('node:crypto')).createHash('sha256').update(prev.texto_final, 'utf8').digest('hex')
  const base = { cliente: 'Acme', destino: GRUPO, hash: prev.hash, sha256: sha, texto: prev.texto_final }, dep = { g: m.g, compor: m.compor, horaOk: () => true, por: POR, esperar: async () => {} }
  await assert.rejects(enviarItens({ ...dep, previa: { data: '2026-10-14', itens: [base] }, hoje: '2026-10-15', centralDe: () => null }), /vencida/)
  const central = json => () => ({ status: 'Ativo', notificacao_json: json })
  let r = await enviarItens({ ...dep, previa: { data: '2026-10-15', itens: [{ ...base, sha256: 'x' }] }, hoje: '2026-10-15', centralDe: central('{}') }); assert.equal(r.pulados[0].motivo, 'hash_divergente')
  r = await enviarItens({ ...dep, previa: { data: '2026-10-15', itens: [base] }, hoje: '2026-10-15', centralDe: central(JSON.stringify({ canais: { whatsapp: { ligado: false, destino: GRUPO } } })) }); assert.equal(r.pulados[0].motivo, 'canal_desligado')
  r = await enviarItens({ ...dep, previa: { data: '2026-10-15', itens: [base] }, hoje: '2026-10-15', centralDe: central(JSON.stringify({ canais: { whatsapp: { ligado: true, destino: '120363099999999999@g.us' } } })) }); assert.equal(r.pulados[0].motivo, 'destino_divergente')
  assert.equal(m.envios.length, 0)
})

console.log(`\n${n} verificações OK (micro-relatório de compras)`)
