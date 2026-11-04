// Autoteste da calibração por escopo gravada por dia + overrides aprendidos («Neo aprende sobre si», Fase 2). Banco EM MEMÓRIA, sem rede.
//  (1) agruparCalibracao (puro): por regra/família/cliente/global, Brier/MAE/viés/intervalo/Wilson; vazio = []; ordena por n;
//  (2) fotografarCalibracao: grava os 4 escopos em calibracao_dia, regravar o mesmo dia substitui (idempotente); serieCalibracao em ordem crescente; ultimasFotos (2 dias);
//  (3) lerAprendido: arquivo ausente/ilegível = {}; p_sucesso e ativa por regra; regraEmQuarentena só com ativa === false; prefixo anuncio_ ignorado.
// Rodar: node scripts/teste-calibracao-dia.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const Database = (await import('better-sqlite3')).default
const { agruparCalibracao, fotografarCalibracao, serieCalibracao, ultimasFotos, lerAprendido, regraEmQuarentena, SCHEMA_CALIBRACAO } = await import('../src/lib/calibracao.js')

let n = 0, falhou = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log(`✓ ${nome}`) } catch (e) { falhou++; console.log(`✗ ${nome}\n  ${e.message}`) } }
const linha = (cliente, regra, estado, p, prev = 100, real = 100) => ({ cliente, regra, estado, p_sucesso: p, previsto_base: prev, previsto_conservador: prev * 0.5, previsto_otimista: prev * 1.5, realizado: real, dentro_do_intervalo: real >= prev * 0.5 && real <= prev * 1.5 })
const comp = { n: 5, linhas: [
  linha('Acme', 'anuncio_ima_conversao', 'melhorou', 0.4, 100, 120), linha('Acme', 'anuncio_ima_conversao', 'sem_efeito', 0.4, 100, 0),
  linha('Beta', 'anuncio_ima_conversao', 'melhorou', 0.5, 200, 180), linha('Beta', 'anuncio_ads_entrar', 'piorou', 0.6, 300, 50),
  linha('Beta', 'anuncio_ads_entrar', 'lancamento', 0.6, 300, 400),
] }

await ok('agruparCalibracao: por regra, cliente, família e global; Brier/MAE/viés; vazio = []', () => {
  assert.deepEqual(agruparCalibracao({ linhas: [] }, { por: 'regra' }), [])
  const porRegra = agruparCalibracao(comp, { por: 'regra' })
  assert.deepEqual(porRegra.map(g => g.chave), ['ima_conversao', 'ads_entrar'], 'ordena por n, sem prefixo anuncio_')
  const ima = porRegra[0]; assert.equal(ima.n, 3); assert.equal(ima.acertos, 2)
  assert.equal(ima.brier, Math.round(1000 * ((0.4 - 1) ** 2 + (0.4 - 0) ** 2 + (0.5 - 1) ** 2) / 3) / 1000)
  assert.equal(ima.mae, Math.round((20 + 100 + 20) / 3)); assert.equal(ima.vies, Math.round((-20 + 100 + 20) / 3))
  assert.ok(ima.taxa_baixo < ima.taxa && ima.taxa < ima.taxa_alto)
  const ads = porRegra[1]; assert.equal(ads.acertos, 1, 'lançamento com receita conta como acerto'); assert.equal(ads.pct_intervalo, 0.5)
  const porCliente = agruparCalibracao(comp, { por: 'cliente' }); assert.deepEqual(porCliente.map(g => [g.chave, g.n]), [['Beta', 3], ['Acme', 2]])
  const g = agruparCalibracao(comp, { por: 'global' }); assert.equal(g.length, 1); assert.equal(g[0].chave, 'global'); assert.equal(g[0].n, 5)
  const fam = agruparCalibracao(comp, { por: 'familia' }); assert.ok(fam.length >= 1 && fam.every(f => f.chave && f.n > 0), 'família vem de tipo_demanda da regra')
})

await ok('fotografarCalibracao grava os escopos, regravar substitui; serie crescente; ultimasFotos', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_CALIBRACAO)
  const n1 = fotografarCalibracao({ hoje: '2026-11-04', handle: h, comp, versao: '1.6.0' })
  assert.ok(n1 >= 1 + 2 + 2 + 1, `grava global + regras + clientes + famílias (${n1})`)
  assert.equal(fotografarCalibracao({ hoje: '2026-11-04', handle: h, comp, versao: '1.6.0' }), n1); assert.equal(h.prepare('SELECT COUNT(*) n FROM calibracao_dia').get().n, n1, 'mesmo dia não duplica')
  fotografarCalibracao({ hoje: '2026-11-05', handle: h, comp: { linhas: comp.linhas.slice(0, 2) }, versao: '1.6.0' })
  const s = serieCalibracao({ handle: h, dias: 30 }); assert.deepEqual(s.map(x => x.dia), ['2026-11-04', '2026-11-05']); assert.equal(s[1].n, 2)
  assert.equal(serieCalibracao({ handle: h, escopo: 'regra', chave: 'ads_entrar' }).length, 1, 'ads_entrar não está na 2ª foto')
  const f = ultimasFotos({ handle: h, escopo: 'regra', fotos: 2 }); assert.deepEqual(f.map(x => x.dia), ['2026-11-05', '2026-11-04']); assert.equal(f[0].linhas.length, 1)
  assert.equal(fotografarCalibracao({ hoje: '2026-11-06', handle: h, comp: { linhas: [] } }), 0, 'sem medidas: nada gravado, não lança')
})

await ok('lerAprendido / regraEmQuarentena: ausente = {}, p_sucesso e ativa por regra, prefixo ignorado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-aprendido-'))
  assert.deepEqual(lerAprendido(join(dir, 'nao-existe.json')), {})
  writeFileSync(join(dir, 'ruim.json'), '{ nao é json'); assert.deepEqual(lerAprendido(join(dir, 'ruim.json')), {})
  const p = join(dir, 'ok.json'); writeFileSync(p, JSON.stringify({ regras: { ima_conversao: { p_sucesso: 0.55, desde: '2026-11-04', proposta_id: 7 }, frete_gratis: { ativa: false } } }))
  const ap = lerAprendido(p); assert.equal(ap.ima_conversao.p_sucesso, 0.55)
  assert.equal(regraEmQuarentena('frete_gratis', ap), true); assert.equal(regraEmQuarentena('anuncio_frete_gratis', ap), true)
  assert.equal(regraEmQuarentena('ima_conversao', ap), false); assert.equal(regraEmQuarentena('inexistente', ap), false)
  assert.deepEqual(lerAprendido(), {}, 'arquivo real do projeto nasce sem regras aprendidas')
  rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${n} ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
