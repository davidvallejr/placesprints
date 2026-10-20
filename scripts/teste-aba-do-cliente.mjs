// Autoteste da aba «Do cliente» do /cliente (src/lib/aba-do-cliente.js + src/rotas-aba-do-cliente.js): junta as 5 fontes sem duplicar produto/assunto, gravidade e ordem,
// comunicação (último aviso, resposta, sem resposta há N dias), isolamento por cliente, mover para o consultor, resolvido some (e o medido volta depois da janela),
// lembrete só prepara (nada gravado, nenhum lote). Banco EM MEMÓRIA, fontes stub, relógio falso: sem rede. Rodar: node scripts/teste-aba-do-cliente.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { readFileSync } from 'node:fs'
import { criarAbaDoCliente, DIAS_RESOLVIDO } from '../src/lib/aba-do-cliente.js'
import { criarRotasAbaDoCliente } from '../src/rotas-aba-do-cliente.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const QUEM = ['Ana Líder', 'Caio Consultor']
const idAcao = (c, r, a) => `PS-${c}-${r}-${a}`
const pend = (o = {}) => ({ id: 'estoque_curva_a|ml|resumo', item: 'estoque_curva_a', rotulo: 'Estoque dos produtos que mais vendem', canal: 'ml', fonte: 'medido', gravidade: 'critico', desde: null, dias: null,
  evidencia: 'Leitura de hoje: 2 produtos com estoque curto.', por_que_importa: 'Sem estoque o anúncio pausa.', o_que_precisamos: 'Precisamos da data de entrada da reposição.', o_que_fazemos: 'Atualizamos o canal.',
  impacto: { tipo: 'previsto', valor_brl: 900, rotulo: 'Receita possivelmente em risco: R$ 900 (estimativa)', premissa: 'ritmo de 28 dias' }, registro_id: null, anuncios: [{ id: 'MLB1', cobertura_dias: 3, estoque: 4, curva: 'A' }, { id: 'MLB2', cobertura_dias: 5, estoque: 6, curva: 'A' }], ...o })
const acao = (o = {}) => ({ id: 'PS-x', cliente: 'Acme', regra: 'anuncio_estoque_ruptura', status: 'proposta', titulo: 'Repor estoque antes de zerar: Coleira (MLB2)', item_id: 'MLB2', notion_url: '', dados: { execucao: { caminho: 'cliente' }, impacto: 5, urgencia: 5, confianca: 5, esforco: 1 }, ...o })

function mundo({ dia = '2026-10-15', cliente = 'Acme' } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE gatilho_lote (id TEXT PRIMARY KEY, cliente TEXT, tipo TEXT, estado TEXT)")    // só para provar que o lembrete não cria lote
  const relogio = { dia }, resolvidos = []
  const porCliente = {
    Acme: {
      itens: [pend(),
        pend({ id: 'preco_custo|ml|resumo', item: 'preco_custo', rotulo: 'Preço de custo', gravidade: 'atencao', anuncios: [], impacto: { tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado', premissa: null }, o_que_precisamos: 'Precisamos do preço de custo.' }),
        pend({ id: 'retorno_pendente|ml|tarefas', item: 'retorno_pendente', rotulo: 'Retorno', fonte: 'tarefa', gravidade: 'atencao', desde: '2026-09-25', dias: 20, anuncios: [], impacto: { tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado: 2 tarefa(s)', premissa: null } }),
        pend({ id: 'documentos_conta|amazon|r7', item: 'documentos_conta', rotulo: 'Documentos', canal: 'amazon', fonte: 'registro', gravidade: 'info', registro_id: 7, anuncios: [], impacto: { tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado', premissa: null } })],
      tarefas: [{ id: 't1', titulo: 'Fotos novas', url: 'https://notion.so/t1', dias: 20, canal: 'ml', item: 'retorno_pendente', tipo_rotulo: '' }, { id: 't2', titulo: 'Clips', url: 'https://notion.so/t2', dias: 35, canal: 'ml', item: 'retorno_pendente', tipo_rotulo: '' }],
    },
    Beta: { itens: [pend({ anuncios: [{ id: 'MLB9', cobertura_dias: 1, estoque: 1, curva: 'A' }] })], tarefas: [] },
  }
  const acoes = {
    Acme: [acao(), acao({ id: idAcao('Acme', 'pendencia_cliente', 'estoque_curva_a|ml|resumo'), regra: 'pendencia_cliente', item_id: '', titulo: 'Cobrar o cliente: Estoque', dados: { impacto: 4, urgencia: 5, confianca: 5, esforco: 1 } }),
      acao({ id: 'PS-custos', regra: 'anuncio_cadastrar_custos', item_id: '', titulo: 'Informar custos', dados: { impacto: 3, urgencia: 3, confianca: 3, esforco: 2 } }),     // sem dados.execucao: o Chaveiro classifica (caminho cliente)
      acao({ id: 'PS-bloq', regra: 'bloqueio_cliente', item_id: '', titulo: 'Cobrar o cliente: 2 tarefas', dados: { impacto: 3, urgencia: 4, confianca: 5, esforco: 1 } }),
      acao({ id: 'PS-frete', regra: 'anuncio_frete_gratis', item_id: 'MLB1', titulo: 'Frete grátis', dados: { execucao: { caminho: 'automatico' }, impacto: 4, urgencia: 4, confianca: 4, esforco: 1 } }),   // da equipe: fica fora
      acao({ id: 'PS-desc', status: 'descartada', item_id: 'MLB3' })],
    Beta: [acao({ id: 'PS-beta', cliente: 'Beta', item_id: 'MLB9' })],
  }
  const compras = {
    Acme: { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Mordedor Natural', preco: 50, estoque: 4, cobertura: 3, curva: 'A', full: true, sufixo: '', lead: 21, origem: 'ruptura', pedir_ate: null, impacto: { c: 300, b: 600, dias: 28 } },
      { id: 'MLB3', titulo: 'Guia Unificada', preco: 70, estoque: 0, cobertura: 0, curva: 'A', full: false, sufixo: '', lead: 21, origem: 'pedir_agora', pedir_ate: null, impacto: { c: 100, b: 200, dias: 28 } }] },
    Beta: { disponivel: false, motivo: 'sem_coleta' },
  }
  const comunicacao = {
    Acme: { lotes: [{ id: 'L1', tipo: 'compras', dia: '2026-10-14', estado: 'entregue', enviado_em: '2026-10-14T10:00:00Z', recibos_json: '{"whatsapp":{"estado":"entregue","em":"2026-10-14T10:00:02Z"}}' },
      { id: 'L0', tipo: 'semanal', dia: '2026-10-06', estado: 'entregue', enviado_em: '2026-10-06T12:00:00Z', recibos_json: '{}' }],
      avisados: [{ item_id: 'MLB1', enviado_em: '2026-10-14T10:00:00Z', lote_id: 'L1' }],
      gatilhos: [{ tipo: 'custos_nao_informados', itens_json: '[]', lote_id: 'L0', enviado_em: '2026-10-06T12:00:00Z' }],
      respostas: [{ recebido_em: '2026-10-14T15:00:00Z', texto: 'O pedido sai sexta', status: 'novo', origem: 'whatsapp' }, { recebido_em: '2026-10-14T16:00:00Z', texto: 'apagar', status: 'descartado', origem: 'whatsapp' }] },
    Beta: { lotes: [], avisados: [], gatilhos: [], respostas: [] },
  }
  const pendencias = {
    avaliar: (c, o) => { assert.equal(o.paraCliente, false, 'tela interna pede paraCliente:false'); return { gerado_em: 'x', ...porCliente[c] } },
    resolver: b => { assert.equal(b.confirmar, true); resolvidos.push(b.registro_id); porCliente.Acme.itens = porCliente.Acme.itens.filter(p => p.registro_id !== b.registro_id); return { ok: true } },
  }
  const aba = criarAbaDoCliente({ handle: h, pendencias, acoes: c => acoes[c] || [], prioridade: a => { const d = a.dados; const nota = Math.round(d.impacto * 8 + d.urgencia * 4 + d.confianca * 5 + (6 - d.esforco) * 3); return { p: nota >= 85 ? 'P0' : nota >= 70 ? 'P1' : nota >= 50 ? 'P2' : 'P3', nota } },
    compras: c => compras[c], idAcao, comunicacao: c => comunicacao[c], rotulo: c => c, auditar: auditarTexto, validarPor: (nome, c) => QUEM.find(q => q === nome) || (c === 'Acme' && nome === 'Cora CS' ? 'Cora CS' : ''),
    hoje: () => relogio.dia, agora: () => relogio.dia + 'T12:00:00Z' })
  return { h, aba, relogio, resolvidos, acoes, porCliente, comunicacao }
}

await ok('junta as 5 fontes por assunto e produto: um cartão de estoque com 3 produtos sem repetir, custos (pendência + ação sem execucao), retorno com as tarefas e a cobrança', () => {
  const { aba } = mundo(), r = aba.ler('Acme')
  const chaves = r.itens.map(i => i.chave)
  assert.deepEqual([...chaves].sort(), ['custos|ml', 'documentos_conta|amazon', 'estoque|ml', 'retorno|ml'])
  assert.equal(new Set(chaves).size, chaves.length, 'assunto nunca repete')
  const est = r.itens.find(i => i.chave === 'estoque|ml')
  assert.deepEqual(est.produtos.map(p => p.id).sort(), ['MLB1', 'MLB2', 'MLB3'], 'MLB1 da pendência e das compras, MLB2 da pendência e do plano: uma linha cada')
  assert.deepEqual(est.fontes.sort(), ['compras', 'pendencia', 'plano'])
  const m1 = est.produtos.find(p => p.id === 'MLB1'); assert.equal(m1.preco, 50); assert.deepEqual(m1.perda, { c: 300, b: 600, dias: 28 }, 'o número do micro de compras')
  assert.deepEqual(est.total_em_jogo, { c: 400, b: 800, dias: [28] })
  assert.deepEqual(est.acoes.map(a => a.id).sort(), ['PS-Acme-pendencia_cliente-estoque_curva_a|ml|resumo', 'PS-x'].sort(), 'a cobrança da pendência cai no mesmo cartão (idAcao)')
  const cus = r.itens.find(i => i.chave === 'custos|ml'); assert.deepEqual(cus.acoes.map(a => a.id), ['PS-custos']); assert.equal(cus.acoes[0].caminho, 'cliente', 'classificarCaminho do Chaveiro')
  const ret = r.itens.find(i => i.chave === 'retorno|ml')
  assert.deepEqual(ret.tarefas.map(t => [t.id, t.faixa]), [['t1', 'cobrar'], ['t2', 'revisar']], 'régua 14/30')
  assert.deepEqual(ret.acoes.map(a => a.id), ['PS-bloq'])
  assert.deepEqual([...r.acoes_cliente].sort(), ['PS-Acme-pendencia_cliente-estoque_curva_a|ml|resumo', 'PS-bloq', 'PS-custos', 'PS-x'].sort(), 'frete (automático) e descartada ficam fora')
  assert.equal(r.resumo.total, 4); assert.equal(r.resumo.criticas, 1)
  assert.equal(r.resumo.em_jogo_brl, 800, 'estoque conta pelo total do micro de compras (não soma o mesmo risco duas vezes)')
})

await ok('gravidade e ordem: crítico primeiro; depois atenção pela nota do plano; registro manual informativo por último', () => {
  const r = mundo().aba.ler('Acme')
  assert.deepEqual(r.itens.map(i => i.gravidade), ['critico', 'atencao', 'atencao', 'info'])
  assert.equal(r.itens[0].chave, 'estoque|ml'); assert.equal(r.itens.at(-1).chave, 'documentos_conta|amazon')
  assert.equal(r.itens[0].prioridade.p, 'P0', 'a mesma prioridade do plano (maior nota das ações ligadas)')
  const [a, b] = r.itens.slice(1, 3); assert.ok((a.prioridade?.nota ?? -1) >= (b.prioridade?.nota ?? -1))
})

await ok('comunicação: último aviso por produto com recibo, resposta depois do aviso (descartada não conta), «sem resposta há N dias» quando não há', () => {
  const r = mundo().aba.ler('Acme')
  const est = r.itens.find(i => i.chave === 'estoque|ml').comunicacao
  assert.equal(est.ultimo.tipo, 'compras'); assert.equal(est.ultimo.recibos[0].estado, 'entregue'); assert.equal(est.resposta.texto, 'O pedido sai sexta'); assert.equal(est.sem_resposta_dias, null)
  const cus = r.itens.find(i => i.chave === 'custos|ml').comunicacao
  assert.equal(cus.ultimo.tipo, 'semanal'); assert.equal(cus.resposta.texto, 'O pedido sai sexta', 'resposta posterior ao aviso conta')
  const ret = r.itens.find(i => i.chave === 'retorno|ml').comunicacao
  assert.equal(ret.ultimo, null); assert.equal(ret.sem_resposta_dias, null)
  const m = mundo(); m.comunicacao.Acme.respostas = []
  assert.equal(m.aba.ler('Acme').itens.find(i => i.chave === 'custos|ml').comunicacao.sem_resposta_dias, 9, 'aviso de 06/10 sem resposta = 9 dias em 15/10')
  assert.equal(r.resumo.ultimo_aviso.id, 'L1'); assert.equal(r.resumo.ultima_resposta.texto, 'O pedido sai sexta')
})

await ok('isolamento: cada cliente só vê o que é dele; marca de outro cliente com a mesma chave não esconde nada', () => {
  const { aba, h } = mundo()
  const b = aba.ler('Beta')
  assert.deepEqual(b.itens.map(i => i.chave), ['estoque|ml']); assert.deepEqual(b.itens[0].produtos.map(p => p.id), ['MLB9'], 'só o produto da Beta')
  assert.deepEqual(b.acoes_cliente, ['PS-beta'])
  aba.marcar({ cliente: 'Beta', chave: 'estoque|ml', acao: 'movido', por: 'Ana Líder', confirmar: true })
  assert.ok(aba.ler('Acme').itens.some(i => i.chave === 'estoque|ml'), 'o movido da Beta não mexe na Acme')
  assert.equal(h.prepare("SELECT COUNT(*) n FROM aba_cliente_marca WHERE cliente = 'Acme'").get().n, 0)
  assert.throws(() => aba.ler('[Comercial] Prospect'), /prospect/)
  assert.throws(() => aba.marcar({ cliente: 'Cora', chave: 'estoque|ml', acao: 'movido', por: 'Cora CS', confirmar: true }), e => e.status === 404 || /não encontrado/.test(e.message))
})

await ok('mover para o consultor: prévia não grava; quem não é da equipe = 403; CS do cliente pode; sai da aba, vai para movidos, as ações deixam o filtro do cliente e nada é apagado', () => {
  const { aba, h, acoes } = mundo()
  const p = aba.marcar({ cliente: 'Acme', chave: 'custos|ml', acao: 'movido', por: 'Ana Líder', confirmar: 'true' })
  assert.equal(p.previa, true); assert.match(p.efeito, /Nada é apagado/); assert.equal(h.prepare('SELECT COUNT(*) n FROM aba_cliente_marca').get().n, 0, 'confirmar "true" (string) = prévia')
  assert.throws(() => aba.marcar({ cliente: 'Acme', chave: 'custos|ml', acao: 'movido', por: 'Zé de Fora', confirmar: true }), e => e.status === 403 && !/Zé/.test(e.message))
  const r0 = aba.marcar({ cliente: 'Acme', chave: 'custos|ml', acao: 'movido', texto: 'consultor monta a planilha', por: 'Cora CS', confirmar: true }); assert.ok(r0.id)
  const r = aba.ler('Acme')
  assert.ok(!r.itens.some(i => i.chave === 'custos|ml'), 'saiu da aba'); assert.equal(r.resumo.total, 3, 'contador acompanha')
  assert.deepEqual(r.movidos.map(m => [m.chave, m.por, m.acoes]), [['custos|ml', 'Cora CS', ['PS-custos']]])
  assert.ok(!r.acoes_cliente.includes('PS-custos'), 'vira da equipe no filtro do Plano')
  assert.ok(acoes.Acme.some(a => a.id === 'PS-custos' && a.status === 'proposta'), 'a ação do plano continua intacta')
  assert.throws(() => aba.marcar({ cliente: 'Acme', chave: 'nao|existe', acao: 'movido', por: 'Ana Líder', confirmar: true }), e => e.status === 404 && !/nao\|existe/.test(e.message))
})

await ok('resolvido some: medido some pela janela e volta depois se a medição continuar; registro manual resolve pelo avaliador; resposta fica no cartão sem esconder', () => {
  const { aba, relogio, resolvidos } = mundo()
  aba.marcar({ cliente: 'Acme', chave: 'estoque|ml', acao: 'resolvido', por: 'Caio Consultor', confirmar: true })
  assert.ok(!aba.ler('Acme').itens.some(i => i.chave === 'estoque|ml'), 'resolvido some')
  relogio.dia = '2026-10-' + String(15 + DIAS_RESOLVIDO + 1).padStart(2, '0')
  assert.ok(aba.ler('Acme').itens.some(i => i.chave === 'estoque|ml'), `depois de ${DIAS_RESOLVIDO} dias, a medição que continua volta`)
  aba.marcar({ cliente: 'Acme', chave: 'documentos_conta|amazon', acao: 'resolvido', por: 'Ana Líder', confirmar: true })
  assert.deepEqual(resolvidos, [7], 'registro manual resolvido no avaliador (pendencia_cliente)')
  assert.ok(!aba.ler('Acme').itens.some(i => i.chave === 'documentos_conta|amazon'))
  assert.throws(() => aba.marcar({ cliente: 'Acme', chave: 'retorno|ml', acao: 'resposta', texto: 'x', por: 'Ana Líder', confirmar: true }), /3 a 300/)
  aba.marcar({ cliente: 'Acme', chave: 'retorno|ml', acao: 'resposta', texto: 'Cliente manda as fotos na segunda', por: 'Ana Líder', confirmar: true })
  const ret = aba.ler('Acme').itens.find(i => i.chave === 'retorno|ml')
  assert.ok(ret, 'resposta não esconde'); assert.equal(ret.comunicacao.resposta.texto, 'Cliente manda as fotos na segunda'); assert.equal(ret.comunicacao.resposta.origem, 'registrada pela equipe')
})

await ok('lembrete só prepara: estoque = micro de compras dos produtos do cartão; demais = template do catálogo; nada gravado, nenhum lote; auditado', () => {
  const { aba, h } = mundo()
  const e = aba.lembrete({ cliente: 'Acme', chave: 'estoque|ml' })
  assert.equal(e.ok, true); assert.equal(e.previa, true); assert.match(e.texto, /MLB1 · /); assert.match(e.texto, /MLB3 · /); assert.match(e.como_enviar, /micro-compras\.mjs/)
  const c = aba.lembrete({ cliente: 'Acme', chave: 'custos|ml' })
  assert.equal(c.ok, true); assert.match(c.texto, /Precisamos do preço de custo\./); assert.match(c.texto, /Merovíngio/); assert.match(c.como_enviar, /não envia/)
  assert.equal(h.prepare('SELECT COUNT(*) n FROM gatilho_lote').get().n, 0, 'nenhum lote criado')
  assert.equal(h.prepare('SELECT COUNT(*) n FROM aba_cliente_marca').get().n, 0, 'nada gravado')
  assert.ok(!/Arquiteto|Chaveiro|Trinity|Oráculo/.test(e.texto + c.texto), 'ao cliente só o Merovíngio')
})

await ok('rotas: GET com cliente canônico, prospect 400, fora da central 404 sem eco, POST sem JSON 415, marcar e lembrete passam pelo núcleo; fiação no server.js e na tela', async () => {
  const { aba } = mundo()
  const app = express(); app.use(express.json())
  app.use(criarRotasAbaDoCliente({ aba, clienteCanonico: c => ['Acme', 'Beta'].find(x => x.toLowerCase() === String(c).toLowerCase()) || '' }))
  app.use((err, req, res, _n) => res.status(500).json({ erro: 'erro interno' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const get = async q => { const r = await fetch(base + '/api/cliente/do-cliente' + q); return { status: r.status, j: await r.json() } }
  const post = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); return { status: r.status, j: await r.json() } }
  try {
    const g = await get('?cliente=acme'); assert.equal(g.status, 200); assert.equal(g.j.cliente, 'Acme'); assert.ok(Array.isArray(g.j.acoes_cliente))
    assert.equal((await get('?cliente=' + encodeURIComponent('[Comercial] X'))).status, 400)
    const f = await get('?cliente=Segredo%20Ltda'); assert.equal(f.status, 404); assert.ok(!JSON.stringify(f.j).includes('Segredo'), 'sem eco')
    assert.equal((await get('')).status, 400)
    assert.equal((await post('/api/cliente/do-cliente/marcar', '{}', 'text/plain')).status, 415)
    const pv = await post('/api/cliente/do-cliente/marcar', { cliente: 'acme', chave: 'estoque|ml', acao: 'movido', por: 'Ana Líder' }); assert.equal(pv.status, 200); assert.equal(pv.j.previa, true)
    const bad = await post('/api/cliente/do-cliente/marcar', { cliente: 'acme', chave: 'estoque|ml', acao: '<script>', por: 'Ana Líder' }); assert.equal(bad.status, 400); assert.ok(!JSON.stringify(bad.j).includes('<script>'))
    const lb = await post('/api/cliente/do-cliente/lembrete', { cliente: 'acme', chave: 'estoque|ml', confirmar: true }); assert.equal(lb.status, 200); assert.equal(lb.j.previa, true, 'lembrete ignora confirmar: só prepara')
  } finally { srv.close() }
  const srvJs = readFileSync(new URL('../src/server.js', import.meta.url), 'utf-8'), cli = readFileSync(new URL('../src/web/cliente.js', import.meta.url), 'utf-8'), html = readFileSync(new URL('../src/web/cliente.html', import.meta.url), 'utf-8')
  assert.match(srvJs, /app\.use\(criarRotasAbaDoCliente\(\{ aba: criarAbaDoClienteReal\(/)
  assert.match(cli, /\['resumo', 'Resumo'\], \['do-cliente', 'Do cliente'\], \['plano', 'Plano'\]/, 'aba entre Resumo e Plano')
  assert.match(cli, /id="nDoCliente"/); assert.match(cli, /data-painel="do-cliente"/); assert.match(cli, /VIVOS = \[[^\]]*'doCliente'/)
  assert.match(cli, /\['equipe', 'Equipe'\], \['cliente', 'Cliente'\], \['tudo', 'Tudo'\]/); assert.match(cli, /planoQuem = 'equipe'/, 'padrão Equipe')
  assert.match(html, /<script src="do-cliente\.js"><\/script>[\s\S]*<script src="cliente\.js"><\/script>/)
  const dc = readFileSync(new URL('../src/web/do-cliente.js', import.meta.url), 'utf-8')
  assert.ok(!dc.includes('btn-primario'), 'nenhum primário fixo (só o do diálogo)'); assert.doesNotMatch(dc, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'sem hex'); assert.ok(!/style=/.test(dc), 'sem style inline')
  assert.ok((dc.match(/<th scope="col"/g) || []).length <= 6, 'tabela ≤ 6 colunas')
})

console.log(`\n✔ teste-aba-do-cliente: ${n} verificações passaram`)
