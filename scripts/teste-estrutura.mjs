// Autoteste da tela de Estruturas (docs/ux/arquitetura-5-menus.md § A.6 e § G «F3», 21/10/2026). Puro + estático: sem rede, sem banco, sem DOM.
//  (1) src/lib/estrutura-estado.js: fixtures de config → estados; chave de arquivo desligada → camada arquivo, reinicia:true e «reinicie na janela combinada»;
//      chave de banco → acao com a rota que já existe (nunca rota nova); freio acionado → erro; variável ausente → pendente com o nome (nunca o valor);
//      arquivo editado depois do início → reinicio_pendente; ordenação por gravidade; verificar() resolve só o global e devolve sem_leitura com motivo no resto;
//  (2) todo `ajuda` do catálogo existe em config/ajuda.json (o (i) da linha nunca abre vazio); todo id de acao é uma rota POST existente em src/rotas-*.js;
//  (3) estrutura.html + estrutura.js: exatamente 6 <th>, 0 .btn-primario, sem hex, sem emoji, sem style inline, SELO com os 8 sistemas; app.get('/estrutura') e
//      criarRotasEstrutura montados em src/server.js; G do shell aponta Estruturas → /estrutura e Equipe → /estrutura?sec=secEquipe;
//  (4) src/rotas-estrutura.js: 404 com mensagem fixa (sem eco do id), GET /api/estrutura devolve linhas + equipe.
// Rodar: node scripts/teste-estrutura.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { montarEstrutura, verificar, CATALOGO, CHAVES_BANCO, VARIAVEIS, ESTADOS } from '../src/lib/estrutura-estado.js'
import { criarRotasEstrutura } from '../src/rotas-estrutura.js'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let ok = 0
const falhas = []
const caso = async (nome, fn) => { try { await fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }
const EMOJI = /\p{Extended_Pictographic}|[\u{2600}-\u{27BF}]/u
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/

const CFG = { chaveiro: { execucao_ligada: false, adaptadores_live: { $doc: 'x', preco: false, status: false }, sync_estoque_ligado: false, caminho_por_regra: { a: { caminho: 'automatico' }, b: { caminho: 'cliente' }, c: { operacao_por_causa: { x: { caminho: 'assistido' } } } } },
  algoritmo: { produto: { diagnostico_ligado: false }, financeiro: { margem_medida_nas_regras: false }, relatorios_ciclo: { blocos_terca_ligado: false } },
  nf: { nf: { ligado: false, envio_ml_ligado: false, producao_ligada: false }, intermediador: { cnpj: '' } },
  gatilhos: { inicio_envios: '2026-10-20', semanal: { hora: '09:00' }, consultor: { hora: '08:30' }, urgente: { na_hora_ligado: true, tipos: ['a', 'b'], impacto_min_reais: 100 } },
  sprint90: { publicacao_live: false }, autogestao: { whatsapp_critico_ligado: false, ticks: { coleta: { periodo_min: 10 }, medicao: { periodo_min: 60 } } },
  relatorio_envio: { agendador_ligado: false }, alerta: { automatico_ligado: false }, equipe: { donos: ['David do Valle'] }, discord_time: { mencoes_obrigatorias: [{ rotulo: 'a' }, { rotulo: 'b' }, { rotulo: 'c' }], marcar_consultor_do_cliente: true } }
const ENV_OK = Object.fromEntries(VARIAVEIS.map(k => [k, true]))
const base = (extra = {}) => montarEstrutura({ configs: CFG, estado: {}, env: ENV_OK, plists: { servidor: true, vigia: true, backup: true, arquivar: true, git: true, cloudflared: true }, ticks: { coleta: 4, medicao: 30 }, sinais: [], incidentes: { abertos: [] }, promocoes_exec_clientes: 0, equipe: { quem_pode: 12 }, agora: '2026-10-21T12:00:00.000Z', ...extra })
const por = (r, id) => r.linhas.find(l => l.id === id)

await caso('fixtures: chave de arquivo desligada → camada arquivo, reinicia:true, «reinicie na janela combinada», sem acao; ligada (urgente) → ligado; nasceu em «Desde/por»', () => {
  const r = base(), e = por(r, 'executor'), u = por(r, 'urgente_na_hora'), nf = por(r, 'nf')
  assert.equal(e.estado, 'desligado'); assert.equal(e.camada, 'arquivo'); assert.equal(e.reinicia, true); assert.match(e.como_mudar, /config\/chaveiro\.json e reinicie na janela combinada/); assert.equal(e.acao, undefined)
  assert.equal(e.desde, ''); assert.match(e.nasceu, /15\/10\/2026/)
  assert.equal(u.estado, 'ligado'); assert.equal(u.ligado, true)
  assert.equal(nf.estado, 'desligado'); assert.ok(nf.falta.some(f => /intermediador/.test(f)), 'bloqueio do CNPJ do intermediador aparece em falta'); assert.match(nf.detalhe, /envio ao ML desligado/)
  for (const l of r.linhas) { assert.ok(ESTADOS.includes(l.estado), l.id + ': estado fora da lista'); assert.ok(['arquivo', 'banco', 'env', 'externo'].includes(l.camada)); assert.ok(Array.isArray(l.falta)) }
  assert.equal(r.resumo.total, CATALOGO.length); assert.equal(r.resumo.ligadas + r.resumo.prontas + r.resumo.desligadas + r.resumo.pendentes + r.resumo.erros, r.resumo.total)
})

await caso('chaves de banco: acao com a rota que já existe; ausente = pronto (pré-requisitos ok) ou desligado (falta algo); ligada por «nome · ISO» → ligado com desde e por', () => {
  const r = base(), g = por(r, 'gatilhos')
  assert.deepEqual(g.acao, { tipo: 'chave', ligar: '/api/gatilhos/chave', desligar: '/api/gatilhos/chave' }); assert.equal(g.estado, 'pronto'); assert.equal(g.camada, 'banco'); assert.equal(g.reinicia, false); assert.equal(g.como_mudar, 'muda por esta tela')
  const r2 = base({ estado: { gatilhos_ligado: 'ligado', gatilhos_ligado_por: 'Ana Lima · 2026-10-15T10:00:00.000Z', relatorio_agendador: 'ligado', relatorio_agendador_por: 'Ana Lima · 2026-10-16T10:00:00.000Z' } }), g2 = por(r2, 'gatilhos')
  assert.equal(g2.estado, 'ligado'); assert.equal(g2.por, 'Ana Lima'); assert.equal(g2.desde, '2026-10-15'); assert.equal(por(r2, 'relatorio_agendador').estado, 'ligado')
  const r3 = base({ env: { ...ENV_OK, PLACE_GATILHOS_URL: false } }), g3 = por(r3, 'gatilhos')
  assert.equal(g3.estado, 'desligado'); assert.ok(g3.falta.some(f => /n8n/.test(f)), 'sem n8n a chave desligada não é «pronta»')
  const r4 = base({ env: { ...ENV_OK, PLACE_GATILHOS_URL: false }, estado: { gatilhos_ligado: 'ligado', gatilhos_ligado_por: 'Ana · 2026-10-15T10:00:00.000Z' } })
  assert.equal(por(r4, 'gatilhos').estado, 'pendente', 'ligada sem o entregador = pendente (nunca ligado fingido)')
  assert.equal(por(r, 'relatorio_agendador').estado, 'pronto'); assert.equal(por(base({ configs: { ...CFG, relatorio_envio: { agendador_ligado: true } } }), 'relatorio_agendador').estado, 'ligado', 'sem chave gravada vale o padrão do arquivo')
  for (const id of ['consultor_discord', 'alerta_auto', 'dossie_mensal']) { const l = por(r, id); assert.equal(l.acao.tipo, 'chave'); assert.match(l.acao.ligar, /^\/api\//) }
})

await caso('freios: solto = desligado; acionado = erro com acao de parar/retomar (rotas do Chaveiro); parar tudo também para o estoque', () => {
  const r = base(), f = por(r, 'freio_executor'), fe = por(r, 'freio_estoque')
  assert.equal(f.estado, 'desligado'); assert.equal(f.tipo, 'freio'); assert.deepEqual(f.acao, { tipo: 'freio', ligar: '/api/chaveiro/exec/parar', desligar: '/api/chaveiro/exec/retomar', rotulos: ['Parar tudo', 'Retomar'] })
  assert.equal(fe.acao.ligar, '/api/chaveiro/estoque/parar'); assert.equal(fe.acao.desligar, '/api/chaveiro/estoque/retomar')
  const r2 = base({ estado: { chaveiro_execucao_parado: '1', chaveiro_estoque_parado: '1' } })
  assert.equal(por(r2, 'freio_executor').estado, 'erro'); assert.equal(por(r2, 'freio_executor').ligado, true); assert.equal(por(r2, 'freio_estoque').estado, 'erro')
  assert.equal(r2.linhas[0].estado, 'erro', 'erro vem primeiro na ordenação'); assert.equal(r2.resumo.erros, 2)
})

await caso('variáveis: só presença (nome em falta, nunca valor); App do ML completo = ligado, faltando = pendente; Endereços públicos sempre com «túnel não verificado»; vigia dry-run = desligado', () => {
  const r = base(), a = por(r, 'app_ml'); assert.equal(a.estado, 'ligado'); assert.equal(a.camada, 'env'); assert.equal(a.reinicia, true); assert.match(a.como_mudar, /\.env e reinicie na janela combinada/)
  const r2 = base({ env: { ...ENV_OK, MELI_TOKEN_KEY: false, VIGIA_ENVIO_LIGADO: false } }), a2 = por(r2, 'app_ml')
  assert.equal(a2.estado, 'pendente'); assert.deepEqual(a2.falta, ['MELI_TOKEN_KEY ausente'])
  assert.equal(por(r2, 'vigia').estado, 'desligado'); assert.ok(por(r2, 'vigia').falta.some(f => /VIGIA_ENVIO_LIGADO=1/.test(f)))
  assert.match(por(r, 'enderecos').detalhe, /não verificado/); assert.equal(por(base({ plists: { cloudflared: false } }), 'enderecos').falta.length, 1)
  assert.ok(!JSON.stringify(r).includes('xyz-valor'), 'nenhum valor de variável sai')
})

await caso('relógio: ticks dentro do período = ligado; 3× = pendente (atrasado); 6× = erro (parado); saúde não lida = pendente com motivo; incidentes contados', () => {
  assert.equal(por(base(), 'relogio').estado, 'ligado'); assert.match(por(base(), 'relogio').detalhe, /coleta 10 min/)
  assert.equal(por(base({ ticks: { coleta: 35, medicao: 30 } }), 'relogio').estado, 'pendente')
  const r = base({ ticks: { coleta: 70, medicao: 30 }, incidentes: { abertos: [{ sinal_id: 'tick.coleta', nivel: 'critico', rotulo: 'Tick coleta' }, { sinal_id: 'trinity.disco', nivel: 'atencao' }] } })
  assert.equal(por(r, 'relogio').estado, 'erro'); assert.ok(por(r, 'relogio').falta.some(f => /parado há 70 min/.test(f))); assert.deepEqual([r.incidentes.abertos, r.incidentes.criticos], [2, 1])
  const s = base({ ticks: null, incidentes: null }); assert.equal(por(s, 'relogio').estado, 'pendente'); assert.deepEqual(por(s, 'relogio').falta, ['saúde do sistema não lida']); assert.equal(s.incidentes, null)
  assert.equal(por(base({ ticks: { medicao: 30 } }), 'relogio').falta[0], 'coleta: sem batimento desde o início')
})

await caso('reinício pendente: arquivo editado depois do início do servidor marca a linha (o valor mostrado é o carregado) e pede reinício; igual no disco = nada', () => {
  const disco = { ...CFG, chaveiro: { ...CFG.chaveiro, execucao_ligada: true } }
  const r = base({ configs_disco: disco }), e = por(r, 'executor')
  assert.equal(e.estado, 'desligado', 'vale o carregado'); assert.equal(e.reinicio_pendente, true); assert.ok(e.falta.some(f => /mudou depois do início do servidor.*reinicie na janela combinada/.test(f)))
  assert.equal(por(r, 'nf').reinicio_pendente, false); assert.equal(por(base({ configs_disco: CFG }), 'executor').reinicio_pendente, false)
})

await caso('verificar(): resolve só os pré-requisitos globais (env.*, chaves, cargos, plists, sync); por cliente e fora do sistema = sem_leitura com motivo; freio acionado = erro', () => {
  const ctx = { configs: CFG, estado: { ultimo_sync: '2026-10-21T10:30:00.000Z', chaveiro_execucao_parado: '1' }, env: { ...ENV_OK, NOTION_TOKEN: false }, plists: { servidor: true, vigia: false, backup: true }, sinais: [{ id: 'trinity.disco', estado: 'ok', valor: 40 }], equipe: { quem_pode: 3 }, agoraMs: Date.parse('2026-10-21T12:00:00.000Z') }
  assert.equal(verificar('env.meli_app', ctx).estado, 'ok'); assert.deepEqual(verificar('env.notion_token', ctx), { estado: 'pendente', motivo: 'NOTION_TOKEN ausente' })
  assert.equal(verificar('produto.diagnostico_ligado', ctx).estado, 'pendente'); assert.equal(verificar('chaveiro.freio', ctx).estado, 'erro'); assert.equal(verificar('discord.cargos', ctx).estado, 'ok')
  assert.equal(verificar('notion.sync_3h', ctx).estado, 'ok'); assert.match(verificar('autogestao.plists', ctx).motivo, /vigia/); assert.match(verificar('autogestao.disco', ctx).motivo, /40 GB/); assert.equal(verificar('equipe.lista', ctx).estado, 'ok')
  assert.equal(verificar('nf.dados_fiscais', ctx).estado, 'sem_leitura'); assert.match(verificar('nf.dados_fiscais', ctx).motivo, /por cliente/); assert.match(verificar('backup.chave', ctx).motivo, /fora do sistema/)
  assert.equal(verificar('ml.coleta_24h', {}).estado, 'sem_leitura', 'contexto vazio nunca dá ok')
  // todo verificar de config/ajuda.json ou resolve ou cai no sem_leitura (nunca lança)
  for (const v of Object.values(JSON.parse(ler('config/ajuda.json')).verbetes)) for (const p of v.pre_requisitos) assert.ok(['ok', 'pendente', 'erro', 'sem_leitura'].includes(verificar(p.verificar, ctx).estado), p.verificar)
})

await caso('catálogo: todo ajuda existe em config/ajuda.json; sistema do catálogo; toda rota de acao é um POST existente em src/rotas-*.js; nomes claros da tabela E; CHAVES_BANCO cobre as chaves das acao', () => {
  const V = JSON.parse(ler('config/ajuda.json')).verbetes, SIS = JSON.parse(ler('config/sistemas.json')).sistemas.map(s => s.id)
  const rotas = readdirSync(RAIZ + 'src').filter(f => /^rotas-.*\.js$/.test(f)).map(f => ler('src/' + f)).join('\n')
  for (const c of CATALOGO) { if (c.ajuda) assert.ok(V[c.ajuda], `${c.id}: ajuda «${c.ajuda}» sem verbete`); assert.ok(SIS.includes(c.sistema), c.id + ': sistema') }
  for (const l of base().linhas) if (l.acao) for (const rota of [l.acao.ligar, l.acao.desligar]) assert.ok(rotas.includes(`r.post('${rota}'`), `${l.id}: ${rota} não é uma rota POST existente`)
  const nomes = CATALOGO.map(c => c.nome)
  for (const n of ['Executor ligado', 'Operações liberadas no ML', 'Quem executa cada regra', 'Ajuste automático de estoque', 'Plano de terça ao cliente', 'Resumo de terça no Discord', 'Relatório no Notion automático', 'Alerta de pendência crítica', 'Prestação de contas mensal', 'Diagnóstico por produto', 'Lucro por pedido nas regras', 'Emissão de nota fiscal', 'Ciclos no plano de terça', 'Publicação real no Sprint 90', 'Promoções: execução real', 'WhatsApp do Head no crítico', 'Freio geral do executor', 'Freio do estoque', 'Urgente de estoque/preço na hora', 'Vigia avisa (sai do dry-run)', 'Endereços públicos', 'Relógio do sistema']) assert.ok(nomes.includes(n), 'nome da tabela E: ' + n)
  assert.ok(CATALOGO.length >= 24); assert.ok(new Set(CATALOGO.map(c => c.id)).size === CATALOGO.length, 'ids únicos')
  for (const k of ['gatilhos_ligado', 'consultor_discord_ligado', 'relatorio_agendador', 'alerta_auto', 'dossie_mensal_ligado', 'chaveiro_execucao_parado', 'chaveiro_estoque_parado']) assert.ok(CHAVES_BANCO.includes(k), k)
  assert.ok(!JSON.stringify(CATALOGO).match(HEX) && !EMOJI.test(JSON.stringify(CATALOGO)), 'catálogo sem hex nem emoji')
})

await caso('tela: estrutura.html + estrutura.js com 6 <th>, 0 .btn-primario, sem hex/emoji/style inline, SELO com os 8 sistemas, (i) só por dataset; tela-estrutura.css só tokens; shell e server apontam para /estrutura', () => {
  const h = ler('src/web/estrutura.html'), j = ler('src/web/estrutura.js'), css = ler('src/web/tela-estrutura.css'), sh = ler('src/web/shell.js'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/estrutura.js'])
  assert.equal((h.match(/<th>/g) || []).length, 6, 'exatamente 6 colunas'); assert.match(h, /<thead><tr><th>Estrutura<\/th><th>Sistema<\/th><th>Estado<\/th><th>Desde \/ por<\/th><th>Falta<\/th><th>Ação<\/th><\/tr><\/thead>/)
  assert.doesNotMatch(h + j, /btn-primario|ps-primario/, '0 primário'); assert.doesNotMatch(h + j + css, HEX, 'sem hex'); assert.doesNotMatch(h + j, /style=/, 'sem style inline')
  assert.ok(!EMOJI.test((h + j).replace(/\/\/.*$/gm, '')), 'sem emoji')
  assert.match(j, /colspan="6"/); assert.doesNotMatch(j, /data-ajuda="\$\{/, 'o (i) por linha nunca usa data-ajuda dinâmico no template'); assert.match(j, /b\.dataset\.ajuda = b\.dataset\.ajudaId/)
  assert.deepEqual([...j.matchAll(/data-sistema="(\w+)"/g)].map(m => m[1]), ['trinity', 'arquiteto', 'oraculo', 'merovingio', 'chaveiro', 'morpheus', 'smith', 'neo'], 'SELO na ordem do catálogo')
  assert.match(j, /<div class="kpi"><div class="rotulo">/, 'KPI nunca colorido'); assert.equal((j.match(/kp\('/g) || []).length, 4, '4 KPIs')
  assert.match(j, /pedirPor\(/); assert.match(j, /confirmar: true \} : \{ ligado: ligar, por \}/, 'freio manda confirmar:true; chave manda ligado + por')
  assert.match(h, /id="secEquipe"/); assert.match(h, /data-ajuda="equipe_papeis"/); assert.match(h, /<script src="relatorio\.js"><\/script>\s*<script src="estrutura\.js"><\/script>/)
  assert.match(sv, /app\.get\('\/estrutura'/); assert.match(sv, /app\.use\(criarRotasEstrutura\(\{ estrutura: \(\) => estruturaReal\(/); assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasEstrutura('), 'depois do guardaLocal')
  assert.match(sh, /\['estrutura', 'Estruturas', '\/estrutura'\]/); assert.match(sh, /\['estrutura:equipe', 'Equipe', '\/estrutura\?sec=secEquipe'\]/); assert.doesNotMatch(sh, /integracoes:estruturas|distribuicao:equipe/)
  const inv = JSON.parse(ler('docs/ux/inventario-estrutura.json')); assert.deepEqual(Object.values(inv.selos_sistema.secoes), ['trinity', 'arquiteto', 'oraculo', 'merovingio', 'chaveiro', 'morpheus', 'smith', 'neo'])
  assert.ok(ler('docs/estrutura.md').includes('/api/estrutura'), 'docs/estrutura.md existe e cita a rota')
})

await caso('rotas-estrutura: GET /api/estrutura devolve linhas + equipe; /api/estrutura/:id acha a linha; 404 com mensagem fixa sem ecoar o id', () => {
  const r = criarRotasEstrutura({ estrutura: () => base(), equipe: () => ({ donos: ['David do Valle'] }) })
  const pilha = r.stack.filter(l => l.route).map(l => [l.route.path, Object.keys(l.route.methods)[0]])
  assert.deepEqual(pilha, [['/api/estrutura', 'get'], ['/api/estrutura/:id', 'get']], 'só GET: nenhuma rota de escrita nasce aqui')
  const chamar = (path, params = {}) => new Promise(ok => { const res = { status(c) { this.c = c; return this }, set() { return this }, json(j) { ok({ c: this.c || 200, j }) } }; r.stack.find(l => l.route?.path === path).route.stack[0].handle({ params, query: {} }, res, () => ok(null)) })
  return Promise.all([chamar('/api/estrutura'), chamar('/api/estrutura/:id', { id: 'gatilhos' }), chamar('/api/estrutura/:id', { id: '<script>' }), chamar('/api/estrutura/:id', { id: 'nao_existe' })]).then(([a, b, c, d]) => {
    assert.equal(a.c, 200); assert.ok(a.j.linhas.length >= 24 && a.j.equipe.donos[0] === 'David do Valle'); assert.equal(b.j.id, 'gatilhos')
    assert.deepEqual(c, { c: 404, j: { erro: 'estrutura desconhecida' } }); assert.deepEqual(d, { c: 404, j: { erro: 'estrutura desconhecida' } })
  })
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-estrutura: ${ok} de ${ok + falhas.length} verificações passaram (${CATALOGO.length} estruturas no catálogo)`)
if (falhas.length) { console.error('Falharam: ' + falhas.join(' | ')); process.exit(1) }
