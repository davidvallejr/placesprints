// Semeadura ÚNICA do histórico do anúncio (meli_item_mudanca) com o que já existe no banco: promoções ativas (fonte 'promo': preço E estado
// de promoção), fotografias do acompanhamento ('acomp') e publicações verificadas de Ofertas ('ofertas'). Idempotente (UNIQUE): rodar de novo
// insere 0. Sem chamada a API. Ads e Full não têm semeadura: o histórico deles começa na 1ª coleta depois da implantação.
//   node scripts/semear-historico-anuncio.mjs                     → todos os clientes conectados (prospect [Comercial] fica fora)
//   node scripts/semear-historico-anuncio.mjs --cliente "Nome"    → um cliente
import { historico } from '../src/lib/preco-historico.js'
import { listarConexoes } from '../src/lib/meli-contas.js'
const i = process.argv.indexOf('--cliente')
const alvos = (i >= 0 ? [process.argv[i + 1]] : listarConexoes().map(c => c.cliente)).filter(c => c && !/^\[Comercial\] /.test(c))
const total = { promo: 0, acomp: 0, ofertas: 0, promocao: 0 }
const linha = n => `preço de promo ${n.promo} · estado de promoção ${n.promocao} · acomp ${n.acomp} · ofertas ${n.ofertas}`
for (const c of alvos) {
  try {
    const n = historico.semearHistoricoAnuncio(c)
    for (const k in total) total[k] += n[k]
    if (n.promo + n.acomp + n.ofertas + n.promocao) console.log(`✔ ${c}: ${linha(n)}`)
  } catch (e) { console.log(`✖ ${c}: ${e.message}`) }
}
console.log(`\n${alvos.length} cliente(s) · inseridos: ${linha(total)}`)
