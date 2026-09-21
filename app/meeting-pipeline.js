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
 // 只自动补跑最近 7 天的会：一次补 22 场老会议会连着跑一小时模型，老的交给他自己点「重新整理」
 const fresh=j=>Date.now()-Date.parse(j.created||0)<7*864e5;
 // 重跑要想真的把总结补出来，必须先把上一版 enhanced 挪走：meeting-pipeline.py 只有在
 // .job.enhanced.json 不存在时才会重新 summarize（见 py 的 `if enhanced is None`），
 // 留着它重跑就只是把同样的内容再归档一遍，summaryGenerated 永远上不去。
 // 留两级备份：.orig 是第一版（只写一次），.prev 是上一版（每次覆盖）。跑失败会把 .prev 放回去。
 function shelveEnhanced(key){
  const cur=path.join(dir,key+'.job.enhanced.json'); if(!fs.existsSync(cur))return false;
  try{const orig=path.join(dir,key+'.job.enhanced.orig.json');if(!fs.existsSync(orig))fs.copyFileSync(cur,orig);
      fs.copyFileSync(cur,path.join(dir,key+'.job.enhanced.prev.json'));fs.unlinkSync(cur);return true;}
  catch(e){log('备份上一版整理结果失败 '+e.message);return false;}
 }
 function unshelveEnhanced(key){
  const cur=path.join(dir,key+'.job.enhanced.json'),prev=path.join(dir,key+'.job.enhanced.prev.json');
  if(fs.existsSync(cur)||!fs.existsSync(prev))return;
  try{fs.copyFileSync(prev,cur);log('这次没跑成，已把上一版整理结果放回 '+key);}catch(e){}
 }
 function pump(){
  if(child||!idle())return;
  // P-03：以前只有 error 会自动重试，「归档完成但总结没出来」的那些就永远停在那儿，
  // 界面还显示「已归档」。现在这类自动补跑一次（只一次，空会和坏数据不会无限重跑）。
  const j=list().find(x=>x.status==='queued'||x.status==='running'
    ||(x.status==='error'&&x.attempts<4&&x.nextRetry*1000<Date.now())
    ||(x.status==='done'&&x.summaryGenerated!==true&&(x.summaryRetries||0)<1&&fresh(x)));if(!j)return;
  if(j.status==='done'){const p2=path.join(dir,j.key+'.job.json');const cur=read(p2);
    shelveEnhanced(j.key);
    write(p2,{...cur,status:'queued',phase:'总结没出来，自动补跑一次',summaryRetries:(cur.summaryRetries||0)+1});
    log('自动补跑总结 '+j.key);}
  child=spawn(process.env.THT_PYTHON||'python3',[path.join(root,'meeting-pipeline.py'),path.join(dir,j.key+'.job.json')],{env:{...process.env,THT_PIPELINE_DIR:dir},stdio:'ignore'});
  child.on('error',()=>{const p=path.join(dir,j.key+'.job.json'),s=read(p);write(p,{...s,status:'error',error:'后处理进程未启动',attempts:(s.attempts||0)+1,nextRetry:Date.now()/1000+120,phase:'归档待重试'});});
  child.on('close',()=>{child=null;const jobPath=path.join(dir,j.key+'.job.json'),done=read(jobPath);if(done.status==='error'||done.status==='partial')unshelveEnhanced(j.key);
  if(done.status==='running'||done.status==='queued'){unshelveEnhanced(j.key);done.status='error';done.error='后处理进程中断，原始录音仍保留';done.attempts=(done.attempts||0)+1;done.nextRetry=Date.now()/1000+120;write(jobPath,done);}if(['done','partial'].includes(done.status)){const resultPath=path.join(dir,j.key+'.job.enhanced.json');try{onComplete(read(resultPath),done,read(done.input));delete done.hubSyncWarning;write(jobPath,done);}catch(e){done.status='partial';done.hubSyncWarning=e.message;done.phase='工作台同步待重试';write(jobPath,done);log('hub archive update failed '+e.message);}}log('meeting pipeline finished '+j.key);setTimeout(pump,1000).unref();});
 }
 const timer=setInterval(pump,30000);timer.unref();setTimeout(pump,3000).unref();
 // P-02：以前只重跑 error / partial，已归档（done）的点「重新整理」什么都不做，界面却说「已排进队列」。
 // 现在 done 也真重跑；重跑前把上一版整理结果另存 .prev，万一这次答得更差还能拿回来。
 // 正在跑的（queued / running）不重复入队，把当前任务原样回给调用方，由它如实显示。
 function retry(id){const j=list().find(x=>x.sessionId===id);if(!j)throw Error('找不到归档任务');
  if(['queued','running'].includes(j.status))return {...j,requeued:false,note:'这场正在整理，没有重复排队'};
  if(j.status==='done')shelveEnhanced(j.key);
  j.status='queued';j.attempts=0;j.error='';j.phase='等待整理';j.retriedAt=new Date().toISOString();write(path.join(dir,j.key+'.job.json'),j);pump();return {...j,requeued:true};}
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
 // 议题的决定状态（已一致 / 待讨论 / 有分歧 / 搁置）：模型先给一版，他点一下改掉的存进 brief.decisions。
 // 和「需要你定一下」的回答共用 /meeting-answer 这一个写入口，不另开第二个。重跑整理时 brief_job 会把它留住。
 const DECISIONS=['已一致','待讨论','有分歧','搁置'];
 function setDecision(id,n,decision){const p=paths(id);if(!p||!fs.existsSync(p.enhanced))throw Error('找不到这场会');const e=read(p.enhanced);
  const topics=((e.brief||{}).topics)||[];if(!topics.length)throw Error('这场会还没有议题');
  const num=Number(n);if(!topics.some(t=>Number(t.n)===num))throw Error('没有这个议题');
  if(!DECISIONS.includes(decision))throw Error('状态不对');
  e.brief.decisions={...(e.brief.decisions||{}),[String(num)]:decision};
  write(p.enhanced,e);return{n:num,decision,session:e};}
 // 认人（会后一屏）把名字写进归档结果的 names。空串 = 清掉这个名字，认错了要能改回来。
 function setNames(id,patch){const p=paths(id);if(!p||!fs.existsSync(p.enhanced))return null;const e=read(p.enhanced);const names={...(e.names||{})};
  for(const [k,v] of Object.entries(patch||{})){if(v)names[k]=v;else delete names[k];}
  e.names=names;write(p.enhanced,e);return e;}
 const api={brief,briefState,answer,setDecision,setNames,enqueue,retry,reviseTranscript,result:id=>{const j=list().find(x=>x.sessionId===id);if(!j)return null;const p=path.join(dir,j.key+'.job.enhanced.json');return fs.existsSync(p)?read(p):null;},list:()=>list().map(({input,...safe})=>safe),stop:()=>clearInterval(timer)};managers.set(dir,api);return api;
};
