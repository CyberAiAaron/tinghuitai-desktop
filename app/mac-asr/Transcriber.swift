// 本机转写（macOS 自带语音识别）。
// 为什么用 socket 而不是 stdin：TCC 把权限算在「负责进程」头上。被 node 直接 spawn 时
// 负责进程是 node，它的 Info.plist 没有语音用途说明，系统会直接 SIGABRT 掉这个进程
// （崩溃报告原文：attempted to access privacy-sensitive data without a usage description）。
// 必须用 open -a 经 LaunchServices 启动，让它自己当负责进程；那样就没法用管道，于是回连一个本地端口。
import Foundation
import Speech
import AVFoundation
import Network

let args = CommandLine.arguments
guard args.count >= 4, let port = UInt16(args[1]) else { exit(64) }
let token = args[2], localeId = args[3]
let ROTATE_SEC: TimeInterval = 12   // 苹果只在一段识别任务结束时给最终句，轮换快一点会中才有落地的整句

let conn = NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
let sendQ = DispatchQueue(label: "send")
func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    var line = d; line.append(0x0A)
    sendQ.async { conn.send(content: line, completion: .idempotent) }
}

final class Engine {
    let recognizer: SFSpeechRecognizer
    var req: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var startedAt = Date()
    var lastEmitted = ""
    let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let q = DispatchQueue(label: "asr")
    init?(_ id: String) {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: id)) else { return nil }
        recognizer = r
    }
    func start() {
        let r = SFSpeechAudioBufferRecognitionRequest()
        r.shouldReportPartialResults = true
        r.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        if #available(macOS 13.0, *) { r.addsPunctuation = true }
        req = r; startedAt = Date(); lastEmitted = ""
        task = recognizer.recognitionTask(with: r) { [weak self] res, err in
            guard let self = self else { return }
            if let res = res {
                let text = res.bestTranscription.formattedString
                if res.isFinal {
                    if !text.isEmpty { emit(["type": "final", "text": text]) }
                    if closing { DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { exit(0) } }
                    else { self.q.async { self.rotate() } }
                } else if text != self.lastEmitted {
                    self.lastEmitted = text
                    emit(["type": "partial", "text": text])
                }
            }
            if let err = err as NSError? {
                if err.code != 1110 && err.code != 216 { emit(["type": "note", "text": "\(err.code) \(err.localizedDescription)"]) }
                if closing { DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { exit(0) } }
                else { self.q.async { self.rotate() } }
            }
        }
    }
    func rotate() {
        if let t = task, t.state == .running || t.state == .starting { t.finish() }
        task = nil; req = nil; start()
    }
    func feed(_ data: Data) {
        if Date().timeIntervalSince(startedAt) > ROTATE_SEC { req?.endAudio(); return }
        let frames = AVAudioFrameCount(data.count / 2)
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return }
        buf.frameLength = frames
        data.withUnsafeBytes { raw in
            if let src = raw.baseAddress, let dst = buf.int16ChannelData?[0] { memcpy(dst, src, data.count) }
        }
        req?.append(buf)
    }
}

var engine: Engine?
var closing = false
func pump() {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, err in
        if let d = data, !d.isEmpty, let e = engine { e.q.async { e.feed(d) } }
        if done || err != nil {
            // 收尾：先 endAudio，等最后一句真的回来再退。0.4 秒退太早，最后一句会丢。
            closing = true
            engine?.q.async { engine?.req?.endAudio() }
            DispatchQueue.global().asyncAfter(deadline: .now() + 6) { exit(0) }
            return
        }
        pump()
    }
}

conn.stateUpdateHandler = { st in
    switch st {
    case .ready:
        sendQ.async { conn.send(content: (token + "\n").data(using: .utf8), completion: .idempotent) }
        SFSpeechRecognizer.requestAuthorization { auth in
            guard auth == .authorized else {
                emit(["type": "fatal", "text": "没有语音识别权限。到「系统设置 → 隐私与安全性 → 语音识别」里把「听会台转写」打开，再重开一场。"])
                usleep(500000); exit(0)
            }
            guard let e = Engine(localeId) else {
                emit(["type": "fatal", "text": "这台电脑不支持 \(localeId)"]); usleep(500000); exit(0)
            }
            engine = e
            emit(["type": "ready", "text": localeId, "onDevice": e.recognizer.supportsOnDeviceRecognition])
            e.start()
            pump()
        }
    case .failed, .cancelled:
        exit(0)
    default: break
    }
}
// 看门狗：15 秒还没连上就自己退出。留着不退会占住 bundle，下一次 open -a 直接报 -1712。
DispatchQueue.global().asyncAfter(deadline: .now() + 15) { if engine == nil { exit(0) } }
conn.start(queue: .global())
RunLoop.main.run()
