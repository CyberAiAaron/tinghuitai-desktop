'use strict';
// 会中对日历的失败路径（Codex 复审 major #3）：lark-cli 不存在 / 挂死超时 / 非零退出 / 输出非 JSON，四种情况下
//   ① 服务照常起、会话照常开（/health activeSessions=1）
//   ② 说话人连接收到 type:'calendar' 的广播，event 为空、reason 非空
//   ③ 进程没有 uncaughtException / unhandledRejection（抓 stderr），跑完还活着
// 命令通过 THT_LARK_CLI 注入；开场延迟 THT_CALENDAR_DELAY_MS=0，挂死场景把总超时 THT_CALENDAR_TIMEOUT_MS 调到 800ms
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='e'.repeat(48);

function fakeCli(dir,name,body){const f=path.join(dir,name);fs.writeFileSync(f,'#!/bin/sh\n'+body+'\n');fs.chmodSync(f,0o755);return f;}

async function setup(cli,extraEnv){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-calfail-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 let stderr='';
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:cli,THT_CALENDAR_DELAY_MS:'0',...(extraEnv||{})},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',d=>{stderr+=d;});
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)break;}catch(e){}await pause(100);}
 return {dir,port,child,stderr:()=>stderr,async done(){const exited=new Promise(r=>{if(child.exitCode!==null||child.signalCode)return r();child.once('exit',r);});try{child.kill('SIGTERM');}catch(e){}await Promise.race([exited,pause(1500)]);fs.rmSync(dir,{recursive:true,force:true});}};
}

// 开一场会，等 type:'calendar' 广播（最多 waitMs），返回 calendar 对象或 null
async function startAndWaitCalendar(port,sid,waitMs){
 const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
 await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
 let cal=null;
 const got=new Promise(res=>{ws.on('message',m=>{try{const j=JSON.parse(String(m));if(j.type==='calendar'){cal=j.calendar;res();}}catch(e){}});});
 ws.send(JSON.stringify({type:'start',sessionId:sid,rate:16000,source:'mac'}));
 await Promise.race([got,pause(waitMs)]);
 return {ws,cal};
}

const active=async port=>(await(await fetch('http://127.0.0.1:'+port+'/health')).json()).activeSessions;

const cases=[
 {id:'missing',name:'lark-cli 不存在',cli:d=>path.join(d,'no-such-lark-cli'),wait:4000},
 {id:'exit3',name:'lark-cli 非零退出',cli:d=>fakeCli(d,'lark-fail','echo boom >&2; exit 3'),wait:4000},
 {id:'garbage',name:'lark-cli 输出非 JSON',cli:d=>fakeCli(d,'lark-garbage','echo "not json at all {{{"'),wait:4000},
 {id:'hang',name:'lark-cli 挂死超时',cli:d=>fakeCli(d,'lark-hang','sleep 30'),wait:6000,env:{THT_CALENDAR_TIMEOUT_MS:'800'}},
];

for(const c of cases){
 test('会中日历失败路径：'+c.name+' → 会照常开、广播 calendar 无 event、进程无未捕获异常',async()=>{
  const dir0=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-fakecli-'));
  const t=await setup(c.cli(dir0),c.env);
  try{
   const t0=Date.now();
   const {ws,cal}=await startAndWaitCalendar(t.port,'cal-'+c.id,c.wait);
   assert.equal(await active(t.port),1,'会话必须开着');
   assert.ok(cal,'必须收到 calendar 广播（'+c.name+'），等了 '+(Date.now()-t0)+'ms');
   assert.equal(cal.eventId,'');assert.equal(cal.title,'');
   assert.ok(cal.reason&&cal.reason.length,'reason 要说明为什么没匹配到');
   if(c.env&&c.env.THT_CALENDAR_TIMEOUT_MS)assert.ok(Date.now()-t0<5000,'总超时 800ms 应在 5s 内放行，实际 '+(Date.now()-t0)+'ms');
   assert.equal(t.child.exitCode,null,'服务进程不能退出');
   assert.doesNotMatch(t.stderr(),/uncaughtException|UnhandledPromiseRejection|unhandledRejection/i);
   ws.close();await pause(200);
   assert.equal(t.child.exitCode,null);
  }finally{await t.done();fs.rmSync(dir0,{recursive:true,force:true});}
 });
}
