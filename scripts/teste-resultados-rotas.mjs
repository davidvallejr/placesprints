// Autoteste das rotas de resultado por grupo e da cronologia de preços (src/rotas-planos.js): /api/resultados/padroes (contrato de chaves, nicho e
// região no fim), /api/resultados/tarefas (drill-down paginado no servidor, piorou primeiro, 400 sem eco, sem prospect) e /api/cliente/precos.
// Parte HTTP: as rotas reais numa porta efêmera de loopback, só GET, lendo o banco local como está (nunca copia data/db.sqlite).
// Rodar: node scripts/teste-resultados-rotas.mjs
import assert from 'node:assert/strict'
import express from 'express'
import { serializar, validar } from '../src/lib/filtros.js'
import { rotasPlanos } from '../src/rotas-planos.js'
import { rotasProfissionais } from '../src/rotas-profissionais.js'
import { db } from '../src/lib/db.js'
import { SEM_UF, SEM_NICHO } from '../src/lib/dimensoes.js'
import { agruparDimensoes, agruparPadroes, medidasDoGrupo, OUTROS } from '../src/lib/impacto-tarefas.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-07'
const URL_F = (painel, arvore, periodo) => serializar(validar({ painel, arvore, periodo }, { hoje: HOJE }))
// ── parte pura: agruparDimensoes / medidasDoGrupo ─────────────────────────────
await ok('dimensões: nicho e região com n ≥ 5 viram linha; o resto soma em "Outros" (por último); "clientes" conta as contas; confundida pelo preço fica fora e é contada', () => {
  const M = (cliente, nicho, regiao, estado, extra = {}) => ({ cliente, nicho, regiao, uf: '', tipo: 'Otimizar Anúncios', analista: 'Ana', titulo: 'x', estado, efeito_pct: estado === 'melhorou' ? 20 : estado === 'piorou' ? -20 : 0, receita_alocada: 10, ...extra })
  const rep = (k, ...a) => Array.from({ length: k }, () => M(...a))
  const ms = [...rep(6, 'C1', 'Pet', 'Sudeste', 'melhorou'), ...rep(2, 'C2', 'Pet', 'Sudeste', 'piorou'),          // Pet: 8 de 2 contas
    ...rep(5, 'C3', 'Moda', 'Sul', 'sem_efeito'),                                                              // Moda: 5 de 1 conta → selo "1 cliente"
    ...rep(2, 'C4', 'Tintas', SEM_UF, 'melhorou'), ...rep(1, 'C5', 'Livros', SEM_UF, 'piorou'),                // pequenos → Outros (3 medidas, 2 grupos)
    M('C1', 'Pet', 'Sudeste', 'piorou', { confundido_preco: true }), M('C6', 'Cosméticos', 'Sul', 'melhorou', { confundido_preco: true }),   // confundidas
    M('C1', 'Pet', 'Sudeste', 'lancamento', { lancamento: { vendeu: false, primeira_venda_dias: null }, metricas: {} }), M('C1', 'Pet', 'Sudeste', 'em_maturacao')]                     // não medidas: fora
  const d = agruparDimensoes(ms)
  assert.deepEqual(d.por_nicho.map(g => [g.chave, g.n, g.clientes]), [['Pet', 8, 2], ['Moda', 5, 1], [OUTROS, 3, 2]])
  assert.equal(d.por_nicho.at(-1).outros, true); assert.equal(d.por_nicho.at(-1).grupos, 2); assert.equal(d.por_nicho.find(g => g.chave === 'Pet').confundidas_preco, 1)
  assert.equal(d.por_nicho.find(g => g.chave === OUTROS).confundidas_preco, 1, 'a confundida de um nicho sem medida válida vai para Outros')
  assert.ok(d.por_regiao.find(g => g.chave === 'Sudeste').n === 8 && d.por_regiao.find(g => g.chave === 'Sul').n === 5)
  assert.equal(d.por_regiao.find(g => g.outros)?.n, 3, 'Sem UF (3) é pequeno: soma em Outros')
  assert.deepEqual(d.por_nicho_tipo.map(g => g.chave), ['Pet · Otimizar Anúncios', 'Moda · Otimizar Anúncios'], 'nicho × tipo: só cruzamentos com n ≥ 5, sem linha Outros')
  assert.equal(d.por_nicho.reduce((t, g) => t + g.n, 0), agruparPadroes(ms).n_medidas, 'toda medida válida cai em exatamente uma linha')
  assert.equal(agruparPadroes(ms).por_tipo[0].clientes, 5, 'os grupos de sempre também contam as contas (das medidas válidas: C6 só tem confundida)')
  // drill-down: a linha abre as mesmas medidas (válidas + confundidas)
  assert.equal(medidasDoGrupo(ms, 'nicho', 'Pet').length, 9); assert.equal(medidasDoGrupo(ms, 'nicho', OUTROS).length, 4); assert.equal(medidasDoGrupo(ms, 'regiao', OUTROS).length, 3)
  assert.equal(medidasDoGrupo(ms, 'nicho_tipo', 'Moda · Otimizar Anúncios').length, 5); assert.equal(medidasDoGrupo(ms, 'uf', SEM_UF).length, 18, 'sem UF gravada: todas as medidas (16 válidas + 2 confundidas)')
  assert.equal(medidasDoGrupo(ms, 'analista', 'Ana').length, 18); assert.equal(medidasDoGrupo([{ ...ms[0], nicho: undefined }], 'nicho', SEM_NICHO).length, 1, 'medida sem nicho anotado = "Sem nicho registrado"')
  assert.deepEqual(agruparDimensoes([]), { por_nicho: [], por_regiao: [], por_nicho_tipo: [], por_produto: [] })   // por_produto: 21/10/2026 (§ 8.7)
})

const app = express(); app.use(rotasPlanos); app.use(rotasProfissionais)
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const base = `http://127.0.0.1:${srv.address().port}`
const get = async (caminho) => { const r = await fetch(base + caminho); const t = await r.text(); let json = null; try { json = JSON.parse(t) } catch { /* não JSON */ } return { status: r.status, json, texto: t } }
const q = s => encodeURIComponent(s)
const SEGREDO = 'SEGREDO_NAO_ECOAR'
const ORDEM = ['piorou', 'melhorou', 'sem_efeito']
const naoEcoa = (r, rota) => { assert.equal(r.status, 400, rota); assert.ok(r.json?.erro, rota); assert.doesNotMatch(r.texto, /SEGREDO/, rota) }

try {
  const pad = await get('/api/resultados/padroes')
  await ok('padroes: chaves de sempre na mesma ordem e nicho/região/nicho × tipo NO FIM; grupos trazem "clientes"; só grupos com n ≥ 5 (o resto na linha "Outros")', async () => {
    assert.equal(pad.status, 200)
    assert.deepEqual(Object.keys(pad.json).slice(-5), ['por_nicho', 'por_regiao', 'por_nicho_tipo', 'por_produto', 'carteira_produto'])   // produto no fim (21/10/2026, § 8.7)
    for (const k of ['por_tipo', 'por_analista', 'por_nicho', 'por_regiao']) for (const g of pad.json[k]) assert.ok(Number.isInteger(g.clientes) && g.clientes >= 1, k)
    for (const k of ['por_nicho', 'por_regiao']) {
      const outros = pad.json[k].filter(g => g.outros)
      assert.ok(outros.length <= 1 && pad.json[k].filter(g => !g.outros).every(g => g.n >= 5), k)
      if (outros.length) { assert.equal(pad.json[k].at(-1).outros, true, 'a linha "Outros" vem por último'); assert.equal(outros[0].chave, 'Outros') }
      assert.equal(pad.json[k].reduce((t, g) => t + g.n, 0), pad.json.n_medidas, `${k}: toda medida válida cai em exatamente um grupo`)
    }
    assert.ok(pad.json.por_nicho_tipo.every(g => g.n >= 5))
    const comF = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'canal', operador: 'igual', valor: 'ML' }))}`)
    assert.deepEqual(Object.keys(comF.json).slice(-6), ['filtro', 'por_nicho', 'por_regiao', 'por_nicho_tipo', 'por_produto', 'carteira_produto'], 'com filtro: depois do filtro, no fim')
    assert.deepEqual(comF.json.por_nicho, pad.json.por_nicho, 'canal = ML não muda nada')
    const sho = await get(`/api/resultados/padroes?f=${q(URL_F('resultados', { campo: 'canal', operador: 'igual', valor: 'SHO' }))}`)
    assert.deepEqual([sho.json.por_nicho, sho.json.por_regiao, sho.json.por_nicho_tipo], [[], [], []], 'toda medição é do ML')
  })

  await ok('tarefas: grupo/estado/página inválidos, chave vazia e filtro de outro painel → 400 sem ecoar o valor', async () => {
    naoEcoa(await get(`/api/resultados/tarefas?grupo=${SEGREDO}&chave=x`), 'grupo')
    naoEcoa(await get(`/api/resultados/tarefas?grupo=tipo&chave=x&estado=${SEGREDO}`), 'estado')
    naoEcoa(await get('/api/resultados/tarefas?grupo=tipo&chave='), 'chave vazia')
    for (const p of ['0', '-1', 'abc', '1.5', SEGREDO]) naoEcoa(await get(`/api/resultados/tarefas?grupo=tipo&chave=x&pagina=${q(p)}`), 'página ' + p)
    naoEcoa(await get(`/api/resultados/tarefas?grupo=tipo&chave=x&pagina=99999`), 'página fora da faixa')
    const outro = await get(`/api/resultados/tarefas?grupo=tipo&chave=x&f=${q(URL_F('execucao', { campo: 'cliente', operador: 'igual', valor: SEGREDO }))}`)
    naoEcoa(outro, 'filtro de outro painel'); assert.match(outro.json.erro, /outro painel/)
  })

  await ok('tarefas: grupo sem medidas → página 1 vazia (200), página 2 fora da faixa', async () => {
    const r = await get('/api/resultados/tarefas?grupo=tipo&chave=__ninguem__')
    assert.equal(r.status, 200); assert.deepEqual([r.json.total, r.json.linhas, r.json.pagina, r.json.paginas], [0, [], 1, 1])
    assert.equal((await get('/api/resultados/tarefas?grupo=tipo&chave=__ninguem__&pagina=2')).status, 400)
  })

  const tipo = pad.json.por_tipo.slice().sort((a, b) => (b.n + b.confundidas) - (a.n + a.confundidas))[0]
  await ok('tarefas: a linha da tabela abre as MESMAS medidas (n + confundidas), piorou primeiro, 50 por página, sem prospect, com anúncio e aviso de preço', async () => {
    if (!tipo) return console.log('  (nenhum tipo com medida: drill-down só validado nos erros)')
    const r = await get(`/api/resultados/tarefas?grupo=tipo&chave=${q(tipo.chave)}`)
    assert.equal(r.status, 200); assert.equal(r.json.total, tipo.n + tipo.confundidas, "n + confundidas (preço OU estado, união)")
    assert.equal(r.json.contagem.piorou + r.json.contagem.melhorou + r.json.contagem.sem_efeito, r.json.total)
    assert.ok(r.json.contagem.melhorou >= tipo.melhorou && r.json.contagem.piorou >= tipo.piorou, 'confundidas somam por cima das válidas')
    assert.ok(r.json.linhas.length <= 50 && r.json.por_pagina === 50)
    const idx = r.json.linhas.map(l => ORDEM.indexOf(l.estado)); assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'piorou → melhorou → sem efeito')
    assert.ok(r.json.linhas.every(l => !/^\[Comercial\] /.test(l.cliente) && l.tipo === tipo.chave && 'aviso_preco' in l && 'aviso_estado' in l && 'anuncio' in l && l.nicho && l.regiao))
    if (r.json.paginas > 1) { const p2 = await get(`/api/resultados/tarefas?grupo=tipo&chave=${q(tipo.chave)}&pagina=2`); assert.equal(p2.status, 200); assert.notDeepEqual(p2.json.linhas[0]?.id, r.json.linhas[0]?.id) }
    const so = await get(`/api/resultados/tarefas?grupo=tipo&chave=${q(tipo.chave)}&estado=sem_efeito`)
    assert.ok(so.json.linhas.every(l => l.estado === 'sem_efeito')); assert.equal(so.json.total, r.json.contagem.sem_efeito)
    const sho = await get(`/api/resultados/tarefas?grupo=tipo&chave=${q(tipo.chave)}&f=${q(URL_F('resultados', { campo: 'canal', operador: 'igual', valor: 'SHO' }))}`)
    assert.equal(sho.json.total, 0, 'canal ≠ ML: nada medido'); assert.ok(Array.isArray(sho.json.filtro.chips))
  })

  await ok('tarefas: nicho, região (com a linha "Outros") e UF abrem o mesmo total da tabela; filtro por nicho recorta', async () => {
    for (const [grupo, k] of [['nicho', 'por_nicho'], ['regiao', 'por_regiao']]) for (const g of pad.json[k]) {
      const r = await get(`/api/resultados/tarefas?grupo=${grupo}&chave=${q(g.chave)}`)
      assert.equal(r.json.total, g.n + g.confundidas, `${grupo} ${g.chave}`)
    }
    const semUf = await get(`/api/resultados/tarefas?grupo=uf&chave=${q(SEM_UF)}`)
    const linhaSemUf = pad.json.por_regiao.find(g => g.chave === SEM_UF)
    if (!db.prepare("SELECT COUNT(*) n FROM meli_contas WHERE uf <> ''").get().n && linhaSemUf) assert.equal(semUf.json.total, linhaSemUf.n + linhaSemUf.confundidas, 'sem UF gravada: UF e região "Sem UF registrada" abrem as mesmas tarefas')
    const nicho = pad.json.por_nicho.find(g => !g.outros)
    if (!nicho) return
    const r = await get(`/api/resultados/tarefas?grupo=tipo&chave=${q(tipo.chave)}&f=${q(URL_F('resultados', { campo: 'nicho', operador: 'igual', valor: nicho.chave }))}`)
    assert.ok(r.json.linhas.every(l => l.nicho === nicho.chave))
  })

  await ok('filtros: painel resultados oferece nicho, UF e região (com "Sem UF registrada"); painel cliente oferece preço mudou e variação do preço', async () => {
    const d = await get('/api/filtros/definicao?painel=resultados')
    const c = id => d.json.campos.find(x => x.id === id)
    assert.ok(c('nicho')?.valores.includes('Sem nicho registrado')); assert.ok(c('uf')?.valores.includes('SP') && c('uf').valores.includes(SEM_UF) && c('uf').valores.length === 28)
    assert.deepEqual(c('regiao')?.valores, ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul', SEM_UF])
    const cl = await get('/api/filtros/definicao?painel=cliente')
    assert.equal(cl.json.campos.find(x => x.id === 'preco_mudou')?.tipo, 'bool'); assert.equal(cl.json.campos.find(x => x.id === 'variacao_preco_pct')?.tipo, 'numero')
  })

  await ok('precos: prospect → 400 sem eco; sem cliente → 400; página inválida → 400; cliente sem conta → indisponível', async () => {
    naoEcoa(await get(`/api/cliente/precos?cliente=${q('[Comercial] ' + SEGREDO)}`), 'prospect')
    naoEcoa(await get('/api/cliente/precos'), 'sem cliente')
    assert.equal((await get('/api/cliente/precos?cliente=__ninguem__')).json.disponivel, false)
    const c = db.prepare("SELECT cliente FROM meli_serie_item WHERE cliente NOT LIKE '[Comercial] %' LIMIT 1").get()?.cliente
    if (!c) return console.log('  (nenhum cliente com coleta: cronologia não exercitada)')
    naoEcoa(await get(`/api/cliente/precos?cliente=${q(c)}&pagina=${SEGREDO}`), 'página')
    const r = await get(`/api/cliente/precos?cliente=${q(c)}&dias=90`)
    assert.equal(r.status, 200); assert.equal(r.json.disponivel, true); assert.equal(r.json.dias, 90)
    assert.ok(Array.isArray(r.json.eventos) && r.json.eventos.length <= 50 && 'desde' in r.json)
    assert.match(r.json.aviso, /uma leitura por dia/); assert.match(r.json.aviso, /sem grupo de controle; não é efeito/); assert.match(r.json.aviso, /vai e volta no mesmo dia não aparece/)
    for (const e of r.json.eventos) assert.ok(e.item_id && e.dia && 'de' in e && 'para' in e && e.origem && 'tarefa' in e && 'antes' in e.vendas_dia)
  })

  await ok('tarefas-anuncio: cada cartão traz veredito { familia, titulo, linha } e preços; aceita limite até 200', async () => {
    const c = db.prepare("SELECT DISTINCT cliente FROM tarefa_acomp WHERE cliente NOT LIKE '[Comercial] %' LIMIT 1").get()?.cliente
      || db.prepare("SELECT cliente FROM meli_serie_item WHERE cliente NOT LIKE '[Comercial] %' LIMIT 1").get()?.cliente
    if (!c) return console.log('  (nenhum cliente com coleta)')
    const r = await get(`/api/cliente/tarefas-anuncio?cliente=${q(c)}&limite=200`)
    assert.equal(r.status, 200)
    const fams = ['piorou', 'melhorou', 'lancou', 'sem_efeito', 'maturando', 'andamento', 'sem_base']
    for (const k of r.json.cartoes) { assert.ok(fams.includes(k.veredito.familia) && k.veredito.titulo && typeof k.veredito.linha === 'string'); assert.ok(Array.isArray(k.precos.eventos)) }
    const idx = r.json.cartoes.map(k => fams.indexOf(k.veredito.familia)); assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'piorou primeiro')
    assert.equal(Object.values(r.json.resumo.por_familia).reduce((a, b) => a + b, 0), r.json.resumo.tarefas_com_anuncio)
  })

  await ok('profissionais: canal desconhecido → 400 sem eco; canal fora do ML diz "sem medição"; nicho é opt-in e volta na resposta', async () => {
    naoEcoa(await get(`/api/profissionais/melhor?familia=otimizar&canal=${SEGREDO}`), 'canal')
    const sho = await get('/api/profissionais/melhor?familia=otimizar&canal=SHO')
    assert.equal(sho.status, 200); assert.equal(sho.json.n_medidas_familia, 0); assert.match(sho.json.aviso, /^sem medição para Shopee/)
    const pet = await get(`/api/profissionais/melhor?familia=otimizar&nicho=${q('pet shop')}`)
    assert.equal(pet.json.nicho, 'Pet', 'o nicho passa pelo mapa curado'); assert.equal((await get('/api/profissionais/melhor?familia=otimizar')).json.nicho, null)
  })
} finally { srv.close() }

console.log(`\n${n} verificações OK`)
process.exit(0)
