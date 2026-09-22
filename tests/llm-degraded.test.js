'use strict';
// 降级要看得见：首选的命令行模型没回应、备用接口顶上时，健康检查和页面都得知道；首选恢复后撤掉。
// 用假的 claude 命令行（放在临时 HOME 下，排在真的前面）和假的 OpenAI 兼容接口，走真的服务进程。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

test('首选模型失败、备用接口成功 → 标记降级；首选恢复 → 撤掉；两条路都断 → 红条而不是降级',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-degraded-')),home=path.join(dir,'home'),bin=path.join(home,'.local/bin');
 fs.mkdirSync(bin,{recursive:true});
 const cli=path.join(bin,'claude');
 const setCli=body=>{fs.writeFileSync(cli,'#!/bin/sh\ncat >/dev/null\n'+body+'\n');fs.chmodSync(cli,0o755);};
 let apiOk=true,apiHits=0;
 const api=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{apiHits++;
  if(!apiOk){res.writeHead(401,{'content-type':'application/json'});return res.end(JSON.stringify({error:{type:'invalid_request_error',message:'bad key'}}));}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({model:'fake-backup',choices:[{message:{content:'备用模型的回答'}}],usage:{prompt_tokens:3,completion_tokens:4}}));});});
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 const port=await freePort(),base='http://127.0.0.1:'+port;
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:'t'.repeat(32),LLM_PROVIDER:'claude',DEEPSEEK_API_KEY:'test-key',LLM_BASE_URL:'http://127.0.0.1:'+api.address().port,LLM_MODEL:'fake-backup',ARCHIVE_TARGET:'local'}));
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,HOME:home,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
 const health=async()=>(await fetch(base+'/health')).json();
 const ask=async()=>{const r=await fetch(base+'/hub/llm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'ping',tier:'quick'})});return{status:r.status,body:await r.json().catch(()=>({}))};};
 try{
  for(let i=0;i<60;i++){try{await health();break;}catch{await pause(100);}}
  let h=await health();assert.equal(h.llmDegraded,false);

  setCli('echo boom >&2; exit 1');
  let r=await ask();assert.equal(r.status,200);assert.equal(r.body.text,'备用模型的回答');assert.equal(apiHits,1);
  h=await health();assert.equal(h.llmDegraded,true);assert.match(h.llmDegradedReason,/^claude:cli_exit_1$/);assert.equal(h.llmDown,false);

  setCli("printf '%s' '{\"result\":\"首选模型的回答\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}'");
  r=await ask();assert.equal(r.body.text,'首选模型的回答');assert.equal(apiHits,1,'首选成功就不该再打备用接口');
  h=await health();assert.equal(h.llmDegraded,false);assert.equal(h.llmDegradedReason,'');

  setCli('exit 1');apiOk=false;
  for(let i=0;i<3;i++)await ask();
  h=await health();assert.equal(h.llmDown,true);assert.equal(h.llmDegraded,false,'两条路都断时只亮红条');
 }finally{try{child.kill('SIGTERM');}catch{}api.closeAllConnections();api.close();await pause(150);fs.rmSync(dir,{recursive:true,force:true});}
});

test('页面接得住降级：有黄条、收得到广播、刷新后从健康检查恢复、红条亮时黄条让位',()=>{
 const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
 assert.match(html,/id="llm-degraded-bar"[^>]*hidden/);
 assert.match(html,/m\.type === 'llm_degraded'\) setLlmDegraded\(/);
 assert.match(html,/setLlmDegraded\(!!h\.llmDegraded/);
 assert.match(html,/bar\.hidden = !on \|\| llmDownNow/);
});
