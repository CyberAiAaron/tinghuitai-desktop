  // ===== 有新版就在右下角提示，点一下就地更新（只换程序，凭据和会议不动）=====
  (function updater(){
    const bar=$('#upd'); if(!bar) return;
    const skipKey='tht-skip-version';
    let latest='';
    const show=(txt,canGo)=>{ $('#upd-txt').textContent=txt; $('#upd-go').hidden=!canGo; bar.hidden=false; };
    $('#upd-x').onclick=()=>{ try{ if(latest) localStorage.setItem(skipKey,latest); }catch(e){} bar.hidden=true; };
    $('#upd-go').onclick=async()=>{
      const go=$('#upd-go'), x=$('#upd-x');
      go.disabled=true; x.disabled=true;
      show(ui==='en'?'Updating…':'正在更新，别关页面…',true);
      try{
        const r=await fetch(relayBase()+'/update?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(300000)});
        const j=await r.json();
        if(!j.ok) throw new Error(j.error||('HTTP '+r.status));
        show(ui==='en'?('Updated to '+j.version+'. Quit and reopen 启动.command.'):('已更新到 '+j.version+'。关掉这个页面，重新双击「启动.command」就好。'),false);
        $('#upd-x').disabled=false;
      }catch(e){
        show((ui==='en'?'Update failed: ':'没更新成：')+(e.message||e),true);
        go.disabled=false; x.disabled=false;
      }
    };
    async function check(){
      if(!macOnline) return;
      try{
        const r=await fetch(relayBase()+'/update?token='+encodeURIComponent(cfg.relayToken||''),{cache:'no-store',signal:AbortSignal.timeout(20000)});
        const j=await r.json();
        if(!j.ok||!j.hasUpdate) return;
        latest=j.latest;
        let skipped=''; try{ skipped=localStorage.getItem(skipKey)||''; }catch(e){}
        if(skipped===latest) return;
        show((ui==='en'?('New version '+j.latest+' is available. '):('有新版本 '+j.latest+'。'))+(j.notes?j.notes.slice(0,60):''),true);
      }catch(e){}
    }
    setTimeout(check,8000);                 // 开页面 8 秒后悄悄查一次
    setInterval(check,6*60*60*1000);        // 之后每 6 小时查一次

    // 「更多 → 检查更新」：随时能主动看，不用等提示条
    let info=null;
    // 服务端不是每次都回 JSON：连到旧版服务时它回的是 404 + 「not found」，
    // 直接 r.json() 会抛「Unexpected token 'o'」——用户看到一句天书，我也查不出他连的是哪台。
    // 所以先读文本，再决定怎么说，并且把 HTTP 码和地址带出来。
    async function readJSON(r, url, what){
      const text = await r.text();
      try { return JSON.parse(text); } catch (e) {}
      const host = (()=>{ try { return new URL(url, location.href).host; } catch(e){ return url; } })();
      if (r.status === 404)
        throw new Error(ui==='en'
          ? `this window is talking to an older service at ${host}, which has no ${what}. Open Meeting LiveMate from the app or 启动.command.`
          : `这个窗口连的是 ${host} 上的旧版服务，它没有「${what}」这个功能。请从听会台 App 或 启动.command 打开。`);
      throw new Error(ui==='en' ? `${host} replied HTTP ${r.status}` : `${host} 回了 HTTP ${r.status}`);
    }
    async function load(){
      const now=$('#upd-now'), body=$('#upd-body'), doBtn=$('#upd-do'), st=$('#upd-state');
      now.textContent=ui==='en'?'Checking…':'正在检查…'; body.innerHTML=''; doBtn.hidden=true; st.textContent='';
      try{
        const url=relayBase()+'/update?token='+encodeURIComponent(cfg.relayToken||'');
        const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(30000)});
        info=await readJSON(r, url, ui==='en'?'update check':'检查更新');
        if(!info.ok) throw new Error(info.error||'检查失败');
        now.textContent=(ui==='en'?'Installed: ':'当前版本 ')+info.current+(info.latest?((ui==='en'?'　Latest: ':'　最新 ')+info.latest):'');
        if(info.hasUpdate){
          body.innerHTML='<h4>'+esc(info.latest)+(info.released?('　'+esc(info.released)):'')+'</h4><div>'+esc(info.notes||'')+'</div>';
          doBtn.hidden=false; latest=info.latest;
        }else{
          body.innerHTML='<div>'+(ui==='en'?'You are on the latest version.':'已经是最新版本了。')+'</div>';
        }
        // P-20：备份可能停在好几个版本之前（拷贝安装那几次没走更新流程），按钮上要写清楚退到哪、退掉几版
        const back=$('#upd-back'), pi=info.prevInfo||{};
        if(info.prev){
          back.hidden=false; back.textContent=(ui==='en'?'Roll back to ':'回到 ')+info.prev;
          if(pi.stale) body.insertAdjacentHTML('beforeend','<div class="warn">'+esc(ui==='en'
            ? ('The rollback snapshot is '+info.prev+', '+pi.gap+' versions behind — rolling back undoes everything since.')
            : ('可回退的备份是 '+info.prev+'，比现在落后 '+pi.gap+' 个版本；回退会退掉这中间所有改动。'))+'</div>');
        }
        else back.hidden=true;
      }catch(e){ const offline=e instanceof TypeError || /failed to fetch|load failed/i.test(e.message||''); now.textContent=offline?(ui==='en'?'Cannot reach the meeting service. Open Meeting LiveMate or double-click 启动.command, then check again.':'连接不到听会台服务。请打开 Meeting LiveMate，或双击「启动.command」，再重新检查。'):(ui==='en'?'Check failed: ':'检查失败：')+(e.message||e); }
    }
    $('#m-update').onclick=()=>{ closeSheets(); $('#meeting-more-dialog').close(); $('#upd-dlg').showModal(); load(); renderLog(); };
    // L-19：正在录音时更新会把这场会打断，服务端本来就会拒（409），但按钮还亮着、点了才知道。
    // 现在直接停用，并写清楚为什么、什么时候能点。
    function updGate(){
      const on = !!running, doBtn=$('#upd-do'), back=$('#upd-back'), st=$('#upd-state');
      if(doBtn){ doBtn.disabled = on; }
      if(back){ back.disabled = on; }
      if(on && st && !st.dataset.busy) st.textContent = ui==='en' ? 'Recording — finish this meeting first; updating now would cut it off.' : '正在录音，先结束这场会再更新（现在更新会把这场打断）。';
    }
    setInterval(()=>{ const d=$('#upd-dlg'); if(d&&d.open) updGate(); }, 1000);
    $('#upd-recheck').onclick=load;
    $('#upd-back').onclick=async()=>{
      const back=$('#upd-back'), st=$('#upd-state');
      const tv=(info&&info.prev)||'', gap=((info&&info.prevInfo)||{}).gap||0;
      if(!confirm(ui==='en'
        ? ('Roll back to '+(tv||'the previous version')+(gap>1?(' ('+gap+' versions back)'):'')+'? Your settings and meetings are not touched.')
        : ('回到 '+(tv||'上一版')+(gap>1?('（往回退 '+gap+' 个版本）'):'')+'？你的凭据和会议记录不会动。'))) return;
      back.disabled=true; st.textContent=ui==='en'?'Rolling back…':'正在回退…';
      try{
        const r=await fetch(relayBase()+'/update-rollback?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(300000)});
        const j=await r.json();
        if(!j.ok) throw new Error(j.error||('HTTP '+r.status));
        back.hidden=true;
        if(j.restarting) await waitRestart(j.version); else st.textContent=(ui==='en'?('Back on '+j.version+'. Quit and reopen 启动.command.'):('已回到 '+j.version+'。关掉页面，重新双击「启动.command」就好。'));
      }catch(e){ st.textContent=(ui==='en'?'Failed: ':'没回成：')+(e.message||e); back.disabled=false; }
    };
    $('#upd-do').onclick=async()=>{
      const doBtn=$('#upd-do'), st=$('#upd-state');
      doBtn.disabled=true; st.textContent=ui==='en'?'Updating, keep this page open…':'正在更新，别关这个页面…';
      try{
        const r=await fetch(relayBase()+'/update?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(300000)});
        const j=await r.json();
        if(!j.ok) throw new Error(j.error||('HTTP '+r.status));
        doBtn.hidden=true; bar.hidden=true;
        if(j.restarting) await waitRestart(j.version); else st.textContent=ui==='en'?('Updated to '+j.version+'. Quit and reopen 启动.command.'):('已更新到 '+j.version+'。关掉页面，重新双击「启动.command」就好。');
      }catch(e){ st.textContent=(ui==='en'?'Failed: ':'没更新成：')+(e.message||e); doBtn.disabled=false; }
    };
    // L-19：服务端更新完会自己重启（见 server.js relaunchAfterUpdate），这里只负责等它活过来再刷新页面。
    // 等不到也要说人话，不把用户晾在「正在重启…」上。
    async function waitRestart(want){
      const st=$('#upd-state'); if(st){st.dataset.busy='1';st.textContent=ui==='en'?'Restarting the service…':'正在重启听会台…';}
      const deadline=Date.now()+60000;
      while(Date.now()<deadline){
        await new Promise(r=>setTimeout(r,2000));
        try{
          const r=await fetch(relayBase()+'/health',{cache:'no-store',signal:AbortSignal.timeout(2000)});
          const j=await r.json();
          if(j&&j.ok&&(!want||j.version===want)){ if(st)st.textContent=ui==='en'?'Restarted. Reloading…':'重启好了，正在刷新…'; setTimeout(()=>location.reload(),600); return; }
        }catch(e){}
      }
      if(st){st.dataset.busy='';st.textContent=ui==='en'?'It did not come back on its own. Double-click 启动.command.':'它没能自己起来，双击一次「启动.command」就好。';}
    }
    async function renderLog(){
      const box=$('#upd-log'); if(!box||box.dataset.loaded) return;
      box.textContent=ui==='en'?'Loading…':'读取中…';
      try{
        const curl=relayBase()+'/changelog?token='+encodeURIComponent(cfg.relayToken||'');
        const r=await fetch(curl,{cache:'no-store',signal:AbortSignal.timeout(20000)});
        const j=await readJSON(r, curl, ui==='en'?'changelog':'更新日志');
        if(!j.ok||!j.items||!j.items.length) throw new Error(j.error||'暂无');
        box.innerHTML=j.items.map(x=>'<h4>'+esc(x.version)+(x.released?('　'+esc(x.released)):'')+'</h4><div>'+esc(x.notes||'')+'</div>').join('');
        box.dataset.loaded='1';
      }catch(e){ box.textContent=(ui==='en'?'Changelog unavailable: ':'读不到更新日志：')+(e.message||e); }
    }
  })();
