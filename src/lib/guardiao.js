// Agente Smith — Guardião financeiro, fase G0 (docs/desenho-guardiao-financeiro.md § 4.2, 4.3, 6.6 e «Decisões do David»). PURO: sem banco, sem rede; guardiao-real.js lê e chama daqui.
// Só leitura: nenhuma regra nova ligada, nada muda plano, aviso ou texto ao cliente. Não é um segundo motor: projeta o que já existe (F9 caixa/lucro, change-log de preço com
// origemPreco, medirMarco do Merovíngio, tarefas e atas, contrato/risco) num RAIO-X (Previsão · Chance · Medido, «não temos o dado» onde faltar) e numa PAUTA DE REUNIÃO.
// Decisões do David (15/10): «decisão do cliente» é 1 clique do consultor/líder; sem marcação conta como da assessoria (mudança verificada FORA da assessoria pelo origemPreco = do cliente);
// a medição nunca para nem muda com a marcação. Shopee sem adaptador = «não temos o dado» (sem planilha). Sem custo e quer subir preço → recomendação padrão: pausar aumentos por 14 d.
import { COLUNAS, cel, chanceCel, brl } from './relatorios-ciclo.js'
import { auditarBlocos, codigosDe } from './relatorio-seguro.js'

export const SCHEMA_GUARDIAO = `
CREATE TABLE IF NOT EXISTS conta_canal (            -- lojas do mesmo dono (JBM × Luxo), inclusive fora do ML; cadastro manual (líder/consultor)
  cliente TEXT NOT NULL, canal TEXT NOT NULL CHECK (canal IN ('ml','shopee','amazon','tiktok','magalu')),
  conta TEXT NOT NULL CHECK (length(conta) BETWEEN 1 AND 60),      -- rótulo estável ('Shopee 1'); casa com tarefas.processo
  nome_loja TEXT NOT NULL DEFAULT '' CHECK (length(nome_loja) <= 80), grupo TEXT NOT NULL DEFAULT '' CHECK (length(grupo) <= 60),
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, canal, conta));
CREATE TABLE IF NOT EXISTS preco_decisao (          -- quem DECIDIU uma mudança de preço (1 clique); sem linha = assessoria (ou cliente, se a mudança foi verificada fora da assessoria)
  cliente TEXT NOT NULL, ref TEXT NOT NULL CHECK (length(ref) <= 200),
  decisor TEXT NOT NULL CHECK (decisor IN ('cliente','assessoria')),
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, ref));
`
export const CANAIS_CONTA = ['ml', 'shopee', 'amazon', 'tiktok', 'magalu']
export const DECISORES = ['cliente', 'assessoria']
export const codCanal = c => { const n = norm(typeof c === 'object' && c ? c.canal : c); return /^ml$|mercado/.test(n) ? 'ML' : /^sho$|shopee/.test(n) ? 'SHO' : /^ttk$|tiktok/.test(n) ? 'TTK' : /^amz$|amazon/.test(n) ? 'AMZ' : /^mgl$|magalu/.test(n) ? 'MGL' : String(typeof c === 'object' && c ? c.canal ?? '' : c ?? '').slice(0, 30) }
const ROT_CANAL = { ML: 'Mercado Livre', SHO: 'Shopee', TTK: 'TikTok Shop', AMZ: 'Amazon', MGL: 'Magalu', ml: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', tiktok: 'TikTok Shop', magalu: 'Magalu' }
export const rotCanal = c => ROT_CANAL[c] || String(c ?? '')

// ── utilitários ──────────────────────────────────────────────────────────────────────────────────────────────
const DIA = /^\d{4}-\d{2}-\d{2}$/
const dia10 = v => (DIA.test(String(v ?? '').slice(0, 10)) ? String(v).slice(0, 10) : '')
export const dm = iso => (dia10(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')
export const dmy = iso => (dia10(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
export const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const SEM_DADO = 'não temos o dado'
const NAO = (motivo, u = 'txt') => cel(null, u, `${SEM_DADO}: ${motivo}`)
const SEM_PREV = cel(null, 'txt', 'sem previsão para esta métrica')
const SEM_CHANCE = chanceCel(null)
const L = (item, metrica, medido, nota = '', previsao = SEM_PREV, chance = SEM_CHANCE) => ({ item: String(item ?? ''), metrica, previsao, chance, medido, nota })
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const corta = (s, n) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x }
const pctTxt = v => `${v > 0 ? '+' : ''}${String(Math.round(v * 10) / 10).replace('.', ',')}%`

// ── atas: frases de compromisso e de preço (lista FECHADA de verbos; erro esperado: frase sem o verbo — o consultor edita) ──────────────
const RX_COMPROMISSO = /se comprometeu|comprometeu-se|vai enviar|vai mandar|enviara\b|mandara\b|ficou combinad\w* que|foi combinad\w* que|sera definid\w*|prometeu|pediu o envio|solicitou o envio|vai (?:verificar|analisar|organizar|retornar|definir)|deve (?:analisar|enviar|retornar)|aguardar o ok/
const RX_LADO_ASSESSORIA = /especialista|assessoria|place ?2u|consultor|equipe|pediu o envio|solicitou o envio/
// partes: «Rótulo: frase.» por linha; o rótulo (até 60 caracteres antes de «:») sai da frase
const frasesDe = texto => String(texto ?? '').split(/\n+/).flatMap(l => l.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)).map(f => f.trim()).filter(f => f.length >= 12 && !/https?:\/\//i.test(f))
const semRotulo = f => { const m = /^([^:]{2,60}):\s*(.+)$/.exec(f); return m ? m[2] : f }
export function compromissosDaAta(texto) {
  const out = []
  for (const f of frasesDe(texto)) {
    const n = norm(f); if (!RX_COMPROMISSO.test(n)) continue
    const lado = RX_LADO_ASSESSORIA.test(n) ? 'assessoria' : /ficou combinad|foi combinad|sera definid/.test(n) ? 'reuniao' : 'cliente'
    out.push({ frase: corta(semRotulo(f), 220), lado })
  }
  return out
}
// frases de preço da ata: «preço/valor/reajuste» + valor em reais ou «subir/aumentar/reduzir»; devolve a direção quando a frase diz
const RX_PRECO_ATA = /\bpreco|\bvalor(?:es)?\b|reajust/
const RX_MUDANCA_ATA = /\bsub(?:ir|iu|ira)|aument|reajust|baixa(?:r|do)|reduz|diminu|ajust|alter|mudar|passa(?:r|ndo) (?:a|para)|para r\$/
const RX_NAO_PRECO_ATA = /investi|\bads\b|orcamento|verba|gasto|exemplo|cupom|ancoragem/
const valoresDe = s => [...String(s).matchAll(/(?:R\$\s*)?(\d{1,4}(?:\.\d{3})*,\d{2})/g)].map(m => Math.round(Number(m[1].replace(/\./g, '').replace(',', '.')) * 100))
export const direcaoDe = s => { const n = norm(s); if (/\bsem (?:reajuste|aumento|alteracao)|\bnao (?:precisa\w*|havera|tera|vai ter) (?:de )?(?:reajuste|aumento|alteracao)/.test(n)) return ''; return /\b(subir|aument\w*|reajuste|elevar|\+\s*r?\$?\s*\d)/.test(n) ? 'alta' : /\b(reduzir|baixar|diminuir|abaixar)\b/.test(n) ? 'baixa' : '' }
export function precosDaAta(texto) {
  return frasesDe(texto).filter(f => { const n = norm(f); return RX_PRECO_ATA.test(n) && RX_MUDANCA_ATA.test(n) && (valoresDe(f).length || direcaoDe(f)) && !RX_NAO_PRECO_ATA.test(n) })
    .map(f => ({ frase: corta(f, 220), valores_c: valoresDe(f), direcao: direcaoDe(f) }))   // com o rótulo: ele costuma dizer o produto («Ajuste de preços do kit com 2 peças: …»)
}
const RX_INDICIO_CLIENTE = /\bpediu\b|solicit|a pedido|lista (?:do|da) (?:cliente|loja)|alinhad|combinad|concordou|cliente|loja/

// ── decisor: 1 clique vence; sem marcação = assessoria; mudança verificada FORA da assessoria (origemPreco 'externa') = cliente ─────────────────
export function decisorDe(marco, marcacao) {
  if (marcacao && DECISORES.includes(marcacao.decisor)) return { decisor: marcacao.decisor, fonte: 'marcado', por: marcacao.por || '', em: marcacao.em || '' }
  if (marco.executor === 'externa') return { decisor: 'cliente', fonte: 'origem_verificada', por: '', em: '' }
  return { decisor: 'assessoria', fonte: 'padrao', por: '', em: '' }
}
const ROT_EXEC = { assessoria: 'equipe (tarefa vinculada ao anúncio)', externa: 'fora da assessoria (verificado)', promocao: 'promoção no ar', fim_de_promocao: 'fim de promoção (preço voltou ao cheio)',
  nao_verificada: 'origem não verificável', sistema: 'pelo painel (equipe)', tarefa: 'equipe (tarefa concluída)', ata: 'combinado em reunião' }
const ROT_DEC = { marcado: 'marcado', origem_verificada: 'mudança feita fora da assessoria', padrao: 'padrão: sem marcação conta como da assessoria' }

// marcos de tarefa e de ata (canal sem série: Shopee etc.). A frase da ata a até 7 d ANTES da tarefa de preço vira contexto da tarefa (o mesmo marco), nunca um marco a mais.
export function marcosDeRegistro({ tarefasPreco = [], atas = [], de, ate }) {
  const dentro = d => d && d >= de && d <= ate, out = []
  for (const t of tarefasPreco) {
    if (!dentro(t.dia)) continue
    const texto = `${t.titulo}\n${t.descricao}\n${t.conteudo}`
    out.push({ ref: `tarefa:${t.id}`, fonte: 'tarefa', canal: t.canal || '', conta: t.processo || '', dia: t.dia, produto: corta(t.titulo, 90), de_c: null, para_c: null,
      valores_c: valoresDe(texto).slice(0, 8), direcao: direcaoDe(texto), variacao_pct: null, executor: 'tarefa', descricao: corta(t.descricao, 160), texto: corta(`${t.descricao} ${t.conteudo}`, 240), contexto: [],
      indicio_cliente: RX_INDICIO_CLIENTE.test(norm(texto)) })
  }
  for (const a of atas) {
    if (!dentro(a.dia)) continue
    precosDaAta(a.texto).forEach((p, k) => {
      const tar = out.find(m => m.fonte === 'tarefa' && m.dia >= a.dia && m.dia <= addDias(a.dia, 7))
      if (tar) { tar.contexto.push(`reunião de ${dm(a.dia)}: ${p.frase}`); tar.indicio_cliente = true; if (!tar.direcao) tar.direcao = p.direcao; return }
      out.push({ ref: `ata:${a.id}:${k}`, fonte: 'ata', canal: a.canal || '', conta: a.processo || '', dia: a.dia, produto: corta(p.frase, 90), de_c: null, para_c: null, valores_c: p.valores_c,
        direcao: p.direcao, variacao_pct: null, executor: 'ata', texto: p.frase, contexto: [], indicio_cliente: true })   // ata = reunião com o cliente: o preço foi alinhado com ele (a marcação continua manual)
    })
  }
  return out.sort((a, b) => b.dia.localeCompare(a.dia))
}

// medição (do Merovíngio, medirMarco) → célula «Medido»; a decisão NUNCA entra aqui
const MEDIDOS = new Set(['melhorou', 'piorou', 'sem_efeito', 'variacao_conta'])
export function celMedicao(m, marco) {
  if (marco.fonte !== 'ml') return NAO(marco.canal_sem_serie === 'ml' ? 'conta do Mercado Livre não conectada' : marco.canal_sem_serie ? `sem série de vendas de ${rotCanal(marco.canal_sem_serie)} (aguardando o adaptador do canal)` : 'mudança sem anúncio identificado: o efeito é medido por anúncio')
  if (!m) return NAO('medição não calculada nesta leitura (só as mais recentes são medidas)')
  if (MEDIDOS.has(m.estado) && Number.isFinite(m.efeito_pct)) return cel(m.efeito_pct, 'pct', '')
  return cel(null, 'pct', `${m.estado === 'em_maturacao' ? 'em maturação' : m.estado}: ${corta(m.motivo, 140)}`)
}

// ════════ RAIO-X FINANCEIRO (Previsão · Chance · Medido; «não temos o dado» onde faltar) ════════
// d = dadosGuardiao (guardiao-real.js). Devolve { cliente, hoje, sistema:'smith', colunas, secoes:[{ chave, titulo, linhas }], fatos, faltando, premissas }
export function raioX(d) {
  const hoje = d.hoje, sec = [], faltando = [], fatos = {}
  const ml = d.ml || {}, central = d.central || {}
  // 1. canais e contas
  const canais = [...new Set([...(central.canais || []), ...(central.canais_cs || [])].map(codCanal).filter(Boolean))]
  const contas = [
    ...canais.map(c => L(rotCanal(c), 'Canal contratado', cel(c === 'ML' ? (ml.conectado ? 'conta conectada' : 'sem conta conectada') : 'sem integração de vendas', 'txt'),
      c === 'ML' ? (ml.conectado ? `coleta mais recente: ${dmy(ml.ultima_coleta)}` : 'conectar a conta do Mercado Livre') : 'o canal só é conhecido pelas tarefas e atas; vendas: não temos o dado (aguardando o adaptador do canal)')),
    ...(ml.conectado && !canais.includes('ML') ? [L('Mercado Livre', 'Conta conectada (fora dos canais da central)', cel('conta conectada'), `coleta mais recente: ${dmy(ml.ultima_coleta)}`)] : []),
    ...(d.contas_canal || []).map(c => L(`${rotCanal(c.canal)} · ${c.conta}`, 'Loja do mesmo dono (cadastro manual)', cel(c.nome_loja || c.conta), c.grupo ? `grupo: ${c.grupo}` : '')),
    ...(d.contas_tarefas || []).filter(x => !(d.contas_canal || []).some(c => norm(c.conta) === norm(x.processo))).map(x => L(x.processo, 'Conta citada nas tarefas (não cadastrada)', cel(x.n, 'n'), 'tarefas com este processo; cadastre a loja para separar as contas do mesmo dono')),
  ]
  const irmas = (d.contas_canal || []).length >= 2 || (d.contas_tarefas || []).filter(x => /\b\d\b/.test(x.processo) && !/\be\b/.test(norm(x.processo))).length >= 2
  fatos.contas_irmas = irmas
  fatos.lojas_cadastradas = (d.contas_canal || []).length >= 2
  fatos.lojas = fatos.lojas_cadastradas ? d.contas_canal.map(c => c.nome_loja || `${rotCanal(c.canal)} ${c.conta}`) : (d.contas_tarefas || []).filter(x => !/\be\b/.test(norm(x.processo))).map(x => x.processo)
  sec.push({ chave: 'canais', titulo: 'Canais e contas', linhas: contas.length ? contas : [L('Canais', 'Canais do cliente', NAO('nenhum canal informado na central'))] })

  // 2. custos (informados × não, e há quantos dias)
  const cu = d.custos || {}
  const idade = em => (dia10(em) ? diasEntre(dia10(em), hoje) : null)
  const temCusto = !!(cu.sku_promo?.n || cu.erp?.n || cu.vinculo?.n || cu.percentuais?.n)
  fatos.tem_custo = temCusto
  const pedido = dia10(cu.pedido_em)
  fatos.sem_custo_dias = !temCusto && pedido ? diasEntre(pedido, hoje) : null
  const lc = [
    L('Custo dos produtos', 'Custo unitário informado', cu.sku_promo?.n || cu.erp?.n ? cel(`${(cu.sku_promo?.n || 0) + (cu.erp?.n || 0)} SKU(s)`) : NAO('nenhum custo informado'),
      cu.sku_promo?.n || cu.erp?.n ? `atualizado há ${idade(cu.sku_promo?.em || cu.erp?.em)} d (${dmy(cu.sku_promo?.em || cu.erp?.em)})` : 'sem custo, sem margem e sem lucro'),
    L('Custo dos produtos', 'Percentuais (imposto, comissão, embalagem)', cu.percentuais?.n ? cel(`${cu.percentuais.n} campo(s)`) : NAO('não informados'), cu.percentuais?.n ? `atualizado em ${dmy(cu.percentuais.em)}` : 'nenhuma alíquota ou comissão é presumida'),
    L('Custo dos produtos', 'Vínculo custo ↔ anúncio', cu.vinculo?.n ? cel(cu.vinculo.n, 'n') : NAO('nenhum vínculo'), ''),
    L('Custo dos produtos', 'Pedido de custo em aberto', temCusto ? cel('custo existe') : pedido ? cel(fatos.sem_custo_dias, 'd') : NAO('pedido não registrado no sistema'),
      temCusto ? '' : pedido ? `sem custo há ${fatos.sem_custo_dias} d (pedido no plano em ${dmy(pedido)})` : 'a ação «informar custos» só nasce com dado do Mercado Livre'),
    ...(cu.informacoes || []).map(i => L('Custo dos produtos', `Item no cadastro do cliente: ${corta(i.titulo, 50)}`, cel('existe, conteúdo não lido'), `${i.secao || 'Informações'} · editado em ${dmy(i.editado_em)}`)),
  ]
  if (!temCusto) faltando.push('custo unitário dos produtos que mais vendem (passo 1: 10 min)', 'imposto, embalagem e comissão do canal (passo 2)')
  sec.push({ chave: 'custos', titulo: 'Custos', linhas: lc })

  // 3. margem por produto (só com custo; F9 «lucro» por produto)
  const mg = (d.margem || []).filter(l => l.medido?.v != null)
  sec.push({ chave: 'margem', titulo: 'Margem por produto', linhas: mg.length ? mg.slice(0, 8).map(l => L(l.item, l.metrica, l.medido, l.nota)) : [L('Todos os produtos', 'Lucro / margem', NAO(temCusto ? 'custo sem cobertura mínima da receita' : 'sem custo, sem lucro'), temCusto ? 'falta vincular o custo aos anúncios que vendem' : '')] })

  // 4. mudanças de preço (90 d) com QUEM DECIDIU e o efeito medido
  const marcos = d.marcos || []
  fatos.altas = marcos.filter(m => (m.variacao_pct ?? 0) > 0 || m.direcao === 'alta')
  fatos.altas_cliente = fatos.altas.filter(m => m.decisao.decisor === 'cliente')
  const lp = marcos.map(m => {
    const preco = m.de_c != null && m.para_c != null ? `${dm(m.dia)}: ${brl(m.de_c)} → ${brl(m.para_c)}${Number.isFinite(m.variacao_pct) ? ` (${pctTxt(m.variacao_pct)})` : ''}`
      : `${dm(m.dia)}: ${m.direcao ? (m.direcao === 'alta' ? 'alta' : 'baixa') : 'direção não registrada'}${m.valores_c?.length ? ` · valores ${m.valores_c.slice(0, 5).map(brl).join(', ')}` : ''}`
    const dec = `decidiu: ${m.decisao.decisor === 'cliente' ? 'cliente' : 'assessoria'} (${ROT_DEC[m.decisao.fonte]}${m.decisao.fonte === 'marcado' ? ` por ${m.decisao.por} em ${dm(m.decisao.em)}` : ''})`
    const pista = m.decisao.fonte === 'padrao' && m.indicio_cliente ? ' · o registro indica pedido ou alinhamento com o cliente: marque «decisão do cliente» se confirmar' : ''
    return { ...L(m.produto, preco, celMedicao(m.medicao, m), `executou: ${ROT_EXEC[m.executor] || m.executor} · ${dec}${m.custo_conhecido ? '' : ' · sem custo na data'}${pista}${m.contexto?.length ? ` · ${corta(m.contexto.join(' | '), 160)}` : ''}`), ref: m.ref, decisor: m.decisao.decisor, decisor_fonte: m.decisao.fonte }
  })
  if (d.promo_mudancas) lp.push(L('Promoções', `${d.promo_mudancas} mudança(s) de preço por promoção em 90 d`, cel(d.promo_mudancas, 'n'), 'preço de promoção não é decisão de preço de lista; entra como fator de confusão na medição'))
  sec.push({ chave: 'precos', titulo: 'Mudanças de preço (90 dias)', linhas: lp.length ? lp : [L('Preço', 'Mudanças de preço registradas', ml.conectado ? cel(0, 'n') : NAO('sem change-log de preço deste canal e nenhuma tarefa ou ata de preço em 90 d'))] })

  // 5. Ads
  const ads = d.ads || {}
  sec.push({ chave: 'ads', titulo: 'Investimento em anúncios', linhas: [
    L('Ads', 'Gasto 28 d', ads.gasto_28d_c != null ? cel(ads.gasto_28d_c, 'c') : NAO(ml.conectado ? 'Ads não coletado' : 'sem integração do canal'), temCusto ? 'teto pelo retorno mínimo: depende da margem medida' : 'sem custo: o gasto roda sem teto econômico'),
    ...(ads.tarefas_90d ? [L('Ads', 'Ajustes de campanha feitos pela equipe (90 d)', cel(ads.tarefas_90d, 'n'), `último em ${dmy(ads.ultima_tarefa)}`)] : []),
  ] })

  // 6. caixa e recebíveis (F9)
  const cx = d.caixa || {}
  sec.push({ chave: 'caixa', titulo: 'Caixa e recebíveis', linhas: cx.disponivel ? (cx.linhas || []).map(l => L(l.item, l.metrica, l.medido, corta(l.nota, 160), l.previsao, l.chance)) : [L('Caixa', 'Caixa gerado e recebíveis', NAO(cx.motivo || 'sem dados de pedidos do canal'))] })
  if (!cx.disponivel || !(cx.linhas || []).some(l => l.metrica?.startsWith('= Caixa') && l.medido?.v != null)) faltando.push('caixa gerado medido (tarifas, frete, Ads e compras completos)')

  // 7. promessas abertas das atas
  const pr = (d.promessas || []).map(p => L(`Reunião de ${dm(p.dia)}`, corta(p.frase, 160), cel('não aparece no registro'), p.lado === 'assessoria' ? 'compromisso da assessoria' : p.lado === 'reuniao' ? 'combinado para a reunião seguinte' : 'compromisso do cliente'))
  fatos.promessas = d.promessas || []
  sec.push({ chave: 'promessas', titulo: 'Combinados das reuniões (90 dias)', linhas: pr.length ? pr : [L('Atas', 'Compromissos registrados', cel(0, 'n'), d.atas_n ? 'nenhuma frase de compromisso reconhecida nas atas' : 'nenhuma ata de reunião em 90 d')] })

  // 8. contrato e risco
  const venc = Object.entries(central.vencimentos || {}).filter(([, v]) => dia10(v))
  fatos.vencimentos = venc.map(([c, v]) => ({ canal: c, dia: v, dias: diasEntre(hoje, v) }))
  const ct = d.contrato
  sec.push({ chave: 'contrato', titulo: 'Contrato e risco', linhas: [
    ...venc.map(([c, v]) => { const n = diasEntre(hoje, v); return L(`Contrato ${rotCanal(c)}`, 'Vencimento registrado na central', cel(dmy(v)), n < 0 ? `venceu há ${-n} d: confirmar a renovação` : `vence em ${n} d`) }),
    ...(venc.length ? [] : [L('Contrato', 'Vencimento', NAO('sem vencimento na central'))]),
    L('Contrato', 'Contrato no dossiê', ct ? cel(ct.fim ? `até ${dmy(ct.fim)}` : 'sem prazo informado') : NAO('contrato não cadastrado no dossiê'), ct?.valor_mensal_centavos != null ? `valor mensal ${brl(ct.valor_mensal_centavos)}` : ''),
    L('Saúde do cliente', 'Health score (CS)', central.health_score != null ? cel(central.health_score, 'n') : NAO('sem health score'), central.hs_classificacao || ''),
    L('Risco', 'Marcação de risco aberta', (d.risco || []).length ? cel((d.risco || []).map(r => r.motivo).join(', ')) : cel('nenhuma'), (d.risco || []).length ? `desde ${dmy(d.risco[0].desde)}` : 'sinais só sugerem; marcação é do líder/consultor/CS'),
  ] })

  // 9. execução (contexto da abertura)
  const t = d.tarefas || {}
  fatos.tarefas = t
  sec.push({ chave: 'execucao', titulo: 'Execução registrada', linhas: [
    L('Tarefas', 'Concluídas (total)', cel(t.concluidas ?? 0, 'n'), t.por_mes?.length ? t.por_mes.map(x => `${x.mes.slice(5, 7)}/${x.mes.slice(2, 4)} ${x.n}`).join(' · ') : ''),
    L('Tarefas', 'Na fila (não iniciadas)', cel(t.nao_iniciadas ?? 0, 'n'), ''),
    L('Tarefas', 'Aguardando o cliente', cel((t.dependencia || []).length, 'n'), (t.dependencia || []).map(x => `${corta(x.titulo, 60)} (desde ~${dm(x.desde)})`).join(' · ')),
    L('Tarefas', 'Última conclusão', t.ultima_conclusao ? cel(dmy(t.ultima_conclusao)) : NAO('nenhuma conclusão registrada'), ''),
  ] })
  if (!ml.conectado) faltando.push('vendas do canal (sem integração: aguardando o adaptador)')
  return { cliente: d.cliente, hoje, sistema: 'smith', colunas: COLUNAS, secoes: sec, fatos, faltando: [...new Set(faltando)],
    premissas: ['Previsão: só onde o Oráculo já prevê; Chance: só calibrada; Medido: fato ou medição do Merovíngio (antes × depois com controle). Associação medida, nunca prova de causa.',
      'Quem decidiu o preço: marcado com 1 clique pelo líder/consultor; sem marcação conta como da assessoria. A marcação não muda a medição.',
      'Sem custo não existe margem: nenhum lucro, piso ou teto de Ads é calculado sem o custo informado.'],
    rodape: 'Smith · raio-X financeiro (só leitura). Estimativa, nunca promessa.' }
}

// ════════ PAUTA DE REUNIÃO (abertura com fatos, 3 decisões A/B, o que medir em 14 d; sem nomes de analistas, sem culpa) ════════
const RX_CULPA = /\bculpa\w*|neglig\w*|descaso|irresponsa\w*|\bfalha (?:do|da) (?:cliente|loja)|\bdescumpri\w*|\bnao (?:respondeu|cumpriu|enviou|mandou)\b|\bprejuizo\w*/
// auditor da pauta: o mesmo crivo do texto ao cliente (relatorio-seguro) + culpa e «prejuízo» (sem custo não existe prejuízo)
export function auditarPauta(texto, { nomesInternos = [], permitidos = [] } = {}) {
  const linhas = String(texto).split('\n').filter(l => l.trim())
  const v = auditarBlocos(linhas.map(l => ({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: l.slice(0, 1900) } }] } })), { nomesInternos, permitidos, maxTopo: 1e9 })
  if (linhas.some(l => RX_CULPA.test(norm(l)))) v.push({ codigo: 'culpa', bloco: 0 })
  return { ok: v.length === 0, codigos: codigosDe(v), trechos: v.map(x => `${x.codigo}: ${x.trecho || ''}`) }
}

export function anonimizar(texto, nomes = []) {
  const toks = new Set(), primeiros = []
  for (const n of nomes) { const ws = norm(n).split(/[^a-z0-9]+/).filter(w => w.length >= 3); ws.forEach(w => toks.add(w)); if (ws[0]) primeiros.push(ws[0]) }
  return String(texto).replace(/\p{L}[\p{L}'-]*/gu, w => { const n = norm(w); return toks.has(n) || (/^\p{Lu}/u.test(w) && n.length >= 2 && n.length <= 3 && primeiros.some(p => p.startsWith(n) && p !== n)) ? 'a equipe' : w })
}
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
export function pautaReuniao(rx, d, { data, hora = '16:00', rotulo = '', nomes = [] } = {}) {
  const f = rx.fatos, hoje = rx.hoje, ml = d.ml || {}, dataR = dia10(data) || hoje
  const quando = `${SEMANA[new Date(dataR + 'T12:00:00Z').getUTCDay()]} ${dmy(dataR)}, ${String(hora).replace(/^(\d{2}):00$/, '$1h').replace(':', 'h')}`
  const nome = rotulo || d.cliente
  const semSerie = !ml.conectado
  // abertura: só fatos; o que falta diz «não temos o dado»
  const t = f.tarefas || {}
  const abertura = [
    semSerie ? `Vendas dos últimos 28 dias × 28 anteriores: ${SEM_DADO} (sem integração de vendas deste canal; aguardando o adaptador).` : `Vendas: lidas do Mercado Livre até ${dmy(ml.ultima_coleta)}.`,
    f.tem_custo ? 'Custo: há custo informado; a margem só vale onde o custo cobre a receita.' : `Margem por produto: ${SEM_DADO} (nenhum custo informado${f.sem_custo_dias != null ? `; pedido há ${f.sem_custo_dias} dias` : ''}).`,
    d.ads?.gasto_28d_c != null ? `Investimento em anúncios em 28 dias: ${brl(d.ads.gasto_28d_c)}${f.tem_custo ? '' : ', ainda sem teto econômico porque falta o custo'}.` : `Investimento em anúncios por mês: ${SEM_DADO}${d.ads?.tarefas_90d ? ` (${d.ads.tarefas_90d} ajustes de campanha feitos pela equipe em 90 dias)` : ''}.`,
    `Execução: ${t.concluidas ?? 0} ações concluídas${t.por_mes?.length ? ` (${t.por_mes.map(x => `${MES[Number(x.mes.slice(5, 7)) - 1]} ${x.n}`).join(' · ')})` : ''}; ${t.nao_iniciadas ?? 0} na fila${(t.dependencia || []).length ? `; ${(t.dependencia || []).length} aguardando retorno da loja (desde ~${dm(t.dependencia[0].desde)})` : ''}.`,
    ...(f.lojas?.length >= 2 ? [`Lojas do mesmo dono: ${f.lojas.join(' e ')}${f.lojas_cadastradas ? '' : ' (como aparecem nas tarefas)'}.`] : []),
    ...(f.vencimentos || []).map(v => `Contrato ${rotCanal(v.canal)}: vencimento registrado em ${dmy(v.dia)}${v.dias < 0 ? ' (já passou: confirmar a situação no início da reunião)' : v.dias <= 7 ? ' (confirmar a situação antes ou no início da reunião)' : ''}.`),
  ]
  // preço: o que mudou e o que sabemos
  const precos = (d.marcos || []).slice(0, 8).map(m => {
    const vals = m.valores_c?.length ? m.valores_c.slice(0, 6).map(brl).join(', ') : ''
    const oque = m.de_c != null && m.para_c != null ? `${corta(m.produto, 60)}: ${brl(m.de_c)} → ${brl(m.para_c)}`
      : m.fonte === 'tarefa' ? `tarefa «${corta(m.produto, 50)}»: ${corta(m.descricao || m.texto, 70)}${vals && !/\d,\d{2}/.test(m.descricao || '') ? ` (valores ${vals})` : ''}${m.contexto?.length ? `; na ${corta(m.contexto[0], 170)}` : ''}`
      : corta(anonimizar(m.texto || m.produto, nomes), 170)
    const efeito = m.fonte === 'ml' && m.medicao && MEDIDOS.has(m.medicao.estado) && Number.isFinite(m.medicao.efeito_pct) ? `vendas ${pctTxt(m.medicao.efeito_pct)} descontado o resto da conta (associação medida)` : `efeito nas vendas: ${SEM_DADO}`
    return `${dm(m.dia)} · ${oque} · ${m.direcao === 'alta' || m.variacao_pct > 0 ? 'alta' : m.direcao === 'baixa' || m.variacao_pct < 0 ? 'baixa' : 'direção não registrada'} · ${m.decisao.decisor === 'cliente' ? 'decisão da loja · ' : ''}${m.fonte === 'ata' ? 'alinhado em reunião' : m.fonte === 'tarefa' ? 'executado pela equipe' : ROT_EXEC[m.executor] || 'mudança registrada'} · ${efeito}.`
  })
  const promessas = (f.promessas || []).slice(0, 6).map(p => anonimizar(`Combinado em ${dm(p.dia)}: ${p.frase.replace(/\.$/, '')}. Não aparece no registro: confirmar.`, nomes))
  // 3 decisões (A/B, prós/contras, o que medir em 14 d). Ordem fixa; entram as que se aplicam; completam com as genéricas até 3
  const medirVendas = semSerie ? 'vendas por produto: a medição começa quando o canal estiver integrado (hoje não temos o dado)' : 'vendas dos produtos com aumento × demais produtos da conta (antes × depois, 14 d)'
  const cand = []
  if (!f.tem_custo) cand.push({ id: 'pausa_aumentos', pergunta: 'Pausar novos aumentos de preço por 14 dias até ter o custo?',
    a: { texto: 'Sim: nenhum aumento novo em 14 dias; o custo dos produtos que mais vendem é coletado nesse prazo e cada aumento depois vem com o piso calculado.', pros: 'decisão de preço com número; evita subir no escuro', contras: '14 dias sem mexer em preço mesmo onde a loja acha que está baixo' },
    b: { texto: 'Não: a loja define o preço agora; fica registrado como decisão da loja e medimos o efeito de cada mudança.', pros: 'liberdade imediata', contras: 'sem custo não dá para saber se o novo preço cobre a margem' },
    recomendada: 'A', porque: 'recomendação padrão sem custo: pausar aumentos por 14 dias enquanto o custo é coletado (sempre recomendação, a decisão é da loja)',
    medir: `custo informado em pelo menos 80% da receita; ${medirVendas}` })
  if (f.contas_irmas) cand.push({ id: 'contas', pergunta: 'Preço entre as lojas do mesmo dono: igualar agora ou decidir loja por loja com o custo?',
    a: { texto: 'Igualar os preços das lojas agora.', pros: 'simples e rápido', contras: 'sem custo, igualar pode tirar venda de uma loja sem ganhar margem na outra' },
    b: { texto: 'Com o custo do passo 1, calcular o piso de cada produto e dar um papel a cada loja (por exemplo, uma de unidade e outra de kit/volume).', pros: 'cada loja com preço que cobre a margem', contras: 'depende do custo chegar' },
    recomendada: 'B', porque: 'sem custo, igualar é decidir no escuro', medir: `vendas somadas das lojas por produto em 14 dias (${semSerie ? 'hoje não temos o dado: começa com a integração do canal' : 'antes × depois'})` })
  if (d.ads?.tarefas_90d || d.ads?.gasto_28d_c > 0) cand.push({ id: 'ads', pergunta: 'Investimento mensal fixo em anúncios?',
    a: { texto: 'Valor fixo por mês com teto pelo retorno mínimo, calculado com o custo.', pros: 'previsibilidade de caixa', contras: 'o teto só existe depois do custo' },
    b: { texto: 'Manter o modelo atual até o custo chegar.', pros: 'nada muda na operação', contras: 'o gasto segue sem teto econômico' },
    recomendada: f.tem_custo ? 'A' : 'B', porque: f.tem_custo ? 'com custo, o teto pelo retorno mínimo já pode ser calculado' : 'o teto depende do custo; até lá, manter e medir',
    medir: `investimento do período × retorno por real investido${f.tem_custo ? ' × teto' : ' (o teto entra com o custo)'}` })
  cand.push({ id: 'coleta_custo', pergunta: 'Como coletar o custo: na própria reunião ou até sexta?',
    a: { texto: 'Na reunião: custo unitário dos produtos que mais vendem (10 minutos), digitado junto com a loja.', pros: 'sai da reunião com número', contras: 'a loja precisa ter os valores à mão' },
    b: { texto: 'Até sexta: a loja manda a planilha de custos e o extrato de taxas do canal.', pros: 'mais completo (imposto, embalagem, taxas)', contras: 'mais uma semana sem margem' },
    recomendada: 'A', porque: 'o passo 1 é pequeno e destrava a margem', medir: 'custo informado em pelo menos 80% da receita em 14 dias' })
  cand.push({ id: 'responsavel', pergunta: 'Quem decide preço e verba do lado da loja, e por qual canal respondemos?',
    a: { texto: 'Uma pessoa responsável, com resposta pelo grupo do canal.', pros: 'decisão rápida e registrada', contras: 'concentra numa pessoa' },
    b: { texto: 'Decisão em reunião mensal.', pros: 'tudo junto, com contexto', contras: 'decisões esperam até 30 dias' },
    recomendada: 'A', porque: 'decisão registrada é decisão medida', medir: 'tempo até a resposta de cada decisão pedida em 14 dias' })
  const decisoes = cand.slice(0, 3)
  const ate = addDias(dataR, 3)
  const pedidos = [
    ...(!f.tem_custo ? ['Custo unitário dos produtos que mais vendem (passo 1) e imposto, embalagem e extrato de comissão e taxas do canal (passo 2), se não fecharem na reunião.'] : []),
    ...(f.promessas || []).filter(p => p.lado === 'cliente').slice(0, 2).map(p => anonimizar(`${p.frase.replace(/\.$/, '')} (combinado em ${dm(p.dia)}).`, nomes)),
    'Confirmação de quem decide preço e verba e do melhor canal para respostas.',
  ]
  const p = {
    cliente: d.cliente, rotulo: nome, data: dataR, hora, quando, hoje,
    titulo: `Pauta da reunião · ${nome}`,
    objetivo: f.tem_custo ? 'Sair com 3 decisões medíveis e o que medir em 14 dias.' : 'Sair com o custo dos produtos que mais vendem e com 3 decisões medíveis. Nenhum preço muda na reunião sem custo.',
    abertura, precos: precos.length ? precos : [`Nenhuma mudança de preço registrada em 90 dias${semSerie ? ' (sem histórico de preço deste canal)' : ''}.`],
    promessas: promessas.length ? promessas : ['Nenhum compromisso em aberto reconhecido nas atas dos últimos 90 dias.'],
    decisoes, pedidos, ate,
    recomendacao_padrao: !f.tem_custo ? 'Sem custo: pausar novos aumentos por 14 dias até ter o custo. É recomendação; a decisão é da loja e fica registrada.' : '',
    rodape: 'Os números que faltam acima não foram estimados. Assim que chegarem, medimos cada mudança contra os produtos que não mudaram: associação medida, não prova de causa. Equipe Place2u.',
  }
  return p
}
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function pautaTexto(p) {
  const L2 = []
  L2.push(p.titulo, p.quando, '', `Objetivo: ${p.objetivo}`, '', '1. Onde estamos (5 min)', ...p.abertura.map(x => `- ${x}`), '', '2. O que mudou de preço e o que sabemos (5 min)', ...p.precos.map(x => `- ${x}`),
    '', '3. O que foi combinado e não aparece no registro (5 min)', ...p.promessas.map(x => `- ${x}`), '', '4. Três decisões (20 min)')
  p.decisoes.forEach((d, i) => L2.push(`${i + 1}. ${d.pergunta}`, `   A: ${d.a.texto} Prós: ${d.a.pros}. Contras: ${d.a.contras}.`, `   B: ${d.b.texto} Prós: ${d.b.pros}. Contras: ${d.b.contras}.`,
    `   Recomendação: ${d.recomendada} (${d.porque}).`, `   O que medir em 14 dias: ${d.medir}.`))
  if (p.recomendacao_padrao) L2.push('', `Recomendação padrão: ${p.recomendacao_padrao}`)
  L2.push('', `5. O que precisamos da loja até ${dmy(p.ate)} (5 min)`, ...p.pedidos.map(x => `- ${x}`), '', p.rodape)
  return L2.join('\n') + '\n'
}

const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const cssStr = s => `"${String(s ?? '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3c ').replace(/>/g, '\\3e ')}"`
// HTML de 1–2 páginas A4 no molde do dossiê (tokens do 1º :root de ui.css, passados por quem chama; rodapé e numeração na margem da página; PDF pelo Chrome do relatório)
export function pautaHtml(p, { tokens = {} } = {}) {
  const raiz = Object.entries(tokens).map(([k, v]) => `--${k}:${v};`).join('')
  const lista = xs => `<ul>${xs.map(x => `<li>${escH(x)}</li>`).join('')}</ul>`
  const dec = p.decisoes.map((d, i) => `<div class="dec"><h3>${i + 1}. ${escH(d.pergunta)}</h3><table class="t"><thead><tr><th></th><th>Opção</th><th>Prós</th><th>Contras</th></tr></thead><tbody>
    <tr><td class="op">A${d.recomendada === 'A' ? '<div class="rec">recomendada</div>' : ''}</td><td>${escH(d.a.texto)}</td><td>${escH(d.a.pros)}</td><td>${escH(d.a.contras)}</td></tr>
    <tr><td class="op">B${d.recomendada === 'B' ? '<div class="rec">recomendada</div>' : ''}</td><td>${escH(d.b.texto)}</td><td>${escH(d.b.pros)}</td><td>${escH(d.b.contras)}</td></tr></tbody></table>
    <p class="nota"><b>Por quê:</b> ${escH(d.porque)}. <b>O que medir em 14 dias:</b> ${escH(d.medir)}.</p></div>`).join('')
  const rod = `Place2u · ${p.rotulo} · pauta de ${dmy(p.data)}`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escH(p.titulo)}</title>
<style>:root{${raiz}}
@page{size:A4;margin:14mm 14mm 16mm;@bottom-left{content:${cssStr(rod)};font:8px ${tokens.fonte || 'sans-serif'};color:${tokens['cinza-claro'] || '#888'}}@bottom-right{content:"pág. " counter(page) " / " counter(pages);font:8px ${tokens.fonte || 'sans-serif'};color:${tokens['cinza-claro'] || '#888'}}}
*{box-sizing:border-box}html,body{margin:0;background:var(--superficie);color:var(--tinta);font:400 9.5pt/1.45 var(--fonte);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{max-width:182mm;margin:0 auto;padding:6mm 0}
.topo{background:var(--tinta-forte);color:var(--superficie);padding:12pt 14pt;margin-bottom:10pt}
.marca{font:700 15pt/1 var(--fonte-display);color:var(--superficie)}.marca b{color:var(--laranja)}
.eyebrow{font:600 7.5pt var(--fonte);letter-spacing:.2em;text-transform:uppercase;color:var(--laranja);margin:10pt 0 4pt}
.topo h1{font:700 20pt/1.1 var(--fonte-display);margin:0;color:var(--superficie)}.topo .sub{font-size:9.5pt;color:var(--borda-forte);margin-top:4pt}
.sec-num{font:600 7.5pt var(--fonte);letter-spacing:.2em;text-transform:uppercase;color:var(--laranja);margin:12pt 0 2pt;break-after:avoid;page-break-after:avoid}
h2{font:600 13pt/1.2 var(--fonte-display);color:var(--tinta-forte);margin:0 0 6pt;padding-bottom:4pt;border-bottom:1px solid var(--borda-forte)}
h3{font:600 10pt var(--fonte);color:var(--tinta-forte);margin:8pt 0 4pt;break-after:avoid}
ul{margin:2pt 0 6pt 14pt;padding:0}li{margin:2pt 0}p{margin:4pt 0}p.nota{font-size:8.5pt;color:var(--cinza)}
table.t{width:100%;border-collapse:collapse;margin:2pt 0 4pt;font-size:8.5pt}table.t th{font:600 7pt var(--fonte);letter-spacing:.08em;text-transform:uppercase;color:var(--cinza);text-align:left;border-bottom:1.5px solid var(--tinta);padding:3pt 5pt}
table.t td{border-bottom:1px solid var(--borda);padding:3pt 5pt;vertical-align:top}table.t td.op{width:16mm;font-weight:600}.rec{font:600 6.5pt var(--fonte);letter-spacing:.08em;text-transform:uppercase;color:var(--laranja)}
.dec{break-inside:avoid;page-break-inside:avoid}
.aviso{border-left:3px solid var(--ambar);background:var(--ambar-suave);padding:6pt 8pt;margin:6pt 0;break-inside:avoid}
.fonte{margin-top:10pt;padding-top:5pt;border-top:1px solid var(--borda);font-size:7.5pt;color:var(--cinza-claro)}
</style></head><body><div class="pg">
<div class="topo"><div class="marca">Place2u<b>.</b></div><div class="eyebrow">Pauta da reunião</div><h1>${escH(p.rotulo)}</h1><div class="sub">${escH(p.quando)} · objetivo: ${escH(p.objetivo)}</div></div>
<div class="sec-num">01 · 5 min</div><h2>Onde estamos</h2>${lista(p.abertura)}
<div class="sec-num">02 · 5 min</div><h2>O que mudou de preço e o que sabemos</h2>${lista(p.precos)}
<div class="sec-num">03 · 5 min</div><h2>O que foi combinado e não aparece no registro</h2>${lista(p.promessas)}
<div class="sec-num">04 · 20 min</div><h2>Três decisões</h2>${dec}${p.recomendacao_padrao ? `<div class="aviso"><b>Recomendação padrão.</b> ${escH(p.recomendacao_padrao)}</div>` : ''}
<div class="sec-num">05 · 5 min</div><h2>O que precisamos da loja até ${escH(dmy(p.ate))}</h2>${lista(p.pedidos)}
<p class="fonte">${escH(p.rodape)}</p>
</div></body></html>`
}
