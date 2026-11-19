// MIDI control (Web MIDI: Chrome / Edge). Pads, keys and knobs of any class-compliant controller can run Aura.
//  - turn on "Learn", click a control in the panel (knob, button or list), then move a knob / press a pad on the controller: they are linked
//  - knobs and faders (CC) set knobs and pick entries in lists; pads and keys (notes) press buttons; a CC can also press a button (value >= 64)
//  - right-click a linked control while learning to unlink it; the links are remembered
import { t } from './i18n.js';

const SEL = '#ui .knob, #ui button:not(#mlearn):not(#mclear), #ui select:not(#mdev)';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function initMidi(ui, knobs) {
  const supported = !!navigator.requestMIDIAccess;
  let access = null, learn = false, waiting = null, map = {};   // map: message id ("cc:ch:num" / "n:ch:num") -> control key
  try { map = JSON.parse(localStorage.getItem('aura.midi') || '{}') || {}; } catch { map = {}; }
  const save = () => { try { localStorage.setItem('aura.midi', JSON.stringify(map)); } catch { /* ignore */ } };

  // ---- controls ----
  const keyOf = (el) => {
    if (el.classList.contains('knob')) return el.querySelector('input')?.id || null;
    if (el.dataset.step) return `step-${el.dataset.step}-${el.dataset.d}`;
    if (el.dataset.lane) return `lane-${el.dataset.lane}`;
    return el.id || null;
  };
  const elOf = (key) => {
    for (const el of document.querySelectorAll(SEL)) if (keyOf(el) === key) return el;
    return null;
  };
  const targetOf = (node) => { const el = node.closest?.(SEL); return el && keyOf(el) ? el : null; };
  const boundKeys = () => new Set(Object.values(map));
  const paint = () => {
    const bound = boundKeys();
    document.querySelectorAll(SEL).forEach((el) => {
      const k = keyOf(el);
      el.classList.toggle('midi-bound', !!k && bound.has(k));
      el.classList.toggle('midi-wait', !!k && k === waiting);
    });
  };

  // ---- applying a message to a control ----
  function apply(key, type, value) {
    const el = elOf(key); if (!el) return;
    if (el.classList.contains('knob')) {
      if (type !== 'cc') return;
      const inp = el.querySelector('input'), min = +inp.min, max = +inp.max, step = +inp.step || 0.01;
      const v = clamp(Math.round((min + value / 127 * (max - min)) / step) * step, min, max);
      if (v === +inp.value) return;
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); knobs[inp.id]?.sync();
    } else if (el.tagName === 'SELECT') {
      if (type !== 'cc') return;
      const opts = [...el.options].filter((o) => o.value !== '' && !o.hidden);
      if (!opts.length) return;
      const o = opts[Math.min(opts.length - 1, Math.floor(value / 128 * opts.length))];
      if (el.value !== o.value) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (!el.disabled) {
      if (type === 'cc' ? value >= 64 && !(apply.last?.[key] >= 64) : value > 0) el.click();   // pad pressed / CC crossing up
      (apply.last ||= {})[key] = type === 'cc' ? value : 0;
    }
  }

  // ---- incoming messages ----
  const NAMES = { cc: 'CC', n: 'NOTE' };
  function handle(data) {
    const [st, d1, d2 = 0] = data, kind = st & 0xf0, ch = (st & 0x0f) + 1;
    let type, value;
    if (kind === 0xb0) { type = 'cc'; value = d2; }
    else if (kind === 0x90 && d2 > 0) { type = 'n'; value = d2; }
    else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) { type = 'n'; value = 0; }
    else return;
    const id = `${type}:${ch}:${d1}`;
    ui.stat.textContent = `${NAMES[type]} ${d1} · ${value}` + (ch > 1 ? ` · CH${ch}` : '');
    if (learn && waiting) {
      if (type === 'n' && value === 0) return;                    // wait for the press, not the release
      for (const k of Object.keys(map)) if (k === id || map[k] === waiting) delete map[k];
      map[id] = waiting; waiting = null; save(); paint(); return;
    }
    if (learn) return;                                            // no accidental triggering while mapping
    if (map[id]) apply(map[id], type, value);
  }

  // ---- learn mode ----
  const setLearn = (on) => {
    learn = on && supported; waiting = null;
    document.body.classList.toggle('midi-learn', learn); ui.learn.classList.toggle('on', learn); paint();
  };
  ui.learn.onclick = () => setLearn(!learn);
  ui.clear.onclick = () => { map = {}; save(); waiting = null; paint(); ui.stat.textContent = t('midi.cleared'); };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel']) {
    document.addEventListener(type, (e) => {
      if (!learn) return;
      const el = targetOf(e.target); if (!el) return;
      stop(e);
      if (type === 'pointerdown' && e.button === 0) { waiting = keyOf(el); paint(); ui.stat.textContent = t('midi.waiting'); }
    }, true);
  }
  document.addEventListener('contextmenu', (e) => {
    if (!learn) return;
    const el = targetOf(e.target); if (!el) return;
    e.preventDefault(); const k = keyOf(el);
    for (const m of Object.keys(map)) if (map[m] === k) delete map[m];
    if (waiting === k) waiting = null;
    save(); paint();
  }, true);
  addEventListener('keydown', (e) => { if (learn && e.key === 'Escape') setLearn(false); });

  // ---- devices ----
  let only = 'all';
  const listen = () => {
    if (!access) return;
    const ins = [...access.inputs.values()];
    ui.dev.innerHTML = ''; ui.dev.add(new Option(t('midi.all'), 'all'));
    ins.forEach((i) => ui.dev.add(new Option(i.name || 'MIDI', i.id)));
    ui.dev.value = ins.some((i) => i.id === only) ? only : 'all'; only = ui.dev.value;
    ins.forEach((i) => { i.onmidimessage = (m) => { if (only === 'all' || only === i.id) handle(m.data); }; });
    ui.lamp.classList.toggle('live', ins.length > 0);
    ui.stat.textContent = ins.length ? '' : t('midi.none');
  };
  ui.dev.onchange = () => { only = ui.dev.value; };

  async function connect() {
    if (!supported) { ui.stat.textContent = t('midi.unsupported'); ui.learn.disabled = true; ui.dev.disabled = true; return; }
    try {
      access = await navigator.requestMIDIAccess();
      access.onstatechange = listen; listen();
    } catch { ui.stat.textContent = t('midi.denied'); ui.learn.disabled = true; }
  }
  connect(); paint();
  return { handle, paint, get map() { return map; } };
}
