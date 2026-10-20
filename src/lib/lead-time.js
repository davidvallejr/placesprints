// PRAZO DE REPOSIÇÃO (lead time) do cliente — v1.6.0 do Algoritmo (13/10/2026). Quantos dias entre o pedido ao fornecedor (ou à produção) e a chegada do produto.
// O número informado vence a premissa `limiares.lead_time_reposicao_dias`: diagnostico-conta.js resolve por anúncio (anúncio > SKU > conta toda) e grava no item
// lead_time_dias + lead_time_fonte ('cliente' | 'equipe' | 'premissa'); ponto de reposição, regra estoque_ruptura, ciclo_estoque_previsto e a previsão de compras leem dali.
// Sem cadastro: premissa declarada + pendência do cliente `prazo_fornecedor` (config/dependencias-cliente.json). Núcleo SEM import de banco (handle, relógio, validarPor
// entram pela fábrica); prévia por padrão, grava só com confirmar === true; mensagens fixas, nunca ecoam o valor recebido.
export const SCHEMA_LEAD_TIME = `
CREATE TABLE IF NOT EXISTS lead_time_cliente (       -- prazo do fornecedor/produção informado (src/lib/lead-time.js)
  cliente TEXT NOT NULL,                             -- nome canônico da central (nunca prospect)
  chave TEXT NOT NULL,                               -- '*' = conta toda; item_id (MLB…) ou SKU
  dias INTEGER NOT NULL CHECK (dias BETWEEN 1 AND 365),
  fonte TEXT NOT NULL CHECK (fonte IN ('cliente','equipe')),   -- cliente = o cliente informou; equipe = estimativa da equipe
  por TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, chave)
);
`
export const FONTES_LEAD = ['cliente', 'equipe']
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const ehItem = k => /^MLB\d{5,15}$/i.test(k)
const minus = s => String(s ?? '').trim().toLowerCase()

// linhas do cliente → (anúncio { id, sku? }) → { dias, fonte, chave } | null. Precedência: anúncio > SKU > conta toda ('*'); null = sem cadastro (quem chama usa a premissa).
export function resolvedorLeadTime(linhas = []) {
  const item = new Map(), sku = new Map(); let conta = null
  for (const l of linhas) { const r = { dias: l.dias, fonte: l.fonte, chave: l.chave }; if (l.chave === '*') conta = r; else if (ehItem(l.chave)) item.set(l.chave.toUpperCase(), r); else sku.set(minus(l.chave), r) }
  return i => item.get(String(i?.id ?? '').toUpperCase()) || (i?.sku ? sku.get(minus(i.sku)) : null) || conta
}

// RUPTURA — predicado ÚNICO (regra estoque_ruptura do plano, 📦 do plano semanal e gatilho ruptura_curva_a): cobertura abaixo do corte crítico — ou do prazo INFORMADO,
// quando ele é maior — e abaixo do prazo de reposição (a reposição que chega antes de zerar não é ruptura: é o ciclo, pelo ponto de reposição). A premissa (21 d) não amplia
// o corte crítico (10 d). i = item do diagnóstico { cobertura, lead_time_dias, lead_time_fonte }; L = limiares { cobertura_critica_dias, lead_time_reposicao_dias }
export function corteRuptura(i, L) {
  const lead = i?.lead_time_dias ?? L.lead_time_reposicao_dias, informado = i?.lead_time_fonte === 'cliente' || i?.lead_time_fonte === 'equipe'
  return Math.min(informado ? Math.max(L.cobertura_critica_dias, lead) : L.cobertura_critica_dias, lead)
}
export const emRuptura = (i, L) => Number.isFinite(i?.cobertura) && i.cobertura < corteRuptura(i, L)
// RECEITA EM RISCO por falta de estoque — a fórmula ÚNICA da previsão da regra estoque_ruptura (plano-anuncios.js) e do impacto do aviso de estoque (gatilhos.js):
// receita/dia dos 28 d × dias sem estoque até a reposição chegar (prazo do anúncio [+ folga] − cobertura); cenários 50% / 100% / 130% do risco (os da regra).
// folga = estoque_seguranca_dias só no «hora de pedir» (ciclo/compras: o ponto de reposição já inclui a segurança); a regra de ruptura usa folga 0.
// V3 F3 (com a chave produto.diagnostico_ligado): a receita em risco é a do ESTOQUE FÍSICO inteiro (i.produto.r_ef: todos os anúncios que vendem dele), não só a do anúncio
export function riscoRuptura(i, L, { folga = 0 } = {}) {
  const r = i?.produto?.ligado === true ? i.produto.r_ef || 0 : i?.r || 0
  // V3 F3: EF Full com o anúncio mostrando MAIS que o Full (o Flex vende do estoque próprio): o comprador ainda compra até o número do anúncio acabar — os dias sem vender
  // contam da cobertura do número do anúncio no ritmo do EF (nunca menor que a do Full); segue_flex = o anúncio não está em ruptura por esse número
  const vf = i?.produto?.ligado === true && i.produto.local === 'full' && i.produto.vel_ef > 0 && Number.isFinite(i.estoque) ? Math.round(i.estoque / i.produto.vel_ef) : null
  const cob = vf != null && Number.isFinite(i.cobertura) && vf > i.cobertura ? vf : i?.cobertura, segue_flex = cob !== i?.cobertura && !emRuptura({ ...i, cobertura: cob }, L)
  const lead = i?.lead_time_dias ?? L.lead_time_reposicao_dias, dias = Number.isFinite(cob) ? Math.max(0, lead + folga - cob) : 0, risco = (r / 28) * dias
  return { lead, dias, risco, cenarios: { conservador: risco * 0.5, base: risco, otimista: risco * 1.3 }, ...(segue_flex ? { segue_flex } : {}) }
}

// deps: agora() ISO, validarPor(nome, cliente) → nome canônico | '' (líder/consultor ou o CS deste cliente), anuncios(cliente) → { itens: [MLB…], skus: [SKU] } | null
// (sem `anuncios`, a chave não é conferida; com ele, chave que não casa com nenhum anúncio do cliente = 404 e o GET marca `casa:false`)
export function criarLeadTime(handle, { agora = () => new Date().toISOString(), validarPor = () => '', anuncios = null } = {}) {
  const linhas = cliente => { try { return handle.prepare('SELECT chave, dias, fonte, por, atualizado_em FROM lead_time_cliente WHERE cliente = ? ORDER BY chave').all(cliente) } catch (e) { if (/no such table/i.test(e.message)) return []; throw e } }
  const resolvedor = cliente => resolvedorLeadTime(linhas(cliente))
  const casaDe = cliente => { const a = typeof anuncios === 'function' ? anuncios(cliente) : null; if (!a) return null
    const it = new Set((a.itens || []).map(x => String(x).toUpperCase())), sk = new Set((a.skus || []).map(minus)); return k => k === '*' || (ehItem(k) ? it.has(k.toUpperCase()) : sk.has(minus(k))) }
  const ler = cliente => { const l = linhas(cliente), casa = casaDe(cliente); return { cliente, conta: l.find(x => x.chave === '*') || null, por_anuncio: l.filter(x => x.chave !== '*').map(x => casa ? { ...x, casa: casa(x.chave) } : x) } }
  function salvar(b = {}) {
    const cliente = str(b.cliente)
    if (!cliente || ehProspecto(cliente)) throw erro('cliente inválido para prazo de reposição')
    const chave = b.chave === undefined || b.chave === null || b.chave === '' ? '*' : str(b.chave)
    if (chave !== '*' && (chave.length > 60 || /[\u0000-\u001f<>{}]/.test(chave))) throw erro('chave inválida: use "*" (conta toda), o código do anúncio (MLB…) ou o SKU')
    const dias = typeof b.dias === 'number' ? b.dias : /^\d{1,3}$/.test(str(b.dias)) ? Number(str(b.dias)) : NaN
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw erro('informe "dias" entre 1 e 365 (dias entre o pedido e a chegada)')
    const fonte = b.fonte === undefined || b.fonte === null || b.fonte === '' ? 'cliente' : str(b.fonte)
    if (!FONTES_LEAD.includes(fonte)) throw erro('fonte desconhecida — use "cliente" (o cliente informou) ou "equipe" (estimativa da equipe)')
    const k = ehItem(chave) ? chave.toUpperCase() : chave
    const casa = casaDe(cliente)        // SKU só existe para o diagnóstico quando a leitura das promoções o trouxe (promo_anuncio): gravar um que não casa não teria efeito
    if (casa && !casa(k)) throw erro('chave não encontrada nos anúncios deste cliente: use o código do anúncio (MLB…) ou a conta toda ("*"); o SKU só vale quando a leitura do Mercado Livre o trouxe', 404)
    const antes = linhas(cliente).find(x => x.chave === k) || null
    const depois = { chave: k, dias, fonte }
    const mudou = !antes || antes.dias !== dias || antes.fonte !== fonte
    if (b.confirmar !== true) return { ok: true, previa: true, mudou, antes, depois }
    const por = str(b.por)
    if (!por) throw erro('informe "por" (quem registra — líder, consultor ou o CS do cliente)')
    const ok = validarPor(por, cliente)
    if (!ok) throw erro('somente líder, consultor ou o CS deste cliente registram o prazo de reposição', 403)
    if (!mudou) return { ok: true, previa: false, mudou: false, depois }
    handle.prepare(`INSERT INTO lead_time_cliente (cliente, chave, dias, fonte, por, atualizado_em) VALUES (?,?,?,?,?,?)
      ON CONFLICT(cliente, chave) DO UPDATE SET dias = excluded.dias, fonte = excluded.fonte, por = excluded.por, atualizado_em = excluded.atualizado_em`).run(cliente, k, dias, fonte, String(ok).slice(0, 80), agora())
    return { ok: true, previa: false, mudou: true, antes, depois }
  }
  return { ler, salvar, resolvedor }
}
