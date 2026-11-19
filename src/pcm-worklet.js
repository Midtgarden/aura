// Plays mono float32 PCM chunks posted from the main thread (used for the system-audio helper stream).
class PCMStream extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.cur = null; this.pos = 0; this.queued = 0;
    this.port.onmessage = (e) => {
      this.q.push(e.data); this.queued += e.data.length;
      while (this.queued > 48000 * 0.4 && this.q.length > 1) this.queued -= this.q.shift().length;   // keep latency low
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.q.shift() || null; this.pos = 0;
        if (this.cur) this.queued -= this.cur.length;
      }
      out[i] = this.cur ? this.cur[this.pos++] : 0;
    }
    return true;
  }
}
registerProcessor('aura-pcm', PCMStream);
