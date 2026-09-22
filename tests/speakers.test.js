'use strict';
// 会后一屏认人：清单怎么排、试听切得对不对、确认之后两份存档和工作台是不是都跟上了。
// 整数据 + 真服务进程（同 llm-degraded.test.js 的写法），不打模型。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),crypto=require('crypto');
const {spawn}=require('child_process');
const root=path.join(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const speakers=require('../app/speakers');
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

const RATE=16000,BYTE_RATE=RATE*2;

test('清单：没名字的排前面，样本最多 3 段、每段 3–12 秒、只取有时间戳的长句',()=>{
  const tr=[];
  const push=(spk,at,text)=>tr.push({speaker:spk,at,t:'0:00',text});
  push('0',10,'一句很长的话'.repeat(4));push('0',30,'第二句也不短，要够长才会被挑中');push('0',60,'短');push('0',70,'第三句挑出来的原话在这里，够长');push('0',200,'第四句也挺长的一段内容在这里');
  push('1',100,'另一个人说的一段话，长度足够');push('1',130,'再说一句凑数的内容');
  push('2',150,'没有时间戳的那一句不该出现');tr[tr.length-1].at=0;
  const rows=speakers.list({start:'2026-09-17T09:58:17.476Z',names:{'1':'Cary Luo'},transcript:tr},{attendees:['Shawn Liu','Cary Luo']});
  assert.deepEqual(rows.map(r=>r.spk),['0','2','1'],'未命名的在前，同组按句数多的在前；已命名的沉到最后');
  assert.equal(rows[0].name,'');assert.equal(rows[0].confirmed,false);assert.equal(rows[0].lines,5);
  assert.equal(rows.find(r=>r.spk==='1').name,'Cary Luo');
  assert.ok(rows[0].samples.length<=3&&rows[0].samples.length>=2);
  for(const x of rows[0].samples){assert.ok(x.dur>=3&&x.dur<=12,'时长 '+x.dur);assert.ok(x.text.length<=40);}
  assert.deepEqual(rows[0].samples.map(x=>x.start),[...rows[0].samples.map(x=>x.start)].sort((a,b)=>a-b),'样本按时间排');
  assert.equal(rows.find(r=>r.spk==='2').samples.length,0,'没有时间戳就不给试听');
  assert.deepEqual(rows[0].candidates,['Shawn Liu'],'这场已经用掉的名字不再当候选');
  assert.deepEqual(rows.find(r=>r.spk==='1').candidates,[],'已命名的不给候选');
});

test('本人：双路模式的 me 那一路默认叫「本人」，编号说话人不猜',()=>{
  const rows=speakers.list({start:0,names:{},transcript:[{speaker:'me',at:5,text:'我说的一句话，够长了'},{speaker:'3',at:9,text:'别人说的一句话，也够长'}]});
  const me=rows.find(r=>r.spk==='me');
  assert.equal(me.isSelf,true);assert.equal(me.name,'本人');assert.equal(me.confirmed,false);
  const other=rows.find(r=>r.spk==='3');
  assert.equal(other.isSelf,false);assert.equal(other.name,'');
});

test('名字校验：空串是清掉；超长、坏编号、非文字一律拒绝',()=>{
  assert.deepEqual(speakers.clean({'1':' Shawn Liu ','2':''}),{'1':'Shawn Liu','2':''});
  assert.throws(()=>speakers.clean({'1':'x'.repeat(41)}),/最多/);
  assert.throws(()=>speakers.clean({'说话人一':'甲'}),/编号不对/);
  assert.throws(()=>speakers.clean({'1':{}}),/文字/);
  assert.throws(()=>speakers.clean([]),/对象/);
  assert.equal(speakers.clean({'1':'李'+String.fromCharCode(0)+'四'})['1'],'李四','控制字符剔掉');
});

test('团队名单：只认表格第一格和加粗的人名，说明文字不当人名',()=>{
  const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tht-team-')),'team.md');
  fs.writeFileSync(f,'# 名单\n\n| 人 | 角色 |\n|---|---|\n| **Shawn Liu** | AI 业务负责人 |\n| Cary Luo | 项目经理 |\n| 张三 | 硬件 |\n\n这一行里 The Team 不该被当成人名的话也无所谓，它只是候选。\n');
  // 名单只有一份读法：app/context-pack.js 的 roster()。认人的候选按钮和处理台拟日历用的是同一份。
  const roster=require('../app/context-pack').roster;
  const names=roster({TEAM_MEMBERS_FILE:f}).names;
  assert.ok(names.includes('Shawn Liu')&&names.includes('Cary Luo'));
  assert.ok(!names.includes('张三'),'中文名这版抽不出来，走自填框');
  assert.deepEqual(roster({}).names,[]);
  assert.deepEqual(roster({TEAM_MEMBERS_FILE:'/nope/not-here.md'}).names,[]);
  assert.equal(roster({TEAM_MEMBERS_FILE:f}).text.includes('AI 业务负责人'),true,'原文照样能给处理台用');
});

test('前端替换是纯函数：只认编号类的 key，S21 和 USB 不受影响',()=>{
  const js=fs.readFileSync(path.join(root,'web/work.js'),'utf8');
  const m=/function applySpeakerNames\(text,map\)\{[^\n]+\}/.exec(js);assert.ok(m,'work.js 里要有这个可单测的纯函数');
  const fn=new Function('return '+m[0].replace('function applySpeakerNames','function'))();
  assert.equal(fn('S2 说 S21 同意，说话人 2 负责',{'2':'乙'}),'乙 说 S21 同意，乙 负责');
  assert.equal(fn('USB 接口',{'张三':'张三'}),'USB 接口');
  assert.equal(fn('S2 负责',{'2':''}),'S2 负责','名字清掉了就不替换');
});

test('页面契约：认人区块在，证据块那套旧入口撤了，说话人的题不再进「需要你定一下」',()=>{
  const html=fs.readFileSync(path.join(root,'web/archive.html'),'utf8'),js=fs.readFileSync(path.join(root,'web/archive.js'),'utf8');
  assert.match(html,/id="spk-box"/);
  assert.doesNotMatch(js,/spkProof/);
  assert.match(js,/questions\|\|\[\]\)\.filter\(q=>!\(q\.affects\|\|\[\]\)\.some\(f=>\/\^speaker:\/i\.test\(f\)\)\)/);
  assert.match(js,/speaker-confirm/);
});

test('走真服务：清单、试听切片、确认后两份存档 + 工作台都跟上，刷新还在',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livemate-speakers-'));
  const sid='spktest1',key=crypto.createHash('sha256').update(sid).digest('hex').slice(0,16);
  const pipe=path.join(dir,'state/meeting-pipeline');
  fs.mkdirSync(path.join(dir,'pending'),{recursive:true});fs.mkdirSync(path.join(dir,'audio'),{recursive:true});fs.mkdirSync(pipe,{recursive:true});
  // 30 秒静音就够：只验切出来的字节数和时长对不对，不验声音本身
  fs.writeFileSync(path.join(dir,'audio',sid+'.pcm'),Buffer.alloc(30*BYTE_RATE));
  const transcript=[
    {speaker:'0',at:2,t:'0:02',text:'第一句是我开的场，说得比较长一点，方便挑成样本'},
    {speaker:'1',at:9,t:'0:09',text:'我是第二个人，这一句也足够长，可以当样本听'},
    {speaker:'0',at:15,t:'0:15',text:'我接着说第二句，同样写得长一些好被挑中'},
    {speaker:'2',at:21,t:'0:21',text:'第三个人只说了这一句，但它够长，能当样本'},
    {speaker:'0',at:26,t:'0:26',text:'最后再补一句，这样 0 号说的句数最多'}];
  const session={id:sid,title:'认人测试场',start:'2026-09-17T10:00:00.000Z',end:'2026-09-17T10:00:30.000Z',names:{},transcript,
    highlights:[],todos:[{text:'S1 出一版硬件基线',owner:'S1',done:false}],factchecks:[],summary:'',uiLang:'zh',
    calendar:{event:{title:'认人测试场',attendees:['Shawn Liu','Cary Luo','Abel Mei']}}};
  fs.writeFileSync(path.join(dir,'pending','sess-'+sid+'.json'),JSON.stringify(session));
  // 归档结果那一份：状态标成不需要补跑，免得测试里真的去 spawn python
  fs.writeFileSync(path.join(pipe,key+'.job.json'),JSON.stringify({key,sessionId:sid,title:'认人测试场',input:path.join(pipe,key+'.input.json'),status:'done',created:'2026-01-01T00:00:00.000Z',summaryGenerated:true,attempts:0}));
  fs.writeFileSync(path.join(pipe,key+'.input.json'),JSON.stringify(session));
  fs.writeFileSync(path.join(pipe,key+'.job.enhanced.json'),JSON.stringify({...session,names:{}}));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({RELAY_TOKEN:'s'.repeat(48),ARCHIVE_TARGET:'local'}));

  const port=await freePort(),base='http://127.0.0.1:'+port+'/asr-relay';
  const child=spawn(process.execPath,[path.join(root,'app/server.js')],{env:{...process.env,THT_DATA_DIR:dir,THT_PORT:String(port),THT_NO_OPEN:'1',THT_TEST:'1',THT_LARK_CLI:'/usr/bin/false'},stdio:'ignore'});
  const get=async p=>fetch(base+p,{cache:'no-store'});
  const post=async(p,body)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const readJSON=f=>JSON.parse(fs.readFileSync(f,'utf8'));
  try{
    for(let i=0;i<80;i++){try{if((await get('/health')).ok)break;}catch{await pause(100);}}

    // 1. 清单：未命名的三个人都在，候选来自这场日历
    let j=await(await get('/meeting-speakers?id='+sid)).json();
    assert.equal(j.ok,true);assert.equal(j.speakers.length,3);
    assert.deepEqual(j.speakers.map(s=>s.spk),['0','1','2']);
    assert.equal(j.speakers[0].lines,3);
    assert.ok(j.speakers[0].samples.length>=2&&j.speakers[0].samples.length<=3);
    assert.deepEqual(j.speakers[0].candidates,['Shawn Liu','Cary Luo','Abel Mei']);
    assert.equal((await get('/meeting-speakers?id=nope')).status,404);

    // 2. 试听：切出来的 WAV 字节数与时长对得上；越界和乱填参数是 4xx
    const clip=await get('/audio?id='+sid+'&start=9&dur=4');
    assert.equal(clip.status,200);assert.equal(clip.headers.get('content-type'),'audio/wav');
    const buf=Buffer.from(await clip.arrayBuffer());
    assert.equal(buf.length,44+4*BYTE_RATE);
    assert.equal(buf.readUInt32LE(40),4*BYTE_RATE,'WAV 头里的 data 长度');
    assert.equal(buf.readUInt32LE(24),RATE);
    assert.equal((await get('/audio?id='+sid+'&start=900&dur=4')).status,416);
    for(const q of ['start=-1&dur=4','start=1&dur=0','start=1&dur=99','start=x&dur=4'])
      assert.equal((await get('/audio?id='+sid+'&'+q)).status,400,q);
    assert.equal((await get('/audio?id='+sid)).status,200,'不带参数仍然是整场');

    // 3. 工作台先收录这场，确认之后它那份 source 要拿到映射
    assert.equal((await post('/hub/session',{session})).status,200);

    // 4. 确认一个名字：两份 json 都写上，清单里也在
    let r=await(await post('/speaker-confirm',{id:sid,names:{'1':'Shawn Liu'}})).json();
    assert.equal(r.ok,true);assert.equal(r.names['1'],'Shawn Liu');
    assert.equal(readJSON(path.join(pipe,key+'.job.enhanced.json')).names['1'],'Shawn Liu');
    assert.equal(readJSON(path.join(dir,'pending','sess-'+sid+'.json')).names['1'],'Shawn Liu');
    j=await(await get('/meeting-speakers?id='+sid)).json();          // = 刷新一次页面
    assert.equal(j.speakers.find(s=>s.spk==='1').name,'Shawn Liu');
    assert.equal(j.speakers.find(s=>s.spk==='1').confirmed,true);
    assert.equal(j.speakers[j.speakers.length-1].spk,'1','已认的沉到最后');
    assert.ok(!j.speakers[0].candidates.includes('Shawn Liu'),'用掉的名字不再当候选');
    assert.equal((await(await get('/meeting-result?id='+sid)).json()).names['1'],'Shawn Liu');

    // 5. 工作台：这场的 source 上挂着映射
    const hub=await(await get('/hub')).json();
    const src=hub.sources.find(s=>s.key==='session:'+sid);
    assert.ok(src,'工作台里要有这场会');
    assert.deepEqual(src.speakerNames,{'1':'Shawn Liu'});

    // 6. 认错了要能改回来：空串清掉，两份 json 都不再有这个 key
    r=await(await post('/speaker-confirm',{id:sid,names:{'1':''}})).json();
    assert.equal(r.ok,true);assert.equal(r.names['1'],undefined);
    assert.equal(readJSON(path.join(pipe,key+'.job.enhanced.json')).names['1'],undefined);
    assert.equal(readJSON(path.join(dir,'pending','sess-'+sid+'.json')).names['1'],undefined);
    assert.deepEqual((await(await get('/hub')).json()).sources.find(s=>s.key==='session:'+sid).speakerNames,{});

    // 7. 不合法的名字和编号拒绝，且不落盘
    assert.equal((await post('/speaker-confirm',{id:sid,names:{'1':'x'.repeat(41)}})).status,400);
    assert.equal((await post('/speaker-confirm',{id:sid,names:{'坏编号':'甲'}})).status,400);
    assert.equal((await post('/speaker-confirm',{id:'nosuch',names:{'1':'甲'}})).status,404);
    assert.equal(readJSON(path.join(pipe,key+'.job.enhanced.json')).names['1'],undefined);
  }finally{try{child.kill('SIGTERM');}catch{}await pause(200);fs.rmSync(dir,{recursive:true,force:true});}
});
