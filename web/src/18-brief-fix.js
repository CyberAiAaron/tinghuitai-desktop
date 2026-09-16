  // ===== 本场背景 + 纠错 =====
  let briefText = '', briefFix = '';
  try { briefText = localStorage.getItem('tht-brief') || ''; briefFix = localStorage.getItem('tht-brief-fix') || ''; } catch(e){}
  const parseFixes = (t) => String(t||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const m = l.split(/\s*(?:→|->|=>|=)\s*/); return (m.length>=2 && m[0] && m[1]) ? {wrong:m[0].trim(), right:m[1].trim()} : null;
  }).filter(Boolean);
  const briefWords = () => {
    const out = new Set();
    String(briefText||'').split(/[\n,，、；;]+/).forEach(x => {
      let t = x.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
      t = t.replace(/^(产品|公司|网站|参会人|人)\s*[:：]\s*/,'').trim();
      if (t.length >= 2 && t.length <= 24) out.add(t);
    });
    parseFixes(briefFix).forEach(f => out.add(f.right));
    return [...out];
  };
  const briefBlock = () => {
    const fx = parseFixes(briefFix);
    let b = '';
    if (effectiveBrief(cur).trim()) b += `【本场背景（人名/公司/网站，判断时以此为准）】\n${effectiveBrief(cur).trim()}\n\n`;
    if (fx.length) b += `【已确认的纠错（转写里出现左边的词，一律按右边理解，不要据此下结论）】\n${fx.map(f=>f.wrong+' → '+f.right).join('\n')}\n\n`;
    return b;
  };
  const allHotwords = () => [...new Set(((cfg.hotwords||'').split(/[,，\s]+/).filter(Boolean)).concat(briefWords()))].slice(0, 60);
  $('#b-brief').onclick = () => { $('#brief-text').value = briefText; $('#brief-fix').value = briefFix; $('#brief-msg').textContent = ''; openSheet('#sh-brief'); };
  $('#brief-save').onclick = () => {
    briefText = $('#brief-text').value; briefFix = $('#brief-fix').value;
    try { localStorage.setItem('tht-brief', briefText); localStorage.setItem('tht-brief-fix', briefFix); } catch(e){}
    if(cur){cur.brief=briefText;cur.fixes=parseFixes(briefFix);applyCorrections(cur);persist();resetSigs();render();syncCorrectionContext();}
    const n = briefWords().length;
    $('#brief-msg').textContent=ui==='en'?`Saved ${n} recognition hints. Corrections apply to this meeting.`:`已保存 ${n} 个识别热词，纠错已应用到本场。`;
  };

  function openFix(el0){
    const kind = el0.dataset.fix, key = el0.dataset.key;
    const d = $('#dlg-fix'); d.dataset.kind = kind; d.dataset.key = key;
    $('#fix-wrong').value = ''; $('#fix-right').value = '';
    $('#fix-why').value = ''; $('#fix-why-keep').checked = false;
    $('#fix-del').hidden=kind==='tr';
    if(kind==='tr'){const it=cur.transcript[Number(key)];if(!it)return;$('#fix-text').value=it.text;$('#fix-vrow').hidden=true;$('#fix-nrow').hidden=true;}
    else if (kind === 'ck') {
      const it = cur.factchecks.find(x => x.claim === key); if (!it) return;
      $('#fix-text').value = it.claim; $('#fix-verdict').value = it.verdict || 'unsure'; $('#fix-note').value = it.note || '';
      $('#fix-vrow').hidden = false; $('#fix-nrow').hidden = false;
    } else {
      const it = [...cur.highlights, ...cur.todos].find(x => x.text === key); if (!it) return;
      $('#fix-text').value = it.text; $('#fix-vrow').hidden = true; $('#fix-nrow').hidden = true;
    }
    // 一句话那一层：原文只读显示，输入框清空，细项收起来
    $('#fix-orig').textContent = $('#fix-text').value;
    $('#fix-say').value = '';
    $('#fix-say-msg').hidden = true; $('#fix-say-msg').textContent = '';
    $('#fix-detail').open = false;
    setFixMode('edit');
    $('#fix-say-row').classList.remove('busy');
    d.showModal(); setTimeout(()=>$('#fix-say').focus(), 50);
  }
