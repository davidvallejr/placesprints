// Autoteste dos 8 sistemas (config/sistemas.json, src/lib/sistemas.js; decisão do David 15/10/2026). Banco EM MEMÓRIA, sem rede, sem envio.
//  (1) catálogo fechado: os 8 ids, nesta ordem; id fora dele = erro; voz/secao no formato combinado;
//  (2) mapaDeOrigem cobre TODA regra de config/algoritmo.json e TODO tipo de config/gatilhos.json (e os avisos do sino);
//  (3) aviso do sino: título com o nome do sistema e campo `sistema` (passado pelo chamador ou pela tabela);
//  (4) textos ao CLIENTE inalterados: plano semanal, relatório focado e alerta de impacto byte a byte iguais (sha256 fixado numa amostra em memória), assinados só pelo Merovíngio;
//  (5) telas internas: todo data-sistema existe no catálogo e bate com docs/ux/inventario-*.json → selos_sistema; /metodologia lista os 8; o /diagnostico-motor do cliente não leva selo.
// Rodar: node scripts/teste-sistemas.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { readFileSync } = await import('node:fs')
const { createHash } = await import('node:crypto')
const { SISTEMAS, sistema, voz, secao, mapaDeOrigem, origemNome } = await import('../src/lib/sistemas.js')

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const IDS = ['trinity', 'arquiteto', 'oraculo', 'merovingio', 'chaveiro', 'morpheus', 'smith', 'neo']

await ok('catálogo fechado: os 8 sistemas com nome, papel e o que assina; id desconhecido lança; voz «Arquiteto · …» e secao «Merovíngio — …»', () => {
  assert.deepEqual(SISTEMAS.map(s => s.id), IDS)
  for (const s of SISTEMAS) { assert.ok(s.nome && s.papel && s.assina, s.id); assert.ok(s.papel.length <= 140, `papel de ${s.id} em 1 linha`) }
  assert.deepEqual(SISTEMAS.map(s => s.nome), ['Trinity', 'Arquiteto', 'Oráculo', 'Merovíngio', 'Chaveiro', 'Morpheus', 'Smith', 'Neo'])
  assert.throws(() => sistema('zion'), /sistema desconhecido/); assert.throws(() => voz('', 'x'), /sistema desconhecido/)
  assert.equal(voz('arquiteto', 'plano regerado'), 'Arquiteto · plano regerado'); assert.equal(secao('merovingio', 'o que rendeu'), 'Merovíngio — o que rendeu')
  assert.ok(Object.isFrozen(SISTEMAS) && Object.isFrozen(SISTEMAS[0]), 'catálogo imutável em memória')
})

await ok('mapaDeOrigem cobre todas as regras de config/algoritmo.json e todos os tipos de config/gatilhos.json, sempre com id do catálogo', () => {
  const regras = JSON.parse(ler('config/algoritmo.json')).regras.map(r => r.id), gat = Object.keys(JSON.parse(ler('config/gatilhos.json')).gatilhos)
  assert.ok(regras.length >= 30 && gat.length >= 15)
  const sem = [...regras, ...gat].filter(k => !IDS.includes(mapaDeOrigem(k)))
  assert.deepEqual(sem, [], 'sem sistema de origem: ' + sem.join(', '))
  assert.equal(mapaDeOrigem('preco_mudou_vendas_cairam'), 'merovingio'); assert.equal(mapaDeOrigem('margem_negativa'), 'smith'); assert.equal(mapaDeOrigem('estoque_ruptura'), 'oraculo')
  assert.equal(mapaDeOrigem('anuncio_restrito'), 'trinity', 'regra e gatilho com o mesmo nome têm um dono só'); assert.equal(mapaDeOrigem('ima_conversao'), 'arquiteto')
  // avisos do sino (tipos com sufixo e famílias)
  for (const [t, s] of [['cliente_conectado', 'trinity'], ['s90_conectado', 'trinity'], ['relatorio_falhou:notion_401', 'morpheus'], ['alerta_pendencia', 'morpheus'], ['consultor_discord_falhou', 'morpheus'],
    ['dossie_mensal', 'morpheus'], ['diagnostico_pronto', 'arquiteto'], ['aviso_assessoria_critico', 'morpheus']]) assert.equal(mapaDeOrigem(t), s, t)
  assert.equal(mapaDeOrigem('qualquer_coisa'), null); assert.equal(mapaDeOrigem(undefined), null); assert.equal(origemNome('qualquer_coisa'), 'Morpheus', 'sem dono conhecido = comunicação')
})

await ok('aviso do sino: título «Sistema · …» e campo sistema (do chamador, da tabela pelo tipo ou Morpheus); dedupe e corte de 160 seguem iguais', async () => {
  const { notificar, listarNotificacoes } = await import('../src/lib/notificacoes.js')
  const base = listarNotificacoes().ultimo_id
  notificar({ tipo: 'cliente_conectado', nivel: 'sucesso', titulo: 'Novo cliente conectado: Acme', cliente: 'Acme' })
  notificar({ tipo: 'relatorio_falhou:notion_401', nivel: 'erro', titulo: 'Relatório não enviado: Acme', cliente: 'Acme' })
  notificar({ tipo: 'tipo_novo', titulo: 'Algo novo' })
  notificar({ tipo: 'qualquer', titulo: 'Custo sem SKU', sistema: 'smith' })
  assert.throws(() => notificar({ tipo: 'x', titulo: 'y', sistema: 'zion' }), /sistema desconhecido/, 'id fora do catálogo não grava')
  const l = listarNotificacoes({ desde: base }).itens
  assert.deepEqual(l.map(x => [x.titulo, x.sistema]), [['Trinity · Novo cliente conectado: Acme', 'trinity'], ['Morpheus · Relatório não enviado: Acme', 'morpheus'], ['Morpheus · Algo novo', 'morpheus'], ['Smith · Custo sem SKU', 'smith']])
  const id = notificar({ tipo: 'conexao_caiu', titulo: 'caiu', cliente: 'B', dedupeMin: 60 }); assert.equal(notificar({ tipo: 'conexao_caiu', titulo: 'caiu de novo', cliente: 'B', dedupeMin: 60 }), id)
  notificar({ tipo: 't', titulo: 'x'.repeat(400) }); assert.ok(listarNotificacoes({ desde: id }).itens.at(-1).titulo.length <= 160)
})

await ok('Discord do time: seções por sistema no resumo semanal, item da assessoria com a origem; ao cliente nada (o canal é interno)', async () => {
  const { montarResumoConsultor, montarUrgenteConsultor } = await import('../src/lib/consultor-discord.js')
  const s = { lido: true, resultado: [], comMedida: false, semMedido: [], familias: [], repetidas: [], curvaC: [], assessoria: [`• **${origemNome('ads_sem_retorno')} · Anúncios pagos sem retorno**: R$ 300 em 28 dias.`], enviados: [] }
  const t = montarResumoConsultor({ cliente: 'Acme', hoje: '2026-10-20', s, cfg: {} })
  for (const h of ['✅ **Merovíngio — o que rendeu**', '🔁 **Merovíngio — sem resultado medido, vale revisar antes de repetir**', '🔔 **Morpheus — pontos da assessoria**', '📲 **Morpheus — enviado ao cliente**']) assert.ok(t.includes(h), h)
  assert.match(t, /• \*\*Smith · Anúncios pagos sem retorno\*\*/); assert.match(t, /_Interno da equipe \(o cliente não vê este canal\) · Morpheus · Place Sprints_/)
  assert.match(montarUrgenteConsultor({ cliente: 'Acme', linhas: ['x'] }), /^\*\*Morpheus · Ponto da assessoria · Acme\*\*/)
  const sc = ler('scripts/resumo-time-discord.mjs')
  for (const [id, txt] of [['merovingio', 'o que rendeu'], ['morpheus', 'pontos da assessoria'], ['smith', 'custos e preço'], ['oraculo', 'previsão de estoque'], ['arquiteto', 'plano da semana']]) assert.match(sc, new RegExp(`secao\\('${id}', '${txt}`), `${id} — ${txt}`)
  assert.match(sc, /mencoes_obrigatorias/, 'as 3 menções obrigatórias continuam'); assert.match(ler('src/lib/dossie.js'), /📁 Morpheus · Prestação de contas mensal/)
})

await ok('textos ao CLIENTE byte a byte iguais (plano semanal, relatório focado, alerta de impacto) e só o Merovíngio assina', async () => {
  const { montarPlanoSemanal, montarRelatorioFoco, montarUrgente, ASSINATURA } = await import('../src/lib/plano-semana-texto.js')
  assert.equal(ASSINATURA, '*Merovíngio · Place Sprints | Equipe Place2u*')
  const L = { cobertura_critica_dias: 10, lead_time_reposicao_dias: 21, min_unidades_item: 3, min_impacto_pct_gmv: 2 }
  const LINK = id => `https://produto.mercadolivre.com.br/MLB-${id}-produto-_JM`
  const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: LINK(id), curva: 'A', status: 'active', cobertura: 5, estoque: 10, ponto_reposicao: 40, vel_dia: 2, logistica: '', r: 1400, u: 56, r0: 1000, u0: 40, v: 2000, v0: 1800, sug: { conservador: 20, base: 25 }, ...o })
  const itens = [it('1', { cobertura: 4, estoque: 8, logistica: 'fulfillment' }), it('2', { cobertura: 30, estoque: 60, sug: null })]
  const t = {
    plano: montarPlanoSemanal({ rotulo: 'Acme', hoje: '2026-10-20', resumo: { gmv: 20578.11, pedidos: 346, variacao_pct: 5.9 }, itens, custosInformados: false, limiares: L }).texto,
    foco: montarRelatorioFoco({ rotulo: 'Acme', hoje: '2026-10-20', itens, limiares: L }).texto,
    urgente: montarUrgente({ rotulo: 'Acme', itens: [{ tipo: 'estoque_zerado', texto: 'Produto 3 zerou o estoque.', impacto: { c: 500, b: 1000, dias: 14 } }, { tipo: 'envio_atrasado', texto: '2 pedidos com prazo de despacho vencido.' }] }).texto,
  }
  const h = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex').slice(0, 16)]))
  // fixado em 15/10/2026 ANTES da reestruturação por sistema: mudou o texto ao cliente? este teste falha de propósito
  assert.deepEqual(h, { plano: 'f5f1649cdd52a3a4', foco: '5df6c8654f776516', urgente: '8d7de1c7664f62d4' })
  const internos = SISTEMAS.filter(s => s.id !== 'merovingio').map(s => s.nome)
  for (const [k, v] of Object.entries(t)) { assert.ok(v.includes(ASSINATURA), `${k} assinado pelo Merovíngio`); for (const nm of internos) assert.ok(!v.includes(nm), `${k} sem «${nm}»`) }
})

await ok('telas internas: todo data-sistema existe no catálogo e bate com o inventário; /metodologia lista os 8; /diagnostico-motor do cliente sem selo', () => {
  const TELAS = { cliente: 'src/web/cliente.js', planos: 'src/web/planos.html', resultados: 'src/web/resultados.html', integracoes: 'src/web/integracoes.html', metodologia: 'src/web/metodologia.html' }
  for (const [inv, arq] of Object.entries(TELAS)) {
    const fonte = ler(arq), selos = [...fonte.matchAll(/class="sis" data-sistema="(\w+)" title="Sistema de origem: ([^"]+)">([^<]+)</g)]
    assert.ok(selos.length >= 4, `${arq}: selos`)
    for (const [, id, t1, t2] of selos) { assert.ok(IDS.includes(id), `${arq}: ${id}`); assert.equal(t1, sistema(id).nome); assert.equal(t2, sistema(id).nome) }
    const mapa = JSON.parse(ler(`docs/ux/inventario-${inv}.json`)).selos_sistema?.secoes || {}
    assert.deepEqual(Object.values(mapa), selos.map(s => s[1]), `${inv}: selos_sistema do inventário na ordem da tela`)
    for (const k of Object.keys(mapa).filter(k => k.startsWith('#'))) assert.ok(fonte.includes(`id="${k.slice(1)}"`), `${inv}: ${k} existe`)
  }
  const met = ler('src/web/metodologia.html'), lista = met.slice(met.indexOf('id="listaSistemas"'), met.indexOf('</ol>', met.indexOf('id="listaSistemas"')))
  assert.deepEqual([...lista.matchAll(/data-sistema="(\w+)"/g)].map(m => m[1]), IDS, '«Os 8 sistemas» na ordem do catálogo')
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  for (const s of SISTEMAS) assert.ok(lista.includes(esc(s.papel)) && lista.includes(esc(s.assina)), `${s.id}: papel e assinatura iguais ao catálogo`)
  const dm = ler('src/lib/render-diagnostico-motor.js')
  assert.match(dm, /const sis = id => cli \? '' :/, 'selo só na versão interna'); assert.equal((dm.match(/\$\{sis\('/g) || []).length, 11)
})

console.log(`\n${n} verificações dos 8 sistemas ok.`)
