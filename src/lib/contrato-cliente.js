// Contrato e pagamentos do cliente — a prova que o dossiê de defesa exige (obrigação de MEIO, entregáveis, vigência, cláusula de reembolso, comprovantes).
// O arquivo chega por JSON base64 (≤ 5 MB, só PDF/PNG/JPG conferidos pelos bytes iniciais, nunca pelo nome) e é guardado em data/dossies/docs/<sha256>.<ext>
// (endereçado pelo conteúdo: o mesmo arquivo não duplica e o nome do cliente não vai para o disco). Cada gravação entra no livro de registro com o sha256.
// Prévia por padrão; `confirmar` só vale se for exatamente true. Núcleo SEM import de banco: handle, livro, relógio, pasta e validação de quem entram pela fábrica.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { temContato } from './livro-registro.js'

export const SCHEMA_CONTRATO = `
CREATE TABLE IF NOT EXISTS contrato_cliente (    -- contrato vigente (a versão anterior fica no livro de registro)
  cliente TEXT PRIMARY KEY,
  inicio TEXT NOT NULL DEFAULT '', fim TEXT NOT NULL DEFAULT '',          -- AAAA-MM-DD ('' = não informado / indeterminado)
  canais_json TEXT NOT NULL DEFAULT '[]', entregaveis_json TEXT NOT NULL DEFAULT '[]',
  valor_mensal_centavos INTEGER CHECK (valor_mensal_centavos IS NULL OR valor_mensal_centavos >= 0),
  obrigacao_meio INTEGER CHECK (obrigacao_meio IS NULL OR obrigacao_meio IN (0,1)),   -- null = contrato não diz / não lido
  clausula_reembolso TEXT NOT NULL DEFAULT '',
  arquivo TEXT NOT NULL DEFAULT '', arquivo_sha256 TEXT NOT NULL DEFAULT '',         -- relativo a data/ (dossies/docs/<sha256>.<ext>)
  por TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pagamento_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, data TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  referencia TEXT NOT NULL DEFAULT '',
  arquivo TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '',
  por TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pagamento ON pagamento_cliente (cliente, data, valor_centavos, referencia);
`

export const MAX_ARQUIVO = 5 * 1024 * 1024
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const DIA = /^\d{4}-\d{2}-\d{2}$/
const sha = b => createHash('sha256').update(b).digest('hex')
const brl = c => c == null ? 'valor não informado' : `R$ ${(c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const dm = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''

// bytes iniciais → extensão; qualquer outra coisa é recusada (o nome do arquivo nunca decide)
export function tipoArquivo(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  return ''
}
// { base64 } (aceita "data:…;base64," na frente) → { buf, ext, sha256, bytes }
export function decodificarArquivo(arq) {
  if (arq === undefined || arq === null) return null
  const b64 = typeof arq === 'string' ? arq : typeof arq?.base64 === 'string' ? arq.base64 : null
  if (b64 === null) throw erro('"arquivo" precisa ser { base64 }')
  const limpo = b64.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '')
  if (limpo.length > Math.ceil(MAX_ARQUIVO / 3) * 4 + 4) throw erro('arquivo passa de 5 MB', 413)
  if (!limpo || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw erro('"arquivo" não está em base64')
  const buf = Buffer.from(limpo, 'base64')
  if (buf.length > MAX_ARQUIVO) throw erro('arquivo passa de 5 MB', 413)
  const ext = tipoArquivo(buf)
  if (!ext) throw erro('arquivo precisa ser PDF, PNG ou JPG')
  return { buf, ext, sha256: sha(buf), bytes: buf.length }
}

// deps: handle, livro (criarLivro), raiz = pasta data/, agora() ISO, hoje() 'AAAA-MM-DD', validarPor(nome, cliente) → nome canônico ou '' (líder/consultor ou o CS deste cliente)
export function criarContratos({ handle: h, livro, raiz, agora = () => new Date().toISOString(), hoje = () => new Date().toISOString().slice(0, 10), validarPor = () => '' }) {
  const quem = (por, cliente) => { const p = validarPor(str(por), cliente); if (!p) throw erro('quem registra precisa ser líder, consultor ou o CS deste cliente', 403); return p }
  const guardar = a => {
    const rel = join('dossies', 'docs', `${a.sha256}.${a.ext}`)
    mkdirSync(join(raiz, 'dossies', 'docs'), { recursive: true })
    try { writeFileSync(join(raiz, rel), a.buf, { flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }   // mesmo conteúdo = mesmo arquivo
    return rel
  }
  const lista = (v, campo, max, tam) => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > tam)) throw erro(`"${campo}" precisa ser uma lista de até ${max} textos de até ${tam} caracteres`)
    const l = [...new Set(v.map(x => x.trim()))]
    if (l.some(temContato)) throw erro(`"${campo}" não pode ter telefone nem contato de WhatsApp`)
    return l
  }
  const data = (v, campo, { obrigatoria = false } = {}) => {
    const d = str(v)
    if (!d && !obrigatoria) return ''
    if (!DIA.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z'))) throw erro(`"${campo}" precisa ser uma data AAAA-MM-DD`)
    return d
  }
  const centavos = (v, campo, { obrigatorio = false } = {}) => {
    if ((v === undefined || v === null) && !obrigatorio) return null
    if (!Number.isSafeInteger(v) || v < 0) throw erro(`"${campo}" precisa ser inteiro em centavos (≥ 0)`)
    return v
  }
  const hidratar = c => c && ({ ...c, canais: JSON.parse(c.canais_json), entregaveis: JSON.parse(c.entregaveis_json), obrigacao_meio: c.obrigacao_meio == null ? null : !!c.obrigacao_meio, canais_json: undefined, entregaveis_json: undefined })

  function salvarContrato({ cliente, inicio, fim, canais, entregaveis, valor_mensal_centavos, obrigacao_meio, clausula_reembolso, arquivo, por, confirmar = false }) {
    const c = {
      inicio: data(inicio, 'inicio'), fim: data(fim, 'fim'),
      canais: lista(canais, 'canais', 10, 40), entregaveis: lista(entregaveis, 'entregaveis', 40, 200),
      valor_mensal_centavos: centavos(valor_mensal_centavos, 'valor_mensal_centavos'),
      obrigacao_meio: obrigacao_meio === true ? 1 : obrigacao_meio === false ? 0 : obrigacao_meio == null ? null : (() => { throw erro('"obrigacao_meio" precisa ser true, false ou null') })(),
      clausula_reembolso: str(clausula_reembolso),
    }
    if (c.inicio && c.fim && c.fim < c.inicio) throw erro('"fim" antes de "inicio"')
    if (clausula_reembolso !== undefined && clausula_reembolso !== null && typeof clausula_reembolso !== 'string') throw erro('"clausula_reembolso" precisa ser texto')
    if (c.clausula_reembolso.length > 1500) throw erro('"clausula_reembolso" passa de 1500 caracteres')
    if (temContato(c.clausula_reembolso)) throw erro('"clausula_reembolso" não pode ter telefone nem contato de WhatsApp')
    const a = decodificarArquivo(arquivo)
    const p = quem(por, cliente)
    const atual = h.prepare('SELECT * FROM contrato_cliente WHERE cliente = ?').get(cliente)
    const arquivo_sha256 = a ? a.sha256 : atual?.arquivo_sha256 || ''
    const resumo = { ...c, obrigacao_meio: c.obrigacao_meio == null ? null : !!c.obrigacao_meio, arquivo: a ? { tipo: a.ext, bytes: a.bytes, sha256: a.sha256 } : atual?.arquivo ? { mantido: true, sha256: arquivo_sha256 } : null }
    if (confirmar !== true) return { ok: true, previa: true, contrato: resumo }
    const rel = a ? guardar(a) : atual?.arquivo || ''
    const em = agora()
    h.transaction(() => {
      h.prepare(`INSERT INTO contrato_cliente (cliente, inicio, fim, canais_json, entregaveis_json, valor_mensal_centavos, obrigacao_meio, clausula_reembolso, arquivo, arquivo_sha256, por, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cliente) DO UPDATE SET inicio = excluded.inicio, fim = excluded.fim, canais_json = excluded.canais_json, entregaveis_json = excluded.entregaveis_json,
        valor_mensal_centavos = excluded.valor_mensal_centavos, obrigacao_meio = excluded.obrigacao_meio, clausula_reembolso = excluded.clausula_reembolso, arquivo = excluded.arquivo,
        arquivo_sha256 = excluded.arquivo_sha256, por = excluded.por, atualizado_em = excluded.atualizado_em`)
        .run(cliente, c.inicio, c.fim, JSON.stringify(c.canais), JSON.stringify(c.entregaveis), c.valor_mensal_centavos, c.obrigacao_meio, c.clausula_reembolso, rel, arquivo_sha256, p, em)
      const conteudo = { ...c, arquivo_sha256 }
      // regravar a versão VIGENTE = nada novo no livro; qualquer mudança (inclusive voltar a uma versão anterior, A→B→A) = registro novo; o ref leva o nº da versão do cliente
      const vigente = atual && JSON.stringify({ inicio: atual.inicio, fim: atual.fim, canais: JSON.parse(atual.canais_json), entregaveis: JSON.parse(atual.entregaveis_json), valor_mensal_centavos: atual.valor_mensal_centavos,
        obrigacao_meio: atual.obrigacao_meio, clausula_reembolso: atual.clausula_reembolso, arquivo_sha256: atual.arquivo_sha256 })
      const versao = h.prepare("SELECT COUNT(*) n FROM registro_cliente WHERE cliente = ? AND tipo = 'contrato'").get(cliente).n + 1
      if (vigente !== JSON.stringify(conteudo)) livro.registrar({ cliente, tipo: 'contrato', ref: `contrato:${sha(cliente + '\n' + JSON.stringify(conteudo)).slice(0, 24)}:v${versao}`, fato_em: em,
        resumo: `Contrato registrado: vigência ${dm(c.inicio) || 'início não informado'} a ${dm(c.fim) || 'indeterminado'}; ${brl(c.valor_mensal_centavos)}/mês; obrigação de meio: ${c.obrigacao_meio == null ? 'não informada' : c.obrigacao_meio ? 'sim' : 'não'}${rel ? '; arquivo anexado' : ''} (por ${p})`,
        dados: { ...conteudo, obrigacao_meio: resumo.obrigacao_meio, por: p }, prova: rel ? `arquivo:${rel}#sha256:${arquivo_sha256}` : '' })
    }).immediate()
    return { ok: true, previa: false, contrato: hidratar(h.prepare('SELECT * FROM contrato_cliente WHERE cliente = ?').get(cliente)) }
  }

  function registrarPagamento({ cliente, data: d, valor_centavos, referencia, arquivo, por, confirmar = false }) {
    const dia = data(d, 'data', { obrigatoria: true })
    if (dia > hoje()) throw erro('"data" do pagamento não pode estar no futuro')
    const valor = centavos(valor_centavos, 'valor_centavos', { obrigatorio: true })
    if (referencia !== undefined && referencia !== null && typeof referencia !== 'string') throw erro('"referencia" precisa ser texto')
    const ref = str(referencia)
    if (ref.length > 120) throw erro('"referencia" passa de 120 caracteres')
    if (temContato(ref)) throw erro('"referencia" não pode ter telefone nem contato de WhatsApp')
    const a = decodificarArquivo(arquivo)
    const p = quem(por, cliente)
    if (h.prepare('SELECT 1 FROM pagamento_cliente WHERE cliente = ? AND data = ? AND valor_centavos = ? AND referencia = ?').get(cliente, dia, valor, ref)) throw erro('pagamento já registrado', 409)
    const pagamento = { data: dia, valor_centavos: valor, referencia: ref, arquivo: a ? { tipo: a.ext, bytes: a.bytes, sha256: a.sha256 } : null }
    if (confirmar !== true) return { ok: true, previa: true, pagamento }
    const rel = a ? guardar(a) : ''
    const id = h.transaction(() => {
      const id = Number(h.prepare('INSERT INTO pagamento_cliente (cliente, data, valor_centavos, referencia, arquivo, sha256, por, criado_em) VALUES (?,?,?,?,?,?,?,?)')
        .run(cliente, dia, valor, ref, rel, a?.sha256 || '', p, agora()).lastInsertRowid)
      livro.registrar({ cliente, tipo: 'pagamento', ref: `pg:${id}`, fato_em: dia, resumo: `Pagamento registrado: ${brl(valor)} em ${dm(dia)}${ref ? ` (${ref})` : ''}${rel ? '; comprovante anexado' : ''} (por ${p})`,
        dados: { pagamento_id: id, valor_centavos: valor, referencia: ref, sha256: a?.sha256 || '', por: p }, prova: rel ? `arquivo:${rel}#sha256:${a.sha256}` : '' })
      return id
    }).immediate()
    return { ok: true, previa: false, pagamento: h.prepare('SELECT * FROM pagamento_cliente WHERE id = ?').get(id) }
  }

  const ler = cliente => ({ contrato: hidratar(h.prepare('SELECT * FROM contrato_cliente WHERE cliente = ?').get(cliente)) || null,
    pagamentos: h.prepare('SELECT * FROM pagamento_cliente WHERE cliente = ? ORDER BY data DESC, id DESC').all(cliente) })

  return { salvarContrato, registrarPagamento, ler }
}
