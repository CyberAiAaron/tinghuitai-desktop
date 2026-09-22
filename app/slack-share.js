'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path');
// 下面三个是「怎么跟 Slack 说话」，和「谁在调它」无关，所以放在工厂外面并导出：
// 会后分享按钮（app/share.js）和这个分享面板走的必须是同一份实现，不许各写一份。
async function apiCall(token,method,body,fetcher=fetch){const r=await fetcher('https://slack.com/api/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':method==='files.getUploadURLExternal'?'application/x-www-form-urlencoded':'application/json'},body:method==='files.getUploadURLExternal'?new URLSearchParams(body).toString():JSON.stringify(body),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.ok){const e=Error(j.error||'Slack 未返回确认，请到频道核对后再试');e.definite=!!j.error;throw e;}return j;}
async function uploadFile(token,filename,content,fetcher=fetch){const bytes=Buffer.from(content,'utf8');const data=await apiCall(token,'files.getUploadURLExternal',{filename,length:bytes.length},fetcher);const url=new URL(data.upload_url);if(url.protocol!=='https:'||!(url.hostname==='slack.com'||url.hostname.endsWith('.slack.com')))throw Error('Slack 返回了无效上传地址');const r=await fetcher(data.upload_url,{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('附件上传未完成，请重试');return {id:data.file_id,title:filename};}
// 发一条纯文本消息。channel 传频道 id，或传自己的 user id（Slack 会转成和本人的私聊）——
// 和分享面板里「发给我自己 / 某个频道」那两个选项是同一套语义。
async function postText({token,channel,text,fetcher=fetch}){
 if(!token)throw Error('请先在设置里连接 Slack');
 if(!channel)throw Error('没有指定发到哪里');
 const body=String(text||'').trim();
 if(!body)throw Error('没有可发送的内容');
 if(body.length>12000)throw Error('分享内容过长（最多 12000 字）');
 const out=await apiCall(token,'chat.postMessage',{channel,markdown_text:body,unfurl_links:false,unfurl_media:false},fetcher);
 return {channel:out.channel,ts:out.ts};}
module.exports=function({settings,isLocal,getBundle,fetcher=fetch}){
 const locks=new Set();
 const api=(token,method,body)=>apiCall(token,method,body,fetcher);
 const upload=(token,filename,content)=>uploadFile(token,filename,content,fetcher);
 async function channels(token){let cursor='',out=[];const cfg=settings.load(),userToken=cfg.SLACK_USER_TOKEN;do{const j=await api(userToken||token,userToken?'users.conversations':'conversations.list',{types:'public_channel,private_channel',exclude_archived:true,limit:200,cursor});out.push(...j.channels.filter(c=>userToken||c.is_member).map(c=>({id:c.id,name:c.name,private:!!c.is_private})));cursor=j.response_metadata?.next_cursor||'';}while(cursor);if(userToken){const joined=new Set();let next='';do{const page=await api(token,'users.conversations',{types:'public_channel,private_channel',exclude_archived:true,limit:200,cursor:next});for(const c of page.channels)joined.add(c.id);next=page.response_metadata?.next_cursor||'';}while(next);out=out.map(c=>({...c,canSend:joined.has(c.id)}));}return out;}
 return async(req,res,u,authed)=>{
 const route=u.pathname.replace(/^\/asr-relay/,'');if(!route.startsWith('/sharing/slack/'))return false;
 const send=(code,j)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(j));};
 if(!authed){send(401,{error:'请先连接这台 Mac'});return true;}
 try{
 let j={};if(req.method==='POST'){let body='';for await(const c of req){body+=c;if(Buffer.byteLength(body)>100000)throw Error('分享内容过长');}j=JSON.parse(body||'{}');}
 let token=settings.load().SLACK_BOT_TOKEN;
 if(route.endsWith('/connect')&&req.method==='POST'){
 if(!isLocal(req)){send(403,{error:'请在 Mac 本机连接 Slack，手机可使用已连接的账号'});return true;}
 token=String(j.token||'').trim();if(!/^xoxb-[A-Za-z0-9-]+$/.test(token))throw Error('请填写 Slack Bot User OAuth Token');const auth=await api(token,'auth.test',{});let extra={};if(j.userToken){if(!/^xoxp-[A-Za-z0-9-]+$/.test(j.userToken))throw Error('用户授权口令格式不正确');const user=await api(j.userToken,'auth.test',{});if(user.team_id!==auth.team_id)throw Error('两份授权必须来自同一个工作区');extra={SLACK_USER_TOKEN:j.userToken,SLACK_SELF_ID:user.user_id,SLACK_SELF_DM:''};}settings.save({...settings.load(),SLACK_BOT_TOKEN:token,SLACK_TEAM_NAME:auth.team,...extra});send(200,{ok:true,team:auth.team});return true;}
 if(!token){send(409,{error:'请先连接 Slack',needsConnection:true});return true;}
 if(route.endsWith('/channels')&&req.method==='GET'){send(200,{ok:true,team:settings.load().SLACK_TEAM_NAME,selfAvailable:!!settings.load().SLACK_SELF_ID,personalChannels:!!settings.load().SLACK_USER_TOKEN,channels:await channels(token)});return true;}
 if(route.endsWith('/send')&&req.method==='POST'){
 if(!j.confirmed||!j.channel||typeof j.text!=='string'||!j.text.trim()||j.text.length>12000)throw Error('请选择频道并确认分享内容（最多12000字）');
 const cfg=settings.load();const self=j.channel==='self';if(self&&!cfg.SLACK_SELF_ID)throw Error('请先连接个人 Slack 授权，以识别你自己');if(!self){const list=await channels(token);const chosen=list.find(c=>c.id===j.channel);if(!chosen)throw Error('此频道不在你的频道列表里');if(chosen.canSend===false)throw Error('请先在这个 Slack 频道中邀请 Meeting LiveMate，再发送');}
 const key=crypto.createHash('sha256').update(JSON.stringify([j.channel,j.text,j.bundleKey||''])).digest('hex');const dir=path.join(settings.dataDir,'state','slack-shares');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,key+'.json');
 if(locks.has(key))throw Error('正在发送，请勿重复点击');if(fs.existsSync(file)){const previous=JSON.parse(fs.readFileSync(file));if(previous.status!=='sent'){if(!j.retryConfirmed){const e=Error('上次发送结果尚未确认，请先在 Slack 频道核对，避免重复发送');e.uncertain=true;throw e;}fs.rmSync(file,{force:true});}else{send(200,{ok:true,...previous,alreadySent:true});return true;}}
 locks.add(key);fs.writeFileSync(file,JSON.stringify({status:'pending',channel:j.channel}),{mode:0o600});try{let channel=j.channel;let out;if(j.bundleKey){if(!getBundle)throw Error('分享附件服务不可用');const bundle=getBundle(j.bundleKey);if(!bundle?.minutes||!bundle?.transcript)throw Error('两份附件尚未准备好');if(self){if(cfg.SLACK_SELF_DM)channel=cfg.SLACK_SELF_DM;else{const dm=await api(token,'conversations.open',{users:cfg.SLACK_SELF_ID});channel=dm.channel.id;settings.save({...settings.load(),SLACK_SELF_DM:channel});}}const files=[];for(const [field,name] of [['minutes','完整纪要.md'],['transcript','完整逐字稿.md']])files.push(await upload(token,name,bundle[field]));out=await api(token,'files.completeUploadExternal',{files,channel_id:channel,initial_comment:j.text});out={...out,channel,files:files.map(f=>f.id)};}else{out=await api(token,'chat.postMessage',{channel:self?cfg.SLACK_SELF_ID:channel,markdown_text:j.text,unfurl_links:false,unfurl_media:false});}const receipt={status:'sent',channel:out.channel,ts:out.ts,files:out.files};fs.writeFileSync(file,JSON.stringify(receipt),{mode:0o600});send(200,{ok:true,...receipt});}catch(e){if(e.definite)fs.rmSync(file,{force:true});else e.uncertain=true;throw e;}finally{locks.delete(key);}return true;
 }
 send(404,{error:'未知分享操作'});
 }catch(e){send(400,{error:e.message==='missing_scope'?'Slack 需要补充附件或个人频道权限，请在连接设置中重新授权':e.message==='not_in_channel'?'请先在这个 Slack 频道中邀请 Meeting LiveMate，再发送':e.message,uncertain:!!e.uncertain});}return true;
 };
};
// 给 app/share.js 用：会后「分享到 Slack」和这个面板走同一份实现。
module.exports.api=apiCall;
module.exports.upload=uploadFile;
module.exports.postText=postText;
