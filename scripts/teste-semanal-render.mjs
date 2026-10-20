// Autoteste do render do Relatório Semanal v2 — objetos r SINTÉTICOS, sem banco, sem rede.
// Rode: node scripts/teste-semanal-render.mjs   (DUMP_DIR=/pasta grava o HTML de cada perfil para conferir layout/PDF)
// As regras dos 7 perfis abaixo espelham config/perfis-cliente.json (padrões do dono); o render só lê r.perfil.regras.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { renderSemanal, ehPrint } from '../src/lib/render-semanal.js'
import { montarResultados, volumeAtividades, situacaoDaConta } from '../src/lib/semanal-resultados.js'   // funções puras da frente DADOS

const BASE = { densidade: 'completa', provas: 'completa', linguagem: 'padrao', tom: 'neutro', glossario: false, metodologia: false, graficos: false,
  tabela_otimizacoes: false, mostrar_equipe: false, links_abertos: false, situacao_da_conta: false, metricas_extras: false, max_acoes: 0, max_resultados: 0, max_otimizacoes: 0,
  lista_tarefas: true }   // modo "cliente que prioriza tarefas": o que estes testes legados cobrem. O modo só-resultados é testado no fim do arquivo
const REGRAS = {
  analitico: { ...BASE, metodologia: true, graficos: true, tabela_otimizacoes: true },
  direto: { ...BASE, densidade: 'enxuta', provas: 'minima', max_acoes: 5, max_resultados: 3, max_otimizacoes: 0 },
  relacionamento: { ...BASE, densidade: 'media', provas: 'media', tom: 'parceria', mostrar_equipe: true, max_acoes: 8 },
  proativo: { ...BASE, provas: 'media', links_abertos: true },
  zero_conhecimento: { ...BASE, densidade: 'media', provas: 'media', linguagem: 'simples', glossario: true, max_acoes: 6 },
  tecnico: { ...BASE, linguagem: 'tecnica', metricas_extras: true, metodologia: true, graficos: true, tabela_otimizacoes: true },
  ansioso: { ...BASE, densidade: 'media', provas: 'media', tom: 'tranquilizador', situacao_da_conta: true, max_acoes: 6 },
}
const PERFIS = Object.keys(REGRAS)

// ── fábrica de dados sintéticos ─────────────────────────────────────────
const M = (chave, rotulo, valor, unidade = 'numero', { extra = false, delta = null } = {}) =>
  ({ chave, rotulo, valor, unidade, delta, explicacao: `Explica ${rotulo}.`, extra })
const D = (valor, bom = true, pontos = false) => ({ valor, bom, pontos })
const ev = (i, extra = {}) => ({ tipo: 'image', url_origem: `https://exemplo.test/p${i}.png`, legenda: `Print ${i}`, criada_em: '2026-10-01T10:00:00', ...extra })
const MAL = '<img src=x onerror=alert(1)>'

function cheio(perfil, { url = 'https://notion.so/' } = {}) {
  const acoes = Array.from({ length: 9 }, (_, i) => ({
    id: `a${i}`, titulo: `Ação ${i + 1} ${i === 0 ? MAL : ''}`, processo: 'Mercado Livre', responsavel: 'Ana', data: '2026-10-01',
    descricao: `Descrição ${i + 1}`, resultado: i === 0 ? 'Resultado do card' : '', impacto: '', url: `${url}acao-${i}`,
    evidencias: [ev(i, { legenda: i === 0 ? '"><script>alert(2)</script>' : `Print ${i}` })],
    links: i === 0 ? [{ url: 'javascript:alert(4)', rotulo: 'Mercado Livre' }, { url: 'https://produto.mercadolivre.com.br/MLB-1', rotulo: 'Mercado Livre' }] : [],
  }))
  const itens = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`, titulo: `Tarefa resultado ${i + 1}`, canal: 'Mercado Livre', responsavel: 'Bia', concluida_em: '2026-10-02', url: `${url}res-${i}`,
    tipo: i % 2 === 0 ? 'medido' : 'informado',
    metrica: { rotulo: i % 2 === 0 ? 'Faturamento adicional (causa provável)' : 'Impacto informado', texto: '+ R$ 1.240' },
    resumo: 'Resumo da tarefa '.repeat(20), confianca: i % 2 === 0 ? { nivel: 'alta', pct: 82 } : null,
    metodo: `Método do item ${i + 1}: janela antes/depois`, evidencias: [ev(1), ev(2), ev(3), ev(4)], links: [{ url: 'https://produto.mercadolivre.com.br/MLB-2', rotulo: 'Mercado Livre' }],
  }))
  return {
    perfil: { perfis: [{ id: perfil, rotulo: perfil, descricao: '' }], primario: perfil, objetivo: { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' }, regras: REGRAS[perfil], origem: 'banco' },
    identificacao: { cliente: `Cliente Teste — Moda ${MAL}`, marketplaces: ['Mercado Livre', 'Shopee'], de: '2026-09-28', ate: '2026-10-04', periodo: '28/09/2026 a 04/10/2026',
      tipo: 'Semanal', gerado_em: '05/10/2026 09:00', ultima_atualizacao: '2026-10-05 08:00' },
    prontidao: [{ n: 1, nome: 'Identificação da conta', estado: 'recebido', detalhe: 'ok' }, { n: 3, nome: 'Prints', estado: 'faltando', detalhe: 'faltam' }],
    pronto: false, avisos: ['Aviso interno 1'],
    plano: { anoMes: '2026-10', total: 10, concluidas: 6, esforco: 20, esforco_concluido: 12, pct: 60, pct_esforco: 60, andamento: 3, bloqueadas: 1 },
    plano_oficial: [{ canal: 'Mercado Livre', url: 'https://notion.so/plano', acoes: [1, 2, 3] }],
    resultados: {
      periodo: { de: '2026-09-28', ate: '2026-10-04' }, anterior: { de: '2026-09-21', ate: '2026-09-27' },
      ml: { canal: 'Mercado Livre', fonte: 'api', disponivel: true, motivo: null, metricas: [
        M('faturamento', 'Faturamento', 48350.9, 'moeda', { delta: D(12.4) }), M('vendas', 'Vendas', 312, 'numero', { delta: D(3) }),
        M('unidades', 'Unidades', 405), M('ticket', 'Ticket médio', 154.97, 'moeda'), M('visitas', 'Visitas', 15800),
        M('conversao', 'Conversão', 1.97, 'pct', { delta: D(0.7, true, true) }), M('cancelamentos', 'Cancelamentos', 4, 'numero', { delta: D(-20, true) }),
        M('ctr_ml', 'CTR da busca', 2.1, 'pct', { extra: true }),
      ] },
      ads: { canal: 'Mercado Livre Ads', fonte: 'api', disponivel: true, motivo: null, acoes: ['Campanha X ajustada'], metricas: [
        M('vendas_ads', 'Vendas atribuídas', 80), M('roas', 'ROAS', 5.09), M('receita_ads', 'Receita atribuída', 9420, 'moeda'),
        M('investimento', 'Investimento', 1850, 'moeda'), M('acos', 'ACOS', 19.6, 'pct', { extra: true }), M('tacos', 'TACOS', 3.8, 'pct', { extra: true }),
        M('impressoes', 'Impressões', 240000, 'numero', { extra: true }), M('cliques', 'Cliques', 5100, 'numero', { extra: true }),
      ] },
      outros: [
        { canal: 'Shopee', tem_api: false, fonte: 'manual', motivo: null, acoes_semana: 3, evidencias: [ev(7)], metricas: [M('faturamento', 'Faturamento', 3200, 'moeda'), M('vendas', 'Vendas', 40)] },
        { canal: 'Amazon', tem_api: false, fonte: null, motivo: 'Sem integração via API e nenhum dado informado nesta semana.', acoes_semana: 0, evidencias: [], metricas: [M('faturamento', 'Faturamento', null, 'moeda'), M('vendas', 'Vendas', null)] },
        { canal: '</script><script>alert(3)</script>', tem_api: false, fonte: 'print', motivo: null, acoes_semana: 1, evidencias: [ev(8)], metricas: [] },
      ],
      destaques: [{ rotulo: 'Faturamento', delta: D(12.4) }, { rotulo: 'Visitas', delta: D(8) }, { rotulo: 'Conversão', delta: D(0.7, true, true) }, { rotulo: 'ROAS', delta: D(5) }],
      acoes_relacionadas: ['Otimização de título'],
    },
    atividades: { periodo: { de: '2026-09-28', ate: '2026-10-04' }, concluidas: { atual: 9, anterior: 6, pct: 50 }, por_canal: [{ canal: 'Mercado Livre', n: 7 }, { canal: '</script><script>alert(3)</script>', n: 2 }],
      otimizacoes: 3, acoes_ads: 2, em_andamento: 4, atrasadas: 0, bloqueadas: 0, com_evidencia: { n: 9, de: 9, pct: 100 }, equipe: [{ nome: 'Ana', n: 6 }, { nome: 'Bia', n: 3 }] },
    tarefas_resultado: { objetivo: { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' }, itens, sem_efeito: 2, em_maturacao: 1, nota: 'Lista parcial.' },
    situacao: { nivel: 'ok', titulo: 'Tudo em dia', itens: [{ texto: 'Nenhuma tarefa atrasada', tom: 'ok' }, { texto: '60% do plano executado', tom: 'ok' }] },
    acoes, otimizacoes: [{ titulo: 'Otimização A', processo: 'ML', mudanca: 'título', efeito: 'subiu', evidencias: 2 }], efeito_vendas: '+12% de faturamento',
    atencao: [{ tipo: 'Atraso', texto: 'Algo atrasou' }], proximos: [{ titulo: 'Enviar fotos', dependencia_cliente: 'Cliente envia as fotos', url: `${url}dep`, status: 'andamento', atrasada: false }],
    produtos_top: [{ titulo: 'Produto X', url: 'https://produto.mercadolivre.com.br/MLB-9', unidades: 10, receita: 990 }],
    ofertas: { disponivel: true, total: 1, promocoes: [{ tipo: 'DEAL', status: 'started', inicio: '2026-10-01', fim: '2026-10-10' }] },   // códigos crus da API (meli-api.js)
    evidMetricas: [ev(9)], ads: { acoes: ['Campanha X ajustada'], evidencias: [ev(10)] },
    graficos: { por_dia: [{ dia: '2026-10-01', n: 3 }], por_canal: [{ canal: 'Mercado Livre', n: 7 }], faturamento_hist: [{ de: '2026-09-21', ate: '2026-09-27', faturamento: 40000, vendas: 300 }, { de: '2026-09-28', ate: '2026-10-04', faturamento: 48350.9, vendas: 312 }] },
  }
}

// grade de comparação: nenhum HTML pode ter lixo de template
const LIXO = /undefined|NaN|\bnull\b|\[object/
const conta = (html, rx) => (html.match(rx) || []).length
const idx = (html, s) => { const i = html.indexOf(s); assert.ok(i >= 0, `faltou "${s}"`); return i }
const sec = html => [...html.matchAll(/data-sec="(\w+)"/g)].map(m => m[1])
let n = 0
const ok = msg => { n++; console.log('✔', msg) }

// 1) todos os perfis × interno: o que sai e o que NÃO sai do relatório do cliente
const H = {}   // perfil → html do cliente
const DUMP = process.env.DUMP_DIR   // opcional: DUMP_DIR=/pasta grava o HTML de cada perfil para conferir o layout no navegador/PDF
for (const p of PERFIS) {
  const r = cheio(p)
  const cli = renderSemanal(r), int = renderSemanal(r, { interno: true })
  H[p] = cli
  if (DUMP) { mkdirSync(DUMP, { recursive: true }); writeFileSync(`${DUMP}/${p}.html`, cli); writeFileSync(`${DUMP}/${p}-interno.html`, int) }
  for (const proibido of ['Checklist de coleta', 'Checagem de prontidão', 'gDias', 'Próximos passos', 'Entregas por dia', 'uso interno', 'Aviso interno'])
    assert.ok(!cli.toLowerCase().includes(proibido.toLowerCase()), `${p}: cliente não pode ter "${proibido}"`)
  assert.ok(!int.includes('gDias') && !int.includes('Próximos passos') && !int.includes('Entregas por dia'), `${p}: interno também sem gDias/Próximos passos`)
  assert.ok(int.includes('Checklist de coleta') && int.includes('Checagem de prontidão') && int.includes('Uso interno — não enviar ao cliente') && int.includes('Aviso interno 1'), `${p}: interno com checklist, prontidão e rótulo`)
  assert.ok(idx(int, 'data-sec="interno"') > idx(int, 'data-sec="atencao"'), `${p}: interno vai ao FINAL`)
  assert.ok(idx(int, 'data-sec="interno"') > idx(int, '<footer'), `${p}: interno depois do rodapé do cliente`)
  assert.ok(!sec(cli).includes('interno'))
  for (const [nome, html] of [['cliente', cli], ['interno', int]]) assert.ok(!LIXO.test(html), `${p}/${nome}: lixo de template (${html.match(LIXO)?.[0]})`)
  assert.ok(!/comprovad/i.test(cli), `${p}: nunca "comprovad*"`)
}
ok('7 perfis × interno: sem checklist/prontidão/gDias/Próximos passos no cliente; interno só acrescenta checklist+prontidão ao final; sem undefined/NaN/null')

// 2) ordem das seções + numeração sequencial
for (const p of PERFIS) {
  const s = sec(H[p])
  const miolo = p === 'direto' ? ['resultados', 'tarefas', 'atencao', 'volume', 'acoes']
    : ['analitico', 'tecnico'].includes(p) ? ['resultados', 'volume', 'tarefas', 'acoes', 'otimizacoes', 'atencao']
    : ['resultados', 'volume', 'tarefas', 'acoes', 'atencao']
  assert.deepEqual(s, p === 'ansioso' ? ['situacao', ...miolo] : miolo, `${p}: ordem das seções`)
  assert.ok(idx(H[p], '<h2>Resultados</h2>') < idx(H[p], '<h2>Ações concluídas na semana</h2>'), `${p}: Resultados antes de Ações`)
  const nums = [...H[p].matchAll(/Seção (\d\d)</g)].map(m => m[1])
  assert.deepEqual(nums, nums.map((_, i) => String(i + 1).padStart(2, '0')), `${p}: numeração sequencial`)
}
assert.ok(idx(H.direto, 'data-sec="atencao"') < idx(H.direto, 'data-sec="acoes"'), 'direto: atenção antes das ações')
assert.ok(idx(H.ansioso, 'data-sec="situacao"') < idx(H.ansioso, 'data-sec="resultados"'), 'ansioso: situação antes de resultados')
assert.ok(idx(H.analitico, '<h2>Volume de atividades</h2>') < idx(H.analitico, 'class="plano"') && idx(H.analitico, 'class="plano"') < idx(H.analitico, '<h2>Tarefas que geraram resultado</h2>'), 'volume → barra do plano → tarefas')
ok('ordem: [situação] → Resultados → Volume → plano → Tarefas → Ações → [Otimizações] → Atenção; direto sobe a atenção; numeração sequencial')

// 3) resultados: 3 blocos, selos da fonte, canal sem API, "—" + motivo
const a = H.analitico
for (const t of ['Mercado Livre</h3>', 'Mercado Livre Ads</h3>', 'Outros canais</h3>']) assert.ok(a.includes(t), t)
assert.ok(a.includes('dados da API do Mercado Livre') && a.includes('dados da API do Mercado Livre Ads'))
assert.ok(a.includes('informado pela equipe · canal sem integração via API'), 'Shopee: manual + sem API')
assert.ok(a.includes('print do painel · canal sem integração via API'), 'canal com print')
assert.ok(a.includes('Sem integração via API e nenhum dado informado nesta semana.'), 'motivo explícito')
assert.ok(a.includes('canal sem integração via API</span>'), 'Amazon: só o selo sem API')
assert.equal(conta(a, /<div class="met[ "][^>]*?>/g) > 0, true)
ok('Resultados: ML · ADS · Outros canais, selos de fonte e motivo do canal sem API')

// 4) sem ML / sem ads / sem outros / resultados vazios: grade completa com "—", nunca zero como fato
{
  const r = cheio('analitico')
  r.resultados.ml = { canal: 'Mercado Livre', fonte: null, disponivel: false, motivo: 'Conta do Mercado Livre não conectada.', metricas: r.resultados.ml.metricas.map(m => ({ ...m, valor: null, delta: null })) }
  r.resultados.ads = { canal: 'Mercado Livre Ads', fonte: null, disponivel: false, motivo: 'Sem dados de Ads.', acoes: [], metricas: r.resultados.ads.metricas.map(m => ({ ...m, valor: null, delta: null })) }
  r.resultados.outros = []; r.resultados.destaques = []; r.resultados.anterior = null
  r.tarefas_resultado = { objetivo: r.tarefas_resultado.objetivo, itens: [], sem_efeito: 0, em_maturacao: 0, nota: 'Nenhuma tarefa teve efeito medido nesta semana; o motor só mede após 5 dias de janela.' }
  r.evidMetricas = []; r.ads.evidencias = []
  const h = renderSemanal(r)
  assert.ok(h.includes('Conta do Mercado Livre não conectada.') && h.includes('Sem dados de Ads.'))
  assert.ok(h.includes('sem dado neste período'))
  assert.equal(conta(h, /class="met( ads)? sem-dado"/g), 11, 'ML (7) + Ads (4) sem extras: todas sem valor viram "—"')
  assert.ok(!/R\$ 0,00|<div class="v">0<|>0%</.test(h), 'nunca zero como fato em métrica indisponível')
  assert.ok(h.includes('Nenhum outro canal além do Mercado Livre'))
  assert.ok(h.includes('SEM PERÍODO ANTERIOR PARA COMPARAR'))
  assert.ok(h.includes('Nenhuma tarefa teve efeito medido nesta semana') && !h.includes('data-resultado'), 'nota honesta quando a lista de resultados é vazia')
  assert.ok(!LIXO.test(h))
}
ok('estados vazios: "—" + motivo, sem zero como fato, nota honesta, sem outros canais')

// 5) esparso: só identificação — não quebra, nunca imprime undefined
{
  const h = renderSemanal({ identificacao: { cliente: 'Só Nome' } })
  assert.ok(!LIXO.test(h), h.match(LIXO)?.[0])
  for (const t of ['Resultados', 'Volume de atividades', 'Tarefas que geraram resultado', 'Ações concluídas na semana', 'Pontos de atenção'])
    assert.ok(h.includes(`<h2>${t}</h2>`), t)
  assert.ok(h.includes('indisponível nesta geração'))
  const h2 = renderSemanal({}, { interno: true })
  assert.ok(!LIXO.test(h2))
  for (const p of PERFIS) assert.ok(!LIXO.test(renderSemanal({ perfil: { regras: REGRAS[p] }, identificacao: { cliente: 'X' } })), `esparso ${p}`)
}
ok('r esparso (sem resultados/atividades/perfil) renderiza com "—" e sem undefined')

// 6) escape de HTML malicioso (títulos, legendas, canais) e URLs perigosas
for (const p of PERFIS) {
  const h = renderSemanal(cheio(p), { interno: true })
  assert.ok(!h.includes(MAL) && !h.includes('<script>alert') && !h.includes('</script><script>'), `${p}: HTML malicioso escapado`)
  assert.ok(!/href="javascript:/i.test(h) && !/src="javascript:/i.test(h), `${p}: sem javascript: em href/src`)
}
assert.ok(H.analitico.includes('&lt;img src=x onerror=alert(1)&gt;') && H.analitico.includes('&lt;script&gt;alert(2)&lt;/script&gt;'))
assert.ok(H.analitico.includes('\\u003c/script>\\u003cscript>alert(3)'), 'nome de canal no JSON dos gráficos não fecha a tag script')
ok('escape: títulos, legendas, canal no JSON do gráfico; javascript: nunca vira link')

// 7) limites max_*
assert.equal(conta(H.direto, /data-acao="1"/g), 5)
assert.equal(conta(H.direto, /data-resultado="1"/g), 3)
assert.equal(conta(H.relacionamento, /data-acao="1"/g), 8)
assert.equal(conta(H.zero_conhecimento, /data-acao="1"/g), 6)
assert.equal(conta(H.ansioso, /data-acao="1"/g), 6)
for (const p of ['analitico', 'proativo', 'tecnico']) { assert.equal(conta(H[p], /data-acao="1"/g), 9, p); assert.equal(conta(H[p], /data-resultado="1"/g), 6, p) }
assert.ok(H.direto.includes('+ 4 ações concluídas não listadas') && H.direto.includes('+ 3 tarefas com resultado não exibidas'))
assert.ok(!H.analitico.includes('não listadas') && !H.analitico.includes('não exibidas'))
{ const r = cheio('analitico'); r.perfil.regras = { ...REGRAS.analitico, max_otimizacoes: 1 }; r.otimizacoes = [{ titulo: 'O1' }, { titulo: 'O2' }]; const h = renderSemanal(r); assert.ok(h.includes('O1') && !h.includes('>O2<') && h.includes('+ 1 otimização'))
  r.perfil.regras.max_otimizacoes = 0; r.otimizacoes = Array.from({ length: 12 }, (_, i) => ({ titulo: `Otim ${i + 1}` }))
  assert.equal(conta(renderSemanal(r), /<tr>\s*<td><b>Otim /g), 12, 'max_otimizacoes 0 = sem limite') }
ok('limites: max_acoes, max_resultados e max_otimizacoes respeitados (0 = todas)')

// 8) glossário só em zero_conhecimento; fórmulas/extras só em técnico; siglas explicadas 1 vez
for (const p of PERFIS) {
  const h = H[p]
  assert.equal(h.includes('class="glossario"'), p === 'zero_conhecimento', `${p}: glossário`)
  assert.equal(/class="formula"/.test(h), p === 'tecnico', `${p}: fórmulas`)
  assert.equal(h.includes('>ACOS<') || h.includes('ACOS</div>'), p === 'tecnico', `${p}: métricas extra`)
  assert.equal(h.includes('>CTR da busca'), p === 'tecnico', `${p}: extra do ML`)
  assert.equal(conta(h, /ROAS = retorno/g), p === 'zero_conhecimento' ? 1 : 0, `${p}: sigla explicada na 1ª vez`)
}
assert.ok(H.zero_conhecimento.includes('O que significa:') && H.zero_conhecimento.includes('Por que importa:') && H.zero_conhecimento.includes('Explica Faturamento.'))
assert.ok(H.tecnico.includes('= receita atribuída ÷ investimento') && H.tecnico.includes('= investimento ÷ receita atribuída × 100') && H.tecnico.includes('= cliques ÷ impressões × 100'))
assert.ok(!H.analitico.includes('÷'), 'sem fórmulas fora do técnico')
ok('glossário só em zero_conhecimento (siglas 1ª vez); fórmulas e métricas extra só no técnico')

// 9) tarefas que geraram resultado: medido × informado, causa provável, confiança, método, provas, links
for (const p of PERFIS) {
  const h = H[p]
  assert.ok(h.includes('Medido · causa provável') && h.includes('Informado pela equipe'), p)
  assert.ok(/Faturamento adicional \(causa provável\)/.test(h) && h.includes('+ R$ 1.240'), `${p}: métrica do objetivo em destaque`)
  assert.ok(h.includes('Objetivo acompanhado: <b>Crescer o faturamento</b>'), p)
  assert.ok(h.includes('2 tarefas medidas SEM EFEITO DISTINGUÍVEL') && h.includes('1 AINDA SEM JANELA PARA MEDIR'), `${p}: contagens honestas`)
  assert.ok(h.includes('Lista parcial.'), `${p}: nota parcial`)
  assert.ok(/CONFIANÇA: ALTA \(82\/100\)|GRAU DE CERTEZA: ALTA \(82\/100\)/.test(h), `${p}: confiança`)
  assert.equal(h.includes('Método do item 1'), ['analitico', 'tecnico'].includes(p), `${p}: método só com metodologia`)
  assert.equal(h.includes('class="metodologia"'), ['analitico', 'tecnico'].includes(p), `${p}: caixa "Como medimos"`)
  assert.equal(h.includes('https://notion.so/res-0'), p === 'proativo', `${p}: link do card só com links_abertos`)
  assert.equal(h.includes('Depende de você'), p === 'proativo', `${p}: dependência do cliente só no proativo`)
}
assert.ok(H.zero_conhecimento.includes('GRAU DE CERTEZA') && H.analitico.includes('CONFIANÇA:'))
assert.ok(H.direto.includes('Resumo da tarefa…') || /Resumo da tarefa[^<]{0,170}…/.test(H.direto), 'direto: frases curtas (resumo truncado)')
ok('tarefas: selo medido/informado, "causa provável", confiança, método só com metodologia, link só com links_abertos')

// 10) provas: miniaturas por perfil (1 tarefa com 4 prints + 1 ação com 3 prints)
{
  const mini = p => { const r = cheio(p); r.acoes = [{ ...r.acoes[1], evidencias: [ev(1), ev(2), ev(3)] }]; r.tarefas_resultado.itens = [r.tarefas_resultado.itens[0]]
    r.evidMetricas = []; r.ads.evidencias = []; r.resultados.outros = []; return renderSemanal(r) }
  const thumbs = p => conta(mini(p), /<div class="thumb">/g)
  assert.equal(thumbs('analitico'), 7); assert.equal(thumbs('tecnico'), 7)
  assert.equal(thumbs('relacionamento'), 3); assert.equal(thumbs('proativo'), 3); assert.equal(thumbs('ansioso'), 3)
  assert.equal(thumbs('direto'), 1)
  assert.ok(mini('direto').includes('+ 3 prints no card'), 'direto: a tarefa mostra 1 de 4 e avisa o resto')
  assert.equal(conta(mini('relacionamento'), /\+ 2 prints no card/g), 2, 'média: tarefa 2 de 4, ação 1 de 3')
}
ok('provas: completa = todas, média = 2 por tarefa e 1 por ação, mínima = 1 só nas tarefas com resultado')

// 11) perfis: tom, equipe, situação, links, listas, gráficos
assert.ok(H.relacionamento.includes('o time da Place2u concluiu 9 ações na sua conta') && H.relacionamento.includes('O que melhorou na sua conta'))
assert.ok(H.ansioso.includes('Este é o retrato da sua conta na semana de 28/09/2026 a 04/10/2026') && H.ansioso.includes('Nenhuma tarefa atrasada ou bloqueada.'))
assert.ok(H.analitico.includes('Semana de 28/09/2026 a 04/10/2026: 9 ações concluídas e 60% do plano do mês executado.'))
assert.ok(!H.analitico.includes('o time da Place2u') && !H.analitico.includes('retrato da sua conta'))
for (const p of PERFIS) {
  const h = H[p], completa = ['analitico', 'proativo', 'tecnico'].includes(p)
  assert.equal(h.includes('Quem cuidou da sua conta'), p === 'relacionamento', `${p}: equipe`)
  assert.equal(h.includes('Situação da conta em 1 olhar'), p === 'ansioso', `${p}: situação`)
  assert.equal(h.includes('Produtos mais vendidos') && h.includes('Ofertas ativas no Mercado Livre'), completa, `${p}: listas`)
  assert.equal(h.includes('id="gCanais"') && h.includes('id="gFat"'), ['analitico', 'tecnico'].includes(p), `${p}: gráficos`)
  assert.equal(h.includes('chart.umd.min.js'), ['analitico', 'tecnico'].includes(p), `${p}: Chart.js só quando há gráfico`)
  assert.equal(h.includes('Otimizações da semana'), ['analitico', 'tecnico'].includes(p), `${p}: otimizações`)
}
assert.ok(H.relacionamento.includes('Ana</b> — 6 ações concluídas'))
assert.ok(H.proativo.includes('<b>Depende de você:</b>') && H.proativo.includes('href="https://notion.so/dep"'))
ok('perfis: tom de abertura, equipe, situação, listas de produtos/ofertas, gráficos e otimizações')

// 12) situação da conta: verde só com 0 atrasadas e 0 bloqueadas (também confere no render)
{
  const verde = renderSemanal(cheio('ansioso'))
  assert.ok(verde.includes('class="situacao ok"') && verde.includes('class="luz ok"') && verde.includes('>verde<'))
  const r = cheio('ansioso'); r.atividades.atrasadas = 2; r.atividades.bloqueadas = 1
  const amar = renderSemanal(r)
  assert.ok(amar.includes('class="situacao atencao"') && amar.includes('>amarelo<') && amar.includes('Atrasadas: 2 · bloqueadas: 1.'), 'nivel "ok" com atrasadas>0 nunca vira verde')
  const r2 = cheio('ansioso'); r2.situacao = { nivel: 'atencao', titulo: '2 pontos em atenção', itens: [{ texto: 'Tarefa X atrasada — Ana, prazo 01/10', tom: 'atencao' }] }
  const h2 = renderSemanal(r2)
  assert.ok(h2.includes('2 pontos em atenção') && h2.includes('Tarefa X atrasada — Ana, prazo 01/10') && h2.includes('class="luz atencao"'))
}
ok('situação da conta: semáforo derivado de fatos, verde só com 0 atrasadas e 0 bloqueadas')

// 13) volume de atividades sempre presente; zero real é fato, ausência é "—"
{
  for (const p of PERFIS) { assert.ok(H[p].includes('<h2>Volume de atividades</h2>') && H[p].includes('Ações concluídas por canal') && H[p].includes('Com print anexado'), p) }
  const r = cheio('analitico'); r.atividades.otimizacoes = undefined; r.atividades.por_canal = []; r.graficos.por_canal = []; r.atividades.concluidas = { atual: 0, anterior: null, pct: null }
  const h = renderSemanal(r)
  assert.ok(h.includes('Sem distribuição por canal neste período.') && h.includes('sem semana anterior para comparar'))
  assert.ok(/<div class="num">—<\/div><div class="lbl">Otimizações/.test(h) && /<div class="num">0<\/div><div class="lbl">Ações concluídas/.test(h))
}
ok('volume de atividades sempre presente (tiles + por canal); contagem real 0 é mostrada, dado ausente é "—"')

// 14) sem perfil → padrão analítico; interno mostra o perfil aplicado
{
  const r = cheio('analitico'); delete r.perfil
  const h = renderSemanal(r)
  assert.ok(h.includes('data-sec="otimizacoes"') && h.includes('class="metodologia"') && !h.includes('class="glossario"'))
  const int = renderSemanal(cheio('direto'), { interno: true })
  assert.ok(int.includes('PERFIL APLICADO: direto') && int.includes('OBJETIVO: Crescer o faturamento'))
}
ok('sem r.perfil → padrão analítico; interno informa perfil e objetivo aplicados')

// 15) layout de impressão: blocos que não partem, direto compacto, nada de página 00
assert.ok(H.direto.includes('class="pagina enxuta"') && !H.analitico.includes('class="pagina enxuta"'))
assert.ok(H.analitico.includes('break-inside:avoid;page-break-inside:avoid') && H.analitico.includes('break-after:avoid'))
assert.ok(H.analitico.includes('data-sec="atencao" class="sec-curta"'))
ok('impressão: break-inside evita partir blocos; perfil direto usa layout enxuto')

// 16) aditivos da frente DADOS: motivo por métrica, aviso do bloco, atenção com responsável/prazo, confiança baixa
{
  const r = cheio('proativo')
  r.resultados.ml.aviso = 'Período com mais de 1.000 pedidos: os números são uma amostra.'
  r.resultados.ml.metricas = [M('faturamento', 'Faturamento', 100, 'moeda'),
    { ...M('visitas', 'Visitas', null), motivo: 'não retornado pela API do Mercado Livre' }, { ...M('conversao', 'Conversão', null, 'pct'), motivo: 'não retornado pela API do Mercado Livre' },
    { ...M('devolucoes', 'Devoluções', null), motivo: 'sem reclamações consultadas' }]
  r.atencao = [{ tipo: 'Depende de você', texto: 'Enviar fotos — card aberto', url: 'https://notion.so/dep', responsavel: 'Ana', prazo: '2026-10-08' }, { tipo: 'Atraso', texto: 'Algo atrasou', responsavel: 'Bia', prazo: '2026-10-08' }]
  const h = renderSemanal(r)
  assert.ok(h.includes('Período com mais de 1.000 pedidos'), 'aviso do bloco ML')
  assert.ok(h.includes('△ Visitas, Conversão: não retornado pela API do Mercado Livre') && h.includes('△ Devoluções: sem reclamações consultadas'), 'motivos agrupados por texto')
  assert.equal(conta(h, /não retornado pela API/g), 1, 'motivo repetido não vira uma linha por tile')
  assert.ok(h.includes('Algo atrasou <span class="quem">— Bia · prazo 08/10/2026</span>'), 'atenção com responsável e prazo')
  assert.ok(/Depende de você:<\/b> <a [^>]*>Enviar fotos — card aberto<\/a><\/li>/.test(h) && !h.includes('— Ana'), '"Depende de você" nunca mostra responsável nem prazo (nome interno fica fora)')
  assert.ok(h.includes('<a href="https://notion.so/dep"') && conta(h, /Depende de você:/g) === 1, 'Depende de você: 1 vez só (atenção + próximos não duplicam)')
  for (const p of PERFIS.filter(p => p !== 'proativo')) { const r2 = cheio(p); r2.atencao = r.atencao; assert.ok(renderSemanal(r2).includes('<b>Depende de você:</b> Enviar fotos — card aberto</li>'), `${p}: dependência do cliente vinda da atenção, sem responsável`) }
  // selo do item medido conforme a confiança — hipótese nunca vira "causa provável"
  const r3 = cheio('analitico')
  r3.tarefas_resultado.itens = [{ ...r3.tarefas_resultado.itens[0], titulo: 'Item baixa', confianca: { nivel: 'baixa', pct: 22 } },
    { ...r3.tarefas_resultado.itens[0], titulo: 'Item lançamento', confianca: null }, { ...r3.tarefas_resultado.itens[0], titulo: 'Item alta' }]
  const h3 = renderSemanal(r3)
  assert.equal(conta(h3, /Medido · hipótese, confiança baixa/g), 1)
  assert.equal(conta(h3, /Medido · observação direta/g), 1)
  assert.equal(conta(h3, /Medido · causa provável/g), 1)
  const int = renderSemanal({ ...cheio('direto'), perfil: { ...cheio('direto').perfil, override: true, avisos: ['Perfil "x" saiu da config'] } }, { interno: true })
  assert.ok(int.includes('OVERRIDE DESTA GERAÇÃO') && int.includes('Perfil &quot;x&quot; saiu da config'))
}
ok('aditivos do DADOS: motivos agrupados, aviso do bloco, atenção com responsável/prazo, "Depende de você" sem duplicar, confiança baixa = hipótese')

// 17) compatibilidade com os builders REAIS (puros) da frente DADOS: o render aceita o que eles entregam, em todos os perfis
{
  const de = '2026-09-28', ate = '2026-10-04'
  const tarefas = [{ id: 't1', processo: 'Mercado Livre', responsavel: 'Ana e Bia' }, { id: 't2', processo: 'Shopee', responsavel: 'Ana' }, { id: 't3', processo: 'Amazon', responsavel: 'Bia' }]
  const resultados = montarResultados({ de, ate, tarefas, concluidas: tarefas, canaisManuais: { Shopee: { faturamento: 3000, vendas: 30, ads: { investimento: 100, receita: 500, roas: 5 } } } })
  const atividades = volumeAtividades({ de, ate, concluidas: tarefas, concluidasAnterior: 0, abertas: [], atrasadas: [], bloqueadas: [], evPorTarefa: {} })
  const situacao = situacaoDaConta({ atrasadas: [{ id: 'x', titulo: 'Tarefa X', prazo: '2026-10-01', responsavel: 'Ana' }], bloqueadas: [], plano: { anoMes: '2026-10', total: 4, concluidas: 2, pct: 50 }, hoje: '2026-10-05' })
  for (const p of PERFIS) {
    const r = { perfil: { perfis: [{ id: p, rotulo: p }], regras: REGRAS[p] }, identificacao: { cliente: 'Real', periodo: '28/09/2026 a 04/10/2026' }, resultados, atividades, situacao,
      tarefas_resultado: { objetivo: { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' }, itens: [], sem_efeito: 1, em_maturacao: 0, nota: 'Nenhuma tarefa concluída nos últimos 45 dias tem resultado medido ou informado.' } }
    const h = renderSemanal(r)
    assert.ok(!LIXO.test(h), `${p}: ${h.match(LIXO)?.[0]}`)
    assert.ok(h.includes('Shopee') && h.includes('Amazon') && h.includes('informado pela equipe · canal sem integração via API'), `${p}: outros canais`)
    assert.ok(h.includes('Conta do Mercado Livre ainda não conectada'), `${p}: motivo do ML`)
    assert.ok(/Unidades vendidas, Ticket médio, Visitas, Conversão(, ACOS)?: não informado pela equipe nesta semana/.test(h), `${p}: motivo das métricas sem valor do canal`)
    assert.ok(h.includes('Nenhuma tarefa concluída nos últimos 45 dias'), `${p}: nota honesta`)
  }
  const t = renderSemanal({ perfil: { regras: REGRAS.tecnico }, identificacao: { cliente: 'Real' }, resultados, atividades })
  assert.ok(t.includes('>CTR</div>') && t.includes('>CPC</div>'), 'técnico: CTR/CPC entram como métricas extras')
}
ok('builders reais do DADOS (montarResultados/volumeAtividades/situacaoDaConta) renderizam em todos os perfis, sem undefined')

// ── regressões da revisão adversarial (achados 14, 15, 16, 24, 29, 30, 31, 32 + período parcial) ──────────────
const DE = '2026-09-28', ATE = '2026-10-04'
const secao = (html, s) => { const i = idx(html, `data-sec="${s}"`); return html.slice(i, html.indexOf('</section>', i)) }

// 18) [14] bookmark/embed é LINK de anúncio: não desenha caixa "📎 bookmark", não marca ✓ na coluna Print, não conta como print
{
  const bk = { tipo: 'bookmark', url_origem: 'https://produto.mercadolivre.com.br/MLB-1', arquivo_local: '', legenda: '' }
  const emb = { tipo: 'embed', url_origem: 'https://www.youtube.com/watch?v=1' }
  assert.deepEqual([ev(1), { tipo: 'pdf' }, { tipo: 'file', arquivo_local: 'evidencias/t1/painel.pdf' }, bk, emb, { tipo: 'file', arquivo_local: 'evidencias/t1/plan.xlsx' }, { tipo: 'video' }].map(ehPrint),
    [true, true, true, false, false, false, false], 'print = imagem/PDF; link, planilha e vídeo não')
  for (const p of ['analitico', 'direto']) {
    const r = cheio(p)
    r.acoes = [{ ...r.acoes[1], evidencias: [bk, emb], links: [{ url: bk.url_origem, rotulo: 'Mercado Livre' }] }]
    r.tarefas_resultado.itens = [{ ...r.tarefas_resultado.itens[0], evidencias: [bk, ev(1)] }]
    r.evidMetricas = [bk]; r.ads.evidencias = []; r.resultados.outros = []
    const h = renderSemanal(r)
    assert.ok(!/📎 (bookmark|embed)/.test(h) && !h.includes('<div class="thumb-arquivo">'), `${p}: link nunca vira caixa de print`)
    assert.equal(conta(h, /<div class="thumb">/g), 1, `${p}: só o print verdadeiro da tarefa vira miniatura`)
    assert.ok(!h.includes('prints no card') && !h.includes('print no card'), `${p}: link não entra no "+ N prints no card"`)
    if (p === 'direto') assert.ok(!/<td>✓<\/td><\/tr>/.test(h) && /<td>—<\/td><\/tr>/.test(h), 'direto: ação só com link = "—" na coluna Print')
    else assert.ok(h.includes('🔗 Ver anúncio — Mercado Livre'), 'analítico: o bookmark aparece como link de anúncio')
  }
  const fonte = readFileSync(new URL('../src/lib/semanal.js', import.meta.url), 'utf-8')   // a mesma regra separa prints de links NA ORIGEM
  assert.ok(/import \{ ehPrint \} from '\.\/render-semanal\.js'/.test(fonte) && /\(ehPrint\(e\) \? evPorTarefa : naoPrint\)/.test(fonte), 'semanal.js: evPorTarefa só com prints (Com print anexado, Sem evidência, contagens)')
  assert.ok(/links: linksDeAnuncio\(t, naoPrint\[t\.id\]/.test(fonte) && /linksDe: t => linksDeAnuncio\(t, naoPrint\[t\.id\]/.test(fonte), 'semanal.js: bookmarks seguem para os chips de link')
}
ok('[14] bookmark/embed é link de anúncio: sem caixa 📎, sem ✓ de print, fora das miniaturas e da contagem')

// 19) [15] bloco indisponível: UM motivo (o do bloco), sem motivo por métrica contraditório e sem jargão interno no HTML do cliente
{
  const JARGAO = /metricas-semanais|config\/|transcrit|API (de \w+ )?retornou|retornou \d{3}|HTTP \d{3}/i
  const caiu = montarResultados({ de: DE, ate: ATE, conectado: true, falhou: true })
  const h = renderSemanal({ perfil: { regras: REGRAS.ansioso }, identificacao: { cliente: 'X' }, resultados: caiu })
  assert.equal(conta(secao(h, 'resultados'), /O Mercado Livre não respondeu na geração deste relatório/g), 2, 'ML e Ads: o motivo real, uma vez por bloco')
  assert.ok(!/Faturamento, Vendas|não consta|Vendas atribuídas aos anúncios, ROAS/.test(h), 'nenhuma linha de motivo por métrica num bloco indisponível')
  const semGasto = montarResultados({ de: DE, ate: ATE, conectado: true, negocio: { atual: { faturamento: 1000, vendas: 10 } }, ads: { atual: { disponivel: false, motivo: 'nenhum gasto em Ads no período' } } })
  const h2 = renderSemanal({ perfil: { regras: REGRAS.analitico }, identificacao: { cliente: 'X' }, resultados: semGasto })
  assert.ok(h2.includes('△ Nenhum gasto em Ads no período') && !h2.includes('não consta nos números informados'), 'Ads sem gasto: um motivo, com maiúscula, sem "informados pela equipe"')
  const r = cheio('analitico')   // guarda do render: erro cru de API / nome de arquivo nunca chegam ao cliente (falha fechada)
  r.resultados.ads = { ...r.resultados.ads, fonte: null, motivo: 'API de Ads retornou 403', aviso: 'ver config/metricas-semanais.json' }
  r.resultados.ml.metricas = [...r.resultados.ml.metricas, { ...M('devolucoes', 'Devoluções', null), motivo: 'lido de config/metricas-semanais.json' }]
  const h3 = renderSemanal(r)
  assert.ok(!JARGAO.test(h3) && h3.includes('Os números deste bloco não estão disponíveis nesta geração do relatório') && h3.includes('Devoluções: não disponível nesta geração'), h3.match(JARGAO)?.[0])
  const outraSemana = montarResultados({ de: DE, ate: ATE, semanaIgnorada: '2026-09-07', canaisManuais: { Shopee: { faturamento: 10, semana_de: '2026-09-07' } }, tarefas: [{ id: 't', processo: 'Shopee' }] })
  for (const p of PERFIS) for (const html of [H[p], renderSemanal({ perfil: { regras: REGRAS[p] }, identificacao: { cliente: 'X' }, resultados: outraSemana }), renderSemanal({ perfil: { regras: REGRAS[p] }, identificacao: { cliente: 'X' }, resultados: caiu })])
    assert.ok(!JARGAO.test(html), `${p}: jargão interno no HTML do cliente (${html.match(JARGAO)?.[0]})`)
}
ok('[15] bloco indisponível: um motivo de cliente no topo, sem motivo por métrica contraditório, sem jargão/arquivo/código HTTP')

// 20) [16] ofertas: só ativas (started) e programadas (pending), rótulos em português, contagem = linhas exibidas
{
  const r = cheio('analitico')
  const pr = (tipo, status) => ({ tipo, status, inicio: '2026-10-01', fim: '2026-10-20' })
  r.ofertas = { disponivel: true, total: 37, promocoes: [pr('SELLER_CAMPAIGN', 'pending'), pr('DEAL', 'started'), pr('LIGHTNING', 'candidate'), pr('SMART', 'finished'), pr('NOVO_TIPO_X', 'started')] }
  const h = renderSemanal(r)
  assert.ok(h.includes('Ofertas ativas e programadas no Mercado Livre</span> &nbsp;2 ativas · 1 programada'), 'cabeçalho conta só as linhas exibidas')
  assert.equal(conta(h, /<td>Ativa<\/td>/g), 2); assert.equal(conta(h, /<td>Programada<\/td>/g), 1)
  assert.ok(!/SELLER_CAMPAIGN|NOVO_TIPO_X|LIGHTNING|>pending<|>started<|candidate|Relâmpago|37 promoções<\/p>/.test(h), 'sem código cru da API e sem candidata/encerrada')
  assert.ok(idx(h, 'Oferta do dia/Campanha') < idx(h, 'Campanha do vendedor') && h.includes('Outra promoção'), 'ativas primeiro; tipo desconhecido = "Outra promoção"')
  assert.ok(h.includes('Consulta limitada às 5 primeiras das 37 promoções da conta'), 'total da conta > consultadas: avisa, sem fingir que é o total')
  const T = { SMART: 'Campanha do Mercado Livre', DEAL: 'Oferta do dia/Campanha', LIGHTNING: 'Relâmpago', UNHEALTHY_STOCK: 'Acelere o estoque (Full)', PRICE_DISCOUNT: 'Desconto no preço',
    SELLER_CAMPAIGN: 'Campanha do vendedor', SELLER_COUPON_CAMPAIGN: 'Cupom do vendedor', MARKETPLACE_CAMPAIGN: 'Campanha do marketplace', PRICE_MATCHING: 'Preço competitivo' }
  r.ofertas = { disponivel: true, total: 9, promocoes: Object.keys(T).map(t => pr(t, 'started')) }
  const h2 = renderSemanal(r)
  for (const rot of Object.values(T)) assert.ok(h2.includes(`<td>${rot}</td>`), rot)
  assert.ok(h2.includes('Ofertas ativas no Mercado Livre</span> &nbsp;9 ativas') && !h2.includes('Consulta limitada'))
  r.ofertas = { disponivel: true, total: 2, promocoes: [pr('DEAL', 'candidate'), pr('SMART', 'finished')] }
  assert.ok(!renderSemanal(r).includes('Ofertas ativas'), 'nenhuma ativa/programada: sem tabela')
}
ok('[16] ofertas: só ativas/programadas, tipos e situação em português, contagem igual às linhas, aviso de lista limitada')

// 21) [24] efeito da otimização é INFORMADO pela equipe — nunca "Efeito observado" nem "movem venda"
{
  const r = cheio('analitico')
  r.otimizacoes = [{ titulo: 'Ajuste de título do kit', processo: 'ML', mudanca: 'título', efeito: 'Vendas +40% na semana', evidencias: 0 }, { titulo: 'Troca de fotos', processo: 'ML', mudanca: 'fotos', efeito: '' }]
  const h = renderSemanal(r)
  assert.ok(!/Efeito observado|movem venda|efeito observado|a medir no próximo ciclo/.test(h), 'sem afirmar efeito observado')
  assert.ok(h.includes('<th>Efeito informado pela equipe</th>') && h.includes('Vendas +40% na semana') && h.includes('— não informado no card'))
}
ok('[24] otimizações: coluna "Efeito informado pela equipe", título neutro, efeito vazio = "não informado"')

// 22) [29] atrasadas/bloqueadas: os mesmos números na situação, na abertura e no tile (builders reais; t1 bloqueada E atrasada)
{
  const t1 = { id: 't1', titulo: 'Kit novo', prazo: '2026-10-01', responsavel: 'Ana', status: 'bloqueada' }, t2 = { id: 't2', titulo: 'Trocar fotos', prazo: '2026-10-02', responsavel: 'Bia', status: 'andamento' }
  const atividades = volumeAtividades({ de: DE, ate: ATE, concluidas: [], abertas: [t1, t2], atrasadas: [t1, t2], bloqueadas: [t1] })
  const situacao = situacaoDaConta({ atrasadas: [t1, t2], bloqueadas: [t1], plano: { anoMes: '2026-10', total: 4, concluidas: 2, pct: 50 }, hoje: '2026-10-05' })
  const h = renderSemanal({ perfil: { regras: REGRAS.ansioso }, identificacao: { cliente: 'X', periodo: '28/09/2026 a 04/10/2026' }, atividades, situacao })
  assert.ok(h.includes('Pontos em atenção — atrasadas: 2 · bloqueadas: 1') && h.includes('Atrasadas: 2 · bloqueadas: 1.'), 'situação e abertura com a mesma contagem')
  assert.ok(/<div class="num risco">2<\/div><div class="lbl">Atrasadas/.test(h) && !/1 atrasada\(s\)/.test(h), 'tile = situação = abertura; nada de "1 atrasada(s)"')
}
ok('[29] atrasadas: uma fonte (r.atividades) na situação, na abertura e no tile do Volume')

// 23) [30] pontos de atenção: sem "— —" quando falta responsável, e o prazo não se repete
{
  const r = cheio('analitico')
  r.atencao = [{ tipo: 'Atraso', texto: 'Trocar fotos (prazo 01/10/2026)', responsavel: '—', prazo: '2026-10-01' }, { tipo: 'Bloqueio', texto: 'Kit novo — aguardando fornecedor', responsavel: '—', prazo: null }]
  const s = secao(renderSemanal(r), 'atencao')
  assert.ok(!s.includes('— —') && !s.includes('—</span>'), 'responsável "—" não vira "— —"')
  assert.equal(conta(s, /01\/10\/2026/g), 1, 'prazo que já está no texto não se repete')
  assert.equal(conta(s, /— responsável a definir/g), 2)
}
ok('[30] pontos de atenção: "responsável a definir" no lugar de "— —"; prazo sem duplicar')

// 23b) dependência do cliente: tile "Aguardando você" só quando > 0; "Depende de você" sem responsável/prazo; nível verde continua; abertura tranquilizadora
{
  for (const p of PERFIS) assert.ok(!H[p].includes('Aguardando você'), `${p}: sem dependência, sem tile`)
  const r = cheio('ansioso'); r.atividades.depende_cliente = 2
  r.atencao = [{ tipo: 'Depende de você', texto: 'Subir fotos — Fotos do produto: 12 SKUs · aguardando desde 20/09/2026 (15 dia(s))', url: 'https://notion.so/d1', responsavel: '', prazo: null },
    { tipo: 'Atraso', texto: 'Algo atrasou', responsavel: 'Ana', prazo: '2026-10-08' }]
  r.situacao = situacaoDaConta({ atrasadas: [], bloqueadas: [], dependencias: [{ id: 'd1', titulo: 'Subir fotos' }, { id: 'd2', titulo: 'Custos' }], plano: { anoMes: '2026-10', total: 10, concluidas: 6, pct: 60 }, hoje: '2026-10-05' })
  const h = renderSemanal(r)
  assert.ok(/<div class="num">2<\/div><div class="lbl">Aguardando você/.test(h), 'tile neutro (sem classe de risco) só quando > 0')
  assert.ok(h.includes('Nenhuma tarefa atrasada ou bloqueada. 2 aguardam um retorno seu.'), 'abertura tranquilizadora')
  assert.ok(h.includes('class="situacao ok"') && h.includes('>verde<') && h.includes('2 tarefa(s) aguardam um retorno seu — veja Pontos de atenção'), 'verde continua; a dependência é item △')
  const s = secao(h, 'atencao')
  assert.ok(s.includes('<b>Depende de você:</b> Subir fotos — Fotos do produto: 12 SKUs · aguardando desde 20/09/2026 (15 dia(s))</li>'), 'sem responsável nem prazo')
  assert.ok(s.includes('Algo atrasou <span class="quem">— Ana · prazo 08/10/2026</span>'), 'o atraso mantém responsável e prazo')
  assert.equal(conta(s, /Depende de você:/g), 1, '1 vez só')
  const r1 = cheio('ansioso'); r1.atividades.depende_cliente = 1; r1.situacao = situacaoDaConta({ dependencias: [{ id: 'd1' }], plano: { anoMes: '2026-10', total: 1, concluidas: 0, pct: 0 } })
  assert.ok(renderSemanal(r1).includes('Nenhuma tarefa atrasada ou bloqueada. 1 aguarda um retorno seu.'), 'singular')
  const A = volumeAtividades({ de: DE, ate: ATE, dependencias: [{ id: 'd1' }] })                          // builder real da frente DADOS chega ao tile
  assert.ok(renderSemanal({ perfil: { regras: REGRAS.analitico }, identificacao: { cliente: 'X' }, atividades: A }).includes('Aguardando você'))
  assert.ok(!LIXO.test(h))
}
ok('dependência do cliente: tile "Aguardando você" só com valor, "Depende de você" sem responsável/prazo, verde mantido com item △, abertura tranquilizadora')

// 24) [31] glossário sem termo repetido (ROAS/Investimento/Receita do ML Ads e da Shopee)
{
  const r = cheio('zero_conhecimento')
  r.resultados.outros = [{ ...r.resultados.outros[0], metricas: [...r.resultados.outros[0].metricas, M('ads_roas', 'ROAS', 5), M('ads_investimento', 'Investimento', 100, 'moeda'), M('ads_receita', 'Receita atribuída', 500, 'moeda')] }]
  const dts = [...renderSemanal(r).matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1])
  assert.ok(dts.includes('ROAS') && dts.includes('Investimento'))
  assert.equal(new Set(dts).size, dts.length, `termos repetidos: ${dts.filter((d, i) => dts.indexOf(d) !== i)}`)
}
ok('[31] glossário: cada termo uma vez só')

// 25) [32] provas mínimas: canal cuja fonte é o print mostra 1 miniatura; o excedente (e o limite 0) vira "+ N prints no card"
{
  const r = cheio('direto')
  r.acoes = []; r.tarefas_resultado.itens = []; r.ads.evidencias = []
  r.evidMetricas = [ev(9), ev(11)]
  r.resultados.outros = [{ canal: 'Shopee', tem_api: false, fonte: 'print', motivo: 'Sem integração automática com o canal; os números do período estão no print do painel, disponível no card do Notion.', metricas: [], evidencias: [ev(7), ev(8)], acoes_semana: 1 }]
  const s = secao(renderSemanal(r), 'resultados')
  assert.equal(conta(s, /<div class="thumb">/g), 1, 'Shopee (fonte = print): 1 miniatura mesmo no perfil direto')
  assert.ok(s.includes('+ 1 print no card') && s.includes('+ 2 prints no card'), 'limite 0 do ML e excedente da Shopee são anunciados')
  const tarefas = [{ id: 's1', processo: 'Shopee', titulo: 'Painel Shopee' }]
  const real = montarResultados({ de: DE, ate: ATE, tarefas, concluidas: tarefas, evPorTarefa: { s1: [ev(1)] }, ehMetrica: () => true })
  const h = renderSemanal({ perfil: { regras: REGRAS.direto }, identificacao: { cliente: 'X' }, resultados: real })
  assert.ok(!h.includes('anexado em print') && conta(h, /<div class="thumb">/g) === 1, 'builder real: o print do painel aparece; o texto não promete o que não mostra')
}
ok('[32] provas mínimas: canal só com print mostra 1 miniatura; "+ N prints no card" também com limite 0')

// 26) período parcial (frente DADOS: resultados.periodo_parcial.ate_hora): nunca "de mesma duração" com o dia em andamento
{
  const r = cheio('analitico')
  assert.ok(renderSemanal(r).includes('DE MESMA DURAÇÃO'))
  r.resultados.periodo_parcial = { ate_hora: '14:30' }
  const h = renderSemanal(r)
  assert.ok(h.includes(', INCLUI HOJE ATÉ 14:30 (DIA EM ANDAMENTO)') && !h.includes('DE MESMA DURAÇÃO'))
  assert.ok(h.includes('(inclui hoje até 14:30 — dia em andamento)') && !h.includes('(mesma duração)'), 'caixa "Como medimos" também')
}
ok('período parcial: "inclui hoje até HH:MM (dia em andamento)" no lugar de "de mesma duração"')

// ═══ 27) RELATÓRIO DE RESULTADOS (cliente que NÃO prioriza a lista de tarefas) e as seções novas ═══════
import { microGrafico } from '../src/lib/micro-grafico.js'
const MARCO = (k, rotulo, valores, deltas, ajustado = {}) => ({ k, rotulo, estado: 'ok', valores, motivos: {}, deltas, ajustado, de: '2026-09-21', ate: '2026-09-21' })
function comResultado(r, { estado = 'queda' } = {}) {
  const q = { janela_base: { de: '2026-09-06', ate: '2026-09-19', dias: 14 }, base: { valores: { visitas: 40, unidades: 2, receita: 100, conversao: 5, ads_clicks: 3, ads_custo: 4 }, motivos: {} },
    marcos: [MARCO('d1', '24h', { visitas: 48, unidades: 3, receita: 150, conversao: 6.2, ads_clicks: 4, ads_custo: 4 }, { visitas: { pct: 20 }, unidades: { pct: 50 }, receita: { pct: 50 }, conversao: { pontos: 1.2 }, ads_clicks: { pct: 33.3 }, ads_custo: { pct: 0 } }),
      MARCO('d2', '48h', { visitas: 50, unidades: 3 }, { visitas: { pct: 25 }, unidades: { pct: 50 } }), MARCO('d3', '72h', { visitas: 31 }, { visitas: { pct: -22.5 } }),
      { k: 'd7', rotulo: '1 semana', estado: 'aguardando', de: '2026-09-21', ate: '2026-09-27', disponivel_em: '2026-09-28' }],
    hoje: { k: 'hoje', rotulo: 'hoje', estado: 'ok', valores: { visitas: 55, unidades: 3.5 }, deltas: { visitas: { pct: 37.5 }, unidades: { pct: 75 } }, ajustado: {}, atualizado_ate: '2026-10-04' } }
  const svg = microGrafico({ valores: [3, 4, 3, 4, 3, 5, 8, 9, 10], marcadorIdx: 5, base: 3.5, sinal: 'positivo', rotulo: 'Visitas por dia' })
  const card = (i, extra = {}) => ({
    tarefa: { id: `c${i}`, titulo: `Otimizar título ${i} ${MAL}`, tipo: 'Duplicação de Títulos', analista: 'Ana', status: 'concluida', url: 'https://notion.so/c', data: '2026-09-20', data_estimada: i === 2 },
    vinculo: { origem: ['citado'], n_itens: 3 }, itens: [{ item_id: `MLB${i}`, titulo: `Coleira ${MAL}`, thumb: 'https://http2.mlstatic.com/D_1.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-1', preco: 59.9, status: 'active', mudancas: [{ campo: 'titulo', rotulo: 'Título', antes: 'Coleira G', agora: `Coleira Gatos ${MAL}` }, { campo: 'preco', rotulo: 'Preço', antes: 59.9, agora: 49.9 }] }], itens_extra: 2,
    quadro: q, grafico: { metrica: 'visitas', svg }, medido: { estado: 'melhorou', rotulo: 'Melhorou (ajustado pelo controle)', efeito_pct: 38.2, receita_alocada: 1240.5, confianca: { score: 72 } },
    plano: { id: 'PS-0123456789', meta: 'conversão ≥ 6%', previsto_base: 800 }, gerou_resultado: true, leitura: 'Em 48h: visitas/dia 40 → 50 (+25%). Isso é associação temporal — não prova que a tarefa causou a variação.', ...extra })
  r.tarefas_anuncio = { dias: 45, resumo: { tarefas_com_anuncio: 5, gerou_resultado: 2, sem_anuncio_identificado: 3 }, cartoes: [card(1), card(2, { medido: { estado: 'lancamento', rotulo: 'Lançamento', receita_alocada: 90 } })] }
  r.full = { disponivel: true, tem_full: true, anuncios_full: 4, anuncios_total: 10, receita: { atual: 9000, anterior: 6000, pct: 50 }, unidades: { atual: 120, anterior: 90, pct: 33.3 }, share_pct: 62.5, share_anterior_pct: 55, estoque_total: 300, cobertura_dias: 74, conversao: { full: 3.1, fora_do_full: 1.9 }, risco_ruptura: [{ id: 'MLB9', titulo: `Kit ${MAL}`, cobertura_dias: 4 }], leitura: '4 anúncio(s) no Full responderam por 62,5% da receita do período.' }
  r.retro = { combos: { n_episodios: 6, n_medidos: 5, min_n: 3, leitura: '1 combinação(ões) com resultado positivo recorrente (mínimo 3 episódios).',
      funcionam: [{ chave: 'Duplicação de Títulos + Melhorar Imagens', n: 4, melhorou: 3, sem_efeito: 1, piorou: 0, efeito_mediano_pct: 35, amostra_pequena: false }], candidatas: [], pioram: [{ chave: `Criar Kits + Campanhas de Desconto ${MAL}`, n: 3, melhorou: 0, sem_efeito: 1, piorou: 2, efeito_mediano_pct: -22, amostra_pequena: true }] },
    pior_tarefa: { disponivel: true, tipos: [{ tipo: 'Otimizar Anúncios', n: 37, melhorou: 4, sem_efeito: 20, piorou: 13, leitura: '"Otimizar Anúncios": 4 melhoraram, 13 pioraram.', conta: { n: 3, piorou: 3 } }], tarefas_individuais: [{ titulo: `Mexer na capa ${MAL}`, tipo: 'Melhorar Anúncios', data: '2026-07-15', efeito_pct: -75.4 }], cuidados: ['Rodar primeiro em UM anúncio piloto.', 'Ter o rollback pronto.'], aviso: 'Associação temporal ajustada — pode haver outra causa. Por isso a recomendação é piloto, não proibição.' },
    pareto: { itens: { disponivel: true, pct_alvo: 80, leitura: '19 de 49 anúncios (38.8%) geram 80% da receita do período.', alerta: 'Um único anúncio responde por 41% da receita.', itens: [{ id: 'MLB1', titulo: `Mordedor ${MAL}`, thumb: 'https://http2.mlstatic.com/D_2.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-1', receita: 2793, share_pct: 13.8, acum_pct: 13.8 }] },
      tarefas: { disponivel: true, periodo_dias: 90, leitura: '2 de 11 tarefas medidas concentram 80% do ganho.', por_tipo: [{ tipo: 'Duplicação de Títulos', n: 5, melhorou: 3, ganho: 900, share_pct: 72.5 }] } } }
  r.proximas_acoes = [{ titulo: `Repor estoque: Kit ${MAL}`, prazo: '2026-10-09', retro: { motivo: 'em queda esta regra pesa ×1,25; "Planejamento full" melhorou em 7 de 10 tarefas' } }]
  const e = { estado, rotulo: estado === 'queda' ? 'Queda' : 'Crescimento', forca: 'forte', variacao_pct: estado === 'queda' ? -31.5 : 69.2, receita: { atual: 7000, anterior: 10220 }, unidades: { atual: 90, anterior: 140 }, janela_dias: 14, confirmacao_28d: { estado: 'estagnacao', variacao_pct: 2.1 }, sinal_misto: 'Os últimos 14 dias estão em queda, mas o mês ainda aparece estável.' }
  r.desempenho = { estado: e, leitura: estado === 'queda' ? 'A conta está em QUEDA forte (-31,5% de receita).' : 'A conta está em CRESCIMENTO forte (+69,2%).', ciclo_anterior: { dia: '2026-09-22', estado: 'estagnacao', evolucao: 'piorou' },
    queda: estado === 'queda' ? { motivos: [{ rotulo: 'Estoque curto em anúncio que vende', tipo: 'fato', texto: '2 anúncios com estoque para menos de 10 dias.', evidencia: 'MLB9: 4 dia(s)', acao: 'Repor antes de zerar.', itens: [{ id: 'MLB9', titulo: `Kit ${MAL}`, thumb: 'https://http2.mlstatic.com/D_3.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-9', delta: -820 }] }, { rotulo: 'A equipe entregou menos', tipo: 'hipotese', interno: true, texto: 'Entregas caíram de 6 para 1.', evidencia: '', itens: [] }],
      acoes: [{ regra: 'estoque_ruptura', descricao: 'Repor estoque antes de zerar' }], tarefas: [{ tipo: 'Planejamento full', veredito: 'funciona', n: 10, melhorou: 7 }], atitudes: ['Mudar poucos anúncios por vez.', 'Avisar o cliente antes que ele perceba.'] } : null,
    jogadas: estado === 'queda' ? null : { titulo: 'Proteger o que cresce', leitura: 'A conta está vendendo mais.', atitudes: ['Escalar verba em passos de 30%.'], jogadas: [{ titulo: '1. Proteger o ritmo', porque: 'Crescer com estoque curto vira ruptura.', extra: 'Nenhum anúncio em janela de proteção agora.' }] } }
  return r
}
const resultadosSo = p => { const r = comResultado(cheio(p)); r.perfil.regras = { ...REGRAS[p], lista_tarefas: false }; return r }
const ORDEM_RES = ['resultados', 'desempenho', 'full', 'venda_detalhe', 'combos', 'pior', 'pareto', 'atencao']

for (const p of PERFIS) {
  const r = resultadosSo(p), h = renderSemanal(r), i = renderSemanal(r, { interno: true })
  assert.deepEqual(sec(h), p === 'ansioso' ? ['situacao', ...ORDEM_RES] : ORDEM_RES, `${p}: relatório de resultados — só estas seções, nesta ordem`)
  for (const proibida of ['Volume de atividades', 'Ações concluídas na semana', 'Otimizações da semana', 'Tarefas que geraram resultado</h2>', 'class="plano"', 'data-acao="1"'])
    assert.ok(!h.includes(proibida), `${p}: cliente que não prioriza tarefas não vê "${proibida}"`)
  assert.ok(!LIXO.test(h) && !LIXO.test(i), `${p}: sem lixo de template (${(h.match(LIXO) || i.match(LIXO))?.[0]})`)
  assert.ok(!h.includes(MAL) && !i.includes(MAL) && !h.includes('<script>alert'), `${p}: HTML malicioso escapado nas seções novas`)
  const nums = [...h.matchAll(/Seção (\d\d)</g)].map(m => m[1]); assert.deepEqual(nums, nums.map((_, k) => String(k + 1).padStart(2, '0')), `${p}: numeração sequencial`)
  assert.ok(/<p class="abertura">[^<]*QUEDA forte/.test(h) && !/ação concluída|ações concluídas/.test(h.match(/<p class="abertura">[^<]*<\/p>/)[0]), `${p}: a abertura fala do estado da conta, não de contagem de ações`)
  assert.ok(!h.includes('Algo atrasou'), `${p}: o atraso interno não vai para quem não prioriza tarefas`)
  assert.equal(h.includes('Depende de você'), p === 'proativo', `${p}: "Depende de você" só no proativo (links abertos)`)
}
ok('modo só-resultados (lista_tarefas=false) × 7 perfis: seções e ordem, sem volume/ações/otimizações/plano, abertura pelo estado, sem lixo e sem HTML malicioso')

// o mesmo dado no modo "prioriza tarefas": tarefas E resultados
{
  const r = comResultado(cheio('analitico')), h = renderSemanal(r)
  const s = sec(h)
  assert.ok(h.includes('class="plano"'), 'barra do plano mantida')
  for (const k of ['volume', 'tarefas', 'acoes', 'otimizacoes', 'desempenho', 'full', 'venda_detalhe', 'combos', 'pior', 'pareto']) assert.ok(s.includes(k), `lista_tarefas=true mantém/inclui ${k}`)
  assert.ok(idx(h, 'data-sec="desempenho"') < idx(h, 'data-sec="volume"') && idx(h, 'data-sec="resultados"') < idx(h, 'data-sec="desempenho"'), 'resultados → desempenho → volume')
  const rEnx = comResultado(cheio('direto')); assert.ok(sec(renderSemanal(rEnx)).indexOf('desempenho') < sec(renderSemanal(rEnx)).indexOf('tarefas'))
  // atenção completa só para quem prioriza tarefas; os demais só veem o que depende deles
  const ra = resultadosSo('analitico'); ra.atencao = [{ tipo: 'Atraso', texto: 'Algo atrasou' }, { tipo: 'Sem evidência', texto: 'Sem print' }, { tipo: 'Depende de você', texto: 'Enviar as fotos', responsavel: 'Cliente' }]
  const sa = secao(renderSemanal(ra), 'atencao'); assert.ok(sa.includes('Enviar as fotos') && !sa.includes('Algo atrasou') && !sa.includes('Sem print'))
  const rb = comResultado(cheio('analitico')); rb.atencao = ra.atencao; const sb = secao(renderSemanal(rb), 'atencao'); assert.ok(sb.includes('Algo atrasou') && sb.includes('Sem print'))
}
ok('lista_tarefas=true: tarefas + resultados; atenção completa só para quem prioriza tarefas')

// queda: motivos, ações, tarefas e atitudes; crescimento: jogadas; sinal misto e ciclo anterior
{
  const h = secao(renderSemanal(resultadosSo('analitico')), 'desempenho')
  for (const t of ['Queda forte', '-31,5%', 'Por que caiu', 'Estoque curto em anúncio que vende', 'Repor antes de zerar.', 'Ações recomendadas', 'Repor estoque antes de zerar', 'Tarefas que mais ajudam', 'Planejamento full', 'já funcionou nesta conta', '7 de 10 melhoraram', 'Atitudes', 'Mudar poucos anúncios por vez.', 'Os últimos 14 dias estão em queda', 'CICLO ANTERIOR', 'PIOROU', 'Próximas ações do plano', 'Priorizada pelo impacto estimado']) assert.ok(h.includes(t), `queda: faltou "${t}"`)
  assert.ok(!h.includes('em queda esta regra pesa'), 'o cliente não lê o peso interno das regras')
  assert.ok(!h.includes('A equipe entregou menos') && !h.includes('INTERNO'), 'motivo sobre o trabalho da própria equipe é interno')
  const hi = secao(renderSemanal(resultadosSo('analitico'), { interno: true }), 'desempenho')
  assert.ok(hi.includes('A equipe entregou menos') && hi.includes('em queda esta regra pesa') && hi.includes('INTERNO'), 'o interno vê tudo')
  assert.ok(h.includes('class="estado e-queda"') && h.includes('dado</span>'), 'fato rotulado'); assert.ok(renderSemanal(resultadosSo('analitico'), { interno: true }).includes('hipótese</span>'), 'hipótese rotulada (no interno aparece a da equipe)')
  assert.ok(h.includes('class="mini-item"') && h.includes('−R$ 820,00'), 'anúncio que mais perdeu, com imagem e valor')
  const c = secao(renderSemanal(comResultado(cheio('analitico'), { estado: 'crescimento' }) && (() => { const r = comResultado(cheio('analitico'), { estado: 'crescimento' }); r.perfil.regras = { ...REGRAS.analitico, lista_tarefas: false }; return r })()), 'desempenho')
  assert.ok(c.includes('e-crescimento') && c.includes('Proteger o que cresce') && c.includes('1. Proteger o ritmo') && !c.includes('Por que caiu'), 'crescimento: jogadas, sem diagnóstico de queda')
}
ok('desempenho: queda traz motivos/ações/tarefas/atitudes; crescimento traz jogadas; sinal misto e ciclo anterior')

// cartão de tarefa: anúncio com imagem, tabela antes × 24h × 48h × 72h × 1 semana × hoje, gráfico, ganho, o que mudou
{
  const h = secao(renderSemanal(resultadosSo('tecnico')), 'venda_detalhe')
  assert.equal(conta(h, /data-venda="1"/g), 2)
  for (const t of ['<img src="https://http2.mlstatic.com/D_1.jpg"', 'MLB1', 'R$ 59,90', '+ 2 outros anúncios na mesma tarefa', 'Antes', '24h', '48h', '72h', '1 semana', 'Hoje', 'fecha em 28/09/2026', 'Visitas por dia', 'Cliques de Ads por dia', 'Investimento em Ads por dia',
    '+20%', '+1,2 p.p.', '-22,5%', 'class="micro"', 'Ganho associado (estimativa)', 'R$ 1.240,50', 'efeito ajustado +38,2%', 'O que mudou no anúncio', 'Coleira G', 'R$ 59,90', 'R$ 49,90', 'data estimada', 'META "conversão ≥ 6%"', 'PREVISTO (CENÁRIO BASE) R$ 800,00', 'CONFIANÇA 72/100', 'associação temporal'])
    assert.ok(h.includes(t), `cartão: faltou "${t}"`)
  assert.ok(h.includes('class="b"') && h.includes('class="r"'), 'delta bom em verde e ruim em vermelho')
  assert.ok(h.includes('Vendas depois da tarefa (valor bruto)') && h.includes('NÃO HÁ BASE NEM GRUPO DE CONTROLE'), 'lançamento é rotulado como valor bruto, sem ajuste')
  assert.ok(!/class="r">\+/.test(h), 'subida de visitas nunca vermelha')
  // gráfico: SVG inseguro nunca entra
  const r = resultadosSo('analitico'); r.tarefas_anuncio.cartoes[0].grafico.svg = '<svg class="micro" viewBox="0 0 1 1"><script>alert(9)</script></svg>'; r.tarefas_anuncio.cartoes[1].grafico = { svg: '<img src=x onerror=alert(8)>' }
  const hx = renderSemanal(r); assert.ok(!hx.includes('alert(9)') && !hx.includes('onerror=alert(8)'), 'svg com script/onerror é descartado')
  // marco com dado faltando: "—" + motivo, nunca zero
  const r2 = resultadosSo('analitico'); r2.tarefas_anuncio.cartoes[0].quadro.marcos[0] = { k: 'd1', rotulo: '24h', estado: 'ok', valores: { visitas: null }, motivos: { visitas: 'visitas desta janela não coletadas' }, deltas: {} }
  assert.ok(secao(renderSemanal(r2), 'venda_detalhe').includes('title="visitas desta janela não coletadas">—'), 'célula sem dado: "—" com o motivo')
  // sem nenhum cartão: texto honesto
  const r3 = resultadosSo('analitico'); r3.tarefas_anuncio = { dias: 45, resumo: { tarefas_com_anuncio: 4, gerou_resultado: 0 }, cartoes: [] }
  const s3 = secao(renderSemanal(r3), 'venda_detalhe'); assert.ok(s3.includes('Nenhuma tarefa dos últimos 45 dias teve melhora medida') && s3.includes('4 tarefas com anúncio identificado foram acompanhadas'), s3)
}
ok('cartão da tarefa: anúncio com imagem, antes × marcos × hoje, gráfico seguro, ganho, mudanças, "—" com motivo, lançamento sem ajuste')

// full, combinações, tarefa de cuidado, 80/20
{
  const r = resultadosSo('analitico')
  const f = secao(renderSemanal(r), 'full'); for (const t of ['Mercado Livre Full', 'Anúncios com venda no Full', 'R$ 9.000,00', '62,5%', '74 dias', 'Risco de ruptura no Full', '4 dia(s) de estoque', 'fora do Full 1,9%']) assert.ok(f.includes(t), `full: ${t}`)
  const c = secao(renderSemanal(r), 'combos'); for (const t of ['Quais tarefas juntas melhoraram', 'Duplicação de Títulos + Melhorar Imagens', 'Combinações que não deram certo', 'amostra pequena', 'a amostra só vira padrão a partir de 3 casos']) assert.ok(c.includes(t), `combos: ${t}`)
  const pi = secao(renderSemanal(r), 'pior'); for (const t of ['Otimizar Anúncios', '3 tarefas medidas deste tipo, 3 seguida(s) de piora', 'piloto de 14 dias em UM anúncio', 'Como fazer com cuidado', 'Rodar primeiro em UM anúncio piloto', 'piloto, não proibição', 'Tarefas desta conta seguidas de piora']) assert.ok(pi.includes(t), `pior: ${t}`)
  assert.ok(!pi.includes('37 TAREFAS') && !pi.includes('BASE:'), 'a estatística da base inteira (outros clientes) não vai ao cliente')
  assert.ok(secao(renderSemanal(r, { interno: true }), 'pior').includes('BASE: 37 TAREFAS MEDIDAS'), 'o interno vê a base')
  { const rr = resultadosSo('analitico'); rr.retro.pior_tarefa.tipos = [{ tipo: 'Criar Kits', n: 20, melhorou: 1, sem_efeito: 12, piorou: 7, leitura: 'x', conta: null }]; rr.retro.pior_tarefa.tarefas_individuais = []
    assert.ok(!renderSemanal(rr).includes('data-sec="pior"'), 'tipo que a conta nunca usou: o cliente não vê a seção'); assert.ok(renderSemanal(rr, { interno: true }).includes('data-sec="pior"')) }
  const pa = secao(renderSemanal(r), 'pareto'); for (const t of ['Os 20% que geram 80%', '19 de 49 anúncios', 'Um único anúncio responde por 41%', 'Ações que mais geraram resultado', 'Duplicação de Títulos', 'R$ 900,00', 'tarefas dos últimos 90 dias']) assert.ok(pa.includes(t), `pareto: ${t}`)
  // sem Full / sem dado: cliente não vê bloco vazio; interno vê o porquê
  const rs = resultadosSo('analitico'); rs.full = { disponivel: false, motivo: 'a logística (Full ou não) dos anúncios ainda não foi coletada' }
  assert.ok(renderSemanal(rs).includes('ainda está sendo coletado e entra no próximo relatório') && !renderSemanal(rs).includes('logística (Full ou não)'), 'logística ainda não coletada: o cliente vê uma linha honesta (sem jargão)'); assert.ok(renderSemanal(rs, { interno: true }).includes('data-sec="full"'))
  const rx = resultadosSo('analitico'); rx.full = { disponivel: false, motivo: 'sem dados coletados do Mercado Livre' }
  assert.ok(!renderSemanal(rx).includes('data-sec="full"') && renderSemanal(rx, { interno: true }).includes('visível só na versão interna'), 'outro motivo: só o interno vê')
  const rn = resultadosSo('analitico'); rn.full = { disponivel: true, tem_full: false, leitura: 'Nenhum anúncio com venda no período está no Full.' }
  assert.ok(secao(renderSemanal(rn), 'full').includes('Nenhum anúncio com venda no período está no Full.'))
  // tudo ausente (geração antiga/sem conta conectada): relatório sai, sem as seções novas e sem lixo
  const rv = { perfil: { regras: { ...REGRAS.analitico, lista_tarefas: false } }, identificacao: { cliente: 'X' } }
  assert.ok(!LIXO.test(renderSemanal(rv)) && !LIXO.test(renderSemanal(rv, { interno: true })))
  assert.ok(renderSemanal(rv, { interno: true }).includes('visível só na versão interna'))
}
ok('Full, combinações, tarefa de cuidado e 80/20; indisponível só aparece no interno; relatório sem dados novos não quebra')

// vazamentos e jargão no PDF do cliente que só mostra resultados
{
  for (const p of PERFIS) {
    const r = resultadosSo(p); r.resultados.acoes_relacionadas = ['Reunião Gravada - PLANO DE ACAO']; r.ads.acoes = ['Campanha X ajustada']; r.resultados.ads.acoes = ['Campanha X ajustada']
    const h = renderSemanal(r)
    for (const v of ['Reunião Gravada - PLANO DE ACAO', 'Campanha X ajustada', 'AÇÃO CONCLUÍDA', 'AÇÕES CONCLUÍDAS NO CANAL']) assert.ok(!h.includes(v), `${p}: título de tarefa/ação (${v}) não vaza quando não lista tarefas`)
    assert.ok(!h.includes('Notion') && !h.includes('Fonte oficial'), `${p}: sem jargão "Notion" no PDF do cliente`)
    assert.ok(h.includes('Fonte: Mercado Livre (API) e registros da Place2u'))
    assert.ok(renderSemanal(r, { interno: true }).includes('Notion sincronizado'), `${p}: o interno mantém a linha do Notion`)
  }
  // com lista de tarefas, o que sempre existiu continua
  const rl = comResultado(cheio('analitico')); assert.ok(renderSemanal(rl).includes('Ações executadas no mesmo período'), 'lista_tarefas=true mantém as ações relacionadas')
  // cartão com 2 anúncios: os dois aparecem (imagem, preço), status traduzido, aviso de métricas somadas
  const r2 = resultadosSo('tecnico'); const c0 = r2.tarefas_anuncio.cartoes[0]
  c0.itens = [c0.itens[0], { item_id: 'MLB77', titulo: 'Segundo anúncio', thumb: 'https://http2.mlstatic.com/D_9.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB-77', preco: 10, status: 'paused' }]; c0.itens_extra = 0; c0.vinculo = { n_itens: 2 }
  const s2 = secao(renderSemanal(r2), 'venda_detalhe')
  assert.ok(s2.includes('MLB77') && s2.includes('Segundo anúncio') && s2.includes('D_9.jpg') && s2.includes('· pausado') && !s2.includes('· paused') && s2.includes('MÉTRICAS SOMADAS DE 2 ANÚNCIOS'), 'todos os anúncios da tarefa, status em português')
  // lançamento: tag neutra (não a verde de "Melhorou"); efeito ajustado absurdo vira "mais de +300%"
  const sl = secao(renderSemanal(resultadosSo('tecnico')), 'venda_detalhe')
  assert.ok(/t-informado">Lançamento/.test(sl) && /t-medido">Melhorou/.test(sl), 'Lançamento e Melhorou não têm a mesma cor')
  const r3 = resultadosSo('tecnico'); r3.tarefas_anuncio.cartoes[0].medido.efeito_pct = 1114.5
  const s3 = secao(renderSemanal(r3), 'venda_detalhe'); assert.ok(s3.includes('mais de +300%') && !s3.includes('1.114'), 'percentual de base pequena não é impresso')
}
ok('cliente só-resultados: sem título de tarefa/jargão Notion, cartão com todos os anúncios, Lançamento em cor própria, percentual absurdo limitado')

// micro gráfico: números válidos, vertical e horizontal, escape do título
{
  const g = microGrafico({ valores: [1, 2, 1, 3, 6, 7, 8], marcadorIdx: 3, base: 1.6, sinal: 'positivo', rotulo: `T ${MAL}` })
  assert.ok(g.startsWith('<svg class="micro"') && !/NaN|undefined|Infinity/.test(g) && !g.includes(MAL) && g.includes('stroke-dasharray'))
  assert.equal(conta(g, /<polyline/g), 2)
  assert.equal(microGrafico({ valores: [1, 2] }), '')
}
ok('micro gráfico SVG: só números, título escapado, sem NaN')

console.log(`\n${n} grupos de verificação passaram.`)
