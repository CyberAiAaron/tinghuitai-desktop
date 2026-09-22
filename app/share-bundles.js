'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
module.exports=function({settings}){
 const dir=path.join(settings.dataDir,'state','share-bundles');fs.mkdirSync(dir,{recursive:true});const running=new Set();
 const file=k=>{if(!/^[a-f0-9]{32}$/.test(k||''))throw Error('分享记录无效');return path.join(dir,k+'.json');};
 const read=k=>JSON.parse(fs.readFileSync(file(k),'utf8'));
 const write=(k,j)=>{fs.writeFileSync(file(k)+'.tmp',JSON.stringify(j),{mode:0o600});fs.renameSync(file(k)+'.tmp',file(k));};
 function work(key,kind){const flag=kind==='lark'?'larkStatus':'status';if(running.has(key))return;running.add(key);const j=read(key);j[flag]='running';delete j.error;write(key,j);// THT_CFG_JSON：Python 要的那几项配置由 Node 给（已套过 defaults，不含任何密钥）；stderr 留尾部 2KB，失败时写进 error，别让「处理已中断」成为唯一线索（审查 S8）。
 let cfg='{}';try{const s=require('./config').load();let chainLength=1;try{chainLength=Math.max(1,require('./llm').chainOf(s).length);}catch(e){}
  cfg=JSON.stringify({ARCHIVE_TARGET:s.ARCHIVE_TARGET||'local',MEMORY_PROJECTION_DIR:s.MEMORY_PROJECTION_DIR||'',THT_ARCHIVE_OWNER_ID:s.THT_ARCHIVE_OWNER_ID||'',chainLength});}catch(e){}
 const child=spawn('python3',[path.join(__dirname,'share-bundle.py'),file(key),kind],{env:{...process.env,THT_DATA_DIR:settings.dataDir,THT_NODE:process.execPath,THT_CFG_JSON:cfg},stdio:['ignore','ignore','pipe']});
 let tail='';if(child.stderr)child.stderr.on('data',d=>{tail=(tail+d).slice(-2048);});
 const finish=()=>{running.delete(key);const j=read(key);if(j[flag]==='running'){j[flag]='error';j.error='处理已中断，请重试'+(tail.trim()?'（'+tail.trim().slice(-160)+'）':'');write(key,j);}};child.on('error',finish);child.on('exit',finish);}
 return {read,async route(req,res,u,authed){const route=u.pathname.replace(/^\/asr-relay/,'');if(!route.startsWith('/sharing/bundle'))return false;const send=(s,j)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(j));};if(!authed){send(401,{error:'请连接 Mac'});return true;}
 try{let body={};if(req.method==='POST'){let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>8e6)throw Error('会议内容过大');}body=JSON.parse(raw);}
 if(route==='/sharing/bundle'&&req.method==='POST'){const input=body.session;if(!input?.id||!input.transcript?.some(r=>String(r.text||'').trim()))throw Error('这场还没有转写内容');const session={};for(const k of ['id','title','start','end','transcript','names','uiLang','todos'])if(input[k]!==undefined)session[k]=input[k];const key=crypto.createHash('sha256').update(JSON.stringify(session)).digest('hex').slice(0,32);if(!fs.existsSync(file(key)))write(key,{key,session,status:'pending'});const j=read(key);if(j.status!=='done')work(key,'generate');send(200,{key,status:read(key).status});return true;}
 const key=u.searchParams.get('key')||body.key;const j=read(key);
 if(route==='/sharing/bundle/lark'&&req.method==='POST'){if(!j.bundle)throw Error('请先生成分享内容');if(j.larkStatus!=='done')work(key,'lark');send(200,{status:read(key).larkStatus,url:j.larkStatus==='done'?j.url:undefined});return true;}
 if(route==='/sharing/bundle/file'){const kind=u.searchParams.get('kind');if(!['minutes','transcript'].includes(kind)||!j.bundle)throw Error('附件尚未准备好');res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(kind==='minutes'?'完整纪要.md':'完整逐字稿.md')});res.end(j.bundle[kind]);return true;}
 if(route==='/sharing/bundle'&&req.method==='GET'){for(const field of ['status','larkStatus'])if(j[field]==='running'&&!running.has(key)){j[field]='error';j.error='处理已中断，请重新打开后重试';}send(200,{key,status:j.status,bundle:j.bundle,error:j.error,larkStatus:j.larkStatus,url:j.larkStatus==='done'?j.url:undefined});return true;}send(404,{error:'未知分享操作'});
 }catch(e){send(400,{error:e.message});}return true;}};
};
