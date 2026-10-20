// Os 8 sistemas dentro do Place Sprints (config/sistemas.json, decisão do David 15/10/2026). Puro: sem banco, sem rede.
// sistema(id) → { id, nome, papel, assina } (id fora do catálogo = erro) · voz(id, texto) → «Arquiteto · texto» (só mensagem INTERNA; ao cliente nada muda)
// mapaDeOrigem(regra | tipo de gatilho | tipo de aviso/evento) → id do sistema de origem, ou null quando não sabe (quem chama decide o padrão).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const SISTEMAS = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'config', 'sistemas.json'), 'utf-8')).sistemas.map(s => Object.freeze({ ...s })))
const POR_ID = new Map(SISTEMAS.map(s => [s.id, s]))

export function sistema(id) {
  const s = POR_ID.get(id); if (!s) throw new Error(`sistema desconhecido: ${String(id).slice(0, 40)}`)
  return s
}
export const voz = (id, texto) => `${sistema(id).nome} · ${texto}`

// origem do sinal: quem detectou/mede o que a regra, o gatilho ou o aviso diz. Chave compartilhada entre regra e gatilho tem UM dono (ex.: anuncio_restrito = Trinity, que lê o status).
const MAPA = {
  trinity: [
    'estoque_divergente',   // V3 F6: o físico informado − vendas diverge do que a coleta lê no ML
    // regras/gatilhos lidos direto da coleta (saúde da conta, status do anúncio, estoque zerado)
    'anuncio_restrito', 'reputacao_em_risco', 'envio_atrasado', 'reclamacao_sem_resposta', 'pergunta_sem_resposta', 'reclamacao_mediacao', 'perguntas_sem_resposta', 'estoque_zerado',
    // avisos e eventos de conexão, coleta e sync
    'cliente_conectado', 'cliente_reconectado', 'dados_prontos', 'coleta_falhou', 'conexao_caiu', 'conta_trocada', 'conexao_pendente', 'meli_credencial', 'prospect_conectado', 'coleta', 'sync', 'snapshot', 'saude',
  ],
  arquiteto: [
    'ima_conversao', 'catalogo_buybox', 'estoque_dividido', 'sku_ausente', 'ads_entrar', 'ads_escalar', 'ads_otimizar_antes', 'conteudo_fotos', 'frete_gratis', 'sazonal', 'urgencia_oculta',
    'duplicacao_estrategica', 'oferta_galeria', 'oferta_titulo_descricao', 'oferta_completa', 'oferta_ficha', 'oferta_cadastro', 'queda_conversao_anuncio', 'queda_exposicao_anuncio', 'queda_ctr_ads',
    'concentracao_receita', 'full_estoque_antigo', 'diagnostico_pronto', 'plano', 'alinhamentos',
  ],
  oraculo: ['estoque_ruptura', 'full_envio', 'ruptura_curva_a', 'ciclo_estoque_previsto', 'envio_full_sugerido', 'previsao', 'calibracao', 'aprendizado'],
  merovingio: ['preco_mudou_vendas_cairam', 'queda_forte_conta', 'queda_conta', 'queda_por_preco', 'medicao'],
  chaveiro: ['chaveiro', 'execucao', 'nf_pendente', 'nota_fiscal', 'estoque_sincronizar', 'sync_estoque', 'sync_estoque_aviso'],
  morpheus: ['dependencia_vencida', 'aviso_assessoria', 'aviso_assessoria_critico', 'gatilho_falhou', 'dossie_mensal', 'gatilhos', 'relatorios', 'alertas', 'respostas', 'consultor', 'dossie'],
  smith: ['cadastrar_custos', 'margem_negativa', 'oferta_preco', 'promocao_giro', 'ads_reduzir', 'ads_abaixo_meta', 'preco_alterado_drastico', 'oferta_terminando', 'ads_sem_retorno', 'custos_nao_informados',
    'promocao_encerrada', 'custos', 'financeiro', 'promocoes', 'nf_regra_faltando', 'fiscal'],
  neo: ['autonomo'],
}
const TABELA = new Map(Object.entries(MAPA).flatMap(([id, ks]) => ks.map(k => [k, id])))
// famílias de aviso com sufixo variável (relatorio_falhou:notion_401, alerta_pendencia:estoque, s90_conectado …)
const PREFIXOS = [['s90_', 'trinity'], ['consultor_discord_', 'morpheus'], ['relatorio_', 'morpheus'], ['alerta_', 'morpheus']]

export function mapaDeOrigem(chave) {
  const k = String(chave ?? '')
  return TABELA.get(k) || TABELA.get(k.split(':')[0]) || PREFIXOS.find(([p]) => k.startsWith(p))?.[1] || null
}
export const tabelaDeOrigem = () => Object.fromEntries(TABELA)
// cabeçalho de seção interna: «Merovíngio — o que rendeu»
export const secao = (id, texto) => `${sistema(id).nome} — ${texto}`
// linha/rotulo com a origem do sinal (aviso interno sem dono conhecido = Morpheus)
export const origemNome = chave => sistema(mapaDeOrigem(chave) || 'morpheus').nome
