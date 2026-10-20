// Autoteste estático da tela de Ofertas (Cliente → Anúncios): componente carregado antes do cliente.js, contêiner vivo, 8 abas, 5 ações,
// endpoints usados existem nas rotas, dados do servidor só por esc()/textContent, sem emoji em controle, um primário no HTML estático.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const f = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
let n = 0; const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const of = f('src/web/ofertas.js'), cli = f('src/web/cliente.js'), html = f('src/web/cliente.html'), rotas = f('src/rotas-ofertas.js'), planos = f('src/web/planos.js')

ok('cliente.html carrega ofertas.js antes de cliente.js; cliente.js tem o contêiner vivo e chama PSOfertas.montar', () => {
  assert.ok(html.indexOf('ofertas.js') > 0 && html.indexOf('ofertas.js') < html.indexOf('"cliente.js"'))
  assert.match(cli, /VIVOS = \[[^\]]*'ofertas'/); assert.match(cli, /id="ofertas"/); assert.match(cli, /PSOfertas\.montar\(alvo, cliente\)/); assert.match(cli, /carregarOfertas\(d\.cliente\)/)
  // contrato mudou em 07/10 (plano §5): o Resultado das tarefas foi para a aba Resumo; Ofertas segue como o 1º bloco da aba Anúncios
  assert.ok(cli.indexOf('data-painel="anuncios"') < cli.indexOf('id="secOfertas"') && cli.indexOf('id="secOfertas"') < cli.indexOf('id="secAnuncios"'), 'Ofertas vem no topo da aba Anúncios')
})
ok('as 5 ações da seção 3 da spec e as 8 abas do detalhe existem, em português e sem emoji em controle', () => {
  for (const t of ['Novo produto', 'Importar planilha', 'Importar anúncio existente', 'Otimizar selecionados', 'Fila de produção']) assert.ok(of.includes(`'${t}'`), t)
  for (const t of ['Visão geral', 'Dados e ficha', 'Custos e preços', 'Fotos e galeria', 'Estratégia', 'Aprovação', 'Publicação', 'Histórico e resultados']) assert.ok(of.includes(`'${t}'`), t)
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(of), 'sem emoji no componente')
  assert.ok(of.includes("el('dialog', { className: 'dlg' }, form)"), 'o formulário fica dentro do <dialog> (diálogo vazio foi bug em 07/10)')
})
ok('todo endpoint /api/ofertas usado no componente existe nas rotas (e vice-versa para os que a tela precisa)', () => {
  const usados = [...of.matchAll(/\/api\/ofertas\/[a-z\-.]+(?:\/\$\{[^}]+\}\/[a-z\-]+|\/[a-z\-]+)?/g)].map(m => m[0].replace(/\/\$\{[^}]+\}/g, '/:id'))
  const definidos = [...rotas.matchAll(/r\.(?:get|post|delete)\('(\/api\/ofertas\/[^']+)'/g)].map(m => m[1])
  for (const u of new Set(usados)) assert.ok(definidos.some(d => d === u || d.replace(/:[a-z]+/g, ':id') === u.replace(/:[a-z]+/g, ':id') || u.startsWith(d.replace(/:[a-z]+/g, ':id'))), 'rota usada e não definida: ' + u)
  for (const d of ['/api/ofertas/capacidades', '/api/ofertas/anuncios', '/api/ofertas/jobs', '/api/ofertas/importar-anuncio', '/api/ofertas/importar-planilha', '/api/ofertas/produtos', '/api/ofertas/exportar.csv']) assert.ok(of.includes(d), 'tela não usa ' + d)
})
ok('segurança: dado do servidor só por esc()/textContent; publicação live só com confirmar explícito; honestidade da imagem pendente', () => {
  const inner = [...of.matchAll(/innerHTML = `([\s\S]*?)`\n/g)].map(m => m[1])
  for (const t of inner) for (const m of t.matchAll(/\$\{([^}]+)\}/g)) { const e = m[1]; assert.ok(/esc\(|badge\(|brl\(|num\(|pct\(|dt\(|kv\(|urlOk\(|\.map\(|\?|S\.limite|S\.f|q\b|cont\b|\.length|ESCOPO|OBJETIVO|MODO|TOM|linha\b|cards|chips/.test(e), 'interpolação sem escape: ' + e.slice(0, 80)) }
  assert.match(of, /live: true, confirmar: true/); assert.match(of, /Publicar AO VIVO no Mercado Livre\?/)
  assert.match(of, /Integração pendente/); assert.match(of, /É ESTE o produto\?/)
})
ok('POST /api/ofertas/jobs abre pelo motor único (fluxo.abrirJob com acao_id) quando disponível', () => { assert.match(rotas, /fluxo\.abrirJob \? \(c, o\) => fluxo\.abrirJob\(c, o\)/); assert.match(rotas, /acao_id: String\(it\?\.acao_id \|\| b\.acao_id \|\| ''\)/) })
ok('Distribuição mostra o profissional sugerido e o badge "via Ofertas" na coluna Quem recebe', () => { assert.match(planos, /a\.sugerido/); assert.match(planos, /via Ofertas/); assert.match(planos, /\$\{sug\}\$\{via\}/) })
console.log(`\nteste-ofertas-ui: ${n} verificações ok`)
