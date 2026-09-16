'use strict';
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');

function real(file){try{return fs.realpathSync(file);}catch{return path.resolve(file||'');}}
function read(command,args){return execFileSync(command,args,{encoding:'utf8'}).trim();}

function ownsServer(pid,{serverPath,rootDir,nodePaths=[],run=read,realpath=real}={}){
  if(!Number.isInteger(pid)||pid<=1)return false;
  try{
    const command=run('/bin/ps',['-ww','-p',String(pid),'-o','command=']);
    const cwdLines=run('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn']).split('\n');
    const textLines=run('/usr/sbin/lsof',['-a','-p',String(pid),'-d','txt','-Fn']).split('\n');
    const cwd=cwdLines.find(x=>x.startsWith('n'))?.slice(1)||'';
    const executable=textLines.find(x=>x.startsWith('n'))?.slice(1)||'';
    const allowedNodes=new Set(nodePaths.filter(Boolean).map(realpath));
    if(!allowedNodes.has(realpath(executable)))return false;
    const absolute=' '+serverPath;
    if(command.endsWith(absolute))return true;
    return command.endsWith(' app/server.js')&&realpath(cwd)===realpath(rootDir);
  }catch{return false;}
}

module.exports={ownsServer};
