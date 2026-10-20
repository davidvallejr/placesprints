// Autoteste do filtro avançado (?f=) nas rotas de Distribuição, Analistas, Comercial e Resultados (src/rotas-planos.js).
// Parte pura (sem banco): aplicarFiltroAcoes, alcance (condições fora do alcance saem e viram aviso), arvoreListas, etapaProspecto.
// Parte HTTP: as rotas reais numa porta efêmera de loopback, só GET, lendo o banco local como está (nunca copia data/db.sqlite):
// sem ?f= a resposta é a de antes; ?f= de outro painel → 400 sem ecoar o valor; CSV respeita o filtro; avisos honestos onde o filtro não alcança.
// Rodar: node scripts/teste-filtros-rotas.mjs
import assert from 'node:assert/strict'
import express from 'express'
import { serializar, validar } from '../src/lib/filtros.js'
import { rotasPlanos, aplicarFiltroAcoes, aplicarFiltro, alcance, arvoreListas, etapaProspecto } from '../src/rotas-planos.js'
import { db } from '../src/lib/db.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-07'
const F = (painel, arvore, periodo) => validar({ painel, arvore, periodo }, { hoje: HOJE })
const URL_F = (painel, arvore, periodo) => serializar(F(painel, arvore, periodo))

// ── ações sintéticas (o que lerAcoes devolve hidratado) ─────────────────────
const acao = (o) => ({ id: o.id, cliente: 'Cliente A', canal: 'Mercado Livre', responsavel: 'Giovanna', regra: 'anuncio_estoque_ruptura', status: 'proposta', horizonte: '72h', score: 80, titulo: 'Repor estoque', delegado_a: '', prazo: '2026-10-09', criado_em: '2026-10-06T10:00:00.000Z', dados: {}, ...o })
const ACOES = [
  acao({ id: 'a1' }),
  acao({ id: 'a2', cliente: 'Cliente B', responsavel: 'Manoel', regra: 'anuncio_titulo_fraco', score: 40, prazo: '2026-10-20', criado_em: '2026-09-15T12:00:00.000Z', delegado_a: 'Ana' }),
  acao({ id: 'a3', cliente: 'Cliente B', canal: 'Shopee', regra: 'sem_plano_mes', status: 'distribuida', horizonte: '30d', score: 12, prazo: '2026-11-05', criado_em: '2026-08-01T12:00:00.000Z' }),
]
const ids = xs => xs.map(a => a.id)

await ok('ações: sem filtro devolve a MESMA lista (referência igual, nada reordenado)', () => {
  assert.equal(aplicarFiltroAcoes(ACOES, null), ACOES)
})
await ok('ações: cliente / regra (contém) / prioridade (= score) / consultor (= responsável) / delegado_a vazio', () => {
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'cliente', operador: 'igual', valor: 'cliente b' }))), ['a2', 'a3'], 'acento/caixa não importam')
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'regra', operador: 'contem', valor: 'anuncio_' }))), ['a1', 'a2'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'prioridade', operador: 'maior', valor: 50 }))), ['a1'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'prioridade', operador: 'entre', valor: [12, 40] }))), ['a2', 'a3'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'consultor', operador: 'igual', valor: 'Manoel' }))), ['a2'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'delegado_a', operador: 'vazio' }))), ['a1', 'a3'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { op: 'OU', itens: [{ campo: 'canal', operador: 'igual', valor: 'Shopee' }, { campo: 'status', operador: 'em', valor: ['distribuida', 'aprovada'] }] }))), ['a3'])
})
await ok('ações: período pelo prazo (padrão) ou pela criação; intervalo fechado; combinado com condição', () => {
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', null, { preset: 'personalizado', de: '2026-10-09', ate: '2026-10-20' }))), ['a1', 'a2'], 'prazo é a data padrão')
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', null, { campo: 'criado_em', preset: 'personalizado', de: '2026-08-01', ate: '2026-09-30' }))), ['a2', 'a3'])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', { campo: 'cliente', operador: 'igual', valor: 'Cliente B' }, { campo: 'criado_em', preset: 'este_mes' }))), [])
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', null, { preset: 'este_mes' }))), [], 'este mês = 01/10–07/10 pelo prazo: nenhum prazo cai aí')
  assert.deepEqual(ids(aplicarFiltroAcoes(ACOES, F('distribuicao', null, { campo: 'criado_em', preset: 'este_mes' }))), ['a1'], 'pela criação, a1 (06/10) entra')
})
await ok('alcance: condições de campos que a visão não tem SAEM da árvore e são listadas (nunca zeram a lista em silêncio)', () => {
  const f = F('analistas', { op: 'E', itens: [{ campo: 'analista', operador: 'contem', valor: 'Vit' }, { op: 'OU', itens: [{ campo: 'cliente', operador: 'igual', valor: 'X' }, { campo: 'status', operador: 'igual', valor: 'bloqueada' }] }] })
  const { f: f2, fora } = alcance(f, ['analista'])
  assert.deepEqual(fora, ['cliente', 'status'])
  assert.deepEqual(f2.arvore, { op: 'E', itens: [{ campo: 'analista', operador: 'contem', valor: 'Vit' }] })
  assert.equal(alcance(f, []).f.arvore, null)
  assert.deepEqual(aplicarFiltro([{ nome: 'Vitória' }, { nome: 'Ana' }], f2, a => a.nome), [{ nome: 'Vitória' }])
  assert.equal(aplicarFiltro([{ nome: 'Ana' }], alcance(f, []).f, a => a.nome).length, 1, 'árvore vazia = tudo passa')
})
await ok('arvoreListas: "é igual a" vira "contém" e "é um de" vira OU de "contém" nos campos de lista; os outros campos não mudam', () => {
  const f = F('analistas', { op: 'E', itens: [{ campo: 'analista', operador: 'em', valor: ['Ana', 'Bia'] }, { campo: 'analista', operador: 'igual', valor: 'Caio' }, { campo: 'cliente', operador: 'igual', valor: 'X' }] })
  const t = arvoreListas(f, ['analista']).arvore
  assert.deepEqual(t.itens[0], { op: 'OU', itens: [{ campo: 'analista', operador: 'contem', valor: 'Ana' }, { campo: 'analista', operador: 'contem', valor: 'Bia' }] })
  assert.equal(t.itens[1].operador, 'contem'); assert.equal(t.itens[2].operador, 'igual')
  const linhas = [{ cliente: 'X', analistas: ['Ana Lima', 'Caio Souza'] }, { cliente: 'X', analistas: ['Caio Souza'] }, { cliente: 'X', analistas: [] }]
  const ac = (c, campo) => campo === 'analista' ? c.analistas.join(', ') : c.cliente
  assert.equal(aplicarFiltro(linhas, arvoreListas(f, ['analista']), ac).length, 1)
  assert.equal(aplicarFiltro(linhas, arvoreListas(F('analistas', { campo: 'analista', operador: 'igual', valor: 'Caio' }), ['analista']), ac).length, 2)
  assert.equal(arvoreListas(F('analistas'), ['analista']).arvore, null)
})
await ok('etapaProspecto: pediu contato > pronto > conectado > erro > aguardando', () => {
  assert.equal(etapaProspecto({ quer_contato_em: '2026-10-01', conectado: true, dados_lidos: true }), 'pediu_contato')
  assert.equal(etapaProspecto({ conectado: true, dados_lidos: true }), 'pronto')
  assert.equal(etapaProspecto({ conectado: true, dados_lidos: false }), 'conectado')
  assert.equal(etapaProspecto({ conectado: false, conexao_erro: 'token' }), 'erro')
  assert.equal(etapaProspecto({ conectado: false }), 'aguardando')
})

// ── rotas reais, só GET, banco local como está ──────────────────────────────
const app = express(); app.use(rotasPlanos)
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const base = `http://127.0.0.1:${srv.address().port}`
const get = async (caminho) => { const r = await fetch(base + caminho); const t = await r.text(); let json = null; try { json = JSON.parse(t) } catch { /* CSV */ } return { status: r.status, json, texto: t } }
const q = s => encodeURIComponent(s)
const outroPainel = URL_F('execucao', { campo: 'cliente', operador: 'igual', valor: 'SEGREDO_NAO_ECOAR' })

try {
  await ok('todas as rotas: ?f= de outro painel → 400 JSON com "erro", sem ecoar o valor recebido', async () => {
    for (const rota of ['/api/planos/acoes', '/api/planos/acoes.csv', '/api/planos/clientes', '/api/planos/insights', '/api/analistas/visao', '/api/analistas/clientes-atrasados', '/api/analistas/tipos', '/api/comercial/prospectos', '/api/resultados/padroes']) {
      const r = await get(`${rota}?f=${q(outroPainel)}`)
      assert.equal(r.status, 400, rota); assert.match(r.json.erro, /outro painel/, rota); assert.doesNotMatch(r.texto, /SEGREDO/, rota)
    }
    const r = await get('/api/planos/acoes?f=%%%nao-e-base64url')
    assert.equal(r.status, 400); assert.match(r.json.erro, /ilegível/)
  })

  const sem = await get('/api/planos/acoes')
  await ok('distribuição: sem ?f= é o array de sempre; com ?f= vem { acoes, filtro: { chips, periodo } } e cliente/regra/prioridade recortam', async () => {
    assert.equal(sem.status, 200); assert.ok(Array.isArray(sem.json))
    const tudo = await get(`/api/planos/acoes?f=${q(URL_F('distribuicao'))}`)
    assert.deepEqual(tudo.json.acoes, sem.json, 'filtro vazio = mesma lista, mesma ordem'); assert.deepEqual(tudo.json.filtro, { chips: [], periodo: null })
    if (!sem.json.length) return console.log('  (banco sem ações: recorte por cliente/regra/prioridade coberto só na parte pura)')
    const alvo = sem.json[0]
    const porCliente = await get(`/api/planos/acoes?f=${q(URL_F('distribuicao', { campo: 'cliente', operador: 'igual', valor: alvo.cliente }))}`)
    assert.ok(porCliente.json.acoes.length >= 1 && porCliente.json.acoes.every(a => a.cliente === alvo.cliente))
    assert.deepEqual(porCliente.json.acoes, sem.json.filter(a => a.cliente === alvo.cliente), 'é exatamente o recorte da lista de antes, na mesma ordem')
    assert.equal(porCliente.json.filtro.chips[0].texto, `Cliente é igual a ${alvo.cliente}`)
    const porRegra = await get(`/api/planos/acoes?f=${q(URL_F('distribuicao', { campo: 'regra', operador: 'igual', valor: alvo.regra }))}`)
    assert.ok(porRegra.json.acoes.every(a => a.regra === alvo.regra))
    const minimo = Math.min(...sem.json.map(a => a.score)), maximo = Math.max(...sem.json.map(a => a.score))
    const porPrio = await get(`/api/planos/acoes?f=${q(URL_F('distribuicao', { campo: 'prioridade', operador: 'maior', valor: minimo }))}`)
    assert.deepEqual(porPrio.json.acoes, sem.json.filter(a => a.score > minimo))
    const periodo = await get(`/api/planos/acoes?f=${q(URL_F('distribuicao', null, { preset: 'personalizado', de: alvo.prazo, ate: alvo.prazo }))}`)
    assert.ok(periodo.json.acoes.length >= 1 && periodo.json.acoes.every(a => a.prazo === alvo.prazo)); assert.equal(periodo.json.filtro.periodo.de, alvo.prazo)
    assert.equal((await get(`/api/planos/acoes?f=${q(URL_F('distribuicao', { campo: 'prioridade', operador: 'maior', valor: maximo }))}`)).json.acoes.length, 0)
  })
  await ok('distribuição: o CSV respeita o filtro (só o cliente filtrado nas linhas) e sem filtro continua inteiro', async () => {
    const csv = await get('/api/planos/acoes.csv')
    assert.equal(csv.status, 200); assert.match(csv.texto.slice(0, 40), /^﻿?"ID";"Cliente";/)   // fetch().text() descarta o BOM
    const linhas = t => t.split('\r\n').slice(1).filter(Boolean).map(l => l.split('";"')[1])
    assert.equal(linhas(csv.texto).length, sem.json.length)
    if (!sem.json.length) return
    const alvo = sem.json[0].cliente
    const filtrado = await get(`/api/planos/acoes.csv?f=${q(URL_F('distribuicao', { campo: 'cliente', operador: 'igual', valor: alvo }))}`)
    const cl = linhas(filtrado.texto)
    assert.ok(cl.length >= 1 && cl.length < linhas(csv.texto).length + 1 && cl.every(c => c === alvo))
    assert.equal(cl.length, sem.json.filter(a => a.cliente === alvo).length)
  })
  await ok('distribuição: /api/planos/clientes mantém a lista de clientes do escopo e as contagens seguem as ações filtradas', async () => {
    const semF = await get('/api/planos/clientes'); assert.ok(Array.isArray(semF.json))
    if (!sem.json.length) return
    const alvo = sem.json[0].cliente
    const comF = await get(`/api/planos/clientes?f=${q(URL_F('distribuicao', { campo: 'cliente', operador: 'igual', valor: alvo }))}`)
    assert.equal(comF.json.clientes.length, semF.json.length, 'mesmos clientes')
    assert.ok(comF.json.clientes.filter(c => c.cliente !== alvo).every(c => c.n === 0 && c.topo === 0))
    assert.equal(comF.json.clientes.find(c => c.cliente === alvo)?.n, semF.json.find(c => c.cliente === alvo)?.n)
    assert.ok(Array.isArray(comF.json.filtro.chips))
  })
  await ok('distribuição: /api/planos/insights filtra direto no SQL e avisa que as tarefas do Notion ficam fora', async () => {
    const semF = await get('/api/planos/insights'); assert.equal(semF.json.filtro, undefined)
    const comF = await get(`/api/planos/insights?f=${q(URL_F('distribuicao', { campo: 'status', operador: 'igual', valor: 'proposta' }))}`)
    assert.ok(comF.json.por_status.every(s => s.status === 'proposta')); assert.match(comF.json.filtro.aviso, /tarefas/)
    assert.equal(comF.json.tarefas_abertas, semF.json.tarefas_abertas)
    const nada = await get(`/api/planos/insights?f=${q(URL_F('distribuicao', { campo: 'cliente', operador: 'igual', valor: '__ninguem__' }))}`)
    assert.deepEqual([nada.json.por_status, nada.json.por_regra, nada.json.sem_responsavel], [[], [], 0])
  })

  await ok('analistas: visão filtra só por "analista"; cliente/canal/status viram aviso (não zeram a lista); período não existe neste painel', async () => {
    if (!db.prepare('SELECT COUNT(*) n FROM analistas_oficiais').get().n) return console.log('  (sem lista oficial no banco: a visão buscaria o Notion — pulado)')
    const semF = await get('/api/analistas/visao'); assert.equal(semF.status, 200); assert.equal(semF.json.filtro, undefined)
    const comF = await get(`/api/analistas/visao?f=${q(URL_F('analistas', { op: 'E', itens: [{ campo: 'cliente', operador: 'igual', valor: 'X' }, { campo: 'status', operador: 'igual', valor: 'bloqueada' }] }, { preset: 'mes_passado' }))}`)
    assert.equal(comF.json.analistas.length, semF.json.analistas.length, 'condições fora do alcance não recortam')
    assert.match(comF.json.filtro.aviso, /Cliente, Status da tarefa: não alcança/); assert.equal(comF.json.filtro.periodo, null, 'Analistas não oferece período: o pedido é ignorado na validação, não fingido'); assert.match(comF.json.filtro.aviso, /totais do time/)
    assert.deepEqual(comF.json.time, semF.json.time)
    if (!semF.json.analistas.length) return
    const alvo = semF.json.analistas[0].nome
    const um = await get(`/api/analistas/visao?f=${q(URL_F('analistas', { campo: 'analista', operador: 'igual', valor: alvo }))}`)
    assert.deepEqual(um.json.analistas.map(a => a.nome), [alvo]); assert.doesNotMatch(um.json.filtro.aviso, /não alcança|período/); assert.match(um.json.filtro.aviso, /totais do time/)
  })
  await ok('analistas: clientes-atrasados filtra por cliente e por analista (está entre os da linha); canal/status viram aviso; período não existe neste painel', async () => {
    const semF = await get('/api/analistas/clientes-atrasados'); assert.equal(semF.status, 200)
    const aviso = await get(`/api/analistas/clientes-atrasados?f=${q(URL_F('analistas', { campo: 'canal', operador: 'igual', valor: 'ML' }, { preset: 'hoje' }))}`)
    assert.equal(aviso.json.clientes.length, semF.json.clientes.length); assert.match(aviso.json.filtro.aviso, /Canal.*não alcança/); assert.equal(aviso.json.filtro.periodo, null, 'sem período no painel Analistas')
    const comAnalista = semF.json.clientes.find(c => c.analistas.length)
    if (!comAnalista) return
    const r = await get(`/api/analistas/clientes-atrasados?f=${q(URL_F('analistas', { campo: 'analista', operador: 'igual', valor: comAnalista.analistas[0] }))}`)
    assert.ok(r.json.clientes.length >= 1 && r.json.clientes.every(c => c.analistas.includes(comAnalista.analistas[0])))
    const c = await get(`/api/analistas/clientes-atrasados?f=${q(URL_F('analistas', { campo: 'cliente', operador: 'igual', valor: comAnalista.cliente }))}`)
    assert.deepEqual(c.json.clientes.map(x => x.cliente), [comAnalista.cliente])
  })
  await ok('analistas: /api/analistas/tipos aceita ?f= mas declara que nada do painel alcança linhas por tipo', async () => {
    const r = await get(`/api/analistas/tipos?f=${q(URL_F('analistas', { campo: 'analista', operador: 'igual', valor: 'X' }))}`)
    assert.equal(r.status, 200); assert.match(r.json.filtro.aviso, /Analista responsável: não alcança/); assert.ok(Array.isArray(r.json.tipos))
    assert.match((await get(`/api/analistas/tipos?f=${q(URL_F('analistas'))}`)).json.filtro.aviso, /não se aplica/)
  })

  await ok('comercial: lista de prospects ganha "etapa", aceita f (etapa/origem/nome, período por criado_em) e sem f fica como antes', async () => {
    const semF = await get('/api/comercial/prospectos'); assert.equal(semF.status, 200); assert.equal(semF.json.filtro, undefined)
    assert.ok(semF.json.prospectos.every(p => ['aguardando', 'erro', 'conectado', 'pronto', 'pediu_contato'].includes(p.etapa)))
    const comF = await get(`/api/comercial/prospectos?f=${q(URL_F('comercial', { campo: 'etapa', operador: 'igual', valor: 'pronto' }, { preset: 'este_ano' }))}`)
    assert.ok(comF.json.prospectos.every(p => p.etapa === 'pronto' && p.criado_em.slice(0, 4) === HOJE.slice(0, 4))); assert.equal(comF.json.filtro.chips.length, 2)
    assert.equal((await get(`/api/comercial/prospectos?f=${q(URL_F('comercial', { campo: 'nome', operador: 'igual', valor: '__ninguem__' }))}`)).json.prospectos.length, 0)
  })

  await ok('resultados: sem f a resposta tem as chaves de sempre na mesma ordem; com f as medidas recortam e os agrupamentos são recalculados', async () => {
    const semF = await get('/api/resultados/padroes'); assert.equal(semF.status, 200)
    // contrato que muda de propósito (plano §5): nicho, região e nicho × tipo entram NO FIM; o resto segue na mesma ordem
    assert.deepEqual(Object.keys(semF.json), ['clientes', 'n_clientes', 'lancamentos', 'n_medidas', 'por_tipo', 'por_analista', 'por_palavra', 'por_analista_tipo', 'mensurabilidade', 'medidas', 'por_nicho', 'por_regiao', 'por_nicho_tipo'])
    const vazio = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'cliente', operador: 'igual', valor: '__ninguem__' }))}`)
    assert.deepEqual([vazio.json.n_medidas, vazio.json.por_tipo, vazio.json.mensurabilidade, vazio.json.medidas], [0, [], [], []]); assert.equal(vazio.json.n_clientes, semF.json.n_clientes)
    assert.match(vazio.json.filtro.aviso, /Mercado Livre/)
    const outroCanal = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'canal', operador: 'igual', valor: 'SHO' }))}`)
    assert.equal(outroCanal.json.n_medidas, 0, 'toda medição é do ML')
    const ml = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'canal', operador: 'igual', valor: 'ML' }))}`)
    assert.equal(ml.json.n_medidas, semF.json.n_medidas); assert.deepEqual(ml.json.por_tipo, semF.json.por_tipo, 'canal = ML não muda nada (mesma ordem)')
    const comMedidas = semF.json.mensurabilidade.find(m => m.mensuraveis > 0)
    if (!comMedidas) return console.log('  (nenhum cliente com medidas: recorte por cliente/tipo não exercitado)')
    const um = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'cliente', operador: 'igual', valor: comMedidas.cliente }))}`)
    assert.deepEqual(um.json.mensurabilidade.map(m => m.cliente), [comMedidas.cliente]); assert.ok(um.json.medidas.every(m => m.cliente === comMedidas.cliente))
    assert.ok(um.json.n_medidas <= semF.json.n_medidas)
    if (!semF.json.por_tipo.length) return
    const tipo = semF.json.por_tipo[0].chave
    const porTipo = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'tipo', operador: 'igual', valor: tipo }))}`)
    assert.deepEqual(porTipo.json.por_tipo.map(t => t.chave), [tipo]); assert.equal(porTipo.json.por_tipo[0].n, semF.json.por_tipo[0].n)
  })
} finally { srv.close() }

console.log(`\n${n} verificações OK`)
process.exit(0)
