// Teste estático do shell e do sistema de design (spec docs/ux/sistema-de-design.md, 8.3). Sem rede, sem banco, sem DOM.
//  (1) as 11 telas internas têm o esqueleto do shell: data-pagina, placeholder + /shell.js logo após <body>, /ui.css, /alerta.js defer,
//      e nada de styles.css, ui-extra.css, <style> inline ou <header> próprio;
//  (2) todo id de hooks_js dos inventários (docs/ux/inventario-*.json) existe no HTML ou no JS da tela;
//  (3) toda família gerada por dado tem seletor em ui.css, acomp.css ou promocoes.css;
//  (4) em ui.css cada --nome:#hex aparece uma vez e dentro do 1º :root{}; promocoes.css tem :root{ sem hex;
//  (5) node --check em shell.js e shell.js sem innerHTML.
// Rodar: node scripts/teste-shell-ui.mjs — enquanto as telas não forem convertidas, (1) e (2) listam as páginas que faltam e o processo sai com código 1.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
const UI = ler('src/web/ui.css'), ACOMP = ler('src/web/acomp.css'), PR = ler('src/web/promocoes.css'), CSS = UI + '\n' + ACOMP + '\n' + PR
let ok = 0
const falhas = []
const caso = (nome, fn) => { try { fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }

// [html, data-pagina, js da tela, inventário]
const PAGINAS = [
  ['index.html', 'execucao', 'app.js', 'painel-executivo'], ['gmv.html', 'gmv', 'gmv.js', 'gmv'], ['cliente.html', 'cliente', 'cliente.js', 'cliente'],
  ['promocoes.html', 'promocoes', 'promocoes.js', 'promocoes'], ['analistas.html', 'analistas', 'analistas.js', 'analistas'], ['planos.html', 'distribuicao', 'planos.js', 'planos'],
  ['comercial.html', 'comercial', 'comercial.js', 'comercial'], ['resultados.html', 'o-que-funciona', 'resultados.js', 'resultados'], ['metodologia.html', 'algoritmo', 'metodologia.js', 'metodologia'],
  ['processos.html', 'processos', 'processos.js', 'processos'], ['integracoes.html', 'integracoes', 'integracoes.js', 'integracoes'],
]
const COMPARTILHADOS = ['src/web/ficha.js', 'src/web/acomp.js', 'src/web/relatorio.js', 'src/web/pendencias.js', 'src/web/alertas.js', 'src/web/gatilhos.js', 'src/web/alinhamentos.js', 'src/web/dossie.js', 'src/web/perfil-informacao.js', 'src/web/galeria-anuncio.js', 'src/web/produtos.js', 'src/web/executar.js', 'src/web/relatorios-ciclo.js', 'src/web/custos-upload.js', 'src/web/alerta.js', 'src/web/shell.js'].map(ler).join('\n')

// ═════════ (1) esqueleto do shell nas 11 páginas ═════════════════════════════════════════════════════
caso('shell: as 11 páginas têm data-pagina, placeholder + /shell.js, /ui.css, /alerta.js defer e nenhum CSS/header antigo', () => {
  const erros = []
  for (const [html, pagina] of PAGINAS) {
    const h = ler('src/web/' + html), e = []
    if (!new RegExp(`<body[^>]*\\bdata-pagina="${pagina}"`).test(h)) e.push(`data-pagina="${pagina}"`)
    if (!/<body[^>]*>\s*<header class="ps-shell" id="psShell"><\/header>\s*<script src="\/shell\.js"><\/script>/.test(h)) e.push('placeholder #psShell + <script src="/shell.js"> logo após <body>')
    if (!/<link rel="stylesheet" href="\/ui\.css">/.test(h)) e.push('<link href="/ui.css">')
    if (!/<script src="\/alerta\.js" defer>/.test(h)) e.push('/alerta.js com defer')
    if (/styles\.css|ui-extra\.css/.test(h)) e.push('ainda linka styles.css/ui-extra.css')
    if (/<style[\s>]/.test(h)) e.push('<style> inline')
    if ((h.match(/<header\b/g) || []).length !== 1) e.push('<header> além do placeholder')
    if (e.length) erros.push(`${html}: ${e.join('; ')}`)
  }
  assert.deepEqual(erros, [], 'páginas fora do esqueleto:\n' + erros.join('\n'))
})

// ═════════ (2) ids de hooks_js existem ═══════════════════════════════════════════════════════════════
caso('hooks_js: todo id dos inventários existe no HTML ou no JS da tela', () => {
  const erros = []
  for (const [html, , js, inv] of PAGINAS) {
    const fonte = ler('src/web/' + html) + '\n' + ler('src/web/' + js) + '\n' + COMPARTILHADOS
    const hooks = JSON.parse(ler(`docs/ux/inventario-${inv}.json`)).hooks_js || []
    const ids = new Set(hooks.flatMap(h => [...String(h).matchAll(/#([A-Za-z_][\w-]*)/g)].map(m => m[1])))
    // id dinâmico (a_${k}_antes, cuJob-${fonte}, drill-<nome>): vale o prefixo até o separador seguido de ${ no template
    const existe = id => fonte.includes(id) || [...id.matchAll(/[_-]/g)].some(m => fonte.includes(id.slice(0, m.index + 1) + '${'))
    const faltam = [...ids].filter(id => !existe(id))
    if (faltam.length) erros.push(`${html}: #${faltam.join(', #')}`)
  }
  assert.deepEqual(erros, [], 'ids de hooks_js sem rastro:\n' + erros.join('\n'))
})

// ═════════ (3) famílias geradas por dado ═════════════════════════════════════════════════════════════
const FAMILIAS = [
  ...['nao_iniciada', 'andamento', 'validacao', 'concluida', 'bloqueada', 'dependencia_cliente', 'cancelada'].map(v => `.t-${v}`),
  ...['proposta', 'aprovada', 'descartada', 'distribuida', 'obsoleta'].map(v => `.tag.p-${v}`),
  '.p-P0', '.p-P1', '.p-P2', '.p-P3',
  ...['aprovada', 'distribuida', 'descartada', 'proposta'].map(v => `.st-${v}`),
  ...['melhorou', 'piorou', 'sem_efeito', 'em_maturacao', 'sem_base', 'sem_controle', 'variacao_conta', 'lancamento'].map(v => `.e-${v}`),
  ...['queda', 'estagnacao', 'crescimento', 'sem_base'].map(v => `.ac-${v}`),
  '.curva.cA', '.curva.cB', '.curva.cC',
  '.acao-ENTRAR', '.acao-PULAR', '.acao-IGNORAR',
  '.risco-grupo.ok', '.risco-grupo.ruim',
  '.kpi.bom', '.kpi.alerta', '.kpi.risco', '.kpi.ruim',
  ...['bom', 'neutro', 'atencao', 'amb', 'ruim', 'azul'].map(v => `.selo.${v}`),
  ...['bom', 'atencao', 'ruim'].map(v => `.flag.${v}`),
  ...['ok', 'pend', 'erro', 'neutro', 'azul'].map(v => `.s-${v}`),
]
const temSeletor = sel => {
  const partes = sel.slice(1).split('.')   // ".kpi.ruim" → cada classe precisa estar no mesmo seletor; ".kpi:is(.risco,.ruim)" também vale
  const rx = new RegExp(`^[^{}]*\\.${partes[0]}\\b[^{}]*${partes.slice(1).map(p => `\\.${p}\\b`).join('[^{}]*')}[^{}]*\\{`, 'm')
  return rx.test(CSS)
}
caso('famílias: todo valor gerado por dado tem seletor em ui.css, acomp.css ou promocoes.css', () => {
  assert.deepEqual(FAMILIAS.filter(f => !temSeletor(f)), [])
})

// ═════════ (4) tokens únicos, só no 1º :root do ui.css ═══════════════════════════════════════════════
caso('tokens: cada --nome:#hex do ui.css aparece uma vez, dentro do 1º :root{}; promocoes.css tem :root{ sem hex', () => {
  const hexes = [...UI.matchAll(/--([a-z-]+)\s*:\s*#[0-9a-fA-F]{6}/g)]
  const nomes = hexes.map(m => m[1]), repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i)
  assert.deepEqual(repetidos, [], 'token de cor definido mais de uma vez')
  const ini = UI.indexOf(':root{'), fim = UI.indexOf('}', ini)
  assert.ok(ini >= 0 && fim > ini, 'ui.css sem :root{}')
  const fora = hexes.filter(m => m.index < ini || m.index > fim).map(m => m[0])
  assert.deepEqual(fora, [], '--nome:#hex fora do 1º :root (inclui comentários e @media)')
  assert.ok(nomes.length >= 20, `poucos tokens de cor (${nomes.length})`)
  assert.match(PR, /^:root\{/, 'promocoes.css precisa começar com :root{')
  assert.doesNotMatch(PR, /#[0-9a-fA-F]{3,8}\b/, 'promocoes.css com hex')
  assert.doesNotMatch(ACOMP, /#[0-9a-fA-F]{3,8}\b/, 'acomp.css com hex')
  const semRoot = UI.slice(fim + 1)
  assert.doesNotMatch(semRoot, /(^|[\s:;,(])#[0-9a-fA-F]{3,8}\b/, 'ui.css com hex fora do :root')
})

// ═════════ (5) shell.js ══════════════════════════════════════════════════════════════════════════════
caso('shell.js: node --check passa e não usa innerHTML', () => {
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/shell.js'])
  const js = ler('src/web/shell.js')
  assert.doesNotMatch(js, /innerHTML/)
  assert.match(js, /\['execucao', 'Painel executivo', '\/'\]/, 'a aba inicial chama-se "Painel executivo" (decisão do CEO)')
  assert.match(js, /window\.PS = \{/)
})

// ═════════ (6) dependência do cliente: ids, chip e bloco (plano §4) ══════════════════════════════════
caso('dependência do cliente: painel executivo tem #selTodas, #btnDependencia, #nSel, #depResultado e o chip; cliente.js tem #secDependeCliente vivo', () => {
  const html = ler('src/web/index.html'), app = ler('src/web/app.js'), cli = ler('src/web/cliente.js')
  for (const id of ['selTodas', 'btnDependencia', 'nSel', 'depResultado']) assert.ok(html.includes(`id="${id}"`), '#' + id)
  assert.match(html, /data-chip="dependencia_cliente"/)
  assert.match(html, /<thead><tr><th><input type="checkbox" id="selTodas"/, '1ª coluna da tabela é a seleção')
  assert.match(app, /colspan="10"/, 'linha vazia cobre as 10 colunas')
  assert.match(app, /aberta\(t\) \|\| t\.status === 'dependencia_cliente' \? `<input type="checkbox" class="sel"/, 'tarefa já em dependência também recebe checkbox (registrar o motivo das marcadas direto no Notion)')
  assert.match(ler('src/web/tela-execucao.css'), /td:first-child:not\(\[colspan\]\)/, 'a linha vazia (colspan) não herda a largura da coluna de seleção')
  assert.ok((html.match(/btn-primario/g) || []).length === 0 && (app.match(/class="btn btn-primario" data-chip/g) || []).length === 1, 'o único .btn-primario da tela é o da Próxima ação')
  assert.match(app, /confirmar: true/, 'escrita no Notion só com confirmar:true')
  assert.match(cli, /VIVOS = \[[^\]]*'dependencias'/); assert.match(cli, /id="secDependeCliente"/); assert.match(cli, /carregarDependencias\(d\.cliente\)/)
  assert.ok(cli.indexOf('id="secProximas"') < cli.indexOf('id="secDependeCliente"'), 'o bloco vem depois de Próximas ações')
  assert.match(ler('src/web/ui.css'), /\.t-dependencia_cliente/)
})

// ═════════ (6b) cadastro do cliente (aba Configurar) e selo de health score em /planos ═══════════════
caso('cadastro: cliente.js tem a seção #cad-sec com os ids cad-* vivos e botão .btn (não primário); planos.js mostra o HS no .mini com o selo existente', () => {
  const cli = ler('src/web/cliente.js'), pl = ler('src/web/planos.js')
  assert.ok(cli.indexOf('data-painel="configurar"') < cli.indexOf('id="cad-sec"'), '#cad-sec fica na aba Configurar')
  for (const id of ['cad-sec', 'cad-corpo', 'cad-cs', 'cad-hs', 'cad-classe', 'cad-canais', 'cad-obs', 'cad-por', 'cad-salvar', 'cad-msg']) assert.ok(cli.includes(`id="${id}"`), '#' + id)
  assert.match(cli, /VIVOS = \[[^\]]*'cad-corpo'/); assert.match(cli, /carregarCadastro\(d\.cliente\)/); assert.match(cli, /id="cad-salvar">Salvar cadastro</)
  assert.doesNotMatch(cli, /btn btn-primario" type="button" id="cad-salvar"/, 'Salvar cadastro não é primário'); assert.equal((cli.match(/btn-primario/g) || []).length, 1, 'um só .btn-primario na tela')
  assert.match(cli, /confirmar: true/); assert.doesNotMatch(cli, /<h2>Identificação<\/h2>/, 'o bloco antigo foi absorvido pelo cadastro')
  assert.match(pl, /const seloHs = /); assert.match(pl, /\$\{seloHs\(c\)\}\$\{seloRel\(c\.cliente\)\}/, 'selo do HS no .mini da célula do cliente')
  assert.match(pl, /'Risco': 'ruim'/); assert.doesNotMatch(pl, /class="selo [^"]*">HS /, 'o número do HS nunca vai dentro do selo colorido')
  const sec = cli.slice(cli.indexOf('// ── cadastro do cliente (aba Configurar)'), cli.indexOf('// ── anúncios de catálogo (aba Configurar)'))
  assert.ok(sec.length > 500 && /await confirmar\(/.test(sec) && /Informe seu nome/.test(sec), 'bloco do cadastro vem antes do catálogo, com prévia + confirmação e nome obrigatório')
  assert.doesNotMatch(sec, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'sem hex'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sec), 'sem emoji em controle')
  const html = sec.slice(sec.indexOf('alvo.innerHTML = `'), sec.indexOf('const aviso = '))   // só o que vira HTML; o texto da confirmação (fmt, p.n) não é innerHTML
  for (const m of html.matchAll(/\$\{([^}]+)\}/g)) assert.ok(/esc\(|\?|\.map\(|\.join\(/.test(m[1]) || /^(msg|pessoas\(|venc$|hsTxt$|fonte$)/.test(m[1]), 'interpolação sem esc(): ' + m[1])   // pessoas/venc/hsTxt/fonte já saem escapados
})

// ═════════ (7) resultado das tarefas, contadores e cronologia de preços na tela do cliente (plano §1 e §3 "Onde aparece") ═════
caso('cliente: Resultado das tarefas no Resumo após Próximas ações, #nPiorou/#nAnuncios via ps:acomp, #secPrecos após #secAnuncios, Mais vendidos com 12', () => {
  const cli = ler('src/web/cliente.js'), ac = ler('src/web/acomp.js'), inv = ler('docs/ux/inventario-cliente.json')
  const pos = s => { const i = cli.indexOf(s); assert.ok(i >= 0, s); return i }
  assert.ok(pos('data-painel="resumo"') < pos('id="secProximas"') && pos('id="secProximas"') < pos('id="secAcomp"') && pos('id="secAcomp"') < pos('id="secDependeCliente"'), '#secAcomp é o bloco logo depois de Próximas ações, na aba Resumo')
  assert.ok(pos('data-painel="anuncios"') < pos('id="secAnuncios"') && pos('id="secAnuncios"') < pos('id="secPrecos"') && pos('id="secPrecos"') < pos('id="secVendas"'), '#secPrecos logo depois de Anúncios no período')
  assert.match(cli, /<h2>Resultado das tarefas<\/h2>/); assert.match(cli, /<h2>Cronologia de preços<\/h2>/); assert.match(cli, /<h2>Mais vendidos, como o comprador vê<\/h2>/)
  for (const id of ['nPiorou', 'nAnuncios', 'precos']) assert.ok(cli.includes(`id="${id}"`), '#' + id)
  assert.match(cli, /VIVOS = \[[^\]]*'precos'/); assert.match(cli, /carregarPrecos\(d\.cliente\)/); assert.match(cli, /carregarAcomp\(cliente\); carregarPrecos\(cliente\)/, 'atualizarDadosML recarrega a cronologia')
  assert.match(cli, /addEventListener\('ps:acomp'/); assert.match(ac, /new CustomEvent\('ps:acomp'/)
  assert.match(ac, /limite=120/); assert.match(ac, /const PAG_ACOMP = 8/); assert.match(ac, /class="ac-veredito"/); assert.match(ac, /ponto = mudança no anúncio/)
  assert.match(cli, /const MOSTRA = 12/); assert.match(cli, /class="flag bom">sem alertas nos dados disponíveis/); assert.match(cli, /★ /)
  assert.equal((cli + ac).match(/btn-primario/g).length, 1, 'um só .btn-primario na tela (Revisar plano)')
  for (const id of ['nPiorou', 'nAnuncios', 'secPrecos', 'precos']) assert.ok(inv.includes('#' + id), 'inventário sem #' + id)
})

// ═════════ (8) folha do anúncio no Resumo (plano "Folha única do anúncio" §5 + decisões 2 e 3 de 08/10) ═════════════════════
caso('cliente: Folha do anúncio entre Resultado das tarefas e Depende do cliente; caixas lembradas por cliente e em ?folha=; apresentação na 1ª abertura; CSV pela rota; toggle de coleta de promoções em Configurar; aviso em Promoções', () => {
  const cli = ler('src/web/cliente.js'), css = ler('src/web/tela-cliente.css'), inv = ler('docs/ux/inventario-cliente.json'), flt = ler('src/web/filtros.js'), pr = ler('src/web/promocoes.js')
  const pos = s => { const i = cli.indexOf(s); assert.ok(i >= 0, s); return i }
  assert.ok(pos('id="secAcomp"') < pos('id="secFolha"') && pos('id="secFolha"') < pos('id="secDependeCliente"'), '#secFolha entre #secAcomp e #secDependeCliente (decisão 4)')
  assert.match(cli, /<h2>Folha do anúncio <span class="badge" id="nFolha">/)
  for (const id of ['folha', 'folhaCaixas', 'btnFolhaTudo', 'fltFolha', 'folhaOrdem', 'btnFolhaCsv', 'folhaResumo', 'folhaCorpo', 'pfPromocoes']) assert.ok(cli.includes(`id="${id}"`), '#' + id)
  assert.match(cli, /<input type="checkbox" data-topico="\$\{k\}"/, '4 caixas nativas'); assert.match(cli, /FOLHA_BLOCOS = \[\['anuncios', 'Anúncios — ofertas e promoções'\], \['ads', 'Ads'\], \['full', 'Full'\], \['metricas', 'Métricas'\]\]/)
  assert.match(cli, /VIVOS = \[[^\]]*'folha'/); assert.match(cli, /carregarFolha\(d\.cliente\)/); assert.match(cli, /carregarPrecos\(cliente\); carregarFolha\(cliente\)/, 'atualizarDadosML recarrega a folha')
  assert.match(cli, /'ps_folha:' \+ c/); assert.match(cli, /try \{ return localStorage\.getItem\(chaveFolha\(c\)\) \} catch/, 'localStorage com try/catch'); assert.match(cli, /searchParams\.set\('folha', lista\)/, 'espelhada em ?folha=')
  assert.match(cli, /parametro: 'ff'/); assert.match(flt, /parametro = 'f'/, 'PSFiltros.montar aceita o nome do parâmetro na URL (a folha usa ff; o f continua o de Anúncios no período)')
  assert.match(cli, /prefers-reduced-motion: reduce/); assert.match(cli, /1500 \* \(i \+ 1\)/, 'apresentação: ~1,5 s por caixa, Anúncios → Ads → Full'); assert.match(cli, /\['pointerdown', 'keydown'\]\) \$\('folha'\)\.addEventListener\(ev, pararApresentacao, \{ capture: true, once: true \}\)/, 'qualquer clique ou tecla no bloco inteiro (caixas, ordem, filtro, Ver tudo, links) interrompe a apresentação')
  assert.match(cli, /F\.cont = \{\}; atualizarControlesFolha\(\)/, 'filtro novo zera os contadores das caixas (são do recorte)')
  assert.match(cli, /<legend>Marque os tópicos que quer ver na folha<\/legend>/); assert.match(cli, /class="btn btn-p" type="button" id="btnFolhaTudo" hidden>Marcar tudo e ver a leitura</)
  assert.match(cli, /'\/api\/cliente\/folha\.csv\?' \+ q/); assert.match(cli, /Baixar a folha \(com filtros e tópicos marcados\)/)
  assert.match(cli, /<th scope="col">Anúncio<\/th>/); assert.match(cli, /aria-controls="\$\{det\}"/); assert.match(cli, /table class="t empilha folha"/); assert.match(cli, /elo-t fato/); assert.match(cli, /elo-t hipotese/)
  assert.match(cli, /data-ir-folha>ver na Folha do anúncio<\/a>/, '"Anúncios no período" ganha o link; nada é removido'); assert.match(cli, /<h2>Anúncios no período<\/h2>/)
  assert.match(cli, /coleta_promocoes: pv === 'sim' \? true : pv === 'nao' \? false : null/, 'toggle de coleta gravado via POST /api/cliente/perfil, no padrão do override de tarefas no relatório')
  assert.equal((cli + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'um só .btn-primario na tela (Revisar plano)')
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(cli.slice(cli.indexOf('const FOLHA_BLOCOS'), cli.indexOf('// ── cronologia de preços'))), 'sem emoji na folha')
  assert.match(css, /\.folha-caixas label\{[^}]*min-height:44px/, 'área de toque de 44px'); assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'tela-cliente.css só com tokens')
  for (const h of ['#secFolha', '#folha', '[data-topico]', '#btnFolhaTudo', '#folhaOrdem', '#btnFolhaCsv', 'ps_folha:', '?folha=', '#pfPromocoes']) assert.ok(inv.includes(h), 'inventário sem ' + h)
  assert.match(pr, /coleta_ligada === false/); assert.match(pr, /Coleta desligada para este cliente/); assert.match(pr, /aba=configurar/)
})

// ═════════ (9) relatório curto ao Notion do cliente (plano de 08/10/2026) ═══════════════════════════════════
caso('relatório ao Notion: botão de envio antecipado secundário e visível em /planos, seção de programação com 6 colunas, envio imediato e frequência na ficha do cliente; relatorio.js sem primário estático nem emoji em controle', () => {
  const pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), cl = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), rj = ler('src/web/relatorio.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/relatorio.js'])
  assert.match(pl, /<button type="button" class="btn" id="btnRelAntecipar"[^>]*>Enviar relatório antecipadamente<\/button>/, 'botão visível e secundário (.btn), fora do menu ⋯')
  assert.ok(pl.indexOf('id="btnRelAntecipar"') < pl.indexOf('id="lnkCsv"'), 'ao lado do CSV do escopo')
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só .btn-primario em /planos (#btnDistribuir)'); assert.match(pl, /class="btn btn-primario" id="btnDistribuir"/)
  assert.ok(pl.indexOf('id="secClientes"') < pl.indexOf('id="secRelatorios"') && pl.indexOf('id="secRelatorios"') < pl.indexOf('id="secGargalos"'), '#secRelatorios depois de #secClientes')
  const tab = pl.slice(pl.indexOf('id="secRelatorios"'), pl.indexOf('id="secAlertas"') > 0 ? pl.indexOf('id="secAlertas"') : pl.indexOf('id="secGargalos"'))
  assert.equal((tab.match(/<th>/g) || []).length, 6, 'tabela de programação com 6 colunas')
  assert.match(pl, /<script src="relatorio\.js"><\/script>\s*(<script src="alertas\.js"><\/script>\s*)?(<script src="dossie\.js"><\/script>\s*)?(<script src="perfil-informacao\.js"><\/script>\s*)?<script src="\/filtros\.js"><\/script>\s*<script src="planos\.js"><\/script>/, 'relatorio.js (e alertas.js, dossie.js) antes de planos.js')
  assert.match(cl, /<script src="relatorio\.js"><\/script>\s*(<script src="pendencias\.js"><\/script>\s*)?(<script src="alertas\.js"><\/script>\s*)?(<script src="dossie\.js"><\/script>\s*)?(<script src="perfil-informacao\.js"><\/script>\s*)?<script src="cliente\.js"><\/script>/, 'relatorio.js antes de cliente.js (pendencias.js, alertas.js e dossie.js podem ficar entre os dois)')
  assert.match(plj, /\['btnGerar', 'btnPrevia', 'btnDistribuir', 'btnRelAntecipar'\]/, 'travar() congela o botão durante um job')
  assert.match(plj, /<td data-eq="\$\{esc\(c\.cliente\)\}"><span class="mini">/, 'o contador continua o 1º filho de td[data-eq]'); assert.match(plj, /data-rel-cliente=/)
  assert.doesNotMatch(plj, /class="[^"]*\bsel\b[^"]*"[^>]*data-rel|data-rel[^>]*class="[^"]*\bsel\b/, 'a classe .sel é das caixas de ações')
  assert.match(clj, /<button type="button" id="btnRelatorioAgora"/); assert.match(clj, /id="secRelatorio"[^>]*>.*id="relatorio"/s)
  assert.ok(clj.indexOf('id="secPerfil"') > clj.indexOf('id="secRelatorio"'), 'seção do relatório na aba Configurar')
  assert.match(clj, /VIVOS = \[[^\]]*'relatorio'/); assert.match(clj, /PSRelatorio\?\.montarConfig\(\$\('relatorio'\), d\.cliente\)/)
  assert.equal((clj.match(/btn-primario/g) || []).length, 1, 'cliente.js continua com um só primário (Revisar plano)')
  for (const id of ['relFreq', 'relProximo', 'btnSalvarRelatorio']) assert.ok(rj.includes(`id="${id}"`), '#' + id)
  assert.match(rj, /nome \(líder ou consultor/i, 'pede o nome de quem envia'); assert.match(rj, /confirmar: true, previa_id: r\.previa_id/, 'confirmar só com a prévia vista')
  assert.doesNotMatch(rj, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'relatorio.js só com tokens'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(rj.replace(/↗/g, '')), 'sem emoji em controle')
  const inv = ler('docs/ux/inventario-planos.json') + ler('docs/ux/inventario-cliente.json')
  for (const h of ['#btnRelAntecipar', '#secRelatorios', '#tbRelatorios', '#btnRelatorioAgora', '#secRelatorio', '#relFreq']) assert.ok(inv.includes(h), 'inventário sem ' + h)
})

// ═════════ (10) pendências do cliente por canal no Resumo (plano de 08/10/2026, "NOVO PEDIDO") ═══════════════════
caso('cliente: pendências do cliente por canal no Resumo (#pendencias dentro de #secDependeCliente, faixa de alerta antes das Próximas ações, registro manual), sem segundo primário, sem hex nem emoji em controle', () => {
  const cl = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), pj = ler('src/web/pendencias.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/pendencias.js'])
  assert.match(cl, /<script src="relatorio\.js"><\/script>\s*<script src="pendencias\.js"><\/script>\s*(<script src="alertas\.js"><\/script>\s*)?(<script src="dossie\.js"><\/script>\s*)?(<script src="perfil-informacao\.js"><\/script>\s*)?<script src="cliente\.js"><\/script>/, 'pendencias.js depois de relatorio.js (que exporta PSRelatorio.ui) e antes de cliente.js')
  assert.ok(clj.indexOf('id="faixaPendencias"') < clj.indexOf('id="secProximas"'), 'a faixa de alerta vem antes de Próximas ações')
  const sec = clj.slice(clj.indexOf('id="secDependeCliente"'), clj.indexOf('Motor de decisão'))
  assert.ok(sec.indexOf('id="pendencias"') > 0 && sec.indexOf('id="pendencias"') < sec.indexOf('id="dependencias"'), '#pendencias acima da lista de tarefas, dentro da mesma seção')
  assert.match(clj, /VIVOS = \[[^\]]*'pendencias', 'faixaPendencias'/)
  assert.match(clj, /PSPendencias\?\.montar\(\$\('pendencias'\), d\.cliente, \{ faixa: \$\('faixaPendencias'\)\}\)/)
  assert.equal((clj.match(/btn-primario/g) || []).length, 1, 'cliente.js continua com um só primário (Revisar plano)')
  assert.match(pj, /\/api\/cliente\/pendencias\?cliente=/); assert.match(pj, /\/api\/pendencias\/registrar/); assert.match(pj, /\/api\/pendencias\/resolver/)
  assert.match(pj, /Impacto não estimado/, 'sem base o impacto aparece como não estimado, nunca como valor inventado')
  assert.match(pj, /confirmar: true/, 'registrar e resolver só com prévia e confirmação')
  assert.doesNotMatch(pj, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'pendencias.js só com tokens'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(pj), 'sem emoji')
  const inv = ler('docs/ux/inventario-cliente.json')
  for (const h of ['#faixaPendencias', '#pendencias', '#btnRegistrarPendencia', 'pendencias.js']) assert.ok(inv.includes(h), 'inventário sem ' + h)
})

// ═════════ (11) anúncio de catálogo: selo em todas as telas da tabela D do mapa e a marcação na aba Configurar (mapa de 08/10/2026) ═════════
caso('cliente: selo de Catálogo (.selo.azul, sem CSS novo) nas telas, seção #secCatalogo em Configurar (contêiner vivo, ids, um só primário), rota montada, sem hex nem emoji', () => {
  const cli = ler('src/web/cliente.js'), ac = ler('src/web/acomp.js'), of = ler('src/web/ofertas.js'), pr = ler('src/web/promocoes.js'), srv = ler('src/server.js'), inv = ler('docs/ux/inventario-cliente.json')
  for (const f of ['cliente.js', 'acomp.js', 'ofertas.js', 'promocoes.js']) execFileSync(process.execPath, ['--check', RAIZ + 'src/web/' + f])
  // helper único ao lado de imgAnuncio: HTML constante (nenhum dado interpolado), tooltip e rótulos do pedido do David
  const h = ac.slice(ac.indexOf('const seloCatalogo'), ac.indexOf('const svgSeguro'))
  assert.ok(ac.indexOf('const imgAnuncio') < ac.indexOf('const seloCatalogo'), 'seloCatalogo fica ao lado de imgAnuncio')
  assert.match(h, /class="selo azul"[^>]*title="Conteúdo controlado pelo catálogo do Mercado Livre: foto, título e descrição não são alterados pelo vendedor">Catálogo</)
  assert.match(h, /class="selo azul"[^>]*title="Catálogo próprio: o conteúdo muda por sugestão de correção, com revisão do Mercado Livre">Catálogo próprio</)
  assert.doesNotMatch(h, /\$\{/, 'o selo é constante: nada de dado do servidor dentro dele'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(h), 'sem emoji no selo')
  assert.ok(temSeletor('.selo.azul'), 'o selo reaproveita .selo.azul de ui.css')
  // onde aparece: Mais vendidos, Anúncios no período, Folha, Cronologia, Plano por anúncio (cliente.js); cartões de tarefa e 80/20 (acomp.js); Ofertas; Promoções (vínculo de custo)
  assert.ok((cli.match(/seloCatalogo\(/g) || []).length >= 5, 'cliente.js: Mais vendidos, Anúncios, Folha, Cronologia e Plano por anúncio')
  assert.ok((ac.match(/seloCatalogo\(/g) || []).length >= 3, 'acomp.js: queda, 80/20 e cartão da tarefa'); assert.match(of, /seloCatalogo\(i\.catalogo_origem\)/); assert.match(pr, /hSelo\(a\.catalogo_origem\)/)
  // seção de Configurar: contêiner vivo, ids do inventário, nome + prévia + confirmação, um só primário
  const sec = cli.slice(cli.indexOf('// ── anúncios de catálogo (aba Configurar)'), cli.indexOf('async function carregarPerfil'))
  assert.ok(sec.length > 500, 'bloco do catálogo não encontrado antes de carregarPerfil (teste-semanal-rotas lê o arquivo a partir de desenharPerfil)')
  assert.match(cli, /VIVOS = \[[^\]]*'catalogo'/); assert.match(cli, /id="secCatalogo"/); assert.match(cli, /carregarCatalogo\(d\.cliente\)/); assert.match(cli, /carregarFolha\(cliente\); carregarCatalogo\(cliente\)/, 'atualizarDadosML recarrega a contagem')
  assert.ok(cli.indexOf('id="secPerfil"') < cli.indexOf('id="secCatalogo"') && cli.indexOf('id="secCatalogo"') < cli.indexOf('id="cad-sec"'), '#secCatalogo é um bloco da aba Configurar')
  for (const id of ['catalogo', 'catProprio', 'catPor', 'btnCatalogo', 'catMsg', 'catItem', 'catOrigem', 'btnCatItem']) assert.ok(sec.includes(`id="${id}"`) || cli.includes(`id="${id}"`), '#' + id)
  assert.match(sec, /Os anúncios de catálogo desta conta são próprios \(marca\/dono do produto\)/); assert.match(sec, /N anúncios|anúncios de catálogo \(<b>\$\{intPt\(r\.ativos\)\}<\/b> ativos\)/, '"N anúncios de catálogo (M ativos)"')
  assert.match(sec, /\/api\/cliente\/catalogo/); assert.match(sec, /\/api\/anuncio\/catalogo-origem/); assert.match(sec, /confirmar: true/, 'só grava com confirmar:true depois da prévia'); assert.match(sec, /await confirmar\(/, 'confirmação com o texto da prévia')
  assert.match(sec, /Informe seu nome/, 'nome do líder/consultor obrigatório')
  assert.equal((cli.match(/btn-primario/g) || []).length, 1, 'cliente.js continua com um só primário (Revisar plano); a seção usa .btn')
  assert.doesNotMatch(sec, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'sem hex'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sec), 'sem emoji em controle')
  for (const m of sec.matchAll(/\$\{([^}]+)\}/g)) assert.ok(/esc\(|intPt\(|\?|\.map\(|\.join\(/.test(m[1]) || /^(msg|aviso|ROT)/.test(m[1]), 'interpolação sem esc(): ' + m[1])
  // rota montada no servidor e hooks no inventário
  assert.match(srv, /criarRotasCatalogo\(\{ catalogo: criarCatalogo\(db,/); assert.ok(srv.indexOf('app.use(guardaLocal)') < srv.indexOf('app.use(criarRotasCatalogo'), 'montada depois do guardaLocal')
  for (const h2 of ['#secCatalogo', '#catProprio', '#btnCatalogo', '#catPor', '[data-cat-tirar]', '#btnCatItem', 'seloCatalogo']) assert.ok(inv.includes(h2), 'inventário sem ' + h2)
})

// ═════════ (12) alertas ao cliente (plano de 08/10/2026, item G) ═══════════════════════════════════════════
caso('alertas ao cliente: seção #secAlertas em /planos (5 colunas, interruptor, envio com prévia), #alertasCliente no Resumo, alertas.js depois de relatorio.js, um só primário, sem hex nem emoji', () => {
  const pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), cl = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), aj = ler('src/web/alertas.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/alertas.js'])
  assert.match(cl, /<script src="relatorio\.js"><\/script>\s*<script src="pendencias\.js"><\/script>\s*<script src="alertas\.js"><\/script>/, 'alertas.js depois de relatorio.js (que exporta PSRelatorio.ui)')
  assert.ok(pl.indexOf('id="secRelatorios"') < pl.indexOf('id="secAlertas"') && pl.indexOf('id="secAlertas"') < pl.indexOf('id="secGargalos"'), '#secAlertas entre #secRelatorios e #secGargalos')
  const tab = pl.slice(pl.indexOf('id="secAlertas"'), pl.indexOf('id="secGargalos"'))
  assert.equal((tab.match(/<th>/g) || []).length, 5, 'tabela de alertas com 5 colunas'); assert.ok(tab.includes('id="tbAlertas"') && tab.includes('id="btnAlertaAuto"'))
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só primário em /planos')
  assert.match(plj, /PSAlertas\.montarTabela\(\)/)
  assert.ok(clj.indexOf('id="pendencias"') < clj.indexOf('id="alertasCliente"') && clj.indexOf('id="alertasCliente"') < clj.indexOf('id="dependencias"'), '#alertasCliente entre as pendências e a lista de tarefas')
  assert.match(clj, /VIVOS = \[[^\]]*'alertasCliente'/); assert.match(clj, /PSAlertas\?\.montarResumo\(\$\('alertasCliente'\), d\.cliente\)/)
  assert.equal((clj.match(/btn-primario/g) || []).length, 1, 'cliente.js continua com um só primário')
  for (const u of ['/api/alertas/enviar', '/api/alertas/pendentes', '/api/alertas/cliente', '/api/alertas/agendador']) assert.ok(aj.includes(u), u)
  assert.match(aj, /confirmar: true, previa_id: r\.previa_id/, 'enviar só com a prévia vista'); assert.match(aj, /pedirPor/, 'o interruptor pede o nome de quem liga')
  assert.doesNotMatch(aj, /#[0-9a-fA-F]{3,8}(?![\w-])/, 'alertas.js só com tokens'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(aj.replace(/↗/g, '')), 'sem emoji em controle')
  const inv = ler('docs/ux/inventario-planos.json') + ler('docs/ux/inventario-cliente.json')
  for (const h of ['#secAlertas', '#tbAlertas', '#btnAlertaAuto', '#alertasCliente', 'alertas.js']) assert.ok(inv.includes(h), 'inventário sem ' + h)
})

// ═════════ (13) Place Sprint 90: bloco "Assinantes Sprint 90" em /integracoes (F1, 08/10/2026) — sem 12ª tela no shell ═════════
caso('integracoes: bloco #secS90 (lista, link de acesso, situação, criação com prévia + confirmar), sem novo primário, sem hex nem emoji, ids existentes intactos', () => {
  const h = ler('src/web/integracoes.html'), j = ler('src/web/integracoes.js'), inv = ler('docs/ux/inventario-integracoes.json'), sh = ler('src/web/shell.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/integracoes.js'])
  assert.ok(h.indexOf('id="secLista"') < h.indexOf('id="secS90"') && h.indexOf('id="secS90"') < h.indexOf('id="secConfig"'), '#secS90 entre a lista de clientes e a configuração técnica')
  for (const id of ['secS90', 'subS90', 's90Corpo', 's90Quem', 's90LinkBox', 's90Link', 's90Copiar', 's90Msg', 's90Nova', 's90Form']) assert.ok(h.includes(`id="${id}"`), '#' + id)
  for (const id of ['btnLinksCsv', 'tb', 'custosPainel', 'dlgSegredo', 'proximaBtn']) assert.ok(h.includes(`id="${id}"`), 'id existente intacto: #' + id)
  assert.equal((h.match(/btn-primario/g) || []).length, 1, 'continua um só .btn-primario na tela (Próxima ação)'); assert.doesNotMatch(j, /btn-primario/)
  const bloco = j.slice(j.indexOf('// <s90>'), j.indexOf('// </s90>'))
  assert.ok(bloco.length > 1000, 'bloco <s90> no integracoes.js')
  for (const u of ['/api/sprint90/contas', '/acesso', '/estado']) assert.ok(bloco.includes(u), u)
  assert.match(bloco, /confirmar: true/, 'só cria com confirmar:true depois da prévia'); assert.match(bloco, /await confirmar\(/, 'confirmação pelo PS.confirmar'); assert.match(bloco, /por: s90Quem\(\)/, 'nome de quem faz')
  assert.match(bloco, /r\.status === 404/, 'sem SPRINT90_PUBLIC_HOST o bloco diz que está desligado')
  assert.doesNotMatch(bloco + h.slice(h.indexOf('id="secS90"'), h.indexOf('id="secConfig"')), /#[0-9a-fA-F]{3,8}(?![\w-])|style=/, 'só tokens, sem style inline')
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloco), 'sem emoji em controle'); assert.doesNotMatch(bloco, /\balert\(|\bprompt\(/)
  const linha = bloco.slice(bloco.indexOf('const hS90Linha'), bloco.indexOf('async function carregarS90'))
  for (const m of linha.matchAll(/\$\{([^{}`]+)\}/g)) assert.ok(/^(esc|s90Reais)\(|\?|^menu$/.test(m[1].trim()), 'linha da tabela: interpolação sem esc(): ' + m[1])
  assert.ok(!/sprint ?90|s90/i.test(sh), 'sem 12ª tela: o shell não ganhou aba do Sprint 90')
  for (const hk of ['#secS90', '#s90Corpo', '#s90Form']) assert.ok(inv.includes(hk), 'inventário sem ' + hk)
})

// ═════════ (14) Chaveiro F1: cobertura de execução do plano (só leitura) na tela do cliente e caminho em /planos ═════════
caso('chaveiro F1: #secChaveiro logo depois de #secProximas com #chvVeredito e #chvTabela (6 colunas), contêiner vivo, sem primário novo, selo existente; /planos mostra o caminho no .mini da ação; rota montada', () => {
  const cli = ler('src/web/cliente.js'), pl = ler('src/web/planos.js'), inv = ler('docs/ux/inventario-cliente.json'), invP = ler('docs/ux/inventario-planos.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/cliente.js']); execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-chaveiro.js'])
  const iP = cli.indexOf('id="secProximas"'), iC = cli.indexOf('id="secChaveiro"'), iA = cli.indexOf('id="secAcomp"')
  assert.ok(iP > 0 && iP < iC && iC < iA, '#secChaveiro entre #secProximas e #secAcomp')
  assert.match(cli, /VIVOS = \[[^\]]*'chaveiro'/); assert.match(cli, /carregarChaveiro\(d\.cliente\)/); assert.match(cli, /'\/api\/cliente\/execucao\?cliente=' \+ encodeURIComponent\(cliente\)/)
  const bloco = cli.slice(cli.indexOf('// ── execução do plano (Chaveiro F1'), cli.indexOf('// ── saúde da conta (gravada'))   // o bloco seguinte é a Saúde da conta
  assert.ok(bloco.length > 800, 'bloco do Chaveiro no cliente.js')
  for (const id of ['chvVeredito', 'chvTabela']) assert.ok(bloco.includes(`id="${id}"`), '#' + id)
  assert.equal((bloco.match(/<th scope="col">/g) || []).length, 6, 'tabela com 6 colunas')
  assert.equal((bloco.match(/\$\{kp\('/g) || []).length, 4, 'no máximo 4 KPIs'); assert.match(bloco, /<div class="kpi"><div class="rotulo">/, 'KPI nunca colorido')
  assert.match(bloco, /erroBloco\(alvo, e, \(\) => carregarChaveiro\(cliente\)\)/, 'erro com Tentar de novo')
  assert.match(cli, /A execução fica na aba Executar: «Executar pelo Chaveiro» abre o console já preenchido\./, 'sub honesto (F4+: a escrita mora na aba Executar)')
  assert.doesNotMatch(bloco, /btn-primario|#[0-9a-fA-F]{3,8}(?![\w-])|style=/, 'sem primário, hex ou style inline'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloco), 'sem emoji')
  assert.equal((cli + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'um só .btn-primario na tela (Revisar plano)')
  for (const cls of ['bom', 'azul', 'atencao', 'neutro']) assert.match(ler('src/web/ui.css'), new RegExp('\\.selo\\.' + cls), 'selo existente: ' + cls)
  for (const hk of ['#secChaveiro', '#chvVeredito', '#chvTabela']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
  assert.match(pl, /caminho: \$\{esc\(CAMINHO_ROTULO\[a\.caminho\] \|\| 'sem caminho'\)\}<\/div>/, 'caminho no .mini da célula Ação (sem 8ª coluna)')
  assert.equal((ler('src/web/planos.html').match(/<th>Ação<\/th>/g) || []).length, 1); assert.ok(invP.includes('caminho:'), 'inventário de planos sem o caminho')
  assert.match(ler('src/rotas-planos.js'), /caminho: a\.dados\.execucao\?\.caminho \|\| null/, '/api/planos/acoes devolve caminho')
  assert.match(sv, /app\.use\(rotasChaveiro\)/); assert.match(ler('src/rotas-chaveiro.js'), /import \{ cobertura, CFG \} from '\.\/lib\/chaveiro\.js'/)
})

// ═════════ (15) Saúde da conta gravada (fase 1): #secSaude logo depois de #secChaveiro, 4 KPIs sem cor, tabela de 6 colunas, "Atualizar agora" secundário, rota montada ═════════
caso('saúde da conta: #secSaude entre #secChaveiro e #secAcomp com #sauKpis (4 KPIs) e #sauTabela (6 colunas), contêiner vivo, botão secundário, pendente com motivo, sem primário/hex/emoji; inventário; rota e etapa da coleta montadas', () => {
  const cli = ler('src/web/cliente.js'), inv = ler('docs/ux/inventario-cliente.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-saude.js'])
  const iC = cli.indexOf('id="secChaveiro"'), iS = cli.indexOf('id="secSaude"'), iA = cli.indexOf('id="secAcomp"')
  assert.ok(iC > 0 && iC < iS && iS < iA, '#secSaude entre #secChaveiro e #secAcomp')
  assert.match(cli, /VIVOS = \[[^\]]*'saude'/); assert.match(cli, /carregarSaude\(d\.cliente\)/); assert.match(cli, /'\/api\/cliente\/saude\?cliente=' \+ encodeURIComponent\(cliente\)/)
  const bloco = cli.slice(cli.indexOf('// ── saúde da conta (gravada'), cli.indexOf('// ── Notion do cliente (Resumo, recolhido)'))
  assert.ok(bloco.length > 800, 'bloco da saúde no cliente.js')
  for (const id of ['sauVeredito', 'sauKpis', 'sauTabela', 'btnSaudeAtualizar']) assert.ok(bloco.includes(`id="${id}"`), '#' + id)
  assert.equal((bloco.match(/<th scope="col">/g) || []).length, 6, 'tabela com 6 colunas')
  assert.equal((bloco.match(/\$\{kp\('/g) || []).length, 4, 'no máximo 4 KPIs'); assert.match(bloco, /<div class="kpi"><div class="rotulo">/, 'KPI nunca colorido')
  assert.match(bloco, /'pendente'/, 'KPI mostra "pendente" quando o sinal não foi lido'); assert.match(bloco, /tx\[motivo\(k\)\]/, 'motivo vem do texto fixo do servidor')
  assert.match(bloco, /<button class="btn" type="button" id="btnSaudeAtualizar">Atualizar agora<\/button>/, 'botão secundário'); assert.match(bloco, /\/api\/cliente\/saude\/atualizar/)
  assert.match(bloco, /erroBloco\(alvo, e, \(\) => carregarSaude\(cliente\)\)/, 'erro com Tentar de novo')
  assert.match(cli, /Nada é respondido ou despachado por esta tela\./, 'sub honesto')
  assert.doesNotMatch(bloco, /btn-primario|#[0-9a-fA-F]{3,8}(?![\w-])|style=/, 'sem primário, hex ou style inline'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloco), 'sem emoji')
  for (const hk of ['#secSaude', '#sauKpis', '#sauTabela', '#btnSaudeAtualizar']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
  assert.match(sv, /app\.use\(rotasSaude\)/); assert.match(sv, /coletarSaudeTodos\(\{ tetoMs/, 'etapa da coleta diária com teto de tempo')
  assert.match(ler('src/lib/db.js'), /db\.exec\(SCHEMA_SAUDE\)/)
})

// ═════════ (16) Avisos ao cliente (gatilhos, F1+F2): #secAvisos em Configurar, #secGatilhos no Resumo, #secAvisosAuto em /planos; gatilhos.js depois de alertas.js; sem primário novo ═════════
caso('avisos ao cliente: #secGatilhos (Resumo, antes de #secNotion; 4 KPIs sem cor, 6 colunas), #secAvisos (Configurar, depois de #cad-sec), #secAvisosAuto em /planos (6 colunas, depois de #secGargalos), gatilhos.js após alertas.js, sem primário/hex/emoji; inventários; rotas e timer montados', () => {
  const cli = ler('src/web/cliente.js'), ch = ler('src/web/cliente.html'), pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), gj = ler('src/web/gatilhos.js'), inv = ler('docs/ux/inventario-cliente.json'), invP = ler('docs/ux/inventario-planos.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/gatilhos.js']); execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-gatilhos.js'])
  const iD = cli.indexOf('id="secDependeCliente"'), iG = cli.indexOf('id="secGatilhos"'), iN = cli.indexOf('id="secNotion"'), iCad = cli.indexOf('id="cad-sec"'), iAv = cli.indexOf('id="secAvisos"')
  assert.ok(iD > 0 && iD < iG && iG < iN, '#secGatilhos entre #secDependeCliente e #secNotion'); assert.ok(iCad > 0 && iCad < iAv, '#secAvisos depois de #cad-sec em Configurar')
  assert.match(cli, /VIVOS = \[[^\]]*'gatilhos'[^\]]*'avisos'/); assert.match(cli, /PSGatilhos\?\.montarResumo\(\$\('gatilhos'\), d\.cliente\); window\.PSGatilhos\?\.montarConfig\(\$\('avisos'\), d\.cliente\)/)
  assert.match(ch, /<script src="gatilhos\.js"><\/script>\s*<script src="relatorio\.js"><\/script>/, 'gatilhos.js antes de relatorio.js (a ordem relatorio → pendencias → alertas → cliente fica intacta; PSRelatorio.ui é lido só na hora do clique)')
  assert.match(pl, /<script src="gatilhos\.js"><\/script>\s*<script src="relatorio\.js"><\/script>/); assert.match(plj, /PSGatilhos\.montarPlanos\(\)/)
  assert.ok(pl.indexOf('id="secGargalos"') < pl.indexOf('id="secAvisosAuto"'), '#secAvisosAuto depois de #secGargalos (a fatia #secAlertas→#secGargalos continua com 5 colunas)')
  const sec = pl.slice(pl.indexOf('id="secAvisosAuto"'), pl.indexOf('</main>')); assert.equal((sec.match(/<th>/g) || []).length, 6, 'tabela de avisos com 6 colunas')
  for (const id of ['nAvisosAuto', 'avResumo', 'avAutoEstado', 'btnGatilhosAuto', 'avLiberados', 'tbAvisosFalhas']) assert.ok(sec.includes(`id="${id}"`), '#' + id)
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só primário em /planos'); assert.equal((cli + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário')
  assert.doesNotMatch(gj, /btn-primario|#[0-9a-fA-F]{3,8}(?![\w-])|style=/, 'gatilhos.js sem primário, hex ou style inline'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(gj), 'sem emoji em controle')
  assert.equal((gj.match(/\$\{kp\('/g) || []).length, 4, 'no máximo 4 KPIs'); assert.match(gj, /<div class="kpi"><div class="rotulo">/, 'KPI nunca colorido'); assert.equal((gj.match(/<th scope="col">/g) || []).length, 6, 'tabela do Resumo com 6 colunas')
  assert.match(gj, /confirmar: true, tipo, hash: r\.hash/, 'enviar só com a prévia vista (hash)'); assert.match(gj, /pedirPor/, 'a chave pede o nome de quem liga'); assert.match(gj, /data-testar/, 'Testar canal por canal')
  for (const u of ['/api/cliente/gatilhos', '/api/cliente/notificacao', '/api/gatilhos/previa', '/api/gatilhos/enviar', '/api/gatilhos/teste', '/api/gatilhos/liberar', '/api/gatilhos/chave', '/api/gatilhos/pendentes']) assert.ok(gj.includes(u), u)
  for (const hk of ['#secGatilhos', '#gtKpis', '#gtTabela', '#btnGtPrevia', '#secAvisos', '#avCanais', '#btnAvisosSalvar', '#btnAvisosLiberar', 'gatilhos.js']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
  for (const hk of ['#secAvisosAuto', '#btnGatilhosAuto', '#tbAvisosFalhas', '#avLiberados', 'gatilhos.js']) assert.ok(invP.includes(hk), 'inventário de planos sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasGatilhos\(\{ gatilhos, quem: lideresEConsultores, clienteCanonico: clienteDaCentral \}\)\)/); assert.match(sv, /app\.use\(criarRotasGatilhosHmac\(/); assert.match(sv, /gatilhos\.tick\(\)/)
  assert.match(ler('src/lib/db.js'), /db\.exec\(SCHEMA_GATILHOS\)/)
  // aviso INTERNO ao consultor no Discord (12/10/2026): 3ª lista no Resumo › Avisos (estado + prévia ao abrir) e a chave própria em /planos, secundária, sem primário novo
  assert.ok(gj.indexOf('id="gtEquipe"') < gj.indexOf('id="gtConsultor"'), '«Para o consultor (Discord)» depois de «Só para a equipe»'); assert.match(gj, /Para o consultor \(Discord\)/)
  for (const u of ['/api/cliente/consultor-discord', '/api/consultor-discord/chave', 'previa=1']) assert.ok(gj.includes(u), u)
  assert.match(sec, /<button type="button" class="btn btn-p" id="btnConsultorDiscord">/); assert.ok(sec.includes('id="cdEstado"'))
  for (const hk of ['#gtConsultor', '#gtConsultorPrevia']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk); for (const hk of ['#cdEstado', '#btnConsultorDiscord']) assert.ok(invP.includes(hk), 'inventário de planos sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasConsultor\(/); assert.match(sv, /consultor\.tick\(\)/); assert.ok(sv.indexOf('consultor.tick()') < sv.indexOf('gatilhos.tick()).catch'), 'o tick do consultor vem antes do dos gatilhos (o resumo antes do plano)')
})

// ═════════ (17) Alinhamentos com o cliente (PLANO ATIVO 4): #secAlinhamentos no Resumo, diálogo de descarte em /cliente e /planos, 1 primário só no diálogo ═════════
caso('alinhamentos: #secAlinhamentos (Resumo, depois de #secDependeCliente e antes de #secGatilhos; 6 colunas, registrar secundário), descarte com motivo da lista em ligarDecisao e em "Descartar marcadas", alinhamentos.js antes de gatilhos.js, sem primário/hex/emoji fora do diálogo; inventários; rotas montadas', () => {
  const cli = ler('src/web/cliente.js'), ch = ler('src/web/cliente.html'), pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), aj = ler('src/web/alinhamentos.js'), inv = ler('docs/ux/inventario-cliente.json'), invP = ler('docs/ux/inventario-planos.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/alinhamentos.js']); execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-alinhamentos.js'])
  const iD = cli.indexOf('id="secDependeCliente"'), iA = cli.indexOf('id="secAlinhamentos"'), iG = cli.indexOf('id="secGatilhos"')
  assert.ok(iD > 0 && iD < iA && iA < iG, '#secAlinhamentos entre #secDependeCliente e #secGatilhos (Resumo)')
  assert.match(cli, /VIVOS = \[[^\]]*'alinhamentos'/); assert.match(cli, /window\.PSAlinhamentos\?\.montar\(\$\('alinhamentos'\), d\.cliente\)/)
  const lig = cli.slice(cli.indexOf('function ligarDecisao('), cli.indexOf('// ── registrar resultado'))
  assert.match(lig, /b\.dataset\.st === 'descartada'/); assert.match(lig, /PSAlinhamentos\?\.descartar\(\{ ids: \[b\.dataset\.id\] \}\)/, 'descarte em Próximas ações e na aba Plano passa pelo diálogo')
  assert.match(plj, /if \(b\.dataset\.st === 'descartada'\) \{ if \(await window\.PSAlinhamentos\?\.descartar\(\{ ids \}\)\) atualizar\(\); return \}/, 'descarte em lote em /planos pelo diálogo')
  assert.match(ch, /<script src="alinhamentos\.js"><\/script>\s*<script src="gatilhos\.js"><\/script>/); assert.match(pl, /<script src="alinhamentos\.js"><\/script>\s*<script src="gatilhos\.js"><\/script>/)
  for (const id of ['alVeredito', 'alTabela', 'btnAlRegistrar', 'alEscopo', 'alAnuncio', 'alRegra', 'alAcos', 'alPor', 'dsPor', 'dsSaida']) assert.ok(aj.includes(`id="${id}"`) || aj.includes(`'${id}'`) || aj.includes(`#${id}`), '#' + id)
  for (const p of ['al', 'ds']) for (const c of ['Tipo', 'Motivo', 'Revisar', 'Permanente']) assert.ok(aj.includes('id="${p}' + c + '"'), `campo ${c} do diálogo (prefixo ${p})`)
  assert.equal((aj.match(/<th scope="col">/g) || []).length, 6, 'tabela com 6 colunas')
  assert.match(aj, /<button class="btn" type="button" id="btnAlRegistrar">Registrar alinhamento<\/button>/, 'registrar é secundário')
  assert.equal((aj.match(/primario: true/g) || []).length, 2, 'primário só dentro dos diálogos (Descartar, Registrar)')
  assert.match(aj, /if \(!m\.motivo_tipo\) \{ saida\.innerHTML = U\.aviso\('erro', 'Escolha o motivo da lista\.'\)/, 'motivo da lista obrigatório no descarte')
  assert.match(aj, /status: 'descartada', por, \.\.\.m/); assert.match(aj, /confirmar: true/); assert.match(aj, /\/api\/alinhamentos\/tipos/)
  assert.doesNotMatch(aj, /btn-primario|#[0-9a-fA-F]{3,8}(?![\w-])|style=/, 'sem primário fixo, hex ou style inline'); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(aj), 'sem emoji em controle')
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só primário em /planos'); assert.equal((cli + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário')
  for (const hk of ['#secAlinhamentos', '#alTabela', '#btnAlRegistrar', "camposMotivo('ds')", '#dsPor', 'alinhamentos.js']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
  for (const hk of ["camposMotivo('ds')", '#dsPor', 'PSAlinhamentos.descartar', 'alinhamentos.js']) assert.ok(invP.includes(hk), 'inventário de planos sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasAlinhamentos\(\{ alinhamentos: alinhamentosReal\(\)/)
})

// ═════════ (18) Respostas dos clientes ao relatório (13/10/2026): #secFeedback recolhida em /planos, 6 colunas, botão secundário, sem primário novo ═════════
caso('respostas ao relatório: #secFeedback recolhida entre #secGargalos e #secAvisosAuto (6 colunas, coletar secundário, ⋯ por linha), sem primário novo; inventário; rotas, tick e schema montados', () => {
  const pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), invP = ler('docs/ux/inventario-planos.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/rotas-feedback.js']); execFileSync(process.execPath, ['--check', RAIZ + 'src/lib/respostas-relatorio.js'])
  const iG = pl.indexOf('id="secGargalos"'), iF = pl.indexOf('id="secFeedback"'), iA = pl.indexOf('id="secAvisosAuto"')
  assert.ok(iG > 0 && iG < iF && iF < iA, '#secFeedback entre #secGargalos e #secAvisosAuto'); assert.match(pl, /<details class="recolhido" id="secFeedback">/, 'seção recolhida')
  const sec = pl.slice(iF, iA); assert.equal((sec.match(/<th>/g) || []).length, 6, 'tabela com 6 colunas')
  for (const id of ['nFeedback', 'fbResumo', 'fbTemas', 'fbStatus', 'fbColeta', 'btnFbColetar', 'tbFeedback']) assert.ok(sec.includes(`id="${id}"`), '#' + id)
  assert.match(sec, /<button type="button" class="btn btn-p" id="btnFbColetar">Coletar respostas agora<\/button>/, 'coletar é secundário')
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só primário em /planos'); assert.doesNotMatch(plj.slice(plj.indexOf('montarFeedback')), /btn-primario|style=/, 'feedback sem primário nem style inline')
  assert.match(plj, /<details class="menu"><summary class="btn btn-p" aria-label="Mudar a situação da resposta">⋯<\/summary>/, '⋯ por linha'); assert.match(plj, /data-fb-st/)
  for (const u of ['/api/feedback?', '/api/feedback/coletar', '/api/feedback/status']) assert.ok(plj.includes(u), u)
  for (const hk of ['#secFeedback', '#fbTemas', '#btnFbColetar', '#tbFeedback']) assert.ok(invP.includes(hk), 'inventário de planos sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasFeedback\(\{ respostas, quem: lideresEConsultores, clienteCanonico: clienteDaCentral \}\)\)/); assert.match(sv, /respostas\.tick\(\)/)
  assert.match(ler('src/lib/db.js'), /db\.exec\(SCHEMA_FEEDBACK\)/)
})

// ═════════ (19) Perfil de informação (13/10/2026): #secPerfilInfo recolhida em /planos entre #secFeedback e #secRisco; #secPerfilCliente em Configurar depois de #secPerfil ═════════
caso('perfil de informação: #secPerfilInfo recolhida entre #secFeedback e #secRisco (matriz ≤ 6 colunas, só leitura); #secPerfilCliente em Configurar depois de #secPerfil (contêiner vivo); botão secundário, sem primário, hex, style nem emoji; inventários; rotas e schema montados', () => {
  const pl = ler('src/web/planos.html'), plj = ler('src/web/planos.js'), clj = ler('src/web/cliente.js'), pj = ler('src/web/perfil-informacao.js'), sv = ler('src/server.js')
  for (const f of ['src/web/perfil-informacao.js', 'src/lib/perfil-informacao.js', 'src/lib/perfil-informacao-real.js', 'src/rotas-feedback.js']) execFileSync(process.execPath, ['--check', RAIZ + f])
  const iF = pl.indexOf('id="secFeedback"'), iP = pl.indexOf('id="secPerfilInfo"'), iR = pl.indexOf('id="secRisco"')
  assert.ok(iF > 0 && iF < iP && iP < iR, '#secPerfilInfo entre #secFeedback e #secRisco'); assert.match(pl, /<details class="recolhido" id="secPerfilInfo">/)
  for (const id of ['nPerfilInfo', 'perfilInfoPlanos']) assert.ok(pl.includes(`id="${id}"`), '#' + id)
  assert.ok(pl.indexOf('src="dossie.js"') < pl.indexOf('src="perfil-informacao.js"') && pl.indexOf('src="perfil-informacao.js"') < pl.indexOf('src="planos.js"'), 'ordem dos scripts em /planos')
  assert.ok(ler('src/web/cliente.html').indexOf('src="perfil-informacao.js"') < ler('src/web/cliente.html').indexOf('src="cliente.js"'), 'perfil-informacao.js antes de cliente.js')
  const mz = pj.slice(pj.indexOf('async function montarPlanos')); assert.equal((mz.match(/<th /g) || []).length, 6, 'matriz com 6 colunas')
  assert.ok(!/fetch\([^)]*method: 'POST'/.test(mz) && !mz.includes("api('/api/cliente/perfil-informacao'"), 'matriz só leitura')
  assert.match(plj, /PSPerfilInfo\?\.montarPlanos\(\$\('perfilInfoPlanos'\)\)/)
  const cfg = clj.slice(clj.indexOf('data-painel="configurar"')); assert.ok(cfg.indexOf('id="secPerfil"') < cfg.indexOf('id="secPerfilCliente"') && cfg.indexOf('id="secPerfilCliente"') < cfg.indexOf('id="secAvisos"'), '#secPerfilCliente depois de #secPerfil')
  assert.match(clj, /'perfilInfo', 'dossie', 'risco', 'contrato'\]\s+\/\/ contêineres preservados/); assert.match(clj, /PSPerfilInfo\?\.montarCliente\(\$\('perfilInfo'\), d\.cliente\)/)
  assert.match(pj, /<button class="btn" type="button" id="btnPiSalvar">/, 'salvar é secundário'); assert.match(pj, /confirmar: true/)
  assert.doesNotMatch(pj, /btn-primario|ps-primario|style=|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem primário, style inline nem hex')
  assert.doesNotMatch(pj.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji')
  assert.equal((pl.match(/btn-primario/g) || []).length, 1, 'um só primário em /planos'); assert.equal((clj + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário')
  for (const hk of ['#secPerfilInfo', '#piMatriz', '#piSugestoes', 'perfil-informacao.js']) assert.ok(ler('docs/ux/inventario-planos.json').includes(hk), 'inventário de planos sem ' + hk)
  for (const hk of ['#secPerfilCliente', '#piTemas', '#btnPiSalvar', '#piHist', 'perfil-informacao.js']) assert.ok(ler('docs/ux/inventario-cliente.json').includes(hk), 'inventário do cliente sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasPerfilInformacao\(\{ perfis: perfilInformacaoReal\(\), quem: quemDossie, clienteCanonico: clienteDaCentral \}\)\)/)
  assert.match(ler('src/lib/db.js'), /db\.exec\(SCHEMA_PERFIL_INFO\)/); assert.match(ler('src/lib/db.js'), /ADD COLUMN origem TEXT NOT NULL DEFAULT 'whatsapp'/)
})

// ═════════ (20) F1 dos 5 menus (docs/ux/arquitetura-5-menus.md § A.0–A.6): nomes, nenhum link para 404, ?sec= só para id que existe ═════════
caso('shell F1: G tem os 5 menus Assessoria · Consultor · Execução · Empresa do cliente · Estrutura; todo href é / ou casa um app.get(\'<rota>\' de src/server.js; todo ?sec= aponta para um id existente; sem ?m=, sem INT/«Configuração»; sync por new URL; deep link no cliente.js', () => {
  const js = ler('src/web/shell.js'), srv = ler('src/server.js'), cli = ler('src/web/cliente.js')
  const ini = js.indexOf('const G = ['), bloco = js.slice(ini, js.indexOf('\n  ]\n', ini) + 4)
  assert.deepEqual([...bloco.matchAll(/^\s*\['([^']+)', \[/gm)].map(m => m[1]), ['Assessoria', 'Consultor', 'Execução', 'Empresa do cliente', 'Estrutura'])
  const itens = [...bloco.matchAll(/\['([\w:-]+)', '([^']+)', '(\/[^']*)'\]/g)]
  assert.ok(itens.length >= 25, 'itens do G: ' + itens.length)
  const rotas = new Set([...srv.matchAll(/app\.get\('(\/[^']*)'/g)].map(m => m[1]))
  const web = readdirSync(RAIZ + 'src/web').filter(f => /\.(html|js)$/.test(f)).map(f => ler('src/web/' + f)).join('\n')
  for (const [, id, , href] of itens) {
    const u = new URL(href, 'http://x')
    assert.ok(u.pathname === '/' || rotas.has(u.pathname), `${id}: ${u.pathname} sem app.get em src/server.js`)
    const sec = u.searchParams.get('sec'); if (sec) assert.ok(web.includes(`id="${sec}"`), `${id}: #${sec} não existe em src/web`)
    assert.ok(!u.searchParams.has('m'), `${id}: sem ?m=`); assert.equal(id.split(':')[0], PAGINAS.find(p => p[1] === id.split(':')[0])?.[1], `${id}: data-pagina conhecido`)
  }
  assert.doesNotMatch(js, /const INT = |'Configuração'|ps-int/, 'INT e «Configuração» saíram'); assert.doesNotMatch(js, /[?&]m=/, 'sem parâmetro ?m=')
  assert.match(js, /new URL\(a\.dataset\.base, location\.origin\)/, 'sync preserva &aba=&sec= do href'); assert.match(js, /document\.getElementById\(sec\)/, 'abre ?sec= em página estática')
  assert.match(cli, /closest\('\[data-painel\]'\)/, 'mostrarAba tolerante a ?sec= de outro painel'); assert.match(cli, /for \(const k of \['aba', 'sec', 'rc', 'visao'\]\) if \(u\.get\(k\)\) q\.set\(k, u\.get\(k\)\)/, 'abrirCliente preserva aba, sec, rc e visao')
  assert.equal((cli.match(/<h3 class="grupo-cfg">/g) || []).length, 5, '5 cabeçalhos de grupo em Configurar')
  assert.match(ler('src/web/relatorios-ciclo.js'), /\.get\('rc'\)/); assert.match(ler('src/web/produtos.js'), /\.get\('visao'\) === 'lucro'/)
})

const inventarios = readdirSync(RAIZ + 'docs/ux').filter(f => /^inventario-.*\.json$/.test(f)).length
caso('prestação de contas e dossiê: #secDossie/#secRisco/#secContrato em Configurar antes de #secAvisos (contêineres vivos), #secRisco recolhida em /planos entre #secFeedback e #secAvisosAuto, botões secundários, primário só dentro do diálogo, sem hex nem emoji', () => {
  const clj = ler('src/web/cliente.js'), dj = ler('src/web/dossie.js'), pl = ler('src/web/planos.html')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/dossie.js'])
  const cfg = clj.slice(clj.indexOf('data-painel="configurar"'))
  for (const id of ['secDossie', 'secRisco', 'secContrato']) assert.ok(cfg.indexOf(`id="${id}"`) > 0 && cfg.indexOf(`id="${id}"`) < cfg.indexOf('id="secAvisos"'), `#${id} em Configurar antes de #secAvisos`)
  assert.match(clj, /'dossie', 'risco', 'contrato'\]\s+\/\/ contêineres preservados/)
  assert.match(clj, /PSDossie\?\.montarCliente\(\{ dossie: \$\('dossie'\), risco: \$\('risco'\), contrato: \$\('contrato'\) \}/)
  assert.ok(pl.indexOf('id="secFeedback"') < pl.indexOf('id="secRisco"') && pl.indexOf('id="secRisco"') < pl.indexOf('id="secAvisosAuto"'), '#secRisco entre #secFeedback e #secAvisosAuto')
  assert.doesNotMatch(dj, /btn-primario|ps-primario/, 'nenhum primário estático')
  assert.equal((dj.match(/primario: true/g) || []).length, 4, 'primário só dentro dos 4 diálogos (marcar, encerrar, contrato, pagamento)')
  for (const id of ['btnDsCliente', 'btnDsDefesa', 'btnRkMarcar', 'btnCtContrato', 'btnCtPagamento']) assert.match(dj, new RegExp(`class="btn" type="button" id="${id}"`), `#${id} secundário`)
  assert.doesNotMatch(dj, /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem hex')
  assert.doesNotMatch(dj.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji')
})

caso('cliente: galeria do anúncio — galeria-anuncio.js antes de cliente.js, miniatura maior nas 3 tabelas, delegação sem listener por linha, CSS só com tokens, contador da aba Anúncios = anúncios da conta', () => {
  const ch = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), gj = ler('src/web/galeria-anuncio.js'), css = ler('src/web/tela-cliente.css'), inv = ler('docs/ux/inventario-cliente.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/galeria-anuncio.js'])
  assert.ok(ch.includes('<script src="galeria-anuncio.js"></script>') && ch.indexOf('src="galeria-anuncio.js"') < ch.indexOf('src="cliente.js"'), 'galeria-anuncio.js antes de cliente.js')
  assert.match(gj, /window\.PSGaleria = \{ miniatura, nitida, fechar \}/)
  for (const ev of ['pointerover', 'pointerout', 'click', 'focusin', 'focusout', 'keydown', 'scroll']) assert.match(gj, new RegExp(`document\\.addEventListener\\('${ev}'`), 'delegação no document: ' + ev)
  assert.doesNotMatch(gj, /querySelectorAll\([^)]*\)\.forEach\([^)]*addEventListener|\.onmouse|\.onpointer/, 'nenhum listener por linha')
  assert.match(gj, /ABRIR_MS = 200, ATRAVESSAR_MS = 150/); assert.match(gj, /'\/api\/cliente\/anuncio\/fotos\?cliente=|\/api\/cliente\/anuncio\/fotos\?cliente=\$\{encodeURIComponent\(cliente\)\}/)
  assert.match(gj, /tabindex="0" role="button"/); assert.match(gj, /:focus-visible/); assert.match(gj, /e\.key === 'Escape'/)
  assert.match(gj, /Não foi possível carregar as fotos agora/); assert.match(gj, /demais fotos indisponíveis agora/); assert.match(gj, /fotos lidas em/)
  assert.match(gj, /'\$1-N\.webp'/, 'miniatura nítida: variante -N.webp do CDN'); assert.match(gj, /URL_OK = \/\^https:\\\/\\\/http2\\\.mlstatic\\\.com\\\/\//, '2ª trava de host no navegador')
  assert.doesNotMatch(gj, /btn-primario|style=|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem primário, style inline nem hex'); assert.doesNotMatch(gj.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji')
  assert.equal((clj.match(/miniAn\((i|it|e)\.thumb/g) || []).length, 3, 'Anúncios no período, Folha e Cronologia de preços usam a miniatura da galeria'); assert.doesNotMatch(clj, /imgAnuncio\([^)]*\.thumb, [^)]*'an-thumb'\)\}<\/td>/)
  for (const c of ['.an-galeria{', '.gl-painel{', '.gl-grade{', '.gl-rodape{', '.gl-msg{', 'img.gl-capa,']) assert.ok(css.includes(c), 'tela-cliente.css sem ' + c)
  assert.match(css, /\.an-thumb\{display:block;width:76px;height:76px;object-fit:contain/); assert.match(css, /prefers-reduced-motion:reduce\)\{\.gl-painel\{animation:none\}/)
  assert.match(css, /\.gl-painel\{position:fixed;[^}]*z-index:var\(--z-menu\)/)
  const gl = css.slice(css.indexOf('/* galeria no hover'), css.indexOf('/* resultado das tarefas')); assert.doesNotMatch(gl, /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(/, 'CSS da galeria só com tokens')
  assert.match(clj, /anN = r\.total_sem_filtro \?\? r\.totais\?\.anuncios \?\? null; desenharContadores\(\)/); assert.match(clj, /if \(a\) a\.textContent = anN != null \? intPt\(anN\) : ''/); assert.doesNotMatch(clj, /acompN\?\.tarefas/, 'a aba Anúncios não conta mais tarefas')
  assert.match(sv, /app\.use\(rotasHistorico\)/, 'a rota das fotos vem com rotasHistorico')
  for (const hk of ['galeria-anuncio.js', '#psGaleria', '[data-galeria]', 'gl-painel', '/api/cliente/anuncio/fotos', '#nAnuncios (aba Anúncios = anúncios da conta']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
})

caso('cliente: aba Produtos (V3 F2, sombra; F4 visão Lucro + DRE) — entre Anúncios e Estratégia, contêiner vivo, carga só ao abrir, produtos.js antes de cliente.js, tabela de 6 colunas, 2 secundárias e nenhum primário novo, sem hex, style nem emoji; inventário; rotas montadas', () => {
  const ch = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), pj = ler('src/web/produtos.js'), inv = ler('docs/ux/inventario-cliente.json'), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/produtos.js'])
  assert.match(clj, /\['anuncios', 'Anúncios'\], \['produtos', 'Produtos'\], \['relatorios', 'Relatórios'\], \['estrategia', 'Estratégia'\]/, 'aba entre Anúncios e Estratégia (V3 F9: Relatórios logo depois)')
  assert.match(clj, /const VIVOS = \[[^\]]*'produtos'/, 'contêiner vivo'); assert.match(clj, /if \(aba === 'produtos'\) carregarProdutos\(\)/, 'carrega só quando a aba abre')
  assert.match(clj, /<section data-painel="produtos" hidden>\s*<section class="bloco" id="secProdutos">/); assert.ok(clj.indexOf('data-painel="produtos"') > clj.indexOf('data-painel="anuncios"') && clj.indexOf('data-painel="produtos"') < clj.indexOf('data-painel="estrategia"'))
  assert.ok(ch.includes('<script src="produtos.js"></script>') && ch.indexOf('src="produtos.js"') < ch.indexOf('src="cliente.js"'), 'produtos.js antes de cliente.js')
  assert.match(pj, /window\.PSProdutos = \{ montar \}/)
  // V3 F4: o cabeçalho vem de CAB (Estoque | Lucro), 6 colunas em cada visão; folha financeira 6, DRE 3; chip com aria-pressed; DRE com seletor nativo de mês
  const cab = pj.match(/const CAB = \{ estoque: \[([^\]]*)\], lucro: \[([^\]]*)\] \}/); assert.ok(cab, 'cabeçalhos das 2 visões'); for (const g of [cab[1], cab[2]]) assert.equal(g.split(',').length, 6, 'tabela de 6 colunas')
  const thsDe = re => (pj.match(re)?.[0].match(/<th[ >]/g) || []).length
  assert.equal(thsDe(/<table class="t empilha mt-2"><thead><tr><th>Anúncio<\/th><th class="num">Receita 28 d<\/th>.*?<\/tr>/), 6, 'folha financeira com 6 colunas')
  assert.equal(thsDe(/id="tabDre"><thead><tr>.*?<\/tr>/), 3, 'DRE com 3 colunas')
  assert.match(pj, /<div class="seg" id="prVisao"[^>]*><button type="button" data-visao="estoque" aria-pressed="true">Estoque<\/button><button type="button" data-visao="lucro" aria-pressed="false">Lucro<\/button>/)
  assert.match(pj, /<input type="month" id="dreMes"/); assert.match(pj, /Não é lucro líquido/)
  for (const id of ['btnMapeamento', 'btnAtualizarEstoque']) assert.match(pj, new RegExp(`<button class="btn" type="button" id="${id}"`), `#${id} secundário`)
  assert.match(pj, /<aside class="gaveta" id="gavMapeamento" hidden/); assert.match(pj, /e\.key === 'Escape'/)
  assert.doesNotMatch(pj, /btn-primario|ps-primario|style=|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem primário fixo, style inline nem hex'); assert.equal((pj.match(/primario: true/g) || []).length, 1, 'primário só dentro do diálogo de confirmação')
  assert.doesNotMatch(pj.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji'); assert.equal((clj + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário')
  for (const hk of ['produtos.js', '#secProdutos', '#tabProdutos', '#btnMapeamento', '#gavMapeamento', '#btnAtualizarEstoque', '"produtos": {', '"prVisao"', '"secDre"', '"dreMes"', '"tabDre"', 'GET /api/cliente/dre']) assert.ok(inv.includes(hk), 'inventário do cliente sem ' + hk)
  assert.match(sv, /app\.use\(criarRotasProdutos\(/); assert.match(sv, /lerEstoqueUps\(c\.cliente, \{ ups: upsParaLer\(c\.cliente\) \}\)/, 'etapa da coleta diária (só leitura) com try próprio')
})

caso('cliente: aba Relatórios (V3 F9) — entre Produtos e Estratégia, contêiner vivo, carga só ao abrir, relatorios-ciclo.js antes de cliente.js, 6 colunas, exportação por links (nenhum primário novo), sem hex, style nem emoji; inventário; rotas montadas', () => {
  const ch = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), rj = ler('src/web/relatorios-ciclo.js'), inv = JSON.parse(ler('docs/ux/inventario-cliente.json')), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/relatorios-ciclo.js'])
  assert.match(clj, /const VIVOS = \[[^\]]*'relatoriosCiclo'/, 'contêiner vivo'); assert.match(clj, /if \(aba === 'relatorios'\) carregarRelatoriosCiclo\(\)/, 'carrega só quando a aba abre')
  assert.match(clj, /<section data-painel="relatorios" hidden>\s*<section class="bloco" id="secRelatoriosCiclo">/)
  assert.ok(clj.indexOf('data-painel="relatorios"') > clj.indexOf('data-painel="produtos"') && clj.indexOf('data-painel="relatorios"') < clj.indexOf('data-painel="estrategia"'))
  assert.ok(ch.indexOf('src="relatorios-ciclo.js"') > ch.indexOf('src="produtos.js"') && ch.indexOf('src="relatorios-ciclo.js"') < ch.indexOf('src="cliente.js"'), 'relatorios-ciclo.js antes de cliente.js')
  assert.match(rj, /window\.PSRelatoriosCiclo = \{ montar \}/)
  assert.doesNotMatch(rj, /btn-primario|\bcheio\b|ps-primario/, 'nenhum primário novo'); assert.doesNotMatch(rj, /#[0-9a-fA-F]{3,6}\b|style=/, 'sem hex nem style')
  assert.doesNotMatch(rj, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'sem emoji')
  assert.match(rj, /r\.colunas\.map/, 'cabeçalho vem do servidor (COLUNAS, 6)')
  const { COLUNAS } = { COLUNAS: ['Item', 'Métrica', 'Previsão', 'Chance', 'Medido', 'Observação'] }
  assert.ok(ler('src/lib/relatorios-ciclo.js').includes(`export const COLUNAS = [${COLUNAS.map(c => `'${c}'`).join(', ')}]`), '6 colunas fixas')
  assert.ok(inv.relatorios_ciclo && inv.selos_sistema.secoes['#secRelatoriosCiclo'] === 'morpheus', 'inventário')
  assert.match(sv, /app\.use\(criarRotasRelatoriosCiclo\(/, 'rotas montadas')
})

caso('cliente: aba Executar (Chaveiro F4+) — logo depois de Plano, contêiner vivo, carga só ao abrir, executar.js antes de cliente.js, tabelas de 6 colunas, nenhum primário fixo (só no diálogo), sem hex, style nem emoji; botão «Executar pelo Chaveiro» no Resumo; inventário; rotas montadas', () => {
  const ch = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), ej = ler('src/web/executar.js'), inv = JSON.parse(ler('docs/ux/inventario-cliente.json')), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/executar.js'])
  assert.match(clj, /\['plano', 'Plano'\], \['executar', 'Executar'\], \['anuncios', 'Anúncios'\]/, 'aba logo depois de Plano')
  assert.match(clj, /const VIVOS = \[[^\]]*'executar'/, 'contêiner vivo'); assert.match(clj, /if \(aba === 'executar'\) carregarExecutar\(\)/, 'carrega só quando a aba abre')
  assert.match(clj, /<section data-painel="executar" hidden>\s*<section class="bloco" id="secExecutar">/)
  assert.ok(ch.indexOf('src="executar.js"') > ch.indexOf('src="produtos.js"') && ch.indexOf('src="executar.js"') < ch.indexOf('src="cliente.js"'), 'executar.js antes de cliente.js')
  assert.match(ej, /window\.PSExecutar = \{ montar \}/)
  for (const id of ['exTabAnuncios', 'exTabPrevia', 'exOrdens', 'exTabLib']) { const m = ej.match(new RegExp(`id="${id}"><caption[^>]*>[^<]*</caption><thead><tr>(.*?)</tr>`)); assert.ok(m, id); assert.equal((m[1].match(/<th /g) || []).length, 6, `${id} com 6 colunas`) }
  assert.doesNotMatch(ej, /btn-primario|ps-primario|style=|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem primário fixo, style inline nem hex'); assert.equal((ej.match(/primario: true/g) || []).length, 1, 'primário só dentro do diálogo de confirmação')
  assert.doesNotMatch(ej.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji'); assert.equal((clj + ler('src/web/acomp.js')).match(/btn-primario/g).length, 1, 'cliente.js continua com um só primário')
  assert.match(clj, /data-exec-acao="\$\{esc\(a\.id\)\}">Executar pelo Chaveiro<\/button>/, 'botão no Resumo para ação automática')
  assert.ok(inv.executar && inv.selos_sistema.secoes['#secExecutar'] === 'chaveiro', 'inventário'); assert.match(sv, /app\.use\(criarRotasChaveiroExecutor\(/, 'rotas montadas'); assert.match(sv, /execChaveiro\.tickExecutor\(\)/, 'tick montado')
})

caso('cliente: «Subir planilha de custos» (15/10/2026) em Configurar — contêiner vivo, custos-upload.js antes de cliente.js, input file + «Ver prévia» secundário, tabela de 6 colunas, primário só no diálogo, sem hex/style/emoji; inventário; rotas montadas', () => {
  const ch = ler('src/web/cliente.html'), clj = ler('src/web/cliente.js'), uj = ler('src/web/custos-upload.js'), inv = JSON.parse(ler('docs/ux/inventario-cliente.json')), sv = ler('src/server.js')
  execFileSync(process.execPath, ['--check', RAIZ + 'src/web/custos-upload.js'])
  assert.match(clj, /const VIVOS = \[[^\]]*'custosUpload'/, 'contêiner vivo')
  assert.ok(clj.indexOf('id="secCustosUpload"') > clj.indexOf('id="secContrato"') && clj.indexOf('id="secCustosUpload"') < clj.indexOf('id="secNotaFiscal"'), 'em Configurar, entre Contrato e Nota fiscal')
  assert.ok(ch.indexOf('src="custos-upload.js"') > ch.indexOf('src="nota-fiscal.js"') && ch.indexOf('src="custos-upload.js"') < ch.indexOf('src="cliente.js"'), 'custos-upload.js antes de cliente.js')
  assert.match(uj, /window\.PSCustosUpload = \{ montar \}/); assert.match(uj, /type="file" id="cuArquivo"/); assert.match(uj, /<button class="btn" type="button" id="btnCuPrevia">Ver prévia<\/button>/)
  const m = uj.match(/id="cuTabAnuncios"><caption[^>]*>[^<]*<\/caption><thead><tr>(.*?)<\/tr>/); assert.ok(m); assert.equal((m[1].match(/<th /g) || []).length, 6, '6 colunas')
  assert.doesNotMatch(uj, /btn-primario|style=|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i, 'sem primário fixo, style inline nem hex'); assert.equal((uj.match(/primario: true/g) || []).length, 1, 'primário só dentro do diálogo')
  assert.doesNotMatch(uj.replace(/\/\/.*$/gm, ''), /\p{Extended_Pictographic}/u, 'sem emoji')
  assert.ok(inv.custos_upload && inv.selos_sistema.secoes['#secCustosUpload'] === 'smith', 'inventário'); assert.match(sv, /app\.use\(criarRotasCustosUpload\(/, 'rotas montadas')
})

caso('selo do sistema de origem (15/10/2026): .sis em ui.css só com token, ao lado do h2 sem mudar o texto do título; ids intactos; /metodologia com «Os 8 sistemas»', () => {
  const regra = UI.match(/^\.sis\{[^}]*\}/m)?.[0]; assert.ok(regra, '.sis em ui.css'); assert.doesNotMatch(regra, /#[0-9a-f]{3,6}\b/i, 'cor só por token'); assert.match(UI, /^\.bloco-cab>\.sis\{margin-right:auto\}/m, 'selo colado ao título mesmo com botão à direita')
  const cli = ler('src/web/cliente.js'), pl = ler('src/web/planos.html'), rs = ler('src/web/resultados.html'), ig = ler('src/web/integracoes.html'), mt = ler('src/web/metodologia.html')
  for (const [f, h] of [[cli, 'Resultado das tarefas'], [cli, 'Cronologia de preços'], [cli, 'Anúncios no período'], [rs, 'Por tipo de tarefa'], [mt, 'Está acertando?'], [pl, 'Revisar ações']]) assert.ok(f.includes(`<h2>${h}</h2><span class="sis" data-sistema=`), `${h}: h2 igual + selo depois`)
  for (const id of ['secProximas', 'secChaveiro', 'secAcomp', 'secGatilhos', 'nFolha', 'nDependencias', 'secImpacto', 'secNotion']) assert.ok(cli.includes(`id="${id}"`), `#${id} continua`)
  for (const id of ['tituloLista', 'custosTitulo', 'tituloS90', 'configEstado']) assert.ok(ig.includes(`id="${id}"`), `#${id} continua`)
  assert.match(mt, /<section class="bloco" id="secSistemas">\s*<div class="bloco-cab"><h2>Os 8 sistemas<\/h2><\/div>/); assert.equal((mt.match(/<li data-sistema="/g) || []).length, 8)
  assert.ok(ler('docs/ux/inventario-metodologia.json').includes('"secSistemas"'), 'inventário com a seção nova')
  for (const inv of ['cliente', 'planos', 'resultados', 'integracoes', 'metodologia']) assert.ok(JSON.parse(ler(`docs/ux/inventario-${inv}.json`)).selos_sistema, `inventário ${inv} com selos_sistema`)
  assert.doesNotMatch(mt.slice(mt.indexOf('secSistemas')), /btn-primario/, 'a seção nova não traz primário')
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-shell-ui: ${ok} de ${ok + falhas.length} verificações passaram (${inventarios} inventários lidos)`)
if (falhas.length) { console.error('Falharam: ' + falhas.join(' | ')); process.exit(1) }
