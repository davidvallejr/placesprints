process.env.PS_DB_MEMORIA = '1'            // banco em memória: nunca toca data/db.sqlite
process.env.ANTHROPIC_API_KEY = ''         // resumo determinístico: nenhuma chamada à IA
// Autoteste da EXPLICAÇÃO das pendências do cliente nos QUATRO relatórios (F4): relatório curto do Notion, PDF semanal, relatório do sprint e documento do plano.
// Avaliador REAL (src/lib/pendencias-cliente-real.js) sobre banco em memória, com tarefas em dependência e pendências registradas à mão em Shopee, Amazon, TikTok e Mercado Livre.
// Prova: o MESMO texto nos quatro (por que importa, se atrasar, o que precisamos, impacto), a seção só aparece com pendência, "Depende de você" continua exclusivo do perfil proativo,
// Shopee/Amazon/TikTok nunca com R$, nenhum nome/ID/jargão/promessa, falha do avaliador não derruba nenhum relatório e o modo leve do semanal não escreve no banco.
// Nunca toca Notion, Mercado Livre nem data/db.sqlite. Rodar: node scripts/teste-pendencias-relatorios.mjs
import assert from 'node:assert/strict'
import express from 'express'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { pendenciasReal } = await import('../src/lib/pendencias-cliente-real.js')
const { montarRelatorio } = await import('../src/lib/relatorio.js')
const { renderRelatorio } = await import('../src/lib/render-relatorio.js')
const { montarSemanal } = await import('../src/lib/semanal.js')
const { renderSemanal } = await import('../src/lib/render-semanal.js')
const { gerarPlanoCliente, salvarPlano } = await import('../src/lib/plano-cliente.js')
const { renderPlanoCliente } = await import('../src/lib/render-plano-cliente.js')
const { projetarBrief, auditarBrief } = await import('../src/lib/relatorio-brief.js')
const { briefParaBlocos } = await import('../src/lib/relatorio-notion.js')
const { linhasDePendencia } = await import('../src/lib/pendencias-texto.js')
const { auditarBlocos, linhasDeTexto } = await import('../src/lib/relatorio-seguro.js')
const { esc } = await import('../src/lib/estilo-editorial.js')
const { rotasPlanos } = await import('../src/rotas-planos.js')
assert.equal(db.name, ':memory:', 'o teste NUNCA abre data/db.sqlite')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const soma = (iso, k) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10) }
const HOJE = hojeLocal(), DE = soma(HOJE, -6), C = 'Cliente Pendências', VAZIO = 'Cliente Sem Pendência'

// ── mundo: 1 tarefa em dependência (Shopee, tipo "fotos") + 4 pendências registradas à mão (Amazon crítica, TikTok crítica, Shopee, Mercado Livre) ──
const tarefa = (cli, id, o = {}) => db.prepare(`INSERT INTO tarefas (id, fonte, cliente, sprint, titulo, processo, status_raw, status, data_inicio, prazo, data_conclusao, last_edited, bloqueio, responsavel, impacto, url, visivel_cliente, arquivada)
  VALUES (@id, 'ds', @cliente, 'Sprint 2026-10', @titulo, @processo, @status_raw, @status, @data_inicio, NULL, NULL, @last_edited, '', 'Ana', '', @url, @visivel_cliente, 0)`)
  .run({ id, cliente: cli, titulo: id, visivel_cliente: 1, processo: 'Shopee', status_raw: 'dependencia_cliente', status: 'dependencia_cliente', data_inicio: soma(HOJE, -20), last_edited: soma(HOJE, -9) + 'T10:00:00.000Z', url: `https://notion.so/${id}`, ...o })
tarefa(C, 'Fotos Pet', { status_raw: 'Aguardando Devolutiva do Cliente' })
db.prepare('INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, por, em, notion_ok) VALUES (?,?,?,?,?,?,1)').run('Fotos Pet', C, 'fotos', '12 SKUs da linha Pet (texto interno da equipe)', 'Lia', soma(HOJE, -9) + 'T12:00:00.000Z')
tarefa(C, 'Entregue', { status_raw: 'Concluída', status: 'concluida', data_conclusao: soma(HOJE, -2), processo: 'Mercado Livre' })
tarefa(VAZIO, 'Rotina', { status_raw: 'Em andamento', status: 'andamento', processo: 'Mercado Livre' })
const reg = (item, canal, gravidade, dias, detalhe) => db.prepare('INSERT INTO pendencia_cliente (cliente, canal, item, detalhe, desde, evidencia, gravidade, por, criada_em) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(C, canal, item, detalhe, soma(HOJE, -dias), '', gravidade, 'Lia', soma(HOJE, -dias) + 'T12:00:00.000Z')
reg('documentos_conta', 'amazon', 'critico', 12, 'cartão vencido, falar com o financeiro (INTERNO)')
reg('regulatorio', 'tiktok', 'critico', 5, 'categoria restrita (INTERNO)')
reg('despacho_prazo', 'shopee', 'atencao', 3, 'pontos de penalidade (INTERNO)')
reg('verba_ads', 'ml', 'atencao', 2, 'sem verba (INTERNO)')

const AVALIADAS = pendenciasReal().avaliar(C).itens
const SEM_ECO = ['INTERNO', 'financeiro', 'cartão vencido, falar', '12 SKUs da linha Pet', 'Lia', 'texto interno da equipe']
const tira = html => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
const secao = (html, ini, fim) => { const i = html.indexOf(ini); assert.ok(i >= 0, `seção "${ini}" ausente`); const j = html.indexOf(fim, i + ini.length); return html.slice(i, j < 0 ? undefined : j) }

await ok('base: o avaliador real vê 5 pendências (1 tarefa + 4 registros) e nenhuma fora do Mercado Livre tem R$', () => {
  assert.deepEqual(AVALIADAS.map(p => [p.item, p.canal, p.gravidade, p.fonte]), [['documentos_conta', 'amazon', 'critico', 'registro'], ['regulatorio', 'tiktok', 'critico', 'registro'], ['despacho_prazo', 'shopee', 'atencao', 'registro'],
    ['verba_ads', 'ml', 'atencao', 'registro'], ['midia_produto', 'shopee', 'info', 'tarefa']], 'ordem do avaliador (a tarefa de 9 dias ainda é informativa: régua 14/30)')
  for (const p of AVALIADAS) assert.deepEqual([p.impacto.tipo, p.impacto.valor_brl], ['sem_estimativa', null], `${p.canal}: sem base não há R$`)
})

// ── os quatro relatórios ─────────────────────────────────────────────────────────────────────────────────────
const semanal = await montarSemanal({ cliente: C, de: DE, ate: HOJE })
const htmlSemanal = renderSemanal(semanal), htmlSemanalInterno = renderSemanal(semanal, { interno: true })
const relatorio = await montarRelatorio({ cliente: C, sprint: 'Sprint 2026-10' })
const htmlSprint = renderRelatorio(relatorio)
const cli = { cliente: C, status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: 'Fulano Teste' }, lideres: { ML: 'Líder Teste' }, principal: 'Fulano Teste', squads: ['Squad Líder Teste'], squadPrincipal: 'Squad Líder Teste', squadDoCanal: () => 'Squad Líder Teste', responsavelDoCanal: () => 'Fulano Teste' }
const gerado = gerarPlanoCliente(cli, { hoje: HOJE })
const htmlPlano = renderPlanoCliente(gerado.plano, gerado.acoes, { pendencias: AVALIADAS, pendenciasEm: HOJE })
const brief = projetarBrief(semanal, { cliente: C, hoje: HOJE, hora: '10:00', acoesPlano: [], eventos: new Map(), inicioHistorico: null, nomes: ['Ana Silveira', 'Lia Prado'], pendencias: AVALIADAS })
const blocos = briefParaBlocos(brief), textoNotion = linhasDeTexto(blocos).join('\n')

await ok('PDF semanal: montarSemanal devolve as pendências (sem o texto interno) e o render mostra "Pontos que dependem de você" com a explicação; o bloco novo nunca usa a string "Depende de você"', () => {
  assert.equal(semanal.pendencias.length, 5); assert.ok(semanal.pendencias.every(p => !('detalhe_interno' in p)), 'o texto da equipe não sai do motor')
  const h = tira(htmlSemanal), s = secao(h, 'data-sec="pendencias"', '</section>')
  assert.ok(s.includes('Pontos que dependem de você') && s.includes('Seção '), 'a seção numerada'); assert.ok(!s.includes('Depende de você'), 'o bloco novo não usa a string exata que o teste do semanal reserva ao proativo (os pontos de atenção já trazem a deles)')
  assert.equal((s.match(/class="pend /g) || []).length, 5); assert.ok(/class="pend critico"/.test(s) && /class="pend atencao"/.test(s))
  assert.ok(s.indexOf('Documentos e validação da conta') < s.indexOf('Registro regulatório') && s.indexOf('Registro regulatório') < s.indexOf('Despacho dos pedidos'), 'gravidade primeiro')
  assert.ok(s.includes('Amazon · desde ') && s.includes(' dias)'), 'canal e desde quando'); assert.ok(!/R\$|undefined|NaN|\[object/.test(s))
  assert.ok(htmlSemanalInterno.includes('data-sec="pendencias"') && htmlSemanalInterno.includes('Checklist de coleta'), 'a versão interna também traz o bloco')
  for (const x of SEM_ECO) assert.ok(!s.includes(x), `"${x}" não vaza no bloco novo (os pontos de atenção de antes seguem como estavam)`)
})

await ok('relatório do sprint: seção "O que depende do cliente" (07) com a explicação; o stat "Depende do cliente" e a seção 06 não mudam; os números seguintes acompanham', () => {
  assert.equal(relatorio.pendencias_cliente.length, 5); assert.ok(relatorio.pendencias_cliente.every(p => !('detalhe_interno' in p)))
  const h = tira(htmlSprint), s = secao(h, 'O que depende do cliente</h2>', '</section>')
  assert.ok(h.includes('Seção 07</span><h2>O que depende do cliente') && h.includes('Seção 08</span><h2>Próximo sprint') && h.includes('Seção 06</span><h2>Pendências e bloqueios'))
  assert.equal((s.match(/class="entrega"/g) || []).length, 5); assert.ok(s.includes('Situação de hoje, não do sprint.'))
  assert.ok(/<div class="lbl">Depende do cliente<\/div>/.test(h), 'o stat segue lá'); assert.ok(!/R\$|undefined|NaN|\[object/.test(s))
  for (const x of SEM_ECO) assert.ok(!s.includes(x), `"${x}" não vaza na seção nova (a 06 de antes segue como estava)`)
})

await ok('documento do plano: seção "O que depende do cliente" (12) antes das pendências do plano (13), com a explicação e a data da leitura; o dado entra pela opção `pendencias`', () => {
  const h = tira(htmlPlano), s = secao(h, 'O que depende do cliente</h2>', '</section>')
  assert.ok(h.includes('Seção 12</span><h2>O que depende do cliente') && h.includes('Seção 13</span><h2>Pendências, decisões e próxima revisão'))
  assert.ok(s.includes(`Situação em ${HOJE.slice(8)}/${HOJE.slice(5, 7)}/${HOJE.slice(0, 4)}.`)); assert.equal((s.match(/class="pl-dep"/g) || []).length, 5); assert.ok(!/R\$|undefined|NaN|\[object/.test(s))
  const sem = renderPlanoCliente(gerado.plano, gerado.acoes, {})
  assert.ok(!sem.includes('O que depende do cliente') && sem.includes('Seção 12</span><h2>Pendências, decisões e próxima revisão'), 'sem pendência: o documento é o de antes')
  assert.equal(renderPlanoCliente(gerado.plano, gerado.acoes, { pendencias: 'lixo' }).includes('O que depende do cliente'), false)
  for (const x of SEM_ECO) assert.ok(!htmlPlano.includes(x), `"${x}" não vaza`)
})

await ok('relatório curto: alertas só das críticas e "Depende de você" com a explicação, sem repetir a lista de tarefas; auditor (duas camadas) limpo', () => {
  assert.deepEqual(brief.alertas.map(a => [a.rotulo, a.canal_rotulo]), [['Documentos e validação da conta', 'Amazon'], ['Registro regulatório e categoria restrita', 'TikTok Shop']])
  assert.equal(brief.depende.pendencias.length, 5); assert.deepEqual(auditarBrief(brief, { nomes: ['Ana Silveira', 'Lia Prado'] }), [])
  assert.ok(blocos.length <= 60); assert.ok(textoNotion.includes('Pontos que exigem retorno do cliente com prioridade:') && textoNotion.includes('Depende de você'))
  assert.equal(blocos.filter(b => b.type === 'callout' && b.callout.color === 'red_background').length, 1)
  assert.deepEqual(auditarBlocos(blocos, { nomesInternos: ['Ana Silveira', 'Lia Prado'], permitidos: [C] }), [], 'a página inteira passa no auditor da 2ª camada')
  for (const x of SEM_ECO) assert.ok(!textoNotion.includes(x), `"${x}" não vaza`)
  assert.ok(!/R\$/.test(textoNotion), 'Shopee, Amazon e TikTok nunca com R$ (o Mercado Livre só com previsão do sistema, e aqui não há)')
})

await ok('TEXTO ÚNICO: cada uma das CINCO linhas (por que importa, se atrasar, o que precisamos, impacto, o que fazemos quando recebermos) é idêntica nos quatro relatórios', () => {
  const htmls = { semanal: tira(htmlSemanal), sprint: tira(htmlSprint), plano: tira(htmlPlano) }
  for (const p of AVALIADAS) {
    const L = linhasDePendencia(p)
    assert.equal(L.linhas.length, 5, `${p.item}: as cinco linhas`)
    assert.deepEqual(L.linhas.map(l => l.chave), ['por_que', 'atraso', 'precisamos', 'impacto', 'fazemos'], 'a quinta linha registra o trabalho da Place2u')
    assert.equal(L.linhas.at(-1).rotulo, 'O que fazemos quando recebermos'); assert.equal(L.linhas.at(-1).texto, p.o_que_fazemos, 'o texto é o template fixo do catálogo')
    for (const l of L.linhas) {
      assert.ok(l.texto.length > 10 && !/undefined|NaN/.test(l.texto))
      for (const [nome, h] of Object.entries(htmls)) assert.ok(h.includes(esc(l.texto)), `${nome}: "${l.rotulo}" de ${p.item}/${p.canal}`)
      assert.ok(textoNotion.includes(`${l.rotulo}: ${l.texto}`), `notion: "${l.rotulo}" de ${p.item}/${p.canal}`)
    }
    assert.equal(L.linhas.find(l => l.chave === 'impacto').rotulo, 'Impacto não estimado')
    for (const [nome, h] of Object.entries(htmls)) { assert.ok(h.includes(esc(L.titulo)) && h.includes(esc(L.quando)), `${nome}: título e desde quando`) }
    assert.ok(textoNotion.includes(L.titulo) && textoNotion.includes(L.quando))
  }
})

// ── política de tom e de visibilidade (08/10): o caso Damar ─────────────────────────────────────────────────────────────────────────────────────
// Cliente com 2 tarefas SEM tipo registrado, data só da última edição do card (128 e 71 dias), 1 tarefa tipada com data real (registro, 20 dias) e 1 tarefa INVISÍVEL ao cliente.
const CA = 'Cliente Aproximado'
const FEIO_DOC = /última atualização da tarefa|tarefas? aguarda(?:m)?[^.]*\d+ dias?|\d+ dias?[^.\n]{0,40}aproximad|aproximad[^.\n]{0,40}\d+ dias?|\d+ dia\(s\)[^.\n]*aproximad/i
const FEIO = /\bcard\b|última atualização da tarefa|tarefas? aguarda(?:m)?[^.]*\d+ dias?|\d+ dias?[^.\n]{0,40}aproximad|aproximad[^.\n]{0,40}\d+ dias?|\d+ dia\(s\)[^.\n]*aproximad|tarefa\(s\) parada\(s\) há \d+ dia\(s\)[^.\n]*aproximad/i
tarefa(CA, 'Magalu A', { processo: 'Magazine Luiza', status_raw: 'Aguardando Devolutiva do Cliente', data_inicio: null, last_edited: soma(HOJE, -128) + 'T10:00:00.000Z' })
tarefa(CA, 'Magalu B', { processo: 'Magazine Luiza', status_raw: 'Aguardando Devolutiva do Cliente', data_inicio: null, last_edited: soma(HOJE, -100) + 'T10:00:00.000Z' })
tarefa(CA, 'Amazon A', { processo: 'Amazon 1', status_raw: 'Aguardando Devolutiva do Cliente', data_inicio: null, last_edited: soma(HOJE, -71) + 'T10:00:00.000Z' })
tarefa(CA, 'Doc Real', { processo: 'Amazon 1', status_raw: 'Aguardando Devolutiva do Cliente', data_inicio: null, last_edited: soma(HOJE, -20) + 'T10:00:00.000Z' })
db.prepare('INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, por, em, notion_ok) VALUES (?,?,?,?,?,?,1)').run('Doc Real', CA, 'documentos', 'contrato social (INTERNO)', 'Lia', soma(HOJE, -20) + 'T12:00:00.000Z')
tarefa(CA, 'Fotos Internas', { processo: 'Shopee', status_raw: 'Aguardando Devolutiva do Cliente', visivel_cliente: 0, data_inicio: null, last_edited: soma(HOJE, -40) + 'T10:00:00.000Z' })
db.prepare('INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, por, em, notion_ok) VALUES (?,?,?,?,?,?,1)').run('Fotos Internas', CA, 'fotos', 'fotos da linha interna (INTERNO)', 'Lia', soma(HOJE, -40) + 'T12:00:00.000Z')

await ok('Damar: a avaliação ao cliente não tem crítico sem registro (tarefa sem tipo ou aproximada = atenção), não vê a tarefa invisível e não escreve dias aproximados; o Resumo interno vê tudo', () => {
  const cli = pendenciasReal().avaliar(CA), interno = pendenciasReal().avaliar(CA, { paraCliente: false })
  assert.deepEqual(cli.itens.map(p => [p.item, p.canal, p.gravidade, p.tarefas]), [['documentos_conta', 'amazon', 'critico', 1], ['retorno_pendente', 'magalu', 'atencao', 2], ['retorno_pendente', 'amazon', 'atencao', 1]],
    'crítica só a tarefa tipada com data real; as sem tipo/aproximadas em atenção; a invisível (Shopee, fotos) fora')
  assert.deepEqual(cli.tarefas.map(t => t.id).sort(), ['Amazon A', 'Doc Real', 'Magalu A', 'Magalu B'])
  assert.ok(interno.itens.some(p => p.item === 'midia_produto' && p.canal === 'shopee') && interno.tarefas.some(t => t.id === 'Fotos Internas'), 'o Resumo (interno) vê a invisível')
  const ret = interno.itens.find(p => p.item === 'retorno_pendente' && p.canal === 'magalu')
  assert.match(ret.evidencia, /128 dia\(s\); data aproximada pela última atualização da tarefa/, 'o Resumo mantém os dias')
  assert.equal(cli.itens.filter(p => p.desde_aproximado).length, 2); assert.ok(cli.itens.filter(p => p.desde_aproximado).every(p => !FEIO.test(JSON.stringify(p)) && !/\d+ dia/.test(p.evidencia)))
})

await ok('Damar nos QUATRO relatórios: nenhum alerta vermelho de tarefa sem tipo, nenhuma contagem de dias aproximada, nenhuma tarefa invisível; a quinta linha aparece em todos', async () => {
  const AV = pendenciasReal().avaliar(CA).itens
  const sem = await montarSemanal({ cliente: CA, de: DE, ate: HOJE }), rel = await montarRelatorio({ cliente: CA, sprint: 'Sprint 2026-10' })
  const hSem = tira(renderSemanal(sem)), hRel = tira(renderRelatorio(rel)), hPlano = tira(renderPlanoCliente(gerado.plano, gerado.acoes, { pendencias: AV, pendenciasEm: HOJE }))
  const br = projetarBrief(sem, { cliente: CA, hoje: HOJE, hora: '10:00', acoesPlano: [], eventos: new Map(), inicioHistorico: null, nomes: ['Ana Silveira', 'Lia Prado'], pendencias: AV })
  const bl = briefParaBlocos(br), tNotion = linhasDeTexto(bl).join('\n')
  assert.deepEqual(br.alertas.map(a => [a.rotulo, a.canal_rotulo]), [['Documentos e validação da conta', 'Amazon']], 'o único alerta é o de tipo registrado + data real')
  assert.ok(br.alertas.every(a => !a.desde_aproximado) && br.depende.pendencias.filter(p => p.desde_aproximado).every(p => p.dias === null), 'a forma do cliente não carrega dias da data aproximada')
  assert.equal(bl.filter(b => b.type === 'callout' && b.callout.color === 'red_background').length, 1)
  const quando = tNotion.match(/(?:Retorno pendente do cliente)[^\n]*/g)
  assert.deepEqual(quando.sort(), [`Retorno pendente do cliente · Amazon · em aberto; data aproximada: ${soma(HOJE, -71).slice(8)}/${soma(HOJE, -71).slice(5, 7)}`, `Retorno pendente do cliente · Magalu · em aberto; data aproximada: ${soma(HOJE, -128).slice(8)}/${soma(HOJE, -128).slice(5, 7)}`])
  const texto = html => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')            // só o que o leitor vê
  const sec = { notion: tNotion.slice(tNotion.indexOf('Depende de você')), semanal: secao(hSem, 'data-sec="pendencias"', '</section>'), sprint: secao(hRel, 'O que depende do cliente</h2>', '</section>'), plano: secao(hPlano, 'O que depende do cliente</h2>', '</section>') }
  for (const [nome, h0] of Object.entries({ notion: tNotion, semanal: hSem, sprint: hRel, plano: hPlano })) {
    const h = texto(h0), so = texto(sec[nome])
    // nas seções de pendência nenhuma das expressões proibidas (inclusive "card"); no documento inteiro, as que são específicas da data aproximada
    { const m = FEIO.exec(so); assert.ok(!m, `${nome} (seção): …${m && so.slice(Math.max(0, m.index - 80), m.index + 80)}…`) }
    { const m = FEIO_DOC.exec(h); assert.ok(!m, `${nome}: …${m && h.slice(Math.max(0, m.index - 80), m.index + 80)}…`) }
    // a contagem do calendário comercial («Natal em 25/12/2026 (daqui a 71 dias)», tabela «Natal 25/12/2026 71 dias») não é data aproximada de pendência: fora da
    // checagem (em 15/10 o Natal cai exatamente a 71 dias e o teste acusava o calendário)
    assert.ok(!/\b128 dias?\b|\b71 dias?\b|\b100 dias?\b/.test(h.replace(/daqui a \d+ dias?|\d{2}\/\d{2}\/\d{4}\s+\d+ dias?/g, '')), `${nome}: sem "128 dias"/"71 dias"`)
    assert.ok(!/Fotos Internas|fotos da linha interna|Imagens e vídeo dos produtos · Shopee/.test(h), `${nome}: a tarefa invisível ao cliente não aparece`)
    assert.ok(h.includes('O que fazemos quando recebermos'), `${nome}: quinta linha`)
  }
  assert.ok(hSem.includes('em aberto; data aproximada: ') && hRel.includes('em aberto; data aproximada: ') && hPlano.includes('em aberto; data aproximada: '))
  assert.ok(/class="pend critico"/.test(hSem) && (hSem.match(/class="pend atencao"/g) || []).length === 2, 'semanal: 1 crítica (data real) e 2 em atenção')
  assert.deepEqual(auditarBlocos(bl, { nomesInternos: ['Ana Silveira', 'Lia Prado'], permitidos: [CA] }), [])
  // fallback sem avaliador (falha): o "Depende de você" antigo também não conta dias de data aproximada
  const fb = projetarBrief(sem, { cliente: CA, hoje: HOJE, hora: '10:00', acoesPlano: [], eventos: new Map(), inicioHistorico: null, nomes: [], pendencias: [] })
  const tFb = linhasDeTexto(briefParaBlocos(fb)).join('\n'), dFb = tFb.slice(tFb.indexOf('Depende de você'))
  assert.ok(!/\b(128|100|71) dias?\b/.test(dFb) && /em aberto; data aproximada: /.test(dFb), dFb.slice(0, 300))
  const atDep = sem.atencao.filter(a => a.tipo === 'Depende de você').map(a => a.texto).join('\n')
  assert.ok(!/\d+ dia\(s\)|última atualização/.test(atDep.replace(/Doc Real[^\n]*/, '')), atDep)       // a de data real ("Doc Real") segue com dias
  assert.ok(rel.pendencias.every(p => !/desde \d{2}\/\d{2}\/\d{4}\)/.test(p.motivo) || /Doc Real/.test(p.titulo)), 'sprint 06: aproximada não diz "desde"')
})

await ok('relatório do sprint: o stat "N há 14+ dias" só conta datas reais (dependencia_14d_exata); o interno mantém dependencia_14d', async () => {
  const rel = await montarRelatorio({ cliente: CA, sprint: 'Sprint 2026-10' }), k = rel.kpis
  assert.deepEqual([k.dependencia_cliente, k.dependencia_14d, k.dependencia_14d_exata], [4, 4, 1], 'os 4 passam de 14 dias, mas só 1 tem data real (a tipada); o resto veio da última edição')
  assert.ok(tira(renderRelatorio(rel)).includes('1 há 14+ dias') && !/4 há 14\+ dias/.test(tira(renderRelatorio(rel))))
  const so = await montarRelatorio({ cliente: CA, sprint: 'Sprint 2026-10', interno: true })
  assert.equal(so.kpis.dependencia_14d, 5, 'interno: 5 (inclui a invisível)')
})

await ok('semanal: a linguagem do perfil muda só os rótulos (simples/técnica), o bloco some sem pendência e o proativo mantém "Depende de você" além do bloco novo', async () => {
  const simples = tira(renderSemanal(await montarSemanal({ cliente: C, de: DE, ate: HOJE, perfil: ['zero_conhecimento'] })))
  assert.ok(simples.includes('O que precisamos de você') && simples.includes('Por que isso importa') && simples.includes('O que acontece se atrasar') && simples.includes('O que precisamos de você para seguir, por que isso importa'))
  const tecnica = tira(renderSemanal(await montarSemanal({ cliente: C, de: DE, ate: HOJE, perfil: ['tecnico'] })))
  assert.ok(tecnica.includes('Pendências por canal, com a premissa de cada estimativa') && !tecnica.includes('Por que isso importa') && tecnica.includes('Por que importa'))
  const proativo = renderSemanal(await montarSemanal({ cliente: C, de: DE, ate: HOJE, perfil: ['proativo'] }))
  assert.ok(proativo.includes('data-sec="pendencias"') && proativo.includes('<b>Depende de você:</b>'), 'o bloco novo não tira o que o proativo já tinha')
  const vazio = await montarSemanal({ cliente: VAZIO, de: DE, ate: HOJE })
  assert.deepEqual(vazio.pendencias, []); const hv = renderSemanal(vazio); assert.ok(!hv.includes('data-sec="pendencias"') && !hv.includes('Pontos que dependem de você'))
  const rv = await montarRelatorio({ cliente: VAZIO, sprint: 'Sprint 2026-10' }), shv = renderRelatorio(rv)
  assert.deepEqual(rv.pendencias_cliente, []); assert.ok(!shv.includes('O que depende do cliente') && shv.includes('Seção 07</span><h2>Próximo sprint'), 'sem pendência a numeração é a de sempre')
  const br = projetarBrief(vazio, { cliente: VAZIO, hoje: HOJE, hora: '10:00', acoesPlano: [], eventos: new Map(), inicioHistorico: null, nomes: [], pendencias: [] })
  assert.deepEqual([br.alertas, br.depende.pendencias], [[], []]); assert.ok(!linhasDeTexto(briefParaBlocos(br)).join('\n').includes('Pontos que exigem retorno'))
  // relatório de TODOS os clientes (sem filtro de cliente) não avalia pendência de ninguém
  assert.deepEqual((await montarRelatorio({})).pendencias_cliente, [])
})

await ok('falha do avaliador NÃO derruba nenhum relatório: semanal e sprint saem sem o bloco (aviso interno / em "Qualidade dos dados"); o documento do plano também', async () => {
  const real = pendenciasReal(), original = real.avaliar
  real.avaliar = () => { throw new Error('banco indisponível') }
  try {
    const s = await montarSemanal({ cliente: C, de: DE, ate: HOJE })
    assert.deepEqual(s.pendencias, []); assert.ok(s.avisos.some(a => /Pendências do cliente por canal indisponíveis/.test(a)) && !s.avisos.join(' ').includes('banco indisponível'))
    assert.ok(!renderSemanal(s).includes('data-sec="pendencias"')); assert.ok(renderSemanal(s, { interno: true }).includes('Pendências do cliente por canal indisponíveis'), 'o aviso aparece só na versão interna')
    assert.ok(!renderSemanal(s).includes('Pendências do cliente por canal indisponíveis'))
    const r = await montarRelatorio({ cliente: C, sprint: 'Sprint 2026-10' })
    assert.deepEqual(r.pendencias_cliente, []); assert.ok(r.avisos.some(a => /não foram avaliadas/.test(a))); const h = renderRelatorio(r); assert.ok(!h.includes('<h2>O que depende do cliente') && h.includes('Seção 07</span><h2>Próximo sprint') && h.includes('Seção 08</span><h2>Qualidade dos dados'))
  } finally { real.avaliar = original }
})

await ok('modo leve (relatório curto): NÃO grava a linha semanal de métricas nem avalia pendências; o PDF (sem leve) grava como sempre', async () => {
  const demo = 'Cliente Demo — Moda Casa', n0 = () => db.prepare('SELECT COUNT(*) n FROM metricas_semana WHERE cliente = ?').get(demo).n
  assert.equal(n0(), 0)
  const leve = await montarSemanal({ cliente: demo, de: '2026-09-08', ate: '2026-09-14', leve: true })
  assert.ok(leve.metricas && leve.metricas.faturamento > 0, 'as métricas manuais valem para a janela'); assert.equal(n0(), 0, 'prévia/curto: somente leitura'); assert.deepEqual(leve.pendencias, [])
  const cheio = await montarSemanal({ cliente: demo, de: '2026-09-08', ate: '2026-09-14' })
  assert.equal(n0(), 1, 'o PDF continua gravando'); assert.ok(Array.isArray(cheio.pendencias))
})

await ok('rota /plano: o documento sai com a seção "O que depende do cliente" (avaliador real, dia de hoje) e continua saindo se o avaliador falhar', async () => {
  salvarPlano(gerado.plano, gerado.acoes)
  const app = express(); app.use(rotasPlanos)
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const real = pendenciasReal(), original = real.avaliar
  try {
    const r = await fetch(`${base}/plano?cliente=${encodeURIComponent(C)}`), h = tira(await r.text())
    assert.equal(r.status, 200); assert.ok(h.includes('Seção 12</span><h2>O que depende do cliente') && h.includes(`Situação em ${HOJE.slice(8)}/${HOJE.slice(5, 7)}/${HOJE.slice(0, 4)}.`)); assert.equal((h.match(/class="pl-dep"/g) || []).length, 5)
    real.avaliar = () => { throw new Error('x') }
    const r2 = await fetch(`${base}/plano?cliente=${encodeURIComponent(C)}`), h2 = await r2.text()
    assert.equal(r2.status, 200); assert.ok(!h2.includes('O que depende do cliente') && h2.includes('Pendências, decisões e próxima revisão'))
  } finally { real.avaliar = original; await new Promise(res => srv.close(res)) }
})

console.log(`\n${n} verificações passaram.`)
