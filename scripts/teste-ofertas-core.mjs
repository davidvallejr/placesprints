// Autoteste do NÚCLEO de dados das Ofertas Estratégicas (src/lib/ofertas.js + ofertas-schema.js). Spec: Desktop/Especificacao-Ofertas-Estrategicas.md §13.
// Critérios cobertos: 1, 2, 3, 4 (bloqueio de preço só sinaliza), 5, 8, 9, 12 (nível de dados), 17 + máquina de estados.
// Banco EM MEMÓRIA, sem rede, sem porta. Rodar: PS_OFERTAS_MEMORIA=1 node scripts/teste-ofertas-core.mjs
process.env.PS_OFERTAS_MEMORIA = '1'                       // tem de vir ANTES do import (o módulo lê isto no carregamento)
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
const { SCHEMA_OFERTAS } = await import('../src/lib/ofertas-schema.js')
const O = await import('../src/lib/ofertas.js')
assert.equal(O.ofertas, null, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = (fn, rx, status) => { let e; try { fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); if (rx) assert.match(e.message, rx); if (status) assert.equal(e.status, status) }
const novoBanco = (custos = new Map()) => { const h = new Database(':memory:'); h.exec(SCHEMA_OFERTAS); return { h, of: O.criarOfertas(h, { custosSku: () => custos }) } }
const POR = { por: 'Tester' }
const A = 'Cliente A', B = 'Cliente B'
const REF = [{ origem: 'foto_dono', ref: 'drive:1abc' }]
// atalho: variante confirmada + job levado até um estado
const prepara = (of, cliente, { sku = 'SKU-1', escopo = 'ficha', objetivo = 'corrigir_ficha', ate = 'em_revisao' } = {}) => {
  const p = of.criarProduto(cliente, { nome: 'Smartwatch ZW', marca: '01Smart' }, POR)
  const v = of.criarVariante(cliente, { produto_id: p.id, sku, cor: 'Preto' }, POR)
  of.confirmarReferencia({ cliente, variante_id: v.id, por: 'Dono', origem_fotos: REF })
  let j = of.abrir({ cliente, variante_id: v.id, escopo, objetivo, solicitante: 'Tester' })
  const caminho = ['validando_entrada', 'referencia_confirmada', 'estrategia_preparada', 'estrategia_aprovada', 'em_producao', 'em_revisao']
  for (const e of caminho) { if (j.estado === ate) break; j = of.transicionar(cliente, j.id, e, POR) }
  return { p, v, j }
}

// ── schema e exports ─────────────────────────────────────────────────────────
ok('schema cria as 12 tabelas of_* e os estados/transições são consistentes', () => {
  const { h } = novoBanco()
  const tabelas = h.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'of\\_%' ESCAPE '\\'").all().map(r => r.name).sort()
  assert.deepEqual(tabelas, ['of_anuncio', 'of_aprovacao', 'of_atributo', 'of_custo', 'of_evento', 'of_imagem', 'of_job', 'of_produto', 'of_proposta', 'of_publicacao', 'of_regra_canal', 'of_variante'])
  for (const [de, paras] of Object.entries(O.TRANSICOES)) { assert.ok(O.ESTADOS[de], de); for (const p of paras) assert.ok(O.ESTADOS[p], `${de} → ${p}`) }
  for (const [id, e] of Object.entries(O.ESTADOS)) { assert.ok(e.rotulo && e.acao && e.responsavel, id); assert.ok(O.TRANSICOES[id], `sem transições para ${id}`) }
  assert.equal(Object.keys(O.ESTADOS).length, 20)
})

// ── critério 1: SKUs iguais em clientes diferentes não se cruzam ──────────────
ok('1. mesmo SKU em dois clientes: duas variantes independentes; SKU repetido NO MESMO cliente é recusado', () => {
  const { of } = novoBanco()
  const pa = of.criarProduto(A, { nome: 'Fone X' }, POR), pb = of.criarProduto(B, { nome: 'Fone X' }, POR)
  const va = of.criarVariante(A, { produto_id: pa.id, sku: 'FX-01', estoque: 5 }, POR), vb = of.criarVariante(B, { produto_id: pb.id, sku: 'FX-01', estoque: 9 }, POR)
  assert.notEqual(va.id, vb.id)
  assert.equal(of.listarVariantes(A).length, 1); assert.equal(of.listarVariantes(A)[0].estoque, 5)
  assert.equal(of.listarVariantes(B)[0].estoque, 9)
  falha(() => of.criarVariante(A, { produto_id: pa.id, sku: ' FX-01 ' }, POR), /já existe/, 409)   // espaços/NBSP nas pontas não fazem outro SKU
  falha(() => of.criarVariante(A, { produto_id: pb.id, sku: 'FX-02' }, POR), /produto não encontrado/, 404)   // produto de B não serve para A
  const r = of.importarPlanilha(A, [{ sku: 'FX-01', nome_produto: 'Fone X', estoque_disponivel: 7 }, { sku: 'FX-01', cliente_id: B, nome_produto: 'Fone X' }], POR)
  assert.equal(r.erros.length, 2, 'SKU repetido no lote: nenhuma linha entra (as duas são apontadas)')
  assert.ok(r.erros.every(e => /repetido|outro cliente/.test(e.motivo)))
  assert.equal(of.listarVariantes(A)[0].estoque, 5); assert.equal(of.listarVariantes(B)[0].estoque, 9)
})

// ── critério 2: três cores = três variantes, uma foto por variante ──────────
ok('2. três cores do mesmo produto_id viram 3 variantes de UM produto; cada original fica na variante certa', () => {
  const { of } = novoBanco()
  const r = of.importarPlanilha(A, [
    { produto_id: 'P1', sku: 'ZW-PRETO', nome_produto: 'Smartwatch ZW', marca: '01Smart', cor: 'Preto', gtin: '07891234567890', peso_produto_kg: '0,045', estoque_disponivel: '' },
    { produto_id: 'P1', sku: 'ZW-ROSA', nome_produto: 'Smartwatch ZW', cor: 'Rosa' },
    { produto_id: 'P1', sku: 'ZW-AZUL', nome_produto: 'Smartwatch ZW', cor: 'Azul', estoque_disponivel: 'muitos' },
  ], POR)
  assert.equal(r.produtos_criados, 1); assert.equal(r.criadas, 2)
  assert.deepEqual(r.erros, [{ linha: 3, campo: 'estoque_disponivel', motivo: 'inteiro ≥ 0 ou vazio' }], 'texto em número = erro por linha, as válidas entram')
  const prods = of.listarProdutos(A)
  assert.equal(prods.length, 1); assert.equal(prods[0].variantes, 2); assert.equal(prods[0].gtin, '07891234567890', 'GTIN como texto, zero preservado')
  const vs = of.listarVariantes(A)
  assert.equal(vs.find(v => v.sku === 'ZW-PRETO').peso_kg, 0.045, 'vírgula decimal aceita')
  assert.equal(vs.find(v => v.sku === 'ZW-PRETO').estoque, null, 'vazio = desconhecido, nunca 0')
  const preto = vs.find(v => v.sku === 'ZW-PRETO'), rosa = vs.find(v => v.sku === 'ZW-ROSA')
  of.confirmarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', origem_fotos: [{ origem: 'drive', ref: 'file-preto' }] })
  of.confirmarReferencia({ cliente: A, variante_id: rosa.id, por: 'Dono', origem_fotos: [{ origem: 'drive', ref: 'file-rosa' }] })
  assert.deepEqual(of.listarImagens(A, { variante_id: preto.id }).map(i => [i.papel, i.drive_file_id, i.status]), [['original', 'file-preto', 'confirmada']])
  assert.deepEqual(of.listarImagens(A, { variante_id: rosa.id }).map(i => i.drive_file_id), ['file-rosa'])
  falha(() => of.confirmarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', origem_fotos: [{ origem: 'outro_produto', ref: 'x' }] }), /origem de foto inválida/)
  falha(() => of.confirmarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB1:foto-1' }] }), /VINCULADO/)
})

// ── critério 3: reimportar não duplica; aponta alteração por campo ────────────
ok('3. reimportar a mesma planilha: nada duplica; mudança vem por campo (de → para); prévia não grava; célula com fórmula vira texto', () => {
  const { of } = novoBanco()
  const planilha = [{ produto_id: 'P1', sku: 'ZW-PRETO', nome_produto: 'Smartwatch ZW', cor: 'Preto', estoque_disponivel: 10 }, { produto_id: 'P1', sku: 'ZW-ROSA', nome_produto: 'Smartwatch ZW', cor: 'Rosa' }]
  of.importarPlanilha(A, planilha, POR)
  const r2 = of.importarPlanilha(A, planilha, POR)
  assert.equal(r2.criadas, 0); assert.equal(r2.produtos_criados, 0); assert.equal(r2.inalteradas, 2); assert.deepEqual(r2.alteracoes, [])
  assert.equal(of.listarProdutos(A).length, 1); assert.equal(of.listarVariantes(A).length, 2)
  const r3 = of.importarPlanilha(A, [{ ...planilha[0], estoque_disponivel: 3, cor: 'Preto fosco' }, { ...planilha[1], nome_produto: '=HYPERLINK("http://x")' }], { ...POR, aplicar: false })
  assert.equal(r3.aplicado, false); assert.equal(of.listarVariantes(A).find(v => v.sku === 'ZW-PRETO').estoque, 10, 'prévia não grava')
  assert.deepEqual(r3.alteracoes.filter(a => a.sku === 'ZW-PRETO').map(a => [a.campo, a.de, a.para]), [['cor', 'Preto', 'Preto fosco'], ['estoque', 10, 3]])
  const r4 = of.importarPlanilha(A, [{ ...planilha[0], estoque_disponivel: 3 }, { ...planilha[1], nome_produto: '=HYPERLINK("http://x")' }], POR)
  assert.equal(r4.atualizadas, 2); assert.equal(of.listarProdutos(A)[0].nome, '=HYPERLINK("http://x")', 'fórmula é só texto, nunca executada')
  assert.ok(r4.alteracoes.some(a => a.campo === 'produto.nome'))
  // irmã nova de um produto já existente entra no MESMO produto (pelo produto_id da planilha casado com a irmã cadastrada)
  const r5 = of.importarPlanilha(A, [{ produto_id: 'P1', sku: 'ZW-PRETO', nome_produto: 'Smartwatch ZW' }, { produto_id: 'P1', sku: 'ZW-AZUL', nome_produto: 'Smartwatch ZW', cor: 'Azul' }], POR)
  assert.equal(r5.criadas, 1); assert.equal(r5.produtos_criados, 0); assert.equal(of.listarProdutos(A)[0].variantes, 3)
  assert.ok(r2.ignorados.includes('referencia_confirmada'), 'planilha não confirma referência')
})

// ── critério 4: sem custo bloqueia preço (sinaliza), não bloqueia imagem ─────
ok('4. sem custo: preço vira simulação com bloqueio custo_ausente (não derruba); imagem segue; custo do módulo de custos por SKU é lido', () => {
  const custos = new Map([['zw-rosa', 42.5]])
  const { of } = novoBanco(custos)
  const { v, j } = prepara(of, A, { sku: 'ZW-PRETO', escopo: 'oferta_completa', objetivo: 'lancar' })
  assert.deepEqual(of.custoVigente(A, v.id).bloqueios, ['custo_ausente'])
  const prop = of.novaVersao(A, j.id, { conteudo: { titulo: 'Smartwatch ZW Preto', preco: { preco_proposto: 199.9 }, galeria: [{ imagem_id: 'x', papel: 'capa', ordem: 1 }], mudancas: [] }, por: 'Tester' })
  assert.deepEqual(prop.conteudo.preco.bloqueios, ['custo_ausente']); assert.equal(prop.conteudo.preco.simulacao, true)
  const ap = of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['titulo', 'galeria'], autor: 'Consultor' })
  assert.deepEqual(ap.campos_pendentes, ['preco'])
  falha(() => of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['preco'], autor: 'Consultor' }), /custo_ausente/, 409)
  falha(() => of.transicionar(A, j.id, 'aprovado_publicar', POR), /faltam preco/, 409)
  const img = of.registrarImagem(A, { variante_id: v.id, job_id: j.id, papel: 'capa', ordem: 1, fonte: 'provedor-x' }, POR)
  assert.equal(img.status, 'candidata', 'imagem não depende de custo')
  // custo registrado: vigência + total em centavos; versão nova sem bloqueio
  const c = of.registrarCusto(A, { variante_id: v.id, custo_compra: '50,10', frete_entrada: 0.1, embalagem: 0.2, fonte: 'planilha do cliente' }, POR)
  assert.equal(c.total, 50.4); assert.equal(c.origem, 'of_custo')
  const c2 = of.registrarCusto(A, { variante_id: v.id, custo_compra: 55, fonte: 'Bling' }, POR)
  assert.equal(c2.custo_compra, 55); assert.equal(of.listarCustos(A, { variante_id: v.id }).filter(x => x.fim_vigencia === '').length, 1, 'uma vigência aberta')
  falha(() => of.registrarCusto(A, { variante_id: v.id, custo_compra: 0 }, POR), /> 0/)
  falha(() => of.registrarCusto(A, { variante_id: v.id, custo_compra: '' }, POR), /> 0/)
  const p2 = of.novaVersao(A, j.id, { conteudo: { preco: { preco_proposto: 199.9 }, mudancas: [] }, por: 'Tester' })
  assert.deepEqual(p2.conteudo.preco.bloqueios, []); assert.equal(p2.conteudo.preco.simulacao, false)
  // fallback: custo por SKU do módulo de custos (ERP/planilha)
  const p = of.listarProdutos(A)[0], rosa = of.criarVariante(A, { produto_id: p.id, sku: 'ZW-ROSA' }, POR)
  assert.equal(of.custoVigente(A, rosa.id).total, 42.5); assert.equal(of.custoVigente(A, rosa.id).origem, 'custos_sku')
  // regra de canal sem fonte/validade é recusada: nenhuma alíquota presumida
  falha(() => of.registrarRegraCanal(A, { canal: 'ML', comissao_pct: 16 }, POR), /fonte, consultado_em e validade/)
  const rg = of.registrarRegraCanal(A, { canal: 'ML', modalidade: 'classico', comissao_pct: 16, fonte: 'API listing_prices', consultado_em: '2026-10-07', validade: '2026-10-14' }, POR)
  assert.equal(rg.comissao_pct, 16); assert.equal(rg.tributos_pct, null, 'não informado = desconhecido')
})

// ── critério 5: foto errada bloqueia produção/publicação da variante ─────────
ok('5. GATE 0: sem referência confirmada o job não entra em produção; contestar referência derruba jobs ativos para pendente_dados; irmã não é afetada', () => {
  const { of } = novoBanco()
  const p = of.criarProduto(A, { nome: 'ZW' }, POR)
  const preto = of.criarVariante(A, { produto_id: p.id, sku: 'ZW-PRETO' }, POR), rosa = of.criarVariante(A, { produto_id: p.id, sku: 'ZW-ROSA' }, POR)
  let j = of.abrir({ cliente: A, variante_id: preto.id, escopo: 'galeria', objetivo: 'elevar_clique', solicitante: 'Tester' })
  j = of.transicionar(A, j.id, 'validando_entrada', POR)
  falha(() => of.transicionar(A, j.id, 'referencia_confirmada', POR), /GATE 0/, 409)
  j = of.transicionar(A, j.id, 'pendente_dados', { por: 'sistema', motivo: 'sem foto confirmada', pendencias: ['referencia_nao_confirmada'] })
  assert.deepEqual(j.pendencias, ['referencia_nao_confirmada']); assert.equal(j.estado_info.responsavel, 'consultor')
  of.confirmarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', origem_fotos: REF })
  of.confirmarReferencia({ cliente: A, variante_id: rosa.id, por: 'Dono', origem_fotos: REF })
  for (const e of ['validando_entrada', 'referencia_confirmada', 'estrategia_preparada', 'estrategia_aprovada', 'em_producao']) j = of.transicionar(A, j.id, e, POR)
  let jr = of.abrir({ cliente: A, variante_id: rosa.id, escopo: 'galeria', objetivo: 'elevar_clique', solicitante: 'Tester' })
  for (const e of ['validando_entrada', 'referencia_confirmada']) jr = of.transicionar(A, jr.id, e, POR)
  of.contestarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', motivo: 'a foto é do ZW01 AI, não do Prime' })
  assert.equal(of.obterJob(A, j.id).estado, 'pendente_dados'); assert.equal(of.obterVariante(A, preto.id).referencia_confirmada, false)
  assert.equal(of.obterJob(A, jr.id).estado, 'referencia_confirmada', 'irmã segue')
  // mudar a identidade física (cor) também revoga; mudar estoque não
  of.atualizarVariante(A, rosa.id, { estoque: 3 }, POR); assert.equal(of.obterVariante(A, rosa.id).referencia_confirmada, true)
  of.atualizarVariante(A, rosa.id, { cor: 'Rosa claro' }, POR); assert.equal(of.obterVariante(A, rosa.id).referencia_confirmada, false)
  assert.equal(of.obterJob(A, jr.id).estado, 'pendente_dados')
  assert.ok(of.eventos(A, { entidade: 'variante', entidade_id: preto.id }).some(e => e.acao === 'referencia_revogada' && /ZW01 AI/.test(e.detalhes.motivo)))
})

// ── critério 8: MPN/fabricante com termo promocional é reprovado ─────────────
ok('8. termo promocional ou palavra-chave fora do fato em MPN/fabricante/modelo → validacao reprovado com motivo; na proposta, ficha reprovada não é aprovável', () => {
  const { of } = novoBanco()
  const { v, j } = prepara(of, A)
  const a1 = of.upsertAtributo(A, { variante_id: v.id, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'MPN', nome: 'MPN', valor_proposto: 'ZW-PRIME OFERTA FRETE GRÁTIS', fonte: 'x' }, POR)
  assert.equal(a1.reprovado, true); assert.match(a1.validacao, /^reprovado: termo promocional/)
  const a2 = of.upsertAtributo(A, { variante_id: v.id, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'MANUFACTURER', nome: 'Fabricante', valor_proposto: '01Smart ideal para academia', fonte: 'x' }, POR)
  assert.match(a2.validacao, /fora do fato/)
  const a3 = of.upsertAtributo(A, { variante_id: v.id, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'ALPHANUMERIC_MODEL', nome: 'Modelo alfanumérico', valor_proposto: 'relogio smartwatch feminino masculino esportivo digital bluetooth', fonte: 'x' }, POR)
  assert.match(a3.validacao, /lista de palavras-chave/)
  const a4 = of.upsertAtributo(A, { variante_id: v.id, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'MPN', nome: 'MPN', valor_proposto: 'ZW01-PRIME', fonte: 'manual do fabricante', evidencia: 'pág. 2' }, POR)
  assert.equal(a4.validacao, 'ok'); assert.equal(a4.id, a1.id, 'upsert pela chave (variante, canal, categoria, atributo)')
  const a5 = of.upsertAtributo(A, { variante_id: v.id, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'COLOR', nome: 'Cor', valor_proposto: 'Preto' }, POR)
  assert.match(a5.validacao, /^sem_evidencia/)
  assert.equal(of.listarAtributos(A, { variante_id: v.id }).length, 4)
  assert.equal(O.validarFatual({ atributo_id: 'TITLE', valor: 'Smartwatch em oferta' }).ok, true, 'campo não factual não é julgado aqui')
  const prop = of.novaVersao(A, j.id, { conteudo: { atributos: [{ atributo_id: 'MPN', nome: 'MPN', valor_atual: '', valor_proposto: 'KIT PRESENTE DIA DOS PAIS', fonte: 'x' }], mudancas: [] }, por: 'Tester' })
  assert.equal(prop.atributos_reprovados, 1)
  falha(() => of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['atributos'], autor: 'Consultor' }), /atributo reprovado/, 409)
})

// ── critério 9: aprovação presa à versão ───────────────────────────────────
ok('9. aprovar v3, criar v4: a aprovação de v3 fica inválida com motivo; aprovar versão antiga é recusado; lote identifica cada item', () => {
  const { of } = novoBanco()
  const { j } = prepara(of, A, { escopo: 'titulo_descricao', objetivo: 'elevar_clique' })
  for (let i = 1; i <= 3; i++) of.novaVersao(A, j.id, { conteudo: { titulo: `Título v${i}`, mudancas: [{ campo: 'titulo', de: 'x', para: `v${i}`, problema: 'CTR baixo', evidencia: '1,2% em 28d', hipotese: 'capa', acao: 'trocar', metrica: 'ctr', janela_dias: 14, confusores: [] }] }, por: 'Tester' })
  const ap = of.aprovar({ cliente: A, job_id: j.id, versao: 3, campos: ['titulo'], autor: 'Consultor' })
  assert.equal(ap.valida, true); assert.deepEqual(ap.campos_pendentes, [])
  let job = of.transicionar(A, j.id, 'aprovado_publicar', POR)
  assert.equal(job.aprovacao_id, ap.id)
  const v4 = of.novaVersao(A, j.id, { conteudo: { titulo: 'Título v4', mudancas: [] }, por: 'Tester' })
  assert.equal(v4.versao, 4)
  job = of.obterJob(A, j.id)
  assert.equal(job.estado, 'em_revisao', 'nova versão tira o job de aprovado_publicar'); assert.equal(job.aprovacao_id, '')
  assert.deepEqual(job.aprovacoes.map(a => [a.proposta_versao, a.valida, a.invalidada_motivo]), [[3, false, 'substituída pela versão 4']])
  assert.deepEqual(job.campos_pendentes, ['titulo'])
  falha(() => of.transicionar(A, j.id, 'aprovado_publicar', POR), /faltam titulo/, 409)
  falha(() => of.aprovar({ cliente: A, job_id: j.id, versao: 3, campos: ['titulo'], autor: 'Consultor' }), /não é a atual/, 409)
  falha(() => of.aprovar({ cliente: A, job_id: j.id, versao: 4, campos: ['preco'], autor: 'Consultor' }), /fora da proposta/)
  const { j: j2 } = prepara(of, A, { sku: 'SKU-2', escopo: 'titulo_descricao', objetivo: 'elevar_clique' })
  const lote = of.aprovarLote({ cliente: A, itens: [{ job_id: j.id, versao: 4, campos: ['titulo'] }, { job_id: j2.id, versao: 1, campos: ['titulo'] }], autor: 'Gestor' })
  assert.deepEqual(lote.map(x => [x.job_id, x.ok]), [[j.id, true], [j2.id, false]]); assert.match(lote[1].erro, /não é a atual/)
  assert.equal(of.listarPropostas(A, j.id).length, 4); assert.equal(of.obterProposta(A, j.id).versao, 4); assert.equal(of.obterProposta(A, j.id, 2).conteudo.titulo, 'Título v2')
})

// ── critério 12 (dados): variação sem tocar irmãs; escopo não vaza ────────────
ok('12. anúncio com variações: atualizar uma variação externa não altera a irmã; escopo "ficha" recusa título/preço/galeria; publicação idempotente', () => {
  const { of } = novoBanco()
  const p = of.criarProduto(A, { nome: 'ZW' }, POR)
  const preto = of.criarVariante(A, { produto_id: p.id, sku: 'ZW-PRETO' }, POR), rosa = of.criarVariante(A, { produto_id: p.id, sku: 'ZW-ROSA' }, POR)
  const a1 = of.vincularAnuncio(A, { variante_id: preto.id, canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', variacao_externa_id: 'V1', preco_atual: 199.9, estoque_canal: 10, titulo_atual: 'ZW' }, POR)
  const a2 = of.vincularAnuncio(A, { variante_id: rosa.id, canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', variacao_externa_id: 'V2', preco_atual: 199.9, estoque_canal: 4, titulo_atual: 'ZW' }, POR)
  assert.notEqual(a1.id, a2.id)
  const up = of.vincularAnuncio(A, { canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', variacao_externa_id: 'V1', preco_atual: 179.9, estoque_canal: '', snapshot: { pictures: ['a'] } }, POR)
  assert.equal(up.novo, false); assert.equal(up.id, a1.id); assert.deepEqual(up.mudancas.map(m => m.campo), ['preco_atual'])
  assert.equal(up.estoque_canal, 10, 'vazio não zera'); assert.deepEqual(up.snapshot, { pictures: ['a'] })
  const irma = of.obterAnuncio(A, a2.id); assert.equal(irma.preco_atual, 199.9); assert.equal(irma.estoque_canal, 4); assert.deepEqual(irma.snapshot, {})
  // importar ANUNCIOS por SKU exato; SKU desconhecido = erro, nunca casamento por nome
  const imp = of.importarAnuncios(A, [{ sku: 'ZW-ROSA', canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', variacao_externa_id: 'V2', preco_atual: 189.9 }, { sku: 'ZW-ROSE', canal: 'ML', anuncio_id: 'MLB9' }, { canal: 'XX', anuncio_id: 'MLB2' }], POR)
  assert.equal(imp.atualizados, 1); assert.equal(imp.erros.length, 2); assert.match(imp.erros[0].motivo, /não cadastrado/); assert.match(imp.erros[1].motivo, /canal inválido/)
  assert.equal(of.obterAnuncio(A, a1.id).preco_atual, 179.9, 'irmã V1 intacta')
  // job de ficha só mexe na ficha
  of.confirmarReferencia({ cliente: A, variante_id: preto.id, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB1:foto-1' }] })
  let j = of.abrir({ cliente: A, anuncio_id: a1.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: 'Tester' })
  assert.equal(j.variante_id, preto.id, 'variante resolvida pelo anúncio vinculado')
  falha(() => of.abrir({ cliente: A, anuncio_id: a1.id, variante_id: rosa.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: 'T' }), /outra variante/)
  falha(() => of.novaVersao(A, j.id, { conteudo: { atributos: [], titulo: 'novo', mudancas: [] }, por: 'T' }), /não permite alterar: titulo/)
  falha(() => of.novaVersao(A, j.id, { conteudo: { preco: { preco_proposto: 1 }, mudancas: [] }, por: 'T' }), /não permite alterar: preco/)
  for (const e of ['validando_entrada', 'referencia_confirmada', 'estrategia_preparada', 'estrategia_aprovada', 'em_producao', 'em_revisao']) j = of.transicionar(A, j.id, e, POR)
  of.novaVersao(A, j.id, { conteudo: { atributos: [{ atributo_id: 'MPN', valor_proposto: 'ZW01-PRIME', fonte: 'manual' }], mudancas: [] }, por: 'T' })
  of.aprovar({ cliente: A, job_id: j.id, versao: 1, campos: ['atributos'], autor: 'C' })
  j = of.transicionar(A, j.id, 'aprovado_publicar', POR); j = of.transicionar(A, j.id, 'na_fila', POR)
  const pub = of.registrarPublicacao(A, { job_id: j.id, canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', versao: 1, operacao: 'atualizar_atributos', payload: { attributes: [{ id: 'MPN', value_name: 'ZW01-PRIME' }] }, snapshot_antes: { attributes: [] } })
  assert.equal(pub.repetida, false); assert.equal(pub.estado, 'preparada'); assert.equal(pub.chave_idem, `${A}|123|MLB1|1|atualizar_atributos`)
  const pub2 = of.registrarPublicacao(A, { job_id: j.id, canal: 'ML', conta_id: '123', anuncio_id: 'MLB1', versao: 1, operacao: 'atualizar_atributos' })
  assert.equal(pub2.repetida, true); assert.equal(pub2.id, pub.id, 'timeout + repetição = mesma publicação, nunca duplicata')
  falha(() => of.registrarPublicacao(A, { job_id: j.id, canal: 'ML', anuncio_id: 'MLB1', versao: 2, operacao: 'x' }), /versão aprovada atual/, 409)
  const pe = of.atualizarPublicacao(A, pub.id, { estado: 'enviada', resposta: { status: 202 } }); assert.equal(pe.estado, 'enviada'); assert.deepEqual(pe.resposta, { status: 202 })
  falha(() => of.atualizarPublicacao(A, pub.id, { estado: 'falhou' }), /exige o erro/)
  falha(() => of.atualizarPublicacao(A, pub.id, { estado: 'sucesso' }), /estado de publicação inválido/)
  j = of.transicionar(A, j.id, 'publicando', POR); j = of.transicionar(A, j.id, 'em_conferencia', POR); j = of.transicionar(A, j.id, 'publicado_confirmado', POR)
  assert.ok(j.publicado_em); assert.equal(of.obterJob(A, j.id).publicacoes.length, 1)
})

// ── critério 17: isolamento entre clientes ────────────────────────────────────
ok('17. cliente B não lê nem edita nada do cliente A trocando ids; [Comercial] e cliente vazio são recusados', () => {
  const { of } = novoBanco()
  const { p, v, j } = prepara(of, A)
  of.novaVersao(A, j.id, { conteudo: { atributos: [], mudancas: [] }, por: 'T' })
  const a = of.vincularAnuncio(A, { variante_id: v.id, canal: 'ML', anuncio_id: 'MLB1' }, POR)
  const c = of.registrarCusto(A, { variante_id: v.id, custo_compra: 10 }, POR)
  assert.equal(of.obterProduto(B, p.id), null); assert.equal(of.obterVariante(B, v.id), null); assert.equal(of.obterJob(B, j.id), null); assert.equal(of.obterAnuncio(B, a.id), null)
  assert.equal(of.obterProposta(B, j.id), null); assert.deepEqual(of.listarAprovacoes(B, j.id), []); assert.deepEqual(of.listarPublicacoes(B, j.id), []); assert.deepEqual(of.eventos(B), [])
  assert.deepEqual(of.listarVariantes(B), []); assert.deepEqual(of.listarJobs(B), []); assert.deepEqual(of.listarAnuncios(B), []); assert.deepEqual(of.listarImagens(B, { variante_id: v.id }), [])
  assert.deepEqual(of.custoVigente(B, v.id).bloqueios, ['custo_ausente'], 'custo de A não vaza para B')
  falha(() => of.atualizarVariante(B, v.id, { estoque: 1 }, POR), /não encontrada/, 404)
  falha(() => of.atualizarProduto(B, p.id, { nome: 'x' }, POR), /não encontrado/, 404)
  falha(() => of.criarVariante(B, { produto_id: p.id, sku: 'OUTRO' }, POR), /não encontrado/, 404)
  falha(() => of.confirmarReferencia({ cliente: B, variante_id: v.id, por: 'X', origem_fotos: REF }), /não encontrada/, 404)
  falha(() => of.contestarReferencia({ cliente: B, variante_id: v.id, por: 'X', motivo: 'm' }), /não encontrada/, 404)
  falha(() => of.transicionar(B, j.id, 'cancelado', { por: 'X', motivo: 'm' }), /não encontrado/, 404)
  falha(() => of.novaVersao(B, j.id, { conteudo: { atributos: [] }, por: 'X' }), /não encontrado/, 404)
  falha(() => of.aprovar({ cliente: B, job_id: j.id, versao: 1, campos: ['atributos'], autor: 'X' }), /não encontrado/, 404)
  falha(() => of.abrir({ cliente: B, variante_id: v.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: 'X' }), /não encontrada/, 404)
  falha(() => of.abrir({ cliente: B, anuncio_id: a.id, escopo: 'ficha', objetivo: 'corrigir_ficha', solicitante: 'X' }), /não encontrado/, 404)
  falha(() => of.upsertAtributo(B, { variante_id: v.id, atributo_id: 'MPN', valor_proposto: 'x' }, POR), /não encontrada/, 404)
  falha(() => of.registrarCusto(B, { variante_id: v.id, custo_compra: 1 }, POR), /não encontrada/, 404)
  falha(() => of.registrarImagem(B, { variante_id: v.id }, POR), /não encontrada/, 404)
  falha(() => of.registrarPublicacao(B, { job_id: j.id, canal: 'ML', versao: 1, operacao: 'x' }), /não encontrado/, 404)
  falha(() => of.vincularAnuncio(B, { variante_id: v.id, canal: 'ML', anuncio_id: 'MLB2' }, POR), /não encontrada/, 404)
  for (const cli of ['', '  ', '[Comercial] Loja X', null]) falha(() => of.listarVariantes(cli), /cliente obrigatório/)
  assert.equal(of.obterVariante(A, v.id).custo.total, c.total, 'A continua lendo o próprio custo')
  assert.equal(of.listarVariantes(A)[0].jobs_ativos, 1)
})

// ── máquina de estados ───────────────────────────────────────────────────────
ok('checarPreservacao (Trocar/Preservar): só fatos da ficha com fonte; reprova texto sem a cor, aprova "Kit 3 un Azul"; plural/abreviação toleradas; atributo com fonte vence a variante; campos restringem', () => {
  const f = { cor: 'Azul', quantidade_kit: 3 }
  const r = O.checarPreservacao(f, 'Smartwatch Preto')
  assert.equal(r.ok, false); assert.deepEqual(r.faltantes, [{ campo: 'cor', valor: 'Azul' }, { campo: 'quantidade_kit', valor: 3 }])
  assert.deepEqual(r.preservar, [{ campo: 'cor', valor: 'Azul', fonte: 'ficha da variante' }, { campo: 'quantidade_kit', valor: 3, fonte: 'ficha da variante' }])
  for (const t of ['Kit 3 un Azul', 'Relógio AZUL c/ 3 unidades', 'relogio azul 3x', 'Conjunto 3 peças azul']) assert.equal(O.checarPreservacao(f, t).ok, true, t)
  assert.equal(O.checarPreservacao(f, 'Relógio azul 3').ok, false, '"3" solto não é kit')
  assert.equal(O.checarPreservacao(f, 'Kit 3 un Azul', { campos: ['cor'] }).ok, true); assert.deepEqual(O.checarPreservacao(f, 'Kit 3 un', { campos: ['cor'] }).faltantes, [{ campo: 'cor', valor: 'Azul' }])
  const g = { cor: 'Azul', marca: 'Acme', modelo: 'W12', atributos: [
    { atributo_id: 'COLOR', valor_proposto: 'Verde', fonte: 'foto confirmada', evidencia: 'CONFIRMACAO.json' },      // proposto com fonte+evidência vence a variante
    { atributo_id: 'ACCESSORIES_INCLUDED', valor_atual: 'cabo magnético, manual', fonte: 'caixa' },
    { atributo_id: 'SIZE', valor_proposto: 'G', fonte: 'operação' },                                              // proposto SEM evidência: não é fato → não entra
    { atributo_id: 'PACKAGE_CONTENT', valor_atual: '1 relógio, 1 pulseira' } ] }                                   // sem fonte: não entra (nunca inventa)
  const p = O.checarPreservacao(g, 'Relógio verde Acme W12 com cabos magnéticos e manual')
  assert.equal(p.ok, true); assert.deepEqual(p.preservar.map(x => [x.campo, x.valor, x.fonte]), [['cor', 'Verde', 'foto confirmada'], ['marca', 'Acme', 'ficha do produto'], ['modelo', 'W12', 'ficha do produto'], ['acessorios', 'cabo magnético, manual', 'caixa']])
  assert.deepEqual(O.checarPreservacao(g, 'Relógio Acme W12').faltantes.map(x => x.campo), ['cor', 'acessorios'])
  assert.deepEqual(O.checarPreservacao({}, 'qualquer coisa'), { ok: true, faltantes: [], preservar: [] }, 'ficha vazia não inventa nada')
  assert.deepEqual(O.CAMPOS_PRESERVAR_TITULO, ['cor', 'tamanho', 'quantidade_kit'])
})

ok('máquina de estados: transição inválida recusada (409); estado com motivo obrigatório; por obrigatório; evento com de/para/motivo/responsável; terminal não sai', () => {
  const { of } = novoBanco()
  const { j } = prepara(of, A, { ate: 'rascunho' })
  assert.equal(j.estado, 'rascunho'); assert.deepEqual(j.proximos, ['validando_entrada', 'cancelado'])
  falha(() => of.transicionar(A, j.id, 'em_producao', POR), /transição inválida: Rascunho → Em produção/, 409)
  falha(() => of.transicionar(A, j.id, 'inexistente', POR), /estado desconhecido/)
  falha(() => of.transicionar(A, j.id, 'validando_entrada', {}), /informe "por"/)
  falha(() => of.transicionar(A, j.id, 'cancelado', POR), /exige motivo/)
  let job = of.transicionar(A, j.id, 'validando_entrada', POR)
  job = of.transicionar(A, job.id, 'referencia_confirmada', POR)
  job = of.transicionar(A, job.id, 'estrategia_preparada', POR)
  job = of.transicionar(A, job.id, 'rejeitado', { por: 'Consultor', motivo: 'direção errada: foco em preço, não em capa' })
  assert.equal(job.estado_info.responsavel, 'aprovador')
  job = of.transicionar(A, job.id, 'em_producao', { por: 'sistema', motivo: 'nova rodada com o motivo da reprovação' })
  job = of.transicionar(A, job.id, 'falha_recuperavel', { por: 'sistema', motivo: 'provedor de imagem sem crédito' })
  assert.equal(job.erro, 'provedor de imagem sem crédito')
  job = of.transicionar(A, job.id, 'cancelado', { por: 'Solicitante', motivo: 'produto descontinuado' })
  assert.equal(job.erro, ''); assert.deepEqual(job.proximos, [])
  falha(() => of.transicionar(A, job.id, 'em_producao', POR), /permitidas: nenhuma/, 409)
  falha(() => of.novaVersao(A, job.id, { conteudo: { atributos: [] }, por: 'T' }), /não aceita nova versão/, 409)
  const ev = of.eventos(A, { entidade: 'job', entidade_id: j.id }).filter(e => e.acao === 'transicao')
  assert.equal(ev.length, 7); assert.ok(ev.every(e => e.por && e.detalhes.de && e.detalhes.para && e.detalhes.responsavel))
  assert.deepEqual(ev[0].detalhes, { de: 'falha_recuperavel', para: 'cancelado', motivo: 'produto descontinuado', pendencias: [], responsavel: 'solicitante' })
  assert.deepEqual(of.listarJobs(A, { estado: 'cancelado' }).map(x => x.sku), ['SKU-1'])
  // validações de abertura e de imagem
  falha(() => of.abrir({ cliente: A, variante_id: j.variante_id, escopo: 'tudo', objetivo: 'lancar', solicitante: 'T' }), /escopo inválido/)
  falha(() => of.abrir({ cliente: A, variante_id: j.variante_id, escopo: 'ficha', objetivo: 'vender mais', solicitante: 'T' }), /objetivo inválido/)
  falha(() => of.abrir({ cliente: A, variante_id: j.variante_id, escopo: 'ficha', objetivo: 'lancar', modo: 'yolo', solicitante: 'T' }), /modo inválido/)
  falha(() => of.abrir({ cliente: A, escopo: 'ficha', objetivo: 'lancar', solicitante: 'T' }), /informe variante_id/)
  const img = of.registrarImagem(A, { variante_id: j.variante_id, papel: 'capa', ordem: 1 }, POR)
  falha(() => of.decidirImagem(A, img.id, { status: 'reprovada', por: 'Dono' }), /exige motivo/)
  assert.equal(of.decidirImagem(A, img.id, { status: 'reprovada', motivo: 'botão inventado na lateral', por: 'Dono' }).motivo_reprovacao, 'botão inventado na lateral')
  const original = of.listarImagens(A, { variante_id: j.variante_id }).find(i => i.papel === 'original')
  falha(() => of.decidirImagem(A, original.id, { status: 'aprovada', por: 'Dono' }), /contestarReferencia/)
})

console.log(`\n${n} blocos OK — núcleo de dados das ofertas estratégicas`)
