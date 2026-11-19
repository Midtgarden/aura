// Camera path: draw how the camera moves over a looping time span (like a breakpoint LFO in a synth).
// Three lanes - Yaw (swing left / right), Pitch (up / down), Distance (in / out). A lane without points does nothing.
//  - double-click empty space: add a point        - drag a point: move it (Shift = fine, Alt = snap to grid)
//  - drag the small square on a segment: bend it  - double-click a point: remove it
//  - Smooth: eases every segment (sine-like)       - the loop knob sets the length of the loop in seconds
// The moves are added on top of your own dragging / zooming and scale with the Speed knob (Speed 0 = stopped).
import { t } from './i18n.js';

const LANES = { yaw: { amp: Math.PI, unit: '°', show: (v) => Math.round(v * 180) }, pitch: { amp: 0.7, unit: '°', show: (v) => Math.round(v * 40) },
                zoom: { amp: 1.2, unit: '', show: (v) => (v * 1.2).toFixed(2) } };
const MAXP = 24, PAD = 6, HIT = 9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PRESETS = {
  sine: { smooth: true, pts: [{ x: 0, y: -1, c: 0 }, { x: 0.5, y: 1, c: 0 }] },
  tri: { smooth: false, pts: [{ x: 0, y: -1, c: 0 }, { x: 0.5, y: 1, c: 0 }] },
  rampup: { smooth: false, pts: [{ x: 0, y: -1, c: 0 }, { x: 0.97, y: 1, c: 0 }] },
  rampdown: { smooth: false, pts: [{ x: 0.03, y: 1, c: 0 }, { x: 1, y: -1, c: 0 }].map((p) => ({ ...p, x: Math.min(p.x, 0.999) })) },
  swing: { smooth: true, pts: [{ x: 0, y: 0, c: 0 }, { x: 0.25, y: 1, c: 0 }, { x: 0.5, y: 0, c: 0 }, { x: 0.75, y: -1, c: 0 }] },
};

function seg(pts, u) {   // which segment contains u: returns { i, j, xi, xj }
  const N = pts.length; let i = -1;
  for (let k = 0; k < N; k++) if (pts[k].x <= u) i = k;
  if (i < 0) return { i: N - 1, j: 0, xi: pts[N - 1].x - 1, xj: pts[0].x };
  if (i === N - 1) return { i, j: 0, xi: pts[i].x, xj: pts[0].x + 1 };
  return { i, j: i + 1, xi: pts[i].x, xj: pts[i + 1].x };
}
export function shape(s, c, smooth) {
  if (smooth) s = (1 - Math.cos(Math.PI * s)) / 2;
  return c >= 0 ? Math.pow(s, 1 + 3 * c) : 1 - Math.pow(1 - s, 1 - 3 * c);
}
export function laneValue(lane, u) {
  const pts = lane.pts, N = pts.length;
  if (!N) return 0;
  if (N === 1) return pts[0].y;
  const { i, j, xi, xj } = seg(pts, u), span = xj - xi;
  const s = span < 1e-6 ? 1 : clamp(((u < xi ? u + 1 : u) - xi) / span, 0, 1);
  return pts[i].y + (pts[j].y - pts[i].y) * shape(s, pts[i].c, lane.smooth);
}

export function initPathEdit(canvas, ui) {
  const c = canvas.getContext('2d');
  const lanes = { yaw: { pts: [], smooth: false }, pitch: { pts: [], smooth: false }, zoom: { pts: [], smooth: false } };
  let cur = 'yaw', sel = -1, hover = null, drag = null, loopSec = 20;
  canvas.tabIndex = 0;
  const load = () => {
    for (const k of Object.keys(lanes)) lanes[k] = { pts: [], smooth: false };
    loopSec = 20; sel = -1;
    try {
      const s = JSON.parse(localStorage.getItem('aura.path') || 'null');
      if (s) for (const k of Object.keys(lanes)) if (s.lanes?.[k]) {
        lanes[k].smooth = !!s.lanes[k].smooth;
        lanes[k].pts = (s.lanes[k].pts || []).filter((p) => isFinite(p.x + p.y + p.c)).map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, -1, 1), c: clamp(p.c, -1, 1) })).sort((a, b) => a.x - b.x).slice(0, MAXP);
      }
      if (s && isFinite(s.loop)) loopSec = clamp(s.loop, 4, 120);
    } catch { /* ignore */ }
    ui.loop.value = loopSec;
  };
  load();
  const save = () => { try { localStorage.setItem('aura.path', JSON.stringify({ lanes, loop: loopSec })); } catch { /* ignore */ } };
  const L = () => lanes[cur];
  const geo = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const px = (x) => PAD + x * (geo().w - 2 * PAD);
  const py = (y) => { const { h } = geo(); return h / 2 - y * (h / 2 - 9); };
  const ux = (X) => clamp((X - PAD) / (geo().w - 2 * PAD), 0, 1);
  const uy = (Y) => { const { h } = geo(); return clamp((h / 2 - Y) / (h / 2 - 9), -1, 1); };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function handles() {   // bend handle of each segment, at the middle of its time span
    const pts = L().pts, N = pts.length, out = [];
    if (N < 2) return out;
    for (let k = 0; k < N; k++) {
      const j = (k + 1) % N, span = (j > k ? pts[j].x : pts[j].x + 1) - pts[k].x;
      const tm = (pts[k].x + span / 2) % 1;
      out.push({ k, x: tm, y: laneValue(L(), tm) });
    }
    return out;
  }
  function hit(q) {
    const pts = L().pts; let best = null, bd = HIT;
    pts.forEach((p, i) => { const d = Math.hypot(px(p.x) - q.x, py(p.y) - q.y); if (d < bd) { bd = d; best = { pt: i }; } });
    if (best) return best;
    for (const hd of handles()) { const d = Math.hypot(px(hd.x) - q.x, py(hd.y) - q.y); if (d < bd) { bd = d; best = { bend: hd.k }; } }
    return best;
  }
  const refresh = () => {
    document.querySelectorAll('[data-lane]').forEach((b) => { b.classList.toggle('on', b.dataset.lane === cur); b.classList.toggle('has', lanes[b.dataset.lane].pts.length > 0); });
    ui.smooth.classList.toggle('on', L().smooth); ui.clear.disabled = !L().pts.length;
  };
  const changed = () => { save(); refresh(); };

  canvas.addEventListener('pointerdown', (e) => {
    const q = pos(e), h = hit(q); canvas.focus();
    if (!h) { sel = -1; return; }
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
    if (h.pt !== undefined) { sel = h.pt; const p = L().pts[sel]; drag = { pt: sel, q0: q, x0: p.x, y0: p.y }; }
    else { const p = L().pts[h.bend], n = L().pts[(h.bend + 1) % L().pts.length]; drag = { bend: h.bend, q0: q, c0: p.c, dir: n.y >= p.y ? 1 : -1 }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const q = pos(e), { w, h } = geo();
    if (!drag) { hover = hit(q); canvas.style.cursor = hover?.bend !== undefined ? 'ns-resize' : hover ? 'grab' : 'crosshair'; return; }
    const f = e.shiftKey ? 0.2 : 1, pts = L().pts;
    if (drag.pt !== undefined) {
      const i = drag.pt, lo = i > 0 ? pts[i - 1].x + 0.004 : 0, hi = i < pts.length - 1 ? pts[i + 1].x - 0.004 : 1;
      let x = drag.x0 + (q.x - drag.q0.x) * f / (w - 2 * PAD), y = drag.y0 - (q.y - drag.q0.y) * f / (h / 2 - 9);
      if (e.altKey) { x = Math.round(x * 16) / 16; y = Math.round(y * 4) / 4; }
      pts[i].x = clamp(x, lo, Math.max(lo, hi)); pts[i].y = clamp(y, -1, 1);
    } else {
      pts[drag.bend].c = clamp(drag.c0 + drag.dir * (q.y - drag.q0.y) * f / ((h / 2 - 9) * 0.9), -1, 1);
    }
  });
  const end = () => { if (drag) { drag = null; changed(); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  canvas.addEventListener('dblclick', (e) => {
    const q = pos(e), h = hit(q), pts = L().pts;
    if (h?.pt !== undefined) { pts.splice(h.pt, 1); sel = -1; }
    else if (h?.bend !== undefined) pts[h.bend].c = 0;
    else if (pts.length < MAXP) {
      let x = ux(q.x), y = uy(q.y); if (e.altKey) { x = Math.round(x * 16) / 16; y = Math.round(y * 4) / 4; }
      pts.push({ x, y, c: 0 }); pts.sort((a, b) => a.x - b.x); sel = pts.findIndex((p) => p.x === x);
    }
    changed();
  });
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { L().pts.splice(sel, 1); sel = -1; changed(); e.preventDefault(); e.stopPropagation(); }
  });

  document.querySelectorAll('[data-lane]').forEach((b) => { b.onclick = () => { cur = b.dataset.lane; sel = -1; refresh(); }; });
  ui.smooth.onclick = () => { L().smooth = !L().smooth; changed(); };
  ui.clear.onclick = () => { L().pts = []; L().smooth = false; sel = -1; changed(); };
  ui.preset.onchange = () => {
    const p = PRESETS[ui.preset.value]; ui.preset.value = '';
    if (!p) return;
    L().pts = p.pts.map((q) => ({ ...q })); L().smooth = p.smooth; sel = -1; changed();
  };
  ui.loop.addEventListener('input', () => { loopSec = +ui.loop.value; save(); });
  refresh();

  const readout = () => {
    const A = LANES[cur], i = drag?.pt ?? hover?.pt;
    if (i !== undefined && L().pts[i]) { const p = L().pts[i]; return `${(p.x * loopSec).toFixed(1)}S  ${A.show(p.y) > 0 ? '+' : ''}${A.show(p.y)}${A.unit}`; }
    if (drag?.bend !== undefined || hover?.bend !== undefined) { const p = L().pts[drag?.bend ?? hover.bend]; return `${t('path.bend')} ${Math.round(p.c * 100)}`; }
    return L().pts.length ? '' : t('path.hint');
  };

  function draw(time) {
    const dpr = devicePixelRatio || 1, { w, h } = geo();
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const ACC = '#b9aaf0', INK = '#ddd7f6', lane = L(), pts = lane.pts, A = LANES[cur];
    c.font = '8px ui-monospace, Menlo, monospace';
    c.strokeStyle = 'rgba(185,170,240,.16)'; c.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = Math.round(px(k / 4)) + .5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    c.strokeStyle = 'rgba(185,170,240,.3)'; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(0, py(0)); c.lineTo(w, py(0)); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(185,170,240,.5)';
    const hi = cur === 'zoom' ? '+' + A.show(1) : '+' + A.show(1) + A.unit, lo = cur === 'zoom' ? A.show(-1) : A.show(-1) + A.unit;
    c.fillText(hi, w - 4 - c.measureText(hi).width, 9); c.fillText(lo, w - 4 - c.measureText(lo).width, h - 3);
    if (pts.length) {
      c.beginPath();
      for (let i = 0; i <= 160; i++) { const u = i / 160, x = px(u), y = py(laneValue(lane, u)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.strokeStyle = INK; c.lineWidth = 1.3; c.stroke();
      // bend handles
      for (const hd of handles()) {
        const on = drag?.bend === hd.k || hover?.bend === hd.k, x = px(hd.x), y = py(hd.y);
        c.strokeStyle = on ? ACC : 'rgba(221,215,246,.6)'; c.lineWidth = 1; c.strokeRect(x - 3, y - 3, 6, 6);
        if (on) { c.fillStyle = ACC; c.fillRect(x - 3, y - 3, 6, 6); }
      }
      pts.forEach((p, i) => {
        const on = i === sel || drag?.pt === i || hover?.pt === i;
        c.beginPath(); c.arc(px(p.x), py(p.y), on ? 5 : 4, 0, 6.2832); c.fillStyle = i === sel ? ACC : '#0a0a10'; c.fill(); c.strokeStyle = on ? ACC : INK; c.lineWidth = 1.2; c.stroke();
      });
      // playhead: where the camera is in the loop right now
      const u = ((time / loopSec) % 1 + 1) % 1, v = laneValue(lane, u), x = px(u);
      c.strokeStyle = ACC; c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(x) + .5, 0); c.lineTo(Math.round(x) + .5, h); c.stroke();
      c.fillStyle = ACC; c.beginPath(); c.arc(x, py(v), 2.5, 0, 6.2832); c.fill();
    }
    const r = readout();
    if (r) { c.fillStyle = drag || hover ? INK : 'rgba(221,215,246,.4)'; c.fillText(r, 4, 9); }
  }

  // camera offsets for a given (camera) time
  function evalAt(time) {
    const u = ((time / loopSec) % 1 + 1) % 1;
    return { yaw: laneValue(lanes.yaw, u) * LANES.yaw.amp, pitch: laneValue(lanes.pitch, u) * LANES.pitch.amp, zoom: laneValue(lanes.zoom, u) * LANES.zoom.amp };
  }
  return { draw, evalAt, reload() { load(); refresh(); }, get active() { return Object.values(lanes).some((l) => l.pts.length); } };
}
