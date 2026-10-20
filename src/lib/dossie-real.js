// Fiação REAL da Prestação de contas / Dossiê de defesa (src/lib/dossie.js): coleta das fontes do banco local (só leitura), PDF pelo Chrome do relatório,
// guarda em data/dossies/{cliente}/, livro de registro, envio da versão cliente ao Notion do cliente (página na Informações + PDF anexo, só com confirmar:true)
// e entrega mensal ao n8n (fluxo place-dossie → #growth). O autoteste usa as fábricas com banco em memória; este arquivo não roda nos testes.
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { db, agora, log } from './db.js'
import { ROOT, env } from './env.js'
import { carregarClientes, validarLiderOuConsultor } from './equipe.js'
import { criarVinculos } from './vinculos.js'
import { analisarCliente } from './impacto-tarefas.js'
import { custosDoCliente, economiaAds } from './diagnostico-conta.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { livroReal, riscoReal, contratosReal, validarDossie } from './livro-registro-real.js'
import { criarDossies, addDias } from './dossie.js'
import { gerarArquivos } from './render-dossie.js'
import { slug, anexarPdf } from './relatorio-pdf.js'
import { resolverArquivo, ehFrio } from './frio.js'
import { criarEnvio } from './gatilhos-envio.js'
import { notificar } from './notificacoes.js'
import { dataNoFuso, horaNoFuso, estadoDeHandle } from './relatorio-envio.js'
import { criarRelatorioNotion, CATEGORIA, tituloOk, classificarErro, rt } from './relatorio-notion.js'
import { notionReq } from './notion.js'
import { descobrirFontes } from './descobrir.js'
import { lerConfig as lerConfigRespostas, norm as normResp } from './respostas-relatorio.js'
import { resolverPaginaCliente, acharInformacoesDb, invalidarCliente } from './plano-informacoes.js'

const RAIZ = join(ROOT, 'data')
export const CFG_DOSSIE = JSON.parse(readFileSync(join(ROOT, 'config', 'dossie.json'), 'utf8'))
const CARGOS = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'config', 'discord-time.json'), 'utf8')).mencoes_obrigatorias || [] } catch { return [] } })()
const WEBHOOK = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'config', 'gatilhos.json'), 'utf8')).webhook || {} } catch { return {} } })()
const IMAGEM = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const parse = (s, p) => { try { return JSON.parse(s || '') ?? p } catch { return p } }
const tenta = (fn, padrao) => { try { return fn() } catch (e) { if (/no such (table|column)/i.test(String(e?.message))) return padrao; throw e } }
const sha = b => createHash('sha256').update(b).digest('hex')
const COBRANCA = ['dependencia_vencida', 'custos_nao_informados', 'ruptura_curva_a', 'ciclo_estoque_previsto']
// envio que o coletor de respostas reconhece como âncora (config/respostas-relatorio.json): mensagem nossa no WhatsApp com a assinatura do plano ou que começa com a pergunta
const ehAncora = (() => { let c = null; try { c = lerConfigRespostas().ancoras } catch { return () => false }
  const contem = (c.relatorio?.contem || []).map(x => normResp(x).trim()).filter(Boolean), comeca = (c.pergunta?.comeca || []).map(x => normResp(x).trim()).filter(Boolean)
  return l => (l.canais || []).includes('whatsapp') && (contem.some(x => normResp(l.texto).includes(` ${x} `)) || comeca.some(x => normResp(l.texto).trimStart().startsWith(x))) })()

// ── coleta: tudo o que o montarDossie lê, recortado ao cliente (SQL parametrizado, colunas fixas) ──
export async function coletarDados(cliente, { de, ate, versao }, { handle: h = db, raiz = RAIZ } = {}) {
  const base = resolve(raiz), antes = addDias(de, -30)
  // entra na fila depois de uma passada global em curso (nunca pega carona nela); anexos acima do teto ficam declarados na D3
  const ing = await livroReal().ingerir({ cliente, teto_arquivos: 5000 }).catch(e => { log('erro', `dossiê: ingestão do livro (${String(e?.message ?? e).slice(0, 80)})`); return null })
  const central = carregarClientes().find(c => c.cliente === cliente)
  const ficha = tenta(() => h.prepare("SELECT prestador FROM ficha_prestador WHERE cliente = ? AND papel = 'consultor' ORDER BY (canal IN ('', 'ML')) DESC LIMIT 1").get(cliente), null)
  const cs = tenta(() => h.prepare('SELECT cs_responsavel FROM clientes_central WHERE cliente = ?').get(cliente)?.cs_responsavel, '') || ''
  const equipe = { consultor: central?.consultores?.ML || ficha?.prestador || central?.principal || '', cs }

  const tarefas = h.prepare(`SELECT id, titulo, processo, responsavel, status, status_raw, data_inicio, prazo, data_conclusao, tipo_demanda, url, etiquetas, prioridade, visivel_cliente, descricao, conteudo
    FROM tarefas WHERE cliente = ? AND arquivada = 0 AND (COALESCE(data_inicio, '') = '' OR data_inicio <= ?) AND (COALESCE(data_conclusao, '') = '' OR data_conclusao >= ?)`).all(cliente, ate, de)
  const conhecidos = new Set(h.prepare('SELECT item_id FROM meli_item WHERE cliente = ?').all(cliente).map(r => r.item_id))
  const vmap = criarVinculos(h).vinculosDe(cliente, tarefas, conhecidos)
  const anexos = new Map(h.prepare('SELECT e.tarefa_id, COUNT(*) n FROM evidencias e JOIN tarefas t ON t.id = e.tarefa_id WHERE t.cliente = ? GROUP BY e.tarefa_id').all(cliente).map(r => [r.tarefa_id, r.n]))
  for (const t of tarefas) {
    t.itens = (vmap.get(t.id) || []).map(x => x.item_id); t.anexos = anexos.get(t.id) || 0
    t.texto = `${t.descricao || ''}\n${t.conteudo || ''}`.slice(0, 20_000); delete t.descricao; delete t.conteudo
    for (const k of ['data_inicio', 'prazo', 'data_conclusao', 'etiquetas', 'prioridade', 'processo', 'responsavel']) t[k] = t[k] || ''
  }
  // prints: a 1ª imagem guardada localmente de cada card concluído no período (o montar escolhe até max_evidencias); só dentro de data/
  const evs = h.prepare(`SELECT e.id, e.tarefa_id, e.tipo, e.arquivo_local, e.legenda, e.criada_em,
      EXISTS (SELECT 1 FROM registro_cliente lv WHERE lv.tipo = 'anexo_tarefa' AND lv.ref = e.id) no_livro FROM evidencias e JOIN tarefas t ON t.id = e.tarefa_id
    WHERE t.cliente = ? AND t.arquivada = 0 AND t.status = 'concluida' AND t.data_conclusao BETWEEN ? AND ? ORDER BY e.rowid`).all(cliente, de, ate)
  const evidencias = [], vistas = new Set()
  for (const e of evs) {
    if (vistas.has(e.tarefa_id) || e.tipo !== 'image' || !e.arquivo_local || !IMAGEM.has(extname(e.arquivo_local).toLowerCase())) continue
    const abs = resolverArquivo(e.arquivo_local, { raizDados: base })   // local em data/evidencias ou 'frio:<sha256>' no FRIO_DIR (autogestão A4); fora do ar = sem print, nunca quebra
    if (!abs || (!ehFrio(e.arquivo_local) && !abs.startsWith(join(base, 'evidencias') + sep))) continue
    const bytes = statSync(abs).size
    if (bytes > (CFG_DOSSIE.max_bytes_evidencia || 1_500_000)) continue
    vistas.add(e.tarefa_id)
    evidencias.push({ tarefa_id: e.tarefa_id, legenda: e.legenda, criada_em: e.criada_em, arquivo: e.arquivo_local, abs, bytes, sha256: sha(readFileSync(abs)), no_livro: !!e.no_livro })
  }

  let medidas = []
  try {
    medidas = analisarCliente(cliente).medidas.filter(m => m.data >= de && m.data <= ate)
      .map(m => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, data: m.data, itens: m.itens, estado: m.estado, metrica_primaria: m.metrica_primaria || '', metricas: m.metricas, efeito_pct: m.efeito_pct, controle: m.controle, janelas: m.janelas, confianca: m.confianca?.classe || '' }))
  } catch (e) { log('erro', `dossiê ${cliente}: medição indisponível (${String(e?.message ?? e).slice(0, 80)})`) }

  const custos = tenta(() => custosDoCliente(cliente), null)
  let pendencias = { itens: [], registros: [], dependencias: [] }
  try { pendencias.itens = pendenciasReal().avaliar(cliente, { paraCliente: versao !== 'defesa' }).itens }
  catch { pendencias.erro = 'avaliador de pendências indisponível agora' }
  pendencias.registros = tenta(() => h.prepare('SELECT id, canal, item, desde, criada_em, resolvida_em FROM pendencia_cliente WHERE cliente = ?').all(cliente), [])
  pendencias.dependencias = tenta(() => h.prepare('SELECT tarefa_id, tipo, em, reaberta_em FROM tarefa_dependencia WHERE cliente = ?').all(cliente), [])

  const lotes = tenta(() => h.prepare("SELECT id, tipo, estado, enviado_em, canais_json, recibos_json, texto_final FROM gatilho_lote WHERE cliente = ? AND estado IN ('enviado','entregue','parcial') AND enviado_em <> ''").all(cliente), [])
    .map(l => ({ id: l.id, tipo: l.tipo, estado: l.estado, enviado_em: l.enviado_em, texto: l.texto_final, canais: parse(l.canais_json, []), recibos: Object.fromEntries(Object.entries(parse(l.recibos_json, {})).map(([k, v]) => [k, v?.estado || ''])) }))
    .map(l => ({ ...l, ancora: ehAncora(l) }))
  const lv = livroReal(), itensLivro = []
  for (let pg = 1; ; pg++) { const r = lv.listar({ cliente, de, ate, pagina: pg, por_pagina: 500 }); itensLivro.push(...r.itens); if (itensLivro.length >= r.total || !r.itens.length) break }
  const verificacao = lv.verificarCadeia(cliente)
  const ct = versao === 'defesa' ? contratosReal().ler(cliente) : { contrato: null, pagamentos: [] }

  return {
    hoje: dataNoFuso(Date.now(), CFG_DOSSIE.mensal?.fuso || 'America/Sao_Paulo'), equipe, tarefas, evidencias,
    evidencias_total: h.prepare("SELECT COUNT(*) n FROM evidencias e JOIN tarefas t ON t.id = e.tarefa_id WHERE t.cliente = ? AND t.arquivada = 0 AND t.status = 'concluida' AND t.data_conclusao BETWEEN ? AND ? AND (? = 'defesa' OR t.visivel_cliente <> 0)").get(cliente, de, ate, versao).n,
    coleta: h.prepare('SELECT dia, pedidos, truncado FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').all(cliente, antes, ate),
    serie: h.prepare('SELECT item_id, dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').all(cliente, antes, ate),
    itens: h.prepare('SELECT item_id, titulo, status, vis_de, vis_ate FROM meli_item WHERE cliente = ?').all(cliente),
    mudancas: tenta(() => h.prepare('SELECT item_id, dia, campo, de, para, fonte FROM meli_item_mudanca WHERE cliente = ? AND dia BETWEEN ? AND ?').all(cliente, de, ate), []),
    fotografias: tenta(() => h.prepare('SELECT COUNT(*) n FROM meli_item_snapshot WHERE cliente = ? AND substr(capturado_em, 1, 10) BETWEEN ? AND ?').get(cliente, de, ate).n, 0),
    medidas,
    ads: tenta(() => h.prepare('SELECT item_id, periodo, de, ate, prints, clicks, custo, receita, unidades FROM meli_ads_item WHERE cliente = ? AND de <= ? AND ate >= ?').all(cliente, ate, de), []),
    economia: custos ? economiaAds(custos) : null,
    custos_em: custos ? tenta(() => h.prepare('SELECT atualizado_em FROM custos_cliente WHERE cliente = ?').get(cliente)?.atualizado_em, '') || '' : '',
    saude: tenta(() => h.prepare('SELECT dia, level_id FROM meli_conta_saude WHERE cliente = ? AND dia <= ? AND level_id IS NOT NULL ORDER BY dia DESC LIMIT 1').get(cliente, ate), null) || null,
    relatorios: tenta(() => h.prepare("SELECT id, de, ate, estado, em, origem FROM relatorio_envio WHERE cliente = ? AND estado IN ('enviado','adotado')").all(cliente), []),
    lotes, cobrancas: tenta(() => h.prepare(`SELECT id, tipo, texto, enviado_em, resolvido_em, estado, lote_id FROM gatilho_cliente WHERE cliente = ? AND enviado_em <> '' AND tipo IN (${COBRANCA.map(() => '?').join(',')})`).all(cliente, ...COBRANCA), [])
      .map(g => ({ ...g, ancora: !!lotes.find(l => l.id === g.lote_id)?.ancora })),
    // o coletor de respostas lê este cliente? desde quando (1ª resposta coletada no sistema; sem nenhuma, não há como afirmar silêncio)
    coletor: { desde: tenta(() => h.prepare('SELECT 1 FROM feedback_coleta WHERE cliente = ?').get(cliente), null) ? tenta(() => h.prepare('SELECT MIN(coletado_em) m FROM feedback_relatorio').get()?.m, '') || '' : '' },
    resumos: tenta(() => h.prepare("SELECT id, tipo, chave, estado, enviado_em, texto FROM consultor_aviso WHERE cliente = ? AND estado IN ('enviado','entregue')").all(cliente), []),
    // origem 'equipe' = retorno colhido pela equipe em conversa (perfil-informacao.registrarFeedbackEquipe): o dossiê o mostra à parte, nunca como citação da nossa mensagem
    respostas: tenta(() => h.prepare("SELECT recebido_em, ancora_tipo, confianca, temas_json, origem FROM feedback_relatorio WHERE cliente = ? AND status <> 'descartado'").all(cliente), []).map(r => ({ ...r, temas: parse(r.temas_json, []), temas_json: undefined })),
    pendencias,
    // só ação APROVADA; a distribuída traz status/prazo/responsável da tarefa no Notion e o dono (caminho «cliente» = ação do cliente)
    plano: tenta(() => h.prepare(`SELECT a.titulo, a.responsavel, a.prazo, a.status, a.score, json_extract(a.dados_json, '$.execucao.caminho') caminho, t.status tarefa_status, t.prazo tarefa_prazo, t.responsavel tarefa_responsavel
      FROM acoes_plano a LEFT JOIN tarefas t ON a.notion_page_id <> '' AND t.id = a.notion_page_id WHERE a.cliente = ? AND a.status IN ('aprovada','distribuida')`).all(cliente), []),
    contrato: ct.contrato, pagamentos: ct.pagamentos,
    riscos: riscoReal().listar(cliente),
    livro: { itens: itensLivro, cabeca: verificacao.cabeca || null, verificacao: { ok: verificacao.ok, quebra: verificacao.quebra, lacunas: verificacao.lacunas },
      primeiro_registro: h.prepare('SELECT MIN(registrado_em) m FROM registro_cliente WHERE cliente = ?').get(cliente)?.m || '', anexos_pendentes: ing?.anexos_pendentes || 0,
      retratadas: h.prepare("SELECT substr(ref, 10) ref, fato_em em FROM registro_cliente WHERE cliente = ? AND tipo = 'nota' AND ref LIKE 'descarte:%'").all(cliente) },
    conta_ml: tenta(() => h.prepare('SELECT erro, atualizado_em FROM meli_contas WHERE cliente = ?').get(cliente), null) || null,
  }
}

// ── versão cliente → página «Relatório de Sprints Place2u · Prestação de contas · …» na Informações do cliente + PDF anexo (idempotente por título e por nome do anexo) ──
async function publicarNotion({ cliente, titulo, caminho }) {
  if (!tituloOk(titulo)) return { ok: false, motivo: 'titulo_invalido' }
  const nt = criarRelatorioNotion({ notion: { req: notionReq }, estado: estadoDeHandle(db), fontes: descobrirFontes, resolverPaginaCliente, acharInformacoesDb, invalidar: invalidarCliente, agora })
  try {
    const d = await nt.destinoDe(cliente)
    if (d.estado !== 'ok') return { ok: false, motivo: d.estado }                       // destino compartilhado também barra: nunca na base de outro cliente
    const pg = (await nt.acharPorTitulo(d, titulo))[0] || await nt.criar({ destino: d, titulo, categoria: CATEGORIA,
      blocos: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rt('Prestação de contas do período: execução registrada, indicadores do Mercado Livre e próximos passos. O documento completo está no PDF anexo.') } }] })
    await anexarPdf({ notionReq, page_id: pg.id, caminho })
    return { ok: true, url: pg.url }
  } catch (e) { const c = classificarErro(e); log('erro', `dossiê ${cliente}: Notion ${c.codigo}`); return { ok: false, motivo: c.codigo } }
}

export function criarDossiesReal({ raiz = RAIZ, handle = db } = {}) {
  const fuso = CFG_DOSSIE.mensal?.fuso || 'America/Sao_Paulo'
  const envio = criarEnvio({ env, agora, webhook: { ...WEBHOOK }, log })
  return criarDossies({
    handle, livro: livroReal(), raiz, agora, cfg: CFG_DOSSIE, log, notificar, cargos: CARGOS, slug,
    coletar: (cliente, o) => coletarDados(cliente, o, { handle }),
    render: { gerar: (d, o) => gerarArquivos(d, o) },
    hoje: () => dataNoFuso(Date.now(), fuso), hora: () => horaNoFuso(Date.now(), fuso),
    validarPor: validarDossie, validarChave: validarLiderOuConsultor,
    risco: riscoReal(), envio, estado: estadoDeHandle(handle), publicarNotion,
  })
}
let instancia = null
export const dossiesReal = () => instancia ||= criarDossiesReal()
