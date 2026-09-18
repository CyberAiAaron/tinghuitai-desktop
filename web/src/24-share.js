  // 导出与面板共用同一可见看法集合：旧数据里「无法核实」类条目面板不显示，导出也不带（0.6.14）
  const visibleViews=()=>((cur&&cur.factchecks)||[]).filter(x=>!viewJunk(x));
  // ===== 分享 / 导出 =====
  const fullText = () => cur ? `【听会台】${cur.title||''}｜${new Date(cur.start).toLocaleString()}｜${fmt(Math.round(((cur.end||Date.now())-cur.start)/1000))}\n\n` + (cur.summary?`收尾总结：\n${cur.summary}\n\n`:'') + (cur.highlights.length||cur.todos.length?`会中提醒（要点 ${cur.highlights.length} · 待办 ${cur.todos.length}）：\n${[...cur.highlights.map(x=>'· '+x.text), ...cur.todos.map(x=>'☐ '+x.text+(x.owner?' → '+x.owner:''))].join('\n')}\n\n`:'') + (visibleViews().length?`看法（${visibleViews().length} 条）：\n${visibleViews().map(x=>`? ${x.claim}  [${kindLabel(kindOf(x),false,x)}]${x.note?' '+x.note:''}`).join('\n')}\n\n`:'') + `转写全文：\n` + cur.transcript.map(x=>`[${hms(x.at)}]${x.spk?' '+spkName(x.spk)+':':''} ${x.text}`).join('\n') : '';
  const vLabel = v => v==='true'?'大概率对':v==='false'?'可能有误':'拿不准';
  const dtStr = () => `${new Date(cur.start).toLocaleString('zh-CN')}　·　${fmt(Math.round(((cur.end||Date.now())-cur.start)/1000))}　·　${cur.transcript.length} 句`;
  function mdText(localized=true){
    if(!cur)return '';const en=localized&&ui==='en',t=localized?tt:x=>x||'',cell=x=>String(x||'').replace(/\|/g,'/').replace(/\n/g,'<br>');const L=[`# ${cur.title||(en?'Meeting minutes':'会议纪要')}`,'',dtStr(),''];
    if(cur.summary)L.push(en?'## Summary':'## 收尾总结','',t(cur.summary),'');
    if(cur.highlights.length){L.push(en?'## Notes':'## 要点','');cur.highlights.forEach(x=>L.push('- '+t(x.text)));L.push('');}
    if(cur.todos.length){L.push(en?'## Tasks':'## 待办','');cur.todos.forEach(x=>L.push(`- [${x.done?'x':' '}] ${t(x.text)}${x.owner?' → '+t(x.owner):''}`));L.push('');}
    if(visibleViews().length){L.push(en?'## Views · checked against project state':'## 看法 · 对照项目状态','',en?'| Kind | Claim | Why | Quote | Rated |':'| 类型 | 说法 | 为什么 | 原话 | 反馈 |','| --- | --- | --- | --- | --- |');visibleViews().forEach(x=>L.push(`| ${kindLabel(kindOf(x),en,x)} | ${cell(t(x.claim))} | ${cell(t(x.note))} | ${cell(x.evidence||'')} | ${cell((x.rating?({useful:en?'useful':'有用',useless:en?'useless':'没用',adopt:en?'adopted':'采纳'}[x.rating]||''):'')+(x.comment?' '+x.comment:''))} |`));L.push('');}
    L.push(en?'## Original transcript':'## 原始转写','');cur.transcript.forEach(x=>L.push(`**${hms(x.at)}**${x.spk?' '+spkName(x.spk):''} ${x.text}`,''));return L.join('\n');
  }
  function htmlDoc(){
    if (!cur) return '';
    const e = esc;
    const hl = [...cur.highlights.map(x=>({k:/^⚠️?\s*(冲突|Conflict)/i.test(x.text)?'conf':'hl', t:tt(x.text)})), ...cur.todos.map(x=>({k:'todo', t:tt(x.text) + (x.owner?'　→ '+tt(x.owner):'')}))];
    return `<!doctype html><html lang="${ui==='en'?'en':'zh-CN'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(cur.title||'会议纪要')}</title><style>
:root{--bg:#f5f5f7;--card:#fff;--line:#e3e0da;--text:#1a1a18;--mute:#6b6660;--live:#C8102E;--conf:#c62828;--todo:#0f8f6f;--hl:#1f5fbf;--check:#c2472c;--ok:#1f8f4c;--warn:#b07600}
@media(prefers-color-scheme:dark){:root{--bg:#151516;--card:#202022;--line:#263029;--text:#e7ece9;--mute:#8a9690;--live:#C8102E;--conf:#ff6b6b;--todo:#4fc9a9;--hl:#9fc5ff;--check:#e0745a;--ok:#6fcf97;--warn:#C8102E}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 -apple-system,"PingFang SC","Noto Sans SC",system-ui,sans-serif}
.w{max-width:820px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:22px;margin:0 0 4px}.meta{color:var(--mute);font-size:13px;margin-bottom:22px;font-variant-numeric:tabular-nums}
h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.sum{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;white-space:pre-wrap}
ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px}
li{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:9px;padding:9px 12px}
li.conf{border-left-color:var(--conf);background:color-mix(in srgb,var(--conf) 8%,var(--card));font-weight:600}
li.todo{border-left-color:var(--todo)}li.hl{border-left-color:var(--hl)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:500}td.v{white-space:nowrap}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:5px;border:1px solid currentColor}
.tag.true{color:var(--ok)}.tag.false{color:var(--check)}.tag.unsure{color:var(--warn)}
details{margin-top:8px}summary{cursor:pointer;color:var(--mute);font-size:13px}
.tr{margin-top:12px;font:13.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
.tr p{margin:0 0 7px;display:grid;grid-template-columns:46px auto 1fr;gap:8px}
.tr time{color:var(--mute);font-size:11.5px;padding-top:3px}
.spk{font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;border:1px solid var(--line);color:var(--mute);white-space:nowrap;align-self:start;font-family:system-ui}
</style></head><body><div class="w">
<h1>${e(cur.title||'会议纪要')}</h1><div class="meta">${e(dtStr())}</div>
${cur.summary?`<h2>${ui==='en'?'Summary':'收尾总结'}</h2><div class="sum">${e(tt(cur.summary))}</div>`:''}
${hl.length?`<h2>${ui==='en'?'Notes & tasks':'要点与待办'} · ${hl.length}</h2><ul>${hl.map(x=>`<li class="${x.k}">${e(x.t)}</li>`).join('')}</ul>`:''}
${visibleViews().length?`<h2>${ui==='en'?'Views':'看法'} · ${visibleViews().length}</h2><table><tr><th>${ui==='en'?'Kind':'类型'}</th><th>${ui==='en'?'Claim':'说法'}</th><th>${ui==='en'?'Why':'为什么'}</th><th>${ui==='en'?'Quote':'原话'}</th><th>${ui==='en'?'Rated':'反馈'}</th></tr>${visibleViews().map(x=>`<tr><td class="v"><span class="tag ${e(kindOf(x))}">${e(kindLabel(kindOf(x),ui==='en',x))}</span></td><td>${e(tt(x.claim))}</td><td>${e(tt(x.note||''))}</td><td>${e(x.evidence||'')}</td><td>${e((x.rating?({useful:ui==='en'?'useful':'有用',useless:ui==='en'?'useless':'没用',adopt:ui==='en'?'adopted':'采纳'}[x.rating]||''):'')+(x.comment?' '+x.comment:''))}</td></tr>`).join('')}</table>`:''}
<h2>${ui==='en'?'Original transcript':'转写全文'} · ${cur.transcript.length}</h2>
<details open><summary>${ui==='en'?'Expand / collapse':'展开 / 收起'}</summary><div class="tr">${cur.transcript.map(x=>`<p><time>${hms(x.at).slice(0,5)}</time><span class="spk">${x.spk?e(spkName(x.spk)):'·'}</span><span>${e(x.text)}</span></p>`).join('')}</div></details>
</div></body></html>`;
  }
  const dl = (name, text, mime) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff'+text], {type:mime+';charset=utf-8'})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000); };
  const fileBase = () => `听会台_${(cur.title||'会议').slice(0,20).replace(/[\\/:*?"<>|]/g,'')}_${new Date(cur.start).toISOString().slice(0,10)}`;
  async function archiveTo(target, quiet){
    if (!cur) return false;
    if (!cfg.relayToken) { note(T('arch_notoken') || '还没填 Mac 中转口令，去设置里填一下。', true); return false; }
    if (!quiet) note(T('arch_wait') || '提交中……');
    try {
      const r = await fetch(`${relayBase()}/archive?token=${encodeURIComponent(cfg.relayToken)}`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({target, title: cur.title||'', md: mdText(false), session: cur})});
      const d = await r.json().catch(()=>({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
      if (!quiet) { note(T('arch_queued') || '已提交。Ark 建好会私聊你链接（一般 1-3 分钟）。'); setTimeout(()=>note(''), 5000); }
      return true;
    } catch(e){ note((T('arch_fail')||'失败：') + (e.message||e) + (T('arch_fail2')||'（Mac 在线吗？）'), true); return false; }
  }
  // A single meeting library; originals and enhanced notes share one archive.
  let archiveJobs=[], archivePolling=false;
  let slackBundleKey='',larkBundleKey='',slackOpen=0,larkOpen=0;
  async function bundleAPI(path='',body){const r=await fetch(relayBase()+'/sharing/bundle'+path+(path.includes('?')?'&':'?')+'token='+encodeURIComponent(cfg.relayToken||''),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error||'分享服务连接失败');return j;}
  async function waitBundle(key,field='status'){for(let n=0;n<600;n++){const j=await bundleAPI('?key='+key);if(j[field]==='done')return j;if(j[field]==='error')throw Error(j.error||'生成失败，请重新打开重试');await new Promise(r=>setTimeout(r,2000));}throw Error('仍在后台处理，可稍后重新打开查看');}
  async function prepareShare(){const session=JSON.parse(JSON.stringify({...cur,uiLang:ui}));const j=await bundleAPI('',{session});return waitBundle(j.key);}
  function shareFiles(selector,j){const el=$(selector);el.replaceChildren();for(const [field,label] of [['minutes','完整纪要.md'],['transcript','完整逐字稿.md']]){const a=document.createElement('a');a.textContent=label;a.style.marginRight='16px';a.href=relayBase()+'/sharing/bundle/file?key='+j.key+'&kind='+field+'&token='+encodeURIComponent(cfg.relayToken||'');a.download=label;el.append(a);}}
  $('#share-lark').onclick=async()=>{const seq=++larkOpen;$('#lark-share-dialog').showModal();larkBundleKey='';$('#lark-share-preview').replaceChildren();$('#lark-share-files').replaceChildren();$('#lark-share-link').hidden=true;$('#lark-share-create').disabled=true;$('#lark-share-status').textContent='正在整理分享总结与两份附件…';try{const j=await prepareShare();if(seq!==larkOpen)return;larkBundleKey=j.key;const el=$('#lark-share-preview'),b=j.bundle.brief;for(const [tag,text] of [['h3',b.title],['p',b.overview],...b.topics.flatMap(t=>[['h4',t.title],...t.points.map(x=>['p',x])]),...b.conclusions.map(x=>['p','结论：'+x]),...b.todos.map(x=>['p','待办：'+x])]){const e=document.createElement(tag);e.textContent=text;el.append(e);}shareFiles('#lark-share-files',j);$('#lark-share-status').textContent='总结和两份 MD 将放入新文档，默认仅自己可见。';$('#lark-share-create').disabled=false;}catch(e){$('#lark-share-status').textContent=e.message;}};
  $('#lark-share-create').onclick=async()=>{const key=larkBundleKey;if(!key)return;$('#lark-share-create').disabled=true;$('#lark-share-status').textContent='正在创建总结并插入附件…';try{await bundleAPI('/lark',{key});const j=await waitBundle(key,'larkStatus');if(key!==larkBundleKey)return;$('#lark-share-link').href=j.url;$('#lark-share-link').hidden=false;$('#lark-share-status').textContent='总结正文与两份附件已保存，文档仅自己可见。';}catch(e){$('#lark-share-status').textContent=e.message;}finally{if(key===larkBundleKey)$('#lark-share-create').disabled=false;}};
  async function slackAPI(action,body){const r=await fetch(relayBase()+'/sharing/slack/'+action+'?token='+encodeURIComponent(cfg.relayToken||''),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(j.needsConnection)$('#slack-connect').hidden=false;if(!r.ok){$('#slack-retry').hidden=!j.uncertain;throw Error(j.error);}$('#slack-retry').hidden=true;return j;}
  async function slackChannels(){const j=await slackAPI('channels');const select=$('#slack-channel');select.replaceChildren(new Option('自己 / Myself','self'));select.options[0].disabled=!j.selfAvailable;for(const c of j.channels){const o=new Option((c.private?'🔒 ':'# ')+c.name+(c.canSend===false?'（先邀请 Meeting LiveMate）':''),c.id);o.disabled=c.canSend===false;select.add(o);}select.value='self';if(!j.selfAvailable)throw Error('请在连接设置中添加个人 Slack 授权，启用发送给自己');return j;}
  $('#share-slack').onclick=async()=>{const seq=++slackOpen;$('#slack-dialog').showModal();slackBundleKey='';$('#slack-preview').value='';$('#slack-files').replaceChildren();$('#slack-send').disabled=true;$('#slack-status').textContent='正在整理总结并加载频道…';try{const [j,c]=await Promise.all([prepareShare(),slackChannels()]);if(seq!==slackOpen)return;slackBundleKey=j.key;$('#slack-preview').value=j.bundle.slackText;shareFiles('#slack-files',j);$('#slack-status').textContent=(c.team||'Slack')+' · 默认发送给自己，附两份 MD';$('#slack-send').disabled=false;}catch(e){$('#slack-status').textContent=e.message;}};
  $('#slack-settings').onclick=()=>{$('#slack-connect').hidden=!$('#slack-connect').hidden;};
  $('#slack-connect-do').onclick=async()=>{try{await slackAPI('connect',{token:$('#slack-token').value,userToken:$('#slack-user-token').value});$('#slack-token').value='';$('#slack-user-token').value='';$('#slack-connect').hidden=true;await slackChannels();const j=await prepareShare();slackBundleKey=j.key;$('#slack-preview').value=j.bundle.slackText;shareFiles('#slack-files',j);$('#slack-send').disabled=false;$('#slack-status').textContent='已连接 · 默认发送给自己';}catch(e){$('#slack-status').textContent=e.message;}};
  async function sendSlack(retryConfirmed=false){if(!slackBundleKey)return;const b=$('#slack-send');b.disabled=true;try{const j=await slackAPI('send',{channel:$('#slack-channel').value,text:$('#slack-preview').value,bundleKey:slackBundleKey,confirmed:true,retryConfirmed});$('#slack-status').textContent=j.alreadySent?'这份内容已发送，无需重复发送':'总结与两份 MD 已发送';}catch(e){$('#slack-status').textContent=e.message;}finally{b.disabled=false;}};
  $('#slack-send').onclick=()=>sendSlack();
  $('#slack-retry').onclick=()=>sendSlack(true);
  $('#b-this').onclick=()=>{closeSheets();$('#more-title').textContent=ui==='en'?'This meeting':'这场会';const nm=$('#this-name');if(nm){nm.textContent=cur?((cur.title||cur.name||'').trim()||(ui==='en'?'Current meeting':'当前这场')):(ui==='en'?'No meeting yet':'还没开始听会');}$('#meeting-more-dialog').showModal();};
  // 这两个按钮只是入口，真正的逻辑还在原来那两个（现已隐藏的）按钮上，不复制一份
  $('#m-notes').onclick=()=>{$('#meeting-more-dialog').close();$('#b-notes').onclick();};
  $('#m-sum').onclick=()=>{$('#meeting-more-dialog').close();$('#b-sum').onclick();};
  $('#m-arch').onclick=()=>{$('#meeting-more-dialog').close();$('#mk-doc').onclick();};
  $('#m-recovery').onclick=()=>{$('#meeting-more-dialog').close();$('#recording-recovery').onclick();};
  $('#meeting-more-dialog').addEventListener('click',e=>{if(e.target.closest('.meeting-more-menu button'))$('#meeting-more-dialog').close();});
  const archiveEnglish=()=>ui==='en';
  document.querySelectorAll('.archive-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  function renderArchive(){
    const en=archiveEnglish();
    $('#archive-title').textContent=en?'Meeting archive':'会议档案';
    const indexUrl=archiveJobs.slice().reverse().find(j=>j.indexUrl)?.indexUrl;$('#archive-home').hidden=!indexUrl;if(indexUrl)$('#archive-home').href=indexUrl;
    $('#archive-home').textContent=en?'Open Feishu meeting archive ↗':'打开飞书会议档案 ↗';
    $('#archive-hint').textContent=cur?.archiveDirty?(en?'Your edits are saved locally and awaiting archive sync.':'修改已存本机，正在等待同步到会议档案。'):en?'Full transcripts and summaries are archived after each meeting. Saved status requires a successful read-back.':'会议结束后自动保存全文和总结；显示“已归档”前会回读验证。';
    $('#archive-current').textContent=en?'Archive this meeting / Retry':'归档当前会议 / 重试';
    $('#archive-current').disabled=running||!cur?.transcript?.length;
    const phases={'等待整理':'Queued','保存转写全文':'Saving full transcript','本地转写与区分说话人':'Transcribing and separating speakers','整理智能总结':'Preparing summary','归档整理版':'Saving enhanced notes','更新会议档案':'Updating archive','已归档':'Archived','归档待重试':'Waiting to retry'};
    $('#archive-jobs').innerHTML=archiveJobs.length?archiveJobs.slice().reverse().map(j=>`<article><strong>${esc(j.title)}</strong><small>${esc(j.status==='empty'?(en?'No speech captured':'这场没有录到内容'):j.status==='partial'?((j.summaryGenerated&&j.fullTextVerified)?(en?'Archived · transcript has gaps':'已归档 · 转写有缺口'):(en?'Transcript archived · Review needed':'全文已归档 · 整理结果待核对')):(en?(phases[j.phase]||j.status):j.phase))}${j.speakerCount&&!j.speakerWarning?' · '+j.speakerCount+(en?' speaker groups':' 个声音组'):''}</small>${j.error?`<small>${esc(en?'Archiving failed. Original data is retained.':j.error)}</small>`:''}${j.speakerWarning?`<small>${esc(en?'Speaker labels need review.':j.speakerWarning)}</small>`:''}${j.hubSyncWarning?`<small>${esc(en?'Archive saved; workspace sync needs retry.':j.hubSyncWarning)}</small>`:''}${j.summaryWarning?`<small>${en?'Summary incomplete; transcript retained.':'总结未完成，全文已保留。'}</small>`:''}${(j.status==='error'||(j.status==='partial'&&!(j.summaryGenerated&&j.fullTextVerified)))?`<button class="btn sm" data-retry-archive="${esc(j.sessionId)}">${en?'Retry archive':'重试归档'}</button>`:''}${j.url&&j.fullTextVerified?`<a href="${esc(j.url)}" target="_blank" rel="noopener">${en?'Open full record ↗':'查看全文与总结 ↗'}</a>`:''}</article>`).join(''):`<p>${en?'No archived meetings yet.':'还没有新的归档记录。历史会议可打开后点“归档当前会议”。'}</p>`;
  }
  $('#archive-jobs').addEventListener('click',async e=>{const b=e.target.closest('[data-retry-archive]');if(!b)return;b.disabled=true;try{const r=await fetch(relayBase()+'/meeting-retry?token='+encodeURIComponent(cfg.relayToken||''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.retryArchive})});if(!r.ok)throw Error('retry failed');await refreshArchive();}catch{note(ui==='en'?'Retry failed; original data is retained.':'重试未成功，原始资料仍保留。',true);}finally{b.disabled=false;}});
  async function refreshArchive(){
    if(archivePolling||(!$('#meeting-archive').open&&!cur?.end))return;
    archivePolling=true;
    try{
      const r=await fetch(relayBase()+'/meeting-status?token='+encodeURIComponent(cfg.relayToken||''));if(!r.ok)throw Error('status');
      archiveJobs=(await r.json()).jobs||[];
      if(cur?.archiveAwaitingSince&&archiveJobs.some(j=>j.sessionId===cur.id)){cur.archiveAwaitingSince=0;persist();}if(cur?.end&&cur.archiveAwaitingSince&&Date.now()-cur.archiveAwaitingSince>130000&&!archiveJobs.some(j=>j.sessionId===cur.id)&&Date.now()>=(cur.archiveRetryAt||0)&&(cur.archiveRetryCount||0)<3){cur.pendingUpload=true;cur.archiveRetryCount=(cur.archiveRetryCount||0)+1;cur.archiveRetryAt=Date.now()+60000*Math.pow(2,cur.archiveRetryCount);persist();note(ui==='en'?'Archive not confirmed; retrying. Local transcript is retained.':'尚未确认归档，正在重试。本机转写已保留。',true);await uploadPending();}
      // status==='empty' 是终态（这场一个字都没转出来），重试不会有结果，别催人去点
      const failed=archiveJobs.find(j=>j.sessionId===cur?.id&&j.status==='error');if(failed)note(ui==='en'?'Archive incomplete. Open Meeting archive to retry.':'本场归档未完成，请打开「会议档案」重试。原始资料仍保留。',true);
      if($('#meeting-archive').open)renderArchive();
      const job=archiveJobs.find(j=>j.sessionId===cur?.id&&['done','partial'].includes(j.status));
      if(job&&!running&&cur.archiveVersion!==(job.key+':'+job.updated)){
        const sess=cur;const rr=await fetch(relayBase()+'/meeting-result?id='+encodeURIComponent(sess.id)+'&token='+encodeURIComponent(cfg.relayToken||''));
        if(rr.ok&&cur===sess){const result=await rr.json();
          if(result.transcript?.length&&!job.speakerWarning&&!sess.userCorrected){sess.transcript_realtime_backup=sess.transcript;sess.originalNames=sess.names;sess.transcript=result.transcript.map(x=>({...x,at:Number(x.at)>1e11?Number(x.at):Number(sess.start)+Number(x.at||0)*1000,spk:x.speaker||x.spk||''}));sess.names=result.names||{};}
          if(result.transcript?.length&&(sess.userCorrected||job.speakerWarning))note(ui==='en'?'Your current transcript is retained. The processed version is available in Meeting archive.':'已保留当前转写。整理版可在「会议档案」查看，未自动覆盖你的修改或采用不稳定分组。');
          if(result.summary)sess.summary=result.summary;sess.archiveVersion=job.key+':'+job.updated;sess.archiveUrl=job.url;persist();resetSigs();render();
        }
      }
    }catch{if($('#meeting-archive').open)$('#archive-jobs').textContent=archiveEnglish()?'Unable to reach Mac. Your local record is retained.':'暂时连不上 Mac，本机记录仍保留。';}
    finally{archivePolling=false;}
  }
  $('#mk-doc').onclick=()=>{if(!toggleDialog('#meeting-archive'))return;renderArchive();$('#meeting-archive').showModal();refreshArchive();};
  $('#archive-current').onclick=async()=>{const b=$('#archive-current');b.disabled=true;try{if(await archiveTo('local',true))await refreshArchive();}finally{b.disabled=running;}};
  $('#b-notes').onclick=()=>{if(!toggleDialog('#meeting-notes'))return;loadAssets();renderAnalysis();if(!cur){note(archiveEnglish()?'Start a meeting first.':'开始听会后即可记笔记。');return;}$('#personal-notes').value=cur.notes||'';$('#notes-title').textContent=archiveEnglish()?'Material':'补充材料';$('#notes-hint').textContent=archiveEnglish()?'Saved on this device as you type. Notes taken during the meeting are archived with it; the transcript stays unchanged.':'随手记重点。笔记自动保存在本机，会中笔记随会议归档；不会改写原话。';$('#meeting-notes').showModal();};