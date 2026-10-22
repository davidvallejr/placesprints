// Autoteste do «Hoje» (docs/ux/arquitetura-5-menus.md § B e § G «F5», 21/10/2026). Puro + estático: sem rede, sem banco, sem DOM.
//  (1) src/lib/fila.js: ≤ 5 blocos por papel (os 6), sem papel = líder; teto 10 por família → «limiar errado: N itens; ajuste em Estrutura › Regras do método»
//      e os itens somem da lista; isolamento por cliente (escopo); filtro ?etapa=; 1 só primário (o 1º item); regra fixa do item; fontes ausentes = «—» com motivo;
//      os 4 números; fontes vazias nunca lançam; cards do analista na ordem Eisenhower; botão SÓ com rota de escrita que já existe;
//  (2) telas: fila.html (esqueleto do shell, 0 primário estático), fila.js (--check, 1 .btn-primario só no template do 1º item, sem hex/emoji/style), tela-fila.css
//      só tokens, shell.js com .ps-hoje → /fila (sem fetch), app.js com o primário da Próxima ação → /fila, progresso.js com «N atrasados» → /fila, server.js
//      (app.get('/fila') + criarRotasFila depois do guardaLocal), PAGINAS e inventário;
//  (3) src/rotas-fila.js: só GET; papel inválido = líder; etapa fora de 1..10 = null; quem cortado em 80.
// Rodar: node scripts/teste-fila.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { montarFila, aplicarTeto, BLOCOS, PAPEIS, TETO_EXCECOES, LIMIAR_ERRADO, ETAPA, diasUteis } from '../src/lib/fila.js'
import { criarRotasFila } from '../src/rotas-fila.js'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let ok = 0
const falhas = []
const caso = async (nome, fn) => { try { await fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }
const EMOJI = /\p{Extended_Pictographic}|[\u{2600}-\u{27BF}]/u
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/
const ROTAS_ESCRITA = ['/api/planos/acoes/status', '/api/planos/distribuir', '/api/chaveiro/exec/aprovar', '/api/chaveiro/exec/vetar', '/api/cliente/preco/decisao', '/api/cliente/do-cliente/lembrete', '/api/gatilhos/preparar-lote', '/api/integracoes/meli/link', '/api/meli/restaurar']

const HOJE = '2026-10-21', AGORA = '2026-10-21T15:00:00.000Z'   // quarta
const acao = (id, cliente, p = 'P0', criado = '2026-10-10', status = 'proposta', regra = 'estoque_ruptura') => ({ id, cliente, regra, titulo: 'Ação ' + id, status, p, criado_em: criado + 'T10:00:00.000Z', atualizado_em: criado + 'T10:00:00.000Z' })
const FONTES = Object.freeze({
  contas: [{ cliente: 'Acme', erro: 'token inválido', conectado_em: '2026-09-01', restauravel: false }, { cliente: 'Zeta', erro: 'desconectada; conexão guardada', conectado_em: '', restauravel: true }],
  coleta: { coleta_em: '2026-10-19T03:00:00.000Z', sync_em: '2026-10-21T14:00:00.000Z', medicao_em: AGORA },
  empresa: [{ cliente: 'Acme', conectado_em: '2026-09-01T00:00:00.000Z', custo_pct: null, lead_time: false }, { cliente: 'Beta', conectado_em: '2026-09-01T00:00:00.000Z', custo_pct: 95, lead_time: true }],
  acoes: [acao('PS-1', 'Acme'), acao('PS-2', 'Acme', 'P1'), acao('PS-3', 'Beta', 'P0', '2026-10-20'), acao('PS-4', 'Beta', 'P2'), acao('PS-5', 'Acme', 'P0', '2026-10-01', 'aprovada'), acao('PS-6', 'Beta', 'P2', '2026-10-15', 'proposta', 'duplicacao_estrategica')],
  ordens: [{ id: 'CH-0000000001', cliente: 'Acme', operacao: 'preco', estado: 'aguardando_aprovacao', criado_em: '2026-10-21T08:00:00.000Z', regra: 'preco_acima' }, { id: 'CH-0000000002', cliente: 'Beta', operacao: 'status', estado: 'divergente', criado_em: '2026-10-20T08:00:00.000Z', regra: '' }],
  vetos: [{ cliente: 'Acme', operacao: 'preco', veto_ate: '2026-10-23T08:00:00.000Z' }, { cliente: 'Beta', operacao: 'fotos', veto_ate: '2026-10-20T08:00:00.000Z' }],
  cards: [{ id: 't1', cliente: 'Acme', titulo: 'Foto · PS-1', responsavel: 'Ana', status: 'andamento', last_edited: '2026-10-01T00:00:00.000Z', prazo: '2026-10-10', url: 'https://notion.so/t1', ps: true, quadrante: 'agendar' }, { id: 't2', cliente: 'Beta', titulo: 'Chat ao vivo', responsavel: 'Ana', status: 'nao_iniciada', last_edited: '2026-10-21T00:00:00.000Z', prazo: '', url: '', ps: false, quadrante: 'fazer' }, { id: 't3', cliente: 'Beta', titulo: 'Custos · PS-9', responsavel: 'Ana', status: 'dependencia_cliente', last_edited: '2026-10-01T00:00:00.000Z', prazo: '', url: '', ps: true, quadrante: null }],
  dependencias: [{ cliente: 'Acme', titulo: 'Custos', dias: 35, chave: 'custos|ml', o_que_precisamos: 'planilha de custos' }, { cliente: 'Beta', titulo: 'Custos', dias: 20, chave: '' }, { cliente: 'Beta', titulo: 'Fotos', dias: 3, chave: 'midia|ml' }],
  lotes: [{ cliente: 'Acme', tipo: 'semanal', dia: '2026-10-20', estado: 'falhou', motivo: 'n8n_500', criado_em: '2026-10-20T12:00:00.000Z' }, { cliente: 'Beta', tipo: 'semanal', dia: '2026-10-20', estado: 'bloqueado', motivo: 'auditor:promessa', criado_em: '2026-10-20T12:00:00.000Z' }],
  relatorios: [{ cliente: 'Acme', estado: 'falhou', motivo: 'notion_403', em: '2026-10-17T20:00:00.000Z' }],
  respostas: [{ cliente: 'Acme', recebido_em: '2026-10-20T10:00:00.000Z', status: 'novo', autor_nome: 'João', temas: ['critica', 'estoque'], dias: 1 }, { cliente: 'Beta', recebido_em: '2026-10-20T10:00:00.000Z', status: 'novo', autor_nome: '', temas: ['elogio'], dias: 1 }],
  riscos: [{ cliente: 'Beta', motivo: 'reembolso', desde: '2026-10-15' }],
  incidentes: [{ id: 1, sinal_id: 'trinity.coleta_ml', rotulo: 'Coleta do ML', nivel: 'critico', dono: 'Head de canais', sla_ate: '2026-10-21T19:00:00.000Z', aberto_em: AGORA, valor: '40 h', sistema: 'trinity' }, { id: 2, sinal_id: 'trinity.disco', rotulo: 'Disco', nivel: 'atencao', dono: 'Head de canais', sla_ate: '', aberto_em: AGORA, valor: '12 GB', sistema: 'trinity' }],
  estruturas: [{ id: 'executor', nome: 'Executor ligado', estado: 'desligado', camada: 'arquivo', reinicio_pendente: true, tipo: 'chave', falta: [] }, { id: 'env.meli', nome: 'App do ML', estado: 'pendente', camada: 'env', reinicio_pendente: false, tipo: 'infra', falta: ['MELI_CLIENT_ID ausente'] }],
  nao_liberados: [{ cliente: 'Acme', motivo: 'sem liberação do líder' }],
  medidas: [{ cliente: 'Acme', acao_id: 'PS-7', regra: 'anuncio_fotos', resolveu: 1, medido_em: '2026-10-21T06:00:00.000Z' }],
  precos: [{ cliente: 'Beta', item_id: 'MLB1', dia: '2026-10-18', titulo: 'Tapete', variacao_pct: 12.5 }],
  clientes: [{ cliente: 'Acme', cs: 'Carla', whatsapp: false, vencimentos: { ML: '2026-11-05' } }, { cliente: 'Beta', cs: 'Carla', whatsapp: true, vencimentos: {} }],
  avisos_discord: [{ cliente: 'Acme', dia: '2026-10-20', estado: 'entregue' }],
  carteira: [{ n: 2, nome: 'Conectado', atrasado: 3, parados: 5 }, { n: 6, nome: 'Aprovado', atrasado: 0, parados: 9 }],
  numeros: { autonomia: { n: 2, de: 8 }, cobertura: { cards: 16, tarefas: 160 }, contas: { clientes: 94, pessoas: 20 } },
})
const REGRAS = ['duplicacao_estrategica', 'urgencia_oculta', 'concentracao_receita']
const fila = (o = {}) => montarFila({ hoje: HOJE, agora: AGORA, fontes: FONTES, regrasConsultor: REGRAS, ...o })
const todos = r => r.blocos.flatMap(b => b.itens)

await caso('≤ 5 blocos por papel (os 6 do doc), BLOCOS fechado, sem papel = líder (a mesa de exceções), papel desconhecido = líder', () => {
  assert.deepEqual(PAPEIS, ['dono', 'lider', 'consultor', 'analista', 'cs', 'tecnico']); assert.deepEqual(Object.keys(BLOCOS), [...PAPEIS])
  for (const p of PAPEIS) { const r = fila({ por: p }); assert.ok(r.blocos.length >= 1 && r.blocos.length <= 5, `${p}: ${r.blocos.length} blocos`); assert.equal(r.papel, p); for (const b of r.blocos) assert.ok(b.id && b.titulo && b.sistemas && b.sub, `${p}/${b.id}`) }
  assert.equal(fila().papel, 'lider'); assert.equal(fila({ por: 'zion' }).papel, 'lider'); assert.equal(fila().rotulo, 'Líder')
  assert.deepEqual(fila({ por: 'lider' }).blocos.map(b => b.id), ['andar', 'decidir', 'desconfiar', 'gente', 'semana']); assert.equal(fila({ por: 'tecnico' }).blocos.length, 4)
})

await caso('regra fixa do item: cliente · o que fazer · 1 botão (só rota de escrita que já existe) OU link · prazo · número que fecha; 1 só primário = o 1º item da fila', () => {
  const r = fila({ por: 'lider' }), it = todos(r)
  assert.ok(it.length >= 10, 'itens: ' + it.length)
  for (const i of it) { assert.ok(typeof i.o_que === 'string' && i.o_que, i.id); assert.ok(typeof i.numero === 'string', i.id); assert.ok((i.botao && !i.link) || (!i.botao && i.link), `${i.id}: exatamente um de botão/link`); if (i.botao) { assert.ok(ROTAS_ESCRITA.includes(i.botao.rota), `${i.id}: rota ${i.botao.rota} não é de escrita existente`); assert.ok(i.botao.rotulo && i.botao.corpo) } else assert.ok(i.link.href.startsWith('/') || i.link.href.startsWith('https://'), i.id) }
  assert.equal(it.filter(i => i.primario).length, 1); assert.equal(it[0].primario, true); assert.equal(it[0].id, 'conexao:Acme'); assert.equal(it[0].botao.rota, '/api/integracoes/meli/link'); assert.equal(it[0].botao.copiar, 'url')
  assert.equal(todos(fila({ por: 'tecnico' })).filter(i => i.primario).length, 1)
  const zeta = it.find(i => i.id === 'conexao:Zeta'); assert.equal(zeta.botao.rota, '/api/meli/restaurar', 'conexão guardada = Restaurar')
  const p01 = it.find(i => i.id === 'p01:Acme'); assert.deepEqual(p01.botao.corpo, { ids: ['PS-1', 'PS-2'], status: 'aprovada' }); assert.equal(p01.botao.por, true); assert.match(p01.prazo, /vencido: 8 dias úteis/); assert.equal(p01.gravidade, 'atrasado'); assert.equal(p01.etapa, ETAPA.decidir)
  assert.equal(it.find(i => i.id === 'p01:Beta').gravidade, '', '1 dia útil: dentro do limiar'); assert.equal(diasUteis('2026-10-10', HOJE), 8, 'a mesma conta de dias úteis do progresso (F4)')
  const dist = it.find(i => i.id === 'dist:Acme'); assert.equal(dist.botao.rota, '/api/planos/distribuir'); assert.deepEqual(dist.botao.corpo.escopo, { tipo: 'selecao', clientes: ['Acme'] }); assert.equal(dist.botao.corpo.confirmar, true); assert.ok(dist.botao.confirmar)
  assert.equal(it.find(i => i.id === 'ordem:CH-0000000001').botao.rota, '/api/chaveiro/exec/aprovar'); assert.equal(it.find(i => i.id === 'veto:Acme:preco').botao.rota, '/api/chaveiro/exec/vetar'); assert.ok(!it.find(i => i.id === 'veto:Beta:fotos'), 'veto vencido não aparece')
  assert.equal(it.find(i => i.id === 'div:CH-0000000002').link.href, '/cliente?cliente=Beta&aba=executar'); assert.ok(it.find(i => i.id.startsWith('lote-barrado:Beta')), 'texto barrado pelo auditor em «desconfiar»')
  const pend = it.find(i => i.id.startsWith('pend:Acme')); assert.equal(pend.botao.rota, '/api/cliente/do-cliente/lembrete'); assert.deepEqual(pend.botao.corpo, { cliente: 'Acme', chave: 'custos|ml' }); assert.ok(!it.find(i => i.id.startsWith('pend:Beta')), 'líder só vê pendência > 30 d')
  assert.equal(it.find(i => i.id === 'nao_liberados').botao.rota, '/api/gatilhos/preparar-lote'); assert.equal(it.find(i => i.id === 'nao_liberados').botao.corpo.confirmar, false, 'lote só em prévia')
  assert.ok(it.find(i => i.id === 'resp:Acme:2026-10-20T10:00:00.000Z') && !it.find(i => i.id.startsWith('resp:Beta')), 'só resposta com crítica')
  assert.ok(it.find(i => i.id.startsWith('lote:Acme')) && it.find(i => i.id.startsWith('rel:Acme')), 'recibo e relatório falhados em «terça e sexta»')
  assert.ok(it.find(i => i.id === 'custo:Acme') && !it.find(i => i.id === 'custo:Beta')); assert.match(it.find(i => i.id === 'coleta_ml').o_que, /há 60 h/)
})

await caso('teto 10/semana/família (D-C1): família acima do teto some da lista e vira «limiar errado: N itens; ajuste em Estrutura › Regras do método»; abaixo nada muda; blocos de trabalho ficam fora do teto', () => {
  const t = aplicarTeto([...Array(11)].map((_, i) => ({ id: 'x' + i, familia: 'decidir' })).concat([{ id: 'y', familia: 'ordens' }]))
  assert.deepEqual(t.itens.map(i => i.id), ['y']); assert.deepEqual(t.limiar_errado, [{ familia: 'decidir', n: 11, aviso: 'limiar errado: 11 itens; ajuste em Estrutura › Regras do método', ajuste: '/metodologia?sec=secParam' }]); assert.deepEqual(t.familias, ['decidir', 'ordens'])
  assert.equal(aplicarTeto([...Array(10)].map((_, i) => ({ id: 'x' + i, familia: 'decidir' }))).limiar_errado.length, 0, '10 = no teto, ainda lista')
  assert.equal(TETO_EXCECOES, 10); assert.equal(LIMIAR_ERRADO(12), 'limiar errado: 12 itens; ajuste em Estrutura › Regras do método')
  const muitos = { ...FONTES, acoes: [...Array(12)].map((_, i) => acao('PS-' + i, 'Cliente ' + i)) }
  const r = fila({ por: 'lider', fontes: muitos }), dec = r.blocos.find(b => b.id === 'decidir')
  assert.equal(dec.total, 12 + 2, 'total conta antes do teto (12 clientes P0/P1 + ordem + veto)'); assert.deepEqual(dec.limiar_errado.map(l => [l.familia, l.n]), [['decidir', 12]]); assert.ok(!dec.itens.some(i => i.familia === 'decidir'), 'as 12 saíram da lista'); assert.ok(dec.itens.some(i => i.familia === 'ordens'), 'as outras famílias continuam')
  assert.equal(r.numeros.excecoes.valor, r.blocos.filter(b => b.excecao).reduce((s, b) => s + b.total, 0)); assert.equal(r.numeros.excecoes.por_familia, 10); assert.equal(r.numeros.excecoes.teto, 10 * r.numeros.excecoes.familias)
  const an = fila({ por: 'analista', fontes: { ...FONTES, cards: [...Array(14)].map((_, i) => ({ id: 't' + i, cliente: 'Acme', titulo: 'Card ' + i, status: 'andamento', last_edited: AGORA, prazo: '', url: '', ps: false, quadrante: 'fazer' })) } })
  assert.equal(an.blocos[0].excecao, false); assert.equal(an.blocos[0].itens.length, 14, 'lista de trabalho não tem teto'); assert.equal(an.blocos[0].limiar_errado.length, 0)
})

await caso('isolamento por cliente: escopo «Acme» nunca mostra Beta (todo papel), item sem cliente só nos papéis globais; escopo vazio = 0 itens com cliente; ?etapa= filtra', () => {
  for (const por of PAPEIS) { const r = fila({ por, escopo: ['acme'] }); assert.ok(todos(r).every(i => !i.cliente || i.cliente === 'Acme'), por + ': vazou Beta'); assert.equal(r.escopo, 1) }
  assert.ok(todos(fila({ por: 'consultor', escopo: ['Acme'] })).every(i => i.cliente), 'consultor: nenhum item global'); assert.ok(todos(fila({ por: 'cs', escopo: ['Beta'] })).every(i => i.cliente === 'Beta'))
  assert.equal(todos(fila({ por: 'consultor', escopo: [] })).length, 0, 'sem cliente no escopo = fila vazia, nunca a carteira inteira'); assert.equal(fila({ por: 'lider' }).escopo, null)
  const e6 = fila({ por: 'lider', etapa: 6 }); assert.equal(e6.etapa, 6); assert.ok(todos(e6).length >= 2 && todos(e6).every(i => i.etapa === 6)); assert.equal(fila({ por: 'lider', etapa: '11' }).etapa, null); assert.equal(fila({ por: 'lider', etapa: 'x' }).etapa, null)
  assert.equal(todos(fila({ por: 'lider', etapa: 2 })).filter(i => i.primario).length, 1, 'o primário segue o 1º item visível')
})

await caso('papéis: consultor (aprovar, briefing das regras que exigem consultor, pendências 14/30, terça, resultados e preço), analista (Eisenhower fazer → agendar, parados, aguardando, rendeu, Discord), CS, dono, técnico', () => {
  const c = fila({ por: 'consultor', quem: 'Ana', escopo: ['Acme', 'Beta'] }), ci = todos(c)
  assert.deepEqual(c.blocos.map(b => b.id), ['aprovar', 'briefing', 'pelo_cliente', 'semana', 'resultados']); assert.equal(c.quem, 'Ana')
  assert.ok(ci.find(i => i.id === 'rc:PS-6'), 'duplicacao_estrategica pede o consultor'); assert.ok(ci.find(i => i.id.startsWith('pend:Beta')), 'consultor vê a partir de 14 d'); assert.ok(!ci.find(i => i.id.includes('Fotos')), '3 d não entra')
  const pr = ci.find(i => i.id === 'preco:Beta:MLB1:2026-10-18'); assert.equal(pr.botao.rota, '/api/cliente/preco/decisao'); assert.deepEqual(pr.botao.corpo, { cliente: 'Beta', ref: 'ml:MLB1:2026-10-18', decisor: 'cliente', confirmar: true })
  assert.match(ci.find(i => i.id === 'med:PS-7').o_que, /melhorou/); assert.ok(ci.find(i => i.id.startsWith('resp:Beta')), 'consultor vê toda resposta nova')
  const a = fila({ por: 'analista', quem: 'Ana', escopo: ['Acme', 'Beta'] }), ai = a.blocos[0].itens
  assert.deepEqual(a.blocos.map(b => b.id), ['cards', 'parados', 'aguardando', 'rendeu', 'discord']); assert.deepEqual(ai.map(i => i.id), ['card:t2', 'card:t1', 'card:t3'], 'fazer antes de agendar; sem quadrante por último'); assert.equal(ai[1].gravidade, 'atrasado'); assert.equal(ai[0].link.href, '/cliente?cliente=Beta&aba=plano'); assert.equal(ai[1].link.href, 'https://notion.so/t1')
  assert.deepEqual(a.blocos[1].itens.map(i => i.id), ['parado:t1', 'parado:t3']); assert.match(a.blocos[2].itens[0].o_que, /Custos · PS-9 — /); assert.equal(a.blocos[4].itens[0].cliente, 'Acme')
  const cs = fila({ por: 'cs', quem: 'Carla', escopo: ['Acme', 'Beta'] }), csi = todos(cs)
  assert.deepEqual(cs.blocos.map(b => b.id), ['risco', 'pendencias', 'dados', 'contrato', 'entrega']); assert.ok(csi.find(i => i.id === 'grupo:Acme') && !csi.find(i => i.id === 'grupo:Beta')); assert.match(csi.find(i => i.id === 'venc:Acme:ML').prazo, /em 15 d/); assert.equal(cs.blocos[2].itens.filter(i => i.familia === 'contrato').length, 0, 'contrato só no bloco dele')
  const d = fila({ por: 'dono' }), di = todos(d)
  assert.deepEqual(d.blocos.map(b => b.id), ['numeros', 'decisoes', 'carteira', 'risco', 'incidentes']); assert.match(di.find(i => i.id === 'gmv').numero, /— não lido/); assert.equal(di.find(i => i.id === 'etapa:2').link.href, '/fila?por=lider&etapa=2'); assert.ok(!di.find(i => i.id === 'etapa:6'), '0 atrasados não é item')
  assert.ok(di.find(i => i.id === 'est:executor') && di.find(i => i.id === 'veto:Acme:preco')); assert.deepEqual(d.blocos[4].itens.map(i => i.id), ['inc:1'], 'dono só vê crítico')
  const t = fila({ por: 'tecnico' }); assert.deepEqual(t.blocos.map(b => b.id), ['incidentes', 'reinicio', 'env', 'backup']); assert.deepEqual(t.blocos[0].itens.map(i => i.id), ['inc:1', 'inc:2']); assert.equal(t.blocos[2].itens[0].id, 'est:env.meli'); assert.match(t.blocos[3].motivo, /não lido/)
})

await caso('honestidade: fontes ausentes = 0 itens com motivo «sem leitura de …» (nunca zero fingido), fontes vazias nunca lançam, os 4 números com «—» e motivo quando não há base, nada «undefined»/«NaN»', () => {
  const v = fila({ por: 'lider', fontes: {} })
  assert.equal(v.total_itens, 0); for (const b of v.blocos) assert.match(b.motivo, /sem leitura de/, b.id)
  assert.deepEqual([v.numeros.autonomia.valor, v.numeros.cobertura.valor, v.numeros.contas_por_pessoa.valor], [null, null, null]); assert.equal(v.numeros.autonomia.motivo, 'não lido'); assert.equal(v.numeros.excecoes.valor, 0)
  for (const por of PAPEIS) { const r = montarFila({ por, fontes: Object.fromEntries(Object.keys(FONTES).map(k => [k, Array.isArray(FONTES[k]) ? [] : {}])) }); assert.equal(r.total_itens, { dono: 2, lider: 2 }[por] || 0, por + ' (dono: as 2 linhas de «Números» com «— não lido»; líder: coleta e Notion sem registro são exceções, não zero fingido)'); assert.doesNotMatch(JSON.stringify(r), /undefined|NaN/) }
  const n = fila().numeros; assert.equal(n.autonomia.valor, 25); assert.equal(n.cobertura.valor, 10); assert.equal(n.contas_por_pessoa.valor, 4.7)
  assert.equal(fila({ fontes: { ...FONTES, numeros: { autonomia: { n: 0, de: 0 }, cobertura: { cards: 0, tarefas: 0 }, contas: { clientes: 10, pessoas: 0 } } } }).numeros.autonomia.motivo, 'nenhuma ação encerrada em 28 d')
  assert.doesNotMatch(JSON.stringify(fila({ por: 'lider' })), /undefined|NaN/)
  assert.doesNotMatch(JSON.stringify(fila({ por: 'dono', fontes: { ...FONTES, numeros: {} } })), /undefined|NaN/)
})

await caso('telas: fila.html (esqueleto do shell, 0 primário estático, scripts na ordem), fila.js (--check, 1 .btn-primario só no 1º item, sem hex/emoji/style, só rotas via item), tela-fila.css só tokens, shell .ps-hoje sem fetch, app.js Próxima ação → /fila, progresso.js «N atrasados» → /fila, server, PAGINAS, inventários', () => {
  const h = ler('src/web/fila.html'), j = ler('src/web/fila.js'), css = ler('src/web/tela-fila.css'), sh = ler('src/web/shell.js'), app = ler('src/web/app.js'), pg = ler('src/web/progresso.js'), sv = ler('src/server.js'), ts = ler('scripts/teste-shell-ui.mjs'), ui = ler('src/web/ui.css')
  for (const f of ['src/web/fila.js', 'src/web/shell.js', 'src/web/app.js', 'src/web/progresso.js', 'src/rotas-fila.js', 'src/lib/fila.js', 'src/lib/fila-real.js']) execFileSync(process.execPath, ['--check', RAIZ + f])
  assert.match(h, /<body data-pagina="fila">\s*<header class="ps-shell" id="psShell"><\/header>\s*<script src="\/shell\.js"><\/script>/); assert.match(h, /<link rel="stylesheet" href="\/ui\.css">/); assert.match(h, /<script src="\/alerta\.js" defer><\/script>\s*<script src="\/ajuda\.js" defer><\/script>/)
  assert.ok(h.indexOf('src="/progresso.js"') < h.indexOf('src="relatorio.js"') && h.indexOf('src="relatorio.js"') < h.indexOf('src="fila.js"'), 'progresso.js → relatorio.js → fila.js')
  assert.equal((h.match(/btn-primario/g) || []).length, 0, 'nenhum primário estático'); assert.doesNotMatch(h, /<style[\s>]|style=/); assert.doesNotMatch(h, HEX); assert.ok(!EMOJI.test(h), 'sem emoji no HTML')
  for (const id of ['filaLido', 'filaEscopo', 'filaPor', 'filaQuem', 'btnFilaAtualizar', 'veredito', 'kpis', 'kpisSec', 'filaEtapa', 'secProgresso', 'progressoCarteira', 'blocos']) assert.ok(h.includes(`id="${id}"`), '#' + id)
  assert.ok(h.indexOf('id="kpisSec"') < h.indexOf('id="secProgresso"') && h.indexOf('id="secProgresso"') < h.indexOf('id="blocos"'), 'veredito → stepper → blocos')
  assert.equal((j.match(/btn btn-primario/g) || []).length, 2, 'a classe primária só nos 2 ramos do template do item (botão | link), ligados a it.primario'); assert.match(j, /it\.primario \? 'btn btn-primario' : 'btn btn-p'/)
  assert.doesNotMatch(j, HEX); assert.doesNotMatch(j, /style=/); assert.ok(!EMOJI.test(j.replace(/\/\/.*$/gm, '')), 'sem emoji'); assert.doesNotMatch(j, /\bprompt\(/)
  assert.match(j, /\/api\/fila\?/); assert.doesNotMatch(j, /'\/api\/(planos|chaveiro|cliente|gatilhos|meli|integracoes)\//, 'o JS não conhece rota de escrita: só chama a rota que vem no item'); assert.match(j, /api\(bt\.rota, corpo\)/); assert.match(j, /pedirPor\(/); assert.match(j, /PSProgresso\?\.montar\(\$\('progressoCarteira'\)/)
  assert.match(j, /window\.PS\?\.quem\?\.\(\)/, 'papel e nome padrão de «Quem sou»'); assert.match(j, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(css, HEX); assert.doesNotMatch(css, /rgba?\(/); assert.match(css, /\.fila-item\{display:grid/); assert.match(css, /\.fila-item\.atrasado \.fi-prazo\{color:var\(--verm\)/)
  assert.match(sh, /className: 'ps-hoje', href: hrefHoje\(\), textContent: 'Hoje'/); assert.match(sh, /return '\/fila' \+ \(s \? '\?' \+ s : ''\)/); assert.match(sh, /className: 'ps-util' \}, hoje, quem, busca, slot, menu\)/, 'Hoje no lugar do antigo .ps-int, antes de Quem sou'); assert.match(sh, /if \(pag === 'fila'\) hoje\.setAttribute\('aria-current', 'page'\)/)
  assert.doesNotMatch(sh, /\bfetch\(|innerHTML|ps-int/); assert.match(ui, /^\.ps-hoje\{/m); assert.doesNotMatch(ui.slice(ui.indexOf('.ps-hoje{')).split('\n').slice(0, 3).join('\n'), HEX)
  assert.match(app, /<a class="btn btn-primario" href="\/fila\?por=\$\{encodeURIComponent\(porFila\)\}">Abrir o Hoje<\/a>/); assert.equal((app.match(/class="btn btn-primario"/g) || []).length, 1, 'um só primário estático (o do diálogo de dependência é className no DOM)'); assert.match(app, /class="btn" data-chip="\$\{alvo\[0\]\}"/, 'o chip virou secundário')
  assert.match(pg, /href="\/fila\?por=\$\{esc\(papelFila\(\)\)\}&amp;etapa=\$\{e\.n\}"/, 'N atrasados → /fila (F4 h)'); assert.doesNotMatch(pg, /btn-primario/)
  assert.match(sv, /app\.get\('\/fila'/); assert.match(sv, /app\.use\(criarRotasFila\(\{ fila: criarFilaReal\(\{ estrutura: \(\) => estruturaReal\(\{ saude: saudeSis \}\), progresso: criarProgressoReal\(\{ relatorios \}\), aba: criarAbaDoClienteReal\(/); assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasFila('), 'depois do guardaLocal')
  assert.match(ts, /\['fila\.html', 'fila', 'fila\.js', 'fila'\]/, 'PAGINAS inclui a fila')
  const inv = JSON.parse(ler('docs/ux/inventario-fila.json')); assert.equal(inv.id, 'fila'); for (const hk of ['#filaPor', '#filaQuem', '#blocos', '[data-acao]', '#filaEtapa', '#progressoCarteira']) assert.ok(inv.hooks_js.some(x => x.includes(hk)), 'inventário sem ' + hk)
  assert.ok(ler('docs/ux/inventario-painel-executivo.json').includes('Abrir o Hoje'), 'inventário do painel registra a Próxima ação → /fila')
  assert.match(ler('docs/ux/sistema-de-design.md'), /Registro F5 \(21\/10\/2026\)/, 'decisão registrada em § 8.7')
})

await caso('rotas-fila: só GET /api/fila; papel inválido = líder; etapa fora de 1..10 = null; quem cortado em 80; Cache-Control no-store', async () => {
  const chamadas = []
  const r = criarRotasFila({ fila: { montar: o => { chamadas.push(o); return { papel: o.por, blocos: [] } } } })
  const pilha = r.stack.filter(l => l.route).map(l => [l.route.path, Object.keys(l.route.methods)[0]])
  assert.deepEqual(pilha, [['/api/fila', 'get']])
  const chamar = query => new Promise(okk => { const res = { set(k, v) { this.h = [k, v]; return this }, status(c) { this.c = c; return this }, json(j) { okk({ c: this.c || 200, j, h: this.h }) } }; r.stack[0].route.stack[0].handle({ params: {}, query }, res, () => okk(null)) })
  const a = await chamar({ por: 'Consultor', quem: 'Ana', etapa: '6' }); assert.equal(a.c, 200); assert.deepEqual(chamadas[0], { por: 'consultor', quem: 'Ana', etapa: 6 }); assert.deepEqual(a.h, ['Cache-Control', 'no-store'])
  await chamar({ por: 'zion', etapa: '11' }); assert.deepEqual(chamadas[1], { por: 'lider', quem: '', etapa: null })
  await chamar({ quem: 'x'.repeat(200), etapa: ['3', '4'] }); assert.equal(chamadas[2].quem.length, 80); assert.equal(chamadas[2].etapa, 3); assert.equal(chamadas[2].por, 'lider')
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-fila: ${ok} de ${ok + falhas.length} verificações passaram (${PAPEIS.length} papéis)`)
if (falhas.length) { console.error('Falharam: ' + falhas.join(' | ')); process.exit(1) }
