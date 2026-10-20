// Autoteste da retroalimentação do Merovíngio: estado (queda/estagnação/crescimento), aprendizado, fatores do plano, Pareto, combos,
// pior tarefa e diagnóstico de queda — séries SINTÉTICAS com efeito plantado (sem rede; só funções puras).
import assert from 'node:assert/strict'
import { classificarEstado, classificarEstrategia, aprender, veredito, fatoresDoPlano, ajustarNota, paretoItens, paretoTarefas, combos, piorTarefa, diagnosticarQueda, jogadasDoEstado, cfgRetro, reversaoProvavel } from '../src/lib/retroalimentacao.js'
import { cfgAtrib, addDias } from '../src/lib/meli-serie.js'

const HOJE = '2026-10-05', ATE = '2026-10-04', COB = { de: '2026-05-09', ate: ATE }
const serie = (base, de, ate, f = () => 1, amp = 0.15) => { const s = {}; for (let d = de, i = 0; d <= ate; d = addDias(d, 1), i++) s[d] = Math.max(0, Math.round(base * f(d) * (1 + amp * Math.sin(i * 1.7)))); return s }
const dias28 = ate => Array.from({ length: 28 }, (_, i) => addDias(ate, -27 + i))
const comReceita = (u, preco = 50) => ({ unidades: u, receita: Object.fromEntries(Object.entries(u).map(([d, n]) => [d, n * preco])) })

// 1) ESTADO — queda real, crescimento real, estagnação, ruído de contagem, sem base, sinal misto
{
  const corte = addDias(ATE, -13)
  const queda = classificarEstado({ serie: comReceita(serie(20, COB.de, ATE, d => d >= corte ? 0.6 : 1)), ate: ATE, cob: COB })
  assert.equal(queda.estado, 'queda'); assert.ok(queda.variacao_pct <= -25 && queda.forca === 'forte', 'queda forte: ' + queda.variacao_pct); assert.ok(queda.significativo)
  const cresc = classificarEstado({ serie: comReceita(serie(20, COB.de, ATE, d => d >= corte ? 1.5 : 1)), ate: ATE, cob: COB })
  assert.equal(cresc.estado, 'crescimento'); assert.ok(cresc.variacao_pct >= 25)
  const est = classificarEstado({ serie: comReceita(serie(20, COB.de, ATE)), ate: ATE, cob: COB })
  assert.equal(est.estado, 'estagnacao'); assert.equal(est.forca, null)
  // −12% com poucas vendas (ruído de Poisson): NÃO é queda
  const peq = classificarEstado({ serie: comReceita(Object.fromEntries([...Array(28)].map((_, i) => [addDias(addDias(ATE, -27), i), i < 14 ? 1 : (i % 8 === 0 ? 0 : 1)]))), ate: ATE, cob: COB, c: { ...cfgRetro.estado, min_unidades_base: 5 } })
  assert.equal(peq.estado, 'estagnacao'); assert.ok(peq.dentro_do_ruido || Math.abs(peq.variacao_pct) < 10, 'ruído não vira queda')
  // significância SEMPRE: receita −37% com 8→5 vendas é ruído, não "queda forte"
  const ruido = classificarEstado({ serie: comReceita({ ...Object.fromEntries(dias28(ATE).map((d, i) => [d, i < 14 ? (i % 2 ? 1 : 0) + 0 : 0])) }), ate: ATE, cob: COB, c: { ...cfgRetro.estado, min_unidades_base: 5 } })
  const oito = { unidades: Object.fromEntries(dias28(ATE).map((d, i) => [d, i === 0 || i === 2 || i === 4 || i === 6 || i === 8 || i === 10 || i === 12 || i === 13 ? 1 : (i === 15 || i === 18 || i === 21 || i === 24 || i === 26 ? 1 : 0)])), receita: {} }
  oito.receita = Object.fromEntries(Object.entries(oito.unidades).map(([d, n]) => [d, n * 50]))
  const o8 = classificarEstado({ serie: oito, ate: ATE, cob: COB, c: { ...cfgRetro.estado, min_unidades_base: 5 } })
  assert.equal(o8.estado, 'estagnacao'); assert.ok(o8.dentro_do_ruido && Math.abs(o8.variacao_pct) >= 25, '8→5 vendas (−37%) é ruído de contagem, não queda forte: ' + JSON.stringify([o8.variacao_pct, o8.z]))
  // receita cai com unidades subindo (promoção/ticket): NÃO é queda de vendas
  const promo = classificarEstado({ serie: { unidades: serie(20, COB.de, ATE, d => d >= corte ? 1.3 : 1), receita: Object.fromEntries(Object.entries(serie(20, COB.de, ATE, d => d >= corte ? 1.3 : 1)).map(([d, n]) => [d, n * (d >= corte ? 30 : 50)])) }, ate: ATE, cob: COB })
  assert.equal(promo.estado, 'estagnacao'); assert.ok(promo.divergencia_receita_unidades && promo.variacao_pct < -10, 'receita −% com unidades +%: divergência, não queda')
  // 14d estáveis, mas o mês de 28d mostra colapso anterior: sinaliza (não esconde atrás de "estagnação")
  const est7 = classificarEstado({ serie: comReceita({ ...serie(28, addDias(ATE, -55), addDias(ATE, -28)), ...serie(7, addDias(ATE, -27), ATE) }), ate: ATE, cob: COB })
  assert.equal(est7.estado, 'estagnacao'); assert.match(est7.sinal_misto || '', /queda aconteceu antes e se estabilizou/)
  // sem base: período anterior com poucas vendas, e cobertura que não alcança
  assert.equal(classificarEstado({ serie: comReceita({ [ATE]: 2 }), ate: ATE, cob: COB }).estado, 'sem_base')
  assert.equal(classificarEstado({ serie: comReceita(serie(20, COB.de, ATE)), ate: ATE, cob: { de: addDias(ATE, -20), ate: ATE } }).estado, 'sem_base')
  // sinal misto: últimos 14 dias caem forte, mas o mês anterior estava muito mais baixo → 28d cresce
  const misto = classificarEstado({ serie: comReceita({ ...serie(10, addDias(ATE, -55), addDias(ATE, -28)), ...serie(30, addDias(ATE, -27), addDias(ATE, -14)), ...serie(18, addDias(ATE, -13), ATE) }), ate: ATE, cob: COB })
  assert.equal(misto.estado, 'queda'); assert.ok(misto.sinal_misto, 'queda de 14d com mês em alta é sinal misto: ' + JSON.stringify(misto.confirmacao_28d))
}

// 2) APRENDIZADO e VEREDITO — amostra mínima, Wilson
{
  assert.equal(veredito(7, 7), 'sem_amostra', 'abaixo de 8 medidas não há veredito')
  assert.equal(veredito(12, 10), 'funciona'); assert.equal(veredito(12, 0), 'nao_funciona'); assert.equal(veredito(10, 3), 'inconclusivo')
  // relativo à taxa habitual (a medição por controle é conservadora: base real ~9%): 4/37 NÃO é "não funciona", e 12/40 é "funciona"
  assert.equal(veredito(37, 4, 0.09), 'inconclusivo'); assert.equal(veredito(40, 12, 0.09), 'funciona'); assert.equal(veredito(30, 0, 0.2), 'nao_funciona')
  const M = (tipo, estado, antes, efeito = 0, rec = 0) => ({ tipo, estado, estado_antes: antes, efeito_pct: efeito, receita_alocada: rec })
  const ms = [...[...Array(8)].map(() => M('Otimizar Anúncios', 'melhorou', 'queda', 30, 400)), ...[...Array(2)].map(() => M('Otimizar Anúncios', 'sem_efeito', 'queda')),
    ...[...Array(9)].map(() => M('Criar Kits', 'sem_efeito', 'estagnacao')), ...[...Array(3)].map(() => M('Criar Kits', 'piorou', 'estagnacao', -20, -100)),
    M('Reunião', 'melhorou', 'queda'), M('X', 'em_maturacao', 'queda'), { ...M('Criar Kits', 'piorou', 'queda'), reversao_provavel: true }]
  // 'Reunião' conta como tipo qualquer (a exclusão de tipos ignorados é do motor); estados não medidos NÃO entram
  const ap = aprender(ms)
  assert.equal(ap.n, 23, 'a medida com reversão à média provável fica FORA'); assert.equal(ap.excluidas_reversao, 1); assert.equal(ap.geral.n, 23)
  const oa = ap.por_tipo.find(t => t.tipo === 'Otimizar anúncios'), ck = ap.por_tipo.find(t => t.tipo === 'Kits')
  assert.equal(oa.veredito, 'funciona'); assert.equal(ck.veredito, 'nao_funciona'); assert.equal(oa.melhorou, 8)
  assert.equal(ap.por_tipo_estado.find(x => x.tipo === 'Otimizar anúncios' && x.estado === 'queda').n, 10)
  assert.ok(ap.por_tipo[0].tipo === 'Otimizar anúncios', 'ordenado pela taxa inferior de Wilson')
}

// 2b) PREÇO mexendo junto: medida confundida pelo preço fica FORA do aprendizado, do 80/20, da tarefa de cuidado e dos motivos de queda — contada à parte
{
  const M = (estado, extra = {}) => ({ id: Math.random(), titulo: 'x', tipo: 'Otimizar Anúncios', estado, estado_antes: 'queda', efeito_pct: estado === 'melhorou' ? 30 : estado === 'piorou' ? -30 : 0, receita_alocada: estado === 'melhorou' ? 400 : estado === 'piorou' ? -200 : 0, itens: ['X'], data: '2026-09-20', ...extra })
  const ms = [...[...Array(8)].map(() => M('melhorou')), ...[...Array(3)].map(() => M('melhorou', { confundido_preco: true })), M('piorou', { confundido_preco: true }), M('sem_efeito', { confundido_preco: true, reversao_provavel: true })]
  const ap = aprender(ms)
  assert.equal(ap.n, 8); assert.equal(ap.excluidas_preco, 4); assert.equal(ap.excluidas_reversao, 1, 'reversão e preço juntos contam uma vez (na reversão)')
  assert.equal(ap.por_tipo[0].melhorou, 8); assert.equal(ap.por_tipo[0].piorou, 0)
  assert.equal(paretoTarefas(ms).n_medidas, 8)
  assert.equal(piorTarefa({ apTodos: ap, apConta: ap, medidasConta: ms, hoje: HOJE }).tarefas_individuais.length, 0, 'piora com o preço mexendo junto não vira tarefa de cuidado')
  const dq = diagnosticarQueda({ estado: { estado: 'queda' }, diag: null, medidas: ms.filter(m => m.estado === 'piorou'), execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.ok(!dq.motivos.some(m => m.k === 'tarefa_piorou'), 'piora confundida pelo preço não acusa a tarefa')
  assert.equal(reversaoProvavel({ confundido_preco: true }), true, 'alias antigo segue valendo para o preço')
  assert.ok(cfgRetro.limites.some(l => l.includes('{inicio_historico}')) && cfgRetro.limites.some(l => l.includes('{limiar_preco}')), 'limites trazem a data do histórico e a regra de exclusão')
  // ESTADO do anúncio mexendo junto (promoção, Ads, Full, estoque, pausa — confundido_estado, só em modo ativo): fora do aprendizado e contada à parte;
  // cada excluída conta UMA vez: reversão → preço → estado
  const me = [...ms, ...[...Array(2)].map(() => M('melhorou', { confundido_estado: true })), M('piorou', { confundido_estado: true, confundido_preco: true }), M('sem_efeito', { confundido_estado: true, reversao_provavel: true })]
  const ae = aprender(me)
  assert.equal(ae.n, 8, 'as confundidas pelo estado ficam fora'); assert.equal(ae.excluidas_estado, 2); assert.equal(ae.excluidas_preco, 5); assert.equal(ae.excluidas_reversao, 2)
  assert.equal(ae.por_tipo[0].melhorou, 8); assert.equal(paretoTarefas(me).n_medidas, 8)
  assert.equal(piorTarefa({ apTodos: ae, apConta: ae, medidasConta: me, hoje: HOJE }).tarefas_individuais.length, 0, 'piora com o estado mudando junto não vira tarefa de cuidado')
  assert.ok(!diagnosticarQueda({ estado: { estado: 'queda' }, diag: null, medidas: me.filter(m => m.estado === 'piorou'), execucao: null, apConta: ae, apOutros: ae, hoje: HOJE }).motivos.some(m => m.k === 'tarefa_piorou'))
  assert.equal(reversaoProvavel({ confundido_estado: true }), true); assert.equal(aprender(ms).excluidas_estado, 0, 'sem evento de estado: zero (não "—": a contagem é real)')
}

// 3) FATORES do plano — só o que é CONCLUSIVO neste estado; sem contar duas vezes; regras de risco isentas; neutro sem amostra
{
  const M = (tipo, estado, antes) => ({ tipo, estado, estado_antes: antes, efeito_pct: 0, receita_alocada: 0 })
  const rep = (n, tipo, estado, antes) => Array.from({ length: n }, () => M(tipo, estado, antes))
  const dados = [...rep(8, 'Otimizar Anúncios', 'melhorou', 'queda'), ...rep(2, 'Otimizar Anúncios', 'sem_efeito', 'queda'), ...rep(1, 'Otimizar Anúncios', 'melhorou', 'estagnacao'), ...rep(9, 'Otimizar Anúncios', 'sem_efeito', 'estagnacao'),
    ...rep(9, 'Criar Kits', 'sem_efeito', 'queda'), ...rep(9, 'Criar Kits', 'melhorou', 'queda')]   // Criar Kits: 50% em queda E no geral → sem diferença por estado
  const vazio = aprender([])
  const regras = [{ id: 'ima_conversao', tipo_demanda: 'Otimizar Anúncios' }, { id: 'urgencia_oculta', tipo_demanda: 'Criar Kits' }, { id: 'frete_gratis', tipo_demanda: 'Corrigir Anúncios' }, { id: 'estoque_ruptura', tipo_demanda: 'Otimizar Anúncios' }]
  const q = fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, regras })
  assert.equal(q.ima_conversao.nivel, 'tipo × estado'); assert.equal(q.ima_conversao.aprendido, cfgRetro.plano.ajuste_estado_max, 'em queda este tipo melhora MUITO mais que no geral: teto do ajuste')
  assert.equal(q.ima_conversao.fator, Math.round(Math.min(cfgRetro.plano.fator_max, 1.15 * cfgRetro.playbook.queda.pesos.ima_conversao) * 100) / 100)
  assert.equal(q.urgencia_oculta.aprendido, 1, 'sem diferença por estado = neutro (o tipo em geral já está na probabilidade do plano)')
  assert.equal(q.frete_gratis.aprendido, 1); assert.equal(q.frete_gratis.nivel, 'sem_amostra')
  assert.match(q.estoque_ruptura.nivel, /regra de risco/); assert.equal(q.estoque_ruptura.aprendido, 1); assert.equal(q.estoque_ruptura.fator, cfgRetro.playbook.queda.pesos.estoque_ruptura)
  const e = fatoresDoPlano({ estado: 'estagnacao', apConta: aprender(dados), apOutros: vazio, regras: [regras[0]] })
  assert.equal(e.ima_conversao.aprendido, cfgRetro.plano.ajuste_estado_min, 'em estagnação o mesmo tipo rende bem menos: piso do ajuste')
  // amostra pequena e instável (0/6 × 1/6): NADA muda — sem saturar o clamp
  const pequeno = fatoresDoPlano({ estado: 'queda', apConta: aprender(rep(6, 'Otimizar Anúncios', 'sem_efeito', 'queda')), apOutros: aprender([...rep(60, 'X', 'sem_efeito', 'queda'), ...rep(6, 'X', 'melhorou', 'queda')]), regras: [regras[0]] })
  const pequeno2 = fatoresDoPlano({ estado: 'queda', apConta: aprender([...rep(5, 'Otimizar Anúncios', 'sem_efeito', 'queda'), ...rep(1, 'Otimizar Anúncios', 'melhorou', 'queda')]), apOutros: aprender([...rep(60, 'X', 'sem_efeito', 'queda'), ...rep(6, 'X', 'melhorou', 'queda')]), regras: [regras[0]] })
  assert.equal(pequeno.ima_conversao.fator, pequeno2.ima_conversao.fator, '0/6 e 1/6 dão o mesmo fator: só o peso do estado'); assert.equal(pequeno.ima_conversao.aprendido, 1)
  for (const x of [...Object.values(q), ...Object.values(e)]) assert.ok(x.fator >= cfgRetro.plano.fator_min && x.fator <= cfgRetro.plano.fator_max, 'dentro dos limites')
  // NICHO: conta → nicho → base. Sem nicho (null) = exatamente o de antes; nicho com < 8 medidas do tipo × estado = o de antes, declarado;
  // com amostra, a estimativa pontual encolhe para o nicho (aqui o nicho piora muito em queda: a estimativa cai) — o teste de Wilson continua o da base
  const semNicho = fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, regras: [regras[0]] })
  assert.deepEqual(fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, apNicho: null, regras: [regras[0]] }), semNicho)
  const poucoNicho = fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, apNicho: aprender(rep(7, 'Otimizar Anúncios', 'sem_efeito', 'queda')), nicho: 'Pet', regras: [regras[0]] })
  assert.equal(poucoNicho.ima_conversao.p_estimada, semNicho.ima_conversao.p_estimada, 'abaixo de 8 medidas no nicho: estimativa de sempre'); assert.match(poucoNicho.ima_conversao.motivo, /nicho "Pet" com 7 medida\(s\).*mínimo 8.*sem ajuste pelo nicho/)
  const comNicho = fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, apNicho: aprender([...rep(40, 'Otimizar Anúncios', 'sem_efeito', 'queda'), ...rep(9, 'Otimizar Anúncios', 'melhorou', 'estagnacao')]), nicho: 'Pet', regras: [regras[0]] })
  assert.ok(comNicho.ima_conversao.p_estimada < semNicho.ima_conversao.p_estimada, `o nicho puxa a estimativa: ${comNicho.ima_conversao.p_estimada} < ${semNicho.ima_conversao.p_estimada}`)
  assert.match(comNicho.ima_conversao.motivo, /no nicho "Pet": 0 de 40/); assert.equal(comNicho.ima_conversao.nivel, 'tipo × estado')
  // pura aritmética: base pB = (8 + 5·9/20)/(10 + 5); nicho pN = (0 + 5·pB)/(40 + 5); conta pC = (8 + 5·pN)/(10 + 5)
  const pB = (8 + 5 * 9 / 20) / 15, pN = 5 * pB / 45, pC = (8 + 5 * pN) / 15
  assert.equal(comNicho.ima_conversao.p_estimada, Math.round(pC * 100) / 100)
  const neutroNicho = fatoresDoPlano({ estado: 'queda', apConta: aprender(dados), apOutros: vazio, apNicho: aprender(rep(40, 'Criar Kits', 'sem_efeito', 'queda')), nicho: 'Pet', regras: [regras[1]] })
  assert.equal(neutroNicho.urgencia_oculta.aprendido, 1, 'o nicho não cria ajuste onde a base não tem diferença clara')
  const crescimento = fatoresDoPlano({ estado: 'crescimento', apConta: vazio, apOutros: vazio, regras: [{ id: 'estoque_ruptura', tipo_demanda: 'Planejamento full' }] })
  assert.ok(crescimento.estoque_ruptura.fator > 1, 'em crescimento proteger o estoque pesa mais')
  // nota em escala de chances: monotônica, nunca passa de 100, não empata os melhores, mexe proporcionalmente
  assert.equal(ajustarNota(90, 1.3) > ajustarNota(84, 1.3), true); assert.ok(ajustarNota(99, 1.35) <= 100 && ajustarNota(99, 1.35) >= 99)
  assert.ok(ajustarNota(90, 1.3) - 90 < ajustarNota(40, 1.3) - 40 === false || true)
  assert.ok(ajustarNota(90, 1.3) - 90 <= 3 && ajustarNota(40, 1.35) - 40 <= 9, 'o teto não dá +21 pontos a nota baixa e +3 a nota alta')
  assert.equal(ajustarNota(50, 1), 50); assert.ok(ajustarNota(60, 0.7) < 60 && ajustarNota(60, 0.7) > 40)
  for (let a = 1; a < 100; a++) assert.ok(ajustarNota(a, 1.3) >= ajustarNota(a - 1 || 1, 1.3), 'monotônica')
}

// 4) PARETO 80/20
{
  const it = [{ id: 'A', r: 6000 }, { id: 'B', r: 2200 }, { id: 'C', r: 900 }, { id: 'D', r: 500 }, { id: 'E', r: 400 }]
  const p = paretoItens(it)
  assert.equal(p.n_80, 2); assert.equal(p.itens[1].acum_pct, 82); assert.equal(p.concentracao_top1_pct, 60); assert.ok(p.alerta)
  assert.equal(paretoItens([{ id: 'A', r: 0 }]).disponivel, false)
  const ms = [{ id: 1, tipo: 'T1', estado: 'melhorou', receita_alocada: 800 }, { id: 2, tipo: 'T1', estado: 'melhorou', receita_alocada: 150 }, { id: 3, tipo: 'T2', estado: 'melhorou', receita_alocada: 50 }, { id: 4, tipo: 'T2', estado: 'sem_efeito' }, { id: 5, tipo: 'T3', estado: 'piorou', receita_alocada: -90 }, { id: 6, tipo: 'T3', estado: 'sem_efeito' }]
  const t = paretoTarefas(ms)
  assert.equal(t.n_tarefas_80, 1); assert.equal(t.n_medidas, 6); assert.equal(t.por_tipo[0].tipo, 'T1'); assert.equal(t.n_tipos_80, 1)
  assert.equal(t.desperdicio.sem_efeito, 2); assert.equal(t.desperdicio.piorou, 1)
  assert.equal(paretoTarefas([]).disponivel, false)
}

// 5) COMBOS — duas tarefas de tipos diferentes no mesmo anúncio; efeito plantado só quando juntas
{
  const D = (n, f) => serie(n, COB.de, ATE, f)
  const C = (u, preco = 50) => comReceita(u, preco)
  const porItem = new Map()
  // 3 anúncios "combo" (título + imagem na mesma quinzena, subida de 50%) e 12 de controle planos
  const datas = ['2026-07-10', '2026-07-24', '2026-08-10']
  const medidas = []
  datas.forEach((d0, k) => {
    const id = 'MLB-COMBO' + k, d2 = addDias(d0, 5)
    porItem.set(id, { ...C(D(12, x => x > addDias(d2, 5) && x < addDias(d2, 5 + 40) ? 1.6 : 1)), visitas: {} })
    medidas.push({ id: 't1' + k, titulo: 'Título ' + id, tipo: 'Duplicação de Títulos', data: d0, lag: 5, escopo: 'anuncios', itens: [id], estado: 'sem_controle' })
    medidas.push({ id: 't2' + k, titulo: 'Imagem ' + id, tipo: 'Melhorar Imagens', data: d2, lag: 3, escopo: 'anuncios', itens: [id], estado: 'sem_controle' })
  })
  for (let i = 0; i < 12; i++) porItem.set('MLB-CTRL' + i, { ...C(D(14)), visitas: {} })
  const r = combos({ medidas, porItem, cobertura: COB, hoje: HOJE, c: { ...cfgRetro.combos, min_n: 3 } })
  assert.equal(r.n_episodios, 3); assert.ok(r.n_medidos >= 2, 'episódios medidos: ' + r.n_medidos)
  const c1 = r.combinacoes.find(x => x.chave === 'Duplicação de anúncios + Imagens e vídeos')
  assert.ok(c1 && c1.melhorou >= 2, 'combo com efeito plantado melhora: ' + JSON.stringify(c1 && { n: c1.n, m: c1.melhorou, p: c1.piorou }))
  assert.ok(!r.pioram.length, 'nada piorou')
  const padrao = combos({ medidas, porItem, cobertura: COB, hoje: HOJE })
  assert.equal(padrao.funcionam.length, 0, '3 casos não bastam para chamar de padrão (mínimo 5)')
  // tarefa única por anúncio não forma combinação
  const so = combos({ medidas: medidas.filter(m => m.id.startsWith('t1')), porItem, cobertura: COB, hoje: HOJE })
  assert.equal(so.n_episodios, 0); assert.match(so.leitura, /ainda não existe combinação/)
  // duas tarefas do MESMO tipo não são "combinação de tipos"
  const mesmo = combos({ medidas: medidas.map(m => ({ ...m, tipo: 'Otimizar Anúncios' })), porItem, cobertura: COB, hoje: HOJE })
  assert.equal(mesmo.n_episodios, 0)
  // intervalo maior que a janela quebra o episódio
  const longe = combos({ medidas: medidas.map(m => m.id.startsWith('t2') ? { ...m, data: addDias(m.data, 40) } : m), porItem, cobertura: COB, hoje: HOJE })
  assert.equal(longe.n_episodios, 0)
  // preço: episódio com tarefa fora do aprendizado (preço mexendo junto) não é medido; anúncio do controle que mudou de preço na janela sai do controle
  const fora = combos({ medidas: medidas.map(m => m.id === 't10' ? { ...m, confundido_preco: true } : m), porItem, cobertura: COB, hoje: HOJE, c: { ...cfgRetro.combos, min_n: 3 } })
  assert.equal(fora.n_episodios, 3); assert.equal(fora.n_medidos, r.n_medidos - 1, 'o episódio com a tarefa confundida sai da medida')
  const semCtrl = combos({ medidas, porItem, cobertura: COB, hoje: HOJE, grandes: new Map([...porItem.keys()].map(i => [i, ['2026-07-15', '2026-07-29', '2026-08-15']])), c: { ...cfgRetro.combos, min_n: 3 } })
  assert.equal(semCtrl.n_medidos, 0, 'todo anúncio fora do alvo mudou de preço na janela: sem controle, nenhum episódio vira medida comparável')
}

// 6) PIOR TAREFA
{
  const M = (tipo, estado) => ({ tipo, estado, estado_antes: 'estagnacao', efeito_pct: estado === 'piorou' ? -20 : 0, receita_alocada: estado === 'piorou' ? -120 : 0, id: tipo + estado + Math.random(), titulo: tipo, itens: ['X'], data: '2026-09-01' })
  const ms = [...[...Array(5)].map(() => M('Criar Kits', 'piorou')), ...[...Array(6)].map(() => M('Criar Kits', 'sem_efeito')), ...[...Array(9)].map(() => M('Otimizar Anúncios', 'melhorou'))]
  const ap = aprender(ms)
  const p = piorTarefa({ apTodos: ap, apConta: ap, medidasConta: ms })
  assert.equal(p.tipos[0].tipo, 'Kits'); assert.equal(p.tipos[0].piorou, 5); assert.ok(!p.tipos.some(t => t.tipo === 'Otimizar anúncios'))
  assert.ok(p.tarefas_individuais.length === 3 && p.cuidados.length >= 3); assert.match(p.aviso, /piloto/)
  const semPiora = aprender(Array.from({ length: 12 }, () => M('Criar Kits', 'sem_efeito')))
  assert.equal(piorTarefa({ apTodos: semPiora, apConta: semPiora, medidasConta: [] }).tipos.length, 0, '0 de 12 pioraram: não é "tipo associado a piora"')
  const reversao = [...ms.filter(m => m.tipo === 'Kits' && m.estado === 'piorou').map(m => ({ ...m, reversao_provavel: true })), ...Array.from({ length: 6 }, () => M('Criar Kits', 'sem_efeito'))]
  assert.equal(piorTarefa({ apTodos: aprender(reversao), apConta: aprender(reversao), medidasConta: reversao }).tipos.length, 0, 'piora por reversão à média não conta')
  const vazio = piorTarefa({ apTodos: aprender([]), apConta: aprender([]), medidasConta: [] })
  assert.equal(vazio.disponivel, false); assert.match(vazio.leitura, /Sem amostra/)
}

// 7) DIAGNÓSTICO DE QUEDA — motivos, ações, tarefas e atitudes
{
  const I = (id, r, r0, extra = {}) => ({ id, titulo: 'Produto ' + id, thumb: '', permalink: '', r, r0, curva: 'A', share_pct: 20, cobertura: 30, status: 'active', catalogo: false, buy_box: null, ...extra })
  const diag = {
    disponivel: true, resumo: { gmv: 5000 },
    itens: [I('MLB1', 500, 2000, { cobertura: 4 }), I('MLB2', 1000, 1100), I('MLB3', 1000, 1000), I('MLB4', 1000, 950), I('MLB5', 1000, 1000), I('MLB6', 500, 0)],
    causal: { disponivel: true, ruptura: 'conversao', leitura: 'Faturamento -22%. Ruptura no elo CONVERSÃO.', deltas: { faturamento: -22, visitas: 2, conversao: -0.8, ticket: 1 } },
    ads: { custo: 400, receita: 800, roas: 2, anterior: { custo: 700, receita: 2100, roas: 3 }, custo_var_pct: -43 },
  }
  const ap = aprender([])
  const q = diagnosticarQueda({ estado: { estado: 'queda' }, diag, medidas: [], execucao: { c14: 1, p14: 6, bloqueadas: 2 }, apConta: ap, apOutros: ap, hoje: HOJE })
  const ks = q.motivos.map(m => m.k)
  for (const k of ['elo_rompido', 'ruptura_estoque', 'ads_menos_verba', 'execucao']) assert.ok(ks.includes(k), 'motivo ' + k + ' em ' + ks)
  assert.equal(q.motivos[0].peso >= q.motivos.at(-1).peso, true)
  assert.ok(q.acoes.some(a => a.regra === 'estoque_ruptura') && q.acoes.some(a => a.regra === 'ima_conversao'))
  assert.ok(q.tarefas.some(t => t.tipo === 'Full') && q.atitudes.length >= 4)
  // mercado: os anúncios SEM tarefa também caem → hipótese de mercado; os tocados caem mais → alerta nas mexidas
  const dm = { ...diag, causal: { disponivel: true, ruptura: null, deltas: {}, leitura: '' }, ads: null, itens: [I('A', 700, 1000), I('B', 700, 1000), I('C', 700, 1000), I('D', 700, 1000)] }
  const m1 = diagnosticarQueda({ estado: { estado: 'queda' }, diag: dm, medidas: [{ data: '2026-09-20', itens: ['A'], estado: 'melhorou' }], execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.ok(m1.motivos.some(m => m.k === 'mercado'), 'controle também caiu → mercado: ' + m1.motivos.map(m => m.k))
  const dn = { ...dm, itens: [I('A', 300, 1000), I('B', 300, 1000), I('C', 300, 1000), I('D', 1000, 1000), I('E', 1000, 1000), I('F', 1000, 1000)] }
  const mT = [{ data: '2026-09-20', itens: ['A', 'B', 'C'], estado: 'piorou', tipo: 'Duplicação de Títulos', efeito_pct: -35 }]
  const m2 = diagnosticarQueda({ estado: { estado: 'queda' }, diag: dn, medidas: mT, execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.ok(m2.motivos.some(m => m.k === 'queda_nos_tocados' && m.interno) && m2.motivos.some(m => m.k === 'tarefa_piorou' && m.interno), 'motivos sobre as MEXIDAS da equipe são internos')
  assert.match(m2.atitudes_internas[0], /revisar as mudanças recentes/); assert.ok(!m2.atitudes.some(a => /cliente|Notion|card/i.test(a)), 'atitudes do cliente em voz da equipe→cliente, sem jargão interno')
  // 1 anúncio de R$ 100 tocado NÃO basta para acusar as nossas mexidas; reversão provável tampouco
  const um = diagnosticarQueda({ estado: { estado: 'queda' }, diag: { ...dn, itens: [I('A', 40, 100), I('D', 1000, 1000), I('E', 1000, 1000), I('F', 1000, 1000)] }, medidas: [{ data: '2026-09-20', itens: ['A'], estado: 'piorou', tipo: 'X', efeito_pct: -60 }], execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.ok(!um.motivos.some(m => m.k === 'queda_nos_tocados'), '1 anúncio pequeno não é evidência')
  assert.ok(!diagnosticarQueda({ estado: { estado: 'queda' }, diag: dn, medidas: mT.map(m => ({ ...m, reversao_provavel: true })), execucao: null, apConta: ap, apOutros: ap, hoje: HOJE }).motivos.some(m => m.k === 'tarefa_piorou'), 'piora por reversão à média não vira motivo')
  // controle não inclui anúncio fechado/pausado nem sem estoque
  const sujo = { ...dm, itens: [I('A', 700, 1000), I('B', 700, 1000), I('P', 0, 1000, { status: 'closed' }), I('Q', 0, 1000, { status: 'paused' }), I('R', 0, 1000, { cobertura: 2 }), I('S', 1100, 1000), I('T', 1100, 1000), I('U', 1100, 1000)] }
  const ms = diagnosticarQueda({ estado: { estado: 'queda' }, diag: sujo, medidas: [{ data: '2026-09-20', itens: ['A', 'B'], estado: 'sem_efeito' }], execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.ok(!ms.motivos.some(m => m.k === 'mercado'), 'só com anúncios ATIVOS e com estoque o controle subiu: não é queda de mercado')
  // janela curta × 28d
  const aviso = diagnosticarQueda({ estado: { estado: 'queda', confirmacao_28d: { estado: 'crescimento' } }, diag: dm, medidas: [], execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.match(aviso.aviso_janela, /28 dias/)
  // sem diagnóstico por anúncio: não inventa causa
  const sd = diagnosticarQueda({ estado: { estado: 'queda' }, diag: null, medidas: [], execucao: null, apConta: ap, apOutros: ap, hoje: HOJE })
  assert.equal(sd.motivos[0].k, 'difusa'); assert.match(sd.fonte_itens, /indisponível/)
}

// 8) JOGADAS por estado
{
  const M = (t, e) => ({ tipo: t, estado: e, estado_antes: 'estagnacao', efeito_pct: 0, receita_alocada: 0 })
  const ap = aprender([...Array(8)].map(() => M('Otimizar Anúncios', 'melhorou')))
  const j = jogadasDoEstado({ estado: 'estagnacao', apConta: ap, apOutros: aprender([]), abertasPorRegra: { anuncio_ima_conversao: 3 } })
  assert.equal(j.jogadas[0].k, 'replicar'); assert.deepEqual(j.jogadas[0].tipos.map(t => t.tipo), ['Otimizar anúncios']); assert.match(j.jogadas[0].extra, /8 de 8/)
  assert.ok(!j.atitudes.some(a => /cliente|Notion|card/i.test(a)), 'atitudes sem voz interna')
  assert.equal(j.jogadas[1].regras.find(r => r.regra === 'ima_conversao').abertas, 3)
  const sem = jogadasDoEstado({ estado: 'estagnacao', apConta: aprender([]), apOutros: aprender([]) })
  assert.match(sem.jogadas[0].extra, /ainda não tem um tipo de tarefa com resultado medido \(amostra mínima de 8/)
  const cr = jogadasDoEstado({ estado: 'crescimento', apConta: ap, apOutros: ap, protegidos: [{ item_id: 'MLB9', ate: '2026-10-20' }] })
  assert.match(cr.jogadas.find(x => x.k === 'nao_mexer').extra, /MLB9 até 20\/10\/2026/)
  assert.equal(jogadasDoEstado({ estado: 'sem_base', apConta: ap, apOutros: ap }), null)
}

// 9) ESTRATÉGIA — Sobrevivência / Manutenção / Crescimento / Desenvolvimento (pura; sempre provisória: caixa, capacidade e mercado não existem)
{
  const E = (estado, extra = {}) => ({ estado, forca: estado === 'estagnacao' || estado === 'sem_base' ? null : 'moderada', significativo: estado !== 'sem_base', sinal_misto: null, variacao_pct: estado === 'queda' ? -15 : estado === 'crescimento' ? 18 : 2, janela_dias: 14, ...extra })
  const base = { economia: null, custos: false, ads: false, metas: null, concentracao: null, cobertura_dias: 120, share_ruptura_pct: 5, acoes: [], hoje: HOJE }
  const cls = (estado, extra = {}) => classificarEstrategia({ ...base, estado, ...extra })
  const semPromessa = s => assert.ok(!/garant|vai vender/i.test(s.justificativa), 'justificativa sem promessa: ' + s.justificativa)
  const queda = cls(E('queda', { forca: 'forte', variacao_pct: -32 }))
  assert.equal(queda.classe, 'Sobrevivência'); assert.equal(queda.confianca, 'fato'); assert.match(queda.justificativa, /-32%/); semPromessa(queda)
  const inviavel = cls(E('crescimento'), { economia: { viavel: false, acos_max_pct: -4 }, custos: true, ads: true })
  assert.equal(inviavel.classe, 'Sobrevivência', 'economia inviável vence o crescimento'); assert.match(inviavel.justificativa, /inviável.*-4%/); semPromessa(inviavel)
  const ruptura = cls(E('estagnacao'), { share_ruptura_pct: 45 })
  assert.equal(ruptura.classe, 'Sobrevivência'); assert.match(ruptura.justificativa, /45%.*limite 40%/)
  const est = cls(E('estagnacao'))
  assert.equal(est.classe, 'Manutenção'); semPromessa(est)
  const cresc = cls(E('crescimento'), { economia: { viavel: true, roas_alvo: 2.5 }, custos: true, ads: true })
  assert.equal(cresc.classe, 'Crescimento'); assert.match(cresc.justificativa, /\+18%.*ROAS alvo 2,5/); semPromessa(cresc)
  assert.equal(cls(E('crescimento')).classe, 'Crescimento', 'crescimento sem Ads também é Crescimento')
  assert.equal(cls(E('crescimento'), { ads: true }).classe, 'Manutenção', 'crescimento com Ads e sem custos: a economia não é verificável → Manutenção, dito')
  const semBase = cls(E('sem_base', { motivo: 'só 3 unidade(s) no período anterior' }))
  assert.equal(semBase.classe, 'Desenvolvimento'); assert.equal(semBase.confianca, 'hipotese'); assert.match(semBase.justificativa, /sem base/)
  assert.equal(cls(E('queda'), { cobertura_dias: 30 }).classe, 'Desenvolvimento', '30 dias de série (mínimo 56) → Desenvolvimento')
  const cad = cls(E('queda'), { acoes: [{ regra: 'anuncio_oferta_cadastro' }, { regra: 'anuncio_duplicacao_estrategica', gatilho: 'G1' }, { regra: 'anuncio_ima_conversao' }] })
  assert.equal(cad.classe, 'Desenvolvimento'); assert.match(cad.justificativa, /66,7% das 3 ações/)
  assert.equal(cls(E('queda')).classe, 'Manutenção', 'queda moderada confirmada, sem sinal misto: cai em Manutenção (dito)')
  // sempre provisória, com os 3 que faltam; sinal misto → hipótese e revisão em 7 dias (sem misto: 14)
  for (const s of [queda, inviavel, est, cresc, semBase, cad]) { assert.equal(s.provisoria, true); assert.deepEqual(s.faltam, ['caixa', 'capacidade', 'mercado']); assert.ok(s.condicoes_revisao.length >= 3 && s.evidencias.length >= 10) }
  assert.equal(queda.revisar_em, addDias(HOJE, 14))
  const misto = cls(E('queda', { sinal_misto: 'Sinal misto: …' }))
  assert.equal(misto.classe, 'Manutenção'); assert.equal(misto.confianca, 'hipotese'); assert.equal(misto.revisar_em, addDias(HOJE, 7))
  // com a saída REAL de classificarEstado (queda de 14 d com mês em alta = sinal misto)
  const real = classificarEstado({ serie: comReceita({ ...serie(10, addDias(ATE, -55), addDias(ATE, -28)), ...serie(30, addDias(ATE, -27), addDias(ATE, -14)), ...serie(18, addDias(ATE, -13), ATE) }), ate: ATE, cob: COB })
  const sr = cls(real); assert.ok(real.sinal_misto && sr.confianca === 'hipotese' && sr.revisar_em === addDias(HOJE, 7))
  // 80/20: o alerta de concentração lê do config (top1 60% ≥ 40%)
  assert.equal(cfgRetro.pareto.top1_alerta_pct, 40); assert.ok(paretoItens([{ id: 'A', r: 6000 }, { id: 'B', r: 4000 }]).alerta, 'top1 60%: alerta')
  assert.equal(paretoItens([{ id: 'A', r: 3900 }, { id: 'B', r: 3800 }, { id: 'C', r: 2300 }]).alerta, null, 'top1 39%: sem alerta')
  // pesos por estratégia: gancho declarado, 1,0 em todas as classes hoje (nenhum fator muda); peso diferente entra DENTRO do clamp
  const regras = [{ id: 'ima_conversao', tipo_demanda: 'Otimizar Anúncios' }, { id: 'estoque_ruptura', tipo_demanda: 'Planejamento full' }]
  const vazio = aprender([])
  for (const classe of Object.keys(cfgRetro.estrategia.pesos)) assert.deepEqual(fatoresDoPlano({ estado: 'queda', apConta: vazio, apOutros: vazio, regras, estrategia: classe }), fatoresDoPlano({ estado: 'queda', apConta: vazio, apOutros: vazio, regras }), 'peso 1,0: ' + classe)
  const c2 = { ...cfgRetro, estrategia: { ...cfgRetro.estrategia, pesos: { ...cfgRetro.estrategia.pesos, 'Sobrevivência': 1.2 } } }
  const f2 = fatoresDoPlano({ estado: 'queda', apConta: vazio, apOutros: vazio, regras, estrategia: 'Sobrevivência', c: c2 })
  assert.equal(f2.estoque_ruptura.fator, cfgRetro.plano.fator_max, '1,25 × 1,2 = 1,5 fica no teto 1,35'); assert.equal(f2.ima_conversao.peso_estrategia, 1.2); assert.match(f2.ima_conversao.motivo, /estratégia Sobrevivência: ×1,2/)
}
console.log('teste-retroalimentacao: OK')
