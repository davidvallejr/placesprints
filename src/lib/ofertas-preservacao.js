// Preservação de atributos do módulo Ofertas (Trocar/Preservar). PURO: sem banco, sem rede, sem config — importável por relatórios e diagnósticos
// que nunca podem abrir data/db.sqlite (ofertas.js abre o banco no import; por isso o núcleo da preservação vive aqui e ofertas.js só reexporta).
// ── Trocar/Preservar (docs/ofertas/oferta-mkt-SKILL.md): o que a ficha afirma COM FONTE tem de continuar no texto proposto e no prompt de imagem ──
// Fonte do fato: atributo da ficha com fonte (valor proposto exige evidência) > campo da variante/produto (dado do cliente na planilha/importação).
// Nunca inventa: campo vazio na ficha não entra em `preservar`. Comparação sem acento/caixa, por palavra, tolerando plural óbvio ("azul"≈"azuis" não; "cabo"≈"cabos" sim)
// e a abreviação do kit ("3 un" ≈ "kit 3" ≈ "c/ 3 unidades"). `campos` restringe a conferência (título só confere a identidade; descrição confere tudo).
export const CAMPOS_IDENTIDADE = ['cor', 'tamanho', 'material', 'quantidade_kit']      // mudou a identidade física → a referência confirmada deixa de valer
export const CAMPOS_PRESERVAR = [...CAMPOS_IDENTIDADE, 'marca', 'modelo', 'conteudo_embalagem', 'acessorios']
export const CAMPOS_PRESERVAR_TITULO = ['cor', 'tamanho', 'quantidade_kit']     // o que um título de 60 caracteres não pode perder em silêncio
export const ROTULO_PRESERVAR = { cor: 'cor', tamanho: 'tamanho', material: 'material', quantidade_kit: 'kit', marca: 'marca', modelo: 'modelo', conteudo_embalagem: 'conteúdo da embalagem', acessorios: 'acessórios incluídos' }
const ATRIBUTO_DO_CAMPO = { cor: ['COLOR', 'COR'], tamanho: ['SIZE', 'TAMANHO'], material: ['MATERIAL'], marca: ['BRAND', 'MARCA'], modelo: ['MODEL', 'MODELO'], conteudo_embalagem: ['PACKAGE_CONTENT', 'CONTEUDO_EMBALAGEM'], acessorios: ['ACCESSORIES_INCLUDED', 'ACESSORIOS_INCLUIDOS'] }
const fatoComFonte = x => !!x && !!x.fonte && (x.valor_proposto ? !!x.evidencia : !!x.valor_atual)
const normPalavras = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em', 'a', 'o', 'um', 'uma', 'x'])
const KIT_ANTES = '(kit|conjunto|pack|jogo|c|com|x)', KIT_DEPOIS = '(un|und|unid|unidade|unidades|pc|pcs|peca|pecas|pares?|itens|x)'
export function checarPreservacao(ficha, texto, { campos = CAMPOS_PRESERVAR } = {}) {
  const preservar = []
  for (const campo of campos) {
    if (campo === 'quantidade_kit') { const n = Number(ficha?.quantidade_kit); if (Number.isInteger(n) && n > 1) preservar.push({ campo, valor: n, fonte: 'ficha da variante' }); continue }
    const atr = (ficha?.atributos || []).find(x => (ATRIBUTO_DO_CAMPO[campo] || []).includes(String(x?.atributo_id || '').toUpperCase()) && fatoComFonte(x))
    const valor = atr ? String(atr.valor_proposto ?? atr.valor_atual).trim() : String(ficha?.[campo] ?? '').trim()
    if (valor) preservar.push({ campo, valor, fonte: atr ? atr.fonte : ['marca', 'modelo'].includes(campo) ? 'ficha do produto' : 'ficha da variante' })
  }
  const t = normPalavras(texto), palavras = new Set(t.split(' ').filter(Boolean))
  const temPalavra = p => [p, `${p}s`, `${p}es`, p.replace(/es$/, ''), p.replace(/s$/, '')].some(f => f && palavras.has(f))
  const presente = ({ campo, valor }) => campo === 'quantidade_kit'
    ? new RegExp(`(^| )(${KIT_ANTES} ${valor}|${valor} ?${KIT_DEPOIS}|${valor}x)( |$)`).test(t)
    : normPalavras(valor).split(' ').filter(p => p && !PALAVRAS_VAZIAS.has(p)).every(temPalavra)
  const faltantes = preservar.filter(p => !presente(p)).map(({ campo, valor }) => ({ campo, valor }))
  return { ok: faltantes.length === 0, faltantes, preservar }
}
