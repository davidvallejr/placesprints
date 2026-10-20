// Ficha do cliente: prestadores ativos do Notion atrelados ao cliente (por canal e papel) + links das contas dos canais.
// É daqui que a tarefa aprovada sai delegada no Notion: ação > ficha (canal, depois geral) > analista da conta (auto) > consultor.
// Núcleo SEM import de banco/Notion: o banco entra por fábrica (criarFicha(handle)) — o autoteste usa um banco em memória e nunca abre data/db.sqlite.
// Segurança: mensagens de erro nunca repetem o valor recebido; link só http(s); só prestador ATIVO entra e só ele recebe tarefa.
const agora = () => new Date().toISOString()
const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const PAPEIS = [
  { id: 'consultor', rotulo: 'Consultor (pesquisa, briefing e validação)' },
  { id: 'analista', rotulo: 'Analista (executa as tarefas)' },
  { id: 'apoio', rotulo: 'Apoio (imagens, vídeo, design, social)' },
]
export const CANAIS_FICHA = { '': 'Todos os canais', ML: 'Mercado Livre', SHO: 'Shopee', AMZ: 'Amazon', TTK: 'TikTok Shop' }
export const LINKS = [
  { id: 'ml', rotulo: 'Conta Mercado Livre' }, { id: 'shopee', rotulo: 'Loja Shopee' }, { id: 'amazon', rotulo: 'Conta Amazon' }, { id: 'tiktok', rotulo: 'TikTok Shop' },
  { id: 'drive', rotulo: 'Pasta no Drive' }, { id: 'notion', rotulo: 'Quadro do cliente no Notion' }, { id: 'outro', rotulo: 'Outro link útil' },
]
const RX_APOIO = /imagen|video|foto|design|banner|capa|criativo|social/i
export const papelDaAcao = a => a?.regra === 'pendencia_cliente' ? 'consultor'   // pendência medida/registrada do cliente (08/10): cobrar é do consultor
  : a?.regra === 'bloqueio_cliente' ? 'consultor'   // cobrar o cliente é do consultor da ficha, nunca do analista
  : RX_APOIO.test(String(a?.dados?.demanda_notion || a?.titulo || '')) ? 'apoio' : 'analista'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
export const url = v => {                                       // só http(s); qualquer outra coisa (javascript:, data:) é recusada sem eco do valor (também valida a evidência da dependência do cliente)
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (s.length > 500 || !/^https?:\/\/[^\s<>"']+$/i.test(s)) throw erro('link inválido: use um endereço http(s) completo, sem espaços')
  try { new URL(s) } catch { throw erro('link inválido: use um endereço http(s) completo') }
  return s
}
const subseq = (curto, longo) => { let i = 0; for (const p of longo) if (p === curto[i]) i++; return i === curto.length }

export function criarFicha(h, { usuariosOverride = {} } = {}) {
  const prestadoresAtivos = () => h.prepare('SELECT * FROM prestadores ORDER BY nome').all()
    .map(r => ({ nome: r.nome, nome_norm: r.nome_norm, cargo: r.cargo, area: r.area, atuacao: JSON.parse(r.atuacao_json || '[]') }))

  // usuário do Notion do prestador: override do config (nome completo → id) > nome colhido do Notion cujas palavras aparecem NA ORDEM no nome completo (≥2 palavras) ou igual.
  // Ambíguo (duas pessoas possíveis) = não casa: melhor aparecer "sem usuário no Notion" do que delegar à pessoa errada.
  function notionDoPrestador(nome) {
    const n = normNome(nome)
    if (!n) return null
    for (const [k, id] of Object.entries(usuariosOverride)) if (k !== '$comentario' && normNome(k) === n) return { id, nome }
    const palavras = n.split(' ')
    const outros = h.prepare('SELECT nome_norm FROM prestadores').all().map(r => r.nome_norm.split(' '))
    const achados = h.prepare('SELECT id, nome, nome_norm, vistas FROM usuarios_notion').all().filter(u => {
      const pu = u.nome_norm.split(' ')
      if (u.nome_norm === n) return true
      // nome curto do Notion que cabe em MAIS DE UM prestador ("Ana Paula" × Ana Paula Souza/Lima) é ambíguo: não casa com nenhum
      return pu.length >= 2 && subseq(pu, palavras) && outros.filter(o => subseq(pu, o)).length === 1
    })
    const ids = [...new Set(achados.map(a => a.id))]
    if (ids.length === 1) return { id: ids[0], nome: achados.sort((a, b) => b.vistas - a.vistas)[0].nome }
    return null
  }

  function gravarPrestadores(lista) {
    const t = agora(), ins = h.prepare('INSERT INTO prestadores (nome, nome_norm, cargo, area, atuacao_json, atualizado_em) VALUES (?,?,?,?,?,?)')
    h.transaction(() => {
      h.prepare('DELETE FROM prestadores').run()               // quem saiu do Notion (Desligado) não pode continuar elegível
      for (const p of lista) if (p.nome) ins.run(p.nome, normNome(p.nome), p.cargo || '', p.area || '', JSON.stringify(p.atuacao || []), t)
    })()
    return lista.length
  }
  const listarPrestadores = () => prestadoresAtivos().map(p => ({ nome: p.nome, cargo: p.cargo, area: p.area, atuacao: p.atuacao, notion: !!notionDoPrestador(p.nome) }))

  function lerFicha(cliente) {
    const f = h.prepare('SELECT * FROM ficha_cliente WHERE cliente = ?').get(cliente)
    const ativos = new Set(prestadoresAtivos().map(p => p.nome_norm))
    const prestadores = h.prepare('SELECT canal, papel, prestador FROM ficha_prestador WHERE cliente = ? ORDER BY canal, papel').all(cliente)
      .map(r => ({ ...r, ativo: ativos.has(normNome(r.prestador)), notion: !!notionDoPrestador(r.prestador) }))
    return { cliente, links: f ? JSON.parse(f.links_json || '{}') : {}, observacao: f?.observacao || '', prestadores, atualizado_em: f?.atualizado_em || null, por: f?.por || '' }
  }

  function salvarFicha({ cliente, links = {}, prestadores = [], observacao = '', por }) {
    if (!String(por || '').trim()) throw erro('informe "por" (seu nome — fica registrado junto da ficha)')
    if (!links || typeof links !== 'object' || Array.isArray(links)) throw erro('"links" deve ser um objeto')
    if (!Array.isArray(prestadores)) throw erro('"prestadores" deve ser uma lista')
    const limpos = {}
    for (const [k, v] of Object.entries(links)) {
      if (!LINKS.some(l => l.id === k)) throw erro('chave de link desconhecida')
      const u = url(v); if (u) limpos[k] = u
    }
    const ativos = new Map(prestadoresAtivos().map(p => [p.nome_norm, p.nome]))
    const linhas = new Map()
    for (const x of prestadores) {
      const canal = String(x?.canal ?? ''), papel = String(x?.papel ?? ''), nome = String(x?.prestador ?? '').trim()
      if (!Object.hasOwn(CANAIS_FICHA, canal)) throw erro('canal desconhecido')
      if (!PAPEIS.some(p => p.id === papel)) throw erro('papel desconhecido')
      if (!nome) continue                                     // vazio = remover a atribuição
      const oficial = ativos.get(normNome(nome))
      if (!oficial) throw erro('prestador não encontrado entre os ativos do Notion (sincronize os prestadores)')
      linhas.set(`${canal}|${papel}`, { canal, papel, prestador: oficial })
    }
    const t = agora()
    h.transaction(() => {
      h.prepare(`INSERT INTO ficha_cliente (cliente, links_json, observacao, atualizado_em, por) VALUES (?,?,?,?,?)
        ON CONFLICT(cliente) DO UPDATE SET links_json=excluded.links_json, observacao=excluded.observacao, atualizado_em=excluded.atualizado_em, por=excluded.por`)
        .run(cliente, JSON.stringify(limpos), String(observacao || '').slice(0, 1000), t, String(por).trim().slice(0, 80))
      h.prepare('DELETE FROM ficha_prestador WHERE cliente = ?').run(cliente)
      const ins = h.prepare('INSERT INTO ficha_prestador (cliente, canal, papel, prestador) VALUES (?,?,?,?)')
      for (const l of linhas.values()) ins.run(cliente, l.canal, l.papel, l.prestador)
    })()
    return lerFicha(cliente)
  }

  // quem recebe a tarefa: atribuição do canal > atribuição geral; só prestador ATIVO (desligado cai para o próximo critério)
  function prestadorDaFicha(cliente, canalK, papel) {
    const ativos = new Set(prestadoresAtivos().map(p => p.nome_norm))
    const q = h.prepare('SELECT prestador FROM ficha_prestador WHERE cliente = ? AND canal = ? AND papel = ?')
    for (const canal of [canalK || '', '']) {
      const r = q.get(cliente, canal, papel)
      if (r && ativos.has(normNome(r.prestador))) return { nome: r.prestador, canal: canal || null, notion: notionDoPrestador(r.prestador) }
    }
    return null
  }
  const ehAtivo = nome => prestadoresAtivos().some(p => p.nome_norm === normNome(nome))
  const nomeOficial = nome => prestadoresAtivos().find(p => p.nome_norm === normNome(nome))?.nome || null

  return { gravarPrestadores, listarPrestadores, lerFicha, salvarFicha, prestadorDaFicha, notionDoPrestador, ehAtivo, nomeOficial }
}

