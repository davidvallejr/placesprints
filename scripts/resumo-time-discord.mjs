// Resumo da semana para o TIME no canal do cliente no Discord (Mercado Livre). Só lê; imprime JSON { partes[], webhook_ok, mencao }.
// Uso: node scripts/resumo-time-discord.mjs "<cliente>"  — o envio é feito pelo fluxo de entrega do n8n (canal discord), uma parte por vez.
// Seções por sistema de origem (config/sistemas.json, 15/10/2026): ✅ Merovíngio — o que rendeu · 🔁 Merovíngio — sem resultado medido · 🔔 Morpheus — pontos da assessoria ·
// 💰 Smith — custos e preço · 🔮 Oráculo — previsão · 📦 Arquiteto — plano da semana (o que o cliente precisa fazer). Canal INTERNO: ao cliente nada muda.
import { readFileSync } from 'node:fs'
const { diagnosticarConta, sugestaoFull, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { analisarCliente } = await import('../src/lib/impacto-tarefas.js')
const { db, hojeLocal } = await import('../src/lib/db.js')
const { secao } = await import('../src/lib/sistemas.js')
const C = process.argv[2]; if (!C) throw new Error('informe o cliente')
const hoje = hojeLocal(), L = algoritmo.limiares, d = diagnosticarConta(C), r = d.resumo
const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR'), dm = iso => String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7)
const mais = (iso, n) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const nome = t => { const w = String(t || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 7); while (w.length > 2 && /^(de|da|do|das|dos|para|com|e|-|–|\+|\|)$/i.test(w.at(-1))) w.pop(); return w.join(' ') }
const link = u => u ? ` <${u}>` : ''
// central do Notion (só leitura): webhook ML + id do consultor ML
const tok = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^NOTION_TOKEN=(.*)$/m)?.[1]?.trim()
const fontes = JSON.parse(readFileSync(new URL('../config/fontes.json', import.meta.url), 'utf8'))
const rq = await fetch(`https://api.notion.com/v1/databases/${fontes.clientes_db}/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: { property: 'Cliente', title: { equals: C } }, page_size: 2 }) }).then(x => x.json())
const pr = (rq.results || []).length === 1 ? rq.results[0].properties : {}
const tx = p => p?.type === 'rich_text' ? (p.rich_text || []).map(t => t.plain_text).join('').trim() : p?.type === 'url' ? String(p.url || '').trim() : ''
const webhook = tx(pr['Webhook ML']), idCons = tx(pr['Discord ID Consultor ML'])
const webhookOk = /^https:\/\/(discord(app)?\.com)\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{30,120}$/.test(webhook)
const consNome = (() => { try { return JSON.parse(db.prepare('SELECT consultores_json FROM clientes_central WHERE cliente = ?').get(C)?.consultores_json || '{}').ML || '' } catch { return '' } })() || tx(pr['Consultor ML'])
// regra do David: toda mensagem ao time marca os 3 cargos (config/discord-time.json) + o consultor do cliente quando a central tiver o id
const TIME = JSON.parse(readFileSync(new URL('../config/discord-time.json', import.meta.url), 'utf8'))
const cargos = TIME.mencoes_obrigatorias.filter(m => /^\d{15,21}$/.test(m.id)).map(m => `<@&${m.id}>`).join(' ')
const mencao = cargos + (/^\d{15,21}$/.test(idCons) ? ` <@${idCons}>` : '') + `\nConsultor ML: ${/^\d{15,21}$/.test(idCons) ? 'marcado acima' : consNome ? `**${consNome}** (sem Discord ID na central)` : '(sem consultor na central)'}`
// medidas do Merovíngio
const A = analisarCliente(C), med = A.medidas || []
const somaDesde = db.prepare("SELECT COALESCE(SUM(unidades),0) u, COALESCE(SUM(receita),0) r FROM meli_serie_item WHERE cliente=? AND item_id=? AND dia>=?")
const somaJan = db.prepare("SELECT COALESCE(SUM(unidades),0) u FROM meli_serie_item WHERE cliente=? AND item_id=? AND dia BETWEEN ? AND ?")
const cob = db.prepare("SELECT COUNT(*) n FROM meli_coleta_dia WHERE cliente=? AND dia BETWEEN ? AND ?")
const itemDe = db.prepare('SELECT titulo, permalink, criado_em FROM meli_item WHERE cliente=? AND item_id=?')
// ✅ resultado: entregas que viraram venda (mesmos critérios do relatório ao cliente) + medidas 'melhorou' com a confiança honesta
const vistos = new Set(), boas = []
for (const m of med.filter(m => ['melhorou', 'lancamento'].includes(m.estado) && !m.confundido_preco && !m.confundido_estado)) for (const it of m.itens || []) {
  if (vistos.has(it)) continue; vistos.add(it); const i = itemDe.get(C, it); if (!i) continue
  const des = somaDesde.get(C, it, m.data), pre = somaJan.get(C, it, mais(m.data, -28), mais(m.data, -1)).u, pos = somaJan.get(C, it, mais(m.data, 1), mais(m.data, 28)).u, cb = cob.get(C, mais(m.data, -28), mais(m.data, -1)).n
  const criado = i.criado_em && i.criado_em.slice(0, 10) >= mais(m.data, -3), semAntes = !criado && pre === 0 && cb >= 14, tripl = !criado && !semAntes && cb >= 14 && pos >= 5 && pos >= 3 * Math.max(pre, 1)
  if (/kit/i.test(m.tipo + m.titulo) && !criado) continue
  if (des.r < 300 || !(criado || semAntes || tripl)) continue
  boas.push(`• **${m.titulo.trim()}** (${m.tipo}, ${m.analista || 's/ analista'}, ${dm(m.data)}) → ${nome(i.titulo)}: ${criado ? 'anúncio novo' : semAntes ? 'não vendia antes' : `${pre} → ${pos} un em 28 dias`}; desde então **${des.u} un · ${brl(des.r)}**${link(i.permalink)}`)
}
for (const m of med.filter(m => m.estado === 'melhorou' && !m.confundido_preco && !m.confundido_estado)) if (!boas.some(b => b.includes(m.titulo.trim())))
  boas.push(`• **${m.titulo.trim()}** (${m.tipo}, ${m.analista || 's/ analista'}, ${dm(m.data)}): subiu ${Math.round(m.efeito_pct)}% contra o grupo de comparação — evidência: ${m.confianca?.classe || 'n/d'} (${m.confianca?.score ?? '—'}/100)${link(itemDe.get(C, (m.itens || [])[0] || '')?.permalink)}`)
// 🔁 sem resultado medido (≤ 60 dias) + famílias sem nenhuma melhora
const desde = mais(hoje, -60), ruins = med.filter(m => ['piorou', 'sem_efeito'].includes(m.estado) && m.data >= desde).sort((a, b) => String(b.data).localeCompare(a.data))
const linkDe = m => link(itemDe.get(C, (m.itens || [])[0] || '')?.permalink)
const semRes = ruins.slice(0, 6).map(m => `• ${m.titulo.trim()} (${m.tipo}, ${m.analista || 's/ analista'}, ${dm(m.data)}): ${m.estado === 'piorou' ? `**caiu ${Math.abs(Math.round(m.efeito_pct))}%** contra o grupo de comparação` : `variação de ${m.efeito_pct > 0 ? '+' : ''}${Math.round(m.efeito_pct ?? 0)}% dentro do ruído (pouco volume ou sinal fraco)`}${linkDe(m)}`)
const fam = {}; for (const m of med.filter(m => ['melhorou', 'piorou', 'sem_efeito'].includes(m.estado))) { const f = (fam[m.tipo] ||= { n: 0, ok: 0 }); f.n++; if (m.estado === 'melhorou') f.ok++ }
const famRuins = Object.entries(fam).filter(([, f]) => f.n >= 4 && f.ok === 0).map(([t, f]) => `• **${t}**: ${f.n} tarefas medidas, nenhuma com melhora mensurável`)
// 🔔 pontos da assessoria
const acoes = db.prepare("SELECT regra, item_id, titulo, dados_json FROM acoes_plano WHERE cliente=? AND status IN ('proposta','aprovada','distribuida') AND regra IN ('anuncio_ads_reduzir','anuncio_ads_abaixo_meta')").all(C)
const ads = acoes.map(a => { const i = d.itens.find(x => x.id === a.item_id); return { t: i?.titulo || a.titulo, custo: i?.ads?.custo || 0, link: i?.permalink } }).sort((a, b) => b.custo - a.custo)
const promoFim = db.prepare("SELECT COUNT(DISTINCT item_id) n, MIN(substr(fim,1,10)) f FROM promo_oferta WHERE cliente=? AND status='started' AND substr(fim,1,10) BETWEEN ? AND ?").get(C, hoje, mais(hoje, 7))
const fimPromo = db.prepare(`SELECT COUNT(DISTINCT m.item_id) n FROM meli_item_mudanca m JOIN promo_oferta o ON o.cliente=m.cliente AND o.item_id=m.item_id AND o.status='started' AND substr(o.fim,1,10) BETWEEN date(m.dia,'-14 day') AND m.dia AND o.preco_original > 0 AND ABS(CAST(m.para AS REAL) - o.preco_original) <= o.preco_original * 0.01 WHERE m.cliente=? AND m.campo='preco' AND m.dia >= ? AND m.variacao_pct >= 15`).get(C, mais(hoje, -14))
const assess = [], smith = []
const varp = r.gmv_anterior ? Math.round(100 * (r.gmv - r.gmv_anterior) / r.gmv_anterior) : null
if (varp != null && varp <= -10) assess.push(`• **Faturamento ${varp}%** nos últimos 28 dias contra os 28 anteriores (${brl(r.gmv)} × ${brl(r.gmv_anterior)}). Vale olhar o elo (visitas × conversão × ticket) na tela do cliente.`)
if (fimPromo?.n) smith.push(`• **Fim de promoção:** ${fimPromo.n} anúncio(s) voltaram ao preço cheio nos últimos 14 dias (alta de 15% ou mais). Avaliar renovar a campanha; **não é mudança do cliente** e não foi avisado a ele.`)
if (promoFim?.n) smith.push(`• **Promoções terminando:** ${promoFim.n} anúncio(s) com promoção acabando até ${dm(mais(hoje, 7))} (a primeira em ${dm(promoFim.f)}).`)
if (ads.length) smith.push(`• **Ads sem retorno:** ${ads.length} anúncio(s) com ação de reduzir/ajustar verba no plano. Maiores gastos: ` + ads.slice(0, 3).map(a => `${nome(a.t)}${a.custo ? ` (${brl(a.custo)} em 28 dias)` : ''}`).join('; ') + '.')
if (!d.custos_informados) smith.push('• **Custos não informados:** sem eles não há margem, ROAS alvo nem desconto máximo. Vale pedir a planilha ao cliente.')
// 📦 o que o cliente precisa fazer (resumo do plano)
const ab = d.itens.filter(i => i.curva !== 'C' && i.status === 'active' && i.ponto_reposicao != null && (i.vel_dia || 0) > 0 && i.cobertura != null)
const urg = ab.filter(i => i.cobertura <= L.cobertura_critica_dias).sort((a, b) => a.cobertura - b.cobertura)
const vendeu = new Set(d.itens.filter(i => (i.u || 0) > 0).map(i => i.id))
const parado = db.prepare("SELECT f.item_id, f.disponivel, f.dias_sem_venda d FROM meli_full_estoque f WHERE f.cliente=? AND f.dia=(SELECT MAX(dia) FROM meli_full_estoque WHERE cliente=?) AND f.disponivel>0 AND f.dias_sem_venda>=?").all(C, C, L.full_estoque_antigo_dias || 60).filter(x => !vendeu.has(x.item_id))
const cli = [], prev = []
if (urg.length) prev.push(`• **Repor/abastecer o Full** de ${urg.length} campeão(ões) (~${brl(urg.reduce((s, i) => s + (i.r || 0) / 4, 0))}/semana): ` + urg.slice(0, 4).map(i => { const s = sugestaoFull(i)?.cenarios; return `${nome(i.titulo)} (${i.estoque} un, ${i.cobertura < 1 ? '<1 dia' : `~${i.cobertura} dias`}${s ? `, sugerido ${s.conservador === s.base ? s.base : s.conservador + '–' + s.base} un` : ''})` }).join('; ') + '.')
if (parado.length) cli.push(`• **Estoque parado no Full:** ${parado.reduce((s, x) => s + x.disponivel, 0)} un em ${parado.length} anúncio(s) há ${Math.min(...parado.map(x => x.d))}+ dias sem venda.`)
const sec = []
sec.push(`**📊 Morpheus · resumo da semana · ${C} · Mercado Livre · ${dm(hoje)}**\n${mencao}\nÚltimos 28 dias: **${brl(r.gmv)}** · ${r.pedidos} pedidos${varp != null ? ` · ${varp >= 0 ? '+' : ''}${varp}% vs 28 dias anteriores` : ''}.`)
sec.push(`**✅ ${secao('merovingio', 'o que rendeu')}**\n` + (boas.length ? boas.slice(0, 4).join('\n') : '• Nenhuma entrega com resultado mensurável no período (pode ser falta de volume ou de tempo de medição).'))
sec.push(`**🔁 ${secao('merovingio', 'sem resultado medido, vale revisar antes de repetir')}**\n` + (semRes.length || famRuins.length ? [...semRes, ...famRuins].join('\n') : '• Nada a revisar nos últimos 60 dias.') + `\n_Sem resultado mensurável não quer dizer inútil: pode faltar volume, tempo ou ter outra mudança no meio._`)
if (assess.length) sec.push(`**🔔 ${secao('morpheus', 'pontos da assessoria (não vão ao cliente)')}**\n` + assess.join('\n'))
if (smith.length) sec.push(`**💰 ${secao('smith', 'custos e preço (não vão ao cliente)')}**\n` + smith.join('\n'))
if (prev.length) sec.push(`**🔮 ${secao('oraculo', 'previsão de estoque (o cliente precisa repor; para o consultor puxar)')}**\n` + prev.join('\n'))
if (cli.length) sec.push(`**📦 ${secao('arquiteto', 'plano da semana: o que o cliente precisa fazer (para o consultor puxar)')}**\n` + cli.join('\n'))
sec.push(`_Morpheus · Place Sprints — dados do Mercado Livre e do Notion de ${dm(hoje)}. Estimativas pelo ritmo dos últimos 28 dias; associação não prova causa._`)
// partes ≤ 1900 caracteres: junta seções inteiras; só quebra dentro de uma seção se ela sozinha passar do limite
const partes = []; let atual = ''
const empurra = t => { if (!atual) atual = t; else if ((atual + '\n\n' + t).length <= 1900) atual += '\n\n' + t; else { partes.push(atual); atual = t } }
for (const s0 of sec) {
  if (s0.length <= 1900) { empurra(s0); continue }
  for (const linha of s0.split('\n')) { if (atual && (atual + '\n' + linha).length > 1900) { partes.push(atual); atual = linha } else atual = atual ? atual + '\n' + linha : linha }
}
if (atual) partes.push(atual)
process.stdout.write(JSON.stringify({ partes, webhook_ok: webhookOk, webhook: webhookOk ? webhook : '', mencao: /<@\d/.test(mencao) }))
