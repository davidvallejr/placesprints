// Provedor de imagens do módulo Ofertas Estratégicas: geração/edição com referência (fal.run), verificação técnica
// do arquivo, guarda de candidatas em data/ofertas/{cliente}/{variante}/{job}/ (fora do git, nunca sobrescreve) e a
// interface do Drive (pendente: sem credencial no servidor). Sem FAL_KEY devolve estado 'pendente' — nunca sucesso simulado.
// Doc verificada em 07/10/2026 (fal.ai/docs): POST https://fal.run/{model_id} síncrono (ou queue.fal.run), header
// `Authorization: Key $FAL_KEY`, JSON; modelo de edição com referência fal-ai/nano-banana/edit: { prompt, image_urls[],
// num_images, output_format, aspect_ratio } → { images:[{url,width,height,content_type}], description }. Preço por
// imagem NÃO vem na resposta nem na doc lida → custo só com FAL_CUSTO_IMAGEM configurado (senão null, 'a confirmar').
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

export const MODELO_PADRAO = 'fal-ai/nano-banana/edit'
export const REGRAS_CANAL = {
  ML: { lado_min: 500, lado_recomendado: 1200, quadrado_capa: true, formatos: ['jpeg', 'png'], bytes_max: 10 * 1024 * 1024, texto_na_capa: false,
    fonte: 'prática registrada na skill oferta-mkt (1200×1200 JPEG; capa sem texto) — limites oficiais A CONFIRMAR (página de imagens do dev portal indisponível em 07/10/2026)' },
}
export const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sem-nome'

// ── dimensões sem dependência: PNG (IHDR), JPEG (SOF), WebP (VP8/VP8L/VP8X), GIF ──────────────────────────────
export function lerDimensoes(buf) {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') return { formato: 'png', largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) }
  if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue }
      const m = buf[i + 1]
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { formato: 'jpeg', altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) }
      i += 2 + len
    }
    return { formato: 'jpeg', largura: null, altura: null }
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return { formato: 'webp', largura: buf.readUInt16LE(26) & 0x3fff, altura: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { formato: 'webp', largura: (b & 0x3fff) + 1, altura: ((b >> 14) & 0x3fff) + 1 } }
    if (chunk === 'VP8X') return { formato: 'webp', largura: (buf.readUIntLE(24, 3)) + 1, altura: (buf.readUIntLE(27, 3)) + 1 }
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return { formato: 'gif', largura: buf.readUInt16LE(6), altura: buf.readUInt16LE(8) }
  return { formato: 'desconhecido', largura: null, altura: null }
}

// aprovação TÉCNICA automática (separada da visual): dimensões, formato, peso, hash, quadrado e regras do canal.
// Texto na capa não é verificável aqui (precisa OCR/olho humano) → fica em `a_confirmar`, nunca "ok".
export function verificarTecnico(arquivo, { regras = REGRAS_CANAL.ML, papel = 'candidata' } = {}) {
  const buf = Buffer.isBuffer(arquivo) ? arquivo : readFileSync(arquivo)
  const { formato, largura, altura } = lerDimensoes(buf)
  const problemas = [], a_confirmar = []
  const quadrado = !!(largura && altura && largura === altura)
  if (formato === 'desconhecido') problemas.push('formato não reconhecido (esperado JPEG/PNG)')
  else if (regras.formatos && !regras.formatos.includes(formato)) problemas.push(`formato ${formato} fora do permitido pelo canal (${regras.formatos.join('/')})`)
  if (!largura || !altura) problemas.push('não foi possível ler as dimensões')
  else {
    if (Math.min(largura, altura) < regras.lado_min) problemas.push(`lado menor ${Math.min(largura, altura)}px abaixo do mínimo ${regras.lado_min}px`)
    if (regras.quadrado_capa && papel === 'capa' && !quadrado) problemas.push(`capa não quadrada (${largura}×${altura}): no card quadrado o ML recorta/troca a imagem`)
    if (Math.max(largura, altura) < regras.lado_recomendado) a_confirmar.push(`abaixo do recomendado ${regras.lado_recomendado}px (zoom na página fica limitado)`)
  }
  if (regras.bytes_max && buf.length > regras.bytes_max) problemas.push(`arquivo com ${buf.length} bytes acima do máximo ${regras.bytes_max}`)
  if (papel === 'capa' && regras.texto_na_capa === false) a_confirmar.push('sem texto/logo na capa: conferência humana (não verificável automaticamente)')
  return { ok: problemas.length === 0, formato, largura, altura, bytes: buf.length, hash: createHash('sha256').update(buf).digest('hex'), quadrado, problemas, a_confirmar, regras_fonte: regras.fonte || '' }
}

export function criarProvedorImagens({ env = {}, fetch, raiz, agora = () => new Date().toISOString() }) {
  const chave = String(env.FAL_KEY || '').trim()
  const modelo = String(env.FAL_MODELO || MODELO_PADRAO).trim()
  const custoUnit = Number(env.FAL_CUSTO_IMAGEM) > 0 ? Number(env.FAL_CUSTO_IMAGEM) : null       // R$/USD por imagem, declarado no .env; sem ele o custo é 'a confirmar'
  const tentativas = []                                                                           // registro custo/tentativa por chamada (o core persiste em of_evento/of_imagem)

  function disponivel() {
    return chave ? { provedor: 'fal', modelo, endpoint: `https://fal.run/${modelo}`, custo_por_imagem: custoUnit, custo_fonte: custoUnit ? 'FAL_CUSTO_IMAGEM (.env)' : 'a confirmar: configure FAL_CUSTO_IMAGEM com o preço do modelo em fal.ai/models' }
      : { provedor: 'nenhum', pendente: 'FAL_KEY ausente: configurar no .env', como: 'crie a chave em fal.ai/dashboard/keys e adicione FAL_KEY=… (opcional: FAL_MODELO, FAL_CUSTO_IMAGEM) ao .env; o servidor relê no reinício' }
  }
  const dirDe = (cliente, variante, job) => { if (!raiz) throw new Error('raiz de candidatas não configurada'); return join(raiz, slug(cliente), slug(variante), slug(job)) }
  // nunca sobrescreve: se o nome existe, ganha sufixo numérico
  function salvarCandidata({ cliente, variante, job, nome, bytes }) {
    const dir = dirDe(cliente, variante, job); mkdirSync(dir, { recursive: true })
    const ext = extname(nome) || '.png', base = basename(nome, ext)
    let caminho = join(dir, `${base}${ext}`)
    for (let i = 2; existsSync(caminho); i++) caminho = join(dir, `${base}-${i}${ext}`)
    writeFileSync(caminho, bytes, { flag: 'wx' })
    return caminho
  }
  const classificar = status => status === 401 || status === 403 ? 'credencial_invalida' : status === 402 ? 'saldo_insuficiente' : status === 429 ? 'limite_uso' : status === 422 || status === 400 ? 'validacao_rejeitada' : status === 0 || status >= 500 ? 'transitorio' : 'erro'

  // referencias: URLs https acessíveis pelo provedor (NÃO link de visualização do Drive). Sem chave: pendente.
  async function gerar({ cliente, variante, job, referencias = [], briefing = '', restricoes_canal = REGRAS_CANAL.ML, n = 1, papel = 'candidata', versao = 1 }) {
    const t0 = Date.now(), em = agora()
    const reg = { em, provedor: chave ? 'fal' : 'nenhum', modelo: chave ? modelo : null, n_pedidas: n, n_recebidas: 0, custo: null, custo_fonte: custoUnit ? 'FAL_CUSTO_IMAGEM' : 'a confirmar', ms: 0, estado: 'pendente', erro: null }
    const fim = r => { reg.ms = Date.now() - t0; tentativas.push(reg); return { ...r, tentativa: reg } }
    if (!chave) return fim({ estado: 'pendente', motivo: disponivel().pendente, candidatas: [] })
    if (!cliente || !variante || !job) return fim(Object.assign(reg, { estado: 'erro', erro: 'cliente, variante e job são obrigatórios (pasta de candidatas)' }) && { estado: 'erro', motivo: reg.erro, candidatas: [] })
    const refs = referencias.filter(u => /^https:\/\//.test(u) && !/drive\.google\.com\/file\/d\//.test(u))
    if (!refs.length) return fim(Object.assign(reg, { estado: 'erro', erro: 'nenhuma referência https direta (link de visualização do Drive não serve)' }) && { estado: 'erro', motivo: reg.erro, candidatas: [] })
    if (!String(briefing).trim()) return fim(Object.assign(reg, { estado: 'erro', erro: 'briefing vazio' }) && { estado: 'erro', motivo: reg.erro, candidatas: [] })
    const corpo = { prompt: String(briefing), image_urls: refs, num_images: Math.max(1, Math.min(4, Number(n) || 1)), output_format: 'png', aspect_ratio: restricoes_canal?.quadrado_capa ? '1:1' : 'auto' }
    let r
    try { r = await fetch(`https://fal.run/${modelo}`, { method: 'POST', headers: { Authorization: `Key ${chave}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout?.(120_000) }) }
    catch (e) { reg.estado = 'falha'; reg.classe = 'transitorio'; reg.erro = String(e?.message || e).slice(0, 200); return fim({ estado: 'falha', classe: 'transitorio', motivo: reg.erro, candidatas: [] }) }
    const texto = await r.text().catch(() => ''); let dados; try { dados = JSON.parse(texto) } catch { dados = { detail: texto.slice(0, 300) } }
    if (!r.ok) { reg.estado = 'falha'; reg.classe = classificar(r.status); reg.erro = `${r.status}: ${typeof dados?.detail === 'string' ? dados.detail : JSON.stringify(dados?.detail || dados).slice(0, 200)}`; return fim({ estado: 'falha', classe: reg.classe, motivo: reg.erro, pendencia: reg.classe === 'limite_uso' ? 'limite do provedor: aguardar e retomar (o trabalho até aqui está preservado)' : reg.classe === 'credencial_invalida' ? 'FAL_KEY inválida/revogada: corrigir no .env' : reg.classe === 'saldo_insuficiente' ? 'sem saldo no fal.ai: recarregar antes de nova rodada' : null, candidatas: [] }) }
    const candidatas = []
    for (const [i, img] of (dados.images || []).entries()) {
      try {
        const d = await fetch(img.url); if (!d.ok) throw new Error(`download ${d.status}`)
        const bytes = Buffer.from(await d.arrayBuffer())
        const caminho = salvarCandidata({ cliente, variante, job, nome: `cand-${String(i + 1).padStart(2, '0')}-${slug(papel)}-v${versao}.png`, bytes })
        candidatas.push({ caminho_local: caminho, url_origem: img.url, papel, versao, prompt: corpo.prompt, referencias: refs, fonte: `fal:${modelo}`, tecnico: verificarTecnico(bytes, { regras: restricoes_canal, papel }), descricao_provedor: dados.description || '' })
      } catch (e) { candidatas.push({ erro: `candidata ${i + 1} não salva: ${String(e?.message || e).slice(0, 120)}`, url_origem: img.url }) }
    }
    reg.n_recebidas = candidatas.filter(c => c.caminho_local).length
    reg.custo = custoUnit ? Math.round(custoUnit * reg.n_recebidas * 100) / 100 : null
    reg.estado = reg.n_recebidas ? 'ok' : 'falha'; if (!reg.n_recebidas) reg.erro = 'provedor respondeu sem imagens utilizáveis'
    return fim({ estado: reg.n_recebidas ? 'ok' : 'falha', candidatas, custo: reg.custo, custo_fonte: reg.custo_fonte })
  }

  // Drive: contrato pronto, implementação PENDENTE — o servidor não tem credencial do Google. O que falta está em `faltando`.
  const drive = {
    estado: 'pendente',
    faltando: ['GOOGLE_SERVICE_ACCOUNT_JSON (ou OAuth com refresh token) no .env, escopos drive.readonly + drive.file', 'OFERTAS_DRIVE_RAIZ = id da pasta "Operacao-Marketplaces/Clientes" compartilhada com a conta de serviço', 'política de nome/pasta por cliente (spec §5) aplicada só na pasta do cliente certo'],
    listarPasta: async () => ({ estado: 'pendente', motivo: 'Drive não configurado no servidor', faltando: drive.faltando, arquivos: [] }),
    baixar: async () => ({ estado: 'pendente', motivo: 'Drive não configurado no servidor', faltando: drive.faltando }),
    subir: async () => ({ estado: 'pendente', motivo: 'Drive não configurado no servidor', faltando: drive.faltando }),
  }
  const existe = caminho => { try { return statSync(caminho).isFile() } catch { return false } }
  return { disponivel, gerar, verificarTecnico, salvarCandidata, drive, tentativas, dirDe, existe, REGRAS_CANAL }
}

// ── pronto para o servidor (env.js carrega o .env; FAL_* são lidas de process.env porque env.js não as expõe) ──
let pronto = null
export async function provedorImagensPronto() {
  if (pronto) return pronto
  const { ROOT } = await import('./env.js')
  pronto = criarProvedorImagens({ env: { FAL_KEY: process.env.FAL_KEY || '', FAL_MODELO: process.env.FAL_MODELO || '', FAL_CUSTO_IMAGEM: process.env.FAL_CUSTO_IMAGEM || '' }, fetch: globalThis.fetch.bind(globalThis), raiz: join(ROOT, 'data', 'ofertas') })
  return pronto
}
