// Planilha de custos subida na tela (src/lib/custos-upload.js) na aba /cliente › Configurar:
//   window.PSCustosUpload.montar(alvo, cliente) → #custosUpload: arquivo (.csv/.xlsx) + «Ver prévia» (secundário) → resumo por critério, anúncios que recebem custo
//   (6 colunas), sem par com sugestão, conflitos, quarentena e linhas inválidas → «Aplicar custos…» abre o diálogo onde mora o ÚNICO primário (Confirmar).
// O servidor decide tudo (prévia = gravação desfeita); aqui só mostra. Tudo que vem do servidor passa por esc(). Sem cor nova, sem style, sem emoji.
(() => {
  if (window.PSCustosUpload) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brl = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const pct = v => v == null ? '' : ` (${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ORIGEM = { mlb: 'MLB da linha', sku: 'SKU exato', sku_normalizado: 'SKU sem espaço/hífen', grupo: 'mesmo produto', manual: 'vínculo manual' }
  const CRIT = [['mlb', 'MLB na linha'], ['sku', 'SKU exato'], ['sku_normalizado', 'SKU normalizado'], ['grupo', 'mesmo produto'], ['manual', 'vínculo manual anterior'], ['variacao', 'só variação (custos diferentes)'], ['sem_par', 'sem par']]
  const lista = (titulo, itens, linha) => itens.length ? `<details class="evid mt-2"><summary>${esc(titulo)} (${itens.length})</summary><ul>${itens.slice(0, 100).map(x => `<li>${linha(x)}</li>`).join('')}</ul></details>` : ''

  function desenharPrevia(box, r, cliente, alvo) {
    const c = r.criterios, e = r.efeito
    box.innerHTML = `
      <p class="veredito-frase" id="cuVeredito">${esc(String(r.total_anuncios))} anúncio(s) recebem custo · ${esc(String(r.linhas.validas))} linha(s) válidas de ${esc(String(r.linhas.total))}${r.linhas.em_branco ? ` · ${esc(String(r.linhas.em_branco))} com custo em branco` : ''}</p>
      <p class="mini">Colunas lidas: ${Object.entries(r.colunas).map(([k, v]) => `${esc(k)} = «${esc(v)}»`).join(' · ')}</p>
      <p class="mini">Por critério: ${CRIT.filter(([k]) => c[k]).map(([k, n]) => `${esc(n)} ${esc(String(c[k]))}`).join(' · ') || 'nenhuma linha casou'}</p>
      ${e ? `<p class="mini">Curva A/B: ${esc(String(e.curva_ab_com_custo_antes))} → ${esc(String(e.curva_ab_com_custo_depois))} de ${esc(String(e.curva_ab))} anúncios com custo · ${esc(String(e.curva_ab_passam_a_ter_margem))} passam a ter margem</p>` : '<p class="mini">Curva A/B: —</p>'}
      ${r.avisos.map(a => `<div class="aviso">${esc(a)}</div>`).join('')}
      <div class="tabela-wrap"><table class="t" id="cuTabAnuncios"><caption class="mini">Anúncios que recebem custo (margem bruta = preço − custo − tarifa da última venda; — sem tarifa)</caption><thead><tr><th scope="col">MLB</th><th scope="col">Título</th><th scope="col">Preço</th><th scope="col">Custo</th><th scope="col">Margem bruta</th><th scope="col">Critério</th></tr></thead><tbody>
        ${r.anuncios.map(a => `<tr><td>${esc(a.item_id)}${a.curva ? ` <span class="selo neutro">${esc(a.curva)}</span>` : ''}</td><td>${esc(a.titulo)}${a.kit ? ` <span class="mini">kit ${esc(String(a.kit.quantidade))}</span>` : ''}</td><td>${brl(a.preco)}</td><td>${brl(a.custo)}${a.custo_antes != null && a.custo_antes !== a.custo ? ` <span class="mini">antes ${brl(a.custo_antes)}</span>` : ''}</td><td>${brl(a.margem)}${pct(a.margem_pct)}</td><td>${esc(ORIGEM[a.origem] || a.origem)}</td></tr>`).join('') || '<tr><td colspan="6" class="mudo">nenhum anúncio recebe custo com esta planilha</td></tr>'}
      </tbody></table></div>
      ${lista('Sem par (título só sugere: vincule em Promoções › Custos)', r.sem_par, s => `linha ${esc(String(s.linha))}: ${esc(s.sku || s.titulo)} · ${brl(s.custo)}${s.sugestoes.length ? ` — parecido: ${s.sugestoes.map(g => `${esc(g.item_id)} ${esc(g.titulo)} (${esc(String(g.semelhanca))}%)`).join('; ')}` : ''}`)}
      ${lista('Conflitos (não gravados)', r.conflitos, x => `linha ${esc(String(x.linha ?? '—'))}: ${esc(x.sku || x.mlb || '')} — ${esc(x.motivo)}`)}
      ${lista('Quarentena (grava, mas só vale depois de aprovar)', r.quarentena, x => `linha ${esc(String(x.linha ?? '—'))}: ${esc(x.sku)} — ${esc(x.motivo)}`)}
      ${lista('Linhas inválidas', r.invalidas, x => `linha ${esc(String(x.linha ?? '—'))}${x.sku ? ` (${esc(x.sku)})` : ''}: ${esc(x.motivo)}`)}
      <div class="linha mt-2"><button class="btn" type="button" id="btnCuAplicar"${r.gravavel ? '' : ' disabled'}>Aplicar custos…</button></div>`
    box.querySelector('#btnCuAplicar').onclick = () => confirmar(r, cliente, alvo)
  }

  function confirmar(r, cliente, alvo) {
    const ui = window.PSRelatorio?.ui
    if (!ui) { toast('Diálogo indisponível: recarregue a página.', 'erro'); return }
    const { corpo, rodape, fechar } = ui.dialogo('Aplicar a planilha de custos?')
    corpo.innerHTML = `<p>${esc(String(r.total_anuncios))} anúncio(s) de ${esc(cliente)} passam a usar estes custos (fonte «upload»: vale depois do manual e antes do ERP). ${esc(String(r.quarentena.length))} em quarentena, ${esc(String(r.conflitos.length))} conflito(s) e ${esc(String(r.linhas.invalidas))} linha(s) inválida(s) não valem. O diagnóstico é recalculado e o registro entra no livro do cliente.</p>${ui.campoPor('cuPor')}<div class="aviso erro" id="cuErro" hidden></div>`
    rodape.append(ui.botao('Cancelar', { aoClicar: fechar }), ui.botao('Confirmar', { primario: true, aoClicar: async () => {
      const por = ui.lerPor(corpo, 'cuPor'), err = corpo.querySelector('#cuErro')
      if (!por) { err.textContent = 'Informe seu nome.'; err.hidden = false; return }
      try {
        const res = await fetch('/api/cliente/custos/upload/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente, upload_id: r.upload_id, por, confirmar: true }) })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.erro || `erro ${res.status}`)
        ui.gravarNome(por); fechar()
        toast(`Custos aplicados: ${j.total_anuncios} anúncio(s) com custo${j.diagnostico?.recalculado ? `; diagnóstico recalculado (${j.diagnostico.curva_ab_com_custo} de ${j.diagnostico.curva_ab} da curva A/B com custo)` : ''}.`)
        montar(alvo, cliente)
      } catch (x) { err.textContent = x.message; err.hidden = false }
    } }))
  }

  function montar(alvo, cliente) {
    if (!alvo) return
    alvo.innerHTML = `
      <p class="mini">CSV ou XLSX até 5 MB, uma linha por produto. Colunas reconhecidas pelo nome: SKU (ou código/referência), anúncio (MLB), custo (custo unitário, preço de custo, CMV) e, se houver, título, kit/quantidade, fornecedor, prazo de reposição e NCM. Custo em R$ 1.234,56 ou 1234.56; linha com custo em branco é ignorada.</p>
      <div class="linha mt-2"><label class="campo"><span class="pf-rot">Planilha</span><input type="file" id="cuArquivo" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <button class="btn" type="button" id="btnCuPrevia">Ver prévia</button></div>
      <div id="cuPrevia" class="mt-2"></div>`
    const box = alvo.querySelector('#cuPrevia')
    alvo.querySelector('#btnCuPrevia').onclick = async () => {
      const f = alvo.querySelector('#cuArquivo').files[0]
      if (!f) { toast('Escolha a planilha (.csv ou .xlsx).', 'erro'); return }
      const fd = new FormData(); fd.set('cliente', cliente); fd.set('arquivo', f)
      box.innerHTML = '<div aria-busy="true"><div class="sk-tabela"></div></div>'
      try {
        const res = await fetch('/api/cliente/custos/upload', { method: 'POST', body: fd })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.erro || `erro ${res.status}`)
        desenharPrevia(box, j, cliente, alvo)
      } catch (x) { box.innerHTML = `<div class="aviso erro">${esc(x.message)}</div>` }
    }
  }
  window.PSCustosUpload = { montar }
})()
