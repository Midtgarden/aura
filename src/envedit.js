// Reaction curve: how fast the shapes jump up (attack) and settle back (release), drawn like a synth envelope.
// Left zone = attack time (0..400 ms), right zone = release (0..2 s). Each zone has its own time axis.
//  - drag the left point sideways: attack     - drag the lower right point sideways: release time
//  - drag the middle right point up/down: bend the release (straight line .. long soft tail)
//  - Shift: fine, double-click a point: back to its default
// The drawn curves are exactly what the audio smoothing does to every spectrum bin and to bass / mid / treble.
import { t } from './i18n.js';

const AMAX = 0.4, RMAX = 2.0, AMIN = 0.005, RMIN = 0.03;
const DEF = { A: 0.04, R: 0.62, b: 0 };
const SPLIT = 0.36, PAD = 8, TOP = 16, LAB = 11, HIT = 9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ms = (s) => (s >= 1 ? s.toFixed(2) + 'S' : Math.round(s * 1000) + 'MS');

export function initEnvEdit(canvas, audio) {
  const c = canvas.getContext('2d');
  let p = { ...DEF }, hover = null, drag = null;
  const load = () => {
    p = { ...DEF };
    try { const s = JSON.parse(localStorage.getItem('aura.react') || 'null'); if (s && isFinite(s.A + s.R + s.b)) p = { A: clamp(s.A, AMIN, AMAX), R: clamp(s.R, RMIN, RMAX), b: clamp(s.b, -1, 1) }; } catch { /* ignore */ }
  };
  load();
  const commit = (save = true) => {
    audio.setReact(p.A, p.R, p.b);
    if (save) try { localStorage.setItem('aura.react', JSON.stringify(p)); } catch { /* ignore */ }
  };
  commit(false);

  const geo = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight, base = h - LAB, x1 = SPLIT * w;
    return { w, h, base, x1, aw: x1 - PAD * 2, rw: w - x1 - PAD * 2 };
  };
  const relAt = (tt) => {   // release curve value (1 -> 0) after tt seconds, same math as AudioIn._follow
    const m = audio.m, tau = audio.tauR;
    if (Math.abs(m - 1) < 1e-3) return Math.exp(-tt / tau);
    const base = 1 - (1 - m) * tt / tau;
    return base > 0 ? Math.pow(base, 1 / (1 - m)) : 0;
  };
  const pts = () => {
    const g = geo(), y1 = TOP, y0 = g.base, x0 = g.x1 + PAD;
    const tm = p.R * 0.3;
    return {
      a: { x: PAD + (p.A / AMAX) * g.aw, y: y1 },
      r: { x: x0 + (p.R / RMAX) * g.rw, y: y0 },
      c: { x: x0 + (tm / RMAX) * g.rw, y: y0 - relAt(tm) * (y0 - y1) },
      x0, g,
    };
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hit = (q) => {
    const P = pts(); let best = null, bd = HIT;
    for (const k of ['a', 'r', 'c']) { const d = Math.hypot(P[k].x - q.x, P[k].y - q.y); if (d < bd) { bd = d; best = k; } }
    return best;
  };

  canvas.addEventListener('pointerdown', (e) => {
    const q = pos(e), k = hit(q); if (!k) return;
    canvas.setPointerCapture(e.pointerId); canvas.focus();
    drag = { k, q0: q, A: p.A, R: p.R, b: p.b }; e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const q = pos(e), g = geo();
    if (!drag) { hover = hit(q); canvas.style.cursor = hover === 'c' ? 'ns-resize' : hover ? 'ew-resize' : 'default'; return; }
    const f = e.shiftKey ? 0.2 : 1, dx = (q.x - drag.q0.x) * f, dy = (q.y - drag.q0.y) * f;
    if (drag.k === 'a') p.A = clamp(drag.A + dx / g.aw * AMAX, AMIN, AMAX);
    else if (drag.k === 'r') p.R = clamp(drag.R + dx / g.rw * RMAX, RMIN, RMAX);
    else p.b = clamp(drag.b - dy / ((g.base - TOP) * 0.5), -1, 1);   // drag up = straighter fall, down = longer tail
    commit(false);
  });
  const end = () => { if (drag) { commit(); drag = null; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  canvas.addEventListener('dblclick', (e) => {
    const k = hit(pos(e)); if (!k) return;
    if (k === 'a') p.A = DEF.A; else if (k === 'r') p.R = DEF.R; else p.b = DEF.b;
    commit();
  });

  function draw() {
    const dpr = devicePixelRatio || 1, g = geo();
    if (!g.w) return;
    if (canvas.width !== Math.round(g.w * dpr) || canvas.height !== Math.round(g.h * dpr)) { canvas.width = Math.round(g.w * dpr); canvas.height = Math.round(g.h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, g.w, g.h);
    const ACC = '#b9aaf0', INK = '#ddd7f6', P = pts(), y1 = TOP, y0 = g.base;
    c.font = '8px ui-monospace, Menlo, monospace';
    // frame: baseline, peak line, zone divider
    c.strokeStyle = 'rgba(185,170,240,.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, y0 + .5); c.lineTo(g.w, y0 + .5); c.stroke();
    c.setLineDash([2, 3]); c.beginPath(); c.moveTo(0, y1 + .5); c.lineTo(g.w, y1 + .5); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.moveTo(Math.round(g.x1) + .5, y1 - 4); c.lineTo(Math.round(g.x1) + .5, y0 + 4); c.stroke();
    // time ticks: attack 0.1 s steps, release 0.5 s steps
    c.fillStyle = 'rgba(185,170,240,.5)';
    for (let s = 0.1; s < AMAX; s += 0.1) { const x = PAD + s / AMAX * g.aw; c.fillRect(Math.round(x), y0 + 1, 1, 3); }
    for (let s = 0.5; s < RMAX; s += 0.5) { const x = P.x0 + s / RMAX * g.rw; c.fillRect(Math.round(x), y0 + 1, 1, 3); }
    c.fillText(t('env.atk'), PAD, g.h - 1); c.fillText(t('env.rel'), g.x1 + PAD, g.h - 1);
    // curve: rise (exponential, 95 % at A), fall (what the filter really does)
    c.beginPath(); c.moveTo(PAD, y0);
    const k0 = 1 - Math.exp(-3);
    for (let i = 1; i <= 24; i++) { const s = i / 24; c.lineTo(PAD + s * (P.a.x - PAD), y0 - (1 - Math.exp(-3 * s)) / k0 * (y0 - y1)); }
    c.moveTo(P.x0, y1);
    for (let i = 1; i <= 60; i++) { const tt = i / 60 * RMAX; c.lineTo(P.x0 + tt / RMAX * g.rw, y0 - relAt(tt) * (y0 - y1)); }
    c.strokeStyle = INK; c.lineWidth = 1.3; c.stroke();
    // handles
    for (const k of ['a', 'r', 'c']) {
      const on = drag?.k === k || hover === k;
      c.beginPath(); c.arc(P[k].x, P[k].y, on ? 5 : 4, 0, 6.2832); c.fillStyle = on ? ACC : '#0a0a10'; c.fill(); c.strokeStyle = on ? ACC : INK; c.lineWidth = 1.2; c.stroke();
    }
    const cr = Math.round(p.b * 100);
    c.fillStyle = drag || hover ? INK : 'rgba(221,215,246,.55)';
    c.fillText(`${t('env.atk')} ${ms(p.A)}  ${t('env.rel')} ${ms(p.R)}  ${t('env.crv')} ${cr > 0 ? '+' : ''}${cr}`, 4, 9);
  }

  return { draw, reload() { load(); commit(false); }, reset() { p = { ...DEF }; commit(); }, get dirty() { return p.A !== DEF.A || p.R !== DEF.R || p.b !== DEF.b; } };
}
