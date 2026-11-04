// Autoteste do modo «clientes de teste» (src/lib/clientes-teste.js). Sem banco, sem rede.
//  (1) config real nasce com ativo=false e 5 nomes; (2) arquivo ausente/ilegível = desligado; (3) com ativo=true o filtro mantém só a lista (acentos/caixa ignorados); desligado não filtra;
//  (4) scripts/reduzir-para-teste.mjs: prévia por padrão (só --confirmar apaga) e o DELETE só nasce depois da checagem de --confirmar.
// Rodar: node scripts/teste-clientes-teste.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const { lerClientesTeste, filtrarClientesTeste, ehClienteTeste } = await import('../src/lib/clientes-teste.js')
let n = 0, falhou = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log(`✓ ${nome}`) } catch (e) { falhou++; console.log(`✗ ${nome}\n  ${e.message}`) } }
const RAIZ = new URL('..', import.meta.url).pathname

await ok('config real: 5 clientes, ativo=false até o David rodar --confirmar', () => {
  const c = lerClientesTeste(); assert.equal(c.lista.length, 5); assert.equal(c.ativo, false)
})
await ok('ausente/ilegível = desligado; ativo filtra por nome normalizado; desligado não filtra', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-ct-'))
  assert.equal(lerClientesTeste(join(dir, 'x.json')).ativo, false)
  writeFileSync(join(dir, 'ruim.json'), '{'); assert.equal(lerClientesTeste(join(dir, 'ruim.json')).ativo, false)
  writeFileSync(join(dir, 'on.json'), JSON.stringify({ ativo: true, clientes: ['Prisma Indústria e Comércio LTDA', 'Moema Comercio'] }))
  const on = lerClientesTeste(join(dir, 'on.json')); assert.equal(on.ativo, true)
  const itens = [{ nome: 'PRISMA INDUSTRIA E COMERCIO LTDA' }, { nome: 'Moema Comercio' }, { nome: 'Rotec' }]
  assert.deepEqual(filtrarClientesTeste(itens, x => x.nome, on).map(x => x.nome), ['PRISMA INDUSTRIA E COMERCIO LTDA', 'Moema Comercio'])
  assert.equal(ehClienteTeste('rotec', on), false)
  writeFileSync(join(dir, 'off.json'), JSON.stringify({ ativo: false, clientes: ['Moema Comercio'] }))
  assert.equal(filtrarClientesTeste(itens, x => x.nome, lerClientesTeste(join(dir, 'off.json'))).length, 3)
  writeFileSync(join(dir, 'vazio.json'), JSON.stringify({ ativo: true, clientes: [] })); assert.equal(lerClientesTeste(join(dir, 'vazio.json')).ativo, false, 'lista vazia nunca liga (apagaria tudo)')
})
await ok('reduzir-para-teste.mjs: prévia por padrão; DELETE só depois da guarda de --confirmar', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'reduzir-para-teste.mjs'), 'utf-8')
  const guarda = s.indexOf("if (!CONFIRMAR)"), primeiroDelete = s.indexOf('DELETE FROM')
  assert.ok(guarda > 0 && primeiroDelete > guarda, 'nenhum DELETE antes da guarda')
  assert.ok(s.includes('backup-banco.mjs'), 'lembra o backup')
})
console.log(`\n${n} ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
