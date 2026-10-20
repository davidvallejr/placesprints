// Relatório em PT do motor de diagnóstico (contrato de src/lib/diagnostico-motor.js). PURO: recebe o JSON e devolve HTML no estilo editorial.
// TODO número impresso vem de `evidence` (o render não calcula nada: a métrica aponta um evidence_id e o valor/unidade saem de lá; sem evidência, "—" com o motivo).
// para='interno' mostra ids (PS-/MLB), responsáveis, fórmulas, prompts derivados e plano de revisão; para='cliente' recorta o contrato pela visão do cliente
// (só REGRAS_CLIENTE: regras de anúncio/conta com rótulo; nenhuma regra operacional do plano por cliente), passa cada texto pelo auditor completo de relatorio-seguro
// (sem ID, sem nome interno, sem jargão, sem promessa/causalidade) e omite as seções internas.
import { FONTES, CSS, esc, brData, capa, secTitulo, rodape } from './estilo-editorial.js'
import { sistema } from './sistemas.js'
import { auditarTexto } from './relatorio-seguro.js'
import { MARCA } from './marca.js'
import { ROTULOS } from './filtros.js'
import { CFG as CFG_ALINHAMENTOS } from './alinhamentos.js'

export const ROT_REGRA = { ima_conversao: 'Conversão abaixo da referência da conta', catalogo_buybox: 'Caixa de compra do catálogo', estoque_ruptura: 'Risco de ruptura de estoque', full_envio: 'Envio ao Full', estoque_dividido: 'Mesmo produto em estoques separados', estoque_sincronizar: 'Sincronizar o estoque entre os anúncios do produto', estoque_divergente: 'Confirmar o estoque físico do produto', sku_ausente: 'Anúncios sem SKU', ads_entrar: 'Entrar em Product Ads', ads_escalar: 'Escalar Product Ads', ads_reduzir: 'Reduzir Product Ads sem retorno', ads_otimizar_antes: 'Otimizar antes de anunciar',
  conteudo_fotos: 'Conteúdo e fotos', frete_gratis: 'Frete grátis', sazonal: 'Janela sazonal', urgencia_oculta: 'Urgência oculta (kit, palavra-chave, público)', promocao_giro: 'Promoção para girar estoque', cadastrar_custos: 'Custos não informados', duplicacao_estrategica: 'Duplicação estratégica',
  oferta_galeria: 'Galeria por posição', oferta_titulo_descricao: 'Título e descrição', oferta_completa: 'Oferta completa', oferta_ficha: 'Ficha técnica', oferta_preco: 'Preço com margem', oferta_cadastro: 'Anúncio novo', preco_mudou_vendas_cairam: 'Preço subiu e as vendas caíram',
  queda_conversao_anuncio: 'Queda de conversão do anúncio', queda_exposicao_anuncio: 'Queda de exposição do anúncio', queda_ctr_ads: 'Queda de CTR em Ads', margem_negativa: 'Margem negativa', ads_abaixo_meta: 'Ads abaixo da meta do mês', concentracao_receita: 'Receita concentrada em um anúncio', anuncio_restrito: 'Anúncio pausado ou em revisão',
  // saúde da conta (v1.5.0): tudo é do cliente (reputação, despacho, atendimento, Full) — entram na visão do cliente
  reputacao_em_risco: 'Reputação da conta em risco', envio_atrasado: 'Pedidos com despacho atrasado', reclamacao_sem_resposta: 'Reclamação sem resposta', pergunta_sem_resposta: 'Perguntas sem resposta', full_estoque_antigo: 'Estoque parado no Full',
  nf_pendente: 'Nota fiscal pendente', nf_regra_faltando: 'Regra fiscal do produto faltando (contador)',   // V3 F8 (regras inativas até a ligação no plano)
  pendencia_cliente: 'Pendência do cliente', bloqueio_cliente: 'Aguardando o cliente', bloqueio_interno: 'Bloqueio interno' }
const ROT_METRICA = { receita: 'Receita (GMV)', receita_anterior: 'Receita do período anterior', pedidos: 'Pedidos pagos', unidades: 'Unidades', ticket: 'Ticket médio', conversao_conta: 'Conversão de referência da conta', variacao: 'Variação vs período anterior', ctr_ads: 'CTR de Ads', cpc: 'Custo por clique', custo_por_pedido_ads: 'Custo por venda atribuída a Ads', acos: 'ACOS', roas: 'ROAS', tacos: 'TACOS', participacao_publicidade: 'Participação da publicidade',
  margem_pre_ads: 'Margem antes de Ads', margem_pos_ads: 'Margem depois de Ads', cancelamentos: 'Cancelamentos', devolucoes: 'Devoluções', reclamacoes: 'Reclamações', atrasos: 'Atrasos de despacho', n_anuncios: 'Anúncios', share_pct: 'Participação na receita', conversao: 'Conversão', preco_pago: 'Preço pago', conversao_anuncio: 'Conversão', cobertura: 'Cobertura de estoque', giro: 'Giro', ponto_reposicao: 'Ponto de reposição' }
const ROT_ESTADO = { disponivel: 'disponível', parcial: 'parcial', indisponivel: 'indisponível' }
const ROT_TIPO_EV = { fato: 'Fato observado', hipotese: 'Hipótese', projecao: 'Projeção (premissas declaradas)', pendente: 'Pendente' }
const ROT_PRIO = { P0: 'agir agora', P1: 'esta semana', P2: 'próximo ciclo', P3: 'fila' }
// ao cliente só vão as regras de anúncio/conta com rótulo (lista fechada). pendencia_cliente/bloqueio_cliente/bloqueio_interno têm texto próprio (pendencias-texto.js);
// as regras operacionais do plano por cliente (sem_responsavel, renovacao, queda_cadencia, alavanca_*, calendario, sem_plano_mes, backlog_parado, ml_*…) nunca vão.
export const REGRAS_CLIENTE = new Set(Object.keys(ROT_REGRA).filter(r => !['bloqueio_interno', 'pendencia_cliente', 'bloqueio_cliente'].includes(r)))
// causas possíveis (snake_case das regras) → PT; sem rótulo, a causa não vai ao cliente
const ROT_CAUSA = { preco: 'preço', preco_subiu: 'preço subiu', preco_abaixo_do_custo: 'preço abaixo do custo', conteudo: 'título, fotos ou capa', conteudo_mudou: 'título, fotos ou capa mudaram', disponibilidade: 'estoque',
  catalogo: 'caixa de compra do catálogo', mercado_ou_concorrencia: 'mercado ou concorrência', ads_desligou: 'Product Ads desligado', ads_consome_a_margem: 'Ads consome a margem', sazonal: 'demanda sazonal',
  capa_titulo_preco: 'capa, título ou preço', pausa_ou_moderacao: 'pausa ou moderação do anúncio', dependencia_de_um_anuncio: 'dependência de um anúncio', acos_acima_da_meta: 'ACOS acima da meta', roas_abaixo_da_meta: 'ROAS abaixo da meta',
  nivel_fora_do_verde: 'nível de reputação fora do verde', reclamacoes: 'taxa de reclamações', atrasos: 'taxa de atrasos', cancelamentos: 'taxa de cancelamentos', despacho_vencido: 'prazo de despacho vencido', mediacao: 'reclamação em mediação', prazo_curto: 'prazo de resposta curto',
  perguntas_sem_resposta: 'perguntas sem resposta', giro_com_promocao: 'estoque parado com margem para promoção', retirada_do_full: 'estoque parado sem margem para promoção',
  enviar_full: 'Full acabando com estoque próprio do mesmo produto', comprar: 'estoque acabando', confirmar_fisico: 'mesmo número em estoques separados (confirmar o físico)', pool_zerando: 'um anúncio zera com estoque no outro' }
const ROT_BLOQ = { NEEDS_EXTERNAL_DATA: 'depende de dado externo', NOT_AVAILABLE: 'não disponível na fonte', NOT_AUTHORIZED: 'sem permissão de leitura', NOT_SUPPORTED: 'não disponível nesta versão', NOT_COLLECTED: 'não coletado' }
const RX_ENUM = /\b(NEEDS_EXTERNAL_DATA|NOT_AVAILABLE|NOT_AUTHORIZED|NOT_SUPPORTED|NOT_COLLECTED)\b/g
const ROT_CANAL = { mercadolivre: 'Mercado Livre', amazon: 'Amazon', shopee: 'Shopee', tiktok: 'TikTok Shop' }
const chip = (t, tom = '') => t ? `<span class="pl-chip ${tom}">${esc(t)}</span>` : ''
// pt-BR com milhar ("12.345,7"); abaixo de 1, `sig` algarismos significativos: 0,03% nunca sai "0%" (valor diferente de zero nunca é impresso como zero) e nunca em
// notação científica (1e-7 → "0,0000001"). Percentual: 1 casa acima de 1 e 2 significativos abaixo — a mesma regra de pctTxt (diagnostico-conta.js), que não tem locale.
// ponytail: teto de 20 casas do Intl — abaixo de 1e-19 sairia "0"; nenhuma métrica chega lá
const n2 = (v, d = 2, sig = 1) => { const n = Number(v), a = Math.abs(n); return n.toLocaleString('pt-BR', { maximumFractionDigits: a > 0 && a < 1 ? Math.min(20, Math.max(d, sig - 1 - Math.floor(Math.log10(a)))) : d }) }
const pct = v => n2(v, 1, 2)
export function formatarEvidencia(e) {
  if (!e || typeof e.valor !== 'number') return e?.texto || '—'
  const u = e.unidade
  return u === 'BRL' ? 'R$ ' + n2(e.valor) : u === '%' ? pct(e.valor) + '%' : u === 'x' ? n2(e.valor) : u ? `${n2(e.valor)} ${u}` : n2(e.valor)
}
// ids internos que nunca chegam ao cliente: anúncio, tarefa PS-, job de Ofertas (com o parêntese de escopo que o acompanha), fragmento de variante sem anúncio
// (": variante 7c1e9a42", título de oferta_cadastro) e ids do contrato (ev-/dp-)
const RX_IDS = /\s*\((?:MLB|MLA|MLM|MLC)[A-Z]?\d+\)|\b(?:MLB|MLA|MLM|MLC)[A-Z]?\d+\b|\bPS-[0-9a-f]{6,}\b|\s*·?\s*\b[Jj]ob [0-9a-f]{8}\b(?:\s*\([^)]*\))?|:?\s*\b[Vv]ariante [0-9a-f]{8}\b|\b(?:ev|dp)-[0-9a-f]{10}\b/g
// enum cru da API do ML que as regras gravam em problema/causas/evidência (anuncio_restrito: "Status paused"; full_envio: "logística atual: xd_drop_off") → PT por mapa FECHADO:
// status do anúncio, tipo de anúncio e logística (rótulos de filtros.js). Palavra técnica sem rótulo sai da frase (snake_case, ou o valor depois de "status"/"logística":
// "custom", "default"…), nunca crua. O valor da API é minúsculo: "Status Quo"/"Status Gold" (nome do produto) não é slot; título do anúncio nem passa aqui (tx(t, true)).
// O slot é SÓ como as regras o escrevem (plano-anuncios.js anuncio_restrito/full_envio): "status X"/"logística X" no início do texto ou depois de ";", e "(logística atual: X)".
// Hífen, travessão, dois-pontos, ponto e parêntese são separadores comuns DENTRO de título ("relógio masculino - status gold", "boné (status quo)", "Avaliar envio ao
// Full: status quo"): não abrem slot. No meio de uma frase (nome em minúsculas dentro do título de uma ação) o render não sabe onde o nome começa — então não mexe:
// palavra desconhecida nunca é removida nem traduzida ali, nem enum conhecido ("perfume status closed masculino" é o nome do produto). Regra nova que precise do
// enum no meio da frase escreve no formato do slot.
const ROT_ML = { active: 'ativo', paused: 'pausado', under_review: 'em revisão pelo Mercado Livre', inactive: 'inativo', closed: 'encerrado', payment_required: 'com pagamento pendente no Mercado Livre',
  not_yet_active: 'ainda não ativado', gold_special: 'Clássico', gold_pro: 'Premium', ...ROTULOS.logistica }
const PT_ML = new Set(Object.values(ROT_ML).map(v => v.toLowerCase()))
// fora do contexto "status X", só as chaves snake_case e a logística (como antes): "Legging Active" (título do cliente) não vira "ativo"
const RX_ML = new RegExp(`\\b(?:${Object.keys(ROT_ML).filter(k => k.includes('_') || k in ROTULOS.logistica).join('|')})\\b`, 'g')
const RX_SLOT = /(?<=(?:^|;)\s*|\(\s*(?=[Ll]og[ií]stica atual:))([Ss]tatus|[Ll]og[ií]stica(?: atual)?:?)\s+([a-z][a-z0-9_]*)(?![\p{L}\p{N}_])/gu
export const traduzirEnumML = s => s
  .replace(RX_SLOT, (m, st, v, ix, txt) =>   // valor sem rótulo no fim da oração: "status X"/"logística atual: X" sai inteiro; "status do anúncio" fica
    ROT_ML[v] ? `${st} ${ROT_ML[v]}` : /^(?:\s*[;.,)]|\s*$|\s+na\s)/.test(txt.slice(ix + m.length)) && !PT_ML.has(v) ? '' : m)
  .replace(RX_ML, k => ROT_ML[k]).replace(/\b[a-z]+_[a-z0-9_]+\b/g, '')
const RX_ORIGEM_OFERTAS = /\s*[—-]\s*(?:leitura|job) do m[óo]dulo de Ofertas\b/gi
// bastidor que o auditor não conhece: a mecânica interna de Ofertas → o texto não vai ao cliente ("—")
const bastidor = t => /\bm[óo]dulo de ofertas\b|\bjob\b/i.test(t)

// visão do cliente: só as regras de REGRAS_CLIENTE (issues, oportunidades, ações, problemas por anúncio e regras de Ads). `omitidos` = ações que ficaram de fora.
// Os contadores do texto ao cliente usam esta visão (contam só o que é mostrado).
export function visaoCliente(j) {
  const ok = r => REGRAS_CLIENTE.has(r), C = j.campaign_diagnoses || {}
  const actions = (j.actions || []).filter(a => ok(a.regra))
  return { ...j, actions, issues: (j.issues || []).filter(i => ok(i.regra)), opportunities: (j.opportunities || []).filter(i => ok(i.regra)),
    listing_diagnoses: (j.listing_diagnoses || []).map(l => ({ ...l, problemas: (l.problemas || []).filter(p => ok(p.regra)) })).filter(l => l.problemas.length),
    campaign_diagnoses: { ...C, itens: (C.itens || []).map(it => ({ ...it, regras: (it.regras || []).filter(r => ok(r.regra)) })) },
    // alinhamentos com o cliente: só os vivos e só os que o config manda rotular (relatorio 'omitir' — teste — não aparece, como no relatório curto), só o rótulo do tipo e o
    // texto fixo "conforme alinhado em dd/mm" — motivo livre, quem registrou, anúncio e regras ficam no interno
    account_diagnosis: { ...(j.account_diagnosis || {}), alinhamentos: (j.account_diagnosis?.alinhamentos || []).filter(a => a.estado === 'vivo' && CFG_ALINHAMENTOS?.tipos?.[a.tipo]?.relatorio !== 'omitir').map(a => ({ tipo: a.tipo, rotulo_cliente: a.rotulo_cliente, texto_cliente: a.texto_cliente, estado: a.estado })) },
    omitidos: (j.actions || []).length - actions.length }
}
// insumos da leitura executiva para a IA: os fatos e SÓ as evidências que eles citam (métricas da conta + diagnóstico da conta) + os contadores enviados.
// Mandar todas (1.986 num cliente real) deixava qualquer número "rastreável" por acaso.
export function insumosLeitura(j) {
  const m = j.metrics?.conta || {}, ad = j.account_diagnosis || {}
  const ids = new Set([...Object.values(m).map(x => x?.evidence_id), ...(ad.evidence_ids || [])].filter(Boolean))
  const n = { n_issues: (j.issues || []).length, n_opportunities: (j.opportunities || []).length, n_actions: (j.actions || []).length }
  return {
    fatos: { conta: m, estado: ad.estado, estrategia: ad.estrategia ? { classe: ad.estrategia.classe, provisoria: ad.estrategia.provisoria, faltam: ad.estrategia.faltam } : null, ...n },
    evidence: [...(j.evidence || []).filter(e => ids.has(e.id)), { texto: `${n.n_issues} ${n.n_opportunities} ${n.n_actions} 28` }],
  }
}

// texto determinístico da leitura executiva: só cita números que estão em evidence (é o template que a IA, quando existir, reescreve)
export function leituraDeterministica(j) {
  const E = new Map((j.evidence || []).map(e => [e.id, e])), v = k => formatarEvidencia(E.get(j.metrics?.conta?.[k]?.evidence_id))
  const m = j.metrics?.conta || {}, ad = j.account_diagnosis || {}, estr = ad.estrategia
  const rec = m.receita, recTxt = rec?.valor == null ? `A receita dos 28 dias está sem dado (${rec?.motivo || 'sem coleta'})` : `A conta faturou ${v('receita')} ${rec.parcial ? `em ${rec.parcial.dias_cobertos} de ${rec.parcial.dias} dias com coleta (parcial)` : 'em 28 dias'}`
  const partes = [`${recTxt}${m.variacao?.valor != null ? ` (${m.variacao.valor >= 0 ? '+' : ''}${v('variacao')} sobre o período anterior)` : ` (variação sem base: ${m.variacao?.motivo || 'sem período anterior'})`}, com ${m.pedidos?.valor != null ? `${v('pedidos')} pagos` : 'pedidos não coletados'}${m.conversao_conta?.valor != null ? ` e conversão de referência de ${v('conversao_conta')}` : ''}.`]
  // ROAS nulo ≠ sem Ads: com Ads coletado (CTR/TACOS medidos, até 0), diz o motivo real da ROAS e o que foi medido; "Sem Product Ads" só quando nada de Ads veio
  const tacosTxt = m.tacos?.valor != null ? `TACOS ${v('tacos')}${m.tacos.parcial ? ', parcial' : ''}` : ''
  partes.push(m.roas?.valor != null ? `Ads com ROAS ${v('roas')}${m.acos?.valor != null ? ` e ACOS ${v('acos')}` : ''}${tacosTxt ? ` (${tacosTxt})` : ''}.`
    : ['ctr_ads', 'cpc', 'acos', 'tacos'].some(k => m[k]?.valor != null) ? `Ads coletado com ROAS sem leitura (${m.roas?.motivo || 'sem dado'})${m.ctr_ads?.valor != null ? `; CTR ${v('ctr_ads')}` : ''}${tacosTxt ? `; ${tacosTxt}` : ''}.`
    : 'Sem Product Ads coletado no período.')
  // "sem custos" só quando não há custos (margem antes de Ads nula); com custos, a margem depois de Ads (− TACOS) pode faltar por janela parcial ou Ads não coletado: o motivo real
  const mp = m.margem_pos_ads
  partes.push(mp?.valor != null ? `Margem estimada depois de Ads: ${v('margem_pos_ads')}${mp.parcial ? ' (parcial)' : ''} (custos informados pelo cliente).`
    : m.margem_pre_ads?.valor == null ? 'Sem custos informados: nenhuma leitura de margem.' : `Margem depois de Ads sem leitura (${mp?.motivo || 'sem dado'}).`)
  if (ad.estado?.estado) partes.push(`Estado: ${ad.estado.rotulo || ad.estado.estado}${ad.estado.sinal_misto ? ', com sinal misto' : ''}.`)
  if (estr) partes.push(`Estratégia ${estr.classe}${estr.provisoria ? ` (provisória: faltam ${estr.faltam.join(', ')})` : ''}, revisão em ${brData(estr.revisar_em)}.`)
  partes.push(`${(j.issues || []).length} problema(s) e ${(j.opportunities || []).length} oportunidade(s) identificados pelas regras; ${(j.actions || []).length} ação(ões) priorizada(s). Leitura por hipótese, não promessa.`)
  return partes.join(' ')
}

// página do /diagnostico-motor. IA só no relatório INTERNO; ao cliente, texto determinístico (leituraDeterministica da visão do cliente) e `redigir` NUNCA é chamado:
// a heurística de números da IA (numerosFora) ainda deixa passar variações ("12% de queda" com evidência de alta, "R$ 0 mil", "quádruplo"…) — volta só depois de uma revisão própria
// do crivo cliente. `redigir` é injetado (a rota passa o de ia.js) para o teste provar que o caminho do cliente não toca a IA.
export async function paginaDiagnostico(j, { para = 'interno', nomesInternos = [], redigir = null } = {}) {
  if (para === 'cliente' || typeof redigir !== 'function') return renderDiagnosticoMotor(j, { para, nomesInternos })
  const ins = insumosLeitura(j)
  const r = await redigir({ fatos: ins.fatos,
    instrucao: 'Escreva a leitura executiva do diagnóstico da conta em até 5 frases: faturamento e variação, Ads, margem (só com custos), estado e estratégia (provisória quando faltar caixa/capacidade/mercado), quantidade de problemas, oportunidades e ações. Hipótese é hipótese.',
    escopo: `diagnostico:${j.cliente}:interno`, template: () => leituraDeterministica(j), evidence: ins.evidence, crivo: 'interno', nomesInternos: [], permitidos: [j.cliente] })
  return renderDiagnosticoMotor(j, { para, nomesInternos, resumo: r.texto })
}

// "Observação do consultor" (só no interno): grava um alinhamento tipo 'outro', escopo conta, sem regras (não suprime nada — é registro) por POST /api/cliente/alinhamentos,
// prévia primeiro e confirmar:true depois; o motivo passa pelo auditor do núcleo. Não sai na impressão.
const obsConsultor = cliente => `<form class="pl-obs" data-cliente="${esc(cliente)}" onsubmit="return false">
  <p class="pl-h">Observação do consultor</p>
  <label class="pl-sc" for="obsTexto">O que foi combinado com o cliente (interno, até 200 caracteres; o cliente lê só "Combinado com você, conforme alinhado em dd/mm")</label>
  <textarea id="obsTexto" maxlength="200" rows="2"></textarea>
  <label class="pl-sc" for="obsPor">Seu nome (líder ou consultor)</label> <input id="obsPor" maxlength="80">
  <button type="button" id="obsPrevia">Ver prévia</button> <button type="button" id="obsRegistrar" hidden>Registrar alinhamento</button> <span class="pl-sc" id="obsSaida" role="status"></span>
</form>
<script>(() => {
  const f = document.querySelector('.pl-obs'); if (!f) return
  const q = id => document.getElementById(id), saida = q('obsSaida')
  const corpo = conf => ({ cliente: f.dataset.cliente, escopo: 'conta', tipo: 'outro', motivo: q('obsTexto').value.trim(), por: q('obsPor').value.trim(), ...(conf ? { confirmar: true } : {}) })
  const post = async b => { const r = await fetch('/api/cliente/alinhamentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'erro ' + r.status); return j }
  q('obsPrevia').onclick = async () => {
    if (!q('obsTexto').value.trim() || !q('obsPor').value.trim()) { saida.textContent = 'Escreva a observação e o seu nome.'; return }
    try { const v = await post(corpo(false)); saida.textContent = 'O cliente lê: ' + (v.alinhamento?.texto_cliente || ''); q('obsRegistrar').hidden = false } catch (e) { saida.textContent = e.message }
  }
  q('obsRegistrar').onclick = async () => {
    q('obsRegistrar').disabled = true
    try { await post(corpo(true)); saida.textContent = 'Registrado. Recarregue a página para ver na tabela.'; q('obsRegistrar').hidden = true } catch (e) { saida.textContent = e.message; q('obsRegistrar').disabled = false }
  }
})()</script>`
export function renderDiagnosticoMotor(j, { para = 'interno', nomesInternos = [], resumo = null } = {}) {
  const cli = para === 'cliente'
  // selo do sistema de origem só na versão INTERNA (config/sistemas.json); a versão ao cliente sai byte a byte igual
  const sis = id => cli ? '' : `<p class="pl-sc" data-sistema="${id}">${chip(sistema(id).nome, 'cinza')}</p>`
  if (cli) j = visaoCliente(j)
  const E = new Map((j.evidence || []).map(e => [e.id, e])), EC = new Map((j.evidence || []).map(e => [e.chave, e]))
  const opt = { nomesInternos, permitidos: [j.cliente] }
  // tx: texto para a página. Cliente: ids saem antes, estados (NOT_COLLECTED…) viram PT, e o que ainda reprova no auditor completo não é impresso ("—"). Interno: só escapa.
  // titulo=true: nome do anúncio é texto do cliente, não enum da API (sem traduzirEnumML: "Camiseta Banda Status Quo" fica inteiro)
  const tx = (t, titulo = false) => {
    const s = String(t ?? ''); if (!cli) return esc(s)
    const sem = s.replace(RX_IDS, '').replace(RX_ORIGEM_OFERTAS, '').replace(RX_ENUM, k => ROT_BLOQ[k])
    const limpo = (titulo ? sem : traduzirEnumML(sem)).replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').replace(/\s+([,;.)])/g, '$1').replace(/[;,]+(?=\.|$)/g, '')   // "fora do Full ()", "benchmark); ." de valor omitido
      .replace(/^(?:[\s/,;:]|[—–-](?=\s))+/, '').trim()   // sobra de palavra omitida no início ("/moderação"); "-5%" mantém o sinal
    return limpo && !bastidor(limpo) && !auditarTexto(limpo, opt).length ? esc(limpo) : '—'
  }
  const estado = s => (cli ? ROT_BLOQ[s] || '—' : s)
  const idTxt = id => (cli ? '' : `<div class="pl-sc">${esc(id || '')}</div>`)
  const parcial = m => (m?.parcial ? ` <span class="pl-sc">parcial (${esc(m.parcial.dias_cobertos)} de ${esc(m.parcial.dias)} dias)</span>` : '')
  const val = m => (m?.evidence_id && E.has(m.evidence_id) ? esc(formatarEvidencia(E.get(m.evidence_id))) + parcial(m) : `<span class="pl-sc">— (${tx(m?.motivo || 'sem dado')})</span>`)
  // número que não é métrica (cobertura, concentração, economia, metas): só a partir da evidência da chave; sem evidência, "—"
  const ec = chave => (EC.has(chave) ? esc(formatarEvidencia(EC.get(chave))) : '—')
  const evTxt = ids => (ids || []).map(id => E.get(id)).filter(Boolean).map(e => `${chip(ROT_TIPO_EV[e.tipo] || e.tipo, e.tipo === 'fato' ? 'ok' : 'gold')} ${tx(e.texto)}`).join('<br>')
  const rot = r => ROT_REGRA[r] || (cli ? '' : r)          // ao cliente nunca a chave crua (a visão do cliente já tirou o que não tem rótulo)
  const causas = cs => (cs || []).filter(c => !cli || ROT_CAUSA[c?.causa])
  const rotCausa = c => ROT_CAUSA[c] || c
  const lista = arr => (arr?.length ? `<ul class="pl-ul">${arr.map(i => `<li>${tx(i)}</li>`).join('')}</ul>` : '<p class="vazio">—</p>')
  const dq = j.data_quality || {}, m = j.metrics?.conta || {}, ad = j.account_diagnosis || {}, C = j.campaign_diagnoses || {}
  const texto = resumo || leituraDeterministica(j)
  const seloCat = o => (o === 'terceiros' ? chip('Catálogo', 'cinza') : o === 'proprio' ? chip('Catálogo próprio', 'cinza') : '')
  // "Alinhado com o cliente": exceções intencionais registradas (src/lib/alinhamentos.js). Interno: tipo, onde, regras, motivo, quem, datas e estado. Cliente: rótulo + texto fixo.
  const ALS = ad.alinhamentos || []
  const secAlinhado = !ALS.length ? '' : cli
    ? `<p class="pl-h">Alinhado com o cliente</p><ul class="pl-ul">${ALS.map(a => `<li><b>${tx(a.rotulo_cliente)}</b>: ${tx(a.texto_cliente)}</li>`).join('')}</ul>`
    : `<p class="pl-h">Alinhado com o cliente (interno)</p>
  <table class="pl-tab"><thead><tr><th>Tipo</th><th>Onde</th><th>Regras</th><th>Motivo</th><th>Desde</th><th>Revisar em</th><th>Estado</th></tr></thead><tbody>
  ${ALS.map(a => `<tr><td>${esc(a.rotulo || a.tipo)}${a.acos_alvo != null ? `<div class="pl-sc">ACOS alvo ${esc(n2(a.acos_alvo, 1))}%</div>` : ''}</td><td>${esc(a.escopo)}${a.chave ? ` ${esc(a.chave)}` : ''}</td><td class="pl-sc">${esc((a.regras || []).join(', ') || 'padrão do tipo')}</td><td>${esc(a.motivo || '—')}<div class="pl-sc">${esc(a.origem)}${a.por ? ` · ${esc(a.por)}` : ''}</div></td><td>${esc(brData(a.desde))}</td><td>${a.permanente ? 'permanente' : esc(brData(a.revisar_em || ''))}</td><td>${chip(a.estado, a.estado === 'vivo' ? 'ok' : 'gold')}</td></tr>`).join('')}
  </tbody></table>`
  const secQualidade = `
<section>
  ${secTitulo('01', 'Qualidade dos dados', 'O que foi coletado, de quando, com que buracos — e o que não dá para analisar.')}${sis('trinity')}
  <table class="pl-tab"><thead><tr><th>Fonte</th><th>Status</th><th>Período</th><th>Atualizado</th>${cli ? '' : '<th>Definição</th>'}</tr></thead><tbody>
  ${(dq.fontes || []).map(f => `<tr><td>${tx(f.fonte)}</td><td>${chip(ROT_ESTADO[f.status] || f.status, f.status === 'disponivel' ? 'ok' : f.status === 'parcial' ? 'gold' : 'cinza')}</td><td>${f.periodo ? `${esc(brData(f.periodo.de))} a ${esc(brData(f.periodo.ate))}` : '—'}</td><td>${f.atualizado_em ? esc(brData(String(f.atualizado_em).slice(0, 10))) : '—'}</td>${cli ? '' : `<td class="pl-sc">${esc(f.definicao || '')}</td>`}</tr>`).join('')}
  </tbody></table>
  ${dq.cobertura ? `<p class="pl-h">Cobertura</p><ul class="pl-ul"><li>Pedidos: ${dq.cobertura.pedidos?.de ? `${esc(brData(dq.cobertura.pedidos.de))} a ${esc(brData(dq.cobertura.pedidos.ate))}` : '—'}; sem coleta: ${ec('cobertura:pedidos_lacunas')}; truncados: ${ec('cobertura:pedidos_truncados')}.</li><li>Visitas: ${ec('cobertura:visitas_cobertos')} de ${ec('cobertura:visitas_total')} anúncio(s) cobertos no período inteiro.</li><li>Product Ads: ${dq.cobertura.ads?.janela ? `janela ${esc(brData(dq.cobertura.ads.janela.de))} a ${esc(brData(dq.cobertura.ads.janela.ate))}` : 'não coletado'}.</li></ul>` : ''}
  <p class="pl-h">Análises bloqueadas (declaradas, nunca estimadas)</p>
  <table class="pl-tab"><thead><tr><th>Análise</th><th>Estado</th><th>Motivo</th><th>Como obter</th></tr></thead><tbody>
  ${(dq.analises_bloqueadas || []).map(b => `<tr><td>${tx(b.analise)}</td><td>${chip(estado(b.estado), 'cinza')}</td><td>${tx(b.motivo)}</td><td>${tx(b.como_obter)}</td></tr>`).join('')}
  </tbody></table>
  ${dq.incompatibilidades?.length ? `<p class="pl-h">Incompatibilidades entre fontes</p>${lista(dq.incompatibilidades)}` : ''}
  ${secAlinhado}
  ${cli ? '' : obsConsultor(j.cliente)}
  <p class="pl-sc">Canais: ${Object.entries(j.canais_suportados || {}).map(([c, s]) => `${esc(ROT_CANAL[c] || c)} ${s === 'SUPPORTED' ? 'suportado' : cli ? 'sem integração' : 'sem integração (NOT_SUPPORTED)'}`).join(' · ')}</p>
</section>`
  const kpi = (k, rotulo) => `<div class="pl-kpi"><b>${val(m[k])}</b><span>${esc(rotulo)}</span></div>`
  const linhaMet = (k, mt, onde = '') => `<tr><td>${esc(ROT_METRICA[k] || k)}${mt?.anterior != null && !cli ? `<div class="pl-sc">anterior: ${esc(n2(mt.anterior))}</div>` : ''}</td><td><b>${val(mt)}</b></td><td class="pl-sc">${esc(mt?.periodo || '')}</td>${cli ? '' : `<td class="pl-sc">${esc(mt?.fonte || '')}</td><td class="pl-sc">${esc(mt?.formula || '')}${mt?.evidence_id ? ` <span class="pl-sc">[${esc(mt.evidence_id)}]</span>` : ''}</td>`}</tr>`
  const secMetricas = `
<section>
  ${secTitulo('02', 'Métricas da conta', 'Uma fórmula por métrica. Dado ausente é "—" com o motivo, nunca zero.')}${sis('trinity')}
  <div class="pl-kpis">${kpi('receita', 'receita 28 dias')}${kpi('variacao', 'variação vs anterior')}${kpi('pedidos', 'pedidos pagos')}${kpi('ticket', 'ticket médio')}${kpi('conversao_conta', 'conversão de referência')}</div>
  <table class="pl-tab"><thead><tr><th>Métrica</th><th>Valor</th><th>Período</th>${cli ? '' : '<th>Fonte</th><th>Fórmula</th>'}</tr></thead><tbody>
  ${Object.entries(m).map(([k, mt]) => linhaMet(k, mt)).join('')}
  </tbody></table>
  <p class="pl-h">Por curva</p>
  <table class="pl-tab"><thead><tr><th>Curva</th><th>Anúncios</th><th>Receita</th><th>Participação</th><th>Unidades</th><th>Conversão</th><th>Estratégia do grupo</th></tr></thead><tbody>
  ${['A', 'B', 'C'].map(c => { const g = j.metrics?.por_curva?.[c] || {}; return `<tr><td><b>${c}</b></td><td>${val(g.n_anuncios)}</td><td>${val(g.receita)}</td><td>${val(g.share_pct)}</td><td>${val(g.unidades)}</td><td>${val(g.conversao)}</td><td>${g.estrategia ? `${esc(g.estrategia.classe)}${g.estrategia.provisoria ? ' <span class="pl-sc">(provisória)</span>' : ''}` : '<span class="pl-sc">grupo sem leitura</span>'}</td></tr>` }).join('')}
  </tbody></table>
</section>`
  const estr = ad.estrategia, est = ad.estado
  const secConta = `
<section>
  ${secTitulo('03', 'Diagnóstico da conta', 'Estado, estratégia e concentração — toda causa é hipótese.')}${sis('arquiteto')}
  <div class="verdict"><span class="eyebrow">Leitura</span><p>${tx(texto)}</p></div>
  <table class="pl-tab"><tbody>
  <tr><td><b>Estado</b></td><td>${est?.estado ? `${esc(est.rotulo || est.estado)}${est.variacao_pct != null ? ` (${est.variacao_pct >= 0 ? '+' : ''}${esc(n2(est.variacao_pct, 1))}%)` : ''} ${chip(est.significativo && !est.sinal_misto ? 'Fato observado' : 'Hipótese', est.significativo && !est.sinal_misto ? 'ok' : 'gold')}${est.sinal_misto ? ' ' + chip('sinal misto', 'gold') : ''}<div class="pl-sc">${tx(est.motivo || '')}</div>` : `<span class="pl-sc">— (${tx(est?.motivo || 'sem leitura')})</span>`}</td></tr>
  <tr><td><b>Estratégia</b></td><td>${estr ? `<b>${esc(estr.classe)}</b> ${estr.provisoria ? chip('Hipótese (provisória)', 'gold') : `${chip('firme', 'gold')} ${chip(estr.confianca === 'fato' ? 'Fato observado' : 'Hipótese', estr.confianca === 'fato' ? 'ok' : 'gold')}`}<div class="pl-sc">${tx(estr.justificativa)}</div>${estr.provisoria ? `<div class="pl-sc">Falta medir: ${esc((estr.faltam || []).join(', '))}. Revisão em ${esc(brData(estr.revisar_em))}.</div>` : ''}` : '<span class="pl-sc">— (sem retroalimentação disponível)</span>'}</td></tr>
  <tr><td><b>Cadeia causal</b></td><td>${ad.causal?.disponivel ? `${tx(ad.causal.leitura || '')}${ad.causal.elo ? `<div class="pl-sc">Elo com maior queda relativa: ${esc(ad.causal.elo)} (hipótese)</div>` : ''}` : `<span class="pl-sc">— (${tx(ad.causal?.motivo || 'sem dois períodos completos')})</span>`}</td></tr>
  <tr><td><b>Concentração</b></td><td>${ad.concentracao ? `${ec('conta:concentracao_n80')} de ${ec('conta:concentracao_n')} anúncio(s) fazem 80% da receita; o maior responde por ${ec('conta:concentracao_top1')}.${ad.concentracao.alerta ? `<div class="pl-sc">${tx(ad.concentracao.alerta)}</div>` : ''}` : '<span class="pl-sc">— (sem receita no período)</span>'}</td></tr>
  ${!cli && ad.leitura_merovingio ? `<tr><td><b>Merovíngio</b></td><td>${ad.leitura_merovingio.tese ? `<b>${esc(ad.leitura_merovingio.arquetipo || '')}</b> — ${esc(ad.leitura_merovingio.tese)}${ad.leitura_merovingio.falsificador ? `<div class="pl-sc">Falsificador: ${esc(ad.leitura_merovingio.falsificador)}</div>` : ''}` : `<span class="pl-sc">${esc(ad.leitura_merovingio.motivo || '')}</span>`}</td></tr>` : ''}
  </tbody></table>
  ${!cli ? `<p class="pl-sc">Evidências citadas: ${(ad.evidence_ids || []).map(esc).join(', ') || '—'}</p>` : ''}
</section>`
  const secAnuncios = `
<section>
  ${secTitulo('04', 'Anúncios', 'Problemas e oportunidades por anúncio, com as causas possíveis (hipóteses) e o que confirma cada uma.')}${sis('arquiteto')}
  ${(j.listing_diagnoses || []).length ? `<table class="pl-tab"><thead><tr><th>Anúncio</th><th>Curva</th><th>Diagnóstico</th><th>Causas possíveis (hipóteses)</th><th>Confirmar com</th></tr></thead><tbody>
  ${j.listing_diagnoses.map(l => `<tr><td>${tx(l.titulo, true)}${idTxt(l.entidade.id)} ${seloCat(l.catalogo_origem)}</td><td>${esc(l.curva || '—')}</td><td>${l.problemas.map(p => `<div><b>${esc(rot(p.regra))}</b> ${chip(p.oportunidade ? 'oportunidade' : 'problema', p.oportunidade ? 'ok' : 'blood')} <span class="pl-sc">confiança ${esc(p.confianca)}/5</span><div class="pl-sc">${tx(p.problema)}</div></div>`).join('')}</td><td>${causas(l.problemas.flatMap(p => p.causas_possiveis)).length ? `<ul class="pl-ul">${causas(l.problemas.flatMap(p => p.causas_possiveis)).map(c => `<li>${esc(rotCausa(c.causa))}: ${tx(c.sinal)}</li>`).join('')}</ul>` : '—'}</td><td>${lista([...new Set(l.problemas.flatMap(p => p.confirmar_com))])}</td></tr>`).join('')}
  </tbody></table>` : '<p class="vazio">Nenhum anúncio com diagnóstico no plano atual.</p>'}
</section>`
  const secAds = `
<section>
  ${secTitulo('05', 'Product Ads', 'Leitura por anúncio. Campanha, orçamento e palavra-chave não são coletados.')}${sis('arquiteto')}
  ${C.conta ? `<div class="pl-kpis">${kpi('roas', 'ROAS da conta')}${kpi('acos', 'ACOS')}${kpi('tacos', 'TACOS')}${kpi('ctr_ads', 'CTR de Ads')}${kpi('cpc', 'custo por clique')}</div>` : ''}
  ${C.conta?.economia ? `<p class="pl-sc">${EC.has('conta:roas_alvo') ? `ROAS alvo ${ec('conta:roas_alvo')} (ACOS máximo ${ec('conta:acos_max_pct')}) pelos custos informados.` : tx(C.conta.economia.nota)}</p>` : '<p class="pl-sc">Sem custos informados não existe ROAS alvo: a leitura é relativa à própria conta.</p>'}
  ${C.conta?.meta && (EC.has('conta:meta_roas') || EC.has('conta:meta_acos_max')) ? `<p class="pl-sc">Meta do mês: ${[EC.has('conta:meta_roas') ? `ROAS ${ec('conta:meta_roas')}` : '', EC.has('conta:meta_acos_max') ? `ACOS máximo ${ec('conta:meta_acos_max')}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
  ${(C.itens || []).length ? `<table class="pl-tab"><thead><tr><th>Anúncio</th><th>CTR</th><th>CPC</th><th>ACOS</th><th>ROAS</th><th>Regras de Ads</th></tr></thead><tbody>
  ${C.itens.map(it => `<tr><td>${tx(it.titulo, true)}${idTxt(it.entidade.id)}</td><td>${val(it.ctr)}</td><td>${val(it.cpc)}</td><td>${val(it.acos)}</td><td>${val(it.roas)}</td><td>${it.regras?.length ? it.regras.map(r => `<div><b>${esc(rot(r.regra))}</b><div class="pl-sc">${tx(r.problema)}</div></div>`).join('') : '—'}</td></tr>`).join('')}
  </tbody></table>` : '<p class="vazio">Nenhum anúncio com Product Ads coletado.</p>'}
  <div class="pl-inativo"><b>Pendência declarada:</b> ${tx(C.pendencia?.item || 'campanhas de Product Ads')} — ${chip(estado(C.pendencia?.estado || 'NOT_SUPPORTED'), 'cinza')} ${tx(C.pendencia?.motivo || '')}</div>
</section>`
  const blocoItem = i => `<li><b>${esc(rot(i.regra))}</b> ${chip(ROT_TIPO_EV[i.evidencia_tipo] || 'Hipótese', i.evidencia_tipo === 'fato' ? 'ok' : 'gold')}${i.prioridade ? ` ${chip(i.prioridade, i.prioridade === 'P0' ? 'blood' : '')}` : ''}<div class="pl-sc">${tx(i.texto)}</div>${causas(i.causas_possiveis).length ? `<div class="pl-sc">Causas possíveis: ${causas(i.causas_possiveis).map(c => esc(rotCausa(c.causa))).join(', ')} (hipóteses)</div>` : ''}</li>`
  const secProblemas = `
<section>
  ${secTitulo('06', 'Problemas', 'O que as regras apontaram como gargalo, com o tipo de evidência.')}${sis('arquiteto')}
  ${(j.issues || []).length ? `<ul class="pl-ul">${j.issues.map(blocoItem).join('')}</ul>` : '<p class="vazio">Nenhum problema apontado pelas regras no plano atual.</p>'}
</section>
<section>
  ${secTitulo('07', 'Oportunidades', 'Expansão: tráfego, kit, duplicação, Full, sazonalidade e diversificação da receita.')}${sis('arquiteto')}
  ${(j.opportunities || []).length ? `<ul class="pl-ul">${j.opportunities.map(blocoItem).join('')}</ul>` : '<p class="vazio">Nenhuma oportunidade apontada pelas regras no plano atual.</p>'}
</section>`
  const secAcoes = `
<section>
  ${secTitulo('08', 'Ações priorizadas', 'O quê, por quê (evidência citada), métrica que prova, quando parar e quando revisar.')}${sis('arquiteto')}
  ${(j.actions || []).length ? `<table class="pl-tab"><thead><tr><th>Prio</th><th>O quê</th><th>Por quê (evidência)</th><th>Métrica de sucesso</th><th>Parada · revisão</th>${cli ? '' : '<th>Quem · prazo · via</th>'}</tr></thead><tbody>
  ${j.actions.map(a => `<tr>
  <td><b>${esc(a.prioridade?.p || '—')}</b><div class="pl-sc">${esc(ROT_PRIO[a.prioridade?.p] || '')}</div>${!cli && a.prioridade?.nota != null ? `<div class="pl-sc">${esc(a.prioridade.nota)}/100</div>` : ''}</td>
  <td><b>${tx(a.o_que)}</b>${idTxt(a.id)}${a.limites?.length ? `<div class="pl-sc">${a.limites.slice(0, 2).map(tx).join(' · ')}</div>` : ''}${!cli && a.depende_de?.length ? `<div class="pl-sc">depende de: ${a.depende_de.map(esc).join(', ')}</div>` : ''}</td>
  <td>${evTxt(a.por_que?.evidence_ids) || '—'}${a.por_que?.hipotese ? `<div class="pl-sc"><b>Hipótese:</b> ${tx(a.por_que.hipotese)}</div>` : ''}</td>
  <td>${tx(a.metrica_sucesso?.indicador || '—')}<div class="pl-sc">meta: ${tx(a.metrica_sucesso?.meta || '—')}</div></td>
  <td class="pl-sc">${tx(a.parada || '—')}<div>revisar em ${a.revisar_em ? esc(brData(a.revisar_em)) : '—'}</div></td>
  ${cli ? '' : `<td>${esc(a.responsavel || 'responsável a definir')}<div class="pl-sc">${esc(brData(a.prazo || ''))} · ${esc(a.horizonte || '')} · via ${esc(a.executar_via)}</div><div class="pl-sc">${esc(a.status || '')}</div></td>`}</tr>`).join('')}
  </tbody></table>` : '<p class="vazio">Nenhuma ação no plano atual.</p>'}
</section>`
  const secPrompts = cli ? '' : `
<section>
  ${secTitulo('09', 'Prompts derivados', 'Textos e briefings que cada ação pede. Pendente = falta insumo declarado; a IA, quando existir, só reescreve.')}${sis('arquiteto')}
  ${(j.derived_prompts || []).length ? j.derived_prompts.map(p => `<div class="pl-inativo"><b>${esc(p.rotulo || p.tipo)}</b> · ${esc(p.entidade?.id || '')} · ${esc(p.acao_id)} ${chip(p.estado, p.estado === 'pronto' ? 'ok' : 'gold')}
  <div class="pl-f">${esc(p.texto)}</div>
  ${p.restricoes?.preservar?.length ? `<div class="pl-sc">Preservar: ${p.restricoes.preservar.map(x => esc(`${x.campo}=${x.valor} (${x.fonte})`)).join('; ')}</div>` : '<div class="pl-sc">Preservar: nenhum dado da ficha com fonte</div>'}
  ${p.insumos_faltantes?.length ? `<div class="pl-sc">Falta: ${p.insumos_faltantes.map(f => esc(`${f.item} [${f.estado}] — ${f.como_obter}`)).join('<br>')}</div>` : ''}</div>`).join('') : '<p class="vazio">Nenhum prompt derivado.</p>'}
</section>`
  const rp = j.review_plan || {}
  const secRevisao = cli ? '' : `
<section>
  ${secTitulo('10', 'Plano de revisão', 'Ritual do algoritmo e as próximas datas de conferência.')}${sis('oraculo')}
  <ul class="pl-ul">${Object.entries(rp.ritual || {}).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>
  ${rp.sinal_misto ? '<p class="pl-sc">Sinal misto na conta: revisão antecipada (+7 dias).</p>' : ''}
  ${rp.ciclo_anterior ? `<p class="pl-sc">Ciclo anterior: ${esc(JSON.stringify(rp.ciclo_anterior).slice(0, 240))}</p>` : ''}
  ${(rp.proximas_revisoes || []).length ? `<table class="pl-tab"><thead><tr><th>Quando</th><th>Ação</th><th>O que conferir</th></tr></thead><tbody>${rp.proximas_revisoes.map(r => `<tr><td>${esc(brData(r.em))}</td><td>${esc(r.acao_id)}</td><td class="pl-sc">${esc(r.o_que_conferir)}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhuma revisão agendada.</p>'}
</section>`
  const limites = `
<section>
  ${secTitulo(cli ? '09' : '11', 'Limites declarados', 'O que este diagnóstico não faz, de propósito.')}${sis('arquiteto')}
  <ul class="pl-ul">
    <li>Só Mercado Livre tem dado medido. Amazon, Shopee e TikTok Shop não têm integração${cli ? '' : ' (NOT_SUPPORTED)'}.</li>
    ${cli && j.omitidos ? `<li>${esc(j.omitidos)} tarefa(s) de rotina da equipe não entram neste diagnóstico.</li>` : ''}
    <li>Campanhas de Product Ads (orçamento, campanha, palavra-chave) não são coletadas: a leitura é por anúncio.</li>
    <li>Toda causa é hipótese: coincidência no tempo não é causalidade. Nenhuma receita é prometida; cifras são cenários com premissas declaradas.</li>
    <li>Sem custos informados não existe leitura de margem (nem de resultado). Dado ausente é ausente, nunca zero.</li>
    <li>Caixa, capacidade e mercado não são medidos: a estratégia nasce provisória até existirem.</li>
    <li>Nada é executado pelo motor: preço, Ads, estoque e conteúdo são decisão humana.</li>
  </ul>
</section>`
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagnóstico de marketplace — ${esc(j.cliente)}</title>
${FONTES}
<style>${CSS}
  .pl-chip{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:9.5px;padding:1px 7px;border:1px solid var(--rule);border-radius:2px;color:var(--rule);white-space:nowrap}
  .pl-chip.ok{border-color:var(--sage);color:var(--sage)} .pl-chip.gold{border-color:var(--gold);color:var(--gold)} .pl-chip.cinza{border-color:var(--cinza);color:var(--cinza)} .pl-chip.blood{border-color:var(--blood);color:var(--blood)}
  .pl-tab{font-size:10.5px;width:100%} .pl-tab td,.pl-tab th{vertical-align:top;padding:7px 6px}
  .pl-sc{font-size:9.5px;color:var(--rule)} .pl-ul{margin:4px 0 0 18px;padding:0;font-size:12.5px} .pl-ul li{margin:2px 0}
  .pl-inativo{border-left:3px solid var(--gold);background:#fffdfa;padding:10px 14px;font-size:12px;margin:10px 0}
  .pl-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0}
  .pl-kpi{border:1px solid rgba(42,37,32,.14);border-top:3px solid var(--accent);background:#fffdfa;padding:10px 12px}
  .pl-kpi b{display:block;font-size:20px;font-family:'Playfair Display',serif} .pl-kpi span{font-size:10px;color:var(--rule)}
  .pl-f{font-family:'JetBrains Mono',monospace;font-size:11px;background:#fffdfa;border:1px solid rgba(42,37,32,.14);padding:8px 12px;margin:6px 0;white-space:pre-wrap}
  .pl-h{font-size:13px;margin:18px 0 6px} section{margin-bottom:26px} a{color:inherit}
  @media(max-width:720px){.pl-kpis{grid-template-columns:repeat(2,1fr)}}
  .pl-obs textarea{width:100%;font:inherit;font-size:12px} .pl-obs button{font:inherit;font-size:12px;margin-top:6px}
  @media print{.pl-tab{font-size:8.5px} section{page-break-inside:auto} .pl-obs{display:none}}
</style></head><body><div class="pagina">
${capa({ documento: cli ? 'Diagnóstico de marketplace' : 'Diagnóstico de marketplace (interno)', titulo: j.cliente, subtitulo: `Mercado Livre · ${j.periodo ? `${brData(j.periodo.de)} a ${brData(j.periodo.ate)}` : 'sem período'}`,
    meta: [`Gerado em <b>${esc(brData(String(j.gerado_em || '').slice(0, 10)))}</b>`, `${cli ? 'Versão' : 'Algoritmo'} <b>v${esc(j.versao)}</b>`, `Canal <b>Mercado Livre</b>`] })}
${j.disponivel === false ? `<div class="verdict alerta"><span class="eyebrow">Sem dados</span><p>${tx(j.motivo || 'conta sem dados coletados do Mercado Livre')}</p></div>` : ''}
${secQualidade}
${j.disponivel === false ? '' : secMetricas + secConta + secAnuncios + secAds + secProblemas + secAcoes + secPrompts + secRevisao}
${limites}
${cli ? `<footer><span>${esc(MARCA.nome)} · ${esc(MARCA.territorio)}</span><span>Diagnóstico v${esc(j.versao)} · leitura indicativa, não garantia</span><span>Fonte: Mercado Livre e registros da Place2u</span></footer>` : rodape(`Diagnóstico v${j.versao} · leitura indicativa, não garantia`)}
</div></body></html>`
}
