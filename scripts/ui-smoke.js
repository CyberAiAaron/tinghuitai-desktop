'use strict';
// 界面冒烟：把「每个入口都点一遍，看它开得起来、也关得掉」这件事自动化。
// 起因：2026-09-11/12 连着三次是同一类问题——功能还在，界面上点不到，或者打开了关不掉。
// 这些都不是逻辑错，单元测试一条都拦不住，只能真的打开页面点一遍。
// 用法：node scripts/ui-smoke.js   （自己起隔离实例、自己开无头 Chrome、自己收摊）
const {spawn,execFileSync}=require('child_process'), fs=require('fs'), os=require('os'), path=require('path'), WebSocket=require('ws');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT=Number(process.env.SMOKE_PORT||47871), CDP=Number(process.env.SMOKE_CDP||47872);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'tht-smoke-')), PROFILE=path.join(DATA,'chrome');
const SHOTS=path.join(DATA,'shots'); fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server, chrome, ws, id=0, pending=new Map();

function send(method,params={}){ const i=++id; ws.send(JSON.stringify({id:i,method,params}));
  return new Promise((res,rej)=>{ pending.set(i,{res,rej}); setTimeout(()=>pending.has(i)&&(pending.delete(i),rej(new Error(method+' 超时'))),30000); }); }
async function evaluate(expr){
  const r=await send('Runtime.evaluate',{expression:`(async()=>{${expr}})()`,awaitPromise:true,returnByValue:true});
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||'页面里报错了');
  return r.result.value;
}
async function shot(name){ const r=await send('Page.captureScreenshot',{}); fs.writeFileSync(path.join(SHOTS,name+'.png'), Buffer.from(r.data,'base64')); }

(async ()=>{
  const fails=[]; const ok=m=>console.log('  ✅ '+m); const bad=m=>{ fails.push(m); console.log('  ❌ '+m); };
  try{
    console.log('起隔离实例 …');
    server=spawn(process.execPath,[path.join(__dirname,'../app/server.js')],
      {env:{...process.env,THT_DATA_DIR:DATA,THT_PORT:String(PORT),THT_NO_OPEN:'1'},stdio:'ignore'});
    for(let i=0;i<40;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/health`); if(r.ok) break; }catch{} await sleep(250); }

    console.log('起无头 Chrome …');
    chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${CDP}`,`--user-data-dir=${PROFILE}`,
      '--no-first-run','--window-size=1440,900','--disable-gpu','about:blank'],{stdio:'ignore'});
    let target=null;
    for(let i=0;i<40 && !target;i++){ await sleep(300);
      try{ const j=await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target=j.find(t=>t.type==='page'); }catch{} }
    if(!target) throw new Error('连不上无头 Chrome');
    ws=new WebSocket(target.webSocketDebuggerUrl,{maxPayload:64*1024*1024});
    await new Promise(r=>ws.on('open',r));
    ws.on('message',d=>{ const m=JSON.parse(d); if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id);
      m.error?p.rej(new Error(m.error.message)):p.res(m.result); } });
    await send('Page.enable'); await send('Runtime.enable');

    console.log('打开听会台 …');
    await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/tinghuitai/index.html`});
    await sleep(5000);
    await shot('00-首页');

    const errs=await evaluate(`return (window.__smokeErrors||[]).slice(0,5)`);
    if (errs && errs.length) bad('页面报错：'+errs.join(' | '));

    // ① 顶栏和页脚上每个看得见的按钮，都要点得动
    const entries=await evaluate(`
      return [...document.querySelectorAll('header button, footer button')]
        .filter(b=>b.offsetParent!==null && !b.disabled && b.id && !/^(start|stop)$/.test(b.id))
        .map(b=>({id:b.id,label:(b.textContent||'').trim().slice(0,14)}));`);
    console.log(`顶栏/页脚可见入口 ${entries.length} 个`);

    for (const e of entries){
      // 每一轮开始前先收干净，免得上一个入口留下的东西干扰判断
      await evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close()); document.querySelectorAll('.sheet.open').forEach(s=>s.classList.remove('open')); return 1`);
      await sleep(200);
      await evaluate(`document.getElementById(${JSON.stringify(e.id)}).click(); return 1`);
      await sleep(700);
      const opened=await evaluate(`
        const d=[...document.querySelectorAll('dialog[open]')].pop();
        const s=[...document.querySelectorAll('.sheet.open')].pop();
        return d?{kind:'dialog',id:d.id}:(s?{kind:'sheet',id:s.id}:null);`);
      if (!opened){ ok(`${e.label}（${e.id}）—— 不开弹窗，跳过`); continue; }
      await shot('10-'+e.id);
      // ② 开得起来就必须关得掉：Esc
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await sleep(500);
      const after=await evaluate(`return document.querySelectorAll('dialog[open], .sheet.open').length`);
      if (after>0) bad(`${e.label}（${e.id}）打开了 ${opened.id}，按 Esc 关不掉`);
      else ok(`${e.label}（${e.id}）→ ${opened.id}，Esc 能关`);
      await evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close()); return 1`);
    }

    // ③ 每个弹窗里都得有看得见的关闭/取消按钮（折叠区里的不算）
    const noClose=await evaluate(`
      const out=[];
      for (const d of document.querySelectorAll('dialog')){
        d.showModal();
        const hit=[...d.querySelectorAll('button')].some(b=>{
          if (b.closest('details:not([open])')) return false;
          if (b.getBoundingClientRect().height===0) return false;
          return /关闭|取消|Close|Cancel|×/.test((b.textContent||'')+(b.getAttribute('aria-label')||''));
        });
        if(!hit) out.push(d.id||'(无 id)');
        d.close();
      }
      return out;`);
    if (noClose.length) bad('这些弹窗里没有看得见的关闭按钮：'+noClose.join(', '));
    else ok('每个弹窗都有看得见的关闭按钮');

    console.log('\n截图在 '+SHOTS);
    console.log(fails.length ? `\n冒烟失败 ${fails.length} 条` : '\n冒烟全过');
    process.exitCode = fails.length ? 1 : 0;
  } catch(e){ console.error('冒烟跑不起来：'+e.message); process.exitCode=2; }
  finally { try{ws&&ws.close();}catch{} try{chrome&&chrome.kill();}catch{} try{server&&server.kill();}catch{} }
})();
