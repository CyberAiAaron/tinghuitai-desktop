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
  const b=py(`mp.make_brief=lambda s,**k:{'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}\nmp.make_review=lambda *a,**k:{'questions':[],'review':{'contextLoaded':True,'errors':[],'facts':[],'alignment':[],'advice':[],'checked':[],'owners':[]}}\ndef boom(*a,**k):raise mp.ModelError('三家都没回')\nmp.make_insights_deep=boom\nprint(json.dumps(mp.build_brief({})))`);
  assert.deepEqual(b.insights,[]);assert.match(b.insightsWarning,/没回/);assert.ok(b.review);assert.equal(b.reviewWarning,undefined);
  const ok=py(`mp.make_brief=lambda s,**k:{'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}\nmp.make_review=lambda *a,**k:{'questions':[],'review':{'owners':[]}}\nmp.make_insights_deep=lambda *a,**k:{'insights':[{'n':1,'question':'q','answer':'a','evidence':['g1']}],'contextLoaded':True,'dropped':0}\nprint(json.dumps(mp.build_brief({})))`);
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

// —— 洞察 · 深度档（Aaron 2026-09-24 第二轮「no template, just first principles」：自由 Markdown，不再拆字段）——
// make_insights_deep 现在返回 insights_md（整段自由 markdown）；insights 数组恒为空（只保留 key 做旧读者兼容）。
// 不再有 A→F 固定顺序、industry/stability/unstable/consistency 字段、_norm_deep_items/_merge_insight_runs——那套连同它的合并逻辑已经整个删掉。
// 失败也不再退回浅档：两次都跑不出来就 insights_md 空 + warning 说明原因；这一步失败不炸 build_brief（见上面「洞察：模型失败不炸 brief」）。
test('深度档：_clean_insights_md 只剥掉包住全文的代码围栏，正文原样保留，不猜结构', () => {
  const r = py(`print(json.dumps([mp._clean_insights_md('\`\`\`markdown\\n**结论**在这\\n\`\`\`'), mp._clean_insights_md('没有围栏的正文'), mp._clean_insights_md('  前后有空格的正文  '), mp._clean_insights_md(None), mp._clean_insights_md('')]))`);
  assert.deepEqual(r, ['**结论**在这', '没有围栏的正文', '前后有空格的正文', '', '']);
});
test('深度档：两次并行都成功 → 取字符更多的一版当正文；insights 恒为空数组，meta 字段齐全（model/provider/tier/runs/chosenRun/contextChars/search…）', () => {
  const shortMd = '这一条判断很短，没有多少信息量。';
  const longMd = '屏幕比例照 Mac 会和决策板 D2 的阔屏直板打架，这个冲突现在就该摊开说，不是等 CDCP。\n\n@Abel Mei：周五前把回滚方案定下来';
  const r = py(`import threading\ncalls=[]\nlock=threading.Lock()\ndef fake(system,user,**k):\n    with lock: calls.append((k.get('kind'),k.get('purpose'),k.get('timeout'),(k.get('context') or {}).get('purpose'),k.get('max_tokens'),k.get('json_mode')))\n    if k.get('purpose')=='insights-terms': return {'text':'{"queries":[]}','context':{}}\n    text=${JSON.stringify(shortMd)} if k.get('purpose')=='insights-deep' else ${JSON.stringify(longMd)}\n    return {'text':text,'context':{'chars':65000,'hash':'abc'},'model':'claude-fable-5-1','provider':'Claude'}\nmp.ask_model=fake\nres=mp.make_insights_deep(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}),['Shawn Liu'])\nprint(json.dumps({'calls':sorted(calls),'res':res}))`);
  assert.deepEqual(r.calls, [
    ['insight-deep', 'insights-deep', 600, 'insights-deep', 8000, false],
    ['insight-deep', 'insights-deep-r2', 600, 'insights-deep', 8000, false],
    ['post', 'insights-terms', 120, null, 400, true],
  ]);
  const res = r.res;
  assert.deepEqual(res.insights, [], 'insights 恒为空数组，正文全在 insights_md');
  assert.equal(res.insights_md, shortMd, '取更短的一版（Aaron 09-24 要短）');
  assert.equal(res.insightsMeta.tier, 'insight-deep'); assert.equal(res.insightsMeta.chosenRun, 1);
  assert.equal(res.insightsMeta.runs, 2); assert.equal(res.insightsMeta.model, 'claude-fable-5-1'); assert.equal(res.insightsMeta.provider, 'Claude');
  assert.equal(res.insightsMeta.contextChars, 65000); assert.equal(res.insightsMeta.contextHash, 'abc');
  assert.deepEqual(res.insightsMeta.runChars, { '1': [...shortMd].length, '2': [...longMd].length });
  assert.equal(res.insightsMeta.runSeconds.length, 2);
  assert.deepEqual(res.insightsMeta.search, { queries: [], urls: [], audit: '' });
  assert.equal(res.contextLoaded, true); assert.equal(res.warning, '');
  assert.ok(!('runErrors' in res.insightsMeta), '两次都成功没有 runErrors');
});
test('深度档：只有一次跑成功 → 用那一版当正文，warning 说明只成功一次，runErrors 记另一次的原因', () => {
  const md = '@Luna Min：确认一下语音唤醒的误触发率';
  const r = py(`def fake(system,user,**k):\n    if k.get('purpose')=='insights-terms': return {'text':'{"queries":[]}','context':{}}\n    if k.get('purpose')=='insights-deep-r2': raise mp.ModelError('模型调用超时（600 秒）')\n    return {'text':${JSON.stringify(md)},'context':{'chars':3},'model':'m','provider':'p'}\nmp.ask_model=fake\nres=mp.make_insights_deep(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}))\nprint(json.dumps(res))`);
  assert.equal(r.insights_md, md); assert.equal(r.insightsMeta.runs, 1); assert.match(r.warning, /只有一次跑成功/);
  assert.equal(r.insightsMeta.runErrors['2'], '模型调用超时（600 秒）'); assert.equal(r.contextLoaded, true);
});
test('深度档：两次都失败 → 不退回浅档（旧行为已删），insights_md 空、warning 列出两次原因、insightsMeta.runErrors 两条', () => {
  const r = py(`def fake(system,user,**k):\n    if k.get('purpose')=='insights-terms': return {'text':'{"queries":[]}','context':{}}\n    raise mp.ModelError('模型调用超时（600 秒）')\nmp.ask_model=fake\nres=mp.make_insights_deep(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}),['Shawn Liu'])\nprint(json.dumps(res))`);
  assert.deepEqual(r.insights, []); assert.equal(r.insights_md, ''); assert.equal(r.contextLoaded, false);
  assert.match(r.warning, /深度洞察没跑出来/); assert.match(r.warning, /第 1 次/); assert.match(r.warning, /第 2 次/);
  assert.equal(Object.keys(r.insightsMeta.runErrors).length, 2); assert.equal(r.insightsMeta.runs, 0); assert.equal(r.insightsMeta.tier, 'insight-deep');
});
test('深度档：_deep_once 正文为空当失败处理，不当成「没有洞察」的合法结果', () => {
  const r = py(`mp.ask_model=lambda *a,**k:{'text':''}\ntry:\n    mp._deep_once('sys','user',json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),1,10)\n    print(json.dumps({'raised':False}))\nexcept mp.ModelError as e:\n    print(json.dumps({'raised':True,'msg':str(e)}))`);
  assert.deepEqual(r, { raised: true, msg: '深度洞察没有正文' });
});
test('_apply_insights：insights_md 命中走自由 markdown 分支（insights 清空、insightsBrief 撤销）；没有 insights_md 键的旧结构化结果走老分支', () => {
  const r = py(`b1={'insights':[{'n':9}],'insightsBrief':{'purpose':'旧'}}\nmp._apply_insights(b1,{'insights_md':'正文','insightsMeta':{'tier':'insight-deep'}})\nb2={'insights_md':'旧正文'}\nmp._apply_insights(b2,{'insights':[{'n':1,'question':'q'}],'insightsBrief':None})\nprint(json.dumps({'b1':b1,'b2':b2}))`);
  assert.deepEqual(r.b1.insights, []); assert.equal(r.b1.insights_md, '正文'); assert.ok(!('insightsBrief' in r.b1)); assert.equal(r.b1.insightsMeta.tier, 'insight-deep');
  assert.deepEqual(r.b2.insights, [{ n: 1, question: 'q' }]); assert.ok(!('insights_md' in r.b2)); assert.equal(r.b2.insightsBrief, null);
});
test('深度档：--only insights 默认走深度档、--shallow 走浅档；写回带 insights_md；prompt 是自由 Markdown 硬约束，不再有固定字段/A→F 顺序', () => {
  const src = fs.readFileSync(path.join(root, 'app/meeting-pipeline.py'), 'utf8');
  assert.match(src, /fn=make_insights if shallow else make_insights_deep/); assert.match(src, /sys\.argv\[3\]=='--shallow'/);
  assert.match(src, /for k in \('insights','insights_md','insightsBrief','insightsMeta','insightsWarning'\):/, '写回也带 insights_md 这个键');
  for (const s of ['按 THINK.md 写', '不复述会议，不核对文档或决策记录，不用内部代号', '没拍板的方案不写成已定', '未核实', '不得编 URL', '@<人名>：', '300 字以内'])
    assert.ok(src.includes(s), '缺硬约束：' + s);
  assert.doesNotMatch(src, /insights 最多 5 条，按对 Aaron 决策的影响排序/, '深度档 prompt 里不该再出现浅档那套固定字段 schema');
  assert.match(src, /context=\{'purpose': 'insights-deep'/); assert.match(src, /_apply_insights\(brief, make_insights_deep/, '归档管线也走深度档');
});
test('深度档两阶段：先提炼搜索词 → 黑名单过滤（项目代号 / 公司 / 参会人）→ 联网 → 命中的 URL 进阶段 2 的 user 与 insightsMeta.search', () => {
  const terms = JSON.stringify(JSON.stringify({ queries: ['always-on camera power budget', 'Chansey pin camera', 'Shawn Liu proposal', 'Moneta wearable', 'on-device speaker diarization'] }));
  const md = '@Abel Mei：确认镜头常开功耗上限';
  const r = py(`sent=[];seen=[]\ndef fake(system,user,**k):\n    if k.get('purpose')=='insights-terms': return {'text':${terms},'context':{}}\n    seen.append(user)\n    return {'text':${JSON.stringify(md)},'context':{'chars':1}}\nmp.ask_model=fake\ndef fsearch(qs,sid=''):\n    sent.extend(qs);return {'references':[{'query':qs[0],'results':[{'title':'Paper','url':'https://example.com/paper','snippet':'s'}]}],'audit':'/x/insight-search-log.jsonl','queries':list(qs)}\nmp.search_industry=fsearch\nres=mp.make_insights_deep(json.loads(${JSON.stringify(JSON.stringify(INS_SESSION))}),json.loads(${JSON.stringify(JSON.stringify(INS_BRIEF))}),['Shawn Liu'])\nprint(json.dumps({'sent':sent,'user':seen[0],'search':res['insightsMeta']['search'],'md':res['insights_md']}))`);
  assert.deepEqual(r.sent, ['always-on camera power budget', 'on-device speaker diarization'], '含 Chansey / Shawn Liu / Moneta 的词整条丢掉，只留技术名词');
  assert.match(r.user, /【六、联网资料/); assert.match(r.user, /https:\/\/example\.com\/paper/);
  assert.deepEqual(r.search, { queries: ['always-on camera power budget', 'on-device speaker diarization'], urls: ['https://example.com/paper'], audit: '/x/insight-search-log.jsonl' });
  assert.equal(r.md, md);
  const q = py(`print(json.dumps(mp._clean_industry_queries(['a','a','b','c','d','e','f','nothing phone','Moneta 代号'],set())))`); assert.deepEqual(q, ['a', 'b', 'c', 'd', 'e']);
});
test('深度档：联网一条没命中 → user 里的资料块明说没查到外部资料，模型只能写「模型知识，未核实」（防编 URL）', () => {
  const r = py(`print(json.dumps(mp._references_block([{'query':'x','results':[]}])))`);
  assert.match(r, /没有查到外部资料/); assert.match(r, /模型知识，未核实/); assert.match(r, /不得编 URL/);
});
