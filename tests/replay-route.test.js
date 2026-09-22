'use strict';
// THT-R3：零要点场「重新整理」这条路走真服务：首次点 → 按逐字稿补跑、进度按段可见；并发点 → 409 不重跑；
// 跑完 pending 里的要点带 sourceRefs（能追到转写片段）；再次点 → 不再补跑（replay.doneAt 已在），只做整理。
// 模型用放在临时 HOME 下的假 claude 命令行，每次调用睡 0.4 秒，好让进度那一句被抓到。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='r'.repeat(40);

test('零要点场补跑：首次 / 并发 / 再次，进度可见，结果带来源引用',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-replay-')),home=path.join(dir,'home'),bin=path.join(home,'.local/bin');
 fs.mkdirSync(bin,{recursive:true});
 // 假 claude：不管问什么都回一条落在本段时间范围内的要点（at=5，两段各 40 句 × 5 秒，第二段的 at 落到 205）
 const reply={highlights:[{text:'这段的要点',at:5},{text:'第二段的要点',at:205}],todos:[{text:'把方案发出来',owner:'Aaron',due:'',at:5}],factchecks:[]};
 fs.writeFileSync(path.join(bin,'claude'),'#!/bin/sh\ncat >/dev/null\nsleep 0.4\nprintf %s '+JSON.stringify(JSON.stringify({result:JSON.stringify(reply),usage:{input_tokens:1,output_tokens:1}}))+'\n');
 fs.chmodSync(path.join(bin,'claude'),0o755);
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const pending=path.join(dir,'pending');fs.mkdirSync(pending,{recursive:true});
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,LLM_PROVIDER:'claude',ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const rows=Array.from({length:80},(_,i)=>({id:'g'+i,at:i*5,t:'0:0'+i,text:'零要点那场的第 '+i+' 句，讨论方案'}));
 const file=path.join(pending,'sess-zero1.json');
 fs.writeFileSync(file,JSON.stringify({id:'zero1',title:'零要点的会',start:'2026-09-18T01:00:00.000Z',end:'2026-09-18T02:00:00.000Z',transcript:rows,highlights:[],todos:[],factchecks:[],names:{}}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,HOME:home,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const retry=async id=>{const r=await fetch(base+'/meeting-retry?token='+TOKEN,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const state=async id=>(await fetch(base+'/meeting-refresh-state?id='+id+'&token='+TOKEN)).json();
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  // 首次：接单，说明在按逐字稿补跑
  const first=await retry('zero1');
  assert.equal(first.status,200);assert.match(first.body.note||'',/按逐字稿补跑/);
  // 并发：同一场再点一次 → 409，不起第二个补跑
  const dup=await retry('zero1');
  assert.equal(dup.status,409);assert.match(dup.body.note||'',/正在重新整理/);
  // 进度：能看到「第 k / 2 段」
  let phases=new Set(),done=false;
  for(let i=0;i<200;i++){const s=await state('zero1');if(s.state==='running')phases.add(s.phase||'');else{done=true;assert.notEqual(s.state,'failed','补跑失败：'+JSON.stringify(s));break;}await pause(50);}
  assert.ok(done,'补跑一直没结束，最后的阶段：'+[...phases].join(' | '));
  assert.ok([...phases].some(p=>/第 \d+ \/ 2 段/.test(p)),'没看到按段的进度：'+[...phases].join(' | '));
  // 结果：要点落盘、带 sourceRefs、标了 replay；重复文本只留一条
  const sess=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.ok(sess.highlights.length>=2,'要点没补出来：'+sess.highlights.length);
  for(const h of sess.highlights){assert.ok(h.replay,'补出来的要点要标 replay');assert.ok(Array.isArray(h.sourceRefs)&&h.sourceRefs.length>0,'要点要能追到转写片段');for(const ref of h.sourceRefs){assert.ok(ref&&ref.segId,'每条出处都要有 segId：'+JSON.stringify(ref));assert.ok(sess.transcript.some(r=>r.id===ref.segId),'segId 要真存在：'+ref.segId);}}
  assert.equal(sess.todos.length,1,'同一条待办两段都回了，只能留一条');
  assert.ok(sess.replay?.doneAt&&sess.replay.chunks===2,'replay 收据不对：'+JSON.stringify(sess.replay));
  // 再次点：已经补跑过，不再补跑；接受但 note 不再是「按逐字稿补跑」
  const again=await retry('zero1');
  assert.equal(again.status,200);assert.doesNotMatch(again.body.note||'',/按逐字稿补跑/);
  for(let i=0;i<200;i++){const s=await state('zero1');if(s.state!=='running')break;await pause(50);}
  const sess2=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(sess2.replay.doneAt,sess.replay.doneAt,'第二次点不该重跑补跑');
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
