// HTTP dos 8 relatórios da F9 (Morpheus entrega; números do Oráculo, Merovíngio e Smith) + razão de estoque e pedidos ao fornecedor. Loopback (guarda-local no server.js).
// Regras: corpo JSON nos POST (415); `por` validado no núcleo (403); `confirmar` só vale se for EXATAMENTE true (senão = prévia, nada gravado); mensagens fixas, nunca ecoam
// o valor recebido; prospect "[Comercial] …" ou nome fora da central = 404; nome de relatório fora da lista = 404.
//   GET  /api/cliente/relatorios?cliente=                 → { cliente, relatorios:[{ nome, titulo }] }
//   GET  /api/cliente/relatorios/<nome>?cliente=          → { nome, titulo, colunas[6], secoes:[{ chave, titulo, linhas:[{ item, metrica, previsao, chance, medido, nota }] }], premissas, faltando }
//        cada célula = { v (centavos | número | [conservador, base] | texto | null), u, txt, motivo } — null = «—» com o motivo, nunca zero
//   GET  /api/cliente/relatorios/<nome>.csv | .html | .pdf ?cliente=  → a MESMA função da tela (CSV ; com BOM) · 1 página A4 (HTML; PDF pelo Chrome headless)
//   GET  /api/cliente/estoque/mov?cliente=                 → { movimentos[] } (razão, mais recentes primeiro)
//   POST /api/cliente/estoque/mov { cliente, produto, local, origem: compra|devolucao|ajuste|envio_full|contagem, quantidade, custo_unit_c?, fato_em?, por, confirmar? }
//   GET  /api/cliente/compras/pedidos?cliente=             → { pedidos[] }
//   POST /api/cliente/compras/pedidos { cliente, id?, produto, estado: sugerida|pedida|recebida|cancelada, …, por, confirmar? } (recebida → entrada no razão)
import { Router } from 'express'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, unlinkSync } from 'node:fs'
import { NOMES, TITULOS, paraCsv, paraHtml } from './lib/relatorios-ciclo.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const ARQ = /^([a-z_]{3,30})(?:\.(csv|html|pdf))?$/

// deps: relatorio(cliente, nome) → montarRelatorio · erp (criarErp) · estilo { FONTES, CSS, capa } · gerarPdf(html, destino) · clienteCanonico(nome) → nome | ''
export function criarRotasRelatoriosCiclo({ relatorio, erp, estilo = {}, gerarPdf = null, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }
  const arquivo = c => `${String(c).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cliente'}`

  r.get('/api/cliente/relatorios', trata((req, res) => res.json({ cliente: cliente(um(req.query.cliente)), relatorios: NOMES.map(nome => ({ nome, titulo: TITULOS[nome] })) })))
  r.get('/api/cliente/relatorios/:arq', trata(async (req, res) => {
    const m = ARQ.exec(String(req.params.arq || '')); if (!m || !NOMES.includes(m[1])) throw erro('relatório não encontrado', 404)
    const c = cliente(um(req.query.cliente)), rel = relatorio(c, m[1]), nomeArq = `${m[1]}-${arquivo(c)}-${rel.hoje || ''}`
    if (!m[2]) return res.json(rel)
    if (m[2] === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}.csv"`); return res.send(paraCsv(rel)) }
    const html = paraHtml(rel, estilo)
    if (m[2] === 'html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(html) }
    if (!gerarPdf) throw erro('PDF indisponível neste servidor', 503)
    const destino = join(tmpdir(), `ps-f9-${process.pid}-${Date.now()}.pdf`)
    try { await gerarPdf(html, destino) } catch { throw erro('não foi possível gerar o PDF (use a versão HTML e imprima)', 503) }
    const buf = readFileSync(destino); try { unlinkSync(destino) } catch { /* temporário */ }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}.pdf"`); res.send(buf)
  }))
  r.get('/api/cliente/estoque/mov', trata((req, res) => res.json({ movimentos: erp.listarMovs(cliente(um(req.query.cliente))) })))
  r.post('/api/cliente/estoque/mov', trata((req, res) => {
    const b = json(req)
    res.json(erp.registrarMov({ cliente: cliente(b.cliente), produto: texto(b.produto), local: texto(b.local), origem: texto(b.origem), quantidade: b.quantidade, custo_unit_c: b.custo_unit_c ?? null,
      fato_em: b.fato_em == null ? undefined : texto(b.fato_em), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.get('/api/cliente/compras/pedidos', trata((req, res) => res.json({ pedidos: erp.listarCompras(cliente(um(req.query.cliente))) })))
  r.post('/api/cliente/compras/pedidos', trata((req, res) => {
    const b = json(req), d = k => (b[k] == null ? undefined : b[k])
    res.json(erp.salvarCompra({ cliente: cliente(b.cliente), id: texto(b.id), produto: texto(b.produto), estado: texto(b.estado), fornecedor: texto(b.fornecedor),
      qtd_sugerida_cons: d('qtd_sugerida_cons') ?? null, qtd_sugerida_base: d('qtd_sugerida_base') ?? null, pedir_ate: texto(b.pedir_ate), qtd_pedida: d('qtd_pedida') ?? null, valor_c: d('valor_c') ?? null,
      pedida_em: texto(b.pedida_em), prevista_em: texto(b.prevista_em), qtd_recebida: d('qtd_recebida') ?? null, recebida_em: texto(b.recebida_em), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  return r
}
