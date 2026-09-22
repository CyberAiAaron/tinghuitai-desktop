'use strict';
// R4（2026-09-22 架构审查）会中分诊的三道保险，走真服务 + 两家假命令行（只改设置，代码里没有它们）：
//   ① 首选连续 2 次超时 → 这场后续调用 skip 掉首选，第三次起慢家一次都不再被叫
//   ② 超时次数进 /health（llmTimeouts）
//   ③ 分诊输入封顶：没分诊的转写攒到 12000 字，发给模型的【最新转写】只留最新的约 8000 字，而且留的是最新那段
// 每家等多久只在 THT_TEST 下可用 THT_LLM_TIMEOUT_MS 调短。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='g'.repeat(48);

// 假命令行：从 stdin 收 prompt 抄到 <seen>/<tag>-N.txt；慢家睡 3 秒（超过 400ms 的上限），快家立刻回一份分诊 JSON
function fakeCli(dir,tag,slow){
 const bin=path.join(dir,tag+'.sh'),seen=path.join(dir,'seen-'+tag);fs.mkdirSync(seen,{recursive:true});
 fs.writeFileSync(bin,`#!/bin/sh
N=$(ls "${seen}" | wc -l | tr -d ' ')
cat > "${seen}/in-$N.txt"
${slow?'sleep 3':''}
printf '%s' '{"highlights":[{"text":"要点 '${tag}' 第 '"$N"' 轮"}],"todos":[],"factchecks":[]}'
`);
 fs.chmodSync(bin,0o755);
 return {bin,files:()=>fs.readdirSync(seen).sort(),read:f=>fs.readFileSync(path.join(seen,f),'utf8')};
}
const words=(i,n)=>Array.from({length:n},(_,k)=>'第'+i+'段词'+k).join('，');

test('R4 首选连续 2 次超时后本场跳过首选；超时进 /health；分诊输入只留最新约 8000 字',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-triage-')),port=await freePort();
 const slow=fakeCli(dir,'slow',true),fast=fakeCli(dir,'fast',false);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem'),
  LLM_CHAIN:[{type:'cli',kind:'custom',name:'慢家',bin:slow.bin,stdin:'prompt'},{type:'cli',kind:'custom',name:'快家',bin:fast.bin,stdin:'prompt'}]}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',THT_LLM_TIMEOUT_MS:'400'},stdio:'ignore'});
 const base='http://127.0.0.1:'+port;
 const health=async()=>(await(await fetch(base+'/health')).json());
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
  await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:'triage-1',rate:16000,source:'mac'}));});
  const triage=text=>new Promise(res=>{const on=m=>{try{if(JSON.parse(m).type==='__test_triaged'){ws.off('message',on);res();}}catch(e){}};ws.on('message',on);ws.send(JSON.stringify({type:'__test_final',text,triage:true}));});
  // 第 1、2 次：慢家超时、快家顶上；第 3 次起慢家不再被叫
  await triage(words(1,12));
  assert.equal(slow.files().length,1);assert.equal(fast.files().length,1);
  await triage(words(2,12));
  assert.equal(slow.files().length,2);assert.equal(fast.files().length,2);
  assert.equal((await health()).llmTimeouts,2,'两次首选超时要进 /health');
  await triage(words(3,12));
  assert.equal(slow.files().length,2,'连续 2 次超时后这场还在叫首选');
  assert.equal(fast.files().length,3);
  assert.equal((await health()).llmTimeouts,2,'跳过首选之后不该再多算超时');
  // 分诊输入封顶：先攒 30 条各约 400 字的 final（不触发分诊），再触发一次，快家收到的【最新转写】只有最新的约 8000 字
  for(let i=10;i<40;i++)ws.send(JSON.stringify({type:'__test_final',text:words(i,40)}));
  await pause(300);
  await triage(words(99,12));
  const last=fast.read(fast.files().pop());
  // 系统提示词里也提到「【最新转写】」，要取最后一处（正文那块）
  const at=last.lastIndexOf('【最新转写】\n');assert.ok(at>0,'prompt 里没有【最新转写】');
  const recent=last.slice(at+'【最新转写】\n'.length);
  assert.ok(recent.length<=8200,'分诊输入没封顶：'+recent.length+' 字');
  assert.ok(recent.length>6000,'封顶截多了：'+recent.length+' 字');
  assert.ok(recent.includes('第99段词0'),'留的必须是最新那段');
  assert.ok(!recent.includes('第10段词0'),'最早那段该被截掉');
  assert.ok(!recent.startsWith('\n')&&/^\[\d+s\]/.test(recent.trim()),'按行切，不切半句：'+JSON.stringify(recent.slice(0,20)));
  ws.terminate();
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
