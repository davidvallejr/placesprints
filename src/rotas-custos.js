// Rotas JSON de gestão dos custos por SKU vindos de ERP/planilha (/api/custos/...): cartão de Integrações, aba Custos, quarentena,
// reconciliação, webhook da planilha, credenciais de ERP e "sincronizar agora" (docs/integracao-custos-erp-SPEC.md, seção 10.1).
// NÃO são públicas (o túnel só abre /webhook/custos/<wid> e /erp/callback). Toda rota exige `cliente` com conta ML conectada (menos o
// app global do Bling); toda entrada é validada (repetido/lista/null/lixo = 400, nunca 500, nunca stack); mutação só lê o corpo JSON e
// exige "por". Segredo de ERP nunca volta ao front; o segredo do webhook sai UMA vez (gerar/rotacionar) e nunca é logado.
import { Router } from 'express'
import { inteiro, simNao } from './rotas-promocoes.js'
import { norm } from './lib/promocoes-mc.js'
import { auditar } from './lib/promocoes-db.js'
import { env } from './lib/env.js'

export const rotasCustos = Router()
export const depsCustos = {}       // injetável: { conexoes, nucleo, webhook, script, credenciais, sync, depsSync } (testes/stubs)

// ponytail: import dinâmico — cada módulo (M1 núcleo, M2 webhook, M3 script, M6 credenciais, M7 sync) é trocável por stub em depsCustos
const CAMINHOS = { nucleo: './lib/custos-db.js', webhook: './lib/custos-webhook.js', script: './lib/custos-sheets-script.js', credenciais: './lib/erp-credenciais.js', sync: './lib/erp-sync.js' }
const mod = async k => depsCustos[k] || import(CAMINHOS[k])
const conexoes = async () => (depsCustos.conexoes ? depsCustos.conexoes() : (await import('./lib/meli-contas.js')).listarConexoes())

const EXTERNAS = ['upload', 'bling', 'tiny', 'sheets'], FONTES = ['manual', ...EXTERNAS], ERPS = ['bling', 'tiny']   // 'upload' = planilha subida na tela (quarentena e descarte valem para ela)
const LISTAS = ['sku_erp_sem_anuncio', 'anuncio_sem_custo', 'anuncio_sem_sku', 'conflito', 'rejeitadas', 'quarentena', 'nao_visto', 'kits_pendentes', 'divergencia_fontes']
const SEM_CHAVE = 'chave de criptografia dos ERPs ausente: defina ERP_TOKEN_KEY no .env (gere com: openssl rand -hex 32), guarde um backup e reinicie o painel'

// ── validação de entrada ─────────────────────────────────────────────────────
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
// texto ESTRITO: parâmetro repetido, lista, objeto ou null = 400 (o `texto` de rotas-promocoes pega o 1º e corta calado: aqui não serve,
// um SKU de 81 caracteres cortado em 80 apontaria para OUTRO SKU). Ausente/'' => '' se opcional, 400 se obrigatório.
const txt = (v, nome, max, obrigatorio = true) => {
  if (v !== undefined && typeof v !== 'string' && typeof v !== 'number') throw erro(`"${nome}" deve ser um único valor de texto (parâmetro repetido, lista, objeto ou null não valem)`)
  const t = v === undefined ? '' : String(v).trim()
  if (!t && obrigatorio) throw erro(`informe "${nome}"`)
  if (t.length > max) throw erro(`"${nome}" longo demais (máx. ${max} caracteres)`)
  return t
}
// padrao === null => obrigatório; ausente/'' => padrao; presente fora da lista => 400 (nunca vira o padrão calado)
const opcao = (v, validos, nome, padrao = null) => {
  const t = txt(v, nome, 40, padrao === null).toLowerCase()
  if (!t) return padrao
  if (!validos.includes(t)) throw erro(`"${nome}" deve ser um de: ${validos.join(', ')}`)
  return t
}
const numero = (v, nome, min, max) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(n) || n < min || n > max) throw erro(`"${nome}" deve ser um número entre ${min} e ${max}`)
  return n
}
// client_id/secret do aplicativo (digitados pelo dono na tela): só ASCII visível, sem espaço; o valor NUNCA aparece na mensagem de erro
const chaveApp = (v, nome) => { const t = typeof v === 'string' ? v.trim() : ''; if (!/^[\x21-\x7e]{4,512}$/.test(t)) throw erro(`"${nome}" inválido: cole o valor exato do aplicativo (4 a 512 caracteres, sem espaços)`); return t }
const exigirPor = b => txt(b.por, 'por (seu nome: quem está fazendo a alteração)', 80)
// GET lê a query; MUTAÇÃO lê SÓ o corpo JSON (um POST "simples" cross-site só consegue levar query string)
const dados = req => req.method === 'GET' || req.method === 'HEAD' ? { ...(req.query || {}) }
  : (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? { ...req.body } : {}
const exigirCliente = async b => {
  const nome = txt(b.cliente, 'cliente', 200)
  const lista = await conexoes()
  const c = lista.find(x => x.cliente === nome) || lista.find(x => norm(x.cliente) === norm(nome))
  if (!c) throw erro('cliente sem conta Mercado Livre conectada (conecte pela tela de integrações)', 404)
  return c.cliente
}

// ── nada de segredo em resposta/log ──────────────────────────────────────────
// defesa em profundidade: status de webhook/credenciais já vêm sem segredo (M2/M6), e mesmo assim nenhuma chave *_cifrado/secret/segredo/token passa
const semSegredo = o => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !/cifrad|secret|segredo|token/i.test(k))) : o ?? null)
const limpar = s => String(s ?? '').replace(/(bearer\s+|(?:access_token|refresh_token|client_secret|segredo|code)["']?\s*[=:]\s*["']?)[^\s"'&,]+/gi, '$1***').replace(/\b[0-9a-f]{32,}\b/gi, '***').slice(0, 300)
// QUEM pediu (o módulo chamado audita O QUE aconteceu, mas sem "por" na assinatura congelada). Best-effort: falha de auditoria não queima o segredo já gerado.
const registrar = (cliente, autor, detalhe) => { try { auditar(cliente, 'custos_gestao', { autor, detalhe }) } catch (e) { console.error('[custos] auditoria:', limpar(e?.message)) } }

rotasCustos.use('/api/custos', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')                       // nada daqui vai para cache (o segredo do webhook sai uma única vez)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^application\/json\b/i.test(req.headers['content-type'] || '')) return next()
  res.status(415).json({ erro: 'envie o corpo como JSON (Content-Type: application/json); parâmetros de mutação não vão na URL' })
})
const trata = fn => async (req, res) => {
  try { await fn(req, res) } catch (e) {
    const semChave = e?.code === 'ERP_SEM_CHAVE' || /ERP_SEM_CHAVE/.test(String(e?.message)), st0 = Number(e?.status ?? e?.statusCode)
    const st = semChave ? 409 : st0 >= 400 && st0 < 500 ? st0 : 500
    if (st >= 500) console.error('[custos]', req.method, req.path, limpar(e?.message))      // nunca o corpo da requisição
    res.status(st).json({ erro: semChave ? SEM_CHAVE : st < 500 ? limpar(e.message) : 'erro interno no módulo de custos (veja o log do servidor)' })
  }
}

// ── leitura: cartão, aba Custos, histórico, quarentena, reconciliação, pendências ──────────────────────
rotasCustos.get('/api/custos/resumo', trata(async (req, res) => {
  const cliente = await exigirCliente(dados(req))
  const [N, W, C] = await Promise.all([mod('nucleo'), mod('webhook'), mod('credenciais')])
  const r = await N.resumoCustos(cliente), fontes = { ...(r.fontes || {}) }
  fontes.sheets = { ...fontes.sheets, webhook: semSegredo(await W.statusWebhook(cliente, 'sheets')) }
  for (const f of ERPS) fontes[f] = { ...fontes[f], credenciais: semSegredo(await C.statusCredenciais(cliente, f)) }
  let { reconciliacao_disponivel: disp, reconciliacao_motivo: motivo } = r
  if (disp === undefined) ({ disponivel: disp, motivo } = await N.reconciliacao(cliente, 'anuncio_sem_custo', { limite: 1 }))
  res.json({ ...r, cliente, cfg: await N.getCfgCustos(cliente), pendencias: await N.pendenciasCustos(cliente), fontes, reconciliacao_disponivel: !!disp, reconciliacao_motivo: motivo || '' })
}))
rotasCustos.get('/api/custos/skus', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b)
  const fonte = opcao(b.fonte, FONTES, 'fonte', ''), q = txt(b.q, 'q', 80, false)
  res.json(await (await mod('nucleo')).custosEfetivosDetalhe(cliente, { fonte: fonte || undefined, q: q || undefined, limite: inteiro(b.limite, 200, 1, 1000, 'limite'), offset: inteiro(b.offset, 0, 0, 1_000_000, 'offset') }))
}))
rotasCustos.get('/api/custos/historico', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), sku = txt(b.sku, 'sku', 80)
  res.json({ sku, itens: await (await mod('nucleo')).historicoSku(cliente, sku, inteiro(b.limite, 100, 1, 1000, 'limite')) })
}))
rotasCustos.get('/api/custos/quarentena', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), estado = opcao(b.estado, ['pendente', 'recusada'], 'estado', 'pendente')
  res.json({ estado, itens: await (await mod('nucleo')).listarQuarentena(cliente, { estado }) })
}))
rotasCustos.get('/api/custos/reconciliacao', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), lista = opcao(b.lista, LISTAS, 'lista')
  res.json(await (await mod('nucleo')).reconciliacao(cliente, lista, { limite: inteiro(b.limite, 200, 1, 1000, 'limite') }))
}))
rotasCustos.get('/api/custos/pendencias', trata(async (req, res) => {
  const cliente = await exigirCliente(dados(req))
  res.json({ pendencias: await (await mod('nucleo')).pendenciasCustos(cliente) })
}))

// ── vínculo custo ↔ anúncio (custo-vinculo.js; o núcleo valida: anúncio do cliente → 404, SKU de custo sem custo vigente → 400, prospect → 400) ──
// A lista traz candidatos por semelhança de nome, mas NADA é gravado sem "Confirmar" (vincular) ou "Não é este" (recusar).
rotasCustos.get('/api/custos/vinculos', trata(async (req, res) => {
  const cliente = await exigirCliente(dados(req))
  res.json(await (await mod('nucleo')).vinculosCusto.listarVinculos(cliente))
}))
for (const acao of ['vincular', 'recusar', 'desvincular']) rotasCustos.post(`/api/custos/${acao}`, trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b)
  const item_id = txt(b.item_id, 'item_id', 20), sku_custo = txt(b.sku_custo, 'sku_custo', 80, acao !== 'desvincular')      // desvincular: sem sku_custo tira o manual
  res.json(await (await mod('nucleo')).vinculosCusto[acao]({ cliente, item_id, sku_custo: sku_custo || undefined, por }))
}))

// ── quarentena, descarte e configuração (o núcleo valida de novo e grava histórico/auditoria com "por") ──
rotasCustos.post('/api/custos/quarentena/decidir', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), decisao = opcao(b.decisao, ['aprovar', 'recusar'], 'decisao')
  if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 2000) throw erro('informe "itens": lista de {sku, fonte} (1 a 2.000)')
  const itens = b.itens.map((i, n) => {
    if (!i || typeof i !== 'object' || Array.isArray(i)) throw erro(`itens[${n}]: use {sku, fonte}`)
    return { sku: txt(i.sku, `itens[${n}].sku`, 80), fonte: opcao(i.fonte, EXTERNAS, `itens[${n}].fonte`) }
  })
  res.json(await (await mod('nucleo')).decidirQuarentena(cliente, itens, decisao, por))
}))
rotasCustos.post('/api/custos/descartar', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b)
  const r = await (await mod('nucleo')).descartarCusto(cliente, txt(b.sku, 'sku', 80), opcao(b.fonte, EXTERNAS, 'fonte'), por)
  res.json({ ok: true, ...(r && typeof r === 'object' && !Array.isArray(r) ? r : {}) })
}))
rotasCustos.post('/api/custos/config', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), patch = {}
  if ('ordem_fontes' in b) {
    const o = b.ordem_fontes
    if (!Array.isArray(o) || !o.length || new Set(o).size !== o.length || !o.every(f => FONTES.includes(f))) throw erro(`"ordem_fontes" deve ser uma lista, sem repetição, de: ${FONTES.join(', ')} (a ordem é a precedência; fonte fora da lista não é usada)`)
    patch.ordem_fontes = o
  }
  if ('limiar_variacao_pct' in b) patch.limiar_variacao_pct = numero(b.limiar_variacao_pct, 'limiar_variacao_pct', 1, 1000)
  if ('quarentena_custo_ge_preco' in b) patch.quarentena_custo_ge_preco = simNao(b.quarentena_custo_ge_preco, undefined, 'quarentena_custo_ge_preco') ? 1 : 0
  if ('campo_custo_tiny' in b) patch.campo_custo_tiny = opcao(b.campo_custo_tiny, ['preco_custo', 'custo_medio'], 'campo_custo_tiny')
  for (const k of ['velho_dias_erp', 'velho_dias_sheets']) if (k in b) patch[k] = inteiro(b[k], undefined, 1, 365, k)
  if (!Object.keys(patch).length) throw erro('nada para alterar: envie ao menos um de ordem_fontes, limiar_variacao_pct, quarentena_custo_ge_preco, campo_custo_tiny, velho_dias_erp, velho_dias_sheets')
  const N = await mod('nucleo')
  await N.setCfgCustos(cliente, patch, por)
  res.json({ ok: true, cfg: await N.getCfgCustos(cliente) })
}))

// ── webhook da planilha: gerar / rotacionar devolvem URL + segredo + Apps Script pronto UMA vez ──────
rotasCustos.post('/api/custos/fontes/sheets/webhook', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), acao = opcao(b.acao, ['gerar', 'rotacionar', 'desativar'], 'acao')
  const W = await mod('webhook')
  if (acao === 'desativar') {
    await W.desativarWebhook(cliente, 'sheets')
    registrar(cliente, por, 'webhook da planilha: desativar (envios passam a receber 401)')
    return res.json({ ok: true, webhook: semSegredo(await W.statusWebhook(cliente, 'sheets')) })
  }
  if (!/^https:\/\/[^\s"'\\<>]+$/.test(env.PUBLIC_BASE_URL || '')) throw erro('configure PUBLIC_BASE_URL (endereço https do túnel) no .env e reinicie o painel: sem ela a planilha não tem para onde enviar', 409)
  const S = await mod('script')          // carregado ANTES de gerar: falha de import não pode queimar o segredo que só aparece uma vez
  const w = await (acao === 'gerar' ? W.gerarWebhook : W.rotacionarSegredo)(cliente, 'sheets')
  let script = null
  try { script = await S.gerarScriptApps({ url: w.url, segredo: w.segredo }) } catch (e) { console.error('[custos] montar Apps Script:', limpar(e?.message)) }
  registrar(cliente, por, acao === 'gerar' ? 'webhook da planilha: gerar (segredo exibido uma única vez)' : 'webhook da planilha: rotacionar (o segredo anterior vale por 24 h)')
  res.json({ url: w.url, segredo: w.segredo, script, ...(script ? {} : { aviso: 'o Apps Script não pôde ser montado: copie a URL e o segredo agora (não aparecem de novo) ou rotacione' }) })
}))

// ── credenciais de ERP (client_id/secret digitados na tela; cifrados no M6; nunca devolvidos) ─────────
rotasCustos.post('/api/custos/erp/app-global', trata(async (req, res) => {
  const b = dados(req), por = exigirPor(b), fonte = opcao(b.fonte, ['bling'], 'fonte')     // Tiny não tem app global: cada cliente cria o seu
  await (await mod('credenciais')).salvarAppGlobal(fonte, { client_id: chaveApp(b.client_id, 'client_id'), client_secret: chaveApp(b.client_secret, 'client_secret') }, por)
  res.json({ ok: true })
}))
rotasCustos.post('/api/custos/erp/credenciais', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), fonte = opcao(b.fonte, ERPS, 'fonte')
  const modo = fonte === 'tiny' ? opcao(b.modo_app, ['proprio'], 'modo_app', 'proprio') : opcao(b.modo_app, ['global', 'proprio'], 'modo_app')
  let app = { modo_app: modo }
  if (modo === 'proprio') app = { modo_app: modo, client_id: chaveApp(b.client_id, 'client_id'), client_secret: chaveApp(b.client_secret, 'client_secret') }
  else if (b.client_id !== undefined || b.client_secret !== undefined) throw erro('modo "global" usa o aplicativo da Place2u: não envie client_id/client_secret (para o app do próprio cliente, use modo_app "proprio")')
  await (await mod('credenciais')).salvarCredenciaisApp(cliente, fonte, app, por)
  res.json({ ok: true })
}))
rotasCustos.post('/api/custos/erp/autorizar', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), fonte = opcao(b.fonte, ERPS, 'fonte')
  const url = await (await mod('credenciais')).urlAutorizacao(cliente, fonte)
  registrar(cliente, por, `${fonte}: link de autorização gerado`)
  res.json({ url })
}))
rotasCustos.post('/api/custos/erp/desconectar', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b), fonte = opcao(b.fonte, ERPS, 'fonte')
  await (await mod('credenciais')).desconectarErp(cliente, fonte, por)      // 3º argumento além do contrato: o M6 atual o grava na auditoria
  registrar(cliente, por, `${fonte}: desconectar (tokens locais apagados; custos já recebidos continuam)`)
  res.json({ ok: true, aviso: fonte === 'bling' ? 'desinstale também o aplicativo em "Minhas Instalações" do Bling' : 'exclua também o aplicativo em Configurações > Aplicativos do Tiny, se não for mais usar' })
}))

// ── sincronizar agora (job do M7; um por conta) ──────────────────────────────────────────────────────
const donoJob = new Map()                 // job_id → cliente: o status só é mostrado a quem pediu (mesmo se o job do M7 não trouxer `cliente`)
rotasCustos.post('/api/custos/fontes/sincronizar', trata(async (req, res) => {
  const b = dados(req), cliente = await exigirCliente(b), por = exigirPor(b)
  if (txt(b.fonte, 'fonte', 40, false).toLowerCase() === 'sheets') throw erro('a planilha envia sozinha: use o menu "Custos → Sincronizar agora" dentro da planilha')
  const fonte = opcao(b.fonte, ERPS, 'fonte')
  const { job_id } = await (await mod('sync')).iniciarSync(cliente, fonte, depsCustos.depsSync)
  donoJob.set(String(job_id), cliente)
  for (const k of [...donoJob.keys()].slice(0, -200)) donoJob.delete(k)
  registrar(cliente, por, `${fonte}: sincronizar agora (job ${job_id})`)
  res.status(202).json({ job_id })
}))
rotasCustos.get('/api/custos/job/:id', trata(async (req, res) => {
  const cliente = await exigirCliente(dados(req)), id = txt(req.params.id, 'id', 80)
  const j = await (await mod('sync')).statusJob(id)
  if (!j || (j.cliente ?? donoJob.get(id)) !== cliente) throw erro('job não encontrado', 404)
  res.json(j)
}))
