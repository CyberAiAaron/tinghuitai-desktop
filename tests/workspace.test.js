const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {create}=require('../app/workspace');
test('workspace data is opt-in, local-only and model replies report actual provider',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-test-'));let active=false,calls=0;
 const route=create({dataDir:dir,config:()=>({}),isLocal:r=>r.local,active:()=>active,ask:async(c,s,p,n,t,meta)=>{calls++;meta.provider='Test model';return 'ok';}});
 async function call(url,local=true,body){let status,data;const req={local,method:body?'POST':'GET',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(body);}};await route(req,{writeHead:s=>status=s,end:s=>data=JSON.parse(s)},new URL(url,'http://localhost'));return{status,data};}
 try{assert.equal((await call('/workspace/status')).data.briefs,false);fs.writeFileSync(path.join(dir,'briefs.json'),'{"topics":[]}');assert.equal((await call('/workspace/status')).data.briefs,true);assert.equal((await call('/tinghuitai/briefs.json',false)).status,403);assert.deepEqual((await call('/tinghuitai/briefs.json')).data,{topics:[]});assert.equal((await call('/workspace/ask',true,{prompt:'test'})).data.provider,'Test model');active=true;assert.equal((await call('/workspace/ask',true,{prompt:'test'})).status,409);assert.equal(calls,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
