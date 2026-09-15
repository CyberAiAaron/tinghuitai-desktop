const {test}=require('node:test'),assert=require('node:assert/strict');
const routes=require('../app/setup-routes');
function harness(initial={}){
 let stored={RELAY_TOKEN:'test-token',ASR_PROVIDER:'deepgram',DEEPGRAM_API_KEY:'test-dg',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',...initial};
 const defaults={ASR_PROVIDER:'',DEEPGRAM_API_KEY:'',VOLC_APP_KEY:'',VOLC_ACCESS_KEY:'',DEEPSEEK_API_KEY:'',LLM_BASE_URL:'',LLM_MODEL:''};
 return {get stored(){return stored;},async call(url,body,active=false){let status,data;const req={method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-tht-token':'test-token'},async *[Symbol.asyncIterator](){yield JSON.stringify(body)}};const res={writeHead:s=>status=s,end:s=>data=JSON.parse(s)};
 await routes(req,res,new URL(url,'http://localhost'),{isLocal:true,settings:{load:()=>({...stored}),save:s=>stored=s,defaults},active:()=>active,testModel:()=>{throw Error('unexpected model call')}});return{status,data};}};
}
test('blank saved Deepgram field preserves key on later saves',async()=>{const h=harness();assert.equal((await h.call('/setup',{ASR_PROVIDER:'deepgram',DEEPGRAM_API_KEY:''})).status,200);assert.equal(h.stored.DEEPGRAM_API_KEY,'test-dg');});
test('speech provider credentials are reported independently without leaking keys',async()=>{const h=harness();const r=await h.call('/setup');assert.equal(r.data.volcConfigured,false);assert.equal(r.data.deepgramConfigured,true);assert.equal(r.data.modelConfigured,false);assert.ok(!JSON.stringify(r.data).includes('test-dg'));});
test('active meeting prevents CLI provider changes',async()=>{const h=harness();assert.equal((await h.call('/setup/detect',{kind:'claude'},true)).status,409);assert.equal(h.stored.LLM_PROVIDER,undefined);});
