// Ficha do cliente: equipe (prestadores ativos do Notion por canal e papel) + links das contas. Usada na tela do cliente e na distribuição de tarefas.
// window.PSFicha.montar(elemento, cliente, { aoSalvar }) — tudo que vem do servidor entra por textContent/atributos escapados.
// Sem CSS próprio: só classes do ui.css (.grade, .campo, .tabela-wrap, .btn, .linha, .mini, .fch .msg).
(() => {
  if (window.PSFicha) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const lerNome = () => { try { return window.PS?.quem?.().nome || localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }   // padrão = «Quem sou» do topo (F2)
  const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento: só não lembra o nome */ } }

  async function montar(alvo, cliente, { aoSalvo } = {}) {
    alvo.innerHTML = '<div class="fch mini">Carregando a ficha…</div>'
    let r
    try { r = await api('/api/ficha?cliente=' + encodeURIComponent(cliente)) } catch (e) { alvo.innerHTML = `<div class="fch"><div class="msg erro">${esc(e.message)}</div></div>`; return }
    desenhar(alvo, cliente, r, aoSalvo, '')
  }

  function desenhar(alvo, cliente, r, aoSalvo, mensagem, tipoMsg = 'ok') {
    const f = r.ficha, valor = (canal, papel) => f.prestadores.find(p => p.canal === canal && p.papel === papel)
    const colunas = ['', ...(r.canais_cliente || []).filter(k => Object.hasOwn(r.canais, k))]
    const grupos = [...new Set(r.prestadores.map(p => p.cargo || 'Sem cargo'))].sort()
    const opcoes = (canal, papel) => {
      const atual = valor(canal, papel)
      const inativo = atual && !atual.ativo ? `<option value="${esc(atual.prestador)}" selected>${esc(atual.prestador)} — NÃO ESTÁ MAIS ATIVO</option>` : ''
      const pref = { consultor: /consultor|sucesso/i, analista: /analista/i, apoio: /social|est[aá]gi|design|audiovisual|marketing/i }[papel]
      const ordem = [...grupos].sort((a, b) => (pref?.test(b) ? 1 : 0) - (pref?.test(a) ? 1 : 0) || a.localeCompare(b))   // os cargos do papel vêm primeiro (não precisa rolar 47 nomes)
      return `<option value="">— ninguém —</option>${inativo}` + ordem.map(g => `<optgroup label="${esc(g)}">${r.prestadores.filter(p => (p.cargo || 'Sem cargo') === g).map(p => {
        const atende = p.atuacao.some(a => a.trim().toLowerCase() === cliente.trim().toLowerCase())
        return `<option value="${esc(p.nome)}" ${atual?.ativo && atual.prestador === p.nome ? 'selected' : ''}>${esc(p.nome)}${atende ? ' (atende este cliente)' : ''}${p.notion ? '' : ' (sem usuário no Notion)'}</option>`
      }).join('')}</optgroup>`).join('')
    }
    const semNotion = f.prestadores.filter(p => p.ativo && !p.notion)
    const inativos = f.prestadores.filter(p => !p.ativo)
    alvo.innerHTML = `<div class="fch">
      <h3>Links das contas e dos materiais</h3>
      <div class="grade mt-2">${r.links.map(l => `<div class="campo"><label for="fl_${esc(l.id)}">${esc(l.rotulo)}</label><input id="fl_${esc(l.id)}" data-link="${esc(l.id)}" type="url" maxlength="500" placeholder="https://…" value="${esc(f.links[l.id] || '')}">
        ${!f.links[l.id] && r.sugestoes[l.id] ? `<div class="mini">Da conta conectada: ${esc(r.sugestoes[l.id])} <button class="btn-mini" type="button" data-usar="${esc(l.id)}">Usar</button></div>` : ''}${f.links[l.id] ? `<div class="mini"><a href="${esc(f.links[l.id])}" target="_blank" rel="noopener noreferrer">abrir o link</a></div>` : ''}</div>`).join('')}</div>
      <h3 class="mt-4">Equipe do cliente <span class="mini">(prestadores ativos no Notion, quem recebe a tarefa aprovada)</span></h3>
      <div class="tabela-wrap mt-2"><table><thead><tr><th>Papel</th>${colunas.map(k => `<th>${esc(r.canais[k])}</th>`).join('')}</tr></thead><tbody>
        ${r.papeis.map(p => `<tr><td><b>${esc(p.rotulo)}</b></td>${colunas.map(k => `<td><div class="campo"><select data-canal="${esc(k)}" data-papel="${esc(p.id)}" aria-label="${esc(p.id)} ${esc(r.canais[k])}">${opcoes(k, p.id)}</select></div></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="mini mt-2">A atribuição de um canal vale mais que a de “Todos os canais”. Sem atribuição, a tarefa vai para o analista que mais executa este cliente (últimos 90 dias) e, na falta dele, para o consultor do canal. “Atende este cliente” = o Notion lista este cliente na atuação da pessoa.</div>
      ${semNotion.length ? `<div class="msg aviso mt-2">Sem usuário identificado no Notion (a tarefa cita o nome na descrição, mas não atribui): ${semNotion.map(p => esc(p.prestador)).join(', ')}. O Notion só revela o usuário depois que a pessoa aparece como responsável em alguma tarefa, ou fixe o id em config/equipe.json → usuarios_notion.</div>` : ''}
      ${inativos.length ? `<div class="msg erro mt-2">Atribuição a pessoa que não está mais ativa no Notion (ignorada na distribuição): ${inativos.map(p => esc(p.prestador)).join(', ')}.</div>` : ''}
      <label class="campo mt-4" for="fchObs"><span class="pf-rot">Observação</span><input id="fchObs" maxlength="1000" placeholder="Ex.: prefere contato por WhatsApp; só aprova mudança de preço por e-mail" value="${esc(f.observacao || '')}"></label>
      <div class="linha mt-4">
        <label class="campo" for="fchPor"><span class="pf-rot">Seu nome</span><input id="fchPor" maxlength="80" autocomplete="name" placeholder="Fica registrado na ficha" value="${esc(lerNome())}"></label>
        <button class="btn" type="button" id="fchSalvar">Salvar ficha</button>
        <button class="btn btn-fantasma" type="button" id="fchSync" title="Lê do Notion quem está Ativo hoje (só nome, cargo, área e clientes)">Atualizar prestadores do Notion</button>
        ${f.atualizado_em ? `<span class="mini">Última gravação: ${esc(f.atualizado_em.slice(0, 16).replace('T', ' '))} por ${esc(f.por || '—')}</span>` : '<span class="mini">Ficha ainda não preenchida.</span>'}
      </div>
      <div id="fchMsg" class="mt-2">${mensagem ? `<div class="msg ${tipoMsg}">${esc(mensagem)}</div>` : ''}</div></div>`
    const msg = (t, tipo) => { alvo.querySelector('#fchMsg').innerHTML = `<div class="msg ${tipo}">${esc(t)}</div>` }
    alvo.querySelectorAll('[data-usar]').forEach(a => a.onclick = () => { alvo.querySelector(`[data-link="${a.dataset.usar}"]`).value = r.sugestoes[a.dataset.usar]; a.parentElement.remove() })
    alvo.querySelector('#fchSalvar').onclick = async e => {
      const btn = e.currentTarget, por = alvo.querySelector('#fchPor').value.trim()
      if (!por) return msg('Informe seu nome — ele fica registrado junto da ficha.', 'erro')
      btn.disabled = true
      try {
        const links = {}; alvo.querySelectorAll('[data-link]').forEach(i => { links[i.dataset.link] = i.value.trim() })
        const prestadores = [...alvo.querySelectorAll('select[data-papel]')].map(s => ({ canal: s.dataset.canal, papel: s.dataset.papel, prestador: s.value }))
        const s = await api('/api/ficha', { cliente, por, links, prestadores, observacao: alvo.querySelector('#fchObs').value.trim() })
        gravarNome(por)
        desenhar(alvo, cliente, { ...r, ficha: s.ficha }, aoSalvo, 'Ficha salva — as próximas tarefas aprovadas já saem delegadas a esta equipe.')
        aoSalvo?.(s.ficha)
      } catch (x) { msg(x.message, 'erro'); btn.disabled = false }
    }
    alvo.querySelector('#fchSync').onclick = async e => {
      const btn = e.currentTarget; btn.disabled = true; msg('Lendo os prestadores do Notion…', 'aviso')
      try { const s = await api('/api/prestadores/sincronizar', {}); await montar(alvo, cliente, { aoSalvo }); alvo.querySelector('#fchMsg').innerHTML = `<div class="msg ok">${s.prestadores} prestador(es) ativo(s) lidos do Notion.</div>` }
      catch (x) { msg(x.message, 'erro'); btn.disabled = false }
    }
  }
  window.PSFicha = { montar }
})()
