// HTTP do Agente Smith G0 (Guardião financeiro, só leitura + 2 marcações locais). Loopback (guarda-local no server.js). docs/desenho-guardiao-financeiro.md § 6.4 e decisões do David.
// Regras: corpo JSON nos POST (415); `por` = líder/consultor (403); `confirmar` só vale se for EXATAMENTE true (senão = prévia, nada gravado); mensagens fixas, nunca ecoam o valor
// recebido; prospect "[Comercial] …" ou nome fora da central = 404; a mudança de preço precisa ser do próprio cliente (404).
//   GET  /api/cliente/guardiao?cliente=                                  → raio-X { cliente, hoje, sistema:'smith', colunas[6], secoes:[{ chave, titulo, linhas:[{ item, metrica, previsao, chance, medido, nota, ref?, decisor? }] }], fatos, faltando, premissas }
//   GET  /api/cliente/guardiao/pauta[.html|.pdf|.txt]?cliente=&data=AAAA-MM-DD&hora=HH:MM  → JSON { pauta, texto, auditoria:{ ok, codigos } } | HTML 1–2 páginas | PDF (Chrome) | texto
//   POST /api/cliente/preco/decisao { cliente, ref, decisor: cliente|assessoria, por, confirmar? }   → prévia { antes, depois, medicao_inalterada } | gravado (livro de registro)
//   POST /api/cliente/contas-canal { cliente, canal: ml|shopee|amazon|tiktok|magalu, conta, nome_loja?, grupo?, remover?, por, confirmar? }
import { Router } from 'express'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, unlinkSync } from 'node:fs'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const DIA = /^\d{4}-\d{2}-\d{2}$/, HORA = /^([01]\d|2[0-3]):[0-5]\d$/

// deps: raioX(cliente) → rx · pauta(cliente, { data, hora }) → { pauta, texto, html, auditoria } · guardiao (criarGuardiao) · gerarPdf(html, destino) · clienteCanonico(nome) → nome | ''
export function criarRotasGuardiao({ raioX, pauta, guardiao, gerarPdf = null, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }
  const arquivo = c => String(c).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cliente'

  r.get('/api/cliente/guardiao', trata((req, res) => res.json(raioX(cliente(um(req.query.cliente))))))
  r.get(/^\/api\/cliente\/guardiao\/pauta(?:\.(html|pdf|txt))?$/, trata(async (req, res) => {
    const fmt = req.params[0] || '', c = cliente(um(req.query.cliente)), data = um(req.query.data), hora = um(req.query.hora) || '16:00'
    if (data && !DIA.test(data)) throw erro('data inválida: use AAAA-MM-DD')
    if (!HORA.test(hora)) throw erro('hora inválida: use HH:MM')
    const p = pauta(c, { data, hora }), nome = `pauta-${arquivo(c)}-${p.pauta.data}`
    if (!fmt) return res.json({ pauta: p.pauta, texto: p.texto, auditoria: { ok: p.auditoria.ok, codigos: p.auditoria.codigos } })
    if (!p.auditoria.ok) throw erro('a pauta não passou no auditor de texto; revise antes de exportar', 422)
    if (fmt === 'txt') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${nome}.txt"`); return res.send(p.texto) }
    if (fmt === 'html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(p.html) }
    if (!gerarPdf) throw erro('PDF indisponível neste servidor', 503)
    const destino = join(tmpdir(), `ps-pauta-${process.pid}-${Date.now()}.pdf`)
    try { await gerarPdf(p.html, destino) } catch { throw erro('não foi possível gerar o PDF (use a versão HTML e imprima)', 503) }
    const buf = readFileSync(destino); try { unlinkSync(destino) } catch { /* temporário */ }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`); res.send(buf)
  }))
  r.post('/api/cliente/preco/decisao', trata((req, res) => {
    const b = json(req)
    res.json(guardiao.decidir({ cliente: cliente(b.cliente), ref: texto(b.ref), decisor: texto(b.decisor), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/contas-canal', trata((req, res) => {
    const b = json(req)
    res.json(guardiao.salvarConta({ cliente: cliente(b.cliente), canal: texto(b.canal), conta: texto(b.conta), nome_loja: texto(b.nome_loja), grupo: texto(b.grupo), remover: b.remover === true, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  return r
}
