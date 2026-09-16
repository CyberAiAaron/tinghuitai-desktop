#!/usr/bin/env node
'use strict';
// 把 web/src/*.js（按文件名顺序）原样拼回 web/index.html 里的那一个 IIFE。
// 运行时零变化：产物就是过去那一整块 <script>。开发时只改 web/src 下的小文件，改完跑 `npm run build`。
// 为什么不直接多个 <script src>：现在整段代码共享一个 IIFE 作用域，拆成多文件加载会把几百个局部变量变成全局，那不是「只搬不改」。
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..','web');
const files=fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js')).sort();
const js=files.map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n');
const tpl=fs.readFileSync(path.join(root,'index.template.html'),'utf8');
if(!tpl.includes('/*@@APP_JS@@*/'))throw new Error('模板里没有 /*@@APP_JS@@*/ 占位符');
const out=tpl.replace('/*@@APP_JS@@*/',()=>js);
const target=path.join(root,'index.html');
const same=fs.existsSync(target)&&fs.readFileSync(target,'utf8')===out;
if(!same)fs.writeFileSync(target,out);
console.log((same?'index.html 未变':'index.html 已重建')+'：'+files.length+' 个源文件，'+(out.length/1024).toFixed(0)+' KB');
