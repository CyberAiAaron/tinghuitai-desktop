'use strict';
// 模型适配层：换提供方只改配置；同一份调用在「命令行」和「OpenAI 兼容接口」两类适配器上都跑得通；降级不静默。
const test=require('node:test'),assert=require('node:assert/strict');
const llm=require('../app/llm');
const okFetch=(seen)=>async(url,opt)=>{seen.push({url,body:JSON.parse(opt.body),auth:opt.headers.Authorization});return{json:async()=>({model:'served-model',choices:[{message:{content:'{"highlights":[]}'}}],usage:{prompt_tokens:5,completion_tokens:2}})};};
const badFetch=async()=>({json:async()=>({error:{type:'invalid_request_error',message:'no balance'}})});

test('老设置推出的降级链和以前一致：先命令行，再 OpenAI 兼容接口；显示名、档位模型都对',()=>{
 const chain=llm.chainOf({LLM_PROVIDER:'claude',DEEPSEEK_API_KEY:'k',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',LLM_MODEL_QUICK:''});
 assert.deepEqual(chain.map(p=>[p.type,p.label]),[['cli','Claude'],['openai','DeepSeek']]);
 assert.equal(llm.pickModel(chain[0],'live'),'sonnet');assert.equal(llm.pickModel(chain[0],'triage'),'sonnet');assert.equal(llm.pickModel(chain[0],'post'),'opus');
 assert.equal(llm.pickModel(chain[1],'live'),'deepseek-chat');
 assert.deepEqual(llm.chainOf({LLM_PROVIDER:'',DEEPSEEK_API_KEY:''}),[]);
});
test('换一家 OpenAI 兼容提供方只改配置：地址、密钥字段、档位模型都从 LLM_CHAIN 来，业务调用不变',async()=>{
 const seen=[],env={QWEN_API_KEY:'qk',LLM_CHAIN:[{type:'openai',name:'通义',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1/',keyFrom:'QWEN_API_KEY',models:{live:'qwen-turbo',post:'qwen-max'}}]};
 const r=await llm.ask(env,{kind:'triage',system:'s',user:'u',maxTokens:100,fetchImpl:okFetch(seen)});
 assert.equal(r.text,'{"highlights":[]}');assert.equal(r.provider,'通义');assert.equal(r.degraded,false);assert.deepEqual(r.usage,{in:5,out:2});
 assert.equal(seen[0].url,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(seen[0].body.model,'qwen-turbo');assert.equal(seen[0].auth,'Bearer qk');
 const post=await llm.ask(env,{kind:'post',system:'s',user:'u',fetchImpl:okFetch(seen)});assert.equal(seen[1].body.model,'qwen-max');assert.equal(post.model,'served-model');
});
test('前一家失败、后一家成功 → degraded 且带第一家的原因码；全失败 → 没有正文、原因码是最后一家的；没配 → no_provider；缺密钥的条目被跳过',async()=>{
 const env={A:'a',B:'b',LLM_CHAIN:[{type:'openai',name:'甲',baseUrl:'https://a.example/v1',keyFrom:'A'},{type:'openai',name:'缺钥匙',baseUrl:'https://x.example/v1',keyFrom:'NOPE'},{type:'openai',name:'乙',baseUrl:'https://b.example/v1',keyFrom:'B'}]};
 assert.deepEqual(llm.chainOf(env).map(p=>p.label),['甲','乙']);
 const seen=[],mixed=async(url,opt)=>url.startsWith('https://a.')?badFetch():okFetch(seen)(url,opt);
 const r=await llm.ask(env,{kind:'live',system:'s',user:'u',fetchImpl:mixed});
 assert.equal(r.provider,'乙');assert.equal(r.degraded,true);assert.equal(r.degradedReason,'api:invalid_request_error');assert.deepEqual(r.attempts,[{provider:'甲',errorCode:'api:invalid_request_error'}]);
 const dead=await llm.ask(env,{kind:'live',system:'s',user:'u',fetchImpl:badFetch});
 assert.equal(dead.text,null);assert.equal(dead.errorCode,'api:invalid_request_error');assert.equal(dead.attempts.length,2);assert.equal(dead.degraded,false);
 assert.equal((await llm.ask({},{system:'s',user:'u'})).errorCode,'no_provider');
});
test('业务代码里没有品牌分支：server.js 不再直接认 deepseek / claude 的地址和模型名',()=>{
 const src=require('fs').readFileSync(require('path').join(__dirname,'../app/server.js'),'utf8');
 assert.doesNotMatch(src,/chat\/completions/);assert.doesNotMatch(src,/\/deepseek\/i/);assert.doesNotMatch(src,/cliLlm\.askDetailed/);
});
