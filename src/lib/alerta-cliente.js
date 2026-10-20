// Alerta de pendência CRÍTICA do cliente (frente F5, 08/10/2026): aviso interno com som + página de alerta no Notion do cliente.
// Lê SÓ do avaliador único (pendencias-cliente.js → avaliar/explicar): não existe segundo motor. Contrato: docs/contrato-pendencias-cliente.md; manual: docs/alerta-cliente.md.
// NÃO importa db.js nem notion.js: handle (better-sqlite3), cliente do Notion, avaliador, destinos, reconferência ao vivo, relógio e notificador entram por injeção —
// o autoteste roda em :memory: com stub do Notion e relógio falso; a fiação real está em alerta-cliente-real.js. Tabela própria `alerta_cliente`: este módulo só LÊ
// relatorio_programacao e relatorio_envio (liberação e "já recebeu relatório") e NUNCA escreve nelas (não avança a sexta do relatório).
// Regras: tom neutro, factual e datado (sem responsável, prazo, nome interno ou ID; associação ≠ causalidade); texto = template FIXO do catálogo (explicar) + fatos do avaliador;
// auditor (relatorio-seguro) ANTES de qualquer escrita; uma chamada de criação (retry5xx:false), idempotência por título exato, 5xx/timeout consulta por título antes de reenviar;
// 401 interrompe a varredura, 403/404/400 marcam «bloqueado» com motivo fixo, 5xx/rede/timeout NÃO pausam nada (backoff + disjuntor); o corpo do Notion nunca vai a log nem a resposta.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT } from './env.js'
import { CATEGORIA, auditarBlocos, auditarTexto, linhasDeTexto, codigosDe } from './relatorio-seguro.js'
import { criarRelatorioNotion, decidirCategoria, decidirStatus, classificarErro, tituloFinal, tituloAlertaOk, PREFIXO_ALERTA, normNome, rt, MSG_DESTINO, MSG_NOTION } from './relatorio-notion.js'
import { fatoParaCliente } from './pendencias-texto.js'
import { dataNoFuso, horaNoFuso, dentroDaJanela, estadoDeHandle } from './relatorio-envio.js'

export const SCHEMA_ALERTA = `
CREATE TABLE IF NOT EXISTS alerta_cliente (       -- um alerta por (cliente, item, canal, assinatura); o «assunto» é (cliente, item, canal)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                          -- nome canônico da central (nunca prospect)
  item TEXT NOT NULL, canal TEXT NOT NULL,        -- id do catálogo (config/dependencias-cliente.json) + canal
  rotulo TEXT NOT NULL DEFAULT '', canal_rotulo TEXT NOT NULL DEFAULT '',   -- cópia dos rótulos no momento da detecção
  fonte TEXT NOT NULL DEFAULT '',                 -- medido | tarefa | registro
  gravidade TEXT NOT NULL DEFAULT 'critico',
  assinatura TEXT NOT NULL,                       -- sha256(item|canal|ids ordenados|gravidade), 16 hex
  ids TEXT NOT NULL DEFAULT '[]',                 -- JSON ordenado: anúncios / tarefas / registro da assinatura (INTERNO, nunca vai ao cliente)
  estado TEXT NOT NULL,                           -- pendente | enviado | suprimido | bloqueado | falhou | resolvido
  motivo TEXT NOT NULL DEFAULT '',                -- código fixo (cooldown, fora_da_janela, notion_403, conteudo:jargao, adotado …); nunca texto do Notion
  titulo TEXT NOT NULL DEFAULT '', page_id TEXT NOT NULL DEFAULT '', page_url TEXT NOT NULL DEFAULT '',
  origem TEXT NOT NULL DEFAULT '',                -- automatico | manual (como a página saiu)
  por TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',                  -- sha256(children) 16 hex: auditoria do que saiu
  tentativas INTEGER NOT NULL DEFAULT 0, tentar_apos TEXT NOT NULL DEFAULT '',   -- backoff depois de falha
  incerto INTEGER NOT NULL DEFAULT 0,             -- 1 = página adotada depois de resposta ambígua (5xx/timeout)
  concluir_pendente INTEGER NOT NULL DEFAULT 0,   -- 1 = resolvido, mas o Status da página ainda precisa virar «Concluído»
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  enviado_em TEXT NOT NULL DEFAULT '', resolvido_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_alerta_cli ON alerta_cliente (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_alerta_item ON alerta_cliente (cliente, item, enviado_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_aberto ON alerta_cliente (cliente, item, canal, assinatura) WHERE estado <> 'resolvido';
`

const ABERTOS = ['pendente', 'enviado', 'suprimido', 'bloqueado', 'falhou']
const RANK = { critico: 0, atencao: 1, info: 2 }
const COLUNAS = ['rotulo', 'canal_rotulo', 'fonte', 'gravidade', 'assinatura', 'ids', 'estado', 'motivo', 'titulo', 'page_id', 'page_url', 'origem', 'por', 'hash', 'tentativas', 'tentar_apos', 'incerto', 'concluir_pendente', 'enviado_em', 'resolvido_em']   // lista fechada do UPDATE

// ── configuração (config/alerta-cliente.json), validada na carga ─────────────────────────────────────────────────
const fusoValido = f => { try { new Intl.DateTimeFormat('en-CA', { timeZone: f }); return true } catch { return false } }
export function validarConfig(c) {
  const falha = m => { throw new Error(`config/alerta-cliente.json: ${m}`) }
  if (!c || typeof c !== 'object' || Array.isArray(c)) falha('JSON inválido')
  if (typeof c.fuso !== 'string' || !fusoValido(c.fuso)) falha('"fuso" precisa ser um fuso IANA válido (ex.: America/Sao_Paulo)')
  for (const k of ['hora_inicio', 'hora_fim']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c[k]))) falha(`"${k}" precisa ser HH:MM`)
  if (!(c.hora_inicio < c.hora_fim)) falha('"hora_inicio" precisa ser antes de "hora_fim"')
  for (const k of ['dias_uteis_apenas', 'automatico_ligado', 'avisar_resolucao']) if (typeof c[k] !== 'boolean') falha(`"${k}" precisa ser verdadeiro ou falso`)
  if (!Array.isArray(c.status_elegiveis) || !c.status_elegiveis.length || !c.status_elegiveis.every(s => typeof s === 'string' && s.trim())) falha('"status_elegiveis" precisa ser uma lista de textos')
  const num = (k, min, max) => { const v = c[k]; if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) falha(`"${k}" fora do intervalo ${min}..${max}`) }
  num('cooldown_dias', 1, 90); num('teto_semanal_por_cliente', 1, 30); num('teto_diario_paginas', 1, 500); num('max_avisos_por_varredura', 0, 50)
  num('aviso_dedupe_min', 0, 10080); num('backoff_base_min', 1, 1440); num('backoff_max_min', c.backoff_base_min ?? 1, 10080); num('previa_ttl_min', 1, 240)
  if (c.categoria !== CATEGORIA) falha(`"categoria" precisa ser exatamente «${CATEGORIA}» (a opção que já existe em Informações › Secção; nunca uma nova)`)
  if (typeof c.icone !== 'string' || !c.icone.trim()) falha('"icone" precisa ser um emoji')
  if (!Array.isArray(c.status_aberto) || !c.status_aberto.length || !c.status_aberto.every(s => typeof s === 'string' && s.trim())) falha('"status_aberto" precisa ser uma lista de textos')
  if (typeof c.status_final !== 'string' || !c.status_final.trim()) falha('"status_final" precisa ser um texto')
  const g = c.gatilhos
  if (!g || !Array.isArray(g.gravidades) || !g.gravidades.length || !g.gravidades.every(x => Object.hasOwn(RANK, x))) falha('"gatilhos.gravidades" precisa ser uma lista de critico, atencao ou info')
  if (!Array.isArray(g.excluir_itens) || !g.excluir_itens.every(x => typeof x === 'string')) falha('"gatilhos.excluir_itens" precisa ser uma lista de ids do catálogo')
  return Object.freeze({ ...c, status_elegiveis: Object.freeze([...c.status_elegiveis]), status_aberto: Object.freeze([...c.status_aberto]), gatilhos: Object.freeze({ gravidades: Object.freeze([...g.gravidades]), excluir_itens: Object.freeze([...g.excluir_itens]) }) })
}
export const lerConfig = (caminho = join(ROOT, 'config', 'alerta-cliente.json')) => validarConfig(JSON.parse(readFileSync(caminho, 'utf-8')))

// ── funções puras ───────────────────────────────────────────────────────────────────────────────────────────────────
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dma = iso => `${dm(iso)}/${iso.slice(0, 4)}`
const tema = p => `${p.rotulo}${p.canal && p.canal !== 'geral' && p.canal_rotulo ? ` (${p.canal_rotulo})` : ''}`

// ids que identificam a pendência, em ordem de RELEVÂNCIA (estoque: receita; tarefas: a mais antiga primeiro). A assinatura usa a cópia ordenada.
export function idsDe(p, tarefas = []) {
  if (p.fonte === 'registro') return [p.registro_id != null ? `r${p.registro_id}` : String(p.id)]
  if (p.fonte === 'tarefa') return tarefas.filter(t => t.item === p.item && t.canal === p.canal).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)).map(t => String(t.id))
  return (p.anuncios || []).map(a => String(a.id))
}
// hash de item + canal + ids ordenados + gravidade: o mesmo assunto com os mesmos itens não vira alerta novo
export const assinaturaDe = (p, ids) => sha(`${p.item}|${p.canal}|${[...ids].sort().join(',')}|${p.gravidade}`)

// Corpo da página de alerta (puro). `texto` = pendencias.explicar(p): os 4 templates FIXOS do catálogo. O resto é fato datado do avaliador.
export function alertaParaBlocos(p, { texto, hoje, hora } = {}) {
  const t = texto || p
  const bloco = (type, corpo) => ({ object: 'block', type, [type]: corpo })
  const par = (rich, color) => bloco('paragraph', { rich_text: rich, ...(color ? { color } : {}) })
  const secao = (titulo, ...paragrafos) => [bloco('heading_3', { rich_text: rt(titulo) }), ...paragrafos]
  const cinza = s => par(rt(s, { color: 'gray' }))
  const com = p.canal && p.canal !== 'geral' && p.canal_rotulo ? ` · ${p.canal_rotulo}` : ''
  const fato = fatoParaCliente(p)                                    // data aproximada: reconstruído sem contagem de dias nem "última atualização"
  const imp = { ...(p.impacto || {}) }
  if (p.desde_aproximado === true && imp.rotulo) imp.rotulo = String(imp.rotulo).replace(/\s+há\s+\d+\s+dias?(?:\(s\))?/gi, '')   // data aproximada: nunca contagem de dias
  const impacto = Number.isFinite(imp.valor_brl) && imp.valor_brl > 0
    ? [par(rt(imp.rotulo || '')), ...(imp.premissa ? [cinza(imp.premissa)] : [])]
    : [par(rt(imp.rotulo || 'Impacto não estimado')), cinza('Sem base medida suficiente para estimar um valor, nenhum valor foi estimado.')]
  return [
    bloco('callout', { icon: { type: 'emoji', emoji: '⚠️' }, color: p.gravidade === 'critico' ? 'red_background' : 'orange_background',
      rich_text: [...rt(t.rotulo || p.rotulo, { bold: true }), ...rt(com), ...rt('\nPonto em aberto que pode afetar o andamento das entregas.')] }),
    ...secao('O que está pendente', par(rt(fato))),
    ...secao('Por que importa', par(rt(t.por_que_importa))),
    ...secao('Se atrasar', par(rt(t.efeito_se_atrasar))),
    ...secao('Possível impacto', ...impacto),
    ...secao('O que precisamos', par(rt(t.o_que_precisamos))),
    ...secao('O que a Place2u faz ao receber', par(rt(t.o_que_fazemos))),
    bloco('divider', {}),
    cinza(`Informação factual datada em ${dm(hoje)} às ${hora}; a leitura de impacto é uma estimativa, não uma garantia.`),
  ]
}

// Reconferência AO VIVO (a fiação real injeta as leituras; aqui só a decisão). Devolve { estado: 'confirmado'|'negativo'|'indisponivel', motivo? }.
//  • estoque: relê o disponível de até 3 anúncios citados e recalcula a cobertura com as vendas/dia medidas;
//  • tarefa: confere que as tarefas mais antigas ainda estão em «Aguardando Devolutiva do Cliente» (dependencia_cliente);
//  • acesso à conta: a conta ainda não responde; registro manual: ainda aberto no banco.
// Qualquer exceção das leituras = indisponível (o chamador mantém o alerta pendente e tenta de novo; nunca descarta por falha de leitura).
export function criarReconferencia({ handle, estoqueAoVivo, statusTarefasAoVivo, contaAoVivo, limiares = {} }) {
  const L = { cobertura_critica_dias: 5, cobertura_atencao_dias: 10, curvas_alerta: ['A'], ...limiares }
  const corte = a => L.curvas_alerta.includes(a.curva) ? L.cobertura_critica_dias : L.cobertura_atencao_dias
  return async function reconferir(cliente, p, { ids = [] } = {}) {
    if (p.fonte === 'registro') {
      const id = Number(String(ids[0] ?? '').replace(/^r/, ''))
      const r = Number.isInteger(id) ? handle.prepare('SELECT resolvida_em FROM pendencia_cliente WHERE id = ? AND cliente = ?').get(id, cliente) : null
      return r && !r.resolvida_em ? { estado: 'confirmado' } : { estado: 'negativo', motivo: 'registro_resolvido' }
    }
    if (p.fonte === 'tarefa') {
      const alvo = ids.slice(0, 5)
      if (!alvo.length || !statusTarefasAoVivo) return { estado: 'indisponivel', motivo: 'sem_tarefas' }
      const vivo = await statusTarefasAoVivo(alvo); let lidos = 0
      for (const id of alvo) { const s = vivo.get(id); if (!s) continue; lidos++; if (s === 'dependencia_cliente') return { estado: 'confirmado' } }
      return lidos ? { estado: 'negativo', motivo: 'tarefa_fora_da_dependencia' } : { estado: 'indisponivel', motivo: 'sem_leitura' }
    }
    if (p.item === 'acesso_conta') {
      if (!contaAoVivo) return { estado: 'indisponivel', motivo: 'sem_leitura' }
      return (await contaAoVivo(cliente)) === 'erro' ? { estado: 'confirmado' } : { estado: 'negativo', motivo: 'conta_respondeu' }
    }
    if (p.item === 'estoque_curva_a') {
      const todos = p.anuncios || [], criticos = todos.filter(a => L.curvas_alerta.includes(a.curva) && a.cobertura_dias < L.cobertura_critica_dias)
      const alvo = [...criticos, ...todos.filter(a => !criticos.includes(a))].slice(0, 3)
      if (!alvo.length || !estoqueAoVivo) return { estado: 'indisponivel', motivo: 'sem_anuncios' }
      const vivo = await estoqueAoVivo(cliente, alvo.map(a => a.id)); let lidos = 0
      for (const a of alvo) {
        const v = vivo.get(a.id)
        if (!v || !Number.isFinite(v.disponivel) || !(a.vendas_dia > 0)) continue
        lidos++
        if (v.status !== 'closed' && v.disponivel / a.vendas_dia < corte(a)) return { estado: 'confirmado' }
      }
      return lidos ? { estado: 'negativo', motivo: 'estoque_normalizado' } : { estado: 'indisponivel', motivo: 'sem_leitura' }
    }
    return { estado: 'indisponivel', motivo: 'fonte_sem_reconferencia' }
  }
}

// ── fábrica ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// deps: handle (com SCHEMA_ALERTA e as tabelas relatorio_*), notion { req }, pendencias { avaliar(cliente) → { itens, tarefas }, explicar(p), cat? },
//       destinos { fontes, resolverPaginaCliente, acharInformacoesDb, invalidar } (os mesmos do relatório), nomesInternos(cliente) → string[] (sync/async),
//       reconferir(cliente, pendencia, { ids }) → { estado } (criarReconferencia) — OBRIGATÓRIA, agora() ISO, hoje?()/hora?() (padrão: agora() em cfg.fuso, via Intl),
//       validarPor(nome) → nome|'', notificar(obj), log(nivel, msg), elegiveis() → [{ cliente, status }] (só status explícito em cfg.status_elegiveis), clienteCanonico?(nome),
//       cfg (config/alerta-cliente.json), estado? (padrão: sync_estado do handle), ceder? (cede o laço de eventos entre clientes na varredura)
export function criarAlertaCliente({ handle, notion, pendencias, destinos, nomesInternos = () => [], reconferir, agora = () => new Date().toISOString(), hoje, hora,
  validarPor = () => '', notificar = () => {}, log = () => {}, elegiveis = () => [], clienteCanonico, cfg = lerConfig(), estado, ceder = () => new Promise(r => setImmediate(r)) }) {
  if (typeof reconferir !== 'function') throw new Error('alerta-cliente: a reconferência ao vivo (reconferir) é obrigatória')
  handle.exec(SCHEMA_ALERTA)
  estado = estado || estadoDeHandle(handle)
  const fuso = cfg.fuso
  hoje = hoje || (() => dataNoFuso(Date.parse(agora()), fuso))
  hora = hora || (() => horaNoFuso(Date.parse(agora()), fuso))
  const agoraMs = () => Date.parse(agora())
  const nt = criarRelatorioNotion({ notion, estado, fontes: destinos.fontes, resolverPaginaCliente: destinos.resolverPaginaCliente, acharInformacoesDb: destinos.acharInformacoesDb, invalidar: destinos.invalidar, agora })
  const codigoLog = e => e?.status !== undefined && e?.status !== null ? `notion_${e.status}` : `${e?.name || 'Error'}: ${String(e?.message ?? '').replace(/["'`][\s\S]*$/, '…').slice(0, 100)}`
  const avisar = obj => { try { notificar(obj) } catch (e) { try { log('aviso', `alertas: o aviso «${String(obj?.tipo ?? '').slice(0, 40)}» não foi gravado (${codigoLog(e)})`) } catch { /* aviso é melhor esforço */ } } }
  const ehRede = e => ['TimeoutError', 'AbortError'].includes(e?.name) || (e instanceof TypeError && /fetch|network|socket/i.test(String(e.message)))

  // mensagens FIXAS por motivo (a API devolve o texto; o código fica em motivo_codigo). Nunca texto do Notion, nunca eco de dado.
  const MSG = {
    interruptor_desligado: 'O envio automático de alertas está desligado: revise e envie manualmente, ou ligue o interruptor.',
    nao_liberado: 'O cliente ainda não foi liberado para envios automáticos (liberação do relatório semanal).',
    programacao_pausada: 'A programação de relatórios deste cliente está pausada.',
    cliente_inelegivel: 'Só clientes Ativos recebem alertas; mude o status na central.',
    sem_relatorio_anterior: 'O cliente ainda não recebeu nenhum relatório: o primeiro contato nunca é um alerta.',
    bases_nao_verificadas: 'Há páginas do Notion ainda não verificadas: rode «Verificar bases» antes do envio automático.',
    fora_da_janela: `Fora da janela de envio (${cfg.dias_uteis_apenas ? 'dias úteis, ' : ''}${cfg.hora_inicio} às ${cfg.hora_fim}): sai na próxima abertura.`,
    cooldown: `Já houve um alerta deste assunto para este cliente nos últimos ${cfg.cooldown_dias} dias: o assunto segue no próximo relatório.`,
    teto_semanal: `Limite de ${cfg.teto_semanal_por_cliente} alertas por semana deste cliente atingido: sai quando abrir espaço.`,
    teto_diario: `Limite de ${cfg.teto_diario_paginas} alertas por dia atingido: sai amanhã.`,
    reconferencia_negativa: 'A conferência ao vivo não confirmou a pendência: nada foi enviado.',
    reconferencia_indisponivel: 'Não foi possível conferir ao vivo agora: o sistema tenta de novo.',
    sem_confirmacao_atual: 'A pendência não está crítica na última leitura: o alerta só sai se voltar a ser.',
    resolvido_antes: 'A pendência não está mais ativa: nada foi enviado.',
    alinhado: 'Coberta por um alinhamento com o cliente: o alerta não sai (nem é dado como resolvido) enquanto o alinhamento valer.',
    categoria_ausente: `A coluna Secção da base Informações deste cliente não tem a opção «${CATEGORIA}» (o sistema não cria opção nova): crie a opção no Notion.`,
    conteudo: 'O texto do alerta não passou na auditoria de conteúdo — nada foi enviado.',
    adotado: 'A página já existia no Notion do cliente e foi reaproveitada.',
    erro_interno: 'Falha interna ao enviar o alerta — veja o log do servidor.',
    notion_5xx: 'Notion indisponível agora: o sistema tenta de novo.', notion_rede: 'Notion indisponível agora: o sistema tenta de novo.', notion_429: 'Notion indisponível agora: o sistema tenta de novo.',
    notion_0: MSG_NOTION[0], notion_400: MSG_NOTION[400], notion_401: MSG_NOTION[401], notion_403: MSG_NOTION[403], notion_404: MSG_NOTION[404], notion_payload: MSG_NOTION.payload,
    ...MSG_DESTINO,
  }
  const textoMotivo = cod => { const k = String(cod ?? '').split(':')[0]; return MSG[k] || (/^notion_5\d\d$/.test(k) ? MSG.notion_5xx : k ? 'Motivo registrado no log do servidor.' : '') }

  // ── banco ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const selId = handle.prepare('SELECT * FROM alerta_cliente WHERE id = ?')
  const abertosDe = handle.prepare(`SELECT * FROM alerta_cliente WHERE cliente = ? AND estado IN (${ABERTOS.map(() => '?').join(',')}) ORDER BY id DESC`)
  const insAlerta = handle.prepare(`INSERT INTO alerta_cliente (cliente, item, canal, rotulo, canal_rotulo, fonte, gravidade, assinatura, ids, estado, criado_em, atualizado_em)
    VALUES (@cliente, @item, @canal, @rotulo, @canal_rotulo, @fonte, @gravidade, @assinatura, @ids, 'pendente', @em, @em)`)
  function atualizar(id, campos) {
    const ks = Object.keys(campos).filter(k => COLUNAS.includes(k))
    if (!ks.length) return
    handle.prepare(`UPDATE alerta_cliente SET ${ks.map(k => `${k} = @${k}`).join(', ')}, atualizado_em = @atualizado_em WHERE id = @id`).run({ ...Object.fromEntries(ks.map(k => [k, campos[k]])), id, atualizado_em: agora() })
  }
  const cooldownAtivo = (cliente, item, id) => !!handle.prepare("SELECT 1 FROM alerta_cliente WHERE cliente = ? AND item = ? AND id <> ? AND enviado_em <> '' AND enviado_em >= ? LIMIT 1")
    .get(cliente, item, id, new Date(agoraMs() - cfg.cooldown_dias * 86_400_000).toISOString())
  const enviadosSemana = cliente => handle.prepare("SELECT COUNT(*) n FROM alerta_cliente WHERE cliente = ? AND enviado_em <> '' AND enviado_em >= ?").get(cliente, new Date(agoraMs() - 7 * 86_400_000).toISOString()).n
  const enviadosHoje = () => handle.prepare("SELECT enviado_em FROM alerta_cliente WHERE enviado_em >= ?").all(new Date(agoraMs() - 48 * 3600e3).toISOString()).filter(r => dataNoFuso(Date.parse(r.enviado_em), fuso) === hoje()).length

  // ── clientes e salvaguardas locais ───────────────────────────────────────────────────────────────────────────────
  const chaveNome = nome => normNome(nome).trim()
  function mapaElegiveis() {                                      // FALHA FECHADA: só status EXPLÍCITO em cfg.status_elegiveis
    const st = new Set(cfg.status_elegiveis.map(s => chaveNome(s))), m = new Map()
    for (const x of elegiveis() || []) {
      if (!x || typeof x !== 'object' || typeof x.cliente !== 'string' || !x.cliente.trim() || ehProspecto(x.cliente)) continue
      if (typeof x.status !== 'string' || !st.has(chaveNome(x.status))) continue
      m.set(chaveNome(x.cliente), x.cliente)
    }
    return m
  }
  const progDe = cliente => handle.prepare('SELECT * FROM relatorio_programacao WHERE cliente = ?').get(cliente) || handle.prepare('SELECT * FROM relatorio_programacao').all().find(p => chaveNome(p.cliente) === chaveNome(cliente)) || null
  const recebeuRelatorio = cliente => !!handle.prepare("SELECT 1 FROM relatorio_envio WHERE cliente = ? AND estado IN ('enviado','adotado') LIMIT 1").get(cliente)
  // quem divide a MESMA página do Notion só é descoberto pelo cache `pagina_cliente:` dos demais clientes: cache vazio = DESCONHECIDO (mesma regra do agendador de relatórios)
  function paginasDesconhecidas(elig) {
    if (!estado.listar) return new Set()
    const cache = new Map(estado.listar('pagina_cliente:').map(r => [r.chave.slice('pagina_cliente:'.length), r.valor]))
    const diags = new Map(); for (const r of estado.listar('rel_diag:')) { try { diags.set(r.chave.slice('rel_diag:'.length), JSON.parse(r.valor)) } catch { /* diag corrompido = não verificado */ } }
    return new Set([...elig.values()].filter(cli => !/^[0-9a-f-]{32,36}$/i.test(String(cache.get(cli) || '')) && !['sem_pagina', 'pagina_invalida'].includes(diags.get(cli)?.destino)))
  }
  const pend = (motivo, extra = {}) => ({ estado: 'pendente', motivo, ...extra })
  const sup = motivo => ({ estado: 'suprimido', motivo })
  // ordem: o que não precisa de rede primeiro (evita ler o Notion de madrugada para um alerta que só sai às 08:00). `manual` ignora interruptor, janela e liberação (o líder decide).
  function guardasLocais(row, o) {
    const manual = o.origem === 'manual'
    if (!manual) {
      if (!ligado()) return pend('interruptor_desligado')
      const p = progDe(row.cliente)
      if (!p || !p.ativado_por) return pend('nao_liberado')
      if (p.pausado_motivo) return pend('programacao_pausada')
    }
    if (!(o.elig || mapaElegiveis()).has(chaveNome(row.cliente))) return pend('cliente_inelegivel')
    if (!recebeuRelatorio(row.cliente)) return pend('sem_relatorio_anterior')
    if (!manual && !dentroDaJanela({ hoje: hoje(), hora: hora() }, cfg)) return pend('fora_da_janela')
    if (cooldownAtivo(row.cliente, row.item, row.id)) return sup('cooldown')
    if (enviadosSemana(row.cliente) >= cfg.teto_semanal_por_cliente) return pend('teto_semanal')
    if (enviadosHoje() >= cfg.teto_diario_paginas) return pend('teto_diario')
    return null
  }

  // ── interruptor próprio (sync_estado.alerta_auto; NASCE DESLIGADO) ──────────────────────────────────────────────
  function ligado() { const v = estado.get('alerta_auto'); return v === undefined || v === null ? cfg.automatico_ligado === true : v === 'ligado' }
  const exigirPor = bruto => {
    if (!str(bruto)) throw erro('informe "por" (quem está enviando — líder ou consultor)')
    const p = validarPor(str(bruto)); if (!p) throw erro('somente líder ou consultor da central envia alerta ao cliente', 403)
    return String(p).slice(0, 80)
  }
  function agendador(body = {}) {
    if (typeof body.ligado !== 'boolean') throw erro('informe "ligado" (verdadeiro ou falso)')
    const por = exigirPor(body.por)
    estado.set('alerta_auto', body.ligado ? 'ligado' : 'desligado')
    estado.set('alerta_auto_por', `${por} · ${agora()}`)
    log('info', `alertas automáticos ao Notion do cliente ${body.ligado ? 'LIGADOS' : 'DESLIGADOS'} por ${por}`)
    return { ok: true, ligado: body.ligado }
  }

  // ── avaliação ────────────────────────────────────────────────────────────────────────────────────────────────────
  const gatilho = p => cfg.gatilhos.gravidades.includes(p.gravidade) && !cfg.gatilhos.excluir_itens.includes(p.item)
  function analisar(av) {
    const crit = new Map(), existe = new Set()
    for (const p of av.itens || []) {
      const k = `${p.item}|${p.canal}`; existe.add(k)
      if (!gatilho(p)) continue
      const rel = idsDe(p, av.tarefas), ids = [...rel].sort()
      crit.set(k, { p, rel, ids, assinatura: assinaturaDe(p, ids) })
    }
    return { crit, existe }
  }
  const fresco = row => analisar(pendencias.avaliar(row.cliente)).crit.get(`${row.item}|${row.canal}`) || null

  // ── desfechos ────────────────────────────────────────────────────────────────────────────────────────────────────
  const backoffMin = n => Math.min(cfg.backoff_base_min * 2 ** Math.max(0, n - 1), cfg.backoff_max_min)
  function aplicar(row, d, o = {}) {
    const agoraIso = agora()
    if (d.estado === 'enviado') {
      atualizar(row.id, { estado: 'enviado', motivo: d.adotado ? 'adotado' : '', titulo: d.titulo, page_id: d.pg.id, page_url: d.pg.url, hash: d.hash, origem: o.origem || 'automatico', por: o.por || 'sistema',
        enviado_em: agoraIso, incerto: d.incerto ? 1 : 0, tentativas: 0, tentar_apos: '' })
      return
    }
    const campos = { estado: d.estado, motivo: d.motivo || '' }
    if (d.estado === 'falhou' || d.backoff) { const n = (row.tentativas || 0) + 1; campos.tentativas = n; campos.tentar_apos = new Date(agoraMs() + backoffMin(n) * 60_000).toISOString() }
    if (d.estado === 'falhou' && d.incerto) campos.incerto = 1
    if (row.estado !== campos.estado || row.motivo !== campos.motivo || campos.tentar_apos) atualizar(row.id, campos)
  }
  function desfechoDeErro(e, cliente) {
    if (e?.codigo === 'titulo_invalido' || e?.codigo === 'destino_invalido') return { estado: 'bloqueado', motivo: 'conteudo:titulo' }
    if (!(e?.status !== undefined || ehRede(e) || e?.codigo)) { log('erro', `alertas ${cliente}: erro_interno ${codigoLog(e)}`); return { estado: 'falhou', motivo: 'erro_interno' } }   // bug nosso, não queda do Notion: tenta de novo com backoff, sem acionar o disjuntor do Notion
    const c = classificarErro(e)
    log('erro', `alertas ${cliente}: ${c.codigo}`)
    if (c.codigo === 'notion_401' || c.codigo === 'notion_0') return { estado: 'pendente', motivo: c.codigo, credencial: true }
    if (!c.retentavel) return { estado: 'bloqueado', motivo: c.codigo }
    return { estado: 'falhou', motivo: c.codigo, infra: true, incerto: !!e?.incerto }
  }

  // ── passos de rede ───────────────────────────────────────────────────────────────────────────────────────────────
  async function resolverDestino(row, o) {
    const d = await nt.destinoDe(row.cliente)
    if (!['ok', 'destino_compartilhado'].includes(d.estado)) return { imp: pend(d.estado) }
    const compartilhado = d.estado === 'destino_compartilhado'
    if (compartilhado && !(o.origem === 'manual' && o.confirmar_destino === true)) return { imp: pend('destino_compartilhado') }
    if (decidirCategoria(d.esquema, { categoria: cfg.categoria }).estado !== 'ok') return { imp: pend('categoria_ausente') }   // só a opção que JÁ existe: nunca cria categoria
    return { destino: d, compartilhado }
  }
  async function reconferirAoVivo(row, X) {
    let r
    try { r = await reconferir(row.cliente, X.p, { ids: X.rel }) } catch { return pend('reconferencia_indisponivel', { backoff: true }) }
    const est = r === true ? 'confirmado' : r === false ? 'negativo' : r?.estado
    if (est === 'confirmado') return null
    if (est === 'negativo') return sup('reconferencia_negativa')
    return pend('reconferencia_indisponivel', { backoff: true })
  }
  async function montarConteudo(row, X, compartilhado) {
    const texto = pendencias.explicar?.(X.p) || X.p
    const titulo = tituloFinal(`${PREFIXO_ALERTA}${tema(X.p)} · ${dma(hoje())}`, { cliente: row.cliente, compartilhado })
    const blocos = alertaParaBlocos(X.p, { texto, hoje: hoje(), hora: hora() })
    return { titulo, blocos, violacoes: await auditar(row.cliente, titulo, blocos) }
  }
  async function auditar(cliente, titulo, blocos) {
    const nomes = (await nomesInternos(cliente)) || [], opt = { nomesInternos: nomes, permitidos: [cliente] }
    const v = [...auditarTexto(titulo, opt), ...auditarBlocos(blocos, opt)]
    if (!tituloAlertaOk(titulo)) v.push({ codigo: 'titulo', bloco: '', trecho: '' })
    return v
  }
  // idempotência por título exato; 5xx/timeout na criação NUNCA reenvia (consulta por título antes de qualquer nova tentativa)
  async function escrever(destino, titulo, blocos) {
    const achadas = await nt.acharPorTitulo(destino, titulo)
    if (achadas.length) return { pg: achadas[0], adotado: true, incerto: false }
    try {
      const pg = await nt.criar({ destino, titulo, blocos, validarTitulo: tituloAlertaOk, icone: cfg.icone, categoria: cfg.categoria, statusPreferido: cfg.status_aberto })
      return { pg, adotado: false, incerto: false }
    } catch (e) {
      if (!classificarErro(e).ambiguo) throw e
      let novas = []; try { novas = await nt.acharPorTitulo(destino, titulo) } catch { /* a consulta também falhou */ }
      if (!novas.length) throw Object.assign(e, { incerto: true })
      return { pg: novas[0], adotado: true, incerto: true }
    }
  }

  // Executa as salvaguardas na ordem e, passando todas, escreve. `X` = avaliação FRESCA { p, rel, ids, assinatura }; `o` = { origem, por, confirmar_destino, elig, conteudo? }
  // (conteudo = {titulo, blocos, compartilhado} da prévia manual: o que o líder leu é o que sai). Devolve um desfecho; nunca lança.
  async function entregar(row, X, o) {
    try {
      const g = guardasLocais(row, o); if (g) return g
      if (o.origem !== 'manual') { const elig = o.elig || mapaElegiveis(); if ([...paginasDesconhecidas(elig)].some(c => c !== row.cliente)) return pend('bases_nao_verificadas') }
      const r = await resolverDestino(row, o); if (r.imp) return r.imp
      const rc = await reconferirAoVivo(row, X); if (rc) return rc
      let c = o.conteudo
      if (c) {
        if (c.compartilhado !== r.compartilhado) return { estado: 'pendente', motivo: 'destino_compartilhado' }
        c = { ...c, violacoes: await auditar(row.cliente, c.titulo, c.blocos) }                 // reauditoria do que a prévia mostrou
      } else c = await montarConteudo(row, X, r.compartilhado)
      if (c.violacoes.length) { log('aviso', `alertas ${row.cliente}: bloqueado conteudo ${codigosDe(c.violacoes).join(',')}`); return { estado: 'bloqueado', motivo: `conteudo:${codigosDe(c.violacoes).join(',')}` } }
      const w = await escrever(r.destino, c.titulo, c.blocos)
      log('info', `alertas ${row.cliente}: ${w.adotado ? 'adotado' : 'enviado'} (${o.origem})`)
      return { estado: 'enviado', adotado: w.adotado, incerto: w.incerto, pg: w.pg, titulo: c.titulo, hash: sha(JSON.stringify(c.blocos)) }
    } catch (e) { return desfechoDeErro(e, row.cliente) }
  }

  // ── varredura (timer de 10 min + fim da coleta diária) ───────────────────────────────────────────────────────────
  const emVoo = new Set()
  let rodando = false
  const tipoAviso = p => p.item === 'estoque_curva_a' && p.fonte === 'medido' ? 'alerta_estoque' : p.item === 'acesso_conta' ? 'alerta_acesso' : p.fonte === 'tarefa' ? 'alerta_dependencia' : 'alerta_pendencia'
  const linkCliente = cliente => `/cliente?cliente=${encodeURIComponent(cliente)}&aba=resumo`

  function emitirAvisos(novos, res) {
    const grupos = new Map()
    for (const { cliente, p } of novos) { const k = `${cliente}|${tipoAviso(p)}`; (grupos.get(k) || grupos.set(k, { cliente, tipo: tipoAviso(p), ps: [] }).get(k)).ps.push(p) }
    const lista = [...grupos.values()], max = cfg.max_avisos_por_varredura
    const destino = ligado() ? 'A página de alerta será criada no Notion do cliente na janela de envio, se as salvaguardas permitirem.' : 'Envio automático desligado: revise e envie pela ficha do cliente.'
    for (const g of lista.slice(0, max)) {
      avisar({ tipo: g.tipo, nivel: 'erro', titulo: `Pendência crítica do cliente: ${g.cliente}`,
        corpo: `${g.ps.map(p => `${p.rotulo} (${p.canal_rotulo}): ${p.evidencia}${p.fonte === 'registro' && p.detalhe_interno ? ` Detalhe interno: ${p.detalhe_interno}.` : ''}`).join(' | ')} ${destino}`,
        cliente: g.cliente, link: linkCliente(g.cliente), dedupeMin: cfg.aviso_dedupe_min })
      res.avisos++
    }
    const resto = lista.slice(max)
    if (resto.length) {
      const nomes = [...new Set(resto.map(g => g.cliente))]
      avisar({ tipo: 'alerta_pendencia', nivel: 'erro', titulo: `${nomes.length} cliente${nomes.length === 1 ? '' : 's'} com pendência crítica`,
        corpo: `Além dos avisos acima: ${nomes.slice(0, 12).join(', ')}${nomes.length > 12 ? ` e mais ${nomes.length - 12}` : ''}. Abra a lista de alertas para revisar.`, cliente: '', link: '/planos', dedupeMin: 120 })
      res.avisos++
    }
  }

  // um cliente: resolve o que sumiu, detecta assinatura nova (cria/atualiza linha) e devolve as linhas candidatas à entrega
  // pendência que sumiu do avaliador porque passou a ser coberta por alinhamento com o cliente (av.alinhadas_itens) NÃO resolveu: fica 'suprimido' motivo 'alinhado',
  // sem «Concluído» no Notion e sem aviso de resolução; quando o alinhamento acaba e a pendência persiste, a mesma assinatura reabre (enviado se a página existe, senão pendente)
  const alinhadoAberto = r => r.estado === 'suprimido' && r.motivo === 'alinhado'
  function processarCliente(cliente, av, novos, fila, res) {
    const { crit, existe } = analisar(av), alinhadas = new Set(av?.alinhadas_itens || [])
    const abertos = abertosDe.all(cliente, ...ABERTOS)
    for (const r of abertos) {
      if (existe.has(`${r.item}|${r.canal}`)) continue
      if (alinhadas.has(`${r.item}|${r.canal}`)) { if (!alinhadoAberto(r)) atualizar(r.id, { estado: 'suprimido', motivo: 'alinhado' }); continue }
      const saiu = r.page_id && (r.estado === 'enviado' || alinhadoAberto(r))     // a página existe no Notion do cliente (enviada antes de ser alinhada)
      atualizar(r.id, { estado: 'resolvido', resolvido_em: agora(), concluir_pendente: saiu ? 1 : 0 })
      res.resolvidos++
      if (saiu && cfg.avisar_resolucao) avisar({ tipo: 'alerta_resolvido', nivel: 'sucesso', titulo: `Pendência resolvida: ${cliente}`, corpo: `${r.rotulo} (${r.canal_rotulo}) deixou de aparecer nas leituras.`, cliente, link: linkCliente(cliente), dedupeMin: 60 })
    }
    for (const [k, X] of crit) {
      const mine = abertosDe.all(cliente, ...ABERTOS).filter(r => `${r.item}|${r.canal}` === k)
      let alvo = mine.find(r => r.assinatura === X.assinatura)
      if (!alvo) {
        const ult = mine[0]
        const sub = ult && RANK[X.p.gravidade] >= RANK[ult.gravidade] && X.ids.every(x => JSON.parse(ult.ids || '[]').includes(x))   // encolheu sem piorar (uma tarefa saiu): mesmo alerta, sem novo aviso
        if (sub) { atualizar(ult.id, { assinatura: X.assinatura, ids: JSON.stringify(X.ids) }); alvo = ult }
        else {
          const novo = { fonte: X.p.fonte, gravidade: X.p.gravidade, assinatura: X.assinatura, ids: JSON.stringify(X.ids), rotulo: X.p.rotulo, canal_rotulo: X.p.canal_rotulo }
          if (ult && ['pendente', 'falhou'].includes(ult.estado)) { atualizar(ult.id, { ...novo, estado: 'pendente', motivo: '', tentativas: 0, tentar_apos: '', titulo: '' }); alvo = ult }
          else alvo = selId.get(Number(insAlerta.run({ cliente, item: X.p.item, canal: X.p.canal, ...novo, em: agora() }).lastInsertRowid))
          novos.push({ cliente, p: X.p }); res.novos++
        }
      }
      alvo = selId.get(alvo.id)
      if (alinhadoAberto(alvo)) { atualizar(alvo.id, alvo.page_id ? { estado: 'enviado', motivo: '' } : { estado: 'pendente', motivo: '' }); alvo = selId.get(alvo.id) }   // o alinhamento acabou
      if (['pendente', 'falhou'].includes(alvo.estado) && !(alvo.tentar_apos && Date.parse(alvo.tentar_apos) > agoraMs())) fila.push({ id: alvo.id, X })
    }
    for (const r of abertos) if (existe.has(`${r.item}|${r.canal}`) && !crit.has(`${r.item}|${r.canal}`) && r.estado === 'pendente' && r.motivo !== 'sem_confirmacao_atual') atualizar(r.id, { motivo: 'sem_confirmacao_atual' })
  }

  async function concluirStatus(res) {                            // página já enviada cuja pendência sumiu: Status «Concluído» (só opção existente; nunca cria)
    for (const r of handle.prepare("SELECT * FROM alerta_cliente WHERE estado = 'resolvido' AND concluir_pendente = 1 AND page_id <> '' ORDER BY id LIMIT 20").all()) {
      if (!ligado()) return
      try { await nt.atualizarStatus(r.page_id, cfg.status_final); atualizar(r.id, { concluir_pendente: 0 }); res.concluidos++ } catch (e) {
        const d = desfechoDeErro(e, r.cliente)
        if (d.credencial) { res.interrompido = res.interrompido || 'credencial'; return }
        if (d.estado === 'bloqueado') atualizar(r.id, { concluir_pendente: 0 })   // página sem acesso/removida: não adianta repetir
        else return                                                              // Notion fora do ar: tenta de novo na próxima varredura
      }
    }
  }

  async function varrer({ origem = 'timer' } = {}) {
    if (rodando) return { pulou: 'em_andamento' }
    rodando = true
    const res = { pulou: '', origem, avaliados: 0, falhas_avaliacao: 0, novos: 0, resolvidos: 0, avisos: 0, enviados: 0, adotados: 0, pendentes: 0, suprimidos: 0, bloqueados: 0, falhou: 0, concluidos: 0, interrompido: '' }
    try {
      const elig = mapaElegiveis(), novos = [], fila = []
      for (const cliente of [...elig.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        try { processarCliente(cliente, pendencias.avaliar(cliente), novos, fila, res); res.avaliados++ } catch (e) {
          res.falhas_avaliacao++; log('erro', `alertas ${cliente}: avaliação ${codigoLog(e)}`)
        }
        await ceder()
      }
      emitirAvisos(novos, res)
      fila.sort((a, b) => a.id - b.id)
      let seguidasInfra = 0
      for (const { id, X } of fila) {
        if (res.interrompido) break
        const row = selId.get(id)
        if (!row || !['pendente', 'falhou'].includes(row.estado) || emVoo.has(row.cliente)) continue
        emVoo.add(row.cliente)
        let d; try { d = await entregar(row, X, { origem: 'automatico', elig }) } finally { emVoo.delete(row.cliente) }
        aplicar(row, d, { origem: 'automatico', por: 'sistema' })
        res[{ enviado: d.adotado ? 'adotados' : 'enviados', pendente: 'pendentes', suprimido: 'suprimidos', bloqueado: 'bloqueados', falhou: 'falhou' }[d.estado]]++
        if (d.credencial) {
          res.interrompido = 'credencial'
          avisar({ tipo: 'alerta_falhou:notion_401', nivel: 'erro', titulo: 'Alertas ao cliente não enviados: o Notion recusou o token', corpo: textoMotivo(d.motivo), link: '/planos', dedupeMin: 1440 })
        } else if (d.infra) {
          if (++seguidasInfra >= 3) {
            res.interrompido = 'disjuntor'
            avisar({ tipo: 'alerta_falhou:disjuntor', nivel: 'alerta', titulo: 'Alertas ao cliente: Notion indisponível', corpo: `${seguidasInfra} envios seguidos falharam por indisponibilidade do Notion, da rede ou tempo esgotado. Nada foi pausado; o sistema tenta de novo no próximo ciclo.`, link: '/planos', dedupeMin: 120 })
          }
        } else seguidasInfra = 0
      }
      if (!res.interrompido) await concluirStatus(res)
      if (res.novos || res.resolvidos || res.enviados || res.adotados || res.bloqueados || res.falhas_avaliacao) log('info', `alertas (${origem}): ${res.avaliados} cliente(s), ${res.novos} novo(s), ${res.enviados + res.adotados} enviado(s), ${res.resolvidos} resolvido(s), ${res.bloqueados} bloqueado(s)${res.interrompido ? ` · interrompido (${res.interrompido})` : ''}`)
    } finally { rodando = false }
    return res
  }

  // ── listagens ────────────────────────────────────────────────────────────────────────────────────────────────────
  const publico = r => ({
    id: r.id, item: r.item, rotulo: r.rotulo, canal: r.canal, canal_rotulo: r.canal_rotulo, gravidade: r.gravidade, estado: r.estado,
    motivo: r.estado === 'resolvido' ? '' : textoMotivo(r.motivo), motivo_codigo: r.estado === 'resolvido' ? '' : r.motivo,
    titulo: r.titulo, page_url: r.page_url, criado_em: r.criado_em, enviado_em: r.enviado_em, resolvido_em: r.resolvido_em, assinatura: r.assinatura,
  })
  const exigirCliente = bruto => {
    if (!str(bruto)) throw erro('informe "cliente"')
    const s = str(bruto); if (ehProspecto(s) || s.length > 200) throw erro('cliente não encontrado na central', 404)
    const c = clienteCanonico ? clienteCanonico(s) : mapaElegiveis().get(chaveNome(s))
    if (!c) throw erro('cliente não encontrado na central', 404)
    return c
  }
  function listarCliente(bruto) {
    const cliente = exigirCliente(bruto)
    return { itens: handle.prepare('SELECT * FROM alerta_cliente WHERE cliente = ? ORDER BY id DESC LIMIT 100').all(cliente).map(publico), automatico: { ligado: ligado() } }
  }
  function listarPendentes() {
    const sete = new Date(agoraMs() - 7 * 86_400_000).toISOString()
    const linhas = handle.prepare("SELECT * FROM alerta_cliente WHERE estado IN ('pendente','falhou','bloqueado') ORDER BY cliente COLLATE NOCASE, id DESC LIMIT 500").all()
    return {
      itens: linhas.map(r => ({ cliente: r.cliente, ...publico(r) })), automatico: { ligado: ligado() },
      resumo: { pendentes: linhas.filter(r => r.estado !== 'bloqueado').length, enviados_7d: handle.prepare("SELECT COUNT(*) n FROM alerta_cliente WHERE enviado_em <> '' AND enviado_em >= ?").get(sete).n, bloqueados: linhas.filter(r => r.estado === 'bloqueado').length },
    }
  }

  // ── envio MANUAL: prévia → confirmar (molde de /api/relatorio/enviar) ──────────────────────────────────────────
  const previas = new Map()
  const limparPrevias = () => { const t = agoraMs(); for (const [id, p] of previas) if (p.expira <= t) previas.delete(id) }
  const impedimento = (estadoI, motivo, extra = {}) => ({ ok: false, estado: estadoI, motivo, mensagem: textoMotivo(motivo), ...extra })
  const respostaDe = (d, row) => {
    if (d.estado === 'enviado') return { ok: true, previa: false, estado: d.adotado ? 'adotado' : 'enviado', url: d.pg.url }
    if (d.estado === 'bloqueado' && /^conteudo/.test(d.motivo)) return impedimento('bloqueado', 'conteudo')
    if (d.estado === 'falhou') return impedimento('falhou', d.motivo, { retentavel: true, incerto: !!d.incerto })
    return impedimento(d.estado === 'bloqueado' ? 'bloqueado' : d.motivo.split(':')[0], d.motivo)
  }
  async function enviar(body = {}) {
    const idN = typeof body.id === 'number' ? body.id : /^\d{1,9}$/.test(str(body.id)) ? Number(str(body.id)) : NaN
    if (!Number.isInteger(idN) || idN < 1) throw erro('informe "id" (número do alerta)')
    const row = selId.get(idN)
    if (!row) throw erro('alerta não encontrado', 404)
    if (row.estado === 'enviado') return { ok: false, estado: 'enviado', motivo: 'ja_enviado', mensagem: 'este alerta já foi enviado ao Notion do cliente', url: row.page_url }
    if (row.estado === 'resolvido') return impedimento('resolvido', 'resolvido_antes')
    const o = { origem: 'manual', confirmar_destino: body.confirmar_destino === true, elig: mapaElegiveis() }
    const confirmando = body.confirmar === true                       // estrito: "true" (string), 1, "sim"… são prévia
    let por = '', pv = null
    if (confirmando) {                                                // valida o que não exige ler dados antes de qualquer trabalho pesado
      por = exigirPor(body.por)
      if (!str(body.previa_id)) throw erro('informe "previa_id" (gere a prévia antes de confirmar)')
      limparPrevias()
      pv = previas.get(str(body.previa_id))
      if (!pv || pv.alerta !== row.id) throw erro('prévia expirada — gere de novo', 409)
      if (pv.dia !== hoje()) throw erro('o dia mudou desde a prévia — gere de novo', 409)
    }
    const X = fresco(row)
    if (!X) return impedimento('sem_confirmacao_atual', 'sem_confirmacao_atual')

    if (!confirmando) {                                              // PRÉVIA: leitura pura (nada no banco, nada escrito no Notion, sem reconferência ao vivo)
      const g = guardasLocais(row, o); if (g) return impedimento(g.motivo, g.motivo)
      let r; try { r = await resolverDestino(row, o) } catch (e) { const d = desfechoDeErro(e, row.cliente); throw erro(textoMotivo(d.motivo), 502) }
      if (r.imp) return impedimento(r.imp.motivo, r.imp.motivo)
      const c = await montarConteudo(row, X, r.compartilhado)
      let achadas; try { achadas = c.violacoes.length ? [] : await nt.acharPorTitulo(r.destino, c.titulo) } catch (e) { const d = desfechoDeErro(e, row.cliente); throw erro(textoMotivo(d.motivo), 502) }
      limparPrevias()
      for (const [id, p] of previas) if (p.alerta === row.id) previas.delete(id)
      const id = `pv-${randomBytes(8).toString('hex')}`, expira = agoraMs() + cfg.previa_ttl_min * 60_000
      previas.set(id, { alerta: row.id, cliente: row.cliente, assinatura: X.assinatura, titulo: c.titulo, blocos: c.blocos, compartilhado: r.compartilhado, dia: hoje(), expira })
      const st = decidirStatus(r.destino.esquema, { preferidos: cfg.status_aberto })
      const avisos = [...(r.compartilhado ? [`${MSG_DESTINO.destino_compartilhado.replace(' — o envio automático fica bloqueado', '')}: o título leva o nome do cliente ao final.`] : []), ...(st.aviso ? [st.aviso] : []),
        ...(X.assinatura !== row.assinatura ? ['A pendência mudou desde a detecção: o texto abaixo usa a leitura mais recente.'] : [])]
      return { ok: true, previa: true, previa_id: id, titulo: c.titulo, destino: { estado: r.destino.estado, pagina_titulo: r.destino.pagina_titulo, informacoes_url: r.destino.informacoes_url, ...(r.destino.compartilhado?.length ? { compartilhado_com: r.destino.compartilhado } : {}) },
        acao: c.violacoes.length ? 'bloqueado' : achadas.length ? 'adotar' : 'criar', bloqueio: c.violacoes.length ? { estado: 'bloqueado', mensagem: MSG.conteudo } : null,
        linhas: linhasDeTexto(c.blocos), violacoes: c.violacoes.map(({ codigo, bloco, trecho }) => ({ codigo, bloco, trecho })), avisos, expira_em: new Date(expira).toISOString() }
    }
    // CONFIRMAR
    if (pv.assinatura !== X.assinatura) throw erro('a pendência mudou desde a prévia — gere de novo', 409)
    if (emVoo.has(row.cliente)) throw erro('já existe um envio deste cliente em andamento', 409)
    emVoo.add(row.cliente)
    try {
      const atual = selId.get(row.id)
      if (atual.estado === 'enviado') return { ok: false, estado: 'enviado', motivo: 'ja_enviado', mensagem: 'este alerta já foi enviado ao Notion do cliente', url: atual.page_url }
      const d = await entregar(atual, X, { ...o, por, conteudo: { titulo: pv.titulo, blocos: pv.blocos, compartilhado: pv.compartilhado } })
      aplicar(atual, d, { origem: 'manual', por })
      if (d.estado === 'enviado') previas.delete(str(body.previa_id))
      return respostaDe(d, atual)
    } finally { emVoo.delete(row.cliente) }
  }

  return { varrer, enviar, listarCliente, listarPendentes, agendador, agendadorEstado: () => ({ ligado: ligado() }), config: cfg, invalidarCaches: () => nt.invalidarCaches() }
}
