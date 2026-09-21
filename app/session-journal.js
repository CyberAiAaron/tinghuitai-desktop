'use strict';
const fs=require('fs'),path=require('path');
// tmp 名字带 pid：同一份 enhanced.json 可能被 Node 和 Python 同时写，同名临时文件会互相截断（审查 D3）
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp.'+process.pid;const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
module.exports={write,read};
