// Autoteste do avaliador único de pendências do cliente por canal (src/lib/pendencias-cliente.js + config/dependencias-cliente.json): catálogo válido e limpo
// pelo auditor, cada fonte (medido ML / tarefa / registro), gravidade, os 3 métodos de impacto (nunca zero; Shopee/Amazon/TikTok/Magalu nunca têm R$),
// classificação pelo tipo REGISTRADO (nunca pelo texto), anúncio de catálogo fora de mídia/dados, registro e resolução, isolamento por cliente, datas aproximadas
// e a regra `pendencia_cliente` do plano (≤ 5 ações, sem duplicar bloqueio_cliente). Banco em memória + stubs: nada de Notion, ML ou data/db.sqlite.
// Rodar: node scripts/teste-pendencias-cliente.mjs
process.env.PS_DB_MEMORIA = '1'   // o db.js (plano) só entra por import() dinâmico, com o banco em memória e o schema inteiro
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validarCatalogo, nomeCurto, sugestaoTipo, canalDaTarefa, GRAVIDADES, SCHEMA_PENDENCIAS } from '../src/lib/pendencias-cliente.js'
import { TIPOS } from '../src/lib/dependencia-cliente.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'
import { montar, tarefa, itemMl, baseMl, catalogoReal, HOJE, QUEM, dia } from './fixtures/pendencias-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const lerJson = () => JSON.parse(readFileSync(new URL('../config/dependencias-cliente.json', import.meta.url), 'utf8'))
const falha = (fn, rx, status = 400) => { let e; try { fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); assert.match(e.message, rx); if (status) assert.equal(e.status, status); return e.message }
const pega = (r, item, canal) => r.itens.find(p => p.item === item && (!canal || p.canal === canal))
const CAMPOS = ['por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos']

await ok('catálogo: 16 itens com ids estáveis, tipo ∈ TIPOS, canais, deteccao e método válidos; limiares exatos; 4 tipos novos em TIPOS', () => {
  const c = catalogoReal()
  assert.deepEqual(Object.keys(c.itens), ['estoque_curva_a', 'preco_custo', 'midia_produto', 'dados_produto', 'resposta_solicitacoes', 'regulatorio', 'documentos_conta', 'acesso_conta',
    'despacho_prazo', 'verba_ads', 'remessa_fba_full', 'aprovacoes', 'atendimento_sac', 'prazo_fornecedor', 'estoque_espelhado', 'retorno_pendente'])
  for (const [id, it] of Object.entries(c.itens)) {
    assert.ok(Object.hasOwn(TIPOS, it.tipo), id); assert.ok(['medido', 'tarefa', 'registro'].includes(it.deteccao), id); assert.ok(['ruptura_receita', 'acoes_paradas', 'nenhum'].includes(it.metodo_impacto), id)
    assert.ok(it.canais.every(k => ['ml', 'shopee', 'amazon', 'tiktok', 'magalu'].includes(k)), id); assert.ok(GRAVIDADES.includes(it.gravidade_base), id)
  }
  assert.deepEqual(c.limiares.estoque, { cobertura_atencao_dias: 10, cobertura_critica_dias: 5, curvas_alerta: ['A'], curvas_avaliar: ['A', 'B'], unidades_min_28d: 5, frescor_max_horas: 30 })
  assert.equal(c.itens.estoque_curva_a.metodo_impacto, 'ruptura_receita'); assert.deepEqual(c.itens.estoque_curva_a.medido_em, ['ml'])
  assert.deepEqual(['documentos', 'regulatorio', 'logistica', 'atendimento'].map(k => TIPOS[k]),
    ['Documentos e validação da conta', 'ANVISA, INMETRO ou categoria restrita', 'Remessa, despacho ou estoque no canal', 'Atendimento ao comprador'])
  assert.match(SCHEMA_PENDENCIAS, /CREATE TABLE IF NOT EXISTS pendencia_cliente/); assert.match(SCHEMA_PENDENCIAS, /ix_pendencia_cliente ON pendencia_cliente \(cliente, resolvida_em\)/)
})

await ok('catálogo: TODO texto ao cliente (4 templates × canal, rótulo, parado) passa pelo auditor; validar na carga recusa token, tipo, canal, promessa e item faltando', () => {
  const c = catalogoReal()
  let textos = 0
  for (const [id, it] of Object.entries(c.itens)) {
    const lista = [it.rotulo, it.parado, ...CAMPOS.flatMap(k => typeof it[k] === 'string' ? [it[k]] : Object.values(it[k]))]
    for (const t of lista) { textos++; const v = auditarTexto(t.replace(/\{produtos\}/g, 'Produto A').replace(/\{n\}/g, '3').replace(/\{canal\}/g, 'Shopee').replace(/\{dias\}/g, '9')); assert.deepEqual(v, [], `${id}: ${t.slice(0, 60)}`) }
    assert.ok(!/Sprints|notion|sync|score|garant|ranking|certeza/i.test(lista.join(' ')), id)
  }
  assert.ok(textos > 70, `textos auditados: ${textos}`)
  const mut = f => { const x = lerJson(); f(x); return x }
  falha(() => validarCatalogo(mut(x => { x.itens.preco_custo.o_que_precisamos = 'Para seguirmos, precisamos de {produtos} em {prazo_final} agora mesmo.' }), {}), /token \{prazo_final\} desconhecido/, 0)
  falha(() => validarCatalogo(mut(x => { x.itens.preco_custo.tipo = 'inventado' })), /tipo fora de TIPOS/, 0)
  falha(() => validarCatalogo(mut(x => { x.itens.preco_custo.canais = ['ml', 'olx'] })), /canais inválidos/, 0)
  falha(() => validarCatalogo(mut(x => { delete x.itens.retorno_pendente })), /retorno_pendente/, 0)
  falha(() => validarCatalogo(mut(x => { x.itens.midia_produto.por_que_importa = { padrao: 'Imagens boas dão resultado garantido e ranking alto no canal para os produtos.' } }), { auditar: auditarTexto }), /reprovado pelo auditor/, 0)
  falha(() => validarCatalogo(mut(x => { x.itens.dados_produto.o_que_fazemos = { padrao: 'Quando recebermos, cadastramos os anúncios conforme as informações enviadas.', ml2: 'x'.repeat(30) } })), /canal "ml2" fora do item/, 0)
  falha(() => validarCatalogo(mut(x => { x.limiares.estoque.cobertura_critica_dias = 30 })), /crítica não pode ser maior/, 0)
})

await ok('medido · estoque: A/B abaixo de 10 dias com ≥ 5 un/28d; crítico só com curva A < 5 dias e leitura fresca; C, pausado com estoque, sem cobertura e volume baixo ficam fora', () => {
  const A = itemMl({ titulo: 'Tênis Corrida MLB1234567890 Azul Marinho Edição Especial Verão 2026', cobertura: 3, estoque: 3, r: 2800 })
  const B = itemMl({ curva: 'B', cobertura: 8, estoque: 8, r: 700, u: 28 })
  const fora = [itemMl({ curva: 'C', cobertura: 1 }), itemMl({ status: 'paused', estoque: 4, cobertura: 2 }), itemMl({ cobertura: null }), itemMl({ cobertura: 2, u: 4 }), itemMl({ cobertura: 12 }), itemMl({ status: 'closed', cobertura: 1, estoque: 1 })]
  const { p } = montar({ base: baseMl([A, B, ...fora]) })
  const r = p.avaliar('Acme', { hoje: HOJE })
  const e = pega(r, 'estoque_curva_a', 'ml')
  assert.deepEqual([e.fonte, e.gravidade, e.gravidade_rotulo, e.rotulo, e.canal_rotulo, e.tipo, e.id, e.desde, e.dias, e.tarefas, e.registro_id], ['medido', 'critico', 'Crítico', 'Estoque dos produtos que mais vendem', 'Mercado Livre', 'produto', 'estoque_curva_a|ml|resumo', null, null, 0, null])
  assert.match(e.evidencia, /^Leitura de estoque de 08\/10: 2 dos produtos que mais vendem têm estoque para 3 a 8 dia\(s\)/); assert.match(e.evidencia, /juntos venderam R\$ 3\.500 nesse período \(R\$ 125 por dia\)/)
  assert.ok(!/MLB|\d{8,}/.test(e.evidencia + JSON.stringify(e.produtos)), 'sem ID/MLB'); assert.ok(e.produtos.every(x => x.length <= 40), 'nome curto'); assert.match(e.produtos[0], /^Tênis Corrida/)
  // só B abaixo do limiar crítico, ou curva A com cobertura 5..9 → atenção
  assert.equal(pega(montar({ base: baseMl([B]) }).p.avaliar('Acme'), 'estoque_curva_a').gravidade, 'atencao')
  assert.equal(pega(montar({ base: baseMl([itemMl({ cobertura: 5, estoque: 5 })]) }).p.avaliar('Acme'), 'estoque_curva_a').gravidade, 'atencao', 'curva A em 5 dias (não < 5) é atenção')
  // leitura velha (> 30 h): nunca crítico, e a evidência avisa
  const velho = pega(montar({ base: baseMl([itemMl({ cobertura: 1, estoque: 1, atualizado_em: '2026-10-06T06:00:00.000Z' })]) }).p.avaliar('Acme'), 'estoque_curva_a')
  assert.equal(velho.gravidade, 'atencao'); assert.match(velho.evidencia, /Leitura de estoque de 06\/10/); assert.match(velho.evidencia, /Leitura com mais de um dia/)
  assert.equal(pega(montar({ base: baseMl([itemMl({ cobertura: 1, estoque: 1, atualizado_em: '' })]) }).p.avaliar('Acme'), 'estoque_curva_a').gravidade, 'atencao', 'sem data de leitura não é fresco')
  // sem nenhum produto em risco / sem conta conectada → nada
  assert.equal(montar({ base: baseMl([itemMl({ cobertura: 30 })]) }).p.avaliar('Acme').itens.filter(x => x.item === 'estoque_curva_a').length, 0)
  assert.deepEqual(montar({ base: null }).p.avaliar('Acme').resumo, { total: 0, criticas: 0, atencao: 0, impacto: null })
})

await ok('impacto ruptura_receita: (receita/dia) × max(0, 21 − cobertura) somado, tipo previsto com premissa; nunca zero: sem lead time ou sem dias sem estoque = sem_estimativa', () => {
  const a = itemMl({ cobertura: 3, r: 2800 }), b = itemMl({ curva: 'B', cobertura: 8, r: 560 })
  const e = pega(montar({ base: baseMl([a, b]) }).p.avaliar('Acme'), 'estoque_curva_a')
  const esperado = Math.round(2800 / 28 * 18 + 560 / 28 * 13)                               // 1800 + 260 = 2060
  assert.deepEqual([e.impacto.tipo, e.impacto.valor_brl, e.impacto.rotulo], ['previsto', esperado, `Receita possivelmente em risco: R$ ${esperado.toLocaleString('pt-BR')} (estimativa)`])
  assert.match(e.impacto.premissa, /receita por dia medida nos últimos 28 dias \(R\$ 120 por dia nestes produtos\)/); assert.match(e.impacto.premissa, /prazo de reposição de 21 dias/); assert.match(e.impacto.premissa, /não promessa/)
  assert.deepEqual(auditarTexto(e.impacto.premissa + ' ' + e.impacto.rotulo), [])
  for (const base of [baseMl([a], { lead_time_dias: null }), baseMl([itemMl({ cobertura: 9 })], { lead_time_dias: 5 })]) {
    const s = pega(montar({ base }).p.avaliar('Acme'), 'estoque_curva_a')
    assert.deepEqual([s.impacto.tipo, s.impacto.valor_brl], ['sem_estimativa', null]); assert.match(s.impacto.rotulo, /^Impacto não estimado/)
  }
  const r = montar({ base: baseMl([a, b]) }).p.avaliar('Acme')
  assert.deepEqual([r.resumo.impacto.valor_brl, r.resumo.impacto.tipo], [esperado, 'previsto']); assert.match(r.resumo.impacto.premissa, /prazo de reposição de 21 dias/)
})

await ok('medido · custos: sem custo geral e sem custo do anúncio → sem_estimativa (valor null, nunca 0); custo geral informado ou todos com custo → nenhuma pendência', () => {
  const sem = [itemMl({ custo_unitario: null, cobertura: 30 }), itemMl({ custo_unitario: null, cobertura: 30, curva: 'B', r: 500 }), itemMl({ custo_unitario: 4, cobertura: 30 })]
  const c = pega(montar({ base: baseMl(sem, { custos_conta_informados: false }) }).p.avaliar('Acme'), 'preco_custo', 'ml')
  assert.deepEqual([c.fonte, c.gravidade, c.impacto.tipo, c.impacto.valor_brl, c.id], ['medido', 'atencao', 'sem_estimativa', null, 'preco_custo|ml|resumo'])
  assert.match(c.evidencia, /2 dos 3 produtos que mais vendem estão sem custo informado/); assert.match(c.impacto.rotulo, /^Impacto não estimado \(parado: o cálculo de margem/)
  assert.match(c.o_que_precisamos, /^Para seguirmos no ritmo combinado, precisamos do preço de custo atualizado de /)
  assert.equal(pega(montar({ base: baseMl(sem, { custos_conta_informados: true }) }).p.avaliar('Acme'), 'preco_custo'), undefined)
  assert.equal(pega(montar({ base: baseMl([itemMl({ cobertura: 30 })], { custos_conta_informados: false }) }).p.avaliar('Acme'), 'preco_custo'), undefined)
})

await ok('medido · mídia: só anúncio de conteúdo EDITÁVEL; catálogo do ML (catalogo = 1) é ignorado por padrão, o predicado editavelConteudo é injetável e estoque/custo de catálogo continuam valendo', () => {
  const proprio = itemMl({ fotos: 3, cobertura: 30, r: 900 }), catalogo = itemMl({ fotos: 1, cobertura: 30, catalogo: 1, r: 5000 }), ok5 = itemMl({ fotos: 5, cobertura: 30 })
  const m = pega(montar({ base: baseMl([proprio, catalogo, ok5]) }).p.avaliar('Acme'), 'midia_produto', 'ml')
  assert.deepEqual([m.fonte, m.gravidade, m.impacto.tipo, m.id], ['medido', 'info', 'sem_estimativa', 'midia_produto|ml|resumo'])
  assert.match(m.evidencia, /1 dos 2 produtos que mais vendem tem menos de 5 imagens/, 'o anúncio de catálogo não entra nem no denominador')
  // só catálogo com pouca mídia → nenhuma pendência de mídia
  assert.equal(pega(montar({ base: baseMl([catalogo]) }).p.avaliar('Acme'), 'midia_produto'), undefined)
  // predicado injetável: a frente de catálogo pode declarar "catálogo próprio editável" sem tocar na lógica do avaliador
  const vistos = []
  const livre = pega(montar({ base: baseMl([proprio, catalogo]), editavelConteudo: it => { vistos.push(it.id); return true } }).p.avaliar('Acme'), 'midia_produto')
  assert.match(livre.evidencia, /2 dos 2 produtos|os 2 produtos que mais vendem têm menos de 5/); assert.deepEqual(vistos.sort(), [proprio.id, catalogo.id].sort())
  const nenhum = montar({ base: baseMl([proprio, catalogo]), editavelConteudo: () => false }).p.avaliar('Acme')
  assert.equal(pega(nenhum, 'midia_produto'), undefined)
  // estoque, custo e conta de anúncio de catálogo continuam valendo
  const cat = itemMl({ catalogo: 1, cobertura: 2, estoque: 2, custo_unitario: null })
  const r = montar({ base: baseMl([cat], { custos_conta_informados: false }), conta: { erro: '', atualizado_em: '2026-10-08T10:00:00.000Z' } }).p.avaliar('Acme')
  assert.ok(pega(r, 'estoque_curva_a') && pega(r, 'preco_custo'), 'estoque e custo valem para catálogo')
  assert.equal(pega(r, 'midia_produto'), undefined)
  // dados_produto não tem detecção medida (atributos não são coletados): nunca nasce de leitura do ML
  assert.equal(pega(montar({ base: baseMl([proprio, catalogo]) }).p.avaliar('Acme'), 'dados_produto'), undefined)
})

await ok('medido · acesso à conta: erro do ML = crítico, conexão sem renovar > 24 h = atenção, recente = nada; o texto do erro nunca aparece', () => {
  const E = '<b>invalid_grant</b> segredo APP_USR-123'
  const c1 = pega(montar({ conta: { erro: E, atualizado_em: '2026-10-08T11:00:00.000Z' } }).p.avaliar('Acme'), 'acesso_conta', 'ml')
  assert.deepEqual([c1.fonte, c1.gravidade, c1.id, c1.impacto.tipo], ['medido', 'critico', 'acesso_conta|ml|resumo', 'sem_estimativa'])
  assert.match(c1.evidencia, /^Em 08\/10, o Mercado Livre informou que o acesso à conta precisa ser autorizado novamente\.$/); assert.ok(!JSON.stringify(c1).includes('invalid_grant') && !JSON.stringify(c1).includes('APP_USR'))
  const c2 = pega(montar({ conta: { erro: '', atualizado_em: '2026-10-07T08:00:00.000Z' } }).p.avaliar('Acme'), 'acesso_conta')   // 28 h antes do "agora" do mundo
  assert.deepEqual([c2.gravidade, c2.evidencia], ['atencao', 'A última renovação do acesso à conta do Mercado Livre foi em 07/10, há mais de 24 horas.'])
  assert.equal(pega(montar({ conta: { erro: '', atualizado_em: '2026-10-08T01:00:00.000Z' } }).p.avaliar('Acme'), 'acesso_conta'), undefined)
  assert.equal(pega(montar({ conta: null }).p.avaliar('Acme'), 'acesso_conta'), undefined)
})

await ok('tarefa · classificação pelo tipo REGISTRADO + canal do processo (nunca pelo texto); sem tipo = retorno_pendente com sugestao_tipo só na lista interna', () => {
  const ts = [
    tarefa({ processo: 'Amazon', tipo: 'documentos', tipo_rotulo: TIPOS.documentos, titulo: 'Fotos do produto' }),            // título fala de fotos, o tipo registrado manda
    tarefa({ processo: 'Amazon', tipo: 'logistica', tipo_rotulo: TIPOS.logistica }), tarefa({ processo: 'Shopee 1', tipo: 'logistica', tipo_rotulo: TIPOS.logistica }),
    tarefa({ processo: 'Mercado Livre', tipo: 'logistica', tipo_rotulo: TIPOS.logistica }), tarefa({ processo: 'Magazine Luiza', tipo: 'regulatorio', tipo_rotulo: TIPOS.regulatorio }),
    tarefa({ processo: 'Shopee', tipo: 'custos', tipo_rotulo: TIPOS.custos }), tarefa({ processo: 'TikTok Shop', tipo: 'atendimento', tipo_rotulo: TIPOS.atendimento }),
    tarefa({ processo: 'Shopee', tipo: '', titulo: 'Enviar fotos e vídeo dos produtos' }), tarefa({ processo: '', tipo: 'outro', tipo_rotulo: TIPOS.outro }),
  ]
  const r = montar({ tarefas: ts }).p.avaliar('Acme')
  const par = r.itens.map(p => `${p.item}|${p.canal}`).sort()
  assert.deepEqual(par, ['atendimento_sac|tiktok', 'despacho_prazo|shopee', 'documentos_conta|amazon', 'preco_custo|shopee', 'regulatorio|magalu', 'remessa_fba_full|amazon', 'remessa_fba_full|ml', 'retorno_pendente|geral', 'retorno_pendente|shopee'].sort())
  assert.ok(r.itens.every(p => p.fonte === 'tarefa' && /\|tarefas$/.test(p.id)))
  assert.equal(pega(r, 'retorno_pendente', 'shopee').tarefas, 1); assert.equal(pega(r, 'retorno_pendente', 'shopee').tipo, 'outro')
  assert.equal(r.tarefas.length, 9); const semTipo = r.tarefas.filter(t => !t.tipo_rotulo)
  assert.equal(semTipo.length, 1); assert.equal(semTipo[0].sugestao_tipo, 'fotos', 'sugestão INTERNA para a tela do líder'); assert.ok(r.tarefas.filter(t => t.tipo_rotulo).every(t => !('sugestao_tipo' in t)))
  assert.ok(!JSON.stringify(r.itens).includes('sugestao_tipo'), 'a sugestão nunca entra na pendência')
  assert.deepEqual(['Mercado Livre', 'Shopee 1', 'Magazine Luiza', 'TikTok Shop', '', 'Americanas'].map(canalDaTarefa), ['ml', 'shopee', 'magalu', 'tiktok', 'geral', 'geral'])
  assert.equal(sugestaoTipo('Subir o certificado digital A1'), 'documentos'); assert.equal(sugestaoTipo('Reunião de alinhamento'), null)
})

await ok('tarefa · agrupa por (item, canal), desde = a mais antiga, gravidade pela régua 14/30 (item crítico sobe na faixa "cobrar"), nunca pelo texto', () => {
  const g = (dias, tipo = 'custos', extra = {}) => tarefa({ dias, tipo, tipo_rotulo: TIPOS[tipo] || '', processo: 'Shopee', ...extra })
  const grav = (dias, tipo) => pega(montar({ tarefas: [g(dias, tipo)] }).p.avaliar('Acme'), tipo === 'documentos' ? 'documentos_conta' : 'preco_custo').gravidade
  assert.deepEqual([0, 13, 14, 29, 30, 90].map(d => grav(d, 'custos')), ['info', 'info', 'atencao', 'atencao', 'critico', 'critico'])
  assert.deepEqual([0, 13, 14, 29, 30].map(d => grav(d, 'documentos')), ['info', 'info', 'critico', 'critico', 'critico'], 'documentos (base crítica) já é crítico ao virar "cobrar"')
  const r = montar({ tarefas: [g(5), g(20), g(40, 'custos', { desde_origem: 'historico' }), g(3, 'fotos', { tipo_rotulo: TIPOS.fotos })] }).p.avaliar('Acme')
  const c = pega(r, 'preco_custo', 'shopee')
  assert.deepEqual([c.tarefas, c.dias, c.desde, c.gravidade, c.desde_aproximado, c.id], [3, 40, dia(-40), 'critico', false, 'preco_custo|shopee|tarefas'])
  assert.equal(c.evidencia, `3 tarefas aguardam o retorno do cliente; a mais antiga desde ${dia(-40).split('-').reverse().join('/')} (40 dia(s)).`)
  assert.equal(pega(r, 'midia_produto', 'shopee').tarefas, 1)
  assert.deepEqual(r.itens.map(p => p.gravidade), ['critico', 'info'], 'ordenadas por gravidade')
})

await ok('tarefa · data aproximada: origem ultima_edicao marca desde_aproximado; a evidência INTERNA (paraCliente:false) diz a origem e os dias, a do cliente (padrão) nunca; sem data nenhuma = "—", nunca zero dia', () => {
  const t = tarefa({ dias: 20, desde_origem: 'ultima_edicao', tipo: 'acesso', tipo_rotulo: TIPOS.acesso, processo: 'Shopee' })
  const { p } = montar({ tarefas: [t] })
  const a = pega(p.avaliar('Acme', { paraCliente: false }), 'acesso_conta', 'shopee')
  assert.equal(a.desde_aproximado, true); assert.match(a.evidencia, /20 dia\(s\); data aproximada pela última atualização da tarefa/, 'o Resumo (interno) mantém dias e origem')
  const c = pega(p.avaliar('Acme'), 'acesso_conta', 'shopee'), dm = dia(-20).slice(8) + '/' + dia(-20).slice(5, 7)
  assert.equal(c.evidencia, `1 tarefa aguarda o retorno do cliente (em aberto; data aproximada: ${dm}).`, 'ao cliente: em aberto + data aproximada, sem contagem')
  assert.ok(!/dia|última atualização|card/i.test(c.evidencia + JSON.stringify(c.impacto)), 'nem na evidência nem no impacto do cliente')
  assert.equal(c.dias, 20, 'o número segue na pendência (ordenação e Resumo); quem escreve texto ao cliente usa pendenciaParaCliente/quandoDe')
  const sem = montar({ tarefas: [tarefa({ desde: null, dias: 0, faixa: 'aguardando', tipo: 'acesso', tipo_rotulo: TIPOS.acesso })] }).p.avaliar('Acme')
  const s = pega(sem, 'acesso_conta')
  assert.deepEqual([s.desde, s.dias, s.gravidade], [null, null, 'info']); assert.match(s.evidencia, /sem data de início registrada/); assert.equal(sem.tarefas[0].dias, null)
})

await ok('GRAVIDADE (política de tom): data aproximada e tarefa SEM tipo (retorno_pendente) nunca passam de atenção; crítica só com tipo registrado + data real, registro manual ou medição', () => {
  const grav = (extra, item) => pega(montar({ tarefas: [tarefa({ processo: 'Shopee', ...extra })] }).p.avaliar('Acme'), item).gravidade
  // sem tipo registrado = retorno_pendente: atenção no máximo, em qualquer idade e em qualquer origem de data
  assert.deepEqual([0, 20, 30, 128].map(d => grav({ dias: d }, 'retorno_pendente')), ['info', 'atencao', 'atencao', 'atencao'])
  assert.deepEqual(['registro', 'historico', 'ultima_edicao'].map(o => grav({ dias: 128, desde_origem: o }, 'retorno_pendente')), ['atencao', 'atencao', 'atencao'])
  // tipo registrado + data aproximada: também atenção (item de base crítica ou 30+ dias)
  const doc = { tipo: 'documentos', tipo_rotulo: TIPOS.documentos }, cus = { tipo: 'custos', tipo_rotulo: TIPOS.custos }
  assert.deepEqual([14, 40].map(d => grav({ dias: d, desde_origem: 'ultima_edicao', ...doc }, 'documentos_conta')), ['atencao', 'atencao'])
  assert.deepEqual([14, 40].map(d => grav({ dias: d, desde_origem: 'ultima_edicao', ...cus }, 'preco_custo')), ['atencao', 'atencao'])
  assert.equal(grav({ dias: 5, desde_origem: 'ultima_edicao', ...cus }, 'preco_custo'), 'info', 'o teto não promove: info continua info')
  // tipo registrado + data real (registro ou histórico): a régua 14/30 de antes continua valendo
  assert.deepEqual(['registro', 'historico'].map(o => grav({ dias: 14, desde_origem: o, ...doc }, 'documentos_conta')), ['critico', 'critico'])
  assert.deepEqual(['registro', 'historico'].map(o => grav({ dias: 40, desde_origem: o, ...cus }, 'preco_custo')), ['critico', 'critico'])
  // medição do sistema e registro manual crítico seguem críticos
  assert.equal(pega(montar({ base: baseMl([itemMl({ cobertura: 1, estoque: 1 })]) }).p.avaliar('Acme'), 'estoque_curva_a').gravidade, 'critico', 'estoque curva A, leitura fresca')
  assert.equal(pega(montar({ conta: { erro: 'invalid_token', atualizado_em: '2026-10-08T06:00:00.000Z' } }).p.avaliar('Acme'), 'acesso_conta').gravidade, 'critico', 'conta ML com erro')
  const m = montar(); const r = m.p.registrar({ cliente: 'Acme', item: 'documentos_conta', canal: 'amazon', detalhe: 'cartão vencido', gravidade: 'critico', por: QUEM[0], confirmar: true }); assert.equal(r.ok, true)
  assert.equal(pega(m.p.avaliar('Acme'), 'documentos_conta', 'amazon').gravidade, 'critico', 'registro manual crítico')
  // Damar: 128 e 71 dias, sem tipo, data da última edição -> nenhum crítico e resumo.criticas = 0
  const dam = montar({ tarefas: [tarefa({ processo: 'Magazine Luiza', dias: 128, desde_origem: 'ultima_edicao' }), tarefa({ processo: 'Amazon 1', dias: 71, desde_origem: 'ultima_edicao' })] }).p.avaliar('Acme')
  assert.deepEqual([dam.resumo.criticas, dam.resumo.atencao, dam.itens.map(p => p.gravidade)], [0, 2, ['atencao', 'atencao']])
})

await ok('texto ao cliente com data aproximada: impacto "N tarefa(s) parada(s)" sem dias; data real mantém "há D dia(s)"; nenhum texto do cliente tem "N dias" + aproximada', () => {
  const aprox = pega(montar({ tarefas: [tarefa({ processo: 'Shopee', dias: 128, desde_origem: 'ultima_edicao' }), tarefa({ processo: 'Shopee', dias: 90, desde_origem: 'ultima_edicao' })] }).p.avaliar('Acme'), 'retorno_pendente')
  assert.equal(aprox.impacto.rotulo, 'Impacto não estimado: 2 tarefa(s) parada(s)'); assert.equal(aprox.tarefas, 2)
  const real = pega(montar({ tarefas: [tarefa({ processo: 'Shopee', dias: 20, desde_origem: 'registro' })] }).p.avaliar('Acme'), 'retorno_pendente')
  assert.equal(real.impacto.rotulo, 'Impacto não estimado: 1 tarefa(s) parada(s) há 20 dia(s)')
  assert.match(real.evidencia, /desde .* \(20 dia\(s\)\)\.$/)
  // texto livre do cliente (todos os campos) não cita "card", "última atualização" nem contagem de dias da data aproximada
  const todo = JSON.stringify([aprox.evidencia, aprox.impacto, aprox.por_que_importa, aprox.efeito_se_atrasar, aprox.o_que_precisamos, aprox.o_que_fazemos])
  assert.ok(!/\bcard\b|última atualização|\d+ dias?|dia\(s\)/i.test(todo), todo)
})

await ok('VISIBILIDADE: para texto ao cliente (padrão) só conta tarefa visivel_cliente = 1; Resumo e plano (paraCliente:false) veem todas; medido e registro não dependem disso', () => {
  const vis = tarefa({ processo: 'Shopee', tipo: 'custos', tipo_rotulo: TIPOS.custos, dias: 5 }), inv = tarefa({ processo: 'Amazon 1', tipo: 'documentos', tipo_rotulo: TIPOS.documentos, dias: 20 })
  const { p } = montar({ tarefas: [vis, inv], invisiveis: [inv.id] })
  const cli = p.avaliar('Acme'), interno = p.avaliar('Acme', { paraCliente: false })
  assert.deepEqual(cli.itens.map(x => x.item), ['preco_custo'], 'a tarefa interna (Amazon, documentos) não aparece ao cliente'); assert.deepEqual(cli.tarefas.map(t => t.id), [vis.id])
  assert.deepEqual(interno.itens.map(x => x.item).sort(), ['documentos_conta', 'preco_custo']); assert.deepEqual(interno.tarefas.map(t => t.id).sort(), [inv.id, vis.id].sort())
  assert.equal(p.avaliar('Acme', { paraCliente: true }).itens.length, 1); assert.equal(p.avaliar('Acme', { paraCliente: undefined }).itens.length, 1, 'indefinido = padrão (cliente)')
  const reg = montar({ invisiveis: ['x'] }); reg.p.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'ml', detalhe: 'sem verba', por: QUEM[0], confirmar: true })
  assert.equal(reg.p.avaliar('Acme').itens.length, 1, 'registro manual vale nos dois modos')
})

await ok('impacto acoes_paradas: ML com ação do plano ligada (· PS-xxxxxxxxxx) = previsto (soma do valor esperado); sem vínculo = "Impacto não estimado: N tarefa(s) parada(s) há D dia(s)"; zero nunca vira R$ 0', () => {
  const lig = tarefa({ processo: 'Mercado Livre', tipo: 'fotos', tipo_rotulo: TIPOS.fotos, dias: 16, titulo: 'Fotos novas · PS-0123456789' })
  const lig2 = tarefa({ processo: 'Mercado Livre', tipo: 'fotos', tipo_rotulo: TIPOS.fotos, dias: 9, titulo: 'Vídeo · ps-abcdef0123' })
  const sem = tarefa({ processo: 'Mercado Livre', tipo: 'fotos', tipo_rotulo: TIPOS.fotos, dias: 9, titulo: 'Sem vínculo' })
  const w = montar({ tarefas: [lig, lig2, sem], previsoes: { 'PS-0123456789': 400.4, 'PS-ABCDEF0123': 250.2 } })
  const m = pega(w.p.avaliar('Acme'), 'midia_produto', 'ml')
  assert.deepEqual([m.impacto.tipo, m.impacto.valor_brl, m.tarefas], ['previsto', 651, 3]); assert.match(m.impacto.rotulo, /^Possível impacto: R\$ 651 \(previsão das ações do plano ligadas às tarefas paradas\)$/); assert.match(m.impacto.premissa, /não promessa/)
  const s = pega(montar({ tarefas: [sem, tarefa({ processo: 'Mercado Livre', tipo: 'fotos', tipo_rotulo: TIPOS.fotos, dias: 14 })] }).p.avaliar('Acme'), 'midia_produto')
  assert.deepEqual([s.impacto.tipo, s.impacto.valor_brl, s.impacto.rotulo], ['sem_estimativa', null, 'Impacto não estimado: 2 tarefa(s) parada(s) há 14 dia(s)'])
  const z = pega(montar({ tarefas: [lig], previsoes: { 'PS-0123456789': 0 } }).p.avaliar('Acme'), 'midia_produto')
  assert.deepEqual([z.impacto.tipo, z.impacto.valor_brl], ['sem_estimativa', null], 'valor esperado 0 não vira "R$ 0"')
  const nulo = pega(montar({ tarefas: [lig], previsoes: { 'PS-0123456789': null } }).p.avaliar('Acme'), 'midia_produto')
  assert.equal(nulo.impacto.valor_brl, null)
  // método "nenhum" (acesso): mesmo ligado a uma ação, não inventa R$
  const nen = pega(montar({ tarefas: [tarefa({ processo: 'Mercado Livre', tipo: 'acesso', tipo_rotulo: TIPOS.acesso, titulo: 'Login · PS-0123456789' })], previsoes: { 'PS-0123456789': 900 } }).p.avaliar('Acme'), 'acesso_conta')
  assert.equal(nen.impacto.tipo, 'sem_estimativa')
})

await ok('Shopee, Amazon, TikTok e Magalu NUNCA têm R$: nem com ação do plano ligada, nem registrada; sempre sem_estimativa com o que está parado', () => {
  const previsoes = { 'PS-0123456789': 5000 }
  const ts = ['Shopee', 'Amazon', 'TikTok Shop', 'Magazine Luiza'].map(processo => tarefa({ processo, tipo: 'fotos', tipo_rotulo: TIPOS.fotos, dias: 20, titulo: 'Fotos · PS-0123456789' }))
  const w = montar({ tarefas: ts, previsoes })
  for (const canal of ['shopee', 'amazon', 'tiktok', 'magalu']) {
    const pe = pega(w.p.avaliar('Acme'), 'midia_produto', canal)
    assert.deepEqual([pe.impacto.tipo, pe.impacto.valor_brl, pe.impacto.premissa], ['sem_estimativa', null, null], canal); assert.match(pe.impacto.rotulo, /^Impacto não estimado: 1 tarefa\(s\) parada\(s\) há 20 dia\(s\)$/)
    assert.equal(w.p.registrar({ cliente: 'Acme', item: 'atendimento_sac', canal, detalhe: 'Mensagens sem resposta', confirmar: true, por: 'Carla Souza' }).ok, true)
  }
  const r = w.p.avaliar('Acme')
  assert.equal(r.itens.length, 8); assert.ok(r.itens.every(p => p.canal !== 'ml' && p.impacto.valor_brl === null && p.impacto.tipo === 'sem_estimativa'))
  assert.equal(r.resumo.impacto, null, 'sem nenhum valor medido/previsto, o resumo não inventa total')
  assert.ok(r.itens.every(p => p.impacto.valor_brl === null || p.impacto.valor_brl > 0), 'nunca zero')
})

await ok('registro manual: prévia sem escrita (com texto_cliente), confirmar estrito (string "true" = prévia), por obrigatório e validado (403 sem eco), validações com mensagem fixa', () => {
  const { p, handle } = montar()
  const corpo = { cliente: 'Acme', item: 'documentos_conta', canal: 'amazon', detalhe: 'Cartão vencido, pedido pelo WhatsApp do grupo com a Maria Souza', desde: dia(-9), evidencia: 'https://drive.google.com/x', gravidade: 'critico' }
  const cnt = () => handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n
  let r = p.registrar(corpo)
  assert.deepEqual([r.ok, r.previa], [true, true]); assert.deepEqual(Object.keys(r.texto_cliente), ['rotulo', 'canal_rotulo', ...CAMPOS])
  assert.match(r.texto_cliente.por_que_importa, /^Na Amazon, a conta pode precisar de atualização do cartão de crédito/)
  assert.deepEqual([r.pendencia.fonte, r.pendencia.registro_id, r.pendencia.gravidade, r.pendencia.dias, r.pendencia.desde], ['registro', null, 'critico', 9, dia(-9)])
  assert.equal(cnt(), 0)
  for (const nao of ['true', 1, 'sim', null, [], {}]) { r = p.registrar({ ...corpo, confirmar: nao, por: 'Carla Souza' }); assert.equal(r.previa, true, JSON.stringify(nao)) }
  assert.equal(cnt(), 0)
  assert.equal(falha(() => p.registrar({ ...corpo, confirmar: true }), /^informe "por" \(quem registra — líder ou consultor\)$/), 'informe "por" (quem registra — líder ou consultor)')
  const m403 = falha(() => p.registrar({ ...corpo, confirmar: true, por: 'Fulano de Tal' }), /^somente líder ou consultor da central registra pendências do cliente$/, 403); assert.ok(!m403.includes('Fulano'))
  falha(() => p.registrar({ ...corpo, confirmar: true, por: { nome: 'Carla Souza' } }), /informe "por"/)
  assert.equal(cnt(), 0)
  const ruins = [[{ cliente: '' }, /informe "cliente"/], [{ cliente: '[Comercial] Empresa Y · 3' }, /cliente inválido/], [{ item: 'inventado<script>' }, /item de pendência desconhecido/], [{ item: 'retorno_pendente' }, /item de pendência desconhecido/],
    [{ canal: 'olx' }, /canal não se aplica/], [{ item: 'verba_ads', canal: 'tiktok' }, /canal não se aplica/], [{ detalhe: 'ab' }, /de 3 a 300 caracteres/], [{ detalhe: 'x'.repeat(301) }, /de 3 a 300 caracteres/], [{ detalhe: { a: 1 } }, /de 3 a 300/],
    [{ desde: dia(1) }, /data inválida/], [{ desde: '2026-02-30' }, /data inválida/], [{ desde: '08/10/2026' }, /data inválida/], [{ desde: dia(-800) }, /data inválida/],
    [{ evidencia: 'javascript:alert(1)' }, /link inválido/], [{ gravidade: 'urgentissimo' }, /gravidade desconhecida/]]
  for (const [mut, rx] of ruins) { const msg = falha(() => p.registrar({ ...corpo, ...mut }), rx); for (const eco of ['inventado', 'olx', 'urgentissimo', 'Empresa Y', 'javascript', '2026-02-30']) assert.ok(!msg.includes(eco), `eco de ${eco}`) }
  assert.equal(cnt(), 0)
})

await ok('registro manual: confirmar grava, aparece em avaliar (fonte registro, dias, gravidade), detalhe só interno, duplicado = ok:false, resolver (prévia/confirmar/já resolvida/404) e some do avaliar', () => {
  const { p, handle } = montar()
  const corpo = { cliente: 'Acme', item: 'documentos_conta', canal: 'amazon', detalhe: 'Cartão vencido, pedido pelo WhatsApp da Maria Souza', desde: dia(-9), por: 'giovanna torres' }
  const g = p.registrar({ ...corpo, confirmar: true })
  assert.deepEqual([g.ok, typeof g.registro_id], [true, 'number'])
  const linha = handle.prepare('SELECT * FROM pendencia_cliente WHERE id = ?').get(g.registro_id)
  assert.deepEqual([linha.cliente, linha.item, linha.canal, linha.por, linha.desde, linha.gravidade, linha.resolvida_em], ['Acme', 'documentos_conta', 'amazon', 'Giovanna Torres', dia(-9), 'critico', ''], 'gravidade padrão = base do catálogo; por canônico')
  const r = p.avaliar('Acme'), pe = pega(r, 'documentos_conta', 'amazon')
  assert.deepEqual([pe.fonte, pe.registro_id, pe.dias, pe.desde, pe.gravidade, pe.id, pe.tarefas], ['registro', g.registro_id, 9, dia(-9), 'critico', `documentos_conta|amazon|r${g.registro_id}`, 0])
  assert.equal(pe.detalhe_interno, corpo.detalhe); assert.ok(!JSON.stringify([pe.evidencia, ...CAMPOS.map(k => pe[k]), pe.impacto]).includes('Maria'), 'o detalhe livre nunca entra no texto ao cliente')
  assert.match(pe.evidencia, /^Pendência registrada pela equipe em 08\/10\/2026; aguardando desde \d\d\/\d\d\/2026 \(9 dia\(s\)\)\.$/)
  assert.deepEqual(auditarTexto(pe.evidencia), [])
  // isolamento por cliente e prospect
  assert.equal(p.avaliar('Beta').itens.length, 0); falha(() => p.avaliar('[Comercial] Empresa Y · 3'), /cliente inválido/)
  // duplicado aberto = 200 ok:false (estado de negócio), nada novo é gravado
  const dup = p.registrar({ ...corpo, confirmar: true }); assert.deepEqual([dup.ok, dup.motivo, dup.registro_id], [false, 'ja_registrada', g.registro_id])
  assert.equal(handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n, 1)
  // resolver
  const pv = p.resolver({ registro_id: String(g.registro_id), por: 'Carla Souza' })
  assert.deepEqual([pv.ok, pv.previa, pv.registro.item, pv.registro.canal_rotulo], [true, true, 'documentos_conta', 'Amazon']); assert.equal(handle.prepare("SELECT resolvida_em FROM pendencia_cliente").get().resolvida_em, '')
  for (const nao of ['true', 1, null]) assert.equal(p.resolver({ registro_id: g.registro_id, por: 'Carla Souza', confirmar: nao }).previa, true)
  falha(() => p.resolver({ registro_id: g.registro_id, confirmar: true }), /informe "por"/)
  const m403 = falha(() => p.resolver({ registro_id: g.registro_id, confirmar: true, por: 'Zé Ninguém' }), /^somente líder ou consultor da central resolve pendências do cliente$/, 403); assert.ok(!m403.includes('Ninguém'))
  for (const ruim of [undefined, 0, -1, 1.5, 'abc', {}, [1]]) falha(() => p.resolver({ registro_id: ruim, por: 'Carla Souza' }), /informe "registro_id"/)
  falha(() => p.resolver({ registro_id: 999, por: 'Carla Souza' }), /pendência registrada não encontrada/, 404)
  falha(() => p.resolver({ registro_id: g.registro_id, por: 'Carla Souza', nota: 'x'.repeat(301) }), /até 300 caracteres/)
  const fim = p.resolver({ registro_id: g.registro_id, por: 'carla souza', nota: 'Cartão atualizado e conferido', confirmar: true })
  assert.deepEqual([fim.ok, fim.registro_id], [true, g.registro_id])
  const l2 = handle.prepare('SELECT * FROM pendencia_cliente WHERE id = ?').get(g.registro_id)
  assert.deepEqual([l2.resolvida_por, l2.nota, l2.resolvida_em.length > 10], ['Carla Souza', 'Cartão atualizado e conferido', true])
  assert.equal(p.avaliar('Acme').itens.length, 0, 'resolvida sai do avaliador')
  assert.deepEqual([p.resolver({ registro_id: g.registro_id, por: 'Carla Souza', confirmar: true }).ok, p.resolver({ registro_id: g.registro_id, por: 'Carla Souza' }).motivo], [false, 'ja_resolvida'])
  // depois de resolvida, o mesmo item/canal pode ser registrado de novo
  assert.equal(p.registrar({ ...corpo, confirmar: true }).ok, true)
})

await ok('ordenação (gravidade → R$ → dias), resumo (total, críticas, atenção, impacto somado só de valores medidos/previstos) e texto ao cliente específico por canal', () => {
  const w = montar({
    base: baseMl([itemMl({ cobertura: 2, r: 2800 })]),
    tarefas: [tarefa({ processo: 'Shopee', tipo: 'custos', tipo_rotulo: TIPOS.custos, dias: 20 }), tarefa({ processo: 'Amazon', tipo: 'documentos', tipo_rotulo: TIPOS.documentos, dias: 2 })],
  })
  const r = w.p.avaliar('Acme')
  assert.deepEqual(r.itens.map(p => `${p.gravidade}:${p.item}:${p.canal}`), ['critico:estoque_curva_a:ml', 'atencao:preco_custo:shopee', 'info:documentos_conta:amazon'])
  assert.deepEqual([r.resumo.total, r.resumo.criticas, r.resumo.atencao, r.resumo.impacto.valor_brl], [3, 1, 1, Math.round(2800 / 28 * 19)])
  assert.deepEqual(Object.keys(r), ['cliente', 'gerado_em', 'resumo', 'itens', 'tarefas'])
  const chaves = ['id', 'item', 'rotulo', 'canal', 'canal_rotulo', 'tipo', 'fonte', 'gravidade', 'gravidade_rotulo', 'desde', 'dias', 'evidencia', ...CAMPOS, 'impacto', 'tarefas', 'registro_id']
  assert.deepEqual(Object.keys(r.itens[0]).slice(0, chaves.length), chaves, 'formato do contrato, na ordem')
  assert.deepEqual(Object.keys(r.itens[0].impacto), ['tipo', 'valor_brl', 'rotulo', 'premissa'])
  const shopee = r.itens[1], amazon = r.itens[2]
  assert.match(shopee.o_que_precisamos, /preço de custo atualizado e do preço de venda definido para produtos da loja\.$/)    // específico da Shopee, com o padrão do item no lugar de {produtos}
  const ex = w.p.explicar({ ...amazon, canal: 'amazon' }); assert.match(ex.o_que_precisamos, /cartão de crédito atualizado/)
  assert.match(w.p.explicar({ ...amazon, canal: 'shopee', canal_rotulo: 'Shopee' }).por_que_importa, /Na Shopee, a validação da conta pede documentos fiscais/)
  for (const p of r.itens) for (const k of CAMPOS) { assert.ok(p[k].length > 30, k); assert.ok(!/[{}]/.test(p[k]), 'sem token solto'); assert.deepEqual(auditarTexto(p[k]), [], `${p.item} ${k}`) }
})

await ok('substituição SEGURA de {produtos}/{n}/{canal}/{dias}: nome com chaves, ID/MLB, promessa ou comprimento absurdo nunca vira texto de cliente', () => {
  const nc = nomeCurto('Kit {n} Camiseta MLB-123456789 Algodão 1234567890 Preta   Premium Edição Limitada Verão 2026')
  assert.ok(nc.length <= 40 && !/[{}]|MLB|\d{6,}/.test(nc) && nc.startsWith('Kit n Camiseta Algodão Preta'), nc)
  assert.ok(!/[<>{}[\]|]/.test(nomeCurto('<script>alert(1)</script> {produtos} [x] a|b')), 'sem colchete, menor, chave ou barra')
  assert.equal(nomeCurto(null), '')
  const mau = itemMl({ titulo: 'Garantia total ranking 1 garantido', cobertura: 2 }), bom = itemMl({ titulo: 'Coleira Antipulgas', cobertura: 3 })
  const e = pega(montar({ base: baseMl([mau, bom]) }).p.avaliar('Acme'), 'estoque_curva_a')
  assert.deepEqual(e.produtos, ['Coleira Antipulgas'], 'nome reprovado pelo auditor some'); assert.ok(!/arant|ranking/i.test(JSON.stringify(e)))
  assert.match(e.o_que_precisamos, /da reposição de Coleira Antipulgas\.$/)
  const so = pega(montar({ base: baseMl([mau]) }).p.avaliar('Acme'), 'estoque_curva_a')
  assert.deepEqual(so.produtos, []); assert.match(so.o_que_precisamos, /reposição de produtos que mais vendem\.$/, 'sem nome limpo, o padrão do item')
  const t = montar({ tarefas: [tarefa({ processo: 'Amazon', dias: 20 }), tarefa({ processo: 'Amazon', dias: 10 })] }).p.avaliar('Acme').itens[0]
  assert.match(t.o_que_precisamos, /^Para seguirmos no ritmo combinado, precisamos do retorno sobre 2 ponto\(s\) em aberto \(Amazon\)\.$/)
})

await ok('só leitura: avaliar nunca escreve, lê o estoque UMA vez por avaliação e não chama nada ao vivo; isolamento entre clientes', () => {
  const w = montar({ base: baseMl([itemMl()]), tarefas: [tarefa({ cliente: 'Beta', processo: 'Shopee' })] })
  const antes = w.handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n
  w.p.avaliar('Acme'); w.p.avaliar('Acme')
  assert.equal(w.estado.lidos.length, 2); assert.equal(w.handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n, antes)
  assert.equal(w.p.avaliar('Acme').itens.filter(p => p.fonte === 'tarefa').length, 0, 'a tarefa é do Beta'); assert.equal(w.p.avaliar('Beta').itens.length, 1)
  assert.deepEqual(w.p.catalogo().itens.slice(0, 1).map(i => Object.keys(i)), [['id', 'rotulo', 'canais', 'tipo', 'deteccao', 'gravidade_base']])
  const src = readFileSync(new URL('../src/lib/pendencias-cliente.js', import.meta.url), 'utf8')
  assert.ok(!/from '\.\/(db|notion|equipe|meli-api|meli-contas|plano-cliente)\.js'/.test(src), 'núcleo puro: nenhum import de banco/Notion/ML')
})

// ── regra do plano (banco em memória do db.js) ──────────────────────────────────────────────────────────────────────────────────────
await ok('plano: regra pendencia_cliente (fato quando medida, consultor, 72h, ≤ 5 ações), "Cobrar o cliente: …", R$ só na evidência, estável, sem duplicar bloqueio_cliente nem criar ação para tarefa parada', async () => {
  const { db, hojeLocal, agora } = await import('../src/lib/db.js')
  const { gerarPlanoCliente, idAcao } = await import('../src/lib/plano-cliente.js')
  const { papelDaAcao } = await import('../src/lib/ficha-nucleo.js')
  const { criarPendenciasReal, pendenciasReal } = await import('../src/lib/pendencias-cliente-real.js')
  const H = hojeLocal(), CLI = '__pend_teste__', d = k => { const x = new Date(H + 'T12:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10) }
  const cli = { cliente: CLI, status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: 'Giovanna Torres' }, lideres: {}, principal: 'Giovanna Torres', squads: [], squadPrincipal: '', squadDoCanal: () => '', responsavelDoCanal: () => 'Giovanna Torres' }
  const so = acoes => acoes.filter(a => a.regra === 'pendencia_cliente')
  assert.deepEqual(so(gerarPlanoCliente(cli, { hoje: H }).acoes), [], 'sem nada medido ou registrado, a regra não dispara')
  // anúncio de curva A com 3 dias de estoque (1 venda/dia há 28 dias) e sem custo cadastrado + 4 pendências registradas à mão = 6 candidatas
  db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, status, estoque, fotos, catalogo, atualizado_em) VALUES (?, 'MLB9000000001', 'Coleira Teste', '', '', 100, 'active', 3, 8, 0, ?)").run(CLI, agora())
  const sv = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?, ?, ?, 1, 100, 10)')
  for (let k = 1; k <= 28; k++) sv.run(CLI, 'MLB9000000001', d(-k))
  const mine = criarPendenciasReal({ validarPor: () => 'Giovanna Torres' })
  const reg = (item, canal) => { const r = mine.registrar({ cliente: CLI, item, canal, detalhe: 'registro de teste', confirmar: true, por: 'Giovanna Torres' }); assert.equal(r.ok, true); return r.registro_id }
  const ids = [reg('documentos_conta', 'amazon'), reg('despacho_prazo', 'shopee'), reg('verba_ads', 'ml'), reg('atendimento_sac', 'ml')]
  const av = pendenciasReal().avaliar(CLI, { hoje: H })
  assert.deepEqual(av.itens.map(p => p.fonte).sort(), ['medido', 'medido', 'medido', 'registro', 'registro', 'registro', 'registro'])
  assert.equal(av.itens.find(p => p.item === 'prazo_fornecedor')?.gravidade, 'info', 'v1.6.0: sem prazo do fornecedor informado = pendência informativa (fica no Resumo, não vira ação)')
  assert.equal(pendenciasReal().avaliar('__outro_cliente__', { hoje: H }).itens.length, 0, 'isolamento por cliente')
  let g = gerarPlanoCliente(cli, { hoje: H }), pc = so(g.acoes)
  assert.equal(pc.length, 5, 'no máximo 5 ações por cliente'); assert.equal(new Set(pc.map(a => a.id)).size, 5)
  const estoque = pc.find(a => /Estoque dos produtos que mais vendem/.test(a.titulo))
  assert.equal(estoque.titulo, 'Cobrar o cliente: Estoque dos produtos que mais vendem (Mercado Livre)')
  assert.deepEqual([estoque.horizonte, estoque.responsavel, estoque.dados.evidencia_tipo, estoque.dados.dependencia, papelDaAcao(estoque)], ['72h', 'Giovanna Torres', 'fato', 'Retorno do cliente', 'consultor'])
  assert.match(estoque.dados.evidencia, /Receita possivelmente em risco: R\$ [\d.]+ \(estimativa\)\. Premissa: .*não promessa/, 'R$ só como texto da evidência, com premissa')
  assert.ok(!('previsao' in estoque.dados) && !('previsao_json' in estoque), 'a ação não carrega previsão de R$ prometida')
  assert.match(estoque.dados.acao, /Combinar com o cliente o que falta.*o sistema não envia mensagens\./)
  const docs = pc.find(a => /Documentos e validação da conta \(Amazon\)/.test(a.titulo)); assert.ok(docs, 'as duas críticas entram')
  assert.equal(docs.dados.evidencia_tipo, 'hipotese'); assert.match(docs.dados.evidencia, /Informado pela equipe; o sistema não confirma\./); assert.ok(!/R\$/.test(docs.dados.evidencia), 'registro sem R$')
  assert.equal(papelDaAcao({ regra: 'pendencia_cliente' }), 'consultor'); assert.equal(papelDaAcao({ regra: 'bloqueio_cliente' }), 'consultor'); assert.equal(papelDaAcao({ dados: {}, titulo: 'x' }), 'analista')
  assert.equal(estoque.id, idAcao(CLI, 'pendencia_cliente', 'estoque_curva_a|ml|resumo'), 'id estável pela condição')
  assert.deepEqual(so(gerarPlanoCliente(cli, { hoje: H }).acoes).map(a => a.id).sort(), pc.map(a => a.id).sort(), 'regerar não troca ids')
  // tarefa parada ≥ 14 dias fica SÓ na ação bloqueio_cliente: o avaliador a lista, a regra nova não cria ação para ela
  db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, status_raw, last_edited) VALUES ('0'||substr('00000000000000000000000000000000', 2), 'teste', ?, 'Cartão da Amazon', 'Amazon', 'dependencia_cliente', 'Aguardando Devolutiva do Cliente', ?)").run(CLI, d(-20) + 'T12:00:00.000Z')
  g = gerarPlanoCliente(cli, { hoje: H })
  assert.equal(g.acoes.filter(a => a.regra === 'bloqueio_cliente').length, 1); assert.equal(so(g.acoes).length, 5)
  assert.ok(pendenciasReal().avaliar(CLI, { hoje: H }).itens.some(p => p.fonte === 'tarefa' && p.item === 'retorno_pendente' && p.canal === 'amazon'))
  assert.ok(!so(g.acoes).some(a => /Retorno pendente/.test(a.titulo)), 'tarefa parada não vira ação pendencia_cliente')
  // resolvidas as pendências, as ações somem do plano (viram obsoletas ao salvar)
  for (const id of ids) assert.equal(mine.resolver({ registro_id: id, por: 'x', confirmar: true }).ok, true)
  assert.equal(so(gerarPlanoCliente(cli, { hoje: H }).acoes).length, 1, 'sobra só a medida de estoque: o custo medido não vira ação aqui, porque o plano por anúncio já tem `cadastrar_custos` (não duplica)')
})

await ok('fiação: db.js cria pendencia_cliente, ficha-nucleo e plano-cliente usam a regra nova sem tocar nas condições de bloqueio_cliente', () => {
  const fonte = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
  assert.match(fonte('src/lib/db.js'), /import \{ SCHEMA_PENDENCIAS \} from '\.\/pendencias-cliente\.js'/); assert.match(fonte('src/lib/db.js'), /db\.exec\(SCHEMA_PENDENCIAS\)/)
  const pc = fonte('src/lib/plano-cliente.js')
  assert.match(pc, /regra: 'pendencia_cliente', alvo: p\.id/); assert.match(pc, /if \(ctx\.dependenciasVencidas\.length\) \{/)
  assert.match(fonte('src/lib/ficha-nucleo.js'), /a\?\.regra === 'bloqueio_cliente' \? 'consultor'/)
  const dm = fonte('docs/metodologia-algoritmo.md'); assert.match(dm, /pendencia_cliente/)
})

await ok('fiação da visibilidade: telas/plano internos pedem paraCliente:false; PDF semanal e sprint seguem o `interno`; o texto ao cliente (brief, alerta, /plano) usa o padrão; a fiação real filtra por visivel_cliente', () => {
  const fonte = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
  assert.match(fonte('src/rotas-pendencias.js'), /pendencias\.avaliar\(cliente\(um\(req\.query\.cliente\)\), \{ paraCliente: false \}\)/)
  assert.match(fonte('src/lib/plano-cliente.js'), /pendenciasReal\(\)\.avaliar\(cli\.cliente, \{ hoje, paraCliente: false \}\)/)
  assert.match(fonte('src/lib/semanal.js'), /pendenciasReal\(\)\.avaliar\(cliente, \{ hoje, paraCliente: !interno \}\)/); assert.match(fonte('src/lib/relatorio.js'), /pendenciasReal\(\)\.avaliar\(f\.cliente, \{ paraCliente: !f\.interno \}\)/)
  for (const f of ['src/lib/relatorio-brief.js', 'src/lib/alerta-cliente.js', 'src/lib/alerta-cliente-real.js', 'src/lib/relatorio-brief-real.js', 'src/rotas-planos.js']) assert.ok(!/paraCliente\s*:\s*false/.test(fonte(f)), `${f}: texto ao cliente usa o padrão`)
  assert.match(fonte('src/lib/pendencias-cliente-real.js'), /SELECT id FROM tarefas WHERE cliente = \? AND visivel_cliente = 1 AND id IN \(SELECT value FROM json_each\(\?\)\)/)
})

await ok('catálogo (fiação real): produto de catálogo de TERCEIROS não gera pendência de mídia; fora do catálogo e catálogo PRÓPRIO sim; estoque e custo valem para todos', async () => {
  const { db, hojeLocal, agora } = await import('../src/lib/db.js')
  const { criarPendenciasReal } = await import('../src/lib/pendencias-cliente-real.js')
  const H = hojeLocal(), CLI = '__pend_cat__', d = k => { const x = new Date(H + 'T12:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10) }
  const it = db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, status, estoque, fotos, catalogo, atualizado_em) VALUES (?, ?, ?, '', '', 100, 'active', 500, 2, ?, ?)")
  it.run(CLI, 'MLB9100000001', 'Produto de Catalogo', 1, agora()); it.run(CLI, 'MLB9100000002', 'Produto Tradicional', 0, agora())
  const sv = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?, ?, ?, 1, 100, 10)')
  for (let k = 1; k <= 28; k++) { sv.run(CLI, 'MLB9100000001', d(-k)); sv.run(CLI, 'MLB9100000002', d(-k)) }
  const p = criarPendenciasReal({ validarPor: () => 'Giovanna Torres' })
  const midia = () => p.avaliar(CLI, { hoje: H }).itens.filter(x => x.item === 'midia_produto')
  assert.equal(midia().length, 1, 'só o tradicional entra'); assert.ok(!/Catalogo/.test(JSON.stringify(midia())), 'o produto de catálogo de terceiros não é citado')
  db.prepare('INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, por, atualizado_em, catalogo_proprio) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(cliente) DO UPDATE SET catalogo_proprio = 1').run(CLI, '[]', 'ads', 'teste', agora())
  assert.match(JSON.stringify(midia()), /Catalogo/, 'marcado como catálogo próprio, o conteúdo volta a ser dele')
})

await ok('medido · saúde da conta (v1.5.0): despacho_prazo e atendimento_sac medidos no ML só com leitura do dia e bloco sem pendente; mediação e ≥3 atrasos = crítico; impacto não estimado; anuncios = item_ids; reputação só no detalhe interno; sem saúde, pendente ou leitura velha → nada; textos no auditor', () => {
  const S = (o = {}) => ({ dia: HOJE, do_dia: true, coletado_em: '2026-10-08T06:00:00.000Z', reputacao: { nivel: '3_yellow', taxa_claims: 1, taxa_atraso: 2, taxa_cancel: 0, vendas_periodo: 50 }, perguntas: { abertas: 3, mais_de_24h: 2 }, reclamacoes: { abertas: 2, mediacoes: 1 }, atrasos: 1, pendente: {},
    listas: { claims: [{ item_id: 'MLB1' }, { item_id: null }], perguntas: [{ item_id: 'MLB2', mais_de_24h: 1 }, { item_id: 'MLB3', mais_de_24h: 0 }], atrasos: [{ item_id: 'MLB4' }], full: [] }, ...o })
  const av = s => montar({ saude: s }).p.avaliar('Acme', { hoje: HOJE })
  const r = av(S()), d = pega(r, 'despacho_prazo', 'ml'), a = pega(r, 'atendimento_sac', 'ml')
  assert.ok(d && a, 'os dois itens medidos nascem'); assert.equal(d.fonte, 'medido'); assert.equal(a.fonte, 'medido'); assert.equal(d.gravidade, 'atencao'); assert.equal(a.gravidade, 'critico', 'mediação = crítico')
  assert.equal(d.impacto.tipo, 'sem_estimativa'); assert.equal(a.impacto.valor_brl, null); assert.equal(d.medido_em, '2026-10-08T06:00:00.000Z')
  assert.deepEqual(d.anuncios.map(x => x.id), ['MLB4']); assert.deepEqual(a.anuncios.map(x => x.id), ['MLB1', 'MLB2'], 'claims + perguntas vencidas, sem null, sem a pergunta recente')
  assert.match(d.evidencia, /^Leitura de 08\/10: 1 pedido\(s\) pago\(s\) dos últimos dias está com o prazo de despacho vencido/); assert.match(a.evidencia, /^Leitura de 08\/10: 2 pergunta\(s\) de compradores sem resposta há mais de 24 horas e 2 reclamação\(ões\) aberta\(s\), 1 em mediação\.$/)
  assert.match(d.detalhe_interno, /3_yellow/); assert.ok(!/yellow/i.test([d.evidencia, ...CAMPOS.map(k => d[k])].join(' ')), 'o nível da reputação (enum do ML) fica no detalhe interno, nunca no texto ao cliente — o template fixo fala de reputação sem citar o nível')
  for (const p of [d, a]) for (const k of ['evidencia', 'rotulo', ...CAMPOS]) assert.deepEqual(auditarTexto(p[k]), [], `${p.item}.${k}`)
  const r3 = av(S({ atrasos: 3, reclamacoes: { abertas: 1, mediacoes: 0 } })); assert.equal(pega(r3, 'despacho_prazo').gravidade, 'critico', '≥ 3 atrasos = crítico'); assert.equal(pega(r3, 'atendimento_sac').gravidade, 'atencao', 'sem mediação = atenção')
  const so = av(S({ atrasos: 0, perguntas: { abertas: 1, mais_de_24h: 0 }, reclamacoes: { abertas: 0, mediacoes: 0 } })); assert.ok(!so.itens.some(p => ['despacho_prazo', 'atendimento_sac'].includes(p.item)), 'zero medido não é pendência')
  const pend = av(S({ pendente: { atrasos: 'endpoint_nao_verificado', perguntas: 'permissao_do_app', reclamacoes: 'indisponivel' }, atrasos: null, perguntas: { abertas: null, mais_de_24h: null }, reclamacoes: { abertas: null, mediacoes: null } }))
  assert.ok(!pend.itens.some(p => p.fonte === 'medido' && ['despacho_prazo', 'atendimento_sac'].includes(p.item)), 'bloco pendente → nada medido (nunca zero)')
  const parcial = av(S({ pendente: { perguntas: 'permissao_do_app' }, perguntas: { abertas: null, mais_de_24h: null } })); assert.match(pega(parcial, 'atendimento_sac').evidencia, /^Leitura de 08\/10: 2 reclamação/, '403 só nas perguntas: as reclamações seguem medidas')
  assert.ok(!av(S({ do_dia: false })).itens.some(p => p.item === 'despacho_prazo'), 'leitura velha não vale')
  assert.ok(!montar({}).p.avaliar('Acme', { hoje: HOJE }).itens.some(p => ['despacho_prazo', 'atendimento_sac'].includes(p.item)), 'sem saúde injetada: nada')
  const c = catalogoReal(); assert.equal(c.itens.despacho_prazo.deteccao, 'medido'); assert.deepEqual(c.itens.atendimento_sac.medido_em, ['ml']); assert.equal(c.limiares.saude_ml.atrasos_critico, 3); assert.equal(c.versao, '1.1.0')
})

// ═════════ alinhamentos com o cliente (PLANO ATIVO 4): pendência coberta some, com contagem interna; o predicado do núcleo é a única decisão ═════════
await ok('alinhamentos: anúncio alinhado sai da pendência medida (descontinuado não pede reposição); pendência cujo "Cobrar o cliente" foi descartado some (só ela); tarefa coberta pela regra bloqueio_cliente some; contagem interna; sem o predicado nada muda', async () => {
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  const { idAcao } = await import('../src/lib/plano-cliente.js')
  const a1 = itemMl({ titulo: 'Kit Descontinuado', custo_unitario: null }), a2 = itemMl({ titulo: 'Campeao de Vendas', custo_unitario: null })
  const cenario = () => ({ base: baseMl([a1, a2], { custos_conta_informados: false }), conta: { erro: 'invalid_token', atualizado_em: '2026-10-08T05:00:00.000Z' }, tarefas: [tarefa({ tipo: 'documentos', processo: 'Shopee', dias: 20 })] })
  let A
  const m = montar({ ...cenario(), alinhado: (c, d) => A.predicado(c, { hoje: d }), idAcao })
  m.handle.exec(SCHEMA_ALINHAMENTO)
  A = criarAlinhamentos({ handle: m.handle, hoje: () => HOJE, agora: () => HOJE + 'T12:00:00.000Z', nomesInternos: () => QUEM, validarPor: nome => QUEM.includes(nome) ? nome : '' })
  const reg = e => A.registrar({ cliente: 'Acme', por: QUEM[0], confirmar: true, ...e })
  const antes = m.p.avaliar('Acme', { hoje: HOJE, paraCliente: false })
  assert.equal(antes.alinhadas, 0); assert.ok(pega(antes, 'estoque_curva_a') && pega(antes, 'acesso_conta') && pega(antes, 'preco_custo')); assert.ok(antes.itens.some(p => p.fonte === 'tarefa'))
  // descontinuado no a1: sai do estoque e do custo (o a2 continua); o texto ao cliente não cita mais o produto
  reg({ escopo: 'anuncio', chave: a1.id, tipo: 'descontinuado_queima_estoque', permanente: true, regras: ['estoque_ruptura', 'cadastrar_custos'] })
  let r = m.p.avaliar('Acme', { hoje: HOJE })
  assert.deepEqual(pega(r, 'estoque_curva_a').anuncios.map(x => x.id), [a2.id]); assert.ok(!/Descontinuado/.test(JSON.stringify(pega(r, 'estoque_curva_a'))), 'o produto alinhado some do texto')
  assert.equal(r.alinhadas, 2, 'um anúncio tirado do estoque e do custo')
  // o "Cobrar o cliente: acesso à conta" do plano foi descartado com motivo: SÓ essa pendência some (pelo id da ação, como marcarStatus grava)
  reg({ escopo: 'conta', tipo: 'ja_informado', regras: ['pendencia_cliente'], origem: 'descarte', acao_id: idAcao('Acme', 'pendencia_cliente', 'acesso_conta|ml|resumo') })
  r = m.p.avaliar('Acme', { hoje: HOJE })
  assert.ok(!pega(r, 'acesso_conta'), 'pendência do descarte some'); assert.ok(pega(r, 'estoque_curva_a') && pega(r, 'preco_custo'), 'as outras pendências da conta continuam')
  assert.equal(r.alinhadas, 3)
  // tarefa em dependência: a regra bloqueio_cliente coberta na conta (o consultor já falou com o seller) tira a pendência de tarefa
  reg({ escopo: 'conta', tipo: 'ja_informado', regras: ['bloqueio_cliente'] })
  r = m.p.avaliar('Acme', { hoje: HOJE, paraCliente: false })
  assert.ok(!r.itens.some(p => p.fonte === 'tarefa')); assert.equal(r.resumo.total, r.itens.length); assert.equal(r.alinhadas, 4)
  // os dois anúncios alinhados: a pendência de estoque não nasce
  reg({ escopo: 'anuncio', chave: a2.id, tipo: 'pausa_producao' })
  assert.ok(!pega(m.p.avaliar('Acme', { hoje: HOJE }), 'estoque_curva_a'))
  // sem o predicado: comportamento anterior, sem a chave interna
  const sem = montar(cenario()).p.avaliar('Acme', { hoje: HOJE })
  assert.ok(!('alinhadas' in sem)); assert.ok(pega(sem, 'acesso_conta') && pega(sem, 'estoque_curva_a'))
  // a fiação real usa o MESMO id de ação do plano e o predicado único
  const real = readFileSync(new URL('../src/lib/pendencias-cliente-real.js', import.meta.url), 'utf8')
  assert.match(real, /import \{ idAcao \} from '\.\/plano-cliente\.js'/); assert.match(real, /alinhado: \(cliente, dia\) => alinhamentosReal\(\)\.predicado\(cliente/)
})

console.log(`\n${n} verificações do avaliador de pendências ok.`)
