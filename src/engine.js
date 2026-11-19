// WebGL2 renderer. Shape expressions are evaluated on the CPU into a grid (rows x points), projected
// through a camera, and drawn as thin anti-aliased ribbons (rows = lines along s, "across" = lines through the rows).
// An optional feedback buffer gives soft trails; with decay 0 the image is crisp and clean.
import { PROF, compile, hsv, TEXT } from './expr.js';

const VS_DRAW = `#version 300 es
in vec2 p; in vec4 c; in float e; out vec4 vc; out float ve;
void main(){ vc = c; ve = e; gl_Position = vec4(p, 0., 1.); }`;
const FS_DRAW = `#version 300 es
precision highp float; in vec4 vc; in float ve; out vec4 o;
void main(){
  float a = 1. - smoothstep(.35, 1., abs(ve));
  o = vec4(vc.rgb * vc.a * a, 1.);
}`;

const VS_FULL = `#version 300 es
out vec2 uv;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); uv = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

const FS_FEEDBACK = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D uTex; uniform float uAspect, uZoom, uRot, uDecay; uniform vec2 uShift;
out vec4 o;
void main(){
  vec2 q = uv - .5; q.x *= uAspect;
  float cs = cos(uRot), sn = sin(uRot);
  q = mat2(cs, -sn, sn, cs) * q / uZoom;
  q.x /= uAspect; q += .5 + uShift;
  vec3 c = texture(uTex, q).rgb * uDecay - 1./255.;
  o = vec4(max(c, 0.), 1.);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D uTex; uniform float uAspect, uTime, uBright, uBeat, uSoft, uGlow, uMirror, uFlash, uSplit, uShift; uniform int uType; uniform vec3 uC1, uC2; uniform vec2 uPx;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 q = uv - .5; q.x *= uAspect;
  float r = length(q);
  vec3 bg;
  if (uType == 0) {            // calm radial gradient
    bg = mix(uC1, uC2, smoothstep(0., .8, r)) * (1.05 - r) * .6;
  } else if (uType == 4) {     // vertical gradient
    bg = mix(uC1, uC2, uv.y) * .5;
  } else {                     // aurora ribbons
    float y = uv.y;
    float w = n(vec2(uv.x * 2.5 + uTime * .05, uTime * .06));
    float band = smoothstep(.0, .5, 1. - abs(y - (.42 + .3*w)) * 2.4);
    float w2 = n(vec2(uv.x * 4. - uTime * .06, 3.4 + uTime * .05));
    float band2 = smoothstep(.0, .4, 1. - abs(y - (.55 + .25*w2)) * 3.);
    bg = (uC1 * band + uC2 * band2) * .45 + vec3(.005, .008, .018);
  }
  bg *= uBright * (1. + uBeat * .12);
  // kaleidoscope: fold the picture into N mirrored wedges around the centre
  vec2 suv = uv;
  if (uMirror > 1.5) {
    float seg = 6.2831853 / uMirror, a = atan(q.y, q.x) + 3.1415927;   // uMirror = number of wedges (even)
    a = abs(mod(a, 2. * seg) - seg);
    vec2 f = vec2(cos(a), sin(a)) * r; f.x /= uAspect; suv = f + .5;
  }
  vec3 sc = texture(uTex, suv).rgb;
  if (uSplit > .001) {         // colour split on the beat: red and blue slide apart
    vec2 off = (suv - .5) * uSplit * uBeat * .08;
    sc = vec3(texture(uTex, suv + off).r, sc.g, texture(uTex, suv - off).b);
  }
  if (uGlow > .001) {          // cheap bloom: two rings of taps around each pixel
    vec3 g = vec3(0.);
    for (int i = 0; i < 12; i++) {
      float an = float(i) * .5235988;
      vec2 d = vec2(cos(an), sin(an));
      g += texture(uTex, suv + d * uPx * 5.).rgb * .6 + texture(uTex, suv + d * uPx * 13.).rgb * .4;
    }
    sc += g / 12. * uGlow * 1.6;
  }
  if (uShift > .001) {         // hue shift on the beat (rotation around the grey axis)
    float a = uShift * uBeat * 2.4, cs = cos(a); vec3 k = vec3(.57735);
    sc = sc * cs + cross(k, sc) * sin(a) + k * dot(k, sc) * (1. - cs);
  }
  vec3 lines = uSoft > .5 ? 1. - exp(-sc * 1.4) : min(sc, 1.);
  lines *= 1. + uFlash * uBeat * 1.6;   // brightness flash on the beat
  vec3 col = bg + lines * (1. - bg * .5);
  col *= 1. - .35 * smoothstep(.5, 1.1, r);   // soft vignette
  o = vec4(col, 1.);
}`;

function mkProgram(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const HIST_FRAMES = 127;

export class Engine {
  constructor(canvas, audio) {
    this.canvas = canvas; this.audio = audio;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 støttes ikke i denne nettleseren');
    this.draw = mkProgram(gl, VS_DRAW, FS_DRAW);
    this.fb = mkProgram(gl, VS_FULL, FS_FEEDBACK);
    this.comp = mkProgram(gl, VS_FULL, FS_COMPOSITE);
    this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const loc = (n) => gl.getAttribLocation(this.draw.p, n);
    gl.enableVertexAttribArray(loc('p')); gl.vertexAttribPointer(loc('p'), 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(loc('c')); gl.vertexAttribPointer(loc('c'), 4, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(loc('e')); gl.vertexAttribPointer(loc('e'), 1, gl.FLOAT, false, 28, 24);
    this.emptyVao = gl.createVertexArray();
    this.targets = []; this.cur = 0;
    this.out = new Float32Array(12); this.tmo = new Float32Array(2); this.col = new Float32Array(4); this.rgb = new Float32Array(3);
    this.buf = new Float32Array(0); this.grid = { n: 0 };
    this.runs = []; this.runIdx = new Int32Array(4096);
    this.shape = null; this.color = null; this.bg = null;
    this.time = 0; this.camTime = 0; this.speed = 1; this.fps = 60;
    this.user = { yaw: 0, pitch: 0, zoom: 1 };
    this.path = { yaw: 0, pitch: 0, zoom: 0 };       // offsets from the camera path editor, added on top of the user's own camera
    this.eff = { yaw: 0, pitch: 0, zoom: 1 };
    // look controls from the UI: trail = fade time in s (0 = the background decides), swirl / tunnel = feedback rotation / zoom, detail = line density, line = thickness, glow, mirror = wedges (1 = off)
    this.fx = { trail: 0, swirl: 0, tunnel: 0, detail: 1, line: 1, glow: 0, mirror: 1,
      kick: 0, flash: 0, split: 0, shift: 0 };   // beat effects: camera punch, brightness flash, colour split, hue shift (strength on every beat)
    this.resize();
  }

  // ---- preset loading ----
  setShape(d) {
    this.shape = {
      def: d,
      pt: compile(d.defs || [], [d.x, d.y, d.z, d.alpha || '1'], 'shape'),
      tm: compile([], [d.tmap || '0'], 'tmap'),
      cam: compile([], [...d.cam.pos, ...d.cam.look, ...(d.cam.up || ['0', '0', '1'])], 'camera'),
    };
  }
  setColor(def) { this.color = compile([], [def.h, def.s, def.v, def.a], 'color'); }
  setBackground(def) {
    this.bg = { def, fn: compile([], [def.hue, def.hue2, def.bright, def.zoom, def.rot, def.dx, def.dy, def.decay], 'background') };
  }

  resize() {
    const gl = this.gl, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.canvas.width = this.w = w; this.canvas.height = this.h = h; this.dpr = dpr;
    for (const t of this.targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    this.targets = [0, 1].map(() => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo };
    });
  }

  frame(dtSec) {
    const gl = this.gl, A = this.audio;
    this.time += dtSec; this.camTime += dtSec * this.speed;
    this.fps += (1 / Math.max(dtSec, 1e-3) - this.fps) * 0.05;
    const t = this.time;
    this.resize();
    A.update(t, dtSec);

    const bo = this.out;
    this.bg.fn(0, 0, t, A.bass, A.mid, A.treble, A.level, A.beat, A.fft, A.waveAt, A.histAt, 0, bo);
    const [hue, hue2, bright, zoom0, rot0, dx, dy, decay0] = bo;
    const F = this.fx, f60 = Math.min(3, Math.max(0.05, dtSec * 60));
    const zoom = zoom0 * (1 + F.tunnel * 0.02 * f60), rot = rot0 + F.swirl * 0.015 * f60;
    const decay = F.trail > 0 ? Math.pow(0.05, Math.max(dtSec, 1e-3) / F.trail) : decay0;   // user trail: image fades to 5 % after F.trail seconds

    // 1. feedback pass (previous frame -> next, faded). With decay 0 this simply clears.
    const prev = this.targets[this.cur], next = this.targets[1 - this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.fb.p); gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    const u = this.fb.u;
    gl.uniform1i(u.uTex, 0); gl.uniform1f(u.uAspect, this.w / this.h);
    gl.uniform1f(u.uZoom, zoom); gl.uniform1f(u.uRot, rot); gl.uniform1f(u.uDecay, decay);
    gl.uniform2f(u.uShift, dx, dy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. shape
    this.drawShape(t, A);

    // 3. composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.comp.p); gl.bindVertexArray(this.emptyVao);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    const c = this.comp.u;
    hsv(hue, 0.75, 1, this.rgb);  gl.uniform3fv(c.uC1, this.rgb);
    hsv(hue2, 0.75, 1, this.rgb); gl.uniform3fv(c.uC2, this.rgb);
    gl.uniform1i(c.uTex, 0); gl.uniform1f(c.uAspect, this.w / this.h); gl.uniform1f(c.uTime, t);
    gl.uniform1f(c.uBright, bright); gl.uniform1f(c.uBeat, A.beat); gl.uniform1i(c.uType, this.bg.def.type);
    gl.uniform1f(c.uSoft, F.trail <= 0 && decay0 > 0.3 ? 1 : 0);
    gl.uniform1f(c.uGlow, F.glow); gl.uniform1f(c.uFlash, F.flash); gl.uniform1f(c.uSplit, F.split); gl.uniform1f(c.uShift, F.shift); gl.uniform1f(c.uMirror, Math.round(F.mirror)); gl.uniform2f(c.uPx, 1 / this.w, 1 / this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.cur = 1 - this.cur;
  }

  drawShape(t, A) {
    const gl = this.gl, S = this.shape, d = S.def, o = this.out, col = this.col, rgb = this.rgb;
    const kd = this.fx.detail, rows = Math.max(4, Math.round(d.rows * kd)), pts = d.pts === 'text' ? TEXT.n : Math.max(8, Math.round(d.pts * kd)), nInst = d.instances || 1;
    if (pts < 2) return;
    const W = this.w, H = this.h, grid = rows * pts;
    const colStep = d.across ? Math.max(1, Math.round(d.across * kd)) : 0;
    const nCols = colStep ? Math.floor((pts - 1) / colStep) + 1 : 0;

    const G = this.grid;
    if (G.n < grid) { G.n = grid; G.x = new Float32Array(grid); G.y = new Float32Array(grid); G.ok = new Uint8Array(grid);
      G.r = new Float32Array(grid); G.g = new Float32Array(grid); G.b = new Float32Array(grid); G.a = new Float32Array(grid); }
    const maxVerts = nInst * (rows * pts * 2 + nCols * rows * 2);
    if (this.buf.length < maxVerts * 7) this.buf = new Float32Array(maxVerts * 7);
    if (this.runIdx.length < Math.max(rows, pts)) this.runIdx = new Int32Array(Math.max(rows, pts));
    const buf = this.buf, run = this.runIdx, draws = this.runs; draws.length = 0;
    let vcount = 0;

    // camera
    const bass = A.bass, mid = A.mid, treble = A.treble, level = A.level, beat = A.beat;
    S.cam(0, 0, this.camTime, bass, mid, treble, level, beat, A.fft, A.waveAt, A.histAt, 0, o);
    // user camera: drag = orbit around the look-at point (yaw/pitch), wheel = zoom
    const lx = o[3], ly = o[4], lz = o[5], U = this.eff, Us = this.user, Pp = this.path;
    U.yaw = Us.yaw + Pp.yaw; U.pitch = Math.max(-1.3, Math.min(1.3, Us.pitch + Pp.pitch)); U.zoom = Math.max(-0.7, Math.min(3, Us.zoom + Pp.zoom - this.fx.kick * A.beat * 0.22));   // kick: the camera punches in on every beat
    let vx = o[0] - lx, vy = o[1] - ly, vz = o[2] - lz;
    { const c = Math.cos(U.yaw), s = Math.sin(U.yaw); const nx = vx * c - vy * s; vy = vx * s + vy * c; vx = nx; }
    { const h = Math.hypot(vx, vy) || 1e-6;
      const ang = Math.max(-1.45, Math.min(1.45, Math.atan2(vz, h) + U.pitch));
      const rad = Math.hypot(h, vz), nh = rad * Math.cos(ang);
      vx *= nh / h; vy *= nh / h; vz = rad * Math.sin(ang); }
    // dolly: the camera slides along the view axis; the view direction stays fixed, so zoom can pass through the
    // look-at point and come out the other side (zoom < 0)
    const cx = lx + vx * U.zoom, cy = ly + vy * U.zoom, cz = lz + vz * U.zoom;
    let fx = -vx, fy = -vy, fz = -vz;
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let upx = o[6], upy = o[7], upz = o[8];
    let rx = fy * upz - fz * upy, ry = fz * upx - fx * upz, rz = fx * upy - fy * upx;
    l = Math.hypot(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const fl = 1 / Math.tan((d.fov || 55) * Math.PI / 360), aspect = W / H;

    const dfade = d.dfade;
    const hw = (d.width || 1.4) * this.fx.line * this.dpr * 0.5;   // half line width in device px
    const kx = hw * 2 / W, ky = hw * 2 / H;

    const flush = (n) => {
      if (n >= 2) {
        const first = vcount;
        for (let j = 0; j < n; j++) {
          const p = run[j], a0 = run[j > 0 ? j - 1 : 0], a1 = run[j < n - 1 ? j + 1 : n - 1];
          let tx = (G.x[a1] - G.x[a0]) * W * 0.5, ty = (G.y[a1] - G.y[a0]) * H * 0.5;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const nx = -ty * kx, ny = tx * ky;
          for (let sgn = 1; sgn >= -1; sgn -= 2) {
            buf[vcount * 7] = G.x[p] + nx * sgn; buf[vcount * 7 + 1] = G.y[p] + ny * sgn;
            buf[vcount * 7 + 2] = G.r[p]; buf[vcount * 7 + 3] = G.g[p]; buf[vcount * 7 + 4] = G.b[p]; buf[vcount * 7 + 5] = G.a[p];
            buf[vcount * 7 + 6] = sgn; vcount++;
          }
        }
        draws.push(first, vcount - first);
      }
    };
    const strip = (start, step, n) => {
      let m = 0;
      for (let k = 0; k < n; k++) {
        const idx = start + k * step;
        if (G.ok[idx]) run[m++] = idx; else { flush(m); m = 0; }
      }
      flush(m);
    };

    // shape profile: sideways scale (2^curve) along the rows or along the line; "pulse" lets the music swell it
    const profOn = PROF.on, PM = this.profM || (this.profM = new Float32Array(257)), ax = this.shape.def.axis === 'x';
    if (profOn) { const kk = PROF.pulse ? 0.4 + 1.2 * level : 1; for (let i = 0; i < 257; i++) PM[i] = Math.pow(2, PROF.p[i] * kk); }
    for (let inst = 0; inst < nInst; inst++) {
      for (let r = 0; r < rows; r++) {
        const dt = rows > 1 ? r / (rows - 1) : 0;
        // each row reads the spectrum from slightly earlier in time (TMap) -> motion ripples along the rows
        S.tm(0, dt, t, bass, mid, treble, level, beat, A.fft, A.waveAt, A.histAt, inst, this.tmo);
        const delay = Math.min(1, Math.max(0, this.tmo[0] * this.fps / HIST_FRAMES));
        const fftRow = delay > 0.0005 ? (u) => A.histAt(u, delay) : A.fft;
        for (let i = 0; i < pts; i++) {
          const s = pts > 1 ? i / (pts - 1) : 0, g = r * pts + i;
          S.pt(s, dt, t, bass, mid, treble, level, beat, fftRow, A.waveAt, A.histAt, inst, o);
          if (profOn) { const m = PM[Math.round((PROF.line ? s : dt) * 256)]; if (ax) { o[1] *= m; o[2] *= m; } else { o[0] *= m; o[1] *= m; } }
          this.color(s, dt, t, bass, mid, treble, level, beat, fftRow, A.waveAt, A.histAt, inst, col);
          const px = o[0] - cx, py = o[1] - cy, pz = o[2] - cz;
          const depth = px * fx + py * fy + pz * fz;
          if (depth > 0.3 && o[3] >= 0) {     // negative alpha = pen-up point (breaks the line)
            G.ok[g] = 1;
            G.x[g] = (px * rx + py * ry + pz * rz) * fl / (depth * aspect);
            G.y[g] = (px * ux + py * uy + pz * uz) * fl / depth;
            hsv(col[0], col[1], col[2], rgb);
            G.r[g] = rgb[0]; G.g[g] = rgb[1]; G.b[g] = rgb[2];
            let al = col[3] * o[3];
            if (dfade) { const k = Math.min(1, Math.max(0, (depth - dfade[0]) / (dfade[1] - dfade[0]))); al *= 1 - 0.85 * k; }   // far side dimmer
            G.a[g] = Math.min(1, Math.max(0, al));
          } else G.ok[g] = 0;
        }
      }
      for (let r = 0; r < rows; r++) strip(r * pts, 1, pts);                       // lines along s
      for (let c = 0; c < nCols; c++) strip(Math.min(pts - 1, c * colStep), pts, rows); // lines across rows
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1 - this.cur].fbo);
    gl.useProgram(this.draw.p); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW, 0, vcount * 7);
    // user trails: keep the brightest value instead of adding up, so a still shape does not burn out to white while moving lines leave fading trails
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(this.fx.trail > 0 ? gl.MAX : gl.FUNC_ADD);
    for (let i = 0; i < draws.length; i += 2) gl.drawArrays(gl.TRIANGLE_STRIP, draws[i], draws[i + 1]);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  }
}
