// Autoteste do URGENTE DE ESTOQUE E PREÇO com impacto em R$ (pedido do David, 14/10/2026): src/lib/gatilhos.js (lote 'imediato' só com cfg.urgente.tipos, impacto = previsão
// da regra do plano ou a MESMA fórmula sobre o diagnóstico, 1 mensagem/dia com até 5 pontos, dedupe de 7 dias com piora, silêncio, liberação automática pela regra registrada,
// primeira coleta completa) e src/lib/plano-semana-texto.js (montarUrgente com 💰). Banco EM MEMÓRIA, fontes stub, relógio falso: nada de rede, nada de Mercado Livre, nada de n8n.
// Rodar: node scripts/teste-alerta-impacto.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { criarGatilhos, lerConfig, validarConfig, impactoDaLinha, rotuloPadrao } from '../src/lib/gatilhos.js'
import { riscoRuptura } from '../src/lib/lead-time.js'
import { montarUrgente, faixaImpacto, IMPACTO_PREMISSA, auditarMensagem, montarRelatorioFoco, montarPlanoSemanal, premissaCompras } from '../src/lib/plano-semana-texto.js'
import { preverCompras } from '../src/lib/compras-previsao.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const QUEM = ['Giovanna Torres'], POR = 'Giovanna Torres', GRUPO = '120363012345678901@g.us'
const ALGO = JSON.parse((await import('node:fs')).readFileSync(new URL('../config/algoritmo.json', import.meta.url), 'utf8')), L = ALGO.limiares
// a previsão de compras REAL (pura) sobre o diagnóstico do teste: a quantidade fora do Full é o pedido ao fornecedor (prazo + ciclo + folga), a mesma do relatório focado
const comprasDe = d => preverCompras(d, { cfg: ALGO })
const infoCompras = d => ({ compras: { disponivel: true, ciclo_dias: ALGO.compras.ciclo_compra_dias, seguranca_dias: L.estoque_seguranca_dias, data_comercial: ALGO.compras.data_comercial, itens: comprasDe(d).itens } })
const ligadoCfg = (mexe = () => {}) => { const c = JSON.parse(JSON.stringify(lerConfig())); c.urgente.na_hora_ligado = true; c.urgente.impacto_min_reais = 0; mexe(c); return validarConfig(c) }   // piso em R$ desligado na mecânica; caso próprio abaixo
const PERIODO = { de: '2026-09-16', ate: '2026-10-13' }
// conta com: A ruptura no Full (fórmula), B ruptura fora do Full (previsão do plano), Z campeão que zerou, C hora de pedir, P preço que subiu (cliente), Q preço que baixou
const itensBase = () => [
  { id: 'MLB1', titulo: 'Ração Premium 15kg', curva: 'A', status: 'active', cobertura: 4, estoque: 8, ponto_reposicao: 60, vel_dia: 2, u: 56, r: 2800, r0: 2600, logistica: 'fulfillment', permalink: 'https://produto.mercadolivre.com.br/MLB-1-racao-_JM' },
  { id: 'MLB2', titulo: 'Coleira Pet ajustável', curva: 'A', status: 'active', cobertura: 6, estoque: 12, ponto_reposicao: 60, vel_dia: 2, u: 56, r: 1400, r0: 1400, logistica: 'self_service' },
  { id: 'MLB3', titulo: 'Cama Pet média', curva: 'A', status: 'paused', cobertura: 0, estoque: 0, ponto_reposicao: null, vel_dia: 0.4, u: 12, r: 1200, r0: 2800, logistica: 'self_service' },
  { id: 'MLB4', titulo: 'Areia para gatos 4kg', curva: 'B', status: 'active', cobertura: 20, estoque: 40, ponto_reposicao: 56, vel_dia: 2, u: 56, r: 560, r0: 560, logistica: 'self_service' },
  { id: 'MLB5', titulo: 'Shampoo Pet 500ml', curva: 'A', status: 'active', cobertura: 90, estoque: 180, ponto_reposicao: 56, vel_dia: 2, u: 56, r: 900, r0: 900, logistica: 'self_service' },
  { id: 'MLB6', titulo: 'Brinquedo mordedor', curva: 'A', status: 'active', cobertura: 90, estoque: 180, ponto_reposicao: 56, vel_dia: 2, u: 56, r: 900, r0: 900, logistica: 'self_service' },
]
const diag = (itens = itensBase(), pedidos = { de: '2026-06-01', lacunas: [] }) => ({ disponivel: true, hoje: '2026-10-14', periodo: PERIODO, data_quality: { cobertura: { pedidos } }, itens })
const prevPlano = (c, b) => ({ tipo: 'risco_evitado', horizonte_dias: 28, cenarios: { conservador: { receita: c }, base: { receita: b }, otimista: { receita: b * 1.3 } } })
const acoes = () => [{ id: 'PS-r2', regra: 'anuncio_estoque_ruptura', item_id: 'MLB2', dados: {}, previsao: prevPlano(507.27, 1014.54) }]
const precos = () => [{ item_id: 'MLB5', titulo: 'Shampoo Pet 500ml', dia: '2026-10-13', de: '20.00', para: '26.00', variacao_pct: 30, fonte: 'coleta' }, { item_id: 'MLB6', titulo: 'Brinquedo mordedor', dia: '2026-10-13', de: '30.00', para: '24.00', variacao_pct: -20, fonte: 'coleta' }]
const LIDO = { tarefas: [], execucoes: [], promocoes: [], sync: '2026-12-31', promo_lida: '2026-12-31', leituras: ['2026-10-12', '2026-10-13', '2026-10-16'] }   // carimbos em dia: origem verificável
const saudeAtraso = () => ({ dia: '2026-10-14', do_dia: true, pendente: {}, atrasos: 2, perguntas: { abertas: 0, mais_de_24h: 0 }, reclamacoes: { abertas: 0, mediacoes: 0 }, reputacao: { nivel: '5_green', taxa_claims: 0.1, taxa_atraso: 0.5, taxa_cancel: 0.1, vendas_periodo: 500 }, listas: { atrasos: [{ order_id: '2000000001' }, { order_id: '2000000002' }], claims: [], perguntas: [], full: [] } })

function mundo({ cfg = ligadoCfg(), clientes = [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['[Comercial] Loja X', 'Ativo']], central = null, coleta = () => true, alinhado = null, leitura = null, plano = null } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT '', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  for (const [c, st] of clientes) h.prepare('INSERT INTO clientes_central (cliente, status_cs) VALUES (?,?)').run(c, st)
  const r = { ms: Date.parse('2026-10-14T10:00:00-03:00') }; r.ir = (d, hr) => { r.ms = Date.parse(`${d}T${hr}:00-03:00`) }
  const D = { diag: new Map(), acoes: new Map(), preco: new Map(), saude: new Map() }
  const fontes = { acoes: c => D.acoes.get(c) || [], diagnostico: c => D.diag.get(c) || { disponivel: false, motivo: 'sem dados' }, saude: c => D.saude.get(c) || null,
    sugestaoFull: i => ({ cobertura_planejada: 30, seguranca: 7, cenarios: { conservador: 60, base: 70 } }), mudancasPreco: c => D.preco.get(c) || [], atividadePreco: () => LIDO,
    compras: (c, d) => comprasDe(d), ...(leitura ? { leituraAnuncios: () => leitura } : {}),
    planoSemana: plano || (() => ({ disponivel: true, resumo: { gmv: 12000, pedidos: 150, variacao_pct: 1 }, itens: [], fullParado: [], entregas: [], custosInformados: true })),
    ...(alinhado ? { alinhado: () => alinhado } : {}) }
  const envios = [], envio = { configurado: () => true, enviar: async ({ lote, notificacao }) => { envios.push({ lote, canais: Object.keys(notificacao.canais).filter(k => notificacao.canais[k].ligado) }); return { estado: 'enviado', motivo: '', recibos: {} } } }
  const g = criarGatilhos({ handle: h, fontes, agora: () => new Date(r.ms).toISOString(), nomesInternos: () => QUEM, cfg, validarPor: v => QUEM.includes(v) ? v : '', elegiveis: () => clientes.map(([c, st]) => ({ cliente: c, status: st })),
    clienteCanonico: nome => clientes.map(([c]) => c).find(c => c === nome) || '', envio, integracao: () => ({ ok: true, motivo: '' }), coletaCompleta: coleta, central })
  const m = { h, r, D, g, envios }
  m.tudo = c => { D.diag.set(c, diag()); D.acoes.set(c, acoes()); D.preco.set(c, precos()) }
  // grupo do ML ligado + a marca que SÓ a regra automática grava (como sai do autoLiberar); sem a marca e sem liberado_por o urgente não sai (achado de 14/10)
  m.grupo = (c, w = { ligado: true, destino: GRUPO }, extra = { auto_liberado: { regra: lerConfig().urgente.liberacao_automatica, em: '2026-10-14T06:00:00Z' } }) => h.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(JSON.stringify({ canais: { whatsapp: w }, ...extra }), c)
  m.rows = c => h.prepare('SELECT * FROM gatilho_cliente WHERE cliente = ? ORDER BY id').all(c)
  m.lotes = c => h.prepare("SELECT * FROM gatilho_lote WHERE cliente = ? AND tipo = 'imediato' ORDER BY criado_em").all(c)
  g.chave({ ligado: true, por: POR })
  return m
}
const audita = (t, c = 'Acme') => auditarMensagem(t, auditarTexto, { nomesInternos: QUEM, permitidos: [c] })

await ok('impacto = a fórmula da regra estoque_ruptura sobre o diagnóstico de HOJE (a previsão gravada da ação distribuída é a do dia da decisão: não vale); faixa conservador–base; estoque zerado por semana; compra com a folga do ponto de reposição', async () => {
  const k = riscoRuptura({ cobertura: 4, r: 2800 }, L)
  assert.deepEqual([k.lead, k.dias, k.risco, k.cenarios.conservador], [21, 17, 1700, 850], 'receita/dia × (prazo − cobertura); 50% / 100%')
  assert.equal(riscoRuptura({ cobertura: 20, r: 560 }, L, { folga: L.estoque_seguranca_dias }).dias, 8, 'compra: prazo + segurança − cobertura')
  const m = mundo(); m.tudo('Acme'); m.grupo('Acme'); await m.g.avaliar('Acme')
  const imp = t => impactoDaLinha(JSON.parse(m.rows('Acme').find(x => x.tipo === t).itens_json))
  const rup = JSON.parse(m.rows('Acme').find(x => x.tipo === 'ruptura_curva_a').itens_json)
  assert.deepEqual(rup.find(x => x.id === 'MLB1').impacto, { c: 850, b: 1700, dias: 21, fonte: 'diagnostico' }, 'sem ação no plano: a fórmula da regra')
  // achado de 14/10: a ação PS-r2 tem a previsão de outro dia (R$ 507–1.015); o estoque de hoje (6 dias) dá 1.400/28 × (21 − 6) = R$ 750 — o texto cita o estoque de hoje
  assert.deepEqual(rup.find(x => x.id === 'MLB2').impacto, { c: 375, b: 750, dias: 21, fonte: 'diagnostico' }, 'com ação no plano: a MESMA fórmula sobre o estoque de hoje, nunca a previsão congelada')
  assert.deepEqual(imp('ruptura_curva_a'), { c: 1225, b: 2450, dias: 21, fonte: 'diagnostico' })
  assert.deepEqual(imp('estoque_zerado'), { c: 150, b: 300, dias: 7, fonte: 'diagnostico' }, 'zerado sem ação no plano: receita de 28 dias × fração da regra anuncio_restrito ÷ 4 (por semana)')
  assert.deepEqual(imp('ciclo_estoque_previsto'), { c: 80, b: 160, dias: 28, fonte: 'diagnostico' })
  assert.equal(faixaImpacto({ c: 1225, b: 2450 }), 'cerca de R$ 1.200 a R$ 2.500'); assert.equal(faixaImpacto({ c: 80, b: 160 }), 'cerca de R$ 80 a R$ 160')
})

await ok('mensagem: total no topo, 💰 por ponto, premissa uma vez, Full = «vai faltar no Full», zerado, compra, aumento de preço «ainda cedo»; auditor limpo; sem culpa nem «o que depende de você»', async () => {
  const m = mundo(); m.tudo('Acme'); m.grupo('Acme'); await m.g.avaliar('Acme')
  const l = m.g.montarLote('Acme', 'imediato', { gravar: false }), t = l.texto_final
  assert.deepEqual(l.itens.map(i => i.tipo), ['ruptura_curva_a', 'estoque_zerado', 'ciclo_estoque_previsto', 'preco_alterado_drastico'], 'crítico primeiro, maior impacto primeiro; preço que BAIXOU não entra')
  // o total soma prazos diferentes: o topo diz quais (achado de 14/10)
  assert.match(t, /^Oi, time Acme! Passando rapidinho com pontos importantes da sua conta no Mercado Livre:\n\n💰 No total, \*cerca de R\$ 1\.500 a R\$ 2\.900\* em vendas em jogo nestes pontos \(somando o prazo de cada um: 7, 21 e 28 dias\)\.\n\n\*1\.\* 📦/)
  assert.match(t, /• Ração Premium 15kg: tem 8 un no Full \(~4 dias\) → vai faltar no Full: sugerimos enviar \*60 a 70 un\*/)
  assert.match(t, /💰 \*Impacto estimado:\* cerca de R\$ 1\.200 a R\$ 2\.500 em vendas nos próximos 21 dias se nada for feito\./)
  assert.match(t, /🛑 \*Produto que vendia está sem estoque e fora da busca\*\n• Cama Pet média: sem estoque e pausado; nos últimos 28 dias vendeu \*R\$ 1\.200\* \(12 unidades\)/)
  assert.doesNotMatch(t, /Campeão de venda sem estoque/, 'curva B com 1 unidade não é «campeão» (achado de 14/10)')
  assert.match(t, /💰 \*Impacto estimado:\* cerca de R\$ 150 a R\$ 300 em vendas nos próximos 7 dias se nada for feito\./)
  assert.match(t, /🛒 \*Hora de fazer o pedido ao fornecedor\*\n• Areia para gatos 4kg: tem 40 un \(~20 dias\) → pedir \*\d+( a \d+)? un\*\nQuanto antes o pedido sair/)
  assert.equal(t.split('Prazo usado: 21 dias entre o pedido e a chegada').length, 2, 'a premissa do pedido uma vez, no 📦 (vale para o 🛒)')
  assert.match(t, /O preço de Shampoo Pet 500ml mudou de R\$ 20,00 para R\$ 26,00 \(\+30%\)[\s\S]+💰 \*Impacto:\* ainda cedo para medir/, 'aumento recente sem medição: sem número')
  assert.ok(t.endsWith(`*Merovíngio · Place Sprints | Equipe Place2u*\n${IMPACTO_PREMISSA}`)); assert.equal(t.split(IMPACTO_PREMISSA).length, 2, 'premissa uma vez')
  assert.doesNotMatch(t, /depende de você|culpa|MLB\d|Giovanna/i); assert.deepEqual(audita(t), [])
  assert.deepEqual(l.total, { c: 1455, b: 2910 })
  // 14/10: piso em R$ (urgente.impacto_min_reais) — total base 2.910 sai com piso 2.000 e NÃO sai com piso 3.000 (nada gravado)
  const comPiso = async piso => { const w = mundo({ cfg: ligadoCfg(c => { c.urgente.impacto_min_reais = piso }) }); w.tudo('Acme'); w.grupo('Acme'); await w.g.avaliar('Acme'); return w.g.montarLote('Acme', 'imediato', { gravar: false }) }
  assert.ok((await comPiso(2000)).texto_final, 'piso abaixo do total: sai'); assert.ok(!(await comPiso(3000)).texto_final, 'piso acima do total: não sai')
})

await ok('sem dado suficiente = sem número (janela de 28 dias com dia sem coleta, primeira coleta curta); zerado = receita dos últimos 28 dias por semana (mesmo com ação no plano); um ponto só = sem linha de total', async () => {
  for (const pedidos of [{ de: '2026-06-01', lacunas: ['2026-10-10'] }, { de: '2026-10-01', lacunas: [] }]) {
    const m = mundo(); m.tudo('Acme'); m.D.diag.set('Acme', diag(itensBase(), pedidos)); m.grupo('Acme'); await m.g.avaliar('Acme')
    const t = m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
    assert.doesNotMatch(t, /R\$ \d[\d.]* a R\$|No total/, 'sem número com a janela incompleta'); assert.ok(!t.includes(IMPACTO_PREMISSA))
  }
  // zerado: sempre a fórmula com a receita dos últimos 28 dias (a previsão gravada usa o período ANTERIOR e contradiz o fato do texto); um ponto só = sem linha de total
  const m = mundo(); m.tudo('Acme'); m.D.diag.set('Acme', diag([itensBase()[2]])); m.D.acoes.set('Acme', [{ id: 'PS-z', regra: 'anuncio_anuncio_restrito', item_id: 'MLB3', dados: {}, previsao: prevPlano(1400, 2800) }]); m.grupo('Acme'); await m.g.avaliar('Acme')
  const l = m.g.montarLote('Acme', 'imediato', { gravar: false })
  assert.deepEqual(l.itens.map(i => i.tipo), ['estoque_zerado']); assert.deepEqual(l.itens[0].impacto, { c: 150, b: 300, dias: 7, fonte: 'diagnostico' }, 'R$ 1.200 em 28 dias ÷ 4 × 50% / 100%')
  assert.match(l.texto_final, /Passando rapidinho com um ponto importante/); assert.doesNotMatch(l.texto_final, /No total/)
})

await ok('tipos fora da lista não entram (despacho vencido espera o plano de terça); preço da assessoria/promoção e origem não verificada nunca; alinhamento tira o item', async () => {
  const m = mundo(); m.tudo('Acme'); m.grupo('Acme'); m.D.saude.set('Acme', saudeAtraso()); await m.g.avaliar('Acme')
  assert.equal(m.rows('Acme').find(x => x.tipo === 'envio_atrasado').estado, 'pendente')
  assert.ok(!m.g.montarLote('Acme', 'imediato', { gravar: false }).itens.some(i => i.tipo === 'envio_atrasado'), 'atraso/reclamação/reputação não mudam')
  const m2 = mundo(); m2.tudo('Acme'); m2.grupo('Acme'); m2.D.preco.set('Acme', [{ ...precos()[0], fonte: 'ofertas' }]); await m2.g.avaliar('Acme')
  assert.ok(!m2.g.montarLote('Acme', 'imediato', { gravar: false }).itens.some(i => i.tipo === 'preco_alterado_drastico'), 'mudança do próprio sistema (assessoria) não vira aviso')
  const m3 = mundo({ alinhado: q => ({ sim: q.item === 'MLB3' || q.regra === 'anuncio_restrito' && q.item === 'MLB3' }) }); m3.tudo('Acme'); m3.grupo('Acme'); await m3.g.avaliar('Acme')
  assert.ok(!m3.rows('Acme').some(x => x.tipo === 'estoque_zerado'), 'pausado de propósito (alinhado) não vira aviso')
})

await ok('1 mensagem por cliente por dia, até 5 pontos + «e mais N»; produto avisado não volta em 7 dias, salvo piora (estoque < metade da cobertura avisada, zerou, preço subiu de novo); resolvido sai', async () => {
  const m = mundo({ cfg: ligadoCfg(c => { c.teto.itens_urgente = 2 }) }); m.tudo('Acme'); m.grupo('Acme')
  let t = await m.g.tick(); assert.equal(t.imediatos, 1)
  const l1 = m.lotes('Acme')[0]; assert.equal(JSON.parse(l1.itens_ids_json).length, 2); assert.match(l1.texto_final, /• E mais 2 pontos de estoque e preço, que trazemos no próximo aviso\./)
  m.r.ir('2026-10-14', '15:00'); t = await m.g.tick(); assert.equal(t.imediatos, 0, 'mesmo dia: teto de 1 mensagem')
  m.r.ir('2026-10-15', '10:00'); t = await m.g.tick(); assert.equal(t.imediatos, 1, 'dia seguinte: o resto sai'); assert.deepEqual(m.lotes('Acme').map(l => JSON.parse(l.itens_ids_json).length), [2, 2])
  m.r.ir('2026-10-16', '10:00'); t = await m.g.tick(); assert.equal(t.imediatos, 0, 'nada novo: dedupe')
  // piora: a Coleira (avisada com 6 dias) cai para 2 dias → volta; a Ração (4 → 3 dias) não
  const it = itensBase(); it[1] = { ...it[1], cobertura: 2, estoque: 4 }; it[0] = { ...it[0], cobertura: 3, estoque: 6 }; m.D.diag.set('Acme', diag(it))
  m.r.ir('2026-10-17', '10:00'); await m.g.avaliar('Acme'); assert.equal(m.rows('Acme').find(x => x.tipo === 'ruptura_curva_a').motivo, 'piora')
  t = await m.g.tick(); assert.equal(t.imediatos, 1, 'piora volta antes de 7 dias'); assert.match(m.lotes('Acme').at(-1).texto_final, /Coleira Pet ajustável: tem 4 un/)
  // preço subiu de novo (nova mudança, para maior) → volta; mesma mudança → nunca
  m.D.preco.set('Acme', [...precos(), { item_id: 'MLB5', titulo: 'Shampoo Pet 500ml', dia: '2026-10-17', de: '26.00', para: '32.00', variacao_pct: 23, fonte: 'coleta' }])
  m.r.ir('2026-10-18', '10:00'); t = await m.g.tick(); assert.equal(t.imediatos, 1); assert.match(m.lotes('Acme').at(-1).texto_final, /R\$ 26,00 para R\$ 32,00/)
  // depois de 7 dias com a condição de pé, o estoque volta uma vez (repetição); preço (janela) não
  m.r.ir('2026-10-25', '10:00'); t = await m.g.tick(); assert.equal(t.imediatos, 1); assert.ok(!/O preço de Shampoo/.test(m.lotes('Acme').at(-1).texto_final))
  // resolvido sai: estoque reposto → a linha resolve e não entra
  m.D.diag.set('Acme', diag(itensBase().map(i => ({ ...i, status: 'active', cobertura: 90, estoque: 200 }))))
  await m.g.avaliar('Acme'); assert.ok(m.rows('Acme').filter(x => ['ruptura_curva_a', 'estoque_zerado', 'ciclo_estoque_previsto'].includes(x.tipo)).every(x => x.estado === 'resolvido'))
  m.r.ir('2026-10-26', '10:00'); t = await m.g.tick(); assert.equal(t.imediatos, 0)
})

await ok('silêncio 21:00–07:00: o detectado à noite sai às 07:00+; antes do início do urgente nada; o plano semanal segue com o inicio_envios de 20/10', async () => {
  const m = mundo(); m.tudo('Acme'); m.grupo('Acme')
  m.r.ir('2026-10-14', '22:30'); let t = await m.g.tick(); assert.deepEqual([t.avaliados, t.imediatos], [1, 0])
  m.r.ir('2026-10-15', '06:50'); t = await m.g.tick(); assert.equal(t.imediatos, 0)
  m.r.ir('2026-10-15', '07:00'); t = await m.g.tick(); assert.equal(t.imediatos, 1)
  const m2 = mundo({ cfg: ligadoCfg(c => { c.urgente.inicio_envios = '2026-10-15' }) }); m2.tudo('Acme'); m2.grupo('Acme')
  assert.equal(m2.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'antes_do_inicio'); t = await m2.g.tick(); assert.equal(t.imediatos, 0)
  const cfg = lerConfig(); assert.deepEqual([cfg.urgente.inicio_envios, cfg.inicio_envios], ['2026-10-14', '2026-10-20'])
  assert.equal(m.g.elegivel('Acme').ok, false, 'plano semanal: sem liberado_por e antes de 20/10 continua fora (o semanal não muda)')
})

await ok('liberação automática: integração ML + grupo do ML da central (sem liberado_por); canal desligado de propósito fica fora; prospect nunca; nada antes da primeira coleta completa; só o grupo do ML recebe', async () => {
  const lidos = []
  const central = async c => { lidos.push(c); return c === 'Acme' ? { achado: true, sugestao: { whatsapp: { destino: GRUPO } } } : { achado: true, sugestao: { whatsapp: { destino: '' } } } }
  const m = mundo({ central }); m.tudo('Acme'); m.tudo('Beta'); m.tudo('[Comercial] Loja X')
  assert.equal(m.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'sem_canal', 'antes da regra: sem canal')
  const pre = await m.g.autoLiberar({ gravar: false }); assert.deepEqual([pre.preenchidos, pre.sem_grupo], [['Acme'], ['Beta']]); assert.equal(m.g.notificacao('Acme').canais.whatsapp.destino, '', 'prévia não grava')
  m.r.ir('2026-10-15', '03:30'); let t = await m.g.tick({ origem: 'coleta' }); assert.deepEqual([t.auto.preenchidos, t.imediatos], [['Acme'], 0], 'pós-coleta na madrugada: libera, mas o silêncio segura'); assert.ok(!lidos.includes('[Comercial] Loja X'), 'prospect nunca')
  const n = JSON.parse(m.h.prepare("SELECT notificacao_json j FROM clientes_central WHERE cliente = 'Acme'").get().j)
  assert.deepEqual([n.canais.whatsapp, n.liberado_por, n.auto_liberado.regra], [{ ligado: true, destino: GRUPO }, undefined, lerConfig().urgente.liberacao_automatica])
  m.r.ir('2026-10-15', '07:10'); assert.deepEqual(m.g.elegivel('Acme', { tipo: 'imediato' }), { ok: true }); assert.equal(m.g.elegivel('Acme').motivo, 'nao_liberado', 'o plano semanal continua exigindo o líder')
  t = await m.g.tick(); assert.equal(t.imediatos, 1, 'o timer leva o recém-liberado às 07:00+'); assert.deepEqual(m.envios.at(-1).canais, ['whatsapp'])
  // desligado de propósito: grupo salvo e ligado:false — a regra nunca religa, nada sai
  const m2 = mundo({ central }); m2.tudo('Acme'); m2.grupo('Acme', { ligado: false, destino: GRUPO })
  assert.equal((await m2.g.autoLiberar()).ja_configurados, 1); t = await m2.g.tick({ origem: 'coleta' }); assert.equal(t.imediatos, 0); assert.equal(m2.g.notificacao('Acme').canais.whatsapp.ligado, false)
  // primeira coleta incompleta: nada sai
  const m3 = mundo({ coleta: () => false }); m3.tudo('Acme'); m3.grupo('Acme')
  assert.equal(m3.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'coleta_incompleta'); t = await m3.g.tick(); assert.equal(t.imediatos, 0)
  assert.equal(m3.g.elegivel('Acme', { tipo: 'imediato', manual: true }).motivo, 'coleta_incompleta', 'nem manual')
  // regra vazia no config = só com liberado_por
  const m4 = mundo({ cfg: ligadoCfg(c => { c.urgente.liberacao_automatica = '' }) }); m4.tudo('Acme'); m4.grupo('Acme')
  assert.equal(m4.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'nao_liberado')
})

await ok('config real (14/10/2026): urgente.na_hora_ligado = true e piso de R$ 100 (o David ligou depois da prévia); com uma cópia desligada nada sai na hora; montarUrgente sem impacto = texto de antes', async () => {
  assert.deepEqual([lerConfig().urgente.na_hora_ligado, lerConfig().urgente.impacto_min_reais], [false, 100])   // 23/10/2026: o David bloqueou as comunicações automáticas ao cliente
  const off = JSON.parse(JSON.stringify(lerConfig())); off.urgente.na_hora_ligado = false
  const m = mundo({ cfg: validarConfig(off) }); m.tudo('Acme'); m.grupo('Acme'); const t = await m.g.tick(); assert.deepEqual([t.imediatos, m.envios.length], [0, 0])
  const u = montarUrgente({ rotulo: 'Acme', itens: [{ tipo: 'envio_atrasado', texto: '2 pedidos com prazo de despacho vencido.' }] })
  assert.equal(u.texto.includes('💰'), false); assert.equal(u.total, null)
  const ruim = JSON.parse(JSON.stringify(lerConfig())); ruim.urgente.tipos = ['ads_sem_retorno']; assert.throws(() => validarConfig(ruim), /urgente.tipos/)
})

await ok('script de envio (scripts/alerta-impacto.mjs): só o aprovado, no mesmo dia; sha256, grupo, canal desligado, janela e cabeçalho reconferidos; envia PELO pipeline (enviar imediato com o hash); 409 = pula', async () => {
  const { enviarItens } = await import('./alerta-impacto.mjs')
  const { createHash } = await import('node:crypto'), h256 = t => createHash('sha256').update(t, 'utf8').digest('hex')
  const texto = 'Oi, time Acme! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:\n\nx'
  const item = (extra = {}) => ({ cliente: 'Acme', destino: GRUPO, hash: 'a'.repeat(16), sha256: h256(texto), texto, ...extra })
  const chamadas = [], liberados = [], g = { notificacao: () => ({ rotulo: '', canais: { whatsapp: { destino: GRUPO } } }), rotulo: c => c, autoLiberar: async ({ so }) => { liberados.push(...so); return { preenchidos: so } }, avaliar: async () => {},
    montarLote: () => ({ hash: 'a'.repeat(16) }),
    enviar: async b => { chamadas.push(b); if (b.cliente === 'Muda') throw Object.assign(new Error('x'), { status: 409 }); return { ok: true, estado: 'enviado', lote_id: 'L1' } } }
  const central = { Acme: { status: 'Ativo', notificacao_json: JSON.stringify({ canais: { whatsapp: { ligado: true, destino: GRUPO } } }) }, Off: { status: 'Ativo', notificacao_json: JSON.stringify({ canais: { whatsapp: { ligado: false, destino: GRUPO } } }) },
    Muda: { status: 'Ativo', notificacao_json: JSON.stringify({ canais: { whatsapp: { ligado: true, destino: GRUPO } } }) }, Inativo: { status: 'Desligado', notificacao_json: '{}' } }
  const rodar = (itens, extra = {}) => enviarItens({ previa: { data: '2026-10-14', itens }, hoje: '2026-10-14', g, centralDe: c => central[c] || null, horaOk: () => true, por: POR, esperar: async () => {}, ...extra })
  await assert.rejects(enviarItens({ previa: { data: '2026-10-13', itens: [item()] }, hoje: '2026-10-14', g, centralDe: () => null, horaOk: () => true, por: POR }), /vencida/)
  const r = await rodar([item(), item({ sha256: 'b'.repeat(64) }), item({ cliente: 'Off' }), item({ destino: '120363099999999999@g.us' }), item({ cliente: 'Inativo' }), item({ cliente: '[Comercial] X' }), item({ cliente: 'Muda', texto: texto.replace('Acme', 'Muda'), sha256: h256(texto.replace('Acme', 'Muda')) }), item({ cliente: 'Muda' })])
  assert.deepEqual(r.enviados, [{ cliente: 'Acme', lote_id: 'L1', estado: 'enviado' }])
  assert.deepEqual(r.pulados.map(x => x.motivo), ['hash_divergente', 'canal_desligado', 'destino_divergente', 'status_inelegivel', 'item_invalido', 'hash_divergente', 'cabecalho_divergente'])
  assert.deepEqual(chamadas.map(b => [b.cliente, b.tipo, b.confirmar, b.hash]), [['Acme', 'imediato', true, 'a'.repeat(16)], ['Muda', 'imediato', true, 'a'.repeat(16)]], 'só pelo pipeline, com o hash aprovado')
  assert.deepEqual((await rodar([item()], { horaOk: () => false })).pulados.map(x => x.motivo), ['fora_da_janela'])
  // achado de 14/10: a liberação automática (escrita no banco real) só depois de janela, cabeçalho e hash; envio que não sai desfaz a gravação
  central.Novo = { status: 'Ativo', notificacao_json: '{}' }; const tNovo = texto.replace('Acme', 'Novo'), novo = (extra = {}) => item({ cliente: 'Novo', texto: tNovo, sha256: h256(tNovo), ...extra })
  const desfeitos = [], rodarN = (its, extra = {}) => rodar(its, { desfazer: (c, j) => desfeitos.push([c, j]), ...extra })
  liberados.length = 0
  assert.deepEqual((await rodarN([novo()], { horaOk: () => false })).pulados.map(x => x.motivo), ['fora_da_janela']); assert.deepEqual(liberados, [], 'fora da janela: nada gravado')
  assert.deepEqual((await rodarN([novo({ texto: 'Oi, time Outro!\nx', sha256: h256('Oi, time Outro!\nx') })])).pulados.map(x => x.motivo), ['cabecalho_divergente']); assert.deepEqual(liberados, [], 'cabeçalho divergente: nada gravado')
  assert.deepEqual((await rodarN([novo({ hash: 'b'.repeat(16) })])).pulados.map(x => x.motivo), ['hash_divergente']); assert.deepEqual(liberados, [], 'hash de agora diferente do aprovado (409): nada gravado')
  const gFalha = { ...g, enviar: async () => ({ ok: false, estado: 'falhou', motivo: 'n8n_erro' }) }
  const rf = await rodarN([novo()], { g: gFalha }); assert.deepEqual(rf.pulados.map(x => x.motivo), ['falhou:n8n_erro']); assert.deepEqual([liberados, desfeitos], [['Novo'], [['Novo', '{}']]], 'gravou só antes do envio e desfez porque não saiu')
  liberados.length = 0; desfeitos.length = 0
  assert.deepEqual((await rodarN([novo()])).enviados.map(x => x.cliente), ['Novo']); assert.deepEqual([liberados, desfeitos], [['Novo'], []], 'saiu: a liberação fica')
})

// ── correções da revisão de 14/10 (um teste por achado) ─────────────────────────────────────────────────────────────────────────────────────────────────
const fx = s => s.conservador === s.base ? `${s.base}` : `${s.conservador} a ${s.base}`
const LF = { ...L, min_unidades_item: ALGO.foco.min_unidades_item, min_impacto_pct_gmv: ALGO.foco.min_impacto_pct_gmv }

await ok('quantidade = UMA fonte: fora do Full, o pedido ao fornecedor (preverCompras) no 📦 e no 🛒 do aviso, no relatório focado e no 📦 do plano semanal, com a premissa; no Full, o envio', async () => {
  const d = diag(), cp = comprasDe(d), c2 = cp.itens.find(x => x.id === 'MLB2'), c4 = cp.itens.find(x => x.id === 'MLB4')
  const m = mundo(); m.tudo('Acme'); m.grupo('Acme'); await m.g.avaliar('Acme')
  const t = m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
  const lRupt = `• Coleira Pet ajustável: tem 12 un (~6 dias) → sugerimos repor *${fx(c2.quanto_pedir)} un*`, prem = premissaCompras([c2], infoCompras(d).compras, '2026-10-14').premissa
  assert.ok(t.includes(lRupt), 'ruptura fora do Full = pedido ao fornecedor'); assert.ok(t.includes(prem), 'com a premissa do pedido (prazo + folga + ciclo)')
  assert.ok(t.includes(`• Areia para gatos 4kg: tem 40 un (~20 dias) → pedir *${fx(c4.quanto_pedir)} un*`)); assert.ok(40 + c4.quanto_pedir.conservador > 56, 'o pedido leva o estoque acima do ponto de reposição')
  assert.ok(t.includes('sugerimos enviar *60 a 70 un*'), 'no Full continua o envio (sugestaoFull)'); assert.doesNotMatch(t, /Quantidade para ~37 dias/)
  const itens = d.itens.map(i => ({ ...i, sug: { conservador: 60, base: 70 } }))
  const foco = montarRelatorioFoco({ rotulo: 'Acme', hoje: '2026-10-14', itens, limiares: LF, info: infoCompras(d) }).texto
  const sem = montarPlanoSemanal({ rotulo: 'Acme', hoje: '2026-10-14', resumo: { gmv: 12000, pedidos: 150, variacao_pct: 1 }, itens, limiares: LF, info: infoCompras(d) }).texto
  assert.ok(foco.includes(lRupt.replace('• ', '')), 'o relatório focado diz o MESMO número'); assert.ok(sem.includes(lRupt), 'o 📦 do plano semanal diz o MESMO número'); assert.ok(sem.includes(prem), 'e a premissa')
})

await ok('leitura dos anúncios de outro dia: o aviso diz a data do estoque citado; leitura de hoje, sem frase', async () => {
  const velha = mundo({ leitura: '2026-10-13T07:37:00Z' }); velha.tudo('Acme'); velha.grupo('Acme'); await velha.g.avaliar('Acme')
  const t = velha.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
  assert.match(t, /tem 8 un no Full \(~4 dias\)[\s\S]*Estoque conforme a leitura de 13\/10\./); assert.deepEqual(audita(t), [])
  const hoje = mundo({ leitura: '2026-10-14T07:00:00Z' }); hoje.tudo('Acme'); hoje.grupo('Acme'); await hoje.g.avaliar('Acme')
  assert.doesNotMatch(hoje.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final, /conforme a leitura/)
})

await ok('nomes contra a conta inteira (variações não se confundem); 🛒 uma linha por anúncio; título idêntico a outro anúncio leva o link; premissa e data de leitura uma vez só', async () => {
  const b = { curva: 'A', vel_dia: 2, u: 56, r: 2000, r0: 2000, logistica: 'self_service' }
  const it = [{ ...b, id: 'MLB10', titulo: 'Refil Marcador De Quadro Branco Pilot Cx-12 Cor Azul', status: 'active', cobertura: 6, estoque: 12, ponto_reposicao: 40, permalink: 'https://produto.mercadolivre.com.br/MLB-10-azul-_JM' },
    { ...b, id: 'MLB11', titulo: 'Refil Marcador De Quadro Branco Pilot Cx-12 Cor Verde', status: 'paused', cobertura: 0, estoque: 0, ponto_reposicao: null, permalink: 'https://produto.mercadolivre.com.br/MLB-11-verde-_JM' },
    { ...b, id: 'MLB12', titulo: 'Fantasia Sky Patrulha Canina Macacão Feminino Estampa 6', status: 'active', cobertura: 24, estoque: 48, ponto_reposicao: 56, permalink: 'https://produto.mercadolivre.com.br/MLB-12-e6-_JM' },
    { ...b, id: 'MLB13', titulo: 'Fantasia Sky Patrulha Canina Macacão Feminino Estampa 3', status: 'active', cobertura: 24, estoque: 48, ponto_reposicao: 56, permalink: 'https://produto.mercadolivre.com.br/MLB-13-e3-_JM' },
    { ...b, id: 'MLB14', titulo: 'Kit Pincel Maquiagem 12 Peças', status: 'active', cobertura: 25, estoque: 50, ponto_reposicao: 56, permalink: 'https://produto.mercadolivre.com.br/MLB-14-p-_JM' },
    { ...b, id: 'MLB15', titulo: 'Kit Pincel Maquiagem 12 Peças', status: 'active', cobertura: 90, estoque: 180, ponto_reposicao: 56, permalink: 'https://produto.mercadolivre.com.br/MLB-15-p-_JM' }]
  const m = mundo({ leitura: '2026-10-13T07:37:00Z', cfg: ligadoCfg(c => { c.teto.lista_nomes = 4 }) }); m.D.diag.set('Acme', diag(it)); m.grupo('Acme'); await m.g.avaliar('Acme')
  const t = m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
  assert.match(t, /• Refil Marcador De Quadro Branco Pilot Cx-12 Cor Azul: tem 12 un/); assert.match(t, /• Refil Marcador De Quadro Branco Pilot Cx-12 Cor Verde: sem estoque/)
  assert.match(t, /• Fantasia Sky Patrulha Canina Macacão Feminino Estampa 6: tem 48 un \(~24 dias\) → pedir \*\d+( a \d+)? un\*\n• Fantasia Sky Patrulha Canina Macacão Feminino Estampa 3: tem 48 un/, 'duas linhas, nomes que diferenciam')
  assert.match(t, /• Kit Pincel Maquiagem 12 Peças: tem 50 un \(~25 dias\) → pedir \*\d+( a \d+)? un\*\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-14/, 'título idêntico a outro anúncio: o link diz qual')
  assert.equal(t.split('Prazo usado:').length, 2, 'a premissa do pedido sai uma vez (📦 e 🛒 usam a mesma)'); assert.equal(t.split('Estoque conforme a leitura de 13/10.').length, 2, 'a data da leitura sai uma vez')
  assert.deepEqual(audita(t), [])
})

await ok('o R$ da ruptura declara o prazo usado mesmo sem o 🛒; no Full, que nada é enviado no período', async () => {
  const so = it => { const m = mundo(); m.D.diag.set('Acme', diag(it)); m.grupo('Acme'); return m }
  const m1 = so([itensBase()[0]]); await m1.g.avaliar('Acme'); const t1 = m1.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
  assert.match(t1, /Consideramos 21 dias até a reposição chegar \(se for outro prazo, conta pra gente\)\.\nNo Full, o envio sugerido cobre ~37 dias de venda e a estimativa considera que nada é enviado nesse período\.\n💰 \*Impacto estimado:\*/)
  const m2 = so([itensBase()[1]]); await m2.g.avaliar('Acme'); const t2 = m2.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final
  assert.match(t2, /Prazo usado: 21 dias entre o pedido e a chegada \(premissa: se o seu fornecedor entrega em outro prazo, conta pra gente que ajustamos\) \+ 7 dias de folga\.[^\n]*\n💰 \*Impacto estimado:\* [^\n]* nos próximos 21 dias/)
  assert.doesNotMatch(t2, /🛒/); assert.deepEqual(audita(t1), []); assert.deepEqual(audita(t2), [])
})

await ok('saudação sem rótulo cadastrado: o nome da central sem a razão social; rótulo cadastrado vence', async () => {
  assert.deepEqual(['Prisma Indústria e Comércio LTDA', 'Moema Comercio', 'Click Beauty Cosmeticos', 'Minas Geral Comercial', 'Damar Comercial', 'Rotec', 'Cronometal - Lucas de Souza', 'Comercial'].map(rotuloPadrao),
    ['Prisma', 'Moema', 'Click Beauty', 'Minas Geral', 'Damar', 'Rotec', 'Cronometal - Lucas de Souza', 'Comercial'])
  const P = 'Prisma Indústria e Comércio LTDA', m = mundo({ clientes: [[P, 'Ativo']] }); m.tudo(P); m.grupo(P); await m.g.avaliar(P)
  const t = m.g.montarLote(P, 'imediato', { gravar: false }).texto_final; assert.match(t, /^Oi, time Prisma! /); assert.deepEqual(audita(t, P), [])
  m.grupo(P, undefined, { auto_liberado: { regra: 'x' }, rotulo: 'Prisma 3D' }); assert.equal(m.g.rotulo(P), 'Prisma 3D')
})

await ok('«Revogar» e a troca do grupo param o urgente da regra automática (e a regra nunca religa); mudar outra coisa mantém', async () => {
  const OUTRO = '120363099999999999@g.us', central = async () => ({ achado: true, sugestao: { whatsapp: { destino: GRUPO } } })
  const m = mundo({ central }); m.tudo('Acme'); m.grupo('Acme'); assert.deepEqual(m.g.elegivel('Acme', { tipo: 'imediato' }), { ok: true })
  m.g.liberar({ clientes: ['Acme'], liberar: false, por: POR })
  assert.equal(m.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'nao_liberado'); assert.equal((await m.g.tick()).imediatos, 0, 'revogado: nada sai')
  m.h.prepare("UPDATE clientes_central SET notificacao_json = json_set(notificacao_json, '$.canais.whatsapp.destino', '') WHERE cliente = 'Acme'").run()
  assert.deepEqual((await m.g.autoLiberar({ so: ['Acme'] })).preenchidos, [], 'grupo apagado depois de revogar: a regra não religa')
  const m2 = mundo(); m2.tudo('Acme'); m2.grupo('Acme', undefined, { liberado_por: POR, auto_liberado: { regra: 'x' } })
  m2.g.liberar({ clientes: ['Acme'], liberar: false, por: POR }); assert.equal(m2.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'nao_liberado', 'liberado pelo líder e revogado: para também')
  const m3 = mundo(); m3.tudo('Acme'); m3.grupo('Acme')
  m3.g.configurar({ cliente: 'Acme', por: POR, notificacao: { canais: { whatsapp: { ligado: true, destino: GRUPO } }, rotulo: 'Acme Pet' } })
  assert.deepEqual(m3.g.elegivel('Acme', { tipo: 'imediato' }), { ok: true }, 'mesmo grupo (mudou só o rótulo): a liberação automática fica')
  m3.g.configurar({ cliente: 'Acme', por: POR, notificacao: { canais: { whatsapp: { ligado: true, destino: OUTRO } } } })
  assert.equal(m3.g.elegivel('Acme', { tipo: 'imediato' }).motivo, 'nao_liberado', 'grupo trocado: ninguém liberou o grupo novo'); assert.equal((await m3.g.tick()).imediatos, 0)
})

await ok('dedupe POR PRODUTO: produto novo na linha não traz o já avisado; piora de um não traz o outro', async () => {
  const beb = { id: 'MLB7', titulo: 'Bebedouro automático pet', curva: 'A', status: 'active', cobertura: 5, estoque: 10, ponto_reposicao: 60, vel_dia: 2, u: 56, r: 1400, r0: 1400, logistica: 'self_service' }
  const m = mundo(); m.grupo('Acme'); m.D.diag.set('Acme', diag(itensBase().slice(0, 2)))
  m.r.ir('2026-10-15', '10:00'); assert.equal((await m.g.tick()).imediatos, 1); assert.match(m.lotes('Acme').at(-1).texto_final, /Ração Premium 15kg[\s\S]*Coleira Pet ajustável/)
  m.D.diag.set('Acme', diag([...itensBase().slice(0, 2), beb])); m.r.ir('2026-10-16', '10:30'); assert.equal((await m.g.tick()).imediatos, 1)
  let t = m.lotes('Acme').at(-1).texto_final; assert.match(t, /Bebedouro automático pet: tem 10 un/); assert.doesNotMatch(t, /Ração Premium|Coleira Pet/, 'o produto novo não traz os já avisados')
  assert.match(t, /cerca de R\$ 400 a R\$ 800 em vendas nos próximos 21 dias/, 'o R$ é só do que a mensagem diz (Bebedouro: 1.400/28 × 16)')
  const it = [{ ...itensBase()[0], cobertura: 3, estoque: 6 }, { ...itensBase()[1], cobertura: 2, estoque: 4 }, beb]; m.D.diag.set('Acme', diag(it))
  m.r.ir('2026-10-17', '10:00'); assert.equal((await m.g.tick()).imediatos, 1)
  t = m.lotes('Acme').at(-1).texto_final; assert.match(t, /Coleira Pet ajustável: tem 4 un/); assert.doesNotMatch(t, /Ração Premium|Bebedouro/, 'só quem piorou volta (Ração 4 → 3 dias não é piora)')
  m.r.ir('2026-10-18', '10:00'); assert.equal((await m.g.tick()).imediatos, 0, 'nada novo')
})

await ok('terça: quem recebe o plano não recebe o urgente no mesmo dia; o que saiu no urgente da véspera volta no ⏸️ do plano como lembrete; nada se repete na quarta', async () => {
  let itensHoje = diag().itens
  const plano = () => ({ disponivel: true, resumo: { gmv: 12000, pedidos: 150, variacao_pct: 1 }, itens: itensHoje.map(i => ({ ...i, sug: { conservador: 60, base: 70 } })), fullParado: [], entregas: [], custosInformados: true })
  const m = mundo({ plano }); m.tudo('Acme'); m.grupo('Acme', undefined, { liberado_por: POR })
  m.r.ir('2026-10-19', '10:00'); assert.equal((await m.g.tick()).imediatos, 1, 'segunda (antes do 1º plano): o urgente sai')
  assert.match(m.lotes('Acme').at(-1).texto_final, /Cama Pet média: sem estoque e pausado/)
  // terça de madrugada um campeão novo entra em ruptura (em cooldown: o urgente de ontem foi às 10:00) e outro chega à hora de pedir (sem cooldown): os dois vão no plano
  // das 09:00 (📦 e 🔄), nunca num urgente das 07:00; e na quarta nenhum dos dois volta (o plano já disse)
  itensHoje = [...diag().itens, { id: 'MLB7', titulo: 'Bebedouro automático pet', curva: 'A', status: 'active', cobertura: 5, estoque: 10, ponto_reposicao: 60, vel_dia: 2, u: 56, r: 1400, r0: 1400, logistica: 'self_service' },
    { id: 'MLB8', titulo: 'Petisco natural para cães', curva: 'A', status: 'active', cobertura: 20, estoque: 40, ponto_reposicao: 56, vel_dia: 2, u: 56, r: 3000, r0: 3000, logistica: 'self_service' }]
  m.D.diag.set('Acme', diag(itensHoje))
  m.r.ir('2026-10-20', '07:10'); let t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 0], 'terça 07:10: nem urgente nem plano (o Bebedouro espera o plano)')
  m.r.ir('2026-10-20', '09:10'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 1], 'terça 09:10: só o plano')
  const pl = m.h.prepare("SELECT texto_final FROM gatilho_lote WHERE cliente = 'Acme' AND tipo = 'semanal'").get().texto_final
  assert.match(pl, /📦[\s\S]*Bebedouro automático pet: tem 10 un/, 'a ruptura nova vai no 📦 do plano'); assert.match(pl, /🔄[\s\S]*Petisco natural para cães/, 'a hora de pedir nova vai no 🔄 do plano')
  assert.match(pl, /⏸️ \*Lembrete: anúncio que vendia está fora do ar\*[\s\S]*Cama Pet média/, 'o zerado avisado na véspera entra como lembrete')
  m.r.ir('2026-10-20', '15:00'); assert.equal((await m.g.tick()).imediatos, 0, 'terça à tarde: continua só o plano')
  m.r.ir('2026-10-21', '10:00'); assert.equal((await m.g.tick()).imediatos, 0, 'quarta: nada do que o plano e o urgente disseram volta sem piora')
})

await ok('lista do que saiu: produtos distintos no 📦 do relatório focado (não linhas) + soma dos «e mais N»', async () => {
  const { produtosEstoque } = await import('./alerta-impacto.mjs')
  const u = id => `  https://produto.mercadolivre.com.br/MLB-${id}-x-_JM`
  const texto = ['Oie', '', '*Estoque · Acme · 14/10*', '', '📦 *Estoque e ruptura*', 'Campeões de venda perto de acabar:', '• Kit A (Full): tem 4 un (~2 dias) → sugerimos enviar *75 a 90 un*', u(100),
    'Já fora do ar por falta de estoque:', '• Produto B: sem estoque e pausado; nos últimos 28 dias vendeu *R$ 612* (3 unidades)', u(200), '• Produto C: sem estoque e pausado; nos últimos 28 dias vendeu *R$ 344* (1 unidade)', u(300), '• e mais 5 anúncios',
    'Próximos pedidos ao fornecedor:', '• Produto B: pedir *agora* · *7 un* (tem 0 un; ficou sem estoque, usamos o ritmo de antes da falta)', u(200), '• Produto C: pedir *agora* · *3 un* (tem 0 un)',
    '• Variação: pedir *agora* · *3 un* (tem 1 un)', u(400), '• Variação: pedir *agora* · *2 un* (tem 1 un)', u(500), '• e mais 13 produtos', 'Prazo usado: 21 dias.', '', '⏳ *Resultados em medição*', '• Outro: tem 3 un'].join('\n')
  assert.deepEqual(produtosEstoque(texto), { nomeados: 5, e_mais: 18 }, 'Kit A, B, C e 2 «Variação» (MLB diferentes); B e C repetidos contam uma vez; fora do 📦 não conta')
  assert.deepEqual(produtosEstoque('sem bloco'), { nomeados: 0, e_mais: 0 })
})

console.log(`\n${n} verificações do aviso de estoque e preço ok.`)
