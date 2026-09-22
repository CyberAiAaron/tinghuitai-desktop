'use strict';
// 卡片对话框（app/card-thread.js）里那个无头 agent 能用的飞书命令行范围，以及给它看的用法速查。
// 文件名不带 lark-cli 是因为引用它的 card-thread.js 不许出现这串字（同一条规矩的扫描是按文本来的）。放在工具层是因为仓库规矩「lark-cli 的命令行只在 app/tools/ 里拼」（tests/arch-tools.test.js）。
// 两档：READ = 未确认轮次（查人 / 看忙闲 / 看日程 / 读任务 / 搜消息 / --dry-run），WRITE = 用户回「是」之后（全部子命令）。
const READ_TOOLS = [
  'Bash(lark-cli contact:*)', 'Bash(lark-cli calendar +agenda:*)', 'Bash(lark-cli calendar +freebusy:*)', 'Bash(lark-cli calendar +get:*)', 'Bash(lark-cli calendar +search-event:*)',
  'Bash(lark-cli task +get:*)', 'Bash(lark-cli task +get-my-tasks:*)', 'Bash(lark-cli im +chats-search:*)', 'Bash(lark-cli im +messages-search:*)', 'Bash(lark-cli docs +fetch:*)', 'Bash(lark-cli * --dry-run*)',
];
const WRITE_TOOLS = ['Bash(lark-cli:*)'];
const CHEAT_SHEET = [
  '工具只有 Bash 里的 lark-cli（已用 Aaron 本人身份登录，都加 --as user，输出是 JSON）。用法速查：',
  '  找人 open_id：lark-cli contact +search-user --query "Cary Luo" --as user',
  '  看忙闲：lark-cli calendar +freebusy --start 2026-09-24 --end 2026-09-24 --user-id ou_a,ou_b --as user　　看日程：lark-cli calendar +agenda --start <日期> --end <日期> --as user',
  '  建日程：lark-cli calendar +create --summary "…" --start "2026-09-24T14:00+08:00" --end "2026-09-24T15:00+08:00" --attendee-ids ou_a,ou_b --as user',
  '  发私聊：lark-cli im +messages-send --user-id ou_xxx --text "…" --as user（正文末尾加「— Aaron 的 Claude 代回」）',
  '  建任务：lark-cli task +create --summary "…" --description "…" --assignee ou_xxx --due 2026-09-25 --as user',
];
module.exports = { READ_TOOLS, WRITE_TOOLS, CHEAT_SHEET };
