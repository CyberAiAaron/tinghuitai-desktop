  // ===== 主动智能批 3：洞察卡上的那一个按钮（点 = 批准，服务端替他做） =====
  // POST /insight-action {id, cardId, do, args, confirmed:true[, retryConfirmed]}；执行态由 ws {type:'insightAction'} 推回来（applyInsightAction）。
  // set_date 先问两句（负责人默认承诺人、截止默认今天 +7），按取消就什么都不发。旁听（viewOnly）不出按钮动作。
  function insightCardOf(node){ const c=node.closest('.card.ck'); if(!c||!cur) return null; const id=c.dataset.id; return (cur.factchecks||[]).find(x=>id&&x.id===id)||null; }
  function shDate(plus){ const d=new Date(Date.now()+8*3600e3+(plus||0)*86400e3); return d.toISOString().slice(0,10); }
  async function insightPost(body){
    const r=await fetch(relayBase()+'/insight-action?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
    let j=null; try{ j=await r.json(); }catch(e){}
    if(!j) throw Error(ui==='en'?'No reply from Mac':'Mac 没有回应');
    return j;
  }
  function applyInsightAction(m){
    if(!cur||!m||!m.cardId) return;
    const it=(cur.factchecks||[]).find(x=>x.id===m.cardId); if(!it) return;
    if(m.state){ if(m.state.do==='one_pager') it.onePager=m.state; else it.actionState=m.state; }
    if(m.card){ for(const k of ['correction','quote','doc','task','onePager']) if(m.card[k]!==undefined&&m.card[k]!==null) it[k]=m.card[k]; }
    persist(); resetSigs(); render();
  }
  async function insightRun(it, doAct, args, retry){
    if(!cur||!cur.id) return;
    const body={id:cur.id,cardId:it.id,do:doAct,args:args||{},confirmed:true};
    if(retry==='confirm') body.retryConfirmed=true;
    const pager=doAct==='one_pager'; const setSt=v=>{ if(pager) it.onePager=v; else it.actionState=v; };
    setSt({status:'queued',do:doAct,at:Date.now()}); resetSigs(); render();
    try{
      const j=await insightPost(body);
      if(j.state) setSt(j.state);
      if(j.card){ for(const k of ['correction','quote','doc','task','onePager']) if(j.card[k]!==undefined&&j.card[k]!==null) it[k]=j.card[k]; }
      if(!j.ok&&!j.state) setSt({status:'failed',do:doAct,at:Date.now(),error:j.error||'',uncertain:!!j.uncertain});
    }catch(e){ setSt({status:'failed',do:doAct,at:Date.now(),error:e.message||String(e)}); }
    persist(); resetSigs(); render();
  }
  el.ck.addEventListener('click', async e=>{
    const b=e.target.closest('button'); if(!b) return;
    // 批 4：纠错单是本机文件，链接 = relayBase()/one-pager?id&card + 口令（data-path），不是外网 URL
    if(b.classList.contains('insight-open')){ e.stopPropagation(); const url=b.dataset.path?(relayBase()+'/'+b.dataset.path+'&token='+encodeURIComponent(cfg.relayToken||'')):(b.dataset.url||''); if(!url) return; let abs=''; try{ abs=new URL(url,location.href).href; }catch(err){ return; } window.open(abs,'_blank','noopener'); return; }
    if(b.classList.contains('insight-cancel')){ e.stopPropagation(); const it=insightCardOf(b); if(!it) return; try{ await insightPost({id:cur.id,cardId:it.id,do:'cancel'}); }catch(err){} return; }
    if(!b.classList.contains('insight-act')) return;
    e.stopPropagation();
    if(cur&&cur.viewOnly){ alert(ui==='en'?'View-only: only Aaron can run this.':'旁听只能看，动作要 Aaron 本人点。'); return; }
    const it=insightCardOf(b); if(!it) return;
    const d=b.dataset.do||''; let args={};
    // offer 态的「照会上说的新建」：沿用上次填的负责人 / 截止（服务端存在 actionState.args），只加 createIfMissing，不再弹两句
    if(b.dataset.create==='1'){ args={...((it.actionState&&it.actionState.args)||{}),createIfMissing:true}; await insightRun(it,d,args,''); return; }
    if(d==='set_date'){
      const a=(it.action&&it.action.args)||{};
      const owner=prompt(ui==='en'?'Owner (default: the person who promised):':'负责人（默认承诺人，留空 = 建给我自己）：', a.owner||a.who||''); if(owner===null) return;
      const due=prompt(ui==='en'?'Due date (YYYY-MM-DD):':'截止日期（YYYY-MM-DD）：', shDate(7)); if(due===null) return;
      args={owner:owner.trim().slice(0,60),due:due.trim().slice(0,10)};
    }
    await insightRun(it,d,args,b.dataset.retry||'');
  }, true);
