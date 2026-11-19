// Interactive spectrum: the live input spectrum with an editable response curve (like an EQ) and movable band edges.
//  - double-click empty space: add a point      - drag a point: move it (x = frequency, y = boost / cut), Shift = fine
//  - mouse wheel over a point: width            - double-click a point (or Delete): remove it
//  - drag the two vertical lines: where bass | mid | treble split (double-click a line: reset it)
// The curve multiplies the spectrum that drives the shapes; the split decides which bins feed bass, mid and treble.
import { SPEC } from './audio.js';
import { t } from './i18n.js';

const G = 2;                       // gain range: +-2 octaves of amplitude (x4 .. /4)
const WMIN = 0.02, WMAX = 0.35, WDEF = 0.08;
const DEF_BANDS = [14, 90];
const TOP = 6, LAB = 11, HIT = 9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hz = (u) => { const f = (1 + Math.pow(u, 2.2) * 0.55 * 1024) * 23.4375; return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f / 5) * 5 + ''; };
const binU = (b) => b / (SPEC - 1);

export function initSpecEdit(canvas, audio) {
  const c = canvas.getContext('2d');
  let nodes = [], bands = DEF_BANDS.slice(), sel = -1, hover = null, drag = null;
  canvas.tabIndex = 0;

  const load = () => {   // from localStorage (also used when a scene is recalled)
    nodes = []; bands = DEF_BANDS.slice(); sel = -1;
    try {
      const s = JSON.parse(localStorage.getItem('aura.spec') || 'null');
      if (s) { nodes = (s.nodes || []).filter((n) => isFinite(n.x + n.g + n.w)).slice(0, 12); if (Array.isArray(s.bands)) bands = s.bands.map(Number); }
    } catch { /* ignore */ }
  };
  load();
  const commit = (save = true) => {
    audio.setNodes(nodes); audio.setBands(bands[0], bands[1]);
    if (save) try { localStorage.setItem('aura.spec', JSON.stringify({ nodes, bands })); } catch { /* ignore */ }
  };
  commit(false);

  const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const base = () => canvas.clientHeight - LAB;
  const gy = (g) => { const b = base(), cy = (TOP + b) / 2; return cy - g / G * (b - TOP) / 2; };
  const yg = (y) => { const b = base(), cy = (TOP + b) / 2; return clamp((cy - y) / ((b - TOP) / 2) * G, -G, G); };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function hit(p) {
    const { w } = size();
    let best = -1, bd = HIT;
    nodes.forEach((n, i) => { const d = Math.hypot(n.x * w - p.x, gy(n.g) - p.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) return { node: best };
    for (let k = 0; k < 2; k++) if (Math.abs(binU(bands[k]) * w - p.x) < 6) return { band: k };
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e), h = hit(p); canvas.focus();
    if (!h) { sel = -1; return; }
    canvas.setPointerCapture(e.pointerId);
    if (h.node !== undefined) { sel = h.node; const n = nodes[sel]; drag = { node: sel, p0: p, x0: n.x, g0: n.g }; }
    else drag = { band: h.band, p0: p, b0: bands[h.band] };
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e), { w } = size();
    if (!drag) { hover = hit(p); canvas.style.cursor = hover ? (hover.band !== undefined ? 'ew-resize' : 'grab') : 'crosshair'; return; }
    const k = e.shiftKey ? 0.2 : 1;
    if (drag.node !== undefined) {
      const n = nodes[drag.node];
      n.x = clamp(drag.x0 + (p.x - drag.p0.x) * k / w, 0, 1);
      n.g = clamp(drag.g0 + (yg(gy(0) + (p.y - drag.p0.y) * k) - yg(gy(0))), -G, G);
    } else {
      const lo = drag.band === 0 ? 2 : bands[0] + 8, hi = drag.band === 0 ? bands[1] - 8 : SPEC - 3;
      bands[drag.band] = clamp(Math.round(drag.b0 + (p.x - drag.p0.x) * k / w * (SPEC - 1)), lo, hi);
    }
    commit(false);
  });
  const end = () => { if (drag) { commit(); drag = null; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });

  canvas.addEventListener('dblclick', (e) => {
    const p = pos(e), h = hit(p), { w } = size();
    if (h?.node !== undefined) { nodes.splice(h.node, 1); sel = -1; }
    else if (h?.band !== undefined) bands[h.band] = DEF_BANDS[h.band];
    else if (nodes.length < 12) { nodes.push({ x: clamp(p.x / w, 0, 1), g: yg(p.y), w: WDEF }); sel = nodes.length - 1; }
    commit();
  });
  canvas.addEventListener('wheel', (e) => {
    const h = hit(pos(e)), i = h?.node ?? sel;
    if (i < 0 || !nodes[i]) return;
    e.preventDefault(); sel = i;
    nodes[i].w = clamp(nodes[i].w * Math.exp(-e.deltaY * 0.004), WMIN, WMAX); commit();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { nodes.splice(sel, 1); sel = -1; commit(); e.preventDefault(); e.stopPropagation(); }
  });

  const readout = () => {
    const i = drag?.node ?? hover?.node ?? (sel >= 0 && !drag && !hover ? sel : undefined);
    if (i !== undefined && nodes[i]) { const n = nodes[i], db = n.g * 6.02; return `${hz(n.x)}HZ  ${db >= 0 ? '+' : ''}${db.toFixed(1)}DB  W${Math.round(n.w * 100)}`; }
    const b = drag?.band ?? hover?.band;
    if (b !== undefined) return `${b ? 'M|T' : 'B|M'}  ${hz(binU(bands[b]))}HZ`;
    return nodes.length ? '' : t('spec.hint');
  };

  function draw() {
    const dpr = devicePixelRatio || 1, { w, h } = size();
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const b = base(), N = SPEC, ACC = '#b9aaf0';
    c.font = '8px ui-monospace, Menlo, monospace'; c.textBaseline = 'alphabetic';
    // input spectrum (filled, faint) and the shaped spectrum that drives the shapes (line)
    c.beginPath(); c.moveTo(0, b);
    for (let i = 0; i < N; i++) c.lineTo(i / (N - 1) * w, b - audio.smooth[i] * (b - TOP));
    c.lineTo(w, b); c.closePath(); c.fillStyle = 'rgba(185,170,240,.13)'; c.fill();
    c.beginPath();
    for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = b - audio.spec[i] * (b - TOP); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = ACC; c.lineWidth = 1.2; c.stroke();
    // axis + unity line of the response curve
    c.strokeStyle = 'rgba(185,170,240,.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, b + .5); c.lineTo(w, b + .5); c.stroke();
    c.setLineDash([2, 3]); c.beginPath(); c.moveTo(0, gy(0)); c.lineTo(w, gy(0)); c.stroke(); c.setLineDash([]);
    // band edges
    const e = [0, binU(bands[0]), binU(bands[1]), 1].map((u) => u * w);
    for (let k = 0; k < 2; k++) {
      const x = Math.round(e[k + 1]) + .5, act = drag?.band === k || hover?.band === k;
      c.strokeStyle = act ? ACC : 'rgba(185,170,240,.4)'; c.beginPath(); c.moveTo(x, TOP - 2); c.lineTo(x, b); c.stroke();
      c.fillStyle = act ? ACC : 'rgba(185,170,240,.7)'; c.beginPath(); c.moveTo(x - 3, TOP - 2); c.lineTo(x + 3, TOP - 2); c.lineTo(x, TOP + 3); c.fill();
    }
    c.fillStyle = 'rgba(185,170,240,.6)';
    ['B', 'M', 'T'].forEach((s, k) => c.fillText(s, Math.max(2, (e[k] + e[k + 1]) / 2 - 2), h - 2));
    // response curve + points
    if (nodes.length) {
      c.beginPath();
      for (let i = 0; i <= 120; i++) { const u = i / 120, y = gy(clamp(Math.log2(audio.resp[Math.round(u * (N - 1))]), -G, G)); i ? c.lineTo(u * w, y) : c.moveTo(u * w, y); }
      c.strokeStyle = '#ddd7f6'; c.lineWidth = 1.2; c.stroke();
    }
    nodes.forEach((n, i) => {
      const x = n.x * w, y = gy(n.g), on = i === sel || drag?.node === i || hover?.node === i;
      c.beginPath(); c.arc(x, y, on ? 5 : 4, 0, 6.2832); c.fillStyle = i === sel ? ACC : '#0a0a10'; c.fill(); c.strokeStyle = on ? ACC : '#ddd7f6'; c.lineWidth = 1.2; c.stroke();
    });
    const r = readout();
    if (r) { c.fillStyle = drag || hover ? '#ddd7f6' : 'rgba(221,215,246,.4)'; c.fillText(r, 4, 10); }
  }

  return {
    draw, reload() { load(); commit(false); },
    reset() { nodes = []; bands = DEF_BANDS.slice(); sel = -1; commit(); },
    get dirty() { return nodes.length > 0 || bands[0] !== DEF_BANDS[0] || bands[1] !== DEF_BANDS[1]; },
  };
}
