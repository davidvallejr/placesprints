// V3 F2 (14/10/2026) — carregador com banco do produto por trás do anúncio, em SOMBRA (docs/desenho-v3-produto-estoque-financeiro.md § 2.4, § 3, § 8).
// Lê o que a coleta gravou (meli_anuncio_up, meli_up_estoque, meli_full_estoque, produto_vinculo) e chama o núcleo PURO (produto-estoque.js). Não é um segundo
// motor: a aba Produtos é PROJEÇÃO do diagnóstico (diagnosticarConta) e da previsão de compras (preverCompras) — o diagnóstico chega pronto de quem chama
// (importar diagnostico-conta daqui faria ciclo). Nada aqui muda plano, aviso ou texto ao cliente (produto.diagnostico_ligado = false).
// Escrita local só em produto_vinculo (exceção humana: prévia por padrão, confirmar === true, `por` validado) e meli_up_estoque (leitura GET /stock, teto por dia).
// NENHUMA escrita no Mercado Livre.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora, getEstado, setEstado } from './db.js'
import { ROOT } from './env.js'
import { montarGrafo, aplicarProduto, sugerirMapeamento, ehOrigem, ehChaveProduto, chaveAlvo, chaveSku } from './produto-estoque.js'
import { preverCompras } from './compras-previsao.js'
import { emRuptura } from './lead-time.js'
import { financeiroDoCliente } from './lucro-real.js'
import { resumoFin } from './lucro.js'

const P = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')).produto || {}
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => (typeof v === 'string' ? v.trim() : '')
const diaMenos = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const r2 = n => Math.round(n * 100) / 100
const temIdentidade = (p, k) => (k.startsWith('sku:') ? p.skus.includes(k.slice(4)) : k.startsWith('cat:') ? p.cats.includes(k.slice(4)) : k.startsWith('up:') ? p.ups.includes(k.slice(3))
  : k.startsWith('item:') ? p.nos.some(n => n.item_id === k.slice(5)) : false)
const TIPO = { gold_pro: 'premium', gold_special: 'clássico', free: 'grátis' }

// arestas ativas e pausadas do cliente (status vigente = o do meli_item, como no diagnóstico) + anúncio sem aresta (coleta anterior à F1) como nó sem chave
// ponytail: anúncio que saiu da listagem guarda o último status (igual ao diagnóstico); o UP costura a migração (item novo, mesmo UP = mesmo pool)
export function grafoDoCliente(cliente, { hoje = hojeLocal(), vinculosExtra = [], kitsExtra = [] } = {}) {
  const arestas = db.prepare(`SELECT u.item_id, u.variacao_id, u.user_product_id, u.inventory_id, u.sku, u.sku_fonte, u.catalogo_produto_id, u.estoque, u.logistica, u.flex, u.tags,
      COALESCE(NULLIF(i.status, ''), u.status) status, u.lido_em, i.titulo, i.permalink, i.tipo_anuncio, i.catalogo
    FROM meli_anuncio_up u LEFT JOIN meli_item i ON i.cliente = u.cliente AND i.item_id = u.item_id WHERE u.cliente = ?`).all(cliente)
  const semAresta = db.prepare(`SELECT item_id, '' variacao_id, '' user_product_id, '' inventory_id, '' sku, 'sem_aresta' sku_fonte, '' catalogo_produto_id, estoque, logistica, 0 flex, '' tags,
      status, atualizado_em lido_em, titulo, permalink, tipo_anuncio, catalogo FROM meli_item i
    WHERE cliente = ? AND status IN ('active','paused') AND NOT EXISTS (SELECT 1 FROM meli_anuncio_up u WHERE u.cliente = i.cliente AND u.item_id = i.item_id)`).all(cliente)
  const vinculos = db.prepare('SELECT origem, produto, tipo FROM produto_vinculo WHERE cliente = ?').all(cliente)
  const upEstoque = db.prepare('SELECT user_product_id, local, quantidade, lojas, lido_em FROM meli_up_estoque WHERE cliente = ?').all(cliente)
  let fullEstoque = []
  try { fullEstoque = db.prepare('SELECT inventory_id, disponivel, dia FROM meli_full_estoque WHERE cliente = ? AND dia >= ? ORDER BY dia').all(cliente, diaMenos(hoje, 7)) } catch { fullEstoque = [] }
  const ultimo = new Map(fullEstoque.map(r => [r.inventory_id, r]))                 // a última leitura de cada inventário (ORDER BY dia)
  // F3: estoque físico PRÓPRIO declarado por SKU oficial (produto_estoque_declarado; vale estoque_declarado_validade_dias — o grafo ignora o vencido com o motivo no modo)
  const declarado = new Map(db.prepare('SELECT sku, quantidade, fonte, em FROM produto_estoque_declarado WHERE cliente = ?').all(cliente).map(r => [r.sku, { quantidade: r.quantidade, fonte: r.fonte, em: r.em }]))
  // F5: composição de kit (kit_componente: Kit Virtual lido do ML ou declarada por humano com modo); kitsExtra = prévia de uma composição ainda não gravada
  const kits = [...db.prepare('SELECT kit, componente, quantidade, modo, fonte FROM kit_componente WHERE cliente = ?').all(cliente).filter(k => !kitsExtra.some(x => x.kit === k.kit)), ...kitsExtra]
  const g = montarGrafo({ arestas: [...arestas, ...semAresta], vinculos: [...vinculos.filter(v => !vinculosExtra.some(x => x.origem === v.origem && x.produto === v.produto)), ...vinculosExtra],
    upEstoque, fullEstoque: [...ultimo.values()], declarado, kits, hoje, P })
  g.qualidade = { arestas: arestas.length, sem_aresta: semAresta.length, vinculos, stock_lidos: upEstoque.filter(r => r.quantidade != null).length }
  return g
}

// visão Lucro (V3 F4): só números EXIBÍVEIS do agregar — resumoFin (lucro.js, puro) escolhe antes/depois do imposto e leva a receita que cada número cobre
const resumoProduto = p => ({ produto: p.chave, n_anuncios: p.nos.length, anuncios: p.nos.slice(0, 10).map(n => ({ id: n.item_id, titulo: n.titulo })) })
const nomeDe = (p, porId) => porId?.get(p.representante)?.titulo || p.nos[0]?.titulo || p.chave

// ── GET /api/cliente/produtos: projeção «por anúncio × por produto» (sombra) ────────────────────────────────────────────────────
// diag = diagnosticarConta(cliente) · cfg = config/algoritmo.json. Compras por produto = a MESMA preverCompras sobre 1 linha por produto (estoque contado 1×,
// vendas somadas, prazo do representante); por anúncio = a de hoje (sem o Full parado). Ruptura = o MESMO predicado emRuptura, no anúncio e no EF.
export function produtosDoCliente(cliente, diag, { cfg }) {
  if (!diag?.disponivel) return { cliente, disponivel: false, motivo: diag?.motivo || 'diagnóstico indisponível' }
  const L = cfg.limiares, g = grafoDoCliente(cliente, { hoje: diag.hoje }), ligado = cfg.produto?.diagnostico_ligado === true
  aplicarProduto(diag.itens, g, { L, ligado })                             // sombra (chave desligada): nenhum número do diagnóstico muda; ligada (F3): o MESMO que carregarBase já fez
  const porId = new Map(diag.itens.map(i => [String(i.id), i])), soma = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0)
  const ativos = g.produtos.filter(p => p.nos.some(n => n.status === 'active')).sort((a, b) => b.r - a.r || a.chave.localeCompare(b.chave))
  // curva ABC do PRODUTO pela receita somada (os cortes de classificarCurvas: 80 % / 95 %)
  const total = soma(ativos, p => p.r) || 1, curva = new Map(); let acum = 0
  for (const p of ativos) { curva.set(p.chave, p.r > 0 ? (acum / total < 0.8 ? 'A' : acum / total < 0.95 ? 'B' : 'C') : 'C'); acum += p.r }
  const pseudo = ativos.map(p => {
    const its = p.nos.map(n => porId.get(n.item_id)).filter(Boolean), rep = porId.get(p.representante) || its[0] || {}
    return { id: p.chave, titulo: nomeDe(p, porId), permalink: rep.permalink || '', curva: curva.get(p.chave), status: p.nos.some(n => n.status === 'active') ? 'active' : 'paused',
      estoque: p.estoque, u: p.u, r: p.r, u0: soma(its, i => i.u0), u14: soma(its, i => i.u14), vel_pond: soma(its, i => i.vel_pond), lead_time_dias: p.lead, lead_time_fonte: p.lead_fonte,
      ponto_reposicao: p.ponto, logistica: '', custo_unitario: rep.custo_unitario ?? null, preco: rep.preco ?? null }
  })
  // V3 F4 (visão Lucro): o MESMO financeiro por pedido da janela do diagnóstico, agregado pelo produto (anúncio fora do grafo = ele mesmo) e pelo anúncio
  const fin = financeiroDoCliente(cliente, { hoje: diag.hoje, de: diag.periodo.de, ate: diag.periodo.ate })
  const finP = fin.por(l => g.doItem.get(l.item_id)?.produto.chave ?? `item:${l.item_id}`), finI = fin.por(l => l.item_id)
  // «por anúncio × por produto»: a MESMA preverCompras com a chave forçada (produto:false = linha por anúncio; produto:true = linha por produto); o comparativo vale ligado ou não
  const comprasA = preverCompras(diag, { cfg, produto: false }), comprasP = preverCompras({ ...diag, itens: pseudo }, { cfg, produto: false }), pedirP = new Map(comprasP.itens.map(x => [x.id, x]))
  const linhaA = new Map(comprasA.itens.map(x => [String(x.id), x]))
  const rupturaEf = e => emRuptura({ cobertura: e.cobertura, lead_time_dias: e.lead, lead_time_fonte: e.lead_fonte }, L)
  const porAnuncio = i => ({ ...i, cobertura: i.cobertura_anuncio ?? i.cobertura })   // o número de hoje por anúncio (com a chave ligada, i.cobertura já é o do EF)
  const produtos = ativos.map(p => {
    const efs = p.efs.map(e => ({ chave: e.chave, local: e.local, estoque: e.estoque, vel_dia: e.vel, cobertura: e.cobertura, ponto: e.ponto, ruptura: rupturaEf(e), representante: e.representante || null }))
    const prop = p.pools.filter(q => q.local === 'proprio'), c = pedirP.get(p.chave)
    const cobA = p.nos.map(n => porId.get(n.item_id)).filter(Boolean).map(porAnuncio).map(i => i.cobertura).filter(x => x != null)
    const situacao = efs.some(e => e.ruptura) ? 'ruptura' : p.estoque != null && p.ponto != null && p.estoque <= p.ponto ? 'hora_de_pedir'
      : p.estoque == null ? 'estoque_nao_lido' : p.modo_proprio === 'dividido' && prop.length >= 2 ? 'estoque_dividido' : p.modo_proprio === 'espelho_provavel' ? 'confirmar_estoque'
      : p.kit_titulo ? 'kit_sem_composicao' : 'ok'
    return { chave: p.chave, nome: nomeDe(p, porId), n_anuncios: p.nos.length, sku: p.skus[0] || '', modo: p.modo, motivos: p.motivos, curva: curva.get(p.chave),
      pools: p.pools.map(q => ({ chave: q.chave, local: q.local, estoque: q.estoque, fonte: q.fonte, lido_em: q.lido_em || null, motivo: q.motivo || '', divergente: q.divergente })),
      efs, estoque_total: p.estoque, vel_dia: p.vel, u_28d: p.u, receita_28d: p.r, cobertura: p.cobertura, ponto_pedido: p.ponto,
      cobertura_por_anuncio: cobA.length ? { min: Math.min(...cobA), max: Math.max(...cobA) } : null,
      pedir: c?.quanto_pedir ? { ...c.quanto_pedir, quando: c.quando_pedir } : null, situacao, financeiro: resumoFin(finP.get(p.chave)), premissas: p.premissas, kit_titulo: p.kit_titulo, kit: p.kit ? { modo: p.kit.modo, fonte: p.kit.fonte, componentes: p.kit.componentes } : null,
      custo_unitario: porId.get(p.representante)?.custo_unitario ?? null,
      anuncios: p.nos.slice(0, 20).map(n => { const i = porId.get(n.item_id); return { id: n.item_id, titulo: n.titulo, permalink: n.permalink, tipo: n.catalogo ? 'catálogo' : TIPO[n.tipo_anuncio] || n.tipo_anuncio || '—',
        logistica: n.local === 'full' ? 'Full' : 'próprio', estoque: n.estoque, status: n.status, u_28d: i?.u ?? 0, receita_28d: i?.r ?? 0, cobertura_anuncio: i ? porAnuncio(i).cobertura : null, financeiro: resumoFin(finI.get(n.item_id)) } }) }
  })
  // ── sombra: o que mudaria se a F3 ligasse (nada muda hoje) ──
  // a faixa compara a MESMA população dos dois lados: todos os anúncios (ativos e pausados) dos produtos com anúncio ativo — o estoque dos pausados vai à parte
  const nosAtivos = ativos.flatMap(p => p.nos.filter(n => n.status === 'active')), nosTodos = ativos.flatMap(p => p.nos), conhecidos = ativos.filter(p => p.estoque != null)
  const rupA = diag.itens.filter(i => i.status === 'active' && emRuptura(porAnuncio(i), L)).length, efsRup = soma(produtos, p => p.efs.filter(e => e.ruptura).length)
  const mudariam = []
  for (const p of produtos) for (const a of p.anuncios) {
    const i = porId.get(a.id), x = g.doItem.get(a.id); if (!i || !x?.ef) continue
    const antes = i.status === 'active' && emRuptura(porAnuncio(i), L), depois = rupturaEf(x.ef)
    const prop = x.produto.efs.filter(e => e.local === 'proprio'), estoque_proprio = !prop.length ? 0 : prop.every(e => e.estoque != null) ? prop.reduce((t, e) => t + e.estoque, 0) : null
    if (antes !== depois) mudariam.push({ id: a.id, titulo: a.titulo, produto: p.chave, local: x.ef.local, cobertura_anuncio: i.cobertura, cobertura_ef: x.ef.cobertura, estoque_proprio, antes, depois })
  }
  const grupos = produtos.filter(p => p.n_anuncios >= 2)
  const juntadas = grupos.map(p => ({ produto: p.chave, nome: p.nome, linhas_antes: p.anuncios.filter(a => linhaA.has(a.id)).length, depois: pedirP.has(p.chave) ? 1 : 0,
    base_antes: soma(p.anuncios, a => linhaA.get(a.id)?.quanto_pedir?.base), base_depois: pedirP.get(p.chave)?.quanto_pedir?.base ?? null })).filter(x => x.linhas_antes >= 2 || (x.linhas_antes && x.base_depois !== x.base_antes))
  const comCapital = produtos.filter(p => p.estoque_total != null && p.custo_unitario != null)
  return {
    cliente, disponivel: true, hoje: diag.hoje, sombra_ligada: ligado,
    resumo: { anuncios_ativos: nosAtivos.length, produtos: produtos.length, agrupados: grupos.length, estoque_dividido: produtos.filter(p => p.situacao === 'estoque_dividido').length,
      confirmar_estoque: produtos.filter(p => p.modo === 'espelho_provavel').length, kits_sem_composicao: produtos.filter(p => p.kit_titulo).length,
      estoque_contado: soma(conhecidos, p => p.estoque), produtos_sem_leitura: produtos.length - conhecidos.length,
      capital: comCapital.length ? { valor: r2(soma(comCapital, p => p.estoque_total * p.custo_unitario)), com_custo: comCapital.length, total: conhecidos.length } : null,
      produtos_em_ruptura: produtos.filter(p => p.situacao === 'ruptura').length },
    produtos,
    // visão Lucro (F4): conta inteira na janela; número só com custo e cobertura ≥ mínimo — «Não é lucro líquido» (sem despesas fixas, armazenagem, devolução)
    financeiro: { de: fin.de, ate: fin.ate, minimo: fin.minimo, conta: resumoFin(fin.por(() => 'conta').get('conta')), gmv_c: fin.gmv_c, dias: { total: fin.dias.total, com_linhas: fin.dias.com_linhas },
      envios: fin.envios, tarifa: fin.tarifa.rotulo, premissas: fin.premissas },
    premissas: ['Contamos o estoque uma vez por produto: no Mercado Livre, anúncios do mesmo produto vendem do mesmo estoque; Full e estoque próprio são separados.',
      ligado ? 'Diagnóstico por produto LIGADO (chave produto.diagnostico_ligado): ruptura, compras, avisos e textos ao cliente já contam o estoque uma vez por produto.' : 'Sombra: estes números ainda não mudam o plano, os avisos nem os textos ao cliente (chave produto.diagnostico_ligado desligada).',
      ...new Set(ativos.flatMap(p => p.premissas))],
    data_quality: { arestas: g.qualidade.arestas, anuncios_sem_chave: g.qualidade.sem_aresta, stock_lidos: g.qualidade.stock_lidos, avisos: g.avisos.slice(0, 20),
      nota: g.qualidade.arestas ? '' : 'chaves do produto ainda não coletadas (a coleta diária grava a partir do reinício do servidor): cada anúncio aparece como um produto' },
    sombra: {
      estoque: { soma_por_anuncio: soma(nosTodos, n => n.estoque), contado_uma_vez: soma(conhecidos, p => p.estoque), em_pausados: soma(nosTodos.filter(n => n.status !== 'active'), n => n.estoque),
        soma_por_anuncio_dos_conhecidos: soma(conhecidos.flatMap(p => p.nos), n => n.estoque), produtos_sem_leitura: produtos.length - conhecidos.length },
      ruptura: { anuncios: rupA, efs: efsRup, mudariam: mudariam.slice(0, 50) },
      compras: { linhas_por_anuncio: comprasA.itens.length, linhas_por_produto: comprasP.itens.length, unidades_base_por_anuncio: soma(comprasA.itens, x => x.quanto_pedir?.base),
        unidades_base_por_produto: soma(comprasP.itens, x => x.quanto_pedir?.base), juntadas: juntadas.slice(0, 50) },
    },
  }
}

// ── GET /api/cliente/produtos/mapeamento: { sugestoes, mapeados, nao_mapeados } (sugestão nunca junta) ──────────────────────────────
export function mapeamentoDoCliente(cliente) {
  const g = grafoDoCliente(cliente), recusas = g.qualidade.vinculos.filter(v => v.tipo === 'recusado')
  const manuais = new Set(g.qualidade.vinculos.filter(v => v.tipo === 'manual').map(v => v.origem))
  const ativos = g.produtos.filter(p => p.nos.some(n => n.status === 'active'))
  const linha = p => ({ chave: p.chave, alvo: chaveAlvo(p), nome: p.nos[0]?.titulo || p.chave, n_anuncios: p.nos.length, motivos: p.motivos, sku: p.skus[0] || '',
    origens: p.origens.map(o => ({ origem: o, manual: manuais.has(o), anuncios: p.nos.filter(n => n.origem === o).map(n => ({ id: n.item_id, titulo: n.titulo })).slice(0, 10) })) })
  const mapeado = p => p.nos.length >= 2 || p.motivos.includes('manual'), mapeados = ativos.filter(mapeado), nao = ativos.filter(p => !mapeado(p))
  const sugestoes = sugerirMapeamento({ ...g, produtos: ativos }, { recusas, min: 0.65, max: 60 })
  return { cliente, sugestoes, mapeados: mapeados.slice(0, 200).map(linha), nao_mapeados: nao.slice(0, 200).map(linha),
    totais: { sugestoes: sugestoes.length, mapeados: mapeados.length, nao_mapeados: nao.length }, recusas: recusas.length }
}

// ── POST /api/cliente/produtos/juntar | separar: vínculo manual / recusa. Prévia por padrão (antes × depois do grafo); grava só com confirmar === true ──
// deps: agora() ISO, validarPor(nome, cliente) → nome canônico | '' (líder, consultor ou o CS do cliente — o mesmo do prazo de reposição)
export function criarVinculoProduto({ agora: relogio = agora, validarPor = () => '' } = {}) {
  function decidir(tipo, b = {}) {
    const cliente = str(b.cliente), origem = str(b.origem), produto = str(b.produto)
    if (!ehOrigem(origem) || !ehChaveProduto(produto)) throw erro('informe a origem (up:MLBU… ou item:MLB…) e o produto (sku:…, cat:MLB… ou up:MLBU…)')
    const antes = grafoDoCliente(cliente), deOrigem = g => g.produtos.find(p => p.origens.includes(origem))
    const atual = deOrigem(antes)
    if (!atual) throw erro('origem não encontrada nos anúncios deste cliente', 404)
    if (!antes.produtos.some(p => temIdentidade(p, produto))) throw erro('produto não encontrado nos anúncios deste cliente', 404)
    if (tipo === 'manual' && temIdentidade(atual, produto)) throw erro('a origem já está neste produto')
    // «Separar» a origem que CARREGA a identidade do alvo (o SKU/catálogo/UP que dá a chave ao produto): a recusa contra o próprio alvo nunca casaria — grava uma recusa
    // por par (origem × cada outra origem do produto). Nos demais casos, 1 recusa contra o alvo (vale também para anúncio novo com a mesma identidade).
    const daOrigem = atual.nos.filter(n => n.origem === origem), idOrigem = { skus: daOrigem.map(n => n.sku).filter(Boolean), cats: daOrigem.map(n => n.cat).filter(Boolean),
      ups: [...daOrigem.map(n => n.up).filter(Boolean), ...(origem.startsWith('up:') ? [origem.slice(3)] : [])], nos: daOrigem }
    const regs = tipo === 'recusado' && temIdentidade(atual, produto) && temIdentidade(idOrigem, produto)
      ? atual.origens.filter(o => o !== origem).map(o => ({ origem, produto: o, tipo })) : [{ origem, produto, tipo }]
    const novo = deOrigem(grafoDoCliente(cliente, { vinculosExtra: regs }))
    const r = { ok: true, tipo, origem, produto, antes: resumoProduto(atual), depois: resumoProduto(novo), mudou: atual.chave !== novo.chave || atual.nos.length !== novo.nos.length, vinculos: regs.length }
    if (b.confirmar !== true) return { ...r, previa: true }
    // juntar ou SEPARAR (a origem está no produto do alvo) sem efeito no agrupamento = nada a gravar; «Não é o mesmo» de uma sugestão (produtos já separados) grava a recusa
    if (!r.mudou && (tipo === 'manual' || temIdentidade(atual, produto))) throw erro('nada muda no agrupamento com este vínculo: nada foi gravado')
    const por = str(b.por)
    if (!por) throw erro('informe "por" (quem decide — líder, consultor ou o CS do cliente)')
    const ok = validarPor(por, cliente)
    if (!ok) throw erro('somente líder, consultor ou o CS deste cliente mexem no mapeamento de produtos', 403)
    const ins = db.prepare(`INSERT INTO produto_vinculo (cliente, origem, produto, tipo, por, em) VALUES (?,?,?,?,?,?)
        ON CONFLICT(cliente, origem, produto) DO UPDATE SET tipo = excluded.tipo, por = excluded.por, em = excluded.em`), em = relogio()
    db.transaction(() => {
      if (tipo === 'manual') db.prepare("DELETE FROM produto_vinculo WHERE cliente = ? AND origem = ? AND tipo = 'manual'").run(cliente, origem)   // 1 destino manual por origem
      for (const v of regs) ins.run(cliente, v.origem, v.produto, v.tipo, String(ok).slice(0, 80), em)
    })()
    return { ...r, previa: false }
  }
  return { juntar: b => decidir('manual', b), separar: b => decidir('recusado', b) }
}

// ── POST /api/cliente/produtos/estoque-fisico (F3): estoque físico PRÓPRIO informado pelo cliente/equipe por SKU oficial → modo «declarado» no grafo ──────
// Prévia por padrão; confirmar === true grava (líder, consultor ou o CS do cliente em `por`). Só SKU oficial lido do ML (sku: de um produto do cliente); produto sem SKU
// primeiro recebe o SKU (regra sku_ausente). Escrita LOCAL: nada vai ao Mercado Livre. deps: agora() ISO, validarPor(nome, cliente) → nome canônico | ''
export function criarEstoqueDeclarado({ agora: relogio = agora, validarPor = () => '' } = {}) {
  function salvar(b = {}) {
    const cliente = str(b.cliente), skuBruto = str(b.sku), sku = chaveSku(skuBruto), fonte = b.fonte === undefined || b.fonte === null || b.fonte === '' ? 'cliente' : str(b.fonte)
    if (!sku || sku.length > 80 || /[\u0000-\u001f<>{}~]/.test(sku)) throw erro('informe o SKU oficial do produto (o SELLER_SKU lido do Mercado Livre)')
    const q = typeof b.quantidade === 'number' ? b.quantidade : /^\d{1,7}$/.test(str(b.quantidade)) ? Number(str(b.quantidade)) : NaN
    if (!Number.isInteger(q) || q < 0 || q > 1000000) throw erro('informe "quantidade" inteira entre 0 e 1.000.000 (unidades no seu estoque, fora do Full)')
    if (!['cliente', 'equipe'].includes(fonte)) throw erro('fonte desconhecida — use "cliente" (o cliente informou) ou "equipe" (contagem da equipe)')
    const g = grafoDoCliente(cliente), achado = g.produtos.find(x => x.skus.includes(sku))
    // F6: SKU oficial de VARIAÇÃO (o grafo conta o anúncio com variações inteiro e não agrupa pelo SKU dela) também recebe a declaração — o sincronismo escreve por variação
    const daVariacao = !achado && db.prepare("SELECT item_id FROM meli_anuncio_up WHERE cliente = ? AND sku_fonte = 'variacao' AND LOWER(TRIM(sku)) = ?").all(cliente, sku)
    const p = achado || (daVariacao?.length ? { chave: `sku:${sku}`, nos: daVariacao.map(r => ({ item_id: r.item_id })), pools: [], modo: 'variacao' } : null)
    if (!p) throw erro('SKU não encontrado nos anúncios deste cliente: a declaração vale só para o SELLER_SKU lido do Mercado Livre (anúncio sem SKU recebe o SKU antes)', 404)
    const antes = db.prepare('SELECT quantidade, fonte, em FROM produto_estoque_declarado WHERE cliente = ? AND sku = ?').get(cliente, sku) || null
    const r = { ok: true, sku, produto: p.chave, n_anuncios: p.nos.length, pools_proprios: p.pools.filter(x => x.local === 'proprio').length, modo_antes: p.modo, antes, depois: { quantidade: q, fonte } }
    if (b.confirmar !== true) return { ...r, previa: true }
    const por = str(b.por)
    if (!por) throw erro('informe "por" (quem registra — líder, consultor ou o CS do cliente)')
    const ok = validarPor(por, cliente)
    if (!ok) throw erro('somente líder, consultor ou o CS deste cliente registram o estoque físico', 403)
    db.prepare(`INSERT INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) VALUES (?,?,?,?,?,?)
      ON CONFLICT(cliente, sku) DO UPDATE SET quantidade = excluded.quantidade, fonte = excluded.fonte, por = excluded.por, em = excluded.em`).run(cliente, sku, q, fonte, String(ok).slice(0, 80), relogio())
    const depois = grafoDoCliente(cliente).produtos.find(x => x.skus.includes(sku))
    return { ...r, previa: false, modo_depois: depois?.modo ?? null }
  }
  return { salvar }
}

// ── GET /user-products/{id}/stock (SÓ LEITURA) — desenho § 2.4 ───────────────────────────────────────────────────────────────────
// UPs em que o número do anúncio é ambíguo: com anúncio Full e (Flex ligado ou irmãos em 2+ logísticas), com venda em 28 d, por receita. Só arestas do nível do
// anúncio: o grafo da F2 conta o anúncio com variações inteiro (nó agregado, sem pool por UP de variação) e nunca lê o /stock delas — e a receita do pai seria somada
// em cada UP de variação. ponytail: UPs de variação entram com o pool por variação (F3/F5).
export function upsParaLer(cliente, { hoje = hojeLocal() } = {}) {
  return db.prepare(`SELECT u.user_product_id up, COALESCE(SUM(s.r), 0) r FROM meli_anuncio_up u
      LEFT JOIN (SELECT item_id, SUM(receita) r FROM meli_serie_item WHERE cliente = @c AND dia BETWEEN @de AND @ate GROUP BY item_id) s ON s.item_id = u.item_id
    WHERE u.cliente = @c AND u.user_product_id != '' AND u.variacao_id = '' AND u.status = 'active' GROUP BY u.user_product_id
    HAVING SUM(u.logistica = 'fulfillment') > 0 AND (MAX(u.flex) = 1 OR COUNT(DISTINCT u.logistica) >= 2) AND COALESCE(SUM(s.r), 0) > 0 ORDER BY r DESC, up`)
    .all({ c: cliente, de: diaMenos(hoje, 28), ate: diaMenos(hoje, 1) }).map(x => x.up)
}
// teto por dia = CHAMADAS (sucesso ou falha, o mesmo UP relido conta de novo) numa janela móvel de 24 h; sync_estado stock_tentativas:{cliente} = [ISO…] das últimas 24 h
// (lido_em não serve: a releitura do mesmo UP e a falha não deixam rastro nele)
const chaveTent = cliente => `stock_tentativas:${cliente}`
const tentativas24h = cliente => { const desde = new Date(Date.now() - 864e5).toISOString(); try { return (JSON.parse(getEstado(chaveTent(cliente)) || '[]') || []).filter(t => typeof t === 'string' && t >= desde) } catch { return [] } }
const lidos24h = cliente => tentativas24h(cliente).length
// UPs dos produtos pedidos (≤ 50, os visíveis na tela) → prévia { ups, teto_restante }
export function upsDosProdutos(cliente, chaves) {
  const quer = new Set(chaves.slice(0, 50)), g = grafoDoCliente(cliente)
  return [...new Set(g.produtos.filter(p => quer.has(p.chave)).flatMap(p => p.ups))].sort()
}
// lê /stock dos UPs (≤ teto do dia por cliente; ~1 chamada/s porque o rate limit de user-products é NOT_VERIFIED). Sucesso substitui a leitura do UP (local ausente
// = 0); falha NUNCA vira 0: só marca pendente (permissao_do_app em 401/403, indisponivel no resto) e a última leitura boa segue valendo até vencer.
export async function lerEstoqueUps(cliente, { ups = [], teto = P.stock_teto_por_coleta ?? 150, chamarFn = null, pausaMs = 1000 } = {}) {
  const fila = [...new Set(ups)].filter(u => /^MLBU\d{1,20}$/.test(u)), restam = Math.max(0, teto - lidos24h(cliente)), vez = fila.slice(0, restam)
  if (vez.length && !chamarFn) chamarFn = (await import('./meli-api.js')).chamar
  const del = db.prepare('DELETE FROM meli_up_estoque WHERE cliente = ? AND user_product_id = ?')
  const ins = db.prepare("INSERT INTO meli_up_estoque (cliente, user_product_id, local, quantidade, lojas, pendente, lido_em) VALUES (?,?,?,?,?,'',?)")
  const pend = db.prepare('UPDATE meli_up_estoque SET pendente = ? WHERE cliente = ? AND user_product_id = ?')
  const insPend = db.prepare('INSERT OR IGNORE INTO meli_up_estoque (cliente, user_product_id, local, quantidade, lojas, pendente, lido_em) VALUES (?,?,?,NULL,NULL,?,?)')
  let lidos = 0, falhas = 0
  for (const [k, up] of vez.entries()) {
    if (k && pausaMs) await new Promise(ok => setTimeout(ok, pausaMs))
    setEstado(chaveTent(cliente), JSON.stringify([...tentativas24h(cliente), new Date().toISOString()]))   // conta ANTES da chamada: a falha também gasta o teto
    let r; try { r = await chamarFn(cliente, `/user-products/${up}/stock`, { permitirFalha: true }) } catch { r = { _erro: true, status: 0 } }
    const locs = Array.isArray(r?.locations) ? r.locations : null, q = l => (Number.isFinite(l?.quantity) ? Math.round(l.quantity) : NaN)
    if (!r || r._erro || !locs || locs.some(l => Number.isNaN(q(l)))) {
      falhas++
      const motivo = r?.status === 401 || r?.status === 403 ? 'permissao_do_app' : 'indisponivel', em = agora()
      if (!pend.run(motivo, cliente, up).changes) for (const local of ['proprio', 'full']) insPend.run(cliente, up, local, motivo, em)
      continue
    }
    const prop = locs.filter(l => l.type === 'seller_warehouse' || l.type === 'selling_address'), ful = locs.filter(l => l.type === 'meli_facility'), em = agora()
    db.transaction(() => {
      del.run(cliente, up)
      ins.run(cliente, up, 'proprio', prop.reduce((t, l) => t + q(l), 0), new Set(prop.map(l => String(l.store_id ?? ''))).size || null, em)
      ins.run(cliente, up, 'full', ful.reduce((t, l) => t + q(l), 0), null, em)
    })()
    lidos++
  }
  return { lidos, falhas, pulados: fila.length - vez.length, teto, restavam: restam }
}
export const estoqueRestanteHoje = cliente => Math.max(0, (P.stock_teto_por_coleta ?? 150) - lidos24h(cliente))

// ════════ F5: kits — composição manual (prévia → confirmar), candidatos e Kit Virtual lido do ML (SÓ LEITURA, só anúncios com a tag bundle, com teto) ════════
const MODOS_KIT = ['kit_virtual', 'montado_na_hora', 'pre_montado']
const RX_QTD_KIT = /(?:kit|pacote|combo|jogo|c\/)\s*(?:com\s*)?(\d{1,3})/i
// GET /api/cliente/produtos/kits → { compostos[{ kit, nome, modo, fonte, componentes[] }], candidatos[{ kit, nome, quantidade?, componente?, motivo }] } — candidato NUNCA vira composição sozinho
export function kitsDoCliente(cliente) {
  const g = grafoDoCliente(cliente), ativos = g.produtos.filter(p => p.nos.some(n => n.status === 'active'))
  const nome = p => p.nos[0]?.titulo || p.chave, porChave = new Map(g.produtos.map(p => [p.chave, p]))
  const compostos = ativos.filter(p => p.kit).map(p => ({ kit: p.kit.origem, produto: p.chave, nome: nome(p), modo: p.kit.modo, fonte: p.kit.fonte,
    componentes: p.kit.componentes.map(c => ({ produto: c.produto, nome: nome(porChave.get(c.produto) || { chave: c.produto, nos: [] }), quantidade: c.q })) }))
  // pacote/unidades da ficha (PACKAGE_CONTENT / UNITS_PER_PACK da última fotografia do anúncio) e «Kit N» do título; componente provável pela sugestão de título (só sugere)
  const ficha = new Map()
  try {
    for (const r of db.prepare(`SELECT s.item_id, s.atributos_json FROM meli_item_snapshot s JOIN (SELECT item_id, MAX(capturado_em) m FROM meli_item_snapshot WHERE cliente = ? GROUP BY item_id) u
        ON u.item_id = s.item_id AND u.m = s.capturado_em WHERE s.cliente = ?`).all(cliente, cliente)) {
      let a = {}; try { a = JSON.parse(r.atributos_json || '{}') || {} } catch { a = {} }
      const n = Number(String(a.UNITS_PER_PACK ?? '').match(/\d{1,3}/)?.[0]) || Number(String(a.PACKAGE_CONTENT ?? '').match(/(\d{1,3})\s*(?:un|unid|pe[cç]as|x)\b/i)?.[1]) || null
      if (n && n > 1) ficha.set(r.item_id, n)
    }
  } catch { /* sem fotografias: só o título */ }
  const sug = new Map(sugerirMapeamento({ ...g, produtos: ativos }, { min: 0.65, max: 200 }).filter(x => x.tipo === 'kit').map(x => [x.origem, x]))
  const candidatos = ativos.filter(p => !p.kit && (p.kit_titulo || p.nos.some(n => ficha.has(n.item_id)))).slice(0, 100).map(p => {
    const s = sug.get(p.origens[0]), q = Number(nome(p).match(RX_QTD_KIT)?.[1]) || p.nos.map(n => ficha.get(n.item_id)).find(Boolean) || null
    return { kit: p.origens[0], produto: p.chave, nome: nome(p), quantidade: q, componente: s ? { produto: s.produto, nome: s.para } : null,
      motivo: [p.kit_titulo ? 'título com cara de kit' : '', p.nos.some(n => ficha.has(n.item_id)) ? 'ficha com unidades por pacote' : ''].filter(Boolean).join(' · ') }
  })
  return { cliente, compostos, candidatos, avisos: g.avisos.filter(a => /kit/.test(a)).slice(0, 20) }
}
// POST /api/cliente/produtos/kit { cliente, kit: 'up:…'|'item:…', componentes[{ chave, quantidade }], modo, por, confirmar } — composição DECLARADA por humano (modo obrigatório).
// Prévia por padrão (estoque do kit e do componente antes × depois); confirmar === true grava (líder, consultor ou o CS do cliente). Kit Virtual lido do ML não é sobrescrito.
export function criarKit({ agora: relogio = agora, validarPor = () => '' } = {}) {
  function salvar(b = {}) {
    const cliente = str(b.cliente), kit = str(b.kit), modo = str(b.modo)
    if (!ehOrigem(kit)) throw erro('informe o kit (up:MLBU… ou item:MLB… — a origem do anúncio do kit)')
    if (!MODOS_KIT.includes(modo)) throw erro('informe o modo do kit: kit_virtual, montado_na_hora ou pre_montado (sem modo não se grava: o modo errado conta o estoque em dobro ou esconde a ruptura)')
    const comps = Array.isArray(b.componentes) ? b.componentes : []
    if (!comps.length || comps.length > 6) throw erro('informe de 1 a 6 componentes')
    const lista = comps.map(c => ({ chave: str(c?.chave), quantidade: typeof c?.quantidade === 'number' ? c.quantidade : NaN }))
    if (lista.some(c => !ehChaveProduto(c.chave) || !Number.isInteger(c.quantidade) || c.quantidade < 1 || c.quantidade > 100)) throw erro('cada componente precisa de um produto (sku:…, cat:MLB…, up:MLBU… ou item:MLB…) e quantidade inteira de 1 a 100')
    if (new Set(lista.map(c => c.chave)).size !== lista.length) throw erro('componente repetido')
    const antes = grafoDoCliente(cliente), kp = antes.produtos.find(p => p.origens.includes(kit))
    if (!kp) throw erro('kit não encontrado nos anúncios deste cliente', 404)
    for (const c of lista) { const cp = antes.produtos.find(p => temIdentidade(p, c.chave)); if (!cp) throw erro('componente não encontrado nos anúncios deste cliente', 404); if (cp === kp) throw erro('o componente não pode ser o próprio kit') }
    if (db.prepare("SELECT 1 FROM kit_componente WHERE cliente = ? AND kit = ? AND fonte = 'ml_bundle' LIMIT 1").get(cliente, kit)) throw erro('este kit é um Kit Virtual do Mercado Livre: a composição vem do ML e não é editada aqui', 409)
    const regs = lista.map(c => ({ kit, componente: c.chave, quantidade: c.quantidade, modo, fonte: 'declarado' }))
    const depois = grafoDoCliente(cliente, { kitsExtra: regs }), kd = depois.produtos.find(p => p.origens.includes(kit))
    const r = { ok: true, kit, produto: kp.chave, modo, componentes: kd?.kit?.componentes || [], avisos: depois.avisos.filter(a => /kit/.test(a)).slice(0, 5) }
    if (b.confirmar !== true) return { ...r, previa: true }
    if (!kd?.kit) throw erro('a composição não resolve nos anúncios ativos: nada foi gravado')
    const por = str(b.por)
    if (!por) throw erro('informe "por" (quem registra — líder, consultor ou o CS do cliente)')
    const ok = validarPor(por, cliente)
    if (!ok) throw erro('somente líder, consultor ou o CS deste cliente registram a composição do kit', 403)
    const em = relogio(), ins = db.prepare('INSERT INTO kit_componente (cliente, kit, componente, quantidade, modo, fonte, por, em) VALUES (?,?,?,?,?,?,?,?)')
    db.transaction(() => { db.prepare("DELETE FROM kit_componente WHERE cliente = ? AND kit = ? AND fonte = 'declarado'").run(cliente, kit); for (const x of regs) ins.run(cliente, x.kit, x.componente, x.quantidade, x.modo, x.fonte, String(ok).slice(0, 80), em) })()
    return { ...r, previa: false }
  }
  return { salvar }
}
// Kit Virtual do ML: GET /items/{id} (o /items/bulk NÃO traz bundle — manual § Multiget) SÓ para anúncios com a tag bundle, teto por coleta, relido a cada 7 dias.
// bundle.components[{ type:'user_product', user_product_id, quantity }] → kit_componente (kit_virtual, ml_bundle), regravado por kit; falha nunca apaga a composição anterior.
export async function lerKitsVirtuais(cliente, { teto = P.kit_bundle_teto_por_coleta ?? 20, chamarFn = null, pausaMs = 1000, hoje = hojeLocal() } = {}) {
  const chave = `bundle_lido:${cliente}`
  let lidos = {}; try { lidos = JSON.parse(getEstado(chave) || '{}') || {} } catch { lidos = {} }
  const kits = db.prepare("SELECT item_id, MAX(user_product_id) up FROM meli_anuncio_up WHERE cliente = ? AND (',' || tags || ',') LIKE '%,bundle,%' AND status IN ('active','paused') GROUP BY item_id ORDER BY item_id").all(cliente)
  const fila = kits.filter(k => !(lidos[k.item_id] >= diaMenos(hoje, 7))).slice(0, Math.max(0, teto))
  if (fila.length && !chamarFn) chamarFn = (await import('./meli-api.js')).chamar
  const del = db.prepare("DELETE FROM kit_componente WHERE cliente = ? AND kit = ? AND fonte = 'ml_bundle'")
  const ins = db.prepare("INSERT OR REPLACE INTO kit_componente (cliente, kit, componente, quantidade, modo, fonte, por, em) VALUES (?,?,?,?,'kit_virtual','ml_bundle','coleta',?)")
  let ok = 0, falhas = 0
  for (const [k, it] of fila.entries()) {
    if (k && pausaMs) await new Promise(r => setTimeout(r, pausaMs))
    let r; try { r = await chamarFn(cliente, `/items/${it.item_id}`, { permitirFalha: true }) } catch { r = { _erro: true } }
    const comps = Array.isArray(r?.bundle?.components) ? r.bundle.components.filter(c => /^MLBU\d{1,20}$/.test(String(c?.user_product_id || '')) && Number.isInteger(c.quantity) && c.quantity >= 1) : null
    if (!r || r._erro || !comps) { falhas++; continue }
    const kit = it.up ? `up:${it.up}` : `item:${it.item_id}`, em = agora()
    db.transaction(() => { del.run(cliente, kit); for (const c of comps) ins.run(cliente, kit, `up:${c.user_product_id}`, Math.min(100, c.quantity), em) })()
    lidos[it.item_id] = hoje; ok++
  }
  setEstado(chave, JSON.stringify(lidos))
  return { lidos: ok, falhas, pulados: kits.length - fila.length }
}
