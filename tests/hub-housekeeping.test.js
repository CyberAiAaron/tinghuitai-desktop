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
