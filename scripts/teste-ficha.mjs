// Autoteste da ficha do cliente e da delegação: prestadores ativos do Notion atrelados ao cliente (canal × papel), links das contas,
// resolução do responsável (ação > ficha > automático), usuário do Notion sem confundir pessoas, validações e rotas HTTP.
// Sem banco real e sem Notion: banco em memória + rotas com STUBS numa porta efêmera de loopback.
// Rodar: node scripts/teste-ficha.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import express from 'express'
import { SCHEMA_FICHA } from '../src/lib/ficha-schema.js'
import { criarFicha, papelDaAcao, PAPEIS, CANAIS_FICHA, LINKS } from '../src/lib/ficha-nucleo.js'
import { criarRotasFicha } from '../src/rotas-ficha.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const fonte = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')

const novoBanco = () => {
  const h = new Database(':memory:')
  h.exec(SCHEMA_FICHA)
  h.exec('CREATE TABLE usuarios_notion (id TEXT PRIMARY KEY, nome TEXT NOT NULL, nome_norm TEXT NOT NULL, vistas INTEGER NOT NULL DEFAULT 1, visto_em TEXT NOT NULL DEFAULT "")')
  const usuario = (id, nome, vistas = 1) => h.prepare('INSERT INTO usuarios_notion (id, nome, nome_norm, vistas) VALUES (?,?,?,?)').run(id, nome, nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), vistas)
  return { h, usuario }
}
const PRESTADORES = [
  { nome: 'Danielle Nunes da Silva', cargo: 'Analista de E-commerce', area: 'Marketplace', atuacao: ['Uniaodog Artigos Pet'] },
  { nome: 'Vitória de Jesus Rodrigues de Oliveira', cargo: 'Analista de E-commerce', area: 'Marketplace' },
  { nome: 'Giovanna Torres Alves', cargo: 'Consultor de E-commerce', area: 'Marketplace' },
  { nome: 'Ana Paula Souza', cargo: 'Social mídia', area: 'Marketing' },
  { nome: 'Ana Paula Lima', cargo: 'Estagiário', area: 'Marketplace' },
]

await ok('prestadores: só quem foi gravado existe; nova sincronização remove quem saiu (desligado não fica elegível)', () => {
  const { h } = novoBanco(); const f = criarFicha(h)
  assert.equal(f.gravarPrestadores(PRESTADORES), 5)
  assert.equal(f.listarPrestadores().length, 5)
  assert.deepEqual(f.listarPrestadores().find(p => p.nome.startsWith('Danielle')).atuacao, ['Uniaodog Artigos Pet'])
  f.gravarPrestadores(PRESTADORES.slice(0, 2))
  assert.equal(f.listarPrestadores().length, 2)
  assert.equal(f.ehAtivo('Giovanna Torres Alves'), false)
  assert.equal(f.nomeOficial('  vitoria de jesus rodrigues de oliveira '), 'Vitória de Jesus Rodrigues de Oliveira')
})

await ok('usuário do Notion: nome curto do Notion casa com o nome completo do RH (palavras na ordem); ambíguo ou sem casamento = null', () => {
  const { h, usuario } = novoBanco(); const f = criarFicha(h, { usuariosOverride: { 'Giovanna Torres Alves': 'ovr-giovanna' } })
  f.gravarPrestadores(PRESTADORES)
  usuario('u-dani', 'danielle nunes'); usuario('u-vit', 'Vitória Oliveira'); usuario('u-ana', 'Ana Paula'); usuario('u-solo', 'Danielle')
  assert.equal(f.notionDoPrestador('Danielle Nunes da Silva').id, 'u-dani')
  assert.equal(f.notionDoPrestador('Vitória de Jesus Rodrigues de Oliveira').id, 'u-vit')
  assert.equal(f.notionDoPrestador('Giovanna Torres Alves').id, 'ovr-giovanna', 'override do config vence')
  // o usuário "Ana Paula" do Notion cabe em Ana Paula Souza E em Ana Paula Lima: sem como saber qual é => nenhuma das duas casa
  assert.equal(f.notionDoPrestador('Ana Paula Souza'), null)
  assert.equal(f.notionDoPrestador('Ana Paula Lima'), null)
})
await ok('usuário do Notion: dois usuários diferentes que cabem no mesmo nome completo = ambíguo = null (nunca delega à pessoa errada)', () => {
  const { h, usuario } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES)
  usuario('u-a', 'Ana Souza'); usuario('u-b', 'Paula Souza')
  assert.equal(f.notionDoPrestador('Ana Paula Souza'), null, 'dois usuários distintos cabem no mesmo nome completo')
  assert.equal(f.notionDoPrestador('Ninguém Conhecido'), null)
  assert.equal(f.notionDoPrestador(''), null)
})

await ok('salvarFicha: guarda links, observação e prestadores; lerFicha devolve ativo/notion por linha; "por" é obrigatório', () => {
  const { h, usuario } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES); usuario('u-dani', 'danielle nunes')
  assert.throws(() => f.salvarFicha({ cliente: 'X', links: {}, prestadores: [] }), /por/)
  const r = f.salvarFicha({
    cliente: 'X', por: 'David', observacao: 'cliente prefere WhatsApp',
    links: { ml: 'https://perfil.mercadolivre.com.br/LOJA', drive: 'https://drive.google.com/drive/folders/abc', shopee: '' },
    prestadores: [{ canal: 'ML', papel: 'analista', prestador: 'danielle nunes da silva' }, { canal: '', papel: 'consultor', prestador: 'Giovanna Torres Alves' }, { canal: 'SHO', papel: 'analista', prestador: '' }],
  })
  assert.deepEqual(r.links, { ml: 'https://perfil.mercadolivre.com.br/LOJA', drive: 'https://drive.google.com/drive/folders/abc' })
  assert.equal(r.prestadores.length, 2)
  const an = r.prestadores.find(p => p.papel === 'analista')
  assert.deepEqual([an.canal, an.prestador, an.ativo, an.notion], ['ML', 'Danielle Nunes da Silva', true, true], 'grava o nome OFICIAL do RH')
  assert.equal(r.prestadores.find(p => p.papel === 'consultor').notion, false, 'sem usuário no Notion fica sinalizado')
  assert.equal(r.por, 'David')
})
await ok('salvarFicha: regrava tudo (remover = esvaziar), não vaza entre clientes e é atômica (erro não apaga o que existia)', () => {
  const { h } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES)
  f.salvarFicha({ cliente: 'A', por: 'x', prestadores: [{ canal: '', papel: 'analista', prestador: 'Danielle Nunes da Silva' }] })
  f.salvarFicha({ cliente: 'B', por: 'x', prestadores: [{ canal: '', papel: 'analista', prestador: 'Vitória de Jesus Rodrigues de Oliveira' }] })
  assert.throws(() => f.salvarFicha({ cliente: 'A', por: 'x', prestadores: [{ canal: '', papel: 'analista', prestador: 'Fantasma' }] }))
  assert.equal(f.lerFicha('A').prestadores[0].prestador, 'Danielle Nunes da Silva', 'falha não apagou a ficha anterior')
  f.salvarFicha({ cliente: 'A', por: 'x', prestadores: [] })
  assert.equal(f.lerFicha('A').prestadores.length, 0)
  assert.equal(f.lerFicha('B').prestadores.length, 1)
})
await ok('validação: link só http(s); prestador fora dos ativos, canal/papel/chave desconhecidos são recusados SEM repetir o valor recebido', () => {
  const { h } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES)
  const tenta = (extra, rx) => { try { f.salvarFicha({ cliente: 'X', por: 'x', ...extra }); assert.fail('deveria recusar') } catch (e) { assert.match(e.message, rx); assert.equal(e.status, 400); return e.message } }
  for (const ruim of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://x.com/a', 'http://', 'https://a b.com', 'https://x.com/"><script>x</script>', 'https://' + 'a'.repeat(600)]) {
    const m = tenta({ links: { ml: ruim } }, /link inválido/); assert.ok(!m.includes('script') && !m.includes('alert'))
  }
  tenta({ links: { cpf: 'https://a.com' } }, /desconhecida/)
  tenta({ links: [] }, /objeto/)
  tenta({ prestadores: [{ canal: 'XX', papel: 'analista', prestador: 'Danielle Nunes da Silva' }] }, /canal/)
  tenta({ prestadores: [{ canal: '', papel: 'chefe', prestador: 'Danielle Nunes da Silva' }] }, /papel/)
  const m = tenta({ prestadores: [{ canal: '', papel: 'analista', prestador: '<img src=x onerror=1>' }] }, /não encontrado/); assert.ok(!m.includes('onerror'))
})

await ok('responsável da ficha: canal vale mais que o geral; sem atribuição = null; prestador desligado cai para o próximo critério', () => {
  const { h, usuario } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES); usuario('u-dani', 'danielle nunes'); usuario('u-vit', 'Vitória Oliveira')
  f.salvarFicha({ cliente: 'X', por: 'x', prestadores: [
    { canal: '', papel: 'analista', prestador: 'Vitória de Jesus Rodrigues de Oliveira' },
    { canal: 'ML', papel: 'analista', prestador: 'Danielle Nunes da Silva' },
  ] })
  assert.equal(f.prestadorDaFicha('X', 'ML', 'analista').nome, 'Danielle Nunes da Silva')
  assert.equal(f.prestadorDaFicha('X', 'ML', 'analista').notion.id, 'u-dani')
  assert.equal(f.prestadorDaFicha('X', 'SHO', 'analista').nome, 'Vitória de Jesus Rodrigues de Oliveira', 'canal sem atribuição própria usa a geral')
  assert.equal(f.prestadorDaFicha('X', 'ML', 'consultor'), null)
  assert.equal(f.prestadorDaFicha('Y', 'ML', 'analista'), null)
  f.gravarPrestadores(PRESTADORES.filter(p => !p.nome.startsWith('Danielle')))      // Danielle saiu da empresa
  assert.equal(f.prestadorDaFicha('X', 'ML', 'analista').nome, 'Vitória de Jesus Rodrigues de Oliveira', 'desligada não recebe tarefa: cai para a atribuição geral')
  assert.equal(f.lerFicha('X').prestadores.find(p => p.canal === 'ML').ativo, false, 'e a tela mostra que a atribuição ficou inativa')
})
await ok('papelDaAcao: imagem/vídeo/design vão para o apoio; o resto para o analista', () => {
  assert.equal(papelDaAcao({ dados: { demanda_notion: 'Imagens e vídeos' } }), 'apoio')
  assert.equal(papelDaAcao({ dados: { demanda_notion: 'Otimizar anúncios' }, titulo: 'x' }), 'analista')
  assert.equal(papelDaAcao({ dados: {}, titulo: 'Refazer capa do anúncio' }), 'apoio')
  assert.equal(papelDaAcao({}), 'analista')
})

// ── rotas HTTP com stubs ───────────────────────────────────────────────────────────────────────────────────
function subir(deps) {
  const app = express(); app.use(express.json()); app.use(criarRotasFicha(deps))
  return new Promise(res => { const srv = app.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` })) })
}
const chama = async (base, caminho, corpo, tipo = 'application/json') => {
  const r = await fetch(base + caminho, corpo === undefined ? undefined : { method: 'POST', headers: tipo ? { 'Content-Type': tipo } : {}, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
{
  const { h } = novoBanco(); const f = criarFicha(h); f.gravarPrestadores(PRESTADORES)
  const delegados = []
  const { srv, base } = await subir({
    ficha: f, sincronizarPrestadores: async () => 5, papeis: PAPEIS, canais: CANAIS_FICHA, links: LINKS,
    clienteCanonico: nome => /^uniaodog/i.test(nome) ? 'Uniaodog Artigos Pet' : null,
    sugestoesDoCliente: c => c === 'Uniaodog Artigos Pet' ? { ml: 'https://perfil.mercadolivre.com.br/UNIAODOG' } : {},
    delegar: (ids, nome) => { delegados.push([ids, nome]); return ids.length },
  })
  try {
    await ok('GET /api/ficha: ficha + sugestão do link do ML + prestadores + rótulos; cliente inexistente = 404; sem cliente = 400', async () => {
      const a = await chama(base, '/api/ficha?cliente=uniaodog%20artigos%20pet')
      assert.equal(a.status, 200); assert.equal(a.j.ficha.cliente, 'Uniaodog Artigos Pet'); assert.equal(a.j.sugestoes.ml, 'https://perfil.mercadolivre.com.br/UNIAODOG')
      assert.equal(a.j.prestadores.length, 5); assert.ok(a.j.papeis.length >= 3 && a.j.links.length >= 6 && a.j.canais.ML)
      assert.equal((await chama(base, '/api/ficha?cliente=zzz')).status, 404)
      assert.equal((await chama(base, '/api/ficha')).status, 400)
    })
    await ok('POST /api/ficha: salva; só corpo JSON (415 sem); cliente inexistente 404; prestador inválido 400', async () => {
      const corpo = { cliente: 'uniaodog artigos pet', por: 'David', links: { drive: 'https://drive.google.com/x' }, prestadores: [{ canal: 'ML', papel: 'analista', prestador: 'Danielle Nunes da Silva' }] }
      const a = await chama(base, '/api/ficha', corpo); assert.equal(a.status, 200); assert.equal(a.j.ficha.prestadores[0].prestador, 'Danielle Nunes da Silva')
      assert.equal((await chama(base, '/api/ficha', JSON.stringify(corpo), 'text/plain')).status, 415)
      assert.equal((await chama(base, '/api/ficha', { ...corpo, cliente: 'zzz' })).status, 404)
      assert.equal((await chama(base, '/api/ficha', { ...corpo, prestadores: [{ canal: 'ML', papel: 'analista', prestador: 'Fantasma' }] })).status, 400)
      assert.equal((await chama(base, '/api/ficha', { ...corpo, links: { drive: 'javascript:1' } })).status, 400)
      assert.equal((await chama(base, '/api/ficha', { ...corpo, por: '' })).status, 400)
    })
    await ok('POST /api/planos/acoes/delegar: nome oficial vai para delegar(); vazio limpa; prestador fora dos ativos 400; ids obrigatórios e limitados', async () => {
      const a = await chama(base, '/api/planos/acoes/delegar', { ids: ['PS-1', 'PS-2'], prestador: 'vitoria de jesus rodrigues de oliveira' })
      assert.equal(a.status, 200); assert.equal(a.j.alteradas, 2); assert.deepEqual(delegados.at(-1), [['PS-1', 'PS-2'], 'Vitória de Jesus Rodrigues de Oliveira'])
      await chama(base, '/api/planos/acoes/delegar', { ids: ['PS-1'], prestador: '' }); assert.deepEqual(delegados.at(-1), [['PS-1'], ''])
      assert.equal((await chama(base, '/api/planos/acoes/delegar', { ids: ['PS-1'], prestador: 'Fantasma' })).status, 400)
      assert.equal((await chama(base, '/api/planos/acoes/delegar', { ids: [], prestador: '' })).status, 400)
      assert.equal((await chama(base, '/api/planos/acoes/delegar', { ids: Array.from({ length: 501 }, (_, i) => 'PS-' + i), prestador: '' })).status, 400)
      assert.equal((await chama(base, '/api/planos/acoes/delegar', JSON.stringify({ ids: ['PS-1'] }), 'text/plain')).status, 415)
    })
    await ok('GET /api/prestadores e POST /api/prestadores/sincronizar', async () => {
      assert.equal((await chama(base, '/api/prestadores')).j.prestadores.length, 5)
      assert.equal((await chama(base, '/api/prestadores/sincronizar', {})).j.prestadores, 5)
    })
  } finally { srv.close() }
}

// ── fiação: o que não dá para exercitar sem banco/Notion fica garantido pelo código ───────────────────────────
await ok('fiação: rotas montadas, delegação grava só em proposta/aprovada, distribuição usa ação > ficha > analista da conta > consultor com roteiro do Manual, só dados mínimos do RH', () => {
  const rp = fonte('src/rotas-planos.js')
  assert.match(rp, /criarRotasFicha\(/)
  assert.match(rp, /UPDATE acoes_plano SET delegado_a = \?, atualizado_em = \? WHERE id = \? AND status IN \('proposta','aprovada'\)/)
  const d = fonte('src/lib/distribuir-notion.js')
  assert.match(d, /ficha\.ehAtivo\(a\.delegado_a\)/); assert.match(d, /prestadorDaFicha\(a\.cliente, canalK, papel\)/); assert.match(d, /Manual do Analista, processo/)
  assert.ok(d.indexOf("origem: 'escolhido na aprovação'") < d.indexOf("origem: 'ficha do cliente'") && d.indexOf("origem: 'ficha do cliente'") < d.indexOf("origem: 'analista da conta'") && d.indexOf("origem: 'analista da conta'") < d.indexOf("origem: 'consultor do canal'"))
  const fc = fonte('src/lib/ficha-cliente.js')
  for (const proibido of ['CPF', 'Salário', 'Conta bancária', 'CNPJ', 'RG', 'Data de nascimento', 'Telefone', 'E-mail']) assert.ok(!new RegExp(`pr\\[?\\.?['"]?${proibido}`).test(fc), `não lê ${proibido}`)
  assert.match(fc, /Status\?\.select\?\.name \|\| ''\) !== 'Ativo'/)
  assert.match(fonte('src/lib/db.js'), /ADD COLUMN delegado_a/)
})

console.log(`\n${n} verificações ok`)
