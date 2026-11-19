// Shape profile: bend a curve to change how wide the shape is along its length (or around its line).
//  - double-click empty space: add a point      - drag a point: move it (Shift = fine, Alt = snap)
//  - drag the small square on a segment: bend   - double-click a point: remove it
// Up = wider (up to x2), down = narrower (down to half), the dashed middle line = unchanged.
// "Along": Rows = from the first row to the last (e.g. top to bottom of a head), Line = around / along each line.
// "Pulse" lets the music swell the curve. A curve without points does nothing.
import { PROF } from './expr.js';
import { shape } from './pathedit.js';
import { t } from './i18n.js';

const MAXP = 16, PAD = 8, HIT = 9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PRESETS = {
  bulge: { smooth: true, pts: [{ x: 0, y: 0, c: 0 }, { x: 0.5, y: 0.8, c: 0 }, { x: 1, y: 0, c: 0 }] },
  waist: { smooth: true, pts: [{ x: 0, y: 0.4, c: 0 }, { x: 0.5, y: -0.7, c: 0 }, { x: 1, y: 0.4, c: 0 }] },
  taper: { smooth: false, pts: [{ x: 0, y: 0.9, c: 0 }, { x: 1, y: -0.9, c: 0 }] },
  flare: { smooth: false, pts: [{ x: 0, y: -0.9, c: 0 }, { x: 1, y: 0.9, c: 0 }] },
  wave: { smooth: true, pts: [{ x: 0, y: 0, c: 0 }, { x: 0.2, y: 0.6, c: 0 }, { x: 0.4, y: -0.6, c: 0 }, { x: 0.6, y: 0.6, c: 0 }, { x: 0.8, y: -0.6, c: 0 }, { x: 1, y: 0, c: 0 }] },
};

function value(lane, u) {   // no wrap-around: the ends hold their value
  const pts = lane.pts, N = pts.length;
  if (!N) return 0;
  if (u <= pts[0].x) return pts[0].y;
  if (u >= pts[N - 1].x) return pts[N - 1].y;
  let i = 0; while (i < N - 2 && pts[i + 1].x <= u) i++;
  const span = pts[i + 1].x - pts[i].x, s = span < 1e-6 ? 1 : (u - pts[i].x) / span;
  return pts[i].y + (pts[i + 1].y - pts[i].y) * shape(s, pts[i].c, lane.smooth);
}

// fills the engine's lookup table from a stored profile
export function applyProfile(d) {
  const lane = { pts: d.pts || [], smooth: !!d.smooth };
  PROF.on = lane.pts.length > 0; PROF.line = d.along === 'line'; PROF.pulse = !!d.pulse;
  for (let i = 0; i < 257; i++) PROF.p[i] = value(lane, i / 256);
}

export function initProfEdit(canvas, ui, onChange) {
  const c = canvas.getContext('2d');
  const lane = { pts: [], smooth: false }; let along = 'rows', pulse = false, sel = -1, hover = null, drag = null;
  canvas.tabIndex = 0;
  const load = () => {
    lane.pts = []; lane.smooth = false; along = 'rows'; pulse = false; sel = -1;
    try {
      const s = JSON.parse(localStorage.getItem('aura.prof') || 'null');
      if (s) {
        lane.smooth = !!s.smooth; along = s.along === 'line' ? 'line' : 'rows'; pulse = !!s.pulse;
        lane.pts = (s.pts || []).filter((p) => isFinite(p.x + p.y + p.c)).map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, -1, 1), c: clamp(p.c, -1, 1) })).sort((a, b) => a.x - b.x).slice(0, MAXP);
      }
    } catch { /* ignore */ }
  };
  load();
  const data = () => ({ pts: lane.pts.map((p) => ({ ...p })), smooth: lane.smooth, along, pulse });
  const commit = (save = true) => {
    applyProfile(data());
    if (save) try { localStorage.setItem('aura.prof', JSON.stringify(data())); } catch { /* ignore */ }
    refresh(); onChange(data());
  };
  const refresh = () => {
    ui.along.value = along; ui.pulse.classList.toggle('on', pulse); ui.smooth.classList.toggle('on', lane.smooth); ui.clear.disabled = !lane.pts.length;
  };
  applyProfile(data()); refresh();

  const geo = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const px = (x) => PAD + x * (geo().w - 2 * PAD);
  const py = (y) => { const { h } = geo(); return h / 2 - y * (h / 2 - 12); };
  const ux = (X) => clamp((X - PAD) / (geo().w - 2 * PAD), 0, 1);
  const uy = (Y) => { const { h } = geo(); return clamp((h / 2 - Y) / (h / 2 - 12), -1, 1); };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pts = () => lane.pts;
  function handles() {
    const out = [], P = pts();
    for (let k = 0; k < P.length - 1; k++) { const tm = (P[k].x + P[k + 1].x) / 2; out.push({ k, x: tm, y: value(lane, tm) }); }
    return out;
  }
  function hit(q) {
    let best = null, bd = HIT;
    pts().forEach((p, i) => { const d = Math.hypot(px(p.x) - q.x, py(p.y) - q.y); if (d < bd) { bd = d; best = { pt: i }; } });
    if (best) return best;
    for (const hd of handles()) { const d = Math.hypot(px(hd.x) - q.x, py(hd.y) - q.y); if (d < bd) { bd = d; best = { bend: hd.k }; } }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const q = pos(e), h = hit(q); canvas.focus();
    if (!h) { sel = -1; return; }
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
    if (h.pt !== undefined) { sel = h.pt; const p = pts()[sel]; drag = { pt: sel, q0: q, x0: p.x, y0: p.y }; }
    else { const p = pts()[h.bend], n = pts()[h.bend + 1]; drag = { bend: h.bend, q0: q, c0: p.c, dir: n.y >= p.y ? 1 : -1 }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const q = pos(e), { w, h } = geo();
    if (!drag) { hover = hit(q); canvas.style.cursor = hover?.bend !== undefined ? 'ns-resize' : hover ? 'grab' : 'crosshair'; return; }
    const f = e.shiftKey ? 0.2 : 1, P = pts();
    if (drag.pt !== undefined) {
      const i = drag.pt, lo = i > 0 ? P[i - 1].x + 0.004 : 0, hi = i < P.length - 1 ? P[i + 1].x - 0.004 : 1;
      let x = drag.x0 + (q.x - drag.q0.x) * f / (w - 2 * PAD), y = drag.y0 - (q.y - drag.q0.y) * f / (h / 2 - 12);
      if (e.altKey) { x = Math.round(x * 16) / 16; y = Math.round(y * 4) / 4; }
      P[i].x = clamp(x, lo, Math.max(lo, hi)); P[i].y = clamp(y, -1, 1);
    } else P[drag.bend].c = clamp(drag.c0 + drag.dir * (q.y - drag.q0.y) * f / ((h / 2 - 12) * 0.9), -1, 1);
    commit(false);
  });
  const end = () => { if (drag) { drag = null; commit(true); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  canvas.addEventListener('dblclick', (e) => {
    const q = pos(e), h = hit(q), P = pts();
    if (h?.pt !== undefined) { P.splice(h.pt, 1); sel = -1; }
    else if (h?.bend !== undefined) P[h.bend].c = 0;
    else if (P.length < MAXP) {
      let x = ux(q.x), y = uy(q.y); if (e.altKey) { x = Math.round(x * 16) / 16; y = Math.round(y * 4) / 4; }
      P.push({ x, y, c: 0 }); P.sort((a, b) => a.x - b.x); sel = P.findIndex((p) => p.x === x);
    }
    commit();
  });
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { pts().splice(sel, 1); sel = -1; commit(); e.preventDefault(); e.stopPropagation(); }
  });

  ui.along.onchange = () => { along = ui.along.value; commit(); };
  ui.pulse.onclick = () => { pulse = !pulse; commit(); };
  ui.smooth.onclick = () => { lane.smooth = !lane.smooth; commit(); };
  ui.clear.onclick = () => { lane.pts = []; lane.smooth = false; sel = -1; commit(); };
  ui.preset.onchange = () => {
    const p = PRESETS[ui.preset.value]; ui.preset.value = '';
    if (!p) return;
    lane.pts = p.pts.map((q) => ({ ...q })); lane.smooth = p.smooth; sel = -1; commit();
  };

  const factor = (y) => { const f = Math.pow(2, y); return '×' + (f >= 1 ? f.toFixed(2) : f.toFixed(2)); };
  const readout = () => {
    const i = drag?.pt ?? hover?.pt;
    if (i !== undefined && pts()[i]) { const p = pts()[i]; return `${Math.round(p.x * 100)}%  ${factor(p.y)}`; }
    if (drag?.bend !== undefined || hover?.bend !== undefined) return `${t('path.bend')} ${Math.round(pts()[drag?.bend ?? hover.bend].c * 100)}`;
    return pts().length ? '' : t('prof.hint');
  };
  function draw() {
    const dpr = devicePixelRatio || 1, { w, h } = geo();
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const ACC = '#b9aaf0', INK = '#ddd7f6', P = pts();
    c.font = '8px ui-monospace, Menlo, monospace';
    c.strokeStyle = 'rgba(185,170,240,.16)'; c.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = Math.round(px(k / 4)) + .5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    c.strokeStyle = 'rgba(185,170,240,.3)'; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(0, py(0)); c.lineTo(w, py(0)); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(185,170,240,.5)';
    c.fillText('×2', w - 18, 9); c.fillText('×½', w - 18, h - 3);
    c.fillText(along === 'rows' ? t('prof.first') : t('prof.start'), PAD, h - 3);
    const e = along === 'rows' ? t('prof.last') : t('prof.end'); c.fillText(e, w - 26 - c.measureText(e).width, h - 3);
    if (P.length) {
      c.beginPath();
      for (let i = 0; i <= 160; i++) { const u = i / 160, x = px(u), y = py(value(lane, u)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.strokeStyle = INK; c.lineWidth = 1.3; c.stroke();
      for (const hd of handles()) {
        const on = drag?.bend === hd.k || hover?.bend === hd.k, x = px(hd.x), y = py(hd.y);
        c.strokeStyle = on ? ACC : 'rgba(221,215,246,.6)'; c.lineWidth = 1; c.strokeRect(x - 3, y - 3, 6, 6);
        if (on) { c.fillStyle = ACC; c.fillRect(x - 3, y - 3, 6, 6); }
      }
      P.forEach((p, i) => {
        const on = i === sel || drag?.pt === i || hover?.pt === i;
        c.beginPath(); c.arc(px(p.x), py(p.y), on ? 5 : 4, 0, 6.2832); c.fillStyle = i === sel ? ACC : '#0a0a10'; c.fill(); c.strokeStyle = on ? ACC : INK; c.lineWidth = 1.2; c.stroke();
      });
    }
    const r = readout();
    if (r) { c.fillStyle = drag || hover ? INK : 'rgba(221,215,246,.4)'; c.fillText(r, 4, 9); }
  }
  return { draw, data, reload() { load(); commit(false); } };
}
