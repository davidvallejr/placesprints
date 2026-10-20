// Encerramento por dependência do cliente: a tarefa sai do backlog ativo (status dependencia_cliente) com a face "Aguardando Devolutiva do Cliente"
// no Notion e um registro local (tipo, detalhe, evidência, quem) que sobrevive ao sync. Não conta como entregue nem como bloqueada.
// Núcleo SEM import de banco/Notion: handle, notion.req, agora/hoje e validarPor entram por fábrica — o autoteste usa :memory: e um stub.
// Regras: prévia por padrão (nenhuma escrita); PATCH idempotente (já na opção = só registro); falha nunca finge sucesso (notion_ok=0 + motivo fixo).
import { OPCAO_NOTION_DEPENDENCIA } from './status-tarefa.js'
import { url as validarUrl } from './ficha-nucleo.js'

export const SCHEMA_DEPENDENCIA = `
CREATE TABLE IF NOT EXISTS tarefa_dependencia (   -- encerramento por dependência do cliente; sobrevive ao sync
  tarefa_id TEXT PRIMARY KEY,                     -- page_id do Notion (= tarefas.id); 1 episódio por tarefa, transições em historico
  cliente TEXT NOT NULL,                          -- copiado de tarefas.cliente, nunca do corpo
  tipo TEXT NOT NULL,                             -- fotos | custos | acesso | aprovacao | produto | informacao | outro | documentos | regulatorio | logistica | atendimento
  detalhe TEXT NOT NULL,                          -- ≤300, obrigatório: é o que o cliente vai ler
  evidencia TEXT NOT NULL DEFAULT '',             -- URL http(s) ≤500 (print, e-mail, WhatsApp, Drive)
  por TEXT NOT NULL,                              -- nome canônico de líder/consultor (≤80)
  em TEXT NOT NULL,                               -- ISO
  status_antes TEXT NOT NULL DEFAULT '',          -- status_raw anterior (p/ um futuro desfazer)
  notion_ok INTEGER NOT NULL DEFAULT 0,           -- 1 = PATCH aceito; 0 = falhou (a linha documenta a tentativa, nunca finge)
  notion_erro TEXT NOT NULL DEFAULT '',
  notion_last_edited TEXT NOT NULL DEFAULT '',    -- last_edited_time devolvido pelo PATCH (corrida com sync / reabertura)
  comentario TEXT NOT NULL DEFAULT '',            -- ok | pendente — integração sem permissão de comentários | ''
  reaberta_em TEXT NOT NULL DEFAULT '',           -- o sync grava quando a tarefa sai do status no Notion
  reaberta_para TEXT NOT NULL DEFAULT ''          -- status_raw de destino
);
CREATE INDEX IF NOT EXISTS ix_tdep_cliente ON tarefa_dependencia (cliente, reaberta_em);
`
// o sync marca a reabertura quando a página saiu do status no Notion DEPOIS do nosso PATCH (ISO compara lexicograficamente; leitura velha nunca "reabre")
export const SQL_REABERTURA = "UPDATE tarefa_dependencia SET reaberta_em = ?, reaberta_para = ? WHERE tarefa_id = ? AND notion_ok = 1 AND reaberta_em = '' AND notion_last_edited < ?"

export const TIPOS = {                                            // rótulo para o cliente
  fotos: 'Fotos do produto', custos: 'Custos e preços', acesso: 'Acesso à conta', aprovacao: 'Aprovação do cliente',
  produto: 'Produto ou estoque', informacao: 'Informação ou cadastro', outro: 'Outro',
  documentos: 'Documentos e validação da conta', regulatorio: 'ANVISA, INMETRO ou categoria restrita',   // 08/10: catálogo de pendências do cliente por canal (config/dependencias-cliente.json)
  logistica: 'Remessa, despacho ou estoque no canal', atendimento: 'Atendimento ao comprador',
}
export const textoDe = reg => `${TIPOS[reg.tipo] || TIPOS.outro}: ${reg.detalhe}`   // uma frase para semanal, relatório e telas
// régua (config/playbook.json: limiares.dependencia_atencao_dias = 14; dias_parada = 30)
export const FAIXAS = { aguardando: 'Aguardando o cliente', cobrar: 'Cobrar o cliente', revisar: 'Revisar com o cliente: manter, replanejar ou cancelar' }
export const faixaDe = (dias, { atencao = 14, revisar = 30 } = {}) => dias >= revisar ? 'revisar' : dias >= atencao ? 'cobrar' : 'aguardando'
export const SEM_MOTIVO = 'sem motivo registrado — registre pela tela Painel executivo'
export const COMENTARIO_PENDENTE = 'pendente — integração sem permissão de comentários'
export const FALHA_LOCAL = 'falha ao gravar localmente — rode o sync e registre o motivo de novo'

// desde quando a tarefa espera o cliente = a evidência MAIS ANTIGA (por dia) entre o registro do líder, a troca de status no historico e a
// última edição no Notion: registrar o motivo semanas depois não zera o relógio. Empate = registro > historico > ultima_edicao. Mesma régua em metricas.js.
export function desdeDe({ registro_em, historico_em, last_edited }) {
  const [desde_origem, desde] = [['registro', registro_em], ['historico', historico_em], ['ultima_edicao', last_edited]]
    .filter(([, v]) => v).map(([k, v]) => [k, String(v).slice(0, 10)]).sort((a, b) => a[1].localeCompare(b[1]))[0] || ['ultima_edicao', null]
  return { desde, desde_origem }
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''                 // fronteira de confiança: objeto/array nunca vira '[object Object]'
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const RX_ID = /^[0-9a-f-]{32,36}$/i
const TTL_MS = 10 * 60_000
// mensagens fixas por status HTTP do Notion — nunca o corpo da resposta nem o id
const MSG_NOTION = {
  0: 'NOTION_TOKEN ausente',
  400: `a base deste cliente não tem a opção '${OPCAO_NOTION_DEPENDENCIA}' — crie no Notion e tente de novo`,
  403: 'a integração não tem permissão para editar esta base',
  404: 'card arquivado ou fora do acesso da integração',
}
const mensagemDe = e => MSG_NOTION[e?.status] || 'Notion indisponível agora — tente de novo'

// deps: handle (better-sqlite3), notion.req(caminho, { method, body, retry5xx }) com throttle/retry (notionReq), agora() ISO, hoje() 'YYYY-MM-DD',
//       validarPor(nome) → nome canônico de líder/consultor ou '', mapeamento (config/mapeamento.json), limiares { atencao, revisar } em dias
export function criarDependencias({ handle, notion, agora, hoje, validarPor, mapeamento, limiares = { atencao: 14, revisar: 30 } }) {
  const selTarefa = handle.prepare('SELECT id, titulo, cliente, fonte, status, status_raw, last_edited FROM tarefas WHERE id = ? AND arquivada = 0')
  // last_edited recebe o last_edited_time do PATCH: uma leitura do sync anterior ao PATCH (página consultada antes, gravada depois) nunca rebaixa a tarefa (sync.js)
  const updStatus = handle.prepare("UPDATE tarefas SET status = 'dependencia_cliente', status_raw = ?, last_edited = ? WHERE id = ?")
  const insHistorico = handle.prepare("INSERT INTO historico (tarefa_id, campo, de, para, em) VALUES (?, 'status', ?, 'dependencia_cliente', ?)")
  const updComentario = handle.prepare('UPDATE tarefa_dependencia SET comentario = ? WHERE tarefa_id = ?')
  // '' em status_antes/comentario = manter o que já havia (caso "já estava": nada novo a dizer); notion_last_edited nunca anda para trás (ISO compara como texto)
  const upsert = handle.prepare(`INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, evidencia, por, em, status_antes, notion_ok, notion_erro, notion_last_edited, comentario)
    VALUES (@tarefa_id, @cliente, @tipo, @detalhe, @evidencia, @por, @em, @status_antes, @notion_ok, @notion_erro, @notion_last_edited, @comentario)
    ON CONFLICT(tarefa_id) DO UPDATE SET cliente=excluded.cliente, tipo=excluded.tipo, detalhe=excluded.detalhe, evidencia=excluded.evidencia, por=excluded.por, em=excluded.em,
      notion_ok=excluded.notion_ok, notion_erro=excluded.notion_erro, reaberta_em='', reaberta_para='',
      status_antes=CASE WHEN excluded.status_antes = '' THEN tarefa_dependencia.status_antes ELSE excluded.status_antes END,
      notion_last_edited=MAX(tarefa_dependencia.notion_last_edited, excluded.notion_last_edited),
      comentario=CASE WHEN excluded.comentario = '' THEN tarefa_dependencia.comentario ELSE excluded.comentario END`)

  // ── propriedade Status e a opção da base (1 GET por base do lote; cache 10 min) ──
  const cache = new Map()                                        // fonte → { em, v: { prop, opcao } }
  async function opcoesDaFonte(fonte) {
    const hit = cache.get(fonte)
    if (hit && Date.parse(agora()) - Date.parse(hit.em) < TTL_MS) return hit.v
    let s
    try { s = await notion.req(`data_sources/${fonte}`) }
    catch (e) { if (e.status !== 400 && e.status !== 404) throw e; s = await notion.req(`databases/${fonte}`) }   // fonte antiga = database id
    if (!s.properties && s.data_sources?.[0]) s = await notion.req(`data_sources/${s.data_sources[0].id}`)
    const props = s.properties || {}
    const prop = (mapeamento.propriedades.status || []).find(n => props[n]?.type === 'status') || ''
    const alvo = semAcento(OPCAO_NOTION_DEPENDENCIA)
    const opcao = prop ? (props[prop].status?.options || []).map(o => o.name).find(n => semAcento(n) === alvo) || '' : ''   // grafia da base
    const v = { prop, opcao }
    cache.set(fonte, { em: agora(), v })
    return v
  }

  // ── validação do corpo (mensagens fixas: nunca ecoam o valor recebido) ──
  function validar(b) {
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))] : []
    if (!ids.length) throw erro('informe "ids" (1 a 100 tarefas)')
    if (ids.length > 100) throw erro('máximo de 100 tarefas por vez')
    if (!ids.every(id => RX_ID.test(id))) throw erro('id de tarefa inválido')
    const tipo = str(b.tipo)
    if (!Object.hasOwn(TIPOS, tipo)) throw erro('tipo de dependência desconhecido — escolha um da lista')
    const detalhe = str(b.detalhe)
    if (detalhe.length < 3 || detalhe.length > 300) throw erro('descreva o que falta do cliente (até 300 caracteres)')
    const evidencia = validarUrl(b.evidencia)
    if (!str(b.por)) throw erro('informe "por" (quem encerra — líder ou consultor)')
    const por = validarPor(str(b.por))
    if (!por) throw erro('só líderes e consultores encerram por dependência do cliente — escolha um nome da central')
    return { ids, tipo, detalhe, evidencia, por: String(por).slice(0, 80) }
  }

  // passos 1-2 do lote: a tarefa existe e cabe dependência? já está na opção?
  const item = t => ({ id: t.id, titulo: t.titulo, cliente: t.cliente })
  function triar(id) {
    const t = selTarefa.get(id)
    if (!t) return { motivo: 'tarefa não encontrada ou arquivada' }
    if (t.status === 'concluida' || t.status === 'cancelada') return { t, motivo: 'tarefa já encerrada — não cabe dependência' }
    return { t, ja_estava: semAcento(t.status_raw) === semAcento(OPCAO_NOTION_DEPENDENCIA) }
  }

  // prévia: nenhuma escrita (nem local nem no Notion); avisa ANTES de tentar quando a base não tem a opção
  async function previa(ids) {
    const r = { mudam: [], ja_estavam: [], invalidas: [], bases_sem_opcao: [] }
    for (const id of ids) {
      const { t, motivo, ja_estava } = triar(id)
      if (motivo) { r.invalidas.push({ id, titulo: t?.titulo, motivo }); continue }
      if (ja_estava) { r.ja_estavam.push(item(t)); continue }
      let s
      try { s = await opcoesDaFonte(t.fonte) } catch (e) { r.invalidas.push({ id, titulo: t.titulo, motivo: mensagemDe(e) }); continue }
      if (!s.opcao) {
        r.invalidas.push({ id, titulo: t.titulo, motivo: MSG_NOTION[400] })
        if (!r.bases_sem_opcao.includes(t.cliente)) r.bases_sem_opcao.push(t.cliente)
        continue
      }
      r.mudam.push(item(t))
    }
    return r
  }

  // sem confirmar:true devolve a prévia; com, executa sequencialmente (o throttle de notion.req já serializa)
  async function encerrar(b = {}) {
    const v = validar(b)
    if (b.confirmar !== true) return previa(v.ids)
    const r = { ok: true, encerradas: [], ja_estavam: [], falhas: [], comentarios_pendentes: 0 }
    const texto = `Encerrada por dependência do cliente — ${TIPOS[v.tipo]}: ${v.detalhe}${v.evidencia ? ` · evidência: ${v.evidencia}` : ''} · por ${v.por} (Place Sprints)`
    let semComentarios = false                                   // 403 no 1º comentário: a integração não comenta — não insiste nos demais
    for (const id of v.ids) {
      const { t, motivo, ja_estava } = triar(id)
      if (motivo) { r.falhas.push({ id, titulo: t?.titulo, motivo }); continue }
      const base = { tarefa_id: id, cliente: t.cliente, tipo: v.tipo, detalhe: v.detalhe, evidencia: v.evidencia, por: v.por, em: agora() }
      if (ja_estava) {                                           // sem PATCH: só o registro (idempotente — não gasta rate limit nem duplica historico)
        handle.transaction(() => {
          upsert.run({ ...base, status_antes: '', notion_ok: 1, notion_erro: '', notion_last_edited: t.last_edited || '', comentario: '' })
          updStatus.run(t.status_raw, t.last_edited, id)
        })()
        r.ja_estavam.push(item(t)); continue
      }
      let s, pg
      try {
        s = await opcoesDaFonte(t.fonte)
        if (!s.opcao) throw erro(MSG_NOTION[400], 400)
        pg = await notion.req(`pages/${id}`, { method: 'PATCH', body: { properties: { [s.prop]: { status: { name: s.opcao } } } } })
      } catch (e) {                                              // tarefas/historico intocados; o registro documenta a tentativa
        const m = mensagemDe(e)
        upsert.run({ ...base, status_antes: t.status_raw, notion_ok: 0, notion_erro: m, notion_last_edited: '', comentario: '' })
        r.falhas.push({ id, titulo: t.titulo, motivo: m }); continue
      }
      try {
        handle.transaction(() => {
          updStatus.run(s.opcao, pg.last_edited_time || t.last_edited, id)
          if (t.status !== 'dependencia_cliente') insHistorico.run(id, t.status, base.em)   // o sync seguinte não duplica: anterior.status já é igual
          upsert.run({ ...base, status_antes: t.status_raw, notion_ok: 1, notion_erro: '', notion_last_edited: pg.last_edited_time || '', comentario: '' })
        })()
      } catch {                                                  // PATCH aceito, banco ocupado (sync gravando): o sync traz o status; o motivo precisa ser registrado de novo
        r.falhas.push({ id, titulo: t.titulo, motivo: FALHA_LOCAL }); continue
      }
      // comentário no card: melhor esforço, nunca falha o item
      let comentario = COMENTARIO_PENDENTE
      if (!semComentarios) {
        try { await notion.req('comments', { method: 'POST', body: { parent: { page_id: id }, rich_text: [{ text: { content: texto } }] }, retry5xx: false }); comentario = 'ok' }
        catch (e) { if (e.status === 403) semComentarios = true; else comentario = `pendente — ${mensagemDe(e)}` }
      }
      updComentario.run(comentario, id)
      if (comentario !== 'ok') r.comentarios_pendentes++
      r.encerradas.push({ ...item(t), comentario })
    }
    return r
  }

  // tarefas em dependência do cliente (status da tarefa = verdade; o registro só acrescenta motivo/evidência/quem).
  // desde = o mais antigo entre registro.em, última troca de status p/ dependencia_cliente|bloqueada no historico e última edição (desdeDe, origem declarada)
  function listar({ cliente = '', ids, hoje: dia } = {}) {
    const cond = ['t.arquivada = 0', "t.status = 'dependencia_cliente'"], args = []
    if (cliente) { cond.push('t.cliente = ?'); args.push(cliente) }
    if (ids?.length) { cond.push(`t.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids.map(String)) }
    const rows = handle.prepare(`SELECT t.id, t.titulo, t.cliente, t.responsavel, t.prazo, t.url, t.sprint, t.processo, t.status, t.status_raw, t.last_edited,
        d.tipo, d.detalhe, d.evidencia, d.por, d.em AS registro_em, d.comentario, h.em AS historico_em
      FROM tarefas t
      LEFT JOIN tarefa_dependencia d ON d.tarefa_id = t.id AND d.notion_ok = 1 AND d.reaberta_em = ''
      LEFT JOIN (SELECT tarefa_id, MAX(em) AS em FROM historico WHERE campo = 'status' AND para IN ('dependencia_cliente','bloqueada') GROUP BY tarefa_id) h ON h.tarefa_id = t.id
      WHERE ${cond.join(' AND ')}`).all(args)
    const ref = dia || hoje()
    return rows.map(({ last_edited, historico_em, ...r }) => {
      const { desde, desde_origem } = desdeDe({ registro_em: r.registro_em, historico_em, last_edited })
      const dias = desde ? Math.max(0, Math.round((Date.parse(ref) - Date.parse(desde)) / 86_400_000)) : 0
      const faixa = faixaDe(dias, limiares)
      const reg = r.tipo ? { tipo: r.tipo, detalhe: r.detalhe } : null
      return {
        ...r, tipo: r.tipo || '', tipo_rotulo: reg ? TIPOS[r.tipo] || '' : '', detalhe: reg ? r.detalhe : SEM_MOTIVO, texto: reg ? textoDe(reg) : SEM_MOTIVO,
        evidencia: r.evidencia || '', por: r.por || '', registro_em: r.registro_em || '', comentario: r.comentario || '',
        desde, desde_origem, dias, faixa, faixa_rotulo: FAIXAS[faixa],
      }
    }).sort((a, b) => String(a.desde).localeCompare(String(b.desde)) || a.titulo.localeCompare(b.titulo))   // mais antiga primeiro
  }

  return { previa, encerrar, listar, opcoesDaFonte, limiares }
}
