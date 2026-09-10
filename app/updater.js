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
const KEEP=new Set(['preset.json','node_modules','.git','version-state.json']);
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
  if(src.kind==='raw') return get(src.base+name,{binary,timeout:180000});
  name=name.split('?')[0];   // API 路径不接受 query 参数
  // GitHub API：要原始内容得带这个 Accept
  return get(src.base+name,{binary,timeout:20000,raw:true});
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
async function apply(log=()=>{}){
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
  log('替换程序文件');
  for(const name of fs.readdirSync(src)){
    if(KEEP.has(name)||name==='p.zip') continue;
    const from=path.join(src,name),to=path.join(ROOT,name);
    fs.rmSync(to,{recursive:true,force:true});
    fs.cpSync(from,to,{recursive:true});
    if(name.endsWith('.command')){try{fs.chmodSync(to,0o755);}catch(e){}}
  }
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
module.exports={check,apply,localVersion,fetchChangelog};
