'use strict';
// 自动更新：去公开仓库读 version.json，比版本号；用户点了才下载。
// 只替换程序文件（app / web / *.command / package*.json），preset.json、settings 和会议数据一律不动。
const fs=require('fs'),path=require('path'),https=require('https'),crypto=require('crypto'),{execFile}=require('child_process');
const ROOT=path.join(__dirname,'..');
// 两个公开仓库互为备份；每个仓库又有 raw 与 API 两条路（raw 有 CDN 缓存延迟，API 更实时但匿名限速）
const REPOS=['CyberAiAaron/tinghuitai-desktop','GitAaronW/tinghuitai-desktop'];
const SOURCES=REPOS.flatMap(r=>[
  {kind:'raw', base:`https://raw.githubusercontent.com/${r}/main/`},
  {kind:'api', base:`https://api.github.com/repos/${r}/contents/`},
]);
const KEEP=new Set(['preset.json','node_modules','.git','version-state.json','.prev']);
// 回滚：更新前把即将被覆盖的文件整份留一份在 .prev，用户点「回到上一版」就搬回来
const PREV=path.join(ROOT,'.prev');
function snapshot(fromVersion,names){
  // 先整份建在临时目录，全部成功才替换掉旧的 .prev；中途失败时上一版的回退快照仍然完好
  const tmp=PREV+'.building-'+Date.now();
  fs.rmSync(tmp,{recursive:true,force:true}); fs.mkdirSync(tmp,{recursive:true});
  try{
    for(const name of names){ const from=path.join(ROOT,name); if(fs.existsSync(from)) fs.cpSync(from,path.join(tmp,name),{recursive:true}); }
    fs.writeFileSync(path.join(tmp,'.version'),String(fromVersion||''));
    const old=PREV+'.old-'+Date.now();
    if(fs.existsSync(PREV)) fs.renameSync(PREV,old);
    try{ fs.renameSync(tmp,PREV); }
    catch(e){ if(fs.existsSync(old)) { try{ fs.renameSync(old,PREV); }catch(e2){} } throw e; }
    fs.rmSync(old,{recursive:true,force:true});
  }catch(e){ fs.rmSync(tmp,{recursive:true,force:true}); throw e; }
}
function replaceFiles(source,names){
 const stage=fs.mkdtempSync(path.join(ROOT,'.replace-')), moved=[],installed=[];
 try{
  for(const name of names)fs.cpSync(path.join(source,name),path.join(stage,name),{recursive:true});
  const backup=path.join(stage,'.originals');fs.mkdirSync(backup);
  try{for(const name of names){const to=path.join(ROOT,name);if(fs.existsSync(to)){fs.renameSync(to,path.join(backup,name));moved.push(name);}fs.renameSync(path.join(stage,name),to);installed.push(name);}}
  catch(e){for(const name of installed.reverse())fs.rmSync(path.join(ROOT,name),{recursive:true,force:true});for(const name of moved.reverse())fs.renameSync(path.join(backup,name),path.join(ROOT,name));throw e;}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function prevVersion(){ try{ return fs.readFileSync(path.join(PREV,'.version'),'utf8').trim(); }catch(e){ return ''; } }
// P-20：0.6.13 之后的几版是直接拷文件装上去的，没走 apply()，所以 .prev 一直停在 0.6.12。
// 点「回到上一版」其实会退掉四个版本，按钮上却什么都没写。现在把备份的真实版本和新旧差距一起报出来，
// 由界面写在按钮上；同时把「装之前先存一份」单独导出成 snapshotCurrent，拷贝安装的那条路也能调。
function prevInfo(){
  const version=prevVersion(); if(!version) return {version:'',at:0,gap:0,stale:false};
  let at=0; try{ at=fs.statSync(path.join(PREV,'.version')).mtimeMs; }catch(e){}
  const cur=localVersion();
  const n=v=>{const x=String(v).split('.').map(t=>parseInt(t,10)||0);return (x[0]||0)*1e6+(x[1]||0)*1e3+(x[2]||0);};
  const gap=Math.max(0,n(cur)-n(version));
  // 差一个小版本是正常的（上一次就是从它升上来的），差更多说明中间有几版没经过 apply()
  return {version,at,gap,stale:gap>1};
}
// 供拷贝安装／部署脚本在覆盖文件之前调用：把当前这一版整份存进 .prev
function snapshotCurrent(){
  const names=fs.readdirSync(ROOT).filter(n=>!KEEP.has(n)&&!n.startsWith('.update-')&&!n.startsWith('.replace-')&&!n.startsWith('.prev'));
  snapshot(localVersion(),names); return {version:localVersion(),files:names.length};
}
async function rollbackUnlocked(log=()=>{}){
  const v=prevVersion(); if(!v) throw new Error('没有可回退的版本');
  log('正在回到 '+v);
  replaceFiles(PREV,fs.readdirSync(PREV).filter(n=>n!=='.version'));
  fs.rmSync(PREV,{recursive:true,force:true});
  log('已回到 '+v+'，请重启听会台');
  return {version:v};
}
const localVersion=()=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version||'0.0.0';}catch(e){return '0.0.0';}};
const cmp=(a,b)=>{const p=s=>String(s).split('.').map(n=>parseInt(n,10)||0);const x=p(a),y=p(b);for(let i=0;i<3;i++){if((x[i]||0)>(y[i]||0))return 1;if((x[i]||0)<(y[i]||0))return -1;}return 0;};

function get(url,{binary=false,timeout=30000,raw=false}={}){
  return new Promise((resolve,reject)=>{
    const headers={'User-Agent':'tinghuitai-updater','Cache-Control':'no-cache'};
    if(raw) headers.Accept='application/vnd.github.raw';
    const req=https.get(url,{headers},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return get(res.headers.location,{binary,timeout}).then(resolve,reject);}
      if(res.statusCode!==200){res.resume();return reject(new Error('HTTP '+res.statusCode));}
      const chunks=[];res.on('data',c=>chunks.push(c));
      res.on('end',()=>{const b=Buffer.concat(chunks);resolve(binary?b:b.toString('utf8'));});
    });
    req.setTimeout(timeout,()=>{req.destroy(new Error('超时'));});
    req.on('error',reject);
  });
}

// 查有没有新版：任一来源可达即可
async function fetchFile(src,name,binary=false){
  if(src.kind==='raw') return get(src.base+name,{binary,timeout:binary?180000:8000});
  name=name.split('?')[0];   // API 路径不接受 query 参数
  // GitHub API：要原始内容得带这个 Accept
  return get(src.base+name,{binary,timeout:binary?180000:8000,raw:true});
}
// 问遍所有来源，取版本最高的那份。两个仓库的 CDN 刷新有先后，只取第一个能连上的会装到旧版。
async function check(){
  const cur=localVersion();
  const found=[];
  await Promise.all(SOURCES.map(async src=>{
    try{
      const man=JSON.parse(String(await fetchFile(src,'version.json')));
      if(man&&man.version) found.push({src,man});
    }catch(e){}
  }));
  if(!found.length) return {ok:false,current:cur,hasUpdate:false,error:'连不上更新服务器'};
  found.sort((a,b)=>cmp(b.man.version,a.man.version));
  const {src,man}=found[0];
  return {ok:true,current:cur,latest:man.version,hasUpdate:cmp(man.version,cur)>0,notes:man.notes||'',released:man.released||'',src,manifest:man};
}

// 下载并就地替换程序文件；失败时保留原样
async function applyUnlocked(log=()=>{},canApply=()=>true){
  const info=await check();
  if(!info.ok) throw new Error(info.error||'检查更新失败');
  if(!info.hasUpdate) return {updated:false,version:info.current};
  const man=info.manifest;
  log('下载 '+man.zip);
  // 带上内容哈希做 cache-buster：CDN 若还缓存着同名旧文件，这个参数能绕过
  const buf=Buffer.from(await fetchFile(info.src,man.zip+(man.sha256?('?v='+man.sha256.slice(0,12)):''),true));
  const got=crypto.createHash('sha256').update(buf).digest('hex');
  if(man.sha256&&got!==man.sha256) throw new Error('下载校验不通过，未更新');
  const tmp=path.join(ROOT,'.update-'+Date.now());
  fs.mkdirSync(tmp,{recursive:true});
  const zipPath=path.join(tmp,'p.zip'); fs.writeFileSync(zipPath,buf);
  await new Promise((res,rej)=>execFile('/usr/bin/unzip',['-q','-o',zipPath,'-d',tmp],e=>e?rej(new Error('解压失败')):res()));
  const src=fs.existsSync(path.join(tmp,'app'))?tmp:path.join(tmp,fs.readdirSync(tmp).find(n=>fs.existsSync(path.join(tmp,n,'app')))||'');
  if(!fs.existsSync(path.join(src,'app'))) throw new Error('包结构不对，未更新');
  const names=fs.readdirSync(src).filter(n=>!KEEP.has(n)&&n!=='p.zip');
  log('备份当前版本，万一不对可以回退');
  // 备份是回滚的唯一依据，备份失败就停手：宁可这次不升级，也不能升成一半又退不回去
  try{ snapshot(info.current,names); }catch(e){ throw new Error('备份当前版本失败，已取消更新（'+e.message+'）'); }
  if(!canApply())throw Error('会议已经开始，暂不更新');
  log('替换程序文件');
  replaceFiles(src,names);
  // 下载来的文件带隔离标记会打不开，顺手清掉
  try{ await new Promise(res=>execFile('/usr/bin/xattr',['-dr','com.apple.quarantine',ROOT],()=>res())); }catch(e){}
  fs.rmSync(tmp,{recursive:true,force:true});
  log('更新完成');
  return {updated:true,version:man.version,from:info.current};
}
async function fetchChangelog(){
  for(const src of SOURCES){
    try{
      const j=JSON.parse(String(await fetchFile(src,'CHANGELOG.json')));
      if(j&&Array.isArray(j.items)) return j.items;
    }catch(e){}
  }
  return [];
}
let busy=false;
async function exclusive(fn){if(busy)throw Error('另一个更新操作正在进行');busy=true;try{return await fn();}finally{busy=false;}}
const apply=(log,canApply)=>exclusive(()=>applyUnlocked(log,canApply));
const rollback=log=>exclusive(()=>rollbackUnlocked(log));
module.exports={check,apply,localVersion,fetchChangelog,rollback,prevVersion,prevInfo,snapshotCurrent};
