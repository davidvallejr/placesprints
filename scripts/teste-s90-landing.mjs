// Autoteste da F0 do Place Sprint 90 (só texto, sem rede nem banco): landing honesta e coerente com config/sprint90.json,
// etapa 4 do checkout sem envio, termos s90-v1 com as decisões do David, metodologia com "quem decide" novo.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const ler = p => readFileSync(new URL('../' + p, import.meta.url), 'utf-8')
const cfg = JSON.parse(ler('config/sprint90.json'))
const L = ler('assets/sprint90/landing.html')
const T = ler('config/termos-sprint90.md')
const M = ler('docs/metodologia-algoritmo.md')
const reais = c => (c / 100).toLocaleString('pt-BR')                     // 99700 → "997"; 543000 → "5.430"
const fixo = cfg.planos.fixo.centavos, cresc = cfg.planos.crescimento.centavos, pct = cfg.planos.crescimento.comissao_pct

// 1) nada do texto antigo nem promessa
for (const proibido of ['197', '7 mil', 'MP_CHECKOUT', 'título em anúncio novo', 'título de anúncio novo', 'Pix ou boleto', 'só de leitura'])
  assert.ok(!L.includes(proibido), `landing contém "${proibido}"`)
assert.doesNotMatch(L, /(^|[^\d,.])2\s?%/, 'percentual antigo de 2%')
assert.doesNotMatch(L, /garantid/i)
assert.doesNotMatch(L, /duplica/i, 'duplicação fica fora da v1')
assert.doesNotMatch(L, /(mais vendas|vendas garantidas|vender mais|venda mais|aument\w+ (as |suas )?vendas|primeira página|topo da busca|subir no ranking|(vai|vão|irá|irão) (vender|subir|aumentar))/i, 'promessa de vendas/ranking')
assert.match(L, /sem garantia de faturamento/)
for (const m of L.matchAll(/Imagens com IA/g)) assert.ok(L.startsWith(' (quando ativo', m.index + m[0].length), 'imagens com IA sem "(quando ativo"')

// 2) preços coerentes com o config (centavos → reais)
assert.ok(L.includes(`R$ ${reais(fixo)}<small>/mês`) && L.includes(`R$ ${reais(cresc)}<small>/mês`), 'preços dos cartões')
assert.ok(L.includes(`R$ ${reais(fixo)},00`) && L.includes(`R$ ${reais(cresc)},00`), 'valor de hoje no checkout')
assert.ok(L.includes(`+ ${pct}% do faturamento bruto aprovado`), 'percentual da comissão')
const calc = L.match(/var fixo=(\d+), cresc=(\d+)\+Math\.round\(v\*100\*0\.(\d+)\)/)
assert.ok(calc, 'calculadora encontrada'); assert.deepEqual([+calc[1], +calc[2], +calc[3]], [fixo, cresc, pct], 'calculadora = config')
assert.ok(L.includes(`R$ ${reais((fixo - cresc) * 100 / pct)} por mês`), 'ponto de equilíbrio entre os planos')
assert.ok(L.includes(`<b class="num">${cfg.turma_fundadora.vagas}</b>`) && L.includes(`${cfg.turma_fundadora.preco_travado_meses} meses`), 'turma fundadora')

// 3) FAQ das decisões
const faq = s => { const m = L.match(new RegExp(`<summary>${s}</summary><div class="a">(.*?)</div></details>`)); assert.ok(m, `FAQ "${s}"`); return m[1] }
const acesso = faq('Como entro no painel\\?'); assert.match(acesso, /link de acesso/); assert.match(acesso, /não enviamos e-mail/); assert.match(acesso, /Place2u/)
assert.ok(faq('Posso desistir depois de contratar\\?').includes(`${cfg.arrependimento_dias} dias`))
assert.match(faq('Posso cancelar quando quiser\\?'), new RegExp(`${cfg.arrependimento_dias} dias.*arrependimento`))
const quando = faq('Quando a comissão é cobrada\\?')
assert.ok(quando.includes(`${cfg.fechamento.dias_apos_fim_mes} dias depois do fim do mês`) && quando.includes(`vence em ${cfg.fatura.vencimento_dias} dias`)); assert.match(quando, /extrato pedido a pedido/)
const atraso = faq('E se eu atrasar um pagamento\\?')
assert.ok(atraso.includes(`${cfg.fatura.carencia_dias} dias de carência`) && atraso.includes(`${cfg.inadimplencia.pausar_assinatura_apos_dias} dias de atraso`)); assert.match(atraso, /Cancelar nunca é automático/)
assert.ok(faq('Emite nota fiscal\\?').includes(`${cfg.nota_fiscal.prazo_dias_uteis} dias úteis`))
faq('O que o sistema executa e o que só recomenda\\?'); faq('O que acontece com os meus dados\\?')

// 4) etapa 4 "em configuração": nada é enviado, nada externo
assert.doesNotMatch(L, /fetch\(|XMLHttpRequest|sendBeacon|\.submit\(\)/)
for (const f of L.matchAll(/<form\b[^>]*>/g)) assert.doesNotMatch(f[0], /\b(action|method)=/i, 'form com action/method')
const etapa4 = L.slice(L.indexOf('data-step="3"'), L.indexOf('</form>'))
// 09/10: a etapa 4 abre o plano criado no painel do Mercado Pago (links iguais aos de config/sprint90.json); único href permitido ali
assert.doesNotMatch(etapa4, /<form/i)
const hrefs4 = [...etapa4.matchAll(/href="([^"]+)"/g)].map(m => m[1])
assert.deepEqual(hrefs4, [cfg.planos.crescimento.mp_link], 'etapa 4 só linka o plano do Mercado Pago')
assert.match(etapa4, new RegExp(`data-fixo="${cfg.planos.fixo.mp_link.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}"`))
assert.match(etapa4, /em até 1 dia útil/)
assert.match(L, /id="j-aceite"/); assert.match(L, /id="j-consentimento"/)
for (const s of L.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/g)) assert.fail(`script externo ${s[1]}`)
for (const s of L.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) assert.match(s[1], /^https:\/\/fonts\.googleapis\.com\//)

// 5) termos s90-v1
assert.equal(cfg.termos_versao, 's90-v1')
assert.ok(T.startsWith('# RASCUNHO para revisão jurídica — não publicar sem revisão'))
for (const t of ['s90-v1', 'D+30', `${cfg.inadimplencia.pausar_assinatura_apos_dias} dias de atraso`, `${cfg.nota_fiscal.prazo_dias_uteis} dias úteis`, `${cfg.arrependimento_dias} dias`, `R$ ${reais(fixo)},00`, `R$ ${reais(cresc)},00`, `${pct}%`, '[A DEFINIR'])
  assert.ok(T.includes(t), `termos sem "${t}"`)
assert.match(T, /nota fiscal/i); assert.match(T, /arrependimento/i); assert.match(T, /Encarregado/)

// 6) metodologia: humano decide; no Sprint 90 é o cliente
assert.ok(M.includes('Quem decide é humano.') && M.includes('no Place Sprint 90 (autoatendimento) o próprio cliente decide e aprova no painel'))
assert.ok(!M.includes('O consultor não é substituído'))
console.log('teste-s90-landing: OK')
