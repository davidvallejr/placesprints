// Adaptador do Mercado Livre para o módulo Ofertas Estratégicas — a ÚNICA porta de ESCRITA do módulo no ML.
// Espírito de promocoes-exec.js: dry-run por padrão (live === true explícito), relê o item antes de gravar e
// compara com o snapshot do diagnóstico (mudou fora → conflito_externo), grava SÓ os campos aprovados no escopo,
// um PUT por grupo de campos (galeria · ficha · título · preço · descrição) para a falha parcial ser por grupo,
// nunca reenvia o que já saiu na janela de propagação, nunca exclui anúncio. O adaptador NÃO grava no banco:
// devolve `registros` (um por chamada) para o core gravar em of_publicacao.
//
// Documentação verificada em 07/10/2026 (developers.mercadolivre.com.br; páginas lidas por curl, WebFetch recebe 403):
//  · atributos: GET /categories/{id}/attributes com tags (required, read_only, hidden, variation_attribute,
//    conditional_required, catalog_required); gravação como attributes:[{id, value_name}]  — VERIFICADO
//  · descrição: GET /items/{id}/description; criar = POST {plain_text}; substituir = PUT …/description?api_version=2 — VERIFICADO
//  · variações: PUT /items/{id} com `variations` precisa listar os ids das variações existentes (as não listadas
//    saem); picture_ids por variação — VERIFICADO (página "variacoes")
//  · User Products: PUT em /items replica title/attributes/pictures em todos os itens do mesmo UP de forma
//    assíncrona; no modelo novo o título não é enviado na publicação (family_name) — VERIFICADO (página "user-products")
//  · imagens: a página oficial "imagens" respondeu 404 em 07/10/2026 → POST /pictures/items/upload (multipart `file`),
//    limites de tamanho/quantidade e a troca da pictures[0] pelo ML vêm da prática registrada na skill oferta-mkt — A CONFIRMAR
//  · título travado após a 1ª venda e janela de 60 caracteres: regra histórica da skill, não achada na doc — A CONFIRMAR
//    (o adaptador trata como bloqueio conservador: pode.titulo = false quando sold_quantity > 0)
//  · tarifas: GET /sites/MLB/listing_prices?price=&category_id=&listing_type_id= — endpoint conhecido do repo, campos
//    mapeados de forma defensiva; se a API falhar o resultado é 'a confirmar', nunca um número inventado
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGO } from './catalogo-cfg.js'
import { validarEstoqueFisico, MOTIVOS_ESTOQUE_FISICO } from './produto-estoque.js'

const BASE = 'https://api.mercadolibre.com'
const TIMEOUT_MS = 30_000
export const ESPERA_PROPAGACAO_MIN = 30
const dormir = ms => new Promise(r => setTimeout(r, ms))
const arred2 = n => Math.round(Number(n) * 100) / 100

export const CAMPOS_POR_ESCOPO = {
  oferta_completa: ['titulo', 'descricao', 'atributos', 'preco', 'galeria'],
  titulo_descricao: ['titulo', 'descricao'],
  ficha: ['atributos'],
  preco: ['preco'],
  imagem_avulsa: ['galeria'],
  galeria: ['galeria'],
}
// identificadores e certificações nunca entram num payload de ficha (divergência é pergunta ao operador, não conserto)
export const ATRIBUTOS_INTOCAVEIS = ['GTIN', 'EAN', 'UPC', 'ISBN', 'JAN', 'GTIN14', 'SELLER_SKU', 'ANATEL_HOMOLOGATION_NUMBER', 'ANVISA_REGISTRATION_NUMBER', 'INMETRO_CERTIFICATION']
// MPN/fabricante/marca representam o atributo real: termo promocional ali é reprovado (spec §2 e critério 8)
const CAMPOS_FACTUAIS = ['MPN', 'MANUFACTURER', 'BRAND', 'MODEL', 'ALPHANUMERIC_MODEL']
const TERMO_PROMOCIONAL = /\b(promo[cç][aã]o|oferta|frete gr[aá]tis|barato|desconto|black friday|dia d[aoe]s? |presente|lan[cç]amento|imperd[ií]vel|melhor pre[cç]o)\b/i
export const REGRAS_IMAGEM_ML = { lado_min: 500, lado_recomendado: 1200, quadrado_capa: true, formatos: ['jpeg', 'png'], bytes_max: 10 * 1024 * 1024, texto_na_capa: false,
  fonte: 'prática registrada na skill oferta-mkt (capa 1200×1200 JPEG; ML troca pictures[0] não quadrada) — limites oficiais A CONFIRMAR (página de imagens indisponível em 07/10/2026)' }

// 2xx ≠ publicado. Cada classe leva a um estado de job diferente (nunca "em processamento" genérico).
export function classificarErro(status) {
  if (status === 401) return 'credencial_expirada'
  if (status === 403) return 'sem_permissao'
  if (status === 400 || status === 422) return 'validacao_rejeitada'
  if (status === 429) return 'limite_uso'
  if (status === 0 || status === 409 || status === 504) return 'processamento_pendente'   // pode ter gravado: consultar antes de repetir
  if (status >= 500) return 'transitorio'
  return 'validacao_rejeitada'
}
export const ESTADO_POR_CLASSE = { credencial_expirada: 'falha_recuperavel', sem_permissao: 'falha_recuperavel', validacao_rejeitada: 'falha_recuperavel', limite_uso: 'aguardando_canal', processamento_pendente: 'aguardando_canal', transitorio: 'falha_recuperavel' }
const PENDENCIA_POR_CLASSE = {
  credencial_expirada: 'credencial do Mercado Livre expirada ou revogada: reconectar a conta em Integrações e retomar',
  sem_permissao: 'a conta/app não tem permissão para esta operação (403): conferir escopos da conexão ou se o anúncio é de outra conta',
  validacao_rejeitada: 'o Mercado Livre rejeitou o conteúdo (400): corrigir a proposta conforme `cause` da resposta e reenviar só o grupo rejeitado',
  limite_uso: 'limite de uso da API (429): aguardar e retomar — nada foi reenviado',
  processamento_pendente: 'o canal não confirmou (timeout/409): conferir por leitura antes de qualquer reenvio',
  transitorio: 'erro transitório do canal (5xx): retomar mais tarde só o que não foi enviado',
}
const resumoErro = corpo => typeof corpo === 'string' ? corpo.slice(0, 300) : [corpo?.message, ...(corpo?.cause || []).map(c => c.code || c.message)].filter(Boolean).join(' | ').slice(0, 300) || 'erro sem detalhe'

// impressão do item para detectar mudança externa: só campos que a publicação pode tocar (estoque e vendidos mudam sozinhos e não são conflito)
export function impressaoItem(item) {
  return {
    titulo: item?.title ?? null, preco: item?.price ?? null, status: item?.status ?? null, categoria: item?.category_id ?? null,
    pictures: (item?.pictures || []).map(p => p.id),
    atributos: Object.fromEntries((item?.attributes || []).map(a => [a.id, a.value_name ?? ''])),
    variacoes: (item?.variations || []).map(v => ({ id: v.id, preco: v.price ?? null, picture_ids: v.picture_ids || [] })),
  }
}
export function divergenciasImpressao(a, b) {
  const out = []
  for (const k of Object.keys(a || {})) if (JSON.stringify(a[k]) !== JSON.stringify(b?.[k])) out.push({ campo: k, antes: a[k], agora: b?.[k] })
  return out
}
export const hashSnapshot = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16)

// ── validação pura: só campos do escopo E permitidos pelas capacidades ──────────────────────────────────────
export function validarProposta(capacidades, proposta, escopo) {
  const permitidos = CAMPOS_POR_ESCOPO[escopo]
  if (!permitidos) return { ok: false, escopo, campos: [], bloqueios: [{ campo: '*', motivo: `escopo desconhecido: ${escopo}` }], proposta: {} }
  const pode = capacidades?.pode || {}, bloqueios = [], pendencias = [], filtrada = {}
  for (const campo of ['titulo', 'descricao', 'atributos', 'preco', 'galeria']) {
    if (proposta?.[campo] == null) continue
    if (!permitidos.includes(campo)) { bloqueios.push({ campo, motivo: `fora do escopo "${escopo}": não entra no payload` }); continue }
    // anúncio de CATÁLOGO: título, descrição, ficha e galeria vêm do catálogo do ML — terceiros não altera; próprio só por sugestão de correção, nunca por PUT no item (config/algoritmo.json → catalogo)
    if (capacidades?.catalogo && campo !== 'preco') {
      bloqueios.push({ campo, motivo: `${capacidades.catalogo_origem === 'proprio' ? CATALOGO.mensagem_sugestao_ofertas : CATALOGO.mensagem_bloqueio_ofertas} (não suportado pela API do item)`, tipo: 'nao_suportado' })
      const pend = capacidades.catalogo_origem === 'proprio' ? `${campo}: ${CATALOGO.texto_proprio} Enviar a correção pelo painel do vendedor (sugestões do catálogo).` : CATALOGO.texto_terceiros      // pendência identificada, nunca sucesso
      if (!pendencias.includes(pend)) pendencias.push(pend)
      continue
    }
    if (campo === 'titulo') {
      if (!pode.titulo) { bloqueios.push({ campo, motivo: capacidades?.motivos?.titulo || 'título não editável nesta conta/anúncio' }); continue }
      const t = String(proposta.titulo).trim()
      if (!t || t.length > 60) { bloqueios.push({ campo, motivo: 'título vazio ou acima de 60 caracteres (limite histórico — a confirmar por categoria)' }); continue }
      filtrada.titulo = t
    }
    if (campo === 'descricao') {
      if (!pode.descricao) { bloqueios.push({ campo, motivo: 'descrição não editável nesta conta/anúncio' }); continue }
      const d = String(proposta.descricao)
      if (/<[a-z][\s\S]*>/i.test(d)) { bloqueios.push({ campo, motivo: 'descrição só aceita texto simples (plain_text, quebras com \\n) — sem HTML' }); continue }
      filtrada.descricao = d
    }
    if (campo === 'atributos') {
      if (!pode.atributos) { bloqueios.push({ campo, motivo: capacidades?.motivos?.atributos || 'ficha não editável nesta conta/anúncio' }); continue }
      const cat = new Map((capacidades?.atributos_categoria || []).map(a => [a.id, a]))
      const ok = []
      for (const a of proposta.atributos) {
        const id = String(a.atributo_id || a.id || '').toUpperCase()
        const valor = a.valor_proposto ?? a.value_name
        if (!id || valor == null || String(valor).trim() === '') continue
        if (ATRIBUTOS_INTOCAVEIS.includes(id)) { bloqueios.push({ campo: `atributos.${id}`, motivo: 'identificador/certificação: fora do payload (divergência é pergunta ao operador)' }); continue }
        if (cat.size && !cat.has(id)) { bloqueios.push({ campo: `atributos.${id}`, motivo: 'atributo não existe na categoria do anúncio' }); continue }
        if (cat.get(id)?.editavel === false) { bloqueios.push({ campo: `atributos.${id}`, motivo: 'atributo read_only na categoria' }); continue }
        if (CAMPOS_FACTUAIS.includes(id) && TERMO_PROMOCIONAL.test(String(valor))) { bloqueios.push({ campo: `atributos.${id}`, motivo: 'termo promocional em campo factual (MPN/fabricante/marca/modelo) — reprovado' }); continue }
        if (cat.get(id)?.max_len && String(valor).length > cat.get(id).max_len) { bloqueios.push({ campo: `atributos.${id}`, motivo: `valor acima de ${cat.get(id).max_len} caracteres` }); continue }
        ok.push({ id, value_name: String(valor) })
      }
      if (ok.length) filtrada.atributos = ok
      else if (!bloqueios.some(b => b.campo.startsWith('atributos'))) bloqueios.push({ campo, motivo: 'nenhum atributo com valor proposto' })
    }
    if (campo === 'preco') {
      if (!pode.preco) { bloqueios.push({ campo, motivo: 'preço não editável nesta conta/anúncio' }); continue }
      const p = proposta.preco
      if (p.simulacao || (p.bloqueios || []).length) { bloqueios.push({ campo, motivo: `preço em simulação/bloqueado pelo cálculo (${(p.bloqueios || []).join('; ') || 'sem custo/taxa confiável'}): não publicável` }); continue }
      if (!(Number(p.preco_proposto) > 0)) { bloqueios.push({ campo, motivo: 'preço proposto inválido' }); continue }
      if (p.piso != null && Number(p.preco_proposto) < Number(p.piso)) { bloqueios.push({ campo, motivo: 'preço proposto abaixo do piso calculado' }); continue }
      filtrada.preco = arred2(p.preco_proposto)                                   // reais, 2 casas (o cálculo em centavos é do core)
    }
    if (campo === 'galeria') {
      if (!pode.imagens) { bloqueios.push({ campo, motivo: capacidades?.motivos?.imagens || 'imagens não editáveis nesta conta/anúncio' }); continue }
      const g = [...proposta.galeria].sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0))
      if (!g.length) { bloqueios.push({ campo, motivo: 'galeria vazia' }); continue }
      filtrada.galeria = g
    }
  }
  // V3 F5: duplicata que nasce num UP NOVO (estoque separado) — proposta.estoque_contexto = { fisico, outros } vindo do plano (dados.estoque_duplicata): a quantidade + os
  // outros estoques próprios do produto não passam do físico informado (estoque_acima_do_fisico barra); sem físico, a publicação ao vivo fica pendente (estoque_fisico)
  const est = estoqueDuplicata(proposta)
  if (est && est.motivo === 'estoque_fisico') pendencias.push(MOTIVOS_ESTOQUE_FISICO.estoque_fisico)
  else if (est && !est.ok) bloqueios.push({ campo: 'estoque', motivo: MOTIVOS_ESTOQUE_FISICO[est.motivo], tipo: est.motivo })
  return { ok: Object.keys(filtrada).length > 0 && !bloqueios.some(b => b.tipo === 'nao_suportado' || b.tipo === 'estoque_acima_do_fisico' || b.tipo === 'quantidade_invalida'), escopo, campos: Object.keys(filtrada), bloqueios, pendencias, proposta: filtrada }
}
// quantidade PROPOSTA da duplicata pelo UP esperado (desenho § 6.4): só condição comercial muda → espera o MESMO UP (o ML divide; vale o estoque atual do pool do original);
// título ou capa novos → espera UP NOVO: a parte da duplicata na divisão sugerida do plano (Σ = físico), com o contexto da trava (físico só se informado pelo cliente/equipe).
// est = acao.dados.estoque_duplicata (plano-anuncios, só com o produto ligado). O consultor confirma o número no briefing; nada aqui publica.
export function quantidadeDuplicata(est, { titulo_ou_capa_novos = true } = {}) {
  if (!est) return null
  if (!titulo_ou_capa_novos) return { espera: 'mesmo_up', quantidade: est.quantidade_proposta?.mesmo_up ?? null, estoque_contexto: null }
  return { espera: 'up_novo', quantidade: est.quantidade_proposta?.up_novo ?? null, estoque_contexto: { fisico: est.fisico_fonte === 'declarado' ? est.fisico : null, outros: est.outros_proprios ?? 0 } }
}
// contexto de estoque da duplicata (só quando o plano mandou: proposta.estoque_contexto) → validarEstoqueFisico | null
export const estoqueDuplicata = p => (p?.estoque_contexto && p.estoque != null ? validarEstoqueFisico({ quantidade: typeof p.estoque === 'number' ? p.estoque : NaN, fisico: Number.isInteger(p.estoque_contexto.fisico) ? p.estoque_contexto.fisico : null, outros: p.estoque_contexto.outros }) : null)

// ── payloads por grupo (um PUT por grupo; ficha nunca carrega título/preço/estoque/imagens) ────────────────
export function montarPayloads(filtrada, item, { variacao_externa_id = '', picture_ids = {} } = {}) {
  const id = item.id, grupos = []
  const variacoes = item.variations || []
  const alvo = variacao_externa_id ? variacoes.find(v => String(v.id) === String(variacao_externa_id)) : null
  if (filtrada.galeria) {
    const novos = filtrada.galeria.map(g => picture_ids[g.imagem_id] || g.picture_id).filter(Boolean)
    if (novos.length === filtrada.galeria.length) {
      if (variacoes.length) {
        if (!alvo) grupos.push({ grupo: 'galeria', bloqueio: 'item com variações: informe variacao_externa_id (a galeria é por variação; as irmãs são preservadas)' })
        else {
          // união dos ids de TODAS as variações (irmãs intactas) — só `variations` devolve 400 item.pictures.invalid.missing_ids
          const irmas = variacoes.filter(v => v !== alvo)
          const uniao = [...new Set([...novos, ...irmas.flatMap(v => v.picture_ids || [])])]
          grupos.push({ grupo: 'galeria', metodo: 'PUT', caminho: `/items/${id}`, corpo: { pictures: uniao.map(p => ({ id: p })), variations: [...irmas.map(v => ({ id: v.id, picture_ids: v.picture_ids || [] })), { id: alvo.id, picture_ids: novos }] } })
        }
      } else grupos.push({ grupo: 'galeria', metodo: 'PUT', caminho: `/items/${id}`, corpo: { pictures: novos.map(p => ({ id: p })) } })
    } else grupos.push({ grupo: 'galeria', precisa_upload: filtrada.galeria.filter(g => !(picture_ids[g.imagem_id] || g.picture_id)) })
  }
  if (filtrada.atributos) grupos.push({ grupo: 'ficha', metodo: 'PUT', caminho: `/items/${id}`, corpo: { attributes: filtrada.atributos.map(a => ({ id: a.id, value_name: a.value_name })) } })
  if (filtrada.titulo) grupos.push({ grupo: 'titulo', metodo: 'PUT', caminho: `/items/${id}`, corpo: { title: filtrada.titulo } })
  if (filtrada.preco != null) {
    if (variacoes.length) {
      if (!alvo) grupos.push({ grupo: 'preco', bloqueio: 'item com variações: preço é por variação — informe variacao_externa_id' })
      else grupos.push({ grupo: 'preco', metodo: 'PUT', caminho: `/items/${id}`, corpo: { variations: variacoes.map(v => v === alvo ? { id: v.id, price: filtrada.preco } : { id: v.id }) } })   // irmãs listadas por id = preservadas
    } else grupos.push({ grupo: 'preco', metodo: 'PUT', caminho: `/items/${id}`, corpo: { price: filtrada.preco } })
  }
  if (filtrada.descricao != null) {
    const existe = !!(item._descricao && item._descricao.plain_text != null)
    grupos.push({ grupo: 'descricao', metodo: existe ? 'PUT' : 'POST', caminho: `/items/${id}/description${existe ? '?api_version=2' : ''}`, corpo: { plain_text: filtrada.descricao } })
  }
  for (const g of grupos) if (g.corpo) assertPayloadSeguro(g.corpo)
  return grupos
}
const PROIBIDOS_NO_PAYLOAD = ['status', 'deleted', 'available_quantity', 'category_id', 'listing_type_id', 'seller_id']
function assertPayloadSeguro(corpo) {
  for (const k of PROIBIDOS_NO_PAYLOAD) if (k in corpo) throw new Error(`payload proibido: campo "${k}" nunca sai pelo adaptador (sem pausar/excluir/mudar categoria ou estoque)`)
  for (const a of corpo.attributes || []) if (ATRIBUTOS_INTOCAVEIS.includes(String(a.id).toUpperCase())) throw new Error(`payload proibido: atributo ${a.id} é intocável`)
}

export function diff(snapshotAntes, grupos) {
  const antes = snapshotAntes?.item ? impressaoItem(snapshotAntes.item) : (snapshotAntes || {})
  const out = []
  for (const g of grupos) {
    if (!g.corpo) continue
    if (g.corpo.title != null) out.push({ campo: 'titulo', de: antes.titulo ?? null, para: g.corpo.title })
    if (g.corpo.price != null) out.push({ campo: 'preco', de: antes.preco ?? null, para: g.corpo.price })
    if (g.corpo.plain_text != null) out.push({ campo: 'descricao', de: snapshotAntes?.descricao?.plain_text ?? null, para: g.corpo.plain_text })
    for (const a of g.corpo.attributes || []) out.push({ campo: `atributos.${a.id}`, de: antes.atributos?.[a.id] ?? null, para: a.value_name })
    if (g.corpo.pictures) out.push({ campo: 'pictures', de: antes.pictures ?? null, para: g.corpo.pictures.map(p => p.id) })
    for (const v of g.corpo.variations || []) {
      const ant = (antes.variacoes || []).find(x => String(x.id) === String(v.id))
      if (v.price != null) out.push({ campo: `variacao.${v.id}.preco`, de: ant?.preco ?? null, para: v.price })
      if (v.picture_ids && JSON.stringify(v.picture_ids) !== JSON.stringify(ant?.picture_ids || [])) out.push({ campo: `variacao.${v.id}.picture_ids`, de: ant?.picture_ids ?? null, para: v.picture_ids })
    }
  }
  return out
}

// ── fábrica ──────────────────────────────────────────────────────────────────────────────────────────────────
// deps: fetch (injetável), tokenValido(cliente) → token|null, conta(cliente) → { meli_user_id, nickname, escopos } | null (opcional),
//       agora() → ISO, espera (ms entre retentativas de GET; 0 nos testes), hostsImagem (hosts de onde se pode baixar bytes), raizLocal (pasta de candidatas)
export function criarAdaptadorML({ fetch, tokenValido, conta = () => null, agora = () => new Date().toISOString(), espera = 1500, hostsImagem = [], raizLocal = '', origemCatalogo = () => 'terceiros' }) {      // origemCatalogo(cliente, item_id) → 'proprio' | 'terceiros' (marcação manual; sem ela, terceiros)
  if (typeof fetch !== 'function' || typeof tokenValido !== 'function') throw new Error('criarAdaptadorML exige fetch e tokenValido')

  async function req(cliente, metodo, caminho, { corpo, form, headers = {}, retry = metodo === 'GET' } = {}) {
    if (metodo === 'DELETE') throw new Error('o adaptador nunca exclui anúncio')
    const token = await tokenValido(cliente)
    if (!token) return { status: 401, corpo: null, classe: 'credencial_expirada', erro: 'conta Mercado Livre não conectada ou renovação do token falhou — reconectar em Integrações' }
    const init = { method: metodo, headers: { Authorization: `Bearer ${token}`, ...headers } }
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(TIMEOUT_MS)
    if (form) init.body = form
    else if (corpo !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corpo) }
    let r
    for (let t = 0; ; t++) {
      try { r = await fetch(`${BASE}${caminho}`, init) } catch (e) { return { status: 0, corpo: String(e?.message || e).slice(0, 200), classe: metodo === 'GET' ? 'transitorio' : 'processamento_pendente', erro: `sem resposta do canal (${String(e?.message || e).slice(0, 120)})` } }
      if (r.ok || !retry || t >= 3 || !(r.status === 429 || r.status >= 500)) break
      if (espera) await dormir(espera * 2 ** t)
    }
    const texto = await r.text().catch(() => '')
    let c; try { c = texto ? JSON.parse(texto) : null } catch { c = texto.slice(0, 400) }
    return r.ok ? { status: r.status, corpo: c } : { status: r.status, corpo: c, classe: classificarErro(r.status), erro: resumoErro(c) }
  }
  const registro = (etapa, r, extra = {}) => ({ etapa, operacao: extra.metodo || 'GET', caminho: extra.caminho || '', payload_json: extra.corpo === undefined ? null : JSON.stringify(extra.corpo), status: r.status, classe: r.classe || null, erro: r.erro || null,
    resposta_json: JSON.stringify(r.corpo ?? null).slice(0, 4000), estado: r.classe ? 'falha' : 'enviado', em: agora() })

  async function lerItem(cliente, id) { return req(cliente, 'GET', `/items/${id}?include_attributes=all`) }
  async function lerDescricao(cliente, id) { const r = await req(cliente, 'GET', `/items/${id}/description`); return r.classe ? null : r.corpo }

  async function consultarCategoriaEAtributos(cliente, categoria_id) {
    const [cat, attrs] = await Promise.all([req(cliente, 'GET', `/categories/${categoria_id}`), req(cliente, 'GET', `/categories/${categoria_id}/attributes`)])
    if (attrs.classe) return { categoria_id, erro: attrs.erro, classe: attrs.classe, atributos: [] }
    const tags = a => Array.isArray(a.tags) ? Object.fromEntries(a.tags.map(t => [t, true])) : (a.tags || {})
    return {
      categoria_id, nome: cat.corpo?.name || '', caminho: (cat.corpo?.path_from_root || []).map(p => p.name).join(' › '), consultado_em: agora(),
      // settings da categoria (campos mapeados de forma defensiva — a confirmar na 1ª leitura real): limite de título e tags (ex.: sinal de User Products)
      settings: { max_titulo: cat.corpo?.settings?.max_title_length ?? null, tags: Array.isArray(cat.corpo?.settings?.tags) ? cat.corpo.settings.tags.map(String) : [] },
      atributos: (attrs.corpo || []).map(a => { const t = tags(a); return { id: a.id, nome: a.name, tipo: a.value_type || '', unidade: a.default_unit || '', unidades: (a.allowed_units || []).map(u => u.id), max_len: a.value_max_length || null,
        obrigatorio: !!(t.required || t.new_required || t.catalog_required), condicional: !!t.conditional_required, editavel: !t.read_only, oculto: !!t.hidden, variacao: !!t.variation_attribute, multivalor: !!t.multivalued, valores: (a.values || []).length, tags: Object.keys(t) } }),
    }
  }

  async function consultarCapacidades(cliente, { anuncio_id = '' } = {}) {
    const c = conta(cliente) || {}
    const escopos = String(c.escopos || '').split(/[\s,]+/).filter(Boolean)
    const escreve = escopos.length ? escopos.includes('write') : null                      // null = conexão antiga sem escopos salvos
    const obs = [], motivos = {}
    const cap = { canal: 'ML', conta: { id: c.meli_user_id || null, nickname: c.nickname || '' }, escopos, pode: { titulo: false, descricao: false, preco: false, estoque: false, atributos: false, imagens: false, variacoes: false, criar: false }, catalogo: false, user_product: false, item: null, atributos_categoria: [], motivos, observacoes: obs, consultado_em: agora() }
    const token = await tokenValido(cliente)
    if (!token) { obs.push('conta Mercado Livre não conectada (ou renovação do token falhou): nenhuma operação disponível'); return cap }
    if (escreve === false) { obs.push('a conexão não tem escopo "write": só leitura — reconectar com permissão de escrita'); return cap }
    if (escreve === null) obs.push('escopos não registrados na conexão: permissão de escrita A CONFIRMAR na primeira gravação (o canal responde 403 se faltar)')
    Object.assign(cap.pode, { titulo: true, descricao: true, preco: true, estoque: true, atributos: true, imagens: true, variacoes: false, criar: !anuncio_id })
    if (!anuncio_id) { obs.push('criação: elegibilidade/obrigatoriedade de User Products por categoria NÃO verificada (doc 07/10/2026 descreve o modelo, sem endpoint de elegibilidade confirmado) — a confirmar'); return cap }
    const r = await lerItem(cliente, anuncio_id)
    if (r.classe) { Object.keys(cap.pode).forEach(k => cap.pode[k] = false); obs.push(`não foi possível ler o anúncio (${r.status}: ${r.erro}) — ${r.status === 403 ? 'pode ser anúncio de OUTRA conta' : 'tente de novo'}`); cap.erro = r.classe; return cap }
    const it = r.corpo
    cap.item = { id: it.id, status: it.status, sub_status: it.sub_status || [], sold_quantity: it.sold_quantity ?? null, listing_type: it.listing_type_id || '', categoria_id: it.category_id || '', variacoes: (it.variations || []).map(v => v.id), permalink: it.permalink || '', user_product_id: it.user_product_id || null }
    cap.catalogo = !!it.catalog_listing
    cap.user_product = !!it.user_product_id
    cap.pode.variacoes = (it.variations || []).length > 0
    if (['closed', 'under_review', 'inactive'].includes(it.status)) { Object.keys(cap.pode).forEach(k => cap.pode[k] = false); obs.push(`anúncio ${it.status}: nenhuma alteração pelo adaptador`); return cap }
    if ((it.sold_quantity ?? 0) > 0) { cap.pode.titulo = false; motivos.titulo = 'título não editável: anúncio já vendeu (regra histórica da skill; a confirmar por categoria) — a alavanca que sobra é a ficha' }
    if (cap.user_product) { cap.pode.titulo = false; motivos.titulo = 'item no modelo User Products: título vem do family_name do UP, não do item'; obs.push('User Products: o PUT em /items replica title/attributes/pictures de forma ASSÍNCRONA em todos os itens do mesmo UP — conferir depois da propagação') }
    if (cap.catalogo) {
      cap.catalogo_origem = origemCatalogo(cliente, anuncio_id) === 'proprio' ? 'proprio' : 'terceiros'
      Object.assign(cap.pode, { imagens: false, titulo: false, descricao: false, atributos: false })       // preço, estoque e a caixa de compra continuam sendo do vendedor
      Object.assign(motivos, { imagens: 'anúncio de catálogo: capa vem da ficha do catálogo (catalog_product_id), não do item', titulo: 'anúncio de CATÁLOGO: o título vem do catálogo', descricao: 'anúncio de CATÁLOGO: a descrição vem do catálogo', atributos: 'anúncio de CATÁLOGO: a ficha exibida é a do produto do catálogo' })
      obs.push(cap.catalogo_origem === 'proprio' ? CATALOGO.mensagem_sugestao_ofertas : CATALOGO.mensagem_bloqueio_ofertas)
    }
    if (cap.pode.variacoes) obs.push('item com variações: preço e galeria são por variação (informe variacao_externa_id); as irmãs são sempre listadas por id para serem preservadas')
    if (it.category_id) { const cat = await consultarCategoriaEAtributos(cliente, it.category_id); cap.atributos_categoria = cat.atributos; if (cat.erro) obs.push(`atributos da categoria indisponíveis (${cat.erro}): validação de read_only/obrigatórios fica a confirmar`) }
    return cap
  }

  async function importarAnuncio(cliente, anuncio_id) {
    const r = await lerItem(cliente, anuncio_id)
    if (r.classe) return { ok: false, classe: r.classe, erro: r.erro, status: r.status }
    const it = r.corpo
    const [descricao, cat] = await Promise.all([lerDescricao(cliente, anuncio_id), it.category_id ? consultarCategoriaEAtributos(cliente, it.category_id) : { atributos: [] }])
    const snapshot = { item: it, descricao, lido_em: agora() }
    return {
      ok: true, anuncio_id: it.id, titulo: it.title, preco: it.price, estoque: it.available_quantity ?? null, status: it.status, sub_status: it.sub_status || [], permalink: it.permalink || '',
      categoria_id: it.category_id, categoria: cat, listing_type: it.listing_type_id || '', sold_quantity: it.sold_quantity ?? null, catalog_listing: !!it.catalog_listing, catalog_product_id: it.catalog_product_id || null, user_product_id: it.user_product_id || null,
      atributos: (it.attributes || []).map(a => ({ id: a.id, nome: a.name, value_id: a.value_id ?? null, value_name: a.value_name ?? '' })),
      variacoes: (it.variations || []).map(v => ({ id: v.id, preco: v.price, estoque: v.available_quantity, vendidos: v.sold_quantity ?? null, picture_ids: v.picture_ids || [], combinacao: (v.attribute_combinations || []).map(a => ({ id: a.id, nome: a.name, valor: a.value_name })), sku: (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name || '' })),
      pictures: (it.pictures || []).map(p => ({ id: p.id, url: p.secure_url || p.url, size: p.size, max_size: p.max_size })),
      descricao: descricao?.plain_text ?? null, item: it, snapshot_json: JSON.stringify(snapshot), snapshot_hash: hashSnapshot(impressaoItem(it)),
    }
  }

  // voz do cliente (método IMA: voz do cliente → ângulo): perguntas e avaliações do PRÓPRIO anúncio. Endpoints conhecidos do ML (/questions/search, /reviews/item),
  // formato a confirmar na 1ª execução real; perguntas costumam dar 403 (permissão da app) → 'indisponivel' com o motivo, nunca lista inventada
  async function lerVozDoCliente(cliente, anuncio_id) {
    const id = encodeURIComponent(anuncio_id)
    const [q, rv] = await Promise.all([req(cliente, 'GET', `/questions/search?item=${id}&api_version=4&limit=50`), req(cliente, 'GET', `/reviews/item/${id}`)])
    const perguntas = q.classe ? null : (q.corpo?.questions || []).map(x => String(x?.text || '').trim()).filter(Boolean)
    const avaliacoes = rv.classe ? null : (rv.corpo?.reviews || [])
    if (!perguntas && !avaliacoes) return { estado: 'indisponivel', motivo: `perguntas: ${q.classe} (${q.status}); avaliações: ${rv.classe} (${rv.status})`, perguntas: 0, avaliacoes: 0, lido_em: agora() }
    const negativas = (avaliacoes || []).filter(r => Number(r?.rate) <= 3).map(r => String(r?.content || r?.title || '').trim()).filter(Boolean)
    return { estado: 'coletada', perguntas: perguntas?.length ?? 0, avaliacoes: avaliacoes?.length ?? 0, nota_media: rv.corpo?.rating_average ?? null,
      principais: [...(perguntas || []).slice(0, 5), ...negativas.slice(0, 3)].map(t => t.slice(0, 160)), parcial: !perguntas ? 'perguntas indisponíveis' : !avaliacoes ? 'avaliações indisponíveis' : null,
      fonte: 'GET /questions/search · GET /reviews/item (formato a confirmar na 1ª execução real)', lido_em: agora() }
  }

  // comissão/tarifa SEMPRE com fonte e data; falha = 'a confirmar' (nunca alíquota presumida)
  async function consultarRegrasComerciais(cliente, { preco, categoria_id, listing_type = 'gold_special' }) {
    const q = new URLSearchParams({ price: String(arred2(preco)), category_id: categoria_id || '', listing_type_id: listing_type })
    const fonte = `GET /sites/MLB/listing_prices?${q}`
    const r = await req(cliente, 'GET', `/sites/MLB/listing_prices?${q}`)
    const base = { canal: 'ML', modalidade: listing_type, categoria_id, preco_consultado: arred2(preco), fonte, consultado_em: agora(), validade: 'consulta pontual: reconsultar antes de publicar (tarifas mudam por categoria/data)' }
    if (r.classe) return { ...base, estado: 'a confirmar', motivo: `API de tarifas falhou (${r.status}: ${r.erro}) — cadastrar regra manualmente ou reconsultar`, comissao_pct: null, tarifa_fixa: null }
    const lista = Array.isArray(r.corpo) ? r.corpo : [r.corpo]
    const l = lista.find(x => x?.listing_type_id === listing_type) || lista[0] || {}
    const det = l.sale_fee_details || {}
    const pct = det.percentage_fee ?? (l.sale_fee_amount != null && preco > 0 && !det.fixed_fee ? (l.sale_fee_amount / preco) * 100 : null)
    return { ...base, estado: pct == null ? 'a confirmar' : 'consultado', comissao_pct: pct == null ? null : arred2(pct), tarifa_fixa: det.fixed_fee != null ? arred2(det.fixed_fee) : null, comissao_valor: l.sale_fee_amount != null ? arred2(l.sale_fee_amount) : null, tarifa_anuncio: l.listing_fee_amount ?? null, bruto: l.sale_fee_details?.gross_amount ?? null, resposta: l }
  }

  // bytes de uma candidata: arquivo local dentro da raiz do módulo ou URL de host autorizado — nada mais
  async function obterBytes(img) {
    if (img.bytes) return Buffer.isBuffer(img.bytes) ? img.bytes : Buffer.from(img.bytes)
    if (img.caminho_local) {
      if (!raizLocal) throw new Error('raizLocal não configurada: não é possível ler arquivos locais')
      const real = realpathSync(img.caminho_local), raiz = realpathSync(raizLocal)
      if (!real.startsWith(raiz + '/')) throw new Error('arquivo fora da pasta de ofertas: recusado')
      return readFileSync(real)
    }
    if (img.url) {
      const u = new URL(img.url)
      if (u.protocol !== 'https:' || !hostsImagem.includes(u.hostname)) throw new Error(`URL não autorizada para baixar imagem (${u.hostname}); link de visualização do Drive não é URL direta`)
      const r = await fetch(img.url); if (!r.ok) throw new Error(`download ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    }
    throw new Error('imagem sem bytes, caminho_local ou url')
  }
  async function enviarImagem(cliente, img) {
    let bytes
    try { bytes = await obterBytes(img) } catch (e) { return { status: 0, classe: 'validacao_rejeitada', erro: e.message, corpo: null } }
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: img.mime || 'image/jpeg' }), img.nome || `${img.imagem_id || 'imagem'}.jpg`)
    return req(cliente, 'POST', '/pictures/items/upload', { form })                    // multipart `file` — a confirmar (doc oficial indisponível em 07/10/2026)
  }

  // janela de propagação: grupo já enviado há < 30 min com a mesma chave não sai de novo
  const emPropagacao = (anterior, grupo) => anterior?.grupos_enviados?.includes(grupo) && anterior.em && (Date.parse(agora()) - Date.parse(anterior.em)) < ESPERA_PROPAGACAO_MIN * 60e3

  async function publicar({ cliente, anuncio_id, escopo, proposta, versao = 0, chave_idem = '', live = false, snapshot_diagnostico = null, variacao_externa_id = '', imagens = [], picture_ids = {}, publicacao_anterior = null, capacidades = null }) {
    const registros = [], t0 = agora()
    const base = { cliente, anuncio_id, escopo, versao, chave_idem, live: live === true, canal: 'ML', iniciado_em: t0 }
    const cap = capacidades || await consultarCapacidades(cliente, { anuncio_id })
    const val = validarProposta(cap, proposta, escopo)
    if (!val.campos.length || val.bloqueios.some(b => b.tipo === 'nao_suportado')) return { ...base, estado: val.bloqueios.some(b => b.tipo === 'nao_suportado') ? 'pendente_dados' : 'rejeitado', validacao: val, capacidades: cap, grupos: [], diff: [], registros, pendencias: val.pendencias, motivo: val.bloqueios.map(b => `${b.campo}: ${b.motivo}`).join(' | ') }
    const item = cap.item ? (await lerItem(cliente, anuncio_id)) : null
    if (!item || item.classe) return { ...base, estado: ESTADO_POR_CLASSE[item?.classe] || 'falha_recuperavel', classe_erro: item?.classe || 'transitorio', motivo: item?.erro || 'anúncio não lido', validacao: val, capacidades: cap, grupos: [], diff: [], registros, pendencias: [PENDENCIA_POR_CLASSE[item?.classe] || 'anúncio não lido'] }
    const it = item.corpo
    it._descricao = val.proposta.descricao != null ? await lerDescricao(cliente, anuncio_id) : null
    // mudança externa desde o diagnóstico → conflito, nada sai (vale no dry-run também: o operador vê antes de aprovar)
    const divergencias = snapshot_diagnostico?.item ? divergenciasImpressao(impressaoItem(snapshot_diagnostico.item), impressaoItem(it)) : []
    const idsImagem = { ...picture_ids }
    for (const g of imagens) if (g.picture_id) idsImagem[g.imagem_id] = g.picture_id
    const galeriaComImagens = val.proposta.galeria ? val.proposta.galeria.map(g => ({ ...g, ...(imagens.find(i => i.imagem_id === g.imagem_id) || {}) })) : null
    let grupos = montarPayloads({ ...val.proposta, galeria: galeriaComImagens }, it, { variacao_externa_id, picture_ids: idsImagem })
    const snapshotAntes = { item: it, descricao: it._descricao, lido_em: agora() }
    const resultado = { ...base, validacao: val, capacidades: cap, snapshot_antes_json: JSON.stringify(snapshotAntes), snapshot_hash: hashSnapshot(impressaoItem(it)), divergencias, grupos, diff: diff(snapshotAntes, grupos), registros, pendencias: [...val.pendencias], imagens: [] }
    if (divergencias.length) return { ...resultado, estado: 'conflito_externo', motivo: `o anúncio mudou fora do sistema desde o diagnóstico (${divergencias.map(d => d.campo).join(', ')}): refaça o diagnóstico/aprovação antes de publicar`, pendencias: [...resultado.pendencias, 'reaprovar a proposta sobre o anúncio atual'] }
    for (const g of grupos.filter(x => x.bloqueio)) resultado.pendencias.push(`${g.grupo}: ${g.bloqueio}`)
    if (!live) return { ...resultado, estado: 'dry_run', payload: grupos.filter(g => g.corpo).map(g => ({ grupo: g.grupo, metodo: g.metodo, caminho: g.caminho, corpo: g.corpo })), uploads_pendentes: grupos.find(g => g.precisa_upload)?.precisa_upload?.length || 0 }
    if (!chave_idem) return { ...resultado, estado: 'rejeitado', motivo: 'publicação live exige chave_idem (cliente/conta/anúncio/versão/operação)' }

    // ── LIVE ──
    const enviados = [...(publicacao_anterior?.grupos_enviados || [])]
    let parou = null
    // 1) uploads que faltam (cada um registrado; id devolvido para o core gravar em of_imagem e não reenviar)
    const up = grupos.find(g => g.precisa_upload)
    if (up) {
      for (const img of up.precisa_upload) {
        const r = await enviarImagem(cliente, img)
        registros.push(registro(`upload:${img.imagem_id}`, r, { metodo: 'POST', caminho: '/pictures/items/upload', corpo: { imagem_id: img.imagem_id, papel: img.papel, ordem: img.ordem } }))
        if (r.classe) { parou = r; break }
        idsImagem[img.imagem_id] = r.corpo?.id
        resultado.imagens.push({ imagem_id: img.imagem_id, picture_id: r.corpo?.id, resposta: { size: r.corpo?.size, max_size: r.corpo?.max_size } })
      }
      if (!parou) { grupos = montarPayloads({ ...val.proposta, galeria: galeriaComImagens }, it, { variacao_externa_id, picture_ids: idsImagem }); resultado.grupos = grupos; resultado.diff = diff(snapshotAntes, grupos) }
    }
    // 2) um PUT por grupo, na ordem galeria → ficha → título → preço → descrição; para no 1º erro (o resto fica para a retomada)
    if (!parou) for (const g of grupos) {
      if (!g.corpo) continue
      if (emPropagacao(publicacao_anterior, g.grupo)) { registros.push({ etapa: g.grupo, operacao: g.metodo, caminho: g.caminho, payload_json: JSON.stringify(g.corpo), status: null, classe: null, erro: null, resposta_json: null, estado: 'nao_enviado', motivo: `já enviado há < ${ESPERA_PROPAGACAO_MIN} min com esta chave: confira antes de reenviar`, em: agora() }); continue }
      const r = await req(cliente, g.metodo, g.caminho, { corpo: g.corpo })
      registros.push(registro(g.grupo, r, g))
      if (r.classe) { parou = r; break }
      enviados.push(g.grupo)
    }
    // 3) reconciliação por LEITURA: o que o canal mostra agora, campo a campo (2xx ≠ publicado; 400 pode ter gravado parte)
    const relido = await lerItem(cliente, anuncio_id)
    const descRelida = val.proposta.descricao != null && !relido.classe ? await lerDescricao(cliente, anuncio_id) : null
    const esperado = esperadoDe(grupos, variacao_externa_id)
    const conferencia = relido.classe ? null : conferirCampos(relido.corpo, descRelida, esperado, { enviado_em: t0, agora: agora() })
    const falhas = registros.filter(r => r.estado === 'falha')
    const classe = parou?.classe || null
    const estado = !falhas.length ? 'em_conferencia' : enviados.length ? 'falha_parcial' : (ESTADO_POR_CLASSE[classe] || 'falha_recuperavel')
    const retomar = grupos.filter(g => g.corpo && !enviados.includes(g.grupo) && !(conferencia?.campos || []).some(c => c.grupo === g.grupo && c.estado === 'verificado')).map(g => g.grupo)
    return { ...resultado, estado, classe_erro: classe, erro: parou?.erro || null, grupos_enviados: enviados, retomar, conferencia, finalizado_em: agora(),
      pendencias: [...resultado.pendencias, ...(classe ? [PENDENCIA_POR_CLASSE[classe]] : []), ...(estado === 'falha_parcial' ? [`publicação PARCIAL: ${enviados.join(', ')} enviado(s); retomar só ${retomar.join(', ') || 'nada'} depois de corrigir`] : []), ...(estado === 'em_conferencia' ? [`API aceitou ≠ publicado: reconferir em ${ESPERA_PROPAGACAO_MIN}–60 min (o ML pode trocar pictures[0])`] : [])] }
  }

  // o que se espera ler no canal depois de cada grupo (para conferir/reconciliar)
  function esperadoDe(grupos, variacao_externa_id) {
    const e = { variacao_externa_id }
    for (const g of grupos) {
      if (!g.corpo) continue
      if (g.corpo.title != null) e.titulo = g.corpo.title
      if (g.corpo.price != null) e.preco = g.corpo.price
      if (g.corpo.plain_text != null) e.descricao = g.corpo.plain_text
      if (g.corpo.attributes) e.atributos = g.corpo.attributes.map(a => ({ atributo_id: a.id, valor: a.value_name }))
      if (g.grupo === 'galeria') e.galeria = (g.corpo.variations ? g.corpo.variations.find(v => String(v.id) === String(variacao_externa_id))?.picture_ids : g.corpo.pictures.map(p => p.id)) || []
      if (g.grupo === 'preco' && g.corpo.variations) e.preco = g.corpo.variations.find(v => v.price != null)?.price
    }
    return e
  }
  function conferirCampos(it, desc, esperado, { enviado_em, agora: ag }) {
    const minutos = enviado_em ? (Date.parse(ag) - Date.parse(enviado_em)) / 60e3 : Infinity
    const conclusivo = minutos >= ESPERA_PROPAGACAO_MIN
    const campos = [], norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const estadoDe = (bate, extra = '') => ({ estado: bate ? 'verificado' : conclusivo ? 'divergente' : 'processando', ...(extra && !bate ? { divergencia: extra } : {}) })
    if (esperado.titulo != null) campos.push({ campo: 'titulo', grupo: 'titulo', esperado: esperado.titulo, atual: it.title, ...estadoDe(norm(it.title) === norm(esperado.titulo), 'título lido difere do enviado') })
    if (esperado.preco != null) { const v = esperado.variacao_externa_id ? (it.variations || []).find(x => String(x.id) === String(esperado.variacao_externa_id)) : null; const atual = v ? v.price : it.price; campos.push({ campo: 'preco', grupo: 'preco', esperado: esperado.preco, atual, ...estadoDe(Math.abs(Number(atual) - Number(esperado.preco)) < 0.005, 'preço lido difere do enviado') }) }
    if (esperado.descricao != null) campos.push({ campo: 'descricao', grupo: 'descricao', esperado: esperado.descricao.slice(0, 200), atual: desc ? norm(desc.plain_text).slice(0, 200) : null, ...estadoDe(desc && norm(desc.plain_text) === norm(esperado.descricao), desc ? 'descrição lida difere' : 'descrição não lida') })
    for (const a of esperado.atributos || []) { const atual = (it.attributes || []).find(x => x.id === a.atributo_id)?.value_name ?? null; campos.push({ campo: `atributos.${a.atributo_id}`, grupo: 'ficha', esperado: a.valor, atual, ...estadoDe(norm(atual) === norm(a.valor), `atributo ${a.atributo_id} lido difere do enviado`) }) }
    if (esperado.galeria) {
      const v = esperado.variacao_externa_id ? (it.variations || []).find(x => String(x.id) === String(esperado.variacao_externa_id)) : null
      const atual = v ? (v.picture_ids || []) : (it.pictures || []).map(p => p.id)
      const capaTrocada = atual[0] && esperado.galeria[0] && atual[0] !== esperado.galeria[0]
      const bate = JSON.stringify(atual) === JSON.stringify(esperado.galeria)
      const p0 = (it.pictures || []).find(p => p.id === atual[0])
      const naoQuadrada = p0?.max_size && (() => { const [w, h] = String(p0.max_size).split('x').map(Number); return w && h && w !== h })()
      campos.push({ campo: 'galeria', grupo: 'galeria', esperado: esperado.galeria, atual, ...estadoDe(bate, capaTrocada ? `pictures[0] trocado pelo canal: esperado ${esperado.galeria[0]}, atual ${atual[0]}${naoQuadrada ? ` (${p0.max_size}, não quadrada: recorte automático do ML)` : ''} — avisar o operador ANTES de regravar` : 'sequência de imagens difere da enviada') })
    }
    return { campos, conclusivo, minutos_desde_envio: Number.isFinite(minutos) ? Math.round(minutos) : null, reconferir_em: !conclusivo ? new Date(Date.parse(enviado_em) + ESPERA_PROPAGACAO_MIN * 60e3).toISOString() : minutos < 60 ? new Date(Date.parse(enviado_em) + 60 * 60e3).toISOString() : null, divergencias: campos.filter(c => c.estado === 'divergente') }
  }
  // esperado: { titulo?, descricao?, atributos?:[{atributo_id, valor}], preco?, galeria?:[picture_ids], variacao_externa_id?, enviado_em }
  async function conferirPublicado(cliente, anuncio_id, esperado = {}) {
    const r = await lerItem(cliente, anuncio_id)
    if (r.classe) return { ok: false, classe: r.classe, erro: r.erro, campos: [], conclusivo: false }
    const desc = esperado.descricao != null ? await lerDescricao(cliente, anuncio_id) : null
    return { ok: true, anuncio_id, lido_em: agora(), status_canal: r.corpo.status, sub_status: r.corpo.sub_status || [], ...conferirCampos(r.corpo, desc, esperado, { enviado_em: esperado.enviado_em, agora: agora() }), snapshot_depois_json: JSON.stringify({ item: r.corpo, descricao: desc }) }
  }

  // criação: só com pode.criar; idempotente por chave — depois de timeout CONSULTA por SKU antes de qualquer novo POST
  // excluir_ids: anúncios JÁ conhecidos com o mesmo SELLER_SKU (o original de uma duplicata, irmãos) — a consulta de idempotência não pode confundi-los com o criado agora
  async function criarAnuncio(cliente, proposta, { live = false, chave_idem = '', publicacao_anterior = null, capacidades = null, excluir_ids = [] } = {}) {
    const registros = [], base = { cliente, canal: 'ML', operacao: 'criar', chave_idem, live: live === true, registros, pendencias: [] }
    const cap = capacidades || await consultarCapacidades(cliente)
    if (!cap.pode.criar) return { ...base, estado: 'rejeitado', motivo: cap.observacoes.join(' | ') || 'criação não permitida' }
    const p = proposta || {}, faltam = ['titulo', 'categoria_id', 'preco', 'estoque', 'sku'].filter(k => p[k] == null || p[k] === '')
    if (!p.galeria?.length) faltam.push('galeria')
    if (faltam.length) return { ...base, estado: 'pendente_dados', motivo: `faltam: ${faltam.join(', ')}`, pendencias: faltam }
    const est = estoqueDuplicata(p)                                                    // V3 F5: Σ estoques próprios do produto ≤ físico (duplicata em UP novo)
    if (est && est.motivo !== 'estoque_fisico' && !est.ok) return { ...base, estado: 'rejeitado', motivo: est.motivo, mensagem: MOTIVOS_ESTOQUE_FISICO[est.motivo] }
    if (est && est.motivo === 'estoque_fisico' && live === true) return { ...base, estado: 'pendente_dados', motivo: 'estoque_fisico', mensagem: MOTIVOS_ESTOQUE_FISICO.estoque_fisico, pendencias: ['estoque_fisico'] }
    const atributos = (p.atributos || []).map(a => ({ id: String(a.atributo_id || a.id).toUpperCase(), value_name: String(a.valor_proposto ?? a.value_name) })).filter(a => !ATRIBUTOS_INTOCAVEIS.includes(a.id) || a.id === 'SELLER_SKU' || a.id === 'GTIN')   // na criação GTIN/SKU entram (identificação do produto novo)
    // critério 8 vale na criação também: MPN/fabricante/marca/modelo com termo promocional não viram payload
    const promo = atributos.filter(a => CAMPOS_FACTUAIS.includes(a.id) && TERMO_PROMOCIONAL.test(a.value_name)).map(a => a.id)
    if (promo.length) return { ...base, estado: 'rejeitado', motivo: `termo promocional em campo factual (${promo.join(', ')}): reprovado — o campo representa o atributo real` }
    if (!atributos.some(a => a.id === 'SELLER_SKU')) atributos.push({ id: 'SELLER_SKU', value_name: String(p.sku) })
    if (p.gtin && !atributos.some(a => a.id === 'GTIN')) atributos.push({ id: 'GTIN', value_name: String(p.gtin) })
    const corpo = { title: String(p.titulo).slice(0, 60), category_id: p.categoria_id, price: arred2(p.preco), currency_id: 'BRL', available_quantity: Number(p.estoque), buying_mode: 'buy_it_now', condition: p.condicao || 'new', listing_type_id: p.listing_type || 'gold_special',
      pictures: p.galeria.map(g => g.picture_id ? { id: g.picture_id } : { source: g.url }), attributes: atributos, ...(p.descricao ? { description: { plain_text: String(p.descricao) } } : {}), ...(p.variacoes?.length ? { variations: p.variacoes } : {}) }
    base.pendencias.push('User Products: elegibilidade/obrigatoriedade para a categoria não verificada — se o ML exigir o modelo novo, o POST responde 400 e o payload precisa de family_name sem title (a confirmar)')
    if (!live) return { ...base, estado: 'dry_run', payload: corpo }
    if (!chave_idem) return { ...base, estado: 'rejeitado', motivo: 'criação live exige chave_idem' }
    // já houve tentativa sem resposta conclusiva com esta chave? consultar ANTES de repetir (nunca duplicar anúncio)
    if (publicacao_anterior && ['processamento_pendente', 'transitorio'].includes(publicacao_anterior.classe_erro || publicacao_anterior.classe)) {
      const achado = await procurarPorSku(cliente, p.sku)
      achado.ids = achado.ids.filter(x => !excluir_ids.includes(x))
      registros.push(registro('consulta_idempotencia', achado.r, { metodo: 'GET', caminho: achado.caminho }))
      if (achado.ids.length) return { ...base, estado: 'em_conferencia', anuncio_id: achado.ids[0], recuperado: true, motivo: `anúncio já existia com SELLER_SKU ${p.sku} (criado na tentativa anterior): nenhum novo POST`, ids: achado.ids }
      if (achado.r.classe) return { ...base, estado: 'aguardando_canal', classe_erro: achado.r.classe, motivo: 'não foi possível conferir se a tentativa anterior criou o anúncio: NÃO repetir a criação até conseguir ler a conta', pendencias: [...base.pendencias, PENDENCIA_POR_CLASSE[achado.r.classe]] }
    }
    const r = await req(cliente, 'POST', '/items', { corpo })
    registros.push(registro('criar', r, { metodo: 'POST', caminho: '/items', corpo }))
    if (r.classe) return { ...base, estado: ESTADO_POR_CLASSE[r.classe], classe_erro: r.classe, erro: r.erro, payload: corpo, pendencias: [...base.pendencias, PENDENCIA_POR_CLASSE[r.classe], ...(r.classe === 'processamento_pendente' ? ['antes de repetir: consultar /users/{seller}/items/search?seller_sku= (o adaptador faz isso sozinho na retomada com a mesma chave)'] : [])] }
    return { ...base, estado: 'em_conferencia', anuncio_id: r.corpo?.id, permalink: r.corpo?.permalink || '', payload: corpo, resposta: { id: r.corpo?.id, status: r.corpo?.status, pictures: (r.corpo?.pictures || []).map(x => x.id) }, pendencias: [...base.pendencias, 'API aceitou ≠ anúncio visível/aprovado: conferir status/sub_status depois da propagação'] }
  }
  async function procurarPorSku(cliente, sku) {
    const c = conta(cliente), seller = c?.meli_user_id
    if (!seller) return { ids: [], r: { status: 0, classe: 'transitorio', erro: 'seller id desconhecido (conta sem meli_user_id)' }, caminho: '' }
    const caminho = `/users/${seller}/items/search?seller_sku=${encodeURIComponent(sku)}`     // parâmetro seller_sku — a confirmar na 1ª execução real
    const r = await req(cliente, 'GET', caminho)
    return { ids: r.classe ? [] : (r.corpo?.results || []), r, caminho }
  }

  return { consultarCapacidades, importarAnuncio, consultarCategoriaEAtributos, consultarRegrasComerciais, validarProposta, montarPayloads, diff, publicar, conferirPublicado, criarAnuncio, enviarImagem, lerVozDoCliente, classificarErro, ESTADO_POR_CLASSE, REGRAS_IMAGEM_ML }
}

// ── pronto para o servidor (lazy: importar este módulo nos testes NÃO abre data/db.sqlite) ───────────────────
let pronto = null
export async function adaptadorMLPronto() {
  if (pronto) return pronto
  const [{ tokenValido }, { db }, { ROOT }] = await Promise.all([import('./meli-contas.js'), import('./db.js'), import('./env.js')])
  const hosts = String(process.env.OFERTAS_HOSTS_IMAGEM || '').split(/[\s,]+/).filter(Boolean)      // hosts próprios autorizados a servir candidatas (vazio = só arquivo local)
  const { criarCatalogo } = await import('./catalogo-db.js'), { origemCatalogo } = await import('./catalogo.js'), cat = criarCatalogo(db)
  pronto = criarAdaptadorML({ fetch: globalThis.fetch.bind(globalThis), tokenValido, conta: c => db.prepare('SELECT meli_user_id, nickname, escopos FROM meli_contas WHERE cliente = ?').get(c) || null, hostsImagem: hosts, raizLocal: join(ROOT, 'data', 'ofertas'),
    origemCatalogo: (c, id) => origemCatalogo({ id, catalogo: 1 }, cat.contexto(c)) })
  return pronto
}
