# 分享与归档

在「本场 → 分享与归档」里选择：

- **归档至飞书**：保存转写全文和总结，确认仅自己可见并回读后显示文档链接。再次归档同一场会沿用同一文档，保留修订版本。
- **分享至 Slack**：选择频道，编辑预览，再点确认发送。发送成功才显示完成；网络断开导致结果不明时，先到频道核对，不盲目重发。
- **下载**：完整纪要 Markdown、逐字稿 Markdown、PDF 和复制仍保留。

飞书使用这台 Mac 上本人授权的 lark-cli。独立安装时由安装助手检查 `lark-cli auth status --json --verify`；按 docs、drive 范围授权。将验证返回的本人 openId 写入本机 settings.json 的 THT_ARCHIVE_OWNER_ID；如已有私有会议索引，把文档 token 写入 LARK_ARCHIVE_INDEX。不会自动把文档开放给同事。未配置索引时文档保存在本人云空间。

Slack 首次连接在「分享至 Slack」内完成。创建 Slack App，Bot scopes 仅需 chat:write、channels:read、groups:read，安装后在 Mac 的连接框填写 Bot User OAuth Token。将应用邀请到需要分享的频道，频道才出现在列表。无需聊天历史读取权限；凭据只保存在本机，不放进安装包，不与其他用户共用。手机沿用 Mac 上配置的连接，Mac 须在线。

飞书私有归档和 Slack 分享是两次独立动作。归档不会自动发送到频道，分享文字也不会改变飞书文档权限。
