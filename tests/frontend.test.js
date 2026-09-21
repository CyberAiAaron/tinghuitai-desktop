const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/../web/index.html','utf8');
const code=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture(){const els={};const $=k=>els[k]??={value:'',textContent:'',placeholder:'',hidden:false,dataset:{},classList:{add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],setAttribute(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}};
 const c={$,setFixMode(){},cur:{transcript:[{text:'hello'},{text:'hello'}],fixes:[]},briefFix:'',parseFixes:()=>[],setTimeout:()=>{},rememberFix:()=>{},rememberRule:()=>false,syncCorrectionContext:()=>{},persist:()=>{},resetSigs:()=>{},render:()=>{},note:()=>{},T:()=>'',ui:'zh'};
 vm.createContext(c);vm.runInContext(code('  function openFix(', '  // Literal,'),c);vm.runInContext(code("  $('#fix-save').onclick", "  $('#fix-del').onclick"),c);return{c,$,els};}
test('all inline scripts parse',()=>{for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
test('open edit shows existing sentence and saving only changes selected row',()=>{const {c,$}=fixture();c.openFix({dataset:{fix:'tr',key:'0'}});assert.equal($('#fix-text').value,'hello');assert.equal(c.cur.transcript[0].text,'hello');$('#fix-text').value='hello Person';$('#fix-save').onclick();assert.equal(c.cur.transcript[0].text,'hello Person');assert.equal(c.cur.transcript[1].text,'hello');assert.equal(c.cur.transcriptEdits[0].originalText,'hello');assert.equal(c.cur.fixes.length,0);});
test('repeated edit replaces same edit record without growth',()=>{const{c,$}=fixture();for(let i=0;i<4;i++){c.openFix({dataset:{fix:'tr',key:'0'}});$('#fix-text').value='hello Person';$('#fix-save').onclick();}assert.equal(c.cur.transcriptEdits.length,1);assert.equal(c.cur.transcript[0].text,'hello Person');});
test('dictionary applies once and skips manually edited sentences',()=>{const{c}=fixture();vm.runInContext(code('  function correctedText(', '  function syncCorrectionContext'),c);c.cur.fixes=[{wrong:'hello',right:'hello Person'}];c.cur.transcript[0].edited=true;c.cur.transcript[0].text='hello exact';for(let i=0;i<4;i++)c.applyCorrections(c.cur);assert.equal(c.cur.transcript[0].text,'hello exact');assert.equal(c.cur.transcript[1].text,'hello Person');});
test('recovery and per-meeting actions are reachable from a visible entry',()=>{
 const footer=html.slice(html.indexOf('<footer'),html.indexOf('</footer>'));
 assert.ok(footer.includes('id="b-this"'),'footer must keep one visible entry to this-meeting actions');
 assert.ok(footer.includes('id="recording-safety-status"'));
 const dlg=html.slice(html.indexOf('<dialog id="meeting-more-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="meeting-more-dialog"')));
 assert.ok(dlg.includes('id="m-recovery"'),'browser audio recovery must be reachable');
 assert.ok(dlg.includes('id="m-notes"'),'meeting attachments must be reachable');
});
// 上一轮改版把五个按钮整体塞进 <div hidden id="legacy-entries">，处理函数还绑着，
// 界面上却一个都点不到。这条守住的是「绑了点击就必须有路走到它」。
test('no click handler is bound to a permanently hidden entry',()=>{
 const m=html.match(/<div hidden id="legacy-entries">([\s\S]*?)<\/div>/);
 const hidden=m?[...m[1].matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(x=>x[1]):[];
 const orphans=hidden.filter(id=>{
  const bound=new RegExp("\\$\\('#"+id+"'\\)\\s*\\.onclick").test(html);
  if(!bound) return false;
  // 有别的可见按钮代它触发就不算孤儿
  return !new RegExp("\\$\\('#"+id+"'\\)\\.onclick\\(\\)").test(html);
 });
 assert.deepEqual(orphans,[],'these ids have click handlers but no way to reach them: '+orphans.join(', '));
});
test('clearing dictionary restores retained original text',()=>{const{c}=fixture();vm.runInContext(code('  function correctedText(', '  function syncCorrectionContext'),c);c.cur.fixes=[{wrong:'hello',right:'Person'}];c.applyCorrections(c.cur);assert.equal(c.cur.transcript[0].text,'Person');c.cur.fixes=[];c.applyCorrections(c.cur);assert.equal(c.cur.transcript[0].text,'hello');});
test('backup initialization failure warns but allows capture to continue',async()=>{const notices=[],status={};const context={RecordingSafety:{start:async()=>{throw Error('QuotaExceededError')}},asrStream:{},cur:{id:'synthetic'},ui:'zh',note:(...args)=>notices.push(args),$:()=>status,safetyRecording:null};vm.createContext(context);const snippet=code('    try { safetyRecording = await RecordingSafety.start(', '    for(const stream of [asrStream');await vm.runInContext('(async()=>{'+snippet+';return true})()',context);assert.equal(context.safetyRecording,null);assert.equal(context.backupHealthy,false);assert.equal(notices[0][1],true);assert.match(status.textContent,/备份不可用/);});
test('end delivery reports disconnected transport instead of success',()=>{const c={asrWs:null,cur:{notes:''},setTimeout:()=>{},safetyRecording:null,asrNode:null,asrCtx:null,asrStream:null,stopSpkTrack:()=>{},lastFinalAt:0};vm.createContext(c);vm.runInContext(code('  function asrStop()', '  // ===== 浏览器'),c);assert.equal(c.asrStop(),false);});
test('manual annotations and fact verdict survive dictionary updates',()=>{const{c}=fixture();vm.runInContext(code('  function correctedText(', '  function syncCorrectionContext'),c);c.cur.fixes=[{wrong:'hello',right:'Person'}];c.cur.highlights=[{text:'hello exact',edited:true}];c.cur.todos=[{text:'hello task',edited:true}];c.cur.factchecks=[{claim:'hello claim',note:'my evidence',verdict:'right',edited:true}];c.applyCorrections(c.cur);assert.equal(c.cur.highlights[0].text,'hello exact');assert.equal(c.cur.todos[0].text,'hello task');assert.equal(c.cur.factchecks[0].verdict,'right');assert.equal(c.cur.factchecks[0].note,'my evidence');});
test('overflow without healthy backup reports actual loss',()=>{const status={},c={updateAudioMeter(){},asrNode:{},asrWs:null,asrCtx:{sampleRate:1},audioQueue:[],audioQueueBytes:0,cur:{},backupHealthy:false,safetyRecording:null,ui:'zh',$:()=>status};vm.createContext(c);vm.runInContext(code('    asrNode.onaudioprocess =','    src.connect(asrNode)'),c);c.asrNode.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(64)}});assert.match(status.textContent,/音频已丢失/);assert.ok(c.cur.untranscribedSeconds>0);});
test('old history is not uploaded and fresh missing archives retry with backoff',async()=>{let uploads=0,now=1000000;const c={cur:{id:'old',end:1},archiveJobs:[],Date:{now:()=>now},persist(){},note(){},ui:'zh',uploadPending:async()=>{uploads++;}};vm.createContext(c);const run=()=>vm.runInContext('(async()=>{'+code('if(cur?.archiveAwaitingSince&&','      const failed=')+'})()',c);await run();assert.equal(uploads,0);c.cur.archiveAwaitingSince=1;await run();await run();assert.equal(uploads,1);for(let i=0;i<5;i++){now+=10000000;await run();}assert.equal(uploads,3);c.archiveJobs=[{sessionId:'old'}];await run();assert.equal(c.cur.archiveAwaitingSince,0);});
test('auto resume resolves capture mode instead of selecting browser fallback',()=>{const line=html.split('\n').find(line=>line.includes('const mode = force'));assert.ok(line.includes("force!=='auto'"));for(const force of ['auto','asr-tab','caption']){const c={force,resolveMode:()=> 'asr'};vm.runInNewContext(line+';result=mode;',c);assert.equal(c.result,force==='auto'?'asr':force);}});
test('ended correction persists retry intent, live correction does not schedule archive',()=>{let saved=0;const timers=[],c={cur:{id:'ended',end:1},running:false,persist:()=>saved++,updateFooterLabels(){},setTimeout:(f,ms)=>timers.push(ms),Date,asrMode:false};vm.createContext(c);vm.runInContext(code('  function syncCorrectionContext()', '  function rememberFix('),c);c.syncCorrectionContext();assert.equal(c.cur.pendingUpload,true);assert.equal(c.cur.archiveDirty,true);assert.equal(c.cur.archiveEditRevision,1);assert.equal(saved,1);assert.equal(timers[0],5500);c.cur={id:'live'};c.running=true;c.syncCorrectionContext();assert.equal(c.cur.pendingUpload,undefined);});
test('upload acknowledgment cannot clear a correction made during request; failed upload stays pending',async()=>{let resolve;const sess={id:'x',end:1,pendingUpload:true,archiveDirty:true,archiveEditRevision:1},c={cfg:{relayToken:'synthetic'},macOnline:true,state:{sessions:[sess]},relayBase:()=>'/synthetic',encodeURIComponent,Date,persist(){},fetch:()=>new Promise(r=>resolve=r)};vm.createContext(c);vm.runInContext(code('  async function uploadPending()', '  // 观众'),c);const p=c.uploadPending();sess.archiveEditRevision++;resolve({ok:true});await p;assert.equal(sess.pendingUpload,true);c.fetch=async()=>({ok:false});await c.uploadPending();assert.equal(sess.pendingUpload,true);c.fetch=async()=>({ok:true});await c.uploadPending();assert.equal(sess.pendingUpload,false);assert.equal(sess.archiveDirty,false);});

// 会中进度感：分组每 8 条或 3 分钟才跑一次，所以最新的几条大部分时间都躺在未归类桶里，
// 而它恰好就是「正在聊」的那一组。这三条守住的是：标记别贴在「还没归类」上、
// 编号别跟着排序变、回看仍然顺着读。
function groups(live){
 const c={ui:'zh',running:live};
 vm.createContext(c);
 vm.runInContext(code('  function groupedHighlights(','  // Wait for the recent discussion'),c);
 const at=m=>Date.UTC(2026,8,11,6,m,0);
 const items=[{text:'A1',at:at(5)},{text:'A2',at:at(7)},{text:'B1',at:at(12)},{text:'B2',at:at(14)},{text:'C1',at:at(30)}];
 const sess={hlGroups:{groups:[{title:'定了走方案二',keys:['A1','A2']},{title:'隐私不是阻力',keys:['B1','B2']}]}};
 return c.groupedHighlights(sess,items);
}
test('live meeting marks the newest group and never labels it as not-grouped-yet',()=>{
 const out=groups(true);
 assert.equal(out.at(-1).live,true);
 assert.equal(out.at(-1).ungrouped,true);
 assert.equal(out.at(-1).no,3);
 assert.ok(out[0].from<out[1].from&&out[1].from<out[2].from,'outline stays chronological while live');
});
test('group numbers follow first-mention time, not the live ordering',()=>{
 const live=groups(true), back=groups(false);
 // vm 里造出来的对象跨 realm，deepEqual 会因为原型不同判不等，这里比字符串
 const no=list=>JSON.stringify(list.map(g=>[g.list.map(x=>x.text).join(','),g.no]).sort());
 assert.equal(no(live),no(back));
 assert.equal(back.map(g=>g.no).join(','),'1,2,3');
});
test('review order stays chronological',()=>{
 const out=groups(false);
 assert.ok(out[0].from<out[1].from&&out[1].from<out[2].from);
 assert.ok(!out.some(g=>g.live));
});

// 一句话改要点：模型回什么都得先过这一关。最要紧的是 drop 不能和别的动作同时执行——
// 一边删掉这条、一边往长期词表和规则里写，是最难查的那种错。
function intent(){
 const c={};
 vm.createContext(c);
 vm.runInContext(code('  const FIX_FIELDS =','  function fixTargetOf('),c);
 return c.readFixIntent;
}
test('one-line edit rejects a delete that also changes other things',()=>{
 const r=intent();
 assert.equal(r({drop:true,text:'x'},'hl').bad,'conflict');
 assert.equal(r({drop:true,rule:'以后都这样'},'hl').bad,'conflict');
 assert.equal(r({drop:true,lexicon:{wrong:'a',right:'b'}},'hl').bad,'conflict');
 assert.equal(r({drop:true},'hl').ok,true);
});
test('one-line edit rejects fields the item type does not have',()=>{
 const r=intent();
 assert.equal(r({verdict:'true'},'hl').bad,'field');      // 要点没有「判断」这一栏
 assert.equal(r({note:'x'},'hl').bad,'field');
 assert.equal(r({verdict:'true'},'ck').ok,true);
 assert.equal(r({whatever:1},'ck').bad,'field');
});
test('one-line edit rejects unusable answers instead of writing nothing silently',()=>{
 const r=intent();
 assert.equal(r('not json','hl').bad,'json');
 assert.equal(r('[1,2]','hl').bad,'json');
 assert.equal(r({},'hl').bad,'empty');
 assert.equal(r({text:'   '},'hl').bad,'empty');
 assert.equal(r({lexicon:{wrong:'a',right:''}},'hl').bad,'empty');
});
test('one-line edit accepts the four shapes the model actually returns',()=>{
 const r=intent();
 // vm 里造的数组跨 realm，deepEqual 会因原型不同判不等，比字符串
 assert.equal(r({text:'改过的正文'},'hl').acts.join(','),'text');
 assert.equal(r({text:'x',lexicon:{wrong:'proof',right:'post'}},'ck').acts.join(','),'text,lexicon');
 assert.equal(r({drop:true},'hl').acts.join(','),'drop');
 assert.equal(r({rule:'以后「可以考虑」不算拍板',ruleKeep:true},'hl').acts.join(','),'rule');
});

// 补充信息、起名、认日历：Aaron 09-16 说「S0 是 shawn，这个会我日历上有」被退回细项表单。
// 这三种形状都得认，而且可以和别的动作同时出现；名字只收干净的 {"0":"Shawn"}。
test('one-line window accepts memo / names / calendar, alone or together',()=>{
 const r=intent();
 assert.equal(r({memo:'还提到预算要砍一半'},'hl').acts.join(','),'memo');
 const n=r({names:{'S0':'Shawn','1':'Cary','x':'bad','2':''}},'hl');
 assert.equal(n.acts.join(','),'names'); assert.equal(JSON.stringify(n.intent.names),'{"0":"Shawn","1":"Cary"}');
 assert.equal(r({calendar:'confirm'},'hl').acts.join(','),'calendar');
 assert.equal(r({calendar:'maybe'},'hl').bad,'empty');
 assert.equal(r({names:{'0':'Shawn'},calendar:'confirm'},'tr').acts.join(','),'names,calendar');
 assert.equal(r({text:'x',memo:'y'},'ck').acts.join(','),'text,memo');
 assert.equal(r({drop:true,memo:'y'},'hl').bad,'conflict');
 assert.equal(r({handoff:'x',names:{'0':'a'}},'hl').bad,'conflict');
});

// 按钮点「改好」和文本框按回车必须走同一套分发：task 模式下两者都要交给 handoffSaid，
// 不能只改了按钮、漏了键盘（这正是 Codex 20260916-1920 报的缺陷）。
test('Enter in the one-line box dispatches on fixMode, same as the button',()=>{
 for (const mode of ['edit','task']) {
  const calls=[];
  const handlers={};
  const c={fixMode:mode,applySaid:()=>calls.push('apply'),handoffSaid:()=>calls.push('handoff'),
   $:()=>({addEventListener:(evt,fn)=>{handlers[evt]=fn;},onclick:null,close(){}})};
  vm.createContext(c);
  vm.runInContext(code("  $('#fix-say-cancel').onclick","  $('#fix-save').onclick"),c);
  handlers.keydown({key:'Enter',shiftKey:false,isComposing:false,preventDefault(){}});
  assert.deepEqual(calls, mode==='task' ? ['handoff'] : ['apply'], 'mode='+mode);
 }
});

// 上面几条测试靠字符串切片取函数体。签名一改标记就失配，indexOf 返回 -1，
// 切片会一路切到文件末尾、报一个看不懂的语法错。这条直接检查标记还在不在。
test('the source markers these tests slice on still exist',()=>{
 for (const m of ['  function groupedHighlights(','  // Wait for the recent discussion','  function openFix(',
                  '  // Literal,',"  $('#fix-save').onclick","  $('#fix-del').onclick",
                  '  function syncCorrectionContext()','  function rememberFix(',
                  '  const FIX_FIELDS =','  function fixTargetOf(',"  $('#fix-say-cancel').onclick",
                  '  function validateOutline(','  // ===== 往期会议看板']) {
  assert.ok(html.includes(m), 'missing slice marker: '+m);
 }
});

// 每个弹窗都得有一个「点得到」的关闭方式。折叠区（<details>）里的不算——折起来就点不到。
// 2026-09-12：设置弹窗把「取消/保存」整行关进了「高级」里，折叠状态下一个按钮都没有，关都关不掉。
test('every dialog has a close control that is not buried in a collapsed section',()=>{
 const CLOSE=/(data-x\b|data-close\b|class="[^"]*archive-close|id="[a-zA-Z-]*(?:close|cancel)"|>\s*(?:关闭|取消|Close|Cancel)\s*<)/;
 const bad=[];
 for (const m of html.matchAll(/<dialog id="([A-Za-z0-9_-]+)"/g)) {
  const i=m.index, j=html.indexOf('</dialog>', i);
  const visible=html.slice(i,j).replace(/<details[\s\S]*?<\/details>/g,'');
  if(!CLOSE.test(visible)) bad.push(m[1]);
 }
 assert.deepEqual(bad.length,0,'dialogs with no reachable close control: '+bad.join(', '));
});

function outlineValidator(){const c={};vm.createContext(c);vm.runInContext(code('  function validateOutline(', '  // ===== 往期会议看板'),c);return c.validateOutline;}
// 2026-09-20 起 keys/roles/merged 都是序号，不是原文：序号换回原文由 validateOutline 做，
// 越界、重复、指向被手改过的要点、以及直接回原文字符串，一律整组丢掉（要点退回平铺，不会消失）。
test('outline rejects out-of-range numbers, duplicates, raw text and hiding manual edits',()=>{
 const check=outlineValidator(),items=[{text:'one'},{text:'two',edited:true},{text:'three'}];
 assert.equal(check({groups:[{title:'x',summary:'y',keys:[9]}]},items).length,0,'越界');
 assert.equal(check({groups:[{title:'x',summary:'y',keys:[-1]}]},items).length,0,'负数');
 assert.equal(check({groups:[{title:'x',summary:'y',keys:['one']}]},items).length,0,'回原文不算序号');
 assert.equal(check({groups:[{title:'x',summary:'y',keys:[1]}]},items).length,0,'手改过的要点不能被藏起来');
 assert.equal(check({groups:[{title:'x',summary:'y',keys:[0,0]}]},items).length,0,'同一条报两次');
 assert.equal(check({groups:[{title:'x',summary:'y',keys:[0]},{title:'z',summary:'w',keys:[0,2]}]},items).length,1,'跨组重复的那一组丢掉');
 const ok=check({groups:[{title:'x',summary:'y',keys:[0,2]}]},items);
 assert.equal(ok.length,1);assert.equal(ok[0].keys.join(','),'one,three','序号换回原文');
});
test('outline roles and merged are looked up by number and stored by source text',()=>{
 const check=outlineValidator(),items=[{text:'a'},{text:'b'},{text:'c'},{text:'d'}];
 const g=check({groups:[{title:'t',summary:'s',status:'unresolved',keys:[0,1,2],
   roles:{'1':'否定','2':'瞎编的','3':'分歧'},merged:{'0':[1,2,3,0]}}]},items)[0];
 assert.equal(g.status,'unresolved');
 assert.equal(JSON.stringify(g.roles),'{"b":"否定"}','不认识的角色和组外的序号都丢掉');
 assert.equal(JSON.stringify(g.merged),'{"a":["b","c"]}','组外的 3 和指向自己的 0 都丢掉');
});
test('changed source invalidates condensation, unmatched points remain visible and numbered',()=>{
 const c={ui:'zh',running:true};vm.createContext(c);vm.runInContext(code('  function groupedHighlights(','  // Wait for the recent discussion'),c);
 const out=c.groupedHighlights({hlGroups:{groups:[{title:'old',summary:'old synthesis',keys:['one','two']}] }},[{text:'one',at:1},{text:'corrected two',at:2},{text:'new',at:3}]);
 assert.equal(out[0].summary,'');assert.equal(out.flatMap(g=>g.list).length,3);assert.equal(out.map(g=>g.no).join(','),'1,2,3');
});

// 一句话窗口现在也能「交给主 Claude 去干」：handoff 是独占动作，和改字、删除、记词、立规则都不能同时出现。
test('one-line window: handoff is exclusive and accepted on its own',()=>{
 const r=intent();
 assert.equal(r({handoff:'把这条查一下写个对比'},'hl').acts.join(','),'handoff');
 assert.equal(r({handoff:'x',text:'y'},'hl').bad,'conflict');
 assert.equal(r({handoff:'x',drop:true},'hl').bad,'conflict');
 assert.equal(r({handoff:'x',verdict:'true'},'ck').bad,'conflict');
 assert.equal(r({handoff:'   '},'hl').bad,'empty');
});
function speakerFixture(transcript,names={}){const c={cur:{id:'m1',transcript,names},state:{names:{}},SPK_DEF:()=>({me:'我',them:'线上'})};vm.createContext(c);vm.runInContext(code('  const fillerASR =','  const spkCls ='),c);return c;}
test('speaker numbers are shown densely in order of first appearance while raw ids stay in the data',()=>{
 const tr=[{spk:'6',text:'a'},{spk:'0',text:'b'},{spk:'6',text:'c'},{spk:'9',text:'d'},{spk:'me',text:'e'}];const c=speakerFixture(tr);
 const r=e=>vm.runInContext(e,c);
 assert.equal(r("spkName('6')"),'S1');assert.equal(r("spkName('0')"),'S2');assert.equal(r("spkName('9')"),'S3');assert.equal(r("spkName('me')"),'我');
 assert.equal(r("spkName('4')"),'S4','an id that never spoke falls back to its raw number');
 assert.equal(tr[0].spk,'6');
 tr.push({spk:'2',text:'f'});assert.equal(r("spkName('2')"),'S4','new speakers append without renumbering earlier ones');assert.equal(r("spkName('9')"),'S3');
});
test('S-numbers inside notes follow the same labels, use given names, and leave product names alone',()=>{
 const c=speakerFixture([{spk:'6',text:'a'},{spk:'0',text:'b'}],{'0':'Shawn'});const r=e=>vm.runInContext(e,c);
 assert.equal(r("spkText('S6 承认还没想清楚，S0 反驳；对标 S24 和 XS6，GS0')"),'S1 承认还没想清楚，Shawn 反驳；对标 S24 和 XS6，GS0');
 assert.equal(r("spkText(null)"),'');
});
test('only pure interjections count as filler; agreement words are kept',()=>{
 const c=speakerFixture([]);const r=t=>vm.runInContext('fillerASR('+JSON.stringify(t)+')',c);
 for(const t of['啊。','嗯嗯，','哦…','Um.','hmm','呃啊'])assert.equal(r(t),true,t);
 for(const t of['对','好。','是的','嗯行','啊对','ok','','谢谢'])assert.equal(r(t),false,t);
});
// 2026-09-20：跳转处理器绑在 [data-jump-at] 上，但 pointCard 从来没吐过这个按钮，
// 转写段落也没有 data-at——两头都不在，功能整条是死的，测试却全绿。这条守住「绑了就得有人产」。
test('every point can jump to what was said: button, anchor and handler all exist',()=>{
 const src=fs.readFileSync(__dirname+'/../web/src/11-render.js','utf8');
 assert.ok(src.includes('data-jump-seg="${esc(seg)}" data-jump-at="${jat}"'),'论点卡要产出跳转按钮');
 assert.ok(src.includes('<p data-at="${Number(x.at)||0}" data-seg='),'转写段落要带 data-at 和 data-seg 锚点');
 assert.ok(src.includes("ps.find(p => p.dataset.seg === seg)"),'优先按 segId 精确命中');
 assert.ok(src.includes("querySelectorAll('[data-jump-at]')"),'跳转处理器还在');
 assert.ok(src.includes("el.tr.querySelectorAll('p[data-at]')"),'处理器找的就是那个锚点');
});
test('view cards keep the raw claim as their key so edit and feedback still find the item',()=>{
 const src=fs.readFileSync(__dirname+'/../web/src/11-render.js','utf8');
 assert.ok(src.includes('data-fix="ck" data-key="${esc(x.claim)}"'));assert.ok(!src.includes('data-key="${esc(tt('),'no card key may go through the display mapper');
 assert.ok(src.includes('find(x=>x.claim===key)'));
});

// 2026-09-20 会中进度感：旧组冻结，只把「最后一组 + 新要点」送模型。
function outlineTools(){const c={};vm.createContext(c);vm.runInContext('const OUTLINE_CHUNK=80;'+code('  function outlinePlan(', '  function validateOutline(')+';this.outlinePlan=outlinePlan;this.mergeOutline=mergeOutline;this.outlineCovered=outlineCovered;',c);return c;}
// Codex 09-20 审出：模型把整批 80 条归成一个组时，冻结组是 0 → 被记成没进展，下一轮还原样重送同一批。
test('outline: one group covering a whole chunk still counts as progress and is not re-sent',()=>{
 const t=outlineTools();
 const ready=Array.from({length:120},(_,i)=>({text:'P'+i}));
 const big=[{title:'一个大议题',summary:'s',keys:ready.slice(0,80).map(x=>x.text)}];
 assert.equal(t.outlineCovered(big),80);                 // 进度 = 已归组的要点数，含最后一组
 const plan=t.outlinePlan(big,ready);
 assert.equal(plan.frozen.length,1);assert.equal(plan.last,null);
 assert.equal(plan.tail.length,40);assert.equal(plan.tail[0].text,'P80');   // 下一轮从第 81 条接着排
 const out=t.mergeOutline(plan,[{title:'后续',summary:'s2',keys:['P80','P81']}]);
 assert.equal(out.length,2);assert.equal(out[0].title,'一个大议题');
});
test('outline: a small last group stays open so new points can join it across chunks',()=>{
 const t=outlineTools();
 const ready=Array.from({length:140},(_,i)=>({text:'P'+i}));
 const prev=[{title:'A',summary:'s',keys:ready.slice(0,10).map(x=>x.text)},{title:'B',summary:'s',keys:ready.slice(10,40).map(x=>x.text)}];
 const plan=t.outlinePlan(prev,ready);
 assert.equal(plan.frozen.length,1);assert.equal(plan.last.title,'B');
 assert.equal(plan.tail.length,130);                      // B 的 30 条 + 100 条新要点
 assert.equal(plan.tail.slice(0,80).filter(x=>Number(x.text.slice(1))>=40).length,50);   // 一批 80 条里有 50 条是新的
});
test('outline: empty or keyless groups fall back to a full re-plan and count as zero progress',()=>{
 const t=outlineTools();
 const ready=[{text:'A1'},{text:'A2'}];
 assert.equal(t.outlineCovered([]),0);assert.equal(t.outlineCovered([{title:'x'}]),0);assert.equal(t.outlineCovered(null),0);
 assert.equal(t.outlinePlan([{title:'x',keys:[]}],ready).tail.length,2);
 assert.equal(t.outlinePlan([{title:'x'}],ready).frozen.length,0);
});
test('outline freezes settled groups and only re-sends the tail',()=>{
 const t=outlineTools();
 const prev=[{title:'定了走方案二',summary:'s1',keys:['A1','A2']},{title:'隐私不是阻力',summary:'s2',keys:['B1']}];
 const ready=['A1','A2','B1','B2','C1'].map(x=>({text:x}));
 const plan=t.outlinePlan(prev,ready);
 assert.deepEqual(plan.tail.map(x=>x.text),['B1','B2','C1']);
 const out=t.mergeOutline(plan,[{title:'隐私有两条线',summary:'n',keys:['B1','B2']},{title:'新话题',summary:'n2',keys:['C1']}]);
 assert.equal(out[0].title,'定了走方案二');assert.equal(out[0].summary,'s1');
 assert.equal(out.length,3);
 // 最后一组没进新要点：标题沿用
 const out2=t.mergeOutline(plan,[{title:'被改写的标题',summary:'x',keys:['B1']},{title:'新话题',summary:'n2',keys:['B2','C1']}]);
 assert.equal(out2[1].title,'隐私不是阻力');
 // 模型什么都没归：旧大纲原样保留
 assert.equal(t.mergeOutline(plan,[]).length,2);
});
test('outline falls back to a full pass when a settled point was edited or removed',()=>{
 const t=outlineTools();
 const prev=[{title:'a',summary:'s',keys:['A1','A2']},{title:'b',summary:'s',keys:['B1']}];
 assert.equal(t.outlinePlan(prev,[{text:'A1'},{text:'B1'},{text:'B2'}]).frozen.length,0);
 assert.equal(t.outlinePlan(prev,[{text:'A1'},{text:'A2',edited:true},{text:'B1'}]).tail.length,3);
 assert.equal(t.outlinePlan([],[{text:'A1'},{text:'A2'}]).tail.length,2);
});
test('outline keeps the last settled group when the model omits it, and counts duplicate texts',()=>{
 const t=outlineTools();
 const prev=[{title:'g1',summary:'s',keys:['A1','A2']},{title:'g2',summary:'s',keys:['B1','B2']}];
 const plan=t.outlinePlan(prev,['A1','A2','B1','B2','A1','C1'].map(x=>({text:x})));
 assert.deepEqual(plan.tail.map(x=>x.text),['B1','B2','A1','C1']);
 const out=t.mergeOutline(plan,[{title:'n',summary:'s',keys:['C1']}]);
 assert.deepEqual(out.map(g=>g.title),['g1','g2','n']);
 const out2=t.mergeOutline(plan,[{title:'half',summary:'s',keys:['B1','C1']}]);
 assert.deepEqual(out2.map(g=>g.title),['g1','g2']);
});
// R1：中转 12 分钟没收到音频就自己收尾并发 ended。页面原来收到它只记一笔、继续录，
// 结果手机锁屏解锁之后的后半场一个字都没进库，界面上还显示着正在听会。
// 起点要写得够长：15-tongue.js 里也有一条同样缩进的 ended 分支，只写前半句会切错地方
const endedBranch=()=>{const b=code("else if (m.type === 'ended') { cur.relayHandled=true","      else if (m.type === 'stall')");
 return 'handleRelay=(m)=>{if(false){}'+b+'};';};
const relayCtx=over=>{const c={cur:{},persist(){},refreshArchive(){},stops:[],notes:[],ui:'zh',T:()=>'',
  stopAll(...a){c.stops.push(a);c.running=false;},note(...a){c.notes.push(a);},running:true,...over};
 vm.createContext(c);vm.runInContext(endedBranch(),c);return c;};

test('服务端结束了这场会而本机还在录：立刻停录，并且用红条说明后面没录上',()=>{
 const c=relayCtx();
 c.handleRelay({type:'ended'});
 assert.equal(c.cur.relayHandled,true);
 assert.deepEqual(c.stops,[[false]],'要停录，且不是用户主动结束那条路');
 assert.equal(c.notes.length,1);
 assert.equal(c.notes[0][1],'danger','这条必须是红条，黄条会被当成又一次网络抖动');
 assert.match(c.notes[0][0],/没有被记录/);
 assert.match(c.notes[0][0],/重新开始/,'要告诉人下一步做什么');
});

test('英文界面下这条提示也是英文',()=>{
 const c=relayCtx({ui:'en'});
 c.handleRelay({type:'ended'});
 assert.match(c.notes[0][0],/not recorded/);
});

test('本机已经不在录了（正常结束后收到 ended）：不弹红条、不重复停录',()=>{
 const c=relayCtx({running:false});
 c.handleRelay({type:'ended'});
 assert.equal(c.cur.relayHandled,true);
 assert.deepEqual(c.stops,[]);
 assert.deepEqual(c.notes,[]);
});

test('红条是真的红：note 认 danger，样式表里也有这一档',()=>{
 const c={el:{notice:{}}};vm.createContext(c);
 // const 声明不会挂到 vm 的上下文对象上，换成 var 才拿得到；跑的仍是页面里那一行真代码
 vm.runInContext(code('  const note = (msg, warn)','  const noteAction').replace('const note','var note'),c);
 c.note('普通');assert.equal(c.el.notice.className,'notice');
 c.note('黄条',true);assert.equal(c.el.notice.className,'notice warn');
 c.note('红条','danger');assert.equal(c.el.notice.className,'notice warn danger');
 assert.equal(c.el.notice.hidden,false);
 assert.match(html,/\.notice\.danger\{[^}]*var\(--conf\)/,'样式表里得有 danger 这一档，否则红条只是个类名');
});

// R12：每来一句 final 就把全部历史场次整份写进 localStorage，超配额后每次写都静默失败，
// 界面照常显示，一刷新全没了。存盘只留「当前 + 最近 3 场 + 还没送到 Mac 的」。
const persistCtx=over=>{
 const store={};let fail=0;
 const c={state:{sessions:[],names:{我:'A'},live:null},cur:null,applyCorrections(){},notes:[],
   note:(...a)=>c.notes.push(a),
   localStorage:{setItem(k,v){if(fail>0){fail--;const e=Error('QuotaExceededError');throw e;}store[k]=v;}},
   failTimes(n){fail=n;},saved:()=>JSON.parse(store['tht-state']||'null'),...over};
 vm.createContext(c);
 // 末尾这一句在同一段脚本里，所以能看见上面 const 声明的 persist，把它挂到上下文上
 vm.runInContext(code('  const KEEP_RECENT = 3;','  function normalizeSession(')+';this.runPersist=persist;',c);
 return c;};
const mkSess=(id,start,extra={})=>({id,start,transcript:[{text:'x'}],...extra});

test('存盘只留当前和最近 3 场，内存里一场不少',()=>{
 const c=persistCtx();
 for(let i=1;i<=20;i++)c.state.sessions.push(mkSess('s'+i,i*1000));
 c.cur=c.state.sessions[0];                       // 最老的那场正在看
 c.runPersist();
 const ids=c.saved().sessions.map(s=>s.id);
 assert.deepEqual(ids.sort(),['s1','s18','s19','s20'].sort(),'最近 3 场加上当前这场');
 assert.equal(c.state.sessions.length,20,'内存里的场次一场都不能少');
 assert.equal(c.saved().names['我'],'A','别的字段要原样留着');
 assert.deepEqual(c.notes,[]);
});

test('还没送到 Mac 的旧场次不许被挤掉',()=>{
 const c=persistCtx();
 for(let i=1;i<=10;i++)c.state.sessions.push(mkSess('s'+i,i*1000));
 c.state.sessions[0].pendingUpload=true;          // 很老，但还没上传
 c.state.sessions[1].archiveDirty=true;           // 改过、还没同步
 c.state.sessions[2].archiveAwaitingSince=Date.now();
 c.runPersist();
 const ids=c.saved().sessions.map(s=>s.id);
 for(const id of ['s1','s2','s3'])assert.ok(ids.includes(id),id+' 还没安全落到 Mac，不能丢');
});

test('正在进行的那场（state.live）也一定留着',()=>{
 const c=persistCtx();
 for(let i=1;i<=10;i++)c.state.sessions.push(mkSess('s'+i,i*1000));
 c.state.live='s2';
 c.runPersist();
 assert.ok(c.saved().sessions.map(s=>s.id).includes('s2'));
});

test('单场太大写不下时，退到只保当前和没送走的，而不是整份写失败',()=>{
 const c=persistCtx();
 for(let i=1;i<=10;i++)c.state.sessions.push(mkSess('s'+i,i*1000));
 c.state.sessions[0].pendingUpload=true;
 c.cur=c.state.sessions[9];
 c.failTimes(1);                                   // 第一次写超配额
 c.runPersist();
 assert.deepEqual(c.saved().sessions.map(s=>s.id).sort(),['s1','s10'].sort());
 assert.deepEqual(c.notes,[],'还写得下就别吓人');
});

test('两次都写不下才提示清理',()=>{
 const c=persistCtx();
 c.state.sessions.push(mkSess('s1',1000));
 c.cur=c.state.sessions[0];
 c.failTimes(2);
 c.runPersist();
 assert.equal(c.notes.length,1);
 assert.match(c.notes[0][0],/本机存储满了/);
 assert.equal(c.notes[0][1],true);
});

// X8：助手卡片上给人看、能改的是一段描述，点「确认」之后发到 Slack 的却是服务端另外生成的正文——
// 等于在确认一段自己没见过的内容。改成两步：先把正文填回卡片，看过（或改过）再发。
const shareCtx=fetchImpl=>{
 const c={cfg:{relayToken:'t'},ui:'zh',relayBase:()=>'',fetch:fetchImpl,setTimeout:f=>f(),
   encodeURIComponent,Date,cur:{id:'m1',title:'一场会',start:1,transcript:[{text:'有内容'}]}};
 vm.createContext(c);
 vm.runInContext(code('  async function runShareAction(kind, progress, approved){','  function draftAction(a){'),c);
 return c;};
const bundleFetch=()=>{const hits=[];return {hits,impl:async(url,opt)=>{hits.push({url,body:opt&&opt.body});
  if(url.includes('/sharing/slack/send')) return {ok:true,json:async()=>({ok:true,permalink:'https://x'})};
  if(url.includes('/sharing/bundle?key=')) return {ok:true,json:async()=>({status:'done',bundle:{slackText:'这是纪要正文'}})};
  return {ok:true,json:async()=>({key:'K1'})};}};};

test('第一次点确认只把 Slack 正文取回来，一个字都还没发出去',async()=>{
 const f=bundleFetch(), c=shareCtx(f.impl);
 const r=await c.runShareAction('slack_self',()=>{});
 assert.equal(r.needsConfirm,true);
 assert.equal(r.ok,false,'还没发，不能报成功');
 assert.equal(r.text,'这是纪要正文');
 assert.equal(r.key,'K1');
 assert.ok(!f.hits.some(h=>h.url.includes('/sharing/slack/send')),'这一步绝不能真的发出去');
});

test('确认之后发出去的就是交上来的那段正文，而且不重新生成分享包',async()=>{
 const f=bundleFetch(), c=shareCtx(f.impl);
 const r=await c.runShareAction('slack_self',()=>{},{key:'K1',text:'我改过的正文'});
 assert.equal(r.ok,true);
 const sent=f.hits.filter(h=>h.url.includes('/sharing/slack/send'));
 assert.equal(sent.length,1);
 const body=JSON.parse(sent[0].body);
 assert.equal(body.text,'我改过的正文');
 assert.equal(body.bundleKey,'K1');
 assert.equal(body.channel,'self');
 assert.equal(f.hits.length,1,'第二步不该再去建一次分享包（又是两分钟）');
});

// 卡片这一头：第一次点确认填正文并改按钮，第二次点才发，发的是卡片上当时显示的那段
const cardCtx=runShare=>{
 const c={ui:'zh',esc:s=>String(s),watchHandoff(){},relayBase:()=>'',cfg:{},cur:{id:'m1'},
   a:{kind:'slack_self',title:'发到我的 Slack',detail:'助手写的一句话描述'},
   card:{children:[{textContent:'发到我的 Slack',isContentEditable:false},{textContent:'助手写的一句话描述'},{children:[]}],style:{}},
   ok:{disabled:false,textContent:'确认'},no:{disabled:false},msg:{textContent:'',innerHTML:''},
   // draftAction 里那个 let pendingShare 不在切片范围内，在 vm 里得先给上下文一个同名的格子
   pendingShare:null,
   runShareAction:runShare,fetch:async()=>({json:async()=>({})}),encodeURIComponent,JSON,AbortSignal};
 vm.createContext(c);
 vm.runInContext(code('    ok.onclick=async()=>{',"    $('#assistant-log').append(card);"),c);
 return c;};

test('卡片：第一次确认填回正文、按钮改成「确认发送」，第二次才真发',async()=>{
 const calls=[];
 const c=cardCtx(async(kind,progress,approved)=>{calls.push({kind,approved});
   return approved?{ok:true,summary:'已发到你自己的 Slack 私信'}:{ok:false,needsConfirm:true,key:'K1',text:'这是纪要正文'};});
 await c.ok.onclick();
 assert.equal(calls.length,1);
 assert.ok(!calls[0].approved,'第一次不带确认过的正文');
 assert.equal(c.card.children[1].textContent,'这是纪要正文','卡片上要显示真正会发出去的那段');
 assert.equal(c.ok.textContent,'确认发送');
 assert.equal(c.ok.disabled,false,'还得让人能点第二下');
 assert.match(c.msg.textContent,/就是要发出去的正文/);

 c.card.children[1].textContent='我改过的正文';      // 人点了「改一下再发」改完
 await c.ok.onclick();
 assert.equal(calls.length,2);
 assert.equal(calls[1].approved.key,'K1','复用第一步那个分享包');
 assert.equal(calls[1].approved.text,'我改过的正文','发出去的必须是卡片上当时那一段');
 assert.match(c.msg.innerHTML,/已发到你自己的 Slack/);
});

test('卡片：取消发生在发出去之前，所以真的什么都没发',()=>{
 const calls=[];
 const c=cardCtx(async(...a)=>{calls.push(a);return {ok:false,needsConfirm:true,key:'K1',text:'正文'};});
 vm.runInContext(code('    no.onclick=()=>{','    ok.onclick=async()=>{'),c);
 c.no.onclick();
 assert.equal(c.ok.disabled,true);
 assert.equal(calls.length,0);
});
