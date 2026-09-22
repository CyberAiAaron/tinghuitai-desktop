'use strict';
// 手机口令：经外网通道进来的请求不算本机，必须带口令；主口令和 PHONE_TOKENS 里的都认，其余一律 401。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
test('外网进来的请求：主口令、附加手机口令放行；错口令、过短的附加口令、不带口令都拒绝',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-token-')),port=await freePort(),base='http://127.0.0.1:'+port;
 const main='m'.repeat(64),phone='p'.repeat(32),short='s'.repeat(8);
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:main,PHONE_TOKENS:[phone,short],ARCHIVE_TARGET:'local'}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const via=async t=>(await fetch(base+'/meeting-list'+(t?'?token='+t:''),{headers:{'x-forwarded-for':'203.0.113.9'}})).status;
 try{
  for(let i=0;i<60;i++){try{await fetch(base+'/health');break;}catch{await pause(100);}}
  assert.equal(await via(main),200);assert.equal(await via(phone),200);
  assert.equal(await via(short),401);assert.equal(await via('x'.repeat(32)),401);assert.equal(await via(''),401);
  const WS=require('ws');const code=t=>new Promise(res=>{const ws=new WS(base.replace('http','ws')+'/?token='+t,{headers:{'x-forwarded-for':'203.0.113.9'}});ws.on('open',()=>setTimeout(()=>{res('open');ws.close();},400));ws.on('close',c=>res(c));ws.on('error',()=>{});});
  assert.equal(await code(phone),'open');assert.equal(await code('x'.repeat(32)),4401);
 }finally{try{child.kill('SIGTERM');}catch{}await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});
