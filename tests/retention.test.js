'use strict';
// 录音保留期（2026-09-22 Aaron 定「录音保留三十天，文字一直保留」）：
//   ① sweep 单元：31 天前的删；29 天前的、正在录的、非录音扩展名的都留；days=0 一个不删
//   ② 真服务：启动后自动扫一次，/health 带 audioRetention；被清掉的会 /audio 回 404 JSON 说明是保留期清理，
//      从没录过的回 missing；正在录的会哪怕文件很老也不删
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const retention=require('../app/retention');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='r'.repeat(48);
const DAY=86400000;
function mk(dir,name,ageDays,bytes=64){const f=path.join(dir,name);fs.writeFileSync(f,Buffer.alloc(bytes,1));const t=(Date.now()-ageDays*DAY)/1000;fs.utimesSync(f,t,t);return f;}

test('sweep：只删 31 天前的录音；29 天前、正在录、非录音扩展名一个不碰；days=0 不清理',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-ret-'));const audio=path.join(dir,'audio');fs.mkdirSync(audio);
 try{
  mk(audio,'old1.pcm',31,1000);mk(audio,'import-1.m4a',45,500);mk(audio,'import-2.wav.partial',40,300);
  mk(audio,'fresh.pcm',29);mk(audio,'live.pcm',60);mk(audio,'notes.json',90);mk(audio,'readme.txt',90);mk(audio,'old2.pcm.bak',90);
  const zero=retention.sweep({audioDir:audio,days:0,dataDir:dir});
  assert.equal(zero.deleted.length,0);assert.equal(fs.readdirSync(audio).length,8,'days=0 什么都不该删');
  const r=retention.sweep({audioDir:audio,days:30,dataDir:dir,isRecording:id=>id==='live'});
  assert.deepEqual(r.deleted.map(d=>d.file).sort(),['import-1.m4a','import-2.wav.partial','old1.pcm']);
  assert.equal(r.freedBytes,1800);assert.equal(r.kept,2,'fresh 和 live 算 kept');assert.equal(r.skipped,3,'非录音扩展名算 skipped');
  assert.ok(r.deleted.find(d=>d.file==='old1.pcm').ageDays>=31);
  assert.deepEqual(fs.readdirSync(audio).sort(),['fresh.pcm','live.pcm','notes.json','old2.pcm.bak','readme.txt']);
  assert.equal(retention.wasSwept(dir,'old1'),true);assert.equal(retention.wasSwept(dir,'import-1'),true);assert.equal(retention.wasSwept(dir,'fresh'),false);
  const st=retention.status(dir,'30');assert.equal(st.days,30);assert.equal(st.lastDeleted,3);assert.equal(st.lastFreedBytes,1800);assert.ok(st.lastSweepAt>0);
  assert.equal(retention.daysFrom(undefined),30);assert.equal(retention.daysFrom('abc'),30);assert.equal(retention.daysFrom('0'),0);assert.equal(retention.daysFrom(-3),30);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('真服务：启动后自动清理；/health 带 audioRetention；/audio 对被清的会回 404 JSON 说明保留期；正在录的会不删',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-ret2-')),port=await freePort();const audio=path.join(dir,'audio');fs.mkdirSync(audio);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 mk(audio,'gone-1.pcm',31,2000);mk(audio,'keep-1.pcm',29,100);mk(audio,'ret-live.pcm',60,100);mk(audio,'text.json',90);
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',THT_RETENTION_FIRST_MS:'1500'},stdio:'ignore'});
 const base='http://127.0.0.1:'+port;const health=async()=>(await fetch(base+'/health')).json();
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  const h0=await health();assert.equal(h0.audioRetention.days,30);assert.equal(h0.audioRetention.lastSweepAt,0,'还没到 60 秒不该扫');
  // 用 ret-live 这个 id 开一场会：文件是追加打开的，60 天前的 mtime 不变，只能靠「正在录」保住
  const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
  await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:'ret-live',rate:16000,source:'mac'}));});
  let h;for(let i=0;i<60;i++){h=await health();if(h.audioRetention.lastSweepAt>0)break;await pause(100);}
  assert.ok(h.audioRetention.lastSweepAt>0,'启动后没自动扫');assert.equal(h.audioRetention.lastDeleted,1);assert.equal(h.audioRetention.lastFreedBytes,2000);
  assert.deepEqual(fs.readdirSync(audio).sort(),['keep-1.pcm','ret-live.pcm','text.json'],'只该删 gone-1.pcm');
  const log=fs.readFileSync(path.join(dir,'events.log'),'utf8');assert.match(log,/录音清理 保留30天 删1个 释放2000B/);
  const gone=await fetch(base+'/audio?id=gone-1&token='+TOKEN);assert.equal(gone.status,404);assert.equal(gone.headers.get('x-audio-gone'),'retention');
  const gj=await gone.json();assert.equal(gj.reason,'retention');assert.equal(gj.days,30);assert.match(gj.error,/30 天保留期/);
  const head=await fetch(base+'/audio?id=gone-1&token='+TOKEN,{method:'HEAD'});assert.equal(head.status,404);assert.equal(head.headers.get('x-audio-gone'),'retention');
  const never=await fetch(base+'/audio?id=never-had&token='+TOKEN);assert.equal(never.status,404);assert.equal(never.headers.get('x-audio-gone'),'missing');assert.equal((await never.json()).reason,'missing');
  const keep=await fetch(base+'/audio?id=keep-1&token='+TOKEN,{method:'HEAD'});assert.equal(keep.status,200);
  ws.close();
 }finally{try{child.kill('SIGTERM');}catch{}await pause(200);fs.rmSync(dir,{recursive:true,force:true});}
});
