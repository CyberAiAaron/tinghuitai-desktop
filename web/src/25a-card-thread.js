  // ===== 每张卡下面的对话框（第③批，Aaron 2026-09-22）=====
  // 折叠态只有一个单行输入框，没有标签；有消息后显示消息列（你在右、agent 在左），发出去以后显示进行中，能再发一句。
  // 一条消息 = 服务端起一次本机 claude -p（app/card-thread.js）。线程存在会话文件 threads:{cardId:[...]}，回看页也能读。
  // 「你直接帮我安排去约了」→ agent 回「是不是约这几位：…？」→ 你回「是」→ 它去建日历 / 发消息 / 建任务。
  const threadDrafts = new Map(), threadPending = new Set();
  let threadsSyncedFor = '';
  // 老条目没有 id：拿正文算一个稳定的键（只含字母数字，服务端路径参数认这个）
  function threadKey(id, text){ if (id) return String(id); let h = 5381; const s = String(text||''); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 't' + h.toString(36); }
  function threadMsgs(key){ const t = cur && cur.threads && cur.threads[key]; return Array.isArray(t) ? t : []; }
  function threadHtml(id, kind, text){
    if (!cur) return '';
    const key = threadKey(id, text), msgs = threadMsgs(key), busy = threadPending.has(key);
    const rows = msgs.map(m => `<div class="th-msg ${m.role==='user'?'me':'ai'}${m.error?' err':''}">${esc(m.text||'')}</div>`).join('')
      + (busy ? `<div class="th-msg ai wait" aria-label="${ui==='en'?'Working':'在做了'}"><span></span><span></span><span></span></div>` : '');
    const draft = threadDrafts.get(key) || '';
    return `<div class="thread${msgs.length||busy?' open':''}" data-card-id="${esc(key)}" data-card-kind="${esc(kind||'')}" data-card-text="${esc(String(text||'').slice(0,800))}">${rows}<input class="th-in" type="text" autocomplete="off" enterkeyhint="send" value="${esc(draft)}"${busy?' disabled':''} aria-label="${ui==='en'?'Message about this card':'对这张卡说一句'}"></div>`;
  }
  async function threadSend(box){
    if (!cur) return;
    const key = box.dataset.cardId, input = box.querySelector('.th-in');
    const text = String(input && input.value || '').trim();
    if (!text || threadPending.has(key)) return;
    const sid = cur.id;
    cur.threads = cur.threads || {};
    const list = cur.threads[key] = Array.isArray(cur.threads[key]) ? cur.threads[key] : [];
    list.push({ role: 'user', text, at: Date.now() });
    threadDrafts.delete(key); threadPending.add(key); persist(); resetSigs(); render();
    try {
      const r = await fetch(relayBase()+'/thread/'+encodeURIComponent(sid)+'/'+encodeURIComponent(key)+'?token='+encodeURIComponent(cfg.relayToken||''),
        { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text, card:{ kind: box.dataset.cardKind||'', text: box.dataset.cardText||'' } }), signal: AbortSignal.timeout(200000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !j.reply) throw new Error(j.error || ('HTTP '+r.status));
      if (cur && String(cur.id) === String(sid)) { cur.threads = cur.threads || {}; cur.threads[key] = Array.isArray(j.messages) && j.messages.length ? j.messages : [...list, { role:'agent', text: j.reply||'', at: Date.now() }]; }
    } catch(e) {
      if (cur && String(cur.id) === String(sid)) list.push({ role:'agent', text:(ui==='en'?'Not done: ':'没做成：')+(e.name==='TimeoutError'?(ui==='en'?'no reply in time':'等太久没回'):(e.message||e)), at: Date.now(), error:'net' });
    } finally {
      threadPending.delete(key);
      if (cur && String(cur.id) === String(sid)) { persist(); resetSigs(); render(); const again = document.querySelector(`.thread[data-card-id="${CSS.escape(key)}"] .th-in`); if (again) again.focus(); }
    }
  }
  // 回看 / 刷新后把服务端那份线程接回来（浏览器本地那份可能没带）
  async function threadSync(){
    if (!cur || !cur.id || threadsSyncedFor === String(cur.id) || cur.id === 'view') return;
    threadsSyncedFor = String(cur.id);
    if (!cfg.relayToken && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
    try {
      const r = await fetch(relayBase()+'/thread/'+encodeURIComponent(cur.id)+'?token='+encodeURIComponent(cfg.relayToken||''), { cache:'no-store', signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const j = await r.json(); if (!j || !j.threads || String(cur.id) !== threadsSyncedFor) return;
      const merged = { ...(cur.threads||{}) };
      for (const [k, v] of Object.entries(j.threads)) if (Array.isArray(v) && v.length >= (Array.isArray(merged[k]) ? merged[k].length : 0)) merged[k] = v;
      if (JSON.stringify(merged) !== JSON.stringify(cur.threads||{})) { cur.threads = merged; persist(); resetSigs(); render(); }
    } catch(e) {}
  }
  function applyThreadMsg(m){ if (!cur || !m || !m.cardId) return; cur.threads = cur.threads || {}; if (Array.isArray(m.messages) && !threadPending.has(m.cardId)) { cur.threads[m.cardId] = m.messages; persist(); resetSigs(); render(); } }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.classList || !e.target.classList.contains('th-in')) return;
    e.preventDefault(); const box = e.target.closest('.thread'); if (box) threadSend(box);
  });
  document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('th-in')) { const box = e.target.closest('.thread'); if (box) threadDrafts.set(box.dataset.cardId, e.target.value); } });
  setInterval(() => { try { threadSync(); } catch(e){} }, 1500);
