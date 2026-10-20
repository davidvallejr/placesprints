// Fiação REAL do avaliador de pendências do cliente (src/lib/pendencias-cliente.js): banco local, dependências do Notion lidas do banco, catálogo em disco.
// NUNCA chama o Mercado Livre nem o Notion: estoque, custos e fotos vêm de meli_item/meli_serie_item já coletados (diagnostico-conta.carregarBase),
// a conta de meli_contas e a previsão de acoes_plano. Lazy (pendenciasReal()) porque diagnostico-conta → motor-ppc → plano-cliente → este módulo forma um ciclo.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, agora, hojeLocal } from './db.js'
import { ROOT } from './env.js'
import { carregarBase, classificarCurvas, custosDoCliente, algoritmo } from './diagnostico-conta.js'
import { criarDependencias } from './dependencia-cliente.js'
import { criarPendencias, validarCatalogo } from './pendencias-cliente.js'
import { auditarTexto } from './relatorio-seguro.js'
import { validarLiderOuConsultor } from './equipe.js'
import { origemCatalogo, editavelConteudo as editavelCatalogo } from './catalogo.js'     // catálogo de terceiros não tem conteúdo editável: não se pede foto/dado ao cliente por ele
import { criarCatalogo } from './catalogo-db.js'
import { lerSaude } from './saude-coleta.js'
import { alinhamentosReal } from './alinhamentos-real.js'      // alinhamentos com o cliente: pendência coberta some (predicado único do núcleo)
import { idAcao } from './plano-cliente.js'                     // ciclo já existente (pendenciasReal é preguiçoso): idAcao só é chamado em tempo de execução     // saúde da conta gravada (v1.5.0): despacho e atendimento medidos no ML, só banco local

export const lerCatalogo = (auditar = auditarTexto) => validarCatalogo(JSON.parse(readFileSync(join(ROOT, 'config', 'dependencias-cliente.json'), 'utf-8')), { auditar })
const playbook = JSON.parse(readFileSync(join(ROOT, 'config', 'playbook.json'), 'utf-8'))

export function criarPendenciasReal({ handle = db, validarPor = validarLiderOuConsultor, catalogo = lerCatalogo(), editavelConteudo } = {}) {
  // só o listar() é usado aqui (status = verdade; registro/histórico dão o "desde"): sem Notion, sem validarPor
  const dependencias = criarDependencias({ handle, notion: { req: async () => { throw Object.assign(new Error('indisponível'), { status: 0 }) } }, agora, hoje: hojeLocal,
    validarPor: () => '', mapeamento: { propriedades: {} }, limiares: { atencao: playbook.limiares.dependencia_atencao_dias, revisar: playbook.limiares.dias_parada } })
  const L = algoritmo.limiares
  const riscoEstoque = (cliente, hoje) => {
    const base = carregarBase(cliente, { hoje })                                 // 28 dias × 28 anteriores, só banco local
    if (!base.itens.length) return null
    classificarCurvas(base.itens, null)                                           // curva ABC pela receita de 28 dias (a mesma do plano por anúncio)
    const em = new Map(handle.prepare('SELECT item_id, atualizado_em FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r.atualizado_em]))
    const ctxCat = criarCatalogo(handle).contexto(cliente)
    const itens = base.itens.map(i => ({ catalogo_origem: origemCatalogo(i, ctxCat), id: i.id, titulo: i.titulo, curva: i.curva, status: i.status, estoque: i.estoque, cobertura: i.cobertura, u: i.u, r: i.r,
      fotos: i.fotos, catalogo: i.catalogo, custo_unitario: i.custo_unitario, lead_time_dias: i.lead_time_dias, lead_time_fonte: i.lead_time_fonte, atualizado_em: em.get(i.id) || '', ...(i.produto ? { produto: i.produto } : {}) }))   // produto: V3 F3, só com a chave
    return { itens, atualizado_em: itens.map(i => i.atualizado_em).filter(Boolean).sort().at(-1) || '', janela_dias: base.dias, lead_time_dias: L.lead_time_reposicao_dias,
      fotos_minimas: L.fotos_minimas, custos_conta_informados: !!custosDoCliente(cliente) }
  }
  const contasMl = cliente => handle.prepare('SELECT erro, atualizado_em FROM meli_contas WHERE cliente = ?').get(cliente) || null
  const acoesPlano = (cliente, ids) => {
    const mapa = new Map()
    if (!ids.length) return mapa
    for (const r of handle.prepare(`SELECT id, previsao_json FROM acoes_plano WHERE cliente = ? AND UPPER(id) IN (${ids.map(() => '?').join(',')})`).all(cliente, ...ids)) {
      let v = null
      try { v = Number(JSON.parse(r.previsao_json || '{}').valor_esperado) } catch { /* previsão ausente ou ilegível: sem R$ */ }
      mapa.set(String(r.id).toUpperCase(), Number.isFinite(v) ? v : null)
    }
    return mapa
  }
  // tarefas que o cliente enxerga (Notion "Exibir ao cliente" → tarefas.visivel_cliente = 1): o texto ao cliente nunca cita tarefa interna
  const visiveis = (cliente, ids) => new Set(handle.prepare('SELECT id FROM tarefas WHERE cliente = ? AND visivel_cliente = 1 AND id IN (SELECT value FROM json_each(?))').all(cliente, JSON.stringify(ids.map(String))).map(r => String(r.id)))
  const saude = (cliente, dia) => lerSaude(cliente, dia ? { hoje: dia } : {})
  return criarPendencias({ handle, dependencias, riscoEstoque, contasMl, acoesPlano, visiveis, hoje: hojeLocal, agora, catalogo, auditar: auditarTexto, validarPor, editavelConteudo: editavelConteudo || (item => editavelCatalogo(item)), saude,
    alinhado: (cliente, dia) => alinhamentosReal().predicado(cliente, dia ? { hoje: dia } : {}), idAcao })
}

let instancia = null
export const pendenciasReal = () => instancia ??= criarPendenciasReal()
