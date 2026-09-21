'use strict';
// 候选页的界面契约。对着两次旧事故写：① 功能还在、入口没了（绑了动作却点不到）；
// ② 同一件事留了两套规则（owner 正则和 bucket 并存，谁说了算看不出来）。
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const work=read('web/work.js'), workHtml=read('web/work.html'), archive=read('web/archive.js');

test('候选页在导航里点得到，三个动作和「整场都不要」都有可见按钮', ()=>{
 assert.match(workHtml,/data-view="candidates"/,'导航里必须有会议待办这一格，否则代码在、入口没了');
 for(const [a,label,key] of [['mine','我来做','1'],['notmine','不是我的','2'],['ignore','忽略','3']])
  assert.ok(new RegExp("\\['"+a+"','"+label+"','"+key+"'\\]").test(work),'三个动作都要有按钮和键位：'+label+' / '+key);
 assert.match(work,/data-ignore-all=/,'组头要有「整场都不要」');
 assert.match(work,/id="undo-triage"/,'做过的动作必须能撤销');
 // 绑了处理就必须有地方触发它
 for(const [handler,trigger] of [['b.dataset.triage','data-triage='],['b.dataset.ignoreAll','data-ignore-all='],["b.id==='undo-triage'",'id="undo-triage"']])
  assert.ok(work.includes(handler)&&work.includes(trigger),handler+' 有处理却没有入口');
});

test('归类只有一套规则：owner 正则已经删掉', ()=>{
 assert.equal(/自己\|\^我\$\|待核实\|未指定/.test(work),false,'旧的 owner 正则必须删掉，不能和 bucket 并存');
 assert.match(work,/const bucket=w=>w\.bucket\|\|'mine'/,'归类一律读服务端算好的 bucket');
 assert.match(work,/bucket\(w\)==='mine'/,'默认页只放 mine');
});

test('回原句链接带 #t=<秒>，回看页认得它', ()=>{
 assert.match(work,/archive\.html\?id='\+encodeURIComponent\(s\.sessionId\)\+\(Number\.isFinite\(t\.atSec\)\?'#t='/,'候选行要拼出带时间的回看链接');
 assert.match(archive,/window\.addEventListener\('hashchange',jumpFromHash\)/,'换 hash 也要跳，不只是首次打开');
 // 解析那一段单独跑一遍：各种 hash 写法都要落到 jumpTo 上
 const jumped=[],c={location:{hash:''},jumpTo:s=>jumped.push(s),window:{addEventListener(){}}};
 vm.createContext(c);
 vm.runInContext(archive.slice(archive.indexOf('function jumpFromHash'),archive.indexOf('window.addEventListener(\'hashchange\'')),c);
 for(const [hash,expect] of [['#t=120',120],['#t=0',0],['#t=95.5',95.5],['#view=x&t=42',42],['',null],['#nothing',null]]){
  jumped.length=0;c.location.hash=hash;c.jumpFromHash();
  assert.deepEqual(jumped,expect===null?[]:[expect],'hash '+JSON.stringify(hash));
 }
});

test('候选分组和行渲染：按会分组、每条给得出回原句的路', ()=>{
 const c={db:{tasks:[
   {id:'t1',text:'甲',owner:'Aaron',due:'',bucket:'candidate',sourceIds:['s1'],atSec:120},
   {id:'t2',text:'乙',owner:'',due:'',bucket:'candidate',sourceIds:['s1']},            // 老数据：没有时间戳
   {id:'t3',text:'丙',owner:'',due:'',bucket:'candidate',sourceIds:['s2']},
   {id:'t4',text:'丁',owner:'',due:'',bucket:'candidate',sourceIds:[]},                // 没来源
   {id:'t5',text:'已认领ZZZ',owner:'',due:'',bucket:'mine',sourceIds:['s1']}],
  sources:[{id:'s1',title:'周会',kind:'meeting',sessionId:'sess-1',date:'2026-09-20'},
           {id:'s2',title:'产品总纲',kind:'document',url:'https://x/doc'}]},
  esc:s=>String(s??''),day:d=>d,bucket:w=>w.bucket||'mine'};
 vm.createContext(c);
 vm.runInContext(work.slice(work.indexOf('function candidateGroups()'),work.indexOf('const TRIAGE_DONE')),c);
 const gs=c.candidateGroups();
 // gs 是 vm 里造出来的数组，跨 realm 不能用 deepStrictEqual 比，转成 JSON 再比
 assert.equal(JSON.stringify(gs.map(g=>[g.source?g.source.title:'',g.tasks.length])),JSON.stringify([['周会',2],['产品总纲',1],['',1]]));
 assert.equal(c.backLink(c.db.tasks[0],gs[0].source),'archive.html?id=sess-1#t=120');
 assert.equal(c.backLink(c.db.tasks[1],gs[0].source),'archive.html?id=sess-1');   // 没时间戳也回得到这场会
 assert.equal(c.backLink(c.db.tasks[2],gs[1].source),'https://x/doc');
 assert.equal(c.backLink(c.db.tasks[3],null),'');
 const html=gs.map(c.candGroup).join('');
 assert.match(html,/data-ignore-all="s1"/);
 assert.equal(/data-ignore-all=""/.test(html),false,'没有来源的那组不给「整场都不要」');
 assert.equal((html.match(/data-cand=/g)||[]).length,4);
 assert.equal(html.includes('已认领ZZZ'),false,'已认领的不该出现在候选里');
 assert.match(html,/原句位置没记下来/);
});
