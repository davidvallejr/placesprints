// Sistema visual editorial Place2u — compartilhado pelos dois relatórios.
// Estética de revista/consultoria premium (skill relatorio-pdf-editorial-place2u):
// Playfair Display (títulos) + JetBrains Mono (rótulos) + Inter (corpo),
// papel quente + tinta escura + acento laranja Place2u, verdict box invertida.
import { logoDataUri, MARCA, rotuloMes } from './marca.js'

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const brData = iso => {
  if (!iso || iso === '—') return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

export const FONTES = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`

export const CSS = `
  :root{
    --ink:#1a1612; --paper:#f7f2ea; --paper-deep:#efe7da; --rule:#2a2520;
    --accent:#ff6b1a; --accent-deep:#d4550e; --gold:#b8924a; --sage:#5f7355;
    --blood:#c0392b; --cinza:#8a8378;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--paper);color:var(--ink);font-family:'Inter',sans-serif;
    font-size:14px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;
    -webkit-font-smoothing:antialiased;hyphens:none}
  .pagina{max-width:880px;margin:0 auto;padding:40px 22px 64px}
  h1,h2,h3{font-family:'Playfair Display',serif;font-weight:500;letter-spacing:-.012em;
    font-feature-settings:'liga','dlig'}
  .mono{font-family:'JetBrains Mono',monospace}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.26em;
    text-transform:uppercase;color:var(--accent-deep);font-weight:600}
  a{color:var(--accent-deep);text-decoration:none} a:hover{text-decoration:underline}

  .faixa{display:flex;height:3px;width:100%}
  .faixa div{flex:1}
  .faixa .f1{background:var(--accent)} .faixa .f2{background:var(--accent-deep)}
  .faixa .f3{background:var(--gold)} .faixa .f4{background:var(--sage)} .faixa .f5{background:var(--ink)}

  /* CAPA */
  header.capa{padding:36px 0 24px;margin-bottom:30px;position:relative;
    border-bottom:2px solid var(--ink)}
  header.capa::after{content:'';display:block;position:absolute;left:0;right:0;bottom:-5px;
    border-bottom:1px solid var(--ink)}
  .capa-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:8px}
  .capa-logo{width:60px;height:60px;border-radius:13px;display:block;
    border:1px solid rgba(26,22,18,.14)}
  .capa h1{font-size:47px;line-height:1;margin:12px 0 6px}
  .capa h1 em{color:var(--accent-deep);font-style:italic}
  .capa .tagline{font-family:'Playfair Display',serif;font-style:italic;font-size:15.5px;
    color:var(--rule);opacity:.8;margin-top:12px}
  .capa-meta{display:flex;flex-wrap:wrap;gap:10px 34px;margin-top:22px;padding-top:14px;
    border-top:1px solid rgba(42,37,32,.2);
    font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.07em;color:var(--rule)}
  .capa-meta b{color:var(--ink);font-weight:600}

  /* SEÇÕES */
  section{margin-bottom:38px;page-break-inside:auto}
  .sec-titulo{margin-bottom:16px;padding-bottom:9px;border-bottom:1px solid var(--rule);
    display:flex;flex-direction:column;gap:4px}
  .sec-titulo .eyebrow{display:block}
  .sec-titulo h2{font-size:23px}
  .sec-titulo .sub{font-size:11.5px;color:var(--rule);opacity:.75}

  /* VERDICT (caixa invertida) */
  .verdict{background:var(--ink);color:var(--paper);padding:20px 26px;margin-bottom:28px;
    border-left:3px solid var(--accent);page-break-inside:avoid}
  .verdict .eyebrow{color:var(--accent)}
  .verdict p{font-family:'Playfair Display',serif;font-size:16px;line-height:1.55;margin-top:8px}
  .verdict.alerta{background:#3d1410}

  /* STATS */
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:14px;
    padding:18px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
  .stat .num{font-family:'Playfair Display',serif;font-size:31px;font-weight:500;line-height:1;letter-spacing:-.02em}
  .stat .num.bom{color:var(--sage)} .stat .num.alerta{color:var(--gold)} .stat .num.risco{color:var(--blood)}
  .stat .lbl{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--accent-deep);
    text-transform:uppercase;letter-spacing:.12em;margin-top:6px;font-weight:600}
  .stat .sub{font-size:10.5px;color:var(--rule);opacity:.75;margin-top:3px}

  /* BARRA DO PLANO DE AÇÃO DO MÊS */
  .plano{background:var(--paper-deep);border-top:3px solid var(--accent);padding:18px 22px;margin-bottom:26px;page-break-inside:avoid}
  .plano-cab{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px}
  .plano-cab h3{font-size:19px}
  .plano-cab .pct{font-family:'Playfair Display',serif;font-size:31px;color:var(--accent-deep)}
  .plano-trilha{height:14px;background:rgba(26,22,18,.12);border-radius:7px;overflow:hidden;margin:12px 0 8px}
  .plano-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-deep));border-radius:7px}
  .plano-sub{display:flex;flex-wrap:wrap;gap:4px 22px;font-family:'JetBrains Mono',monospace;
    font-size:10px;letter-spacing:.06em;color:var(--rule);text-transform:uppercase}

  /* TABELAS */
  table{width:100%;border-collapse:collapse;font-size:12.3px}
  thead th{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--rule);
    text-transform:uppercase;letter-spacing:.14em;text-align:left;padding:8px 10px 8px 0;
    border-bottom:1px solid var(--ink)}
  tbody td{padding:10px 10px 10px 0;border-bottom:1px solid rgba(42,37,32,.13);vertical-align:top;line-height:1.5}
  .tab-mais{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--rule);
    letter-spacing:.06em;padding-top:10px}

  /* TAGS */
  .tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;border-radius:3px;padding:3px 8px;white-space:nowrap}
  .t-concluida,.t-recebido{background:var(--sage);color:var(--paper)}
  .t-andamento{background:var(--accent);color:#fff}
  .t-validacao,.t-parcial{background:var(--gold);color:#fff}
  .t-bloqueada,.t-faltando{background:var(--blood);color:#fff}
  .t-dependencia_cliente{background:transparent;color:var(--gold);border:1px solid var(--gold)}
  .t-nao_iniciada,.t-opcional{background:rgba(42,37,32,.14);color:var(--rule)}
  .t-cancelada{background:rgba(42,37,32,.08);color:var(--cinza);text-decoration:line-through}
  .t-proc{background:transparent;color:var(--accent-deep);border:1px solid var(--accent);}

  /* CARDS DE ENTREGA/AÇÃO */
  .entrega{background:#fffdfa;border:1px solid rgba(42,37,32,.12);border-top:2px solid var(--accent);
    padding:16px 20px 14px;margin-bottom:14px;page-break-inside:avoid}
  .entrega h3{font-size:16.5px;margin-bottom:6px}
  .entrega .lm{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--rule);
    display:flex;flex-wrap:wrap;gap:5px 16px;margin-bottom:8px;letter-spacing:.05em;align-items:center}
  .entrega p{font-size:12.8px;margin:5px 0}
  .rotulo{font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--accent-deep);
    font-size:9px;text-transform:uppercase;letter-spacing:.14em}

  /* EVIDÊNCIAS */
  .thumbs{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px}
  .thumb{width:238px}
  .thumb img{width:238px;height:158px;object-fit:cover;object-position:top;display:block;
    border:1px solid rgba(42,37,32,.25);box-shadow:3px 3px 0 var(--paper-deep)}
  .thumb .leg{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--rule);margin-top:5px;line-height:1.4}
  .thumb-arquivo{width:238px;height:158px;border:1px dashed rgba(42,37,32,.35);
    display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--cinza)}
  .galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .chip{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.04em;
    border:1px solid var(--accent);color:var(--accent-deep);border-radius:20px;padding:3px 12px;
    text-decoration:none;display:inline-block}
  .chip:hover{background:var(--accent);color:#fff;text-decoration:none}
  .gal-item{background:#fffdf9;border:1px solid rgba(42,37,32,.16);page-break-inside:avoid}
  .gal-item img{width:100%;height:160px;object-fit:cover;object-position:top;display:block}
  .gal-item .info{padding:10px 12px;font-size:11px}
  .gal-item .info b{display:block;font-size:12px;margin-bottom:2px;font-family:'Inter',sans-serif}
  .gal-item .info .leg{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--rule)}

  /* PROCESSO (antes → depois) */
  .processo-linha{border-left:3px solid var(--accent);padding:12px 18px;margin-bottom:12px;
    background:var(--paper-deep);page-break-inside:avoid}
  .processo-linha h3{font-size:16px;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .processo-linha .pct{font-family:'Playfair Display',serif;color:var(--accent-deep);font-size:19px;white-space:nowrap}
  .processo-linha dl{display:grid;grid-template-columns:140px 1fr;gap:4px 14px;font-size:12.5px;margin-top:8px}
  .processo-linha dt{font-family:'JetBrains Mono',monospace;color:var(--rule);font-size:9px;
    text-transform:uppercase;letter-spacing:.08em;padding-top:2px}

  /* MÉTRICAS (semanal) */
  .met-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:12px;margin-bottom:10px}
  .met{background:#fbf7f0;border:1px solid rgba(42,37,32,.1);padding:14px 16px;border-top:2px solid var(--sage)}
  .met .v{font-family:'Playfair Display',serif;font-size:21px;color:var(--ink);display:flex;
    align-items:baseline;gap:6px;flex-wrap:wrap}
  .met .r{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--rule);
    text-transform:uppercase;letter-spacing:.13em;margin-top:5px}
  .met.ads{border-top-color:var(--gold)}
  .grafico-caixa{background:#fffdfa;border:1px solid rgba(42,37,32,.1);padding:16px 16px 12px}
  .plano-extra{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.05em;
    color:var(--rule);margin-top:9px;padding-top:8px;border-top:1px solid rgba(26,22,18,.14)}

  /* RESULTADOS EM DESTAQUE — o lado positivo sempre na frente */
  .destaques{background:#eef2e9;border:1px solid rgba(95,115,85,.32);border-left:3px solid var(--sage);
    padding:18px 24px;margin-bottom:28px;page-break-inside:avoid}
  .destaques .eyebrow{display:block;margin-bottom:6px}
  .destaques h3{font-size:16px;color:#3c4a33;margin-bottom:12px}
  .destaque-item{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
    padding:7px 0;border-bottom:1px solid rgba(95,115,85,.16);font-size:13px;color:#2f3a29}
  .destaque-item:last-child{border-bottom:none}
  .destaques .relacionadas{margin-top:12px;padding-top:10px;border-top:1px solid rgba(95,115,85,.25);
    font-size:12px;color:#3c4a33;line-height:1.5}

  .aviso{background:#fbf3df;border-left:3px solid var(--gold);padding:10px 16px;font-size:12.5px;
    color:#6b5320;margin-top:8px;page-break-inside:avoid}
  .dep{background:#fdeee3;border-left:3px solid var(--accent);padding:11px 16px;font-size:12.5px;
    color:#7c3a10;margin-top:6px;page-break-inside:avoid}
  .vazio{color:var(--cinza);font-size:12.5px;font-style:italic;padding:6px 0}
  .pt-atencao li{margin:7px 0 7px 18px;font-size:13px}
  .comp{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:600;border-radius:3px;padding:2px 7px}
  .comp.bom{background:var(--sage);color:var(--paper)} .comp.ruim{background:var(--blood);color:#fff}
  .comp.igual{background:rgba(42,37,32,.12);color:var(--rule)}

  footer{margin-top:34px;padding-top:12px;border-top:1px solid var(--rule);
    display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;
    font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--rule);opacity:.75}

  @media(max-width:640px){
    .capa h1{font-size:31px} .processo-linha dl{grid-template-columns:1fr}
    .plano-cab .pct{font-size:24px}
  }
  @media print{
    body{font-size:12px}
    .pagina{max-width:100%;padding:0 7mm}
    .capa-logo{box-shadow:none}
    section h2,.sec-titulo{page-break-after:avoid}
    .verdict,.plano,.stats,.entrega,.met,.tag,.faixa,.processo-linha,.thumb img,.dep,.aviso{
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
  }`

export function capa({ documento, titulo, tituloEm, subtitulo, meta }) {
  const logo = logoDataUri()
  return `
<header class="capa">
  <div class="faixa" style="margin-bottom:28px"><div class="f1"></div><div class="f2"></div><div class="f3"></div><div class="f4"></div><div class="f5"></div></div>
  <div class="capa-topo">
    <div>
      <span class="eyebrow">${esc(MARCA.nome)} · ${esc(MARCA.territorio)} · ${esc(documento)}</span>
      <h1>${esc(titulo)}${tituloEm ? ` <em>${esc(tituloEm)}</em>` : ''}</h1>
      ${subtitulo ? `<div style="font-size:15px;color:var(--rule);margin-top:2px">${esc(subtitulo)}</div>` : ''}
      <div class="tagline">${esc(MARCA.tagline)}</div>
    </div>
    ${logo ? `<img class="capa-logo" src="${logo}" alt="${esc(MARCA.nome)}">` : ''}
  </div>
  <div class="capa-meta">${meta.map(m => `<span>${m}</span>`).join('')}</div>
</header>`
}

export function barraPlano(plano, { titulo, extraHtml } = {}) {
  if (!plano) return ''
  if (!plano.total) return `
<div class="plano">
  <div class="plano-cab"><h3>${esc(titulo || `Plano de ação de ${rotuloMes(plano.anoMes)}`)}</h3></div>
  <p class="vazio">Nenhuma tarefa registrada para este mês no Notion.</p>
</div>`
  return `
<div class="plano">
  <div class="plano-cab">
    <h3>${esc(titulo || `Plano de ação de ${rotuloMes(plano.anoMes)}`)}</h3>
    <span class="pct">${plano.pct}%</span>
  </div>
  <div class="plano-trilha"><div class="plano-fill" style="width:${plano.pct}%"></div></div>
  <div class="plano-sub">
    <span>${plano.concluidas} de ${plano.total} ações concluídas</span>
    <span>esforço ${plano.esforco_concluido}/${plano.esforco} (${plano.pct_esforco}%)</span>
    <span>${plano.andamento} em execução</span>
    ${plano.bloqueadas ? `<span style="color:var(--blood)">${plano.bloqueadas} bloqueada(s)</span>` : ''}
    ${plano.dependencia_cliente ? `<span>${plano.dependencia_cliente} aguardando o cliente</span>` : ''}
  </div>
  ${extraHtml ? `<div class="plano-extra">${extraHtml}</div>` : ''}
</div>`
}

export function secTitulo(num, titulo, sub) {
  return `<div class="sec-titulo"><span class="eyebrow">Seção ${esc(num)}</span><h2>${esc(titulo)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`
}

export function rodape(extra = '') {
  return `<footer><span>${esc(MARCA.nome)} · ${esc(MARCA.territorio)}</span><span>${esc(extra)}</span><span>Fonte oficial: Notion</span></footer>`
}
