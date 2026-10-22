// Distribui as ações dos planos como TAREFAS nos quadros "Tarefas - {Cliente}" do Notion.
// Segurança (o roteiro do estrategista proíbe agir sem autorização específica):
//  • dryRun é o PADRÃO — só cria de verdade com { dryRun: false } explícito;
//  • só distribui ação em status proposta/aprovada (nunca descartada/obsoleta/já distribuída);
//  • idempotente: ID estável da ação (PS-xxxxxxx) no banco E no próprio quadro — rodar de novo não duplica;
//  • nunca cria opção nova de Canal/Demanda/Tag nos quadros dos clientes (só usa as já existentes);
//  • todas as chamadas passam por notionReq (throttle 3 req/s, retry, timeout); desfazer() manda a página à lixeira.
import { db, agora, log, getEstado, setEstado } from './db.js'
import { notionReq } from './notion.js'
import { descobrirFontes } from './descobrir.js'
import { mapeamento } from './extrair.js'
import { idDoUsuario, guardarUsuarios, normNome, CANAIS } from './equipe.js'
import { analistaDaConta, placeplanDe } from './placeplan.js'
import { playbook } from './plano-cliente.js'
import { ficha, papelDaAcao } from './ficha-cliente.js'
import { roteiro as roteiroDe } from './processos.js'
import { melhorProfissional } from './melhor-profissional.js'
import { criarCatalogo } from './catalogo-db.js'
import { mapearPropsQuadro, opcaoExistente } from './relatorio-tarefa.js'
import { regraBloqueada } from './catalogo-cfg.js'

const catalogoDb = criarCatalogo(db)

const RX_ID = /PS-[0-9a-f]{7,10}/g
const ROTULO_TIPO = { fato: 'Fato observado', hipotese: 'Hipótese a testar', projecao: 'Projeção', pendente: 'Informação pendente' }
const FASE = { '72h': 'Próximas 72 horas', '7d': 'Próximos 7 dias', '30d': 'Próximos 30 dias', '90d': 'Próximos 90 dias' }

// ── cache de descoberta (descobrirFontes custa ~12 requisições) e de schema ─
let cacheFontes = { em: 0, mapa: null }
async function fonteDoCliente(cliente) {
  if (!cacheFontes.mapa || Date.now() - cacheFontes.em > 10 * 60_000)
    cacheFontes = { em: Date.now(), mapa: new Map((await descobrirFontes()).map(f => [f.cliente, f])) }
  return cacheFontes.mapa.get(cliente) || null
}
const cacheSchema = new Map()
async function schemaDa(f) {
  const hit = cacheSchema.get(f.dbId)
  if (hit && Date.now() - hit.em < 15 * 60_000) return hit.v
  const modo = f.modo === 'data_source' ? 'data_source' : 'database'
  let rota = modo === 'data_source' ? `data_sources/${f.dbId}` : `databases/${f.dbId}`
  let s = await notionReq(rota)
  if (!s.properties && s.data_sources?.[0]) { rota = `data_sources/${s.data_sources[0].id}`; s = await notionReq(rota) }
  const v = { rota, modoDS: rota.startsWith('data_sources'), id: rota.split('/')[1], props: s.properties || {} }
  cacheSchema.set(f.dbId, { em: Date.now(), v })
  return v
}

// ── propriedades do quadro (nomes vêm de config/mapeamento.json) ────────────
// o mapa e a regra "só opção JÁ existente" moram em relatorio-tarefa.js (o relatório em plano B usa o MESMO mapa deste quadro); o comportamento é o de antes
const mapearProps = props => mapearPropsQuadro(props, mapeamento.propriedades)

// ── conteúdo da tarefa ──────────────────────────────────────────────────────
const trechos = (s, max = 1900) => { const o = []; for (let i = 0; i < s.length; i += max) o.push({ type: 'text', text: { content: s.slice(i, i + max) } }); return o.length ? o : [{ type: 'text', text: { content: '—' } }] }
const brData = iso => iso ? iso.split('-').reverse().join('/') : '—'
const par = txt => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: trechos(txt) } })
const h3 = txt => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: trechos(txt) } })

const brlN = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
function blocoPrevisao(p) {
  const c = p.cenarios, t = p.tipo === 'risco_evitado' ? 'Receita em risco evitada' : 'Receita adicional estimada (28 dias)'
  return `${t}: conservador ${brlN(c.conservador.receita)} · base ${brlN(c.base.receita)} · otimista ${brlN(c.otimista.receita)}. Probabilidade de sucesso ${Math.round(p.p_sucesso * 100)}% (${p.p_fonte}). Fórmula: ${p.formula}. Premissas: ${(p.premissas || []).join('; ')}.`
}

function blocosDaAcao(a, planoCanal, extra = {}) {
  const d = a.dados
  const canalK = Object.entries(CANAIS).find(([, v]) => v === a.canal)?.[0] || 'ML'
  const blocos = [
    { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '🧭' }, color: 'gray_background',
      rich_text: trechos(`Plano de ação · ${a.id} · prioridade ${a.score}/100 · ${FASE[a.horizonte] || a.horizonte} · prazo ${brData(a.prazo)}`) } },
    h3('O que encontramos'), par(`${ROTULO_TIPO[d.evidencia_tipo] || d.evidencia_tipo}: ${d.evidencia}`),
    par(`Fonte: ${d.fonte} · período: ${d.periodo}`),
    h3('Por que isso importa'), par(d.problema),
    ...(d.como?.length ? [h3('O que faremos (passo a passo)'), ...d.como.map(p => ({ object: 'block', type: 'to_do', to_do: { checked: false, rich_text: trechos(p) } }))] : [h3('O que faremos'), par(d.acao)]),
    ...(d.hipotese ? [h3('Hipótese a testar'), par(d.hipotese)] : []),
    h3('Quem e até quando'), par(`Responsável: ${d.executor === 'cliente' ? `o cliente${a.responsavel ? ` (consultor que acompanha: ${a.responsavel})` : ''}` : a.responsavel || 'a definir'}${a.squad ? ` · ${a.squad}` : ''} · prazo: ${brData(a.prazo)}${d.dependencia && d.dependencia !== '—' ? ` · depende de: ${d.dependencia}` : ''}`),
    h3('Como saberemos se funcionou'), par(`Indicador inicial: ${d.indicador_inicial} · meta: ${d.meta}`),
    { object: 'block', type: 'to_do', to_do: { checked: false, rich_text: trechos(`Critério de aceite: ${d.criterio_aceite}`) } },
    ...(d.previsao?.cenarios ? [h3('Resultado esperado (hipótese, não promessa)'), par(blocoPrevisao(d.previsao))] : []),
    par(`Como a prioridade foi calculada: ${d.logica}`),
  ]
  // selo de catálogo no card (terceiros: "catálogo"; próprio: "catálogo próprio") e o texto fixo no lugar das recomendações de conteúdo
  const ROT_CAT = { terceiros: 'catálogo', proprio: 'catálogo próprio' }
  if (d.item?.permalink) blocos.splice(1, 0, { object: 'block', type: 'paragraph', paragraph: { rich_text: [
    { type: 'text', text: { content: '🛒 Anúncio (como o comprador vê): ' } },
    { type: 'text', text: { content: `${d.item.titulo.slice(0, 120)} (${d.item.id})`, link: { url: d.item.permalink } } },
    { type: 'text', text: { content: `${d.item.classe ? ` · curva ${d.item.classe}` : ''}${ROT_CAT[d.item.catalogo_origem] ? ` · ${ROT_CAT[d.item.catalogo_origem]}` : ''}` } },
  ] } }, ...(d.catalogo?.texto ? [par(d.catalogo.texto)] : []))
  // onde fazer: os links das contas e materiais guardados na ficha do cliente (só http(s), validados ao salvar)
  const linksFicha = Object.entries(extra.links || {}).filter(([k]) => ['ml', 'shopee', 'amazon', 'tiktok', 'drive', 'notion'].includes(k) && /^https?:\/\//.test(extra.links[k]))
  if (linksFicha.length) {
    const ROT = { ml: 'Conta Mercado Livre', shopee: 'Loja Shopee', amazon: 'Conta Amazon', tiktok: 'TikTok Shop', drive: 'Pasta no Drive', notion: 'Quadro no Notion' }
    blocos.splice(1, 0, { object: 'block', type: 'paragraph', paragraph: { rich_text: [
      { type: 'text', text: { content: '🔗 Onde fazer: ' } },
      ...linksFicha.flatMap(([k, u], i) => [...(i ? [{ type: 'text', text: { content: ' · ' } }] : []), { type: 'text', text: { content: ROT[k] || k, link: { url: u } } }]),
    ] } })
  }
  if (planoCanal?.url) blocos.splice(1, 0, { object: 'block', type: 'paragraph', paragraph: { rich_text: [
    { type: 'text', text: { content: '📋 Faz parte do plano do mês: ' } },
    { type: 'text', text: { content: planoCanal.titulo || 'PlacePlan', link: { url: planoCanal.url } } },
  ] } })
  // roteiro do Manual do Analista para o canal: o passo a passo, o que registrar como evidência e quando a tarefa está concluída
  // o roteiro vai INTEIRO (o David estruturou o passo a passo elementar para o analista executar sem perguntar); nada é cortado
  const rot = d.processo || roteiroDe({ demanda: d.demanda_notion, canal: canalK })
  if (rot) {
    const idProc = rot.id || rot.processo
    blocos.push(h3(`Como fazer — Manual do Analista, processo ${idProc}${rot.nome ? ` · ${rot.nome}` : ''}`))
    if (rot.caminho) blocos.push(par(`Caminho: ${rot.caminho}`))
    for (const p of rot.passos || []) blocos.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: trechos(`${p.titulo}${p.texto ? ' — ' + p.texto : ''}`) } })
    for (const t of rot.atencao || []) blocos.push(par(`Atenção: ${t}`))
    if (rot.evidencia?.length) { blocos.push(h3('Evidência a registrar no card')); for (const e of rot.evidencia) blocos.push({ object: 'block', type: 'to_do', to_do: { checked: false, rich_text: trechos(e) } }) }
    if (rot.criterio) blocos.push(par(`Está concluída quando: ${rot.criterio}`))
    if (rot.prazo) blocos.push(par(`Prazo de referência: ${rot.prazo}`))
    if (rot.dependencias?.length) blocos.push(par(`Depende do cliente: ${rot.dependencias.join('; ')}`))
    // roteiro estruturado para OUTRO SISTEMA executar (o servidor é local, então o card é o transporte): JSON num toggle, sem poluir a leitura
    const estruturado = { acao: a.id, processo: idProc, nome: rot.nome || null, canal: canalK, demanda: d.demanda_notion || null, caminho: rot.caminho || null,
      passos: (rot.passos || []).map(p => ({ n: p.n, titulo: p.titulo, texto: p.texto || '' })), atencao: rot.atencao || [], evidencia: rot.evidencia || [], criterio: rot.criterio || null, prazo: rot.prazo || null, dependencias: rot.dependencias || [], anuncio: d.item ? { id: d.item.id, permalink: d.item.permalink } : null }
    blocos.push({ object: 'block', type: 'toggle', toggle: { rich_text: trechos('Roteiro estruturado (JSON, para automação)'), children: [{ object: 'block', type: 'code', code: { language: 'json', rich_text: trechos(JSON.stringify(estruturado, null, 1)) } }] } })
  }
  if (d.duplicacao?.exige_briefing_consultor) blocos.push(par('Duplicação estratégica: só se executa com o briefing do consultor (objetivo, volume e variações). O anúncio original fica intacto; a duplicata absorve o teste.'))
  if (d.refs?.length) {
    blocos.push(h3('Tarefas relacionadas'))
    for (const r of d.refs.slice(0, 8)) blocos.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: r.titulo.slice(0, 180), link: r.url ? { url: r.url } : null } }] } })
  }
  return blocos
}

export function montarPagina(a, schema, pm, atribuir, extra = {}) {   // exportada só para o autoteste da trilha Prime (card do cliente sem people)
  const d = a.dados, avisos = []
  // o ID estável vai no título: é a única coluna que todo quadro tem (30% dos quadros não têm coluna de texto) e é onde o dedupe consulta
  const properties = { [pm.titulo]: { title: [{ type: 'text', text: { content: `${a.titulo.slice(0, 170)} · ${a.id}` } }] } }
  const canalK = Object.entries(CANAIS).find(([, v]) => v === a.canal)?.[0] || ''   // a linha do banco guarda o rótulo, não a chave
  const canal = opcaoExistente(pm.canal, playbook.canal_notion[canalK] || 'Geral')
  if (canal) properties[pm.canal.nome] = { select: { name: canal } }
  else if (pm.canal) avisos.push('Canal: opção não existe no quadro — não preenchido')
  if (d.demanda_notion) {
    const dem = opcaoExistente(pm.demanda, d.demanda_notion)
    if (dem) properties[pm.demanda.nome] = { select: { name: dem } }
    else avisos.push(`Demanda "${d.demanda_notion}" inexistente no quadro — não preenchida`)
  }
  const tag = opcaoExistente(pm.tag, playbook.tag_notion)
  if (tag) properties[pm.tag.nome] = pm.tag.def.type === 'multi_select' ? { multi_select: [{ name: tag }] } : { select: { name: tag } }
  if (pm.data) properties[pm.data] = { date: { start: a.prazo } }
  // quem recebe a tarefa: 1) prestador escolhido na aprovação da ação, 2) ficha do cliente (canal > geral) no papel da tarefa, 3) analista da conta (quem de fato opera, 90 dias),
  // 4) consultor do canal. Só prestador ATIVO do Notion. O consultor entra junto quando a tarefa depende dele (briefing da duplicação, pesquisa de urgência oculta).
  const papel = papelDaAcao(a)
  const delegado = a.delegado_a && ficha.ehAtivo(a.delegado_a) ? { nome: ficha.nomeOficial(a.delegado_a), notion: ficha.notionDoPrestador(a.delegado_a), origem: 'escolhido na aprovação' } : null
  const daFicha = !delegado && (ficha.prestadorDaFicha(a.cliente, canalK, papel) || (papel !== 'analista' ? ficha.prestadorDaFicha(a.cliente, canalK, 'analista') : null))
  const analista = extra.analistas ? ((a.canal && extra.analistas.por_canal[a.canal]) || extra.analistas.geral) : null   // mesmo critério da página do PlacePlan
  // melhor desempenho MEDIDO nesta família de tarefa, só com prova (Wilson acima da taxa habitual) e só entre quem já opera o cliente (ou a ficha);
  // sem prova, o critério seguinte (quem mais executa o cliente) continua valendo — o sistema não "acha", ele mede
  let melhor = null
  if (!delegado && !daFicha && d.demanda_notion) {
    try {
      const candidatos = [...new Set([extra.analistas?.geral?.nome_notion, ...Object.values(extra.analistas?.por_canal || {}).map(x => x.nome_notion)].filter(Boolean))]
      const r = melhorProfissional({ demanda: d.demanda_notion, cliente: a.cliente, candidatos: candidatos.length ? candidatos : null })
      if (r.recomendado && ficha.ehAtivo(r.recomendado.nome)) melhor = { nome: r.recomendado.nome, notion: ficha.notionDoPrestador(r.recomendado.nome), origem: `melhor desempenho medido nesta tarefa (${r.recomendado.motivo})` }
    } catch { /* sem medição disponível: segue o critério por volume */ }
  }
  // Place Prime (passo da trilha / combinado do lado do cliente): quem executa é o CLIENTE — card sem people, consultor citado na descrição
  const doCliente = d.executor === 'cliente'
  const exec = doCliente ? null : delegado || (daFicha ? { nome: daFicha.nome, notion: daFicha.notion, origem: 'ficha do cliente' } : null) || melhor
    || (analista ? { nome: analista.nome_notion, notion: analista.notion_id ? { id: analista.notion_id } : (idDoUsuario(analista.nome_notion) ? { id: idDoUsuario(analista.nome_notion) } : null), origem: 'analista da conta' } : null)
    || (a.responsavel ? { nome: a.responsavel, notion: idDoUsuario(a.responsavel) ? { id: idDoUsuario(a.responsavel) } : null, origem: 'consultor do canal' } : null)
  const nomeExec = exec?.nome || ''
  const respId = atribuir ? (exec?.notion?.id || null) : null
  const precisaConsultor = d.duplicacao?.exige_briefing_consultor || d.exige_pesquisa_consultor
  const cons = precisaConsultor ? ficha.prestadorDaFicha(a.cliente, canalK, 'consultor') : null
  const pessoas = [...new Set([respId, atribuir ? cons?.notion?.id : null].filter(Boolean))]
  if (pm.resp && pessoas.length) properties[pm.resp.nome] = { people: pessoas.map(id => ({ id })) }
  else if (atribuir && !doCliente) avisos.push(nomeExec ? `Responsável "${nomeExec}" sem usuário Notion identificado — citado na descrição` : 'Responsável a definir')
  if (atribuir && cons && !cons.notion) avisos.push(`Consultor "${cons.nome}" sem usuário Notion identificado — citado na descrição`)
  const notaResp = doCliente ? ` — Responsável: o cliente${a.responsavel ? ` · consultor que acompanha: ${a.responsavel}` : ''}` : [
    respId || !nomeExec ? '' : ` — Responsável proposto: ${nomeExec}`,
    nomeExec ? ` — Delegada a ${nomeExec} (${exec.origem})` : '',
    cons ? ` — Consultor da tarefa: ${cons.nome}` : (a.responsavel && normNome(a.responsavel) !== normNome(nomeExec) ? ` — Consultor: ${a.responsavel}` : ''),
  ].join('')
  if (pm.desc) properties[pm.desc.nome] = { rich_text: trechos(`[${a.id}] ${d.item ? d.item.id + ' · ' : ''}${d.acao}${notaResp}`.slice(0, 1900)) }
  const mesAtual = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7)
  const candidato = extra.placeplan ? (extra.placeplan[a.canal || 'Geral'] || extra.placeplan.Geral || null) : null
  const planoCanal = candidato?.mes === mesAtual ? candidato : null   // plano de mês antigo não vira link na tarefa nova
  return {
    payload: { parent: schema.modoDS ? { data_source_id: schema.id } : { database_id: schema.id }, icon: { type: 'emoji', emoji: '🧭' }, properties, children: blocosDaAcao(a, planoCanal, { links: ficha.lerFicha(a.cliente).links }) },
    avisos, respId, executor: nomeExec, origem: exec?.origem || '',
  }
}

// IDs já criados no próprio quadro (sobrevive à perda do banco local) — lê o sufixo " · PS-xxxxxxx" do título
async function idsNoQuadro(schema, pm) {
  const achados = new Map()
  let cursor
  do {
    const r = await notionReq(`${schema.rota}/query`, { method: 'POST', body: { page_size: 100, filter: { property: pm.titulo, title: { contains: 'PS-' } }, ...(cursor ? { start_cursor: cursor } : {}) } })
    for (const pg of r.results) {
      const txt = (pg.properties?.[pm.titulo]?.title || []).map(t => t.plain_text).join('')
      for (const id of txt.match(RX_ID) || []) achados.set(id, { page_id: pg.id, url: pg.url })
      if (pm.resp) guardarUsuarios((pg.properties?.[pm.resp.nome]?.people || []).filter(u => u.name).map(u => ({ id: u.id, nome: u.name })))
    }
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  return achados
}

const marcarDistribuida = db.prepare("UPDATE acoes_plano SET status='distribuida', notion_page_id=?, notion_url=?, distribuido_em=?, atualizado_em=?, erro='' WHERE id=?")
const marcarErro = db.prepare('UPDATE acoes_plano SET erro=?, atualizado_em=? WHERE id=?')

// atribuir=false: cria sem preencher Responsável (o Notion notifica quem é atribuído) — usado só no teste de canário
export async function distribuir(acoes, { dryRun = true, atribuir = true, aoProgredir = () => {} } = {}) {
  const rel = { dryRun, a_criar: [], criadas: [], ja_existiam: [], sem_usuario_notion: 0, avisos: [], erros: [], clientes: 0, exemplo: null, barradas_catalogo: [] }
  // plano gerado ANTES da regra de catálogo (v1.3.0) pode guardar ação de foto/duplicação em catálogo de terceiros: ela não vai ao Notion (regerar o plano a torna obsoleta)
  const origens = new Map()
  const barradaPorCatalogo = a => {
    if (!a.item_id || !String(a.regra).startsWith('anuncio_')) return false
    if (!origens.has(a.cliente)) origens.set(a.cliente, catalogoDb.origensDe(a.cliente, acoes.filter(x => x.cliente === a.cliente).map(x => x.item_id)))
    return regraBloqueada(a.regra.replace(/^anuncio_/, ''), origens.get(a.cliente).get(a.item_id))
  }
  const elegiveis = acoes.filter(a => ['proposta', 'aprovada'].includes(a.status) && !a.notion_page_id).filter(a => !barradaPorCatalogo(a) || (rel.barradas_catalogo.push({ id: a.id, cliente: a.cliente, titulo: a.titulo }), false))
  if (rel.barradas_catalogo.length) rel.avisos.push(`${rel.barradas_catalogo.length} ação(ões) de conteúdo ou duplicação em anúncio de catálogo de terceiros não foram distribuídas (conteúdo controlado pelo catálogo): regerar o plano por anúncio as torna obsoletas`)
  rel.ja_existiam.push(...acoes.filter(a => a.status === 'distribuida' || a.notion_page_id).map(a => ({ id: a.id, cliente: a.cliente, titulo: a.titulo, motivo: 'já distribuída' })))
  const porCliente = new Map()
  for (const a of elegiveis) porCliente.set(a.cliente, [...(porCliente.get(a.cliente) || []), a])
  if (!dryRun) {               // trava entre processos (painel × CLI): duas escritas simultâneas duplicariam tarefas
    const lock = getEstado('distribuir_lock')
    if (lock && Date.now() - new Date(lock).getTime() < 30 * 60_000)
      throw new Error(`outra distribuição está em andamento desde ${lock} — aguarde terminar (a trava expira em 30 min)`)
    setEstado('distribuir_lock', new Date().toISOString())
  }
  try {
  let feitos = 0
  for (const [cliente, lista] of porCliente) {
    feitos++
    try {
      const f = await fonteDoCliente(cliente)
      if (!f) throw new Error('base de tarefas do cliente não localizada')
      const schema = await schemaDa(f), pm = mapearProps(schema.props)
      if (!pm.titulo) throw new Error('quadro sem coluna de título')
      const extra = { analistas: analistaDaConta(cliente), placeplan: placeplanDe(cliente) }
      const noQuadro = await idsNoQuadro(schema, pm)
      rel.clientes++
      for (const a of lista) {
        const ja = noQuadro.get(a.id)
        if (ja) {                                     // já existe no quadro: só religa o banco
          if (!dryRun) marcarDistribuida.run(ja.page_id, ja.url, agora(), agora(), a.id)
          rel.ja_existiam.push({ id: a.id, cliente, titulo: a.titulo, motivo: 'já existe no quadro' }); continue
        }
        const { payload, avisos, respId, executor, origem } = montarPagina(a, schema, pm, atribuir, extra)
        if (!respId) rel.sem_usuario_notion++
        avisos.forEach(x => rel.avisos.push(`${cliente}: ${x}`))
        const resumo = { id: a.id, cliente, titulo: a.titulo, responsavel: executor || 'a definir', origem_responsavel: origem || '', consultor: a.responsavel || '', responsavel_notion: !!respId, prazo: a.prazo, squad: a.squad }
        if (!rel.exemplo) rel.exemplo = { ...resumo, propriedades: Object.keys(payload.properties), blocos: payload.children.length }
        if (dryRun) { rel.a_criar.push(resumo); continue }
        const decisao = db.prepare('SELECT status FROM acoes_plano WHERE id = ?').get(a.id)
        if (!decisao || !['proposta', 'aprovada'].includes(decisao.status)) {
          rel.ja_existiam.push({ id: a.id, cliente, titulo: a.titulo, motivo: 'decisão mudou durante o job' }); continue
        }
        try {
          // retry5xx:false — repetir um POST de criação após 502/504 duplicaria a página
          const filhos = payload.children, LOTE = 100          // o Notion aceita 100 blocos por chamada: o roteiro inteiro cabe, mas em lotes
          const pg = await notionReq('pages', { method: 'POST', body: { ...payload, children: filhos.slice(0, LOTE) }, retry5xx: false })
          for (let i = LOTE; i < filhos.length; i += LOTE) {
            try { await notionReq(`blocks/${pg.id}/children`, { method: 'PATCH', body: { children: filhos.slice(i, i + LOTE) }, retry5xx: false }) }
            catch (e) { rel.avisos.push(`${cliente}: ${a.id} criada, mas parte do roteiro (blocos ${i + 1}+) não foi anexada: ${e.message.slice(0, 120)}`); break }
          }
          marcarDistribuida.run(pg.id, pg.url, agora(), agora(), a.id)
          rel.criadas.push({ ...resumo, url: pg.url })
        } catch (e) {
          let criadaMesmoAssim = null     // 5xx pode vir DEPOIS de o Notion gravar — confere no quadro antes de acusar erro
          if (e.status >= 500) { try { criadaMesmoAssim = (await idsNoQuadro(schema, pm)).get(a.id) || null } catch { /* fica como erro */ } }
          if (criadaMesmoAssim) { marcarDistribuida.run(criadaMesmoAssim.page_id, criadaMesmoAssim.url, agora(), agora(), a.id); rel.criadas.push({ ...resumo, url: criadaMesmoAssim.url }) }
          else { marcarErro.run(e.message.slice(0, 300), agora(), a.id); rel.erros.push({ cliente, id: a.id, erro: e.message.slice(0, 200) }) }
        }
      }
    } catch (e) {
      for (const a of lista) if (!dryRun) marcarErro.run(e.message.slice(0, 300), agora(), a.id)
      rel.erros.push({ cliente, erro: e.message.slice(0, 200) })
    }
    aoProgredir({ feitos, total: porCliente.size, cliente })
  }
  } finally { if (!dryRun) setEstado('distribuir_lock', '') }
  if (!dryRun) log('info', `distribuição: ${rel.criadas.length} criada(s), ${rel.ja_existiam.length} já existiam, ${rel.erros.length} erro(s)`)
  return rel
}

// Desfaz: manda a página à lixeira do Notion (recuperável) e devolve a ação a "proposta"
export async function desfazer(ids) {
  const rows = db.prepare(`SELECT id, notion_page_id FROM acoes_plano WHERE status='distribuida' AND notion_page_id != '' AND id IN (${ids.map(() => '?').join(',') || "''"})`).all(...ids)
  const rel = { desfeitas: 0, erros: [] }
  for (const r of rows) {
    try {
      await notionReq(`pages/${r.notion_page_id}`, { method: 'PATCH', body: { in_trash: true } })
      db.prepare("UPDATE acoes_plano SET status='proposta', notion_page_id='', notion_url='', distribuido_em='', atualizado_em=? WHERE id=?").run(agora(), r.id)
      rel.desfeitas++
    } catch (e) { rel.erros.push({ id: r.id, erro: e.message.slice(0, 160) }) }
  }
  return rel
}
