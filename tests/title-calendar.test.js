const test=require('node:test'),assert=require('node:assert'),{spawnSync}=require('node:child_process'),path=require('node:path');
const py=(code)=>{const r=spawnSync('python3',['-c',`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(__dirname,'..','app','meeting-pipeline.py'))});mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)\n${code}`],{encoding:'utf8',env:{...process.env,THT_DATA_DIR:require('node:os').tmpdir()}});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
const ev=(name,a,b,extra={})=>({summary:name,start_time:{timestamp:String(a)},end_time:{timestamp:String(b)},free_busy_status:'busy',self_rsvp_status:'accept',...extra});
test('日历名：取重叠最多的会议，去掉会议室后缀',()=>{const E=[ev('周会（17F 9 号会议室）',1000,4600),ev('别的会',4000,8000)];
  assert.equal(py(`print(json.dumps(mp.pick_calendar_name(${JSON.stringify(E)},1200,4200)))`),'周会');});
test('日历名：空闲备忘、已拒绝、重叠太短的都不算',()=>{const E=[ev('活动备忘',1000,4600,{free_busy_status:'free'}),ev('拒了的会',1000,4600,{self_rsvp_status:'decline'}),ev('擦边的会',4100,8000)];
  assert.equal(py(`print(json.dumps(mp.pick_calendar_name(${JSON.stringify(E)},1200,4200)))`),'');});
