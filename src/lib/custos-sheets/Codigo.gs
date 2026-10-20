// Place Sprints — envia os custos por SKU/MLB desta planilha para o painel por webhook assinado (HMAC-SHA256).
// Aba "Custos": A = SKU (formate como "Texto simples", senão zeros à esquerda se perdem), B = MLB (opcional), C = Custo (número),
// D = Status (escrito pelo script). Linha 1 = cabeçalho SKU | MLB | Custo | Status: aba "Custos" com outro cabeçalho NUNCA é lida nem
// escrita (motivo no Sync_Log; o menu "Criar aba-modelo" cria "Custos (Place Sprints)"). Cada linha precisa de SKU ou MLB; custo vazio,
// texto, erro de fórmula (#N/A, #REF!…) no SKU, MLB ou custo, data, verdadeiro/falso, 0 ou negativo NUNCA é enviado ("REJEITADO" na coluna D).
// Instalação (uma vez): 1) Extensões > Apps Script, cole este código e salve; 2) escolha a função "instalar", clique em Executar e
// autorize; 3) APAGUE a função "instalar" e salve (o segredo fica só nas Propriedades do script); 4) recarregue a planilha: menu "Custos".
// Atenção: qualquer editor desta planilha consegue ler o segredo — mantenha poucos editores. Copiou a planilha? Gere um webhook novo.
// Rotina: a cada 10 min envia SÓ se algo mudou; 1x por dia reenvia tudo mesmo sem mudança (batimento, para o painel não marcar o
// custo como velho); "Sincronizar agora" envia na hora. Sem onEdit de propósito (o simples não chama UrlFetch; o instalável faria
// uma chamada por edição).
const CFG = { ABA: 'Custos', ABA_MODELO: 'Custos (Place Sprints)', LOG: 'Sync_Log', LOTE: 500, LOTE_BYTES: 200 * 1024, TENTATIVAS: 4, BATIMENTO_MS: 20 * 3600 * 1000 }; // o servidor recusa corpo > 256 KB
const CAB = ['SKU', 'MLB', 'Custo', 'Status'];
const URL_OK = /^https:\/\/[^\s"'`\\]+$/, SEGREDO_OK = /^[0-9a-f]{64}$/; // as mesmas regras do gerador no painel
const ERRO_FORMULA = /^(#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!|SPILL!|CALC!)|Loading\.\.\.)$/i; // getValues devolve o erro como texto

function instalar() { // preenchida pelo painel: rode UMA vez, autorize e depois APAGUE esta função
  salvarConfig_('__WEBHOOK_URL__', '__WEBHOOK_SECRET__');
}

function onOpen() { // gatilho simples: só cria o menu
  SpreadsheetApp.getUi().createMenu('Custos').addItem('Sincronizar agora', 'sincronizarAgora').addItem('Configurar', 'configurar')
    .addItem('Criar aba-modelo', 'criarAbaModelo').addToUi();
}
function sincronizarAgora() { sincronizar_(true); }   // botão do menu: envia mesmo sem mudança
function sincronizarAuto() { sincronizar_(false); }   // gatilho por tempo de 10 min (criado por instalar/Configurar)
function criarAbaModelo() { const ss = SpreadsheetApp.getActive(); ss.toast(criarAbaModelo_(ss), 'Custos'); }

function configurar() { // menu: cola URL e segredo de um webhook novo ou rotacionado sem colar o código de novo
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Custos — URL do webhook', 'Cole a URL mostrada no painel (Integrações > Custos > Planilha):', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const s = ui.prompt('Custos — segredo', 'Cole o segredo (64 caracteres, mostrado uma única vez no painel):', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;
  try { salvarConfig_(u.getResponseText().trim(), s.getResponseText().trim()); } catch (e) { ui.alert('Custos', e.message, ui.ButtonSet.OK); }
}

function salvarConfig_(url, segredo) {
  if (!URL_OK.test(url) || !SEGREDO_OK.test(segredo)) throw new Error('URL ou segredo inválido: gere o script de novo no painel (Integrações > Custos > Planilha).');
  PropertiesService.getScriptProperties().setProperties({ WEBHOOK_URL: url, WEBHOOK_SECRET: segredo });
  PropertiesService.getDocumentProperties().deleteProperty('HASH'); // a próxima rodada reenvia tudo com a configuração nova
  const ss = SpreadsheetApp.getActive(), aba = criarAbaModelo_(ss); // não lança: problema de aba vai para o aviso e o Sync_Log
  abaLog_(ss);
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'sincronizarAuto') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizarAuto').timeBased().everyMinutes(10).create();
  ss.toast('Configurado: envio a cada 10 min (se mudou) e batimento diário. ' + aba, 'Custos');
}

function abaCustos_(ss) { // { sh } com o cabeçalho certo; aba do cliente com outro cabeçalho NUNCA é lida nem escrita → { erro }
  let achou = '';
  for (const nome of [CFG.ABA, CFG.ABA_MODELO]) {
    const sh = ss.getSheetByName(nome);
    if (!sh) continue;
    const cab = sh.getRange(1, 1, 1, 4).getValues()[0].map((x) => String(x).trim());
    if (cab.every((x, i) => x.toLowerCase() === CAB[i].toLowerCase())) return { sh: sh };
    achou = achou || 'a aba "' + nome + '" tem na linha 1 "' + cab.map((x) => x.slice(0, 30)).join(' | ') + '" (esperado: ' + CAB.join(' | ') + ')';
  }
  return { erro: (achou || 'não há aba "' + CFG.ABA + '"') + '; nada foi enviado e nenhuma coluna foi alterada. Use o menu Custos > Criar aba-modelo.' };
}
function criarAbaModelo_(ss) { // cria (ou preenche, se totalmente vazia) a aba-modelo; nunca mexe numa aba do cliente com conteúdo
  if (abaCustos_(ss).sh) return 'A aba de custos já está pronta.';
  const livre = (nome) => { const s = ss.getSheetByName(nome); return !s || s.getLastRow() === 0; };
  const nome = [CFG.ABA, CFG.ABA_MODELO].filter(livre)[0];
  if (!nome) return 'As abas "' + CFG.ABA + '" e "' + CFG.ABA_MODELO + '" já existem com outro cabeçalho: renomeie uma delas e use Custos > Criar aba-modelo.';
  const sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  sh.getRange('A:A').setNumberFormat('@'); // SKU como texto simples
  sh.getRange(1, 1, 1, 4).setValues([CAB.slice()]);
  return 'Aba "' + nome + '" pronta: A = SKU, B = MLB, C = Custo, D = Status (o script escreve).';
}

function abaLog_(ss) {
  let l = ss.getSheetByName(CFG.LOG);
  if (!l) {
    l = ss.insertSheet(CFG.LOG);
    l.getRange(1, 1, 1, 12).setValues([['Quando', 'Envio', 'Lote', 'Itens', 'HTTP', 'Aceitas', 'Novas', 'Alteradas', 'Inalteradas', 'Em análise', 'Rejeitadas', 'Detalhe']]);
  }
  return l;
}
function escreverLog_(ss, linhas) { // Envio, Lote e Detalhe como texto literal: setValues leria "1/3" como data
  const l = abaLog_(ss), r = l.getLastRow() + 1;
  l.getRange(r, 2, linhas.length, 2).setNumberFormat('@');
  l.getRange(r, 12, linhas.length, 1).setNumberFormat('@');
  l.getRange(r, 1, linhas.length, 12).setValues(linhas);
}
function naoEnviado_(ss, doc, forcar, motivo) { // envio barrado antes de ler as linhas: Sync_Log 1x por motivo no gatilho (sempre no botão)
  if (forcar || doc.getProperty('AVISO') !== motivo) {
    escreverLog_(ss, [[new Date(), '', '', 0, '', 0, 0, 0, 0, 0, 0, 'NÃO ENVIADO: ' + motivo]]);
    doc.setProperty('AVISO', motivo);
  }
  if (forcar) ss.toast(motivo, 'Custos');
}

const hex_ = (bytes) => bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); // bytes do Apps Script vêm com sinal (-128..127)
const jsonAscii_ = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)); // bytes = caracteres
// = limparSku/chaveSku do servidor (custos-db.js; teste de contrato em teste-custos-apps-script.mjs): NFC, NBSP vira espaço, sem zero-width, trim, caixa
const normSku_ = (v) => String(v).normalize('NFC').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '').trim();
const normMlb_ = (v) => String(v).trim().toUpperCase();
// ponytail: linha só com MLB tem chave "mlb:" — o SKU dela só o servidor conhece (anúncio); repetição entre lotes nesse caso é do servidor
const chave_ = (sku, mlb) => (sku ? sku.toLowerCase() : 'mlb:' + mlb);
const vazia_ = (r) => r.every((x) => x === '');

function validarLinha_(r, linha, cont) { // r = [sku, mlb, custo] de getValues(): number | string | Date | boolean ('' se vazio; erros vêm como texto)
  const a = r[0], c = r[2], formula = [a, r[1], c].filter((x) => ERRO_FORMULA.test(String(x).trim()))[0];
  if (formula !== undefined) return { erro: 'erro de fórmula na planilha (' + String(formula).trim() + '): corrija a fórmula da linha' };
  if (Object.prototype.toString.call(a) === '[object Date]' || typeof a === 'boolean' || (typeof a === 'number' && Math.abs(a) >= 1e15)) {
    return { erro: 'SKU inválido (formate a coluna A como Texto simples)' };
  }
  const sku = normSku_(a), mlb = normMlb_(r[1]);
  if (!sku && !mlb) return { erro: 'linha sem SKU e sem MLB' };
  if (sku.length > 80) return { erro: 'SKU com mais de 80 caracteres' };
  if (mlb && !/^MLB\d{1,14}$/.test(mlb)) return { erro: 'MLB inválido (use MLB seguido só de números)' };
  if (cont[chave_(sku, mlb)] > 1) return { erro: sku ? 'SKU repetido na planilha' : 'MLB repetido na planilha' };
  if (typeof c !== 'number') return { erro: c === '' ? 'custo vazio' : 'custo não numérico: ' + String(c).slice(0, 40) };
  if (!isFinite(c) || Math.round(c * 10000) <= 0) return { erro: 'custo deve ser > 0' };
  return { item: { sku: sku, mlb: mlb || null, custo: c, line: linha } }; // custo = number bruto de getValues (o servidor arredonda e revalida)
}

function enviarLote_(url, segredo, corpo) { // 429/5xx/rede: repete com espera crescente (mesmo corpo, carimbo novo); 2xx e outros 4xx: não repete
  const payload = jsonAscii_(corpo);
  let ult = { code: 0, texto: '' };
  for (let t = 0; t < CFG.TENTATIVAS; t++) {
    if (t) Utilities.sleep(1000 * Math.pow(2, t - 1) + Math.floor(Math.random() * 500));
    const ts = String(Math.floor(Date.now() / 1000));
    const assinatura = hex_(Utilities.computeHmacSha256Signature(ts + '.' + payload, segredo)); // chave = o segredo como texto (não é decodificado de hex)
    try {
      const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true, followRedirects: false,
        headers: { 'X-Timestamp': ts, 'X-Signature': 'sha256=' + assinatura, 'X-Batch-Id': corpo.batch_id } });
      ult = { code: res.getResponseCode(), texto: String(res.getContentText() || '') };
      if (ult.code !== 429 && ult.code < 500) return ult;
    } catch (e) { ult = { code: 0, texto: String((e && e.message) || e).slice(0, 200) }; }
  }
  return ult;
}

function sincronizar_(forcar) {
  const ss = SpreadsheetApp.getActive(), sp = PropertiesService.getScriptProperties(), doc = PropertiesService.getDocumentProperties();
  const url = sp.getProperty('WEBHOOK_URL'), segredo = sp.getProperty('WEBHOOK_SECRET');
  const avisar = (m) => { if (forcar) ss.toast(m, 'Custos'); }; // gatilho por tempo não tem tela: o painel acusa "custo velho"
  if (!url || !segredo) return avisar('Falta configurar: menu Custos > Configurar (ou rode instalar).');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return avisar('Outra sincronização em andamento.');
  try {
    const aba = abaCustos_(ss);
    if (aba.erro) return naoEnviado_(ss, doc, forcar, aba.erro); // cabeçalho errado: não lê, não envia, não escreve na aba do cliente
    const sh = aba.sh, n = sh.getLastRow() - 1;
    if (n < 1) return avisar('A aba Custos está vazia.');
    const linhas = sh.getRange(2, 1, n, 3).getValues(), cont = {};
    linhas.forEach((r) => { if (!vazia_(r)) { const k = chave_(normSku_(r[0]), normMlb_(r[1])); cont[k] = (cont[k] || 0) + 1; } });
    const itens = [];
    const status = linhas.map((r, i) => {
      if (vazia_(r)) return '';
      const v = validarLinha_(r, i + 2, cont);
      if (v.erro) return 'REJEITADO: ' + v.erro;
      itens.push(v.item);
      return 'NÃO ENVIADO: lote anterior falhou'; // sobrescrito pelo resultado do lote
    });
    const locais = status.filter((s) => s.indexOf('REJEITADO') === 0).length;
    // o hash cobre itens E motivos locais: linha nova inválida muda o hash e o status dela aparece já na próxima rodada (não no batimento)
    const hash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, jsonAscii_([itens, status])));
    const batimento = Date.now() - Number(doc.getProperty('LAST_SEND') || 0) > CFG.BATIMENTO_MS;
    if (!forcar && !batimento && doc.getProperty('HASH') === hash) return; // nada mudou e o batimento do dia já foi
    if (!itens.length) {
      sh.getRange(2, 4, n, 1).setValues(status.map((s) => [s]));
      return avisar('Nenhuma linha válida para enviar (' + locais + ' rejeitada(s) na planilha).');
    }
    const agora = new Date(), quando = Utilities.formatDate(agora, ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
    const lotes = [[]]; let bytes = 0; // fecha o lote em 500 itens OU ~200 KB (o que vier antes): batch_total sai conhecido
    itens.forEach((it) => {
      const t = jsonAscii_(it).length + 1, atual = lotes[lotes.length - 1];
      if (atual.length && (atual.length >= CFG.LOTE || bytes + t > CFG.LOTE_BYTES)) { lotes.push([it]); bytes = t; } else { atual.push(it); bytes += t; }
    });
    const syncId = Utilities.getUuid(), total = lotes.length, log = [], soma = { aceitas: 0, quarentena: 0, rejeitadas: 0, recusadas: 0 };
    let tudoOk = true, falha = '';
    for (let b = 0; b < total && tudoOk; b++) {
      const parte = lotes[b], loteId = Utilities.getUuid();
      const r = enviarLote_(url, segredo, { batch_id: loteId, mode: 'full', sync_id: syncId, batch_no: b + 1, batch_total: total, items: parte });
      let j = null;
      try { j = JSON.parse(r.texto); } catch (e) { /* resposta não-JSON */ }
      const linhaLog = [agora, syncId, (b + 1) + '/' + total, parte.length, r.code];
      if (r.code >= 200 && r.code < 300 && j && j.ok === true) {
        const q = j.quarantined || [], x = j.rejected || [], rc = j.refused || [], marca = {}, nr = (k) => Number(j[k]) || 0;
        const motivo = (e) => String(e.reason || '').slice(0, 200);
        q.forEach((e) => { marca[e.line] = 'EM ANÁLISE: ' + motivo(e) + ' (o valor novo ainda não vale; aguarda aprovação no painel)'; });
        rc.forEach((e) => { marca[e.line] = 'RECUSADO no painel — ' + motivo(e); });
        x.forEach((e) => { marca[e.line] = 'REJEITADO (servidor): ' + motivo(e); });
        // "OK" só quando a conta fecha: listas inteiras (o servidor corta em 200) e cada linha do lote contada uma vez; senão (inclusive
        // servidor antigo sem refused_total) a linha fica "ENVIADO … confira no painel", nunca um OK falso
        const completa = nr('quarantined_total') <= q.length && nr('rejected_total') <= x.length && nr('refused_total') <= rc.length
          && nr('accepted') + nr('quarantined_total') + nr('rejected_total') + nr('refused_total') + nr('duplicates_equal') === parte.length;
        parte.forEach((it) => { status[it.line - 2] = marca[it.line] || (completa ? 'OK ' + quando : 'ENVIADO ' + quando + ' (confira no painel)'); });
        soma.aceitas += nr('accepted'); soma.quarentena += nr('quarantined_total'); soma.rejeitadas += nr('rejected_total'); soma.recusadas += nr('refused_total');
        const detalhe = (j.duplicate ? 'reenvio já processado; ' : '') + (nr('refused_total') ? nr('refused_total') + ' recusado(s) no painel; ' : '')
          + x.concat(rc, q).slice(0, 20).map((e) => 'L' + e.line + ' ' + (e.sku || '') + ': ' + motivo(e)).join('; ');
        log.push(linhaLog.concat([nr('accepted'), nr('new'), nr('changed'), nr('unchanged'), nr('quarantined_total'), nr('rejected_total'), detalhe.slice(0, 500)]));
      } else {
        parte.forEach((it) => { status[it.line - 2] = 'ERRO HTTP ' + r.code + ' (nova tentativa na próxima rodada)'; });
        log.push(linhaLog.concat([0, 0, 0, 0, 0, 0, 'erro: ' + r.texto.slice(0, 200)]));
        tudoOk = false; falha = 'HTTP ' + r.code;
      }
    }
    sh.getRange(2, 4, n, 1).setValues(status.map((s) => [s]));
    escreverLog_(ss, log);
    if (tudoOk) { doc.setProperty('HASH', hash); doc.setProperty('LAST_SEND', String(Date.now())); doc.deleteProperty('AVISO'); } // só depois de TODOS os lotes darem certo
    avisar(tudoOk
      ? itens.length + ' enviado(s) em ' + total + ' lote(s): ' + soma.aceitas + ' aceito(s), ' + soma.quarentena + ' em análise, ' + soma.recusadas + ' recusado(s) no painel, '
        + soma.rejeitadas + ' rejeitado(s) pelo servidor, ' + locais + ' rejeitado(s) na planilha.'
      : 'Falhou (' + falha + '). Veja a aba ' + CFG.LOG + '; a próxima rodada tenta de novo.');
  } finally { lock.releaseLock(); }
}
