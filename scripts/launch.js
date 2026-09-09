'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),net=require('net');
const settings=require('../app/config'),port=Number(process.env.THT_PORT||47823),base='http://127.0.0.1:'+port;
async function health(){try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1500)});const j=await r.json();return j.app==='tinghuitai-desktop'&&j.ok;}catch{return false;}}
async function launch(){if(!await health()){
 const free=await new Promise(resolve=>{const s=net.createServer();s.on('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});if(!free)throw Error('端口 '+port+' 已被其他程序占用。未关闭该程序，请让AI设置另一个 THT_PORT。');
 const fd=fs.openSync(path.join(settings.dataDir,'launcher.log'),'a',0o600);const child=spawn(process.execPath,[path.join(__dirname,'../app/server.js')],{env:process.env,detached:true,stdio:['ignore',fd,fd]});child.on('error',()=>{});child.unref();fs.writeFileSync(path.join(settings.dataDir,'server.pid'),String(child.pid));fs.closeSync(fd);
 for(let i=0;i<30&&!await health();i++)await new Promise(r=>setTimeout(r,200));
 if(!await health())throw Error('听会台未启动，请运行 自检.command。');
 }
 const c=settings.load();const url=base+'/tinghuitai/'+(c.VOLC_APP_KEY&&c.VOLC_ACCESS_KEY&&c.DEEPSEEK_API_KEY?'index.html':'setup.html');
 if(process.platform==='darwin'&&!process.env.THT_NO_OPEN)spawn('open',[url],{stdio:'ignore'}).unref();console.log('听会台已启动：'+url+'\n关闭浏览器不会删除记录。Mac休眠或关机时不能继续转写。');}
launch().catch(e=>{console.error(e.message);process.exitCode=1;});
