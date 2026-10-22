// O dono (config/equipe.json → donos) aprova tudo sem depender de ninguém: nome completo ou o começo do nome por palavras inteiras.
// Banco em memória: nenhum outro membro da equipe, então «David» só pode ser o dono; «Dav» (palavra incompleta) e estranhos não passam.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { ehDono, validarLiderOuConsultor, donos } = await import('../src/lib/equipe.js')
const { validarDossie } = await import('../src/lib/livro-registro-real.js')

assert.ok(donos().includes('David do Valle'), 'dono configurado')
for (const n of ['David', 'david', 'DAVID', 'David do Valle', '  David do Valle  ']) {
  assert.ok(ehDono(n), `dono reconhecido: ${n}`)
  assert.ok(validarLiderOuConsultor(n), `aprova: ${n}`)
  assert.ok(validarDossie(n, 'Cliente Qualquer'), `aprova por cliente: ${n}`)
}
for (const n of ['', 'Dav', 'Valle', 'Fulano de Tal', 'Davidson']) {
  assert.equal(ehDono(n), '', `não é dono: ${JSON.stringify(n)}`)
  assert.equal(validarLiderOuConsultor(n), '', `não aprova: ${JSON.stringify(n)}`)
}
console.log('✓ dono aprova sem depender de ninguém (nome completo ou começo do nome); estranhos e nomes parciais barrados')
