// Núcleo de dados do módulo Ofertas Estratégicas (docs/ofertas-estrategicas.md; spec Desktop/Especificacao-Ofertas-Estrategicas.md §2, §4, §6, §10, §13).
// Identidade: Produto → Variante (SKU único por cliente) → Anúncio (canal+conta+id externo+variação). Jobs com máquina de estados, propostas versionadas,
// aprovação campo a campo presa à versão, publicações idempotentes e auditoria. Fábrica com banco injetado (criarOfertas(h)) — o autoteste usa banco em memória.
// Regras: toda consulta filtra `cliente`; GATE 0 (referência confirmada) antes de produção/publicação; vínculo SKU↔anúncio só explícito (nunca por nome);
// vazio = desconhecido (NULL), nunca 0; MPN/fabricante/modelo só com fato (termo promocional reprova); custo ausente bloqueia preço, não imagem;
// mensagens de erro não ecoam o valor recebido; dinheiro somado em centavos.
import { randomUUID } from 'node:crypto'
import { CAMPOS_IDENTIDADE } from './ofertas-preservacao.js'
import { termosPromocionais } from './ofertas-diagnostico.js'   // fonte única do termo promocional (validarFatual)
// Trocar/Preservar: núcleo puro em ofertas-preservacao.js; reexportado daqui (API pública do módulo — G4 consome checarPreservacao)
export { checarPreservacao, CAMPOS_PRESERVAR, CAMPOS_PRESERVAR_TITULO, ROTULO_PRESERVAR, CAMPOS_IDENTIDADE } from './ofertas-preservacao.js'

export const ESCOPOS = ['oferta_completa', 'titulo_descricao', 'ficha', 'preco', 'imagem_avulsa', 'galeria']
export const OBJETIVOS = ['lancar', 'elevar_clique', 'melhorar_conversao', 'preservar_margem', 'corrigir_ficha', 'campanha_sazonal']
export const MODOS = ['rascunho', 'publicar_apos_aprovacao', 'automatico_politica']
export const CANAIS_OFERTA = ['ML', 'SHO', 'AMZ', 'TTK', 'MAG']
export const ESTADOS_PUBLICACAO = ['preparada', 'enviada', 'aceita', 'processando', 'publicada', 'verificada', 'falhou', 'divergente']
// campos do conteúdo da proposta permitidos por escopo ("mudancas" sempre pode)
export const CAMPOS_POR_ESCOPO = {
  oferta_completa: ['titulo', 'descricao', 'atributos', 'preco', 'galeria'], titulo_descricao: ['titulo', 'descricao'],
  ficha: ['atributos'], preco: ['preco'], imagem_avulsa: ['galeria'], galeria: ['galeria'],
}

// Cada estado tem ação clara, responsável e se a entrada exige motivo (nada de "em processamento" genérico).
export const ESTADOS = {
  rascunho:              { rotulo: 'Rascunho', acao: 'Completar dados e enviar para validação', responsavel: 'analista' },
  validando_entrada:     { rotulo: 'Validando entrada', acao: 'Sistema confere SKU, fotos, custo e vínculo do anúncio', responsavel: 'sistema' },
  pendente_dados:        { rotulo: 'Pendente de dados', acao: 'Fornecer o que falta (foto, custo, ficha, vínculo)', responsavel: 'consultor', exige_motivo: true },
  referencia_confirmada: { rotulo: 'Referência confirmada', acao: 'Preparar a estratégia (diagnóstico + proposta)', responsavel: 'sistema' },
  estrategia_preparada:  { rotulo: 'Estratégia preparada', acao: 'Aprovar ou reprovar a direção proposta', responsavel: 'consultor' },
  estrategia_aprovada:   { rotulo: 'Estratégia aprovada', acao: 'Iniciar produção (textos, ficha, preço, imagens)', responsavel: 'sistema' },
  em_producao:           { rotulo: 'Em produção', acao: 'Gerar e montar a versão da proposta', responsavel: 'sistema' },
  em_revisao:            { rotulo: 'Em revisão', acao: 'Revisar antes/depois e aprovar campo a campo', responsavel: 'aprovador' },
  aprovado_publicar:     { rotulo: 'Aprovado para publicar', acao: 'Entrar na fila de publicação', responsavel: 'sistema' },
  na_fila:               { rotulo: 'Na fila', acao: 'Aguardar o trabalhador de publicação', responsavel: 'sistema' },
  publicando:            { rotulo: 'Publicando', acao: 'Enviando ao canal (snapshot + payload só dos campos aprovados)', responsavel: 'sistema' },
  em_conferencia:        { rotulo: 'Em conferência', acao: 'Reler o anúncio no canal e comparar com o aprovado', responsavel: 'sistema' },
  publicado_confirmado:  { rotulo: 'Publicado e conferido', acao: 'Iniciar o acompanhamento de resultado', responsavel: 'sistema' },
  monitorando:           { rotulo: 'Monitorando', acao: 'Acompanhar métricas na janela definida', responsavel: 'consultor' },
  falha_recuperavel:     { rotulo: 'Falha recuperável', acao: 'Corrigir e retomar do ponto onde parou', responsavel: 'analista', exige_motivo: true },
  falha_parcial:         { rotulo: 'Falha parcial', acao: 'Reconciliar o que entrou e reenviar só o que faltou', responsavel: 'analista', exige_motivo: true },
  aguardando_canal:      { rotulo: 'Aguardando canal', acao: 'Canal ainda processando: nova consulta agendada', responsavel: 'sistema', exige_motivo: true },
  conflito_externo:      { rotulo: 'Conflito externo', acao: 'Anúncio mudou no canal: revisar antes de reenviar', responsavel: 'consultor', exige_motivo: true },
  cancelado:             { rotulo: 'Cancelado', acao: 'Nenhuma', responsavel: 'solicitante', exige_motivo: true, terminal: true },
  rejeitado:             { rotulo: 'Rejeitado', acao: 'Motivo curto reaproveitado na próxima rodada', responsavel: 'aprovador', exige_motivo: true },
}
export const TRANSICOES = {
  rascunho: ['validando_entrada', 'cancelado'],
  validando_entrada: ['pendente_dados', 'referencia_confirmada', 'cancelado'],
  pendente_dados: ['validando_entrada', 'cancelado'],
  referencia_confirmada: ['estrategia_preparada', 'pendente_dados', 'cancelado'],
  estrategia_preparada: ['estrategia_aprovada', 'rejeitado', 'pendente_dados', 'cancelado'],
  estrategia_aprovada: ['em_producao', 'pendente_dados', 'cancelado'],
  em_producao: ['em_revisao', 'falha_recuperavel', 'pendente_dados', 'cancelado'],
  em_revisao: ['aprovado_publicar', 'em_producao', 'rejeitado', 'pendente_dados', 'cancelado'],
  aprovado_publicar: ['na_fila', 'em_revisao', 'pendente_dados', 'cancelado'],
  na_fila: ['publicando', 'em_revisao', 'pendente_dados', 'conflito_externo', 'cancelado'],
  publicando: ['em_conferencia', 'falha_recuperavel', 'falha_parcial', 'aguardando_canal', 'conflito_externo'],
  em_conferencia: ['publicado_confirmado', 'falha_parcial', 'aguardando_canal', 'conflito_externo'],
  publicado_confirmado: ['monitorando'],
  monitorando: [],
  falha_recuperavel: ['na_fila', 'em_producao', 'cancelado'],
  falha_parcial: ['na_fila', 'em_revisao', 'cancelado'],
  aguardando_canal: ['em_conferencia', 'falha_recuperavel', 'conflito_externo'],
  conflito_externo: ['em_revisao', 'cancelado'],
  cancelado: [],
  rejeitado: ['em_producao', 'cancelado'],
}
// GATE 0: estados que a variante só alcança com referência confirmada
const EXIGE_REFERENCIA = new Set(['referencia_confirmada', 'estrategia_preparada', 'estrategia_aprovada', 'em_producao', 'em_revisao', 'aprovado_publicar', 'na_fila', 'publicando'])
const ESTADOS_ATIVOS_POS_REFERENCIA = ['referencia_confirmada', 'estrategia_preparada', 'estrategia_aprovada', 'em_producao', 'em_revisao', 'aprovado_publicar', 'na_fila']

// ── estrutura estratégica (método IMA/MIRA, CLAUDE.md): a oferta completa segue voz do cliente → ângulo → galeria por posição → título DEPOIS das imagens → ficha → preço.
// A etapa atual é derivada do que o job tem (voz coletada, direção aprovada, campos aprovados na versão atual, dispensa com motivo) e fica registrada em dados.etapa.
const DEPOIS_DA_DIRECAO = new Set(['estrategia_aprovada', 'em_producao', 'em_revisao', 'aprovado_publicar', 'na_fila', 'publicando', 'em_conferencia', 'publicado_confirmado', 'monitorando', 'falha_recuperavel', 'falha_parcial', 'aguardando_canal', 'conflito_externo'])
const ROTULO_CAMPO = { titulo: 'Título', descricao: 'Descrição', atributos: 'Ficha técnica', preco: 'Preço', galeria: 'Galeria' }
export function metodoDoJob(job, { conteudo = null, aprovados = new Set(), estrategia = null } = {}) {
  const d = job.dados || {}, tem = k => !!conteudo && k in conteudo, ok = k => aprovados.has(k), etapas = []
  const add = (id, rotulo, estado, nota = '') => etapas.push({ id, rotulo, estado, nota })
  if (d.duplicacao) add('briefing', 'Briefing do consultor (objetivo, volume e variações)', d.briefing ? 'feita' : 'pendente',
    d.briefing ? `${d.briefing.objetivo} · ${d.briefing.volume} duplicata(s) · por ${d.briefing.por}` : 'duplicação só com objetivo e volume do método (config/duplicacao.json) definidos pelo consultor')
  if (job.escopo === 'oferta_completa') {
    const voz = d.voz_cliente, temRef = !!(job.anuncio_id || d.duplicacao)
    add('voz_cliente', 'Voz do cliente (perguntas e avaliações)', voz?.estado === 'coletada' ? 'feita' : voz ? 'sem_dado' : temRef ? 'pendente' : 'nao_se_aplica',
      voz?.estado === 'coletada' ? `${voz.perguntas} pergunta(s) e ${voz.avaliacoes} avaliação(ões) lidas do canal` : voz ? `${voz.motivo} — o ângulo fica como hipótese` : temRef ? 'ainda não coletada' : 'produto novo: sem perguntas/avaliações próprias — o ângulo nasce como hipótese')
    add('angulo', 'Ângulo (direção da oferta aprovada)', DEPOIS_DA_DIRECAO.has(job.estado) ? 'feita' : 'pendente', estrategia?.angulo?.texto || 'aprovar a direção proposta')
    const gal = ok('galeria') ? 'feita' : d.dispensas?.galeria ? 'dispensada' : 'pendente'
    add('galeria', 'Galeria por posição', gal, gal === 'dispensada' ? `galeria atual mantida: ${d.dispensas.galeria.motivo} (${d.dispensas.galeria.por})` : gal === 'pendente' ? (tem('galeria') ? 'aprovar a galeria proposta' : 'produzir as imagens por posição e montar a galeria (revisar) antes do título') : '')
    const txt = ['titulo', 'descricao'].filter(tem)
    add('titulo', 'Título e descrição (depois das imagens)', !txt.length ? 'nao_se_aplica' : txt.every(ok) ? 'feita' : 'pendente',
      txt.length && !txt.every(ok) ? (gal === 'pendente' ? 'aguarda a galeria aprovada: o título vem DEPOIS das imagens (método IMA)' : 'aprovar título e descrição') : '')
    add('ficha', 'Ficha técnica', !tem('atributos') ? 'nao_se_aplica' : ok('atributos') ? 'feita' : 'pendente', tem('atributos') && !ok('atributos') ? 'aprovar os atributos com evidência' : '')
    add('preco', 'Preço', !tem('preco') ? 'nao_se_aplica' : ok('preco') ? 'feita' : 'pendente', conteudo?.preco?.bloqueios?.length ? `bloqueado: ${conteudo.preco.bloqueios.join(', ')}` : tem('preco') && !ok('preco') ? 'aprovar o preço' : '')
  } else for (const c of CAMPOS_POR_ESCOPO[job.escopo] || []) add(c, ROTULO_CAMPO[c], !tem(c) ? 'nao_se_aplica' : ok(c) ? 'feita' : 'pendente', tem(c) && !ok(c) ? `aprovar ${ROTULO_CAMPO[c].toLowerCase()}` : '')
  const pend = etapas.filter(e => e.estado === 'pendente')
  return { etapas, atual: pend[0]?.id || 'concluido', pendencias: pend.map(e => `${e.rotulo}: ${e.nota || 'pendente'}`) }
}
export const ETAPAS_DISPENSAVEIS = ['galeria']
// regra do motor (config/algoritmo.json) que um job executa quando não está ligado a uma ação já existente: escopo → oferta_*; sem anúncio = anúncio novo
export const REGRA_POR_ESCOPO = { galeria: 'oferta_galeria', imagem_avulsa: 'oferta_galeria', titulo_descricao: 'oferta_titulo_descricao', ficha: 'oferta_ficha', preco: 'oferta_preco', oferta_completa: 'oferta_completa' }
export const regraDoJob = job => job.dados?.regra || (!job.anuncio_id && job.escopo === 'oferta_completa' ? 'oferta_cadastro' : REGRA_POR_ESCOPO[job.escopo])

// ── fato × campanha: MPN/fabricante/modelo/marca só com o atributo real ───────────
export const ATRIBUTOS_FATUAIS = ['MPN', 'MANUFACTURER', 'MODEL', 'ALPHANUMERIC_MODEL', 'BRAND', 'GTIN', 'SELLER_SKU']
// termo promocional/sazonal/promessa = FONTE ÚNICA termosPromocionais (config/ofertas.json + regra do "top": elogio/promessa vetado, "Top Fitness" peça de roupa passa,
// "premium" só como elogio do top). Aqui fica só o apelo de prazo/pagamento/garantia que o config não lista.
export const RX_PROMOCIONAL = /\b(envio\s+(r[aá]pido|imediato)|\d+x\s+sem\s+juros|sem\s+juros|original\s+com\s+garantia)\b/i
export const PALAVRAS_FORA_DO_FATO = ['ideal para', 'perfeito para', 'para academia', 'para corrida', 'para presente', 'qualidade', 'garantia', 'resistente', 'prova d', 'compatível com todos', 'kit completo', 'super', 'mega', 'ultra']
const RX_NOME_FATUAL = /\b(mpn|fabricante|manufacturer|modelo|model|marca|brand|gtin|ean|c[oó]digo)\b/i
// vestuario: o mesmo contexto da ficha que montarTituloDetalhado usa (ehVestuario); quem não o tem passa false (regra mais estrita)
export function validarFatual({ atributo_id = '', nome = '', valor = '', vestuario = false }) {
  const v = String(valor ?? '').trim()
  if (!v) return { ok: true }
  const fatual = ATRIBUTOS_FATUAIS.includes(String(atributo_id).toUpperCase()) || RX_NOME_FATUAL.test(String(nome))
  if (!fatual) return { ok: true }
  const vet = termosPromocionais(v, null, { vestuario })
  if (vet.length) return { ok: false, motivo: `termo promocional ("${vet[0]}") em campo factual` }
  const m = v.match(RX_PROMOCIONAL)
  if (m) return { ok: false, motivo: `termo promocional ("${m[0].toLowerCase()}") em campo factual` }
  const fora = PALAVRAS_FORA_DO_FATO.find(p => v.toLowerCase().includes(p))
  if (fora) return { ok: false, motivo: `palavra-chave fora do fato ("${fora}") em campo factual` }
  if (v.split(/\s+/).length > 6) return { ok: false, motivo: 'parece lista de palavras-chave, não um identificador (mais de 6 palavras)' }
  return { ok: true }
}

// ── utilidades ────────────────────────────────────────────────────────────────
const agora = () => new Date().toISOString()
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max)
const json = (s, padrao) => { try { return s ? JSON.parse(s) : padrao } catch { return padrao } }
const exigirCliente = c => { if (typeof c !== 'string' || !c.trim() || /^\[comercial\]/i.test(c.trim())) throw erro('cliente obrigatório') }
const exigirPor = p => { const s = txt(p, 80); if (!s) throw erro('informe "por" (quem está fazendo — fica na auditoria)'); return s }
const centavos = n => Math.round(Number(n) * 100)
// mesma regra declarada de custos-db.normalizarSku (copiada p/ não abrir o banco das promoções no import): sem fuzzy, zeros/hífens/caixa preservados
const normalizarSku = s => typeof s === 'string' || (typeof s === 'number' && Number.isFinite(s))
  ? String(s).normalize('NFC').replace(/\u{A0}/gu, ' ').replace(/[\u{200B}-\u{200D}\u{FEFF}]/gu, '').trim().slice(0, 80) : ''
// número de planilha: vazio = desconhecido (null). Aceita 12.5 e "12,5"; texto não numérico = inválido (undefined)
const numPlanilha = v => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.trim().replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : undefined
}
const inteiro = v => { const n = numPlanilha(v); return n === null || n === undefined ? n : Number.isInteger(n) && n >= 0 ? n : undefined }
const CAMPOS_VARIANTE = {       // coluna da planilha → coluna do banco, tipo
  sku_pai: ['sku_pai', 'txt'], cor: ['cor', 'txt'], tamanho: ['tamanho', 'txt'], material: ['material', 'txt'], quantidade_kit: ['quantidade_kit', 'int'],
  unidade_venda: ['unidade_venda', 'txt'], peso_produto_kg: ['peso_kg', 'num'], peso_embalado_kg: ['peso_embalado_kg', 'num'], altura_embalagem_cm: ['alt_cm', 'num'],
  largura_embalagem_cm: ['larg_cm', 'num'], comprimento_embalagem_cm: ['comp_cm', 'num'], estoque_disponivel: ['estoque', 'int'],
  consultor_id: ['consultor', 'txt'], analista_id: ['analista', 'txt'], prioridade: ['prioridade', 'txt'], objetivo_otimizacao: ['objetivo', 'txt'],
}
const COLS_VARIANTE = ['sku_pai', 'cor', 'tamanho', 'material', 'quantidade_kit', 'unidade_venda', 'peso_kg', 'peso_embalado_kg', 'alt_cm', 'larg_cm', 'comp_cm', 'estoque', 'consultor', 'analista', 'prioridade', 'objetivo']
const COLS_PRODUTO = ['nome', 'marca', 'modelo', 'gtin', 'mpn', 'categoria_canal', 'descricao_base']
const COLS_ANUNCIO = ['catalogo_id', 'categoria_id', 'url', 'titulo_atual', 'preco_atual', 'estoque_canal', 'status_canal']
// origem válida da foto de referência (GATE 0): galeria do PRÓPRIO anúncio, foto do dono ou pasta da SKU — nunca outro produto
export const ORIGENS_REFERENCIA = ['anuncio', 'foto_dono', 'drive']

// custoDoAnuncio(cliente, { item_id, sku }) = a resolução única de custos-db (vinculosCusto); sem ela (teste), custosSku por SKU exato
export function criarOfertas(h, { custosSku = () => new Map(), custoDoAnuncio = null } = {}) {
  const linha = (sql, ...a) => h.prepare(sql).get(...a)
  const linhas = (sql, ...a) => h.prepare(sql).all(...a)
  const evento = (cliente, entidade, entidade_id, acao, por, detalhes = {}) =>
    h.prepare('INSERT INTO of_evento (cliente, entidade, entidade_id, acao, por, detalhes_json, em) VALUES (?,?,?,?,?,?,?)')
      .run(cliente, entidade, String(entidade_id), acao, txt(por, 80), JSON.stringify(detalhes).slice(0, 20000), agora())

  // ── produtos ────────────────────────────────────────────────────────────────
  const mapaProduto = r => !r ? null : { ...r }
  function criarProduto(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    if (!txt(dados.nome)) throw erro('nome do produto obrigatório')
    const id = randomUUID(), t = agora()
    h.prepare(`INSERT INTO of_produto (id, cliente, nome, marca, modelo, gtin, mpn, categoria_canal, descricao_base, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, cliente, txt(dados.nome), txt(dados.marca), txt(dados.modelo), txt(dados.gtin, 40), txt(dados.mpn, 80), txt(dados.categoria_canal, 80), txt(dados.descricao_base, 20000), t, t)
    evento(cliente, 'produto', id, 'criado', por, { nome: txt(dados.nome) })
    return obterProduto(cliente, id)
  }
  function atualizarProduto(cliente, id, patch = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const p = linha('SELECT * FROM of_produto WHERE cliente = ? AND id = ?', cliente, id)
    if (!p) throw erro('produto não encontrado', 404)
    const mudancas = []
    for (const c of COLS_PRODUTO) if (c in patch && txt(patch[c], c === 'descricao_base' ? 20000 : 200) !== p[c]) mudancas.push({ campo: c, de: p[c], para: txt(patch[c], c === 'descricao_base' ? 20000 : 200) })
    if (mudancas.length) {
      for (const m of mudancas) h.prepare(`UPDATE of_produto SET ${m.campo} = ?, atualizado_em = ? WHERE cliente = ? AND id = ?`).run(m.para, agora(), cliente, id)
      evento(cliente, 'produto', id, 'atualizado', por, { mudancas })
    }
    return { ...obterProduto(cliente, id), mudancas }
  }
  const listarProdutos = cliente => { exigirCliente(cliente); return linhas(`SELECT p.*, (SELECT COUNT(*) FROM of_variante v WHERE v.cliente = p.cliente AND v.produto_id = p.id) variantes FROM of_produto p WHERE p.cliente = ? ORDER BY p.nome`, cliente).map(mapaProduto) }
  function obterProduto(cliente, id) {
    exigirCliente(cliente)
    const p = linha('SELECT * FROM of_produto WHERE cliente = ? AND id = ?', cliente, id)
    return p ? { ...p, variantes: listarVariantes(cliente, { produto_id: id }) } : null
  }

  // ── variantes ───────────────────────────────────────────────────────────────
  const mapaVariante = r => !r ? null : { ...r, referencia_confirmada: !!r.referencia_confirmada }
  function criarVariante(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const sku = normalizarSku(dados.sku)
    if (!sku) throw erro('sku obrigatório (texto até 80 caracteres)')
    if (!linha('SELECT id FROM of_produto WHERE cliente = ? AND id = ?', cliente, dados.produto_id)) throw erro('produto não encontrado neste cliente', 404)
    if (linha('SELECT id FROM of_variante WHERE cliente = ? AND sku = ?', cliente, sku)) throw erro('já existe variante com este SKU neste cliente', 409)
    if (dados.objetivo && !OBJETIVOS.includes(dados.objetivo)) throw erro(`objetivo inválido (${OBJETIVOS.join(' | ')})`)
    const id = randomUUID(), t = agora(), v = valoresVariante(dados)
    h.prepare(`INSERT INTO of_variante (id, produto_id, cliente, sku, ${COLS_VARIANTE.join(', ')}, criado_em, atualizado_em)
      VALUES (?,?,?,?,${COLS_VARIANTE.map(() => '?').join(',')},?,?)`).run(id, dados.produto_id, cliente, sku, ...COLS_VARIANTE.map(c => v[c]), t, t)
    evento(cliente, 'variante', id, 'criada', por, { sku })
    return obterVariante(cliente, id)
  }
  // valores saneados por coluna do banco: texto → txt; número/inteiro → null quando vazio; inválido → erro (nunca 0 automático)
  function valoresVariante(dados) {
    const v = {}
    for (const c of COLS_VARIANTE) {
      if (!(c in dados)) { v[c] = ['quantidade_kit', 'peso_kg', 'peso_embalado_kg', 'alt_cm', 'larg_cm', 'comp_cm', 'estoque'].includes(c) ? null : ''; continue }
      if (['quantidade_kit', 'estoque'].includes(c)) { v[c] = inteiro(dados[c]); if (v[c] === undefined) throw erro(`${c} inválido: inteiro ≥ 0 ou vazio`) }
      else if (['peso_kg', 'peso_embalado_kg', 'alt_cm', 'larg_cm', 'comp_cm'].includes(c)) { v[c] = numPlanilha(dados[c]); if (v[c] === undefined || v[c] < 0) throw erro(`${c} inválido: número ≥ 0 ou vazio`) }
      else v[c] = txt(dados[c], 120)
    }
    return v
  }
  function atualizarVariante(cliente, id, patch = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const atual = linha('SELECT * FROM of_variante WHERE cliente = ? AND id = ?', cliente, id)
    if (!atual) throw erro('variante não encontrada', 404)
    if ('objetivo' in patch && patch.objetivo && !OBJETIVOS.includes(patch.objetivo)) throw erro(`objetivo inválido (${OBJETIVOS.join(' | ')})`)
    const novo = valoresVariante({ ...atual, ...patch }), mudancas = []
    for (const c of COLS_VARIANTE) if (novo[c] !== atual[c]) mudancas.push({ campo: c, de: atual[c], para: novo[c] })
    if ('sku' in patch) {
      const sku = normalizarSku(patch.sku)
      if (!sku) throw erro('sku inválido')
      if (sku !== atual.sku) {
        if (linha('SELECT id FROM of_variante WHERE cliente = ? AND sku = ? AND id <> ?', cliente, sku, id)) throw erro('já existe variante com este SKU neste cliente', 409)
        mudancas.push({ campo: 'sku', de: atual.sku, para: sku })
      }
    }
    if (!mudancas.length) return { ...obterVariante(cliente, id), mudancas }
    const perdeReferencia = atual.referencia_confirmada && mudancas.some(m => CAMPOS_IDENTIDADE.includes(m.campo))
    h.transaction(() => {
      for (const m of mudancas) h.prepare(`UPDATE of_variante SET ${m.campo} = ?, atualizado_em = ? WHERE cliente = ? AND id = ?`).run(m.para, agora(), cliente, id)
      if (perdeReferencia) revogarReferencia(cliente, id, por, `identidade física alterada (${mudancas.filter(m => CAMPOS_IDENTIDADE.includes(m.campo)).map(m => m.campo).join(', ')}): confirme a referência de novo`)
      evento(cliente, 'variante', id, 'atualizada', por, { mudancas })
    })()
    return { ...obterVariante(cliente, id), mudancas }
  }
  function listarVariantes(cliente, { produto_id = '', sku = '' } = {}) {
    exigirCliente(cliente)
    return linhas(`SELECT v.*, p.nome produto_nome, p.marca,
        (SELECT COUNT(*) FROM of_anuncio a WHERE a.cliente = v.cliente AND a.variante_id = v.id) anuncios,
        (SELECT COUNT(*) FROM of_job j WHERE j.cliente = v.cliente AND j.variante_id = v.id AND j.estado NOT IN ('cancelado','rejeitado','monitorando')) jobs_ativos
      FROM of_variante v JOIN of_produto p ON p.id = v.produto_id AND p.cliente = v.cliente
      WHERE v.cliente = ? ${produto_id ? 'AND v.produto_id = ?' : ''} ${sku ? 'AND v.sku = ?' : ''} ORDER BY p.nome, v.sku`,
    cliente, ...(produto_id ? [produto_id] : []), ...(sku ? [normalizarSku(sku)] : [])).map(mapaVariante)
  }
  function obterVariante(cliente, id) {
    exigirCliente(cliente)
    const v = linha('SELECT * FROM of_variante WHERE cliente = ? AND id = ?', cliente, id)
    if (!v) return null
    return { ...mapaVariante(v), anuncios: listarAnuncios(cliente, { variante_id: id }), imagens: listarImagens(cliente, { variante_id: id }), custo: custoVigente(cliente, id) }
  }
  // GATE 0: o dono olhou a folha de bases e disse "é este o produto". origem_fotos: [{ origem: anuncio|foto_dono|drive, ref }] — cada original vira of_imagem da variante
  function confirmarReferencia({ cliente, variante_id, por, origem_fotos } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const v = linha('SELECT * FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)
    if (!v) throw erro('variante não encontrada', 404)
    if (!Array.isArray(origem_fotos) || !origem_fotos.length) throw erro('origem_fotos obrigatória: lista de { origem, ref } (anúncio do próprio produto, foto do dono ou pasta da SKU)')
    for (const f of origem_fotos) {
      if (!ORIGENS_REFERENCIA.includes(f?.origem)) throw erro(`origem de foto inválida (${ORIGENS_REFERENCIA.join(' | ')})`)
      if (!txt(f.ref, 300)) throw erro('cada foto de referência precisa de ref (id do arquivo, URL ou anúncio:foto)')
      if (f.origem === 'anuncio' && !linhas('SELECT id FROM of_anuncio WHERE cliente = ? AND variante_id = ?', cliente, variante_id).length)
        throw erro('foto de anúncio só vale de um anúncio VINCULADO a esta variante (vincule antes)')
    }
    const t = agora()
    h.transaction(() => {
      const ins = h.prepare(`INSERT INTO of_imagem (id, cliente, variante_id, drive_file_id, url, papel, fonte, status, aprovado_por, aprovado_em, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      for (const f of origem_fotos) {
        const ref = txt(f.ref, 300), drive = f.origem === 'drive' ? ref : '', url = /^https?:\/\//i.test(ref) ? ref : ''
        if (!linha(`SELECT id FROM of_imagem WHERE cliente = ? AND variante_id = ? AND papel = 'original' AND fonte = ? AND (drive_file_id = ? OR url = ? OR prompt = ?)`, cliente, variante_id, f.origem, ref, ref, ref))
          ins.run(randomUUID(), cliente, variante_id, drive, url, 'original', f.origem, 'confirmada', por, t, t)
      }
      h.prepare('UPDATE of_variante SET referencia_confirmada = 1, confirmado_por = ?, confirmado_em = ?, atualizado_em = ? WHERE cliente = ? AND id = ?').run(por, t, t, cliente, variante_id)
      evento(cliente, 'variante', variante_id, 'referencia_confirmada', por, { origem_fotos: origem_fotos.map(f => ({ origem: f.origem, ref: txt(f.ref, 300) })) })
    })()
    return obterVariante(cliente, variante_id)
  }
  // foto errada / referência contraditória: a variante perde o GATE 0 e todo job dela além da validação volta para "pendente de dados"
  function contestarReferencia({ cliente, variante_id, por, motivo } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    if (!txt(motivo)) throw erro('motivo obrigatório (o que está errado na referência)')
    if (!linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada', 404)
    h.transaction(() => revogarReferencia(cliente, variante_id, por, txt(motivo, 300)))()
    return obterVariante(cliente, variante_id)
  }
  function revogarReferencia(cliente, variante_id, por, motivo) {
    h.prepare("UPDATE of_variante SET referencia_confirmada = 0, confirmado_por = '', confirmado_em = '', atualizado_em = ? WHERE cliente = ? AND id = ?").run(agora(), cliente, variante_id)
    evento(cliente, 'variante', variante_id, 'referencia_revogada', por, { motivo })
    for (const j of linhas(`SELECT id FROM of_job WHERE cliente = ? AND variante_id = ? AND estado IN (${ESTADOS_ATIVOS_POS_REFERENCIA.map(() => '?').join(',')})`, cliente, variante_id, ...ESTADOS_ATIVOS_POS_REFERENCIA))
      transicionar(cliente, j.id, 'pendente_dados', { por, motivo: `referência da variante revogada: ${motivo}`, pendencias: ['referencia_nao_confirmada'] })
  }

  // ── anúncios: vínculo SEMPRE pela chave externa; nunca por nome parecido ─────
  const mapaAnuncio = r => !r ? null : { ...r, snapshot: json(r.snapshot_json, {}), snapshot_json: undefined }
  function vincularAnuncio(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const canal = txt(dados.canal, 10).toUpperCase(), anuncio_id = txt(dados.anuncio_id, 60), conta_id = txt(dados.conta_id, 80), variacao = txt(dados.variacao_externa_id, 60)
    if (!CANAIS_OFERTA.includes(canal)) throw erro(`canal inválido (${CANAIS_OFERTA.join(' | ')})`)
    if (!anuncio_id) throw erro('anuncio_id obrigatório (identificador do anúncio no canal)')
    const variante_id = txt(dados.variante_id, 60)
    if (variante_id && !linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada neste cliente', 404)
    const preco = numPlanilha(dados.preco_atual), estoque = inteiro(dados.estoque_canal)
    if (preco === undefined || preco < 0) throw erro('preco_atual inválido')
    if (estoque === undefined) throw erro('estoque_canal inválido')
    const existente = linha('SELECT * FROM of_anuncio WHERE cliente = ? AND canal = ? AND conta_id = ? AND anuncio_id = ? AND variacao_externa_id = ?', cliente, canal, conta_id, anuncio_id, variacao)
    const t = agora(), novo = {
      variante_id: variante_id || existente?.variante_id || '', catalogo_id: txt(dados.catalogo_id, 60), categoria_id: txt(dados.categoria_id, 40), url: txt(dados.url, 500),
      titulo_atual: txt(dados.titulo_atual, 300), preco_atual: preco, estoque_canal: estoque, status_canal: txt(dados.status_canal, 40),
      snapshot_json: JSON.stringify(dados.snapshot ?? (existente ? json(existente.snapshot_json, {}) : {})).slice(0, 200000),
    }
    const id = existente?.id || randomUUID(), mudancas = []
    if (existente) {
      for (const c of ['variante_id', ...COLS_ANUNCIO]) if (c in dados && novo[c] !== existente[c] && !(c === 'preco_atual' && preco === null) && !(c === 'estoque_canal' && estoque === null)) mudancas.push({ campo: c, de: existente[c], para: novo[c] })
      if (mudancas.length || dados.snapshot) {
        for (const m of mudancas) h.prepare(`UPDATE of_anuncio SET ${m.campo} = ? WHERE id = ? AND cliente = ?`).run(m.para, id, cliente)
        h.prepare('UPDATE of_anuncio SET snapshot_json = ?, sincronizado_em = ? WHERE id = ? AND cliente = ?').run(novo.snapshot_json, t, id, cliente)
        evento(cliente, 'anuncio', id, 'atualizado', por, { mudancas })
      }
    } else {
      h.prepare(`INSERT INTO of_anuncio (id, cliente, variante_id, canal, conta_id, anuncio_id, variacao_externa_id, catalogo_id, categoria_id, url, titulo_atual, preco_atual, estoque_canal, status_canal, snapshot_json, sincronizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, cliente, novo.variante_id, canal, conta_id, anuncio_id, variacao, novo.catalogo_id, novo.categoria_id, novo.url, novo.titulo_atual, novo.preco_atual, novo.estoque_canal, novo.status_canal, novo.snapshot_json, t)
      evento(cliente, 'anuncio', id, 'vinculado', por, { canal, conta_id, anuncio_id, variacao_externa_id: variacao, variante_id: novo.variante_id })
    }
    return { ...obterAnuncio(cliente, id), novo: !existente, mudancas }
  }
  function listarAnuncios(cliente, { variante_id = '', canal = '' } = {}) {
    exigirCliente(cliente)
    return linhas(`SELECT * FROM of_anuncio WHERE cliente = ? ${variante_id ? 'AND variante_id = ?' : ''} ${canal ? 'AND canal = ?' : ''} ORDER BY canal, anuncio_id, variacao_externa_id`,
      cliente, ...(variante_id ? [variante_id] : []), ...(canal ? [canal] : [])).map(mapaAnuncio)
  }
  const obterAnuncio = (cliente, id) => { exigirCliente(cliente); return mapaAnuncio(linha('SELECT * FROM of_anuncio WHERE cliente = ? AND id = ?', cliente, id)) }

  // ── atributos com evidência ───────────────────────────────────────────────────
  function upsertAtributo(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const variante_id = txt(dados.variante_id, 60), atributo_id = txt(dados.atributo_id, 80)
    if (!linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada neste cliente', 404)
    if (!atributo_id) throw erro('atributo_id obrigatório')
    const canal = txt(dados.canal, 10).toUpperCase(), categoria_id = txt(dados.categoria_id, 40)
    const valor_proposto = txt(dados.valor_proposto, 1000), fonte = txt(dados.fonte, 120), evidencia = txt(dados.evidencia, 500)
    const f = validarFatual({ atributo_id, nome: dados.nome, valor: valor_proposto })
    const validacao = !f.ok ? `reprovado: ${f.motivo}` : valor_proposto && !fonte ? 'sem_evidencia: valor proposto sem fonte' : valor_proposto ? 'ok' : ''
    const ex = linha('SELECT * FROM of_atributo WHERE cliente = ? AND variante_id = ? AND canal = ? AND categoria_id = ? AND atributo_id = ?', cliente, variante_id, canal, categoria_id, atributo_id)
    const id = ex?.id || randomUUID(), t = agora()
    const v = { nome: txt(dados.nome, 120), tipo: txt(dados.tipo, 40), unidade: txt(dados.unidade, 20), valor_atual: 'valor_atual' in dados ? txt(dados.valor_atual, 1000) : ex?.valor_atual || '',
      valor_proposto, obrigatorio: dados.obrigatorio ? 1 : ex?.obrigatorio || 0, editavel: 'editavel' in dados ? (dados.editavel ? 1 : 0) : ex?.editavel ?? 1, fonte, evidencia, validacao, aprovado_por: '' }
    h.prepare(`INSERT INTO of_atributo (id, cliente, variante_id, canal, categoria_id, atributo_id, nome, tipo, unidade, valor_atual, valor_proposto, obrigatorio, editavel, fonte, evidencia, validacao, aprovado_por, atualizado_em)
      VALUES (@id,@cliente,@variante_id,@canal,@categoria_id,@atributo_id,@nome,@tipo,@unidade,@valor_atual,@valor_proposto,@obrigatorio,@editavel,@fonte,@evidencia,@validacao,@aprovado_por,@t)
      ON CONFLICT(cliente, variante_id, canal, categoria_id, atributo_id) DO UPDATE SET nome=@nome, tipo=@tipo, unidade=@unidade, valor_atual=@valor_atual, valor_proposto=@valor_proposto,
      obrigatorio=@obrigatorio, editavel=@editavel, fonte=@fonte, evidencia=@evidencia, validacao=@validacao, aprovado_por=@aprovado_por, atualizado_em=@t`)
      .run({ id, cliente, variante_id, canal, categoria_id, atributo_id, ...v, t })
    evento(cliente, 'atributo', id, ex ? 'atualizado' : 'criado', por, { atributo_id, validacao, de: ex?.valor_proposto ?? null, para: valor_proposto })
    return { ...linha('SELECT * FROM of_atributo WHERE id = ? AND cliente = ?', id, cliente), reprovado: !f.ok, motivo: f.motivo || '' }
  }
  const listarAtributos = (cliente, { variante_id, canal = '' } = {}) => { exigirCliente(cliente); if (!variante_id) throw erro('variante_id obrigatório')
    return linhas(`SELECT * FROM of_atributo WHERE cliente = ? AND variante_id = ? ${canal ? 'AND canal = ?' : ''} ORDER BY canal, atributo_id`, cliente, variante_id, ...(canal ? [canal] : [])) }

  // ── custos (vigência). Sem custo = bloqueio de PREÇO automático, nunca de imagem ─
  function registrarCusto(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const variante_id = txt(dados.variante_id, 60)
    if (!linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada neste cliente', 404)
    const custo = numPlanilha(dados.custo_compra)
    if (!(custo > 0)) throw erro('custo_compra obrigatório e > 0 (vazio ou zero não é custo)')
    const extras = {}
    for (const c of ['frete_entrada', 'embalagem', 'preparo', 'outros']) { extras[c] = numPlanilha(dados[c]); if (extras[c] === undefined || extras[c] < 0) throw erro(`${c} inválido: número ≥ 0 ou vazio`) }
    const inicio = txt(dados.inicio_vigencia, 30) || agora(), fim = txt(dados.fim_vigencia, 30)
    if (!Number.isFinite(Date.parse(inicio)) || (fim && !Number.isFinite(Date.parse(fim)))) throw erro('vigência inválida (data ISO)')
    const id = randomUUID(), t = agora()
    h.transaction(() => {
      h.prepare("UPDATE of_custo SET fim_vigencia = ?, atualizado_em = ? WHERE cliente = ? AND variante_id = ? AND fim_vigencia = '' AND inicio_vigencia <= ?").run(inicio, t, cliente, variante_id, inicio)
      h.prepare(`INSERT INTO of_custo (id, cliente, variante_id, moeda, custo_compra, frete_entrada, embalagem, preparo, outros, inicio_vigencia, fim_vigencia, fonte, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, cliente, variante_id, txt(dados.moeda, 3).toUpperCase() || 'BRL', custo, extras.frete_entrada, extras.embalagem, extras.preparo, extras.outros, inicio, fim, txt(dados.fonte, 120), t)
      evento(cliente, 'custo', id, 'registrado', por, { variante_id, custo_compra: custo, inicio_vigencia: inicio, fonte: txt(dados.fonte, 120) })
    })()
    return custoVigente(cliente, variante_id)
  }
  // custo vigente: of_custo (vigência) > custo por SKU do módulo de custos (Bling/Tiny/planilha) > ausente. Total somado em centavos.
  // memo ({} por chamada de quem varre várias variantes, ex.: capacidades): a resolução custo ↔ anúncio lê custos/anúncios/vínculos uma vez só
  function custoVigente(cliente, variante_id, { em = agora(), memo = null } = {}) {
    exigirCliente(cliente)
    const c = linha(`SELECT * FROM of_custo WHERE cliente = ? AND variante_id = ? AND inicio_vigencia <= ? AND (fim_vigencia = '' OR fim_vigencia > ?) ORDER BY inicio_vigencia DESC LIMIT 1`, cliente, variante_id, em, em)
    if (c) {
      const total = ['custo_compra', 'frete_entrada', 'embalagem', 'preparo', 'outros'].reduce((s, k) => s + (c[k] == null ? 0 : centavos(c[k])), 0)
      return { ...c, total: total / 100, origem: 'of_custo', bloqueios: [] }
    }
    const v = linha('SELECT sku FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)
    const mlb = v && custoDoAnuncio ? linha("SELECT anuncio_id FROM of_anuncio WHERE cliente = ? AND variante_id = ? AND canal = 'ML' AND anuncio_id <> '' ORDER BY anuncio_id LIMIT 1", cliente, variante_id)?.anuncio_id || '' : ''
    const r = !v ? null : custoDoAnuncio ? custoDoAnuncio(cliente, { item_id: mlb, sku: v.sku }, memo) : { custo: custosSku(cliente).get(v.sku.toLowerCase()) ?? null, origem: 'sku' }
    const sku = r?.custo
    if (typeof sku === 'number' && sku > 0) return { variante_id, custo_compra: sku, total: sku, moeda: 'BRL', origem: 'custos_sku', custo_origem: r.origem, fonte: 'módulo de custos (ERP/planilha)', bloqueios: [] }
    return { variante_id, custo_compra: null, total: null, origem: '', bloqueios: ['custo_ausente'] }
  }
  const listarCustos = (cliente, { variante_id } = {}) => { exigirCliente(cliente); if (!variante_id) throw erro('variante_id obrigatório')
    return linhas('SELECT * FROM of_custo WHERE cliente = ? AND variante_id = ? ORDER BY inicio_vigencia DESC', cliente, variante_id) }

  // ── regras comerciais por canal (fonte + consultado_em + validade obrigatórios: nada presumido) ─
  function registrarRegraCanal(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const canal = txt(dados.canal, 10).toUpperCase(), conta_id = txt(dados.conta_id, 80), modalidade = txt(dados.modalidade, 40)
    if (!CANAIS_OFERTA.includes(canal)) throw erro(`canal inválido (${CANAIS_OFERTA.join(' | ')})`)
    if (!txt(dados.fonte) || !txt(dados.consultado_em) || !txt(dados.validade)) throw erro('regra comercial exige fonte, consultado_em e validade')
    const num = {}
    for (const c of ['comissao_pct', 'tarifa_fixa', 'tributos_pct', 'frete_vendedor', 'desconto_pct', 'promo_pct', 'devolucao_pct', 'ads_pct', 'margem_min_pct', 'margem_alvo_pct']) { num[c] = numPlanilha(dados[c]); if (num[c] === undefined || num[c] < 0) throw erro(`${c} inválido: número ≥ 0 ou vazio`) }
    const ex = linha('SELECT id FROM of_regra_canal WHERE cliente = ? AND canal = ? AND conta_id = ? AND modalidade = ?', cliente, canal, conta_id, modalidade), id = ex?.id || randomUUID()
    h.prepare(`INSERT INTO of_regra_canal (id, cliente, canal, conta_id, modalidade, comissao_pct, tarifa_fixa, base_comissao, tributos_pct, frete_vendedor, desconto_pct, promo_pct, devolucao_pct, ads_pct, margem_min_pct, margem_alvo_pct, fonte, consultado_em, validade)
      VALUES (@id,@cliente,@canal,@conta_id,@modalidade,@comissao_pct,@tarifa_fixa,@base_comissao,@tributos_pct,@frete_vendedor,@desconto_pct,@promo_pct,@devolucao_pct,@ads_pct,@margem_min_pct,@margem_alvo_pct,@fonte,@consultado_em,@validade)
      ON CONFLICT(cliente, canal, conta_id, modalidade) DO UPDATE SET comissao_pct=@comissao_pct, tarifa_fixa=@tarifa_fixa, base_comissao=@base_comissao, tributos_pct=@tributos_pct, frete_vendedor=@frete_vendedor,
      desconto_pct=@desconto_pct, promo_pct=@promo_pct, devolucao_pct=@devolucao_pct, ads_pct=@ads_pct, margem_min_pct=@margem_min_pct, margem_alvo_pct=@margem_alvo_pct, fonte=@fonte, consultado_em=@consultado_em, validade=@validade`)
      .run({ id, cliente, canal, conta_id, modalidade, ...num, base_comissao: txt(dados.base_comissao, 40), fonte: txt(dados.fonte, 200), consultado_em: txt(dados.consultado_em, 30), validade: txt(dados.validade, 30) })
    evento(cliente, 'regra_canal', id, ex ? 'atualizada' : 'criada', por, { canal, conta_id, modalidade })
    return regraCanal(cliente, { canal, conta_id, modalidade })
  }
  function regraCanal(cliente, { canal, conta_id = '', modalidade = '' } = {}) {
    exigirCliente(cliente)
    const r = linha('SELECT * FROM of_regra_canal WHERE cliente = ? AND canal = ? AND conta_id = ? AND modalidade = ?', cliente, txt(canal, 10).toUpperCase(), txt(conta_id, 80), txt(modalidade, 40))
    return r ? { ...r, expirada: Date.parse(r.validade) < Date.now() } : null
  }

  // ── imagens (nível de dados; a geração real é do provedor) ────────────────────
  function registrarImagem(cliente, dados = {}, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const variante_id = txt(dados.variante_id, 60)
    if (!linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada neste cliente', 404)
    if (dados.job_id && !linha('SELECT id FROM of_job WHERE cliente = ? AND id = ?', cliente, dados.job_id)) throw erro('job não encontrado neste cliente', 404)
    const id = randomUUID(), t = agora(), n = k => { const x = inteiro(dados[k]); if (x === undefined) throw erro(`${k} inválido`); return x }
    h.prepare(`INSERT INTO of_imagem (id, cliente, variante_id, job_id, drive_file_id, url, caminho_local, papel, ordem, canal, versao, hash, largura, altura, bytes, fonte, prompt, status, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, cliente, variante_id, txt(dados.job_id, 60), txt(dados.drive_file_id, 120), txt(dados.url, 500), txt(dados.caminho_local, 500),
      txt(dados.papel, 30), n('ordem'), txt(dados.canal, 10).toUpperCase(), n('versao') ?? 0, txt(dados.hash, 80), n('largura'), n('altura'), n('bytes'), txt(dados.fonte, 120), txt(dados.prompt, 5000), 'candidata', t)
    evento(cliente, 'imagem', id, 'registrada', por, { variante_id, job_id: txt(dados.job_id, 60), papel: txt(dados.papel, 30) })
    return linha('SELECT * FROM of_imagem WHERE id = ? AND cliente = ?', id, cliente)
  }
  function decidirImagem(cliente, id, { status, motivo = '', por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    if (!['aprovada', 'reprovada'].includes(status)) throw erro('status inválido (aprovada | reprovada)')
    if (status === 'reprovada' && !txt(motivo)) throw erro('reprovação exige motivo curto (vai para a próxima rodada)')
    const img = linha('SELECT * FROM of_imagem WHERE cliente = ? AND id = ?', cliente, id)
    if (!img) throw erro('imagem não encontrada', 404)
    if (img.papel === 'original') throw erro('original confirmado não é aprovado/reprovado aqui: use contestarReferencia')
    const t = agora()
    h.prepare('UPDATE of_imagem SET status = ?, motivo_reprovacao = ?, aprovado_por = ?, aprovado_em = ? WHERE cliente = ? AND id = ?').run(status, txt(motivo, 300), por, status === 'aprovada' ? t : '', cliente, id)
    evento(cliente, 'imagem', id, status, por, { motivo: txt(motivo, 300) })
    return linha('SELECT * FROM of_imagem WHERE id = ? AND cliente = ?', id, cliente)
  }
  const listarImagens = (cliente, { variante_id = '', job_id = '' } = {}) => { exigirCliente(cliente); if (!variante_id && !job_id) throw erro('informe variante_id ou job_id')
    return linhas(`SELECT * FROM of_imagem WHERE cliente = ? ${variante_id ? 'AND variante_id = ?' : ''} ${job_id ? 'AND job_id = ?' : ''} ORDER BY papel, ordem, criado_em`, cliente, ...(variante_id ? [variante_id] : []), ...(job_id ? [job_id] : [])) }

  // ── importação da aba PRODUTOS: uma linha por SKU; prévia + erros por linha; reimportar não duplica, reporta mudança por campo ─
  // Chave de produto da planilha (produto_id) = id nosso OU grupo do lote; irmã já cadastrada puxa o produto. Célula nunca é executada: tudo vira texto/número.
  // referencia_confirmada/confirmado_* da planilha são IGNORADOS: só confirmarReferencia confirma (planilha não burla o GATE 0).
  function importarPlanilha(cliente, lista, { por, aplicar = true } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    if (!Array.isArray(lista)) throw erro('linhas deve ser uma lista')
    if (lista.length > 5000) throw erro('máximo de 5.000 linhas por importação')
    const R = { recebidas: lista.length, aplicado: !!aplicar, validas: 0, criadas: 0, atualizadas: 0, inalteradas: 0, produtos_criados: 0, erros: [], alteracoes: [], previa: [], ignorados: ['referencia_confirmada', 'confirmado_por', 'confirmado_em', 'status_importacao', 'pendencias', 'versao', 'atualizado_em'] }
    const err = (i, campo, motivo) => R.erros.push({ linha: i + 1, campo, motivo })
    const skus = new Map()
    lista.forEach((l, i) => { const s = normalizarSku(l?.sku).toLowerCase(); if (s) skus.set(s, (skus.get(s) || 0) + 1) })
    const candidatas = []
    lista.forEach((l0, i) => {
      const l = l0 && typeof l0 === 'object' && !Array.isArray(l0) ? l0 : {}
      const sku = normalizarSku(l.sku)
      if (!sku) return err(i, 'sku', 'SKU vazio ou inválido (texto até 80 caracteres)')
      if (skus.get(sku.toLowerCase()) > 1) return err(i, 'sku', 'SKU repetido na planilha: nenhuma das linhas é importada')
      if (l.cliente_id && txt(l.cliente_id) !== cliente) return err(i, 'cliente_id', 'linha de outro cliente: não importada aqui')
      const nome = txt(l.nome_produto || l.nome)
      const existente = linha('SELECT * FROM of_variante WHERE cliente = ? AND sku = ?', cliente, sku)
      if (!existente && !nome) return err(i, 'nome_produto', 'nome do produto obrigatório para SKU novo')
      if (l.objetivo_otimizacao && !OBJETIVOS.includes(txt(l.objetivo_otimizacao))) return err(i, 'objetivo_otimizacao', `objetivo inválido (${OBJETIVOS.join(' | ')})`)
      const dados = {}
      let ruim = false
      for (const [col, [campo, tipo]] of Object.entries(CAMPOS_VARIANTE)) {
        if (!(col in l)) continue
        const v = tipo === 'txt' ? txt(l[col], 120) : tipo === 'int' ? inteiro(l[col]) : numPlanilha(l[col])
        if (v === undefined || (typeof v === 'number' && v < 0)) { err(i, col, tipo === 'int' ? 'inteiro ≥ 0 ou vazio' : 'número ≥ 0 ou vazio (vírgula ou ponto)'); ruim = true }
        else dados[campo] = v
      }
      if (ruim) return
      candidatas.push({ i, l, sku, nome, dados, existente, grupo: txt(l.produto_id, 80) || `__linha_${i}` })
    })
    // produto por grupo: id nosso > irmã já cadastrada (mesmo grupo) > novo
    const produtoDoGrupo = new Map()
    for (const c of candidatas) {
      if (c.existente) { c.produto_id = c.existente.produto_id; if (!produtoDoGrupo.has(c.grupo)) produtoDoGrupo.set(c.grupo, c.produto_id); continue }
      if (!produtoDoGrupo.has(c.grupo)) {
        const nosso = linha('SELECT id FROM of_produto WHERE cliente = ? AND id = ?', cliente, c.grupo)?.id
        produtoDoGrupo.set(c.grupo, nosso || '')
      }
      c.produto_id = produtoDoGrupo.get(c.grupo)
    }
    const trabalho = () => {
      for (const c of candidatas) {
        const prod = { nome: c.nome, marca: txt(c.l.marca), modelo: txt(c.l.modelo), gtin: txt(c.l.gtin, 40), mpn: txt(c.l.mpn, 80) }
        if (c.existente) {
          const r = aplicar ? atualizarVariante(cliente, c.existente.id, c.dados, { por }) : previaMudancas(c.existente, c.dados)
          const camposProd = Object.fromEntries(Object.entries(prod).filter(([k, v]) => v && (k === 'nome' ? ('nome_produto' in c.l || 'nome' in c.l) : k in c.l)))
          const rp = Object.keys(camposProd).length ? (aplicar ? atualizarProduto(cliente, c.produto_id, camposProd, { por }) : previaMudancas(linha('SELECT * FROM of_produto WHERE cliente = ? AND id = ?', cliente, c.produto_id), camposProd)) : { mudancas: [] }
          const mud = [...r.mudancas, ...rp.mudancas.map(m => ({ ...m, campo: `produto.${m.campo}` }))]
          for (const m of mud) R.alteracoes.push({ linha: c.i + 1, sku: c.sku, ...m })
          if (mud.length) R.atualizadas++; else R.inalteradas++
          R.previa.push({ linha: c.i + 1, sku: c.sku, acao: mud.length ? 'atualizar' : 'igual', variante_id: c.existente.id, produto_id: c.produto_id, mudancas: mud })
        } else {
          if (!c.produto_id) {
            c.produto_id = aplicar ? criarProduto(cliente, prod, { por }).id : `(novo produto: ${c.grupo})`
            R.produtos_criados++
            for (const o of candidatas) if (o.grupo === c.grupo && !o.existente) o.produto_id = c.produto_id
          }
          const id = aplicar ? criarVariante(cliente, { produto_id: c.produto_id, sku: c.sku, ...c.dados }, { por }).id : '(nova)'
          R.criadas++
          R.previa.push({ linha: c.i + 1, sku: c.sku, acao: 'criar', variante_id: id, produto_id: c.produto_id, mudancas: [] })
        }
        R.validas++
      }
    }
    if (aplicar) h.transaction(trabalho)(); else trabalho()
    if (aplicar) evento(cliente, 'importacao', 'produtos', 'planilha_importada', por, { recebidas: R.recebidas, validas: R.validas, criadas: R.criadas, atualizadas: R.atualizadas, erros: R.erros.length })
    return R
  }
  const previaMudancas = (atual, patch) => ({ mudancas: Object.entries(patch).filter(([k, v]) => atual && k in atual && v !== atual[k]).map(([k, v]) => ({ campo: k, de: atual[k], para: v })) })

  // aba ANUNCIOS: variante por variante_id (nosso) ou por SKU exato; anúncio pela chave externa
  function importarAnuncios(cliente, lista, { por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    if (!Array.isArray(lista)) throw erro('linhas deve ser uma lista')
    const R = { recebidas: lista.length, vinculados: 0, atualizados: 0, inalterados: 0, erros: [], itens: [] }
    h.transaction(() => {
      lista.forEach((l0, i) => {
        const l = l0 && typeof l0 === 'object' ? l0 : {}
        let variante_id = txt(l.variante_id, 60)
        if (variante_id && !linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) return R.erros.push({ linha: i + 1, campo: 'variante_id', motivo: 'variante não encontrada neste cliente' })
        if (!variante_id && l.sku) {
          const v = linha('SELECT id FROM of_variante WHERE cliente = ? AND sku = ?', cliente, normalizarSku(l.sku))
          if (!v) return R.erros.push({ linha: i + 1, campo: 'sku', motivo: 'SKU não cadastrado neste cliente (importe a aba PRODUTOS antes)' })
          variante_id = v.id
        }
        try {
          const a = vincularAnuncio(cliente, { ...l, variante_id, url: l.url_anuncio ?? l.url }, { por })
          if (a.novo) R.vinculados++; else if (a.mudancas.length) R.atualizados++; else R.inalterados++
          R.itens.push({ linha: i + 1, anuncio: a.id, novo: a.novo, mudancas: a.mudancas })
        } catch (e) { R.erros.push({ linha: i + 1, campo: 'anuncio', motivo: e.message }) }
      })
    })()
    return R
  }

  // ── jobs ───────────────────────────────────────────────────────────────────────
  const mapaJob = r => !r ? null : { ...r, pendencias: json(r.pendencias_json, []), pendencias_json: undefined, dados: json(r.dados_json, {}), dados_json: undefined, estado_info: ESTADOS[r.estado], proximos: TRANSICOES[r.estado] || [] }
  const aprovadosNaVersao = (cliente, job_id, versao) => new Set(linhas('SELECT campos_json FROM of_aprovacao WHERE cliente = ? AND job_id = ? AND proposta_versao = ? AND valida = 1', cliente, job_id, versao).flatMap(a => json(a.campos_json, [])))
  function metodoDe(cliente, r) {
    const p = linha('SELECT conteudo_json, diagnostico_json FROM of_proposta WHERE cliente = ? AND job_id = ? AND versao = ?', cliente, r.id, r.proposta_versao)
    return metodoDoJob({ ...r, dados: json(r.dados_json, {}) }, { conteudo: p ? json(p.conteudo_json, {}) : null, aprovados: aprovadosNaVersao(cliente, r.id, r.proposta_versao), estrategia: p ? json(p.diagnostico_json, {}).estrategia : null })
  }
  // registra a etapa atual do método no job (dados.etapa) quando ela muda — auditável em of_evento
  function gravarEtapa(cliente, job_id, por = 'sistema') {
    const r = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!r) return
    const d = json(r.dados_json, {}), atual = metodoDe(cliente, r).atual
    if (d.etapa === atual) return
    h.prepare('UPDATE of_job SET dados_json = ? WHERE cliente = ? AND id = ?').run(JSON.stringify({ ...d, etapa: atual, etapa_em: agora() }), cliente, job_id)
    evento(cliente, 'job', job_id, 'etapa', por, { de: d.etapa || null, para: atual })
  }
  // isolamento: o job só se liga a ação do plano do PRÓPRIO cliente (id de outro cliente ou inexistente → 404 sem ecoar). Sem acoes_plano no banco
  // (autoteste do núcleo em memória pura) não há o que conferir.
  const exigirAcaoDoCliente = (cliente, acao_id) => {
    if (!acao_id || !linha("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'acoes_plano'")) return
    if (!linha('SELECT 1 FROM acoes_plano WHERE id = ? AND cliente = ?', acao_id, cliente)) throw erro('ação do plano não encontrada neste cliente', 404)
  }
  // campos que o fluxo/motor gravam no job depois de aberto (lista fechada); dados = merge raso
  function atualizarJob(cliente, id, patch = {}, { por = 'sistema' } = {}) {
    exigirCliente(cliente)
    const j = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, id)
    if (!j) throw erro('job não encontrado', 404)
    const sets = [], vals = [], campos = []
    if ('acao_id' in patch) { exigirAcaoDoCliente(cliente, txt(patch.acao_id, 40)); sets.push('acao_id = ?'); vals.push(txt(patch.acao_id, 40)); campos.push('acao_id') }
    if ('responsavel' in patch) { sets.push('responsavel = ?'); vals.push(txt(patch.responsavel, 80)); campos.push('responsavel') }
    if ('anuncio_id' in patch) {
      const a = linha('SELECT variante_id FROM of_anuncio WHERE cliente = ? AND id = ?', cliente, patch.anuncio_id)
      if (!a) throw erro('anúncio não encontrado neste cliente', 404)
      if (a.variante_id && a.variante_id !== j.variante_id) throw erro('o anúncio está vinculado a outra variante')
      sets.push('anuncio_id = ?'); vals.push(patch.anuncio_id); campos.push('anuncio_id')
    }
    if ('dados' in patch) {
      if (!patch.dados || typeof patch.dados !== 'object' || Array.isArray(patch.dados)) throw erro('dados deve ser um objeto')
      sets.push('dados_json = ?'); vals.push(JSON.stringify({ ...json(j.dados_json, {}), ...patch.dados }).slice(0, 100000)); campos.push(...Object.keys(patch.dados).map(k => `dados.${k}`))
    }
    if (!sets.length) return obterJob(cliente, id)
    h.prepare(`UPDATE of_job SET ${sets.join(', ')}, atualizado_em = ? WHERE cliente = ? AND id = ?`).run(...vals, agora(), cliente, id)
    evento(cliente, 'job', id, 'atualizado', por, { campos })
    gravarEtapa(cliente, id, por)
    return obterJob(cliente, id)
  }
  // dispensa de etapa do método com motivo (nunca silenciosa): hoje só a galeria da oferta completa de anúncio EXISTENTE ("a galeria atual fica")
  function dispensarEtapa(cliente, job_id, { etapa, motivo, por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const j = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!j) throw erro('job não encontrado', 404)
    if (!ETAPAS_DISPENSAVEIS.includes(etapa)) throw erro(`etapa não dispensável (${ETAPAS_DISPENSAVEIS.join(' | ')})`)
    if (j.escopo !== 'oferta_completa') throw erro('só a oferta completa tem etapas do método a dispensar')
    if (!j.anuncio_id) throw erro('anúncio novo precisa de galeria aprovada: a etapa galeria não pode ser dispensada', 409)
    if (ESTADOS[j.estado].terminal || ['publicando', 'em_conferencia', 'publicado_confirmado', 'monitorando'].includes(j.estado)) throw erro(`job em "${ESTADOS[j.estado].rotulo}": não aceita dispensa`, 409)
    if (txt(motivo).length < 8) throw erro('dispensa exige motivo (por que a galeria atual fica)')
    const d = json(j.dados_json, {})
    h.prepare('UPDATE of_job SET dados_json = ?, atualizado_em = ? WHERE cliente = ? AND id = ?').run(JSON.stringify({ ...d, dispensas: { ...(d.dispensas || {}), [etapa]: { motivo: txt(motivo, 300), por, em: agora() } } }), agora(), cliente, job_id)
    evento(cliente, 'job', job_id, 'etapa_dispensada', por, { etapa, motivo: txt(motivo, 300) })
    gravarEtapa(cliente, job_id, por)
    return obterJob(cliente, job_id)
  }
  function abrir({ cliente, variante_id = '', anuncio_id = '', escopo, objetivo, modo = 'publicar_apos_aprovacao', solicitante, responsavel = '', acao_id = '', dados = {} } = {}) {
    exigirCliente(cliente); solicitante = exigirPor(solicitante)
    if (!ESCOPOS.includes(escopo)) throw erro(`escopo inválido (${ESCOPOS.join(' | ')})`)
    if (!OBJETIVOS.includes(objetivo)) throw erro(`objetivo inválido (${OBJETIVOS.join(' | ')})`)
    if (!MODOS.includes(modo)) throw erro(`modo inválido (${MODOS.join(' | ')})`)
    if (anuncio_id) {
      const a = linha('SELECT variante_id FROM of_anuncio WHERE cliente = ? AND id = ?', cliente, anuncio_id)
      if (!a) throw erro('anúncio não encontrado neste cliente', 404)
      if (variante_id && a.variante_id && a.variante_id !== variante_id) throw erro('o anúncio está vinculado a outra variante')
      variante_id ||= a.variante_id
    }
    if (!variante_id) throw erro('informe variante_id ou um anúncio vinculado a uma variante')
    if (!linha('SELECT id FROM of_variante WHERE cliente = ? AND id = ?', cliente, variante_id)) throw erro('variante não encontrada neste cliente', 404)
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw erro('dados deve ser um objeto')
    exigirAcaoDoCliente(cliente, txt(acao_id, 40))
    const id = randomUUID(), t = agora()
    h.prepare(`INSERT INTO of_job (id, cliente, variante_id, anuncio_id, escopo, objetivo, modo, solicitante, responsavel, estado, criado_em, atualizado_em, acao_id, dados_json) VALUES (?,?,?,?,?,?,?,?,?,'rascunho',?,?,?,?)`)
      .run(id, cliente, variante_id, anuncio_id, escopo, objetivo, modo, solicitante, txt(responsavel, 80), t, t, txt(acao_id, 40), JSON.stringify(dados).slice(0, 100000))
    evento(cliente, 'job', id, 'aberto', solicitante, { escopo, objetivo, modo, variante_id, anuncio_id, acao_id: txt(acao_id, 40) })
    gravarEtapa(cliente, id, solicitante)
    return obterJob(cliente, id)
  }
  // campos do conteúdo ainda sem aprovação válida na versão atual (lista vazia = tudo aprovado)
  function camposPendentes(cliente, job) {
    const p = linha('SELECT conteudo_json FROM of_proposta WHERE cliente = ? AND job_id = ? AND versao = ?', cliente, job.id, job.proposta_versao)
    if (!p) return null
    const campos = Object.keys(json(p.conteudo_json, {})).filter(k => k !== 'mudancas')
    const aprovados = new Set(linhas('SELECT campos_json FROM of_aprovacao WHERE cliente = ? AND job_id = ? AND proposta_versao = ? AND valida = 1', cliente, job.id, job.proposta_versao).flatMap(a => json(a.campos_json, [])))
    return campos.filter(c => !aprovados.has(c))
  }
  function transicionar(cliente, job_id, estado, { por, motivo = '', pendencias } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const job = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!ESTADOS[estado]) throw erro('estado desconhecido')
    if (!(TRANSICOES[job.estado] || []).includes(estado)) throw erro(`transição inválida: ${ESTADOS[job.estado].rotulo} → ${ESTADOS[estado].rotulo} (permitidas: ${(TRANSICOES[job.estado] || []).join(', ') || 'nenhuma'})`, 409)
    motivo = txt(motivo, 300)
    if (ESTADOS[estado].exige_motivo && !motivo) throw erro(`entrar em "${ESTADOS[estado].rotulo}" exige motivo`)
    const pend = Array.isArray(pendencias) ? pendencias.map(p => txt(p, 120)).filter(Boolean) : estado === 'pendente_dados' ? json(job.pendencias_json, []) : []
    if (EXIGE_REFERENCIA.has(estado)) {                                                 // GATE 0
      const v = linha('SELECT referencia_confirmada FROM of_variante WHERE cliente = ? AND id = ?', cliente, job.variante_id)
      if (!v?.referencia_confirmada) throw erro('GATE 0: a variante não tem referência confirmada (foto do próprio produto validada). Confirme antes de produzir ou publicar.', 409)
    }
    if (['aprovado_publicar', 'na_fila'].includes(estado)) {
      const pendentes = camposPendentes(cliente, job)
      if (pendentes === null) throw erro('sem proposta: nada a aprovar/publicar', 409)
      if (pendentes.length) throw erro(`aprovação incompleta na versão ${job.proposta_versao}: faltam ${pendentes.join(', ')}`, 409)
      const preco = json(linha('SELECT conteudo_json FROM of_proposta WHERE cliente = ? AND job_id = ? AND versao = ?', cliente, job.id, job.proposta_versao).conteudo_json, {}).preco
      if (preco?.bloqueios?.length) throw erro(`preço bloqueado (${preco.bloqueios.join(', ')}): não pode ir para publicação automática`, 409)
    }
    const aprov = ['aprovado_publicar', 'na_fila'].includes(estado) ? linha('SELECT id FROM of_aprovacao WHERE cliente = ? AND job_id = ? AND proposta_versao = ? AND valida = 1 ORDER BY em DESC LIMIT 1', cliente, job.id, job.proposta_versao)?.id : null
    const t = agora()
    h.prepare(`UPDATE of_job SET estado = ?, pendencias_json = ?, erro = ?, atualizado_em = ?, aprovacao_id = COALESCE(?, aprovacao_id), publicado_em = CASE WHEN ? = 'publicado_confirmado' THEN ? ELSE publicado_em END WHERE cliente = ? AND id = ?`)
      .run(estado, JSON.stringify(pend), estado.startsWith('falha') || estado === 'conflito_externo' ? motivo : '', t, aprov, estado, t, cliente, job_id)
    evento(cliente, 'job', job_id, 'transicao', por, { de: job.estado, para: estado, motivo, pendencias: pend, responsavel: ESTADOS[estado].responsavel })
    gravarEtapa(cliente, job_id, por)
    return obterJob(cliente, job_id)
  }
  function obterJob(cliente, id) {
    exigirCliente(cliente)
    const j = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, id)
    if (!j) return null
    const job = mapaJob(j)
    return { ...job, proposta: obterProposta(cliente, id), aprovacoes: listarAprovacoes(cliente, id), campos_pendentes: camposPendentes(cliente, j), publicacoes: listarPublicacoes(cliente, id), referencia_confirmada: !!linha('SELECT referencia_confirmada FROM of_variante WHERE cliente = ? AND id = ?', cliente, j.variante_id)?.referencia_confirmada, metodo: metodoDe(cliente, j) }
  }
  const listarJobs = (cliente, { estado = '', variante_id = '' } = {}) => { exigirCliente(cliente)
    return linhas(`SELECT j.*, v.sku FROM of_job j LEFT JOIN of_variante v ON v.id = j.variante_id AND v.cliente = j.cliente WHERE j.cliente = ? ${estado ? 'AND j.estado = ?' : ''} ${variante_id ? 'AND j.variante_id = ?' : ''} ORDER BY j.atualizado_em DESC`,
      cliente, ...(estado ? [estado] : []), ...(variante_id ? [variante_id] : [])).map(mapaJob) }

  // ── propostas versionadas (imutáveis). Nova versão invalida TODAS as aprovações anteriores ─
  const mapaProposta = r => !r ? null : { id: r.id, job_id: r.job_id, versao: r.versao, conteudo: json(r.conteudo_json, {}), baseline: json(r.baseline_json, {}), diagnostico: json(r.diagnostico_json, {}), criado_por: r.criado_por, criado_em: r.criado_em }
  function novaVersao(cliente, job_id, { conteudo, baseline = {}, diagnostico = {}, por } = {}) {
    exigirCliente(cliente); por = exigirPor(por)
    const job = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (ESTADOS[job.estado].terminal || ['publicando', 'em_conferencia', 'publicado_confirmado', 'monitorando'].includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": não aceita nova versão`, 409)
    if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) throw erro('conteudo deve ser um objeto')
    const permitidos = CAMPOS_POR_ESCOPO[job.escopo], fora = Object.keys(conteudo).filter(k => k !== 'mudancas' && !permitidos.includes(k))
    if (fora.length) throw erro(`escopo "${job.escopo}" não permite alterar: ${fora.join(', ')}`)                       // ficha só mexe na ficha, etc.
    if (!Object.keys(conteudo).some(k => k !== 'mudancas')) throw erro('conteudo vazio: nada proposto')
    const c = { ...conteudo, mudancas: Array.isArray(conteudo.mudancas) ? conteudo.mudancas : [] }
    if (c.atributos) {                                                                   // ficha factual: termo promocional em MPN/fabricante/modelo reprova o item
      if (!Array.isArray(c.atributos)) throw erro('atributos deve ser uma lista')
      c.atributos = c.atributos.map(a => { const f = validarFatual({ atributo_id: a?.atributo_id, nome: a?.nome, valor: a?.valor_proposto }); return f.ok ? { ...a, validacao: a?.fonte ? 'ok' : 'sem_evidencia' } : { ...a, validacao: `reprovado: ${f.motivo}` } })
    }
    if (c.preco) {                                                                       // sem custo = simulação, bloqueado p/ aprovação automática (sinaliza, não derruba)
      if (typeof c.preco !== 'object') throw erro('preco deve ser um objeto')
      const custo = custoVigente(cliente, job.variante_id)
      c.preco = { ...c.preco, bloqueios: [...new Set([...(c.preco.bloqueios || []), ...custo.bloqueios])], simulacao: !!c.preco.simulacao || custo.bloqueios.length > 0 }
    }
    const versao = (linha('SELECT MAX(versao) m FROM of_proposta WHERE cliente = ? AND job_id = ?', cliente, job_id).m || 0) + 1, id = randomUUID(), t = agora()
    h.transaction(() => {
      h.prepare('INSERT INTO of_proposta (id, job_id, cliente, versao, conteudo_json, baseline_json, diagnostico_json, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, job_id, cliente, versao, JSON.stringify(c).slice(0, 500000), JSON.stringify(baseline ?? {}).slice(0, 200000), JSON.stringify(diagnostico ?? {}).slice(0, 200000), por, t)
      const inval = h.prepare('UPDATE of_aprovacao SET valida = 0, invalidada_motivo = ? WHERE cliente = ? AND job_id = ? AND valida = 1').run(`substituída pela versão ${versao}`, cliente, job_id).changes
      h.prepare("UPDATE of_job SET proposta_versao = ?, aprovacao_id = '', atualizado_em = ? WHERE cliente = ? AND id = ?").run(versao, t, cliente, job_id)
      evento(cliente, 'proposta', id, 'nova_versao', por, { job_id, versao, aprovacoes_invalidadas: inval, campos: Object.keys(c).filter(k => k !== 'mudancas') })
      if (['aprovado_publicar', 'na_fila'].includes(job.estado)) transicionar(cliente, job_id, 'em_revisao', { por, motivo: `nova versão ${versao}: a aprovação anterior não cobre o conteúdo alterado` })
      gravarEtapa(cliente, job_id, por)
    })()
    const atributosReprovados = (c.atributos || []).filter(a => String(a.validacao).startsWith('reprovado')).length
    return { ...mapaProposta(linha('SELECT * FROM of_proposta WHERE id = ? AND cliente = ?', id, cliente)), atributos_reprovados: atributosReprovados, preco_bloqueios: c.preco?.bloqueios || [] }
  }
  const obterProposta = (cliente, job_id, versao = null) => { exigirCliente(cliente)
    return mapaProposta(versao == null ? linha('SELECT * FROM of_proposta WHERE cliente = ? AND job_id = ? ORDER BY versao DESC LIMIT 1', cliente, job_id) : linha('SELECT * FROM of_proposta WHERE cliente = ? AND job_id = ? AND versao = ?', cliente, job_id, versao)) }
  const listarPropostas = (cliente, job_id) => { exigirCliente(cliente); return linhas('SELECT * FROM of_proposta WHERE cliente = ? AND job_id = ? ORDER BY versao', cliente, job_id).map(mapaProposta) }

  // ── aprovações: presas à versão exata; campo a campo; lote só com lista explícita ─
  const mapaAprovacao = r => !r ? null : { ...r, campos: json(r.campos_json, []), campos_json: undefined, valida: !!r.valida }
  function aprovar({ cliente, job_id, versao, campos, autor } = {}) {
    exigirCliente(cliente); autor = exigirPor(autor)
    const job = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!Number.isInteger(versao) || versao < 1) throw erro('versao obrigatória (inteiro)')
    if (versao !== job.proposta_versao) throw erro(`a versão ${versao} não é a atual (${job.proposta_versao}): aprovação só vale para a versão em revisão`, 409)
    const p = obterProposta(cliente, job_id, versao)
    if (!p) throw erro('proposta não encontrada', 404)
    if (!Array.isArray(campos) || !campos.length) throw erro('campos obrigatório: lista dos campos aprovados (ex.: titulo, atributos, preco, galeria)')
    const existentes = Object.keys(p.conteudo).filter(k => k !== 'mudancas'), fora = campos.filter(c => !existentes.includes(c))
    if (fora.length) throw erro(`campos fora da proposta: ${fora.join(', ')}`)
    if (campos.includes('preco') && p.conteudo.preco?.bloqueios?.length) throw erro(`preço não pode ser aprovado: ${p.conteudo.preco.bloqueios.join(', ')}`, 409)
    if (campos.includes('atributos') && (p.conteudo.atributos || []).some(a => String(a.validacao).startsWith('reprovado'))) throw erro('ficha com atributo reprovado (termo promocional em campo factual): corrija numa nova versão antes de aprovar', 409)
    // método IMA na oferta completa: título e descrição só DEPOIS da galeria aprovada (ou da dispensa registrada com motivo)
    if (job.escopo === 'oferta_completa' && campos.some(c => c === 'titulo' || c === 'descricao') && !campos.includes('galeria')
      && !aprovadosNaVersao(cliente, job_id, versao).has('galeria') && !json(job.dados_json, {}).dispensas?.galeria)
      throw erro('oferta completa segue o método: o título e a descrição vêm DEPOIS da galeria aprovada — aprove a galeria primeiro (ou registre a dispensa da etapa galeria com motivo, se a galeria atual fica)', 409)
    const id = randomUUID(), t = agora()
    h.prepare('INSERT INTO of_aprovacao (id, job_id, cliente, proposta_versao, campos_json, autor, em, valida) VALUES (?,?,?,?,?,?,?,1)').run(id, job_id, cliente, versao, JSON.stringify([...new Set(campos)]), autor, t)
    evento(cliente, 'aprovacao', id, 'aprovado', autor, { job_id, versao, campos })
    gravarEtapa(cliente, job_id, autor)
    return { ...mapaAprovacao(linha('SELECT * FROM of_aprovacao WHERE id = ? AND cliente = ?', id, cliente)), campos_pendentes: camposPendentes(cliente, { ...job, proposta_versao: versao }) }
  }
  // lote: cada item é identificado; resultado individual; nada fora da lista é aprovado
  function aprovarLote({ cliente, itens, autor } = {}) {
    exigirCliente(cliente); autor = exigirPor(autor)
    if (!Array.isArray(itens) || !itens.length || itens.length > 500) throw erro('itens: lista de { job_id, versao, campos } (1 a 500)')
    return itens.map(it => { try { const a = aprovar({ cliente, job_id: it?.job_id, versao: it?.versao, campos: it?.campos, autor }); return { job_id: it.job_id, versao: it.versao, ok: true, aprovacao_id: a.id, campos_pendentes: a.campos_pendentes } } catch (e) { return { job_id: it?.job_id, versao: it?.versao, ok: false, erro: e.message } } })
  }
  const listarAprovacoes = (cliente, job_id) => { exigirCliente(cliente); return linhas('SELECT * FROM of_aprovacao WHERE cliente = ? AND job_id = ? ORDER BY em', cliente, job_id).map(mapaAprovacao) }

  // ── publicações por etapa, idempotentes: cliente|conta|anuncio|versao|operacao ─
  const mapaPublicacao = r => !r ? null : { ...r, payload: json(r.payload_json, {}), diff: json(r.diff_json, {}), snapshot_antes: json(r.snapshot_antes_json, {}), resposta: json(r.resposta_json, {}), payload_json: undefined, diff_json: undefined, snapshot_antes_json: undefined, resposta_json: undefined }
  function registrarPublicacao(cliente, { job_id, canal, conta_id = '', anuncio_id = '', versao, operacao, payload = {}, diff = {}, snapshot_antes = {} } = {}) {
    exigirCliente(cliente)
    const job = linha('SELECT * FROM of_job WHERE cliente = ? AND id = ?', cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    canal = txt(canal, 10).toUpperCase(); conta_id = txt(conta_id, 80); anuncio_id = txt(anuncio_id, 60); operacao = txt(operacao, 40)
    if (!CANAIS_OFERTA.includes(canal)) throw erro(`canal inválido (${CANAIS_OFERTA.join(' | ')})`)
    if (!operacao) throw erro('operacao obrigatória (ex.: criar_anuncio, atualizar_campos, enviar_imagens)')
    if (!Number.isInteger(versao) || versao !== job.proposta_versao) throw erro('versao deve ser a versão aprovada atual do job', 409)
    const chave = [cliente, conta_id, anuncio_id || `job:${job_id}`, versao, operacao].join('|')
    const ex = linha('SELECT * FROM of_publicacao WHERE chave_idem = ? AND cliente = ?', chave, cliente)
    if (ex) return { ...mapaPublicacao(ex), repetida: true }                               // mesma chave = mesma publicação; nunca cria duplicata
    const id = randomUUID(), t = agora()
    h.prepare(`INSERT INTO of_publicacao (id, job_id, cliente, canal, conta_id, anuncio_id, versao, chave_idem, operacao, payload_json, diff_json, snapshot_antes_json, estado, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'preparada',?,?)`).run(id, job_id, cliente, canal, conta_id, anuncio_id, versao, chave, operacao, JSON.stringify(payload ?? {}).slice(0, 500000), JSON.stringify(diff ?? {}).slice(0, 200000), JSON.stringify(snapshot_antes ?? {}).slice(0, 500000), t, t)
    evento(cliente, 'publicacao', id, 'preparada', 'sistema', { job_id, canal, conta_id, anuncio_id, versao, operacao })
    return { ...mapaPublicacao(linha('SELECT * FROM of_publicacao WHERE id = ? AND cliente = ?', id, cliente)), repetida: false }
  }
  function atualizarPublicacao(cliente, id, { estado, resposta, erro: msgErro = '', verificado_em = '', por = 'sistema' } = {}) {
    exigirCliente(cliente)
    const p = linha('SELECT * FROM of_publicacao WHERE cliente = ? AND id = ?', cliente, id)
    if (!p) throw erro('publicação não encontrada', 404)
    if (!ESTADOS_PUBLICACAO.includes(estado)) throw erro(`estado de publicação inválido (${ESTADOS_PUBLICACAO.join(' | ')})`)
    if (['falhou', 'divergente'].includes(estado) && !txt(msgErro)) throw erro(`"${estado}" exige o erro/divergência acionável`)
    const t = agora()
    h.prepare('UPDATE of_publicacao SET estado = ?, resposta_json = COALESCE(?, resposta_json), erro = ?, verificado_em = CASE WHEN ? = \'verificada\' THEN ? ELSE verificado_em END, atualizado_em = ? WHERE cliente = ? AND id = ?')
      .run(estado, resposta === undefined ? null : JSON.stringify(resposta).slice(0, 500000), txt(msgErro, 500), estado, txt(verificado_em, 30) || t, t, cliente, id)
    evento(cliente, 'publicacao', id, estado, por, { de: p.estado, erro: txt(msgErro, 500) })
    return mapaPublicacao(linha('SELECT * FROM of_publicacao WHERE id = ? AND cliente = ?', id, cliente))
  }
  const listarPublicacoes = (cliente, job_id) => { exigirCliente(cliente); return linhas('SELECT * FROM of_publicacao WHERE cliente = ? AND job_id = ? ORDER BY criado_em', cliente, job_id).map(mapaPublicacao) }

  // ── auditoria ──────────────────────────────────────────────────────────────────
  function eventos(cliente, { entidade = '', entidade_id = '', limite = 200 } = {}) {
    exigirCliente(cliente)
    const lim = Math.min(1000, Math.max(1, Math.trunc(Number(limite)) || 200))
    return linhas(`SELECT * FROM of_evento WHERE cliente = ? ${entidade ? 'AND entidade = ?' : ''} ${entidade_id ? 'AND entidade_id = ?' : ''} ORDER BY id DESC LIMIT ?`,
      cliente, ...(entidade ? [entidade] : []), ...(entidade_id ? [String(entidade_id)] : []), lim).map(r => ({ ...r, detalhes: json(r.detalhes_json, {}), detalhes_json: undefined }))
  }

  return {
    criarProduto, atualizarProduto, listarProdutos, obterProduto,
    criarVariante, atualizarVariante, listarVariantes, obterVariante, confirmarReferencia, contestarReferencia,
    vincularAnuncio, listarAnuncios, obterAnuncio,
    upsertAtributo, listarAtributos,
    registrarCusto, custoVigente, listarCustos, registrarRegraCanal, regraCanal,
    registrarImagem, decidirImagem, listarImagens,
    importarPlanilha, importarAnuncios,
    abrir, transicionar, obterJob, listarJobs, atualizarJob, dispensarEtapa,
    novaVersao, obterProposta, listarPropostas,
    aprovar, aprovarLote, listarAprovacoes,
    registrarPublicacao, atualizarPublicacao, listarPublicacoes,
    eventos, registrarEvento: (cliente, entidade, id, acao, por, detalhes) => { exigirCliente(cliente); evento(cliente, entidade, id, acao, por, detalhes) },
  }
}

// ── pronto para o servidor (banco real). PS_OFERTAS_MEMORIA=1 pula (o autoteste nunca abre data/db.sqlite) ──
// ponytail: import dinâmico com top-level await (Node 22), mesmo padrão de promocoes-db.js
export const ofertas = process.env.PS_OFERTAS_MEMORIA === '1' ? null : await (async () => {
  const { db } = await import('./db.js')
  const { SCHEMA_OFERTAS } = await import('./ofertas-schema.js')
  const { custosEfetivos, vinculosCusto } = await import('./custos-db.js')
  db.exec(SCHEMA_OFERTAS)                                   // idempotente; o integrador também o chama em db.js
  return criarOfertas(db, { custosSku: custosEfetivos, custoDoAnuncio: vinculosCusto.custoDoAnuncio })
})()
