// 回看页新版（REQ-004）：结构化总结的清洗、回答保存、页面契约
const test=require('node:test'),assert=require('node:assert'),{spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..');
const py=(code,env={})=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-brief-'));const r=spawnSync('python3',['-c',`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(root,'app','meeting-pipeline.py'))});mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)\n${code}`],{encoding:'utf8',env:{...process.env,THT_DATA_DIR:dir,...env}});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout.trim().split('\n').pop());};
test('时间戳：mm:ss 和 h:mm:ss 都换成秒，乱写的给 0',()=>{assert.deepEqual(py(`print(json.dumps([mp._sec('12:40'),mp._sec('1:02:03'),mp._sec('[7:05]'),mp._sec(''),mp._sec(90)]))`),[760,3723,425,0,90]);});
test('模型输出：剥掉代码块围栏取 JSON；Markdown 标记不进页面',()=>{assert.deepEqual(py(`print(json.dumps([mp._json_out('\`\`\`json\\n{"a":1}\\n\`\`\`'),mp._plain('## **结论** | x')]))`),[{a:1},'结论  x']);});
test('结构化总结：条数封顶、时间换秒、没说负责人的留空',()=>{
  const raw={meta:{scope:'范围'},overview:{topics:[{n:1,title:'议题一',from:'0:10',to:'5:00'},{n:2,title:'议题二',from:'5:00',to:'9:00'}],conclusions:['a','b','c','d'],todos:Array.from({length:7},(_,i)=>({what:'事'+i,owner:i?'':'甲',due:'',topic:2}))},topics:[{n:1,conclusion:'**定了**',points:Array.from({length:6},(_,i)=>({text:'点'+i,at:'1:0'+i})),open:[]},{n:2,conclusion:'',points:[{text:'x',at:'6:00'}],open:['未决']}]};
  const b=py(`mp.ask_model=lambda *a,**k:{'text':${JSON.stringify(JSON.stringify(raw))}}\nprint(json.dumps(mp.make_brief({'transcript':[{'t':'0:10','text':'大家好我们开始'}],'start':'2026-09-17T09:58:17.476Z','end':1789639697476,'summary':''})))`);
  assert.equal(b.overview.conclusions.length,3);assert.equal(b.overview.todos.length,5);assert.equal(b.overview.todos[0].ownerSource,'meeting');assert.equal(b.overview.todos[1].owner,'');
  assert.equal(b.topics[0].points.length,4);assert.equal(b.topics[0].points[0].at,60);assert.equal(b.topics[0].conclusion,'定了');assert.equal(b.duration,600);assert.equal(b.overview.topics[1].from,300);});
test('点评失败不拖垮总结：review 为空并记下原因',()=>{
  const b=py(`mp.make_brief=lambda s,**k:{'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}\ndef boom(*a,**k):raise RuntimeError('claude 超时')\nmp.make_review=boom\nprint(json.dumps(mp.build_brief({})))`);
  assert.equal(b.review,null);assert.deepEqual(b.questions,[]);assert.match(b.reviewWarning,/超时/);});
test('没配项目背景目录：review 这档拼不出背景，点评降级成只看会内',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-noctx-'));
  const pack=require('../app/context-pack').build({},{purpose:'review',dataDir:dir});
  assert.equal(pack.text,'');assert.equal(pack.configured,false);
  assert.match(pack.note,/没有接项目背景/);
  // 背景文件由 app/context-pack.js 读，Python 这边一个设置项都不该再认
  assert.doesNotMatch(fs.readFileSync(path.join(root,'app/meeting-pipeline.py'),'utf8'),/PROJECT_CONTEXT_DIR|PROJECT_CONTEXT_FILES/);});
test('保存回答：写进 brief.answers，问说话人的题同时写 names；选项越界拒绝',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-ans-'));const mp=require('../app/meeting-pipeline')({dir,idle:()=>false});
  const key=require('crypto').createHash('sha256').update('m1').digest('hex').slice(0,16);
  fs.writeFileSync(path.join(dir,key+'.job.json'),JSON.stringify({key,sessionId:'m1',created:'2026-09-18',status:'done',input:''}));
  fs.writeFileSync(path.join(dir,key+'.job.enhanced.json'),JSON.stringify({id:'m1',names:{},brief:{questions:[{id:'q1',ask:'S2 是谁？',options:['乙','丙'],recommend:0,affects:['speaker:2']}]}}));
  const r=mp.answer('m1','q1',1,'');assert.equal(r.value,'丙');
  const saved=JSON.parse(fs.readFileSync(path.join(dir,key+'.job.enhanced.json'),'utf8'));assert.equal(saved.names['2'],'丙');assert.equal(saved.brief.answers.q1.choice,1);
  assert.throws(()=>mp.answer('m1','q1',5,''),/选项不对/);assert.throws(()=>mp.answer('m1','q9',0,''),/没有这道题/);mp.stop();});
test('页面契约：要点栏、待核查栏、过一遍入口撤了；总结不再用 textContent 塞长文',()=>{
  const html=fs.readFileSync(path.join(root,'web/archive.html'),'utf8'),js=fs.readFileSync(path.join(root,'web/archive.js'),'utf8');
  assert.doesNotMatch(html,/<h2>要点|<h2>待核查|智能总结 · 待核对/);assert.match(html,/id="ask-box"/);assert.match(html,/id="tr-box"/);
  assert.doesNotMatch(js,/\$\('#summary'\)\.textContent/);assert.doesNotMatch(js,/^\s*mountNote\(s\);|^\s*mountReviewButton\(s\);/m);});
test('项目背景：只读背景目录里点到的文件，目录外的通配不带进来；点评调用不带任何工具',()=>{
  const ctx=fs.mkdtempSync(path.join(os.tmpdir(),'tht-ctx-'));fs.mkdirSync(path.join(ctx,'kb_reorg'));fs.writeFileSync(path.join(ctx,'kb_reorg','02_总纲.md'),'总纲正文');fs.writeFileSync(path.join(ctx,'CLAUDE.md'),'规则');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tht-ctxdata-'));
  const pack=require('../app/context-pack').build({PROJECT_CONTEXT_DIR:ctx,PROJECT_CONTEXT_FILES:['kb_reorg/*.md','../*','/etc/hosts']},{purpose:'review',dataDir:dir});
  assert.match(pack.text,/=== 文件：kb_reorg\/02_总纲\.md ===\n总纲正文/);assert.doesNotMatch(pack.text,/localhost|规则/);
  assert.match(pack.note,/source 只写你真引用到的文件名/);
  const src=fs.readFileSync(path.join(root,'app/meeting-pipeline.py'),'utf8');assert.doesNotMatch(src,/allowedTools', 'Read/);});
test('说话人替换：只认编号类的 key，中文 key 不会把正文里的 S 全换掉',()=>{
  const js=fs.readFileSync(path.join(root,'web/archive.js'),'utf8');const m=/function nm\(text,map\)\{[^\n]+\}/.exec(js);assert.ok(m);
  const nm=new Function('esc','return '+m[0].replace('function nm','function'))(s=>String(s));
  assert.equal(nm('S2 说 S21 同意，说话人 2 负责',{'2':'乙','张三':'张三'}),'乙 说 S21 同意，乙 负责');assert.equal(nm('USB 接口',{'张三':'张三'}),'USB 接口');});

// —— 洞察（Aaron 09-24：右栏改成「一二三四」的真问题 + 答案；会后管线多产 brief.insights）——
const INS_SESSION={id:'m-ins',transcript:[{id:'g1',t:'0:10',speaker:'0',text:'相机装在手机上拍'},{id:'g2',t:'0:20',speaker:'1',text:'那 Pin 上的摄像头还要吗'},{id:'g3',t:'0:30',speaker:'0',text:'功耗还没有预算'}]};
const INS_BRIEF={overview:{topics:[],conclusions:['云为主'],todos:[{what:'问厂家要功耗',owner:'',due:'',topic:1}]},topics:[{n:1,title:'相机',conclusion:'手机拍',decision:'待讨论',open:[]}]};
const insRaw=items=>JSON.stringify(JSON.stringify({insights:items}));
const insItem=(i,extra={})=>({n:i,question:'问题'+i,answer:'答案'+i,evidence:['g'+(i%3+1)],detail:'依据：x',action:{label:'按钮'+i,text:'待办'+i,owner:'Shawn Liu'},...extra});
test('洞察：正常 5 条，编号重排、字段齐、按钮字截到 8 字；第 6 条截掉',()=>{
  const items=[1,2,3,4,5,6].map(i=>insItem(i,i===2?{action:{label:'这个按钮名字太长了超过八个字',text:'待办2',owner:''}}:{}));
  const r=py(`mp.ask_model=lambda *a,**k:{'text':${insRaw(items)},'context':{'chars':2500}}\nprint(json.dumps(mp.make_insights(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}),['Shawn Liu'])))`);
  assert.equal(r.insights.length,5);assert.equal(r.contextLoaded,true);assert.equal(r.dropped,0);
  assert.deepEqual(r.insights.map(x=>x.n),[1,2,3,4,5]);assert.deepEqual(Object.keys(r.insights[0]).sort(),['action','answer','detail','evidence','n','question']);
  assert.equal(r.insights[0].action.owner,'Shawn Liu');assert.equal(r.insights[1].action.label.length,8);assert.deepEqual(r.insights[0].evidence,['g2']);});
test('洞察：坏 JSON 带着报错重问一次，第二次成功就用第二次的',()=>{
  const r=py(`calls=[]\ndef fake(system,user,**k):\n    calls.append(k.get('purpose'))\n    return {'text':'{"insights":[{"n":1,"question":"q","answer":"a","evidence":["g1"]},]}' if len(calls)==1 else ${insRaw([insItem(1)])},'context':{'chars':0}}\nmp.ask_model=fake\nr=mp.make_insights(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}))\nprint(json.dumps({'calls':calls,'n':len(r['insights']),'ctx':r['contextLoaded']}))`);
  // 第一次输出只是尾随逗号：无损修复就解析得出，不用重问；contextLoaded 按桥回的 chars 判
  assert.deepEqual(r.calls,['insights']);assert.equal(r.n,1);assert.equal(r.ctx,false);
  const r2=py(`calls=[]\ndef fake(system,user,**k):\n    calls.append(k.get('purpose'))\n    return {'text':'这不是 JSON' if len(calls)==1 else ${insRaw([insItem(1)])}}\nmp.ask_model=fake\nr=mp.make_insights(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}))\nprint(json.dumps({'calls':calls,'n':len(r['insights'])}))`);
  assert.deepEqual(r2.calls,['insights','insights-retry']);assert.equal(r2.n,1);});
test('洞察：evidence 对不上逐字稿编号的条目丢掉，剩下的重新编号；归档后的 seg 字段也认',()=>{
  const items=[insItem(1,{evidence:['g9','nope']}),insItem(2,{evidence:[]}),insItem(3,{evidence:['g3','g9']}),{n:4,question:'',answer:'a',evidence:['g1']}];
  const r=py(`mp.ask_model=lambda *a,**k:{'text':${insRaw(items)}}\nprint(json.dumps(mp.make_insights(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}))))`);
  assert.equal(r.insights.length,1);assert.equal(r.dropped,2);assert.equal(r.insights[0].n,1);assert.equal(r.insights[0].question,'问题3');assert.deepEqual(r.insights[0].evidence,['g3']);
  const seg={id:'m-seg',transcript:[{seg:'s1',t:'0:10',spk:'0',text:'归档后的行'}]};
  const r2=py(`mp.ask_model=lambda *a,**k:{'text':${insRaw([insItem(1,{evidence:['s1']})])}}\nprint(json.dumps(mp.make_insights(json.loads(${JSON.stringify(JSON.stringify(seg))}),{'overview':{},'topics':[]})))`);
  assert.deepEqual(r2.insights[0].evidence,['s1']);});
test('洞察：模型失败不炸 brief——insights 为空并记 insightsWarning，点评照常',()=>{
  const b=py(`mp.make_brief=lambda s,**k:{'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}\nmp.make_review=lambda *a,**k:{'questions':[],'review':{'contextLoaded':True,'errors':[],'facts':[],'alignment':[],'advice':[],'checked':[],'owners':[]}}\ndef boom(*a,**k):raise mp.ModelError('三家都没回')\nmp.make_insights=boom\nprint(json.dumps(mp.build_brief({})))`);
  assert.deepEqual(b.insights,[]);assert.match(b.insightsWarning,/没回/);assert.ok(b.review);assert.equal(b.reviewWarning,undefined);
  const ok=py(`mp.make_brief=lambda s,**k:{'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}\nmp.make_review=lambda *a,**k:{'questions':[],'review':{'owners':[]}}\nmp.make_insights=lambda *a,**k:{'insights':[{'n':1,'question':'q','answer':'a','evidence':['g1']}],'contextLoaded':True,'dropped':0}\nprint(json.dumps(mp.build_brief({})))`);
  assert.equal(ok.insights.length,1);assert.equal(ok.insightsWarning,undefined);});
test('洞察：context-pack 的 insights 用途只带 project-state 节选（§0–§2 + §8b/§8c），各节平分 3000 字',()=>{
  const proj=fs.mkdtempSync(path.join(os.tmpdir(),'tht-ins-proj-'));
  fs.writeFileSync(path.join(proj,'project-state.md'),'---\nhead\n---\n## 0. 定位\n'+'零'.repeat(100)+'\n## 0a. 入口\n'+'入'.repeat(100)+'\n## 1. 命题树\n'+'一'.repeat(2000)+'\n## 2. 已定的事\n'+'二'.repeat(100)+'\n## 3. 用研\n'+'三'.repeat(100)+'\n## 8b. 未定项\n'+'未'.repeat(2000)+'\n## 8c. 口径差\n'+'差'.repeat(2000)+'\n## 9. 术语\n术');
  const pack=require('../app/context-pack').build({MEMORY_PROJECTION_DIR:proj},{purpose:'insights',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'tht-ins-data-'))});
  assert.ok(pack.configured);assert.ok(pack.chars<=3100,'超了上限 '+pack.chars);
  for(const h of ['## 0. 定位','## 1. 命题树','## 2. 已定的事','## 8b. 未定项','## 8c. 口径差'])assert.match(pack.text,new RegExp(h));
  for(const h of ['## 0a','## 3. 用研','## 9. 术语','head'])assert.doesNotMatch(pack.text,new RegExp(h));
  assert.ok((pack.text.match(/未/g)||[]).length>500,'§8b 该分到额度，不该被前面几节吃光');
  assert.match(fs.readFileSync(path.join(root,'app/meeting-pipeline.py'),'utf8'),/context=\{'purpose': 'insights'/);});
