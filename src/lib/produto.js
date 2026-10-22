// Produto do cliente (Place Performance × Place Prime) como DIMENSÃO — nunca um segundo motor (docs/desenho-place-prime.md § A).
// Puro: só lê config/produtos.json (decisão do David, 21/10/2026; lista FECHADA de tiers). Tier fora da lista = produto '' + pendência
// 'produto_nao_mapeado' (vai para cadastro:pendencias via cadastro-clientes.registrarPendenciasProduto), nunca inferido.
// Nome: produtoDoCliente/produtoDeTier — `produtoDe` é do grafo de anúncios (duplicacao.js).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
export const CFG_PRODUTOS = JSON.parse(readFileSync(join(ROOT, 'config', 'produtos.json'), 'utf-8'))
export const PRODUTOS = Object.keys(CFG_PRODUTOS.produtos)                 // ['performance', 'prime']
export const SEM_PRODUTO = 'sem_produto'                                    // chave de grupo/filtro do cliente sem produto mapeado
export const PENDENCIA_PRODUTO = CFG_PRODUTOS.pendencia_quando_fora_da_lista // 'produto_nao_mapeado'
export const ROTULO_PRODUTO = { ...Object.fromEntries(PRODUTOS.map(p => [p, CFG_PRODUTOS.produtos[p].nome])), [SEM_PRODUTO]: 'Sem produto mapeado' }

// tier (texto da central) → { produto: 'performance'|'prime'|'', subtipo, nome }; casamento exato após aparar espaços
export function produtoDeTier(tier, cfg = CFG_PRODUTOS) {
  const m = cfg.tier_para_produto[String(tier ?? '').trim()]
  if (!m || !cfg.produtos[m.produto]) return { produto: '', subtipo: '', nome: '', pendencia: cfg.pendencia_quando_fora_da_lista }
  return { produto: m.produto, subtipo: m.subtipo || '', nome: cfg.produtos[m.produto].nome }
}
// cliente = linha com tier (carregarClientes / clientes_central) ou o próprio texto do tier
export const produtoDoCliente = (cliente, cfg = CFG_PRODUTOS) => produtoDeTier(typeof cliente === 'string' ? cliente : cliente?.tier, cfg)
// chave usada na medida, no filtro e no grupo: produto ou SEM_PRODUTO
export const chaveProduto = cliente => produtoDoCliente(cliente).produto || SEM_PRODUTO

// pendências de cadastro: um item por cliente com tier fora da lista (formato de cadastro:pendencias)
export const pendenciasProduto = clientes => clientes.filter(c => !produtoDoCliente(c).produto)
  .map(c => ({ nome: c.cliente, motivo: PENDENCIA_PRODUTO, candidatos: [], canais: [], tier: String(c.tier ?? '') }))

// contagem da carteira por produto (linhas fixas Performance · Prime · sem produto): clientes da central × contas conectadas
export function carteiraPorProduto(clientes, conectados = []) {
  const con = new Set(conectados), linhas = [...PRODUTOS, SEM_PRODUTO].map(p => ({ produto: p, rotulo: ROTULO_PRODUTO[p], clientes: 0, conectados: 0 }))
  for (const c of clientes) { const l = linhas.find(x => x.produto === chaveProduto(c)); l.clientes++; if (con.has(c.cliente)) l.conectados++ }
  return linhas
}
