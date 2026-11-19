// Expression compiler: turns text expressions from presets into fast JS functions.
// Presets are data (JSON), so shapes / colours / backgrounds can be added without touching the engine.

export const PARAMS = ['s', 'dt', 't', 'bass', 'mid', 'treble', 'level', 'beat', 'fft', 'wave', 'hist', 'inst'];

const fract = (x) => x - Math.floor(x);
const hash = (x) => fract(Math.sin(x * 127.1 + 311.7) * 43758.5453);

// outline of the user's text (set from text.js); tx/ty = position along the outline, tb = 1 at pen-up gap points
export const TEXT = { n: 0, x: new Float32Array(2), y: new Float32Array(2), b: new Uint8Array(2) };
export function setTextPath(p) { TEXT.n = p.n; TEXT.x = p.x; TEXT.y = p.y; TEXT.b = p.b; }
const ti = (s) => Math.min(TEXT.n - 1, Math.max(0, Math.round(s * (TEXT.n - 1))));

// global "looseness" knob (0..1) from the UI: how fluid / flowing the shapes are
export const LOOSE = { v: 0.6 };

// user colour ramp (from rampedit.js): lookup tables for hue / saturation / value along the ramp (x = 0..1)
export const RAMP = { h: new Float32Array(256), s: new Float32Array(256), v: new Float32Array(256) };
const ri = (x) => (x <= 0 || x !== x ? 0 : x >= 1 ? 255 : Math.round(x * 255));
export function setRamp(stops) {   // stops: [{ x: 0..1, r, g, b (0..1) }] sorted by x
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let k = 0;
    while (k < stops.length - 2 && x > stops[k + 1].x) k++;
    const a = stops[k], b = stops[k + 1], f = b.x - a.x < 1e-6 ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
    const r = a.r + (b.r - a.r) * f, g = a.g + (b.g - a.g) * f, bl = a.b + (b.b - a.b) * f;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    let h = 0;
    if (d > 1e-6) h = mx === r ? ((g - bl) / d + 6) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    RAMP.h[i] = h / 6; RAMP.s[i] = mx < 1e-6 ? 0 : d / mx; RAMP.v[i] = mx;
  }
}
setRamp([{ x: 0, r: 1, g: .17, b: .84 }, { x: .5, r: .42, g: .24, b: 1 }, { x: 1, r: 0, g: .9, b: 1 }]);

// user shape profile (from profedit.js): scales the shape sideways along its length / around its line.
// p = curve values -1..1 sampled at 257 points; applied by the engine as x2 .. /2
export const PROF = { on: false, line: false, pulse: false, p: new Float32Array(257) };

export const LIB = {
  rh: (x) => RAMP.h[ri(x)], rs: (x) => RAMP.s[ri(x)], rv: (x) => RAMP.v[ri(x)],
  loose: () => LOOSE.v,
  tx: (s) => TEXT.x[ti(s)], ty: (s) => TEXT.y[ti(s)], tb: (s) => TEXT.b[ti(s)],
  PI: Math.PI,
  TAU: Math.PI * 2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, log: Math.log, pow: Math.pow,
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  fract,
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  mix: (a, b, k) => a + (b - a) * k,
  step: (e, x) => (x < e ? 0 : 1),
  smoothstep: (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); },
  // triangle wave folding (period 2, range 0..1): mirrors instead of wrapping
  trwv: (x) => { x = ((x % 2) + 2) % 2; return x < 1 ? x : 2 - x; },
  // Bessel function of the first kind J_m(x), integer m (midpoint rule on the integral form; very accurate for periodic integrands)
  besj: (m, x) => { let a = 0; for (let k = 0; k < 14; k++) { const u = (k + 0.5) * Math.PI / 14; a += Math.cos(m * u - x * Math.sin(u)); } return a / 14; },
  g: (x, w) => Math.exp(-(x / w) * (x / w)),   // gaussian bump: 1 at x=0, width w
  saw: (x) => fract(x),
  sqr: (x) => (fract(x) < 0.5 ? 0 : 1),
  noise: (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; },
};

const SAFE_CHARS = /^[0-9A-Za-z_+\-*/%^().,<>=!?:&| \t\r\n]*$/;
const NO_PROP = /[A-Za-z_)\]]\s*\./; // forbid member access like a.b

export function compile(defs, outs, label = 'expr') {
  const allowed = new Set([...PARAMS, ...Object.keys(LIB)]);
  const check = (src, where) => {
    src = String(src);
    if (!SAFE_CHARS.test(src) || NO_PROP.test(src)) throw new Error(`${label}: illegal characters in ${where}: ${src}`);
    for (const id of src.match(/[A-Za-z_]\w*/g) || []) {
      if (!allowed.has(id)) throw new Error(`${label}: unknown name "${id}" in ${where}`);
    }
    return src.replace(/\^/g, '**');
  };
  let body = '';
  for (const [name, expr] of defs) {
    if (!/^[A-Za-z_]\w*$/.test(name) || allowed.has(name)) throw new Error(`${label}: bad variable name "${name}"`);
    body += `const ${name} = (${check(expr, name)});\n`;
    allowed.add(name);
  }
  outs.forEach((e, i) => { body += `out[${i}] = (${check(e, 'out' + i)});\n`; });
  const maker = new Function('L', `const {${Object.keys(LIB).join(',')}} = L;\nreturn function(${PARAMS.join(',')}, out) {\n${body}};`);
  return maker(LIB);
}

export function hsv(h, s, v, out, o = 0) {
  h = fract(h); s = Math.min(1, Math.max(0, s)); v = Math.max(0, v);
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: out[o] = v; out[o + 1] = t; out[o + 2] = p; break;
    case 1: out[o] = q; out[o + 1] = v; out[o + 2] = p; break;
    case 2: out[o] = p; out[o + 1] = v; out[o + 2] = t; break;
    case 3: out[o] = p; out[o + 1] = q; out[o + 2] = v; break;
    case 4: out[o] = t; out[o + 1] = p; out[o + 2] = v; break;
    default: out[o] = v; out[o + 1] = p; out[o + 2] = q;
  }
}
