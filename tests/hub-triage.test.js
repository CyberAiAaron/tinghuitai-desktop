'use strict';
// 「我的待办 + 会议候选」。工作台默认页只放我手输的和我点过「我来做」的，
// 会议产生的先进候选。这里守两件事：归类现算不改老数据，分诊过的不被重复收录冲掉。
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), os=require('os'), path=require('path');
const {Hub,bucketOf}=require('../app/work-hub.js');
const {prepare}=require('../app/knowledge.js');

const fresh=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-hub-'));return new Hub(dir,path.join(dir,'state'));};
const session=(over={})=>({id:'sess-1',title:'周会',start:'2026-09-20T02:00:00.000Z',
 transcript:[{id:'seg-9',at:120,text:'我们下周要把口径定下来'}],
 todos:[{text:'把口径定下来',owner:'Aaron',at:120,segIds:['seg-9'],sourceRefs:[{segId:'seg-9'}]}],...over});

test('归类按状态现算，老库里没有 bucket 字段也不用迁移', ()=>{
 assert.equal(bucketOf({status:'inbox'}),'candidate');           // 会议来的，等认领
 assert.equal(bucketOf({status:'todo'}),'mine');
 assert.equal(bucketOf({status:'doing'}),'mine');
 assert.equal(bucketOf({status:'blocked'}),'mine');
 assert.equal(bucketOf({status:'done'}),'mine');                 // 没有显式归类的已完成算我的
 assert.equal(bucketOf({status:'dismissed'}),'ignored');
 assert.equal(bucketOf({key:'manual:x',status:'inbox'}),'mine'); // 手建的永远是我的
 assert.equal(bucketOf({status:'inbox',bucket:'notmine'}),'notmine'); // 点过的以显式值为准
 // owner 写「本人」「Aaron」都不再影响归类——旧的 owner 正则正是靠它把 776 条藏掉的
 assert.equal(bucketOf({status:'todo',owner:'本人'}),'mine');
 assert.equal(bucketOf({status:'todo',owner:'Shawn'}),'mine');
});

test('四个动作各自改到位，撤销回到候选', ()=>{
 const hub=fresh();
 const t=id=>hub.task({text:'事项'+id,key:'task:'+id},null);
 const [a,b,c]=[t(1),t(2),t(3)];
 hub.triage([a.id],'mine');
 assert.equal(a.bucket,'mine'); assert.equal(a.status,'todo');   // 认领了就该真的进待办，不停在 inbox
 hub.triage([b.id],'notmine');
 assert.equal(b.bucket,'notmine'); assert.equal(b.status,'inbox'); // 别人的事，状态不替他改
 hub.triage([c.id],'ignore');
 assert.equal(c.bucket,'ignored'); assert.equal(c.status,'dismissed');
 for(const x of [a,b,c])hub.triage([x.id],'restore');
 assert.deepEqual([a,b,c].map(x=>x.bucket),['candidate','candidate','candidate']);
 assert.deepEqual([a,b,c].map(x=>x.status),['inbox','inbox','inbox']);
 assert.throws(()=>hub.triage([a.id],'delete'),/未知的分诊动作/);
 assert.throws(()=>hub.triage(['t-nope'],'mine'),/待办不存在/);
});

test('撤销不推翻别处改的状态', ()=>{
 const hub=fresh();
 const t=hub.task({text:'在跑的事',key:'task:live'},null);
 t.status='doing';
 hub.triage([t.id],'restore');
 assert.equal(t.bucket,'candidate');
 assert.equal(t.status,'doing');                                  // doing 是别处改的，撤销不动它
});

test('整场都不要只动还在候选里的，认领过的留下', ()=>{
 const hub=fresh();
 const s=hub.ingestSession(session({todos:[{text:'甲'},{text:'乙'},{text:'丙'}]}));
 const mine=hub.data.tasks.find(t=>t.text==='甲');
 hub.triage([mine.id],'mine');
 const hit=hub.triageSource(s.id);
 assert.equal(hit.length,2);
 assert.equal(mine.bucket,'mine');                                 // 已认领的不被一键清掉
 assert.deepEqual(hub.data.tasks.filter(t=>bucketOf(t)==='ignored').map(t=>t.text),['乙','丙']);
 // 返回的就是被改的那几条，界面拿它们的 id 发 restore 即可撤销整场
 hub.triage(hit.map(t=>t.id),'restore');
 assert.equal(hub.data.tasks.filter(t=>bucketOf(t)==='candidate').length,2);
});

test('分诊会写进 revision 和事件，存盘后还在', ()=>{
 const hub=fresh();
 const t=hub.task({text:'留痕',key:'task:r'},null);
 const before=t.revision;
 hub.triage([t.id],'mine');
 assert.equal(t.revision,before+1);
 assert.ok(hub.data.events.some(e=>e.type==='triage'));
 const again=new Hub(hub.root,hub.dir);
 assert.equal(again.data.tasks.find(x=>x.id===t.id).bucket,'mine');
});

test('收录会议时把段号和时间戳带到待办上，回得去原句', ()=>{
 const hub=fresh();
 hub.ingestSession(session());
 const t=hub.data.tasks[0];
 assert.deepEqual(t.sourceRefs,[{segId:'seg-9'}]);
 assert.deepEqual(t.segIds,['seg-9']);
 assert.equal(t.at,120);
 assert.equal(t.atSec,120);
});

test('会中记的绝对毫秒换算成相对秒', ()=>{
 const hub=fresh();
 const start='2026-09-20T02:00:00.000Z';
 hub.ingestSession(session({start,todos:[{text:'绝对时间',at:Date.parse(start)+90_000}]}));
 assert.equal(hub.data.tasks[0].atSec,90);
});

test('同一场会重复收录，不重置我已经做过的归类', ()=>{
 const hub=fresh();
 hub.ingestSession(session());
 const t=hub.data.tasks[0];
 hub.triage([t.id],'ignore');
 hub.ingestSession(session({summary:'补了一段总结'}));            // 指纹变了，整场重新收录一次
 const after=hub.data.tasks.find(x=>x.id===t.id);
 assert.equal(hub.data.tasks.length,1);
 assert.equal(after.bucket,'ignored');
 assert.equal(after.status,'dismissed');
});

test('老待办重新收录时补上缺的段号，不动已有值', ()=>{
 const hub=fresh();
 hub.ingestSession(session({todos:[{text:'把口径定下来'}]}));      // 旧版本：没有段号
 const t=hub.data.tasks[0];
 assert.equal(t.segIds,undefined);
 hub.ingestSession(session({summary:'x'}));
 assert.deepEqual(hub.data.tasks[0].segIds,['seg-9']);
});

test('工作项的归类跟着成员走，重算不丢', ()=>{
 const hub=fresh();
 hub.ingestSession(session({todos:[{text:'甲'},{text:'乙'}]}));
 prepare(hub);
 assert.deepEqual([...new Set(hub.data.workItems.map(w=>w.bucket))],['candidate']);
 const one=hub.data.tasks.find(t=>t.text==='甲');
 hub.triage([one.id],'mine');
 prepare(hub);prepare(hub);                                        // 反复重算
 const w=hub.data.workItems.find(w=>w.memberIds.includes(one.id));
 assert.equal(w.bucket,'mine');
 // 全是 ignored/notmine 的那条才从默认页消失
 const other=hub.data.tasks.find(t=>t.text==='乙');
 hub.triage([other.id],'notmine');prepare(hub);
 assert.equal(hub.data.workItems.find(w=>w.memberIds.includes(other.id)).bucket,'notmine');
});

test('手建的待办和工作项一进来就是我的', ()=>{
 const hub=fresh();
 const t=hub.task({text:'我自己记的',status:'todo',key:'manual:'+Date.now()});
 prepare(hub);
 assert.equal(bucketOf(t),'mine');
 assert.equal(hub.data.workItems.find(w=>w.memberIds.includes(t.id)).bucket,'mine');
});

test('快照里每条待办都带算好的归类，界面不用再算一遍', ()=>{
 const hub=fresh();
 hub.ingestSession(session());
 const snap=hub.snapshot();
 assert.equal(snap.tasks[0].bucket,'candidate');
 assert.equal(hub.data.tasks[0].bucket,undefined);                 // 存的那份仍然干净，没做破坏性迁移
});

test('bucket 只收四个值，别的一律拒写', ()=>{
 const hub=fresh();
 const t=hub.task({text:'x',key:'task:x'},null);
 hub.update('tasks',t.id,{bucket:'mine'},t.revision);
 assert.equal(t.bucket,'mine');
 assert.throws(()=>hub.update('tasks',t.id,{bucket:'whatever'},t.revision),/invalid bucket/);
});
