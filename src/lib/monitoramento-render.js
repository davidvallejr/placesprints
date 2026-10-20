// Renderiza o monitoramento do ML nos 3 blocos da skill (mensagem p/ o cliente, resumo interno, dados brutos)
// + o consolidado. Regras da skill preservadas: zero emoji; número sempre com contexto; começa pelo que mudou;
// alerta crítico abre a mensagem; nunca prometer resultado; vocabulário Place2u (investimento, condição especial,
// nossa assessoria); a mensagem do cliente NUNCA é enviada ao seller — vai para a equipe revisar.
import { pct } from './monitoramento-meli.js'

const brl = v => v == null ? 'sem dado' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = v => v == null ? 'sem dado' : Number(v).toLocaleString('pt-BR')
const pc = v => v == null ? 'sem dado' : String(v).replace('.', ',') + '%'
const dm = iso => iso.slice(8) + '/' + iso.slice(5, 7)
const per = j => `${dm(j.de)} a ${dm(j.ate)}`
const vari = v => v == null ? 'sem base' : (v > 0 ? '+' : '') + String(v).replace('.', ',') + '%'
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const nomeArquivo = (r, dia) => `${dia}-${slug(r.cliente)}.md`

function tabela(cab, linhas) {
  return [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...linhas.map(l => `| ${l.map(x => String(x ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n')
}

// ── Bloco 1 — mensagem para o cliente (WhatsApp; revisão humana antes do disparo) ──
function blocoCliente(r) {
  const ag = r.agregados, v = r.variacao, criticos = r.alertas.filter(a => a.nivel === 'Crítico')
  const l = []
  if (criticos.length) {
    // a abertura depende do TIPO do alerta crítico (ruptura, reputação, mediação, anúncio em revisão) — nada de frase genérica de estoque
    const curto = t => t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') + '...' : t
    const rup = criticos.filter(x => /^Estoque zerado com venda/.test(x.oque)), outros = criticos.filter(x => !rup.includes(x))
    const abre = []
    if (rup.length) abre.push(`${rup.length > 1 ? `${rup.length} anúncios` : 'um anúncio'} com venda na semana ${rup.length > 1 ? 'estão' : 'está'} sem estoque, a começar por "${curto(rup[0].produto)}"; estamos priorizando a reposição pelos que mais vendem e precisamos da sua posição sobre o prazo`)
    for (const o of outros) abre.push(`${o.oque.charAt(0).toLowerCase() + o.oque.slice(1)}${o.produto ? ` ("${curto(o.produto)}")` : ''}; ${o.acao.split(' — ')[0].charAt(0).toLowerCase() + o.acao.split(' — ')[0].slice(1)} e já estamos nisso na nossa assessoria`)
    l.push(`Preciso da sua atenção hoje: ${abre.join('. Também: ')}.`)
    l.push('')
  }
  const mudou = v.semana == null ? `Na semana fechada (${per(ag.semana_atual)}) vendemos ${brl(ag.semana_atual.faturamento)}; a semana anterior não tem base de comparação.`
    : `Na semana fechada (${per(ag.semana_atual)}) a conta vendeu ${brl(ag.semana_atual.faturamento)}, ${v.semana >= 0 ? 'alta' : 'queda'} de ${vari(Math.abs(v.semana)).replace('+', '')} contra ${brl(ag.semana_anterior.faturamento)} em ${per(ag.semana_anterior)}.`
  l.push(mudou)
  l.push(`No mês, de ${per(r.janelas.mes_atual)} foram ${brl(ag.mes_atual.faturamento)}, contra ${brl(ag.mes_anterior.faturamento)} de ${per(r.janelas.mes_anterior)} (${vari(v.mes_ate_d)}). O dia ${dm(r.data)} ainda está parcial${ag.mes_atual_d1 ? `; até ${dm(r.janelas.mes_atual_d1.ate)} são ${brl(ag.mes_atual_d1.faturamento)} contra ${brl(ag.mes_anterior_d1.faturamento)} (${vari(v.mes_ate_d1)})` : ''}.`)
  if (ag.semana_atual.conversao != null && ag.semana_anterior.conversao != null) {
    const d = r2(ag.semana_atual.conversao - ag.semana_anterior.conversao)
    l.push(`A conversão ficou em ${pc(ag.semana_atual.conversao)} (${d >= 0 ? '+' : ''}${String(d).replace('.', ',')} ponto contra ${pc(ag.semana_anterior.conversao)} na semana anterior) com ${num(ag.semana_atual.visitas)} visitas.`)
  }
  const top = r.produtos.top_atual[0]
  if (top) l.push(`O anúncio que mais vendeu foi ${top.titulo}, com ${brl(top.receita)} na semana.`)
  const aten = r.alertas.filter(a => a.nivel === 'Atenção')
  if (!criticos.length && aten.length) l.push(`O ponto de atenção principal: ${aten[0].oque.charAt(0).toLowerCase() + aten[0].oque.slice(1)}${aten[0].produto ? ` (${aten[0].produto})` : ''}.`)
  l.push('')
  l.push(criticos.length || aten.length ? 'Já estamos tratando os pontos acima na nossa assessoria; se algum depender de uma decisão sua, avisamos por aqui.' : 'Seguimos acompanhando a conta todos os dias e avisamos assim que algo mudar.')
  return l.join('\n')
}
const r2 = n => Math.round(n * 100) / 100

// ── Bloco 2 — resumo interno (Discord da equipe) ──
function blocoInterno(r) {
  const ag = r.agregados, v = r.variacao, J = r.janelas
  const linhas = (a, b) => [
    ['Faturamento', brl(a.faturamento), brl(b.faturamento), vari(pct(a.faturamento, b.faturamento))],
    ['Pedidos', num(a.pedidos), num(b.pedidos), vari(pct(a.pedidos, b.pedidos))],
    ['Unidades', num(a.unidades), num(b.unidades), vari(pct(a.unidades, b.unidades))],
    ['Visitas', num(a.visitas), num(b.visitas), vari(pct(a.visitas, b.visitas))],
    ['Conversão (calculada)', pc(a.conversao), pc(b.conversao), a.conversao != null && b.conversao != null ? `${r2(a.conversao - b.conversao) >= 0 ? '+' : ''}${String(r2(a.conversao - b.conversao)).replace('.', ',')} p.p.` : 'sem base'],
    ['Ticket médio por pedido', brl(a.ticket), brl(b.ticket), vari(pct(a.ticket, b.ticket))],
  ]
  const s = []
  s.push('### Semana fechada')
  s.push(tabela(['Métrica', `Atual (${per(J.semana_atual)})`, `Anterior (${per(J.semana_anterior)})`, 'Variação'], linhas(ag.semana_atual, ag.semana_anterior)))
  s.push('', '### Mês até hoje')
  s.push(tabela(['Métrica', `Mês corrente (${per(J.mes_atual)})`, `Mês anterior (${per(J.mes_anterior)})`, 'Variação'], linhas(ag.mes_atual, ag.mes_anterior)))
  if (ag.mes_atual_d1) s.push('', `Versão até D-1 (dia ${dm(r.data)} parcial fora): ${per(J.mes_atual_d1)} = ${brl(ag.mes_atual_d1.faturamento)} contra ${per(J.mes_anterior_d1)} = ${brl(ag.mes_anterior_d1.faturamento)} (${vari(v.mes_ate_d1)}).`)
  s.push('', ...J.ressalvas.map(x => `Ressalva: ${x}.`), 'Conversão = pedidos pagos / visitas e ticket = faturamento / pedidos, ambos calculados sobre a soma da janela (não são o agregado oficial do painel do ML).')
  s.push('', '### Alertas')
  s.push(r.alertas.length ? tabela(['Nível', 'Anúncio', 'Produto', 'O que disparou', 'Ação e responsável'], r.alertas.map(a => [a.nivel, a.item_id, a.produto, a.oque, a.acao])) : 'Nenhum alerta nesta rodada.')
  s.push('', '### Positivos', r.positivos.length ? r.positivos.map(x => `- ${x}`).join('\n') : '- Nenhum destaque positivo acima da oscilação normal.')
  s.push('', '### Ads (Product Ads)')
  const adsKeys = ['semana_atual', 'semana_anterior', 'mes_atual', 'mes_anterior']
  s.push(Object.keys(r.ads).length ? tabela(['Janela', 'Investimento', 'Vendas atribuídas', 'ACOS', 'ROAS', 'TACOS'], adsKeys.map(k => {
    const a = r.ads[k]; return a?.disponivel ? [`${k.replace('_', ' ')} (${per(J[k])})`, brl(a.investimento), brl(a.receita), pc(a.acos), a.roas ?? 'sem dado', pc(a.tacos)] : [`${k.replace('_', ' ')} (${per(J[k])})`, 'sem dado', 'sem dado', 'sem dado', 'sem dado', a?.motivo || 'indisponível']
  })) : 'Ads não coletado nesta rodada.')
  s.push(r.teto_acos ? `Teto de ACOS considerado: ${r.teto_acos}%.` : 'Teto de ACOS acordado com o cliente não definido: sem alerta de ACOS.')
  s.push('', '### O que precisa de ação e de quem', r.alertas.length ? r.alertas.slice(0, 8).map(a => `- ${a.nivel}: ${a.acao}${a.produto ? ` (${a.produto})` : ''}`).join('\n') : '- Nada pendente.')
  s.push('', '### Lacunas de coleta', r.lacunas.length ? r.lacunas.map(x => `- ${x}`).join('\n') : '- Nenhuma.')
  return s.join('\n')
}

// ── Bloco 3 — dados brutos ──
function blocoBruto(r) {
  const s = []
  s.push('### Vendas por dia', tabela(['Data', 'Pedidos', 'Faturamento', 'Unidades', 'Visitas'], r.vendas_por_dia.map(d => [dm(d.dia), d.pedidos, brl(d.faturamento), d.unidades, d.visitas])))
  const lp = x => [x.titulo, x.item_id, x.status, brl(x.receita), x.unidades, x.visitas, x.estoque ?? 'sem dado']
  s.push('', `### Top 10 por faturamento — semana atual (${per(r.janelas.semana_atual)})`, tabela(['Produto', 'Anúncio', 'Status', 'Faturamento', 'Unidades', 'Visitas', 'Estoque'], r.produtos.top_atual.map(lp)))
  s.push('', `### Top 10 da semana anterior (${per(r.janelas.semana_anterior)})`, tabela(['Produto', 'Anúncio', 'Status', 'Faturamento', 'Unidades', 'Visitas', 'Estoque'], r.produtos.top_anterior.map(lp)))
  if (r.produtos.sairam_do_top.length) s.push('', 'Saíram do top 10 (estavam no anterior):', tabela(['Produto', 'Anúncio', 'Faturamento anterior', 'Faturamento atual'], r.produtos.sairam_do_top.map(x => [x.titulo, x.item_id, brl(x.receita), brl(x.receita_atual)])))
  s.push('', 'Os produtos são os anúncios (MLB) com venda na janela, ligados pela série diária; título vem do último sync do anúncio.')
  s.push('', '### Estoque sinalizado', r.estoque.sinalizados.length ? tabela(['Produto', 'Anúncio', 'Estoque', 'Vendas semana (un.)', 'Cobertura (dias)'], r.estoque.sinalizados.map(e => [e.titulo, e.item_id, e.estoque, e.unidades_semana, e.cobertura_dias ?? 'sem venda'])) : 'Nenhum anúncio com ruptura ou cobertura abaixo de 14 dias.', `Anúncios por status: ${Object.entries(r.estoque.status_anuncios).map(([k, v]) => `${k} ${v}`).join(', ') || 'sem dado'}. Base: ${r.estoque.base}.`)
  const sa = r.saude
  s.push('', '### Saúde da conta (consultada ao vivo na API)')
  const lin = []
  if (sa.reputacao) { const rp = sa.reputacao; lin.push(['Reputação (nível)', rp.nivel ?? 'sem dado'], ['Medalha MercadoLíder', rp.medalha ?? 'sem'], ['Vendas no período do ML', `${num(rp.vendas_periodo)} (${rp.periodo || '—'})`], ['Reclamações', rp.reclamacoes ? `${pc(rp.reclamacoes.taxa)} (${rp.reclamacoes.qtd})` : 'sem dado'], ['Atrasos no envio', rp.atrasos ? `${pc(rp.atrasos.taxa)} (${rp.atrasos.qtd})` : 'sem dado'], ['Cancelamentos', rp.cancelamentos ? `${pc(rp.cancelamentos.taxa)} (${rp.cancelamentos.qtd})` : 'sem dado']) }
  if (sa.perguntas) lin.push(['Perguntas sem resposta', `${sa.perguntas.sem_resposta} (${sa.perguntas.ha_mais_de_24h} há mais de 24h)`])
  if (sa.reclamacoes) lin.push(['Reclamações abertas', `${sa.reclamacoes.abertas} (${sa.reclamacoes.em_mediacao} em mediação) — amostra dos 50 mais recentes`])
  s.push(lin.length ? tabela(['Indicador', 'Valor'], lin) : 'Saúde da conta indisponível nesta rodada.')
  return s.join('\n')
}

export function renderConta(r) {
  if (!r.coletada) return `# ${r.cliente} — não coletada\n\nMotivo: ${r.motivo}\n`
  return [`# Monitoramento diário Mercado Livre — ${r.cliente} — ${r.data.split('-').reverse().join('/')}`,
    `Janelas: semana fechada ${per(r.janelas.semana_atual)} contra ${per(r.janelas.semana_anterior)}; mês ${per(r.janelas.mes_atual)} contra ${per(r.janelas.mes_anterior)}.`, '',
    '## Bloco 1 — Mensagem para o cliente', '', '> Revisão humana antes do disparo. Esta rotina nunca envia nada ao seller.', '', blocoCliente(r), '',
    '## Bloco 2 — Resumo interno', '', blocoInterno(r), '',
    '## Bloco 3 — Dados brutos', '', blocoBruto(r), ''].join('\n')
}

export function renderConsolidado(res, dia) {
  const f = x => x.coletada
  const linhas = res.map(r => f(r) ? [r.cliente, `${brl(r.agregados.semana_atual.faturamento)} (${vari(r.variacao.semana)})`, `${brl(r.agregados.mes_atual.faturamento)} (${vari(r.variacao.mes_ate_d)})`,
    r.alertas.filter(a => a.nivel === 'Crítico').length, r.alertas.filter(a => a.nivel === 'Atenção').length, (r.alertas[0]?.oque || '—').slice(0, 70), r.lacunas.length ? `com lacunas (${r.lacunas.length})` : 'completa']
    : [r.cliente, '—', '—', '—', '—', '—', `não coletada: ${r.motivo}`])
  return [`# Consolidado — Mercado Livre — ${dia.split('-').reverse().join('/')}`, '',
    tabela(['Conta', 'Faturamento da semana (var.)', 'Faturamento do mês até hoje (var.)', 'Críticos', 'Atenção', 'Principal alerta', 'Status da coleta'], linhas),
    '', `Contas: ${res.length} · coletadas: ${res.filter(f).length} · alertas críticos: ${res.reduce((t, r) => t + (f(r) ? r.alertas.filter(a => a.nivel === 'Crítico').length : 0), 0)}`,
    'Status do e-mail: nenhum envio automático nesta versão — os arquivos ficam para a equipe revisar e enviar.', ''].join('\n')
}
