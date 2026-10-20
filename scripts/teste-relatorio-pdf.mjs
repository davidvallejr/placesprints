// Autoteste do documento (PDF) do Relatório de Sprints (src/lib/relatorio-pdf.js): HTML das mesmas seções do brief sem vazamento (auditor de relatorio-seguro),
// tarefas concluídas listadas, PDF com stub do Chrome (sem Chrome = pdf_indisponivel), anexo com stub do upload (topo da página, idempotente, propriedade files),
// e o envio (relatorio-envio.js) que NUNCA é desfeito quando o PDF/upload falha. Nenhum Chrome, nenhuma rede. Rodar: node scripts/teste-relatorio-pdf.mjs
import assert from 'node:assert/strict'
import { briefParaHtml, blocosParaHtml, gerarPdf, anexarPdf, caminhoPdf, slug } from '../src/lib/relatorio-pdf.js'
import { briefParaBlocos } from '../src/lib/relatorio-notion.js'
import { auditarTexto, auditarBlocos } from '../src/lib/relatorio-seguro.js'
import { briefSintetico, montarEnvio, confirmar, linhasEnvio, SEGREDO } from './fixtures/relatorio-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const semTags = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ')
const NOMES = ['Giovanna Torres', 'Carla Souza']

await ok('briefParaHtml: as mesmas seções do brief, tarefas concluídas listadas, nome do cliente na capa, HTML autocontido no estilo editorial', () => {
  const B = briefSintetico('Acme'), html = briefParaHtml(B, { cliente: 'Acme' })
  assert.ok(html.startsWith('<!doctype html>') && html.includes('<style>') && html.includes('--accent:#ff6b1a'), 'estilo editorial embutido')
  const t = semTags(html)
  for (const sec of ['Resultados', 'Atividades', 'Concluído', 'Em andamento', 'Desenvolvimento', 'Próximos passos', 'Depende de você', 'Conta em crescimento']) assert.ok(t.includes(sec), sec)
  for (const tarefa of ['Novas fotos do kit de jardinagem', 'Revisão de títulos (x4)', 'Ficha técnica da linha de mangueiras']) assert.ok(t.includes(tarefa), tarefa)
  assert.ok(t.includes('Faturamento') && t.includes('R$ 14.920,00') && t.includes('▲ 11,3%'), 'tabela de resultados')
  assert.ok(html.includes('<table>') && html.includes('<th><span>Indicador</span></th>'), 'resultados em tabela')
  assert.ok(t.includes('Acme') && t.includes('Fotos do produto: enviar as fotos do kit novo'), 'capa com o cliente; depende de você')
  for (const r of B.rodape) assert.ok(t.includes(r.replace(/\s+/g, ' ')), 'rodapé: ' + r)
  assert.ok(!html.includes('undefined') && !html.includes('[object'), 'nenhum undefined')
  // o texto é o dos blocos auditados: mesma projeção, nenhum texto novo
  const linhasBlocos = briefParaBlocos(B).flatMap(b => (b[b.type].rich_text || []).map(x => x.text.content)).filter(x => x.trim().length > 12)
  for (const l of linhasBlocos.slice(0, 12)) assert.ok(t.includes(l.replace(/\s+/g, ' ').trim()), 'bloco presente no HTML: ' + l.slice(0, 40))
})

await ok('sem vazamento: o texto do HTML passa pelo auditor (nome interno, ID, jargão); brief com _interno não vaza; o escape protege contra HTML no brief', () => {
  const B = briefSintetico('Acme', { extra: { _interno: { avisos: ['Giovanna Torres falou'], segredo: SEGREDO } } })
  const html = briefParaHtml(B, { cliente: 'Acme' })
  assert.ok(!html.includes(SEGREDO) && !html.includes('Giovanna'), '_interno nunca sai')
  assert.deepEqual(auditarTexto(semTags(html), { nomesInternos: NOMES, permitidos: ['Acme'] }).map(v => v.codigo).filter(c => c !== 'limite'), [], 'texto visível limpo (limite: o teste junta a página inteira num parágrafo)')
  const Bx = briefSintetico('Acme', { extra: { abertura: { tom: 'verde', cabecalho: '<script>alert(1)</script>', frase: 'x & y' } } })
  const h2 = briefParaHtml(Bx, { cliente: 'A<b>' })
  assert.ok(!h2.includes('<script>') && h2.includes('&lt;script&gt;') && h2.includes('x &amp; y') && h2.includes('A&lt;b&gt;'), 'escape')
  assert.equal(blocosParaHtml([{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'a' } }] } }, { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'b' } }] } }, { type: 'divider', divider: {} }]), '<ul>\n<li><span>a</span></li>\n<li><span>b</span></li>\n</ul>\n<hr>')
})

await ok('caminho do PDF: <cliente-normalizado>-<de>-<ate>.pdf em data/relatorios/pdf; sem Chrome = erro pdf_indisponivel (classificado, sem arquivo); stub do Chrome recebe os mesmos argumentos do server.js', async () => {
  assert.equal(slug('Açaí & Cia Ltda.'), 'acai-cia-ltda'); assert.equal(slug(''), 'cliente')
  assert.match(caminhoPdf({ cliente: 'Loja São João', de: '2026-10-02', ate: '2026-10-08' }), /\/data\/relatorios\/pdf\/loja-sao-joao-2026-10-02-2026-10-08\.pdf$/)
  const dir = '/tmp/relatorio-pdf-teste-' + process.pid, destino = caminhoPdf({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15' }, dir)
  let e; try { await gerarPdf('<html></html>', destino, { chrome: '/nao/existe/Chrome' }) } catch (x) { e = x }
  assert.equal(e?.codigo, 'pdf_indisponivel')
  const { existsSync, writeFileSync, rmSync } = await import('node:fs')
  let args
  const exec = (bin, a, o, cb) => { args = a; writeFileSync(destino, '%PDF-stub'); cb(null) }
  try {
    assert.equal(await gerarPdf('<html>x</html>', destino, { chrome: process.execPath, exec, timeout_ms: 1234 }), destino)
    assert.deepEqual(args.slice(0, 4), ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=9000']); assert.ok(args[4].startsWith('--user-data-dir='), 'perfil temporário por execução (15/10)'); assert.equal(args[5], `--print-to-pdf=${destino}`); assert.ok(args[6].startsWith('file://') && args[6].endsWith('.html'))
    assert.ok(!existsSync(destino.replace(/\.pdf$/, '.html')), 'o HTML intermediário é apagado')
    let e2; try { await gerarPdf('<html></html>', destino, { chrome: process.execPath, exec: (b, a, o, cb) => cb(Object.assign(new Error('x'), { killed: true })) }) } catch (x) { e2 = x }
    assert.equal(e2?.codigo, 'pdf_timeout')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// mundo do Notion: página com 3 blocos; `subir` stub conta uploads
function mundoAnexo({ files = false, filhos = 3, parent = 'data_source' } = {}) {
  const chamadas = [], blocos = Array.from({ length: filhos }, (_, i) => ({ id: `b${i}`, type: 'paragraph', paragraph: { rich_text: [] } }))
  let uploads = 0, recusar400 = false
  const notionReq = async (caminho, { method = 'GET', body } = {}) => {
    chamadas.push({ caminho, method, body })
    if (method === 'GET' && caminho.startsWith('blocks/pg1/children')) return { results: blocos }
    if (method === 'PATCH' && caminho === 'blocks/pg1/children') { const pos = body.after ? blocos.findIndex(b => b.id === body.after) : -1; blocos.splice(pos >= 0 ? pos + 1 : blocos.length, 0, ...body.children.map((b, i) => ({ id: `n${blocos.length + i}`, ...b }))); return { results: [] } }
    if (method === 'GET' && caminho === 'pages/pg1') return { id: 'pg1', parent: parent === 'data_source' ? { type: 'data_source_id', data_source_id: 'ds1' } : { type: 'page_id', page_id: 'p0' } }
    if (method === 'GET' && caminho === 'data_sources/ds1') return { properties: { Name: { type: 'title' }, ...(files ? { Anexos: { type: 'files' } } : {}), Outro: { type: 'files' } } }
    if (method === 'PATCH' && caminho === 'pages/pg1') { if (recusar400) { recusar400 = false; throw Object.assign(new Error('400'), { status: 400 }) } return { id: 'pg1' } }
    throw Object.assign(new Error('500'), { status: 500 })
  }
  const subir = async () => `fu${++uploads}`
  return { notionReq, subir, chamadas, blocos, uploads: () => uploads, recusar: () => { recusar400 = true } }
}

await ok('anexarPdf: sobe o PDF e insere o bloco file logo depois do 1º bloco (topo), com name = nome do arquivo; idempotente (2ª vez: ja_anexado, sem upload)', async () => {
  const m = mundoAnexo()
  const r = await anexarPdf({ notionReq: m.notionReq, page_id: 'pg1', caminho: '/x/acme-2026-10-09-2026-10-15.pdf', subir: m.subir })
  assert.deepEqual(r, { ok: true, acao: 'anexado', nome: 'acme-2026-10-09-2026-10-15.pdf', propriedade: '' })
  assert.equal(m.blocos[1].type, 'file'); assert.deepEqual(m.blocos[1].file, { type: 'file_upload', file_upload: { id: 'fu1' }, name: 'acme-2026-10-09-2026-10-15.pdf' })
  const patch = m.chamadas.find(c => c.method === 'PATCH' && c.caminho === 'blocks/pg1/children'); assert.equal(patch.body.after, 'b0')
  assert.equal(m.uploads(), 1)
  const r2 = await anexarPdf({ notionReq: m.notionReq, page_id: 'pg1', caminho: '/outro/dir/acme-2026-10-09-2026-10-15.pdf', subir: m.subir })
  assert.equal(r2.acao, 'ja_anexado'); assert.equal(m.uploads(), 1); assert.equal(m.blocos.filter(b => b.type === 'file').length, 1)
  // página vazia: no fim, com cabeçalho
  const v = mundoAnexo({ filhos: 0, parent: 'page' })
  await anexarPdf({ notionReq: v.notionReq, page_id: 'pg1', caminho: '/x/a.pdf', subir: v.subir })
  assert.deepEqual(v.blocos.map(b => b.type), ['paragraph', 'file']); assert.equal(v.blocos[0].paragraph.rich_text[0].text.content, 'Documento do relatório (PDF)')
  assert.equal(v.chamadas.find(c => c.method === 'PATCH').body.after, undefined)
})

await ok('anexarPdf: linha de quadro com propriedade files (Anexos) também recebe o arquivo com o MESMO file_upload; se o Notion recusar reutilizar (400), sobe de novo uma vez; falha do upload sobe com código', async () => {
  const m = mundoAnexo({ files: true })
  const r = await anexarPdf({ notionReq: m.notionReq, page_id: 'pg1', caminho: '/x/a.pdf', subir: m.subir })
  assert.equal(r.propriedade, 'Anexos'); assert.equal(m.uploads(), 1)
  const prop = m.chamadas.find(c => c.method === 'PATCH' && c.caminho === 'pages/pg1'); assert.deepEqual(prop.body, { properties: { Anexos: { files: [{ type: 'file_upload', file_upload: { id: 'fu1' }, name: 'a.pdf' }] } } })
  const m2 = mundoAnexo({ files: true }); m2.recusar()
  const r2 = await anexarPdf({ notionReq: m2.notionReq, page_id: 'pg1', caminho: '/x/b.pdf', subir: m2.subir })
  assert.equal(r2.propriedade, 'Anexos'); assert.equal(m2.uploads(), 2, 'reupload só depois do 400')
  const m3 = mundoAnexo()
  let e; try { await anexarPdf({ notionReq: m3.notionReq, page_id: 'pg1', caminho: '/x/c.pdf', subir: async () => { throw new Error('rede') } }) } catch (x) { e = x }
  assert.equal(e?.codigo, 'upload_falhou'); assert.equal(m3.blocos.length, 3, 'nada inserido')
})

await ok('envio: depois de criar a página, o PDF do MESMO brief é gerado e anexado (anexo: ok; relatorio_envio.anexo = ok); falha do Chrome/upload = aviso, o envio fica de pé', async () => {
  const m = montarEnvio()
  const r = await confirmar(m.e, 'Acme')
  assert.deepEqual([r.ok, r.estado, r.anexo], [true, 'enviado', 'ok'])
  assert.equal(m.w.pdfs.length, 1); assert.match(m.w.pdfs[0].destino, /acme-2026-10-09-2026-10-15\.pdf$/); assert.ok(m.w.pdfs[0].html.includes('Conta em crescimento'))
  assert.equal(m.w.uploads.length, 1)
  const pg = m.w.paginasDs.get(m.w.cfgCli.get('Acme').ds_id)[0]
  assert.equal(pg.body.children[1].type, 'file', 'bloco file no topo (depois da abertura)')
  assert.equal(linhasEnvio(m.h)[0].anexo, 'ok')
  // Chrome ausente: envio ok, anexo falhou:pdf_indisponivel, nenhum upload
  const f = montarEnvio({ clientes: [['Beta', {}]] }); f.w.falhas.pdf.push('pdf_indisponivel')
  const rf = await confirmar(f.e, 'Beta')
  assert.deepEqual([rf.ok, rf.estado, rf.anexo], [true, 'enviado', 'falhou:pdf_indisponivel']); assert.equal(f.w.uploads.length, 0)
  assert.deepEqual([linhasEnvio(f.h)[0].estado, linhasEnvio(f.h)[0].anexo], ['enviado', 'falhou:pdf_indisponivel'])
  assert.ok(f.logs.some(l => l.includes('anexo do PDF pdf_indisponivel')))
  // upload recusado (403): envio ok, anexo falhou:notion_403, sem eco do corpo
  const u = montarEnvio({ clientes: [['Gama', {}]] }); u.w.falhas.upload.push(403)
  const ru = await confirmar(u.e, 'Gama')
  assert.deepEqual([ru.ok, ru.estado, ru.anexo], [true, 'enviado', 'falhou:notion_403']); assert.ok(!JSON.stringify(ru).includes(SEGREDO))
  // desligado na config: nada de PDF, sem a chave anexo
  const d = montarEnvio({ clientes: [['Delta', {}]], cfg: { anexo_pdf: { ligado: false, timeout_ms: 60000 } } })
  const rd = await confirmar(d.e, 'Delta'); assert.equal(rd.ok, true); assert.equal('anexo' in rd, false); assert.equal(d.w.pdfs.length, 0)
})

await ok('anexar (reanexo): prévia não grava; confirmar exige por válido e a MESMA janela; idempotente na página; lote por data vira job', async () => {
  const m = montarEnvio({ clientes: [['Acme', {}], ['Beta', {}]] })
  m.w.falhas.pdf.push('pdf_falhou')
  const r = await confirmar(m.e, 'Acme'); assert.equal(r.anexo, 'falhou:pdf_falhou')
  const pv = await m.e.anexar({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres' })
  assert.deepEqual([pv.ok, pv.previa, pv.anexo_atual, pv.faria], [true, true, 'falhou:pdf_falhou', 'anexar']); assert.equal(m.w.uploads.length, 0)
  await assert.rejects(() => m.e.anexar({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Fulano', confirmar: true }), e => e.status === 403)
  await assert.rejects(() => m.e.anexar({ cliente: 'Acme', de: 'x', ate: '2026-10-15', por: 'Giovanna Torres' }), e => e.status === 400)
  assert.equal((await m.e.anexar({ cliente: 'Beta', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres', confirmar: true })).estado, 'sem_envio')
  const rc = await m.e.anexar({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual([rc.ok, rc.estado, rc.anexo], [true, 'anexado', 'ok']); assert.equal(linhasEnvio(m.h)[0].anexo, 'ok'); assert.equal(m.w.uploads.length, 1)
  const rc2 = await m.e.anexar({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres', confirmar: true })
  assert.equal(rc2.anexo, 'ok'); assert.equal(m.w.uploads.length, 1, 'idempotente: já existe o bloco com o mesmo nome')
  // janela diferente: o dia mudou → o brief de hoje cobre outro período
  m.relogio.ir('2026-10-20', '10:00')
  assert.equal((await m.e.anexar({ cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres', confirmar: true })).estado, 'janela_diferente')
  m.relogio.ir('2026-10-16', '17:00')
  // lote: Beta enviado com anexo falho → entra; Acme ok → não entra
  m.w.falhas.pdf.push('pdf_falhou'); await confirmar(m.e, 'Beta')
  const lp = m.e.anexarLote({ desde: '2026-10-16', por: 'Carla Souza' })
  assert.deepEqual(lp.itens.map(i => i.cliente), ['Beta']); assert.equal(lp.previa, true)
  assert.deepEqual(m.e.anexarLote({ desde: '2026-10-17', por: 'Carla Souza', confirmar: true }).estado, 'nada_a_anexar')
  const j = m.e.anexarLote({ desde: '2026-10-16', por: 'Carla Souza', confirmar: true }).job
  await new Promise(r => setTimeout(r, 50))
  const jf = m.e.jobDe(j.id); assert.equal(jf.estado, 'concluido'); assert.deepEqual(jf.itens.map(i => [i.cliente, i.estado]), [['Beta', 'anexado']]); assert.equal(jf.resumo, '1 anexados · 0 com problema')
  assert.equal(linhasEnvio(m.h).find(l => l.cliente === 'Beta').anexo, 'ok')
})

console.log(`\n${n} blocos OK — documento PDF do relatório`)
