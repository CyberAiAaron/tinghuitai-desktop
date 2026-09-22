'use strict';
// 第 9 条（2026-09-22 只读复审）：/meeting-action 的「发」（建日历 / 派任务）以前只靠 card.state==='sent' 挡重发。
// 工具超时这种「不知道发没发出去」的情况，卡没标 sent，再点一下就是第二条真日历。
// 现在这条路和 /share-send 一样走 app/send-gate.js：
//   ① 确定没发成（飞书明确拒了）→ 不留收据，同一份内容能直接再试
//   ② 不确定（工具超时）→ 留 pending 收据；再点不带 retryConfirmed → 409；带了才真发
//   ③ 发成之后再点 → 被 state==='sent' 挡住，不调命令
// 假 lark-cli 按 mode 文件行事：reject / hang / ok。绝不真外发。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const actions=require('../app/actions');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='m'.repeat(40);

function fakeCli(dir){
 const bin=path.join(dir,'fake-lark-cli'),logFile=path.join(dir,'cli-calls.log'),modeFile=path.join(dir,'cli-mode');
 fs.writeFileSync(bin,`#!/bin/bash
printf '%s\\n' "$(printf '%s ' "$@" | tr '\\n' ' ')" >> ${JSON.stringify(logFile)}   # 参数里有换行（议程），一次调用只记一行
MODE=$(cat ${JSON.stringify(modeFile)} 2>/dev/null || echo ok)
case "$MODE" in
  hang) sleep 4; exit 0 ;;
  reject) echo '{"error":{"message":"飞书拒绝了：没有日历权限"}}'; exit 0 ;;
  *) echo '{"data":{"event":{"event_id":"ev_gate","app_link":"https://example.invalid/cal/ev_gate"}}}' ;;
esac
`);
 fs.chmodSync(bin,0o755);
 return {bin,mode:m=>fs.writeFileSync(modeFile,m),calls:()=>{try{return fs.readFileSync(logFile,'utf8').split('\n').filter(Boolean);}catch(e){return [];}}};
}

test('第 9 条 /meeting-action 的「发」走外发门禁：确定失败可直接重试；不确定失败要 retryConfirmed；发成后再点不重发',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-actgate-')),port=await freePort(),base='http://127.0.0.1:'+port+'/asr-relay';
 const cli=fakeCli(dir);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 const sid='gate-meet-1',cardId='c-0123456789ab',actDir=path.join(dir,'state','meeting-pipeline');
 fs.mkdirSync(actDir,{recursive:true});
 const draft={title:'对齐 D1 的会',agenda:['D1 绑定与否'],attendees:[],slots:[{start:'2026-09-23T10:00:00+08:00',end:'2026-09-23T10:30:00+08:00'}],note:'',pick:0};
 fs.writeFileSync(actions.fileOf(actDir,sid),JSON.stringify({sessionId:sid,cards:[{id:cardId,kind:'meeting',state:'open',text:'约一场 D1 对齐会',draft}]}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:cli.bin,THT_TOOL_TIMEOUT_MS:'500'},stdio:'ignore'});
 const post=async body=>{const r=await fetch(base+'/meeting-action?token='+TOKEN,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:sid,cardId,do:'send',draft,...body})});return {status:r.status,j:await r.json()};};
 const receipts=()=>{try{return fs.readdirSync(path.join(dir,'state','send-receipts','meeting-action')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,'state','send-receipts','meeting-action',f),'utf8')));}catch(e){return [];}};
 try{
  for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)break;}catch(e){}await pause(100);}
  // 没确认：门禁前就拦，一条命令不跑
  assert.equal((await post({confirmed:false})).status,400);
  assert.deepEqual(cli.calls(),[]);
  // ① 飞书明确拒了 = 确定没发成：不留 pending 收据
  cli.mode('reject');
  const rej=await post({confirmed:true});
  assert.equal(rej.status,400);assert.match(String(rej.j.error||''),/拒绝/);assert.ok(!rej.j.uncertain,'明确拒绝不算不确定');
  assert.equal(cli.calls().length,1,JSON.stringify(cli.calls()));
  assert.equal(receipts().length,0,'确定失败不该留收据');
  // ② 工具超时 = 不确定：留 pending 收据
  cli.mode('hang');
  const hung=await post({confirmed:true});
  assert.equal(hung.status,400);assert.equal(hung.j.uncertain,true,'超时要标成不确定：'+JSON.stringify(hung.j));
  assert.equal(cli.calls().length,2,'超时那一次命令是真跑了的');
  assert.equal(receipts().length,1);assert.equal(receipts()[0].status,'pending');
  // 对面已经恢复正常，但不带 retryConfirmed 再点 → 409，不调命令
  cli.mode('ok');
  const blocked=await post({confirmed:true});
  assert.equal(blocked.status,409,JSON.stringify(blocked.j));assert.equal(blocked.j.uncertain,true);assert.match(String(blocked.j.error||''),/核对|确认/);
  assert.equal(cli.calls().length,2,'没带 retryConfirmed 不许重发');
  // 带了 retryConfirmed 才真发
  const sent=await post({confirmed:true,retryConfirmed:true});
  assert.equal(sent.status,200,JSON.stringify(sent.j));assert.equal(sent.j.ok,true);
  assert.equal(sent.j.card.state,'sent');assert.equal(sent.j.card.sentRef.url,'https://example.invalid/cal/ev_gate');
  assert.equal(cli.calls().length,3);
  assert.equal(receipts()[0].status,'sent');
  // ③ 发成之后再点：state==='sent' 挡住，不调命令，回 alreadySent
  const again=await post({confirmed:true});
  assert.equal(again.status,200);assert.equal(again.j.ok,true);assert.equal(again.j.alreadySent,true);assert.equal(again.j.card.state,'sent');
  assert.equal(cli.calls().length,3,'已发出的卡再点不许重发');
  // 收据在、卡没标 sent（模拟上次发完没来得及写卡）：再点按收据补记，不调命令
  const f=actions.fileOf(actDir,sid),data=JSON.parse(fs.readFileSync(f,'utf8'));
  data.cards[0].state='open';delete data.cards[0].sentRef;fs.writeFileSync(f,JSON.stringify(data));
  const repaired=await post({confirmed:true});
  assert.equal(repaired.status,200,JSON.stringify(repaired.j));assert.equal(repaired.j.alreadySent,true);
  assert.equal(repaired.j.card.state,'sent');assert.equal(repaired.j.card.sentRef.url,'https://example.invalid/cal/ev_gate');
  assert.equal(cli.calls().length,3,'收据说发过了就不许再发');
  assert.equal(JSON.parse(fs.readFileSync(f,'utf8')).cards[0].state,'sent','补记要落盘');
 }finally{try{child.kill('SIGTERM');}catch(e){}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('第 9 条 页面侧：不确定的卡再点先问一句、带 retryConfirmed；archive.js 版本号加一',()=>{
 const js=fs.readFileSync(path.join(root,'web/archive.js'),'utf8');
 const fn=js.slice(js.indexOf('async function actDo('),js.indexOf('\n}\n',js.indexOf('async function actDo('))+3);
 assert.ok(fn.includes('actUncertain.has(cardId)')&&fn.includes('confirm(')&&fn.includes('body.retryConfirmed=true'),'再点要先 confirm 再带 retryConfirmed');
 assert.ok(fn.includes('if(j.uncertain)actUncertain.add(cardId)'),'服务端说不确定要记住这张卡');
 assert.ok(fn.includes('actUncertain.delete(cardId)'),'发成了要把标记清掉');
 assert.ok(js.includes('上次没确认发没发出去，确定再发？'));
 assert.match(fs.readFileSync(path.join(root,'web/archive.html'),'utf8'),/archive\.js\?v=17"/);
});
