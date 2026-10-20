// Relatório de Sprint — layout editorial premium Place2u.
// Mesmo template para link, embed e PDF; inline=true embute evidências (standalone).
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT } from './env.js'
import { ehFrio, resolverArquivo } from './frio.js'
import { FONTES, CSS, esc, brData, capa, barraPlano, secTitulo, rodape } from './estilo-editorial.js'
import { linhasDePendencia, ordemPendencias } from './pendencias-texto.js'   // texto único das pendências do cliente (o mesmo do relatório curto, do PDF semanal e do plano)

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

function srcEvidencia(ev, inline) {
  // anexo no armazenamento frio (autogestão A4): embutido se a pasta do Drive estiver acessível; senão a caixa 📎, nunca <img> quebrada
  if (ehFrio(ev.arquivo_local)) { const p = resolverArquivo(ev.arquivo_local), mime = MIME[extname(ev.arquivo_local).toLowerCase()]; return p && mime ? `data:${mime};base64,${readFileSync(p).toString('base64')}` : null }
  if (ev.arquivo_local) {
    let arquivo = ev.arquivo_local
    let mime = MIME[extname(arquivo).toLowerCase()]
    if (!mime && existsSync(join(ROOT, 'data', arquivo + '.png'))) {
      arquivo += '.png'; mime = 'image/png'   // miniatura da 1ª página do PDF
    }
    if (!mime) return null   // arquivo sem prévia → caixa 📎, nunca <img> quebrada
    if (inline) {
      const caminho = join(ROOT, 'data', arquivo)
      return existsSync(caminho) ? `data:${mime};base64,${readFileSync(caminho).toString('base64')}` : null
    }
    return `/${arquivo}`
  }
  return ev.tipo === 'image' ? ev.url_origem : null
}

const stat = (rotulo, valor, extra = '', tom = '') =>
  `<div class="stat"><div class="num ${tom}">${esc(valor)}</div><div class="lbl">${esc(rotulo)}</div>${extra ? `<div class="sub">${esc(extra)}</div>` : ''}</div>`

const setaComp = (atual, anterior, invertido = false) => {
  if (anterior === undefined || anterior === null) return ''
  const d = atual - anterior
  if (d === 0) return '<span class="comp igual">= estável</span>'
  const melhor = invertido ? d < 0 : d > 0
  return `<span class="comp ${melhor ? 'bom' : 'ruim'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} vs sprint anterior</span>`
}

// "O que depende do cliente": uma caixa por pendência (rótulo, canal, desde quando) com a explicação. Só aparece com pendência.
export const htmlPendenciasCliente = pendencias => (Array.isArray(pendencias) ? pendencias : []).filter(p => p && typeof p === 'object' && p.rotulo).sort(ordemPendencias).map(p => {
  const L = linhasDePendencia(p)
  return `<div class="entrega">
    <h3>${esc(L.titulo)}</h3>
    <div class="lm"><span class="tag t-proc">${esc(L.canal || '—')}</span>${L.quando ? `<span>${esc(L.quando)}</span>` : ''}</div>
    ${L.linhas.map(l => `<p><span class="rotulo">${esc(l.rotulo)}</span> &nbsp;${esc(l.texto)}</p>`).join('')}
  </div>`
}).join('')

export function renderRelatorio(r, opcoes = {}) {
  const inline = !!opcoes.inline
  const g = r.graficos
  const pc = htmlPendenciasCliente(r.pendencias_cliente), nProx = pc ? '08' : '07', nQual = pc ? '09' : '08'   // a seção nova só entra com pendência; sem ela a numeração é a de sempre
  const temBurnup = g.burnup.dias.length > 1

  const thumb = ev => {
    const src = srcEvidencia(ev, inline)
    return `<div class="thumb">${src
      ? `<img src="${esc(src)}" alt="${esc(ev.legenda || 'evidência')}" loading="lazy">`
      : `<div class="thumb-arquivo">📎 ${esc(ev.tipo)}</div>`}
      ${ev.legenda ? `<div class="leg">${esc(ev.legenda)}</div>` : ''}</div>`
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório — ${esc(r.identificacao.cliente)} · ${esc(r.identificacao.sprint)}</title>
${FONTES}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0"></script>
<style>${CSS}
  canvas{max-height:290px}
  .grade-2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  @media(max-width:720px){.grade-2{grid-template-columns:1fr}}
  .grafico-caixa .explica{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--rule);margin-top:8px;letter-spacing:.03em}
</style>
</head>
<body>
<div class="pagina">

${capa({
    documento: 'Relatório de Evolução',
    titulo: r.identificacao.sprint,
    tituloEm: '',
    subtitulo: `${r.identificacao.cliente} · ${r.identificacao.projeto}`,
    meta: [
      `Período <b>${esc(r.identificacao.periodo)}</b>`,
      ...(r.identificacao.consultor ? [`Consultor <b>${esc(r.identificacao.consultor)}</b>`] : []),
      `Gerado em <b>${esc(r.identificacao.gerado_em)}</b>`,
      `Notion sincronizado <b>${esc(r.identificacao.ultima_atualizacao)}</b>`,
    ],
  })}

<div class="verdict">
  <span class="eyebrow">Resumo executivo</span>
  <p>${esc(r.resumo.texto)}</p>
</div>

${barraPlano(r.plano)}

<section>
  ${secTitulo('01', 'Indicadores do sprint', 'Medimos esforço e evidência, não só contagem de cards.')}
  <div class="stats">
    ${stat('Planejadas', r.kpis.planejadas)}
    ${stat('Concluídas', r.kpis.concluidas, '', 'bom')}
    ${stat('Conclusão', r.kpis.pct_conclusao + '%', '', r.kpis.pct_conclusao >= 70 ? 'bom' : r.kpis.pct_conclusao >= 40 ? 'alerta' : 'risco')}
    ${stat('Em andamento', r.kpis.andamento)}
    ${stat('Bloqueadas', r.kpis.bloqueadas, '', r.kpis.bloqueadas ? 'risco' : '')}
    ${stat('Atrasadas', r.kpis.atrasadas, '', r.kpis.atrasadas ? 'alerta' : '')}
    ${stat('Depende do cliente', r.kpis.dependencia_cliente, r.kpis.dependencia_14d_exata ? `${r.kpis.dependencia_14d_exata} há 14+ dias` : '')}
    ${stat('Esforço', `${r.kpis.esforco_concluido}/${r.kpis.esforco_planejado}`, `${r.kpis.pct_esforco}% do planejado`)}
    ${stat('Evidências', r.kpis.cobertura_evidencias + '%', `${r.kpis.com_evidencia} de ${r.kpis.concluidas} entregas`, r.kpis.cobertura_evidencias >= 70 ? 'bom' : 'alerta')}
  </div>
  ${r.comparacao ? `<p style="margin-top:14px;font-size:12.5px"><span class="rotulo">Comparação com ${esc(r.comparacao.sprint)}</span> &nbsp;
    conclusão ${setaComp(r.kpis.pct_conclusao, r.comparacao.kpis.pct_conclusao)} ·
    esforço ${setaComp(r.kpis.esforco_concluido, r.comparacao.kpis.esforco_concluido)} ·
    atrasos ${setaComp(r.kpis.atrasadas, r.comparacao.kpis.atrasadas, true)} ·
    bloqueios ${setaComp(r.kpis.bloqueadas, r.comparacao.kpis.bloqueadas, true)} ·
    evidências ${setaComp(r.kpis.com_evidencia, r.comparacao.kpis.com_evidencia)}</p>` : ''}
</section>

<section>
  ${secTitulo('02', 'Visão gráfica', 'Três leituras: ritmo, situação e onde o trabalho avançou.')}
  <div class="grade-2">
    ${temBurnup ? `<div class="grafico-caixa"><canvas id="gBurnup"></canvas>
      <div class="explica">EVOLUÇÃO ACUMULADA — quando a linha verde acompanha a pontilhada, o sprint está no ritmo.</div></div>` : ''}
    <div class="grafico-caixa"><canvas id="gStatus"></canvas>
      <div class="explica">DISTRIBUIÇÃO POR SITUAÇÃO ATUAL.</div></div>
    <div class="grafico-caixa"><canvas id="gProc"></canvas>
      <div class="explica">% CONCLUÍDO POR PROCESSO — onde o sprint avançou de fato.</div></div>
  </div>
</section>

<section>
  ${secTitulo('03', 'Evolução dos processos', 'Problema → ação → evidência → resultado → impacto → próximo passo. Concluir uma tarefa não é evoluir o processo.')}
  ${r.processos.length ? r.processos.map(p => `
  <div class="processo-linha">
    <h3>${esc(p.processo)} <span class="pct">${p.pct}% (${p.concluidas}/${p.total})</span></h3>
    <dl>
      ${p.situacao_anterior ? `<dt>Situação anterior</dt><dd>${esc(p.situacao_anterior)}</dd>` : ''}
      ${p.acoes.length ? `<dt>Ações executadas</dt><dd>${esc(p.acoes.join(' · '))}</dd>` : ''}
      ${p.situacao_atual ? `<dt>Situação atual</dt><dd>${esc(p.situacao_atual)}</dd>` : ''}
      <dt>Evidências</dt><dd>${p.evidencias ? `${p.evidencias} anexada(s)` : 'nenhuma anexada'}</dd>
      ${p.impactos.length ? `<dt>Impacto</dt><dd>${esc(p.impactos.join(' · '))}</dd>` : ''}
      ${p.proximos.length ? `<dt>Próximo passo</dt><dd>${esc(p.proximos.join(' · '))}</dd>` : ''}
    </dl>
  </div>`).join('') : '<p class="vazio">Sem processos no filtro atual.</p>'}
</section>

<section>
  ${secTitulo('04', 'Entregas realizadas', 'Cada entrega com resultado, impacto e prova.')}
  ${r.entregas.length ? r.entregas.map(e => `
  <div class="entrega">
    <h3>${esc(e.titulo)}</h3>
    <div class="lm">
      <span class="tag t-proc">${esc(e.processo)}</span>
      ${e.responsavel ? `<span>${esc(e.responsavel)}</span>` : ''}
      ${e.data ? `<span>${esc(brData(e.data))}</span>` : ''}
      ${e.url ? `<a href="${esc(e.url)}" target="_blank">card no Notion ↗</a>` : ''}
    </div>
    ${e.descricao ? `<p>${esc(e.descricao)}</p>` : ''}
    ${e.resultado ? `<p><span class="rotulo">Resultado</span> &nbsp;${esc(e.resultado)}</p>` : ''}
    ${e.impacto ? `<p><span class="rotulo">Impacto</span> &nbsp;${esc(e.impacto)}</p>` : ''}
    ${e.sem_resultado_informado ? `<p class="vazio">Resultado/impacto não informados no card — registrada como atividade executada.</p>` : ''}
    ${e.evidencias.length ? `<div class="thumbs">${e.evidencias.map(thumb).join('')}</div>` : ''}
  </div>`).join('') : '<p class="vazio">Nenhuma entrega concluída no filtro atual.</p>'}
</section>

<section>
  ${secTitulo('05', 'Galeria de evidências', 'Todos os prints organizados por tarefa — evidência nunca se mistura.')}
  ${r.galeria.length ? `<div class="galeria">${r.galeria.flatMap(gp => gp.itens.map(ev => {
    const src = srcEvidencia(ev, inline)
    return `<div class="gal-item">
      ${src ? `<img src="${esc(src)}" alt="${esc(ev.legenda || gp.tarefa)}" loading="lazy">` : `<div style="height:130px;display:flex;align-items:center;justify-content:center;color:var(--cinza);font-size:11px">📎 ${esc(ev.tipo)}</div>`}
      <div class="info"><b>${esc(gp.tarefa)}</b>
        ${ev.legenda ? `<div class="leg">${esc(ev.legenda)}</div>` : ''}
        <div class="leg">${esc(gp.processo)}${ev.criada_em ? ` · ${esc(brData(ev.criada_em))}` : ''}</div>
        ${gp.url ? `<a href="${esc(gp.url)}" target="_blank" style="font-size:10px">card no Notion ↗</a>` : ''}
      </div>
    </div>`
  })).join('')}</div>` : '<p class="vazio">Nenhuma evidência anexada às entregas deste filtro.</p>'}
</section>

<section>
  ${secTitulo('06', 'Pendências e bloqueios', 'O que pede decisão — com motivo, dono e rota de recuperação. Dependências do cliente não contam como atraso da equipe.')}
  ${r.pendencias.length ? `<table>
    <thead><tr><th>Tarefa</th><th>Situação</th><th>Motivo</th><th>Responsável</th><th>Impacto</th><th>Ação de recuperação</th><th>Prazo</th></tr></thead>
    <tbody>${r.pendencias.map(p => `<tr>
      <td>${p.url ? `<a href="${esc(p.url)}" target="_blank">${esc(p.titulo)}</a>` : esc(p.titulo)}</td>
      <td><span class="tag t-${esc(p.classe)}">${esc(p.status)}</span></td>
      <td>${esc(p.motivo)}</td><td>${esc(p.responsavel)}</td><td>${esc(p.impacto)}</td>
      <td>${esc(p.recuperacao)}</td><td>${esc(brData(p.prazo))}</td></tr>`).join('')}</tbody>
  </table>` : '<p class="vazio">Sem pendências ou bloqueios. ✓</p>'}
</section>

${pc ? `<section>
  ${secTitulo('07', 'O que depende do cliente', 'O que a equipe precisa receber para seguir, por que importa e o que está em jogo — só o que foi medido ou previsto. Situação de hoje, não do sprint.')}
  ${pc}
</section>` : ''}

<section>
  ${secTitulo(nProx, 'Próximo sprint', 'O plano do próximo ciclo — prioridades, riscos e decisões do cliente.')}
  ${r.proximo ? `
    <p style="margin-bottom:10px"><b>${esc(r.proximo.sprint)}</b> — ${r.proximo.tarefas.length} tarefa(s) planejada(s).</p>
    ${r.proximo.prioridades.length ? `<p><span class="rotulo">Prioridades</span> &nbsp;${esc(r.proximo.prioridades.join(' · '))}</p>` : ''}
    ${r.proximo.riscos.length ? `<p><span class="rotulo">Riscos antecipados</span> &nbsp;${esc(r.proximo.riscos.join(' · '))}</p>` : ''}
    ${r.proximo.decisoes_cliente.length ? `<p><span class="rotulo">Decisões necessárias do cliente</span> &nbsp;${esc(r.proximo.decisoes_cliente.join(' · '))}</p>` : ''}
    <table style="margin-top:12px"><thead><tr><th>Tarefa</th><th>Processo</th><th>Responsável</th><th>Prazo</th></tr></thead>
    <tbody>${r.proximo.tarefas.slice(0, 15).map(t => `<tr><td>${esc(t.titulo)}</td><td>${esc(t.processo)}</td><td>${esc(t.responsavel || '—')}</td><td>${esc(brData(t.prazo || '—'))}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="vazio">Próximo sprint ainda não planejado no Notion.</p>'}
</section>

${r.avisos.length ? `<section>
  ${secTitulo(nQual, 'Qualidade dos dados', 'O que o Notion ainda não conta — para o relatório ficar inteiro.')}
  ${r.avisos.map(a => `<div class="aviso">△ ${esc(a)}</div>`).join('')}
</section>` : ''}

${rodape(r.identificacao.sprint)}
</div>

<script>
const D = ${JSON.stringify({ status: g.status, processos: g.processos.slice(0, 10), burnup: g.burnup })};
const C = { ink:'#1a1612', accent:'#ff6b1a', accentDeep:'#d4550e', sage:'#5f7355', gold:'#b8924a', blood:'#c0392b', cinza:'#8a8378', papel:'#efe7da' }
const corStatus = { nao_iniciada:C.cinza, andamento:C.accent, validacao:C.gold, concluida:C.sage, bloqueada:C.blood, dependencia_cliente:C.gold, cancelada:C.papel }
if (window.Chart) {
  Chart.register(ChartDataLabels)
  Chart.defaults.animation = false   // pintura síncrona: o PDF nunca captura gráfico pela metade
  Chart.defaults.font.family = "'Inter',sans-serif"
  Chart.defaults.color = C.ink
  Chart.defaults.plugins.datalabels.display = false
  const elB = document.getElementById('gBurnup')
  if (elB && D.burnup.dias.length > 1) new Chart(elB, {
    type: 'line',
    data: { labels: D.burnup.dias.map(d => d.slice(8, 10) + '/' + d.slice(5, 7)), datasets: [
      { label: 'Concluído', data: D.burnup.concluido, borderColor: C.sage, backgroundColor: C.sage, tension: .2 },
      { label: 'Planejado', data: D.burnup.planejado, borderColor: C.ink, backgroundColor: C.ink, tension: .2 },
      { label: 'Ritmo ideal', data: D.burnup.ideal, borderColor: C.cinza, borderDash: [6, 4], pointRadius: 0 },
    ]},
    options: { plugins: { title: { display: true, text: 'Evolução acumulada do sprint' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  })
  new Chart(document.getElementById('gStatus'), {
    type: 'doughnut',
    data: { labels: D.status.map(s => s.rotulo), datasets: [{ data: D.status.map(s => s.n), backgroundColor: D.status.map(s => corStatus[s.status]), borderColor: '#f7f2ea', borderWidth: 2 }] },
    options: { plugins: { title: { display: true, text: 'Distribuição por status' },
      datalabels: { display: true, color: '#fff', font: { weight: 700 } } } }
  })
  new Chart(document.getElementById('gProc'), {
    type: 'bar',
    data: { labels: D.processos.map(p => p.processo), datasets: [{ label: '% concluído', data: D.processos.map(p => p.pct), backgroundColor: C.accent, borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { title: { display: true, text: 'Conclusão por processo (%)' }, legend: { display: false },
      datalabels: { display: true, anchor: 'end', align: 'start', color: '#fff', font: { weight: 700 }, formatter: v => v + '%' } },
      scales: { x: { max: 100 } } }
  })
}
</script>
</body></html>`
}
