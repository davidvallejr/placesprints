// Autoteste do relatório de diagnóstico para o PROSPECT: seleção das oportunidades, linguagem voltada a ele, escape de HTML, blocos sem dado omitidos.
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports dinâmicos): nunca abre data/db.sqlite, nada de rede.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { renderDiagnosticoComercial, paraProspect } = await import('../src/lib/render-diagnostico-comercial.js')
const { selecionarOportunidades, montarDiagnosticoComercial } = await import('../src/lib/diagnostico-comercial.js')

const MAL = '<img src=x onerror=alert(1)>'
// 1) texto escrito para a equipe vira texto para o prospect
assert.equal(paraProspect('Confirmar estoque real com o cliente e informar na tela do cliente (Custos) ou na reunião de resultados'), 'Confirmar estoque real com você e informar na reunião de resultados')
assert.equal(paraProspect('o cliente decide'), 'você decide')

// 2) seleção: no máximo 3 por regra, descarta pendência e Full sem quantidade, preserva a ordem
const A = (regra, score, como = ['x'], tipo = 'ganho') => ({ regra: 'anuncio_' + regra, score, previsao: { tipo }, dados: { como, evidencia: 'ev com o cliente', hipotese: '' } })
const acoes = [A('catalogo_buybox', 90), A('catalogo_buybox', 80), A('catalogo_buybox', 70), A('catalogo_buybox', 60), A('estoque_ruptura', 55), A('cadastrar_custos', 50, ['x'], 'pendencia'), A('full_envio', 45, ['Quantidade sugerida: 0 / 0 / 0 un']), A('ima_conversao', 40)]
const sel = selecionarOportunidades(acoes)
assert.deepEqual(sel.map(a => a.regra), ['anuncio_catalogo_buybox', 'anuncio_catalogo_buybox', 'anuncio_catalogo_buybox', 'anuncio_estoque_ruptura', 'anuncio_ima_conversao'])
assert.equal(sel[0].dados.evidencia, 'ev com você')
assert.equal(selecionarOportunidades(acoes, 2).length, 2)

// 3) documento
const I = (id, extra = {}) => ({ id, titulo: `Produto ${id} ${MAL}`, thumb: 'https://http2.mlstatic.com/D_1.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-1', preco: 59.9, r: 1000, r0: 800, u: 20, u0: 16, v: 400, v0: 380, visOk: true, conv: 2, estoque: 100, cobertura: 140, curva: 'A', share_pct: 40, gap_receita: 500, fotos: 3, frete_gratis: false, ...extra })
const base = {
  disponivel: true, hoje: '2026-10-06', prospecto: { id: 'a', nome: `Nome ${MAL}`, empresa: `Empresa ${MAL}` },
  diag: { resumo: { gmv: 5000, gmv_anterior: 6000, delta_pct: -16.7, anuncios_ativos: 4, curvas: { A: 1, B: 1, C: 2 } }, periodo: { de: '2026-09-08', ate: '2026-10-05', anterior: { de: '2026-08-11', ate: '2026-09-07' } },
    itens: [I('MLB1'), I('MLB2', { cobertura: 4, u: 10 })], benchmark: { conv: 4 }, causal: { disponivel: true, leitura: 'Faturamento -16,7%. Ruptura no elo CONVERSÃO.', ruptura: 'conversao', deltas: { conversao: -0.8 }, investigar: ['Preço e frete'], causal: { classe: 'causa provável' } },
    ads: { custo: 300, receita: 1500, roas: 5, acos: 20, tacos: 6, ctr: 0.5, anterior: { receita: 1200 }, custo_var_pct: 10 }, custos_informados: false,
    pendencias: [{ item: 'Custos', muda: 'sem eles não há ROAS alvo', como: 'informar na tela do cliente (Custos) ou na reunião de resultados' }] },
  previsao: { baseline: 5000, n_acoes: 1, cenarios: { conservador: { faturamento: 5100 }, base: { faturamento: 5400, uplift_pct: 8 }, otimista: { faturamento: 5900 } }, receita_em_risco_evitada: 200 },
  pareto: { disponivel: true, leitura: '1 de 2 anúncios geram 80% da receita.', alerta: null, itens: [{ id: 'MLB1', titulo: `Mordedor ${MAL}`, thumb: 'https://http2.mlstatic.com/D_2.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-1', receita: 3000, share_pct: 60, acum_pct: 60 }] },
  full: { disponivel: true, tem_full: true, leitura: '2 anúncios no Full responderam por 50% da receita.' }, cobertura: { de: '2026-05-09' },
  oportunidades: [{ titulo: `Repor estoque ${MAL}`, regra: 'anuncio_estoque_ruptura', previsao: { tipo: 'risco_evitado', horizonte_dias: 28, cenarios: { conservador: { receita: 100 }, base: { receita: 200 }, otimista: { receita: 300 } }, premissas: ['receita/dia R$ 10'] }, dados: { evidencia_tipo: 'fato', dimensao: 'Estoque', evidencia: 'estoque 0 un', hipotese: 'sem reposição some do ranking', como: ['Confirmar com você'], meta: 'cobertura ≥ 21 dias', item: { permalink: 'https://produto.mercadolivre.com.br/MLB-1' } } }],
}
const h = renderDiagnosticoComercial(base)
for (const t of ['Diagnóstico de conta', 'Resumo da conta', 'O funil: visitas × conversão × ticket', 'Onde está o dinheiro', 'Anúncios que vendem menos do que o tráfego merece', 'Mercado Livre Ads', 'Estoque, rupturas e Full', 'Reputação e nível', 'Oportunidades priorizadas', 'Fato observado', 'HIPÓTESE', 'Se o plano fosse executado', 'O que não conseguimos ver', 'Próximos passos', 'somente leitura', 'Leitura autorizada pelo titular', 'informar na reunião de resultados', 'Sem os custos da operação'])
  assert.ok(h.includes(t), `faltou "${t}"`)
assert.ok(!h.includes(MAL) && !h.includes('<script') && h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'HTML do prospect/anúncio escapado')
assert.ok(!/undefined|NaN|\bnull\b/.test(h.replace(/<style[\s\S]*?<\/style>/g, '')), 'sem lixo de template')
for (const proibido of ['Notion', 'tela do cliente', 'Fonte oficial: Notion', 'tarefa(s)']) assert.ok(!h.includes(proibido), `o documento do prospect não pode conter "${proibido}"`)
// blocos sem dado somem; nada vira zero inventado
const sem = renderDiagnosticoComercial({ ...base, diag: { ...base.diag, ads: { custo: 0, receita: 0 }, itens: [I('MLB1', { conv: 4.2, cobertura: 30 })] }, full: null, pareto: { disponivel: false }, oportunidades: [], previsao: { n_acoes: 0 } })
// 16/10/2026: bloco sem dado não some — DECLARA (nunca zero): Ads «nenhum investimento lido», 80/20 «sem receita», reputação «não lida»
assert.ok(sem.includes('Nenhum investimento nem receita de Ads lidos') && sem.includes('Sem receita nos anúncios lidos') && sem.includes('Reputação não lida') && !sem.includes('Se o plano fosse executado'))
assert.ok(!sem.includes('Gastaram em Ads') && !/R\$ 0\b.*Investimento/.test(sem), 'Ads sem dado não vira R$ 0')
// modo PÚBLICO (página /d/<token>): 5 problemas em linguagem simples, sem regra interna, sem contato/UTM; NOT_COLLECTED declarado com motivo
const { secoesDiagnosticoComercial } = await import('../src/lib/render-diagnostico-comercial.js')
const comNc = { ...base, nao_coletado: [{ analise: 'Cancelamentos', estado: 'NOT_COLLECTED', motivo: 'lido ao vivo na tela, ainda não coletado pelo sistema; não é zero' }], reputacao: { lida: true, nivel: '5_green', medalha: 'platinum', taxa_claims: 0.4, taxa_atraso: 1.2, taxa_cancel: 0.1, vendas_periodo: 320, periodo: '60 days' }, interno: { email: 'x@y.com', telefone: '11999', utm: { utm_source: 'insta' }, origem: 'publico', criado_em: '2026-10-16', formulario: { nicho: 'Pet shop', canais: ['Mercado Livre', 'Shopee'], funcionarios: '1 a 5', faturamento: 'R$7mil a R$40mil' } } }
const pub = secoesDiagnosticoComercial(comNc, { publico: true }).join('\n'), intn = secoesDiagnosticoComercial(comNc).join('\n')
assert.ok(pub.includes('Os 5 problemas prioritários') && pub.includes('NOT_COLLECTED') && pub.includes('não é zero') && pub.includes('5_green') && pub.includes('platinum'), 'público: prioridades, NOT_COLLECTED com motivo, reputação')
assert.ok(!pub.includes('x@y.com') && !pub.includes('11999') && !pub.includes('utm_source') && !pub.includes('regra anuncio_') && !pub.includes('Dados do lead'), 'público sem contato, UTM nem regra interna')
assert.ok(intn.includes('regra anuncio_estoque_ruptura') && intn.includes('x@y.com') && intn.includes('utm_source=insta') && intn.includes('Dados do lead (interno)'), 'interno: regra, contato e UTM')
assert.ok(intn.includes('Nicho em que atua') && intn.includes('Pet shop') && intn.includes('Mercado Livre · Shopee') && intn.includes('R$7mil a R$40mil'), 'interno: campos do formulário público')
assert.ok(!pub.includes('Pet shop') && !pub.includes('R$7mil a R$40mil') && !pub.includes('Nicho em que atua'), 'público: nada do formulário')
assert.ok(/<td>[^<]*<div class="dc-linha">/.test(intn) && intn.includes('<th>Estoque</th>') && intn.includes('<th>Visitas</th>'), 'curva ABC em tabela com visitas/conversão/estoque')
// PDF pelo relatorio-pdf com Chrome FALSO (exec injetado): perfil temporário próprio e HTML intermediário com as seções
{
  const { gerarPdf } = await import('../src/lib/relatorio-pdf.js')
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'ps-teste-pdf-')), destino = join(dir, 'diagnostico.pdf')
  const chrome = join(dir, 'chrome'); writeFileSync(chrome, '')
  let args = null, htmlLido = ''
  await gerarPdf(renderDiagnosticoComercial(comNc), destino, { chrome, exec: (bin, a, o, cb) => { args = a; htmlLido = readFileSync(a.at(-1).replace('file://', ''), 'utf8'); writeFileSync(destino, '%PDF-1.4 stub'); cb(null) } })
  assert.ok(args.some(a => a.startsWith('--user-data-dir=')) && args.includes(`--print-to-pdf=${destino}`), 'Chrome com perfil temporário e saída certa')
  assert.ok(htmlLido.includes('Os 5 problemas') === false && htmlLido.includes('Oportunidades priorizadas') && htmlLido.includes('NOT_COLLECTED'), 'o HTML do PDF é o documento interno completo')
  rmSync(dir, { recursive: true, force: true })
}
assert.ok(sem.includes('Nenhuma oportunidade acima dos limites'), 'sem oportunidade: texto honesto')
// cobertura histórica curta avisa que a variação pode estar subestimada
assert.ok(renderDiagnosticoComercial({ ...base, cobertura: { de: '2026-09-20' } }).includes('Histórico de pedidos lido a partir de'))

// 4) conta do prospect conectada e LIDA sem venda: não é "os dados ainda não foram lidos" (a leitura é decidida pela cobertura de pedidos, não pela série);
//    conectada e nunca lida continua pedindo a leitura. Banco em memória: nada de rede.
{
  const { db } = await import('../src/lib/db.js')
  const { addDias } = await import('../src/lib/meli-serie.js')
  const { cadastrarProspecto } = await import('../src/lib/comercial.js')
  assert.equal(db.name, ':memory:')
  const HOJE = '2026-10-05'
  const conta = c => db.prepare("INSERT OR IGNORE INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 1, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-05T04:00:00.000Z')").run(c)
  const lida = cadastrarProspecto({ nome: 'Fulana', empresa: 'Loja Lida Sem Venda' })
  conta(lida.chave_conexao)
  for (let d = -56; d <= -1; d++) db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,0,0,'2026-10-05T05:00:00.000Z')").run(lida.chave_conexao, addDias(HOJE, d))
  const r = montarDiagnosticoComercial(lida.id, { hoje: HOJE })
  assert.equal(r.disponivel, false); assert.ok(!r.precisa_coletar, 'antes: "os dados ainda não foram lidos" para conta lida')
  assert.equal(r.motivo, 'A conta está conectada e lida, mas sem vendas no período: ainda não há desempenho para diagnosticar.')
  assert.doesNotMatch(r.motivo, /MLB|null|Notion|\[Comercial\]/)
  const nova = cadastrarProspecto({ nome: 'Beltrano', empresa: 'Loja Nunca Lida' })
  conta(nova.chave_conexao)
  const n = montarDiagnosticoComercial(nova.id, { hoje: HOJE })
  assert.equal(n.precisa_coletar, true); assert.match(n.motivo, /ainda não foram lidos/)

  // 5) conta que VENDIA e parou (vendas só nos 28 anteriores): há desempenho — a queda a zero é o achado, o relatório sai (antes: "ainda não há desempenho", falso)
  const parou = cadastrarProspecto({ nome: 'Sicrano', empresa: 'Loja que parou de vender' }), K = parou.chave_conexao
  conta(K)
  db.prepare("INSERT OR REPLACE INTO meli_item (cliente, item_id, titulo, preco, status, estoque, fotos, frete_gratis, category_id, vis_de, vis_ate, atualizado_em) VALUES (?,'MLB1','Produto que parou',100,'active',1000,8,1,'MLB1234','2026-05-01',?,'x')").run(K, HOJE)
  for (let d = -56; d <= -1; d++) {
    db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,?,0,'2026-10-05T05:00:00.000Z')").run(K, addDias(HOJE, d), d < -28 ? 2 : 0)
    db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)').run(K, 'MLB1', addDias(HOJE, d), d < -28 ? 2 : 0, d < -28 ? 200 : 0, 40)
  }
  const q = montarDiagnosticoComercial(parou.id, { hoje: HOJE })
  assert.equal(q.disponivel, true, 'antes: descartado como "sem desempenho" com R$ 5.600 no período anterior')
  assert.deepEqual([q.diag.resumo.gmv, q.diag.resumo.gmv_anterior, q.diag.resumo.variacao.pct], [0, 5600, -100])
  const hq = renderDiagnosticoComercial(q).replace(/<style[\s\S]*?<\/style>/g, '')
  assert.ok(/▼ 100%|-100%/.test(hq), 'a queda a zero aparece no documento')
  assert.ok(Array.isArray(q.nao_coletado) && q.nao_coletado.some(x => x.estado === 'NOT_COLLECTED') && hq.includes('NOT_COLLECTED'), 'o que a coleta não entregou sai declarado (data_quality → relatório)')
  assert.ok(!q.nao_coletado.some(x => /^Diagnóstico de /.test(x.analise)), 'canais sem API não entram como "não coletado" da conta')
  assert.ok(!/undefined|NaN|\bnull\b|Infinity/.test(hq), 'GMV 0 não vira lixo de template')
  assert.doesNotMatch(hq, /\[Comercial\]|Notion/)
  assert.equal(r.disponivel, false, 'conta sem venda nos dois períodos segue "ainda não há desempenho"')
}
console.log('teste-diagnostico-comercial: OK')
