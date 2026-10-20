// Carga de demonstração — permite validar dashboard, relatório e PDF sem NOTION_TOKEN.
// Dados claramente fictícios ("Cliente Demo …"). Rode: npm run demo
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, agora } from '../src/lib/db.js'
import { ROOT } from '../src/lib/env.js'
import { gravarSnapshots } from '../src/lib/sync.js'

const limpar = process.argv.includes('--limpar')
db.exec('DELETE FROM evidencias; DELETE FROM historico; DELETE FROM snapshots; DELETE FROM tarefas; DELETE FROM ia_cache;')
if (limpar) { console.log('✔ Base limpa.'); process.exit(0) }

// ── evidências fictícias (SVG gerado localmente) ─────────────────────────
function evidenciaSvg(titulo, corFundo, linhas) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="${corFundo}"/>
  <rect x="0" y="0" width="600" height="52" fill="#0f172a" opacity=".85"/>
  <text x="20" y="33" font-family="system-ui" font-size="18" fill="#fff" font-weight="700">${titulo}</text>
  ${linhas.map((l, i) => `<rect x="24" y="${86 + i * 62}" width="552" height="44" rx="8" fill="#fff" opacity=".92"/>
  <text x="40" y="${114 + i * 62}" font-family="system-ui" font-size="15" fill="#0f172a">${l}</text>`).join('')}
  <text x="20" y="386" font-family="system-ui" font-size="11" fill="#0f172a" opacity=".55">print de demonstração — gerado pelo seed</text>
</svg>`
}

const HOJE = new Date('2026-09-15')
const dia = n => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const CLIENTES = [
  { nome: 'Cliente Demo — Moda Casa', consultores: ['Ana Souza', 'Carlos Lima'] },
  { nome: 'Cliente Demo — Esportes', consultores: ['Bruna Alves', 'Carlos Lima'] },
]
const PROCESSOS = ['Mercado Livre', 'Shopee', 'Cadastro de produtos', 'SEO de anúncios', 'Logística']

// [titulo, processo, status_raw, prazoOffset, conclOffset|null, esforco, extras]
const MODELOS_S1 = [ // Sprint 2026-08 (encerrado)
  ['Auditoria completa da conta', 'Mercado Livre', 'Concluída', -40, -42, 5, { resultado_alcancado: 'Conta auditada: 14 anúncios pausados por ficha incompleta reativados.', impacto: 'Catálogo 100% ativo já na primeira quinzena.', evid: ['Reputação antes: amarela', 'Reputação depois: verde claro', '14 anúncios reativados'] }],
  ['Correção de fichas técnicas', 'Cadastro de produtos', 'Concluída', -35, -36, 3, { resultado_alcancado: '38 fichas corrigidas com atributos obrigatórios.', impacto: 'Qualidade média de cadastro subiu de 61% para 92%.', evid: ['Qualidade da ficha: 61% → 92%'] }],
  ['Estudo de concorrência inicial', 'SEO de anúncios', 'Concluída', -33, -31, 2, { resultado_alcancado: 'Top 10 concorrentes mapeados com faixa de preço.', evid: [] }],
  ['Configurar frete grátis acima de R$79', 'Logística', 'Concluída', -30, -30, 1, { evid: ['Regra de frete ativa no painel'] }],
  ['Campanha de lançamento Shopee', 'Shopee', 'Cancelada', -28, null, 3, {}],
]
const MODELOS_S2 = [ // Sprint 2026-09 (em andamento)
  ['Otimizar títulos dos 20 anúncios principais', 'SEO de anúncios', 'Concluída', -8, -6, 3, { resultado_esperado: 'Títulos dentro do padrão IMA com palavra-chave principal.', resultado_alcancado: '20 títulos reescritos; CTR médio subiu 0,8 p.p. na primeira semana.', impacto: 'Mais tráfego orgânico sem investir em ads.', evid: ['CTR: 2,1% → 2,9%', 'Posição média: 14 → 8'] }],
  ['Subir 15 produtos novos no Mercado Livre', 'Cadastro de produtos', 'Concluída', -5, -4, 5, { resultado_alcancado: '15 anúncios publicados com ficha completa.', impacto: 'Catálogo cresceu 18%.', evid: ['15 anúncios publicados', 'Ficha 100% preenchida'] }],
  ['Ativar Mercado Ads nas categorias campeãs', 'Mercado Livre', 'Concluída', -3, -2, 3, { resultado_alcancado: 'Campanhas ativas com ACOS alvo de 12%.', evid: ['Campanha ativa — ACOS 11,4%'] }],
  ['Revisar precificação da linha inverno', 'Mercado Livre', 'Em validação', -1, null, 2, { resultado_esperado: 'Margem mínima de 22% preservada.' }],
  ['Migrar anúncios campeões para Shopee', 'Shopee', 'Em andamento', 3, null, 5, { resultado_esperado: '30 anúncios espelhados com preço ajustado.' }],
  ['Implantar etiqueta automática de envio', 'Logística', 'Em andamento', 5, null, 3, {}],
  ['Cadastrar kits promocionais', 'Cadastro de produtos', 'Não iniciada', 8, null, 2, {}],
  ['Responder perguntas em até 2h (rotina)', 'Mercado Livre', 'Não iniciada', 10, null, 1, {}],
  ['Integração com transportadora XYZ', 'Logística', 'Bloqueada', -2, null, 3, { bloqueio: 'Aguardando contrato assinado pelo cliente', impacto: 'Sem a integração, o prazo de despacho segue em 2 dias úteis.', proximo_passo: 'Cobrar jurídico do cliente na reunião de sexta' }],
  ['Ensaio fotográfico linha nova', 'Cadastro de produtos', 'Em andamento', -4, null, 3, { proximo_passo: 'Receber fotos tratadas até quarta' }],
]
const MODELOS_S3 = [ // Sprint 2026-10 (planejado)
  ['Expandir catálogo para Amazon', 'Cadastro de produtos', 'Não iniciada', 25, null, 8, { prioridade: 'Alta' }],
  ['Campanha Dia das Crianças', 'Mercado Livre', 'Não iniciada', 20, null, 5, { prioridade: 'Alta', bloqueio: 'Cliente precisa aprovar verba de mídia' }],
  ['Auditoria trimestral de reputação', 'Mercado Livre', 'Não iniciada', 30, null, 2, {}],
]

const insT = db.prepare(`INSERT INTO tarefas (id, fonte, cliente, projeto, sprint, titulo, processo, responsavel,
  status_raw, status, prioridade, data_inicio, prazo, data_conclusao, esforco, resultado_esperado,
  resultado_alcancado, impacto, bloqueio, proximo_passo, visivel_cliente, descricao, conteudo, url,
  last_edited, hash, sync_em, arquivada)
  VALUES (@id,@fonte,@cliente,@projeto,@sprint,@titulo,@processo,@responsavel,@status_raw,@status,@prioridade,
  @data_inicio,@prazo,@data_conclusao,@esforco,@resultado_esperado,@resultado_alcancado,@impacto,@bloqueio,
  @proximo_passo,@visivel_cliente,@descricao,@conteudo,@url,@last_edited,@hash,@sync_em,@arquivada)`)
const insE = db.prepare('INSERT INTO evidencias (id, tarefa_id, tipo, url_origem, arquivo_local, legenda, criada_em) VALUES (?,?,?,?,?,?,?)')
const mapaStatus = { 'Concluída': 'concluida', 'Em andamento': 'andamento', 'Em validação': 'validacao', 'Não iniciada': 'nao_iniciada', 'Bloqueada': 'bloqueada', 'Aguardando Devolutiva do Cliente': 'dependencia_cliente', 'Cancelada': 'cancelada' }
const CORES_EVID = ['#dbeafe', '#d1fae5', '#fef3c7', '#ede9fe', '#fce7f3']

let seq = 0
function criar(cliente, consultores, sprint, modelos) {
  for (const [titulo, processo, statusRaw, prazoOff, conclOff, esforco, extras = {}] of modelos) {
    const id = `demo-${String(++seq).padStart(3, '0')}`
    const status = mapaStatus[statusRaw]
    const t = {
      id, fonte: 'demo', cliente: cliente, projeto: 'Aceleração Marketplace', sprint,
      titulo, processo, responsavel: consultores[seq % consultores.length],
      status_raw: statusRaw, status, prioridade: extras.prioridade || '',
      data_inicio: dia(prazoOff - 7), prazo: dia(prazoOff),
      data_conclusao: conclOff != null ? dia(conclOff) : null,
      esforco, resultado_esperado: extras.resultado_esperado || '',
      resultado_alcancado: extras.resultado_alcancado || '', impacto: extras.impacto || '',
      bloqueio: extras.bloqueio || '', proximo_passo: extras.proximo_passo || '',
      visivel_cliente: 1, descricao: `Tarefa do plano de ${processo.toLowerCase()} do sprint.`,
      conteudo: '', url: 'https://www.notion.so/demo-' + id, last_edited: agora(),
      hash: 'demo' + seq, sync_em: agora(), arquivada: 0,
    }
    insT.run(t)
    ;(extras.evid || []).forEach((linha, i) => {
      const dirRel = `evidencias/${id}`
      mkdirSync(join(ROOT, 'data', dirRel), { recursive: true })
      const nomeArq = `ev-${i + 1}.svg`
      writeFileSync(join(ROOT, 'data', dirRel, nomeArq),
        evidenciaSvg(titulo, CORES_EVID[(seq + i) % CORES_EVID.length], [linha, `Cliente: ${cliente}`, sprint]))
      insE.run(`${id}-ev${i + 1}`, id, 'image', '', `${dirRel}/${nomeArq}`, linha, t.data_conclusao || t.prazo)
    })
  }
}

for (const c of CLIENTES) {
  criar(c.nome, c.consultores, 'Sprint 2026-08', MODELOS_S1)
  criar(c.nome, c.consultores, 'Sprint 2026-09', MODELOS_S2)
  criar(c.nome, c.consultores, 'Sprint 2026-10', MODELOS_S3)
}

// transferência de sprint (para o KPI "transferidas")
db.prepare("INSERT INTO historico (tarefa_id, campo, de, para, em) VALUES ('demo-007','sprint','Sprint 2026-08','Sprint 2026-09',?)").run(agora())

// histórico de snapshots dos últimos 14 dias (burnup com evolução real)
const insS = db.prepare(`INSERT OR REPLACE INTO snapshots (dia, cliente, projeto, sprint, planejadas, concluidas, esforco_planejado, esforco_concluido) VALUES (?,?,?,?,?,?,?,?)`)
for (const c of CLIENTES) {
  const plano = MODELOS_S2.length
  const esfTotal = MODELOS_S2.reduce((s, m) => s + m[5], 0)
  for (let d = 13; d >= 0; d--) {
    const quando = dia(-d)
    const concluidasAte = MODELOS_S2.filter(m => m[4] != null && dia(m[4]) <= quando).length
    const esfAte = MODELOS_S2.filter(m => m[4] != null && dia(m[4]) <= quando).reduce((s, m) => s + m[5], 0)
    insS.run(quando, c.nome, 'Aceleração Marketplace', 'Sprint 2026-09', plano, concluidasAte, esfTotal, esfAte)
  }
}
gravarSnapshots()

const n = db.prepare('SELECT COUNT(*) AS n FROM tarefas').get().n
const ne = db.prepare('SELECT COUNT(*) AS n FROM evidencias').get().n
console.log(`✔ Demo criada: ${n} tarefas, ${ne} evidências, 2 clientes, 3 sprints.`)
console.log('  Abra http://localhost:3012 (npm start) e filtre por "Sprint 2026-09".')
