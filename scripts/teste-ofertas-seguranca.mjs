// Segurança/honestidade da ligação Ofertas ⇄ Algoritmo (ofertas.js, ofertas-algoritmo.js, plano-anuncios.salvarAcaoOferta, impacto-tarefas.execucoesOfertas).
// Banco EM MEMÓRIA com o schema inteiro (PS_DB_MEMORIA=1 antes dos imports: data/db.sqlite nem é aberto); sem rede.
// Cobre: acao_id de outro cliente recusado (abrir/atualizarJob); motor não liga/aprova ação de outro cliente nem a do mesmo item em outro cliente;
// "atualizada" só quando gravou; execução só vira medida com publicação VERIFICADA, estado confirmado e ação do mesmo cliente; card do Notion de outro
// cliente com o mesmo sufixo "· PS-…" não é descontado; método IMA (título só depois da galeria ou da dispensa com motivo).
// Rodar: node scripts/teste-ofertas-seguranca.mjs
process.env.PS_DB_MEMORIA = '1'
process.env.PS_OFERTAS_MEMORIA = '1'
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
const O = await import('../src/lib/ofertas.js')
const { criarMotorOfertas } = await import('../src/lib/ofertas-algoritmo.js')
const { execucoesOfertas, analisarCliente } = await import('../src/lib/impacto-tarefas.js')

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = (fn, rx, status) => { let e; try { fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); if (rx) assert.match(e.message, rx); if (status) assert.equal(e.status, status); return e }
const A = 'Cliente A', B = 'Cliente B', POR = 'Tester', T = '2026-10-01T15:00:00.000Z'
const of = O.criarOfertas(db)
const acao = (id, cliente, regra = 'anuncio_ima_conversao', item = 'MLB1', status = 'proposta') => db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em)
  VALUES (?,?,'Mercado Livre',?,'2026-10','t','7d','2026-10-14',50,'{"demanda_notion":"Otimizar Anúncios"}',?,?,?,?)`).run(id, cliente, regra, status, item, T, T)
const variante = (cliente, sku) => { const p = of.criarProduto(cliente, { nome: 'Produto ' + sku }, { por: POR }); return of.criarVariante(cliente, { produto_id: p.id, sku }, { por: POR }) }

acao('PS-a000000001', A)
const vA = variante(A, 'SKU-1'), vB = variante(B, 'SKU-1')

await caso('acao_id de OUTRO cliente: abrir e atualizarJob recusam (404, sem ecoar o id); o do próprio cliente passa', () => {
  const e = falha(() => of.abrir({ cliente: B, variante_id: vB.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: POR, acao_id: 'PS-a000000001' }), /não encontrada neste cliente/, 404)
  assert.ok(!e.message.includes('PS-a000000001'))
  falha(() => of.abrir({ cliente: A, variante_id: vA.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: POR, acao_id: 'PS-inexistente' }), /não encontrada/, 404)
  const jB = of.abrir({ cliente: B, variante_id: vB.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: POR })
  falha(() => of.atualizarJob(B, jB.id, { acao_id: 'PS-a000000001' }), /não encontrada neste cliente/, 404)
  assert.equal(of.obterJob(B, jB.id).acao_id, '')
  assert.equal(of.abrir({ cliente: A, variante_id: vA.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: POR, acao_id: 'PS-a000000001' }).acao_id, 'PS-a000000001')
})

await caso('método IMA: na oferta completa o título só é aprovável depois da galeria (ou da dispensa com motivo)', () => {
  of.vincularAnuncio(A, { variante_id: vA.id, canal: 'ML', conta_id: '1', anuncio_id: 'MLB1' }, { por: POR })
  const anA = of.listarAnuncios(A).find(a => a.anuncio_id === 'MLB1')
  const j = of.abrir({ cliente: A, anuncio_id: anA.id, escopo: 'oferta_completa', objetivo: 'melhorar_conversao', solicitante: POR })
  of.novaVersao(A, j.id, { conteudo: { titulo: 'Produto X Preto', descricao: 'Fatos.' }, por: POR })
  falha(() => of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['titulo'], autor: 'Consultor' }), /DEPOIS da galeria/, 409)
  falha(() => of.dispensarEtapa(A, j.id, { etapa: 'galeria', motivo: 'curto', por: POR }), /motivo/)
  of.dispensarEtapa(A, j.id, { etapa: 'galeria', motivo: 'galeria atual fica: fotos novas', por: POR })
  assert.deepEqual(of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['titulo'], autor: 'Consultor' }).campos_pendentes, ['descricao'])
})

await caso('motor: job de B não liga nem aprova ação de A (por acao_id gravado nem por item igual); A liga a própria equivalente; "atualizada" só quando gravou', () => {
  const motor = criarMotorOfertas({ hoje: () => '2026-10-07', retro: () => null })
  const job = (cliente, variante_id, o = {}) => ({ id: `job-${cliente}-${Math.random().toString(36).slice(2, 8)}`, cliente, variante_id, anuncio_id: 'x', escopo: 'oferta_completa', objetivo: 'melhorar_conversao', criado_em: T, proposta_versao: 1, acao_id: '', dados: {}, responsavel: '', ...o })
  // B com acao_id de A forçado (dado legado/corrompido) e o MESMO item MLB1: nada de A muda
  const sB = motor.sincronizar({ cliente: B, job: job(B, vB.id, { acao_id: 'PS-a000000001' }), item: { id: 'MLB1', titulo: 'Produto B' } })
  assert.equal(sB.ligacao, 'criada'); assert.equal(sB.acao.cliente, B); assert.notEqual(sB.acao.id, 'PS-a000000001'); assert.equal(sB.regra, 'oferta_completa')
  assert.equal(db.prepare('SELECT status FROM acoes_plano WHERE id = ?').get('PS-a000000001').status, 'proposta', 'ação de A intocada')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE cliente = ? AND regra LIKE 'anuncio_oferta_%'").get(A).n, 0)
  // A: a ação equivalente (ímã no mesmo anúncio) recebe o job, vira aprovada
  const sA = motor.sincronizar({ cliente: A, job: job(A, vA.id), item: { id: 'MLB1', titulo: 'Produto A' } })
  assert.equal(sA.ligacao, 'existente'); assert.equal(sA.acao.id, 'PS-a000000001'); assert.equal(sA.acao.status, 'aprovada')
  // ação já distribuída não é reescrita — e o retorno não diz "atualizada"
  db.prepare("UPDATE acoes_plano SET status = 'distribuida' WHERE id = ?").run(sB.acao.id)
  const antes = db.prepare('SELECT atualizado_em, dados_json FROM acoes_plano WHERE id = ?').get(sB.acao.id)
  const sB2 = motor.sincronizar({ cliente: B, job: job(B, vB.id, { acao_id: sB.acao.id }), item: { id: 'MLB1', titulo: 'Produto B' } })
  assert.equal(sB2.ligacao, 'mantida (distribuida)'); assert.deepEqual(db.prepare('SELECT atualizado_em, dados_json FROM acoes_plano WHERE id = ?').get(sB.acao.id), antes)
})

await caso('execuções do Ofertas viram medida só com publicação VERIFICADA, estado confirmado e ação do MESMO cliente; nada vaza entre clientes', () => {
  acao('PS-b000000001', B, 'anuncio_oferta_ficha', 'MLB9')
  const anuncio = (cliente, id, mlb) => db.prepare("INSERT INTO of_anuncio (id, cliente, variante_id, canal, conta_id, anuncio_id) VALUES (?,?,'v','ML','2',?)").run(id, cliente, mlb)
  anuncio(A, 'anA', 'MLB1'); anuncio(B, 'anB', 'MLB9')
  const jobPub = (id, cliente, an, acao_id, estado, pubEstado) => {
    db.prepare("INSERT INTO of_job (id, cliente, variante_id, anuncio_id, escopo, objetivo, estado, publicado_em, criado_em, atualizado_em, acao_id, responsavel) VALUES (?,?,'v',?,'ficha','corrigir_ficha',?,?,?,?,?,'Ana')")
      .run(id, cliente, an, estado, estado.startsWith('publicado') || estado === 'monitorando' ? T : '', T, T, acao_id)
    db.prepare("INSERT INTO of_publicacao (id, job_id, cliente, canal, versao, chave_idem, operacao, estado, criado_em, atualizado_em) VALUES (?,?,?,'ML',1,?,'atualizar',?,?,?)").run('p-' + id, id, cliente, `${cliente}|${id}`, pubEstado, T, T)
  }
  jobPub('jA', A, 'anA', 'PS-a000000001', 'publicado_confirmado', 'verificada')
  jobPub('jB-estrangeira', B, 'anB', 'PS-a000000001', 'publicado_confirmado', 'verificada')   // ação de A num job de B
  jobPub('jB-conferindo', B, 'anB', 'PS-b000000001', 'em_conferencia', 'aceita')              // API aceitou ≠ publicado
  jobPub('jB-nao-verificada', B, 'anB', 'PS-b000000001', 'publicado_confirmado', 'aceita')    // estado sem leitura conclusiva não conta
  jobPub('jB-ok', B, 'anB', 'PS-b000000001', 'monitorando', 'verificada')
  jobPub('jB-anuncio-de-A', B, 'anA', 'PS-b000000001', 'monitorando', 'verificada')          // anúncio de A num job de B
  assert.deepEqual(execucoesOfertas(A).map(x => x.id), ['OF-jA'])
  const eb = execucoesOfertas(B)
  assert.deepEqual(eb.map(x => x.id), ['OF-jB-ok']); assert.deepEqual(eb[0].itens, ['MLB9']); assert.equal(eb[0].cliente, B); assert.equal(eb[0].tipo, 'Otimizar Anúncios'); assert.match(eb[0].titulo, /· PS-b000000001$/)
  // job que publicou PREÇO (escopo 'preco' ou diff verificado com o campo preço) é a própria intervenção de preço: a mudança não o confunde
  assert.equal(eb[0].intervencao_preco, false, 'escopo ficha sem preço no diff')
  db.prepare("UPDATE of_publicacao SET diff_json = ? WHERE id = 'p-jB-ok'").run(JSON.stringify([{ campo: 'preco', de: 50, para: 54 }]))
  assert.equal(execucoesOfertas(B)[0].intervencao_preco, true, 'publicação verificada com o campo preço no diff')
  db.prepare("UPDATE of_publicacao SET diff_json = '{}' WHERE id = 'p-jB-ok'").run(); db.prepare("UPDATE of_job SET escopo = 'preco' WHERE id = 'jB-ok'").run()
  assert.equal(execucoesOfertas(B)[0].intervencao_preco, true, 'escopo preço')
  db.prepare("UPDATE of_job SET escopo = 'ficha' WHERE id = 'jB-ok'").run()
})

await caso('impacto: card do Notion só é descontado pela execução do PRÓPRIO cliente (sufixo "· PS-…" de outro cliente não apaga tarefa)', () => {
  const tarefa = (id, cliente, titulo) => db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, responsavel, status, data_conclusao, last_edited, url) VALUES (?, 'teste', ?, ?, 'Mercado Livre', 'Ana', 'concluida', '2026-09-20', ?, '')").run(id, cliente, titulo, T)
  tarefa('nA', A, 'Oferta ficha · PS-a000000001'); tarefa('nB', B, 'Card de B que cita · PS-a000000001'); tarefa('nB2', B, 'Card de B da própria ação · PS-b000000001')
  const ra = analisarCliente(A, { hoje: '2026-10-07' }), rb = analisarCliente(B, { hoje: '2026-10-07' })
  assert.deepEqual(ra.medidas.map(m => m.id).sort(), ['OF-jA']); assert.equal(ra.nao_mensuraveis.cards_contados_pela_oferta, 1)
  assert.deepEqual(rb.medidas.map(m => m.id).sort(), ['OF-jB-ok', 'nB']); assert.equal(rb.nao_mensuraveis.cards_contados_pela_oferta, 1)
})

// ── motor-res A1 (08/10/2026): validarFatual usa a MESMA fonte de termo promocional de ofertas-diagnostico (nem "top" nem "premium" soltos em RX_PROMOCIONAL) ──
const { ehPromocional } = await import('../src/lib/ofertas-diagnostico.js')
await caso('motor-res A1: validarFatual e ehPromocional concordam — peça de roupa passa (BRAND "Top Fitness", MODEL "Top Nadador TF1"), elogio/promessa reprova, "premium" só como elogio do top; contexto de vestuário aceito', () => {
  for (const [id, v] of [['BRAND', 'Top Fitness'], ['MODEL', 'Top Nadador TF1'], ['MPN', 'Premium X'], ['MODEL', 'Top Cropped'], ['MANUFACTURER', 'Top Fitness Ltda']]) {
    assert.deepEqual(O.validarFatual({ atributo_id: id, valor: v }), { ok: true }, v); assert.equal(ehPromocional(v), false, v)
  }
  for (const [id, v] of [['BRAND', 'Top 1 Fitness'], ['MODEL', 'Top de Linha'], ['MPN', 'Top Premium'], ['BRAND', 'Qualidade Top'], ['MODEL', 'Top Laranja'], ['MODEL', 'Top Best Seller']]) {
    assert.match(O.validarFatual({ atributo_id: id, valor: v }).motivo, /termo promocional \("top"\)/, v); assert.equal(ehPromocional(v), true, v)
  }
  assert.deepEqual(O.validarFatual({ atributo_id: 'MODEL', valor: 'Top Laranja', vestuario: true }), { ok: true }, 'mesmo contexto de vestuário do título')
  assert.match(O.validarFatual({ atributo_id: 'MPN', valor: 'ZW OFERTA' }).motivo, /\("oferta"\)/); assert.match(O.validarFatual({ atributo_id: 'MPN', valor: 'KIT PRESENTE DIA DOS PAIS' }).motivo, /termo promocional/)
  assert.match(O.validarFatual({ atributo_id: 'MPN', valor: '12x sem juros' }).motivo, /sem juros/, 'apelo de pagamento segue vetado (resto de RX_PROMOCIONAL)')
  assert.ok(!/\btop\b|premium|oferta/.test(O.RX_PROMOCIONAL.source), 'RX_PROMOCIONAL não decide mais termo promocional do config')
})

console.log(`\nteste-ofertas-seguranca: ${n} casos OK`)
