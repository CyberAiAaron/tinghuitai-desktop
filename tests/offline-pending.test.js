'use strict';
// S1（2026-09-22 架构审查）：pending 里同一场会有两种落盘名——在线场次 sess-<id>.json、离线回传 offline-<sha256(id) 前 24 位>.json。
// 以前三处写死 sess- 前缀：记忆补跑、归档后写记忆（afterArchive）、「重新整理」（/meeting-retry）。
// 离线回传的会在这三处都「找不到这一场」：永远没记忆、永远不能重新整理。现在三处统一走 pendingFileFor。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),crypto=require('crypto');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='o'.repeat(48);
const offlineName=id=>'offline-'+crypto.createHash('sha256').update(String(id)).digest('hex').slice(0,24)+'.json';

test('S1 离线回传的会（offline- 落盘名）也能「重新整理」；不存在的会仍是 400',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-offline-')),port=await freePort();
 const pending=path.join(dir,'pending');fs.mkdirSync(pending,{recursive:true});
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const rows=Array.from({length:40},(_,i)=>({id:'g'+i,at:i*5,t:'0:0'+i,text:'离线回传的第 '+i+' 句'}));
 fs.writeFileSync(path.join(pending,offlineName('off-1')),JSON.stringify({id:'off-1',title:'离线的会',start:'2026-09-22T01:00:00.000Z',end:'2026-09-22T01:30:00.000Z',mode:'offline',transcript:rows,highlights:[],todos:[],factchecks:[],names:{}}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const base='http://127.0.0.1:'+port;
 const retry=async id=>{const r=await fetch(base+'/meeting-retry?token='+TOKEN,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});return {status:r.status,text:await r.text()};};
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  const ok=await retry('off-1');
  assert.equal(ok.status,200,'离线回传的会「重新整理」被拒了：'+ok.text);
  assert.match(ok.text,/off-1/);
  const miss=await retry('nobody-here');
  assert.equal(miss.status,400);assert.match(miss.text,/找不到/);
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('S1 三处读 pending 的地方都走 pendingFileFor，不再写死 sess- 前缀',()=>{
 const src=fs.readFileSync(path.join(root,'app/server.js'),'utf8');
 const block=(from,to)=>{const a=src.indexOf(from);assert.ok(a>=0,'找不到 '+from);const b=src.indexOf(to,a);assert.ok(b>a,'找不到 '+to);return src.slice(a,b);};
 const afterArchive=block('function afterArchive(sid){','const ACTIONS_DIR=');
 const memRetry=block('const memRetryTimer=setInterval(','if(memRetryTimer.unref)');
 const reorganize=block("p.endsWith('/meeting-retry')","p.endsWith('/meeting-list')");
 for(const [name,b] of [['afterArchive 写记忆',afterArchive],['记忆补跑',memRetry],['重新整理',reorganize]]){
  assert.ok(b.includes('pendingFileFor('),name+' 没走 pendingFileFor');
  assert.ok(!b.includes("'sess-'+"),name+' 还在写死 sess- 前缀');
 }
});
