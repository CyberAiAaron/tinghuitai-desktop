  // ===== 布局：只按方向/宽度决定三栏或单栏，标签切换独立于布局 =====
  let activeTab = 'tr';
  function applyTab(){
    document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === activeTab)));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.p === activeTab));
  }
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.p; applyTab(); });
  applyTab();
  document.querySelectorAll('#ui-lang button').forEach(btn => btn.onclick = () => {
    const want = btn.dataset.ui; if (want === ui) return;   // 点已选中的一档 = 不做事
    ui = want;
    try { localStorage.setItem('tht-ui', ui); } catch(e){}
    try { if (!localStorage.getItem('tht-tongue')) el.tongue.value = defaultTongueForUi(); } catch(e){}
    if(cur&&!cur.viewOnly){cur.uiLang=ui;persist();}
    applyI18n();
    if (running && asrMode && asrWs?.readyState===1) { asrWs.send(JSON.stringify({type:'uiLanguage',language:ui})); }
    note(ui === 'en' ? I18N.en.uiSwitched : '界面已切到中文，之后新产生的要点和待核查会用中文。');
    setTimeout(()=>note(''), 3500);
    translateSession();                                     // 已攒下的条目按需回译（只跑一次，结果缓存）
  });
