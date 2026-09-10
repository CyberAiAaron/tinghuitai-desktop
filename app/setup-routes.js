'use strict';
module.exports=async function(req,res,u,{isLocal,settings,active,testModel}){
 const bootstrap=u.pathname==='/tinghuitai/bootstrap.js',setup=u.pathname==='/setup';
 const detect=u.pathname==='/setup/detect';
 if(!bootstrap&&!setup&&!detect&&u.pathname!=='/setup/test')return false;
 const json=(code,j)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(j));return true;};
 if(!isLocal)return json(403,{error:'设置只能在本机打开'});
 const c=settings.load();
 const macAsr=(()=>{try{return require('./mac-asr').available();}catch(e){return false;}})();
 const asrLocal=c.ASR_PROVIDER==='mac';
 const publicState={provider:c.LLM_PROVIDER||'',asrProvider:c.ASR_PROVIDER||'volc',macAsrAvailable:macAsr,ready:!!((asrLocal||(c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY))&&(c.DEEPSEEK_API_KEY||c.LLM_PROVIDER)),asrConfigured:!!(asrLocal||(c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY)),modelConfigured:!!(c.DEEPSEEK_API_KEY||c.LLM_PROVIDER),base:c.LLM_BASE_URL,model:c.LLM_MODEL,resource:c.VOLC_RESOURCE_ID,archive:c.ARCHIVE_TARGET};
 if(bootstrap&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end('window.THT_BOOT='+JSON.stringify({...publicState,relayToken:c.RELAY_TOKEN})+';');return true;}
 if(setup&&req.method==='GET')return json(200,publicState);
 // 本机装没装 AI 命令行：装了就不用申请 API Key
 if(detect&&req.method==='GET'){const found=require('./cli-llm').detect();return json(200,{found:Object.keys(found),provider:c.LLM_PROVIDER||''});}
 if(detect&&req.method==='POST'){
  if(req.headers['x-tht-token']!==c.RELAY_TOKEN)return json(403,{error:'请从本机设置页面操作'});
  let body='';for await(const chunk of req){body+=chunk;if(body.length>2000)return json(413,{error:'请求过长'});}
  let kind='';try{kind=String(JSON.parse(body||'{}').kind||'');}catch{}
  if(!['codex','claude'].includes(kind))return json(400,{ok:false,error:'不认识这个工具'});
  const r=await require('./cli-llm').probe(kind,settings.dataDir);
  if(r.ok){c.LLM_PROVIDER=kind;settings.save(c);}
  const msg=r.ok?({codex:'Codex 已就绪，用的是你 ChatGPT 账号的额度，不用另外付钱。',claude:'Claude Code 已就绪，用的是你的 Claude 订阅，不用另外付钱。'})[kind]
    :(r.reason==='not_installed'?'没在这台电脑上找到它。':'找到了程序，但它还没登录（或这次没跑通）。请先打开它登录一次，再回来点这里。');
  return json(r.ok?200:200,{ok:!!r.ok,message:msg,reason:r.reason||''});
 }
 if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers['x-tht-token']!==c.RELAY_TOKEN)return json(403,{error:'请从本机设置页面操作'});
 if(active())return json(409,{error:'正在录音，请结束本场后再改设置'});
 if(u.pathname==='/setup/test'){const result=await testModel();return json(result?200:502,{ok:!!result,message:result?'模型已连通。语音服务请用30秒试录验证。':'模型未连通，请检查API Key、余额、模型名与网络。'});}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)return json(413,{error:'配置过长'});}
 try{const j=JSON.parse(body);
 if(typeof j.ASR_PROVIDER==='string'){const v=j.ASR_PROVIDER.trim();if(!['','volc','mac'].includes(v))throw Error('转写方式取值不对');c.ASR_PROVIDER=v;}
 for(const k of Object.keys(settings.defaults)){if(k==='ASR_PROVIDER')continue;if(j[k]===undefined||['ARCHIVE_TARGET','THT_ARCHIVE_OWNER_ID','LLM_PROVIDER'].includes(k))continue;if(typeof j[k]!=='string'||j[k].length>4000||/[\r\n]/.test(j[k]))throw Error('字段格式不正确');if(['VOLC_APP_KEY','VOLC_ACCESS_KEY','DEEPSEEK_API_KEY'].includes(k)&&!j[k])continue;c[k]=j[k].trim();}
 const base=new URL(c.LLM_BASE_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('模型地址须为不含密钥的 HTTPS 地址');
 settings.save(c);
 // 选了本机转写就先把那个 .app 拉起来一次：系统的语音识别授权弹窗只认 GUI 会话，
 // 不先弹一次，用户开会时会以为坏了。它读不到 stdin 会自己退出。
 if(c.ASR_PROVIDER==='mac'){ try{ const {APP}=require('./mac-asr'); require('child_process').execFile('/usr/bin/open',['-a',APP,'--args','0','probe','zh-CN'],()=>{}); }catch(e){} }
 return json(200,{ok:true});}catch{return json(400,{error:'配置格式不正确，请检查模型地址与字段'});}
};
