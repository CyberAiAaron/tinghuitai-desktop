'use strict';
// 首次设置：一屏两步 + 一条「让 AI 带你做」。文案两套，跟随系统语言，右上角可切。
const T={zh:{
 h1:'开始使用 Meeting LiveMate', sub:'都填在这个页面，不用改配置文件。会议和记忆都存在这台电脑；内容会不会出本机，取决于你下面选的转写和模型服务。',
 s1:'语音转写', s1go:'去火山控制台拿 ↗', l_app:'App Key / APP ID', l_access:'Access Key / Access Token',
 asr_volc:'火山语音（推荐）', asr_volc_d:'流式字幕与说话人编号。需语音服务凭证；试用额度、有效期与费用以控制台为准。',
 asr_dg:'Deepgram（国外，邮箱注册）', asr_dg_d:'使用自己的 Deepgram API Key。注册要求、试用额度和费用以控制台为准。',
 dg_hint:'去 console.deepgram.com 用邮箱注册，在 API Keys 页建一个 Key，粘到下面。按控制台要求完成注册。',
 l_dg:'Deepgram API Key',
 asr_mac:'本机转写（不用注册）', asr_mac_d:'用这台 Mac 自带的语音识别，无需语音 API Key，不区分说话人。离线能力取决于系统与已安装的语言资源。',
 s1hint:'需要一个火山引擎账号（手机号就能注册），开通「大模型流式语音识别」这项服务，火山官方给 20 小时免费额度。开通后在应用详情里复制两串东西，填到下面。',
 s1more:'怎么拿？',
 v1:'打开火山语音控制台，开通「大模型流式语音识别」。', v2:'进应用详情，复制 App Key 和 Access Key 两项。',
 v3:'填到上面两个框里。', v_note:'填的是语音应用的凭证，不是方舟模型 Key，也不是云账号 AK/SK。火山官方列了 20 小时免费试用额度，能不能领、有效期以你的控制台为准。',
 s2:'实时翻译与 AI 分析（可选）', detecting:'检测中…', notfound:'没找到', found:'找到 ', ready:'已就绪',
 s2more:'接入自己的模型 API',
 d1:'打开 DeepSeek 注册页（platform.deepseek.com），手机号注册。', d2:'查看服务商的价格和余额，按需充值。',
 d3:'在 API Keys 页点「创建」，把 sk- 开头那串复制下来，粘到下面。',
 l_key:'模型 API Key', adv:'公司给了我接口 / 用别的模型', l_base:'接口地址', l_model:'模型名称', l_res:'火山 Resource ID',
 s3:'不想自己弄？让 AI 带你做', s3d:'点下面复制一段话，发给你自己的 ChatGPT、Claude、豆包、DeepSeek 都行。它会一步一步问你、带你把上面两步做完。',
 s3btn:'复制引导词', copied:'已复制。粘到你的 AI 对话框里发出去。', copyfail:'复制不了，请手动全选下面这段。',
 save:'保存并进入', savetest:'测试 AI 连接', enter:'进入听会台',
 ph_new:'粘贴控制台给的那串', ph_saved:'已保存；要换才填',
 foot:'先试录 30 秒：确认自己和对方都有字幕，再结束并看会议档案。「保存并测试」会发一个短请求，可能产生少量费用。',
 nocli:'可以接入自己的模型 API，也可以先跳过。仅转写不需要模型；实时翻译、要点、核查和纪要需要模型。',
 trycli:'点一下试试，通了就不用管模型这件事。', trying:'正在试一次，大概十几秒…',
 saving:'正在保存…', testing:'正在测试模型…', saved:'已保存在这台电脑。下一步：进入听会台，试录 30 秒。',
 readfail:'读不到本机设置，请重新启动听会台。', notloaded:'设置还没加载好，刷新一下页面。',
 need:'请填写', ok_all:'设置已保存。进入后先试录 30 秒。', todo_all:'选择转写方式，保存并进入。AI 可以稍后配置。', no_model:'转写设置已保存。尚未接入 AI，可直接保存并进入试录。', mac_unavailable:'这台电脑暂不支持本机转写，请选择云端转写。'
},en:{
 h1:'Set up Meeting LiveMate', sub:'Fill them in here, no config files. Meetings and memory stay on this computer; whether anything leaves it depends on the transcription and model services you pick below.',
 s1:'Transcription', s1go:'Get keys at Volcano ↗', l_app:'App Key / APP ID', l_access:'Access Key / Access Token',
 asr_volc:'Volcano speech', asr_volc_d:'Streaming captions and speaker labels. Requires speech credentials; check trial eligibility and pricing in the console.',
 asr_dg:'Deepgram (sign up with email)', asr_dg_d:'Use your own Deepgram API key. Check signup requirements, trial credit and pricing in its console.',
 dg_hint:'Sign up at console.deepgram.com, create a key on the API Keys page, paste it below. Follow the console signup requirements.',
 l_dg:'Deepgram API key',
 asr_mac:'On this Mac (recommended, no signup)', asr_mac_d:'Uses the speech recognition built into macOS. No speech API key, no speaker separation. Offline support depends on macOS and installed language resources.',
 s1hint:'You need a Volcano Engine account, then enable its streaming speech recognition service. Volcano lists a 20-hour free trial. Once enabled, copy two values from your app details into the boxes below.',
 s1more:'How do I get these?',
 v1:'Open the Volcano speech console and enable streaming speech recognition.', v2:'Open the app details and copy App Key and Access Key.',
 v3:'Paste them into the two boxes above.', v_note:'These are the speech app credentials, not an Ark model key and not a cloud account AK/SK. Volcano lists a 20-hour free trial; whether you can claim it depends on your console.',
 s2:'Live translation & AI analysis (optional)', detecting:'checking…', notfound:'none found', found:'found ', ready:'ready',
 s2more:'Connect your model API',
 d1:'Sign up at platform.deepseek.com.', d2:'Check pricing and your balance; add credit if needed.',
 d3:'On the API Keys page click Create, copy the sk- string, paste it below.',
 l_key:'Model API key', adv:'My company gave me an endpoint / use another model', l_base:'Base URL', l_model:'Model name', l_res:'Volcano Resource ID',
 s3:'Rather not do this yourself? Let an AI walk you through it',
 s3d:'Copy the text below and send it to your own ChatGPT, Claude or any other assistant. It will ask you one question at a time and walk you through both steps.',
 s3btn:'Copy the walkthrough', copied:'Copied. Paste it into your AI and send.', copyfail:'Copy failed, please select the text manually.',
 save:'Save and continue', savetest:'Test AI connection', enter:'Open Meeting LiveMate',
 ph_new:'paste the value from the console', ph_saved:'saved; fill only to replace',
 foot:'Record 30 seconds first: check that both you and the other side get captions, then stop and open the meeting archive. "Test AI connection" sends one short request and may cost a little.',
 nocli:'Connect your model API, or skip for now. Transcription works without a model; live translation, key points, checks and summaries need one.',
 trycli:'Click one to try it. If it works you never think about models again.', trying:'trying it, about fifteen seconds…',
 saving:'saving…', testing:'testing the model…', saved:'Saved on this computer. Next: open Meeting LiveMate and record 30 seconds.',
 readfail:'Cannot read local settings. Restart Meeting LiveMate.', notloaded:'Settings not loaded yet, refresh the page.',
 need:'Please fill in ', ok_all:'Settings saved. Record 30 seconds to check your audio.', todo_all:'Choose transcription, then save and continue. You can connect AI later.', no_model:'Transcription settings saved. No AI connected yet; save and continue to try recording.', mac_unavailable:'Local transcription is unavailable on this computer. Choose a cloud provider.'
}};
let L=(navigator.language||'zh').toLowerCase().startsWith('zh')?'zh':'en';
const t=k=>T[L][k]||k;
const message=document.getElementById('message'),form=document.getElementById('setup-form');
let state=null;

function applyLang(){
  document.documentElement.lang=L==='zh'?'zh-CN':'en';
  for(const el of document.querySelectorAll('[data-t]')) el.textContent=t(el.dataset.t);
  for(const b of document.querySelectorAll('#lang button')) b.setAttribute('aria-selected',String(b.dataset.l===L));
  paintPlaceholders(); paintStatus(); paintCli();
}
function paintPlaceholders(){
  if(!state) return;
  for(const [key,ready] of [['VOLC_APP_KEY',state.volcConfigured],['VOLC_ACCESS_KEY',state.volcConfigured],['DEEPSEEK_API_KEY',state.modelConfigured],['DEEPGRAM_API_KEY',state.deepgramConfigured]])
    form.elements[key].placeholder=ready?t('ph_saved'):t('ph_new');
}
function paintStatus(){ if(state&&!message.dataset.sticky) message.textContent=state.ready?t('ok_all'):t('todo_all'); }
function paintAsr(){
  const v=document.querySelector('input[name=asr]:checked')?.value||'volc';
  document.getElementById('volc-fields').hidden=(v!=='volc');
  document.getElementById('volc-link').hidden=(v!=='volc');
  document.getElementById('volc-how').hidden=(v!=='volc');
  const dg=document.getElementById('dg-fields'); if(dg) dg.hidden=(v!=='deepgram');
}
document.getElementById('asr-pick').onchange=paintAsr;
document.getElementById('lang').onclick=e=>{const b=e.target.closest('button');if(b){L=b.dataset.l;applyLang();}};

async function refresh(){
  const r=await fetch('/setup',{cache:'no-store'}); if(!r.ok) throw Error(t('readfail'));
  state=await r.json();
  form.elements.LLM_BASE_URL.value=state.base; form.elements.LLM_MODEL.value=state.model; form.elements.VOLC_RESOURCE_ID.value=state.resource;
  // 还没选过的话：中文系统默认火山（中文最准），非中文系统默认本机转写（火山要中国账号，对老外是死路）
  // 这台机器能本机转写就默认选它：一把钥匙都不用填，保存就能开会。
  // 以前中文界面默认选火山，没有火山账号的人打开这页就被「请填写 App Key」挡住（2026-09-14）。
  const fallbackAsr = state.macAsrAvailable ? 'mac' : (L === 'zh' ? 'volc' : 'deepgram');
  const pickAsr = ['mac','deepgram','volc'].includes(state.asrProvider) ? state.asrProvider : fallbackAsr;
  document.querySelector('input[name=asr][value=mac]').disabled=!state.macAsrAvailable;
  const r2=document.querySelector('input[name=asr][value="'+pickAsr+'"]'); if(r2) r2.checked=true;
  paintAsr();
  paintPlaceholders();
}
async function send(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Tht-Token':window.THT_BOOT?.relayToken||''},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||j.message||'failed');return j;}
function validate(){
  if(!state) throw Error(t('notloaded'));
  const pick=document.querySelector('input[name=asr]:checked')?.value||'volc';
  const localAsr=(pick!=='volc');
  if(pick==='mac'&&!state.macAsrAvailable)throw Error(t('mac_unavailable'));
  // 模型 key 只管会后写纪要，会中转写用不到它。以前把它列为必填，没有 key 的人连转写方式都保存不了，
  // 于是「开始听会」永远把人弹回这一页（2026-09-14 Aaron 老婆那台机器就是这样卡死的）。
  for(const [key,ready,label] of [['VOLC_APP_KEY',state.volcConfigured||localAsr,'App Key / APP ID'],['VOLC_ACCESS_KEY',state.volcConfigured||localAsr,'Access Key / Access Token'],['DEEPGRAM_API_KEY',pick!=='deepgram'||state.deepgramConfigured,t('l_dg')]])
    if(!ready&&!form.elements[key].value.trim()){form.elements[key].focus();throw Error(t('need')+label);}
}
async function save(){validate();const body=Object.fromEntries(new FormData(form));body.ASR_PROVIDER=document.querySelector('input[name=asr]:checked')?.value||'volc';delete body.asr;await send('/setup',body);for(const el of form.querySelectorAll('[type=password]'))el.value='';await refresh();}
async function run(test){
  const buttons=[...form.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true); message.dataset.sticky='1';
  try{ message.textContent=t('saving'); await save();
    if(test&&!state.modelConfigured){message.textContent=t('no_model');}
    else if(test){ message.textContent=t('testing'); message.textContent=(await send('/setup/test',{})).message; }
    else { message.textContent=t('saved'); window.location.assign('index.html'); }
  }catch(e){ message.textContent=e.message; }
  finally{ buttons.forEach(b=>b.disabled=false); }
}
form.onsubmit=e=>{e.preventDefault();run(false);};
document.getElementById('test').onclick=()=>run(true);

// ===== ② 本机有没有现成的 AI =====
const NAME={codex:'Codex (ChatGPT)',claude:'Claude Code'};
let cli={found:[],provider:'',msg:'',msgKind:null,err:false};
function paintCli(){
  const tag=document.getElementById('cli-tag'),acts=document.getElementById('cli-actions'),msg=document.getElementById('cli-msg'),key=document.getElementById('key-block');
  if(!tag) return;
  if(cli.err){ tag.textContent=t('notfound'); msg.textContent=t('readfail'); return; }
  if(!cli.found.length){ tag.textContent=t('notfound'); msg.textContent=t('nocli'); msg.className='msg';  return; }
  tag.textContent=cli.provider?t('ready'):t('found')+cli.found.length;
  tag.className='tag'+(cli.provider?' ok':'');
  acts.innerHTML='';
  for(const kind of cli.found){
    const b=document.createElement('button');
    b.type='button'; b.dataset.kind=kind; b.className=cli.provider===kind?'':'ghost';
    b.textContent=(cli.provider===kind?'✓ ':'')+NAME[kind];
    b.onclick=()=>useCli(kind);
    acts.appendChild(b);
  }
  msg.textContent=cli.msg||(cli.provider?'':t('trycli'));
  msg.className='msg'+(cli.msgKind===true?' ok':cli.msgKind===false?' bad':'');
  if(key&&cli.provider) key.open=false;
}
async function useCli(kind){
  const acts=document.getElementById('cli-actions'); const all=[...acts.querySelectorAll('button')]; all.forEach(x=>x.disabled=true);
  cli.msg=t('trying'); cli.msgKind=null; paintCli();
  try{
    const j=await send('/setup/detect',{kind});
    cli.msg=j.message||''; cli.msgKind=!!j.ok; if(j.ok) {cli.provider=kind;await refresh();}
  }catch(e){ cli.msg=String(e.message||e); cli.msgKind=false; }
  finally{ paintCli(); [...acts.querySelectorAll('button')].forEach(x=>x.disabled=false); }
}
(async function(){
  try{ const r=await fetch('/setup/detect',{cache:'no-store'}); const j=await r.json(); cli.found=j.found||[]; cli.provider=j.provider||''; }
  catch(e){ cli.err=true; }
  paintCli();
})();

// ===== ③ 让用户自己的 AI 带路 =====
function walkthrough(){
  return L==='zh'
? `我在 Mac 上设置 Meeting LiveMate。请一次一个问题带我完成，不要让我把密钥发到聊天里，密钥只填本机设置页。先确认转写方式：可用时选本机转写，不用语音 API，但不区分说话人；需要云端转写可选火山（https://console.volcengine.com/speech/app）或 Deepgram（https://console.deepgram.com/）。火山填语音应用 App Key 和 Access Key，不是云账号 AK/SK。免费额度与价格以控制台为准。AI 可稍后配置；实时翻译、要点、核查和纪要需要模型。已有且登录的 Codex/Claude Code 可在页面测试，使用现有账户的额度；也可填自己的模型 API Key、兼容接口地址和模型名。DeepSeek：https://platform.deepseek.com/api_keys。最后点保存并进入，试录30秒，检查字幕和历史会议。请先问我卡在哪一步。`
: `Help me set up Meeting LiveMate on my Mac, one question at a time. Never ask me to paste secrets into chat; keys go only in the local settings page. Use on-Mac transcription when available (no speech API key; no speaker separation), or Volcano (https://console.volcengine.com/speech/app) / Deepgram (https://console.deepgram.com/) for cloud transcription. Volcano requires speech App Key and Access Key, not cloud account AK/SK. Check current trial eligibility and pricing in the provider console. AI is optional for transcription, but required for live translation, key points, checks and summaries. Test an installed, signed-in Codex/Claude Code using my account quota, or configure my own compatible model API. DeepSeek keys: https://platform.deepseek.com/api_keys. Save and continue, record 30 seconds, and check captions and meeting history. Ask where I am stuck first.`;
}
document.getElementById('copy-prompt').onclick=async()=>{
  const out=document.getElementById('copy-msg');
  try{ await navigator.clipboard.writeText(walkthrough()); out.textContent=t('copied'); out.className='msg ok'; }
  catch(e){ out.textContent=t('copyfail'); out.className='msg bad'; const box=document.getElementById('copy-fallback');box.hidden=false;box.value=walkthrough();box.focus();box.select(); }
};

applyLang();
refresh().then(()=>{ if(state.base!=='https://api.deepseek.com'){const d=document.querySelector('#key-block details'); if(d){d.open=true;document.getElementById('key-block').open=true;}} applyLang(); })
 .catch(e=>{message.dataset.sticky='1';message.textContent=e.message;});
