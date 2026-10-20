// Ligação do módulo Ofertas Estratégicas com o MOTOR ÚNICO (CLAUDE.md, "Princípio inegociável"): o módulo não decide prioridade nem responsável sozinho.
//  • o job vira — ou se LIGA a — uma ação do plano (acoes_plano) calculada por plano-anuncios.acaoDeOferta: mesma fórmula de prioridade, prior calibrado por
//    família (calibracao.priorEfetivo), fator do Merovíngio (retroalimentar), roteiro do Manual e sequência lógica;
//  • ação do plano equivalente que já existe para o mesmo anúncio (ímã, fotos, frete, catálogo, duplicação) recebe o job em vez de nascer outra;
//  • responsável padrão = ficha do cliente (papel conforme o escopo) > melhor profissional com prova medida > analista da conta.
// Injetado em criarFluxo({ motor }): ofertas-fluxo.js continua sem banco no import (os autotestes do fluxo seguem em memória pura).
import { db, hojeLocal, agora } from './db.js'
import { acaoDeOferta, salvarAcaoOferta, VIA_OFERTA, tipoDaRegra } from './plano-anuncios.js'
import { regraDoJob } from './ofertas.js'
import { retroalimentar } from './retroalimentacao.js'
import { melhorProfissional } from './melhor-profissional.js'
import { ficha } from './ficha-cliente.js'
import { analistaDaConta } from './placeplan.js'
import { algoritmo } from './diagnostico-conta.js'

const VIVAS = ['proposta', 'aprovada', 'distribuida']
const hidratar = r => r ? { ...r, dados: JSON.parse(r.dados_json || '{}'), dados_json: undefined } : null

// ponytail: cache de 10 min por cliente/dia — retroalimentar é a MESMA função do plano (estado da conta, aprendizado por família, protegidos); abrir job não refaz
// a base inteira a cada clique. Sem série/erro → fator neutro (a lógica da ação diz que não houve retroalimentação).
const cacheRetro = new Map()
function retroDe(cliente, hoje) {
  const k = `${cliente}|${hoje}`, hit = cacheRetro.get(k)
  if (hit && Date.now() - hit.em < 10 * 60_000) return hit.r
  let r = null
  try { const x = retroalimentar(cliente, { hoje }); if (x.disponivel) r = x } catch { /* sem retroalimentação: fator neutro */ }
  cacheRetro.set(k, { em: Date.now(), r })
  return r
}

export function criarMotorOfertas({ hoje = hojeLocal, retro = retroDe } = {}) {
  const acaoDoPlano = (cliente, id) => hidratar(db.prepare('SELECT * FROM acoes_plano WHERE id = ? AND cliente = ?').get(String(id || ''), cliente))
  const viaOferta = regra => VIA_OFERTA[String(regra || '').replace(/^anuncio_/, '')] || null
  const demandaDaRegra = regra => algoritmo.regras.find(r => r.id === String(regra || '').replace(/^anuncio_/, ''))?.tipo_demanda || ''
  // abrir o job é a decisão humana sobre a ação: só 'proposta' vira 'aprovada' (distribuída/descartada não mudam)
  const aprovar = (cliente, id) => db.prepare("UPDATE acoes_plano SET status = 'aprovada', atualizado_em = ? WHERE id = ? AND cliente = ? AND status = 'proposta'").run(agora(), id, cliente)
  // ação do plano equivalente: mesmo anúncio, regra que o módulo executa no MESMO escopo; a de duplicação só para o job que É a duplicação (original intacto)
  function equivalente(cliente, item_id, escopo, duplicacao) {
    const e = escopo === 'imagem_avulsa' ? 'galeria' : escopo
    const regras = Object.entries(VIA_OFERTA).filter(([, v]) => v.escopo === e && !!v.duplicacao === duplicacao).map(([r]) => 'anuncio_' + r)
    if (!item_id || !regras.length) return null
    return hidratar(db.prepare(`SELECT * FROM acoes_plano WHERE cliente = ? AND item_id = ? AND regra IN (${regras.map(() => '?').join(',')}) AND status IN (${VIVAS.map(() => '?').join(',')}) ORDER BY score DESC LIMIT 1`)
      .get(cliente, item_id, ...regras, ...VIVAS))
  }
  // ligada a uma ação do algoritmo → fica como está (o plano a recalcula); ligada a uma oferta_* → recalculada com o diagnóstico novo (mesmo id);
  // sem ligação → equivalente viva ou nova ação da regra oferta_* (id = hash cliente|regra|item|mês)
  function sincronizar({ cliente, job, item = null, baseline = {}, diagnostico = {} }) {
    const ligada = job.acao_id ? acaoDoPlano(cliente, job.acao_id) : null
    const existente = ligada ? (ligada.regra.startsWith('anuncio_oferta_') ? null : ligada) : equivalente(cliente, item?.id, job.escopo, !!job.dados?.duplicacao)
    if (existente) {
      aprovar(cliente, existente.id)
      const regra = existente.regra.replace(/^anuncio_/, '')
      return { acao: acaoDoPlano(cliente, existente.id), ligacao: 'existente', regra, tipo: tipoDaRegra(regra) }
    }
    const regra = String(job.dados?.regra || '').startsWith('oferta_') ? job.dados.regra : regraDoJob({ ...job, dados: {} })
    const a = acaoDeOferta(cliente, { regra, job, item, baseline, diagnostico, hoje: hoje(), retro: retro(cliente, hoje()), acao_id: ligada?.id || '' })
    const s = salvarAcaoOferta(a, { delegado_a: job.responsavel || '' })
    return { acao: acaoDoPlano(cliente, a.id), ligacao: s.novo ? 'criada' : s.atualizada ? 'atualizada' : `mantida (${s.status})`, regra, tipo: tipoDaRegra(regra) }
  }
  // responsável padrão do job: ficha do cliente (imagem → apoio; resto → analista) > melhor profissional com PROVA medida > analista da conta (90 dias)
  function responsavelPadrao({ cliente, escopo, demanda }) {
    const papel = ['galeria', 'imagem_avulsa'].includes(escopo) ? 'apoio' : 'analista'
    let mp = null
    try { mp = melhorProfissional({ demanda, cliente }) } catch { /* medição indisponível: segue a ordem */ }
    const ranking = { familia: mp?.familia || null, aviso: mp ? mp.aviso : 'medição indisponível: ranking não calculado', topo: (mp?.ranking || []).slice(0, 3).map(x => ({ nome: x.nome, score: x.score, n: x.n, melhorou: x.melhorou, prova: x.prova, mediana_dias: x.mediana_dias, evidencia: x.evidencia })) }
    const noPapel = ficha.prestadorDaFicha(cliente, 'ML', papel), f = noPapel || (papel !== 'analista' ? ficha.prestadorDaFicha(cliente, 'ML', 'analista') : null)
    if (f) return { nome: f.nome, origem: `ficha do cliente (papel ${noPapel ? papel : 'analista'}${f.canal ? ', canal ' + f.canal : ', todos os canais'})`, ranking }
    if (mp?.recomendado) return { nome: mp.recomendado.nome, origem: mp.recomendado.motivo, ranking }
    let an = null
    try { an = analistaDaConta(cliente) } catch { /* sem histórico de tarefas */ }
    const c = an?.por_canal?.['Mercado Livre'] || an?.geral
    if (c) return { nome: c.oficial || c.nome_notion, origem: `analista da conta (${c.tarefas_90d} tarefa(s) do cliente em 90 dias)`, ranking }
    return { nome: '', origem: 'sem ficha, sem prova medida e sem analista recente: definir o responsável', ranking }
  }
  return { acaoDoPlano, viaOferta, demandaDaRegra, sincronizar, responsavelPadrao }
}
