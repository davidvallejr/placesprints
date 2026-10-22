// Carrega .env sem dependências. Nunca loga valores.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

export const env = {
  NOTION_TOKEN: process.env.NOTION_TOKEN || '',
  NOTION_VERSION: process.env.NOTION_VERSION || '2025-09-03',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
  AI_PRECO_ENTRADA: process.env.AI_PRECO_ENTRADA || '',   // preço por 1M tokens (opcional): sem os dois, custo_estimado = null
  AI_PRECO_SAIDA: process.env.AI_PRECO_SAIDA || '',
  PORT: Number(process.env.PORT || 3012),
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',

  // ── Integração Mercado Livre (OAuth) ──────────────────────────────────
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  MELI_CLIENT_ID: process.env.MELI_CLIENT_ID || '',
  MELI_CLIENT_SECRET: process.env.MELI_CLIENT_SECRET || '',
  MELI_TOKEN_KEY: process.env.MELI_TOKEN_KEY || '',
  MELI_LINK_SECRET: process.env.MELI_LINK_SECRET || '',
  // app SEPARADO, só leitura, para prospects do comercial (opcional). Sem os dois, o prospect usa o app principal (que tem escopos de escrita).
  MELI_CLIENT_ID_COMERCIAL: process.env.MELI_CLIENT_ID_COMERCIAL || '',
  MELI_CLIENT_SECRET_COMERCIAL: process.env.MELI_CLIENT_SECRET_COMERCIAL || '',

  // ── Diagnóstico comercial público (ex.: diagnosticomeli.place2u.com.br) ──
  // vazio = a página pública NÃO existe para o túnel (só localhost a vê). Só o host exato passa na guarda.
  COMERCIAL_PUBLIC_HOST: (process.env.COMERCIAL_PUBLIC_HOST || '').trim().toLowerCase(),
  COMERCIAL_WHATSAPP: (process.env.COMERCIAL_WHATSAPP || '').replace(/\D+/g, ''),      // CTA "falar com especialista" (opcional)
  COMERCIAL_CONTATO_LGPD: (process.env.COMERCIAL_CONTATO_LGPD || '').trim(),           // canal do titular p/ exclusão de dados (LGPD art. 18)

  // ── Custos por SKU (Bling / Tiny / Planilha) ──────────────────────────
  ERP_TOKEN_KEY: process.env.ERP_TOKEN_KEY || '',   // cifra tokens de ERP e segredos do webhook; sem ela, falha fechado

  // ── Place Sprint 90 (autoatendimento; docs/contrato-sprint90-f1.md) ──
  // vazio = NADA do Sprint 90 existe (nem /c/* no localhost, nem /api/sprint90/*); o host comercial e o do ML seguem iguais. Só o host exato passa na guarda.
  SPRINT90_PUBLIC_HOST: (process.env.SPRINT90_PUBLIC_HOST || '').trim().toLowerCase(),
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN || '',        // Mercado Pago (F3); sem ele a assinatura responde pendente
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET || '',    // HMAC do webhook do MP (F3); sem ele o webhook falha fechado
  MP_MODO: process.env.MP_MODO === 'producao' ? 'producao' : 'teste',
  EMAIL_PROVEDOR: process.env.EMAIL_PROVEDOR || '',          // sem provedor integrado: src/lib/email.js devolve sempre "pendente"
  EMAIL_REMETENTE: process.env.EMAIL_REMETENTE || '',

  // ── Gatilhos ao cliente via n8n (docs/desenho-gatilhos-n8n.md; opcionais) ──
  // sem os dois, todo lote com canal WhatsApp/e-mail/Discord fica 'pendente' com motivo n8n_nao_configurado (o Notion não passa pelo n8n)
  PLACE_GATILHOS_URL: (process.env.PLACE_GATILHOS_URL || '').replace(/\/$/, ''),
  PLACE_GATILHOS_SECRET: process.env.PLACE_GATILHOS_SECRET || '',

  // ── Autogestão (lidas pelos scripts externos; aqui só para a tela de Estruturas dizer presente/ausente — nunca o valor) ──
  HEAD_CANAIS_WHATSAPP: process.env.HEAD_CANAIS_WHATSAPP || '',   // WhatsApp do Head de canais (só incidente crítico, atrás de autogestao.whatsapp_critico_ligado)
  BACKUP_DIR: process.env.BACKUP_DIR || '',                       // scripts/backup-banco.mjs
  FRIO_DIR: process.env.FRIO_DIR || '',                           // scripts/arquivar-evidencias.mjs
  VIGIA_ENVIO_LIGADO: process.env.VIGIA_ENVIO_LIGADO === '1' ? '1' : '',   // scripts/vigia.sh sai do dry-run só com 1
}
