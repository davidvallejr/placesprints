// Autoteste do núcleo do Chaveiro (F1: caminho declarado + cobertura; puro, sem banco, sem rede). Rodar: node scripts/teste-chaveiro-nucleo.mjs
import assert from 'node:assert/strict'
import { classificarCaminho, cobertura, CAMINHOS, OPERACOES, CFG } from '../src/lib/chaveiro.js'
import { TEXTO_CATALOGO } from '../src/lib/catalogo-cfg.js'

// 1) todas as 34 regras da seção 5 (+ as 5 de saúde da conta, v1.5.0), no caso mais comum (regra por causa: 1ª causa da matriz); custos informados
const CAUSA = { queda_conversao_anuncio: 'preco', queda_exposicao_anuncio: 'ads_desligou', margem_negativa: 'preco_abaixo_do_custo', anuncio_restrito: 'pausa', full_estoque_antigo: 'giro_com_promocao', estoque_dividido: 'confirmar_fisico' }
const ESPERADO = {
  ima_conversao: 'automatico', catalogo_buybox: 'automatico', estoque_ruptura: 'cliente', full_envio: 'cliente', ads_entrar: 'assistido', ads_escalar: 'assistido', ads_reduzir: 'assistido',
  ads_otimizar_antes: 'automatico', conteudo_fotos: 'automatico', frete_gratis: 'automatico', sazonal: 'assistido', urgencia_oculta: 'assistido', promocao_giro: 'automatico', cadastrar_custos: 'cliente',
  duplicacao_estrategica: 'automatico', oferta_galeria: 'automatico', oferta_titulo_descricao: 'automatico', oferta_completa: 'automatico', oferta_ficha: 'automatico', oferta_preco: 'automatico', oferta_cadastro: 'automatico',
  preco_mudou_vendas_cairam: 'automatico', queda_conversao_anuncio: 'automatico', queda_exposicao_anuncio: 'assistido', queda_ctr_ads: 'automatico', margem_negativa: 'automatico', ads_abaixo_meta: 'assistido', concentracao_receita: 'assistido', anuncio_restrito: 'automatico',
  // v1.5.0 — saúde da conta: quem executa é o cliente (pendência), reputação é assistido (card), Full com margem vai por promoções (por causa; sem margem → cliente)
  reputacao_em_risco: 'assistido', envio_atrasado: 'cliente', reclamacao_sem_resposta: 'cliente', pergunta_sem_resposta: 'cliente', full_estoque_antigo: 'automatico',
  // V3 F3 — estoque_dividido por causa (confirmar_fisico = pergunta ao cliente; pool_zerando = card), sku_ausente assistido (SELLER_SKU é atributo, fora da lista fechada)
  estoque_dividido: 'cliente', sku_ausente: 'assistido',
  // V3 F6 — sincronismo: com a chave sync_estoque_ligado desligada (padrão) o ajuste sai assistido; divergência = contagem do cliente. V3 F8 — nota: emitir (nf) e regra fiscal do cliente
  estoque_sincronizar: 'assistido', estoque_divergente: 'cliente', nf_pendente: 'automatico', nf_regra_faltando: 'cliente' }
assert.equal(Object.keys(CFG.caminho_por_regra).length, 40); assert.deepEqual(Object.keys(ESPERADO).sort(), Object.keys(CFG.caminho_por_regra).sort())
const cont = { automatico: 0, assistido: 0, cliente: 0, sem_caminho: 0 }
for (const [regra, esp] of Object.entries(ESPERADO)) {
  const ex = classificarCaminho({ regra: 'anuncio_' + regra, dados: { causas_possiveis: CAUSA[regra] ? [{ causa: CAUSA[regra] }] : [] } }, { custosInformados: true })
  assert.equal(ex.caminho, esp, regra); assert.ok(CAMINHOS.includes(ex.caminho)); assert.ok(OPERACOES[ex.adaptador].includes(ex.operacao), `${regra}: ${ex.adaptador}·${ex.operacao}`)
  assert.equal(ex.janela_prova_dias, 14); assert.ok(typeof ex.motivo === 'string' && ex.motivo.length); cont[ex.caminho]++
}
assert.deepEqual(cont, { automatico: 20, assistido: 11, cliente: 9, sem_caminho: 0 })     // seção 5 linha a linha (a contagem 15/9/5 do texto não bate com a tabela) + v1.5.0: 1 automático (Full), 1 assistido (reputação), 3 cliente
assert.equal(classificarCaminho({ regra: 'anuncio_full_estoque_antigo', dados: { causas_possiveis: [{ causa: 'retirada_do_full' }] } }, { custosInformados: false }).caminho, 'cliente', 'Full sem margem: retirada é do cliente')
assert.ok(classificarCaminho({ regra: 'frete_gratis', dados: {} }, { custosInformados: true }).experimento_elegivel)
assert.equal(classificarCaminho({ regra: 'ads_entrar', dados: {} }, { custosInformados: true }).experimento_elegivel, false)

// 2) catálogo de terceiros × conteúdo → sem_caminho com o texto do catálogo; próprio → assistido; preço em catálogo segue
for (const regra of ['oferta_galeria', 'oferta_ficha', 'oferta_completa', 'oferta_titulo_descricao', 'conteudo_fotos']) {
  const ex = classificarCaminho({ regra, dados: {} }, { custosInformados: true, catalogoOrigem: 'terceiros' })
  assert.equal(ex.caminho, 'sem_caminho', regra); assert.equal(ex.adaptador, 'nenhum'); assert.equal(ex.motivo, TEXTO_CATALOGO.terceiros); assert.ok(ex.pendencias.length)
}
assert.equal(classificarCaminho({ regra: 'oferta_galeria', dados: {} }, { catalogoOrigem: 'proprio' }).caminho, 'assistido')
assert.equal(classificarCaminho({ regra: 'catalogo_buybox', dados: {} }, { custosInformados: true, catalogoOrigem: 'terceiros' }).caminho, 'automatico')
assert.equal(classificarCaminho({ regra: 'oferta_preco', dados: {} }, { custosInformados: true, catalogoOrigem: 'terceiros' }).caminho, 'automatico', 'escopo preco não é conteúdo')

// 3) preço sem custos → assistido com pendência fixa
for (const regra of ['preco_mudou_vendas_cairam', 'catalogo_buybox', 'frete_gratis']) {
  const ex = classificarCaminho({ regra, dados: {} }, { custosInformados: false })
  assert.equal(ex.caminho, 'assistido', regra); assert.deepEqual(ex.pendencias, [CFG.pendencias.custos]); assert.equal(ex.experimento_elegivel, false)
}
// 4) regra desconhecida → sem_caminho; regra por causa sem causa (ou causa não listada) → assistido; executar_via coerente
assert.deepEqual(classificarCaminho({ regra: 'anuncio_inexistente', dados: {} }).caminho, 'sem_caminho')
assert.equal(classificarCaminho({ regra: 'anuncio_inexistente', dados: {} }).motivo, CFG.motivos.sem_regra)
assert.equal(classificarCaminho({ regra: 'queda_conversao_anuncio', dados: {} }).caminho, 'assistido')
assert.equal(classificarCaminho({ regra: 'queda_conversao_anuncio', dados: { causas_possiveis: [{ causa: 'outra' }] } }).caminho, 'assistido')
assert.equal(classificarCaminho({ regra: 'queda_conversao_anuncio', dados: { causas_possiveis: [{ causa: 'disponibilidade' }] } }).caminho, 'cliente')
assert.equal(classificarCaminho({ regra: 'margem_negativa', dados: { causas_possiveis: [{ causa: 'ads_consome_a_margem' }] } }).adaptador, 'ads')
assert.equal(classificarCaminho({ regra: 'anuncio_restrito', dados: { causas_possiveis: [{ causa: 'pausa_ou_moderacao' }] } }).caminho, 'assistido', 'sub_status não coletado: humano confere')
assert.equal(classificarCaminho({ regra: 'frete_gratis', dados: { executar_via: 'oferta' } }, { custosInformados: true }).adaptador, 'ofertas')
assert.equal(classificarCaminho({ regra: 'promocao_giro', dados: { executar_via: 'promocoes' } }).adaptador, 'promocoes')
assert.equal(classificarCaminho({ regra: 'oferta_galeria', dados: { prova_janela_dias: 7 } }).janela_prova_dias, 7)

// 4b) V3 F6: estoque automático só com a chave global E o cliente liberado; senão assistido com pendência fixa
assert.equal(classificarCaminho({ regra: 'estoque_sincronizar', dados: {} }, { syncLiberado: true }).caminho, 'assistido', 'chave global desligada no config')
assert.equal(classificarCaminho({ regra: 'estoque_sincronizar', dados: {} }, { syncLiberado: true, cfg: { ...CFG, sync_estoque_ligado: true } }).caminho, 'automatico')
assert.equal(classificarCaminho({ regra: 'estoque_sincronizar', dados: {} }, { syncLiberado: false, cfg: { ...CFG, sync_estoque_ligado: true } }).caminho, 'assistido', 'cliente não liberado')
assert.deepEqual(classificarCaminho({ regra: 'estoque_sincronizar', dados: {} }).pendencias, [CFG.pendencias.sync_estoque])
// 5) cobertura: mistura + ação antiga sem execucao
const ac = c => ({ dados: { execucao: classificarCaminho({ regra: c.r, dados: c.d || {} }, { custosInformados: true, catalogoOrigem: c.cat || 'nao' }) } })
const cov = cobertura([ac({ r: 'oferta_galeria' }), ac({ r: 'ads_entrar' }), ac({ r: 'estoque_ruptura' }), ac({ r: 'oferta_galeria', cat: 'terceiros' }), { dados: {} }, {}])
assert.deepEqual(cov, { total: 6, com_caminho: 3, por_caminho: { automatico: 1, assistido: 1, cliente: 1, sem_caminho: 3 }, por_adaptador: { ofertas: 1, ads: 1, pendencia: 1, nenhum: 3 }, pct_com_caminho: 50 })
assert.deepEqual(cobertura([]), { total: 0, com_caminho: 0, por_caminho: { automatico: 0, assistido: 0, cliente: 0, sem_caminho: 0 }, por_adaptador: {}, pct_com_caminho: 0 })
console.log('✔ chaveiro-nucleo: 29 regras (automático 18, assistido 8, cliente 3), catálogo de terceiros, preço sem custos, regra desconhecida, causas, cobertura')
