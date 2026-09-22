
(() => {
  const $ = s => document.querySelector(s);
  const el = {clock:$('#clock'),status:$('#status'),start:$('#start'),stop:$('#stop'),lang:$('#lang'),tongue:$('#tongue'),notice:$('#notice'),src:$('#src'),
    tr:$('#tr'),hl:$('#hl'),ck:$('#ck'),sum:$('#sum'),hist:$('#hist'),ctr:$('#c-tr'),chl:$('#c-hl'),cck:$('#c-ck'),main:$('#main'),jump:$('#jump')};
  const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmt = sec => String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
  const hms = ts => new Date(ts).toTimeString().slice(0,8);
  // warn 传 true 是黄条；传 'danger' 多一条红边，留给「已经丢了东西」这种必须看见的事，别滥用。
  const note = (msg, warn) => { el.notice.hidden = !msg; el.notice.textContent = msg||''; el.notice.className = 'notice'+(warn?' warn':'')+(warn==='danger'?' danger':''); };
  const noteAction = (msg, label, fn) => {
    el.notice.hidden = false; el.notice.className = 'notice warn'; el.notice.textContent = '';
    const t = document.createElement('span'); t.textContent = msg + '  ';
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = label;
    b.onclick = () => { note(''); fn(); };
    el.notice.appendChild(t); el.notice.appendChild(b);
  };
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(30); } catch(e){} };
