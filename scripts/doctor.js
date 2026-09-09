'use strict';
const {spawnSync}=require('child_process'),fs=require('fs');
let failed=false;function check(name,ok,action=''){console.log((ok?'✓ ':'✗ ')+name+(ok?'':'：'+action));if(!ok)failed=true;}
check('Node 22+',Number(process.versions.node.split('.')[0])>=22,'重新运行安装文件');
const py=spawnSync(process.env.THT_PYTHON||'python3',['-c','import sys; assert sys.version_info >= (3,9)'],{encoding:'utf8'});check('Python 3.9+',py.status===0,'安装 https://www.python.org/downloads/macos/');
try{require('ws');require('busboy');check('运行依赖',true);}catch{check('运行依赖',false,'运行 npm ci --ignore-scripts');}
try{const c=require('../app/config'),s=c.load();check('本机配置权限',!(fs.statSync(c.file).mode&0o077),'将 settings.json 权限改为 600');console.log('语音凭证：'+(s.VOLC_APP_KEY&&s.VOLC_ACCESS_KEY?'已填写（未验证服务）':'待填写'));console.log('模型凭证：'+(s.DEEPSEEK_API_KEY?'已填写（未验证连通）':'待填写'));console.log('归档：'+(s.ARCHIVE_TARGET==='local'?'本机':'飞书，须单独验证本人权限'));}catch{check('本机配置',false,'原文件已保留，请让AI核对格式，不要清空原数据');}
console.log('自检不调用付费API；真实采音、字幕、翻译和总结需30秒试录验收。');process.exitCode=failed?1:0;
