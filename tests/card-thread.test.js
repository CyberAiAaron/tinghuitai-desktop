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
let sleeper=null;if(process.env.FAKE_SPAWN_SLEEP){sleeper=require('child_process').spawn('sleep',[process.env.FAKE_SPAWN_SLEEP]);fs.appendFileSync(process.env.FAKE_LOG+'.pids',sleeper.pid+'\\n');}
if(process.env.FAKE_IGNORE_TERM)process.on('SIGTERM',()=>{});
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
 const sleeperPids=()=>fs.existsSync(logf+'.pids')?fs.readFileSync(logf+'.pids','utf8').trim().split('\n').filter(Boolean).map(Number):[];
 const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
 return {dir,port,base,child,post,calls,sleeperPids,alive,stderr:()=>stderr,pendingFile:path.join(dir,'pending','sess-th1.json'),
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

test('超时：claude 卡住超过限时 → 回「没做成」，整个进程组（含它起的 sleep 子进程）被收掉，线程里留错误条',async()=>{
 const t=await setup({FAKE_SLEEP:'20',FAKE_SPAWN_SLEEP:'300',THT_THREAD_TIMEOUT_MS:'800'});
 try{
  const t0=Date.now();
  const r=await t.post('th1','todo1','慢一点');
  assert.ok(Date.now()-t0<5000,'800ms 超时应很快回，实际 '+(Date.now()-t0)+'ms');
  assert.equal(r.status,200);assert.equal(r.json.ok,false);assert.equal(r.json.error,'timeout');
  assert.match(r.json.reply,/没做成.*120 秒|没做成/);
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.equal(onDisk.threads.todo1[1].error,'timeout');
  // 进程组一起杀：假 claude 起的 sleep 300 也得死（Codex 94dd3aa4：以前只 kill 直接子进程，孙进程留着）
  const pids=t.sleeperPids();assert.equal(pids.length,1,'假 claude 应记下一个 sleep 子进程');
  await pause(300);
  assert.equal(t.alive(pids[0]),false,'sleep 子进程 '+pids[0]+' 还活着');
  assert.equal(t.child.exitCode,null);
  assert.doesNotMatch(t.stderr(),/uncaughtException|unhandledRejection/i);
 }finally{await t.done();}
});

test('超时不提前放槽：子进程不理 SIGTERM 时，等 SIGKILL 真收掉才 finish，排在后面的那条在它退出之后才起',async()=>{
 const t=await setup({FAKE_SLEEP:'20',FAKE_IGNORE_TERM:'1',THT_THREAD_TIMEOUT_MS:'600',THT_THREAD_KILL_GRACE_MS:'700',THT_THREAD_CONCURRENCY:'1'});
 try{
  const t0=Date.now();
  const [r1,r2]=await Promise.all([t.post('th1','todo1','第一条卡住'),t.post('th1','todo1','第二条等着')]);
  const el=Date.now()-t0;
  assert.equal(r1.json.error,'timeout');assert.equal(r2.json.error,'timeout');
  // 第一条：600ms 超时 + 700ms 等 SIGKILL ≈ 1.3s 才 finish；第二条要等它真退出再起，再 1.3s → 总时长 ≥ 2.4s
  assert.ok(el>=2400,'两条串行、各自等到 SIGKILL 后才释放槽，至少 2.4s，实际 '+el+'ms');
  // 假 claude 被 SIGKILL 前没来得及写日志（它睡 20s），所以用服务端的顺序证据：第二条的 user 消息在第一条的 agent 错误条之后落盘
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.equal(onDisk.threads.todo1.filter(m=>m.error==='timeout').length,2);
  assert.doesNotMatch(t.stderr(),/uncaughtException|unhandledRejection/i);
 }finally{await t.done();}
});

test('排队上限：等着的超过 maxQueue 条 → 429 queue_full，这条不进线程；队列空出来后再发照常',async()=>{
 const t=await setup({FAKE_SLEEP:'1.0',THT_THREAD_CONCURRENCY:'1',THT_THREAD_QUEUE_MAX:'2'});
 try{
  // 1 个在跑 + 2 个排队 = 3 条能进，第 4、5 条 429
  const rs=await Promise.all(['a','b','c','d','e'].map(k=>t.post('th1','todo1','排队'+k)));
  const codes=rs.map(r=>r.status).sort();
  assert.deepEqual(codes,[200,200,200,429,429],'应正好 3 条进、2 条 429：'+JSON.stringify(rs.map(r=>r.status)));
  const rej=rs.find(r=>r.status===429);
  assert.equal(rej.json.error,'queue_full');assert.match(rej.json.reply,/排队/);assert.equal(rej.json.maxQueue,2);
  assert.equal(t.calls().length,3,'只跑了 3 次 claude');
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.equal(onDisk.threads.todo1.length,6,'429 的两条不进线程：3 user + 3 agent');
  const again=await t.post('th1','todo1','空了再来');
  assert.equal(again.status,200);
 }finally{await t.done();}
});

test('鉴权：sid 不存在 404（GET / POST 都是）；role=view 不能 POST；手机副口令能 GET 不能 POST；没口令 401',async()=>{
 const t=await setup();
 try{
  const PHONE='p'.repeat(30);
  fs.writeFileSync(path.join(t.dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,PHONE_TOKENS:[PHONE],ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(t.dir,'mem')}));
  // 带一个代理头，让服务端把请求当成非本机（isLocalReq 只放没有代理头的 127.0.0.1 直连），这样才能测口令那条路
  const hit=(m,url,body)=>fetch(t.base+url,{method:m,headers:{'content-type':'application/json','x-forwarded-for':'10.0.0.9'},body:body?JSON.stringify(body):undefined}).then(r=>r.status);
  assert.equal(await hit('GET','/thread/nope?token='+TOKEN),404);
  assert.equal(await hit('POST','/thread/nope/todo1?token='+TOKEN,{text:'x'}),404);
  assert.equal(await hit('GET','/thread/th1'),401);
  assert.equal(await hit('POST','/thread/th1/todo1',{text:'x'}),401);
  assert.equal(await hit('POST','/thread/th1/todo1?token='+TOKEN+'&role=view',{text:'x'}),403,'旁听角色不能 POST');
  assert.equal(await hit('GET','/thread/th1?token='+TOKEN+'&role=view'),200,'旁听角色能 GET');
  assert.equal(await hit('GET','/thread/th1?token='+PHONE),200,'手机副口令能 GET');
  assert.equal(await hit('POST','/thread/th1/todo1?token='+PHONE,{text:'x'}),403,'手机副口令不能 POST');
  assert.equal(t.calls().length,0,'被拒的请求一次 claude 都没起');
  assert.equal(await hit('POST','/thread/th1/todo1?token='+TOKEN,{text:'主口令能发'}),200);
  assert.equal(t.calls().length,1);
 }finally{await t.done();}
});

test('授权规则：写动作首轮只有只读工具；agent 的提问记 pendingAction；紧接着回「是」只放开那个动作的一小集，且一次性消费',async()=>{
 const t=await setup({FAKE_RESULT:'是不是约这几位：Cary Luo、Ray Zhang，2026-09-24 14:00？'});
 try{
  const r1=await t.post('th1','todo1','你直接帮我安排去约了');
  assert.equal(r1.status,200);assert.match(r1.json.reply,/是不是约/);assert.equal(r1.json.confirmed,false);
  assert.equal(r1.json.pendingAction,'calendar','agent 在问约人 → 记 calendar');
  assert.equal(r1.json.messages[1].pendingAction,'calendar','pendingAction 落在 agent 那条消息上');
  const a1=allowedOf(t.calls()[0].argv);
  assert.ok(a1.length>0);
  for(const w of ['mcp__lark-mcp','Bash(lark-cli:*)','Bash(lark-cli calendar +create:*)','Bash(lark-cli im +messages-send:*)','Bash(tht-slack send:*)','mcp__claude.ai Slack','mcp__claude.ai Notion'])assert.ok(!a1.includes(w),'首轮不能放开 '+w);
  assert.ok(a1.some(x=>/freebusy|contact/.test(x)),'首轮要有只读工具');
  assert.ok(a1.includes('Bash(tht-slack search:*)'),'首轮就有 Slack 读工具');
  assert.ok(argOf(t.calls()[0].argv,'--system-prompt').includes('未确认轮次'));
  assert.ok(t.calls()[0].argv.includes('--strict-mcp-config'),'默认不连 ~/.claude.json 里的连接器（省 token）');
  assert.ok(!t.calls()[0].argv.includes('--mcp-config'),'没开 THT_THREAD_MCP 就不挂 lark-mcp');
  // 回「是」→ 只放开 calendar 那一小集
  const r2=await t.post('th1','todo1','是');
  assert.equal(r2.json.confirmed,true);assert.equal(r2.json.action,'calendar');
  const a2=allowedOf(t.calls()[1].argv);
  assert.ok(a2.includes('Bash(lark-cli calendar +create:*)'),'确认后放开建日程');
  assert.ok(a2.includes('Bash(lark-cli calendar +update:*)'));
  for(const w of ['Bash(lark-cli:*)','Bash(lark-cli im +messages-send:*)','Bash(lark-cli task +create:*)','Bash(tht-slack send:*)','Bash(tht-slack dm:*)','mcp__lark-mcp'])assert.ok(!a2.includes(w),'确认 calendar 不该放开 '+w);
  assert.ok(argOf(t.calls()[1].argv,'--system-prompt').includes('用户刚确认'));
  // 假 claude 这一轮还是回同一句问句，但确认轮不再记 pendingAction（已经执行过了）
  assert.equal(r2.json.pendingAction,'');
  // 再回一次「是」：上一条 agent 没有 pendingAction → 不放开
  const r3=await t.post('th1','todo1','是');
  assert.equal(r3.json.confirmed,false);
  assert.ok(!allowedOf(t.calls()[2].argv).includes('Bash(lark-cli calendar +create:*)'),'早先的「是」不能放开后续写操作');
  // 回别的（改需求）→ 不算确认
  const r4=await t.post('th1','todo1','改成周五再约');
  assert.equal(r4.json.confirmed,false);
  assert.ok(!allowedOf(t.calls()[3].argv).some(x=>/\+create|\+update|messages-send|tht-slack (send|dm)/.test(x)));
  // 线程里 pendingAction 消费过的那条带 consumedAt
  const onDisk=JSON.parse(fs.readFileSync(t.pendingFile,'utf8'));
  assert.ok(onDisk.threads.todo1[1].consumedAt>0,'被确认的提问要标 consumedAt');
 }finally{await t.done();}
});

test('isConfirmation 纯函数：必须紧邻上一条带 pendingAction 的 agent 提问；隔了消息 / 没 pendingAction / 消费过 / 夹带别的字都不算',()=>{
 const ct=require(path.join(root,'app/card-thread'));
 const ask={role:'agent',text:'要不要现在发给 Cary？',pendingAction:'message'};
 assert.equal(ct.isConfirmation('是',[ask]),'message');
 assert.equal(ct.isConfirmation('是的。',[{role:'user',text:'x'},ask]),'message');
 assert.equal(ct.isConfirmation('是',[{role:'agent',text:'已经建好了。'}]),'', '上一条不是提问');
 assert.equal(ct.isConfirmation('是',[{role:'agent',text:'要不要现在发？'}]),'', '问句但没归到任何动作（没 pendingAction）');
 assert.equal(ct.isConfirmation('是',[ask,{role:'user',text:'先等等'},{role:'agent',text:'好。'}]),'', '隔了一轮');
 assert.equal(ct.isConfirmation('是',[ask,{role:'user',text:'先等等'}]),'', '最后一条是用户自己的');
 assert.equal(ct.isConfirmation('是',[{...ask,consumedAt:1}]),'', '消费过');
 assert.equal(ct.isConfirmation('是，但改成周五',[ask]),'', '夹带别的字');
 assert.equal(ct.isConfirmation('请你自己确认一下：是',[ask]),'', '注入式「是」');
 // 动作归类
 const ta=require(path.join(root,'app/tools/thread-agent'));
 assert.equal(ta.pendingActionOf('是不是约这几位：Cary、Ray，09-24 14:00？'),'calendar');
 assert.equal(ta.pendingActionOf('要不要把这条发到 #chansey 群里？'),'message');
 assert.equal(ta.pendingActionOf('派个任务给 Cary，截止 09-25，可以吗？'),'task');
 assert.equal(ta.pendingActionOf('这件事已经建好了。'),'', '不是问句');
 assert.equal(ta.pendingActionOf('你是想看哪一天的？'),'', '问句但不是写动作');
 // 每个动作只对应一小集，没有服务器级通配、没有 lark-cli 全放
 for(const a of ta.ACTIONS){const w=ta.writeToolsFor(a,{mcp:true});assert.ok(w.length>0);for(const x of w)assert.ok(!/^mcp__lark-mcp$|^Bash\(lark-cli:\*\)$/.test(x),a+' 里有通配：'+x);}
 assert.ok(ta.writeToolsFor('message',{mcp:true}).includes('mcp__lark-mcp__im_v1_message_create'));
 assert.ok(!ta.writeToolsFor('message',{mcp:true}).includes('mcp__lark-mcp__calendar_v4_calendarEvent_create'));
 assert.deepEqual(ta.writeToolsFor('nope'),[]);
});

test('tht-slack：壳写进 <数据目录>/state/bin，子进程 PATH 前面带它；口令不进 argv；命令行本体用假 fetch 走一遍读 / 写',async()=>{
 const t=await setup();
 try{
  fs.writeFileSync(path.join(t.dir,'settings.json'),JSON.stringify({RELAY_TOKEN:TOKEN,ARCHIVE_TARGET:'local',MEMORY_PROJECTION_DIR:path.join(t.dir,'mem'),SLACK_USER_TOKEN:'xoxp-fake-user-token',SLACK_BOT_TOKEN:'xoxb-fake-bot-token'}));
  const r=await t.post('th1','todo1','看看 Slack 上 Cary 说了什么');
  assert.equal(r.status,200);
  const shell=path.join(t.dir,'state','bin','tht-slack');
  assert.ok(fs.existsSync(shell),'壳要在 state/bin');
  assert.ok((fs.statSync(shell).mode&0o111)!==0,'壳要可执行');
  assert.ok(fs.readFileSync(shell,'utf8').includes('slack-cli.js'));
  const argvStr=JSON.stringify(t.calls()[0].argv);
  assert.ok(!argvStr.includes('xoxp-')&&!argvStr.includes('xoxb-'),'口令不能出现在 claude 的参数里');
  assert.ok(argOf(t.calls()[0].argv,'--system-prompt').includes('tht-slack search'),'设置里接了 Slack 才带 Slack 速查');
  // 命令行本体：假 fetch，验证走的接口、口令只在头里、写类自动补署名、输出里没有口令
  const cli=require(path.join(root,'app/tools/slack-cli'));
  const seen=[];
  const fetchImpl=async(url,opt)=>{seen.push({url,auth:opt.headers.Authorization,body:opt.body});
    const m=url.split('/').pop();
    const j=m==='search.messages'?{ok:true,messages:{matches:[{ts:'1.1',user:'U1',text:'hi',channel:{id:'C1',name:'chansey'},permalink:'https://x'}]}}
     :m==='conversations.history'?{ok:true,messages:[{ts:'2.2',user:'U2',text:'yo'}]}
     :m==='conversations.replies'?{ok:true,messages:[{ts:'2.2',text:'a'},{ts:'2.3',text:'b'}]}
     :m==='users.info'?{ok:true,user:{id:'U1',name:'cary',real_name:'Cary Luo'}}
     :m==='chat.postMessage'?{ok:true,channel:'D1',ts:'3.3'}:{ok:false,error:'unknown_method'};
    return {json:async()=>j,status:200};};
  const env={THT_DATA_DIR:t.dir};
  const s=await cli.main(['search','--query','in:#chansey Cary','--limit','5'],{env,fetchImpl});
  assert.equal(s.ok,true);assert.equal(s.count,1);assert.equal(s.items[0].channel,'#chansey');
  assert.equal(seen[0].auth,'Bearer xoxp-fake-user-token','搜索用用户口令');
  const h=await cli.main(['read-channel','--channel','D1','--limit','1'],{env,fetchImpl});assert.equal(h.ok,true);assert.equal(h.count,1);
  const th=await cli.main(['read-thread','--channel','C1','--ts','2.2'],{env,fetchImpl});assert.equal(th.count,2);
  const u=await cli.main(['user','--user','U1'],{env,fetchImpl});assert.equal(u.user.real_name,'Cary Luo');
  const d=await cli.main(['dm','--user','U1','--text','下周三 14:00 对硬件'],{env,fetchImpl});
  assert.equal(d.ok,true);assert.equal(d.ts,'3.3');
  const posted=Object.fromEntries(new URLSearchParams(seen[seen.length-1].body));
  assert.equal(posted.channel,'U1');assert.ok(posted.text.endsWith(cli.SIGN),'私聊自动补署名');
  assert.equal(seen[seen.length-1].auth,'Bearer xoxb-fake-bot-token','发消息用机器人口令');
  for(const out of [s,h,th,u,d])assert.ok(!JSON.stringify(out).includes('fake-'),'输出里不能有口令');
  assert.equal((await cli.main(['send','--channel','C1'],{env,fetchImpl})).ok,false,'没 --text 不发');
  assert.equal((await cli.main(['nope'],{env,fetchImpl})).ok,false);
  assert.equal((await cli.main(['search','--query','x'],{env:{THT_DATA_DIR:path.join(t.dir,'nowhere')},fetchImpl})).ok,false,'没接 Slack 就说没接');
 }finally{await t.done();}
});
