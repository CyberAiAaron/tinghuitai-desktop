'use strict';
const message=document.getElementById('message'),form=document.getElementById('setup-form');
fetch('/setup',{cache:'no-store'}).then(r=>r.json()).then(j=>{form.elements.LLM_BASE_URL.value=j.base;form.elements.LLM_MODEL.value=j.model;form.elements.VOLC_RESOURCE_ID.value=j.resource;message.textContent=j.ready?'语音与模型配置已保存。':'填好上面的两项服务后，先试录一小段。';}).catch(()=>message.textContent='本机服务未连接，请重新启动听会台。');
async function send(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Tht-Token':window.THT_BOOT?.relayToken||''},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||j.message||'操作未完成');return j;}
form.onsubmit=async e=>{e.preventDefault();try{await send('/setup',Object.fromEntries(new FormData(form)));for(const el of form.querySelectorAll('[type=password]'))el.value='';message.textContent='已保存在本机。可以测试模型，然后进入听会台试录。';}catch(e){message.textContent=e.message;}};
document.getElementById('test').onclick=async e=>{e.target.disabled=true;message.textContent='正在测试已保存的模型配置…';try{message.textContent=(await send('/setup/test',{})).message;}catch(e){message.textContent=e.message;}finally{e.target.disabled=false;}};
