// Algoritmo (/metodologia): veredito, calibração, saúde das regras e parâmetros. Só leitura: GET /api/metodologia.
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const int = v => v == null ? '—' : Number(v).toLocaleString('pt-BR')
const pc = v => v == null ? '—' : Math.round(v * 100) + '%'
const pct1 = (a, b) => b ? (100 * a / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—'
const brl = v => { if (v == null) return '—'; const a = Math.abs(v); const n = a >= 1e6 ? (a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : a >= 1e3 ? Math.round(a / 1e3).toLocaleString('pt-BR') + ' mil' : Math.round(a).toLocaleString('pt-BR'); return 'R$ ' + n }
const SIT = { 'sem dados ainda': 'neutro', 'em observação': 'atencao', 'validada pelos dados': 'bom', 'candidata à aposentadoria': 'ruim' }
const ORDEM = { 'candidata à aposentadoria': 0, 'validada pelos dados': 1, 'em observação': 2, 'sem dados ainda': 3 }
const NOME = { ima_conversao: 'Conversão abaixo do benchmark', catalogo_buybox: 'Catálogo sem a caixa de compra', estoque_ruptura: 'Risco de ruptura', full_envio: 'Envio ao Full', ads_entrar: 'Entrar em Ads', ads_escalar: 'Escalar Ads', ads_reduzir: 'Reduzir Ads sem retorno', ads_otimizar_antes: 'Otimizar antes de gastar em Ads', conteudo_fotos: 'Poucas fotos', frete_gratis: 'Sem frete grátis', sazonal: 'Janela sazonal', urgencia_oculta: 'Urgência oculta (hipótese)', promocao_giro: 'Promoção para girar estoque', cadastrar_custos: 'Cadastrar custos', duplicacao_estrategica: 'Duplicação estratégica' }
const nome = id => NOME[id] || (id.charAt(0).toUpperCase() + id.slice(1)).replace(/_/g, ' ')
// parâmetros: chave → [rótulo, unidade, grupo]
const PARAM = {
  max_acoes_por_cliente_semana: ['Máximo de ações por cliente por semana', '', 'Foco'], pareto_gmv_pct: ['Parcela do GMV considerada (Pareto)', '%', 'Foco'], min_impacto_pct_gmv: ['Impacto mínimo do anúncio no GMV', '%', 'Foco'], min_unidades_item: ['Unidades mínimas por anúncio', '', 'Foco'], min_visitas_item: ['Visitas mínimas por anúncio', '', 'Foco'], teto_plausibilidade_uplift_pct: ['Teto de ganho plausível', '%', 'Foco'], desconto_por_sobreposicao: ['Desconto por sobreposição de ações', 'frac', 'Foco'],
  cobertura_critica_dias: ['Cobertura crítica', 'dias', 'Estoque e Full'], cobertura_atencao_dias: ['Cobertura em atenção', 'dias', 'Estoque e Full'], cobertura_excesso_dias: ['Cobertura em excesso', 'dias', 'Estoque e Full'], lead_time_reposicao_dias: ['Prazo de reposição', 'dias', 'Estoque e Full'], estoque_seguranca_dias: ['Estoque de segurança', 'dias', 'Estoque e Full'], full_cobertura_planejada_dias: ['Cobertura planejada no Full', 'dias', 'Estoque e Full'], crescimento_max_pct: ['Crescimento máximo projetado', '%', 'Estoque e Full'],
  ads_min_custo_avaliar: ['Custo mínimo para avaliar', 'R$', 'Ads'], ads_min_cliques_sem_venda: ['Cliques sem venda para reduzir', 'cliques', 'Ads'], ads_roas_vs_conta_escalar: ['ROAS vs conta para escalar', '×', 'Ads'], ads_roas_vs_conta_reduzir: ['ROAS vs conta para reduzir', '×', 'Ads'], ads_ctr_vs_conta_baixo: ['CTR vs conta considerado baixo', '×', 'Ads'],
  ima_gap_conversao_pct: ['Gap de conversão para a regra ímã', '%', 'Conteúdo e conversão'], benchmark_min_visitas: ['Visitas mínimas para o benchmark', '', 'Conteúdo e conversão'], fotos_minimas: ['Fotos mínimas', 'fotos', 'Conteúdo e conversão'], nota_minima_avaliacao: ['Nota mínima de avaliação', 'de 5', 'Conteúdo e conversão'],
}
const GRUPOS = ['Foco', 'Estoque e Full', 'Ads', 'Conteúdo e conversão', 'Outros']
const valor = (v, u) => { const n = typeof v === 'number' ? v.toLocaleString('pt-BR') : esc(v); return u === '%' ? n + '%' : u === 'frac' ? Math.round(v * 100) + '%' : u === 'R$' ? 'R$ ' + n : u === '×' ? n + '×' : u ? n + ' ' + u : n }

const skel = (id, html) => { const e = $(id); e.innerHTML = html; e.setAttribute('aria-busy', 'true') }
const pinta = (id, html) => { const e = $(id); e.innerHTML = html; e.removeAttribute('aria-busy') }
const erro = (id, e) => pinta(id, `<div class="erro-bloco"><b>Não foi possível carregar</b>O servidor não respondeu ou devolveu um erro. Tente de novo em instantes.<div><button class="btn btn-p" type="button" data-tentar>Tentar de novo</button></div><details><summary>Detalhe técnico</summary><pre>${esc(e.message)}</pre></details></div>`)
document.addEventListener('click', e => { if (e.target.closest('[data-tentar]')) carregar() })

function calib(c, dist, geradas) {
  if (!c.n) return `<div class="vazio-box"><b>Nenhuma ação medida ainda</b>${int(dist)} de ${int(geradas)} ações geradas viraram tarefa; a primeira medição acontece 14 dias depois da distribuição.</div>`
  const vies = c.vies > 0 ? ['alerta', 'superestima: previsão acima do realizado'] : c.vies < 0 ? ['alerta', 'subestima: previsão abaixo do realizado'] : ['bom', 'sem viés']
  return `<div class="kpis">
    <div class="kpi"><div class="rotulo">Ações medidas</div><div class="valor">${int(c.n)}</div><div class="detalhe">de ${int(dist)} distribuídas</div></div>
    <div class="kpi"><div class="rotulo">Erro médio</div><div class="valor">${brl(c.erro_absoluto_medio)}</div><div class="detalhe">diferença entre previsto e realizado</div></div>
    <div class="kpi ${vies[0]}"><div class="rotulo">Viés</div><div class="valor">${brl(c.vies)}</div><div class="detalhe">${vies[1]}</div></div>
    <div class="kpi"><div class="rotulo">Dentro do intervalo</div><div class="valor">${c.pct_no_intervalo == null ? '—' : c.pct_no_intervalo + '%'}</div><div class="detalhe">Brier ${c.brier ?? '—'} (perto de 0 = bem calibrado)</div></div>
  </div><p class="nota mt-2">${esc(c.nota)}</p>`
}

function regras(lista) {
  if (!lista.length) return `<div class="vazio-box"><b>Nenhuma regra ativa</b>Cadastre regras em config/algoritmo.json para o motor gerar ações.</div>`
  const ord = [...lista].sort((a, b) => (ORDEM[a.situacao] ?? 9) - (ORDEM[b.situacao] ?? 9) || b.geradas - a.geradas)
  // um <meter> só (distribuídas sobre geradas); os 4 números ao lado contam o resto do funil
  const funil = r => `<div class="funil num"><span>${int(r.geradas)} → ${int(r.distribuidas)} → ${int(r.medidas)} → ${int(r.melhoraram)}</span><meter max="${r.geradas || 1}" value="${r.distribuidas}" aria-label="distribuídas sobre geradas"></meter></div>`
  const tot = ['geradas', 'distribuidas', 'medidas', 'melhoraram'].reduce((o, k) => (o[k] = lista.reduce((t, r) => t + (r[k] || 0), 0), o), {})
  // resumo curto da fonte do prior; a frase completa vai para o title
  const resumo = f => { const m = /^calibrado: (\d+ de \d+)/.exec(f || ''); return m ? 'calibrado: ' + m[1] : 'premissa' }
  // um só filho por td: abaixo de 640px o td vira flex (table.empilha) e cada filho seria uma coluna
  return `<div class="tabela-wrap"><table class="t empilha"><thead><tr><th>Regra</th><th>KPI de resultado</th><th>Funil</th><th class="fonte">Probabilidade efetiva</th><th>Situação</th></tr></thead><tbody>${ord.map(r => `<tr>
    <td data-rotulo="Regra"><div><b title="${esc(r.descricao)}">${esc(nome(r.id))}</b> <code class="mudo">${esc(r.id)}</code></div></td>
    <td data-rotulo="KPI"><div title="tarefa: ${esc(r.tipo_demanda)}">${esc(r.kpi)}</div></td>
    <td data-rotulo="Funil">${funil(r)}</td>
    <td data-rotulo="Probabilidade" class="fonte"><div title="${esc(r.prior_efetivo?.fonte)}"><span class="num">${pc(r.prior_efetivo?.p)}</span> <span class="mudo peq">${resumo(r.prior_efetivo?.fonte)}</span></div></td>
    <td data-rotulo="Situação"><span class="selo ${SIT[r.situacao] || 'neutro'}">${esc(r.situacao)}</span></td></tr>`).join('')}</tbody>
  <tfoot><tr><td data-rotulo="Total">${lista.length} regras</td><td></td><td data-rotulo="Funil">${funil(tot)}</td><td></td><td></td></tr></tfoot></table></div>`
}

function ritual(d) {
  const r = d.ritual || {}
  return `<div class="cadeia">${['semanal', 'quinzenal', 'mensal'].map(k => `<span class="elo"><b>${k.charAt(0).toUpperCase() + k.slice(1)}</b> ${esc(r[k])}</span>`).join('<span class="seta">→</span>')}</div><p class="nota mt-2"><b>Regra de entrada:</b> ${esc(d.regra_de_entrada)}</p>`
}

function limiares(d) {
  const linhas = [...Object.entries(d.foco || {}).filter(([, v]) => typeof v !== 'object'), ...Object.entries(d.limiares || {})].map(([k, v]) => { const [rot, u, g] = PARAM[k] || [k.replace(/_/g, ' '), '', 'Outros']; return { g, rot, val: valor(v, u) } })
  for (const [k, v] of Object.entries(d.foco?.max_por_regra || {})) linhas.push({ g: 'Foco', rot: 'Teto de ações por regra: ' + nome(k), val: int(v) })
  $('nParam').textContent = linhas.length
  const grupos = GRUPOS.filter(g => linhas.some(l => l.g === g))
  return `<div class="tabela-wrap"><table><thead><tr><th>Parâmetro</th><th class="n">Valor</th></tr></thead><tbody>${grupos.map(g => `<tr class="det"><td colspan="2"><b>${g}</b></td></tr>` + linhas.filter(l => l.g === g).map(l => `<tr><td>${esc(l.rot)}</td><td class="n">${l.val}</td></tr>`).join('')).join('')}</tbody></table></div>`
}

async function carregar() {
  $('veredito').textContent = 'Lendo o algoritmo…'
  window.PS?.regua('regua', {})   // some até o veredito ser recalculado
  skel('calib', '<div class="kpis">' + '<div class="sk-kpi"></div>'.repeat(4) + '</div>')
  skel('regras', '<div class="sk-tabela"></div>')
  skel('ritual', '<div class="sk-linha"></div><div class="sk-linha"></div>')
  skel('limiares', '<div class="sk-tabela"></div>')
  let d
  try {
    const r = await fetch('/api/metodologia')
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200))
    d = await r.json()
  } catch (e) {
    $('veredito').textContent = 'Não foi possível ler o algoritmo. Tente de novo abaixo.'
    for (const id of ['calib', 'regras', 'ritual', 'limiares']) erro(id, e)
    return
  }
  const lista = Array.isArray(d.regras) ? d.regras : [], c = d.calibracao || { n: 0, nota: '' }
  const geradas = lista.reduce((t, r) => t + (r.geradas || 0), 0), dist = lista.reduce((t, r) => t + (r.distribuidas || 0), 0)
  $('versao').textContent = 'versão ' + d.versao
  $('metaRegras').textContent = int(lista.filter(r => r.ativa).length) + ' regras ativas'
  const fim = c.n ? (c.vies > 0 ? 'As previsões ficam acima do realizado.' : c.vies < 0 ? 'As previsões ficam abaixo do realizado.' : 'As previsões não têm viés.')
    : dist ? `A calibração começa quando as ${int(dist)} distribuídas completarem 14 dias.` : 'A calibração só começa depois da primeira distribuição.'
  $('veredito').innerHTML = `${int(geradas)} ações geradas → <b>${int(dist)} distribuídas (${pct1(dist, geradas)})</b> → <b>${int(c.n)} medidas</b>. ${fim}`
  // régua do funil: distribuídas sobre geradas; sem geradas não há proporção e a régua some (PS.regua esconde com NaN)
  window.PS?.regua('regua', { valor: geradas ? 100 * dist / geradas : NaN, rotulo: `${int(dist)} distribuídas de ${int(geradas)} geradas (${pct1(dist, geradas)})` })
  const faltam = geradas - dist
  $('proximaTexto').textContent = faltam > 0 ? `O gargalo é distribuir: ${int(faltam)} ações geradas ainda não viraram tarefa` : 'Tudo o que foi gerado já foi distribuído; acompanhe a maturação'
  // cada bloco pinta e falha sozinho
  for (const [id, fn] of [['calib', () => calib(c, dist, geradas)], ['regras', () => regras(lista)], ['ritual', () => ritual(d)], ['limiares', () => limiares(d)]]) {
    try { pinta(id, fn()) } catch (e) { erro(id, e) }
  }
}
carregar()
