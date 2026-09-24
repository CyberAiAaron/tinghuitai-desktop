'use strict';
// 回看页评论层（0.6.19）：页面上任何一块内容 hover 出 💬，点开写一句自然语言，交给 Claude 去做。
// 独立脚本，不碰 archive.js 的变量；口令从 tht-settings 里取（和 archive.js 的 actTok 同一处）。
// 服务端：POST /asr-relay/page-comment 落库 + 写信唤醒本机 Claude；GET /asr-relay/page-comments?id= 回读；状态由 Claude 用 PATCH 回写。
(function(){
  const mid=new URLSearchParams(location.search).get('id')||'';
  if(!mid)return;
  const tok=()=>{let s={};try{s=JSON.parse(localStorage.getItem('tht-settings')||'{}');}catch{}return encodeURIComponent(s.relayToken||(window.THT_BOOT&&window.THT_BOOT.relayToken)||'');};
  // 能评论的块：卡片 / 条目 / 待办行 / 关键点 / 项目状态更新卡 / 逐字稿一句 / 标题
  const BLOCKS='.v2-row,.v2-md,.v2-card,.v2-ins,.v2-next,.v2-min li,.v2-min p,.bf-card,.bf-item,tr.bf-act,.bf-key,#bf-updates .upd,#transcript p,h2,h3';   // v2-* 是会后页 v2 的块（0.6.20）
  const LABEL={received:'已收到',working:'Claude 处理中',done:'已完成',failed:'没做成'};
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let comments=[],labels=LABEL;

  const css=document.createElement('style');
  css.textContent=[
    '.pc-hot{position:relative}',
    '.pc-btn{position:absolute;z-index:6;border:1px solid var(--line,#e5e5e8);background:var(--panel,#fff);color:var(--muted,#76767c);border-radius:999px;width:26px;height:26px;line-height:24px;text-align:center;font-size:14px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:0;display:none}',
    '.pc-btn:hover{color:var(--text,#202124);border-color:var(--text,#202124)}',
    '.pc-box{position:absolute;z-index:7;width:min(440px,calc(100vw - 32px));background:var(--panel,#fff);border:1px solid var(--line,#e5e5e8);border-radius:12px;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.12)}',
    '.pc-box .pc-q{color:var(--muted,#76767c);font-size:12px;margin:0 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pc-box textarea{width:100%;box-sizing:border-box;min-height:74px;border:1px solid var(--line,#e5e5e8);border-radius:8px;padding:8px 10px;font:inherit;font-size:13.5px;background:#fff;color:var(--text,#202124);resize:vertical}',
    '.pc-box .pc-a{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}',
    '.pc-box .pc-go{border:1px solid var(--text,#202124);background:var(--text,#202124);color:#fff;border-radius:999px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer}',
    '.pc-box .pc-go:disabled{opacity:.5;cursor:default}',
    '.pc-box .pc-x{border:1px solid var(--line,#e5e5e8);background:var(--panel-2,#f0f0f3);color:var(--text,#202124);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}',
    '.pc-box .pc-err{color:#b3261e;font-size:12px}',
    '.pc-box .pc-hint{color:var(--muted,#76767c);font-size:12px;flex:1;min-width:0}',
    '.pc-mark{display:inline-block;vertical-align:middle;margin-left:6px;font:11px var(--mono,monospace);border-radius:6px;padding:0 6px;background:var(--panel-2,#f0f0f3);color:var(--muted,#76767c);cursor:pointer;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}',
    '.pc-mark.working{background:#e8f0fe;color:#1a56b8}.pc-mark.done{background:#e6f4ea;color:#1e7e34}.pc-mark.failed{background:#fdecea;color:#b3261e}',
    '.pc-list{position:absolute;z-index:7;width:min(440px,calc(100vw - 32px));background:var(--panel,#fff);border:1px solid var(--line,#e5e5e8);border-radius:12px;padding:10px 14px;box-shadow:0 6px 24px rgba(0,0,0,.12);font-size:13px}',
    '.pc-list .pc-row{padding:6px 0;border-bottom:1px solid var(--line,#e5e5e8)}.pc-list .pc-row:last-child{border-bottom:0}',
    '.pc-list .pc-meta{color:var(--muted,#76767c);font-size:11.5px;margin-top:2px}'
  ].join('\n');
  document.head.appendChild(css);

  // ---- 锚点：怎么描述「他点的那一块」，重开页面时怎么找回来 ----
  function selectorOf(el){
    const parts=[];let n=el;
    for(let i=0;i<4&&n&&n!==document.body;i++,n=n.parentElement){
      let s=n.tagName.toLowerCase();
      if(n.id){parts.unshift(s+'#'+n.id);break;}
      const cls=[...n.classList].filter(c=>!/^pc-/.test(c)).slice(0,2);if(cls.length)s+='.'+cls.join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  }
  function datasetOf(el){
    const d={};for(const k of ['card','topic','upd','seg','sec','uid'])if(el.dataset[k]!=null)d[k]=el.dataset[k];
    const n=el.closest('[data-card],[data-topic],[data-upd],[data-seg]');
    if(n&&n!==el)for(const k of ['card','topic','upd','seg'])if(n.dataset[k]!=null&&d[k]==null)d[k]=n.dataset[k];
    return d;
  }
  function textOf(el){
    const c=el.cloneNode(true);c.querySelectorAll('.pc-mark,.pc-btn,.pc-box,textarea,button').forEach(x=>x.remove());
    return (c.innerText||c.textContent||'').replace(/\s+/g,' ').trim().slice(0,200);
  }
  const anchorOf=el=>({selector:selectorOf(el),text:textOf(el),dataset:datasetOf(el)});
  function findAnchor(a){
    if(!a)return null;
    const ds=a.dataset||{},head=(a.text||'').slice(0,60);
    const byText=list=>head?(list.find(x=>textOf(x).startsWith(head))||list.find(x=>textOf(x).includes(head.slice(0,30)))||null):null;
    // 先按 data-* 找到那张卡 / 那条更新 / 那一句，再在它里面按原文对到具体那一块（card 里的 bf-item 也要对准）
    for(const k of ['upd','seg','card','topic']){
      if(ds[k]==null)continue;
      const roots=[...document.querySelectorAll('[data-'+k+'="'+CSS.escape(ds[k])+'"]')];
      if(!roots.length)continue;
      const cands=roots.flatMap(r=>[r,...r.querySelectorAll(BLOCKS)]).filter(x=>x.matches(BLOCKS));
      return byText(cands)||cands[0]||null;
    }
    return byText([...document.querySelectorAll(BLOCKS)]);
  }

  // ---- hover 出的 💬 按钮（全页只有一个，跟着鼠标所在的块走）----
  const btn=document.createElement('button');btn.type='button';btn.className='pc-btn';btn.textContent='💬';btn.title='评论这一块，交给 Claude';
  document.body.appendChild(btn);
  let hot=null;
  function place(el){
    const r=el.getBoundingClientRect();if(!r.width)return;
    btn.style.top=(window.scrollY+r.top+2)+'px';btn.style.left=(window.scrollX+r.right-30)+'px';btn.style.display='block';
  }
  document.addEventListener('mouseover',e=>{
    if(e.target.closest('.pc-box,.pc-list,.pc-btn'))return;
    const el=e.target.closest(BLOCKS);
    if(!el||el.closest('.pc-box'))return;
    if(el.tagName==='H2'&&el.closest('.top'))return;
    hot=el;place(el);
  });
  document.addEventListener('mouseleave',()=>{if(!box)btn.style.display='none';},true);
  document.addEventListener('scroll',()=>{if(hot&&!box)place(hot);},{passive:true});

  // ---- 评论框 ----
  let box=null,boxEl=null;
  function closeBox(){if(box){box.remove();box=null;boxEl=null;}btn.style.display='none';}
  function openBox(el){
    closeBox();closeList();
    boxEl=el;
    box=document.createElement('div');box.className='pc-box';
    box.innerHTML='<div class="pc-q">💬 '+esc(textOf(el).slice(0,80)||'（这一块）')+'</div>'
      +'<textarea placeholder="想让 Claude 做什么，直接说。比如：这条派给 Abel，顺便把 ROI 像素表也发他"></textarea>'
      +'<div class="pc-a"><button type="button" class="pc-go">交给 Claude</button><button type="button" class="pc-x">取消</button><span class="pc-hint">⌘/Ctrl+Enter 发送</span></div>';
    document.body.appendChild(box);
    const r=el.getBoundingClientRect();
    box.style.top=(window.scrollY+r.bottom+6)+'px';
    box.style.left=Math.max(16,Math.min(window.scrollX+r.left,window.scrollX+window.innerWidth-box.offsetWidth-16))+'px';
    const ta=box.querySelector('textarea'),go=box.querySelector('.pc-go');
    box.querySelector('.pc-x').onclick=closeBox;
    ta.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();go.click();}if(e.key==='Escape')closeBox();};
    go.onclick=async()=>{
      const text=ta.value.trim();if(!text){ta.focus();return;}
      go.disabled=true;go.textContent='发送中…';box.querySelector('.pc-err')?.remove();
      try{
        const r=await fetch('/asr-relay/page-comment?token='+tok(),{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({meetingId:mid,anchor:anchorOf(el),comment:text,url:location.href,at:new Date().toISOString()}),signal:AbortSignal.timeout(15000)});
        const j=await r.json().catch(()=>({}));
        if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));
        comments.push(j.comment);if(j.labels)labels=j.labels;
        closeBox();paintMarks();
      }catch(e){
        go.disabled=false;go.textContent='交给 Claude';
        const err=document.createElement('span');err.className='pc-err';err.textContent='没发出去：'+(e.message||e);box.querySelector('.pc-a').appendChild(err);
      }
    };
    ta.focus();
  }
  btn.onclick=e=>{e.preventDefault();e.stopPropagation();if(hot)openBox(hot);};
  document.addEventListener('mousedown',e=>{if(box&&!box.contains(e.target)&&e.target!==btn)closeBox();if(list&&!list.contains(e.target)&&!e.target.closest('.pc-mark'))closeList();});

  // ---- 已提交的评论：锚点旁的小标记 + 点开看全部 ----
  let list=null;
  function closeList(){if(list){list.remove();list=null;}}
  function openList(el,items){
    closeList();closeBox();
    list=document.createElement('div');list.className='pc-list';
    list.innerHTML=items.map(c=>'<div class="pc-row"><div>'+esc(c.comment)+'</div><div class="pc-meta">'+esc(labels[c.state]||c.state)+(c.note?' · '+esc(c.note):'')+' · '+esc(String(c.at||'').replace('T',' ').slice(0,16))+'</div></div>').join('');
    document.body.appendChild(list);
    const r=el.getBoundingClientRect();
    list.style.top=(window.scrollY+r.bottom+6)+'px';
    list.style.left=Math.max(16,Math.min(window.scrollX+r.left,window.scrollX+window.innerWidth-list.offsetWidth-16))+'px';
  }
  function markHost(el){
    if(el.tagName==='TR'){const tds=el.querySelectorAll('td');return tds.length?tds[tds.length-1]:el;}
    if(el.classList.contains('bf-card')){const h=el.querySelector('h3');if(h)return h;}
    return el;
  }
  function paintMarks(){
    document.querySelectorAll('.pc-mark').forEach(x=>x.remove());
    const groups=new Map();
    for(const c of comments){const el=findAnchor(c.anchor);if(!el)continue;if(!groups.has(el))groups.set(el,[]);groups.get(el).push(c);}
    for(const [el,items] of groups){
      const last=items[items.length-1];
      const m=document.createElement('span');m.className='pc-mark '+esc(last.state);
      m.textContent='💬 '+(labels[last.state]||last.state)+(items.length>1?' ×'+items.length:'')+(last.note?' · '+last.note.slice(0,40):'');
      m.title=items.map(c=>c.comment).join('\n');
      m.onclick=e=>{e.preventDefault();e.stopPropagation();openList(el,items);};
      markHost(el).appendChild(m);
    }
  }
  // archive.js 的 render() 会整块重写 innerHTML，标记跟着没了——观察到变动就重画（去抖）。
  let t=null;
  new MutationObserver(muts=>{
    if(muts.every(m=>[...m.addedNodes,...m.removedNodes].every(n=>n.nodeType===1&&/^pc-/.test(n.className||''))))return;
    clearTimeout(t);t=setTimeout(paintMarks,150);
  }).observe(document.body,{childList:true,subtree:true});

  async function load(){
    try{
      const r=await fetch('/asr-relay/page-comments?id='+encodeURIComponent(mid)+'&token='+tok(),{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok)return;const j=await r.json();
      comments=Array.isArray(j.comments)?j.comments:[];if(j.labels)labels=j.labels;paintMarks();
    }catch{}
  }
  load();
  // Claude 回写状态后页面要跟上：有未完成的评论就每 20 秒读一次
  setInterval(()=>{if(comments.some(c=>c.state==='received'||c.state==='working'))load();},20000);
  window.THT_PAGE_COMMENTS={reload:load,list:()=>comments.slice()};
})();
