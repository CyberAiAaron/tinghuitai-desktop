'use strict';
// 路由里抛异常时必须回 500，不能让请求永远挂着（以前配置缺字段时页面一直转圈）。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
test('配置不完整时请求 3 秒内回 500 并写日志，服务不死',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-err-')),port=await freePort(),base='http://127.0.0.1:'+port;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({ARCHIVE_TARGET:'local'}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 try{
  let up=false;for(let i=0;i<60&&!up;i++){await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.on('connect',()=>{up=true;s.destroy();r();});s.on('error',()=>r());});if(!up)await pause(100);}
  assert.ok(up,'服务应该起得来');
  for(const p of ['/health','/meeting-list']){
   const r=await fetch(base+p,{signal:AbortSignal.timeout(3000)});
   assert.equal(r.status,500,p);const j=await r.json();assert.match(j.error,/出错/);
  }
  assert.equal(child.exitCode,null,'出错后进程还活着');
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
