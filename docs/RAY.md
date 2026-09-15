# Meeting LiveMate · Installation

Download the latest ZIP, unzip, and double-click **修复并打开.command** (Install or repair). Existing settings and recordings are retained. If macOS blocks the file, verify its source and allow it in System Settings → Privacy & Security.

Select transcription and click **Save and continue**. On Apple Silicon, local transcription needs no speech key but does not separate speakers. Intel currently requires a cloud provider. Cloud options: [Volcano](https://console.volcengine.com/speech/app) (speech App Key + Access Key) or [Deepgram](https://console.deepgram.com/) (API key). Check trial eligibility and prices in your own console.

AI is optional for transcription. Live translation, key points, preliminary checks and summaries need your model API or a supported, signed-in local CLI. [DeepSeek API keys](https://platform.deepseek.com/api_keys). Other compatible endpoints go in advanced settings. CLI use consumes your account quota. Enter keys only on the local settings page, never in chat.

Record 30 seconds, check both sides have captions, stop and open Meeting history. Model tests do not test audio. Meeting data is stored locally; selected cloud services receive content for processing. Python is needed for post-meeting processing, not for opening the app. Keep your Mac awake while recording.

For AI-assisted installation, give your assistant [AI-SETUP.md](../AI-SETUP.md). [中文说明](../开始用.md).
