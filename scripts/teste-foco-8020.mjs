// Autoteste do Foco 80/20 + atribuição por anúncio (F1, só leitura; docs/desenho-merovingio-foco-8020.md § «Construído»). Banco em memória, sem rede.
//  (1) curva de concentração com corte derivado (joelho) ≠ 80 fixo; (2) o que cada janela 15/30/45/60/90 consegue afirmar (dado, não calendário);
//  (3) matriz de vereditos (risco nunca sai, pausa só ≥ 60 d com n ≥ 8, Sobrevivência barra pausa, esforço sem alvo = reduzir); (4) montarFoco sintético;
//  (5) atribuição: individual / sequencial / conjunto / confundido, preço < limiar não confunde, assinatura com ordem, card ↔ mudança só com candidato único,
//      texto sem «causa» e sem piora ao cliente; (6) motor inteiro no banco em memória + rota (404 prospect, 400 janela).
// Rodar: node scripts/teste-foco-8020.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')
const F = await import('../src/lib/foco-8020.js')
const A = await import('../src/lib/atribuicao.js')
const { focoDoCliente } = await import('../src/lib/foco-real.js')
const { criarRotasFoco } = await import('../src/rotas-foco.js')
const { addDias } = await import('../src/lib/meli-serie.js')
const { auditarTexto, codigosDe } = await import('../src/lib/relatorio-seguro.js')
const express = (await import('express')).default

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const med = (o = {}) => ({ id: 't' + Math.random(), tipo: 'Otimizar Anúncios', data: '2026-09-10', estado: 'melhorou', escopo: 'anuncios', itens: ['MLB1'], efeito_pct: 20, receita_alocada: 100, ...o })

await caso('curva: tudo igual = sem concentração (corte n, gini 0); um com 90% = corte 1; joelho ≠ 80 fixo', () => {
  const iguais = F.curvaConcentracao(Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, valor: 10 })))
  assert.equal(iguais.n_corte, 10); assert.equal(iguais.gini, 0); assert.equal(iguais.afirmavel, false); assert.match(iguais.motivo, /pesam praticamente igual/)
  const um = F.curvaConcentracao([{ id: 'x', valor: 900 }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'b' + i, valor: 100 / 9 }))])
  assert.equal(um.n_corte, 1); assert.equal(um.top1_pct, 90); assert.ok(um.gini > 0.7)
  // 3 de 20 fazem 70%; 17 dividem 30%
  const c = F.curvaConcentracao([...[300, 250, 150].map((v, i) => ({ id: 't' + i, valor: v })), ...Array.from({ length: 17 }, (_, i) => ({ id: 'c' + i, valor: 300 / 17 }))])
  assert.equal(c.n_corte, 3); assert.equal(c.share_corte_pct, 70); assert.equal(c.n_80, 9, '80% continua sendo 9'); assert.notEqual(c.n_corte, c.n_80)
  assert.equal(F.curvaConcentracao([{ id: 'z', valor: 0 }]).disponivel, false)
  const pouca = F.curvaConcentracao([{ id: 'p', valor: 5 }, { id: 'q', valor: 1 }]); assert.equal(pouca.n_corte, 2); assert.equal(pouca.afirmavel, false)
})

await caso('janelas: 15 d só curva provisória; série curta rebaixa o marco; lacuna barra o estado; vereditos permitidos crescem com o marco', () => {
  const j15 = F.oQueAfirmar(15, { diasSerie: 20 })
  assert.equal(j15.marco_efetivo, 15); assert.equal(j15.afirmavel.curva, true); assert.equal(j15.afirmavel.curva_provisoria, true); assert.equal(j15.afirmavel.estado, false)
  assert.deepEqual(j15.vereditos_permitidos, ['em_observacao', 'manter']); assert.equal(j15.degrau_max, 'N0')
  const curta = F.oQueAfirmar(90, { diasSerie: 40, medidasCompletas: 2 })
  assert.equal(curta.marco_efetivo, 30); assert.match(curta.motivos[0], /só 40 dia\(s\).*vale como 30 d/); assert.equal(curta.afirmavel.efeito, true); assert.equal(curta.afirmavel.veredito_familia, false)
  assert.ok(!curta.vereditos_permitidos.includes('pausado_por_evidencia'))
  assert.equal(F.oQueAfirmar(60, { diasSerie: 120, lacunas: 6 }).afirmavel.estado, false)
  const j60 = F.oQueAfirmar(60, { diasSerie: 120, medidasCompletas: 9, maxNFamilia: 8 })
  assert.equal(j60.afirmavel.veredito_familia, true); assert.ok(j60.vereditos_permitidos.includes('pausado_por_evidencia')); assert.equal(j60.afirmavel.estado_confirmado, true)
  assert.equal(F.oQueAfirmar(45, { diasSerie: 50, maxNFamilia: 5 }).afirmavel.prior_calibrado, true)
  assert.equal(F.oQueAfirmar(10, { diasSerie: 100 }).marco_efetivo, 0)
})

await caso('efeito: confundidas, conta inteira e maturação não entram na célula; ganho líquido = melhorou − |piorou|', () => {
  const ms = [med(), med({ receita_alocada: 50 }), med({ estado: 'piorou', receita_alocada: -30 }), med({ estado: 'sem_efeito' }),
    med({ confundido_preco: true }), med({ escopo: 'conta', itens: [] }), med({ estado: 'em_maturacao' })]
  const c = F.celulaEfeito(ms)
  assert.equal(c.n, 4); assert.equal(c.melhorou, 2); assert.equal(c.piorou, 1); assert.equal(c.ganho_liquido, 120); assert.equal(c.n_excluidas, 1)
  assert.equal(c.n_sem_vinculo, 1); assert.equal(c.n_em_maturacao, 1); assert.equal(c.veredito, 'sem_amostra')
})

const ef = (veredito, n = 8) => ({ veredito, n, melhorou: 1, taxa: 0.1, taxa_baixo: 0.02, taxa_alto: 0.2 })
await caso('veredito: risco = manter; pausa só com marco 60 + n ≥ 8 + fora de Sobrevivência; esforço sem alvo = reduzir; escalar só ≥ 45 d', () => {
  const todos = Object.keys(F.ROTULO_VEREDITO)
  const caro = { efeito: ef('nao_funciona'), share_esforco_pct: 30, share_resultado_pct: 2 }
  assert.equal(F.vereditoFoco(caro, { marco: 60, permitidos: todos }).veredito, 'pausado_por_evidencia')
  assert.equal(F.vereditoFoco(caro, { marco: 60, permitidos: todos, risco: 'estoque para 3 dia(s)' }).veredito, 'manter')
  const sob = F.vereditoFoco(caro, { marco: 60, permitidos: todos, sobrevivencia: true })
  assert.equal(sob.veredito, 'em_observacao'); assert.ok(sob.faltam.some(f => /Sobrevivência/.test(f)))
  const a45 = F.oQueAfirmar(45, { diasSerie: 50 }).vereditos_permitidos
  assert.equal(F.vereditoFoco(caro, { marco: 45, permitidos: a45 }).veredito, 'reduzir', 'antes dos 60 d «não funciona» só reduz')
  const semAlvo = F.vereditoFoco({ efeito: ef('sem_amostra', 1), share_esforco_pct: 15, share_resultado_pct: 0, sem_alvo_pct: 93 }, { marco: 30, permitidos: F.oQueAfirmar(30, { diasSerie: 40 }).vereditos_permitidos })
  assert.equal(semAlvo.veredito, 'reduzir'); assert.match(semAlvo.motivo, /sem alvo/); assert.equal(semAlvo.p, null, 'sem p com < 5 medidas'); assert.match(semAlvo.fonte_p, /mínimo 5/)
  const topo = { efeito: ef('funciona', 10), share_esforco_pct: 20, share_resultado_pct: 40 }
  assert.equal(F.vereditoFoco(topo, { R_alto: true, marco: 45, permitidos: a45 }).veredito, 'manter_e_escalar')
  const t30 = F.vereditoFoco(topo, { R_alto: true, marco: 30, permitidos: F.oQueAfirmar(30, { diasSerie: 40 }).vereditos_permitidos })
  assert.equal(t30.veredito, 'manter'); assert.ok(t30.faltam.some(f => /45 d/.test(f)))
  const cresce = F.vereditoFoco({ efeito: ef('sem_amostra', 0), tendencia: { estado: 'crescimento', significativo: true }, share_resultado_pct: 30 }, { R_alto: true, marco: 45, permitidos: a45 })
  assert.equal(cresce.veredito, 'manter_e_escalar')
  assert.equal(F.vereditoFoco({ efeito: ef('sem_amostra', 0), share_esforco_pct: 5, share_resultado_pct: 1 }, { marco: 90, permitidos: todos }).veredito, 'em_observacao')
})

await caso('montarFoco: curva por anúncio na janela, família sem anúncio citado = reduzir, custo de oportunidade só com família n ≥ 8, horas NOT_COLLECTED', () => {
  const ate = '2026-10-20', porItem = new Map()
  const s = v => { const o = { unidades: {}, receita: {} }; for (let d = addDias(ate, -100); d <= ate; d = addDias(d, 1)) { o.unidades[d] = 1; o.receita[d] = v } return o }
  porItem.set('MLB1', s(100)); porItem.set('MLB2', s(80)); porItem.set('MLB3', s(5)); porItem.set('MLB4', s(4)); porItem.set('MLB5', s(3)); porItem.set('MLB6', s(2))
  const medidas = [
    ...Array.from({ length: 8 }, (_, i) => med({ data: addDias(ate, -40 - i), itens: ['MLB1'], estado: i < 6 ? 'melhorou' : 'sem_efeito', receita_alocada: 200 })),   // Otimizar: 8 medidas, funciona
    ...Array.from({ length: 10 }, (_, i) => med({ tipo: 'Cadastro de Produtos', data: addDias(ate, -10 - i), escopo: 'conta', itens: [], estado: 'variacao_conta' })),
  ]
  const r = F.montarFoco({ janela: 60, ate, hoje: ate, porItem, medidas, diasSerie: 100, risco: new Map([['MLB9', 'estoque para 2 dia(s)']]), estrategia: 'Crescimento' })
  assert.equal(r.periodo.de, addDias(ate, -59)); assert.equal(r.afirmar.marco_efetivo, 60)
  assert.equal(r.curva_produtos.n, 6); assert.equal(r.curva_produtos.n_corte, 2)
  const p1 = r.produtos.find(p => p.item_id === 'MLB1')
  assert.equal(p1.veredito.veredito, 'manter_e_escalar', '6 de 8: limite inferior de Wilson acima da base 0,3 + topo da curva'); assert.equal(p1.esforco.horas, 'NOT_COLLECTED')
  assert.equal(r.produtos.find(p => p.item_id === 'MLB9').veredito.veredito, 'manter', 'risco sem venda aparece e fica')
  const cad = r.familias.find(f => f.id === 'cadastro')
  assert.equal(cad.veredito.veredito, 'reduzir'); assert.equal(cad.sem_alvo_pct, 100); assert.match(cad.na_curva, /0\/8/)
  assert.equal(r.custo_oportunidade.melhor, 'otimizar'); assert.ok(cad.custo_oportunidade_reais > 0); assert.match(r.custo_oportunidade.premissa, /não é previsão/)
  assert.ok(r.grupos.reduzir.some(u => u.id === 'cadastro')); assert.ok(r.canais.find(c => c.id === 'duplicacao'))
  assert.match(r.leitura, /concentram a receita/)
  const sem = F.montarFoco({ janela: 30, ate, porItem, medidas: medidas.slice(8), diasSerie: 100 })
  assert.equal(sem.custo_oportunidade.melhor, null); assert.match(sem.custo_oportunidade.motivo, /não calculável/)
  assert.throws(() => F.montarFoco({ janela: 20, ate }), /janela fora da lista/)
})

const ev = (dia, campo, de, para, o = {}) => ({ dia, campo, de, para, pct: null, fonte: 'coleta', ...o })
await caso('atribuição: individual, sequencial (≥ 7 d), conjunto (< 7 d, crédito compartilhado), confundido (preço ≥ 3% ao lado da tarefa)', () => {
  const t = (data, tipo = 'Imagens') => ({ id: 'c' + data, titulo: 'card', tipo, data })
  const ind = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'fotos', 5, 8)], tarefas: [t('2026-09-11')] }))
  assert.equal(ind.length, 1); assert.equal(ind[0].caso, 'individual'); assert.equal(ind[0].marcos[0].fonte, 'coleta + card', 'card é testemunha da mudança observada'); assert.equal(ind[0].d1, '2026-09-12')
  const seq = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'titulo', 'a', 'b'), ev('2026-09-21', 'fotos', 3, 6)] }))
  assert.equal(seq[0].caso, 'sequencial'); assert.equal(seq[0].assinatura, 'otimizar → imagens'); assert.equal(seq[0].credito, 'por_etapa'); assert.equal(seq[0].autor_desconhecido, false, 'título e fotos são conteúdo: intervenção mesmo sem card')
  const seqInv = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'fotos', 3, 6), ev('2026-09-21', 'titulo', 'a', 'b')] }))
  assert.equal(seqInv[0].assinatura, 'imagens → otimizar'); assert.notEqual(seqInv[0].assinatura, seq[0].assinatura, 'a ordem importa no sequencial')
  const conj = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'titulo', 'a', 'b'), ev('2026-09-14', 'fotos', 3, 6)] }))
  assert.equal(conj[0].caso, 'conjunto'); assert.equal(conj[0].credito, 'compartilhado'); assert.equal(conj[0].peso_compartilhado, 0.5); assert.equal(conj[0].lag_extra, 2)
  assert.ok(conj[0].nao_separa[0].includes('2 dia(s)'))
  const conf = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'fotos', 5, 8), ev('2026-09-16', 'preco', 50, 47, { pct: -6 })], tarefas: [t('2026-09-12')] }))
  assert.equal(conf[0].caso, 'confundido'); assert.equal(conf[0].cofatores.length, 1); assert.match(conf[0].nao_separa.join(), /Preço: R\$ 50,00 → R\$ 47,00 em 16\/09/)
  const menor = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'fotos', 5, 8), ev('2026-09-16', 'preco', 50, 49.5, { pct: -1 })], tarefas: [t('2026-09-12')] }))
  assert.equal(menor[0].caso, 'individual', 'preço abaixo do limiar não confunde')
  // promoção criada pelo sistema (fonte promo) + preço da própria promoção = UMA intervenção; Ads no meio = co-fator
  const promo = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-19', 'promocao', 'nenhuma', 'PRICE_DISCOUNT −5%', { fonte: 'promo' }), ev('2026-09-19', 'preco', 78.9, 74.95, { pct: -5, fonte: 'promo' }), ev('2026-09-24', 'ads', 'paused', 'active')] }))
  assert.equal(promo[0].caso, 'confundido'); assert.equal(promo[0].intervencoes.length, 1); assert.equal(promo[0].intervencoes[0].fonte, 'sistema'); assert.match(promo[0].cofatores[0].texto, /^Ads:/)
  // dois episódios separados por mais de 14 dias
  assert.equal(A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-08-01', 'titulo', 'a', 'b'), ev('2026-09-01', 'fotos', 1, 2)] })).length, 2)
})

await caso('atribuição: texto honesto (associação, não causa), cliente sem piora e sem degrau; ranking por assinatura; card ↔ mudança só com candidato único', () => {
  const [ep] = A.episodiosDe(A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'titulo', 'a', 'b'), ev('2026-09-14', 'fotos', 3, 6)] }))
  const m = { estado: 'melhorou', efeito_pct: 35.5, janela_usada: 14, dias_pos: 14, metricas: { receita: { antes: 45, depois: 210 } }, n_placebos: 9, confianca: { score: 62 } }
  const tx = A.textoAtribuicao(ep, m)
  assert.match(tx[0], /^Faturamento \+366,7 % \(R\$ 630,00 → R\$ 2\.940,00\) nos 14 dias após 12\/09\.$/)
  assert.match(tx[2], /\+35,5 % \(confiança média, 9 janelas/); assert.ok(tx.includes('É associação no tempo, não prova de causa.')); assert.ok(tx.some(l => /^Não dá para separar/.test(l))); assert.ok(tx.some(l => /N1/.test(l)))
  const cli = A.textoAtribuicao(ep, { ...m, estado: 'piorou', efeito_pct: -20 }, { cliente: true })
  assert.ok(cli.some(l => /sem resultado medido até agora/.test(l))); assert.ok(!cli.some(l => /N[0-4]|−20/.test(l)))
  assert.deepEqual(codigosDe(auditarTexto(cli.join(' '))).filter(c => /causal|promessa/.test(c)), [])
  assert.equal(A.textoAtribuicao(ep, { estado: 'sem_base', motivo: 'só 2 unidades' })[0], 'Faturamento: — (só 2 unidades).')
  assert.equal(A.degrauDe({ estado: 'sem_controle' }).nivel, 'N0'); assert.equal(A.degrauDe(m).nivel, 'N1')
  const e = (assinatura, estado, receita_incremental, caso = 'individual') => ({ assinatura, caso, item_id: 'MLB1', d1: '2026-09-01', medida: { estado, receita_incremental, efeito_pct: 10 } })
  const rk = A.rankingCombinacoes([e('imagens → ads', 'melhorou', 500, 'sequencial'), e('ads → imagens', 'piorou', 200, 'sequencial'), e('ads → imagens', 'piorou', 100, 'sequencial'), e('imagens', 'melhorou', 50), e('precos', 'melhorou', 999, 'confundido')])
  assert.equal(rk.top[0].assinatura, 'imagens → ads'); assert.equal(rk.nao_renderam[0].assinatura, 'ads → imagens'); assert.equal(rk.nao_renderam[0].ganho_liquido, -300)
  assert.ok(![...rk.top, ...rk.nao_renderam].some(l => l.assinatura === 'precos'), 'confundido fora do ranking')
  const marcos = new Map([['MLB1', A.marcosDoAnuncio({ item_id: 'MLB1', eventos: [ev('2026-09-12', 'fotos', 5, 8)] })], ['MLB2', A.marcosDoAnuncio({ item_id: 'MLB2', eventos: [ev('2026-09-13', 'titulo', 'a', 'b')] })]])
  const ok = A.casarCardComMarco({ tipo: 'Imagens', data: '2026-09-10' }, marcos)
  assert.equal(ok.item_id, 'MLB1'); assert.equal(ok.origem, 'observado'); assert.match(ok.rotulo, /inferido.*12\/09/)
  const dois = A.casarCardComMarco({ tipo: 'Otimizar Anúncios', data: '2026-09-12' }, marcos)
  assert.equal(dois.item_id, null); assert.equal(dois.candidatos, 2)
  assert.equal(A.casarCardComMarco({ tipo: 'Imagens', data: '2026-09-01' }, marcos).item_id, null, 'fora de ± 3 dias')
  assert.equal(A.casarCardComMarco({ tipo: 'Reunião de Alinhamento', data: '2026-09-12' }, marcos).item_id, null, 'família sem campo visível')
})

await caso('motor no banco em memória: focoDoCliente mede o episódio do anúncio com controle; janela e prospect barrados na rota', async () => {
  const C = '__teste_foco__', HOJE = '2026-10-21', DE = '2026-06-01', ATE = '2026-10-20', MUD = '2026-09-15'
  const id = k => 'MLB3000000' + String(k).padStart(2, '0')
  const ins = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,0)')
  db.transaction(() => {
    for (let d = DE; d <= ATE; d = addDias(d, 1)) db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, coletado_em) VALUES (?,?,'x')").run(C, d)
    for (let k = 1; k <= 10; k++) {
      db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES (?,?,?,50)").run(C, id(k), 'Produto ' + k)
      let i = 0
      for (let d = DE; d <= ATE; d = addDias(d, 1), i++) {
        const base = k === 1 ? 6 : k <= 3 ? 4 : 2, alta = k === 1 && d > addDias(MUD, 3) ? 2 : 1
        const u = Math.max(0, Math.round(base * alta + ((i * 7 + k * 3) % 5) - 2))
        if (u) ins.run(C, id(k), d, u, u * 50)
      }
    }
    db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,'fotos','4','8',NULL,'coleta','x')").run(C, id(1), MUD)
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao) VALUES ('t-foto', 'teste', ?, ?, 'Mercado Livre', 'concluida', 'Imagens', ?)").run(C, `Novas fotos ${id(1)}`, addDias(MUD, -1))
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao) VALUES ('t-cad', 'teste', ?, 'Cadastro de kits novos', 'Mercado Livre', 'concluida', 'Cadastro de Produtos', ?)").run(C, '2026-10-05')
  })()
  const r = focoDoCliente(C, { janela: 60, hoje: HOJE })
  assert.equal(r.disponivel, true); assert.equal(r.periodo.ate, ATE); assert.equal(r.afirmar.marco_efetivo, 60)
  assert.equal(r.curva_produtos.n, 10); assert.equal(r.produtos[0].item_id, id(1)); assert.match(r.produto_por_tras, /produto = anúncio/)
  const anu = r.atribuicao.anuncios.find(a => a.item_id === id(1))
  assert.ok(anu, 'anúncio com mudança aparece na atribuição'); const ep = anu.episodios[0]
  assert.equal(ep.caso, 'individual'); assert.equal(ep.d1, MUD); assert.equal(ep.marcos[0].fonte, 'coleta + card')
  assert.equal(ep.medida.estado, 'melhorou', 'efeito plantado ×2 medido contra o controle: ' + JSON.stringify(ep.medida)); assert.ok(ep.medida.efeito_pct > 50); assert.equal(ep.evidencia.nivel, 'N1')
  assert.ok(ep.texto.includes('É associação no tempo, não prova de causa.'))
  assert.equal(r.atribuicao.cards_sem_anuncio.n, 1); assert.equal(r.atribuicao.cards_sem_anuncio.casados, 0)
  assert.equal(r.esforco_total.horas, 'NOT_COLLECTED')
  assert.equal(focoDoCliente('__sem_dados__', { janela: 30, hoje: HOJE }).disponivel, false)
  assert.throws(() => focoDoCliente(C, { janela: 7, hoje: HOJE }), /15, 30, 45, 60 ou 90/)
  // rota: stub de foco; nunca ecoa o valor recebido
  const app = express(); app.use(criarRotasFoco({ foco: (c, o) => ({ c, ...o }), clienteCanonico: c => c === 'Cli' ? 'Cli' : '' }))
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api/cliente/foco`
  try {
    const ok = await (await fetch(base + '?cliente=Cli&janela=45&item=MLB123456789')).json(); assert.deepEqual(ok, { c: 'Cli', janela: 45, item: 'MLB123456789' })
    assert.equal((await (await fetch(base + '?cliente=Cli')).json()).janela, 30, 'janela padrão 30')
    const p = await fetch(base + '?cliente=' + encodeURIComponent('[Comercial] Loja X')); assert.equal(p.status, 404); assert.ok(!(await p.text()).includes('Loja X'))
    const j = await fetch(base + '?cliente=Cli&janela=999'); assert.equal(j.status, 400); assert.ok(!(await j.text()).includes('999'))
    assert.equal((await fetch(base + '?cliente=Cli&item=<script>')).status, 400)
  } finally { srv.close() }
})

console.log(`\n${n} casos OK`)
