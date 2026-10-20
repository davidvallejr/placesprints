process.env.PS_PROMO_MEMORIA = '1'   // convenção das frentes: antes de qualquer import (este teste não abre banco nenhum)
// Teste estático da UI de custos (M9): src/web/integracoes.html|js e a aba Custos de src/web/promocoes.js. Sem rede, sem banco, sem DOM.
//  (1) todo endpoint /api/custos/* chamado pela UI existe nas rotas do M8 (src/rotas-custos.js) com o mesmo método;
//  (2) todo $('id') literal, aria-controls/labelledby, for= e data-copiar-de aponta para um id do HTML ou de um id="..." do próprio script;
//  (3) XSS (heurística): nos trechos novos, toda interpolação ${...} que vira HTML passa por esc()/formatador numérico/construtor h*(),
//      e os construtores puros, executados com dados-sonda (<img onerror>), nunca devolvem a sonda crua;
//  (4) sem confirm()/prompt()/alert() nos trechos novos; localStorage só guarda "Seu nome"; node --check nos .js.
// Rodar: node scripts/teste-custos-ui.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
const INT_JS = ler('src/web/integracoes.js'), INT_HTML = ler('src/web/integracoes.html'), PR_JS = ler('src/web/promocoes.js'), PR_HTML = ler('src/web/promocoes.html')
const trecho = (src, a, b) => { const i = src.indexOf(a), f = src.indexOf(b, i + a.length); assert.ok(i >= 0 && f > i, `marcadores ${a} … ${b} não encontrados`); return src.slice(i, f) }
const CUSTOS = trecho(INT_JS, '// <custos>', '// </custos>'), PURO_INT = trecho(INT_JS, '// <custos-puro>', '// </custos-puro>'), ERP_PR = trecho(PR_JS, '// <custos-erp>', '// </custos-erp>')
let n = 0
const caso = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('FALHOU:', nome); throw e } }

// ═════════ (1) endpoints ═════════════════════════════════════════════════════════════════════════════
const norm = p => p.replace(/\$\{[^}]*\}/g, ':p').replace(/:\w+/g, ':p')
const ROTAS_M8 = new Set([...ler('src/rotas-custos.js').matchAll(/rotasCustos\.(get|post)\('([^']+)'/g)].map(m => `${m[1].toUpperCase()} ${norm(m[2])}`))
// rotas registradas em laço (for (const acao of ['vincular', …]) rotasCustos.post(`/api/custos/${acao}`, …)): cada valor da lista vira uma rota
for (const m of ler('src/rotas-custos.js').matchAll(/for \(const (\w+) of \[([^\]]*)\]\) rotasCustos\.(get|post)\(`([^`]+)`/g))
  for (const [, v] of m[2].matchAll(/'([^']+)'/g)) ROTAS_M8.add(`${m[3].toUpperCase()} ${norm(m[4].replace('${' + m[1] + '}', v))}`)
const ROTAS_SPEC = new Set([...ler('docs/integracao-custos-erp-SPEC.md').matchAll(/^\| `(GET|POST) (\/api\/custos\/[^`?\s]+)/gm)].map(m => `${m[1]} ${norm(m[2])}`))
// api('/x', {...}) = POST; api(`/x?...`) sem corpo = GET
const chamadas = src => [...src.matchAll(/api\((['`])(\/api\/custos\/[^'`?]*)[^'`]*\1\s*(,|\))/g)].map(m => `${m[3] === ',' ? 'POST' : 'GET'} ${norm(m[2])}`)

caso('endpoints: toda chamada /api/custos/* da UI existe no M8 com o mesmo método', () => {
  assert.ok(ROTAS_M8.size >= 10, 'rotas do M8 não encontradas em src/rotas-custos.js')
  const usadas = [...new Set([...chamadas(INT_JS), ...chamadas(PR_JS)])]
  for (const e of ['GET /api/custos/resumo', 'GET /api/custos/quarentena', 'GET /api/custos/reconciliacao', 'POST /api/custos/quarentena/decidir', 'POST /api/custos/fontes/sheets/webhook',
    'POST /api/custos/erp/credenciais', 'POST /api/custos/erp/app-global', 'POST /api/custos/erp/autorizar', 'POST /api/custos/erp/desconectar', 'POST /api/custos/fontes/sincronizar', 'GET /api/custos/job/:p'])
    assert.ok(usadas.includes(e), `a UI deveria chamar ${e}`)
  assert.deepEqual(usadas.filter(u => !ROTAS_M8.has(u)), [], 'chamada sem rota no M8')
  const foraSpec = usadas.filter(u => !ROTAS_SPEC.has(u))
  assert.deepEqual(foraSpec, ['GET /api/custos/quarentena'], 'só a listagem da quarentena (rota extra do M8) pode faltar na tabela 10.1 da spec')
})
caso('endpoints: a aba Custos lê GET /api/promocoes/custos e o link /integracoes?custos= tem página', () => {
  assert.match(PR_JS, /carregar\(t, `\/api\/promocoes\/custos\?cliente=\$\{C\(\)\}`\)/)
  assert.match(ler('src/rotas-promocoes.js'), /rotasPromocoes\.get\('\/api\/promocoes\/custos'/)
  assert.match(ler('src/server.js'), /app\.get\('\/integracoes'/)
  assert.match(INT_JS, /get\('custos'\)/, 'integracoes.js deveria abrir o cartão por ?custos=')
})

// ═════════ (2) ids ═══════════════════════════════════════════════════════════════════════════════════
const idsDe = (...fontes) => new Set(fontes.flatMap(s => [...s.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1])))
const refs = src => [...new Set([...src.matchAll(/\$\('([^']+)'\)/g), ...src.matchAll(/(?:aria-controls|aria-labelledby|\bfor|data-copiar-de)="([^"$]+)"/g)].map(m => m[1]))]
caso('ids: todo id referenciado em integracoes.js/html existe (HTML estático ou id="..." montado pelo script)', () => {
  const ids = idsDe(INT_HTML, INT_JS)
  for (const id of ['custosPainel', 'custosTitulo', 'custosQuem', 'custosMsg', 'custosErro', 'custosCorpo', 'custosFechar', 'custosAtualizar', 'dlgSegredo', 'dlgUrl', 'dlgSeg', 'dlgScript', 'dlgCopiarScript', 'dlgAviso'])
    assert.ok(INT_HTML.includes(`id="${id}"`), `#${id} deveria estar no HTML`)
  assert.deepEqual([...refs(INT_JS), ...refs(INT_HTML)].filter(id => !ids.has(id)), [])
})
caso('ids: todo id referenciado em promocoes.js/html existe (a aba Custos não quebrou a tela)', () => {
  const ids = idsDe(PR_HTML, PR_JS)
  assert.deepEqual([...refs(PR_JS), ...refs(PR_HTML)].filter(id => !ids.has(id)), [])
})
caso('tabela de clientes: coluna "Custos" no cabeçalho e colspan do vazio acompanha (6)', () => {
  assert.equal((INT_HTML.match(/<thead><tr>.*<\/tr><\/thead>/)[0].match(/<th>/g) || []).length, 6)
  assert.match(INT_JS, /colspan="6"/); assert.doesNotMatch(INT_JS, /colspan="5"/)
})

// ═════════ (3) XSS ═══════════════════════════════════════════════════════════════════════════════════
// heurística: interpolação-folha ${expr} (sem template aninhado) imprime só esc()/formatador/construtor h*(), literal, .length,
// ou ternário cujos dois ramos são isso. Teto conhecido: os ramos de um ternário que contém template aninhado não são olhados aqui
// (as folhas dele são) — a sonda abaixo cobre esse caso executando os construtores.
const SEGURO = /^(esc|fmtN|fmtR|fmtPct|enc|encodeURIComponent|h[A-Z]\w*|frescorCusto|faixaPendCustos|secaoCustos)\(/
const semLiterais = e => e.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''").trim()
const imprimeSeguro = x => x === "''" || /^\d+$/.test(x) || SEGURO.test(x) || /^[\w$.?]+\.length$/.test(x)
const suspeitas = src => [...src.matchAll(/\$\{([^{}`]*)\}/g)].map(m => m[1]).filter(e => {
  const x = semLiterais(e), t = x.match(/^[^?]+\?\s*(.+?)\s*:\s*(.+)$/)
  return !imprimeSeguro(x) && !(t && imprimeSeguro(t[1].trim()) && imprimeSeguro(t[2].trim()))
})
caso('XSS (estático): construtores de HTML e atribuições innerHTML dos trechos novos só interpolam valor escapado', () => {
  const linhasInner = CUSTOS.split('\n').filter(l => l.includes('innerHTML')).join('\n')
  assert.deepEqual(suspeitas(PURO_INT), [], 'integracoes.js <custos-puro>')
  assert.deepEqual(suspeitas(linhasInner), [], 'integracoes.js innerHTML do cartão')
  assert.deepEqual(suspeitas(ERP_PR), [], 'promocoes.js <custos-erp>')
  assert.deepEqual(suspeitas('<b>${s.sku}</b> ${x ? q.nome : \'\'} ${esc(ok)}'), ['s.sku', "x ? q.nome : ''"], 'a heurística deveria pegar dado cru')
})

const SONDA = '<img src=x onerror=alert(1)>"\''
const sondar = v => (Array.isArray(v) ? v.map(sondar) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sondar(x)])) : typeof v === 'string' ? SONDA : v)
const semSonda = (html, onde) => { assert.doesNotMatch(html, /<img/, `${onde}: sonda saiu crua`); assert.ok(!html.includes(SONDA), onde) }
const I = vm.runInNewContext(INT_JS.match(/^const esc = .*$/m)[0] + '\n' + PURO_INT + '\n;({ hCorpo, hQuar, hRec, celCustos })')
const fonteBase = { estado: 'x', ultimo_sync_ok_em: 'x', idade_dias: 1, velha: true, ultimo_erro: 'x', contagens: { skus: 'x', rejeitadas: 2, quarentena: 1, nao_vistos: 0 } }
const RESUMO = {
  cliente: 'x', cfg: { ordem_fontes: ['x', 'manual'] }, pendencias: [{ codigo: 'x', estado: 'x', texto: 'x' }], reconciliacao_disponivel: false, reconciliacao_motivo: 'x',
  fontes: { sheets: { ...fonteBase, webhook: { ativo: true, url: 'x', criado_em: 'x', rotacionado_em: 'x', ultimo_uso_em: 'x' } },
    bling: { ...fonteBase, credenciais: { conectado: true, reautorizar: false, modo_app: 'x', app_configurado: false, escopos: ['x'], company_id: 'x', expira_em: 'x', erro: 'x' } },
    tiny: { ...fonteBase, credenciais: { conectado: false, reautorizar: true, modo_app: 'proprio', escopos: [], erro: 'x' } } },
  efetivo: { skus_com_custo: 'x', por_fonte: { manual: 1, sheets: 'x' }, cobertura_receita_pct: 83.2, anuncios_total: 'x', anuncios_sem_sku: 3, anuncios_sem_custo: 4 },
}
caso('XSS (sonda): cartão, quarentena, reconciliação e coluna da tabela escapam todo dado do servidor', () => {
  const h = I.hCorpo(sondar(RESUMO), { bling: true })
  semSonda(h, 'hCorpo')
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;/)              // o dado aparece, escapado
  assert.match(h, /Sincronizando…/); assert.match(h, /data-cacao="wh-rotacionar"/); assert.match(h, /data-armar=/)
  semSonda(I.hQuar(sondar([{ sku: 'x', fonte: 'x', motivo: 'x', campo: 'x', custo_vigente: 'x', custo_proposto: 9, variacao_pct: 'x', preco_ref: 'x', recebido_em: 'x' }])), 'hQuar')
  semSonda(I.hRec({ disponivel: true, total: 'x', itens: [{ [SONDA]: SONDA, sku: { aninhado: SONDA }, n: 1 }] }), 'hRec')
  semSonda(I.hRec({ disponivel: false, motivo: SONDA, itens: [] }), 'hRec indisponível')
  semSonda(I.celCustos({ cliente: SONDA, ml: { status: 'conectado' } }), 'celCustos')
  assert.match(I.celCustos({ cliente: 'A', ml: { status: 'nao_opera' } }), /exige conta ML/)
})
caso('credenciais de ERP: client_id/secret em campos de senha; webhook sem URL ativa não mostra URL nem rotação', () => {
  const h = I.hCorpo(RESUMO)
  assert.equal((h.match(/name="client_secret" type="password"/g) || []).length, 3)    // Bling, Tiny e app público
  assert.equal((h.match(/name="client_id" type="password"/g) || []).length, 3)
  assert.doesNotMatch(h, /<input[^>]*\bvalue=/, 'nenhum campo de credencial vem preenchido')
  const semWh = I.hCorpo({ ...RESUMO, fontes: { ...RESUMO.fontes, sheets: { estado: 'desconectado' } } })
  assert.match(semWh, /sem webhook: gere um/); assert.match(semWh, /data-cacao="wh-gerar">/); assert.doesNotMatch(semWh, /wh-rotacionar|data-cu-copia/)
  const desativado = I.hCorpo({ ...RESUMO, fontes: { ...RESUMO.fontes, sheets: { webhook: { ativo: false, url: 'https://t/webhook/custos/abc' } } } })
  assert.match(desativado, /data-cacao="wh-gerar" data-armar=/); assert.doesNotMatch(desativado, /https:\/\/t\/webhook/)
})

// aba Custos de promocoes.js: bloco puro (já executado isolado por teste-promocoes-ui.mjs) com os construtores novos
const P = vm.runInNewContext(trecho(PR_JS, '// <puro>', '// </puro>') + '\n;({ secaoCustos, faixaPendCustos, frescorCusto, secaoVinculos, normMlb })')
caso('aba Custos: colunas Fonte/Campo/Frescor com sonda escapada; sem skus_efetivos a tabela antiga continua', () => {
  const it = { sku: 'x', custo: 12.5, fonte: 'x', campo: 'x', atualizado_na_fonte: 'x', recebido_em: 'x', visto_em: 'x', nao_visto_desde: '', id_externo: 'x', idade_dias: 1, perdedoras: [{ fonte: 'x', custo: 3 }] }
  const h = P.secaoCustos(sondar({ skus: [{ sku: 'x', fonte: 'x' }], skus_efetivos: { total: 5, itens: [it, { ...it, fonte: 'manual' }] } }), SONDA)
  semSonda(h, 'secaoCustos'); assert.match(h, /Campo do ERP/); assert.match(h, /Frescor/); assert.match(h, /mostrando 2 de 5/); assert.match(h, /href="\/integracoes\?custos=%3Cimg/)
  const manual = P.secaoCustos({ skus: [{ sku: 'ABC', fonte: 'planilha do dono' }], skus_efetivos: [{ sku: 'abc', custo: 10, fonte: 'manual' }] }, 'A')
  assert.match(manual, /planilha do dono/); assert.match(manual, /manual \(sem prazo\)/)
  const antiga = P.secaoCustos({ skus: [{ sku: SONDA, custo: 1, fonte: SONDA, atualizado_em: '2026-10-05' }] }, 'A')
  semSonda(antiga, 'tabela antiga'); assert.match(antiga, /Custos cadastrados \(1\)/); assert.doesNotMatch(antiga, /Frescor/)
  assert.match(P.secaoCustos({ skus: [], skus_efetivos: { total: 0, itens: [] } }, 'A'), /Nenhum custo por SKU/)
})
caso('aba Custos: frescor (ERP 3 dias, planilha 14), não visto, idade desconhecida e limite do servidor', () => {
  assert.match(P.frescorCusto({ fonte: 'sheets', idade_dias: 10 }), /selo bom">em dia · há 10 d/)
  assert.match(P.frescorCusto({ fonte: 'sheets', idade_dias: 15 }), /selo atencao">custo velho/)
  assert.match(P.frescorCusto({ fonte: 'bling', idade_dias: 3 }), /em dia/)
  assert.match(P.frescorCusto({ fonte: 'tiny', idade_dias: 3.5 }), /custo velho · há 3,5 d/)
  assert.match(P.frescorCusto({ fonte: 'bling' }), /custo velho/)                              // sem idade: nunca "em dia" sem prova
  assert.match(P.frescorCusto({ fonte: 'bling', idade_dias: 9, velha: false }), /em dia/)      // limite do cliente vindo do servidor vence o padrão
  assert.match(P.frescorCusto({ fonte: 'sheets', idade_dias: 1, nao_visto_desde: '2026-10-01' }), /não visto desde 01\/10\/2026/)
  assert.match(P.frescorCusto({ fonte: 'manual' }), /sem prazo/)
})
caso('aba Custos: pendências de custo (custo velho) aparecem só quando o servidor manda, com sonda escapada', () => {
  assert.equal(P.faixaPendCustos(undefined, 'A'), ''); assert.equal(P.faixaPendCustos([], 'A'), '')
  const h = P.faixaPendCustos([{ codigo: 'CUSTO_FONTE_VELHA', estado: 'ATENCAO', texto: SONDA }, { codigo: SONDA, estado: SONDA, texto: 'y' }], 'A B')
  semSonda(h, 'faixaPendCustos'); assert.match(h, /tagzinha">custo velho</); assert.match(h, /custos=A%20B/)
})

caso('aba Custos: vínculo custo ↔ anúncio — sonda escapada nas 3 seções, origem com rótulo, Desvincular só no manual (automático: Não é este), foco do atalho e MLB validado', () => {
  const v = { custos_sem_anuncio: [{ sku_custo: 'x', custo: 24.34, candidatos: [{ item_id: 'x', titulo: 'x', thumb: 'x', sku: 'x', semelhanca: 80 }] }, { sku_custo: 'x', custo: 5, candidatos: [] }],
    anuncios_sem_custo: [{ item_id: 'x', titulo: 'x', thumb: 'x', sku: 'x', fat30: 900, candidatos: [{ sku_custo: 'x', custo: 1, semelhanca: 'x' }] }],
    vinculados: [{ item_id: 'x', sku_custo: 'x', origem: 'manual', por: 'x', em: 'x' }, { item_id: 'x', sku_custo: 'x', origem: 'x', por: '', em: '' }], totais: {} }
  const sv = sondar(v); sv.vinculados[0].origem = 'manual'                     // a origem é lista fechada do servidor; o resto vira sonda
  const h = P.secaoVinculos(sv, { r: { coleta: { estado: 'concluida' } }, custos: sondar([{ sku: 'x', custo: 3 }]) })
  semSonda(h, 'secaoVinculos'); assert.match(h, /Custos sem anúncio \(2\)/); assert.match(h, /semelhança 80%/); assert.match(h, /Anúncios sem custo \(1\)/); assert.match(h, /Custo por anúncio \(2\)/)
  assert.equal((h.match(/data-acao="cv-desvincular"/g) || []).length, 1, 'só o vínculo manual se desfaz')
  assert.equal((h.match(/<tr><td>[^]*?data-acao="cv-recusar"/g) || []).length, 1, 'vínculo automático errado tem "Não é este" na tabela')
  assert.match(h, /<datalist id="cvCustos"><option value="&lt;img/); assert.match(h, /informe o ID/)
  const ok = { custos_sem_anuncio: [], vinculados: [{ item_id: 'MLB1', sku_custo: 'A', origem: 'sku_normalizado' }, { item_id: 'MLB2', sku_custo: 'B', origem: 'grupo' }, { item_id: 'MLB3', sku_custo: 'C', origem: 'manual', por: 'Ana', em: '2026-10-07' }],
    anuncios_sem_custo: [{ item_id: 'MLB10', titulo: 'a', fat30: 900, candidatos: [] }, { item_id: 'MLB11', titulo: 'b', thumb: 'https://h/b.jpg"onerror="x', fat30: 100, candidatos: [] }] }
  const f = P.secaoVinculos(ok, { r: { coleta: { estado: 'concluida' } }, foco: 'MLB11', custos: [{ sku: 'A', custo: 1 }] })
  assert.match(f, />SKU normalizado</); assert.match(f, />herdado</); assert.match(f, /Ana · 07\/10\/2026/); assert.match(f, /Todo custo cadastrado vale para algum anúncio/)
  assert.ok(f.indexOf('MLB11') < f.indexOf('MLB10'), 'o anúncio do atalho sobe para o topo'); assert.equal((f.match(/ id="cvFoco"/g) || []).length, 1); assert.match(f, /pr-vinc pr-vinc-an foco/)
  assert.match(f, /src="https:\/\/h\/b\.jpg&quot;onerror=&quot;x"/, 'URL da miniatura escapada')
  assert.match(P.secaoVinculos({ anuncios_sem_custo: [], custos_sem_anuncio: [], vinculados: [] }, { r: { coleta: { estado: 'parcial' } } }), /Sem leitura confiável \(coleta parcial\): não dá para afirmar que todo anúncio ativo tem custo/)
  assert.match(P.secaoVinculos({ anuncios_sem_custo: [], custos_sem_anuncio: [], vinculados: [] }, {}), /Nenhum custo cadastrado/)
  const muitos = { custos_sem_anuncio: [], vinculados: [], anuncios_sem_custo: Array.from({ length: 60 }, (_, i) => ({ item_id: 'MLB' + (100000 + i), titulo: 't', fat30: 1, candidatos: [] })), totais: { anuncios_sem_custo: 700 } }
  const m = P.secaoVinculos(muitos, { r: { coleta: { estado: 'concluida' } } })
  assert.match(m, /1–50 de 60 · <button[^>]*data-acao="mais" data-k="cv_anuncios">Mostrar mais/); assert.match(m, /a lista para em 60 de 700/); assert.match(m, /Anúncios sem custo \(700\)/)
  assert.equal(P.normMlb(' mlb-4311029803 '), 'MLB4311029803'); assert.equal(P.normMlb('MLB12'), ''); assert.equal(P.normMlb('MLB1234567890123'), ''); assert.equal(P.normMlb('4311029803'), ''); assert.equal(P.normMlb(null), '')
})

// ═════════ (4) proibições e sintaxe ═══════════════════════════════════════════════════════════════════
caso('sem confirm()/prompt()/alert() nos trechos novos; localStorage só guarda "Seu nome"; segredo só no diálogo', () => {
  for (const [nome, t] of [['integracoes <custos>', CUSTOS], ['promocoes <custos-erp>', ERP_PR]]) assert.doesNotMatch(t.replace(/\/\/.*$/gm, ''), /\b(confirm|prompt|alert)\(/, nome)   // comentário que diz "sem confirm()" não conta
  assert.deepEqual([...CUSTOS.matchAll(/localStorage\.setItem\(([^,]+),/g)].map(m => m[1].trim()), ["'promo_quem'"])
  assert.doesNotMatch(CUSTOS, /sessionStorage|indexedDB/)
  assert.deepEqual([...CUSTOS.matchAll(/r\.segredo/g)].length, 1, 'o segredo só é lido para o diálogo')
  assert.match(CUSTOS, /addEventListener\('close', \(\) => \{ \$\('dlgUrl'\)\.textContent = ''; \$\('dlgSeg'\)\.textContent = ''/)
})
caso('node --check em integracoes.js e promocoes.js', () => {
  for (const f of ['src/web/integracoes.js', 'src/web/promocoes.js']) execFileSync(process.execPath, ['--check', RAIZ + f])
})

console.log(`\n✔ teste-custos-ui: ${n} casos passaram (endpoints, ids, XSS estático + sonda, proibições)`)
