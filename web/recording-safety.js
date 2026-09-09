/* Independent local audio recovery. No credentials, uploads or automatic deletions. */
(function(root){
 'use strict';
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const complete=t=>new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error||Error('Storage transaction failed'));});
 let dbPromise;
 function database(){return dbPromise||(dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('tinghuitai-audio-safety',1);r.onupgradeneeded=()=>{r.result.createObjectStore('recordings',{keyPath:'id'});r.result.createObjectStore('chunks',{keyPath:['id','seq']});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('录音存储被其他页面阻塞，请关闭旧的听会台页面后重试。'));}));}
 async function put(store,value){const d=await database(),t=d.transaction(store,'readwrite'),done=complete(t);t.objectStore(store).put(value);await done;}
 async function list(){const d=await database();return request(d.transaction('recordings').objectStore('recordings').getAll());}
 async function blob(id){const d=await database();const meta=await request(d.transaction('recordings').objectStore('recordings').get(id));if(!meta)throw Error('Recording not found');const rows=await request(d.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER])));return new Blob(rows.map(x=>x.blob),{type:meta.mime});}
 async function remove(id){const d=await database(),t=d.transaction(['recordings','chunks'],'readwrite'),done=complete(t);t.objectStore('recordings').delete(id);t.objectStore('chunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));await done;}
 async function start(stream,sessionId,onStatus=()=>{}){
  if(!root.MediaRecorder)throw Error('浏览器不支持安全录音，请使用最新版 Chrome 或 Safari。');
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
  const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
  const meta={id:sessionId+'-'+Date.now(),sessionId,started:Date.now(),mime:recorder.mimeType,bytes:0,chunks:0,state:'recording'};
  await put('recordings',meta);let queue=Promise.resolve(),seq=0,failed=false;
  recorder.ondataavailable=e=>{if(!e.data.size)return;const n=seq++;queue=queue.then(async()=>{await put('chunks',{id:meta.id,seq:n,blob:e.data});meta.bytes+=e.data.size;meta.chunks++;await put('recordings',meta);if(!failed)onStatus('saved',meta);}).catch(err=>{failed=true;onStatus('error',err);});};
  recorder.onerror=e=>{failed=true;onStatus('error',e.error||Error('Recording failed'));};
  let resolveStopped;const stopped=new Promise(r=>resolveStopped=r);
  recorder.onstop=()=>{queue.then(async()=>{meta.state=failed?'error':'stopped';meta.ended=Date.now();await put('recordings',meta);resolveStopped(meta);}).catch(e=>{onStatus('error',e);resolveStopped({...meta,state:'error'});});};
  recorder.start(1000);
  return {id:meta.id,stop(){if(recorder.state!=='inactive')recorder.stop();return stopped;}};
 }
 root.RecordingSafety={start,list,blob,remove};
})(window);
