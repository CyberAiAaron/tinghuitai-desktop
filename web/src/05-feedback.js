  // ===== 反馈 / 联系开发者（独立版）：所有内容只发到开发者邮箱，处置权在开发者 =====
  const FB_MAIL='rangerAaronlol@gmail.com';
  let fbShot=null;
  const fbContext=()=>`\n\n—\nMeeting LiveMate 独立版 · ${new Date().toLocaleString('zh-CN')}\n${navigator.userAgent}\n界面语言 ${ui} · 会议模式 ${(el.lang&&el.lang.value)||'-'} · 当前${running?'录音中':'未录音'}`;
  const fbBody=()=>($('#fb-text').value.trim()||'（未填写文字）')+(fbShot?`\n[已保存截图 ${fbShot.name}，请拖入邮件附件]`:'')+fbContext();
  $('#b-feedback').onclick=()=>{$('#fb-msg').textContent='';$('#dlg-feedback').showModal();$('#fb-text').focus();};
  $('#fb-close').onclick=()=>$('#dlg-feedback').close();
  $('#fb-shot').onchange=e=>{const f=e.target.files&&e.target.files[0];fbShot=f?{name:f.name,file:f}:null;$('#fb-shot-hint').textContent=f?`已选 ${f.name}，发送时会先保存到本机。`:'邮件客户端不能自动带附件：选了截图会先保存到本机，发送时把它拖进邮件即可。';};
  $('#fb-text').addEventListener('paste',e=>{const it=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));if(!it)return;const f=it.getAsFile();if(!f)return;fbShot={name:'截图-'+Date.now()+'.png',file:f};$('#fb-shot-hint').textContent='已粘贴一张截图，发送时会先保存到本机。';});
  const fbSaveShot=()=>{if(!fbShot)return;const a=document.createElement('a');a.href=URL.createObjectURL(fbShot.file);a.download=fbShot.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);};
  $('#fb-mail').onclick=()=>{const body=fbBody();fbSaveShot();const subject='[Meeting LiveMate 反馈] '+($('#fb-text').value.trim().slice(0,40)||'问题反馈');location.href='mailto:'+FB_MAIL+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body.slice(0,1800));$('#fb-msg').textContent=body.length>1800?'已打开邮件；内容较长，请再点「复制反馈内容」粘贴全文。':'已打开邮件客户端。';};
  $('#fb-copy').onclick=async()=>{try{await navigator.clipboard.writeText(fbBody());$('#fb-msg').textContent='已复制，可粘贴到邮件或飞书。';}catch(e){$('#fb-msg').textContent='复制失败：'+(e.message||e);}};
  $('#fb-copy-mail').onclick=async()=>{try{await navigator.clipboard.writeText(FB_MAIL);$('#fb-msg').textContent='邮箱已复制。';}catch(e){}};
  // 「会议偏好」原来点开的就是设置对话框，和 ⚙︎ 同一个东西——重复入口，已撤。
  $('#gear2') && ($('#gear2').onclick = () => openSettings());
