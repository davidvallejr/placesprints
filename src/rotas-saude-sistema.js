// GET /api/saude — Saúde do sistema (docs/plano-autogestao.md A2): estado geral, sinais por sistema com limiar e incidentes (abertos + 10 últimos resolvidos).
// Pública SÓ no loopback: sem login (o vigia externo lê por curl), mas além do guardaLocal (Host loopback) exige conexão de 127.0.0.1/::1 SEM cabeçalho de
// proxy — pelo túnel do cloudflared (que conecta no loopback) chega com cf-connecting-ip / x-forwarded-for e leva 403. Nenhum token, cliente ou segredo sai.
import { Router } from 'express'

const LOOP = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/
export const soLoopback = req => LOOP.test(String(req.socket?.remoteAddress || '')) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['cf-ray']

export function criarRotasSaudeSistema({ saude }) {
  const r = Router()
  r.get('/api/saude', (req, res) => {
    if (!soLoopback(req)) return res.status(403).json({ erro: 'acesso restrito ao painel local' })
    try { res.set('Cache-Control', 'no-store').json(saude.estado()) } catch { res.status(500).json({ erro: 'saúde indisponível' }) }
  })
  return r
}
