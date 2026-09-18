'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const managers=new Map();
module.exports=function({root=__dirname,dir=process.env.THT_PIPELINE_DIR||path.join(require('./config').dataDir,'state/meeting-pipeline'),idle=()=>true,log=()=>{},onComplete=()=>{}}={}){
 if(managers.has(dir))return managers.get(dir);
 fs.mkdirSync(dir,{recursive:true});let child=null;
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const write=(p,j)=>require('./session-journal').write(p,j);
 function enqueue(session){
  if(!session?.id||!Array.isArray(session.transcript)||(!session.transcript.some(x=>x.text)&&!(session.audioPath&&fs.existsSync(session.audioPath))))throw Error('会议没有转写内容');
  const key=crypto.createHash('sha256').update(String(session.id)).digest('hex').slice(0,16),jobPath=path.join(dir,key+'.job.json');
  if(fs.existsSync(jobPath)){
   const old=read(jobPath),previous=read(old.input);
   const content=x=>JSON.stringify([x.transcript,x.notes||'',x.fixes||[],x.names||{},x.uiLang||'zh']);
   if(content(previous)!==content(session)){
    if(old.status==='running'||(child&&list().find(j=>j.key===key)?.status==='queued'))throw Error('本场正在归档，请完成后重新提交修改');
    // Preserve the previous input locally; archive_version appends a new revision to the SAME doc.
    const revision=crypto.createHash('sha256').update(content(previous)).digest('hex').slice(0,16);
    const prior=path.join(dir,key+'.input-'+revision+'.json');if(!fs.existsSync(prior))write(prior,previous);
    write(old.input,session);const enhanced=path.join(dir,key+'.job.enhanced.json');if(fs.existsSync(enhanced))fs.unlinkSync(enhanced);
    old.status='queued';old.attempts=0;old.phase='等待整理';old.error='';write(jobPath,old);pump();return old;
   }
   if(['error','partial'].includes(old.status)){old.status='queued';old.attempts=0;write(jobPath,old);pump();}return old;
  }
  const input=path.join(dir,key+'.input.json');write(input,session);
  const job={key,sessionId:String(session.id),title:session.title||'未命名会议',input,status:'queued',phase:'等待整理',created:new Date().toISOString(),attempts:0};write(jobPath,job);pump();return job;
 }
 function list(){return fs.readdirSync(dir).filter(f=>f.endsWith('.job.json')).map(f=>{try{return read(path.join(dir,f));}catch{return null;}}).filter(Boolean).sort((a,b)=>a.created.localeCompare(b.created));}
 function pump(){
  if(child||!idle())return;
  const j=list().find(x=>x.status==='queued'||x.status==='running'||(x.status==='error'&&x.attempts<4&&x.nextRetry*1000<Date.now()));if(!j)return;
  child=spawn(process.env.THT_PYTHON||'python3',[path.join(root,'meeting-pipeline.py'),path.join(dir,j.key+'.job.json')],{env:{...process.env,THT_PIPELINE_DIR:dir},stdio:'ignore'});
  child.on('error',()=>{const p=path.join(dir,j.key+'.job.json'),s=read(p);write(p,{...s,status:'error',error:'后处理进程未启动',attempts:(s.attempts||0)+1,nextRetry:Date.now()/1000+120,phase:'归档待重试'});});
  child.on('close',()=>{child=null;const jobPath=path.join(dir,j.key+'.job.json'),done=read(jobPath);if(done.status==='running'||done.status==='queued'){done.status='error';done.error='后处理进程中断，原始录音仍保留';done.attempts=(done.attempts||0)+1;done.nextRetry=Date.now()/1000+120;write(jobPath,done);}if(['done','partial'].includes(done.status)){const resultPath=path.join(dir,j.key+'.job.enhanced.json');try{onComplete(read(resultPath),done,read(done.input));delete done.hubSyncWarning;write(jobPath,done);}catch(e){done.status='partial';done.hubSyncWarning=e.message;done.phase='工作台同步待重试';write(jobPath,done);log('hub archive update failed '+e.message);}}log('meeting pipeline finished '+j.key);setTimeout(pump,1000).unref();});
 }
 const timer=setInterval(pump,30000);timer.unref();setTimeout(pump,3000).unref();
 function retry(id){const j=list().find(x=>x.sessionId===id);if(!j)throw Error('找不到归档任务');if(!['error','partial'].includes(j.status))return j;j.status='queued';j.attempts=0;j.error='';j.phase='等待整理';write(path.join(dir,j.key+'.job.json'),j);pump();return j;}
 function reviseTranscript(id,result){const j=list().find(x=>x.sessionId===id);if(!j)throw Error('请先归档原会议，再进行本地补转');const previous=read(j.input);return enqueue({...previous,transcript:result.transcript,names:{},summary:'',providedLocalTranscript:true,speakerWarning:result.diarizationError||((result.speakerCount>8||result.transcript.filter(r=>!r.speaker||r.speakerUncertain).length/result.transcript.length>0.35)?'声音分组不稳定，分人结果需要核对':''),speakerCount:result.speakerCount});}
 // 回看页数据（REQ-004）：单独补跑、读进度、存「需要你定一下」的回答
 const briefRuns=new Map();
 const paths=id=>{const j=list().find(x=>x.sessionId===id);if(!j)return null;return{enhanced:path.join(dir,j.key+'.job.enhanced.json'),state:path.join(dir,j.key+'.brief.json')};};
 function brief(id){const p=paths(id);if(!p||!fs.existsSync(p.enhanced))throw Error('这场会还没整理完');const jb=list().find(x=>x.sessionId===id);if(jb&&['queued','running'].includes(jb.status))throw Error('这场会还在整理，稍后再点');if(briefRuns.has(id))return{state:'running'};
  write(p.state,{state:'running',phase:'排队',started:Date.now()/1000});
  const c=spawn(process.env.THT_PYTHON||'python3',[path.join(root,'meeting-pipeline.py'),'--brief',p.enhanced],{env:{...process.env,THT_PIPELINE_DIR:dir},stdio:'ignore'});briefRuns.set(id,c);
  const fail=msg=>{try{const s=read(p.state);if(s.state==='running')write(p.state,{...s,state:'failed',error:msg});}catch{}};
  c.on('error',()=>{briefRuns.delete(id);fail('整理进程未启动');});c.on('close',code=>{briefRuns.delete(id);if(code)fail('整理进程中断');});return{state:'running'};}
 function briefState(id){const p=paths(id);if(!p||!fs.existsSync(p.state))return{state:'none'};const s=read(p.state);if(s.state==='running'&&!briefRuns.has(id)&&Date.now()/1000-(s.started||0)>2400)return{...s,state:'failed',error:'整理超时'};return s;}
 function answer(id,qid,choice,text){const p=paths(id);if(!p||!fs.existsSync(p.enhanced))throw Error('找不到这场会');const e=read(p.enhanced);const q=((e.brief||{}).questions||[]).find(x=>x.id===qid);if(!q)throw Error('没有这道题');
  if(!Number.isInteger(choice)||choice<0||choice>=q.options.length)throw Error('选项不对');
  e.brief.answers={...(e.brief.answers||{}),[qid]:{choice,text:String(text||'').slice(0,200),at:Date.now()}};
  const value=String(text||'').trim().slice(0,40)||q.options[choice];
  for(const f of q.affects||[]){const m=/^speaker:S?(\w{1,12})$/i.exec(f);if(m&&value){e.names={...(e.names||{}),[m[1]]:value};}}
  write(p.enhanced,e);return{question:q,value,session:e};}
 const api={brief,briefState,answer,enqueue,retry,reviseTranscript,result:id=>{const j=list().find(x=>x.sessionId===id);if(!j)return null;const p=path.join(dir,j.key+'.job.enhanced.json');return fs.existsSync(p)?read(p):null;},list:()=>list().map(({input,...safe})=>safe),stop:()=>clearInterval(timer)};managers.set(dir,api);return api;
};
