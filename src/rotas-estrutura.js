// HTTP da tela de Estruturas (F3, 21/10/2026; docs/estrutura.md). Loopback (guarda-local). SÓ LEITURA: Ligar/Desligar na tela chama as rotas de banco
// que já existem (/api/gatilhos/chave, /api/consultor-discord/chave, /api/relatorio/agendador, /api/alertas/agendador, /api/dossie/mensal,
// /api/chaveiro/exec/parar|retomar, /api/chaveiro/estoque/parar|retomar) — nenhuma rota de escrita nasce aqui.
//   GET /api/estrutura      → { lido_em, linhas[], resumo, incidentes, equipe }
//   GET /api/estrutura/:id  → uma linha; 404 com mensagem fixa (nunca ecoa o id)
import { Router } from 'express'

const ID_OK = /^[a-z0-9_]{1,40}$/

// deps: estrutura() → montarEstrutura(ctx) · equipe() → bloco Equipe
export function criarRotasEstrutura({ estrutura, equipe = () => null }) {
  const r = Router()
  r.get('/api/estrutura', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ ...estrutura(), equipe: equipe() }) } catch { res.status(500).json({ erro: 'estrutura indisponível' }) }
  })
  r.get('/api/estrutura/:id', (req, res) => {
    const id = String(req.params.id || '')
    const l = ID_OK.test(id) ? estrutura().linhas.find(x => x.id === id) : null
    if (!l) return res.status(404).json({ erro: 'estrutura desconhecida' })
    res.set('Cache-Control', 'no-store').json(l)
  })
  return r
}
