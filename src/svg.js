// SVG -> outline path. The SVG is parsed, sanitised (no scripts / images / foreign content), laid out off-screen so the
// browser can do the geometry (transforms, arcs, curves ...), and every shape is sampled along its length.
// Compound paths are split where the pen jumps. The result is the same point list the text shape uses.
import { finalizePath } from './text.js';
import { t } from './i18n.js';

const SHAPES = 'path,line,polyline,polygon,rect,circle,ellipse';
const SKIP_INSIDE = 'defs,clipPath,mask,symbol,pattern,marker,metadata,title,desc';

function sanitise(root) {
  root.querySelectorAll('script,foreignObject,image,iframe,audio,video,object,embed,animate,set,animateTransform,animateMotion').forEach((n) => n.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !v.startsWith('#'))) el.removeAttribute(a.name);
    }
  }
}

export function buildSvgPath(text, budget = 2400) {
  if (text.length > 4e6) throw new Error(t('err.svgBig'));
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = doc.documentElement;
  if (doc.querySelector('parsererror') || src.nodeName.toLowerCase() !== 'svg') throw new Error(t('err.badSvg'));
  sanitise(src);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
  const svg = document.importNode(src, true);
  if (!svg.getAttribute('width') && !svg.getAttribute('height') && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000');
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    const els = [...svg.querySelectorAll(SHAPES)].filter((e) => !e.closest(SKIP_INSIDE) && typeof e.getTotalLength === 'function');
    const items = [];
    for (const e of els) {
      let len = 0;
      try { len = e.getTotalLength(); } catch { /* not renderable */ }
      if (len > 0 && isFinite(len)) items.push({ e, len });
    }
    if (!items.length) throw new Error(t('err.svgEmpty'));
    const total = items.reduce((s, i) => s + i.len, 0);

    const loops = [], closed = [];
    for (const { e, len } of items) {
      const ctm = e.getCTM && e.getCTM();
      const n = Math.max(12, Math.min(3000, Math.round(5000 * len / total)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = e.getPointAtLength(len * i / n);
        const x = ctm ? ctm.a * p.x + ctm.c * p.y + ctm.e : p.x, y = ctm ? ctm.b * p.x + ctm.d * p.y + ctm.f : p.y;
        pts.push([x, y]);
      }
      // split where the pen jumps (a compound path with several sub-paths)
      const d = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])).sort((a, b) => a - b);
      const med = d[d.length >> 1] || 0, jump = Math.max(med * 6, 1e-6);
      let cur = [pts[0]];
      const flush = () => {
        if (cur.length >= 2) {
          const a = cur[0], b = cur[cur.length - 1];
          loops.push(cur); closed.push(Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.max(med * 2, 1e-6));
        }
      };
      for (let i = 1; i < pts.length; i++) {
        if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > jump) { flush(); cur = []; }
        cur.push(pts[i]);
      }
      flush();
    }
    return finalizePath(loops, closed, budget);
  } finally {
    host.remove();
  }
}
