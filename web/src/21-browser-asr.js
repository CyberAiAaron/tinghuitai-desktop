  // ===== 浏览器识别 =====
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function makeRec(){
    if (!SR) { note('这个浏览器不支持语音识别，改用「输入法听写」或火山模式。', true); return null; }
    const r = new SR(); r.lang = srLang(); r.continuous = true; r.interimResults = true;
    r.onresult = ev => { let fin = ''; interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t.trim() + ' '; else interim += t; } fin = fin.trim(); if (fin && fin !== lastFinal) { lastFinal = fin; cur.transcript.push({at: Date.now(), t: Math.round((Date.now()-cur.start)/1000), text: fin, spk:''}); persist(); } render(); };
    r.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { note('麦克风被拒绝。地址栏左侧图标 → 权限 → 麦克风 → 允许。', true); stopAll(false); } else if (ev.error === 'network') note('识别服务连不上。', true); };
    r.onend = () => { if (running && !imeMode && !asrMode) setTimeout(()=>{ try { rec.start(); } catch(e){} }, 250); };
    return r;
  }
  async function keepAwake(){ try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch(e){} }
  document.addEventListener('visibilitychange', () => { if (!running) return; if (document.visibilityState === 'visible') { keepAwake();if(asrCtx?.state==='suspended')asrCtx.resume().catch(e=>note('请点页面恢复采音：'+e.message,true)); } else if (/Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) note('保持页面在前台、设备唤醒；锁屏或切换 app 可能暂停采音。',true); });
