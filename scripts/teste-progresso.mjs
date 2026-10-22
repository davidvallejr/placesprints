// Autoteste do progresso do processo (docs/ux/arquitetura-5-menus.md § D e § G «F4», 21/10/2026). Puro + estático: sem rede, sem banco, sem DOM.
//  (1) src/lib/progresso-cliente.js: fixtures — cliente ok (10 feito, ciclo completo, pronto 8 de 8) · coleta de 40 h (etapa 3 atrasada com «há 40 h · limiar 26 h») ·
//      proposta P0/P1 de 11 dias (etapa 6 atrasada em dias úteis) · chave gatilhos_ligado desligada (etapa 10 = desligado, NUNCA atrasado) · terça 12:00 sem recibo ·
//      contexto vazio nunca lança (tudo «—» com motivo); carteira: 3 contagens + parados por etapa, ciclo completo, tabela ordenada por atraso, totais dos 3 KPIs;
//  (2) todo `ajuda` de ETAPAS existe em config/ajuda.json (o (i) do passo nunca abre vazio);
//  (3) telas: progresso.js (--check, 0 primário, sem hex/emoji/style, (i) só por dataset, tabela de 5 colunas), cliente.js (#progresso entre #kpis e nav.abas, #prontoOperar
//      no topo de Configurar, #btnRevisar continua o único primário), index.html/app.js, estrutura.html/js, planos (#kpisProgresso), analistas (coluna PS- parados), ui.css
//      (.passos-estatico, li.atrasado/desligado/aguardando por token), server.js monta as rotas depois do guardaLocal, inventários e COMPARTILHADOS;
//  (4) src/rotas-progresso.js: só GET; 404 com mensagem fixa (sem eco); escopo da query passa inteiro.
// Rodar: node scripts/teste-progresso.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { progressoCliente, progressoCarteira, diasUteis, ETAPAS, ESTADOS, LIMIARES } from '../src/lib/progresso-cliente.js'
import { criarRotasProgresso } from '../src/rotas-progresso.js'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let ok = 0
const falhas = []
const caso = async (nome, fn) => { try { await fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }
const EMOJI = /\p{Extended_Pictographic}|[\u{2600}-\u{27BF}]/u
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/

const AGORA = '2026-10-21T15:00:00.000Z'   // quarta-feira
const OK = Object.freeze({ cliente: 'Cliente Ok', agora: AGORA, hoje: '2026-10-21', hora: '12:00', quadro: true, cs: 'Ana Lima', conhecido_desde: '2026-09-01T00:00:00.000Z',
  ml: { conectado: true, erro: '', conectado_em: '2026-09-01T00:00:00.000Z', atualizado_em: AGORA, canal: true },
  coleta: { em: '2026-10-21T07:00:00.000Z', sync_em: '2026-10-21T13:30:00.000Z', lacunas: 0 },
  empresa: { custo_pct: 92, lead_time: true, catalogo: true },
  plano: { diagnostico: 'disponivel', gerado_em: '2026-10-21T07:30:00.000Z', propostas: 5 },
  decisao: { p01_sem_decisao: 0, p01_dias_uteis_max: 0, p01_atrasadas: 0, aprovadas: 4, total: 12 },
  distribuicao: { aprovadas_nao_distribuidas: 0, aprovadas_paradas: 0, aprovadas_dias_max: 0, distribuidas: 4, cards_ps: 4, tarefas: 40 },
  execucao: { cards_ps: 4, cards_abertos: 2, cards_parados: 0, cards_dias_max: 0, ordens: 0, ordens_conferidas: 0, ordens_divergentes: 0, pendencias: 0, pendencias_14: 0, pendencias_30: 0, pendencias_dias_max: 0, chaveiro_ligado: false },
  medicao: { medidas: 2, medicao_em: '2026-10-21T06:00:00.000Z', sem_medida: 0, sem_medida_dias_max: 0, em_janela: 1 },
  comunicacao: { chave_ligada: true, inicio_envios: '2026-10-20', elegivel: true, motivo_inelegivel: '', liberado: true, recibo_semana: 'entregue', relatorio: { situacao: 'agendado', situacao_rotulo: 'Agendado', frequencia: 'semanal' }, resposta_14d: true } })
const com = (patch) => ({ ...OK, ...patch })
const et = (p, n) => p.etapas[n - 1]

await caso('cliente ok: 10 etapas feitas, ciclo completo, atual = null, pronto 8 de 8; a mão do Chaveiro aparece «desligado» sem derrubar a etapa 8', () => {
  const p = progressoCliente(OK)
  assert.equal(p.etapas.length, 10); assert.deepEqual(p.etapas.map(e => e.estado), Array(10).fill('feito')); assert.equal(p.atual, null); assert.equal(p.ciclo_completo, true)
  assert.deepEqual([p.pronto.n, p.pronto.de], [8, 8]); assert.equal(p.pronto.itens.length, 8)
  assert.equal(et(p, 8).maos.find(m => m.nome === 'Chaveiro').estado, 'desligado'); assert.match(et(p, 8).numero, /Chaveiro desligado/)
  for (const e of p.etapas) { assert.ok(ESTADOS.includes(e.estado)); assert.ok(e.ir.startsWith('/'), e.id + ': ir'); assert.ok(e.numero && e.nome && e.acao, e.id) }
  assert.equal(et(p, 1).ir, '/cliente?cliente=Cliente%20Ok&aba=configurar&sec=cad-sec'); assert.match(et(p, 9).ir, /aba=resumo&sec=secAcomp$/)
})

await caso('coleta de 40 h: etapa 3 atrasada com «há 40 h · limiar 26 h» (crítico > 30 h no motivo), etapa atual = 3 marcada, pronto cai para 7, atraso_max em dias', () => {
  const p = progressoCliente(com({ coleta: { ...OK.coleta, em: '2026-10-19T23:00:00.000Z' } })), e = et(p, 3)
  assert.equal(e.estado, 'atrasado'); assert.equal(e.atraso_txt, `há 40 h · limiar ${LIMIARES.coleta_atencao_h} h`); assert.match(e.motivo, /crítico/); assert.equal(e.atraso_dias, 1)
  assert.equal(p.atual, 3); assert.equal(e.atual, true); assert.equal(et(p, 2).atual, false); assert.equal(p.pronto.n, 7); assert.equal(p.ciclo_completo, false); assert.equal(p.atraso_max, 1)
  assert.equal(progressoCliente(com({ coleta: { ...OK.coleta, em: '2026-10-20T14:00:00.000Z' } })).etapas[2].estado, 'aguardando', '25 h = coleta de hoje ainda não rodou, não é atraso')
})

await caso('proposta P0/P1 de 11 dias: etapa 6 atrasada em dias úteis (8 > 2), com a ação «Decidir as P0/P1»; dentro de 2 dias úteis = pendente', () => {
  assert.equal(diasUteis('2026-10-10', '2026-10-21'), 8); assert.equal(diasUteis('2026-10-20', '2026-10-21'), 1); assert.equal(diasUteis('x', '2026-10-21'), null)
  const p = progressoCliente(com({ decisao: { ...OK.decisao, p01_sem_decisao: 2, p01_dias_uteis_max: diasUteis('2026-10-10', '2026-10-21'), p01_atrasadas: 2 } })), e = et(p, 6)
  assert.equal(e.estado, 'atrasado'); assert.equal(e.atraso_dias, 8); assert.match(e.atraso_txt, /8 dias úteis · limiar 2/); assert.equal(e.acao, 'Decidir as P0/P1'); assert.equal(p.atual, 6)
  assert.equal(progressoCliente(com({ decisao: { ...OK.decisao, p01_sem_decisao: 1, p01_dias_uteis_max: 1 } })).etapas[5].estado, 'pendente')
})

await caso('chave gatilhos_ligado desligada: etapa 10 = desligado (estrutura), nunca atrasado; ir aponta para /estrutura; terça 12:00 sem recibo = atrasado; antes = aguardando', () => {
  const p = progressoCliente(com({ comunicacao: { ...OK.comunicacao, chave_ligada: false, recibo_semana: '' } })), e = et(p, 10)
  assert.equal(e.estado, 'desligado'); assert.equal(e.atraso_dias, null); assert.equal(e.ir, '/estrutura'); assert.equal(p.atual, 10); assert.equal(p.ciclo_completo, false)
  const semRecibo = (hoje, hora) => progressoCliente(com({ hoje, hora, comunicacao: { ...OK.comunicacao, recibo_semana: '' } })).etapas[9]
  assert.equal(semRecibo('2026-10-20', '12:30').estado, 'atrasado'); assert.equal(semRecibo('2026-10-20', '12:30').limiar, 'terça 12:00')
  assert.equal(semRecibo('2026-10-20', '09:30').estado, 'aguardando'); assert.equal(semRecibo('2026-10-19', '18:00').estado, 'aguardando'); assert.equal(semRecibo('2026-10-25', '18:00').estado, 'atrasado', 'domingo ainda é a semana ISO da terça que passou')
  assert.equal(progressoCliente(com({ comunicacao: { ...OK.comunicacao, liberado: false } })).etapas[9].estado, 'pendente', 'elegível e não liberado = pendente com motivo')
  assert.match(progressoCliente(com({ comunicacao: { ...OK.comunicacao, elegivel: false, motivo_inelegivel: 'sem_vendas_28d' } })).etapas[9].motivo, /sem vendas/)
})

await caso('outras réguas: conectado há > 14 d sem custo = etapa 4 atrasada; aprovada parada > 2 d = etapa 7; card PS- parado > 7 d = etapa 8; concluída há > 17 d sem medida = etapa 9; sem ML a etapa 5 vale pela rodada semanal', () => {
  assert.equal(progressoCliente(com({ empresa: { custo_pct: 40, lead_time: false, catalogo: false } })).etapas[3].estado, 'atrasado')
  assert.equal(progressoCliente(com({ ml: { ...OK.ml, conectado_em: '2026-10-15T00:00:00.000Z' }, empresa: { custo_pct: null, lead_time: false, catalogo: false } })).etapas[3].estado, 'pendente', '6 d conectado: ainda não é atraso')
  assert.equal(progressoCliente(com({ distribuicao: { ...OK.distribuicao, aprovadas_nao_distribuidas: 3, aprovadas_paradas: 2, aprovadas_dias_max: 5 } })).etapas[6].estado, 'atrasado')
  const e8 = progressoCliente(com({ execucao: { ...OK.execucao, cards_parados: 1, cards_dias_max: 12 } })).etapas[7]; assert.equal(e8.estado, 'atrasado'); assert.equal(e8.ir, '/analistas'); assert.equal(e8.atraso_dias, 12)
  assert.equal(progressoCliente(com({ execucao: { ...OK.execucao, pendencias: 1, pendencias_14: 1 } })).etapas[7].estado, 'aguardando', '14–30 d = aguardando o cliente')
  assert.equal(progressoCliente(com({ medicao: { ...OK.medicao, sem_medida: 1, sem_medida_dias_max: 20 } })).etapas[8].estado, 'atrasado')
  assert.equal(progressoCliente(com({ medicao: { medidas: 0, medicao_em: OK.medicao.medicao_em, sem_medida: 0, em_janela: 2 } })).etapas[8].estado, 'aguardando')
  const semMl = com({ ml: { conectado: false, erro: '', canal: false }, coleta: { em: '', sync_em: OK.coleta.sync_em, lacunas: null }, plano: { diagnostico: 'sem_ml', gerado_em: '2026-10-18T10:00:00.000Z', propostas: 2 } })
  assert.equal(progressoCliente(semMl).etapas[1].estado, 'pendente'); assert.equal(progressoCliente(semMl).etapas[2].estado, 'feito', 'sem ML a coleta é só o Notion'); assert.equal(progressoCliente(semMl).etapas[4].estado, 'feito')
  assert.equal(progressoCliente({ ...semMl, plano: { ...semMl.plano, gerado_em: '2026-10-01T10:00:00.000Z' } }).etapas[4].estado, 'atrasado')
})

await caso('contexto vazio nunca lança: 10 etapas, estados da lista, atual = 1, nada «undefined»/«NaN» no JSON; conhecido_desde > 7 d sem CS = atrasado', () => {
  const p = progressoCliente({}); assert.equal(p.etapas.length, 10); assert.equal(p.atual, 1); assert.equal(p.pronto.n, 0)
  for (const e of p.etapas) assert.ok(ESTADOS.includes(e.estado), e.id)
  assert.doesNotMatch(JSON.stringify(p), /undefined|NaN/); assert.match(p.etapas[0].motivo, /sem data conhecida/)
  assert.equal(progressoCliente({ quadro: true, cs: '', conhecido_desde: '2026-10-01T00:00:00.000Z', agora: AGORA }).etapas[0].estado, 'atrasado')
  assert.equal(ETAPAS.length, 10); assert.deepEqual(ETAPAS.map(e => e.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); assert.equal(ETAPAS[0].nome, 'Cadastrado'); assert.equal(ETAPAS[9].nome, 'Comunicado')
})

await caso('carteira: 3 contagens + «parados nesta etapa» por etapa, ciclo completo N de M, tabela ordenada por atraso, totais dos 3 KPIs; chave desligada conta em desligado, não em atrasado', () => {
  const coleta40 = com({ cliente: 'Coleta 40 h', coleta: { ...OK.coleta, em: '2026-10-19T23:00:00.000Z' } }), chaveOff = com({ cliente: 'Chave Off', comunicacao: { ...OK.comunicacao, chave_ligada: false, recibo_semana: '' } })
  const p11 = com({ cliente: 'Proposta 11 d', decisao: { ...OK.decisao, p01_sem_decisao: 2, p01_dias_uteis_max: 8, p01_atrasadas: 2 }, distribuicao: { ...OK.distribuicao, aprovadas_nao_distribuidas: 3 } })
  const r = progressoCarteira([OK, coleta40, chaveOff, p11], { hoje: '2026-10-21' })
  assert.equal(r.total, 4); assert.equal(r.etapas.length, 10); assert.deepEqual([r.ciclo_completo.n, r.ciclo_completo.de], [1, 4])
  assert.deepEqual([r.etapas[2].feito, r.etapas[2].atrasado, r.etapas[2].parados], [3, 1, 1]); assert.deepEqual([r.etapas[9].desligado, r.etapas[9].atrasado, r.etapas[9].parados], [1, 0, 1]); assert.equal(r.etapas[5].parados, 1)
  assert.deepEqual(r.clientes.map(c => c.cliente), ['Proposta 11 d', 'Coleta 40 h', 'Chave Off', 'Cliente Ok'], 'maior atraso primeiro; desligado antes do ciclo completo')
  assert.equal(r.clientes[0].etapa, 6); assert.equal(r.clientes[2].estado, 'desligado'); assert.equal(r.clientes[3].nome, 'Ciclo completo'); assert.equal(r.clientes[3].ir, '')
  assert.ok(r.clientes.every(c => c.etapas.length === 10 && Number.isInteger(c.pronto)))
  assert.deepEqual(r.totais, { p01_sem_decisao_2du: 2, aprovadas_nao_distribuidas: 3, cobertura_ps: { cards: 16, tarefas: 160, pct: 10 } })
  assert.equal(progressoCarteira([]).ciclo_completo.de, 0)
})

await caso('catálogo: todo ajuda de ETAPAS existe em config/ajuda.json (o (i) nunca abre vazio) e o verbete medicao tem ≥ 3 passos, concluido_quando e doc existente', () => {
  const V = JSON.parse(ler('config/ajuda.json')).verbetes
  for (const e of ETAPAS) assert.ok(V[e.ajuda], `${e.id}: ajuda «${e.ajuda}» sem verbete`)
  assert.ok(V.medicao.passos.length >= 3 && V.medicao.concluido_quando && V.medicao.sistema === 'merovingio'); readFileSync(RAIZ + V.medicao.doc)
})

await caso('progresso.js: --check, window.PSProgresso.montar, 0 primário, sem hex/emoji/style inline, (i) só por dataset (nunca data-ajuda dinâmico), tabela da carteira com 5 colunas, estados por classe', () => {
  const j = ler('src/web/progresso.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/progresso.js'])
  assert.match(j, /window\.PSProgresso = \{ montar \}/); assert.doesNotMatch(j, /btn-primario|ps-primario|\bcheio\b/, '0 primário'); assert.doesNotMatch(j, HEX); assert.doesNotMatch(j, /style=/)
  assert.ok(!EMOJI.test(j.replace(/\/\/.*$/gm, '')), 'sem emoji'); assert.doesNotMatch(j, /data-ajuda="\$\{/); assert.match(j, /data-ajuda-id="\$\{esc\(e\.ajuda\)\}"/); assert.match(j, /b\.dataset\.ajuda = b\.dataset\.ajudaId/)
  assert.match(j, /<thead><tr><th>Cliente<\/th><th>Etapa<\/th><th>Número<\/th><th>Atraso<\/th><th>Próxima ação<\/th><\/tr><\/thead>/); assert.equal((j.match(/<th>/g) || []).length, 5, 'só a tabela da carteira, 5 colunas')
  assert.match(j, /\/api\/cliente\/progresso\?cliente=/); assert.match(j, /\/api\/progresso\?/); assert.match(j, /colspan="5"/)
  assert.match(j, /class="\$\{esc\(e\.estado\)\}\$\{e\.atual \? ' atual' : ''\}"/, 'estado + atual viram classes do ol.passos')
})

await caso('telas: cliente.js (#progresso entre #kpis e nav.abas; #prontoOperar 1º em Configurar; #btnRevisar único primário; montar + 1ª atrasada/pendente), cliente.html, index.html/app.js, estrutura.html/js, planos, analistas, ui.css, server.js, inventários, COMPARTILHADOS', () => {
  const cli = ler('src/web/cliente.js'), ch = ler('src/web/cliente.html'), ih = ler('src/web/index.html'), app = ler('src/web/app.js'), eh = ler('src/web/estrutura.html'), ej = ler('src/web/estrutura.js')
  const ph = ler('src/web/planos.html'), pj = ler('src/web/planos.js'), aj = ler('src/web/analistas.js'), al = ler('src/lib/analistas.js'), css = ler('src/web/ui.css'), tc = ler('src/web/tela-cliente.css'), sv = ler('src/server.js'), ts = ler('scripts/teste-shell-ui.mjs')
  for (const f of ['cliente.js', 'app.js', 'estrutura.js', 'planos.js', 'analistas.js']) execFileSync(process.execPath, ['--check', RAIZ + 'src/web/' + f])
  const pos = (s, t) => { const i = s.indexOf(t); assert.ok(i >= 0, t); return i }
  assert.ok(pos(cli, 'id="kpis"') < pos(cli, '<ol class="passos passos-estatico" id="progresso"') && pos(cli, 'id="progresso"') < pos(cli, '<nav class="abas abas-fixas"'), '#progresso entre #kpis e nav.abas')
  assert.match(cli, /<section data-painel="configurar" hidden>\s*<p class="pronto-operar" id="prontoOperar">Pronto para operar: <b>—<\/b> de 8/, '#prontoOperar é o 1º filho de Configurar')
  assert.equal((cli + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário (#btnRevisar)')
  assert.match(cli, /window\.PSProgresso\?\.montar\(\$\('progresso'\), \{ cliente: d\.cliente \}\)/); assert.match(cli, /p\.etapas\.find\(e => e\.estado === 'atrasado'\) \|\| p\.etapas\.find\(e => e\.estado === 'pendente'\)/); assert.match(cli, /alvo\.n === 6/, 'etapa 6 mantém o Revisar plano')
  assert.doesNotMatch(cli, /VIVOS = \[[^\]]*'progresso'/, 'o stepper redesenha a cada desenhar(): não entra em VIVOS')
  assert.ok(pos(ch, 'src="/progresso.js"') < pos(ch, 'src="ficha.js"') && pos(ch, 'src="/filtros.js"') < pos(ch, 'src="/progresso.js"'), 'cliente.html: progresso.js depois de /filtros.js e antes de ficha.js')
  assert.ok(pos(ih, 'id="proxima"') < pos(ih, 'id="secProgresso"') && pos(ih, 'id="secProgresso"') < pos(ih, 'id="cartaoRiscos"'), 'index.html: #secProgresso depois de #proxima'); assert.match(ih, /id="progressoCarteira"/)
  assert.ok(pos(ih, 'src="/progresso.js"') < pos(ih, 'src="app.js"')); assert.match(app, /progressoCarteira\(\)/); assert.match(app, /tipo: 'selecao', clientes: \[cli\] \} : \{ tipo: 'total' \}/)
  assert.equal((ih.match(/btn-primario/g) || []).length, 0, 'index.html segue sem primário estático')
  assert.ok(pos(eh, 'id="kpisSec"') < pos(eh, 'id="secProgresso"') && pos(eh, 'id="secProgresso"') < pos(eh, 'id="secEstruturas"'), 'estrutura.html: stepper global no topo'); assert.ok(pos(eh, 'src="/progresso.js"') < pos(eh, 'src="relatorio.js"'))
  assert.match(ej, /PSProgresso\?\.montar\(\$\('progressoCarteira'\), \{ escopo: \{ tipo: 'total' \} \}\)/); assert.doesNotMatch(eh + ej, /btn-primario|ps-primario/)
  assert.match(ph, /<div class="kpis" id="kpis" aria-busy="true"><\/div>\s*<p class="kpis-sec" id="kpisProgresso" hidden><\/p>/); assert.match(pj, /api\('\/api\/progresso\?' \+ qs\(\)\)/); assert.equal((ph.match(/btn-primario/g) || []).length, 1)
  const tab = aj.slice(aj.indexOf('function desenharClientes'), aj.indexOf('function desenharEntrega')); assert.equal((tab.match(/<th[ >]/g) || []).length, 6, 'tabela de clientes com 6 colunas'); assert.match(tab, /Cards PS- parados 7d\+/); assert.match(tab, /c\.ps_parados7/)
  assert.match(al, /ps_parados7: psParados\.get\(cliente\) \|\| 0/); assert.match(al, /\+ c\.paradas30 \+ c\.ps_parados7/)
  assert.match(css, /ol\.passos\.passos-estatico\{position:static\}/); assert.match(css, /ol\.passos>li\.atrasado\{color:var\(--verm\)\}/); assert.match(css, /ol\.passos>li\.desligado\{color:var\(--cinza-claro\)\}/); assert.match(css, /ol\.passos>li\.aguardando\{color:var\(--cinza\)\}/)
  assert.doesNotMatch(css.slice(css.indexOf('/* F4 (progresso'), css.indexOf('ol.passos.passos-compacto')), HEX, 'estados do stepper só por token'); assert.doesNotMatch(tc, HEX); assert.match(tc, /\.pronto-operar\{/)
  assert.match(sv, /app\.use\(criarRotasProgresso\(\{ progresso: criarProgressoReal\(\{ relatorios \}\), clienteCanonico: clienteDaCentral \}\)\)/); assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasProgresso('), 'depois do guardaLocal')
  assert.match(ts, /'src\/web\/progresso\.js'\]\.map\(ler\)/, 'progresso.js em COMPARTILHADOS')
  for (const [inv, hooks] of [['cliente', ['#progresso', '#prontoOperar', 'progresso.js']], ['painel-executivo', ['#secProgresso', '#progressoCarteira', 'progresso.js']], ['estrutura', ['#secProgresso', '#progressoCarteira']], ['planos', ['#kpisProgresso']], ['analistas', ['ps_parados7']]])
    for (const h of hooks) assert.ok(ler(`docs/ux/inventario-${inv}.json`).includes(h), `inventário ${inv} sem ${h}`)
})

await caso('rotas-progresso: só GET (nenhuma escrita nasce aqui); 404 com mensagem fixa sem ecoar o nome; prospect = 404; escopo da query vai inteiro para carteira()', async () => {
  const chamadas = []
  const r = criarRotasProgresso({ progresso: { cliente: c => ({ cliente: c, etapas: [] }), carteira: e => { chamadas.push(e); return { total: 0 } } }, clienteCanonico: n => n === 'Cliente Ok' ? 'Cliente Ok' : '' })
  const pilha = r.stack.filter(l => l.route).map(l => [l.route.path, Object.keys(l.route.methods)[0]])
  assert.deepEqual(pilha, [['/api/cliente/progresso', 'get'], ['/api/progresso', 'get']])
  const chamar = (path, query) => new Promise(okk => { const res = { status(c) { this.c = c; return this }, set() { return this }, json(j) { okk({ c: this.c || 200, j }) } }; r.stack.find(l => l.route?.path === path).route.stack[0].handle({ params: {}, query }, res, () => okk(null)) })
  const [a, b, c, d] = await Promise.all([chamar('/api/cliente/progresso', { cliente: 'Cliente Ok' }), chamar('/api/cliente/progresso', { cliente: '<script>x' }), chamar('/api/cliente/progresso', { cliente: '[Comercial] Loja' }), chamar('/api/progresso', { tipo: 'consultor', consultor: 'Ana', cliente: ['A', 'B'] })])
  assert.equal(a.j.cliente, 'Cliente Ok'); assert.deepEqual(b, { c: 404, j: { erro: 'cliente não encontrado na central' } }); assert.equal(c.c, 404)
  assert.equal(d.c, 200); assert.deepEqual(chamadas[0], { tipo: 'consultor', consultor: 'Ana', squad: '', clientes: ['A', 'B'] })
  await chamar('/api/progresso', { cliente: 'A' }); assert.equal(chamadas[1].tipo, 'selecao', '?cliente= sem tipo = seleção')
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-progresso: ${ok} de ${ok + falhas.length} verificações passaram (${ETAPAS.length} etapas)`)
if (falhas.length) { console.error('Falharam: ' + falhas.join(' | ')); process.exit(1) }
