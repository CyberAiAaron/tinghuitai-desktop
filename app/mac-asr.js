'use strict';
// 本机转写：macOS 自带语音识别，离线、不用 Key。
// 必须用 open -a 经 LaunchServices 启动，让这个 .app 自己当 TCC 的「负责进程」；
// 被 node 直接 spawn 会被系统以「没有隐私用途说明」SIGABRT 掉（2026-09-10 实测崩溃报告）。
// 因此音频不走管道，改成它回连一个只监听 127.0.0.1 的临时端口。
const {execFile}=require('child_process'), path=require('path'), fs=require('fs'), net=require('net'), crypto=require('crypto');
const APP=path.join(__dirname,'mac-asr','TinghuitaiSpeech.app');
const BIN=path.join(APP,'Contents','MacOS','transcriber');
const LOCALE={zh:'zh-CN',en:'en-US',id:'id-ID',pt:'pt-BR',es:'es-ES'};
const available=()=>{ try{ return process.platform==='darwin' && fs.existsSync(BIN); }catch(e){ return false; } };

class MacAsr {
  constructor(lang,onResult,log=()=>{}){
    this.locale=LOCALE[lang]||'zh-CN'; this.onResult=onResult; this.log=log;
    this.token=crypto.randomBytes(16).toString('hex');
    this.server=null; this.sock=null; this.ready=false; this.dead=false; this.restarts=0; this.buf='';
    this.pending=[]; this.pendingBytes=0; this.droppedBytes=0;   // open -a 拉起来要几秒，这几秒的音频先存着，就绪后补上
  }
  start(){
    if(this.dead) return;
    if(!available()){ this.onResult({type:'fatal',text:'这台机器上找不到本机转写程序。'}); return; }
    this.server=net.createServer(sock=>{
      if(this.sock){ sock.destroy(); return; }              // 只收第一条连接
      let authed=false;
      sock.on('data',d=>{
        this.buf+=d.toString('utf8');
        let i;
        while((i=this.buf.indexOf('\n'))>=0){
          const line=this.buf.slice(0,i); this.buf=this.buf.slice(i+1);
          if(!authed){ if(line.trim()!==this.token){ this.log('本机转写握手不对，断开'); sock.destroy(); return; } authed=true; this.sock=sock; continue; }
          let j; try{ j=JSON.parse(line); }catch(e){ continue; }
          if(j.type==='final'&&this.dead&&this.onFinalWhileDraining){ const cb=this.onFinalWhileDraining; this.onFinalWhileDraining=null; this.onResult(j); setTimeout(cb,300); continue; }
          if(j.type==='ready'){ this.ready=true; if(this.timeout){clearTimeout(this.timeout);this.timeout=null;} this.log('本机转写就绪 '+j.text+(j.onDevice?'（离线）':'（需联网）')+'，补上等待期间的 '+Math.round(this.pendingBytes/32000)+' 秒音频'); this.flush(); continue; }
          this.onResult(j);
        }
      });
      sock.on('close',()=>{ this.sock=null; this.ready=false; if(!this.dead) this.onExit(); });
      sock.on('error',()=>{});
    });
    this.server.listen(0,'127.0.0.1',()=>{
      const port=this.server.address().port;
      this.launchedAt = Date.now();
      execFile('/usr/bin/open',['-n','-a',APP,'--args',String(port),this.token,this.locale],e=>{
        if(e){ this.log('启动本机转写失败: '+e.message); this.onResult({type:'fatal',text:'启动本机转写失败：'+e.message}); }
      });
      this.timeout=setTimeout(()=>{
        if(!this.ready&&!this.dead) this.reap(), this.onResult({type:'fatal',text:'本机转写没连上。第一次用要先在弹出的窗口点「允许」；如果没看到弹窗，去「系统设置 → 隐私与安全性 → 语音识别」里打开「听会台转写」。'});
      },10000);
    });
  }
  onExit(){
    if(this.dead) return;
    if(this.restarts++<5){ this.log('本机转写断开，重连第 '+this.restarts+' 次'); this.close(); this.retryTimer=setTimeout(()=>this.start(),1500); }
    else this.onResult({type:'fatal',text:'本机转写反复断开，已停止重试。可以在设置页换回火山语音。'});
  }
  write(pcm){
    const s=this.sock;
    if(s&&!s.destroyed&&this.ready){ try{ s.write(pcm); }catch(e){} return; }
    if(this.dead) return;
    this.pending.push(Buffer.from(pcm)); this.pendingBytes+=pcm.length;
    while(this.pending.length && this.pendingBytes>32000*20){ const b=this.pending.shift(); this.pendingBytes-=b.length; this.droppedBytes+=b.length; }   // 最多存 20 秒，挤掉的才算缺口
  }
  flush(){
    const s=this.sock; if(!s||s.destroyed) return;
    for(const b of this.pending){ try{ s.write(b); }catch(e){} }
    this.pending=[]; this.pendingBytes=0;
  }
  // 没连上就放弃时，open 拉起的那个 .app 是独立进程，服务端没有它的 pid。
  // 不收掉它会常驻并占着麦克风权限，反复重试还会越堆越多。
  reap(){
    if(!this.launchedAt) return;
    this.launchedAt=0;
    // 只收自己这一份：按 bundle 路径匹配，不会误伤别的程序

    try{ require('child_process').execFile('/usr/bin/pkill',['-f','TinghuitaiSpeech.app/Contents/MacOS/transcriber'],()=>{}); }catch(e){}
  }
  close(){ try{ if(this.timeout) clearTimeout(this.timeout); }catch(e){} try{ if(this.retryTimer) clearTimeout(this.retryTimer); }catch(e){} try{ this.sock&&this.sock.destroy(); }catch(e){} try{ this.server&&this.server.close(); }catch(e){} this.sock=null; this.server=null; this.ready=false; }
  // 结束时只关写入方向，读的那头留着：小程序收到 EOF 会把最后一句吐完再退，
  // 直接 destroy 会把最后一句话丢掉。
  // 结束时等最后一句：半关写入 → 小程序收到 EOF 把最后一句吐完 → socket 关闭
  drain(ms=8000){
    return new Promise(res=>{
      const s=this.sock;
      this.dead=true;
      if(this.timeout){ clearTimeout(this.timeout); this.timeout=null; }
      if(!s||s.destroyed){ this.close(); return res(); }
      let done=false; const fin=()=>{ if(done) return; done=true; try{s.destroy();}catch(e){} this.close(); res(); };
      this.onFinalWhileDraining=fin;          // 最后一句一到就收工，不用等满超时
      s.once('close',fin); setTimeout(fin,ms);
      try{ s.end(); }catch(e){ fin(); }
    });
  }
  stop(){
    this.dead=true;
    if(this.timeout){ clearTimeout(this.timeout); this.timeout=null; }
    const s=this.sock;
    // 连上过就给它几秒自己退；没连上过（授权失败、还在启动）必须立刻收掉，
    // 否则 open 拉起的那个 .app 会常驻并占着麦克风权限，切一次语言就多一个。
    if(s&&!s.destroyed){ try{ s.end(); }catch(e){} const tm=setTimeout(()=>{ try{ s.destroy(); }catch(e){} this.close(); this.reap(); },3000); if(tm.unref) tm.unref(); }
    else { this.close(); this.reap(); }
  }
}
module.exports={MacAsr,available,BIN,APP};
