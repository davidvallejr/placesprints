// Autoteste do texto ao cliente no tom aprovado pelo David (12/10/2026): src/lib/plano-semana-texto.js — PURO, sem banco nem rede.
// Cobre: abertura pelos 3 cenários de variação (+ janela com lacuna), título do plano, logística Full/sem Full/misto, «menos de 1 dia», nomes repetidos, estoque parado
// nunca com venda em 28 dias, entregas com os critérios (criado / não vendia / triplicou, ≥ R$ 300, kit só pelo anúncio criado), teto de 5 ações e ordem, alinhamento,
// blocos dos gatilhos (preço, perguntas, lembrete), urgente curto, nada de «O que depende de você», auditor (só as frases fixas e o link do anúncio saem do crivo).
// Rodar: node scripts/teste-plano-semana-texto.mjs
import assert from 'node:assert/strict'
import { montarPlanoSemanal, montarUrgente, avaliarEntrega, semFixos, auditarMensagem, nome, nomesDe, diasTxt, ABERTURA, FECHO, ASSINATURA, NOTA, MAX_ACOES } from '../src/lib/plano-semana-texto.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'

let n = 0
const ok = (nome0, fn) => { try { fn(); n++; console.log('✔', nome0) } catch (e) { console.error('✘ FALHOU:', nome0); throw e } }
const L = { cobertura_critica_dias: 10, lead_time_reposicao_dias: 21, min_unidades_item: 3 }
const LINK = id => `https://produto.mercadolivre.com.br/MLB-${id}-produto-_JM`
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: LINK(id), curva: 'A', status: 'active', cobertura: 5, estoque: 10, ponto_reposicao: 40, vel_dia: 2, logistica: '', r: 1400, u: 56, sug: { conservador: 20, base: 25 }, ...o })
const base = (o = {}) => ({ rotulo: 'União Dog', hoje: '2026-10-19', resumo: { gmv: 20578.11, pedidos: 346, variacao_pct: 5.9 }, itens: [], fullParado: [], entregas: [], custosInformados: false, limiares: L, ...o })
const audita = t => auditarMensagem(t, auditarTexto, { nomesInternos: ['Giovanna Torres'], permitidos: ['União Dog'] })

ok('abertura pelo número real: ≥ +3% «foram bons… X% acima»; entre −3 e +3 «ritmo estável»; ≤ −3% «X% abaixo» + título «proteger e retomar»; sem as duas janelas inteiras, nada de acima/abaixo', () => {
  const t = v => montarPlanoSemanal(base({ resumo: { gmv: 20578.11, pedidos: 346, variacao_pct: v } })).texto
  assert.match(t(5.9), /\*Plano para manter o ritmo de vendas · União Dog · 19\/10\*\n\nOs últimos 28 dias foram bons: \*R\$ 20\.578\* em vendas e 346 pedidos, \*6% acima\* do período anterior\. Para manter e acelerar esse ritmo/)
  assert.match(t(2.4), /\*Plano para manter o ritmo de vendas · União Dog · 19\/10\*\n\nNos últimos 28 dias foram \*R\$ 20\.578\* em vendas e 346 pedidos, um ritmo estável em relação ao período anterior\. Para crescer a partir daqui/)
  assert.match(t(-2.6), /3% abaixo/, '−2,6% arredonda para −3: abaixo (o corte usa o número arredondado, como o modelo aprovado)')
  assert.match(t(-3.4), /\*Plano para proteger e retomar as vendas · União Dog · 19\/10\*\n\nNos últimos 28 dias foram \*R\$ 20\.578\* em vendas e 346 pedidos, 3% abaixo do período anterior\. Separei o que vale priorizar agora para proteger o faturamento e retomar o ritmo:/)
  const sem = t(null); assert.match(sem, /Nos últimos 28 dias foram \*R\$ 20\.578\* em vendas e 346 pedidos\. Separei o que vale priorizar agora:/); assert.doesNotMatch(sem, /acima|abaixo|estável/, 'dia sem coleta não é zero')
  const x = t(5.9); assert.ok(x.startsWith(ABERTURA + '\n\n')); assert.ok(x.endsWith(`${FECHO}\n${ASSINATURA}\n${NOTA}`)); assert.match(x, /\n🎯 \*O plano da semana\*\n\n\*1\.\* 📊 \*Compartilhar a planilha de custos para darmos o próximo passo\*/)
  assert.ok(montarPlanoSemanal(base({ previa: true })).texto.startsWith('_PRÉVIA — exemplo com dados reais de União Dog. Não foi enviado ao cliente._\n\n'))
})

ok('📦 logística: todos no Full «Abastecer o Full…» + enviar + remessa; nenhum «Repor o estoque…» + repor + reposição; misto com a tag (Full) só nos do Full; «menos de 1 dia» quando < 1; data-limite = hoje + (menor cobertura − 1), mínimo 1 dia; quantidade conservador a base (ou uma só)', () => {
  const urg = log => [it('1', { cobertura: 0, estoque: 0, logistica: log[0] }), it('2', { cobertura: 6, estoque: 12, logistica: log[1], sug: { conservador: 15, base: 15 } })]
  const full = montarPlanoSemanal(base({ itens: urg(['fulfillment', 'fulfillment']) })).texto
  assert.match(full, /📦 \*Abastecer o Full para os campeões de venda não pararem\*\nEstes produtos estão girando rápido: juntos vendem cerca de \*R\$ 700 por semana\*\. No ritmo atual, o estoque deles no Full dura menos de 1 dia a 6 dias\. Quando um campeão zera, o anúncio pausa e sai da busca até a remessa chegar, e as vendas desses dias não voltam\. Com a remessa chegando \*até 20\/10\*, a vitrine segue cheia e o ritmo continua:/)
  assert.match(full, /• Produto 1: tem 0 un \(menos de 1 dia\) → sugerimos enviar \*20 a 25 un\*\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-1-produto-_JM\n• Produto 2: tem 12 un \(~6 dias\) → sugerimos enviar \*15 un\*/); assert.doesNotMatch(full, /\(Full\)/)
  const proprio = montarPlanoSemanal(base({ itens: urg(['self_service', '']) })).texto
  assert.match(proprio, /📦 \*Repor o estoque dos campeões de venda para eles não pararem\*/); assert.match(proprio, /o estoque deles dura/); assert.match(proprio, /até a reposição chegar/); assert.match(proprio, /sugerimos repor \*20 a 25 un\*/); assert.doesNotMatch(proprio, /enviar|\(Full\)|no Full dura/)
  const misto = montarPlanoSemanal(base({ itens: urg(['fulfillment', 'self_service']) })).texto
  assert.match(misto, /📦 \*Repor o estoque e abastecer o Full dos campeões de venda\*/); assert.match(misto, /• Produto 1 \(Full\): tem 0 un \(menos de 1 dia\) → sugerimos enviar/); assert.match(misto, /• Produto 2: tem 12 un \(~6 dias\) → sugerimos repor \*15 un\*/)
  const um = montarPlanoSemanal(base({ itens: [it('9', { cobertura: 4, estoque: 8 })] })).texto
  assert.match(um, /Este produto está girando rápido: vende cerca de \*R\$ 350 por semana\*\. No ritmo atual, o estoque dele dura 4 dias\./, 'singular'); assert.match(um, /\*até 22\/10\*/)
  assert.doesNotMatch(montarPlanoSemanal(base({ itens: [it('9', { sug: null })] })).texto, /sugerimos/, 'sem sugestão de quantidade, sem número')
  // fora do 📦: curva C, pausado, sem venda por dia, sem ponto de reposição, cobertura acima da crítica (vai para 🔄 se estoque ≤ ponto)
  const fora = montarPlanoSemanal(base({ itens: [it('c', { curva: 'C' }), it('p', { status: 'paused' }), it('v', { vel_dia: 0 }), it('s', { ponto_reposicao: null }), it('k', { cobertura: 12, estoque: 24 })] }))
  assert.deepEqual(fora.blocos, ['ciclo', 'custos']); assert.match(fora.texto, /🔄 \*Já deixar o próximo pedido ao fornecedor encaminhado\*\nPara o estoque não acabar antes de a reposição chegar, vale incluir este no próximo pedido\. Consideramos 21 dias entre o pedido e a chegada; se o seu fornecedor entrega mais rápido ou mais devagar, conta pra gente que ajustamos o cálculo:\n• Produto k: 24 un \(~12 dias\) · vende ~R\$ 350\/semana/)
})

ok('nomes repetidos ganham o título completo; nome curto em 6 palavras sem conector nem parêntese aberto no fim', () => {
  assert.equal(nome('Kit 2 Roldana 3 Polegada (7,5 cm) Suporte P Portão'), 'Kit 2 Roldana 3 Polegada'); assert.equal(nome('Guia Longa Para Cães 5 Metros Reforçada'), 'Guia Longa Para Cães 5 Metros'); assert.equal(nome('Coleira para de Cachorro'), 'Coleira para de Cachorro')
  assert.equal(nome('Coleira Guia Peitoral Ajustável Nylon Para Cães'), 'Coleira Guia Peitoral Ajustável Nylon', 'conector solto no fim sai')
  const l = [{ titulo: 'Ração Premium 15kg Para Cães Adultos Carne' }, { titulo: 'Ração Premium 15kg Para Cães Adultos Frango' }, { titulo: 'Bebedouro Automático Inox Grande Para Cães Médios' }]
  assert.deepEqual(nomesDe(l), ['Ração Premium 15kg Para Cães Adultos Carne', 'Ração Premium 15kg Para Cães Adultos Frango', 'Bebedouro Automático Inox Grande Para Cães'])
  const t = montarPlanoSemanal(base({ itens: [it('1', { titulo: l[0].titulo }), it('2', { titulo: l[1].titulo })] })).texto
  assert.match(t, /• Ração Premium 15kg Para Cães Adultos Carne: tem/); assert.match(t, /• Ração Premium 15kg Para Cães Adultos Frango: tem/)
})

ok('nomes sem palavra cortada nem pontuação solta (14/10): corte de 70 por palavra inteira; empate no corte = começo… fim; número no fim leva a unidade; «~1 dia»', () => {
  assert.equal(nome('Kit Dermopés Afina 230g, Restaura 230g, Milagre 230g'), 'Kit Dermopés Afina 230g, Restaura 230g', 'vírgula solta no fim sai')
  assert.equal(nome('Perfume Masculino Mishlah Edp Lattafa 100 Ml Original'), 'Perfume Masculino Mishlah Edp Lattafa 100 Ml')
  assert.equal(nome('Sabre Saibre 14 Ms 170/180/025/250 25 Dentes'), 'Sabre Saibre 14 Ms 170/180/025/250 25 Dentes')
  const kit = c => ({ titulo: `Kit 2 Rolos Fio Crô Premium Algodão Para Crochê E Tricô 600gr ${c}` })
  const [a, b] = nomesDe([kit('Marrom/café'), kit('Bege Escuro')])
  assert.ok(!/Marrom\/ca$|Bege Escu$/.test(a + '|' + b) && a !== b, `${a} | ${b}`)
  assert.match(a, /600gr Marrom\/café$/, 'o corte «… 600gr» é o começo do outro título: segue até a palavra que difere'); assert.match(b, /600gr Bege$/)
  const cor = c => ({ titulo: `Puxa Saco Dispenser Sacola Plástica Fixação Adesiva 3m Cores Cor ${c} Com Fixação Adesiva 3m` })
  assert.deepEqual(nomesDe([cor('Cinza'), cor('Laranja')]), ['Puxa Saco Dispenser Sacola Plástica Fixação Adesiva 3m Cores Cor Cinza', 'Puxa Saco Dispenser Sacola Plástica Fixação Adesiva 3m Cores Cor Laranja'], 'a cor no meio do título continua no nome')
  const gr = q => ({ titulo: `Grampo Para Grampeador 26/6 Galvanizado 10 ${q} Galvanizado Rocama Original` })
  assert.deepEqual(nomesDe([gr('Caixa 50 Mil Un'), gr('Caixas 5000 Uni')]).map(x => x.length > 55), [true, true], '«10 Caixa» × «10 Caixas»: o corte seco de 6 palavras empata, então vão os títulos completos')
  assert.equal(nome('Kit 2 Conjuntos Fitness Modelador Preto E Marrom'), 'Kit 2 Conjuntos Fitness Modelador Preto'); assert.equal(nome('Shampoo Lavatório Kit 2 Peças 4 Em 1'), 'Shampoo Lavatório Kit 2 Peças 4')
  assert.equal(nomesDe([{ titulo: 'Fantasia Sky Patrulha Canina Macacão Feminino Completo Estampa Infantil Festa Tamanho 4' }, { titulo: 'Fantasia Sky Patrulha Canina Macacão Feminino Outro' }])[0],
    'Fantasia Sky Patrulha Canina Macacão Feminino Completo Estampa', 'corte de 70 por palavra inteira')
  // universo: o nome curto que só é único NA LISTA mas repete na conta ganha o título completo
  assert.equal(nomesDe([kit('Marrom/café')])[0], 'Kit 2 Rolos Fio Crô Premium')
  assert.match(nomesDe([kit('Marrom/café')], [kit('Marrom/café'), kit('Bege Escuro')])[0], /Marrom\/café$/)
  assert.equal(diasTxt(1), '~1 dia'); assert.equal(diasTxt(2), '~2 dias'); assert.equal(diasTxt(0), 'menos de 1 dia')
})

ok('verbo pela FAMÍLIA da tarefa, nunca por palavra solta no título (Moema: «Criar anúncio… já otimizado» não é «Otimizamos»)', () => {
  const e = o => ({ titulo: 'Bloqueador De Odores P/lixeiras', permalink: '', dia: '2026-09-03', criado: false, semVendaAntes: true, aumento: false, pre: 0, pos: 7, unidades: 10, receita: 340, ...o })
  assert.match(montarPlanoSemanal(base({ entregas: [e({ acao: 'Cadastro de Produtos Criar anúncio fora de catalogo, já otimizado', familia: 'cadastro' })] })).texto, /• \*Trabalhamos\* o anúncio Bloqueador/)
  assert.match(montarPlanoSemanal(base({ entregas: [e({ acao: 'x', familia: 'otimizar' })] })).texto, /• \*Otimizamos\* o anúncio/)
  assert.match(montarPlanoSemanal(base({ entregas: [e({ acao: 'Otimizar', familia: 'cadastro', criado: true, semVendaAntes: false })] })).texto, /• \*Criamos\* o anúncio/)
})

ok('💡 estoque parado do Full: nunca o item que vendeu nos últimos 28 dias; alinhamento (descontinuado) tira; «(contando pela última venda)» quando a idade é estimada', () => {
  const fullParado = [{ item_id: 'F1', disponivel: 3, dias: 60, idade_dias: null, titulo: 'Guia Unificada Bella Coleira União Dog' }, { item_id: 'F2', disponivel: 2, dias: 118, idade_dias: null, titulo: 'Guia Longa Para Cães 5 Metros' }, { item_id: 'F3', disponivel: 9, dias: 90, idade_dias: null, titulo: 'Campeão que vende' }]
  const p = montarPlanoSemanal(base({ itens: [it('F3', { curva: 'C', u: 4 })], fullParado }))
  assert.match(p.texto, /💡 \*Transformar o estoque parado do Full em venda \(ou em espaço\)\*\n5 unidades em 2 anúncios estão sem vender há 60 dias ou mais \(contando pela última venda\)\. Elas ocupam espaço no Full e podem virar caixa/)
  assert.match(p.texto, /• Guia Unificada Bella Coleira União Dog: 3 un, 60 dias sem venda\n• Guia Longa Para Cães 5 Metros: 2 un, 118 dias sem venda/); assert.doesNotMatch(p.texto, /Campeão que vende/, 'vendeu em 28 dias: nunca parado')
  const um = montarPlanoSemanal(base({ fullParado: [{ ...fullParado[0], disponivel: 1, idade_dias: 70, dias: 70 }] })).texto
  assert.match(um, /1 unidade em 1 anúncio está sem vender há 70 dias ou mais\. Ela ocupa espaço no Full e pode virar caixa/); assert.doesNotMatch(um, /contando pela última venda/)
  const livre = (regra, id) => !(regra === 'full_estoque_antigo' && id === 'F1')
  assert.doesNotMatch(montarPlanoSemanal(base({ fullParado, livre })).texto, /Bella Coleira/, 'alinhado com o cliente (descontinuado): fora')
  assert.doesNotMatch(montarPlanoSemanal(base({ itens: [it('1')], livre: r => r !== 'estoque_ruptura' })).texto, /📦/, 'ruptura alinhada: sem 📦')
  assert.doesNotMatch(montarPlanoSemanal(base({ livre: r => r !== 'cadastrar_custos' })).texto, /planilha de custos/, 'custos alinhados: sem 📊')
})

ok('✅ entregas: criado pela equipe, ou não vendia antes (≥ 14 dias coletados), ou triplicou com ≥ 5 un depois; sempre ≥ R$ 300; kit só pelo anúncio criado; texto de fato («desde então»), nunca causa', () => {
  const e = o => avaliarEntrega({ criado: false, pre: 0, pos: 0, cobertura: 28, receitaDesde: 500, kit: false, ...o })
  assert.deepEqual(e({ criado: true }), { semVendaAntes: false, aumento: false })
  assert.deepEqual(e({ pre: 0, pos: 3 }), { semVendaAntes: true, aumento: false }); assert.equal(e({ pre: 0, pos: 3, cobertura: 13 }), null, 'sem 14 dias coletados não afirma «não vendia»')
  assert.equal(e({ pre: 0, pos: 0 }), null, '«lancamento» sem nenhuma venda depois não é «está dando resultado» (achado da Bima)')
  assert.equal(e({ pre: 1, pos: 12, diasDesde: 20 }), null, 'entrega de 20 dias atrás: os «28 dias seguintes» ainda não existem'); assert.ok(e({ pre: 1, pos: 12, diasDesde: 29 }).aumento, '29 dias: janela inteira')
  assert.deepEqual(e({ pre: 1, pos: 12 }), { semVendaAntes: false, aumento: true }); assert.equal(e({ pre: 2, pos: 5 }), null, '5 < 3 × 2'); assert.equal(e({ pre: 1, pos: 4 }), null, '≥ 5 un depois'); assert.deepEqual(e({ pre: 2, pos: 6 }), { semVendaAntes: false, aumento: true })
  assert.equal(e({ pre: 1, pos: 12, preInteiro: false }), null, 'anúncio que não existia nos 28 dias antes inteiros (Click Beauty, 14 dias): nada de «triplicou»')
  assert.equal(e({ criado: true, receitaDesde: 299 }), null, '≥ R$ 300'); assert.equal(e({ pre: 0, pos: 3, kit: true }), null, 'tarefa de kit só pelo anúncio criado'); assert.ok(e({ criado: true, kit: true }))
  const entregas = [
    { titulo: 'Mordedor Para Cães Natural Trança Bovina Natuka', permalink: LINK('6651686750'), dia: '2026-06-19', criado: false, semVendaAntes: false, aumento: true, pre: 1, pos: 12, unidades: 57, receita: 2971.4, acao: 'Otimização de anúncio', familia: 'otimizar' },
    { titulo: 'Colar Para Adestramento Tamanho M Cores', permalink: LINK('5944406562'), dia: '2026-06-12', criado: false, semVendaAntes: true, aumento: false, pre: 0, pos: 6, unidades: 13, receita: 737, acao: 'Corrigir ficha técnica', familia: 'corrigir' },
    { titulo: 'Kit 3 Cascos Bovinos', permalink: '', dia: '2026-09-01', criado: true, semVendaAntes: false, aumento: false, pre: 0, pos: 9, unidades: 9, receita: 410, acao: 'Criar kit', familia: 'kits' },
    { titulo: 'Quarto que não entra', permalink: '', dia: '2026-09-01', criado: true, unidades: 1, receita: 300, acao: 'x' }]
  const t = montarPlanoSemanal(base({ entregas })).texto
  assert.match(t, /✅ \*O que já fizemos e está dando resultado\*\n• \*Otimizamos\* o anúncio Mordedor Para Cães Natural Trança Bovina em 19\/06: nos 28 dias antes vendeu 1; nos 28 dias seguintes, 12\. Desde então já são \*57 unidades vendidas \(R\$ 2\.971\)\*\.\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-6651686750-produto-_JM/)
  assert.match(t, /• \*Corrigimos\* o anúncio Colar Para Adestramento Tamanho M Cores em 12\/06 \(ele não vinha vendendo\): desde então, \*13 unidades vendidas \(R\$ 737\)\*\./)
  assert.match(t, /• \*Criamos\* o anúncio Kit 3 Cascos Bovinos em 01\/09: desde então, \*9 unidades vendidas \(R\$ 410\)\*\.\n\n🎯/); assert.doesNotMatch(t, /Quarto que não entra/, 'até 3'); assert.doesNotMatch(t, /graças|por causa|resultado d[aeo] nossa/i)
  assert.doesNotMatch(montarPlanoSemanal(base()).texto, /✅/, 'sem entrega, sem o bloco')
})

ok('blocos dos gatilhos do cliente (linhas já auditadas): preço mudado fora da Place2u, perguntas, retorno, Full sugerido e o lembrete da queda por preço; ordem (📦 · queda · preço · 🔄 · 💡 · 📊 · perguntas · Full · retorno) e teto de 5 ações; blocos diz o que entrou', () => {
  const extras = [
    { tipo: 'perguntas_sem_resposta', texto: '2 pergunta(s) de compradores sem resposta há mais de 24 horas. Responder rápido ajuda quem está decidindo a compra.' },
    { tipo: 'preco_alterado_drastico', texto: 'O preço de Coleira mudou de R$ 50,00 para R$ 80,00 (+60%) em 11/10, fora das ações da Place2u. Se foi intencional, é só avisar para considerarmos no acompanhamento; se não foi, vale revisar.' },
    { tipo: 'preco_alterado_drastico', texto: 'O preço de Guia mudou de R$ 30,00 para R$ 45,00 (+50%) em 12/10, fora das ações da Place2u. Se foi intencional, é só avisar para considerarmos no acompanhamento; se não foi, vale revisar.' },
    { tipo: 'queda_por_preco', texto: '• Areia: preço de R$ 20,00 para R$ 26,00 em 01/10; desde então, as vendas desse anúncio caíram 42,5% enquanto os anúncios sem mudança ficaram estáveis.\nÉ uma associação medida, não prova de causa: vale revisar o preço com a gente.', lembrete: true },
    { tipo: 'dependencia_vencida', texto: 'Documentos: aguardando seu retorno desde 24/09. Enviar os documentos.' },
    { tipo: 'envio_full_sugerido', texto: 'Estes anúncios vendem bem e ainda estão fora do Full: Shampoo: enviar ~12 un. É sugestão: nada é movimentado por aqui.' },
    { tipo: 'tipo_desconhecido', texto: 'não entra' }]
  const p = montarPlanoSemanal(base({ itens: [it('1', { cobertura: 3, estoque: 6 }), it('2', { cobertura: 15, estoque: 30 })], fullParado: [{ item_id: 'F', disponivel: 2, dias: 80, idade_dias: null, titulo: 'Parado' }], extras }))
  assert.equal(MAX_ACOES, 5); assert.deepEqual(p.blocos, ['ruptura', 'queda_por_preco', 'preco_alterado_drastico', 'ciclo', 'parado']); assert.equal(p.n_acoes, 5)
  assert.match(p.texto, /\*2\.\* 📉 \*Lembrete: rever o preço que pode estar segurando as vendas\*\n• Areia: preço de R\$ 20,00/)
  assert.match(p.texto, /\*3\.\* 🏷️ \*Conferir o preço que mudou fora das nossas ações\*\n• O preço de Coleira mudou[^\n]+\n• O preço de Guia mudou/)
  assert.doesNotMatch(p.texto, /planilha de custos|pergunta\(s\)|não entra/, 'acima do teto fica para a próxima semana (a linha não é marcada)')
  const so = montarPlanoSemanal(base({ custosInformados: true, extras: extras.slice(0, 1) }))
  assert.deepEqual(so.blocos, ['perguntas_sem_resposta']); assert.match(so.texto, /\*1\.\* 💬 \*Responder as perguntas dos compradores\*\n2 pergunta\(s\)/)
  assert.deepEqual(montarPlanoSemanal(base({ custosInformados: true })), { texto: '', n_acoes: 0, blocos: [], usados: [] }, 'nada a fazer = nada a enviar')
  const rup = montarPlanoSemanal(base({ itens: [it('1', { cobertura: 2, estoque: 4 })], jaAvisados: ['1'] })).texto
  assert.match(rup, /• Produto 1: tem 4 un \(~2 dias\) → sugerimos repor \*20 a 25 un\* _\(lembrete: já avisamos nos últimos dias\)_/)
})

ok('nomes repetidos ENTRE blocos (achado da Photo K): a mesma família no 📦 e no 💡 sai com títulos distintos; no 💡 e no ✅ também vale', () => {
  const A = 'Fantasia Cachorro Policial Infantil Completa Macacão Azul 3', B = 'Fantasia Cachorro Policial Infantil Completa Macacão Azul 1'
  const t = montarPlanoSemanal(base({ itens: [it('A3', { titulo: A, logistica: 'fulfillment' })], fullParado: [{ item_id: 'A1', disponivel: 2, dias: 80, idade_dias: 80, titulo: B }] })).texto
  assert.match(t, /• Fantasia Cachorro Policial Infantil Completa Macacão Azul 3: tem 10 un/); assert.match(t, /• Fantasia Cachorro Policial Infantil Completa Macacão Azul 1: 2 un, 80 dias sem venda/)
  assert.doesNotMatch(t, /• Fantasia Cachorro Policial Infantil Completa Macacão:/, 'nunca o mesmo nome curto em dois blocos')
  const p2 = montarPlanoSemanal(base({ fullParado: [{ item_id: 'P1', disponivel: 2, dias: 80, idade_dias: 80, titulo: B }, { item_id: 'P3', disponivel: 1, dias: 90, idade_dias: 90, titulo: A }] })).texto
  assert.match(p2, /Azul 1: 2 un/); assert.match(p2, /Azul 3: 1 un/, '💡: duas variações paradas nunca saem com linhas iguais')
  const p3 = montarPlanoSemanal(base({ itens: [it('A3', { titulo: A })], entregas: [{ titulo: B, permalink: '', dia: '2026-06-01', criado: true, unidades: 9, receita: 900, acao: 'Duplicar' }] })).texto
  assert.match(p3, /\*Criamos\* o anúncio Fantasia Cachorro Policial Infantil Completa Macacão Azul 1 em 01\/06/, '✅ entra no mesmo cálculo de nomes')
})

ok('auditor por produto (achado da Rotec, «Nº1»): título reprovado tira só a linha daquele produto — o resto do plano sai; 📦 = predicado da regra estoque_ruptura (cobertura < crítica e vendas ≥ mínimo)', () => {
  const tituloOk = t => !auditarTexto(t, { nomesInternos: [], permitidos: ['União Dog'] }).length
  const rotec = 'Dobradiça Gonzo Com Abas Nº1 -5/8 X 3/4 N1- 2 Peças'
  assert.ok(!tituloOk(rotec), 'controle: o gabarito barra «Nº1»')
  const p = montarPlanoSemanal(base({ itens: [it('1', { titulo: rotec }), it('2', { titulo: 'Kit 2 Roldana Guia Portão' })], fullParado: [{ item_id: 'F', disponivel: 2, dias: 80, idade_dias: 80, titulo: rotec }], tituloOk }))
  assert.match(p.texto, /• Kit 2 Roldana Guia Portão: tem 10 un/); assert.doesNotMatch(p.texto, /Dobradiça|💡/); assert.deepEqual(audita(p.texto), [], 'o plano que sai passa no auditor inteiro')
  assert.deepEqual(p.blocos, ['ruptura', 'custos'])
  // 📦: u = 2 (< min_unidades_item 3) ou cobertura = 10 (não é < 10) ficam fora — iguais ao Algoritmo; com estoque ≤ ponto, vão para o 🔄
  const q = montarPlanoSemanal(base({ itens: [it('u', { u: 2 }), it('k', { cobertura: 10, estoque: 20 })] }))
  assert.deepEqual(q.blocos, ['ciclo', 'custos'], 'sem 📦: nenhum dos dois é ruptura para o Algoritmo')
})

ok('linhas de gatilho com teto por bloco (maxLinhas) + «e mais N»; usados = só as linhas que entraram no texto (o resto espera a próxima segunda)', () => {
  const extras = Array.from({ length: 60 }, (_, k) => ({ id: 100 + k, tipo: 'preco_alterado_drastico', texto: `O preço de Produto ${k} mudou de R$ 10,00 para R$ 13,00 (+30%) em 15/10, fora das ações da Place2u. Se foi intencional, é só avisar para considerarmos no acompanhamento; se não foi, vale revisar.` }))
  const p = montarPlanoSemanal(base({ custosInformados: true, extras }))
  assert.equal(p.texto.match(/mudou de R\$/g).length, 3); assert.match(p.texto, /\n• e mais 57 pontos do mesmo tipo\n/); assert.deepEqual(p.usados, [100, 101, 102])
  assert.ok(p.texto.split('\n').filter(l => l.trim()).length < 40, 'nada de parede de texto')
  assert.deepEqual(montarPlanoSemanal(base({ custosInformados: true, extras: extras.slice(0, 4), maxLinhas: 2 })).usados, [100, 101])
})

ok('urgente: «Oi, time {rótulo}! Passando rapidinho…», até 3 pontos com cabeçalho e o fato (número e link), fecho e assinatura; a nota de estimativa só com quantidade estimada', () => {
  const u = montarUrgente({ rotulo: 'Rotec', itens: [{ tipo: 'envio_atrasado', texto: '2 pedido(s) com prazo de despacho vencido. Despachar ainda hoje protege a reputação da sua conta.' }] })
  assert.equal(u.texto, `Oi, time Rotec! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:\n\n🚚 *Pedido com despacho vencido*\n2 pedido(s) com prazo de despacho vencido. Despachar ainda hoje protege a reputação da sua conta.\n\nSe já está encaminhado, é só responder aqui com a data prevista que a gente ajusta o acompanhamento. Conte com a gente! 🤝\n${ASSINATURA}`)
  const v = montarUrgente({ rotulo: 'Rotec', itens: [{ tipo: 'ruptura_curva_a', texto: `• Kit 2 Roldana: tem 3 un (~1 dias) → sugerimos enviar *250 a 300 un*\n  ${LINK('6882472560')}\nQuando o estoque zera…` }, { tipo: 'reputacao_em_risco', texto: 'Nível amarelo…' }, { tipo: 'anuncio_restrito', texto: '1 anúncio…' }, { tipo: 'reclamacao_mediacao', texto: 'quarto' }] })
  assert.equal(v.n, 3); assert.match(v.texto, /^Oi, time Rotec! Passando rapidinho com pontos importantes da sua conta no Mercado Livre:\n\n\*1\.\* 📦 \*Estoque acabando nos campeões de venda\*\n• Kit 2 Roldana/)
  assert.match(v.texto, /\*2\.\* 🛡️ \*Reputação pedindo atenção\*\nNível amarelo…\n\n\*3\.\* ⏸️ \*Anúncio que vendia está fora do ar\*/); assert.doesNotMatch(v.texto, /quarto/); assert.ok(v.texto.endsWith(`${ASSINATURA}\n${NOTA}`))
  assert.deepEqual(montarUrgente({ rotulo: 'X', itens: [] }), { texto: '', n: 0 })
})

ok('nunca «O que depende de você», promessa ou culpa; auditor: o texto inteiro passa, só as frases fixas aprovadas e o link do anúncio do ML saem do crivo (o resto continua barrado)', () => {
  const extras = [{ tipo: 'perguntas_sem_resposta', texto: '2 pergunta(s) de compradores sem resposta há mais de 24 horas.' }]
  const p = montarPlanoSemanal(base({ itens: [it('6882472560', { titulo: 'Kit Roldana Guia Portão', cobertura: 0, estoque: 0, logistica: 'fulfillment' }), it('4841540741', { titulo: 'Roldanas Aço Para Portão', cobertura: 20, estoque: 14 })], fullParado: [{ item_id: 'F', disponivel: 2, dias: 80, idade_dias: null, titulo: 'Parado' }], extras,
    entregas: [{ titulo: 'Mordedor Natural', permalink: LINK('6651686750'), dia: '2026-06-19', criado: true, unidades: 57, receita: 2971, acao: 'Criar anúncio' }] })).texto
  const u = montarUrgente({ rotulo: 'União Dog', itens: [{ tipo: 'ruptura_curva_a', texto: `• Produto: tem 1 un (~1 dias)\n  ${LINK('6167375724')}` }] }).texto
  for (const t of [p, u]) {
    assert.doesNotMatch(t, /O que depende de você|Aviso Place2u|resumo di[aá]rio/i); assert.doesNotMatch(t, /tenho certeza|garantid|garantimos|ranking|primeiro lugar|graças a|culpa|você esqueceu|você não/i)
    assert.deepEqual(audita(t), [], 'tom aprovado passa no auditor (linha a linha)')
    assert.ok(t.length > 1900 || t === u, 'o plano passa de 1900 caracteres: por isso o crivo é por linha (limite do Notion por trecho)')
    assert.ok(auditarTexto(t, { nomesInternos: [], permitidos: ['União Dog'] }).length > 0, 'controle: sem tirar as frases fixas e os links, o gabarito barraria o tom aprovado (Merovíngio, Place Sprints, «trouxe», link com ID)')
  }
  assert.deepEqual(auditarMensagem(ABERTURA + '\n' + FECHO + '\n' + ASSINATURA + '\n' + NOTA, auditarTexto), [], 'só as frases fixas')
  assert.deepEqual(auditarTexto(semFixos(p)).map(v => v.codigo), ['limite'], 'controle: num trecho só, o plano estoura o limite de 1900 do Notion — nada mais')
  // o que NÃO é fixo continua barrado: promessa no nome do produto, Merovíngio fora da assinatura, ID cru, analista
  const ruim = montarPlanoSemanal(base({ itens: [it('1', { titulo: 'Ração top 1 vendas garantidas' })] })).texto
  assert.deepEqual([...new Set(audita(ruim).map(v => v.codigo))].sort(), ['promessa'])
  assert.ok(audita(p + '\nO Merovíngio decidiu.').some(v => v.codigo === 'jargao')); assert.ok(audita(p + '\nAnúncio MLB6882472560').some(v => v.codigo === 'id_interno')); assert.ok(audita(p + '\nFeito pela Giovanna.').some(v => v.codigo === 'analista'))
  assert.ok(audita('Veja https://evil.test/MLB-6882472560-x').some(v => v.codigo === 'id_interno'), 'link de fora do Mercado Livre não sai do crivo')
})

console.log(`\n${n} verificações do texto do plano semanal ok.`)
