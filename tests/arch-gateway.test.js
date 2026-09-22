'use strict';
// 入口门禁（2026-09-22 架构审查 X1 / X2 / X4）。三条都是「带上口令就能干」被降回「必须先过闸」：
//   X1 /hub 反代：鉴权提到代理之前，未鉴权的请求一个字节都不许到上游；跨站 POST 也拦在代理之前。
//   X2 bootstrap.js：被当脚本加载（Sec-Fetch-Dest: script）且不是同源时拒绝——同机别的端口算 same-site。
//   X4 POST /update / /update-rollback：只认本机，光有口令不行。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),http=require('http');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

test('X1 /hub 反代先鉴权；X2 bootstrap.js 不给 script 标签；X4 更新只许本机',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-gate-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const token='g'.repeat(64);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:token,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:dir}));
 // 假上游：只记「收到过什么」，永远回 200，这样「上游收不到」和「上游收到了」能分开断言
 const seen=[];
 const upstream=http.createServer((rq,rs)=>{seen.push(rq.method+' '+rq.url);rs.writeHead(200,{'Content-Type':'application/json'});rs.end('{"ok":true,"from":"upstream"}');});
 const upPort=await freePort();await new Promise(r=>upstream.listen(upPort,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false',THT_HUB_UPSTREAM:'http://127.0.0.1:'+upPort,THT_HUB_UPSTREAM_TOKEN:'u'.repeat(40)},stdio:'ignore'});
 try{
  for(let i=0;i<80;i++){try{await fetch(base+'/health');break;}catch{await pause(100);}}

  // X1-a 外网进来、不带口令：401，且假上游一次都没被碰过
  const noTok=await fetch(base+'/hub/task',{method:'POST',headers:{'x-forwarded-for':'203.0.113.9','Content-Type':'application/json'},body:'{"text":"注入的假待办"}'});
  assert.equal(noTok.status,401,'不带口令的 /hub POST 必须 401');
  assert.deepEqual(seen,[],'未鉴权的请求不许到上游');

  // X1-b 带口令：照常代理过去
  const ok=await fetch(base+'/hub/task?token='+token,{method:'POST',headers:{'x-forwarded-for':'203.0.113.9','Content-Type':'application/json'},body:'{"text":"真待办"}'});
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).from,'upstream','带口令应当被代理到上游');
  assert.equal(seen.length,1);

  // X1-c 跨站页面就算拿到口令也不行：403 拦在代理之前
  const cross=await fetch(base+'/hub/task?token='+token,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{"text":"跨站"}'});
  assert.equal(cross.status,403,'跨站 POST 必须 403');
  assert.equal(seen.length,1,'跨站请求不许到上游');

  // X2 bootstrap.js：script 标签 + 非同源 = 403；同源 script、以及不发 Sec-Fetch-* 的请求照常给
  const asScript=await fetch(base+'/tinghuitai/bootstrap.js',{headers:{'sec-fetch-dest':'script','sec-fetch-site':'same-site'}});
  assert.equal(asScript.status,403,'同机别的端口用 script 标签拉 bootstrap.js 必须被拒');
  assert.ok(!(await asScript.text()).includes(token),'403 的正文里不能带口令');
  const own=await fetch(base+'/tinghuitai/bootstrap.js',{headers:{'sec-fetch-dest':'script','sec-fetch-site':'same-origin'}});
  assert.equal(own.status,200,'自家页面同源 script 加载要照旧能用');
  assert.ok((await own.text()).includes('window.THT_BOOT'));
  assert.equal((await fetch(base+'/tinghuitai/bootstrap.js')).status,200,'不发 Sec-Fetch-* 的请求维持原行为');

  // X4 更新与回退：带着对的口令、但不是本机 → 403（不会去动程序文件）
  for(const p of ['/update','/update-rollback']){
   const r=await fetch(base+p+'?token='+token,{method:'POST',headers:{'x-forwarded-for':'203.0.113.9'}});
   assert.equal(r.status,403,p+' 非本机必须 403');
   assert.match(String((await r.json()).error||''),/只能在这台电脑/);
  }
 }finally{try{child.kill('SIGTERM');}catch{}upstream.close();await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
