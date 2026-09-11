'use strict';
// 一份源、两个仓库、中英同页。发布时自动注入版本号和下载链接，避免手工改三处漏一处。
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const man=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));
const V=pkg.version, ZIP=man.zip;
const dl=repo=>`https://github.com/${repo}/raw/main/${ZIP}`;

function render(repo){
  return `# 听会台 Meeting LiveMate · Mac

开会时它在旁边听着，实时出字幕、要点和待办；开完自动整理成纪要。跑在你自己的 Mac 上。

**当前版本 ${V}**

## 装它（一行命令，不用管什么隔离属性）

打开「终端」，粘这一行，回车：

\`\`\`bash
cd ~/Downloads && curl -fsSLO ${dl(repo)} && unzip -oq ${ZIP} -d 听会台 && bash 听会台/安装.command
\`\`\`

装完浏览器会自己打开设置页。以后每次用，双击「启动.command」。

## 要准备什么

**语音转文字**，三选一：火山语音（要注册，官方列了 20 小时免费额度，中文最准、能区分说话人）；本机转写（不用注册，用你 Mac 自带的语音识别，完全离线，分不出说话人）；Deepgram（邮箱注册即可，不要中国手机号，官方送额度，英文强）。

**谁来写总结**，三选一：你电脑上已装的 Codex 或 Claude Code（设置页会自动认出来，点一下就行，不用申请 Key）；DeepSeek API Key；你公司给的 OpenAI 兼容接口。

不想自己弄的话，设置页第 3 步有个「复制引导词」，把那段发给你自己的 ChatGPT 或 Claude，它会一步步带你配完。

## 更新

打开听会台，点右下角「检查更新」。装完不对可以在同一个地方退回上一版。

## 关于你的数据

会议记录、录音和记忆都存在你自己的 Mac 上。本地存储和编排，不做联网检索；内容是否离开本机，取决于你选的转写服务和模型服务。

---

# Meeting LiveMate for Mac

It listens while you meet: live captions, key points and action items, then a written summary when you stop. Everything runs on your own Mac.

**Current version ${V}**

## Install (one line, no quarantine dance)

Open Terminal, paste this, press return:

\`\`\`bash
cd ~/Downloads && curl -fsSLO ${dl(repo)} && unzip -oq ${ZIP} -d MeetingLiveMate && bash MeetingLiveMate/安装.command
\`\`\`

The setup page opens by itself. To use it later, double-click \`启动.command\`.

## What you need

**Speech to text**, pick one: on-device (no signup, uses the speech recognition built into macOS, fully offline, no speaker separation); Deepgram (email signup, free credit to start, strong on English); Volcano Engine (best for Chinese and separates speakers, but signup needs a Chinese account).

**Who writes the summary**, pick one: Codex or Claude Code already installed on your Mac (the setup page detects it, one click, no API key); a DeepSeek API key; any OpenAI-compatible endpoint your company gives you.

Step 3 of the setup page has a "copy the walkthrough" button. Paste that into your own ChatGPT or Claude and it will walk you through the whole thing.

## Updates

Open the app and click "检查更新" at the bottom right. You can roll back to the previous version from the same place.

## Your data

Meetings, recordings and memory stay on your Mac. Local storage and orchestration, no web lookups; whether content leaves your machine depends on the transcription and model services you pick.
`;
}
const out=process.argv[2];
if(out){ fs.writeFileSync(out, render(process.argv[3]||'CyberAiAaron/tinghuitai-desktop')); console.log('已生成', out); }
module.exports={render};
