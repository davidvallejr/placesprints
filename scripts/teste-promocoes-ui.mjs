process.env.PS_PROMO_MEMORIA = '1'   // convenção das frentes: antes de qualquer import (esta tela não abre banco nenhum, mas a regra vale igual)
process.env.TZ = 'UTC'                // o fuso do navegador NÃO pode mudar a data/hora exibidas (índice 34)
// Regressão da frente UI de "Promoções por cliente" (src/web/promocoes.js|html|css). Sem rede, sem banco, sem jsdom:
//  (1) o bloco puro do script (entre <puro> e </puro>) é extraído e executado isolado;
//  (2) o script INTEIRO roda num vm com um DOM de mentira e um fetch controlado por promessas (ordem de chegada das respostas é do teste).
// Rodar: node scripts/teste-promocoes-ui.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const RAIZ = new URL('..', import.meta.url).pathname
const FONTE = readFileSync(RAIZ + 'src/web/promocoes.js', 'utf8')
const HTML = readFileSync(RAIZ + 'src/web/promocoes.html', 'utf8')
const CSS_PR = readFileSync(RAIZ + 'src/web/promocoes.css', 'utf8')
const CSS_UI = readFileSync(RAIZ + 'src/web/ui.css', 'utf8')

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('FALHOU:', nome); throw e } }
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = async (k = 6) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)) }

// ═════════ (1) bloco puro ═════════════════════════════════════════════════════════════════════════════
const ini = FONTE.indexOf('// <puro>'), fim = FONTE.indexOf('// </puro>')
assert.ok(ini > 0 && fim > ini, 'marcadores <puro>/</puro> não encontrados em promocoes.js')
const P = vm.runInNewContext(FONTE.slice(ini, fim) + `\n;({ esc, fmtR, fmtPct, brData, brHora, filtrosPadrao, filtrosAtivos, coletaConcluida, temLimiteFalha, avisoColeta, kpiVal, semVendas, curvaTag, fatTxt, impostoChip, vazioElegiveis, msgSemDescobertos, opcoesDias, paginaAlvo, textoAprovarTodas, estadoSelo, botaoExecutar, GRAVAM, seletorFoco, criarRender, vazioFato, desfechoColeta, desfechoAprovacao, parDoBotao, desfechoExecucao, textoReadback, textoAplicar, ehMarcaHumana, ehIncerta, ABAS_FORM })`)

await caso('34 · brData/brHora: mesmo fuso (Brasília) para data e hora, em qualquer fuso do navegador', () => {
  // 22:30 de 04/10 em Brasília = 01:30Z de 05/10; o código antigo mostrava '05/10/2026 22:30' (data UTC + hora local)
  assert.equal(P.brHora('2026-10-05T01:30:00.000Z'), '04/10/2026 22:30')
  assert.equal(P.brData('2026-10-05T01:30:00.000Z'), '04/10/2026')
  assert.equal(P.brHora('2026-10-05T03:00:00Z'), '05/10/2026 00:00')            // meia-noite BRT, nunca "24:00"
  assert.equal(P.brData('2026-10-05T02:59:59-00:00'), '04/10/2026')
  assert.equal(P.brHora('2026-10-04T22:30:00-03:00'), '04/10/2026 22:30')
  // data pura (fim de campanha) e carimbo sem fuso são lidos como estão
  assert.equal(P.brData('2026-10-31'), '31/10/2026')
  assert.equal(P.brData('2026-12-31T23:59:59'), '31/12/2026')
  assert.equal(P.brHora('2026-12-31T23:59:59'), '31/12/2026 23:59')
  assert.equal(P.brData(null), '—'); assert.equal(P.brHora(''), '—')
  process.env.TZ = 'Asia/Tokyo'                                                  // mudar o fuso do processo não muda o resultado
  assert.equal(P.brHora('2026-10-05T01:30:00.000Z'), '04/10/2026 22:30')
  process.env.TZ = 'UTC'
})

await caso('30 · contrato da coleta: só "concluida" é leitura completa; KPIs não mostram zero como fato', () => {
  const r = (estado, extra = {}) => ({ coleta: { estado, concluida_em: 'x', resumo: extra }, pendencias: [] })
  assert.equal(P.avisoColeta(r('concluida')), '')
  assert.equal(P.avisoColeta({ coleta: null }), '')
  assert.match(P.avisoColeta(r('parcial', { leituras_falhas: 2 })), /^Coleta parcial: números abaixo podem estar incompletos\./)
  assert.match(P.avisoColeta(r('parcial', { leituras_falhas: 2 })), /2 leitura\(s\) falharam/)
  assert.match(P.avisoColeta(r('erro', { erro: 'NOT_AUTHORIZED' })), /^Coleta erro: .*NOT_AUTHORIZED/)
  assert.match(P.avisoColeta(r('rodando')), /^Coleta rodando:/)
  assert.equal(P.kpiVal(r('concluida'), 0), 0)               // zero de coleta completa é fato
  assert.equal(P.kpiVal(r('parcial'), 0), '—')               // zero de coleta parcial não é
  assert.equal(P.kpiVal(r('parcial'), 7), 7)
  assert.equal(P.kpiVal(r('erro'), 7), '—')
  assert.equal(P.kpiVal({ coleta: null }, 0), '—')
  assert.equal(P.temLimiteFalha({ pendencias: [{ estado: 'NETWORK_ERROR' }] }), true)
  assert.equal(P.temLimiteFalha({ pendencias: [{ estado: 'ATENCAO' }] }), false)
  const d = { total_base: 0, total: 0 }
  assert.doesNotMatch(P.vazioElegiveis(r('erro'), d), /fato da conta/)
  assert.doesNotMatch(P.vazioElegiveis(r('parcial'), d), /fato da conta/)
  assert.doesNotMatch(P.vazioElegiveis({ ...r('concluida'), pendencias: [{ estado: 'ML_INDISPONIVEL' }] }, d), /fato da conta/)
  assert.match(P.vazioElegiveis(r('concluida'), d), /fato da conta, não um erro/)
  assert.match(P.vazioElegiveis({ coleta: null }, d), /primeira coleta/)
})

await caso('31 · sem série de vendas: curva/faturamento "—", nunca R$ 0,00 / Curva C; vigia declara que não avaliou', () => {
  const sem = { vendas: { disponivel: false }, coleta: { estado: 'concluida' } }, com = { vendas: { disponivel: true, ate: '2026-10-05', cobertura: { dias_com_dado: 30 } }, coleta: { estado: 'concluida' } }
  assert.equal(P.fatTxt(sem, 0), '—'); assert.match(P.fatTxt(com, 0), /R\$/)
  assert.doesNotMatch(P.curvaTag(sem, 'C'), /cC|>C</); assert.match(P.curvaTag(com, 'C'), /curva cC/)
  assert.match(P.msgSemDescobertos(sem, 0), /Sem série de vendas/)
  assert.doesNotMatch(P.msgSemDescobertos(sem, 0), /Nenhum protegido descoberto nesta janela/)
  assert.match(P.msgSemDescobertos(com, 3), /3 protegido\(s\) ficaram com cobertura DESCONHECIDA/)
  assert.equal(P.msgSemDescobertos(com, 0), 'Nenhum protegido descoberto nesta janela.')
})

await caso('52 · página fora do intervalo volta à última válida', () => {
  assert.equal(P.paginaAlvo({ itens: [], total: 120, limite: 50, pagina: 5 }), 3)
  assert.equal(P.paginaAlvo({ itens: [], total: 0, limite: 50, pagina: 1 }), 0)
  assert.equal(P.paginaAlvo({ itens: [{}], total: 120, limite: 50, pagina: 2 }), 0)
})

await caso('53 · select da janela inclui o valor da config (10 dias) mesmo fora de 7/14/30/60', () => {
  assert.deepEqual([...P.opcoesDias(10)], [7, 10, 14, 30, 60])
  assert.deepEqual([...P.opcoesDias(7)], [7, 14, 30, 60])
  assert.deepEqual([...P.opcoesDias(undefined)], [7, 14, 30, 60])
})

await caso('55 · botão Executar: nunca em plano expirado; selo "executado" sem prova não é verde', () => {
  assert.equal(P.botaoExecutar({ estado: 'aprovado', expirado: true }, null), 'oculto')
  assert.equal(P.botaoExecutar({ estado: 'aprovado', expirado: false }, null), 'ativo')
  assert.equal(P.botaoExecutar({ estado: 'aprovado', expirado: false }, { aviso: 'x' }), 'desabilitado')
  assert.equal(P.botaoExecutar({ estado: 'executado' }, null), 'oculto')
  assert.equal(P.estadoSelo({ estado: 'executado', resultado: { resumo: { entrou_provado: 0 } } }), 'atencao')
  assert.equal(P.estadoSelo({ estado: 'executado', resultado: { resumo: { entrou_provado: 2 } } }), 'bom')
  assert.equal(P.estadoSelo({ estado: 'aprovado' }), 'bom')
})

await caso('56 · "Aprovar todas": texto traz a contagem e diz que os filtros NÃO limitam', () => {
  assert.match(P.textoAprovarTodas(12, false), /Aprovar 12 anúncio\(s\).*TODO o cliente/)
  assert.doesNotMatch(P.textoAprovarTodas(12, false), /NÃO limitam/)
  assert.match(P.textoAprovarTodas(12, true), /filtros da tela NÃO limitam/)
  assert.equal(P.filtrosAtivos(P.filtrosPadrao()), false); assert.equal(P.filtrosAtivos({ ...P.filtrosPadrao(), curva: 'A' }), true)
})

await caso('57 · chip de imposto reflete o imposto EFETIVO (config > fallback custos_cliente)', () => {
  assert.equal(P.impostoChip({ config: { imposto_pct: 8 } }), 'imposto 8,0%')
  assert.equal(P.impostoChip({ config: { imposto_pct: null }, custos_cliente: { imposto_pct: 12 }, pendencias: [] }), 'imposto 12,0% (fallback custos_cliente)')
  // backend sem o campo novo: a ausência da pendência SEM_IMPOSTO prova que o fallback está em uso
  assert.equal(P.impostoChip({ config: { imposto_pct: null }, pendencias: [] }), 'imposto: fallback custos_cliente')
  assert.equal(P.impostoChip({ config: { imposto_pct: null }, pendencias: [{ codigo: 'SEM_IMPOSTO' }] }), 'imposto não configurado')
})

await caso('54 · toda ação que grava exige "Seu nome" (inclui aplicar analista e sync do plano)', () => {
  for (const a of ['analista-aplicar', 'plano-sync', 'plano-gerar', 'plano-aprovar', 'plano-executar', 'marcar', 'aprovar', 'aprovar-todas', 'aprovar-todas-ok', 'protegido', 'rm-regra', 'off-aprend']) assert.ok(P.GRAVAM.has(a), a)
  assert.equal(P.GRAVAM.has('analista-previa'), false)   // prévia não grava
})

await caso('58 · foco: seletor identifica por id ou data-* (a posição muda, o dado não)', () => {
  assert.equal(P.seletorFoco({ id: 'selDias' }), '[id="selDias"]')
  assert.equal(P.seletorFoco({ id: '', dataset: { acao: 'marcar', item: 'MLB1', pid: 'P-1', v: '0' } }), '[data-acao="marcar"][data-item="MLB1"][data-pid="P-1"][data-v="0"]')
  assert.equal(P.seletorFoco({ id: '', dataset: { acao: 'pag', foco: 'prox', p: '3' } }), '[data-acao="pag"][data-foco="prox"]')   // data-p muda a cada página: fora da chave
  assert.equal(P.seletorFoco({ id: '', dataset: {} }), '')
  assert.equal(P.seletorFoco({ id: 'a"b' }), '[id="a\\"b"]')
})

// ═════════ acessibilidade estática: live regions, tablist, contraste ═════════════════════════════
await caso('58 · toast: regiões vivas fixas (erro em role=alert), sem hidden; abas sem role=tab órfão', () => {
  assert.match(HTML, /id="toastErro"[^>]*role="alert"|role="alert"[^>]*id="toastErro"/)
  assert.match(HTML, /id="toast"[^>]*role="status"[^>]*aria-live="polite"|role="status"[^>]*id="toast"/)
  assert.doesNotMatch(HTML, /id="toast(Erro)?"[^>]*\bhidden\b/)
  assert.doesNotMatch(HTML, /role="tablist"/); assert.doesNotMatch(FONTE, /role="tab"/)
})
await caso('58 · contraste ≥ 4,5:1 nos pares texto/fundo da tela (tokens de promocoes.css sobrepõem os de ui.css)', () => {
  const tok = css => Object.fromEntries([...css.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]))
  const T = { ...tok(CSS_UI), ...tok(CSS_PR.match(/:root\{[^}]*\}/)[0]) }
  const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const pares = [['laranja-escuro', '#fff1e8'], ['laranja-escuro', '#ffffff'], ['verde', T['verde-suave']], ['verde', '#ffffff'], ['verde', '#f6fbf6'], ['cinza', '#ffffff'], ['cinza', T['fundo-suave']],
    ['cinza', T['verm-suave']], ['cinza', T['ambar-suave']], ['cinza', '#f6fbf6'], ['azul', T['azul-suave']], ['ambar', T['ambar-suave']], ['ambar', '#ffffff'], ['verm', T['verm-suave']], ['verm', '#ffffff']]
  for (const [fg, bg] of pares) { const r = razao(T[fg] || fg, bg); assert.ok(r >= 4.5, `--${fg} ${T[fg]} sobre ${bg}: ${r.toFixed(2)}:1`) }
  assert.ok(razao('#ffffff', T.verm) >= 4.5)   // toast de erro
})

// ═════════ (2) o script inteiro, num DOM de mentira ═════════════════════════════════════════════════
const IDS_HTML = [...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
function criarTela() {
  const reg = new Map(), filhos = new Map(), log = [], rotas = []
  const body = { classList: { toggle() {} } }
  const doc = { activeElement: body, body, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f) }, getElementById: id => reg.get(id) || null, querySelectorAll: () => [] }
  const descende = (a, b) => a === b || [...(filhos.get(a.id) || [])].some(id => reg.get(id) && descende(reg.get(id), b))
  const esquecer = dono => { for (const id of filhos.get(dono) || []) { esquecer(id); reg.delete(id) } filhos.set(dono, new Set()) }
  const criar = (id, dono = '') => {
    const el = { id, _html: '', textContent: '', value: '', checked: false, hidden: false, disabled: false, tabIndex: 0, href: '', dataset: {}, handlers: {}, onclick: null, onchange: null, onsubmit: null,
      options: id === 'fSit' ? Array.from({ length: 7 }, () => ({ textContent: '' })) : [], classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(t, f) { (this.handlers[t] ||= []).push(f) }, setAttribute() {}, removeAttribute() {}, closest: () => null, querySelectorAll: () => [],
      focus() { doc.activeElement = el }, contains: x => descende(el, x),
      querySelector: sel => { const m = /^\[id="(.*)"\]$/.exec(sel); const alvo = m && reg.get(m[1].replace(/\\(["\\])/g, '$1')); return alvo && descende(el, alvo) ? alvo : null } }
    Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = String(v); esquecer(id); for (const m of el._html.matchAll(/\sid="([^"]+)"/g)) { if (!reg.has(m[1])) { reg.set(m[1], criar(m[1])); filhos.get(id).add(m[1]) } } } })
    filhos.set(id, new Set()); reg.set(id, el); return el
  }
  for (const id of IDS_HTML) criar(id)
  let storage = {}
  const sandbox = {
    document: doc, window: { addEventListener() {} }, location: { search: '' }, history: { pushState() {}, replaceState() {} }, localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v } },
    URLSearchParams, FormData: class { forEach() {} get() { return null } }, console, encodeURIComponent, Intl, Promise, Set, Map, Number, String, Object, Array, JSON, Math, Error, Date,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms === 1200 ? 0 : ms); if (ms !== 1200) t.unref?.(); return t }, clearTimeout,   // o sleep() do polling NÃO pode ser unref (senão o processo sai com o await pendente)
    confirm: () => { throw new Error('confirm() não deve ser usado neste fluxo') }, prompt: () => null,
    fetch: async (url, opts) => {
      const corpo = opts?.body ? JSON.parse(opts.body) : undefined
      log.push({ url, metodo: opts?.method || 'GET', body: corpo })
      const rota = [...rotas].reverse().find(r => url.startsWith(r.prefixo))
      if (!rota) throw new Error('rota sem stub: ' + url)
      const r = await rota.fn(url, corpo)
      if (r && r.__status) return { ok: false, status: r.__status, json: async () => ({ erro: r.erro }) }
      return { ok: true, status: 200, json: async () => r }
    },
  }
  sandbox.globalThis = sandbox
  const ctx = vm.createContext(sandbox)
  const T = { log, doc, el: id => reg.get(id), sandbox, on: (prefixo, fn) => { rotas.push({ prefixo, fn: typeof fn === 'function' ? fn : () => fn }) }, erro: (status, erro) => ({ __status: status, erro }) }
  T.on('/api/promocoes/clientes', [])
  T.on('/api/promocoes/resumo?cliente=', url => resumoDe(decodeURIComponent(url.split('cliente=')[1])))
  T.on('/api/promocoes/elegiveis', () => elegDe([]))
  T.on('/api/promocoes/participando', () => ({ dias: 7, cobertura: { alertas: [], excecoes: [] }, rebate_pior: [], derrubadas: null, participando: [] }))
  T.on('/api/promocoes/planos', [])
  T.on('/api/promocoes/plano?', { plano: null })
  T.on('/api/promocoes/auditoria', [])
  vm.runInContext(FONTE + '\n;globalThis.__T = { S, abrir, escolher, mostrarAba, recarregarResumo, abaElegiveis, abaPlano, coletar, toast, sincOcupado }', ctx)
  T.app = sandbox.__T
  T.quem = nome => { T.el('quem').value = nome }
  T.clicar = async (acao, dataset = {}) => {
    const botao = { dataset: { acao, ...dataset }, disabled: false, textContent: '', setAttribute() {}, closest: () => null }
    const ev = { target: { closest: sel => (sel === '[data-acao]' ? botao : null) } }
    await Promise.all((doc.handlers.click || []).map(h => h(ev)))
  }
  return T
}

const resumoDe = (cli, mut) => {
  const r = {
    cliente: cli, hoje: '2026-10-05',
    config: { piso_mc: cli === 'A' ? 11 : 22, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, hedge_cobertura: 1, execucao_habilitada: 0, execucao_max_itens: 1 },
    coleta: { estado: 'concluida', concluida_em: '2026-10-05T12:00:00.000Z', resumo: {} }, frescor: { fresca: true, idade_horas: 1, motivo: '', concluida_em: '2026-10-05T12:00:00.000Z' },
    vendas: { disponivel: true, ate: '2026-10-05', motivo: '' }, custos_cliente: null,
    kpis: { elegiveis: 5, elegiveis_ge_piso: 3, marcadas: 1, sugeridas: 2, participando: 4, participando_rebate: 2, descobertos: 1, sem_custo: 0, skus_sem_custo: 0, rebate_pior: 0, lembretes: 0, under_review: 0 },
    invariante: null, execucao: { habilitada: false, max_itens: 1 }, pendencias: [],
  }
  mut?.(r); return r
}
const linhaDe = (id = 'MLB1', o = {}) => ({ item_id: id, sku: 'SKU-' + id, titulo: 'Anúncio ' + id, permalink: '', curva: 'A', fat30: 1000, estoque: 1, status: 'active', under_review: false, protegido: false, atual: null, vigente: null, melhor: null,
  custo: { ok: true, estado: 'ok', faltando: [], modo: '' }, piso: 20, regraSku: '', estado: '', sugerida: [], marcadas: [], motivoSemMarca: '', avisoP: '', avisos: [], outras: [], candidatos: [], situacao: 'sem_marca', participa: [], ...o })
const elegDe = (itens, o = {}) => ({ total: itens.length, total_base: itens.length, totais: {}, pagina: 1, limite: 50, itens, coleta: {}, ...o })
const planoDe = (o = {}) => ({ id: 'PL1', estado: 'aprovado', expirado: false, criado_em: '2026-10-05T12:00:00Z', expira_em: '2026-10-06T12:00:00Z', aprovado_por: 'David', execucao_habilitada: true, espera_propagacao_min: 10,
  resumo: { entrar: 1, hedge: 0, pular: 0, ignorar: 0, anuncios: 1, por_motivo: {} }, itens: [], resultado: null, executado_em: null, ...o })
const PAINEIS = ['chips', 'status', 'invariante', 'pendencias', 'kpis', 'faixaColeta']

await caso('5 · corrida: resposta lenta do cliente A não pinta sob o cliente B', async () => {
  const T = criarTela(); await tick()
  const dA = defer(), dB = defer()
  T.on('/api/promocoes/resumo?cliente=A', () => dA.promise); T.on('/api/promocoes/resumo?cliente=B', () => dB.promise)
  const pA = T.app.abrir('A', 'elegiveis', false), pB = T.app.abrir('B', 'elegiveis', false)
  dB.resolve(resumoDe('B')); await pB
  dA.resolve(resumoDe('A')); await pA; await tick()
  assert.equal(T.app.S.cliente, 'B'); assert.equal(T.app.S.resumo.cliente, 'B')
  assert.match(T.el('chips').innerHTML, /22,0%/); assert.doesNotMatch(T.el('chips').innerHTML, /11,0%/)
  assert.equal(T.el('titulo').textContent, 'B')
})

await caso('29 · trocar de cliente limpa TODOS os painéis, filtros e resumo antes da resposta do novo (e se ela falhar)', async () => {
  const T = criarTela(); await tick()
  await T.app.abrir('A', 'elegiveis', false); await tick()
  assert.ok(['chips', 'status', 'kpis'].every(id => T.el(id).innerHTML !== ''), 'A deveria ter pintado os painéis')
  T.app.S.f.q = 'abc'; T.app.S.f.curva = 'A'; T.app.S.abertos.add('MLB1')
  const dB = defer(); T.on('/api/promocoes/resumo?cliente=B', () => dB.promise)
  const pB = T.app.abrir('B', 'elegiveis', false)
  for (const id of PAINEIS) assert.equal(T.el(id).innerHTML, '', `#${id} ainda mostra o cliente anterior`)
  assert.equal(T.app.S.resumo, null); assert.equal(T.app.S.f.q, ''); assert.equal(T.app.S.f.curva, ''); assert.equal(T.app.S.abertos.size, 0)
  dB.resolve(T.erro(404, 'cliente sem conta Mercado Livre conectada')); await pB
  assert.match(T.el('conteudo').innerHTML, /cliente sem conta Mercado Livre conectada/)
  for (const id of PAINEIS) assert.equal(T.el(id).innerHTML, '', `#${id} voltou a mostrar o cliente anterior após o erro`)
})

await caso('30 · coleta parcial/erro: faixa vermelha, KPIs "—", sem a frase "fato da conta" e sem "há  h"', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', url => resumoDe('P', r => { r.coleta = { estado: 'parcial', concluida_em: null, resumo: { leituras_falhas: 2 } }; r.frescor = { fresca: false, idade_horas: null, motivo: 'última coleta: parcial' }
    r.kpis.elegiveis = 0; r.kpis.participando = 0; r.kpis.descobertos = 0; r.pendencias = [{ codigo: 'LISTAGEM_PAGINA', estado: 'NETWORK_ERROR', texto: 'página 2 falhou' }] }))
  T.on('/api/promocoes/elegiveis', () => elegDe([], { total_base: 0 }))
  await T.app.abrir('P', 'elegiveis', false); await tick()
  assert.match(T.el('faixaColeta').innerHTML, /Coleta parcial: números abaixo podem estar incompletos/)
  assert.match(T.el('status').innerHTML, /coleta PARCIAL/); assert.doesNotMatch(T.el('status').innerHTML, /há\s+h\b/)
  assert.doesNotMatch(T.el('kpis').innerHTML, /<div class="valor">0<\/div>/)
  assert.match(T.el('pendencias').innerHTML, /<details open>/)                    // limite de falha de leitura abre as pendências
  assert.doesNotMatch(T.el('elCorpo').innerHTML, /fato da conta/)
  assert.match(T.el('elCorpo').innerHTML, /Coleta parcial/)
})

await caso('30b · coleta de promoções desligada para o cliente (coleta_ligada:false): aviso em #faixaColeta com o link para Cliente → Configurar; ligada ou ausente: nada', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('D', r => { r.coleta_ligada = false }))
  T.on('/api/promocoes/elegiveis', () => elegDe([]))
  await T.app.abrir('D', 'elegiveis', false); await tick()
  assert.match(T.el('faixaColeta').innerHTML, /Coleta desligada para este cliente/); assert.match(T.el('faixaColeta').innerHTML, /\/cliente\?cliente=D&amp;aba=configurar/)
  assert.doesNotMatch(T.el('faixaColeta').innerHTML, /aviso erro/, 'desligada não é erro de coleta')
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('L', r => { r.coleta_ligada = true }))
  await T.app.abrir('L', 'elegiveis', false); await tick()
  assert.equal(T.el('faixaColeta').innerHTML, '')
})

await caso('31 · sem vendas na tela: Curva "—", Fat. 30d "—", KPI Descobertos "—", vigia declara que não avaliou', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('V', r => { r.vendas = { disponivel: false, ate: null, motivo: 'sem série' }; r.kpis.descobertos = 0 }))
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB1', { curva: 'C', fat30: 0 })]))
  await T.app.abrir('V', 'elegiveis', false); await tick()
  const corpo = T.el('elCorpo').innerHTML
  assert.doesNotMatch(corpo, /R\$ 0,00/); assert.doesNotMatch(corpo, /curva cC/)
  assert.match(corpo, /sem série de vendas: curva indeterminada/)
  assert.match(T.el('kpis').innerHTML, /Descobertos<\/div><div class="valor">—<\/div>/)
  await T.app.mostrarAba('participando', false); await tick()
  assert.match(T.el('conteudo').innerHTML, /Sem série de vendas/); assert.doesNotMatch(T.el('conteudo').innerHTML, /Nenhum protegido descoberto nesta janela/)
})

await caso('32 · falha ao executar: recarrega o plano, mostra aviso e mantém "Executar" desabilitado até recarregar', async () => {
  const T = criarTela(); await tick(); T.quem('David')
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.config.execucao_habilitada = 1; r.execucao = { habilitada: true, max_itens: 1 } }))
  T.on('/api/promocoes/planos', [{ id: 'PL1', criado_em: '2026-10-05T12:00:00Z', estado: 'aprovado', resumo: { entrar: 1 } }])
  T.on('/api/promocoes/plano?', { plano: planoDe() })
  await T.app.abrir('A', 'plano', false); await tick()
  assert.match(T.el('conteudo').innerHTML, /data-acao="plano-executar" >Executar/)         // habilitado
  T.sandbox.prompt = () => 'EXECUTAR'
  T.on('/api/promocoes/plano/executar', { job: 'J1' })
  T.on('/api/promocoes/job/', () => { throw new Error('queda do servidor') })                 // polling cai
  const antes = T.log.filter(l => l.url.startsWith('/api/promocoes/plano?')).length
  await T.clicar('plano-executar'); await tick()
  assert.ok(T.log.filter(l => l.url.startsWith('/api/promocoes/plano?')).length > antes, 'o plano não foi recarregado')
  const html = T.el('conteudo').innerHTML
  assert.match(html, /data-acao="plano-executar" disabled/); assert.match(html, /pode ter enviado chamadas/); assert.match(html, /data-acao="plano-recarregar"/)
  assert.match(T.el('toastErro').textContent, /confira a Auditoria/)
  await T.clicar('plano-recarregar'); await tick()                                            // recarregou: libera
  assert.match(T.el('conteudo').innerHTML, /data-acao="plano-executar" >Executar/)
})

await caso('33 · job que termina com o usuário em outra aba não pinta por cima dela; respostas fora de ordem não valem', async () => {
  const T = criarTela(); await tick(); T.quem('David')
  await T.app.abrir('A', 'elegiveis', false); await tick()
  const dJob = defer(), dPlano = defer()
  T.on('/api/promocoes/plano', url => (url.startsWith('/api/promocoes/plano?') ? dPlano.promise : { job: 'J2' }))
  T.on('/api/promocoes/job/', () => dJob.promise)
  const clique = T.clicar('plano-gerar'); await tick()
  await T.app.mostrarAba('auditoria', false); await tick()                                   // usuário foi para a Auditoria durante o job
  assert.match(T.el('conteudo').innerHTML, /Sem eventos ainda/)
  dJob.resolve({ estado: 'ok', resultado: { id: 'PL9' } }); dPlano.resolve({ plano: null }); await clique; await tick()
  assert.match(T.el('conteudo').innerHTML, /Sem eventos ainda/); assert.doesNotMatch(T.el('conteudo').innerHTML, /Gerar plano/)
  // duas buscas na mesma aba, a segunda responde primeiro: vale a mais nova
  await T.app.mostrarAba('elegiveis', false); await tick()
  const d1 = defer(), d2 = defer(); let k = 0
  T.on('/api/promocoes/elegiveis', () => (++k === 1 ? d1.promise : d2.promise))
  const p1 = T.app.abaElegiveis(), p2 = T.app.abaElegiveis()
  d2.resolve(elegDe([linhaDe('NOVO')])); await p2
  d1.resolve(elegDe([linhaDe('VELHO')])); await p1.catch(() => {}); await tick()
  assert.match(T.el('elCorpo').innerHTML, /NOVO/); assert.doesNotMatch(T.el('elCorpo').innerHTML, /VELHO/)
})

await caso('33 · a barra de filtros não é repintada (o que se digita durante o fetch não se perde)', async () => {
  const T = criarTela(); await tick()
  await T.app.abrir('A', 'elegiveis', false); await tick()
  const fq = T.el('fQ'); assert.ok(fq)
  fq.value = 'abc'
  await T.app.abaElegiveis(); await tick()
  assert.equal(T.el('fQ'), fq, 'o <input> foi recriado'); assert.equal(T.el('fQ').value, 'abc')
})

await caso('51 · acompanhar() segue o job do cliente que o iniciou: trocar de cliente não gera 404 nem toast de erro', async () => {
  const T = criarTela(); await tick(); T.quem('David')
  await T.app.abrir('A', 'elegiveis', false); await tick()
  const dJob = defer(); let polls = 0
  T.on('/api/promocoes/coletar', { job: 'JC' })
  T.on('/api/promocoes/job/', url => { polls++; return polls === 1 ? { estado: 'rodando', progresso: { fase: 'x', feitos: 1, total: 2 } } : dJob.promise })
  const col = T.app.coletar(); await tick()
  await T.app.abrir('B', 'elegiveis', false); await tick()                                   // troca de cliente no meio do job
  dJob.resolve({ estado: 'ok', resultado: { campanhas: 1, campanhas_rebate: 1, anuncios_lidos: 3 } }); await col; await tick()
  const polls_url = T.log.filter(l => l.url.startsWith('/api/promocoes/job/')).map(l => l.url)
  assert.ok(polls_url.length >= 2 && polls_url.every(u => u.endsWith('cliente=A')), polls_url.join(' | '))
  assert.equal(T.el('toastErro').textContent, ''); assert.match(T.el('toast').textContent, /Coleta de A concluída/)
  assert.equal(T.app.S.cliente, 'B'); assert.equal(T.app.S.resumo.cliente, 'B')                // não repintou B com o resumo de A
})

await caso('52 · página fora do intervalo na tela: refaz na última válida e mostra o paginador', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/elegiveis', url => { const p = Number(/pagina=(\d+)/.exec(url)[1]); return p > 2 ? elegDe([], { total: 60, total_base: 60, pagina: p }) : elegDe([linhaDe('MLB' + p)], { total: 60, total_base: 60, pagina: p }) })
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.app.S.f.pagina = 3; await T.app.abaElegiveis(); await tick()
  assert.equal(T.app.S.f.pagina, 2)
  assert.match(T.el('elCorpo').innerHTML, /pr-pag/); assert.match(T.el('elCorpo').innerHTML, /página 2 de 2/); assert.doesNotMatch(T.el('elCorpo').innerHTML, /Nenhum anúncio com esses filtros/)
})

await caso('53 · select de janela mostra a janela da config (10) e o CSV leva a janela da tela', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/participando', () => ({ dias: 10, cobertura: { alertas: [], excecoes: [] }, rebate_pior: [], derrubadas: null, participando: [] }))
  await T.app.abrir('A', 'participando', false); await tick()
  const h = T.el('conteudo').innerHTML
  assert.match(h, /<option value="10" selected>10<\/option>/); assert.match(h, /exportar\.csv\?cliente=A&tipo=descobertos&dias=10/)
})

await caso('54 · "Aplicar analista" e "Coletar" sem "Seu nome": nada é enviado; com nome, a autoria vai junto', async () => {
  const T = criarTela(); await tick()
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.on('/api/promocoes/analista', () => ({ recomendacoes: [], vigias: { cobertura: { alertas: [] }, rebatePior: [] }, invariante: { ok: true } }))
  T.on('/api/promocoes/coletar', { job: 'JC' }); T.on('/api/promocoes/job/', { estado: 'ok', resultado: { campanhas: 0, campanhas_rebate: 0, anuncios_lidos: 0 } })
  T.sandbox.confirm = () => true
  await T.clicar('analista-aplicar'); await T.clicar('analista-aplicar-ok'); await T.app.coletar(); await T.clicar('plano-sync')
  assert.equal(T.log.filter(l => l.metodo === 'POST').length, 0, 'gravou sem nome: ' + JSON.stringify(T.log.filter(l => l.metodo === 'POST')))
  assert.match(T.el('toastErro').textContent, /Seu nome/)
  T.quem('Marcia')
  await T.clicar('analista-aplicar'); await T.clicar('analista-aplicar-ok'); await T.app.coletar(); await tick()   // 32: aplicar passa pela confirmação em linha
  const posts = T.log.filter(l => l.metodo === 'POST')
  assert.equal(posts.find(p => p.url === '/api/promocoes/analista').body.por, 'Marcia'); assert.equal(posts.find(p => p.url === '/api/promocoes/coletar').body.por, 'Marcia')
})

await caso('55 · plano aprovado e EXPIRADO não mostra "Executar este plano"', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.execucao = { habilitada: true, max_itens: 1 } }))
  T.on('/api/promocoes/planos', [{ id: 'PL1', criado_em: '2026-10-05T12:00:00Z', estado: 'aprovado', resumo: { entrar: 1 } }])
  T.on('/api/promocoes/plano?', { plano: planoDe({ expirado: true }) })
  await T.app.abrir('A', 'plano', false); await tick()
  assert.doesNotMatch(T.el('conteudo').innerHTML, /plano-executar/); assert.match(T.el('conteudo').innerHTML, /EXPIRADO/)
})

await caso('56 · "Aprovar todas": confirmação em linha com contagem e escopo (sem confirm()); só o "Confirmar" grava', async () => {
  const T = criarTela(); await tick(); T.quem('David')
  const PEND = [{ item_id: 'MLB1', pid: 'P1', preco: 95, mc_pct: 30.68 }, { item_id: 'MLB2', pid: 'P2', preco: null, mc_pct: null }]
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.sugestoes_pendentes = PEND }))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.app.S.f.curva = 'A'
  await T.clicar('aprovar-todas')                                                            // confirm() lançaria erro se fosse chamado
  const h = T.el('confTodas').innerHTML
  assert.match(h, /Aprovar 2 anúncio\(s\)/); assert.match(h, /TODO o cliente/); assert.match(h, /filtros da tela NÃO limitam/)
  assert.equal(T.log.filter(l => l.url === '/api/promocoes/aprovar-analista').length, 0)
  T.on('/api/promocoes/aprovar-analista', { aprovadas: 2 })
  await T.clicar('aprovar-todas-ok'); await tick()
  const post = T.log.find(l => l.url === '/api/promocoes/aprovar-analista'); assert.deepEqual(post.body, { cliente: 'A', itens: PEND, por: 'David' }, 'rev3 #4: envia a lista exibida COM os números (nunca todos:true)')
  assert.equal(T.el('confTodas').innerHTML, '')
})

await caso('57 · chip na tela: imposto do fallback custos_cliente não é "não configurado"', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.config.imposto_pct = null; r.custos_cliente = { imposto_pct: 12 } }))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  assert.match(T.el('chips').innerHTML, /imposto 12,0% \(fallback custos_cliente\)/); assert.doesNotMatch(T.el('chips').innerHTML, /não configurado/)
})

await caso('58 · foco volta ao mesmo elemento (por id) depois de repintar o conteúdo', async () => {
  const T = criarTela(); await tick()
  await T.app.abrir('A', 'participando', false); await tick()
  // a resposta de /participando repinta o conteúdo enquanto o select da janela está focado (mudar a janela não pode derrubar o foco)
  T.el('selDias').focus(); const foco0 = T.el('selDias')
  await T.el('selDias').onchange({ target: { value: '14' } }); await tick()
  assert.notEqual(T.el('selDias'), foco0, 'o select deveria ter sido recriado'); assert.equal(T.doc.activeElement, T.el('selDias'), 'o foco não voltou ao select')
})


await caso('52 · fim do job só reabilita o que o job desabilitou (botão que nasceu desabilitado, ex.: "Próxima →" na última página, continua assim)', async () => {
  const T = criarTela(); await tick()
  T.app.S.cliente = 'A'
  const normal = { disabled: false, dataset: {} }, nasceuOff = { disabled: true, dataset: {} }, raiz = { querySelectorAll: () => [normal, nasceuOff] }
  T.app.S.jobs.A = 'coletando'; T.app.sincOcupado(raiz)
  assert.equal(normal.disabled, true); assert.equal(nasceuOff.disabled, true)
  delete T.app.S.jobs.A; T.app.sincOcupado(raiz)
  assert.equal(normal.disabled, false, 'o botão do job deveria voltar'); assert.equal(nasceuOff.disabled, true, 'o botão que nasceu desabilitado foi reabilitado')
})

await caso('33 · "Detalhes" aberto sobrevive ao repaint (S.abertos) e o botão informa aria-expanded', async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB1'), linhaDe('MLB2')]))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.app.S.abertos.add('MLB2'); await T.app.abaElegiveis(); await tick()
  const h = T.el('elCorpo').innerHTML
  assert.match(h, /data-item="MLB2" aria-expanded="true">Fechar/); assert.match(h, /data-item="MLB1" aria-expanded="false">Detalhes/)
  assert.equal((h.match(/<tr class="det" hidden>/g) || []).length, 1)
})

// ═════════ rev2 · 2ª rodada de correções da frente UI (idx 6–13, 16, 25–32) ═════════════════════════════
const cont = (T, prefixo) => T.log.filter(l => l.url.startsWith(prefixo)).length
const invDe = (ok, janelas) => ({ ok, itens: [{ encontrado: ok ? 0 : 1, rotulo: 'elegíveis ≥ piso sem decisão' }], coleta_fresca: true, readback: { elegiveis_ge_piso: 3, protegidos_descobertos: 6, rebate_pior: 0, janelas: janelas || [{ dias: 7, descobertos: 3 }, { dias: 14, descobertos: 3 }] } })

await caso('rev2 #6 · série de vendas VAZIA (disponivel:true, ate:null, 0 dias com dado) = "sem dados de vendas", nunca R$ 0,00 / Curva C / Descobertos 0', async () => {
  assert.equal(P.semVendas({ vendas: { disponivel: true, ate: null, cobertura: { dias_com_dado: 0 } } }), true)
  assert.equal(P.semVendas({ vendas: { disponivel: true, ate: '2026-10-05', cobertura: { dias_com_dado: 0 } } }), true)
  assert.equal(P.semVendas({ vendas: { disponivel: true, ate: '2026-10-05', cobertura: { dias_com_dado: 12 } } }), false)
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('V', r => { r.vendas = { disponivel: true, ate: null, motivo: '', cobertura: { janela_dias: 30, dias_com_dado: 0, completa: false } }; r.kpis.descobertos = 0 }))
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB1', { curva: 'C', fat30: 0 })]))
  await T.app.abrir('V', 'elegiveis', false); await tick()
  const corpo = T.el('elCorpo').innerHTML
  assert.doesNotMatch(corpo, /R\$ 0,00/); assert.doesNotMatch(corpo, /curva cC/); assert.match(corpo, /sem série de vendas: curva indeterminada/)
  assert.match(T.el('kpis').innerHTML, /Descobertos<\/div><div class="valor">—<\/div>/); assert.match(T.el('status').innerHTML, /sem dados de vendas/)
  await T.app.mostrarAba('participando', false); await tick()
  assert.doesNotMatch(T.el('conteudo').innerHTML, /Nenhum protegido descoberto nesta janela/)
})

await caso('rev2 #7/#16 · "CONFIRMAR COBERTURA" tem selo e texto próprios, data sem negrito, tabela separada e KPI "Cobertura incerta" à parte', async () => {
  assert.equal(P.ehIncerta({ incerta: true }), true); assert.equal(P.ehIncerta({ saida: 'CONFIRMAR COBERTURA' }), true); assert.equal(P.ehIncerta({ saida: 'MARCAR' }), false)
  const T = criarTela(); await tick()
  const alerta = o => ({ item_id: 'MLB1', sku: 'S1', titulo: 'Anúncio 1', curva: 'A', fat30: 500, protegido: false, cobreAte: null, cobreAteRebate: null, cobreAteSemRebate: null, voltaEm: null, suspeita: false, saida: 'SUGERIR MANUAL', manualNota: 'nota manual', marcaCobre: false, melhorCobre: null, ...o })
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.kpis.descobertos = 1; r.kpis.cobertura_incerta = 1 }))
  T.on('/api/promocoes/participando', () => ({ dias: 7, cobertura: { alertas: [alerta({}), alerta({ item_id: 'MLB2', titulo: 'Anúncio 2', cobreAte: '2027-03-01', cobreAteRebate: '2027-03-01', suspeita: true, incerta: true, saida: 'CONFIRMAR COBERTURA', manualNota: 'cobertura INCERTA: confirme em /items/MLB2/prices' })], excecoes: [] }, rebate_pior: [], derrubadas: null, participando: [] }))
  await T.app.abrir('A', 'participando', false); await tick()
  const h = T.el('conteudo').innerHTML
  assert.equal((h.match(/SUGERIR MANUAL/g) || []).length, 1, 'só o MLB1 é "sugerir manual"'); assert.match(h, /CONFIRMAR COBERTURA/); assert.match(h, /Cobertura incerta — confirmar \(1\)/)
  assert.doesNotMatch(h, /<b>01\/03\/2027<\/b>/, 'data suspeita não pode aparecer em negrito de fato'); assert.match(h, /cobertura incerta<\/span><div class="mudo peq">data só da campanha-mãe: 01\/03\/2027/)
  assert.match(T.el('kpis').innerHTML, /Cobertura incerta<\/div><div class="valor">1<\/div>/); assert.match(T.el('kpis').innerHTML, /Descobertos<\/div><div class="valor">1<\/div>/)
})

await caso('rev2 #8 · "Derrubadas antes do prazo" lê o que a coleta grava (contagens + lista); sem lista, mostra a contagem — nunca some', async () => {
  const T = criarTela(); await tick()
  const base = { dias: 7, cobertura: { alertas: [], excecoes: [] }, rebate_pior: [], participando: [] }
  T.on('/api/promocoes/participando', () => ({ ...base, derrubadas: { derrubadas: 3, vencidas: 1, sem_prazo: 0, saiu_da_coleta: 0, desde: '2026-10-04T10:00:00Z' } }))
  await T.app.abrir('A', 'participando', false); await tick()
  let h = T.el('conteudo').innerHTML
  assert.match(h, /Derrubadas antes do prazo \(3\)/); assert.match(h, /lista item a item não foi gravada/); assert.match(h, /1 já venceram/)
  T.on('/api/promocoes/participando', () => ({ ...base, derrubadas: { derrubadas: 1, vencidas: 0, sem_prazo: 0, saiu_da_coleta: 0, desde: '2026-10-04T10:00:00Z', lista: [{ item_id: 'MLB77', pid: 'P-77', fim: '2026-12-01' }] } }))
  await T.app.mostrarAba('participando', false); await tick(); h = T.el('conteudo').innerHTML
  assert.match(h, /MLB77/); assert.match(h, /P-77/); assert.match(h, /01\/12\/2026/); assert.doesNotMatch(h, /lista item a item não foi gravada/)
  T.on('/api/promocoes/participando', () => ({ ...base, derrubadas: { derrubadas: 0, vencidas: 2, sem_prazo: 1, saiu_da_coleta: 0, desde: '2026-10-04T10:00:00Z', lista: [] } }))
  await T.app.mostrarAba('participando', false); await tick()
  assert.doesNotMatch(T.el('conteudo').innerHTML, /Derrubadas antes do prazo/, 'zero derrubada = sem seção')
})

await caso('rev2 #9 · aprovar sugestão barrada por recusa do dono: o toast diz que foi barrada (vermelho), nunca "aprovada"; a contagem de "Aprovar todas" exclui as barradas', async () => {
  assert.deepEqual({ ...P.desfechoAprovacao({ aprovadas: 0, bloqueadas_por_recusa: 1 }) }, { ruim: true, msg: 'Nenhuma sugestão aprovada · 1 bloqueada(s) por recusa do dono' })
  assert.equal(P.desfechoAprovacao({ aprovadas: 2, bloqueadas_por_recusa: 0 }).ruim, false); assert.match(P.desfechoAprovacao({ aprovadas: 1, bloqueadas_por_recusa: 2 }).msg, /1 sugestão\(ões\) aprovada\(s\) · 2 bloqueada\(s\) por recusa do dono/)
  assert.match(P.textoAprovarTodas(3, false, 2), /2 sugestão\(ões\) barrada\(s\)/)
  const T = criarTela(); await tick(); T.quem('David')
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.kpis.sugeridas = 2; r.kpis.sugeridas_barradas = 1 }))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.on('/api/promocoes/aprovar-analista', { aprovadas: 0, bloqueadas_por_recusa: 1 })
  await T.clicar('aprovar', { item: 'MLB31', pid: 'P1' }); await tick()
  assert.match(T.el('toastErro').textContent, /Nenhuma sugestão aprovada · 1 bloqueada\(s\) por recusa do dono/); assert.doesNotMatch(T.el('toast').textContent, /aprovada/)
  await T.clicar('aprovar-todas')
  assert.match(T.el('confTodas').innerHTML, /Aprovar 2 anúncio\(s\)/); assert.match(T.el('confTodas').innerHTML, /1 sugestão\(ões\) barrada\(s\)/)
  T.on('/api/promocoes/aprovar-analista', { aprovadas: 1, bloqueadas_por_recusa: 1 })
  await T.clicar('aprovar-todas-ok'); await tick()
  assert.match(T.el('toastErro').textContent, /1 sugestão\(ões\) aprovada\(s\) · 1 bloqueada\(s\) por recusa do dono/)
})

await caso('rev2 #10 · remover regra / desativar aprendizado recarregam o resumo: o banner "Rodada fechada" não fica verde e velho', async () => {
  const T = criarTela(); await tick(); T.quem('David'); T.sandbox.confirm = () => true
  let k = 0
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.invariante = invDe(k++ === 0) }))
  T.on('/api/promocoes/regras-sku', () => []); T.on('/api/promocoes/aprendizados/desativar', { ok: true })
  T.on('/api/promocoes/interrogatorio', { resumoTexto: 'x', grupos: [], lembretes: [], aprendizados: [], revisaoFeita: false })
  await T.app.abrir('A', 'regras', false); await tick()
  assert.match(T.el('invariante').innerHTML, /✔ Rodada fechada/)
  await T.clicar('rm-regra', { mlb: 'MLB42', sku: '' }); await tick()
  assert.match(T.el('invariante').innerHTML, /✖ Rodada NÃO está fechada/, 'o banner precisa ser recalculado depois de remover a regra')
  await T.app.mostrarAba('interrogatorio', false); await tick()
  const antes = cont(T, '/api/promocoes/resumo')
  await T.clicar('off-aprend', { id: '1' }); await tick()
  assert.ok(cont(T, '/api/promocoes/resumo') > antes, 'desativar aprendizado precisa recarregar o resumo/invariante')
})

await caso('rev2 #11 · desfecho da execução: enviada | interrompida | erro | nada enviado, pelo resultado real (nunca "enviada" sem POST)', async () => {
  const rs = (o = {}) => ({ chamadas: 0, entrou_provado: 0, sem_prova_ainda: 0, incertas: 0, recusadas: 0, nao_enviadas: 0, ...o })
  const env = P.desfechoExecucao('A', { estado: 'executado', resumo: rs({ chamadas: 1, sem_prova_ainda: 1 }), chamadas: [{ chamada: {}, estado_final: 'enviado_sem_prova_ainda' }] })
  assert.equal(env.tipo, 'enviada'); assert.equal(env.ruim, false); assert.match(env.msg, /Execução de A enviada: 1 chamada\(s\)/)
  const nada = P.desfechoExecucao('A', { estado: 'executado', resumo: rs({ nao_enviadas: 1 }), chamadas: [{ chamada: null, resposta: 'o pre-check ao vivo barrou — MC viva < aprovada', estado_final: 'nao_enviada' }] })
  assert.equal(nada.tipo, 'nada'); assert.equal(nada.ruim, true); assert.match(nada.msg, /Nada foi enviado.*pre-check ao vivo barrou — MC viva < aprovada/); assert.doesNotMatch(nada.msg, /enviada:/)
  const int0 = P.desfechoExecucao('A', { estado: 'erro', interrompido: 'a chave 1 foi DESLIGADA', resumo: rs({ nao_enviadas: 1 }), chamadas: [] })
  assert.equal(int0.tipo, 'erro'); assert.equal(int0.ruim, true); assert.match(int0.msg, /ERRO: nenhuma chamada foi enviada\. a chave 1 foi DESLIGADA/)
  const int1 = P.desfechoExecucao('A', { estado: 'executado_parcial', interrompido: 'a chave 1 foi DESLIGADA', resumo: rs({ chamadas: 1, nao_enviadas: 1 }), chamadas: [] })
  assert.equal(int1.tipo, 'interrompida'); assert.match(int1.msg, /INTERROMPIDA: 1 chamada\(s\) enviada\(s\), 1 não enviada\(s\)/); assert.match(int1.msg, /Confira a Auditoria/)
  const ni = P.desfechoExecucao('A', { estado: 'nao_iniciada', motivo: 'execução DESLIGADA' })
  assert.equal(ni.tipo, 'nada'); assert.match(ni.msg, /NÃO foi iniciada.*execução DESLIGADA/)
  assert.equal(P.desfechoExecucao('A', { estado: 'executado', resumo: rs({ chamadas: 2, recusadas: 1, nao_enviadas: 1 }) }).ruim, true, 'enviada com recusada/não enviada não é verde')
  // na tela: chave 1 desligada durante a execução -> toast VERMELHO com o motivo; o motivo e a resposta por chamada ficam no bloco de resultado e o alerta persiste (plano "erro")
  const T = criarTela(); await tick(); T.quem('David')
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.config.execucao_habilitada = 1; r.execucao = { habilitada: true, max_itens: 1 } }))
  const motivo = 'a chave 1 (execucao_habilitada) foi DESLIGADA durante a execução: o restante não foi enviado'
  const resultado = { plano: 'PL1', estado: 'erro', interrompido: motivo, resumo: rs({ nao_enviadas: 1, nota: 'nota' }), chamadas: [{ item_id: 'MLB1', pid: 'P1', campanha: 'Camp', chamada: null, status_http: null, resposta: 'execução interrompida: ' + motivo, estado_final: 'nao_enviada' }] }
  let depois = false
  T.on('/api/promocoes/planos', [{ id: 'PL1', criado_em: '2026-10-05T12:00:00Z', estado: 'aprovado', resumo: { entrar: 1 } }])
  T.on('/api/promocoes/plano?', () => ({ plano: depois ? planoDe({ estado: 'erro', executado_em: '2026-10-05T13:00:00Z', resultado: { por: 'David', ...resultado } }) : planoDe() }))
  await T.app.abrir('A', 'plano', false); await tick()
  T.sandbox.prompt = () => 'EXECUTAR'
  T.on('/api/promocoes/plano/executar', () => { depois = true; return { job: 'J1' } }); T.on('/api/promocoes/job/', { estado: 'concluido', resultado })
  await T.clicar('plano-executar'); await tick()
  assert.match(T.el('toastErro').textContent, /ERRO: nenhuma chamada foi enviada.*DESLIGADA/); assert.doesNotMatch(T.el('toast').textContent, /enviada\./)
  const h = T.el('conteudo').innerHTML
  assert.match(h, /Execução com ERRO — nenhuma chamada enviada/); assert.match(h, /DESLIGADA durante a execução/); assert.match(h, /Resposta \/ motivo/); assert.match(h, /execução interrompida: a chave 1/)
})

await caso('rev2 #12 · S.planoId só muda DEPOIS do plano novo ser lido: leitura falha => aprovar age sobre o plano que a tela mostra', async () => {
  const T = criarTela(); await tick(); T.quem('David'); T.sandbox.confirm = () => true
  T.on('/api/promocoes/plano', url => (url.includes('id=PL-NEW') ? T.erro(500, 'falha ao ler PL-NEW') : { job: 'JP' }))     // genérico primeiro: os específicos (registrados depois) vencem
  T.on('/api/promocoes/planos', [{ id: 'PL-A', criado_em: '2026-10-05T12:00:00Z', estado: 'dry-run', resumo: { entrar: 1 } }, { id: 'PL-B', criado_em: '2026-10-05T11:00:00Z', estado: 'dry-run', resumo: { entrar: 1 } }])
  T.on('/api/promocoes/plano?', url => (url.includes('id=PL-B') || url.includes('id=PL-NEW') ? T.erro(500, 'falha ao ler o plano') : { plano: planoDe({ id: 'PL-A', estado: 'dry-run', execucao_habilitada: false }) }))
  T.on('/api/promocoes/job/', { estado: 'concluido', resultado: { id: 'PL-NEW' } })
  await T.app.abrir('A', 'plano', false); await tick()
  assert.equal(T.app.S.planoId, 'PL-A'); assert.match(T.el('conteudo').innerHTML, /data-plano="PL-A" data-acao="plano-aprovar"/, 'o botão carrega o plano que está pintado')
  await T.el('selPlano').onchange({ target: { value: 'PL-B' } }); await tick()
  assert.equal(T.app.S.planoId, 'PL-A', 'a leitura de PL-B falhou: a tela segue em PL-A'); assert.equal(T.el('selPlano').value, 'PL-A'); assert.match(T.el('toastErro').textContent, /Não consegui abrir o plano escolhido/)
  T.on('/api/promocoes/plano/aprovar', { plano: planoDe({ id: 'PL-A', estado: 'aprovado' }) })
  await T.clicar('plano-aprovar'); await tick()
  assert.equal(T.log.find(l => l.url === '/api/promocoes/plano/aprovar').body.id, 'PL-A', 'aprovou o plano que a tela mostra, não o escolhido que não carregou')
  // plano recém-gerado que não carrega: S.planoId também não muda antes da leitura
  await T.clicar('plano-gerar'); await tick()
  assert.equal(T.app.S.planoId, 'PL-A')
})

await caso('rev2 #13 · estados vazios de Participando e Custos respeitam a coleta: sem coleta concluída nunca "nenhum/todos" como fato', async () => {
  assert.match(P.vazioFato({ coleta: { estado: 'parcial' } }, 'que X', 'Nenhum X.'), /^Sem leitura confiável \(coleta parcial\): não dá para afirmar que X/)
  assert.match(P.vazioFato({ coleta: null }, 'que X', 'Nenhum X.'), /^Sem coleta/); assert.equal(P.vazioFato({ coleta: { estado: 'concluida' } }, 'que X', 'Nenhum X.'), 'Nenhum X.')
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('P', r => { r.coleta = { estado: 'parcial', concluida_em: null, resumo: { leituras_falhas: 2 } }; r.frescor = { fresca: false, idade_horas: null, motivo: 'parcial' } }))
  T.on('/api/promocoes/custos', () => ({ skus: [], sem_custo: [], skus_sem_custo: [], percentuais: null, config: { piso_mc: 20, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, execucao_max_itens: 1, hedge_cobertura: 1 } }))
  await T.app.abrir('P', 'participando', false); await tick()
  let h = T.el('conteudo').innerHTML
  assert.doesNotMatch(h, /Nenhum caso de rebate pior no ar\./); assert.doesNotMatch(h, /Nenhum anúncio com participação ativa nesta coleta\./); assert.match(h, /Sem leitura confiável \(coleta parcial\)/)
  await T.app.mostrarAba('custos', false); await tick(); h = T.el('conteudo').innerHTML
  assert.doesNotMatch(h, /Nenhum anúncio elegível sem custo\./); assert.doesNotMatch(h, /Todos os SKUs têm custo\./); assert.match(h, /Sem leitura confiável \(coleta parcial\)/)
  // 30: campos percentuais aceitam 7,3% / 12,3% (step any); inteiros step 1; nenhum step 0.5
  assert.match(h, /name="imposto_pct" type="number" step="any"/); assert.match(h, /name="piso_mc" type="number" step="any"/); assert.match(h, /name="piso_relampago" type="number" step="any"/)
  assert.match(h, /name="dias_vigia" type="number" step="1"/); assert.doesNotMatch(h, /step="0\.5"/)
})

await caso('rev2 #25 · coleta parcial/erro e falha de "atualizar vendas antes" saem como toast de erro com o motivo, não "concluída"', async () => {
  assert.equal(P.desfechoColeta('A', { estado: 'concluida', campanhas: 1, campanhas_rebate: 1, anuncios_lidos: 3 }).ruim, false)
  const T = criarTela(); await tick(); T.quem('David')
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.on('/api/promocoes/coletar', { job: 'JC' })
  T.on('/api/promocoes/job/', { estado: 'concluido', resultado: { estado: 'parcial', leituras_falhas: 3, campanhas: 1, campanhas_rebate: 1, anuncios_lidos: 1, vendas: { erro: 'timeout na série' } } })
  await T.app.coletar(); await tick()
  assert.match(T.el('toastErro').textContent, /Coleta de A PARCIAL/); assert.match(T.el('toastErro').textContent, /3 leitura\(s\) falharam/); assert.match(T.el('toastErro').textContent, /vendas NÃO atualizadas: timeout na série/)
  assert.doesNotMatch(T.el('toast').textContent, /concluída/)
  T.on('/api/promocoes/job/', { estado: 'concluido', resultado: { estado: 'concluida', campanhas: 1, campanhas_rebate: 1, anuncios_lidos: 1, vendas: { erro: 'sem permissão' } } })
  await T.app.coletar(); await tick()
  assert.match(T.el('toastErro').textContent, /Coleta de A concluída.*vendas NÃO atualizadas: sem permissão/, 'só a falha das vendas já basta para toast de erro')
})

await caso('rev2 #26 · abrir() com um resumo mais novo do mesmo cliente passando na frente refaz o resumo: a aba não pinta com S.resumo nulo', async () => {
  const T = criarTela(); await tick()
  const d1 = defer(), d2 = defer(); let k = 0
  T.on('/api/promocoes/resumo?cliente=', () => (++k === 1 ? d1.promise : k === 2 ? d2.promise : resumoDe('A')))
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB1')]))
  const p = T.app.abrir('A', 'elegiveis', false); await tick()
  const q = T.app.recarregarResumo(); await tick()                               // refresh de fim de coleta/aposGravar: resumo #2 em voo; o #1 vai ficar obsoleto
  d1.resolve(resumoDe('A')); await p; await tick()
  assert.ok(T.app.S.resumo, 'S.resumo nulo depois do abrir'); assert.match(T.el('elCorpo').innerHTML, /curva cA/, 'a tabela pintou com S.resumo nulo (curva "—")')
  d2.resolve(resumoDe('A')); await q
})

await caso('rev2 #27 · fim da coleta atualiza só status/KPIs em aba com formulário (Custos); aba de dados (Elegíveis) é repintada', async () => {
  assert.equal(P.ABAS_FORM.has('custos') && P.ABAS_FORM.has('regras') && P.ABAS_FORM.has('interrogatorio'), true); assert.equal(P.ABAS_FORM.has('elegiveis'), false)
  const T = criarTela(); await tick(); T.quem('David')
  T.on('/api/promocoes/custos', () => ({ skus: [], sem_custo: [], skus_sem_custo: [], percentuais: null, config: { piso_mc: 20, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, execucao_max_itens: 1, hedge_cobertura: 1 } }))
  T.on('/api/promocoes/coletar', { job: 'JC' }); T.on('/api/promocoes/job/', { estado: 'concluido', resultado: { estado: 'concluida', campanhas: 1, campanhas_rebate: 1, anuncios_lidos: 1 } })
  await T.app.abrir('A', 'custos', false); await tick()
  const c0 = cont(T, '/api/promocoes/custos'), r0 = cont(T, '/api/promocoes/resumo')
  await T.app.coletar(); await tick()
  assert.equal(cont(T, '/api/promocoes/custos'), c0, 'a aba Custos foi repintada no fim da coleta (apagaria o que o dono colou)'); assert.ok(cont(T, '/api/promocoes/resumo') > r0, 'o resumo/KPIs precisam atualizar')
  await T.app.mostrarAba('elegiveis', false); await tick()
  const e0 = cont(T, '/api/promocoes/elegiveis'); await T.app.coletar(); await tick()
  assert.ok(cont(T, '/api/promocoes/elegiveis') > e0, 'aba de dados é repintada com a coleta nova')
})

await caso('rev2 #28 · read-back mostra a janela do KPI e as outras por janela — não soma 7d+14d', async () => {
  assert.equal(P.textoReadback(invDe(true), 7), 'read-back: 3 elegíveis ≥ piso, 3 protegidos descobertos em 7d (janela do KPI) · 14d: 3 (o mesmo anúncio conta 1× por janela), 0 rebate-pior')
  assert.match(P.textoReadback(invDe(true), 14), /3 protegidos descobertos em 14d \(janela do KPI\) · 7d: 3/)
  assert.match(P.textoReadback({ readback: { elegiveis_ge_piso: 1, protegidos_descobertos: 6, rebate_pior: 0 } }, 7), /6 alerta\(s\) de cobertura \(anúncio×janela\)/, 'backend sem janelas: rotula a soma como alertas anúncio×janela')
  const T = criarTela(); await tick()
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.invariante = invDe(true); r.kpis.descobertos = 3 }))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  assert.match(T.el('invariante').innerHTML, /3 protegidos descobertos em 7d/); assert.doesNotMatch(T.el('invariante').innerHTML, /6 protegidos descobertos/)
  assert.match(T.el('kpis').innerHTML, /Descobertos<\/div><div class="valor">3<\/div>/)
})

await caso('rev2 #29 · coleta parcial + filtro que zera a tabela: "Nenhum anúncio com esses filtros" (o aviso da coleta vai à parte)', () => {
  const r = { coleta: { estado: 'parcial' }, pendencias: [] }
  const m = P.vazioElegiveis(r, { total_base: 40, total: 0 })
  assert.match(m, /^Nenhum anúncio com esses filtros\./); assert.doesNotMatch(m, /não dá para afirmar/); assert.match(m, /Coleta parcial: a base pode estar incompleta/)
  assert.match(P.vazioElegiveis(r, { total_base: 0, total: 0 }), /não dá para afirmar que a conta não tem anúncios elegíveis/, 'sem base nenhuma continua não afirmando')
  assert.equal(P.vazioElegiveis({ coleta: { estado: 'concluida' }, pendencias: [] }, { total_base: 40, total: 0 }), 'Nenhum anúncio com esses filtros.')
})

await caso('rev2 #31 · aba Relâmpago: marca do analista é 🤖 (rodada de X); só origem "humano" aparece como 👤', async () => {
  assert.equal(P.ehMarcaHumana({ origem: 'humano' }), true); assert.equal(P.ehMarcaHumana({ origem: 'analista' }), false); assert.equal(P.ehMarcaHumana({}), false, 'origem desconhecida nunca vira decisão do dono')
  const T = criarTela(); await tick()
  T.on('/api/promocoes/relampago', () => ({ avisos: [], lightning_ignoradas: 0, itens: [{ item_id: 'MLB1', sku: 'S', titulo: 'T', curva: 'A', fat30: 10, piso: 19, custo: { ok: true }, candidatos: [], vivas: [], sugerida: null, motivoSemMarca: '', marcadas: [{ pid: 'P1', origem: 'analista', por: 'Ana' }, { pid: 'P2', origem: 'humano', por: 'David' }] }] }))
  await T.app.abrir('A', 'relampago', false); await tick()
  const h = T.el('conteudo').innerHTML
  assert.match(h, /🤖 gravada na rodada de Ana/); assert.match(h, /👤 David/); assert.doesNotMatch(h, /👤 Ana/)
})

await caso('rev2 #32 · "Aplicar analista" avisa ANTES quantas aprovações 🤖 estão em risco e exige confirmação em linha; depois informa as revogadas', async () => {
  assert.match(P.textoAplicar(2), /Você tem 2 aprovação\(ões\) 🤖: as que ficarem com preço ou MC% diferente.*REVOGADAS/)
  assert.match(P.textoAplicar(0), /Nenhuma aprovação 🤖 sua está em risco/); assert.match(P.textoAplicar(undefined), /REVOGADAS.*não traz a contagem exata/)
  const T = criarTela(); await tick(); T.quem('David')
  let aplicado = false
  T.on('/api/promocoes/resumo?cliente=', () => resumoDe('A', r => { r.kpis.aprovadas_analista = aplicado ? 0 : 2 }))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  T.on('/api/promocoes/analista', () => { aplicado = true; return { recomendacoes: [], vigias: { cobertura: { alertas: [] }, rebatePior: [] }, invariante: { ok: true } } })
  await T.clicar('analista-aplicar')                                              // confirm() lançaria erro; nada pode ser gravado ainda
  assert.match(T.el('confTodas').innerHTML, /Você tem 2 aprovação\(ões\) 🤖/); assert.equal(T.log.filter(l => l.url === '/api/promocoes/analista').length, 0, 'gravou sem a confirmação em linha')
  await T.clicar('analista-aplicar-ok'); await tick()
  assert.equal(T.log.filter(l => l.url === '/api/promocoes/analista' && l.body.aplicar === true).length, 1)
  assert.match(T.el('toastErro').textContent, /⚠ 2 aprovação\(ões\) 🤖 REVOGADA\(S\)/, 'o dono precisa saber que as aprovações caíram'); assert.equal(T.el('confTodas').innerHTML, '')
})

await caso('rev3 #4 · "Aprovar 🤖" mostra e envia os NÚMEROS da sugestão; 409 numeros_mudaram = aviso vermelho (nunca "aprovada") e a tela recarrega', async () => {
  assert.deepEqual({ ...P.parDoBotao({ item: 'MLB1', pid: 'P1', preco: '95', mc: '30.68' }) }, { item_id: 'MLB1', pid: 'P1', preco: 95, mc_pct: 30.68 })
  assert.deepEqual({ ...P.parDoBotao({ item: 'MLB1', pid: 'P1', preco: '', mc: '' }) }, { item_id: 'MLB1', pid: 'P1', preco: null, mc_pct: null }, '"—" na tela = null, nunca 0')
  const T = criarTela(); await tick(); T.quem('David')
  const sug = { pid: 'P1', regra: 'R1', motivo: 'm', obs: '', aprovado: false, via: 'api', gravada: true, preco: 95, mc_pct: 30.68 }
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB1', { situacao: 'sugerida', sugerida: [sug], candidatos: [{ pid: 'P1', nome: 'Camp', tipo: 'SMART', preco: 95, meliPct: 5, mc: 10, mcPct: 30.68, fim: '', trilha: 'api', passaPiso: true }] })]))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  assert.match(T.el('elCorpo').innerHTML, /data-acao="aprovar" data-item="MLB1" data-pid="P1" data-preco="95" data-mc="30.68">Aprovar 🤖 R\$ 95,00 · MC 30,7%</)
  const leituras = () => T.log.filter(l => l.url.startsWith('/api/promocoes/elegiveis')).length, antes = leituras()
  T.on('/api/promocoes/aprovar-analista', T.erro(409, '1 sugestão(ões) 🤖 mudaram desde que a tela carregou — NADA foi aprovado. Recarregue a tela'))
  await T.clicar('aprovar', { item: 'MLB1', pid: 'P1', preco: '95', mc: '30.68' }); await tick()
  assert.deepEqual(T.log.find(l => l.url === '/api/promocoes/aprovar-analista').body, { cliente: 'A', itens: [{ item_id: 'MLB1', pid: 'P1', preco: 95, mc_pct: 30.68 }], por: 'David' })
  assert.match(T.el('toastErro').textContent, /NADA foi aprovado/); assert.doesNotMatch(T.el('toast').textContent, /aprovada/)
  assert.ok(leituras() > antes, 'a tela recarrega para mostrar os números novos')
})

// ═════════ vínculo custo ↔ anúncio (aba Custos, plano 07/10 §4) ═══════════════════════════════════════
const CFG_CUSTOS = { piso_mc: 20, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, execucao_max_itens: 1, hedge_cobertura: 1 }
const custosDe = () => ({ skus: [], skus_efetivos: { total: 2, itens: [{ sku: 'Peitoral Tamanho P', custo: 24.34, fonte: 'manual' }, { sku: 'Guia Longa 5m', custo: 55.63, fonte: 'manual' }] }, sem_custo: [], skus_sem_custo: [], percentuais: null, config: CFG_CUSTOS })
const vinculosDe = () => ({
  custos_sem_anuncio: [{ sku_custo: 'Peitoral Tamanho P', custo: 24.34, candidatos: [{ item_id: 'MLB4311029803', titulo: 'Coleira Peitoral H | P Cães Pequenos', thumb: '', sku: 'PEITORALH-2-P', semelhanca: 80 }] }],
  anuncios_sem_custo: [{ item_id: 'MLB4311029803', titulo: 'Coleira Peitoral H | P', thumb: '', sku: 'PEITORALH-2-P', fat30: 900, candidatos: [{ sku_custo: 'Peitoral Tamanho P', custo: 24.34, semelhanca: 80 }] },
    { item_id: 'MLB5944384554', titulo: 'Peitoral H Tam G', thumb: '', sku: 'PEITORALH-2-G', fat30: 100, candidatos: [] }],
  vinculados: [{ item_id: 'MLB9000000001', sku_custo: 'Guia Longa 5m', origem: 'manual', por: 'Ana', em: '2026-10-07T12:00:00.000Z' }, { item_id: 'MLB9000000002', sku_custo: 'Guia Longa 5m', origem: 'sku_normalizado', por: '', em: '' }],
  totais: { custos_sem_anuncio: 1, anuncios_sem_custo: 2, vinculados: 2 } })
// clique num botão que acha o campo dentro do seu .pr-vinc (cv-manual / cv-escolher)
const clicarComCampo = async (T, acao, dataset, valor) => {
  const botao = { dataset: { acao, ...dataset }, disabled: false, closest: sel => (sel === '.pr-vinc' ? { querySelector: () => ({ value: valor }) } : null) }
  await Promise.all((T.doc.handlers.click || []).map(h => h({ target: { closest: sel => (sel === '[data-acao]' ? botao : null) } })))
}
const telaVinculos = async () => {
  const T = criarTela(); await tick()
  T.on('/api/promocoes/custos', () => custosDe()); T.on('/api/custos/vinculos', () => vinculosDe())
  T.on('/api/custos/vincular', (url, b) => ({ ok: true, item_id: b.item_id, sku_custo: b.sku_custo, origem: 'manual' }))
  T.on('/api/custos/recusar', (url, b) => ({ ok: true, item_id: b.item_id, sku_custo: b.sku_custo, origem: 'recusado' }))
  T.on('/api/custos/desvincular', (url, b) => ({ ok: true, item_id: b.item_id, removidos: 1 }))
  return T
}

await caso('custo ↔ anúncio · aba Custos mostra as 3 seções; Confirmar grava com o nome do perfil, toast "Custo vinculado" e recarrega aba e resumo', async () => {
  const T = await telaVinculos(); T.sandbox.localStorage.setItem('ps_perfil_por', 'Ana')
  await T.app.abrir('A', 'custos', false); await tick()
  const h = T.el('conteudo').innerHTML
  assert.match(h, /Custos sem anúncio \(1\)/); assert.match(h, /semelhança 80%/); assert.match(h, /data-acao="cv-vincular" data-item="MLB4311029803" data-sku="Peitoral Tamanho P">Confirmar/)
  assert.match(h, /Anúncios sem custo \(2\)/); assert.match(h, /parecidos pelo nome: Peitoral Tamanho P \(80%\)/); assert.match(h, /<datalist id="cvCustos"><option value="Peitoral Tamanho P">R\$ 24,34<\/option>/)
  assert.match(h, /Custo por anúncio \(2\)/); assert.match(h, />SKU normalizado</); assert.equal((h.match(/data-acao="cv-desvincular"/g) || []).length, 1)
  assert.match(h, /<td>MLB9000000002<\/td>[^]*?data-acao="cv-recusar" data-item="MLB9000000002" data-sku="Guia Longa 5m">Não é este/, 'automático (SKU normalizado) errado sai com "Não é este"')
  assert.match(h, /id="formCustos"/, 'importar e configuração continuam na aba'); assert.ok(h.indexOf('Custos sem anúncio') < h.indexOf('Importar custos por SKU'), 'o vínculo vem antes da importação')
  const c0 = cont(T, '/api/custos/vinculos'), r0 = cont(T, '/api/promocoes/resumo')
  await T.clicar('cv-vincular', { item: 'MLB4311029803', sku: 'Peitoral Tamanho P' }); await tick()
  const post = T.log.find(l => l.url === '/api/custos/vincular')
  assert.equal(post.metodo, 'POST'); assert.deepEqual(post.body, { cliente: 'A', item_id: 'MLB4311029803', sku_custo: 'Peitoral Tamanho P', por: 'Ana' })
  assert.equal(T.el('toast').textContent, 'Custo vinculado: Peitoral Tamanho P → MLB4311029803')
  assert.ok(cont(T, '/api/custos/vinculos') > c0 && cont(T, '/api/promocoes/resumo') > r0, 'recarrega os vínculos e o resumo (KPI Sem custo)')
  await T.clicar('cv-recusar', { item: 'MLB4311029803', sku: 'Peitoral Tamanho P' }); await tick()
  assert.deepEqual(T.log.find(l => l.url === '/api/custos/recusar').body, { cliente: 'A', item_id: 'MLB4311029803', sku_custo: 'Peitoral Tamanho P', por: 'Ana' })
  assert.match(T.el('toast').textContent, /^Não é este: Peitoral Tamanho P não volta a ser sugerido para MLB4311029803/)
})

await caso('custo ↔ anúncio · ID do anúncio validado (^MLB[0-9]{6,12}$) e "Escolher custo" vazio: nada chega à API; sem ps_perfil_por vale o "Seu nome"', async () => {
  const T = await telaVinculos(); T.quem('David')
  await T.app.abrir('A', 'custos', false); await tick()
  await clicarComCampo(T, 'cv-manual', { sku: 'Peitoral Tamanho P' }, 'MLB12'); await tick()
  assert.match(T.el('toastErro').textContent, /formato MLB123456789/); assert.equal(cont(T, '/api/custos/vincular'), 0)
  await clicarComCampo(T, 'cv-escolher', { item: 'MLB5944384554' }, '   '); await tick()
  assert.match(T.el('toastErro').textContent, /Escolha um custo/); assert.equal(cont(T, '/api/custos/vincular'), 0)
  await clicarComCampo(T, 'cv-manual', { sku: 'Peitoral Tamanho P' }, ' mlb-5944384554 '); await tick()
  assert.deepEqual(T.log.find(l => l.url === '/api/custos/vincular').body, { cliente: 'A', item_id: 'MLB5944384554', sku_custo: 'Peitoral Tamanho P', por: 'David' })
  assert.equal(T.sandbox.localStorage.getItem('ps_perfil_por'), 'David', 'o nome fica lembrado para o próximo vínculo')
  await clicarComCampo(T, 'cv-escolher', { item: 'MLB5944384554' }, 'Guia Longa 5m'); await tick()
  assert.equal(T.log.filter(l => l.url === '/api/custos/vincular')[1].body.sku_custo, 'Guia Longa 5m')
  T.on('/api/custos/vincular', T.erro(400, 'SKU de custo sem custo vigente neste cliente (cadastre o custo antes de vincular)'))
  await clicarComCampo(T, 'cv-escolher', { item: 'MLB5944384554' }, 'Inexistente'); await tick()
  assert.match(T.el('toastErro').textContent, /sem custo vigente/, 'erro do servidor vira toast vermelho, nunca "vinculado"')
})

await caso('custo ↔ anúncio · atalho "Vincular custo" na célula SEM CUSTO de Elegíveis abre Custos com o anúncio no topo e o foco no campo; origem do custo na MC', async () => {
  const T = await telaVinculos(); T.quem('David')
  T.on('/api/promocoes/elegiveis', () => elegDe([linhaDe('MLB5944384554', { custo: { ok: false, estado: 'SEM CUSTO', faltando: ['custo'], modo: '' } }),
    linhaDe('MLB7', { custo: { ok: false, estado: 'SEM TARIFA/FRETE', faltando: ['frete'], modo: 'sku' } }),
    linhaDe('MLB8', { melhor: { mcPct: 25 }, custo: { ok: true, estado: 'ok', faltando: [], modo: 'sku', origem: 'sku_normalizado', sku_custo: 'Cinto desegurança' } })]))
  await T.app.abrir('A', 'elegiveis', false); await tick()
  const el = T.el('elCorpo').innerHTML
  assert.equal((el.match(/data-acao="vincular-custo"/g) || []).length, 1, 'só onde falta o CUSTO (frete faltando não é vínculo)'); assert.match(el, /data-acao="vincular-custo" data-item="MLB5944384554">Vincular custo/)
  assert.match(el, /custo: SKU normalizado · Cinto desegurança/)
  await T.clicar('vincular-custo', { item: 'MLB5944384554' }); await tick()
  assert.equal(T.app.S.aba, 'custos'); const h = T.el('conteudo').innerHTML
  assert.ok(h.indexOf('MLB5944384554') < h.indexOf('fat. 30d R$ 900,00'), 'o anúncio do atalho vem antes do de maior faturamento')
  assert.equal(T.doc.activeElement, T.el('cvFoco'), 'foco no campo "Escolher custo" do anúncio')
  await T.app.mostrarAba('custos', false); await tick()
  assert.doesNotMatch(T.el('conteudo').innerHTML, /id="cvFoco"/, 'o foco do atalho vale uma pintura só')
  await T.clicar('vincular-custo', { item: 'MLB0000000001' }); await tick()
  assert.match(T.el('toast').textContent, /MLB0000000001 não está em "Anúncios sem custo" \(encerrado, inativo, já com custo\)/, 'lista inteira (totais = lista): não culpa o corte de 500')
})

await caso('custo ↔ anúncio · Desvincular passa por PS.confirmar e manda só o anúncio; falha da rota de vínculos não derruba a aba', async () => {
  const T = await telaVinculos(); T.sandbox.localStorage.setItem('ps_perfil_por', 'Ana')
  let pergunta = null, resposta = false
  T.sandbox.window.PS = { confirmar: async o => { pergunta = o; return resposta } }
  await T.app.abrir('A', 'custos', false); await tick()
  await T.clicar('cv-desvincular', { item: 'MLB9000000001', sku: 'Guia Longa 5m' }); await tick()
  assert.match(pergunta.titulo, /Desvincular o custo de MLB9000000001/); assert.equal(pergunta.perigo, true); assert.equal(cont(T, '/api/custos/desvincular'), 0, 'cancelar não grava')
  resposta = true; await T.clicar('cv-desvincular', { item: 'MLB9000000001', sku: 'Guia Longa 5m' }); await tick()
  assert.deepEqual(T.log.find(l => l.url === '/api/custos/desvincular').body, { cliente: 'A', item_id: 'MLB9000000001', por: 'Ana' })
  assert.equal(T.el('toast').textContent, 'Vínculo manual desfeito: MLB9000000001')
  T.on('/api/custos/vinculos', T.erro(500, 'falhou a leitura dos vínculos'))
  await T.app.mostrarAba('custos', false); await tick()
  const h = T.el('conteudo').innerHTML
  assert.match(h, /Não foi possível carregar<\/b>falhou a leitura dos vínculos/); assert.match(h, /id="formCustos"/); assert.match(h, /id="formConfig"/)
})

console.log(`\n✔ teste-promocoes-ui: ${n} casos passaram (script inteiro sob DOM simulado + bloco puro)`)
process.exit(0)
