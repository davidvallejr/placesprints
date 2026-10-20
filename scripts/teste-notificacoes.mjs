// Autoteste dos avisos do sistema (sino/som): gravação, janela anti-repetição, leitura incremental, link só interno e tela sem HTML de dado do servidor.
// Roda numa transação revertida: nada fica no banco real.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { db } from '../src/lib/db.js'
import { notificar, listarNotificacoes, marcarLidas } from '../src/lib/notificacoes.js'

db.exec('BEGIN')
try {
  const base = listarNotificacoes().ultimo_id
  const id1 = notificar({ tipo: 'cliente_conectado', nivel: 'sucesso', titulo: 'Novo cliente conectado: Acme', corpo: 'Conta ACME autorizou', cliente: 'Acme', link: '/cliente?cliente=Acme' })
  const id2 = notificar({ tipo: 'conexao_caiu', nivel: 'erro', titulo: 'caiu', cliente: 'Acme', link: 'https://evil.example/x', dedupeMin: 60 })
  assert.ok(id2 > id1)
  assert.equal(notificar({ tipo: 'conexao_caiu', nivel: 'erro', titulo: 'caiu de novo', cliente: 'Acme', dedupeMin: 60 }), id2, 'dentro da janela não repete (devolve a mesma)')
  assert.notEqual(notificar({ tipo: 'conexao_caiu', nivel: 'erro', titulo: 'outro cliente', cliente: 'Beta', dedupeMin: 60 }), id2, 'outro cliente avisa')
  const l = listarNotificacoes({ desde: base })
  assert.equal(l.itens.length, 3); assert.equal(l.itens[0].id, id1, 'ordem cronológica')
  assert.equal(l.itens[0].link, '/cliente?cliente=Acme'); assert.equal(l.itens[1].link, '', 'link para outro domínio é descartado')
  assert.equal(l.ultimo_id, l.itens.at(-1).id)
  assert.equal(listarNotificacoes({ desde: l.ultimo_id }).itens.length, 0, 'leitura incremental: só o que chegou depois')
  assert.equal(notificar({ tipo: 'x', nivel: 'qualquer', titulo: 't' }) > 0, true); assert.equal(listarNotificacoes({ desde: l.ultimo_id }).itens[0].nivel, 'info', 'nível inválido vira info')
  assert.throws(() => notificar({ tipo: 'x' }), /sem tipo ou título/)
  const naoLidas = listarNotificacoes().nao_lidas
  assert.equal(marcarLidas([id1]), 1); assert.equal(listarNotificacoes().nao_lidas, naoLidas - 1)
  assert.ok(marcarLidas() >= 1); assert.equal(listarNotificacoes().nao_lidas, 0)
  assert.equal(notificar({ tipo: 't', titulo: 'a\u0000b\nc'.repeat(100) }) > 0, true)
  assert.ok(listarNotificacoes({ desde: l.ultimo_id }).itens.at(-1).titulo.length <= 160, 'título limitado')
  const barra = notificar({ tipo: 't', titulo: 'x', link: '/\\evil.example' }); assert.equal(listarNotificacoes({ desde: barra - 1 }).itens[0].link, '', 'contrabarra no início não passa')
} finally { db.exec('ROLLBACK') }

// a tela só monta texto com textContent: nenhum dado do servidor entra por innerHTML
const js = readFileSync(new URL('../src/web/alerta.js', import.meta.url), 'utf-8')
const innerHTMLs = [...js.matchAll(/innerHTML\s*=\s*([^\n]+)/g)].map(m => m[1])
assert.ok(innerHTMLs.every(x => /^'[^'$]*'$/.test(x.trim().replace(/;$/, ''))), 'innerHTML só com literal fixo: ' + innerHTMLs.join(' | '))
assert.ok(/linkSeguro/.test(js), 'a tela valida o link antes de montar o <a>')
// link da tela e do servidor: só caminho interno — "/\\evil.example" (que o Chrome resolve para outro host) e "//host" não passam
const rxTela = new RegExp(js.match(/const linkSeguro = l => \/(.+)\/\.test/)[1])
for (const ruim of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/ com espaço']) assert.equal(rxTela.test(ruim), false, ruim)
assert.equal(rxTela.test('/cliente?cliente=Acme%20Ltda'), true)
console.log('teste-notificacoes: OK')
