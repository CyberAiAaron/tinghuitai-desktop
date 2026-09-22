'use strict';
// 会后流水线的失败模式（2026-09-22 架构审查 D3 / D11 / R3 / R5 / R8 / S8）：
//   D3 enhanced.json 两个进程写，Node 三个写入口不拿锁 → 自动补跑撞上「改名字」= 有一边的改动丢了
//   D11 job / enhanced 没有版本字段，兼容全靠各处各写一遍 or
//   R3 转写有缺口就写 speakerWarning → 下游当成「说话人不可信」整场抹掉名字、job 永久 partial
//   R5 Python 子进程没有看门狗，卡一场堵住后面所有会
//   R8 分块总结一块失败整份作废；partial 永不自动补跑
//   S8 Python 裸读 settings 拿不到 defaults；stderr 被丢；语气词正则两边各一份
// 看门狗阈值要在 require 之前定（模块加载时读一次），所以这两行必须在最上面。
process.env.THT_TEST = '1';
process.env.THT_PY_TIMEOUT_MS = '1500';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), APP = path.join(root, 'app');
const makePipeline = require('../app/meeting-pipeline');

const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), 'tht-' + tag + '-'));
const key = id => require('crypto').createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 起一个假 python：脚本内容自己给
function fakePython(dir, body) {
  const p = path.join(dir, 'fake-python.sh');
  fs.writeFileSync(p, '#!/bin/sh\n' + body + '\n'); fs.chmodSync(p, 0o755);
  return p;
}
// 直接在 meeting-pipeline.py 这个模块里跑一段代码（和 archive-brief.test.js 同一套）
const py = (code, env = {}) => {
  const dir = env.THT_DATA_DIR || tmp('py');
  const r = spawnSync('python3', ['-c', `import importlib.util,json,sys,pathlib\nspec=importlib.util.spec_from_file_location('mp',${JSON.stringify(path.join(APP, 'meeting-pipeline.py'))});mp=importlib.util.module_from_spec(spec);spec.loader.exec_module(mp)\n${code}`],
    { encoding: 'utf8', env: { ...process.env, THT_DATA_DIR: dir, ...env } });
  if (r.status) throw Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

// —— R5：Python 卡住不能堵住后面所有会 ——

test('R5 看门狗：Python 卡住超过上限就按进程组杀掉，任务标 error 并按老规矩重排', async () => {
  const dir = tmp('watchdog'), pipe = path.join(dir, 'state', 'meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const mp = makePipeline({ dir: pipe, log: () => {},
    // 假 python：起一个后台子进程再自己睡着——两个都得被杀掉，杀不掉的话这个测试会挂在那儿
    root: APP });
  process.env.THT_PYTHON = fakePython(dir, 'sleep 30 &\nsleep 30');
  try {
    const job = mp.enqueue({ id: 'm-stuck', title: '卡住的一场', transcript: [{ id: 's1', at: 1, text: '这场会让整理卡住' }] });
    let cur = null;
    for (let i = 0; i < 60 && (!cur || cur.status !== 'error'); i++) { await sleep(200); cur = readJson(path.join(pipe, job.key + '.job.json')); }
    assert.equal(cur.status, 'error', '看门狗没把卡住的那一场收掉：' + JSON.stringify(cur));
    assert.match(cur.error, /没结束，已中断/);
    assert.equal(cur.attempts, 1);
    assert.ok(cur.nextRetry > Date.now() / 1000, '要按老规矩排下一次重试');
  } finally { mp.stop(); delete process.env.THT_PYTHON; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S8 Python 半路死掉：stderr 尾部进 job，别只留一句「进程中断」', async () => {
  const dir = tmp('stderr'), pipe = path.join(dir, 'state', 'meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const mp = makePipeline({ dir: pipe, log: () => {}, root: APP });
  process.env.THT_PYTHON = fakePython(dir, 'echo "ModuleNotFoundError: 找不到某个依赖" >&2\nexit 1');
  try {
    const job = mp.enqueue({ id: 'm-crash', title: '崩掉的一场', transcript: [{ id: 's1', at: 1, text: '这场会让 python 崩掉' }] });
    let cur = null;
    for (let i = 0; i < 40 && (!cur || cur.status !== 'error'); i++) { await sleep(150); cur = readJson(path.join(pipe, job.key + '.job.json')); }
    assert.equal(cur.status, 'error');
    assert.match(cur.error, /找不到某个依赖/, 'stderr 没带进 job.error');
    assert.match(cur.stderrTail, /ModuleNotFoundError/);
  } finally { mp.stop(); delete process.env.THT_PYTHON; fs.rmSync(dir, { recursive: true, force: true }); }
});

// —— R8：整理不完整的那些要自己补跑 ——

test('R8 partial 也自动补跑，上限 2 次', async () => {
  const dir = tmp('partial'), pipe = path.join(dir, 'state', 'meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const k1 = key('m-partial'), k2 = key('m-used-up');
  const base = { input: path.join(pipe, 'x.input.json'), created: new Date().toISOString(), attempts: 1, phase: '已归档' };
  fs.writeFileSync(base.input, JSON.stringify({ id: 'x', transcript: [] }));
  fs.writeFileSync(path.join(pipe, k1 + '.job.json'), JSON.stringify({ ...base, key: k1, sessionId: 'm-partial', status: 'partial' }));
  fs.writeFileSync(path.join(pipe, k2 + '.job.json'), JSON.stringify({ ...base, key: k2, sessionId: 'm-used-up', status: 'partial', partialRetries: 2 }));
  process.env.THT_PYTHON = fakePython(dir, 'exit 0');
  const mp = makePipeline({ dir: pipe, log: () => {}, root: APP });
  try {
    let a = null;
    for (let i = 0; i < 40; i++) { await sleep(200); a = readJson(path.join(pipe, k1 + '.job.json')); if (a.partialRetries) break; }
    assert.equal(a.partialRetries, 1, '整理不完整的那一场没有自动补跑');
    const b = readJson(path.join(pipe, k2 + '.job.json'));
    assert.equal(b.status, 'partial', '补跑过 2 次的不该再自动跑');
    assert.equal(b.partialRetries, 2);
  } finally { mp.stop(); delete process.env.THT_PYTHON; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R8 分块总结一块失败：那一段用原文占位继续，整份不废，并记在账上', () => {
  const dir = tmp('chunk'), rows = [];
  for (let i = 0; i < 420; i++) rows.push({ id: 's' + i, t: '0:' + i, text: (i === 250 ? '坏块标记：' : '') + '第' + i + '句，' + '把这段话凑够长度让它必须分块'.repeat(4) });
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id: 'm-chunk', transcript: rows, notes: '' }));
  const out = py(`
calls=[]
def fake(system,user,**k):
    calls.append(user)
    if '坏块标记' in user: raise mp.ModelError('这家挂了')
    return {'text':'段落摘要%d' % len(calls)}
mp.ask_model=fake
session=json.loads(pathlib.Path(${JSON.stringify(path.join(dir, 'session.json'))}).read_text())
out=mp.summarize(session, context_purpose=None)
print(json.dumps({'out':out,'failed':mp.CHUNK_NOTE['failed'],'finalSaw':'（这一段整理失败，原文保留）' in calls[-1],'calls':len(calls)}))
`, { THT_DATA_DIR: dir });
  assert.equal(out.failed, 1, '应该正好一块失败');
  assert.ok(out.calls >= 3, '这场得真的分成了多块');
  assert.ok(out.finalSaw, '失败那一段的原文占位没被带进最终那轮');
  assert.match(out.out, /段落摘要/, '整份总结还是出来了');
});

// —— R3：缺口不等于说话人不可信 ——

test('R3 转写有缺口：写 gapWarning，不写 speakerWarning，整理照样算 done', () => {
  const dir = tmp('gap'), pipe = path.join(dir, 'state', 'meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const k = key('m-gap');
  const input = path.join(pipe, k + '.input.json');
  fs.writeFileSync(input, JSON.stringify({ id: 'm-gap', title: '有缺口的一场', start: '2026-09-22T01:00:00.000Z',
    transcriptionGapSeconds: 42, names: { '1': '甲' },
    transcript: [{ id: 's1', at: 60, t: '1:00', speaker: '1', text: '中间断过一会儿' }] }));
  fs.writeFileSync(path.join(pipe, k + '.job.json'), JSON.stringify({ key: k, sessionId: 'm-gap', title: '有缺口的一场', input, status: 'queued', phase: '等待整理', created: new Date().toISOString(), attempts: 0 }));
  const got = py(`
mp.summarize=lambda *a,**k:'一段总结'
mp.full_title=lambda *a,**k:'一个标题'
mp.build_brief=lambda *a,**k:{'v':1,'overview':{'topics':[],'conclusions':[],'todos':[]},'topics':[]}
job=mp.process(pathlib.Path(${JSON.stringify(path.join(pipe, k + '.job.json'))}))
enh=mp.read(pathlib.Path(${JSON.stringify(path.join(pipe, k + '.job.enhanced.json'))}))
print(json.dumps({'job':job,'enh':{x:enh.get(x) for x in ['gapWarning','speakerWarning','schema','names']}}))
`, { THT_DATA_DIR: dir, THT_PIPELINE_DIR: pipe });
  assert.match(got.job.gapWarning, /实时转写有缺口/);
  assert.equal(got.job.speakerWarning || '', '', '缺口不该写进 speakerWarning——下游会据此把整场的名字抹掉');
  assert.match(got.enh.gapWarning, /实时转写有缺口/);
  assert.deepEqual(got.enh.names, { '1': '甲' }, '名字要留着');
  assert.equal(got.job.status, 'done', '只有缺口不该让这场永久停在 partial');
  // D11：新写入的两份都带版本号
  assert.equal(got.job.schema, 2);
  assert.equal(got.enh.schema, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('D11 读侧的字段嗅探收在一个 normalize 里：id / 标题在 job 和 enhanced 之间兜底', () => {
  const got = py(`print(json.dumps([
  mp.normalize({'id':'a','topicTitle':'甲'},{'sessionId':'b','topicTitle':'乙'}),
  mp.normalize({},{'sessionId':'b','topicTitle':'乙','gapWarning':'有缺口'}),
  mp.normalize({},{})]))`);
  assert.equal(got[0].id, 'a'); assert.equal(got[0].topicTitle, '甲'); assert.equal(got[0].schema, 1);
  assert.equal(got[1].id, 'b'); assert.equal(got[1].topicTitle, '乙'); assert.equal(got[1].gapWarning, '有缺口');
  assert.deepEqual([got[2].id, got[2].topicTitle, got[2].schema], ['', '', 1]);
});

// —— D3：两个进程写同一份 enhanced.json ——

test('D3 改 enhanced.json 走同一把锁：Python 拿着锁时 Node 这边等它写完，两边的改动都还在', async () => {
  const dir = tmp('lock'), pipe = path.join(dir, 'state', 'meeting-pipeline');
  fs.mkdirSync(pipe, { recursive: true });
  const k = key('m-lock'), ep = path.join(pipe, k + '.job.enhanced.json');
  fs.writeFileSync(path.join(pipe, k + '.job.json'), JSON.stringify({ key: k, sessionId: 'm-lock', status: 'done', created: '2026-09-22', input: '' }));
  fs.writeFileSync(ep, JSON.stringify({ id: 'm-lock', names: {}, brief: { questions: [], answers: {} } }));
  const mp = makePipeline({ dir: pipe, log: () => {}, root: APP });
  const holder = spawn('python3', ['-c', `
import fcntl,json,pathlib,sys,time
ep=pathlib.Path(sys.argv[1]); lp=pathlib.Path(sys.argv[2])
with lp.open('a') as lk:
    fcntl.flock(lk,fcntl.LOCK_EX)
    time.sleep(0.8)
    d=json.loads(ep.read_text()); d.setdefault('brief',{}).setdefault('answers',{})['q9']={'choice':1}
    t=ep.with_suffix('.hold.tmp'); t.write_text(json.dumps(d)); t.replace(ep)
`, ep, path.join(pipe, k + '.job.lock')]);
  try {
    await sleep(250);                                   // 让它先拿到锁
    const t0 = Date.now();
    const session = mp.setNames('m-lock', { '2': '甲' });
    const waited = Date.now() - t0;
    await new Promise(r => holder.on('close', r));
    const saved = readJson(ep);
    assert.ok(waited > 300, 'Node 这边没等锁就写了（等了 ' + waited + 'ms），说明两边不是同一把锁');
    assert.equal(saved.names['2'], '甲', 'Node 改的名字丢了');
    assert.deepEqual(saved.brief.answers.q9, { choice: 1 }, 'Python 写的那一笔被覆盖了');
    assert.equal(saved.schema, 2);
    assert.equal(session.names['2'], '甲', '调用方拿回的要是合并后的结果');
  } finally { mp.stop(); try { holder.kill('SIGKILL'); } catch (e) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D3 临时文件名带 pid：两个进程同时写同一份文件不会互相截断', () => {
  assert.match(fs.readFileSync(path.join(APP, 'session-journal.js'), 'utf8'), /\.tmp\.'\+process\.pid/);
  assert.match(fs.readFileSync(path.join(APP, 'meeting-pipeline.py'), 'utf8'), /'\.tmp\.%d' % os\.getpid\(\)/);
});

// —— S8：Node ↔ Python 的边界 ——

test('S8 Python 的配置由 Node 给：THT_CFG_JSON 压过裸读 settings.json，且里面没有任何密钥', () => {
  const dir = tmp('cfg');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ARCHIVE_TARGET: 'local', MEMORY_PROJECTION_DIR: '/来自文件' }));
  const got = py(`print(json.dumps([mp.cfg('ARCHIVE_TARGET','local'),mp.cfg('MEMORY_PROJECTION_DIR'),mp.chain_length()]))`,
    { THT_DATA_DIR: dir, THT_CFG_JSON: JSON.stringify({ ARCHIVE_TARGET: 'lark', chainLength: 3 }) });
  assert.deepEqual(got, ['lark', '/来自文件', 3], 'Node 给的压过文件；Node 没给的那项退回读文件');

  // Node 侧只往这个环境变量里放白名单里的键：一个密钥都不许进
  const src = fs.readFileSync(path.join(APP, 'meeting-pipeline.js'), 'utf8');
  const body = /function cfgJson\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  assert.doesNotMatch(body, /KEY|TOKEN|SECRET|RELAY/i, 'cfgJson 里出现了疑似密钥的字段');
  const emitted = /JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(body)[1];
  assert.deepEqual(emitted.match(/(\w+)\s*:/g).map(x => x.replace(/\s*:$/, '')).sort(),
    ['ARCHIVE_TARGET', 'MEMORY_PROJECTION_DIR', 'THT_ARCHIVE_OWNER_ID'], '往 Python 递的字段变了，重新核一遍有没有密钥混进去');
  assert.match(emitted, /chainLength$/);
  // 起 Python 的两处都要递：归档队列（pump）和回看页补跑（brief），漏一处那条路就又回去裸读文件了
  assert.equal((src.match(/THT_CFG_JSON:cfgJson\(\)/g) || []).length, 3, 'meeting-pipeline.js 里起 Python 的地方没都带上配置');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S8 语气词正则只有一份：Python 读 app/shared/filler.json；server.js 里那份必须和它一字不差', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(APP, 'shared', 'filler.json'), 'utf8'));
  assert.match(fs.readFileSync(path.join(APP, 'meeting-pipeline.py'), 'utf8'), /shared'\s*\/\s*'filler\.json'/, 'Python 没在读单源');
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const m = /function fillerASR\(text\)\{return typeof text==='string'&&\/(.+?)\/i\.test\(text\.replace\(\/(.+?)\/g,''\)\)/.exec(server);
  assert.ok(m, 'server.js 里的 fillerASR 变样了，这条对照失效，去核一遍');
  assert.equal(m[1], spec.pattern, 'server.js 和 filler.json 的语气词正则已经不一样了——同一句话会中被滤、会后不被滤');
  assert.equal(m[2], spec.strip, 'server.js 和 filler.json 的去标点规则已经不一样了');
});

test('12 兜底超时按链长算，不再写死乘 2', () => {
  const src = fs.readFileSync(path.join(APP, 'meeting-pipeline.py'), 'utf8');
  assert.match(src, /timeout\=max\(1, timeout\) \* chain_length\(\) \+ 60/);
  assert.doesNotMatch(src, /max\(1, timeout\) \* 2 \+ 60/);
});
