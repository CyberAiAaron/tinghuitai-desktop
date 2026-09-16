  // ===== 输入法听写 =====
  let imeUsed = 0, imeLastLen = 0, imeLastChange = 0;
  const imeIngest = (force) => { const ta = $('#ime'); if (!cur) return; const v = ta.value; if (v.length !== imeLastLen) { imeLastLen = v.length; imeLastChange = Date.now(); if (!force) return; } if (v.length > imeUsed && (force || Date.now() - imeLastChange >= 2500)) { const seg = v.slice(imeUsed).trim(); imeUsed = v.length; if (seg) { cur.transcript.push({at: Date.now(), t: Math.round((Date.now()-cur.start)/1000), text: seg, spk:''}); persist(); render(); } } };
