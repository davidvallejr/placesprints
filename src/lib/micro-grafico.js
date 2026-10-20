// Micro gráfico (sparkline) em SVG puro, sem biblioteca: serve ao painel, ao relatório HTML e ao PDF.
// A linha é a média móvel de 3 dias (o dia isolado de um anúncio pequeno é ruído); a tracejada vertical é o dia da conclusão da tarefa;
// a tracejada horizontal é a média diária dos dias ANTES da tarefa. Só números entram no SVG (nada vindo do usuário), exceto o <title>, escapado.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const f = n => (Math.round(n * 10) / 10).toString()
const COR = { positivo: '#1e7b4d', negativo: '#c0392b', estavel: '#b7791f', neutro: '#6b7280' }

export const mediaMovel = (v, k = 3) => v.map((_, i) => { const a = v.slice(Math.max(0, i - k + 1), i + 1); return a.reduce((t, x) => t + x, 0) / a.length })

// valores: números por dia; marcadorIdx: índice do dia da conclusão; base: média diária antes; sinal: positivo|negativo|estavel|neutro;
// eventos: [{ idx, rotulo, estado? }] = mudanças no anúncio (preço, título, fotos…) — um ponto na linha naquele dia, com o rótulo escapado no
// <title>; estado=true (promoção, Ads, Full, estoque, pausa) vira um losango em vez do ponto
export function microGrafico({ valores, marcadorIdx = null, base = null, sinal = 'neutro', rotulo = '', eventos = [], w = 180, h = 48 }) {
  if (!Array.isArray(valores) || valores.length < 3) return ''
  const m = mediaMovel(valores), n = m.length, pad = 3
  const max = Math.max(1e-9, ...m, base ?? 0) * 1.12
  const x = i => pad + (w - 2 * pad) * (n === 1 ? 0 : i / (n - 1))
  const y = v => h - pad - (h - 2 * pad) * (v / max)
  const pts = (de, ate) => m.slice(de, ate + 1).map((v, k) => `${f(x(de + k))},${f(y(v))}`).join(' ')
  const cor = COR[sinal] || COR.neutro
  const idx = Number.isInteger(marcadorIdx) && marcadorIdx > 0 && marcadorIdx < n ? marcadorIdx : null
  const antes = idx != null ? pts(0, idx) : pts(0, n - 1)
  const depois = idx != null ? pts(idx, n - 1) : ''
  const area = idx != null ? `<polygon points="${f(x(idx))},${f(h - pad)} ${pts(idx, n - 1)} ${f(x(n - 1))},${f(h - pad)}" style="fill:${cor};opacity:.12"/>` : ''
  return `<svg class="micro" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="${esc(rotulo)}"><title>${esc(rotulo)}</title>`
    + (base != null ? `<line x1="${pad}" x2="${w - pad}" y1="${f(y(base))}" y2="${f(y(base))}" style="stroke:${COR.neutro};stroke-width:1;stroke-dasharray:3 3;opacity:.7"/>` : '')
    + area
    + `<polyline points="${antes}" style="fill:none;stroke:${COR.neutro};stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round"/>`
    + (depois ? `<polyline points="${depois}" style="fill:none;stroke:${cor};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>` : '')
    + (idx != null ? `<line x1="${f(x(idx))}" x2="${f(x(idx))}" y1="${pad}" y2="${h - pad}" style="stroke:#111827;stroke-width:1;stroke-dasharray:2 2;opacity:.55"/>` : '')
    + (Array.isArray(eventos) ? eventos : []).filter(e => Number.isInteger(e?.idx) && e.idx >= 0 && e.idx < n)
      .map(e => e.estado
        ? `<rect x="${f(x(e.idx) - 2.8)}" y="${f(y(m[e.idx]) - 2.8)}" width="5.6" height="5.6" transform="rotate(45 ${f(x(e.idx))} ${f(y(m[e.idx]))})" style="fill:#b34100;stroke:#ffffff;stroke-width:1"><title>${esc(e.rotulo)}</title></rect>`
        : `<circle cx="${f(x(e.idx))}" cy="${f(y(m[e.idx]))}" r="2.6" style="fill:#b34100;stroke:#ffffff;stroke-width:1"><title>${esc(e.rotulo)}</title></circle>`).join('')
    + '</svg>'
}
