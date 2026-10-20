// Rotas HTTP do módulo Ofertas Estratégicas: /api/ofertas/*. Mesmo padrão de rotas-planos (trata/JSON, isolamento por cliente: toda rota exige
// `cliente` e um prospect "[Comercial] …" nunca é cliente) e fábrica com deps (rotas-ficha) para o teste rodar com banco em memória e ML stub.
// Publicação: dry-run por padrão; live exige { confirmar: true } E aprovação válida da versão (o fluxo checa). Segredos nunca saem daqui.
import { Router } from 'express'
import { validar as validarFiltro, desserializar as lerFiltro, chips as chipsFiltro } from './lib/filtros.js'
import { ESTADOS, ESCOPOS, OBJETIVOS, MODOS, CANAIS_OFERTA } from './lib/ofertas.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const um = v => String([].concat(v ?? '')[0] ?? '').trim()
const ehProspecto = c => /^\[Comercial\] /.test(String(c || ''))
const PRIORIDADES = ['alta', 'media', 'baixa']

// deps: fluxo (criarFluxo), of (criarOfertas), hoje() → AAAA-MM-DD
export function criarRotasOfertas({ fluxo, of, hoje = () => new Date().toISOString().slice(0, 10) }) {
  const r = Router()
  const trata = fn => async (req, res) => { try { await fn(req, res) } catch (e) { res.status(e.status || 400).json({ erro: e.message }) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const clienteDe = v => { const c = um(v); if (!c) throw erro('informe "cliente"'); if (ehProspecto(c)) throw erro('prospect do Comercial não é cliente deste módulo'); return c }
  const porDe = (b, campo = 'por') => { const p = String(b[campo] ?? '').trim().slice(0, 80); if (!p) throw erro(`informe "${campo}" (quem está fazendo — fica na auditoria)`); return p }
  const jobOu404 = (cliente, id) => { const j = of.obterJob(cliente, String(id)); if (!j) throw erro('job não encontrado', 404); return j }
  // trabalhos em segundo plano (publicação live após aprovação): id, estado, resultado — nunca guarda token
  const tarefas = new Map()
  const emSegundoPlano = (tipo, cliente, fn) => {
    const t = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, tipo, cliente, estado: 'rodando', inicio: new Date().toISOString(), resultado: null, erro: null }
    tarefas.set(t.id, t); for (const k of [...tarefas.keys()].slice(0, -50)) tarefas.delete(k)
    fn().then(x => { t.resultado = x; t.estado = 'concluido' }).catch(e => { t.erro = e.message; t.estado = 'erro' }).finally(() => { t.fim = new Date().toISOString() })
    return t
  }
  const filtroDe = q => {
    const f = q.f ? lerFiltro(um(q.f), { painel: 'ofertas', hoje: hoje() }) : validarFiltro({ painel: 'ofertas', periodo: { campo: um(q.data) || 'data_venda', preset: um(q.preset) || 'ultimos_90_dias', de: um(q.de), ate: um(q.ate), comparar: 'anterior' } }, { hoje: hoje() })
    if (!f.periodo) f.periodo = validarFiltro({ painel: 'ofertas', periodo: { campo: 'data_venda', preset: 'ultimos_90_dias', comparar: 'anterior' } }, { hoje: hoje() }).periodo
    return f
  }

  r.get('/api/ofertas/opcoes', trata((req, res) => res.json({ estados_job: Object.entries(ESTADOS).map(([id, e]) => ({ id, rotulo: e.rotulo, acao: e.acao, responsavel: e.responsavel })), escopos_oferta: ESCOPOS, objetivos: OBJETIVOS, modos: MODOS, canais: CANAIS_OFERTA, prioridades_oferta: PRIORIDADES })))
  r.get('/api/ofertas/capacidades', trata(async (req, res) => res.json(await fluxo.capacidades(clienteDe(req.query.cliente)))))

  // ── lista da seção 3 + CSV com o MESMO filtro (critério 16) ──
  r.get('/api/ofertas/anuncios', trata((req, res) => {
    const cliente = clienteDe(req.query.cliente), f = filtroDe(req.query)
    res.json({ disponivel: true, ...fluxo.listaAnuncios(cliente, f), filtro: { chips: chipsFiltro(f), serializado: um(req.query.f) || null } })
  }))
  const COLS_CSV = ['cliente', 'canal', 'conta', 'produto', 'sku', 'variacao', 'anuncio_id', 'variacao_externa_id', 'categoria', 'preco', 'margem_pct', 'margem_fonte', 'estoque', 'vendas_unidades', 'faturamento', 'consultor', 'analista', 'prioridade', 'status_rotulo', 'escopo', 'referencia_confirmada', 'ultima_sincronizacao', 'criado_em', 'otimizado_em', 'publicado_em', 'url']
  r.get('/api/ofertas/exportar.csv', trata((req, res) => {
    const cliente = clienteDe(req.query.cliente), f = filtroDe(req.query), d = fluxo.listaAnuncios(cliente, f)
    const cel = v => { let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x}"` }
    const csv = '﻿' + [`"Período";"${d.periodo.rotulo} · ${d.periodo.campo}";"Totais";"anúncios ${d.totais.anuncios}";"unidades ${d.totais.vendas_unidades}";"faturamento ${d.totais.faturamento}"`, COLS_CSV.map(cel).join(';'), ...d.itens.map(i => COLS_CSV.map(c => cel(i[c])).join(';'))].join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="ofertas-${cliente.replace(/\W+/g, '-')}.csv"`)
    res.send(csv)
  }))

  // ── cadastro: produto + variantes; planilha (prévia/aplicar); anúncio existente ──
  r.post('/api/ofertas/produtos', trata((req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    const p = of.criarProduto(cliente, b.produto || {}, { por })
    const variantes = [], erros = []
    for (const [i, v] of (Array.isArray(b.variantes) ? b.variantes : []).entries()) { try { variantes.push(of.criarVariante(cliente, { ...v, produto_id: p.id }, { por })) } catch (e) { erros.push({ indice: i, sku: v?.sku ?? '', erro: e.message }) } }
    res.status(201).json({ ok: true, produto: of.obterProduto(cliente, p.id), variantes, erros })
  }))
  r.post('/api/ofertas/importar-planilha', trata((req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    const r1 = of.importarPlanilha(cliente, b.linhas, { por, aplicar: b.aplicar === true })
    const r2 = Array.isArray(b.anuncios) && b.aplicar === true ? of.importarAnuncios(cliente, b.anuncios, { por }) : null
    res.json({ ok: true, previa: b.aplicar !== true, produtos: r1, anuncios: r2 })
  }))
  r.post('/api/ofertas/importar-anuncio', trata(async (req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    const id = String(b.anuncio_id || '').trim().toUpperCase()
    if (!/^[A-Z]{3}\d{1,15}$/.test(id)) throw erro('anuncio_id inválido (ex.: MLB1234567890)')
    const out = await fluxo.importarExistente(cliente, id, { por, variante_id: String(b.variante_id || ''), conta_id: String(b.conta_id || '') })
    res.status(out.ok ? 200 : 409).json(out)
  }))
  r.post('/api/ofertas/variantes/:id/confirmar-referencia', trata((req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    if (b.contestar) return res.json({ ok: true, variante: of.contestarReferencia({ cliente, variante_id: String(req.params.id), por, motivo: String(b.motivo || '') }) })
    res.json({ ok: true, variante: of.confirmarReferencia({ cliente, variante_id: String(req.params.id), por, origem_fotos: b.origem_fotos }) })
  }))
  r.post('/api/ofertas/regras', trata((req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    res.json({ ok: true, regra: of.registrarRegraCanal(cliente, b.regra || b, { por }) })
  }))
  r.post('/api/ofertas/custos', trata((req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b)
    res.json({ ok: true, custo: of.registrarCusto(cliente, b.custo || b, { por }) })
  }))

  // ── jobs: abrir (um ou lote, resultado individual), listar, detalhe ──
  r.post('/api/ofertas/jobs', trata(async (req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), solicitante = porDe(b, 'solicitante')
    const itens = Array.isArray(b.itens) ? b.itens : [{ variante_id: b.variante_id, anuncio_id: b.anuncio_id }]
    if (!itens.length || itens.length > 200) throw erro('itens: 1 a 200 por lote')
    // motor único: quando o fluxo expõe abrirJob, o job nasce ligado/convertido em ação do plano (acao_id) e com responsável pela ficha/medição
    const abrir = fluxo.abrirJob ? (c, o) => fluxo.abrirJob(c, o) : (c, o) => of.abrir({ cliente: c, ...o })
    // anúncio do Mercado Livre que a lista mostra mas ainda não foi importado: importa agora (leitura do canal), um por vez;
    // falha de importação vira erro do item — nunca job aberto em anúncio desconhecido
    const falhaImport = new Map()
    if (fluxo.importarExistente) {
      const ja = new Set(of.listarAnuncios(cliente).map(a => a.anuncio_id))
      for (const it of itens) {
        const s = String(it?.anuncio_id || '').trim().toUpperCase()
        if (!/^[A-Z]{3}\d{1,15}$/.test(s) || ja.has(s) || falhaImport.has(s)) continue
        try { const out = await fluxo.importarExistente(cliente, s, { por: solicitante }); if (out.ok) ja.add(s); else falhaImport.set(s, `não foi possível importar o anúncio: ${out.erro || out.classe || 'erro no canal'}`) }
        catch (e) { falhaImport.set(s, `não foi possível importar o anúncio: ${e.message}`) }
      }
    }
    // a tela manda o código do canal (MLB…); o job usa o id interno do anúncio importado — resolve aqui, sempre dentro do cliente
    const internos = of.listarAnuncios(cliente)
    const interno = v => { const s = String(v || '').trim(); if (!s) return ''; if (/^[A-Z]{3}\d{1,15}$/i.test(s)) { const a = internos.find(x => x.anuncio_id === s.toUpperCase()); return a ? a.id : s } return s }
    const varianteDe = (anuncioInterno, v) => String(v || '') || (internos.find(x => x.id === anuncioInterno)?.variante_id || '')
    const resultado = itens.map(it => { try { const f = falhaImport.get(String(it?.anuncio_id || '').trim().toUpperCase()); if (f) throw new Error(f); const an = interno(it?.anuncio_id); const r0 = abrir(cliente, { variante_id: varianteDe(an, it?.variante_id), anuncio_id: an, escopo: b.escopo, objetivo: b.objetivo, modo: b.modo || 'publicar_apos_aprovacao', solicitante, responsavel: String(b.responsavel || ''), acao_id: String(it?.acao_id || b.acao_id || ''), briefing: b.briefing || null }); const j = r0.job || r0; return { ok: true, job_id: j.id, estado: j.estado, variante_id: j.variante_id, anuncio_id: j.anuncio_id, acao_id: j.acao_id || r0.acao?.id || '', responsavel: j.responsavel || '' } } catch (e) { return { ok: false, variante_id: it?.variante_id || '', anuncio_id: it?.anuncio_id || '', erro: e.message } } })
    res.status(201).json({ abertos: resultado.filter(x => x.ok).length, falhas: resultado.filter(x => !x.ok).length, itens: resultado })
  }))
  r.get('/api/ofertas/jobs', trata((req, res) => { const cliente = clienteDe(req.query.cliente); res.json({ jobs: of.listarJobs(cliente, { estado: um(req.query.estado), variante_id: um(req.query.variante_id) }), estados: ESTADOS }) }))
  r.get('/api/ofertas/jobs/:id', trata((req, res) => {
    const cliente = clienteDe(req.query.cliente), job = jobOu404(cliente, req.params.id)
    const versoes = of.listarPropostas(cliente, job.id)
    const anterior = versoes.length > 1 ? versoes[versoes.length - 2].conteudo : null, atual = job.proposta?.conteudo || null
    const diff = atual ? Object.keys(atual).filter(k => k !== 'mudancas').map(k => ({ campo: k, antes: k === 'preco' ? anterior?.preco?.preco_proposto ?? null : anterior?.[k] ?? null, depois: k === 'preco' ? atual.preco?.preco_proposto ?? null : atual[k], mudou: JSON.stringify(anterior?.[k] ?? null) !== JSON.stringify(atual[k]) })) : []
    res.json({ job, versoes: versoes.map(v => ({ versao: v.versao, criado_por: v.criado_por, criado_em: v.criado_em, campos: Object.keys(v.conteudo).filter(k => k !== 'mudancas') })), diff_versoes: diff, antes_depois: atual?.mudancas || [], diagnostico: job.proposta?.diagnostico || null, baseline: job.proposta ? { ...job.proposta.baseline, snapshot: undefined } : null, eventos: of.eventos(cliente, { entidade: 'job', entidade_id: job.id, limite: 200 }), imagens: of.listarImagens(cliente, { job_id: job.id }) })
  }))

  // ── etapas do job ──
  r.post('/api/ofertas/jobs/:id/preparar', trata((req, res) => { const b = json(req), cliente = clienteDe(b.cliente); jobOu404(cliente, req.params.id); res.json(fluxo.prepararEstrategia(cliente, String(req.params.id), { por: porDe(b), margem_alvo_pct: b.margem_alvo_pct })) }))
  r.post('/api/ofertas/jobs/:id/revisar', trata((req, res) => { const b = json(req), cliente = clienteDe(b.cliente); jobOu404(cliente, req.params.id); res.json(fluxo.revisar(cliente, String(req.params.id), b.edicoes || {}, { por: porDe(b) })) }))
  r.post('/api/ofertas/jobs/:id/aprovar', trata(async (req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), autor = porDe(b, 'autor'); jobOu404(cliente, req.params.id)
    if (b.decisao === 'reprovar') return res.json(fluxo.reprovar(cliente, String(req.params.id), { motivo: String(b.motivo || ''), autor }))
    const out = fluxo.aprovar(cliente, String(req.params.id), { versao: Number(b.versao), campos: b.campos, autor })
    // modo "publicar após aprovação": enfileirado → publica live em segundo plano, sem segundo clique (critério 10)
    if (out.enfileirado) out.publicacao = { tarefa: emSegundoPlano('publicar', cliente, () => fluxo.publicar(cliente, String(req.params.id), { live: true, por: autor })).id, nota: 'publicação live iniciada automaticamente (acompanhe em /api/ofertas/tarefas/:id ou no job)' }
    res.json(out)
  }))
  r.post('/api/ofertas/jobs/:id/publicar', trata(async (req, res) => {
    const b = json(req), cliente = clienteDe(b.cliente), por = porDe(b); jobOu404(cliente, req.params.id)
    const live = b.live === true
    if (live && b.confirmar !== true) throw erro('publicação live exige { confirmar: true } (sem isso é sempre dry-run)')
    res.json(await fluxo.publicar(cliente, String(req.params.id), { live, por }))
  }))
  r.post('/api/ofertas/jobs/:id/conferir', trata(async (req, res) => { const b = json(req), cliente = clienteDe(b.cliente); jobOu404(cliente, req.params.id); res.json(await fluxo.conferir(cliente, String(req.params.id), { por: porDe(b) })) }))
  r.post('/api/ofertas/jobs/:id/monitorar', trata((req, res) => { const b = json(req), cliente = clienteDe(b.cliente); jobOu404(cliente, req.params.id); res.json(fluxo.monitorar(cliente, String(req.params.id), { por: porDe(b) })) }))
  r.post('/api/ofertas/jobs/:id/cancelar', trata((req, res) => { const b = json(req), cliente = clienteDe(b.cliente); jobOu404(cliente, req.params.id); res.json(fluxo.cancelar(cliente, String(req.params.id), { motivo: String(b.motivo || ''), por: porDe(b) })) }))
  r.get('/api/ofertas/tarefas/:id', trata((req, res) => { const t = tarefas.get(req.params.id); if (!t || t.cliente !== clienteDe(req.query.cliente)) throw erro('tarefa não encontrada', 404); res.json(t) }))

  // ── imagens: gerar (pendente sem provedor) e decidir candidata ──
  r.post('/api/ofertas/imagens/gerar', trata(async (req, res) => { const b = json(req), cliente = clienteDe(b.cliente); res.json(await fluxo.gerarImagens(cliente, { job_id: String(b.job_id || ''), papel: String(b.papel || 'capa'), briefing: String(b.briefing || ''), n: Math.min(4, Math.max(1, Number(b.n) || 1)), por: porDe(b) })) }))
  r.post('/api/ofertas/imagens/:id/decidir', trata((req, res) => { const b = json(req), cliente = clienteDe(b.cliente); res.json({ ok: true, imagem: of.decidirImagem(cliente, String(req.params.id), { status: b.status, motivo: String(b.motivo || ''), por: porDe(b) }) }) }))
  return r
}

// pronto para o servidor (PS_OFERTAS_MEMORIA=1 → null: o teste monta a fábrica com banco em memória)
export const rotasOfertas = process.env.PS_OFERTAS_MEMORIA === '1' ? null : await (async () => {
  const [{ fluxoPronto }, { ofertas }, { hojeLocal }] = await Promise.all([import('./lib/ofertas-fluxo.js'), import('./lib/ofertas.js'), import('./lib/db.js')])
  return criarRotasOfertas({ fluxo: await fluxoPronto(), of: ofertas, hoje: hojeLocal })
})()
