// Nota fiscal (V3 F8, src/lib/nota-fiscal-real.js) na aba /cliente › Empresa (F6; dados fiscais, termo, contador e senha num formulário no dialog.dlg):
//   window.PSNota.montarCliente({ config, notas }, cliente) → #secNotaFiscal (regime, termo, certificado, regras por SKU com CSV do contador) e #secNotas (lista ≤ 6 colunas)
// O servidor decide tudo; aqui só mostra e pede. Tudo que vem do servidor passa por esc(). Sem primário na tela: o único primário mora DENTRO do diálogo
// (PSRelatorio.ui, mesmo padrão de dossie.js); sem cor nova, sem emoji. Gravações: prévia → confirmar:true. Comprador sempre mascarado (vem assim do servidor).
(() => {
  if (window.PSNota) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const brl = c => c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const pedirPor = (titulo, texto) => ui() ? ui().pedirPor({ titulo, texto, rotuloOk: titulo }) : Promise.resolve(null)
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const ESTADO = { rascunho: 'Rascunho', aprovada: 'Aprovada', enviada: 'Enviada', autorizada: 'Autorizada', rejeitada: 'Rejeitada', cancelada: 'Cancelada', anexada: 'Anexada ao ML', erro: 'Erro' }
  const SELO = { rascunho: 'neutro', aprovada: 'azul', enviada: 'azul', autorizada: 'bom', anexada: 'bom', rejeitada: 'ruim', erro: 'ruim', cancelada: 'neutro' }
  const CERT = { ausente: 'não cadastrado', referenciado_sem_validade: 'referenciado, sem validade conferida', vencido: 'vencido', vence_em_30_dias: 'vence em até 30 dias', valido: 'válido' }
  // fluxo padrão: nome → prévia (servidor) → confirmar:true
  async function gravar(url, corpo, { titulo, texto, ok }, porDado = null) {
    const por = porDado || await pedirPor(titulo, texto); if (!por) return null
    const pv = await api(url, { ...corpo, por })
    if (pv.pendente) { toast(`Pendente: ${pv.pendente}`, 'erro'); return null }
    if (pv.previa && pv.gravavel === false) { toast(`CSV com ${pv.erros.length} erro(s): ${pv.erros.slice(0, 3).map(e => `linha ${e.linha} (${e.campo})`).join(', ')}`, 'erro'); return null }
    const r = await api(url, { ...corpo, por, confirmar: true })
    if (r.pendente) { toast(`Pendente: ${r.pendente}`, 'erro'); return null }
    toast(ok(r)); return r
  }

  // formulário no dialog.dlg (PSRelatorio.ui.dialogo): campos + «Seu nome»; devolve { valores, por } ou null — nenhuma caixa nativa do navegador.
  // campos: [chave, rótulo, { valor, tipo, opcoes:[[v, rótulo]], obrigatorio }]
  function formulario({ titulo, texto, campos, rotuloOk }) {
    const u = ui(); if (!u) { toast('Diálogo indisponível: recarregue a página.', 'erro'); return Promise.resolve(null) }
    return new Promise(resolver => {
      const { d, corpo, rodape, fechar } = u.dialogo(titulo)
      corpo.innerHTML = `${texto ? `<p>${esc(texto)}</p>` : ''}<div class="form-grade">${campos.map(([k, rot, o = {}]) => `<div class="campo"><label for="nfc_${esc(k)}">${esc(rot)}</label>${o.opcoes
        ? `<select id="nfc_${esc(k)}">${o.opcoes.map(([v, r]) => `<option value="${esc(v)}"${String(o.valor ?? '') === v ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>`
        : `<input id="nfc_${esc(k)}" type="${o.tipo || 'text'}" value="${esc(o.valor ?? '')}" maxlength="200" autocomplete="${o.tipo === 'password' ? 'off' : 'on'}">`}</div>`).join('')}</div>${u.campoPor('nfPor')}<div class="aviso erro" id="nfErro" hidden></div>`
      let ok = null
      rodape.append(u.botao('Cancelar', { aoClicar: fechar }), u.botao(rotuloOk || titulo, { primario: true, aoClicar: () => {
        const valores = Object.fromEntries(campos.map(([k]) => [k, corpo.querySelector('#nfc_' + k).value.trim()])), por = u.lerPor(corpo, 'nfPor'), err = corpo.querySelector('#nfErro')
        const falta = campos.filter(([k, , o = {}]) => o.obrigatorio && !valores[k]).map(([, r]) => r)
        if (!por) falta.push('seu nome')
        if (falta.length) { err.textContent = 'Preencha: ' + falta.join(', ') + '.'; err.hidden = false; return }
        u.gravarNome(por); ok = { valores, por }; fechar()
      } }))
      d.addEventListener('close', () => resolver(ok), { once: true })
    })
  }

  async function montarConfig(alvo, cliente, aoMudar) {
    if (!alvo) return
    let s
    try { s = await api('/api/cliente/nf?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarConfig(alvo, cliente, aoMudar)); return }
    const c = s.config, t = s.termo.aceito
    alvo.innerHTML = `
      <p class="veredito-frase" id="nfVeredito">${s.chaves.ligado ? 'Emissão ligada' : 'Emissão desligada (chave nf.ligado)'} · ${c ? `${esc(c.regime === 'simples' ? 'Simples Nacional (CSOSN)' : c.regime === 'normal' ? 'Regime normal (CST)' : 'MEI')} · ${esc(c.uf)} · ${esc(c.ambiente === 'producao' ? 'produção' : 'homologação')}` : 'dados fiscais não cadastrados'}</p>
      <div class="tabela-wrap"><table class="t" id="nfResumo"><tbody>
        <tr><th scope="row">Dados fiscais</th><td>${c ? `${esc(c.razao_social)} · IE ${esc(c.ie || '—')} · declarado por ${esc(c.contador || '—')}` : '<span class="mudo">cadastre regime, UF, IE e CNPJ informados pelo contador</span>'}</td></tr>
        <tr><th scope="row">Termo fiscal (${esc(s.termo.versao)})</th><td>${t ? `aceito por ${esc(t.aceito_por)} em ${esc(brData(t.aceito_em))}` : '<span class="mudo">não aceito — sem termo, nenhuma nota sai</span>'}</td></tr>
        <tr><th scope="row">Certificado A1</th><td>${esc(CERT[s.certificado] || s.certificado)}${c?.cert_valido_ate ? ` · até ${esc(brData(c.cert_valido_ate))}` : ''} <span class="mini">fica no provedor fiscal, nunca no banco</span></td></tr>
        <tr><th scope="row">Regras por SKU</th><td>${esc(String(s.total_regras))} declarada(s)${s.sinais.filter(x => x.regra === 'nf_regra_faltando').length ? ` · <b>${esc(String(s.sinais.filter(x => x.regra === 'nf_regra_faltando').length))} SKU(s) vendidos sem regra</b>` : ''}</td></tr>
        <tr><th scope="row">Emissão automática</th><td>${c?.politica === 'automatica' ? 'ligada' : `com aprovação · ${esc(String(s.automatica.limpas))} de 20 notas seguidas sem correção`}</td></tr>
      </tbody></table></div>
      <div class="linha mt-2">
        <button class="btn" type="button" id="btnNfDados">Dados fiscais</button>
        <button class="btn" type="button" id="btnNfTermo">Registrar termo</button>
        <label class="btn" for="nfCsv">Importar regras (CSV do contador)</label><input class="sr" type="file" id="nfCsv" accept=".csv,text/csv">
        <button class="btn" type="button" id="btnNfCert">Enviar certificado</button>
      </div>
      <p class="mini">O sistema não decide imposto: NCM, CFOP, CST/CSOSN, alíquotas e ST vêm do contador do cliente, por SKU. Produto sem regra não tem nota. CSV (separador ; ou ,): obrigatórias sku, operacao (venda_dentro_uf | venda_fora_uf), ncm, origem, cfop, cst_csosn, st (0 ou 1), pis_cst, cofins_cst, vigente_de (AAAA-MM-DD); conforme a situação, icms_aliquota, icms_reducao_bc, pis_aliquota, cofins_aliquota, pis_cofins_exclui_icms (0 ou 1); opcionais cest, unidade, descricao.</p>`
    const recarregar = () => { montarConfig(alvo, cliente, aoMudar); aoMudar?.() }
    const tenta = fn => async () => { try { if (await fn()) recarregar() } catch (e) { toast(e.message, 'erro') } }
    alvo.querySelector('#btnNfDados').onclick = tenta(async () => {
      const v = k => ({ valor: c?.[k] ?? '' })
      const f = await formulario({ titulo: 'Dados fiscais', rotuloOk: 'Gravar dados fiscais', texto: 'Regime, UF, IE e CNPJ como o contador do cliente declarou (campo vazio mantém o que está gravado). Mudança remonta as notas em rascunho.', campos: [
        ['cnpj', 'CNPJ', v('cnpj')], ['razao_social', 'Razão social', v('razao_social')], ['ie', 'Inscrição estadual', v('ie')], ['uf', 'UF', v('uf')],
        ['regime', 'Regime', { valor: c?.regime ?? '', opcoes: [['', 'manter'], ['simples', 'Simples Nacional (CSOSN)'], ['normal', 'Regime normal (CST)'], ['mei', 'MEI']] }],
        ['modalidade_frete', 'Modalidade do frete', v('modalidade_frete')], ['vendedor_apelido', 'Apelido do vendedor no ML', v('vendedor_apelido')], ['cert_ref', 'Referência do certificado no provedor', v('cert_ref')], ['contador', 'Contador (nome/CRC)', v('contador')]] })
      if (!f) return null
      const dados = Object.fromEntries(Object.entries(f.valores).filter(([, x]) => x))
      return gravar('/api/cliente/nf/config', { cliente, dados }, { titulo: 'Gravar dados fiscais', texto: '', ok: r => `Dados fiscais gravados (${r.remontadas} nota(s) remontada(s)).` }, f.por)
    })
    alvo.querySelector('#btnNfTermo').onclick = tenta(async () => {
      const f = await formulario({ titulo: 'Registrar termo fiscal', texto: 'O cliente aceitou que as regras fiscais são declaradas pelo contador dele e a Place2u só executa a emissão.', campos: [['rep', 'Representante do cliente que aceitou', { obrigatorio: true }], ['dia', 'Data do aceite', { tipo: 'date', valor: new Date().toISOString().slice(0, 10), obrigatorio: true }]] })
      if (!f) return null
      return gravar('/api/cliente/nf/termo', { cliente, aceito_por: f.valores.rep, aceito_em: f.valores.dia }, { titulo: 'Registrar termo fiscal', texto: '', ok: () => 'Termo registrado.' }, f.por)
    })
    alvo.querySelector('#nfCsv').onchange = async ev => {
      const arq = ev.target.files?.[0]; ev.target.value = ''; if (!arq) return
      if (arq.size > 2 * 1024 * 1024) { toast('CSV passa de 2 MB', 'erro'); return }
      const f = await formulario({ titulo: 'Importar regras fiscais', texto: 'Primeiro conferimos o arquivo linha a linha; com erro, nada é gravado.', campos: [['contador', 'Contador que declarou estas regras (nome/CRC)', { valor: c?.contador ?? '', obrigatorio: true }]] }); if (!f) return
      tenta(async () => gravar('/api/cliente/nf/regras', { cliente, csv: await arq.text(), contador: f.valores.contador }, { titulo: 'Importar regras fiscais', texto: '', ok: r => `${r.gravadas} regra(s) gravada(s); ${r.remontadas} nota(s) remontada(s).` }, f.por))()
    }
    alvo.querySelector('#btnNfCert').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pfx,.p12'
      inp.onchange = tenta(async () => {
        const arq = inp.files?.[0]; if (!arq) return null
        if (arq.size > 5 * 1024 * 1024) { toast('arquivo passa de 5 MB', 'erro'); return null }
        const f = await formulario({ titulo: 'Enviar certificado A1', texto: 'O certificado vai cifrado ao provedor fiscal (Focus NFe). Nada é gravado no banco do Place Sprints; a senha vai só nesta requisição.', campos: [['senha', 'Senha do certificado', { tipo: 'password', obrigatorio: true }]] }); if (!f) return null
        const senha = f.valores.senha
        const base64 = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => falha(new Error('não foi possível ler o arquivo')); r.readAsDataURL(arq) })
        return gravar('/api/cliente/nf/certificado', { cliente, base64, senha }, { titulo: 'Enviar certificado A1', texto: '', ok: r => `Certificado válido até ${brData(r.cert_valido_ate)}.` }, f.por)
      })
      inp.click()
    }
  }

  async function montarNotas(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/nf/notas?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarNotas(alvo, cliente)); return }
    const notas = r.notas || []
    const linha = x => `<tr>
      <td>${x.estado === 'rascunho' && !x.bloqueios.length ? `<input type="checkbox" data-nf-sel="${esc(x.ref)}" aria-label="Selecionar pedido ${esc(x.pedidos.join(', '))}"> ` : ''}${esc(x.pedidos.join(', '))}${x.pack_id ? '<div class="mini">pacote</div>' : ''}</td>
      <td>${esc(x.comprador)}</td>
      <td>${esc(brl(x.total_c))}</td>
      <td><span class="selo ${SELO[x.estado] || 'neutro'}">${esc(ESTADO[x.estado] || x.estado)}</span>${x.bloqueios.length ? `<details class="mini"><summary>${esc(String(x.bloqueios.length))} bloqueio(s)</summary><ul>${x.bloqueios.map(b => `<li>${esc(b.texto)}${b.sku ? ` (${esc(b.sku)})` : ''}</li>`).join('')}</ul></details>` : ''}${x.status_sefaz && x.estado === 'rejeitada' ? `<div class="mini">SEFAZ ${esc(x.status_sefaz)}</div>` : ''}</td>
      <td>${esc(brData(x.autorizada_em))}${x.numero ? `<div class="mini">nº ${esc(x.numero)}</div>` : ''}</td>
      <td>${x.anexada_em ? esc(brData(x.anexada_em)) : '<span class="mudo">—</span>'}</td></tr>`
    alvo.innerHTML = `
      <div class="linha"><button class="btn" type="button" id="btnNfRascunhos">Buscar pedidos pagos</button><button class="btn" type="button" id="btnNfAprovar">Aprovar selecionadas</button><button class="btn" type="button" id="btnNfEmitir">Emitir aprovadas</button></div>
      <div class="tabela-wrap mt-2"><table class="t empilha" id="nfTabela"><caption class="sr">Notas fiscais de ${esc(cliente)}</caption><thead><tr><th scope="col">Pedido</th><th scope="col">Comprador</th><th scope="col">Total</th><th scope="col">Estado</th><th scope="col">Emitida em</th><th scope="col">Anexo ML</th></tr></thead><tbody>${notas.length
        ? notas.map(linha).join('') : '<tr><td colspan="6" class="vazio"><b>Nenhuma nota ainda.</b> «Buscar pedidos pagos» cria os rascunhos a partir das vendas coletadas.</td></tr>'}</tbody></table></div>`
    const recarregar = () => montarNotas(alvo, cliente)
    const tenta = fn => async () => { try { if (await fn()) recarregar() } catch (e) { toast(e.message, 'erro') } }
    alvo.querySelector('#btnNfRascunhos').onclick = tenta(async () => {
      const pv = await api('/api/cliente/nf/rascunhos', { cliente })
      if (!pv.pedidos) { toast('Nenhum pedido pago sem nota.'); return null }
      return gravar('/api/cliente/nf/rascunhos', { cliente }, { titulo: 'Criar rascunhos', texto: `${pv.pedidos} pedido(s)/pacote(s) pago(s) sem nota. Cada um vira rascunho com os bloqueios que faltarem resolver.`, ok: r => r.ok ? `${r.criadas} rascunho(s), ${r.bloqueadas} com bloqueio.` : `Pendente: ${r.pendente}` })
    })
    alvo.querySelector('#btnNfAprovar').onclick = tenta(async () => {
      const refs = [...alvo.querySelectorAll('[data-nf-sel]:checked')].map(i => i.dataset.nfSel)
      if (!refs.length) { toast('Selecione as notas em rascunho sem bloqueio.'); return null }
      return gravar('/api/cliente/nf/aprovar', { cliente, refs }, { titulo: 'Aprovar notas', texto: `${refs.length} nota(s): a aprovação vale para ESTE conteúdo; qualquer mudança volta a nota para rascunho.`, ok: r => `${r.aprovadas} nota(s) aprovada(s).` })
    })
    alvo.querySelector('#btnNfEmitir').onclick = tenta(async () => gravar('/api/cliente/nf/emitir', { cliente }, { titulo: 'Emitir notas aprovadas', texto: 'Envia as notas aprovadas ao provedor fiscal no ambiente do cliente (homologação por padrão).', ok: r => `${(r.resultados || []).length} nota(s) enviada(s).` }))
  }

  const montarCliente = ({ config, notas }, cliente) => { montarConfig(config, cliente, () => montarNotas(notas, cliente)); montarNotas(notas, cliente) }
  window.PSNota = { montarCliente }
})()
