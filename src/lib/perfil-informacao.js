// PERFIL DE INFORMAÇÃO do cliente (pedido do David, 13/10/2026): o que cada cliente quer receber no relatório — serviço (assessoria | consultoria), temas em ORDEM
// (lista fechada em config/perfil-informacao.json), nível (padrão | didático | completo) e observação. Não é um segundo motor: não decide ação, prioridade nem número;
// só diz QUAIS blocos o relatório mostra e em que ordem (base fixa para todos + os pedidos no topo, ordemRelatorio). Os dados de cada bloco continuam saindo do
// Algoritmo/Merovíngio.
// Fontes: 'equipe' (curado em conversa com o cliente), 'whatsapp' (resposta no grupo revisada pela equipe) e 'sugestao' — a sugestão é DERIVADA na leitura das
// respostas em feedback_relatorio, nunca gravada: cliente com perfil salvo nunca recebe sugestão, e a sugestão não muda o relatório até alguém salvar (sinal só sugere).
// Cada mudança: linha nova em perfil_informacao_hist (append-only; trigger barra UPDATE/DELETE) + 'nota' no livro de registro com dados.evento = 'preferencia_cliente'.
// (Tipo próprio no livro não: TIPOS_LIVRO é CHECK da tabela append-only — ampliar exigiria recriar registro_cliente, e os triggers barram; a nota não quebra a cadeia.)
// Feedback curado pela equipe também vira linha em feedback_relatorio (origem 'equipe', status 'revisado', sem grupo, autor nem telefone) e entra no livro na mesma
// transação — assim a tela de respostas, o risco e o dossiê enxergam o mesmo fato.
// Núcleo SEM import de banco: handle, livro, relógio, validarPor e clientes entram pela fábrica. Fiação real: perfil-informacao-real.js.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { temContato } from './livro-registro.js'
import { hash16, lerConfig as lerConfigRespostas } from './respostas-relatorio.js'
import { diaValido } from './concorrencia.js'

export const lerConfig = () => JSON.parse(readFileSync(join(ROOT, 'config', 'perfil-informacao.json'), 'utf-8'))

export const SCHEMA_PERFIL_INFO = `
CREATE TABLE IF NOT EXISTS perfil_informacao (       -- o que o cliente quer receber no relatório (src/lib/perfil-informacao.js); 1 linha por cliente
  cliente TEXT PRIMARY KEY,                          -- nome canônico da central (nunca prospect)
  servico TEXT NOT NULL DEFAULT '' CHECK (servico IN ('assessoria','consultoria','')),
  temas_json TEXT NOT NULL DEFAULT '[]',             -- lista ORDENADA de chaves de config/perfil-informacao.json → temas ([] = só a base fixa)
  nivel TEXT NOT NULL DEFAULT 'padrao' CHECK (nivel IN ('padrao','didatico','completo')),
  observacao TEXT NOT NULL DEFAULT '' CHECK (length(observacao) <= 500),   -- interna, sem telefone
  fonte TEXT NOT NULL CHECK (fonte IN ('equipe','whatsapp','sugestao')),   -- 'sugestao' é derivada na leitura; o núcleo nunca a grava
  por TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS perfil_informacao_hist (  -- cada mudança do perfil (append-only)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,
  antes_json TEXT NOT NULL DEFAULT '',               -- '' = não havia perfil
  depois_json TEXT NOT NULL,
  por TEXT NOT NULL,
  em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perfil_info_hist ON perfil_informacao_hist (cliente, id);
CREATE TRIGGER IF NOT EXISTS trg_perfil_info_hist_sem_update BEFORE UPDATE ON perfil_informacao_hist BEGIN SELECT RAISE(ABORT, 'historico do perfil: alteracao proibida'); END;
CREATE TRIGGER IF NOT EXISTS trg_perfil_info_hist_sem_delete BEFORE DELETE ON perfil_informacao_hist BEGIN SELECT RAISE(ABORT, 'historico do perfil: exclusao proibida'); END;
`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
const pct = (n, d) => d ? Math.round(1000 * n / d) / 10 : null
// tema do perfil → 1º tema das respostas do WhatsApp que o representa (para gravar o feedback curado no mesmo vocabulário da tela de respostas)
export const paraFeedback = (temas, cfg = lerConfig()) => [...new Set(temas.map(t => cfg.temas[t]?.feedback?.[0]).filter(Boolean))]

// deps: livro (criarLivro), agora() ISO, validarPor(nome, cliente) → nome canônico ou '' (líder/consultor ou o CS deste cliente), clientes() → nomes ativos da central
export function criarPerfilInformacao(h, { cfg = lerConfig(), livro, agora = () => new Date().toISOString(), validarPor = () => '', clientes = () => [], temasFeedback = Object.keys(lerConfigRespostas().temas) } = {}) {
  const TEMAS = Object.keys(cfg.temas), SERV = ['', ...Object.keys(cfg.servicos)], NIV = Object.keys(cfg.niveis)
  const rot = t => cfg.temas[t]?.rotulo || t
  const DE_FEEDBACK = new Map(TEMAS.flatMap(t => (cfg.temas[t].feedback || []).map(f => [f, t])))
  // prévia sobre o banco real aberto só-leitura antes da migração (seed): tabela/coluna que ainda não existe = vazio
  const tenta = (fn, pad) => { try { return fn() } catch (e) { if (/no such (table|column)/i.test(e.message)) return pad; throw e } }
  const so = p => ({ servico: p.servico, temas: p.temas, nivel: p.nivel, observacao: p.observacao, fonte: p.fonte })
  const hidratar = r => r ? { cliente: r.cliente, ...so({ ...r, temas: parse(r.temas_json, []).filter(t => TEMAS.includes(t)) }), por: r.por, atualizado_em: r.atualizado_em } : null
  const atual = c => hidratar(tenta(() => h.prepare('SELECT * FROM perfil_informacao WHERE cliente = ?').get(c), null))
  const cli = c => { const x = str(c); if (!x || ehProspecto(x)) throw erro('cliente inválido'); return x }
  const quem = (por, cliente) => { const p = validarPor(str(por), cliente); if (!p) throw erro('quem registra precisa ser líder, consultor ou o CS deste cliente', 403); return p }
  const texto = (v, campo, max) => {
    if (v !== undefined && v !== null && typeof v !== 'string') throw erro(`"${campo}" precisa ser texto`)
    const t = str(v).replace(/\s+/g, ' ')
    if (t.length > max) throw erro(`"${campo}" passa de ${max} caracteres`)
    if (temContato(t)) throw erro(`"${campo}" não pode ter telefone nem contato de WhatsApp`)
    return t
  }

  function normalizar({ servico = '', temas = [], nivel = 'padrao', observacao = '', fonte = 'equipe' }) {
    const s = str(servico); if (!SERV.includes(s)) throw erro('serviço inválido (assessoria, consultoria ou vazio)')
    if (!Array.isArray(temas) || temas.length > TEMAS.length || temas.some(t => typeof t !== 'string' || !TEMAS.includes(t))) throw erro('tema fora da lista fechada')
    if (new Set(temas).size !== temas.length) throw erro('tema repetido')
    const n = str(nivel) || 'padrao'; if (!NIV.includes(n)) throw erro('nível inválido (padrao, didatico ou completo)')
    const f = str(fonte) || 'equipe'; if (!['equipe', 'whatsapp'].includes(f)) throw erro('fonte inválida (equipe ou whatsapp; sugestão não se grava)')
    return { servico: s, temas: [...temas], nivel: n, observacao: texto(observacao, 'observacao', 500), fonte: f }
  }
  const igual = (a, b) => !!a && JSON.stringify(so(a)) === JSON.stringify(so(b))
  const resumoDe = d => `${d.servico ? cfg.servicos[d.servico] : 'serviço não informado'}; ${d.temas.length ? d.temas.map(rot).join(', ') : 'só a base fixa'}; nível ${String(cfg.niveis[d.nivel]).split(' (')[0].toLowerCase()}`

  // salvar({ cliente, servico, temas, nivel, observacao, fonte, por, confirmar }) → prévia (nada gravado) sem confirmar === true; igual ao atual = nada muda (idempotente)
  function salvar({ cliente, por, confirmar = false, ...campos } = {}) {
    const c = cli(cliente), d = normalizar(campos), p = quem(por, c), antes = atual(c)
    if (igual(antes, d)) return { ok: true, previa: confirmar !== true, mudou: false, cliente: c, perfil: antes }
    if (confirmar !== true) return { ok: true, previa: true, mudou: true, cliente: c, antes, depois: { ...d, por: p } }
    const em = agora()
    h.transaction(() => {
      h.prepare(`INSERT INTO perfil_informacao (cliente, servico, temas_json, nivel, observacao, fonte, por, atualizado_em) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(cliente) DO UPDATE SET servico = excluded.servico, temas_json = excluded.temas_json, nivel = excluded.nivel, observacao = excluded.observacao,
          fonte = excluded.fonte, por = excluded.por, atualizado_em = excluded.atualizado_em`).run(c, d.servico, JSON.stringify(d.temas), d.nivel, d.observacao, d.fonte, p, em)
      const id = Number(h.prepare('INSERT INTO perfil_informacao_hist (cliente, antes_json, depois_json, por, em) VALUES (?,?,?,?,?)')
        .run(c, antes ? JSON.stringify(so(antes)) : '', JSON.stringify(d), p, em).lastInsertRowid)
      livro.registrar({ cliente: c, tipo: 'nota', ref: `perfil-info:${id}`, fato_em: em,
        resumo: `${antes ? 'Preferência de informação do cliente alterada' : 'Preferência de informação do cliente registrada'}: ${resumoDe(d)} (fonte ${d.fonte}; por ${p})`,
        dados: { evento: 'preferencia_cliente', ...d, por: p, antes: antes ? so(antes) : null } })
    }).immediate()
    return { ok: true, previa: false, mudou: true, cliente: c, perfil: atual(c) }
  }

  // sugestão pelas respostas (não descartadas) do cliente: temas do WhatsApp mapeados à lista fechada, na ordem em que apareceram; só para quem NÃO tem perfil salvo
  function sugestao(c) {
    const linhas = tenta(() => h.prepare("SELECT temas_json, recebido_em FROM feedback_relatorio WHERE cliente = ? AND status <> 'descartado' ORDER BY recebido_em, msg_id").all(c), [])
    const temas = []
    for (const l of linhas) for (const f of parse(l.temas_json, [])) { const t = DE_FEEDBACK.get(f); if (t && !temas.includes(t)) temas.push(t) }
    return temas.length ? { cliente: c, servico: '', temas, nivel: 'padrao', observacao: '', fonte: 'sugestao', respostas: linhas.length, ate: linhas.at(-1).recebido_em } : null
  }

  const ativos = () => new Set(clientes().filter(c => c && !ehProspecto(c)))
  const perfis = (at = ativos()) => tenta(() => h.prepare('SELECT * FROM perfil_informacao ORDER BY cliente').all(), []).map(hidratar)
    .filter(p => !ehProspecto(p.cliente) && (!at.size || at.has(p.cliente)))     // sem lista da central (teste/prévia): todos os perfis
  // temas padrão = os mais pedidos (perfis salvos; empate = ordem do config)
  const ranking = (lista = perfis()) => TEMAS.map(t => [t, lista.filter(p => p.temas.includes(t)).length]).filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1] || TEMAS.indexOf(a[0]) - TEMAS.indexOf(b[0])).map(([t]) => t)
  // ordem dos blocos: pedidos do cliente no topo (na ordem dele) + o resto da base fixa na ordem dos mais pedidos.
  // ponytail: quem não tem perfil recebe só a base fixa (ordenada pelos mais pedidos) — tema fora da base só entra com pedido, para o relatório não inchar
  const ordemRelatorio = (temas, rk) => { const pos = t => (rk.includes(t) ? rk.indexOf(t) : rk.length + TEMAS.indexOf(t)); return [...new Set([...temas, ...[...cfg.base_fixa].sort((a, b) => pos(a) - pos(b))])] }

  function ler(cliente) {
    const c = cli(cliente), perfil = atual(c), sug = perfil ? null : sugestao(c), rk = ranking()
    const historico = tenta(() => h.prepare('SELECT id, antes_json, depois_json, por, em FROM perfil_informacao_hist WHERE cliente = ? ORDER BY id DESC LIMIT 50').all(c), [])
      .map(r => ({ id: r.id, em: r.em, por: r.por, antes: parse(r.antes_json, null), depois: parse(r.depois_json, {}) }))
    const temas = perfil?.temas || []
    return { cliente: c, perfil, sugestao: sug, efetivo: { fonte: perfil ? perfil.fonte : 'padrao', servico: perfil?.servico || '', nivel: perfil?.nivel || 'padrao', temas, ordem: ordemRelatorio(temas, rk) }, historico }
  }

  // matriz da carteira: por tema, quantos e quais clientes pediram (posição na ordem deles), por serviço; % da carteira com perfil; temas padrão; sugestões pendentes
  function matriz() {
    const at = ativos(), lista = perfis(at), rk = ranking(lista), carteira = at.size || lista.length
    const sugestoes = [...at].sort((a, b) => a.localeCompare(b, 'pt-BR')).filter(c => !lista.some(p => p.cliente === c)).map(sugestao).filter(Boolean)
    const conta = (ls, f) => ls.filter(f).length
    const servicos = ls => ({ assessoria: conta(ls, p => p.servico === 'assessoria'), consultoria: conta(ls, p => p.servico === 'consultoria'), sem_servico: conta(ls, p => !p.servico) })
    const por_tema = TEMAS.map(t => {
      const quem = lista.filter(p => p.temas.includes(t)), sq = sugestoes.filter(s => s.temas.includes(t))
      return { tema: t, rotulo: rot(t), base_fixa: cfg.base_fixa.includes(t), n: quem.length, pct_com_perfil: pct(quem.length, lista.length), por_servico: servicos(quem),
        clientes: quem.map(p => ({ cliente: p.cliente, servico: p.servico, posicao: p.temas.indexOf(t) + 1, fonte: p.fonte })), n_sugestao: sq.length, sugestoes: sq.map(s => s.cliente) }
    }).sort((a, b) => b.n - a.n || TEMAS.indexOf(a.tema) - TEMAS.indexOf(b.tema))
    return { carteira, com_perfil: lista.length, pct_com_perfil: pct(lista.length, carteira), por_servico: servicos(lista),
      por_nivel: Object.fromEntries(NIV.map(n => [n, conta(lista, p => p.nivel === n)])), por_tema, temas_padrao: rk, ordem_sem_perfil: ordemRelatorio([], rk),
      base_fixa: cfg.base_fixa, sugestoes: sugestoes.map(s => ({ cliente: s.cliente, temas: s.temas, respostas: s.respostas, ate: s.ate })) }
  }

  // feedback curado pela equipe (conversa com o cliente) → feedback_relatorio origem 'equipe', status 'revisado'. Âncora/relação/confiança ficam fixas em
  // ('pergunta','citou','certa'): a equipe ouviu do cliente; o CHECK da tabela não tem valor próprio para isso — quem distingue é `origem`. recebido_em = o DIA (sem hora
  // inventada). Entra no livro na mesma transação (o tick do livro pula pelo UNIQUE(tipo, ref) e nunca a descreve como «citou a nossa mensagem»). Idempotente por (dia, cliente).
  function registrarFeedbackEquipe({ cliente, texto: txt, temas = [], nota = '', dia = '', por, confirmar = false } = {}) {
    const c = cli(cliente), p = quem(por, c)
    const t = texto(txt, 'texto', 2000), n = texto(nota, 'nota', 500)
    if (!t) throw erro('informe "texto"')
    if (!diaValido(str(dia))) throw erro('"dia" precisa ser AAAA-MM-DD')
    if (!Array.isArray(temas) || temas.some(x => !temasFeedback.includes(x)) || new Set(temas).size !== temas.length) throw erro('tema de resposta fora da lista')
    const msg_id = `equipe:${dia}:${hash16(c)}`
    if (tenta(() => h.prepare('SELECT 1 FROM feedback_relatorio WHERE msg_id = ?').get(msg_id), null)) return { ok: true, previa: confirmar !== true, novo: false, msg_id }
    if (confirmar !== true) return { ok: true, previa: true, novo: true, msg_id, feedback: { cliente: c, texto: t, temas, nota: n, dia, por: p } }
    const em = agora()
    h.transaction(() => {
      h.prepare(`INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, autor_hash, autor_nome, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json,
          status, nota_interna, status_por, status_em, coletado_em, origem)
        VALUES (?, ?, '', '', '', ?, ?, ?, 'pergunta', 'citou', 'certa', ?, 'revisado', ?, ?, ?, ?, 'equipe')`).run(msg_id, c, t, dia, `equipe:${dia}`, JSON.stringify(temas), n, p, em, em)
      livro.registrar({ cliente: c, tipo: 'resposta_cliente', ref: msg_id, fato_em: dia, resumo: `Retorno do cliente sobre o relatório, colhido pela equipe em conversa (registrado por ${p})`,
        dados: { origem: 'equipe', ancora_tipo: 'pergunta', confianca: 'certa' } })
    }).immediate()
    return { ok: true, previa: false, novo: true, msg_id }
  }

  const catalogo = () => ({ temas: TEMAS.map(t => ({ tema: t, rotulo: rot(t), base_fixa: cfg.base_fixa.includes(t) })), servicos: cfg.servicos, niveis: cfg.niveis, fontes: cfg.fontes, base_fixa: cfg.base_fixa })
  return { salvar, ler, matriz, sugestao, registrarFeedbackEquipe, catalogo }
}
