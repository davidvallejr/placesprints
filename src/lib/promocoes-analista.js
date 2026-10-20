// O ANALISTA de promoções (porte de analista-promocoes + a pré-seleção R1/R2 de controle-promocoes-ml).
// Núcleo PURO (analisar, vigias, interrogatório, invariante — sem rede, sem banco) + envoltórios que leem/gravam
// pelo promocoes-db. Princípios herdados do dono: nunca MC < 0 (exceto SKU "Livre"), nunca desmarca, não toca em
// marca HUMANA (marca do analista é distinta e recalculável), uma marcação por anúncio (a de maior MC), nunca
// sai de campanha, nunca recomenda LIGHTNING, e a rodada só termina com o INVARIANTE provado por read-back.
import {
  num, norm, addDias, diasEntre, mesmoPreco, diaBR, ehRebate, ehRelampagoSmart, ehLightning, naoCobre, naoMexePreco, smartSemNome,
  calcularMC, resolverCustos, precoParaMargem, precoVigente, coberturaContinua, curvaABC, parseStatusRegra, marcaHumanaViva,
} from './promocoes-mc.js'
import * as repo from './promocoes-db.js'
import { custosEfetivos, vinculosCusto } from './custos-db.js'
import { createHash } from 'node:crypto'

export const ALVO_MANUAL = 22                 // regra de 31/07: a manual nasce com 21–22% de gordura (só referência de preço, não decide nada)
export const DESCONTO_MIN_ML = 5              // o ML só aceita promoção com ≥ 5% de desconto sobre o preço cheio (skill 31/08 e 17/09)
export const JANELA_VIGIA_LONGA = 14          // skill 17/09: o vigia roda SEMPRE as duas janelas — a configurada (7) e a de 14 dias
export const janelasVigia = config => [...new Set([config.dias_vigia, JANELA_VIGIA_LONGA])].sort((a, b) => a - b)
export const chaveCobertura = (item, dias) => `${item}|${dias}d`
export const NOTA_LIBERADA = 'marca 👤 antiga em campanha encerrada — reavaliado'
const SAZONAL = /(8\.8|9\.9|10\.10|11\.11|12\.12|dia dos|dia das|dia da crianca|black|top sellers?|destaque|semana d|natal|sazon|cyber|volta as aulas)/
const fPct = n => (!Number.isFinite(n) ? '—' : n.toFixed(1).replace('.', ',') + '%')      // nunca "-Infinity%"/"NaN%" em texto: não-finito = desconhecido
const fR = n => (!Number.isFinite(n) ? '—' : 'R$ ' + n.toFixed(2).replace('.', ','))
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const chave = (item, pid) => `${item}|${pid}`
const porMC = (a, b) => b.mcPct - a.mcPct || (b.meliPct || 0) - (a.meliPct || 0) || String(b.fim || '').localeCompare(String(a.fim || ''))
const porRebate = (a, b) => (b.meliPct || 0) - (a.meliPct || 0) || (b.mcPct ?? -Infinity) - (a.mcPct ?? -Infinity) || String(a.pid).localeCompare(String(b.pid))
// a candidata CONTINUA a cobertura que acaba em `ate`, sem lacuna: cobre de verdade (não é PRICE_MATCHING/cupom/BANK), abre até `ate`+1 e termina depois.
// Início desconhecido não prova nada (mesma regra de coberturaContinua para oferta que ainda não começou) — falha fechado.
const continuaCobertura = (c, ate) => !c.naoCobre && !!c.fim && c.fim > ate && !!c.inicio && c.inicio <= addDias(ate, 1)
// SMART sem nome (nem na oferta nem na campanha): o nome é o único detector do relâmpago (só painel) — o analista nunca a marca nem a sugere no vigia; só avisa
export const TXT_SMART_SEM_NOME = 'SMART sem nome — confirme no painel se é relâmpago'
// "faltando décimos para o piso E com cobertura vencendo, a decisão dele é entrar" (aprendizados 31/08 item 2, 02/09 e 04/09-b): o vigia LEVA À MESA
// a candidata que continua a cobertura a menos de 1 ponto do piso (MC + quanto falta) — nunca marca sozinho ("NÃO virar banda automática", 31/08 item 1)
export const QUASE_PISO_PONTOS = 1

// custo do anúncio: a resolução única (custo-vinculo.js: manual > SKU exato > SKU normalizado > grupo), gravada em a.custo_resolvido por carregarEntrada.
// Sem ela (chamada pura de teste), o SKU exato de sempre.
export const custoDoItem = (a, custosSku) => a.custo_resolvido !== undefined ? a.custo_resolvido?.custo ?? null : custosSku.get(String(a.sku || '').toLowerCase()) ?? null

// regra por SKU: o MLB manda sobre o SKU
export function regraDoAnuncio(a, regras) {
  const mlb = String(a.item_id).toUpperCase(), sku = String(a.sku || '').toLowerCase()
  return regras.find(r => r.mlb && String(r.mlb).toUpperCase() === mlb) || (sku && regras.find(r => !r.mlb && r.sku && String(r.sku).toLowerCase() === sku)) || null
}
export function precoReferencia(a, ofertas) {
  const orig = ofertas.map(o => num(o.preco_original)).filter(x => x > 0)
  return orig.length ? Math.max(...orig) : num(a.preco_original) ?? num(a.preco)
}

// ── avalia UM anúncio: candidatos, MC, regra, marca(s) do analista, motivo quando NÃO marca ──────────────
export function avaliarAnuncio({ anuncio: a, ofertas: lidas, campanhas, custos, regra, ignorar, config, hoje }) {
  const ofertas = lidas.map(o => (o.nome ? o : { ...o, nome: campanhas.get(o.pid)?.nome || '' }))      // = completarNomes do plano: relâmpago/SMART sem nome se decidem DEPOIS disso
  const rg = regra ? parseStatusRegra(regra.status) : { tipo: 'padrao' }
  const precoRef = precoReferencia(a, ofertas)
  const piso = rg.tipo === 'piso' ? rg.piso : config.piso_mc
  const pisoRel = rg.tipo === 'piso' ? rg.piso : config.piso_relampago
  const R = {
    item_id: a.item_id, sku: a.sku, estado: 'ok', regraSku: regra?.status || null, regraTipo: rg.tipo, piso, pisoRelampago: pisoRel, precoRef, custos,
    candidatos: [], elegiveisPiso: [], marcaria: [], outras: [], motivoSemMarca: null, avisos: [], avisoP: null,
    atual: null, vigente: null, relampago: { candidatos: [], elegiveisPiso: [], marcaria: null, motivoSemMarca: null },
  }
  const comMC = o => {
    const p = num(o.preco)
    const m = p > 0 && custos.ok ? calcularMC({ preco: p, precoOriginal: num(o.preco_original) ?? precoRef, meliPct: o.meli_pct, ...custos }) : null
    const camp = campanhas.get(o.pid)
    return { oferta: o, pid: o.pid, offer_id: o.offer_id, tipo: o.tipo, nome: o.nome || camp?.nome || o.pid, preco: p, meliPct: num(o.meli_pct), fim: diaBR(o.fim) || diaBR(camp?.fim),
      inicio: diaBR(o.inicio) || diaBR(camp?.inicio) || (camp?.status === 'started' ? hoje : null), naoCobre: naoCobre(o),      // sem data de início e campanha não iniciada => null (desconhecido)
      mc: m?.ok ? m.mc : null, mcPct: m?.ok ? m.mcPct : null, semPreco: !(p > 0), semNome: smartSemNome(o) }
  }
  const started = ofertas.filter(o => o.status === 'started'), pending = ofertas.filter(o => o.status === 'pending')
  const cands = ofertas.filter(o => o.status === 'candidate')
  const normais = cands.filter(o => ehRebate(o) && !ehRelampagoSmart(o) && !ehLightning(o)).map(comMC)
  const relamp = cands.filter(o => ehRebate(o) && ehRelampagoSmart(o)).map(comMC)
  R.candidatos = normais; R.relampago.candidatos = relamp
  const decidiveis = normais.filter(c => !c.semNome), semNomeC = normais.filter(c => c.semNome)      // SMART sem nome aparece (com MC), mas nunca é marcada pela API
  if (semNomeC.length) R.avisos.push(`${TXT_SMART_SEM_NOME} (${semNomeC.map(c => c.pid).join(', ')}): pode ser o relâmpago, que só entra pelo painel — o analista não recomenda`)
  const lightning = cands.filter(ehLightning)
  if (lightning.length) R.avisos.push(`LIGHTNING (sem rebate) nunca é recomendada pelo analista (regra do dono, 02/09/2026): ${lightning.length} candidata(s) ignorada(s)`)

  const vivas = [...started, ...pending].filter(o => ehRebate(o))
  const atuaisNormais = vivas.filter(o => !ehRelampagoSmart(o)).map(comMC)
  const atuaisRelamp = vivas.filter(o => ehRelampagoSmart(o))
  R.atual = atuaisNormais.filter(x => x.mcPct != null).sort((x, y) => y.mcPct - x.mcPct)[0] || null
  const vig = precoVigente(ofertas, precoRef)
  if (vig.oferta) {
    const meliMin = Math.min(...vig.empatadas.map(o => num(o.meli_pct) || 0))      // conservador: o ML pode ter elegido o de menor rebate
    const m = custos.ok ? calcularMC({ preco: vig.preco, precoOriginal: precoRef, meliPct: meliMin, ...custos }) : null
    R.vigente = { preco: vig.preco, nome: vig.oferta.nome || campanhas.get(vig.oferta.pid)?.nome || vig.oferta.pid, mcPct: m?.ok ? m.mcPct : null }
    R.avisoP = `⚠P já em: ${R.vigente.nome} · ${fR(vig.preco)} · MC ${fPct(R.vigente.mcPct)} — entrar em outra campanha não pode dar desconto sobre desconto`
  }

  // portões que valem para as duas pistas
  const semMarca = (codigo, texto) => ({ codigo, texto })
  let portao = null
  if (a.under_review || a.status === 'under_review') portao = semMarca('under_review', `under_review${a.sub_status ? ` (${a.sub_status})` : ''}: o ML devolve 400 e não aceita promoção até a revisão terminar — destravar é ação do dono (ex.: migrar para catálogo)`)
  else if (['closed', 'inactive'].includes(a.status)) portao = semMarca('inativo', `anúncio ${a.status === 'closed' ? 'fechado' : 'inativo'}: se foi o dono quem fechou, é estratégia — não é pendência nem descoberto (confirme antes de tratar)`)
  else if (a.status === 'paused') portao = semMarca('pausado', 'anúncio pausado: o ML recusa promoção — reative antes de decidir')
  else if (ignorar) portao = semMarca('ignorar', `👤 IGNORAR (decisão do dono, ${String(ignorar.em).slice(0, 10)}): ${ignorar.resposta}`)
  else if (rg.tipo === 'revisar') portao = semMarca('revisar_toda_rodada', `Revisar toda rodada${regra?.nota ? ` (${regra.nota})` : ''}: o analista NÃO decide — escolha entre entrar na campanha ou criar promoção manual`)
  else if (rg.tipo === 'desconhecido') R.avisos.push(`status de regra por SKU não reconhecido ("${regra.status}") — usando o piso padrão`)
  if (portao) { R.estado = portao.codigo; R.motivoSemMarca = portao; R.relampago.motivoSemMarca = portao; return R }
  if (!normais.length && !relamp.length) { R.estado = 'sem_elegivel'; R.motivoSemMarca = semMarca('sem_elegivel', 'nenhuma campanha de rebate elegível (candidate com rebate do ML)'); return R }

  const marca = (c, regraCod, motivo, extra = {}) => ({
    item_id: a.item_id, pid: c.pid, offer_id: c.offer_id || '', regra: regraCod, motivo, via: 'api', preco: c.preco, meli_pct: c.meliPct, mc: c.mc, mc_pct: c.mcPct,
    nome: c.nome, fim: c.fim, ...extra,
  })

  // ── pista normal (SMART/PRICE_MATCHING/MARKETPLACE sem relâmpago) ──
  if (normais.length) {
    if (rg.tipo === 'livre') {
      if (vivas.some(o => !ehRelampagoSmart(o))) R.motivoSemMarca = semMarca('ja_ativo', 'SKU "Livre": já participa de campanha de rebate — "já está ativo, não mexer"')
      else if (!decidiveis.length) R.motivoSemMarca = semMarca('smart_sem_nome', `${TXT_SMART_SEM_NOME} — o analista não marca`)
      else { const best = [...decidiveis].sort(porRebate)[0]; R.marcaria.push(marca(best, 'LIVRE', `SKU "Livre" (fora de linha): entra na campanha de MELHOR REBATE (${fPct(best.meliPct)}); MC ${fPct(best.mcPct)} não é decisiva`)); R.elegiveisPiso = [best.pid] }
    } else if (!custos.ok) {
      R.estado = 'sem_custo'
      R.motivoSemMarca = semMarca('sem_custo', `${custos.estado} (faltando: ${custos.faltando.join(', ')}) — pendência NEEDS_EXTERNAL_DATA: sem MC o analista não recomenda`)
    } else {
      const calc = decidiveis.filter(x => x.mcPct != null)
      const pisoEf = Math.max(piso, 0)                                               // "nunca MC < 0": piso nunca fica abaixo de zero
      const aprov = calc.filter(x => x.mcPct >= pisoEf).sort(porMC)
      R.elegiveisPiso = aprov.map(x => x.pid)
      if (!decidiveis.length) R.motivoSemMarca = semMarca('smart_sem_nome', `${TXT_SMART_SEM_NOME} — o analista não marca`)
      else if (!calc.length) R.motivoSemMarca = semMarca('sem_preco', 'candidatas sem preço utilizável na API — não há como calcular MC')
      else if (!aprov.length) {
        const melhor = [...calc].sort(porMC)[0]
        R.motivoSemMarca = melhor.mcPct < 0 ? semMarca('mc_negativa', `MC NEGATIVA em todas (melhor ${fPct(melhor.mcPct)}) — nunca entra sem ordem direta`)
          : semMarca('abaixo_piso', `abaixo do piso: melhor MC ${fPct(melhor.mcPct)} < ${fPct(piso)} (${melhor.nome}) — decisão sua, 1 a 1`)
      } else {
        const best = aprov[0], base = rg.tipo === 'piso' ? 'PISO_SKU' : null
        const sufixo = rg.tipo === 'piso' ? ` (piso próprio do SKU: ${fPct(piso)})` : ''
        if (atuaisNormais.length && !R.atual) R.motivoSemMarca = semMarca('atual_sem_mc', 'já participa, mas a MC da participação atual não é calculável (sem preço) — "já está ativo, não mexer"')
        else if (R.atual) {                                                               // R1: já participa
          const ehAtual = x => atuaisNormais.some(a => a.pid === x.pid && mesmoPreco(a.preco, x.preco) && mesmoPreco(a.meliPct, x.meliPct))
          const igual = ehAtual(best)
          // R1C decide pela cobertura CONTÍNUA total (qualquer campanha que cobre: manual/DEAL/SMART; PRICE_MATCHING/cupom/BANK não cobrem), nunca só pelo fim do rebate
          const cob = coberturaContinua(ofertas, hoje, { campanhas })
          const vence = cob.cobreAte != null && cob.cobreAte <= addDias(hoje, config.janela_cobertura_dias)
          const bestCob = vence && !igual ? aprov.find(x => !ehAtual(x) && continuaCobertura(x, cob.cobreAte)) : null      // a candidata tem de CONTINUAR a cobertura, sem lacuna
          if (!igual && best.mcPct >= R.atual.mcPct) R.marcaria.push(marca(best, base || 'R1', `migra p/ ${best.nome} — MC ${fPct(best.mcPct)} ≥ atual ${fPct(R.atual.mcPct)} (${R.atual.nome}) e ≥ piso ${fPct(piso)}${sufixo}`))
          else if (bestCob)
            R.marcaria.push(marca(bestCob, 'R1C', `cobertura: a cobertura atual (${R.atual.nome}) vence ${cob.cobreAte === hoje ? 'HOJE' : 'em ' + cob.cobreAte} — marca ${bestCob.nome} (MC ${fPct(bestCob.mcPct)} < atual ${fPct(R.atual.mcPct)}, mas ≥ piso; abre ${bestCob.inicio}, vai até ${bestCob.fim}) para não ficar descoberto (decisão do dono, 28/07 e 31/08)`))
          else R.motivoSemMarca = semMarca('atual_melhor', `já participa de ${R.atual.nome} com MC ${fPct(R.atual.mcPct)} ≥ melhor candidata ${fPct(best.mcPct)} — "já está ativo, não mexer"${vence && !igual ? `; ⚠ a cobertura vence ${cob.cobreAte} e nenhuma elegível a continua sem lacuna (veja o vigia de cobertura)` : ''}`)
        } else R.marcaria.push(marca(best, base || 'R2', `sem campanha de rebate — melhor elegível ${best.nome}, MC ${fPct(best.mcPct)} ≥ piso ${fPct(piso)}${sufixo}`))
        // hedge de cobertura: a marcada acaba em ≤ janela dias => marca também a de maior vigência ≥ piso que a CONTINUA sem lacuna (as duas ficam started)
        const ancora = R.marcaria.length ? aprov.find(x => x.pid === R.marcaria[0].pid) : null
        if (ancora && config.hedge_cobertura && ancora.fim && ancora.fim <= addDias(hoje, config.janela_cobertura_dias)) {
          const longa = aprov.filter(x => x.pid !== ancora.pid && continuaCobertura(x, ancora.fim)).sort((x, y) => String(y.fim).localeCompare(String(x.fim)) || y.mcPct - x.mcPct)[0]
          if (longa) R.marcaria.push(marca(longa, 'HEDGE', `hedge de cobertura: ${ancora.nome} acaba em ${ancora.fim}; ${longa.nome} (até ${longa.fim}, MC ${fPct(longa.mcPct)}) entra junto — não troca preço, as duas ficam started (decisão do dono, 28/09)`, { ancora: ancora.pid }))
        }
        const marcados = new Set(R.marcaria.map(m => m.pid))
        R.outras = aprov.filter(x => !marcados.has(x.pid)).map(x => ({ pid: x.pid, nome: x.nome, preco: x.preco, mcPct: x.mcPct }))
      }
    }
  }

  // ── pista do relâmpago SMART (só PAINEL; piso 19% por padrão) ──
  if (relamp.length) {
    const T = R.relampago
    if (atuaisRelamp.length) T.motivoSemMarca = semMarca('ja_ativo', 'já participa/está programado em relâmpago SMART — "já está ativo, não mexer"')
    else if (rg.tipo === 'livre') { const best = [...relamp].sort(porRebate)[0]; T.marcaria = { ...marca(best, 'RELAMPAGO', `relâmpago SMART (só painel), SKU "Livre": melhor rebate ${fPct(best.meliPct)}`), via: 'painel' }; T.elegiveisPiso = [best.pid] }
    else if (!custos.ok) T.motivoSemMarca = semMarca('sem_custo', `${custos.estado} (faltando: ${custos.faltando.join(', ')}) — pendência NEEDS_EXTERNAL_DATA`)
    else {
      const aprov = relamp.filter(x => x.mcPct != null && x.mcPct >= Math.max(pisoRel, 0)).sort(porMC)
      T.elegiveisPiso = aprov.map(x => x.pid)
      if (aprov.length) T.marcaria = { ...marca(aprov[0], 'RELAMPAGO', `relâmpago SMART (só painel, nunca por API): MC ${fPct(aprov[0].mcPct)} ≥ piso do relâmpago ${fPct(pisoRel)} — confira o preço na TELA antes de entrar (a tela manda)`), via: 'painel' }
      else {
        // slot sem preço (a API do item perde o preço do slot — skill 28/09) não é "margem baixa": diz a causa, nunca um número inventado
        const comPreco = relamp.filter(x => x.mcPct != null), semP = relamp.length - comPreco.length
        T.motivoSemMarca = !comPreco.length ? semMarca('sem_preco', 'relâmpago sem preço no slot — confira no painel (a API do item não trouxe o preço; a tela manda)')
          : semMarca('abaixo_piso', `relâmpago abaixo do piso de ${fPct(pisoRel)}: melhor MC ${fPct(Math.max(...comPreco.map(x => x.mcPct)))}${semP ? `; ${semP} slot(s) sem preço no slot — confira no painel` : ''}`)
      }
    }
  }
  return R
}

export function montarObs(m, av) {
  const partes = [`🤖 Recomendação do analista (${m.regra}): ${m.motivo}`]
  if (av.avisoP) partes.push(av.avisoP)
  if (m.via === 'painel') partes.push('Entrada só pelo PAINEL (a API pública não aceita relâmpago SMART).')
  if (av.outras.length && m.via !== 'painel')
    partes.push(`↳ outras elegíveis (NÃO marcadas — marcar derruba o preço p/ o menor): ${av.outras.map(o => `${o.nome} ${fR(o.preco)} MC ${fPct(o.mcPct)}`).join('; ')}`)
  return partes.join(' — ')
}

// ── análise da carteira inteira (PURA) ───────────────────────────────────────────────────────────────
export function analisar({ hoje, config, anuncios, ofertasPorItem, campanhas, regrasSku = [], aprendizados = [], custosSku = new Map(), custosCliente = null, dias = null, marcasPorItem = null, recusas = null, marcasHumanas = null }) {
  const camps = campanhas instanceof Map ? campanhas : new Map(campanhas.map(c => [c.pid, c]))
  const ign = aprendizados.filter(a => a.ativo && a.acao === 'ignorar')
  const ignorarDe = a => ign.find(x => (x.escopo_tipo === 'item' && String(x.escopo_valor).toUpperCase() === a.item_id.toUpperCase()) || (x.escopo_tipo === 'sku' && a.sku && x.escopo_valor.toLowerCase() === a.sku.toLowerCase())) || null
  const avaliacoes = new Map(), recomendacoes = []
  for (const a of anuncios) {
    const ofertas = ofertasPorItem.get(a.item_id) || []
    const custos = resolverCustos({ custoSku: custoDoItem(a, custosSku), custosCliente, tarifaItem: a.tarifa, impostoPct: config.imposto_pct, precoRef: precoReferencia(a, ofertas) })
    const av = avaliarAnuncio({ anuncio: a, ofertas, campanhas: camps, custos, regra: regraDoAnuncio(a, regrasSku), ignorar: ignorarDe(a), config, hoje })
    for (const m of av.marcaria) recomendacoes.push({ ...m, obs: montarObs(m, av), outras: av.outras.map(o => o.pid) })
    if (av.relampago.marcaria) recomendacoes.push({ ...av.relampago.marcaria, obs: montarObs(av.relampago.marcaria, av), outras: [] })
    avaliacoes.set(a.item_id, av)
  }
  const marcas = marcasPorItem || (() => { const m = new Map(); for (const r of recomendacoes) { if (!m.has(r.item_id)) m.set(r.item_id, new Set()); m.get(r.item_id).add(r.pid) } return m })()
  // as DUAS janelas (7 e 14, ou a configurada + 14) rodam TODA rodada e são as que o invariante prova; `dias` (seletor da tela) só escolhe a que `cobertura` mostra
  const diasTela = dias ?? config.dias_vigia
  const porJanela = new Map([...new Set([...janelasVigia(config), diasTela])].map(d => [d, vigiaCobertura({ anuncios, ofertasPorItem, campanhas: camps, avaliacoes, hoje, dias: d, marcasPorItem: marcas, recusas, humanasPorItem: marcasHumanas })]))
  const cobertura = porJanela.get(diasTela)
  const coberturaJanelas = janelasVigia(config).map(d => ({ dias: d, ...porJanela.get(d) }))
  const rebatePior = vigiaRebatePior({ anuncios, ofertasPorItem, campanhas: camps, hoje })
  const lembretes = [], semCusto = [], underReview = []
  for (const a of anuncios) {
    const av = avaliacoes.get(a.item_id)
    if (av.estado === 'revisar_toda_rodada') lembretes.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, nota: regraDoAnuncio(a, regrasSku)?.nota || '', candidatas: av.candidatos.length + av.relampago.candidatos.length })
    if (av.estado === 'under_review') underReview.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, sub_status: a.sub_status, texto: av.motivoSemMarca.texto })
    if (!av.custos.ok && av.regraTipo !== 'livre' && (av.candidatos.length || av.relampago.candidatos.length) && !['under_review', 'inativo', 'pausado', 'ignorar', 'revisar_toda_rodada'].includes(av.estado))
      semCusto.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, estado: av.custos.estado, faltando: av.custos.faltando, candidatas: av.candidatos.length + av.relampago.candidatos.length, pendencia: 'NEEDS_EXTERNAL_DATA' })
  }
  const resumo = {
    anuncios: anuncios.length,
    com_elegivel: [...avaliacoes.values()].filter(v => v.candidatos.length || v.relampago.candidatos.length).length,
    com_elegivel_ge_piso: [...avaliacoes.values()].filter(v => v.elegiveisPiso.length || v.relampago.elegiveisPiso.length).length,
    recomendacoes: recomendacoes.length, sem_custo: semCusto.length, under_review: underReview.length, lembretes: lembretes.length,
    descobertos: cobertura.alertas.filter(x => !x.incerta).length, cobertura_incerta: cobertura.alertas.filter(x => x.incerta).length, rebate_pior: rebatePior.length,
  }
  return { avaliacoes, recomendacoes, vigias: { cobertura, coberturaJanelas, rebatePior, lembretes, semCusto, underReview }, resumo }
}

// ── VIGIA 1: protegidos (curva A/B ou marcados) que ficam descobertos nos próximos N dias ────────────
export function vigiaCobertura({ anuncios, ofertasPorItem, campanhas, avaliacoes, hoje, dias, marcasPorItem, recusas = null, humanasPorItem = null }) {
  const alertas = [], excecoes = []
  const limite = addDias(hoje, dias)
  const bloqueado = (item, pid, origem) => !!recusas?.bloqueado?.(item, pid, origem)       // recusa 👤 / IGNORAR / Revisar toda rodada (promocoes-db.recusasHumanas): vinculante também aqui
  for (const a of anuncios) {
    if (!(a.protegido || ['A', 'B'].includes(a.curva))) continue
    const av = avaliacoes.get(a.item_id)
    if (['closed', 'inactive'].includes(a.status)) { excecoes.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, motivo: `anúncio ${a.status}: se o dono fechou é estratégia — não é descoberto (confirme)` }); continue }
    if (a.under_review || a.status === 'under_review') { excecoes.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, motivo: 'under_review: sem leitura de promoções (400) — a promoção que já estava no ar continua valendo; leia /items/{id}/prices antes de alarmar' }); continue }
    if (a.status === 'paused') { excecoes.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, motivo: 'anúncio pausado: promoção não se aplica até reativar' }); continue }
    if (!a.lido_em || a.oferta_erro) { excecoes.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, motivo: `sem leitura das promoções${a.oferta_erro ? ` (${a.oferta_erro})` : ''}: cobertura DESCONHECIDA — nunca presumir coberto` }); continue }
    const cob = coberturaContinua(ofertasPorItem.get(a.item_id) || [], hoje, { campanhas })
    const base = {
      chave: a.item_id, item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, fat30: a.fat30, protegido: a.protegido, janela_dias: dias,
      cobreAte: cob.cobreAte, cobreAteRebate: cob.cobreAteRebate, cobreAteSemRebate: cob.cobreAteSemRebate, voltaEm: cob.voltaEm, suspeita: cob.suspeita, fonteFim: cob.fonteFim,
      venceEmDias: cob.cobreAte ? diasEntre(hoje, cob.cobreAte) : null, avisosData: cob.avisos, severidade: a.curva === 'A' ? 'alta' : a.curva === 'B' ? 'media' : 'baixa',
    }
    // cobertura vinda só da campanha-mãe e a mais de 60 dias é SUSPEITA (a participação real pode acabar antes — a oferta SMART não traz data): alerta, nunca "coberto"
    if (cob.suspeita && cob.fonteFim === 'campanha') {
      alertas.push({ ...base, incerta: true, saida: 'CONFIRMAR COBERTURA', marcaCobre: false, melhorCobre: null, precoManual: null,
        manualNota: `cobertura INCERTA: a data (${cob.cobreAte}) vem da campanha-mãe, não da oferta do anúncio, e está a mais de 60 dias — a participação real pode acabar antes: confirme em /items/${a.item_id}/prices (nunca presumir coberto)` })
      continue
    }
    if (!(cob.cobreAte === null || cob.cobreAte < limite)) continue
    const alvoCob = cob.cobreAte ?? hoje
    const livre = av.regraTipo === 'livre'
    const piso = livre ? -Infinity : Math.max(av.piso, 0)
    const mcOk = c => livre || (c.mcPct != null && c.mcPct >= piso)
    // recusa 👤 e portão do dono (IGNORAR / Revisar toda rodada) valem aqui: o vigia nunca recomenda "MARCAR" o que ninguém vai marcar.
    // Exceção: a candidata que o PRÓPRIO dono marcou (👤 viva) não é barrada pelo portão — a marca explícita decide caso a caso (mesma regra de recusasHumanas.bloqueado(..., 'humano'))
    const portao = ['ignorar', 'revisar_toda_rodada'].includes(av.estado), humanas = humanasPorItem?.get(a.item_id)
    const semNome = av.candidatos.filter(c => c.semNome), conhecidas = av.candidatos.filter(c => !c.semNome)      // SMART sem nome pode ser o relâmpago (só painel): nunca "MARCAR"
    const barradas = conhecidas.filter(c => humanas?.has(c.pid) ? bloqueado(a.item_id, c.pid, 'humano') : portao || bloqueado(a.item_id, c.pid)), usaveis = conhecidas.filter(c => !barradas.includes(c))
    // "estende" = continua a cobertura SEM lacuna: PRICE_MATCHING/cupom/BANK não cobrem e a campanha tem de abrir até o dia seguinte ao fim da cobertura atual
    const estende = c => continuaCobertura(c, alvoCob) && mcOk(c)
    const cobrem = usaveis.filter(estende)
    const melhorCobre = [...cobrem].sort(livre ? porRebate : porMC)[0] || null
    const marcados = marcasPorItem?.get(a.item_id) || new Set()
    const marcaCobre = melhorCobre ? cobrem.some(c => marcados.has(c.pid)) : false
    const util = usaveis.filter(c => !c.naoCobre && mcOk(c) && c.fim && c.fim > alvoCob)
    const abreDepois = util.filter(c => c.inicio && c.inicio > addDias(alvoCob, 1)).map(c => ({ pid: c.pid, nome: c.nome, inicio: c.inicio, fim: c.fim, mcPct: c.mcPct }))
    const semInicio = util.filter(c => !c.inicio), semEfeito = usaveis.filter(c => c.naoCobre)
    const quase = livre ? [] : usaveis.filter(c => continuaCobertura(c, alvoCob) && c.mcPct != null && c.mcPct >= 0 && c.mcPct < piso && piso - c.mcPct < QUASE_PISO_PONTOS).sort(porMC)
    const pm = av.custos.ok ? precoParaMargem(ALVO_MANUAL, av.custos) : null
    const teto = av.precoRef > 0 ? Math.floor(av.precoRef * (100 - DESCONTO_MIN_ML)) / 100 : null    // o ML só aceita promoção com ≥ 5% sobre o cheio: o preço nunca passa do teto
    const naoFecha = pm != null && teto != null && pm > teto                                       // a MC-alvo não cabe no que o ML aceita
    const semCheio = pm != null && teto == null                                                    // sem preço cheio não há como validar o desconto mínimo
    const mcTeto = naoFecha ? calcularMC({ preco: teto, precoOriginal: av.precoRef, meliPct: 0, ...av.custos }) : null
    const precoManual = naoFecha || semCheio ? null : pm
    const nomes = l => l.map(c => c.nome).join(', ')
    const avisos = melhorCobre ? [] : [
      ...quase.map(c => `${c.nome} continuaria a cobertura (abre ${c.inicio}, vai até ${c.fim}) com MC ${fPct(c.mcPct)} — faltam ${(piso - c.mcPct).toFixed(1).replace('.', ',')} ponto(s) para o piso ${fPct(piso)}: decisão sua (décimos do piso com cobertura vencendo, você costuma entrar — 31/08, 02/09, 04/09)`),
      semNome.length && `${nomes(semNome)}: ${TXT_SMART_SEM_NOME} — o analista não a sugere como cobertura`,
      semEfeito.length && `${nomes(semEfeito)}: PRICE_MATCHING/cupom/BANK não cobre (regra de 14/09) — o anúncio ainda precisa de manual`,
      abreDepois.length && `campanha abre DEPOIS da lacuna (${abreDepois.map(c => `${c.nome} abre em ${c.inicio}`).join('; ')}) — precisa de manual até lá`,
      semInicio.length && `${nomes(semInicio)}: sem data de início — não prova cobertura sem lacuna, confirme no ML`,
      barradas.length && (portao ? `${nomes(barradas)}: item em IGNORAR/Revisar toda rodada — o analista não decide; entre na campanha ou crie a manual (decisão sua)` : `${nomes(barradas)}: recusada pelo dono (👤) — não será re-sugerida`),
    ].filter(Boolean)
    const notaPreco = naoFecha ? `não fecha a MC-alvo de ${ALVO_MANUAL}% dentro do que o ML aceita (desconto mínimo de ${DESCONTO_MIN_ML}% sobre o cheio ${fR(av.precoRef)} => teto ${fR(teto)}, MC no teto ${mcTeto?.ok ? fPct(mcTeto.mcPct) : '—'}): 3 saídas, decisão do dono — entrar como exceção, ficar de fora ou reprecificar/rever custo`
      : semCheio ? `sem preço cheio de referência: não dá para validar o desconto mínimo de ${DESCONTO_MIN_ML}% do ML — sem sugestão de preço`
      : av.custos.ok ? `promoção manual (PRICE_DISCOUNT) ao preço ≈ ${fR(precoManual)} (MC-alvo ${ALVO_MANUAL}%) — fora deste módulo: use a calculadora do dono` : `${av.custos.estado}: preço da manual não calculável`
    alertas.push({
      ...base, saida: melhorCobre ? 'MARCAR' : 'SUGERIR MANUAL', marcaCobre,
      melhorCobre: melhorCobre && { pid: melhorCobre.pid, nome: melhorCobre.nome, mcPct: melhorCobre.mcPct, fim: melhorCobre.fim, inicio: melhorCobre.inicio },
      abreDepois, precoManual, precoTeto: teto, mcNoTeto: mcTeto?.ok ? mcTeto.mcPct : null,
      manualNota: melhorCobre ? '' : [...avisos, notaPreco].join(' · '),
    })
  }
  alertas.sort((x, y) => (y.fat30 || 0) - (x.fat30 || 0))
  return { alertas, excecoes, protegidos: anuncios.filter(a => a.protegido || ['A', 'B'].includes(a.curva)).length, limite, dias }
}

// ── VIGIA 2: rebate PIOR no ar (não o que falta entrar, o que já está coberto pela campanha errada) ──────
// (a) várias started pelo MESMO preço com rebates diferentes (o ML pode ter elegido o menor)
// (b) started com rebate menor que uma elegível melhor que não derruba o preço
export function vigiaRebatePior({ anuncios, ofertasPorItem, campanhas, hoje }) {
  const out = []
  for (const a of anuncios) {
    const of = ofertasPorItem.get(a.item_id) || []
    // PRICE_MATCHING/cupom/BANK não mexem no preço (regra de 14/09): não disputam o preço com a SMART — nem como ativa nem como "elegível melhor"
    const disputa = o => ehRebate(o) && !naoMexePreco(o)
    const ativas = of.filter(o => o.status === 'started' && disputa(o) && num(o.preco) > 0)
    if (!ativas.length) continue
    const ref = precoReferencia(a, of)
    const nomeDe = o => o.nome || campanhas.get(o.pid)?.nome || o.pid
    const item = (tipo, pior, melhor) => {
      const ganho = Math.round(((melhor.meli_pct || 0) - (pior.meli_pct || 0)) / 100 * ref * 100) / 100
      const fimMelhor = diaBR(melhor.fim) || diaBR(campanhas.get(melhor.pid)?.fim)
      const diasFim = fimMelhor ? diasEntre(hoje, fimMelhor) : null
      const sazonal = SAZONAL.test(norm(nomeDe(pior)))
      return {
        chave: `${a.item_id}|${tipo}`, item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, fat30: a.fat30, tipo,
        atual: { pid: pior.pid, nome: nomeDe(pior), meliPct: pior.meli_pct, preco: pior.preco }, melhor: { pid: melhor.pid, nome: nomeDe(melhor), meliPct: melhor.meli_pct, preco: melhor.preco, fim: fimMelhor },
        ganhoVenda: ganho, ganhoMes: Math.round(ganho * (a.unid30 || 0) * 100) / 100, sazonal, diasFimMelhor: diasFim,
        recomendacao: sazonal ? 'campanha SAZONAL vale pela vitrine — decida você (o sistema não sai de campanha)'
          : diasFim != null && diasFim <= 7 ? `NÃO mexer: a campanha de maior rebate acaba em ${diasFim} dia(s) — sair deixaria o anúncio sem rebate logo depois`
          : `diferença de ${fR(ganho)}/venda (≈ ${fR(Math.round(ganho * (a.unid30 || 0) * 100) / 100)}/mês) — decisão do dono, 1 a 1: o sistema NUNCA sai de campanha`,
        severidade: a.curva === 'A' ? 'alta' : a.curva === 'B' ? 'media' : 'baixa',
      }
    }
    const grupos = []
    for (const o of ativas) { const g = grupos.find(g => mesmoPreco(g[0].preco, o.preco)); g ? g.push(o) : grupos.push([o]) }
    for (const g of grupos) if (g.length > 1) {
      const ord = [...g].sort((x, y) => (x.meli_pct || 0) - (y.meli_pct || 0))
      if ((ord[ord.length - 1].meli_pct || 0) - (ord[0].meli_pct || 0) > 1e-6) out.push(item('empate', ord[0], ord[ord.length - 1]))
    }
    const setador = [...ativas].sort((x, y) => x.preco - y.preco || (x.meli_pct || 0) - (y.meli_pct || 0))[0]
    const melhorCand = of.filter(o => o.status === 'candidate' && disputa(o) && (o.meli_pct || 0) > (setador.meli_pct || 0) && num(o.preco) >= setador.preco - 0.005)
      .sort((x, y) => (y.meli_pct || 0) - (x.meli_pct || 0))[0]
    if (melhorCand) out.push(item('elegivel_melhor', setador, melhorCand))
  }
  return out.sort((x, y) => (y.fat30 || 0) - (x.fat30 || 0))
}

// ── humano manda: marca humana torna o bloco do anúncio intocável; recusa humana tira só aquela campanha ──
// `bloqueio` = repo.recusasHumanas(cliente) (fonte única das recusas 👤 e dos bloqueios IGNORAR / Revisar): vale também para quem chegou até aqui por outro caminho
// `vivas` = marcasHumanasVivas(...): a marca 👤 só trava o anúncio enquanto a campanha marcada ainda é candidata/ativa; a de campanha encerrada
// (acabou/saiu) NÃO é revogada, só deixa de ser veto e volta em `liberadas` (o chamador anota "reavaliado"). Sem `vivas`, toda marca 👤 vale (falha fechado).
export function aplicarHumanos(recs, decisoes, bloqueio = null, vivas = null) {
  const hum = decisoes.filter(d => d.origem === 'humano')
  const trilha = d => (d.via === 'painel' ? 'painel' : 'api')
  const marcadas = hum.filter(d => d.marcado && d.pid), vive = d => !vivas || !!vivas.get(d.item_id)?.has(d.pid)
  const liberadas = marcadas.filter(d => !vive(d))
  const comMarca = new Set(marcadas.filter(vive).map(d => `${d.item_id}|${trilha(d)}`))
  const recusas = new Set(hum.filter(d => !d.marcado && d.pid).map(d => chave(d.item_id, d.pid)))
  const efetivas = [], ignoradas = []
  for (const r of recs) {
    if (comMarca.has(`${r.item_id}|${r.via === 'painel' ? 'painel' : 'api'}`)) ignoradas.push({ ...r, porque: 'humano_marcou' })
    // o hedge só existe por causa da campanha-âncora: se o dono recusou a âncora, o hedge não sobra sozinho (nem com justificativa falsa)
    else if (recusas.has(chave(r.item_id, r.pid)) || (r.ancora && recusas.has(chave(r.item_id, r.ancora))) || bloqueio?.bloqueado(r.item_id, r.pid)) ignoradas.push({ ...r, porque: 'humano_recusou' })
    else efetivas.push(r)
  }
  return { efetivas, ignoradas, liberadas }
}
// marcas 👤 (marcado=1) que AINDA vinculam: item → Set de pid. Uma só fonte para o analista, o vigia, o invariante e o interrogatório.
export function marcasHumanasVivas(decisoes, anuncios, ofertasPorItem) {
  const porId = new Map(anuncios.map(a => [a.item_id, a])), m = new Map()
  for (const d of decisoes) {
    if (d.origem !== 'humano' || !d.marcado || !d.pid || !marcaHumanaViva(porId.get(d.item_id), ofertasPorItem.get(d.item_id), d.pid)) continue
    if (!m.has(d.item_id)) m.set(d.item_id, new Set())
    m.get(d.item_id).add(d.pid)
  }
  return m
}
// decisões sem as marcas 👤 liberadas (campanha encerrada): é o que o invariante e o vigia enxergam como "o dono marcou"
const semLiberadas = (decisoes, liberadas) => (liberadas.length ? decisoes.filter(d => !liberadas.includes(d)) : decisoes)

// ── INTERROGATÓRIO: onde o dono e o analista divergem, agrupado por padrão, com pergunta objetiva ────
const PADROES = {
  abaixo_piso: { titulo: 'Marcou ABAIXO do piso de MC', pergunta: i => `Você marcou ${i.sku || i.item_id} (${i.item_id}) em "${i.campanha}" com MC ${fPct(i.mcPct)} < piso ${fPct(i.piso)}. O que você viu que eu não vi — decisão pontual, exceção por SKU (N%) ou regra nova?` },
  mc_negativa: { titulo: 'Marcou com MC NEGATIVA', pergunta: i => `Você marcou ${i.sku || i.item_id} (${i.item_id}) com MC ${fPct(i.mcPct)}. É fora de linha / queima de estoque (vira "Livre")?` },
  sem_custo: { titulo: 'Marcou anúncio SEM CUSTO', pergunta: i => `Você marcou ${i.sku || i.item_id} (${i.item_id}) mas não tenho custo para calcular MC. É fora de linha (regra "Livre") ou falta cadastrar o custo?` },
  sem_preco: { titulo: 'Marcou candidata SEM PREÇO na API', pergunta: i => `Você marcou ${i.sku || i.item_id} (${i.item_id}) em "${i.campanha}", mas a API não trouxe o preço (${i.explicacao}). Qual preço você viu no painel?` },
  smart_sem_nome: { titulo: 'Marcou SMART SEM NOME (pode ser o relâmpago)', pergunta: i => `Você marcou ${i.sku || i.item_id} (${i.item_id}) em "${i.campanha}", uma SMART sem nome: não sei se é o relâmpago (só painel — o plano não a executa por API). Conferiu no painel? Se for relâmpago, entre por lá; se não for, qual é a campanha?` },
  fora_do_rebate: { titulo: 'Marcou campanha que NÃO é de rebate', pergunta: i => `Você marcou ${i.sku || i.item_id} em "${i.campanha}" (sem rebate do ML). Esta campanha entra pelo seu fluxo manual/painel?` },
  lightning: { titulo: 'Marcou LIGHTNING (sem rebate)', pergunta: i => `Você marcou LIGHTNING em ${i.sku || i.item_id}. Regra de 02/09: relâmpago só com rebate — é exceção pontual sua?` },
  atual_melhor: { titulo: 'Marcou migração que eu não faria (atual é melhor)', pergunta: i => `${i.sku || i.item_id} já está numa campanha com MC igual/melhor. Por que migrar para "${i.campanha}"?` },
  campanha_diferente: { titulo: 'Escolheu OUTRA campanha que a de maior MC', pergunta: i => `Em ${i.sku || i.item_id} você marcou "${i.campanha}" (MC ${fPct(i.mcPct)}) e eu marcaria outra de MC maior. Qual critério pesou (vigência, vitrine, rebate)?` },
  revisar_toda_rodada: { titulo: 'Marcou SKU "Revisar toda rodada"', pergunta: i => `${i.sku || i.item_id} está em "Revisar toda rodada" e você marcou "${i.campanha}". A regra continua valendo ou posso tirar da lista?` },
  ignorar: { titulo: 'Marcou item que eu devia IGNORAR', pergunta: i => `${i.sku || i.item_id} tinha a nota de IGNORAR, mas você marcou. A nota caducou?` },
  ja_ativo: { titulo: 'Marcou campanha em SKU "Livre" que já participa', pergunta: i => `${i.sku || i.item_id} é "Livre" e já participa de campanha de rebate, mas você marcou "${i.campanha}". Quer trocar pela de maior rebate ou foi só mais uma?` },
  under_review: { titulo: 'Marcou anúncio under_review', pergunta: i => `${i.sku || i.item_id} está under_review (o ML não aceita promoção). Você destravou o anúncio?` },
  outro: { titulo: 'Outras marcações que eu não faria', pergunta: i => `Marcou ${i.sku || i.item_id} em "${i.campanha}" e eu não marcaria (${i.explicacao}). O que pesou?` },
  recusa: { titulo: 'Recusou o que eu marcaria', pergunta: i => `Eu marcaria ${i.sku || i.item_id} em "${i.campanha}" (MC ${fPct(i.mcPct)} ≥ piso ${fPct(i.piso)}), e você recusou. Foi decisão (qual motivo?) ou erro meu?` },
  sem_decisao: { titulo: 'Sugestões minhas SEM decisão sua', pergunta: i => `Eu marcaria ${i.sku || i.item_id} em "${i.campanha}" (MC ${fPct(i.mcPct)}). Foi decisão não entrar ou passou batido?` },
}
export function explicarNaoMarcaria(av, pid, ofertas, camps) {
  if (!av) return { codigo: 'outro', explicacao: 'anúncio fora da última coleta' }
  if (['under_review', 'ignorar', 'revisar_toda_rodada'].includes(av.estado)) return { codigo: av.estado, explicacao: av.motivoSemMarca.texto }
  const todas = [...av.candidatos, ...av.relampago.candidatos]
  const c = todas.find(x => x.pid === pid)
  if (!c) {
    const o = ofertas.find(x => x.pid === pid)
    if (o && ehLightning(o)) return { codigo: 'lightning', explicacao: 'LIGHTNING nunca é recomendada' }
    if (o && !ehRebate(o)) return { codigo: 'fora_do_rebate', explicacao: `${o.tipo} não é campanha de rebate (meli% = ${o.meli_pct ?? 0})` }
    return { codigo: 'outro', explicacao: 'oferta não está entre as candidatas de rebate' }
  }
  const rel = av.relampago.candidatos.includes(c)
  // cada marca se explica pela SUA trilha: relâmpago (painel, piso 19%) nunca pela marca/motivo da API, e vice-versa
  const marcaT = rel ? av.relampago.marcaria : av.marcaria[0] || null, motivoT = rel ? av.relampago.motivoSemMarca : av.motivoSemMarca
  if (c.semNome) return { codigo: 'smart_sem_nome', explicacao: `${TXT_SMART_SEM_NOME} — o analista não marca`, mcPct: c.mcPct }
  if (av.regraTipo === 'livre') {                                    // "Livre": a MC não decide (vale o MELHOR REBATE) — nunca perguntar de MC/piso/custo
    return marcaT ? { codigo: 'campanha_diferente', explicacao: `SKU "Livre": analista prefere ${marcaT.nome} (maior rebate, ${fPct(marcaT.meli_pct)})`, mcPct: c.mcPct }
      : { codigo: 'ja_ativo', explicacao: motivoT?.texto || 'SKU "Livre" já participa — não mexer', mcPct: c.mcPct }
  }
  if (c.mcPct == null) return av.custos.ok ? { codigo: 'sem_preco', explicacao: rel ? 'sem preço no slot — confira no painel' : 'candidata sem preço na API' }
    : { codigo: 'sem_custo', explicacao: `${av.custos.estado}: ${av.custos.faltando.join(', ')}` }
  if (c.mcPct < 0) return { codigo: 'mc_negativa', explicacao: `MC ${fPct(c.mcPct)}`, mcPct: c.mcPct }
  const piso = rel ? av.pisoRelampago : av.piso
  if (c.mcPct < piso) return { codigo: 'abaixo_piso', explicacao: `MC ${fPct(c.mcPct)} < piso ${fPct(piso)}`, mcPct: c.mcPct }
  if (motivoT?.codigo === 'atual_melhor') return { codigo: 'atual_melhor', explicacao: motivoT.texto, mcPct: c.mcPct }
  if (marcaT) return { codigo: 'campanha_diferente', explicacao: `analista prefere ${marcaT.nome} (MC ${fPct(marcaT.mc_pct)})`, mcPct: c.mcPct }
  return { codigo: 'outro', explicacao: motivoT?.texto || 'sem motivo registrado', mcPct: c.mcPct }
}
export function interrogar({ avaliacoes, decisoes, anuncios, aprendizados = [], ofertasPorItem, campanhas }) {
  const camps = campanhas instanceof Map ? campanhas : new Map(campanhas.map(c => [c.pid, c]))
  const anun = new Map(anuncios.map(a => [a.item_id, a]))
  const hum = decisoes.filter(d => d.origem === 'humano')
  const aprov = decisoes.filter(d => d.origem === 'analista' && d.marcado && d.aprovado && d.pid)
  const marcasDono = new Map(), recusas = new Set(), marcaria = new Map()
  const add = (m, item, pid) => { if (!m.has(item)) m.set(item, new Set()); m.get(item).add(pid) }
  const vivas = marcasHumanasVivas(decisoes, anuncios, ofertasPorItem)           // 👤 de campanha encerrada não é mais "marca do dono": o analista a reavalia (não pergunta)
  const donoTrilha = new Set(), doDono = d => { add(marcasDono, d.item_id, d.pid); donoTrilha.add(`${d.item_id}|${d.via === 'painel' ? 'painel' : 'api'}`) }
  for (const d of hum) { if (d.marcado && d.pid) { if (vivas.get(d.item_id)?.has(d.pid)) doDono(d) } else if (!d.marcado && d.pid) recusas.add(chave(d.item_id, d.pid)) }
  for (const d of aprov) if (marcaHumanaViva(anun.get(d.item_id), ofertasPorItem.get(d.item_id), d.pid)) doDono(d)      // 🤖 aprovada: mesmo critério de "viva" da 👤
  // marca já executada/programada (campanha started/pending) é o estado ESPERADO — não é divergência a perguntar (vale para 👤 e 🤖 aprovada)
  const noAr = (item, pid) => (ofertasPorItem.get(item) || []).some(o => o.pid === pid && ['started', 'pending'].includes(o.status))
  for (const [item, av] of avaliacoes) {
    // o hedge só existe por causa da âncora: se o dono recusou a âncora, o analista já descartou o hedge (aplicarHumanos) — perguntar "sem decisão sua" dele seria ruído
    for (const m of av.marcaria) if (!(m.ancora && recusas.has(chave(item, m.ancora)))) add(marcaria, item, m.pid)
    if (av.relampago.marcaria) add(marcaria, item, av.relampago.marcaria.pid)
  }
  const revisaoFeita = hum.length > 0 || aprov.length > 0
  const itens = []
  let concordam = 0
  const nomeDe = (item, pid) => camps.get(pid)?.nome || (ofertasPorItem.get(item) || []).find(o => o.pid === pid)?.nome || pid
  const mcDe = (av, pid) => [...(av?.candidatos || []), ...(av?.relampago.candidatos || [])].find(c => c.pid === pid)?.mcPct ?? null
  for (const item of new Set([...marcasDono.keys(), ...marcaria.keys()])) {
    const H = marcasDono.get(item) || new Set(), A = marcaria.get(item) || new Set(), av = avaliacoes.get(item), a = anun.get(item) || {}
    const base = pid => ({ item_id: item, sku: a.sku || '', titulo: a.titulo || '', pid, campanha: nomeDe(item, pid), piso: av?.relampago.candidatos.some(c => c.pid === pid) ? av.pisoRelampago : av?.piso })   // relâmpago tem piso próprio (19%)
    for (const pid of H) if (A.has(pid)) concordam++
    for (const pid of H) if (!A.has(pid) && !noAr(item, pid)) {
      const ex = explicarNaoMarcaria(av, pid, ofertasPorItem.get(item) || [], camps)
      itens.push({ ...base(pid), tipo: 'ele_marcou', codigo: ex.codigo, mcPct: ex.mcPct ?? mcDe(av, pid), explicacao: ex.explicacao })
    }
    // "eu marcaria" só cala quando o dono já decidiu NA MESMA trilha (marca só no relâmpago não responde pela trilha da API, e vice-versa)
    for (const pid of A) {
      if (donoTrilha.has(`${item}|${av?.relampago.marcaria?.pid === pid ? 'painel' : 'api'}`)) continue
      if (recusas.has(chave(item, pid))) itens.push({ ...base(pid), tipo: 'eu_marcaria', codigo: 'recusa', mcPct: mcDe(av, pid), explicacao: 'recusa explícita' })
      else if (revisaoFeita) itens.push({ ...base(pid), tipo: 'eu_marcaria', codigo: 'sem_decisao', mcPct: mcDe(av, pid), explicacao: 'sem decisão após a revisão' })
    }
  }
  const respondida = i => aprendizados.find(x => x.ativo && x.padrao === i.codigo && (x.escopo_tipo === 'global' || (x.escopo_tipo === 'item' && x.escopo_valor.toUpperCase() === i.item_id.toUpperCase()) || (x.escopo_tipo === 'sku' && i.sku && x.escopo_valor.toLowerCase() === i.sku.toLowerCase())))
  const abertas = [], respondidas = []
  for (const i of itens) { const p = PADROES[i.codigo] || PADROES.outro; const x = { ...i, pergunta: p.pergunta(i) }; const r = respondida(i); r ? respondidas.push({ ...x, respondida_por: r.id }) : abertas.push(x) }
  const grupos = new Map()
  for (const i of abertas) { if (!grupos.has(i.codigo)) grupos.set(i.codigo, { padrao: i.codigo, tipo: i.tipo, titulo: (PADROES[i.codigo] || PADROES.outro).titulo, itens: [] }); grupos.get(i.codigo).itens.push(i) }
  const lista = [...grupos.values()].map(g => ({ ...g, n: g.itens.length })).sort((x, y) => y.n - x.n)
  const total = concordam + itens.length
  return {
    revisaoFeita, concordam, divergem: itens.length, total, respondidas: respondidas.length, grupos: lista,
    resumoTexto: total ? `Concordamos em ${concordam} de ${total}. Divergimos em ${itens.length}${lista.length ? `, agrupados em ${lista.length} padrão(ões)` : ''}${respondidas.length ? ` (${respondidas.length} já respondidas em aprendizados)` : ''}.` : 'Ainda não há marcações para comparar.',
  }
}

// ── INVARIANTE da rodada: três zeros provados por read-back (contagens) + "o analista rodou SOBRE ESTA coleta" ────────────
// decisoes/alertas = o que está GRAVADO; avaliacoes/vigias/efetivas = recálculo fresco. Divergência = rodada não terminou.
// Só vale o que foi gravado pela rodada `rodada` (marcador { rodada_id, coleta_id }) e só se essa rodada é da coleta atual (`coletaId`):
// decisão/alerta de coleta anterior NÃO prova nada. Marca 👤 decide a trilha; recusa 👤 decide só a campanha recusada (o resto precisa de linha do analista).
// `entrada` = entradaSelo(...) do estado ATUAL ({ hash, partes }); `rodada.entrada_hash/entrada_partes` = o selo gravado no marcador. Divergência (ou marcador sem selo) = rodada desatualizada.
// Sem `entrada` (chamada pura de teste) o selo não é conferido.
export function invariante({ avaliacoes, vigias, decisoes, alertas, efetivas = [], coletaFresca = true, coletaId = null, rodada = null, entrada = undefined }) {
  const trilhaDe = d => (d.via === 'painel' ? 'painel' : 'api')
  const rodouNaColeta = !!(rodada?.rodada_id && coletaId && rodada.coleta_id === coletaId)
  const daRodada = x => rodouNaColeta && x.rodada_id === rodada.rodada_id
  const igual = (x, y) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.005)
  const mesmaMarca = (d, r) => d.pid === r.pid && d.regra === r.regra && igual(d.preco, r.preco) && igual(d.mc_pct, r.mc_pct)      // número gravado = número recalculado (preço E MC%)
  const decidido = (item, trilha) => {
    if (decisoes.some(d => d.origem === 'humano' && d.marcado && d.pid && d.item_id === item && trilhaDe(d) === trilha)) return true      // 👤 marcou: o bloco é dele
    const linhas = decisoes.filter(d => d.origem === 'analista' && daRodada(d) && d.item_id === item && trilhaDe(d) === trilha)
    const gravadas = linhas.filter(d => d.marcado && d.pid)
    const esperadas = efetivas.filter(r => r.item_id === item && trilhaDe(r) === trilha)
    if (esperadas.length) return esperadas.length === gravadas.length && esperadas.every(r => gravadas.some(d => mesmaMarca(d, r)))    // o conjunto gravado = o recálculo
    return !gravadas.length && linhas.some(d => !d.marcado && d.regra === 'SEM_MARCA' && d.motivo)
  }
  const A = []
  let ge = 0
  for (const [item, av] of avaliacoes) {
    if (av.elegiveisPiso.length) { ge++; if (!decidido(item, 'api')) A.push(item) }
    if (av.relampago.elegiveisPiso.length) { ge++; if (!decidido(item, 'painel')) A.push(`${item} (relâmpago)`) }
  }
  const comAlerta = tipo => new Set(alertas.filter(a => a.tipo === tipo && daRodada(a)).map(a => a.chave || a.item_id))
  const cobAlert = comAlerta('cobertura'), rpAlert = comAlerta('rebate_pior')
  const janelas = vigias.coberturaJanelas
  const B = janelas.flatMap(j => j.alertas.filter(x => !cobAlert.has(chaveCobertura(x.item_id, j.dias))).map(x => `${x.item_id} (${j.dias}d)`))
  // contagem por ANÚNCIO DISTINTO na janela principal (a da tela, = KPI "Descobertos"); a outra janela vai à parte — somar 7d+14d contaria o mesmo protegido duas vezes
  const jp = janelas.find(j => j.dias === vigias.cobertura?.dias) || janelas[0]
  const descP = [...new Set((jp?.alertas || []).map(x => x.item_id))]
  const C = vigias.rebatePior.filter(x => !rpAlert.has(x.chave)).map(x => x.chave)
  // checagem INVERSA: toda marca do analista gravada nesta rodada tem de existir no recálculo (pid, regra, preço, MC%). Custo/piso/regra que mudam depois da rodada
  // tiram a campanha das elegíveis, e o laço de cima nem visita mais o item — a linha velha ficaria "aprovável" e passaria pelo plano
  const D = decisoes.filter(d => d.origem === 'analista' && daRodada(d) && d.marcado && d.pid && !efetivas.some(r => r.item_id === d.item_id && trilhaDe(r) === trilhaDe(d) && mesmaMarca(d, r))).map(d => `${d.item_id}:${d.pid}`)
  const mudou = entrada === undefined || !rodouNaColeta ? [] : !rodada.entrada_hash ? ['rodada sem selo das entradas (gravada por versão anterior)']
    : rodada.entrada_hash === entrada.hash ? [] : Object.keys(entrada.partes).filter(k => rodada.entrada_partes?.[k] !== entrada.partes[k])
  const itens = [
    { id: 'elegiveis_sem_decisao', rotulo: 'elegíveis ≥ piso sem decisão', esperado: 0, encontrado: A.length, ids: A },
    { id: 'protegidos_sem_alerta', rotulo: `protegidos descobertos sem alerta (janelas ${janelas.map(j => j.dias + 'd').join(' e ')})`, esperado: 0, encontrado: B.length, ids: B },
    { id: 'rebate_pior_sem_mencao', rotulo: 'rebate pior no ar sem menção', esperado: 0, encontrado: C.length, ids: C },
    { id: 'analista_fora_da_coleta', rotulo: 'analista não rodou sobre esta coleta', esperado: 0, encontrado: rodouNaColeta ? 0 : 1, ids: rodouNaColeta ? [] : [rodada?.coleta_id ? `última rodada é da coleta ${rodada.coleta_id}` : 'nenhuma rodada gravada'] },
    { id: 'marca_desatualizada', rotulo: 'marca gravada que o recálculo não reproduz', esperado: 0, encontrado: D.length, ids: D },
    { id: 'rodada_desatualizada', rotulo: 'rodada desatualizada: o que decide mudou depois dela (refaça o analista)', esperado: 0, encontrado: mudou.length ? 1 : 0, ids: mudou },
  ]
  return {
    ok: itens.every(i => i.encontrado === 0) && !!coletaFresca, coleta_fresca: !!coletaFresca, analista_rodou_na_coleta: rodouNaColeta, itens,
    readback: { elegiveis_ge_piso: ge, elegiveis_sem_decisao: A.length, protegidos_descobertos: descP.length, com_alerta_cobertura: descP.filter(i => cobAlert.has(chaveCobertura(i, jp.dias))).length, janela_principal: jp?.dias ?? null,
      outras_janelas: janelas.filter(j => j !== jp).map(j => ({ dias: j.dias, descobertos: new Set(j.alertas.map(x => x.item_id)).size })), janelas: janelas.map(j => ({ dias: j.dias, descobertos: j.alertas.length })), rebate_pior: vigias.rebatePior.length, com_mencao: vigias.rebatePior.length - C.length },
  }
}
// alertas de cobertura GRAVÁVEIS: uma linha por (anúncio × janela) — a janela entra na chave única (7 e 14 dias não se sobrescrevem)
export const alertasCobertura = vigias => vigias.coberturaJanelas.flatMap(j => j.alertas.map(a => ({ ...a, janela_dias: j.dias, chave: chaveCobertura(a.item_id, j.dias) })))
// o que o read-back espera encontrar em promo_alerta (cobertura × janela + rebate pior)
export const alertasDeVigias = vigias => [...alertasCobertura(vigias).map(a => ({ tipo: 'cobertura', chave: a.chave, item_id: a.item_id })), ...vigias.rebatePior.map(a => ({ tipo: 'rebate_pior', chave: a.chave, item_id: a.item_id }))]

// ── SELO das entradas que decidem: gravado no marcador da rodada e recomparado no read-back ──────────────────────────
// Config (pisos, imposto, janelas, hedge), custos efetivos (por SKU + percentuais do cliente + tarifa do anúncio), regras por SKU, aprendizados IGNORAR ativos,
// marcas/recusas 👤, ofertas/campanhas coletadas e o estado dos anúncios (curva, protegido, status). Mudou qualquer uma depois da rodada => rodada desatualizada.
// `partes` diz QUAL mudou. Não entra o que não decide (execução, notas, carimbos de data, estado 'executada' da marca).
const selar = v => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)
const ordenada = lista => lista.map(x => JSON.stringify(x)).sort()
export function entradaSelo({ config, anuncios, ofertasPorItem, campanhas, regrasSku = [], aprendizados = [], custosSku = new Map(), custosCliente = null }, decisoes) {
  const camps = campanhas instanceof Map ? [...campanhas.values()] : campanhas
  // vínculo de custo que difere do SKU exato (manual, normalizado, grupo ou "não é este" que tirou o exato) entra no selo: mudar vínculo = rodada desatualizada.
  // Sem nenhum, o selo é o de antes (rodadas gravadas não ficam desatualizadas só pela versão nova).
  const vinc = anuncios.filter(a => a.custo_resolvido !== undefined && (a.custo_resolvido ? a.custo_resolvido.origem !== 'sku' : custosSku.has(String(a.sku || '').toLowerCase())))
    .map(a => [a.item_id, a.custo_resolvido?.chave ?? '', a.custo_resolvido?.origem ?? 'sem_custo'])
  const partes = {
    config: selar(['piso_mc', 'piso_relampago', 'imposto_pct', 'dias_vigia', 'janela_cobertura_dias', 'hedge_cobertura'].map(k => config[k] ?? null)),
    custos: selar([ordenada([...custosSku]), custosCliente || null, ...(vinc.length ? [ordenada(vinc)] : [])]),
    regras: selar(ordenada(regrasSku.map(r => [String(r.mlb || '').toUpperCase(), String(r.sku || '').toLowerCase(), r.status]))),
    aprendizados: selar(ordenada(aprendizados.filter(a => a.ativo && a.acao === 'ignorar').map(a => [a.escopo_tipo, String(a.escopo_valor).toLowerCase()]))),
    marcas_humanas: selar(ordenada(decisoes.filter(d => d.origem === 'humano' && d.pid).map(d => [d.item_id, d.pid, d.marcado ? 1 : 0, d.via === 'painel' ? 'painel' : 'api']))),
    ofertas: selar([ordenada([...ofertasPorItem.values()].flat().map(o => [o.item_id, o.pid, o.offer_id, o.tipo, o.nome, o.status, o.preco, o.preco_original, o.meli_pct, o.inicio, o.fim])),
      ordenada(camps.map(c => [c.pid, c.nome, c.status, c.inicio, c.fim, c.rebate ? 1 : 0, c.relampago ? 1 : 0]))]),
    anuncios: selar(ordenada(anuncios.map(a => [a.item_id, a.sku, a.status, a.sub_status, a.under_review ? 1 : 0, a.protegido ? 1 : 0, a.curva, a.preco, a.preco_original, a.lido_em, a.oferta_erro, a.tarifa ?? null]))),
  }
  return { hash: selar(partes), partes }
}

// ════════════════ envoltórios com banco ════════════════
export async function carregarEntrada(cliente, deps = {}) {
  const hoje = deps.hoje || repo.hojeLocal()
  const config = repo.getConfig(cliente)
  const fat = repo.faturamento30(cliente, hoje)
  const anuncios = repo.lerAnuncios(cliente)
  const curvas = curvaABC([...new Set([...fat.porItem.keys(), ...anuncios.map(a => a.item_id)])].map(id => ({ id, fat: fat.porItem.get(id)?.fat || 0 })))
  for (const a of anuncios) { const c = curvas.get(a.item_id); a.fat30 = c?.fat || 0; a.unid30 = fat.porItem.get(a.item_id)?.unid || 0; a.curva = c?.curva || 'C' }
  const custosSku = custosEfetivos(cliente)      // manual > bling > tiny > sheets (custos-db.js); quarentena e custo ≤ 0 nunca entram
  const resolvidos = vinculosCusto.custosDosAnuncios(cliente, anuncios)       // o custo de CADA anúncio (vínculo manual, SKU, SKU normalizado, grupo)
  for (const a of anuncios) a.custo_resolvido = resolvidos.get(a.item_id) || null
  let custosCliente = null
  if (deps.custosCliente !== undefined) custosCliente = deps.custosCliente
  else if (!repo.EM_MEMORIA) custosCliente = (await import('./diagnostico-conta.js')).custosDoCliente(cliente)
  const ofertasPorItem = repo.agruparPorItem(repo.lerOfertas(cliente))
  return {
    hoje, config, anuncios, campanhas: new Map(repo.lerCampanhas(cliente).map(c => [c.pid, c])), ofertasPorItem,
    regrasSku: repo.listarRegrasSku(cliente), aprendizados: repo.listarAprendizados(cliente, { soAtivos: true }), custosSku, custosCliente, recusas: repo.recusasHumanas(cliente),
    marcasHumanas: marcasHumanasVivas(repo.lerDecisoes(cliente), anuncios, ofertasPorItem),      // 👤 que ainda vinculam (campanha candidata/ativa): o vigia as respeita mesmo em IGNORAR/Revisar
    vendas: { disponivel: fat.disponivel, ate: fat.vendasAte, motivo: fat.motivo || '', cobertura: fat.cobertura || null },
  }
}

// a marca "humana" também cobre o vigia; marcas do analista só valem enquanto forem as efetivas
const marcasDe = (efetivas, decisoes) => {
  const m = new Map(), add = (i, p) => { if (!m.has(i)) m.set(i, new Set()); m.get(i).add(p) }
  for (const r of efetivas) add(r.item_id, r.pid)
  for (const d of decisoes) if (d.origem === 'humano' && d.marcado && d.pid) add(d.item_id, d.pid)
  return m
}

export async function rodarAnalista(cliente, { aplicar = false, por = 'analista', deps = {} } = {}) {      // (o antigo "permitir coleta velha" foi aposentado: contrato (a) — só se aplica sobre coleta concluída E fresca)
  const coleta = repo.lerColeta(cliente)
  if (!coleta) throw erro('nenhuma coleta feita para este cliente — rode a coleta de promoções primeiro', 409)
  // contrato (a): só se APLICA sobre coleta 'concluida' (todas as leituras essenciais com sucesso) e fresca (<12h) — 'parcial'/'erro'/'rodando' e foto velha nunca
  if (aplicar && coleta.estado !== 'concluida') throw erro(`última coleta: ${coleta.estado} — o analista só aplica sobre coleta CONCLUÍDA (todas as leituras essenciais com sucesso): refaça a coleta`, 409)
  const entrada = await carregarEntrada(cliente, deps)
  const fresca = repo.coletaFresca(cliente, 12, deps.agoraMs)
  if (aplicar && !fresca.fresca) throw erro(`${fresca.motivo} — o analista não analisa foto velha: refaça a coleta`, 409)
  const decisoes = repo.lerDecisoes(cliente)
  const base = analisar(entrada)
  const vivas = entrada.marcasHumanas || marcasHumanasVivas(decisoes, entrada.anuncios, entrada.ofertasPorItem)
  const { efetivas, ignoradas, liberadas } = aplicarHumanos(base.recomendacoes, decisoes, entrada.recusas, vivas)
  const dono = semLiberadas(decisoes, liberadas)                                           // 👤 de campanha encerrada já não é "marca do dono" (nem para o vigia, nem para o invariante)
  const res = analisar({ ...entrada, marcasHumanas: vivas, marcasPorItem: marcasDe(efetivas, dono) })       // vigia de cobertura enxerga as marcas efetivas
  // anúncio liberado: a linha gravada explica por que o analista voltou a decidir nele (a marca 👤 antiga continua no banco, intacta)
  const liberado = new Set(liberadas.map(d => `${d.item_id}|${d.via === 'painel' ? 'painel' : 'api'}`))
  const nota = (item, via, texto) => (liberado.has(`${item}|${via === 'painel' ? 'painel' : 'api'}`) ? [texto, NOTA_LIBERADA].filter(Boolean).join(' — ') : texto)
  const linhas = efetivas.map(r => ({ ...r, obs: nota(r.item_id, r.via, r.obs), marcado: true }))
  const hum = new Map(); for (const i of ignoradas) { const k = `${i.item_id}|${i.via}`; hum.set(k, i.porque) }
  for (const [item, av] of res.avaliacoes) {
    const temNormal = efetivas.some(r => r.item_id === item && r.via !== 'painel'), temRel = efetivas.some(r => r.item_id === item && r.via === 'painel')
    const normal = av.candidatos.length > 0 || ['under_review', 'inativo', 'pausado', 'ignorar', 'revisar_toda_rodada'].includes(av.estado)
    if (!temNormal && normal) linhas.push({ item_id: item, pid: '', marcado: false, regra: 'SEM_MARCA', via: 'api', motivo: nota(item, 'api', hum.get(`${item}|api`) === 'humano_recusou' ? 'recusado pelo dono (👤) — não será re-sugerido' : av.motivoSemMarca?.texto || 'sem marca'), obs: av.avisoP || '' })
    if (!temRel && av.relampago.candidatos.length) linhas.push({ item_id: item, pid: '~relampago', marcado: false, regra: 'SEM_MARCA', via: 'painel', motivo: nota(item, 'painel', hum.get(`${item}|painel`) === 'humano_recusou' ? 'recusado pelo dono (👤)' : av.relampago.motivoSemMarca?.texto || 'sem marca'), obs: '' })
  }
  const interrogatorio = interrogar({ avaliacoes: res.avaliacoes, decisoes, anuncios: entrada.anuncios, aprendizados: entrada.aprendizados, ofertasPorItem: entrada.ofertasPorItem, campanhas: entrada.campanhas })
  const saida = { aplicado: false, coleta: fresca, resumo: res.resumo, recomendacoes: efetivas, ignoradas_por_humano: ignoradas, marcas_humanas_liberadas: liberadas.map(d => ({ item_id: d.item_id, pid: d.pid, via: d.via })), vigias: res.vigias, interrogatorio, vendas: entrada.vendas }
  const selo = entradaSelo(entrada, decisoes)
  if (!aplicar) {
    // projeção: "se eu aplicasse agora" — a rodada hipotética é da coleta atual
    const proj = [...dono.filter(d => d.origem === 'humano'), ...linhas.map(l => ({ ...l, origem: 'analista', rodada_id: 'projecao' }))]
    const alertas = alertasDeVigias(res.vigias).map(a => ({ ...a, rodada_id: 'projecao' }))
    return { ...saida, invariante: { ...invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: proj, alertas, efetivas, coletaFresca: fresca.fresca, coletaId: coleta.coleta_id, rodada: { rodada_id: 'projecao', coleta_id: coleta.coleta_id, entrada_hash: selo.hash, entrada_partes: selo.partes }, entrada: selo }), readback_gravado: false } }
  }
  const atual = repo.lerColeta(cliente)          // a coleta não pode ter mudado entre a leitura da entrada e a gravação (senão a rodada carimbaria dados de outra coleta)
  if (atual?.coleta_id !== coleta.coleta_id || atual.estado !== 'concluida') throw erro('a coleta mudou durante a análise — rode o analista de novo sobre a coleta atual', 409)
  const rodadaId = Date.now().toString(36)
  const antes = repo.lerDecisoes(cliente).filter(d => d.origem === 'analista')
  const troca = repo.substituirDecisoesAnalista(cliente, linhas, rodadaId, por)
  repo.substituirAlertas(cliente, 'cobertura', alertasCobertura(res.vigias), rodadaId)
  repo.substituirAlertas(cliente, 'rebate_pior', res.vigias.rebatePior, rodadaId)
  repo.substituirAlertas(cliente, 'lembrete', res.vigias.lembretes.map(l => ({ ...l, chave: l.item_id })), rodadaId)
  repo.substituirAlertas(cliente, 'sem_custo', res.vigias.semCusto.map(l => ({ ...l, chave: l.item_id })), rodadaId)
  repo.substituirAlertas(cliente, 'under_review', res.vigias.underReview.map(l => ({ ...l, chave: l.item_id })), rodadaId)
  // marcador da rodada, gravado POR ÚLTIMO: liga decisões/alertas (rodada_id) à coleta (coleta_id). Sem ele — ou com o de outra coleta — o read-back fica vermelho
  // + o selo das entradas (config, custos, regras, aprendizados, marcas 👤, ofertas): o read-back o recompara — mudou depois da rodada = vermelho
  repo.substituirAlertas(cliente, 'rodada', [{ chave: 'analista', coleta_id: coleta.coleta_id, concluida_em: coleta.concluida_em, janelas: janelasVigia(entrada.config), rodada_id: rodadaId, entrada_hash: selo.hash, entrada_partes: selo.partes }], rodadaId)
  repo.auditar(cliente, 'analista', { autor: por, antes: { marcas: antes.filter(d => d.marcado).length }, depois: { marcas: efetivas.length, ...res.resumo }, detalhe: `rodada ${rodadaId} · coleta ${coleta.coleta_id}` })
  return { ...saida, aplicado: true, rodada_id: rodadaId, aprovacoes_revogadas: troca?.aprovacoes_revogadas ?? 0, invariante: { ...(await lerInvariante(cliente, deps)), readback_gravado: true } }
}

// read-back: relê TUDO do banco e recalcula do zero — não confia no que o analista acabou de calcular
export async function lerInvariante(cliente, deps = {}) {
  const entrada = deps.entrada || await carregarEntrada(cliente, deps)
  const decisoes = repo.lerDecisoes(cliente)
  const vivas = entrada.marcasHumanas || marcasHumanasVivas(decisoes, entrada.anuncios, entrada.ofertasPorItem)
  const { efetivas, liberadas } = aplicarHumanos(analisar(entrada).recomendacoes, decisoes, entrada.recusas, vivas)
  const dono = semLiberadas(decisoes, liberadas)
  const res = analisar({ ...entrada, marcasHumanas: vivas, marcasPorItem: marcasDe(efetivas, dono) })
  const todos = repo.lerAlertas(cliente)
  const alertas = todos.map(a => ({ tipo: a.tipo, chave: a.chave, item_id: a.item_id, rodada_id: a.rodada_id }))
  const marcador = todos.find(a => a.tipo === 'rodada' && a.chave === 'analista')
  return invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: dono, alertas, efetivas, coletaFresca: repo.coletaFresca(cliente, 12, deps.agoraMs).fresca,
    coletaId: repo.lerColeta(cliente)?.coleta_id || null, entrada: entradaSelo(entrada, decisoes),
    rodada: marcador ? { rodada_id: marcador.rodada_id, coleta_id: marcador.detalhe?.coleta_id || null, entrada_hash: marcador.detalhe?.entrada_hash || null, entrada_partes: marcador.detalhe?.entrada_partes || null } : null })
}
