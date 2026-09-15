#!/usr/bin/env node
'use strict';
// Uses the explicitly selected installation; prints metadata unless --print is requested.
const fs=require('fs'),path=require('path'),sync=require('../app/context-sync').sync;
if(!process.env.THT_DATA_DIR)throw Error('THT_DATA_DIR must explicitly select an installation');
const dataDir=path.resolve(process.env.THT_DATA_DIR);
const c=JSON.parse(fs.readFileSync(path.join(dataDir,'settings.json'),'utf8'));const r=sync({dataDir,outputDir:c.MEMORY_PROJECTION_DIR,extraPendingDirs:Array.isArray(c.CONTEXT_EXTRA_PENDING_DIRS)?c.CONTEXT_EXTRA_PENDING_DIRS:[]});
if(process.argv.includes('--print')&&r.enabled)process.stdout.write(fs.readFileSync(r.file,'utf8'));else console.log(JSON.stringify(r));
