// 界面与服务端之间的契约。这些不是功能测试，是「同一类事故不要再发生」的闸门。
// 每条都对应一次真实事故，出处写在各自的注释里。
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const html=read('web/index.html');
const server=read('app/server.js');

// ——— 1. 前端请求的路径，不能被更靠前的路由抢走 ———
// 2026-09-12 事故：work.js 调 /asr-relay/hub/update 保存待办，却被更靠前的 p.endsWith('/update')
// （应用自更新）接走：点一下改待办，程序去跑了一次自更新，而那条编辑没保存。
// 「收进工作台」/hub/session 同样被 endsWith('/session') 接走。
function serverRoutes(){
  const out=[];
  for (const line of server.split('\n')) {
    const code = line.replace(/^\s*\/\/.*$/,'');        // 整行注释不算路由
    for (const m of code.matchAll(/p\.endsWith\('([^']+)'\)/g)) out.push({kind:'endsWith', lit:m[1]});
    for (const m of code.matchAll(/p\s*===\s*'(\/[^']*)'/g)) out.push({kind:'eq', lit:m[1]});
    for (const m of code.matchAll(/\.replace\(\/\^\\\/asr-relay\/,''\)\.startsWith\('([^']+)'\)/g)) out.push({kind:'startsWith', lit:m[1]});
    for (const m of code.matchAll(/p\.startsWith\('([^']+)'\)/g)) out.push({kind:'startsWith', lit:m[1]});
  }
  return out;
}
const strip = p => p.replace(/^\/asr-relay/,'');
function matches(route, full){
  const p = full, q = strip(full);
  if (route.kind==='endsWith') return p.endsWith(route.lit);
  if (route.kind==='eq') return p===route.lit || q===route.lit;
  return q.startsWith(route.lit) || p.startsWith(route.lit);
}
function clientPaths(){
  const out=new Set();
  const add=p=>{ const clean=String(p).split('?')[0].replace(/\/$/,''); if(clean.startsWith('/')) out.add(clean.startsWith('/asr-relay')?clean:'/asr-relay'+clean); };
  for (const m of html.matchAll(/relayBase\(\)\s*\+\s*[`']([^`']+)/g)) add(m[1]);
  for (const m of html.matchAll(/relayBase\(\)\}([^`'?]+)/g)) add(m[1]);
  for (const m of html.matchAll(/hubAPI\('([a-z-]+)'/g)) add('/hub/'+m[1]);
  const work=read('web/work.js');
  const base=(work.match(/const base\s*=\s*'([^']+)'/)||[])[1]||'';
  for (const m of work.matchAll(/api\('(\/[^']*)'/g)) add(base+m[1]);
  add(base);
  for (const f of ['web/archive.js','web/memory.html'])
    for (const m of read(f).matchAll(/fetch\('(\/asr-relay\/[^'?]+)/g)) add(m[1]);
  return [...out];
}
test('no front-end request is swallowed by an earlier route', ()=>{
  const routes=serverRoutes(), bad=[];
  for (const p of clientPaths()){
    const hit=routes.map((r,i)=>({r,i})).filter(x=>matches(x.r,p));
    if (!hit.length) continue;                                   // 未覆盖的另有一条测试管
    const ns=hit.find(x=>x.r.kind==='startsWith');
    if (ns && hit[0].i !== ns.i)
      bad.push(`${p} 先命中 ${hit[0].r.kind}('${hit[0].r.lit}')，而它属于 ${ns.r.kind}('${ns.r.lit}')`);
  }
  assert.deepEqual(bad, [], '路由被抢：\n  '+bad.join('\n  '));
});
test('every front-end request path has a route on the server', ()=>{
  const routes=serverRoutes(), missing=clientPaths().filter(p=>!routes.some(r=>matches(r,p)));
  assert.deepEqual(missing, [], '前端在请求服务端没有的路径：'+missing.join(', '));
});

// ——— 2. 首屏滚动方向必须和排序方向一致 ———
// 2026-09-12：要点会中改成「最新的在最上面」之后，首次渲染仍然滚到底，等于把人扔到最旧那一组。
test('first paint scrolls to whichever end holds the newest item', ()=>{
  const i=html.indexOf('if (hlPaintedFor !== (cur && cur.id))');
  assert.ok(i>0, '找不到首屏滚动那段');
  const blk=html.slice(i, i+420);
  assert.ok(/scrollTop\s*=\s*running\s*\?\s*el.hl.scrollHeight\s*:\s*0/.test(blk), 'live opens at newest bottom; ended outline opens at top');
});

// ——— 3. 文案：属性写法合法，且英文有对应 ———
// 2026-09-11：出现过 data-i18n="sh_kind"data-i18n="kind_title"（两个属性中间没空格），标题一直没被翻译。
test('i18n attributes are well formed and covered in English', ()=>{
  assert.equal((html.match(/"data-i18n/g)||[]).length, 0, '有属性紧挨着上一个属性的引号写，中间缺空格');
  const keys=new Set([...html.matchAll(/data-i18n(?:-ph)?="([A-Za-z0-9_]+)"/g)].map(m=>m[1]));
  const i=html.search(/\ben:\s*\{/); assert.ok(i>0);
  let j=html.indexOf('{',i), depth=0, end=j;
  for (; end<html.length; end++){ if(html[end]==='{')depth++; else if(html[end]==='}'){depth--; if(!depth)break;} }
  const en=html.slice(j,end+1);
  const missing=[...keys].filter(k=>!new RegExp('\\b'+k+'\\s*:').test(en));
  assert.deepEqual(missing, [], '这些文案没有英文版：'+missing.join(', '));
});

// ——— 4. 用到的 CSS 变量都要有定义 ———
// 2026-09-11：var(--fg) 从来没定义过，于是「看纪要」是白底白字，看不见。
test('every CSS variable used is defined', ()=>{
  // 变量可能定义在页面自己引的样式表里（briefs.css 用的 --red 就定义在 work-style.css），
  // 所以按「这一页实际加载了哪些样式表」来算，别只看某一个文件。
  for (const page of ['web/index.html','web/memory.html','web/archive.html','web/work.html','web/briefs.html']){
    const s=read(page);
    let css=s;
    for (const m of s.matchAll(/<link[^>]+href="([^"?]+)/g)){
      const f=m[1]; if (/^https?:/.test(f)) continue;
      try { css += read('web/'+f.replace(/^\.\//,'')); } catch(e){}
    }
    const defined=new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m=>m[1]));
    const used=new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map(m=>m[1]));
    const missing=[...used].filter(v=>!defined.has(v));
    assert.deepEqual(missing, [], page+' 用了没定义的变量：'+missing.join(', '));
  }
});

// ——— 5. 定义了却没人调用的函数 ———
// 2026-09-12：scheduleGrouping 在桌面版里定义得好好的，却没有任何地方调用它，
// 于是「会中要点自动分组」这个功能从上线那天起就没跑过一次——手机上那套有调用，所以只有 Mac 没有。
// 语法、单测、冒烟一个都发现不了：代码是对的，只是没人按下开关。
test('no function is defined and then never called', ()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  const defined=[...scripts.matchAll(/^\s{0,4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>m[1]);
  // 明确知道的历史遗留：新旧两套界面里都没人调用，是被后来的做法取代的旧代码。
  // 留在这儿是为了不悄悄删掉能力（要删要接，等 Aaron 拍板），但不许再增加新的。
  const KNOWN_DEAD=new Set(['showShareNote','syncMeetingList']);
  const orphans=defined.filter(n=>{
    if (KNOWN_DEAD.has(n)) return false;
    // 定义那一处不算；出现在别处（调用、传引用、挂事件）就算有人用
    const uses=(scripts.match(new RegExp('\\b'+n.replace(/\$/g,'\\$')+'\\b','g'))||[]).length;
    return uses <= 1;
  });
  assert.deepEqual(orphans, [], '这些函数定义了但没人调用：'+orphans.join(', '));
});

// ——— 6. 转写去重：只挡转写重发，不删真话 ———
// 2026-09-12 在一场真实会议里数过：20 秒内的 195 条重复中，188 条是「嗯」「对」「hmm」
// 这类短应答——那是人真的连说了几次，删掉就是篡改记录。只有 7 条长到不可能是巧合。
const cut=(a,b)=>{const i=html.indexOf(a); const j=html.indexOf(b,i); assert.ok(i>0&&j>i,'切片标记失配: '+a); return html.slice(i,j);};
test('transcript dedupe drops resends but keeps short interjections', ()=>{
  const c={Date, seenFinals:[]};
  vm.createContext(c);
  vm.runInContext(cut('  const DUP_MIN =','  function asrOpen('), c);
  assert.equal(c.isDup('嗯。'), false, '短应答必须放行');
  assert.equal(c.isDup('嗯。'), false, '连说两次也要放行');
  assert.equal(c.isDup('hmm'), false);
  const longOne='我们下周三之前给出一版完整方案';
  assert.equal(c.isDup(longOne), false, '第一次出现要收下');
  assert.equal(c.isDup(longOne), true, '20 秒内重发要丢掉');
});
test('stutter detection catches repeats with and without separators', ()=>{
  const c={}; vm.createContext(c);
  vm.runInContext(cut('  function repeatedASR(','  const spkChip'), c);
  assert.equal(c.repeatedASR('好的。'.repeat(30)), true, '带分隔符的要认出来');
  assert.equal(c.repeatedASR('uh'.repeat(45)), true, '不带分隔符的也要认出来');
  assert.equal(c.repeatedASR('Yeah'.repeat(20)), true);
  assert.equal(c.repeatedASR('这是一句正常的话，没有任何重复，长度也够了，应该原样显示出来不被折叠起来。'), false, '正常长句不能被当成重复');
});
