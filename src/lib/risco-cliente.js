// Cliente EM RISCO (reclamação, reembolso, jurídico, insatisfação): MARCAÇÃO feita por líder, consultor ou CS, com motivo e descrição — o sistema só SUGERE
// candidatos pelos sinais que já mede (queda forte da conta pelo Merovíngio, reputação vermelha, HS em risco, resposta crítica ao relatório, pendência do
// cliente aberta há 30+ dias com data exata, alinhamento vencido) e nunca marca sozinho. Marcar e encerrar entram no livro de registro (livro-registro.js).
// A marcação aberta é o que liga o dossiê mensal (Etapa 2). Núcleo SEM import de banco: handle, livro, relógio e validação de quem marca entram pela fábrica.
import { temContato } from './livro-registro.js'

export const MOTIVOS_RISCO = { reclamacao: 'Reclamação', reembolso: 'Pedido de reembolso', juridico: 'Ameaça ou ação jurídica', insatisfacao: 'Insatisfação declarada', outro: 'Outro' }

export const SCHEMA_RISCO = `
CREATE TABLE IF NOT EXISTS risco_cliente (       -- marcação de cliente em risco (src/lib/risco-cliente.js); histórico completo no livro de registro
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                         -- nome canônico da central (nunca prospect)
  motivo TEXT NOT NULL CHECK (motivo IN ('reclamacao','reembolso','juridico','insatisfacao','outro')),
  descricao TEXT NOT NULL DEFAULT '' CHECK (length(descricao) <= 500),   -- INTERNA, sem telefone
  desde TEXT NOT NULL,                           -- AAAA-MM-DD
  por TEXT NOT NULL,                             -- líder/consultor/CS (nome canônico)
  estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','encerrado')),
  encerrado_em TEXT NOT NULL DEFAULT '', encerrado_por TEXT NOT NULL DEFAULT '',
  nota_encerramento TEXT NOT NULL DEFAULT '' CHECK (length(nota_encerramento) <= 500),
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_risco_aberto ON risco_cliente (cliente, motivo) WHERE estado = 'aberto';
`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const DIA = /^\d{4}-\d{2}-\d{2}$/
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const HS_RISCO = new Set(['risco', 'critica', 'critico', 'baixa', 'baixo'])
const texto500 = (v, campo) => {
  if (v !== undefined && v !== null && typeof v !== 'string') throw erro(`"${campo}" precisa ser texto`)
  const t = str(v)
  if (t.length > 500) throw erro(`"${campo}" passa de 500 caracteres`)
  if (temContato(t)) throw erro(`"${campo}" não pode ter telefone nem contato de WhatsApp`)
  return t
}

// deps: handle, livro (criarLivro), hoje() 'AAAA-MM-DD', agora() ISO, validarPor(nome, cliente) → nome canônico ou '' (líder/consultor ou o CS deste cliente), clientes() → nomes ativos da central
export function criarRisco({ handle: h, livro, hoje = () => new Date().toISOString().slice(0, 10), agora = () => new Date().toISOString(), validarPor = () => '', clientes = () => [] }) {
  const quem = (por, cliente) => { const p = validarPor(str(por), cliente); if (!p) throw erro('quem marca precisa ser líder, consultor ou o CS deste cliente', 403); return p }
  const linha = r => r && ({ ...r, motivo_rotulo: MOTIVOS_RISCO[r.motivo] || r.motivo })

  function marcar({ cliente, motivo, descricao, desde, por, confirmar = false }) {
    if (!Object.hasOwn(MOTIVOS_RISCO, motivo)) throw erro('motivo inválido (reclamacao, reembolso, juridico, insatisfacao ou outro)')
    const d = texto500(descricao, 'descricao')
    const dia = str(desde) || hoje()
    if (!DIA.test(dia) || dia > hoje()) throw erro('"desde" precisa ser uma data AAAA-MM-DD até hoje')
    const p = quem(por, cliente)
    if (h.prepare("SELECT 1 FROM risco_cliente WHERE cliente = ? AND motivo = ? AND estado = 'aberto'").get(cliente, motivo)) throw erro('já existe risco aberto com esse motivo para o cliente', 409)
    const registro = { cliente, motivo, motivo_rotulo: MOTIVOS_RISCO[motivo], descricao: d, desde: dia, por: p }
    if (confirmar !== true) return { ok: true, previa: true, registro }
    const id = h.transaction(() => {
      const id = Number(h.prepare('INSERT INTO risco_cliente (cliente, motivo, descricao, desde, por, criado_em) VALUES (?,?,?,?,?,?)').run(cliente, motivo, d, dia, p, agora()).lastInsertRowid)
      livro.registrar({ cliente, tipo: 'risco_marcado', ref: `risco:${id}`, fato_em: dia, resumo: `Cliente marcado em risco — ${MOTIVOS_RISCO[motivo]} (por ${p})`, dados: { risco_id: id, motivo, descricao: d, por: p } })
      return id
    }).immediate()
    return { ok: true, previa: false, risco: linha(h.prepare('SELECT * FROM risco_cliente WHERE id = ?').get(id)) }
  }

  function encerrar({ cliente, id, por, nota, confirmar = false }) {
    const n = Number(id)
    if (!Number.isInteger(n) || n < 1) throw erro('informe "id" (número do risco)')
    const nt = texto500(nota, 'nota')
    const p = quem(por, cliente)
    const r = h.prepare('SELECT * FROM risco_cliente WHERE id = ? AND cliente = ?').get(n, cliente)
    if (!r) throw erro('risco não encontrado para o cliente', 404)
    if (r.estado !== 'aberto') throw erro('risco já encerrado', 409)
    if (confirmar !== true) return { ok: true, previa: true, risco: linha(r) }
    const em = agora()
    h.transaction(() => {
      h.prepare("UPDATE risco_cliente SET estado = 'encerrado', encerrado_em = ?, encerrado_por = ?, nota_encerramento = ? WHERE id = ? AND estado = 'aberto'").run(em, p, nt, n)
      livro.registrar({ cliente, tipo: 'risco_encerrado', ref: `risco:${n}`, fato_em: em, resumo: `Risco encerrado — ${MOTIVOS_RISCO[r.motivo]} (por ${p})`, dados: { risco_id: n, motivo: r.motivo, nota: nt, por: p } })
    }).immediate()
    return { ok: true, previa: false, risco: linha(h.prepare('SELECT * FROM risco_cliente WHERE id = ?').get(n)) }
  }

  const listar = cliente => h.prepare('SELECT * FROM risco_cliente WHERE cliente = ? ORDER BY estado, desde DESC, id DESC').all(cliente).map(linha)
  const abertos = () => h.prepare("SELECT * FROM risco_cliente WHERE estado = 'aberto' ORDER BY desde, id").all().map(linha)

  // ── sinais (só sugere): uma consulta por sinal, recortada aos clientes ativos da central ─────────────────────────
  function sugestoes({ hoje: dia = hoje() } = {}) {
    const ativos = new Set(clientes().filter(c => c && !/^\s*\[Comercial\]/i.test(c)))
    const tenta = (sql, ...a) => { try { return h.prepare(sql).all(...a) } catch (e) { if (/no such (table|column)/i.test(e.message)) return []; throw e } }
    const d30 = addDias(dia, -30)
    const por = new Map(), add = (cliente, s) => { if (!ativos.has(cliente)) return; if (!por.has(cliente)) por.set(cliente, []); por.get(cliente).push(s) }
    for (const r of tenta("SELECT cliente, MIN(criado_em) desde FROM gatilho_cliente WHERE tipo = 'queda_forte_conta' AND estado <> 'resolvido' GROUP BY cliente"))
      add(r.cliente, { id: 'queda_forte_conta', rotulo: 'Queda forte do faturamento (Merovíngio)', desde: String(r.desde).slice(0, 10) })
    for (const r of tenta(`SELECT s.cliente, s.dia FROM meli_conta_saude s WHERE s.level_id LIKE '1\\_red%' ESCAPE '\\'
        AND s.dia = (SELECT MAX(x.dia) FROM meli_conta_saude x WHERE x.cliente = s.cliente AND x.level_id IS NOT NULL)`))
      add(r.cliente, { id: 'reputacao_vermelha', rotulo: 'Reputação vermelha no Mercado Livre', desde: r.dia })
    for (const r of tenta("SELECT cliente, hs_classificacao, hs_em FROM clientes_central WHERE hs_classificacao <> ''"))
      if (HS_RISCO.has(norm(r.hs_classificacao))) add(r.cliente, { id: 'health_score', rotulo: `Health score: ${r.hs_classificacao}`, desde: String(r.hs_em || '').slice(0, 10) })
    for (const r of tenta(`SELECT cliente, COUNT(*) n, MAX(recebido_em) em FROM feedback_relatorio WHERE status <> 'descartado' AND temas_json LIKE '%"critica"%' AND substr(recebido_em, 1, 10) >= ? GROUP BY cliente`, d30))
      add(r.cliente, { id: 'resposta_critica', rotulo: `Resposta crítica do cliente ao relatório (${r.n} nos últimos 30 dias)`, desde: String(r.em).slice(0, 10) })
    // pendência com data EXATA (registro manual ou encerramento por dependência feito no painel); data aproximada nunca vira sinal (política de tom)
    for (const r of tenta(`SELECT cliente, MIN(desde) desde, COUNT(*) n FROM (
        SELECT cliente, desde FROM pendencia_cliente WHERE resolvida_em = '' AND desde <> '' AND desde <= ?
        UNION ALL SELECT d.cliente, substr(d.em, 1, 10) FROM tarefa_dependencia d JOIN tarefas t ON t.id = d.tarefa_id
          WHERE d.reaberta_em = '' AND d.notion_ok = 1 AND t.status = 'dependencia_cliente' AND substr(d.em, 1, 10) <= ?) GROUP BY cliente`, d30, d30))
      add(r.cliente, { id: 'pendencia_30d', rotulo: `${r.n} pendência(s) do cliente aberta(s) há 30 dias ou mais`, desde: r.desde })
    for (const r of tenta(`SELECT cliente, COUNT(*) n, MIN(revisar_em) desde FROM alinhamento WHERE estado = 'vencido'
        OR (estado = 'vivo' AND permanente = 0 AND revisar_em <> '' AND revisar_em <= ?) GROUP BY cliente`, dia))
      add(r.cliente, { id: 'alinhamento_vencido', rotulo: `${r.n} alinhamento(s) com o cliente vencido(s) sem revisão`, desde: r.desde })
    const marcados = new Set(abertos().map(r => r.cliente))
    return [...por].map(([cliente, sinais]) => ({ cliente, sinais, risco_aberto: marcados.has(cliente) }))
      .sort((a, b) => b.sinais.length - a.sinais.length || a.cliente.localeCompare(b.cliente, 'pt-BR'))
  }

  return { marcar, encerrar, listar, abertos, sugestoes, motivos: MOTIVOS_RISCO }
}
