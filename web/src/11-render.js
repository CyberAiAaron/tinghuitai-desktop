  // ===== 渲染 =====
  let stickBottom = true;
  el.tr.addEventListener('scroll', () => { const nearBottom = el.tr.scrollHeight - el.tr.scrollTop - el.tr.clientHeight < 40; stickBottom = nearBottom; el.jump.hidden = nearBottom; });
  el.jump.onclick = () => { stickBottom = true; el.tr.scrollTop = el.tr.scrollHeight; el.jump.hidden = true; };
  // 一个人在工位时麦克风只收到自己，标「我」；会议室模式收的是整个房间，标「在场」
  const SPK_DEF = () => ui==='en'
    ? {me: window.__roomMode ? 'In the room' : 'Me', them:'Online'}
    : {me: window.__roomMode ? '在场' : '我', them:'线上'};
  const spkName = (s) => (cur && cur.names && cur.names[s]) || state.names[s] || SPK_DEF()[s] || (s ? 'S'+s : '');
  const spkCls = (s) => s==='me' ? 's1' : s==='them' ? 's2' : /^\d+$/.test(s) ? 's'+Math.min(6, parseInt(s,10)||1) : 's'+(1 + ([...String(s)].reduce((h,c)=>(h*31 + c.charCodeAt(0))>>>0, 7) % 6));
  // 转写卡住时会吐出一长串重复。两种形态都要认：
  //   带分隔符的「好的。好的。好的。…」，和不带分隔符的「uhuhuhuh…」「I I I I…」。
  // 原来只认第一种，于是后一种整条糊在逐字稿里（2026-09-12 在真实会议里找到 4 条）。
  function repeatedASR(text){
    if (typeof text !== 'string') return false;
    if (text.length >= 80 && /(.{1,24}?[。！？,.!?，、;；\s]+)\1{7,}/u.test(text)) return true;
    return text.length >= 60 && /(.{2,20}?)\1{5,}/u.test(text);
  }
  const spkChip = (s) => s ? `<span class="spk ${spkCls(s)}" data-spk="${esc(s)}" title="点击起名">${esc(spkName(s))}</span>` : `<span class="spk s0">·</span>`;
  let sigTr = '', sigHl = '', sigCk = '', sigSum = '';
  const keepScroll = (node, fn) => { const top = node.scrollTop, atBottom = node.scrollHeight - top - node.clientHeight < 30; fn(); node.scrollTop = atBottom ? node.scrollHeight : top; };
  function render(){
    if (!cur) return;
    if(applyCorrections(cur)){resetSigs();persist();}
    const tr = cur.transcript;
    const nTr = tr.length + '|' + (tr.length?tr[tr.length-1].at:'') + '|' + interim.length + '|' + JSON.stringify(cur.names||{})+'|'+ui+'|'+JSON.stringify(cur.i18n?.[ui]?.map||{}).length;
    if (nTr !== sigTr) {
      sigTr = nTr;
      el.tr.innerHTML = tr.length ? tr.map((x,i)=>`<p><time>${hms(x.at)}</time>${spkChip(x.spk)}<span role="button" tabindex="0" data-fix="tr" data-key="${i}" title="点击修改逐字稿">${repeatedASR(x.text)?'<span class="asr-anomaly"><button type="button" class="btn sm" data-asr-expand>异常重复转写 · 展开原文</button><span hidden>'+esc(tt(x.text))+'</span></span>':esc(tt(x.text))}${!repeatedASR(x.text)&&tt(x.text)!==x.text?`<small style="display:block;color:var(--muted)">${esc(tt(x.text))}</small>`:''}</span></p>`).join('') + (interim?`<p><time>…</time><span class="spk s0">·</span><span class="interim">${esc(interim)}</span></p>`:'') : `<div class="empty">${running?(T('e_tr_live')||'正在听……'):(cur.transcript.length?'':(T('e_tr_none')||'这场还没有内容。'))}</div>`;
      if (stickBottom) el.tr.scrollTop = el.tr.scrollHeight;
    }
    renderMeetingTasks(); scheduleTranslation();
    const items = [...cur.highlights.map(x=>({k:'hl',...x}))].sort((a,b)=>(a.at||0)-(b.at||0));
    // 要点攒够了就去排一次分组。少了这一行，scheduleGrouping 永远没人调用，
    // 会中的要点就一直是平铺的——桌面版从加分组那天起就一直是这样（2026-09-12 Aaron 发现）。
    scheduleGrouping(cur, items);
    const grouped = groupedHighlights(cur, items);
    const nHl = items.map(x=>x.text).join('\u0001') + '|' + ui + '|' + (cur.i18n && cur.i18n[ui] ? JSON.stringify(cur.i18n[ui]).length : 0) + '|' + (cur.hlGroups ? cur.hlGroups.at : '')+'|'+running+'|'+cur.end;
    if (nHl !== sigHl) {
      const first = sigHl === '';
      sigHl = nHl;
      // 原始要点仍可编辑；凝练正文不覆盖原始记录。
      const cardOf = (x, fresh, label) => `<div class="card ${x.k==='hl'&&/^⚠️?\s*(冲突|Conflict)/i.test(x.text)?'conf':x.k}${fresh?' fresh':''}${x.stale?' stale':''}${x.revised?' revised':''}${x.recomputed&&!x.stale?' recomputed':''}" data-fix="hl" data-kind="${x.k}" data-key="${esc(x.text)}" title="点一下可以改或删"><span class="k">${label!=null?label:(x.at?hms(x.at).slice(0,5):'')}</span><div>${esc(tt(x.text))}${x.owner?`<div class="v">→ ${esc(tt(x.owner))}</div>`:''}${x.how?`<div class="v" style="margin-top:4px">${ui==='en'?'💡 Suggestion: ':'💡 建议：'}${esc(tt(x.how))}</div>`:''}${x.k==='todo'?`<button class="ask-claude" type="button" data-ask="${esc(x.text)}" title="让我的 Agent 先做一版方案">${ui==='en'?'Let my agent try':'给我的 Agent 先做做看'}</button>`:''}</div></div>`;

      const pinned=$('#hl-pinned');
      const openKeys=new Set(pinned.dataset.session===String(cur.id)?[...pinned.querySelectorAll('details[data-outline-key][open]')].map(d=>d.dataset.outlineKey):[]);
      const pinnedTop=pinned.scrollTop;
      const settled=[],pending=[];
      for(const g of grouped){
        const a=g.from==null?'':hms(g.from).slice(0,5),b=g.to==null?'':hms(g.to).slice(0,5);
        const span=a+(b&&b!==a?'–'+b:'');
        if(g.ungrouped){pending.push(`<section class="outline-pending">${cardOf(g.list[0],g.live,g.no+'.')}<small class="outline-time">${esc(span)}</small></section>`);continue;}
        const key=String(cur.id)+':'+hlKey(g.list[0].text);
        settled.push(`<details class="outline-section" data-outline-key="${esc(key)}" ${openKeys.has(key)?'open':''}><summary><h3>${g.no}. ${esc(tt(g.title))}</h3></summary>${g.summary?`<p class="outline-summary">${esc(tt(g.summary))}</p>`:''}<details data-outline-key="${esc(key+':raw')}" ${openKeys.has(key+':raw')?'open':''}><summary>${ui==='en'?'Original points':'原始要点'}${span?' · '+esc(span):''}</summary>${g.list.map(x=>cardOf(x,false,'')).join('')}</details></details>`);
      }
      pinned.hidden=!settled.length;
      pinned.innerHTML=settled.length?`<div class="outline-label">${ui==='en'?'AI summary':'AI 总结'}</div>`+settled.join(''):'';
      pinned.dataset.session=String(cur.id);pinned.scrollTop=pinnedTop;
      keepScroll(el.hl,()=>{el.hl.innerHTML=pending.join('')||`<div class="empty">${settled.length?(ui==='en'?'New points will appear here.':'新的要点会显示在这里。'):(T('e_hl')||'要点会显示在这里。')}</div>`;});
      if (hlPaintedFor !== (cur && cur.id)) {
        el.hl.scrollTop = running ? el.hl.scrollHeight : 0;
        hlPaintedFor = cur && cur.id;
      }
    }
    const cks = [...cur.factchecks].sort((a,b)=>(a.at||0)-(b.at||0));
    const nCk = cks.map(x=>x.claim).join('\u0001') + '|' + ui + '|' + (cur.i18n && cur.i18n[ui] ? JSON.stringify(cur.i18n[ui]).length : 0);
    if (nCk !== sigCk) {
      const first = sigCk === '';
      sigCk = nCk;
      keepScroll(el.ck, () => { el.ck.innerHTML = cks.length ? cks.map((x,i)=>`<div class="card ck${(!first&&i===cks.length-1)?' fresh':''}" data-fix="ck" data-key="${esc(tt(x.claim))}" title="点一下可以改或删"><span class="k">${x.at?hms(x.at).slice(0,5):''}</span><div>${esc(tt(x.claim))}<div class="v"><span class="verdict ${x.verdict}">${x.verdict==='true'?(T('v_true')||'大概率对'):x.verdict==='false'?(T('v_false')||'可能有误'):(T('v_unsure')||'拿不准')}</span>${esc(tt(x.note||''))}</div></div></div>`).join('') : `<div class="empty">${T('e_ck')||'对话里提到的公司、数字、事件会标出来并给初步判断。'}</div>`; }); if (first) el.ck.scrollTop = el.ck.scrollHeight;
    }
    el.ctr.textContent = tr.length; el.chl.textContent = items.length; el.cck.textContent = cks.length;
    const nSum = (cur.summary || '') + '|' + ui + '|' + (cur.i18n && cur.i18n[ui] ? JSON.stringify(cur.i18n[ui]).length : 0);
    if (nSum !== sigSum) { sigSum = nSum; const sumTxt = tt(cur.summary); el.sum.innerHTML = cur.summary ? esc(sumTxt) : `<span class="empty">${T('e_sum')||'结束后会出现在这里。'}</span>`; }
  }
  setInterval(()=>{if(cur&&!cur.viewOnly&&(running||cur.end))scheduleGrouping(cur,(cur.highlights||[]).slice().sort((a,b)=>(a.at||0)-(b.at||0)));},30000);
  const resetSigs = () => { sigTr = sigHl = sigCk = sigSum = ''; };
  el.tr.addEventListener('click', e => { const s = e.target.closest('.spk'); if (!s || !s.dataset.spk) return; const id = s.dataset.spk; $('#spk-label').textContent = spkName(id) + (T('spk_all')||'（全场生效）'); $('#spk-name').value = ((cur&&cur.names&&cur.names[id])||state.names[id]||''); $('#dlg-spk').dataset.id = id; $('#dlg-spk').showModal(); setTimeout(()=>$('#spk-name').focus(),50); });
  $('#spk-cancel').onclick = () => $('#dlg-spk').close();
  $('#spk-save').onclick = () => { const id = $('#dlg-spk').dataset.id, nm = $('#spk-name').value.trim(); if (cur) { cur.names = cur.names||{}; if (nm) cur.names[id] = nm; else delete cur.names[id]; } if (nm) state.names[id] = nm; persist(); $('#dlg-spk').close(); render(); sendNames(); };
  // 主题标题/参会人来自 Mac 的 /meeting-list（会后流水线生成），合并进本机 state 后持久化；Mac 不在线时用已缓存的。
  async function syncMeetingList(){
    if (!cfg.relayToken && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return false;
    try {
      const r = await fetch(relayBase()+'/meeting-list?token='+encodeURIComponent(cfg.relayToken||''), {cache:'no-store', signal: AbortSignal.timeout(5000)});
      if (!r.ok) return false;
      const d = await r.json(); const byId = new Map((d.sessions||[]).map(x=>[String(x.id), x])); let changed = false;
      for (const s of state.sessions) { const m = byId.get(String(s.id)); if (!m) continue;
        if (m.topicTitle && m.topicTitle !== s.topicTitle) { s.topicTitle = m.topicTitle; changed = true; }
        if (Array.isArray(m.participants) && JSON.stringify(m.participants) !== JSON.stringify(s.participants||[])) { s.participants = m.participants; changed = true; } }
      if (changed) persist();
      return changed;
    } catch(e) { return false; }
  }