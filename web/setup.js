'use strict';
const message=document.getElementById('message'),form=document.getElementById('setup-form');
let state=null;
async function refresh(){const r=await fetch('/setup',{cache:'no-store'});if(!r.ok)throw Error('本机设置读取失败，请重新启动听会台。');state=await r.json();form.elements.LLM_BASE_URL.value=state.base;form.elements.LLM_MODEL.value=state.model;form.elements.VOLC_RESOURCE_ID.value=state.resource;for(const [key,ready] of [['VOLC_APP_KEY',state.asrConfigured],['VOLC_ACCESS_KEY',state.asrConfigured],['DEEPSEEK_API_KEY',state.modelConfigured]])form.elements[key].placeholder=ready?'已保存；需要更换时再填写':'粘贴控制台提供的值';}
refresh().then(()=>{if(state.base!=='https://api.deepseek.com')form.querySelector('details').open=true;message.textContent=state.ready?'两项配置已保存。修改后可重新测试。':'填好两项服务，保存后先试录 30 秒。';}).catch(e=>message.textContent=e.message);
async function send(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Tht-Token':window.THT_BOOT?.relayToken||''},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||j.message||'操作未完成');return j;}
function validate(){if(!state)throw Error('设置尚未加载，请稍后再试或重新打开页面。');for(const [key,ready,label] of [['VOLC_APP_KEY',state.asrConfigured,'火山 App Key / APP ID'],['VOLC_ACCESS_KEY',state.asrConfigured,'火山 Access Key / Access Token'],['DEEPSEEK_API_KEY',state.modelConfigured,'模型 API Key']]){if(!ready&&!form.elements[key].value.trim()){form.elements[key].focus();throw Error('请填写'+label+'。');}}}
async function save(){validate();await send('/setup',Object.fromEntries(new FormData(form)));for(const el of form.querySelectorAll('[type=password]'))el.value='';await refresh();}
async function run(test){const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{message.textContent='正在保存…';await save();if(test){message.textContent='正在测试模型连接…';message.textContent=(await send('/setup/test',{})).message;}else message.textContent='已保存在这台 Mac。下一步：测试模型，再进入听会台试录 30 秒。';}catch(e){message.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}}
form.onsubmit=e=>{e.preventDefault();run(false);};
document.getElementById('test').onclick=()=>run(true);
