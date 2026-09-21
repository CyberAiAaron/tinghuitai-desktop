// 回看页收尾（REQ-004 / N-03）：议题的决定状态、会中议题树带到会后、速览/完整、点要点回原句
const test=require('node:test'),assert=require('node:assert'),{spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const py=(code,env={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-rv-'));const r=spawnSync('python3',['-c',`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(root,'app','meeting-pipeline.py'))});mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)\n${code}`],{encoding:'utf8',env:{...process.env,THT_DATA_DIR:dir,...env}});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout.trim().split('\n').pop());};
const archiveJs=fs.readFileSync(path.join(root,'web/archive.js'),'utf8');
const archiveHtml=fs.readFileSync(path.join(root,'web/archive.html'),'utf8');
const serverJs=fs.readFileSync(path.join(root,'app/server.js'),'utf8');

// 会中排好的两个议题；模型故意另起一套三个议题的划分，用来验证会后不跟着模型走
const LIVE_GROUPS=[
  {title:'会中议题一',summary:'先把范围定下来。细节后面再说。',status:'settled',from:20,to:200,points:[{text:'要点甲',at:60,seg:'s1'}]},
  {title:'会中议题二',summary:'这个没谈完。',status:'unresolved',from:280,to:400,points:[{text:'要点乙',at:300,seg:'s2'}]}];
const SESSION={id:'m-live',start:'2026-09-17T09:58:17.476Z',end:1789639697476,summary:'',
  transcript:[{id:'s1',at:60,t:'1:00',text:'我觉得范围先定下来'},{id:'s2',at:300,t:'5:00',text:'这个还得再讨论'}]};
const MODEL_RAW={meta:{scope:'范围'},
  overview:{topics:[{n:1,title:'模型自己分的一',from:'0:10',to:'3:00'},{n:2,title:'模型自己分的二',from:'3:00',to:'6:00'},{n:3,title:'模型自己分的三',from:'6:00',to:'9:00'}],conclusions:['结论一'],todos:[]},
  topics:[{n:1,conclusion:'定了走甲',decision:'已一致',points:[{text:'点一',at:'1:00'}],open:[]},
          {n:2,conclusion:'还没定',decision:'差不多吧',points:[{text:'点二',at:'5:00'}],open:['谁来做']},
          {n:3,conclusion:'多出来的',decision:'搁置',points:[],open:[]}]};
const brief=(session,raw)=>py(`mp._ask=lambda *a,**k:${JSON.stringify(JSON.stringify(raw))}\nprint(json.dumps(mp.make_brief(json.loads(${JSON.stringify(JSON.stringify(session))}))))`);

test('决定状态归一化：四个词照收，别的一律落到待讨论；缺省可以指定',()=>{
  assert.deepEqual(py(`print(json.dumps([mp._decision('已一致'),mp._decision('有分歧'),mp._decision('大概算定了'),mp._decision('',' 已一致'),mp._decision('','已一致'),mp._decision('','随便写的')]))`),
    ['已一致','有分歧','待讨论','待讨论','已一致','待讨论']);});

test('会中分好的议题带到会后：模型另起一套划分也不算数，n 和标题按会中那份',()=>{
  const b=brief({...SESSION,hlGroups:{groups:LIVE_GROUPS}},MODEL_RAW);
  assert.equal(b.fromLive,true);
  assert.deepEqual(b.overview.topics.map(t=>t.title),['会中议题一','会中议题二']);
  assert.deepEqual(b.overview.topics.map(t=>t.n),[1,2]);
  assert.equal(b.overview.topics[0].from,20);assert.equal(b.overview.topics[0].to,200);
  assert.equal(b.topics.length,2);                       // 模型多给的第三个议题不进页面
  assert.equal(b.topics[0].conclusion,'定了走甲');        // 结论仍由模型补
  assert.equal(b.topics[0].decision,'已一致');
  assert.equal(b.topics[1].decision,'待讨论');            // 模型给的词不在四个里 → 按会中 unresolved 落到待讨论
  assert.deepEqual(b.topics[1].open,['谁来做']);
});

test('会中那一组模型没答上来时，用会中的要点和结论顶上，议题不空着',()=>{
  const b=brief({...SESSION,hlGroups:{groups:LIVE_GROUPS}},{...MODEL_RAW,topics:[MODEL_RAW.topics[0]]});
  assert.equal(b.topics[1].conclusion,'这个没谈完。');
  assert.deepEqual(b.topics[1].points.map(p=>p.text),['要点乙']);
  assert.equal(b.topics[1].points[0].seg,'s2');
});

test('没有会中分组的旧会照旧走模型划分，每个议题仍然有状态',()=>{
  const b=brief(SESSION,MODEL_RAW);
  assert.equal(b.fromLive,false);
  assert.deepEqual(b.overview.topics.map(t=>t.title),['模型自己分的一','模型自己分的二','模型自己分的三']);
  assert.deepEqual(b.topics.map(t=>t.decision),['已一致','待讨论','搁置']);
});

test('要点回原句：模型只给了时间，服务端把它落到逐字稿的那一段 id 上；差太远就不给跳转',()=>{
  const b=brief(SESSION,MODEL_RAW);
  assert.equal(b.topics[0].points[0].seg,'s1');
  assert.equal(b.topics[1].points[0].seg,'s2');
  assert.deepEqual(py(`rows=mp._segs({'start':0,'transcript':[{'id':'a','at':10},{'id':'b','at':100}]})\nprint(json.dumps([mp._seg_at(rows,12),mp._seg_at(rows,100),mp._seg_at(rows,9999),mp._seg_at(rows,0),mp._seg_at([],5)]))`),
    ['a','b','','','']);});

test('会中分组少于两组、或标题是空的，不当数：回落到模型划分',()=>{
  assert.deepEqual(py(`print(json.dumps([mp._outline({'hlGroups':{'groups':[{'title':'只有一组'}]}}),mp._outline({'hlGroups':{'groups':[{'title':''},{'title':'  '}]}}),mp._outline({})]))`),[[],[],[]]);});

test('改议题状态：写回存档、刷新还在；坏值和不存在的议题一律拒绝',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-dec-'));const mp=require('../app/meeting-pipeline')({dir,idle:()=>false});
  const key=require('crypto').createHash('sha256').update('m2').digest('hex').slice(0,16);
  const enhanced=path.join(dir,key+'.job.enhanced.json');
  fs.writeFileSync(path.join(dir,key+'.job.json'),JSON.stringify({key,sessionId:'m2',created:'2026-09-21',status:'done',input:''}));
  fs.writeFileSync(enhanced,JSON.stringify({id:'m2',brief:{topics:[{n:1,decision:'待讨论'},{n:2,decision:'待讨论'}]}}));
  const r=mp.setDecision('m2',2,'有分歧');assert.equal(r.decision,'有分歧');
  assert.equal(JSON.parse(fs.readFileSync(enhanced,'utf8')).brief.decisions['2'],'有分歧');
  assert.throws(()=>mp.setDecision('m2',2,'差不多'),/状态不对/);
  assert.throws(()=>mp.setDecision('m2',9,'已一致'),/没有这个议题/);
  assert.equal(JSON.parse(fs.readFileSync(enhanced,'utf8')).brief.decisions['2'],'有分歧');   // 失败不动已存的
  mp.stop();});

test('重跑整理不会把他手改的议题状态顶掉',()=>{
  const src=fs.readFileSync(path.join(root,'app/meeting-pipeline.py'),'utf8');
  assert.match(src,/kept_decisions[\s\S]{0,200}brief\['decisions'\] = kept_decisions/);});

test('写入口只有一个：改状态和答题共用 /meeting-answer，没有第二个回写路由',()=>{
  assert.match(serverJs,/j\.decision !== undefined[\s\S]{0,160}meetingPipeline\.setDecision/);
  assert.equal((serverJs.match(/meetingPipeline\.setDecision/g)||[]).length,1);
  assert.doesNotMatch(serverJs,/meeting-decision/);
  assert.match(archiveJs,/body:JSON\.stringify\(\{id,topic:n,decision:v\}\)/);});

test('会中议题树跟着归档落盘：checkpoint、归档会话、崩溃恢复三处都带上',()=>{
  assert.match(serverJs,/brief:this\.brief,hlGroups:this\.hlGroups,uiLang/);                 // checkpoint
  assert.match(serverJs,/hlGroups:this\.hlGroups\|\|null,recoveryStatus:'saved-before-summary'/); // 归档会话
  assert.match(serverJs,/'brief','hlGroups','uiLang'/);                                      // 崩溃恢复
  assert.match(serverJs,/msg\.type === 'outline'[\s\S]{0,140}session\.setOutline\(msg\.groups\)/);
  assert.match(serverJs,/if\(msg\.outline\)session\.setOutline\(msg\.outline\)/);});

test('会中议题摘要：合并进来的重述不单独占一行，起止按这一组的要点算，段落 id 带过去',()=>{
  const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
  const code=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
  const c={console:{debug(){}},cur:null,asrWs:null};vm.createContext(c);
  vm.runInContext(code('  const SEG_AT=new WeakMap();','  // Wait for the recent discussion'),c);
  const sess={hlGroups:{groups:[
      {title:'A',summary:'定了。',status:'settled',keys:['p1','p2'],merged:{p1:['p2']}},
      {title:'B',summary:'没定。',status:'unresolved',keys:['p3']}]},
    highlights:[{text:'p1',at:60,sourceRefs:[{segId:'s1'}]},{text:'p2',at:70,sourceRefs:[{segId:'s2'}]},{text:'p3',at:200,sourceRefs:[{segId:'s3'}]}],
    transcript:[]};
  const out=c.outlineDigest(sess);
  assert.equal(out.length,2);
  assert.deepEqual(out[0].points.map(p=>p.text),['p1']);
  assert.equal(out[0].points[0].seg,'s1');
  assert.equal(out[0].from,60);assert.equal(out[0].to,70);
  assert.equal(out[1].status,'unresolved');
  assert.equal(c.outlineDigest({hlGroups:{groups:[{title:'A',keys:['p1']}]},highlights:[]}),null);
  assert.match(html,/outline:outlineDigest\(cur\)\|\|undefined/);   // end 帧也带一份，最后一轮不会掉
});

test('速览 / 完整：只有一个切换入口，状态记在本机且读写都包了 try/catch',()=>{
  assert.equal((archiveHtml.match(/id="bf-view"/g)||[]).length,1);
  assert.equal((archiveJs.match(/setViewFull\(/g)||[]).length,1);        // 全页只有一处在切这个状态
  assert.match(archiveJs,/try\{viewFull=localStorage\.getItem\('tht-archive-view'\)==='full';\}catch/);
  assert.match(archiveJs,/try\{localStorage\.setItem\('tht-archive-view'[^}]*\}catch/);
  assert.match(archiveJs,/viewFull\?'<ul>'/);                           // 速览不渲染要点
  assert.doesNotMatch(archiveHtml,/<details[^>]*id="bf-(sum|topics)/);  // 没有第二套展开控件
});

test('页面契约：议题带状态徽标可点改，要点按段落 id 跳原句并高亮 2 秒',()=>{
  assert.match(archiveJs,/data-dec="'\+c\.n/);
  assert.match(archiveJs,/data-dec-set/);
  assert.match(archiveJs,/function jumpTo\(sec,seg\)/);
  assert.match(archiveJs,/#transcript p\[data-seg\]/);
  assert.match(archiveJs,/hit\.style\.background=''.*\},2000\)/);
  assert.match(archiveJs,/const tbtn=\(sec,seg\)=>\(sec\|\|seg\)\?/);   // 两样都没有就不做成可点的
  assert.match(archiveJs,/' data-seg="'\+esc\(seg\)\+'"'/);
});

test('原话表在渲染总结之前就备好：直接以「完整」状态打开也带原话',()=>{
  const build=archiveJs.indexOf("segText=new Map();(s.transcript");
  const paint=archiveJs.indexOf('renderBrief(s);');
  assert.ok(build>0&&paint>build,'segText 必须在 renderBrief 之前填好，否则首屏没有原话');
  assert.equal((archiveJs.match(/segText=new Map\(\)/g)||[]).length,2);   // 一处声明、一处每场重建
  assert.match(archiveJs,/const quote=seg=>seg\?\(segText\.get/);
});

test('窄屏不横向滚动：认人区那几行原话允许收缩',()=>{
  assert.match(archiveHtml,/\.spk-samples\{[^}]*min-width:0/);
  assert.match(archiveHtml,/\.spk-clip \.q\{min-width:0/);
});

test('中英文都有：新加的文案两种语言各一份，没有只写中文的漏网',()=>{
  const table=archiveJs.slice(archiveJs.indexOf('const L={'),archiveJs.indexOf('const t=k=>L[k]'));
  const rows=[...table.matchAll(/(\w+):\[('[^']*'|"[^"]*"),\s*('[^']*'|"[^"]*")\]/g)];
  assert.ok(rows.length>=20,'文案表至少覆盖这一屏的标题和按钮，实际 '+rows.length);
  for(const [,key,zh,en] of rows) assert.notEqual(zh,en,key+' 的中英文写成了同一句');
  assert.match(archiveJs,/uiLang==='en'\?1:0/);
  assert.equal((archiveJs.match(/DEC=\[\['已一致','Agreed'/g)||[]).length,1);
});
