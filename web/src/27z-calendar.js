  // ===== 参会人校准 + 静默纠名（2026-09-22 第①批）=====
  // 转写列顶部一行「📅 会议标题 · N 人」：点开看参会人名单、「换一场」下拉挑同一天别的日程（POST /live-calendar）。
  // 转写列底部一行灰字「已自动纠 N 处 · 撤销」：服务端按参会人 + 团队名单静默改过的人名，点撤销整体还原并让服务端记住不再这么改。
  let calSig = '', calOpen = false;
  const calBar = $('#cal-bar'), nfBar = $('#namefix-bar');
  const calT = (zh, en) => ui === 'en' ? en : zh;
  const calClock = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toTimeString().slice(0, 5) : ''; };
  function renderCalendar(){
    if (!calBar || !nfBar) return;
    const c = cur && cur.calendar, live = !!cur && !cur.end && (running || (cur.viewOnly && viewLive));
    const n = cur && cur.nameFixCount || 0;
    const sig = JSON.stringify([cur && cur.id, c, n, live, calOpen, ui]);
    if (sig === calSig) return; calSig = sig;
    if (!cur || (!c && !live)) calBar.hidden = true;
    else if (!c || !c.matchedAt) { calBar.hidden = false; calBar.innerHTML = `<span class="cal-muted">📅 ${calT('正在对日历…', 'Matching calendar…')}</span>`; }
    else {
      calBar.hidden = false;
      const others = (c.dayEvents || []).filter(e => e.eventId !== c.eventId);
      const pick = live ? `<select id="cal-pick" class="cal-pick"><option value="">${calT('换一场…', 'Switch…')}</option>${others.map(e => `<option value="${esc(e.eventId)}">${esc(calClock(e.start))} ${esc(e.title || '(无标题)')}</option>`).join('')}${c.eventId ? `<option value="none">${calT('不是日历上的会', 'Not on calendar')}</option>` : ''}</select>` : '';
      if (!c.title) calBar.innerHTML = `<span class="cal-muted">📅 ${calT('未匹配到日历', 'No calendar match')}</span>${pick}`;
      else {
        const people = c.attendees || [];
        calBar.innerHTML = `<button type="button" class="cal-head" data-cal-toggle aria-expanded="${calOpen}">📅 ${esc(c.title)} · ${people.length} ${calT('人', people.length === 1 ? 'person' : 'people')}${c.confidence === 'low' ? `<span class="cal-muted"> · ${calT('猜的', 'guess')}</span>` : ''} <span class="cal-caret">${calOpen ? '▾' : '▸'}</span></button>${pick}`
          + (calOpen ? `<div class="cal-people">${people.length ? people.map(p => `<span class="cal-person${p.declined ? ' declined' : ''}">${esc(p.name)}</span>`).join('') : `<span class="cal-muted">${calT('日历里读不到参会人', 'Attendees not readable')}</span>`}</div>` : '');
      }
    }
    nfBar.hidden = !n;
    if (n) nfBar.innerHTML = `${calT('已自动纠 ' + n + ' 处', 'Auto-fixed ' + n + ' name' + (n > 1 ? 's' : ''))} · <a href="#" data-namefix-undo>${calT('撤销', 'Undo')}</a>`;
  }
  if (calBar) calBar.addEventListener('click', e => { if (e.target.closest('[data-cal-toggle]')) { calOpen = !calOpen; renderCalendar(); } });
  if (calBar) calBar.addEventListener('change', async e => {
    const sel = e.target.closest('#cal-pick'); if (!sel || !sel.value || !cur) return;
    const eventId = sel.value; sel.disabled = true;
    try {
      const r = await fetch(relayBase() + '/live-calendar?token=' + encodeURIComponent(cfg.relayToken || ''), { method: 'POST', headers: { 'content-type': 'application/json', 'x-tht-token': cfg.relayToken || '' }, body: JSON.stringify({ id: cur.id, eventId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) note((j && j.error) || calT('换日程没成功', 'Could not switch event'), true);
      else { cur.calendar = j.calendar; persist(); renderCalendar(); }
    } catch (err) { note(calT('换日程没成功：', 'Could not switch event: ') + err.message, true); }
    finally { sel.disabled = false; }
  });
  if (nfBar) nfBar.addEventListener('click', e => {
    if (!e.target.closest('[data-namefix-undo]')) return; e.preventDefault();
    const w = (asrWs && asrWs.readyState === 1) ? asrWs : (viewWs && viewWs.readyState === 1 ? viewWs : null);
    if (!w) { note(calT('没连上 Mac，撤不了', 'Not connected to the Mac'), true); return; }
    try { w.send(JSON.stringify({ type: 'namefix_undo' })); } catch (err) {}
  });
  // 服务端消息 → 本场对象。final 帧带 seg（服务端条目号），撤销时按它找回那一句。
  function applyCalendarMsg(m){
    if (!cur) return;
    if (m.type === 'calendar') { cur.calendar = m.calendar || null; persist(); renderCalendar(); }
    else if (m.type === 'namefix') { cur.nameFixCount = m.count || 0; persist(); renderCalendar(); }
    else if (m.type === 'namefix_undone') {
      for (const it of m.items || []) { const row = (cur.transcript || []).find(x => x && x.seg === it.seg); if (row) row.text = it.text; }
      cur.nameFixCount = 0; persist(); resetSigs(); render();
    }
  }
