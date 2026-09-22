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
