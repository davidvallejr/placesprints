// Autoteste de «Produto como dimensão» (Place Performance × Place Prime; docs/desenho-place-prime.md § A). Banco em memória, sem rede.
//  (1) mapa FECHADO: os 12 tiers de config/produtos.json → performance|prime (+ subtipo); tier desconhecido/vazio = produto '' + pendência produto_nao_mapeado;
//  (2) pendência vai para cadastro:pendencias (sync_estado), preserva as da importação, nunca para config/dependencias-cliente.json;
//  (3) recorte isola por produto: dimensoesDe carimba, filtro do painel resultados (predicado) e execucao (expansão), agruparDimensoes.por_produto, drill, resolverEscopo.
// Rodar: node scripts/teste-produto.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { db, getEstado, setEstado } = await import('../src/lib/db.js')
const P = await import('../src/lib/produto.js')
const C = await import('../src/lib/cadastro-clientes.js')
const { carregarClientes, resolverEscopo } = await import('../src/lib/equipe.js')
const { dimensoesDe, agruparDimensoes, medidasDoGrupo, CHAVES_GRUPO } = await import('../src/lib/impacto-tarefas.js')
const F = await import('../src/lib/filtros.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const RAIZ = new URL('..', import.meta.url).pathname, ler = p => readFileSync(RAIZ + p, 'utf8')

await caso('mapa fechado: os 12 tiers do config caem em performance/prime com subtipo; nada é inferido', () => {
  const cfg = JSON.parse(ler('config/produtos.json'))
  assert.deepEqual(P.PRODUTOS, ['performance', 'prime'])
  assert.equal(Object.keys(cfg.tier_para_produto).length, 12)
  for (const [tier, m] of Object.entries(cfg.tier_para_produto)) {
    const r = P.produtoDeTier(tier)
    assert.equal(r.produto, m.produto, tier); assert.equal(r.subtipo, m.subtipo || '', tier); assert.equal(r.nome, cfg.produtos[m.produto].nome)
  }
  assert.deepEqual(P.produtoDeTier('  Plano Performance '), { produto: 'performance', subtipo: '', nome: 'Place Performance' }, 'só apara espaço')
  assert.deepEqual(P.produtoDeTier('Legacy'), { produto: 'prime', subtipo: 'prime_negocio', nome: 'Place Prime' })
  assert.equal(P.produtoDoCliente({ tier: 'Reestruturação' }).subtipo, 'performance_erp')
})

await caso('tier desconhecido, vazio ou só parecido = produto \'\' + pendência produto_nao_mapeado (nunca chute)', () => {
  for (const t of ['Tier Inventado', 'Não informado', '', null, undefined, 'plano performance', 'Prime']) {
    const r = P.produtoDeTier(t)
    assert.equal(r.produto, '', String(t)); assert.equal(r.pendencia, 'produto_nao_mapeado', String(t))
  }
  assert.equal(P.chaveProduto('Tier Inventado'), P.SEM_PRODUTO)
  assert.ok(!/produto_nao_mapeado/.test(ler('config/dependencias-cliente.json')), 'pendência de cadastro nunca entra no catálogo do cliente')
  assert.ok(!/export (const|function) produtoDe\b/.test(ler('src/lib/produto.js')), 'produtoDe é do grafo de anúncios (duplicacao.js)')
})

// central de mentira: 2 Performance, 2 Prime (um Legacy), 1 fora da lista
const ins = db.prepare("INSERT INTO clientes_central (cliente, status_cs, tier, canais_json, consultores_json, lideres_json, atualizado_em) VALUES (?, 'Ativo', ?, '[\"ML\"]', '{}', '{}', 'x')")
const CENTRAL = [['Alfa', 'Plano Performance'], ['Beta', 'Assessoria Gold'], ['Gama', 'Place Prime'], ['Delta', 'Legacy'], ['Epsilon', 'Tier Inventado']]
for (const [c, t] of CENTRAL) ins.run(c, t)
for (const [c] of CENTRAL) db.prepare("INSERT INTO tarefas (id, cliente, titulo, arquivada, fonte) VALUES (?, ?, 't', 0, 'demo')").run('t-' + c, c)

await caso('carregarClientes ganha produto/subtipo; tier continua', () => {
  const m = Object.fromEntries(carregarClientes().map(c => [c.cliente, c]))
  assert.equal(m.Alfa.produto, 'performance'); assert.equal(m.Delta.produto, 'prime'); assert.equal(m.Delta.subtipo, 'prime_negocio'); assert.equal(m.Epsilon.produto, '')
  assert.equal(m.Epsilon.tier, 'Tier Inventado')
  const cart = P.carteiraPorProduto(carregarClientes(), ['Alfa', 'Gama'])
  assert.deepEqual(cart.map(l => [l.produto, l.clientes, l.conectados]), [['performance', 2, 1], ['prime', 2, 1], ['sem_produto', 1, 0]])
})

await caso('pendência produto_nao_mapeado vai para cadastro:pendencias e preserva as da importação (idempotente)', () => {
  setEstado('cadastro:pendencias', JSON.stringify({ em: 'x', fonte: 'planilha', pendencias: [{ nome: 'Fulano', motivo: 'nao_encontrado', candidatos: [], canais: [] }] }))
  assert.equal(C.registrarPendenciasProduto(carregarClientes()), 1)
  assert.equal(C.registrarPendenciasProduto(carregarClientes()), 1, 'rodar de novo não duplica')
  const p = JSON.parse(getEstado('cadastro:pendencias'))
  assert.equal(p.fonte, 'planilha')
  assert.deepEqual(p.pendencias.map(x => [x.nome, x.motivo]), [['Fulano', 'nao_encontrado'], ['Epsilon', 'produto_nao_mapeado']])
  assert.equal(p.pendencias[1].tier, 'Tier Inventado')
  assert.equal(C.lerCadastro('Alfa').central.produto.nome, 'Place Performance')
  assert.equal(C.lerCadastro('Epsilon').central.produto.produto, '')
})

await caso('dimensoesDe carimba o produto na medida (sem produto = sem_produto)', () => {
  assert.equal(dimensoesDe('Gama').produto, 'prime'); assert.equal(dimensoesDe('Epsilon').produto, 'sem_produto'); assert.equal(dimensoesDe('Inexistente').produto, 'sem_produto')
})

// medidas sintéticas carimbadas como padroesGlobais faz
const med = (cliente, estado, i) => ({ id: `${cliente}-${i}`, cliente, estado, tipo: 'Otimização', efeito_pct: estado === 'melhorou' ? 10 : -5, receita_incremental: 100, ...dimensoesDe(cliente) })
const medidas = [...[0, 1, 2, 3, 4, 5].map(i => med('Alfa', i < 4 ? 'melhorou' : 'piorou', i)), ...[0, 1].map(i => med('Gama', 'sem_efeito', i)), med('Epsilon', 'melhorou', 0)]

await caso('filtro ?f=produto isola: predicado (resultados), expansão (execucao), grupos e drill', () => {
  for (const painel of ['resultados', 'execucao']) assert.ok(F.definicao(painel).campos.some(c => c.id === 'produto' && c.opcoes === 'produtos'), painel)
  const def = F.validar({ painel: 'resultados', arvore: { op: 'E', itens: [{ campo: 'produto', operador: 'igual', valor: 'prime' }] } }, { hoje: '2026-10-21' })
  const pred = F.compilarPredicado(def)
  assert.deepEqual([...new Set(medidas.filter(pred).map(m => m.cliente))], ['Gama'])
  const ida = F.desserializar(F.serializar(def), { painel: 'resultados', hoje: '2026-10-21' })
  assert.equal(medidas.filter(F.compilarPredicado(ida)).length, 2, 'serializa/desserializa igual (é o ?f= que o shell monta)')
  assert.match(F.chips(def)[0].texto, /Place Prime/, 'chip legível, nunca o id cru')
  // execucao: produto vira "cliente é um de [clientes do produto]" antes do SQL
  const dx = F.validar({ painel: 'execucao', arvore: { op: 'E', itens: [{ campo: 'produto', operador: 'igual', valor: 'performance' }] } }, { hoje: '2026-10-21' })
  const ex = F.expandir(dx, { clientes_do_produto: no => carregarClientes().filter(c => [].concat(no.valor).includes(c.produto || 'sem_produto')).map(c => c.cliente) })
  assert.deepEqual(ex.arvore.itens[0], { campo: 'cliente', operador: 'em', valor: ['Alfa', 'Beta'] })
  assert.match(F.compilarSQL(ex).where, /cliente/)
  // grupos: por_produto direto (sem «Outros»), amostra pequena na própria linha
  const g = Object.fromEntries(agruparDimensoes(medidas).por_produto.map(x => [x.chave, x]))
  assert.equal(g.performance.n, 6); assert.equal(g.performance.melhorou, 4); assert.equal(g.performance.amostra_pequena, false)
  assert.equal(g.prime.n, 2); assert.equal(g.prime.amostra_pequena, true); assert.equal(g.sem_produto.n, 1)
  assert.ok(!agruparDimensoes(medidas).por_produto.some(x => x.outros), 'produto nunca soma em Outros')
  assert.equal(CHAVES_GRUPO.produto({}), 'sem_produto')
  assert.deepEqual(medidasDoGrupo(medidas, 'produto', 'prime').map(m => m.cliente), ['Gama', 'Gama'])
  assert.match(ler('src/rotas-planos.js'), /GRUPOS_DRILL = \[[^\]]*'produto'/, 'drill aceita grupo=produto')
})

await caso('resolverEscopo tipo:produto recorta os elegíveis; produto inválido = erro, nunca «todos»', () => {
  assert.deepEqual(resolverEscopo({ tipo: 'produto', produto: 'prime' }).clientes.sort(), ['Delta', 'Gama'])
  assert.deepEqual(resolverEscopo({ tipo: 'produto', produto: 'sem_produto' }).clientes, ['Epsilon'])
  const e = resolverEscopo({ tipo: 'produto', produto: 'ouro' }); assert.ok(e.erro); assert.deepEqual(e.clientes, [])
  assert.ok(resolverEscopo({ tipo: 'produto' }).erro)
})

await caso('shell e telas: seletor DOM puro com ps_produto em try/catch; #secPorProduto ≤ 6 colunas com ROI «—»; ficha com (i) produto_contratado', () => {
  const sh = ler('src/web/shell.js')
  assert.match(sh, /id: 'psProduto'/); assert.match(sh, /localStorage\.getItem\('ps_produto'\)/); assert.match(sh, /try \{ localStorage\.setItem\('ps_produto'/)
  assert.match(sh, /FP = \{ '\/': 'execucao', '\/resultados': 'resultados' \}/, 'só links cujo painel lê ?f= e tem o campo produto')
  assert.doesNotMatch(sh, /innerHTML|\bfetch\(/)
  const rj = ler('src/web/resultados.js'), rh = ler('src/web/resultados.html')
  assert.match(rh, /id="secPorProduto"/); assert.match(rh, /id="porProduto"/)
  const cab = rj.slice(rj.indexOf('const ROI_FIXO'), rj.indexOf('function cabecalho'))
  assert.ok((cab.match(/<th /g) || []).length <= 6, 'tabela ≤ 6 colunas')
  assert.match(cab, /mensalidade do cliente ainda não está no sistema/)
  assert.match(ler('src/web/cliente.js'), /id="cadProduto"[\s\S]{0,600}data-ajuda="produto_contratado"/)
  assert.ok(JSON.parse(ler('config/ajuda.json')).verbetes.produto_contratado)
})

console.log(`\n✔ teste-produto: ${n} casos`)
