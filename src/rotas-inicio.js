// Página inicial «Sucesso do cliente» (modo clientes de teste, docs/desenho-ambiente-teste.md § 3; 04/11/2026). Loopback. SÓ LEITURA.
//   GET /api/modo   → { teste, clientes: n } — o shell lê para mostrar 3 menus em vez de 5
//   GET /api/inicio → { hoje, modo_teste, clientes[], resumo, hoje_sistema[] }: por cliente receita 28 d + variação (gmv.js), etapa atual (progresso) e o
//                     próximo passo da Jornada (jornada.js); linha do tempo = livro de execução (execucao_sistema) das últimas 24 h, em frases de 1 linha
import { Router } from 'express'

const FRASE = {
  coleta_ml: r => `Coleta do Mercado Livre: ${r.ok ?? '—'} de ${r.total ?? '—'} contas`,
  sync_notion: r => `Notion sincronizado: ${r.total ?? 0} páginas lidas`,
  medicao: () => 'Medição do antes × depois das tarefas',
  testes: r => `Testes do sistema: ${r.ok ?? '—'} de ${r.total ?? '—'} verdes`,
  boot: () => 'Servidor iniciado',
  reduzir_para_teste: r => `Ambiente reduzido para ${r.ok} clientes de teste`,
}

// deps: modo() → lerClientesTeste() · gmv() → gmvPortfolio({dias:28}).clientes · progresso.carteira/jornada · livro.recentes(horas) · hoje()
export function criarRotasInicio({ modo, gmv, progresso, livro, hoje }) {
  const r = Router()
  r.get('/api/modo', (req, res) => { const m = modo(); res.set('Cache-Control', 'no-store').json({ teste: m.ativo, clientes: m.lista.length }) })
  r.get('/api/inicio', (req, res) => {
    try {
      const m = modo()
      const porNome = new Map(gmv().map(c => [c.cliente, c]))
      const cart = progresso.carteira({ tipo: 'total' })
      const clientes = cart.clientes.map(c => {
        const g = porNome.get(c.cliente), j = progresso.jornada(c.cliente), p = j.proximo
        return { cliente: c.cliente, consultor: g?.consultor || '', gmv: g ? g.gmv : null, anterior: g ? g.anterior : null, delta_pct: g ? g.delta_pct : null, cobertura_ok: g ? g.cobertura_ok : false,
          etapa: { n: c.etapa, nome: c.nome, estado: c.estado, atraso_txt: c.atraso_txt || '' }, passos: j.resumo,
          proximo: p ? { nome: p.nome, quem: p.quem, quem_rotulo: p.quem_rotulo, estado: p.estado, numero: p.numero, motivo: p.motivo, destrava: p.destrava, acao: p.acao, ir: p.ir, etapa: p.etapa } : null,
          pede_dado: !!p && p.quem === 'cliente' }
      }).sort((a, b) => (b.proximo?.estado === 'atrasado') - (a.proximo?.estado === 'atrasado') || (b.gmv || 0) - (a.gmv || 0))
      const resumo = { clientes: clientes.length, pedem_dado: clientes.filter(c => c.pede_dado).length, atrasados: clientes.filter(c => c.proximo?.estado === 'atrasado').length, em_dia: clientes.filter(c => !c.proximo).length }
      const hoje_sistema = livro.recentes(24).map(l => ({ em: l.inicio, sistema: l.sistema, texto: (FRASE[l.operacao] || (() => l.operacao))(l), ok: l.falhas == null || l.falhas === 0, ms: l.ms }))
      res.set('Cache-Control', 'no-store').json({ hoje: hoje(), modo_teste: m.ativo, clientes, resumo, hoje_sistema })
    } catch (e) { res.status(500).json({ erro: 'página inicial indisponível' }) }
  })
  return r
}
