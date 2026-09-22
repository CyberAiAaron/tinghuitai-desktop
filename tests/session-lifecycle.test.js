'use strict';
// 会中自动收尾的两条门（2026-09-22 架构审查 R1 / R2）：
//   R1 12 分钟没音频：只要这场还有 OPEN 的说话人连接就不收尾（手机锁屏、切后台时 WS 连着但没音频上行）
//   R2 断线 10 分钟宽限：removeClient 之后这场还有 OPEN 的说话人连接，就不装收尾定时器（旧连接的 close 晚于新连接的 start）
//   观众（view）连接不算说话人：只剩观众时照常收尾
// 阈值只在 THT_TEST 下可用 THT_GRACE_MS / THT_SILENCE_MS 调短，生产不受影响。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='e'.repeat(48);

function boot(dir,port,extraEnv){
 return spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',...(extraEnv||{})},stdio:'ignore'});
}
async function ready(port){for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)return;}catch(e){}await pause(100);}}
const active=async port=>(await(await fetch('http://127.0.0.1:'+port+'/health')).json()).activeSessions;
function connect(port,role){
 const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN+(role==='view'?'&role=view':''));
 return new Promise((res,rej)=>{ws.once('open',()=>res(ws));ws.once('error',rej);});
}
async function speak(port,sid){
 const ws=await connect(port,'speaker');
 await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:sid,rate:16000,source:'mac'}));});
 return ws;
}
async function setup(extraEnv){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-life-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const child=boot(dir,port,extraEnv);await ready(port);
 // 服务收到 SIGTERM 会先把欠着的 journal 写掉再退（R9），删目录要等它退完，不然撞上 ENOTEMPTY
 return {dir,port,child,async done(){const exited=new Promise(r=>{if(child.exitCode!==null||child.signalCode)return r();child.once('exit',r);});try{child.kill('SIGTERM');}catch(e){}await Promise.race([exited,pause(1500)]);fs.rmSync(dir,{recursive:true,force:true});}};
}

test('R2 旧连接断开时这场还有在线的说话人，不装收尾定时器；全断了才收尾',async()=>{
 const t=await setup({THT_GRACE_MS:'300'});
 try{
  const a=await speak(t.port,'life-r2');const b=await speak(t.port,'life-r2');
  assert.equal(await active(t.port),1);
  a.close();await pause(900);
  assert.equal(await active(t.port),1,'还有 b 在线，300ms 宽限过了也不该收尾');
  b.close();await pause(900);
  assert.equal(await active(t.port),0,'最后一条说话人连接断了，宽限到期就收尾');
 }finally{await t.done();}
});

test('R1 长时间没音频但说话人还连着不收尾；观众连接不算说话人',async()=>{
 const t=await setup({THT_SILENCE_MS:'200',THT_GRACE_MS:'300'});
 try{
  const a=await speak(t.port,'life-r1');
  await pause(1200);
  assert.equal(await active(t.port),1,'1.2s 无音频（阈值 200ms）但说话人连接 OPEN，不能自动收尾');
  const v=await connect(t.port,'view');await pause(100);
  a.close();await pause(900);
  assert.equal(await active(t.port),0,'只剩观众连接时，宽限到期照常收尾');
  v.close();
 }finally{await t.done();}
});
