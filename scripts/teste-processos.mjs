// Autoteste da inteligência de processos: o MAPA por canal (lista do David), o passo a passo extraído do Manual, famílias de demanda, roteiro do card,
// sequência lógica do plano e o playbook de duplicação estratégica.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { catalogo, extras, processoCompleto, acharProcesso, roteiro, roteiroEmTexto, familiaDeDemanda, ordenarPorSequencia, ordemDoTipo, duplicacao, curadoria, base, norm } from '../src/lib/processos.js'

// 1) o MAPA: exatamente as tarefas que o David listou, por canal, cada uma ligada a um processo do Manual COM passo a passo
const MAPA = {
  SHO: ['Cadastro de Produtos', 'Adicionar Variações', 'Ficha Técnica', 'Duplicação de Produtos', 'Impulsionar anúncio', 'Ativar anúncio', 'Inativar anúncio', 'Excluir anúncio', 'Otimizar anúncio', 'Ativar desconto', 'Minha promoção', 'Criar Cupom', 'Cupom de loja', 'Oferta Relâmpago', 'Ajustar Categoria', 'Ajustar SKU'],
  ML: ['Cadastro de produto', 'Adicionar variações', 'Ajustar produto (Editar)', 'Ajustar SKU', 'Alterar EAN', 'Ficha técnica', 'Tabela de medidas', 'Duplicação de produtos'],
  AMZ: ['Como duplicar anúncios', 'Vincular anúncios Amazon', 'Atualizar preços', 'Cadastro de produtos', 'Editar anúncios', 'Como criar campanha de cupom', 'Como resgatar um anúncio', 'Como configurar o faturador', 'Como criar remessa para o FBA'],
}
for (const [canal, nomes] of Object.entries(MAPA)) {
  const cat = catalogo({ canal })
  assert.deepEqual(cat.map(e => norm(e.nome)), nomes.map(norm), `${canal}: o MAPA tem exatamente as tarefas listadas, na ordem`)
  for (const e of cat) {
    assert.ok(!e.erro, `${canal} ${e.nome}: processo existe no Manual`)
    assert.ok(e.bloco && e.bloco.passos.length >= 3, `${canal} ${e.nome}: tem passo a passo (${e.bloco?.passos.length})`)
    assert.ok(e.bloco.caminho, `${canal} ${e.nome}: tem o caminho no marketplace`)
    assert.ok(e.criterio && e.evidencia.length && e.tipo, `${canal} ${e.nome}: critério de conclusão, evidência e tipo`)
    assert.ok(e.bloco.passos.every((p, i) => p.n === i + 1 && p.titulo), `${canal} ${e.nome}: passos numerados em sequência`)
  }
}
assert.equal(catalogo().length, 16 + 8 + 9)

// 2) famílias: dezenas de grafias do Notion viram uma família só (o sistema aprende por família)
const F = t => familiaDeDemanda(t).id
for (const t of ['Duplicação', 'Duplicar anúncios', 'Duplicação de Anuncio', 'Duplicar Anúncio', 'duplicacao de anuncios', 'Duplicação de Títulos', 'Duplicação de produtos']) assert.equal(F(t), 'duplicacao', t)
for (const t of ['Oferta Relâmpago', 'Oferta relampago', 'Criar Oferta Relâmpago', 'Duplicar Oferta Relâmpago', 'Duplicar oferta Relampago']) assert.equal(F(t), 'oferta_relampago', t + ' (oferta não é duplicação de anúncio)')
for (const t of ['Planejamento full', 'Cadastro Full', 'Análise Full']) assert.equal(F(t), 'full', t)
assert.equal(F('Otimizar Anúncios'), 'otimizar'); assert.equal(F('Melhorar Anúncios'), 'otimizar'); assert.equal(F('Otimizações anúncios'), 'otimizar')
assert.equal(F('Preencher Ficha Técnica'), 'ficha'); assert.equal(F('Cadastro de Produtos'), 'cadastro'); assert.equal(F('Criar Kits'), 'kits'); assert.equal(F('Cupom'), 'cupom')
assert.equal(F('Campanhas de Desconto'), 'campanhas_desconto'); assert.equal(F('Ajuste ADS'), 'ads'); assert.equal(F('Reunião de Alinhamento'), 'interna'); assert.equal(F('Transmissão por chat'), 'transmissao')
assert.equal(F(''), 'sem_tipo'); assert.equal(familiaDeDemanda('Coisa Estranha').nome, 'Coisa Estranha', 'sem família: mantém o nome original')
// as demandas das regras do plano caem nas famílias certas
for (const [t, f] of [['Otimizar Anúncios', 'otimizar'], ['Corrigir Anúncios', 'corrigir'], ['Planejamento full', 'full'], ['Melhorar Imagens', 'imagens'], ['Criar Kits', 'kits'], ['Ajuste ADS', 'ads'], ['Campanhas de Desconto', 'campanhas_desconto'], ['Reunião de Alinhamento', 'interna']]) assert.equal(F(t), f, t)

// 3) achar o processo de uma demanda do Notion, por canal
assert.equal(acharProcesso({ demanda: 'Preencher Ficha Técnica', canal: 'ML' }).processo, '6.12')
assert.equal(acharProcesso({ demanda: 'Duplicar Anúncio', canal: 'ML' }).processo, '6.17'); assert.equal(acharProcesso({ demanda: 'Duplicar Anúncio', canal: 'AMZ' }).processo, '6.18')
assert.equal(acharProcesso({ demanda: 'Oferta relampago', canal: 'SHO' }).processo, '9.9')
assert.equal(acharProcesso({ demanda: 'Adicionar Variações', canal: 'SHO' }).processo, '6.4')
assert.equal(acharProcesso({ demanda: 'Cadastro de Produtos', canal: 'AMZ' }).processo, '6.1')
assert.equal(acharProcesso({ demanda: 'Reunião de Alinhamento', canal: 'ML' }), null, 'tarefa interna não tem roteiro de marketplace')
assert.equal(acharProcesso({ demanda: 'Alterar EAN', canal: 'SHO' }), null, 'o MAPA da Shopee não tem Alterar EAN: sem roteiro inventado')

// 4) roteiro do card: passos + atenção + evidência + critério
const r = roteiro({ demanda: 'Ajustar SKU', canal: 'SHO' }), txt = roteiroEmTexto(r)
assert.equal(r.processo, '6.9'); assert.match(txt, /^COMO FAZER — Ajustar SKU \(Shopee\)\nCaminho: Central do Vendedor/); assert.match(txt, /\n1\. Abrir a edição/)
assert.match(txt, /Atenção: Alterar o SKU pode quebrar o vínculo com o ERP/); assert.match(txt, /EVIDÊNCIA \(registrar no card no momento da execução\):\n• /); assert.match(txt, /CRITÉRIO DE CONCLUSÃO: SKU idêntico/)
assert.match(roteiroEmTexto(roteiro({ demanda: 'Atualizar Preços', canal: 'AMZ' })), /DEPENDE DO CLIENTE: aprovação de preço/)
assert.equal(roteiroEmTexto(null), '')

// 5) sequência lógica do plano (Manual 5.2): cadastros e duplicações ANTES das otimizações; promoção depois
assert.ok(ordemDoTipo('saude') < ordemDoTipo('disponibilidade') && ordemDoTipo('disponibilidade') < ordemDoTipo('cadastro') && ordemDoTipo('cadastro') < ordemDoTipo('otimizacao') && ordemDoTipo('otimizacao') < ordemDoTipo('trafego_promocao') && ordemDoTipo('trafego_promocao') < ordemDoTipo('expansao'))
const ordenado = ordenarPorSequencia([{ n: 'otimizar', t: 'otimizacao' }, { n: 'promo', t: 'trafego_promocao' }, { n: 'duplicar', t: 'cadastro' }, { n: 'cadastrar', t: 'cadastro' }, { n: 'bloqueado', t: 'saude' }], x => x.t)
assert.deepEqual(ordenado.map(x => x.n), ['bloqueado', 'duplicar', 'cadastrar', 'otimizar', 'promo'], 'ordem lógica, estável dentro do mesmo tipo')
assert.equal(catalogo({ canal: 'SHO' }).find(e => e.processo === '6.17').tipo, 'cadastro', 'duplicação é cadastro: vem antes de otimizar')

// 6) playbook de duplicação (treinamento)
assert.deepEqual(duplicacao.gatilhos.map(g => g.id), ['G1', 'G2', 'G3', 'G4', 'G5'])
assert.deepEqual(duplicacao.tipos.map(t => t.id), ['teste_ab', 'novos_publicos', 'primeira_pagina', 'kit_combo', 'recuperacao'])
const T = id => duplicacao.tipos.find(t => t.id === id).volume
assert.deepEqual([T('teste_ab').min, T('teste_ab').max], [2, 2]); assert.deepEqual([T('novos_publicos').min, T('novos_publicos').max], [5, 10]); assert.equal(T('primeira_pagina').max, 10); assert.equal(T('kit_combo').max, null)
assert.ok(duplicacao.gatilhos.filter(g => !g.verificavel_por_dados).map(g => g.id).join() === 'G3,G5', 'G3 e G5 dependem da pesquisa do consultor: o sistema NÃO finge que sabe por dados')
assert.match(duplicacao.urgencia_oculta.regra, /SEMPRE responsabilidade do consultor/); assert.equal(duplicacao.erros_comuns.length, 5); assert.equal(duplicacao.checklist.consultor.length, 5); assert.equal(duplicacao.checklist.analista.length, 5)
assert.ok(base.processos.some(p => p.id === '6.17' && p.blocos.some(b => b.canal === 'ML' && b.passos.length >= 5)), 'o Manual descreve a duplicação no ML e na Shopee')
// 7) o que vai no card: o roteiro inteiro (o David estruturou o passo a passo elementar), sem teto, e um JSON para outro sistema executar
{
  // "Cadastrar custos" é planilha de custo, não cadastro de produto: NUNCA pode receber o roteiro 6.1
  assert.equal(familiaDeDemanda('Cadastrar custos').id, 'custos')
  assert.equal(roteiro({ demanda: 'Cadastrar custos', canal: 'ML' }), null, 'custos não vira roteiro de cadastro de produto')
  // demandas do plano que não estão no MAPA mas têm passo a passo no Manual caem nos extras (fonte 'manual')
  const full = roteiro({ demanda: 'Planejamento full', canal: 'ML' }); assert.equal(full?.processo, '11.7'); assert.equal(full.fonte, 'manual'); assert.ok(full.passos.length >= 5)
  const camp = roteiro({ demanda: 'Campanhas de Desconto', canal: 'ML' }); assert.equal(camp?.processo, '9.6'); assert.ok(camp.passos.length >= 4)
  assert.equal(roteiro({ demanda: 'Planejamento full', canal: 'ML', incluirExtras: false }), null, 'sem extras o MAPA não tem Full')
  // MAPA continua vencendo quando casa (fonte 'mapa'), e a família 'outra:' não casa nada por família
  assert.equal(roteiro({ demanda: 'Duplicar anúncios', canal: 'ML' }).fonte, 'mapa')
  assert.equal(roteiro({ demanda: 'Reunião de Alinhamento', canal: 'ML' }), null)
  // extras por canal: processos do Manual com passo a passo e fora do MAPA, com fonte marcada e passos numerados
  const ex = extras({ canal: 'ML' })
  assert.ok(ex.length >= 8 && ex.every(e => e.fonte === 'manual' && e.bloco?.passos.length >= 3 && e.bloco.passos.every((p, i) => p.n === i + 1)), 'extras ML')
  assert.ok(!ex.some(e => catalogo({ canal: 'ML' }).some(m => m.processo === e.processo)), 'extra nunca repete item do MAPA')
  // processo completo para a API /api/processos/:id
  const pc = processoCompleto('6.1', 'ML'); assert.equal(pc.fonte, 'mapa'); assert.equal(pc.roteiro.passos.length, 10); assert.equal(processoCompleto('11.7', 'ML').fonte, 'manual'); assert.equal(processoCompleto('99.9', 'ML'), null)
  // o card: nada de slice no roteiro, JSON estruturado num toggle, lotes de 100 blocos
  const src = readFileSync(new URL('../src/lib/distribuir-notion.js', import.meta.url), 'utf8')
  assert.ok(!/passos \|\| \[\]\)\.slice\(/.test(src) && !/evidencia\.slice\(0, 5\)/.test(src) && !/como\.slice\(0, 8\)/.test(src) && !/blocos\.slice\(0, 100\)/.test(src), 'o roteiro vai inteiro para o card')
  assert.match(src, /Roteiro estruturado \(JSON, para automação\)/); assert.match(src, /language: 'json'/); assert.match(src, /blocks\/\$\{pg\.id\}\/children/)
  const rotas = readFileSync(new URL('../src/rotas-planos.js', import.meta.url), 'utf8')
  assert.match(rotas, /\/api\/processos\/:id/); assert.match(rotas, /extras: Object\.fromEntries/)
}
console.log('teste-processos: OK')

