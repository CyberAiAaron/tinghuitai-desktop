const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/../web/index.html','utf8');
const code=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture(){const els={};const $=k=>els[k]??={value:'',textContent:'',dataset:{},classList:{add(){},remove(){},contains:()=>false},showModal(){this.open=true},close(){this.open=false},focus(){}};
 const c={$,cur:{transcript:[{text:'hello'},{text:'hello'}],fixes:[]},briefFix:'',parseFixes:()=>[],setTimeout:()=>{},rememberFix:()=>{},rememberRule:()=>false,syncCorrectionContext:()=>{},persist:()=>{},resetSigs:()=>{},render:()=>{},note:()=>{},T:()=>'',ui:'zh'};
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
 vm.runInContext(code('  function groupedHighlights(','  // 触发：要点比上次分组'),c);
 const at=m=>Date.UTC(2026,8,11,6,m,0);
 const items=[{text:'A1',at:at(5)},{text:'A2',at:at(7)},{text:'B1',at:at(12)},{text:'B2',at:at(14)},{text:'C1',at:at(30)}];
 const sess={hlGroups:{groups:[{title:'定了走方案二',keys:['A1','A2']},{title:'隐私不是阻力',keys:['B1','B2']}]}};
 return c.groupedHighlights(sess,items);
}
test('live meeting marks the newest group and never labels it as not-grouped-yet',()=>{
 const out=groups(true);
 assert.equal(out[0].live,true);
 assert.notEqual(out[0].title,'还没归类');
 assert.equal(out[0].title,'刚刚聊到');
 assert.ok(out[1].to<out[0].to,'newest group must sit on top during a meeting');
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

// 上面几条测试靠字符串切片取函数体。签名一改标记就失配，indexOf 返回 -1，
// 切片会一路切到文件末尾、报一个看不懂的语法错。这条直接检查标记还在不在。
test('the source markers these tests slice on still exist',()=>{
 for (const m of ['  function groupedHighlights(','  // 触发：要点比上次分组','  function openFix(',
                  '  // Literal,',"  $('#fix-save').onclick","  $('#fix-del').onclick",
                  '  function syncCorrectionContext()','  function rememberFix(',
                  '  const FIX_FIELDS =','  function fixTargetOf(']) {
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
