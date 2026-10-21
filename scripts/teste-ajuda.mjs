// Teste estático do ícone (i) «Como fazer» (docs/ux/arquitetura-5-menus.md § C; F2, 21/10/2026). Sem rede, sem banco, sem DOM.
//  (1) config/ajuda.json: todo verbete tem titulo, sistema do catálogo, escopo, chave, camada, pre_requisitos [{texto, verificar}], >= 3 passos
//      [{titulo, texto, quem}], concluido_quando e doc que existe no disco; onde é URL interna; texto sem hex e sem emoji; >= 20 verbetes e os 3 do doc;
//  (2) todo data-ajuda="<id>" de src/web/*.html|js tem verbete; todo botão é .btn-icone.btn-ajuda type=button com aria-label «Como fazer: …»,
//      nunca dentro de <h2>/<h3>; as 11 páginas carregam /ajuda.js com defer;
//  (3) src/web/ajuda.js: node --check, sem innerHTML, delegação [data-ajuda] com preventDefault + stopPropagation, dialog.dlg, window.PSAjuda.abrir;
//  (4) src/rotas-ajuda.js: montarVerbete devolve estado sem_leitura (nunca ligado fingido), selo do sistema, 404 sem ecoar o id; montada em server.js;
//  (5) ui.css: .btn-ajuda::before por máscara SVG (sem hex fora do :root), .dlg .passos-ajuda vertical; shell.js intocado pela ajuda (sem fetch).
// Rodar: node scripts/teste-ajuda.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let ok = 0
const falhas = []
const caso = async (nome, fn) => { try { await fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }
const EMOJI = /\p{Extended_Pictographic}|[\u{2600}-\u{27BF}]/u
const HEX = /#[0-9a-fA-F]{3,8}\b/

const AJUDA = JSON.parse(ler('config/ajuda.json')), V = AJUDA.verbetes
const SIS = JSON.parse(ler('config/sistemas.json')).sistemas.map(s => s.id)
const WEB = readdirSync(RAIZ + 'src/web').filter(f => /\.(html|js)$/.test(f) && f !== 'alerta.js')
const fontes = Object.fromEntries(WEB.map(f => [f, ler('src/web/' + f)]))
const PAGINAS = ['index', 'gmv', 'cliente', 'promocoes', 'analistas', 'planos', 'comercial', 'resultados', 'metodologia', 'processos', 'integracoes'].map(p => p + '.html')

await caso('config/ajuda.json: >= 20 verbetes com os campos do doc, >= 3 passos, concluído quando, doc existente, sem hex nem emoji; os 3 exemplos do doc estão lá', () => {
  const ids = Object.keys(V)
  assert.ok(ids.length >= 20, `verbetes: ${ids.length}`)
  for (const id of ['nf', 'estoque_sync', 'avisos_whatsapp']) assert.ok(V[id], 'exemplo do doc: ' + id)
  for (const t of ['ml', 'notion', 'n8n_whatsapp', 'discord', 'custos_erp', 'canais_cliente', 'relatorio_notion', 'alerta', 'catalogo', 'ficha', 'cadastro_cs', 'executor_chaveiro', 'estoque', 'produto', 'saude_sistema', 'app_ml', 'sprint90', 'backup_frio', 'equipe_papeis']) assert.ok(V[t], 'tema pedido na F2: ' + t)
  for (const [id, v] of Object.entries(V)) {
    assert.match(id, /^[a-z0-9_]{1,40}$/, 'id: ' + id)
    for (const k of ['titulo', 'sistema', 'escopo', 'chave', 'camada', 'concluido_quando', 'doc', 'onde']) assert.ok(typeof v[k] === 'string' && v[k].trim(), `${id}.${k}`)
    assert.ok(SIS.includes(v.sistema), `${id}.sistema fora do catálogo: ${v.sistema}`)
    assert.ok(Array.isArray(v.pre_requisitos) && v.pre_requisitos.length >= 1, `${id}.pre_requisitos`)
    for (const p of v.pre_requisitos) assert.ok(p.texto && p.verificar && /^[a-z0-9_.]+$/.test(p.verificar), `${id}: pré-requisito {texto, verificar}`)
    assert.ok(Array.isArray(v.passos) && v.passos.length >= 3, `${id}: >= 3 passos (${v.passos?.length})`)
    for (const p of v.passos) assert.ok(p.titulo && p.texto && p.quem, `${id}: passo {titulo, texto, quem}`)
    assert.ok(existsSync(RAIZ + v.doc), `${id}.doc não existe no disco: ${v.doc}`)
    assert.match(v.onde, /^\/[a-z]/, `${id}.onde é URL interna`)
    const txt = JSON.stringify(v)
    assert.doesNotMatch(txt, HEX, `${id}: hex`); assert.ok(!EMOJI.test(txt), `${id}: emoji`)
  }
  // o doc § C pede o verbete «nf» com os 8 passos e o «estoque_sync» com os 7, por extenso
  assert.equal(V.nf.passos.length, 8); assert.equal(V.estoque_sync.passos.length, 7); assert.equal(V.avisos_whatsapp.passos.length, 6)
  assert.match(V.nf.chave, /nf\.ligado/); assert.match(V.estoque_sync.chave, /sync_estoque_ligado/); assert.match(V.avisos_whatsapp.chave, /gatilhos_ligado/)
})

await caso('telas: todo data-ajuda tem verbete; botão .btn-icone.btn-ajuda type=button com aria-label «Como fazer: …», fora de h2/h3; /ajuda.js defer nas 11 páginas', () => {
  const usados = new Set(), erros = []
  for (const [f, src] of Object.entries(fontes)) {
    for (const m of src.matchAll(/<button[^>]*data-ajuda="([^"]+)"[^>]*>/g)) {
      const [tag, id] = m; usados.add(id)
      if (!V[id]) erros.push(`${f}: data-ajuda="${id}" sem verbete`)
      if (!/class="btn-icone btn-ajuda"/.test(tag)) erros.push(`${f}: ${id} sem class="btn-icone btn-ajuda"`)
      if (!/type="button"/.test(tag)) erros.push(`${f}: ${id} sem type="button"`)
      if (!/aria-label="Como fazer: [^"]+"/.test(tag)) erros.push(`${f}: ${id} sem aria-label «Como fazer: …»`)
      const antes = src.slice(Math.max(0, m.index - 400), m.index), aberto = antes.lastIndexOf('<h2'), fechado = antes.lastIndexOf('</h2>'), a3 = antes.lastIndexOf('<h3'), f3 = antes.lastIndexOf('</h3>')
      if (aberto > fechado || a3 > f3) erros.push(`${f}: ${id} dentro de h2/h3`)
    }
    for (const m of src.matchAll(/data-ajuda="\$\{/g)) erros.push(`${f}: data-ajuda dinâmico em ${m.index} (o teste só confere ids literais)`)
  }
  assert.deepEqual(erros, [], erros.join('\n'))
  assert.ok(usados.size >= 20, `ids usados nas telas: ${usados.size}`)
  for (const p of PAGINAS) assert.match(fontes[p], /<script src="\/ajuda\.js" defer><\/script>/, p + ' sem /ajuda.js defer')
  for (const id of ['nf', 'estoque_sync', 'avisos_whatsapp']) assert.ok(usados.has(id), 'exemplo do doc sem botão: ' + id)
  assert.ok(/id="secSyncEstoque"><summary>[^<]*<button[^>]*data-ajuda="estoque_sync"/.test(fontes['produtos.js']), 'estoque_sync dentro do summary de #secSyncEstoque')
  assert.ok(/id="secAvisos"><div class="bloco-cab">.*?<small class="sis-papel">[^<]*<\/small><button[^>]*data-ajuda="avisos_whatsapp"/.test(fontes['cliente.js']), 'avisos_whatsapp depois do .sis-papel de #secAvisos')
})

await caso('ajuda.js: node --check, DOM puro (sem innerHTML), delegação [data-ajuda] com preventDefault + stopPropagation, dialog.dlg, GET /api/ajuda/:id, window.PSAjuda.abrir', () => {
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/ajuda.js'])
  const js = fontes['ajuda.js']
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML/)
  assert.match(js, /closest\?\.\('\[data-ajuda\]'\)/); assert.match(js, /e\.preventDefault\(\); e\.stopPropagation\(\)/)
  assert.match(js, /className: 'dlg dlg-ajuda'/); assert.match(js, /showModal\(\)/); assert.match(js, /'\/api\/ajuda\/' \+ encodeURIComponent\(id\)/)
  assert.match(js, /window\.PSAjuda = \{ abrir \}/)
  for (const t of ['Como fazer: ', 'Estado agora: ', 'Pré-requisitos', 'Passo a passo', 'Concluído quando: ', 'Onde configurar', 'Documento: ']) assert.ok(js.includes(t), 'ordem do conteúdo (§ C): ' + t)
  assert.doesNotMatch(js, HEX, 'sem hex'); assert.ok(!EMOJI.test(js.replace(/\/\/.*$/gm, '')), 'sem emoji')
  assert.doesNotMatch(fontes['shell.js'], /\bfetch\(|data-ajuda/, 'o shell não chama API nem desenha o (i)')   // \b: o prefetch() de links do topo não é chamada de API
})

await caso('rotas-ajuda.js: montarVerbete puro com estado sem_leitura (nunca ligado fingido), selo do sistema, id inválido = null; rota montada em server.js após guardaLocal', async () => {
  execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-ajuda.js'])
  const { montarVerbete, VERBETES } = await import('../src/rotas-ajuda.js')
  assert.equal(Object.keys(VERBETES).length, Object.keys(V).length)
  const v = montarVerbete('nf', { cliente: 'Loja X' })
  assert.equal(v.estado.estado, 'sem_leitura'); assert.ok(v.estado.motivo.includes('F3')); assert.equal(v.sistema_nome, 'Smith'); assert.equal(v.sistema_papel, 'financeiro')
  assert.ok(v.pre_requisitos.every(p => p.estado === 'sem_leitura')); assert.equal(v.cliente, 'Loja X'); assert.equal(v.passos.length, 8)
  for (const id of ['', 'x'.repeat(41), '../etc', 'NF', 'nao_existe']) assert.equal(montarVerbete(id), null, 'null para ' + JSON.stringify(id))
  const sv = ler('src/server.js'), r = ler('src/rotas-ajuda.js')
  assert.match(sv, /app\.use\(criarRotasAjuda\(\)\)/); assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasAjuda()'), 'montada depois do guardaLocal')
  assert.match(r, /res\.status\(404\)\.json\(\{ erro: 'verbete desconhecido' \}\)/, 'erro fixo, sem ecoar o id')
})

await caso('ui.css: .btn-ajuda::before por máscara SVG em currentColor, .dlg .passos-ajuda vertical, sem hex fora do :root', () => {
  const css = ler('src/web/ui.css')
  assert.match(css, /\.btn-ajuda::before\{content:"";[^}]*background:currentColor;[^}]*mask:url\("data:image\/svg\+xml/)
  assert.match(css, /\.dlg \.passos-ajuda\{[^}]*display:grid/)
  const fim = css.indexOf('}', css.indexOf(':root{'))
  assert.doesNotMatch(css.slice(fim + 1), /(^|[\s:;,(])#[0-9a-fA-F]{3,8}\b/, 'hex fora do :root')
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-ajuda: ${ok} de ${ok + falhas.length} verificações passaram (${Object.keys(V).length} verbetes)`)
if (falhas.length) { console.error('Falharam: ' + falhas.join(' | ')); process.exit(1) }
