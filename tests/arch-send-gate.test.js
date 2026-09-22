'use strict';
// 真外发的服务端门禁（2026-09-22 架构审查 X6）。三条路以前只认口令：
//   /share-send（飞书 / Slack）、/meeting-action do:'send'（建日历 / 派任务）、/sharing/bundle/lark（建飞书文档）。
// 现在每一条都要请求体里带 confirmed:true，并且同一份内容发过就不再发第二遍。
// meeting-action 那条的正反例在 tests/action-desk.test.js 里（那边有整套卡片数据）。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

// 假 lark-cli：把每次调用记一行，永远回 ok。绝不真外发。
function stubCli(dir){
 const bin=path.join(dir,'fake-lark-cli'),logFile=path.join(dir,'cli-calls.log');
 fs.writeFileSync(bin,'#!/bin/bash\nprintf \'%s\\n\' "$*" >> '+JSON.stringify(logFile)+'\necho \'{"ok":true,"data":{}}\'\n');
 fs.chmodSync(bin,0o755);
 return {bin,calls:()=>{try{return fs.readFileSync(logFile,'utf8').split('\n').filter(Boolean);}catch(e){return [];}}};
}

test('X6 /share-send：没确认不发、发过不重发；/sharing/bundle/lark 也要确认',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-sendgate-')),port=await freePort(),base='http://127.0.0.1:'+port+'/asr-relay';
 const cli=stubCli(dir);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:'s'.repeat(40),ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir,THT_ARCHIVE_OWNER_ID:'ou_selftest'}));
 const sid='sess-gate-1';
 fs.mkdirSync(path.join(dir,'pending'),{recursive:true});
 fs.writeFileSync(path.join(dir,'pending','sess-'+sid+'.json'),JSON.stringify({
  id:sid,title:'门禁测试会',start:Date.now()-6e5,end:Date.now(),
  transcript:[{at:1,text:'第一句'},{at:2,text:'第二句'}],
 }));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:cli.bin},stdio:'ignore'});
 const post=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,j:await r.json()};};
 try{
  for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)break;}catch(e){}await pause(100);}

  // 反例一：不带 confirmed → 400，且一条外发命令都没跑
  const no=await post('/share-send',{id:sid,target:'lark',chatId:'self'});
  assert.equal(no.status,400);
  assert.match(String(no.j.error||''),/确认/);
  assert.deepEqual(cli.calls(),[],'没确认时不许调任何外发命令');
  // 反例二：confirmed:false 同样拒绝（不能只看字段在不在）
  assert.equal((await post('/share-send',{id:sid,target:'lark',chatId:'self',confirmed:false})).status,400);
  assert.deepEqual(cli.calls(),[]);

  // 正例：带 confirmed 才真发
  const yes=await post('/share-send',{id:sid,target:'lark',chatId:'self',confirmed:true});
  assert.equal(yes.j.ok,true,yes.j.error||'');
  const after=cli.calls().length;
  assert.ok(after>0,'确认之后应该真的调了外发命令');

  // 幂等：同一份内容再发一次，不许再调命令
  const twice=await post('/share-send',{id:sid,target:'lark',chatId:'self',confirmed:true});
  assert.equal(twice.j.ok,true);
  assert.equal(twice.j.alreadySent,true,'同一份内容第二次应当直接回上次的收据');
  assert.equal(cli.calls().length,after,'幂等：第二次不许重发');
  // 收据确实落盘了（服务端事后能查「这一份发过」）
  assert.ok(fs.readdirSync(path.join(dir,'state','send-receipts','share-send')).length>=1);

  // /sharing/bundle/lark：门禁在 share-bundles 自己的逻辑之前
  const b1=await post('/sharing/bundle/lark?key='+'a'.repeat(32),{});
  assert.equal(b1.status,400);
  assert.match(String(b1.j.error||''),/确认/,'没确认时应当先被门禁拦下');
  const b2=await post('/sharing/bundle/lark?key='+'a'.repeat(32),{confirmed:true});
  assert.equal(b2.status,400);
  assert.doesNotMatch(String(b2.j.error||''),/确认/,'带了确认就该往下走，报的是它自己的错（找不到这份分享记录）');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
