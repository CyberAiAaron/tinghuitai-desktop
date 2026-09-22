'use strict';
// R9（2026-09-22 架构审查）：会中每条 final 都整场重写 journal。改成 2 秒合并写，但结束帧和收尾一定要落盘：
//   ① 节流器本身：窗口内 N 次 call 只真跑「首次 + 窗口末尾」两次；flush 立刻补；stop 丢弃
//   ② 真服务：连发 8 条 final 后 journal 不是马上有 8 句（合并了），2 秒后有；紧接着 end 帧 → pending 里 8 句一句不少、journal 标 complete
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const {trailing}=require('../app/write-throttle');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='k'.repeat(48);

test('尾沿节流：窗口内 10 次 call 只真跑 2 次；flush 立刻补一次；stop 把欠着的丢掉',async()=>{
 let n=0;const t=trailing(()=>n++,150);
 for(let i=0;i<10;i++)t.call();
 assert.equal(n,1,'第一次要立刻跑');assert.equal(t.pending,true);
 await pause(260);
 assert.equal(n,2,'窗口末尾只补一次');assert.equal(t.pending,false);
 t.call();assert.equal(t.pending,true,'离上次真跑不到 150ms，该欠着');
 t.flush();assert.equal(n,3,'flush 立刻跑');assert.equal(t.pending,false);
 t.call();t.stop();await pause(260);
 assert.equal(n,3,'stop 之后欠着的那次不该再跑');
});

test('R9 真服务：连发 final 合并落盘，2 秒内落齐；end 帧紧跟着来也一句不丢，journal 标 complete',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-ckpt-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const base='http://127.0.0.1:'+port,journalFile=path.join(dir,'state','live-sessions','ckpt-1.json'),pendingFile=path.join(dir,'pending','sess-ckpt-1.json');
 const readJ=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return null;}};
 const line=i=>'第 '+i+' 句：这句话要能在 journal 和 pending 里原样找到，编号 '+i;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
  await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:'ckpt-1',rate:16000,source:'mac'}));});
  // 开场那次 checkpoint 已经落了一版（0 句）。紧接着连发 8 条 final：都落在 2 秒窗口里，应该被合并
  for(let i=1;i<=8;i++)ws.send(JSON.stringify({type:'__test_final',text:line(i)}));
  await pause(350);
  const early=readJ(journalFile);
  assert.ok(early,'开场就该有 journal');
  assert.ok((early.transcript||[]).length<8,'8 条 final 连着来不该写 8 次盘（350ms 后 journal 里已有 '+(early.transcript||[]).length+' 句）');
  let full=null;for(let i=0;i<40;i++){full=readJ(journalFile);if(full&&(full.transcript||[]).length===8)break;await pause(100);}
  assert.equal((full.transcript||[]).length,8,'窗口过了 journal 里要有全部 8 句');
  assert.equal(full.transcript[7].text,line(8));assert.equal(full.complete,false);
  // 再发 3 条，立刻 end：这 3 条落在新窗口里、还没来得及写，end 必须把它们一起带上
  for(let i=9;i<=11;i++)ws.send(JSON.stringify({type:'__test_final',text:line(i)}));
  await new Promise(res=>{ws.on('message',m=>{try{if(JSON.parse(m).type==='ended')res();}catch(e){}});ws.send(JSON.stringify({type:'end'}));});
  let pend=null;for(let i=0;i<50;i++){pend=readJ(pendingFile);if(pend)break;await pause(100);}
  assert.ok(pend,'end 之后要有 pending');
  assert.equal((pend.transcript||[]).length,11,'结束帧前那几句不能丢');
  assert.equal(pend.transcript[10].text,line(11));
  let done=null;for(let i=0;i<30;i++){done=readJ(journalFile);if(done&&done.complete)break;await pause(100);}
  assert.equal(done.complete,true,'收尾要把 journal 标 complete');
  assert.equal((done.transcript||[]).length,11);
  // 收尾之后节流窗口里不该再冒出一次 complete:false 的写入把它盖回去
  await pause(2300);
  assert.equal(readJ(journalFile).complete,true,'收尾后的尾沿写把 complete 盖掉了');
  ws.terminate();
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('R9 进程被 SIGTERM：节流窗口里欠着的那次先写盘再退出',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-ckpt2-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const base='http://127.0.0.1:'+port,journalFile=path.join(dir,'state','live-sessions','ckpt-2.json');
 const readJ=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return null;}};
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
  await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:'ckpt-2',rate:16000,source:'mac'}));});
  for(let i=1;i<=5;i++)ws.send(JSON.stringify({type:'__test_final',text:'进程要被杀之前说的第 '+i+' 句'}));
  // 等服务把这 5 条收进内存（/health 能回就说明事件循环转过一圈了），但不等 2 秒窗口
  await pause(300);
  assert.ok((readJ(journalFile).transcript||[]).length<5,'前提：这 5 句此刻还欠在节流窗口里');
  const exited=new Promise(res=>child.once('exit',res));
  child.kill('SIGTERM');await exited;
  assert.equal((readJ(journalFile).transcript||[]).length,5,'SIGTERM 前没把欠着的那次写掉');
  assert.equal(readJ(journalFile).complete,false,'被杀的场次不算结束，留给启动补收尾');
  ws.terminate();
 }finally{try{child.kill('SIGKILL');}catch(e){}fs.rmSync(dir,{recursive:true,force:true});}
});
