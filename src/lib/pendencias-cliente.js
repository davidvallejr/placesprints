// Pendências do cliente por canal — BASE ÚNICA (catálogo + avaliador + registro manual) do que "depende do cliente e, se ele não faz, atrapalha tudo".
// Plano de ação, Resumo, relatórios e alerta leem SÓ daqui (avaliar): não existe segundo motor. Contrato: docs/contrato-pendencias-cliente.md.
// Núcleo SEM import de banco/Notion/ML (molde de dependencia-cliente.js): handle, dependências, leituras do ML (só banco local), relógio, auditor e
// validarPor entram por fábrica — o autoteste usa :memory: e stubs; a fiação real está em pendencias-cliente-real.js.
// Regras: fonte medido (só ML, leitura local) > tarefa (status dependencia_cliente, classificada pelo tipo REGISTRADO, nunca pelo texto) > registro manual;
// texto ao cliente = template FIXO do catálogo (config/dependencias-cliente.json) passado pelo auditor; R$ só com o que o sistema mede ou prevê (ML);
// Shopee/Amazon/TikTok/Magalu nunca têm R$; sem base = "Impacto não estimado" (nunca zero); associação ≠ causalidade.
import { TIPOS } from './dependencia-cliente.js'
import { url as validarUrl } from './ficha-nucleo.js'
import { canalDe } from './semanal-resultados.js'
import { riscoRuptura } from './lead-time.js'                // V3 F3: a fórmula ÚNICA da receita em risco (com o produto: o estoque físico inteiro, o Flex que segue vendendo)
import { fatoAproximado } from './pendencias-texto.js'     // puro, sem import: texto único das pendências (a evidência ao cliente com data aproximada nunca leva dias)

export const SCHEMA_PENDENCIAS = `
CREATE TABLE IF NOT EXISTS pendencia_cliente (    -- pendência do cliente registrada à mão (canal sem integração, obrigação sem card)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                          -- nome canônico da central (nunca prospect)
  canal TEXT NOT NULL,                            -- ml | shopee | amazon | tiktok | magalu
  item TEXT NOT NULL,                             -- id do catálogo (config/dependencias-cliente.json)
  detalhe TEXT NOT NULL DEFAULT '',               -- ≤300, INTERNO: nunca vai ao cliente (o texto do cliente é o template do catálogo)
  desde TEXT NOT NULL DEFAULT '',                 -- AAAA-MM-DD: desde quando espera o cliente
  evidencia TEXT NOT NULL DEFAULT '',             -- URL http(s) ≤500 (print, e-mail, WhatsApp, Drive)
  gravidade TEXT NOT NULL DEFAULT '',             -- critico | atencao | info
  por TEXT NOT NULL,                              -- nome canônico de líder/consultor
  criada_em TEXT NOT NULL,                        -- ISO
  resolvida_em TEXT NOT NULL DEFAULT '',          -- '' = aberta
  resolvida_por TEXT NOT NULL DEFAULT '',
  nota TEXT NOT NULL DEFAULT ''                   -- ≤300, interna
);
CREATE INDEX IF NOT EXISTS ix_pendencia_cliente ON pendencia_cliente (cliente, resolvida_em);
`

export const GRAVIDADES = ['critico', 'atencao', 'info']
const RANK = { critico: 0, atencao: 1, info: 2 }
const DETECCOES = ['medido', 'tarefa', 'registro'], METODOS = ['ruptura_receita', 'acoes_paradas', 'nenhum']
const CAMPOS = ['por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos']
const TOKENS = new Set(['produtos', 'n', 'canal', 'dias'])
const AMOSTRA = { produtos: 'Produto de exemplo', n: 2, canal: 'Shopee', dias: 15 }
const CANAL_ID = { 'Mercado Livre': 'ml', Shopee: 'shopee', Amazon: 'amazon', 'TikTok Shop': 'tiktok', Magalu: 'magalu' }
export const canalDaTarefa = processo => CANAL_ID[canalDe(processo)] || 'geral'    // pelo processo da tarefa (Notion): 'Shopee 1' → shopee, 'Magazine Luiza' → magalu
const RX_PS = /·\s*(PS-[0-9a-f]{10})\b/i                                           // mesmo sufixo de vinculos.RX_PS (id da ação do plano no título do card)

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''                              // fronteira de confiança: objeto/array nunca vira '[object Object]'
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const dm = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—'
const dmy = iso => iso ? `${dm(iso)}/${iso.slice(0, 4)}` : '—'
const brl = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR')
const pl = (n, s, p) => n === 1 ? s : p
const dos = (n, total) => n === total ? (n === 1 ? 'o produto que mais vende' : `os ${n} produtos que mais vendem`) : `${n} dos ${total} produtos que mais vendem`
const diasEntre = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000))
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const horasDesde = (iso, agoraIso) => { const t = Date.parse(iso); return Number.isFinite(t) ? (Date.parse(agoraIso) - t) / 3_600_000 : null }
const dataReal = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s

// nome de produto para texto de cliente: curto, sem ID/MLB/código longo, sem chave/colchete (nada vira token de template)
export function nomeCurto(t, max = 40) {
  let s = String(t ?? '').replace(/\bMLB-?\d+\b/gi, ' ').replace(/\b\d{6,}\b/g, ' ').replace(/[\u0000-\u001f<>{}[\]|]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > max) { s = s.slice(0, max); s = s.slice(0, Math.max(s.lastIndexOf(' '), 12)).replace(/[\s,;:\-–·/]+$/, '') }
  return s
}
const listaNomes = (nomes, total = nomes.length) => {
  const l = nomes.slice(0, 3), extra = total - l.length
  const base = l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l.at(-1)}` : l[0] || ''
  return extra > 0 ? `${base} e mais ${extra}` : base
}

// ── catálogo: validação na carga (config editável à mão: erro de digitação derruba com mensagem clara) ──
const textoDe = (v, canal) => typeof v === 'string' ? v : (v[canal] ?? v.padrao)
const preencher = (t, vals) => t.replace(/\{(\w+)\}/g, (m, k) => Object.hasOwn(vals, k) ? String(vals[k]) : m)
export function validarCatalogo(c, { auditar } = {}) {
  const falha = m => { throw new Error(`config/dependencias-cliente.json: ${m}`) }
  const canais = new Set((c?.canais || falha('falta "canais"')).map(x => x.id))
  const grav = new Set((c.gravidades || falha('falta "gravidades"')).map(x => x.id))
  if (!GRAVIDADES.every(g => grav.has(g))) falha('"gravidades" precisa de critico, atencao e info')
  const e = c.limiares?.estoque || falha('falta "limiares.estoque"')
  for (const k of ['cobertura_atencao_dias', 'cobertura_critica_dias', 'unidades_min_28d', 'frescor_max_horas']) if (!(Number(e[k]) > 0)) falha(`limiares.estoque.${k} inválido`)
  if (e.cobertura_critica_dias > e.cobertura_atencao_dias) falha('cobertura crítica não pode ser maior que a de atenção')
  if (!Array.isArray(e.curvas_alerta) || !Array.isArray(e.curvas_avaliar)) falha('limiares.estoque.curvas_alerta/curvas_avaliar precisam ser listas')
  if (!(Number(c.limiares?.conta_ml?.sem_renovar_horas) > 0)) falha('limiares.conta_ml.sem_renovar_horas inválido')
  const itens = c.itens || falha('falta "itens"')
  if (!itens.retorno_pendente) falha('falta o item "retorno_pendente" (classe das tarefas sem tipo registrado)')
  for (const [id, it] of Object.entries(itens)) {
    const f = m => falha(`item "${id}": ${m}`)
    if (!/^[a-z][a-z0-9_]*$/.test(id)) f('id precisa ser minúsculo com "_"')
    if (!it.rotulo || !it.parado) f('falta rotulo/parado')
    if (!Array.isArray(it.canais) || !it.canais.length || !it.canais.every(k => canais.has(k) && k !== 'geral')) f('canais inválidos')
    if (!Object.hasOwn(TIPOS, it.tipo)) f('tipo fora de TIPOS')
    if (!Array.isArray(it.tipos_tarefa) || !it.tipos_tarefa.every(t => Object.hasOwn(TIPOS, t))) f('tipos_tarefa inválido')
    if (!grav.has(it.gravidade_base)) f('gravidade_base inválida')
    if (!DETECCOES.includes(it.deteccao)) f('deteccao inválida')
    if (!METODOS.includes(it.metodo_impacto)) f('metodo_impacto inválido')
    if (it.deteccao === 'medido' && !(Array.isArray(it.medido_em) && it.medido_em.length && it.medido_em.every(k => it.canais.includes(k)))) f('medido exige medido_em ⊂ canais')
    for (const campo of CAMPOS) {
      const v = it[campo]
      if (!v) f(`falta ${campo}`)
      if (typeof v !== 'string') { if (typeof v.padrao !== 'string') f(`${campo} sem "padrao"`); for (const k of Object.keys(v)) if (k !== 'padrao' && !it.canais.includes(k)) f(`${campo}: canal "${k}" fora do item`) }
      for (const t of typeof v === 'string' ? [v] : Object.values(v)) {
        if (typeof t !== 'string' || t.length < 20) f(`${campo}: texto vazio`)
        for (const m of t.matchAll(/\{(\w+)\}/g)) {
          if (!TOKENS.has(m[1])) f(`${campo}: token {${m[1]}} desconhecido`)
          if (m[1] === 'produtos' && !it.produtos_padrao) f('usa {produtos} sem produtos_padrao')
        }
        if (/\{|\}/.test(t.replace(/\{\w+\}/g, ''))) f(`${campo}: chave solta`)
      }
    }
    if (auditar) {                                                   // TODO texto ao cliente passa pelo auditor, com e sem os valores de exemplo
      const textos = [it.rotulo, it.parado, ...CAMPOS.flatMap(k => typeof it[k] === 'string' ? [it[k]] : Object.values(it[k]))]
      for (const t of textos) { const v = auditar(preencher(t, { ...AMOSTRA, produtos: it.produtos_padrao || AMOSTRA.produtos })); if (v.length) f(`texto reprovado pelo auditor (${[...new Set(v.map(x => x.codigo))].join(', ')}): ${t.slice(0, 50)}…`) }
    }
  }
  return c
}

// sugestão INTERNA de tipo para a tela do líder (nunca classifica a pendência, nunca vai ao cliente)
const SUGESTOES = [[/foto|imagem|imagens|video/, 'fotos'], [/anvisa|inmetro|categoria restrita/, 'regulatorio'], [/certificado|contrato social|documento|nota fiscal|\bnf\b/, 'documentos'],
  [/acesso|login|senha|subconta/, 'acesso'], [/preco|custo|margem/, 'custos'], [/estoque|reposicao/, 'produto'], [/remessa|\bfba\b|\bfull\b|despacho|envio/, 'logistica'],
  [/aprova|autoriza/, 'aprovacao'], [/\bsac\b|chat|mensagem|pergunta|atendimento/, 'atendimento'], [/cadastr|planilha|\bsku\b|peso|medida|ficha/, 'informacao']]
export const sugestaoTipo = titulo => { const t = norm(titulo); return SUGESTOES.find(([rx]) => rx.test(t))?.[1] || null }

// deps: handle (better-sqlite3, com SCHEMA_PENDENCIAS), dependencias.listar({ cliente, hoje }) (criarDependencias), catalogo (validarCatalogo),
//       riscoEstoque(cliente, hoje) → null | { itens:[{ id, titulo, curva, status, estoque, cobertura, u, r, fotos, catalogo, custo_unitario, atualizado_em }],
//         atualizado_em, janela_dias, lead_time_dias, fotos_minimas, custos_conta_informados } — só banco local, NUNCA chamada ao vivo,
//       contasMl(cliente) → null | { erro, atualizado_em }, acoesPlano(cliente, ids[]) → Map(ID MAIÚSCULO → valor_esperado|null),
//       hoje() 'AAAA-MM-DD', agora() ISO, auditar(texto) → violações[] (relatorio-seguro.auditarTexto), validarPor(nome) → nome canônico|'',
//       visiveis(cliente, ids[]) → Set(id) das tarefas com visivel_cliente = 1 (ausente = não filtra; a fiação real sempre injeta). Texto ao cliente (paraCliente, padrão) só conta tarefas visíveis;
//       Resumo e plano de ação (internos) pedem paraCliente:false e veem todas.
//       editavelConteudo(item) → bool: anúncio cujo conteúdo (fotos, título, descrição, ficha) o vendedor consegue alterar. Padrão: !item.catalogo — anúncio de
//       CATÁLOGO do ML tem o conteúdo controlado pelo catálogo, então mídia e dados do produto NÃO são pedidos ao cliente por causa dele
//       (estoque, preço/custo, Ads e conta continuam valendo). A frente de catálogo troca o predicado quando definir "catálogo próprio editável".
//       saude(cliente, dia) → lerSaude() | null (v1.5.0, saude-coleta, só banco local): despacho_prazo e atendimento_sac passam de registro a MEDIDO no ML quando
//       há leitura do dia (hoje/ontem) sem pendente no bloco; ausente (null) = nada medido. Texto ao cliente segue o template fixo; impacto não estimado (o valor do pedido não é gravado).
//       alinhado(cliente, dia) → predicado do núcleo dos alinhamentos (src/lib/alinhamentos.js) + idAcao(cliente, regra, alvo) (plano-cliente): pendência coberta por alinhamento
//         com o cliente SOME (contada em `alinhadas`, interno) — a do plano pelo id da ação 'pendencia_cliente' (descarte), a de tarefa pela regra 'bloqueio_cliente'; dentro das
//         medidas, o anúncio alinhado sai da lista (estoque → estoque_ruptura, custo → cadastrar_custos, mídia → conteudo_fotos). Ausente = nada some.
export function criarPendencias({ handle, dependencias, riscoEstoque, contasMl, acoesPlano, visiveis, hoje, agora, catalogo, auditar = () => [], validarPor = () => '', editavelConteudo = item => !item.catalogo, saude = null, alinhado = null, idAcao = null }) {
  const cat = catalogo, itensCat = cat.itens, E = cat.limiares.estoque, CM = cat.limiares.conta_ml
  const rotuloCanal = id => cat.canais.find(c => c.id === id)?.rotulo || id
  const rotuloGrav = id => cat.gravidades.find(g => g.id === id)?.rotulo || id
  const violou = t => auditar(String(t)).length > 0
  const limpo = (t, reserva) => violou(t) ? reserva : t                       // evidência/rótulo/premissa também podem chegar ao cliente
  const nomesLimpos = ts => ts.map(t => nomeCurto(t)).filter(n => n && !violou(n))   // produto cujo nome tropeça no auditor ("garantia…") some do texto

  // ── texto ao cliente: template do catálogo + substituição SEGURA (só {produtos} {n} {canal} {dias}); reprovado pelo auditor → texto genérico ──
  function explicar(p) {
    const it = itensCat[p.item]; if (!it) return null
    const gera = produtos => Object.fromEntries(CAMPOS.map(k => [k, preencher(textoDe(it[k], p.canal), { produtos, n: p.tarefas || 1, canal: p.canal_rotulo, dias: p.dias ?? '—' })]))
    const padrao = it.produtos_padrao || 'produtos da loja'
    let out = gera(listaNomes(nomesLimpos(p.produtos || [])) || padrao)
    if (violou(Object.values(out).join('\n'))) out = gera(padrao)
    return { rotulo: it.rotulo, canal_rotulo: p.canal_rotulo, ...out }
  }

  const semEstimativa = rotulo => ({ tipo: 'sem_estimativa', valor_brl: null, rotulo, premissa: null })
  const semBase = (it, n, d) => semEstimativa(n ? `Impacto não estimado: ${n} tarefa(s) parada(s)${d != null ? ` há ${d} dia(s)` : ''}` : `Impacto não estimado (parado: ${it.parado})`)

  function montar(d) {                                                          // d → Pendencia no formato do contrato (+ campos aditivos no fim)
    const it = itensCat[d.item], canal_rotulo = rotuloCanal(d.canal)
    const p = {
      id: `${d.item}|${d.canal}|${d.chave}`, item: d.item, rotulo: it.rotulo, canal: d.canal, canal_rotulo, tipo: it.tipo, fonte: d.fonte,
      gravidade: d.gravidade, gravidade_rotulo: rotuloGrav(d.gravidade), desde: d.desde ?? null, dias: d.dias ?? null,
      evidencia: limpo(d.evidencia, 'Detalhes disponíveis com a equipe.'), por_que_importa: '', efeito_se_atrasar: '', o_que_precisamos: '', o_que_fazemos: '',
      impacto: d.impacto, tarefas: d.tarefas || 0, registro_id: d.registro_id ?? null,
      // aditivos: produtos (nomes curtos e limpos, seguros ao cliente), medido_em (ISO da leitura), desde_aproximado, detalhe_interno (NUNCA ao cliente)
      produtos: d.produtos || [], medido_em: d.medido_em ?? null, desde_aproximado: !!d.desde_aproximado, detalhe_interno: d.detalhe_interno || '',
      // INTERNO (alerta-cliente.js: assinatura e reconferência ao vivo; NUNCA vai ao cliente): estoque = até 10 anúncios em risco por receita, com cobertura e vendas/dia medidas
      anuncios: d.anuncios || [],
    }
    if (p.impacto.premissa) p.impacto = { ...p.impacto, premissa: limpo(p.impacto.premissa, 'Estimativa com premissas declaradas pela equipe.') }
    const t = explicar(p)
    for (const k of CAMPOS) p[k] = t[k]
    return p
  }

  // ── (a) MEDIDO: Mercado Livre, só banco local ──
  const relevante = i => i.status === 'active' || (i.status === 'paused' && i.estoque === 0)   // pausado por falta de estoque é ruptura; pausa deliberada com estoque, não
  const porReceita = (a, b) => (b.r || 0) - (a.r || 0)
  function medidoMl(cliente, dia, out, fora = l => l) {
    const base = riscoEstoque ? riscoEstoque(cliente, dia) : null
    if (base?.itens?.length) {
      const ativos = base.itens.filter(relevante), ab = ativos.filter(i => E.curvas_avaliar.includes(i.curva)), lido = (base.atualizado_em || '').slice(0, 10) || null
      const janela = base.janela_dias || 28
      // estoque dos produtos que mais vendem: cobertura curta com volume mínimo
      // V3 F3 (com a chave: i.produto.ligado): 1 linha por estoque físico (o representante), com as vendas e a receita do estoque inteiro — um produto não se repete
      const lig = i => i.produto?.ligado === true, uE = i => (lig(i) ? i.produto.u_ef : i.u) || 0, rE = i => (lig(i) ? i.produto.r_ef : i.r) || 0
      const baixos = fora(ab.filter(i => i.estoque != null && i.cobertura != null && i.cobertura < E.cobertura_atencao_dias && uE(i) >= E.unidades_min_28d && (!lig(i) || i.produto.representa_estoque !== false)), 'estoque_ruptura', 'estoque_curva_a|ml').sort(porReceita)
      if (baixos.length) {
        const maisVelha = baixos.map(i => i.atualizado_em).filter(Boolean).sort()[0] || ''
        const h = horasDesde(maisVelha, agora()), fresco = h != null && h <= E.frescor_max_horas      // sem data = não é fresco
        const crit = fresco && baixos.some(i => E.curvas_alerta.includes(i.curva) && i.cobertura < E.cobertura_critica_dias)
        const cobs = baixos.map(i => i.cobertura), menor = Math.min(...cobs), maior = Math.max(...cobs)
        const rec = baixos.reduce((t, i) => t + rE(i), 0), lead = base.lead_time_dias
        // prazo de cada anúncio (v1.6.0): o informado pelo cliente/equipe vence a premissa; o texto só diz «informado» quando todos os da lista têm prazo informado
        const leadDe = i => Number.isFinite(i.lead_time_dias) ? i.lead_time_dias : lead, informado = baixos.every(i => i.lead_time_fonte === 'cliente' || i.lead_time_fonte === 'equipe')
        const leads = [...new Set(baixos.map(leadDe))].sort((a, b) => a - b), prazoTxt = informado ? `com o prazo de reposição informado (${leads.length > 1 ? `${leads[0]} a ${leads.at(-1)}` : leads[0]} dias)` : `com prazo de reposição de ${lead} dias (referência da Place2u, ajustável ao fornecedor)`
        const risco = Number.isFinite(lead) ? baixos.reduce((t, i) => t + (lig(i) ? riscoRuptura(i, { lead_time_reposicao_dias: lead, cobertura_critica_dias: E.cobertura_atencao_dias }).risco : ((i.r || 0) / janela) * Math.max(0, leadDe(i) - i.cobertura)), 0) : 0
        const nomes = nomesLimpos(baixos.map(i => i.titulo))
        const impacto = risco > 0 ? {
          tipo: 'previsto', valor_brl: Math.round(risco), rotulo: `Receita possivelmente em risco: ${brl(risco)} (estimativa)`,
          premissa: `Estimativa: receita por dia medida nos últimos ${janela} dias (${brl(rec / janela)} por dia nestes produtos) × dias sem estoque até a reposição, ${prazoTxt}. Hipótese de cenário base, não promessa de resultado.`,
        } : semBase(itensCat.estoque_curva_a, 0, null)
        const anuncios = baixos.slice(0, 10).map(i => ({ id: String(i.id), curva: i.curva, cobertura_dias: i.cobertura, estoque: i.estoque, vendas_dia: janela > 0 ? (i.u || 0) / janela : null }))
        out.push(montar({ item: 'estoque_curva_a', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: crit ? 'critico' : 'atencao', medido_em: maisVelha || null, produtos: nomes, anuncios, impacto,
          evidencia: `Leitura de estoque de ${dm(maisVelha.slice(0, 10))}: ${baixos.length} dos produtos que mais vendem ${pl(baixos.length, 'tem', 'têm')} estoque para ${menor}${maior !== menor ? ` a ${maior}` : ''} dia(s) no ritmo das vendas dos últimos ${janela} dias; juntos venderam ${brl(rec)} nesse período (${brl(rec / janela)} por dia)${nomes.length ? `: ${listaNomes(nomes, baixos.length)}` : ''}.${fresco ? '' : ' Leitura com mais de um dia: confirmar o estoque atual antes de agir.'}` }))
      }
      // prazo do fornecedor/produção (v1.6.0): produto que mais vende vendendo e sem prazo informado → ponto de reposição e previsão de compras rodam na premissa.
      // Informativo, sem culpa, sem R$ (fica no Resumo e nos relatórios; não vira ação do plano); some quando o prazo é cadastrado (conta toda, anúncio ou SKU)
      const semPrazo = itensCat.prazo_fornecedor ? fora(ab.filter(i => (i.u || 0) > 0 && i.lead_time_fonte === 'premissa'), 'informar_lead_time', 'prazo_fornecedor|ml') : []
      if (semPrazo.length) out.push(montar({ item: 'prazo_fornecedor', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: itensCat.prazo_fornecedor.gravidade_base, medido_em: base.atualizado_em || null,
        impacto: semBase(itensCat.prazo_fornecedor, 0, null),
        evidencia: `Ainda não temos registrado o prazo entre o pedido e a chegada dos produtos; o cálculo de reposição usa ${base.lead_time_dias} dias como referência.` }))
      // V3 F3 (só com a chave produto.diagnostico_ligado: i.produto existe): produto curva A/B em 2+ anúncios com estoque próprio separado e o MESMO número (espelho provável,
      // sem estoque declarado válido) → pergunta ao cliente quantas unidades existem; decisão do David (14/10): só A/B, no máximo 2 por cliente por plano; informativo, sem R$
      const esp = itensCat.estoque_espelhado ? fora(ab.filter(i => i.produto?.ligado === true && i.produto.representa_produto && i.produto.modo_proprio === 'espelho_provavel'), 'estoque_dividido', 'estoque_espelhado|ml').sort(porReceita).slice(0, 2) : []
      if (esp.length) out.push(montar({ item: 'estoque_espelhado', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: itensCat.estoque_espelhado.gravidade_base, medido_em: base.atualizado_em || null,
        produtos: nomesLimpos(esp.map(i => i.titulo)), anuncios: esp.map(i => ({ id: String(i.id), curva: i.curva, n_anuncios: i.produto.n_anuncios })), impacto: semBase(itensCat.estoque_espelhado, 0, null),
        evidencia: `Leitura de ${dm(lido)}: ${esp.length} dos produtos que mais vendem ${pl(esp.length, 'está', 'estão')} em mais de um anúncio com estoque próprio e o mesmo número em todos (${esp.map(i => `${i.produto.n_anuncios} anúncios`).join(', ')}); contamos esse estoque uma vez até a confirmação.` }))
      // custos: sem custo geral da loja e produtos que mais vendem sem custo do anúncio → margem, ROAS alvo e desconto ficam sem cálculo
      if (!base.custos_conta_informados && ab.length) {
        const sem = fora(ab.filter(i => i.custo_unitario == null), 'cadastrar_custos', 'preco_custo|ml').sort(porReceita)
        if (sem.length) out.push(montar({ item: 'preco_custo', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: itensCat.preco_custo.gravidade_base, medido_em: base.atualizado_em || null,
          produtos: nomesLimpos(sem.map(i => i.titulo)), impacto: semBase(itensCat.preco_custo, 0, null),
          evidencia: `Leitura de ${dm(lido)}: ${dos(sem.length, ab.length)} ${pl(sem.length, 'está', 'estão')} sem custo informado, e a loja não tem custos gerais cadastrados.` }))
      }
      // mídia: só anúncio de conteúdo editável (catálogo do ML tem o conteúdo controlado pelo catálogo) e só enquanto a mídia mínima não existe
      const editaveis = ab.filter(editavelConteudo), min = base.fotos_minimas
      if (Number.isFinite(min)) {
        const poucas = fora(editaveis.filter(i => i.fotos != null && i.fotos < min), 'conteudo_fotos', 'midia_produto|ml').sort(porReceita)
        if (poucas.length) out.push(montar({ item: 'midia_produto', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: 'info', medido_em: base.atualizado_em || null,
          produtos: nomesLimpos(poucas.map(i => i.titulo)), impacto: semBase(itensCat.midia_produto, 0, null),
          evidencia: `Leitura de ${dm(lido)}: ${dos(poucas.length, editaveis.length)} ${pl(poucas.length, 'tem', 'têm')} menos de ${min} imagens no anúncio.` }))
      }
    }
    // acesso à conta: erro registrado pelo ML ou conexão sem renovar além do limiar
    const c = contasMl ? contasMl(cliente) : null
    if (c) {
      const h = horasDesde(c.atualizado_em, agora()), parada = h != null && h > CM.sem_renovar_horas
      if (c.erro || parada) out.push(montar({ item: 'acesso_conta', canal: 'ml', chave: 'resumo', fonte: 'medido', gravidade: c.erro ? 'critico' : 'atencao', medido_em: c.atualizado_em || null,
        impacto: semBase(itensCat.acesso_conta, 0, null),
        evidencia: c.erro ? `Em ${dm((c.atualizado_em || '').slice(0, 10))}, o Mercado Livre informou que o acesso à conta precisa ser autorizado novamente.`
          : `A última renovação do acesso à conta do Mercado Livre foi em ${dm((c.atualizado_em || '').slice(0, 10))}, há mais de ${CM.sem_renovar_horas} horas.` }))
    }
    // saúde da conta GRAVADA (v1.5.0; saude-coleta → lerSaude, só banco local): despacho e atendimento viram MEDIDO só com leitura do dia e bloco sem pendente
    // (403, endpoint não verificado ou API indisponível = nada medido, nunca zero). Evidência = contagem datada; impacto não estimado (valor do pedido não é gravado);
    // `anuncios` leva os item_ids (assinatura do alerta); reputação fora do verde fica no detalhe INTERNO, nunca no texto ao cliente. Mediação = crítico (alerta ao cliente).
    const s = saude ? saude(cliente, dia) : null
    if (s?.do_dia) {
      const SM = cat.limiares.saude_ml || {}, lido = dm(s.dia), rep = s.reputacao || {}
      const interno = rep.nivel && rep.nivel !== '5_green' ? `Reputação ${rep.nivel} na leitura de ${lido}.` : ''
      const idsDe = lst => [...new Set((lst || []).map(x => x.item_id).filter(Boolean))].slice(0, 10).map(id => ({ id: String(id) }))
      if (!s.pendente?.atrasos && s.atrasos >= 1) {
        const n = s.atrasos
        out.push(montar({ item: 'despacho_prazo', canal: 'ml', chave: 'saude', fonte: 'medido', gravidade: n >= (SM.atrasos_critico ?? Infinity) ? 'critico' : 'atencao', medido_em: s.coletado_em || null,
          anuncios: idsDe(s.listas?.atrasos), detalhe_interno: interno, impacto: semBase(itensCat.despacho_prazo, 0, null),
          evidencia: `Leitura de ${lido}: ${n} pedido(s) pago(s) dos últimos dias ${pl(n, 'está', 'estão')} com o prazo de despacho vencido e ainda sem envio registrado.` }))
      }
      const perg = !s.pendente?.perguntas && s.perguntas?.mais_de_24h >= 1 ? s.perguntas.mais_de_24h : 0
      const recl = !s.pendente?.reclamacoes && s.reclamacoes?.abertas >= 1 ? s.reclamacoes.abertas : 0, med = recl ? s.reclamacoes.mediacoes || 0 : 0
      if (perg || recl) {
        const partes = [perg ? `${perg} pergunta(s) de compradores sem resposta há mais de 24 horas` : '', recl ? `${recl} reclamação(ões) aberta(s)${med ? `, ${med} em mediação` : ''}` : ''].filter(Boolean)
        out.push(montar({ item: 'atendimento_sac', canal: 'ml', chave: 'saude', fonte: 'medido', gravidade: med ? 'critico' : 'atencao', medido_em: s.coletado_em || null,
          anuncios: idsDe([...(recl ? s.listas?.claims || [] : []), ...(perg ? (s.listas?.perguntas || []).filter(p => p.mais_de_24h) : [])]), detalhe_interno: interno, impacto: semBase(itensCat.atendimento_sac, 0, null),
          evidencia: `Leitura de ${lido}: ${partes.join(' e ')}.` }))
      }
    }
  }

  // ── (b) TAREFAS em dependência do cliente: classificadas pelo tipo REGISTRADO + canal do processo (nunca pelo texto) ──
  function itemDaTarefa(tipo, canal) {
    if (!tipo) return 'retorno_pendente'
    const cands = Object.entries(itensCat).filter(([, it]) => it.tipos_tarefa.includes(tipo) && (canal === 'geral' || it.canais.includes(canal)))
      .sort((a, b) => a[1].canais.length - b[1].canais.length)                 // mais específico vence (remessa FBA/Full antes de despacho para amazon/ml)
    return cands[0]?.[0] || 'retorno_pendente'
  }
  const gravDeFaixa = (faixa, base) => faixa === 'revisar' ? 'critico' : faixa === 'cobrar' ? (base === 'critico' ? 'critico' : 'atencao') : 'info'
  const ate = (g, teto) => RANK[g] < RANK[teto] ? teto : g                       // nunca mais grave que o teto
  function impactoTarefas(cliente, canal, it, rows, d) {
    if (canal !== 'ml' || it.metodo_impacto !== 'acoes_paradas' || !acoesPlano) return semBase(it, rows.length, d)    // Shopee/Amazon/TikTok/Magalu nunca têm R$
    const ids = [...new Set(rows.map(r => RX_PS.exec(r.titulo || '')?.[1]?.toUpperCase()).filter(Boolean))]
    const mapa = ids.length ? acoesPlano(cliente, ids) : new Map()
    const soma = ids.reduce((t, id) => t + (Number(mapa.get(id)) > 0 ? Number(mapa.get(id)) : 0), 0)
    if (!(soma > 0)) return semBase(it, rows.length, d)
    return { tipo: 'previsto', valor_brl: Math.round(soma),
      rotulo: `Possível impacto: ${brl(soma)} (previsão das ações do plano ligadas às tarefas paradas)`,
      premissa: 'Soma do valor esperado (probabilidade × cenário base, horizonte de 28 dias) das ações do plano ligadas às tarefas paradas. É previsão com premissas, não promessa de resultado.' }
  }
  function porTarefas(cliente, dia, out, paraCliente) {
    let linhas = dependencias.listar({ cliente, hoje: dia })
    if (paraCliente && visiveis && linhas.length) { const v = visiveis(cliente, linhas.map(r => r.id)); linhas = linhas.filter(r => v.has(String(r.id))) }   // texto ao cliente: só tarefa que o cliente vê
    const grupos = new Map()
    for (const r of linhas) {
      const canal = canalDaTarefa(r.processo), item = itemDaTarefa(r.tipo, canal), k = `${item}|${canal}`
      ;(grupos.get(k) || grupos.set(k, { item, canal, rows: [] }).get(k)).rows.push(r)
    }
    for (const { item, canal, rows } of grupos.values()) {
      const it = itensCat[item], n = rows.length
      const datadas = rows.filter(r => r.desde).sort((a, b) => a.desde.localeCompare(b.desde))
      const velha = datadas[0] || null, desde = velha?.desde ?? null, dias = velha ? velha.dias : null
      const aprox = velha?.desde_origem === 'ultima_edicao'
      // política de tom (08/10): data aproximada (última edição do card) e tarefa SEM tipo registrado (retorno_pendente) nunca passam de "atenção" — sem registro do que foi
      // pedido ao cliente o sistema não afirma gravidade. Crítica só com tipo registrado + data real, registro manual ou medição (estoque curva A fresca, conta ML com erro).
      const grav = item === 'retorno_pendente' || aprox ? ate(gravDeFaixa(velha?.faixa || 'aguardando', it.gravidade_base), 'atencao') : gravDeFaixa(velha?.faixa || 'aguardando', it.gravidade_base)
      const aguardam = `${n} ${pl(n, 'tarefa aguarda', 'tarefas aguardam')} o retorno do cliente`
      // interno (Resumo): contagem de dias + de onde veio a data; ao cliente, data aproximada nunca vira contagem de dias
      const interna = desde ? `${aguardam}; a mais antiga desde ${dmy(desde)} (${dias} dia(s)${aprox ? '; data aproximada pela última atualização da tarefa' : ''}).` : `${aguardam}; sem data de início registrada.`
      out.push(montar({ item, canal, chave: 'tarefas', fonte: 'tarefa', gravidade: grav, desde, dias, tarefas: n,
        desde_aproximado: aprox, impacto: impactoTarefas(cliente, canal, it, rows, aprox ? null : dias),
        evidencia: aprox && paraCliente ? fatoAproximado(n, desde) : interna }))
    }
    return linhas.map(r => ({ id: r.id, titulo: r.titulo, url: r.url, dias: r.desde ? r.dias : null, canal: canalDaTarefa(r.processo), canal_rotulo: rotuloCanal(canalDaTarefa(r.processo)),
      tipo_rotulo: r.tipo_rotulo, item: itemDaTarefa(r.tipo, canalDaTarefa(r.processo)), ...(r.tipo ? {} : { sugestao_tipo: sugestaoTipo(r.titulo) }) }))
  }

  // ── (c) REGISTRO manual ──
  const linhaReg = handle.prepare('SELECT * FROM pendencia_cliente WHERE id = ?')
  function doRegistro(r, dia) {
    const it = itensCat[r.item], desde = r.desde || (r.criada_em || '').slice(0, 10) || null, dias = desde ? diasEntre(desde, dia) : null
    const grav = GRAVIDADES.includes(r.gravidade) ? r.gravidade : it.gravidade_base
    return montar({ item: r.item, canal: r.canal, chave: `r${r.id ?? 'novo'}`, fonte: 'registro', gravidade: grav, desde, dias, registro_id: r.id ?? null, detalhe_interno: r.detalhe,
      impacto: semBase(it, 0, null),
      evidencia: `Pendência registrada pela equipe em ${dmy((r.criada_em || '').slice(0, 10))}${desde && desde !== (r.criada_em || '').slice(0, 10) ? `; aguardando desde ${dmy(desde)}` : ''}${dias != null ? ` (${dias} dia(s))` : ''}.` })
  }
  function porRegistros(cliente, dia, out) {
    for (const r of handle.prepare("SELECT * FROM pendencia_cliente WHERE cliente = ? AND resolvida_em = '' ORDER BY id").all(cliente))
      if (itensCat[r.item]) out.push(doRegistro(r, dia))                         // item removido do catálogo: a linha fica no banco, mas não vira texto
  }

  const ordem = (a, b) => RANK[a.gravidade] - RANK[b.gravidade] || (b.impacto.valor_brl ?? -1) - (a.impacto.valor_brl ?? -1) || (b.dias ?? -1) - (a.dias ?? -1) || a.id.localeCompare(b.id)

  // avaliar: a ÚNICA fonte de pendências (plano, Resumo, relatórios, alerta). Pura: só leitura.
  // `paraCliente` (padrão true): texto que pode chegar ao cliente — só tarefas visíveis a ele e evidência sem contagem de dias quando a data é aproximada.
  // As telas e rotas INTERNAS (Resumo, plano de ação) pedem paraCliente:false.
  function avaliar(cliente, { hoje: h, paraCliente = true } = {}) {
    cliente = str(cliente)
    if (!cliente || ehProspecto(cliente)) throw erro('cliente inválido para pendências')
    const dia = h || hoje(), todas = []
    // alinhamento com o cliente (aviso:true): o predicado do núcleo decide; aqui só se conta o que saiu
    const al = alinhado && idAcao ? alinhado(cliente, dia) : null
    let alinhadas = 0
    const chavesAlinhadas = new Set()                                            // 'item|canal' de onde algo saiu por alinhamento: o alerta não confunde com resolução
    const fora = (lista, regra, chave) => { if (!al) return lista; const f = lista.filter(i => !al({ item: String(i.id), regra, aviso: true }).sim); alinhadas += lista.length - f.length; if (f.length < lista.length) chavesAlinhadas.add(chave); return f }
    medidoMl(cliente, dia, todas, fora)
    const tarefas = porTarefas(cliente, dia, todas, paraCliente !== false)
    porRegistros(cliente, dia, todas)
    const itens = !al ? todas : todas.filter(p => {
      const q = p.fonte === 'tarefa' ? { regra: 'bloqueio_cliente', aviso: true } : { regra: 'pendencia_cliente', acao: idAcao(cliente, 'pendencia_cliente', p.id), aviso: true }
      if (al(q).sim) { alinhadas++; chavesAlinhadas.add(`${p.item}|${p.canal}`); return false }
      return true
    })
    itens.sort(ordem)
    const comValor = itens.filter(p => p.impacto.valor_brl != null)
    const impacto = comValor.length ? {
      valor_brl: comValor.reduce((t, p) => t + p.impacto.valor_brl, 0), tipo: comValor.every(p => p.impacto.tipo === 'medido') ? 'medido' : 'previsto',
      premissa: [...new Set(comValor.map(p => p.impacto.premissa).filter(Boolean))].join(' ') || null } : null
    return { cliente, gerado_em: agora(), resumo: { total: itens.length, criticas: itens.filter(p => p.gravidade === 'critico').length, atencao: itens.filter(p => p.gravidade === 'atencao').length, impacto }, itens, tarefas,
      ...(al ? { alinhadas, alinhadas_itens: [...chavesAlinhadas] } : {}) }      // INTERNO (só com o predicado ligado): pendências e anúncios omitidos por alinhamento com o cliente
  }

  // registrar / resolver: prévia por padrão (nenhuma escrita); confirmar === true estrito; mensagens fixas, nunca ecoam o valor recebido
  function porValido(b, verbo) {
    const por = str(b.por)
    if (!por) throw erro(`informe "por" (quem ${verbo} — líder ou consultor)`)
    const ok = validarPor(por)
    if (!ok) throw erro(`somente líder ou consultor da central ${verbo} pendências do cliente`, 403)
    return String(ok).slice(0, 80)
  }
  function registrar(b = {}) {
    const cliente = str(b.cliente), dia = hoje()
    if (!cliente) throw erro('informe "cliente"')
    if (ehProspecto(cliente)) throw erro('cliente inválido para pendências')
    const item = str(b.item)
    if (!Object.hasOwn(itensCat, item) || item === 'retorno_pendente') throw erro('item de pendência desconhecido — escolha um do catálogo')
    const canal = str(b.canal)
    if (!itensCat[item].canais.includes(canal)) throw erro('canal não se aplica a este item — escolha um da lista')
    const detalhe = str(b.detalhe)
    if (detalhe.length < 3 || detalhe.length > 300) throw erro('descreva a pendência (de 3 a 300 caracteres)')
    const desde = b.desde === undefined || b.desde === null || b.desde === '' ? dia : str(b.desde)
    if (!dataReal(desde) || desde > dia || diasEntre(desde, dia) > 730) throw erro('data inválida (use AAAA-MM-DD, até hoje)')
    const evidencia = validarUrl(b.evidencia)                                   // só http(s), mensagem fixa
    const gravidade = b.gravidade === undefined || b.gravidade === null || b.gravidade === '' ? itensCat[item].gravidade_base : str(b.gravidade)
    if (!GRAVIDADES.includes(gravidade)) throw erro('gravidade desconhecida — escolha crítico, atenção ou informativo')
    const aberta = handle.prepare("SELECT id FROM pendencia_cliente WHERE cliente = ? AND item = ? AND canal = ? AND resolvida_em = ''").get(cliente, item, canal)
    if (aberta) return { ok: false, motivo: 'ja_registrada', registro_id: aberta.id, mensagem: 'já existe uma pendência aberta deste item neste canal — resolva a anterior antes de registrar de novo' }
    const reg = { id: null, cliente, canal, item, detalhe, desde, evidencia, gravidade, criada_em: agora() }
    if (b.confirmar !== true) { const pendencia = doRegistro(reg, dia); return { ok: true, previa: true, pendencia, texto_cliente: explicar(pendencia) } }
    const por = porValido(b, 'registra')
    const r = handle.prepare('INSERT INTO pendencia_cliente (cliente, canal, item, detalhe, desde, evidencia, gravidade, por, criada_em) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(cliente, canal, item, detalhe, desde, evidencia, gravidade, por, reg.criada_em)
    return { ok: true, registro_id: Number(r.lastInsertRowid) }
  }
  function resolver(b = {}) {
    const bruto = typeof b.registro_id === 'number' ? b.registro_id : /^\d{1,9}$/.test(str(b.registro_id)) ? Number(str(b.registro_id)) : NaN
    if (!Number.isInteger(bruto) || bruto < 1) throw erro('informe "registro_id" (número da pendência registrada)')
    const nota = str(b.nota)
    if (nota.length > 300) throw erro('a nota pode ter até 300 caracteres')
    const r = linhaReg.get(bruto)
    if (!r) throw erro('pendência registrada não encontrada', 404)
    if (r.resolvida_em) return { ok: false, motivo: 'ja_resolvida', registro_id: r.id, mensagem: 'esta pendência já foi resolvida' }
    if (b.confirmar !== true) return { ok: true, previa: true, registro: { registro_id: r.id, cliente: r.cliente, item: r.item, rotulo: itensCat[r.item]?.rotulo || '', canal: r.canal, canal_rotulo: rotuloCanal(r.canal), desde: r.desde || null } }
    const por = porValido(b, 'resolve')
    const u = handle.prepare("UPDATE pendencia_cliente SET resolvida_em = ?, resolvida_por = ?, nota = ? WHERE id = ? AND resolvida_em = ''").run(agora(), por, nota, r.id)
    if (!u.changes) return { ok: false, motivo: 'ja_resolvida', registro_id: r.id, mensagem: 'esta pendência já foi resolvida' }
    return { ok: true, registro_id: r.id }
  }

  const catalogoPublico = () => ({
    versao: cat.versao,
    itens: Object.entries(itensCat).map(([id, it]) => ({ id, rotulo: it.rotulo, canais: it.canais, tipo: it.tipo, deteccao: it.deteccao, gravidade_base: it.gravidade_base })),
    canais: cat.canais, gravidades: cat.gravidades, limiares: cat.limiares,
  })
  return { avaliar, registrar, resolver, catalogo: catalogoPublico, explicar, cat }
}
