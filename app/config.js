'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const dataDir=path.resolve(process.env.THT_DATA_DIR||path.join(os.homedir(),'Library/Application Support/Tinghuitai'));
process.env.THT_DATA_DIR=dataDir;
process.umask(0o077);fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const file=path.join(dataDir,'settings.json');
const defaults={VOLC_APP_KEY:'',VOLC_ACCESS_KEY:'',VOLC_RESOURCE_ID:'volc.seedasr.sauc.duration',DEEPSEEK_API_KEY:'',LLM_BASE_URL:'https://api.deepseek.com',LLM_MODEL:'deepseek-chat',ARCHIVE_TARGET:'local',THT_ARCHIVE_OWNER_ID:''};
function load(){const j=JSON.parse(fs.readFileSync(file,'utf8'));if(!j.RELAY_TOKEN)throw Error('本机配置不完整，请恢复 settings.json');return {...defaults,...j};}
function save(j){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(j,null,2),{mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,file);}
if(!fs.existsSync(file))save({...defaults,RELAY_TOKEN:crypto.randomBytes(32).toString('hex')});
module.exports={dataDir,file,load,save,defaults};
