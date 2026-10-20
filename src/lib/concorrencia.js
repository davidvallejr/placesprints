// CONCORRENTES cadastrados pelo consultor por anúncio (Etapa 3 do relatório personalizado, 13/10/2026; decisão 3 do David: «concorrência — começar pelo que dá»).
// O que dá hoje: (a) catálogo — preço para ganhar e caixa de compra, já coletados (diagnóstico); (b) o consultor anota o concorrente que acompanha (link + preço visto + dia);
// (c) a busca ampla do Mercado Livre NÃO é coletada e o relatório diz isso. Não é um segundo motor: nada aqui decide preço nem ação — só alimenta o bloco 🆚 do relatório.
// Núcleo SEM import de banco (handle, relógio, validarPor e anúncios do cliente entram pela fábrica); prévia por padrão, grava só com confirmar === true; mensagens fixas,
// nunca ecoam o valor recebido. Idempotente por (cliente, anúncio, link, dia): a mesma observação de novo só atualiza o preço.
export const SCHEMA_CONCORRENCIA = `
CREATE TABLE IF NOT EXISTS concorrente_anuncio (      -- concorrente acompanhado pelo consultor (src/lib/concorrencia.js)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                              -- nome canônico da central (nunca prospect)
  item_id TEXT NOT NULL,                              -- anúncio DO CLIENTE (MLB…) que o concorrente disputa
  url TEXT NOT NULL,                                  -- link do anúncio concorrente (https; nunca vai ao texto do cliente)
  preco REAL NOT NULL CHECK (preco > 0),              -- preço visto, arredondado a 2 casas
  observado_em TEXT NOT NULL,                         -- dia em que o preço foi visto (AAAA-MM-DD)
  por TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (cliente, item_id, url, observado_em)
);
CREATE INDEX IF NOT EXISTS ix_concorrente_cliente ON concorrente_anuncio (cliente, item_id);
`
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const DIA = /^\d{4}-\d{2}-\d{2}$/
// dia de calendário que EXISTE (o V8 aceita Date.parse('2026-02-31…') e rola para março): ida e volta pelo ISO
export const diaValido = d => DIA.test(d) && (() => { const t = new Date(`${d}T12:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d })()

// última observação de cada concorrente (anúncio × link) do cliente — o que o relatório mostra; sem tabela (banco antigo) = []
export function concorrentesDoCliente(h, cliente) {
  try {
    return h.prepare(`SELECT c.item_id, c.url, c.preco, c.observado_em FROM concorrente_anuncio c
      WHERE c.cliente = ? AND c.observado_em = (SELECT MAX(x.observado_em) FROM concorrente_anuncio x WHERE x.cliente = c.cliente AND x.item_id = c.item_id AND x.url = c.url)
      ORDER BY c.item_id, c.preco`).all(cliente)
  } catch (e) { if (/no such table/i.test(e.message)) return []; throw e }
}

// deps: agora() ISO, hoje() 'AAAA-MM-DD', validarPor(nome, cliente) → nome canônico | '' (líder/consultor ou o CS deste cliente), anuncioDoCliente(cliente, item_id) → bool
export function criarConcorrencia(h, { agora = () => new Date().toISOString(), hoje = () => agora().slice(0, 10), validarPor = () => '', anuncioDoCliente = () => false } = {}) {
  const cli = c => { const x = str(c); if (!x || ehProspecto(x)) throw erro('cliente inválido'); return x }
  const ler = cliente => ({ cliente: cli(cliente), concorrentes: concorrentesDoCliente(h, cli(cliente)) })

  // registrar({ cliente, item_id, url, preco, observado_em, por, confirmar }) → prévia { ok, previa:true, novo, depois } | { ok, previa:false, novo, depois }
  function registrar(b = {}) {
    const cliente = cli(b.cliente)
    const item = str(b.item_id).toUpperCase()
    if (!/^MLB\d{5,15}$/.test(item)) throw erro('informe "item_id" com o código do anúncio do cliente (MLB…)')
    if (!anuncioDoCliente(cliente, item)) throw erro('anúncio não encontrado neste cliente', 404)
    const url = str(b.url)
    let u; try { u = new URL(url) } catch { u = null }
    if (!u || u.protocol !== 'https:' || url.length > 300 || /[\u0000-\u001f\s<>"]/.test(url)) throw erro('informe "url" com o link https do anúncio concorrente (até 300 caracteres)')
    const bruto = typeof b.preco === 'number' ? b.preco : /^\d{1,7}([.,]\d{1,2})?$/.test(str(b.preco)) ? Number(str(b.preco).replace(',', '.')) : NaN
    const preco = Math.round(bruto * 100) / 100                               // valida o valor JÁ arredondado (0,001 virava 0 e esbarrava no CHECK: 500)
    if (!Number.isFinite(preco) || !(preco > 0) || preco > 1_000_000) throw erro('informe "preco" maior que zero (ex.: 74,90)')
    const dia = str(b.observado_em) || hoje()
    if (!diaValido(dia) || dia > hoje()) throw erro('"observado_em" precisa ser um dia AAAA-MM-DD, hoje ou antes')
    const depois = { item_id: item, url, preco, observado_em: dia }
    const antes = h.prepare('SELECT preco FROM concorrente_anuncio WHERE cliente = ? AND item_id = ? AND url = ? AND observado_em = ?').get(cliente, item, url, dia) || null
    if (b.confirmar !== true) return { ok: true, previa: true, novo: !antes, depois }
    const p = validarPor(str(b.por), cliente)
    if (!p) throw erro('quem registra precisa ser líder, consultor ou o CS deste cliente', 403)
    h.prepare(`INSERT INTO concorrente_anuncio (cliente, item_id, url, preco, observado_em, por, criado_em) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(cliente, item_id, url, observado_em) DO UPDATE SET preco = excluded.preco, por = excluded.por`).run(cliente, item, url, depois.preco, dia, String(p).slice(0, 80), agora())
    return { ok: true, previa: false, novo: !antes, depois }
  }
  return { ler, registrar }
}
