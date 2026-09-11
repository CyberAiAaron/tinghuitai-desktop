'use strict';
// Deepgram 流式转写：给不方便注册火山的人用（邮箱注册即可，官方送额度）。
// 协议：WebSocket 直传 16k 单声道 PCM，服务端回 JSON，is_final 为最终句。
const WebSocket = require('ws');
const LANG = { zh: 'zh-CN', en: 'en-US', id: 'id', pt: 'pt-BR', es: 'es' };

class DeepgramAsr {
  constructor(lang, key, onResult, log = () => {}) {
    this.lang = LANG[lang] || 'zh-CN'; this.key = key; this.onResult = onResult; this.log = log;
    this.ws = null; this.dead = false; this.retries = 0; this.queue = []; this.queued = 0; this.droppedBytes = 0;
  }
  start() {
    if (this.dead) return;
    if (this.ws) { try { this.ws.removeAllListeners(); this.ws.close(); } catch (e) {} this.ws = null; }   // 防重入：旧连接还开着会导致转写重复落稿
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (!this.key) { this.onResult({ type: 'fatal', text: 'Deepgram 的 Key 没填。' }); return; }
    const p = new URLSearchParams({
      model: 'nova-3', language: this.lang, encoding: 'linear16', sample_rate: '16000',
      channels: '1', punctuate: 'true', smart_format: 'true', interim_results: 'true', endpointing: '800',
    });
    let ws;
    try { ws = new WebSocket('wss://api.deepgram.com/v1/listen?' + p, { headers: { Authorization: 'Token ' + this.key } }); }
    catch (e) { this.onResult({ type: 'fatal', text: 'Deepgram 连不上：' + e.message }); return; }
    this.ws = ws;
    ws.on('open', () => { this.log('Deepgram 已连上 ' + this.lang); this.flush(); });   // 重试计数不在这里清零：连上就被拒的场景会变成无限重连
    ws.on('message', d => {
      let j; try { j = JSON.parse(d.toString()); } catch (e) { return; }
      if (j.type === 'Error' || j.error) {
        const msg = String(j.error || j.description || j.message || '').slice(0, 160);
        // 只有鉴权和额度类才是永久的；限流、瞬时网络错误要留着重连，否则一帧就断送整场
        const permanent = /unauthor|forbidden|invalid.*key|quota|credit|payment|suspend/i.test(msg);
        if (permanent) { this.dead = true; try { ws.close(); } catch (e) {} this.onResult({ type: 'fatal', text: 'Deepgram 拒绝了这次请求：' + msg }); }
        else { this.log('Deepgram 可恢复错误，重连：' + msg); try { ws.close(); } catch (e) {} }
        return;
      }
      const alt = j.channel && j.channel.alternatives && j.channel.alternatives[0];
      const text = (alt && alt.transcript || '').trim();
      if (!text) return;
      this.retries = 0;                      // 真收到转写才算这条连接是好的；只在 open 清零会让「连上即被拒」变成无限重连
      this.onResult({ type: j.is_final ? 'final' : 'partial', text });
    });
    ws.on('close', (code) => {
      this.ws = null;
      if (this.dead) return;
      if (code === 1008 || code === 4001 || code === 401) { this.onResult({ type: 'fatal', text: 'Deepgram 拒绝了这个 Key，请检查。' }); this.dead = true; return; }
      if (this.retries++ < 5) { this.log('Deepgram 断开（' + code + '），重连第 ' + this.retries + ' 次'); this.retryTimer = setTimeout(() => this.start(), 800 * this.retries); }
      else this.onResult({ type: 'fatal', text: 'Deepgram 反复断开，已停止重试。' });
    });
    ws.on('error', e => {
      const m = String(e && e.message || '');
      this.log('Deepgram 错误 ' + m);
      // Key 不对时 ws 库给的是 error 事件里的 401/403，close code 是 1006；
      // 只判 close code 永远等不到，用户会被误导成「反复断开」。
      if (/\b40[13]\b/.test(m)) { this.dead = true; this.onResult({ type: 'fatal', text: 'Deepgram 拒绝了这个 Key，请到设置页检查。' }); }
    });
  }
  flush() { const q = this.queue; this.queue = []; this.queued = 0; for (const b of q) this.write(b); }
  write(pcm) {
    const w = this.ws;
    if (w && w.readyState === WebSocket.OPEN) { try { w.send(pcm); } catch (e) { this.log('Deepgram 发送失败 ' + e.message); } return; }
    if (this.dead) return;
    // TypedArray 直接 Buffer.from 会逐元素 &0xFF，把 16 位样本截成 8 位，重连后那几秒全是乱码
    const buf = Buffer.isBuffer(pcm) ? pcm
      : (ArrayBuffer.isView(pcm) ? Buffer.from(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)) : Buffer.from(pcm));   // 真拷贝：排队的音频不能跟上游共享内存
    this.queue.push(buf); this.queued += buf.length;
    // 必须先判队列非空：pcm 可能是 TypedArray，length 与字节数不同，计数会和实际长度脱节，
    // shift() 返回 undefined 再读 .length 会直接打断录音路径。
    while (this.queue.length && this.queued > 32000 * 20) { const b = this.queue.shift(); this.queued -= (b ? b.length : 0); this.droppedBytes += (b ? b.length : 0); }
    if (!this.queue.length) this.queued = 0;
  }
  drain(ms = 6000) {
    return new Promise(res => {
      this.dead = true;
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      const w = this.ws;
      if (!w) return res();
      if (w.readyState === WebSocket.CONNECTING) { w.once('open', () => { try { w.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) {} }); }
      else if (w.readyState !== WebSocket.OPEN) { try { w.close(); } catch (e) {} return res(); }
      let done = false, timer = null;
      const fin = () => { if (done) return; done = true; if (timer) clearTimeout(timer); try { w.close(); } catch (e) {} res(); };
      w.once('close', fin); timer = setTimeout(fin, ms);
      try { w.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) { fin(); }   // 让它把最后一句吐完
    });
  }
  stop() { this.dead = true; if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; } try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; }
}
module.exports = { DeepgramAsr, LANG };
