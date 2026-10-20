// V3 F9 — os 8 relatórios obrigatórios do David (docs/desenho-v3-erp.md § «Pedido do David — relatórios obrigatórios da F9»). PURO: sem banco, sem rede; quem lê o banco
// é relatorios-ciclo-real.js (baseDoCliente). Não é um segundo motor: cada número é PROJEÇÃO do que já existe — diagnóstico + preverCompras (Oráculo), lucro por pedido F4
// (Smith), saúde da conta e linhas de pedido (Trinity), razão de estoque e pedidos ao fornecedor (F9) — e quem entrega é o Morpheus.
// Cada linha tem as TRÊS colunas fixas: Previsão (Oráculo, faixa conservador–base) · Chance (p CALIBRADA de uma regra do Algoritmo — priorEfetivo com n > 0; senão
// «sem calibração ainda» com a premissa no motivo) · Medido (fato lido ou medido pelo Merovíngio). Honestidade: ausente = «—» com o motivo (nunca zero); dinheiro em
// CENTAVOS inteiros (formatação só na saída); premissa rotulada; nada de lucro sem custo; «recomendação do Algoritmo, nunca ordem».
import { ritmoPrevisto } from './compras-previsao.js'

// ── razão de estoque e pedidos ao fornecedor (aditivo; db.js executa) ─────────────────────────────────────────────────────────────────
// estoque_mov: append-only (TRIGGER barra UPDATE/DELETE, molde registro_cliente). contagem = saldo ABSOLUTO do local naquela data (âncora, pode ser 0); as outras
// origens são deltas com sinal. Venda NÃO é copiada para cá: o saldo desconta as linhas pagas de meli_pedido_item depois da âncora (a linha cancelada sai sozinha).
export const SCHEMA_ERP = `
CREATE TABLE IF NOT EXISTS estoque_mov (
  cliente TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, produto TEXT NOT NULL,
  local TEXT NOT NULL CHECK (local IN ('proprio','full','transito_full')),
  origem TEXT NOT NULL CHECK (origem IN ('compra','devolucao','ajuste','envio_full','contagem','erp')),
  ref TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK ((origem = 'contagem' AND quantidade >= 0) OR (origem <> 'contagem' AND quantidade <> 0)),
  custo_unit_c INTEGER CHECK (custo_unit_c IS NULL OR custo_unit_c >= 0),
  fato_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT 'sistema', registrado_em TEXT NOT NULL,
  UNIQUE (cliente, origem, ref));
CREATE INDEX IF NOT EXISTS ix_estoque_mov_prod ON estoque_mov (cliente, produto, local);
CREATE TRIGGER IF NOT EXISTS trg_estoque_mov_sem_update BEFORE UPDATE ON estoque_mov BEGIN SELECT RAISE(ABORT, 'razao de estoque: alteracao proibida'); END;
CREATE TRIGGER IF NOT EXISTS trg_estoque_mov_sem_delete BEFORE DELETE ON estoque_mov BEGIN SELECT RAISE(ABORT, 'razao de estoque: exclusao proibida'); END;
CREATE TABLE IF NOT EXISTS compra_fornecedor (
  cliente TEXT NOT NULL, id TEXT NOT NULL, produto TEXT NOT NULL, fornecedor TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','pedida','recebida','cancelada')),
  qtd_sugerida_cons INTEGER, qtd_sugerida_base INTEGER, pedir_ate TEXT NOT NULL DEFAULT '',
  qtd_pedida INTEGER, valor_c INTEGER CHECK (valor_c IS NULL OR valor_c >= 0), pedida_em TEXT NOT NULL DEFAULT '', prevista_em TEXT NOT NULL DEFAULT '',
  qtd_recebida INTEGER, recebida_em TEXT NOT NULL DEFAULT '',
  por TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (cliente, id));
`
export const ESTADOS_COMPRA = ['sugerida', 'pedida', 'recebida', 'cancelada']
export const TRANSICOES_COMPRA = { sugerida: ['pedida', 'cancelada'], pedida: ['recebida', 'cancelada'], recebida: [], cancelada: [] }

export const NOMES = ['ciclo_financeiro', 'ciclo_compras', 'ciclo_estoque', 'logistica', 'escalabilidade', 'lucro', 'caixa', 'reinvestimento']
export const TITULOS = { ciclo_financeiro: 'Ciclo financeiro', ciclo_compras: 'Ciclo de compras', ciclo_estoque: 'Ciclo de estoque', logistica: 'Previsibilidade logística',
  escalabilidade: 'Escalabilidade mediante as vendas', lucro: 'Lucro', caixa: 'Geração de caixa', reinvestimento: 'Reinvestimento' }
export const COLUNAS = ['Item', 'Métrica', 'Previsão', 'Chance', 'Medido', 'Observação']

// ── células ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const r2 = n => Math.round(n * 100) / 100
const ok = x => typeof x === 'number' && Number.isFinite(x)
const nfmt = (v, d = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
export const brl = c => `R$ ${nfmt(c / 100, 2)}`
export const dm = d => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '')
const UM = { c: brl, un: v => `${nfmt(v)} un`, d: v => `${nfmt(v)} d`, pct: v => `${nfmt(v, 1)}%`, p: v => `${Math.round(v * 100)}%`, n: v => nfmt(v), x: v => nfmt(v, Math.abs(v) < 0.1 ? 3 : 2), txt: v => String(v) }
// v = número | [conservador, base] (faixa; o texto vai do menor ao maior — num custo o conservador é o maior) | texto; null/NaN = «—» com o motivo (ausente nunca vira zero)
export function cel(v, u = 'txt', motivo = '') {
  const vazio = v == null || v === '' || (u !== 'txt' && (Array.isArray(v) ? v.length !== 2 || !v.every(ok) : !ok(v)))
  if (vazio) return { v: null, u, txt: '—', motivo: motivo || 'sem dado' }
  const f = UM[u] || UM.txt
  return { v, u, txt: Array.isArray(v) ? (v[0] === v[1] ? f(v[0]) : `${f(Math.min(...v))} a ${f(Math.max(...v))}`) : f(v), motivo: motivo || '' }
}
// Chance: só a p CALIBRADA (priorEfetivo com n > 0); premissa nunca aparece como chance — vai no motivo de «sem calibração ainda»
export function chanceCel(c, oque = 'regra') {
  if (c && c.n > 0 && ok(c.p)) return { v: r2(c.p), u: 'p', txt: UM.p(c.p), motivo: `${oque}: ${c.fonte}` }
  return { v: null, u: 'p', txt: 'sem calibração ainda', motivo: c && ok(c.p) ? `${oque}: premissa ${UM.p(c.p)}, ainda sem tarefas medidas suficientes` : 'nenhuma regra do Algoritmo responde a esta pergunta ainda' }
}
const SEM = chanceCel(null)
const L = (item, metrica, previsao, chance, medido, nota = '') => ({ item: String(item ?? ''), metrica, previsao, chance: chance || SEM, medido, nota })
const SEM_PREV = 'sem previsão para esta métrica'
const PREV_NA = (motivo = SEM_PREV) => cel(null, 'txt', motivo)
const soma = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0)
const somaOuNull = l => (l.length && l.every(ok) ? l.reduce((t, x) => t + x, 0) : null)
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const LIB = 'data de liberação do dinheiro por pedido (money_release_date) ainda não coletada: o prazo do Mercado Livre não é presumido'
const SEM_CUSTO = 'sem custo informado: sem custo, sem lucro'
const RECO = 'recomendação do Algoritmo, nunca ordem'
// motivo de um lucro ausente: «sem custo» primeiro quando o custo não cobre o mínimo (o resto do motivo do F4 vai junto)
const motivoLucro = (fin, minimo = 0.8) => !fin ? SEM_CUSTO : fin.cobertura_custo == null || fin.cobertura_custo < minimo ? `${SEM_CUSTO}${fin.motivo ? ` (${fin.motivo})` : ''}` : fin.motivo || 'cobertura abaixo do mínimo'

// ritmo (por dia) de uma série de 28 d com a tendência 14 ÷ 28 d — a MESMA fórmula da previsão de compras (ritmoPrevisto) aplicada ao dinheiro ou às unidades
const ritmo = (u28, u14, C, estoque) => ritmoPrevisto({ u: u28 || 0, u14: u14 ?? null, estoque, vel_pond: 0, u0: 0 }, C)
const faixa = (rt, dias, f = x => x) => [Math.round(f(rt.vCons * dias)), Math.round(f(rt.vBase * dias))]

// ── razão: saldo por produto × local (pura) ─────────────────────────────────────────────────────────────────────────────────────────────────
// movs = estoque_mov do produto; vendas = [{ dia, quantidade, local }] (linhas pagas). Saldo só com âncora (contagem): entradas sem ponto de partida não dizem o saldo.
// Premissa: a contagem é do FIM do dia (vendas do mesmo dia já estão nela). Venda sem local identificado não é descontada (contada à parte).
export function saldoRazao(movs, vendas, local) {
  const ms = movs.filter(m => m.local === local).sort((a, b) => a.fato_em.localeCompare(b.fato_em) || a.id - b.id)
  let k = -1; ms.forEach((m, i) => { if (m.origem === 'contagem') k = i })
  if (k < 0) return null
  const a = ms[k], dia = a.fato_em.slice(0, 10)
  const deltas = soma(ms.slice(k + 1), m => (m.origem === 'contagem' ? 0 : m.quantidade))
  const vendido = soma(vendas.filter(v => v.local === local && v.dia > dia), v => v.quantidade)
  return { saldo: a.quantidade + deltas - vendido, ancora: dia, contado: a.quantidade, movimentos: ms.length - k - 1, vendido }
}

// ── caixa do mês (compartilhado por «caixa» e «reinvestimento») ──────────────────────────────────────────────────────────────────────────────
function caixaMes(B) {
  const m = B.conta.mes, f = m.fin || {}, faltam = []
  const vendas_c = f.receita_c ?? null
  // total só com tarifas + frete + reembolsos lidos em 100% da receita do mês: Ads e compras são do mês inteiro, e somá-los a um líquido parcial misturaria bases (sem extrapolar)
  const tf = f.receita_liquida_c != null && f.cobertura_taxas_frete >= 1
  if (!tf) faltam.push(f.receita_liquida_c != null ? `tarifas, frete e reembolsos lidos em ${Math.floor(f.cobertura_taxas_frete * 100)}% da receita do mês (o caixa precisa de 100%: não extrapolamos)` : `tarifas, frete e reembolsos abaixo da cobertura mínima (${f.motivo || 'sem linhas de pedido no mês'})`)
  if (m.ads_c == null) faltam.push('Ads do mês (Ads por dia não coletado)')
  if (m.compras_c == null) faltam.push(m.compras_motivo || 'compras do mês não registradas')
  const total_c = !faltam.length ? f.receita_liquida_c - m.ads_c - m.compras_c : null
  return { vendas_c, tf, total_c, faltam, liquida_c: f.receita_liquida_c ?? null, cobertura_tf: f.cobertura_taxas_frete ?? null }
}

// projeção do mês corrente: medido nos dias coletados + ritmo (série 28 d) × dias que faltam (hoje incluso); nunca extrapola dia sem coleta para trás
function projecaoMes(B, medido_c) {
  const k = B.conta, m = k.mes, rt = ritmo(k.receita28_c, k.receita14_c, B.cfg.C)
  if (!ok(medido_c)) return null
  const resta = Math.max(0, m.dias_total - m.dias_fechados)
  return { faixa: [medido_c + Math.round(rt.vCons * resta), medido_c + Math.round(rt.vBase * resta)], resta, parcial: m.dias_coleta < m.dias_fechados }
}

// ════════ 1. Ciclo financeiro: venda → liberação do ML → caixa ════════
function cicloFinanceiro(B) {
  const k = B.conta, C = B.cfg.C, rt = ritmo(k.receita28_c, k.receita14_c, C), f = k.fin || {}
  const prev30 = faixa(rt, 30), conta = []
  conta.push(L('Conta', 'Vendas (28 d fechados)', cel(prev30, 'c'), SEM, cel(k.receita28_c, 'c', 'sem série de vendas'),
    `previsão = próximos 30 dias; ${B.janela.dias_coleta} de ${B.janela.dias} dias com coleta`))
  const fatorLiq = f.receita_liquida_c != null && f.receita_tf_c > 0 ? f.receita_liquida_c / f.receita_tf_c : null
  conta.push(L('Conta', 'Líquido das vendas (após tarifas, frete e reembolsos)', cel(fatorLiq == null ? null : prev30.map(x => Math.round(x * fatorLiq)), 'c', 'sem o líquido medido não há projeção'), SEM,
    cel(f.receita_liquida_c, 'c', f.motivo || 'tarifa/frete abaixo da cobertura mínima'), f.receita_liquida_c != null && f.cobertura_taxas_frete < 1 ? `sobre ${brl(f.receita_tf_c)} (${Math.floor(f.cobertura_taxas_frete * 100)}% da receita)` : ''))
  conta.push(L('Conta', 'Prazo médio de recebimento (venda → liberação)', cel(null, 'd', LIB), SEM, cel(null, 'd', LIB)))
  const rec = k.recebiveis
  if (rec?.semanas?.length) for (const s of rec.semanas) conta.push(L(`Semana de ${dm(s.inicio)}`, 'A receber (notas autorizadas)', cel(s.valor_c, 'c'), SEM, cel(null, 'c', 'ainda não liberado'), `${s.n} nota(s); valor da nota, antes das tarifas`))
  else conta.push(L('Conta', 'A receber por semana', cel(null, 'c', rec?.sem_data?.n ? `${rec.sem_data.n} nota(s) sem data de liberação` : `sem notas autorizadas; ${LIB}`), SEM, cel(null, 'c', LIB)))
  const ap = aPagar(B)
  conta.push(L('Conta', 'A pagar a fornecedores (pedidos em aberto)', cel(ap.prox30_c, 'c', ap.motivo), SEM, cel(ap.total_c, 'c', ap.motivo), ap.nota))
  conta.push(L('Conta', 'Ciclo de caixa (dias de estoque + recebimento − pagamento)', PREV_NA('depende dos três prazos medidos'), SEM,
    cel(null, 'd', 'faltam o prazo de recebimento (liberação do ML) e o prazo de pagamento ao fornecedor'), diasEstoqueConta(B) != null ? `dias de estoque hoje: ${diasEstoqueConta(B)} d` : ''))
  const produtos = B.produtos.filter(p => p.receita_c > 0).map(p => {
    const rp = ritmo(p.receita_c, p.receita14_c, C, p.estoque)
    return L(p.nome, 'Vendas', cel(faixa(rp, 30), 'c'), SEM, cel(p.receita_c, 'c'), 'previsão = próximos 30 d; liberação por pedido não coletada')
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: [PREMISSA_RITMO(C), 'A previsão de vendas não limita pelo estoque (supõe reposição no prazo; ver Ciclo de estoque e Ciclo de compras).', 'Recebimento: o Mercado Livre libera o dinheiro em prazos que dependem da reputação e do meio de pagamento; sem a data de liberação de cada pedido, o prazo fica «—» (nunca presumido).',
      'A pagar = pedidos ao fornecedor registrados no Place Sprints com estado «pedida»; compras feitas fora do sistema não são vistas.'],
    faltando: ['data de liberação por pedido (money_release_date — coleta nova, NOT_VERIFIED)', ...(ap.registrados ? [] : ['pedidos ao fornecedor registrados (valor e data)'])] }
}
function aPagar(B) {
  const cf = B.compras_forn || [], abertos = cf.filter(c => c.estado === 'pedida')
  if (!cf.length) return { total_c: null, prox30_c: null, motivo: 'nenhum pedido ao fornecedor registrado (compras fora do Place Sprints não são vistas)', registrados: false, nota: '' }
  const semValor = abertos.filter(c => !Number.isInteger(c.valor_c)).length
  if (semValor) return { total_c: null, prox30_c: null, motivo: `${semValor} pedido(s) em aberto sem valor`, registrados: true, nota: '' }
  const ate = addDias(B.hoje, 30), prox = abertos.filter(c => c.prevista_em && c.prevista_em <= ate)
  return { total_c: soma(abertos, c => c.valor_c), prox30_c: soma(prox, c => c.valor_c), motivo: '', registrados: true,
    nota: `previsão = chegadas previstas em 30 dias (${prox.length} de ${abertos.length}); só os registrados` }
}
function diasEstoqueConta(B) {
  const kn = B.produtos.filter(p => p.estoque != null), E = soma(kn, p => p.estoque), v = soma(kn, p => p.u) / 28
  return v > 0 ? Math.round(E / v) : null
}
// concentração do estoque: % das unidades nos 5 maiores (número muito alto no próprio costuma ser estoque de segurança do vendedor, não físico — o relatório só mostra o fato)
function concentracao(kn) {
  const E = soma(kn, p => p.estoque); if (!(E > 0) || kn.length < 6) return ''
  const top = [...kn].sort((a, b) => b.estoque - a.estoque).slice(0, 5)
  return `os 5 maiores estoques somam ${Math.round(100 * soma(top, p => p.estoque) / E)}% das unidades (maior: ${nfmt(top[0].estoque)} un) — confira se são físicos`
}
const PREMISSA_RITMO = C => `Previsão = ritmo dos últimos 28 dias × dias × tendência (14 d ÷ 28 d, limitada entre ${String(C.tendencia_limites[0]).replace('.', ',')} e ${String(C.tendencia_limites[1]).replace('.', ',')}); conservador sem alta, base com a tendência. Estimativa, nunca promessa.`

// ════════ 2. Ciclo de compras: sugestão → pedido → recebimento ════════
function cicloCompras(B) {
  const cf = B.compras_forn || [], ch = chanceCel(B.chances.estoque_ruptura, 'taxa de sucesso medida da regra estoque_ruptura'), L0 = B.cfg.L
  const sug = B.produtos.filter(p => p.pedir?.base > 0).sort((a, b) => (a.pedir.quando?.dias ?? 1e9) - (b.pedir.quando?.dias ?? 1e9) || b.receita_c - a.receita_c)
  const comCusto = sug.filter(p => p.custo_unit_c != null)
  const valor = sug.length && comCusto.length === sug.length ? [soma(sug, p => p.pedir.conservador * p.custo_unit_c), soma(sug, p => p.pedir.base * p.custo_unit_c)] : null
  const est = Object.fromEntries(ESTADOS_COMPRA.map(e => [e, cf.filter(c => c.estado === e).length]))
  const rec = cf.filter(c => c.estado === 'recebida' && c.pedida_em && c.recebida_em)
  const prazoMed = rec.length ? Math.round(soma(rec, c => diasEntre(c.pedida_em.slice(0, 10), c.recebida_em.slice(0, 10))) / rec.length) : null
  const lc = B.conta.lead_conta, decl = lc ? { dias: lc.dias, fonte: lc.fonte === 'cliente' ? 'informado pelo cliente' : 'estimativa da equipe' } : { dias: L0.lead_time_reposicao_dias, fonte: 'premissa da casa' }
  const atrasados = cf.filter(c => c.estado === 'pedida' && c.prevista_em && c.prevista_em < B.hoje).length
  const conta = [
    L('Conta', 'Compras sugeridas pelo Algoritmo', cel(sug.length ? [soma(sug, p => p.pedir.conservador), soma(sug, p => p.pedir.base)] : null, 'un', 'nenhum produto precisa de pedido no ciclo'), ch,
      cel(sug.length, 'n'), `${sug.filter(p => p.pedir.quando?.agora).length} para pedir agora; quantidade cobre prazo + ciclo de compra + segurança`),
    L('Conta', 'Valor das compras sugeridas', cel(valor, 'c', sug.length ? `custo ausente em ${sug.length - comCusto.length} de ${sug.length} produto(s)` : 'nada a pedir'), SEM,
      cel(null, 'c', 'o valor medido é o do pedido registrado'), 'só com custo informado em todos'),
    L('Conta', 'Pedidos ao fornecedor', cel(cf.length ? cf.filter(c => c.estado === 'pedida' && c.prevista_em && c.prevista_em <= addDias(B.hoje, 30)).length : null, 'n', 'nenhum pedido registrado'), SEM,
      cel(cf.length ? `${est.sugerida} sugerido(s) · ${est.pedida} pedido(s) · ${est.recebida} recebido(s) · ${est.cancelada} cancelado(s)` : null, 'txt', 'nenhum pedido registrado no Place Sprints'), 'previsão = chegadas previstas em 30 dias'),
    L('Conta', 'Prazo do fornecedor (declarado × medido)', cel(decl.dias, 'd'), SEM, cel(prazoMed, 'd', 'nenhum pedido recebido com data do pedido'), `previsão = prazo ${decl.fonte}${rec.length ? `; medido em ${rec.length} pedido(s) recebido(s)` : ''}`),
    L('Conta', 'Pedidos atrasados (previsto já passou)', PREV_NA(), SEM, cel(cf.some(c => c.estado === 'pedida') ? atrasados : null, 'n', 'nenhum pedido em aberto registrado')),
  ]
  const ultimo = new Map(); for (const c of [...cf].sort((a, b) => a.atualizado_em.localeCompare(b.atualizado_em))) ultimo.set(c.produto, c)
  const produtos = sug.map(p => {
    const u = ultimo.get(p.chave), q = p.pedir.quando
    const med = u ? cel(`${u.estado}${u.estado === 'recebida' && u.recebida_em ? ` em ${dm(u.recebida_em)}` : u.prevista_em ? `, previsto ${dm(u.prevista_em)}` : ''}`, 'txt') : cel(null, 'txt', 'nenhum pedido registrado para este produto')
    return L(p.nome, q?.agora ? 'Pedir agora' : q ? `Pedir até ${dm(q.data)}` : 'Pedir', cel([p.pedir.conservador, p.pedir.base], 'un'), ch, med,
      `prazo ${p.lead.dias} d (${p.lead.fonte === 'premissa' ? 'premissa' : 'informado'})${p.custo_unit_c != null ? ` · ${cel([p.pedir.conservador * p.custo_unit_c, p.pedir.base * p.custo_unit_c], 'c').txt}` : ' · sem custo'}`)
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: ['Sugestão = a previsão de compras do Oráculo contada POR PRODUTO (a mesma da aba Produtos): demanda prevista para prazo do fornecedor + ciclo de compra + segurança − estoque contado uma vez. O relatório de terça segue por anúncio enquanto o diagnóstico por produto estiver desligado, então os números podem diferir dele.',
      'Chance = taxa de sucesso MEDIDA das tarefas da regra estoque_ruptura (o que a reposição fez nas vendas); enquanto não houver tarefas medidas suficientes, «sem calibração ainda».',
      'Prazo medido = dias entre «pedida» e «recebida» nos pedidos registrados; declarado = o informado (cliente/equipe) ou a premissa da casa.'],
    faltando: [...(cf.length ? [] : ['pedidos ao fornecedor registrados (POST /api/cliente/compras/pedidos)']), ...(lc ? [] : ['prazo do fornecedor informado (hoje premissa)']), ...(sug.length && comCusto.length < sug.length ? ['custo dos produtos'] : [])] }
}

// ════════ 3. Ciclo de estoque: cobertura, giro, dias, ruptura, parado (Full × próprio) + razão ════════
function cicloEstoque(B) {
  const C = B.cfg.C, kn = B.produtos.filter(p => p.estoque != null), E = soma(kn, p => p.estoque)
  const loc = l => { const xs = kn.map(p => p.local?.[l]); return xs.every(x => x == null) ? null : somaOuNull(xs.filter(x => x != null)) }
  const v28 = soma(kn, p => p.u) / 28
  const rts = kn.map(p => ({ p, rt: ritmo(p.u, p.u14, C, p.estoque) }))
  const vC = soma(rts, x => x.rt.vCons), vB = soma(rts, x => x.rt.vBase)
  const zera = x => (x.rt.vBase > 0 ? Math.floor(x.p.estoque / x.rt.vBase) : null)
  const parado = B.conta.parado || [], capP = parado.length && parado.every(x => x.capital != null) ? Math.round(soma(parado, x => x.capital) * 100) : null
  const comCusto = kn.filter(p => p.custo_unit_c != null)
  const movs = B.movs || [], vendas = B.vendas_razao || []
  const conta = [
    L('Conta', 'Estoque contado uma vez', PREV_NA(), SEM, cel(kn.length ? E : null, 'un', 'nenhum estoque lido'), `${kn.length} de ${B.produtos.length} produto(s) com estoque lido · Full ${cel(loc('full'), 'un').txt} · próprio ${cel(loc('proprio'), 'un').txt}`),
    L('Conta', 'Dias de estoque (cobertura)', cel(vB > 0 && vC > 0 ? [Math.round(E / vB), Math.round(E / vC)] : null, 'd', 'sem venda nos produtos com estoque lido'), SEM, cel(diasEstoqueConta(B), 'd', 'sem venda em 28 d'),
      ['medido = estoque ÷ vendas/dia dos 28 d; previsão = no ritmo previsto', concentracao(kn)].filter(Boolean).join('; ')),
    L('Conta', 'Giro em 28 d (vendas ÷ estoque de hoje)', PREV_NA(), SEM, cel(E > 0 ? Math.round(1000 * soma(kn, p => p.u) / E) / 1000 : null, 'x', 'sem estoque'), 'aproximado: estoque de hoje no lugar do estoque médio'),
    L('Conta', 'Produtos sem estoque', cel(kn.length ? rts.filter(x => zera(x) != null && zera(x) <= 14).length : null, 'n', 'nenhum estoque lido'), SEM,
      cel(kn.length ? kn.filter(p => p.estoque === 0).length : null, 'n', 'nenhum estoque lido'), `previsão = produtos com estoque lido que zeram em até 14 dias no ritmo base (sem probabilidade calibrada de ruptura ainda)${B.produtos.length > kn.length ? `; ${B.produtos.length - kn.length} sem estoque lido ficam fora` : ''}`),
    L('Conta', 'Produtos abaixo do corte de ruptura', PREV_NA(), SEM, cel(B.produtos.filter(p => p.situacao === 'ruptura').length, 'n'),
      'cobertura abaixo do corte crítico da regra estoque_ruptura (o mesmo predicado do plano), contando o estoque por local (Full × próprio)'),
    L('Conta', 'Estoque parado no Full (sem venda)', PREV_NA(), SEM, cel(B.conta.parado_lido ? soma(parado, x => x.unidades) : null, 'un', 'estoque do Full sem leitura'),
      parado.length ? `${parado.length} anúncio(s); capital ${cel(capP, 'c', SEM_CUSTO).txt}` : ''),
    L('Conta', 'Capital em estoque', PREV_NA(), SEM, cel(kn.length && comCusto.length === kn.length ? soma(kn, p => p.estoque * p.custo_unit_c) : null, 'c', `custo ausente em ${kn.length - comCusto.length} de ${kn.length} produto(s)`), 'estoque × custo informado'),
    L('Conta', 'Razão de estoque (movimentos)', PREV_NA(), SEM, cel(movs.length ? `${movs.length} movimento(s) · ${new Set(movs.filter(m => m.origem === 'contagem').map(m => m.produto)).size} produto(s) com contagem` : null, 'txt',
      'nenhuma contagem ou entrada registrada: saldo do razão indisponível'), 'vendas descontadas das linhas de pedido pagas depois da contagem'),
  ]
  const produtos = [...B.produtos].sort((a, b) => b.receita_c - a.receita_c).map(p => {
    const rt = ritmo(p.u, p.u14, C, p.estoque), notas = [SITUACAO[p.situacao] || p.situacao]
    if (p.local) notas.push(`Full ${cel(p.local.full, 'un').txt} · próprio ${cel(p.local.proprio, 'un').txt}`)
    const mv = movs.filter(m => m.produto === p.chave), vd = vendas.filter(v => v.produto === p.chave)
    for (const l of ['proprio', 'full']) {
      const s = saldoRazao(mv, vd, l); if (!s) continue
      const ml = p.local?.[l], div = ml != null ? s.saldo - ml : null
      notas.push(`razão ${l === 'full' ? 'Full' : 'próprio'}: ${s.saldo} un (contagem ${dm(s.ancora)}${div ? `; ${div > 0 ? '+' : ''}${div} un × ML` : ''})`)
    }
    const z = p.estoque != null && rt.vBase > 0 && rt.vCons > 0 ? [Math.floor(p.estoque / rt.vBase), Math.floor(p.estoque / rt.vCons)] : null
    return L(p.nome, 'Zera em', cel(z, 'd', p.estoque == null ? 'estoque não lido' : 'sem venda em 28 d'), SEM, cel(p.estoque, 'un', 'estoque não lido'), notas.join(' · '))
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: [PREMISSA_RITMO(C), 'Estoque contado uma vez por produto (Full e próprio separados); estoque fora do Mercado Livre só entra pelo razão (contagem) ou declarado.',
      'Razão: a contagem é o ponto de partida (do fim do dia); entradas, ajustes e envios ao Full somam; as vendas pagas depois dela saem sozinhas; venda sem depósito identificado não é descontada.'],
    faltando: [...(movs.length ? [] : ['contagem de estoque registrada (razão)']), ...(comCusto.length < kn.length ? ['custo dos produtos (capital)'] : []), ...(B.conta.parado_lido ? [] : ['leitura do estoque do Full'])] }
}
const SITUACAO = { ruptura: 'ruptura', hora_de_pedir: 'hora de pedir', estoque_dividido: 'estoque dividido', confirmar_estoque: 'confirmar estoque', kit_sem_composicao: 'kit sem composição', estoque_nao_lido: 'estoque não lido', ok: 'ok' }

// ════════ 4. Previsibilidade logística ════════
function logistica(B) {
  const k = B.conta, lc = k.local, s = k.saude || {}, C = B.cfg.C, rt = ritmo(k.receita28_c, k.receita14_c, C)
  const totUn = lc ? lc.full.un + lc.proprio.un + lc.desconhecido.un : 0, pc = x => (totUn ? `${Math.round(100 * x / totUn)}%` : '')
  const NC = 'datas de despacho e entrega por envio ainda não coletadas (/shipments: status_history não gravado)'
  const fator = Math.max(1, rt.fTend)
  const pedDia = lc && lc.dias > 0 ? lc.proprio.pedidos / lc.dias : null
  const prev7 = pedDia != null && ok(s.taxa_atraso) ? [Math.round(pedDia * 7 * s.taxa_atraso / 100), Math.round(pedDia * 7 * fator * s.taxa_atraso / 100)] : null
  const conta = [
    L('Conta', 'Vendas pelo Full', PREV_NA(), SEM, cel(lc?.dias ? lc.full.un : null, 'un', 'sem linhas de pedido'), lc?.dias ? `${pc(lc.full.un)} das unidades em ${lc.dias} dia(s) com linhas de pedido` : ''),
    L('Conta', 'Vendas por envio próprio', PREV_NA(), SEM, cel(lc?.dias ? lc.proprio.un : null, 'un', 'sem linhas de pedido'), lc?.dias ? `${pc(lc.proprio.un)}; ${lc.proprio.pedidos} pedido(s)` : ''),
    ...(lc?.desconhecido.un ? [L('Conta', 'Vendas sem depósito identificado', PREV_NA(), SEM, cel(lc.desconhecido.un, 'un'), pc(lc.desconhecido.un))] : []),
    L('Conta', 'Prazo de despacho (pago → despachado)', cel(null, 'd', NC), SEM, cel(null, 'd', NC), 'Full × próprio quando as datas forem coletadas'),
    L('Conta', 'Prazo de entrega (despachado → entregue)', cel(null, 'd', NC), SEM, cel(null, 'd', NC)),
    L('Conta', 'Taxa de atraso no despacho (reputação, 60 d)', PREV_NA(), SEM, cel(s.taxa_atraso, 'pct', 'reputação não lida'), s.dia_taxa ? `lida em ${dm(s.dia_taxa)}` : ''),
    L('Conta', 'Envios com despacho vencido agora', PREV_NA(), SEM, cel(s.atrasos, 'n', s.atrasos_motivo || 'não lido'), s.dia_atrasos ? `lido em ${dm(s.dia_atrasos)}` : ''),
    L('Conta', 'Atrasos previstos nos próximos 7 dias', cel(prev7, 'n', pedDia == null ? 'sem linhas de pedido do envio próprio' : 'taxa de atraso não lida'), chanceCel(B.chances.envio_atrasado, 'taxa de sucesso medida da regra envio_atrasado'),
      cel(null, 'n', 'medido quando a semana fechar'), 'pedidos próprios/dia × 7 × taxa de atraso da reputação (premissa: a taxa vale para o envio próprio; o Full é despachado pelo ML)'),
    L('Conta', 'Frete pago por envio', PREV_NA(), SEM, cel(k.frete_medio_c, 'c', 'nenhum envio com custo lido'), k.envios ? `${k.envios.lidos} de ${k.envios.total} envio(s) lidos` : ''),
  ]
  const produtos = B.produtos.filter(p => p.saida && (p.saida.full + p.saida.proprio + p.saida.desconhecido) > 0).map(p => {
    const pd = lc?.dias > 0 ? p.saida.pedidos_proprio / lc.dias : null
    return L(p.nome, 'Saída Full × próprio', cel(pd != null && ok(s.taxa_atraso) ? [Math.round(pd * 7 * s.taxa_atraso / 100), Math.round(pd * 7 * fator * s.taxa_atraso / 100)] : null, 'n', 'taxa de atraso ou pedidos próprios ausentes'), SEM,
      cel(`Full ${p.saida.full} · próprio ${p.saida.proprio}${p.saida.desconhecido ? ` · sem depósito ${p.saida.desconhecido}` : ''} un`, 'txt'), 'previsão = atrasos em 7 dias')
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: ['Local da venda = depósito da linha do pedido: depósito com loja = envio próprio; centro do ML sem loja = Full (premissa sobre order_items[].stock, a confirmar).',
      'Atrasos previstos = pedidos próprios por dia (dias com linhas de pedido) × 7 × taxa de atraso da reputação; base com a tendência de vendas.'],
    faltando: ['datas de despacho e entrega por envio (prazo medido Full × próprio)', ...(ok(s.taxa_atraso) ? [] : ['reputação lida']), ...(k.frete_medio_c == null ? ['custo do frete por envio (/shipments/{id}/costs)'] : [])] }
}

// ════════ 5. Escalabilidade mediante as vendas: +10/+25/+50 % sem ruptura ════════
export const CENARIOS = [0.10, 0.25, 0.50]
function escalabilidade(B) {
  const C = B.cfg.C, L0 = B.cfg.L, k = B.conta, ciclo = C.ciclo_compra_dias, seg = L0.estoque_seguranca_dias, [f0, f1] = B.cfg.fator_roas_marginal
  const ativos = B.produtos.filter(p => p.u > 0), cx = caixaMes(B)
  const calc = g => {
    let semLeitura = 0, prazo = 0, compra = 0; const un = [0, 0], cap = [0, 0]; let semCusto = 0
    const porP = new Map()
    for (const p of ativos) {
      if (p.estoque == null) { semLeitura++; continue }
      const rt = ritmo(p.u, p.u14, C, p.estoque), H = p.lead.dias + ciclo + seg
      const c = Math.max(0, Math.ceil(rt.vCons * (1 + g) * H - p.estoque - 1e-9)), b = Math.max(0, Math.ceil(rt.vBase * (1 + g) * H - p.estoque - 1e-9))
      const zera = rt.vBase > 0 ? p.estoque / (rt.vBase * (1 + g)) : Infinity
      if (zera < p.lead.dias) prazo++; else if (b > 0) compra++
      un[0] += c; un[1] += b; porP.set(p.chave, { c, b, prazo: zera < p.lead.dias })
      if (b > 0) { if (p.custo_unit_c == null) semCusto++; else { cap[0] += c * p.custo_unit_c; cap[1] += b * p.custo_unit_c } }
    }
    const ads = k.ads && k.ads.custo_c > 0 && k.ads.receita_c > 0 ? (() => { const roas = k.ads.receita_c / k.ads.custo_c, extra = g * k.receita28_c; return [Math.round(extra / (roas * f0)), Math.round(extra / (roas * f1))] })() : null
    const capital = semCusto ? null : cap
    const gargalos = [], incertos = []
    if (prazo) gargalos.push(`prazo do fornecedor (${prazo} produto(s) zeram antes de uma compra feita hoje chegar)`)
    if (compra) gargalos.push(`estoque (${compra} produto(s) precisam de compra)`)
    if (capital && cx.total_c != null && capital[1] > cx.total_c) gargalos.push('caixa (capital acima do caixa gerado no mês)')
    else if (capital == null || cx.total_c == null) incertos.push('caixa (sem custo ou sem caixa gerado medido)')
    if (ads == null) incertos.push('Ads (sem Ads com receita na janela)')
    if (semLeitura) incertos.push(`${semLeitura} produto(s) sem estoque lido`)
    return { un, capital, semCusto, ads, gargalos, incertos, porP }
  }
  const rs = CENARIOS.map(g => [g, calc(g)])
  const capHoje = (() => { const kn = B.produtos.filter(p => p.estoque != null); return kn.length && kn.every(p => p.custo_unit_c != null) ? soma(kn, p => p.estoque * p.custo_unit_c) : null })()
  const conta = rs.flatMap(([g, r]) => {
    const t = `+${Math.round(g * 100)}%`
    return [
      L(t, 'Estoque a comprar', cel(r.un, 'un'), chanceCel(B.chances.estoque_ruptura, 'taxa de sucesso medida da regra estoque_ruptura'), cel(soma(B.produtos.filter(p => p.estoque != null), p => p.estoque), 'un'), 'medido = estoque de hoje; horizonte = prazo do fornecedor + ciclo de compra + segurança'),
      L(t, 'Capital para o estoque', cel(r.capital, 'c', r.semCusto ? `custo ausente em ${r.semCusto} produto(s) que precisam de compra` : ''), SEM, cel(capHoje, 'c', SEM_CUSTO), 'medido = capital em estoque hoje'),
      L(t, 'Ads a mais em 28 d', cel(r.ads, 'c', 'sem Ads com receita na janela'), chanceCel(B.chances.ads_escalar, 'taxa de sucesso medida da regra ads_escalar'), cel(k.ads?.custo_c, 'c', 'Ads não coletado'),
        `premissa: todo o crescimento via Ads com retorno marginal ${Math.round(f0 * 100)}–${Math.round(f1 * 100)}% do retorno atual`),
      L(t, 'Gargalo', cel(r.gargalos[0] || (r.incertos.length ? null : 'nenhum visível'), 'txt', `indeterminado: ${r.incertos.join('; ')}`), SEM,
        cel(r.gargalos.length ? r.gargalos.join('; ') : null, 'txt', 'nenhum gargalo medido'), r.incertos.length ? `não avaliado: ${r.incertos.join('; ')}` : ''),
    ]
  })
  const mid = rs[1][1].porP
  const produtos = ativos.filter(p => mid.has(p.chave) && rs[2][1].porP.get(p.chave).b > 0).sort((a, b) => mid.get(b.chave).b - mid.get(a.chave).b).map(p => {
    const x = mid.get(p.chave), o = rs.map(([g, r]) => `+${Math.round(g * 100)}%: ${cel([r.porP.get(p.chave).c, r.porP.get(p.chave).b], 'un').txt}`)
    return L(p.nome, 'Comprar para +25%', cel([x.c, x.b], 'un'), SEM, cel(p.estoque, 'un'), `${o.join(' · ')}${x.prazo ? ' · zera antes do prazo do fornecedor' : ''}`)
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: [PREMISSA_RITMO(C), 'Crescer X% = o ritmo previsto de cada produto × (1 + X) no horizonte prazo + ciclo + segurança; compra = o que falta acima do estoque de hoje.',
      'Capital só com custo informado em todos os produtos que precisam de compra (sem custo, sem capital).', `Ads: retorno marginal = retorno atual × ${String(f0).replace('.', ',')}–${String(f1).replace('.', ',')} (premissa da casa da regra ads_escalar).`],
    faltando: [...(rs[0][1].semCusto ? ['custo dos produtos'] : []), ...(k.ads ? [] : ['Ads com receita na janela']), ...(cx.total_c == null ? ['caixa gerado medido'] : []), ...(B.produtos.some(p => p.lead.fonte === 'premissa') ? ['prazo do fornecedor informado'] : [])] }
}

// ════════ 6. Lucro: pedido/anúncio/produto/conta + DRE até a margem de contribuição (F4) + projeção do mês ════════
function lucro(B) {
  const k = B.conta, d = k.dre, f = k.fin || {}, C = B.cfg.C, rt = ritmo(k.receita28_c, k.receita14_c, C), prev30 = faixa(rt, 30)
  const conta = [], pm = projecaoMes(B, k.mes.receita_c)
  conta.push(L(`Mês ${B.mes}`, 'Receita (série do ML, mês até ontem)', cel(pm?.faixa, 'c', 'sem série no mês'), SEM, cel(k.mes.receita_c, 'c', 'sem série no mês'),
    pm ? `projeção do mês: + ritmo × ${pm.resta} dia(s) restantes${pm.parcial ? `; parcial: ${k.mes.dias_fechados - k.mes.dias_coleta} dia(s) sem coleta` : ''}` : ''))
  if (d?.disponivel) {
    for (const l of d.linhas) {
      let prev = PREV_NA('projeção só da receita e da margem')
      if (l.chave === 'margem') prev = l.valor_c != null && d.linhas[0].valor_c > 0 && pm ? cel(pm.faixa.map(x => Math.round(x * l.valor_c / d.linhas[0].valor_c)), 'c') : cel(null, 'c', l.valor_c == null ? SEM_CUSTO : 'sem projeção')
      conta.push(L('DRE do mês', l.rotulo, prev, SEM, cel(l.valor_c, 'c', l.nota || 'sem dado'), [l.cobertura != null && l.chave !== 'margem' ? `${Math.floor(l.cobertura * 100)}% da receita` : '', l.nota].filter(Boolean).join(' · ')))
    }
  } else conta.push(L('DRE do mês', 'Margem de contribuição', cel(null, 'c', d?.motivo || 'indisponível'), SEM, cel(null, 'c', d?.motivo || 'indisponível')))
  const lucro30 = f.lucro_c != null && f.receita_coberta_c > 0 ? prev30.map(x => Math.round(x * f.lucro_c / f.receita_coberta_c)) : null
  conta.push(L('Conta 28 d', 'Lucro de contribuição', cel(lucro30, 'c', SEM_CUSTO), chanceCel(B.chances.margem_negativa, 'taxa de sucesso medida da regra margem_negativa'),
    cel(f.lucro_c, 'c', motivoLucro(k.fin, B.cfg.minimo)), f.lucro_c != null ? `margem ${String(f.margem_pct).replace('.', ',')}% ${f.antes_do_imposto ? 'antes do imposto' : 'depois do imposto informado'}; previsão = próximos 30 d` : ''))
  const linhaLucro = (item, fin, receita_c, receita14_c, estoque) => {
    const rp = ritmo(receita_c, receita14_c, C, estoque), p30 = fin?.lucro_c != null && fin.receita_coberta_c > 0 ? faixa(rp, 30).map(x => Math.round(x * fin.lucro_c / fin.receita_coberta_c)) : null
    return L(item, 'Lucro 28 d', cel(p30, 'c', fin?.lucro_c == null ? SEM_CUSTO : ''), SEM, cel(fin?.lucro_c ?? null, 'c', motivoLucro(fin, B.cfg.minimo)),
      fin?.margem_pct != null ? `margem ${String(fin.margem_pct).replace('.', ',')}%${fin.antes_do_imposto === false ? '' : ' antes do imposto'}` : `receita ${brl(receita_c || 0)}`)
  }
  const produtos = B.produtos.filter(p => p.receita_c > 0).map(p => linhaLucro(p.nome, p.fin, p.receita_c, p.receita14_c, p.estoque))
  const anuncios = (B.anuncios || []).map(a => linhaLucro(`${a.titulo} (${a.id})`, a.fin, a.receita_c, a.receita14_c, a.estoque))
  const pedidos = (B.pedidos || []).map(x => L(`Pedido ${x.order_id}`, `venda ${dm(x.dia)}`, PREV_NA(), SEM, cel(x.lucro_c, 'c', x.motivo || SEM_CUSTO), `receita ${brl(x.receita_c)}`))
  const tituloConta = `Conta e DRE do mês${d?.disponivel ? ` (${dm(d.de)} a ${dm(d.ate)}${d.parcial ? `, ${d.parcial.dias - d.parcial.dias_sem_linhas} de ${d.parcial.dias} dias com linhas de pedido` : ''})` : ''}`
  return { secoes: [{ chave: 'conta', titulo: tituloConta, linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos },
    { chave: 'anuncio', titulo: 'Por anúncio', linhas: anuncios }, { chave: 'pedido', titulo: 'Por pedido (últimos)', linhas: pedidos }],
    premissas: [PREMISSA_RITMO(C), 'A previsão não limita pelo estoque (supõe reposição no prazo).', 'Lucro = receita − reembolso − tarifa do ML − frete do vendedor − custo informado (F4); só com custo e cobertura ≥ mínima, senão «—». Não é lucro líquido (sem despesas fixas, armazenagem e devolução).',
      'Projeção do lucro = a margem medida aplicada à receita prevista (premissa: a margem se mantém).', ...(B.premissas_fin || [])],
    faltando: [...(f.cobertura_custo == null || f.cobertura_custo < B.cfg.minimo ? ['custo dos produtos'] : []), ...(f.cobertura_taxas_frete == null || f.cobertura_taxas_frete < B.cfg.minimo ? ['frete por envio e tarifas em ≥ 80% da receita'] : []), 'Ads por dia (DRE com Ads)'] }
}

// ════════ 7. Geração de caixa ════════
function caixa(B) {
  const k = B.conta, m = k.mes, cx = caixaMes(B), f = m.fin || {}, pm = projecaoMes(B, m.receita_c)
  const fatorProj = pm && m.receita_c > 0 ? pm.faixa.map(x => x / m.receita_c) : null
  const proj = v => (v != null && fatorProj ? fatorProj.map(x => Math.round(v * x)) : null)
  const tfMot = `abaixo da cobertura mínima: ${f.motivo || 'sem linhas de pedido no mês'}`
  const conta = [
    L(`Mês ${B.mes}`, 'Vendas do mês (pagas)', cel(proj(cx.vendas_c), 'c', 'sem vendas no mês'), SEM, cel(cx.vendas_c, 'c', 'sem vendas no mês'), `linhas de pedido pagas em ${m.dias_linhas} de ${m.dias_fechados} dia(s); nos outros, a série de vendas do ML`),
    L(`Mês ${B.mes}`, 'Recebido (liberado pelo ML)', cel(null, 'c', LIB), SEM, cel(null, 'c', LIB), 'por isso o caixa abaixo é por competência (vendas pagas)'),
    L(`Mês ${B.mes}`, '(−) Tarifas, frete e reembolsos', PREV_NA(), SEM, cel(cx.liquida_c != null ? (f.receita_tf_c - cx.liquida_c) : null, 'c', tfMot), cx.liquida_c != null && cx.cobertura_tf < 1 ? `sobre ${brl(f.receita_tf_c)} (${Math.floor(cx.cobertura_tf * 100)}% da receita)` : ''),
    L(`Mês ${B.mes}`, '(−) Ads', PREV_NA(), SEM, cel(m.ads_c, 'c', 'Ads por dia não coletado: o mês fica sem Ads (nunca zero)')),
    L(`Mês ${B.mes}`, '(−) Compras ao fornecedor', PREV_NA(), SEM, cel(m.compras_c, 'c', m.compras_motivo || 'sem compras registradas'), m.compras_c != null ? 'só as registradas no Place Sprints, pela data do pedido' : ''),
    L(`Mês ${B.mes}`, '= Caixa gerado (competência)', cel(proj(cx.total_c), 'c', `falta: ${cx.faltam.join('; ')}`), SEM, cel(cx.total_c, 'c', `falta: ${cx.faltam.join('; ')}`), 'vendas pagas − tarifas − frete − reembolsos − Ads − compras'),
  ]
  const comprasP = new Map(); for (const c of B.compras_forn || []) if (['pedida', 'recebida'].includes(c.estado) && (c.pedida_em || '').slice(0, 10) >= B.janela.de && Number.isInteger(c.valor_c)) comprasP.set(c.produto, (comprasP.get(c.produto) || 0) + c.valor_c)
  const temCompras = (B.compras_forn || []).length > 0
  const produtos = B.produtos.filter(p => p.receita_c > 0).map(p => {
    const liq = p.fin?.receita_liquida_c != null && p.fin.cobertura_taxas_frete >= 1 ? p.fin.receita_liquida_c : null, ads = p.ads?.custo_c ?? null
    const mot = liq == null ? (p.fin?.receita_liquida_c != null ? `tarifas e frete lidos em ${Math.floor(p.fin.cobertura_taxas_frete * 100)}% da receita (o caixa precisa de 100%)` : p.fin?.motivo || 'tarifa/frete abaixo da cobertura mínima') : !temCompras ? 'compras não registradas' : ads == null ? 'Ads do produto não coletado' : ''
    return L(p.nome, 'Caixa gerado 28 d', PREV_NA(), SEM, cel(mot ? null : liq - ads - (comprasP.get(p.chave) || 0), 'c', mot), liq != null ? `líquido das vendas ${brl(liq)}` : '')
  })
  return { secoes: [{ chave: 'conta', titulo: 'Conta (mês corrente)', linhas: conta }, { chave: 'produto', titulo: 'Por produto', linhas: produtos }],
    premissas: ['Caixa gerado = vendas pagas − tarifas − frete − reembolsos − Ads − compras do mês. Sem a data de liberação do ML, «recebido» = vendas pagas (competência), rotulado.',
      'Qualquer parcela ausente deixa o total «—»: faltar uma saída superestimaria o caixa. O total exige tarifas, frete e reembolsos lidos em 100% da receita do mês (nunca extrapolado).', 'Projeção = o caixa medido × (receita projetada do mês ÷ receita medida).'],
    faltando: cx.faltam.concat(['data de liberação por pedido (recebido de fato)']) }
}

// ════════ 8. Reinvestimento: quanto do caixa volta para estoque/Ads, ordenado por retorno esperado × p ════════
function reinvestimento(B) {
  const cx = caixaMes(B), [f0, f1] = B.cfg.fator_roas_marginal, chE = B.chances.estoque_ruptura, chA = B.chances.ads_escalar
  const pDe = c => (c && ok(c.p) ? c.p : null)
  const cands = []
  for (const p of B.produtos) {
    const lucroUnit = p.fin?.margem_pct != null && p.u > 0 && p.receita_c > 0 ? Math.round(p.fin.margem_pct / 100 * p.receita_c / p.u) : null
    if (p.pedir && p.pedir.base > 0) {
      const inv = p.custo_unit_c != null ? [p.pedir.conservador * p.custo_unit_c, p.pedir.base * p.custo_unit_c] : null
      const ret = inv && lucroUnit != null ? [lucroUnit * p.pedir.conservador, lucroUnit * p.pedir.base] : null
      cands.push({ p, tipo: 'Estoque', inv, ret, ch: chE, ev: ret && pDe(chE) != null ? ret[1] * pDe(chE) : null, mot: p.custo_unit_c == null ? SEM_CUSTO : lucroUnit == null ? (p.fin?.motivo || 'margem não medida') : '' })
    }
    if (p.ads?.custo_c > 0 && p.ads.receita_c > 0) {
      const d = Math.round(p.ads.custo_c * 0.25), roas = p.ads.receita_c / p.ads.custo_c, mg = p.fin?.margem_pct
      const ret = mg != null ? [Math.round(d * roas * f0 * mg / 100 - d), Math.round(d * roas * f1 * mg / 100 - d)] : null
      cands.push({ p, tipo: 'Ads (+25% da verba)', inv: [d, d], ret, ch: chA, ev: ret && pDe(chA) != null ? ret[1] * pDe(chA) : null, mot: mg == null ? SEM_CUSTO : '' })
    }
  }
  cands.sort((a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity) || b.p.receita_c - a.p.receita_c)
  const bons = cands.filter(c => c.ev != null && c.ret[0] > 0 && c.inv)
  const invBons = bons.length ? soma(bons, c => c.inv[1]) : null
  const conta = [
    L('Conta', 'Caixa gerado no mês', PREV_NA(), SEM, cel(cx.total_c, 'c', `falta: ${cx.faltam.join('; ')}`)),
    L('Conta', 'Pode voltar para estoque/Ads', cel(cx.total_c != null && invBons != null ? Math.max(0, Math.min(cx.total_c, invBons)) : null, 'c', cx.total_c == null ? 'sem caixa gerado medido' : 'nenhuma opção com retorno estimável (sem custo, sem lucro)'), SEM,
      cel(null, 'c', 'medido quando o reinvestimento for registrado'), `${RECO}: o menor entre o caixa gerado e as opções com retorno positivo no cenário conservador`),
  ]
  const produtos = cands.map(c => L(`${c.p.nome}`, c.tipo, cel(c.ret, 'c', c.mot || 'sem retorno estimável'), chanceCel(c.ch, `taxa de sucesso medida da regra ${c.tipo === 'Estoque' ? 'estoque_ruptura' : 'ads_escalar'}`),
    cel(c.p.fin?.lucro_c ?? null, 'c', motivoLucro(c.p.fin, B.cfg.minimo)), `investir ${cel(c.inv, 'c', c.mot || 'sem custo').txt} · previsão = lucro esperado do investimento · ${RECO}`))
  return { secoes: [{ chave: 'conta', titulo: 'Conta', linhas: conta }, { chave: 'produto', titulo: 'Por produto (maior retorno esperado × chance primeiro)', linhas: produtos }],
    premissas: ['Estoque: investimento = compra sugerida × custo; retorno = lucro por unidade medido (margem × preço médio) × unidades — as unidades vendem no horizonte por construção da sugestão.',
      `Ads: +25% da verba do produto; retorno = verba × retorno atual × ${String(f0).replace('.', ',')}–${String(f1).replace('.', ',')} × margem − verba (premissa da regra ads_escalar).`,
      'Ordem = retorno esperado (base) × chance da regra (premissa enquanto não calibrada). Recomendação do Algoritmo, nunca ordem: a decisão é do cliente.'],
    faltando: [...(cx.total_c == null ? ['caixa gerado medido (ver Geração de caixa)'] : []), ...(cands.some(c => c.mot === SEM_CUSTO) ? ['custo dos produtos'] : [])] }
}

const FN = { ciclo_financeiro: cicloFinanceiro, ciclo_compras: cicloCompras, ciclo_estoque: cicloEstoque, logistica, escalabilidade, lucro, caixa, reinvestimento }
// B = baseDoCliente (relatorios-ciclo-real.js). Erro de nome = throw (a rota responde 404 sem eco)
export function montarRelatorio(nome, B) {
  if (!FN[nome]) throw Object.assign(new Error('relatório não encontrado'), { status: 404 })
  if (!B?.disponivel) return { nome, titulo: TITULOS[nome], cliente: B?.cliente || '', hoje: B?.hoje || '', disponivel: false, motivo: B?.motivo || 'base indisponível', colunas: COLUNAS, secoes: [], premissas: [], faltando: [] }
  const r = FN[nome](B)
  return { nome, titulo: TITULOS[nome], sistema: 'morpheus', cliente: B.cliente, hoje: B.hoje, janela: B.janela, disponivel: true, colunas: COLUNAS, ...r,
    faltando: [...new Set(r.faltando)], rodape: 'Previsão: Oráculo · Chance: só calibrada · Medido: fato ou Merovíngio. Estimativa, nunca promessa.' }
}

// ── exportações: CSV (mesma função da tela) e HTML de 1 página (molde editorial; PDF pelo Chrome de relatorio-pdf.js) ────────────────────────
const csvCel = v => { let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x}"` }
export function paraCsv(rel) {
  const txt = c => (c?.v == null && c?.motivo && c.txt === '—' ? `— (${c.motivo})` : c?.txt ?? '')
  const linhas = [['Seção', ...COLUNAS, 'Previsão (valor)', 'Medido (valor)']]
  for (const s of rel.secoes || []) for (const l of s.linhas) linhas.push([s.titulo, l.item, l.metrica, txt(l.previsao), txt(l.chance), txt(l.medido), l.nota, JSON.stringify(l.previsao?.v ?? null), JSON.stringify(l.medido?.v ?? null)])
  return '﻿' + linhas.map(l => l.map(csvCel).join(';')).join('\r\n')
}
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// 1 página A4: a conta inteira + as primeiras linhas de produto até ~18 linhas + premissas curtas. estilo = { FONTES, CSS, capa } de estilo-editorial.js (injetado: este arquivo fica puro)
export function paraHtml(rel, { FONTES = '', CSS = '', capa = null, linhasPagina = 18 } = {}) {
  const corta = (t, n) => { const x = String(t ?? ''); return x.length > n ? x.slice(0, n - 1) + '…' : x }
  const celH = c => `${escH(c?.txt ?? '—')}${c?.v == null && c?.motivo && c.txt === '—' && c.motivo !== SEM_PREV ? `<div class="m">${escH(corta(c.motivo, 48))}</div>` : ''}`
  const tab = (titulo, ls) => `<h3>${escH(titulo)}</h3><table><tr>${COLUNAS.map(c => `<th>${c}</th>`).join('')}</tr>${ls.map(l => `<tr><td>${escH(l.item)}</td><td>${escH(l.metrica)}</td><td>${celH(l.previsao)}</td><td>${celH(l.chance)}</td><td>${celH(l.medido)}</td><td class="m">${escH(corta(l.nota, 110))}</td></tr>`).join('')}</table>`
  const [conta, ...resto] = rel.secoes || [], prod = resto.find(s => s.chave === 'produto'), maxProdutos = Math.max(4, linhasPagina - (conta?.linhas.length || 0))   // 1 página: a conta inteira + o que couber de produto
  const corpo = !rel.disponivel ? `<p>${escH(rel.motivo)}</p>` : [conta ? tab(conta.titulo, conta.linhas) : '', prod?.linhas.length ? tab(`${prod.titulo}${prod.linhas.length > maxProdutos ? ` (${maxProdutos} de ${prod.linhas.length}; o CSV traz todos)` : ''}`, prod.linhas.slice(0, maxProdutos)) : ''].join('')
  const cab = capa ? capa({ documento: 'Relatório F9', titulo: rel.cliente, subtitulo: rel.titulo, meta: [`Gerado em ${dm(rel.hoje)}/${String(rel.hoje).slice(0, 4)}`, rel.janela ? `Janela: ${dm(rel.janela.de)} a ${dm(rel.janela.ate)}` : ''].filter(Boolean) }) : `<h1>${escH(rel.titulo)} — ${escH(rel.cliente)}</h1>`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escH(rel.titulo)}</title>${FONTES}<style>${CSS}
  @page{size:A4;margin:8mm}.pagina{max-width:none;padding:0}header.capa{padding:4px 0 4px;margin-bottom:6px}.capa h1{font-size:20px;margin:4px 0 2px}.capa-logo{width:30px;height:30px}
  .capa .tagline{font-size:10px}.capa-meta{margin-top:4px;padding-top:4px;font-size:9px}.capa .faixa{margin-bottom:6px!important}.f9{font-size:8px;line-height:1.2}.f9 table{table-layout:fixed}.f9 td,.f9 th{font-size:8px!important;line-height:1.2!important;padding:2px 4px!important}
  .f9 th:nth-child(1){width:20%}.f9 th:nth-child(2){width:17%}.f9 th:nth-child(3){width:14%}.f9 th:nth-child(4){width:10%}.f9 th:nth-child(5){width:13%}.f9 .m{font-size:7px!important}.f9 table{width:100%;border-collapse:collapse;margin:4px 0 8px}.f9 th,.f9 td{padding:3px 5px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
  .f9 th{font-size:8.5px;text-transform:uppercase;letter-spacing:.04em}.f9 .m{color:#666}.f9 h3{font-size:12px;margin:8px 0 2px}.f9 ul{margin:4px 0 0 14px}</style></head>
<body><div class="pagina">${cab}<section class="f9">${corpo}
<ul class="m">${(rel.premissas || []).slice(0, 3).map(p => `<li>${escH(corta(p, 220))}</li>`).join('')}${rel.faltando?.length ? `<li><b>Falta para ficar completo:</b> ${escH(rel.faltando.join('; '))}</li>` : ''}</ul>
<p class="m">${escH(rel.rodape || '')}</p></section></div></body></html>`
}

// ── blocos curtos do relatório de terça (opt-in; chave relatorios_ciclo.blocos_terca_ligado NASCE DESLIGADA: ao cliente nada muda) ───────────────
// rels = { lucro, caixa, ciclo_compras, ciclo_estoque } já montados. Só números MEDIDOS ou PREVISTOS existentes; «—» nunca vira frase.
export function blocosTerca(rels, { ligado = false } = {}) {
  if (!ligado || !rels) return []
  const out = [], acha = (r, met) => r?.secoes?.flatMap(s => s.linhas).find(l => l.metrica === met)
  const lc = acha(rels.lucro, 'Lucro de contribuição'); if (lc?.medido?.v != null) out.push(`Lucro de contribuição dos últimos 28 dias: ${lc.medido.txt} (${lc.nota}).`)
  const rc = acha(rels.lucro, 'Receita (série do ML, mês até ontem)'); if (rc?.previsao?.v != null) out.push(`Receita do mês até agora: ${rc.medido.txt}; projeção do mês: ${rc.previsao.txt}.`)
  const cx = acha(rels.caixa, '= Caixa gerado (competência)'); if (cx?.medido?.v != null) out.push(`Caixa gerado no mês (por competência): ${cx.medido.txt}.`)
  const cs = acha(rels.ciclo_compras, 'Compras sugeridas pelo Algoritmo'); if (cs?.previsao?.v != null && cs.medido.v > 0) out.push(`Compras sugeridas: ${cs.medido.txt} produto(s), ${cs.previsao.txt} no total.`)
  const ru = acha(rels.ciclo_estoque, 'Produtos sem estoque'); if (ru?.medido?.v) out.push(`Produtos sem estoque agora: ${ru.medido.txt}.`)
  return out
}
