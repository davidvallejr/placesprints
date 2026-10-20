// Matriz Eisenhower por analista — uso INTERNO da liderança, nunca vai para
// o cliente. Mesmo sistema visual editorial dos relatórios de cliente.
import { FONTES, CSS, esc, brData, capa, secTitulo, rodape } from './estilo-editorial.js'

const ROTULO_Q = { fazer: 'Fazer', agendar: 'Agendar', delegar: 'Delegar', eliminar: 'Eliminar' }
const SUB_Q = {
  fazer: 'Urgente + importante — hoje, sem interromper',
  agendar: 'Importante, sem pressão de tempo — bloco de foco',
  delegar: 'Recorrente e de baixo julgamento — repassar quando houver apoio',
  eliminar: 'Parada há muito tempo, sem sinal de bloqueio — avaliar cancelar',
}
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'min' : ''}` : `${m}min`

function cardTarefa(t) {
  return `<div class="mt-item">
    <div class="mt-item-top"><b>${esc(t.titulo)}</b>${t.url ? `<a href="${esc(t.url)}" target="_blank">↗</a>` : ''}</div>
    <div class="mt-item-meta">${esc(t.cliente)} · ${esc(t.processo)}${t.prazo ? ` · prazo ${esc(brData(t.prazo))}` : ''} · ${t._classificacao.minutos}min</div>
    <div class="mt-item-motivo">${esc(t._classificacao.motivo)}</div>
  </div>`
}

function quadranteHtml(chave, r) {
  const itens = r.quadrantes[chave]
  const resumo = r.resumo[chave]
  return `<div class="mt-quad mt-${chave}">
    <div class="mt-quad-cab">
      <h3>${ROTULO_Q[chave]}</h3>
      <span class="mt-quad-n">${resumo.n} · ${fmtMin(resumo.minutos)}</span>
    </div>
    <div class="mt-quad-sub">${SUB_Q[chave]}</div>
    <div class="mt-quad-lista">${itens.length ? itens.slice(0, 12).map(cardTarefa).join('')
      : '<p class="vazio">Nada aqui agora.</p>'}
    ${itens.length > 12 ? `<div class="tab-mais">+ ${itens.length - 12} outra(s) nesse quadrante.</div>` : ''}</div>
  </div>`
}

export function renderMatrizAnalista(r) {
  const d = r.diagnostico
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matriz Eisenhower — ${esc(r.responsavel)}</title>
${FONTES}
<style>${CSS}
  .mt-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:10px}
  @media(max-width:720px){.mt-grid{grid-template-columns:1fr}}
  .mt-quad{border:1px solid rgba(42,37,32,.14);border-top:3px solid var(--accent);background:#fffdfa;
    padding:16px 18px;page-break-inside:avoid}
  .mt-fazer{border-top-color:var(--blood)}
  .mt-agendar{border-top-color:var(--accent)}
  .mt-delegar{border-top-color:var(--gold)}
  .mt-eliminar{border-top-color:var(--cinza)}
  .mt-quad-cab{display:flex;justify-content:space-between;align-items:baseline}
  .mt-quad-cab h3{font-size:17px}
  .mt-quad-n{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--rule)}
  .mt-quad-sub{font-size:11px;color:var(--rule);margin:2px 0 12px}
  .mt-item{border-bottom:1px solid rgba(42,37,32,.12);padding:8px 0;font-size:12.5px}
  .mt-item:last-child{border-bottom:none}
  .mt-item-top{display:flex;justify-content:space-between;gap:8px}
  .mt-item-meta{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--rule);margin-top:2px}
  .mt-item-motivo{font-size:11px;color:var(--sage);margin-top:3px;font-style:italic}
</style>
</head>
<body>
<div class="pagina">

${capa({
    documento: 'Matriz Eisenhower · Uso interno',
    titulo: r.responsavel,
    subtitulo: `${r.total_aberto} tarefa(s) em aberto · ${d.clientes_distintos} cliente(s)`,
    meta: [`Gerado em <b>${esc(brData(r.gerado_em))}</b>`, `Total geral <b>${r.total_geral}</b> tarefa(s)`, `Concluídas <b>${r.total_concluido}</b>`],
  })}

<div class="verdict">
  <span class="eyebrow">Leitura executiva</span>
  <p>${esc(r.resumo_executivo || textoResumoPadrao(r))}</p>
</div>

<section>
  ${secTitulo('01', 'Os 4 quadrantes', 'Cada tarefa aberta, classificada por urgência × importância — cálculo determinístico, sem IA.')}
  <div class="mt-grid">
    ${quadranteHtml('fazer', r)}${quadranteHtml('agendar', r)}
    ${quadranteHtml('delegar', r)}${quadranteHtml('eliminar', r)}
  </div>
</section>

<section>
  ${secTitulo('02', 'Diagnóstico — por que o backlog não anda', 'Fatos calculados a partir do Notion, não opinião.')}
  <table>
    <thead><tr><th>Sinal</th><th>Leitura</th></tr></thead>
    <tbody>
      <tr><td>Concentração de clientes</td><td>${d.pct_backlog_top3_clientes}% do backlog aberto está em só ${Math.min(3, d.concentracao_clientes.length)} cliente(s): ${d.concentracao_clientes.slice(0, 3).map(c => `${esc(c.cliente)} (${c.n})`).join(', ')}</td></tr>
      <tr><td>Idade média do backlog</td><td>${d.idade_media_dias != null ? `${d.idade_media_dias} dia(s) parado em média` : 'sem dados suficientes'}${d.tarefas_paradas_45d_mais ? ` · ${d.tarefas_paradas_45d_mais} tarefa(s) parada(s) há 45+ dias` : ''}</td></tr>
      <tr><td>Higiene de dados (Prazo)</td><td>${d.pct_sem_prazo}% das tarefas abertas (${d.sem_prazo} de ${r.total_aberto}) estão SEM prazo no Notion — nenhum painel consegue marcar isso como atrasado</td></tr>
      <tr><td>Tarefas bloqueadas</td><td>${d.bloqueadas ? `${d.bloqueadas} tarefa(s) bloqueada(s) — ver quadrante Fazer` : 'nenhuma no momento'}</td></tr>
      <tr><td>Tipos que mais dominam o backlog</td><td>${d.tipos_dominantes_backlog.slice(0, 5).map(t => `${esc(t.tipo)} (${t.n})`).join(' · ') || '—'}</td></tr>
    </tbody>
  </table>
</section>

${rodape(`Matriz Eisenhower · uso interno da liderança${r.aguardando_cliente ? ` · Aguardando o cliente: ${r.aguardando_cliente} (fora da matriz — a cobrança é do consultor)` : ''}`)}
</div>
</body></html>`
}

function textoResumoPadrao(r) {
  const d = r.diagnostico
  const partes = [`${r.responsavel} tem ${r.total_aberto} tarefa(s) em aberto entre ${d.clientes_distintos} cliente(s), sendo ${r.resumo.fazer.n} urgente(s)/importante(s) para fazer agora e ${r.resumo.agendar.n} para agendar em bloco de foco.`]
  if (d.pct_sem_prazo >= 50) partes.push(`${d.pct_sem_prazo}% das tarefas abertas não têm prazo no Notion — isso é a maior causa provável de o backlog crescer sem ninguém perceber.`)
  if (d.pct_backlog_top3_clientes >= 40) partes.push(`${d.pct_backlog_top3_clientes}% do backlog está concentrado em só 3 clientes — vale checar se a carga entre contas está desbalanceada.`)
  if (r.resumo.delegar.n) partes.push(`${r.resumo.delegar.n} tarefa(s) recorrente(s) e de baixa complexidade já são candidatas a delegação assim que houver apoio disponível.`)
  if (d.tarefas_paradas_45d_mais) partes.push(`${d.tarefas_paradas_45d_mais} tarefa(s) estão paradas há 45+ dias sem bloqueio ativo — candidatas a cancelar ou repriorizar com o cliente.`)
  return partes.join(' ')
}
