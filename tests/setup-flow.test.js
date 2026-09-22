const {test}=require('node:test'),assert=require('node:assert/strict');
const routes=require('../app/setup-routes');
function harness(initial={}){
 let stored={RELAY_TOKEN:'test-token',ASR_PROVIDER:'deepgram',DEEPGRAM_API_KEY:'test-dg',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',...initial};
 const defaults={ASR_PROVIDER:'',DEEPGRAM_API_KEY:'',VOLC_APP_KEY:'',VOLC_ACCESS_KEY:'',DEEPSEEK_API_KEY:'',LLM_PROVIDER:'',LLM_BASE_URL:'',LLM_MODEL:''};
 return {get stored(){return stored;},async call(url,body,active=false,opts={}){let status,data;const req={method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-tht-token':opts.token===undefined?'test-token':opts.token},async *[Symbol.asyncIterator](){yield JSON.stringify(body)}};const res={writeHead:s=>status=s,end:s=>data=JSON.parse(s)};
 await routes(req,res,new URL(url,'http://localhost'),{isLocal:opts.isLocal!==false,tokenOk:t=>t==='test-token',settings:{load:()=>({...stored}),save:s=>stored=s,defaults},active:()=>active,testModel:()=>{throw Error('unexpected model call')}});return{status,data};}};
}
test('blank saved Deepgram field preserves key on later saves',async()=>{const h=harness();assert.equal((await h.call('/setup',{ASR_PROVIDER:'deepgram',DEEPGRAM_API_KEY:''})).status,200);assert.equal(h.stored.DEEPGRAM_API_KEY,'test-dg');});
test('speech provider credentials are reported independently without leaking keys',async()=>{const h=harness();const r=await h.call('/setup');assert.equal(r.data.volcConfigured,false);assert.equal(r.data.deepgramConfigured,true);assert.equal(r.data.modelConfigured,false);assert.ok(!JSON.stringify(r.data).includes('test-dg'));});
test('active meeting prevents CLI provider changes',async()=>{const h=harness();assert.equal((await h.call('/setup/detect',{kind:'claude'},true)).status,409);assert.equal(h.stored.LLM_PROVIDER,undefined);});
test('MyAgent can switch back to DeepSeek without exposing a new product identity',async()=>{const h=harness({LLM_PROVIDER:'codex',DEEPSEEK_API_KEY:'test-key'});const r=await h.call('/setup/agent',{kind:'deepseek'});assert.equal(r.status,200);assert.equal(r.data.agentLabel,'MyAgent');assert.equal(h.stored.LLM_PROVIDER,'deepseek');});
test('MyAgent refuses provider changes during a meeting',async()=>{const h=harness({LLM_PROVIDER:'codex',DEEPSEEK_API_KEY:'test-key'});assert.equal((await h.call('/setup/agent',{kind:'deepseek'},true)).status,409);assert.equal(h.stored.LLM_PROVIDER,'codex');});
test('MyAgent switch is refused for non-local requests',async()=>{const h=harness({LLM_PROVIDER:'codex',DEEPSEEK_API_KEY:'test-key'});assert.equal((await h.call('/setup/agent',{kind:'deepseek'},false,{isLocal:false})).status,403);assert.equal(h.stored.LLM_PROVIDER,'codex');});
test('MyAgent switch is refused without the relay token',async()=>{const h=harness({LLM_PROVIDER:'codex',DEEPSEEK_API_KEY:'test-key'});assert.equal((await h.call('/setup/agent',{kind:'deepseek'},false,{token:'wrong'})).status,403);assert.equal(h.stored.LLM_PROVIDER,'codex');});
test('MyAgent keeps the current backend when DeepSeek has no key or the CLI probe fails',async()=>{const h=harness({LLM_PROVIDER:'codex',DEEPSEEK_API_KEY:''});assert.equal((await h.call('/setup/agent',{kind:'deepseek'})).status,409);assert.equal(h.stored.LLM_PROVIDER,'codex');
 const cli=require('../app/cli-llm'),orig=cli.probe;cli.probe=async()=>({ok:false,reason:'not_installed'});try{const r=await h.call('/setup/agent',{kind:'claude'});assert.equal(r.status,409);assert.equal(h.stored.LLM_PROVIDER,'codex');}finally{cli.probe=orig;}
 assert.equal((await h.call('/setup/agent',{kind:'gemini'})).status,400);assert.equal(h.stored.LLM_PROVIDER,'codex');});

// 09-22 手机复现：远端页面拿不到 boot，「开始听会」被卡。带口令的远端只读 GET /setup 放行且不含密钥；写操作仍 403。
test('remote GET /setup with phone token returns readiness without secrets',async()=>{const h=harness();const r=await h.call('/setup',undefined,false,{isLocal:false});assert.equal(r.status,200);assert.equal(r.data.asrConfigured,true);assert.equal(r.data.macAsrAvailable!==undefined,true);assert.equal(JSON.stringify(r.data).includes('test-'),false);});
test('remote GET /setup without a valid token is refused',async()=>{const h=harness();assert.equal((await h.call('/setup',undefined,false,{isLocal:false,token:'wrong'})).status,403);});
test('remote POST /setup is still refused even with the token',async()=>{const h=harness();assert.equal((await h.call('/setup',{ASR_PROVIDER:'mac'},false,{isLocal:false})).status,403);assert.equal(h.stored.ASR_PROVIDER,'deepgram');});
