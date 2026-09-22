'use strict';
// 卡片对话框（app/card-thread.js）里那个无头 agent 能用的工具范围，以及给它看的用法速查。
// 文件名不带 lark-cli 是因为引用它的 card-thread.js 不许出现这串字（同一条规矩的扫描是按文本来的）。放在工具层是因为仓库规矩「lark-cli 的命令行只在 app/tools/ 里拼」（tests/arch-tools.test.js）。
// 两档：READ = 未确认轮次（查人 / 看忙闲 / 看日程 / 读任务 / 搜消息 / 读 Slack / --dry-run）；
//       WRITE = 用户对「上一条带 pendingAction 的提问」回「是」之后，只放开那个动作对应的一小集（Codex 94dd3aa4 复审：不再服务器级通配，也不再 Bash(lark-cli:*) 全放）。
// Slack 走 tht-slack（app/tools/bin/tht-slack，随仓库发版的固定壳，card-thread 校验过所有者 / 权限 / 非符号链接后把这个目录前置到 PATH），口令从本机 settings.json 读，不经模型、不进命令行参数。
const LARK_READ_TOOLS = [
  'Bash(lark-cli contact:*)', 'Bash(lark-cli calendar +agenda:*)', 'Bash(lark-cli calendar +freebusy:*)', 'Bash(lark-cli calendar +get:*)', 'Bash(lark-cli calendar +search-event:*)',
  'Bash(lark-cli task +get:*)', 'Bash(lark-cli task +get-my-tasks:*)', 'Bash(lark-cli im +chats-search:*)', 'Bash(lark-cli im +messages-search:*)', 'Bash(lark-cli docs +fetch:*)', 'Bash(lark-cli * --dry-run*)',
];
const SLACK_READ_TOOLS = ['Bash(tht-slack search:*)', 'Bash(tht-slack read-channel:*)', 'Bash(tht-slack read-thread:*)', 'Bash(tht-slack user:*)'];
const READ_TOOLS = [...LARK_READ_TOOLS, ...SLACK_READ_TOOLS];

// 三种要确认的动作，各自一小集写工具（Bash 前缀 + lark-mcp 的精确工具名）。一次确认只放开其中一种。
const WRITE_BY_ACTION = {
  calendar: { bash: ['Bash(lark-cli calendar +create:*)', 'Bash(lark-cli calendar +update:*)'], mcp: ['mcp__lark-mcp__calendar_v4_calendarEvent_create', 'mcp__lark-mcp__calendar_v4_calendarEvent_patch'] },
  message: { bash: ['Bash(lark-cli im +messages-send:*)', 'Bash(tht-slack send:*)', 'Bash(tht-slack dm:*)'], mcp: ['mcp__lark-mcp__im_v1_message_create'] },
  task: { bash: ['Bash(lark-cli task +create:*)', 'Bash(lark-cli task +assign:*)'], mcp: ['mcp__lark-mcp__task_v2_task_create', 'mcp__lark-mcp__task_v2_task_patch'] },
};
const ACTIONS = Object.keys(WRITE_BY_ACTION);
const WRITE_TOOLS = [...new Set(ACTIONS.flatMap(a => WRITE_BY_ACTION[a].bash))];
const MCP_READ_TOOLS = ['mcp__lark-mcp__contact_v3_user_batchGetId', 'mcp__lark-mcp__calendar_v4_freebusy_list', 'mcp__lark-mcp__calendar_v4_calendarEvent_get', 'mcp__lark-mcp__calendar_v4_calendar_primary', 'mcp__lark-mcp__im_v1_chat_search', 'mcp__lark-mcp__im_v1_chatMembers_get', 'mcp__lark-mcp__task_v2_task_get'];
const MCP_WRITE_TOOLS = [...new Set(ACTIONS.flatMap(a => WRITE_BY_ACTION[a].mcp))];
// lark-mcp 启动时 -t 只开这些（读 + 写全集），确认前靠 --allowedTools 再收一层
const LARK_MCP_TOOL_IDS = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS].map(n => n.replace(/^mcp__lark-mcp__/, '').replace(/_/g, '.')).join(',');

// agent 的提问在问哪种动作：按关键词归类。归不进任何一类、或一句里同时问了两种动作的，都不算待确认动作——
// 用户回「是」放不开任何写工具，模型得拆开一次只问一种（RULES 里写了「一次只问一种动作」；Codex 70f42bb6：不许一个「是」放开两类）。
const ACTION_RE = {
  calendar: /约|日程|日历|会议邀请|邀请|时间(改|定|约)|schedule|calendar|invite/i,
  message: /发(消息|私聊|给|到|一条|个)|消息|私聊|群里|通知|Slack|飞书|回复|message|send|dm\b/i,
  task: /任务|派给|指派|分派|待办|task|assign/i,
};
function pendingActionOf(replyText) {
  const t = String(replyText || '');
  if (!/[?？]/.test(t)) return '';
  const hit = ACTIONS.filter(a => ACTION_RE[a].test(t));
  return hit.length === 1 ? hit[0] : '';
}
// 一次只放一个动作的集合；slack=false（壳没通过校验 / 设置里没接）时把 tht-slack 的条目也去掉
function writeToolsFor(action, { mcp = false, slack = true } = {}) {
  const a = String(action || '');
  if (!WRITE_BY_ACTION[a]) return [];
  return [...WRITE_BY_ACTION[a].bash, ...(mcp ? WRITE_BY_ACTION[a].mcp : [])].filter(x => slack || !/^Bash\(tht-slack /.test(x));
}
function readToolsFor({ mcp = false, slack = true } = {}) {
  return [...LARK_READ_TOOLS, ...(slack ? SLACK_READ_TOOLS : []), ...(mcp ? MCP_READ_TOOLS : [])];
}

const CHEAT_SHEET = [
  '工具只有 Bash 里的 lark-cli（已用 Aaron 本人身份登录，都加 --as user，输出是 JSON）。用法速查：',
  '  找人 open_id：lark-cli contact +search-user --query "Cary Luo" --as user',
  '  看忙闲：lark-cli calendar +freebusy --start 2026-09-24 --end 2026-09-24 --user-id ou_a,ou_b --as user　　看日程：lark-cli calendar +agenda --start <日期> --end <日期> --as user',
  '  建日程：lark-cli calendar +create --summary "…" --start "2026-09-24T14:00+08:00" --end "2026-09-24T15:00+08:00" --attendee-ids ou_a,ou_b --as user',
  '  发私聊：lark-cli im +messages-send --user-id ou_xxx --text "…" --as user（正文末尾加「— Aaron 的 Claude 代回」）',
  '  建任务：lark-cli task +create --summary "…" --description "…" --assignee ou_xxx --due 2026-09-25 --as user',
];
const SLACK_CHEAT_SHEET = [
  '  Slack 走 tht-slack（口令已在本机配置里，命令里不用填；缺权限时它会回 missing_scope，照实报）：',
  '  Slack 搜消息：tht-slack search --query "in:#channel 关键词" --limit 8　　读频道最近几条：tht-slack read-channel --channel C0xxx --limit 10',
  '  Slack 读线程：tht-slack read-thread --channel C0xxx --ts 1726000000.000100　　查人：tht-slack user --user U0xxx（或 --email a@b.c）',
  '  Slack 发消息：tht-slack send --channel C0xxx --text "…"　　发私聊：tht-slack dm --user U0xxx --text "…"（会自动补「— Aaron 的 Claude 代回」）',
];
module.exports = { READ_TOOLS, LARK_READ_TOOLS, SLACK_READ_TOOLS, WRITE_TOOLS, WRITE_BY_ACTION, ACTIONS, MCP_READ_TOOLS, MCP_WRITE_TOOLS, LARK_MCP_TOOL_IDS, pendingActionOf, writeToolsFor, readToolsFor, CHEAT_SHEET, SLACK_CHEAT_SHEET };
