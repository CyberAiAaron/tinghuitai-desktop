'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const dataDir=path.resolve(process.env.THT_DATA_DIR||path.join(os.homedir(),'Library/Application Support/Tinghuitai'));
process.env.THT_DATA_DIR=dataDir;
process.umask(0o077);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const file=path.join(dataDir,'settings.json');
const defaults={PRESET_VERSION:'',ASR_PROVIDER:'',DEEPGRAM_API_KEY:'',MEMORY_PROJECTION_DIR:'',LLM_PROVIDER:'',VOLC_APP_KEY:'',VOLC_ACCESS_KEY:'',VOLC_RESOURCE_ID:'volc.seedasr.sauc.duration',DEEPSEEK_API_KEY:'',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',LLM_MODEL_QUICK:'',LLM_MODEL_LIVE:'sonnet',LLM_MODEL_POST:'opus',ARCHIVE_TARGET:'local',THT_ARCHIVE_OWNER_ID:'',AUDIO_RETENTION_DAYS:'30',JEV_API_KEY:'',JEV_GATE:'off',JEV_THRESHOLD:'0.5',JEV_MIN_GAP_MS:'25000'};   // JEV_*：逐句门卫（app/jev-gate.js），JEV_GATE=on 且有密钥才调；密钥只在 settings.json（2026-09-22 Aaron 确认上云链路）   // AUDIO_RETENTION_DAYS：录音保留天数，0 = 不清理；文字永不删（2026-09-22 Aaron 定）
function load(){const j=JSON.parse(fs.readFileSync(file,'utf8'));if(!j.RELAY_TOKEN)throw Error('本机配置不完整，请恢复 settings.json');return {...defaults,...j};}
function save(j){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(j,null,2),{mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,file);}
// 首次启动：如果安装包里带了 preset.json（Aaron 给家人预配好的凭据），就用它开箱即用。
// preset 只读一次，读完不删原文件（重装还能用），但凭据只会落进本机 settings.json（权限 600）。
function readPreset(){
  for(const dir of [path.join(__dirname,'..'), __dirname]){
    const f=path.join(dir,'preset.json');
    try{ if(fs.existsSync(f)){ const j=JSON.parse(fs.readFileSync(f,'utf8')); const out={};
      for(const k of Object.keys(defaults)) if(typeof j[k]==='string'&&j[k]) out[k]=j[k];
      return out; } }catch(e){}
  }
  return {};
}
// 首装：直接带上 preset。
// 已装过的：空着的字段补上；preset 版本号变了（换了新的服务凭据），把 preset 里给的那几项一起更新——
// 这样换包就能换掉过期或要换的凭据，不必让人手动删配置。用户自己额外填的其他字段一律不动。
function applyPreset(cur){
  const preset=readPreset(); if(!Object.keys(preset).length) return null;
  const ver=preset.PRESET_VERSION||''; delete preset.PRESET_VERSION;
  const bumped=ver && cur.PRESET_VERSION!==ver;
  const patch={};
  for(const k of Object.keys(preset)) if(bumped || !cur[k]) patch[k]=preset[k];
  if(ver && cur.PRESET_VERSION!==ver) patch.PRESET_VERSION=ver;
  return Object.keys(patch).length?patch:null;
}
if(!fs.existsSync(file)){
  const p=readPreset(); const ver=p.PRESET_VERSION||''; delete p.PRESET_VERSION;
  save({...defaults,...p,...(ver?{PRESET_VERSION:ver}:{}),RELAY_TOKEN:crypto.randomBytes(32).toString('hex')});
}else{
  try{
    const cur=JSON.parse(fs.readFileSync(file,'utf8'));
    const patch=applyPreset(cur);
    if(patch) save({...cur,...patch});
  }catch(e){}
}
module.exports={dataDir,file,load,save,defaults};
