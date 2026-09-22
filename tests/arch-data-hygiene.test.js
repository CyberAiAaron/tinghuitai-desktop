'use strict';
// 数据面的四条（2026-09-22 架构审查）：
//   D6 /export-state 默认不带逐字稿，另给 ?latest=1 / ?ids= / ?full=1
//   D4 改 pending 会议文件走原子写、只改要改的字段（不拿手上的旧快照整份写回）
//   D7 events.log 超上限滚成 .1
//   D5 「同一场会用哪份转写」只有一份规则
//   R6 离线回传：会已存盘，排队失败不再整体回 400
//   S1 pending 文件名两种（sess- / offline-），按 id 找文件的地方都要两种都认
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),http=require('http'),crypto=require('crypto');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='d'.repeat(48);

function boot(dir,port,extraEnv){
 return spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',...(extraEnv||{})},stdio:'ignore'});
}
async function ready(port){for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)return;}catch(e){}await pause(100);}}
const sess=(id,n,start)=>({id,title:'会 '+id,start,end:start+6e5,transcript:Array.from({length:n},(_,i)=>({at:i+1,text:'第'+(i+1)+'句'}))});

test('D5 「用哪份转写」只有一份规则：收敛 > 过审 > 有转写，平手比条数',()=>{
 const pick=require('../app/transcript-pick');
 const bare={transcript:[{text:'a'},{text:'b'},{text:'c'}]};
 const condensed={transcript:[{text:'a'}],condensed:{x:1}};
 assert.equal(pick.better(bare,condensed),condensed,'有收敛结果的那份赢');
 const short={transcript:[{text:'a'}]},long={transcript:[{text:'a'},{text:'b'}]};
 assert.equal(pick.better(short,long),long,'都只有转写时，条数多的赢（工作台原来就是这么比的）');
 assert.equal(pick.better(long,short),long,'顺序换了结论不变');
 assert.equal(pick.better(short,{transcript:[{text:'z'}]}),short,'完全打平时留先遇到的那份');
 // 分享那处问的是另一个问题：逐字稿取谁的。管线那份有收敛也不能让它把更长的那份挤掉。
 assert.equal(pick.pickTranscript(long,condensed).length,2,'逐字稿只比条数，多的赢');
 assert.equal(pick.pickTranscript(short,condensed).length,1,'平手时用第二个（做过纠错合并的那份）');
});

test('D7 events.log 超上限就滚成 .1，只留一份',async()=>{
 const rot=require('../app/log-rotate');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-rot-')),f=path.join(dir,'events.log');
 try{
  fs.writeFileSync(f,'x'.repeat(5000));
  assert.equal(rot.rotateIfBig(f,{max:1000,everyMs:0}),true);
  assert.equal(fs.existsSync(f),false,'原文件已改名，下一次 append 会重建');
  assert.equal(fs.statSync(f+'.1').size,5000);
  fs.writeFileSync(f,'y'.repeat(5000));
  assert.equal(rot.rotateIfBig(f,{max:1000,everyMs:0}),true);
  assert.equal(String(fs.readFileSync(f+'.1'))[0],'y','第二次滚动直接盖掉旧的 .1，只留一份');
  assert.equal(fs.existsSync(f+'.2'),false);
  // 节流：同一个文件在 everyMs 内不重复 stat
  fs.writeFileSync(f,'z'.repeat(5000));
  assert.equal(rot.rotateIfBig(f,{max:1000,everyMs:60000}),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('D7 服务启动时就把过大的 events.log 滚掉',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-rot2-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 fs.writeFileSync(path.join(dir,'events.log'),'老日志\n'.repeat(2000));
 const child=boot(dir,port,{THT_LOG_MAX_BYTES:'2048'});
 try{
  await ready(port);
  assert.ok(fs.existsSync(path.join(dir,'events.log.1')),'超过上限的那份应当被滚走');
  assert.ok(fs.statSync(path.join(dir,'events.log')).size<2048,'新的 events.log 从头开始写');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('D6 /export-state 默认不带逐字稿；latest / ids / full 各取所需',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-export-')),port=await freePort(),base='http://127.0.0.1:'+port+'/asr-relay';
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 fs.mkdirSync(path.join(dir,'pending'),{recursive:true});
 fs.writeFileSync(path.join(dir,'pending','sess-old.json'),JSON.stringify(sess('old',3,Date.parse('2026-09-01T02:00:00Z'))));
 fs.writeFileSync(path.join(dir,'pending','sess-new.json'),JSON.stringify(sess('new',5,Date.parse('2026-09-20T02:00:00Z'))));
 const child=boot(dir,port);
 const get=async q=>(await fetch(base+'/export-state'+q+'&token='+TOKEN,{cache:'no-store'})).json();
 try{
  await ready(port);
  const plain=await get('?x=1');
  assert.equal(plain.sessions.length,2,'默认仍然列出全部场次');
  for(const s of plain.sessions){assert.deepEqual(s.transcript,[],'默认不带逐字稿');assert.equal(s.transcriptOmitted,true);}
  assert.deepEqual(plain.sessions.map(s=>s.transcriptCount),[3,5],'条数还要能看到');

  const latest=await get('?latest=1');
  assert.equal(latest.sessions.length,1);
  assert.equal(latest.sessions[0].id,'new','latest 是 start 最大的那场，不是文件最新的那场');
  assert.equal(latest.sessions[0].transcript.length,5);

  const byId=await get('?ids=old');
  assert.deepEqual(byId.sessions.map(s=>s.id),['old']);
  assert.equal(byId.sessions[0].transcript.length,3);

  const full=await get('?full=1');
  assert.deepEqual(full.sessions.map(s=>s.transcript.length),[3,5],'full=1 维持老行为，「从 Mac 找回」靠它');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('D4 + S1 改 calendar 只动 calendar：中途写进来的转写不会被旧快照盖掉，offline- 文件也认',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-d4-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 fs.mkdirSync(path.join(dir,'pending'),{recursive:true});
 // 这一场按「离线回传」的名字落盘：offline-<id 的 sha256 前 24 位>.json
 const id='offline-meeting-1';
 const file=path.join(dir,'pending','offline-'+crypto.createHash('sha256').update(id).digest('hex').slice(0,24)+'.json');
 fs.writeFileSync(file,JSON.stringify(sess(id,2,Date.parse('2026-09-20T02:00:00Z'))));
 const child=boot(dir,port);
 try{
  await ready(port);
  // 把请求体分两次发，中间往盘上追加一条转写——模拟「会还在录，POST 在路上」
  const body=JSON.stringify({eventId:'ev-1'});
  const done=new Promise((resolve,reject)=>{
   const rq=http.request({host:'127.0.0.1',port,method:'POST',path:'/asr-relay/calendar-match?id='+id+'&token='+TOKEN,
     headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},
     rs=>{let out='';rs.on('data',c=>out+=c);rs.on('end',()=>resolve({status:rs.statusCode,body:out}));});
   rq.on('error',reject);
   rq.write(body.slice(0,5));
   setTimeout(()=>{
    const cur=JSON.parse(fs.readFileSync(file,'utf8'));
    cur.transcript.push({at:3,text:'请求在路上时录到的第三句'});
    fs.writeFileSync(file,JSON.stringify(cur));
    rq.end(body.slice(5));
   },250);
  });
  const r=await done;
  assert.equal(r.status,200,'offline- 命名的会也要找得到（S1：按 id 找文件不能写死 sess-）');
  const after=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(after.transcript.length,3,'中途写进来的那句不能被旧快照盖掉');
  assert.equal(after.calendar.chosen,'ev-1','要改的那个字段确实改了');
  assert.equal(fs.readdirSync(path.join(dir,'pending')).filter(f=>f.endsWith('.tmp')).length,0,'原子写不留 .tmp');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('R6 离线回传：会已存盘，排不进会后整理也不算失败',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-r6-')),port=await freePort(),base='http://127.0.0.1:'+port+'/asr-relay';
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 // 摆一份「正在归档」的 job，让 enqueue 抛「本场正在归档」
 const id='sess-busy-1',key=crypto.createHash('sha256').update(id).digest('hex').slice(0,16);
 const pipe=path.join(dir,'state','meeting-pipeline');fs.mkdirSync(pipe,{recursive:true});
 fs.writeFileSync(path.join(pipe,key+'.input.json'),JSON.stringify({id,transcript:[{at:1,text:'旧的一句'}]}));
 fs.writeFileSync(path.join(pipe,key+'.job.json'),JSON.stringify({key,sessionId:id,title:'忙着',status:'running',phase:'整理中',created:new Date().toISOString(),attempts:0,input:path.join(pipe,key+'.input.json')}));
 const child=boot(dir,port);
 try{
  await ready(port);
  const r=await fetch(base+'/session?token='+TOKEN,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({...sess(id,4,Date.parse('2026-09-21T02:00:00Z')),transcript:[{at:1,text:'新的一句'},{at:2,text:'又一句'}]})});
  const j=await r.json();
  assert.equal(r.status,200,'会已经存盘了，不该回 400');
  assert.equal(j.ok,true);
  assert.equal(j.queued,false,'排队没成也要如实说');
  assert.match(String(j.reason||''),/归档/);
  const f=path.join(dir,'pending','offline-'+crypto.createHash('sha256').update(id).digest('hex').slice(0,24)+'.json');
  assert.equal(JSON.parse(fs.readFileSync(f,'utf8')).transcript.length,2,'会确实存下来了');
  assert.equal(fs.existsSync(path.join(dir,'exports')),false,'exports/ 的调试残留已经停写');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

// D1 + R7：工作台那个 5 分钟全量重写的定时器要加两道门。
// 这一组必须在「非测试模式」下跑（THT_TEST=1 时整个定时器都不装），所以自己起服务，
// 用 THT_HUB_SYNC_MS 把 5 分钟缩成秒级。
async function hubSyncCase(name,{upstream,recording,waitMs,every}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-hub-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 fs.mkdirSync(path.join(dir,'pending'),{recursive:true});
 fs.writeFileSync(path.join(dir,'pending','sess-hub-1.json'),JSON.stringify(sess('hub-1',4,Date.parse('2026-09-20T02:00:00Z'))));
 const env={THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_LARK_CLI:'/usr/bin/false',THT_HUB_SYNC_MS:String(every)};
 if(upstream)env.THT_HUB_UPSTREAM=upstream;
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,...env,THT_TEST:''},stdio:'ignore'});
 let ws=null;
 try{
  await ready(port);
  if(recording){
   const WS=require('ws');ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
   await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
   ws.send(JSON.stringify({type:'start',sessionId:'hub-live-1',rate:16000}));
   for(let i=0;i<40;i++){const h=await(await fetch('http://127.0.0.1:'+port+'/health')).json();if(h.activeSessions===1)break;await pause(50);}
  }
  await pause(waitMs);
  const f=path.join(dir,'state','work-hub','work-hub.json');
  const sources=fs.existsSync(f)?(JSON.parse(fs.readFileSync(f,'utf8')).sources||[]):[];
  return sources.length;
 }finally{try{if(ws)ws.terminate();}catch{}try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
}

test('D1 + R7 工作台定时全量重写：没配上游且没在录音时才跑',async()=>{
 assert.ok(await hubSyncCase('正常',{waitMs:1200,every:400})>0,'没配上游、没在录音：照跑，pending 的会应当进了本地库');
 assert.equal(await hubSyncCase('配了上游',{upstream:'http://127.0.0.1:9',waitMs:1200,every:400}),0,'配了 HUB_UPSTREAM 时本地这份没人读，不该再整读整写');
 assert.equal(await hubSyncCase('录音中',{recording:true,waitMs:3000,every:2000}),0,'正在录音时不许做这种十几兆的同步读写');
});
