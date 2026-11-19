import { t } from './i18n.js';

// Audio input + analysis. Sources: demo synth (no permission needed), audio file, microphone, tab/system audio.

export const SPEC = 256;      // curve-mapped spectrum resolution (low frequencies get more bins)
const WAVE = 512;
const HIST = 128;      // frames of spectrum history (~2 s at 60 fps)

export class AudioIn {
  constructor() {
    this.ctx = null; this.an = null; this.node = null; this.el = null; this.stream = null;
    this.mode = 'demo';
    this.freq = null; this.time = null;
    this.spec = new Float32Array(SPEC);
    this.smooth = new Float32Array(SPEC);
    this.wave = new Float32Array(WAVE);
    this.history = Array.from({ length: HIST }, () => new Float32Array(SPEC));
    this.head = 0;
    this.bass = 0; this.mid = 0; this.treble = 0; this.level = 0; this.beat = 0;
    this.peak = 0.3; this.bassAvg = 0.1; this.lastBeat = 0;
    this.label = 'src.demo';
    this.bands = [14, 90];                       // bin edges of bass | mid | treble (draggable in the spectrum display)
    this.nodes = [];                             // response curve points: { x: 0..1 along the spectrum, g: log2 gain, w: width }
    this.resp = new Float32Array(SPEC).fill(1);  // gain per spectrum bin, derived from nodes
    this.react = { A: 0.04, R: 0.62, b: 0 };   // attack time, release time (to 2 %), release curve bend -1..1 (see setReact)
    this.setReact(0.04, 0.62, 0);
    this.sens = 1;          // input sensitivity (multiplies the auto-gain)
    this.beats = []; this.bpm = 0;
  }

  async _ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });   // matches the system-audio helper stream
      this.an = this.ctx.createAnalyser();
      this.mute = this.ctx.createGain(); this.mute.gain.value = 0;   // keeps the analyser pulled without playing anything
      this.an.connect(this.mute); this.mute.connect(this.ctx.destination);
      this.an.fftSize = 2048;
      this.an.smoothingTimeConstant = 0.6;
      this.freq = new Uint8Array(this.an.frequencyBinCount);
      this.time = new Uint8Array(this.an.fftSize);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  _disconnect() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    if (this.node) { try { this.node.disconnect(); } catch {} this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.el) { this.el.pause(); this.el.src = ''; this.el = null; }
    if (this.an && this.ctx) { try { this.an.disconnect(this.ctx.destination); } catch {} }
  }

  // silence: disconnect everything; the shapes settle to rest
  stop() { this._disconnect(); this.mode = 'off'; this.label = 'src.off'; }

  useDemo() { this._disconnect(); this.mode = 'demo'; this.label = 'src.demo'; }

  async useFile(file) {
    await this._ensure(); this._disconnect();
    const el = new Audio(); el.src = URL.createObjectURL(file); el.loop = true; el.crossOrigin = 'anonymous';
    this.el = el;
    this.node = this.ctx.createMediaElementSource(el);
    this.node.connect(this.an); this.an.connect(this.ctx.destination);
    await el.play();
    this.mode = 'live'; this.label = file.name;
  }

  async useMic(deviceId) {
    await this._ensure(); this._disconnect();
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.node = this.ctx.createMediaStreamSource(this.stream);
    this.node.connect(this.an);            // not routed to speakers -> no feedback
    this.mode = 'live';
    this.label = this.stream.getAudioTracks()[0]?.label || 'src.mic';
  }

  async inputDevices() {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  // System audio (Spotify, Music, any app) via the native helper: capture/aura-capture
  async useSystem() {
    await this._ensure(); this._disconnect();
    if (!this.workletReady) { await this.ctx.audioWorklet.addModule('src/pcm-worklet.js'); this.workletReady = true; }
    const connect = () => new Promise((resolve, reject) => {
      const w = new WebSocket('ws://127.0.0.1:4461');
      w.binaryType = 'arraybuffer';
      w.onopen = () => resolve(w);
      w.onerror = () => reject(new Error('no helper'));
    });
    let ws;
    try { ws = await connect(); }
    catch {
      // helper not running: ask the Aura server to start it (needs the server to be started from Terminal)
      let r;
      try { r = await (await fetch('/api/helper/start', { method: 'POST' })).json(); }
      catch { throw new Error(t('err.noStart')); }
      if (!r.ok) throw new Error(t('err.system') + r.message);
      for (let i = 0; i < 5 && !ws; i++) { try { ws = await connect(); } catch { await new Promise((res) => setTimeout(res, 250)); } }
      if (!ws) throw new Error(t('err.noContact'));
    }
    const node = new AudioWorkletNode(this.ctx, 'aura-pcm', { numberOfInputs: 0, outputChannelCount: [1] });
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {            // the helper reports problems (e.g. permission denied) as text
        this.useDemo(); this.onlost?.(t('err.system') + e.data.replace(/^error:\s*/, ''));
        return;
      }
      const f = new Float32Array(e.data); node.port.postMessage(f, [f.buffer]);
    };
    ws.onclose = () => { this.useDemo(); this.onlost?.(t('err.helperStopped')); };
    node.connect(this.an);
    this.ws = ws; this.node = node;
    this.mode = 'live'; this.label = 'src.system';
  }

  async useTab() {
    await this._ensure(); this._disconnect();
    // the picture is not used; ask for the smallest possible one and keep the track (stopping it can end the whole share)
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { width: 2, height: 2, frameRate: 1 }, audio: true });
    if (!s.getAudioTracks().length) { s.getTracks().forEach((tr) => tr.stop()); throw new Error(t('err.noTabAudio')); }
    const lost = () => { if (this.stream === s) { this.useDemo(); this.onlost?.(t('err.tabEnded')); } };   // "Stop sharing" in Chrome
    s.getTracks().forEach((tr) => { tr.onended = lost; });
    this.stream = s;
    this.node = this.ctx.createMediaStreamSource(s);
    this.node.connect(this.an);
    this.mode = 'live'; this.label = 'src.tab';
  }

  togglePause() { if (this.el) { this.el.paused ? this.el.play() : this.el.pause(); } }

  // fills this.spec / this.wave and band levels
  update(t, dtSec) {
    let raw;
    if (this.mode === 'off') {
      raw = this._zero || (this._zero = new Uint8Array(1024));
      this.wave.fill(0);
    } else if (this.mode === 'demo' || !this.an) {
      raw = this._synth(t);
    } else {
      this.an.getByteFrequencyData(this.freq);
      this.an.getByteTimeDomainData(this.time);
      raw = this.freq;
      for (let i = 0; i < WAVE; i++) this.wave[i] = (this.time[(i * (this.time.length / WAVE)) | 0] - 128) / 128;
    }
    const N = raw.length;
    // spectrum mapped on a curve so bass gets more resolution than treble
    let mx = 0;
    for (let i = 0; i < SPEC; i++) {
      const u = i / (SPEC - 1);
      const b = 1 + Math.pow(u, 2.2) * 0.55 * N;
      const i0 = Math.floor(b), f = b - i0;
      const v = (raw[i0] * (1 - f) + raw[Math.min(N - 1, i0 + 1)] * f) / 255;
      if (v > mx) mx = v;
      this.spec[i] = v;
    }
    // auto-gain so quiet sources still move
    this.peak = Math.max(this.peak * Math.pow(0.9, dtSec), mx, 0.25);
    const g = 0.95 / this.peak * this.sens;
    // attack / release smoothing (the Reaction curve) -> calm, readable motion instead of jitter
    for (let i = 0; i < SPEC; i++) this.smooth[i] = this.spec[i] = this._follow(this.smooth[i], Math.min(1, this.spec[i] * g), dtSec);
    for (let i = 0; i < SPEC; i++) this.spec[i] = Math.min(1, this.spec[i] * this.resp[i]);   // the user's response curve

    const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += this.spec[i]; return s / (b - a); };
    const k = (cur, nxt) => this._follow(cur, nxt, dtSec);
    const [e1, e2] = this.bands;
    this.bass = k(this.bass, band(0, e1));
    this.mid = k(this.mid, band(e1, e2));
    this.treble = k(this.treble, band(e2, SPEC));
    this.level = k(this.level, (this.bass + this.mid + this.treble) / 3 * 1.5);

    // simple beat detector on the bass band
    this.bassAvg += (this.bass - this.bassAvg) * Math.min(1, dtSec * 1.5);
    if (this.bass > this.bassAvg * 1.2 + 0.04 && t - this.lastBeat > 0.22) { this.beat = 1; this.lastBeat = t; this._bpm(t); }
    this.beat = Math.max(0, this.beat - dtSec * 3.5);
    if (this.bpm && t - this.lastBeat > 4) { this.bpm = 0; this.beats.length = 0; }   // no beats for a while: unknown

    this.head = (this.head + 1) % HIST;
    this.history[this.head].set(this.spec);
  }

  setNodes(nodes) {
    this.nodes = nodes;
    for (let i = 0; i < SPEC; i++) {
      const u = i / (SPEC - 1); let l = 0;
      for (const n of nodes) { const d = (u - n.x) / n.w; l += n.g * Math.exp(-0.5 * d * d); }
      this.resp[i] = Math.pow(2, l);
    }
  }
  // Attack: exponential rise, 95 % reached after A seconds.
  // Release: dd/dt = -d^m / tau for the distance d to the target, with m = 1 - b (b = 0: classic exponential fall,
  // b = 1: straight line, b < 0: long soft tail); tau is chosen so that d has fallen to 2 % after R seconds.
  setReact(A, R, b) {
    this.react = { A, R, b };
    this.tauA = A / 3; this.m = 1 - b;
    this.tauR = Math.abs(this.m - 1) < 1e-3 ? R / Math.log(50) : R * (1 - this.m) / (1 - Math.pow(0.02, 1 - this.m));
  }
  // one smoothing step: cur moves toward nxt, rising with the attack and falling with the release
  _follow(cur, nxt, dt) {
    if (nxt >= cur) return cur + (nxt - cur) * (1 - Math.exp(-dt / this.tauA));
    const d = cur - nxt, m = this.m;
    if (Math.abs(m - 1) < 1e-3) return nxt + d * Math.exp(-dt / this.tauR);
    const base = Math.pow(d, 1 - m) - (1 - m) * dt / this.tauR;
    return nxt + (base > 0 ? Math.pow(base, 1 / (1 - m)) : 0);
  }
  setBands(b1, b2) { this.bands = [b1, b2]; }

  // tempo estimate: median of the last beat intervals, folded into 70..180 BPM
  _bpm(t) {
    const b = this.beats; b.push(t); if (b.length > 10) b.shift();
    if (b.length < 3) return;
    const iv = []; for (let i = 1; i < b.length; i++) iv.push(b[i] - b[i - 1]);
    iv.sort((x, y) => x - y);
    let v = 60 / iv[iv.length >> 1];
    while (v < 70) v *= 2; while (v > 180) v /= 2;
    this.bpm = this.bpm ? this.bpm * 0.7 + v * 0.3 : v;
  }

  // ---- lookups used by expressions ----
  fft = (u) => {
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const p = u * (SPEC - 1), i = p | 0, f = p - i;
    return this.spec[i] * (1 - f) + this.spec[Math.min(SPEC - 1, i + 1)] * f;
  };
  waveAt = (u) => {
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const p = u * (WAVE - 1), i = p | 0, f = p - i;
    return this.wave[i] * (1 - f) + this.wave[Math.min(WAVE - 1, i + 1)] * f;
  };
  // spectrum d (0..1) of the way back through history
  histAt = (u, d) => {
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    const fr = this.history[(this.head - Math.round(d * (HIST - 1)) + HIST) % HIST];
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const p = u * (SPEC - 1), i = p | 0, f = p - i;
    return fr[i] * (1 - f) + fr[Math.min(SPEC - 1, i + 1)] * f;
  };

  _synth(t) {
    if (!this._sb) { this._sb = new Uint8Array(1024); }
    const a = this._sb, kick = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 2.0)), 10);
    const snare = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.0 + Math.PI)), 14);
    for (let i = 0; i < a.length; i++) {
      const bass = Math.exp(-i / 14) * (0.35 + 0.65 * kick);
      const mid = Math.exp(-Math.pow((i - 70 - 40 * Math.sin(t * 0.7)) / 55, 2)) * (0.35 + 0.35 * Math.sin(t * 1.3 + i * 0.07) ** 2 + 0.4 * snare);
      const hi = Math.exp(-Math.pow((i - 300) / 150, 2)) * (0.15 + 0.5 * snare + 0.15 * Math.sin(t * 9 + i));
      a[i] = Math.max(0, Math.min(255, 255 * (bass + mid * 0.8 + hi * 0.6)));
    }
    for (let i = 0; i < WAVE; i++) {
      const x = i / WAVE;
      this.wave[i] = 0.5 * Math.sin(x * 20 + t * 5) * (0.4 + kick) + 0.25 * Math.sin(x * 70 - t * 9) * (0.3 + snare);
    }
    return a;
  }
}

// Audio as received from the controller window (output window of a VJ setup): same lookups, no local analysis
export class RemoteAudio extends AudioIn {
  constructor() { super(); this.time = 0; this.camTime = 0; this.seen = false; }
  update() {}
  push(m) {
    this.spec.set(m.spec); this.wave.set(m.wave);
    this.bass = m.bass; this.mid = m.mid; this.treble = m.treble; this.level = m.level; this.beat = m.beat;
    this.head = (this.head + 1) % this.history.length;
    this.history[this.head].set(m.spec);
    this.time = m.time; this.camTime = m.camTime; this.seen = true;
  }
}
