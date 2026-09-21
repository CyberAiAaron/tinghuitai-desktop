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
