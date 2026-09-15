'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path');
module.exports=function({settings,isLocal,fetcher=fetch}){
 const locks=new Set();
 async function api(token,method,body){const r=await fetcher('https://slack.com/api/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.ok){const e=Error(j.error||'Slack 未返回确认，请到频道核对后再试');e.definite=!!j.error;throw e;}return j;}
 async function channels(token){let cursor='',out=[];do{const j=await api(token,'conversations.list',{types:'public_channel,private_channel',exclude_archived:true,limit:200,cursor});out.push(...j.channels.filter(c=>c.is_member).map(c=>({id:c.id,name:c.name,private:!!c.is_private})));cursor=j.response_metadata?.next_cursor||'';}while(cursor);return out;}
 return async(req,res,u,authed)=>{
 const route=u.pathname.replace(/^\/asr-relay/,'');if(!route.startsWith('/sharing/slack/'))return false;
 const send=(code,j)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(j));};
 if(!authed){send(401,{error:'请先连接这台 Mac'});return true;}
 try{
 let j={};if(req.method==='POST'){let body='';for await(const c of req){body+=c;if(Buffer.byteLength(body)>100000)throw Error('分享内容过长');}j=JSON.parse(body||'{}');}
 let token=settings.load().SLACK_BOT_TOKEN;
 if(route.endsWith('/connect')&&req.method==='POST'){
 if(!isLocal(req)){send(403,{error:'请在 Mac 本机连接 Slack，手机可使用已连接的账号'});return true;}
 token=String(j.token||'').trim();if(!/^xoxb-[A-Za-z0-9-]+$/.test(token))throw Error('请填写 Slack Bot User OAuth Token');const auth=await api(token,'auth.test',{});await channels(token);settings.save({...settings.load(),SLACK_BOT_TOKEN:token,SLACK_TEAM_NAME:auth.team});send(200,{ok:true,team:auth.team});return true;}
 if(!token){send(409,{error:'请先连接 Slack',needsConnection:true});return true;}
 if(route.endsWith('/channels')&&req.method==='GET'){send(200,{ok:true,team:settings.load().SLACK_TEAM_NAME,channels:await channels(token)});return true;}
 if(route.endsWith('/send')&&req.method==='POST'){
 if(!j.confirmed||!j.channel||typeof j.text!=='string'||!j.text.trim()||j.text.length>12000)throw Error('请选择频道并确认分享内容（最多12000字）');
 const list=await channels(token);if(!list.some(c=>c.id===j.channel))throw Error('此频道不可发送，请先将应用加入频道');
 const key=crypto.createHash('sha256').update(JSON.stringify([j.channel,j.text])).digest('hex');const dir=path.join(settings.dataDir,'state','slack-shares');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,key+'.json');
 if(locks.has(key))throw Error('正在发送，请勿重复点击');if(fs.existsSync(file)){const previous=JSON.parse(fs.readFileSync(file));if(previous.status!=='sent')throw Error('上次发送结果尚未确认，请先在 Slack 频道核对，避免重复发送');send(200,{ok:true,...previous,alreadySent:true});return true;}
 locks.add(key);fs.writeFileSync(file,JSON.stringify({status:'pending',channel:j.channel}),{mode:0o600});try{const out=await api(token,'chat.postMessage',{channel:j.channel,markdown_text:j.text,unfurl_links:false,unfurl_media:false});const receipt={status:'sent',channel:out.channel,ts:out.ts};fs.writeFileSync(file,JSON.stringify(receipt),{mode:0o600});send(200,{ok:true,...receipt});}catch(e){if(e.definite)fs.rmSync(file,{force:true});throw e;}finally{locks.delete(key);}return true;
 }
 send(404,{error:'未知分享操作'});
 }catch(e){send(400,{error:e.message});}return true;
 };
};
