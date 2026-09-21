'use strict';
// 资料库真标题。链接文字写着「Google Slides」等于没写：资料列表里一排一模一样的行，
// 点开才知道是哪份。这里守的是：平台名不当标题、读不到就明说未读取、我手改过的永远优先。
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), os=require('os'), path=require('path');
const {Hub,canonical,canonicalLegacy,missingTitle,tidyTitle}=require('../app/work-hub.js');

const fresh=fetchImpl=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-title-'));return new Hub(dir,path.join(dir,'state'),{fetch:fetchImpl});};
const page=(title,over={})=>async()=>({ok:true,headers:{get:()=>'text/html; charset=utf-8'},text:async()=>'<html><head><title>'+title+'</title></head><body>x</body></html>',...over});

test('同一份 Google / Notion 文件的各种写法归到同一个 key', ()=>{
 const g='https://docs.google.com/presentation/d/1AbC-dE_9/edit#slide=id.p3';
 assert.equal(canonical(g),'https://docs.google.com/presentation/d/1AbC-dE_9');
 assert.equal(canonical('https://docs.google.com/presentation/d/1AbC-dE_9/edit?usp=sharing'),canonical(g));
 assert.equal(canonical('https://docs.google.com/presentation/d/1AbC-dE_9/'),canonical(g));
 assert.equal(canonical('https://drive.google.com/file/d/XY_1/view'),'https://drive.google.com/file/d/XY_1');
 assert.equal(canonical('https://drive.google.com/drive/u/0/folders/F1'),'https://drive.google.com/drive/folders/F1');
 const id='1234567890abcdef1234567890abcdef';
 assert.equal(canonical('https://www.notion.so/team/My-Page-Title-'+id),'https://www.notion.so/'+id);
 assert.equal(canonical('https://aaron.notion.site/'+id+'?v=9'),'https://www.notion.so/'+id);
 assert.equal(canonical('https://app.notion.com/p/Chansey-Master-'+id),'https://www.notion.so/'+id);  // 库里现存的写法
 // 飞书那段不变，非白名单站点仍然按整条 URL 算
 assert.equal(canonical('https://x.larksuite.com/docx/Ab1?from=y'),'https://x.larksuite.com/docx/Ab1');
 assert.equal(canonical('https://example.com/a/b/'),'https://example.com/a/b');
 assert.equal(canonical('mailto:a@b.c'),'');
});

test('老库里按旧 key 存的 Google 记录，不会因为换归一变成重复项', ()=>{
 const hub=fresh();
 const url='https://docs.google.com/presentation/d/DECK1/edit';
 const legacy=canonicalLegacy(url);
 assert.notEqual(legacy,canonical(url));
 const old=hub.source({key:legacy,url,title:'CDCP deck',channel:'手动收集'});   // 模拟旧库里的那条
 const again=hub.source({url,title:'CDCP deck',channel:'手动收集'});             // 现在用新 key 再收一次
 assert.equal(hub.data.sources.length,1);
 assert.equal(again.id,old.id);                                                  // id 不变，待办和工作项的指向不受影响
 assert.equal(again.key,canonical(url));                                         // key 换成新的
});

test('同一份 Notion 页面换个写法再收一次，认下老记录不新建', ()=>{
 const hub=fresh();
 const stored='https://app.notion.com/p/3bfa74a06c6f81959503fb6b06191008';       // 库里现存的写法
 const old=hub.source({key:stored,url:stored,title:'硬件周会',channel:'手动收集'});
 for(const u of [stored+'?pvs=4',                                                 // 分享时多带的参数，旧 key 也对不上
                 'https://www.notion.so/AI-HW-weekly-3bfa74a06c6f81959503fb6b06191008',
                 'https://aaron.notion.site/3bfa74a0-6c6f-8195-9503-fb6b06191008']){
  const again=hub.source({url:u,title:'硬件周会',channel:'手动收集'});
  assert.equal(again.id,old.id,u+' 应当认到同一条');
 }
 assert.equal(hub.data.sources.length,1);
 // 不同文件不能被合到一起
 hub.source({url:'https://app.notion.com/p/3d0a74a0000000000000000000093983',title:'另一份',channel:'手动收集'});
 assert.equal(hub.data.sources.length,2);
});

test('平台名和空标题算没有标题，正常标题不误伤', ()=>{
 for(const t of ['Google Slides','google docs','Google 幻灯片','Notion','飞书文档','Lark Docs','Untitled','无标题','未命名文档','  ','「Untitled」',''])
  assert.equal(missingTitle(t),true,t+' 应当算没有标题');
 for(const t of ['CDCP 汇报 deck（Google Slides）','Chansey 用研 19 人','Notion 迁移方案','Untitled Hero 命名讨论'])
  assert.equal(missingTitle(t),false,t+' 是真标题，不能误判');
});

test('抓回来的标题去掉平台后缀', ()=>{
 assert.equal(tidyTitle('CDCP 汇报框架 - Google Slides'),'CDCP 汇报框架');
 assert.equal(tidyTitle('Roadmap – Google Docs'),'Roadmap');
 assert.equal(tidyTitle('Chansey 排期 | Notion'),'Chansey 排期');
 assert.equal(tidyTitle('  产品总纲  - 飞书云文档 '),'产品总纲');
 assert.equal(tidyTitle('Q4 &amp; Q1 计划'),'Q4 & Q1 计划');
});

test('收链接时标题是平台名就去抓真标题', async()=>{
 const hub=fresh(page('CDCP 汇报框架 - Google Slides'));
 hub.source({url:'https://docs.google.com/presentation/d/D1/edit',title:'Google Slides',titleState:'ok',channel:'手动收集'});
 hub.data.sources[0].titleState='unread';
 const r=await hub.resolveTitles();
 assert.equal(r.fixed,1);
 assert.equal(hub.data.sources[0].title,'CDCP 汇报框架');
 assert.equal(hub.data.sources[0].titleState,'fetched');
});

test('登录页标题、平台名标题、抓取失败，一律落到「未读取 · 域名/id」', async()=>{
 const cases=[page('Sign in - Google Accounts'),page('Google Slides'),async()=>({ok:false,headers:{get:()=>''},text:async()=>''}),async()=>{throw Error('网络不通');}];
 for(const impl of cases){
  const hub=fresh(impl);
  hub.source({url:'https://docs.google.com/presentation/d/ABCDEFGHIJ/edit',title:'Google Slides',titleState:'unread',channel:'手动收集'});
  await hub.resolveTitles();
  assert.equal(hub.data.sources[0].title,'未读取 · docs.google.com/ABCDEFGH');
  assert.equal(hub.data.sources[0].titleState,'unread');           // 还标着未读取，下次同步会再试
 }
});

test('抓取超时不拖住别的条目，也不抛出来', async()=>{
 const hub=fresh(()=>new Promise((_,reject)=>setTimeout(()=>reject(Error('abort')),20)));
 hub.source({url:'https://docs.google.com/presentation/d/SLOW1/edit',title:'Google Slides',titleState:'unread',channel:'手动收集'});
 hub.source({key:'manual:ok',title:'正常资料',channel:'手动收集'});
 const r=await hub.resolveTitles();
 assert.equal(r.checked,1); assert.equal(r.fixed,0);
 assert.equal(hub.data.sources[1].title,'正常资料');
});

test('我手改过的标题不被重新解析覆盖', async()=>{
 const hub=fresh(page('抓来的标题'));
 const s=hub.source({url:'https://docs.google.com/document/d/DOC1/edit',title:'Google Docs',titleState:'unread',channel:'手动收集'});
 hub.update('sources',s.id,{title:'我自己起的名字'},s.revision);
 assert.equal(s.titleEdited,true);
 const r=await hub.resolveTitles();
 assert.equal(r.checked,0);
 assert.equal(s.title,'我自己起的名字');
 // 索引再收一次同一条，也不能把手改的标题盖掉
 hub.ingestIndex('# 资料\n- [Google Docs](https://docs.google.com/document/d/DOC1/edit) 2026-09-21\n');
 assert.equal(s.title,'我自己起的名字');
});

test('索引收录：平台名先占位成未读取，解析到了就换成真标题，再收录不被占位盖回去', async()=>{
 const hub=fresh(page('产品需求总纲 - Google Docs'));
 hub.ingestIndex('# 资料\n- [Google Docs](https://docs.google.com/document/d/DOC2/edit) 2026-09-20\n- [Chansey 用研 19 人](https://docs.google.com/document/d/DOC3/edit) 2026-09-20\n');
 const placed=hub.data.sources.find(s=>s.key.includes('DOC2'));
 assert.equal(placed.title,'未读取 · docs.google.com/DOC2');
 assert.equal(hub.data.sources.find(s=>s.key.includes('DOC3')).title,'Chansey 用研 19 人');  // 真标题不进解析队列
 await hub.resolveTitles();
 assert.equal(placed.title,'产品需求总纲');
 hub.ingestIndex('# 资料\n- [Google Docs](https://docs.google.com/document/d/DOC2/edit) 2026-09-21\n');  // 日期变了，指纹变了
 assert.equal(placed.title,'产品需求总纲');
});

test('THT_TEST 下不发真实网络请求', async()=>{
 const before=process.env.THT_TEST;process.env.THT_TEST='1';
 try{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-title-'));
  const hub=new Hub(dir,path.join(dir,'state'));
  assert.equal(hub.fetchImpl,null);
  hub.source({url:'https://docs.google.com/document/d/NET1/edit',title:'Google Docs',titleState:'unread',channel:'手动收集'});
  const r=await hub.resolveTitles();
  assert.equal(r.fixed,0);
  assert.equal(hub.data.sources[0].title,'未读取 · docs.google.com/NET1');
 }finally{if(before===undefined)delete process.env.THT_TEST;else process.env.THT_TEST=before;}
});

// —— X7：抓标题这条路以前只挡第一跳，且整包读完才截断 ——
const seen=[];
const redirectTo=where=>({ok:false,status:302,headers:{get:k=>String(k).toLowerCase()==='location'?where:null}});
const html=title=>({ok:true,status:200,headers:{get:k=>String(k).toLowerCase()==='content-type'?'text/html':null},
                    text:async()=>'<html><head><title>'+title+'</title></head></html>'});
// 按「第几次请求」给回应，同时记下每次请求的地址和参数
const script=steps=>{let i=0;return async(url,opts)=>{seen.push({url,redirect:opts&&opts.redirect});const step=steps[Math.min(i++,steps.length-1)];return typeof step==='function'?step(url):step;};};
const unread=(hub,url)=>{hub.source({url,title:'Google Slides',titleState:'unread',channel:'手动收集'});return hub.resolveTitles();};

test('跳转到内网地址就停手，不替人探内网', async()=>{
 for(const bad of ['http://127.0.0.1:47823/admin','https://127.0.0.1/x','https://10.1.2.3/x','https://192.168.1.1/x',
                   'https://nas.local/x','https://172.16.0.9/x','http://docs.google.com/x']){
  seen.length=0;
  const hub=fresh(script([redirectTo(bad),html('内网页面')]));
  await unread(hub,'https://docs.google.com/presentation/d/RD'+seen.length+'/edit');
  assert.equal(seen.length,1,bad+'：第二跳不该发出去');
  assert.equal(hub.data.sources[0].titleState,'unread');
  assert.ok(!/内网页面/.test(hub.data.sources[0].title));
 }
});

test('跳转到公网 https 照样跟，标题取到最后那一跳的', async()=>{
 seen.length=0;
 const hub=fresh(script([redirectTo('https://www.notion.so/real'),html('Chansey 需求总纲')]));
 await unread(hub,'https://docs.google.com/presentation/d/RDOK/edit');
 assert.equal(seen.length,2);
 assert.equal(seen[1].url,'https://www.notion.so/real');
 assert.equal(seen[0].redirect,'manual','要自己跟跳转，不能交给 fetch 跟');
 assert.equal(hub.data.sources[0].title,'Chansey 需求总纲');
});

test('相对 Location 按当前这一跳解析', async()=>{
 seen.length=0;
 const hub=fresh(script([redirectTo('/d/REAL/view'),html('相对跳转的结果')]));
 await unread(hub,'https://docs.google.com/presentation/d/REL/edit');
 assert.equal(seen[1].url,'https://docs.google.com/d/REAL/view');
 assert.equal(hub.data.sources[0].title,'相对跳转的结果');
});

test('跳转环最多跟 3 跳就收手', async()=>{
 seen.length=0;
 const hub=fresh(script([redirectTo('https://docs.google.com/loop')]));
 await unread(hub,'https://docs.google.com/presentation/d/LOOPAAAA/edit');
 assert.equal(seen.length,4,'首请求 + 最多 3 跳');
 assert.equal(hub.data.sources[0].titleState,'unread');
});

test('响应体读到 300KB 就断开，不把整个流拉进内存', async()=>{
 const st={read:0,cancelled:false};
 const chunks=['<html><head><title>大页面</title></head><body>','x'.repeat(200000),'y'.repeat(200000),'z'.repeat(200000)];
 const reader={async read(){return st.read<chunks.length?{done:false,value:Buffer.from(chunks[st.read++])}:{done:true};},
               async cancel(){st.cancelled=true;},releaseLock(){}};
 const hub=fresh(async()=>({ok:true,status:200,headers:{get:k=>String(k).toLowerCase()==='content-type'?'text/html':null},
                            body:{getReader:()=>reader},text:async()=>{throw Error('不该一次性读完');}}));
 await unread(hub,'https://docs.google.com/presentation/d/BIGPAGE1/edit');
 assert.equal(hub.data.sources[0].title,'大页面');
 assert.equal(st.read,3,'读到超过上限的那一块就停，第 4 块不该再读');
 assert.equal(st.cancelled,true,'要主动把流关掉');
});
