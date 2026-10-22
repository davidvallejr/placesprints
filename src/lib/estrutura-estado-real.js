// Fiação da tela de Estruturas (F3, 21/10/2026): monta o contexto REAL para src/lib/estrutura-estado.js (puro) e o bloco Equipe só-leitura.
// Lê: configs (os carregados no início do servidor, em BOOT, e a cópia atual do disco, para apontar reinício pendente), sync_estado só pelas chaves de
// CHAVES_BANCO, a PRESENÇA das variáveis de VARIAVEIS (nunca o valor), a Saúde do sistema (ticks, sinais, incidentes) quando injetada, os agentes launchd
// instalados (existência do plist em ~/Library/LaunchAgents) e a contagem de clientes com execução de promoções ligada. Nenhuma escrita.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { db, getEstado, agora } from './db.js'
import { env, ROOT } from './env.js'
import { equipeCfg, lideresEConsultores } from './equipe.js'
import { CHAVES_BANCO, VARIAVEIS, PLISTS, montarEstrutura } from './estrutura-estado.js'

const ARQUIVOS = { chaveiro: 'chaveiro.json', algoritmo: 'algoritmo.json', nf: 'nota-fiscal.json', gatilhos: 'gatilhos.json', sprint90: 'sprint90.json', autogestao: 'autogestao.json', relatorio_envio: 'relatorio-envio.json', alerta: 'alerta-cliente.json', discord_time: 'discord-time.json' }
const lerConfigs = () => { const o = {}; for (const [k, f] of Object.entries(ARQUIVOS)) { try { o[k] = JSON.parse(readFileSync(join(ROOT, 'config', f), 'utf-8')) } catch { o[k] = {} } } o.equipe = equipeCfg; return o }
const BOOT = lerConfigs()   // o que o servidor carregou (os módulos leem o config na importação): é o valor que vale até o reinício
const plistDe = p => p === 'cloudflared' ? 'com.place2u.cloudflared.plist' : `com.place2u.place-sprints.${p}.plist`

export function contextoReal({ saude = null, launchAgents = join(homedir(), 'Library', 'LaunchAgents') } = {}) {
  let s = null; try { s = saude?.estado?.() || null } catch { s = null }
  let promo = null; try { promo = db.prepare('SELECT COUNT(*) n FROM promo_config WHERE execucao_habilitada = 1').get().n } catch { promo = null }
  let quem = 0; try { quem = lideresEConsultores().length } catch { quem = 0 }
  const ticks = s ? Object.fromEntries(s.sinais.filter(x => x.id.startsWith('tick.')).map(x => [x.id.slice(5), x.valor])) : null
  return {
    agora: agora(), configs: BOOT, configs_disco: lerConfigs(),
    estado: Object.fromEntries(CHAVES_BANCO.map(k => [k, getEstado(k)])),
    env: Object.fromEntries(VARIAVEIS.map(k => [k, !!env[k]])), mp_modo: env.MP_MODO,
    ticks, sinais: s ? s.sinais.filter(x => !x.id.startsWith('tick.')) : null, incidentes: s ? { abertos: s.incidentes?.abertos || [] } : null,
    plists: Object.fromEntries(PLISTS.map(p => [p, existsSync(join(launchAgents, plistDe(p)))])),
    promocoes_exec_clientes: promo, equipe: { quem_pode: quem },
  }
}
export const estruturaReal = deps => montarEstrutura(contextoReal(deps))

// bloco Equipe (só leitura): config/equipe.json + config/discord-time.json + quem o servidor aceita como líder/consultor. Nenhum id de usuário do Notion sai daqui.
export function equipeReal() {
  const e = equipeCfg, dt = BOOT.discord_time || {}
  const squads = Object.entries(e.squads || {}).filter(([k, v]) => k !== '$comentario' && v && typeof v === 'object').map(([nome, v]) => ({ nome, lider: v.lider || '', consultores: v.consultores || [] }))
  const aliases = Object.entries(e.aliases || {}).filter(([k]) => k !== '$comentario').map(([de, para]) => ({ de, para }))
  let quem = []; try { quem = lideresEConsultores() } catch { quem = [] }
  return { donos: (e.donos || []).filter(Boolean), aliases, squads, status_cliente_excluidos: e.status_cliente_excluidos || [],
    analistas_oficiais: { cargos: e.analistas_oficiais?.cargos || [], incluir: e.analistas_oficiais?.incluir || [], excluir: e.analistas_oficiais?.excluir || [] },
    quem_pode: quem, discord: { cargos: (dt.mencoes_obrigatorias || []).map(c => c.rotulo), canal: dt.canal || '', marcar_consultor: dt.marcar_consultor_do_cliente === true } }
}
