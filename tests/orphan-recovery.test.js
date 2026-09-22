'use strict';
// R10（2026-09-22 架构审查）：上一次进程没收尾的会（state/live-sessions 里 !complete 的 journal）
// 启动后要真被收掉：落 pending → 排归档 → journal 标 complete。三条边界：
//   够老 + 没人连着 → 收；刚更新过的 → 不动（可能还在断线宽限里）；浏览器已经连回来的 → 不动（那场在 SESSIONS 里）。
// 阈值只在 THT_TEST 下可用 THT_RECOVERY_DELAY_MS / THT_ORPHAN_AGE_MS 调短。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');const WS=require('ws');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='r'.repeat(48);

function journalOf(id,ageMs,rows){
 const now=Date.now();
 return {id,startTs:now-ageMs-600000,title:'孤儿 '+id,source:'mac',transcriptionGapSeconds:0,browserGapSeconds:0,
  transcript:rows,highlights:[],todos:[],factchecks:[],names:{},fixes:[],brief:'',hlGroups:null,uiLang:'zh',notes:'',
  assistantOriginals:{},summary:'',audioPath:'',audioSaveError:'',complete:false,updated:now-ageMs};
}
const rows=n=>Array.from({length:n},(_,i)=>({id:'g'+i,rev:1,at:i*5,t:'0:0'+i,speaker:'',text:'上次没结束那场说的第 '+i+' 句'}));

test('R10 启动补收尾：够老且没连接的 journal 落 pending + 排归档 + 标 complete；刚更新的和已连回来的不动',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-orphan-')),port=await freePort();
 const live=path.join(dir,'state','live-sessions');fs.mkdirSync(live,{recursive:true});
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const MIN=60000;
 fs.writeFileSync(path.join(live,'orph-old.json'),JSON.stringify(journalOf('orph-old',35*MIN,rows(4))));      // 35 分钟没更新：收
 fs.writeFileSync(path.join(live,'orph-fresh.json'),JSON.stringify(journalOf('orph-fresh',0,rows(2))));       // 刚更新：不动
 fs.writeFileSync(path.join(live,'orph-live.json'),JSON.stringify(journalOf('orph-live',40*MIN,rows(3))));    // 够老，但下面会有人连回来：不动
 fs.writeFileSync(path.join(live,'orph-empty.json'),JSON.stringify(journalOf('orph-empty',50*MIN,[])));       // 够老但一句没有：只标 complete，不造 pending
 fs.writeFileSync(path.join(live,'orph-done.json'),JSON.stringify({...journalOf('orph-done',90*MIN,rows(1)),complete:true}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',THT_RECOVERY_DELAY_MS:'700',THT_ORPHAN_AGE_MS:String(10*MIN)},stdio:'ignore'});
 const base='http://127.0.0.1:'+port;
 const health=async()=>(await(await fetch(base+'/health')).json());
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch(e){}await pause(100);}
  // 补收尾跑之前：4 场 !complete 都算「需要恢复」
  assert.equal((await health()).recoveryNeeded,4);
  // 浏览器连回 orph-live：这场进了 SESSIONS，补收尾必须绕开它
  const ws=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});
  await new Promise(res=>{ws.once('message',()=>res());ws.send(JSON.stringify({type:'start',sessionId:'orph-live',rate:16000,source:'mac'}));});
  assert.equal((await health()).activeSessions,1);
  // 等补收尾跑完：old 和 empty 被收，fresh 留着（live 在 SESSIONS 里不算需要恢复）
  let h;for(let i=0;i<60;i++){h=await health();if(h.recoveryNeeded===1)break;await pause(100);}
  assert.equal(h.recoveryNeeded,1,'补收尾没跑或收错了：'+JSON.stringify(h.recoveryNeeded));
  const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
  const pend=path.join(dir,'pending','sess-orph-old.json');
  assert.ok(fs.existsSync(pend),'够老的孤儿会没落 pending');
  const p=read(pend);
  assert.equal(p.transcript.length,4);assert.equal(p.transcript[3].text,'上次没结束那场说的第 3 句');
  assert.equal(p.recoveryStatus,'recovered-at-startup');assert.match(p.endReason,/补收尾/);
  assert.ok(p.start&&p.end&&Date.parse(p.end)>Date.parse(p.start),'start / end 要能算时长');
  assert.equal(read(path.join(live,'orph-old.json')).complete,true,'收完的 journal 要标 complete，不然下次启动又收一遍');
  assert.equal(read(path.join(live,'orph-empty.json')).complete,true,'一句没有的也要标 complete');
  assert.ok(!fs.existsSync(path.join(dir,'pending','sess-orph-empty.json')),'一句没有的不造空 pending');
  assert.equal(read(path.join(live,'orph-fresh.json')).complete,false,'刚更新过的不能收');
  assert.ok(!fs.existsSync(path.join(dir,'pending','sess-orph-fresh.json')));
  assert.equal(read(path.join(live,'orph-live.json')).complete,false,'有人连着的那场不能收');
  assert.ok(!fs.existsSync(path.join(dir,'pending','sess-orph-live.json')));
  // 排上了归档：/meeting-status 里有这场的任务
  const jobs=(await(await fetch(base+'/meeting-status?token='+TOKEN)).json()).jobs||[];
  assert.ok(jobs.some(j=>String(j.sessionId)==='orph-old'),'孤儿会没排进归档队列');
  assert.ok(!jobs.some(j=>String(j.sessionId)==='orph-empty'));
  // 收过的那场，浏览器再拿同一个 id 连回来要被拒（本场已结束）
  const ws2=new WS('ws://127.0.0.1:'+port+'/?token='+TOKEN);
  await new Promise((res,rej)=>{ws2.once('open',res);ws2.once('error',rej);});
  const closed=await new Promise(res=>{ws2.once('close',code=>res(code));ws2.send(JSON.stringify({type:'start',sessionId:'orph-old',rate:16000,source:'mac'}));setTimeout(()=>res('open'),1500);});
  assert.notEqual(closed,'open','已收尾的场次不该能再续');
  ws.terminate();
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
