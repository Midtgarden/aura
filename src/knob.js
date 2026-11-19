// Rotary knob wrapped around a hidden <input type=range>: drag up/down, mouse wheel, arrow keys, double-click = default.
// The input stays the source of truth (its value + 'input' events), so the rest of the app just listens to the input.
const A0 = 135, SWEEP = 270, R = 19;
const FMT = {
  x: (v) => v.toFixed(2),
  sec1: (v) => (v < 0.01 ? OFFTXT() : v.toFixed(1) + 's'),
  sgn: (v) => (Math.abs(v) < 0.01 ? '0' : (v > 0 ? '+' : '') + v.toFixed(2)),
  mir: (v) => (v < 1.5 ? OFFTXT() : String([1, 2, 4, 6, 8, 12][Math.round(v) - 1]) + '×'),
  sec: (v) => Math.round(v) + 's',
  cyc: (v) => (v < 1 ? OFFTXT() : Math.round(v) + 's'),
};
let OFFTXT = () => 'off';
export const setOffText = (fn) => { OFFTXT = fn; };

const pol = (deg) => [28 + R * Math.cos(deg * Math.PI / 180), 28 + R * Math.sin(deg * Math.PI / 180)];
const arc = (a, b) => { const [x0, y0] = pol(a), [x1, y1] = pol(b); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };

export function initKnobs() {
  const out = {};
  document.querySelectorAll('.knob').forEach((el) => {
    const inp = el.querySelector('input'), min = +inp.min, max = +inp.max, step = +inp.step || 0.01, def = +inp.defaultValue;
    const fmt = FMT[el.dataset.fmt] || FMT.x;
    el.insertAdjacentHTML('beforeend', `<svg width="56" height="56" viewBox="0 0 56 56"><path class="tr" d="${arc(A0, A0 + SWEEP - 0.01)}"/><path class="va"/><line class="pt"/></svg><span class="v"></span>`);
    const va = el.querySelector('.va'), pt = el.querySelector('.pt'), vt = el.querySelector('.v');
    el.tabIndex = 0; el.setAttribute('role', 'slider');
    const sync = () => {
      const v = +inp.value, f = (v - min) / (max - min), a = A0 + f * SWEEP;
      va.setAttribute('d', f > 0.003 ? arc(A0, a) : '');
      const [x, y] = pol(a); pt.setAttribute('x1', 28 + (x - 28) * 0.35); pt.setAttribute('y1', 28 + (y - 28) * 0.35); pt.setAttribute('x2', x); pt.setAttribute('y2', y);
      vt.textContent = fmt(v);
      el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max); el.setAttribute('aria-valuenow', v);
      el.setAttribute('aria-label', el.querySelector('.k').textContent);
    };
    const set = (v) => {
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      if (v === +inp.value) return;
      inp.value = v; sync(); inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, v: +inp.value }; el.setPointerCapture(e.pointerId); e.preventDefault(); el.focus(); });
    el.addEventListener('pointermove', (e) => { if (drag) set(drag.v + (drag.y - e.clientY) / (e.shiftKey ? 600 : 150) * (max - min)); });
    const end = () => { drag = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); set(+inp.value - Math.sign(e.deltaY) * (max - min) / 50); }, { passive: false });
    el.addEventListener('dblclick', () => set(def));
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); set(+inp.value + d * (max - min) / 50); }
    });
    sync();
    out[inp.id] = { sync, busy: () => !!drag };
  });
  return out;
}
