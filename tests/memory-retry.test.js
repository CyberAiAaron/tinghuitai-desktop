'use strict';
// P-11：会议记忆抽取失败后的补跑名单。快试 3 次 → 之后一天一次再给 3 次；卡在 claiming 超过 1 小时的也捞回来。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const mem=require('../app/memory'),ops=require('../app/memory-ops');
test('补跑名单：冷却、每日再试、次数封顶、卡住的 claiming',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-memretry-'));
 try{
  const db=mem.open(dir);if(!db){return;}   // 本机 node 没有 sqlite 时整个记忆功能关闭，不测
  const ago=ms=>new Date(Date.now()-ms).toISOString(),M=60000,H=3600000;
  const put=(id,status,attempts,at)=>db.prepare("INSERT INTO ingested(meeting_id,input_hash,status,at,attempts) VALUES(?,?,?,?,?)").run(id,'h',status,at,attempts);
  put('just-failed','failed',1,ago(2*M));        // 冷却 10 分钟内：不试
  put('cooled','failed',1,ago(20*M));            // 过了冷却：试
  put('burnt-today','failed',3,ago(2*H));        // 快试 3 次用完、还不到一天：不试
  put('burnt-yesterday','failed',3,ago(25*H));   // 过了一天：再给机会
  put('capped','failed',6,ago(72*H));            // 总次数封顶：不再试
  put('claim-fresh','claiming',0,ago(5*M));      // 可能正在跑：不碰
  put('claim-stuck','claiming',0,ago(5*H));      // 进程被杀留下的：捞回来
  put('ok','done',0,ago(99*H));
  assert.deepEqual(ops.failedMeetings(dir,10).sort(),['burnt-yesterday','claim-stuck','cooled']);
  assert.equal(ops.failedMeetings(dir,1).length,1);
  ops.skipRetry(dir,'claim-stuck','原始记录已不在');
  assert.deepEqual(ops.failedMeetings(dir,10).sort(),['burnt-yesterday','cooled']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
