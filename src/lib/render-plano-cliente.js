// Documento do plano de ação por cliente — as 12 partes da "entrega final" do roteiro do estrategista
// (config/prompt-estrategista.md §15). Regra do roteiro: o que ainda não tem fonte conectada aparece como
// "especificado, não ativo" — nunca como número ou automação fingindo funcionar.
import { FONTES, CSS, esc, brData, capa, secTitulo, rodape } from './estilo-editorial.js'
import { playbook, addDias } from './plano-cliente.js'
import { linhasDePendencia, ordemPendencias } from './pendencias-texto.js'   // texto único das pendências do cliente (o mesmo do relatório curto, do PDF semanal e do relatório do sprint)

const ROT_TIPO = { fato: 'Fato observado', hipotese: 'Hipótese a testar', projecao: 'Projeção', pendente: 'Informação pendente' }
const ROT_H = { '72h': 'Primeiras 72 horas — riscos e correções urgentes', '7d': 'Próximos 7 dias — ações prioritárias', '30d': 'Próximos 30 dias — execução e testes', '90d': 'Próximos 90 dias — crescimento e sazonalidade' }
const ROT_ST = { proposta: 'Proposta', aprovada: 'Aprovada', descartada: 'Descartada', distribuida: 'No Notion', obsoleta: 'Obsoleta' }
const ROT_SIT = { observado: 'Observado', parcial: 'Parcial', sem_dados: 'Sem dados' }
const ROT_FONTE = { disponivel: 'Disponível', parcial: 'Parcial', indisponivel: 'Indisponível' }

const chip = (txt, tom = '') => `<span class="pl-chip ${tom}">${esc(txt)}</span>`
const tomTipo = { fato: 'ok', hipotese: 'gold', projecao: 'gold', pendente: 'cinza' }
const lista = itens => itens?.length ? `<ul class="pl-ul">${itens.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="vazio">—</p>'
const nao_ativo = txt => `<div class="pl-inativo"><b>Especificado, não ativo.</b> ${esc(txt)}</div>`

function tabelaAcoes(acoes) {
  if (!acoes.length) return '<p class="vazio">Nenhuma ação neste horizonte.</p>'
  return `<table class="pl-tab"><thead><tr><th>ID</th><th>Conta</th><th>Evidência</th><th>Problema / oportunidade</th><th>Ação específica</th><th>Responsável</th><th>Prazo</th><th>Dependência</th><th>Indicador → meta</th><th>Critério de aceite</th><th>Status</th></tr></thead><tbody>
${acoes.map(a => `<tr>
  <td class="mono">${esc(a.id)}<br><span class="pl-sc">prioridade ${a.score}</span></td>
  <td>${esc(a.canal || 'Geral')}<br><span class="pl-sc">SKU/anúncio: —</span></td>
  <td>${chip(ROT_TIPO[a.dados.evidencia_tipo], tomTipo[a.dados.evidencia_tipo])}<br>${esc(a.dados.evidencia)}<br><span class="pl-sc">${esc(a.dados.fonte)} · ${esc(a.dados.periodo)}</span></td>
  <td>${esc(a.dados.problema)}</td>
  <td><b>${esc(a.titulo)}</b><br>${esc(a.dados.acao)}</td>
  <td>${esc(a.responsavel || 'responsável a definir')}${a.squad ? `<br><span class="pl-sc">${esc(a.squad)}</span>` : ''}</td>
  <td>${esc(brData(a.prazo))}</td>
  <td>${esc(a.dados.dependencia)}</td>
  <td>${esc(a.dados.indicador_inicial)}<br><span class="pl-sc">meta: ${esc(a.dados.meta)}</span></td>
  <td>${esc(a.dados.criterio_aceite)}</td>
  <td>${esc(ROT_ST[a.status] || a.status)}</td>
</tr>`).join('')}</tbody></table>`
}

const ALERTAS = [
  ['Notion — tarefas', 'Diária', 'Hoje × últimos 14 dias', '≥ 1 tarefa aberta', `Sem entrega há ${playbook.limiares.dias_sem_entrega}+ dias`, '2 verificações seguidas', 'Média', 'Consultor do canal', 'Abrir ação "Retomar cadência" (regra sem_entrega — já gera ação ao regenerar o plano)'],
  ['Notion — tarefas', 'Semanal', '28 dias × 28 anteriores', `${playbook.limiares.queda_cadencia_base_minima} entregas na base`, `Queda ≥ ${playbook.limiares.queda_cadencia_pct}%`, '1 semana', 'Baixa', 'Consultor do canal', 'Investigar causa (regra queda_cadencia — já gera ação)'],
  ['Notion — tarefas', 'Diária', 'Hoje × última edição', `${playbook.limiares.min_paradas} tarefas`, `Paradas há ${playbook.limiares.dias_parada}+ dias`, '1 semana', 'Baixa', 'Consultor do canal', 'Revisar backlog (regra backlog_parado — já gera ação)'],
  ['API do Mercado Livre', 'Na geração do plano', '28 dias × 28 anteriores (períodos completos)', `${playbook.limiares.ml.min_pedidos_base} pedidos na base`, `Queda de faturamento ≥ ${playbook.limiares.ml.queda_faturamento_pct}%`, '1 janela (sem persistência implementada)', 'Alta', 'Consultor ML', 'Investigar preço, estoque, anúncio e sazonalidade antes de agir (regra ml_queda_faturamento — gera ação quando a conta está conectada)'],
  ['API do Mercado Livre', 'Na geração do plano', '28 dias × 28 anteriores', `${playbook.limiares.ml.min_visitas_base} visitas na base`, `Queda relativa de conversão ≥ ${playbook.limiares.ml.queda_conversao_rel_pct}% vs. o período anterior da própria conta`, '2 janelas seguidas', 'Média', 'Consultor ML', 'Rodada de otimização pela estratégia ímã (regra ml_queda_conversao)'],
  ['Estoque (Bling/Full)', 'Diária', 'Estoque disponível ÷ demanda média diária', 'Histórico de vendas do SKU', 'Cobertura < 10 dias (gatilho mínimo; não substitui o ponto de reposição)', '1 verificação', 'Alta', 'Responsável de estoque', 'Revisar reposição e envio ao Full — NÃO ATIVO (sem integração de estoque)'],
  ['Ads', 'Diária', 'ACOS observado × ACOS máximo da margem', 'Volume mínimo de cliques/pedidos', 'ACOS acima do limite econômico', '3 dias (atribuição atrasa)', 'Alta', 'Responsável de Ads', 'Propor redução/pausa, sem decidir por um único dia ruim — NÃO ATIVO (sem integração de Ads)'],
]

// pendencias: Pendencia[] do avaliador (a rota lê no momento de abrir o documento); pendenciasEm: 'AAAA-MM-DD' dessa leitura. Sem pendência a seção não aparece.
export function renderPlanoCliente(plano, acoes, { hoje = plano.gerado_em, pendencias = [], pendenciasEm = '' } = {}) {
  const r = plano.resumo, c = plano.central
  const pend = (Array.isArray(pendencias) ? pendencias : []).filter(p => p && typeof p === 'object' && p.rotulo).sort(ordemPendencias)
  const nPend = pend.length ? '12' : '', nFim = pend.length ? '13' : '12'     // a seção nova entra antes de "Pendências, decisões e próxima revisão"; sem pendência a numeração é a de sempre
  const ativas = acoes.filter(a => !['descartada', 'obsoleta'].includes(a.status))
  const porId = new Map(ativas.map(a => [a.id, a]))
  const top5 = r.top5.map(id => porId.get(id)).filter(Boolean)
  // contagens, gargalos e riscos saem das ações ATIVAS do banco (uma ação descartada depois
  // da geração não pode continuar contando no documento)
  const porH = h => ativas.filter(a => a.horizonte === h).length
  const kpis = { n: ativas.length, h72: porH('72h'), h7: porH('7d'), h30: porH('30d'), h90: porH('90d') }
  const gargalos = ativas.filter(a => a.dados.evidencia_tipo === 'fato' && a.regra !== 'calendario').slice(0, 3)
    .map(a => a.dados.evidencia.split(/(?<=\.)\s/)[0].replace(/\.$/, ''))
  const riscos = ativas.filter(a => a.horizonte === '72h').map(a => a.titulo)
  const dimensoes = plano.diagnostico.dimensoes
  const cal = plano.calendario
  const otim = ativas.filter(a => a.regra === 'alavanca_otimizacao' || a.regra === 'ml_queda_conversao')
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plano de ação — ${esc(plano.cliente)}</title>
${FONTES}
<style>${CSS}
  .pl-chip{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:9.5px;padding:1px 7px;border:1px solid var(--rule);border-radius:2px;color:var(--rule);white-space:nowrap}
  .pl-chip.ok{border-color:var(--sage);color:var(--sage)} .pl-chip.gold{border-color:var(--gold);color:var(--gold)} .pl-chip.cinza{border-color:var(--cinza);color:var(--cinza)} .pl-chip.blood{border-color:var(--blood);color:var(--blood)}
  .pl-tab{font-size:10.5px;width:100%} .pl-tab td,.pl-tab th{vertical-align:top;padding:7px 6px}
  .pl-sc{font-size:9.5px;color:var(--rule)} .mono{font-family:'JetBrains Mono',monospace;font-size:10px}
  .pl-ul{margin:4px 0 0 18px;padding:0;font-size:12.5px} .pl-ul li{margin:2px 0}
  .pl-inativo{border-left:3px solid var(--gold);background:#fffdfa;padding:10px 14px;font-size:12px;margin:10px 0}
  .pl-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0}
  .pl-kpi{border:1px solid rgba(42,37,32,.14);border-top:3px solid var(--accent);background:#fffdfa;padding:10px 12px}
  .pl-kpi b{display:block;font-size:22px;font-family:'Playfair Display',serif} .pl-kpi span{font-size:10px;color:var(--rule)}
  .pl-f{font-family:'JetBrains Mono',monospace;font-size:11px;background:#fffdfa;border:1px solid rgba(42,37,32,.14);padding:8px 12px;margin:6px 0;white-space:pre-wrap}
  .pl-h{font-size:13px;margin:18px 0 6px} section{margin-bottom:26px}
  @media(max-width:720px){.pl-kpis{grid-template-columns:repeat(2,1fr)}}
  @media print{.pl-tab{font-size:8.5px} section{page-break-inside:auto}}
</style>
</head>
<body>
<div class="pagina">

${capa({
    documento: 'Plano de ação',
    titulo: plano.cliente,
    subtitulo: [c.tier, c.nicho, c.canais.join(' · ')].filter(Boolean).join(' · ') || undefined,
    meta: [`Gerado em <b>${esc(brData(plano.gerado_em))}</b>`, `Consultor <b>${esc(c.consultor || 'a definir')}</b>`, `${esc(c.squad || 'squad a definir')}`, `Próxima revisão <b>${esc(brData(addDias(hoje, 7)))}</b>`],
  })}

<section>
  ${secTitulo('01', 'Resumo executivo', 'Cliente, fontes acessíveis e o que o plano pede nas próximas semanas.')}
  <div class="verdict"><span class="eyebrow">Leitura</span><p>${esc(r.texto)}</p></div>
  <div class="pl-kpis">
    <div class="pl-kpi"><b>${kpis.n}</b><span>ações ativas</span></div>
    <div class="pl-kpi"><b>${kpis.h72}</b><span>nas próximas 72 horas</span></div>
    <div class="pl-kpi"><b>${kpis.h7}</b><span>em 7 dias</span></div>
    <div class="pl-kpi"><b>${kpis.h30}</b><span>em 30 dias</span></div>
    <div class="pl-kpi"><b>${kpis.h90}</b><span>em 90 dias</span></div>
  </div>
</section>

<section>
  ${secTitulo('02', 'Fontes, períodos e qualidade dos dados', 'Cada conclusão do plano cita fonte, período, atualização e confiança. Nada é inventado: o que falta aparece como pendência.')}
  <table><thead><tr><th>Fonte</th><th>Situação</th><th>Período</th><th>Atualizado</th><th>Confiança</th><th>Observação</th></tr></thead><tbody>
  ${plano.fontes.map(f => `<tr><td>${esc(f.fonte)}</td><td>${chip(ROT_FONTE[f.status], f.status === 'disponivel' ? 'ok' : f.status === 'parcial' ? 'gold' : 'cinza')}</td><td>${esc(f.periodo)}</td><td>${esc(f.atualizado_em)}</td><td>${esc(f.confianca)}</td><td>${esc(f.nota || '')}</td></tr>`).join('')}
  </tbody></table>
  <p class="pl-sc" style="margin-top:8px">Legenda de evidência: ${Object.entries(ROT_TIPO).map(([k, v]) => chip(v, tomTipo[k])).join(' ')} — hipótese não é tratada como causa comprovada; melhora após uma alteração é descrita como associação temporal até haver evidência de causalidade.</p>
</section>

<section>
  ${secTitulo('03', 'Diagnóstico da conta', 'Seis dimensões. Onde não há dado conectado, a dimensão aparece "sem dados" — não "sem problema".')}
  <table><thead><tr><th>Dimensão</th><th>Situação</th><th>Fatos observados</th><th>Dados que faltam</th></tr></thead><tbody>
  ${dimensoes.map(d => `<tr><td><b>${esc(d.nome)}</b></td><td>${chip(ROT_SIT[d.situacao], d.situacao === 'observado' ? 'ok' : d.situacao === 'parcial' ? 'gold' : 'cinza')}</td><td>${lista(d.fatos)}</td><td>${lista(d.dados_faltantes)}</td></tr>`).join('')}
  </tbody></table>
  <p class="pl-h"><b>Meta e distância até a meta:</b> metas de faturamento, margem e investimento ainda não registradas para este cliente (consta nas pendências) — sem meta não há distância a calcular.</p>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
    <div><p class="pl-h"><b>Principais gargalos</b></p>${lista(gargalos)}</div>
    <div><p class="pl-h"><b>Oportunidades prioritárias</b></p>${lista(plano.diagnostico.oportunidades)}</div>
    <div><p class="pl-h"><b>Riscos imediatos (72h)</b></p>${lista(riscos)}</div>
  </div>
</section>

<section>
  ${secTitulo('04', 'Top 3 para acompanhamento diário', 'Escolha por contribuição financeira e risco.')}
  ${nao_ativo('Escolher os três produtos exige receita e margem por SKU/anúncio, que ainda não estão conectadas para este cliente. Assim que houver dado, o critério é: maior contribuição de margem e maior risco de ruptura/queda, explicando a escolha. Acompanhamento diário: receita, pedidos, disponibilidade e cobertura, preço e entrega, conversão (com amostra), Ads e status do anúncio/catálogo.')}
</section>

<section>
  ${secTitulo('05', 'Cinco prioridades da semana', 'Ordenadas por impacto × confiança × urgência ÷ esforço — a conta de cada uma está na coluna "Como a prioridade foi calculada".')}
  ${top5.length ? `<table><thead><tr><th>#</th><th>ID</th><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Por quê / como a prioridade foi calculada</th></tr></thead><tbody>
  ${top5.map((a, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(a.id)}</td><td><b>${esc(a.titulo)}</b></td><td>${esc(a.responsavel || 'responsável a definir')}</td><td>${esc(brData(a.prazo))}</td><td>${esc(a.dados.problema)}<br><span class="pl-sc">${esc(a.dados.logica)}</span></td></tr>`).join('')}
  </tbody></table>` : '<p class="vazio">Sem ações de curto prazo.</p>'}
  <p class="pl-h"><b>Plano completo por horizonte</b></p>
  ${['72h', '7d', '30d', '90d'].map(h => `<p class="pl-h"><b>${ROT_H[h]}</b></p>${tabelaAcoes(ativas.filter(a => a.horizonte === h))}`).join('')}
</section>

<section>
  ${secTitulo('06', 'Plano de otimização dos anúncios', 'Estratégia ímã: anúncios com demanda e tráfego que convertem abaixo da própria referência.')}
  ${otim.length ? tabelaAcoes(otim) : ''}
  ${nao_ativo('A lista de anúncios para otimizar depende de visitas, impressões e conversão por anúncio (API do canal ou exportação do painel). Para cada anúncio priorizado o plano entrega: objeção provável (conteúdo, oferta, preço, entrega ou confiança), alteração concreta (capa, título, atributos, descrição, vídeo, kit ou variação) e hipótese de teste. Potencial = visitas elegíveis × aumento hipotético de conversão — sempre como cenário, nunca promessa, considerando estoque e margem.')}
</section>

<section>
  ${secTitulo('07', 'Promoções, sazonalidade e demanda oculta', 'Calendário retroativo: data de consumo → entrega necessária → reposição → campanha → conteúdo e anúncios.')}
  <table><thead><tr><th>Data</th><th>Em</th><th>Conteúdo e anúncios até</th><th>Reposição / entrega até</th><th>Campanha no ar até</th><th>Estágio</th></tr></thead><tbody>
  ${cal.map(e => `<tr><td><b>${esc(e.nome)}</b><br><span class="pl-sc">${esc(brData(e.data))}</span></td><td>${e.dias} dias</td><td>${esc(brData(e.conteudo))}</td><td>${esc(brData(e.reposicao))}</td><td>${esc(brData(e.campanha))}</td><td>${chip(e.estagio, e.estagio === 'preparar agora' ? 'blood' : e.estagio === 'janela curta' ? 'gold' : 'cinza')}</td></tr>`).join('')}
  </tbody></table>
  <p class="pl-sc" style="margin-top:6px">Prazos de conteúdo (${playbook.lead_times.conteudo} d), reposição (${playbook.lead_times.reposicao} d) e campanha (${playbook.lead_times.campanha_no_ar} d) são <b>premissas padrão</b> — ajustar ao prazo real de fornecimento deste cliente. Só Black Friday e Natal viram ação para todos; as demais datas dependem do catálogo.</p>
  ${nao_ativo('Campanhas (produtos, oferta, período, estoque necessário, desconto máximo economicamente viável, margem prevista, critério de encerramento) e hipóteses de demanda oculta (produto, necessidade, público, termos de busca, evidência, mensagem, teste, métrica) dependem do catálogo, da margem e de dados de busca do cliente. Não recomendamos desconto sem margem validada nem presumimos exposição adicional de campanha sem checar elegibilidade; urgência artificial não entra.')}
</section>

<section>
  ${secTitulo('08', 'Estratégia de Ads e limites econômicos', 'Curvas A/B/C por receita e contribuição de margem — nunca só por faturamento.')}
  <p class="pl-h"><b>Fórmulas (percentuais em decimal)</b></p>
  <div class="pl-f">Margem pré-Ads   = (receita − custos variáveis sem Ads) ÷ receita
ACOS de equilíbrio = margem pré-Ads
ROAS de equilíbrio = 1 ÷ margem pré-Ads
ACOS máximo        = margem pré-Ads − contribuição desejada após Ads
ROAS mínimo        = 1 ÷ ACOS máximo       (ACOS máximo ≤ 0 → a oferta precisa ser revista)</div>
  <p class="pl-sc">Exemplo ilustrativo (não é dado do cliente): margem pré-Ads 30% e contribuição desejada 10% → ACOS máximo 20% → ROAS mínimo 5. Contribuição não é lucro líquido: despesas fixas ainda precisam ser cobertas. Diferenciar ROAS observado, meta configurada na plataforma e resultado esperado; olhar também TACOS e a contribuição total da conta — atribuição não prova venda incremental, e receita atribuída não se soma à receita total.</p>
  <table><thead><tr><th>Objetivo</th><th>Quando</th></tr></thead><tbody>
    <tr><td>Visibilidade</td><td>Testar descoberta e tráfego qualificado, com limite de perda e critérios de validação</td></tr>
    <tr><td>Crescimento</td><td>Aumentar volume de produtos com sinais positivos de conversão, margem e disponibilidade</td></tr>
    <tr><td>Escala</td><td>Ampliar produtos validados acompanhando rentabilidade marginal e capacidade de reposição</td></tr>
    <tr><td>Recuperação</td><td>Testar correções em produtos com histórico positivo e queda recente</td></tr>
  </tbody></table>
  ${nao_ativo('Sem dados de Ads (investimento, receita e pedidos atribuídos por campanha) e sem custos confiáveis por SKU, não há grupo de Ads nem ROAS alvo a definir — o plano trabalha em cenários e solicita os dados (ver Pendências). Não pausar por um único dia ruim nem escalar por uma única venda. Nenhuma campanha, orçamento ou lance é alterado por este sistema.')}
</section>

<section>
  ${secTitulo('09', 'Planejamento de estoque e Full', 'Cobertura por SKU e localização; Full por demanda, margem após logística, giro e risco de encalhe.')}
  <div class="pl-f">Cobertura (dias)    = estoque disponível ÷ demanda média diária estimada
Quantidade Full     = demanda projetada na cobertura planejada + estoque de segurança
                      − estoque disponível − entradas confirmadas no prazo   (nunca negativa)</div>
  <p class="pl-sc">Cobertura abaixo de <b>10 dias</b> gera alerta — é gatilho mínimo de monitoramento, não substitui o ponto de reposição quando prazo de fornecimento, preparação, transporte, recebimento e estoque de segurança exigem mais. Ajustar por caixa fechada, lote mínimo, capital e limites logísticos; apresentar cenários conservador, base e crescimento, cada percentual justificado por histórico, campanha ou teste. Verificar se o estoque do Bling já inclui estoque próprio ou Full antes de somar (dupla contagem).</p>
  ${nao_ativo('Sem exportação de estoque (Bling/ERP e painel Full) e demanda por SKU, não há cobertura nem quantidade sugerida a calcular. Tabela de entrega: SKU | estoques por localização | demanda/dia | cobertura | reposição | quantidade Full | custo | risco.')}
</section>

<section>
  ${secTitulo('10', 'Planilha e painel de acompanhamento', 'O painel é o Place Sprints; a planilha sai do painel em CSV.')}
  <p style="font-size:12.5px">Plano de ação deste cliente em CSV (abre no Excel/Google Sheets, UTF-8): <a href="/api/planos/acoes.csv?cliente=${encodeURIComponent(plano.cliente)}">baixar plano de ação</a>. IDs são estáveis (<span class="mono">PS-xxxxxxx</span>) e uma nova geração nunca duplica nem sobrescreve ação já aprovada, descartada ou enviada ao Notion.</p>
  <table><thead><tr><th>Aba prevista</th><th>Situação</th></tr></thead><tbody>
    <tr><td>Plano de ação</td><td>${chip('Ativo', 'ok')} exportação CSV com as 14 colunas do roteiro + squad, horizonte e prioridade</td></tr>
    <tr><td>Clientes e contas · Resumo semanal</td><td>${chip('Parcial', 'gold')} no painel (equipe, escopo e relatórios semanais já existentes)</td></tr>
    <tr><td>Métricas diárias · Produtos e anúncios · Estoque e Full · Ads e rentabilidade · Histórico de alterações · Alertas</td><td>${chip('Não ativo', 'cinza')} dependem das integrações de vendas por SKU, estoque, Ads e custos</td></tr>
  </tbody></table>
  <p class="pl-sc" style="margin-top:6px">Regra de fórmulas ao implantar as abas: denominador zero = "sem base", nunca desempenho normal; sinalizar visualmente variações, CTR/CPC/ACOS/ROAS/TACOS, margem de contribuição, cobertura, desvio de meta, dado desatualizado e ação vencida.</p>
</section>

<section>
  ${secTitulo('11', 'Alertas ativos ou especificados', 'Limites ajustáveis em config/playbook.json. Alerta repetitivo é deduplicado; falha de integração nunca aparece como venda zero.')}
  ${nao_ativo('Nenhuma rotina automática de alertas está configurada e testada. O que existe hoje: ao regenerar o plano, as regras de cadência, bloqueio, backlog parado e (com conta ML conectada) queda de faturamento/conversão/aumento de cancelamentos viram ações. O quadro abaixo é a especificação dos alertas.')}
  <table class="pl-tab"><thead><tr><th>Fonte</th><th>Frequência</th><th>Comparação</th><th>Volume mínimo</th><th>Limite</th><th>Persistência</th><th>Gravidade</th><th>Responsável</th><th>Ação</th></tr></thead><tbody>
  ${ALERTAS.map(a => `<tr>${a.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}
  </tbody></table>
  <p class="pl-sc" style="margin-top:6px">Formato da mensagem: "Cliente / produto: o que mudou, em qual período, impacto, hipótese, ação recomendada e responsável." Alertas positivos (crescimento com margem preservada, melhora de conversão, recuperação de disponibilidade) seguem a mesma ficha. Este sistema não envia mensagens a terceiros.</p>
</section>

${pend.length ? `<section>
  ${secTitulo(nPend, 'O que depende do cliente', `O que a equipe precisa receber para seguir, por que importa e o que está em jogo — só o que foi medido ou previsto.${pendenciasEm ? ` Situação em ${brData(pendenciasEm)}.` : ''}`)}
  ${pend.map(p => { const L = linhasDePendencia(p); return `<div class="pl-dep">
    <p class="pl-h" style="margin-top:12px"><b>${esc(L.titulo)}</b> ${chip(L.canal || '—', L.gravidade === 'critico' ? 'blood' : L.gravidade === 'atencao' ? 'gold' : 'cinza')}${L.quando ? ` <span class="pl-sc">${esc(L.quando)}</span>` : ''}</p>
    <ul class="pl-ul">${L.linhas.map(l => `<li><b>${esc(l.rotulo)}:</b> ${esc(l.texto)}</li>`).join('')}</ul></div>` }).join('')}
</section>

` : ''}<section>
  ${secTitulo(nFim, 'Pendências, decisões e próxima revisão', 'Somente as informações que realmente mudam a decisão.')}
  <table><thead><tr><th>Informação pendente</th><th>Por que muda a decisão</th><th>Como obter</th></tr></thead><tbody>
  ${plano.pendencias.map(p => `<tr><td>${esc(p.item)}</td><td>${esc(p.muda_decisao)}</td><td>${esc(p.como_obter)}</td></tr>`).join('')}
  </tbody></table>
  <p class="pl-h"><b>Decisões que dependem de autorização</b></p>
  ${lista(['Contato com o cliente (cobrar devolutiva, combinar prazo): feito pelo consultor — o sistema não envia mensagens.', 'Alteração de preço, campanha, orçamento de Ads ou pedido de estoque: só com autorização específica; o plano apenas prepara a proposta.', 'Envio das ações ao Notion: depende de aprovação no painel (pré-visualização + confirmação).'])}
  <p class="pl-h"><b>Próxima revisão:</b> ${esc(brData(addDias(hoje, 7)))} (semanal) · revisão do plano mensal em ${esc(brData(addDias(hoje.slice(0, 7) + '-01', 32).slice(0, 7) + '-01'))}.</p>
</section>

${rodape('Plano de ação · ' + plano.cliente)}
</div>
</body></html>`
}
