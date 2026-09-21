'use strict';
// 工作台库的家务事：备份别无限堆（D8）、没变化就别重写 12MB（D1 的本机这一半）。
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), os=require('os'), path=require('path');
const {Hub}=require('../app/work-hub.js');

const fresh=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'tht-hub-'));return {root,hub:new Hub(root,path.join(root,'state'))};};
const day=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);   // n 天前的日期串

test('清备份只清自己这套命名的，救命档一份不碰', ()=>{
 const {hub}=fresh(), dir=hub.dir;
 const keep=['work-hub.previous.json','work-hub.json.before-merge-1789887974740.json',
             'work-hub.json.before-repair-1790000212970.json','events-abc123.json','translations.json',
             'backup-'+day(0)+'.json','backup-'+day(13)+'.json','backup-2026-09-12.json.bak','backup-xx.json'];
 const gone=['backup-'+day(30)+'.json','backup-'+day(90)+'.json'];
 for(const n of [...keep,...gone])fs.writeFileSync(path.join(dir,n),'{}');
 const removed=hub.pruneBackups();
 assert.deepEqual(removed.sort(),gone.sort());
 for(const n of keep)assert.ok(fs.existsSync(path.join(dir,n)),n+' 不该被删');
 for(const n of gone)assert.ok(!fs.existsSync(path.join(dir,n)),n+' 该被删');
});

test('保留天数是边界清楚的：14 天内留着，更老的删掉', ()=>{
 const {hub}=fresh(), dir=hub.dir;
 for(const n of [0,1,13,15,40])fs.writeFileSync(path.join(dir,'backup-'+day(n)+'.json'),'{}');
 hub.pruneBackups();
 for(const n of [0,1,13])assert.ok(fs.existsSync(path.join(dir,'backup-'+day(n)+'.json')),n+' 天前的该留着');
 for(const n of [15,40])assert.ok(!fs.existsSync(path.join(dir,'backup-'+day(n)+'.json')),n+' 天前的该删掉');
});

test('存盘建当天备份时会顺手清老的（不用另外有人来打扫）', ()=>{
 const {hub}=fresh(), dir=hub.dir;
 const old='backup-'+day(60)+'.json', rescue='work-hub.json.before-merge-1.json';
 fs.writeFileSync(path.join(dir,old),'{}');fs.writeFileSync(path.join(dir,rescue),'{}');
 hub.save();
 assert.ok(fs.existsSync(path.join(dir,'backup-'+day(0)+'.json')),'当天备份照常建');
 assert.ok(!fs.existsSync(path.join(dir,old)),'老备份该被清掉');
 assert.ok(fs.existsSync(path.join(dir,rescue)),'救命档不该被碰');
});

test('目录读不出来时只是不清，不抛错把存盘带崩', ()=>{
 const {hub}=fresh();
 hub.dir=path.join(os.tmpdir(),'tht-这个目录不存在-'+Date.now());
 assert.deepEqual(hub.pruneBackups(),[]);
});

// —— D1 的本机这一半：syncDisk 每 5 分钟跑一次，没变化时不该把 12MB 重写一遍 ——
const putSession=(root,id,text)=>{const dir=path.join(root,'pending');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'sess-'+id+'.json'),JSON.stringify({id,title:'会 '+id,start:'2026-09-22T01:00:00.000Z',summary:'',transcript:[{t:'00:01',speaker:'S0',text}]}));};

test('第一次同步有新会议，照常落盘', ()=>{
 const {root,hub}=fresh();
 putSession(root,'a','第一句');
 const r=hub.syncDisk();
 assert.equal(r.changed,true);
 assert.ok(fs.existsSync(path.join(hub.dir,'work-hub.json')));
 assert.equal(hub.data.sources.length,1);
});

test('磁盘上什么都没变时，一个字节都不重写', ()=>{
 const {root,hub}=fresh();
 putSession(root,'a','第一句');
 hub.syncDisk();
 const file=path.join(hub.dir,'work-hub.json'), before=fs.readFileSync(file);
 const r=hub.syncDisk();
 assert.equal(r.changed,false);
 assert.deepEqual(fs.readFileSync(file),before,'没变化就不该重写正本');
 assert.ok(hub.data.sync.disk.at,'同步时间戳仍然在内存里更新，下次真有变化时一起写下去');
});

test('会议内容真的变了，还是要落盘', ()=>{
 const {root,hub}=fresh();
 putSession(root,'a','第一句');
 hub.syncDisk();
 const file=path.join(hub.dir,'work-hub.json'), before=fs.readFileSync(file);
 putSession(root,'a','第一句 加了一段');
 const r=hub.syncDisk();
 assert.equal(r.changed,true);
 assert.notDeepEqual(fs.readFileSync(file),before);
 assert.ok(/加了一段/.test(hub.data.sources[0].body));
});

test('新会议进来也算变化', ()=>{
 const {root,hub}=fresh();
 putSession(root,'a','第一句');
 hub.syncDisk();
 putSession(root,'b','另一场');
 assert.equal(hub.syncDisk().changed,true);
 assert.equal(hub.data.sources.length,2);
});
