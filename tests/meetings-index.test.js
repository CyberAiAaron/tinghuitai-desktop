'use strict';
// 会议索引：桌面版管线每场登记一行；同 id 重跑覆盖；镜像到记忆投影目录；回填不调模型。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawnSync}=require('child_process');
const PIPE=path.join(__dirname,'..','app','meeting-pipeline.py');
function setup(){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'tht-index-')),mirror=path.join(data,'mirror'),state=path.join(data,'state','meeting-pipeline');
 fs.mkdirSync(state,{recursive:true});fs.mkdirSync(mirror);
 fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({MEMORY_PROJECTION_DIR:mirror}));
 const put=(id,start,title,summary)=>{fs.writeFileSync(path.join(state,id+'.json'),JSON.stringify({sessionId:id,status:'done'}));fs.writeFileSync(path.join(state,id+'.enhanced.json'),JSON.stringify({id,start,topicTitle:title,summary}));};
 const run=()=>spawnSync('python3',[PIPE,'--reindex'],{env:{...process.env,THT_DATA_DIR:data,THT_PIPELINE_DIR:state,THT_MEMORY_PROJECTION_DIR:''},encoding:'utf8'});
 return {data,mirror,state,put,run};
}
test('reindex writes one row per summarised meeting, newest first, and mirrors it',()=>{
 const h=setup();
 h.put('sess-a','2026-09-16T02:00:00.000Z','屏幕选型','# 屏幕选型\n\n会议比较了两种屏幕方案并决定先做小屏。\n\n---\n## 一\n细节');
 h.put('sess-b','2026-09-17T02:00:00.000Z','说话人 | 区分','一句话结论：只做匿名区分，真名会后手填。 关键决定 无');
 h.put('sess-c','2026-09-18T02:00:00.000Z','','# 没标题的不登记\n\n正文正文正文正文正文正文');
 h.put('sess-d','2026-09-18T03:00:00.000Z','有标题没总结','');
 const r=h.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{indexed:2});
 const body=fs.readFileSync(path.join(h.data,'meetings-index.md'),'utf8');
 const rows=body.split('\n').filter(l=>l.startsWith('| 2026'));
 assert.equal(rows.length,2);assert.match(rows[0],/sess-b/);assert.match(rows[1],/sess-a/);
 assert.match(rows[0],/说话人 ／ 区分/);assert.match(rows[0],/只做匿名区分，真名会后手填/);
 assert.match(rows[1],/会议比较了两种屏幕方案并决定先做小屏/);
 assert.equal(rows[1].split('|').length,6,'a pipe inside a title or summary must not break the table');
 assert.equal(fs.readFileSync(path.join(h.mirror,'meetings-index.md'),'utf8'),body);
});
test('re-running keeps one row per id and preserves rows written earlier',()=>{
 const h=setup();
 fs.writeFileSync(path.join(h.data,'meetings-index.md'),'# 会议索引\n\n| 日期 | 主题 | id | 一句话结论 |\n|---|---|---|---|\n| 2026-09-02 12:18 | 旧会 | yc-old | 旧结论 |\n');
 h.put('sess-a','2026-09-16T02:00:00.000Z','屏幕选型','# t\n\n第一版结论写在这里足够长。');
 assert.equal(h.run().status,0);
 h.put('sess-a','2026-09-16T02:00:00.000Z','屏幕选型（改）','# t\n\n第二版结论写在这里足够长。');
 assert.equal(h.run().status,0);
 const rows=fs.readFileSync(path.join(h.data,'meetings-index.md'),'utf8').split('\n').filter(l=>l.startsWith('| 2026'));
 assert.equal(rows.filter(l=>l.includes('sess-a')).length,1);assert.match(rows[0],/屏幕选型（改）/);assert.match(rows[0],/第二版/);
 assert.ok(rows.some(l=>l.includes('yc-old')));
});
test('trash drops and restores a row through the same locked writer, and the mirror follows',()=>{
 const h=setup();h.put('sess-a','2026-09-16T02:00:00.000Z','屏幕\n选型','# t\n\n第一版结论写在这里足够长。');h.put('sess-b','2026-09-17T02:00:00.000Z','另一场','# t\n\n另一场的结论写在这里足够长。');
 assert.equal(h.run().status,0);
 const main=path.join(h.data,'meetings-index.md'),mirror=path.join(h.mirror,'meetings-index.md');
 const row=fs.readFileSync(main,'utf8').split('\n').find(l=>l.includes('sess-a'));assert.match(row,/屏幕 选型/,'a newline in a title is flattened');
 const cli=(op,input)=>spawnSync('python3',[PIPE,op],{input,encoding:'utf8',env:{...process.env,THT_DATA_DIR:h.data,THT_PIPELINE_DIR:h.state,THT_MEMORY_PROJECTION_DIR:''}});
 assert.equal(cli('--index-drop-line',row).status,0);
 assert.ok(!fs.readFileSync(main,'utf8').includes('sess-a'));assert.ok(fs.readFileSync(main,'utf8').includes('sess-b'));assert.equal(fs.readFileSync(mirror,'utf8'),fs.readFileSync(main,'utf8'));
 assert.equal(cli('--index-add-line',row).status,0);assert.equal(cli('--index-add-line',row).status,0);
 const rows=fs.readFileSync(main,'utf8').split('\n').filter(l=>l.startsWith('| 2026'));assert.equal(rows.length,2,'restoring twice does not duplicate');assert.match(rows[0],/sess-b/);
 assert.equal(fs.readFileSync(mirror,'utf8'),fs.readFileSync(main,'utf8'));
 assert.equal(cli('--index-add-line','not a row').status,2);assert.equal(cli('--index-add-line','| a |\n| b |').status,2);
});
