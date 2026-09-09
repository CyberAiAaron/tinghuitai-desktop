# Meeting LiveMate 0.2.0 候选版本

对应个人网页 v5.3。尚未上传 GitHub，尚未完成 Claude 最终审核。

新增 My AI 助手（名称随已配置模型）、受限纠错与撤销、PCM 音量反馈；合并线上/线下入口；EN 中文会议译文与英文总结；异常重复原文折叠保留；说话人 speaker_id 兼容；续会回传服务器快照，移除浏览器 20 分钟强制结束。

退出页面会停止采音。10 分钟内重新打开，点继续可续同一场；超过服务端宽限会自动归档，需要新开。关闭期间不补造音频。测试包含真实本机 WebSocket 关闭重连，同一 ID/start 和录音追加验证；不是物理麦克风或手机锁屏验收。

安装升级前结束会议并退出旧服务；解压到新目录，运行安装.command，再运行启动.command。设置和档案位于 ~/Library/Application Support/Tinghuitai，不删除该目录。不支持自动更新推送。

仍需个人火山 ASR 和模型 API。支持 OpenAI-compatible 模型 API；原生 Anthropic API 在独立版未验收，不承诺 Claude 订阅可接入。离线识别模型不捆绑；默认归档本机，不接 Aaron 的资料。
