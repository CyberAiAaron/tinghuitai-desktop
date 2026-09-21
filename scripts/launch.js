'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),net=require('net'),{ownsServer}=require('./process-owner');
const settings=require('../app/config'),port=Number(process.env.THT_PORT||47823),base='http://127.0.0.1:'+port;
async function health(){try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1500)});const j=await r.json();return j.app==='tinghuitai-desktop'&&j.ok?j:null;}catch{return false;}}
// 有系统守护（launchd）时，拉起和重启都交给它。自己再起一份会和守护那份抢端口，守护那份每 10 秒崩一次、日志刷屏。
// 数据目录里的 supervisor-label 文件写着守护的标签；文件不在、或标签没加载，就照原样自己起。
const {execFileSync}=require('child_process');
function supervisorLabel(){try{const l=fs.readFileSync(path.join(settings.dataDir,'supervisor-label'),'utf8').trim();if(!/^[\w.-]+$/.test(l))return '';execFileSync('/bin/launchctl',['print','gui/'+process.getuid()+'/'+l],{stdio:'ignore'});return l;}catch{return '';}}
function kick(label,restart){try{execFileSync('/bin/launchctl',['kickstart',...(restart?['-k']:[]),'gui/'+process.getuid()+'/'+label],{stdio:'ignore'});}catch{}}
async function launch(){
 const label=process.platform==='darwin'?supervisorLabel():'';
 const running=await health(),want=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8')).version;
 if(running&&running.version!==want){
   if(running.activeSessions!==0)throw Error('会议仍在进行，新版已下载。请结束会议后再打开听会台；当前录音没有被中断。');
   const pid=Number(running.pid),serverPath=path.resolve(__dirname,'../app/server.js'),rootDir=path.resolve(__dirname,'..');
   const configuredNode=(()=>{try{return fs.readFileSync(path.join(settings.dataDir,'node-path'),'utf8').trim();}catch{return '';}})();
   const owned=ownsServer(pid,{serverPath,rootDir,nodePaths:[process.execPath,configuredNode]});
   if(!owned)throw Error('此端口运行着另一份听会台，未关闭它。请从原安装位置打开，或为另一份安装选择不同端口。');
   // Recheck activity immediately before stopping only this installation's exact server command.
   const latest=await health();if(!latest||latest.pid!==pid||latest.activeSessions!==0)throw Error('服务状态已变化，请稍后重新打开。');
   if(label){kick(label,true);for(let i=0;i<50;i++){const h=await health();if(h&&h.pid!==pid)break;await new Promise(r=>setTimeout(r,200));}}
   else{
   process.kill(pid,'SIGTERM');
   for(let i=0;i<40&&await health();i++)await new Promise(r=>setTimeout(r,100));
   if(await health())throw Error('旧服务尚未退出，未强制关闭；请稍后再打开。');
   }
 }
 if(label&&!await health()){kick(label,false);for(let i=0;i<60&&!await health();i++)await new Promise(r=>setTimeout(r,200));if(!await health())throw Error('系统守护没有把听会台拉起来，请看数据目录里的 launcher.log。');}
 if(!await health()){
 const free=await new Promise(resolve=>{const s=net.createServer();s.on('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});if(!free)throw Error('端口 '+port+' 已被其他程序占用。未关闭该程序，请让AI设置另一个 THT_PORT。');
 const fd=fs.openSync(path.join(settings.dataDir,'launcher.log'),'a',0o600);const child=spawn(process.execPath,[path.join(__dirname,'../app/server.js')],{env:process.env,detached:true,stdio:['ignore',fd,fd]});child.on('error',()=>{});child.unref();fs.writeFileSync(path.join(settings.dataDir,'server.pid'),String(child.pid));fs.closeSync(fd);
 for(let i=0;i<30&&!await health();i++)await new Promise(r=>setTimeout(r,200));
 if(!await health())throw Error('听会台未启动，请运行 自检.command。');
 }
 // 服务已经在跑时也要把真实 pid 记下来。以前只有自己启动才写，
 // 于是 pid 文件会一直停在几天前那次，按它杀进程就会杀错。
 try {
   const r = await fetch(base+'/health',{signal:AbortSignal.timeout(1500)});
   const j = await r.json();
   if (j && j.pid) fs.writeFileSync(path.join(settings.dataDir,'server.pid'), String(j.pid));
 } catch(e) {}
 const c=settings.load();
 // 能不能直接开会，只取决于「有没有一条转写路子」。
 // 以前这里写死了火山两把钥匙加 DeepSeek 一把，于是选了本机转写 + Codex 的人
 // （一把钥匙都不用）每次启动都被扔回设置页。模型是会后写纪要才需要的，不该拦在门口。
 const macAsr=(()=>{try{return require('../app/mac-asr').available();}catch(e){return false;}})();
 const canListen = c.ASR_PROVIDER==='mac' ? macAsr
   : c.ASR_PROVIDER==='deepgram' ? !!c.DEEPGRAM_API_KEY
   : (c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY) ? true
   : macAsr;                                  // 什么都没配：这台机器能本机转写就直接进去
 const url=base+'/tinghuitai/'+(canListen?'index.html':'setup.html');
 if(process.platform==='darwin'&&!process.env.THT_NO_OPEN)spawn('open',[url],{stdio:'ignore'}).unref();console.log('听会台已启动：'+url+'\n关闭浏览器不会删除记录。Mac休眠或关机时不能继续转写。');}
launch().catch(e=>{console.error(e.message);process.exitCode=1;});
