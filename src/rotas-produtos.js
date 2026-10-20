// HTTP do PRODUTO por trás do anúncio — V3 F2, em SOMBRA (docs/desenho-v3-produto-estoque-financeiro.md § 8.4; src/lib/produto-estoque-real.js). Loopback (guarda-local).
// Regras: cliente canônico da central, senão 404; prospect «[Comercial] …» = 400 com mensagem fixa; corpo JSON nos POST (415); prévia por padrão — grava só com
// confirmar === true; `por` validado no núcleo (403: líder, consultor ou o CS do cliente); mensagens fixas, nunca ecoam o valor recebido. NENHUMA escrita no ML.
//   GET  /api/cliente/produtos?cliente=                → { resumo, produtos[], premissas[], data_quality, sombra } | { disponivel:false, motivo }
//   GET  /api/cliente/produtos/mapeamento?cliente=     → { sugestoes[], mapeados[], nao_mapeados[], totais }
//   POST /api/cliente/produtos/juntar  { cliente, origem, produto, por, confirmar? } → prévia { previa:true, antes, depois, mudou } | gravado { previa:false, … }
//   POST /api/cliente/produtos/separar { cliente, origem, produto, por, confirmar? } → idem (recusa: nunca juntar automaticamente)
//   POST /api/cliente/produtos/estoque/atualizar { cliente, produtos:[chave…] (≤ 50) | produto, por (com confirmar), confirmar? } → prévia { ups, teto_restante } | { lidos, falhas, pulados }
//   POST /api/cliente/produtos/estoque-fisico { cliente, sku, quantidade, fonte: cliente|equipe, por (com confirmar), confirmar? } (V3 F3) → prévia { previa:true, produto, antes, depois } | gravado { previa:false, modo_depois }
//   GET  /api/cliente/produtos/kits?cliente=          (V3 F5) → { compostos[], candidatos[] } (candidato só sugere: nunca vira composição sozinho)
//   POST /api/cliente/produtos/kit { cliente, kit, componentes[{ chave, quantidade }], modo: kit_virtual|montado_na_hora|pre_montado, por (com confirmar), confirmar? } (V3 F5) → prévia | gravado
//   GET  /api/cliente/dre?cliente=&mes=AAAA-MM (V3 F4; padrão: mês corrente) → { linhas[], parcial, fora[], rodape: 'Não é lucro líquido.', premissas[] } | { disponivel:false, motivo }
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: dre(cliente, mes) → DRE simples (lucro-real.dreDoCliente) · mesAtual() → 'AAAA-MM' · produtos(cliente) → projeção · mapeamento(cliente) · vinculos { juntar, separar } (criarVinculoProduto) · estoque { ups(cliente, chaves), restante(cliente), ler(cliente, ups), validarPor(nome, cliente) → nome | '' }
//       · quem() → nomes que podem decidir · clienteCanonico(nome) → nome | ''
export function criarRotasProdutos({ produtos, mapeamento, vinculos, estoque, estoqueFisico = null, kits = null, dre, mesAtual, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (ehProspecto(c)) throw erro('prospect do comercial não tem produtos: só cliente da central')
    const canon = c ? clienteCanonico(c) : ''
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  r.get('/api/cliente/produtos', trata((req, res) => res.json(produtos(cliente(um(req.query.cliente))))))
  r.get('/api/cliente/dre', trata((req, res) => {
    const c = cliente(um(req.query.cliente)), mes = um(req.query.mes) || mesAtual()
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw erro('mês inválido: use AAAA-MM')
    res.json(dre(c, mes))
  }))
  r.get('/api/cliente/produtos/mapeamento', trata((req, res) => res.json({ ...mapeamento(cliente(um(req.query.cliente))), quem: quem() })))
  for (const acao of ['juntar', 'separar']) r.post(`/api/cliente/produtos/${acao}`, trata((req, res) => {
    const b = json(req)
    res.json(vinculos[acao]({ cliente: cliente(b.cliente), origem: b.origem, produto: b.produto, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  // V3 F3: estoque físico PRÓPRIO informado pelo cliente/equipe por SKU oficial (escrita LOCAL; vira modo «declarado» no grafo; nada vai ao ML)
  if (estoqueFisico) r.post('/api/cliente/produtos/estoque-fisico', trata((req, res) => {
    const b = json(req)
    res.json(estoqueFisico.salvar({ cliente: cliente(b.cliente), sku: b.sku, quantidade: b.quantidade, fonte: b.fonte, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  // V3 F5: composição de kit (escrita LOCAL; modo obrigatório; Kit Virtual do ML não é editado aqui)
  if (kits) {
    r.get('/api/cliente/produtos/kits', trata((req, res) => res.json({ ...kits.listar(cliente(um(req.query.cliente))), quem: quem() })))
    r.post('/api/cliente/produtos/kit', trata((req, res) => {
      const b = json(req)
      res.json(kits.salvar({ cliente: cliente(b.cliente), kit: b.kit, componentes: b.componentes, modo: b.modo, por: texto(b.por), confirmar: b.confirmar === true }))
    }))
  }
  r.post('/api/cliente/produtos/estoque/atualizar', trata(async (req, res) => {
    const b = json(req), c = cliente(b.cliente)
    const chaves = (Array.isArray(b.produtos) ? b.produtos : [b.produto]).filter(x => typeof x === 'string' && x.length <= 200)
    if (!chaves.length || chaves.length > 50) throw erro('informe de 1 a 50 produtos (os visíveis na tela)')
    const ups = estoque.ups(c, chaves), restante = estoque.restante(c)
    if (b.confirmar !== true) return res.json({ ok: true, previa: true, ups: ups.length, teto_restante: restante })
    const por = texto(b.por)                                                   // § 8.4: `por` validado em toda rota que age (aqui: chamadas ao ML com teto)
    if (!por) throw erro('informe "por" (quem pede a leitura — líder, consultor ou o CS do cliente)')
    if (!(estoque.validarPor ? estoque.validarPor(por, c) : '')) throw erro('somente líder, consultor ou o CS deste cliente pedem a leitura do estoque', 403)
    res.json({ ok: true, previa: false, ...(await estoque.ler(c, ups)) })
  }))
  return r
}
