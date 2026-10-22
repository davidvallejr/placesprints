// HTTP da Comunicação em esteira (F1, docs/desenho-comunicacao-esteira.md § 2). Loopback (guarda-local). SÓ LEITURA: nenhuma rota de escrita nasce aqui;
// os botões da tela chamam as rotas que já existem (gatilhos/liberar, relatorio/liberar, relatorio/enviar, alertas/enviar, gatilhos/enviar, gatilhos/preparar-lote).
//   GET /api/comunicacao/fila            → { lido_em, gate[], faixas: { cliente, time }, nao_lidos[] }
//   GET /api/comunicacao/fila?faixa=cliente|time → só aquela faixa (o filtro é no servidor: D5); outro valor = 400 com mensagem fixa
import { Router } from 'express'

export function criarRotasComunicacao({ fila }) {
  const r = Router()
  r.get('/api/comunicacao/fila', (req, res) => {
    const f = typeof req.query.faixa === 'string' ? req.query.faixa : ''
    if (f && f !== 'cliente' && f !== 'time') return res.status(400).json({ erro: 'faixa inválida (use cliente ou time)' })
    let d; try { d = fila() } catch { return res.status(500).json({ erro: 'fila indisponível' }) }
    if (f) d = { ...d, faixas: { [f]: d.faixas[f] } }
    res.set('Cache-Control', 'no-store').json(d)
  })
  return r
}
