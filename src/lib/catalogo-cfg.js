// Textos e listas do anúncio de catálogo (config/algoritmo.json → catalogo): constante ÚNICA, lida por quem não pode importar o diagnóstico (ofertas-*, catalogo-db).
// Só fs: nenhum banco é aberto aqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const CATALOGO = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')).catalogo
export const TEXTO_CATALOGO = { terceiros: CATALOGO.texto_terceiros, proprio: CATALOGO.texto_proprio }
// regra do plano que NÃO nasce neste catálogo ('terceiros' | 'proprio'); 'nao' nunca bloqueia
export const regraBloqueada = (regra, origem) => origem === 'terceiros' ? CATALOGO.regras.bloqueadas_terceiros.includes(regra) : origem === 'proprio' ? CATALOGO.regras.bloqueadas_proprio.includes(regra) : false
// o escopo do job de Ofertas mexe em conteúdo que o catálogo controla?
export const escopoDeConteudo = escopo => CATALOGO.escopos_ofertas_conteudo.includes(escopo)
