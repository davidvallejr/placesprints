// Autoteste do diagnóstico/proposta das Ofertas (src/lib/ofertas-diagnostico.js). Spec §8; critérios 4, 7, 8. Puro: séries sintéticas, sem banco, sem rede.
// Rodar: node scripts/teste-ofertas-diagnostico.mjs
process.env.PS_DB_MEMORIA = '1'                               // o módulo é puro; se um import abrir banco, abre em memória
globalThis.fetch = () => { throw new Error('rede bloqueada no teste') }
import assert from 'node:assert/strict'
const { criarDiagnostico, ehPromocional, termosPromocionais } = await import('../src/lib/ofertas-diagnostico.js')

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const AGORA = () => '2026-10-07T12:00:00.000Z'
const dias = (qtd, f) => Array.from({ length: qtd }, (_, i) => ({ dia: `2026-09-${String(i + 1).padStart(2, '0')}`, ...f(i) }))
const item = { id: 'MLB1', titulo: 'Smartwatch W12 Mini Preto', preco: 100, estoque: 20, fotos: 3, criado_em: '2026-01-01', status: 'active', catalogo: 0 }
const regra = { comissao_pct: 12, tarifa_fixa: 0, base_comissao: 'receita', tributos_pct: 8, frete_vendedor: 0, desconto_pct: 0, promo_pct: 0, devolucao_pct: 0, ads_pct: null, margem_min_pct: 10, margem_alvo_pct: 20, fonte: 'cliente', consultado_em: '2026-10-01', validade: '2026-12-31' }
const custos = { custo_compra: 50, frete_entrada: 0, embalagem: 0, preparo: 0, outros: 0, fonte: 'manual' }
const ficha = {
  nome: 'Smartwatch', marca: '01Smart', modelo: 'W12 Mini', cor: 'Preto', quantidade_kit: 1, referencia_confirmada: true, descricao_atual: 'texto antigo',
  atributos: [
    { atributo_id: 'BRAND', nome: 'Marca', valor_atual: '01Smart', fonte: 'fabricante', evidencia: 'ficha do fabricante' },
    { atributo_id: 'MODEL', nome: 'Modelo', valor_atual: 'W12 Mini', fonte: 'fabricante', evidencia: 'caixa' },
    { atributo_id: 'COLOR', nome: 'Cor', valor_atual: '', valor_proposto: 'Preto', obrigatorio: 1, fonte: 'foto confirmada', evidencia: 'bases/CONFIRMACAO.json' },
    { atributo_id: 'SCREEN_SIZE', nome: 'Tamanho da tela', valor_atual: '', valor_proposto: '1.83', unidade: 'in', fonte: 'manual do produto', evidencia: 'p. 3' },
    { atributo_id: 'BATTERY_CAPACITY', nome: 'Bateria', valor_atual: '', valor_proposto: '260', unidade: 'mAh', fonte: 'manual' },          // sem evidência → não entra
    { atributo_id: 'MPN', nome: 'MPN', valor_atual: '', valor_proposto: 'Presente Dia das Crianças Menino', fonte: 'operação', evidencia: 'campanha' },   // critério 8 → reprovado
    { atributo_id: 'GTIN', nome: 'GTIN', valor_atual: '7890000000001', valor_proposto: '7890000000002', fonte: 'ERP', evidencia: 'Bling' },             // intocável → pendência
    { atributo_id: 'WATER_RESISTANCE', nome: 'Resistência à água', valor_atual: '', valor_proposto: 'IP67', editavel: 0, fonte: 'manual', evidencia: 'p. 5' }, // não editável
  ],
}

// ── critério 8: termos promocionais em identidade ────────────────────────────
ok('ehPromocional: campanha/sazonal/promessa/marca vetada detectados por palavra inteira, sem acento e sem caixa', () => {
  assert.equal(ehPromocional('Presente Dia das Crianças'), true)
  assert.equal(ehPromocional('PROMOÇÃO imperdivel'), true)
  assert.equal(ehPromocional('Kit presente para o dia dos pais'), true)
  assert.equal(ehPromocional('Compatível com Strava'), true)
  assert.equal(ehPromocional('aparece na primeira página'), true)
  assert.equal(ehPromocional('W12 Mini'), false)
  assert.equal(ehPromocional('Smartwatch Bluetooth 1.83 polegadas'), false)
  assert.equal(ehPromocional('topografia'), false, 'top dentro de topografia não conta')
  assert.equal(ehPromocional(''), false); assert.equal(ehPromocional(null), false)
  // valor volta ao original (refutação 10a/10): "top" do config segue vetado; só "top" peça de roupa (vizinho de peça, sem promessa colada) passa
  assert.deepEqual(termosPromocionais('oferta top nº 1'), ['oferta', 'top', 'nº 1'])
  assert.equal(ehPromocional('barato', ['caro']), false, 'lista customizada')
})

// ── baseline: ausência ≠ zero ────────────────────────────────────────────────
ok('baseline declara denominador, disponibilidade e não transforma ausência em zero', () => {
  const D = criarDiagnostico({ serie: dias(28, i => ({ unidades: i % 7 === 0 ? 1 : 0, receita: i % 7 === 0 ? 100 : 0 })), item, agora: AGORA })  // sem coluna visitas
  const b = D.baseline()
  assert.equal(b.visitas, null); assert.equal(b.disponibilidade.visitas, 'ausente')
  assert.equal(b.unidades, 4); assert.equal(b.receita, 400)
  assert.equal(b.conversao.valor, null); assert.equal(b.conversao.denominador, 'visitas'); assert.match(b.conversao.motivo, /visitas não coletadas/)
  assert.equal(b.ads, null); assert.equal(b.cancelamentos, null)
  assert.equal(b.produto_novo, false); assert.equal(b.periodo.dias, 28)
  const b2 = criarDiagnostico({ serie: dias(28, () => ({ visitas: 10, unidades: 0, receita: 0 })), item, agora: AGORA }).baseline()
  assert.equal(b2.visitas, 280); assert.equal(b2.conversao.valor, 0)
})
ok('baseline Ads declara base atribuída (CTR, ACOS, ROAS)', () => {
  const b = criarDiagnostico({ serie: [], ads: { prints: 5000, clicks: 25, custo: 50, receita: 200, unidades: 2 }, item, agora: AGORA }).baseline()
  assert.equal(b.ads.ctr_pct, 0.5); assert.equal(b.ads.acos_pct, 25); assert.equal(b.ads.roas, 4); assert.match(b.ads.base, /atribuída/)
})

// ── lentes com séries sintéticas ─────────────────────────────────────────────
const lentesDe = (serie, extra = {}, ctx = {}) => { const D = criarDiagnostico({ serie, item, agora: AGORA, ...extra }); const b = D.baseline(); return { D, b, d: D.diagnosticar(b, ctx) } }
ok('muitas impressões e poucos cliques (vs CTR da PRÓPRIA conta) → lente clique: capa/posicionamento; as outras lentes não herdam o sinal', () => {
  const { d } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads: { prints: 20000, clicks: 60, custo: 80, receita: 300, unidades: 3 } }, { ctr_conta: 1.5 })   // 0,3% < 1,5% × 0,6
  assert.equal(d.lentes.clique.sinal, 'muitas_impressoes_poucos_cliques'); assert.equal(d.lentes.clique.severidade, 'alta'); assert.match(d.lentes.clique.hipotese, /capa/)
  assert.equal(d.lentes.conversao.sinal, 'conversao_ok'); assert.equal(d.lentes.descoberta.sinal, 'descoberta_ok')
})
ok('visitas sem venda → lente conversão: preço/frete/prazo/confiança (não imagem)', () => {
  const { d } = lentesDe(dias(28, () => ({ visitas: 15, unidades: 0, receita: 0 })))
  assert.equal(d.lentes.conversao.sinal, 'visitas_sem_venda'); assert.match(d.lentes.conversao.hipotese, /preço, frete, prazo ou confiança/)
  assert.equal(d.lentes.clique.sinal, 'sem_dado', 'sem Ads não há CTR')
})
ok('sem estoque → viabilidade: não é imagem; conversão abaixo do benchmark da conta', () => {
  const { d } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 0.25, receita: 25 })), { item: { ...item, estoque: 0 } }, { benchmark_conv: 3 })
  assert.equal(d.lentes.viabilidade.sinal, 'sem_estoque'); assert.match(d.lentes.viabilidade.hipotese, /não se corrige com imagem/)
  assert.equal(d.lentes.conversao.sinal, 'conversao_abaixo_da_conta')
})
ok('poucas visitas → conversão sem leitura confiável; descoberta baixa', () => {
  const { d } = lentesDe(dias(28, i => ({ visitas: i < 10 ? 1 : 0, unidades: 0, receita: 0 })))
  assert.equal(d.lentes.conversao.severidade, 'sem_dado'); assert.equal(d.lentes.descoberta.sinal, 'pouca_descoberta')
})
ok('critério 4: sem custo a viabilidade é sem_dado (preço bloqueado) mas a qualidade/galeria seguem avaliadas', () => {
  const { d } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha })
  assert.equal(d.lentes.viabilidade.severidade, 'sem_dado'); assert.match(d.lentes.viabilidade.evidencia, /critério 4/)
  assert.equal(d.lentes.qualidade.sinal, 'qualidade_com_pendencias'); assert.match(d.lentes.qualidade.evidencia, /3 foto/)
})
ok('com custo e regra: margem estimada no preço atual, preço abaixo do piso sinalizado', () => {
  const { b, d } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 60 })), { item: { ...item, preco: 60 } }, { custos, regra })
  assert.equal(d.lentes.viabilidade.sinal, 'preco_abaixo_do_piso'); assert.equal(b.margem_estimada_pct, -3.33)
  const ok2 = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { custos, regra }).d
  assert.equal(ok2.lentes.viabilidade.sinal, 'margem_ok'); assert.equal(ok2.calculo_preco.margem_pct, 30)
})
ok('qualidade: termo promocional no MPN atual e referência não confirmada são severidade alta', () => {
  const f = { ...ficha, referencia_confirmada: false, atributos: [{ atributo_id: 'MPN', valor_atual: 'Presente Dia dos Pais' }] }
  const { d } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha: f })
  assert.equal(d.lentes.qualidade.severidade, 'alta'); assert.match(d.lentes.qualidade.evidencia, /MPN=/); assert.match(d.lentes.qualidade.evidencia, /critério 5/)
})
ok('prioridade por impacto: receita × gap até o benchmark da conta, com motivo explicado', () => {
  const { d } = lentesDe(dias(28, () => ({ visitas: 50, unidades: 1, receita: 100 })), {}, { benchmark_conv: 4 })   // conv 2% vs 4%: gap = 2% × 1400 visitas × R$100 = 2800
  assert.equal(d.prioridade.gap_receita, 2800); assert.equal(d.prioridade.receita, 2800); assert.equal(d.prioridade.score, 5600); assert.match(d.prioridade.motivo, /impacto = receita/)
})

// ── produto novo: estratégia inicial sem alegar histórico ────────────────────
ok('produto novo: lentes de desempenho sem_dado, estratégia "inicial", nenhuma frase de histórico', () => {
  const D = criarDiagnostico({ serie: [], item: { id: null, preco: null, estoque: 30 }, agora: AGORA })
  const b = D.baseline(); assert.equal(b.produto_novo, true)
  const d = D.diagnosticar(b, { ficha })
  for (const k of ['descoberta', 'clique', 'conversao']) { assert.equal(d.lentes[k].severidade, 'sem_dado'); assert.match(d.lentes[k].evidencia, /produto novo/) }
  assert.equal(d.prioridade.score, 0); assert.match(d.prioridade.motivo, /sem receita/)
  const p = D.proporProposta({ escopo: 'oferta_completa', objetivo: 'lancar', baseline: b, diagnostico: d, ficha })
  assert.equal(p.estrategia.tipo, 'inicial')
  const evid = JSON.stringify(p.mudancas.map(m => [m.evidencia, m.hipotese]))
  assert.ok(!/\d+ visitas|conversão \d|CTR Ads \d|unidades e/.test(evid), 'proposta não alega desempenho inexistente')
  assert.ok(p.mudancas.every(m => /produto novo|estratégia inicial/.test(m.evidencia + m.hipotese)), 'cada mudança declara que é estratégia inicial')
})

// ── critério 7: escopo 'ficha' NÃO altera título, preço, estoque nem imagens ─
ok("escopo 'ficha': só atributos com evidência; título/preço/galeria/descrição ausentes; MPN promocional reprovado; GTIN intocável; não editável vira pendência", () => {
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha, custos, regra })
  const p = D.proporProposta({ escopo: 'ficha', objetivo: 'corrigir_ficha', baseline: b, diagnostico: d, ficha, custos, regra })
  assert.equal(p.titulo, undefined); assert.equal(p.preco, undefined); assert.equal(p.galeria, undefined); assert.equal(p.descricao, undefined)
  assert.ok(p.mudancas.every(m => m.campo.startsWith('atributo:')), 'nenhuma mudança fora de atributos')
  assert.ok(!('estoque' in p), 'estoque nunca entra na proposta')
  assert.deepEqual(p.atributos.map(a => a.atributo_id), ['COLOR', 'SCREEN_SIZE'])
  assert.ok(p.pendencias.some(x => /MPN: REPROVADO/.test(x)), 'critério 8')
  assert.ok(p.pendencias.some(x => /GTIN: divergência/.test(x)))
  assert.ok(p.pendencias.some(x => /BATTERY_CAPACITY.*sem evidência/.test(x)))
  assert.ok(p.pendencias.some(x => /WATER_RESISTANCE: não editável/.test(x)))
  const m = p.mudancas[0]
  for (const k of ['campo', 'de', 'para', 'problema', 'evidencia', 'hipotese', 'acao', 'metrica', 'janela_dias', 'confusores']) assert.ok(k in m, k)
  assert.equal(m.janela_dias, 14); assert.ok(m.confusores.includes('estoque'))
})
ok("escopo 'preco' só traz preço (piso, margem, composição, simulação, bloqueios) e nada de ficha/título", () => {
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 60 })), { item: { ...item, preco: 60 } }, { ficha, custos, regra })
  const p = D.proporProposta({ escopo: 'preco', objetivo: 'preservar_margem', baseline: b, diagnostico: d, ficha, custos, regra })
  assert.equal(p.atributos, undefined); assert.equal(p.titulo, undefined)
  assert.equal(p.preco.piso, 71.43); assert.equal(p.preco.preco_proposto, 71.43); assert.equal(p.preco.margem_prevista_pct, 10.01)   // piso arredondado p/ cima: margem ≥ mínima
  assert.deepEqual(p.preco.bloqueios, []); assert.equal(p.preco.simulacao, false); assert.ok(p.preco.composicao.length > 3)
  assert.equal(p.mudancas.length, 1); assert.equal(p.mudancas[0].campo, 'preco'); assert.equal(p.mudancas[0].de, 60); assert.equal(p.mudancas[0].para, 71.43)
  // sem custo: pendência e nenhum preço
  const p2 = D.proporProposta({ escopo: 'preco', baseline: b, diagnostico: d, ficha, custos: null, regra })
  assert.equal(p2.preco, undefined); assert.ok(p2.pendencias.some(x => /custo ausente/.test(x)))
  const p3 = D.proporProposta({ escopo: 'preco', baseline: b, diagnostico: d, ficha, custos: { custo_compra: null }, regra })
  assert.equal(p3.preco.preco_proposto, null); assert.ok(p3.preco.bloqueios.includes('custo_ausente')); assert.equal(p3.preco.simulacao, true)
})
ok("escopo 'titulo_descricao': título ≤ 60, factual, sem termo vetado; descrição só com fatos com fonte (fonte por atributo)", () => {
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha })
  const f = { ...ficha, nome: 'Smartwatch Promoção Imperdível', atributos: [...ficha.atributos, { atributo_id: 'ACCESSORIES_INCLUDED', nome: 'Acessórios', valor_atual: 'cabo magnético, manual', fonte: 'caixa', evidencia: 'foto da caixa' }] }
  const p = D.proporProposta({ escopo: 'titulo_descricao', baseline: b, diagnostico: d, ficha: f })
  assert.ok(p.titulo.length <= 60); assert.equal(ehPromocional(p.titulo), false); assert.match(p.titulo, /01Smart W12 Mini Preto/)
  assert.ok(!p.titulo.includes('Promoção'))
  assert.match(p.descricao, /ESPECIFICAÇÕES/); assert.match(p.descricao, /Cor: Preto/); assert.match(p.descricao, /Tamanho da tela: 1.83 in/); assert.match(p.descricao, /CONTEÚDO DA EMBALAGEM/)
  assert.ok(!/Bateria/.test(p.descricao), 'atributo sem evidência fica fora da descrição')
  assert.ok(!/Presente/.test(p.descricao), 'valor promocional do MPN não vaza para a descrição')
  assert.equal(p.atributos, undefined); assert.equal(p.preco, undefined)
  const desc = p.mudancas.find(m => m.campo === 'descricao'); assert.ok(desc.fontes.every(x => x.fonte))
  assert.ok(!/ranking|indexa|mais vendas/i.test(JSON.stringify(p)), 'nenhuma promessa')
})
ok("escopo 'galeria' e 'imagem_avulsa': briefing por papel do canal, galeria vazia (imagens vêm do provedor), sem título/preço", () => {
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads: { prints: 20000, clicks: 60, custo: 80, receita: 300 } }, { ficha, ctr_conta: 1.5 })
  const g = D.proporProposta({ escopo: 'galeria', baseline: b, diagnostico: d, ficha })
  assert.deepEqual(g.galeria, []); assert.equal(g.titulo, undefined); assert.equal(g.preco, undefined)
  const m = g.mudancas.find(x => x.campo === 'galeria'); assert.equal(m.briefing.papeis.length, 7); assert.equal(m.briefing.texto_permitido.capa, false); assert.match(m.evidencia, /CTR Ads/)
  const a = D.proporProposta({ escopo: 'imagem_avulsa', baseline: b, diagnostico: d, ficha })
  assert.deepEqual(a.mudancas.find(x => x.campo === 'galeria').briefing.papeis, ['capa'])
  const s = D.proporProposta({ escopo: 'galeria', baseline: b, diagnostico: d, ficha, canal: 'amazon' })
  assert.ok(s.pendencias.some(x => /sem briefing/.test(x)))
})
ok('oferta_completa traz todos os blocos; estoque 0 vira a primeira pendência', () => {
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { item: { ...item, estoque: 0 } }, { ficha, custos, regra })
  const p = D.proporProposta({ escopo: 'oferta_completa', baseline: b, diagnostico: d, ficha, custos, regra, margem_alvo_pct: 20 })
  for (const k of ['titulo', 'descricao', 'atributos', 'preco', 'galeria']) assert.ok(k in p, k)
  assert.match(p.pendencias[0], /estoque 0/)
  assert.equal(p.preco.preco_proposto, 83.33)
})

// ── fase 5: preservação e corte silencioso (Trocar/Preservar) ────────────────
ok('montarTituloDetalhado: cor e kit que não cabem em 60 caracteres voltam em cortados; montarTitulo continua devolvendo só a string; a proposta registra a pendência', () => {
  const f = { nome: 'Smartwatch Esportivo Bluetooth Monitor Cardíaco Tela Grande', marca: '01Smart', modelo: 'W12 Mini', cor: 'Azul', quantidade_kit: 3, referencia_confirmada: true, atributos: [] }   // nome com 59 caracteres: nada mais cabe
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha: f })
  const t = D.montarTituloDetalhado(f)
  assert.equal(t.titulo, f.nome); assert.deepEqual(t.cortados, [{ campo: 'cor', valor: 'Azul' }, { campo: 'quantidade_kit', valor: 3 }])
  assert.equal(D.montarTitulo(f), f.nome)
  const p = D.proporProposta({ escopo: 'titulo_descricao', baseline: b, diagnostico: d, ficha: f })
  assert.equal(p.titulo, f.nome); assert.deepEqual(p.mudancas.find(m => m.campo === 'titulo').cortados, t.cortados)
  assert.ok(p.pendencias.some(x => /título não coube em 60 caracteres: cor \(Azul\), kit \(3\)/.test(x)), p.pendencias.join(' | '))
  assert.match(p.descricao, /VARIAÇÃO\nCor: Azul · Kit: 3 un/); assert.ok(!p.pendencias.some(x => /descrição não preserva/.test(x)), 'descrição gerada preserva a variação')
  // cabe tudo: nenhum cortado, nenhuma pendência de preservação; cor já no nome não é "cortada"
  const ok1 = D.montarTituloDetalhado({ ...f, nome: 'Smartwatch' }); assert.equal(ok1.titulo, 'Smartwatch 01Smart W12 Mini Azul Kit 3 un'); assert.deepEqual(ok1.cortados, [])
  const ok2 = D.montarTituloDetalhado({ nome: 'Smartwatch Esportivo Bluetooth Monitor Cardíaco Tela Azul', cor: 'Azul', atributos: [] }); assert.deepEqual(ok2.cortados, [], 'cor presente no nome não conta como corte')
  const p2 = D.proporProposta({ escopo: 'titulo_descricao', baseline: b, diagnostico: d, ficha: { ...f, nome: 'Smartwatch' } })
  assert.ok(!p2.pendencias.some(x => /preserva|não coube/.test(x)))
})
ok('catálogo de terceiros continua recusado para conteúdo: sem título/descrição, pendência do catálogo e nenhuma pendência de preservação', () => {
  const D = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, catalogo: 1 }, agora: AGORA })
  const b = D.baseline(); assert.equal(b.catalogo_origem, 'terceiros')
  const p = D.proporProposta({ escopo: 'titulo_descricao', baseline: b, diagnostico: D.diagnosticar(b, { ficha }), ficha: { ...ficha, cor: 'Azul', quantidade_kit: 3 } })
  assert.equal(p.titulo, undefined); assert.equal(p.descricao, undefined); assert.equal(p.mudancas.length, 0)
  assert.ok(p.pendencias.some(x => /CATÁLOGO|catálogo/i.test(x))); assert.ok(!p.pendencias.some(x => /preserva|não coube/.test(x)))
})

// ── achado 10: termo vetado sai sozinho do campo, o resto fica; campo preservado que perdeu algo volta em cortados com o motivo ──
ok('achado 10: "Top Fitness Nadador" preservado; "Presente Azul" vira "Azul" + cortados com motivo; promessa real continua cortada', () => {
  const f = { nome: 'Top Fitness Nadador', marca: 'Bee', modelo: 'TF1', cor: 'Preto', tamanho: 'M', atributos: [] }
  const { b, d, D } = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), {}, { ficha: f })
  const t1 = D.montarTituloDetalhado(f)
  assert.equal(t1.titulo, 'Top Fitness Nadador Bee TF1 Preto M'); assert.deepEqual(t1.cortados, [])
  assert.equal(ehPromocional('Top Cropped Canelado'), false, 'top peça de roupa não é promessa')
  const t2 = D.montarTituloDetalhado({ ...f, cor: 'Presente Azul' })
  assert.equal(t2.titulo, 'Top Fitness Nadador Bee TF1 Azul M')
  assert.deepEqual(t2.cortados, [{ campo: 'cor', valor: 'Presente Azul', motivo: 'termo vetado retirado: presente' }])
  const p2 = D.proporProposta({ escopo: 'titulo', baseline: b, diagnostico: d, ficha: { ...f, cor: 'Presente Azul' } })
  assert.ok(p2.pendencias.some(x => /título: cor \(Presente Azul\) — termo vetado retirado: presente/.test(x)), p2.pendencias.join(' | '))
  assert.ok(!p2.pendencias.some(x => /não coube|não preserva/.test(x)), 'motivo é o termo, não o tamanho; sem pendência duplicada')
  // promessa real continua cortada (palavra/frase inteira), o resto do campo fica
  for (const pr of ['top 1', 'Top1', 'TOP 10', 'top de linha', 'top vendas', 'super top', 'Mais Vendido', 'número 1']) assert.equal(ehPromocional(`Legging ${pr}`), true, pr)
  // valor mudou (refutação 10b): nome com termo vetado não é mais cortado palavra a palavra ("Legging Fitness" escondia a promessa); sai inteiro e fica registrado
  const t3 = D.montarTituloDetalhado({ ...f, nome: 'Legging Fitness Top 1 Mais Vendido', tamanho: 'Presente' })
  assert.equal(t3.titulo, 'Bee TF1 Preto'); assert.equal(ehPromocional(t3.titulo), false)
  assert.deepEqual(t3.cortados, [{ campo: 'nome', valor: 'Legging Fitness Top 1 Mais Vendido', motivo: 'contém termo vetado (top, mais vendido): fora do título, sem cortar palavra' },
    { campo: 'tamanho', valor: 'Presente', motivo: 'termo vetado retirado: presente' }])
})

// ── refutação do achado 10: "top" elogio segue vetado; nome/marca/modelo nunca adulterados; junção não forma termo vetado; sem sobra de pontuação ──
ok('refutação 10: proteção não afrouxa, identidade não é adulterada, título final conferido', () => {
  // 10a/10: elogio e promessa com "top" (títulos reais de saia/blusa/lenço/ferramenta + variantes) continuam vetados
  for (const s of ['Saia Junina Curta Juvenil Adulta Rodada Caipira São João Top', 'Saia Midi Chita Junina Quadrilha São João Xadrez Adulto Top', 'Blusa Punho Laise Malha Casual Manga Curta Solta Top',
    'Lenço De Cetim Liso 90x90 Multiformas Pescoço Camponesa Top Lisos', 'Chave Hidraulica Multifuncional 8 Em 1 Top Laranja', 'Vestido Floral Midi Top Demais', 'Legging Qualidade Top', 'Tênis Top Linha Masculino',
    'Legging Top Nº1', 'Legging Top N°1', 'Legging Top #1', 'Fone Top 5 Mais Pedidos', 'Top 100 do Brasil', 'Fone Qualidade Top', 'Cropped Top 1'])
    assert.deepEqual(termosPromocionais(s), ['top'], s)
  // "top" peça de roupa (títulos reais) passa
  for (const s of ['Conjunto Fitness Bee Top Cropped E Short Premium Feminino Preto Liso P', 'Roupa De Treino Academia Treino Corrida Premium Top Com Bojo Pink G', 'Conjunto Academia Feminino Zero Transparência Top E Shorts Rosa Liso G (42/44)',
    'Kit 3 Peças Macaquinho Top Short Feminino Fitness Premium Preto G', 'Conjunto Infantil Short e Top', 'Top Fitness Nadador', 'Top Cropped 10'])
    assert.equal(ehPromocional(s), false, s)
  const f = { nome: 'Smartwatch', marca: 'Bee', cor: 'Preto', atributos: [] }
  const D = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, titulo: 'Saia Junina Curta Juvenil Adulta Rodada Caipira São João Top' }, agora: AGORA })
  assert.match(D.diagnosticar(D.baseline(), { ficha: f }).lentes.qualidade.evidencia, /título com termo vetado: top/)
  const saia = D.montarTituloDetalhado({ nome: 'Saia Junina Rodada Caipira São João Top', marca: 'Bee', cor: 'Vermelho', tamanho: 'M', atributos: [] })
  assert.equal(saia.titulo, 'Bee Vermelho M'); assert.equal(saia.cortados[0].campo, 'nome')
  // 10b/10: nome/marca/modelo com termo vetado ficam fora INTEIROS e registrados (nunca "Papel de Kraft Mundo do")
  const papel = { nome: 'Papel de Presente Kraft', marca: 'Mundo do Presente', modelo: '70cm', cor: 'Pardo', atributos: [] }
  const tp = D.montarTituloDetalhado(papel)
  assert.equal(tp.titulo, '70cm Pardo')
  assert.deepEqual(tp.cortados.map(c => [c.campo, c.valor]), [['nome', 'Papel de Presente Kraft'], ['marca', 'Mundo do Presente']])
  const pp = D.proporProposta({ escopo: 'titulo', baseline: D.baseline(), diagnostico: D.diagnosticar(D.baseline(), { ficha: papel }), ficha: papel })
  assert.ok(pp.pendencias.some(x => /^título: nome \(Papel de Presente Kraft\) — contém termo vetado \(presente\)/.test(x)), pp.pendencias.join(' | '))
  assert.ok(pp.pendencias.some(x => /^título: marca \(Mundo do Presente\) — contém termo vetado \(presente\)/.test(x)), pp.pendencias.join(' | '))
  for (const [ficha, titulo] of [[{ nome: 'Caneca Porcelana', marca: 'Casa do Presente', modelo: 'CP10', cor: 'Branco' }, 'Caneca Porcelana CP10 Branco'], [{ nome: 'Pneu Aro 13', marca: 'Natal Pneus', modelo: 'X1' }, 'Pneu Aro 13 X1'],
    [{ nome: 'Camiseta', marca: 'Bee', modelo: 'Lançamento 2026', cor: 'Azul' }, 'Camiseta Bee Azul']]) {
    const r = D.montarTituloDetalhado({ ...ficha, atributos: [] })
    assert.equal(r.titulo, titulo); assert.equal(r.cortados.length, 1); assert.match(r.cortados[0].motivo, /fora do título, sem cortar palavra/)
  }
  // 10c/10: a junção dos campos nunca forma termo vetado; o campo que formaria fica fora e vira pendência
  const conj = { nome: 'Conjunto Infantil Short e Top', tamanho: '10', atributos: [] }
  const pc = D.proporProposta({ escopo: 'titulo', baseline: D.baseline(), diagnostico: D.diagnosticar(D.baseline(), { ficha: conj }), ficha: conj })
  assert.equal(pc.titulo, 'Conjunto Infantil Short e Top'); assert.equal(ehPromocional(pc.titulo), false)
  assert.ok(pc.pendencias.some(x => /^título: tamanho \(10\) — junto do texto anterior formaria termo vetado \(top\)/.test(x)), pc.pendencias.join(' | '))
  const cr = D.montarTituloDetalhado({ nome: 'Cropped Top', tamanho: '1', atributos: [] })
  assert.equal(cr.titulo, 'Cropped Top'); assert.deepEqual(cr.cortados.map(c => c.campo), ['tamanho'])
  // 10: retirar termo da variante não deixa parêntese vazio, separador dobrado nem conectivo solto (e segue registrado)
  for (const [cor, limpa] of [['Azul (Presente)', 'Azul'], ['Azul - Presente - Rosa', 'Azul - Rosa'], ['Azul/Presente/Rosa', 'Azul/Rosa'], ['Azul e Presente', 'Azul'], ['Presente Azul', 'Azul']]) {
    const r = D.montarTituloDetalhado({ nome: 'Caneca', marca: 'Bee', cor, atributos: [] })
    assert.equal(r.titulo, `Caneca Bee ${limpa}`, cor); assert.deepEqual(r.cortados, [{ campo: 'cor', valor: cor, motivo: 'termo vetado retirado: presente' }], cor)
  }
})

// ── sobras (08/10/2026): "top" elogio antes OU depois sempre vetado; peça de roupa pelo início do nome ou pela categoria/atributo de vestuário; título final conferido; pontuação limpa ──
ok('sobras "top": elogio depois ("Top Qualidade", "Top de Qualidade", "de verdade", "vendas") e antes ("Nº 1", "#1", "10", "Qualidade") vetados mesmo com peça vizinha e em vestuário', () => {
  const V = { vestuario: true }
  for (const s of ['Legging Top Qualidade', 'Cropped Top de Qualidade', 'Legging Top de Verdade', 'Legging Top Vendas', 'Top Qualidade', 'Top de Qualidade', 'Top Demais Feminino', 'Top 10 Fitness', 'Legging Top Nº 1',
    'Nº 1 Top Fitness', '#1 Top Cropped', '10 Top Fitness', 'Qualidade Top Fitness', 'Super Top Cropped', 'Conjunto Top de Linha'])
    for (const ctx of [{}, V]) assert.ok(termosPromocionais(s, null, ctx).includes('top'), `${s} ${JSON.stringify(ctx)}`)   // "nº 1" também é termo do config
  assert.equal(ehPromocional('Kit 3 Top Fitness'), false, 'número antes que não é 1/10 é quantidade')
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Legging Top Qualidade', 'Top de Qualidade Feminino', 'Cropped Top de Verdade']) {
    const r = D.montarTituloDetalhado({ nome, marca: 'Bee', cor: 'Preto', atributos: [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }] })
    assert.equal(r.titulo, 'Bee Preto', nome); assert.equal(r.cortados[0].campo, 'nome', nome); assert.match(r.cortados[0].motivo, /termo vetado \(top\)/, nome)
  }
})
ok('sobras "top": "Top Feminino/Esportivo/Academia/Canelado…" (o produto é o top) ficam no título inteiros; no meio do título só com categoria/atributo de vestuário; vestuário não solta "top" no fim nem com elogio', () => {
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Top Feminino Fitness Canelado', 'Top Esportivo com Bojo Removível', 'Top Academia Feminino Alça Fina', 'Top Canelado Alcinha Preto', 'Top Feminino'])
    for (const atributos of [[], [{ atributo_id: 'GARMENT_TYPE', valor_atual: '' }]]) {
      const r = D.montarTituloDetalhado({ nome, marca: 'Bee', tamanho: 'M', atributos })
      assert.equal(r.titulo, `${nome} Bee M`, nome); assert.deepEqual(r.cortados, [], nome)
    }
  const meio = { nome: 'Conjunto Top Canelado Feminino', marca: 'Bee', cor: 'Rosa' }
  assert.equal(D.montarTituloDetalhado({ ...meio, atributos: [] }).titulo, 'Bee Rosa', 'sem vestuário, "top" no meio sem peça vizinha segue vetado')
  for (const vest of [{ atributos: [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }] }, { atributos: [{ atributo_id: 'SLEEVE_TYPE', valor_atual: '' }] }, { atributos: [], categoria: 'Calçados, Roupas e Bolsas › Roupas Esportivas › Tops' }, { atributos: [], categoria: { nome: 'Moda Praia' } }])
    assert.equal(D.montarTituloDetalhado({ ...meio, ...vest }).titulo, 'Conjunto Top Canelado Feminino Bee Rosa', JSON.stringify(vest))
  for (const naoVest of [{ atributos: [], categoria: 'Calçados, Roupas e Bolsas › Tênis' }, { atributos: [{ atributo_id: 'SIZE_GRID_ID', valor_atual: '' }] }])
    assert.equal(D.montarTituloDetalhado({ ...meio, ...naoVest }).titulo, 'Bee Rosa', 'calçado (raiz "Roupas" ou tabela de medidas) não é vestuário: ' + JSON.stringify(naoVest))
  const G = { atributos: [{ atributo_id: 'GARMENT_TYPE', valor_atual: '' }] }
  assert.equal(D.montarTituloDetalhado({ nome: 'Saia Junina Rodada São João Top', marca: 'Bee', ...G }).titulo, 'Bee', 'vestuário: "top" no fim (elogio) segue vetado')
  assert.equal(D.montarTituloDetalhado({ nome: 'Conjunto Top Qualidade', marca: 'Bee', ...G }).titulo, 'Bee', 'vestuário: elogio segue vetado')
  assert.equal(D.montarTituloDetalhado({ nome: 'Chave Hidraulica 8 Em 1 Top Laranja', marca: 'Bee', atributos: [] }).titulo, 'Bee', 'fora de vestuário, no meio: vetado')
  // junção: campos limpos que juntos formam elogio ("…Top" + "Qualidade Brasil") → o campo fica fora; o título final nunca sai vetado
  const j = D.montarTituloDetalhado({ nome: 'Cropped Top', marca: 'Qualidade Brasil', cor: 'Preto', ...G })
  assert.equal(j.titulo, 'Cropped Top Preto'); assert.match(j.cortados.find(c => c.campo === 'marca').motivo, /junto do texto anterior formaria termo vetado \(top\)/)
  for (const f of [meio, { nome: 'Top Feminino', cor: 'Top 1' }, { nome: 'Short e Top', tamanho: '10' }, { nome: 'Top Cropped', marca: 'Super', cor: 'Top' }])
    for (const extra of [{ atributos: [] }, G]) { const t = D.montarTituloDetalhado({ ...f, ...extra }).titulo; assert.equal(ehPromocional(t, null, { vestuario: !!extra.atributos.length }), false, t) }   // título final (todos os campos juntos) conferido com a mesma regra
  // lente de qualidade usa a mesma regra: título atual "Top Feminino …" não é cobrado como termo vetado; "Legging Top Qualidade" é
  const lente = titulo => { const X = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, titulo }, agora: AGORA }); return X.diagnosticar(X.baseline(), { ficha: { nome: 'x', atributos: [] } }).lentes.qualidade.evidencia }
  assert.doesNotMatch(lente('Top Feminino Canelado Preto'), /termo vetado/); assert.match(lente('Legging Top Qualidade Preto'), /título com termo vetado: top/)
})
ok('sobras pontuação: retirar termo da variante não deixa "&", aspas nem "•"/"·" soltos; apóstrofo da palavra fica', () => {
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const [cor, limpa] of [['Azul & Presente', 'Azul'], ['Presente & Azul', 'Azul'], ['Azul & Presente & Rosa', 'Azul & Rosa'], ['"Presente" Azul', 'Azul'], ['Azul "Presente"', 'Azul'], ['"Azul Presente"', 'Azul'],
    ['“Presente” Azul', 'Azul'], ["Azul 'Presente'", 'Azul'], ['Azul • Presente', 'Azul'], ['Azul • Presente • Rosa', 'Azul • Rosa'], ['Azul · Presente', 'Azul'], ["Verde D'água Presente", "Verde D'água"]]) {
    const r = D.montarTituloDetalhado({ nome: 'Caneca', marca: 'Bee', cor, atributos: [] })
    assert.equal(r.titulo, `Caneca Bee ${limpa}`, cor); assert.deepEqual(r.cortados, [{ campo: 'cor', valor: cor, motivo: 'termo vetado retirado: presente' }], cor)
  }
})

// ── sobras 2 (08/10/2026, céticos): elogio separado por pontuação, elogio com qualificador/número por extenso, quantidade depois de "Kit", pontuação solta, identidade com o contexto ──
ok('sobras 2 "top": elogio separado por hífen/vírgula/dois-pontos/barra/parêntese, com qualificador ("de Alta Qualidade") ou por extenso ("Um", "Dez", "Número Um") é vetado com e sem vestuário; quantidade e peça seguem', () => {
  const V = { vestuario: true }, G = [{ atributo_id: 'GARMENT_TYPE', valor_atual: '' }]
  const vetados = ['Top-Qualidade Feminino', 'Top - Qualidade Feminino', 'Top: Qualidade Feminino', 'Top, de Qualidade', 'Top/Qualidade Fone', 'Top-de-Linha Fone Bluetooth', 'Cropped Top-Qualidade', 'Cropped Top, de Verdade',
    'Super-Top Cropped', 'Top Venda Fone Bluetooth', 'Top Seller Fone Bluetooth', 'Top da Linha Fone', 'Top Número Um Feminino', 'Top-Qualidade Legging', 'Legging Top-Qualidade', 'Top (Qualidade) Feminino', 'Top/Qualidade Fitness',
    'Legging Top, Qualidade', 'Legging Top: Qualidade', 'Cropped Top - Qualidade', 'Qualidade-Top Cropped', 'Qualidade-Top Feminino', 'Top de Alta Qualidade Feminino', 'Top Alta Qualidade', 'Top Ótima Qualidade', 'Top Dez Fitness',
    'Top Um Feminino', 'Top Numero Um', 'Top Primeiro Lugar', 'Top-10 Fones']
  for (const s of vetados) for (const ctx of [{}, V]) assert.ok(termosPromocionais(s, null, ctx).includes('top'), `${s} ${JSON.stringify(ctx)}`)
  for (const s of ['Kit 10 Top Fitness', 'Kit 1 Top Fitness', 'Kit 2 Top Fitness', 'Kit 3 Top Fitness', 'Short e Top, 2 Peças', 'Top Cropped 10', 'Top Um Ombro Só', 'Top Uma Alça Canelado'])
    for (const ctx of [{}, V]) assert.equal(ehPromocional(s, null, ctx), false, `${s} ${JSON.stringify(ctx)}`)
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Top-Qualidade Fone Bluetooth', 'Top-de-Linha Fone Bluetooth', 'Cropped Top-Qualidade', 'Legging Top, Qualidade', 'Cropped Top/De Verdade', 'Top de Alta Qualidade Feminino', 'Top Dez Fitness'])
    for (const atributos of [[], G]) {
      const r = D.montarTituloDetalhado({ nome, marca: 'Bee', atributos })
      assert.equal(r.titulo, 'Bee', nome); assert.match(r.cortados[0].motivo, /termo vetado \(.*top.*\)/, nome)
    }
  for (const nome of ['Kit 10 Top Fitness', 'Kit 1 Top Fitness']) for (const atributos of [[], G]) assert.equal(D.montarTituloDetalhado({ nome, marca: 'Bee', atributos }).titulo, `${nome} Bee`, nome)
  const lente = titulo => { const X = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, titulo }, agora: AGORA }); return X.diagnosticar(X.baseline(), { ficha: { nome: 'x', atributos: G } }).lentes.qualidade.evidencia }
  for (const t of ['Top-Qualidade Legging Preto', 'Legging Top - Qualidade Preto', 'Top de Alta Qualidade Feminino']) assert.match(lente(t), /título com termo vetado: top/, t)
  assert.doesNotMatch(D.montarDescricao({ nome: 'Legging', descricao_base: 'Legging Top-Qualidade para academia.', atributos: G }).texto, /Top-Qualidade/)
})
ok('sobras 2 pontuação: "!", "*", "★", "~", "=", ">", "✓", ".", aspa baixa, e "&"/"•"/aspas/"p/" dentro de parênteses/colchetes não sobram ao retirar o termo da variante (cor e tamanho)', () => {
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const [v, limpa] of [['Rosa (Top de Linha!)', 'Rosa'], ['Rosa (Presente!)', 'Rosa'], ['Rosa - Top de Linha!', 'Rosa'], ['Rosa * Presente *', 'Rosa'], ['Rosa ★ Presente', 'Rosa'], ['Rosa — Presente.', 'Rosa'],
    ['Rosa ~ Presente', 'Rosa'], ['Rosa = Presente', 'Rosa'], ['Rosa > Presente', 'Rosa'], ['Rosa ✓ Presente', 'Rosa'], ['Rosa „Presente“', 'Rosa'], ['Rosa (Natal & Presente)', 'Rosa'], ['Rosa (Presente • Natal)', 'Rosa'],
    ['Rosa ("Presente")', 'Rosa'], ['Rosa ("Natal" & "Presente")', 'Rosa'], ['Rosa [Natal & Presente]', 'Rosa'], ['Rosa (Ideal p/ Presente)', 'Rosa (Ideal)'], ['Rosa e/ou Presente', 'Rosa'], ['Rosa (Claro) Presente', 'Rosa (Claro)'],
    ['Rosa - ! Presente Azul', 'Rosa - Azul'], ['Rosa 10% Presente', 'Rosa 10%']])
    for (const campo of ['cor', 'tamanho']) assert.equal(D.montarTituloDetalhado({ nome: 'Caneca', marca: 'Bee', [campo]: v, atributos: [] }).titulo, `Caneca Bee ${limpa}`, `${campo}: ${v}`)
})
ok('sobras 2 identidade: o contexto de vestuário vale também para MODEL/LINE/BRAND (lente de qualidade e proposta de ficha); sem vestuário, segue vetado', () => {
  const G = { atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }
  const ficha = { nome: 'Conjunto Top Canelado Feminino', marca: 'Bee', atributos: [G, { atributo_id: 'MODEL', valor_atual: 'Conjunto Top Canelado', fonte: 'canal' }, { atributo_id: 'LINE', valor_proposto: 'Conjunto Top Canelado', fonte: 'cliente', evidencia: 'ficha do fornecedor' }] }
  const X = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, titulo: 'Conjunto Top Canelado Feminino Bee' }, agora: AGORA }), b = X.baseline()
  const d = X.diagnosticar(b, { ficha })
  assert.doesNotMatch(d.lentes.qualidade.evidencia, /campo de identidade/); assert.ok(!X.proporProposta({ escopo: 'ficha', baseline: b, diagnostico: d, ficha }).pendencias.some(p => /REPROVADO/.test(p)))
  const semV = { ...ficha, atributos: ficha.atributos.filter(a => a !== G) }, d2 = X.diagnosticar(b, { ficha: semV })
  assert.match(d2.lentes.qualidade.evidencia, /termo promocional em campo de identidade: MODEL="Conjunto Top Canelado"/)
  assert.ok(X.proporProposta({ escopo: 'ficha', baseline: b, diagnostico: d2, ficha: semV }).pendencias.includes('LINE: REPROVADO — termo promocional em campo de identidade (top)'))
})

// ── motor-res (08/10/2026, A2/A3/A4): "top" abrindo o texto só é peça com contexto de moda; elogios novos; quantidade antes do "top"; sobras no meio ──
ok('motor-res A2: "Top" abrindo o texto seguido de palavra desconhecida volta a ser vetado (peça só com moda/peça vizinha/ficha de vestuário); elogios novos vetados em qualquer contexto', () => {
  const V = { vestuario: true }
  for (const s of ['Top Best Seller Fone', 'Top Quality', 'Top de Primeira', 'Top Sucesso de Vendas', 'Top Campeão de Vendas', 'Top Nr 1', 'Top Nr. 1', 'Top Premium', 'Top Bestseller', 'Top Best-Seller', 'Top Superior', 'Top Absoluto',
    'Top Líder', 'Top Número 1', 'Legging Top Premium', 'Top Quality Legging', 'Top Premium Feminino', 'Top Líder de Vendas Cropped'])
    for (const ctx of [{}, V]) assert.ok(termosPromocionais(s, null, ctx).includes('top'), `${s} ${JSON.stringify(ctx)}`)
  for (const s of ['Top Laranja', 'Top Xyz Azul', 'Top Gold']) { assert.equal(ehPromocional(s), true, `${s} sem contexto de vestuário`); assert.equal(ehPromocional(s, null, V), false, `${s} com ficha de vestuário`) }
  for (const s of ['Top Feminino', 'Top Laranja Feminino', 'Top Um Ombro Só', 'Top Esportivo Rosa', 'Top Canelado Preto', 'Top de Alça Fina', 'Roupa De Treino Premium Top Com Bojo Pink G', 'Top Fitness Nadador'])
    assert.equal(ehPromocional(s), false, s)   // "Premium Top Com Bojo" é a peça premium, não elogio
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Top Quality Fone', 'Top Best Seller Fone', 'Top Premium Feminino', 'Top Laranja']) { const r = D.montarTituloDetalhado({ nome, marca: 'Bee', atributos: [] }); assert.equal(r.titulo, 'Bee', nome); assert.match(r.cortados[0].motivo, /termo vetado \(.*top.*\)/, nome) }
  assert.equal(D.montarTituloDetalhado({ nome: 'Top Laranja', marca: 'Bee', atributos: [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }] }).titulo, 'Top Laranja Bee', 'com a ficha de vestuário o nome fica inteiro')
  assert.ok(D.montarTituloDetalhado({ nome: 'Top Premium', marca: 'Bee', atributos: [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }] }).cortados.length, 'elogio segue vetado mesmo em vestuário')
})
ok('motor-res A3: número antes do "top" é quantidade com kit/conjunto/lote/pack/par antes ou depois de "+", ",", "e", "com"; sem esse contexto é ranking; o nome não some do título', () => {
  for (const s of ['Kit 1 Legging + 1 Top Fitness', 'Kit Legging + 1 Top Fitness', 'Conjunto Legging e 1 Top Fitness', 'Kit 2 Legging + 10 Top Fitness', 'Kit Short + 1 Top', 'Lote 10 Top Fitness', 'Pack 2 Top Fitness', 'Legging, 1 Top', 'Legging com 1 Top', 'Par de Meias + 1 Top Fitness', 'Kit 3 Top Fitness'])
    for (const ctx of [{}, { vestuario: true }]) assert.equal(ehPromocional(s, null, ctx), false, `${s} ${JSON.stringify(ctx)}`)
  for (const s of ['Top 1 em vendas', 'Top 10 do mês', '10 Top Fitness', '1 Top Fitness', 'Legging 10 Top', 'Kit Legging Top 1', 'Kit Legging Top 10']) assert.equal(ehPromocional(s), true, s)
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Kit 1 Legging + 1 Top Fitness', 'Kit Short + 1 Top', 'Lote 10 Top Fitness', 'Conjunto Legging e 1 Top Fitness']) { const r = D.montarTituloDetalhado({ nome, marca: 'Bee', atributos: [] }); assert.equal(r.titulo, `${nome} Bee`, nome); assert.deepEqual(r.cortados, [], nome) }
})
ok('motor-res A4: retirar o termo da variante não deixa pontuação solta no meio, pontuação colada ao buraco, conectivo dobrado nem espaço antes de vírgula — também dentro de parênteses/colchetes', () => {
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const [v, limpa] of [['Rosa Presente! Azul', 'Rosa Azul'], ['Rosa Presente, Azul', 'Rosa, Azul'], ['Rosa Presente; Azul', 'Rosa; Azul'], ['Rosa Presente. Azul', 'Rosa Azul'], ['Rosa Presente* Azul', 'Rosa Azul'], ['*Presente*', ''], ['Presente, Azul', 'Azul'],
    ['e Presente e Azul', 'Azul'], ['Azul ou Presente ou Rosa', 'Azul ou Rosa'], ['Azul com Presente com Rosa', 'Azul com Rosa'], ['Azul e Presente e Rosa', 'Azul e Rosa'], ['Rosa (e Presente e Azul)', 'Rosa (Azul)'], ['Rosa [Azul ou Presente ou Verde]', 'Rosa [Azul ou Verde]'],
    ['Rosa (Presente! Azul)', 'Rosa (Azul)'], ['Rosa ★ Presente ★ Azul', 'Rosa Azul'], ['Rosa (Azul Presente, Verde)', 'Rosa (Azul, Verde)'], ['Rosa - Presente - Azul', 'Rosa - Azul'], ['Rosa & Presente & Azul', 'Rosa & Azul']])
    for (const campo of ['cor', 'tamanho']) assert.equal(D.montarTituloDetalhado({ nome: 'Caneca', marca: 'Bee', [campo]: v, atributos: [] }).titulo, `Caneca Bee${limpa ? ' ' + limpa : ''}`, `${campo}: ${v}`)
})

// ── motor-res, reprodução do cético (08/10/2026): "top" contado no FIM ("Kit 3 Top"), elogio com preposição ("Top nas Vendas"), vocabulário de top sem ficha, sobras no meio ──
ok('cético A3: "top" no fim do texto depois de quantidade de kit é peça ("Kit 3 Top", "Par de Meias + 1 Top", "Kit c/ 2 Top"): nome inteiro no título com e sem ficha; elogio depois da quantidade e número sem contexto seguem vetados', () => {
  const V = { vestuario: true }, G = [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }]
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const s of ['Kit 3 Top', 'Lote 10 Top', 'Kit c/ 2 Top', 'Kit 10 Top', 'Combo 1 Top', 'Conjunto de 2 Top', 'Par de Meias + 1 Top', 'Legging + 1 Top', 'Legging, 1 Top', 'Legging com 1 Top']) {
    for (const ctx of [{}, V]) assert.equal(ehPromocional(s, null, ctx), false, `${s} ${JSON.stringify(ctx)}`)
    for (const atributos of [[], G]) { const r = D.montarTituloDetalhado({ nome: s, marca: 'Bee', atributos }); assert.equal(r.titulo, `${s} Bee`, s); assert.deepEqual(r.cortados, [], s) }
  }
  for (const s of ['Kit 3 Top Qualidade', 'Kit 3 Top 1', 'Kit 3 Top de Linha', 'Kit 3 Top Premium', '3 Top', '10 Top', 'Legging 3 Top', 'Legging em 1 Top']) for (const ctx of [{}, V]) assert.ok(termosPromocionais(s, null, ctx).includes('top'), `${s} ${JSON.stringify(ctx)}`)
})
ok('cético A2: elogio com preposição ("Top nas/das Vendas", "Top com/na/pela Qualidade") vetado com e sem vestuário e cobrado pela lente de qualidade; vocabulário comum de top ("Sem Bojo", "Alto Impacto", "Triângulo", "Dry Fit", "Frente Única", "Floral", "Kit Top Feminino + Legging") fica no título sem ficha; cor sem ficha segue vetada', () => {
  const V = { vestuario: true }, G = [{ atributo_id: 'GARMENT_TYPE', valor_atual: 'Top' }]
  for (const s of ['Top nas Vendas', 'Top das Vendas', 'Top com Qualidade', 'Top com Qualidade Superior', 'Top na Qualidade', 'Top pela Qualidade', 'Top por Qualidade', 'Top nos Mais Vendidos', 'Top em Vendas', 'Legging Top nas Vendas', 'Top das Vendas Feminino'])
    for (const ctx of [{}, V]) assert.ok(termosPromocionais(s, null, ctx).includes('top'), `${s} ${JSON.stringify(ctx)}`)
  const lente = titulo => { const X = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item: { ...item, titulo }, agora: AGORA }); return X.diagnosticar(X.baseline(), { ficha: { nome: 'x', atributos: G } }).lentes.qualidade.evidencia }
  for (const t of ['Top nas Vendas Feminino Preto', 'Top com Qualidade Superior Preto', 'Legging Top das Vendas', 'Top em Vendas Preto']) assert.match(lente(t), /título com termo vetado: top/, t)
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const nome of ['Top Sem Bojo', 'Top Com Bojo', 'Top Alto Impacto', 'Top Médio Impacto', 'Top Triângulo', 'Top Cortininha', 'Top Dry Fit', 'Top Frente Única', 'Top Floral', 'Top Compressão', 'Top Sem Costura', 'Kit Top Feminino + Legging', 'Kit Top Feminino e Short'])
    for (const atributos of [[], G]) { const r = D.montarTituloDetalhado({ nome, marca: 'Bee', atributos }); assert.equal(r.titulo, `${nome} Bee`, nome); assert.deepEqual(r.cortados, [], nome) }
  // cor não é vocabulário de top (vem da ficha): sem ficha de vestuário segue vetado, como "Top Laranja"; com a ficha, inteiro
  assert.equal(D.montarTituloDetalhado({ nome: 'Top Preto', marca: 'Bee', atributos: [] }).titulo, 'Bee'); assert.equal(D.montarTituloDetalhado({ nome: 'Top Preto', marca: 'Bee', atributos: G }).titulo, 'Top Preto Bee')
  // vocabulário de moda entre o "top" e a peça só vale DEPOIS do top: "Legging Feminina Top" (dúvida no fim) e "Conjunto Top Canelado Feminino" (meio, sem peça vizinha) seguem vetados sem ficha
  assert.equal(ehPromocional('Legging Feminina Top'), true); assert.equal(ehPromocional('Conjunto Top Canelado Feminino'), true); assert.equal(ehPromocional('Top Feminino Qualidade Brasil'), false, 'elogio não colado ao top não é do top (inalterado)')
})
ok('cético A4: sobra no meio depois de retirar o termo da variante — espaço antes de ":" "/" "&", conectivo colado ao buraco junto da vírgula, preposição órfã ("de Presente de"), e "%" solto legítimo fica', () => {
  const D = criarDiagnostico({ serie: [], item: { id: 'MLB1' }, agora: AGORA })
  for (const [v, limpa] of [['Rosa Presente: Azul', 'Rosa: Azul'], ['Rosa Presente/Azul', 'Rosa/Azul'], ['Rosa Presente&Azul', 'Rosa&Azul'], ['Azul/Presente Rosa', 'Azul/Rosa'], ['Rosa, Presente e Azul', 'Rosa, Azul'], ['Rosa e Presente, Azul', 'Rosa, Azul'],
    ['Rosa Presente e Azul', 'Rosa e Azul'], ['Azul de Presente de Rosa', 'Azul Rosa'], ['Azul para Presente Rosa', 'Azul Rosa'], ['Caixa de Presente Rosa', 'Caixa Rosa'], ['Rosa de Natal e de Presente Azul', 'Rosa Azul'], ['Rosa 100 % Algodão Presente', 'Rosa 100 % Algodão'],
    ['Rosa (Azul de Presente)', 'Rosa (Azul)'], ['Rosa e Presente/Azul', 'Rosa/Azul'], ['Rosa (Presente de Natal)', 'Rosa'], ['Rosa ou Presente, Azul', 'Rosa, Azul'], ['Rosa 37 °C Presente', 'Rosa 37 °C']])
    for (const campo of ['cor', 'tamanho']) assert.equal(D.montarTituloDetalhado({ nome: 'Caneca', marca: 'Bee', [campo]: v, atributos: [] }).titulo, `Caneca Bee${limpa ? ' ' + limpa : ''}`, `${campo}: ${v}`)
})

// ── fase 6: CTR sem limiar universal — referência = CTR da própria conta × ads_ctr_vs_conta_baixo (config/algoritmo.json) ──
ok('lente clique: CTR da conta 1,5% e CTR do anúncio 0,7% → baixo; 1,0% → ok; sem CTR da conta → sem_dado (nenhum 0,8% universal)', () => {
  const ads = { prints: 20000, clicks: 140, custo: 80, receita: 300 }   // CTR 0,7%
  const baixo = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads }, { ctr_conta: 1.5 }).d.lentes.clique
  assert.equal(baixo.sinal, 'muitas_impressoes_poucos_cliques'); assert.match(baixo.evidencia, /CTR Ads 0.7% .* vs 1.5% da conta \(referência 0.6× = 0.9%\)/)
  const okc = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads: { ...ads, clicks: 200 } }, { ctr_conta: 1.5 }).d.lentes.clique
  assert.equal(okc.sinal, 'clique_ok')
  const sem = lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads }).d.lentes.clique
  assert.equal(sem.severidade, 'sem_dado'); assert.match(sem.evidencia, /CTR da conta não disponível/); assert.ok(!/0\.8/.test(sem.evidencia))
  assert.equal(lentesDe(dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), { ads }, { ctr_conta: null }).d.lentes.clique.severidade, 'sem_dado')
})

// ── IA opcional: explica, não calcula; sem função → template determinístico ──
const D0 = criarDiagnostico({ serie: dias(28, () => ({ visitas: 20, unidades: 1, receita: 100 })), item, agora: AGORA })
const b0 = D0.baseline(), d0 = D0.diagnosticar(b0, { ficha, custos, regra })
const p0 = D0.proporProposta({ escopo: 'ficha', baseline: b0, diagnostico: d0, ficha })
const e1 = await D0.explicar(p0)
assert.equal(e1.origem, 'deterministico'); assert.match(e1.texto, /Escopo ficha/); n++
let promptVisto = ''
const e2 = await D0.explicar(p0, { ia: async prompt => { promptVisto = prompt; return 'Texto da IA com os fatos.' } })
assert.equal(e2.origem, 'ia'); assert.match(promptVisto, /não calcule preço/); assert.ok(!/custo_compra/.test(promptVisto), 'IA não recebe custos'); n++
const e3 = await D0.explicar(p0, { ia: async () => 'Garantimos primeira página e mais vendas' })
assert.equal(e3.origem, 'deterministico'); assert.match(e3.motivo, /promessa/); n++
const e4 = await D0.explicar(p0, { ia: async () => { throw new Error('401') } })
assert.equal(e4.origem, 'deterministico'); assert.match(e4.motivo, /indisponível/); n++

console.log(`teste-ofertas-diagnostico: ${n} verificações OK`)
