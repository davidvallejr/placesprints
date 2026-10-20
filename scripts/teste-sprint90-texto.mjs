// Autoteste da PROJEÇÃO ao cliente do Place Sprint 90 (fase F1, parte guarda/projeção do teste 4 do desenho; a parte da landing é de scripts/teste-s90-landing.mjs).
// PURO: sem banco real, sem rede. Prova: (1) para CADA regra de config/algoritmo.json, uma ação sintética passa por acaoParaCliente sem promessa, causalidade,
// jargão, nome interno, PS-…, consultor/analista/briefing/Notion/card — a linha reprovada é OMITIDA e contada, a boa fica; (2) o título perde o "(MLB…)" e
// anuncio.id o preserva; (3) lista FECHADA de campos (nada de responsável, squad, Notion, profissional, lógica, retro, id da ação); (4) executa × recomenda (D6);
// (5) a cópia fixa das páginas NÃO passa pelo auditor (contém "Place Sprint 90", que o auditor barraria) e as páginas são autocontidas, com CSP por nonce.
// Rodar: node scripts/teste-sprint90-texto.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports (nenhum import abaixo abre banco, mas a convenção vale)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { acaoParaCliente, criarCrivo, modoDaAcao, MODO_TEXTO } = await import('../src/lib/s90-texto.js')
const { achaJargao, achaPromessa, achaCausal, ID_INTERNO } = await import('../src/lib/relatorio-seguro.js')
const P = await import('../src/lib/s90-paginas.js')

const RAIZ = new URL('..', import.meta.url).pathname
const algoritmo = JSON.parse(readFileSync(RAIZ + 'config/algoritmo.json', 'utf8'))
const NOMES = ['Giovanna Torres', 'Bruno Lima']
const RUINS = ['Vai vender o dobro com certeza garantida', 'A queda foi causada pelo preço', 'Ajustar no Notion e no sync', 'Feito pela Giovanna Torres na semana',
  'Ver a tarefa PS-0a1b2c3d4e', 'Consultor revisa o briefing antes', 'Registrar no card a mudança', 'O analista confere a ficha', 'Reunir com o cliente: CMV e impostos', 'Prefira testar numa DUPLICATA do anúncio']
const BOAS = ['Conversão de 2,1% contra 3,4% da própria conta', 'Revisar as fotos principais do anúncio', 'Voz do cliente: ler perguntas e avaliações do anúncio']
const proibido = t => achaPromessa(t) || achaCausal(t) || achaJargao(t) || ID_INTERNO.test(t) || /consultor|analista|briefing|notion|\bcard\b|giovanna|torres|PS-|com o cliente/i.test(t)
// todo TEXTO que vai ao cliente (folhas string), menos o anúncio, que é do próprio cliente (fora do crivo); chaves do JSON não são texto lido
const textos = o => { const out = []; const andar = (v, k) => { if (k === 'anuncio') return; if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') for (const [k2, x] of Object.entries(v)) andar(x, k2) }; andar(o, ''); return out.join('\n') }

// (1) cada regra do motor
let regras = 0
for (const r of algoritmo.regras) {
  const acao = {
    titulo: `Ação ${regras + 1}: Produto de teste (MLB123456789)`, regra: 'anuncio_' + r.id, prazo: '2026-10-20', status: 'proposta',
    dados: {
      problema: BOAS[0], evidencia: RUINS[1], hipotese: RUINS[0], como: [BOAS[1], BOAS[2], ...RUINS], indicador_inicial: 'conversão 2,1%', meta: RUINS[5], criterio_aceite: RUINS[6],
      item: { id: 'MLB123456789', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-123456789-x-_JM', thumb: 'http://http2.mlstatic.com/D_123-O.jpg' },
      responsavel: 'Giovanna Torres', squad: 'Squad Azul', notion_url: 'https://www.notion.so/abc', profissional_sugerido: { recomendado: 'Bruno Lima' }, logica: 'Prioridade 80/100', retro: { fator: 1.2 },
      executar_via: r.id === 'ima_conversao' ? 'oferta' : 'notion',
    },
    previsao: { tipo: 'ganho', horizonte_dias: 28, cenarios: { conservador: { unidades: 1, receita: 50 }, base: { unidades: 2, receita: 100 }, otimista: { unidades: 3, receita: 150 } },
      premissas: ['visitas 28d = 300', RUINS[2]], p_sucesso: 0.4, p_fonte: 'prior declarado (premissa)', aviso: 'x' },
    responsavel: 'Giovanna Torres', squad: 'Squad Azul', id: 'PS-0a1b2c3d4e',
  }
  const out = acaoParaCliente(acao, { nomesInternos: NOMES, permitidos: ['Loja Teste'] })
  const corpo = textos(out)
  assert.ok(!proibido(corpo), `regra ${r.id}: texto proibido saiu ao cliente: ${corpo.slice(0, 300)}`)
  assert.equal(out.problema, BOAS[0]); assert.deepEqual(out.como, [BOAS[1], BOAS[2]], `regra ${r.id}: as linhas boas ficam ("voz do cliente" é método), as ruins saem`)
  assert.equal(out.evidencia, null); assert.equal(out.hipotese, null); assert.equal(out.meta, null); assert.equal(out.aceite, null)
  assert.equal(out.linhas_omitidas, RUINS.length + 5, `regra ${r.id}: cada linha reprovada é contada`)   // evidencia, hipotese, meta, aceite, 1 premissa + as 8 do "como"
  assert.deepEqual(out.previsao.premissas, ['visitas 28d = 300']); assert.equal(out.previsao.cenarios.base.receita, 100); assert.equal(out.previsao.p_sucesso, 0.4)
  for (const k of ['responsavel', 'squad', 'notion_url', 'profissional_sugerido', 'logica', 'retro', 'id', 'dados', 'score', 'status']) assert.ok(!(k in out), `regra ${r.id}: campo ${k} não pode sair`)
  regras++
}
assert.ok(regras >= 25, 'todas as regras do motor foram exercitadas')

// (2) título sem o "(MLB…)", anúncio estruturado preservado; foto só https do mlstatic; link só do ML
{
  const o = acaoParaCliente({ titulo: 'Quebrar objeções de conversão: Produto X (MLB987654321)', dados: { item: { id: 'MLB987654321', titulo: 'Produto X', permalink: 'javascript:alert(1)', thumb: 'https://evil.example/x.jpg' } } })
  assert.equal(o.titulo, 'Quebrar objeções de conversão: Produto X'); assert.equal(o.anuncio.id, 'MLB987654321')
  assert.equal(o.anuncio.permalink, '', 'link que não é do Mercado Livre não sai'); assert.equal(o.anuncio.thumb, '', 'foto fora do mlstatic não sai')
  const ok = acaoParaCliente({ titulo: 't (MLB1)', dados: { item: { id: 'MLB1', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x', thumb: 'http://http2.mlstatic.com/D_1.jpg' } } })
  assert.equal(ok.anuncio.thumb, 'https://http2.mlstatic.com/D_1.jpg', 'foto do ML sobe para https (CSP img-src https:)')
  assert.equal(acaoParaCliente({ titulo: 'Vai vender o dobro (MLB1)', dados: {} }).titulo, 'Prioridade da semana', 'título reprovado vira texto fixo, nunca some o cartão')
}

// (3) crivo isolado: nome de cliente permitido não vira vazamento; linha vazia não conta
{
  const c = criarCrivo({ nomesInternos: ['Ana Silva'], permitidos: ['Silva Modas'] })
  assert.equal(c.linha('Anúncios da Silva Modas com estoque baixo'), 'Anúncios da Silva Modas com estoque baixo')
  assert.equal(c.linha('Feito pela Ana Silva'), null); assert.equal(c.linha(''), null); assert.equal(c.omitidas, 1)
}

// (4) executa × recomenda (D6): Ofertas (ímã, fotos, frete) e oferta_* = o sistema prepara e o cliente aprova; o resto = recomendação
assert.equal(modoDaAcao({ regra: 'anuncio_ima_conversao', dados: { executar_via: 'oferta', executar_via_oferta: { escopo: 'oferta_completa' } } }), 'executa')
assert.equal(modoDaAcao({ regra: 'anuncio_oferta_preco', dados: {} }), 'executa')
assert.equal(modoDaAcao({ regra: 'anuncio_duplicacao_estrategica', dados: { executar_via: 'oferta', executar_via_oferta: { duplicacao: true } } }), 'recomenda')
assert.equal(modoDaAcao({ regra: 'anuncio_ads_reduzir', dados: { executar_via: 'notion' } }), 'recomenda')
for (const t of Object.values(MODO_TEXTO)) assert.ok(!achaPromessa(t) && !achaCausal(t), 'texto do modo sem promessa nem causalidade')

// (5) páginas: cópia fixa com o nome do produto (que o auditor barraria: prova que ela NÃO passa pelo auditor), autocontidas, CSP por nonce, sem innerHTML
{
  assert.ok(achaJargao('Place Sprint 90'), 'o auditor do motor barra "Sprint 90" — por isso a cópia fixa fica fora dele')
  const res = { h: {}, set(o) { Object.assign(this.h, o); return this } }
  const nonce = P.cabecalhos(res)
  assert.match(nonce, /^[A-Za-z0-9+/=]{20,}$/); assert.match(res.h['Content-Security-Policy'], new RegExp(`script-src 'nonce-${nonce.replace(/[+/=]/g, '\\$&')}'`))
  assert.match(res.h['Content-Security-Policy'], /default-src 'none'/); assert.match(res.h['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.equal(res.h['Cache-Control'], 'no-store'); assert.equal(res.h['X-Frame-Options'], 'DENY'); assert.equal(res.h['Referrer-Policy'], 'same-origin', 'same-origin: no-referrer manda Origin: null no POST de formulário e a guarda barra'); assert.match(res.h['X-Robots-Tag'], /noindex/)
  const paginas = [P.paginaPainel({ nonce }), P.paginaEntrar({ nonce }), P.paginaAcesso({ nonce }), P.paginaErro('X', 'Y', { nonce }),
    P.paginaTermos({ nonce, termos: { versao: 's90-v1', texto: '# RASCUNHO\n\n## Parte A\n\ntexto <script>alert(1)</script>\n\n## Parte B — Aviso de Privacidade\n\n- item **forte**', rascunho: true } }),
    P.paginaTermos({ nonce, termos: { versao: 's90-v1', texto: '## Parte A\n\nA\n\n## Parte B — Aviso de Privacidade\n\nSó privacidade\n\n## Anexo\n\nfim' }, privacidade: true }), P.paginaExcluida({ nonce, revogado: true })]
  for (const h of paginas) {
    assert.ok(h.includes(P.PRODUTO), 'cópia fixa com o nome do produto'); assert.match(h, /noindex/)
    assert.ok(!/\/ui\.css|\/shell\.js|\/alerta\.js/.test(h), 'autocontida: nada do painel interno')
    for (const m of h.matchAll(/<script\b([^>]*)>/g)) assert.equal(m[1], ` nonce="${nonce}"`, 'todo <script> com o nonce')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(h.replace(/:root\{[^}]*\}/, '')), 'cor só por token (hex só no :root copiado do ui.css)')
  }
  assert.ok(!/innerHTML/.test(paginas[0]), 'o painel monta o DOM por textContent, nunca innerHTML')
  assert.ok(!paginas[4].includes('<script>alert'), 'o texto dos termos é escapado'); assert.match(paginas[4], /Rascunho em revisão jurídica/); assert.match(paginas[4], /<b>forte<\/b>/)
  assert.ok(paginas[5].includes('Só privacidade') && !paginas[5].includes('<p>A</p>') && !paginas[5].includes('fim'), '/c/privacidade = só a seção do aviso de privacidade')
  assert.match(paginas[0], /Resumo[\s\S]*Prioridades[\s\S]*Conta/); assert.match(paginas[0], /\/c\/api\/resumo/); assert.match(paginas[0], /\/c\/api\/acoes/)
  assert.match(paginas[0], /\/c\/conectar/); assert.match(paginas[0], /Guardar meu acesso/); assert.match(paginas[0], /action="\/c\/sair"/); assert.match(paginas[0], /\/c\/api\/dados\/excluir/)
  assert.match(paginas[1], /Perdeu o link\? Fale com a Place2u/); assert.ok(!/type="email"/.test(paginas[1]), '/c/entrar sem formulário de e-mail')
  assert.match(paginas[2], /<form method="post">/, 'o GET do link só mostra o botão: quem consome é o POST')
}
console.log(`✔ sprint90-texto: ${regras} regras projetadas sem promessa/causalidade/jargão/nome interno/PS-/bastidor (linha reprovada omitida e contada), título sem MLB e anúncio estruturado, lista fechada de campos, executa × recomenda, páginas autocontidas com CSP por nonce e cópia fixa fora do auditor`)
