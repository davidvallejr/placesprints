// Autoteste da PRESTAÇÃO DE CONTAS e do DOSSIÊ DE DEFESA (Etapa 2: src/lib/dossie.js, render-dossie.js, rotas em src/rotas-dossie.js).
// Montagem com dados sintéticos: números iguais às fontes (mês a mês, dia sem coleta não é zero, conversão só com visitas cobertas), versão cliente sem "causa",
// sem confidencial, sem obstrução/culpa; versão defesa com as 9 perguntas, PENDENTE de contrato → INCOMPLETO, COMPLETO com as provas, varredura acha as frases
// plantadas (card e texto enviado) com o limite declarado, cronologia do livro com seq/hash, inventário com hashes. Arquivos: PDF com stub do Chrome, .doc com os
// cabeçalhos do Word e mime application/msword, sha256 conferido e registro no livro; falha do PDF não derruba. HTTP: 415/403/404, download só no loopback, defesa
// nunca ao Notion nem em host público. Mensal: só com a chave ligada, só dia 1 a partir das 09:00, só risco aberto, idempotente, falha avisa no sino, PDF grande fica fora.
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes do import do db.js), pasta temporária apagada no fim; nada vai à rede. Rodar: node scripts/teste-dossie.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { montarDossie, criarDossies, varrerAdmissao, mesAnterior, addDias, auditarCliente, valMud } from '../src/lib/dossie.js'
import { htmlPdf, htmlDoc, gerarArquivos, paraRtf, TOKENS } from '../src/lib/render-dossie.js'
import { criarLivro } from '../src/lib/livro-registro.js'
import { criarRisco } from '../src/lib/risco-cliente.js'
import { criarContratos } from '../src/lib/contrato-cliente.js'
import { criarRotasDossie } from '../src/rotas-dossie.js'
import { guardaLocal, ROTA_PUBLICA, ROTA_PUBLICA_COMERCIAL, ROTA_PUBLICA_S90 } from '../src/lib/guarda-local.js'
const { db } = await import('../src/lib/db.js')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const sha = b => createHash('sha256').update(b).digest('hex')
const raiz = mkdtempSync(join(tmpdir(), 'dossie2-'))
process.on('exit', () => rmSync(raiz, { recursive: true, force: true }))
const RAIZ_PROJ = new URL('..', import.meta.url).pathname
const CFG = JSON.parse(readFileSync(join(RAIZ_PROJ, 'config', 'dossie.json'), 'utf8'))
const HOJE = '2026-10-13', DE = '2026-08-01', ATE = '2026-10-12'
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const QUEM = ['Giovanna Torres', 'Ana Paula (CS)'], LIDERES = ['Giovanna Torres']
const validarPor = nome => QUEM.find(x => norm(x) === norm(nome)) || ''
const validarChave = nome => LIDERES.find(x => norm(x) === norm(nome)) || ''
const textos = o => typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(textos) : o && typeof o === 'object' ? Object.values(o).flatMap(textos) : []
const corpoTexto = html => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
const secao = (d, id) => d.secoes.find(s => s.id === id)

// ── mundo sintético (o que o coletor real entrega) ────────────────────────────────────────────────────────
const png = join(raiz, 'evidencias', 't1', 'a.png'); mkdirSync(join(raiz, 'evidencias', 't1'), { recursive: true })
writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('print')]))
function mundo() {
  const coleta = [], serie = []
  for (let d = '2026-07-01'; d <= '2026-10-12'; d = addDias(d, 1)) {
    if (d === '2026-08-15') continue                                                          // dia SEM coleta: nunca vira zero
    coleta.push({ dia: d, pedidos: d < '2026-09-01' ? 4 : 6, truncado: 0 })
    serie.push({ item_id: 'MLB111', dia: d, unidades: 2, receita: 100, visitas: 40 }, { item_id: 'MLB222', dia: d, unidades: 1, receita: 59.9, visitas: 0 })
  }
  serie.push({ item_id: 'MLB111', dia: '2026-08-15', unidades: 0, receita: 0, visitas: 35 })     // só visitas no dia sem coleta de pedidos
  return {
    hoje: HOJE, equipe: { consultor: 'Giovanna Torres', cs: 'Ana Paula (CS)' }, coleta, serie,
    itens: [{ item_id: 'MLB111', titulo: 'Coleira Peitoral Azul', status: 'active', vis_de: '2026-06-01', vis_ate: '2026-10-13' }, { item_id: 'MLB222', titulo: 'Guia Retrátil', status: 'paused', vis_de: '', vis_ate: '' }],
    tarefas: [
      { id: 't1', titulo: 'Otimizar título MLB111', processo: 'Mercado Livre', responsavel: 'Giovanna Torres', status: 'concluida', data_inicio: '2026-08-03', data_conclusao: '2026-08-05', tipo_demanda: 'Otimizar Anúncios', etiquetas: '', prioridade: 'Solicitação Seller', itens: ['MLB111'], anexos: 2, texto: '' },
      { id: 't2', titulo: 'Duplicar anúncio MLB111', processo: 'Mercado Livre', responsavel: 'Sara Souza', status: 'concluida', data_inicio: '2026-09-10', data_conclusao: '2026-09-12', tipo_demanda: 'Duplicar anúncios', itens: ['MLB111', 'MLB222'], texto: 'Ajuste feito. Foi um erro nosso no título anterior.' },
      { id: 't3', titulo: 'Cadastro Shopee kit', processo: 'Shopee', responsavel: 'Michele Souza', status: 'concluida', data_inicio: '2026-09-01', data_conclusao: '2026-09-02', tipo_demanda: 'Cadastro de Produtos', itens: [], texto: '' },
      { id: 't4', titulo: 'Fotos novas do kit', processo: 'Mercado Livre', responsavel: 'Giovanna Torres', status: 'dependencia_cliente', status_raw: 'Aguardando Devolutiva do Cliente', data_inicio: '2026-09-20', data_conclusao: '', itens: [], texto: '' },
      { id: 't5', titulo: 'Concluída sem data', processo: 'TikTok', responsavel: 'Iara', status: 'concluida', data_inicio: '2026-08-20', data_conclusao: '', itens: [], texto: '' },
    ],
    evidencias: [{ tarefa_id: 't1', abs: png, arquivo: 'evidencias/t1/a.png', bytes: 13, sha256: sha(readFileSync(png)), criada_em: '2026-08-05T10:00:00.000Z' },
      { tarefa_id: 't3', abs: png, arquivo: 'evidencias/t3/b.png', bytes: 13, sha256: sha(readFileSync(png)), criada_em: '2026-09-02T10:00:00.000Z' }], evidencias_total: 3,
    medidas: [
      { id: 't1', titulo: 'Otimizar título MLB111', data: '2026-08-05', itens: ['MLB111'], estado: 'melhorou', efeito_pct: 22.5, controle: { razao: 1.05 },
        metricas: { receita: { antes: 100, depois: 130 }, unidades: { antes: 2, depois: 2.6 }, visitas: { antes: 40, depois: 44 }, conversao: { antes: 5, depois: 5.9 } },
        janelas: { pre: ['2026-07-22', '2026-08-04'], pos: ['2026-08-09', '2026-08-22'], pos_medida: ['2026-08-09', '2026-08-22'] } },
      { id: 't2', titulo: 'Duplicar anúncio MLB111', data: '2026-09-12', itens: ['MLB111'], estado: 'em_maturacao', controle: null, janelas: {} },
    ],
    mudancas: [{ item_id: 'MLB222', dia: '2026-09-01', campo: 'titulo', de: 'Guia', para: 'Guia Retrátil 5m', fonte: 'coleta' }, { item_id: 'MLB222', dia: '2026-09-20', campo: 'status', de: 'active', para: 'paused', fonte: 'coleta' }],
    ads: [{ item_id: 'MLB111', periodo: 'atual', de: '2026-09-15', ate: '2026-10-12', prints: 1000, clicks: 50, custo: 80, receita: 400, unidades: 4 }],
    economia: null, saude: { dia: '2026-10-12', level_id: '5_green' },
    relatorios: [{ id: 1, de: '2026-09-01', ate: '2026-09-07', estado: 'enviado', em: '2026-09-08T20:00:00.000Z' }],
    lotes: [{ id: 7, tipo: 'semanal', estado: 'enviado', enviado_em: '2026-09-15T12:00:00.000Z', canais: ['whatsapp'], recibos: { whatsapp: 'entregue' }, texto: 'Plano da semana. Desculpe o erro na semana passada.' }],
    cobrancas: [{ id: 9, tipo: 'custos_nao_informados', texto: 'Precisamos dos custos para calcular a margem', enviado_em: '2026-09-22T12:00:00.000Z', resolvido_em: '' }],
    resumos: [], respostas: [{ recebido_em: '2026-09-16T10:00:00.000Z', ancora_tipo: 'plano', confianca: 'certa', temas: ['estoque_reposicao'] }],
    pendencias: { itens: [{ rotulo: 'Custos e preços', canal_rotulo: 'Mercado Livre', desde: '2026-09-20', desde_aproximado: false, gravidade: 'atencao', gravidade_rotulo: 'Atenção', evidencia: 'Custos não informados', o_que_precisamos: 'Envie a planilha de custos.' }],
      registros: [], dependencias: [{ tarefa_id: 't4', tipo: 'fotos', em: '2026-09-20T10:00:00.000Z', reaberta_em: '' }] },
    plano: [{ titulo: 'Repor estoque do MLB111', responsavel: 'Giovanna Torres', prazo: '2026-10-20', status: 'aprovada', score: 80 }],
    contrato: null, pagamentos: [], riscos: [], conta_ml: { erro: '', atualizado_em: '2026-10-01' },
    livro: { itens: [{ seq: 3, fato_em: '2026-08-05', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'tarefa_concluida', resumo: 'Tarefa concluída no Notion: «Otimizar título MLB111»', prova: 'https://www.notion.so/t1', hash: 'a'.repeat(64) },
      { seq: 4, fato_em: '', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'anexo_tarefa', resumo: 'Anexo (image) no card «Otimizar título MLB111»: 1', prova: `arquivo:evidencias/t1/a.png#sha256:${'b'.repeat(64)}`, hash: 'c'.repeat(64) },
      { seq: 5, fato_em: '', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'anexo_tarefa', resumo: 'Anexo (image) no card «Otimizar título MLB111»: 2', prova: `arquivo:evidencias/t1/b.png#sha256:${'d'.repeat(64)}`, hash: 'e'.repeat(64) },
      { seq: 6, fato_em: '', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'anexo_tarefa', resumo: 'Anexo (image) no card «Outro card»', prova: '', hash: 'f'.repeat(64) }],
      cabeca: { seq: 6, hash: 'f'.repeat(64) }, verificacao: { ok: true, quebra: null, lacunas: 0 } },
  }
}
const somaMes = (m, campo, dados) => { const dias = new Set(dados.coleta.filter(c => c.dia.startsWith(m)).map(c => c.dia)); return dados.serie.filter(s => dias.has(s.dia)).reduce((t, s) => t + s[campo], 0) }

// ═══ montagem ═══════════════════════════════════════════════════════════════════════════════════════════
await ok('versão cliente: números mês a mês iguais às fontes (dia sem coleta não é zero; conversão só nos anúncios com visitas no mês inteiro)', () => {
  const M = mundo(), d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M)
  const ago = d.numeros.meses.find(m => m.mes === '2026-08')
  assert.equal(ago.coletados, 30, '15/08 sem coleta')
  assert.equal(ago.receita, Math.round(somaMes('2026-08', 'receita', M) * 100) / 100)
  assert.equal(ago.receita, 4797)
  assert.equal(ago.pedidos, M.coleta.filter(c => c.dia.startsWith('2026-08')).reduce((t, c) => t + c.pedidos, 0))
  assert.equal(ago.unidades, somaMes('2026-08', 'unidades', M))
  assert.equal(ago.visitas, 30 * 40 + 35, 'MLB111 cobre o mês; MLB222 sem visitas coletadas fica fora')
  assert.equal(ago.conversao, Math.round(10000 * 60 / 1235) / 100)
  const out = d.numeros.meses.find(m => m.mes === '2026-10')
  assert.deepEqual([out.coletados, out.dias, out.receita], [12, 12, 1918.8])
  assert.equal(d.numeros.total.receita, Math.round(d.numeros.meses.reduce((t, m) => t + m.receita, 0) * 100) / 100)
  assert.deepEqual([d.numeros.tarefas_concluidas, d.numeros.tarefas_concluidas_ml, d.numeros.mlbs_distintos, d.numeros.intervencoes], [3, 2, 2, 3])
  assert.equal(d.numeros.solicitacoes, 1); assert.equal(d.numeros.exemplos, 2, '1 medição com controle + 1 mudança de título com as duas janelas coletadas')
  assert.equal(d.numeros.ritmo_pct, 0, 'ritmo = média diária do último ÷ primeiro mês (159,90/dia nos dois)')
  assert.deepEqual(d.numeros.ads, [{ de: '2026-09-15', ate: '2026-10-12', custo: 80, receita: 400 }])
  assert.deepEqual([d.status, d.pendencias], ['n/a', []])
  assert.deepEqual(d.secoes.map(s => s.num), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18'])
  assert.ok(d.secoes.every(s => s.id === 'fontes' || s.fonte), 'nota de fonte em cada seção')
})

await ok('versão cliente: tom — sem "causa", sem confidencial, sem obstrução/culpa; ressalva de associação; ausente = "—" com motivo', () => {
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, mundo())
  const t = textos(d).join('\n'), html = corpoTexto(htmlPdf(d))
  for (const s of [t, html]) {
    assert.doesNotMatch(s, /\bcausa\b|causa confirmada|causou|graças a/i)
    assert.doesNotMatch(s, /confidencial|jur[ií]dico/i)
    assert.doesNotMatch(s, /obstru|culpa|n[ãa]o respond/i)
  }
  assert.match(t, /não equivale à comprovação de causalidade/)
  assert.match(t, /Conclusão correta: é possível demonstrar trabalho contínuo/)
  assert.match(t, /Canceladas: — \(a coleta registra só pedidos pagos/)
  assert.match(t, /Não validado/, 'sem custos = rentabilidade não validada')
  assert.match(t, /Campanha: não suportado/)
  assert.match(t, /Concluído comprova o encerramento no Notion; a prova técnica de cada edição exige o histórico do Mercado Livre/)
  assert.ok(!secao(d, 'comunicacao').blocos.some(b => b.t === 'tabela' && b.linhas.some(l => /Resumo interno/.test(l[1]))), 'resumo interno ao time nunca na versão cliente')
  const dep = secao(d, 'depende').blocos.find(b => b.t === 'tabela')
  assert.deepEqual(dep.cab, ['Item', 'Canal', 'Desde', 'O que precisamos']); assert.equal(dep.linhas[0][3], 'Envie a planilha de custos.')
  const ev = secao(d, 'evidencias').blocos[1]
  assert.equal(ev.t, 'tabela', 'cliente: nenhum print embutido (pode ser tela interna); só tarefa, data e sha256')
  assert.deepEqual(ev.linhas.map(l => [l[0], l[2]]), [['Otimizar título MLB111', sha(readFileSync(png)).slice(0, 12)], ['Cadastro Shopee kit', sha(readFileSync(png)).slice(0, 12)]])
  assert.ok(!JSON.stringify(d).includes('evidencias/t1/a.png') && !htmlPdf(d).includes('<img') && !htmlDoc(d).includes('evidencias/'), 'nem imagem nem caminho interno na versão cliente')
  assert.match(secao(d, 'evidencias').blocos[0].texto, /Cada um tem a impressão digital \(sha256\) registrada no livro/)
  // print que a passada do livro ainda não registrou: a seção 08 conta de verdade, nunca afirma o hash no livro para todos
  const M8 = mundo(); M8.evidencias[1].no_livro = false
  const d8 = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M8)
  assert.match(secao(d8, 'evidencias').blocos[0].texto, /1 de 2 já têm a impressão digital \(sha256\) registrada no livro/); assert.equal(d8.numeros.evidencias_no_livro, 1)
})

await ok('versão defesa: 9 perguntas, contrato ausente = PENDENTE crítico → INCOMPLETO; varredura acha as frases plantadas com o limite; cronologia e inventário com hash', () => {
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, mundo())
  assert.deepEqual(d.secoes.map(s => s.num), ['D1', 'D2', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', 'D3', 'D4', 'D5', 'D6', 'D7'])
  assert.equal(d.status, 'incompleto')
  const contrato = d.pendencias.find(p => p.id === 'contrato')
  assert.deepEqual([contrato.critico, contrato.responsavel, contrato.prazo], [true, 'Ana Paula (CS)', addDias(HOJE, CFG.prazo_pendencia_dias)])
  assert.ok(['pagamentos', 'gravacoes', 'conversas', 'revisar_frases'].every(id => d.pendencias.some(p => p.id === id && !p.critico)))
  const perg = secao(d, 'perguntas').blocos[0]
  assert.equal(perg.linhas.length, 9); assert.match(perg.linhas[0][0], /^1\. O contrato foi cumprido\?/); assert.match(perg.linhas[8][0], /^9\. O que falta trazer\?/)
  assert.equal(perg.linhas[0][2], 'PARCIAL', 'sem contrato, mas com execução')
  assert.match(perg.linhas[8][1], /Contrato assinado .* Ana Paula \(CS\), até /)
  const t = textos(d).join('\n')
  assert.match(t, /INCOMPLETO — não enviar ainda/); assert.match(t, /obrigação de MEIO/)
  assert.deepEqual(d.numeros.admissao, { tarefas: 1, enviados: 1 })
  const v = secao(d, 'varredura')
  assert.equal(v.blocos[1].linhas.length, 2); assert.ok(v.blocos[1].linhas.some(l => /tarefa · Duplicar/.test(l[0]) && /foi um erro/.test(l[2]) && /erro nosso/.test(l[2]) && /título anterior/.test(l[3])))
  assert.ok(v.blocos[1].linhas.some(l => /plano semanal enviado/.test(l[0]) && l[2] === 'desculpe o erro'))
  assert.match(t, /conversas da equipe no WhatsApp\/Discord não são lidas pelo sistema/)
  const cron = secao(d, 'cronologia').blocos.find(b => b.t === 'tabela')
  assert.deepEqual(cron.linhas.map(l => [l[0], l[5]]), [['3', 'a'.repeat(12)], ['4–5', `${'c'.repeat(12)} … ${'e'.repeat(12)}`], ['6', 'f'.repeat(12)]], 'anexos do mesmo card no mesmo dia viram uma linha com o 1º e o último seq/hash')
  assert.match(cron.linhas[1][1], /sem data na fonte/); assert.match(cron.linhas[1][4], /^2 anexos no card «Otimizar título MLB111»/); assert.equal(cron.linhas[0][2], '13/10/2026', 'coluna «Entrou no livro»')
  const inv = secao(d, 'inventario').blocos[1]
  assert.deepEqual(inv.linhas, [['tarefa concluida', '1', '1'], ['anexo tarefa', '3', '2']])
  assert.equal(secao(d, 'evidencias').blocos[1].itens.length, 2, 'defesa: print de qualquer card concluído')
  assert.deepEqual(d.numeros.contatos, { envios: 3, verificaveis: 0, sem_resposta: 0, nao_verificaveis: 2 }, 'plano respondido em 1 dia; relatório no Notion e cobrança fora do alcance do coletor = não verificáveis, nunca silêncio')
  const bal = secao(d, 'balanco')
  assert.ok(bal.blocos.some(b => b.t === 'tabela' && b.linhas.some(l => l[1] === 'MLB222' && l[3] === 'nenhuma')), 'pausa sem tarefa da equipe na data')
  assert.match(htmlPdf(d), /CONFIDENCIAL — uso exclusivo interno\/jurídico/)
  assert.equal(d.capa.status, 'incompleto')
})

await ok('versão defesa: com contrato assinado, livro íntegro, execução e vendas coletadas → COMPLETO (o que falta é só não crítico)', () => {
  const M = mundo(); M.contrato = { inicio: '2026-06-01', fim: '', entregaveis: ['Otimização de anúncios', 'Relatório semanal'], obrigacao_meio: true, clausula_reembolso: 'Sem reembolso após 30 dias', arquivo: 'dossies/docs/x.pdf', arquivo_sha256: 'd'.repeat(64), atualizado_em: '2026-10-01T10:00:00.000Z' }
  M.pagamentos = [{ data: '2026-09-05', valor_centavos: 150000, referencia: 'set', arquivo: 'dossies/docs/p.pdf', sha256: 'e'.repeat(64) }]
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M)
  assert.equal(d.status, 'completo'); assert.ok(d.pendencias.every(p => !p.critico)); assert.ok(!d.pendencias.some(p => ['contrato', 'pagamentos', 'clausula_meio'].includes(p.id)))
  assert.equal(secao(d, 'perguntas').blocos[0].linhas[0][2], 'PARCIAL', 'contrato cumprido só vira PROVADO com a conferência item a item dos entregáveis')
  assert.ok(d.pendencias.some(p => p.id === 'conferencia_entregaveis' && !p.critico))
  const M2 = mundo(); M2.contrato = M.contrato; M2.livro = { ...M2.livro, verificacao: { ok: false, quebra: { seq: 3, motivo: 'conteudo' }, lacunas: 0 } }
  const d2 = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M2)
  assert.equal(d2.status, 'incompleto'); assert.ok(d2.pendencias.some(p => p.id === 'livro' && p.critico), 'cadeia quebrada = crítico')
})

await ok('varredura: sem acento e sem caixa, só frase inteira, trecho mascarado (sem telefone)', () => {
  const a = varrerAdmissao([{ fonte: 'x', texto: 'Ok. ESQUECEMOS de subir, liga (11) 98765-4321' }, { fonte: 'y', texto: 'Problemas internos do cliente' }, { fonte: 'z', texto: 'nossa culpabilidade' }], ['esquecemos', 'problema interno', 'nossa culpa'])
  assert.equal(a.length, 1); assert.equal(a[0].frase, 'esquecemos'); assert.doesNotMatch(a[0].trecho, /98765/)
})

await ok('varredura: frases no singular/informais («Eu esqueci de print do antes, sorry») são achadas; sem ocorrência, a pergunta 2 nunca diz PROVADO', () => {
  const real = 'Trazer informações relevantes sobre o produto no titulo e descrição. Eu esqueci de print do antes , sorry.'
  const a = varrerAdmissao([{ fonte: 'tarefa', texto: real }], CFG.frases_admissao)
  assert.equal(a.length, 1); assert.match(a[0].frase, /esqueci/); assert.match(a[0].frase, /sorry/)
  assert.equal(varrerAdmissao([{ fonte: 'tarefa', texto: 'Errei o preço, falha minha. Me desculpe!' }], CFG.frases_admissao)[0].frase, 'errei, falha minha, me desculpe')
  const M = mundo(); M.tarefas[1].texto = ''; M.lotes[0].texto = 'Plano da semana.'
  const q2 = secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M), 'perguntas').blocos[0].linhas[1]
  assert.equal(q2[2], 'SEM OCORRÊNCIA NA VARREDURA (limite em D6)'); assert.match(q2[1], /não prova que não houve erro/); assert.doesNotMatch(q2[1], /Nenhum registro do sistema aponta falha/)
  const M2 = mundo(); M2.tarefas[1].texto = real
  assert.equal(secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M2), 'perguntas').blocos[0].linhas[1][2], 'ATENÇÃO')
})

await ok('cronologia: coluna «Entrou no livro», «registrado depois» só para data retroativa com o livro já funcionando, início do livro declarado (D1, D3, 18) e resposta descartada marcada como retratada', () => {
  const M = mundo()
  M.livro = { ...M.livro, primeiro_registro: '2026-10-13T12:00:00.000Z', retratadas: [{ ref: 'm1', em: '2026-10-14T10:00:00.000Z' }], itens: [
    { seq: 3, fato_em: '2026-08-05', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'tarefa_concluida', ref: 't1', resumo: 'Tarefa concluída no Notion: «A»', prova: '', hash: 'a'.repeat(64) },
    { seq: 9, fato_em: '2026-08-06', registrado_em: '2026-10-20T12:00:00.000Z', tipo: 'tarefa_concluida', ref: 't9', resumo: 'Tarefa concluída no Notion: «B»', prova: '', hash: 'b'.repeat(64) },
    { seq: 10, fato_em: '2026-09-16T10:00:00.000Z', registrado_em: '2026-10-13T12:00:00.000Z', tipo: 'resposta_cliente', ref: 'm1', resumo: 'Resposta do cliente ao relatório (citou a nossa mensagem)', prova: '', hash: 'c'.repeat(64) }] }
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M), t = secao(d, 'cronologia').blocos.find(b => b.t === 'tabela')
  assert.deepEqual(t.cab, ['Seq', 'Data do fato', 'Entrou no livro', 'Tipo', 'Fato', 'Hash'])
  assert.deepEqual(t.linhas.map(l => l[2]), ['13/10/2026', '20/10/2026 · registrado depois', '13/10/2026'], 'importado no 1º dia do livro não é «registrado depois»; card retroativo depois disso é')
  assert.match(t.linhas[2][4], /^\[RETRATADA — descartada pela equipe em 14\/10\/2026: não conta como resposta\]/)
  for (const id of ['status', 'cronologia']) assert.match(textos(secao(d, id)).join('\n'), /O livro deste cliente começou em 13\/10\/2026: os fatos com data anterior foram importados das fontes nesse dia. O hash prova que nada mudou DEPOIS/)
  assert.match(textos(secao(d, 'fontes')).join('\n'), /Livro de registro: começou em 13\/10\/2026; o que aconteceu antes foi importado/)
  assert.match(textos(secao(d, 'fontes')).join('\n'), /data da fonte, data de entrada no livro e hash/)
})

await ok('custos: sem pedido registrado = «sem registro de pedido» (nunca obstrução) + prova do pedido pendente; com cobrança = «aguardando o cliente»; tese condicional ao balanço', () => {
  const M = mundo(); M.cobrancas = []; M.pendencias = { ...M.pendencias, dependencias: [] }
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M)
  assert.deepEqual(secao(d, 'balanco').blocos[0].linhas.find(l => l[0].startsWith('Custos')).slice(1), ['não informados; nenhum pedido registrado no sistema', 'sem registro de pedido'])
  assert.ok(d.pendencias.some(p => p.id === 'pedido_custos' && !p.critico && p.item === 'Prova do pedido de custos ao cliente (print/e-mail)'))
  assert.match(textos(secao(d, 'status')).join('\n'), /Nenhuma dependência do cliente tem pedido registrado no sistema neste período \(D5\): este dossiê não atribui atraso ao cliente sem essa prova/)
  const d2 = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, mundo())
  assert.deepEqual(secao(d2, 'balanco').blocos[0].linhas.find(l => l[0].startsWith('Custos')).slice(1), ['não informados — pedido registrado em 22/09/2026 (1 cobrança enviada)', 'aguardando o cliente'])
  assert.ok(!d2.pendencias.some(p => p.id === 'pedido_custos'))
  assert.match(textos(secao(d2, 'status')).join('\n'), /o registro mostra quando foi pedido .*Custos/)
  const M3 = mundo(); M3.cobrancas = []; M3.pendencias = { ...M3.pendencias, registros: [{ id: 1, canal: 'ml', item: 'custos', desde: '2026-08-10', criada_em: '2026-08-10T10:00:00Z', resolvida_em: '' }] }
  assert.equal(secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M3), 'balanco').blocos[0].linhas.find(l => l[0].startsWith('Custos'))[2], 'aguardando o cliente', 'pendência de custos com data exata também é pedido')
})

await ok('9 perguntas: Q4 só conta resposta «certa» (provável fica à parte); Q8 sai das leituras do balanço (só «sem registro» = SEM REGISTRO)', () => {
  const M = mundo(); M.respostas = [{ recebido_em: '2026-09-16T10:00:00.000Z', ancora_tipo: 'pergunta', confianca: 'provavel', temas: ['vendas'] }]
  M.pendencias = { itens: [], registros: [], dependencias: [] }; M.cobrancas = []; M.mudancas = []; M.conta_ml = null; M.economia = null
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M), q = n => secao(d, 'perguntas').blocos[0].linhas[n - 1]
  assert.equal(q(4)[2], 'PARCIAL'); assert.match(q(4)[1], /1 resposta provável só pela janela de tempo \(não contam como prova\)/)
  assert.equal(q(8)[2], 'SEM REGISTRO', 'só «sem registro…» no balanço')
  const M2 = mundo(); assert.equal(secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M2), 'perguntas').blocos[0].linhas[3][2], 'PROVADO', 'resposta que citou a nossa mensagem')
})

await ok('feedback colhido pela EQUIPE em conversa (seed do perfil: origem equipe, «certa» só por causa do CHECK): nunca «citou a nossa mensagem», nunca PROVADO, nunca resposta a envio; linha própria', () => {
  const M = mundo(); M.respostas = [{ recebido_em: '2026-09-15', ancora_tipo: 'pergunta', confianca: 'certa', temas: ['vendas', 'critica'], origem: 'equipe' }]
  M.pendencias = { itens: [], registros: [], dependencias: [] }; M.coletor = { desde: '2026-09-01T00:00:00.000Z' }
  M.lotes = [{ id: 7, tipo: 'semanal', estado: 'enviado', enviado_em: '2026-09-15T12:00:00.000Z', canais: ['whatsapp'], recibos: {}, texto: 'Plano', ancora: true }]
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M), q4 = secao(d, 'perguntas').blocos[0].linhas[3]
  assert.notEqual(q4[2], 'PROVADO'); assert.match(q4[1], /^0 respostas que citaram a nossa mensagem; .*1 retorno colhido pela equipe em conversa \(registro da equipe, não é citação nem prova de resposta\)/)
  const bal = secao(d, 'balanco').blocos[0].linhas.find(l => l[0].startsWith('Respostas do cliente')); assert.equal(bal[2], 'sem registro'); assert.match(bal[1], /1 retorno colhido pela equipe em conversa \(não é citação\)/)
  assert.deepEqual(d.numeros.contatos, { envios: 3, verificaveis: 1, sem_resposta: 1, nao_verificaveis: 2 }, 'a conversa do dia 15 (só o dia) não conta como resposta ao plano das 12h')
  assert.equal(d.numeros.respostas, 0)
  const c = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M), t = JSON.stringify(c)
  assert.doesNotMatch(t, /pergunta do relatório/); assert.match(t, /Retornos colhidos pela equipe em conversa/); assert.match(t, /conversa com a equipe \(não é citação de mensagem\)/)
})

await ok('tentativas de contato: só envio-âncora do coletor, depois de ele começar e com a janela fechada, vira «sem resposta captada»; relatório no Notion, cobrança fora do lote-âncora e envio de hoje = não verificável; Q5 não é PROVADO só com isso', () => {
  const M = mundo(); M.respostas = []; M.coletor = { desde: '2026-09-01T00:00:00.000Z' }; M.pendencias = { itens: [], registros: [], dependencias: [] }
  M.lotes = [{ id: 7, tipo: 'semanal', estado: 'enviado', enviado_em: '2026-09-15T12:00:00.000Z', canais: ['whatsapp'], recibos: {}, texto: 'Plano', ancora: true },
    { id: 8, tipo: 'semanal', estado: 'enviado', enviado_em: '2026-10-12T12:00:00.000Z', canais: ['whatsapp'], recibos: {}, texto: 'Plano', ancora: true }]
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M)
  assert.deepEqual(d.numeros.contatos, { envios: 4, verificaveis: 1, sem_resposta: 1, nao_verificaveis: 3 })
  assert.deepEqual(secao(d, 'contato').blocos[1].linhas.map(l => l[2]), ['resposta não verificável pelo sistema', 'sem resposta captada em 7 dias', 'resposta não verificável pelo sistema', 'resposta não verificável pelo sistema'])
  const b = secao(d, 'balanco').blocos[0].linhas.find(l => l[0].startsWith('Envios sem resposta')); assert.equal(b[2], 'sem resposta captada (coletor limitado)'); assert.doesNotMatch(JSON.stringify(d), /silêncio registrado/)
  assert.equal(secao(d, 'perguntas').blocos[0].linhas[4][2], 'PARCIAL')
  const M2 = { ...M, coletor: { desde: '' } }
  assert.deepEqual(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M2).numeros.contatos, { envios: 4, verificaveis: 0, sem_resposta: 0, nao_verificaveis: 4 }, 'coletor sem leitura deste cliente = nada verificável')
})

await ok('plano de continuidade: só ação aprovada; cliente vê só o que está no prazo, com o dono (sua equipe) e sem status interno; defesa vê a vencida com a situação da tarefa', () => {
  const M = mundo(); M.plano = [
    { titulo: 'Repor estoque antes de zerar: Coleira (MLB111)', responsavel: '', prazo: '2026-10-09', status: 'distribuida', score: 90, caminho: null, tarefa_status: 'nao_iniciada', tarefa_prazo: null, tarefa_responsavel: 'Walkiria Paixão' },
    { titulo: 'Sugestão que ninguém aprovou', responsavel: '', prazo: '2026-10-20', status: 'proposta', score: 99 },
    { titulo: 'Informar os custos', responsavel: '', prazo: '2026-10-20', status: 'aprovada', score: 50, caminho: 'cliente' },
    { titulo: 'Ajustar título', responsavel: '', prazo: '2026-10-25', status: 'distribuida', score: 40, tarefa_status: 'andamento', tarefa_prazo: '2026-10-22', tarefa_responsavel: '' },
    { titulo: 'Já feita', responsavel: '', prazo: '2026-10-20', status: 'distribuida', score: 80, tarefa_status: 'concluida' }]
  const c = secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M), 'continuidade').blocos[0].linhas
  assert.deepEqual(c, [['Informar os custos', 'Sua equipe', '20/10/2026', 'aprovada, a iniciar'], ['Ajustar título', 'Giovanna Torres', '22/10/2026', 'em execução']])
  const d = secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M), 'continuidade').blocos[0].linhas
  assert.deepEqual(d.map(l => [l[1], l[2], l[3]]), [['Walkiria Paixão', '09/10/2026', 'tarefa não iniciada · VENCIDA'], ['Cliente', '20/10/2026', 'aprovada, a iniciar'], ['Giovanna Torres', '22/10/2026', 'tarefa em andamento']])
  M.plano = M.plano.slice(0, 2)
  const v = secao(montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M), 'continuidade')
  assert.equal(v.blocos[0].vazio, '— Sem ações aprovadas em aberto para o próximo período.'); assert.equal(v.blocos[0].linhas.length, 0); assert.doesNotMatch(JSON.stringify(v), /gere o plano|algoritmo|acoes_plano/)
})

await ok('versão cliente ignora o card «Exibir ao cliente = não» (visivel_cliente = 0) em toda seção — contagens, prints, medições; a defesa vê', () => {
  const M = mundo()
  M.tarefas.push({ id: 'tx', titulo: 'INTERNO: cliente não paga, segurar entregas', processo: 'Mercado Livre', responsavel: 'Giovanna Torres', status: 'concluida', data_inicio: '2026-09-10', data_conclusao: '2026-09-10', tipo_demanda: 'Otimizar Anúncios', prioridade: 'Solicitação Seller', itens: ['MLB111'], texto: '', visivel_cliente: 0 })
  M.evidencias.push({ tarefa_id: 'tx', abs: png, arquivo: 'evidencias/tx/a.png', bytes: 13, sha256: 'f'.repeat(64), criada_em: '2026-09-10T10:00:00.000Z' })
  M.medidas.push({ ...M.medidas[0], id: 'tx', titulo: 'INTERNO: cliente não paga, segurar entregas', data: '2026-09-10' })
  const c = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M)
  assert.ok(!JSON.stringify(c).includes('INTERNO')); assert.deepEqual([c.numeros.tarefas_concluidas, c.numeros.solicitacoes, c.numeros.intervencoes], [3, 1, 3])
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, M)
  assert.ok(JSON.stringify(d).includes('INTERNO')); assert.equal(d.numeros.tarefas_concluidas, 4)
})

await ok('versão cliente: histórico em texto de gente (R$, sim/não, status e Ads em português), sem jargão interno (Merovíngio, algoritmo, tabelas, API, Place Sprints) e limpa no auditor do relatório', () => {
  const M = mundo(); M.mudancas.push({ item_id: 'MLB111', dia: '2026-10-12', campo: 'preco', de: '74.19', para: '114.14', fonte: 'promo' }, { item_id: 'MLB111', dia: '2026-10-11', campo: 'frete_gratis', de: '0', para: '1', fonte: 'coleta' },
    { item_id: 'MLB111', dia: '2026-10-10', campo: 'ads', de: 'active', para: 'idle', fonte: 'ads' }, { item_id: 'MLB111', dia: '2026-10-09', campo: 'promocao', de: 'nenhuma', para: 'DEAL −14%', fonte: 'promo' })
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M), h = secao(d, 'historico')
  assert.deepEqual(h.blocos[1].linhas.slice(0, 4).map(l => l[3]), ['R$ 74,19 → R$ 114,14', 'sem frete grátis → com frete grátis', 'ativo → parado', 'sem promoção → campanha −14%'])
  assert.match(h.blocos[0].texto, /de qualquer origem \(assessoria, cliente, promoção ou o próprio Mercado Livre\)/)
  const t = textos(d).join('\n'); assert.doesNotMatch(t, /Merov[ií]ngio|algoritmo|acoes_plano|meli_item_mudanca|Place Sprints|\bAPI\b/)
  assert.deepEqual(auditarCliente(d), [])
  const M2 = mundo(); M2.tarefas[0].titulo = 'Plano do Merovíngio aplicado no MLB111'
  assert.deepEqual([...new Set(auditarCliente(montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M2)).map(v => v.codigo))], ['jargao'])
  // id de anúncio/item de outro canal no título do card (Shopee/TikTok, como o MLB) passa; celular sem formato, CPF formatado e hash continuam barrados
  const M3 = mundo(); M3.tarefas[0].titulo = 'Otimização de Anúncio - 22394409496'; M3.tarefas[1].titulo = 'Otimizar Acessórios: 1737101709768361583 · ID do Item: 22398140453'
  assert.deepEqual(auditarCliente(montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M3)), [])
  for (const tit of ['Ligar para 11987654321 amanhã', 'Conferir CPF 123.456.789-01 do titular', `Arquivo ${'a1'.repeat(16)}`]) {
    M3.tarefas[1].titulo = tit
    assert.deepEqual([...new Set(auditarCliente(montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, M3)).map(v => v.codigo))], ['id_interno'], tit)
  }
  assert.equal(valMud('estoque_zero', '18'), '18 un.'); assert.equal(valMud('thumb', 'https://http2.mlstatic.com/D_1-MLB1_1-I'), 'imagem de capa')
})

await ok('render: tokens copiados de ui.css (sem alterar), rodapé "Mercado Livre · cliente · data", .doc com cabeçalhos do Word e sem variável CSS', () => {
  const d = montarDossie('Acme', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, mundo())
  const pdf = htmlPdf(d), doc = htmlDoc(d)
  // o valor vem do 1º :root de ui.css (a marca pode mudá-lo; o que não pode mudar é a origem) — F1 dos 5 menus, 21/10/2026, spec § 8.7
  const larUi = readFileSync(new URL('../src/web/ui.css', import.meta.url), 'utf8').match(/^\s*--laranja\s*:\s*(#[0-9a-fA-F]{6})/m)[1]
  assert.equal(TOKENS.laranja, larUi); assert.match(pdf, new RegExp(`--laranja:${larUi}`)); assert.match(pdf, /--laranja-escuro:#/)
  assert.match(pdf, /@bottom-left\{content:"Mercado Livre · Acme · 13\/10\/2026"/); assert.match(pdf, /counter\(page\)/)
  assert.match(pdf, /01 · RESUMO EXECUTIVO/); assert.doesNotMatch(pdf, /<img/, 'versão cliente sem print embutido'); assert.doesNotMatch(pdf, /CONFIDENCIAL/)
  assert.match(doc, /xmlns:w="urn:schemas-microsoft-com:office:word"/); assert.match(doc, /<meta name="ProgId" content="Word.Document">/)
  assert.doesNotMatch(doc, /var\(--/); assert.match(doc, /sha256/)
  const df = montarDossie('Acme', { de: DE, ate: ATE, versao: 'defesa', cfg: CFG }, mundo()), pdfD = htmlPdf(df), docD = htmlDoc(df)
  assert.match(pdfD, /<img src="file:\/\//, 'defesa embute o print')
  assert.doesNotMatch(docD, /<img/, 'no Word o print vira referência com sha256'); assert.doesNotMatch(docD, /evidencias\//, 'sem caminho interno do arquivo')
  assert.equal((docD.match(/<div class="conf">CONFIDENCIAL — uso exclusivo interno\/jurídico<\/div>/g) || []).length, df.secoes.length, 'Word da defesa: faixa CONFIDENCIAL no início de cada seção (além da capa)')
  assert.doesNotMatch(doc, /<div class="conf">/)
  const evil = montarDossie('<script>x</script>', { de: DE, ate: ATE, versao: 'cliente', cfg: CFG }, mundo())
  assert.doesNotMatch(htmlPdf(evil), /<script>x/); assert.doesNotMatch(htmlDoc(evil), /<script>x/)
})

// ═══ geração, guarda e livro ═════════════════════════════════════════════════════════════════════════════
const livro = criarLivro({ handle: db, agora: () => '2026-10-13T12:00:00.000Z' })
livro.registrar({ cliente: 'Acme', tipo: 'tarefa_concluida', ref: 't1', fato_em: '2026-08-05', resumo: 'Tarefa concluída no Notion: «Otimizar título MLB111»', prova: 'https://www.notion.so/t1' })
const risco = criarRisco({ handle: db, livro, hoje: () => HOJE, agora: () => '2026-10-13T12:00:00.000Z', validarPor, clientes: () => ['Acme', 'Beta'] })
const contratos = criarContratos({ handle: db, livro, raiz, agora: () => '2026-10-13T12:00:00.000Z', hoje: () => HOJE, validarPor })
const coletar = async (cliente, { de, ate }) => { const M = mundo(); const v = livro.verificarCadeia(cliente); return { ...M, livro: { itens: livro.listar({ cliente, de, ate, por_pagina: 500 }).itens, cabeca: v.cabeca, verificacao: v }, ...contratos.ler(cliente) } }
let tamanhoPdf = 40, pdfAtivo = true, rtfConv = false   // rtfConv: conversor do Word (false = só o .doc HTML, determinístico; o teste do RTF liga o textutil real)
const execStub = (bin, args, o, cb) => { const dest = args.find(a => a.startsWith('--print-to-pdf=')).slice('--print-to-pdf='.length); writeFileSync(dest, '%PDF-1.4 stub ' + 'x'.repeat(tamanhoPdf)); cb(null) }
const render = { gerar: (d, o) => gerarArquivos(d, { ...o, rtf: rtfConv, pdfOpts: pdfAtivo ? { chrome: process.execPath, exec: execStub } : { chrome: join(raiz, 'sem-chrome') } }) }
const estadoMem = new Map(), estado = { get: k => estadoMem.get(k), set: (k, v) => estadoMem.set(k, v) }
const posts = [], avisos = []
let n8nOk = true, n8nConf = true, relogio = { dia: '2026-10-13', hora: '10:00' }
const envio = { configurado: () => n8nConf, postar: async (caminho, payload) => { posts.push({ caminho, payload }); return n8nOk ? { ok: true, status: 200 } : { ok: false, status: 500 } } }
const publicados = []
const fab = (extra = {}) => criarDossies({ handle: db, livro, coletar, render, raiz, agora: () => '2026-10-13T12:00:00.000Z', hoje: () => relogio.dia, hora: () => relogio.hora, validarPor, validarChave,
  risco, envio, cargos: [{ id: '1517119651522547774' }, { id: '799352939873173575' }, { id: '1356270093516013569' }], estado, notificar: a => avisos.push(a), cfg: CFG,
  publicarNotion: async a => { publicados.push(a); return { ok: true, url: 'https://www.notion.so/pagina-acme?pvs=4' } }, ...extra })
const dossies = fab()

let gerado
await ok('gerar: PDF (stub do Chrome) + .doc em data/dossies/<cliente>/, sha256 conferido, linha em dossie_gerado e documento_gerado no livro', async () => {
  gerado = await dossies.gerar({ cliente: 'Acme', versao: 'defesa', de: DE, ate: ATE, por: 'ana paula (cs)' })
  assert.deepEqual([gerado.versao, gerado.status, gerado.por, gerado.pdf, gerado.doc], ['defesa', 'incompleto', 'Ana Paula (CS)', true, true])
  const row = db.prepare('SELECT * FROM dossie_gerado WHERE id = ?').get(gerado.id)
  assert.match(row.arquivo_pdf, /^dossies\/acme\/dossie-defesa-2026-08-01_2026-10-12-\d{14}-[0-9a-f]{4}\.pdf$/)
  assert.equal(row.sha256_pdf, sha(readFileSync(join(raiz, row.arquivo_pdf)))); assert.equal(row.sha256_doc, sha(readFileSync(join(raiz, row.arquivo_doc))))
  assert.ok(readFileSync(join(raiz, row.arquivo_doc), 'utf8').includes('Word.Document'))
  assert.ok(!existsSync(join(raiz, row.arquivo_pdf.replace(/\.pdf$/, '.html'))), 'HTML intermediário apagado')
  assert.deepEqual([row.livro_seq, JSON.parse(row.pendencias_json).some(p => p.id === 'contrato')], [livro.verificarCadeia('Acme').cabeca.seq - 1, true], 'o documento leva o último elo ANTES do próprio registro')
  const l = db.prepare("SELECT * FROM registro_cliente WHERE tipo = 'documento_gerado' AND ref = ?").get(`dossie:${gerado.id}`)
  const dl = JSON.parse(l.dados_json)
  assert.deepEqual([dl.sha256_pdf, dl.sha256_doc, dl.status, dl.versao], [row.sha256_pdf, row.sha256_doc, 'incompleto', 'defesa'])
  assert.match(l.resumo, /Dossiê de defesa gerado \(INCOMPLETO\)/); assert.equal(livro.verificarCadeia('Acme').ok, true)
})

await ok('gerar: sem Chrome o .doc fica e o motivo é dito; quem não é da central = 403; período inválido/futuro/longo = 400 (sem eco)', async () => {
  pdfAtivo = false
  const g = await dossies.gerar({ cliente: 'Acme', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres' })
  pdfAtivo = true
  assert.deepEqual([g.pdf, g.pdf_motivo, g.doc, g.status, g.pdf_url], [false, 'pdf_indisponivel', true, 'n/a', ''])
  const rej = async (o, st) => { await assert.rejects(dossies.gerar({ cliente: 'Acme', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres', ...o }), e => e.status === st && !String(e.message).includes('<b>')) }
  await rej({ por: 'Fulano<b>' }, 403); await rej({ de: '13/10/2026' }, 400); await rej({ de: '2026-10-12', ate: '2026-08-01' }, 400); await rej({ ate: '2026-12-01' }, 400); await rej({ de: '2024-01-01' }, 400); await rej({ versao: 'DROP' }, 400)
})

// ═══ HTTP ═══════════════════════════════════════════════════════════════════════════════════════════════
const app = express(); app.use(express.json())
app.use(criarRotasDossie({ livro, risco, contratos, dossies, quem: () => QUEM, clienteCanonico: c => ['Acme', 'Beta'].find(x => norm(x) === norm(c)) || '' }))
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), porta = srv.address().port
const pedir = (metodo, caminho, corpo, host = `127.0.0.1:${porta}`) => new Promise((ok_, falha) => {
  const dados = corpo === undefined ? null : typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  const q = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { host, ...(dados ? { 'content-type': typeof corpo === 'string' ? 'text/plain' : 'application/json', 'content-length': Buffer.byteLength(dados) } : {}) } }, res => {
    const b = []; res.on('data', c => b.push(c)); res.on('end', () => { const buf = Buffer.concat(b); let json = null; try { json = JSON.parse(buf.toString()) } catch { /* binário */ } ok_({ status: res.statusCode, headers: res.headers, buf, json }) })
  })
  q.on('error', falha); if (dados) q.write(dados); q.end()
})
await ok('HTTP: gerar (415 sem JSON, 404 prospect sem eco, 403 fora da central), histórico, download .doc = application/msword e .pdf = application/pdf', async () => {
  assert.equal((await pedir('POST', '/api/cliente/dossie', 'x')).status, 415)
  const p = await pedir('POST', '/api/cliente/dossie', { cliente: '[Comercial] Empresa<b>', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres' }); assert.equal(p.status, 404); assert.doesNotMatch(JSON.stringify(p.json), /<b>/)
  assert.equal((await pedir('POST', '/api/cliente/dossie', { cliente: 'Acme', versao: 'cliente', de: DE, ate: ATE, por: 'Ninguém' })).status, 403)
  const g = await pedir('POST', '/api/cliente/dossie', { cliente: 'acme', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres' })
  assert.equal(g.status, 200); assert.match(g.json.dossie.pdf_url, /^\/api\/dossie\/\d+\/pdf$/)
  const h = await pedir('GET', '/api/cliente/dossies?cliente=Acme'); assert.equal(h.json.itens.length, 3); assert.equal(h.json.mensal.ligado, false)
  const doc = await pedir('GET', g.json.dossie.doc_url)
  assert.equal(doc.status, 200); assert.match(doc.headers['content-type'], /^application\/msword/); assert.match(doc.headers['content-disposition'], /^attachment; filename="Prestacao-de-contas-acme-2026-08-01_2026-10-12\.doc"$/)
  const pdf = await pedir('GET', g.json.dossie.pdf_url); assert.match(pdf.headers['content-type'], /^application\/pdf/); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-')
  assert.equal((await pedir('GET', '/api/dossie/99999/pdf')).status, 404); assert.equal((await pedir('GET', '/api/dossie/1/exe')).status, 404)
})

await ok('defesa nunca em rota pública: host do túnel = 403 na rota e no guarda global; nenhuma rota pública casa /api/dossie', async () => {
  for (const host of ['sprint90.place2u.com.br', 'diagnostico.place2u.com.br', 'meli.place2u.com.br']) {
    assert.equal((await pedir('GET', `/api/dossie/${gerado.id}/pdf`, undefined, host)).status, 403)
    assert.equal((await pedir('GET', `/api/dossie/${gerado.id}/doc`, undefined, host)).status, 403)
    let st = 0; guardaLocal({ method: 'GET', path: `/api/dossie/${gerado.id}/pdf`, originalUrl: `/api/dossie/${gerado.id}/pdf`, headers: { host } }, { status: s => ({ send: () => { st = s } }) }, () => { st = 200 }, 'diagnostico.place2u.com.br', 'sprint90.place2u.com.br')
    assert.equal(st, 403)
  }
  for (const rx of [ROTA_PUBLICA, ROTA_PUBLICA_COMERCIAL, ROTA_PUBLICA_S90]) for (const c of [`/api/dossie/${gerado.id}/pdf`, '/api/cliente/dossie', '/api/cliente/dossies', '/api/dossie/mensal']) assert.ok(!rx.test(c))
})

await ok('Notion: defesa = 403 (nunca sai do sistema); cliente = prévia por padrão, confirmar:true publica, guarda a URL sem query e registra no livro', async () => {
  const d = await pedir('POST', `/api/dossie/${gerado.id}/notion`, { por: 'Giovanna Torres', confirmar: true }); assert.equal(d.status, 403); assert.match(d.json.erro, /nunca sai do sistema/)
  const c = dossies.listar('Acme').find(x => x.versao === 'cliente' && x.pdf)
  const pv = await pedir('POST', `/api/dossie/${c.id}/notion`, { por: 'Giovanna Torres' })
  assert.deepEqual([pv.json.previa, pv.json.titulo], [true, 'Relatório de Sprints Place2u · Prestação de contas · 01/08/2026 a 12/10/2026']); assert.equal(publicados.length, 0)
  const sem = dossies.listar('Acme').find(x => x.versao === 'cliente' && !x.pdf)
  assert.equal((await pedir('POST', `/api/dossie/${sem.id}/notion`, { por: 'Giovanna Torres', confirmar: true })).status, 409)
  const env = await pedir('POST', `/api/dossie/${c.id}/notion`, { por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual([env.json.ok, publicados.length], [true, 1]); assert.ok(publicados[0].caminho.endsWith('.pdf'))
  const l = db.prepare("SELECT * FROM registro_cliente WHERE tipo = 'relatorio_enviado' AND ref = ?").get(`dossie-notion:${c.id}`)
  assert.equal(l.prova, 'https://www.notion.so/pagina-acme'); assert.equal(dossies.ler(c.id).notion.url, 'https://www.notion.so/pagina-acme?pvs=4')
})

await ok('Notion: a versão cliente passa pelo auditor do relatório antes de publicar — barrada = prévia com código e trecho, nada publicado (nem com confirmar); documento sem auditoria = 409', async () => {
  const fj = fab({ coletar: async (c, o) => { const M = await coletar(c, o); M.tarefas = M.tarefas.map((t, i) => i ? t : { ...t, titulo: 'Plano do Merovíngio aplicado no MLB111' }); return M } })
  const g = await fj.gerar({ cliente: 'Acme', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres' })
  assert.deepEqual([...new Set(g.notion.auditoria.map(v => v.codigo))], ['jargao'])
  const antes = publicados.length
  for (const confirmar of [false, true]) {
    const r = await fj.enviarNotion({ id: g.id, por: 'Giovanna Torres', confirmar })
    assert.deepEqual([r.ok, r.previa, r.motivo, r.codigos], [false, true, 'auditoria', ['jargao']]); assert.match(r.violacoes[0].trecho, /Merovíngio/)
  }
  assert.equal(publicados.length, antes, 'nada vai ao Notion do cliente')
  db.prepare("UPDATE dossie_gerado SET notion_json = '{}' WHERE id = ?").run(g.id)
  await assert.rejects(fj.enviarNotion({ id: g.id, por: 'Giovanna Torres', confirmar: true }), e => e.status === 409 && /gere de novo/.test(e.message))
  const limpo = dossies.listar('Acme').find(x => x.versao === 'cliente' && x.notion?.url)
  assert.deepEqual(limpo.notion.auditoria, [], 'publicado guarda a auditoria limpa junto da URL')
})

await ok('Word: .rtf pelo textutil (tabelas preservadas, CONFIDENCIAL no cabeçalho de página da defesa, rodapé numerado), application/rtf; sem textutil fica o .doc HTML com o motivo', async () => {
  rtfConv = () => Promise.reject(Object.assign(new Error('x'), { codigo: 'rtf_indisponivel' }))
  const g1 = await dossies.gerar({ cliente: 'Acme', versao: 'defesa', de: DE, ate: ATE, por: 'Giovanna Torres' }), a1 = dossies.arquivo(g1.id, 'doc')
  assert.deepEqual([a1.mime, a1.nome.endsWith('.doc'), g1.doc_formato], ['application/msword', true, 'doc']); assert.ok(!existsSync(a1.abs.replace(/\.doc$/, '.rtf')))
  if (existsSync('/usr/bin/textutil')) {
    rtfConv = paraRtf
    const g2 = await dossies.gerar({ cliente: 'Acme', versao: 'defesa', de: DE, ate: ATE, por: 'Giovanna Torres' }), a2 = dossies.arquivo(g2.id, 'doc'), rtf = readFileSync(a2.abs, 'latin1')
    assert.deepEqual([a2.mime, a2.nome.endsWith('.rtf'), g2.doc_formato], ['application/rtf', true, 'rtf'])
    assert.match(rtf, /^\{\\rtf1/); assert.ok(rtf.includes('{\\header\\pard\\qc\\b\\fs16 CONFIDENCIAL \\u8212? uso exclusivo interno/jur\\u237?dico\\par}'), 'cabeçalho de página'); assert.match(rtf, /\\chpgn/)
    assert.ok((rtf.match(/\\cell\b/g) || []).length > 50, 'tabelas preservadas (o .docx do textutil as achata)')
    assert.ok(!existsSync(a2.abs.replace(/\.rtf$/, '.doc')), 'o .doc intermediário some'); assert.equal(g2.sha256_doc, sha(readFileSync(a2.abs)))
    const dl = await pedir('GET', g2.doc_url); assert.match(dl.headers['content-type'], /^application\/rtf/); assert.match(dl.headers['content-disposition'], /\.rtf"$/)
    const g3 = await dossies.gerar({ cliente: 'Acme', versao: 'cliente', de: DE, ate: ATE, por: 'Giovanna Torres' })
    const rc = readFileSync(dossies.arquivo(g3.id, 'doc').abs, 'latin1'); assert.ok(!rc.includes('\\header') && rc.includes('\\footer'), 'cliente: só o rodapé numerado')
  } else console.log('  (textutil ausente: só o fallback .doc foi testado)')
  rtfConv = false
})

// ═══ mensal ═════════════════════════════════════════════════════════════════════════════════════════════
const qtd = () => db.prepare('SELECT COUNT(*) n FROM dossie_gerado').get().n
await ok('mensal: chave nasce DESLIGADA (nada gera nem envia); só líder/consultor liga', async () => {
  risco.marcar({ cliente: 'Acme', motivo: 'reembolso', descricao: 'Pediu o dinheiro de volta', desde: '2026-10-01', por: 'Giovanna Torres', confirmar: true })
  relogio = { dia: '2026-11-01', hora: '09:10' }
  const antes = qtd()
  assert.deepEqual(await dossies.tickMensal(), { pulou: 'desligado' }); assert.deepEqual([qtd(), posts.length], [antes, 0])
  assert.equal((await pedir('POST', '/api/dossie/mensal', { ligado: true, por: 'Ana Paula (CS)' })).status, 403, 'CS gera, mas não liga a chave')
  assert.equal((await pedir('POST', '/api/dossie/mensal', { ligado: 'sim', por: 'Giovanna Torres' })).status, 400)
  assert.deepEqual((await pedir('POST', '/api/dossie/mensal', { ligado: true, por: 'Giovanna Torres' })).json, { ok: true, ligado: true })
  assert.equal((await pedir('GET', '/api/risco')).json.mensal.ligado, true)
})

await ok('mensal: só dia 1 a partir das 09:00; gera as duas versões do mês anterior só para quem tem risco ABERTO e envia ao n8n com os 3 cargos e os 2 PDFs', async () => {
  for (const r of [{ dia: '2026-11-02', hora: '09:10' }, { dia: '2026-11-01', hora: '08:59' }]) { relogio = r; assert.deepEqual(await dossies.tickMensal(), { pulou: 'fora_do_dia' }) }
  relogio = { dia: '2026-11-01', hora: '09:00' }
  const antes = qtd(), r = await dossies.tickMensal()
  assert.deepEqual(r, { competencia: '10/2026', clientes: [{ cliente: 'Acme', estado: 'enviado' }] }); assert.equal(qtd(), antes + 2)
  const novos = db.prepare("SELECT * FROM dossie_gerado WHERE origem = 'mensal'").all()
  assert.deepEqual(novos.map(x => [x.cliente, x.versao, x.de, x.ate, x.competencia]), [['Acme', 'cliente', '2026-10-01', '2026-10-31', '10/2026'], ['Acme', 'defesa', '2026-10-01', '2026-10-31', '10/2026']])
  assert.equal(posts.length, 1); const p = posts[0]
  assert.equal(p.caminho, '/webhook/place-dossie')
  assert.match(p.payload.texto, /^<@&1517119651522547774> <@&799352939873173575> <@&1356270093516013569> 📁 Morpheus · Prestação de contas mensal · Acme · 10\/2026 — dossiê de defesa: INCOMPLETO \(\d+ provas pendentes: Contrato assinado/)
  assert.deepEqual([p.payload.cliente_rotulo, p.payload.competencia, p.payload.arquivos.length], ['Acme', '10/2026', 2])
  assert.ok(p.payload.arquivos.every(a => a.mime === 'application/pdf' && Buffer.from(a.base64, 'base64').subarray(0, 5).toString() === '%PDF-'))
  assert.deepEqual(p.payload.discord_mencionar_cargos, ['1517119651522547774', '799352939873173575', '1356270093516013569'])
  assert.ok(p.payload.texto.length <= 1900)
  assert.ok(db.prepare("SELECT 1 FROM registro_cliente WHERE tipo = 'nota' AND ref = 'dossie-mensal:10/2026' AND cliente = 'Acme'").get())
  assert.equal(mesAnterior('2026-01-01').competencia, '12/2025')
})

await ok('mensal: idempotente por (cliente, competência) — o 2º tick do dia não gera nem envia de novo', async () => {
  const antes = qtd(); await dossies.tickMensal(); await dossies.tickMensal()
  assert.deepEqual([qtd(), posts.length], [antes, 1])
})

await ok('mensal: falha do n8n avisa no sino e tenta de novo até o teto; n8n não configurado = pendente + aviso; PDF grande vai só como aviso', async () => {
  risco.marcar({ cliente: 'Beta', motivo: 'juridico', por: 'Giovanna Torres', confirmar: true })
  n8nOk = false; const p0 = posts.length
  let r = await dossies.tickMensal()
  assert.deepEqual(r.clientes, [{ cliente: 'Beta', estado: 'falhou', motivo: 'n8n_500' }]); assert.equal(avisos.at(-1).nivel, 'erro'); assert.match(avisos.at(-1).titulo, /não foi entregue ao #growth/)
  await dossies.tickMensal(); await dossies.tickMensal(); await dossies.tickMensal()
  assert.equal(posts.length - p0, CFG.mensal.max_tentativas, 'para no teto de tentativas')
  assert.equal(db.prepare("SELECT tentativas FROM dossie_mensal WHERE cliente = 'Beta'").get().tentativas, CFG.mensal.max_tentativas)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dossie_gerado WHERE cliente = 'Beta'").get().n, 2, 'gerado uma vez só')
  // n8n sem configuração + PDF acima do teto (fábrica com teto pequeno)
  n8nOk = true; n8nConf = false
  const grande = fab({ cfg: { ...CFG, mensal: { ...CFG.mensal, max_bytes_arquivo: 50 } } })
  relogio = { dia: '2026-12-01', hora: '09:30' }; tamanhoPdf = 200
  r = await grande.tickMensal()
  assert.ok(r.clientes.every(c => c.estado === 'pendente' && c.motivo === 'n8n_nao_configurado')); assert.equal(avisos.at(-1).nivel, 'alerta')
  n8nConf = true; db.prepare("UPDATE dossie_mensal SET estado = 'gerado' WHERE competencia = '11/2026'").run()
  const p1 = posts.length; await grande.tickMensal()
  const ult = posts.slice(p1)
  assert.equal(ult.length, 2); assert.ok(ult.every(x => x.payload.arquivos.length === 0 && /PDF acima de 0 MB — baixar no painel/.test(x.payload.texto)))
})

await ok('mensal: falha na GERAÇÃO conta tentativa, avisa no sino e para no teto (não regera a cada 10 min para sempre)', async () => {
  const quebrada = fab({ coletar: async () => { throw new Error('fonte indisponível') } })
  risco.marcar({ cliente: 'Acme', motivo: 'juridico', por: 'Giovanna Torres', confirmar: true })
  relogio = { dia: '2027-01-01', hora: '09:05' }
  const antes = qtd(), av = avisos.length
  for (let i = 0; i < CFG.mensal.max_tentativas + 2; i++) await quebrada.tickMensal()
  const l = db.prepare("SELECT * FROM dossie_mensal WHERE cliente = 'Acme' AND competencia = '12/2026'").get()
  assert.deepEqual([l.estado, l.motivo, l.tentativas, qtd()], ['falhou', 'geracao', CFG.mensal.max_tentativas, antes])
  assert.ok(avisos.length > av && avisos.at(-1).titulo === 'Dossiê mensal não foi gerado')
})

await ok('mensal: falha no meio da geração guarda o que já foi gerado (a versão cliente não é regerada a cada tentativa); chave desligada no meio = pendente, nada postado; payload leva id de idempotência', async () => {
  const quebraDefesa = fab({ render: { gerar: (d, o) => d.versao === 'defesa' ? Promise.reject(new Error('chrome caiu')) : render.gerar(d, o) } })
  relogio = { dia: '2027-02-01', hora: '09:10' }
  for (let i = 0; i < CFG.mensal.max_tentativas + 1; i++) await quebraDefesa.tickMensal()
  const ger = c => db.prepare("SELECT versao FROM dossie_gerado WHERE cliente = ? AND competencia = '01/2027'").all(c).map(r => r.versao)
  assert.deepEqual([ger('Acme'), ger('Beta')], [['cliente'], ['cliente']], 'a versão cliente é gerada UMA vez; só a defesa é tentada de novo')
  const l = db.prepare("SELECT * FROM dossie_mensal WHERE cliente = 'Acme' AND competencia = '01/2027'").get()
  assert.deepEqual([l.estado, l.tentativas, JSON.parse(l.ids_json).length], ['falhou', CFG.mensal.max_tentativas, 1])
  relogio = { dia: '2027-03-01', hora: '09:10' }
  let primeira = true
  const desliga = fab({ coletar: async (c, o) => { if (primeira) { primeira = false; estado.set('dossie_mensal_ligado', 'desligado') } return coletar(c, o) } })
  const p0 = posts.length, r = await desliga.tickMensal()
  assert.equal(posts.length, p0, 'nada postado depois de desligada a chave')
  assert.deepEqual(r.clientes.map(c => [c.estado, c.motivo]), [['pendente', 'chave_desligada'], ['pendente', 'chave_desligada']])
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dossie_gerado WHERE competencia = '02/2027'").get().n, 2, 'o 2º cliente nem chega a ser gerado')
  estado.set('dossie_mensal_ligado', 'ligado')
  await dossies.tickMensal()
  assert.deepEqual(posts.slice(p0).map(x => x.payload.id).sort(), ['Acme|02/2027', 'Beta|02/2027'])
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dossie_gerado WHERE competencia = '02/2027'").get().n, 4, 'religada: o 1º cliente só entrega; o 2º gera e entrega')
  const encerra = fab({ coletar: async (c, o) => { for (const x of risco.listar(c).filter(x => x.estado === 'aberto')) risco.encerrar({ cliente: c, id: x.id, por: 'Giovanna Torres', confirmar: true }); return coletar(c, o) } })
  relogio = { dia: '2027-04-01', hora: '09:10' }
  const p1 = posts.length, r2 = await encerra.tickMensal()
  assert.equal(posts.length, p1); assert.deepEqual(r2.clientes.map(c => c.motivo), ['sem_risco_aberto', 'sem_risco_aberto'], 'risco encerrado no meio = não posta')
})

await ok('GET /api/cliente/dossies: o estado do mensal traz só as linhas DESTE cliente (isolamento); a visão geral fica em /api/dossie/mensal', async () => {
  const h = await pedir('GET', '/api/cliente/dossies?cliente=Beta')
  assert.ok(h.json.mensal.envios.length > 0 && h.json.mensal.envios.every(e => e.cliente === 'Beta')); assert.equal(h.json.mensal.por, undefined)
  const g = await pedir('GET', '/api/dossie/mensal'); assert.ok(g.json.envios.some(e => e.cliente === 'Acme') && g.json.envios.some(e => e.cliente === 'Beta'))
})

await ok('fiação: db.js cria as tabelas, server.js monta as rotas com dossies e o tick mensal, config válida, chave nunca ligada pelo código', () => {
  const dbjs = readFileSync(join(RAIZ_PROJ, 'src/lib/db.js'), 'utf8'), server = readFileSync(join(RAIZ_PROJ, 'src/server.js'), 'utf8')
  assert.match(dbjs, /db\.exec\(SCHEMA_DOSSIE\)/)
  assert.match(server, /criarRotasDossie\(\{.*dossies: dossiesReal\(\)/); assert.match(server, /dossiesReal\(\)\.tickMensal\(\)/)
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dossie_gerado'").get() && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dossie_mensal'").get())
  assert.deepEqual([CFG.mensal.dia, CFG.mensal.hora, CFG.mensal.webhook, CFG.mensal.canal], [1, '09:00', '/webhook/place-dossie', '1040645309023391845'])
  for (const f of ['src/lib/dossie.js', 'src/lib/dossie-real.js', 'src/server.js']) assert.doesNotMatch(readFileSync(join(RAIZ_PROJ, f), 'utf8'), /set\(\s*['"]dossie_mensal_ligado['"]\s*,\s*['"]ligado['"]/)
  assert.ok(statSync(join(RAIZ_PROJ, 'src/web/dossie.js')).size > 0)
})

srv.close()
console.log(`\n${n} casos ok`)
