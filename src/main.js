import { AudioIn, RemoteAudio } from './audio.js';
import { Engine } from './engine.js';
import { setTextPath, LOOSE, TEXT } from './expr.js';
import { buildTextPath } from './text.js';
import { buildSvgPath } from './svg.js';
import { t, toggleLang, applyStatic } from './i18n.js';
import { initKnobs, setOffText } from './knob.js';
import { initSpecEdit } from './specedit.js';
import { initEnvEdit } from './envedit.js';
import { initPathEdit } from './pathedit.js';
import { initRampEdit, rampDef } from './rampedit.js';
import { initProfEdit, applyProfile } from './profedit.js';
import { setRamp } from './expr.js';
import { initMidi } from './midi.js';
import { SHAPES, COLORS, BACKGROUNDS, THEMES } from './presets.js';

const $ = (id) => document.getElementById(id);
const OUTPUT = new URLSearchParams(location.search).has('output');   // clean output window for a projector
if (OUTPUT) document.body.classList.add('output');
const audio = OUTPUT ? new RemoteAudio() : new AudioIn();
const link = 'BroadcastChannel' in window ? new BroadcastChannel('aura-link') : null;   // controller <-> output window
let black = false;
let engine;
try { engine = new Engine($('stage'), audio); } catch (e) { $('msg').textContent = e.message; throw e; }

const sel = { shape: $('shape'), color: $('color'), bg: $('bg'), theme: $('theme') };
const fill = (el, obj) => { el.innerHTML = ''; for (const k of Object.keys(obj)) el.add(new Option(k, k)); };
fill(sel.shape, SHAPES); fill(sel.color, COLORS); fill(sel.bg, BACKGROUNDS); fill(sel.theme, THEMES);
sel.theme.add(new Option(t('custom'), ''), 0);   // shown when form/colour/background no longer match a theme

function apply() {
  try {
    engine.setShape(SHAPES[sel.shape.value]);
    engine.setColor(COLORS[sel.color.value]);
    engine.setBackground(BACKGROUNDS[sel.bg.value]);
    const hit = Object.entries(THEMES).find(([, v]) => v[0] === sel.shape.value && v[1] === sel.color.value && v[2] === sel.bg.value);
    sel.theme.value = hit ? hit[0] : '';
    $('msg').textContent = '';
    sendState();
  } catch (e) { $('msg').textContent = e.message; console.error(e); }
}
function applyTheme(name) {
  const [s, c, b] = THEMES[name];
  sel.shape.value = s; sel.color.value = c; sel.bg.value = b; sel.theme.value = name; apply();
}
function sendState() {
  if (OUTPUT || !link) return;
  link.postMessage({ type: 's', shape: sel.shape.value, color: sel.color.value, bg: sel.bg.value, black, ramp: rampEdit.data(), prof: profEdit.data(),
    text: { n: TEXT.n, x: TEXT.x.slice(0, TEXT.n), y: TEXT.y.slice(0, TEXT.n), b: TEXT.b.slice(0, TEXT.n) } });
}
const pick = (o) => Object.keys(o)[(Math.random() * Object.keys(o).length) | 0];
function randomize() { sel.shape.value = pick(SHAPES); sel.color.value = pick(COLORS); sel.bg.value = pick(BACKGROUNDS); apply(); }

sel.theme.onchange = () => { if (sel.theme.value) applyTheme(sel.theme.value); };
for (const k of ['shape', 'color', 'bg']) sel[k].onchange = apply;
$('random').onclick = randomize;

const status = (s) => { $('source').textContent = s.startsWith('src.') ? t(s) : s; $('lamp').classList.toggle('live', audio.mode !== 'off'); };
let current = null;
const setActive = (name) => document.querySelectorAll('[data-src]').forEach((el) => {
  current = name;
  const on = el.dataset.src === name; el.classList.toggle('on', on); el.setAttribute('aria-pressed', on);
});
const guard = (fn, src) => async () => {
  try { await fn(); status(audio.label); $('msg').textContent = ''; setActive(src); }
  catch (e) { $('msg').textContent = e.message || String(e); }
};
// clicking the active source switches it off (silence); clicking again switches it on
const off = () => { audio.stop(); status(audio.label); setActive(null); $('msg').textContent = ''; };
const toggle = (src, fn) => (current === src ? off : guard(fn, src));
$('demo').onclick = () => { if (current === 'demo') return off(); audio.useDemo(); status(audio.label); setActive('demo'); };
$('mic').onclick = (e) => toggle('mic', async () => { await audio.useMic(); await listDevices(); })(e);
$('tab').onclick = (e) => toggle('tab', () => audio.useTab())(e);
$('system').onclick = (e) => toggle('system', () => audio.useSystem())(e);
audio.onlost = (msg) => { status(audio.label); $('msg').textContent = msg; setActive('demo'); };
const dev = $('dev');
async function listDevices() {
  const ds = await audio.inputDevices();
  dev.innerHTML = ''; ds.forEach((d) => dev.add(new Option(d.label || 'Input', d.deviceId)));
  dev.hidden = ds.length < 2;
}
dev.onchange = guard(() => audio.useMic(dev.value), 'mic');
$('file').onchange = guard(async () => { const f = $('file').files[0]; if (f) await audio.useFile(f); }, 'file');
$('full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === 'h') document.body.classList.toggle('hide');
  else if (e.key === 'f') $('full').click();
  else if (e.key === 'r') randomize();
  else if (e.key === 'o') $('out').click();
  else if (e.key === 'b') $('black').click();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const k = Object.keys(THEMES), d = e.key === 'ArrowRight' ? 1 : -1; applyTheme(k[(k.indexOf(sel.theme.value) + d + k.length) % k.length]); }
  else if (e.key === ' ') { e.preventDefault(); const k = Object.keys(THEMES); applyTheme(k[(k.indexOf(sel.theme.value) + 1) % k.length]); }
});

// ---- camera: drag = orbit, pinch / wheel = zoom, double-click = reset ----
const cam = engine.user, stage = $('stage');
const clampZoom = (z) => Math.max(-0.7, Math.min(3, z));   // below 0 = flown through the middle
let drag = null, vyaw = 0, vpitch = 0, lastMove = 0;
const clampV = (v) => Math.max(-5, Math.min(5, v));
const pts = new Map();                       // active pointers (touch / pen / mouse)
let pinch = null;                            // { d0, z0 } while two fingers are down

const pinchDist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
stage.addEventListener('pointerdown', (e) => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch {}
  vyaw = vpitch = 0;
  if (pts.size === 2) { drag = null; pinch = { d0: pinchDist(), z0: cam.zoom }; }   // second finger: switch from orbit to pinch
  else if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY }; document.body.classList.add('drag'); }
});
stage.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pts.size >= 2) { cam.zoom = clampZoom(pinch.z0 - 2.4 * (pinchDist() - pinch.d0) / innerHeight); return; }   // fingers apart = closer
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  const now = performance.now(), dts = Math.max(0.008, (now - lastMove) / 1000); lastMove = now;
  cam.yaw -= dx * 0.008; cam.pitch += dy * 0.006;
  cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch));
  vyaw = clampV(-dx * 0.008 / dts); vpitch = clampV(dy * 0.006 / dts);      // rad/s, for inertia on release
});
const endPointer = (e) => {
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = null;
  if (pts.size === 0) { if (performance.now() - lastMove > 90) vyaw = vpitch = 0; drag = null; document.body.classList.remove('drag'); }
  else if (pts.size === 1) { const [p] = [...pts.values()]; drag = { x: p.x, y: p.y }; vyaw = vpitch = 0; }   // back to orbit with the remaining finger
};
stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);

// trackpad pinch arrives as a wheel event with ctrlKey (Chrome, Firefox, Edge); two-finger scroll is a plain wheel
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = e.ctrlKey ? 0.009 : 0.001;
  cam.zoom = clampZoom(cam.zoom + e.deltaY * k * Math.max(0.15, Math.abs(cam.zoom)));
}, { passive: false });
// Safari trackpad pinch
let z0 = 1;
stage.addEventListener('gesturestart', (e) => { e.preventDefault(); z0 = cam.zoom; });
stage.addEventListener('gesturechange', (e) => { e.preventDefault(); cam.zoom = clampZoom(z0 - (e.scale - 1) * 1.5); });
stage.addEventListener('gestureend', (e) => e.preventDefault());
stage.addEventListener('dblclick', () => { cam.yaw = cam.pitch = 0; cam.zoom = 1; vyaw = vpitch = 0; });

// ---- VJ output window ----
let outSeen = -1e9, outWin = null;
const outLive = () => performance.now() - outSeen < 2500;
async function openOutput() {
  if (outWin && !outWin.closed) { outWin.focus(); return; }
  let box = 'popup,width=1280,height=720';
  try {   // with several screens (and permission) open it on an external one
    if (window.getScreenDetails) {
      const d = await getScreenDetails(), ext = d.screens.find((x) => x !== d.currentScreen) || d.currentScreen;
      box = `popup,left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`;
    }
  } catch { /* no permission: default window */ }
  outWin = window.open('?output', 'aura-output', box);
  if (!outWin) $('msg').textContent = t('err.popup');
}
if (!OUTPUT) {
  $('out').onclick = openOutput;
  $('black').onclick = () => { black = !black; $('black').classList.toggle('on', black); sendState(); };
  if (link) link.onmessage = (e) => { if (e.data.type === 'hello') { outSeen = performance.now(); sendState(); } else if (e.data.type === 'alive') outSeen = performance.now(); };
} else if (link) {
  const hint = $('ohint'); hint.textContent = t('ohint'); setTimeout(() => hint.classList.add('gone'), 6000);
  const fs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  addEventListener('click', fs);
  addEventListener('keydown', (e) => { if (e.key === 'f') fs(); });
  link.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'a') { audio.push(m); LOOSE.v = m.loose; Object.assign(engine.user, m.cam); Object.assign(engine.path, m.path); Object.assign(engine.fx, m.fx); }
    else if (m.type === 'p') applyProfile(m.prof);
    else if (m.type === 'r') {
      setRamp(m.ramp.stops); const k = m.ramp.map + m.ramp.mirror;
      COLORS[RAMPNAME] = rampDef(m.ramp.map, m.ramp.mirror);
      if (k !== rampKey) { rampKey = k; if (sel.color.value === RAMPNAME) apply(); }
    }
    else if (m.type === 's') {
      if (m.prof) applyProfile(m.prof);
      if (m.ramp) { setRamp(m.ramp.stops); COLORS[RAMPNAME] = rampDef(m.ramp.map, m.ramp.mirror); rampKey = m.ramp.map + m.ramp.mirror; }
      if (m.text.n > 1) setTextPath(m.text);
      sel.shape.value = m.shape; sel.color.value = m.color; sel.bg.value = m.bg; apply();
      document.body.classList.toggle('black', !!m.black);
    }
  };
  link.postMessage({ type: 'hello' });
  setInterval(() => link.postMessage({ type: 'alive' }), 1000);
}

let idle;
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 3500); };
if (!OUTPUT) { addEventListener('mousemove', wake); wake(); }

// ---- text input: type something and the shape becomes your letters ----
let typing;
const applyText = () => { try { setTextPath(buildTextPath($('txt').value)); sendState(); } catch (e) { $('msg').textContent = e.message; } };
$('txt').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => { applyText(); if (sel.shape.value !== 'Text / SVG') applyTheme('Your Text'); }, 150);
});
$('txt').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });
applyText();

// ---- SVG as the shape: file button or drag & drop ----
async function loadSvg(file) {
  try {
    const path = buildSvgPath(await file.text());
    setTextPath(path); sendState();
    $('txt').value = ''; $('txt').placeholder = file.name;
    applyTheme('Your Text');
    $('msg').textContent = '';
  } catch (e) { $('msg').textContent = e.message || String(e); }
}
$('svgfile').onchange = () => { const f = $('svgfile').files[0]; if (f) loadSvg(f); $('svgfile').value = ''; };
const isSvg = (f) => f && (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml');
addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); $('drop').hidden = false; } });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('drop').hidden = true; });
addEventListener('drop', (e) => { e.preventDefault(); $('drop').hidden = true; const f = [...e.dataTransfer.files].find(isSvg); if (f) loadSvg(f); });

// ---- looseness slider (how fluid the shapes are) ----
try { const s = localStorage.getItem('aura.loose'); if (s !== null) { LOOSE.v = +s; $('loose').value = s; } } catch { /* ignore */ }
$('loose').addEventListener('input', () => { LOOSE.v = +$('loose').value; try { localStorage.setItem('aura.loose', $('loose').value); } catch { /* ignore */ } });

// ---- rotation speed slider ----
try { const s = localStorage.getItem('aura.speed'); if (s !== null) { engine.speed = +s; $('speed').value = s; } } catch { /* ignore */ }
$('speed').addEventListener('input', () => { engine.speed = +$('speed').value; try { localStorage.setItem('aura.speed', $('speed').value); } catch { /* ignore */ } });

// ---- sensitivity, auto-cycle, distance ----
const persist = (k, v) => { try { localStorage.setItem('aura.' + k, v); } catch { /* ignore */ } };
const stored = (k) => { try { return localStorage.getItem('aura.' + k); } catch { return null; } };
{ const s = stored('sens'); if (s !== null) $('sens').value = s; audio.sens = +$('sens').value; }
$('sens').addEventListener('input', () => { audio.sens = +$('sens').value; persist('sens', $('sens').value); });
{ const s = stored('cycle'); if (s !== null) $('cycle').value = s; }
$('cycle').addEventListener('input', () => { cycleT = 0; persist('cycle', $('cycle').value); });
$('dist').addEventListener('input', () => { cam.zoom = clampZoom(+$('dist').value); });
$('camreset').onclick = () => { cam.yaw = cam.pitch = 0; cam.zoom = 1; vyaw = vpitch = 0; };
setOffText(() => t('off'));
const knobs = initKnobs();

// ---- look: trails, swirl, tunnel, mirror, detail, line, glow ----
const MIRK = [1, 2, 4, 6, 8, 12];
const FXK = ['trail', 'swirl', 'tunnel', 'mirrork', 'detail', 'line', 'glow', 'kick', 'flash', 'split', 'shift'];
for (const k of FXK) {
  const el = $(k), key = k === 'mirrork' ? 'mirror' : k;
  const st = stored('fx.' + k); if (st !== null) el.value = st;
  const upd = () => { engine.fx[key] = key === 'mirror' ? MIRK[Math.round(+el.value) - 1] || 1 : +el.value; };
  el.addEventListener('input', () => { upd(); persist('fx.' + k, el.value); }); upd();
}
for (const k of FXK) knobs[k].sync();

// ---- steppers: previous / next entry of a list (theme, shape, colour, background) ----
let cycleT = 0;
function stepSel(k, d) {
  const opts = [...sel[k].options].filter((o) => o.value !== '');
  const i = opts.findIndex((o) => o.value === sel[k].value);
  sel[k].value = opts[(i + d + opts.length) % opts.length].value;
  sel[k].onchange?.(); cycleT = 0;
}
document.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => stepSel(b.dataset.step, +b.dataset.d); });
$('hide').onclick = () => document.body.classList.add('hide');

// ---- interactive spectrum: response curve + movable band edges ----
const specEdit = initSpecEdit($('spec'), audio);
$('flat').onclick = () => specEdit.reset();
const envEdit = initEnvEdit($('env'), audio);
$('envflat').onclick = () => envEdit.reset();
const profEdit = initProfEdit($('prof'), { along: $('palong'), pulse: $('ppulse'), smooth: $('pfsmooth'), preset: $('pfpreset'), clear: $('pfclear') },
  (d) => { if (link && !OUTPUT) link.postMessage({ type: 'p', prof: d }); });
const RAMPNAME = 'Custom ramp';
let rampKey = '';
const rampEdit = initRampEdit($('ramp'), { color: $('stopcol'), map: $('rmap'), mirror: $('rmirror'), flip: $('rflip'), preset: $('rpreset') }, (full, d, quiet) => {
  COLORS[RAMPNAME] = rampDef(d.map, d.mirror);
  if (quiet) { if (sel.color.value === RAMPNAME) apply(); }   // a scene was recalled: do not switch the colour by itself
  else if (sel.color.value !== RAMPNAME) { sel.color.value = RAMPNAME; apply(); }   // editing the ramp shows it straight away
  else if (full) apply();
  if (link && !OUTPUT) link.postMessage({ type: 'r', ramp: d });
});
COLORS[RAMPNAME] = rampEdit.def();
const pathEdit = initPathEdit($('path'), { loop: $('loop'), smooth: $('psmooth'), clear: $('pclear'), preset: $('ppreset') });
knobs.loop.sync();

// ---- scenes: store the whole set-up in a slot and bring it back with one key / pad ----
const SLOTS = 8, SCENEKEY = 'aura.scenes';
const SCENE_STORE = ['aura.spec', 'aura.react', 'aura.path', 'aura.prof', 'aura.ramp'];            // the curves live in localStorage
const SCENE_KNOBS = ['sens', 'speed', 'loose', 'cycle', 'trail', 'swirl', 'tunnel', 'mirrork', 'detail', 'line', 'glow', 'kick', 'flash', 'split', 'shift'];
let scenes = Array(SLOTS).fill(null), storeMode = false, lastScene = -1, glideAnim = null;
try { const s = JSON.parse(localStorage.getItem(SCENEKEY) || 'null'); if (Array.isArray(s)) scenes = Array.from({ length: SLOTS }, (_, i) => s[i] || null); } catch { /* ignore */ }
const saveScenes = () => { try { localStorage.setItem(SCENEKEY, JSON.stringify(scenes)); } catch { $('msg').textContent = t('scene.full'); } };
const sceneStat = (k) => { $('sstat').textContent = k; };
function paintScenes() {
  document.querySelectorAll('.slot').forEach((b) => {
    const i = +b.dataset.slot, sc = scenes[i];
    b.classList.toggle('has', !!sc); b.classList.toggle('on', i === lastScene);
    b.title = sc ? `${sc.shape} · ${sc.color}` : t('tip.slotempty');
  });
  $('sstore').classList.toggle('on', storeMode);
}
function snapshot() {
  const store = {}; for (const k of SCENE_STORE) store[k] = localStorage.getItem(k);
  const knobsV = {}; for (const k of SCENE_KNOBS) knobsV[k] = +$(k).value;
  return { shape: sel.shape.value, color: sel.color.value, bg: sel.bg.value, text: $('txt').value, knobs: knobsV, cam: { ...cam }, store };
}
function storeScene(i) { scenes[i] = snapshot(); lastScene = i; storeMode = false; saveScenes(); paintScenes(); sceneStat(`${t('scene.stored')} ${i + 1}`); }
function setKnob(id, v) { const el = $(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); knobs[id]?.sync(); }
function recallScene(i) {
  const sc = scenes[i]; if (!sc) return;
  for (const k of SCENE_STORE) { if (sc.store?.[k] != null) { try { localStorage.setItem(k, sc.store[k]); } catch { /* ignore */ } } else { try { localStorage.removeItem(k); } catch { /* ignore */ } } }
  specEdit.reload(); envEdit.reload(); pathEdit.reload(); knobs.loop.sync(); profEdit.reload(); rampEdit.reload();
  if ($('txt').value !== sc.text) { $('txt').value = sc.text; applyText(); }
  const has = (el, v) => [...el.options].some((o) => o.value === v);
  if (has(sel.shape, sc.shape)) sel.shape.value = sc.shape;
  if (has(sel.color, sc.color)) sel.color.value = sc.color;
  if (has(sel.bg, sc.bg)) sel.bg.value = sc.bg;
  apply();
  // numbers glide from where they are to the stored values (Glide = seconds, 0 = at once)
  const dur = +$('glide').value, items = [];
  for (const k of SCENE_KNOBS) if (sc.knobs?.[k] !== undefined) items.push({ k, from: +$(k).value, to: sc.knobs[k] });
  const camTo = sc.cam || { yaw: 0, pitch: 0, zoom: 1 };
  if (dur > 0.05) glideAnim = { t0: performance.now(), dur: dur * 1000, items, cam0: { ...cam }, camTo };
  else { glideAnim = null; for (const it of items) setKnob(it.k, it.to); Object.assign(cam, camTo); }
  cycleT = 0; lastScene = i; storeMode = false; paintScenes(); sceneStat(`${t('scene.recalled')} ${i + 1}`);
}
function stepGlide(now) {
  const g = glideAnim; if (!g) return;
  const u = Math.min(1, (now - g.t0) / g.dur), e = u * u * (3 - 2 * u);
  for (const it of g.items) setKnob(it.k, it.from + (it.to - it.from) * e);
  for (const k of ['yaw', 'pitch', 'zoom']) cam[k] = g.cam0[k] + (g.camTo[k] - g.cam0[k]) * e;
  if (u >= 1) glideAnim = null;
}
document.querySelectorAll('.slot').forEach((b) => {
  const i = +b.dataset.slot;
  b.onclick = (e) => { if (storeMode || e.shiftKey || !scenes[i]) storeScene(i); else recallScene(i); };
  b.oncontextmenu = (e) => { e.preventDefault(); if (scenes[i]) { scenes[i] = null; if (lastScene === i) lastScene = -1; saveScenes(); paintScenes(); sceneStat(`${t('scene.cleared')} ${i + 1}`); } };
});
$('sstore').onclick = () => { storeMode = !storeMode; paintScenes(); };
{ const s = stored('glide'); if (s !== null) $('glide').value = s; knobs.glide.sync(); $('glide').addEventListener('input', () => persist('glide', $('glide').value)); }
$('sexport').onclick = async () => {
  const text = JSON.stringify({ aura: 1, scenes }, null, 1);
  try {   // on a shared page the host offers the save; locally a normal download
    const dl = await window.claude?.use?.('downloads');
    if (dl) { await dl.save({ filename: 'aura-scenes.json', data: text }); return; }
  } catch { return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'aura-scenes.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('simport').onchange = async () => {
  const f = $('simport').files[0]; $('simport').value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.aura !== 1 || !Array.isArray(d.scenes)) throw new Error('bad');
    scenes = Array.from({ length: SLOTS }, (_, i) => (d.scenes[i] && d.scenes[i].shape ? d.scenes[i] : null)); lastScene = -1; saveScenes(); paintScenes(); sceneStat(t('scene.loaded'));
  } catch { $('msg').textContent = t('scene.bad'); }
};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code); if (!m) return;
  const i = +m[1] - 1; e.preventDefault();
  if (e.shiftKey || storeMode) storeScene(i); else recallScene(i);
});
paintScenes();

// ---- shared (hosted) page: things that need this computer are switched off ----
const LOCALHOST = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const IN_CLAUDE = typeof window.claude?.use === 'function';   // the shared claude.ai page: no microphone / screen sharing / pop-ups there
if (!LOCALHOST && !OUTPUT) {
  // system audio needs the local helper app; on the claude.ai page nothing that touches the computer works
  for (const id of (IN_CLAUDE ? ['system', 'mic', 'tab', 'out'] : ['system'])) {
    delete $(id).dataset.i18nTitle; $(id).disabled = true; $(id).title = t(id === 'system' && !IN_CLAUDE ? 'hosted.system' : 'hosted.only');
  }
  if (IN_CLAUDE) $('dev').hidden = true;
}

// ---- MIDI: link pads / knobs of a controller to the panel ----
if (!OUTPUT) window.auraMidi = initMidi({ learn: $('mlearn'), clear: $('mclear'), dev: $('mdev'), lamp: $('mlamp'), stat: $('mstat') }, knobs);

// ---- language (EN / NO) ----
const applyLang = () => { applyStatic(); Object.values(knobs).forEach((k) => k.sync()); sel.theme.options[0].text = t('custom'); status(audio.label); };
$('lang').onclick = () => { toggleLang(); applyLang(); };

applyTheme('Cyber Head');
status(audio.label); setActive('demo');
applyLang();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!drag && !pinch && (Math.abs(vyaw) > 0.001 || Math.abs(vpitch) > 0.001)) {   // inertia
    cam.yaw += vyaw * dt; cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch + vpitch * dt));
    const k = Math.exp(-3.5 * dt); vyaw *= k; vpitch *= k;
  }
  if (!OUTPUT) { const pv = pathEdit.evalAt(engine.camTime); Object.assign(engine.path, pv); }
  if (OUTPUT) { if (audio.seen) { engine.time = audio.time; engine.camTime = audio.camTime; } }
  else if (link && outLive()) {
    document.body.classList.remove('idle');   // keep the panel visible while an output window is running
    link.postMessage({ type: 'a', spec: audio.spec.slice(), wave: audio.wave.slice(), bass: audio.bass, mid: audio.mid, treble: audio.treble,
      level: audio.level, beat: audio.beat, time: engine.time, camTime: engine.camTime, loose: LOOSE.v, cam: { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom }, path: engine.path, fx: engine.fx });
  }
  if (!OUTPUT) {
    const live = outLive();
    $('out').classList.toggle('on', live); $('olamp').classList.toggle('live', live); $('ostat').textContent = t(live ? 'linked' : 'nolink');
    specEdit.draw(); profEdit.draw(); rampEdit.draw(); envEdit.draw(); pathEdit.draw(engine.camTime); $('envflat').disabled = !envEdit.dirty; $('flat').disabled = !specEdit.dirty; $('bpm').textContent = audio.bpm ? Math.round(audio.bpm) : '--'; $('beat').style.opacity = 0.25 + 0.75 * audio.beat;
    const deg = (r) => Math.round(r * 180 / Math.PI);
    $('yaw').textContent = ((deg(cam.yaw) % 360 + 540) % 360 - 180) + '°'; $('pitch').textContent = deg(cam.pitch) + '°';
    if (!knobs.dist.busy() && +$('dist').value !== cam.zoom) { $('dist').value = cam.zoom; knobs.dist.sync(); }
    if (+$('cycle').value > 0 && (cycleT += dt) >= +$('cycle').value) { stepSel('theme', 1); }
  }
  $('meterbar').style.width = Math.min(100, audio.level * 100) + '%';
  stepGlide(now);
  try { engine.frame(dt); } catch (e) { $('msg').textContent = e.message; console.error(e); return; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.aura = { engine, audio };   // for debugging in the console
