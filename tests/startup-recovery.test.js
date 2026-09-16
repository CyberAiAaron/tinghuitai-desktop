const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),{execFile}=require('child_process'),{promisify}=require('util');
const exec=promisify(execFile),root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('process ownership accepts a Node symlink only for the exact installed server',()=>{
 const {ownsServer}=require('../scripts/process-owner'),serverPath='/Applications/LiveMate/program/app/server.js',rootDir='/Applications/LiveMate/program';
 let commandLine='/Users/test/bin/node-link '+serverPath,cwd='/tmp/unrelated',executable='/opt/node/bin/node';
 const run=(command,args)=>{
  if(command==='/bin/ps')return commandLine;
  if(args.includes('cwd'))return 'p42\nfcwd\nn'+cwd;
  return 'p42\nftxt\nn'+executable;
 };
 const realpath=file=>file==='/Users/test/bin/node-link'?'/opt/node/bin/node':file;
 const check=()=>ownsServer(42,{serverPath,rootDir,nodePaths:['/Users/test/bin/node-link'],run,realpath});
 assert.equal(check(),true);
 executable='/opt/other/node';assert.equal(check(),false);
 executable='/opt/node/bin/node';commandLine='/Users/test/bin/node-link app/server.js';cwd=rootDir;assert.equal(check(),true);
 cwd='/Applications/Other/program';assert.equal(check(),false);
});
test('installed launcher recovers stale Node path, missing Python path and an idle old process without changing settings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-start-')),program=path.join(dir,'program');fs.mkdirSync(program);
 for(const n of ['app','web','scripts','node_modules','package.json','package-lock.json','启动.command'])fs.cpSync(path.join(root,n),path.join(program,n),{recursive:true});
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const env={...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1'};
 const base='http://127.0.0.1:'+port;let latest;
 const launch=()=>exec('/bin/bash',[path.join(program,'启动.command')],{env,timeout:20000});
 try{
  fs.writeFileSync(path.join(dir,'node-path'),'/missing/old-node');
  const first=await launch();assert.match(first.stdout,/已启动/);latest=await(await fetch(base+'/health')).json();const pid=latest.pid;
  assert(fs.existsSync(fs.readFileSync(path.join(dir,'node-path'),'utf8').trim()));
  const before=fs.readFileSync(path.join(dir,'settings.json'),'utf8');
  await launch();assert.equal((await(await fetch(base+'/health')).json()).pid,pid);
  const pkg=JSON.parse(fs.readFileSync(path.join(program,'package.json')));pkg.version='99.0.0';fs.writeFileSync(path.join(program,'package.json'),JSON.stringify(pkg));
  await launch();latest=await(await fetch(base+'/health')).json();assert.equal(latest.version,'99.0.0');assert.notEqual(latest.pid,pid);assert.equal(fs.readFileSync(path.join(dir,'settings.json'),'utf8'),before);
  const WS=require('ws'),token=JSON.parse(before).RELAY_TOKEN,ws=new WS(base.replace('http','ws')+'?token='+token);
  await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej);});ws.send(JSON.stringify({type:'start',sessionId:'launcher-active-test',rate:16000}));
  for(let i=0;i<20;i++){latest=await(await fetch(base+'/health')).json();if(latest.activeSessions===1)break;await pause(50);}
  assert.equal(latest.activeSessions,1);pkg.version='99.0.1';fs.writeFileSync(path.join(program,'package.json'),JSON.stringify(pkg));
  await assert.rejects(launch(),e=>/会议仍在进行/.test(e.stderr));assert.equal((await(await fetch(base+'/health')).json()).pid,latest.pid);ws.terminate();
 }finally{try{latest=await(await fetch(base+'/health')).json();if(latest.pid)process.kill(latest.pid,'SIGTERM');}catch{}await pause(100);fs.rmSync(dir,{recursive:true,force:true});}
});
