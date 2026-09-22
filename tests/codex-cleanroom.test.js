'use strict';
// Codex 命令行净室：它看到的只能是引擎递过去的那份输入。
//
// 原来这条路只有 `exec --sandbox read-only --skip-git-repo-check -`，于是 Codex 会自己把
// $CODEX_HOME/config.toml 里配的 MCP 连上、把 $CODEX_HOME/AGENTS.md（Aaron 那份全局规则）
// 当系统指令带进去。同一段会议材料换台机器结果就不一样，而且「它凭什么看到这些」没人答得上来。
//
// 这里用一个假的 codex 可执行文件验「参数和环境变量传对了」：真实调用验不了（Codex 周额度
// 2026-09-24 09:10 才恢复），那部分标着 09-24 后补测，没有写成已验证。
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const cliLlm = require('../app/cli-llm');

function fakeCodex(dir) {
  const cap = path.join(dir, 'codex-seen.json'), js = path.join(dir, 'fake-codex.js');
  fs.writeFileSync(js, `const fs=require('fs');let s='';process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(cap)},JSON.stringify({argv:process.argv.slice(2),home:process.env.CODEX_HOME||'',cwd:process.cwd(),stdin:s}));
process.stdout.write('假 Codex 的回答\\n');});`);
  const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(js)} "$@"\n`);
  fs.chmodSync(bin, 0o755);
  return { bin, seen: () => JSON.parse(fs.readFileSync(cap, 'utf8')) };
}

test('Codex 起进程时带上净室开关，并换到一个只有凭证的家', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-codex-'));
  const f = fakeCodex(dir);
  const old = process.env.THT_CODEX_BIN;
  process.env.THT_CODEX_BIN = f.bin;
  try {
    const r = await cliLlm.askDetailed('codex', '本场材料', { dataDir: dir, system: '你是会议记录分析助手', timeoutMs: 30000 });
    assert.equal(r.ok, true, '假 codex 没跑通：' + JSON.stringify(r));
    assert.equal(r.text, '假 Codex 的回答');

    const seen = f.seen(), a = seen.argv;
    // 依据 codex-cli 0.155.0-alpha.9.2 的 `codex exec --help`，这四项都是它自己的开关
    assert.ok(a.includes('--ignore-user-config'), '还会读 $CODEX_HOME/config.toml，MCP 就配在那儿');
    assert.ok(a.includes('--ignore-rules'), '还会读用户 / 项目的 .rules');
    assert.ok(a.includes('--ephemeral'), '还会往盘上写会话文件');
    assert.equal(a[a.indexOf('-c') + 1], 'project_doc_max_bytes=0', '还会把 AGENTS.md 当项目文档带进去');
    assert.ok(a.includes('--sandbox') && a[a.indexOf('--sandbox') + 1] === 'read-only', '只读沙箱不能丢');
    assert.equal(a[a.length - 1], '-', '材料还是走 stdin');
    assert.equal(seen.stdin, '你是会议记录分析助手\n\n本场材料', 'Codex 没有 --system-prompt，系统提示词拼在 stdin 最前面');

    // 换家：全局 AGENTS.md 读的是 CODEX_HOME 底下那份，--ignore-user-config 管不着它
    assert.equal(seen.home, path.join(dir, 'state', 'codex-home'));
    assert.deepEqual(fs.readdirSync(seen.home), ['auth.json'], '这个家里除了凭证不该有第二样东西');
    assert.equal(fs.readlinkSync(path.join(seen.home, 'auth.json')), path.join(os.homedir(), '.codex', 'auth.json'),
      '凭证是软链过去的，不复制一份出来');
    for (const leak of ['config.toml', 'AGENTS.md', 'skills', 'plugins'])
      assert.ok(!fs.existsSync(path.join(seen.home, leak)), '净室里冒出了 ' + leak);
  } finally { old === undefined ? delete process.env.THT_CODEX_BIN : (process.env.THT_CODEX_BIN = old);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
});

test('没有数据目录就不换家：宁可带上全局规则，也不能因为家没建起来调不动', () => {
  assert.equal(cliLlm.codexHome(''), '', '没有数据目录时不该硬造一个家');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tht-codex2-'));
  try {
    const a = cliLlm.codexHome(dir), b = cliLlm.codexHome(dir);
    assert.equal(a, b, '重复调用要幂等，不该每次重建');
    assert.equal(fs.readdirSync(a).join(), 'auth.json');
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
});
