// Colour ramp: build your own colour gradient and decide what drives it.
//  - double-click the bar: add a stop (colour taken from the gradient there)   - drag a stop: move it (Shift = fine)
//  - pick a stop, then the colour swatch: change its colour                      - double-click a stop (or Delete): remove it
//  - "Map by" decides what moves along the ramp: position on the line, row, spectrum height, loudness or time
//  - Mirror folds the ramp so both ends meet (no hard seam on closed shapes)       - Flip reverses it
// Editing the ramp selects the "Custom ramp" colour, so the shape shows it straight away.
import { setRamp } from './expr.js';

const MAXS = 8, HIT = 10, BAR = 26;
const PRESETS = {
  neon: ['#ff2bd6', '#6a3dff', '#00e5ff'], sunset: ['#1b0a3a', '#c2185b', '#ff7a18', '#ffe27a'], ocean: ['#04162e', '#0a6cff', '#2de2e6', '#e8fffb'],
  fire: ['#200000', '#b31200', '#ff7a00', '#fff2a0'], mint: ['#0b3d3a', '#19c37d', '#d4ffb8'], ice: ['#7aa2ff', '#e9f1ff', '#b9aaf0'], mono: ['#2a2a2a', '#ffffff'],
};
const MAPS = {
  line: 's', row: 'dt', spectrum: 'clamp(1.3 * fft(s), 0, 1)', level: 'clamp(1.5 * level, 0, 1)', time: 'trwv(t * .06)',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex2 = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const toHex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const mkStops = (cols) => cols.map((h, i) => ({ x: i / (cols.length - 1), ...hex2(h) }));

// the colour definition (expressions) the engine compiles for the "Custom ramp" colour
export function rampDef(map, mirror) {
  let X = MAPS[map] || MAPS.line;
  if (mirror) X = `trwv(2 * (${X}))`;
  return { h: `rh(${X})`, s: `rs(${X})`, v: `rv(${X})`, a: '1' };
}

export function initRampEdit(canvas, ui, onChange) {
  const c = canvas.getContext('2d');
  let stops = mkStops(PRESETS.neon), map = 'line', mirror = false, sel = 0, drag = null, hover = -1, presetName = 'neon';   // presetName: the preset you started from, always shown in the list
  canvas.tabIndex = 0;
  const load = () => {
    stops = mkStops(PRESETS.neon); map = 'line'; mirror = false; presetName = 'neon'; sel = 0;
    try {
      const s = JSON.parse(localStorage.getItem('aura.ramp') || 'null');
      if (s && Array.isArray(s.stops) && s.stops.length >= 2) {
        stops = s.stops.slice(0, MAXS).map((p) => ({ x: clamp(+p.x, 0, 1), r: clamp(+p.r, 0, 1), g: clamp(+p.g, 0, 1), b: clamp(+p.b, 0, 1) })).sort((a, b) => a.x - b.x);
        if (MAPS[s.map]) map = s.map; mirror = !!s.mirror; presetName = PRESETS[s.preset] ? s.preset : '';
      }
    } catch { /* ignore */ }
  };
  load();
  const data = () => ({ stops: stops.map((p) => ({ ...p })), map, mirror, preset: presetName });
  const commit = (full = false, save = true) => {
    setRamp(stops);
    if (save) try { localStorage.setItem('aura.ramp', JSON.stringify(data())); } catch { /* ignore */ }
    onChange(full, data());
  };
  const syncUI = () => {
    ui.map.value = map; ui.mirror.classList.toggle('on', mirror);
    ui.color.value = toHex(stops[sel] || stops[0]);
    ui.color.disabled = false; ui.preset.value = presetName;
  };
  setRamp(stops); syncUI();

  const geo = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const px = (x) => 8 + x * (geo().w - 16);
  const ux = (X) => clamp((X - 8) / (geo().w - 16), 0, 1);
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const colorAt = (x) => {
    let k = 0; while (k < stops.length - 2 && x > stops[k + 1].x) k++;
    const a = stops[k], b = stops[k + 1], f = clamp((x - a.x) / Math.max(1e-6, b.x - a.x), 0, 1);
    return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
  };
  const hit = (q) => {   // stop handles are the little triangles under the bar
    let best = -1, bd = HIT;
    if (q.y < BAR - 6) return -1;
    stops.forEach((p, i) => { const d = Math.abs(px(p.x) - q.x); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  canvas.addEventListener('pointerdown', (e) => {
    const q = pos(e), i = hit(q); canvas.focus();
    if (i < 0) return;
    sel = i; canvas.setPointerCapture(e.pointerId); e.preventDefault();
    drag = { p: stops[i], q0: q, x0: stops[i].x }; syncUI();
  });
  canvas.addEventListener('pointermove', (e) => {
    const q = pos(e);
    if (!drag) { hover = hit(q); canvas.style.cursor = hover >= 0 ? 'ew-resize' : 'crosshair'; return; }
    const f = e.shiftKey ? 0.2 : 1;
    drag.p.x = clamp(drag.x0 + (q.x - drag.q0.x) * f / (geo().w - 16), 0, 1);
    stops.sort((a, b) => a.x - b.x); sel = stops.indexOf(drag.p);
    commit(false, false);
  });
  const end = () => { if (drag) { drag = null; commit(false, true); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = -1; });
  const remove = (i) => { if (stops.length > 2 && i >= 0) { stops.splice(i, 1); sel = clamp(sel, 0, stops.length - 1); syncUI(); commit(); } };
  canvas.addEventListener('dblclick', (e) => {
    const q = pos(e), i = hit(q);
    if (i >= 0) return remove(i);
    if (stops.length >= MAXS || q.y > BAR + 2) return;
    const x = ux(q.x); stops.push({ x, ...colorAt(x) }); stops.sort((a, b) => a.x - b.x);
    sel = stops.findIndex((p) => p.x === x); syncUI(); commit();
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { remove(sel); e.preventDefault(); e.stopPropagation(); }
  });

  ui.color.addEventListener('input', () => { Object.assign(stops[sel], hex2(ui.color.value)); commit(false, false); });
  ui.color.addEventListener('change', () => commit(false, true));
  ui.map.onchange = () => { map = ui.map.value; commit(true); };
  ui.mirror.onclick = () => { mirror = !mirror; syncUI(); commit(true); };
  ui.flip.onclick = () => { stops = stops.map((p) => ({ ...p, x: 1 - p.x })).reverse(); sel = stops.length - 1 - sel; syncUI(); commit(); };
  ui.preset.onchange = () => {
    const key = ui.preset.value, p = PRESETS[key];
    if (!p) { ui.preset.value = presetName; return; }
    stops = mkStops(p); sel = 0; presetName = key; syncUI(); commit();
  };

  function draw() {
    const dpr = devicePixelRatio || 1, { w, h } = geo();
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const g = c.createLinearGradient(px(0), 0, px(1), 0);
    stops.forEach((p) => g.addColorStop(p.x, `rgb(${p.r * 255 | 0},${p.g * 255 | 0},${p.b * 255 | 0})`));
    c.fillStyle = g; c.fillRect(8, 2, w - 16, BAR - 4);
    c.strokeStyle = 'rgba(185,170,240,.3)'; c.lineWidth = 1; c.strokeRect(8.5, 2.5, w - 17, BAR - 5);
    stops.forEach((p, i) => {
      const x = px(p.x), on = i === sel || drag?.p === p || hover === i, y = BAR - 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 6, y + 12); c.lineTo(x + 6, y + 12); c.closePath();
      c.fillStyle = `rgb(${p.r * 255 | 0},${p.g * 255 | 0},${p.b * 255 | 0})`; c.fill();
      c.strokeStyle = on ? '#b9aaf0' : '#ddd7f6'; c.lineWidth = on ? 2 : 1; c.stroke();
    });
  }
  return { draw, data, reload() { load(); setRamp(stops); syncUI(); onChange(true, data(), true); }, def: () => rampDef(map, mirror) };
}
