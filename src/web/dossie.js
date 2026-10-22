// Prestação de contas e Dossiê de defesa (Etapa 2, src/lib/dossie.js) + cliente em risco + contrato/pagamentos (Etapa 1) nas telas.
// window.PSDossie.montarCliente({ dossie, risco, contrato }, cliente) → /cliente › Configurar (#secDossie, #secRisco, #secContrato)
// window.PSDossie.montarPlanos(alvo) → /planos › #secRisco «Clientes em risco» (abertos + sinais sugeridos + chave do dossiê mensal).
// O servidor decide tudo; aqui só mostra e pede. Tudo que vem do servidor passa por esc(). Sem primário na tela: o único primário mora DENTRO do diálogo
// (PSRelatorio.ui, mesmo padrão de alinhamentos.js); sem cor nova, sem emoji. Gravações: prévia → confirmar:true (o que entra no livro não sai mais).
(() => {
  if (window.PSDossie) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const brHora = iso => { const d = new Date(iso); return Number.isNaN(+d) ? brData(iso) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  const brl = c => c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const semUi = () => { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return null }
  const dia = n => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const iniMesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const pedirPor = (titulo, texto) => ui() ? ui().pedirPor({ titulo, texto, rotuloOk: titulo }) : Promise.resolve(semUi())
  const lerArquivo = arq => new Promise((ok, falha) => {
    if (!arq) return ok(null)
    if (arq.size > 5 * 1024 * 1024) return falha(new Error('arquivo passa de 5 MB'))
    const r = new FileReader(); r.onload = () => ok({ base64: String(r.result).replace(/^data:[^,]*,/, '') }); r.onerror = () => falha(new Error('não foi possível ler o arquivo')); r.readAsDataURL(arq)
  })
  const VERSAO = { cliente: 'Prestação de contas', defesa: 'Dossiê de defesa' }
  const selo = d => d.versao === 'cliente' ? '<span class="selo neutro">ao cliente</span>' : d.status === 'completo' ? '<span class="selo bom">completo</span>' : '<span class="selo ruim">incompleto · não enviar</span>'

  // ── #secDossie: período, dois botões secundários, histórico com download ─────────────────────────────────────
  async function montarDossie(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/dossies?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarDossie(alvo, cliente)); return }
    const itens = r.itens || [], ult = itens[0]
    const linha = d => `<tr>
      <td>${esc(brHora(d.gerado_em))}<div class="mini">${esc(d.origem === 'mensal' ? `mensal ${d.competencia}` : d.por)}</div></td>
      <td><b>${esc(VERSAO[d.versao] || d.versao)}</b> ${selo(d)}${d.pendencias?.length ? `<details class="mini"><summary>${esc(String(d.pendencias.length))} prova(s) pendente(s)</summary><ul>${d.pendencias.map(p => `<li>${esc(p.item)}${p.critico ? ' (crítico)' : ''} — ${esc(p.responsavel)}, até ${esc(brData(p.prazo))}</li>`).join('')}</ul></details>` : ''}</td>
      <td>${esc(brData(d.de))} a ${esc(brData(d.ate))}</td>
      <td>${d.pdf ? `<a href="${esc(d.pdf_url)}" download>PDF</a>` : `<span class="mudo" title="${esc(d.pdf_motivo)}">sem PDF</span>`} · <a href="${esc(d.doc_url)}" download title="${d.doc_formato === 'rtf' ? 'Word (.rtf): abre no Word, Google Docs, Pages e TextEdit' : 'Word (.doc HTML): abre no Word e no Google Docs'}">Word</a><div class="mini" title="sha256 do PDF">${esc(String(d.sha256_pdf || d.sha256_doc).slice(0, 12))}</div></td>
      <td>${d.versao === 'cliente' && d.pdf ? (d.notion?.url ? `<a href="${esc(d.notion.url)}" target="_blank" rel="noopener">no Notion</a>` : `<button class="btn-mini" type="button" data-ds-notion="${esc(String(d.id))}">Enviar ao Notion</button>`) : '<span class="mudo">—</span>'}</td></tr>`
    alvo.innerHTML = `
      <p class="veredito-frase" id="dsVeredito">${ult ? `Último: <b>${esc(VERSAO[ult.versao])}</b> de ${esc(brData(ult.de))} a ${esc(brData(ult.ate))}, gerado em ${esc(brHora(ult.gerado_em))}${ult.versao === 'defesa' ? ` — ${ult.status === 'completo' ? 'completo' : `<b>incompleto</b>: ${esc(String(ult.pendencias.filter(p => p.critico).length))} prova(s) crítica(s) pendente(s)`}` : ''}` : 'Nenhum documento gerado para este cliente.'}</p>
      <div class="linha">
        <div class="campo"><label for="dsDe">De</label><input type="date" id="dsDe" value="${esc(iniMesAnterior())}" max="${esc(dia(0))}"></div>
        <div class="campo"><label for="dsAte">Até</label><input type="date" id="dsAte" value="${esc(dia(-1))}" max="${esc(dia(0))}"></div>
        <button class="btn" type="button" id="btnDsCliente">Gerar prestação de contas</button>
        <button class="btn" type="button" id="btnDsDefesa">Gerar dossiê de defesa</button>
      </div>
      <p class="mini">Prestação de contas: ao cliente, no padrão do relatório do Manoel. Dossiê de defesa: confidencial, uso interno/jurídico — nunca sai do sistema (só para o #growth no envio mensal de quem está em risco${r.mensal ? `, hoje ${r.mensal.ligado ? 'ligado' : 'desligado'}` : ''}). PDF e Word ficam guardados aqui e a impressão digital de cada arquivo entra no livro de registro.</p>
      <div id="dsMsg"></div>
      <div class="tabela-wrap mt-2"><table class="t empilha" id="dsTabela"><caption class="sr">Documentos gerados de ${esc(cliente)}</caption><thead><tr><th scope="col">Gerado</th><th scope="col">Documento</th><th scope="col">Período</th><th scope="col">Arquivos</th><th scope="col">Ao cliente</th></tr></thead><tbody>${itens.length
        ? itens.map(linha).join('') : '<tr><td colspan="5" class="vazio"><b>Nada gerado ainda.</b> Escolha o período e gere a prestação de contas ou o dossiê.</td></tr>'}</tbody></table></div>`
    const recarregar = () => montarDossie(alvo, cliente), msg = alvo.querySelector('#dsMsg')
    const gerar = async versao => {
      const de = alvo.querySelector('#dsDe').value, ate = alvo.querySelector('#dsAte').value
      if (!de || !ate || de > ate) { msg.innerHTML = '<div class="aviso erro">Escolha um período válido (de antes de até).</div>'; return }
      const por = await pedirPor(versao === 'defesa' ? 'Gerar dossiê de defesa' : 'Gerar prestação de contas', `Período ${brData(de)} a ${brData(ate)}. Gera PDF e Word com os dados de agora e registra a geração no livro (não envia nada a ninguém).`); if (!por) return
      const bts = alvo.querySelectorAll('#btnDsCliente,#btnDsDefesa'); bts.forEach(b => { b.disabled = true })
      msg.innerHTML = '<div class="aviso info">Gerando o documento… pode levar alguns segundos (medição, livro e PDF).</div>'
      try { const x = await api('/api/cliente/dossie', { cliente, versao, de, ate, por }); toast(`${VERSAO[versao]} gerado${x.dossie.pdf ? '' : ' (só Word: o PDF falhou)'}.`); recarregar() }
      catch (e) { msg.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; bts.forEach(b => { b.disabled = false }) }
    }
    alvo.querySelector('#btnDsCliente').onclick = () => gerar('cliente')
    alvo.querySelector('#btnDsDefesa').onclick = () => gerar('defesa')
    alvo.querySelectorAll('[data-ds-notion]').forEach(b => b.onclick = async () => {
      const id = b.dataset.dsNotion, por = await pedirPor('Enviar ao Notion', 'Cria a página «Relatório de Sprints Place2u · Prestação de contas · …» na base Informações do cliente e anexa o PDF. Antes de escrever, mostramos a prévia.'); if (!por) return
      try {
        const v = await api(`/api/dossie/${id}/notion`, { por })
        if (v.violacoes?.length) { toast(`Não publicável: a auditoria de texto barrou ${v.violacoes.length} trecho(s) (${(v.codigos || []).join(', ')}): ${v.violacoes.slice(0, 3).map(x => `«${x.trecho}»`).join(' ')}`, 'erro'); return }
        if (!await PS.confirmar({ titulo: 'Publicar no Notion do cliente?', texto: `${v.titulo} — o cliente passa a ver esta página e o PDF.`, rotuloOk: 'Publicar' })) return
        const x = await api(`/api/dossie/${id}/notion`, { por, confirmar: true })
        toast(x.ok ? 'Publicado no Notion do cliente.' : `Não publicado: ${x.motivo}.`, x.ok ? 'ok' : 'erro'); recarregar()
      } catch (e) { toast(e.message, 'erro') }
    })
  }

  // ── risco: marcar (diálogo com prévia) e encerrar ─────────────────────────────────────────────────────────
  function marcar(cliente, motivos, { aoConcluir } = {}) {
    const U = ui(); if (!U) return semUi()
    const { corpo, rodape, fechar } = U.dialogo(`Marcar em risco · ${cliente}`)
    corpo.innerHTML = `<p>Marque quando houver reclamação, pedido de reembolso, ameaça jurídica ou insatisfação declarada. A marcação liga o dossiê mensal deste cliente (se a chave geral estiver ligada) e entra no livro de registro — não sai mais.</p>
      <div class="campo"><label for="rkMotivo">Motivo</label><select id="rkMotivo"><option value="">Escolha o motivo</option>${Object.entries(motivos || {}).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></div>
      <div class="campo"><label for="rkDesc">Descrição interna (até 500 caracteres, sem telefone)</label><textarea id="rkDesc" maxlength="500" rows="3"></textarea></div>
      <div class="campo"><label for="rkDesde">Desde</label><input type="date" id="rkDesde" value="${esc(dia(0))}" max="${esc(dia(0))}"></div>
      ${U.campoPor('rkPor')}<div id="rkSaida"></div>`
    const q = id => corpo.querySelector('#' + id), saida = q('rkSaida')
    const dados = () => ({ cliente, motivo: q('rkMotivo').value, descricao: q('rkDesc').value.trim(), desde: q('rkDesde').value, por: U.lerPor(corpo, 'rkPor') })
    const previa = U.botao('Ver prévia', { aoClicar: async () => {
      const b = dados()
      if (!b.motivo) { saida.innerHTML = U.aviso('erro', 'Escolha o motivo.'); return }
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(b.por); previa.disabled = true
      let v; try { v = await api('/api/cliente/risco', b) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previa.disabled = false; return }
      saida.innerHTML = U.aviso('info', `<b>${esc(v.registro.motivo_rotulo)}</b> desde ${esc(brData(v.registro.desde))} · por ${esc(v.registro.por)}${v.registro.descricao ? `<div class="mini">${esc(v.registro.descricao)}</div>` : ''}`)
      previa.remove()
      rodape.append(U.botao('Marcar em risco', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/cliente/risco', { ...b, confirmar: true }); toast('Cliente marcado em risco.'); fechar(); aoConcluir?.() } catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previa)
  }
  function encerrar(cliente, risco, { aoConcluir } = {}) {
    const U = ui(); if (!U) return semUi()
    const { corpo, rodape, fechar } = U.dialogo(`Encerrar risco · ${cliente}`)
    corpo.innerHTML = `<p>Encerrar <b>${esc(risco.motivo_rotulo)}</b> (desde ${esc(brData(risco.desde))}). O encerramento entra no livro de registro.</p>
      <div class="campo"><label for="rkNota">Nota (até 500 caracteres, sem telefone)</label><textarea id="rkNota" maxlength="500" rows="2"></textarea></div>${U.campoPor('rkPor2')}<div id="rkSaida2"></div>`
    const saida = corpo.querySelector('#rkSaida2')
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), U.botao('Encerrar risco', { primario: true, aoClicar: async e => {
      const b = { cliente, id: risco.id, nota: corpo.querySelector('#rkNota').value.trim(), por: U.lerPor(corpo, 'rkPor2') }
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(b.por); e.currentTarget.disabled = true
      try { await api('/api/cliente/risco/encerrar', { ...b, confirmar: true }); toast('Risco encerrado.'); fechar(); aoConcluir?.() }   // o diálogo é a confirmação
      catch (x) { saida.innerHTML = U.aviso('erro', esc(x.message)); e.currentTarget.disabled = false }
    } }))
  }
  async function montarRisco(alvo, cliente) {
    if (!alvo) return
    let r, g
    try { [r, g] = await Promise.all([api('/api/cliente/risco?cliente=' + encodeURIComponent(cliente)), api('/api/risco').catch(() => null)]) } catch (e) { erroBloco(alvo, e, () => montarRisco(alvo, cliente)); return }
    const lista = r.riscos || [], abertos = lista.filter(x => x.estado === 'aberto'), sinais = (g?.sugestoes || []).find(s => s.cliente === cliente)?.sinais || []
    alvo.innerHTML = `
      <p class="veredito-frase" id="rkVeredito">${abertos.length ? `<b>Em risco</b>: ${esc(abertos.map(x => x.motivo_rotulo).join(', '))}` : '<b>Sem risco marcado.</b>'}</p>
      ${sinais.length ? `<div class="aviso amb">Sinais que o sistema vê (só sugestão; ninguém foi marcado): ${esc(sinais.map(s => `${s.rotulo}${s.desde ? ` (desde ${brData(s.desde)})` : ''}`).join('; '))}</div>` : ''}
      <div class="tabela-wrap mt-2"><table class="t empilha" id="rkTabela"><caption class="sr">Riscos de ${esc(cliente)}</caption><thead><tr><th scope="col">Motivo</th><th scope="col">Desde</th><th scope="col">Marcado por</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>${lista.length ? lista.map(x => `<tr>
        <td><b>${esc(x.motivo_rotulo)}</b>${x.descricao ? `<div class="mini">${esc(x.descricao)}</div>` : ''}</td><td>${esc(brData(x.desde))}</td><td>${esc(x.por)}</td>
        <td>${x.estado === 'aberto' ? '<span class="selo ruim">aberto</span>' : `encerrado ${esc(brData(x.encerrado_em))}<div class="mini">${esc(x.encerrado_por)}${x.nota_encerramento ? ` · ${esc(x.nota_encerramento)}` : ''}</div>`}</td>
        <td>${x.estado === 'aberto' ? `<button class="btn-mini" type="button" data-rk-encerrar="${esc(String(x.id))}">Encerrar</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="vazio">Nenhuma marcação de risco.</td></tr>'}</tbody></table></div>
      <div class="mt-2"><button class="btn" type="button" id="btnRkMarcar">Marcar em risco</button></div>`
    const recarregar = () => montarRisco(alvo, cliente)
    alvo.querySelector('#btnRkMarcar').onclick = () => marcar(cliente, r.motivos, { aoConcluir: recarregar })
    alvo.querySelectorAll('[data-rk-encerrar]').forEach(b => b.onclick = () => encerrar(cliente, lista.find(x => String(x.id) === b.dataset.rkEncerrar), { aoConcluir: recarregar }))
  }

  // ── #secContrato: contrato vigente + pagamentos (upload PDF/PNG/JPG ≤ 5 MB) ───────────────────────────────────
  function dialogoContrato(cliente, atual, { aoConcluir } = {}) {
    const U = ui(); if (!U) return semUi()
    const c = atual || {}, om = c.obrigacao_meio === true ? 'sim' : c.obrigacao_meio === false ? 'nao' : ''
    const { corpo, rodape, fechar } = U.dialogo(`Contrato · ${cliente}`)
    corpo.innerHTML = `<p>A versão anterior continua no livro de registro. O arquivo assinado é a prova que o dossiê de defesa exige (PDF, PNG ou JPG até 5 MB).</p>
      <div class="linha"><div class="campo"><label for="ctIni">Início</label><input type="date" id="ctIni" value="${esc(c.inicio || '')}"></div><div class="campo"><label for="ctFim">Fim (vazio = indeterminado)</label><input type="date" id="ctFim" value="${esc(c.fim || '')}"></div>
      <div class="campo"><label for="ctValor">Valor mensal (R$)</label><input type="number" id="ctValor" min="0" step="0.01" value="${c.valor_mensal_centavos != null ? esc(String(c.valor_mensal_centavos / 100)) : ''}"></div></div>
      <div class="campo"><label for="ctCanais">Canais (separados por vírgula)</label><input id="ctCanais" value="${esc((c.canais || []).join(', '))}"></div>
      <div class="campo"><label for="ctEnt">Entregáveis (um por linha)</label><textarea id="ctEnt" rows="4">${esc((c.entregaveis || []).join('\n'))}</textarea></div>
      <div class="campo"><label for="ctMeio">Obrigação de meio no contrato</label><select id="ctMeio"><option value=""${om === '' ? ' selected' : ''}>Não conferido</option><option value="sim"${om === 'sim' ? ' selected' : ''}>Sim</option><option value="nao"${om === 'nao' ? ' selected' : ''}>Não</option></select></div>
      <div class="campo"><label for="ctClausula">Cláusula de reembolso (texto do contrato)</label><textarea id="ctClausula" rows="3" maxlength="1500">${esc(c.clausula_reembolso || '')}</textarea></div>
      <div class="campo"><label for="ctArq">Arquivo do contrato assinado${c.arquivo_sha256 ? ' (vazio = mantém o atual)' : ''}</label><input type="file" id="ctArq" accept="application/pdf,image/png,image/jpeg"></div>
      ${U.campoPor('ctPor')}<div id="ctSaida"></div>`
    const q = id => corpo.querySelector('#' + id), saida = q('ctSaida')
    let corpoReq = null
    const previa = U.botao('Ver prévia', { aoClicar: async () => {
      const valor = q('ctValor').value === '' ? null : Math.round(Number(q('ctValor').value) * 100)
      let arquivo; try { arquivo = await lerArquivo(q('ctArq').files[0]) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); return }
      corpoReq = { cliente, inicio: q('ctIni').value, fim: q('ctFim').value, valor_mensal_centavos: valor, canais: q('ctCanais').value.split(',').map(x => x.trim()).filter(Boolean),
        entregaveis: q('ctEnt').value.split('\n').map(x => x.trim()).filter(Boolean), obrigacao_meio: q('ctMeio').value === 'sim' ? true : q('ctMeio').value === 'nao' ? false : null,
        clausula_reembolso: q('ctClausula').value.trim(), ...(arquivo ? { arquivo } : {}), por: U.lerPor(corpo, 'ctPor') }
      if (!corpoReq.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(corpoReq.por); previa.disabled = true
      let v; try { v = await api('/api/cliente/contrato', corpoReq) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previa.disabled = false; return }
      const k = v.contrato
      saida.innerHTML = U.aviso('info', `Vigência ${esc(brData(k.inicio))} a ${k.fim ? esc(brData(k.fim)) : 'indeterminado'} · ${esc(brl(k.valor_mensal_centavos))}/mês · obrigação de meio: ${k.obrigacao_meio == null ? 'não conferida' : k.obrigacao_meio ? 'sim' : 'não'} · ${esc(String(k.entregaveis.length))} entregável(is)${k.arquivo ? ` · arquivo ${esc(String(k.arquivo.sha256).slice(0, 12))}` : ' · sem arquivo'}`)
      previa.remove()
      rodape.append(U.botao('Salvar contrato', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/cliente/contrato', { ...corpoReq, confirmar: true }); toast('Contrato salvo e registrado no livro.'); fechar(); aoConcluir?.() } catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previa)
  }
  function dialogoPagamento(cliente, { aoConcluir } = {}) {
    const U = ui(); if (!U) return semUi()
    const { corpo, rodape, fechar } = U.dialogo(`Pagamento · ${cliente}`)
    corpo.innerHTML = `<p>Registre o pagamento com o comprovante (PDF, PNG ou JPG até 5 MB). Entra no livro de registro.</p>
      <div class="linha"><div class="campo"><label for="pgData">Data</label><input type="date" id="pgData" value="${esc(dia(0))}" max="${esc(dia(0))}"></div><div class="campo"><label for="pgValor">Valor (R$)</label><input type="number" id="pgValor" min="0" step="0.01"></div></div>
      <div class="campo"><label for="pgRef">Referência (ex.: mensalidade de setembro)</label><input id="pgRef" maxlength="120"></div>
      <div class="campo"><label for="pgArq">Comprovante</label><input type="file" id="pgArq" accept="application/pdf,image/png,image/jpeg"></div>${U.campoPor('pgPor')}<div id="pgSaida"></div>`
    const q = id => corpo.querySelector('#' + id), saida = q('pgSaida')
    let corpoReq = null
    const previa = U.botao('Ver prévia', { aoClicar: async () => {
      if (q('pgValor').value === '') { saida.innerHTML = U.aviso('erro', 'Informe o valor.'); return }
      let arquivo; try { arquivo = await lerArquivo(q('pgArq').files[0]) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); return }
      corpoReq = { cliente, data: q('pgData').value, valor_centavos: Math.round(Number(q('pgValor').value) * 100), referencia: q('pgRef').value.trim(), ...(arquivo ? { arquivo } : {}), por: U.lerPor(corpo, 'pgPor') }
      if (!corpoReq.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(corpoReq.por); previa.disabled = true
      let v; try { v = await api('/api/cliente/pagamento', corpoReq) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previa.disabled = false; return }
      saida.innerHTML = U.aviso('info', `${esc(brl(v.pagamento.valor_centavos))} em ${esc(brData(v.pagamento.data))}${v.pagamento.referencia ? ` · ${esc(v.pagamento.referencia)}` : ''}${v.pagamento.arquivo ? ' · com comprovante' : ' · sem comprovante'}`)
      previa.remove()
      rodape.append(U.botao('Registrar pagamento', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/cliente/pagamento', { ...corpoReq, confirmar: true }); toast('Pagamento registrado.'); fechar(); aoConcluir?.() } catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previa)
  }
  async function montarContrato(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/contrato?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarContrato(alvo, cliente)); return }
    const c = r.contrato, pg = r.pagamentos || []
    alvo.innerHTML = `
      <p class="veredito-frase" id="ctVeredito">${c ? `Contrato de ${esc(brData(c.inicio))} a ${c.fim ? esc(brData(c.fim)) : 'indeterminado'} · ${esc(brl(c.valor_mensal_centavos))}/mês · obrigação de meio: ${c.obrigacao_meio == null ? 'não conferida' : c.obrigacao_meio ? 'sim' : 'não'}${c.arquivo_sha256 ? '' : ' · <b>sem o arquivo assinado</b>'}` : '<b>Contrato não cadastrado</b>: o dossiê de defesa fica INCOMPLETO sem ele.'}</p>
      ${c ? `<dl class="mini" id="ctResumo"><dt>Canais</dt><dd>${esc(c.canais.join(', ') || '—')}</dd><dt>Entregáveis</dt><dd>${esc(c.entregaveis.join('; ') || '—')}</dd><dt>Cláusula de reembolso</dt><dd>${esc(c.clausula_reembolso || '—')}</dd><dt>Arquivo</dt><dd>${c.arquivo_sha256 ? `sha256 ${esc(c.arquivo_sha256.slice(0, 16))}…` : '—'} · atualizado por ${esc(c.por)} em ${esc(brData(c.atualizado_em))}</dd></dl>` : ''}
      <div class="tabela-wrap mt-2"><table class="t empilha" id="pgTabela"><caption class="sr">Pagamentos de ${esc(cliente)}</caption><thead><tr><th scope="col">Data</th><th scope="col">Valor</th><th scope="col">Referência</th><th scope="col">Comprovante</th></tr></thead><tbody>${pg.length ? pg.map(p => `<tr><td>${esc(brData(p.data))}</td><td>${esc(brl(p.valor_centavos))}</td><td>${esc(p.referencia || '—')}</td><td>${p.sha256 ? `sha256 ${esc(p.sha256.slice(0, 12))}` : '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="vazio">Nenhum pagamento registrado.</td></tr>'}</tbody></table></div>
      <div class="mt-2"><button class="btn" type="button" id="btnCtContrato">${c ? 'Atualizar contrato' : 'Cadastrar contrato'}</button> <button class="btn" type="button" id="btnCtPagamento">Registrar pagamento</button></div>`
    const recarregar = () => montarContrato(alvo, cliente)
    alvo.querySelector('#btnCtContrato').onclick = () => dialogoContrato(cliente, c, { aoConcluir: recarregar })
    alvo.querySelector('#btnCtPagamento').onclick = () => dialogoPagamento(cliente, { aoConcluir: recarregar })
  }

  // ── /planos › Clientes em risco: abertos + sinais sugeridos + chave do dossiê mensal ────────────────────────────
  async function montarPlanos(alvo) {
    if (!alvo) return
    let r
    try { r = await api('/api/risco') } catch (e) { erroBloco(alvo, e, () => montarPlanos(alvo)); return }
    const n = document.getElementById('nRisco'); if (n) n.textContent = String(r.abertos.length)
    const m = r.mensal || {}, link = c => `<a href="/cliente?cliente=${encodeURIComponent(c)}&amp;aba=empresa&amp;sec=secDossie">${esc(c)}</a>`
    const sugestoes = (r.sugestoes || []).filter(s => !s.risco_aberto)
    alvo.innerHTML = `
      <p class="mini" id="rkMensal">Dossiê mensal: <b>${m.ligado ? 'ligado' : 'desligado'}</b>${m.por ? ` (${esc(String(m.por).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/, x => brHora(x)))})` : ''} · dia ${esc(String(m.agenda?.dia ?? 1))} às ${esc(m.agenda?.hora || '09:00')}, mês anterior, as duas versões de cada cliente em risco aberto ao canal #growth do Discord (só equipe)${m.n8n && !m.n8n.configurado ? ' · <b>entrega n8n não configurada</b>' : ''}.</p>
      <div class="linha"><button class="btn btn-p" type="button" id="btnRkMensal">${m.ligado ? 'Desligar dossiê mensal' : 'Ligar dossiê mensal'}</button></div>
      <h3 class="mt-2">Em risco (${esc(String(r.abertos.length))})</h3>
      <div class="tabela-wrap fixa"><table class="t" id="rkAbertos"><thead><tr><th>Cliente</th><th>Motivo</th><th>Desde</th><th>Marcado por</th></tr></thead><tbody>${r.abertos.length ? r.abertos.map(x => `<tr><td>${link(x.cliente)}</td><td><b>${esc(x.motivo_rotulo)}</b>${x.descricao ? `<div class="mini">${esc(x.descricao)}</div>` : ''}</td><td>${esc(brData(x.desde))}</td><td>${esc(x.por)}</td></tr>`).join('') : '<tr><td colspan="4" class="vazio">Nenhum cliente marcado em risco.</td></tr>'}</tbody></table></div>
      <h3 class="mt-2">Sinais sugeridos pelo sistema (${esc(String(sugestoes.length))})</h3>
      <p class="mini">Só sugestão: o sistema nunca marca sozinho. Quem decide é o líder, o consultor ou o CS.</p>
      <div class="tabela-wrap fixa"><table class="t" id="rkSugestoes"><thead><tr><th>Cliente</th><th>Sinais</th><th></th></tr></thead><tbody>${sugestoes.length ? sugestoes.map(s => `<tr><td>${link(s.cliente)}</td><td>${s.sinais.map(x => `${esc(x.rotulo)}${x.desde ? ` <span class="mini">desde ${esc(brData(x.desde))}</span>` : ''}`).join('<br>')}</td><td><button class="btn-mini" type="button" data-rk-marcar="${esc(s.cliente)}">Marcar em risco</button></td></tr>`).join('') : '<tr><td colspan="3" class="vazio">Nenhum sinal agora.</td></tr>'}</tbody></table></div>`
    const recarregar = () => montarPlanos(alvo)
    alvo.querySelector('#btnRkMensal').onclick = async () => {
      const por = await pedirPor(m.ligado ? 'Desligar dossiê mensal' : 'Ligar dossiê mensal', m.ligado ? 'Nada mais é gerado nem enviado no dia 1.' : 'No dia 1 às 09:00 o sistema gera a prestação de contas e o dossiê de defesa do mês anterior de cada cliente em risco aberto e envia ao #growth (só equipe).'); if (!por) return
      try { await api('/api/dossie/mensal', { ligado: !m.ligado, por }); toast(m.ligado ? 'Dossiê mensal desligado.' : 'Dossiê mensal ligado.'); recarregar() } catch (e) { toast(e.message, 'erro') }
    }
    alvo.querySelectorAll('[data-rk-marcar]').forEach(b => b.onclick = () => marcar(b.dataset.rkMarcar, r.motivos, { aoConcluir: recarregar }))
  }

  const montarCliente = ({ dossie, risco, contrato } = {}, cliente) => { montarDossie(dossie, cliente); montarRisco(risco, cliente); montarContrato(contrato, cliente) }
  window.PSDossie = { montarCliente, montarPlanos, marcar }
})()
