// HTML editorial da Prestação de contas / Dossiê de defesa (src/lib/dossie.js → { capa, secoes }), no espírito do PDF do Manoel (09/10/2026): capa escura, seções
// numeradas "01 · RESUMO EXECUTIVO", cards de KPI, tabelas, nota de fonte em cada seção e rodapé "Mercado Livre · {cliente} · {data} · pág". Cores e fontes = os tokens
// do 1º :root de src/web/ui.css, LIDOS do arquivo (ui.css não é alterado; nenhum hex novo aqui). Versão defesa: faixa CONFIDENCIAL na capa e no topo de cada página.
// PDF pelo mesmo Chrome headless do relatório (relatorio-pdf.gerarPdf; prints por file:// absoluto, só de data/). Word = .rtf pelo textutil do macOS (HTML → RTF: Word, Google Docs,
// Pages e TextEdit abrem e editam, com as tabelas; cabeçalho CONFIDENCIAL e rodapé numerado por página). ponytail: o .docx do textutil achata TODAS as tabelas em parágrafos,
// por isso RTF. Sem textutil (Linux) ou com falha: fica o .doc HTML (application/msword, abre no Word/Google Docs; no TextEdit vira código) e o motivo — sem dependência nova.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { gerarPdf } from './relatorio-pdf.js'

const UI = readFileSync(new URL('../web/ui.css', import.meta.url), 'utf8')
const RAIZ_TOKENS = (UI.match(/:root\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
export const TOKENS = Object.fromEntries([...RAIZ_TOKENS.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
const tk = nome => TOKENS[nome] || ''
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// string CSS dentro de <style>: sem aspa/contrabarra soltas e sem '<' '>' (um nome com «</style>» não pode fechar o bloco)
const cssStr = s => `"${String(s ?? '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3c ').replace(/>/g, '\\3e ')}"`
const dm = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso ?? '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:var(--superficie);color:var(--tinta);font:400 10pt/1.5 var(--fonte);-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.capa{width:100%;border-collapse:collapse;background:var(--tinta-forte);color:var(--superficie)}
table.capa td{background:var(--tinta-forte);vertical-align:top;padding:0}
.capa-in{height:297mm;padding:20mm 18mm 16mm;position:relative;display:flex;flex-direction:column}
.capa-topo{display:flex;justify-content:space-between;align-items:flex-start}
.marca{font:700 22pt/1 var(--fonte-display);letter-spacing:-.01em;color:var(--superficie)}
.marca b{color:var(--laranja)}
.capa-doc{font:600 7.5pt/1.6 var(--fonte);letter-spacing:.22em;text-transform:uppercase;color:var(--borda-forte);text-align:right}
.capa-meio{margin-top:auto}
.capa-eyebrow{font:600 8pt var(--fonte);letter-spacing:.2em;text-transform:uppercase;color:var(--laranja);margin-bottom:14pt}
.capa h1{font:700 44pt/1.02 var(--fonte-display);letter-spacing:-.025em;margin:0;color:var(--superficie)}
.capa h1 span{display:block}
.capa h1 .ac{color:var(--laranja)}
.capa-sub{font-size:11pt;line-height:1.55;color:var(--borda-forte);max-width:120mm;margin-top:14pt}
.capa-pe{margin-top:auto;border-top:1px solid var(--cinza);padding-top:12pt}
table.capa-dados{width:100%;border-collapse:collapse}
table.capa-dados td{padding:6pt 12pt 6pt 0;vertical-align:top;width:50%}
.capa-rot{font:600 7pt var(--fonte);letter-spacing:.16em;text-transform:uppercase;color:var(--cinza-claro)}
.capa-val{font:600 13pt/1.3 var(--fonte-display);color:var(--superficie)}
.capa-base{font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--cinza-claro);margin-top:12pt}
.conf{background:var(--verm);color:var(--superficie);font:700 8pt var(--fonte);letter-spacing:.2em;text-transform:uppercase;padding:6pt 10pt;margin-bottom:10pt;display:inline-block}
.selo{display:inline-block;font:700 8pt var(--fonte);letter-spacing:.14em;text-transform:uppercase;padding:4pt 8pt;border:1px solid currentColor;margin:0 0 16pt}
.selo.completo{color:var(--verde-suave)} .selo.incompleto{color:var(--verm-suave)}
.sec{break-before:page;page-break-before:always}
.sec-num{font:600 8pt var(--fonte);letter-spacing:.2em;text-transform:uppercase;color:var(--laranja-escuro);margin:0 0 4pt}
.sec h2{font:600 19pt/1.2 var(--fonte-display);color:var(--tinta-forte);margin:0 0 10pt;padding-bottom:6pt;border-bottom:1px solid var(--borda-forte);letter-spacing:-.01em}
h3{font:600 10.5pt var(--fonte);color:var(--tinta-forte);margin:14pt 0 6pt;break-after:avoid}
p{margin:6pt 0}
p.nota{font-size:8.5pt;color:var(--cinza)}
p.mudo,p.vazio{color:var(--cinza-claro);font-size:9pt}
ul{margin:4pt 0 8pt 16pt;padding:0} li{margin:3pt 0}
.fonte{margin-top:14pt;padding-top:6pt;border-top:1px solid var(--borda);font-size:7.5pt;color:var(--cinza-claro);letter-spacing:.03em}
table.kpis{width:100%;border-collapse:separate;border-spacing:6pt 0;margin:4pt 0 12pt;table-layout:fixed}
table.kpis td{background:var(--fundo-suave);border:1px solid var(--borda);padding:8pt 10pt;vertical-align:top}
.kpi-rot{font:600 7pt var(--fonte);letter-spacing:.12em;text-transform:uppercase;color:var(--cinza)}
.kpi-val{font:600 14pt/1.2 var(--fonte-display);color:var(--tinta-forte);margin:4pt 0 2pt;white-space:nowrap}
.kpi-sub{font-size:7.5pt;color:var(--cinza-claro)}
table.t{width:100%;border-collapse:collapse;margin:6pt 0 8pt;font-size:8.5pt}
table.t th{font:600 7pt var(--fonte);letter-spacing:.08em;text-transform:uppercase;color:var(--cinza);text-align:left;border-bottom:1.5px solid var(--tinta);padding:5pt 6pt}
table.t td{border-bottom:1px solid var(--borda);padding:4pt 6pt;vertical-align:top}
table.t .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.t tr{break-inside:avoid;page-break-inside:avoid}
table.t.mini{font-size:7.5pt}table.t.mini td{padding:3pt 5pt}
table.t.cron td:nth-child(5){width:50%}
.tnota{font-size:8pt;color:var(--cinza);margin:-2pt 0 8pt}
.aviso{border-left:3px solid var(--azul);background:var(--azul-suave);padding:8pt 10pt;margin:8pt 0;break-inside:avoid;page-break-inside:avoid}
.aviso.atencao{border-color:var(--ambar);background:var(--ambar-suave)}
.aviso.critico{border-color:var(--verm);background:var(--verm-suave)}
.aviso.ok{border-color:var(--verde);background:var(--verde-suave)}
.aviso b{display:block;margin-bottom:2pt;color:var(--tinta-forte)}
table.imgs{width:100%;border-collapse:collapse;table-layout:fixed}
table.imgs td{width:50%;vertical-align:top;padding:4pt;break-inside:avoid}
table.imgs img{width:100%;max-height:90mm;object-fit:contain;border:1px solid var(--borda);background:var(--fundo-suave)}
.leg{font-size:7.5pt;color:var(--cinza);margin-top:3pt}`

const MINI = new Set(['execucao', 'rastreabilidade', 'historico', 'cronologia', 'varredura'])   // tabelas longas em corpo menor
// ── blocos → HTML (todo texto passa por esc) ─────────────────────────────────────────────────────────
function bloco(b, { formato, secao }) {
  switch (b?.t) {
    case 'p': return `<p${b.classe ? ` class="${b.classe === 'nota' ? 'nota' : 'mudo'}"` : ''}>${esc(b.texto)}</p>`
    case 'h3': return `<h3>${esc(b.texto)}</h3>`
    case 'lista': return `<ul>${(b.itens || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
    case 'aviso': return `<div class="aviso ${['atencao', 'critico', 'ok'].includes(b.nivel) ? b.nivel : 'info'}">${b.titulo ? `<b>${esc(b.titulo)}</b>` : ''}${esc(b.texto)}</div>`
    case 'kpis': return `<table class="kpis"><tr>${(b.itens || []).map(k => `<td><div class="kpi-rot">${esc(k.rotulo)}</div><div class="kpi-val">${esc(k.valor)}</div><div class="kpi-sub">${esc(k.sub)}</div></td>`).join('')}</tr></table>`
    case 'tabela': {
      if (!(b.linhas || []).length) return `<p class="vazio">${esc(b.vazio)}</p>`
      const num = new Set(b.num || []), cls = i => num.has(i) ? ' class="n"' : ''
      return `<table class="t${MINI.has(secao) ? ' mini' : ''}${secao === 'cronologia' ? ' cron' : ''}"><thead><tr>${b.cab.map((c, i) => `<th${cls(i)}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.linhas.map(l => `<tr>${l.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${b.nota ? `<p class="tnota">${esc(b.nota)}</p>` : ''}`
    }
    case 'imagens': {
      if (formato === 'doc') return `<ul>${(b.itens || []).map(i => `<li>${esc(i.legenda)} — print com sha256 ${esc(String(i.sha256 || '').slice(0, 16))} (imagem no PDF e no card do Notion)</li>`).join('')}</ul>`
      const cel = i => `<td><img src="${esc(pathToFileURL(i.abs).href)}" alt="${esc(i.legenda)}"><div class="leg">${esc(i.legenda)} · sha256 ${esc(String(i.sha256 || '').slice(0, 12))}</div></td>`
      const it = b.itens || [], linhas = []
      for (let k = 0; k < it.length; k += 2) linhas.push(`<tr>${cel(it[k])}${it[k + 1] ? cel(it[k + 1]) : '<td></td>'}</tr>`)
      return `<table class="imgs">${linhas.join('')}</table>`
    }
    default: return ''
  }
}

function capaHtml(c) {
  const linhas = c.titulo || []
  return `<table class="capa"><tr><td><div class="capa-in">
  <div class="capa-topo"><div class="marca">Place2u<b>.</b></div><div class="capa-doc">${esc(c.documento)}</div></div>
  <div class="capa-meio">
    ${c.confidencial ? `<div class="conf">Confidencial — uso exclusivo interno/jurídico</div>${c.status ? `<div><span class="selo ${c.status === 'completo' ? 'completo' : 'incompleto'}">${c.status === 'completo' ? 'Completo' : 'Incompleto — não enviar ainda'}</span></div>` : ''}` : ''}
    <div class="capa-eyebrow">${esc(c.eyebrow)}</div>
    <h1>${linhas.map((l, i) => `<span${i === linhas.length - 1 ? ' class="ac"' : ''}>${esc(l)}</span>`).join('')}</h1>
    <p class="capa-sub">${esc(c.subtitulo)}</p>
  </div>
  <div class="capa-pe">
    <table class="capa-dados"><tr><td><div class="capa-rot">Cliente</div><div class="capa-val">${esc(c.cliente)}</div></td><td><div class="capa-rot">Consultor responsável</div><div class="capa-val">${esc(c.consultor)}</div></td></tr>
    <tr><td><div class="capa-rot">Período dos indicadores</div><div class="capa-val">${esc(c.periodo)}</div></td><td><div class="capa-rot">CS responsável</div><div class="capa-val">${esc(c.cs)}</div></td></tr></table>
    <div class="capa-base">${esc(c.bases)}${c.livro ? ` · ${esc(c.livro)}` : ''}</div>
  </div></div></td></tr></table>`
}

const titulo = d => `${d.versao === 'defesa' ? 'Dossiê de defesa' : 'Prestação de contas'} · ${d.cliente} · ${dm(d.de)} a ${dm(d.ate)}`
const CONF = 'CONFIDENCIAL — uso exclusivo interno/jurídico'
function corpo(d, formato) {
  // Word da defesa: a faixa CONFIDENCIAL abre cada seção (no PDF ela já está no topo de cada página; no RTF também vai no cabeçalho de página)
  const faixa = formato === 'doc' && d.versao === 'defesa' ? `<div class="conf">${esc(CONF)}</div>` : ''
  return capaHtml(d.capa) + (d.secoes || []).map(s => `
<section class="sec" id="s-${esc(s.id)}">${faixa}<div class="sec-num">${esc(s.num)} · ${esc(String(s.titulo).toUpperCase())}</div><h2>${esc(s.titulo)}</h2>
${(s.blocos || []).map(b => bloco(b, { formato, secao: s.id })).join('\n')}
${s.fonte ? `<p class="fonte">Fonte: ${esc(s.fonte)}</p>` : ''}</section>`).join('')
}

// PDF: tokens como variáveis CSS + rodapé/numeração em margem de página (Chrome ≥ 131) + webfont do sistema de design
export function htmlPdf(d) {
  const rodape = `Mercado Livre · ${d.cliente} · ${dm(d.hoje)}`, conf = d.versao === 'defesa'
  const pagina = `@page{size:A4;margin:16mm 14mm 18mm;
  @bottom-left{content:${cssStr(rodape)};font:8px ${tk('fonte')};color:${tk('cinza-claro')}}
  @bottom-right{content:"pág. " counter(page) " / " counter(pages);font:8px ${tk('fonte')};color:${tk('cinza-claro')}}
  ${conf ? `@top-center{content:${cssStr(CONF)};font:700 8px ${tk('fonte')};letter-spacing:.2em;color:${tk('verm')}}` : ''}}
@page:first{margin:0;@bottom-left{content:none}@bottom-right{content:none}@top-center{content:none}}`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo(d))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>:root{${RAIZ_TOKENS}}
${pagina}${CSS}</style></head><body>${corpo(d, 'pdf')}</body></html>`
}

// Word (.doc HTML): o Word não lê variáveis CSS nem flex — tokens resolvidos para o valor, capa em tabela com fundo
const resolverVars = css => css.replace(/var\(--([\w-]+)\)/g, (_, k) => tk(k) || 'inherit')
export function htmlDoc(d) {
  const css = resolverVars(CSS).replace(/display:flex;flex-direction:column/g, 'display:block').replace(/height:297mm;/g, '') +
    '\n@page WordSection1{size:595.3pt 841.9pt;margin:2cm 1.8cm}div.WordSection1{page:WordSection1}.capa-meio{margin:60pt 0 40pt}.capa-pe{margin-top:30pt}'
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="ProgId" content="Word.Document"><title>${esc(titulo(d))}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>${css}</style></head><body><div class="WordSection1">${corpo(d, 'doc')}
<p class="fonte">${esc(`Mercado Livre · ${d.cliente} · ${dm(d.hoje)}${d.versao === 'defesa' ? ` · ${CONF}` : ''}`)}</p></div></body></html>`
}

// RTF: texto fora do ASCII como \uN? (com sinal, 16 bits); \ { } escapados
const rtfEsc = s => [...String(s ?? '')].map(c => { const n = c.codePointAt(0); return c === '\\' || c === '{' || c === '}' ? `\\${c}` : n < 128 ? c : n > 0xffff ? '?' : `\\u${n > 32767 ? n - 65536 : n}?` }).join('')
const TEXTUTIL = '/usr/bin/textutil'
// .doc HTML → .rtf pelo textutil; injeta cabeçalho (CONFIDENCIAL na defesa) e rodapé «Mercado Livre · cliente · data · pág. N» em cada página
export function paraRtf(htmlPath, destino, d, { bin = TEXTUTIL } = {}) {
  if (!existsSync(bin)) return Promise.reject(Object.assign(new Error('textutil ausente'), { codigo: 'rtf_indisponivel' }))
  return new Promise((ok, falha) => execFile(bin, ['-format', 'html', '-convert', 'rtf', '-output', destino, htmlPath], { timeout: 120_000 }, e => {
    if (e) return falha(Object.assign(new Error('textutil falhou'), { codigo: e.killed ? 'rtf_timeout' : 'rtf_falhou' }))
    const rtf = readFileSync(destino, 'latin1')
    const hf = `${d.versao === 'defesa' ? `{\\header\\pard\\qc\\b\\fs16 ${rtfEsc(CONF)}\\par}` : ''}{\\footer\\pard\\qc\\fs14 ${rtfEsc(`Mercado Livre · ${d.cliente} · ${dm(d.hoje)} · pág. `)}\\chpgn\\par}`
    if (!/^\{\\rtf1/.test(rtf)) return falha(Object.assign(new Error('rtf inválido'), { codigo: 'rtf_falhou' }))
    writeFileSync(destino, rtf.replace(/(\\deftab\d+)/, (m) => `${m}\n${hf}`), 'latin1')
    ok(destino)
  }))
}

// grava o Word (.rtf; sem textutil, o .doc HTML e o motivo) e gera o PDF (falha do PDF vira pdf_motivo, nunca derruba: o Word fica)
export async function gerarArquivos(d, { dir, base, pdf = gerarPdf, pdfOpts = {}, rtf = paraRtf }) {
  mkdirSync(dir, { recursive: true })
  let doc = join(dir, `${base}.doc`), doc_motivo = ''
  writeFileSync(doc, '\ufeff' + htmlDoc(d))
  if (rtf) {
    const r = join(dir, `${base}.rtf`)
    try { await rtf(doc, r, d); unlinkSync(doc); doc = r } catch (e) { doc_motivo = e?.codigo || 'rtf_falhou'; try { unlinkSync(r) } catch { /* não chegou a existir */ } }
  }
  const destino = join(dir, `${base}.pdf`)
  try { await pdf(htmlPdf(d), destino, pdfOpts); return { pdf: destino, doc, pdf_motivo: '', doc_motivo } }
  catch (e) { return { pdf: '', doc, pdf_motivo: e?.codigo || 'pdf_falhou', doc_motivo } }
}
