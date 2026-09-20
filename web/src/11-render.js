  // ===== 渲染 =====
  let stickBottom = true;
  el.tr.addEventListener('scroll', () => { const nearBottom = el.tr.scrollHeight - el.tr.scrollTop - el.tr.clientHeight < 40; stickBottom = nearBottom; el.jump.hidden = nearBottom; });
  el.jump.onclick = () => { stickBottom = true; el.tr.scrollTop = el.tr.scrollHeight; el.jump.hidden = true; };
  // 一个人在工位时麦克风只收到自己，标「我」；会议室模式收的是整个房间，标「在场」
  const SPK_DEF = () => ui==='en'
    ? {me: window.__roomMode ? 'In the room' : 'Me', them:'Online'}
    : {me: window.__roomMode ? '在场' : '我', them:'线上'};
  // 识别引擎给的说话人号是聚类号，不连续（0、1、6、7…），4 个人的会也会冒出 S6。
  // 显示时按「这场里第一次开口的顺序」排成 S1、S2…；存储和发给模型的仍是原始号，names 也仍按原始号存。
  // 说话人入库后不会被改写，所以这个顺序在会中是稳定的。
  // 纯语气词的一行：调淡显示，不隐藏、不改原文。集合与服务端一致。
  const fillerASR = (t) => typeof t==='string' && /^(嗯|啊|哦|噢|呃|额|哎|唉|诶|欸|哈|呀|呵|um+|uh+|mm+|hmm+|ah+|oh+)+$/i.test(t.replace(/[\s，。、,.!?！？…~—-]+/g,''));
  let spkIdxCache = {id:null, n:-1, map:{}};
  function spkIndex(s){
    s = String(s==null?'':s); if(!/^\d+$/.test(s)) return 0;
    const tr = (cur && cur.transcript) || [];
    if(spkIdxCache.id !== (cur && cur.id) || spkIdxCache.n !== tr.length){
      const map = {}; let k = 0;
      for(const r of tr){ const v = String(r.spk ?? r.speaker ?? ''); if(/^\d+$/.test(v) && !(v in map)) map[v] = ++k; }
      spkIdxCache = {id: cur && cur.id, n: tr.length, map};
    }
    return spkIdxCache.map[s] || 0;
  }
  const spkName = (s) => (cur && cur.names && cur.names[s]) || state.names[s] || SPK_DEF()[s] || (s ? 'S'+(spkIndex(s)||s) : '');
  // 要点 / 待办 / 看法里模型写的「S6」是原始号：换成同一套显示名（起过名字就显示名字）。只换这场真出现过的号，S24 这类产品名不动。
  const spkText = (t) => String(t==null?'':t).replace(/(?<![A-Za-z0-9])S(\d{1,2})(?![A-Za-z0-9])/g, (m, d) => spkIndex(d) ? spkName(d) : m);
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
      el.tr.innerHTML = tr.length ? tr.map((x,i)=>`<p${fillerASR(x.text)?' class="filler"':''}><time>${hms(x.at)}</time>${spkChip(x.spk)}<span role="button" tabindex="0" data-fix="tr" data-key="${i}" title="点击修改逐字稿">${repeatedASR(x.text)?'<span class="asr-anomaly"><button type="button" class="btn sm" data-asr-expand>异常重复转写 · 展开原文</button><span hidden>'+esc(tt(x.text))+'</span></span>':esc(tt(x.text))}${x.memo?`<small class="memo" style="display:block;color:var(--muted)">📝 ${esc(x.memo)}</small>`:''}</span></p>`).join('') + (interim?`<p><time>…</time><span class="spk s0">·</span><span class="interim">${esc(interim)}</span></p>`:'') : `<div class="empty">${running?(T('e_tr_live')||'正在听……'):(cur.transcript.length?'':(T('e_tr_none')||'这场还没有内容。'))}</div>`;
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
      const cardOf = (x, fresh, label) => `<div class="card ${x.k==='hl'&&/^⚠️?\s*(冲突|Conflict)/i.test(x.text)?'conf':x.k}${fresh?' fresh':''}${x.stale?' stale':''}${x.revised?' revised':''}${x.recomputed&&!x.stale?' recomputed':''}${x.pendingFix?' pending':''}" data-fix="hl" data-kind="${x.k}" data-key="${esc(x.text)}" title="点一下可以改或删"><span class="k">${label!=null?label:(x.at?hms(x.at).slice(0,5):'')}</span><div>${esc(tt(x.text))}${x.owner?`<div class="v">→ ${esc(tt(x.owner))}</div>`:''}${x.memo?`<div class="v memo">📝 ${esc(x.memo)}</div>`:''}${x.how?`<div class="v" style="margin-top:4px">${ui==='en'?'💡 Suggestion: ':'💡 建议：'}${esc(tt(x.how))}</div>`:''}${x.k==='todo'?`<button class="ask-claude" type="button" data-ask="${esc(x.text)}" title="让我的 Agent 先做一版方案">${ui==='en'?'Let my agent try':'给我的 Agent 先做做看'}</button>`:''}</div></div>`;

      const pinned=$('#hl-pinned');
      const openKeys=new Set(pinned.dataset.session===String(cur.id)?[...pinned.querySelectorAll('details[data-outline-key][open]')].map(d=>d.dataset.outlineKey):[]);
      const pinnedTop=pinned.scrollTop;
      const settled=[],pending=[];
      const liveNow=running&&!cur.end&&!cur.viewOnly;
      const lastSettled=liveNow?grouped.filter(g=>!g.ungrouped).pop():null;
      const pinnedAtBottom=pinned.scrollHeight-pinned.scrollTop-pinned.clientHeight<30;
      for(const g of grouped){
        const a=g.from==null?'':hms(g.from).slice(0,5),b=g.to==null?'':hms(g.to).slice(0,5);
        const span=a+(b&&b!==a?'–'+b:'');
        if(g.ungrouped){pending.push(`<section class="outline-pending">${cardOf(g.list[0],g.live,g.no+'.')}<small class="outline-time">${esc(span)}</small></section>`);continue;}
        const key=String(cur.id)+':'+hlKey(g.list[0].text);
        settled.push(`<details class="outline-section" data-outline-key="${esc(key)}" ${openKeys.has(key)?'open':''}><summary>${g===lastSettled?`<span class="outline-now">● ${ui==='en'?'Now':'正在聊'}</span>`:''}<h3>${g.no}. ${esc(tt(g.title))}</h3>${span?`<span class="outline-span">${esc(span)}</span>`:''}</summary>${g.summary?`<p class="outline-summary">${esc(tt(g.summary))}</p>`:''}<details data-outline-key="${esc(key+':raw')}" ${openKeys.has(key+':raw')?'open':''}><summary>${ui==='en'?'Original points':'原始要点'}${span?' · '+esc(span):''}</summary>${g.list.map(x=>cardOf(x,false,'')).join('')}</details></details>`);
      }
      pinned.hidden=!settled.length;
      pinned.innerHTML=settled.length?`<div class="outline-label">${ui==='en'?'AI summary':'AI 总结'}</div>`+settled.join(''):'';
      const pinnedFirst=pinned.dataset.session!==String(cur.id);
      pinned.dataset.session=String(cur.id);
      // 会中大纲按时间正序，「正在聊」那组在最下面：首次打开或本来就在底部时跟到底，用户往上翻了就不抢。
      pinned.scrollTop=liveNow&&(pinnedFirst||pinnedAtBottom)?pinned.scrollHeight:(pinnedFirst?0:pinnedTop);
      keepScroll(el.hl,()=>{el.hl.innerHTML=pending.join('')||`<div class="empty">${settled.length?(ui==='en'?'New points will appear here.':'新的要点会显示在这里。'):(T('e_hl')||'要点会显示在这里。')}</div>`;});
      if (hlPaintedFor !== (cur && cur.id)) {
        el.hl.scrollTop = running ? el.hl.scrollHeight : 0;
        hlPaintedFor = cur && cur.id;
      }
    }
    const cks = cur.factchecks.filter(x=>!viewJunk(x)).sort((a,b)=>(a.at||0)-(b.at||0));
    const nCk = cks.map(x=>x.claim+'\u0002'+(x.rating||'')+(x.comment||'')+(x.pendingFix?'p':'')).join('\u0001') + '|' + ui + '|' + (cur.i18n && cur.i18n[ui] ? JSON.stringify(cur.i18n[ui]).length : 0);
    if (nCk !== sigCk) {
      const first = sigCk === '';
      sigCk = nCk;
      keepScroll(el.ck, () => { el.ck.innerHTML = cks.length ? cks.map((x,i)=>`<div class="card ck kind-${esc(kindOf(x))}${(!first&&i===cks.length-1)?' fresh':''}${x.pendingFix?' pending':''}" data-fix="ck" data-key="${esc(x.claim)}" data-id="${esc(x.id||'')}" title="${ui==='en'?'Tap to edit · long-press to leave a line':'点一下改或删 · 长按留一句话'}"><span class="k">${x.at?hms(x.at).slice(0,5):''}</span><div><span class="kind">${esc(kindLabel(kindOf(x),ui==='en',x))}</span>${esc(tt(x.claim))}<div class="v">${esc(tt(x.note||''))}</div>${x.evidence?`<div class="v ev">“${esc(x.evidence)}”</div>`:''}${x.memo?`<div class="v memo">📝 ${esc(x.memo)}</div>`:''}${x.comment?`<div class="v memo">💬 ${esc(x.comment)}</div>`:''}<div class="fb"><button type="button" data-fb="useful" class="${x.rating==='useful'?'on':''}">${ui==='en'?'Useful':'有用'}</button><button type="button" data-fb="useless" class="${x.rating==='useless'?'on':''}">${ui==='en'?'Useless':'没用'}</button><button type="button" data-fb="adopt" class="${x.rating==='adopt'?'on':''}">${ui==='en'?'Adopt':'采纳'}</button></div></div></div>`).join('') : `<div class="empty">${T('e_ck')||'对照项目状态给你的判断：可能正确 / 可能不对 / 值得知道，加它自己起名的提醒。空着 = 暂时没什么值得说的。'}</div>`; }); if (first) el.ck.scrollTop = el.ck.scrollHeight;
    }
    el.ctr.textContent = tr.length; el.chl.textContent = items.length; el.cck.textContent = cks.length;
    const nSum = (cur.summary || '') + '|' + ui + '|' + (cur.i18n && cur.i18n[ui] ? JSON.stringify(cur.i18n[ui]).length : 0);
    if (nSum !== sigSum) { sigSum = nSum; const sumTxt = tt(cur.summary); el.sum.innerHTML = cur.summary ? esc(sumTxt) : `<span class="empty">${T('e_sum')||'结束后会出现在这里。'}</span>`; }
  }
  setInterval(()=>{if(cur&&!cur.viewOnly&&(running||cur.end))scheduleGrouping(cur,(cur.highlights||[]).slice().sort((a,b)=>(a.at||0)-(b.at||0)));},30000);
  const resetSigs = () => { sigTr = sigHl = sigCk = sigSum = ''; };
  // 看法卡的反馈：一击 有用/没用/采纳，长按留一句话。本地先记、再告诉 Mac 回流到后续 triage（Aaron 2026-09-17）。
  const VIEW_JUNK_RE=/无法核实|未给出(原文)?依据|不可核实|无从核实|无法验证|cannot (be )?verif|no verbatim evidence|not verifiable/i;
  // 旧版（0.6.13 前）条目没有 kind：按 verdict 标「可能正确 / 可能不对 / 旧版初判」；写着「无法核实」的直接不显示
  function viewJunk(x){return !x||!x.kind&&(VIEW_JUNK_RE.test(x.note||'')||VIEW_JUNK_RE.test(x.claim||''));}
  function kindOf(x){const k=x&&x.kind; if(k==='view'||k==='note') return 'other'; const v=String(x&&x.verdict); return k||(v==='false'?'doubt':v==='true'?'ok':'legacy');}
  function kindLabel(k,en,x){if(k==='other'&&x&&x.label) return x.label; return ({ok:en?'Likely right':'可能正确',fix:en?'You meant':'你说的是',link:en?'Connects to':'联想',add:en?'Context':'补充',know:en?'Worth knowing':'值得知道',doubt:en?'May be wrong':'可能不对',legacy:en?'Old version':'旧版初判',other:en?'Note':'提醒'})[k]||(en?'Note':'提醒');}
  function viewItemOf(card){ if(!cur||!card) return null; const id=card.dataset.id, key=card.dataset.key; return (cur.factchecks||[]).find(x=>id&&x.id===id) || (cur.factchecks||[]).find(x=>x.claim===key) || null; }
  async function sendViewFeedback(it,rating,comment){ if(!it) return; it.rating=rating; if(comment!==undefined) it.comment=comment; persist(); sigCk='\u0000'; render();
    try{ const r=await fetch(relayBase()+'/view-feedback?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:cur.id,id:it.id||'',kind:it.kind||'',claim:it.claim||'',rating:rating||'',comment:it.comment||''}),signal:AbortSignal.timeout(4000)}); if(!r.ok) throw new Error('HTTP '+r.status); it.fbSynced=true; }
    catch(e){ it.fbSynced=false; note((ui==='en'?'Saved here; Mac not reached: ':'已记在本机，没送到 Mac：')+e.message,true); } persist(); }
  el.ck.addEventListener('click', e => { const b=e.target.closest('button[data-fb]'); if(!b) return; e.stopPropagation(); e.preventDefault(); const it=viewItemOf(b.closest('.card')); if(!it) return; const r=b.dataset.fb; sendViewFeedback(it, it.rating===r?'':r); }, true);
  (function(){ let t=null, fired=false; let x0=0,y0=0; const arm=e=>{ fired=false; const c=e.target.closest('.card.ck'); if(!c||e.target.closest('button')) return; x0=e.clientX; y0=e.clientY; t=setTimeout(()=>{ fired=true; setTimeout(()=>{ fired=false; },700); const it=viewItemOf(c); if(!it) return; const line=prompt(ui==='en'?'One line for this view (what was off / what you want more of):':'给这条看法留一句话（哪里不对 / 想多要什么）：', it.comment||''); if(line===null) return; sendViewFeedback(it, it.rating||'', line.trim().slice(0,300)); },550); };
    const disarm=()=>{ if(t){clearTimeout(t);t=null;} };
    el.ck.addEventListener('pointerdown',arm); el.ck.addEventListener('pointermove',e=>{ if(t&&(Math.abs(e.clientX-x0)>10||Math.abs(e.clientY-y0)>10)) disarm(); }); el.ck.addEventListener('pointerup',disarm); el.ck.addEventListener('pointercancel',disarm); el.ck.addEventListener('pointerleave',disarm,true);
    el.ck.addEventListener('click', e=>{ if(fired){ fired=false; e.stopPropagation(); e.preventDefault(); } }, true); })();
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