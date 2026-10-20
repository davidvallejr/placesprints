import { tmpdir } from 'node:os'
// Documento (PDF) do Relatório de Sprints Place2u anexado à página do Notion do cliente (pedido do David, 09/10/2026).
// O HTML é uma PROJEÇÃO dos mesmos blocos que vão ao Notion (briefParaBlocos): mesmas seções, mesmo texto auditado por relatorio-seguro — nunca um segundo texto.
// NÃO importa db.js nem notion-publicar.js na carga (subirPdf abre o banco real): o upload entra por injeção, com import preguiçoso como padrão.
// Chrome headless gera o PDF (mesmo caminho/argumentos de src/server.js); sem Chrome = erro classificado `pdf_indisponivel`, que o envio trata como aviso.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { ROOT } from './env.js'
import { FONTES, CSS, capa, esc } from './estilo-editorial.js'
import { MARCA } from './marca.js'
import { briefParaBlocos, normNome } from './relatorio-notion.js'
import { CATEGORIA } from './relatorio-seguro.js'

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const DIR_PDF = join(ROOT, 'data', 'relatorios', 'pdf')
export const slug = s => normNome(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cliente'
export const caminhoPdf = ({ cliente, de, ate }, dir = DIR_PDF) => join(dir, `${slug(cliente)}-${de}-${ate}.pdf`)
const erroCod = (msg, codigo) => Object.assign(new Error(msg), { codigo })

// ── blocos do Notion → HTML ───────────────────────────────────────────────────────────────────────────────
const COR = { green: 'var(--sage)', red: 'var(--blood)', gray: 'var(--cinza)' }
const richHtml = rich => (Array.isArray(rich) ? rich : []).map(t => {
  const a = t?.annotations || {}, s = esc(t?.text?.content ?? '').replace(/\n/g, '<br>')
  const st = COR[a.color] ? ` style="color:${COR[a.color]}"` : ''
  return `${a.bold ? '<b>' : ''}${a.italic ? '<i>' : ''}<span${st}>${s}</span>${a.italic ? '</i>' : ''}${a.bold ? '</b>' : ''}`
}).join('')
const CALLOUT = { green_background: 'verde', yellow_background: 'amarelo', orange_background: 'laranja', red_background: 'vermelho', gray_background: 'cinza' }
function blocoHtml(b) {
  const c = b?.[b?.type] || {}
  switch (b?.type) {
    case 'paragraph': return `<p${c.color === 'gray' || c.color === 'gray_background' ? ' class="mudo"' : ''}>${richHtml(c.rich_text)}</p>`
    case 'heading_2': return `<h2>${richHtml(c.rich_text)}</h2>`
    case 'heading_3': return `<h3>${richHtml(c.rich_text)}</h3>`
    case 'callout': return `<div class="callout ${CALLOUT[c.color] || 'cinza'}">${richHtml(c.rich_text)}</div>`
    case 'bulleted_list_item': case 'numbered_list_item': return `<li>${richHtml(c.rich_text)}</li>`
    case 'divider': return '<hr>'
    case 'table': return `<table>${(c.children || []).map((l, i) => `<tr>${(l.table_row?.cells || []).map(cel => i === 0 && c.has_column_header ? `<th>${richHtml(cel)}</th>` : `<td>${richHtml(cel)}</td>`).join('')}</tr>`).join('')}</table>`
    default: return ''
  }
}
const LISTA = new Set(['bulleted_list_item', 'numbered_list_item'])
export function blocosParaHtml(blocos) {
  const out = []; let aberta = false
  for (const b of blocos) {
    const li = LISTA.has(b?.type)
    if (li && !aberta) { out.push('<ul>'); aberta = true }
    if (!li && aberta) { out.push('</ul>'); aberta = false }
    out.push(blocoHtml(b))
  }
  if (aberta) out.push('</ul>')
  return out.join('\n')
}

const CSS_EXTRA = `
  .rel h2{font-size:21px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
  .rel h3{font-size:14.5px;margin:16px 0 6px;color:var(--rule)}
  .rel p{margin:6px 0}.rel p.mudo{color:var(--cinza);font-size:12.5px}
  .rel ul{margin:4px 0 8px 18px}.rel li{margin:3px 0}
  .rel hr{border:0;border-top:1px solid var(--paper-deep);margin:18px 0}
  .rel table{margin:8px 0 10px}.rel th,.rel td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--paper-deep);vertical-align:top}
  .rel th{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--rule)}
  .callout{padding:12px 14px;border-radius:6px;margin:10px 0;border-left:4px solid var(--cinza);background:var(--paper-deep)}
  .callout.verde{border-color:var(--sage)}.callout.amarelo{border-color:var(--gold)}.callout.laranja{border-color:var(--accent)}.callout.vermelho{border-color:var(--blood)}
  .callout,.rel table,.rel tr{page-break-inside:avoid}`

const dma = iso => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '' }
// HTML autocontido no estilo editorial: as MESMAS seções do brief (abertura, Resultados, Atividades com as tarefas concluídas, Desenvolvimento, Próximos passos, Depende de você, rodapé).
// O texto é o dos blocos auditados; só entram o nome do cliente (permitido) e o período — nunca nome interno ou ID.
export function briefParaHtml(brief, { cliente = '' } = {}) {
  const B = brief && typeof brief === 'object' ? brief : {}
  const jan = B.janela || {}
  const meta = [jan.rotulo ? `Período: ${esc(jan.rotulo)}` : (jan.de && jan.ate ? `Período: ${dma(jan.de)} a ${dma(jan.ate)}` : ''), B.hoje ? `Gerado em ${dma(B.hoje)}${B.hora ? ` às ${esc(B.hora)}` : ''}` : ''].filter(Boolean)
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(B.titulo || CATEGORIA)}</title>${FONTES}<style>${CSS}${CSS_EXTRA}</style></head>
<body><div class="pagina">
${capa({ documento: CATEGORIA, titulo: cliente || 'Relatório', subtitulo: B.titulo || '', meta })}   <!-- CATEGORIA: a única forma de «Sprints» que o auditor aceita -->
<section class="rel">
${blocosParaHtml(briefParaBlocos(B))}
</section>
<footer><span>${esc(MARCA.nome)} · ${esc(MARCA.territorio)}</span><span>${jan.rotulo ? `Últimos 7 dias fechados: ${esc(jan.rotulo)}` : ''}</span><span>${esc(MARCA.tagline)}</span></footer>   <!-- não usa rodape() do estilo: «Fonte oficial: Notion» é jargão para o cliente -->
</div></body></html>`
}

// ── PDF pelo Chrome headless (mesmo molde de src/server.js) ─────────────────────────────────────────────────
export function gerarPdf(html, destino, { chrome = CHROME, timeout_ms = 60_000, exec = execFile } = {}) {
  return new Promise((res, rej) => {
    if (!existsSync(chrome)) return rej(erroCod('Google Chrome não encontrado', 'pdf_indisponivel'))
    mkdirSync(join(destino, '..'), { recursive: true })
    const htmlPath = destino.replace(/\.pdf$/i, '') + '.html'
    writeFileSync(htmlPath, html)
    // ponytail (15/10/2026): perfil próprio por execução e apagado no fim — sem isso o Chrome headless deixava «scoped_dir*» em ~/Library/Caches (1,8 GB, disco a 100%)
    const perfil = mkdtempSync(join(tmpdir(), 'ps-chrome-'))
    exec(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=9000', `--user-data-dir=${perfil}`, `--print-to-pdf=${destino}`, 'file://' + htmlPath], { timeout: timeout_ms }, err => {
      try { unlinkSync(htmlPath) } catch { /* o HTML é intermediário */ }
      try { rmSync(perfil, { recursive: true, force: true }) } catch { /* perfil temporário */ }
      if (err || !existsSync(destino)) return rej(erroCod('falha ao gerar o PDF', err?.killed ? 'pdf_timeout' : 'pdf_falhou'))
      res(destino)
    })
  })
}

// ── anexo na página do Notion ───────────────────────────────────────────────────────────────────────────────
const PROPS_FILES = ['anexos', 'anexo', 'arquivo', 'arquivos', 'files', 'documento', 'documentos', 'attachments']
const subirPadrao = async caminho => (await import('./notion-publicar.js')).subirPdf(caminho)   // preguiçoso: notion-publicar abre o banco real
const blocoArquivo = (id, nome) => ({ object: 'block', type: 'file', file: { type: 'file_upload', file_upload: { id }, name: nome } })
const nomeDoBloco = b => b?.type === 'file' ? String(b.file?.name ?? '') : ''
// subirPdf → bloco `file` no topo da página (depois do 1º bloco: a API só insere "após" um bloco; página vazia = no fim, com cabeçalho) + propriedade `files` quando a página é linha de quadro.
// Idempotente: já existe bloco `file` com o mesmo nome → não anexa de novo. Falhas sobem com `codigo` (upload_falhou | notion_<status>).
export async function anexarPdf({ notionReq, page_id, caminho, subir = subirPadrao }) {
  const nome = basename(caminho)
  const filhos = (await notionReq(`blocks/${page_id}/children?page_size=100`)).results || []
  if (filhos.some(b => nomeDoBloco(b) === nome)) return { ok: true, acao: 'ja_anexado', nome, propriedade: '' }
  let id
  try { id = await subir(caminho) } catch (e) { throw Object.assign(e, { codigo: e?.status ? `notion_${e.status}` : 'upload_falhou' }) }
  const primeiro = filhos[0]?.id
  const children = primeiro ? [blocoArquivo(id, nome)] : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Documento do relatório (PDF)' }, annotations: { bold: true } }] } }, blocoArquivo(id, nome)]
  try { await notionReq(`blocks/${page_id}/children`, { method: 'PATCH', body: { children, ...(primeiro ? { after: primeiro } : {}) } }) }
  catch (e) { throw Object.assign(e, { codigo: e?.status ? `notion_${e.status}` : 'anexo_falhou' }) }
  // linha de quadro com propriedade do tipo files → grava também lá, com o mesmo file_upload (se o Notion recusar reutilizar o upload, sobe de novo uma vez)
  let propriedade = ''
  try {
    const pg = await notionReq(`pages/${page_id}`)
    const ds = pg?.parent?.data_source_id || pg?.parent?.database_id
    if (ds) {
      const esq = await notionReq(`${pg.parent.data_source_id ? 'data_sources' : 'databases'}/${ds}`)
      const prop = Object.entries(esq?.properties || {}).find(([k, p]) => p?.type === 'files' && PROPS_FILES.includes(normNome(k).trim()))
      if (prop) {
        const gravar = fid => notionReq(`pages/${page_id}`, { method: 'PATCH', body: { properties: { [prop[0]]: { files: [{ type: 'file_upload', file_upload: { id: fid }, name: nome }] } } } })
        try { await gravar(id) } catch (e) { if (e?.status !== 400) throw e; await gravar(await subir(caminho)) }
        propriedade = prop[0]
      }
    }
  } catch { propriedade = '' }                                     // o bloco já está na página: a propriedade é melhor esforço
  return { ok: true, acao: 'anexado', nome, propriedade }
}
