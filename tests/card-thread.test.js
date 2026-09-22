'use strict';
// 卡片对话框（第③批）四条：线程持久化、并发排队（≤2）、超时、授权规则（发消息类首轮只给只读工具，用户回「是」后才放开）。
// claude 用假可执行文件顶替（THT_CLAUDE_BIN，同 tests/calendar-fail.test.js 的 PATH 注入思路）：把 argv 和 stdin 记到文件里，按环境变量睡一会儿，再吐一段 claude -p --output-format json 形状的输出。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const TOKEN='t'.repeat(48);

// 假 claude：每次调用追加一行 JSON {argv, stdin, start, end} 到 $FAKE_LOG；睡 $FAKE_SLEEP 秒；回 $FAKE_RESULT
function fakeClaude(dir){
 const f=path.join(dir,'claude');
 fs.writeFileSync(f,`#!${process.execPath}
const fs=require('fs');const start=Date.now();let stdin='';
process.stdin.on('data',d=>stdin+=d);
process.stdin.on('end',()=>{
  const sl=Number(process.env.FAKE_SLEEP||0)*1000;
  setTimeout(()=>{
    fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify({argv:process.argv.slice(2),stdin,start,end:Date.now()})+'\\n');
    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:process.env.FAKE_RESULT||'好的，记下了',total_cost_usd:0.0123,usage:{input_tokens:1200,output_tokens:80,cache_read_input_tokens:300}}));
  },sl);
});
`);
 fs.chmodSync(f,0o755);return f;
}

async function setup(extraEnv){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-thread-')),port=await freePort();
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(dir,'mem')}));
 fs.mkdirSync(path.join(dir,'pending'),{recursive:true});
 const bin=fakeClaude(dir),logf=path.join(dir,'fake.log');
 // 一场已结束的会：一条带 id 的待办 + 日历 + 几段转写
 const sess={id:'th1',title:'测试会',start:'2026-09-22T06:00:00.000Z',end:'2026-09-22T07:00:00.000Z',transcript:[{t:1,text:'我们下周约 Cary 和 Ray 对硬件',spk:'Aaron'},{t:5,text:'好，我来安排',spk:'新宇'}],highlights:[{id:'h1',text:'硬件方案下周对齐',at:1}],
  todos:[{id:'todo1',text:'约 Cary Luo 和 Ray Zhang 对硬件 notion',owner:'本人',how:'先看两人下周忙闲'}],factchecks:[],calendar:{checkedAt:1,event:{title:'对对硬件notion',start:'2026-09-22T14:15:00+08:00',end:'2026-09-22T15:00:00+08:00',organizer:'Cary Luo',attendees:['Cary Luo','Ray Zhang','Aaron Wang']}}};
 fs.writeFileSync(path.join(dir,'pending','sess-th1.json'),JSON.stringify(sess));
 let stderr='';
 const child=spawn(process.execPath,[path.join(root,'app/server.js')],
  {env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_CLAUDE_BIN:bin,FAKE_LOG:logf,THT_LARK_CLI:path.join(dir,'no-lark-cli'),...(extraEnv||{})},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',d=>{stderr+=d;});
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health?token='+TOKEN)).ok)break;}catch(e){}await pause(100);}
 const base='http://127.0.0.1:'+port;
 const post=(sid,card,text)=>fetch(`${base}/thread/${sid}/${card}?token=${TOKEN}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})}).then(async r=>({status:r.status,json:await r.json()}));
 const calls=()=>fs.existsSync(logf)?fs.readFileSync(logf,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
 return {dir,port,base,child,post,calls,stderr:()=>stderr,pendingFile:path.join(dir,'pending','sess-th1.json'),
  async done(){const exited=new Promise(r=>{if(child.exitCode!==null||child.signalCode)return r();child.once('exit',r);});try{child.kill('SIGTERM');}catch(e){}await Promise.race([exited,pause(1500)]);fs.rmSync(dir,{recursive:true,force:true});}};
}
const argOf=(argv,flag)=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:'';};
// --allowedTools 后面一串到下一个 -- 开头为止
const allowedOf=argv=>{const i=argv.indexOf('--allowedTools');if(i<0)return[];const out=[];for(let k=i+1;k<argv.length&&!argv[k].startsWith('--');k++)out.push(argv[k]);return out;};

test('线程持久化：POST 后 GET 能读回、pending 文件里有 threads、用量进 /health',async()=>{
 const t=await setup();
 try{
  const r=await t.post('th1','todo1','这件事先查一下两人下周忙闲');
  assert.equal(r.status,200,JSON.stringify(r.json));
  assert.equal(r.json.ok,true);assert.equal(r.json.reply,'好的，记下了');
  assert.equal(r.json.messages.length,2);assert.equal(r.json.messages[0].role,'user');assert.equal(r.json.messages[1].role,'agent');
  const g=await(await fetch(`${t.base}/thread/th1?token=${TOKEN}`)).json();
  assert.equal(g.threads.todo1.length,2);
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.equal(onDisk.threads.todo1.length,2,'线程要落到会话文件');
  assert.equal(onDisk.todos.length,1,'原有字段不能丢');
  assert.equal(onDisk.threads.usage.calls,1);assert.equal(onDisk.threads.usage.input,1500);
  const h=await(await fetch(`${t.base}/health?token=${TOKEN}`)).json();
  assert.equal(h.threadTokensToday,1580);assert.equal(h.threadUsageToday.calls,1);
  // 系统提示里带了卡片、会议、转写、日历
  const c=t.calls()[0];const sys=argOf(c.argv,'--system-prompt');
  for(const k of ['约 Cary Luo 和 Ray Zhang','对对硬件notion','我们下周约 Cary','先看两人下周忙闲','回复 ≤3 行中文'])assert.ok(sys.includes(k),'系统提示缺：'+k);
  assert.equal(argOf(c.argv,'--model'),'sonnet');assert.equal(argOf(c.argv,'--max-turns'),'6');assert.equal(argOf(c.argv,'--output-format'),'json');
  assert.equal(c.stdin,'这件事先查一下两人下周忙闲');
  // 再发一句：历史进系统提示
  const r2=await t.post('th1','todo1','那就约周三');
  assert.equal(r2.json.messages.length,4);
  assert.ok(argOf(t.calls()[1].argv,'--system-prompt').includes('Aaron：这件事先查一下两人下周忙闲'));
  // 找不到的卡 / 场次
  assert.equal((await t.post('th1','nope','x')).status,404);
  assert.equal((await t.post('zzz','todo1','x')).status,404);
  assert.doesNotMatch(t.stderr(),/uncaughtException|unhandledRejection/i);
 }finally{await t.done();}
});

test('并发排队：同时来 4 条，同一时刻最多 2 个 claude 进程',async()=>{
 const t=await setup({FAKE_SLEEP:'1.2'});
 try{
  const t0=Date.now();
  const rs=await Promise.all(['a','b','c','d'].map(k=>t.post('th1','todo1','并发'+k)));
  for(const r of rs)assert.equal(r.status,200);
  const el=Date.now()-t0;
  assert.ok(el>=2200,'4 条 ×1.2s 限 2 并发至少要 2.4s，实际 '+el+'ms');
  const c=t.calls().sort((a,b)=>a.start-b.start);
  assert.equal(c.length,4);
  // 第 3 个开始时间 ≥ 前两个里最早结束的
  assert.ok(c[2].start>=Math.min(c[0].end,c[1].end)-5,'第 3 个不能在前两个都没结束时开始');
  let maxOverlap=0;for(const x of c){maxOverlap=Math.max(maxOverlap,c.filter(y=>y.start<=x.start&&y.end>x.start).length);}
  assert.ok(maxOverlap<=2,'并发超过 2：'+maxOverlap);
  assert.equal(JSON.parse(fs.readFileSync(t.pendingFile,'utf8')).threads.todo1.length,8);
 }finally{await t.done();}
});

test('超时：claude 卡住超过限时 → 回「没做成」，进程被收掉，线程里留错误条',async()=>{
 const t=await setup({FAKE_SLEEP:'20',THT_THREAD_TIMEOUT_MS:'800'});
 try{
  const t0=Date.now();
  const r=await t.post('th1','todo1','慢一点');
  assert.ok(Date.now()-t0<5000,'800ms 超时应很快回，实际 '+(Date.now()-t0)+'ms');
  assert.equal(r.status,200);assert.equal(r.json.ok,false);assert.equal(r.json.error,'timeout');
  assert.match(r.json.reply,/没做成.*120 秒|没做成/);
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.equal(onDisk.threads.todo1[1].error,'timeout');
  assert.equal(t.child.exitCode,null);
  assert.doesNotMatch(t.stderr(),/uncaughtException|unhandledRejection/i);
 }finally{await t.done();}
});

test('授权规则：发消息类首轮只有只读工具、系统提示写明只能问；回「是」后才放开写工具；回别的仍不放',async()=>{
 const t=await setup({FAKE_RESULT:'是不是约这几位：Cary Luo、Ray Zhang，2026-09-24 14:00？'});
 try{
  const r1=await t.post('th1','todo1','你直接帮我安排去约了');
  assert.equal(r1.status,200);assert.match(r1.json.reply,/是不是约/);assert.equal(r1.json.confirmed,false);
  const a1=allowedOf(t.calls()[0].argv);
  assert.ok(a1.length>0);
  for(const w of ['mcp__lark-mcp','Bash(lark-cli:*)','mcp__claude.ai Slack','mcp__claude.ai Notion'])assert.ok(!a1.includes(w),'首轮不能放开 '+w);
  assert.ok(a1.some(x=>/freebusy|contact/.test(x)),'首轮要有只读工具');
  assert.ok(argOf(t.calls()[0].argv,'--system-prompt').includes('未确认轮次'));
  assert.ok(t.calls()[0].argv.includes('--strict-mcp-config'),'默认不连 ~/.claude.json 里的连接器（省 token）');
  assert.ok(!t.calls()[0].argv.includes('--mcp-config'),'没开 THT_THREAD_MCP 就不挂 lark-mcp');
  // 回「是」→ 放开
  const r2=await t.post('th1','todo1','是');
  assert.equal(r2.json.confirmed,true);
  const a2=allowedOf(t.calls()[1].argv);
  assert.ok(a2.includes('Bash(lark-cli:*)'),'确认后要放开 lark-cli 全部子命令');
  assert.ok(!a2.includes('mcp__lark-mcp'),'没开 MCP 就不该出现 mcp 工具');
  assert.ok(argOf(t.calls()[1].argv,'--system-prompt').includes('用户刚确认'));
  // 回别的（改需求）→ 不算确认
  const r3=await t.post('th1','todo1','改成周五再约');
  assert.equal(r3.json.confirmed,false);
  assert.ok(!allowedOf(t.calls()[2].argv).includes('Bash(lark-cli:*)'));
  // 上一条不是问句时，「是」也不算确认
  const ct=require(path.join(root,'app/card-thread'));
  assert.equal(ct.isConfirmation('是',[{role:'agent',text:'已经建好了。'}]),false);
  assert.equal(ct.isConfirmation('是的',[{role:'agent',text:'要不要现在发？'}]),true);
  assert.equal(ct.isConfirmation('是，但改成周五',[{role:'agent',text:'要不要现在发？'}]),false);
 }finally{await t.done();}
});
