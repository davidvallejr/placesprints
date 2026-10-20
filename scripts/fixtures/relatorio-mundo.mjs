// Mundo sintético dos autotestes do relatório ao Notion: stub do Notion (grava as chamadas, injeta falhas), relógio falso e brief de mentira.
// Nenhuma rede, nenhum banco real. Usado por teste-relatorio-notion.mjs, teste-relatorio-envio.mjs e teste-relatorio-rotas.mjs.
import Database from 'better-sqlite3'
import { CATEGORIA } from '../../src/lib/relatorio-seguro.js'
import { somarDias, criarRelatorioEnvio, estadoDeHandle, lerConfig } from '../../src/lib/relatorio-envio.js'
import { anexarPdf } from '../../src/lib/relatorio-pdf.js'

export const QUEM = ['Giovanna Torres', 'Carla Souza']
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
export const validarPor = v => QUEM.find(q => norm(q) === norm(v)) || ''
export const SEGREDO = 'CORPO-SECRETO-DO-NOTION-123'

// relógio: ms é o instante real (UTC); hoje()/hora() são o dia e a hora de São Paulo (UTC-3 fixo) — nada depende do fuso da máquina
export function criarRelogio(hoje = '2026-10-16', hora = '17:00') {
  const r = { ms: Date.parse(`${hoje}T${hora}:00-03:00`) }
  r.agora = () => new Date(r.ms).toISOString()
  r.hoje = () => new Date(r.ms - 3 * 3600e3).toISOString().slice(0, 10)
  r.hora = () => new Date(r.ms - 3 * 3600e3).toISOString().slice(11, 16)
  r.avancarMin = n => { r.ms += n * 60_000 }
  r.ir = (h, hr) => { r.ms = Date.parse(`${h}T${hr}:00-03:00`) }
  return r
}

// id de 32 hex único por (prefixo, n): o contador entra com largura fixa (antes, 'd1' e 'd10' viravam o mesmo id a partir do 16º cliente)
const hex = (pref, n) => (pref + n.toString(16).padStart(8, '0')).padEnd(32, '0')
const NE = status => Object.assign(new Error(`Notion ${status} em x: {"message":"${SEGREDO}"}`), { status, corpo: SEGREDO })
export const propsInformacoes = ({ secao = 'select', opcaoCategoria = false, concluido = true } = {}) => ({
  Name: { type: 'title', title: {} },
  Status: { type: 'select', select: { options: [{ name: 'Pendente' }, ...(concluido ? [{ name: 'Concluído' }] : [])] } },
  'Status 1': { type: 'status', status: { options: [{ name: 'Não iniciada' }] } },
  ...(secao ? { 'Secção ': { type: secao, [secao]: { options: [{ name: 'Plano de Ação' }, ...(opcaoCategoria ? [{ name: CATEGORIA }] : [])] } } } : {}),
  'Lista ': { type: 'multi_select', multi_select: { options: [] } },
  'Link ': { type: 'url', url: {} },
})

// quadro «Tarefas - {Cliente}» (PLANO B): o schema padrão da Place2u; `canal: 'status'` troca o tipo da coluna Canal (status sem a opção «Geral»); `semResp` tira a coluna de pessoas
export const propsQuadro = ({ canal = 'select', semResp = false, semDesc = false } = {}) => ({
  Tarefas: { type: 'title', title: {} },
  Canal: { type: canal, [canal]: { options: canal === 'select' ? [{ name: 'Mercado Livre' }, { name: 'Geral' }] : [{ name: 'Mercado Livre' }] } },
  Demandas: { type: 'select', select: { options: [{ name: 'Cadastro' }] } },
  ...(semResp ? {} : { 'Responsável': { type: 'people', people: {} } }),
  ...(semDesc ? {} : { 'Descrição': { type: 'rich_text', rich_text: {} } }),
  Data: { type: 'date', date: {} },
  Status: { type: 'status', status: { options: [{ name: 'Não iniciada' }] } },
})
export const PAMELA_ID = '0a1b2c3d-0000-4000-8000-00000000c0de'
export const USUARIOS = [{ id: PAMELA_ID, nome: 'Pamela Vitoria Barros' }, { id: '0a1b2c3d-0000-4000-8000-00000000c0df', nome: 'Carla Souza' }]

export function criarMundo() {
  const w = { cfgCli: new Map(), fontes: [], chamadas: [], invalidados: [], chamadasInfo: [], falhas: { criar: [], query: [], arquivar: [], anexar: [] }, paginasDs: new Map(), seq: 0, idPagina: new Map(), idInfo: new Map(), idDs: new Map(), idQuadro: new Map(), infoDePagina: new Map() }
  let n = 0
  // configura um cliente: secao 'select' | 'status' | null; opcaoCategoria; base (tem Informações); pagina ('ok' | '404' | 'arquivada' | '403'); semFonte;
  // quadro: true | { canal:'status', semResp, semDesc } → o dbId da fonte responde como quadro «Tarefas - {Cliente}» (padrão false: quadro desconhecido = 404, como antes)
  w.adicionar = (nome, o = {}) => {
    const c = { secao: 'select', opcaoCategoria: false, concluido: true, base: true, pagina: 'ok', semFonte: false, quadro: false, ...o }
    n++
    c.pagina_id = o.paginaId || hex('a', n); c.info_id = hex('b', n); c.ds_id = o.dsId || hex('c', n); c.quadro_id = o.dbId || hex('d', n)
    w.cfgCli.set(nome, c)
    w.idPagina.set(c.pagina_id, nome); w.idInfo.set(c.info_id, nome); w.idDs.set(c.ds_id, nome)
    if (c.quadro) { w.idQuadro.set(c.quadro_id, nome); if (!w.paginasDs.has(c.quadro_id)) w.paginasDs.set(c.quadro_id, []) }
    if (!c.semFonte) w.fontes.push({ cliente: nome, dbId: c.quadro_id, modo: 'data_source', paginaClienteId: '' })
    if (c.base) w.infoDePagina.set(c.pagina_id, c.info_id)
    if (!w.paginasDs.has(c.ds_id)) w.paginasDs.set(c.ds_id, [])
    return c
  }
  const dsDe = ds => w.paginasDs.get(ds) || []
  w.chamadasDe = (m, ini = '') => w.chamadas.filter(c => c.method === m && c.caminho.startsWith(ini))
  w.criadas = () => w.chamadasDe('POST', 'pages').length
  w.paginasVivas = ds => dsDe(ds).filter(p => !p.archived)
  w.limpar = () => { w.chamadas.length = 0 }

  const req = async (caminho, { method = 'GET', body, retry5xx } = {}) => {
    w.chamadas.push({ caminho, method, body, retry5xx })
    let m
    if (method === 'GET' && (m = caminho.match(/^blocks\/([^/]+)\/children/))) {         // filhos da página (anexo do PDF): os blocos do corpo + os anexados
      for (const lista of w.paginasDs.values()) for (const p of lista) if (p.id === m[1]) return { results: (p.body.children || []).map((b, i) => ({ id: `${p.id}-b${i}`, ...b })) }
      throw NE(404)
    }
    if (method === 'GET' && (m = caminho.match(/^pages\/(.+)$/))) {
      const nome = w.idPagina.get(m[1]); const c = nome && w.cfgCli.get(nome)
      if (!c || c.pagina === '404') throw NE(404)
      if (c.pagina === '403') throw NE(403)
      return { object: 'page', id: m[1], archived: c.pagina === 'arquivada', in_trash: false, properties: { title: { type: 'title', title: [{ plain_text: `Página de ${nome}` }] } } }
    }
    if (method === 'GET' && (m = caminho.match(/^databases\/(.+)$/))) {
      const nome = w.idInfo.get(m[1]); const c = nome && w.cfgCli.get(nome)
      if (!c) throw NE(404)
      return { object: 'database', id: m[1], url: `https://www.notion.so/${m[1]}`, data_sources: [{ id: c.ds_id, name: 'Informações' }] }
    }
    if (method === 'GET' && (m = caminho.match(/^data_sources\/(.+)$/))) {
      const q = w.idQuadro.get(m[1]); if (q) return { object: 'data_source', id: m[1], url: `https://www.notion.so/${m[1]}`, properties: propsQuadro(w.cfgCli.get(q).quadro === true ? {} : w.cfgCli.get(q).quadro) }
      const nome = w.idDs.get(m[1]); const c = nome && w.cfgCli.get(nome)
      if (!c) throw NE(404)
      return { object: 'data_source', id: m[1], properties: propsInformacoes(c) }
    }
    if (method === 'PATCH' && (m = caminho.match(/^blocks\/(.+)\/children$/))) {
      const f = w.falhas.anexar.shift(); if (f) throw NE(f.status)
      for (const lista of w.paginasDs.values()) for (const p of lista) if (p.id === m[1]) {
        const atuais = p.body.children || [], pos = body.after ? atuais.findIndex((_, i) => `${p.id}-b${i}` === body.after) : -1   // `after` = insere logo depois daquele bloco
        p.body.children = pos >= 0 ? [...atuais.slice(0, pos + 1), ...(body.children || []), ...atuais.slice(pos + 1)] : [...atuais, ...(body.children || [])]
      }
      return { results: [] }
    }
    if (method === 'POST' && (m = caminho.match(/^data_sources\/(.+)\/query$/))) {
      const f = w.falhas.query.shift(); if (f) throw NE(f.status)
      const alvo = body?.filter?.title?.equals
      return { results: dsDe(m[1]).filter(p => p.titulo === alvo).map(p => ({ id: p.id, url: p.url, created_time: p.created_time, archived: p.archived, in_trash: false })) }
    }
    if (method === 'POST' && caminho === 'pages') {
      const f = w.falhas.criar.shift()
      const ds = body.parent.data_source_id
      const nome = w.idDs.get(ds) || w.idQuadro.get(ds)
      const tituloChave = Object.entries(body.properties).find(([, v]) => v.title)[0]
      const criar = () => {
        const id = hex('e', ++w.seq), p = { id, url: `https://www.notion.so/${id}`, titulo: body.properties[tituloChave].title.map(t => t.text.content).join(''), created_time: new Date(Date.UTC(2026, 9, 16, 20, w.seq)).toISOString(), archived: false, body: { ...body, children: [...(body.children || [])] } }   // cópia: o anexo do PDF muda os filhos sem tocar a chamada gravada
        dsDe(ds).push(p); return p
      }
      if (f) { if (f.cria) criar(); throw NE(f.status) }
      if (!nome) throw NE(404)
      const p = criar()
      return { id: p.id, url: p.url }
    }
    if (method === 'PATCH' && (m = caminho.match(/^pages\/(.+)$/))) {
      const f = w.falhas.arquivar.shift(); if (f) throw NE(f.status)
      for (const lista of w.paginasDs.values()) for (const p of lista) if (p.id === m[1]) p.archived = body.archived === true
      return { id: m[1], archived: true }
    }
    throw NE(500)
  }

  // dependências de descoberta (o que server.js liga a descobrirFontes + plano-informacoes)
  w.destinos = {
    fontes: async () => w.fontes,
    resolverPaginaCliente: async ({ cliente, forcar }) => {
      const c = w.cfgCli.get(cliente); if (!c) return null
      if (c.velha && !forcar && !c.revalidada) return c.velha                // cache velho: id que já não existe
      const id = c.pagina_id_resolvido ?? c.pagina_id
      if (w.estado && id) w.estado.set(`pagina_cliente:${cliente}`, id)      // como o resolvedor real: a página resolvida fica em cache (é o que o relatório usa para achar quem divide a página)
      return id
    },
    acharInformacoesDb: async (pagina, opts) => {
      w.chamadasInfo.push(opts)
      const cliente = w.idPagina.get(pagina), c = cliente && w.cfgCli.get(cliente)
      if (c?.lancaPaginaInvalida) throw Object.assign(new Error('Block does not support children'), { name: 'PaginaInvalida', status: 400 })
      return w.infoDePagina.get(pagina) ?? null
    },
    invalidar: (cliente, pagina) => { w.invalidados.push([cliente, pagina]); const c = w.cfgCli.get(cliente); if (c?.velha) c.revalidada = true; if (w.estado) w.estado.set(`pagina_cliente:${cliente}`, '') },
  }
  w.notion = { req }
  // documento PDF: stub do Chrome (nunca roda o Chrome real) e do upload (File Upload API); `w.falhas.pdf`/`w.falhas.upload` injetam falha (uma por chamada)
  w.pdfs = []; w.uploads = []; w.falhas.pdf = []; w.falhas.upload = []
  w.pdf = {
    dir: '/tmp/relatorio-pdf-stub',
    gerar: async (html, destino) => { const f = w.falhas.pdf.shift(); if (f) throw Object.assign(new Error('pdf'), { codigo: f }); w.pdfs.push({ destino, html }); return destino },
    anexar: o => anexarPdf({ ...o, subir: async caminho => { const f = w.falhas.upload.shift(); if (f) throw NE(f); w.uploads.push(caminho); return `fu-${w.uploads.length.toString(16).padStart(32, '0')}` } }),
  }
  return w
}

// brief sintético no contrato de docs/contrato-relatorio-envio.md (janela = 7 dias FECHADOS terminando ontem)
export function briefSintetico(cliente, { hoje = '2026-10-16', hora = '17:00', modo = 'completo', qualidadeOk = true, extra = {} } = {}) {
  const de = somarDias(hoje, -7), ate = somarDias(hoje, -1)
  const dm = i => i.slice(8) + '/' + i.slice(5, 7), dma = i => dm(i) + '/' + i.slice(0, 4)
  const rotulo = `${dm(de)} a ${dma(ate)}`
  const b = {
    versao: 1, cliente, hoje, hora,
    janela: { de, ate, anterior: { de: somarDias(de, -7), ate: somarDias(de, -1) }, rotulo },
    titulo: `${CATEGORIA} · ${rotulo}`,
    modo, qualidade: { ok: qualidadeOk, motivos: qualidadeOk ? [] : ['O Mercado Livre não respondeu na geração deste relatório'] },
    abertura: { tom: 'verde', cabecalho: 'Conta em crescimento', frase: 'Faturamento +12,4% nos últimos 14 dias (R$ 31.200,00 contra R$ 27.760,00).', nudge: 'Próximo marco: 21/10 — novas fotos do kit' },
    resultados: { disponivel: modo !== 'sem_resultados', motivo: modo === 'sem_resultados' ? 'Conta do Mercado Livre ainda não conectada ao relatório; nenhum número foi estimado.' : null,
      linhas: modo === 'sem_resultados' ? [] : [
        { chave: 'faturamento', rotulo: 'Faturamento', atual: 'R$ 14.920,00', anterior: 'R$ 13.410,00', variacao: { texto: '▲ 11,3%', sinal: 'bom' } },
        { chave: 'vendas', rotulo: 'Pedidos pagos', atual: '115', anterior: '120', variacao: { texto: '▼ 4,2%', sinal: 'ruim' } },
        { chave: 'cancelamentos', rotulo: 'Pedidos cancelados', atual: '—', anterior: '—', variacao: null }],
      hoje: modo === 'sem_resultados' ? null : { ate_hora: hora, faturamento: 'R$ 320,00', pedidos: 4 }, nao_coletado: modo === 'sem_resultados' ? [] : ['pedidos cancelados (não retornado pelo Mercado Livre)'], outros: [] },
    atividades: { lista: true, concluido: { total: 2, por_canal: [{ canal: 'Mercado Livre', n: 2 }], grupos: [{ rotulo: 'Novas fotos do kit de jardinagem', canal: 'Mercado Livre', quando: '03/10', n: 1 }, { rotulo: 'Revisão de títulos', canal: 'Mercado Livre', quando: '02/10 a 06/10', n: 4 }] },
      andamento: { total: 1, itens: [{ rotulo: 'Ficha técnica da linha de mangueiras', canal: 'Mercado Livre', previsto: '2026-10-21' }], promocoes: [{ rotulo: 'Oferta do dia', ate: '2026-10-20' }] } },
    desenvolvimento: { resultados: [{ rotulo: 'Novas fotos do kit de jardinagem', canal: 'Mercado Livre', quando: '30/09', metrica: { rotulo: 'Faturamento adicional (causa provável)', texto: '+ R$ 1.240' }, selo: 'medido', confianca: { nivel: 'média', pct: 72 } }],
      vazio_resultados: null, mudancas: [{ quando: '03/10', texto: 'Preço ajustado em 3 anúncios (−4% a −8%)' }], vazio_mudancas: null },
    proximos: { itens: [{ quando: '2026-10-21', rotulo: 'Novas fotos do kit de jardinagem', origem: 'acao' }], radar: [{ quando: '2026-11-02', rotulo: 'preparar a Black Friday (27/11)', origem: 'calendario' }], agenda: null, vazio: null },
    depende: { itens: [{ rotulo: 'Fotos do produto: enviar as fotos do kit novo', desde: '2026-10-09', dias: 7 }] },
    rodape: ['Últimos 7 dias fechados.', '“—” significa que o dado não foi coletado nesta semana; nunca é zero.', 'Leitura indicativa dos números; não representa promessa de resultado futuro.'],
    _interno: { avisos: ['interno'], omitidos: {} },
  }
  return { ...b, ...extra }
}
// brief de mentira: gerar(cliente, { hoje, agora }) → brief do dia; `atraso` simula o Mercado Livre lento; `falhar` lança
export function criarBriefFalso({ relogio, atraso = null, extra = {}, porCliente = {}, modo = 'completo', qualidadeOk = true } = {}) {
  const f = { chamadas: 0, falhar: null, atraso, modo, qualidadeOk, extra, porCliente }
  f.gerar = async (cliente, { hoje } = {}) => {
    f.chamadas++
    if (f.atraso) await f.atraso(cliente)
    if (f.falhar) throw f.falhar
    const hr = relogio ? relogio.hora() : '17:00'
    return briefSintetico(cliente, { hoje: hoje || (relogio ? relogio.hoje() : '2026-10-16'), hora: hr, modo: f.modo, qualidadeOk: f.qualidadeOk, extra: { ...f.extra, ...(f.porCliente[cliente] || {}) } })
  }
  return f
}

// monta o núcleo de envio sobre o mundo: banco :memory:, relógio, brief falso, notificações e logs capturados
// notificar: substitui o coletor de avisos (ex.: um que lança erro); semRelogioInjetado: não passa hoje()/hora() ao núcleo (usa o padrão do módulo: dia e hora de agora() em cfg.fuso); clienteCanonico: como o server.js (resolve o nome na central, mesmo Congelado)
export function montarEnvio({ clientes = [['Acme', {}]], brief = {}, cfg = {}, elegiveis, nomes = ['Giovanna Torres', 'Carla Souza'], hoje, hora, semRelogioInjetado = false, clienteCanonico, notificar, usuarios = USUARIOS } = {}) {
  const w = criarMundo(), relogio = criarRelogio(hoje, hora)
  for (const [nome, o] of clientes) w.adicionar(nome, { secao: 'select', opcaoCategoria: true, ...o })
  const h = new Database(':memory:'), bf = criarBriefFalso({ relogio, ...brief }), logs = [], notifs = []
  w.estado = estadoDeHandle(h)
  for (const [nome] of clientes) w.estado.set(`pagina_cliente:${nome}`, w.cfgCli.get(nome).pagina_id)     // a "carteira já foi verificada": cada cliente tem a página em cache (testes que querem cache vazio o esvaziam)
  const e = criarRelatorioEnvio({ handle: h, notion: w.notion, brief: bf, destinos: w.destinos, nomesInternos: () => nomes, agora: relogio.agora, ...(semRelogioInjetado ? {} : { hoje: relogio.hoje, hora: relogio.hora }), clienteCanonico,
    validarPor, notificar: notificar || (o => notifs.push(o)), log: (nv, m) => logs.push(`${nv}: ${m}`), elegiveis: elegiveis || (() => clientes.map(([nome]) => ({ cliente: nome, status: 'Ativo' }))), cfg: { ...lerConfig(), ...cfg }, usuarios: () => usuarios, pdf: w.pdf })
  return { w, h, relogio, bf, e, logs, notifs, estado: w.estado }
}
export const confirmar = async (e, cliente, o = {}) => { const p = await e.enviar(cliente, {}); return e.enviar(cliente, { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id, ...o }) }
export const linhasEnvio = h => h.prepare('SELECT * FROM relatorio_envio ORDER BY id').all()
export const esperar = async (cond, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('esperar: tempo esgotado'); await new Promise(r => setTimeout(r, 5)) } }
