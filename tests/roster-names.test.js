'use strict';
// 团队名单解析（context-pack.roster）与工作台前端的编号→人名替换。会后认人一屏已删（Aaron 09-24「录音/认人整块删」），这两块仍被处理台和工作台用。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const root=path.join(__dirname,'..');

test('团队名单：只认表格第一格和加粗的人名，说明文字不当人名',()=>{
  const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tht-team-')),'team.md');
  fs.writeFileSync(f,'# 名单\n\n| 人 | 角色 |\n|---|---|\n| **Shawn Liu** | AI 业务负责人 |\n| Cary Luo | 项目经理 |\n| 张三 | 硬件 |\n\n这一行里 The Team 不该被当成人名的话也无所谓，它只是候选。\n');
  // 名单只有一份读法：app/context-pack.js 的 roster()。认人的候选按钮和处理台拟日历用的是同一份。
  const roster=require('../app/context-pack').roster;
  const names=roster({TEAM_MEMBERS_FILE:f}).names;
  assert.ok(names.includes('Shawn Liu')&&names.includes('Cary Luo'));
  assert.ok(!names.includes('张三'),'中文名这版抽不出来，走自填框');
  assert.deepEqual(roster({}).names,[]);
  assert.deepEqual(roster({TEAM_MEMBERS_FILE:'/nope/not-here.md'}).names,[]);
  assert.equal(roster({TEAM_MEMBERS_FILE:f}).text.includes('AI 业务负责人'),true,'原文照样能给处理台用');
});
test('前端替换是纯函数：只认编号类的 key，S21 和 USB 不受影响',()=>{
  const js=fs.readFileSync(path.join(root,'web/work.js'),'utf8');
  const m=/function applySpeakerNames\(text,map\)\{[^\n]+\}/.exec(js);assert.ok(m,'work.js 里要有这个可单测的纯函数');
  const fn=new Function('return '+m[0].replace('function applySpeakerNames','function'))();
  assert.equal(fn('S2 说 S21 同意，说话人 2 负责',{'2':'乙'}),'乙 说 S21 同意，乙 负责');
  assert.equal(fn('USB 接口',{'张三':'张三'}),'USB 接口');
  assert.equal(fn('S2 负责',{'2':''}),'S2 负责','名字清掉了就不替换');
});
