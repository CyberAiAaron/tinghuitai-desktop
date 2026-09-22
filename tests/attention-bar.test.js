'use strict';
// THT-R2：归档失败、记忆写入失败要在会中看得见。服务端合成一份「待处理」账（/health.attention + type:'attention' 广播），
// 页面把它说成人话挂成红条；账清零红条撤掉。正例：有失败 → 数字对得上、页面有条；反例：没失败 → total 0、条隐藏。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const mem=require('../app/memory'),ops=require('../app/memory-ops');
const TOKEN='a'.repeat(40);

test('failedSummary：还会重试的和已停止重试的分开数；没有失败就是 0 / 0',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-attn-'));
 try{
  const db=mem.open(dir);if(!db){t.skip('本机 node 没有 sqlite，记忆功能整体关闭');return;}
  assert.deepEqual(ops.failedSummary(dir),{retrying:0,givenUp:0});
  const put=(id,status,attempts)=>db.prepare("INSERT INTO ingested(meeting_id,input_hash,status,at,attempts) VALUES(?,?,?,?,?)").run(id,'h',status,new Date().toISOString(),attempts);
  put('a','failed',1);put('b','failed',ops.MAX_TOTAL_ATTEMPTS);put('c','done',0);put('d','claiming',0);
  assert.deepEqual(ops.failedSummary(dir),{retrying:1,givenUp:1});
 }finally{mem.closeAll?.();fs.rmSync(dir,{recursive:true,force:true});}
});

// Codex 初审（f679ecb3）指出：要证明「模型没返回 / 返回不是 JSON」不会被当成功，得真跑一次 ingest，不能只手插 failed 行。
// memory-ops.ingest 的 finally{finish()} 在 ok 没置真时把这场写成 status='failed'、attempts+1——这里就是钉住这条路。
test('failedSummary：账本文件损坏时带 error，不把「不知道」报成 0 / 0',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-attn-bad-'));
 try{
  if(!mem.open(fs.mkdtempSync(path.join(os.tmpdir(),'livemate-attn-probe-')))){t.skip('本机 node 没有 sqlite，记忆功能整体关闭');return;}
  fs.mkdirSync(path.join(dir,'state'),{recursive:true});fs.writeFileSync(path.join(dir,'state/memory.db'),'这不是 sqlite 文件'.repeat(64));
  const s=ops.failedSummary(dir);
  assert.equal(s.retrying,0);assert.equal(s.givenUp,0);assert.ok(typeof s.error==='string'&&s.error.length>0,'要带 error：'+JSON.stringify(s));
 }finally{mem.closeAll?.();fs.rmSync(dir,{recursive:true,force:true});}
});

test('ingest 真跑：模型没返回、返回不是 JSON 两种结果都进失败账（还会重试档）；成功一次就出账',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-attn-ingest-'));
 try{
  const db=mem.open(dir);if(!db){t.skip('本机 node 没有 sqlite，记忆功能整体关闭');return;}
  const rows=Array.from({length:30},(_,i)=>({id:'g'+i,at:i*5,text:'这一场讨论了新品定义的第 '+i+' 个问题，大家意见不一，Aaron 说下周再定'}));
  const sess=id=>({id,title:'会 '+id,start:'2026-09-22T01:00:00.000Z',transcript:rows,highlights:[],todos:[],factchecks:[]});
  const r1=await ops.ingest(dir,sess('nm'),async()=>null,()=>{});
  assert.deepEqual({skipped:r1.skipped,reason:r1.reason},{skipped:true,reason:'no-model'});
  const r2=await ops.ingest(dir,sess('bj'),async()=>'这不是 JSON',()=>{});
  assert.deepEqual({skipped:r2.skipped,reason:r2.reason},{skipped:true,reason:'bad-json'});
  assert.deepEqual(ops.failedSummary(dir),{retrying:2,givenUp:0},'两种失败都要在账上，且是「还会重试」档');
  const row=db.prepare("SELECT status,attempts FROM ingested WHERE meeting_id='nm'").get();
  assert.equal(row.status,'failed');assert.equal(row.attempts,1);
  // 反例：同一场再抽一次、模型这次给了合法 JSON → 出账
  const good=JSON.stringify({cards:[]});
  const r3=await ops.ingest(dir,sess('nm'),async()=>good,()=>{});
  assert.ok(!r3.skipped||r3.reason!=='no-model','成功那次不该再报 no-model：'+JSON.stringify(r3));
  assert.deepEqual(ops.failedSummary(dir),{retrying:1,givenUp:0});
 }finally{mem.closeAll?.();fs.rmSync(dir,{recursive:true,force:true});}
});

test('服务端：归档 error 任务和记忆失败进 /health.attention；新出现的失败在一个轮询周期内被数到；清掉后归零',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-attn-srv-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const pipe=path.join(dir,'state/meeting-pipeline');fs.mkdirSync(pipe,{recursive:true});
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local'}));
 // 一场还会自动重试（attempts 1），一场已经打满（attempts 4）；nextRetry 放到很远，免得测试里被 pump 重排
 const far=Date.now()/1000+86400;
 const job=(key,attempts)=>fs.writeFileSync(path.join(pipe,key+'.job.json'),JSON.stringify({schema:2,key,sessionId:'s-'+key,title:'t',input:path.join(pipe,key+'.input.json'),status:'error',error:'后处理进程中断',attempts,nextRetry:far,created:new Date().toISOString()}));
 job('k1',1);job('k2',4);
 const db=mem.open(dir);
 if(db){db.prepare("INSERT INTO ingested(meeting_id,input_hash,status,at,attempts) VALUES(?,?,?,?,?)").run('m1','h','failed',new Date().toISOString(),ops.MAX_TOTAL_ATTEMPTS);mem.closeAll?.();}
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_ATTENTION_MS:'200',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const health=async()=>(await fetch(base+'/health?token='+TOKEN)).json();
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  let h=await health();
  assert.equal(h.attention.archiveRetrying,1);assert.equal(h.attention.archiveGivenUp,1);
  if(db){assert.equal(h.attention.memoryGivenUp,1);assert.equal(h.attention.memoryRetrying,0);}
  assert.equal(h.attention.total,2+(db?1:0));
  // 等一个轮询周期（200ms）：账第一次算出来要落一行日志，日后排查靠它对失败数
  await pause(600);
  const log1=fs.readFileSync(path.join(dir,'events.log'),'utf8');
  assert.match(log1,/待处理：归档失败 2（已停止重试 1）/,'日志里要能对到失败数：'+log1.slice(-800));
  // 新冒出来一场失败：不用重启、不用他点，一个轮询周期内账就变了
  job('k3',2);
  let seen=false;for(let i=0;i<30;i++){h=await health();if(h.attention.archiveRetrying===2){seen=true;break;}await pause(100);}
  assert.ok(seen,'新出现的归档失败没在轮询周期内被数到');
  // 反例：失败都清掉 → total 0（页面据此把条隐藏）
  for(const k of ['k1','k2','k3'])fs.rmSync(path.join(pipe,k+'.job.json'));
  if(db){const d2=mem.open(dir);d2.prepare("DELETE FROM ingested").run();mem.closeAll?.();}
  let zero=false;for(let i=0;i<30;i++){h=await health();if(h.attention.total===0){zero=true;break;}await pause(100);}
  assert.ok(zero,'失败清掉后账没归零：'+JSON.stringify(h.attention));
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('页面接得住：有 attn-bar、健康检查和广播两条路都会更新它、账为 0 就隐藏、按钮只通向会议列表',()=>{
 const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
 assert.match(html,/id="attn-bar" hidden/,'红条默认隐藏');
 assert.match(html,/setAttention\(h\.attention\)/,'页面刷新后要从 /health 把条挂回来');
 assert.match(html,/m\.type === 'attention'[\s\S]{0,80}setAttention\(m\.attention\)/,'会中广播要接');
 assert.ok((html.match(/m\.type === 'attention'\) \{ try \{ setAttention\(m\.attention\); \} catch\(e\)\{\} /g)||[]).length>=2,'会中（录音）和旁听（role=view）两条 WS 都要接 attention');
 assert.match(html,/const on = !!\(a && a\.total > 0\);\s*bar\.hidden = !on;/,'total 为 0 时隐藏');
 assert.match(html,/已停止重试，要你来点/);assert.match(html,/会自动重试/);assert.match(html,/记忆失败账读不出来/,'账本读不出来要单独说');
 assert.match(html,/#attn-open'\)\.onclick = \(\) => \{ const b = \$\('#b-hist'\)/,'唯一动作是去会议列表');
 const srv=fs.readFileSync(path.join(root,'app/server.js'),'utf8');
 assert.match(srv,/memoryLedgerError:mem\.error\|\|''/,'账本 error 要进 /health.attention');assert.match(srv,/\+\(a\.memoryLedgerError\?1:0\)/,'账本读不出来要计入 total，红条不能消失');
 assert.match(srv,/function checkAttention\(\)[\s\S]{0,600}broadcastAll\(\{type:'attention',attention:a\}\)/,'账变了要推给所有在开的会');
 for(const site of ['noteMemoryOutcome(this.id, r)','noteMemoryOutcome(sid,r)','noteMemoryOutcome(id,r)'])assert.ok(srv.includes(site),'记忆抽卡三处都要把结果记账：'+site);
});
