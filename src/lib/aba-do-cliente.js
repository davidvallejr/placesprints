// Aba «Do cliente» do /cliente (pedido do David, 15/10/2026): num lugar só, o que depende do cliente — sem segundo motor, SÓ LEITURA dos módulos existentes:
//   1. pendências do avaliador único (pendencias-cliente.avaliar, paraCliente:false)   2. ações do plano com caminho «cliente» do Chaveiro (dados.execucao ou classificarCaminho)
//      + regras de conta que dependem dele (REGRAS_CONTA_CLIENTE)   3. itens de compra/ruptura do diagnóstico do dia (itensMicroCompras, o mesmo do micro de compras)
//   4. tarefas do Notion em dependência do cliente (vêm no avaliar().tarefas, régua 14/30)   5. comunicação: último aviso (gatilho_lote / gatilho_avisado / gatilho_cliente),
//      respostas (feedback_relatorio e as registradas aqui) e «sem resposta há N dias».
// Junta por ASSUNTO (estoque, custos, prazo do fornecedor…) e, dentro do estoque, por PRODUTO (id do anúncio): o mesmo produto nunca aparece duas vezes.
// Escrita só na tabela própria aba_cliente_marca (resolvido / movido para o consultor / resposta), prévia por padrão, confirmar === true, quem = líder/consultor/CS.
// «Mover para o consultor» não apaga nada: a medição e a ação do plano continuam; só saem da aba do cliente e passam a contar como da equipe no filtro do Plano.
// O lembrete só PREPARA o texto (nada é gravado nem enviado): o envio real segue o pipeline dos gatilhos (micro de compras / plano de terça) com as travas de lá.
import { classificarCaminho } from './chaveiro.js'
import { faixaDe, FAIXAS } from './dependencia-cliente.js'
import { montarMicroCompras, auditarMensagem, ASSINATURA, FECHO } from './plano-semana-texto.js'

export const SCHEMA_ABA_CLIENTE = `
CREATE TABLE IF NOT EXISTS aba_cliente_marca (   -- marcações da aba «Do cliente» (/cliente); a medição nunca é apagada
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                         -- nome canônico da central (nunca prospect)
  chave TEXT NOT NULL,                           -- assunto|canal do item da aba (ex.: estoque|ml)
  acao TEXT NOT NULL CHECK (acao IN ('resolvido','movido','resposta')),
  texto TEXT NOT NULL DEFAULT '',                -- ≤300, INTERNO (nota / resposta do cliente resumida pela equipe)
  por TEXT NOT NULL,
  em TEXT NOT NULL,                              -- ISO
  ate TEXT NOT NULL DEFAULT ''                   -- resolvido: AAAA-MM-DD até quando some ('' = sem prazo)
);
CREATE INDEX IF NOT EXISTS ix_aba_cliente_marca ON aba_cliente_marca (cliente, chave);`

export const ACOES = ['resolvido', 'movido', 'resposta']
export const STATUS_ABERTOS = ['proposta', 'aprovada', 'distribuida']
// regras de CONTA que dependem do cliente e não têm caminho declarado no Chaveiro (config/chaveiro.json só cobre regras por anúncio)
export const REGRAS_CONTA_CLIENTE = ['bloqueio_cliente', 'pendencia_cliente', 'sku_ausente', 'informar_lead_time']
// ponytail: resolvido de item MEDIDO some por 7 dias e volta se a medição continuar mostrando; registro manual resolve de vez pelo avaliador
export const DIAS_RESOLVIDO = 7

// assunto de cada fonte (o que junta pendência, ação e aviso do mesmo tema num cartão só)
const ASSUNTO_ITEM = { estoque_curva_a: 'estoque', preco_custo: 'custos', prazo_fornecedor: 'prazo_fornecedor', estoque_espelhado: 'estoque_espelhado', despacho_prazo: 'despacho',
  atendimento_sac: 'atendimento', acesso_conta: 'acesso', midia_produto: 'midia', retorno_pendente: 'retorno' }
const ASSUNTO_REGRA = { estoque_ruptura: 'estoque', full_envio: 'estoque', estoque_divergente: 'estoque', queda_conversao_anuncio: 'estoque', cadastrar_custos: 'custos',
  informar_lead_time: 'prazo_fornecedor', estoque_dividido: 'estoque_espelhado', sku_ausente: 'sku', envio_atrasado: 'despacho', reclamacao_sem_resposta: 'atendimento',
  pergunta_sem_resposta: 'atendimento', anuncio_restrito: 'moderacao', full_estoque_antigo: 'full_antigo', nf_regra_faltando: 'fiscal' }
const ASSUNTO_GATILHO = { ruptura_curva_a: 'estoque', estoque_zerado: 'estoque', ciclo_estoque_previsto: 'estoque', envio_full_sugerido: 'estoque', custos_nao_informados: 'custos',
  envio_atrasado: 'despacho', reclamacao_mediacao: 'atendimento', perguntas_sem_resposta: 'atendimento', anuncio_restrito: 'moderacao', full_estoque_antigo: 'full_antigo' }
const TITULO_ASSUNTO = { estoque: 'Estoque e reposição dos produtos que mais vendem', custos: 'Custos dos produtos', prazo_fornecedor: 'Prazo do fornecedor', estoque_espelhado: 'Estoque espelhado entre anúncios',
  sku: 'SKU dos anúncios', despacho: 'Despacho dentro do prazo', atendimento: 'Perguntas e reclamações', acesso: 'Acesso à conta', midia: 'Fotos dos produtos', retorno: 'Retorno sobre tarefas em aberto',
  moderacao: 'Anúncio restrito pelo canal', full_antigo: 'Estoque antigo no Full', fiscal: 'Regra fiscal do contador' }
const RANK = { critico: 0, atencao: 1, info: 2 }
const GRAV_P = { P0: 'critico', P1: 'atencao' }
const ROT_GRAV = { critico: 'Crítico', atencao: 'Atenção', info: 'Informativo' }

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const regraBase = r => String(r || '').replace(/^anuncio_/, '')
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
const diasEntre = (a, b) => Math.max(0, Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86_400_000))
const maisGrave = (a, b) => (RANK[a] ?? 9) <= (RANK[b] ?? 9) ? a : b
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// deps (todas só leitura, injetadas — o autoteste usa stubs e :memory:):
//   handle (better-sqlite3), pendencias.avaliar(cliente, { paraCliente:false }) e .resolver(b), acoes(cliente) → ações cruas do plano (lerAcoes, com dados),
//   prioridade(a) → { p, nota } (motor-ppc.prioridadeAcao, a do painel), compras(cliente) → itensMicroCompras(...) | null, idAcao(cliente, regra, alvo),
//   comunicacao(cliente) → { lotes:[gatilho_lote], avisados:[gatilho_avisado], gatilhos:[gatilho_cliente com lote], respostas:[feedback_relatorio] },
//   rotulo(cliente) → nome do cliente na mensagem, auditar(texto, opts) → violações[], validarPor(nome, cliente) → nome canônico | '', hoje(), agora(),
//   limiares { atencao, revisar } da régua de dependência, folga (dias de segurança do micro de compras).
export function criarAbaDoCliente({ handle, pendencias, acoes, prioridade, compras, idAcao, comunicacao, rotulo = c => c, auditar = () => [], validarPor = () => '',
  hoje, agora, limiares = { atencao: 14, revisar: 30 }, folga = 7, classificar = classificarCaminho }) {
  handle.exec(SCHEMA_ABA_CLIENTE)
  const marcas = cliente => handle.prepare('SELECT * FROM aba_cliente_marca WHERE cliente = ? ORDER BY id').all(cliente)

  function cliente(c) {
    c = str(c)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('prospect do Comercial não é cliente')
    return c
  }
  const caminhoDe = a => a.dados?.execucao?.caminho || classificar(a).caminho
  const doCliente = a => STATUS_ABERTOS.includes(a.status) && (caminhoDe(a) === 'cliente' || REGRAS_CONTA_CLIENTE.includes(regraBase(a.regra)))

  // monta os cartões (antes de aplicar as marcas): Map chave → item
  function juntar(c, dia) {
    const av = pendencias.avaliar(c, { paraCliente: false })
    const itens = new Map(), porPend = new Map()
    const novo = (chave, assunto, canal, titulo) => {
      if (!itens.has(chave)) itens.set(chave, { chave, assunto, canal, titulo, gravidade: 'info', prioridade: null, desde: null, dias: null, impacto: null, total_em_jogo: null,
        por_que_importa: '', o_que_precisamos: '', o_que_fazemos: '', evidencia: '', fontes: [], produtos: [], acoes: [], tarefas: [], registro_id: null, pendencia_id: null })
      return itens.get(chave)
    }
    const fonte = (it, f) => { if (!it.fontes.includes(f)) it.fontes.push(f) }
    const produto = (it, p) => {
      const ja = it.produtos.find(x => x.id === p.id)
      if (!ja) return it.produtos.push({ id: p.id, titulo: p.titulo || '', preco: p.preco ?? null, estoque: p.estoque ?? null, cobertura: p.cobertura ?? null, curva: p.curva || '', perda: p.perda || null, origem: p.origem || '' })
      for (const k of ['titulo', 'preco', 'estoque', 'cobertura', 'curva', 'perda', 'origem']) if ((ja[k] == null || ja[k] === '') && p[k] != null && p[k] !== '') ja[k] = p[k]
    }
    // 1. pendências do avaliador único
    for (const p of av.itens || []) {
      const assunto = ASSUNTO_ITEM[p.item] || p.item, it = novo(`${assunto}|${p.canal}`, assunto, p.canal, TITULO_ASSUNTO[assunto] || p.rotulo)
      fonte(it, p.fonte === 'tarefa' ? 'tarefa' : 'pendencia')
      it.gravidade = it.fontes.length === 1 ? p.gravidade : maisGrave(it.gravidade, p.gravidade)
      if (p.desde && (!it.desde || p.desde < it.desde)) { it.desde = p.desde; it.dias = p.dias }
      if (p.impacto?.valor_brl != null) it.impacto = { valor_brl: p.impacto.valor_brl, tipo: p.impacto.tipo, rotulo: p.impacto.rotulo, premissa: p.impacto.premissa }
      else if (!it.impacto) it.impacto = { valor_brl: null, tipo: 'sem_estimativa', rotulo: p.impacto?.rotulo || 'Impacto não estimado', premissa: null }
      for (const k of ['por_que_importa', 'o_que_precisamos', 'o_que_fazemos', 'evidencia']) if (!it[k]) it[k] = p[k] || ''
      if (p.registro_id && !it.registro_id) it.registro_id = p.registro_id
      if (!it.pendencia_id) it.pendencia_id = p.id
      for (const a of p.anuncios || []) if (assunto === 'estoque') produto(it, { id: String(a.id), estoque: a.estoque, cobertura: a.cobertura_dias != null ? Math.round(a.cobertura_dias) : null, curva: a.curva })
      porPend.set(idAcao(c, 'pendencia_cliente', p.id), it)
    }
    // 4. tarefas do Notion em dependência (régua 14/30) → no cartão da pendência de tarefa do mesmo item e canal
    for (const t of av.tarefas || []) {
      const assunto = ASSUNTO_ITEM[t.item] || t.item, it = novo(`${assunto}|${t.canal}`, assunto, t.canal, TITULO_ASSUNTO[assunto] || t.item)
      fonte(it, 'tarefa')
      const faixa = t.dias == null ? 'aguardando' : faixaDe(t.dias, limiares)
      it.tarefas.push({ id: t.id, titulo: t.titulo, url: t.url, dias: t.dias, faixa, faixa_rotulo: FAIXAS[faixa], tipo_rotulo: t.tipo_rotulo || '' })
    }
    // 3. compras/ruptura do diagnóstico do dia (o mesmo itensMicroCompras do micro de compras)
    const cp = compras(c)
    if (cp?.disponivel && cp.itens?.length) {
      const it = novo('estoque|ml', 'estoque', 'ml', TITULO_ASSUNTO.estoque)
      fonte(it, 'compras')
      for (const x of cp.itens) produto(it, { id: x.id, titulo: x.titulo, preco: x.preco, estoque: x.estoque, cobertura: x.cobertura, curva: x.curva, origem: x.origem, perda: x.impacto ? { c: x.impacto.c, b: x.impacto.b, dias: x.impacto.dias } : null })
      const com = cp.itens.filter(x => x.impacto?.b > 0)
      it.total_em_jogo = com.length ? { c: com.reduce((t, x) => t + x.impacto.c, 0), b: com.reduce((t, x) => t + x.impacto.b, 0), dias: [...new Set(com.map(x => x.impacto.dias))] } : null
      if (it.fontes.length === 1) it.gravidade = cp.itens.some(x => x.estoque === 0) ? 'critico' : 'atencao'
      it._compras = cp.itens
    }
    // 2. ações do plano com caminho cliente + regras de conta que dependem dele (mesma prioridade do plano)
    const acoesCli = []
    for (const a of acoes(c).filter(doCliente)) {
      const r = regraBase(a.regra)
      let it = r === 'pendencia_cliente' ? porPend.get(a.id) : null
      if (!it && r === 'bloqueio_cliente') it = [...itens.values()].filter(x => x.tarefas.length).sort((x, y) => RANK[x.gravidade] - RANK[y.gravidade] || y.tarefas.length - x.tarefas.length)[0] || null
      if (!it) {
        const assunto = ASSUNTO_REGRA[r] || (r === 'bloqueio_cliente' ? 'retorno' : r === 'pendencia_cliente' ? 'pendencia' : null)
        it = assunto ? novo(`${assunto}|ml`, assunto, 'ml', TITULO_ASSUNTO[assunto] || a.titulo) : novo(`${r}|${a.item_id || 'conta'}`, r, 'ml', a.titulo)
      }
      fonte(it, 'plano')
      const pr = prioridade(a)
      it.acoes.push({ id: a.id, titulo: a.titulo, regra: a.regra, status: a.status, p: pr.p, nota: pr.nota, caminho: caminhoDe(a), notion_url: a.notion_url || '' })
      if (pr.nota != null && (!it.prioridade || pr.nota > it.prioridade.nota)) it.prioridade = { p: pr.p, nota: pr.nota }
      if (!it.fontes.some(f => f !== 'plano')) it.gravidade = maisGrave(it.acoes.length === 1 ? 'info' : it.gravidade, GRAV_P[pr.p] || 'info')
      if (a.item_id && it.assunto === 'estoque') produto(it, { id: String(a.item_id), titulo: String(a.titulo).replace(/^[^:]*:\s*/, '').replace(/\s*\(MLB\d+\)\s*$/, '') })
      acoesCli.push(a.id)
    }
    return { itens, acoesCli, gerado_em: av.gerado_em }
  }

  // 5. comunicação por cartão: último aviso que falou do assunto (por produto no estoque) + resposta depois dele
  function comunicar(c, itens, dia, mm) {
    const k = comunicacao(c) || {}, lotes = new Map((k.lotes || []).map(l => [l.id, l]))
    const lote = id => { const l = lotes.get(id); if (!l) return null; const rec = parse(l.recibos_json, {}); return { id: l.id, tipo: l.tipo, dia: l.dia, estado: l.estado, enviado_em: l.enviado_em || '', recibos: Object.entries(rec).map(([canal, v]) => ({ canal, estado: v?.estado || '', em: v?.em || '' })) } }
    const respostas = [...(k.respostas || []).filter(r => r.status !== 'descartado').map(r => ({ em: r.recebido_em, texto: String(r.texto || '').slice(0, 300), origem: r.origem === 'equipe' ? 'equipe' : 'grupo do WhatsApp' }))]
    for (const it of itens.values()) {
      let ult = null
      const toma = (enviado_em, lote_id) => { if (enviado_em && (!ult || enviado_em > ult.enviado_em)) ult = { enviado_em, lote_id } }
      if (it.assunto === 'estoque') { const ids = new Set(it.produtos.map(p => p.id)); for (const a of k.avisados || []) if (ids.has(String(a.item_id))) toma(a.enviado_em, a.lote_id) }
      for (const g of k.gatilhos || []) {
        const ass = g.tipo === 'dependencia_vencida' ? (ASSUNTO_ITEM[parse(g.itens_json, [])[0]?.item] || parse(g.itens_json, [])[0]?.item) : ASSUNTO_GATILHO[g.tipo]
        if (ass === it.assunto && g.lote_id) toma(g.enviado_em || lotes.get(g.lote_id)?.enviado_em || '', g.lote_id)
      }
      const ultimo = ult ? { ...(lote(ult.lote_id) || { tipo: '', estado: '', recibos: [] }), enviado_em: ult.enviado_em } : null
      const daqui = mm.filter(m => m.chave === it.chave && m.acao === 'resposta').map(m => ({ em: m.em, texto: m.texto, origem: 'registrada pela equipe', por: m.por }))
      const resp = [...daqui, ...(ultimo ? respostas.filter(r => r.em > ultimo.enviado_em) : [])].sort((a, b) => b.em.localeCompare(a.em))[0] || null
      it.comunicacao = { ultimo, resposta: resp, sem_resposta_dias: ultimo && !resp ? diasEntre(ultimo.enviado_em, dia) : null }
    }
    const tl = [...(k.lotes || [])].filter(l => l.enviado_em).sort((a, b) => b.enviado_em.localeCompare(a.enviado_em))[0]
    return { ultimo_aviso: tl ? lote(tl.id) : null, ultima_resposta: respostas.sort((a, b) => b.em.localeCompare(a.em))[0] || null }
  }

  // ler: a rota única de leitura. Pura (só leitura): nada é gravado.
  function ler(c) {
    c = cliente(c)
    const dia = hoje(), mm = marcas(c)
    const { itens, acoesCli, gerado_em } = juntar(c, dia)
    const ultimaMarca = ch => mm.filter(m => m.chave === ch && m.acao !== 'resposta').at(-1) || null
    const movidos = [], abertos = []
    for (const it of itens.values()) {
      const m = ultimaMarca(it.chave)
      if (m?.acao === 'movido') { movidos.push({ chave: it.chave, titulo: it.titulo, texto: m.texto, por: m.por, em: m.em, acoes: it.acoes.map(a => a.id) }); continue }
      if (m?.acao === 'resolvido' && (!m.ate || m.ate >= dia)) continue
      abertos.push(it)
    }
    const geral = comunicar(c, new Map(abertos.map(i => [i.chave, i])), dia, mm)
    abertos.sort((a, b) => RANK[a.gravidade] - RANK[b.gravidade] || (b.prioridade?.nota ?? -1) - (a.prioridade?.nota ?? -1)
      || (b.total_em_jogo?.b ?? b.impacto?.valor_brl ?? -1) - (a.total_em_jogo?.b ?? a.impacto?.valor_brl ?? -1) || (b.dias ?? -1) - (a.dias ?? -1) || a.chave.localeCompare(b.chave))
    const idsMovidos = new Set(movidos.flatMap(m => m.acoes))
    const emJogo = abertos.reduce((t, i) => t + (i.total_em_jogo?.b ?? i.impacto?.valor_brl ?? 0), 0)
    return {
      cliente: c, gerado_em: gerado_em || agora(), hoje: dia,
      resumo: { total: abertos.length, criticas: abertos.filter(i => i.gravidade === 'critico').length, em_jogo_brl: emJogo > 0 ? Math.round(emJogo) : null, ...geral },
      itens: abertos.map(({ _compras, ...i }) => ({ ...i, gravidade_rotulo: ROT_GRAV[i.gravidade], resolve_registro: !!i.registro_id })),
      acoes_cliente: acoesCli.filter(id => !idsMovidos.has(id)),        // o filtro Equipe | Cliente da aba Plano usa ESTA lista (um predicado só, no servidor)
      movidos,
    }
  }
  const achar = (c, chave) => {
    const { itens } = juntar(c, hoje())
    const it = itens.get(str(chave))
    if (!it) throw erro('item não encontrado na aba do cliente', 404)
    return it
  }

  // marcar: { cliente, chave, acao: resolvido|movido|resposta, texto?, por, confirmar? } — sem confirmar === true é prévia (nada é gravado)
  function marcar(b = {}) {
    const c = cliente(b.cliente), acao = str(b.acao)
    if (!ACOES.includes(acao)) throw erro('ação desconhecida — use resolvido, movido ou resposta')
    const texto = str(b.texto)
    if (texto.length > 300) throw erro('o texto pode ter até 300 caracteres')
    if (acao === 'resposta' && texto.length < 3) throw erro('escreva a resposta do cliente (de 3 a 300 caracteres)')
    const it = achar(c, b.chave), dia = hoje()
    const efeito = acao === 'resolvido' ? (it.registro_id ? 'A pendência registrada pela equipe é resolvida e sai da aba e dos relatórios.' : `Sai da aba por ${DIAS_RESOLVIDO} dias; se a medição continuar mostrando o problema, volta.`)
      : acao === 'movido' ? 'Sai da aba do cliente e passa a ser da equipe: as ações do plano ligadas aparecem no filtro Equipe da aba Plano. Nada é apagado; a medição continua.'
      : 'A resposta fica registrada no cartão (uso interno) e conta como resposta ao último aviso.'
    const previa = { chave: it.chave, titulo: it.titulo, acao, efeito, acoes: it.acoes.map(a => a.id) }
    if (b.confirmar !== true) return { ok: true, previa: true, ...previa }
    const por = str(b.por)
    if (!por) throw erro('informe "por" (quem marca — líder, consultor ou CS do cliente)')
    const quem = validarPor(por, c)
    if (!quem) throw erro('somente líder, consultor ou o CS deste cliente marca itens da aba do cliente', 403)
    if (acao === 'resolvido' && it.registro_id) pendencias.resolver({ registro_id: it.registro_id, por: quem, nota: texto, confirmar: true })
    const ate = acao === 'resolvido' && !it.registro_id ? somaDias(dia, DIAS_RESOLVIDO) : ''
    const r = handle.prepare('INSERT INTO aba_cliente_marca (cliente, chave, acao, texto, por, em, ate) VALUES (?,?,?,?,?,?,?)').run(c, it.chave, acao, texto, String(quem).slice(0, 80), agora(), ate)
    return { ok: true, id: Number(r.lastInsertRowid), ...previa }
  }

  // lembrete: só PREPARA o texto ao cliente daquele item (prévia; nenhuma linha gravada, nada enviado). Estoque = micro de compras dos produtos do cartão;
  // demais = template fixo do catálogo de pendências. Auditado como as mensagens dos gatilhos; reprovado = sem texto (nunca sai «quase certo»).
  function lembrete(b = {}) {
    const c = cliente(b.cliente), it = achar(c, b.chave), rot = rotulo(c) || c
    const opts = { permitidos: [c, rot] }, tituloOk = t => !auditar(String(t || ''), opts).length
    let texto = '', como = ''
    if (it.assunto === 'estoque' && it._compras?.length) {
      texto = montarMicroCompras({ rotulo: rot, itens: it._compras, folga, tituloOk }).texto
      como = 'Envio real pelo micro de compras (lote compras do pipeline dos gatilhos): node scripts/micro-compras.mjs gera a prévia; o envio exige --enviar --confirmar --arquivo, com as travas de grupo, janela e 24 h.'
    } else if (it.o_que_precisamos) {
      texto = `Oi, time ${rot}! Passando rapidinho com um ponto que depende de você:\n\n${it.por_que_importa}\n${it.o_que_precisamos}\n\n${FECHO}\n${ASSINATURA}`
      como = 'Envio real pelo plano semanal de terça (seção Avisos): o ponto entra pelo pipeline dos gatilhos, com liberação do líder, chave geral e auditor. Esta tela não envia.'
    } else return { ok: false, motivo: 'sem_texto_cliente', mensagem: 'este item não tem texto aprovado para o cliente (só ação interna do plano); o consultor combina pelo canal de sempre' }
    const violacoes = texto ? auditarMensagem(texto, auditar, opts) : ['sem_texto']
    if (violacoes.length) return { ok: false, motivo: 'conteudo', mensagem: 'o texto não passou no auditor de mensagens ao cliente; nada foi preparado' }
    return { ok: true, previa: true, chave: it.chave, canal: 'whatsapp', texto, caracteres: texto.length, como_enviar: como }
  }

  return { ler, marcar, lembrete }
}
