// Predicado ÚNICO do anúncio de CATÁLOGO: 'nao' | 'proprio' | 'terceiros'. Módulo SEM imports (como estado-anuncio.js): ofertas, plano, relatórios e o avaliador de
// pendências usam a mesma pergunta, nunca uma cópia. Pedido do David (08/10/2026): em catálogo de TERCEIROS não há como alterar foto, título, descrição nem ficha;
// em catálogo PRÓPRIO o conteúdo só muda por sugestão de correção, com revisão do Mercado Livre.
//   • item.catalogo falsy → 'nao' (anúncio tradicional: conteúdo editável).
//   • catalog_product_id NÃO é a flag (item tradicional ligado a produto de catálogo continua editável) e o usuário de User Products (título travado por outro motivo,
//     ofertas-ml.js) fica FORA deste predicado.
//   • "próprio" não é determinável por API: só existe por marcação manual. Prioridade: exceção por anúncio > padrão do cliente > 'terceiros' (padrão seguro).
// ctx = { padrao: 'proprio' | 'terceiros' | null, excecoes: Map<item_id, 'proprio'|'terceiros'> | { [item_id]: origem } } (catalogo-db.js → contexto(cliente)).
// Sem ctx (undefined/null) vale o item JÁ resolvido (item.catalogo_origem, como nos payloads); sem ele, catálogo é 'terceiros'.
export const ORIGENS = ['nao', 'proprio', 'terceiros']
const idDe = it => it.id ?? it.item_id ?? it.anuncio_id
const marcada = o => o === 'proprio' || o === 'terceiros'

export function origemCatalogo(item, ctx) {
  if (!item || typeof item !== 'object') return 'nao'
  if (!ctx && ORIGENS.includes(item.catalogo_origem) && !(item.catalogo_origem === 'nao' && item.catalogo)) return item.catalogo_origem     // "nao" com catalogo verdadeiro é contradição: vale o padrão seguro
  if (!item.catalogo) return 'nao'
  const ex = ctx?.excecoes instanceof Map ? ctx.excecoes.get(idDe(item)) : ctx?.excecoes && Object.hasOwn(ctx.excecoes, idDe(item)) ? ctx.excecoes[idDe(item)] : undefined
  if (marcada(ex)) return ex
  return ctx?.padrao === 'proprio' ? 'proprio' : 'terceiros'
}

// true = foto, título, descrição e ficha podem ser alterados DIRETO pelo vendedor ('nao'); false = catálogo (terceiros: nunca; próprio: só por sugestão de correção,
// com revisão do ML — a recomendação vira o texto de sugestão, sem passo de edição direta). O pedido do David chama de "editável" o catálogo próprio ("pode até
// realizar alterações"), por isso aqui 'proprio' também é true; quem precisa separar o "direto" do "por sugestão" usa origemCatalogo.
export const editavelConteudo = (item, ctx) => origemCatalogo(item, ctx) !== 'terceiros'

// edição DIRETA no item (PUT /items): só fora do catálogo
export const edicaoDiretaConteudo = (item, ctx) => origemCatalogo(item, ctx) === 'nao'
