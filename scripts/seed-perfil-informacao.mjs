// Seed do PERFIL DE INFORMAÇÃO com o feedback curado pela equipe em 13/10/2026 (src/lib/perfil-informacao.js). Prévia por padrão; grava só com --confirmar.
//   node scripts/seed-perfil-informacao.mjs              → prévia: abre data/db.sqlite SÓ-LEITURA (sem migração, nada gravado); quem registra é validado no --confirmar
//   node scripts/seed-perfil-informacao.mjs --confirmar  → abre pelo db.js (migrações aditivas: perfil_informacao/_hist, feedback_relatorio.origem), valida quem registra
//                                                          (líder/consultor/CS) e grava TUDO numa transação: perfil + histórico + nota no livro; feedback curado em
//                                                          feedback_relatorio (origem 'equipe', status 'revisado', sem telefone) + resposta_cliente no livro.
// Idempotente: rodar de novo não grava nada (perfil igual = sem mudança; feedback por (dia, cliente)). Nunca cria cliente: nome fora da central = pulado.
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from '../src/lib/env.js'
import { criarPerfilInformacao, lerConfig, paraFeedback } from '../src/lib/perfil-informacao.js'

export const POR = 'David do Valle', DIA = '2026-10-13'
const TODOS = Object.keys(lerConfig().temas)
// nome exato da central → serviço, temas EM ORDEM, nível, observação (≤ 500) e o feedback como a equipe o colheu (texto ≤ 2000; extras = temas de resposta além dos do perfil)
export const SEED = [
  { cliente: 'Minas Geral Comercial', servico: 'assessoria', temas: ['vendas', 'estoque_reposicao', 'anuncios_performance'], nivel: 'padrao',
    observacao: 'Acompanhar desempenho das vendas, níveis de estoque e reposição, situação e performance dos anúncios.',
    feedback: { texto: 'Demonstrou interesse em receber informações sobre vendas, estoque e reposição e anúncios. Busca acompanhar o desempenho das vendas, controlar os níveis de estoque e reposição e saber a situação e a performance dos anúncios.' } },
  { cliente: 'Trem Chique Ltda', servico: 'assessoria', temas: ['vendas', 'estoque_reposicao', 'causa_efeito', 'acoes_realizadas'], nivel: 'padrao',
    observacao: 'Entender o desempenho, os motivos por trás dos resultados e quais medidas estão sendo aplicadas.',
    feedback: { texto: 'Demonstrou interesse em acompanhar vendas, reposição de estoque, a relação de causa e efeito nos resultados e as ações que estão sendo realizadas na conta. Busca entender o desempenho da operação, os motivos por trás dos resultados e quais medidas estão sendo aplicadas para melhorar a conta.' } },
  { cliente: 'LS Importados', servico: 'consultoria', temas: ['anuncios_performance', 'concorrencia'], nivel: 'padrao',
    observacao: 'Como os anúncios estão posicionados em relação aos concorrentes e preços do mercado; oportunidades de melhoria.',
    feedback: { texto: 'Demonstrou interesse em receber informações sobre desempenho e situação dos anúncios, análise da concorrência e comparação com os anúncios e preços praticados no mercado. Busca entender como os anúncios estão posicionados em relação aos concorrentes e quais oportunidades de melhoria existem.' } },
  { cliente: 'Master Cogumelos', servico: 'assessoria', temas: TODOS, nivel: 'didatico',
    observacao: 'Ainda sem experiência; quer aprender e analisar os dados conforme recebe; aberto a treinamentos e explicações detalhadas. Quer o mais completo possível.',
    feedback: { texto: 'Prefere receber as informações da forma mais completa possível. Ainda não tem experiência no assunto e pretende aprender e analisar os dados conforme receber os materiais e orientações. Está aberto a treinamentos e explicações detalhadas: precisa de acompanhamento completo e didático, com informação organizada, contexto e orientação.' } },
  { cliente: 'Bee Bikini & Fitness', servico: 'consultoria', temas: ['anuncios_performance', 'ads', 'promocoes', 'acoes_vendas'], nivel: 'padrao',
    observacao: 'Estratégias de divulgação e conversão para aumentar vendas.',
    feedback: { texto: 'Sugeriu apresentar anúncios, Ads, promoções e ações para aumentar as vendas. Interesse em estratégias de divulgação e conversão para melhorar o volume de vendas.' } },
  { cliente: 'Photo K', servico: 'assessoria', temas: [], nivel: 'padrao',
    observacao: 'Feedback positivo; boa receptividade à nova fase.',
    feedback: { texto: 'Demonstrou satisfação e entusiasmo com a nova fase e considerou a participação importante para a operação.', extras: ['elogio'] } },
  { cliente: 'Agrinorte', servico: 'assessoria', temas: ['vendas', 'estoque_reposicao', 'anuncios_performance'], nivel: 'padrao',
    observacao: 'Visão mais analítica: estatísticas de vendas, anúncios com estoque baixo e anúncios que não performam (precisam de atenção).',
    feedback: { texto: 'Demonstrou interesse em acompanhar estatísticas de vendas, anúncios com estoque baixo, anúncios que não estão performando e os indicadores mencionados antes. Apontou uma falha: o item que vendeu muito não foi mencionado para repor estoque (Pistão 170).',
      extras: ['critica'], nota: 'Pistão 170: estoque 10 un, cerca de 0,43 un/dia (cerca de 23 dias de cobertura); ponto de reposição 9 com prazo de 21 dias. Faltou margem de segurança na régua de reposição.' } },
  { cliente: 'Ouro Cão Pet Shop', servico: 'consultoria', temas: ['ads', 'promocoes', 'anuncios_criacao_melhoria'], nivel: 'padrao',
    observacao: 'Estratégias comerciais para aumentar visibilidade e desempenho.',
    feedback: { texto: 'Sugeriu avaliar campanhas de Ads, promoções e criação ou melhoria de anúncios. Interesse em estratégias comerciais para aumentar a visibilidade e o desempenho dos produtos.' } },
  // já respondeu no grupo do WhatsApp (linha em feedback_relatorio): só o perfil, fonte 'whatsapp'
  { cliente: 'Uniaodog Artigos Pet', servico: '', temas: ['vendas', 'estoque_reposicao', 'compras_previsao'], nivel: 'padrao', fonte: 'whatsapp',
    observacao: 'Respondeu no grupo: vendas, estoque, reposição e compras.' },
]
// fora do seed: 'Mandi Confeccoes' perguntou «Temos os relatórios?» (dúvida, não preferência) — já está em feedback_relatorio; responder no grupo.

// aplica o seed com o núcleo; prévia (confirmar false) devolve o que mudaria e os erros; com confirmar, qualquer erro ABORTA (quem chama envolve numa transação)
export function aplicarSeed(perfis, { confirmar = false, por = POR, dia = DIA, existe = () => true } = {}) {
  return SEED.map(s => {
    const r = { cliente: s.cliente, temas: s.temas, nivel: s.nivel, servico: s.servico, fonte: s.fonte || 'equipe' }
    if (!existe(s.cliente)) { if (confirmar) throw new Error(`cliente fora da central: ${s.cliente}`); return { ...r, erro: 'cliente não está na central (pulado)' } }
    try {
      const p = perfis.salvar({ cliente: s.cliente, servico: s.servico, temas: s.temas, nivel: s.nivel, observacao: s.observacao, fonte: s.fonte || 'equipe', por, confirmar })
      r.perfil = !p.mudou ? 'igual ao salvo' : confirmar ? 'gravado' : p.antes ? 'muda' : 'novo'
      if (s.feedback) {
        const f = perfis.registrarFeedbackEquipe({ cliente: s.cliente, texto: s.feedback.texto, temas: [...new Set([...paraFeedback(s.temas), ...(s.feedback.extras || [])])], nota: s.feedback.nota || '', dia, por, confirmar })
        r.feedback = !f.novo ? 'já registrado' : confirmar ? 'gravado' : 'novo'
      }
    } catch (e) { if (confirmar) throw e; r.erro = e.message }
    return r
  })
}

const imprimir = (linhas, confirmar) => {
  for (const r of linhas) console.log(`${r.erro ? '✘' : r.perfil === 'igual ao salvo' && r.feedback !== 'novo' && r.feedback !== 'gravado' ? ' ' : '*'} ${r.cliente}  [${r.servico || 'serviço ?'} · ${r.fonte} · ${r.nivel}]\n` +
    `      temas: ${r.temas.length ? r.temas.join(', ') : '(só a base fixa)'}\n      perfil: ${r.perfil || '—'}${r.feedback ? ` · feedback curado: ${r.feedback}` : ''}${r.erro ? `\n      ERRO: ${r.erro}` : ''}`)
  const n = k => linhas.filter(r => r.perfil === k).length
  console.log(`\n${confirmar ? 'GRAVADO' : 'PRÉVIA (nada gravado)'} · ${linhas.length} cliente(s) · perfil ${confirmar ? `gravado ${n('gravado')}` : `novo ${n('novo')}, muda ${n('muda')}`}, igual ${n('igual ao salvo')} · erro ${linhas.filter(r => r.erro).length}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const confirmar = process.argv.includes('--confirmar')
  if (!confirmar) {
    const h = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
    const existe = c => !!h.prepare('SELECT 1 FROM clientes_central WHERE cliente = ?').get(c)
    imprimir(aplicarSeed(criarPerfilInformacao(h, { livro: null, validarPor: n => n }), { existe }), false)
    console.log(`Quem registra: ${POR} (validado no --confirmar). Para gravar: node scripts/seed-perfil-informacao.mjs --confirmar`)
    h.close()
  } else {
    const { db } = await import('../src/lib/db.js')
    const { perfilInformacaoReal } = await import('../src/lib/perfil-informacao-real.js')
    const perfis = perfilInformacaoReal(), existe = c => !!db.prepare('SELECT 1 FROM clientes_central WHERE cliente = ?').get(c)
    const previa = aplicarSeed(perfis, { existe })                   // valida tudo (inclusive quem registra) ANTES de gravar qualquer coisa
    if (previa.some(r => r.erro)) { imprimir(previa, false); console.error('\nNada gravado: corrija os erros acima.'); process.exit(1) }
    imprimir(db.transaction(() => aplicarSeed(perfis, { confirmar: true, existe }))(), true)
  }
}
