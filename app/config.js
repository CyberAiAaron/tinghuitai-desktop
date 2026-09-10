'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const dataDir=path.resolve(process.env.THT_DATA_DIR||path.join(os.homedir(),'Library/Application Support/Tinghuitai'));
process.env.THT_DATA_DIR=dataDir;
process.umask(0o077);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const file=path.join(dataDir,'settings.json');
const defaults={LLM_PROVIDER:'',VOLC_APP_KEY:'',VOLC_ACCESS_KEY:'',VOLC_RESOURCE_ID:'volc.seedasr.sauc.duration',DEEPSEEK_API_KEY:'',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',ARCHIVE_TARGET:'local',THT_ARCHIVE_OWNER_ID:''};
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
// 已经装过一次的（settings.json 已存在、但凭据还空着）：把 preset 补进去，不覆盖用户自己填过的值。
if(!fs.existsSync(file)){
  save({...defaults,...readPreset(),RELAY_TOKEN:crypto.randomBytes(32).toString('hex')});
}else{
  try{
    const cur=JSON.parse(fs.readFileSync(file,'utf8'));
    const preset=readPreset(); const add={};
    for(const k of Object.keys(preset)) if(!cur[k]) add[k]=preset[k];
    if(Object.keys(add).length) save({...cur,...add});
  }catch(e){}
}
module.exports={dataDir,file,load,save,defaults};
