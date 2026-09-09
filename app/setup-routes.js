'use strict';
module.exports=async function(req,res,u,{isLocal,settings,active,testModel}){
 const bootstrap=u.pathname==='/tinghuitai/bootstrap.js',setup=u.pathname==='/setup';
 if(!bootstrap&&!setup&&u.pathname!=='/setup/test')return false;
 const json=(code,j)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(j));return true;};
 if(!isLocal)return json(403,{error:'设置只能在本机打开'});
 const c=settings.load();
 const publicState={ready:!!(c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY&&c.DEEPSEEK_API_KEY),asrConfigured:!!(c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY),modelConfigured:!!c.DEEPSEEK_API_KEY,base:c.LLM_BASE_URL,model:c.LLM_MODEL,resource:c.VOLC_RESOURCE_ID,archive:c.ARCHIVE_TARGET};
 if(bootstrap&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end('window.THT_BOOT='+JSON.stringify({...publicState,relayToken:c.RELAY_TOKEN})+';');return true;}
 if(setup&&req.method==='GET')return json(200,publicState);
 if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers['x-tht-token']!==c.RELAY_TOKEN)return json(403,{error:'请从本机设置页面操作'});
 if(active())return json(409,{error:'正在录音，请结束本场后再改设置'});
 if(u.pathname==='/setup/test'){const result=await testModel();return json(result?200:502,{ok:!!result,message:result?'模型已连通。语音服务请用30秒试录验证。':'模型未连通，请检查API Key、余额、模型名与网络。'});}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>12000)return json(413,{error:'配置过长'});}
 try{const j=JSON.parse(body);for(const k of Object.keys(settings.defaults)){if(j[k]===undefined||['ARCHIVE_TARGET','THT_ARCHIVE_OWNER_ID'].includes(k))continue;if(typeof j[k]!=='string'||j[k].length>4000||/[\r\n]/.test(j[k]))throw Error('字段格式不正确');if(['VOLC_APP_KEY','VOLC_ACCESS_KEY','DEEPSEEK_API_KEY'].includes(k)&&!j[k])continue;c[k]=j[k].trim();}
 const base=new URL(c.LLM_BASE_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('模型地址须为不含密钥的 HTTPS 地址');
 settings.save(c);return json(200,{ok:true});}catch{return json(400,{error:'配置格式不正确，请检查模型地址与字段'});}
};
